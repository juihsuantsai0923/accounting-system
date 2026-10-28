import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useAuth, canManage } from "../lib/auth";
import { downloadTextFile } from "../lib/download";
import SearchableSelect from "../components/SearchableSelect";
import CheckList from "../components/CheckList";
import NoteFields, { NoteView } from "../components/NoteFields";
import EditEntryDialog from "../components/EditEntryDialog";
import { formatNote, type NoteParts } from "../../../server/noteFormat";

function fmt(n: number) {
  return n < 0 ? `−NT$${Math.abs(n).toLocaleString()}` : `NT$${n.toLocaleString()}`;
}

interface DistRow {
  key: string;
  type: "teacher" | "salesperson";
  recipientId: number | "";
  amount: string;
  settledAdvanceIds: number[];
}

type EntryType = "income" | "expense" | "advance";
type IncomeMode = "course" | "tutoring" | "book" | "other";

interface BookLine {
  key: string;
  bookId: number | "";
  qty: string;
}

function newBookLine(bookId: number | "" = ""): BookLine {
  return { key: `${Date.now()}-${Math.random()}`, bookId, qty: "1" };
}

interface TutorRow {
  courseId: number;
  amount: string;
}

const SOURCE_LABELS: Record<string, string> = {
  course: "線上課程",
  tutoring: "小班家教",
  book: "書籍",
  other: "其他收入",
  mixed: "多項收入",
};

const BOOK_KIND_LABELS: Record<string, string> = { book: "講義", workbook: "刷題本", bundle: "組合包", notebook: "筆記本" };

/**
 * 這筆記錄讓公積金增減多少：
 *   收入 → 金額扣掉分給個人的部分（正數）
 *   薪水撥款 → 0（付的是公司本來就欠的錢，公積金不變）
 *   其他公帳支出 → 負數
 */
export function reserveDelta(e: { type: string; amount: number; distributed: number }) {
  return e.type === "income" ? e.amount - e.distributed : -(e.amount - e.distributed);
}

function isSalaryEntry(e: { salaryTeacherId: number | null; salarySalespersonId: number | null }) {
  return e.salaryTeacherId != null || e.salarySalespersonId != null;
}

function monthOf(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtDateTime(ts: number) {
  return new Date(ts).toLocaleString("zh-TW", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function signedFmt(n: number) {
  if (n === 0) return "NT$0";
  return `${n > 0 ? "+" : "−"}NT$${Math.abs(n).toLocaleString()}`;
}

const SORT_KEY = "mainLedger.sortNewestFirst";

function isCouponExpired(validUntil: string | null) {
  return !!validUntil && validUntil < new Date().toISOString().slice(0, 10);
}

/**
 * view="entry"：手動記帳（新增記錄的表單）；view="book"：帳本（所有記錄的列表、篩選、編輯）。
 * 兩頁共用同一份資料與狀態，只是畫面拆開。
 */
export default function MainLedgerPage({ view }: { view: "entry" | "book" }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const entriesQuery = trpc.mainLedger.list.useQuery();
  const teachersQuery = trpc.teachers.list.useQuery();
  const salespeopleQuery = trpc.salespeople.list.useQuery();
  const coursesQuery = trpc.courses.list.useQuery();
  const expenseTypesQuery = trpc.expenseTypes.list.useQuery();
  const incomeTypesQuery = trpc.incomeTypes.list.useQuery();
  const booksQuery = trpc.books.list.useQuery();
  const couponsQuery = trpc.coupons.list.useQuery();
  const settingsQuery = trpc.revenueSettings.get.useQuery();
  // 應付總覽只給財務人員（教師本人沒有權限，也用不到：他看不到新增記錄的表單）
  const overviewQuery = trpc.reports.balanceOverview.useQuery(undefined, { enabled: canManage(user?.role) });

  const invalidateAll = () => {
    utils.mainLedger.list.invalidate();
    utils.teacherLedger.invalidate();
    utils.salespersonLedger.invalidate();
    utils.advancePayments.invalidate();
    utils.reports.balanceOverview.invalidate();
    utils.reports.personStats.invalidate();
  };

  const createMutation = trpc.mainLedger.create.useMutation({ onSuccess: invalidateAll });
  const createAdvanceMutation = trpc.advancePayments.create.useMutation({ onSuccess: invalidateAll });
  const createCourseIncomeMutation = trpc.mainLedger.createCourseIncome.useMutation({ onSuccess: invalidateAll });
  const createTutoringIncomeMutation = trpc.mainLedger.createTutoringIncome.useMutation({ onSuccess: invalidateAll });
  const createBookIncomeMutation = trpc.mainLedger.createBookIncome.useMutation({ onSuccess: invalidateAll });
  const deleteMutation = trpc.mainLedger.delete.useMutation({ onSuccess: invalidateAll });
  const recalcMutation = trpc.mainLedger.recalculateBalances.useMutation({ onSuccess: invalidateAll });

  const [type, setType] = useState<EntryType>("income");
  const [itemName, setItemName] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState<NoteParts>({});
  const [showDistribution, setShowDistribution] = useState(false);
  const [distributions, setDistributions] = useState<DistRow[]>([]);
  const [advanceRecipientType, setAdvanceRecipientType] = useState<"teacher" | "salesperson">("teacher");
  const [advanceRecipientId, setAdvanceRecipientId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);

  // 列表：排序與篩選（排序方向記在這台電腦的瀏覽器）
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
  const [editing, setEditing] = useState<any>(null);
  const [filterType, setFilterType] = useState<"all" | "income" | "expense">("all");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterText, setFilterText] = useState("");

  // 收入來源：線上課程／小班家教／書籍／其他收入
  const [incomeMode, setIncomeMode] = useState<IncomeMode>("course");

  // 小班家教
  const [tutorRows, setTutorRows] = useState<TutorRow[]>([]);
  const [tutorSaving, setTutorSaving] = useState(false);
  const [tutorNote, setTutorNote] = useState<NoteParts>({});

  // 書籍（含筆記本）
  const [bookLines, setBookLines] = useState<BookLine[]>([]);
  const [bookCouponId, setBookCouponId] = useState<number | "">("");
  const [bookAmount, setBookAmount] = useState("");
  const [bookAmountEdited, setBookAmountEdited] = useState(false);
  const [bookNote, setBookNote] = useState<NoteParts>({});

  // 課程收入分潤精靈
  const [wizardCourseId, setWizardCourseId] = useState<number | "">("");
  const [wizardYears, setWizardYears] = useState<1 | 2 | 3>(1);
  const [wizardHasCoupon, setWizardHasCoupon] = useState(false);
  const [wizardHasReferral, setWizardHasReferral] = useState(false);
  const [wizardReferralType, setWizardReferralType] = useState<"teacher" | "salesperson">("teacher");
  const [wizardReferralId, setWizardReferralId] = useState<number | "">("");
  const [wizardNote, setWizardNote] = useState<NoteParts>({});
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
    setWizardNote({});
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
        note: formatNote(wizardNote),
      });
      resetWizard();
      setSuccessMsg("課程收入已入帳：帳本已記錄全額，各人員子記帳表已同步分配。");
    } catch (err: any) {
      setError(err?.message ?? "入帳失敗");
    }
  }

  // ── 小班家教：實收金額 × 公積金比例留公司，其餘全給主理教師 ──
  const tutoringCourses = (coursesQuery.data ?? []).filter((c: any) => c.category === "tutoring");
  const onlineCourses = (coursesQuery.data ?? []).filter((c: any) => c.category !== "tutoring");
  const tutoringRate = settingsQuery.data?.settings.tutoringReserveRate ?? 0.1;
  const courseById = new Map((coursesQuery.data ?? []).map((c: any) => [c.id, c]));
  const tutorCalc = tutorRows.map((r) => {
    const course: any = courseById.get(r.courseId);
    const amount = parseInt(r.amount || "0", 10) || 0;
    const reserve = Math.round(amount * tutoringRate);
    return { ...r, course, amountNum: amount, reserve, teacherShare: amount - reserve };
  });
  const tutorTotal = tutorCalc.reduce((s, r) => s + r.amountNum, 0);
  const tutorReserveTotal = tutorCalc.reduce((s, r) => s + r.reserve, 0);

  function toggleTutorCourse(id: number) {
    setTutorRows((prev) =>
      prev.some((r) => r.courseId === id)
        ? prev.filter((r) => r.courseId !== id)
        : [...prev, { courseId: id, amount: String((courseById.get(id) as any)?.originalPrice ?? "") }]
    );
  }

  /** 勾幾門課都只記成一筆；每門課的分潤各自給該課主理教師 */
  async function handleConfirmTutoring() {
    setError(null);
    setSuccessMsg(null);
    if (!tutorCalc.length) return setError("請至少勾一門小班家教課程");
    const noTeacher = tutorCalc.find((r) => !r.course?.teacherId);
    if (noTeacher) return setError(`「${noTeacher.course?.name}」還沒設定主理教師，請先到管理面板「課程管理」設定`);
    const noAmount = tutorCalc.find((r) => r.amountNum <= 0);
    if (noAmount) return setError(`請填「${noAmount.course?.name}」的實收金額`);
    setTutorSaving(true);
    try {
      await createTutoringIncomeMutation.mutateAsync({
        items: tutorCalc.map((r) => ({ courseId: r.courseId, amount: r.amountNum })),
        note: formatNote(tutorNote),
      });
      setTutorRows([]);
      setTutorNote({});
      setSuccessMsg(`小班家教已入帳一筆 ${fmt(tutorTotal)}：公積金 ${fmt(tutorReserveTotal)}，${tutorCalc
        .map((r) => `${nameOf("teacher", r.course.teacherId)} ${fmt(r.teacherShare)}`)
        .join("、")}。`);
    } catch (err: any) {
      setError(err?.message ?? "入帳失敗");
    } finally {
      setTutorSaving(false);
    }
  }

  // ── 書籍（含筆記本）：定價 × 數量，套用優惠碼，全數留給公積金 ──
  const activeBooks = (booksQuery.data ?? []).filter((b: any) => b.isActive);
  const bookById = new Map((booksQuery.data ?? []).map((b: any) => [b.id, b]));
  const filledBookLines = bookLines.filter((l) => l.bookId !== "" && (parseInt(l.qty || "0", 10) || 0) > 0);
  const bookSubtotal = filledBookLines.reduce(
    (s, l) => s + (bookById.get(Number(l.bookId))?.price ?? 0) * (parseInt(l.qty, 10) || 0),
    0
  );
  const selectedCoupon: any = (couponsQuery.data ?? []).find((c: any) => c.id === bookCouponId);
  const bookDiscount = selectedCoupon ? Math.round(bookSubtotal * selectedCoupon.discountRate) : 0;
  const bookSuggested = bookSubtotal - bookDiscount;
  const bookAmountShown = bookAmountEdited ? bookAmount : bookSuggested ? String(bookSuggested) : "";
  const usableCoupons = (couponsQuery.data ?? []).filter((c: any) => c.isActive);

  function updateBookLine(key: string, patch: Partial<BookLine>) {
    setBookLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function resetBookForm() {
    setBookLines([]);
    setBookCouponId("");
    setBookAmount("");
    setBookAmountEdited(false);
    setBookNote({});
  }

  async function handleConfirmBook() {
    setError(null);
    setSuccessMsg(null);
    if (!filledBookLines.length) return setError("請至少選一本書");
    const amountToSave = parseInt(bookAmountShown || "0", 10) || 0;
    if (amountToSave <= 0) return setError("請填寫實收金額");
    try {
      await createBookIncomeMutation.mutateAsync({
        lines: filledBookLines.map((l) => ({ bookId: Number(l.bookId), qty: parseInt(l.qty, 10) })),
        couponId: bookCouponId === "" ? null : bookCouponId,
        amount: amountToSave,
        note: formatNote(bookNote),
      });
      resetBookForm();
      setSuccessMsg(`書籍收入已入帳：${fmt(amountToSave)} 全數留給公積金。`);
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

  /** 選類別時，項目名稱還沒填（或還是上一個類別的名稱）就先帶入類別名稱，讓人接著補細節 */
  function pickCategory(id: number, list: any[]) {
    setCategoryId(id);
    const names = new Set(list.map((c: any) => c.name));
    const picked = list.find((c: any) => c.id === id);
    if (picked && (!itemName.trim() || names.has(itemName.trim()))) setItemName(`${picked.name} `);
  }

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
    setNote({});
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
          note: note.memo?.trim() || undefined,
        });
        resetForm();
        setSuccessMsg("代墊記錄已建立：只會計入該對象的子記帳表，帳本餘額不會變動。完整列表與核銷請至「代墊管理」頁面。");
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
          note: formatNote(note),
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
        setError("請填寫項目名稱");
        return;
      }
    }

    try {
      await createMutation.mutateAsync({
        type: "expense",
        itemName: effectiveItemName,
        categoryId: Number(effectiveCategoryId),
        amount,
        note: formatNote(note),
        // 薪水：同一筆金額記進該人員子記帳表的支出，公司欠他的錢跟著減少；其他公帳支出不分配
        distributions:
          expenseKind === "salary" ? [{ type: salaryRecipientType, recipientId: Number(salaryRecipientId), amount }] : [],
      });
      resetForm();
    } catch (err: any) {
      setError(err?.message ?? "新增失敗");
    }
  }

  const allEntries = entriesQuery.data ?? [];
  const categoryOptions = useMemo(
    () => [...new Set(allEntries.map((e) => e.categoryName))].sort((a, b) => a.localeCompare(b, "zh-Hant")),
    [allEntries]
  );
  const monthOptions = useMemo(() => [...new Set(allEntries.map((e) => monthOf(e.createdAt)))].sort().reverse(), [allEntries]);
  const isFiltering = filterType !== "all" || !!filterCategory || !!filterMonth || !!filterText.trim();
  const visibleEntries = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const rows = allEntries.filter(
      (e) =>
        (filterType === "all" || e.type === filterType) &&
        (!filterCategory || e.categoryName === filterCategory) &&
        (!filterMonth || monthOf(e.createdAt) === filterMonth) &&
        (!q || `${e.itemName} ${e.categoryName} ${e.note ?? ""}`.toLowerCase().includes(q))
    );
    return newestFirst ? [...rows].reverse() : rows;
  }, [allEntries, filterType, filterCategory, filterMonth, filterText, newestFirst]);
  const visibleTotals = visibleEntries.reduce(
    (t, e) => ({
      income: t.income + (e.type === "income" ? e.amount : 0),
      expense: t.expense + (e.type === "expense" ? e.amount : 0),
      reserve: t.reserve + reserveDelta(e),
    }),
    { income: 0, expense: 0, reserve: 0 }
  );

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
        <h1 className="text-2xl text-brand-700">{view === "entry" ? "手動記帳" : "帳本"}</h1>
        <div className="flex flex-wrap gap-2">
          {view === "entry" && (
            <Link to="/ledger" className="btn-secondary">
              看帳本 →
            </Link>
          )}
          {view === "book" && canManage(user?.role) && (
            <button
              className="btn-secondary"
              onClick={handleRecalculate}
              disabled={recalcMutation.isPending}
              title="修復刪除記錄後可能殘留的累計餘額誤差，重新從頭加總一次"
            >
              {recalcMutation.isPending ? "重新計算中..." : "重新計算餘額"}
            </button>
          )}
          {view === "book" && (
            <button className="btn-secondary" onClick={handleExportCsv} disabled={exporting}>
              {exporting ? "匯出中..." : "下載 CSV 對帳表"}
            </button>
          )}
        </div>
      </div>
      {recalcMsg && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{recalcMsg}</div>}

      {view === "entry" && canManage(user?.role) && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h2 className="font-medium text-brand-700">新增記錄</h2>
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
                代墊：教師/推銷者自己先墊付了公司的費用，記一筆到他的子記帳表餘額，不會影響帳本。之後公司歸還時，可以到「代墊管理」核銷，或在這裡新增撥款時一併勾選核銷。
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
                <label className="label">說明（選填）</label>
                <input className="input" value={note.memo ?? ""} onChange={(e) => setNote({ memo: e.target.value })} />
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
                    setIncomeMode(e.target.value as IncomeMode);
                    setError(null);
                    setSuccessMsg(null);
                  }}
                >
                  <option value="course">線上課程（分潤精靈）</option>
                  <option value="tutoring">小班家教</option>
                  <option value="book">書籍（含筆記本）</option>
                  <option value="other">其他收入</option>
                </select>
              </div>

              {incomeMode === "course" ? (
              <>
              <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                課程收入分潤精靈：依《課程分潤與成本結構辦法》自動計算各人分潤。帳本會記錄「入帳金額」（售價 − 優惠碼折抵，尚未扣除行銷抽成），行銷抽成與所有分潤只會反映在各自的子記帳表。
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">① 選擇課程</label>
                  <SearchableSelect
                    options={onlineCourses.map((c: any) => ({ id: c.id, name: c.name }))}
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
                <div className="sm:col-span-2">
                  <NoteFields value={wizardNote} onChange={setWizardNote} fields={["buyer", "order", "memo"]} />
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
                      帳本將記錄入帳金額：<span className="font-medium">{fmt(preview.amount)}</span>
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
              ) : incomeMode === "tutoring" ? (
                <>
                  <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                    小班家教：填實際收到的學費。{Math.round(tutoringRate * 1000) / 10}% 留給公積金，其餘全部計入該課程主理教師的子記帳表；不套折數、優惠碼、推廣抽成與團隊獎金。
                  </div>
                  <div>
                    <label className="label">課程（可以複選，一次勾好幾門）</label>
                    {tutoringCourses.length === 0 ? (
                      <p className="text-xs text-amber-600 mt-1">還沒有小班家教課程，請到管理面板「課程管理」新增，類別選「小班家教」。</p>
                    ) : (
                      <CheckList
                        items={tutoringCourses.map((c: any) => ({
                          id: c.id,
                          name: c.name,
                          hint: `${c.teacherId ? nameOf("teacher", c.teacherId) : "⚠ 未設主理教師"}${c.originalPrice ? `・${fmt(c.originalPrice)}` : ""}`,
                        }))}
                        selected={new Set(tutorRows.map((r) => r.courseId))}
                        onToggle={toggleTutorCourse}
                      />
                    )}
                  </div>
                  {tutorCalc.length > 0 && (
                    <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                      <div className="grid grid-cols-12 gap-2 text-xs text-slate-500 px-1">
                        <div className="col-span-5">課程</div>
                        <div className="col-span-3">實收金額</div>
                        <div className="col-span-4">分配</div>
                      </div>
                      {tutorCalc.map((r) => (
                        <div key={r.courseId} className="grid grid-cols-12 gap-2 items-center text-sm">
                          <div className="col-span-5">{r.course?.name}</div>
                          <div className="col-span-3">
                            <input
                              className="input"
                              inputMode="numeric"
                              value={r.amount}
                              onChange={(e) =>
                                setTutorRows((prev) =>
                                  prev.map((x) => (x.courseId === r.courseId ? { ...x, amount: e.target.value.replace(/[^\d]/g, "") } : x))
                                )
                              }
                            />
                          </div>
                          <div className="col-span-4 text-xs text-slate-500">
                            公積金 {fmt(r.reserve)}・{r.course?.teacherId ? nameOf("teacher", r.course.teacherId) : "主理教師"} {fmt(r.teacherShare)}
                          </div>
                        </div>
                      ))}
                      <div className="text-sm text-slate-700 border-t border-slate-100 pt-2">
                        帳本記一筆 <span className="font-medium">{fmt(tutorTotal)}</span>・公積金 {fmt(tutorReserveTotal)}
                      </div>
                    </div>
                  )}
                  <NoteFields value={tutorNote} onChange={setTutorNote} fields={["buyer", "order", "memo"]} />
                  <button type="button" className="btn-primary" onClick={handleConfirmTutoring} disabled={tutorSaving}>
                    {tutorSaving ? "入帳中..." : "確認入帳"}
                  </button>
                </>
              ) : incomeMode === "book" ? (
                <>
                  <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                    書籍（含筆記本、組合包）：選書和數量會自動帶出定價，選了優惠碼會自動折扣。實收金額可以改（例如現場議價），書籍收入全數留給公積金，不分給任何人。書目和優惠碼在管理面板「書籍管理」「優惠碼管理」維護。
                  </div>
                  <div className="space-y-2">
                    <label className="label">書目（可以複選，勾好再改數量）</label>
                    <CheckList
                      items={activeBooks.map((x: any) => ({
                        id: x.id,
                        name: x.name,
                        hint: fmt(x.price),
                        group: BOOK_KIND_LABELS[x.kind] ?? x.kind,
                      }))}
                      selected={new Set(bookLines.map((l) => Number(l.bookId)))}
                      onToggle={(id) =>
                        setBookLines((prev) =>
                          prev.some((l) => l.bookId === id) ? prev.filter((l) => l.bookId !== id) : [...prev, newBookLine(id)]
                        )
                      }
                      placeholder="打字篩選書名，例如 物理、刷題本..."
                    />
                    {bookLines.length > 0 && (
                      <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                        {bookLines.map((l) => {
                          const b: any = bookById.get(Number(l.bookId));
                          const qty = parseInt(l.qty || "0", 10) || 0;
                          return (
                            <div key={l.key} className="grid grid-cols-12 gap-2 items-center text-sm">
                              <div className="col-span-12 sm:col-span-6">{b?.name}</div>
                              <div className="col-span-4 sm:col-span-2 flex items-center gap-1">
                                <span className="text-xs text-slate-400">×</span>
                                <input
                                  className="input"
                                  inputMode="numeric"
                                  aria-label={`${b?.name} 數量`}
                                  value={l.qty}
                                  onChange={(e) => updateBookLine(l.key, { qty: e.target.value.replace(/[^\d]/g, "") })}
                                />
                              </div>
                              <div className="col-span-5 sm:col-span-2 text-slate-600">{b ? fmt(b.price * qty) : "-"}</div>
                              <div className="col-span-3 sm:col-span-2 text-right">
                                <button
                                  type="button"
                                  className="text-xs text-red-600 hover:underline"
                                  onClick={() => setBookLines((prev) => prev.filter((x) => x.key !== l.key))}
                                >
                                  移除
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="label">優惠碼（選填）</label>
                      <select
                        className="input"
                        value={bookCouponId}
                        onChange={(e) => setBookCouponId(e.target.value ? Number(e.target.value) : "")}
                      >
                        <option value="">不使用優惠碼</option>
                        {usableCoupons.map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.code}（{Math.round(c.discountRate * 1000) / 10}% off{isCouponExpired(c.validUntil) ? "・已過期" : ""}）
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">實收金額</label>
                      <input
                        className="input"
                        inputMode="numeric"
                        value={bookAmountShown}
                        onChange={(e) => {
                          setBookAmountEdited(true);
                          setBookAmount(e.target.value.replace(/[^\d]/g, ""));
                        }}
                      />
                      {bookAmountEdited && bookSuggested > 0 && Number(bookAmountShown) !== bookSuggested && (
                        <button
                          type="button"
                          className="text-xs text-brand-600 hover:underline mt-1"
                          onClick={() => {
                            setBookAmountEdited(false);
                            setBookAmount("");
                          }}
                        >
                          改回定價計算的 {fmt(bookSuggested)}
                        </button>
                      )}
                    </div>
                    <div className="sm:col-span-3">
                      <NoteFields value={bookNote} onChange={setBookNote} fields={["buyer", "order", "memo"]} />
                    </div>
                  </div>
                  {bookSubtotal > 0 && (
                    <div className="border border-slate-200 rounded-lg p-4 text-sm text-slate-700 space-y-1">
                      <div>定價小計：{fmt(bookSubtotal)}</div>
                      {selectedCoupon && (
                        <div>
                          優惠碼 {selectedCoupon.code} 折扣：−{fmt(bookDiscount)}
                        </div>
                      )}
                      <div>
                        帳本記錄（全數留給公積金）：<span className="font-medium">{fmt(parseInt(bookAmountShown || "0", 10) || 0)}</span>
                      </div>
                    </div>
                  )}
                  <button type="button" className="btn-primary" onClick={handleConfirmBook} disabled={createBookIncomeMutation.isPending}>
                    {createBookIncomeMutation.isPending ? "入帳中..." : "確認入帳"}
                  </button>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="label">收入類別</label>
                      <select
                        className="input"
                        value={categoryId}
                        onChange={(e) => pickCategory(Number(e.target.value), incomeTypesQuery.data ?? [])}
                        required
                      >
                        <option value="">請選擇</option>
                        {(incomeTypesQuery.data ?? []).map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-400 mt-1">收入類別清單可至管理面板「收入類型管理」新增。</p>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">項目名稱</label>
                      <input
                        className="input"
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        placeholder="例如：銀行利息 2026 上半年"
                        required
                      />
                      <p className="text-xs text-slate-400 mt-1">選類別會先帶入類別名稱，再補上是什麼（年份、數量、對象），帳本上一眼看得懂。</p>
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
                    <div className="col-span-full">
                      <NoteFields value={note} onChange={setNote} fields={["buyer", "order", "memo"]} />
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
                        <span>剩餘（留給公積金）：{fmt(Math.max(amountNum - totalDistributed, 0))}</span>
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
                        <option value="salesperson">推銷者</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">{salaryRecipientType === "teacher" ? "老師" : "推銷者"}</label>
                      <SearchableSelect
                        options={((salaryRecipientType === "teacher" ? teachersQuery.data : salespeopleQuery.data) ?? []).map(
                          (p: any) => ({ id: p.id, name: p.name })
                        )}
                        value={salaryRecipientId}
                        onChange={(id) => setSalaryRecipientId(id)}
                        placeholder="搜尋姓名..."
                      />
                      {salaryRecipientId !== "" &&
                        (() => {
                          const row = (overviewQuery.data ?? []).find(
                            (r) => r.recipientType === salaryRecipientType && r.recipientId === salaryRecipientId
                          );
                          if (!row) return null;
                          return (
                            <p className="text-xs text-slate-500 mt-1">
                              目前公司欠他 {fmt(row.totalBalance)}
                              {row.totalBalance > 0 && (
                                <button
                                  type="button"
                                  className="text-brand-600 hover:underline ml-2"
                                  onClick={() => setAmount(String(row.totalBalance))}
                                >
                                  全部付清
                                </button>
                              )}
                            </p>
                          );
                        })()}
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="label">支出類別</label>
                    <select className="input" value={categoryId} onChange={(e) => pickCategory(Number(e.target.value), generalExpenseTypes)} required>
                      <option value="">請選擇</option>
                      {generalExpenseTypes.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className={expenseKind === "other" ? "sm:col-span-2" : undefined}>
                  <label className="label">{expenseKind === "salary" ? "項目名稱（選填，預設「某某 薪水」）" : "項目名稱"}</label>
                  <input
                    className="input"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder={expenseKind === "salary" ? "例如：10 月份薪資" : "例如：Vimeo 年費 2026、數學工具講義印製 30 本"}
                    required={expenseKind === "other"}
                  />
                  {expenseKind === "other" && (
                    <p className="text-xs text-slate-400 mt-1">選類別會先帶入類別名稱，再補上是什麼（年份、數量、對象），帳本上一眼看得懂。</p>
                  )}
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
                <div className="col-span-full">
                  <NoteFields value={note} onChange={setNote} fields={["memo"]} />
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

      {view === "book" && (
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
            <select className="input !w-28" value={filterType} onChange={(e) => setFilterType(e.target.value as any)}>
              <option value="all">全部</option>
              <option value="income">收入</option>
              <option value="expense">支出</option>
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
            <input
              className="input"
              placeholder="項目、類別或備註..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
          {isFiltering && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setFilterType("all");
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
            {isFiltering ? "符合" : "共"} {visibleEntries.length} 筆
          </span>
          <span className="text-emerald-600">收入 {fmt(visibleTotals.income)}</span>
          <span className="text-red-600">支出 {fmt(visibleTotals.expense)}</span>
          <span>公積金增減 {signedFmt(visibleTotals.reserve)}</span>
        </div>
        <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>項目</th>
              <th>類別</th>
              <th>類型</th>
              <th>金額</th>
              <th title="收入：沒分給任何人、留在公司的部分；公帳支出：從公積金扣掉（負數）；薪水撥款不影響公積金">公積金增減</th>
              <th title="帳本的累計餘額，依記錄先後計算，不受排序和篩選影響">餘額</th>
              <th>最後編輯</th>
              {canManage(user?.role) && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry) => {
              const delta = reserveDelta(entry);
              return (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap">{new Date(entry.createdAt).toLocaleDateString()}</td>
                  <td>
                    {entry.itemName}
                    <NoteView note={entry.note} />
                  </td>
                  <td>
                    {entry.categoryName}
                    {entry.incomeSource && entry.categoryName !== SOURCE_LABELS[entry.incomeSource] && (
                      <div className="text-xs text-slate-400">{SOURCE_LABELS[entry.incomeSource]}</div>
                    )}
                    {isSalaryEntry(entry) && <div className="text-xs text-slate-400">薪水撥款</div>}
                  </td>
                  <td className={entry.type === "income" ? "text-emerald-600" : "text-red-600"}>
                    {entry.type === "income" ? "收入" : "支出"}
                  </td>
                  <td>{fmt(entry.amount)}</td>
                  <td className={delta < 0 ? "text-red-600" : delta > 0 ? "text-slate-600" : "text-slate-400"}>
                    {isSalaryEntry(entry) && delta === 0 ? "不影響" : signedFmt(delta)}
                  </td>
                  <td>{fmt(entry.balance)}</td>
                  <td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(entry.editedAt ?? entry.createdAt)}</td>
                  {canManage(user?.role) && (
                    <td className="whitespace-nowrap space-x-1">
                      <button className="btn-secondary" onClick={() => setEditing(entry)}>
                        編輯
                      </button>
                      <button className="btn-danger" onClick={() => handleDelete(entry.id)}>
                        刪除
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {visibleEntries.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-slate-400 py-6">
                  {isFiltering ? "沒有符合篩選條件的記錄" : "尚無記錄"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      )}
      {editing && <EditEntryDialog entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
