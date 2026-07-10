import { trpc } from "../lib/trpc";
import { Link } from "react-router-dom";
import { downloadTextFile } from "../lib/download";

function fmt(n: number) {
  return `NT$${n.toLocaleString()}`;
}

function toCsvClient(headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\r\n");
}

export default function Dashboard() {
  const overviewQuery = trpc.reports.balanceOverview.useQuery();
  const mainLedgerQuery = trpc.mainLedger.list.useQuery();

  const totalIncome = (mainLedgerQuery.data ?? []).filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
  const totalExpense = (mainLedgerQuery.data ?? []).filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);
  const currentBalance = mainLedgerQuery.data?.length ? mainLedgerQuery.data[mainLedgerQuery.data.length - 1].balance : 0;

  const totalUnsettledAdvance = (overviewQuery.data ?? []).reduce((s, r) => s + r.unsettledAdvanceTotal, 0);
  const totalOwed = (overviewQuery.data ?? []).reduce((s, r) => s + Math.max(r.totalBalance, 0), 0);

  function handleExportOverviewCsv() {
    const csv = toCsvClient(
      ["身份", "姓名", "子記帳表餘額（公司欠款）", "其中未核銷代墊"],
      (overviewQuery.data ?? []).map((row) => [
        row.recipientType === "teacher" ? "教師" : "推銷者",
        row.name,
        row.totalBalance,
        row.unsettledAdvanceTotal,
      ])
    );
    downloadTextFile(`應付總覽_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">儀表板總覽</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="text-sm text-slate-500">母記帳表目前餘額</div>
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
          <div className="text-sm text-slate-500">未核銷代墊總額</div>
          <div className="text-2xl font-semibold mt-1 text-amber-600">{fmt(totalUnsettledAdvance)}</div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-slate-700">應付總覽（公司目前欠每個人多少錢）</h2>
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-500">合計應付：{fmt(totalOwed)}</div>
            <button className="btn-secondary" onClick={handleExportOverviewCsv}>
              下載 CSV
            </button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>身份</th>
              <th>姓名</th>
              <th>子記帳表餘額（公司欠款）</th>
              <th>其中未核銷代墊</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(overviewQuery.data ?? []).map((row) => (
              <tr key={`${row.recipientType}-${row.recipientId}`}>
                <td>{row.recipientType === "teacher" ? "教師" : "推銷者"}</td>
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
  );
}
