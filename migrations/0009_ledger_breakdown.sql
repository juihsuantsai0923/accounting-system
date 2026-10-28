-- 一筆收入可以包含多個項目（多門課、多本書、一張官網訂單）：breakdown 存每一項的來源與金額，給報表拆開算
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0009_ledger_breakdown.sql
-- 只能執行一次（欄位已存在會報錯，不影響資料）。
ALTER TABLE main_ledger ADD COLUMN breakdown TEXT;
