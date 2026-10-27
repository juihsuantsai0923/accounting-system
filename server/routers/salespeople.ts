import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { salespeople, expenseTypes } from "../schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "../ledger";
import { upsertSalaryExpenseType } from "../expenseTypeHelpers";

export const salespeopleRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(salespeople).orderBy(salespeople.id);
  }),

  create: staffProcedure
    .input(z.object({ name: z.string().min(1), phone: z.string().optional(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db.insert(salespeople).values(input).returning();
      // 自動建立對應薪水支出類型。用 upsertSalaryExpenseType 避免名稱撞到既有支出類型時
      // 因為 UNIQUE constraint 讓這個 mutation 整個失敗（推銷者其實已經新增成功了）。
      await upsertSalaryExpenseType(ctx.db, { type: "salesperson", id: created.id, name: created.name });
      await writeAudit(ctx.db, ctx.user.id, "create", "salesperson", created.id, null, created);
      return created;
    }),

  update: staffProcedure
    .input(z.object({ id: z.number(), name: z.string().min(1).optional(), phone: z.string().optional(), note: z.string().optional(), isActive: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const [before] = await ctx.db.select().from(salespeople).where(eq(salespeople.id, id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Salesperson not found" });
      const [updated] = await ctx.db.update(salespeople).set({ ...rest, updatedAt: Date.now() }).where(eq(salespeople.id, id)).returning();
      if (rest.name && rest.name !== before.name) {
        await upsertSalaryExpenseType(ctx.db, { type: "salesperson", id, name: rest.name });
      }
      await writeAudit(ctx.db, ctx.user.id, "update", "salesperson", id, before, updated);
      return updated;
    }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await ctx.db.select().from(salespeople).where(eq(salespeople.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Salesperson not found" });
    await ctx.db.delete(expenseTypes).where(eq(expenseTypes.salespersonId, input.id));
    await ctx.db.delete(salespeople).where(eq(salespeople.id, input.id));
    await writeAudit(ctx.db, ctx.user.id, "delete", "salesperson", input.id, before, null);
  }),
});
