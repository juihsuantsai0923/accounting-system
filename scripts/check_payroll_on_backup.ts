/**
 * 用正式資料庫的備份驗算發薪表（不碰正式資料）：
 *   npx.cmd tsx scripts/check_payroll_on_backup.ts <備份.sql> [migration.sql...] [--now=YYYY-MM-DD]
 * 把備份載入記憶體 SQLite、跑指定的 migration，印出每人每個 15 日的應發金額。
 */
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../server/schema";
import { payrollTable } from "../server/payroll";
import { twDayStart } from "../server/revenueCalc";
import { taxReserveOf } from "../server/routers/payroll";
import { reserveTrail } from "../server/ledger";

const args = process.argv.slice(2);
const nowArg = args.find((a) => a.startsWith("--now="));
const files = args.filter((a) => !a.startsWith("--"));
const sqlite = new Database(":memory:");
for (const f of files) sqlite.exec(readFileSync(f, "utf8"));
const db = drizzle(sqlite, { schema });
const now = nowArg ? twDayStart(nowArg.slice(6)) + 12 * 3600 * 1000 : Date.now();

const t = await payrollTable(db, now);
console.log("發薪日", t.paydays.join(" "), "下次", t.nextPayday);
const tot = t.paydays.map(() => 0);
for (const p of t.people) {
  console.log(
    `${p.name}${p.isShipper ? "（出貨員）" : ""}`,
    p.paydays.map((d) => d.due).join(" "),
    "| 合計",
    p.paydays.reduce((s, d) => s + d.due, 0),
    "餘額",
    p.balance,
    "已發",
    p.totalPaid,
    "下次可發",
    p.next.payable,
    "未到期",
    p.next.notYetDue
  );
  p.paydays.forEach((d, i) => (tot[i] += d.due));
}
console.log("合計", tot.join(" "));
console.log("稅金準備", await taxReserveOf(db), "公積金", (await reserveTrail(db)).current);
const n = (sql: string) => (sqlite.prepare(sql).get() as any).n;
console.log(
  "攤提列：教師",
  n("select count(*) n from teacher_ledger where vest_course_id is not null"),
  "推銷者",
  n("select count(*) n from salesperson_ledger where vest_course_id is not null"),
  "補收紀錄",
  n("select count(*) n from payment_receipts")
);
