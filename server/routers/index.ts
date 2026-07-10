import { router } from "../trpc";
import { authRouter } from "./auth";
import { teachersRouter } from "./teachers";
import { salespeopleRouter } from "./salespeople";
import { coursesRouter } from "./courses";
import { expenseTypesRouter } from "./expenseTypes";
import { mainLedgerRouter } from "./mainLedger";
import { teacherLedgerRouter } from "./teacherLedger";
import { salespersonLedgerRouter } from "./salespersonLedger";
import { advancePaymentsRouter } from "./advancePayments";
import { reportsRouter } from "./reports";
import { usersRouter } from "./users";

export const appRouter = router({
  auth: authRouter,
  teachers: teachersRouter,
  salespeople: salespeopleRouter,
  courses: coursesRouter,
  expenseTypes: expenseTypesRouter,
  mainLedger: mainLedgerRouter,
  teacherLedger: teacherLedgerRouter,
  salespersonLedger: salespersonLedgerRouter,
  advancePayments: advancePaymentsRouter,
  reports: reportsRouter,
  users: usersRouter,
});

export type AppRouter = typeof appRouter;
