import { expandIncome, monthOf } from "../components/DashboardCharts";
import { isRevenue, isSalary, type AEntry } from "./analytics";

/**
 * 稅務專區的試算（2026 年／民國 115 年的數字）。都是粗估，正式申報以國稅局與會計師為準。
 * 來源見 TaxPage 下方「參考資料」。
 */
export const TAX = {
  /** 營業稅起徵點（114/1/1 起）：每月銷售貨物 10 萬、銷售勞務 5 萬；兩種都有時 勞務/5萬＋貨物/10萬 ≥ 1 就算達到 */
  thresholdGoods: 100_000,
  thresholdService: 50_000,
  /** 小規模營業人：每月銷售額未達 20 萬，國稅局按季查定，稅率 1% */
  smallScaleLimit: 200_000,
  smallScaleRate: 0.01,
  vatRate: 0.05,
  /** 營所稅：課稅所得 12 萬以下免稅；超過的 20%，但不超過（所得−12 萬）的一半 */
  corpExempt: 120_000,
  corpRate: 0.2,
  /** 115 年度綜所稅 */
  exemption: 101_000,
  standardDeduction: 136_000,
  salaryDeduction: 227_000,
  brackets: [
    { upTo: 610_000, rate: 0.05, minus: 0 },
    { upTo: 1_380_000, rate: 0.12, minus: 42_700 },
    { upTo: 2_770_000, rate: 0.2, minus: 153_100 },
    { upTo: 5_190_000, rate: 0.3, minus: 430_100 },
    { upTo: Infinity, rate: 0.4, minus: 949_100 },
  ],
  /** 扣繳：執行業務所得單次給付 ≥ 20,010 扣 10%（扣繳稅額 ≤ 2,000 免扣）；補充保費 2.11%（執行業務單次 ≥ 2 萬；兼職薪資單次 ≥ 基本工資） */
  withholdThreshold: 20_010,
  withholdRate: 0.1,
  nhiRate: 0.0211,
  nhiProfessionalThreshold: 20_000,
  minimumWage: 29_500,
  /** 兼職／非每月薪資單次 ≥ 90,501 才扣 5% */
  salaryWithholdThreshold: 90_501,
  salaryWithholdRate: 0.05,
};

export const SERVICE_SOURCES = new Set(["tutoring", "course", "trial", "other"]);

export interface MonthSales {
  month: string;
  service: number; // 勞務：小班家教、線上課程、試上、其他收入
  goods: number; // 貨物：書籍、行事曆
  total: number;
  overThreshold: boolean; // 已達營業稅起徵點（要辦稅籍登記）
  overSmallScale: boolean; // 每月 ≥ 20 萬，不能用小規模 1%
}

/** 某一年每個月的營業額，拆成勞務與貨物 */
export function monthlySales(entries: AEntry[], year: string, courseNames: Set<string>) {
  const map = new Map<string, MonthSales>();
  for (const e of entries) {
    if (!isRevenue(e)) continue;
    const m = monthOf(e.createdAt);
    if (!m.startsWith(year)) continue;
    const row = map.get(m) ?? { month: m, service: 0, goods: 0, total: 0, overThreshold: false, overSmallScale: false };
    for (const p of expandIncome(e, courseNames)) {
      if (p.source === "book") row.goods += p.amount;
      else row.service += p.amount;
    }
    map.set(m, row);
  }
  const rows = [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const r of rows) {
    r.total = r.service + r.goods;
    r.overThreshold = r.service / TAX.thresholdService + r.goods / TAX.thresholdGoods >= 1;
    r.overSmallScale = r.total >= TAX.smallScaleLimit;
  }
  return rows;
}

/** 售價含 5% 營業稅時，裡面的稅額 */
export const taxIncluded = (amount: number, rate = TAX.vatRate) => Math.round((amount * rate) / (1 + rate));

export function corpIncomeTax(taxable: number) {
  if (taxable <= TAX.corpExempt) return 0;
  return Math.round(Math.min(taxable * TAX.corpRate, (taxable - TAX.corpExempt) / 2));
}

/** 綜合所得淨額 → 應納稅額 */
export function personalTax(net: number) {
  if (net <= 0) return 0;
  const b = TAX.brackets.find((x) => net <= x.upTo)!;
  return Math.round(net * b.rate - b.minus);
}

/** 單身、只有這一份所得時的綜所稅（粗估） */
export function personalTaxOn(income: number, kind: "salary" | "professional" | "business", expenseRate = 0) {
  let gross = income;
  if (kind === "salary") gross = Math.max(0, income - TAX.salaryDeduction);
  if (kind === "professional") gross = Math.round(income * (1 - expenseRate));
  const net = gross - TAX.exemption - TAX.standardDeduction;
  return { net: Math.max(0, net), tax: personalTax(net) };
}

/** 某一年的老師／推銷者分潤與撥款（撥款＝帳本的薪水支出，扣繳和補充保費在付錢時才發生） */
export function payeeSummary(entries: AEntry[], year: string, names: Map<string, string>) {
  const out = new Map<string, { key: string; name: string; payouts: number[] }>();
  for (const e of entries) {
    if (!isSalary(e) || e.type !== "expense" || !monthOf(e.createdAt).startsWith(year)) continue;
    const key = e.salaryTeacherId != null ? `t${e.salaryTeacherId}` : `s${e.salarySalespersonId}`;
    const row = out.get(key) ?? { key, name: names.get(key) ?? key, payouts: [] };
    row.payouts.push(e.amount);
    out.set(key, row);
  }
  return [...out.values()];
}

/** 一位老師這一年的撥款，照所得類別算扣繳與補充保費 */
export function withholdingFor(payouts: number[], kind: "professional" | "salary") {
  let withhold = 0;
  let nhi = 0;
  let count = 0;
  for (const p of payouts) {
    if (kind === "professional") {
      const w = p >= TAX.withholdThreshold ? Math.round(p * TAX.withholdRate) : 0;
      if (w > 2000) withhold += w; // 扣繳稅額 2,000 以下免扣
      if (p >= TAX.nhiProfessionalThreshold) {
        nhi += Math.round(p * TAX.nhiRate);
        count++;
      }
    } else {
      if (p >= TAX.salaryWithholdThreshold) withhold += Math.round(p * TAX.salaryWithholdRate);
      if (p >= TAX.minimumWage) {
        nhi += Math.round(p * TAX.nhiRate);
        count++;
      }
    }
  }
  return { withhold, nhi, count };
}

/** 一年的公帳支出（不含薪水撥款） */
export function yearExpenses(entries: AEntry[], year: string) {
  return entries
    .filter((e) => e.type === "expense" && !isSalary(e) && monthOf(e.createdAt).startsWith(year))
    .reduce((s, e) => s + e.amount - e.distributed, 0);
}

/** 一年的老師／推銷者分潤（營業收入分出去的部分） */
export function yearShares(entries: AEntry[], year: string) {
  return entries.filter((e) => isRevenue(e) && monthOf(e.createdAt).startsWith(year)).reduce((s, e) => s + e.distributed, 0);
}
