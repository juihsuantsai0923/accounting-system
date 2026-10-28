import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { db } from "./db";
import { users } from "./schema";
import { eq } from "drizzle-orm";
import { verifyTokenWithSecret } from "./auth";
import { applyActAs } from "./actAs";

// 簽發 token 跟驗證 token 一定要用同一把密鑰，所以這裡明確算出一次，
// 透過 ctx.jwtSecret 傳給 routers/auth.ts 簽發登入 token 時使用，
// 不要各自在不同地方各自讀一次環境變數（先前在 Cloudflare Workers 版本就是
// 因為簽發跟驗證讀到不同來源的密鑰，導致所有 token 都驗證失敗）。
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me-in-production";

export async function createContext({ req }: CreateExpressContextOptions) {
  let user = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = await verifyTokenWithSecret(token, JWT_SECRET);
    if (payload) {
      const rows = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      if (rows[0] && rows[0].isActive) {
        user = rows[0];
      }
    }
  }
  return { db, user: applyActAs(user, req.header("x-act-as")), jwtSecret: JWT_SECRET, googleClientId: process.env.GOOGLE_CLIENT_ID ?? "" };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
