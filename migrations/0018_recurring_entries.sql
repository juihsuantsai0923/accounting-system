-- 每月定期收支（2026-11-03）：管理面板「定期收支」設定，每天早上 9 點的排程到了那天就自動記一筆。
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0018_recurring_entries.sql
-- 可重複執行。
CREATE TABLE IF NOT EXISTS recurring_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  item_name TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  day_of_month INTEGER NOT NULL,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_run_month TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
