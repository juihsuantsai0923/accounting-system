import { teachers, salespeople, expenseTypes } from "./schema";
import { upsertSalaryExpenseType } from "./expenseTypeHelpers";

/**
 * 補齊「薪水」支出類型：每位老師／銷售員都應該有一筆對應的支出類型（teacherId／salespersonId
 * 指向他本人），支出頁的「薪水」精靈才能找到對應的人員選項。
 *
 * 推銷者在 salespeople.create 裡本來就會自動建立，但老師這邊過去漏掉了（在這一輪修正），
 * 所以既有的老師名單裡可能還有一批人沒有對應的薪水支出類型，需要在這裡一次補齊。
 * 用「select 現有資料再比對」而不是逐筆 upsert，是因為 SQLite／D1 都沒有簡單的
 * ON CONFLICT DO NOTHING 搭配這種跨欄位判斷，比對完再 insert 缺的最直接安全。
 * 全部查詢都很輕量（資料表通常只有幾十筆），可以放心每次請求都呼叫。
 */
export async function ensureSalaryExpenseTypes(db: any) {
  const [allTeachers, allSalespeople, allExpenseTypes] = await Promise.all([
    db.select().from(teachers),
    db.select().from(salespeople),
    db.select().from(expenseTypes),
  ]);

  const teacherIdsWithType = new Set(
    allExpenseTypes.filter((e: any) => e.teacherId != null).map((e: any) => e.teacherId)
  );
  const salespersonIdsWithType = new Set(
    allExpenseTypes.filter((e: any) => e.salespersonId != null).map((e: any) => e.salespersonId)
  );

  for (const t of allTeachers) {
    if (!teacherIdsWithType.has(t.id)) {
      // upsertSalaryExpenseType 會安全處理名稱撞到既有支出類型的情況，不會因為 UNIQUE
      // constraint 拋錯（那樣的話這個補齊流程會整個中斷，後面的老師/推銷者都補不到）。
      await upsertSalaryExpenseType(db, { type: "teacher", id: t.id, name: t.name });
    }
  }
  for (const s of allSalespeople) {
    if (!salespersonIdsWithType.has(s.id)) {
      await upsertSalaryExpenseType(db, { type: "salesperson", id: s.id, name: s.name });
    }
  }
}
