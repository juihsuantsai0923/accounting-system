import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../trpc";
import { users } from "../schema";
import { eq, sql } from "drizzle-orm";
import { comparePassword, signTokenWithSecret } from "../auth";
import { toHalfWidth } from "../textNormalize";

// 跟 users.ts 的 emailSchema 同樣的道理：登入時也先把全形字元轉半形再驗證，
// 避免中文輸入法全形模式打出來的 email 被格式驗證擋下來。
const emailSchema = z.preprocess((val) => (typeof val === "string" ? toHalfWidth(val) : val), z.string().email());

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return null;
    const { passwordHash, ...safe } = ctx.user;
    return safe;
  }),

  login: publicProcedure
    .input(z.object({ email: emailSchema, password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const rows = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      const user = rows[0];
      if (!user || !user.isActive) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "帳號或密碼錯誤" });
      }
      const ok = await comparePassword(input.password, user.passwordHash);
      if (!ok) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "帳號或密碼錯誤" });
      }
      await db.update(users).set({ lastSignedIn: Date.now() }).where(eq(users.id, user.id));
      const token = await signTokenWithSecret(user.id, ctx.jwtSecret);
      const { passwordHash, ...safe } = user;
      return { token, user: safe };
    }),

  /**
   * 用 Google 帳號登入：前端拿到 Google 簽發的 ID token，這裡請 Google 驗證後，
   * 用 token 裡的 email 找系統帳號（email 不分大小寫）。沒有對應帳號就不給進。
   */
  googleLogin: publicProcedure.input(z.object({ credential: z.string().min(20) })).mutation(async ({ ctx, input }) => {
    const clientId = (ctx as any).googleClientId as string;
    if (!clientId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "還沒設定 Google 登入" });
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(input.credential)}`);
    const info: any = res.ok ? await res.json() : null;
    const verified = info?.email_verified === true || info?.email_verified === "true";
    if (!info || info.aud !== clientId || !["accounts.google.com", "https://accounts.google.com"].includes(info.iss) || !verified || !info.email) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Google 登入驗證失敗，請再試一次" });
    }
    const email = String(info.email).toLowerCase();
    const [user] = await ctx.db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (!user || !user.isActive) {
      throw new TRPCError({ code: "FORBIDDEN", message: `${email} 沒有財務系統的帳號，請找管理員開通` });
    }
    await ctx.db.update(users).set({ lastSignedIn: Date.now() }).where(eq(users.id, user.id));
    const token = await signTokenWithSecret(user.id, ctx.jwtSecret);
    const { passwordHash, ...safe } = user;
    return { token, user: safe };
  }),

  logout: protectedProcedure.mutation(() => {
    // JWT 為無狀態 token，登出由前端清除本機 token 即可
    return { success: true };
  }),
});
