import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { toHalfWidth } from "../lib/textNormalize";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(toHalfWidth(email), password);
      navigate("/");
    } catch (err: any) {
      setError(err?.message ?? "登入失敗");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-gradient px-4 py-12">
      <div className="w-full max-w-sm flex flex-col items-center">
        {/* 商標圓弧角方形徽章：白底，讓深藍圖示在深藍背景上仍然清楚可見（整體含外框等比例放大為原本的 2.5 倍） */}
        <div className="h-40 w-40 rounded-[2.5rem] bg-white shadow-2xl ring-4 ring-white/10 flex items-center justify-center mb-6 shrink-0">
          <img src="/leviax-icon.png" alt="Leviax" className="h-[4.375rem] w-[4.375rem] object-contain" />
        </div>
        <div className="flex flex-col items-center text-center gap-1.5 mb-8">
          <p className="text-xs font-semibold tracking-[0.35em] text-gold-400">LEVIAX LAB</p>
          <h1 className="text-2xl text-white tracking-wide">澈點科學財務系統</h1>
          <p className="text-sm text-white/60">請登入以繼續</p>
        </div>

        {/* 登入表單：僅表單本身用白底，其餘頁面維持深藍底 */}
        <form onSubmit={handleSubmit} className="card w-full space-y-4 shadow-2xl">
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <div>
            <label className="label">帳號 Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={(e) => setEmail(toHalfWidth(e.target.value))}
              required
            />
          </div>
          <div>
            <label className="label">密碼</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn-gold w-full" type="submit" disabled={loading}>
            {loading ? "登入中..." : "登入"}
          </button>
        </form>
      </div>
    </div>
  );
}
