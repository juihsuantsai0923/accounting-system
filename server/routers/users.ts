import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../trpc";
import { users } from "../schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth";
import { writeAudit } from "../ledger";
import { toHalfWidth } from "../textNormalize";

const roleSchema = z.enum(["super_admin", "finance_staff", "teacher_self", "salesperson_self", "shipper_self"]);

// 先把全形字元轉半形再驗證格式，避免中文輸入法全形模式打出來的 email（例如 "＠" 而不是 "@"）
// 被 .email() 擋下來卻只顯示看不懂的 "Invalid email"。
const emailSchema = z.preprocess((val) => (typeof val === "string" ? toHalfWidth(val) : val), z.string().email());

export const usersRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(users).orderBy(users.id);
    return rows.map(({ passwordHash, ...rest }) => rest);
  }),

  create: adminProcedure
    .input(
      z.object({
        email: emailSchema,
        // 大家都用 Google 登入；沒給密碼就存一組隨機字串的雜湊（等於沒有密碼，不能用密碼登入）
        password: z.string().min(6).optional(),
        name: z.string().min(1),
        role: roleSchema,
        linkedTeacherId: z.number().nullable().optional(),
        linkedSalespersonId: z.number().nullable().optional(),
        linkedShipperId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const random = [...globalThis.crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const passwordHash = await hashPassword(input.password ?? random);
      const [created] = await db
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          name: input.name,
          role: input.role,
          linkedTeacherId: input.linkedTeacherId ?? null,
          linkedSalespersonId: input.linkedSalespersonId ?? null,
          linkedShipperId: input.linkedShipperId ?? null,
        })
        .returning();
      await writeAudit(db, ctx.user.id, "create", "user", created.id, null, { ...created, passwordHash: undefined });
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
        linkedShipperId: z.number().nullable().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const { id, ...rest } = input;
      const [before] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      const [updated] = await db.update(users).set({ ...rest, updatedAt: Date.now() }).where(eq(users.id, id)).returning();
      await writeAudit(db, ctx.user.id, "update", "user", id, { ...before, passwordHash: undefined }, { ...updated, passwordHash: undefined });
      const { passwordHash, ...safe } = updated;
      return safe;
    }),

  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = ctx.db;
    if (input.id === ctx.user.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "不能刪除自己目前登入中的帳號" });
    }
    const [before] = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    await db.delete(users).where(eq(users.id, input.id));
    await writeAudit(db, ctx.user.id, "delete", "user", input.id, { ...before, passwordHash: undefined }, null);
  }),
});
