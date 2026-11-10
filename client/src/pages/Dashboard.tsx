import { trpc } from "../lib/trpc";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { downloadTextFile } from "../lib/download";
import { useState } from "react";
import { MonthlyRevenueChart, PersonOwedChart, PersonRevenueChart } from "../components/DashboardCharts";
import LevelCard from "../components/LevelCard";
import {
  AlertsCard,
  ExpenseCategoryChart,
  KpiCompare,
  MonthlyReportButton,
  PERIOD_LABELS,
  PrepaidTutoringCard,
  ReserveTrendChart,
  RevenueRankingChart,
  type Period,
} from "../components/DashboardAnalytics";

/** 發完薪水後公積金至少要留的錢 */
const RESERVE_TARGET = 10000;

function fmt(n: number) {
  return n < 0 ? `−NT$${Math.abs(n).toLocaleString()}` : `NT$${n.toLocaleString()}`;
}

/** 應付總覽的身份：出貨員的帳記在同名推銷者底下，這裡顯示出貨員 */
function overviewRole(row: { recipientType: string; isShipper: boolean }) {
  return row.recipientType === "teacher" ? "教師" : row.isShipper ? "出貨員" : "推銷者";
}

function toCsvClient(headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\r\n");
}

/** 部分入帳提醒：誰的訂單還沒繳多少，收到錢時在這裡登記 */
function UnpaidRow({ order }: { order: { id: number; buyer: string; orderNo: string | null; unpaidAmount: number } }) {
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState("");
  const receive = trpc.mainLedger.receivePayment.useMutation({
    onSuccess: () => {
      setAmount("");
      utils.mainLedger.unpaidList.invalidate();
      utils.mainLedger.list.invalidate();
    },
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>
        {order.orderNo ? `${order.orderNo} ` : ""}
        {order.buyer} 還沒繳 <b>{fmt(order.unpaidAmount)}</b>
      </span>
      <span className="flex items-center gap-2">
        <input
          className="input !w-28"
          inputMode="numeric"
          placeholder="收到金額"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
        />
        <button
          type="button"
          className="btn-secondary"
          disabled={!amount || receive.isPending}
          onClick={() => receive.mutate({ id: order.id, amount: parseInt(amount, 10) })}
        >
          登記收款
        </button>
      </span>
      {receive.error && <span className="w-full text-xs text-red-600">{receive.error.message}</span>}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  // 教師/推銷者本人帳號沒有母記帳表／全公司應付總覽的權限（後端也已經擋下來），
  // 這個總覽頁是給財務人員看全公司數字用的，本人帳號應該直接看自己的子記帳表就好，
  // 所以這兩個查詢對本人角色一律不觸發，避免打到會被後端拒絕的 API。
  const isSelfRole = user?.role === "teacher_self" || user?.role === "salesperson_self" || user?.role === "shipper_self";
  const overviewQuery = trpc.reports.balanceOverview.useQuery(undefined, { enabled: !isSelfRole });
  const mainLedgerQuery = trpc.mainLedger.list.useQuery(undefined, { enabled: !isSelfRole });
  const personStatsQuery = trpc.reports.personStats.useQuery(undefined, { enabled: !isSelfRole });
  const coursesQuery = trpc.courses.list.useQuery(undefined, { enabled: !isSelfRole });
  const courseNames = new Set((coursesQuery.data ?? []).map((c) => c.name));
  const timelineQuery = trpc.reports.timeline.useQuery(undefined, { enabled: !isSelfRole });
  const booksQuery = trpc.books.list.useQuery(undefined, { enabled: !isSelfRole });
  const couponsQuery = trpc.coupons.list.useQuery(undefined, { enabled: !isSelfRole });
  const integrityQuery = trpc.reports.integrity.useQuery(undefined, { enabled: !isSelfRole });
  const reconcileQuery = trpc.webOrders.reconcile.useQuery(undefined, { enabled: !isSelfRole });
  const pendingRequestsQuery = trpc.accountRequests.pendingCount.useQuery(undefined, { enabled: user?.role === "super_admin" });
  const reserveStatusQuery = trpc.payroll.reserveStatus.useQuery(undefined, { enabled: !isSelfRole, retry: false });
  const unpaidQuery = trpc.mainLedger.unpaidList.useQuery(undefined, { enabled: !!user && !["teacher_self", "salesperson_self", "shipper_self"].includes(user.role) });
  const receivable = reconcileQuery.data?.receivable;
  const reconcileIssues = (reconcileQuery.data?.orders ?? []).filter((o) =>
    ["missing", "probable", "mismatch", "matched_gross"].includes(o.result)
  ).length;
  const bookPrices = new Map((booksQuery.data ?? []).map((b) => [b.name, b.price]));
  const [period, setPeriod] = useState<Period>("all");
  const entries = mainLedgerQuery.data ?? [];
  const timeline = timelineQuery.data ?? [];
  const stats = personStatsQuery.data ?? [];
  const loanTotal = stats.reduce((s, p) => s + p.loan, 0);

  const totalIncome = (mainLedgerQuery.data ?? []).filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
  const totalExpense = (mainLedgerQuery.data ?? []).filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);
  const currentBalance = mainLedgerQuery.data?.length ? mainLedgerQuery.data[mainLedgerQuery.data.length - 1].balance : 0;

  // 代墊審核通過就計入子記帳表（出貨員記在同名推銷者），已經包含在每人的欠款裡
  const totalUnsettledAdvance = (overviewQuery.data ?? []).reduce((s, r) => s + r.unsettledAdvanceTotal, 0);
  const totalOwed = (overviewQuery.data ?? []).reduce((s, r) => s + Math.max(r.totalBalance, 0), 0);
  // 公積金＝公司帳上的錢扣掉還欠每個人的錢（含代墊）；有人被多付（餘額為負）會反過來加回公積金
  const netOwed = (overviewQuery.data ?? []).reduce((s, r) => s + r.totalBalance, 0);
  // 稅金準備（登記後每筆收入先扣下來的營業稅 − 已繳的）是要繳給國稅局的錢，不算公積金
  const rs = reserveStatusQuery.data;
  const taxReserve = rs?.taxReserve ?? 0;
  const reserveFund = currentBalance - netOwed - taxReserve;
  // 補稅準備（凍結）是公積金的一部分，先標記不可用；最低水位看扣掉凍結後的可用公積金
  const frozen = rs?.reserveFrozen ?? 0;
  const usableReserve = reserveFund - frozen;
  const belowFloor = rs ? Math.max(0, rs.reserveFloor - usableReserve) : 0;
  const unpaidOrders = unpaidQuery.data ?? [];
  const unpaidTotal = unpaidOrders.reduce((s, o) => s + o.unpaidAmount, 0);
  // 薪水全部發掉後真正留在公司的錢＝公積金扣掉家長還沒付的；少於目標時，差額先少付給蔡睿軒
  const realReserve = reserveFund - unpaidTotal;
  const payShortfall = Math.max(RESERVE_TARGET - realReserve, 0);

  function handleExportOverviewCsv() {
    const csv = toCsvClient(
      ["身份", "姓名", "子記帳表餘額（公司欠款）", "其中未核銷代墊"],
      (overviewQuery.data ?? []).map((row) => [
        overviewRole(row),
        row.name,
        row.totalBalance,
        row.unsettledAdvanceTotal,
      ])
    );
    downloadTextFile(`應付總覽_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  // 教師/推銷者本人帳號：直接導向自己的子記帳表頁面，不顯示全公司的儀表板總覽
  if (user?.role === "teacher_self") {
    return user.linkedTeacherId ? (
      <Navigate to={`/teacher/${user.linkedTeacherId}/dashboard`} replace />
    ) : (
      <div className="p-8 text-center text-slate-400">尚未綁定教師資料，請聯絡管理員設定帳號。</div>
    );
  }
  if (user?.role === "shipper_self") return <Navigate to="/advance" replace />;
  if (user?.role === "salesperson_self") {
    return user.linkedSalespersonId ? (
      <Navigate to={`/salesperson/${user.linkedSalespersonId}/dashboard`} replace />
    ) : (
      <div className="p-8 text-center text-slate-400">尚未綁定推銷者資料，請聯絡管理員設定帳號。</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl text-brand-700">儀表板總覽</h1>
        <MonthlyReportButton entries={entries} timeline={timeline} stats={stats} courseNames={courseNames} />
      </div>

      {(pendingRequestsQuery.data ?? 0) > 0 && (
        <Link to="/admin?tab=requests" className="card block border-l-4 border-amber-500 hover:shadow-card-hover transition-shadow">
          <div className="text-sm text-amber-700">🔔 有 {pendingRequestsQuery.data} 個帳號申請等你處理 →</div>
        </Link>
      )}

      {unpaidOrders.length > 0 && (
        <div className="card border-l-4 border-amber-500 space-y-2">
          <div className="text-sm text-amber-700">🔔 有 {unpaidOrders.length} 張訂單還沒收齊</div>
          {unpaidOrders.map((o) => (
            <UnpaidRow key={o.id} order={o} />
          ))}
        </div>
      )}

      <div className="card border-l-4 border-gold-500">
        <div className="text-sm text-slate-500">公積金（公司自己的錢{unpaidTotal > 0 ? "，含未入帳" : ""}）</div>
        <div className={`text-3xl font-semibold mt-1 ${reserveFund < 0 ? "text-red-600" : "text-brand-700"}`}>{fmt(reserveFund)}</div>
        {unpaidTotal > 0 && <div className="text-xs text-slate-500 mt-1">（未入帳 {fmt(unpaidTotal)}，家長還沒付，公積金暫時吸收）</div>}
        <div className="text-sm text-slate-700 mt-2">
          如果現在把所有薪水發完，真實公積金是 {fmt(realReserve)}。要留 {fmt(RESERVE_TARGET)}，
          {payShortfall > 0 ? <b> 蔡睿軒要先少領 {fmt(payShortfall)}</b> : " 不用少領"}。
        </div>
        {rs && frozen > 0 && (
          <div className="text-sm text-slate-700 mt-2">
            其中 <b>補稅準備（凍結）{fmt(frozen)}</b>：登記前那段可能要補的營業稅，先不能用，問完記帳士再解除。可用公積金 {fmt(usableReserve)}。
          </div>
        )}
        {rs && belowFloor > 0 && (
          <div className="text-sm text-red-600 mt-2">
            ⚠ 低於公積金最低水位 {fmt(rs.reserveFloor)}，還差 {fmt(belowFloor)}；補滿之前不發年終。
          </div>
        )}
        <div className="text-xs text-slate-400 mt-2">
          ＝ 帳本目前餘額 {fmt(currentBalance)} − 還欠所有人的錢 {fmt(netOwed)}
          {taxReserve !== 0 && ` − 稅金準備 ${fmt(taxReserve)}`}
          {loanTotal > 0 && `（其中創始基金借款 ${fmt(loanTotal)}，要還給出資人）`}。
          也就是「如果今天把欠所有人的錢全部付清，帳上會剩 {fmt(reserveFund)}」。書籍收入、小班家教扣下的公積金、線上課程沒分出去的部分都會累積在這裡。
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="text-sm text-slate-500">帳本目前餘額</div>
          <div className="text-2xl font-semibold mt-1">{fmt(currentBalance)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">累計收入</div>
          <div className="text-2xl font-semibold mt-1 text-emerald-600">{fmt(totalIncome)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">累計支出</div>
          <div className="text-2xl font-semibold mt-1 text-red-600">{fmt(totalExpense)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">欠薪中的代墊</div>
          <div className="text-2xl font-semibold mt-1 text-amber-600">{fmt(totalUnsettledAdvance)}</div>
        </div>
      </div>

      {rs && (rs.registrationDate || taxReserve !== 0) && (
        <div className="card border-l-4 border-slate-400">
          <div className="text-sm text-slate-500">稅金準備（營業稅，跟公積金分開）</div>
          <div className="text-2xl font-semibold mt-1 text-slate-700">{fmt(taxReserve)}</div>
          <div className="text-xs text-slate-400 mt-1">
            {rs.registrationDate ? `${rs.registrationDate} 起每筆收入先扣 ${Math.round(rs.vatRate * 1000) / 10}%（含稅價 × 5/105）放這裡；` : "還沒設定稅籍登記日；"}
            繳稅時在手動記帳記一筆「營業稅」支出，從這裡扣、不扣公積金。
          </div>
        </div>
      )}

      <LevelCard entries={entries} />

      <KpiCompare entries={entries} timeline={timeline} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <AlertsCard coupons={couponsQuery.data ?? []} stats={stats} reconcileIssues={reconcileIssues} integrityIssues={integrityQuery.data ?? []} />
        </div>
        <Link to="/reconcile" className="card block hover:shadow-card-hover transition-shadow">
          <div className="text-sm text-slate-500">應收帳款（官網待付款）</div>
          <div className="text-2xl font-semibold mt-1 text-brand-700">{fmt(receivable?.total ?? 0)}</div>
          <div className="text-xs text-slate-400 mt-1">
            {receivable?.count ? `${receivable.count} 張訂單，最早 ${new Date(receivable.oldestAt!).toLocaleDateString()} 下單` : "目前沒有待付款訂單"}
          </div>
          <div className="text-xs text-brand-600 mt-2">查看官網對帳 →</div>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MonthlyRevenueChart entries={entries} courseNames={courseNames} />
        <ReserveTrendChart timeline={timeline} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">排行與支出的期間</span>
          <select className="input !w-32" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {Object.entries(PERIOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RevenueRankingChart entries={entries} bookPrices={bookPrices} courseNames={courseNames} period={period} />
          <ExpenseCategoryChart entries={entries} period={period} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PersonRevenueChart stats={stats} />
        <PersonOwedChart stats={stats} />
      </div>

      <PrepaidTutoringCard entries={entries} courses={coursesQuery.data ?? []} />

      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <h2 className="font-medium text-brand-700">應付總覽（公司目前欠每個人多少錢）</h2>
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-500">合計應付：{fmt(totalOwed)}</div>
            <button className="btn-secondary" onClick={handleExportOverviewCsv}>
              下載 CSV
            </button>
          </div>
        </div>
        <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>身份</th>
              <th>姓名</th>
              <th>子記帳表餘額（公司欠款）</th>
              <th>其中代墊</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(overviewQuery.data ?? []).map((row) => (
              <tr key={`${row.recipientType}-${row.recipientId}`}>
                <td>{overviewRole(row)}</td>
                <td>{row.name}</td>
                <td className={row.totalBalance > 0 ? "text-red-600 font-medium" : ""}>{fmt(row.totalBalance)}</td>
                <td className={row.unsettledAdvanceTotal > 0 ? "text-amber-600 font-medium" : ""}>
                  {fmt(row.unsettledAdvanceTotal)}
                </td>
                <td>
                  <Link className="text-brand-600 hover:underline" to={`/${row.recipientType}/${row.recipientId}`}>
                    查看明細
                  </Link>
                </td>
              </tr>
            ))}
            {overviewQuery.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-6">
                  尚無資料
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
