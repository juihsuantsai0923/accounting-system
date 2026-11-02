import { useState } from "react";
import { trpc } from "../lib/trpc";
import { fmt } from "./DashboardCharts";

type Form = { id?: number; type: "income" | "expense"; itemName: string; categoryId: string; amount: string; dayOfMonth: string; note: string; isActive: boolean };
const EMPTY: Form = { type: "expense", itemName: "", categoryId: "", amount: "", dayOfMonth: "1", note: "", isActive: true };

/** 管理面板「定期收支」：自己設定每月固定的收入或支出，到了那天自動記到帳本 */
export default function RecurringAdmin() {
  const utils = trpc.useUtils();
  const listQuery = trpc.recurring.list.useQuery();
  const expenseTypes = trpc.expenseTypes.list.useQuery();
  const incomeTypes = trpc.incomeTypes.list.useQuery();
  const refresh = () => {
    utils.recurring.list.invalidate();
    utils.mainLedger.list.invalidate();
  };
  const saveMutation = trpc.recurring.save.useMutation({ onSuccess: refresh });
  const removeMutation = trpc.recurring.remove.useMutation({ onSuccess: refresh });
  const runMutation = trpc.recurring.runNow.useMutation({ onSuccess: refresh });
  const [form, setForm] = useState<Form>(EMPTY);
  const [msg, setMsg] = useState<string | null>(null);

  const categories =
    form.type === "income"
      ? (incomeTypes.data ?? []).map((t: any) => ({ id: t.id, name: t.name }))
      : (expenseTypes.data ?? []).filter((t: any) => !t.teacherId && !t.salespersonId).map((t: any) => ({ id: t.id, name: t.name }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await saveMutation.mutateAsync({
        id: form.id,
        type: form.type,
        itemName: form.itemName,
        categoryId: Number(form.categoryId),
        amount: Number(form.amount),
        dayOfMonth: Number(form.dayOfMonth),
        note: form.note || undefined,
        isActive: form.isActive,
      });
      setMsg(form.id ? "已更新" : "已新增，到了每月那天會自動記到帳本");
      setForm(EMPTY);
    } catch (err: any) {
      setMsg(err?.message ?? "儲存失敗");
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-medium text-brand-700">定期收支</h2>
        <p className="text-sm text-slate-500 mt-1">
          每月固定的收入或支出（例如網站訂閱費）設在這裡，每天早上 9 點檢查，到了設定的日子就自動記一筆到帳本（不分給任何人）。同一條同一個月只會記一次；金額變了改這裡就好。
        </p>
      </div>

      <form className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end" onSubmit={submit}>
        <div>
          <label className="label">收入／支出</label>
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Form["type"], categoryId: "" })}>
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
        </div>
        <div className="lg:col-span-2">
          <label className="label">項目名稱</label>
          <input className="input" value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} placeholder="例如 網站訂閱費" />
        </div>
        <div>
          <label className="label">類別</label>
          <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">請選擇</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">每月金額</label>
          <input className="input" inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/\D/g, "") })} />
        </div>
        <div>
          <label className="label">每月幾號</label>
          <select className="input" value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d} 號
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="label">備註（選填）</label>
          <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          啟用
        </label>
        <div className="flex gap-2">
          <button className="btn-primary" type="submit" disabled={saveMutation.isPending || !form.itemName || !form.categoryId || !form.amount}>
            {form.id ? "更新" : "新增"}
          </button>
          {form.id && (
            <button type="button" className="btn-secondary" onClick={() => setForm(EMPTY)}>
              取消
            </button>
          )}
        </div>
      </form>
      {msg && <div className="text-sm text-slate-600">{msg}</div>}

      <div className="table-wrap">
        <table className="data-table text-sm">
          <thead>
            <tr>
              <th>狀態</th>
              <th>收支</th>
              <th>項目</th>
              <th>類別</th>
              <th className="text-right">每月金額</th>
              <th>每月</th>
              <th>最後記帳</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(listQuery.data ?? []).map((r: any) => (
              <tr key={r.id} className={r.isActive ? "" : "text-slate-400"}>
                <td>{r.isActive ? "啟用" : "停用"}</td>
                <td className={r.type === "income" ? "text-emerald-600" : "text-red-600"}>{r.type === "income" ? "收入" : "支出"}</td>
                <td>{r.itemName}</td>
                <td>{r.categoryName}</td>
                <td className="text-right tabular-nums">{fmt(r.amount)}</td>
                <td>{r.dayOfMonth} 號</td>
                <td>{r.lastRunMonth ?? "還沒記過"}</td>
                <td className="whitespace-nowrap">
                  <button
                    type="button"
                    className="text-brand-600 hover:underline mr-3"
                    onClick={() =>
                      setForm({
                        id: r.id,
                        type: r.type,
                        itemName: r.itemName,
                        categoryId: String(r.categoryId),
                        amount: String(r.amount),
                        dayOfMonth: String(r.dayOfMonth),
                        note: r.note ?? "",
                        isActive: r.isActive,
                      })
                    }
                  >
                    編輯
                  </button>
                  <button
                    type="button"
                    className="text-red-600 hover:underline"
                    onClick={() => confirm(`刪除定期項目「${r.itemName}」？（已經記到帳本的不會刪）`) && removeMutation.mutate({ id: r.id })}
                  >
                    刪除
                  </button>
                </td>
              </tr>
            ))}
            {listQuery.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-6">
                  還沒有定期收支
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn-secondary"
        disabled={runMutation.isPending}
        onClick={async () => {
          const r = await runMutation.mutateAsync();
          setMsg(r.length ? `剛剛記了 ${r.length} 筆：${r.map((x) => `${x.itemName} ${fmt(x.amount)}`).join("、")}` : "目前沒有到期還沒記的項目");
        }}
      >
        立刻檢查一次
      </button>
    </div>
  );
}
