-- 還原 0013（2026-10-29 使用者要求）：管理員改回蔡睿軒本人的 juihsuantsai0923@gmail.com，
-- 保留 linked_teacher_id = 2，讓他可以在右上角切換「管理員／老師」身分；
-- leviaxlab.official@gmail.com 停用（不刪，保留稽核紀錄）。可以重複執行。
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0014_restore_admin.sql

UPDATE users SET role = 'super_admin', linked_teacher_id = 2, updated_at = strftime('%s','now') * 1000
WHERE email = 'juihsuantsai0923@gmail.com';

UPDATE users SET is_active = 0, updated_at = strftime('%s','now') * 1000
WHERE lower(email) = 'leviaxlab.official@gmail.com'
  AND EXISTS (SELECT 1 FROM users WHERE email = 'juihsuantsai0923@gmail.com' AND role = 'super_admin' AND is_active = 1);

SELECT id, email, name, role, linked_teacher_id, is_active FROM users ORDER BY id;
