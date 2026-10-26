import { eq } from "drizzle-orm";
import { courses, revenueSettings, revenueTeamMembers } from "./schema";

export interface RevenueSettingsRow {
  id: number;
  baseDiscount: number;
  couponDiscount: number;
  referralBonus: number;
  platformFeeRate: number;
  teamBonusRate: number;
  materialCost: number;
  monthlySubscription: number;
  estimatedMonthlySales: number;
}

/** 對照《課程分潤與成本結構辦法》文件裡的預設數字 */
export const DEFAULT_REVENUE_SETTINGS: Omit<RevenueSettingsRow, "id"> = {
  baseDiscount: 0.6, // 目前基礎折數（1 年期），例如 0.6 = 6 折
  couponDiscount: 750,
  referralBonus: 500,
  platformFeeRate: 0.2,
  teamBonusRate: 50 / 3 / 100,
  materialCost: 300,
  monthlySubscription: 350,
  estimatedMonthlySales: 30,
};

export type CourseYears = 1 | 2 | 3;

/**
 * 依《課程分潤與成本結構辦法》的年期加成規則計算實際折數：
 * 1 年期 = 基礎折數；2 年期 = 基礎折數 + 1 折；3 年期 = 基礎折數 + 2 折。
 * 若疊加後超過 10 折，照樣計算（例如 11 折 = 原價 ×1.1），不做上限限制。
 */
export function computeDiscountTier(baseDiscount: number, years: CourseYears): number {
  return baseDiscount + (years - 1) * 0.1;
}

/** 讀取分潤設定，資料庫裡還沒有任何設定列時自動建立一列預設值 */
export async function getRevenueSettings(db: any): Promise<RevenueSettingsRow> {
  const rows = await db.select().from(revenueSettings).where(eq(revenueSettings.id, 1)).limit(1);
  if (rows[0]) return rows[0];
  await db.insert(revenueSettings).values({ id: 1, ...DEFAULT_REVENUE_SETTINGS, updatedAt: Date.now() });
  return { id: 1, ...DEFAULT_REVENUE_SETTINGS };
}

export type RecipientType = "teacher" | "salesperson";

export interface CourseIncomeInput {
  courseId: number;
  years: CourseYears;
  hasCoupon: boolean;
  referral: { type: RecipientType; recipientId: number } | null;
}

export interface DistItem {
  type: RecipientType;
  recipientId: number;
  amount: number;
  role: "owner" | "team_bonus" | "referral";
  itemNameSuffix: string;
}

export class CourseIncomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseIncomeError";
  }
}

/**
 * 課程收入分潤精靈的核心計算邏輯，Express 跟 Cloudflare Workers 共用（透過 ctx.db 傳入）。
 * 計算順序完全對照《課程分潤與成本結構辦法》：
 *   實際折數 = 基礎折數 + 年期加成（2 年期 +1 折／3 年期 +2 折，超過 10 折不設上限）
 *   售價 = 原價 × 實際折數
 *   入帳金額 = 售價 − 優惠碼折抵（若有使用）
 *   分配用淨額 = 入帳金額 − 推廣抽成（若有行銷人員）
 *   平台費 = 分配用淨額 × 平台費比例
 *   每人團隊獎金 = 平台費 × 每人比例，無條件進位
 *   主理教師分潤 = 分配用淨額 − 平台費
 *   （母記帳表記錄「入帳金額」；子記帳表的每一筆分配各自入帳）
 */
export async function computeCourseIncome(db: any, input: CourseIncomeInput) {
  const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId)).limit(1);
  if (!course) throw new CourseIncomeError("找不到課程");
  if (!course.teacherId) throw new CourseIncomeError("此課程尚未設定所屬教師，請至管理面板「課程管理」設定");

  const originalPrice = course.originalPrice ?? course.basePrice;
  if (!originalPrice) throw new CourseIncomeError("此課程尚未設定原價，請至管理面板「課程管理」設定");

  const settings = await getRevenueSettings(db);
  const teamMembers: { id: number; recipientType: RecipientType; recipientId: number }[] = await db
    .select()
    .from(revenueTeamMembers);

  const discountTier = computeDiscountTier(settings.baseDiscount, input.years);
  const price = Math.round(originalPrice * discountTier);

  const amount = price - (input.hasCoupon ? settings.couponDiscount : 0);
  if (amount <= 0) throw new CourseIncomeError("計算出的入帳金額不合理，請檢查課程原價、折數與優惠碼折抵設定");

  const netForSplit = amount - (input.referral ? settings.referralBonus : 0);
  const platformFee = Math.round(netForSplit * settings.platformFeeRate);
  const perPersonBonus = Math.ceil(platformFee * settings.teamBonusRate);
  const ownerShare = netForSplit - platformFee;

  const distributions: DistItem[] = [];
  distributions.push({ type: "teacher", recipientId: course.teacherId, amount: ownerShare, role: "owner", itemNameSuffix: "課程主理分潤" });
  for (const m of teamMembers) {
    distributions.push({ type: m.recipientType, recipientId: m.recipientId, amount: perPersonBonus, role: "team_bonus", itemNameSuffix: "團隊獎金" });
  }
  if (input.referral) {
    distributions.push({
      type: input.referral.type,
      recipientId: input.referral.recipientId,
      amount: settings.referralBonus,
      role: "referral",
      itemNameSuffix: "推廣抽成",
    });
  }

  const totalDistributed = distributions.reduce((s, d) => s + d.amount, 0);
  if (totalDistributed > amount) {
    throw new CourseIncomeError("分配總額超過入帳金額，請確認分潤設定（比例/固定金額）是否合理");
  }

  const undistributed = amount - totalDistributed; // 尚未分配給任何人的部分（平台費扣完獎金後的剩餘）
  const costPerCourse = settings.materialCost + Math.round(settings.monthlySubscription / settings.estimatedMonthlySales);
  const platformReserve = undistributed - costPerCourse; // 僅供預覽參考的估算平台積金，不會寫入任何分錄

  return {
    course,
    settings,
    years: input.years,
    originalPrice,
    discountTier,
    price,
    amount,
    netForSplit,
    platformFee,
    perPersonBonus,
    ownerShare,
    referralAmount: input.referral ? settings.referralBonus : 0,
    distributions,
    totalDistributed,
    undistributed,
    costPerCourse,
    platformReserve,
  };
}
