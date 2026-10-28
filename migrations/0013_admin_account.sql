-- 系統管理員改成公司帳號 leviaxlab.official@gmail.com（2026-10-29 使用者要求）；
-- 蔡睿軒原本的帳號改成跟其他老師一樣（teacher_self，只能看自己的子記帳表＋唯讀帳本）。
-- 新帳號只用 Google 登入：密碼雜湊是一組隨機字串算出來的，原文沒有保存，所以密碼登入不會成功。
-- 先建管理員再降級，避免中間沒有管理員。可以重複執行。
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0013_admin_account.sql

INSERT INTO users (email, password_hash, name, role, linked_teacher_id, linked_salesperson_id, is_active, created_at, updated_at)
SELECT 'leviaxlab.official@gmail.com', '$2a$10$qx5Gq3u0blWUte7w6/GY8u3DZQJ7boRXlqPWRIuQqVHygAWFCRWyS', '澈點科學（管理員）', 'super_admin', NULL, NULL, 1,
       strftime('%s','now') * 1000, strftime('%s','now') * 1000
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = 'leviaxlab.official@gmail.com');

UPDATE users SET role = 'teacher_self', linked_teacher_id = 2, updated_at = strftime('%s','now') * 1000
WHERE email = 'juihsuantsai0923@gmail.com'
  AND EXISTS (SELECT 1 FROM users WHERE lower(email) = 'leviaxlab.official@gmail.com' AND role = 'super_admin' AND is_active = 1);

SELECT id, email, name, role, linked_teacher_id, is_active FROM users ORDER BY id;
