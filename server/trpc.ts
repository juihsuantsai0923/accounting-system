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

/**
 * 會改帳的操作（新增、編輯、刪除、入帳、核銷）。2026-10-29 起只有系統管理員能做；
 * 財務人員改成唯讀（帳本、所有人的子記帳表都看得到，但不能改）。
 */
export const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有系統管理員可以修改帳目" });
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
