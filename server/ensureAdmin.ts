import { db } from "./db";
import { users, teachers, salespeople, expenseTypes, courses } from "./schema";
import { hashPassword } from "./auth";

/**
 * 首次啟動時（資料庫裡完全沒有使用者）自動建立一組管理員帳號，
 * 讓部署到新環境時不需要額外手動執行 seed 腳本。
 * 可用環境變數 ADMIN_EMAIL / ADMIN_PASSWORD 指定帳密，否則使用預設值
 * （admin@example.com / admin123 ——正式環境請務必登入後立刻更換密碼）。
 */
export async function ensureAdmin() {
  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) return;

  const email = process.env.ADMIN_EMAIL || "admin@example.com";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    email,
    passwordHash,
    name: "系統管理員",
    role: "super_admin",
  });

  console.log(`✅ 首次啟動，已自動建立管理員帳號：${email} / ${password}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log("⚠️  這是預設密碼，正式上線前請務必登入後在「管理面板」更換，或改用 ADMIN_PASSWORD 環境變數指定。");
  }

  // 順手建立幾筆示範資料，方便第一次上線就能看到系統怎麼運作
  const teacherRows = await db.select().from(teachers).limit(1);
  if (teacherRows.length === 0) {
    const [teacher1] = await db.insert(teachers).values({ name: "蔡老師" }).returning();
    const [salesperson1] = await db.insert(salespeople).values({ name: "林推銷" }).returning();
    await db.insert(expenseTypes).values([
      { name: `${teacher1.name}薪水`, teacherId: teacher1.id },
      { name: `${salesperson1.name}薪水`, salespersonId: salesperson1.id },
      { name: "辦公用品" },
    ]);
    await db.insert(courses).values([{ name: "示範課程", type: "personal" }]);
  }
}
