import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth, ROLE_LABELS } from "../lib/auth";
import SearchableSelect from "../components/SearchableSelect";
import { toHalfWidth } from "../lib/textNormalize";
import RecurringAdmin from "../components/RecurringAdmin";
import { useSearchParams } from "react-router-dom";

type Tab = "requests" | "teachers" | "salespeople" | "shippers" | "expenseTypes" | "incomeTypes" | "users" | "revenue" | "recurring" | "line";

const BOOK_KIND_LABELS: Record<string, string> = { book: "講義", workbook: "刷題本", bundle: "組合包", notebook: "筆記本" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-4">
      <h2 className="font-medium text-brand-700">{title}</h2>
      {children}
    </div>
  );
}

const REQUESTED_LABELS: Record<string, string> = { teacher: "老師", salesperson: "推銷員", shipper: "出貨員", other: "其他" };
const REQUESTED_TO_ROLE: Record<string, string> = { teacher: "teacher_self", salesperson: "salesperson_self", shipper: "shipper_self", other: "finance_staff" };
const STATUS_LABELS: Record<string, string> = { pending: "待處理", approved: "已核准", rejected: "已拒絕" };

/** 一筆待處理申請：選角色、綁定的人（或新增），核准／拒絕 */
function RequestRow({ req, onDone }: { req: any; onDone: () => void }) {
  const teachersQuery = trpc.teachers.list.useQuery();
  const salespeopleQuery = trpc.salespeople.list.useQuery();
  const shippersQuery = trpc.shippers.list.useQuery();
  const approve = trpc.accountRequests.approve.useMutation({ onSuccess: onDone });
  const reject = trpc.accountRequests.reject.useMutation({ onSuccess: onDone });
  const [role, setRole] = useState(REQUESTED_TO_ROLE[req.requestedRole] ?? "finance_staff");
  const [linked, setLinked] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const people =
    role === "teacher_self" ? teachersQuery.data : role === "salesperson_self" ? salespeopleQuery.data : role === "shipper_self" ? shippersQuery.data : null;
  const kindLabel = role === "teacher_self" ? "教師" : role === "salesperson_self" ? "推銷者" : "出貨員";
  // 名單裡有同名的人就預設選他，沒有就預設「新增」
  const sameName = people?.find((p: any) => p.name === req.name);
  const linkedValue = linked || (people ? (sameName ? String(sameName.id) : "new") : "");

  async function handleApprove() {
    setError(null);
    try {
      await approve.mutateAsync({
        id: req.id,
        role: role as any,
        linkedId: people && linkedValue !== "new" ? Number(linkedValue) : undefined,
        newPersonName: people && linkedValue === "new" ? req.name : undefined,
      });
    } catch (err: any) {
      setError(err?.message ?? "核准失敗");
    }
  }

  return (
    <li className="py-3 space-y-2">
      <div className="text-sm">
        <b>{req.name}</b>（{req.email}）
        <span className="ml-2 text-slate-500">申請身分：{REQUESTED_LABELS[req.requestedRole] ?? req.requestedRole}</span>
        {req.note && <span className="ml-2 text-slate-500">備註：{req.note}</span>}
        <span className="ml-2 text-xs text-slate-400">{new Date(req.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input !w-40"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setLinked("");
          }}
        >
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {people && (
          <select className="input !w-56" value={linkedValue} onChange={(e) => setLinked(e.target.value)}>
            <option value="new">新增{kindLabel}「{req.name}」</option>
            {people.map((p: any) => (
              <option key={p.id} value={p.id}>
                綁定：{p.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn-primary" type="button" disabled={approve.isPending} onClick={handleApprove}>
          核准
        </button>
        <button
          className="btn-danger"
          type="button"
          disabled={reject.isPending}
          onClick={() => confirm(`拒絕 ${req.name} 的申請？`) && reject.mutate({ id: req.id })}
        >
          拒絕
        </button>
      </div>
      {role === "super_admin" && <div className="text-xs text-red-600">系統管理員可以看到並修改所有帳目，確定要給嗎？</div>}
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
    </li>
  );
}

function AccountRequestsAdmin() {
  const utils = trpc.useUtils();
  const listQuery = trpc.accountRequests.list.useQuery();
  const deleteMutation = trpc.accountRequests.delete.useMutation({ onSuccess: () => utils.accountRequests.invalidate() });
  const onDone = () => {
    utils.accountRequests.invalidate();
    utils.users.list.invalidate();
    utils.teachers.list.invalidate();
    utils.salespeople.list.invalidate();
    utils.shippers.list.invalidate();
  };
  const all = listQuery.data ?? [];
  const pending = all.filter((r) => r.status === "pending");
  const done = all.filter((r) => r.status !== "pending");

  return (
    <Section title="帳號申請">
      <p className="text-xs text-slate-500">
        沒有帳號的人用 Google 登入時會填申請（姓名、身分、備註），LINE 會通知你。核准時決定角色：教師本人、推銷者本人、出貨員都只看得到自己的資料，而且一定要綁定一個人（名單裡沒有可以直接新增）。核准後對方再用 Google 登入一次就能用。
      </p>
      {pending.length === 0 ? (
        <div className="text-sm text-slate-400">目前沒有待處理的申請</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {pending.map((r) => (
            <RequestRow key={r.id} req={r} onDone={onDone} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">已處理的申請（{done.length}）</summary>
          <ul className="divide-y divide-slate-100 mt-2">
            {done.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {r.name}（{r.email}）
                  <span className={r.status === "approved" ? "text-emerald-600 ml-2" : "text-red-600 ml-2"}>{STATUS_LABELS[r.status]}</span>
                </span>
                {r.status === "rejected" && (
                  <button className="btn-secondary" type="button" onClick={() => deleteMutation.mutate({ id: r.id })}>
                    刪除紀錄（讓他可以重新申請）
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
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

function ShippersAdmin() {
  const utils = trpc.useUtils();
  const listQuery = trpc.shippers.list.useQuery();
  const categoriesQuery = trpc.advancePayments.categories.useQuery();
  const createMutation = trpc.shippers.create.useMutation({ onSuccess: () => utils.shippers.list.invalidate() });
  const updateMutation = trpc.shippers.update.useMutation({ onSuccess: () => utils.shippers.list.invalidate() });
  const deleteMutation = trpc.shippers.delete.useMutation({ onSuccess: () => utils.shippers.list.invalidate() });
  const addCategory = trpc.advancePayments.addCategory.useMutation({ onSuccess: () => utils.advancePayments.categories.invalidate() });
  const deleteCategory = trpc.advancePayments.deleteCategory.useMutation({ onSuccess: () => utils.advancePayments.categories.invalidate() });
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Section title="出貨員管理">
        <p className="text-xs text-slate-500">
          出貨員登入後只看得到「我的代墊」：可以新增自己的代墊（運費等），修改、刪除自己還沒核銷的，看不到帳本和其他人的資料。新增出貨員後，到「帳號與權限」新增他的 Gmail、角色選「出貨員」並綁定。
        </p>
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
          <input className="input" placeholder="出貨員姓名" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary" type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "新增中..." : "新增"}
          </button>
        </form>
        {(error || deleteMutation.error) && (
          <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error ?? deleteMutation.error?.message}</div>
        )}
        <ul className="divide-y divide-slate-100">
          {(listQuery.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className={s.isActive ? "" : "text-slate-400"}>
                {s.name}
                {!s.isActive && "（停用）"}
              </span>
              <span className="flex gap-2">
                <button className="btn-secondary" onClick={() => updateMutation.mutate({ id: s.id, isActive: !s.isActive })}>
                  {s.isActive ? "停用" : "啟用"}
                </button>
                <button className="btn-danger" onClick={() => confirm(`確定刪除出貨員「${s.name}」？`) && deleteMutation.mutate({ id: s.id })}>
                  刪除
                </button>
              </span>
            </li>
          ))}
          {listQuery.data?.length === 0 && <li className="text-sm text-slate-400 py-2">還沒有出貨員</li>}
        </ul>
      </Section>
      <Section title="代墊類別">
        <p className="text-xs text-slate-500">填代墊時選的類別。出貨員填代墊時也可以直接打新類別；出貨員的代墊核銷時，會照類別記成帳本的支出（「其他」記成「其他支出」）。</p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!category.trim()) return;
            await addCategory.mutateAsync({ name: category });
            setCategory("");
          }}
        >
          <input className="input" placeholder="類別名稱" value={category} onChange={(e) => setCategory(e.target.value)} />
          <button className="btn-primary" type="submit">
            新增
          </button>
        </form>
        <ul className="divide-y divide-slate-100">
          {(categoriesQuery.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2 text-sm">
              <span>{c.name}</span>
              <button className="btn-danger" onClick={() => confirm(`確定刪除類別「${c.name}」？（已經填過的代墊不受影響）`) && deleteCategory.mutate({ id: c.id })}>
                刪除
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
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
        課程收入固定走「課程收入分潤精靈」，這裡管理的是課程以外的其他收入項目（例如：贊助、場地租借、周邊商品銷售…），在帳本新增收入時選「其他收入」就會用到這份清單。
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
  const shippersQuery = trpc.shippers.list.useQuery();
  const createMutation = trpc.users.create.useMutation({ onSuccess: () => utils.users.list.invalidate() });
  const updateMutation = trpc.users.updateRole.useMutation({ onSuccess: () => utils.users.list.invalidate() });
  const deleteMutation = trpc.users.delete.useMutation({ onSuccess: () => utils.users.list.invalidate() });

  const [form, setForm] = useState({ email: "", name: "", role: "finance_staff" as string, linkedTeacherId: "", linkedSalespersonId: "", linkedShipperId: "" });
  const [error, setError] = useState<string | null>(null);

  if (user?.role !== "super_admin") {
    return <Section title="帳號與權限管理">僅系統管理員可使用此功能。</Section>;
  }

  return (
    <Section title="帳號與權限管理">
      <p className="text-xs text-slate-500">
        大家都用 Google 登入，新增帳號只要填他的 Gmail，不用設密碼。記得也要在 Google Cloud 把這個 Gmail 加進「測試使用者」，他才登得進來。
      </p>
      <form
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2 items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const email = toHalfWidth(form.email);
          try {
            await createMutation.mutateAsync({
              email,
              name: form.name,
              role: form.role as any,
              linkedTeacherId: form.linkedTeacherId ? Number(form.linkedTeacherId) : null,
              linkedSalespersonId: form.linkedSalespersonId ? Number(form.linkedSalespersonId) : null,
              linkedShipperId: form.linkedShipperId ? Number(form.linkedShipperId) : null,
            });
            setForm({ email: "", name: "", role: "finance_staff", linkedTeacherId: "", linkedSalespersonId: "", linkedShipperId: "" });
          } catch (err: any) {
            setError(err?.message ?? "新增失敗");
          }
        }}
      >
        <input
          className="input"
          placeholder="Gmail"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          onBlur={(e) => setForm((f) => ({ ...f, email: toHalfWidth(e.target.value) }))}
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
        {form.role === "shipper_self" && (
          <select className="input" value={form.linkedShipperId} onChange={(e) => setForm({ ...form, linkedShipperId: e.target.value })} required>
            <option value="">綁定出貨員</option>
            {shippersQuery.data?.map((s) => (
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
                {u.role === "shipper_self" && (
                  <select
                    className="input !w-40 mt-1"
                    value={u.linkedShipperId ?? ""}
                    onChange={(e) => updateMutation.mutate({ id: u.id, role: "shipper_self", linkedShipperId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">綁定出貨員</option>
                    {shippersQuery.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
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
  const recalcMutation = trpc.revenueSettings.recalcBookShares.useMutation({ onSuccess: () => utils.invalidate() });
  const [form, setForm] = useState({ reserveRatePercent: "10", adminFeeRatePercent: "10", bookReserveRatePercent: "25" });
  const [msg, setMsg] = useState<string | null>(null);

  const pct = (r: number) => String(Math.round(r * 100 * 1000) / 1000);
  useEffect(() => {
    if (!settingsQuery.data) return;
    const s = settingsQuery.data.settings;
    setForm({ reserveRatePercent: pct(s.reserveRate), adminFeeRatePercent: pct(s.adminFeeRate), bookReserveRatePercent: pct(s.bookReserveRate) });
  }, [settingsQuery.data]);

  const members = settingsQuery.data?.members ?? [];
  const nameOf = (m: any) =>
    ((m.recipientType === "teacher" ? teachersQuery.data : salespeopleQuery.data) ?? []).find((p: any) => p.id === m.recipientId)?.name ?? `#${m.recipientId}`;
  const reserve = parseFloat(form.reserveRatePercent || "0");
  const admin = parseFloat(form.adminFeeRatePercent || "0");
  const bookReserve = parseFloat(form.bookReserveRatePercent || "0");
  const rest = (r: number) => Math.round((100 - r - admin) * 1000) / 1000;

  /** 書籍公積金比例改了：先列出舊帳會改哪些，確認後才重算 */
  async function askRecalc() {
    const preview = await recalcMutation.mutateAsync({ dryRun: true });
    if (!preview.changes.length) return "已儲存；舊帳的書籍分潤已經是這個比例，不用重算。";
    const ok = window.confirm(
      `書籍公積金改成 ${bookReserve}%。要把舊帳的書籍分潤一起重算嗎？

` +
        `會改 ${preview.changes.length} 項，老師分潤合計 ${preview.diff > 0 ? "+" : ""}${preview.diff.toLocaleString()} 元（差額${preview.diff < 0 ? "回到" : "從"}公積金）。

` +
        `按「取消」只改以後新記的帳。`
    );
    if (!ok) return "已儲存；舊帳沒有重算，只有以後新記的書籍照新比例。";
    const r = await recalcMutation.mutateAsync({ dryRun: false });
    return `已儲存，並重算舊帳 ${r.changes.length} 項書籍分潤（老師分潤合計 ${r.diff > 0 ? "+" : ""}${r.diff.toLocaleString()} 元）。`;
  }

  return (
    <Section title="分潤設定">
      <div className="text-sm text-slate-600 space-y-1">
        <p>線上課程：公積金 {reserve}%＋行政費 {admin}%（依權重分配），其餘 {rest(reserve)}% 給主理老師。</p>
        <p>書籍：公積金 {bookReserve}%＋行政費 {admin}%，其餘 {rest(bookReserve)}% 依科目給該科老師。行事曆：全部留公積金。</p>
        <p>小班家教、試上：公積金 {reserve}%＋行政費 {admin}%，其餘 {rest(reserve)}% 給主理老師。</p>
      </div>
      <form
        className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          const before = settingsQuery.data?.settings;
          try {
            await updateMutation.mutateAsync({ reserveRatePercent: reserve, adminFeeRatePercent: admin, bookReserveRatePercent: bookReserve });
            const bookChanged = before && Math.abs(before.bookReserveRate * 100 - bookReserve) > 1e-9;
            const adminChanged = before && Math.abs(before.adminFeeRate * 100 - admin) > 1e-9;
            if (bookChanged && !adminChanged) setMsg(await askRecalc());
            else if (adminChanged) setMsg("已儲存；行政費比例只套用在以後新記的帳，舊帳不回頭重算。");
            else setMsg("已儲存");
          } catch (err: any) {
            setMsg(err?.message ?? "儲存失敗");
          }
        }}
      >
        <div>
          <label className="label">公積金比例（%）</label>
          <input className="input" inputMode="decimal" value={form.reserveRatePercent} onChange={(e) => setForm({ ...form, reserveRatePercent: e.target.value })} />
        </div>
        <div>
          <label className="label">書籍公積金比例（%）</label>
          <input className="input" inputMode="decimal" value={form.bookReserveRatePercent} onChange={(e) => setForm({ ...form, bookReserveRatePercent: e.target.value })} />
        </div>
        <div>
          <label className="label">行政費比例（%，依權重分配）</label>
          <input className="input" inputMode="decimal" value={form.adminFeeRatePercent} onChange={(e) => setForm({ ...form, adminFeeRatePercent: e.target.value })} />
        </div>
        <button className="btn-primary" type="submit" disabled={updateMutation.isPending || recalcMutation.isPending}>
          {updateMutation.isPending || recalcMutation.isPending ? "儲存中..." : "儲存"}
        </button>
      </form>
      {msg && <div className="text-sm text-slate-600">{msg}</div>}
      <p className="text-xs text-slate-400">行政費依權重分給：{members.map((m: any) => `${nameOf(m)} ${m.weight}`).join("、") || "（沒有名單）"}（名單固定，不在這裡修改）</p>
    </Section>
  );
}

function LineNotifyAdmin() {
  const status = trpc.notify.status.useQuery();
  const test = trpc.notify.test.useMutation();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Section title="LINE 通知">
      <div className="text-sm text-slate-600 space-y-1">
        <p>設定好之後，LINE 官方帳號會傳這些通知給你：</p>
        <ul className="list-disc pl-5">
          <li>官網有新訂單、訂單狀態改變（例如待付款 → 已付款）時，馬上通知</li>
          <li>每天早上 9 點：自動記了哪些定期收支、帳務檢查有沒有問題、官網訂單有沒有對不上、待付款超過 3 天的訂單（沒事就不傳）</li>
        </ul>
      </div>
      <div className="text-sm">
        目前狀態：
        {status.data?.configured ? <span className="text-emerald-600 font-medium">已設定</span> : <span className="text-amber-600 font-medium">還沒設定</span>}
      </div>
      {!status.data?.configured && (
        <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 space-y-1">
          <p>設定方式（金鑰不放在畫面上，要在電腦的 PowerShell 設定）：</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>LINE Developers → 澈點科學的 Messaging API channel → Messaging API 分頁，複製 Channel access token</li>
            <li>同一個 channel 的 Basic settings 分頁最下面，複製「Your user ID」（U 開頭）</li>
            <li>
              在記帳系統資料夾執行 <code>npx.cmd wrangler secret put LINE_CHANNEL_ACCESS_TOKEN</code>，貼上 token；再執行{" "}
              <code>npx.cmd wrangler secret put LINE_NOTIFY_TO</code>，貼上 user ID（多人用逗號分開）
            </li>
            <li>回到這頁按「傳測試訊息」</li>
          </ol>
        </div>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={test.isPending}
        onClick={async () => {
          setMsg(null);
          try {
            await test.mutateAsync();
            setMsg("已傳出，去 LINE 看看有沒有收到");
          } catch (e: any) {
            setMsg(e?.message ?? "傳送失敗");
          }
        }}
      >
        傳測試訊息
      </button>
      {msg && <div className="text-sm text-slate-600">{msg}</div>}
    </Section>
  );
}

export default function AdminPage() {
  const [params] = useSearchParams();
  const pendingQuery = trpc.accountRequests.pendingCount.useQuery();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "teachers");
  const pending = pendingQuery.data ?? 0;
  const tabs: { key: Tab; label: string }[] = [
    { key: "requests", label: pending ? `帳號申請（${pending}）` : "帳號申請" },
    { key: "teachers", label: "教師管理" },
    { key: "salespeople", label: "推銷者管理" },
    { key: "shippers", label: "出貨員與代墊類別" },
    { key: "expenseTypes", label: "支出類型管理" },
    { key: "incomeTypes", label: "收入類型管理" },
    { key: "revenue", label: "分潤設定" },
    { key: "recurring", label: "定期收支" },
    { key: "line", label: "LINE 通知" },
    { key: "users", label: "帳號與權限" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl text-brand-700">管理面板</h1>
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
      {tab === "requests" && <AccountRequestsAdmin />}
      {tab === "teachers" && <TeachersAdmin />}
      {tab === "salespeople" && <SalespeopleAdmin />}
      {tab === "shippers" && <ShippersAdmin />}
      {tab === "expenseTypes" && <ExpenseTypesAdmin />}
      {tab === "incomeTypes" && <IncomeTypesAdmin />}
      {tab === "revenue" && <RevenueSettingsAdmin />}
      {tab === "recurring" && <RecurringAdmin />}
      {tab === "line" && <LineNotifyAdmin />}
      {tab === "users" && <UsersAdmin />}
    </div>
  );
}
