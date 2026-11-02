import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { salespersonLedger } from "../schema";
import { asc, eq } from "drizzle-orm";
import { withBuyer } from "../withBuyer";

export const salespersonLedgerRouter = router({
  list: protectedProcedure.input(z.object({ salespersonId: z.number() })).query(async ({ ctx, input }) => {
    let salespersonId = input.salespersonId;
    if (ctx.user.role === "salesperson_self") {
      if (!ctx.user.linkedSalespersonId) return [];
      salespersonId = ctx.user.linkedSalespersonId;
    } else if (ctx.user.role === "teacher_self") {
      throw new TRPCError({ code: "FORBIDDEN", message: "無權查看推銷者記帳表" });
    }
    return withBuyer(
      ctx.db,
      await ctx.db.select().from(salespersonLedger).where(eq(salespersonLedger.salespersonId, salespersonId)).orderBy(asc(salespersonLedger.id))
    );
  }),

  // 子記帳表只能看，不能直接改或刪：每一筆都是從帳本的分潤、薪水撥款、代墊自動產生的，要改請改帳本或代墊管理。
});
