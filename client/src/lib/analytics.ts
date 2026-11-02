import { parseNote } from "../../../server/noteFormat";
import { NON_REVENUE_CATEGORIES, expandIncome, monthOf } from "../components/DashboardCharts";

/** 分析頁用的帳本記錄（mainLedger.list 的欄位） */
export interface AEntry {
  id: number;
  type: string;
  itemName: string;
  categoryId: number;
  categoryName: string;
  amount: number;
  note: string | null;
  incomeSource: string | null;
  breakdown?: string | null;
  distributed: number;
  salaryTeacherId: number | null;
  salarySalespersonId: number | null;
  createdAt: number;
}

export const SOURCE_LABELS: Record<string, string> = { course: "線上課程", tutoring: "小班家教", book: "書籍", other: "其他收入" };
const SOURCES = ["course", "tutoring", "book", "other"] as const;

export const isRevenue = (e: AEntry) => e.type === "income" && !NON_REVENUE_CATEGORIES.has(e.categoryName);
export const isSalary = (e: AEntry) => e.salaryTeacherId != null || e.salarySalespersonId != null;

// ─────────────────────────────── 期間 ───────────────────────────────
export type Grain = "month" | "quarter" | "year";
export const GRAIN_LABELS: Record<Grain, string> = { month: "月", quarter: "季", year: "年" };

export function periodKey(ts: number, grain: Grain) {
  const m = monthOf(ts);
  const [y, mm] = m.split("-").map(Number);
  if (grain === "month") return m;
  if (grain === "quarter") return `${y} Q${Math.ceil(mm / 3)}`;
  return String(y);
}

/** 前一期、去年同期的 key */
export function shiftKey(key: string, grain: Grain, back: "prev" | "lastYear") {
  if (grain === "year") return String(Number(key) - 1);
  if (grain === "quarter") {
    const [y, q] = key.split(" Q").map(Number);
    if (back === "lastYear") return `${y - 1} Q${q}`;
    return q === 1 ? `${y - 1} Q4` : `${y} Q${q - 1}`;
  }
  const [y, m] = key.split("-").map(Number);
  if (back === "lastYear") return `${y - 1}-${String(m).padStart(2, "0")}`;
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** 從最早一期排到本期，中間沒資料的期也補上 */
export function periodRange(entries: AEntry[], grain: Grain) {
  const now = periodKey(Date.now(), grain);
  if (!entries.length) return [now];
  let k = periodKey(Math.min(...entries.map((e) => e.createdAt)), grain);
  const out: string[] = [];
  for (let guard = 0; guard < 600; guard++) {
    out.push(k);
    if (k >= now) break;
    // 往後一期：用「下一期的前一期＝這一期」反推太麻煩，直接算
    if (grain === "year") k = String(Number(k) + 1);
    else if (grain === "quarter") {
      const [y, q] = k.split(" Q").map(Number);
      k = q === 4 ? `${y + 1} Q1` : `${y} Q${q + 1}`;
    } else {
      const [y, m] = k.split("-").map(Number);
      k = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  return out;
}

// ─────────────────────────────── 損益表 ───────────────────────────────
export interface PnL {
  revenue: number;
  bySource: Record<string, number>;
  teacherShare: number; // 營業收入分給老師／推銷者的部分（分潤成本）
  gross: number; // 留給公司的部分
  expenses: number; // 公帳支出（不含薪水撥款：那是付本來就欠的分潤）
  byExpense: Record<string, number>;
  net: number;
  nonRevenue: number; // 創始基金等借款收入（不算營業額）
}

export function emptyPnL(): PnL {
  return { revenue: 0, bySource: { course: 0, tutoring: 0, book: 0, other: 0 }, teacherShare: 0, gross: 0, expenses: 0, byExpense: {}, net: 0, nonRevenue: 0 };
}

export function buildPnL(entries: AEntry[], grain: Grain, courseNames: Set<string>) {
  const map = new Map<string, PnL>();
  const get = (k: string) => {
    let v = map.get(k);
    if (!v) map.set(k, (v = emptyPnL()));
    return v;
  };
  for (const e of entries) {
    const p = get(periodKey(e.createdAt, grain));
    if (e.type === "income") {
      if (!isRevenue(e)) {
        p.nonRevenue += e.amount;
        continue;
      }
      p.revenue += e.amount;
      p.teacherShare += e.distributed;
      for (const part of expandIncome(e, courseNames)) {
        const s = (SOURCES as readonly string[]).includes(part.source) ? part.source : "other";
        p.bySource[s] += part.amount;
      }
    } else {
      if (isSalary(e)) continue;
      const kept = e.amount - e.distributed;
      p.expenses += kept;
      p.byExpense[e.categoryName] = (p.byExpense[e.categoryName] ?? 0) + kept;
    }
  }
  for (const p of map.values()) {
    p.gross = p.revenue - p.teacherShare;
    p.net = p.gross - p.expenses;
  }
  return map;
}

// ─────────────────────────────── 客戶 ───────────────────────────────
export const SUBJECTS = [
  { name: "物理", keys: ["物理"] },
  { name: "化學", keys: ["化學"] },
  { name: "生物", keys: ["生物"] },
  { name: "地科", keys: ["地科", "地球科學"] },
  { name: "數學", keys: ["數學"] },
];

export interface Customer {
  name: string;
  orders: number;
  total: number;
  first: number;
  last: number;
  sources: Set<string>;
  subjects: Set<string>;
}

export function buildCustomers(entries: AEntry[], courseNames: Set<string>) {
  const map = new Map<string, Customer>();
  let noBuyer = 0;
  for (const e of entries.filter(isRevenue).sort((a, b) => a.createdAt - b.createdAt)) {
    const name = parseNote(e.note).buyer?.trim();
    if (!name) {
      noBuyer++;
      continue;
    }
    const c = map.get(name) ?? { name, orders: 0, total: 0, first: e.createdAt, last: e.createdAt, sources: new Set(), subjects: new Set() };
    c.orders++;
    c.total += e.amount;
    c.last = e.createdAt;
    for (const part of expandIncome(e, courseNames)) {
      c.sources.add(part.source);
      const label = (part as any).itemName ?? e.itemName;
      for (const s of SUBJECTS) if (s.keys.some((k) => String(label).includes(k))) c.subjects.add(s.name);
    }
    map.set(name, c);
  }
  return { customers: [...map.values()], noBuyer };
}

/** 每月新客戶（第一次買）與回購客戶（之前買過）人數 */
export function newVsReturning(entries: AEntry[]) {
  const seen = new Set<string>();
  const byMonth = new Map<string, { month: string; newCount: number; returning: number }>();
  for (const e of entries.filter(isRevenue).sort((a, b) => a.createdAt - b.createdAt)) {
    const name = parseNote(e.note).buyer?.trim();
    if (!name) continue;
    const m = monthOf(e.createdAt);
    const row = byMonth.get(m) ?? { month: m, newCount: 0, returning: 0 };
    if (seen.has(name)) row.returning++;
    else {
      row.newCount++;
      seen.add(name);
    }
    byMonth.set(m, row);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** 購買組合：每位客戶買過哪幾類（線上課程／小班家教／書籍） */
export function comboOf(c: Customer) {
  const parts = (["tutoring", "course", "book"] as const).filter((s) => c.sources.has(s)).map((s) => SOURCE_LABELS[s]);
  return parts.length ? parts.join("＋") : "其他收入";
}
