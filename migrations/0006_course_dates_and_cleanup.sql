-- 小班家教上課期間（算「已收但還沒上的課」用）＋舊行事曆收入標成書籍
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0006_course_dates_and_cleanup.sql
-- 注意：第一行 ALTER TABLE 只能執行一次（跟 0002、0004 一樣）。

ALTER TABLE courses ADD COLUMN start_date TEXT;
ALTER TABLE courses ADD COLUMN end_date TEXT;

-- 四科衝刺班上課期間（依各科課程規劃頁），之後可在管理面板「課程管理」修改
UPDATE courses SET start_date = '2026-10-31', end_date = '2027-03-06' WHERE category = 'tutoring' AND name LIKE '%物理%衝刺班%';
UPDATE courses SET start_date = '2026-11-01', end_date = '2027-03-07' WHERE category = 'tutoring' AND name LIKE '%化學%衝刺班%';
UPDATE courses SET start_date = '2026-11-01', end_date = '2027-03-07' WHERE category = 'tutoring' AND name LIKE '%生物%衝刺班%';
UPDATE courses SET start_date = '2026-10-31', end_date = '2027-01-02' WHERE category = 'tutoring' AND name LIKE '%地%科%衝刺班%';

-- 舊的行事曆收入（記在自訂收入類型「2026-27行事曆」等）：只補上收入來源＝書籍，金額、日期、名稱都不動
UPDATE main_ledger SET income_source = 'book'
  WHERE income_source IS NULL AND type = 'income' AND deleted_at IS NULL AND category_name LIKE '%行事曆%';

SELECT id, name, category, start_date, end_date FROM courses ORDER BY id;
SELECT id, item_name, category_name, amount, income_source FROM main_ledger WHERE category_name LIKE '%行事曆%' AND deleted_at IS NULL;
