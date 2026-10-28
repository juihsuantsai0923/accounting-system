-- 1. 新增 main_ledger.edited_at（最後由人新增／編輯的時間）。舊記錄先填建立時間。
-- 2. 把舊記錄的備註改成統一格式「買家：…｜官網訂單：…｜優惠碼：…｜說明：…」（2026-10-29 依正式資料逐筆整理）。
--    每一句都比對原本的備註，原文不同就不改（避免蓋掉之後手動改過的內容）。
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0010_edited_at_and_notes.sql
-- ALTER 只能跑一次；後面的 UPDATE 可以重複執行。

ALTER TABLE main_ledger ADD COLUMN edited_at INTEGER;
UPDATE main_ledger SET edited_at = created_at WHERE edited_at IS NULL;

UPDATE main_ledger SET note = '說明：每本 235 元' WHERE id = 11 AND note = '每本235元';
UPDATE main_ledger SET note = '說明：怕錢不夠先放著' WHERE id = 14 AND note = '怕錢不夠先放著';
UPDATE main_ledger SET note = '買家：羅燕鈴｜官網訂單：LX-20260714-001' WHERE id = 17 AND note = '羅燕鈴';
-- 18 原本沒寫買家；官網對帳已人工確認是薛博升的訂單
UPDATE main_ledger SET note = '買家：薛博升｜官網訂單：LX-20260716-001' WHERE id = 18 AND note IS NULL;
UPDATE main_ledger SET note = '買家：簡妤芸｜官網訂單：LX-20260721-001' WHERE id = 19 AND note = '簡妤芸';
UPDATE main_ledger SET note = '買家：徐精宏｜官網訂單：LX-20260729-001' WHERE id = 21 AND note = '徐精宏';
UPDATE main_ledger SET note = '買家：李承鴻｜官網訂單：LX-20260809-001' WHERE id = 22 AND note = '李承鴻';
UPDATE main_ledger SET note = '說明：2026-27、2027-28 行事曆各 10 本' WHERE id = 23 AND note = '2627，2728各十本';
UPDATE main_ledger SET note = '買家：徐憶潔｜官網訂單：LX-20260823-001' WHERE id = 24 AND note = '徐憶潔';
UPDATE main_ledger SET note = '買家：黃瀞萱｜官網訂單：LX-20260910-001' WHERE id = 26 AND TRIM(note) = '黃瀞萱';
UPDATE main_ledger SET note = '買家：張嘉華｜官網訂單：LX-20261027-003｜說明：網站 BUG 少收 900 元（另記支出）' WHERE id = 27 AND note = '張嘉華（網站BUG虧900）';
UPDATE main_ledger SET note = '說明：張嘉華訂單（LX-20261027-003）網站 BUG 少收的 900 元' WHERE id = 28 AND note IS NULL;
UPDATE main_ledger SET note = '買家：張云瀞｜官網訂單：LX-20261028-001' WHERE id = 29 AND note = '張云瀞';
UPDATE main_ledger SET note = '買家：洪巧珣｜官網訂單：LX-20261028-002' WHERE id = 30 AND note = '官網訂單 LX-20261028-002｜買家 洪巧珣';

SELECT id, item_name, note FROM main_ledger WHERE deleted_at IS NULL ORDER BY id;
