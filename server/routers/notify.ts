import { TRPCError } from "@trpc/server";
import { router, staffProcedure, adminProcedure } from "../trpc";
import { lineConfigured, lineDisplayName, sendLine } from "../lineNotify";

/** LINE 通知：有沒有設定好、傳測試訊息（金鑰設在 Worker secret，不在畫面上） */
export const notifyRouter = router({
  status: staffProcedure.query(async ({ ctx }) => {
    const line = (ctx as any).line ?? {};
    // 只收新訂單的人：查 LINE 顯示名稱確認 user ID 對不對（不會傳訊息）
    const ids: string[] = String(line.newOrderTo ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const newOrderRecipients = line.token ? await Promise.all(ids.map((id) => lineDisplayName(line.token, id))) : ids.map((userId) => ({ userId, error: "還沒設定 token" }));
    return { configured: lineConfigured(line), newOrderRecipients };
  }),
  test: adminProcedure.mutation(async ({ ctx }) => {
    const r = await sendLine((ctx as any).line ?? {}, "✅ 澈點科學財務系統：LINE 通知設定成功，之後新訂單和每日提醒會傳到這裡。");
    if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: r.error ?? "傳送失敗" });
    return r;
  }),
});
