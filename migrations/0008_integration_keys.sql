-- 外部整合金鑰（目前只有官網訂單同步書籤用）
-- 執行方式：npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/0008_integration_keys.sql
-- IF NOT EXISTS，可以重複執行。只存金鑰的 SHA-256，金鑰本身只在產生時顯示一次。

CREATE TABLE IF NOT EXISTS integration_keys (
  name TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
