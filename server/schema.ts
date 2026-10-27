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
    // super_admin / finance_staff / viewer / teacher_self / salesperson_self
    role: text("role").notNull().default("finance_staff"),
    linkedTeacherId: integer("linked_teacher_id"),
    linkedSalespersonId: integer("linked_salesperson_id"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastSignedIn: integer("last_signed_in"),
    ...timestamps,
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  })
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

// ── Books / 書籍（含筆記本、組合包）：書籍收入全數留給公積金，不分給任何人 ─────────────────────────────
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
  // 收入來源：course（線上課程）／tutoring（小班家教）／book（書籍）／other（其他收入）；舊資料與支出為 null
  incomeSource: text("income_source"),
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
  ...timestamps,
});

// ── AdvancePayments / 代墊記錄表 ─────────────────────────────
export const advancePayments = sqliteTable("advance_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipientType: text("recipient_type").notNull(), // teacher | salesperson
  recipientId: integer("recipient_id").notNull(),
  itemName: text("item_name").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("unsettled"), // unsettled | settled
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
  tutoringReserveRate: real("tutoring_reserve_rate").notNull().default(0.1), // 小班家教留給公積金的比例（0~1）
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});

// ── RevenueTeamMembers / 團隊獎金固定分配名單（例如：老闆、行銷、技術） ─────────────────────────────
export const revenueTeamMembers = sqliteTable("revenue_team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipientType: text("recipient_type").notNull(), // teacher | salesperson
  recipientId: integer("recipient_id").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});

export const schemaSql = sql;
