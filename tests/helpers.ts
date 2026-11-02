import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../server/schema";
import { createTableStatements, courseColumnMigrations, revenueSettingsColumnMigrations, mainLedgerColumnMigrations } from "../server/schema-sql";

/**
 * 測試用的記憶體資料庫：建表後放一份跟正式資料一樣的最小目錄
 * （四位老師、數學工具線上課程、四科衝刺班、各科刷題本／全套、行事曆、5% 與 15% 優惠碼、行政費三人名單）。
 */
export function makeDb() {
  const sqlite = new Database(":memory:");
  for (const stmt of createTableStatements) sqlite.exec(stmt);
  const addColumns = (table: string, migrations: { column: string; statement: string }[]) => {
    const existing = new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name));
    for (const m of migrations) if (!existing.has(m.column)) sqlite.exec(m.statement);
  };
  addColumns("courses", courseColumnMigrations);
  addColumns("revenue_settings", revenueSettingsColumnMigrations);
  addColumns("main_ledger", mainLedgerColumnMigrations);

  const now = Date.now();
  const run = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...args);
  for (const [id, name] of [
    [2, "蔡睿軒"],
    [3, "王歆宜"],
    [4, "潘彥宇"],
    [5, "陳宥勳"],
  ] as const)
    run("INSERT INTO teachers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", id, name, now, now);
  for (const [id, name, category, teacherId, originalPrice] of [
    [3, "數學工具先修課程", "online", 2, 15000],
    [4, "科學班物理衝刺班 2026-2027", "tutoring", 2, 27000],
    [5, "科學班化學衝刺班 2026-2027", "tutoring", 3, 18000],
    [6, "科學班生物衝刺班 2026-2027", "tutoring", 4, 18000],
    [7, "科學班地球科學衝刺班 2026-2027", "tutoring", 5, 10000],
  ] as const)
    run(
      "INSERT INTO courses (id, name, category, teacher_id, original_price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id, name, category, teacherId, originalPrice, now, now
    );
  for (const [id, name, kind, price] of [
    [6, "物理 上下冊刷題本", "bundle", 1580],
    [8, "物理 四本全套", "bundle", 3350],
    [14, "化學 上下冊刷題本", "bundle", 1580],
    [22, "生物 上下冊刷題本", "bundle", 1580],
    [26, "地科刷題本", "workbook", 880],
    [28, "科學班倒數行事曆（2026 8月-2027 3月）", "notebook", 300],
  ] as const)
    run("INSERT INTO books (id, name, kind, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, name, kind, price, now, now);
  run("INSERT INTO coupons (code, discount_rate, created_at, updated_at) VALUES ('SNORLAX002', 0.05, ?, ?)", now, now);
  run("INSERT INTO coupons (code, discount_rate, created_at, updated_at) VALUES ('TUTOR2026', 0.15, ?, ?)", now, now);
  for (const id of [2, 3, 4]) run("INSERT INTO revenue_team_members (recipient_type, recipient_id, created_at) VALUES ('teacher', ?, ?)", id, now);
  run("INSERT INTO revenue_settings (id, reserve_rate, admin_fee_rate, book_reserve_rate, updated_at) VALUES (1, 0.1, 0.1, 0.25, ?)", now);

  return { db: drizzle(sqlite, { schema }), sqlite };
}

/** 官網訂單快照（web_orders 一列的樣子） */
export function webOrder(orderNo: string, total: number, discount: number, items: [string, number][]) {
  return {
    orderNo,
    buyer: "測試買家",
    total,
    discount,
    statusLabel: "已付款",
    tab: "completed",
    manualStatus: null,
    items: JSON.stringify(items.map(([name, price]) => ({ name, price }))),
  };
}
