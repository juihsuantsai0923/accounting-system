-- 出貨員與代墊改良（2026-11-03）：新增出貨員名單、帳號綁定出貨員、代墊類別，代墊加上訂單名稱／訂單編號／下訂人／類別。
-- wrangler 4 的 --file 會出 Authentication error 10000，改用 --command 一段一段執行。
ALTER TABLE users ADD COLUMN linked_shipper_id INTEGER;
CREATE TABLE IF NOT EXISTS shippers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS shippers_name_idx ON shippers(name);
CREATE TABLE IF NOT EXISTS advance_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS advance_categories_name_idx ON advance_categories(name);
INSERT OR IGNORE INTO advance_categories (name, created_at) VALUES ('運費', 0), ('其他', 0);
ALTER TABLE advance_payments ADD COLUMN order_name TEXT;
ALTER TABLE advance_payments ADD COLUMN order_no TEXT;
ALTER TABLE advance_payments ADD COLUMN buyer TEXT;
ALTER TABLE advance_payments ADD COLUMN category TEXT;
-- 舊的「姓名_運費」代墊：拆出下訂人與類別（項目名稱不動）
UPDATE advance_payments SET buyer = substr(item_name, 1, instr(item_name, '_運費') - 1), category = '運費'
  WHERE category IS NULL AND instr(item_name, '_運費') > 1;
-- 帳號申請：沒有帳號的人用 Google 登入後填申請，LINE 通知管理員，到管理面板「帳號申請」核准
CREATE TABLE IF NOT EXISTS account_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  requested_role TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by INTEGER,
  decided_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS account_requests_email_idx ON account_requests(email);
