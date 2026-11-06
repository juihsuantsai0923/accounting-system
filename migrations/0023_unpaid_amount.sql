-- 2026-11-07：部分入帳，帳本記整張訂單，這裡記家長還沒付的部分。ALTER 只能跑一次。
ALTER TABLE main_ledger ADD COLUMN unpaid_amount INTEGER NOT NULL DEFAULT 0;
