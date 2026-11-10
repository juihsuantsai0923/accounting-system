import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/** 出貨員只能登記、查看自己的代墊，其他 API 一律擋掉（白名單） */
const SHIPPER_PATHS = new Set([
  "auth.logout",
  "advancePayments.list",
  "advancePayments.create",
  "advancePayments.createBatch",
  "advancePayments.update",
  "advancePayments.delete",
  "advancePayments.categories",
  "advancePayments.addCategory",
  "advancePayments.orderOptions",
  "reports.exportAdvancePaymentsCsv",
  "payroll.person",
]);

/** 需要登入 */
export const protectedProcedure = t.procedure.use(({ ctx, path, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please login (10001)" });
  }
  if (ctx.user.role === "shipper_self" && !SHIPPER_PATHS.has(path)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "出貨員只能使用代墊功能" });
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
