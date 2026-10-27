import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { teachers, expenseTypes } from "../schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "../ledger";
import { upsertSalaryExpenseType } from "../expenseTypeHelpers";

export const teachersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(teachers).orderBy(teachers.id);
  }),

  create: staffProcedure
    .input(z.object({ name: z.string().min(1), phone: z.string().optional(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db.insert(teachers).values(input).returning();
      // 自動建立對應薪水支出類型（跟推銷者一致），支出頁的「薪水」選單才找得到這位老師。
      // 用 upsertSalaryExpenseType 而不是直接 insert，避免名稱撞到既有支出類型時
      // 因為 UNIQUE constraint 讓這個 mutation 整個失敗（教師其實已經新增成功了）。
      await upsertSalaryExpenseType(ctx.db, { type: "teacher", id: created.id, name: created.name });
      await writeAudit(ctx.db, ctx.user.id, "create", "teacher", created.id, null, created);
      return created;
    }),

  update: staffProcedure
    .input(z.object({ id: z.number(), name: z.string().min(1).optional(), phone: z.string().optional(), note: z.string().optional(), isActive: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const [before] = await ctx.db.select().from(teachers).where(eq(teachers.id, id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Teacher not found" });
      const [updated] = await ctx.db.update(teachers).set({ ...rest, updatedAt: Date.now() }).where(eq(teachers.id, id)).returning();
      if (rest.name && rest.name !== before.name) {
        await upsertSalaryExpenseType(ctx.db, { type: "teacher", id, name: rest.name });
      }
      await writeAudit(ctx.db, ctx.user.id, "update", "teacher", id, before, updated);
      return updated;
    }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await ctx.db.select().from(teachers).where(eq(teachers.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Teacher not found" });
    // 一併刪除自動建立的薪水支出類型
    await ctx.db.delete(expenseTypes).where(eq(expenseTypes.teacherId, input.id));
    await ctx.db.delete(teachers).where(eq(teachers.id, input.id));
    await writeAudit(ctx.db, ctx.user.id, "delete", "teacher", input.id, before, null);
  }),
});
