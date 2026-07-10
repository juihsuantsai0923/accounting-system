import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import path from "path";
import * as schema from "./schema";
import { createTableStatements } from "./schema-sql";

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

export const db = drizzle(sqlite, { schema });
export { sqlite, dataDir };
