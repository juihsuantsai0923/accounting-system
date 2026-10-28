-- Google 登入用 email 對應帳號（2026-10-29 使用者提供）：王歆宜改成她的 Gmail；其他三位原本就一致。
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0012_user_emails.sql
-- 可以重複執行。
UPDATE users SET email = 'cindywang20071015@gmail.com', updated_at = strftime('%s','now') * 1000
  WHERE id = 4 AND email = 'cindywang961015@gmail.com';
SELECT id, email, name, role FROM users ORDER BY id;
