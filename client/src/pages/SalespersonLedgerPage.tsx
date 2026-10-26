import { useParams, Link } from "react-router-dom";
import { useState } from "react";
import { trpc } from "../lib/trpc";
import { downloadTextFile } from "../lib/download";
import { useAuth, canManage } from "../lib/auth";

function fmt(n: number) {
  return `NT$${n.toLocaleString()}`;
}

const SOURCE_LABELS: Record<string, string> = {
  distribution: "一般分配",
  advance: "代墊入帳",
  advance_settlement: "代墊核銷",
};

export default function SalespersonLedgerPage() {
  const { user } = useAuth();
  const params = useParams();
  const salespersonId = Number(params.id);
  const salespeopleQuery = trpc.salespeople.list.useQuery();
  const entriesQuery = trpc.salespersonLedger.list.useQuery({ salespersonId }, { enabled: !!salespersonId });
  const utils = trpc.useUtils();
  const [exporting, setExporting] = useState(false);

  const deleteMutation = trpc.salespersonLedger.delete.useMutation({
    onSuccess: () => {
      utils.salespersonLedger.invalidate();
      utils.reports.balanceOverview.invalidate();
    },
  });

  const salesperson = salespeopleQuery.data?.find((s) => s.id === salespersonId);
  const currentBalance = entriesQuery.data?.length ? entriesQuery.data[entriesQuery.data.length - 1].personalBalance : 0;

  async function handleExportCsv() {
    setExporting(true);
    try {
      const result = await utils.reports.exportRecipientStatementCsv.fetch({ recipientType: "salesperson", recipientId: salespersonId });
      downloadTextFile(result.filename, result.csv);
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("確定要刪除這筆分配記錄嗎？會重新計算餘額。")) return;
    await deleteMutation.mutateAsync({ id });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-800">推銷者子記帳表：{salesperson?.name ?? "..."}</h1>
        <div className="flex items-center gap-3">
          <div className="card !p-3 !py-2 text-sm">
            目前餘額：<span className="font-semibold">{fmt(currentBalance)}</span>
          </div>
          <button className="btn-secondary" onClick={handleExportCsv} disabled={exporting}>
            {exporting ? "匯出中..." : "下載 CSV 對帳單"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>項目</th>
              <th>名稱</th>
              <th>來源</th>
              <th>類型</th>
              <th>原金額</th>
              <th>分潤比例</th>
              <th>分配金額</th>
              <th>私人餘額</th>
              {canManage(user?.role) && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {(entriesQuery.data ?? []).map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.createdAt).toLocaleDateString()}</td>
                <td>{entry.itemName}</td>
                <td>{entry.categoryName ?? "-"}</td>
                <td>
                  <span
                    className={
                      entry.sourceType === "advance"
                        ? "text-amber-600"
                        : entry.sourceType === "advance_settlement"
                        ? "text-slate-500"
                        : "text-slate-700"
                    }
                  >
                    {SOURCE_LABELS[entry.sourceType] ?? entry.sourceType}
                  </span>
                </td>
                <td>{entry.type === "income" ? "收入" : entry.type === "expense" ? "支出" : "代墊"}</td>
                <td>{entry.originalAmount != null ? fmt(entry.originalAmount) : "-"}</td>
                <td>
                  {entry.originalAmount ? `${Math.round((entry.personalAmount / entry.originalAmount) * 100)}%` : "-"}
                </td>
                <td>{fmt(entry.personalAmount)}</td>
                <td>{fmt(entry.personalBalance)}</td>
                {canManage(user?.role) && (
                  <td>
                    {entry.sourceType === "distribution" ? (
                      <button className="btn-danger" onClick={() => handleDelete(entry.id)} disabled={deleteMutation.isPending}>
                        刪除
                      </button>
                    ) : (
                      <Link to="/advance" className="text-brand-600 hover:underline text-xs">
                        至代墊管理操作
                      </Link>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {entriesQuery.data?.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-slate-400 py-6">
                  尚無記錄
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
