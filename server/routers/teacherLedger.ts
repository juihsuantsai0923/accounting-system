import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { teacherLedger } from "../schema";
import { asc, eq } from "drizzle-orm";

export const teacherLedgerRouter = router({
  list: protectedProcedure.input(z.object({ teacherId: z.number() })).query(async ({ ctx, input }) => {
    let teacherId = input.teacherId;
    if (ctx.user.role === "teacher_self") {
      if (!ctx.user.linkedTeacherId) return [];
      teacherId = ctx.user.linkedTeacherId;
    } else if (ctx.user.role === "salesperson_self") {
      throw new TRPCError({ code: "FORBIDDEN", message: "無權查看教師記帳表" });
    }
    return db.select().from(teacherLedger).where(eq(teacherLedger.teacherId, teacherId)).orderBy(asc(teacherLedger.id));
  }),
});
