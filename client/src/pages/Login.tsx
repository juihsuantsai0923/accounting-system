import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { trpc } from "../lib/trpc";
import { toHalfWidth } from "../lib/textNormalize";
import { GOOGLE_CLIENT_ID, startGoogleLogin, takeGoogleRedirectResult } from "../lib/googleRedirect";

// 這台電腦用 Google 登入過的帳號（只存 email，方便下次直接點；清掉瀏覽器資料就沒了）
const ACCOUNTS_KEY = "login.googleAccounts";

function readAccounts(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeAccounts(list: string[]) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  } catch {
    /* 無痕模式等情況存不了，不影響登入 */
  }
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-3.5 w-3.5 shrink-0" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-16.6z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** 登入頁：版面照 Leviax 官網的登入頁（淺藍底、logo、「歡迎回來」卡片、選擇帳號登入） */
export default function Login() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<string[]>(readAccounts);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 有設定 Google 登入時，密碼登入收起來當備用
  const [showPassword, setShowPassword] = useState(!GOOGLE_CLIENT_ID);
  // 用 Google 登入但還沒有帳號：顯示申請表（credential 留著送申請時再驗證一次）
  const [request, setRequest] = useState<{ credential: string; email: string; name: string; role: string; note: string } | null>(null);
  const [requestSent, setRequestSent] = useState<string | null>(null);
  const requestMutation = trpc.auth.requestAccess.useMutation();

  const handleGoogle = async (credential: string) => {
    setError(null);
    setLoading(true);
    try {
      const signedIn = await loginWithGoogle(credential);
      writeAccounts([signedIn, ...readAccounts().filter((a) => a !== signedIn)].slice(0, 5));
      navigate("/");
    } catch (err: any) {
      const msg: string = err?.message ?? "登入失敗";
      if (msg.startsWith("NO_ACCOUNT|")) {
        const [, email, name] = msg.split("|");
        setRequest({ credential, email, name: name ?? "", role: "", note: "" });
      } else setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request) return;
    setError(null);
    if (!request.role) return setError("請選擇你的身分");
    try {
      const r = await requestMutation.mutateAsync({
        credential: request.credential,
        name: request.name,
        requestedRole: request.role as any,
        note: request.note || undefined,
      });
      setRequestSent(r.email);
      setRequest(null);
    } catch (err: any) {
      setError(err?.message ?? "送出失敗，請重新用 Google 登入一次");
    }
  };

  // 從 Google 登入頁跳回來：網址上帶著 ID token，交給後端驗證
  useEffect(() => {
    const r = takeGoogleRedirectResult();
    if (!r) return;
    if ("error" in r) setError(r.error);
    else handleGoogle(r.credential);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const removeAccount = (a: string) => {
    const next = accounts.filter((x) => x !== a);
    setAccounts(next);
    writeAccounts(next);
  };

  return (
    <div className="min-h-screen bg-brand-50 flex flex-col items-center px-4 py-8">
      <div className="h-20 w-20 bg-white flex items-center justify-center shadow-sm">
        <img src="/leviax-logo.png" alt="澈點科學" className="h-14 w-14 object-contain" />
      </div>
      <h1 className="mt-5 text-2xl text-brand-700 tracking-[0.15em]">澈點科學財務系統</h1>
      <p className="mt-1 text-xs text-brand-700/70 tracking-[0.4em]">Leviax Lab</p>

      <div className="mt-7 w-full max-w-[22rem] bg-white shadow-card-hover px-5 sm:px-7 py-7">
        {requestSent ? (
          <div className="text-center space-y-3">
            <h2 className="text-lg text-brand-700 tracking-wider">申請已送出</h2>
            <p className="text-sm text-slate-600">
              已通知管理員幫 <b>{requestSent}</b> 開通。開通後回到這頁，再用 Google 登入一次就可以使用。
            </p>
            <button type="button" className="btn-secondary" onClick={() => setRequestSent(null)}>
              回登入畫面
            </button>
          </div>
        ) : request ? (
          <form onSubmit={submitRequest} className="space-y-3">
            <h2 className="text-center text-lg text-brand-700 tracking-wider">申請使用財務系統</h2>
            <p className="text-center text-xs text-slate-500">
              <b>{request.email}</b> 還沒有帳號。填好資料送出後，管理員會收到通知幫你開通。
            </p>
            {error && <div className="text-xs text-red-600 bg-red-50 px-3 py-2">{error}</div>}
            <div>
              <label className="label">姓名</label>
              <input className="input" value={request.name} onChange={(e) => setRequest({ ...request, name: e.target.value })} required />
            </div>
            <div>
              <label className="label">我是</label>
              <select className="input" value={request.role} onChange={(e) => setRequest({ ...request, role: e.target.value })} required>
                <option value="">請選擇</option>
                <option value="teacher">老師</option>
                <option value="salesperson">推銷員</option>
                <option value="shipper">出貨員</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div>
              <label className="label">備註（選填）</label>
              <input className="input" value={request.note} onChange={(e) => setRequest({ ...request, note: e.target.value })} placeholder="例：負責寄書" />
            </div>
            <button className="btn-primary w-full" type="submit" disabled={requestMutation.isPending}>
              {requestMutation.isPending ? "送出中..." : "送出申請"}
            </button>
            <button type="button" className="block mx-auto text-[11px] text-slate-400 hover:text-brand-700" onClick={() => setRequest(null)}>
              取消，換其他帳號
            </button>
          </form>
        ) : (
        <>
        <h2 className="text-center text-lg text-brand-700 tracking-wider">歡迎回來</h2>
        <p className="mt-1.5 text-center text-xs text-slate-500 tracking-wide">登入後即可查看帳本、管理收支</p>

        {error && <div className="mt-4 text-xs text-red-600 bg-red-50 px-3 py-2">{error}</div>}
        {loading && <p className="mt-4 text-center text-xs text-slate-500">登入中...</p>}

        {GOOGLE_CLIENT_ID && (
          <>
            <p className="mt-6 text-center text-[11px] text-slate-400 tracking-[0.3em]">選擇帳號登入</p>
            <div className="mt-3.5 space-y-2">
              {accounts.map((a) => (
                <div key={a} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => startGoogleLogin(a)}
                      className="w-full text-left flex items-center gap-2.5 bg-brand-50 border border-brand-700/10 px-3 py-2.5 text-sm hover:bg-brand-100 hover:border-brand-700/25 transition-colors"
                    >
                        <span className="h-6 w-6 shrink-0 text-xs rounded-full bg-brand-200/70 text-brand-700 font-serif flex items-center justify-center">
                          {a[0]?.toUpperCase()}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-[13px] text-brand-700">{a}</span>
                        <GoogleMark />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="text-slate-300 hover:text-slate-500 text-base leading-none px-0.5"
                    aria-label={`從這台電腦移除 ${a}`}
                    title="從這台電腦移除"
                    onClick={() => removeAccount(a)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {accounts.length === 0 && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => startGoogleLogin()}
                  className="w-full flex items-center justify-center gap-2 bg-brand-50 border border-brand-700/10 px-3 py-2.5 text-sm text-brand-700 hover:bg-brand-100 hover:border-brand-700/25 transition-colors"
                >
                  <GoogleMark />
                  使用 Google 帳號登入
                </button>
              )}
            </div>
            {accounts.length > 0 && (
              <>
                <div className="mt-4 border-t border-brand-700/10" />
                <div className="mt-3 flex justify-center">
                  <button type="button" disabled={loading} onClick={() => startGoogleLogin()} className="px-3 py-1 text-[11px] text-slate-400 hover:text-brand-700">
                    使用其他 Google 帳號 →
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {showPassword ? (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
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
            <button className="btn-primary w-full" type="submit" disabled={loading}>
              {loading ? "登入中..." : "登入"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="mt-4 block mx-auto text-[11px] text-slate-300 hover:text-brand-700 hover:underline"
            onClick={() => setShowPassword(true)}
          >
            改用密碼登入
          </button>
        )}
        </>
        )}

        <p className="mt-6 text-center text-[11px] text-slate-400">僅限澈點科學團隊成員使用</p>
      </div>
    </div>
  );
}
