import { useMemo, useState } from "react";
import { LEVEL_TIERS, levelHistory, levelOf, thresholdOf } from "../lib/levels";
import { NON_REVENUE_CATEGORIES, fmt, fmtShort, monthOf, type LedgerRow } from "./DashboardCharts";

/**
 * 公司等級卡：累計營業額換算等級、離下一級還差多少、最近幾次升級的日子。
 * 樣式照官網：深藍漸層底、金色漸層點綴、標題用 Noto Serif TC。
 */
export default function LevelCard({ entries }: { entries: LedgerRow[] }) {
  const [showLadder, setShowLadder] = useState(false);
  const revenueRows = useMemo(
    () => entries.filter((e) => e.type === "income" && !NON_REVENUE_CATEGORIES.has(e.categoryName)),
    [entries]
  );
  const revenue = revenueRows.reduce((s, e) => s + e.amount, 0);
  const lv = levelOf(revenue);
  const history = useMemo(() => levelHistory(revenueRows), [revenueRows]);
  const thisMonth = monthOf(Date.now());
  const upThisMonth = history.filter((h) => monthOf(h.at) === thisMonth).length;
  const recent = history.slice(-5).reverse();
  const tierIndex = LEVEL_TIERS.indexOf(lv.tier);
  const pct = Math.round(lv.progress * 100);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-brand-gradient text-white shadow-card-hover">
      {/* 背景裝飾：右上淡金色光暈、左下淡藍圓 */}
      <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-gold-400/15 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-brand-300/10 blur-2xl" aria-hidden />

      <div className="relative p-5 sm:p-7">
        <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-7">
          {/* 等級徽章：金色漸層外環、深藍內圈 */}
          <div className="shrink-0 self-center md:self-auto">
            <div className="h-28 w-28 rounded-full bg-gold-gradient p-[3px] shadow-[0_0_30px_rgba(255,209,114,0.35)]">
              <div className="h-full w-full rounded-full bg-brand-800 ring-1 ring-white/10 flex flex-col items-center justify-center">
                <span className="text-[11px] tracking-[0.3em] text-gold-300/90 pl-[0.3em]">LEVEL</span>
                <span className="font-serif text-4xl font-semibold leading-none mt-1 bg-gold-gradient bg-clip-text text-transparent">{lv.level}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-xs tracking-[0.25em] text-gold-300/80">公司等級</span>
              {upThisMonth > 0 && (
                <span className="rounded-full bg-gold-gradient px-2.5 py-0.5 text-xs font-semibold text-brand-800">本月升了 {upThisMonth} 級</span>
              )}
            </div>
            <h2 className="font-serif text-2xl sm:text-3xl mt-1 tracking-wide">
              Lv {lv.level}
              <span className="mx-2 text-white/40">·</span>
              <span className="text-gold-400">{lv.tier.title}</span>
            </h2>

            {/* 進度條 */}
            <div className="mt-4">
              <div className="flex items-end justify-between text-xs text-white/70 mb-1.5">
                <span>
                  累計營業額 <span className="text-white font-medium text-sm">{fmt(revenue)}</span>
                </span>
                <span>
                  Lv {lv.level + 1}・{fmtShort(lv.next)}
                </span>
              </div>
              <div
                className="h-2.5 rounded-full bg-white/15 overflow-hidden"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="升級進度"
              >
                <div className="h-full rounded-full bg-gold-gradient transition-all duration-700" style={{ width: `${Math.max(3, pct)}%` }} />
              </div>
              <div className="mt-1.5 text-sm text-white/80">
                再 <span className="font-semibold text-gold-400">{fmt(lv.toNext)}</span> 升到 Lv {lv.level + 1}
                <span className="text-white/50">（目前 {pct}%）</span>
              </div>
            </div>
          </div>
        </div>

        {/* 稱號階梯：已經過的金框、目前的金底、還沒到的淡色 */}
        <div className="mt-6 grid grid-cols-3 sm:grid-cols-6 gap-2">
          {LEVEL_TIERS.map((t, i) => {
            const from = i === 0 ? 1 : LEVEL_TIERS[i - 1].upTo + 1;
            const state = i < tierIndex ? "done" : i === tierIndex ? "current" : "todo";
            return (
              <div
                key={t.title}
                className={`rounded-lg px-2 py-1.5 text-center transition-colors ${
                  state === "current"
                    ? "bg-gold-gradient text-brand-800 shadow"
                    : state === "done"
                      ? "border border-gold-400/50 text-gold-300"
                      : "border border-white/10 text-white/40"
                }`}
              >
                <div className="font-serif text-sm font-semibold">{t.title}</div>
                <div className="text-[11px] opacity-80">{Number.isFinite(t.upTo) ? `Lv ${from}–${t.upTo}` : `Lv ${from}+`}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {recent.length > 0 && <span className="text-xs text-white/50 mr-1">最近升級</span>}
          {recent.map((h) => (
            <span key={h.level} className="text-xs rounded-full bg-white/10 ring-1 ring-white/10 px-2.5 py-1 text-white/80">
              <span className="text-gold-300 font-medium">Lv {h.level}</span>　{new Date(h.at).toLocaleDateString()}
            </span>
          ))}
          <button type="button" className="ml-auto text-xs text-gold-300 hover:text-gold-200 underline-offset-4 hover:underline" onClick={() => setShowLadder((v) => !v)}>
            {showLadder ? "收起升級規則" : "升級規則"}
          </button>
        </div>

        {showLadder && (
          <div className="mt-3 rounded-xl bg-white/5 ring-1 ring-white/10 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gold-300/80">
                  <th className="px-3 py-2 font-normal">稱號</th>
                  <th className="px-3 py-2 font-normal">等級</th>
                  <th className="px-3 py-2 font-normal text-right">每升一級要再賺</th>
                  <th className="px-3 py-2 font-normal text-right">這段最高一級的門檻</th>
                </tr>
              </thead>
              <tbody>
                {LEVEL_TIERS.map((t, i) => {
                  const from = i === 0 ? 1 : LEVEL_TIERS[i - 1].upTo + 1;
                  return (
                    <tr key={t.title} className={`border-t border-white/10 ${i === tierIndex ? "text-gold-300" : "text-white/80"}`}>
                      <td className="px-3 py-2 font-serif">{t.title}</td>
                      <td className="px-3 py-2">{Number.isFinite(t.upTo) ? `Lv ${from}–${t.upTo}` : `Lv ${from} 起`}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtShort(t.step)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number.isFinite(t.upTo) ? fmtShort(thresholdOf(t.upTo)) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
