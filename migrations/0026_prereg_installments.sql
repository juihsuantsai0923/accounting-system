-- 2026-11-10：登記前帳款分期（使用者決定這一屆分 11/30、12/31 兩次發）。ALTER 只能跑一次。
-- 稅籍登記日以前入帳的帳，從第一期起平均分 N 期發，最後一期結清；登記日以後入帳的照一般規則另外加。
ALTER TABLE revenue_settings ADD COLUMN prereg_installments INTEGER NOT NULL DEFAULT 2;
ALTER TABLE revenue_settings ADD COLUMN prereg_first_payday TEXT NOT NULL DEFAULT '2026-11-30';
