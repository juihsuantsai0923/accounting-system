import { db } from "./db";
import { users, teachers, salespeople, courses, expenseTypes } from "./schema";
import { hashPassword } from "./auth";
import { eq } from "drizzle-orm";

async function seed() {
  const existing = await db.select().from(users).where(eq(users.email, "admin@example.com")).limit(1);
  if (existing.length > 0) {
    console.log("已經有初始資料，略過 seed。");
    return;
  }

  const passwordHash = await hashPassword("admin123");
  await db.insert(users).values({
    email: "admin@example.com",
    passwordHash,
    name: "系統管理員",
    role: "super_admin",
  });

  const [teacher1] = await db.insert(teachers).values({ name: "蔡老師" }).returning();
  const [teacher2] = await db.insert(teachers).values({ name: "陳老師" }).returning();
  const [salesperson1] = await db.insert(salespeople).values({ name: "林推銷" }).returning();

  await db.insert(expenseTypes).values([
    { name: `${teacher1.name}薪水`, teacherId: teacher1.id },
    { name: `${teacher2.name}薪水`, teacherId: teacher2.id },
    { name: `${salesperson1.name}薪水`, salespersonId: salesperson1.id },
    { name: "辦公用品" },
    { name: "教材費" },
  ]);

  await db.insert(courses).values([
    { name: "高中物理", type: "personal" },
    { name: "國中數學", type: "collaborative" },
  ]);

  console.log("✅ 初始資料建立完成");
  console.log("   管理員登入帳號：admin@example.com");
  console.log("   管理員登入密碼：admin123");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
