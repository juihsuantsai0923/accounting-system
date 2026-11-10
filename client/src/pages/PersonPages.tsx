import { useEffect, useMemo, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "../lib/trpc";
import ItemCell from "../components/ItemCell";
import { downloadTextFile } from "../lib/download";
import { BRAND, GRID, INK_MUTED, fmt, fmtShort, niceTicks, tooltipStyle } from "../components/DashboardCharts";
import PaySchedule from "../components/PaySchedule";

/**
 * 老師／推銷者的個人頁：「儀表板」（下次發放、累積分潤、已發放、每月發放圖；只有個人的，不放全公司數字）和「帳本」（子記帳表，唯讀，可篩選排序）。
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
    <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
          <NavLink to={`/${kind}/${id}/statement`} className={tab}>
            月結對帳單
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

      {/* 只顯示個人的資料（2026-11-10 使用者要求：老師頁不放全公司數字）；最上面是下次發放 */}
      <PaySchedule kind={kind} id={id} />

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
          <div className={`text-2xl font-semibold mt-1 ${(s?.balance ?? 0) > 0 ? "text-amber-600" : "text-slate-700"}`}>{fmt(Math.max(0, s?.balance ?? 0))}</div>
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

      <EarnedVsPayChart kind={kind} id={id} monthly={monthly} />
    </div>
  );
}

const GOLD = "#c8860f";

/**
 * 每月業績（當月分到的分潤）與欲發放薪資（每個月底預計發的，含分期計畫）。
 * 業績看的是哪個月入帳；發放看的是哪個月底發，衝刺班按天攤提、登記前的帳分期，所以兩條線不會一樣。
 */
function EarnedVsPayChart({ kind, id, monthly }: { kind: Kind; id: number; monthly: { month: string; earned: number }[] }) {
  const sched = trpc.payroll.person.useQuery({ recipientType: kind, recipientId: id }, { enabled: !!id, retry: false });
  const [showTable, setShowTable] = useState(false);
  const data = useMemo(() => {
    const m = new Map<string, { month: string; earned: number | null; pay: number | null }>();
    for (const r of monthly) m.set(r.month, { month: r.month, earned: r.earned, pay: null });
    for (const p of sched.data?.paydays ?? []) {
      const k = p.payday.slice(0, 7);
      m.set(k, { month: k, earned: m.get(k)?.earned ?? null, pay: p.plan });
    }
    const keys = [...m.keys()].sort();
    // 業績只畫到這個月；發放畫到最後一次發薪
    const thisMonth = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    return keys.map((k) => {
      const v = m.get(k)!;
      return { ...v, earned: k <= thisMonth ? v.earned ?? 0 : null };
    });
  }, [monthly, sched.data]);
  const max = Math.max(0, ...data.map((d) => Math.max(d.earned ?? 0, d.pay ?? 0)));
  return (
    <div className="card">
      <div className="mb-3">
        <h2 className="font-medium text-brand-700">每月業績與欲發放薪資</h2>
        <p className="text-xs text-slate-400 mt-0.5">業績＝當月入帳分到的分潤；欲發放＝每個月底預計發給你的（衝刺班依上課進度、這一屆分期發），之後的月份是依目前的帳預估。</p>
      </div>
      {!data.length || max === 0 ? (
        <div className="text-sm text-slate-400 py-10 text-center">還沒有資料</div>
      ) : (
        <>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 16, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: INK_MUTED, fontSize: 12 }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: INK_MUTED, fontSize: 12 }}
                  ticks={niceTicks(max)}
                  domain={[0, "dataMax"]}
                  tickFormatter={fmtShort}
                  width={48}
                />
                <Tooltip {...tooltipStyle()} formatter={(v: number, name: string) => [fmt(v), name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="earned" name="每月業績" stroke={BRAND} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
                <Line
                  type="monotone"
                  dataKey="pay"
                  name="欲發放薪資"
                  stroke={GOLD}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={{ r: 3 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
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
                  <th>每月業績</th>
                  <th>欲發放薪資</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.month}>
                    <td>{r.month}</td>
                    <td>{r.earned == null ? "-" : fmt(r.earned)}</td>
                    <td>{r.pay == null ? "-" : fmt(r.pay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
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

// ─────────────────────────────── 月結對帳單 ───────────────────────────────
/** 子記帳表一筆對餘額的影響（跟 server/ledger.ts ledgerDelta 一樣） */
function deltaOf(r: any) {
  if (r.sourceType === "advance") return r.personalAmount;
  if (r.sourceType === "advance_settlement") return -r.personalAmount;
  return r.type === "income" ? r.personalAmount : -r.personalAmount;
}
const monthKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function StatementTable({ title, list, showBuyer }: { title: string; list: any[]; showBuyer?: boolean }) {
  const total = list.reduce((s, r) => s + deltaOf(r), 0);
  return (
    <div>
      <h3 className="font-medium text-brand-700 mb-2">{title}</h3>
      {list.length ? (
        <table className="data-table text-sm">
          <thead>
            <tr>
              <th className="w-28">日期</th>
              {showBuyer && <th className="w-24">買家</th>}
              <th>項目</th>
              <th className="text-right w-32">金額</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                {showBuyer && <td>{r.buyer ?? "—"}</td>}
                <td>{r.itemName}</td>
                <td className="text-right tabular-nums">{fmt(Math.abs(deltaOf(r)))}</td>
              </tr>
            ))}
            <tr className="font-medium bg-slate-50">
              <td colSpan={showBuyer ? 3 : 2}>小計</td>
              <td className="text-right tabular-nums">{fmt(Math.abs(total))}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-slate-400">這個月沒有</p>
      )}
    </div>
  );
}

/**
 * 每月一張：月初公司欠多少、這個月分到哪些分潤、撥了哪些款、代墊，月底欠多少。
 * 「列印／存成 PDF」用瀏覽器列印（頁首、按鈕不會印出來），發薪時一起給老師。
 */
export function PersonStatementPage({ kind }: { kind: Kind }) {
  const { id, name } = usePerson(kind);
  const teacherQ = trpc.teacherLedger.list.useQuery({ teacherId: id }, { enabled: kind === "teacher" && !!id });
  const salesQ = trpc.salespersonLedger.list.useQuery({ salespersonId: id }, { enabled: kind === "salesperson" && !!id });
  const q = kind === "teacher" ? teacherQ : salesQ;
  const rows: any[] = q.data ?? [];
  const months = useMemo(() => {
    const s = new Set(rows.map((r) => monthKey(r.createdAt)));
    s.add(monthKey(Date.now()));
    return [...s].sort().reverse();
  }, [rows]);
  // 預設上個月（月初發薪時看的是上個月）
  const [month, setMonth] = useState("");
  const lastMonth = (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return monthKey(d.getTime());
  })();
  const selected = month || (months.includes(lastMonth) ? lastMonth : months[0]);

  const opening = rows.filter((r) => monthKey(r.createdAt) < selected).reduce((s, r) => s + deltaOf(r), 0);
  const inMonth = rows.filter((r) => monthKey(r.createdAt) === selected);
  const earned = inMonth.filter((r) => r.sourceType === "distribution" && r.type === "income");
  const paid = inMonth.filter((r) => r.sourceType === "distribution" && r.type !== "income");
  const advances = inMonth.filter((r) => r.sourceType !== "distribution");
  const total = (list: any[]) => list.reduce((s, r) => s + deltaOf(r), 0);
  const closing = opening + total(inMonth);
  const [y, m] = selected.split("-");
  // 月底欠款拆成「截至月底已到期、還沒發」和「尚未到期」（發薪日＝每月月底）
  const sched = trpc.payroll.person.useQuery({ recipientType: kind, recipientId: id }, { enabled: !!id, retry: false });
  const nextPd = (() => {
    const [yy, mm] = selected.split("-").map(Number);
    return `${selected}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, "0")}`;
  })();
  const pd = sched.data?.paydays.find((p) => p.payday === nextPd);
  const dueAtMonthEnd = pd ? Math.max(0, pd.cumVested - pd.paidBeforeCutoff) : null;

  return (
    <div className="space-y-6">
      <PersonHeader
        kind={kind}
        id={id}
        name={name}
        right={
          <div className="flex items-center gap-2">
            <select className="input !w-36" value={selected} onChange={(e) => setMonth(e.target.value)}>
              {months.map((mm) => (
                <option key={mm} value={mm}>
                  {mm.replace("-", " 年 ")} 月
                </option>
              ))}
            </select>
            <button className="btn-primary" onClick={() => window.print()}>
              列印／存成 PDF
            </button>
          </div>
        }
      />
      {q.error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{q.error.message}</div>}

      <div className="card space-y-6 max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs text-slate-400 tracking-widest">澈點科學 Leviax Lab</div>
            <h2 className="text-2xl text-brand-700 mt-1">月結對帳單</h2>
            <div className="text-sm text-slate-600 mt-1">
              {name ?? "…"}（{KIND_LABEL[kind]}）・{y} 年 {Number(m)} 月
            </div>
          </div>
          <img src="/leviax-logo.png" alt="澈點科學" className="h-16 object-contain" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {[
            { label: "月初公司欠款", value: opening, strong: false },
            { label: "本月分潤", value: total(earned), strong: false },
            { label: "本月已撥款", value: Math.abs(total(paid)), strong: false },
            { label: "月底公司欠款", value: closing, strong: true },
          ].map((k) => (
            <div key={k.label} className={`rounded-lg p-3 ${k.strong ? "bg-brand-50" : "bg-slate-50"}`}>
              <div className="text-slate-500">{k.label}</div>
              <div className={`text-lg font-semibold mt-0.5 ${k.strong ? "text-brand-700" : "text-slate-800"}`}>{fmt(k.value)}</div>
            </div>
          ))}
        </div>

        {dueAtMonthEnd != null && (
          <div className="text-sm text-slate-700 bg-amber-50 rounded-lg px-3 py-2">
            月底欠款中，截至月底<b>已到期、還沒發 {fmt(dueAtMonthEnd)}</b>，
            <b>尚未到期 {fmt(closing - dueAtMonthEnd)}</b>（衝刺班還沒上的課、家長還沒繳的學費）。
          </div>
        )}

        <StatementTable title="本月分潤明細" list={earned} showBuyer />
        <StatementTable title="本月撥款" list={paid} />
        {advances.length > 0 && <StatementTable title="代墊（入帳＝公司欠你、核銷＝已還）" list={advances} />}

        <p className="text-xs text-slate-400 border-t border-slate-200 pt-3">
          月底公司欠款 ＝ 月初欠款 {fmt(opening)} ＋ 本月分潤 {fmt(total(earned))} − 本月撥款 {fmt(Math.abs(total(paid)))}
          {advances.length > 0 && `${total(advances) >= 0 ? " ＋ " : " − "}代墊 ${fmt(Math.abs(total(advances)))}`} ＝ {fmt(closing)}。列印時間{" "}
          {new Date().toLocaleString()}。
        </p>
      </div>
    </div>
  );
}
