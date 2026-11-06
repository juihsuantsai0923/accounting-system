import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { advancePayments, advanceCategories, teacherLedger, salespersonLedger, expenseTypes, mainLedger, shippers, webOrders } from "../schema";
import { and, count, desc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import { getCurrentBalance, recalculateBalance, writeAudit } from "../ledger";
import { getLatestBalance } from "./mainLedger";
import { money, sendLine } from "../lineNotify";

const recipientTypeSchema = z.enum(["teacher", "salesperson", "shipper"]);
type AdvanceRow = typeof advancePayments.$inferSelect;

const fieldsInput = {
  orderName: z.string().trim().max(200).optional(),
  orderNo: z.string().trim().max(50).optional(),
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

/** 代墊類別對應到帳本的支出類型（出貨員代墊核銷時用）；「其他」併進既有的「其他支出」 */
export function expenseTypeNameFor(category: string) {
  return category === "其他" ? "其他支出" : category;
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

/** 教師、推銷者的代墊審核通過（或管理員直接登記）才寫進子記帳表；出貨員沒有分潤，直接用代墊紀錄本身 */
async function addToSubLedger(db: any, userId: number, advance: AdvanceRow) {
  if (advance.recipientType === "shipper") return;
  const type = advance.recipientType as "teacher" | "salesperson";
  const recipientColumn = type === "teacher" ? "teacherId" : "salespersonId";
  const currentBalance = await getCurrentBalance(db, type, advance.recipientId);
  await db.insert(ledgerTableOf(type)).values({
    [recipientColumn]: advance.recipientId,
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

/**
 * 出貨員代墊核銷：公司把錢還給出貨員，這時候才是公司的支出。
 * 依類別各記一筆帳本支出（運費、其他支出…），代墊標成已核銷並連到那筆支出；之後刪掉那筆支出，代墊會自動退回未核銷。
 */
export async function settleShipperAdvances(db: any, userId: number, list: AdvanceRow[]) {
  if (!list.length) return [];
  const [shipper] = await db.select().from(shippers).where(eq(shippers.id, list[0].recipientId)).limit(1);
  const shipperName = shipper?.name ?? `#${list[0].recipientId}`;
  const groups = new Map<string, AdvanceRow[]>();
  for (const a of list) {
    const key = expenseTypeNameFor(a.category || "其他");
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const entries = [];
  for (const [typeName, rows] of groups) {
    let [type] = await db.select().from(expenseTypes).where(eq(expenseTypes.name, typeName)).limit(1);
    if (!type) [type] = await db.insert(expenseTypes).values({ name: typeName }).returning();
    const amount = rows.reduce((s, a) => s + a.amount, 0);
    const prev = await getLatestBalance(db);
    const [entry] = await db
      .insert(mainLedger)
      .values({
        type: "expense",
        itemName: `出貨員代墊－${typeName}（${shipperName}，${rows.length} 筆）`,
        categoryId: type.id,
        categoryName: type.name,
        amount,
        balance: prev - amount,
        note: rows.map((a) => `${a.orderName || a.buyer || a.itemName} ${a.amount}`).join("；"),
        editedBy: userId,
        editedAt: Date.now(),
      })
      .returning();
    for (const a of rows) {
      await db
        .update(advancePayments)
        .set({ status: "settled", settledByMainLedgerId: entry.id, settledAt: Date.now(), updatedAt: Date.now() })
        .where(eq(advancePayments.id, a.id));
      await writeAudit(db, userId, "settle", "advancePayment", a.id, a, { status: "settled", settledByMainLedgerId: entry.id });
    }
    await writeAudit(db, userId, "create", "mainLedger", entry.id, null, entry);
    entries.push(entry);
  }
  return entries;
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

  /** 一次寄很多件：勾選多張訂單一起登記，每張一筆代墊，同一類別；要審核的只發一則 LINE */
  createBatch: protectedProcedure
    .input(
      z.object({
        recipientType: recipientTypeSchema.optional(),
        recipientId: z.number().optional(),
        category: fieldsInput.category,
        note: fieldsInput.note,
        // 每筆約 4 次資料庫操作，留在 Worker 單次請求的查詢上限內
        items: z
          .array(z.object({ orderName: fieldsInput.orderName, orderNo: fieldsInput.orderNo, buyer: fieldsInput.buyer, amount: fieldsInput.amount }))
          .min(1, "請至少勾選一張訂單")
          .max(150, "一次最多 150 筆"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const who = resolveRecipient(ctx, input);
      const amounts = input.items.map((i) => parseInt(i.amount, 10));
      if (amounts.some((a) => a <= 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "每筆代墊金額都要大於 0" });

      await ensureCategory(ctx.db, input.category);
      for (let i = 0; i < input.items.length; i++) {
        await insertAdvance(ctx, who, { ...input.items[i], category: input.category, note: input.note }, amounts[i]);
      }
      const total = amounts.reduce((s, a) => s + a, 0);
      if (needsReview(ctx.user)) await notifyReview(ctx, { category: input.category, amount: total, orderName: `共 ${amounts.length} 筆` }, "有新的代墊等你審核");
      return { count: amounts.length, total };
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

    if (advance.recipientType !== "shipper") {
      const tbl = ledgerTableOf(advance.recipientType);
      const row = and(eq(tbl.advancePaymentId, advance.id), eq(tbl.sourceType, "advance"));
      if (review) await db.delete(tbl).where(row);
      else await db.update(tbl).set({ itemName, originalAmount: amount, personalAmount: amount, updatedAt: Date.now() }).where(row);
      if (review || amount !== advance.amount) await recalculateBalance(db, advance.recipientType as "teacher" | "salesperson", advance.recipientId);
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

  /** 填代墊時可以選的官網訂單（最近 120 天、沒取消的）；只給訂單編號、日期、下訂人姓名、品項 */
  orderOptions: protectedProcedure.query(async ({ ctx }) => {
    if (!["super_admin", "shipper_self"].includes(ctx.user.role)) return [];
    const since = Date.now() - 120 * 86400_000;
    const rows = await ctx.db.select().from(webOrders).where(gte(webOrders.orderedAt, since)).orderBy(desc(webOrders.orderedAt));
    // 這張訂單已經登記過哪些類別（退回的不算），多筆登記時提醒不要重複
    const existing = await ctx.db
      .select({ orderNo: advancePayments.orderNo, category: advancePayments.category })
      .from(advancePayments)
      .where(and(isNotNull(advancePayments.orderNo), ne(advancePayments.reviewStatus, "rejected")));
    const registered = new Map<string, string[]>();
    for (const a of existing) if (a.orderNo && a.category) registered.set(a.orderNo, [...(registered.get(a.orderNo) ?? []), a.category]);
    return rows
      .filter((o: any) => o.tab !== "cancelled")
      .map((o: any) => {
        let items: string[] = [];
        try {
          items = (JSON.parse(o.items) as { name: string }[]).map((i) => i.name);
        } catch {}
        return { orderNo: o.orderNo as string, orderedAt: o.orderedAt as number, buyer: o.buyer as string, items, registeredCategories: registered.get(o.orderNo) ?? [] };
      });
  }),

  settle: staffProcedure
    .input(z.object({ id: z.number(), mainLedgerId: z.number().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const [advance] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
      if (!advance) throw new TRPCError({ code: "NOT_FOUND", message: "代墊記錄不存在" });
      if (advance.status !== "unsettled") throw new TRPCError({ code: "BAD_REQUEST", message: "此代墊已核銷" });
      if (advance.reviewStatus !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "這筆代墊還沒審核通過" });

      if (advance.recipientType === "shipper") {
        await settleShipperAdvances(db, ctx.user.id, [advance]);
        const [updated] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
        return updated;
      }

      const mainLedgerId = input.mainLedgerId ?? null;

      await db
        .update(advancePayments)
        .set({ status: "settled", settledByMainLedgerId: mainLedgerId, settledAt: Date.now(), updatedAt: Date.now() })
        .where(eq(advancePayments.id, input.id));

      // 情境 B：非併入正式撥款，需另外建立沖銷分錄
      if (!mainLedgerId) {
        const ledgerTable = ledgerTableOf(advance.recipientType);
        const recipientColumn = advance.recipientType === "teacher" ? "teacherId" : "salespersonId";
        const currentBalance = await getCurrentBalance(db, advance.recipientType as "teacher" | "salesperson", advance.recipientId);

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

      await writeAudit(db, ctx.user.id, "settle", "advancePayment", input.id, advance, { status: "settled", mainLedgerId });
      const [updated] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
      return updated;
    }),

  /** 一次還清某位出貨員所有（或勾選的）未核銷代墊 */
  settleShipper: staffProcedure
    .input(z.object({ shipperId: z.number(), ids: z.array(z.number()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const conditions = [
        eq(advancePayments.recipientType, "shipper"),
        eq(advancePayments.recipientId, input.shipperId),
        eq(advancePayments.status, "unsettled"),
        eq(advancePayments.reviewStatus, "approved"),
      ];
      if (input.ids?.length) conditions.push(inArray(advancePayments.id, input.ids));
      const list = await ctx.db.select().from(advancePayments).where(and(...conditions));
      if (!list.length) throw new TRPCError({ code: "BAD_REQUEST", message: "沒有未核銷的代墊" });
      const entries = await settleShipperAdvances(ctx.db, ctx.user.id, list);
      return { count: list.length, total: list.reduce((s: number, a: AdvanceRow) => s + a.amount, 0), entries: entries.length };
    }),

  unsettle: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = ctx.db;
    const [advance] = await db.select().from(advancePayments).where(eq(advancePayments.id, input.id)).limit(1);
    if (!advance) throw new TRPCError({ code: "NOT_FOUND", message: "代墊記錄不存在" });
    if (advance.status !== "settled") throw new TRPCError({ code: "BAD_REQUEST", message: "此代墊尚未核銷" });
    if (advance.recipientType === "shipper" && advance.settledByMainLedgerId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `這筆是跟帳本 #${advance.settledByMainLedgerId} 一起核銷的，請到帳本刪除那筆支出，裡面的代墊會一起退回未核銷`,
      });
    }

    if (advance.recipientType !== "shipper") {
      const ledgerTable = ledgerTableOf(advance.recipientType);
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

    if (advance.recipientType !== "shipper") {
      await recalculateBalance(db, advance.recipientType as "teacher" | "salesperson", advance.recipientId);
    }
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

    if (advance.recipientType !== "shipper") {
      const ledgerTable = ledgerTableOf(advance.recipientType);
      await db.delete(ledgerTable).where(eq(ledgerTable.advancePaymentId, advance.id));
    }
    await db.delete(advancePayments).where(eq(advancePayments.id, input.id));

    if (advance.recipientType !== "shipper") {
      await recalculateBalance(db, advance.recipientType as "teacher" | "salesperson", advance.recipientId);
    }
    await writeAudit(db, ctx.user.id, "delete", "advancePayment", input.id, advance, null);
  }),
});
