-- 官網訂單快照（對帳、應收帳款用）
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0007_web_orders.sql
-- 全部 IF NOT EXISTS，可以重複執行。
-- 只存對帳需要的欄位：訂單編號、時間、買家姓名、金額、折扣、狀態、品項；不存電話、地址、匯款末五碼。
-- 資料由 scripts/web_orders_to_sql.py 產生的 SQL 寫入（從官網後台「訂單管理」讀出來的快照）。

CREATE TABLE IF NOT EXISTS web_orders (
  order_no TEXT PRIMARY KEY,
  ordered_at INTEGER NOT NULL,
  buyer TEXT NOT NULL,
  total INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  status_label TEXT NOT NULL,
  tab TEXT NOT NULL,
  items TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  manual_status TEXT,
  manual_note TEXT
);
