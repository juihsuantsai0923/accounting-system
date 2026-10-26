import { teacherLedger, salespersonLedger, auditLog, mainLedger } from "./schema";
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

/** 重新計算某位教師/推銷者的所有子記帳表累計餘額（依 id 排序累加） */
export async function recalculateBalance(db: any, recipientType: Recipient, recipientId: number) {
  const tbl = table(recipientType) as typeof teacherLedger;
  const col = idColumn(recipientType) as typeof teacherLedger.teacherId;
  const rows = await db.select().from(tbl).where(eq(col, recipientId)).orderBy(asc(tbl.id));

  let running = 0;
  for (const row of rows) {
    running += ledgerDelta(row);
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
    await db.update(mainLedger).set({ balance: running, updatedAt: Date.now() }).where(eq(mainLedger.id, row.id));
  }
  return running;
}

export async function getCurrentBalance(db: any, recipientType: Recipient, recipientId: number): Promise<number> {
  const tbl = table(recipientType) as typeof teacherLedger;
  const col = idColumn(recipientType) as typeof teacherLedger.teacherId;
  const rows = await db.select().from(tbl).where(eq(col, recipientId)).orderBy(asc(tbl.id));
  if (rows.length === 0) return 0;
  return rows[rows.length - 1].personalBalance;
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
