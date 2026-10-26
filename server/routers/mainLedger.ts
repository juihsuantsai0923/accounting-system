import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import {
  mainLedger,
  ledgerDistribution,
  teacherLedger,
  salespersonLedger,
  expenseTypes,
  incomeTypes,
  advancePayments,
  users,
} from "../schema";
import { asc, desc, eq, isNull } from "drizzle-orm";
import { recalculateBalance, recalculateMainLedgerBalance, writeAudit } from "../ledger";
import { computeCourseIncome, CourseIncomeError } from "../revenueCalc";

const referralInput = z
  .object({
    type: z.enum(["teacher", "salesperson"]),
    recipientId: z.number(),
  })
  .nullable();

const yearsInput = z.union([z.literal(1), z.literal(2), z.literal(3)]);

function mapCourseIncomeError(e: unknown): never {
  if (e instanceof CourseIncomeError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
  }
  throw e;
}

const distributionInput = z.object({
  type: z.enum(["teacher", "salesperson"]),
  recipientId: z.number(),
  amount: z.string().regex(/^\d+$/, "金額必須為整數"),
  settledAdvanceIds: z.array(z.number()).optional(),
});

async function getLatestBalance(db: any) {
  const rows = await db.select().from(mainLedger).where(isNull(mainLedger.deletedAt)).orderBy(desc(mainLedger.id)).limit(1);
  return rows[0]?.balance ?? 0;
}

async function resolveCategoryName(db: any, type: "income" | "expense", categoryId: number) {
  if (type === "income") {
    // 這裡只會是「其他收入」（課程收入走 createCourseIncome，不經過這個 generic create）
    const [incomeType] = await db.select().from(incomeTypes).where(eq(incomeTypes.id, categoryId)).limit(1);
    if (!incomeType) throw new TRPCError({ code: "BAD_REQUEST", message: "找不到對應收入類型" });
    return incomeType.name;
  } else {
    const [expenseType] = await db.select().from(expenseTypes).where(eq(expenseTypes.id, categoryId)).limit(1);
    if (!expenseType) throw new TRPCError({ code: "BAD_REQUEST", message: "找不到對應支出類型" });
    return expenseType.name;
  }
}

export const mainLedgerRouter = router({
  /** 教師/推銷者本人帳號無權查看公司整體的母記帳表，只能看自己的子記帳表 */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === "teacher_self" || ctx.user.role === "salesperson_self") {
      throw new TRPCError({ code: "FORBIDDEN", message: "無權查看母記帳表" });
    }
    const rows = await ctx.db
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
      const db = ctx.db;
      const amount = parseInt(input.amount, 10);
      if (amount <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "金額必須大於 0" });

      const distributions = input.distributions ?? [];
      const totalDistributed = distributions.reduce((sum, d) => sum + parseInt(d.amount, 10), 0);
      if (totalDistributed > amount) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "分配金額總和不能超過原始金額" });
      }

      const categoryName = await resolveCategoryName(db, input.type, input.categoryId);
      const prevBalance = await getLatestBalance(db);
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
            await writeAudit(db, ctx.user.id, "settle", "advancePayment", advanceId, advance, { status: "settled", settledByMainLedgerId: entry.id });
          }
        }
      }

      for (const a of affected) {
        await recalculateBalance(db, a.recipientType, a.recipientId);
      }

      await writeAudit(db, ctx.user.id, "create", "mainLedger", entry.id, null, entry);
      return entry;
    }),

  /** 課程收入分潤精靈：只計算、不寫入資料庫，用來讓前端在送出前先預覽分配結果 */
  previewCourseIncome: staffProcedure
    .input(z.object({ courseId: z.number(), years: yearsInput, hasCoupon: z.boolean(), referral: referralInput }))
    .query(async ({ ctx, input }) => {
      try {
        return await computeCourseIncome(ctx.db, input);
      } catch (e) {
        mapCourseIncomeError(e);
      }
    }),

  /** 課程收入分潤精靈：依照《課程分潤與成本結構辦法》計算並正式入帳 */
  createCourseIncome: staffProcedure
    .input(
      z.object({ courseId: z.number(), years: yearsInput, hasCoupon: z.boolean(), referral: referralInput, note: z.string().optional() })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      let result;
      try {
        result = await computeCourseIncome(db, input);
      } catch (e) {
        mapCourseIncomeError(e);
      }
      const { course, amount, distributions } = result!;

      const prevBalance = await getLatestBalance(db);
      const newBalance = prevBalance + amount;

      const [entry] = await db
        .insert(mainLedger)
        .values({
          type: "income",
          itemName: course.name,
          categoryId: course.id,
          categoryName: course.name,
          amount,
          balance: newBalance,
          note: input.note,
          editedBy: ctx.user.id,
        })
        .returning();

      const affected: { recipientType: "teacher" | "salesperson"; recipientId: number }[] = [];

      for (const dist of distributions) {
        if (dist.amount <= 0) continue;

        await db.insert(ledgerDistribution).values({
          mainLedgerId: entry.id,
          distributionType: dist.type,
          recipientId: dist.recipientId,
          amount: dist.amount,
        });

        const ledgerTable = dist.type === "teacher" ? teacherLedger : salespersonLedger;
        const recipientColumn = dist.type === "teacher" ? "teacherId" : "salespersonId";

        await db.insert(ledgerTable).values({
          [recipientColumn]: dist.recipientId,
          mainLedgerId: entry.id,
          sourceType: "distribution",
          type: "income",
          itemName: `${course.name}（${dist.itemNameSuffix}）`,
          categoryId: course.id,
          categoryName: course.name,
          originalAmount: amount,
          personalAmount: dist.amount,
          personalBalance: 0,
          editedBy: ctx.user.id,
        } as any);

        affected.push({ recipientType: dist.type, recipientId: dist.recipientId });
      }

      for (const a of affected) {
        await recalculateBalance(db, a.recipientType, a.recipientId);
      }

      await writeAudit(db, ctx.user.id, "create", "mainLedger", entry.id, null, entry);
      return { entry, breakdown: result };
    }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = ctx.db;
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
      await recalculateBalance(db, a.recipientType, a.recipientId);
    }

    // 修正：刪除中間任一筆母記帳表記錄後，後面所有記錄儲存的累計餘額都會過期（仍包含被刪除的那筆金額），
    // 必須重新從頭加總一次，否則母記帳表顯示的「目前餘額」會跟「累計收入－累計支出」對不起來。
    await recalculateMainLedgerBalance(db);

    await writeAudit(db, ctx.user.id, "delete", "mainLedger", input.id, before, null);
  }),

  /**
   * 一次性修復工具：手動重新計算母記帳表所有記錄的累計餘額。
   * 用來修復「舊版程式在刪除記錄後未重算後續餘額」造成的既有錯誤資料——
   * 部署完這次修正後，只需要手動觸發這一次，之後每次刪除都會自動重算，不需要再手動點。
   */
  recalculateBalances: staffProcedure.mutation(async ({ ctx }) => {
    const balance = await recalculateMainLedgerBalance(ctx.db);
    return { balance };
  }),
});
