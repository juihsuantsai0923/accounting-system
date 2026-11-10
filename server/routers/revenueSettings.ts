import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import { revenueTeamMembers, revenueSettings } from "../schema";
import { eq } from "drizzle-orm";
import { getRevenueSettings } from "../revenueCalc";
import { writeAudit } from "../ledger";
import { recalcBookShares } from "../bookShares";

export const revenueSettingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const settings = await getRevenueSettings(ctx.db);
    const members = await ctx.db.select().from(revenueTeamMembers).orderBy(revenueTeamMembers.id);
    return { settings, members };
  }),

  /** 三個參數：公積金比例、行政費比例、書籍公積金比例（百分比輸入） */
  update: adminProcedure
    .input(
      z.object({
        reserveRatePercent: z.number().min(0).max(100),
        adminFeeRatePercent: z.number().min(0).max(100),
        bookReserveRatePercent: z.number().min(0).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.reserveRatePercent + input.adminFeeRatePercent > 100) throw new TRPCError({ code: "BAD_REQUEST", message: "公積金加行政費不能超過 100%" });
      if (input.bookReserveRatePercent + input.adminFeeRatePercent > 100) throw new TRPCError({ code: "BAD_REQUEST", message: "書籍公積金加行政費不能超過 100%" });
      const db = ctx.db;
      await getRevenueSettings(db); // 確保設定列存在
      const values = {
        reserveRate: input.reserveRatePercent / 100,
        adminFeeRate: input.adminFeeRatePercent / 100,
        bookReserveRate: input.bookReserveRatePercent / 100,
        updatedAt: Date.now(),
      };
      await db.update(revenueSettings).set(values).where(eq(revenueSettings.id, 1));
      await writeAudit(db, ctx.user.id, "update", "revenueSettings", 1, null, values);
      return { id: 1, ...values };
    }),

  /** 營業稅與公積金水位：稅率、稅籍登記日（空白＝還沒登記）、最低水位、補稅準備（凍結）。登記日以前的帳不會重算 */
  updateTaxReserve: adminProcedure
    .input(
      z.object({
        vatRatePercent: z.number().min(0).max(50),
        registrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        reserveFloor: z.number().int().min(0),
        reserveFrozen: z.number().int().min(0),
        preregInstallments: z.number().int().min(1).max(24).optional(),
        preregFirstPayday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      await getRevenueSettings(db);
      const values = {
        vatRate: input.vatRatePercent / 100,
        registrationDate: input.registrationDate,
        reserveFloor: input.reserveFloor,
        reserveFrozen: input.reserveFrozen,
        ...(input.preregInstallments === undefined ? {} : { preregInstallments: input.preregInstallments }),
        ...(input.preregFirstPayday === undefined ? {} : { preregFirstPayday: input.preregFirstPayday }),
        updatedAt: Date.now(),
      };
      await db.update(revenueSettings).set(values).where(eq(revenueSettings.id, 1));
      await writeAudit(db, ctx.user.id, "update", "revenueSettings", 1, null, values);
      return values;
    }),

  /** 舊帳的書籍分潤照目前的書籍公積金比例重算（dryRun＝只列出會改哪些） */
  recalcBookShares: adminProcedure.input(z.object({ dryRun: z.boolean() })).mutation(async ({ ctx, input }) => {
    const r = await recalcBookShares(ctx.db, input.dryRun);
    if (!input.dryRun && r.changes.length) await writeAudit(ctx.db, ctx.user.id, "recalcBookShares", "teacherLedger", 0, null, r);
    return r;
  }),
  // 團隊名單（行政費依權重分配）固定不改，不再提供新增／移除
});
