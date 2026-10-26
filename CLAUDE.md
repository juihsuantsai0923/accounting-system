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

- 改 schema 時：同時更新 `server/schema.ts`、`server/schema-sql.ts`（本機建表用），並新增 `migrations/000N_*.sql` 給 D1。目前已有 0000～0005（0005 是小班家教課程與老師對應，可重複執行）。
- **部署順序**：有新 migration 時，一定先跑 D1 migration，再 `wrangler deploy`，最後部署前端；Worker 先上線會因為欄位不存在而查詢失敗。
- 改完要在回覆裡明確告訴使用者：要不要跑 `wrangler deploy`、要不要跑 migration。

## 角色與權限

角色定義在 `server/trpc.ts` 與 `client/src/lib/auth.tsx`：

| 角色 | 說明 |
|---|---|
| `super_admin` | 全部權限（`adminProcedure`） |
| `finance_staff` | 可新增／刪除帳務（`staffProcedure`） |
| `viewer` | 唯讀，看得到全部，沒有編輯按鈕（前端用 `canManage()` 判斷） |
| `teacher_self` | **只能看自己的子記帳表** |
| `salesperson_self` | **只能看自己的子記帳表** |

**重要（使用者明確要求）：** `teacher_self` 和 `salesperson_self` 不能看到母記帳表、儀表板、全公司應付總覽。

- 後端：`mainLedger.list`、`reports.balanceOverview`、`reports.exportMainLedgerCsv` 遇到這兩個角色都會回 FORBIDDEN。
- 前端：`Dashboard.tsx` 會把這兩個角色導向自己的 `/teacher/:id` 或 `/salesperson/:id`，`Layout.tsx` 也隱藏儀表板和母記帳表分頁。
- 新增任何會回傳全公司資料的 API 時，記得一起擋這兩個角色。前端隱藏分頁不等於有權限保護。
- 不要用 `publicProcedure` 回傳帳務資料（之前 `mainLedger.list` 就是因為這樣漏掉權限）。

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
- 支出不支援多方分配。

## 工作習慣

- 使用者以繁體中文溝通，回覆也請用繁體中文，並簡潔說明改了什麼、要跑哪些部署指令。
- git 目前只有一個初始 commit，之後的改動都還沒 commit。開始前建議先問使用者要不要把現況 commit 起來。
- 資料夾裡的 `fix*_bundle.zip`、`round*_update.zip` 是舊對話傳檔用的，已全部解壓縮套用，可以刪除。
