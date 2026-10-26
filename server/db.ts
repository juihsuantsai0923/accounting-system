import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import path from "path";
import * as schema from "./schema";
import { createTableStatements, courseColumnMigrations, revenueSettingsColumnMigrations, mainLedgerColumnMigrations } from "./schema-sql";
import { SEED_BOOKS, SEED_COUPONS } from "./catalogSeed";

// 資料庫檔案位置可用環境變數 DATA_DIR 覆寫（例如部署平台掛載的持久化磁碟路徑）
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(path.join(dataDir, "accounting.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// 每次啟動都確保資料表存在（全部使用 IF NOT EXISTS，對既有資料庫是安全的 no-op）
for (const stmt of createTableStatements) {
  sqlite.exec(stmt);
}

// 既有資料表可能是舊版資料庫建立的，缺少後續新增的欄位，
// 用 ALTER TABLE 補上缺少的欄位，每個欄位只在還不存在時才加，重複啟動也安全。
function applyColumnMigrations(table: string, migrations: { column: string; statement: string }[]) {
  const existingColumns = new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name));
  for (const migration of migrations) {
    if (!existingColumns.has(migration.column)) {
      sqlite.exec(migration.statement);
    }
  }
}
applyColumnMigrations("courses", courseColumnMigrations);
applyColumnMigrations("revenue_settings", revenueSettingsColumnMigrations);
applyColumnMigrations("main_ledger", mainLedgerColumnMigrations);

// 書籍與優惠碼初始資料（已存在同名／同代碼就略過，不會覆蓋管理面板改過的價格）
{
  const now = Date.now();
  const insertBook = sqlite.prepare(
    "INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)"
  );
  for (const b of SEED_BOOKS) insertBook.run(b.name, b.kind, b.price, b.sortOrder, now, now);
  const insertCoupon = sqlite.prepare(
    "INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
  );
  for (const c of SEED_COUPONS) insertCoupon.run(c.code, c.discountRate, c.validUntil, now, now);
}

export const db = drizzle(sqlite, { schema });
export { sqlite, dataDir };
