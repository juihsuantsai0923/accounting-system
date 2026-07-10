import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../trpc";
import { db } from "../db";
import { users } from "../schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth";
import { writeAudit } from "../ledger";

const roleSchema = z.enum(["super_admin", "finance_staff", "viewer", "teacher_self", "salesperson_self"]);

export const usersRouter = router({
  list: adminProcedure.query(async () => {
    const rows = await db.select().from(users).orderBy(users.id);
    return rows.map(({ passwordHash, ...rest }) => rest);
  }),

  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(6),
        name: z.string().min(1),
        role: roleSchema,
        linkedTeacherId: z.number().nullable().optional(),
        linkedSalespersonId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const passwordHash = await hashPassword(input.password);
      const [created] = await db
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          name: input.name,
          role: input.role,
          linkedTeacherId: input.linkedTeacherId ?? null,
          linkedSalespersonId: input.linkedSalespersonId ?? null,
        })
        .returning();
      await writeAudit(ctx.user.id, "create", "user", created.id, null, { ...created, passwordHash: undefined });
      const { passwordHash: _, ...safe } = created;
      return safe;
    }),

  updateRole: adminProcedure
    .input(
      z.object({
        id: z.number(),
        role: roleSchema,
        linkedTeacherId: z.number().nullable().optional(),
        linkedSalespersonId: z.number().nullable().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const [before] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      const [updated] = await db.update(users).set({ ...rest, updatedAt: Date.now() }).where(eq(users.id, id)).returning();
      await writeAudit(ctx.user.id, "update", "user", id, { ...before, passwordHash: undefined }, { ...updated, passwordHash: undefined });
      const { passwordHash, ...safe } = updated;
      return safe;
    }),
});
