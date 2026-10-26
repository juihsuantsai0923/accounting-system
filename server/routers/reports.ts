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
  users,
} from "../schema";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
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

export const reportsRouter = router({
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
      if (ctx.user.role === "teacher_self" || ctx.user.role === "salesperson_self") {
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
