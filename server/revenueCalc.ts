import { eq, inArray } from "drizzle-orm";
import { books, coupons, courses, revenueSettings, revenueTeamMembers, teachers } from "./schema";

/**
 * 分潤規則（2026-10-29 起簡化成兩個參數）：
 *   公積金比例 reserveRate（預設 10%）：線上課程、書籍、小班家教都先留這個比例給公司
 *   行政費比例 adminFeeRate（預設 10%）：線上課程、書籍另外抽這個比例，固定由團隊名單上的三位平分
 *   剩下的全部給主理老師（線上課程＝課程的老師；書籍＝依科目對應的老師）
 * 例外：書籍另有自己的公積金比例 bookReserveRate（2026-11-02 起預設 25%）；行事曆（筆記本）全部留公積金；小班家教不抽行政費。
 * 金額一律用實際收到的錢（不再用原價×折數−優惠碼推算）。
 */
export interface RevenueSettingsRow {
  id: number;
  reserveRate: number;
  adminFeeRate: number;
  /** 書籍的公積金比例（不跟著上面的公積金比例走；行事曆另外全數留公積金） */
  bookReserveRate: number;
}

export const DEFAULT_REVENUE_SETTINGS = { reserveRate: 0.1, adminFeeRate: 0.1, bookReserveRate: 0.25 };

/** 讀取分潤設定，資料庫裡還沒有任何設定列時自動建立一列預設值 */
export async function getRevenueSettings(db: any): Promise<RevenueSettingsRow> {
  const rows = await db.select().from(revenueSettings).where(eq(revenueSettings.id, 1)).limit(1);
  if (rows[0]) return { id: 1, reserveRate: rows[0].reserveRate, adminFeeRate: rows[0].adminFeeRate, bookReserveRate: rows[0].bookReserveRate };
  await db.insert(revenueSettings).values({ id: 1, ...DEFAULT_REVENUE_SETTINGS, updatedAt: Date.now() });
  return { id: 1, ...DEFAULT_REVENUE_SETTINGS };
}

export type RecipientType = "teacher" | "salesperson";

export interface DistItem {
  type: RecipientType;
  recipientId: number;
  amount: number;
  role: "owner" | "team_bonus" | "referral";
  itemNameSuffix: string;
  /** 多品項合成一筆時，這份分潤所屬品項的金額（子記帳表的原始金額） */
  baseAmount?: number;
}

export class CourseIncomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseIncomeError";
  }
}

/** 科目 → 主理老師（書籍依科目分潤；名稱裡出現哪個科目就算哪位老師） */
export const SUBJECT_TEACHERS: { subject: string; keywords: string[]; teacherName: string }[] = [
  { subject: "物理", keywords: ["物理"], teacherName: "蔡睿軒" },
  { subject: "化學", keywords: ["化學"], teacherName: "王歆宜" },
  { subject: "生物", keywords: ["生物"], teacherName: "潘彥宇" },
  { subject: "地科", keywords: ["地科", "地球科學"], teacherName: "陳宥勳" },
  { subject: "數學", keywords: ["數學"], teacherName: "蔡睿軒" },
];

export function subjectOf(name: string) {
  return SUBJECT_TEACHERS.find((s) => s.keywords.some((k) => name.includes(k))) ?? null;
}

export async function teacherIdForSubject(db: any, name: string): Promise<number | null> {
  const s = subjectOf(name);
  if (!s) return null;
  const [t] = await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.name, s.teacherName)).limit(1);
  return t?.id ?? null;
}

/**
 * 有行政費的分法（線上課程、書籍）：
 *   公積金＋行政費＝金額 ×（公積金比例＋行政費比例），四捨五入；主理老師拿剩下的
 *   行政費＝金額 × 行政費比例，團隊名單每人平分（無條件捨去），零頭跟公積金一起留在公司
 */
export async function splitWithAdminFee(db: any, amount: number, ownerTeacherId: number, ownerSuffix: string, reserveRate?: number) {
  const settings = await getRevenueSettings(db);
  const members: { recipientType: RecipientType; recipientId: number }[] = await db.select().from(revenueTeamMembers);
  const companyPart = Math.round(amount * ((reserveRate ?? settings.reserveRate) + settings.adminFeeRate));
  const ownerShare = amount - companyPart;
  const adminFee = Math.round(amount * settings.adminFeeRate);
  const perPerson = members.length ? Math.floor(adminFee / members.length) : 0;
  const distributions: DistItem[] = [{ type: "teacher", recipientId: ownerTeacherId, amount: ownerShare, role: "owner", itemNameSuffix: ownerSuffix }];
  for (const m of members) distributions.push({ type: m.recipientType, recipientId: m.recipientId, amount: perPerson, role: "team_bonus", itemNameSuffix: "行政費" });
  const totalDistributed = distributions.reduce((s, d) => s + d.amount, 0);
  return { settings, ownerShare, adminFee, perPerson, distributions, totalDistributed, reserve: amount - totalDistributed };
}

/** 線上課程：實收金額照「公積金＋行政費＋主理老師」分 */
export async function computeCourseIncome(db: any, input: { courseId: number; amount: number }) {
  const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId)).limit(1);
  if (!course) throw new CourseIncomeError("找不到課程");
  if (course.category === "tutoring") throw new CourseIncomeError("這門課是小班家教，請改用「小班家教」入帳");
  if (!course.teacherId) throw new CourseIncomeError("這門課還沒有對應的主理老師");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new CourseIncomeError("實收金額必須是大於 0 的整數");
  const split = await splitWithAdminFee(db, input.amount, course.teacherId, "課程主理分潤");
  return { course, amount: input.amount, ...split };
}

/**
 * 小班家教：不抽行政費。
 *   公積金 = 實收金額 × 公積金比例（四捨五入到元）；主理教師 = 實收金額 − 公積金
 */
export async function computeTutoringIncome(db: any, input: { courseId: number; amount: number }) {
  const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId)).limit(1);
  if (!course) throw new CourseIncomeError("找不到課程");
  if (course.category !== "tutoring") throw new CourseIncomeError("這門課不是小班家教，請改用「線上課程」入帳");
  if (!course.teacherId) throw new CourseIncomeError("此課程尚未設定主理教師");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new CourseIncomeError("實收金額必須是大於 0 的整數");

  const settings = await getRevenueSettings(db);
  const reserve = Math.round(input.amount * settings.reserveRate);
  const teacherShare = input.amount - reserve;
  const distributions: DistItem[] = [
    { type: "teacher", recipientId: course.teacherId, amount: teacherShare, role: "owner", itemNameSuffix: "小班家教分潤" },
  ];
  return { course, amount: input.amount, reserveRate: settings.reserveRate, reserve, teacherShare, distributions };
}

export interface BookLineInput {
  bookId: number;
  qty: number;
}

/**
 * 書籍：依書目定價 × 數量加總，再套用優惠碼折扣比例（四捨五入到元），得到建議實收金額。
 * 實收金額可由記帳人員改寫（例如現場另外議價）。分潤見 splitBookIncome。
 */
export async function computeBookIncome(db: any, input: { lines: BookLineInput[]; couponId: number | null }) {
  const lines = input.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new CourseIncomeError("請至少選一本書");
  const ids = [...new Set(lines.map((l) => l.bookId))];
  const rows = await db.select().from(books).where(inArray(books.id, ids));
  const byId = new Map<number, any>(rows.map((b: any) => [b.id, b]));

  const detail = lines.map((l) => {
    const b = byId.get(l.bookId);
    if (!b) throw new CourseIncomeError("找不到其中一本書，請重新整理頁面");
    return { bookId: b.id, name: b.name as string, kind: b.kind as string, price: b.price as number, qty: l.qty, subtotal: b.price * l.qty };
  });
  const subtotal = detail.reduce((s, d) => s + d.subtotal, 0);

  let coupon: { id: number; code: string; discountRate: number } | null = null;
  if (input.couponId) {
    const [c] = await db.select().from(coupons).where(eq(coupons.id, input.couponId)).limit(1);
    if (!c) throw new CourseIncomeError("找不到這個優惠碼");
    coupon = { id: c.id, code: c.code, discountRate: c.discountRate };
  }
  const discount = coupon ? Math.round(subtotal * coupon.discountRate) : 0;
  const suggestedAmount = subtotal - discount;
  const itemName = detail.map((d) => (d.qty > 1 ? `${d.name}×${d.qty}` : d.name)).join("、");
  return { detail, subtotal, coupon, discount, suggestedAmount, itemName };
}

/**
 * 書籍收入拆給誰：實收金額依定價比例攤到每本書，再依科目分組。
 *   行事曆（筆記本）→ 全部留公積金
 *   有科目的書 → 書籍公積金＋行政費＋該科老師；寫進老師子記帳表的項目名稱是書名（例如「物理 四本全套（書籍分潤）」）
 *   認不出科目的書 → 全部留公積金
 * 回傳每一組的金額與分潤，給 combineIncome 合成一筆。
 */
export async function splitBookIncome(db: any, detail: { bookId: number; name: string; kind: string; subtotal: number; qty: number }[], amount: number) {
  const total = detail.reduce((s, d) => s + d.subtotal, 0);
  const settings = await getRevenueSettings(db);
  const groups = new Map<string, { label: string; categoryId: number; items: string[]; amount: number; teacherId: number | null }>();
  let left = amount;
  for (let i = 0; i < detail.length; i++) {
    const d = detail[i];
    const share = i === detail.length - 1 ? left : total ? Math.round((amount * d.subtotal) / total) : 0;
    left -= share;
    const subject = d.kind === "notebook" ? null : subjectOf(d.name);
    const teacherId = subject ? await teacherIdForSubject(db, d.name) : null;
    const key = teacherId ? `t${teacherId}` : "reserve";
    const g = groups.get(key) ?? { label: subject && teacherId ? `${subject.subject}書籍` : "書籍", categoryId: d.bookId, items: [], amount: 0, teacherId };
    g.items.push(d.qty > 1 ? `${d.name}×${d.qty}` : d.name);
    g.amount += share;
    groups.set(key, g);
  }
  const parts = [];
  for (const g of groups.values()) {
    if (g.amount <= 0) continue;
    const distributions = g.teacherId ? (await splitWithAdminFee(db, g.amount, g.teacherId, "書籍分潤", settings.bookReserveRate)).distributions : [];
    const name = g.items.join("、");
    parts.push({ name, categoryId: g.categoryId, amount: g.amount, distributions, personalLabel: g.teacherId ? name : g.label });
  }
  return parts;
}
