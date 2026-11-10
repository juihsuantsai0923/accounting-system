-- 2026-11-10：分潤規則更新（營業稅、上了課才按月發、公積金水位）。ALTER 只能跑一次。
-- 1. 營業稅：登記日以後的收入先扣 5/105 進「稅金準備」（main_ledger.tax_amount）；「營業稅」支出的 tax_amount＝金額，扣稅金準備不扣公積金
ALTER TABLE revenue_settings ADD COLUMN vat_rate REAL NOT NULL DEFAULT 0.05;
ALTER TABLE revenue_settings ADD COLUMN registration_date TEXT;
-- 3. 公積金最低水位與補稅準備（凍結）
ALTER TABLE revenue_settings ADD COLUMN reserve_floor INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE revenue_settings ADD COLUMN reserve_frozen INTEGER NOT NULL DEFAULT 37000;
ALTER TABLE main_ledger ADD COLUMN tax_amount INTEGER NOT NULL DEFAULT 0;

-- 2. 小班衝刺班的分潤／行政費依課程期間按天攤提：記下這一行屬於哪一門衝刺班
ALTER TABLE teacher_ledger ADD COLUMN vest_course_id INTEGER;
ALTER TABLE salesperson_ledger ADD COLUMN vest_course_id INTEGER;
UPDATE teacher_ledger SET vest_course_id = (
  SELECT c.id FROM courses c WHERE c.category = 'tutoring' AND substr(teacher_ledger.item_name, 1, length(c.name) + 1) = c.name || '（'
) WHERE source_type = 'distribution' AND type = 'income';
UPDATE salesperson_ledger SET vest_course_id = (
  SELECT c.id FROM courses c WHERE c.category = 'tutoring' AND substr(salesperson_ledger.item_name, 1, length(c.name) + 1) = c.name || '（'
) WHERE source_type = 'distribution' AND type = 'income';

-- 學費補收紀錄（部分入帳的訂單，補收的那部分分潤從收到錢那天起才算到期）
CREATE TABLE IF NOT EXISTS payment_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  main_ledger_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
INSERT INTO payment_receipts (main_ledger_id, amount, received_at)
SELECT target_id,
       json_extract(before_data, '$.unpaidAmount') - json_extract(after_data, '$.unpaidAmount'),
       created_at
FROM audit_log
WHERE action = 'receivePayment' AND target_type = 'mainLedger'
  AND json_extract(before_data, '$.unpaidAmount') > json_extract(after_data, '$.unpaidAmount');

-- 營業稅支出類型
INSERT INTO expense_types (name, created_at, updated_at)
SELECT '營業稅', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM expense_types WHERE name = '營業稅');
