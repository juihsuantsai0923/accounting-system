/**
 * 公司等級：用累計營業額（不含創始基金）升級。
 *   Lv1 ＝ 1 萬，之後每級要再賺的錢一段比一段多（每 10 級換一段）：
 *     Lv1–10  每級 +1 萬（Lv10 ＝ 10 萬）
 *     Lv11–20 每級 +2 萬（Lv20 ＝ 30 萬）
 *     Lv21–30 每級 +5 萬（Lv30 ＝ 80 萬）
 *     Lv31–40 每級 +10 萬（Lv40 ＝ 180 萬）
 *     Lv41–50 每級 +20 萬（Lv50 ＝ 380 萬）
 *     Lv51 起 每級 +50 萬
 *   每 10 級一個稱號。
 */
export const LEVEL_TIERS = [
  { upTo: 10, step: 10_000, title: "起步", color: "#64748b" },
  { upTo: 20, step: 20_000, title: "成長", color: "#1baf7a" },
  { upTo: 30, step: 50_000, title: "突破", color: "#2a78d6" },
  { upTo: 40, step: 100_000, title: "卓越", color: "#7c3aed" },
  { upTo: 50, step: 200_000, title: "傳奇", color: "#d9921b" },
  { upTo: Infinity, step: 500_000, title: "殿堂", color: "#c2410c" },
] as const;

/** 升到第 n 級要的累計營業額 */
export function thresholdOf(level: number) {
  if (level <= 0) return 0;
  let total = 0;
  let lv = 0;
  for (const t of LEVEL_TIERS) {
    while (lv < level && lv < t.upTo) {
      total += t.step;
      lv++;
    }
    if (lv >= level) break;
  }
  return total;
}

export function tierOf(level: number) {
  // Lv10 已經是「起步」的最後一級；Lv0 也算起步
  return LEVEL_TIERS.find((t) => Math.max(level, 1) <= t.upTo) ?? LEVEL_TIERS[LEVEL_TIERS.length - 1];
}

export function levelOf(revenue: number) {
  let level = 0;
  while (thresholdOf(level + 1) <= revenue) level++;
  const current = thresholdOf(level);
  const next = thresholdOf(level + 1);
  return {
    level,
    tier: tierOf(level),
    current,
    next,
    toNext: next - revenue,
    progress: (revenue - current) / (next - current),
  };
}

/** 依時間順序的收入，算出每一級是哪一天升上去的 */
export function levelHistory(entries: { amount: number; createdAt: number }[]) {
  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const out: { level: number; at: number; revenue: number }[] = [];
  let sum = 0;
  let level = 0;
  for (const e of sorted) {
    sum += e.amount;
    while (thresholdOf(level + 1) <= sum) {
      level++;
      out.push({ level, at: e.createdAt, revenue: thresholdOf(level) });
    }
  }
  return out;
}
