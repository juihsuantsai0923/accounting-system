import { eq } from "drizzle-orm";
import { expenseTypes, incomeTypes, mainLedger, recurringEntries } from "./schema";
import { recalculateMainLedgerBalance, writeAudit } from "./ledger";
import { mergeNote } from "./noteFormat";

/** 台灣時間的年月與幾號 */
export function twDate(ts: number) {
  const d = new Date(ts + 8 * 3600 * 1000);
  return { month: d.toISOString().slice(0, 7), day: d.getUTCDate() };
}

/** 這條規則的類別名稱；收入用 income_types，支出用 expense_types（薪水類別不行，撥薪要分到子帳） */
export async function recurringCategory(db: any, type: string, categoryId: number) {
  if (type === "income") {
    const [t] = await db.select().from(incomeTypes).where(eq(incomeTypes.id, categoryId)).limit(1);
    return t ? { name: t.name as string } : null;
  }
  const [t] = await db.select().from(expenseTypes).where(eq(expenseTypes.id, categoryId)).limit(1);
  if (!t || t.teacherId || t.salespersonId) return null;
  return { name: t.name as string };
}

/**
 * 每月定期收支：到了規則設定的日子（台灣時間），這個月還沒記過就記一筆到帳本（不分給任何人），重算餘額。
 * 每天的排程都會呼叫；同一條規則同一個月只會記一次。回傳這次記了哪些。
 */
export async function runDueRecurring(db: any, now = Date.now()) {
  const { month, day } = twDate(now);
  const rules: any[] = await db.select().from(recurringEntries).where(eq(recurringEntries.isActive, true));
  const created: { id: number; itemName: string; amount: number; type: string }[] = [];
  for (const r of rules) {
    if (r.dayOfMonth > day || r.lastRunMonth === month) continue;
    const cat = await recurringCategory(db, r.type, r.categoryId);
    if (!cat) continue;
    const [row] = await db
      .insert(mainLedger)
      .values({
        type: r.type,
        itemName: r.itemName,
        categoryId: r.categoryId,
        categoryName: cat.name,
        amount: r.amount,
        balance: 0, // 下面 recalculateMainLedgerBalance 重算
        note: mergeNote(r.note ?? undefined, { memo: `每月定期${r.type === "income" ? "收入" : "支出"}（${month}）` }),
        incomeSource: r.type === "income" ? "other" : null,
        editedAt: now,
      })
      .returning();
    await db.update(recurringEntries).set({ lastRunMonth: month, updatedAt: now }).where(eq(recurringEntries.id, r.id));
    await writeAudit(db, undefined, "recurring", "mainLedger", row.id, null, row);
    created.push({ id: row.id, itemName: r.itemName, amount: r.amount, type: r.type });
  }
  if (created.length) await recalculateMainLedgerBalance(db);
  return created;
}
