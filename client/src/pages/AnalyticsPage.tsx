import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "../lib/trpc";
import { BRAND, ChartCard, GRID, INK_MUTED, fmt, fmtShort, niceTicks, tooltipStyle } from "../components/DashboardCharts";
import { PERIOD_LABELS, inPeriod, type Period } from "../components/DashboardAnalytics";
import {
  GRAIN_LABELS,
  SOURCE_LABELS,
  SUBJECTS,
  buildCustomers,
  buildPnL,
  comboOf,
  emptyPnL,
  isRevenue,
  newVsReturning,
  periodRange,
  shiftKey,
  type AEntry,
  type Grain,
  type PnL,
} from "../lib/analytics";

/** 營收＝品牌深藍、淨利＝金色；新客＝深藍、回購＝綠（DashboardCharts 已驗證過的色票） */
const NET = "#d9921b";
const RETURNING = "#1baf7a";

function pct(now: number, prev: number | undefined) {
  if (prev === undefined || prev === 0) return null;
  return Math.round(((now - prev) / Math.abs(prev)) * 100);
}

function Change({ now, prev, goodWhenUp = true }: { now: number; prev: number | undefined; goodWhenUp?: boolean }) {
  const p = pct(now, prev);
  if (p === null) return <span className="text-slate-300">—</span>;
  if (p === 0) return <span className="text-slate-400">0%</span>;
  const good = p > 0 === goodWhenUp;
  return (
    <span className={good ? "text-emerald-600" : "text-red-600"}>
      {p > 0 ? "▲" : "▼"} {Math.abs(p)}%
    </span>
  );
}

// ─────────────────────────────── 損益表 ───────────────────────────────
function PnLSection({ entries, courseNames }: { entries: AEntry[]; courseNames: Set<string> }) {
  const [grain, setGrain] = useState<Grain>("month");
  const [showTable, setShowTable] = useState(false);
  const map = useMemo(() => buildPnL(entries, grain, courseNames), [entries, grain, courseNames]);
  const keys = useMemo(() => periodRange(entries, grain), [entries, grain]);
  const shown = keys.slice(grain === "month" ? -6 : grain === "quarter" ? -4 : -5);
  const pnl = (k: string) => map.get(k) ?? emptyPnL();
  const latest = shown[shown.length - 1];
  const prevKey = shiftKey(latest, grain, "prev");
  const lastYearKey = shiftKey(latest, grain, "lastYear");
  const has = (k: string) => map.has(k);
  const expenseNames = [...new Set(shown.flatMap((k) => Object.keys(pnl(k).byExpense)))].sort((a, b) => (pnl(latest).byExpense[b] ?? 0) - (pnl(latest).byExpense[a] ?? 0));
  const chartData = keys.slice(grain === "month" ? -12 : -8).map((k) => ({ period: k, 營業收入: pnl(k).revenue, 淨利: pnl(k).net }));
  const max = Math.max(1, ...chartData.map((d) => Math.max(d.營業收入, d.淨利)));
  const min = Math.min(0, ...chartData.map((d) => d.淨利));
  // 淨利是小負數時只往下留一點空間給長條，不另外標負的刻度（不然會多出一整格 −20 萬）
  const ticks = niceTicks(max);
  const bottom = min < 0 ? min * 1.15 : 0;

  /** goodWhenUp=false 的是成本列（顯示成負數），比較時用金額大小：成本變少＝▼綠 */
  type Row = { label: string; get: (p: PnL) => number; strong?: boolean; indent?: boolean; goodWhenUp?: boolean };
  const cmp = (r: Row, k: string) => (r.goodWhenUp === false ? Math.abs(r.get(pnl(k))) : r.get(pnl(k)));
  const rows: Row[] = [
    { label: "營業收入", get: (p) => p.revenue, strong: true },
    ...(["tutoring", "course", "book", "trial", "other"] as const).map((s) => ({ label: SOURCE_LABELS[s], get: (p: PnL) => p.bySource[s], indent: true })),
    { label: "老師／推銷者分潤", get: (p) => -p.teacherShare, goodWhenUp: false },
    { label: "留給公司（毛利）", get: (p) => p.gross, strong: true },
    { label: "公帳支出", get: (p) => -p.expenses, goodWhenUp: false },
    ...expenseNames.map((n) => ({ label: n, get: (p: PnL) => -(p.byExpense[n] ?? 0), indent: true, goodWhenUp: false })),
    { label: "淨利（公積金增減）", get: (p) => p.net, strong: true },
  ];

  return (
    <ChartCard title="損益表" note="營業收入不含創始基金；薪水撥款是付本來就欠的分潤，不重複算成支出。">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-slate-400 ml-auto order-last">最右邊一欄是本期（還沒結束），跟上期、去年同期比的是到今天為止的數字</span>
        {(Object.keys(GRAIN_LABELS) as Grain[]).map((g) => (
          <button key={g} type="button" className={grain === g ? "btn-primary !py-1" : "btn-secondary !py-1"} onClick={() => setGrain(g)}>
            每{GRAIN_LABELS[g]}
          </button>
        ))}
      </div>

      <div style={{ height: 240 }}>
        <ResponsiveContainer>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="period" tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fill: INK_MUTED, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={fmtShort}
              ticks={ticks}
              domain={[bottom, ticks[ticks.length - 1]]}
              allowDataOverflow
              width={48}
            />
            <Tooltip {...tooltipStyle()} formatter={(v: number) => fmt(v)} />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            <Bar dataKey="營業收入" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="淨利" fill={NET} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="table-wrap mt-4">
        <table className="data-table text-sm">
          <thead>
            <tr>
              <th>項目</th>
              {shown.map((k) => (
                <th key={k} className="text-right">
                  {k}
                </th>
              ))}
              <th className="text-right">較上{GRAIN_LABELS[grain]}</th>
              <th className="text-right">較去年同期</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={r.strong ? "font-medium bg-slate-50" : ""}>
                <td className={r.indent ? "text-slate-500" : ""}>{r.indent ? `　└ ${r.label}` : r.label}</td>
                {shown.map((k) => {
                  const v = r.get(pnl(k));
                  return (
                    <td key={k} className={`text-right tabular-nums ${v < 0 ? "text-slate-500" : ""}`}>
                      {v === 0 ? "—" : fmt(v)}
                    </td>
                  );
                })}
                <td className="text-right">
                  <Change now={cmp(r, latest)} prev={has(prevKey) ? cmp(r, prevKey) : undefined} goodWhenUp={r.goodWhenUp ?? true} />
                </td>
                <td className="text-right">
                  <Change now={cmp(r, latest)} prev={has(lastYearKey) ? cmp(r, lastYearKey) : undefined} goodWhenUp={r.goodWhenUp ?? true} />
                </td>
              </tr>
            ))}
            {shown.some((k) => pnl(k).nonRevenue) && (
              <tr className="text-slate-400">
                <td>借款收入（創始基金，不算營業額）</td>
                {shown.map((k) => (
                  <td key={k} className="text-right tabular-nums">
                    {pnl(k).nonRevenue ? fmt(pnl(k).nonRevenue) : "—"}
                  </td>
                ))}
                <td />
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button type="button" className="text-xs text-brand-600 hover:underline mt-2" onClick={() => setShowTable((v) => !v)}>
        {showTable ? "收起全部期間" : "顯示全部期間"}
      </button>
      {showTable && (
        <div className="table-wrap mt-2">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th>期間</th>
                <th className="text-right">營業收入</th>
                <th className="text-right">分潤</th>
                <th className="text-right">毛利</th>
                <th className="text-right">公帳支出</th>
                <th className="text-right">淨利</th>
              </tr>
            </thead>
            <tbody>
              {[...keys].reverse().map((k) => {
                const p = pnl(k);
                return (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="text-right tabular-nums">{fmt(p.revenue)}</td>
                    <td className="text-right tabular-nums">{fmt(p.teacherShare)}</td>
                    <td className="text-right tabular-nums">{fmt(p.gross)}</td>
                    <td className="text-right tabular-nums">{fmt(p.expenses)}</td>
                    <td className={`text-right tabular-nums ${p.net < 0 ? "text-red-600" : ""}`}>{fmt(p.net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

// ─────────────────────────────── 客戶分析 ───────────────────────────────
function CustomerSection({ entries, courseNames }: { entries: AEntry[]; courseNames: Set<string> }) {
  const [period, setPeriod] = useState<Period>("all");
  const [showAll, setShowAll] = useState(false);
  const scoped = useMemo(() => entries.filter((e) => inPeriod(e.createdAt, period)), [entries, period]);
  const { customers, noBuyer } = useMemo(() => buildCustomers(scoped, courseNames), [scoped, courseNames]);
  const monthly = useMemo(() => newVsReturning(entries), [entries]);
  const revenueOrders = scoped.filter((e) => isRevenue(e)).length - noBuyer;
  const revenueTotal = customers.reduce((s, c) => s + c.total, 0);
  const repeat = customers.filter((c) => c.orders >= 2).length;
  const sorted = [...customers].sort((a, b) => b.total - a.total);
  const top = showAll ? sorted : sorted.slice(0, 10);

  const combos = new Map<string, { count: number; total: number }>();
  for (const c of customers) {
    const k = comboOf(c);
    const v = combos.get(k) ?? { count: 0, total: 0 };
    v.count++;
    v.total += c.total;
    combos.set(k, v);
  }
  const comboRows = [...combos.entries()].sort((a, b) => b[1].count - a[1].count);
  const tutoringBuyers = customers.filter((c) => c.sources.has("tutoring"));
  const bookBuyers = customers.filter((c) => c.sources.has("book"));
  const ratio = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const subjectRows = SUBJECTS.map((s) => {
    const list = customers.filter((c) => c.subjects.has(s.name));
    return { name: s.name, count: list.length };
  }).filter((r) => r.count > 0);

  const kpis = [
    { label: "客戶數", value: `${customers.length} 位` },
    { label: "回購率", value: ratio(repeat, customers.length), sub: `${repeat} 位買過 2 次以上` },
    { label: "平均客單價", value: revenueOrders ? fmt(Math.round(revenueTotal / revenueOrders)) : "—", sub: `${revenueOrders} 筆訂單` },
    { label: "平均每位客戶消費", value: customers.length ? fmt(Math.round(revenueTotal / customers.length)) : "—" },
  ];
  const maxMonthly = Math.max(1, ...monthly.map((m) => m.newCount + m.returning));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg text-brand-700">客戶分析</h2>
        <select className="input !w-32" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          {Object.entries(PERIOD_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="card">
            <div className="text-sm text-slate-500">{k.label}</div>
            <div className="text-2xl font-semibold mt-1 text-slate-800">{k.value}</div>
            {k.sub && <div className="text-xs text-slate-400 mt-1">{k.sub}</div>}
          </div>
        ))}
      </div>
      {noBuyer > 0 && <p className="text-xs text-slate-400">另有 {noBuyer} 筆收入沒有填買家，不算進客戶分析。</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="每月新客戶與回購客戶" note="以買家姓名判斷；全部期間">
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} ticks={niceTicks(maxMonthly)} tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={false} tickLine={false} width={32} />
                <Tooltip {...tooltipStyle()} formatter={(v: number) => `${v} 位`} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Bar dataKey="newCount" name="新客戶" stackId="c" fill={BRAND} maxBarSize={32} />
                <Bar dataKey="returning" name="回購客戶" stackId="c" fill={RETURNING} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="購買組合" note="每位客戶買過哪幾類">
          <div className="text-sm text-slate-600 space-y-1 mb-3">
            <p>
              報小班衝刺班的 {tutoringBuyers.length} 位中，{ratio(tutoringBuyers.filter((c) => c.sources.has("book")).length, tutoringBuyers.length)} 也買了書。
            </p>
            <p>
              買書的 {bookBuyers.length} 位中，{ratio(bookBuyers.filter((c) => c.sources.has("tutoring") || c.sources.has("course")).length, bookBuyers.length)} 也報了課。
            </p>
          </div>
          <div className="table-wrap">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th>組合</th>
                  <th className="text-right">人數</th>
                  <th className="text-right">合計消費</th>
                </tr>
              </thead>
              <tbody>
                {comboRows.map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="text-right">{v.count}</td>
                    <td className="text-right tabular-nums">{fmt(v.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {subjectRows.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {subjectRows.map((r) => (
                <span key={r.name} className="text-xs rounded-full bg-slate-100 text-slate-600 px-2.5 py-1">
                  {r.name} {r.count} 位
                </span>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      <ChartCard title="客戶排行" note="依累計消費排序">
        <div className="table-wrap">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th>#</th>
                <th>買家</th>
                <th className="text-right">購買次數</th>
                <th className="text-right">累計消費</th>
                <th>買過</th>
                <th>第一次</th>
                <th>最近一次</th>
              </tr>
            </thead>
            <tbody>
              {top.map((c, i) => (
                <tr key={c.name}>
                  <td className="text-slate-400">{i + 1}</td>
                  <td className="font-medium">{c.name}</td>
                  <td className="text-right">{c.orders}</td>
                  <td className="text-right tabular-nums">{fmt(c.total)}</td>
                  <td className="text-slate-500">{[comboOf(c), [...c.subjects].join("、")].filter(Boolean).join("｜")}</td>
                  <td className="text-slate-500">{new Date(c.first).toLocaleDateString()}</td>
                  <td className="text-slate-500">{new Date(c.last).toLocaleDateString()}</td>
                </tr>
              ))}
              {!top.length && (
                <tr>
                  <td colSpan={7} className="text-center text-slate-400 py-6">
                    這段期間沒有客戶資料
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sorted.length > 10 && (
          <button type="button" className="text-xs text-brand-600 hover:underline mt-2" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "只看前 10 名" : `顯示全部 ${sorted.length} 位`}
          </button>
        )}
      </ChartCard>
    </div>
  );
}

export default function AnalyticsPage() {
  const ledger = trpc.mainLedger.list.useQuery();
  const courses = trpc.courses.list.useQuery();
  const courseNames = useMemo(() => new Set((courses.data ?? []).map((c) => c.name)), [courses.data]);
  const entries = (ledger.data ?? []) as AEntry[];

  if (ledger.isLoading) return <div className="p-8 text-center text-slate-400">載入中…</div>;
  if (ledger.error) return <div className="p-8 text-center text-red-600">{ledger.error.message}</div>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl text-brand-700">分析</h1>
      <PnLSection entries={entries} courseNames={courseNames} />
      <CustomerSection entries={entries} courseNames={courseNames} />
    </div>
  );
}
