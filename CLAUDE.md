# CLAUDE.md — Leviax 澈點科學財務系統

這份檔案是從先前的 Cowork 對話交接過來的專案脈絡。開工前先讀完，裡面記錄的設計決策都是使用者明確要求過的，不要擅自改回去。

## 專案概要

澈點科學（Leviax Lab，一家教育補習公司）的記帳／分潤系統。

- **母記帳表**（`main_ledger`）：公司整體收支流水帳，每筆存一個累計餘額 `balance`。
- **教師／推銷者子記帳表**（`teacher_ledger`／`salesperson_ledger`）：每人一本，記錄公司欠他多少錢（`personal_balance`）。
- **課程收入分潤精靈**：依《課程分潤與成本結構辦法》自動拆給教師／推銷者，邏輯在 `server/revenueCalc.ts`。
- **代墊款**：只計入個人子帳、不動母帳，可在撥款時核銷。

## 技術棧

- 前端：React 18 + Tailwind 3 + Vite（`root: client`，靜態檔放在 `client/public/`）
- 後端：tRPC 11 + Drizzle ORM 0.33 + zod
- 雙執行環境，透過 `ctx.db` 注入：
  - 本機開發：Express + better-sqlite3（`server/index.ts`、`server/context.ts`，資料在 `data/`）
  - 正式環境：Cloudflare Workers + D1（`server/worker.ts`、`server/context.d1.ts`）
  - 所以共用邏輯一律接收 `db` 參數，不要在模組頂層 import 固定的 db。
- 前端部署在 Cloudflare Pages（project `accounting-system`），後端 Worker 名稱是 `accounting-system-api`，D1 名稱是 `accounting-system-db`。

## 指令（使用者在 Windows PowerShell）

PowerShell 有執行原則限制，**npm／npx 一定要加 `.cmd`**：

```powershell
npm.cmd run dev                # 本機：後端 :4000 + 前端 :5173
npx.cmd wrangler deploy        # 部署後端 Worker（改到 server/ 才需要）
npm.cmd run cf:pages:deploy    # 建置並部署前端（改到 client/ 就要跑）
npx.cmd wrangler d1 execute accounting-system-db --remote --file=migrations/000X_xxx.sql   # 正式 D1 跑 migration
```

- 改 schema 時：同時更新 `server/schema.ts`、`server/schema-sql.ts`（本機建表用），並新增 `migrations/000N_*.sql` 給 D1。目前已有 0000～0011（0011 把舊記錄項目名稱改成完整名稱，可重複執行；0010 加 `main_ledger.edited_at` 並把舊備註改成統一格式，ALTER 只能跑一次；0009 加 `main_ledger.breakdown`，ALTER 只能跑一次；0008 是整合金鑰表，可重複執行；0007 是官網訂單快照表，可重複執行；0005 是小班家教課程與老師對應，可重複執行；0006 加課程上課期間、把舊行事曆收入標成書籍，ALTER 只能跑一次）。
- **部署順序**：有新 migration 時，一定先跑 D1 migration，再 `wrangler deploy`，最後部署前端；Worker 先上線會因為欄位不存在而查詢失敗。
- 改完要在回覆裡明確告訴使用者：要不要跑 `wrangler deploy`、要不要跑 migration。

## 角色與權限

角色定義在 `server/trpc.ts` 與 `client/src/lib/auth.tsx`：

| 角色 | 說明 |
|---|---|
| `super_admin` | 全部權限（`adminProcedure`） |
| `finance_staff` | 可新增／刪除帳務（`staffProcedure`） |
| `viewer` | 唯讀，看得到全部，沒有編輯按鈕（前端用 `canManage()` 判斷） |
| `teacher_self` | 看自己的子記帳表＋**母記帳表（唯讀）**，看不到儀表板、應付總覽、每人統計 |
| `salesperson_self` | **只能看自己的子記帳表** |

**重要（使用者明確要求）：**
- **所有資料都要登入才能看**（2026-10-27）：只有 `auth.me`、`auth.login` 是 `publicProcedure`，其他查詢一律 `protectedProcedure` 以上。新增 API 不要用 `publicProcedure`。
- `teacher_self` **可以看母記帳表但不能編輯**（2026-10-27 使用者要求，取代舊規則）：`mainLedger.list`、`reports.exportMainLedgerCsv` 只擋 `salesperson_self`；新增／刪除都是 `staffProcedure`。前端表單與刪除鈕用 `canManage()` 隱藏。
- `teacher_self`、`salesperson_self` 都不能看儀表板、全公司應付總覽、每人統計：`reports.balanceOverview`、`reports.personStats` 遇到這兩個角色回 FORBIDDEN；`salesperson_self` 仍看不到母記帳表。
- 前端：`Dashboard.tsx` 會把這兩個角色導向自己的 `/teacher/:id` 或 `/salesperson/:id`；`Layout.tsx` 對兩者隱藏儀表板，只對推銷者本人隱藏母記帳表。母記帳表頁的應付總覽查詢只在 `canManage()` 時才發出。
- 新增任何會回傳全公司資料的 API 時，記得一起擋這兩個角色。前端隱藏分頁不等於有權限保護。
- 不要用 `publicProcedure` 回傳任何資料（之前 `mainLedger.list`、教師名單、分潤參數都因此漏給未登入的人）。

## 已修過的 bug（不要再犯）

1. **母記帳表刪除後餘額沒重算**：`balance` 只在新增當下算一次，刪除中間的記錄後，後面每一筆都會過期。現在 `delete` 最後會呼叫 `recalculateMainLedgerBalance(db)`（`server/ledger.ts`）。任何會改動歷史記錄的新功能（例如編輯金額）也都要呼叫它。母記帳表頁面另外有「重新計算餘額」按鈕（`mainLedger.recalculateBalances`）可以手動修復。
2. **新增教師／推銷者時悄悄失敗**：自動建立薪水支出類別時撞到 `expense_types.name` 的 UNIQUE 限制。一律用 `upsertSalaryExpenseType()`（`server/expenseTypeHelpers.ts`），不要直接 insert。表單都要顯示 mutation 的錯誤訊息，不能靜默失敗。
3. **Email 顯示 "Invalid email"**：中文輸入法全形模式打出 `＠`／全形英數字。前後端都用 `toHalfWidth()`（`server/textNormalize.ts`、`client/src/lib/textNormalize.ts`）正規化；後端用 `z.preprocess` 包在 `.email()` 前面。

## 設計／品牌規範（使用者多次調整後的定案）

- 品牌色取自 logo：深藍 `#173B69`（Tailwind `brand-700`）、金色 `#E8A233`（`gold-500`）。設定在 `tailwind.config.js`，漸層是 `bg-brand-gradient`、`bg-gold-gradient`。
- 全站字體：`LXGW WenKai TC` → `Noto Sans TC`（`client/src/index.css`）。標題不要另外套 `font-sans`／`font-black`，使用者要求統一字體。
- 系統名稱顯示為「**澈點科學財務系統**」（頁首與登入頁）。
- **Logo 圖檔絕對不要重新繪製**，只能使用 `client/public/` 裡的原圖：
  - `leviax-icon.png`：只有圖示（頁首、登入頁徽章）
  - `leviax-logo.png`：圖示加「澈點科學」直式
  - `leviax-favicon.png`：720×720 白底方形原圖，當瀏覽器分頁圖示
- 頁首：深藍漸層；左上角是白底圓角方框（`rounded-xl`）裝圖示並留白，旁邊是白色標題字；與下方分頁列之間有間距。
- 登入頁：整頁深藍，只有「白底圓角方框 logo 徽章（h-40）」和「登入表單卡片」是白色。已移除預設管理員帳密提示文字，不要加回去。

## 其他功能備忘

- 管理面板（`AdminPage.tsx`）分頁：教師、推銷者、課程、支出類型、收入類型、使用者、分潤參數。
- 使用者管理有啟用／停用與刪除；不能刪除自己目前登入的帳號（前後端都有擋）。
- 帳號設定頁可以改自己的姓名（`users.changeOwnName`）和密碼。
- 收入來源有四種（`main_ledger.income_source`，舊資料為 null）：
  - `course` 線上課程：走分潤精靈（`computeCourseIncome`）。
  - `tutoring` 小班家教：課程 `category = 'tutoring'`，實收金額 × `tutoring_reserve_rate`（2026-10-26 起為 10%，原本 5%；正式值存在 D1 的 revenue_settings）留公積金，其餘全給主理教師（`computeTutoringIncome`）。不套折數、優惠碼、推廣、團隊獎金。
  - `book` 書籍（含筆記本、組合包，`books` 表）：選書＋數量＋優惠碼（`coupons` 表，折扣比例）算建議金額，實收可改；全數留公積金，不分給任何人（`computeBookIncome`）。
  - `other` 其他收入（`income_types`），可手動多方分配。
- 三種精靈入帳都走 `mainLedger.ts` 的 `insertIncome()`，新增收入類型時沿用它，不要再複製一份寫入邏輯。
- **公積金**＝母記帳表目前餘額 − 所有人子記帳表餘額總和（含代墊、負餘額會加回），在儀表板顯示；母記帳表每筆收入另顯示「留給公積金」＝金額 − 已分配總額。不另外存欄位，舊帳也能直接算。
- 書目與優惠碼初始資料在 `server/catalogSeed.ts`（2026-10-26 依官網整理），本機啟動時 INSERT OR IGNORE，D1 由 0004 寫入；之後改價在管理面板「書籍管理」「優惠碼管理」操作。
- 支出不支援多方分配。**薪水撥款例外**：前端會把同一筆金額當成 distribution 一起送（type expense），寫進該人員子記帳表，公司欠款跟著減少、公積金不變（2026-10-27 修正，之前薪水不會扣子帳）。
- 母記帳表「公積金增減」＝收入：金額 − 已分配；支出：−（金額 − 已分配）。所以公帳支出是負數、薪水撥款是 0。
- **風格**（2026-10-29）：跟 Leviax 官網預設淺色主題一致。`tailwind.config.js` 的 brand-700＝官網 brand-navy #1e3a6e、brand-50／100＝brand-light／hover、gold-400＝#ffd172、`bg-gold-gradient`＝官網金色漸層；內文 Noto Sans TC、h1–h3 Noto Serif TC；頁首白底＋金色底線。
- **畫面名稱**（2026-10-29）：導覽列順序 儀表板 → 官網對帳 → 手動記帳（`/entry`，新增記錄表單）→ 帳本（`/ledger`，所有記錄列表；畫面上不再叫「母記帳表」，程式裡仍是 mainLedger）→ 人員（滑鼠移上去展開：直接列出每位在職老師的子記帳表＋推銷者名單；教師名單頁 `/teachers` 已拿掉）→ 代墊管理 → 管理面板 → 帳號設定。帳本不顯示編輯者（只有使用者本人操作），改顯示「最後編輯」（`edited_at`；`updated_at` 會被重算餘額改掉，不能用）。
- **備註格式**（`server/noteFormat.ts`，前後端共用）：`買家：…｜官網訂單：…｜優惠碼：…｜說明：…`，沒填的欄不出現。表單用 `NoteFields` 分欄填、列表用 `NoteView` 加標籤顯示。對帳靠買家姓名比對、靠「官網訂單」欄位擋重複入帳。
- **編輯記錄**（`mainLedger.update`、`EditEntryDialog.tsx`）：項目名稱、備註隨時可改；金額只有沒分給任何人的記錄能改（改完重算餘額），有分潤的要刪掉重記。
- **一筆多項**（2026-10-28，`server/combineIncome.ts`）：使用者要「一次記帳選很多個、一次記完」＝一筆記錄，不是拆成多筆。小班家教可一次勾多門課（`createTutoringIncome` 收 `items`），書籍本來就一筆多本。多項合成一筆時，每項的分潤各自寫進該老師子記帳表，`main_ledger.breakdown` 存 JSON `[{source,name,categoryId,amount}]`；來源不同時 `income_source = 'mixed'`、類別「多項收入」。報表一律用 `expandIncome()`（DashboardCharts.tsx）拆回每一項再算。
- 儀表板分析（`client/src/components/DashboardAnalytics.tsx`）：需要注意（代墊 >30 天、欠薪分潤 >60 天沒付、優惠碼到期）、本月 vs 上月、公積金走勢（`reports.timeline`，每月月底餘額／欠款／公積金，台灣時區）、營收排行（書籍依定價比例拆到每本）、支出分類（薪水合併）、小班家教預收（依 `courses.start_date`～`end_date` 線性估算）、月報 CSV 下載。
- **官網對帳**（`server/routers/webOrders.ts`、`client/src/pages/ReconcilePage.tsx`，2026-10-27，方法 B）：官網訂單快照存在 D1 `web_orders`（migration 0007）。對帳規則：已付款訂單找「項目或備註含買家姓名、下單前 3 天到後 60 天」的收入；金額＝實付→相符，＝實付＋折扣→記了原價；姓名對不到再找同金額 7 天內的記錄→可能對應。待付款＝應收帳款。可手動標「確認無誤／不需入帳」（`manual_status`，同步時會保留）。
  - **勾選訂單「確認入帳（已收到錢）」**（2026-10-28，`webOrders.previewRecord／recordOrders`、`server/webOrderRecord.ts`、`RecordOrdersDialog.tsx`）：應收或未入帳的訂單可勾選，**每張訂單記成母記帳表一筆**（不拆成多筆）。品項對應：課程名稱完全相同→小班家教／線上課程（「X先修課程（N年方案）」→ 線上課程、入帳金額用官網實付）；「科目先修課程（書名）」→ 書目；行事曆用價格對筆記本；對不到要在視窗手動選或設不入帳。官網折扣依定價比例攤，運費算進書籍。備註寫「官網訂單 編號｜買家 姓名」，同一張重複入帳會被擋。入帳後訂單 `manual_status = 'received'`（視同已付款，照一般規則對帳）。
  - **同步流程**（使用者說「同步官網訂單」時）：用 Chrome（使用者已登入官網後台）逐一讀 `https://leviax-lab.vercel.app/admin/orders?tab=pending|completed|cancelled` 的訂單卡片（每張卡是 `div.rounded-xl`，標頭行 `LX-YYYYMMDD-NNN · 日期 時間 · NT$實付 (-NT$折扣)`，下一行是狀態，之後「品名…NT$價格」直到「訂單進度」）→ 存成 `scripts/web_orders_to_sql.py` 開頭寫的 JSON 格式（放 scratchpad，不進 git）→ `python scripts/web_orders_to_sql.py 快照.json 輸出.sql` → `wrangler d1 execute --remote --file=輸出.sql`。只讀不改官網；**不存電話、地址、匯款末五碼**。
- **立即同步按鈕（書籤小工具）**（2026-10-27）：對帳頁「立即同步官網訂單」會開官網訂單頁，使用者在那個分頁點書籤「⇅ 同步到記帳」→ 書籤載入 `client/public/web-orders-sync.js`（Pages 提供），用隱藏 iframe 讀三個分頁、POST 到 Worker 的 `/api/web-orders/sync`（Express 版同路徑）→ 回到 `/reconcile?synced=1`。
  - 驗證用「官網同步金鑰」（`integration_keys` 表、migration 0008，只存 SHA-256；`webOrders.generateSyncKey` 限 super_admin，重新產生舊書籤就失效）。金鑰只能寫入訂單快照，不能讀帳務。共用邏輯在 `server/webOrdersSync.ts`。
  - 官網改版導致讀不到時，改 `web-orders-sync.js` 的解析就好，不用使用者重拖書籤（書籤只帶設定、每次都載入最新腳本）。官網目前沒有 CSP，外部腳本能載入；哪天官網加了 CSP 就要改成把腳本整段塞進書籤。
- **創始基金是要還的借款**（使用者 2026-10-27 確認）：記成收入並分回出資人子帳＝公司欠他；不算營業額；`personStats.loan` 會單獨列出，欠薪提醒會扣掉這部分。
- 儀表板圖表（`client/src/components/DashboardCharts.tsx`，recharts）：月營業額（依收入來源堆疊，舊記錄用類別名稱推回來源）、每人營業額（`reports.personStats` 的 earned）、每人欠薪（balance）。「創始基金」視為股東投入，不算營業額。配色照 dataviz 規範驗證過，黃／綠對比不足所以附「顯示表格」。

## 工作習慣

- 使用者以繁體中文溝通，回覆也請用繁體中文，並簡潔說明改了什麼、要跑哪些部署指令。
- git 目前只有一個初始 commit，之後的改動都還沒 commit。開始前建議先問使用者要不要把現況 commit 起來。
- 資料夾裡的 `fix*_bundle.zip`、`round*_update.zip` 是舊對話傳檔用的，已全部解壓縮套用，可以刪除。
