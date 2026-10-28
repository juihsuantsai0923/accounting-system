import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from "recharts";

/**
 * 儀表板圖表。顏色依「用途」決定：
 *   月營業額＝依收入來源分類（categorical，固定順序，validate_palette.js 已驗證，黃／綠對比不足 3:1 → 附表格檢視）
 *   每人營業額、每人欠薪＝單一數列，用品牌深藍
 */
const SOURCE_SERIES = [
  { key: "course", label: "線上課程", color: "#2a78d6" },
  { key: "tutoring", label: "小班家教", color: "#eb6834" },
  { key: "book", label: "書籍", color: "#1baf7a" },
  { key: "other", label: "其他收入", color: "#eda100" },
] as const;
export const BRAND = "#1e3a6e";
export const INK_MUTED = "#64748b";
export const GRID = "#e2e8f0";

/** 股東投入的資金不是營業收入，不算進營業額 */
export const NON_REVENUE_CATEGORIES = new Set(["創始基金"]);

export function fmt(n: number) {
  return n < 0 ? `−NT$${Math.abs(n).toLocaleString()}` : `NT$${n.toLocaleString()}`;
}
export function fmtShort(n: number) {
  return Math.abs(n) >= 10000 ? `${Math.round(n / 1000) / 10}萬` : n.toLocaleString();
}
/** 1、2、2.5、5 × 10ⁿ 的整齊刻度，避免出現 9,500、1.9萬 這種刻度 */
export function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks = [];
  for (let v = 0; v < max + step; v += step) ticks.push(v);
  return ticks;
}

export function monthOf(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface LedgerRow {
  type: string;
  amount: number;
  categoryName: string;
  incomeSource: string | null;
  breakdown?: string | null;
  createdAt: number;
}

export function inferSource(e: LedgerRow, courseNames: Set<string>) {
  if (e.incomeSource) return e.incomeSource;
  // 舊記錄沒有收入來源：用類別名稱推回去
  if (courseNames.has(e.categoryName)) return "course";
  if (e.categoryName.includes("行事曆") || e.categoryName.includes("書")) return "book";
  return "other";
}

/**
 * 一筆收入拆成項目：多門課、多本書合成一筆的記錄，依 breakdown 拆回每一項（來源、名稱、金額）；
 * 一般記錄就是它自己一項。報表統一用這個，合併記帳才不會整筆算成同一個來源。
 */
export function expandIncome<T extends LedgerRow & { itemName?: string; categoryId?: number }>(e: T, courseNames: Set<string>) {
  if (e.breakdown) {
    try {
      const parts = JSON.parse(e.breakdown) as { source: string; name: string; categoryId: number; amount: number }[];
      return parts.map((p) => ({
        ...e,
        incomeSource: p.source,
        itemName: p.name,
        categoryId: p.categoryId,
        categoryName: p.source === "tutoring" ? "小班家教" : p.source === "book" ? "書籍" : p.name,
        amount: p.amount,
        breakdown: null,
        source: p.source,
      }));
    } catch {
      /* 明細壞掉就當一般記錄 */
    }
  }
  return [{ ...e, source: inferSource(e, courseNames) }];
}

export function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="mb-3">
        <h2 className="font-medium text-brand-700">{title}</h2>
        {note && <p className="text-xs text-slate-400 mt-0.5">{note}</p>}
      </div>
      {children}
    </div>
  );
}

export function tooltipStyle() {
  return {
    contentStyle: { borderRadius: 8, border: `1px solid ${GRID}`, fontSize: 13 },
    labelStyle: { color: "#0f172a", fontWeight: 600 },
    cursor: { fill: "rgba(23,59,105,0.06)" },
  };
}

export function MonthlyRevenueChart({ entries, courseNames }: { entries: LedgerRow[]; courseNames: Set<string> }) {
  const [showTable, setShowTable] = useState(false);
  const data = useMemo(() => {
    const revenue = entries.filter((e) => e.type === "income" && !NON_REVENUE_CATEGORIES.has(e.categoryName));
    if (!revenue.length) return [];
    const byMonth = new Map<string, Record<string, number>>();
    for (const e of revenue) {
      const m = monthOf(e.createdAt);
      const row = byMonth.get(m) ?? { course: 0, tutoring: 0, book: 0, other: 0 };
      for (const p of expandIncome(e, courseNames)) row[p.source] = (row[p.source] ?? 0) + p.amount;
      byMonth.set(m, row);
    }
    // 補齊中間沒有收入的月份，時間軸才不會跳
    const months = [...byMonth.keys()].sort();
    const out: any[] = [];
    let [y, mo] = months[0].split("-").map(Number);
    const [ly, lm] = months[months.length - 1].split("-").map(Number);
    while (y < ly || (y === ly && mo <= lm)) {
      const key = `${y}-${String(mo).padStart(2, "0")}`;
      const row = byMonth.get(key) ?? { course: 0, tutoring: 0, book: 0, other: 0 };
      out.push({ month: key, ...row, total: row.course + row.tutoring + row.book + row.other });
      mo += 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
    }
    return out;
  }, [entries, courseNames]);

  return (
    <ChartCard title="月營業額" note="依收入來源分色；不含創始基金（股東投入）。">
      {data.length === 0 ? (
        <div className="text-sm text-slate-400 py-10 text-center">還沒有收入記錄</div>
      ) : (
        <>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: INK_MUTED, fontSize: 12 }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: INK_MUTED, fontSize: 12 }}
                  tickFormatter={fmtShort}
                  width={48}
                  ticks={niceTicks(Math.max(...data.map((d) => d.total)))}
                  domain={[0, "dataMax"]}
                />
                <Tooltip {...tooltipStyle()} formatter={(v: number, name: string) => [fmt(v), name]} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 13, color: INK_MUTED }} />
                {SOURCE_SERIES.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    stackId="rev"
                    isAnimationActive={false}
                    fill={s.color}
                    stroke="#ffffff"
                    strokeWidth={2}
                    maxBarSize={44}
                    radius={i === SOURCE_SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                  >
                    {i === SOURCE_SERIES.length - 1 && (
                      <LabelList dataKey="total" position="top" formatter={fmtShort} style={{ fill: "#334155", fontSize: 12 }} />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <button type="button" className="text-xs text-brand-600 hover:underline mt-2" onClick={() => setShowTable((v) => !v)}>
            {showTable ? "隱藏表格" : "顯示表格"}
          </button>
          {showTable && (
            <div className="table-wrap mt-2">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>月份</th>
                    {SOURCE_SERIES.map((s) => (
                      <th key={s.key}>{s.label}</th>
                    ))}
                    <th>合計</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data].reverse().map((r) => (
                    <tr key={r.month}>
                      <td>{r.month}</td>
                      {SOURCE_SERIES.map((s) => (
                        <td key={s.key}>{r[s.key] ? fmt(r[s.key]) : "-"}</td>
                      ))}
                      <td className="font-medium">{fmt(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </ChartCard>
  );
}

function PersonBarChart({ rows, empty }: { rows: { name: string; value: number }[]; empty: string }) {
  if (!rows.length) return <div className="text-sm text-slate-400 py-10 text-center">{empty}</div>;
  const height = Math.max(120, rows.length * 40 + 24);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 72, left: 8, bottom: 4 }}>
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
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#334155", fontSize: 13 }} width={64} />
          <Tooltip {...tooltipStyle()} formatter={(v: number) => [fmt(v), "金額"]} />
          <Bar dataKey="value" fill={BRAND} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
            <LabelList dataKey="value" position="right" formatter={(v: number) => fmt(v)} style={{ fill: "#334155", fontSize: 12 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface PersonStat {
  recipientType: string;
  name: string;
  earned: number;
  paid: number;
  balance: number;
}

export function PersonRevenueChart({ stats }: { stats: PersonStat[] }) {
  const rows = stats
    .filter((s) => s.earned > 0)
    .map((s) => ({ name: s.name, value: s.earned }))
    .sort((a, b) => b.value - a.value);
  return (
    <ChartCard title="每人營業額" note="累計分到每個人子記帳表的收入（課程分潤、小班家教、團隊獎金、推廣抽成）。">
      <PersonBarChart rows={rows} empty="還沒有分潤記錄" />
    </ChartCard>
  );
}

export function PersonOwedChart({ stats }: { stats: PersonStat[] }) {
  const rows = stats
    .filter((s) => s.balance > 0)
    .map((s) => ({ name: s.name, value: s.balance }))
    .sort((a, b) => b.value - a.value);
  return (
    <ChartCard title="每人欠薪" note="公司目前還欠每個人多少（含未核銷代墊），付薪水後會減少。">
      <PersonBarChart rows={rows} empty="目前沒有欠任何人" />
    </ChartCard>
  );
}
