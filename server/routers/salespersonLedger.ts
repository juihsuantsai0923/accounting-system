import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { salespersonLedger } from "../schema";
import { asc, eq } from "drizzle-orm";

export const salespersonLedgerRouter = router({
  list: protectedProcedure.input(z.object({ salespersonId: z.number() })).query(async ({ ctx, input }) => {
    let salespersonId = input.salespersonId;
    if (ctx.user.role === "salesperson_self") {
      if (!ctx.user.linkedSalespersonId) return [];
      salespersonId = ctx.user.linkedSalespersonId;
    } else if (ctx.user.role === "teacher_self") {
      throw new TRPCError({ code: "FORBIDDEN", message: "無權查看推銷者記帳表" });
    }
    return db
      .select()
      .from(salespersonLedger)
      .where(eq(salespersonLedger.salespersonId, salespersonId))
      .orderBy(asc(salespersonLedger.id));
  }),
});
