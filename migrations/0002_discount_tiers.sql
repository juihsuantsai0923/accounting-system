-- 課程優惠折數／年期功能新增的欄位
-- 執行方式：npx wrangler d1 execute accounting-system-db --remote --file=migrations/0002_discount_tiers.sql
-- 注意：這個檔案只能執行一次，重複執行會因為欄位已存在而報錯（這是預期行為）。

ALTER TABLE courses ADD COLUMN original_price INTEGER;
ALTER TABLE revenue_settings ADD COLUMN base_discount REAL NOT NULL DEFAULT 0.6;
