import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  teachers,
  salespeople,
  teacherLedger,
  salespersonLedger,
  advancePayments,
  mainLedger,
  ledgerDistribution,
  users,
} from "../schema";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
import { ledgerDelta } from "../ledger";
import { toCsv, formatDate } from "../csv";

const recipientTypeSchema = z.enum(["teacher", "salesperson"]);

async function overviewFor(db: any, recipientType: "teacher" | "salesperson", list: { id: number; name: string }[]) {
  const ledgerTable = recipientType === "teacher" ? teacherLedger : salespersonLedger;
  const recipientColumn = recipientType === "teacher" ? teacherLedger.teacherId : salespersonLedger.salespersonId;

  const results = [];
  for (const person of list) {
    const rows = await db
      .select()
      .from(ledgerTable)
      .where(eq(recipientColumn as any, person.id))
      .orderBy(desc(ledgerTable.id))
      .limit(1);
    const totalBalance = rows[0]?.personalBalance ?? 0;

    const unsettled = await db
      .select()
      .from(advancePayments)
      .where(
        and(
          eq(advancePayments.recipientType, recipientType),
          eq(advancePayments.recipientId, person.id),
          eq(advancePayments.status, "unsettled")
        )
      );
    const unsettledAdvanceTotal = unsettled.reduce((sum: number, a: any) => sum + a.amount, 0);

    results.push({
      recipientType,
      recipientId: person.id,
      name: person.name,
      totalBalance,
      unsettledAdvanceTotal,
    });
  }
  return results;
}

const SOURCE_LABELS: Record<string, string> = {
  distribution: "一般分配",
  advance: "代墊入帳",
  advance_settlement: "代墊核銷",
};
const TYPE_LABELS: Record<string, string> = {
  income: "收入",
  expense: "支出",
  advance: "代墊",
};

/** 股東投入的資金（例如創始基金）不是營業收入，不算進每人營業額 */
const NON_REVENUE_CATEGORIES = new Set(["創始基金"]);

/** 台灣時間的月份（Workers 跑在 UTC，直接用 getMonth 會把月初 8 小時算到上個月） */
function monthKeyTW(ts: number) {
  const d = new Date(ts + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextMonth(key: string) {
  let [y, m] = key.split("-").map(Number);
  m += 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** 每人統計：累計分得的收入（營業額分潤）、已領的錢（薪水撥款）、目前公司欠款 */
async function personStatsFor(db: any, recipientType: "teacher" | "salesperson", list: { id: number; name: string }[]) {
  const ledgerTable = recipientType === "teacher" ? teacherLedger : salespersonLedger;
  const recipientColumn = recipientType === "teacher" ? teacherLedger.teacherId : salespersonLedger.salespersonId;
  const out = [];
  for (const person of list) {
    const rows = await db.select().from(ledgerTable).where(eq(recipientColumn as any, person.id)).orderBy(asc(ledgerTable.id));
    let earned = 0;
    let paid = 0;
    let loan = 0; // 要還的借款（例如創始基金）
    let lastPaidAt: number | null = null;
    let firstOwedAt: number | null = null;
    const monthly: Record<string, { earned: number; paid: number }> = {};
    for (const r of rows as any[]) {
      const m = monthKeyTW(r.createdAt);
      monthly[m] ??= { earned: 0, paid: 0 };
      if (r.sourceType === "distribution" && r.type === "income") {
        if (NON_REVENUE_CATEGORIES.has(r.categoryName ?? "")) loan += r.personalAmount;
        else {
          earned += r.personalAmount;
          monthly[m].earned += r.personalAmount;
        }
        firstOwedAt ??= r.createdAt;
      }
      if (r.sourceType === "distribution" && r.type === "expense") {
        paid += r.personalAmount;
        monthly[m].paid += r.personalAmount;
        lastPaidAt = r.createdAt;
      }
    }
    const balance = rows.length ? rows[rows.length - 1].personalBalance : 0;
    out.push({ recipientType, recipientId: person.id, name: person.name, earned, paid, loan, balance, lastPaidAt, firstOwedAt, monthly });
  }
  return out;
}

export const reportsRouter = router({
  /**
   * 每月月底的母帳餘額、公司欠所有人的錢、公積金（＝餘額 − 欠款）。
   * 用來畫公積金走勢；跟儀表板的公積金卡片同一個算法，代墊也有算進欠款。
   */
  timeline: protectedProcedure.query(async ({ ctx }) => {
    // 老師的個人儀表板也會畫公積金走勢（只有每月總數，看不到明細）
    if (ctx.user.role === "salesperson_self") {
      throw new TRPCError({ code: "FORBIDDEN", message: "無權查看全公司統計" });
    }
    const events: { month: string; balanceDelta: number; owedDelta: number }[] = [];
    const ml = await ctx.db.select().from(mainLedger).where(isNull(mainLedger.deletedAt));
    for (const r of ml as any[]) events.push({ month: monthKeyTW(r.createdAt), balanceDelta: r.type === "income" ? r.amount : -r.amount, owedDelta: 0 });
    for (const tbl of [teacherLedger, salespersonLedger]) {
      const rows = await ctx.db.select().from(tbl);
      for (const r of rows as any[]) events.push({ month: monthKeyTW(r.createdAt), balanceDelta: 0, owedDelta: ledgerDelta(r) });
    }
    if (!events.length) return [];
    const byMonth = new Map<string, { b: number; o: number }>();
    for (const e of events) {
      const v = byMonth.get(e.month) ?? { b: 0, o: 0 };
      v.b += e.balanceDelta;
      v.o += e.owedDelta;
      byMonth.set(e.month, v);
    }
    const months = [...byMonth.keys()].sort();
    const thisMonth = monthKeyTW(Date.now());
    const last = months[months.length - 1] > thisMonth ? months[months.length - 1] : thisMonth;
    const out = [];
    let balance = 0;
    let owed = 0;
    let prevReserve = 0;
    for (let m = months[0]; m <= last; m = nextMonth(m)) {
      const v = byMonth.get(m) ?? { b: 0, o: 0 };
      balance += v.b;
      owed += v.o;
      const reserve = balance - owed;
      out.push({ month: m, balance, owed, reserve, reserveChange: reserve - prevReserve });
      prevReserve = reserve;
    }
    return out;
  }),

  /** 儀表板圖表用：每人營業額（累計分得收入）與欠薪；教師／推銷者本人帳號不能看全公司資料 */
  personStats: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === "teacher_self" || ctx.user.role === "salesperson_self") {
      throw new TRPCError({ code: "FORBIDDEN", message: "無權查看全公司統計" });
    }
    const teacherList = await ctx.db.select({ id: teachers.id, name: teachers.name }).from(teachers);
    const salespersonList = await ctx.db.select({ id: salespeople.id, name: salespeople.name }).from(salespeople);
    return [...(await personStatsFor(ctx.db, "teacher", teacherList)), ...(await personStatsFor(ctx.db, "salesperson", salespersonList))];
  }),

  /**
   * 全公司三個總數：總收入、總支出、公積金增減（老師也看得到，但只有這三個數字，不給明細）。
   * 公積金增減＝每筆收入沒分給個人的部分 − 公帳支出（薪水撥款付的是本來就欠的錢，不算）。
   */
  /** 月營業額圖用：每筆收入只給金額、類別、來源、日期（不含項目名稱、備註、買家），老師的個人儀表板也看得到 */
  revenueEntries: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === "salesperson_self") throw new TRPCError({ code: "FORBIDDEN", message: "無權查看" });
    const rows = await ctx.db.select().from(mainLedger).where(isNull(mainLedger.deletedAt)).orderBy(asc(mainLedger.id));
    return (rows as any[])
      .filter((r) => r.type === "income")
      .map((r) => ({
        type: r.type as string,
        amount: r.amount as number,
        categoryName: r.categoryName as string,
        incomeSource: r.incomeSource as string | null,
        // breakdown 只留來源與金額，名稱換成類別（線上課程名稱本來就是公開的課名）
        breakdown: r.breakdown
          ? JSON.stringify(JSON.parse(r.breakdown).map((p: any) => ({ source: p.source, name: p.source === "course" ? p.name : "", categoryId: p.categoryId, amount: p.amount })))
          : null,
        createdAt: r.createdAt as number,
      }));
  }),

  companySummary: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === "salesperson_self") throw new TRPCError({ code: "FORBIDDEN", message: "無權查看" });
    const rows = await ctx.db.select().from(mainLedger).where(isNull(mainLedger.deletedAt));
    const sums: { mainLedgerId: number; amount: number }[] = await ctx.db.select().from(ledgerDistribution);
    const distributed = new Map<number, number>();
    for (const d of sums as any[]) distributed.set(d.mainLedgerId, (distributed.get(d.mainLedgerId) ?? 0) + d.amount);
    let totalIncome = 0;
    let totalExpense = 0;
    let reserveChange = 0;
    for (const r of rows as any[]) {
      const kept = r.amount - (distributed.get(r.id) ?? 0);
      if (r.type === "income") {
        totalIncome += r.amount;
        reserveChange += kept;
      } else {
        totalExpense += r.amount;
        reserveChange -= kept;
      }
    }
    return { totalIncome, totalExpense, reserveChange };
  }),

  /**
   * 個人儀表板：某位老師／推銷者的累積分潤、已發放、還沒發放，以及每月的分潤與發放金額。
   * 本人帳號只能看自己（傳別人的 id 也會被換成自己的）。
   */
  personDashboard: protectedProcedure
    .input(z.object({ recipientType: z.enum(["teacher", "salesperson"]), recipientId: z.number() }))
    .query(async ({ ctx, input }) => {
      let { recipientType, recipientId } = input;
      if (ctx.user.role === "teacher_self") {
        if (recipientType !== "teacher" || !ctx.user.linkedTeacherId) throw new TRPCError({ code: "FORBIDDEN", message: "只能看自己的儀表板" });
        recipientId = ctx.user.linkedTeacherId;
      } else if (ctx.user.role === "salesperson_self") {
        if (recipientType !== "salesperson" || !ctx.user.linkedSalespersonId) throw new TRPCError({ code: "FORBIDDEN", message: "只能看自己的儀表板" });
        recipientId = ctx.user.linkedSalespersonId;
      }
      const table = recipientType === "teacher" ? teachers : salespeople;
      const [person] = await ctx.db.select({ id: table.id, name: table.name }).from(table).where(eq(table.id, recipientId)).limit(1);
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個人" });
      const [stat] = await personStatsFor(ctx.db, recipientType, [person]);
      return stat;
    }),

  /** 教師/推銷者本人帳號無權查看全公司所有人的應付總覽，只能透過自己的子記帳表頁面看自己的餘額 */
  balanceOverview: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === "teacher_self" || ctx.user.role === "salesperson_self") {
      throw new TRPCError({ code: "FORBIDDEN", message: "無權查看應付總覽" });
    }
    const teacherList = await ctx.db.select({ id: teachers.id, name: teachers.name }).from(teachers);
    const salespersonList = await ctx.db.select({ id: salespeople.id, name: salespeople.name }).from(salespeople);

    const [teacherOverview, salespersonOverview] = await Promise.all([
      overviewFor(ctx.db, "teacher", teacherList),
      overviewFor(ctx.db, "salesperson", salespersonList),
    ]);

    return [...teacherOverview, ...salespersonOverview];
  }),

  /** 匯出母記帳表為 CSV（教師/推銷者本人帳號無權匯出，跟看母記帳表列表一樣的權限限制） */
  exportMainLedgerCsv: protectedProcedure
    .input(z.object({ dateFrom: z.number().optional(), dateTo: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (ctx.user.role === "salesperson_self" || ctx.user.role === "teacher_self") {
        throw new TRPCError({ code: "FORBIDDEN", message: "無權匯出母記帳表" });
      }
      const rows = await ctx.db
        .select({
          id: mainLedger.id,
          type: mainLedger.type,
          itemName: mainLedger.itemName,
          categoryName: mainLedger.categoryName,
          amount: mainLedger.amount,
          balance: mainLedger.balance,
          note: mainLedger.note,
          editorName: users.name,
          createdAt: mainLedger.createdAt,
        })
        .from(mainLedger)
        .leftJoin(users, eq(mainLedger.editedBy, users.id))
        .where(isNull(mainLedger.deletedAt))
        .orderBy(asc(mainLedger.id));

      const filtered = rows.filter(
        (r: any) => (!input?.dateFrom || r.createdAt >= input.dateFrom) && (!input?.dateTo || r.createdAt <= input.dateTo)
      );

      const csv = toCsv(
        ["編號", "日期", "類型", "項目", "名稱", "金額", "餘額", "編輯者", "備註"],
        filtered.map((r: any) => [
          r.id,
          formatDate(r.createdAt),
          TYPE_LABELS[r.type] ?? r.type,
          r.itemName,
          r.categoryName,
          r.amount,
          r.balance,
          r.editorName ?? "-",
          r.note ?? "",
        ])
      );

      return { filename: `母記帳表_${formatDate(Date.now())}.csv`, csv };
    }),

  /** 匯出教師/推銷者對帳單為 CSV（含一般分配、代墊入帳、代墊核銷） */
  exportRecipientStatementCsv: protectedProcedure
    .input(
      z.object({
        recipientType: recipientTypeSchema,
        recipientId: z.number(),
        dateFrom: z.number().optional(),
        dateTo: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      let { recipientType, recipientId } = input;

      if (ctx.user.role === "teacher_self") {
        if (recipientType !== "teacher" || recipientId !== ctx.user.linkedTeacherId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只能匯出自己的對帳單" });
        }
      } else if (ctx.user.role === "salesperson_self") {
        if (recipientType !== "salesperson" || recipientId !== ctx.user.linkedSalespersonId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只能匯出自己的對帳單" });
        }
      }

      const ledgerTable = (recipientType === "teacher" ? teacherLedger : salespersonLedger) as typeof teacherLedger;
      const recipientColumn = (recipientType === "teacher" ? teacherLedger.teacherId : salespersonLedger.salespersonId) as typeof teacherLedger.teacherId;

      const nameRows =
        recipientType === "teacher"
          ? await ctx.db.select({ name: teachers.name }).from(teachers).where(eq(teachers.id, recipientId)).limit(1)
          : await ctx.db.select({ name: salespeople.name }).from(salespeople).where(eq(salespeople.id, recipientId)).limit(1);
      const name = nameRows[0]?.name ?? `#${recipientId}`;

      const rows = await ctx.db.select().from(ledgerTable).where(eq(recipientColumn, recipientId)).orderBy(asc(ledgerTable.id));
      const filtered = rows.filter(
        (r: any) => (!input.dateFrom || r.createdAt >= input.dateFrom) && (!input.dateTo || r.createdAt <= input.dateTo)
      );

      const csv = toCsv(
        ["編號", "日期", "項目", "名稱", "來源", "類型", "原金額", "分潤比例", "個人金額", "私人餘額"],
        filtered.map((r: any) => [
          r.id,
          formatDate(r.createdAt),
          r.itemName,
          r.categoryName ?? "-",
          SOURCE_LABELS[r.sourceType] ?? r.sourceType,
          TYPE_LABELS[r.type] ?? r.type,
          r.originalAmount ?? "",
          r.originalAmount ? `${Math.round((r.personalAmount / r.originalAmount) * 100)}%` : "",
          r.personalAmount,
          r.personalBalance,
        ])
      );

      const label = recipientType === "teacher" ? "教師" : "推銷者";
      return { filename: `${label}對帳單_${name}_${formatDate(Date.now())}.csv`, csv };
    }),

  /** 匯出代墊記錄為 CSV */
  exportAdvancePaymentsCsv: protectedProcedure
    .input(z.object({ status: z.enum(["unsettled", "settled"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      let recipientType: "teacher" | "salesperson" | undefined;
      let recipientId: number | undefined;
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
      if (input?.status) conditions.push(eq(advancePayments.status, input.status));

      const rows = conditions.length
        ? await ctx.db.select().from(advancePayments).where(and(...conditions)).orderBy(desc(advancePayments.id))
        : await ctx.db.select().from(advancePayments).orderBy(desc(advancePayments.id));

      const teacherList = await ctx.db.select().from(teachers);
      const salespersonList = await ctx.db.select().from(salespeople);
      const nameOf = (type: string, id: number) =>
        (type === "teacher" ? teacherList : salespersonList).find((p: any) => p.id === id)?.name ?? `#${id}`;

      const csv = toCsv(
        ["編號", "建立日期", "身份", "對象", "項目", "金額", "狀態", "核銷來源", "備註"],
        rows.map((a: any) => [
          a.id,
          formatDate(a.createdAt),
          a.recipientType === "teacher" ? "教師" : "推銷者",
          nameOf(a.recipientType, a.recipientId),
          a.itemName,
          a.amount,
          a.status === "unsettled" ? "未核銷" : "已核銷",
          a.settledByMainLedgerId ? `母記帳表 #${a.settledByMainLedgerId}` : a.status === "settled" ? "獨立沖銷" : "-",
          a.note ?? "",
        ])
      );

      return { filename: `代墊記錄_${formatDate(Date.now())}.csv`, csv };
    }),
});
