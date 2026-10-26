import { expenseTypes } from "./schema";
import { eq } from "drizzle-orm";

/**
 * 建立／更新一位老師或推銷者對應的「薪水」支出類型，安全處理名稱撞名的情況。
 *
 * expense_types.name 有 UNIQUE 限制，如果直接無腦 insert，只要曾經有人手動在「支出類型管理」
 * 建立過同名的一般支出類型（例如管理員手動新增了一筆叫「王老師薪水」的類別，後來才把「王老師」
 * 建成正式教師），或是老師/推銷者剛好同名，insert 就會撞到 UNIQUE constraint 直接丟一個很難懂的
 * SQLite 錯誤，導致「新增教師／推銷者」這個 mutation 整個失敗——教師/推銷者本人那筆其實已經
 * insert 成功了，只是後面這步失敗讓整個請求回報錯誤，前端看起來就像「怎麼按都新增不了」。
 *
 * 這個函式改成：
 *   1. 如果這個人已經有對應的支出類型了，只更新名稱（同步改名用）。
 *   2. 如果沒有，但剛好已經存在一筆「未歸屬任何人」且同名的支出類型，直接把它「認領」過來用，
 *      不重複建立。
 *   3. 如果同名的類型已經歸屬別人（真的撞名），改用加上識別碼的名稱，確保一定能成功建立，
 *      不會讓呼叫端的 mutation 整個爆掉。
 */
export async function upsertSalaryExpenseType(
  db: any,
  recipient: { type: "teacher" | "salesperson"; id: number; name: string }
) {
  const ownerColumn = recipient.type === "teacher" ? expenseTypes.teacherId : expenseTypes.salespersonId;
  const desiredName = `${recipient.name}薪水`;

  const [existingForPerson] = await db.select().from(expenseTypes).where(eq(ownerColumn, recipient.id)).limit(1);
  if (existingForPerson) {
    if (existingForPerson.name !== desiredName) {
      await db.update(expenseTypes).set({ name: desiredName, updatedAt: Date.now() }).where(eq(expenseTypes.id, existingForPerson.id));
    }
    return;
  }

  const [sameName] = await db.select().from(expenseTypes).where(eq(expenseTypes.name, desiredName)).limit(1);
  if (!sameName) {
    await db.insert(expenseTypes).values({
      name: desiredName,
      ...(recipient.type === "teacher" ? { teacherId: recipient.id } : { salespersonId: recipient.id }),
    });
    return;
  }

  if (sameName.teacherId == null && sameName.salespersonId == null) {
    // 這筆同名的類型還沒被任何人領走，直接認領，不重複建立
    await db
      .update(expenseTypes)
      .set(recipient.type === "teacher" ? { teacherId: recipient.id } : { salespersonId: recipient.id })
      .where(eq(expenseTypes.id, sameName.id));
    return;
  }

  // 名稱真的撞到別人了，加上識別碼避免 UNIQUE constraint 讓新增教師/推銷者失敗
  await db.insert(expenseTypes).values({
    name: `${desiredName}（${recipient.type === "teacher" ? "教師" : "推銷者"} #${recipient.id}）`,
    ...(recipient.type === "teacher" ? { teacherId: recipient.id } : { salespersonId: recipient.id }),
  });
}
