import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { salespersonLedger, ledgerDistribution } from "../schema";
import { asc, and, eq } from "drizzle-orm";
import { recalculateBalance, writeAudit } from "../ledger";

export const salespersonLedgerRouter = router({
  list: protectedProcedure.input(z.object({ salespersonId: z.number() })).query(async ({ ctx, input }) => {
    let salespersonId = input.salespersonId;
    if (ctx.user.role === "salesperson_self") {
      if (!ctx.user.linkedSalespersonId) return [];
      salespersonId = ctx.user.linkedSalespersonId;
    } else if (ctx.user.role === "teacher_self") {
      throw new TRPCError({ code: "FORBIDDEN", message: "無權查看推銷者記帳表" });
    }
    return ctx.db
      .select()
      .from(salespersonLedger)
      .where(eq(salespersonLedger.salespersonId, salespersonId))
      .orderBy(asc(salespersonLedger.id));
  }),

  /** 只能刪除「一般分配」來源的子記帳表項目（代墊/代墊核銷請至代墊管理操作，那邊有正確的狀態流程） */
  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = ctx.db;
    const [row] = await db.select().from(salespersonLedger).where(eq(salespersonLedger.id, input.id)).limit(1);
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
            eq(ledgerDistribution.distributionType, "salesperson"),
            eq(ledgerDistribution.recipientId, row.salespersonId)
          )
        );
    }
    await db.delete(salespersonLedger).where(eq(salespersonLedger.id, input.id));
    await recalculateBalance(db, "salesperson", row.salespersonId);
    await writeAudit(db, ctx.user.id, "delete", "salespersonLedger", input.id, row, null);
  }),
});
