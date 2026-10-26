import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth, ROLE_LABELS } from "../lib/auth";
import SearchableSelect from "../components/SearchableSelect";
import { toHalfWidth } from "../lib/textNormalize";

type Tab = "teachers" | "salespeople" | "courses" | "books" | "coupons" | "expenseTypes" | "incomeTypes" | "users" | "revenue";

const BOOK_KIND_LABELS: Record<string, string> = { book: "講義", workbook: "刷題本", bundle: "組合包", notebook: "筆記本" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-4">
      <h2 className="font-medium text-slate-700">{title}</h2>
      {children}
    </div>
  );
}

function TeachersAdmin() {
  const utils = trpc.useUtils();
  const listQuery = trpc.teachers.list.useQuery();
  const createMutation = trpc.teachers.create.useMutation({
    onSuccess: () => {
      utils.teachers.list.invalidate();
      utils.expenseTypes.list.invalidate();
    },
  });
  const deleteMutation = trpc.teachers.delete.useMutation({
    onSuccess: () => {
      utils.teachers.list.invalidate();
      utils.expenseTypes.list.invalidate();
    },
  });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Section title="教師管理">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (!name.trim()) return;
          try {
            await createMutation.mutateAsync({ name });
            setName("");
          } catch (err: any) {
            setError(err?.message ?? "新增失敗");
          }
        }}
      >
        <input className="input" placeholder="教師姓名" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? "新增中..." : "新增（自動建立薪水支出類型）"}
        </button>
      </form>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <ul className="divide-y divide-slate-100">
        {(listQuery.data ?? []).map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2 text-sm">
            <span>{t.name}</span>
            <button className="btn-danger" onClick={() => confirm(`確定刪除教師「${t.name}」？`) && deleteMutation.mutate({ id: t.id })}>
              刪除
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SalespeopleAdmin() {
  const utils = trpc.useUtils();
  const listQuery = trpc.salespeople.list.useQuery();
  const createMutation = trpc.salespeople.create.useMutation({
    onSuccess: () => {
      utils.salespeople.list.invalidate();
      utils.expenseTypes.list.invalidate();
    },
  });
  const deleteMutation = trpc.salespeople.delete.useMutation({
    onSuccess: () => {
      utils.salespeople.list.invalidate();
      utils.expenseTypes.list.invalidate();
    },
  });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Section title="推銷者管理">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (!name.trim()) return;
          try {
            await createMutation.mutateAsync({ name });
            setName("");
          } catch (err: any) {
            setError(err?.message ?? "新增失敗");
          }
        }}
      >
        <input className="input" placeholder="推銷者姓名" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? "新增中..." : "新增（自動建立薪水支出類型）"}
        </button>
      </form>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <ul className="divide-y divide-slate-100">
        {(listQuery.data ?? []).map((s) => (
          <li key={s.id} className="flex items-center justify-between py-2 text-sm">
            <span>{s.name}</span>
            <button className="btn-danger" onClick={() => confirm(`確定刪除推銷者「${s.name}」？`) && deleteMutation.mutate({ id: s.id })}>
              刪除
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function CoursesAdmin() {
  const utils = trpc.useUtils();
  const listQuery = trpc.courses.list.useQuery();
  const teachersQuery = trpc.teachers.list.useQuery();
  const createMutation = trpc.courses.create.useMutation({ onSuccess: () => utils.courses.list.invalidate() });
  const updateMutation = trpc.courses.update.useMutation({ onSuccess: () => utils.courses.list.invalidate() });
  const deleteMutation = trpc.courses.delete.useMutation({ onSuccess: () => utils.courses.list.invalidate() });

  const [name, setName] = useState("");
  const [type, setType] = useState<"personal" | "collaborative">("personal");
  const [category, setCategory] = useState<"online" | "tutoring">("online");
  const [teacherId, setTeacherId] = useState<number | "">("");
  const [originalPrice, setOriginalPrice] = useState("");

  const teacherOptions = (teachersQuery.data ?? []).map((t) => ({ id: t.id, name: t.name }));

  return (
    <Section title="課程管理">
      <p className="text-xs text-slate-500">
        課程分兩類：<b>線上課程</b>走「課程收入分潤精靈」，實際售價 = 原價 ×（基礎折數 + 年期加成），需要設定主理教師與原價；
        <b>小班家教</b>記帳時直接填實收金額，扣掉公積金比例（在「分潤設定」調整）後全給主理教師，原價只是參考用。
      </p>
      <form
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2 items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await createMutation.mutateAsync({
            name,
            type,
            category,
            teacherId: teacherId === "" ? null : teacherId,
            originalPrice: originalPrice ? parseInt(originalPrice, 10) : null,
          });
          setName("");
          setTeacherId("");
          setOriginalPrice("");
        }}
      >
        <input className="input" placeholder="課程名稱" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value as any)}>
          <option value="online">線上課程</option>
          <option value="tutoring">小班家教</option>
        </select>
        <select className="input" value={type} onChange={(e) => setType(e.target.value as any)}>
          <option value="personal">個人課程</option>
          <option value="collaborative">合作課程</option>
        </select>
        <SearchableSelect options={teacherOptions} value={teacherId} onChange={(id) => setTeacherId(id)} placeholder="主理教師（選填）" />
        <input
          className="input"
          placeholder={category === "tutoring" ? "定價（選填，參考用）" : "原價（選填）"}
          inputMode="numeric"
          value={originalPrice}
          onChange={(e) => setOriginalPrice(e.target.value.replace(/[^\d]/g, ""))}
        />
        <button className="btn-primary" type="submit">
          新增
        </button>
      </form>
      <ul className="divide-y divide-slate-100">
        {(listQuery.data ?? []).map((c) => {
          const teacherName = teacherOptions.find((t) => t.id === c.teacherId)?.name;
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className={`inline-block text-xs rounded px-1.5 py-0.5 mr-1.5 ${c.category === "tutoring" ? "bg-gold-100 text-gold-800" : "bg-brand-50 text-brand-700"}`}>
                  {c.category === "tutoring" ? "小班家教" : "線上課程"}
                </span>
                {c.name}
                {c.category !== "tutoring" && <span className="text-slate-400"> （{c.type === "personal" ? "個人" : "合作"}）</span>}
                {teacherName && <span className="text-slate-400"> · 主理：{teacherName}</span>}
                {c.originalPrice != null && (
                  <span className="text-slate-400">
                    {" "}· {c.category === "tutoring" ? "定價" : "原價"}：NT${c.originalPrice.toLocaleString()}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <select
                  className="input !w-28"
                  value={c.category ?? "online"}
                  onChange={(e) => updateMutation.mutate({ id: c.id, category: e.target.value as "online" | "tutoring" })}
                  title="課程類別"
                >
                  <option value="online">線上課程</option>
                  <option value="tutoring">小班家教</option>
                </select>
                <SearchableSelect
                  className="!w-40"
                  options={teacherOptions}
                  value={c.teacherId ?? ""}
                  onChange={(id) => updateMutation.mutate({ id: c.id, teacherId: id })}
                  placeholder="設定主理教師"
                />
                <input
                  className="input !w-32"
                  placeholder={c.category === "tutoring" ? "定價" : "原價"}
                  inputMode="numeric"
                  defaultValue={c.originalPrice ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, "");
                    updateMutation.mutate({ id: c.id, originalPrice: v ? parseInt(v, 10) : null });
                  }}
                />
                <button className="btn-danger" onClick={() => confirm(`確定刪除課程「${c.name}」？`) && deleteMutation.mutate({ id: c.id })}>
                  刪除
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function BooksAdmin() {
  const utils = trpc.useUtils();
  const listQuery = trpc.books.list.useQuery();
  const onSuccess = () => utils.books.list.invalidate();
  const createMutation = trpc.books.create.useMutation({ onSuccess });
  const updateMutation = trpc.books.update.useMutation({ onSuccess });
  const deleteMutation = trpc.books.delete.useMutation({ onSuccess });
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"book" | "workbook" | "bundle" | "notebook">("book");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Section title="書籍管理（含筆記本、組合包）">
      <p className="text-xs text-slate-500">
        母記帳表收入選「書籍」時會用到這份清單：選書和數量會自動帶出定價。書籍收入全數留給公積金。
        停售的書可以按「停售」隱藏，不會影響已經入帳的舊記錄。
      </p>
      <form
        className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (!name.trim() || !price) return setError("請填書名和定價");
          try {
            await createMutation.mutateAsync({ name: name.trim(), kind, price: parseInt(price, 10) });
            setName("");
            setPrice("");
          } catch (err: any) {
            setError(err?.message ?? "新增失敗");
          }
        }}
      >
        <input className="input" placeholder="書名（例如：化學（上））" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as any)}>
          {Object.entries(BOOK_KIND_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          className="input"
          placeholder="定價"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
        />
        <button className="btn-primary" type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? "新增中..." : "新增"}
        </button>
      </form>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>書名</th>
              <th>種類</th>
              <th>定價</th>
              <th>狀態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(listQuery.data ?? []).map((b) => (
              <tr key={b.id} className={b.isActive ? "" : "opacity-50"}>
                <td>{b.name}</td>
                <td>
                  <select
                    className="input !w-28"
                    value={b.kind}
                    onChange={(e) => updateMutation.mutate({ id: b.id, kind: e.target.value as any })}
                  >
                    {Object.entries(BOOK_KIND_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="input !w-28"
                    inputMode="numeric"
                    defaultValue={b.price}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value.replace(/[^\d]/g, "") || "0", 10);
                      if (v !== b.price) updateMutation.mutate({ id: b.id, price: v });
                    }}
                  />
                </td>
                <td>{b.isActive ? "販售中" : "已停售"}</td>
                <td className="whitespace-nowrap space-x-2">
                  <button className="btn-secondary" onClick={() => updateMutation.mutate({ id: b.id, isActive: !b.isActive })}>
                    {b.isActive ? "停售" : "恢復販售"}
                  </button>
                  <button className="btn-danger" onClick={() => confirm(`確定刪除「${b.name}」？已入帳的記錄不受影響。`) && deleteMutation.mutate({ id: b.id })}>
                    刪除
                  </button>
                </td>
              </tr>
            ))}
            {listQuery.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-6">
                  尚未設定書籍
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function CouponsAdmin() {
  const utils = trpc.useUtils();
  const listQuery = trpc.coupons.list.useQuery();
  const onSuccess = () => utils.coupons.list.invalidate();
  const createMutation = trpc.coupons.create.useMutation({ onSuccess });
  const updateMutation = trpc.coupons.update.useMutation({ onSuccess });
  const deleteMutation = trpc.coupons.delete.useMutation({ onSuccess });
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Section title="優惠碼管理">
      <p className="text-xs text-slate-500">
        跟 Leviax 官網「定價與優惠」的優惠碼對應。記帳收入選「書籍」時可以選優惠碼，系統會依折扣比例算出實收金額。
        官網新增或停用優惠碼時，這裡也要同步調整。
      </p>
      <form
        className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const p = parseFloat(percent);
          if (!code.trim() || !(p > 0)) return setError("請填優惠碼和折扣 %");
          try {
            await createMutation.mutateAsync({ code, discountPercent: p, validUntil: validUntil || null });
            setCode("");
            setPercent("");
            setValidUntil("");
          } catch (err: any) {
            setError(err?.message ?? "新增失敗");
          }
        }}
      >
        <input className="input" placeholder="優惠碼（例如 LEVIAX001）" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <input className="input" placeholder="折扣 %（例如 5）" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
        <div>
          <label className="label">到期日（不填＝不限期）</label>
          <input className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
        <button className="btn-primary" type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? "新增中..." : "新增"}
        </button>
      </form>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>優惠碼</th>
              <th>折扣</th>
              <th>到期日</th>
              <th>狀態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(listQuery.data ?? []).map((c) => {
              const expired = !!c.validUntil && c.validUntil < today;
              return (
                <tr key={c.id} className={c.isActive && !expired ? "" : "opacity-50"}>
                  <td className="font-mono">{c.code}</td>
                  <td>{Math.round(c.discountRate * 1000) / 10}%</td>
                  <td>{c.validUntil ?? "不限期"}</td>
                  <td>{!c.isActive ? "已停用" : expired ? "已過期" : "啟用中"}</td>
                  <td className="whitespace-nowrap space-x-2">
                    <button className="btn-secondary" onClick={() => updateMutation.mutate({ id: c.id, isActive: !c.isActive })}>
                      {c.isActive ? "停用" : "啟用"}
                    </button>
                    <button className="btn-danger" onClick={() => confirm(`確定刪除優惠碼 ${c.code}？`) && deleteMutation.mutate({ id: c.id })}>
                      刪除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ExpenseTypesAdmin() {
  const utils = trpc.useUtils();
  const listQuery = trpc.expenseTypes.list.useQuery();
  const teachersQuery = trpc.teachers.list.useQuery();
  const salespeopleQuery = trpc.salespeople.list.useQuery();
  const createMutation = trpc.expenseTypes.create.useMutation({ onSuccess: () => utils.expenseTypes.list.invalidate() });
  const deleteMutation = trpc.expenseTypes.delete.useMutation({ onSuccess: () => utils.expenseTypes.list.invalidate() });
  const [name, setName] = useState("");

  return (
    <Section title="支出類型管理">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await createMutation.mutateAsync({ name });
          setName("");
        }}
      >
        <input className="input" placeholder="支出類型名稱（一般支出，非薪水）" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" type="submit">
          新增
        </button>
      </form>
      <ul className="divide-y divide-slate-100">
        {(listQuery.data ?? []).map((e) => {
          const teacherName = teachersQuery.data?.find((t) => t.id === e.teacherId)?.name;
          const salespersonName = salespeopleQuery.data?.find((s) => s.id === e.salespersonId)?.name;
          return (
            <li key={e.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {e.name}
                {teacherName && <span className="text-slate-400">（教師薪水：{teacherName}）</span>}
                {salespersonName && <span className="text-slate-400">（推銷者薪水：{salespersonName}）</span>}
              </span>
              <button className="btn-danger" onClick={() => confirm(`確定刪除支出類型「${e.name}」？`) && deleteMutation.mutate({ id: e.id })}>
                刪除
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function IncomeTypesAdmin() {
  const utils = trpc.useUtils();
  const listQuery = trpc.incomeTypes.list.useQuery();
  const createMutation = trpc.incomeTypes.create.useMutation({ onSuccess: () => utils.incomeTypes.list.invalidate() });
  const deleteMutation = trpc.incomeTypes.delete.useMutation({ onSuccess: () => utils.incomeTypes.list.invalidate() });
  const [name, setName] = useState("");

  return (
    <Section title="收入類型管理（其他收入，不含課程）">
      <p className="text-xs text-slate-500">
        課程收入固定走「課程收入分潤精靈」，這裡管理的是課程以外的其他收入項目（例如：贊助、場地租借、周邊商品銷售…），在母記帳表新增收入時選「其他收入」就會用到這份清單。
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await createMutation.mutateAsync({ name });
          setName("");
        }}
      >
        <input className="input" placeholder="收入類型名稱" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" type="submit">
          新增
        </button>
      </form>
      <ul className="divide-y divide-slate-100">
        {(listQuery.data ?? []).map((i) => (
          <li key={i.id} className="flex items-center justify-between py-2 text-sm">
            <span>{i.name}</span>
            <button className="btn-danger" onClick={() => confirm(`確定刪除收入類型「${i.name}」？`) && deleteMutation.mutate({ id: i.id })}>
              刪除
            </button>
          </li>
        ))}
        {listQuery.data?.length === 0 && <li className="text-sm text-slate-400 py-2">尚未設定其他收入類型</li>}
      </ul>
    </Section>
  );
}

function UsersAdmin() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const listQuery = trpc.users.list.useQuery(undefined, { enabled: user?.role === "super_admin" });
  const teachersQuery = trpc.teachers.list.useQuery();
  const salespeopleQuery = trpc.salespeople.list.useQuery();
  const createMutation = trpc.users.create.useMutation({ onSuccess: () => utils.users.list.invalidate() });
  const updateMutation = trpc.users.updateRole.useMutation({ onSuccess: () => utils.users.list.invalidate() });
  const deleteMutation = trpc.users.delete.useMutation({ onSuccess: () => utils.users.list.invalidate() });

  const [form, setForm] = useState({ email: "", password: "", name: "", role: "finance_staff" as string, linkedTeacherId: "", linkedSalespersonId: "" });
  const [error, setError] = useState<string | null>(null);

  if (user?.role !== "super_admin") {
    return <Section title="帳號與權限管理">僅系統管理員可使用此功能。</Section>;
  }

  return (
    <Section title="帳號與權限管理">
      <form
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2 items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const email = toHalfWidth(form.email);
          try {
            await createMutation.mutateAsync({
              email,
              password: form.password,
              name: form.name,
              role: form.role as any,
              linkedTeacherId: form.linkedTeacherId ? Number(form.linkedTeacherId) : null,
              linkedSalespersonId: form.linkedSalespersonId ? Number(form.linkedSalespersonId) : null,
            });
            setForm({ email: "", password: "", name: "", role: "finance_staff", linkedTeacherId: "", linkedSalespersonId: "" });
          } catch (err: any) {
            setError(err?.message ?? "新增失敗");
          }
        }}
      >
        <input
          className="input"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          onBlur={(e) => setForm((f) => ({ ...f, email: toHalfWidth(e.target.value) }))}
          required
        />
        <input
          className="input"
          placeholder="密碼（至少6碼）"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <input className="input" placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {form.role === "teacher_self" && (
          <select className="input" value={form.linkedTeacherId} onChange={(e) => setForm({ ...form, linkedTeacherId: e.target.value })}>
            <option value="">綁定教師</option>
            {teachersQuery.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {form.role === "salesperson_self" && (
          <select className="input" value={form.linkedSalespersonId} onChange={(e) => setForm({ ...form, linkedSalespersonId: e.target.value })}>
            <option value="">綁定推銷者</option>
            {salespeopleQuery.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn-primary" type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? "新增中..." : "新增帳號"}
        </button>
      </form>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      {deleteMutation.error && (
        <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{deleteMutation.error.message}</div>
      )}

      <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>姓名</th>
            <th>角色</th>
            <th>狀態</th>
            <th>操作</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(listQuery.data ?? []).map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.name}</td>
              <td>
                <select
                  className="input !w-40"
                  value={u.role}
                  onChange={(e) => updateMutation.mutate({ id: u.id, role: e.target.value as any })}
                >
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </td>
              <td>{u.isActive ? "啟用" : "停用"}</td>
              <td>
                <button className="btn-secondary" onClick={() => updateMutation.mutate({ id: u.id, role: u.role as any, isActive: !u.isActive })}>
                  {u.isActive ? "停用" : "啟用"}
                </button>
              </td>
              <td>
                <button
                  className="btn-danger"
                  disabled={u.id === user.id || deleteMutation.isPending}
                  title={u.id === user.id ? "不能刪除自己目前登入中的帳號" : undefined}
                  onClick={() => confirm(`確定要刪除帳號「${u.name}（${u.email}）」？此動作無法復原。`) && deleteMutation.mutate({ id: u.id })}
                >
                  刪除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Section>
  );
}

function RevenueSettingsAdmin() {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.revenueSettings.get.useQuery();
  const teachersQuery = trpc.teachers.list.useQuery();
  const salespeopleQuery = trpc.salespeople.list.useQuery();

  const updateMutation = trpc.revenueSettings.update.useMutation({ onSuccess: () => utils.revenueSettings.get.invalidate() });
  const addMemberMutation = trpc.revenueSettings.addTeamMember.useMutation({ onSuccess: () => utils.revenueSettings.get.invalidate() });
  const removeMemberMutation = trpc.revenueSettings.removeTeamMember.useMutation({ onSuccess: () => utils.revenueSettings.get.invalidate() });

  const [form, setForm] = useState({
    baseDiscountPercent: "60",
    couponDiscount: "750",
    referralBonus: "500",
    platformFeeRatePercent: "20",
    teamBonusRatePercent: "16.667",
    materialCost: "300",
    monthlySubscription: "350",
    estimatedMonthlySales: "30",
    tutoringReserveRatePercent: "10",
  });
  const [newMemberType, setNewMemberType] = useState<"teacher" | "salesperson">("teacher");
  const [newMemberId, setNewMemberId] = useState<number | "">("");

  useEffect(() => {
    if (!settingsQuery.data) return;
    const s = settingsQuery.data.settings;
    setForm({
      baseDiscountPercent: String(Math.round(s.baseDiscount * 100 * 1000) / 1000),
      couponDiscount: String(s.couponDiscount),
      referralBonus: String(s.referralBonus),
      platformFeeRatePercent: String(Math.round(s.platformFeeRate * 100 * 1000) / 1000),
      teamBonusRatePercent: String(Math.round(s.teamBonusRate * 100 * 1000) / 1000),
      materialCost: String(s.materialCost),
      monthlySubscription: String(s.monthlySubscription),
      estimatedMonthlySales: String(s.estimatedMonthlySales),
      tutoringReserveRatePercent: String(Math.round((s.tutoringReserveRate ?? 0.1) * 100 * 1000) / 1000),
    });
  }, [settingsQuery.data]);

  const teacherOptions = (teachersQuery.data ?? []).map((t) => ({ id: t.id, name: t.name }));
  const salespersonOptions = (salespeopleQuery.data ?? []).map((s) => ({ id: s.id, name: s.name }));
  const memberOptions = newMemberType === "teacher" ? teacherOptions : salespersonOptions;

  function nameOf(type: "teacher" | "salesperson", id: number) {
    const list = type === "teacher" ? teacherOptions : salespersonOptions;
    return list.find((p) => p.id === id)?.name ?? `#${id}`;
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    await updateMutation.mutateAsync({
      baseDiscountPercent: parseFloat(form.baseDiscountPercent || "0"),
      couponDiscount: parseInt(form.couponDiscount || "0", 10),
      referralBonus: parseInt(form.referralBonus || "0", 10),
      platformFeeRatePercent: parseFloat(form.platformFeeRatePercent || "0"),
      teamBonusRatePercent: parseFloat(form.teamBonusRatePercent || "0"),
      materialCost: parseInt(form.materialCost || "0", 10),
      monthlySubscription: parseInt(form.monthlySubscription || "0", 10),
      estimatedMonthlySales: parseInt(form.estimatedMonthlySales || "1", 10),
      tutoringReserveRatePercent: parseFloat(form.tutoringReserveRatePercent || "0"),
    });
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (newMemberId === "") return;
    await addMemberMutation.mutateAsync({ recipientType: newMemberType, recipientId: Number(newMemberId) });
    setNewMemberId("");
  }

  return (
    <div className="space-y-6">
      <Section title="分潤參數">
        <p className="text-xs text-slate-500">
          對照《課程分潤與成本結構辦法》的可調整參數，改完按「儲存設定」後，之後每一筆用「課程收入分潤精靈」入帳的課程都會用新的數字計算。
        </p>
        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="label">目前基礎折數（1 年期，單位：%，例如 60 代表 6 折）</label>
            <input
              className="input"
              inputMode="decimal"
              value={form.baseDiscountPercent}
              onChange={(e) => setForm({ ...form, baseDiscountPercent: e.target.value })}
            />
            <p className="text-xs text-slate-400 mt-1">2 年期自動 +10（+1 折）、3 年期自動 +20（+2 折），超過 100 一樣照算（110 = 原價 ×1.1）。</p>
          </div>
          <div>
            <label className="label">優惠碼折抵金額</label>
            <input
              className="input"
              inputMode="numeric"
              value={form.couponDiscount}
              onChange={(e) => setForm({ ...form, couponDiscount: e.target.value.replace(/[^\d]/g, "") })}
            />
          </div>
          <div>
            <label className="label">推廣/行銷抽成金額</label>
            <input
              className="input"
              inputMode="numeric"
              value={form.referralBonus}
              onChange={(e) => setForm({ ...form, referralBonus: e.target.value.replace(/[^\d]/g, "") })}
            />
          </div>
          <div>
            <label className="label">平台費比例（%）</label>
            <input
              className="input"
              inputMode="decimal"
              value={form.platformFeeRatePercent}
              onChange={(e) => setForm({ ...form, platformFeeRatePercent: e.target.value })}
            />
          </div>
          <div>
            <label className="label">每人團隊獎金比例（%）</label>
            <input
              className="input"
              inputMode="decimal"
              value={form.teamBonusRatePercent}
              onChange={(e) => setForm({ ...form, teamBonusRatePercent: e.target.value })}
            />
          </div>
          <div>
            <label className="label">教材/物流成本（每套）</label>
            <input
              className="input"
              inputMode="numeric"
              value={form.materialCost}
              onChange={(e) => setForm({ ...form, materialCost: e.target.value.replace(/[^\d]/g, "") })}
            />
          </div>
          <div>
            <label className="label">網站訂閱費（每月）</label>
            <input
              className="input"
              inputMode="numeric"
              value={form.monthlySubscription}
              onChange={(e) => setForm({ ...form, monthlySubscription: e.target.value.replace(/[^\d]/g, "") })}
            />
          </div>
          <div>
            <label className="label">預估月銷量（套）</label>
            <input
              className="input"
              inputMode="numeric"
              value={form.estimatedMonthlySales}
              onChange={(e) => setForm({ ...form, estimatedMonthlySales: e.target.value.replace(/[^\d]/g, "") })}
            />
          </div>
          <div>
            <label className="label">小班家教留給公積金的比例（%）</label>
            <input
              className="input"
              inputMode="decimal"
              value={form.tutoringReserveRatePercent}
              onChange={(e) => setForm({ ...form, tutoringReserveRatePercent: e.target.value })}
            />
            <p className="text-xs text-slate-400 mt-1">小班家教實收金額扣掉這個比例後，全部給主理教師。</p>
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "儲存中..." : "儲存設定"}
            </button>
          </div>
        </form>
      </Section>

      <Section title="團隊獎金固定名單（例如：老闆、行銷、技術）">
        <p className="text-xs text-slate-500">
          這份名單裡的每一位，都會在每次用分潤精靈入帳課程收入時，各自拿到「平台費 × 每人團隊獎金比例（無條件進位）」。
        </p>
        <form onSubmit={handleAddMember} className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="label">身份</label>
            <select
              className="input !w-32"
              value={newMemberType}
              onChange={(e) => {
                setNewMemberType(e.target.value as "teacher" | "salesperson");
                setNewMemberId("");
              }}
            >
              <option value="teacher">教師</option>
              <option value="salesperson">推銷者</option>
            </select>
          </div>
          <div className="w-48">
            <label className="label">人員</label>
            <SearchableSelect options={memberOptions} value={newMemberId} onChange={(id) => setNewMemberId(id)} placeholder="搜尋姓名..." />
          </div>
          <button className="btn-primary" type="submit" disabled={addMemberMutation.isPending}>
            新增至名單
          </button>
        </form>
        <ul className="divide-y divide-slate-100">
          {(settingsQuery.data?.members ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {m.recipientType === "teacher" ? "教師" : "推銷者"} · {nameOf(m.recipientType as any, m.recipientId)}
              </span>
              <button className="btn-danger" onClick={() => removeMemberMutation.mutate({ id: m.id })}>
                移除
              </button>
            </li>
          ))}
          {settingsQuery.data?.members.length === 0 && <li className="text-sm text-slate-400 py-2">尚未設定團隊獎金名單</li>}
        </ul>
      </Section>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("teachers");
  const tabs: { key: Tab; label: string }[] = [
    { key: "teachers", label: "教師管理" },
    { key: "salespeople", label: "推銷者管理" },
    { key: "courses", label: "課程管理" },
    { key: "books", label: "書籍管理" },
    { key: "coupons", label: "優惠碼管理" },
    { key: "expenseTypes", label: "支出類型管理" },
    { key: "incomeTypes", label: "收入類型管理" },
    { key: "revenue", label: "分潤設定" },
    { key: "users", label: "帳號與權限" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">管理面板</h1>
      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "btn-primary" : "btn-secondary"}
            onClick={() => setTab(t.key)}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "teachers" && <TeachersAdmin />}
      {tab === "salespeople" && <SalespeopleAdmin />}
      {tab === "courses" && <CoursesAdmin />}
      {tab === "books" && <BooksAdmin />}
      {tab === "coupons" && <CouponsAdmin />}
      {tab === "expenseTypes" && <ExpenseTypesAdmin />}
      {tab === "incomeTypes" && <IncomeTypesAdmin />}
      {tab === "revenue" && <RevenueSettingsAdmin />}
      {tab === "users" && <UsersAdmin />}
    </div>
  );
}
