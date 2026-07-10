import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth, ROLE_LABELS } from "../lib/auth";

type Tab = "teachers" | "salespeople" | "courses" | "expenseTypes" | "users";

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
  const createMutation = trpc.teachers.create.useMutation({ onSuccess: () => utils.teachers.list.invalidate() });
  const deleteMutation = trpc.teachers.delete.useMutation({ onSuccess: () => utils.teachers.list.invalidate() });
  const [name, setName] = useState("");

  return (
    <Section title="教師管理">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await createMutation.mutateAsync({ name });
          setName("");
        }}
      >
        <input className="input" placeholder="教師姓名" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" type="submit">
          新增
        </button>
      </form>
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

  return (
    <Section title="推銷者管理">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await createMutation.mutateAsync({ name });
          setName("");
        }}
      >
        <input className="input" placeholder="推銷者姓名" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" type="submit">
          新增（自動建立薪水支出類型）
        </button>
      </form>
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
  const createMutation = trpc.courses.create.useMutation({ onSuccess: () => utils.courses.list.invalidate() });
  const deleteMutation = trpc.courses.delete.useMutation({ onSuccess: () => utils.courses.list.invalidate() });
  const [name, setName] = useState("");
  const [type, setType] = useState<"personal" | "collaborative">("personal");

  return (
    <Section title="課程管理">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await createMutation.mutateAsync({ name, type });
          setName("");
        }}
      >
        <input className="input" placeholder="課程名稱" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input !w-40" value={type} onChange={(e) => setType(e.target.value as any)}>
          <option value="personal">個人課程</option>
          <option value="collaborative">合作課程</option>
        </select>
        <button className="btn-primary" type="submit">
          新增
        </button>
      </form>
      <ul className="divide-y divide-slate-100">
        {(listQuery.data ?? []).map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              {c.name} <span className="text-slate-400">（{c.type === "personal" ? "個人" : "合作"}）</span>
            </span>
            <button className="btn-danger" onClick={() => confirm(`確定刪除課程「${c.name}」？`) && deleteMutation.mutate({ id: c.id })}>
              刪除
            </button>
          </li>
        ))}
      </ul>
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
        className="flex gap-2"
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

function UsersAdmin() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const listQuery = trpc.users.list.useQuery(undefined, { enabled: user?.role === "super_admin" });
  const teachersQuery = trpc.teachers.list.useQuery();
  const salespeopleQuery = trpc.salespeople.list.useQuery();
  const createMutation = trpc.users.create.useMutation({ onSuccess: () => utils.users.list.invalidate() });
  const updateMutation = trpc.users.updateRole.useMutation({ onSuccess: () => utils.users.list.invalidate() });

  const [form, setForm] = useState({ email: "", password: "", name: "", role: "finance_staff" as string, linkedTeacherId: "", linkedSalespersonId: "" });

  if (user?.role !== "super_admin") {
    return <Section title="帳號與權限管理">僅系統管理員可使用此功能。</Section>;
  }

  return (
    <Section title="帳號與權限管理">
      <form
        className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          await createMutation.mutateAsync({
            email: form.email,
            password: form.password,
            name: form.name,
            role: form.role as any,
            linkedTeacherId: form.linkedTeacherId ? Number(form.linkedTeacherId) : null,
            linkedSalespersonId: form.linkedSalespersonId ? Number(form.linkedSalespersonId) : null,
          });
          setForm({ email: "", password: "", name: "", role: "finance_staff", linkedTeacherId: "", linkedSalespersonId: "" });
        }}
      >
        <input className="input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
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
        <button className="btn-primary" type="submit">
          新增帳號
        </button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>姓名</th>
            <th>角色</th>
            <th>狀態</th>
            <th>操作</th>
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
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("teachers");
  const tabs: { key: Tab; label: string }[] = [
    { key: "teachers", label: "教師管理" },
    { key: "salespeople", label: "推銷者管理" },
    { key: "courses", label: "課程管理" },
    { key: "expenseTypes", label: "支出類型管理" },
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
      {tab === "expenseTypes" && <ExpenseTypesAdmin />}
      {tab === "users" && <UsersAdmin />}
    </div>
  );
}
