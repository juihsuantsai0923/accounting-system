import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { shippers, advancePayments, users } from "../schema";
import { and, eq } from "drizzle-orm";
import { writeAudit } from "../ledger";

export const shippersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(shippers).orderBy(shippers.id);
  }),

  create: staffProcedure.input(z.object({ name: z.string().trim().min(1), note: z.string().optional() })).mutation(async ({ ctx, input }) => {
    const [dup] = await ctx.db.select().from(shippers).where(eq(shippers.name, input.name)).limit(1);
    if (dup) throw new TRPCError({ code: "BAD_REQUEST", message: `已經有出貨員「${input.name}」` });
    const [created] = await ctx.db.insert(shippers).values(input).returning();
    await writeAudit(ctx.db, ctx.user.id, "create", "shipper", created.id, null, created);
    return created;
  }),

  update: staffProcedure
    .input(z.object({ id: z.number(), name: z.string().trim().min(1).optional(), note: z.string().optional(), isActive: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const [before] = await ctx.db.select().from(shippers).where(eq(shippers.id, id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "找不到出貨員" });
      const [updated] = await ctx.db.update(shippers).set({ ...rest, updatedAt: Date.now() }).where(eq(shippers.id, id)).returning();
      await writeAudit(ctx.db, ctx.user.id, "update", "shipper", id, before, updated);
      return updated;
    }),

  /** 有代墊紀錄的不能刪（改成停用），避免代墊找不到人 */
  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await ctx.db.select().from(shippers).where(eq(shippers.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "找不到出貨員" });
    const [used] = await ctx.db
      .select()
      .from(advancePayments)
      .where(and(eq(advancePayments.recipientType, "shipper"), eq(advancePayments.recipientId, input.id)))
      .limit(1);
    if (used) throw new TRPCError({ code: "BAD_REQUEST", message: "這位出貨員已有代墊紀錄，不能刪除，可以改成停用" });
    await ctx.db.update(users).set({ linkedShipperId: null }).where(eq(users.linkedShipperId, input.id));
    await ctx.db.delete(shippers).where(eq(shippers.id, input.id));
    await writeAudit(ctx.db, ctx.user.id, "delete", "shipper", input.id, before, null);
  }),
});
