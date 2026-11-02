import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { teacherLedger } from "../schema";
import { asc, eq } from "drizzle-orm";
import { withBuyer } from "../withBuyer";

export const teacherLedgerRouter = router({
  list: protectedProcedure.input(z.object({ teacherId: z.number() })).query(async ({ ctx, input }) => {
    let teacherId = input.teacherId;
    if (ctx.user.role === "teacher_self") {
      if (!ctx.user.linkedTeacherId) return [];
      teacherId = ctx.user.linkedTeacherId;
    } else if (ctx.user.role === "salesperson_self") {
      throw new TRPCError({ code: "FORBIDDEN", message: "無權查看教師記帳表" });
    }
    return withBuyer(ctx.db, await ctx.db.select().from(teacherLedger).where(eq(teacherLedger.teacherId, teacherId)).orderBy(asc(teacherLedger.id)));
  }),

  // 子記帳表只能看，不能直接改或刪：每一筆都是從帳本的分潤、薪水撥款、代墊自動產生的，要改請改帳本或代墊管理。
});
