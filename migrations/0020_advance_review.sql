-- 代墊審核（2026-11-05）：老師、出貨員自己登記的代墊要管理員審核；舊資料預設已通過。
ALTER TABLE advance_payments ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE advance_payments ADD COLUMN review_note TEXT;
