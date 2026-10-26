import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure, protectedProcedure } from "../trpc";
import { users } from "../schema";
import { eq } from "drizzle-orm";
import { hashPassword, comparePassword } from "../auth";
import { writeAudit } from "../ledger";
import { toHalfWidth } from "../textNormalize";

const roleSchema = z.enum(["super_admin", "finance_staff", "viewer", "teacher_self", "salesperson_self"]);

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
        password: z.string().min(6),
        name: z.string().min(1),
        role: roleSchema,
        linkedTeacherId: z.number().nullable().optional(),
        linkedSalespersonId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
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

  /** 任何登入使用者都可以修改自己的顯示姓名（例如預設種子帳號的「系統管理員」） */
  changeOwnName: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const [before] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "帳號不存在" });
      const [updated] = await db
        .update(users)
        .set({ name: input.name, updatedAt: Date.now() })
        .where(eq(users.id, ctx.user.id))
        .returning();
      await writeAudit(
        db,
        ctx.user.id,
        "update",
        "user",
        ctx.user.id,
        { ...before, passwordHash: undefined },
        { ...updated, passwordHash: undefined }
      );
      const { passwordHash, ...safe } = updated;
      return safe;
    }),

  /** 任何登入使用者都可以修改自己的密碼（需先驗證目前密碼） */
  changeOwnPassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(6),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const [row] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "帳號不存在" });
      const ok = await comparePassword(input.currentPassword, row.passwordHash);
      if (!ok) throw new TRPCError({ code: "UNAUTHORIZED", message: "目前密碼不正確" });
      const passwordHash = await hashPassword(input.newPassword);
      await db.update(users).set({ passwordHash, updatedAt: Date.now() }).where(eq(users.id, ctx.user.id));
      await writeAudit(db, ctx.user.id, "update", "user", ctx.user.id, { passwordHash: "***" }, { passwordHash: "***(changed by self)" });
      return { success: true };
    }),
});
