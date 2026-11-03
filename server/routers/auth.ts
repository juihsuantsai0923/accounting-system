import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../trpc";
import { users, accountRequests } from "../schema";
import { eq, sql } from "drizzle-orm";
import { comparePassword, signTokenWithSecret } from "../auth";
import { toHalfWidth } from "../textNormalize";
import { sendLine } from "../lineNotify";

// 跟 users.ts 的 emailSchema 同樣的道理：登入時也先把全形字元轉半形再驗證，
// 避免中文輸入法全形模式打出來的 email 被格式驗證擋下來。
const emailSchema = z.preprocess((val) => (typeof val === "string" ? toHalfWidth(val) : val), z.string().email());

/** 請 Google 驗證前端拿到的 ID token，回傳 email（小寫）與 Google 上的姓名 */
async function verifyGoogle(ctx: any, credential: string) {
  const clientId = ctx.googleClientId as string;
  if (!clientId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "還沒設定 Google 登入" });
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  const info: any = res.ok ? await res.json() : null;
  const verified = info?.email_verified === true || info?.email_verified === "true";
  if (!info || info.aud !== clientId || !["accounts.google.com", "https://accounts.google.com"].includes(info.iss) || !verified || !info.email) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Google 登入驗證失敗，請再試一次" });
  }
  return { email: String(info.email).toLowerCase(), googleName: String(info.name ?? "") };
}

const ROLE_REQUEST_LABELS: Record<string, string> = { teacher: "老師", salesperson: "推銷員", shipper: "出貨員", other: "其他" };

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return null;
    const { passwordHash, ...safe } = ctx.user;
    return safe;
  }),

  login: publicProcedure
    .input(z.object({ email: emailSchema, password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const rows = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      const user = rows[0];
      if (!user || !user.isActive) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "帳號或密碼錯誤" });
      }
      const ok = await comparePassword(input.password, user.passwordHash);
      if (!ok) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "帳號或密碼錯誤" });
      }
      await db.update(users).set({ lastSignedIn: Date.now() }).where(eq(users.id, user.id));
      const token = await signTokenWithSecret(user.id, ctx.jwtSecret);
      const { passwordHash, ...safe } = user;
      return { token, user: safe };
    }),

  /**
   * 用 Google 帳號登入：前端拿到 Google 簽發的 ID token，這裡請 Google 驗證後，
   * 用 token 裡的 email 找系統帳號（email 不分大小寫）。沒有對應帳號就不給進。
   */
  googleLogin: publicProcedure.input(z.object({ credential: z.string().min(20) })).mutation(async ({ ctx, input }) => {
    const { email, googleName } = await verifyGoogle(ctx, input.credential);
    const [user] = await ctx.db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (user && !user.isActive) {
      throw new TRPCError({ code: "FORBIDDEN", message: `${email} 的帳號已停用，請找管理員` });
    }
    if (!user) {
      // 沒有帳號：看有沒有申請過。沒申請過就讓前端顯示申請表（訊息以 NO_ACCOUNT 開頭，後面帶 email 與 Google 姓名）
      const [req] = await ctx.db.select().from(accountRequests).where(eq(accountRequests.email, email)).limit(1);
      if (req?.status === "pending") throw new TRPCError({ code: "FORBIDDEN", message: `${email} 的申請已送出，等管理員開通後再登入一次` });
      if (req?.status === "rejected") throw new TRPCError({ code: "FORBIDDEN", message: `${email} 的申請沒有通過，有問題請聯絡管理員` });
      throw new TRPCError({ code: "NOT_FOUND", message: `NO_ACCOUNT|${email}|${googleName}` });
    }
    await ctx.db.update(users).set({ lastSignedIn: Date.now() }).where(eq(users.id, user.id));
    const token = await signTokenWithSecret(user.id, ctx.jwtSecret);
    const { passwordHash, ...safe } = user;
    return { token, user: safe };
  }),

  /**
   * 沒有帳號的人送出申請：再驗證一次 Google token（同一個 email 只會有一筆申請，重送不會重複通知），
   * 然後 LINE 通知管理員到「管理面板 → 帳號申請」處理。
   */
  requestAccess: publicProcedure
    .input(
      z.object({
        credential: z.string().min(20),
        name: z.string().trim().min(1, "請填姓名").max(30),
        requestedRole: z.enum(["teacher", "salesperson", "shipper", "other"]),
        note: z.string().trim().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { email } = await verifyGoogle(ctx, input.credential);
      const [user] = await ctx.db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
      if (user) throw new TRPCError({ code: "BAD_REQUEST", message: "這個 Gmail 已經有帳號，請直接登入" });
      const [existing] = await ctx.db.select().from(accountRequests).where(eq(accountRequests.email, email)).limit(1);
      if (existing) {
        if (existing.status === "rejected") throw new TRPCError({ code: "FORBIDDEN", message: "你的申請沒有通過，有問題請聯絡管理員" });
        return { status: existing.status, email };
      }
      await ctx.db.insert(accountRequests).values({ email, name: input.name, requestedRole: input.requestedRole, note: input.note || null });
      const line = (ctx as any).line ?? {};
      await sendLine(
        line,
        [
          "🔔 有人申請登入財務系統",
          `${input.name}（${email}）`,
          `申請身分：${ROLE_REQUEST_LABELS[input.requestedRole]}`,
          input.note ? `備註：${input.note}` : "",
          "到「管理面板 → 帳號申請」處理",
        ]
          .filter(Boolean)
          .join("\n")
      ).catch(() => null);
      return { status: "pending", email };
    }),

  logout: protectedProcedure.mutation(() => {
    // JWT 為無狀態 token，登出由前端清除本機 token 即可
    return { success: true };
  }),
});
