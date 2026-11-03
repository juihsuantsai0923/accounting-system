import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./helpers";
import { appRouter } from "../server/routers/index";

test("帳號申請：核准建立帳號並綁定新增的出貨員、要綁定才能核准、拒絕後可刪紀錄", async () => {
  const { db, sqlite } = makeDb();
  const now = Date.now();
  const add = (email: string, name: string, role: string) =>
    sqlite.prepare("INSERT INTO account_requests (email, name, requested_role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(email, name, role, now, now);
  add("ship@gmail.com", "阿明", "shipper");
  add("sales@gmail.com", "阿華", "salesperson");
  const admin = appRouter.createCaller({ db, user: { id: 3, role: "super_admin" } } as any);
  const teacher = appRouter.createCaller({ db, user: { id: 4, role: "teacher_self", linkedTeacherId: 3 } } as any);

  await assert.rejects(teacher.accountRequests.list(), /需要管理員權限/);
  assert.equal(await admin.accountRequests.pendingCount(), 2);

  const [r2, r1] = await admin.accountRequests.list();
  await assert.rejects(admin.accountRequests.approve({ id: r1.id, role: "shipper_self" }), /請選擇要綁定的人/);
  const { userId } = await admin.accountRequests.approve({ id: r1.id, role: "shipper_self", newPersonName: "阿明" });
  const user = sqlite.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
  const shipper = sqlite.prepare("SELECT * FROM shippers WHERE id = ?").get(user.linked_shipper_id) as any;
  assert.deepEqual([user.email, user.role, shipper.name], ["ship@gmail.com", "shipper_self", "阿明"]);
  await assert.rejects(admin.accountRequests.approve({ id: r1.id, role: "shipper_self", newPersonName: "阿明" }), /已經處理過/);

  await admin.accountRequests.reject({ id: r2.id });
  assert.equal(await admin.accountRequests.pendingCount(), 0);
  await admin.accountRequests.delete({ id: r2.id });
  assert.equal((await admin.accountRequests.list()).length, 1);
});
