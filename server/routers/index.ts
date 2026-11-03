import { router } from "../trpc";
import { authRouter } from "./auth";
import { teachersRouter } from "./teachers";
import { salespeopleRouter } from "./salespeople";
import { shippersRouter } from "./shippers";
import { coursesRouter } from "./courses";
import { expenseTypesRouter } from "./expenseTypes";
import { incomeTypesRouter } from "./incomeTypes";
import { mainLedgerRouter } from "./mainLedger";
import { teacherLedgerRouter } from "./teacherLedger";
import { salespersonLedgerRouter } from "./salespersonLedger";
import { advancePaymentsRouter } from "./advancePayments";
import { reportsRouter } from "./reports";
import { usersRouter } from "./users";
import { revenueSettingsRouter } from "./revenueSettings";
import { booksRouter } from "./books";
import { couponsRouter } from "./coupons";
import { webOrdersRouter } from "./webOrders";
import { recurringRouter } from "./recurring";
import { notifyRouter } from "./notify";
import { accountRequestsRouter } from "./accountRequests";

export const appRouter = router({
  auth: authRouter,
  teachers: teachersRouter,
  salespeople: salespeopleRouter,
  shippers: shippersRouter,
  courses: coursesRouter,
  expenseTypes: expenseTypesRouter,
  incomeTypes: incomeTypesRouter,
  mainLedger: mainLedgerRouter,
  teacherLedger: teacherLedgerRouter,
  salespersonLedger: salespersonLedgerRouter,
  advancePayments: advancePaymentsRouter,
  reports: reportsRouter,
  users: usersRouter,
  revenueSettings: revenueSettingsRouter,
  books: booksRouter,
  coupons: couponsRouter,
  webOrders: webOrdersRouter,
  recurring: recurringRouter,
  notify: notifyRouter,
  accountRequests: accountRequestsRouter,
});

export type AppRouter = typeof appRouter;
