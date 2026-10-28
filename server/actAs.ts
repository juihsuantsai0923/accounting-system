import { users } from "./schema";

type UserRow = typeof users.$inferSelect;

/**
 * 身分切換：同時是管理員又是老師的人（目前是蔡睿軒），可以選擇「用老師身分看」。
 * 前端帶 X-Act-As: teacher，這裡就把這次請求的角色降成 teacher_self，
 * 後端所有權限檢查都照老師的規則跑，看到的跟其他老師完全一樣。
 * realRole 記住原本的角色，讓前端知道可以切回管理員。
 */
export function applyActAs(user: UserRow | null, actAs: string | null | undefined) {
  if (!user) return null;
  const canSwitch = user.role === "super_admin" && !!user.linkedTeacherId;
  if (canSwitch && actAs === "teacher") return { ...user, role: "teacher_self", realRole: user.role };
  return { ...user, realRole: user.role };
}
