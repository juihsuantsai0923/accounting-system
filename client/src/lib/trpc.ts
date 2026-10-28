import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../../../server/routers/index";

export const trpc = createTRPCReact<AppRouter>();

export function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

/** 身分切換（管理員兼老師可以選「用老師身分看」），存在這台電腦的瀏覽器 */
const ACT_AS_KEY = "auth_act_as";
export function getActAs(): "teacher" | null {
  try {
    return localStorage.getItem(ACT_AS_KEY) === "teacher" ? "teacher" : null;
  } catch {
    return null;
  }
}
export function setActAs(v: "teacher" | null) {
  try {
    if (v) localStorage.setItem(ACT_AS_KEY, v);
    else localStorage.removeItem(ACT_AS_KEY);
  } catch {
    /* 存不了就維持原本身分 */
  }
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("auth_token", token);
  else localStorage.removeItem("auth_token");
}

// 若前端與後端分開部署（例如 Cloudflare Pages + Cloudflare Workers），
// 在建置時設定 VITE_API_URL 指向 Workers 的網址（例如 https://accounting-system-api.xxx.workers.dev）。
// 若未設定，預設用相對路徑 /trpc（適合前後端同源部署，例如本機開發或 Docker/Express 版本）。
export const API_BASE = (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, "") ?? "";

export function makeTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${API_BASE}/trpc`,
        headers() {
          const token = getToken();
          const h: Record<string, string> = {};
          if (token) h.authorization = `Bearer ${token}`;
          if (getActAs()) h["x-act-as"] = getActAs()!;
          return h;
        },
      }),
    ],
  });
}
