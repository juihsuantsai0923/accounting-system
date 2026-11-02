import { useEffect, useMemo, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "../lib/trpc";
import ItemCell from "../components/ItemCell";
import { downloadTextFile } from "../lib/download";
import { BRAND, GRID, INK_MUTED, MonthlyRevenueChart, fmt, fmtShort, niceTicks, tooltipStyle } from "../components/DashboardCharts";
import { ReserveTrendChart } from "../components/DashboardAnalytics";

/**
 * 老師／推銷者的個人頁：「儀表板」（累積分潤、已發放、每月發放圖）和「帳本」（子記帳表，唯讀，可篩選排序）。
 * 本人登入時看自己的；管理員從「人員」選單點進來看任何人的。
 */
type Kind = "teacher" | "salesperson";
const KIND_LABEL: Record<Kind, string> = { teacher: "教師", salesperson: "推銷者" };

const SOURCE_LABELS: Record<string, string> = {
  distribution: "一般分配",
  advance: "代墊入帳",
  advance_settlement: "代墊核銷",
};
const TYPE_LABELS: Record<string, string> = { income: "收入", expense: "支出", advance: "代墊" };

function usePerson(kind: Kind) {
  const id = Number(useParams().id);
  const teachers = trpc.teachers.list.useQuery(undefined, { enabled: kind === "teacher" });
  const salespeople = trpc.salespeople.list.useQuery(undefined, { enabled: kind === "salesperson" });
  const list: any[] = (kind === "teacher" ? teachers.data : salespeople.data) ?? [];
  return { id, name: list.find((p) => p.id === id)?.name as string | undefined };
}

function PersonHeader({ kind, id, name, right }: { kind: Kind; id: number; name?: string; right?: React.ReactNode }) {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-1.5 rounded-full text-xs tracking-widest transition-all ${isActive ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-700/60 hover:bg-brand-100"}`;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl text-brand-700">
          {name ?? "..."}
          <span className="ml-2 text-sm text-slate-400 font-sans">{KIND_LABEL[kind]}</span>
        </h1>
        <div className="flex gap-2">
          <NavLink to={`/${kind}/${id}/dashboard`} className={tab}>
            儀表板
          </NavLink>
          <NavLink to={`/${kind}/${id}`} end className={tab}>
            帳本
          </NavLink>
        </div>
      </div>
      {right}
    </div>
  );
}

// ─────────────────────────────── 個人儀表板 ───────────────────────────────
export function PersonDashboardPage({ kind }: { kind: Kind }) {
  const { id, name } = usePerson(kind);
  const q = trpc.reports.personDashboard.useQuery({ recipientType: kind, recipientId: id }, { enabled: !!id });
  const s = q.data;
  const [showTable, setShowTable] = useState(false);
  // 全公司三個總數（老師也看得到；推銷者沒有權限，就不顯示）
  const company = trpc.reports.companySummary.useQuery(undefined, { enabled: kind === "teacher", retry: false });
  const revenue = trpc.reports.revenueEntries.useQuery(undefined, { enabled: kind === "teacher", retry: false });
  const timeline = trpc.reports.timeline.useQuery(undefined, { enabled: kind === "teacher", retry: false });
  const courses = trpc.courses.list.useQuery(undefined, { enabled: kind === "teacher" });
  const courseNames = useMemo(() => new Set((courses.data ?? []).map((c: any) => c.name as string)), [courses.data]);

  // 每月已發放：補齊中間沒有發放的月份，時間軸才不會跳
  const monthly = useMemo(() => {
    const m = s?.monthly ?? {};
    const keys = Object.keys(m).sort();
    if (!keys.length) return [];
    const out: { month: string; paid: number; earned: number }[] = [];
    let [y, mo] = keys[0].split("-").map(Number);
    const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
    while (y < ly || (y === ly && mo <= lm)) {
      const k = `${y}-${String(mo).padStart(2, "0")}`;
      out.push({ month: k, paid: m[k]?.paid ?? 0, earned: m[k]?.earned ?? 0 });
      mo += 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
    }
    return out;
  }, [s]);
  const maxPaid = Math.max(0, ...monthly.map((r) => r.paid));

  return (
    <div className="space-y-6">
      <PersonHeader kind={kind} id={id} name={name} />
      {q.error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{q.error.message}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="text-sm text-slate-500">累積薪資（分潤）</div>
          <div className="text-2xl font-semibold mt-1 text-brand-700">{fmt(s?.earned ?? 0)}</div>
          <div className="text-xs text-slate-400 mt-1">課程、小班家教等分到的總額</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">已發放薪資</div>
          <div className="text-2xl font-semibold mt-1 text-emerald-600">{fmt(s?.paid ?? 0)}</div>
          <div className="text-xs text-slate-400 mt-1">{s?.lastPaidAt ? `最近一次 ${new Date(s.lastPaidAt).toLocaleDateString()}` : "還沒發放過"}</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">公司目前欠款</div>
          <div className={`text-2xl font-semibold mt-1 ${(s?.balance ?? 0) > 0 ? "text-amber-600" : "text-slate-700"}`}>{fmt(s?.balance ?? 0)}</div>
          <div className="text-xs text-slate-400 mt-1">還沒發的薪資＋代墊{(s?.loan ?? 0) > 0 ? "＋創始基金" : ""}</div>
        </div>
        {(s?.loan ?? 0) > 0 ? (
          <div className="card">
            <div className="text-sm text-slate-500">創始基金借款</div>
            <div className="text-2xl font-semibold mt-1 text-slate-700">{fmt(s!.loan)}</div>
            <div className="text-xs text-slate-400 mt-1">公司之後要還給你</div>
          </div>
        ) : (
          <div className="card">
            <div className="text-sm text-slate-500">發放比例</div>
            <div className="text-2xl font-semibold mt-1 text-slate-700">{s?.earned ? `${Math.round((s.paid / s.earned) * 100)}%` : "-"}</div>
            <div className="text-xs text-slate-400 mt-1">已發放 ÷ 累積薪資</div>
          </div>
        )}
      </div>

      {company.data && (
        <div className="space-y-2">
          <div className="text-sm text-slate-500">全公司（累計）</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card">
              <div className="text-sm text-slate-500">總收入</div>
              <div className="text-2xl font-semibold mt-1 text-emerald-600">{fmt(company.data.totalIncome)}</div>
            </div>
            <div className="card">
              <div className="text-sm text-slate-500">總支出</div>
              <div className="text-2xl font-semibold mt-1 text-red-600">{fmt(company.data.totalExpense)}</div>
            </div>
            <div className="card">
              <div className="text-sm text-slate-500">公積金增減</div>
              <div className={`text-2xl font-semibold mt-1 ${company.data.reserveChange < 0 ? "text-red-600" : "text-brand-700"}`}>
                {company.data.reserveChange > 0 ? "+" : ""}
                {fmt(company.data.reserveChange)}
              </div>
              <div className="text-xs text-slate-400 mt-1">收入留給公司的部分 − 公帳支出</div>
            </div>
          </div>
          {revenue.data && timeline.data && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MonthlyRevenueChart entries={revenue.data} courseNames={courseNames} />
              <ReserveTrendChart timeline={timeline.data} />
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="mb-3">
          <h2 className="font-medium text-brand-700">每月已發放薪資</h2>
          <p className="text-xs text-slate-400 mt-0.5">每個月實際撥給你的薪水（台灣時間）。</p>
        </div>
        {monthly.length === 0 || maxPaid === 0 ? (
          <div className="text-sm text-slate-400 py-10 text-center">還沒有發放紀錄</div>
        ) : (
          <>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: INK_MUTED, fontSize: 12 }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: INK_MUTED, fontSize: 12 }}
                    ticks={niceTicks(maxPaid)}
                    domain={[0, "dataMax"]}
                    tickFormatter={fmtShort}
                    width={48}
                  />
                  <Tooltip {...tooltipStyle()} formatter={(v: number) => [fmt(v), "已發放"]} />
                  <Bar dataKey="paid" name="已發放" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <button type="button" className="mt-2 text-xs text-brand-600 hover:underline" onClick={() => setShowTable((v) => !v)}>
              {showTable ? "隱藏表格" : "顯示表格"}
            </button>
            {showTable && (
              <table className="data-table mt-2">
                <thead>
                  <tr>
                    <th>月份</th>
                    <th>當月分潤</th>
                    <th>當月已發放</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((r) => (
                    <tr key={r.month}>
                      <td>{r.month}</td>
                      <td>{fmt(r.earned)}</td>
                      <td>{fmt(r.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────── 個人帳本（子記帳表） ───────────────────────────────
const SORT_KEY = "personLedger.sortNewestFirst";

export function PersonLedgerPage({ kind }: { kind: Kind }) {
  const { id, name } = usePerson(kind);
  const utils = trpc.useUtils();
  const teacherQ = trpc.teacherLedger.list.useQuery({ teacherId: id }, { enabled: kind === "teacher" && !!id });
  const salesQ = trpc.salespersonLedger.list.useQuery({ salespersonId: id }, { enabled: kind === "salesperson" && !!id });
  const q = kind === "teacher" ? teacherQ : salesQ;
  const rows: any[] = q.data ?? [];
  const [exporting, setExporting] = useState(false);

  const [newestFirst, setNewestFirst] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SORT_KEY) !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, newestFirst ? "1" : "0");
    } catch {
      /* 無痕模式等情況存不了，不影響使用 */
    }
  }, [newestFirst]);
  const [filterType, setFilterType] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterText, setFilterText] = useState("");

  const monthOf = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const categoryOptions = [...new Set(rows.map((r) => r.categoryName).filter(Boolean))].sort();
  const monthOptions = [...new Set(rows.map((r) => monthOf(r.createdAt)))].sort().reverse();
  const isFiltering = !!(filterType || filterCategory || filterMonth || filterText.trim());
  const visible = rows
    .filter((r) => !filterType || r.type === filterType)
    .filter((r) => !filterCategory || r.categoryName === filterCategory)
    .filter((r) => !filterMonth || monthOf(r.createdAt) === filterMonth)
    .filter((r) => {
      const t = filterText.trim().toLowerCase();
      return !t || `${r.buyer ?? ""} ${r.itemName} ${r.categoryName ?? ""}`.toLowerCase().includes(t);
    });
  if (newestFirst) visible.reverse();
  const sum = (type: string) => visible.filter((r) => r.type === type).reduce((s, r) => s + r.personalAmount, 0);
  const currentBalance = rows.length ? rows[rows.length - 1].personalBalance : 0;

  async function handleExportCsv() {
    setExporting(true);
    try {
      const result = await utils.reports.exportRecipientStatementCsv.fetch({ recipientType: kind, recipientId: id });
      downloadTextFile(result.filename, result.csv);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PersonHeader
        kind={kind}
        id={id}
        name={name}
        right={
          <div className="flex items-center gap-3">
            <div className="card !p-3 !py-2 text-sm">
              目前餘額：<span className="font-semibold">{fmt(currentBalance)}</span>
            </div>
            <button className="btn-secondary" onClick={handleExportCsv} disabled={exporting}>
              {exporting ? "匯出中..." : "下載 CSV 對帳單"}
            </button>
          </div>
        }
      />
      {q.error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{q.error.message}</div>}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">排序</label>
            <button type="button" className="btn-secondary" onClick={() => setNewestFirst((v) => !v)}>
              {newestFirst ? "新 → 舊" : "舊 → 新"} ⇅
            </button>
          </div>
          <div>
            <label className="label">類型</label>
            <select className="input !w-28" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">全部</option>
              <option value="income">收入</option>
              <option value="expense">支出</option>
              {rows.some((r) => r.type === "advance") && <option value="advance">代墊</option>}
            </select>
          </div>
          <div>
            <label className="label">類別</label>
            <select className="input !w-44" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">全部類別</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">月份</label>
            <select className="input !w-32" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}>
              <option value="">全部月份</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label className="label">搜尋</label>
            <input className="input" placeholder="項目或類別..." value={filterText} onChange={(e) => setFilterText(e.target.value)} />
          </div>
          {isFiltering && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setFilterType("");
                setFilterCategory("");
                setFilterMonth("");
                setFilterText("");
              }}
            >
              清除篩選
            </button>
          )}
        </div>
        <div className="text-sm text-slate-600 flex flex-wrap gap-x-5 gap-y-1">
          <span>
            {isFiltering ? "符合" : "共"} {visible.length} 筆
          </span>
          <span className="text-emerald-600">收入 {fmt(sum("income"))}</span>
          <span className="text-red-600">支出 {fmt(sum("expense"))}</span>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>買家</th>
                <th>項目</th>
                <th>類別</th>
                <th>來源</th>
                <th>類型</th>
                <th>原金額</th>
                <th>分潤比例</th>
                <th>個人金額</th>
                <th title="依記錄先後計算，不受排序和篩選影響">餘額</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleDateString()}</td>
                  <td>{entry.buyer ?? <span className="text-slate-300">-</span>}</td>
                  <td>
                    <ItemCell itemName={entry.itemName} />
                  </td>
                  <td>{entry.categoryName ?? "-"}</td>
                  <td className={entry.sourceType === "advance" ? "text-amber-600" : entry.sourceType === "advance_settlement" ? "text-slate-500" : ""}>
                    {SOURCE_LABELS[entry.sourceType] ?? entry.sourceType}
                  </td>
                  <td className={entry.type === "income" ? "text-emerald-600" : "text-red-600"}>{TYPE_LABELS[entry.type] ?? entry.type}</td>
                  <td>{entry.originalAmount != null ? fmt(entry.originalAmount) : "-"}</td>
                  <td>{entry.originalAmount ? `${Math.round((entry.personalAmount / entry.originalAmount) * 100)}%` : "-"}</td>
                  <td>{fmt(entry.personalAmount)}</td>
                  <td>{fmt(entry.personalBalance)}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-slate-400 py-6">
                    {isFiltering ? "沒有符合篩選條件的記錄" : "尚無記錄"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
