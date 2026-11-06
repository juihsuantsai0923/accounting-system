/**
 * 2026-11-07 一次性帳務：王柏御 #40 支出改成 #39 未入帳 20,000；張沛溱 LX-20261104-001 入帳，未入帳 27,110。
 * 用法：npx tsx scripts/record_partial_20261107.ts <D1 export.sql> <輸出.sql>
 * 在記憶體資料庫跑系統本身的入帳程式，再把差異輸出成 SQL。
 */
import { readFileSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../server/schema";
import { loadCatalog, planOrder } from "../server/webOrderRecord";
import { insertIncome } from "../server/routers/mainLedger";
import { recalculateMainLedgerBalance, writeAudit } from "../server/ledger";

const [src, dst] = process.argv.slice(2);
const sqlite = new Database(":memory:");
sqlite.exec(readFileSync(src, "utf8").replace("PRAGMA defer_foreign_keys=TRUE;", "").replace("BEGIN TRANSACTION;", "").replace("COMMIT;", ""));
sqlite.exec("DROP TABLE IF EXISTS integration_keys");
const db: any = drizzle(sqlite, { schema });
const TABLES = ["main_ledger", "ledger_distribution", "teacher_ledger", "salesperson_ledger", "web_orders", "audit_log"];
const key = (t: string) => (t === "web_orders" ? "order_no" : "id");
const snap = () => Object.fromEntries(TABLES.map((t) => [t, new Map((sqlite.prepare(`SELECT * FROM ${t}`).all() as any[]).map((r) => [r[key(t)], r]))]));
const before = snap();

const [e40] = await db.select().from(schema.mainLedger).where(eq(schema.mainLedger.id, 40));
const [e39] = await db.select().from(schema.mainLedger).where(eq(schema.mainLedger.id, 39));
if (e40.type !== "expense" || e40.amount !== 20000 || !e40.itemName.includes("王柏御") || e40.deletedAt) throw new Error("#40 不是預期的支出");
if (!e39.note.includes("王柏御")) throw new Error("#39 不是王柏御");
const now = Date.now();
await db.update(schema.mainLedger).set({ deletedAt: now, updatedAt: now }).where(eq(schema.mainLedger.id, 40));
await db.update(schema.mainLedger).set({ unpaidAmount: 20000, updatedAt: now }).where(eq(schema.mainLedger.id, 39));
await writeAudit(db, 1, "partial", "mainLedger", 39, { expense40: 20000 }, { unpaidAmount: 20000 });

const [order] = await db.select().from(schema.webOrders).where(eq(schema.webOrders.orderNo, "LX-20261104-001"));
const plan = await planOrder(db, order, {}, await loadCatalog(db));
if (plan.errors.length) throw new Error(plan.errors.join("；"));
const c = plan.combined!;
await insertIncome(
  db,
  1,
  { itemName: c.itemName, categoryId: c.categoryId, categoryName: c.categoryName, amount: c.amount, note: c.note, incomeSource: c.incomeSource, breakdown: c.breakdown, unpaidAmount: 27110 },
  c.distributions,
  (d) => d.itemNameSuffix
);
await db.update(schema.webOrders).set({ manualStatus: "received", manualNote: null }).where(eq(schema.webOrders.orderNo, order.orderNo));
await recalculateMainLedgerBalance(db);

const q = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const after = snap();
const out: string[] = [];
for (const t of TABLES) {
  for (const [id, row] of after[t] as Map<any, any>) {
    const old = (before[t] as Map<any, any>).get(id);
    if (!old) out.push(`INSERT INTO ${t} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(q).join(", ")})`);
    else {
      const sets = Object.keys(row).filter((k) => row[k] !== old[k]).map((k) => `${k} = ${q(row[k])}`);
      if (sets.length) out.push(`UPDATE ${t} SET ${sets.join(", ")} WHERE ${key(t)} = ${q(id)}`);
    }
  }
}
writeFileSync(dst, out.join(";\n") + ";\n");
const one = (s: string) => (sqlite.prepare(s).get() as any).v;
const balance = one("SELECT SUM(CASE type WHEN 'income' THEN amount ELSE -amount END) v FROM main_ledger WHERE deleted_at IS NULL");
const unpaid = one("SELECT SUM(unpaid_amount) v FROM main_ledger WHERE deleted_at IS NULL");
const owed = (sqlite.prepare("SELECT teacher_id id, personal_balance b FROM teacher_ledger t WHERE id = (SELECT id FROM teacher_ledger x WHERE x.teacher_id = t.teacher_id ORDER BY created_at DESC, id DESC LIMIT 1) GROUP BY teacher_id").all() as any[]).reduce((s, r) => s + r.b, 0)
  + one("SELECT COALESCE(SUM(personal_amount),0) v FROM salesperson_ledger");
console.log(JSON.stringify({ statements: out.length, order: { amount: c.amount, parts: plan.parts.map((p) => [p.itemName, p.amount, p.reserve]) }, balance, unpaid, owed, reserve: balance - owed, real: balance - owed - unpaid, shortfall: Math.max(10000 - (balance - owed - unpaid), 0) }));
for (const r of sqlite.prepare("SELECT t.name, (SELECT personal_balance FROM teacher_ledger l WHERE l.teacher_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1) b FROM teachers t").all() as any[]) console.log(r.name, r.b);
