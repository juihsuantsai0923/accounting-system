-- 2026-11-07：網紅碼的佣金給誰。每組啟用中的優惠碼先用代碼建一位推銷者，名字可到管理面板改。
-- ALTER 只能跑一次。
ALTER TABLE coupons ADD COLUMN salesperson_id INTEGER;
INSERT INTO salespeople (name, note, is_active, created_at, updated_at)
  SELECT code, '網紅優惠碼', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000 FROM coupons WHERE is_active = 1;
UPDATE coupons SET salesperson_id = (SELECT id FROM salespeople WHERE name = coupons.code) WHERE is_active = 1;
