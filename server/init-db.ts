/**
 * 手動執行版本：`npm run db:init` 會呼叫這支腳本。
 * 實際的建表邏輯已搬到 server/db.ts，應用程式啟動時會自動執行一次，
 * 所以正式部署時通常不需要手動跑這支——保留它是方便本機開發時單獨重建資料表。
 */
import { sqlite } from "./db";

console.log("✅ 資料表已確認建立完成");
sqlite.close();
