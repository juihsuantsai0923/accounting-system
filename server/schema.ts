import { sqliteTable, integer, text, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
};

// ── Users / 帳號與角色 ─────────────────────────────
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    // super_admin / finance_staff / teacher_self / salesperson_self / shipper_self
    role: text("role").notNull().default("finance_staff"),
    linkedTeacherId: integer("linked_teacher_id"),
    linkedSalespersonId: integer("linked_salesperson_id"),
    linkedShipperId: integer("linked_shipper_id"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastSignedIn: integer("last_signed_in"),
    ...timestamps,
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  })
);

// ── AccountRequests / 帳號申請（沒有帳號的人用 Google 登入時填的申請，管理員核准才建立帳號） ─────────────────────────────
export const accountRequests = sqliteTable(
  "account_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(), // 一律小寫
    name: text("name").notNull(),
    requestedRole: text("requested_role").notNull(), // teacher | salesperson | shipper | other（只是參考，核准時由管理員決定）
    note: text("note"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    decidedBy: integer("decided_by"),
    decidedAt: integer("decided_at"),
    ...timestamps,
  },
  (t) => ({ emailIdx: uniqueIndex("account_requests_email_idx").on(t.email) })
);

// ── Teachers / 教師 ─────────────────────────────
export const teachers = sqliteTable(
  "teachers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    phone: text("phone"),
    note: text("note"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => ({ nameIdx: uniqueIndex("teachers_name_idx").on(t.name) })
);

// ── Salespeople / 推銷者 ─────────────────────────────
export const salespeople = sqliteTable(
  "salespeople",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    phone: text("phone"),
    note: text("note"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => ({ nameIdx: uniqueIndex("salespeople_name_idx").on(t.name) })
);

// ── Shippers / 出貨員（只能登記自己的代墊；子記帳表＝自己的代墊與核銷，不分潤） ─────────────────────────────
export const shippers = sqliteTable(
  "shippers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    note: text("note"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => ({ nameIdx: uniqueIndex("shippers_name_idx").on(t.name) })
);

// ── AdvanceCategories / 代墊類別（運費、其他，填代墊時可以直接新增） ─────────────────────────────
export const advanceCategories = sqliteTable(
  "advance_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  },
  (t) => ({ nameIdx: uniqueIndex("advance_categories_name_idx").on(t.name) })
);

// ── Courses / 課程 ─────────────────────────────
export const courses = sqliteTable("courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull().default("personal"), // personal | collaborative
  teacherId: integer("teacher_id"), // 課程主理教師（分潤精靈用來決定 80% 主理分潤歸屬）
  basePrice: integer("base_price"), // （舊欄位，保留相容）早鳥價／基礎售價
  originalPrice: integer("original_price"), // 原價（分潤精靈依「基礎折數＋年期加成」從這裡算出實際入帳金額）
  // online：線上課程（走課程收入分潤精靈）／tutoring：小班家教（實收金額扣公積金比例後全給主理教師）
  category: text("category").notNull().default("online"),
  // 小班家教上課期間（YYYY-MM-DD），用來估算「已收但還沒上的課」
  startDate: text("start_date"),
  endDate: text("end_date"),
  ...timestamps,
});

// ── Books / 書籍（含筆記本、組合包）：書籍收入依科目分給老師（見 revenueCalc.ts splitBookIncome），行事曆全留公積金 ─────────────────────────────
export const books = sqliteTable(
  "books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("book"), // book | workbook | bundle | notebook
    price: integer("price").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => ({ nameIdx: uniqueIndex("books_name_idx").on(t.name) })
);

// ── Coupons / 優惠碼（書籍收入記帳時選用，依折扣比例算出實收金額） ─────────────────────────────
export const coupons = sqliteTable(
  "coupons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull(),
    discountRate: real("discount_rate").notNull(), // 0.15 = 折 15%
    validUntil: text("valid_until"), // YYYY-MM-DD，空白＝不限期
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    salespersonId: integer("salesperson_id"), // 這組網紅碼的佣金給誰（推銷者）
    ...timestamps,
  },
  (t) => ({ codeIdx: uniqueIndex("coupons_code_idx").on(t.code) })
);

// ── ExpenseTypes / 支出類型 ─────────────────────────────
export const expenseTypes = sqliteTable(
  "expense_types",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    teacherId: integer("teacher_id"),
    salespersonId: integer("salesperson_id"),
    ...timestamps,
  },
  (t) => ({ nameIdx: uniqueIndex("expense_types_name_idx").on(t.name) })
);

// ── IncomeTypes / 其他收入類型（不含課程收入，課程收入走課程收入分潤精靈） ─────────────────────────────
export const incomeTypes = sqliteTable(
  "income_types",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => ({ nameIdx: uniqueIndex("income_types_name_idx").on(t.name) })
);

// ── MainLedger / 母記帳表 ─────────────────────────────
export const mainLedger = sqliteTable("main_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // income | expense
  itemName: text("item_name").notNull(),
  categoryId: integer("category_id").notNull(),
  categoryName: text("category_name").notNull(),
  amount: integer("amount").notNull(),
  balance: integer("balance").notNull(),
  note: text("note"),
  attachmentUrl: text("attachment_url"),
  // 收入來源：course（線上課程）／tutoring（小班家教）／book（書籍）／trial（試上）／other（其他收入）；舊資料與支出為 null
  incomeSource: text("income_source"),
  // 一筆記錄含多個項目時（例如一張官網訂單有多門課＋書）：JSON [{ source, name, categoryId, amount }]，報表依這個拆開算
  breakdown: text("breakdown"),
  // 部分入帳：amount 記整張訂單，這裡是家長還沒付的部分（公積金暫時吸收）
  unpaidAmount: integer("unpaid_amount").notNull().default(0),
  // 營業稅（2026-11-10）：收入＝登記日以後先扣下來放「稅金準備」的金額；「營業稅」支出＝金額（從稅金準備付，不扣公積金）
  taxAmount: integer("tax_amount").notNull().default(0),
  // 最後一次由人新增／編輯的時間（重算餘額不會動到它；updated_at 會被重算改掉，不能拿來顯示）
  editedAt: integer("edited_at"),
  editedBy: integer("edited_by"),
  deletedAt: integer("deleted_at"),
  ...timestamps,
});

// ── LedgerDistribution / 分配詳情 ─────────────────────────────
export const ledgerDistribution = sqliteTable("ledger_distribution", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mainLedgerId: integer("main_ledger_id").notNull(),
  distributionType: text("distribution_type").notNull(), // teacher | salesperson
  recipientId: integer("recipient_id").notNull(),
  amount: integer("amount").notNull(),
  ...timestamps,
});

// ── TeacherLedger / 教師子記帳表 ─────────────────────────────
export const teacherLedger = sqliteTable("teacher_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teacherId: integer("teacher_id").notNull(),
  mainLedgerId: integer("main_ledger_id"), // nullable: advance entries have no main ledger row
  advancePaymentId: integer("advance_payment_id"),
  sourceType: text("source_type").notNull().default("distribution"), // distribution | advance | advance_settlement
  type: text("type").notNull(), // income | expense | advance
  itemName: text("item_name").notNull(),
  categoryId: integer("category_id"),
  categoryName: text("category_name"),
  originalAmount: integer("original_amount"),
  personalAmount: integer("personal_amount").notNull(),
  personalBalance: integer("personal_balance").notNull(),
  editedBy: integer("edited_by"),
  // 小班衝刺班的分潤／行政費：依這門課 start_date～end_date 按天攤提到期（2026-11-10）；其他收入是 null＝入帳就到期
  vestCourseId: integer("vest_course_id"),
  ...timestamps,
});

// ── SalespersonLedger / 推銷者子記帳表 ─────────────────────────────
export const salespersonLedger = sqliteTable("salesperson_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  salespersonId: integer("salesperson_id").notNull(),
  mainLedgerId: integer("main_ledger_id"),
  advancePaymentId: integer("advance_payment_id"),
  sourceType: text("source_type").notNull().default("distribution"),
  type: text("type").notNull(),
  itemName: text("item_name").notNull(),
  categoryId: integer("category_id"),
  categoryName: text("category_name"),
  originalAmount: integer("original_amount"),
  personalAmount: integer("personal_amount").notNull(),
  personalBalance: integer("personal_balance").notNull(),
  editedBy: integer("edited_by"),
  vestCourseId: integer("vest_course_id"),
  ...timestamps,
});

// ── PaymentReceipts / 部分入帳的訂單之後補收的學費（補收那部分的分潤從收到錢起才算到期） ─────────────
export const paymentReceipts = sqliteTable("payment_receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mainLedgerId: integer("main_ledger_id").notNull(),
  amount: integer("amount").notNull(),
  receivedAt: integer("received_at").notNull(),
});

// ── AdvancePayments / 代墊記錄表 ─────────────────────────────
export const advancePayments = sqliteTable("advance_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipientType: text("recipient_type").notNull(), // teacher | salesperson | shipper
  recipientId: integer("recipient_id").notNull(),
  itemName: text("item_name").notNull(), // 自動組成「下訂人_類別」
  orderName: text("order_name"), // 訂單名稱（官網訂單＝編號＋品項，或手打）
  orderNo: text("order_no"), // 從官網訂單選的才有；多張訂單合成一筆時用逗號分隔
  buyer: text("buyer"), // 下訂人（只存姓名）
  category: text("category"), // 運費、其他…（advance_categories）
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("unsettled"), // unsettled | settled
  reviewStatus: text("review_status").notNull().default("approved"), // pending | approved | rejected（老師、出貨員自己登記的要管理員審核）
  reviewNote: text("review_note"), // 退回原因
  settledByMainLedgerId: integer("settled_by_main_ledger_id"),
  settledAt: integer("settled_at"),
  attachmentUrl: text("attachment_url"),
  note: text("note"),
  editedBy: integer("edited_by"),
  ...timestamps,
});

// ── AuditLog / 稽核軌跡 ─────────────────────────────
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorId: integer("actor_id"),
  action: text("action").notNull(), // create | update | delete | settle | unsettle
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  beforeData: text("before_data"),
  afterData: text("after_data"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});

// ── RevenueSettings / 課程分潤與成本結構設定（單一列，id 固定為 1） ─────────────────────────────
export const revenueSettings = sqliteTable("revenue_settings", {
  id: integer("id").primaryKey(),
  baseDiscount: real("base_discount").notNull().default(0.6), // 目前基礎折數（1 年期），例如 0.6 代表 6 折
  couponDiscount: integer("coupon_discount").notNull().default(750), // 優惠碼折抵金額
  referralBonus: integer("referral_bonus").notNull().default(500), // 推廣/行銷人員抽成金額
  platformFeeRate: real("platform_fee_rate").notNull().default(0.2), // 平台費比例（0~1）
  teamBonusRate: real("team_bonus_rate").notNull().default(50 / 3 / 100), // 每位團隊成員從平台費中抽取的比例（0~1）
  materialCost: integer("material_cost").notNull().default(300), // 教材/物流成本（每套課程）
  monthlySubscription: integer("monthly_subscription").notNull().default(350), // 網站訂閱費（每月固定）
  estimatedMonthlySales: integer("estimated_monthly_sales").notNull().default(30), // 預估月銷量，用來分攤月固定成本
  tutoringReserveRate: real("tutoring_reserve_rate").notNull().default(0.1), // （舊欄位，2026-10-29 起改用 reserve_rate）
  // 2026-10-29 起只用這兩個：公積金比例（線上課程、書籍、小班家教）、行政費比例（線上課程、書籍，團隊三人平分）
  // 上面其他欄位是舊的分潤精靈參數，保留欄位但不再使用
  reserveRate: real("reserve_rate").notNull().default(0.1),
  adminFeeRate: real("admin_fee_rate").notNull().default(0.1),
  bookReserveRate: real("book_reserve_rate").notNull().default(0.25), // 書籍公積金比例（2026-11-02 起）
  // 2026-11-10：營業稅率、稅籍登記日（YYYY-MM-DD，還沒登記＝null；這天起的收入才扣營業稅）
  vatRate: real("vat_rate").notNull().default(0.05),
  registrationDate: text("registration_date"),
  // 公積金最低水位、補稅準備（凍結，公積金的一部分，先標記不可用）
  reserveFloor: integer("reserve_floor").notNull().default(100000),
  reserveFrozen: integer("reserve_frozen").notNull().default(37000),
  // 登記前帳款分期：稅籍登記日以前入帳的，從第一期（月底）起平均分幾期發，最後一期結清
  preregInstallments: integer("prereg_installments").notNull().default(2),
  preregFirstPayday: text("prereg_first_payday").notNull().default("2026-11-30"),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});

// ── RevenueTeamMembers / 團隊獎金固定分配名單（例如：老闆、行銷、技術） ─────────────────────────────
export const revenueTeamMembers = sqliteTable("revenue_team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipientType: text("recipient_type").notNull(), // teacher | salesperson
  recipientId: integer("recipient_id").notNull(),
  weight: real("weight").notNull().default(1), // 行政費分配權重（依權重比例分）
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});

// ── WebOrders / 官網訂單快照（對帳、應收帳款用；不存電話、地址、匯款末五碼） ─────────────────────────────
export const webOrders = sqliteTable("web_orders", {
  orderNo: text("order_no").primaryKey(),
  orderedAt: integer("ordered_at").notNull(),
  buyer: text("buyer").notNull(),
  total: integer("total").notNull(), // 官網實付金額（已扣折扣、含運費）
  discount: integer("discount").notNull().default(0),
  statusLabel: text("status_label").notNull(), // 官網顯示的狀態，例如 待付款、課程已開通、訂單完成、已取消
  tab: text("tab").notNull(), // pending | completed | cancelled
  items: text("items").notNull(), // JSON：[{ name, price, preorder, bundle }]
  syncedAt: integer("synced_at").notNull(),
  manualStatus: text("manual_status"), // 記帳這邊手動標記：matched（已人工確認）| ignored（不需入帳）| received（已確認收款並入帳）
  manualNote: text("manual_note"),
  trackingCode: text("tracking_code"), // 官網後台填的寄件代碼；同一個代碼＝同一包
});

// ── IntegrationKeys / 外部整合金鑰（只存 SHA-256；目前只有官網訂單同步書籤） ─────────────────────────────
export const integrationKeys = sqliteTable("integration_keys", {
  name: text("name").primaryKey(),
  keyHash: text("key_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
});

// ── RecurringEntries / 每月定期收支（自己設定，每天早上 9 點的排程到了那天就自動記一筆） ─────────────────────────────
export const recurringEntries = sqliteTable("recurring_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // income | expense
  itemName: text("item_name").notNull(),
  categoryId: integer("category_id").notNull(), // income → income_types；expense → expense_types（不能是薪水）
  amount: integer("amount").notNull(),
  dayOfMonth: integer("day_of_month").notNull(), // 每月幾號（1–28）
  note: text("note"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastRunMonth: text("last_run_month"), // 最後一次自動記帳的月份 YYYY-MM（同一個月只記一次）
  ...timestamps,
});

export const schemaSql = sql;
