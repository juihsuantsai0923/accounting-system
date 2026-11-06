import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth, canManage } from "../lib/auth";
import { downloadTextFile } from "../lib/download";
import SearchableSelect from "../components/SearchableSelect";
import BatchOrderPicker, { BATCH_LIMIT } from "../components/BatchOrderPicker";

function fmt(n: number) {
  return `NT$${n.toLocaleString()}`;
}

type RecipientType = "teacher" | "salesperson" | "shipper";
const TYPE_LABELS: Record<string, string> = { teacher: "教師", salesperson: "推銷者", shipper: "出貨員" };
const NEW_CATEGORY = "__new__";
const REVIEW_LABELS: Record<string, { text: string; className: string }> = {
  pending: { text: "待審核", className: "text-amber-600 font-medium" },
  approved: { text: "已通過", className: "text-emerald-600" },
  rejected: { text: "已退回", className: "text-red-600 font-medium" },
};

const emptyForm = { orderName: "", orderNo: "", buyer: "", category: "運費", newCategory: "", amount: "", note: "" };

/** 官網訂單在下拉清單裡顯示的名稱：編號＋品項 */
function orderLabel(o: { orderNo: string; items: string[] }) {
  return `#${o.orderNo} ${o.items.join("、")}`.trim();
}

export default function AdvancePaymentsPage() {
  const { user } = useAuth();
  const isAdmin = canManage(user?.role);
  const isShipper = user?.role === "shipper_self";
  const isTeacher = user?.role === "teacher_self";
  const isSelf = isShipper || isTeacher;
  const canWrite = isAdmin || isSelf;
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
  const createBatchMutation = trpc.advancePayments.createBatch.useMutation({ onSuccess: invalidateAll });
  const updateMutation = trpc.advancePayments.update.useMutation({ onSuccess: invalidateAll });
  const settleMutation = trpc.advancePayments.settle.useMutation({ onSuccess: invalidateAll });
  const settleShipperMutation = trpc.advancePayments.settleShipper.useMutation({ onSuccess: invalidateAll });
  const reviewMutation = trpc.advancePayments.review.useMutation({ onSuccess: invalidateAll });
  const unsettleMutation = trpc.advancePayments.unsettle.useMutation({ onSuccess: invalidateAll });
  const deleteMutation = trpc.advancePayments.delete.useMutation({ onSuccess: invalidateAll });

  const [recipientType, setRecipientType] = useState<RecipientType>("shipper");
  const [recipientId, setRecipientId] = useState<number | "">("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
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

  const unsettled = unsettledQuery.data ?? [];
  const approved = unsettled.filter((a) => a.reviewStatus === "approved");
  const pending = unsettled.filter((a) => a.reviewStatus === "pending");

  // 出貨員審核通過、未核銷的代墊，依人加總（管理員用，一次核銷）
  const shipperUnsettled = new Map<number, { total: number; count: number }>();
  for (const a of approved) {
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
    setBatchMode(false);
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
    setPicked({});
  }

  async function handleBatchSubmit(category: string) {
    const entries = Object.entries(picked);
    if (!entries.length) return setError("請至少勾選一張訂單");
    if (entries.length > BATCH_LIMIT) return setError(`一次最多 ${BATCH_LIMIT} 筆，請分批登記`);
    if (entries.some(([, amount]) => !(parseInt(amount, 10) > 0))) return setError("每張勾選的訂單都要填金額");
    if (!isSelf && !recipientId) return setError(`請選擇${TYPE_LABELS[recipientType]}`);
    const items = entries.map(([orderNo, amount]) => {
      const o = orders.find((x) => x.orderNo === orderNo)!;
      return { orderName: orderLabel(o).slice(0, 200), orderNo, buyer: o.buyer, amount };
    });
    const who = isSelf ? {} : { recipientType, recipientId: Number(recipientId) };
    await createBatchMutation.mutateAsync({ ...who, category, note: form.note || undefined, items });
    resetForm();
    utils.advancePayments.categories.invalidate();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const category = form.category === NEW_CATEGORY ? form.newCategory.trim() : form.category;
    if (!category) return setError("請選類別，或打新的類別名稱");
    if (batchMode) {
      try {
        await handleBatchSubmit(category);
      } catch (err: any) {
        return setError(err?.message ?? "儲存失敗");
      }
      return;
    }
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
      } else if (isSelf) {
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

  const saving = createMutation.isPending || createBatchMutation.isPending || updateMutation.isPending;
  const pickedCount = Object.keys(picked).length;
  const myOwed = approved.reduce((s, a) => s + a.amount, 0);
  const colCount = 9 + (isAdmin ? 1 : 0) + (canWrite ? 1 : 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl text-brand-700">{isSelf ? "我的代墊" : "代墊款管理"}</h1>
      {isSelf ? (
        <p className="text-sm text-slate-500">
          幫公司先付的錢（例如寄書的運費）在這裡登記，管理員審核通過後才算公司欠你的。公司還錢後會標成「已核銷」；還沒核銷的可以自己修改或刪除，修改後要重新審核。
        </p>
      ) : (
        <p className="text-sm text-slate-500">
          有人先幫公司墊付費用時，在這裡建立代墊記錄；老師、出貨員自己登記的要在這裡審核，通過才算數。教師、推銷者的代墊會計入他的子記帳表餘額，公司歸還時在這裡「核銷」，或在帳本新增撥款時勾選一併核銷。出貨員的代墊按「核銷並記入帳本」，會照類別在帳本記一筆支出（例如運費）。
        </p>
      )}

      {isSelf && (
        <div className="card border-l-4 border-gold-500">
          <div className="text-sm text-slate-500">公司還沒還你的代墊</div>
          <div className="text-3xl font-semibold mt-1 text-brand-700">{fmt(myOwed)}</div>
          <div className="text-xs text-slate-400 mt-1">
            {approved.length} 筆未核銷{pending.length > 0 && `，另有 ${pending.length} 筆審核中`}
          </div>
        </div>
      )}

      {isAdmin && pending.length > 0 && (
        <div className="card space-y-3 border-l-4 border-amber-500">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium text-brand-700">等你審核的代墊（{pending.length}）</h2>
            {pending.length > 1 && (
              <button
                className="btn-secondary"
                disabled={reviewMutation.isPending}
                onClick={() =>
                  confirm(`${pending.length} 筆代墊（${fmt(pending.reduce((s, a) => s + a.amount, 0))}）全部通過？`) &&
                  run(async () => {
                    for (const a of pending) await reviewMutation.mutateAsync({ id: a.id, approve: true });
                  })
                }
              >
                全部通過
              </button>
            )}
          </div>
          <ul className="divide-y divide-slate-100">
            {pending.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <b>{nameOf(a.recipientType, a.recipientId)}</b>
                  <span className="text-xs text-slate-400 ml-1">{TYPE_LABELS[a.recipientType]}</span>
                  <span className="ml-2">
                    {a.category} <b className="text-amber-600">{fmt(a.amount)}</b>
                  </span>
                  {a.orderName && <span className="ml-2 text-slate-500">{a.orderName}</span>}
                  {a.buyer && <span className="ml-2 text-slate-500">下訂人：{a.buyer}</span>}
                  {a.note && <span className="ml-2 text-slate-500">備註：{a.note}</span>}
                </span>
                <span className="space-x-2 whitespace-nowrap">
                  <button className="btn-primary" disabled={reviewMutation.isPending} onClick={() => run(() => reviewMutation.mutateAsync({ id: a.id, approve: true }))}>
                    通過
                  </button>
                  <button
                    className="btn-danger"
                    disabled={reviewMutation.isPending}
                    onClick={() => {
                      const note = prompt("退回原因（對方看得到，可以不填）");
                      if (note !== null) run(() => reviewMutation.mutateAsync({ id: a.id, approve: false, note: note || undefined }));
                    }}
                  >
                    退回
                  </button>
                </span>
              </li>
            ))}
          </ul>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-brand-700">{editingId ? `修改代墊 #${editingId}` : "新增代墊"}</h2>
            {!editingId && orders.length > 0 && (
              <div className="flex gap-2">
                <button className={batchMode ? "btn-secondary" : "btn-primary"} type="button" onClick={() => setBatchMode(false)}>
                  單筆
                </button>
                <button className={batchMode ? "btn-primary" : "btn-secondary"} type="button" onClick={() => setBatchMode(true)}>
                  複選訂單
                </button>
              </div>
            )}
          </div>
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
            {!batchMode && (
              <>
            <div className="md:col-span-2">
              <label className="label">{orders.length ? "訂單名稱（可選官網訂單或自己打）" : "訂單名稱"}</label>
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
              </>
            )}
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
            {!batchMode && (
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
            )}
            <div className="md:col-span-2">
              <label className="label">備註（選填）</label>
              <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
          {batchMode && (
            <BatchOrderPicker orders={orders} category={form.category === NEW_CATEGORY ? form.newCategory.trim() : form.category} picked={picked} onChange={setPicked} />
          )}
          <div className="flex gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? "儲存中..." : editingId ? "儲存修改" : batchMode ? `新增 ${pickedCount} 筆代墊` : "新增代墊"}
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
                <th>審核</th>
                <th>狀態</th>
                <th>核銷來源</th>
                {canWrite && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {(advancesQuery.data ?? []).map((a) => {
                const mine = isSelf; // 老師、出貨員的清單後端只會給自己的
                const review = REVIEW_LABELS[a.reviewStatus] ?? REVIEW_LABELS.approved;
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
                      <span className={review.className}>{review.text}</span>
                      {a.reviewNote && <div className="text-xs text-slate-500">{a.reviewNote}</div>}
                    </td>
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
                            {isAdmin && a.reviewStatus === "approved" && (
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
