-- 課程分潤功能新增的欄位與資料表
-- 執行方式：npx wrangler d1 execute accounting-system-db --remote --file=migrations/0001_revenue.sql

ALTER TABLE courses ADD COLUMN teacher_id INTEGER;
ALTER TABLE courses ADD COLUMN base_price INTEGER;

CREATE TABLE IF NOT EXISTS revenue_settings (
  id INTEGER PRIMARY KEY,
  coupon_discount INTEGER NOT NULL DEFAULT 750,
  referral_bonus INTEGER NOT NULL DEFAULT 500,
  platform_fee_rate REAL NOT NULL DEFAULT 0.2,
  team_bonus_rate REAL NOT NULL DEFAULT 0.16666666666666666,
  material_cost INTEGER NOT NULL DEFAULT 300,
  monthly_subscription INTEGER NOT NULL DEFAULT 350,
  estimated_monthly_sales INTEGER NOT NULL DEFAULT 30,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS revenue_team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_type TEXT NOT NULL,
  recipient_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
