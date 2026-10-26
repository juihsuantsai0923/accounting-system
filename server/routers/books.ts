import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { books } from "../schema";
import { asc, eq } from "drizzle-orm";
import { writeAudit } from "../ledger";

const kindSchema = z.enum(["book", "workbook", "bundle", "notebook"]);

/** 書籍（含筆記本、組合包）：記帳時用來帶出品名與定價，書籍收入全數留給公積金 */
export const booksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(books).orderBy(asc(books.sortOrder), asc(books.id));
  }),

  create: staffProcedure
    .input(z.object({ name: z.string().trim().min(1), kind: kindSchema, price: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.select().from(books).where(eq(books.name, input.name)).limit(1);
      if (existing.length) throw new TRPCError({ code: "BAD_REQUEST", message: `已經有「${input.name}」這本書了` });
      const all = await ctx.db.select({ sortOrder: books.sortOrder }).from(books);
      const sortOrder = all.reduce((m: number, b: any) => Math.max(m, b.sortOrder), 0) + 1;
      const [created] = await ctx.db.insert(books).values({ ...input, sortOrder }).returning();
      await writeAudit(ctx.db, ctx.user.id, "create", "book", created.id, null, created);
      return created;
    }),

  update: staffProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().trim().min(1).optional(),
        kind: kindSchema.optional(),
        price: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const [before] = await ctx.db.select().from(books).where(eq(books.id, id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這本書" });
      const [updated] = await ctx.db.update(books).set({ ...rest, updatedAt: Date.now() }).where(eq(books.id, id)).returning();
      await writeAudit(ctx.db, ctx.user.id, "update", "book", id, before, updated);
      return updated;
    }),

  /** 已入帳的記錄存的是書名文字，刪除書目不會影響舊帳 */
  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await ctx.db.select().from(books).where(eq(books.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這本書" });
    await ctx.db.delete(books).where(eq(books.id, input.id));
    await writeAudit(ctx.db, ctx.user.id, "delete", "book", input.id, before, null);
  }),
});
