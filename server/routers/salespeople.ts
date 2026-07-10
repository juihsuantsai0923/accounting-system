import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, staffProcedure } from "../trpc";
import { db } from "../db";
import { salespeople, expenseTypes } from "../schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "../ledger";

export const salespeopleRouter = router({
  list: publicProcedure.query(async () => {
    return db.select().from(salespeople).orderBy(salespeople.id);
  }),

  create: staffProcedure
    .input(z.object({ name: z.string().min(1), phone: z.string().optional(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [created] = await db.insert(salespeople).values(input).returning();
      // 自動建立對應薪水支出類型
      await db.insert(expenseTypes).values({
        name: `${created.name}薪水`,
        salespersonId: created.id,
      });
      await writeAudit(ctx.user.id, "create", "salesperson", created.id, null, created);
      return created;
    }),

  update: staffProcedure
    .input(z.object({ id: z.number(), name: z.string().min(1).optional(), phone: z.string().optional(), note: z.string().optional(), isActive: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const [before] = await db.select().from(salespeople).where(eq(salespeople.id, id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Salesperson not found" });
      const [updated] = await db.update(salespeople).set({ ...rest, updatedAt: Date.now() }).where(eq(salespeople.id, id)).returning();
      if (rest.name && rest.name !== before.name) {
        // 同步更新薪水支出類型名稱
        const [expenseType] = await db.select().from(expenseTypes).where(eq(expenseTypes.salespersonId, id)).limit(1);
        if (expenseType) {
          await db.update(expenseTypes).set({ name: `${rest.name}薪水`, updatedAt: Date.now() }).where(eq(expenseTypes.id, expenseType.id));
        }
      }
      await writeAudit(ctx.user.id, "update", "salesperson", id, before, updated);
      return updated;
    }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await db.select().from(salespeople).where(eq(salespeople.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Salesperson not found" });
    await db.delete(expenseTypes).where(eq(expenseTypes.salespersonId, input.id));
    await db.delete(salespeople).where(eq(salespeople.id, input.id));
    await writeAudit(ctx.user.id, "delete", "salesperson", input.id, before, null);
  }),
});
