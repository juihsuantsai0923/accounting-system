import { sqliteTable, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
  ...timestamps,
});

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

export const schemaSql = sql;
