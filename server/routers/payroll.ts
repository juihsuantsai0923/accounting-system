import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, isNull } from "drizzle-orm";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { expenseTypes, ledgerDistribution, mainLedger, salespeople, salespersonLedger, teacherLedger, teachers } from "../schema";
import { payrollTable, personSchedule, salespersonIdForShipper, twDate } from "../payroll";
import { getLatestBalance } from "./mainLedger";
import { recalculateBalance, reserveTrail, writeAudit } from "../ledger";
import { upsertSalaryExpenseType } from "../expenseTypeHelpers";
import { getRevenueSettings, twDayStart } from "../revenueCalc";

const recipientInput = z.object({ recipientType: z.enum(["teacher", "salesperson"]), recipientId: z.number() });

/** 年終分潤寫進子記帳表的類別名稱（不算營業額、不算進下一年的分潤占比） */
export const YEAR_END_CATEGORY = "年終分潤";
const NOT_EARNINGS = new Set(["創始基金", YEAR_END_CATEGORY]);

/** 只有管理員（含唯讀的財務人員）看得到全部的人；老師、推銷者、出貨員一律擋（不能只在前端藏） */
function assertSeesEveryone(role: string) {
  if (role !== "super_admin" && role !== "finance_staff") throw new TRPCError({ code: "FORBIDDEN", message: "只有管理員可以看發薪表" });
}

/** 稅金準備＝收入先扣下來的營業稅 − 已經繳掉的營業稅 */
export async function taxReserveOf(db: any) {
  const rows: any[] = await db.select({ type: mainLedger.type, taxAmount: mainLedger.taxAmount }).from(mainLedger).where(isNull(mainLedger.deletedAt));
  return rows.reduce((s, r) => s + (r.type === "income" ? r.taxAmount ?? 0 : -(r.taxAmount ?? 0)), 0);
}

/** 年終結算：可發＝公積金 − 補稅準備（凍結）− 最低水位 − 次年預留支出，依當年每人分潤占比分配（無條件捨去，零頭留公司） */
async function yearEndPlan(db: any, year: number, reservedNextYear: number) {
  const settings = await getRevenueSettings(db);
  const reserve = (await reserveTrail(db)).current;
  const available = Math.max(0, reserve - settings.reserveFrozen - settings.reserveFloor - reservedNextYear);
  const from = twDayStart(`${year}-01-01`);
  const to = twDayStart(`${year + 1}-01-01`);
  const people: { recipientType: "teacher" | "salesperson"; recipientId: number; name: string; earned: number }[] = [];
  for (const [recipientType, tbl, ledger, idCol] of [
    ["teacher", teachers, teacherLedger, "teacherId"],
    ["salesperson", salespeople, salespersonLedger, "salespersonId"],
  ] as const) {
    const list: any[] = await db.select({ id: (tbl as any).id, name: (tbl as any).name }).from(tbl as any);
    const rows: any[] = await db.select().from(ledger as any);
    for (const p of list) {
      const earned = rows
        .filter(
          (r) =>
            r[idCol] === p.id &&
            r.sourceType === "distribution" &&
            r.type === "income" &&
            r.createdAt >= from &&
            r.createdAt < to &&
            !NOT_EARNINGS.has(r.categoryName ?? "")
        )
        .reduce((s, r) => s + r.personalAmount, 0);
      if (earned > 0) people.push({ recipientType, recipientId: p.id, name: p.name, earned });
    }
  }
  const totalEarned = people.reduce((s, p) => s + p.earned, 0);
  const shares = people.map((p) => ({
    ...p,
    ratio: totalEarned ? p.earned / totalEarned : 0,
    amount: totalEarned ? Math.floor((available * p.earned) / totalEarned) : 0,
  }));
  return {
    year,
    reserve,
    reserveFrozen: settings.reserveFrozen,
    reserveFloor: settings.reserveFloor,
    reservedNextYear,
    available,
    totalEarned,
    shares,
    total: shares.reduce((s, p) => s + p.amount, 0),
  };
}

export const payrollRouter = router({
  /** 發薪表：每個人一列，每個 15 日一欄（應發＝那次新到期的金額、已發＝那個月的薪水撥款） */
  table: protectedProcedure.query(async ({ ctx }) => {
    assertSeesEveryone(ctx.user.role);
    return payrollTable(ctx.db);
  }),

  /** 一個人的發薪排程與發薪紀錄。老師、推銷者本人只能看自己（傳別人的 id 也會被換成自己）；出貨員看同名推銷者的帳 */
  person: protectedProcedure.input(recipientInput.partial()).query(async ({ ctx, input }) => {
    let recipientType = input.recipientType;
    let recipientId = input.recipientId;
    const role = ctx.user.role;
    if (role === "teacher_self") {
      if (!ctx.user.linkedTeacherId) throw new TRPCError({ code: "FORBIDDEN", message: "尚未綁定教師資料" });
      recipientType = "teacher";
      recipientId = ctx.user.linkedTeacherId;
    } else if (role === "salesperson_self") {
      if (!ctx.user.linkedSalespersonId) throw new TRPCError({ code: "FORBIDDEN", message: "尚未綁定推銷者資料" });
      recipientType = "salesperson";
      recipientId = ctx.user.linkedSalespersonId;
    } else if (role === "shipper_self") {
      const id = ctx.user.linkedShipperId ? await salespersonIdForShipper(ctx.db, ctx.user.linkedShipperId) : null;
      if (!id) return null;
      recipientType = "salesperson";
      recipientId = id;
    } else {
      assertSeesEveryone(role);
    }
    if (!recipientType || !recipientId) throw new TRPCError({ code: "BAD_REQUEST", message: "請指定人員" });
    const s = await personSchedule(ctx.db, recipientType, recipientId);
    if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個人" });
    return s;
  }),

  /** 記錄發放：在帳本記一筆該人員的薪水支出（跟手動記帳的薪水撥款一樣，公司欠款跟著減少，公積金不變） */
  markPaid: staffProcedure
    .input(
      recipientInput.extend({
        amount: z.number().int().positive("發放金額必須大於 0"),
        payday: z.string().regex(/^\d{4}-\d{2}-15$/),
        paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const tbl = input.recipientType === "teacher" ? teachers : salespeople;
      const [person] = await db.select({ id: tbl.id, name: tbl.name }).from(tbl).where(eq(tbl.id, input.recipientId)).limit(1);
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個人" });
      const ownerColumn = input.recipientType === "teacher" ? expenseTypes.teacherId : expenseTypes.salespersonId;
      let [type] = await db.select().from(expenseTypes).where(eq(ownerColumn, person.id)).limit(1);
      if (!type) {
        await upsertSalaryExpenseType(db, { type: input.recipientType, id: person.id, name: person.name });
        [type] = await db.select().from(expenseTypes).where(eq(ownerColumn, person.id)).limit(1);
      }
      const today = twDate(Date.now());
      const date = input.paidDate ?? today;
      // 指定日期（補記）時記在那天中午；今天就用現在時間
      const at = date === today ? Date.now() : twDayStart(date) + 12 * 3600 * 1000;
      const itemName = `${person.name} ${Number(input.payday.slice(5, 7))}/15 薪水`;
      const prev = await getLatestBalance(db);
      const [entry] = await db
        .insert(mainLedger)
        .values({
          type: "expense",
          itemName,
          categoryId: type.id,
          categoryName: type.name,
          amount: input.amount,
          balance: prev - input.amount,
          editedBy: ctx.user.id,
          editedAt: Date.now(),
          createdAt: at,
          updatedAt: Date.now(),
        })
        .returning();
      await db.insert(ledgerDistribution).values({ mainLedgerId: entry.id, distributionType: input.recipientType, recipientId: person.id, amount: input.amount });
      const ledger = input.recipientType === "teacher" ? teacherLedger : salespersonLedger;
      await db.insert(ledger).values({
        [input.recipientType === "teacher" ? "teacherId" : "salespersonId"]: person.id,
        mainLedgerId: entry.id,
        sourceType: "distribution",
        type: "expense",
        itemName,
        categoryId: type.id,
        categoryName: type.name,
        originalAmount: input.amount,
        personalAmount: input.amount,
        personalBalance: 0,
        editedBy: ctx.user.id,
        createdAt: at,
        updatedAt: Date.now(),
      } as any);
      await recalculateBalance(db, input.recipientType, person.id);
      await writeAudit(db, ctx.user.id, "create", "mainLedger", entry.id, null, { ...entry, payday: input.payday });
      return { id: entry.id };
    }),

  /** 稅金準備與公積金水位（儀表板用） */
  reserveStatus: protectedProcedure.query(async ({ ctx }) => {
    assertSeesEveryone(ctx.user.role);
    const s = await getRevenueSettings(ctx.db);
    return {
      taxReserve: await taxReserveOf(ctx.db),
      reserveFloor: s.reserveFloor,
      reserveFrozen: s.reserveFrozen,
      vatRate: s.vatRate,
      registrationDate: s.registrationDate,
    };
  }),

  /** 年終結算預覽：不寫入 */
  yearEndPreview: protectedProcedure
    .input(z.object({ year: z.number().int().min(2026).max(2100), reservedNextYear: z.number().int().min(0) }))
    .query(async ({ ctx, input }) => {
      assertSeesEveryone(ctx.user.role);
      return yearEndPlan(ctx.db, input.year, input.reservedNextYear);
    }),

  /** 年終結算確認：照預覽寫進每個人的子記帳表（項目「YYYY 年終分潤」）；金額跟預覽不同（期間有新帳）就擋下來請重新預覽 */
  yearEndApply: staffProcedure
    .input(z.object({ year: z.number().int().min(2026).max(2100), reservedNextYear: z.number().int().min(0), expectedTotal: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const itemName = `${input.year} 年終分潤`;
      for (const ledger of [teacherLedger, salespersonLedger]) {
        const done = (await db.select().from(ledger)).some((r: any) => r.itemName === itemName);
        if (done) throw new TRPCError({ code: "BAD_REQUEST", message: `${input.year} 年已經結算過了` });
      }
      const plan = await yearEndPlan(db, input.year, input.reservedNextYear);
      if (plan.total !== input.expectedTotal) throw new TRPCError({ code: "BAD_REQUEST", message: "帳目有變動，金額跟預覽不同，請重新預覽" });
      if (plan.total <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "沒有可以發的年終分潤" });
      for (const s of plan.shares) {
        if (s.amount <= 0) continue;
        const ledger = s.recipientType === "teacher" ? teacherLedger : salespersonLedger;
        await db.insert(ledger).values({
          [s.recipientType === "teacher" ? "teacherId" : "salespersonId"]: s.recipientId,
          mainLedgerId: null,
          sourceType: "distribution",
          type: "income",
          itemName,
          categoryName: YEAR_END_CATEGORY,
          originalAmount: plan.available,
          personalAmount: s.amount,
          personalBalance: 0,
          editedBy: ctx.user.id,
        } as any);
        await recalculateBalance(db, s.recipientType, s.recipientId);
      }
      await writeAudit(db, ctx.user.id, "yearEnd", "payroll", input.year, null, plan);
      return plan;
    }),
});
