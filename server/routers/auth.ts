import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../trpc";
import { users } from "../schema";
import { eq } from "drizzle-orm";
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

  logout: protectedProcedure.mutation(() => {
    // JWT 為無狀態 token，登出由前端清除本機 token 即可
    return { success: true };
  }),
});
