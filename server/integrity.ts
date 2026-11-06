import { asc, isNull } from "drizzle-orm";
import { ledgerDistribution, mainLedger, salespersonLedger, teacherLedger } from "./schema";
import { ledgerDelta } from "./ledger";

/**
 * 帳務自我檢查：資料如果在系統外被改（例如直接在資料庫刪一筆），存著的餘額、分配表、子記帳表就會對不起來。
 *   1. 帳本每一筆存的 balance ＝ 從頭加總到這筆
 *   2. 每個人子記帳表每一筆存的 personal_balance ＝ 從頭加總到這筆
 *   3. 每筆帳本記錄的分配表合計 ＝ 子記帳表裡這筆的分潤合計；分配表、子記帳表不會掛在已刪除或不存在的記錄上
 * 回傳要顯示的問題（沒問題就是空陣列）。
 */
export async function checkIntegrity(db: any) {
  const issues: string[] = [];

  const entries: any[] = await db.select().from(mainLedger).where(isNull(mainLedger.deletedAt)).orderBy(asc(mainLedger.id));
  let running = 0;
  let badMain = 0;
  for (const e of entries) {
    running += e.type === "income" ? e.amount : -e.amount;
    if (e.balance !== running) badMain++;
  }
  if (badMain) issues.push(`帳本有 ${badMain} 筆存的餘額跟加總對不上（到「帳本」按「重新計算餘額」）`);

  const personal: { kind: string; rows: any[]; idOf: (r: any) => number }[] = [
    { kind: "教師", rows: await db.select().from(teacherLedger).orderBy(asc(teacherLedger.createdAt), asc(teacherLedger.id)), idOf: (r) => r.teacherId },
    { kind: "推銷者", rows: await db.select().from(salespersonLedger).orderBy(asc(salespersonLedger.createdAt), asc(salespersonLedger.id)), idOf: (r) => r.salespersonId },
  ];
  let badPersonal = 0;
  for (const { rows, idOf } of personal) {
    const sums = new Map<number, number>();
    for (const r of rows) {
      const s = (sums.get(idOf(r)) ?? 0) + ledgerDelta(r);
      sums.set(idOf(r), s);
      if (r.personalBalance !== s) badPersonal++;
    }
  }
  if (badPersonal) issues.push(`子記帳表有 ${badPersonal} 筆存的餘額跟加總對不上`);

  const alive = new Set(entries.map((e) => e.id));
  const distSum = new Map<number, number>();
  for (const d of await db.select().from(ledgerDistribution)) distSum.set(d.mainLedgerId, (distSum.get(d.mainLedgerId) ?? 0) + d.amount);
  const subSum = new Map<number, number>();
  for (const { rows } of personal)
    for (const r of rows)
      if (r.sourceType === "distribution" && r.mainLedgerId != null) subSum.set(r.mainLedgerId, (subSum.get(r.mainLedgerId) ?? 0) + r.personalAmount);
  const ids = new Set([...distSum.keys(), ...subSum.keys()]);
  const orphan = [...ids].filter((id) => !alive.has(id));
  const mismatch = [...ids].filter((id) => alive.has(id) && (distSum.get(id) ?? 0) !== (subSum.get(id) ?? 0));
  if (orphan.length) issues.push(`有 ${orphan.length} 筆分潤掛在已刪除的帳本記錄上（#${orphan.slice(0, 5).join("、#")}）`);
  if (mismatch.length) issues.push(`有 ${mismatch.length} 筆帳本記錄的分配表跟子記帳表金額不同（#${mismatch.slice(0, 5).join("、#")}）`);

  return issues;
}
