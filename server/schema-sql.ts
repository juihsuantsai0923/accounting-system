/**
 * 建表用的原生 SQL（與 server/schema.ts 的 Drizzle schema 定義一一對應）。
 * 之所以不完全依賴 `drizzle-kit push`，是因為它在部分環境（特定 better-sqlite3
 * 版本組合）下會出現 "This statement does not return data" 的已知相容性問題。
 * 這裡的語句全部帶 IF NOT EXISTS，可以安全地在每次啟動時重複執行。
 */
export const createTableStatements: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'finance_staff',
    linked_teacher_id INTEGER,
    linked_salesperson_id INTEGER,
    linked_shipper_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_signed_in INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email)`,

  `CREATE TABLE IF NOT EXISTS account_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    requested_role TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by INTEGER,
    decided_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS account_requests_email_idx ON account_requests(email)`,

  `CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    note TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS teachers_name_idx ON teachers(name)`,

  `CREATE TABLE IF NOT EXISTS salespeople (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    note TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS salespeople_name_idx ON salespeople(name)`,

  `CREATE TABLE IF NOT EXISTS shippers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    note TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS shippers_name_idx ON shippers(name)`,

  `CREATE TABLE IF NOT EXISTS advance_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS advance_categories_name_idx ON advance_categories(name)`,
  `INSERT OR IGNORE INTO advance_categories (name, created_at) VALUES ('運費', 0), ('其他', 0)`,

  `CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'personal',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS expense_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    teacher_id INTEGER,
    salesperson_id INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS expense_types_name_idx ON expense_types(name)`,

  `CREATE TABLE IF NOT EXISTS income_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS income_types_name_idx ON income_types(name)`,

  `CREATE TABLE IF NOT EXISTS main_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    category_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance INTEGER NOT NULL,
    note TEXT,
    attachment_url TEXT,
    edited_by INTEGER,
    deleted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ledger_distribution (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    main_ledger_id INTEGER NOT NULL,
    distribution_type TEXT NOT NULL,
    recipient_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS teacher_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    main_ledger_id INTEGER,
    advance_payment_id INTEGER,
    source_type TEXT NOT NULL DEFAULT 'distribution',
    type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    category_id INTEGER,
    category_name TEXT,
    original_amount INTEGER,
    personal_amount INTEGER NOT NULL,
    personal_balance INTEGER NOT NULL,
    edited_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS salesperson_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    salesperson_id INTEGER NOT NULL,
    main_ledger_id INTEGER,
    advance_payment_id INTEGER,
    source_type TEXT NOT NULL DEFAULT 'distribution',
    type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    category_id INTEGER,
    category_name TEXT,
    original_amount INTEGER,
    personal_amount INTEGER NOT NULL,
    personal_balance INTEGER NOT NULL,
    edited_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS payment_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    main_ledger_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    received_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS advance_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_type TEXT NOT NULL,
    recipient_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    order_name TEXT,
    order_no TEXT,
    buyer TEXT,
    category TEXT,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'unsettled',
    review_status TEXT NOT NULL DEFAULT 'approved',
    review_note TEXT,
    settled_by_main_ledger_id INTEGER,
    settled_at INTEGER,
    attachment_url TEXT,
    note TEXT,
    edited_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    before_data TEXT,
    after_data TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS revenue_settings (
    id INTEGER PRIMARY KEY,
    base_discount REAL NOT NULL DEFAULT 0.6,
    coupon_discount INTEGER NOT NULL DEFAULT 750,
    referral_bonus INTEGER NOT NULL DEFAULT 500,
    platform_fee_rate REAL NOT NULL DEFAULT 0.2,
    team_bonus_rate REAL NOT NULL DEFAULT 0.16666666666666666,
    material_cost INTEGER NOT NULL DEFAULT 300,
    monthly_subscription INTEGER NOT NULL DEFAULT 350,
    estimated_monthly_sales INTEGER NOT NULL DEFAULT 30,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS revenue_team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_type TEXT NOT NULL,
    recipient_id INTEGER NOT NULL,
    weight REAL NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'book',
    price INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS books_name_idx ON books(name)`,

  `CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    discount_rate REAL NOT NULL,
    valid_until TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    salesperson_id INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_idx ON coupons(code)`,

  `CREATE TABLE IF NOT EXISTS web_orders (
    order_no TEXT PRIMARY KEY,
    ordered_at INTEGER NOT NULL,
    buyer TEXT NOT NULL,
    total INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    status_label TEXT NOT NULL,
    tab TEXT NOT NULL,
    items TEXT NOT NULL,
    synced_at INTEGER NOT NULL,
    manual_status TEXT,
    manual_note TEXT,
    tracking_code TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS recurring_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    day_of_month INTEGER NOT NULL,
    note TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_run_month TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS integration_keys (
    name TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  )`,
];

/**
 * 既有資料庫的資料表可能是舊版建立的，缺少後續新增的欄位。
 * CREATE TABLE IF NOT EXISTS 不會幫既有資料表補欄位，所以額外用 ALTER TABLE 處理。
 * 每一條都先檢查欄位是否已存在，重複執行也安全（見 db.ts / migrations/*.sql）。
 */
export const courseColumnMigrations: { column: string; statement: string }[] = [
  { column: "teacher_id", statement: `ALTER TABLE courses ADD COLUMN teacher_id INTEGER` },
  { column: "base_price", statement: `ALTER TABLE courses ADD COLUMN base_price INTEGER` },
  { column: "original_price", statement: `ALTER TABLE courses ADD COLUMN original_price INTEGER` },
  { column: "category", statement: `ALTER TABLE courses ADD COLUMN category TEXT NOT NULL DEFAULT 'online'` },
  { column: "start_date", statement: `ALTER TABLE courses ADD COLUMN start_date TEXT` },
  { column: "end_date", statement: `ALTER TABLE courses ADD COLUMN end_date TEXT` },
];

export const mainLedgerColumnMigrations: { column: string; statement: string }[] = [
  { column: "income_source", statement: `ALTER TABLE main_ledger ADD COLUMN income_source TEXT` },
  { column: "breakdown", statement: `ALTER TABLE main_ledger ADD COLUMN breakdown TEXT` },
  { column: "edited_at", statement: `ALTER TABLE main_ledger ADD COLUMN edited_at INTEGER` },
  { column: "unpaid_amount", statement: `ALTER TABLE main_ledger ADD COLUMN unpaid_amount INTEGER NOT NULL DEFAULT 0` },
  { column: "tax_amount", statement: `ALTER TABLE main_ledger ADD COLUMN tax_amount INTEGER NOT NULL DEFAULT 0` },
];

export const teacherLedgerColumnMigrations: { column: string; statement: string }[] = [
  { column: "vest_course_id", statement: `ALTER TABLE teacher_ledger ADD COLUMN vest_course_id INTEGER` },
];

export const salespersonLedgerColumnMigrations: { column: string; statement: string }[] = [
  { column: "vest_course_id", statement: `ALTER TABLE salesperson_ledger ADD COLUMN vest_course_id INTEGER` },
];

export const userColumnMigrations: { column: string; statement: string }[] = [
  { column: "linked_shipper_id", statement: `ALTER TABLE users ADD COLUMN linked_shipper_id INTEGER` },
];

export const advanceColumnMigrations: { column: string; statement: string }[] = [
  { column: "order_name", statement: `ALTER TABLE advance_payments ADD COLUMN order_name TEXT` },
  { column: "order_no", statement: `ALTER TABLE advance_payments ADD COLUMN order_no TEXT` },
  { column: "buyer", statement: `ALTER TABLE advance_payments ADD COLUMN buyer TEXT` },
  { column: "category", statement: `ALTER TABLE advance_payments ADD COLUMN category TEXT` },
  { column: "review_status", statement: `ALTER TABLE advance_payments ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'` },
  { column: "review_note", statement: `ALTER TABLE advance_payments ADD COLUMN review_note TEXT` },
];

export const revenueSettingsColumnMigrations: { column: string; statement: string }[] = [
  { column: "base_discount", statement: `ALTER TABLE revenue_settings ADD COLUMN base_discount REAL NOT NULL DEFAULT 0.6` },
  { column: "tutoring_reserve_rate", statement: `ALTER TABLE revenue_settings ADD COLUMN tutoring_reserve_rate REAL NOT NULL DEFAULT 0.1` },
  { column: "reserve_rate", statement: `ALTER TABLE revenue_settings ADD COLUMN reserve_rate REAL NOT NULL DEFAULT 0.1` },
  { column: "admin_fee_rate", statement: `ALTER TABLE revenue_settings ADD COLUMN admin_fee_rate REAL NOT NULL DEFAULT 0.1` },
  { column: "book_reserve_rate", statement: `ALTER TABLE revenue_settings ADD COLUMN book_reserve_rate REAL NOT NULL DEFAULT 0.25` },
  { column: "vat_rate", statement: `ALTER TABLE revenue_settings ADD COLUMN vat_rate REAL NOT NULL DEFAULT 0.05` },
  { column: "registration_date", statement: `ALTER TABLE revenue_settings ADD COLUMN registration_date TEXT` },
  { column: "reserve_floor", statement: `ALTER TABLE revenue_settings ADD COLUMN reserve_floor INTEGER NOT NULL DEFAULT 100000` },
  { column: "reserve_frozen", statement: `ALTER TABLE revenue_settings ADD COLUMN reserve_frozen INTEGER NOT NULL DEFAULT 37000` },
];
