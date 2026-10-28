-- 舊記錄的項目名稱改成看得懂的完整名稱（2026-10-29 使用者確認）。
-- 每一句都比對原本的名稱，原文不同就不改；可以重複執行。
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0011_rename_items.sql

UPDATE main_ledger SET item_name = 'Vimeo 播放器年費 2026' WHERE id = 16 AND item_name = '2026';
UPDATE main_ledger SET item_name = '數學工具講義印製 30 本' WHERE id = 11 AND item_name = '數學工具_30本';
UPDATE main_ledger SET item_name = '行事曆印製 20 本' WHERE id = 23 AND item_name = '行事曆';
UPDATE main_ledger SET item_name = '銀行利息' WHERE id = 25 AND item_name = '利息';
UPDATE main_ledger SET item_name = '網站 BUG 少收（張嘉華訂單）' WHERE id = 28 AND item_name = '網站BUG虧損';

-- 創始基金：母帳和出資人的子記帳表一起改
UPDATE main_ledger SET item_name = '創始基金：蔡睿軒' WHERE id IN (4, 14) AND item_name = '蔡睿軒_創始基金';
UPDATE main_ledger SET item_name = '創始基金：王歆宜' WHERE id = 5 AND item_name = '王歆宜_創始基金';
UPDATE main_ledger SET item_name = '創始基金：陳宥勳' WHERE id = 7 AND item_name = '陳宥勳_創始基金';
UPDATE main_ledger SET item_name = '創始基金：潘彥宇' WHERE id = 10 AND item_name = '潘彥宇_創始基金';
UPDATE teacher_ledger SET item_name = '創始基金：蔡睿軒' WHERE main_ledger_id IN (4, 14) AND item_name = '蔡睿軒_創始基金';
UPDATE teacher_ledger SET item_name = '創始基金：王歆宜' WHERE main_ledger_id = 5 AND item_name = '王歆宜_創始基金';
UPDATE teacher_ledger SET item_name = '創始基金：陳宥勳' WHERE main_ledger_id = 7 AND item_name = '陳宥勳_創始基金';
UPDATE teacher_ledger SET item_name = '創始基金：潘彥宇' WHERE main_ledger_id = 10 AND item_name = '潘彥宇_創始基金';

SELECT id, item_name, category_name FROM main_ledger WHERE id IN (4, 5, 7, 10, 11, 14, 16, 23, 25, 28);
