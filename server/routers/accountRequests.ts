import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../trpc";
import { accountRequests, users, teachers, salespeople, shippers } from "../schema";
import { desc, eq, sql } from "drizzle-orm";
import { hashPassword } from "../auth";
import { writeAudit } from "../ledger";
import { upsertSalaryExpenseType } from "../expenseTypeHelpers";

const roleSchema = z.enum(["super_admin", "finance_staff", "teacher_self", "salesperson_self", "shipper_self"]);

/**
 * 帳號申請（管理面板「帳號申請」）：沒有帳號的人用 Google 登入後填的申請。
 * 核准＝建立帳號（角色由管理員決定，本人帳號一定要綁定一個人；名單裡還沒有的人可以順便新增）。
 */
export const accountRequestsRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(accountRequests).orderBy(desc(accountRequests.id));
  }),

  pendingCount: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select({ id: accountRequests.id }).from(accountRequests).where(eq(accountRequests.status, "pending"));
    return rows.length;
  }),

  approve: adminProcedure
    .input(
      z.object({
        id: z.number(),
        role: roleSchema,
        /** 綁定既有的人 */
        linkedId: z.number().optional(),
        /** 名單裡還沒有：用這個名字新增一位教師／推銷者／出貨員再綁定 */
        newPersonName: z.string().trim().min(1).max(30).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const [req] = await db.select().from(accountRequests).where(eq(accountRequests.id, input.id)).limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆申請" });
      if (req.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "這筆申請已經處理過了" });
      const [dup] = await db.select().from(users).where(sql`lower(${users.email}) = ${req.email}`).limit(1);
      if (dup) throw new TRPCError({ code: "BAD_REQUEST", message: "這個 Gmail 已經有帳號了" });

      let linkedId = input.linkedId;
      const kind = input.role === "teacher_self" ? "teacher" : input.role === "salesperson_self" ? "salesperson" : input.role === "shipper_self" ? "shipper" : null;
      if (kind && !linkedId) {
        if (!input.newPersonName) throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇要綁定的人，或填名字新增一位" });
        const name = input.newPersonName;
        if (kind === "teacher") {
          const [t] = await db.insert(teachers).values({ name }).returning();
          await upsertSalaryExpenseType(db, { type: "teacher", id: t.id, name });
          linkedId = t.id;
        } else if (kind === "salesperson") {
          const [s] = await db.insert(salespeople).values({ name }).returning();
          await upsertSalaryExpenseType(db, { type: "salesperson", id: s.id, name });
          linkedId = s.id;
        } else {
          const [s] = await db.insert(shippers).values({ name }).returning();
          linkedId = s.id;
        }
      }

      const random = [...globalThis.crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const [created] = await db
        .insert(users)
        .values({
          email: req.email,
          passwordHash: await hashPassword(random),
          name: req.name,
          role: input.role,
          linkedTeacherId: kind === "teacher" ? linkedId : null,
          linkedSalespersonId: kind === "salesperson" ? linkedId : null,
          linkedShipperId: kind === "shipper" ? linkedId : null,
        })
        .returning();
      await db
        .update(accountRequests)
        .set({ status: "approved", decidedBy: ctx.user.id, decidedAt: Date.now(), updatedAt: Date.now() })
        .where(eq(accountRequests.id, input.id));
      await writeAudit(db, ctx.user.id, "approve", "accountRequest", input.id, req, { userId: created.id, role: input.role, linkedId });
      return { userId: created.id };
    }),

  reject: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const [req] = await ctx.db.select().from(accountRequests).where(eq(accountRequests.id, input.id)).limit(1);
    if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆申請" });
    await ctx.db
      .update(accountRequests)
      .set({ status: "rejected", decidedBy: ctx.user.id, decidedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(accountRequests.id, input.id));
    await writeAudit(ctx.db, ctx.user.id, "reject", "accountRequest", input.id, req, null);
  }),

  /** 刪掉申請紀錄：被拒絕的人就可以重新申請 */
  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(accountRequests).where(eq(accountRequests.id, input.id));
  }),
});
