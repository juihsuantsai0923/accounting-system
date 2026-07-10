import { db } from "./db";
import { teacherLedger, salespersonLedger, auditLog } from "./schema";
import { eq, asc } from "drizzle-orm";

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

/** 重新計算某位教師/推銷者的所有子記帳表累計餘額（依 id 排序累加） */
export async function recalculateBalance(recipientType: Recipient, recipientId: number) {
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

export async function getCurrentBalance(recipientType: Recipient, recipientId: number): Promise<number> {
  const tbl = table(recipientType) as typeof teacherLedger;
  const col = idColumn(recipientType) as typeof teacherLedger.teacherId;
  const rows = await db.select().from(tbl).where(eq(col, recipientId)).orderBy(asc(tbl.id));
  if (rows.length === 0) return 0;
  return rows[rows.length - 1].personalBalance;
}

export async function writeAudit(
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
