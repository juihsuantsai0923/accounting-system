-- 2026-11-09：官網同步寄件代碼（7-11／全家的貨態追蹤碼）。同一個寄件代碼＝同一包，代墊選單用來算包裹數。ALTER 只能跑一次。
ALTER TABLE web_orders ADD COLUMN tracking_code TEXT;
