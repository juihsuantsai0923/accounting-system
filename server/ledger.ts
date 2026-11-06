import { teacherLedger, salespersonLedger, auditLog, mainLedger, advancePayments } from "./schema";
import { eq, asc, isNull } from "drizzle-orm";

type Recipient = "teacher" | "salesperson";

function table(recipientType: Recipient) {
  return recipientType === "teacher" ? teacherLedger : salespersonLedger;
}

function idColumn(recipientType: Recipient) {
  const tbl = table(recipientType);
  return recipientType === "teacher"
    ? (tbl as typeof teacherLedger).teacherId
    : (tbl as typeof salespersonLedger).salespersonId;
}

/** 依 sourceType/type 決定這筆分錄對餘額的正負影響 */
export function ledgerDelta(row: { sourceType: string; type: string; personalAmount: number }): number {
  if (row.sourceType === "advance") return row.personalAmount;
  if (row.sourceType === "advance_settlement") return -row.personalAmount;
  // distribution
  return row.type === "income" ? row.personalAmount : -row.personalAmount;
}

/**
 * 這些函式都改成接收 db 當第一個參數（而不是在模組頂層 import 一個固定的 db 單例），
 * 這樣同一套邏輯才能同時用在 Express（better-sqlite3）和 Cloudflare Worker（D1）
 * 兩種環境——D1 的連線只能在每次請求時透過 env 綁定取得，沒辦法在模組載入時就建立好。
 */

/** 重新計算某位教師/推銷者的所有子記帳表累計餘額（依時間排序累加） */
export async function recalculateBalance(db: any, recipientType: Recipient, recipientId: number) {
  const tbl = table(recipientType) as typeof teacherLedger;
  const col = idColumn(recipientType) as typeof teacherLedger.teacherId;
  const rows = await db.select().from(tbl).where(eq(col, recipientId)).orderBy(asc(tbl.createdAt), asc(tbl.id));

  let running = 0;
  for (const row of rows) {
    running += ledgerDelta(row);
    // 只寫有變的：一張訂單同一人會有好幾筆分潤，每次都全部重寫會超過 Worker 單次請求的查詢上限，重算到一半就中斷
    if (row.personalBalance === running) continue;
    await db.update(tbl).set({ personalBalance: running, updatedAt: Date.now() }).where(eq(tbl.id, row.id));
  }
  return running;
}

/**
 * 重新計算母記帳表（main_ledger）所有未刪除記錄的累計餘額（依 id 排序累加）。
 *
 * 之前的邏輯只在「新增」當下，用「當時最新一筆的 balance + / - 這筆金額」計算單一一筆的 balance，
 * 從未在「刪除」之後，回頭重算被刪除那筆之後所有記錄的 balance 欄位——
 * 導致刪除中間某一筆記錄後，後面所有記錄儲存的 balance 都還停留在「包含已被刪除那筆」的舊數字，
 * 跟儀表板上即時重新加總算出來的「累計收入－累計支出」對不起來。
 * 所以刪除（以及任何可能影響歷史記錄的操作）之後都必須呼叫這個函式，從頭重新加總一次。
 */
export async function recalculateMainLedgerBalance(db: any) {
  const rows = await db.select().from(mainLedger).where(isNull(mainLedger.deletedAt)).orderBy(asc(mainLedger.id));

  let running = 0;
  for (const row of rows) {
    running += row.type === "income" ? row.amount : -row.amount;
    if (row.balance === running) continue;
    await db.update(mainLedger).set({ balance: running, updatedAt: Date.now() }).where(eq(mainLedger.id, row.id));
  }
  return running;
}

export async function getCurrentBalance(db: any, recipientType: Recipient, recipientId: number): Promise<number> {
  const tbl = table(recipientType) as typeof teacherLedger;
  const col = idColumn(recipientType) as typeof teacherLedger.teacherId;
  const rows = await db.select().from(tbl).where(eq(col, recipientId)).orderBy(asc(tbl.createdAt), asc(tbl.id));
  if (rows.length === 0) return 0;
  return rows[rows.length - 1].personalBalance;
}

/**
 * 帳本每一筆記完後的剩餘公積金，跟儀表板公積金同一個算法：帳上餘額 − 公司欠所有人的錢（含代墊）。
 * 分配、核銷跟著所屬的帳本記錄算；沒掛在帳本記錄上的（代墊入帳）依時間算進下一筆。
 * current＝現在的公積金，包含最後一筆帳本記錄之後才發生的代墊。
 */
export async function reserveTrail(db: any) {
  const entries: { id: number; type: string; amount: number; createdAt: number }[] = await db
    .select({ id: mainLedger.id, type: mainLedger.type, amount: mainLedger.amount, createdAt: mainLedger.createdAt })
    .from(mainLedger)
    .where(isNull(mainLedger.deletedAt))
    .orderBy(asc(mainLedger.id));
  const ids = new Set(entries.map((e) => e.id));
  const linked = new Map<number, number>();
  const timed: { at: number; delta: number }[] = [];
  const addOwed = (mainLedgerId: number | null, at: number, delta: number) => {
    if (mainLedgerId != null && ids.has(mainLedgerId)) linked.set(mainLedgerId, (linked.get(mainLedgerId) ?? 0) + delta);
    else timed.push({ at, delta });
  };
  for (const tbl of [teacherLedger, salespersonLedger]) {
    const rows = await db.select().from(tbl);
    for (const r of rows as any[]) addOwed(r.mainLedgerId, r.createdAt, ledgerDelta(r));
  }
  // 出貨員沒有子記帳表，欠他的錢直接看代墊：審核通過算欠款，核銷時還掉
  const shipperAdvances: any[] = await db.select().from(advancePayments).where(eq(advancePayments.recipientType, "shipper"));
  for (const a of shipperAdvances) {
    if (a.reviewStatus !== "approved") continue;
    addOwed(null, a.createdAt, a.amount);
    if (a.status === "settled") addOwed(a.settledByMainLedgerId, a.settledAt ?? a.createdAt, -a.amount);
  }
  timed.sort((a, b) => a.at - b.at);

  const after = new Map<number, number>();
  let reserve = 0;
  let next = 0;
  for (const e of entries) {
    while (next < timed.length && timed[next].at <= e.createdAt) reserve -= timed[next++].delta;
    reserve += (e.type === "income" ? e.amount : -e.amount) - (linked.get(e.id) ?? 0);
    after.set(e.id, reserve);
  }
  while (next < timed.length) reserve -= timed[next++].delta;
  return { after, current: reserve };
}

export async function writeAudit(
  db: any,
  actorId: number | undefined,
  action: string,
  targetType: string,
  targetId: number,
  beforeData: unknown,
  afterData: unknown
) {
  await db.insert(auditLog).values({
    actorId: actorId ?? null,
    action,
    targetType,
    targetId,
    beforeData: beforeData ? JSON.stringify(beforeData) : null,
    afterData: afterData ? JSON.stringify(afterData) : null,
  });
}
