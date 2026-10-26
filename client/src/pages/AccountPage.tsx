import { useState, useEffect } from "react";
import { trpc } from "../lib/trpc";
import { useAuth, ROLE_LABELS } from "../lib/auth";

export default function AccountPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const changePasswordMutation = trpc.users.changeOwnPassword.useMutation();
  const changeNameMutation = trpc.users.changeOwnName.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
  });

  const [name, setName] = useState(user?.name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState<string | null>(null);

  // user 資料是非同步載入的（首次渲染時可能還是 undefined），載入完成後同步預設值到輸入框
  useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setNameSuccess(null);
    if (!name.trim()) {
      setNameError("姓名不能空白");
      return;
    }
    try {
      await changeNameMutation.mutateAsync({ name: name.trim() });
      setNameSuccess("姓名已更新。");
    } catch (err: any) {
      setNameError(err?.message ?? "修改失敗");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPassword.length < 6) {
      setError("新密碼至少需要 6 個字元");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("兩次輸入的新密碼不一致");
      return;
    }
    try {
      await changePasswordMutation.mutateAsync({ currentPassword, newPassword });
      setSuccess("密碼已更新，下次登入請使用新密碼。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err?.message ?? "修改失敗");
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-xl font-semibold text-slate-800">帳號設定</h1>

      <div className="card space-y-1">
        <div className="text-sm text-slate-500">目前登入身份</div>
        <div className="font-medium text-slate-800">
          {user?.name}（{user ? ROLE_LABELS[user.role] ?? user.role : ""}）
        </div>
        <div className="text-sm text-slate-500">{user?.email}</div>
      </div>

      <form onSubmit={handleNameSubmit} className="card space-y-4">
        <h2 className="font-medium text-slate-700">修改姓名</h2>
        {nameError && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{nameError}</div>}
        {nameSuccess && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{nameSuccess}</div>}
        <div>
          <label className="label">顯示姓名</label>
          <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <button className="btn-primary" type="submit" disabled={changeNameMutation.isPending}>
          {changeNameMutation.isPending ? "更新中..." : "更新姓名"}
        </button>
      </form>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <h2 className="font-medium text-slate-700">修改密碼</h2>
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
        {success && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{success}</div>}
        <div>
          <label className="label">目前密碼</label>
          <input
            className="input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">新密碼（至少 6 碼）</label>
          <input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
        </div>
        <div>
          <label className="label">確認新密碼</label>
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        <button className="btn-primary" type="submit" disabled={changePasswordMutation.isPending}>
          {changePasswordMutation.isPending ? "更新中..." : "更新密碼"}
        </button>
      </form>
    </div>
  );
}
