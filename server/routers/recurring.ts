import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { router, staffProcedure, adminProcedure } from "../trpc";
import { recurringEntries } from "../schema";
import { writeAudit } from "../ledger";
import { recurringCategory, runDueRecurring } from "../recurring";

const ruleInput = z.object({
  type: z.enum(["income", "expense"]),
  itemName: z.string().trim().min(1).max(100),
  categoryId: z.number().int(),
  amount: z.number().int().positive(),
  dayOfMonth: z.number().int().min(1).max(28),
  note: z.string().max(300).optional(),
  isActive: z.boolean().default(true),
});

/** 每月定期收支規則（管理面板「定期收支」） */
export const recurringRouter = router({
  list: staffProcedure.query(async ({ ctx }) => {
    const rows: any[] = await ctx.db.select().from(recurringEntries).orderBy(asc(recurringEntries.id));
    const out = [];
    for (const r of rows) out.push({ ...r, categoryName: (await recurringCategory(ctx.db, r.type, r.categoryId))?.name ?? "（類別已刪除）" });
    return out;
  }),

  save: adminProcedure.input(ruleInput.extend({ id: z.number().int().optional() })).mutation(async ({ ctx, input }) => {
    if (!(await recurringCategory(ctx.db, input.type, input.categoryId)))
      throw new TRPCError({ code: "BAD_REQUEST", message: input.type === "expense" ? "請選支出類型（薪水類別不能設成定期支出）" : "請選收入類型" });
    const { id, ...values } = input;
    const now = Date.now();
    if (id) {
      const [before] = await ctx.db.select().from(recurringEntries).where(eq(recurringEntries.id, id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這條規則" });
      await ctx.db.update(recurringEntries).set({ ...values, note: values.note || null, updatedAt: now }).where(eq(recurringEntries.id, id));
      await writeAudit(ctx.db, ctx.user.id, "update", "recurringEntry", id, before, values);
      return { id };
    }
    const [row] = await ctx.db.insert(recurringEntries).values({ ...values, note: values.note || null }).returning();
    await writeAudit(ctx.db, ctx.user.id, "create", "recurringEntry", row.id, null, row);
    return { id: row.id };
  }),

  remove: adminProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    const [before] = await ctx.db.select().from(recurringEntries).where(eq(recurringEntries.id, input.id)).limit(1);
    if (!before) return { ok: true };
    await ctx.db.delete(recurringEntries).where(eq(recurringEntries.id, input.id));
    await writeAudit(ctx.db, ctx.user.id, "delete", "recurringEntry", input.id, before, null);
    return { ok: true };
  }),

  /** 立刻檢查一次（平常每天早上 9 點自動跑）：到期又還沒記的就記 */
  runNow: adminProcedure.mutation(async ({ ctx }) => runDueRecurring(ctx.db)),
});
