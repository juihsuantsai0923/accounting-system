import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { incomeTypes } from "../schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "../ledger";

/**
 * 「其他收入」類型管理：課程收入一律走「課程收入分潤精靈」（見 courses / revenueSettings），
 * 這裡管理的是課程以外的其他收入項目（例如：贊助、場地租借、周邊商品銷售…）。
 */
export const incomeTypesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(incomeTypes).orderBy(incomeTypes.id);
  }),

  create: staffProcedure.input(z.object({ name: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const [created] = await ctx.db.insert(incomeTypes).values(input).returning();
    await writeAudit(ctx.db, ctx.user.id, "create", "incomeType", created.id, null, created);
    return created;
  }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await ctx.db.select().from(incomeTypes).where(eq(incomeTypes.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "IncomeType not found" });
    await ctx.db.delete(incomeTypes).where(eq(incomeTypes.id, input.id));
    await writeAudit(ctx.db, ctx.user.id, "delete", "incomeType", input.id, before, null);
  }),
});
