import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./routers/index";
import { createD1Context, type Env } from "./context.d1";
import { ensureAdmin } from "./ensureAdmin";
import { ensureSalaryExpenseTypes } from "./ensureSalaryExpenseTypes";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
};
