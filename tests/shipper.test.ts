import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./helpers";
import { appRouter } from "../server/routers/index";
import { advanceItemName } from "../server/routers/advancePayments";

function setup() {
  const { db, sqlite } = makeDb();
  const now = Date.now();
  sqlite.prepare("INSERT INTO shippers (id, name, created_at, updated_at) VALUES (1, '小明', ?, ?), (2, '小華', ?, ?)").run(now, now, now, now);
  const admin = appRouter.createCaller({ db, user: { id: 3, role: "super_admin" } } as any);
  const shipper = appRouter.createCaller({ db, user: { id: 9, role: "shipper_self", linkedShipperId: 1 } } as any);
  const other = appRouter.createCaller({ db, user: { id: 10, role: "shipper_self", linkedShipperId: 2 } } as any);
  return { db, sqlite, admin, shipper, other };
}

test("代墊項目名稱：下訂人_類別，沒有下訂人用訂單名稱", () => {
  assert.equal(advanceItemName({ buyer: "羅燕鈴", category: "運費" }), "羅燕鈴_運費");
  assert.equal(advanceItemName({ buyer: "", orderName: "#123 物理", category: "其他" }), "#123 物理_其他");
});

test("出貨員：只能用代墊功能、只看得到自己的、可以新增類別", async () => {
  const { admin, shipper, other } = setup();
  const a = await shipper.advancePayments.create({ orderName: "#1 物理", buyer: "王同學", category: "運費", amount: "60" });
  assert.equal(a.recipientType, "shipper");
  assert.equal(a.recipientId, 1);
  await other.advancePayments.create({ buyer: "李同學", category: "包材", amount: "30" });
  assert.ok((await shipper.advancePayments.categories()).some((c) => c.name === "包材"));

  assert.equal((await shipper.advancePayments.list({})).length, 1);
  assert.equal((await admin.advancePayments.list({})).length, 2);

  await assert.rejects(shipper.mainLedger.list(), /出貨員只能使用代墊功能/);
  await assert.rejects(shipper.reports.balanceOverview(), /出貨員只能使用代墊功能/);
  await assert.rejects(shipper.teachers.list(), /出貨員只能使用代墊功能/);
  await assert.rejects(shipper.advancePayments.settle({ id: a.id }), /出貨員只能使用代墊功能/);
  // 不能改別人的
  await assert.rejects(other.advancePayments.update({ id: a.id, buyer: "x", category: "運費", amount: "1" }), /只能修改自己的代墊/);
  await assert.rejects(other.advancePayments.delete({ id: a.id }), /只能修改自己的代墊/);
  await shipper.advancePayments.update({ id: a.id, orderName: "#1 物理", buyer: "王同學", category: "運費", amount: "80" });
  assert.equal((await shipper.advancePayments.list({}))[0].amount, 80);
});

test("出貨員代墊核銷：依類別記帳本支出、刪掉支出代墊退回未核銷、核銷後出貨員不能改", async () => {
  const { admin, shipper } = setup();
  const a1 = await shipper.advancePayments.create({ buyer: "甲", category: "運費", amount: "60" });
  await shipper.advancePayments.create({ buyer: "乙", category: "運費", amount: "65" });
  await shipper.advancePayments.create({ buyer: "丙", category: "其他", amount: "20" });

  const r = await admin.advancePayments.settleShipper({ shipperId: 1 });
  assert.deepEqual([r.count, r.total, r.entries], [3, 145, 2]);
  const ledger = await admin.mainLedger.list();
  const fee = ledger.find((e: any) => e.categoryName === "運費")!;
  assert.equal(fee.amount, 125);
  assert.equal(ledger.find((e: any) => e.categoryName === "其他支出")!.amount, 20);
  assert.equal(ledger[ledger.length - 1].balance, -145);

  await assert.rejects(shipper.advancePayments.delete({ id: a1.id }), /已核銷/);
  await assert.rejects(admin.advancePayments.unsettle({ id: a1.id }), /請到帳本刪除那筆支出/);

  await admin.mainLedger.delete({ id: fee.id });
  const left = await admin.advancePayments.list({ status: "unsettled" });
  assert.equal(left.length, 2);
});

test("教師代墊照舊進子記帳表，修改金額會重算餘額", async () => {
  const { admin, db } = setup();
  const a = await admin.advancePayments.create({ recipientType: "teacher", recipientId: 2, buyer: "丁", category: "運費", amount: "60" });
  await admin.advancePayments.update({ id: a.id, buyer: "丁", category: "運費", amount: "90" });
  const rows = await appRouter.createCaller({ db, user: { id: 3, role: "super_admin" } } as any).teacherLedger.list({ teacherId: 2 } as any);
  const row = (rows as any[]).find((x) => x.advancePaymentId === a.id);
  assert.equal(row.personalAmount, 90);
  assert.equal(row.personalBalance, 90);
  assert.equal(row.itemName, "丁_運費");
});
