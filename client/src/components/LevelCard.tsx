import { useMemo, useState } from "react";
import { LEVEL_TIERS, levelHistory, levelOf, thresholdOf } from "../lib/levels";
import { NON_REVENUE_CATEGORIES, fmt, fmtShort, monthOf, type LedgerRow } from "./DashboardCharts";

/** 公司等級卡：累計營業額換算等級、離下一級還差多少、最近幾次升級的日子 */
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

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div
          className="w-20 h-20 shrink-0 rounded-full flex flex-col items-center justify-center text-white shadow"
          style={{ background: lv.tier.color }}
        >
          <span className="text-xs leading-none opacity-90">Lv</span>
          <span className="text-3xl font-semibold leading-none mt-0.5">{lv.level}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg text-brand-700">
              公司等級 Lv {lv.level}・{lv.tier.title}
            </h2>
            {upThisMonth > 0 && <span className="text-sm text-emerald-600">本月升了 {upThisMonth} 級 🎉</span>}
          </div>
          <div className="mt-2 h-3 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(lv.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, lv.progress * 100)}%`, background: lv.tier.color }} />
          </div>
          <div className="text-sm text-slate-600 mt-1.5">
            累計營業額 {fmt(revenue)}，再 <span className="font-medium text-brand-700">{fmt(lv.toNext)}</span> 升到 Lv {lv.level + 1}
            <span className="text-slate-400">（Lv {lv.level + 1} ＝ {fmtShort(lv.next)}）</span>
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {recent.map((h) => (
            <span key={h.level} className="text-xs rounded-full bg-slate-100 text-slate-600 px-2.5 py-1">
              Lv {h.level}：{new Date(h.at).toLocaleDateString()}
            </span>
          ))}
        </div>
      )}

      <button type="button" className="text-xs text-brand-600 hover:underline mt-3" onClick={() => setShowLadder((v) => !v)}>
        {showLadder ? "收起升級規則" : "升級規則"}
      </button>
      {showLadder && (
        <div className="table-wrap mt-2">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th>稱號</th>
                <th>等級</th>
                <th>每升一級要再賺</th>
                <th>這段最高一級的門檻</th>
              </tr>
            </thead>
            <tbody>
              {LEVEL_TIERS.map((t, i) => {
                const from = i === 0 ? 1 : LEVEL_TIERS[i - 1].upTo + 1;
                return (
                  <tr key={t.title} className={t === lv.tier ? "bg-brand-50" : ""}>
                    <td>
                      <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: t.color }} />
                      {t.title}
                    </td>
                    <td>{Number.isFinite(t.upTo) ? `Lv ${from}–${t.upTo}` : `Lv ${from} 起`}</td>
                    <td>{fmtShort(t.step)}</td>
                    <td>{Number.isFinite(t.upTo) ? fmtShort(thresholdOf(t.upTo)) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
