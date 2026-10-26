import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { teacherLedger, ledgerDistribution } from "../schema";
import { asc, and, eq } from "drizzle-orm";
import { recalculateBalance, writeAudit } from "../ledger";

export const teacherLedgerRouter = router({
  list: protectedProcedure.input(z.object({ teacherId: z.number() })).query(async ({ ctx, input }) => {
    let teacherId = input.teacherId;
    if (ctx.user.role === "teacher_self") {
      if (!ctx.user.linkedTeacherId) return [];
      teacherId = ctx.user.linkedTeacherId;
    } else if (ctx.user.role === "salesperson_self") {
      throw new TRPCError({ code: "FORBIDDEN", message: "無權查看教師記帳表" });
    }
    return ctx.db.select().from(teacherLedger).where(eq(teacherLedger.teacherId, teacherId)).orderBy(asc(teacherLedger.id));
  }),

  /** 只能刪除「一般分配」來源的子記帳表項目（代墊/代墊核銷請至代墊管理操作，那邊有正確的狀態流程） */
  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = ctx.db;
    const [row] = await db.select().from(teacherLedger).where(eq(teacherLedger.id, input.id)).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "記錄不存在" });
    if (row.sourceType !== "distribution") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "代墊相關記錄請至「代墊管理」頁面操作核銷/刪除" });
    }
    if (row.mainLedgerId) {
      await db
        .delete(ledgerDistribution)
        .where(
          and(
            eq(ledgerDistribution.mainLedgerId, row.mainLedgerId),
            eq(ledgerDistribution.distributionType, "teacher"),
            eq(ledgerDistribution.recipientId, row.teacherId)
          )
        );
    }
    await db.delete(teacherLedger).where(eq(teacherLedger.id, input.id));
    await recalculateBalance(db, "teacher", row.teacherId);
    await writeAudit(db, ctx.user.id, "delete", "teacherLedger", input.id, row, null);
  }),
});
