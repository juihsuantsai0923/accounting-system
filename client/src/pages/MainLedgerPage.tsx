import { useMemo, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth, canManage } from "../lib/auth";
import { downloadTextFile } from "../lib/download";

function fmt(n: number) {
  return `NT$${n.toLocaleString()}`;
}

interface DistRow {
  key: string;
  type: "teacher" | "salesperson";
  recipientId: number;
  amount: string;
  settledAdvanceIds: number[];
}

export default function MainLedgerPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const entriesQuery = trpc.mainLedger.list.useQuery();
  const teachersQuery = trpc.teachers.list.useQuery();
  const salespeopleQuery = trpc.salespeople.list.useQuery();
  const coursesQuery = trpc.courses.list.useQuery();
  const expenseTypesQuery = trpc.expenseTypes.list.useQuery();
  const advancesQuery = trpc.advancePayments.list.useQuery({ status: "unsettled" });

  const createMutation = trpc.mainLedger.create.useMutation({
    onSuccess: () => {
      utils.mainLedger.list.invalidate();
      utils.teacherLedger.invalidate();
      utils.salespersonLedger.invalidate();
      utils.advancePayments.invalidate();
      utils.reports.balanceOverview.invalidate();
    },
  });
  const deleteMutation = trpc.mainLedger.delete.useMutation({
    onSuccess: () => {
      utils.mainLedger.list.invalidate();
      utils.teacherLedger.invalidate();
      utils.salespersonLedger.invalidate();
      utils.advancePayments.invalidate();
      utils.reports.balanceOverview.invalidate();
    },
  });

  const [type, setType] = useState<"income" | "expense">("income");
  const [itemName, setItemName] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [showDistribution, setShowDistribution] = useState(false);
  const [distributions, setDistributions] = useState<DistRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const result = await utils.reports.exportMainLedgerCsv.fetch();
      downloadTextFile(result.filename, result.csv);
    } finally {
      setExporting(false);
    }
  }

  const categoryOptions = type === "income" ? coursesQuery.data ?? [] : expenseTypesQuery.data ?? [];

  const totalDistributed = distributions.reduce((s, d) => s + (parseInt(d.amount || "0", 10) || 0), 0);
  const amountNum = parseInt(amount || "0", 10) || 0;

  function addDistribution(kind: "teacher" | "salesperson") {
    const list = kind === "teacher" ? teachersQuery.data : salespeopleQuery.data;
    if (!list?.length) return;
    setDistributions((prev) => [
      ...prev,
      { key: `${kind}-${Date.now()}-${Math.random()}`, type: kind, recipientId: list[0].id, amount: "", settledAdvanceIds: [] },
    ]);
  }

  function updateDistribution(key: string, patch: Partial<DistRow>) {
    setDistributions((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function removeDistribution(key: string) {
    setDistributions((prev) => prev.filter((d) => d.key !== key));
  }

  function unsettledAdvancesFor(kind: "teacher" | "salesperson", recipientId: number) {
    return (advancesQuery.data ?? []).filter((a) => a.recipientType === kind && a.recipientId === recipientId);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!categoryId) {
      setError(type === "income" ? "請選擇課程" : "請選擇支出類型");
      return;
    }
    if (totalDistributed > amountNum) {
      setError("分配總額不能超過原始金額");
      return;
    }
    try {
      await createMutation.mutateAsync({
        type,
        itemName,
        categoryId: Number(categoryId),
        amount,
        note: note || undefined,
        distributions: distributions
          .filter((d) => parseInt(d.amount || "0", 10) > 0)
          .map((d) => ({
            type: d.type,
            recipientId: d.recipientId,
            amount: d.amount,
            settledAdvanceIds: d.settledAdvanceIds.length ? d.settledAdvanceIds : undefined,
          })),
      });
      setItemName("");
      setCategoryId("");
      setAmount("");
      setNote("");
      setDistributions([]);
      setShowDistribution(false);
    } catch (err: any) {
      setError(err?.message ?? "新增失敗");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("確定要刪除這筆記錄嗎？相關分配與子記帳表記錄將一併移除，並重新計算餘額。")) return;
    await deleteMutation.mutateAsync({ id });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">母記帳表</h1>
        <button className="btn-secondary" onClick={handleExportCsv} disabled={exporting}>
          {exporting ? "匯出中..." : "下載 CSV 對帳表"}
        </button>
      </div>

      {canManage(user?.role) && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h2 className="font-medium text-slate-700">新增記錄</h2>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="label">類型</label>
              <select
                className="input"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as "income" | "expense");
                  setCategoryId("");
                }}
              >
                <option value="income">收入</option>
                <option value="expense">支出</option>
              </select>
            </div>
            <div>
              <label className="label">項目名稱</label>
              <input className="input" value={itemName} onChange={(e) => setItemName(e.target.value)} required />
            </div>
            <div>
              <label className="label">{type === "income" ? "課程" : "支出類型"}</label>
              <select className="input" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))} required>
                <option value="">請選擇</option>
                {categoryOptions.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">金額</label>
              <input
                className="input"
                inputMode="numeric"
                pattern="\d*"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                required
              />
            </div>
          </div>
          <div>
            <label className="label">備註（選填）</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <button type="button" className="btn-secondary" onClick={() => setShowDistribution((v) => !v)}>
            {showDistribution ? "隱藏多方分配" : "顯示多方分配"}
          </button>

          {showDistribution && (
            <div className="border border-slate-200 rounded-lg p-4 space-y-3">
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => addDistribution("teacher")}>
                  + 新增教師分配
                </button>
                <button type="button" className="btn-secondary" onClick={() => addDistribution("salesperson")}>
                  + 新增推銷者分配
                </button>
              </div>
              {distributions.map((d) => {
                const list = d.type === "teacher" ? teachersQuery.data : salespeopleQuery.data;
                const advances = unsettledAdvancesFor(d.type, d.recipientId);
                return (
                  <div key={d.key} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start bg-slate-50 rounded-lg p-3">
                    <div className="md:col-span-2 text-xs text-slate-500 pt-2">{d.type === "teacher" ? "教師" : "推銷者"}</div>
                    <select
                      className="input md:col-span-3"
                      value={d.recipientId}
                      onChange={(e) => updateDistribution(d.key, { recipientId: Number(e.target.value), settledAdvanceIds: [] })}
                    >
                      {(list ?? []).map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input md:col-span-2"
                      placeholder="分配金額"
                      inputMode="numeric"
                      value={d.amount}
                      onChange={(e) => updateDistribution(d.key, { amount: e.target.value.replace(/[^\d]/g, "") })}
                    />
                    <div className="md:col-span-4">
                      {type === "expense" && advances.length > 0 && (
                        <div className="text-xs text-slate-500">
                          <div className="mb-1">併入核銷代墊（未核銷）：</div>
                          {advances.map((a) => (
                            <label key={a.id} className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={d.settledAdvanceIds.includes(a.id)}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...d.settledAdvanceIds, a.id]
                                    : d.settledAdvanceIds.filter((id) => id !== a.id);
                                  updateDistribution(d.key, { settledAdvanceIds: next });
                                }}
                              />
                              {a.itemName}（{fmt(a.amount)}）
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="button" className="btn-danger md:col-span-1" onClick={() => removeDistribution(d.key)}>
                      移除
                    </button>
                  </div>
                );
              })}
              <div className="text-sm text-slate-600 flex gap-4">
                <span>已分配：{fmt(totalDistributed)}</span>
                <span>剩餘：{fmt(Math.max(amountNum - totalDistributed, 0))}</span>
                {totalDistributed > amountNum && <span className="text-red-600 font-medium">超額：{fmt(totalDistributed - amountNum)}</span>}
              </div>
            </div>
          )}

          <button className="btn-primary" type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "新增中..." : "新增記錄"}
          </button>
        </form>
      )}

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>項目</th>
              <th>名稱</th>
              <th>類型</th>
              <th>金額</th>
              <th>餘額</th>
              <th>編輯者</th>
              {canManage(user?.role) && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {(entriesQuery.data ?? []).map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.createdAt).toLocaleDateString()}</td>
                <td>{entry.itemName}</td>
                <td>{entry.categoryName}</td>
                <td className={entry.type === "income" ? "text-emerald-600" : "text-red-600"}>
                  {entry.type === "income" ? "收入" : "支出"}
                </td>
                <td>{fmt(entry.amount)}</td>
                <td>{fmt(entry.balance)}</td>
                <td>{entry.editorName ?? "-"}</td>
                {canManage(user?.role) && (
                  <td>
                    <button className="btn-danger" onClick={() => handleDelete(entry.id)}>
                      刪除
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {entriesQuery.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-6">
                  尚無記錄
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
