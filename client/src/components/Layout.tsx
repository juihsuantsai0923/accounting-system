import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, ROLE_LABELS, canManage } from "../lib/auth";
import LeviaxLogo from "./LeviaxLogo";
import { trpc, getActAs, setActAs } from "../lib/trpc";

function TabLink({ to, children, onClick, end }: { to: string; children: React.ReactNode; onClick?: () => void; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150 ${
          isActive ? "bg-brand-50 text-brand-700 ring-1 ring-gold-400/70" : "text-brand-700/80 hover:bg-brand-100 hover:text-brand-700"
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
        <TabLink key={t.id} to={`/teacher/${t.id}/dashboard`} onClick={onNavigate}>
          {t.name}
        </TabLink>
      ))}
      {teachers.length > 0 && <div className="my-0.5 border-t border-brand-700/10" />}
      <TabLink to="/salespeople" onClick={onNavigate}>
        推銷者
      </TabLink>
    </>
  );
  const active = /^\/(teachers|salespeople|teacher\/|salesperson\/)/.test(pathname);
  if (mobile) {
    return (
      <div className="flex flex-col gap-1">
        <div className="px-3 pt-1 text-xs text-brand-700/50">人員</div>
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
          active ? "bg-brand-50 text-brand-700 ring-1 ring-gold-400/70" : "text-brand-700/80 hover:bg-brand-100 hover:text-brand-700"
        }`}
      >
        人員 ▾
      </button>
      {/* pt-1 讓滑鼠從按鈕移到子選單的途中不會斷掉 */}
      <div className="absolute left-0 top-full pt-1 hidden group-hover:block group-focus-within:block z-20">
        <div className="min-w-[8rem] rounded-lg bg-white shadow-card-hover ring-1 ring-brand-700/15 p-1 flex flex-col gap-0.5">{items}</div>
      </div>
    </div>
  );
}

/**
 * 身分切換：管理員兼老師（例如蔡睿軒）可以選「管理員」或「老師」。
 * 選老師時後端也照老師權限回資料，看到的跟其他老師完全一樣。
 */
function RoleSwitch({ compact }: { compact?: boolean }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  if (!user || user.realRole !== "super_admin" || !user.linkedTeacherId) return null;
  const current = getActAs() === "teacher" ? "teacher" : "admin";
  return (
    <label className={`flex items-center gap-1.5 ${compact ? "text-xs" : "text-xs sm:text-sm"} text-brand-700/70`}>
      身分
      <select
        className="rounded-md border border-brand-700/20 bg-white px-2 py-1 text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-100"
        value={current}
        onChange={async (e) => {
          setActAs(e.target.value === "teacher" ? "teacher" : null);
          navigate("/");
          await utils.invalidate();
        }}
      >
        <option value="admin">管理員</option>
        <option value="teacher">老師</option>
      </select>
    </label>
  );
}

/**
 * 背景波紋：每層是兩段一模一樣的波形接在一起（寬 200%），往左移一半剛好接回原位，就能無縫一直流。
 * 顏色都是品牌淺藍，不用黃色。
 */
function wavePath(amp: number, base: number, phase = 0) {
  // 0–2400 寬、0–100 高的 viewBox，兩個週期各 1200
  let d = `M0 ${base}`;
  for (let x = 0; x <= 2400; x += 40) d += ` L${x} ${(base + amp * Math.sin(((x + phase) / 1200) * 2 * Math.PI)).toFixed(1)}`;
  return d;
}
function BackgroundWaves() {
  const fill = (amp: number, base: number, phase: number) => `${wavePath(amp, base, phase)} L2400 100 L0 100 Z`;
  return (
    <div className="app-bg" aria-hidden>
      <div className="wave wave-top">
        <svg viewBox="0 0 2400 100" preserveAspectRatio="none">
          <path d={wavePath(18, 50, 0)} fill="none" stroke="#c6d6f3" strokeWidth="1.2" vectorEffect="non-scaling-stroke" opacity="0.7" />
          <path d={wavePath(14, 58, 300)} fill="none" stroke="#c6d6f3" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.45" />
        </svg>
      </div>
      <div className="wave wave-1">
        <svg viewBox="0 0 2400 100" preserveAspectRatio="none">
          <path d={fill(14, 40, 0)} fill="#e4ecfb" opacity="0.7" />
        </svg>
      </div>
      <div className="wave wave-2">
        <svg viewBox="0 0 2400 100" preserveAspectRatio="none">
          <path d={fill(12, 45, 400)} fill="#c6d6f3" opacity="0.35" />
        </svg>
      </div>
      <div className="wave wave-3">
        <svg viewBox="0 0 2400 100" preserveAspectRatio="none">
          <path d={fill(10, 50, 800)} fill="#8dafee" opacity="0.18" />
          <path d={wavePath(10, 50, 800)} fill="none" stroke="#8dafee" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.35" />
        </svg>
      </div>
    </div>
  );
}

/** 右下角提醒：有代墊等管理員審核時跳出來；關掉後有新的一筆才會再跳 */
function PendingReviewToast({ count }: { count: number }) {
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(0);
  if (count <= dismissed || pathname === "/advance") return null;
  return (
    <div className="no-print fixed bottom-4 right-4 z-30 max-w-[calc(100vw-2rem)] card !py-3 border-l-4 border-amber-500 shadow-card-hover flex items-center gap-3">
      <Link to="/advance" className="text-sm text-amber-700 hover:underline">
        🔔 有 {count} 筆代墊等你審核 →
      </Link>
      <button type="button" aria-label="關閉提醒" className="text-slate-400 hover:text-slate-600" onClick={() => setDismissed(count)}>
        ✕
      </button>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const pendingReview = trpc.advancePayments.pendingReviewCount.useQuery(undefined, { enabled: canManage(user?.role), refetchInterval: 60_000 }).data ?? 0;

  const isTeacherSelf = user?.role === "teacher_self";
  const isSalespersonSelf = user?.role === "salesperson_self";
  const isShipper = user?.role === "shipper_self";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const closeMenu = () => setMenuOpen(false);

  // 本人帳號（老師／推銷者）只看自己的：儀表板、我的帳本、代墊管理
  const selfBase =
    isTeacherSelf && user?.linkedTeacherId ? `/teacher/${user.linkedTeacherId}` : isSalespersonSelf && user?.linkedSalespersonId ? `/salesperson/${user.linkedSalespersonId}` : null;
  const navLinks = (mobile: boolean) =>
    isShipper ? (
      <TabLink to="/advance" onClick={closeMenu}>
        我的代墊
      </TabLink>
    ) : (
    <>
      {selfBase ? (
        <>
          <TabLink to={`${selfBase}/dashboard`} onClick={closeMenu}>
            儀表板
          </TabLink>
          <TabLink to={selfBase} end onClick={closeMenu}>
            我的帳本
          </TabLink>
        </>
      ) : (
        !isTeacherSelf &&
        !isSalespersonSelf && (
          <>
            <TabLink to="/" end onClick={closeMenu}>
              儀表板
            </TabLink>
            <TabLink to="/reconcile" onClick={closeMenu}>
              官網對帳
            </TabLink>
            {canManage(user?.role) && (
              <TabLink to="/entry" onClick={closeMenu}>
                手動記帳
              </TabLink>
            )}
            <TabLink to="/ledger" onClick={closeMenu}>
              帳本
            </TabLink>
            <TabLink to="/analytics" onClick={closeMenu}>
              分析
            </TabLink>
            <TabLink to="/tax" onClick={closeMenu}>
              稅務
            </TabLink>
          </>
        )
      )}
      {!isTeacherSelf && !isSalespersonSelf && <PeopleMenu mobile={mobile} onNavigate={closeMenu} />}
      <TabLink to="/advance" onClick={closeMenu}>
        {pendingReview ? `代墊管理（${pendingReview}）` : "代墊管理"}
      </TabLink>
      {canManage(user?.role) && (
        <TabLink to="/admin" onClick={closeMenu}>
          管理面板
        </TabLink>
      )}
    </>
    );

  return (
    <div className="min-h-screen">
      <BackgroundWaves />
      <header className="no-print bg-white/90 backdrop-blur border-b-2 border-gold-400/50 shadow-header sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              className="sm:hidden inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-brand-700 bg-brand-50 hover:bg-brand-100 transition-colors shrink-0"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="開啟選單"
              type="button"
            >
              ☰
            </button>
            {/* 商標：與登入頁面統一改為白底圓角方框，裡面放圖示並留白，
                深藍圖示原色在深藍色頁首上才不會融為一體看不見 */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="brand-logo h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-white ring-1 ring-brand-700/15 flex items-center justify-center shrink-0">
                <LeviaxLogo className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              {/* 字體與顏色改回和下方功能列一致（沿用頁面預設字體、白色文字），但字級加大作為標題 */}
              <div className="brand-title font-serif text-lg sm:text-xl tracking-wide truncate">澈點科學財務系統</div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-brand-700/70 shrink-0">
            {user && (
              <>
                <span className="hidden sm:inline">{user.name}</span>
                <span className="hidden sm:inline-flex">
                  {user.realRole === "super_admin" && user.linkedTeacherId ? <RoleSwitch /> : `（${ROLE_LABELS[user.role] ?? user.role}）`}
                </span>
                <button
                  onClick={handleLogout}
                  className="btn-gold !px-4 !py-1.5"
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
          <div className="sm:hidden border-t border-brand-700/10 px-3 py-3 flex flex-col gap-1 bg-white">
            {user && (
              <div className="text-xs text-brand-700/60 pb-2 flex items-center gap-3">
                <span>{user.name}</span>
                {user.realRole === "super_admin" && user.linkedTeacherId ? <RoleSwitch compact /> : <span>（{ROLE_LABELS[user.role] ?? user.role}）</span>}
              </div>
            )}
            {navLinks(true)}
          </div>
        )}
        <div className="brand-underline" aria-hidden />
      </header>
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-6">
        <Outlet />
      </main>
      <PendingReviewToast count={pendingReview} />
    </div>
  );
}
