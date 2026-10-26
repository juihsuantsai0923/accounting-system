-- 小班家教課程與主理教師（2026-10-26 使用者指定）
--   物理、數學工具：蔡睿軒／化學：王歆宜／生物：潘彥宇／地科：陳宥勳
-- 執行方式（要在 0004 之後）：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0005_tutoring_courses.sql
-- 可以安全地重複執行：已存在的衝刺班只會改成「小班家教」並設定老師，不存在才新增；不會動到任何已入帳的記錄。
-- 老師是用姓名對應 teachers 表；如果正式資料裡沒有這個名字，主理教師會是空的，請到管理面板「課程管理」補設。

-- 已經存在的衝刺班（名稱含「科目＋衝刺班」）改成小班家教並設定主理教師
UPDATE courses SET category = 'tutoring', teacher_id = (SELECT id FROM teachers WHERE name = '蔡睿軒'), updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE name LIKE '%物理%衝刺班%';
UPDATE courses SET category = 'tutoring', teacher_id = (SELECT id FROM teachers WHERE name = '王歆宜'), updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE name LIKE '%化學%衝刺班%';
UPDATE courses SET category = 'tutoring', teacher_id = (SELECT id FROM teachers WHERE name = '潘彥宇'), updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE name LIKE '%生物%衝刺班%';
UPDATE courses SET category = 'tutoring', teacher_id = (SELECT id FROM teachers WHERE name = '陳宥勳'), updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE name LIKE '%地%科%衝刺班%';

-- 還沒有的就新增（名稱與定價同 Leviax 官網，定價只是參考，記帳時填實收金額）
INSERT INTO courses (name, type, category, teacher_id, original_price, created_at, updated_at)
  SELECT '科學班物理衝刺班 2026-2027', 'personal', 'tutoring', (SELECT id FROM teachers WHERE name = '蔡睿軒'), 27000,
         CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE NOT EXISTS (SELECT 1 FROM courses WHERE name LIKE '%物理%衝刺班%');
INSERT INTO courses (name, type, category, teacher_id, original_price, created_at, updated_at)
  SELECT '科學班化學衝刺班 2026-2027', 'personal', 'tutoring', (SELECT id FROM teachers WHERE name = '王歆宜'), 18000,
         CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE NOT EXISTS (SELECT 1 FROM courses WHERE name LIKE '%化學%衝刺班%');
INSERT INTO courses (name, type, category, teacher_id, original_price, created_at, updated_at)
  SELECT '科學班生物衝刺班 2026-2027', 'personal', 'tutoring', (SELECT id FROM teachers WHERE name = '潘彥宇'), 18000,
         CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE NOT EXISTS (SELECT 1 FROM courses WHERE name LIKE '%生物%衝刺班%');
INSERT INTO courses (name, type, category, teacher_id, original_price, created_at, updated_at)
  SELECT '科學班地球科學衝刺班 2026-2027', 'personal', 'tutoring', (SELECT id FROM teachers WHERE name = '陳宥勳'), 10000,
         CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE NOT EXISTS (SELECT 1 FROM courses WHERE name LIKE '%地%科%衝刺班%');

-- 數學工具先修課程（線上課程）的主理教師
UPDATE courses SET teacher_id = (SELECT id FROM teachers WHERE name = '蔡睿軒'), updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE name LIKE '%數學工具%';

-- 執行完會列出結果，確認每門課都有主理教師
SELECT c.id, c.name, c.category, t.name AS teacher FROM courses c LEFT JOIN teachers t ON t.id = c.teacher_id ORDER BY c.id;
