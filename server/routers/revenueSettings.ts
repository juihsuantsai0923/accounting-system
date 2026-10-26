import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, adminProcedure } from "../trpc";
import { revenueTeamMembers, revenueSettings } from "../schema";
import { and, eq } from "drizzle-orm";
import { getRevenueSettings } from "../revenueCalc";
import { writeAudit } from "../ledger";

const recipientTypeSchema = z.enum(["teacher", "salesperson"]);

export const revenueSettingsRouter = router({
  get: publicProcedure.query(async ({ ctx }) => {
    const settings = await getRevenueSettings(ctx.db);
    const members = await ctx.db.select().from(revenueTeamMembers).orderBy(revenueTeamMembers.id);
    return { settings, members };
  }),

  update: adminProcedure
    .input(
      z.object({
        baseDiscountPercent: z.number().min(0).max(1000),
        couponDiscount: z.number().int().min(0),
        referralBonus: z.number().int().min(0),
        platformFeeRatePercent: z.number().min(0).max(100),
        teamBonusRatePercent: z.number().min(0).max(100),
        materialCost: z.number().int().min(0),
        monthlySubscription: z.number().int().min(0),
        estimatedMonthlySales: z.number().int().min(1),
        tutoringReserveRatePercent: z.number().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      await getRevenueSettings(db); // 確保設定列存在
      const values = {
        baseDiscount: input.baseDiscountPercent / 100,
        couponDiscount: input.couponDiscount,
        referralBonus: input.referralBonus,
        platformFeeRate: input.platformFeeRatePercent / 100,
        teamBonusRate: input.teamBonusRatePercent / 100,
        materialCost: input.materialCost,
        monthlySubscription: input.monthlySubscription,
        estimatedMonthlySales: input.estimatedMonthlySales,
        ...(input.tutoringReserveRatePercent !== undefined ? { tutoringReserveRate: input.tutoringReserveRatePercent / 100 } : {}),
        updatedAt: Date.now(),
      };
      await db.update(revenueSettings).set(values).where(eq(revenueSettings.id, 1));
      await writeAudit(db, ctx.user.id, "update", "revenueSettings", 1, null, values);
      return { id: 1, ...values };
    }),

  addTeamMember: adminProcedure
    .input(z.object({ recipientType: recipientTypeSchema, recipientId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const existing = await db
        .select()
        .from(revenueTeamMembers)
        .where(and(eq(revenueTeamMembers.recipientType, input.recipientType), eq(revenueTeamMembers.recipientId, input.recipientId)))
        .limit(1);
      if (existing.length) throw new TRPCError({ code: "BAD_REQUEST", message: "此人員已在團隊獎金名單中" });
      const [created] = await db.insert(revenueTeamMembers).values(input).returning();
      await writeAudit(db, ctx.user.id, "create", "revenueTeamMember", created.id, null, created);
      return created;
    }),

  removeTeamMember: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = ctx.db;
    const [before] = await db.select().from(revenueTeamMembers).where(eq(revenueTeamMembers.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此團隊成員" });
    await db.delete(revenueTeamMembers).where(eq(revenueTeamMembers.id, input.id));
    await writeAudit(db, ctx.user.id, "delete", "revenueTeamMember", input.id, before, null);
  }),
});
