import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../trpc";
import { db } from "../db";
import { users } from "../schema";
import { eq } from "drizzle-orm";
import { comparePassword, signToken } from "../auth";

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return null;
    const { passwordHash, ...safe } = ctx.user;
    return safe;
  }),

  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ input }) => {
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
      const token = signToken(user.id);
      const { passwordHash, ...safe } = user;
      return { token, user: safe };
    }),

  logout: protectedProcedure.mutation(() => {
    // JWT 為無狀態 token，登出由前端清除本機 token 即可
    return { success: true };
  }),
});
