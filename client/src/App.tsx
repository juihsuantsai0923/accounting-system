import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import MainLedgerPage from "./pages/MainLedgerPage";
import TeacherLedgerPage from "./pages/TeacherLedgerPage";
import SalespersonLedgerPage from "./pages/SalespersonLedgerPage";
import AdvancePaymentsPage from "./pages/AdvancePaymentsPage";
import AdminPage from "./pages/AdminPage";

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
        <Route path="/ledger" element={<MainLedgerPage />} />
        <Route path="/teacher/:id" element={<TeacherLedgerPage />} />
        <Route path="/salesperson/:id" element={<SalespersonLedgerPage />} />
        <Route path="/advance" element={<AdvancePaymentsPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
