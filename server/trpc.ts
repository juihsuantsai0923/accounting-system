import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/** 需要登入 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please login (10001)" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** 需要 finance_staff 以上（含 super_admin） */
export const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!["super_admin", "finance_staff"].includes(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要財務人員以上權限" });
  }
  return next({ ctx });
});

/** 需要 super_admin */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要管理員權限" });
  }
  return next({ ctx });
});
