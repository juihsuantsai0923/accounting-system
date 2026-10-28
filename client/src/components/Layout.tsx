import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, ROLE_LABELS, canManage } from "../lib/auth";
import LeviaxLogo from "./LeviaxLogo";
import { trpc } from "../lib/trpc";

function TabLink({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150 ${
          isActive
            ? "bg-white/10 text-gold-400 shadow-inner ring-1 ring-gold-500/30"
            : "text-white/70 hover:bg-white/10 hover:text-white"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

/**
 * 「人員」：直接列出每位老師（點了就是他的子記帳表），最後是推銷者名單。
 * 桌面版滑鼠移上去（或用鍵盤 Tab 進去）展開子選單；手機選單沒有滑鼠，直接列出來。
 */
function PeopleMenu({ mobile, onNavigate }: { mobile: boolean; onNavigate: () => void }) {
  const { pathname } = useLocation();
  const teachers = (trpc.teachers.list.useQuery().data ?? []).filter((t: any) => t.isActive !== false);
  const items = (
    <>
      {teachers.map((t: any) => (
        <TabLink key={t.id} to={`/teacher/${t.id}`} onClick={onNavigate}>
          {t.name}
        </TabLink>
      ))}
      {teachers.length > 0 && <div className="my-0.5 border-t border-white/10" />}
      <TabLink to="/salespeople" onClick={onNavigate}>
        推銷者
      </TabLink>
    </>
  );
  const active = /^\/(teachers|salespeople|teacher\/|salesperson\/)/.test(pathname);
  if (mobile) {
    return (
      <div className="flex flex-col gap-1">
        <div className="px-3 pt-1 text-xs text-white/50">人員</div>
        <div className="pl-3 flex flex-col gap-1">{items}</div>
      </div>
    );
  }
  return (
    <div className="relative group">
      <button
        type="button"
        aria-haspopup="true"
        className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150 ${
          active ? "bg-white/10 text-gold-400 shadow-inner ring-1 ring-gold-500/30" : "text-white/70 hover:bg-white/10 hover:text-white"
        }`}
      >
        人員 ▾
      </button>
      {/* pt-1 讓滑鼠從按鈕移到子選單的途中不會斷掉 */}
      <div className="absolute left-0 top-full pt-1 hidden group-hover:block group-focus-within:block z-20">
        <div className="min-w-[8rem] rounded-lg bg-brand-800 shadow-lg ring-1 ring-white/10 p-1 flex flex-col gap-0.5">{items}</div>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const isTeacherSelf = user?.role === "teacher_self";
  const isSalespersonSelf = user?.role === "salesperson_self";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const closeMenu = () => setMenuOpen(false);

  // 教師/推銷者人數變多之後，導覽列不再逐一列出每個人的分頁（否則手機上會排成一長串滑不完），
  // 改成統一一個「教師」/「推銷者」入口，點進去是可以搜尋姓名的列表頁。
  // 教師本人/推銷者本人登入時，本來就只看得到自己的資料，直接連到自己的子記帳表即可，不需要列表頁。
  const navLinks = (mobile: boolean) => (
    <>
      {!isTeacherSelf && !isSalespersonSelf && (
        <TabLink to="/" onClick={closeMenu}>
          儀表板
        </TabLink>
      )}
      {!isTeacherSelf && !isSalespersonSelf && (
        <TabLink to="/reconcile" onClick={closeMenu}>
          官網對帳
        </TabLink>
      )}
      {canManage(user?.role) && (
        <TabLink to="/entry" onClick={closeMenu}>
          手動記帳
        </TabLink>
      )}
      {!isSalespersonSelf && (
        <TabLink to="/ledger" onClick={closeMenu}>
          帳本
        </TabLink>
      )}
      {isTeacherSelf && user?.linkedTeacherId && (
        <TabLink to={`/teacher/${user.linkedTeacherId}`} onClick={closeMenu}>
          我的記帳表
        </TabLink>
      )}
      {isSalespersonSelf && user?.linkedSalespersonId && (
        <TabLink to={`/salesperson/${user.linkedSalespersonId}`} onClick={closeMenu}>
          我的記帳表
        </TabLink>
      )}
      {!isTeacherSelf && !isSalespersonSelf && <PeopleMenu mobile={mobile} onNavigate={closeMenu} />}
      <TabLink to="/advance" onClick={closeMenu}>
        代墊管理
      </TabLink>
      {canManage(user?.role) && (
        <TabLink to="/admin" onClick={closeMenu}>
          管理面板
        </TabLink>
      )}
      <TabLink to="/account" onClick={closeMenu}>
        帳號設定
      </TabLink>
    </>
  );

  return (
    <div className="min-h-screen">
      <header className="bg-brand-gradient shadow-header sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              className="sm:hidden inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-white/80 bg-white/10 hover:bg-white/20 transition-colors shrink-0"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="開啟選單"
              type="button"
            >
              ☰
            </button>
            {/* 商標：與登入頁面統一改為白底圓角方框，裡面放圖示並留白，
                深藍圖示原色在深藍色頁首上才不會融為一體看不見 */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-white shadow-md flex items-center justify-center shrink-0">
                <LeviaxLogo className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              {/* 字體與顏色改回和下方功能列一致（沿用頁面預設字體、白色文字），但字級加大作為標題 */}
              <div className="font-semibold text-white text-lg sm:text-xl tracking-tight truncate">澈點科學財務系統</div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-white/70 shrink-0">
            {user && (
              <>
                <span className="hidden sm:inline">
                  {user.name}（{ROLE_LABELS[user.role] ?? user.role}）
                </span>
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-white/90 bg-white/10 border border-white/10 hover:bg-white/20 transition-colors"
                >
                  登出
                </button>
              </>
            )}
          </div>
        </div>

        {/* 桌面/平板：橫向分頁列（與上方商標列拉開一點距離，避免看起來太擠） */}
        <div className="hidden sm:flex flex-wrap max-w-7xl mx-auto px-4 pt-2 pb-3 gap-1">{navLinks(false)}</div>

        {/* 手機直式：點漢堡選單展開的直向清單 */}
        {menuOpen && (
          <div className="sm:hidden border-t border-white/10 px-3 py-3 flex flex-col gap-1 bg-brand-800">
            {user && (
              <div className="text-xs text-white/60 pb-2">
                {user.name}（{ROLE_LABELS[user.role] ?? user.role}）
              </div>
            )}
            {navLinks(true)}
          </div>
        )}
      </header>
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
