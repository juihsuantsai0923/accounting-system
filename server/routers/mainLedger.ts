import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, staffProcedure } from "../trpc";
import { db } from "../db";
import {
  mainLedger,
  ledgerDistribution,
  teacherLedger,
  salespersonLedger,
  courses,
  expenseTypes,
  advancePayments,
  users,
} from "../schema";
import { asc, desc, eq, isNull } from "drizzle-orm";
import { recalculateBalance, writeAudit } from "../ledger";

const distributionInput = z.object({
  type: z.enum(["teacher", "salesperson"]),
  recipientId: z.number(),
  amount: z.string().regex(/^\d+$/, "金額必須為整數"),
  settledAdvanceIds: z.array(z.number()).optional(),
});

async function getLatestBalance() {
  const rows = await db.select().from(mainLedger).where(isNull(mainLedger.deletedAt)).orderBy(desc(mainLedger.id)).limit(1);
  return rows[0]?.balance ?? 0;
}

async function resolveCategoryName(type: "income" | "expense", categoryId: number) {
  if (type === "income") {
    const [course] = await db.select().from(courses).where(eq(courses.id, categoryId)).limit(1);
    if (!course) throw new TRPCError({ code: "BAD_REQUEST", message: "找不到對應課程" });
    return course.name;
  } else {
    const [expenseType] = await db.select().from(expenseTypes).where(eq(expenseTypes.id, categoryId)).limit(1);
    if (!expenseType) throw new TRPCError({ code: "BAD_REQUEST", message: "找不到對應支出類型" });
    return expenseType.name;
  }
}

export const mainLedgerRouter = router({
  list: publicProcedure.query(async () => {
    const rows = await db
      .select({
        id: mainLedger.id,
        type: mainLedger.type,
        itemName: mainLedger.itemName,
        categoryId: mainLedger.categoryId,
        categoryName: mainLedger.categoryName,
        amount: mainLedger.amount,
        balance: mainLedger.balance,
        note: mainLedger.note,
        attachmentUrl: mainLedger.attachmentUrl,
        editedBy: mainLedger.editedBy,
        editorName: users.name,
        createdAt: mainLedger.createdAt,
        updatedAt: mainLedger.updatedAt,
      })
      .from(mainLedger)
      .leftJoin(users, eq(mainLedger.editedBy, users.id))
      .where(isNull(mainLedger.deletedAt))
      .orderBy(asc(mainLedger.id));
    return rows;
  }),

  create: staffProcedure
    .input(
      z.object({
        type: z.enum(["income", "expense"]),
        itemName: z.string().min(1),
        categoryId: z.number(),
        amount: z.string().regex(/^\d+$/, "金額必須為整數"),
        note: z.string().optional(),
        attachmentUrl: z.string().optional(),
        distributions: z.array(distributionInput).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const amount = parseInt(input.amount, 10);
      if (amount <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "金額必須大於 0" });

      const distributions = input.distributions ?? [];
      const totalDistributed = distributions.reduce((sum, d) => sum + parseInt(d.amount, 10), 0);
      if (totalDistributed > amount) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "分配金額總和不能超過原始金額" });
      }

      const categoryName = await resolveCategoryName(input.type, input.categoryId);
      const prevBalance = await getLatestBalance();
      const newBalance = input.type === "income" ? prevBalance + amount : prevBalance - amount;

      const [entry] = await db
        .insert(mainLedger)
        .values({
          type: input.type,
          itemName: input.itemName,
          categoryId: input.categoryId,
          categoryName,
          amount,
          balance: newBalance,
          note: input.note,
          attachmentUrl: input.attachmentUrl,
          editedBy: ctx.user.id,
        })
        .returning();

      const affected: { recipientType: "teacher" | "salesperson"; recipientId: number }[] = [];

      for (const dist of distributions) {
        const distAmount = parseInt(dist.amount, 10);
        if (distAmount <= 0) continue;

        await db.insert(ledgerDistribution).values({
          mainLedgerId: entry.id,
          distributionType: dist.type,
          recipientId: dist.recipientId,
          amount: distAmount,
        });

        const ledgerTable = dist.type === "teacher" ? teacherLedger : salespersonLedger;
        const recipientColumn = dist.type === "teacher" ? "teacherId" : "salespersonId";

        await db.insert(ledgerTable).values({
          [recipientColumn]: dist.recipientId,
          mainLedgerId: entry.id,
          sourceType: "distribution",
          type: input.type,
          itemName: input.itemName,
          categoryId: input.categoryId,
          categoryName,
          originalAmount: amount,
          personalAmount: distAmount,
          personalBalance: 0, // 稍後 recalculateBalance 會重新計算
          editedBy: ctx.user.id,
        } as any);

        affected.push({ recipientType: dist.type, recipientId: dist.recipientId });

        // 核銷指定的代墊記錄
        if (dist.settledAdvanceIds?.length) {
          for (const advanceId of dist.settledAdvanceIds) {
            const [advance] = await db.select().from(advancePayments).where(eq(advancePayments.id, advanceId)).limit(1);
            if (!advance) continue;
            if (advance.status !== "unsettled") continue;
            if (advance.recipientType !== dist.type || advance.recipientId !== dist.recipientId) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `代墊記錄 #${advanceId} 不屬於此撥款對象` });
            }
            await db
              .update(advancePayments)
              .set({ status: "settled", settledByMainLedgerId: entry.id, settledAt: Date.now(), updatedAt: Date.now() })
              .where(eq(advancePayments.id, advanceId));
            await writeAudit(ctx.user.id, "settle", "advancePayment", advanceId, advance, { status: "settled", settledByMainLedgerId: entry.id });
          }
        }
      }

      for (const a of affected) {
        await recalculateBalance(a.recipientType, a.recipientId);
      }

      await writeAudit(ctx.user.id, "create", "mainLedger", entry.id, null, entry);
      return entry;
    }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await db.select().from(mainLedger).where(eq(mainLedger.id, input.id)).limit(1);
    if (!before || before.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found" });

    const distributions = await db.select().from(ledgerDistribution).where(eq(ledgerDistribution.mainLedgerId, input.id));

    const affected: { recipientType: "teacher" | "salesperson"; recipientId: number }[] = [];

    await db.delete(teacherLedger).where(eq(teacherLedger.mainLedgerId, input.id));
    await db.delete(salespersonLedger).where(eq(salespersonLedger.mainLedgerId, input.id));
    await db.delete(ledgerDistribution).where(eq(ledgerDistribution.mainLedgerId, input.id));

    // 若有代墊透過此筆核銷，退回未核銷狀態
    const settledAdvances = await db.select().from(advancePayments).where(eq(advancePayments.settledByMainLedgerId, input.id));
    for (const adv of settledAdvances) {
      await db
        .update(advancePayments)
        .set({ status: "unsettled", settledByMainLedgerId: null, settledAt: null, updatedAt: Date.now() })
        .where(eq(advancePayments.id, adv.id));
    }

    // 軟刪除母記帳表記錄，保留稽核歷史
    await db.update(mainLedger).set({ deletedAt: Date.now(), updatedAt: Date.now() }).where(eq(mainLedger.id, input.id));

    for (const d of distributions) {
      affected.push({ recipientType: d.distributionType as "teacher" | "salesperson", recipientId: d.recipientId });
    }
    for (const a of affected) {
      await recalculateBalance(a.recipientType, a.recipientId);
    }

    await writeAudit(ctx.user.id, "delete", "mainLedger", input.id, before, null);
  }),
});
