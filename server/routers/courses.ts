import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import { courses } from "../schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "../ledger";

export const coursesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(courses).orderBy(courses.id);
  }),

  create: staffProcedure
    .input(
      z.object({
        name: z.string().min(1),
        type: z.enum(["personal", "collaborative"]),
        category: z.enum(["online", "tutoring"]).optional(),
        teacherId: z.number().nullable().optional(),
        basePrice: z.number().int().nullable().optional(),
        originalPrice: z.number().int().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db.insert(courses).values(input).returning();
      await writeAudit(ctx.db, ctx.user.id, "create", "course", created.id, null, created);
      return created;
    }),

  update: staffProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        type: z.enum(["personal", "collaborative"]).optional(),
        category: z.enum(["online", "tutoring"]).optional(),
        teacherId: z.number().nullable().optional(),
        basePrice: z.number().int().nullable().optional(),
        originalPrice: z.number().int().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const { id, ...rest } = input;
      const [before] = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      const [updated] = await db.update(courses).set({ ...rest, updatedAt: Date.now() }).where(eq(courses.id, id)).returning();
      await writeAudit(db, ctx.user.id, "update", "course", id, before, updated);
      return updated;
    }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await ctx.db.select().from(courses).where(eq(courses.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
    await ctx.db.delete(courses).where(eq(courses.id, input.id));
    await writeAudit(ctx.db, ctx.user.id, "delete", "course", input.id, before, null);
  }),
});
