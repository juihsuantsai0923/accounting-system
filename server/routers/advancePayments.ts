import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { advancePayments, advanceCategories, teacherLedger, salespersonLedger, salespeople, shippers, webOrders } from "../schema";
import { and, count, desc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import { getCurrentBalance, recalculateBalance, writeAudit } from "../ledger";
import { money, sendLine } from "../lineNotify";

const recipientTypeSchema = z.enum(["teacher", "salesperson", "shipper"]);
type AdvanceRow = typeof advancePayments.$inferSelect;

const fieldsInput = {
  orderName: z.string().trim().max(200).optional(),
  orderNo: z.string().trim().max(3000).optional(), // 多張訂單合成一筆時用逗號分隔
  buyer: z.string().trim().max(50).optional(),
  category: z.string().trim().min(1, "請選類別").max(30),
  amount: z.string().regex(/^\d+$/, "金額必須為整數"),
  note: z.string().optional(),
  /** 手動記帳頁的代墊沿用自己打的項目名稱；代墊管理頁不給，自動組成 */
  itemName: z.string().trim().max(200).optional(),
};

/** 代墊項目名稱沿用舊格式「下訂人_類別」（沒有下訂人就用訂單名稱） */
export function advanceItemName(f: { buyer?: string | null; orderName?: string | null; category: string }) {
  const who = f.buyer?.trim() || f.orderName?.trim();
  return who ? `${who}_${f.category}` : f.category;
}

/** 多張訂單合成一筆代墊的欄位：訂單編號用逗號分隔，下訂人去掉重複（同一人下兩張算一人） */
export function batchOrderFields(orders: { orderNo: string; buyer: string; orderName?: string }[]) {
  const buyers = [...new Set(orders.map((o) => o.buyer.trim()).filter(Boolean))];
  const orderName = orders.length === 1 ? orders[0].orderName : `${orders.length} 張訂單：${buyers.join("、")}`;
  const buyer = buyers.length > 1 ? `${buyers[0]} 等 ${buyers.length} 人` : buyers[0];
  return { orderNo: orders.map((o) => o.orderNo).join(","), orderName: orderName?.slice(0, 200), buyer: buyer?.slice(0, 50) };
}

async function ensureCategory(db: any, name: string) {
  const [found] = await db.select().from(advanceCategories).where(eq(advanceCategories.name, name)).limit(1);
  if (!found) await db.insert(advanceCategories).values({ name });
}

/** 老師、出貨員自己登記的代墊要管理員審核；管理員切成老師身分登記的不用 */
function needsReview(user: any) {
  return user.role !== "super_admin" && user.realRole !== "super_admin";
}

/** 老師、出貨員只能動自己的、還沒核銷的代墊；管理員可以動所有沒核銷的 */
function assertCanEdit(user: any, advance: AdvanceRow) {
  if (user.role === "shipper_self" || user.role === "teacher_self") {
    const [type, id] = user.role === "shipper_self" ? ["shipper", user.linkedShipperId] : ["teacher", user.linkedTeacherId];
    if (advance.recipientType !== type || advance.recipientId !== id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只能修改自己的代墊" });
    }
  } else if (user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有系統管理員可以修改帳目" });
  }
  if (advance.status !== "unsettled") throw new TRPCError({ code: "BAD_REQUEST", message: "已核銷的代墊不能修改" });
}

function ledgerTableOf(type: string) {
  return (type === "teacher" ? teacherLedger : salespersonLedger) as typeof teacherLedger;
}

/**
 * 代墊記在哪個子記帳表：教師、推銷者記自己的；出貨員記在同名的推銷者底下（行政費分潤也在那裡，沒有就建一個）。
 * 代墊一律累積在積欠薪水，跟薪水一起發，沒有另外的核銷。
 */
export async function subLedgerOf(db: any, advance: { recipientType: string; recipientId: number }): Promise<{ type: "teacher" | "salesperson"; id: number }> {
  if (advance.recipientType !== "shipper") return { type: advance.recipientType as "teacher" | "salesperson", id: advance.recipientId };
  const [shipper] = await db.select().from(shippers).where(eq(shippers.id, advance.recipientId)).limit(1);
  const name = shipper?.name ?? `出貨員 #${advance.recipientId}`;
  let [person] = await db.select().from(salespeople).where(eq(salespeople.name, name)).limit(1);
  if (!person) [person] = await db.insert(salespeople).values({ name }).returning();
  return { type: "salesperson", id: person.id };
}

/** 代墊審核通過（或管理員直接登記）才寫進子記帳表，算進積欠薪水 */
export async function addToSubLedger(db: any, userId: number, advance: AdvanceRow) {
  const { type, id } = await subLedgerOf(db, advance);
  const recipientColumn = type === "teacher" ? "teacherId" : "salespersonId";
  const currentBalance = await getCurrentBalance(db, type, id);
  await db.insert(ledgerTableOf(type)).values({
    [recipientColumn]: id,
    mainLedgerId: null,
    advancePaymentId: advance.id,
    sourceType: "advance",
    type: "advance",
    itemName: advance.itemName,
    categoryId: null,
    categoryName: "代墊款",
    originalAmount: advance.amount,
    personalAmount: advance.amount,
    personalBalance: currentBalance + advance.amount,
    editedBy: userId,
  } as any);
}

/** 誰的代墊：老師、出貨員只能是自己；管理員要指定 */
function resolveRecipient(ctx: any, input: { recipientType?: "teacher" | "salesperson" | "shipper"; recipientId?: number }) {
  let { recipientType, recipientId } = input;
  if (ctx.user.role === "shipper_self") {
    if (!ctx.user.linkedShipperId) throw new TRPCError({ code: "FORBIDDEN", message: "這個帳號還沒綁定出貨員，請找管理員設定" });
    recipientType = "shipper";
    recipientId = ctx.user.linkedShipperId;
  } else if (ctx.user.role === "teacher_self") {
    if (!ctx.user.linkedTeacherId) throw new TRPCError({ code: "FORBIDDEN", message: "這個帳號還沒綁定教師，請找管理員設定" });
    recipientType = "teacher";
    recipientId = ctx.user.linkedTeacherId;
  } else if (ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有系統管理員可以修改帳目" });
  }
  if (!recipientType || !recipientId) throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇代墊的人" });
  return { recipientType, recipientId };
}

/** 寫入一筆代墊：要審核的先待審，不用審核的直接進子記帳表 */
async function insertAdvance(
  ctx: any,
  who: { recipientType: string; recipientId: number },
  f: { itemName?: string; orderName?: string; orderNo?: string; buyer?: string; category: string; note?: string },
  amount: number
) {
  const review = needsReview(ctx.user);
  const [advance] = await ctx.db
    .insert(advancePayments)
    .values({
      ...who,
      itemName: f.itemName || advanceItemName(f),
      orderName: f.orderName || null,
      orderNo: f.orderNo || null,
      buyer: f.buyer || null,
      category: f.category,
      amount,
      reviewStatus: review ? "pending" : "approved",
      note: f.note || null,
      editedBy: ctx.user.id,
    })
    .returning();
  if (!review) await addToSubLedger(ctx.db, ctx.user.id, advance);
  await writeAudit(ctx.db, ctx.user.id, "create", "advancePayment", advance.id, null, advance);
  return advance;
}

async function notifyReview(ctx: any, a: { orderName?: string | null; buyer?: string | null; category?: string | null; amount: number }, title: string) {
  await sendLine(
    ctx.line ?? {},
    [
      `🔔 ${title}`,
      `${ctx.user.name ?? "有人"}：${a.category ?? ""} ${money(a.amount)}`,
      a.orderName ? `訂單：${a.orderName}` : "",
      a.buyer ? `下訂人：${a.buyer}` : "",
      "到「代墊管理」審核",
    ]
      .filter(Boolean)
      .join("\n")
  ).catch(() => null);
}

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
      } else if (ctx.user.role === "shipper_self") {
        recipientType = "shipper";
        recipientId = ctx.user.linkedShipperId ?? -1;
      }

      const conditions = [] as any[];
      if (recipientType) conditions.push(eq(advancePayments.recipientType, recipientType));
      if (recipientId !== undefined) conditions.push(eq(advancePayments.recipientId, recipientId));
      if (status) conditions.push(eq(advancePayments.status, status));

      const query = conditions.length
        ? ctx.db.select().from(advancePayments).where(and(...conditions))
        : ctx.db.select().from(advancePayments);

      return query.orderBy(desc(advancePayments.id));
    }),

  /** 管理員可以替任何人新增；老師、出貨員只能新增自己的，要等管理員審核 */
  create: protectedProcedure
    .input(z.object({ recipientType: recipientTypeSchema.optional(), recipientId: z.number().optional(), ...fieldsInput }))
    .mutation(async ({ ctx, input }) => {
      const who = resolveRecipient(ctx, input);
      const amount = parseInt(input.amount, 10);
      if (amount <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "代墊金額必須大於 0" });

      await ensureCategory(ctx.db, input.category);
      const advance = await insertAdvance(ctx, who, input, amount);
      if (advance.reviewStatus === "pending") await notifyReview(ctx, advance, "有新的代墊等你審核");
      return advance;
    }),

  /** 一次寄很多件：勾選多張訂單，填這批的總金額，記成一筆代墊（訂單可能合併寄出，不分攤到每張） */
  createBatch: protectedProcedure
    .input(
      z.object({
        recipientType: recipientTypeSchema.optional(),
        recipientId: z.number().optional(),
        category: fieldsInput.category,
        note: fieldsInput.note,
        amount: fieldsInput.amount,
        orders: z
          .array(z.object({ orderName: fieldsInput.orderName, orderNo: z.string().trim().min(1).max(50), buyer: z.string().trim().max(50) }))
          .min(1, "請至少勾選一張訂單")
          .max(150, "一次最多 150 張"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const who = resolveRecipient(ctx, input);
      const amount = parseInt(input.amount, 10);
      if (amount <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "代墊總金額必須大於 0" });

      await ensureCategory(ctx.db, input.category);
      const advance = await insertAdvance(ctx, who, { ...batchOrderFields(input.orders), category: input.category, note: input.note }, amount);
      if (advance.reviewStatus === "pending") await notifyReview(ctx, advance, "有新的代墊等你審核");
      return { count: input.orders.length, total: amount };
    }),

  update: protectedProcedure.input(z.object({ id: z.number(), ...fieldsInput })).mutation(async ({ ctx, input }) => {
    const db = ctx.db;
    const [advance] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
    if (!advance) throw new TRPCError({ code: "NOT_FOUND", message: "代墊記錄不存在" });
    assertCanEdit(ctx.user, advance);
    const amount = parseInt(input.amount, 10);
    if (amount <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "代墊金額必須大於 0" });

    await ensureCategory(db, input.category);
    const itemName = input.itemName || advanceItemName(input);
    // 本人修改後要重新審核，之前通過時寫進子記帳表的那行先拿掉
    const review = needsReview(ctx.user);
    const patch = {
      ...(review ? { reviewStatus: "pending", reviewNote: null } : {}),
      itemName,
      orderName: input.orderName || null,
      orderNo: input.orderNo || null,
      buyer: input.buyer || null,
      category: input.category,
      amount,
      note: input.note || null,
      editedBy: ctx.user.id,
      updatedAt: Date.now(),
    };
    await db.update(advancePayments).set(patch).where(eq(advancePayments.id, input.id));

    {
      const target = await subLedgerOf(db, advance);
      const tbl = ledgerTableOf(target.type);
      const row = and(eq(tbl.advancePaymentId, advance.id), eq(tbl.sourceType, "advance"));
      if (review) await db.delete(tbl).where(row);
      else await db.update(tbl).set({ itemName, originalAmount: amount, personalAmount: amount, updatedAt: Date.now() }).where(row);
      if (review || amount !== advance.amount) await recalculateBalance(db, target.type, target.id);
    }
    if (review) await notifyReview(ctx, { ...input, amount }, "有代墊修改後等你重新審核");
    await writeAudit(db, ctx.user.id, "update", "advancePayment", input.id, advance, { ...advance, ...patch });
    return { ok: true };
  }),

  /** 待審核筆數（畫面右下角提醒、每日 LINE） */
  pendingReviewCount: staffProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db.select({ n: count() }).from(advancePayments).where(eq(advancePayments.reviewStatus, "pending"));
    return row?.n ?? 0;
  }),

  /** 管理員審核：通過才算公司欠的錢（教師代墊這時才進子記帳表）；退回要本人改完重送或刪除 */
  review: staffProcedure
    .input(z.object({ id: z.number(), approve: z.boolean(), note: z.string().trim().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const [advance] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
      if (!advance) throw new TRPCError({ code: "NOT_FOUND", message: "代墊記錄不存在" });
      if (advance.reviewStatus !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "這筆代墊已經審核過了" });
      const patch = { reviewStatus: input.approve ? "approved" : "rejected", reviewNote: input.approve ? null : input.note || null, updatedAt: Date.now() };
      await db.update(advancePayments).set(patch).where(eq(advancePayments.id, input.id));
      if (input.approve) await addToSubLedger(db, ctx.user.id, advance);
      await writeAudit(db, ctx.user.id, "review", "advancePayment", input.id, advance, { ...advance, ...patch });
      return { ok: true };
    }),

  categories: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(advanceCategories).orderBy(advanceCategories.id);
  }),

  addCategory: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(30) })).mutation(async ({ ctx, input }) => {
    if (!["super_admin", "shipper_self", "teacher_self"].includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "沒有權限新增類別" });
    await ensureCategory(ctx.db, input.name);
    return { name: input.name };
  }),

  deleteCategory: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(advanceCategories).where(eq(advanceCategories.id, input.id));
  }),

  /** 填代墊時可以選的官網訂單（最近 120 天、沒取消的；已完成的只列最近 30 天下訂的，標 completed）；只給訂單編號、日期、下訂人姓名、品項 */
  orderOptions: protectedProcedure.query(async ({ ctx }) => {
    if (!["super_admin", "shipper_self"].includes(ctx.user.role)) return [];
    const since = Date.now() - 120 * 86400_000;
    // 官網沒有完成時間，用下訂日期判斷：30 天內下訂、已完成的訂單也列出（例如寄出後很快就完成的）
    const completedSince = Date.now() - 30 * 86400_000;
    const rows = await ctx.db.select().from(webOrders).where(gte(webOrders.orderedAt, since)).orderBy(desc(webOrders.orderedAt));
    // 這張訂單已經登記過哪些類別（退回的不算），多筆登記時提醒不要重複
    const existing = await ctx.db
      .select({ orderNo: advancePayments.orderNo, category: advancePayments.category })
      .from(advancePayments)
      .where(and(isNotNull(advancePayments.orderNo), ne(advancePayments.reviewStatus, "rejected")));
    const registered = new Map<string, string[]>();
    for (const a of existing) {
      if (!a.orderNo || !a.category) continue;
      for (const no of a.orderNo.split(",")) registered.set(no, [...(registered.get(no) ?? []), a.category]);
    }
    return rows
      .filter((o: any) => o.tab !== "cancelled" && (o.tab !== "completed" || o.orderedAt >= completedSince))
      .map((o: any) => {
        let items: string[] = [];
        try {
          items = (JSON.parse(o.items) as { name: string }[]).map((i) => i.name);
        } catch {}
        return {
          orderNo: o.orderNo as string,
          orderedAt: o.orderedAt as number,
          buyer: o.buyer as string,
          items,
          completed: o.tab === "completed",
          trackingCode: (o.trackingCode as string | null) ?? null,
          registeredCategories: registered.get(o.orderNo) ?? [],
        };
      });
  }),

  unsettle: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = ctx.db;
    const [advance] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
    if (!advance) throw new TRPCError({ code: "NOT_FOUND", message: "代墊記錄不存在" });
    if (advance.status !== "settled") throw new TRPCError({ code: "BAD_REQUEST", message: "此代墊尚未核銷" });
    const target = await subLedgerOf(db, advance);
    {
      const ledgerTable = ledgerTableOf(target.type);
      // 刪除獨立沖銷分錄（情境 B 產生的）
      const settlementRows = await db
        .select()
        .from(ledgerTable)
        .where(and(eq(ledgerTable.advancePaymentId, advance.id), eq(ledgerTable.sourceType, "advance_settlement")));
      for (const row of settlementRows) {
        await db.delete(ledgerTable).where(eq(ledgerTable.id, row.id));
      }
    }

    await db
      .update(advancePayments)
      .set({ status: "unsettled", settledByMainLedgerId: null, settledAt: null, updatedAt: Date.now() })
      .where(eq(advancePayments.id, input.id));

    await recalculateBalance(db, target.type, target.id);
    await writeAudit(db, ctx.user.id, "unsettle", "advancePayment", input.id, advance, { status: "unsettled" });

    const [updated] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
    return updated;
  }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = ctx.db;
    const [advance] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
    if (!advance) throw new TRPCError({ code: "NOT_FOUND", message: "代墊記錄不存在" });
    if (advance.status === "settled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "已核銷的代墊需先取消核銷才能刪除" });
    }
    assertCanEdit(ctx.user, advance);

    const target = await subLedgerOf(db, advance);
    const ledgerTable = ledgerTableOf(target.type);
    await db.delete(ledgerTable).where(eq(ledgerTable.advancePaymentId, advance.id));
    await db.delete(advancePayments).where(eq(advancePayments.id, input.id));
    await recalculateBalance(db, target.type, target.id);
    await writeAudit(db, ctx.user.id, "delete", "advancePayment", input.id, advance, null);
  }),
});
