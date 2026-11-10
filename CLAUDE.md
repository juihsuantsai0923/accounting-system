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

- 改 schema 時：同時更新 `server/schema.ts`、`server/schema-sql.ts`（本機建表用），並新增 `migrations/000N_*.sql` 給 D1。目前已有 0000～0025（0025 營業稅、按月發薪、公積金水位，ALTER 只能跑一次；0024 加 web_orders.tracking_code，ALTER 只能跑一次；0023 加 main_ledger.unpaid_amount，ALTER 只能跑一次；0022 加 coupons.salesperson_id 並建網紅推銷者，ALTER 只能跑一次；0021 加 revenue_team_members.weight，ALTER 只能跑一次；0018 新增 recurring_entries 定期收支表，可重複執行；0017 把舊的書籍分潤列改成用書名當項目名稱，可重複執行；0016 加 revenue_settings.book_reserve_rate，ALTER 只能跑一次；0015 加 revenue_settings.reserve_rate／admin_fee_rate，ALTER 只能跑一次；0014 還原 0013：蔡睿軒回到 super_admin（linked_teacher_id=2）、leviaxlab.official 停用，可重複執行；0013 新增管理員 leviaxlab.official@gmail.com、蔡睿軒帳號降為 teacher_self，可重複執行；0012 把王歆宜帳號 email 改成她的 Gmail，可重複執行；0011 把舊記錄項目名稱改成完整名稱，可重複執行；0010 加 `main_ledger.edited_at` 並把舊備註改成統一格式，ALTER 只能跑一次；0009 加 `main_ledger.breakdown`，ALTER 只能跑一次；0008 是整合金鑰表，可重複執行；0007 是官網訂單快照表，可重複執行；0005 是小班家教課程與老師對應，可重複執行；0006 加課程上課期間、把舊行事曆收入標成書籍，ALTER 只能跑一次）。
- **部署順序**：有新 migration 時，一定先跑 D1 migration，再 `wrangler deploy`，最後部署前端；Worker 先上線會因為欄位不存在而查詢失敗。
- 改完要在回覆裡明確告訴使用者：要不要跑 `wrangler deploy`、要不要跑 migration。

## 角色與權限

角色定義在 `server/trpc.ts` 與 `client/src/lib/auth.tsx`：

| 角色 | 說明 |
|---|---|
| `super_admin` | 全部權限（`adminProcedure`） |
| `finance_staff` | 唯讀（帳本、所有子記帳表、報表都能看；會改帳的 `staffProcedure` 只有 super_admin） |
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
  - `tutoring` 小班家教：課程 `category = 'tutoring'`，實收金額 × `reserve_rate`（10%，正式值存在 D1 的 revenue_settings）留公積金，其餘全給主理教師（`computeTutoringIncome`）。不套折數、優惠碼、推廣、團隊獎金。
  - `book` 書籍（含筆記本、組合包，`books` 表）：選書＋數量＋優惠碼（`coupons` 表，折扣比例）算建議金額，實收可改；分潤見下面「分潤規則」（`computeBookIncome`＋`splitBookIncome`）。
  - `other` 其他收入（`income_types`），可手動多方分配。
- 三種精靈入帳都走 `mainLedger.ts` 的 `insertIncome()`，新增收入類型時沿用它，不要再複製一份寫入邏輯。
- **公積金**＝母記帳表目前餘額 − 所有人子記帳表餘額總和（含代墊、負餘額會加回），在儀表板顯示；母記帳表每筆收入另顯示「留給公積金」＝金額 − 已分配總額。不另外存欄位，舊帳也能直接算。
- 書目與優惠碼初始資料在 `server/catalogSeed.ts`（2026-10-26 依官網整理），本機啟動時 INSERT OR IGNORE，D1 由 0004 寫入；之後改價在管理面板「書籍管理」「優惠碼管理」操作。
- 支出不支援多方分配。**薪水撥款例外**：前端會把同一筆金額當成 distribution 一起送（type expense），寫進該人員子記帳表，公司欠款跟著減少、公積金不變（2026-10-27 修正，之前薪水不會扣子帳）。
- 母記帳表「公積金增減」＝收入：金額 − 已分配；支出：−（金額 − 已分配）。所以公帳支出是負數、薪水撥款是 0。
- 子記帳表「原始金額」與「分潤比例」看該品項（`DistItem.baseAmount`，`combineIncome` 帶入），不是整張訂單（2026-11-05）。
- 母記帳表「剩餘公積金」（2026-11-05）＝記完這筆後的公積金，`server/ledger.ts` 的 `reserveTrail` 現算不存欄位，跟儀表板同算法（含代墊）。沒掛帳本記錄的代墊依時間算進下一筆，最後一筆之後才發生的代墊只算進表格上方的「目前剩餘公積金」（`mainLedger.reserveNow`）。
- **Google 登入**（2026-10-29）：Google Cloud 專案 `leviax-finance`（juihsuantsai0923@gmail.com 的帳號），OAuth 用戶端「Leviax Finance Web」，ID 寫在 `wrangler.toml` [vars] `GOOGLE_CLIENT_ID` 與 `.env.production` `VITE_GOOGLE_CLIENT_ID`（公開值）。同意畫面是「測試」模式，只有測試使用者（四位老師的 Gmail）能登入；新增人員要同時在系統開帳號（email＝Gmail）並在 Google Cloud「Audience → Test users」加入。登入用跳轉流程（`client/src/lib/googleRedirect.ts`，response_type=id_token＋nonce，回到 `/login`；重新導向網址已登記 main／根網域／localhost:5173 的 `/login`），後端 `auth.googleLogin` 用 Google tokeninfo 驗證 aud/iss/email_verified 再用 email（不分大小寫）找帳號。登入頁照官網登入頁的樣式；這台電腦登入過的 Gmail 存在 localStorage `login.googleAccounts`。密碼登入收在「改用密碼登入」當備用。
- **部分入帳**（2026-11-07，`main_ledger.unpaid_amount`）：官網對帳確認入帳時填這次收到多少；帳本 amount 記整張訂單、分潤照整張算，還沒繳的記在 unpaid_amount，所以公積金是「含未入帳」，公積金卡片下方另外顯示未入帳總額。儀表板列出 `mainLedger.unpaidList`，收到錢用 `receivePayment` 登記；編輯記錄也能改未入帳金額。
- **分潤規則（2026-11-07，取代下一條的比例）**：線上課程、小班家教、試上都是公積金 10%＋行政費 20%＋主理老師；書籍公積金 35%＋行政費 20%＋該科老師；行事曆、運費全留公積金。行政費依 `revenue_team_members.weight` 分：蔡睿軒 4、潘彥宇 3.5、王歆宜 2、出貨員余彩霞 0.5（出貨員分潤記在推銷者子記帳表，`salespeople` id 1）。試上是獨立收入來源 `trial`（`createTrialIncome`，`category_id` 存試上的課）。第一筆小班家教（帳本 #27）開始的舊帳用 `scripts/recalc_shares_20261107.py` 重算，更早的帳維持舊算法。網紅碼（`coupons.salesperson_id`）：2026-11-07 起、有折扣的官網訂單，入帳時手動選用了哪組碼（官網沒有送），線上課程、書籍照售價算公積金、行政費與佣金 5%（`splitWithAdminFee` 的 influencer），折扣由老師那份吸收；小班家教、行事曆不算；更早的訂單照實收。
- **分潤規則（2026-10-29 簡化）**：三個參數（`revenue_settings.reserve_rate` 公積金 10%、`admin_fee_rate` 行政費 10%、`book_reserve_rate` 書籍公積金 25%，管理面板「分潤參數」可改），算法在 `server/revenueCalc.ts`。線上課程、書籍：公積金＋行政費（團隊名單 revenue_team_members 三人平分，名單固定不在畫面改）＋其餘給主理老師；書籍公積金用 `book_reserve_rate`（2026-11-02 使用者要求 25%，不跟 reserve_rate 走；改了之後管理面板會先列出舊帳會改哪些、確認才用 `server/bookShares.ts` 的 `recalcBookShares` 重算老師那一份），老師子記帳表項目名稱寫書名（例如「物理 四本全套（書籍分潤）」），依科目（`SUBJECT_TEACHERS`：物理蔡睿軒、化學王歆宜、生物潘彥宇、地科陳宥勳、數學蔡睿軒）分，行事曆（kind=notebook）與運費全留公積金；小班家教：公積金後全給主理老師。金額一律用實收（不再有折數、優惠碼折抵、推廣抽成、成本參數）。舊參數欄位留在表裡不用。
- **官網商品同步**：課程、書籍、優惠碼不再在管理面板維護，由同步書籤（`client/public/web-orders-sync.js`）一起讀官網後台「課程管理」「書籍管理（每個商品的單品與組合包）」「定價與優惠 › 優惠碼」送到 `/api/web-orders/sync` 的 `catalog`，`upsertCatalog` 以名稱／代碼對應更新；課程老師照科目自動對；官網沒有的書、優惠碼標停用。書名規則：單品＝官網單品名、組合包＝「科目 組合包名」、行事曆＝「商品名（單品名）」。
- **權限**：會改帳的操作（`staffProcedure`、前端 `canManage`）只有 super_admin；財務人員 finance_staff 唯讀（帳本、所有子記帳表、報表都能看）；推銷者本人只看自己的儀表板與帳本。新增帳號不用密碼（Google 登入），但要記得加進 Google Cloud 測試使用者。
- **帳號與身分切換**（2026-10-29）：系統管理員是蔡睿軒本人 juihsuantsai0923@gmail.com（super_admin，linked_teacher_id=2）；leviaxlab.official 已停用並移出 Google 測試使用者。管理員兼老師可在右上角「身分」切換管理員／老師：前端帶 `X-Act-As: teacher`，後端 `server/actAs.ts` 把該請求的角色降成 teacher_self，所有權限照老師規則跑（`ctx.user.realRole` 保留原角色）。
- **老師／推銷者本人看到的**：儀表板（`/{teacher|salesperson}/:id/dashboard`，`reports.personDashboard`：累積薪資、已發放、公司目前欠款、每月已發放圖；老師另外看得到全公司三個總數 `reports.companySummary`：總收入、總支出、公積金增減，以及月營業額圖（`reports.revenueEntries`，只給金額／來源／日期，不含項目與備註）和公積金走勢圖（`reports.timeline`，只擋推銷者））、我的帳本（`/:kind/:id`，子記帳表唯讀，可排序與篩選類型／類別／月份／搜尋）、代墊管理。看不到帳本（`mainLedger.list`、帳本 CSV 都擋 teacher_self）。管理員從「人員」選單點每個人，進到他的儀表板，上方可切換「儀表板／帳本」。頁面在 `client/src/pages/PersonPages.tsx`。
- **帳號設定頁已拿掉**（2026-10-29）：改用 Google 登入後不需要自己改姓名／密碼，`/account` 轉回儀表板，`users.changeOwnName／changeOwnPassword` 也刪了；要改人員資料由管理員在管理面板操作。
- **子記帳表唯讀**（2026-10-29）：教師／推銷者子記帳表沒有任何編輯、刪除（前端按鈕與後端 delete 端點都拿掉了）；要改請改帳本或代墊管理。
- **風格**（2026-10-29）：跟 Leviax 官網預設淺色主題一致。`tailwind.config.js` 的 brand-700＝官網 brand-navy #1e3a6e、brand-50／100＝brand-light／hover、gold-400＝#ffd172、`bg-gold-gradient`＝官網金色漸層；內文 Noto Sans TC、h1–h3 Noto Serif TC；頁首白底＋金色底線。
- **畫面名稱**（2026-10-29）：導覽列順序 儀表板 → 官網對帳 → 手動記帳（`/entry`，新增記錄表單）→ 帳本（`/ledger`，所有記錄列表；畫面上不再叫「母記帳表」，程式裡仍是 mainLedger）→ 人員（滑鼠移上去展開：直接列出每位在職老師的子記帳表＋推銷者名單；教師名單頁 `/teachers` 已拿掉）→ 代墊管理 → 管理面板 → 帳號設定。帳本不顯示編輯者（只有使用者本人操作），改顯示「最後編輯」（`edited_at`；`updated_at` 會被重算餘額改掉，不能用）。
- **備註格式**（`server/noteFormat.ts`，前後端共用）：`買家：…｜官網訂單：…｜優惠碼：…｜說明：…`，沒填的欄不出現。表單用 `NoteFields` 分欄填、列表用 `NoteView` 加標籤顯示。對帳靠買家姓名比對、靠「官網訂單」欄位擋重複入帳。
- **編輯記錄**（`mainLedger.update`、`EditEntryDialog.tsx`）：項目名稱、備註隨時可改；金額只有沒分給任何人的記錄能改（改完重算餘額），有分潤的要刪掉重記。
- **一筆多項**（2026-10-28，`server/combineIncome.ts`）：使用者要「一次記帳選很多個、一次記完」＝一筆記錄，不是拆成多筆。小班家教可一次勾多門課（`createTutoringIncome` 收 `items`），書籍本來就一筆多本。多項合成一筆時，每項的分潤各自寫進該老師子記帳表，`main_ledger.breakdown` 存 JSON `[{source,name,categoryId,amount}]`；來源不同時 `income_source = 'mixed'`、類別「多項收入」。報表一律用 `expandIncome()`（DashboardCharts.tsx）拆回每一項再算。
- 儀表板分析（`client/src/components/DashboardAnalytics.tsx`）：需要注意（代墊 >30 天、欠薪分潤 >60 天沒付、優惠碼到期）、本月 vs 上月、公積金走勢（`reports.timeline`，每月月底餘額／欠款／公積金，台灣時區）、營收排行（書籍依定價比例拆到每本）、支出分類（薪水合併）、小班家教預收（依 `courses.start_date`～`end_date` 線性估算）、月報 CSV 下載。
- **官網對帳**（`server/routers/webOrders.ts`、`client/src/pages/ReconcilePage.tsx`，2026-10-27，方法 B）：官網訂單快照存在 D1 `web_orders`（migration 0007）。對帳規則：已付款訂單找「項目或備註含買家姓名、下單前 3 天到後 60 天」的收入；金額＝實付→相符，＝實付＋折扣→記了原價；姓名對不到再找同金額 7 天內的記錄→可能對應。待付款＝應收帳款。可手動標「確認無誤／不需入帳」（`manual_status`，同步時會保留）。
  - **勾選訂單「確認入帳（已收到錢）」**（2026-10-28，`webOrders.previewRecord／recordOrders`、`server/webOrderRecord.ts`、`RecordOrdersDialog.tsx`）：應收或未入帳的訂單可勾選，**每張訂單記成母記帳表一筆**（不拆成多筆）。品項對應：課程名稱完全相同→小班家教／線上課程（「X先修課程（N年方案）」→ 線上課程、入帳金額用官網實付）；「科目先修課程（書名）」→ 書目；行事曆用價格對筆記本；對不到要在視窗手動選或設不入帳。官網折扣只攤到線上課程與書籍（小班家教不能用優惠碼）：先照官網算法還原（每項 round(基準×優惠碼比例)，線上課程基準＝課程原價 originalPrice、書籍＝售價，試記帳系統裡的優惠碼比例，總和等於官網折扣就用），對不上才依售價比例攤（`allocateDiscount`）；運費算進書籍。備註寫「官網訂單 編號｜買家 姓名」，同一張重複入帳會被擋。入帳後訂單 `manual_status = 'received'`（視同已付款，照一般規則對帳）。
  - **同步流程**（使用者說「同步官網訂單」時）：用 Chrome（使用者已登入官網後台）逐一讀 `https://leviax-lab.vercel.app/admin/orders?tab=pending|completed|cancelled` 的訂單卡片（每張卡是 `div.rounded-xl`，標頭行 `LX-YYYYMMDD-NNN · 日期 時間 · NT$實付 (-NT$折扣)`，下一行是狀態，之後「品名…NT$價格」直到「訂單進度」）→ 存成 `scripts/web_orders_to_sql.py` 開頭寫的 JSON 格式（放 scratchpad，不進 git）→ `python scripts/web_orders_to_sql.py 快照.json 輸出.sql` → `wrangler d1 execute --remote --file=輸出.sql`。只讀不改官網；**不存電話、地址、匯款末五碼**。
- **立即同步按鈕（書籤小工具）**（2026-10-27）：對帳頁「立即同步官網訂單」會開官網訂單頁，使用者在那個分頁點書籤「⇅ 同步到記帳」→ 書籤載入 `client/public/web-orders-sync.js`（Pages 提供），用隱藏 iframe 讀三個分頁、POST 到 Worker 的 `/api/web-orders/sync`（Express 版同路徑）→ 回到 `/reconcile?synced=1`。
  - 驗證用「官網同步金鑰」（`integration_keys` 表、migration 0008，只存 SHA-256；`webOrders.generateSyncKey` 限 super_admin，重新產生舊書籤就失效）。金鑰只能寫入訂單快照，不能讀帳務。共用邏輯在 `server/webOrdersSync.ts`。
  - 官網改版導致讀不到時，改 `web-orders-sync.js` 的解析就好，不用使用者重拖書籤（書籤只帶設定、每次都載入最新腳本）。官網目前沒有 CSP，外部腳本能載入；哪天官網加了 CSP 就要改成把腳本整段塞進書籤。
- **官網自動同步**（2026-10-29）：官網伺服器在新訂單／狀態改變／商品改變時 POST 到 `/api/web-orders/push`（`Authorization: Bearer <自動同步金鑰>`，金鑰名 `web_orders_push`，跟書籤金鑰分開）。物件格式由 `handlePushRequest` 轉成書籤的陣列格式再走 `upsertWebOrders`／`upsertCatalog`；商品清單每份都是整份（沒送的那份不動）。規格給官網工程師：`docs/官網自動同步規格.md`。對帳頁上方「官網自動同步」顯示最後推送時間、產生金鑰；頁面每分鐘自動重新整理。書籤手動同步保留當備援。
- **創始基金是要還的借款**（使用者 2026-10-27 確認）：記成收入並分回出資人子帳＝公司欠他；不算營業額；`personStats.loan` 會單獨列出，欠薪提醒會扣掉這部分。
- 儀表板圖表（`client/src/components/DashboardCharts.tsx`，recharts）：月營業額（依收入來源堆疊，舊記錄用類別名稱推回來源）、每人營業額（`reports.personStats` 的 earned）、每人欠薪（balance）。「創始基金」視為股東投入，不算營業額。配色照 dataviz 規範驗證過，黃／綠對比不足所以附「顯示表格」。

- **公司等級**（2026-11-03，`client/src/lib/levels.ts`、`LevelCard.tsx`）：累計營業額（不含創始基金）換算等級，Lv1＝1 萬；Lv1–10 每級 +1 萬、11–20 +2 萬、21–30 +5 萬、31–40 +10 萬、41–50 +20 萬、51 起 +50 萬；每 10 級一個稱號（起步、成長、突破、卓越、傳奇、殿堂）。管理員儀表板與老師儀表板最上方都有。
- **分析頁**（`/analytics`，`AnalyticsPage.tsx`、`client/src/lib/analytics.ts`，老師／推銷者看不到）：損益表（每月／季／年，較上期、較去年同期；分潤算成本、薪水撥款不重複算、創始基金另列）＋客戶分析（以備註的買家姓名為客戶：客戶數、回購率、客單價、每月新客與回購、購買組合、各科人數、客戶排行）。
- **出貨員**（2026-11-03，`shippers` 表、角色 `shipper_self`＋`users.linked_shipper_id`）：登入後只看得到「我的代墊」（`/advance`，前端 `RequireAuth` 把其他網址導回來；後端 `trpc.ts` 的 `SHIPPER_PATHS` 白名單，其他 API 一律 FORBIDDEN）。可以新增自己的代墊、修改／刪除自己未核銷的，看不到別人的。出貨員沒有分潤，沒有子記帳表資料表：欠他的錢＝未核銷代墊（儀表板公積金、未核銷代墊總額都有算進去）。管理員按「核銷並記入帳本」（`advancePayments.settle`／一次全部 `settleShipper`）→ 依類別各記一筆帳本支出（支出類型名稱＝類別，「其他」→「其他支出」，沒有就自動建立），代墊連到那筆支出；刪掉那筆支出代墊自動退回未核銷（出貨員代墊不能直接「取消核銷」）。管理面板「出貨員與代墊類別」管理名單與類別，「帳號與權限」角色選出貨員並綁定。
- **帳號申請**（2026-11-03，`account_requests`、`routers/accountRequests.ts`）：沒有帳號的 Gmail 用 Google 登入 → `auth.googleLogin` 丟 NOT_FOUND `NO_ACCOUNT|email|Google姓名` → 登入頁顯示申請表（姓名、我是 老師／推銷員／出貨員／其他、備註）→ `auth.requestAccess` 再驗證一次 Google token、存申請（同一個 email 只有一筆，重送不重複通知）、LINE 通知管理員。待處理／被拒絕的人再登入會看到對應訊息。管理面板「帳號申請」核准時選角色＋綁定的人（同名預設選他，沒有可直接新增教師／推銷者／出貨員），建立帳號；拒絕後可刪紀錄讓他重新申請。儀表板有待處理申請會顯示提醒，每日 9 點 LINE 也會提醒。前提：Google OAuth 同意畫面要「發布」成正式版，否則沒加進測試使用者的 Gmail 連 Google 登入都過不了。
- **代墊審核**（2026-11-05，migration 0020，`advance_payments.review_status`／`review_note`）：老師（`teacher_self`）、出貨員自己登記的代墊是 pending，LINE 通知管理員、畫面右下角跳提醒、導覽列顯示數字、每日 9 點也提醒；管理員在代墊管理按「通過」才算公司欠的（教師代墊這時才進子記帳表），「退回」可寫原因給本人看。本人修改已通過的代墊會退回 pending 並拿掉子記帳表那行。管理員自己登記、切成老師身分登記的不用審核。pending／rejected 不能核銷，也不算進儀表板的未核銷總額。老師沒有官網訂單清單（`orderOptions` 回空），訂單名稱手打；推銷者本人帳號目前不能自己登記。
- **多筆代墊**（2026-11-06）：代墊管理「複選訂單」勾選多張官網訂單、每張填金額，`advancePayments.createBatch` 一次登記（同類別，一次最多 150 筆避開 Worker 查詢上限；要審核的只發一則 LINE）。`orderOptions` 帶 `registeredCategories`，同類別登記過的訂單會標示、全選時跳過。待審核有多筆時可按「全部通過」。
- **代墊欄位**（2026-11-03，migration 0019）：訂單名稱（可從最近 120 天官網訂單選，`advancePayments.orderOptions`，會帶入訂單編號與下訂人）、下訂人（只存姓名）、類別（`advance_categories`，預設運費／其他，填代墊時可直接新增，管理員可刪）。`item_name` 自動組成「下訂人_類別」（手動記帳頁的代墊沿用自己打的名稱）。教師／推銷者代墊修改後會同步子記帳表那一行並重算餘額。
- **稅務專區**（`/tax`，`TaxPage.tsx`、`client/src/lib/tax.ts`，老師／推銷者看不到）：每月營業額拆勞務／貨物並標示是否達起徵點（勞務 5 萬、貨物 10 萬，114 年起）與 20 萬小規模上限、可能的稅務問題（稅籍登記、小規模、補習班立案、預收學費、老師扣繳與補充保費、書籍、創始基金、收款帳戶）、營業稅四種情境、所得稅（公司／獨資合夥／小規模）、老師撥款的扣繳與補充保費、報稅行事曆、參考資料。數字用 115 年度規定（`TAX` 常數），每年要更新。
- **定期收支**（管理面板「定期收支」，`server/recurring.ts`、`routers/recurring.ts`、表 `recurring_entries`）：使用者自己設定每月固定的收入或支出與幾號（1–28），不分給任何人；薪水類別不能設。
- **每日排程**（`wrangler.toml [triggers]` 每天 UTC 01:00＝台灣 9 點，`server/dailyJob.ts`）：記到期的定期收支、帳務檢查、官網對帳（對不上、待付款超過 3 天），有事才發 LINE。
- **LINE 通知**（`server/lineNotify.ts`、管理面板「LINE 通知」）：官網推送有新訂單或狀態改變時馬上通知、每日排程的提醒。金鑰是 Worker secret `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_NOTIFY_TO`（LINE user ID，可逗號分多人），使用者自己用 `wrangler secret put` 設，不要幫他輸入；沒設就不發。
- **月結對帳單**（`/teacher/:id/statement`、`/salesperson/:id/statement`，`PersonStatementPage`）：月初欠款、本月分潤明細（含買家）、本月撥款、代墊、月底欠款；「列印／存成 PDF」用瀏覽器列印，`.no-print` 的元素（頁首、按鈕）不印。
- **分潤規則更新（2026-11-10，使用者同意）**：比例不變、舊帳金額不變。
  - **營業稅**：`revenue_settings.registration_date`（還沒登記＝null）當天或之後入帳的收入，先扣 round(實收×vat_rate/(1+vat_rate)) 存 `main_ledger.tax_amount`（稅金準備），剩下的再分；網紅佣金用扣稅後售價算（`splitWithAdminFee`、`vatOf`）。支出類型「營業稅」的 tax_amount＝金額，從稅金準備付、不扣公積金。公積金一律再扣稅金準備（`reserveTrail`、`timeline`、`companySummary`、儀表板、帳本 `reserveDelta`）。
  - **上了課才按月發**（`server/payroll.ts`、`routers/payroll.ts`）：每月最後一天發「當月底以前已到期 − 已發放」（2026-11-10 使用者改成月底，不是 15 日）。**按天攤提只用在稅籍登記日以後入帳的**衝刺班分潤、行政費（子記帳表 `vest_course_id`，依課程 start_date～end_date）；登記前的帳（這一屆，使用者 2026 年內手動發完）和其他收入入帳就到期。插班生入班前的天數在入帳當月的月底一次到期。已發放＞已到期＝預付：可發 0、顯示「已預付」，欠款不顯示負數。部分入帳的未收部分不到期，補收記在 `payment_receipts`（`receivePayment`、編輯未入帳金額時寫入）。子記帳表餘額不變。
  - **發薪表** `/payroll`（`payroll.table` 只給 super_admin／finance_staff）：每人一列、每個月底一欄（應發／已發），下次發薪那欄可「記錄發放」（`payroll.markPaid`＝記一筆該人的薪水撥款，同月份的撥款算那次）、下載 CSV。本人看 `payroll.person`（老師、推銷者換成自己；出貨員看同名推銷者，在 SHIPPER_PATHS）：個人儀表板、出貨員「我的代墊」、月結對帳單都有「這個月底可發／已預付／尚未到期」。
  - **公積金水位與年終**：`reserve_floor`（10 萬）、`reserve_frozen`（補稅準備凍結 3.7 萬，問完記帳士改 0）在管理面板「分潤參數」改；年終結算（`payroll.yearEndPreview／yearEndApply`）＝公積金 − 凍結 − 水位 − 次年預留，依當年分潤占比寫進子記帳表「YYYY 年終分潤」（類別 年終分潤，不算下一年占比）。
  - 用備份驗算：`npx.cmd tsx scripts/check_payroll_on_backup.ts 備份.sql migrations/0025_payroll_vat.sql --now=YYYY-MM-DD`。

## 工作習慣

- 使用者以繁體中文溝通，回覆也請用繁體中文，並簡潔說明改了什麼、要跑哪些部署指令。
- 每次改完都 commit（訊息用中文，結尾加 Co-Authored-By）。部署只在使用者說「部署」時做；改正式資料前先 `wrangler d1 export` 備份到 `03_網站與系統\記帳系統\資料庫備份\D1備份_日期_說明.sql`。
- **不要在資料庫直接刪改帳務資料**：一定要改時，改完重算餘額，並看儀表板「需要注意」的帳務檢查（`server/integrity.ts`、`reports.integrity`：帳本餘額、子記帳表餘額、分配表與子記帳表是否一致）沒有警告。
- 測試：`npm.cmd test`（`tests/`，node:test＋記憶體 SQLite，涵蓋折扣分攤、書籍分潤、行事曆、運費、舊帳重算、帳務檢查）。改 `revenueCalc.ts`、`webOrderRecord.ts`、`bookShares.ts` 後一定要跑。
- wrangler 4 的 `d1 execute --remote --file=` 走 import API，2026-11-03 回 Authentication error 10000；改用 `--command "SQL"` 就可以。
- wrangler 是 4 版（2026-11-02 升級）；`workerd` 的 postinstall 沒核准，只影響本機 `wrangler dev`，部署和 d1 指令不受影響。
