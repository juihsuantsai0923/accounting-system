import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { users } from "./schema";
import { verifyTokenWithSecret } from "./auth";
import { applyActAs } from "./actAs";

/** Cloudflare Workers 環境變數 / bindings（對應 wrangler.toml 設定） */
export interface Env {
  DB: D1Database;
  JWT_SECRET?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
  /** Google 登入用的 OAuth 用戶端 ID（公開值，寫在 wrangler.toml 的 [vars]） */
  GOOGLE_CLIENT_ID?: string;
  /** LINE 通知（Worker secret，見 server/lineNotify.ts） */
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_NOTIFY_TO?: string;
}

/**
 * Cloudflare Workers 版本的 tRPC context 建立函式。
 * D1 binding 只能在每次請求時從 `env` 取得（不能像 Express 版本那樣在 module
 * 載入時就建立好一個全域的 db 單例），所以這裡改成一個 factory function，
 * 由 server/worker.ts 在每次 fetch 事件時呼叫。
 */
export function createD1Context(env: Env) {
  const db = drizzle(env.DB, { schema });
  // 簽發跟驗證 token 一定要用同一把密鑰。這裡明確算出一次，透過 ctx.jwtSecret
  // 傳給 routers/auth.ts 簽發 token 時使用（不要在 routers/auth.ts 裡另外用
  // process.env 讀——Cloudflare Workers 沒有 process.env，那樣讀到的一定是
  // fallback 預設值，會跟這裡驗證用的 env.JWT_SECRET 對不起來）。
  const jwtSecret = env.JWT_SECRET || "dev-secret-change-me-in-production";

  return async function createContext({ req }: { req: Request }) {
    let user: (typeof users.$inferSelect) | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = await verifyTokenWithSecret(token, jwtSecret);
      if (payload) {
        const rows = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
        if (rows[0] && rows[0].isActive) {
          user = rows[0];
        }
      }
    }
    return { db, user: applyActAs(user, req.headers.get("x-act-as")), jwtSecret, googleClientId: env.GOOGLE_CLIENT_ID ?? "", line: { token: env.LINE_CHANNEL_ACCESS_TOKEN, to: env.LINE_NOTIFY_TO } };
  };
}

export type D1Context = Awaited<ReturnType<ReturnType<typeof createD1Context>>>;
