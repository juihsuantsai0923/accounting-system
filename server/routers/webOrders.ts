import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { courses, mainLedger, webOrders } from "../schema";
import { asc, eq, isNull } from "drizzle-orm";
import { writeAudit } from "../ledger";

const DAY = 24 * 3600 * 1000;
/** 股東投入（例如創始基金）不是賣東西的收入，不跟官網訂單對 */
const NON_REVENUE_CATEGORIES = new Set(["創始基金"]);

export type ReconcileResult =
  | "receivable" // 官網待付款：應收帳款
  | "matched" // 記帳金額＝官網實付
  | "matched_gross" // 記帳記的是原價（官網實付＋折扣），折扣可能另記成支出
  | "mismatch" // 找到對應記錄但金額不同
  | "probable" // 姓名對不到，但同金額、日期相近的記帳記錄（多半是記帳時沒寫買家）
  | "missing" // 官網已付款，記帳找不到
  | "cancelled"
  | "ignored" // 手動標記不需入帳
  | "manual"; // 手動標記已確認

interface OrderItem {
  name: string;
  price: number;
  preorder: boolean;
  bundle: boolean;
}

/**
 * 官網訂單 ↔ 母記帳表對帳。
 * 比對方式：記帳的「項目」或「備註」裡有買家姓名、日期在下單前 3 天到下單後 60 天之間的收入。
 * 每筆記帳只會配給一張訂單（依下單時間先後）。金額等於官網實付＝相符；等於實付＋折扣＝記了原價。
 */
export const webOrdersRouter = router({
  reconcile: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === "teacher_self" || ctx.user.role === "salesperson_self") {
      throw new TRPCError({ code: "FORBIDDEN", message: "無權查看官網訂單" });
    }
    const orders = await ctx.db.select().from(webOrders).orderBy(asc(webOrders.orderedAt));
    const ledger = (await ctx.db.select().from(mainLedger).where(isNull(mainLedger.deletedAt)).orderBy(asc(mainLedger.id))).filter(
      (e: any) => e.type === "income" && !NON_REVENUE_CATEGORIES.has(e.categoryName)
    );
    const claimed = new Set<number>();
    const courseNames = new Set((await ctx.db.select({ name: courses.name }).from(courses)).map((c: any) => c.name));

    const result = orders.map((o: any) => {
      const items: OrderItem[] = JSON.parse(o.items);
      const base = { ...o, items, ledgerIds: [] as number[], ledgerAmount: 0, message: "" };
      const paid = o.tab === "completed" || (o.tab === "pending" && o.statusLabel !== "待付款");

      // 先把可能對應的記帳記錄配掉（就算手動標記，也要避免同一筆記帳被別張訂單用）
      let picked: any[] = [];
      if (paid) {
        const cands = ledger
          .filter(
            (e: any) =>
              !claimed.has(e.id) &&
              `${e.itemName} ${e.note ?? ""}`.includes(o.buyer) &&
              e.createdAt >= o.orderedAt - 3 * DAY &&
              e.createdAt <= o.orderedAt + 60 * DAY
          )
          .sort((a: any, b: any) => Math.abs(a.createdAt - o.orderedAt) - Math.abs(b.createdAt - o.orderedAt));
        const exact = cands.find((e: any) => e.amount === o.total || e.amount === o.total + o.discount);
        if (exact) picked = [exact];
        else if (cands.length) {
          const first = cands[0].createdAt;
          picked = cands.filter((e: any) => Math.abs(e.createdAt - first) <= 3 * DAY);
        }
        picked.forEach((e) => claimed.add(e.id));
      }
      const ledgerAmount = picked.reduce((s, e) => s + e.amount, 0);
      const withLedger = { ...base, ledgerIds: picked.map((e) => e.id), ledgerAmount };

      if (o.manualStatus === "ignored") return { ...withLedger, result: "ignored" as ReconcileResult, message: o.manualNote ?? "已標記不需入帳" };
      if (o.manualStatus === "matched") return { ...withLedger, result: "manual" as ReconcileResult, message: o.manualNote ?? "已人工確認" };
      if (o.tab === "cancelled") return { ...withLedger, result: "cancelled" as ReconcileResult };
      if (!paid) return { ...withLedger, result: "receivable" as ReconcileResult, message: "官網待付款" };
      if (!picked.length) return { ...withLedger, result: "missing" as ReconcileResult, message: "官網已付款，母記帳表找不到這位買家的收入" };
      if (ledgerAmount === o.total) return { ...withLedger, result: "matched" as ReconcileResult };
      if (o.discount && ledgerAmount === o.total + o.discount)
        return {
          ...withLedger,
          result: "matched_gross" as ReconcileResult,
          message: `記帳記原價 ${ledgerAmount}，官網實付 ${o.total}（折扣 ${o.discount}）；折扣要另記支出或改記實付金額`,
        };
      return { ...withLedger, result: "mismatch" as ReconcileResult, message: `記帳 ${ledgerAmount}，官網實付 ${o.total}，差 ${ledgerAmount - o.total}` };
    });

    // 第二輪：姓名對不到的訂單，找同金額、前後 7 天內、還沒被配走的記錄（記帳時常常沒寫買家姓名）
    for (const r of result as any[]) {
      if (r.result !== "missing") continue;
      const guess = ledger
        .filter(
          (e: any) =>
            !claimed.has(e.id) &&
            (e.amount === r.total || e.amount === r.total + r.discount) &&
            Math.abs(e.createdAt - r.orderedAt) <= 7 * DAY
        )
        .sort((a: any, b: any) => Math.abs(a.createdAt - r.orderedAt) - Math.abs(b.createdAt - r.orderedAt))[0];
      if (!guess) continue;
      claimed.add(guess.id);
      const d = new Date(guess.createdAt + 8 * 3600 * 1000);
      r.result = "probable";
      r.ledgerIds = [guess.id];
      r.ledgerAmount = guess.amount;
      r.message = `可能是 ${d.getUTCMonth() + 1}/${d.getUTCDate()} 的「${guess.itemName}」${guess.amount}（那筆記錄沒寫買家姓名）；確認後按「確認無誤」，或在那筆記錄的備註補上買家`;
    }

    // 記帳有、官網沒有：官網開始有訂單之後的課程／書籍收入，卻沒有配到任何訂單（可能是線下收款）
    const firstOrderAt = orders.length ? orders[0].orderedAt - 3 * DAY : Infinity;
    const offline = ledger
      .filter((e: any) => {
        if (claimed.has(e.id) || e.createdAt < firstOrderAt) return false;
        // 只看會在官網賣的東西：課程、小班家教、書籍；利息等其他收入不列
        if (e.incomeSource) return e.incomeSource !== "other";
        return courseNames.has(e.categoryName) || e.categoryName.includes("行事曆");
      })
      .map((e: any) => ({ id: e.id, createdAt: e.createdAt, itemName: e.itemName, categoryName: e.categoryName, amount: e.amount, note: e.note }));

    const receivableOrders = result.filter((r: any) => r.result === "receivable");
    return {
      syncedAt: orders.reduce((m: number, o: any) => Math.max(m, o.syncedAt), 0) || null,
      orders: result.reverse(),
      receivable: {
        total: receivableOrders.reduce((s: number, r: any) => s + r.total, 0),
        count: receivableOrders.length,
        oldestAt: receivableOrders.length ? Math.min(...receivableOrders.map((r: any) => r.orderedAt)) : null,
      },
      offline,
    };
  }),

  /** 手動標記：matched＝人工確認沒問題、ignored＝這張不需入帳、null＝取消標記 */
  setManualStatus: staffProcedure
    .input(z.object({ orderNo: z.string(), status: z.enum(["matched", "ignored"]).nullable(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [before] = await ctx.db.select().from(webOrders).where(eq(webOrders.orderNo, input.orderNo)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這張訂單" });
      await ctx.db
        .update(webOrders)
        .set({ manualStatus: input.status, manualNote: input.status ? input.note ?? null : null })
        .where(eq(webOrders.orderNo, input.orderNo));
      await writeAudit(ctx.db, ctx.user.id, "update", "webOrder", 0, before, { manualStatus: input.status, manualNote: input.note });
    }),
});
