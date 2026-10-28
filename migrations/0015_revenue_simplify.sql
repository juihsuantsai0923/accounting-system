-- 分潤參數簡化（2026-10-29）：只留公積金比例 reserve_rate、行政費比例 admin_fee_rate，都預設 10%。
-- 公積金比例沿用目前小班家教的設定值（tutoring_reserve_rate）。舊參數欄位保留不刪，程式不再使用。
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0015_revenue_simplify.sql
-- ALTER 只能跑一次。
ALTER TABLE revenue_settings ADD COLUMN reserve_rate REAL NOT NULL DEFAULT 0.1;
ALTER TABLE revenue_settings ADD COLUMN admin_fee_rate REAL NOT NULL DEFAULT 0.1;
UPDATE revenue_settings SET reserve_rate = tutoring_reserve_rate WHERE id = 1;
SELECT id, reserve_rate, admin_fee_rate FROM revenue_settings;
