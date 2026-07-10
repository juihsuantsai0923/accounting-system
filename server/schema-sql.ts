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
    is_active INTEGER NOT NULL DEFAULT 1,
    last_signed_in INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email)`,

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

  `CREATE TABLE IF NOT EXISTS advance_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_type TEXT NOT NULL,
    recipient_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'unsettled',
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
];
