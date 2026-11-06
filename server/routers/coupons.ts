import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { coupons } from "../schema";
import { asc, eq } from "drizzle-orm";
import { writeAudit } from "../ledger";
import { toHalfWidth } from "../textNormalize";
import { ensureCouponSalesperson } from "../revenueCalc";

const codeSchema = z.preprocess((v) => (typeof v === "string" ? toHalfWidth(v).trim().toUpperCase() : v), z.string().min(1));
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式要是 YYYY-MM-DD")
  .nullable();

/** 優惠碼：書籍收入記帳時選用，依折扣比例算出實收金額（跟官網「定價與優惠」的優惠碼對應） */
export const couponsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(coupons).orderBy(asc(coupons.id));
  }),

  create: staffProcedure
    .input(z.object({ code: codeSchema, discountPercent: z.number().gt(0).max(100), validUntil: dateSchema }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.select().from(coupons).where(eq(coupons.code, input.code)).limit(1);
      if (existing.length) throw new TRPCError({ code: "BAD_REQUEST", message: `優惠碼 ${input.code} 已經存在` });
      const [created] = await ctx.db
        .insert(coupons)
        .values({ code: input.code, discountRate: input.discountPercent / 100, validUntil: input.validUntil })
        .returning();
      await ensureCouponSalesperson(ctx.db, created);
      await writeAudit(ctx.db, ctx.user.id, "create", "coupon", created.id, null, created);
      return created;
    }),

  update: staffProcedure
    .input(
      z.object({
        id: z.number(),
        discountPercent: z.number().gt(0).max(100).optional(),
        validUntil: dateSchema.optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [before] = await ctx.db.select().from(coupons).where(eq(coupons.id, input.id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個優惠碼" });
      const patch: Record<string, unknown> = { updatedAt: Date.now() };
      if (input.discountPercent !== undefined) patch.discountRate = input.discountPercent / 100;
      if (input.validUntil !== undefined) patch.validUntil = input.validUntil;
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      const [updated] = await ctx.db.update(coupons).set(patch).where(eq(coupons.id, input.id)).returning();
      await writeAudit(ctx.db, ctx.user.id, "update", "coupon", input.id, before, updated);
      return updated;
    }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await ctx.db.select().from(coupons).where(eq(coupons.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個優惠碼" });
    await ctx.db.delete(coupons).where(eq(coupons.id, input.id));
    await writeAudit(ctx.db, ctx.user.id, "delete", "coupon", input.id, before, null);
  }),
});
