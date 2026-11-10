import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import MainLedgerPage from "./pages/MainLedgerPage";
import { PersonDashboardPage, PersonLedgerPage, PersonStatementPage } from "./pages/PersonPages";
import AdvancePaymentsPage from "./pages/AdvancePaymentsPage";
import ReconcilePage from "./pages/ReconcilePage";
import AdminPage from "./pages/AdminPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import TaxPage from "./pages/TaxPage";
import PayrollPage from "./pages/PayrollPage";
import { SalespeopleDirectoryPage } from "./pages/PeopleDirectoryPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <div className="p-8 text-center text-slate-400">載入中...</div>;
  if (!user) return <Navigate to="/login" replace />;
  // 出貨員只能用代墊頁
  if (user.role === "shipper_self" && location.pathname !== "/advance") return <Navigate to="/advance" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/entry" element={<MainLedgerPage view="entry" />} />
        <Route path="/ledger" element={<MainLedgerPage view="book" />} />
        {/* 老師直接列在「人員」選單裡，不再有教師名單頁 */}
        <Route path="/teachers" element={<Navigate to="/" replace />} />
        <Route path="/salespeople" element={<SalespeopleDirectoryPage />} />
        <Route path="/teacher/:id" element={<PersonLedgerPage kind="teacher" />} />
        <Route path="/teacher/:id/dashboard" element={<PersonDashboardPage kind="teacher" />} />
        <Route path="/salesperson/:id" element={<PersonLedgerPage kind="salesperson" />} />
        <Route path="/salesperson/:id/dashboard" element={<PersonDashboardPage kind="salesperson" />} />
        <Route path="/teacher/:id/statement" element={<PersonStatementPage kind="teacher" />} />
        <Route path="/salesperson/:id/statement" element={<PersonStatementPage kind="salesperson" />} />
        <Route path="/advance" element={<AdvancePaymentsPage />} />
        <Route path="/reconcile" element={<ReconcilePage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/tax" element={<TaxPage />} />
        <Route path="/payroll" element={<PayrollPage />} />
        <Route path="/admin" element={<AdminPage />} />
        {/* 改用 Google 登入後不需要帳號設定頁 */}
        <Route path="/account" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
