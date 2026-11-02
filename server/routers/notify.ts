import { TRPCError } from "@trpc/server";
import { router, staffProcedure, adminProcedure } from "../trpc";
import { lineConfigured, sendLine } from "../lineNotify";

/** LINE 通知：有沒有設定好、傳測試訊息（金鑰設在 Worker secret，不在畫面上） */
export const notifyRouter = router({
  status: staffProcedure.query(({ ctx }) => ({ configured: lineConfigured((ctx as any).line ?? {}) })),
  test: adminProcedure.mutation(async ({ ctx }) => {
    const r = await sendLine((ctx as any).line ?? {}, "✅ 澈點科學財務系統：LINE 通知設定成功，之後新訂單和每日提醒會傳到這裡。");
    if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: r.error ?? "傳送失敗" });
    return r;
  }),
});
