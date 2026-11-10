import { eq, inArray } from "drizzle-orm";
import { books, coupons, courses, revenueSettings, revenueTeamMembers, salespeople, teachers } from "./schema";

/**
 * 分潤規則（2026-11-07 起）：
 *   公積金比例 reserveRate（預設 10%）：線上課程、小班家教、試上都先留這個比例給公司
 *   行政費比例 adminFeeRate（預設 20%）：線上課程、小班家教、試上、書籍都抽這個比例，依團隊名單的權重分
 *   剩下的全部給主理老師（線上課程＝課程的老師；書籍＝依科目對應的老師）
 * 例外：書籍另有自己的公積金比例 bookReserveRate（預設 35%）；行事曆（筆記本）全部留公積金。
 * 網紅碼（2026-11-07 起的訂單）：線上課程、書籍改以售價算公積金、行政費與網紅佣金 5%，家長折扣由主理老師那份吸收；小班家教、行事曆不算。
 * 金額一律用實際收到的錢（不再用原價×折數−優惠碼推算）。
 * 營業稅（2026-11-10）：稅籍登記日（registrationDate）當天或之後入帳的收入，先扣 round(實收×5/105) 放「稅金準備」，
 * 剩下的再照上面的規則分；網紅佣金也用扣完稅的售價算。登記日以前的帳不扣、不重算。
 */
export interface RevenueSettingsRow {
  id: number;
  reserveRate: number;
  adminFeeRate: number;
  /** 書籍的公積金比例（不跟著上面的公積金比例走；行事曆另外全數留公積金） */
  bookReserveRate: number;
  /** 營業稅率（5%）；稅籍登記日 YYYY-MM-DD，null＝還沒登記、不扣稅 */
  vatRate: number;
  registrationDate: string | null;
  /** 公積金最低水位；補稅準備（凍結，公積金的一部分先標記不可用） */
  reserveFloor: number;
  reserveFrozen: number;
}

export const DEFAULT_REVENUE_SETTINGS = { reserveRate: 0.1, adminFeeRate: 0.2, bookReserveRate: 0.35 };
const DEFAULT_EXTRA = { vatRate: 0.05, registrationDate: null as string | null, reserveFloor: 100000, reserveFrozen: 37000 };

/** 台灣時間某天 00:00 的時間戳（YYYY-MM-DD） */
export function twDayStart(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - 8 * 3600 * 1000;
}

/** 這筆收入要先扣多少營業稅放稅金準備：登記日（台灣時間）當天或之後入帳的才扣，含稅價 × 5/105 四捨五入 */
export function vatOf(settings: Pick<RevenueSettingsRow, "vatRate" | "registrationDate">, amount: number, at = Date.now()) {
  if (!settings.registrationDate || amount <= 0) return 0;
  if (at < twDayStart(settings.registrationDate)) return 0;
  return Math.round((amount * settings.vatRate) / (1 + settings.vatRate));
}

export const INFLUENCER_RATE = 0.05;
/** 台灣時間 2026-11-07 00:00：這之後下的官網訂單才能選網紅碼 */
export const INFLUENCER_START = Date.UTC(2026, 10, 6, 16);

/** 這筆收入用了網紅碼：listPrice＝售價（公積金、行政費、佣金都用它算），salespersonId＝佣金給誰 */
export interface InfluencerSplit {
  listPrice: number;
  salespersonId: number;
}

/** 網紅碼要有對應的推銷者才能記佣金；沒有就用代碼建一位，名字可到管理面板改 */
export async function ensureCouponSalesperson(db: any, coupon: { id: number; code: string; salespersonId?: number | null }) {
  if (coupon.salespersonId) return coupon.salespersonId;
  const [s] = await db.insert(salespeople).values({ name: coupon.code, note: "網紅優惠碼" }).returning();
  await db.update(coupons).set({ salespersonId: s.id }).where(eq(coupons.id, coupon.id));
  return s.id as number;
}

/** 讀取分潤設定，資料庫裡還沒有任何設定列時自動建立一列預設值 */
export async function getRevenueSettings(db: any): Promise<RevenueSettingsRow> {
  const rows = await db.select().from(revenueSettings).where(eq(revenueSettings.id, 1)).limit(1);
  const r = rows[0];
  if (r)
    return {
      id: 1,
      reserveRate: r.reserveRate,
      adminFeeRate: r.adminFeeRate,
      bookReserveRate: r.bookReserveRate,
      vatRate: r.vatRate ?? DEFAULT_EXTRA.vatRate,
      registrationDate: r.registrationDate ?? null,
      reserveFloor: r.reserveFloor ?? DEFAULT_EXTRA.reserveFloor,
      reserveFrozen: r.reserveFrozen ?? DEFAULT_EXTRA.reserveFrozen,
    };
  await db.insert(revenueSettings).values({ id: 1, ...DEFAULT_REVENUE_SETTINGS, updatedAt: Date.now() });
  return { id: 1, ...DEFAULT_REVENUE_SETTINGS, ...DEFAULT_EXTRA };
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
  /** 小班衝刺班的課程 id：這份分潤依課程期間按天攤提到期 */
  vestCourseId?: number | null;
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
 * 有行政費的分法（線上課程、小班家教、試上、書籍）：
 *   先扣營業稅（登記日以後才有）＝tax，剩下 net 再分
 *   公積金＋行政費＝net ×（公積金比例＋行政費比例），四捨五入；主理老師拿剩下的
 *   行政費＝net × 行政費比例，依團隊名單的權重分（無條件捨去），零頭跟公積金一起留在公司
 */
export async function splitWithAdminFee(
  db: any,
  amount: number,
  ownerTeacherId: number,
  ownerSuffix: string,
  reserveRate?: number,
  influencer?: InfluencerSplit,
  vestCourseId?: number | null
) {
  const settings = await getRevenueSettings(db);
  const members: { recipientType: RecipientType; recipientId: number; weight: number }[] = await db.select().from(revenueTeamMembers);
  const tax = vatOf(settings, amount);
  const net = amount - tax;
  const base = influencer ? influencer.listPrice - vatOf(settings, influencer.listPrice) : net;
  const companyPart = Math.round(base * ((reserveRate ?? settings.reserveRate) + settings.adminFeeRate));
  const commission = influencer ? Math.round(base * INFLUENCER_RATE) : 0;
  const ownerShare = net - companyPart - commission;
  if (ownerShare < 0) throw new CourseIncomeError("折扣後實收不夠分給公積金、行政費與網紅佣金，請檢查金額");
  const adminFee = Math.round(base * settings.adminFeeRate);
  const totalWeight = members.reduce((s, m) => s + m.weight, 0);
  const vest = vestCourseId ?? null;
  const distributions: DistItem[] = [{ type: "teacher", recipientId: ownerTeacherId, amount: ownerShare, role: "owner", itemNameSuffix: ownerSuffix, vestCourseId: vest }];
  for (const m of members)
    distributions.push({
      type: m.recipientType,
      recipientId: m.recipientId,
      amount: Math.floor((adminFee * m.weight) / totalWeight + 1e-9),
      role: "team_bonus",
      itemNameSuffix: "行政費",
      vestCourseId: vest,
    });
  if (influencer) distributions.push({ type: "salesperson", recipientId: influencer.salespersonId, amount: commission, role: "referral", itemNameSuffix: "網紅佣金" });
  const totalDistributed = distributions.reduce((s, d) => s + d.amount, 0);
  return { settings, ownerShare, adminFee, distributions, totalDistributed, tax, reserve: amount - totalDistributed - tax };
}

/** 線上課程：實收金額照「公積金＋行政費＋主理老師」分 */
export async function computeCourseIncome(db: any, input: { courseId: number; amount: number; influencer?: InfluencerSplit }) {
  const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId)).limit(1);
  if (!course) throw new CourseIncomeError("找不到課程");
  if (course.category === "tutoring") throw new CourseIncomeError("這門課是小班家教，請改用「小班家教」入帳");
  if (!course.teacherId) throw new CourseIncomeError("這門課還沒有對應的主理老師");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new CourseIncomeError("實收金額必須是大於 0 的整數");
  const split = await splitWithAdminFee(db, input.amount, course.teacherId, "課程主理分潤", undefined, input.influencer);
  return { course, amount: input.amount, ...split };
}

/** 小班家教：實收金額照「公積金＋行政費＋主理老師」分 */
export async function computeTutoringIncome(db: any, input: { courseId: number; amount: number }) {
  const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId)).limit(1);
  if (!course) throw new CourseIncomeError("找不到課程");
  if (course.category !== "tutoring") throw new CourseIncomeError("這門課不是小班家教，請改用「線上課程」入帳");
  if (!course.teacherId) throw new CourseIncomeError("此課程尚未設定主理教師");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new CourseIncomeError("實收金額必須是大於 0 的整數");

  const split = await splitWithAdminFee(db, input.amount, course.teacherId, "小班家教分潤", undefined, undefined, course.id);
  return {
    course,
    amount: input.amount,
    reserveRate: split.settings.reserveRate,
    reserve: split.reserve,
    tax: split.tax,
    teacherShare: split.ownerShare,
    adminFee: split.adminFee,
    distributions: split.distributions,
  };
}

/** 試上：選試上的課，實收金額跟小班家教一樣照「公積金＋行政費＋主理老師」分 */
export async function computeTrialIncome(db: any, input: { courseId: number; amount: number }) {
  const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId)).limit(1);
  if (!course) throw new CourseIncomeError("找不到課程");
  if (!course.teacherId) throw new CourseIncomeError("此課程尚未設定主理教師");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new CourseIncomeError("實收金額必須是大於 0 的整數");
  const split = await splitWithAdminFee(db, input.amount, course.teacherId, "試上分潤");
  return { course, amount: input.amount, reserve: split.reserve, tax: split.tax, teacherShare: split.ownerShare, adminFee: split.adminFee, distributions: split.distributions };
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

  let coupon: { id: number; code: string; discountRate: number; salespersonId: number | null } | null = null;
  if (input.couponId) {
    const [c] = await db.select().from(coupons).where(eq(coupons.id, input.couponId)).limit(1);
    if (!c) throw new CourseIncomeError("找不到這個優惠碼");
    coupon = { id: c.id, code: c.code, discountRate: c.discountRate, salespersonId: c.salespersonId };
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
export async function splitBookIncome(
  db: any,
  detail: { bookId: number; name: string; kind: string; subtotal: number; qty: number }[],
  amount: number,
  influencer?: { listTotal: number; salespersonId: number }
) {
  const total = detail.reduce((s, d) => s + d.subtotal, 0);
  const settings = await getRevenueSettings(db);
  const groups = new Map<string, { label: string; categoryId: number; items: string[]; amount: number; list: number; teacherId: number | null }>();
  let left = amount;
  let listLeft = influencer?.listTotal ?? 0;
  for (let i = 0; i < detail.length; i++) {
    const d = detail[i];
    const share = i === detail.length - 1 ? left : total ? Math.round((amount * d.subtotal) / total) : 0;
    left -= share;
    const listShare = !influencer ? 0 : i === detail.length - 1 ? listLeft : total ? Math.round((influencer.listTotal * d.subtotal) / total) : 0;
    listLeft -= listShare;
    const subject = d.kind === "notebook" ? null : subjectOf(d.name);
    const teacherId = subject ? await teacherIdForSubject(db, d.name) : null;
    const key = teacherId ? `t${teacherId}` : "reserve";
    const g = groups.get(key) ?? { label: subject && teacherId ? `${subject.subject}書籍` : "書籍", categoryId: d.bookId, items: [], amount: 0, list: 0, teacherId };
    g.items.push(d.qty > 1 ? `${d.name}×${d.qty}` : d.name);
    g.amount += share;
    g.list += listShare;
    groups.set(key, g);
  }
  const parts = [];
  for (const g of groups.values()) {
    if (g.amount <= 0) continue;
    const split = influencer ? { listPrice: g.list, salespersonId: influencer.salespersonId } : undefined;
    const s = g.teacherId ? await splitWithAdminFee(db, g.amount, g.teacherId, "書籍分潤", settings.bookReserveRate, split) : null;
    const name = g.items.join("、");
    parts.push({
      name,
      categoryId: g.categoryId,
      amount: g.amount,
      distributions: s?.distributions ?? [],
      tax: s ? s.tax : vatOf(settings, g.amount),
      personalLabel: g.teacherId ? name : g.label,
    });
  }
  return parts;
}
