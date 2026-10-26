-- 「其他收入」類型管理（不含課程收入，課程收入走課程收入分潤精靈）
-- 執行方式：npx wrangler d1 execute accounting-system-db --remote --file=migrations/0003_income_types.sql
-- 全部使用 IF NOT EXISTS，可以安全地重複執行。

CREATE TABLE IF NOT EXISTS income_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS income_types_name_idx ON income_types(name);
