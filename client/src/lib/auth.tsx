import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { trpc, setToken } from "./trpc";

interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "super_admin" | "finance_staff" | "viewer" | "teacher_self" | "salesperson_self";
  linkedTeacherId: number | null;
  linkedSalespersonId: number | null;
}

interface AuthContextValue {
  user: AuthUser | null | undefined;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery();
  const loginMutation = trpc.auth.login.useMutation();

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await loginMutation.mutateAsync({ email, password });
      setToken(result.token);
      await utils.auth.me.invalidate();
    },
    [loginMutation, utils]
  );

  const logout = useCallback(() => {
    setToken(null);
    utils.auth.me.invalidate();
  }, [utils]);

  return (
    <AuthContext.Provider value={{ user: meQuery.data as AuthUser | null | undefined, isLoading: meQuery.isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "系統管理員",
  finance_staff: "財務人員",
  viewer: "唯讀人員",
  teacher_self: "教師本人",
  salesperson_self: "推銷者本人",
};

export function canManage(role: string | undefined) {
  return role === "super_admin" || role === "finance_staff";
}
