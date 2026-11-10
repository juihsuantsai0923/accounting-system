import { and, asc, eq, isNull } from "drizzle-orm";
import { courses, mainLedger, paymentReceipts, salespeople, salespersonLedger, shippers, teacherLedger, teachers } from "./schema";
import { twDayStart } from "./revenueCalc";
import { ledgerDelta } from "./ledger";

/**
 * 上了課才按月發（2026-11-10）：每月 15 日發「截至上個月最後一天已到期 − 已發放」。
 *   小班衝刺班的分潤、行政費（子記帳表 vest_course_id 有值）：依課程 start_date～end_date 按天線性攤提，
 *     到期日以上個月底為準；收入在上個月底之後才入帳的，要等入帳後的下一個 15 日才算（插班生入班前已經過的天數，入帳時就算到期）。
 *   其他（書籍、線上課程、試上、代墊、創始基金、年終分潤）：入帳就到期，下一個 15 日發。
 *   部分入帳（main_ledger.unpaid_amount）：還沒收到的那部分學費對應的分潤不算到期；補收後（payment_receipts）那部分從收到那天起算。
 * 子記帳表餘額不變；已發放＝薪水撥款（子記帳表 distribution／expense）。
 */

const DAY = 86400000;
/** 第一次發薪日 */
export const FIRST_PAYDAY = "2026-11-15";

export type Recipient = "teacher" | "salesperson";

/** 台灣時間的 YYYY-MM-DD */
export function twDate(ts: number) {
  return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function addMonth(ym: string, n: number) {
  let [y, m] = ym.split("-").map(Number);
  m += n;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** 發薪日（YYYY-MM-15）的到期基準：上個月最後一天結束＝這個月 1 日 00:00（台灣時間） */
export function cutoffOf(payday: string) {
  return twDayStart(`${payday.slice(0, 7)}-01`);
}

/** 下一個發薪日：今天（台灣時間）15 日以前＝這個月 15 日，否則下個月 15 日 */
export function nextPayday(now = Date.now()) {
  const d = twDate(now);
  const ym = d.slice(0, 7);
  return Number(d.slice(8, 10)) <= 15 ? `${ym}-15` : `${addMonth(ym, 1)}-15`;
}

/** 某個時間點的錢算在哪一次發薪（同一個月份的 15 日；例如 11/14、11/20 發的都算 11/15 那次） */
export function paydayOfPayout(ts: number) {
  return `${twDate(ts).slice(0, 7)}-15`;
}

export function paydayRange(first: string, last: string) {
  const out: string[] = [];
  for (let ym = first.slice(0, 7); ym <= last.slice(0, 7); ym = addMonth(ym, 1)) out.push(`${ym}-15`);
  return out;
}

export interface LedgerRowLike {
  id: number;
  mainLedgerId: number | null;
  sourceType: string;
  type: string;
  personalAmount: number;
  createdAt: number;
  vestCourseId?: number | null;
  itemName?: string;
}

/** 薪水撥款（公司付給他的錢） */
export function isPayout(r: LedgerRowLike) {
  return r.sourceType === "distribution" && r.type === "expense";
}

/** 讀出算到期需要的資料（衝刺班期間、每筆收入的部分入帳與補收），回傳「某一行在某個時間點已到期多少」的函式 */
export async function loadVesting(db: any) {
  const courseRows: any[] = await db.select().from(courses);
  const period = new Map<number, { start: number; end: number }>();
  for (const c of courseRows)
    if (c.startDate && c.endDate) period.set(c.id, { start: twDayStart(c.startDate), end: twDayStart(c.endDate) + DAY });

  const entries: any[] = await db
    .select({ id: mainLedger.id, amount: mainLedger.amount, unpaidAmount: mainLedger.unpaidAmount, createdAt: mainLedger.createdAt })
    .from(mainLedger)
    .where(isNull(mainLedger.deletedAt));
  const receipts: any[] = await db.select().from(paymentReceipts);
  const receiptsBy = new Map<number, { amount: number; receivedAt: number }[]>();
  for (const r of receipts) receiptsBy.set(r.mainLedgerId, [...(receiptsBy.get(r.mainLedgerId) ?? []), r]);
  // 每筆收入拆成幾段「收到錢的時間＋占整筆的比例」：入帳時收到的、之後每次補收的；還沒收到的不在裡面
  const tranches = new Map<number, { at: number; frac: number }[]>();
  for (const e of entries) {
    if (!e.amount) continue;
    const rs = receiptsBy.get(e.id) ?? [];
    const received = rs.reduce((s, r) => s + r.amount, 0);
    const initial = Math.max(0, e.amount - (e.unpaidAmount ?? 0) - received);
    tranches.set(e.id, [{ at: e.createdAt, frac: initial / e.amount }, ...rs.map((r) => ({ at: r.receivedAt, frac: r.amount / e.amount }))]);
  }

  /** 這一行在 cutoff（不含）之前已到期的金額（小數，最後加總完才四捨五入）；薪水撥款不算 */
  function vestedAt(r: LedgerRowLike, cutoff: number): number {
    if (isPayout(r)) return 0;
    if (!(r.sourceType === "distribution" && r.type === "income")) return r.createdAt < cutoff ? ledgerDelta(r as any) : 0;
    const p = r.vestCourseId != null ? period.get(r.vestCourseId) : undefined;
    const share = p ? Math.max(0, Math.min(1, (cutoff - p.start) / (p.end - p.start))) : 1;
    const parts = (r.mainLedgerId != null && tranches.get(r.mainLedgerId)) || [{ at: r.createdAt, frac: 1 }];
    let v = 0;
    for (const t of parts) if (Math.max(r.createdAt, t.at) < cutoff) v += r.personalAmount * t.frac * share;
    return v;
  }

  /** 全部到期的最後一個發薪日（最晚結束的衝刺班的下個月 15 日，至少是下一個發薪日） */
  function lastPayday(now = Date.now()) {
    let last = nextPayday(now);
    for (const p of period.values()) {
      const pd = `${addMonth(twDate(p.end - 1).slice(0, 7), 1)}-15`;
      if (pd > last) last = pd;
    }
    return last;
  }

  return { vestedAt, lastPayday };
}

export interface PersonSchedule {
  recipientType: Recipient;
  recipientId: number;
  name: string;
  isShipper: boolean;
  /** 每個發薪日：截至上個月底累計到期、該次新到期（應發）、該次實際發放（同月份的薪水撥款） */
  paydays: { payday: string; cumVested: number; due: number; paid: number; paidBeforeCutoff: number }[];
  balance: number;
  totalPaid: number;
  next: { payday: string; payable: number; notYetDue: number };
}

async function rowsOf(db: any, recipientType: Recipient, id: number): Promise<any[]> {
  return recipientType === "teacher"
    ? db.select().from(teacherLedger).where(eq(teacherLedger.teacherId, id)).orderBy(asc(teacherLedger.createdAt), asc(teacherLedger.id))
    : db.select().from(salespersonLedger).where(eq(salespersonLedger.salespersonId, id)).orderBy(asc(salespersonLedger.createdAt), asc(salespersonLedger.id));
}

/** 一個人的發薪排程：從第一次發薪日排到全部到期為止 */
export function scheduleFor(
  vest: Awaited<ReturnType<typeof loadVesting>>,
  person: { recipientType: Recipient; recipientId: number; name: string; isShipper: boolean },
  rows: any[],
  now = Date.now()
): PersonSchedule {
  const days = paydayRange(FIRST_PAYDAY, vest.lastPayday(now));
  const payouts = rows.filter(isPayout);
  const paidIn = (pd: string) => payouts.filter((r) => paydayOfPayout(r.createdAt) === pd).reduce((s, r) => s + r.personalAmount, 0);
  let prev = 0;
  const paydays = days.map((payday) => {
    const cutoff = cutoffOf(payday);
    const cumVested = Math.round(rows.reduce((s, r) => s + vest.vestedAt(r, cutoff), 0));
    const due = cumVested - prev;
    prev = cumVested;
    const paidBeforeCutoff = payouts.filter((r) => r.createdAt < cutoff).reduce((s, r) => s + r.personalAmount, 0);
    return { payday, cumVested, due, paid: paidIn(payday), paidBeforeCutoff };
  });
  const totalPaid = payouts.reduce((s, r) => s + r.personalAmount, 0);
  const balance = rows.reduce((s, r) => s + ledgerDelta(r), 0);
  const np = nextPayday(now);
  const cum = paydays.find((p) => p.payday === np)?.cumVested ?? Math.round(rows.reduce((s, r) => s + vest.vestedAt(r, cutoffOf(np)), 0));
  // 下次可發＝截至上個月底累計到期 − 已發放（下次發薪日當月已經先發的也扣掉）
  const payable = Math.max(0, cum - totalPaid);
  return { ...person, paydays, balance, totalPaid, next: { payday: np, payable, notYetDue: balance - payable } };
}

/** 所有人（老師、推銷者；出貨員的帳在同名推銷者底下，標成出貨員）的發薪排程，沒有任何帳的人略過 */
export async function payrollTable(db: any, now = Date.now()) {
  const vest = await loadVesting(db);
  const shipperNames = new Set((await db.select({ name: shippers.name }).from(shippers)).map((s: any) => s.name));
  const people: { recipientType: Recipient; recipientId: number; name: string; isShipper: boolean }[] = [
    ...(await db.select({ id: teachers.id, name: teachers.name }).from(teachers)).map((t: any) => ({ recipientType: "teacher" as const, recipientId: t.id, name: t.name, isShipper: false })),
    ...(await db.select({ id: salespeople.id, name: salespeople.name }).from(salespeople)).map((s: any) => ({
      recipientType: "salesperson" as const,
      recipientId: s.id,
      name: s.name,
      isShipper: shipperNames.has(s.name),
    })),
  ];
  const out: PersonSchedule[] = [];
  for (const p of people) {
    const rows = await rowsOf(db, p.recipientType, p.recipientId);
    if (!rows.length) continue;
    out.push(scheduleFor(vest, p, rows, now));
  }
  return { paydays: paydayRange(FIRST_PAYDAY, vest.lastPayday(now)), nextPayday: nextPayday(now), people: out };
}

export async function personSchedule(db: any, recipientType: Recipient, recipientId: number, now = Date.now()) {
  const vest = await loadVesting(db);
  const table = recipientType === "teacher" ? teachers : salespeople;
  const [p] = await db.select({ id: table.id, name: table.name }).from(table).where(eq(table.id, recipientId)).limit(1);
  if (!p) return null;
  const shipperNames = new Set((await db.select({ name: shippers.name }).from(shippers)).map((s: any) => s.name));
  const rows = await rowsOf(db, recipientType, recipientId);
  const s = scheduleFor(vest, { recipientType, recipientId, name: p.name, isShipper: recipientType === "salesperson" && shipperNames.has(p.name) }, rows, now);
  const payouts = rows.filter(isPayout).map((r: any) => ({ id: r.id, at: r.createdAt, amount: r.personalAmount, payday: paydayOfPayout(r.createdAt), itemName: r.itemName }));
  return { ...s, payouts };
}

/** 出貨員本人：帳記在同名推銷者底下 */
export async function salespersonIdForShipper(db: any, shipperId: number): Promise<number | null> {
  const [s] = await db.select({ name: shippers.name }).from(shippers).where(eq(shippers.id, shipperId)).limit(1);
  if (!s) return null;
  const [sp] = await db.select({ id: salespeople.id }).from(salespeople).where(and(eq(salespeople.name, s.name))).limit(1);
  return sp?.id ?? null;
}
