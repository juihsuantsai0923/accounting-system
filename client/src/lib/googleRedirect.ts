/**
 * Google 登入（跳轉版）：點帳號 → 整頁跳到 Google 登入 → 選好帳號後 Google 帶著 ID token 跳回 /login。
 * 用跳轉而不是 Google 官方按鈕，登入頁才能照官網的樣式排（每個記住的帳號一列，還能直接指定帳號）。
 * 拿到的 ID token 交給後端 auth.googleLogin 驗證；nonce 防止別人把舊 token 塞進來重播。
 */
export const GOOGLE_CLIENT_ID = ((import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";

const NONCE_KEY = "login.googleNonce";

function randomString() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function startGoogleLogin(loginHint?: string) {
  const nonce = randomString();
  try {
    sessionStorage.setItem(NONCE_KEY, nonce);
  } catch {
    /* 存不了就沒辦法驗 nonce，下面讀回來時會擋掉 */
  }
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${window.location.origin}/login`,
    response_type: "id_token",
    scope: "openid email",
    nonce,
    state: nonce,
    prompt: "select_account",
  });
  if (loginHint) params.set("login_hint", loginHint);
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

/** 從 Google 跳回來時讀出 ID token（讀完把網址上的 token 清掉）；不是從 Google 回來就回傳 null */
export function takeGoogleRedirectResult(): { credential: string } | { error: string } | null {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  if (!hash.has("id_token") && !hash.has("error")) return null;
  window.history.replaceState(null, "", window.location.pathname);
  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(NONCE_KEY);
    sessionStorage.removeItem(NONCE_KEY);
  } catch {
    /* 同上 */
  }
  if (hash.has("error")) return { error: hash.get("error") === "access_denied" ? "已取消 Google 登入" : "Google 登入失敗，請再試一次" };
  const credential = hash.get("id_token")!;
  let nonce: string | undefined;
  try {
    const payload = credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    nonce = JSON.parse(atob(payload)).nonce;
  } catch {
    /* 解不開就當驗證失敗 */
  }
  if (!expected || hash.get("state") !== expected || nonce !== expected) return { error: "Google 登入驗證失敗，請再試一次" };
  return { credential };
}
