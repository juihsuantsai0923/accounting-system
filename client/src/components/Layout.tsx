import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useAuth, ROLE_LABELS, canManage } from "../lib/auth";

function TabLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
          isActive ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const teachersQuery = trpc.teachers.list.useQuery(undefined, { enabled: !!user });
  const salespeopleQuery = trpc.salespeople.list.useQuery(undefined, { enabled: !!user });

  const isTeacherSelf = user?.role === "teacher_self";
  const isSalespersonSelf = user?.role === "salesperson_self";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="font-semibold text-slate-800">記帳拆賬財務系統</div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            {user && (
              <>
                <span>
                  {user.name}（{ROLE_LABELS[user.role] ?? user.role}）
                </span>
                <button onClick={handleLogout} className="btn-secondary">
                  登出
                </button>
              </>
            )}
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 pb-2 flex gap-2 overflow-x-auto">
          <TabLink to="/">儀表板</TabLink>
          {!isTeacherSelf && !isSalespersonSelf && <TabLink to="/ledger">母記帳表</TabLink>}
          {!isSalespersonSelf &&
            teachersQuery.data
              ?.filter((t) => !isTeacherSelf || t.id === user?.linkedTeacherId)
              .map((t) => (
                <TabLink key={t.id} to={`/teacher/${t.id}`}>
                  教師：{t.name}
                </TabLink>
              ))}
          {!isTeacherSelf &&
            salespeopleQuery.data
              ?.filter((s) => !isSalespersonSelf || s.id === user?.linkedSalespersonId)
              .map((s) => (
                <TabLink key={s.id} to={`/salesperson/${s.id}`}>
                  推銷者：{s.name}
                </TabLink>
              ))}
          <TabLink to="/advance">代墊管理</TabLink>
          {canManage(user?.role) && <TabLink to="/admin">管理面板</TabLink>}
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
