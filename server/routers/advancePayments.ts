import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { db } from "../db";
import { advancePayments, teacherLedger, salespersonLedger } from "../schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentBalance, recalculateBalance, writeAudit } from "../ledger";

const recipientTypeSchema = z.enum(["teacher", "salesperson"]);

export const advancePaymentsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        recipientType: recipientTypeSchema.optional(),
        recipientId: z.number().optional(),
        status: z.enum(["unsettled", "settled"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      let { recipientType, recipientId, status } = input;

      if (ctx.user.role === "teacher_self") {
        recipientType = "teacher";
        recipientId = ctx.user.linkedTeacherId ?? -1;
      } else if (ctx.user.role === "salesperson_self") {
        recipientType = "salesperson";
        recipientId = ctx.user.linkedSalespersonId ?? -1;
      }

      const conditions = [] as any[];
      if (recipientType) conditions.push(eq(advancePayments.recipientType, recipientType));
      if (recipientId !== undefined) conditions.push(eq(advancePayments.recipientId, recipientId));
      if (status) conditions.push(eq(advancePayments.status, status));

      const query = conditions.length
        ? db.select().from(advancePayments).where(and(...conditions))
        : db.select().from(advancePayments);

      return query.orderBy(desc(advancePayments.id));
    }),

  create: staffProcedure
    .input(
      z.object({
        recipientType: recipientTypeSchema,
        recipientId: z.number(),
        itemName: z.string().min(1),
        amount: z.string().regex(/^\d+$/, "金額必須為整數"),
        note: z.string().optional(),
        attachmentUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const amount = parseInt(input.amount, 10);
      if (amount <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "代墊金額必須大於 0" });

      const [advance] = await db
        .insert(advancePayments)
        .values({
          recipientType: input.recipientType,
          recipientId: input.recipientId,
          itemName: input.itemName,
          amount,
          note: input.note,
          attachmentUrl: input.attachmentUrl,
          editedBy: ctx.user.id,
        })
        .returning();

      const ledgerTable = input.recipientType === "teacher" ? teacherLedger : salespersonLedger;
      const recipientColumn = input.recipientType === "teacher" ? "teacherId" : "salespersonId";
      const currentBalance = await getCurrentBalance(input.recipientType, input.recipientId);

      await db.insert(ledgerTable).values({
        [recipientColumn]: input.recipientId,
        mainLedgerId: null,
        advancePaymentId: advance.id,
        sourceType: "advance",
        type: "advance",
        itemName: input.itemName,
        categoryId: null,
        categoryName: "代墊款",
        originalAmount: amount,
        personalAmount: amount,
        personalBalance: currentBalance + amount,
        editedBy: ctx.user.id,
      } as any);

      await writeAudit(ctx.user.id, "create", "advancePayment", advance.id, null, advance);
      return advance;
    }),

  settle: staffProcedure
    .input(z.object({ id: z.number(), mainLedgerId: z.number().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [advance] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
      if (!advance) throw new TRPCError({ code: "NOT_FOUND", message: "代墊記錄不存在" });
      if (advance.status !== "unsettled") throw new TRPCError({ code: "BAD_REQUEST", message: "此代墊已核銷" });

      const mainLedgerId = input.mainLedgerId ?? null;

      await db
        .update(advancePayments)
        .set({ status: "settled", settledByMainLedgerId: mainLedgerId, settledAt: Date.now(), updatedAt: Date.now() })
        .where(eq(advancePayments.id, input.id));

      // 情境 B：非併入正式撥款，需另外建立沖銷分錄
      if (!mainLedgerId) {
        const ledgerTable = advance.recipientType === "teacher" ? teacherLedger : salespersonLedger;
        const recipientColumn = advance.recipientType === "teacher" ? "teacherId" : "salespersonId";
        const currentBalance = await getCurrentBalance(advance.recipientType as "teacher" | "salesperson", advance.recipientId);

        await db.insert(ledgerTable).values({
          [recipientColumn]: advance.recipientId,
          mainLedgerId: null,
          advancePaymentId: advance.id,
          sourceType: "advance_settlement",
          type: "advance",
          itemName: `${advance.itemName}（核銷）`,
          categoryId: null,
          categoryName: "代墊款核銷",
          originalAmount: advance.amount,
          personalAmount: advance.amount,
          personalBalance: currentBalance - advance.amount,
          editedBy: ctx.user.id,
        } as any);
      }

      await writeAudit(ctx.user.id, "settle", "advancePayment", input.id, advance, { status: "settled", mainLedgerId });
      const [updated] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
      return updated;
    }),

  unsettle: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [advance] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
    if (!advance) throw new TRPCError({ code: "NOT_FOUND", message: "代墊記錄不存在" });
    if (advance.status !== "settled") throw new TRPCError({ code: "BAD_REQUEST", message: "此代墊尚未核銷" });

    const ledgerTable = (advance.recipientType === "teacher" ? teacherLedger : salespersonLedger) as typeof teacherLedger;

    // 刪除獨立沖銷分錄（情境 B 產生的）
    const settlementRows = await db
      .select()
      .from(ledgerTable)
      .where(and(eq(ledgerTable.advancePaymentId, advance.id), eq(ledgerTable.sourceType, "advance_settlement")));
    for (const row of settlementRows) {
      await db.delete(ledgerTable).where(eq(ledgerTable.id, row.id));
    }

    await db
      .update(advancePayments)
      .set({ status: "unsettled", settledByMainLedgerId: null, settledAt: null, updatedAt: Date.now() })
      .where(eq(advancePayments.id, input.id));

    await recalculateBalance(advance.recipientType as "teacher" | "salesperson", advance.recipientId);
    await writeAudit(ctx.user.id, "unsettle", "advancePayment", input.id, advance, { status: "unsettled" });

    const [updated] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
    return updated;
  }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [advance] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
    if (!advance) throw new TRPCError({ code: "NOT_FOUND", message: "代墊記錄不存在" });
    if (advance.status === "settled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "已核銷的代墊需先取消核銷才能刪除" });
    }

    const ledgerTable = (advance.recipientType === "teacher" ? teacherLedger : salespersonLedger) as typeof teacherLedger;
    await db.delete(ledgerTable).where(eq(ledgerTable.advancePaymentId, advance.id));
    await db.delete(advancePayments).where(eq(advancePayments.id, input.id));

    await recalculateBalance(advance.recipientType as "teacher" | "salesperson", advance.recipientId);
    await writeAudit(ctx.user.id, "delete", "advancePayment", input.id, advance, null);
  }),
});
