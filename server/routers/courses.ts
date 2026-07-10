import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, staffProcedure } from "../trpc";
import { db } from "../db";
import { courses } from "../schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "../ledger";

export const coursesRouter = router({
  list: publicProcedure.query(async () => {
    return db.select().from(courses).orderBy(courses.id);
  }),

  create: staffProcedure
    .input(z.object({ name: z.string().min(1), type: z.enum(["personal", "collaborative"]) }))
    .mutation(async ({ ctx, input }) => {
      const [created] = await db.insert(courses).values(input).returning();
      await writeAudit(ctx.user.id, "create", "course", created.id, null, created);
      return created;
    }),

  delete: staffProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [before] = await db.select().from(courses).where(eq(courses.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
    await db.delete(courses).where(eq(courses.id, input.id));
    await writeAudit(ctx.user.id, "delete", "course", input.id, before, null);
  }),
});
