import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./routers/index";
import { createD1Context, type Env } from "./context.d1";
import { ensureAdmin } from "./ensureAdmin";
import { ensureSalaryExpenseTypes } from "./ensureSalaryExpenseTypes";
import { handlePushRequest, handleSyncRequest } from "./webOrdersSync";
import { orderMessage, sendLine, shipperNewOrderMessage } from "./lineNotify";
import { dailyJob } from "./dailyJob";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Sync-Key, X-Act-As",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return withCors(Response.json({ ok: true }));
    }

    // 官網訂單同步（書籤小工具從官網後台送過來，用同步金鑰驗證）
    if (url.pathname === "/api/web-orders/sync" && request.method === "POST") {
      let body: unknown = null;
      try {
        body = await request.json();
      } catch {
        return withCors(Response.json({ error: "資料不是 JSON" }, { status: 400 }));
      }
      const [status, payload] = await handleSyncRequest(drizzle(env.DB, { schema }), request.headers.get("x-sync-key"), body);
      return withCors(Response.json(payload, { status }));
    }

    // 官網伺服器自動推送（新訂單、狀態改變、商品改變），用自動同步金鑰（Bearer）驗證
    if (url.pathname === "/api/web-orders/push" && request.method === "POST") {
      let body: unknown = null;
      try {
        body = await request.json();
      } catch {
        return withCors(Response.json({ error: "資料不是 JSON" }, { status: 400 }));
      }
      const line = { token: env.LINE_CHANNEL_ACCESS_TOKEN, to: env.LINE_NOTIFY_TO };
      const [status, payload] = await handlePushRequest(drizzle(env.DB, { schema }), request.headers.get("authorization"), body, async (c) => {
        const r = await sendLine(line, orderMessage(c.created, c.changed));
        // 出貨員只收新訂單（狀態改變不發）
        if (c.created.length && env.LINE_NEW_ORDER_TO)
          await sendLine({ token: env.LINE_CHANNEL_ACCESS_TOKEN, to: env.LINE_NEW_ORDER_TO }, shipperNewOrderMessage(c.created));
        return r;
      });
      return withCors(Response.json(payload, { status }));
    }

    if (url.pathname.startsWith("/trpc")) {
      const createContext = createD1Context(env);

      // 確保至少有一組管理員帳號。ensureAdmin() 內部本來就會先查詢「是否已經有使用者」，
      // 沒有才會建立，所以這裡每次請求都呼叫也只是多一個很便宜的 SELECT，換來的好處是：
      // 就算之後手動把 users 資料表清空重設，下一次請求就會馬上自動補回管理員帳號，
      // 不會因為 Worker 執行個體還「記得」自己建立過而卡住。
      try {
        const ctx = await createContext({ req: request });
        await ensureAdmin(ctx.db, { ADMIN_EMAIL: env.ADMIN_EMAIL, ADMIN_PASSWORD: env.ADMIN_PASSWORD });
        await ensureSalaryExpenseTypes(ctx.db);
      } catch (err) {
        console.error("ensureAdmin/ensureSalaryExpenseTypes failed:", err);
      }

      const res = await fetchRequestHandler({
        endpoint: "/trpc",
        req: request,
        router: appRouter,
        createContext: () => createContext({ req: request }) as any,
      });
      return withCors(res);
    }

    return withCors(new Response("Not Found", { status: 404 }));
  },

  /** 每天早上 9 點（台灣時間，wrangler.toml [triggers]）：記定期收支、帳務檢查、官網對帳，有事才發 LINE */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      dailyJob(drizzle(env.DB, { schema }), { token: env.LINE_CHANNEL_ACCESS_TOKEN, to: env.LINE_NOTIFY_TO }).catch((e) => console.error("每日排程失敗", e))
    );
  },
};
