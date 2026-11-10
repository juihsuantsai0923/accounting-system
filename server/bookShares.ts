import { and, eq, isNull } from "drizzle-orm";
import { books, ledgerDistribution, mainLedger, salespersonLedger, teacherLedger } from "./schema";
import { getRevenueSettings, teacherIdForSubject, vatOf } from "./revenueCalc";
import { recalculateBalance } from "./ledger";

/**
 * 書籍公積金比例改了之後，把舊帳的書籍分潤照新比例重算一次。
 *   每一筆含書籍的收入，依 breakdown（沒有就整筆）找出每一組書的金額 g，
 *   主理老師應得＝g − round(g ×（書籍公積金＋行政費）)，跟子記帳表「（書籍分潤）」那一列不同就改，分配表一起改。
 *   行政費那幾列不動（只重算老師那一份；行政費比例改了不回頭重算）。行事曆、運費、認不出科目的書本來就沒分潤，跳過。
 * 用了網紅碼的記錄是照售價分的，不用這裡的算法，整筆跳過。
 * dryRun 只算不寫。回傳每一項的新舊金額。
 */
export async function recalcBookShares(db: any, dryRun = false) {
  const settings = await getRevenueSettings(db);
  const notebookIds = new Set<number>(
    (await db.select({ id: books.id, kind: books.kind }).from(books)).filter((b: any) => b.kind === "notebook").map((b: any) => b.id)
  );
  const entries = (await db.select().from(mainLedger).where(and(isNull(mainLedger.deletedAt), eq(mainLedger.type, "income")))).filter(
    (e: any) => e.incomeSource === "book" || e.incomeSource === "mixed" || e.categoryName === "書籍"
  );

  const changes: { entryId: number; teacherId: number; name: string; amount: number; before: number; after: number }[] = [];
  const influencerEntries = new Set<number>(
    (await db.select().from(salespersonLedger)).filter((r: any) => String(r.itemName).endsWith("（網紅佣金）")).map((r: any) => r.mainLedgerId)
  );
  for (const e of entries) {
    if (influencerEntries.has(e.id)) continue;
    const parts: { source: string; name: string; categoryId: number; amount: number }[] = e.breakdown
      ? JSON.parse(e.breakdown)
      : e.incomeSource === "mixed"
        ? []
        : [{ source: "book", name: e.itemName, categoryId: e.categoryId, amount: e.amount }];
    const rows: any[] = await db.select().from(teacherLedger).where(eq(teacherLedger.mainLedgerId, e.id));
    for (const p of parts) {
      if (p.source !== "book" || p.name === "運費" || notebookIds.has(p.categoryId) || p.name.includes("行事曆")) continue;
      const teacherId = await teacherIdForSubject(db, p.name);
      if (!teacherId) continue;
      const row = rows.find((r) => r.teacherId === teacherId && r.sourceType === "distribution" && String(r.itemName).endsWith("（書籍分潤）"));
      if (!row) continue;
      // 登記日以後入帳的先扣營業稅再分（跟入帳時同一個算法）
      const net = p.amount - vatOf(settings, p.amount, e.createdAt);
      const after = net - Math.round(net * (settings.bookReserveRate + settings.adminFeeRate));
      if (after === row.personalAmount || after <= 0) continue;
      changes.push({ entryId: e.id, teacherId, name: p.name, amount: p.amount, before: row.personalAmount, after });
      if (dryRun) continue;
      await db.update(teacherLedger).set({ personalAmount: after, updatedAt: Date.now() }).where(eq(teacherLedger.id, row.id));
      const [dist] = await db
        .select()
        .from(ledgerDistribution)
        .where(
          and(
            eq(ledgerDistribution.mainLedgerId, e.id),
            eq(ledgerDistribution.distributionType, "teacher"),
            eq(ledgerDistribution.recipientId, teacherId),
            eq(ledgerDistribution.amount, row.personalAmount)
          )
        )
        .limit(1);
      if (dist) await db.update(ledgerDistribution).set({ amount: after }).where(eq(ledgerDistribution.id, dist.id));
    }
  }
  if (!dryRun) for (const id of new Set(changes.map((c) => c.teacherId))) await recalculateBalance(db, "teacher", id);
  return {
    bookReserveRate: settings.bookReserveRate,
    changes,
    /** 老師分潤合計變多少（負數＝回到公積金） */
    diff: changes.reduce((s, c) => s + c.after - c.before, 0),
  };
}
