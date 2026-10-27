import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { expenseTypes } from "../schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "../ledger";

export const expenseTypesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(expenseTypes).orderBy(expenseTypes.id);
  }),

  create: staffProcedure
    .input(
      z.object({
        name: z.string().min(1),
        teacherId: z.number().nullable().optional(),
        salespersonId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db.insert(expenseTypes).values(input).returning();
      await writeAudit(ctx.db, ctx.user.id, "create", "expenseType", created.id, null, created);
      return created;
    }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await ctx.db.select().from(expenseTypes).where(eq(expenseTypes.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "ExpenseType not found" });
    await ctx.db.delete(expenseTypes).where(eq(expenseTypes.id, input.id));
    await writeAudit(ctx.db, ctx.user.id, "delete", "expenseType", input.id, before, null);
  }),
});
