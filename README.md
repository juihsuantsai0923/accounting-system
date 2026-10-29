# 記帳拆賬財務系統 v2

依據《用戶需求整理》《項目交接文檔》《tRPC API 完整參考文檔》與《架構重新設計文檔》實作，包含原有全部記帳/拆賬功能，以及新增的**代墊款（Advance Payment）**機制與基礎的公司營運補充功能（編輯導向的角色權限、稽核軌跡、應付總覽儀表板）。

## 技術棧與原系統的差異

原交接文檔使用 MySQL/TiDB + OAuth 登入，但這兩者都需要外部服務。這份實作改用以下對應方案，其餘（React + Tailwind + Express + tRPC + Drizzle ORM）維持一致：

| 項目 | 原系統 | 本次實作 |
|------|--------|----------|
| 資料庫 | MySQL / TiDB | SQLite（`better-sqlite3` + Drizzle ORM，schema 完全相容，未來要換 MySQL 只需改 driver） |
| 登入 | OAuth | 帳號密碼登入（bcrypt 雜湊 + JWT） |
| 前端框架版本 | React 19 | React 18（穩定版，19 目前仍是 RC，先用穩定版確保可安裝） |

## 目錄結構

```
accounting-system/
  server/            Express + tRPC 後端
    schema.ts         Drizzle 資料庫 schema（含代墊款、稽核軌跡等新表）
    routers/           每個功能一個 tRPC router
    ledger.ts          子記帳表餘額重算共用邏輯
    auth.ts            密碼雜湊與 JWT
    seed.ts            初始資料（管理員帳號、範例教師/推銷者/課程）
  client/             React 前端（Vite）
    src/pages/          儀表板、母記帳表、教師/推銷者子帳表、代墊管理、管理面板
    src/lib/             tRPC client、Auth context
  drizzle.config.ts   Drizzle Kit 設定
```

## 本機執行方式

> ⚠️ 這份程式碼是在一個**無法連線 npm 官方套件庫**的雲端沙箱中完成撰寫的（`registry.npmjs.org` 被環境網路政策擋下，`host_not_allowed`），因此**未能在此環境內實際執行 `npm install` / 建置 / 啟動測試**。程式碼已依照 tRPC + Drizzle + Express + React 的標準寫法完成，邏輯也經過人工逐一檢查，但請在你自己有網路的電腦上安裝依賴並實際跑一次，若遇到版本相容性的小問題（例如某個套件的次版本 API 略有差異），多半只需微調 import 或版本號即可。

```bash
# 1. 安裝依賴
npm install

# 2. 建立資料庫（依 schema.ts 產生 SQLite 資料表）
npm run db:push

# 3. 建立初始資料（管理員帳號 + 範例教師/推銷者/課程）
npm run db:seed

# 4. 啟動開發環境（同時跑後端 4000 埠、前端 5173 埠，並自動代理 /trpc）
npm run dev
```

打開 http://localhost:5173，使用以下帳號登入：

- Email：`admin@example.com`
- 密碼：`admin123`

### 正式環境建置

```bash
npm run build      # 建置前端靜態檔到 dist/client
npm start          # NODE_ENV=production 啟動 Express，同時提供 API 與靜態前端（4000 埠）
```

## 免費部署：Cloudflare Workers + Pages + D1

除了本機/Docker（Express + better-sqlite3）之外，這個專案也可以部署到 **Cloudflare 的免費方案**（Workers 後端 + D1 資料庫 + Pages 前端），資料會持久保存，不會因為重啟或休眠而消失，而且完全不用付費。這是透過把資料庫存取全部改成 `ctx.db`（每次請求時才從 D1 binding 建立連線）達成的，`server/worker.ts` 是 Workers 專用的進入點，Express 版本（`server/index.ts`）完全不受影響、可以繼續在本機或 Docker 上跑。

### 步驟（都在你自己的電腦上、已裝好 Node.js 之後執行）

```bash
# 0. 安裝依賴（若尚未安裝）
npm install

# 1. 登入 Cloudflare（會開瀏覽器要你授權）
npx wrangler login

# 2. 建立 D1 資料庫
npx wrangler d1 create accounting-system-db
# 指令會印出一段 database_id，把它複製貼到 wrangler.toml 的 database_id = "..." 那一行

# 3. 執行建表 migration（正式的遠端 D1 資料庫）
npm run cf:migrate

# 4. 設定機密環境變數（每個指令執行後會要你貼上值，按 Enter 送出）
npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD

# 5. 部署後端（Cloudflare Workers）
npm run cf:deploy
# 完成後會顯示一個網址，例如 https://accounting-system-api.<你的帳號>.workers.dev
```

接著部署前端到 Cloudflare Pages：

```bash
# 6. 在 client 目錄或專案根目錄新增 .env.production，指向剛剛部署好的 Workers 網址
echo "VITE_API_URL=https://accounting-system-api.<你的帳號>.workers.dev" > .env.production

# 7. 建置並部署前端到 Cloudflare Pages
npm run cf:pages:deploy
```

部署完成後，Cloudflare Pages 會給你一個公開網址（例如 `https://accounting-system.pages.dev`），把它分享給同事就可以直接使用，資料存在 D1（雲端 SQLite），重開機、重新部署都不會遺失。

> ⚠️ 記得**登入後立刻到「管理面板」更換預設管理員密碼**（如果第 4 步沒有另外指定 `ADMIN_PASSWORD`，預設會是 `admin123`）。
>
> 本機開發時想直接用 Workers + 本地 D1 模擬環境測試，可以用 `npm run cf:migrate:local` 建本地 D1 表，再用 `npm run cf:dev` 啟動（預設監聽 http://localhost:8787）。

## 核心功能對照

- **原有功能**：教師/推銷者/課程/支出類型管理、母記帳表多方分配、金額整數化、分潤比例與原金額欄位、餘額自動計算與級聯刪除（改為軟刪除＋可還原）。
- **代墊款機制**：`advancePayments.create` 建立代墊時只寫入子記帳表（`sourceType: "advance"`），不動母記帳表；核銷有兩條路徑——併入正式撥款（`mainLedger.create` 的 `distributions[].settledAdvanceIds`）或獨立核銷（`advancePayments.settle`），詳細設計請對照《架構重新設計文檔》第二節。
- **權限分層**：`super_admin` / `finance_staff` / `teacher_self` / `salesperson_self` 四種角色，教師/推銷者本人登入時後端會強制鎖定查詢範圍為自己的資料。
- **稽核軌跡**：所有新增/修改/刪除/核銷操作都寫入 `audit_log` 表（目前僅後端記錄，尚無前端檢視頁面，可作為下一步擴充）。
- **CSV 對帳表下載**：母記帳表、教師/推銷者對帳單、代墊記錄、應付總覽，四個頁面都有「下載 CSV」按鈕，可直接匯出成 Excel 看得懂的 CSV（含 UTF-8 BOM，中文不會亂碼）。教師/推銷者本人登入時只能匯出自己的對帳單。

## 尚未實作、留給下一階段的項目

依《架構重新設計文檔》第七節優先級，以下項目**這一版尚未做**，建議依序補上：

1. 記錄編輯功能（目前仍是「只能刪除重建」）
2. 憑證/收據附件的實際上傳（目前 schema 已預留 `attachmentUrl` 欄位，但前端尚無上傳元件）
3. 稽核軌跡的前端檢視頁面
4. PDF 對帳單匯出（CSV 已完成，見上方「CSV 對帳表下載」）
5. 審核簽核流程、預算控管、異常提醒

## 已知限制

- 目前餘額計算為系統自動累加（母記帳表 `balance` 由後端依「前一筆餘額 ± 本次金額」自動算出），與原 API 文件「balance 由前端傳入」的作法不同——這是刻意的調整，避免前端計算錯誤導致帳務不一致，如果你需要保留原本「手動輸入餘額」的行為，需要調整 `server/routers/mainLedger.ts` 的 `create`。
- 稽核軌跡目前沒有還原（rollback）功能，只有記錄。
