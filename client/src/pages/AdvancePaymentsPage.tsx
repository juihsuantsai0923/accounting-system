import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth, canManage } from "../lib/auth";
import { downloadTextFile } from "../lib/download";
import SearchableSelect from "../components/SearchableSelect";

function fmt(n: number) {
  return `NT$${n.toLocaleString()}`;
}

type RecipientType = "teacher" | "salesperson" | "shipper";
const TYPE_LABELS: Record<string, string> = { teacher: "教師", salesperson: "推銷者", shipper: "出貨員" };
const NEW_CATEGORY = "__new__";

const emptyForm = { orderName: "", orderNo: "", buyer: "", category: "運費", newCategory: "", amount: "", note: "" };

/** 官網訂單在下拉清單裡顯示的名稱：編號＋品項 */
function orderLabel(o: { orderNo: string; items: string[] }) {
  return `#${o.orderNo} ${o.items.join("、")}`.trim();
}

export default function AdvancePaymentsPage() {
  const { user } = useAuth();
  const isAdmin = canManage(user?.role);
  const isShipper = user?.role === "shipper_self";
  const canWrite = isAdmin || isShipper;
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<"" | "unsettled" | "settled">("");
  const advancesQuery = trpc.advancePayments.list.useQuery({ status: statusFilter || undefined });
  const unsettledQuery = trpc.advancePayments.list.useQuery({ status: "unsettled" });
  const teachersQuery = trpc.teachers.list.useQuery(undefined, { enabled: isAdmin });
  const salespeopleQuery = trpc.salespeople.list.useQuery(undefined, { enabled: isAdmin });
  const shippersQuery = trpc.shippers.list.useQuery(undefined, { enabled: isAdmin });
  const categoriesQuery = trpc.advancePayments.categories.useQuery(undefined, { enabled: canWrite });
  const ordersQuery = trpc.advancePayments.orderOptions.useQuery(undefined, { enabled: canWrite });

  const invalidateAll = () => {
    utils.advancePayments.invalidate();
    utils.teacherLedger.invalidate();
    utils.salespersonLedger.invalidate();
    if (isAdmin) {
      utils.reports.balanceOverview.invalidate();
      utils.mainLedger.invalidate();
      utils.expenseTypes.invalidate();
    }
  };

  const createMutation = trpc.advancePayments.create.useMutation({ onSuccess: invalidateAll });
  const updateMutation = trpc.advancePayments.update.useMutation({ onSuccess: invalidateAll });
  const settleMutation = trpc.advancePayments.settle.useMutation({ onSuccess: invalidateAll });
  const settleShipperMutation = trpc.advancePayments.settleShipper.useMutation({ onSuccess: invalidateAll });
  const unsettleMutation = trpc.advancePayments.unsettle.useMutation({ onSuccess: invalidateAll });
  const deleteMutation = trpc.advancePayments.delete.useMutation({ onSuccess: invalidateAll });

  const [recipientType, setRecipientType] = useState<RecipientType>("shipper");
  const [recipientId, setRecipientId] = useState<number | "">("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const lists: Record<string, { id: number; name: string; isActive?: boolean }[]> = {
    teacher: teachersQuery.data ?? [],
    salesperson: salespeopleQuery.data ?? [],
    shipper: shippersQuery.data ?? [],
  };
  const nameOf = (type: string, id: number) => lists[type]?.find((p) => p.id === id)?.name ?? `#${id}`;
  const recipientOptions = lists[recipientType].filter((p) => p.isActive !== false);
  const categories = categoriesQuery.data ?? [];
  const orders = ordersQuery.data ?? [];

  // 出貨員未核銷代墊，依人加總（管理員看全部；出貨員只會拿到自己的）
  const shipperUnsettled = new Map<number, { total: number; count: number }>();
  for (const a of unsettledQuery.data ?? []) {
    if (a.recipientType !== "shipper") continue;
    const s = shipperUnsettled.get(a.recipientId) ?? { total: 0, count: 0 };
    shipperUnsettled.set(a.recipientId, { total: s.total + a.amount, count: s.count + 1 });
  }

  async function run(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
    } catch (err: any) {
      setActionError(err?.message ?? "操作失敗");
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const result = await utils.reports.exportAdvancePaymentsCsv.fetch({ status: statusFilter || undefined });
      downloadTextFile(result.filename, result.csv);
    } finally {
      setExporting(false);
    }
  }

  /** 訂單名稱打的字剛好是某張官網訂單 → 帶入訂單編號和下訂人 */
  function handleOrderInput(value: string) {
    const match = orders.find((o) => orderLabel(o) === value);
    if (match) setForm((f) => ({ ...f, orderName: value, orderNo: match.orderNo, buyer: match.buyer }));
    else setForm((f) => ({ ...f, orderName: value, orderNo: "" }));
  }

  function startEdit(a: any) {
    setEditingId(a.id);
    setError(null);
    const known = categories.some((c) => c.name === a.category);
    setForm({
      orderName: a.orderName ?? (a.category ? "" : a.itemName),
      orderNo: a.orderNo ?? "",
      buyer: a.buyer ?? "",
      category: a.category ? (known ? a.category : NEW_CATEGORY) : "其他",
      newCategory: a.category && !known ? a.category : "",
      amount: String(a.amount),
      note: a.note ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const category = form.category === NEW_CATEGORY ? form.newCategory.trim() : form.category;
    if (!category) return setError("請選類別，或打新的類別名稱");
    if (!form.orderName.trim() && !form.buyer.trim()) return setError("請填訂單名稱或下訂人");
    const fields = {
      orderName: form.orderName || undefined,
      orderNo: form.orderNo || undefined,
      buyer: form.buyer || undefined,
      category,
      amount: form.amount,
      note: form.note || undefined,
    };
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, ...fields });
      } else if (isShipper) {
        await createMutation.mutateAsync(fields);
      } else {
        if (!recipientId) return setError(`請選擇${TYPE_LABELS[recipientType]}`);
        await createMutation.mutateAsync({ recipientType, recipientId: Number(recipientId), ...fields });
      }
      resetForm();
      utils.advancePayments.categories.invalidate();
    } catch (err: any) {
      setError(err?.message ?? "儲存失敗");
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending;
  const myUnsettled = isShipper ? [...shipperUnsettled.values()][0] : undefined;
  const colCount = 8 + (isAdmin ? 1 : 0) + (canWrite ? 1 : 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl text-brand-700">{isShipper ? "我的代墊" : "代墊款管理"}</h1>
      {isShipper ? (
        <p className="text-sm text-slate-500">
          幫公司先付的錢（例如寄書的運費）在這裡登記。公司還錢後會標成「已核銷」；還沒核銷的可以自己修改或刪除。
        </p>
      ) : (
        <p className="text-sm text-slate-500">
          有人先幫公司墊付費用時，在這裡建立代墊記錄。教師、推銷者的代墊會計入他的子記帳表餘額，公司歸還時在這裡「核銷」，或在帳本新增撥款時勾選一併核銷。出貨員的代墊按「核銷並記入帳本」，會照類別在帳本記一筆支出（例如運費）。
        </p>
      )}

      {isShipper && (
        <div className="card border-l-4 border-gold-500">
          <div className="text-sm text-slate-500">公司還沒還你的代墊</div>
          <div className="text-3xl font-semibold mt-1 text-brand-700">{fmt(myUnsettled?.total ?? 0)}</div>
          <div className="text-xs text-slate-400 mt-1">{myUnsettled?.count ?? 0} 筆未核銷</div>
        </div>
      )}

      {isAdmin && shipperUnsettled.size > 0 && (
        <div className="card space-y-3">
          <h2 className="font-medium text-brand-700">出貨員未核銷代墊</h2>
          <ul className="divide-y divide-slate-100">
            {[...shipperUnsettled.entries()].map(([id, s]) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {nameOf("shipper", id)}：<b className="text-amber-600">{fmt(s.total)}</b>（{s.count} 筆）
                </span>
                <button
                  className="btn-secondary"
                  disabled={settleShipperMutation.isPending}
                  onClick={() =>
                    confirm(`把 ${nameOf("shipper", id)} 的 ${s.count} 筆代墊（${fmt(s.total)}）全部核銷，並依類別在帳本記支出？`) &&
                    run(() => settleShipperMutation.mutateAsync({ shipperId: id }))
                  }
                >
                  全部核銷並記入帳本
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canWrite && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h2 className="font-medium text-brand-700">{editingId ? `修改代墊 #${editingId}` : "新增代墊"}</h2>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {isAdmin && !editingId && (
              <>
                <div>
                  <label className="label">身份</label>
                  <select
                    className="input"
                    value={recipientType}
                    onChange={(e) => {
                      setRecipientType(e.target.value as RecipientType);
                      setRecipientId("");
                    }}
                  >
                    <option value="shipper">出貨員</option>
                    <option value="teacher">教師</option>
                    <option value="salesperson">推銷者</option>
                  </select>
                </div>
                <div>
                  <label className="label">姓名</label>
                  <SearchableSelect
                    options={recipientOptions.map((p) => ({ id: p.id, name: p.name }))}
                    value={recipientId}
                    onChange={(id) => setRecipientId(id)}
                    placeholder="搜尋姓名..."
                  />
                </div>
              </>
            )}
            <div className="md:col-span-2">
              <label className="label">訂單名稱（可選官網訂單或自己打）</label>
              <input
                className="input"
                list="advance-order-options"
                value={form.orderName}
                onChange={(e) => handleOrderInput(e.target.value)}
                placeholder="例：#20261101-0012 物理 上冊全套"
              />
              <datalist id="advance-order-options">
                {orders.map((o) => (
                  <option key={o.orderNo} value={orderLabel(o)}>
                    {new Date(o.orderedAt).toLocaleDateString()} {o.buyer}
                  </option>
                ))}
              </datalist>
            </div>
            <div>
              <label className="label">下訂人</label>
              <input className="input" value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} placeholder="姓名" />
            </div>
            <div>
              <label className="label">類別</label>
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value={NEW_CATEGORY}>＋新增類別…</option>
              </select>
              {form.category === NEW_CATEGORY && (
                <input
                  className="input mt-2"
                  value={form.newCategory}
                  onChange={(e) => setForm({ ...form, newCategory: e.target.value })}
                  placeholder="新類別名稱"
                  autoFocus
                />
              )}
            </div>
            <div>
              <label className="label">金額</label>
              <input
                className="input"
                inputMode="numeric"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, "") })}
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">備註（選填）</label>
              <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? "儲存中..." : editingId ? "儲存修改" : "新增代墊"}
            </button>
            {editingId && (
              <button className="btn-secondary" type="button" onClick={resetForm}>
                取消修改
              </button>
            )}
          </div>
        </form>
      )}

      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <h2 className="font-medium text-brand-700">代墊記錄</h2>
          <div className="flex flex-wrap items-center gap-2">
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
        {actionError && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{actionError}</div>}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                {isAdmin && <th>代墊的人</th>}
                <th>訂單名稱</th>
                <th>下訂人</th>
                <th>類別</th>
                <th>金額</th>
                <th>備註</th>
                <th>狀態</th>
                <th>核銷來源</th>
                {canWrite && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {(advancesQuery.data ?? []).map((a) => {
                const mine = isShipper && a.recipientType === "shipper" && a.recipientId === user?.linkedShipperId;
                return (
                  <tr key={a.id}>
                    <td>{new Date(a.createdAt).toLocaleDateString()}</td>
                    {isAdmin && (
                      <td>
                        {nameOf(a.recipientType, a.recipientId)}
                        <span className="text-xs text-slate-400 ml-1">{TYPE_LABELS[a.recipientType]}</span>
                      </td>
                    )}
                    <td>{a.orderName || (a.category ? "-" : a.itemName)}</td>
                    <td>{a.buyer || "-"}</td>
                    <td>{a.category || "-"}</td>
                    <td className="tabular-nums">{fmt(a.amount)}</td>
                    <td className="text-xs text-slate-500">{a.note || ""}</td>
                    <td>
                      <span className={a.status === "unsettled" ? "text-amber-600 font-medium" : "text-emerald-600"}>
                        {a.status === "unsettled" ? "未核銷" : "已核銷"}
                      </span>
                    </td>
                    <td>{a.settledByMainLedgerId ? `帳本 #${a.settledByMainLedgerId}` : a.status === "settled" ? "獨立沖銷" : "-"}</td>
                    {canWrite && (
                      <td className="space-x-2 whitespace-nowrap">
                        {a.status === "unsettled" && (isAdmin || mine) && (
                          <>
                            <button className="btn-secondary" onClick={() => startEdit(a)}>
                              修改
                            </button>
                            {isAdmin && (
                              <button
                                className="btn-secondary"
                                onClick={() => run(() => settleMutation.mutateAsync({ id: a.id, mainLedgerId: null }))}
                                disabled={settleMutation.isPending}
                              >
                                {a.recipientType === "shipper" ? "核銷並記入帳本" : "核銷（獨立歸還）"}
                              </button>
                            )}
                            <button
                              className="btn-danger"
                              onClick={() => confirm("確定刪除這筆代墊？") && run(() => deleteMutation.mutateAsync({ id: a.id }))}
                            >
                              刪除
                            </button>
                          </>
                        )}
                        {a.status === "settled" && isAdmin && (
                          <button className="btn-secondary" onClick={() => run(() => unsettleMutation.mutateAsync({ id: a.id }))} disabled={unsettleMutation.isPending}>
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
                  <td colSpan={colCount} className="text-center text-slate-400 py-6">
                    尚無代墊記錄
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
