import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth, canManage } from "../lib/auth";
import { downloadTextFile } from "../lib/download";

function fmt(n: number) {
  return `NT$${n.toLocaleString()}`;
}

export default function AdvancePaymentsPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<"" | "unsettled" | "settled">("");
  const advancesQuery = trpc.advancePayments.list.useQuery({ status: statusFilter || undefined });
  const teachersQuery = trpc.teachers.list.useQuery(undefined, { enabled: canManage(user?.role) });
  const salespeopleQuery = trpc.salespeople.list.useQuery(undefined, { enabled: canManage(user?.role) });

  const invalidateAll = () => {
    utils.advancePayments.invalidate();
    utils.teacherLedger.invalidate();
    utils.salespersonLedger.invalidate();
    utils.reports.balanceOverview.invalidate();
  };

  const createMutation = trpc.advancePayments.create.useMutation({ onSuccess: invalidateAll });
  const settleMutation = trpc.advancePayments.settle.useMutation({ onSuccess: invalidateAll });
  const unsettleMutation = trpc.advancePayments.unsettle.useMutation({ onSuccess: invalidateAll });
  const deleteMutation = trpc.advancePayments.delete.useMutation({ onSuccess: invalidateAll });

  const [recipientType, setRecipientType] = useState<"teacher" | "salesperson">("teacher");
  const [recipientId, setRecipientId] = useState<number | "">("");
  const [itemName, setItemName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const recipientOptions = recipientType === "teacher" ? teachersQuery.data ?? [] : salespeopleQuery.data ?? [];

  async function handleExportCsv() {
    setExporting(true);
    try {
      const result = await utils.reports.exportAdvancePaymentsCsv.fetch({ status: statusFilter || undefined });
      downloadTextFile(result.filename, result.csv);
    } finally {
      setExporting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!recipientId) {
      setError("請選擇教師或推銷者");
      return;
    }
    try {
      await createMutation.mutateAsync({ recipientType, recipientId: Number(recipientId), itemName, amount, note: note || undefined });
      setItemName("");
      setAmount("");
      setNote("");
      setRecipientId("");
    } catch (err: any) {
      setError(err?.message ?? "建立失敗");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">代墊款管理</h1>
      <p className="text-sm text-slate-500">
        教師/推銷者自行墊付了原屬於公司的費用時，在此建立代墊記錄——會立即計入該對象的子記帳表餘額，但不會寫入母記帳表。公司歸還時，可在此「核銷」，或於母記帳表新增正式撥款時直接勾選一併核銷。
      </p>

      {canManage(user?.role) && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h2 className="font-medium text-slate-700">新增代墊記錄</h2>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <label className="label">身份</label>
              <select
                className="input"
                value={recipientType}
                onChange={(e) => {
                  setRecipientType(e.target.value as "teacher" | "salesperson");
                  setRecipientId("");
                }}
              >
                <option value="teacher">教師</option>
                <option value="salesperson">推銷者</option>
              </select>
            </div>
            <div>
              <label className="label">姓名</label>
              <select className="input" value={recipientId} onChange={(e) => setRecipientId(Number(e.target.value))} required>
                <option value="">請選擇</option>
                {recipientOptions.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">代墊項目</label>
              <input className="input" value={itemName} onChange={(e) => setItemName(e.target.value)} required />
            </div>
            <div>
              <label className="label">金額</label>
              <input
                className="input"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                required
              />
            </div>
            <div>
              <label className="label">備註（選填）</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <button className="btn-primary" type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "建立中..." : "建立代墊記錄"}
          </button>
        </form>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-slate-700">代墊記錄列表</h2>
          <div className="flex items-center gap-2">
            <select className="input !w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="">全部狀態</option>
              <option value="unsettled">未核銷</option>
              <option value="settled">已核銷</option>
            </select>
            <button className="btn-secondary" onClick={handleExportCsv} disabled={exporting}>
              {exporting ? "匯出中..." : "下載 CSV"}
            </button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>建立日期</th>
              <th>身份</th>
              <th>對象</th>
              <th>項目</th>
              <th>金額</th>
              <th>狀態</th>
              <th>核銷來源</th>
              {canManage(user?.role) && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {(advancesQuery.data ?? []).map((a) => {
              const list = a.recipientType === "teacher" ? teachersQuery.data : salespeopleQuery.data;
              const name = list?.find((p) => p.id === a.recipientId)?.name ?? `#${a.recipientId}`;
              return (
                <tr key={a.id}>
                  <td>{new Date(a.createdAt).toLocaleDateString()}</td>
                  <td>{a.recipientType === "teacher" ? "教師" : "推銷者"}</td>
                  <td>{name}</td>
                  <td>{a.itemName}</td>
                  <td>{fmt(a.amount)}</td>
                  <td>
                    <span className={a.status === "unsettled" ? "text-amber-600 font-medium" : "text-emerald-600"}>
                      {a.status === "unsettled" ? "未核銷" : "已核銷"}
                    </span>
                  </td>
                  <td>{a.settledByMainLedgerId ? `母記帳表 #${a.settledByMainLedgerId}` : a.status === "settled" ? "獨立沖銷" : "-"}</td>
                  {canManage(user?.role) && (
                    <td className="space-x-2">
                      {a.status === "unsettled" ? (
                        <>
                          <button
                            className="btn-secondary"
                            onClick={() => settleMutation.mutate({ id: a.id, mainLedgerId: null })}
                            disabled={settleMutation.isPending}
                          >
                            核銷（獨立歸還）
                          </button>
                          <button className="btn-danger" onClick={() => deleteMutation.mutate({ id: a.id })}>
                            刪除
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn-secondary"
                          onClick={() => unsettleMutation.mutate({ id: a.id })}
                          disabled={unsettleMutation.isPending}
                        >
                          取消核銷
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {advancesQuery.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-6">
                  尚無代墊記錄
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
