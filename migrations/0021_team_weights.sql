-- 2026-11-07：行政費依權重分配（蔡睿軒 4、潘彥宇 3.5、王歆宜 1.5、出貨員 1），出貨員用推銷者子記帳表記分潤。
-- ALTER 只能跑一次。舊帳重算見 scripts/recalc_shares_20261107.py。
ALTER TABLE revenue_team_members ADD COLUMN weight REAL NOT NULL DEFAULT 1;
