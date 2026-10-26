import bcrypt from "bcryptjs";

export interface AuthTokenPayload {
  userId: number;
  exp: number; // unix seconds
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const str = atob(padded);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

function textToBase64Url(text: string): string {
  return base64UrlEncode(new TextEncoder().encode(text));
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

/** Sign a JWT (HS256) using Web Crypto — works identically on Node.js and Cloudflare Workers. */
export async function signTokenWithSecret(userId: number, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const payload: AuthTokenPayload = { userId, exp: Math.floor(Date.now() / 1000) + THIRTY_DAYS_SECONDS };
  const headerB64 = textToBase64Url(JSON.stringify(header));
  const payloadB64 = textToBase64Url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await hmacSha256(secret, signingInput);
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

/** Verify a JWT (HS256) using Web Crypto. Returns null if invalid, malformed, or expired. */
export async function verifyTokenWithSecret(token: string, secret: string): Promise<AuthTokenPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const expectedSig = await hmacSha256(secret, `${headerB64}.${payloadB64}`);
    const actualSig = base64UrlDecode(sigB64);
    if (expectedSig.length !== actualSig.length) return null;
    let diff = 0;
    for (let i = 0; i < expectedSig.length; i++) diff |= expectedSig[i] ^ actualSig[i];
    if (diff !== 0) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as AuthTokenPayload;
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// 注意：簽發 token（signTokenWithSecret）跟驗證 token（verifyTokenWithSecret）
// 一定要傳入同一把密鑰。密鑰由呼叫端（server/context.ts 給 Express、
// server/context.d1.ts 給 Cloudflare Workers）算好一次放進 ctx.jwtSecret，
// 這裡不再提供「自動讀環境變數」的便利包裝函式——先前就是因為簽發端跟驗證端
// 各自讀了不同來源的環境變數（Node 的 process.env vs. Workers 的 env 參數），
// 導致兩邊密鑰對不起來、所有登入 token 都驗證失敗。

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
