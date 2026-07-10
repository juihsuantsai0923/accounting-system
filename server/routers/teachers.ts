import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, staffProcedure } from "../trpc";
import { db } from "../db";
import { teachers, expenseTypes } from "../schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "../ledger";

export const teachersRouter = router({
  list: publicProcedure.query(async () => {
    return db.select().from(teachers).orderBy(teachers.id);
  }),

  create: staffProcedure
    .input(z.object({ name: z.string().min(1), phone: z.string().optional(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [created] = await db.insert(teachers).values(input).returning();
      await writeAudit(ctx.user.id, "create", "teacher", created.id, null, created);
      return created;
    }),

  update: staffProcedure
    .input(z.object({ id: z.number(), name: z.string().min(1).optional(), phone: z.string().optional(), note: z.string().optional(), isActive: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const [before] = await db.select().from(teachers).where(eq(teachers.id, id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Teacher not found" });
      const [updated] = await db.update(teachers).set({ ...rest, updatedAt: Date.now() }).where(eq(teachers.id, id)).returning();
      await writeAudit(ctx.user.id, "update", "teacher", id, before, updated);
      return updated;
    }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await db.select().from(teachers).where(eq(teachers.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Teacher not found" });
    // 一併刪除自動建立的薪水支出類型
    await db.delete(expenseTypes).where(eq(expenseTypes.teacherId, input.id));
    await db.delete(teachers).where(eq(teachers.id, input.id));
    await writeAudit(ctx.user.id, "delete", "teacher", input.id, before, null);
  }),
});
