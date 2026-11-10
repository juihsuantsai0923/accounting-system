import { and, asc, eq, isNull } from "drizzle-orm";
import { courses, mainLedger, paymentReceipts, salespeople, salespersonLedger, shippers, teacherLedger, teachers } from "./schema";
import { getRevenueSettings, twDayStart } from "./revenueCalc";
import { ledgerDelta } from "./ledger";

/**
 * 發薪（2026-11-10 使用者決定）：每月最後一天發「當月底以前已到期 − 已發放」。
 *   「上了課才發」只用在稅籍登記日（revenue_settings.registration_date）以後入帳的小班衝刺班分潤／行政費
 *     （子記帳表 vest_course_id 有值）：依課程 start_date～end_date 按天線性攤提，算到當月月底；
 *     插班生入班前已經過的天數，在入帳當月的月底一次到期。
 *   登記日以前的帳（還沒登記＝全部；這一屆使用者 2026 年內手動發完）、書籍、線上課程、試上、代墊、創始基金、年終分潤：
 *     入帳就到期，當月月底發。
 *   部分入帳（main_ledger.unpaid_amount）：還沒收到的那部分學費對應的分潤不算到期；補收後（payment_receipts）那部分從收到那天起算。
 * 子記帳表餘額不變；已發放＝薪水撥款（子記帳表 distribution／expense）。已發放比已到期多＝預付，不算欠款也不顯示負數。
 */

const DAY = 86400000;
/** 第一次發薪日 */
export const FIRST_PAYDAY = "2026-11-30";

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

/** 某個月（YYYY-MM）的最後一天 YYYY-MM-DD */
export function monthEnd(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** 發薪日（月底）的到期基準：那一天結束＝下個月 1 日 00:00（台灣時間） */
export function cutoffOf(payday: string) {
  return twDayStart(`${addMonth(payday.slice(0, 7), 1)}-01`);
}

/** 下一個發薪日＝這個月（台灣時間）的最後一天 */
export function nextPayday(now = Date.now()) {
  return monthEnd(twDate(now).slice(0, 7));
}

/** 某一筆撥款算在哪一次發薪：同一個月的月底 */
export function paydayOfPayout(ts: number) {
  return monthEnd(twDate(ts).slice(0, 7));
}

export function paydayRange(first: string, last: string) {
  const out: string[] = [];
  for (let ym = first.slice(0, 7); ym <= last.slice(0, 7); ym = addMonth(ym, 1)) out.push(monthEnd(ym));
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

/** 讀出算到期需要的資料，回傳「某一行在某個時間點已到期多少」的函式與發薪設定 */
export async function loadVesting(db: any) {
  const settings = await getRevenueSettings(db);
  // 登記日以後入帳的衝刺班才按天攤提；還沒登記＝全部入帳就到期
  const vestFrom = settings.registrationDate ? twDayStart(settings.registrationDate) : Infinity;
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

  /** 這一行要按課程期間攤提嗎：登記日以後入帳、而且是衝刺班的分潤／行政費 */
  function periodOf(r: LedgerRowLike) {
    if (r.vestCourseId == null || r.createdAt < vestFrom) return undefined;
    return period.get(r.vestCourseId);
  }

  /** 這一行在 cutoff（不含）之前已到期的金額（小數，最後加總完才四捨五入）；薪水撥款不算 */
  function vestedAt(r: LedgerRowLike, cutoff: number): number {
    if (isPayout(r)) return 0;
    if (!(r.sourceType === "distribution" && r.type === "income")) return r.createdAt < cutoff ? ledgerDelta(r as any) : 0;
    const p = periodOf(r);
    const share = p ? Math.max(0, Math.min(1, (cutoff - p.start) / (p.end - p.start))) : 1;
    const parts = (r.mainLedgerId != null && tranches.get(r.mainLedgerId)) || [{ at: r.createdAt, frac: 1 }];
    let v = 0;
    for (const t of parts) if (Math.max(r.createdAt, t.at) < cutoff) v += r.personalAmount * t.frac * share;
    return v;
  }

  /** 最後一個要列的發薪日：有攤提的衝刺班結束後的下一次，至少是下一個發薪日 */
  function lastPayday(rows: LedgerRowLike[], now = Date.now()) {
    let last = nextPayday(now);
    // 入帳就到期的：入帳（或補收）那個月的月底
    const firstAfter = (ts: number) => paydayOfPayout(ts);
    for (const r of rows) {
      const pd = firstAfter(r.createdAt);
      if (pd > last) last = pd;
      for (const t of (r.mainLedgerId != null && tranches.get(r.mainLedgerId)) || []) if (firstAfter(t.at) > last) last = firstAfter(t.at);
    }
    for (const r of rows) {
      const p = periodOf(r);
      if (!p) continue;
      const pd = paydayOfPayout(p.end - 1);
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
  /** 每個發薪日：累計到期、該次新到期（應發）、該次實際發放、到期基準之前已發的 */
  paydays: { payday: string; cumVested: number; due: number; paid: number; paidBeforeCutoff: number }[];
  /** 子記帳表餘額（被多付時是負數，畫面上不顯示負數，改顯示預付） */
  balance: number;
  totalPaid: number;
  /** payable＝下次可發；prepaid＝已發放超過已到期的部分（預付）；notYetDue＝還沒到期、也還沒預付的 */
  next: { payday: string; payable: number; prepaid: number; notYetDue: number };
}

async function rowsOf(db: any, recipientType: Recipient, id: number): Promise<any[]> {
  return recipientType === "teacher"
    ? db.select().from(teacherLedger).where(eq(teacherLedger.teacherId, id)).orderBy(asc(teacherLedger.createdAt), asc(teacherLedger.id))
    : db.select().from(salespersonLedger).where(eq(salespersonLedger.salespersonId, id)).orderBy(asc(salespersonLedger.createdAt), asc(salespersonLedger.id));
}

/** 一個人的發薪排程 */
export function scheduleFor(
  vest: Awaited<ReturnType<typeof loadVesting>>,
  person: { recipientType: Recipient; recipientId: number; name: string; isShipper: boolean },
  rows: any[],
  days: string[],
  now = Date.now()
): PersonSchedule {
  const payouts = rows.filter(isPayout);
  const paidIn = (pd: string) => payouts.filter((r) => paydayOfPayout(r.createdAt) === pd).reduce((s, r) => s + r.personalAmount, 0);
  const cumAt = (cutoff: number) => Math.round(rows.reduce((s, r) => s + vest.vestedAt(r, cutoff), 0));
  let prev = 0;
  const paydays = days.map((payday) => {
    const cutoff = cutoffOf(payday);
    const cumVested = cumAt(cutoff);
    const due = cumVested - prev;
    prev = cumVested;
    const paidBeforeCutoff = payouts.filter((r) => r.createdAt < cutoff).reduce((s, r) => s + r.personalAmount, 0);
    return { payday, cumVested, due, paid: paidIn(payday), paidBeforeCutoff };
  });
  const totalPaid = payouts.reduce((s, r) => s + r.personalAmount, 0);
  const balance = rows.reduce((s, r) => s + ledgerDelta(r), 0);
  const np = nextPayday(now);
  const cum = paydays.find((p) => p.payday === np)?.cumVested ?? cumAt(cutoffOf(np));
  const payable = Math.max(0, cum - totalPaid);
  const prepaid = Math.max(0, totalPaid - cum);
  return { ...person, paydays, balance, totalPaid, next: { payday: np, payable, prepaid, notYetDue: Math.max(0, balance - payable) } };
}

/** 下次發薪以後、每個人都是 0 的欄位不列 */
function trimDays(days: string[], schedules: PersonSchedule[], next: string) {
  let keep = days.length;
  while (keep > 0 && days[keep - 1] > next && schedules.every((s) => (s.paydays[keep - 1]?.due ?? 0) === 0)) keep--;
  return keep;
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
  const withRows: { p: (typeof people)[number]; rows: any[] }[] = [];
  for (const p of people) {
    const rows = await rowsOf(db, p.recipientType, p.recipientId);
    if (rows.length) withRows.push({ p, rows });
  }
  const last = vest.lastPayday(withRows.flatMap((x) => x.rows), now);
  const days = paydayRange(FIRST_PAYDAY, last);
  const next = nextPayday(now);
  const out = withRows.map(({ p, rows }) => scheduleFor(vest, p, rows, days, now));
  const keep = trimDays(days, out, next);
  for (const s of out) s.paydays = s.paydays.slice(0, keep);
  return { paydays: days.slice(0, keep), nextPayday: next, people: out };
}

export async function personSchedule(db: any, recipientType: Recipient, recipientId: number, now = Date.now()) {
  const vest = await loadVesting(db);
  const table = recipientType === "teacher" ? teachers : salespeople;
  const [p] = await db.select({ id: table.id, name: table.name }).from(table).where(eq(table.id, recipientId)).limit(1);
  if (!p) return null;
  const shipperNames = new Set((await db.select({ name: shippers.name }).from(shippers)).map((s: any) => s.name));
  const rows = await rowsOf(db, recipientType, recipientId);
  const days = paydayRange(FIRST_PAYDAY, vest.lastPayday(rows, now));
  const s = scheduleFor(vest, { recipientType, recipientId, name: p.name, isShipper: recipientType === "salesperson" && shipperNames.has(p.name) }, rows, days, now);
  s.paydays = s.paydays.slice(0, trimDays(days, [s], s.next.payday));
  const payouts = rows
    .filter(isPayout)
    .map((r: any) => ({ id: r.id, at: r.createdAt, amount: r.personalAmount, payday: paydayOfPayout(r.createdAt), itemName: r.itemName }));
  return { ...s, payouts };
}

/** 出貨員本人：帳記在同名推銷者底下 */
export async function salespersonIdForShipper(db: any, shipperId: number): Promise<number | null> {
  const [s] = await db.select({ name: shippers.name }).from(shippers).where(eq(shippers.id, shipperId)).limit(1);
  if (!s) return null;
  const [sp] = await db.select({ id: salespeople.id }).from(salespeople).where(and(eq(salespeople.name, s.name))).limit(1);
  return sp?.id ?? null;
}
