-- 書籍公積金比例獨立出來（2026-11-02）：book_reserve_rate 預設 25%，在管理面板「分潤參數」可以改。
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0016_book_reserve_rate.sql
-- ALTER 只能跑一次。
ALTER TABLE revenue_settings ADD COLUMN book_reserve_rate REAL NOT NULL DEFAULT 0.25;
SELECT id, reserve_rate, admin_fee_rate, book_reserve_rate FROM revenue_settings;
