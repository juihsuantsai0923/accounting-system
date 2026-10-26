import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth, canManage } from "../lib/auth";
import { downloadTextFile } from "../lib/download";
import SearchableSelect from "../components/SearchableSelect";

function fmt(n: number) {
  return `NT$${n.toLocaleString()}`;
}

interface DistRow {
  key: string;
  type: "teacher" | "salesperson";
  recipientId: number | "";
  amount: string;
  settledAdvanceIds: number[];
}

type EntryType = "income" | "expense" | "advance";

export default function MainLedgerPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const entriesQuery = trpc.mainLedger.list.useQuery();
  const teachersQuery = trpc.teachers.list.useQuery();
  const salespeopleQuery = trpc.salespeople.list.useQuery();
  const coursesQuery = trpc.courses.list.useQuery();
  const expenseTypesQuery = trpc.expenseTypes.list.useQuery();
  const incomeTypesQuery = trpc.incomeTypes.list.useQuery();

  const invalidateAll = () => {
    utils.mainLedger.list.invalidate();
    utils.teacherLedger.invalidate();
    utils.salespersonLedger.invalidate();
    utils.advancePayments.invalidate();
    utils.reports.balanceOverview.invalidate();
  };

  const createMutation = trpc.mainLedger.create.useMutation({ onSuccess: invalidateAll });
  const createAdvanceMutation = trpc.advancePayments.create.useMutation({ onSuccess: invalidateAll });
  const createCourseIncomeMutation = trpc.mainLedger.createCourseIncome.useMutation({ onSuccess: invalidateAll });
  const deleteMutation = trpc.mainLedger.delete.useMutation({ onSuccess: invalidateAll });
  const recalcMutation = trpc.mainLedger.recalculateBalances.useMutation({ onSuccess: invalidateAll });

  const [type, setType] = useState<EntryType>("income");
  const [itemName, setItemName] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [showDistribution, setShowDistribution] = useState(false);
  const [distributions, setDistributions] = useState<DistRow[]>([]);
  const [advanceRecipientType, setAdvanceRecipientType] = useState<"teacher" | "salesperson">("teacher");
  const [advanceRecipientId, setAdvanceRecipientId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);

  // 收入：課程類別／其他收入
  const [incomeMode, setIncomeMode] = useState<"course" | "other">("course");

  // 課程收入分潤精靈
  const [wizardCourseId, setWizardCourseId] = useState<number | "">("");
  const [wizardYears, setWizardYears] = useState<1 | 2 | 3>(1);
  const [wizardHasCoupon, setWizardHasCoupon] = useState(false);
  const [wizardHasReferral, setWizardHasReferral] = useState(false);
  const [wizardReferralType, setWizardReferralType] = useState<"teacher" | "salesperson">("teacher");
  const [wizardReferralId, setWizardReferralId] = useState<number | "">("");
  const [wizardNote, setWizardNote] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // 支出：薪水／其他
  const [expenseKind, setExpenseKind] = useState<"salary" | "other">("salary");
  const [salaryRecipientType, setSalaryRecipientType] = useState<"teacher" | "salesperson">("teacher");
  const [salaryRecipientId, setSalaryRecipientId] = useState<number | "">("");

  function nameOf(kind: "teacher" | "salesperson", id: number) {
    const list = kind === "teacher" ? teachersQuery.data : salespeopleQuery.data;
    return list?.find((p: any) => p.id === id)?.name ?? `#${id}`;
  }

  function resetWizard() {
    setWizardCourseId("");
    setWizardYears(1);
    setWizardHasCoupon(false);
    setWizardHasReferral(false);
    setWizardReferralId("");
    setWizardNote("");
    setPreview(null);
    setPreviewError(null);
  }

  async function handlePreviewCourseIncome() {
    setPreviewError(null);
    setPreview(null);
    if (!wizardCourseId) {
      setPreviewError("請先選擇課程");
      return;
    }
    if (wizardHasReferral && !wizardReferralId) {
      setPreviewError("請選擇行銷人員（或老師本人）");
      return;
    }
    setPreviewLoading(true);
    try {
      const result = await utils.mainLedger.previewCourseIncome.fetch({
        courseId: Number(wizardCourseId),
        years: wizardYears,
        hasCoupon: wizardHasCoupon,
        referral: wizardHasReferral ? { type: wizardReferralType, recipientId: Number(wizardReferralId) } : null,
      });
      setPreview(result);
    } catch (err: any) {
      setPreviewError(err?.message ?? "預覽失敗");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleConfirmCourseIncome() {
    setError(null);
    setSuccessMsg(null);
    if (!wizardCourseId || !preview) return;
    try {
      await createCourseIncomeMutation.mutateAsync({
        courseId: Number(wizardCourseId),
        years: wizardYears,
        hasCoupon: wizardHasCoupon,
        referral: wizardHasReferral ? { type: wizardReferralType, recipientId: Number(wizardReferralId) } : null,
        note: wizardNote || undefined,
      });
      resetWizard();
      setSuccessMsg("課程收入已入帳：母記帳表已記錄全額，各人員子記帳表已同步分配。");
    } catch (err: any) {
      setError(err?.message ?? "入帳失敗");
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const result = await utils.reports.exportMainLedgerCsv.fetch();
      downloadTextFile(result.filename, result.csv);
    } finally {
      setExporting(false);
    }
  }

  const totalDistributed = distributions.reduce((s, d) => s + (parseInt(d.amount || "0", 10) || 0), 0);
  const amountNum = parseInt(amount || "0", 10) || 0;

  // 支出「其他」類別下拉選單：排除自動建立的老師/銷售員薪水類別（薪水改走上面的身份+人員選單）
  const generalExpenseTypes = (expenseTypesQuery.data ?? []).filter((e: any) => !e.teacherId && !e.salespersonId);

  function findSalaryExpenseType(kind: "teacher" | "salesperson", recipientId: number | "") {
    if (recipientId === "") return undefined;
    return (expenseTypesQuery.data ?? []).find((e: any) =>
      kind === "teacher" ? e.teacherId === recipientId : e.salespersonId === recipientId
    );
  }

  const advanceRecipientOptions = advanceRecipientType === "teacher" ? teachersQuery.data ?? [] : salespeopleQuery.data ?? [];

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

  function resetForm() {
    setItemName("");
    setCategoryId("");
    setAmount("");
    setNote("");
    setDistributions([]);
    setShowDistribution(false);
    setAdvanceRecipientId("");
    setExpenseKind("salary");
    setSalaryRecipientId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (type === "advance") {
      if (!advanceRecipientId) {
        setError("請選擇教師或推銷者");
        return;
      }
      try {
        await createAdvanceMutation.mutateAsync({
          recipientType: advanceRecipientType,
          recipientId: Number(advanceRecipientId),
          itemName,
          amount,
          note: note || undefined,
        });
        resetForm();
        setSuccessMsg("代墊記錄已建立：只會計入該對象的子記帳表，母記帳表餘額不會變動。完整列表與核銷請至「代墊管理」頁面。");
      } catch (err: any) {
        setError(err?.message ?? "新增失敗");
      }
      return;
    }

    if (type === "income") {
      if (incomeMode === "course") {
        // 課程收入一律走分潤精靈（見下方 handleConfirmCourseIncome），這裡不處理
        return;
      }
      // 其他收入（非課程）：一般表單 + 可選的多方分配
      if (!categoryId) {
        setError("請選擇收入類型");
        return;
      }
      if (!itemName.trim()) {
        setError("請填寫項目名稱");
        return;
      }
      if (totalDistributed > amountNum) {
        setError("分配總額不能超過原始金額");
        return;
      }
      try {
        await createMutation.mutateAsync({
          type: "income",
          itemName,
          categoryId: Number(categoryId),
          amount,
          note: note || undefined,
          distributions: distributions
            .filter((d) => d.recipientId !== "" && parseInt(d.amount || "0", 10) > 0)
            .map((d) => ({
              type: d.type,
              recipientId: Number(d.recipientId),
              amount: d.amount,
              settledAdvanceIds: d.settledAdvanceIds.length ? d.settledAdvanceIds : undefined,
            })),
        });
        resetForm();
      } catch (err: any) {
        setError(err?.message ?? "新增失敗");
      }
      return;
    }

    // type === "expense"：薪水／其他，不支援多方分配
    let effectiveCategoryId: number | "" = categoryId;
    let effectiveItemName = itemName;

    if (expenseKind === "salary") {
      if (!salaryRecipientId) {
        setError("請選擇薪水發放對象");
        return;
      }
      const match = findSalaryExpenseType(salaryRecipientType, salaryRecipientId);
      if (!match) {
        setError("找不到對應的薪水類別，請重新整理頁面後再試一次");
        return;
      }
      effectiveCategoryId = match.id;
      effectiveItemName = itemName || match.name;
    } else {
      if (!categoryId) {
        setError("請選擇支出項目");
        return;
      }
      if (!itemName.trim()) {
        setError("請填寫品項備註");
        return;
      }
    }

    try {
      await createMutation.mutateAsync({
        type: "expense",
        itemName: effectiveItemName,
        categoryId: Number(effectiveCategoryId),
        amount,
        note: note || undefined,
        distributions: [],
      });
      resetForm();
    } catch (err: any) {
      setError(err?.message ?? "新增失敗");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("確定要刪除這筆記錄嗎？相關分配與子記帳表記錄將一併移除，並重新計算餘額。")) return;
    await deleteMutation.mutateAsync({ id });
  }

  async function handleRecalculate() {
    setRecalcMsg(null);
    const result = await recalcMutation.mutateAsync();
    setRecalcMsg(`已重新計算完成，目前餘額為 ${fmt(result.balance)}。`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-800">母記帳表</h1>
        <div className="flex flex-wrap gap-2">
          {canManage(user?.role) && (
            <button
              className="btn-secondary"
              onClick={handleRecalculate}
              disabled={recalcMutation.isPending}
              title="修復刪除記錄後可能殘留的累計餘額誤差，重新從頭加總一次"
            >
              {recalcMutation.isPending ? "重新計算中..." : "重新計算餘額"}
            </button>
          )}
          <button className="btn-secondary" onClick={handleExportCsv} disabled={exporting}>
            {exporting ? "匯出中..." : "下載 CSV 對帳表"}
          </button>
        </div>
      </div>
      {recalcMsg && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{recalcMsg}</div>}

      {canManage(user?.role) && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h2 className="font-medium text-slate-700">新增記錄</h2>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          {successMsg && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{successMsg}</div>}

          <div>
            <label className="label">類型</label>
            <select
              className="input sm:!w-56"
              value={type}
              onChange={(e) => {
                setType(e.target.value as EntryType);
                setCategoryId("");
                setError(null);
                setSuccessMsg(null);
              }}
            >
              <option value="income">收入</option>
              <option value="expense">支出</option>
              <option value="advance">代墊</option>
            </select>
          </div>

          {type === "advance" ? (
            <div className="space-y-4">
              <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                代墊：教師/推銷者自己先墊付了公司的費用，記一筆到他的子記帳表餘額，不會影響母記帳表。之後公司歸還時，可以到「代墊管理」核銷，或在這裡新增撥款時一併勾選核銷。
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="label">身份</label>
                  <select
                    className="input"
                    value={advanceRecipientType}
                    onChange={(e) => {
                      setAdvanceRecipientType(e.target.value as "teacher" | "salesperson");
                      setAdvanceRecipientId("");
                    }}
                  >
                    <option value="teacher">教師</option>
                    <option value="salesperson">推銷者</option>
                  </select>
                </div>
                <div>
                  <label className="label">對象</label>
                  <SearchableSelect
                    options={(advanceRecipientOptions ?? []).map((p: any) => ({ id: p.id, name: p.name }))}
                    value={advanceRecipientId}
                    onChange={(id) => setAdvanceRecipientId(id)}
                    placeholder="搜尋姓名..."
                  />
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
            </div>
          ) : type === "income" ? (
            <div className="space-y-4">
              <div>
                <label className="label">收入來源</label>
                <select
                  className="input sm:!w-56"
                  value={incomeMode}
                  onChange={(e) => {
                    setIncomeMode(e.target.value as "course" | "other");
                    setError(null);
                    setSuccessMsg(null);
                  }}
                >
                  <option value="course">課程類別</option>
                  <option value="other">其他收入</option>
                </select>
              </div>

              {incomeMode === "course" ? (
              <>
              <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                課程收入分潤精靈：依《課程分潤與成本結構辦法》自動計算各人分潤。母記帳表會記錄「入帳金額」（售價 − 優惠碼折抵，尚未扣除行銷抽成），行銷抽成與所有分潤只會反映在各自的子記帳表。
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">① 選擇課程</label>
                  <SearchableSelect
                    options={(coursesQuery.data ?? []).map((c: any) => ({ id: c.id, name: c.name }))}
                    value={wizardCourseId}
                    onChange={(id) => {
                      setWizardCourseId(id);
                      setPreview(null);
                    }}
                    placeholder="搜尋課程名稱..."
                  />
                  {wizardCourseId !== "" &&
                    (() => {
                      const c: any = (coursesQuery.data ?? []).find((x: any) => x.id === wizardCourseId);
                      if (!c) return null;
                      const original = c.originalPrice ?? c.basePrice;
                      return (
                        <div className="text-xs text-slate-400 mt-1">
                          {c.teacherId ? `主理教師：${nameOf("teacher", c.teacherId)}` : "⚠ 尚未設定主理教師"}
                          {" ・ "}
                          {original ? `原價：${fmt(original)}` : "⚠ 尚未設定原價"}
                        </div>
                      );
                    })()}
                </div>
                <div>
                  <label className="label">備註（選填）</label>
                  <input className="input" value={wizardNote} onChange={(e) => setWizardNote(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="label">② 這是幾年期的課程</label>
                <select
                  className="input sm:!w-56"
                  value={wizardYears}
                  onChange={(e) => {
                    setWizardYears(Number(e.target.value) as 1 | 2 | 3);
                    setPreview(null);
                  }}
                >
                  <option value={1}>1 年期（基礎折數）</option>
                  <option value={2}>2 年期（基礎折數 +1 折）</option>
                  <option value={3}>3 年期（基礎折數 +2 折）</option>
                </select>
              </div>

              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={wizardHasCoupon}
                    onChange={(e) => {
                      setWizardHasCoupon(e.target.checked);
                      setPreview(null);
                    }}
                  />
                  ③ 有使用優惠碼（折抵固定金額，將在管理面板「分潤設定」中設定的數字）
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={wizardHasReferral}
                    onChange={(e) => {
                      setWizardHasReferral(e.target.checked);
                      setPreview(null);
                    }}
                  />
                  ④ 有行銷／推廣人員（固定抽成金額，計入該人員的子記帳表）
                </label>

                {wizardHasReferral && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 rounded-lg p-3">
                    <div>
                      <label className="label">身份</label>
                      <select
                        className="input"
                        value={wizardReferralType}
                        onChange={(e) => {
                          setWizardReferralType(e.target.value as "teacher" | "salesperson");
                          setWizardReferralId("");
                          setPreview(null);
                        }}
                      >
                        <option value="teacher">老師</option>
                        <option value="salesperson">推銷者</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">行銷／推廣人員（老師也可以是自己的推廣人）</label>
                      <SearchableSelect
                        options={((wizardReferralType === "teacher" ? teachersQuery.data : salespeopleQuery.data) ?? []).map(
                          (p: any) => ({ id: p.id, name: p.name })
                        )}
                        value={wizardReferralId}
                        onChange={(id) => {
                          setWizardReferralId(id);
                          setPreview(null);
                        }}
                        placeholder="搜尋姓名..."
                      />
                    </div>
                  </div>
                )}
              </div>

              <button type="button" className="btn-secondary" onClick={handlePreviewCourseIncome} disabled={previewLoading}>
                {previewLoading ? "計算中..." : "⑤ 預覽分配"}
              </button>
              {previewError && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{previewError}</div>}

              {preview && (
                <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="text-sm text-slate-700 space-y-1">
                    <div>
                      原價 {fmt(preview.originalPrice)} × {(preview.discountTier * 10).toFixed(1)}折 = 售價{" "}
                      <span className="font-medium">{fmt(preview.price)}</span>
                    </div>
                    <div>
                      母記帳表將記錄入帳金額：<span className="font-medium">{fmt(preview.amount)}</span>
                      {wizardHasCoupon && <span className="text-slate-400"> （售價 {fmt(preview.price)} − 優惠碼折抵）</span>}
                    </div>
                    <div className="text-slate-400 text-xs">
                      分配用淨額（扣除行銷抽成後）：{fmt(preview.netForSplit)} ・ 平台費（{fmt(preview.platformFee)}）已由每人團隊獎金與主理教師分潤分完
                    </div>
                  </div>

                  <table className="data-table w-full">
                    <thead>
                      <tr>
                        <th>對象</th>
                        <th>身份</th>
                        <th>項目</th>
                        <th>金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.distributions.map((d: any, i: number) => (
                        <tr key={i}>
                          <td>{nameOf(d.type, d.recipientId)}</td>
                          <td>{d.type === "teacher" ? "老師" : "推銷者"}</td>
                          <td>
                            {d.role === "owner" ? "課程主理分潤" : d.role === "team_bonus" ? "團隊獎金" : "推廣抽成"}
                          </td>
                          <td>{fmt(d.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="text-sm text-slate-600 flex flex-wrap gap-4">
                    <span>已分配總額：{fmt(preview.totalDistributed)}</span>
                    <span className="text-slate-400">
                      平台留存（僅供參考，不入分錄，已扣除每月教材物流與訂閱成本估算 {fmt(preview.costPerCourse)}）：{fmt(preview.platformReserve)}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleConfirmCourseIncome}
                    disabled={createCourseIncomeMutation.isPending}
                  >
                    {createCourseIncomeMutation.isPending ? "入帳中..." : "⑥ 確認入帳"}
                  </button>
                </div>
              )}
              </>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="label">項目名稱</label>
                      <input className="input" value={itemName} onChange={(e) => setItemName(e.target.value)} required />
                    </div>
                    <div>
                      <label className="label">收入類型</label>
                      <select className="input" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))} required>
                        <option value="">請選擇</option>
                        {(incomeTypesQuery.data ?? []).map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-400 mt-1">收入類型清單可至管理面板「收入類型管理」新增。</p>
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
                    <div>
                      <label className="label">備註（選填）</label>
                      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>
                  </div>

                  <button type="button" className="btn-secondary" onClick={() => setShowDistribution((v) => !v)}>
                    {showDistribution ? "隱藏多方分配" : "顯示多方分配"}
                  </button>

                  {showDistribution && (
                    <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn-secondary" onClick={() => addDistribution("teacher")}>
                          + 新增教師分配
                        </button>
                        <button type="button" className="btn-secondary" onClick={() => addDistribution("salesperson")}>
                          + 新增推銷者分配
                        </button>
                      </div>
                      {distributions.map((d) => {
                        const list = d.type === "teacher" ? teachersQuery.data : salespeopleQuery.data;
                        return (
                          <div key={d.key} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start bg-slate-50 rounded-lg p-3">
                            <div className="md:col-span-2 text-xs text-slate-500 md:pt-2">{d.type === "teacher" ? "教師" : "推銷者"}</div>
                            <div className="md:col-span-3">
                              <SearchableSelect
                                options={(list ?? []).map((p: any) => ({ id: p.id, name: p.name }))}
                                value={d.recipientId}
                                onChange={(id) => updateDistribution(d.key, { recipientId: id, settledAdvanceIds: [] })}
                                placeholder="搜尋姓名..."
                              />
                            </div>
                            <input
                              className="input md:col-span-2"
                              placeholder="分配金額"
                              inputMode="numeric"
                              value={d.amount}
                              onChange={(e) => updateDistribution(d.key, { amount: e.target.value.replace(/[^\d]/g, "") })}
                            />
                            <button type="button" className="btn-danger md:col-span-1" onClick={() => removeDistribution(d.key)}>
                              移除
                            </button>
                          </div>
                        );
                      })}
                      <div className="text-sm text-slate-600 flex flex-wrap gap-4">
                        <span>已分配：{fmt(totalDistributed)}</span>
                        <span>剩餘：{fmt(Math.max(amountNum - totalDistributed, 0))}</span>
                        {totalDistributed > amountNum && (
                          <span className="text-red-600 font-medium">超額：{fmt(totalDistributed - amountNum)}</span>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="label">支出類型</label>
                  <select
                    className="input"
                    value={expenseKind}
                    onChange={(e) => {
                      setExpenseKind(e.target.value as "salary" | "other");
                      setSalaryRecipientId("");
                      setCategoryId("");
                      setItemName("");
                    }}
                  >
                    <option value="salary">薪水</option>
                    <option value="other">其他</option>
                  </select>
                </div>

                {expenseKind === "salary" ? (
                  <>
                    <div>
                      <label className="label">身份</label>
                      <select
                        className="input"
                        value={salaryRecipientType}
                        onChange={(e) => {
                          setSalaryRecipientType(e.target.value as "teacher" | "salesperson");
                          setSalaryRecipientId("");
                        }}
                      >
                        <option value="teacher">老師</option>
                        <option value="salesperson">銷售員</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">{salaryRecipientType === "teacher" ? "老師" : "銷售員"}</label>
                      <SearchableSelect
                        options={((salaryRecipientType === "teacher" ? teachersQuery.data : salespeopleQuery.data) ?? []).map(
                          (p: any) => ({ id: p.id, name: p.name })
                        )}
                        value={salaryRecipientId}
                        onChange={(id) => setSalaryRecipientId(id)}
                        placeholder="搜尋姓名..."
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="label">支出項目</label>
                    <select className="input" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))} required>
                      <option value="">請選擇</option>
                      {generalExpenseTypes.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="label">{expenseKind === "salary" ? "備註（選填，例如：7月份薪資）" : "品項備註"}</label>
                  <input
                    className="input"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    required={expenseKind === "other"}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
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
                <div>
                  <label className="label">備註（選填）</label>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>

            </>
          )}

          {(type !== "income" || incomeMode === "other") && (
            <button
              className="btn-primary"
              type="submit"
              disabled={createMutation.isPending || createAdvanceMutation.isPending}
            >
              {createMutation.isPending || createAdvanceMutation.isPending
                ? "新增中..."
                : type === "advance"
                ? "建立代墊記錄"
                : "新增記錄"}
            </button>
          )}
        </form>
      )}

      <div className="card">
        <div className="table-wrap">
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
    </div>
  );
}
