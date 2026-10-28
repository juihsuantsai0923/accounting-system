import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import MainLedgerPage from "./pages/MainLedgerPage";
import TeacherLedgerPage from "./pages/TeacherLedgerPage";
import SalespersonLedgerPage from "./pages/SalespersonLedgerPage";
import AdvancePaymentsPage from "./pages/AdvancePaymentsPage";
import ReconcilePage from "./pages/ReconcilePage";
import AdminPage from "./pages/AdminPage";
import AccountPage from "./pages/AccountPage";
import { SalespeopleDirectoryPage } from "./pages/PeopleDirectoryPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="p-8 text-center text-slate-400">載入中...</div>;
  if (!user) return <Navigate to="/login" replace />;
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
        <Route path="/teacher/:id" element={<TeacherLedgerPage />} />
        <Route path="/salesperson/:id" element={<SalespersonLedgerPage />} />
        <Route path="/advance" element={<AdvancePaymentsPage />} />
        <Route path="/reconcile" element={<ReconcilePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
