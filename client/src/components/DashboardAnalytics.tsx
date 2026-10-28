import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BRAND,
  ChartCard,
  GRID,
  INK_MUTED,
  NON_REVENUE_CATEGORIES,
  fmt,
  fmtShort,
  inferSource,
  expandIncome,
  monthOf,
  niceTicks,
  tooltipStyle,
} from "./DashboardCharts";
import { downloadTextFile } from "../lib/download";

/** 公積金走勢的漲跌用 diverging 兩端（藍＝增加、紅＝減少），月底水位用深色線 */
const GAIN = "#2a78d6";
const LOSS = "#e34948";
const LEVEL = "#0f172a";

export interface Entry {
  id: number;
  type: string;
  itemName: string;
  categoryId: number;
  categoryName: string;
  amount: number;
  note: string | null;
  incomeSource: string | null;
  breakdown?: string | null;
  distributed: number;
  salaryTeacherId: number | null;
  salarySalespersonId: number | null;
  createdAt: number;
}

export interface TimelinePoint {
  month: string;
  balance: number;
  owed: number;
  reserve: number;
  reserveChange: number;
}

export interface PersonStatFull {
  recipientType: string;
  recipientId: number;
  name: string;
  earned: number;
  paid: number;
  loan: number;
  balance: number;
  lastPaidAt: number | null;
  firstOwedAt: number | null;
  monthly: Record<string, { earned: number; paid: number }>;
}

const isRevenue = (e: Entry) => e.type === "income" && !NON_REVENUE_CATEGORIES.has(e.categoryName);
const isSalary = (e: Entry) => e.salaryTeacherId != null || e.salarySalespersonId != null;

function thisMonthKey() {
  return monthOf(Date.now());
}
function prevMonthKey(key: string) {
  let [y, m] = key.split("-").map(Number);
  m -= 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** 刻度包含負數時用：上下各取整齊的步距 */
function niceTicksRange(min: number, max: number) {
  if (min >= 0) return niceTicks(max);
  const span = Math.max(max, 0) - min;
  const t = niceTicks(span, 5);
  const step = t[1] ?? span;
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) out.push(v);
  return out;
}

// ─────────────────────────────── 本月 vs 上月 ───────────────────────────────
function Kpi({ label, now, prev, goodWhenUp }: { label: string; now: number; prev: number; goodWhenUp: boolean }) {
  const diff = now - prev;
  // 上月接近 0 時百分比會變成幾千 %，看不出意義 → 改顯示差額
  const rawPct = prev !== 0 ? Math.round((diff / Math.abs(prev)) * 100) : null;
  const pct = rawPct !== null && Math.abs(rawPct) <= 300 ? rawPct : null;
  const up = diff > 0;
  const good = diff === 0 ? null : up === goodWhenUp;
  return (
    <div className="card">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1 text-slate-800">{fmt(now)}</div>
      <div className="text-xs mt-1 text-slate-500">
        上月 {fmt(prev)}
        {diff !== 0 && (
          <span className={`ml-2 font-medium ${good ? "text-emerald-600" : "text-red-600"}`}>
            {up ? "▲" : "▼"} {pct !== null ? `${Math.abs(pct)}%` : fmt(Math.abs(diff))}
          </span>
        )}
      </div>
    </div>
  );
}

export function KpiCompare({ entries, timeline }: { entries: Entry[]; timeline: TimelinePoint[] }) {
  const cur = thisMonthKey();
  const prev = prevMonthKey(cur);
  const sum = (m: string, f: (e: Entry) => boolean) => entries.filter((e) => monthOf(e.createdAt) === m && f(e)).reduce((s, e) => s + e.amount, 0);
  const reserveOf = (m: string) => timeline.find((t) => t.month === m)?.reserveChange ?? 0;
  return (
    <div>
      <h2 className="text-sm font-medium text-slate-500 mb-2">本月（{cur}）與上月比較</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Kpi label="營業額" now={sum(cur, isRevenue)} prev={sum(prev, isRevenue)} goodWhenUp />
        <Kpi label="支出" now={sum(cur, (e) => e.type === "expense")} prev={sum(prev, (e) => e.type === "expense")} goodWhenUp={false} />
        <Kpi label="公積金增減" now={reserveOf(cur)} prev={reserveOf(prev)} goodWhenUp />
      </div>
    </div>
  );
}

// ─────────────────────────────── 公積金走勢 ───────────────────────────────
export function ReserveTrendChart({ timeline }: { timeline: TimelinePoint[] }) {
  if (!timeline.length) return null;
  const values = timeline.flatMap((t) => [t.reserve, t.reserveChange]);
  const ticks = niceTicksRange(Math.min(...values, 0), Math.max(...values, 0));
  return (
    <ChartCard
      title="公積金走勢（每月損益）"
      note="長條＝當月公積金增減（公司自己的錢這個月賺或賠多少），線＝月底公積金。公積金＝母帳餘額 − 還欠所有人的錢（含創始基金借款、代墊）。"
    >
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={timeline} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: INK_MUTED, fontSize: 12 }} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: INK_MUTED, fontSize: 12 }}
              tickFormatter={fmtShort}
              width={52}
              ticks={ticks}
              domain={[ticks[0], ticks[ticks.length - 1]]}
            />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Tooltip {...tooltipStyle()} formatter={(v: number, name: string) => [fmt(v), name]} />
            <Legend
              wrapperStyle={{ fontSize: 13, color: INK_MUTED }}
              payload={[
                { value: "當月增加", type: "square", id: "gain", color: GAIN },
                { value: "當月減少", type: "square", id: "loss", color: LOSS },
                { value: "月底公積金", type: "line", id: "level", color: LEVEL },
              ]}
            />
            <Bar dataKey="reserveChange" name="當月增減" maxBarSize={40} radius={[4, 4, 4, 4]} isAnimationActive={false}>
              {timeline.map((t) => (
                <Cell key={t.month} fill={t.reserveChange >= 0 ? GAIN : LOSS} />
              ))}
            </Bar>
            <Line
              dataKey="reserve"
              name="月底公積金"
              stroke={LEVEL}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, stroke: "#ffffff", fill: LEVEL }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ─────────────────────────────── 期間篩選 ───────────────────────────────
export type Period = "all" | "year" | "3m" | "thisMonth" | "lastMonth";
export const PERIOD_LABELS: Record<Period, string> = {
  all: "全部期間",
  year: "今年",
  "3m": "近 3 個月",
  thisMonth: "本月",
  lastMonth: "上個月",
};

export function inPeriod(ts: number, period: Period) {
  const m = monthOf(ts);
  const cur = thisMonthKey();
  switch (period) {
    case "all":
      return true;
    case "year":
      return m.slice(0, 4) === cur.slice(0, 4);
    case "3m":
      return m >= prevMonthKey(prevMonthKey(cur));
    case "thisMonth":
      return m === cur;
    case "lastMonth":
      return m === prevMonthKey(cur);
  }
}

function RankBars({ rows, empty }: { rows: { name: string; value: number }[]; empty: string }) {
  if (!rows.length) return <div className="text-sm text-slate-400 py-10 text-center">{empty}</div>;
  const height = Math.max(120, rows.length * 34 + 24);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 80, left: 8, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tick={{ fill: INK_MUTED, fontSize: 12 }}
            tickFormatter={fmtShort}
            ticks={niceTicks(Math.max(...rows.map((r) => r.value)))}
            domain={[0, "dataMax"]}
          />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#334155", fontSize: 12 }} width={150} />
          <Tooltip {...tooltipStyle()} formatter={(v: number) => [fmt(v), "金額"]} />
          <Bar dataKey="value" fill={BRAND} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
            <LabelList dataKey="value" position="right" formatter={(v: number) => fmt(v)} style={{ fill: "#334155", fontSize: 12 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────── 營收排行 ───────────────────────────────
/**
 * 依「產品」加總營業額：線上課程／小班家教用課程名稱；書籍拆到每本書
 * （一筆買多本時，實收金額依定價比例分攤）；其他收入用類別名稱。
 */
export function RevenueRankingChart({
  entries,
  bookPrices,
  courseNames,
  period,
}: {
  entries: Entry[];
  bookPrices: Map<string, number>;
  courseNames: Set<string>;
  period: Period;
}) {
  const rows = useMemo(() => {
    const totals = new Map<string, number>();
    const add = (k: string, v: number) => totals.set(k, (totals.get(k) ?? 0) + v);
    for (const e of entries.flatMap((x) => expandIncome(x, courseNames))) {
      if (!isRevenue(e) || !inPeriod(e.createdAt, period)) continue;
      const src = e.source;
      if (src === "tutoring") add(e.itemName, e.amount);
      else if (src === "book" && e.incomeSource === "book") {
        const parts = e.itemName.split("、").map((p) => {
          const m = p.match(/^(.*)×(\d+)$/);
          const name = m ? m[1] : p;
          const qty = m ? Number(m[2]) : 1;
          return { name, weight: (bookPrices.get(name) ?? 0) * qty };
        });
        const totalW = parts.reduce((s, p) => s + p.weight, 0);
        if (!totalW) add(e.itemName, e.amount);
        else {
          let left = e.amount;
          parts.forEach((p, i) => {
            const v = i === parts.length - 1 ? left : Math.round((e.amount * p.weight) / totalW);
            left -= v;
            add(p.name, v);
          });
        }
      } else add(e.categoryName, e.amount);
    }
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [entries, bookPrices, courseNames, period]);
  return (
    <ChartCard title="營收排行（前 10 名）" note="依產品加總：課程用課程名稱，書籍拆到每本書（一筆多本依定價比例分攤）。">
      <RankBars rows={rows} empty="這段期間沒有收入" />
    </ChartCard>
  );
}

// ─────────────────────────────── 支出分類 ───────────────────────────────
export function ExpenseCategoryChart({ entries, period }: { entries: Entry[]; period: Period }) {
  const rows = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of entries) {
      if (e.type !== "expense" || !inPeriod(e.createdAt, period)) continue;
      const k = isSalary(e) ? "薪水撥款" : e.categoryName;
      totals.set(k, (totals.get(k) ?? 0) + e.amount);
    }
    return [...totals.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [entries, period]);
  return (
    <ChartCard title="支出分類" note="錢花去哪；所有人的薪水合併成「薪水撥款」一項。">
      <RankBars rows={rows} empty="這段期間沒有支出" />
    </ChartCard>
  );
}

// ─────────────────────────────── 小班家教預收 ───────────────────────────────
export function PrepaidTutoringCard({ entries, courses }: { entries: Entry[]; courses: any[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = courses
    .filter((c) => c.category === "tutoring")
    .map((c) => {
      const received = entries
        .flatMap((e) => (e.type === "income" ? expandIncome(e, new Set()) : []))
        .filter((e) => e.incomeSource === "tutoring" && e.categoryId === c.id)
        .reduce((s, e) => s + e.amount, 0);
      let progress: number | null = null;
      if (c.startDate && c.endDate) {
        const start = new Date(c.startDate).getTime();
        const end = new Date(c.endDate).getTime();
        const now = new Date(today).getTime();
        progress = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;
      }
      const unearned = progress === null ? null : Math.round(received * (1 - progress));
      return { id: c.id, name: c.name, received, progress, unearned, startDate: c.startDate, endDate: c.endDate };
    })
    .filter((r) => r.received > 0 || r.progress !== null);
  const totalUnearned = rows.reduce((s, r) => s + (r.unearned ?? 0), 0);
  if (!rows.length) return null;
  return (
    <ChartCard
      title="小班家教預收學費"
      note="學費一次收齊，但課還沒上完；依上課期間估算還沒上的部分。這筆錢已經分給老師或留在公積金，但如果有人退費，要從這裡退。"
    >
      <div className="text-sm text-slate-600 mb-2">
        尚未上課的預收合計：<span className="font-semibold text-slate-800">{fmt(totalUnearned)}</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>課程</th>
              <th>上課期間</th>
              <th>已收學費</th>
              <th>上課進度</th>
              <th>尚未上課（預收）</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="whitespace-nowrap text-slate-500">{r.startDate && r.endDate ? `${r.startDate} ～ ${r.endDate}` : "未設定（到課程管理設定）"}</td>
                <td>{fmt(r.received)}</td>
                <td>
                  {r.progress === null ? (
                    "-"
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.round(r.progress * 100)}%`, background: BRAND }} />
                      </div>
                      <span className="text-xs text-slate-500">{Math.round(r.progress * 100)}%</span>
                    </div>
                  )}
                </td>
                <td className="font-medium">{r.unearned === null ? "-" : fmt(r.unearned)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

// ─────────────────────────────── 提醒 ───────────────────────────────
const DAY = 24 * 3600 * 1000;

export function AlertsCard({
  advances,
  coupons,
  stats,
  reconcileIssues = 0,
}: {
  advances: any[];
  coupons: any[];
  stats: PersonStatFull[];
  reconcileIssues?: number;
}) {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(now + 30 * DAY).toISOString().slice(0, 10);
  const items: { level: "warn" | "info"; text: string }[] = [];
  if (reconcileIssues > 0) items.push({ level: "warn", text: `官網有 ${reconcileIssues} 張訂單跟帳本對不上（到「官網對帳」處理）` });

  const staleAdvances = advances.filter((a) => a.status === "unsettled" && now - a.createdAt > 30 * DAY);
  if (staleAdvances.length) {
    const total = staleAdvances.reduce((s, a) => s + a.amount, 0);
    items.push({ level: "warn", text: `有 ${staleAdvances.length} 筆代墊超過 30 天還沒核銷，共 ${fmt(total)}（到「代墊管理」處理）` });
  }
  for (const p of stats) {
    const wage = p.balance - p.loan; // 扣掉要還的借款（創始基金），剩下才是欠的薪水分潤
    if (wage <= 0) continue;
    const since = p.lastPaidAt ?? p.firstOwedAt;
    if (since && now - since > 60 * DAY) {
      const days = Math.floor((now - since) / DAY);
      items.push({
        level: "warn",
        text: `${p.name}：欠薪分潤 ${fmt(wage)}，${p.lastPaidAt ? `距上次付款已 ${days} 天` : `從第一筆分潤起已 ${days} 天還沒付過`}`,
      });
    }
  }
  for (const c of coupons) {
    if (!c.isActive || !c.validUntil) continue;
    if (c.validUntil < today) items.push({ level: "info", text: `優惠碼 ${c.code} 已在 ${c.validUntil} 過期但還是「啟用中」，記得同步官網` });
    else if (c.validUntil <= in30) items.push({ level: "info", text: `優惠碼 ${c.code} 將在 ${c.validUntil} 到期` });
  }

  return (
    <div className="card">
      <h2 className="font-medium text-slate-700 mb-2">需要注意</h2>
      {items.length === 0 ? (
        <div className="text-sm text-slate-400">目前沒有需要處理的事項 ✓</div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="text-sm flex gap-2">
              <span className={it.level === "warn" ? "text-amber-600" : "text-slate-400"}>{it.level === "warn" ? "⚠" : "ⓘ"}</span>
              <span className="text-slate-700">{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────── 月報下載 ───────────────────────────────
function csvLine(cells: (string | number)[]) {
  return cells
    .map((v) => {
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}

export function MonthlyReportButton({
  entries,
  timeline,
  stats,
  courseNames,
}: {
  entries: Entry[];
  timeline: TimelinePoint[];
  stats: PersonStatFull[];
  courseNames: Set<string>;
}) {
  const months = useMemo(() => {
    const s = new Set(timeline.map((t) => t.month));
    entries.forEach((e) => s.add(monthOf(e.createdAt)));
    return [...s].sort().reverse();
  }, [entries, timeline]);
  const [month, setMonth] = useState("");
  const selected = month || months[0] || thisMonthKey();
  const SOURCE: Record<string, string> = { course: "線上課程", tutoring: "小班家教", book: "書籍", other: "其他收入", mixed: "多項收入" };

  function download() {
    const rows = entries.filter((e) => monthOf(e.createdAt) === selected);
    const revenue = rows.filter(isRevenue).reduce((s, e) => s + e.amount, 0);
    const loanIn = rows.filter((e) => e.type === "income" && !isRevenue(e)).reduce((s, e) => s + e.amount, 0);
    const expense = rows.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);
    const salary = rows.filter((e) => e.type === "expense" && isSalary(e)).reduce((s, e) => s + e.amount, 0);
    const t = timeline.find((x) => x.month === selected);
    const L: string[] = [];
    L.push(csvLine([`澈點科學 月報`, selected]));
    L.push("");
    L.push(csvLine(["一、損益摘要"]));
    L.push(csvLine(["營業額", revenue]));
    if (loanIn) L.push(csvLine(["借款收入（創始基金等，不算營業額）", loanIn]));
    L.push(csvLine(["支出合計", expense]));
    L.push(csvLine(["　其中薪水撥款", salary]));
    L.push(csvLine(["　其中公帳支出", expense - salary]));
    L.push(csvLine(["當月公積金增減", t?.reserveChange ?? 0]));
    L.push(csvLine(["月底公積金", t?.reserve ?? 0]));
    L.push(csvLine(["月底母帳餘額", t?.balance ?? 0]));
    L.push(csvLine(["月底欠所有人", t?.owed ?? 0]));
    L.push("");
    L.push(csvLine(["二、收入明細"]));
    L.push(csvLine(["日期", "項目", "類別", "收入來源", "金額", "公積金增減", "備註"]));
    for (const e of rows.filter((x) => x.type === "income"))
      L.push(csvLine([new Date(e.createdAt).toLocaleDateString(), e.itemName, e.categoryName, SOURCE[inferSource(e, courseNames)] ?? "", e.amount, e.amount - e.distributed, e.note ?? ""]));
    L.push("");
    L.push(csvLine(["三、支出明細"]));
    L.push(csvLine(["日期", "項目", "類別", "金額", "公積金增減", "備註"]));
    for (const e of rows.filter((x) => x.type === "expense"))
      L.push(csvLine([new Date(e.createdAt).toLocaleDateString(), e.itemName, isSalary(e) ? `${e.categoryName}（薪水撥款）` : e.categoryName, e.amount, -(e.amount - e.distributed), e.note ?? ""]));
    L.push("");
    L.push(csvLine(["四、每人分潤"]));
    L.push(csvLine(["身份", "姓名", "本月分得", "本月領取", "目前欠款（含借款與代墊）"]));
    for (const p of stats) {
      const m = p.monthly[selected] ?? { earned: 0, paid: 0 };
      if (!m.earned && !m.paid && !p.balance) continue;
      L.push(csvLine([p.recipientType === "teacher" ? "教師" : "推銷者", p.name, m.earned, m.paid, p.balance]));
    }
    downloadTextFile(`澈點科學月報_${selected}.csv`, "﻿" + L.join("\r\n"));
  }

  return (
    <div className="flex items-center gap-2">
      <select className="input !w-32" value={selected} onChange={(e) => setMonth(e.target.value)} title="選擇月報月份">
        {months.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <button className="btn-secondary whitespace-nowrap" onClick={download} disabled={!months.length}>
        下載月報（Excel）
      </button>
    </div>
  );
}
