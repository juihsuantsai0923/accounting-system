-- 書籍收入、小班家教、優惠碼、公積金顯示
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0004_books_tutoring.sql
-- 注意：前三行 ALTER TABLE 只能執行一次，重複執行會因欄位已存在而報錯（跟 0002 一樣）。
-- 只新增欄位與資料表，不修改任何既有帳目：舊課程一律視為「線上課程」，舊記錄的收入來源留空。

ALTER TABLE courses ADD COLUMN category TEXT NOT NULL DEFAULT 'online';
ALTER TABLE main_ledger ADD COLUMN income_source TEXT;
ALTER TABLE revenue_settings ADD COLUMN tutoring_reserve_rate REAL NOT NULL DEFAULT 0.05;

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'book',
  price INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS books_name_idx ON books(name);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  discount_rate REAL NOT NULL,
  valid_until TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_idx ON coupons(code);

-- 官網書籍（含筆記本、組合包），2026-10-26 價格
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('物理（上）', 'book', 980, 1, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('物理（下）', 'book', 980, 1, 2, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('物理刷題本（上）', 'workbook', 880, 1, 3, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('物理刷題本（下）', 'workbook', 880, 1, 4, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('物理 上下冊講義套書', 'bundle', 1760, 1, 5, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('物理 上下冊刷題本', 'bundle', 1580, 1, 6, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('物理 上冊全套（講義＋刷題本）', 'bundle', 1680, 1, 7, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('物理 四本全套', 'bundle', 3350, 1, 8, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('化學（上）', 'book', 980, 1, 9, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('化學（下）', 'book', 980, 1, 10, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('化學刷題本（上）', 'workbook', 880, 1, 11, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('化學刷題本（下）', 'workbook', 880, 1, 12, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('化學 上下冊講義套書', 'bundle', 1760, 1, 13, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('化學 上下冊刷題本', 'bundle', 1580, 1, 14, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('化學 上冊全套（講義＋刷題本）', 'bundle', 1680, 1, 15, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('化學 四本全套', 'bundle', 3350, 1, 16, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('生物（上）', 'book', 980, 1, 17, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('生物（下）', 'book', 980, 1, 18, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('生物刷題本（上）', 'workbook', 880, 1, 19, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('生物刷題本（下）', 'workbook', 880, 1, 20, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('生物 上下冊講義套書', 'bundle', 1760, 1, 21, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('生物 上下冊刷題本', 'bundle', 1580, 1, 22, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('生物 上冊全套（講義＋刷題本）', 'bundle', 1680, 1, 23, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('生物 四本全套', 'bundle', 3350, 1, 24, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('地科先修課程', 'book', 980, 1, 25, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('地科刷題本', 'workbook', 880, 1, 26, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('地科 全套（講義＋刷題本）', 'bundle', 1680, 1, 27, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('科學班倒數行事曆（2026 8月-2027 3月）', 'notebook', 300, 1, 28, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO books (name, kind, price, is_active, sort_order, created_at, updated_at) VALUES ('科學班倒數行事曆（2027 4月-2028 3月）', 'notebook', 350, 1, 29, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);

-- 官網優惠碼
INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES ('TUTOR2026', 0.15, '2027-03-15', 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES ('SGGS010', 0.1, NULL, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES ('IVY009', 0.1, NULL, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES ('SWEETY008', 0.05, NULL, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES ('CCCLEE007', 0.05, NULL, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES ('SZLUBA006', 0.05, NULL, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES ('STUDYN005', 0.05, NULL, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES ('MING004', 0.05, NULL, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES ('CINDY003', 0.05, NULL, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES ('SNORLAX002', 0.05, NULL, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO coupons (code, discount_rate, valid_until, is_active, created_at, updated_at) VALUES ('LEVIAX001', 0.05, NULL, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
