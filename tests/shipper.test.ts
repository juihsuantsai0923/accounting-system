import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./helpers";
import { appRouter } from "../server/routers/index";
import { advanceItemName } from "../server/routers/advancePayments";
import { recalculateBalance } from "../server/ledger";
import { insertIncome } from "../server/routers/mainLedger";
import { combineIncome } from "../server/combineIncome";

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
  // 不能改別人的
  await assert.rejects(other.advancePayments.update({ id: a.id, buyer: "x", category: "運費", amount: "1" }), /只能修改自己的代墊/);
  await assert.rejects(other.advancePayments.delete({ id: a.id }), /只能修改自己的代墊/);
  await shipper.advancePayments.update({ id: a.id, orderName: "#1 物理", buyer: "王同學", category: "運費", amount: "80" });
  assert.equal((await shipper.advancePayments.list({}))[0].amount, 80);
});

test("出貨員代墊：審核通過計入同名推銷者的積欠薪水，改金額、刪除會重算，沒有另外核銷", async () => {
  const { admin, shipper, sqlite } = setup();
  const now = Date.now();
  sqlite.prepare("INSERT INTO salespeople (id, name, created_at, updated_at) VALUES (50, '小明', ?, ?)").run(now, now);
  const owed = () => (sqlite.prepare("SELECT personal_balance b FROM salesperson_ledger WHERE salesperson_id = 50 ORDER BY id DESC LIMIT 1").get() as any)?.b ?? 0;

  const a1 = await shipper.advancePayments.create({ buyer: "甲", category: "運費", amount: "60" });
  const a2 = await shipper.advancePayments.create({ buyer: "乙", category: "運費", amount: "65" });
  assert.equal(owed(), 0);
  for (const a of [a1, a2]) await admin.advancePayments.review({ id: a.id, approve: true });
  assert.equal(owed(), 125);
  assert.equal((await admin.mainLedger.list()).length, 0);

  const row = (await admin.reports.balanceOverview()).find((r: any) => r.name === "小明")!;
  assert.deepEqual([row.isShipper, row.totalBalance, row.unsettledAdvanceTotal], [true, 125, 125]);

  await admin.advancePayments.update({ id: a2.id, buyer: "乙", category: "運費", amount: "80" });
  assert.equal(owed(), 140);
  await shipper.advancePayments.delete({ id: a1.id });
  assert.equal(owed(), 80);
});

test("出貨員沒有同名推銷者時，代墊通過後自動建一個", async () => {
  const { admin, sqlite } = setup();
  const a = await admin.advancePayments.create({ recipientType: "shipper", recipientId: 2, buyer: "丙", category: "運費", amount: "70" });
  assert.equal(a.reviewStatus, "approved");
  const person = sqlite.prepare("SELECT id FROM salespeople WHERE name = '小華'").get() as any;
  assert.ok(person);
  const b = sqlite.prepare("SELECT personal_balance b FROM salesperson_ledger WHERE salesperson_id = ? ORDER BY id DESC").get(person.id) as any;
  assert.equal(b.b, 70);
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

test("老師自己登記代墊：審核通過才進子記帳表、修改要重審、退回可看到原因、看不到別人的", async () => {
  const { admin, db, sqlite } = setup();
  sqlite.prepare("INSERT OR IGNORE INTO teachers (id, name, created_at, updated_at) VALUES (7, '王老師', 0, 0), (8, '李老師', 0, 0)").run();
  const teacher = appRouter.createCaller({ db, user: { id: 20, name: "王老師", role: "teacher_self", linkedTeacherId: 7 } } as any);
  const other = appRouter.createCaller({ db, user: { id: 21, role: "teacher_self", linkedTeacherId: 8 } } as any);
  const rows = async () => ((await admin.teacherLedger.list({ teacherId: 7 } as any)) as any[]).filter((x) => x.sourceType === "advance");

  const a = await teacher.advancePayments.create({ recipientType: "teacher", recipientId: 8, buyer: "戊", category: "運費", amount: "60" });
  assert.deepEqual([a.recipientId, a.reviewStatus], [7, "pending"]);
  assert.equal(await admin.advancePayments.pendingReviewCount(), 1);
  assert.equal((await rows()).length, 0);
  assert.equal((await other.advancePayments.list({})).length, 0);
  await assert.rejects(other.advancePayments.delete({ id: a.id }), /只能修改自己的代墊/);
  await assert.rejects(teacher.advancePayments.review({ id: a.id, approve: true }), /只有系統管理員/);

  await admin.advancePayments.review({ id: a.id, approve: true });
  assert.equal(await admin.advancePayments.pendingReviewCount(), 0);
  assert.equal((await rows())[0].personalBalance, 60);
  await assert.rejects(admin.advancePayments.review({ id: a.id, approve: true }), /已經審核過/);

  await teacher.advancePayments.update({ id: a.id, buyer: "戊", category: "運費", amount: "90" });
  assert.equal(await admin.advancePayments.pendingReviewCount(), 1);
  assert.equal((await rows()).length, 0);

  await admin.advancePayments.review({ id: a.id, approve: false, note: "金額不對" });
  const [rejected] = await teacher.advancePayments.list({});
  assert.deepEqual([rejected.reviewStatus, rejected.reviewNote], ["rejected", "金額不對"]);
});

test("管理員切成老師身分登記的代墊不用審核", async () => {
  const { admin, db, sqlite } = setup();
  sqlite.prepare("INSERT OR IGNORE INTO teachers (id, name, created_at, updated_at) VALUES (7, '王老師', 0, 0)").run();
  const acting = appRouter.createCaller({ db, user: { id: 3, role: "teacher_self", realRole: "super_admin", linkedTeacherId: 7 } } as any);
  const a = await acting.advancePayments.create({ buyer: "己", category: "運費", amount: "60" });
  assert.equal(a.reviewStatus, "approved");
  assert.equal(await admin.advancePayments.pendingReviewCount(), 0);
});

test("剩餘公積金：每筆記完後的數字，代墊算欠款，現在的數字跟儀表板算法一致", async () => {
  const { admin, shipper, sqlite } = setup();
  const now = Date.now();
  sqlite.prepare("INSERT INTO income_types (id, name, created_at, updated_at) VALUES (900, '測試收入', ?, ?)").run(now, now);
  sqlite.prepare("INSERT INTO expense_types (id, name, created_at, updated_at) VALUES (900, '測試支出', ?, ?)").run(now, now);
  sqlite.prepare("INSERT INTO teachers (id, name, created_at, updated_at) VALUES (900, '老師甲', ?, ?)").run(now, now);

  await admin.mainLedger.create({
    type: "income",
    itemName: "收入一",
    categoryId: 900,
    amount: "1000",
    distributions: [{ type: "teacher", recipientId: 900, amount: "600" }],
  });
  await admin.mainLedger.create({ type: "expense", itemName: "公帳", categoryId: 900, amount: "100" });
  assert.deepEqual((await admin.mainLedger.list()).map((e) => e.reserveAfter), [400, 300]);
  assert.equal(await admin.mainLedger.reserveNow(), 300);

  // 待審核的代墊不算，通過後算欠款；帳本最後一筆之後才發生的只影響現在的數字
  const a = await shipper.advancePayments.create({ buyer: "甲", category: "運費", amount: "50" });
  assert.equal(await admin.mainLedger.reserveNow(), 300);
  await admin.advancePayments.review({ id: a.id, approve: true });
  assert.equal(await admin.mainLedger.reserveNow(), 250);
  assert.deepEqual((await admin.mainLedger.list()).map((e) => e.reserveAfter), [400, 300]);

  const rows = await admin.mainLedger.list();

  // 跟儀表板算法核對：餘額 − 子記帳表餘額
  const overview = await admin.reports.balanceOverview();
  const balance = rows[rows.length - 1].balance;
  assert.equal(await admin.mainLedger.reserveNow(), balance - overview.reduce((t, r) => t + r.totalBalance, 0));
});

test("重算子記帳表餘額：修好對不上的那筆，沒變的不重寫", async () => {
  const { db, admin, sqlite } = setup();
  const now = Date.now();
  sqlite.prepare("INSERT INTO expense_types (id, name, created_at, updated_at) VALUES (901, '測試', ?, ?)").run(now, now);
  sqlite.prepare("INSERT INTO income_types (id, name, created_at, updated_at) VALUES (901, '測試', ?, ?)").run(now, now);
  sqlite.prepare("INSERT INTO teachers (id, name, created_at, updated_at) VALUES (901, '老師乙', ?, ?)").run(now, now);
  for (const amount of ["100", "200"]) {
    await admin.mainLedger.create({
      type: "income",
      itemName: "收入",
      categoryId: 901,
      amount,
      distributions: [{ type: "teacher", recipientId: 901, amount }],
    });
  }
  const rows = () => sqlite.prepare("SELECT id, personal_balance b, updated_at u FROM teacher_ledger WHERE teacher_id = 901 ORDER BY id").all() as any[];
  const [first, last] = rows();
  sqlite.prepare("UPDATE teacher_ledger SET updated_at = 1 WHERE id = ?").run(first.id);
  sqlite.prepare("UPDATE teacher_ledger SET personal_balance = 0 WHERE id = ?").run(last.id);

  assert.equal(await recalculateBalance(db, "teacher", 901), 300);
  const after = rows();
  assert.equal(after[1].b, 300);
  assert.equal(after[0].u, 1);
});

test("多品項訂單：子記帳表的原始金額是該品項的金額，不是整張訂單", async () => {
  const { db, sqlite } = setup();
  const now = Date.now();
  sqlite.prepare("INSERT INTO teachers (id, name, created_at, updated_at) VALUES (902, '老師丙', ?, ?)").run(now, now);
  const dist = (amount: number) => [{ type: "teacher" as const, recipientId: 902, amount, role: "owner" as const, itemNameSuffix: "分潤" }];
  const c = combineIncome([
    { source: "tutoring", name: "衝刺班", categoryId: 1, categoryName: "小班家教", amount: 27000, distributions: dist(24300), personalLabel: "衝刺班" },
    { source: "book", name: "刷題本", categoryId: 2, categoryName: "書籍", amount: 1000, distributions: dist(650), personalLabel: "刷題本" },
  ]);
  await insertIncome(db, 3, { itemName: c.itemName, categoryId: 1, categoryName: c.categoryName, amount: c.amount, incomeSource: c.incomeSource, breakdown: c.breakdown }, c.distributions, (d) => d.itemNameSuffix);
  const rows = sqlite.prepare("SELECT original_amount o, personal_amount p FROM teacher_ledger WHERE teacher_id = 902 ORDER BY id").all();
  assert.deepEqual(rows, [
    { o: 27000, p: 24300 },
    { o: 1000, p: 650 },
  ]);
});

test("應付總覽：出貨員排在老師後面，推銷者最後", async () => {
  const { admin, sqlite } = setup();
  const now = Date.now();
  sqlite.prepare("DELETE FROM shippers").run();
  sqlite.prepare("DELETE FROM salespeople").run();
  sqlite.prepare("INSERT INTO shippers (id, name, created_at, updated_at) VALUES (1, '余彩霞', ?, ?)").run(now, now);
  const sp = sqlite.prepare("INSERT INTO salespeople (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)");
  sp.run(1, "網紅甲", now, now);
  sp.run(2, "余彩霞", now, now);
  const rows = await admin.reports.balanceOverview();
  const tail = rows.filter((r) => r.recipientType === "salesperson").map((r) => [r.name, r.isShipper]);
  assert.deepEqual(tail, [["余彩霞", true], ["網紅甲", false]]);
  assert.ok(rows.findIndex((r) => r.name === "余彩霞") > rows.findLastIndex((r) => r.recipientType === "teacher"));
});

test("多張訂單代墊：填總金額記成一筆，出貨員待審核、管理員直接算數，已完成的訂單不列出", async () => {
  const { admin, shipper, sqlite } = setup();
  const now = Date.now();
  sqlite.prepare("INSERT INTO teachers (id, name, created_at, updated_at) VALUES (903, '老師丁', ?, ?)").run(now, now);
  const order = sqlite.prepare("INSERT INTO web_orders (order_no, ordered_at, buyer, total, status_label, tab, items, synced_at) VALUES (?, ?, ?, 100, '課程已開通', 'pending', '[]', ?)");
  order.run("A1", now, "甲", now);
  order.run("A2", now, "乙", now);

  const orders = [
    { orderName: "#A1", orderNo: "A1", buyer: "甲" },
    { orderName: "#A2", orderNo: "A2", buyer: "乙" },
  ];
  await assert.rejects(shipper.advancePayments.createBatch({ category: "運費", amount: "0", orders }), /總金額必須大於 0/);
  assert.equal((await shipper.advancePayments.list({})).length, 0);

  // 多張訂單填總金額，只記一筆，每張訂單都算登記過
  assert.deepEqual(await shipper.advancePayments.createBatch({ category: "運費", amount: "125", note: "同批寄出", orders }), { count: 2, total: 125 });
  const rows = await shipper.advancePayments.list({});
  assert.deepEqual(rows.map((a) => [a.itemName, a.orderName, a.orderNo, a.amount, a.reviewStatus, a.note]), [
    ["甲 等 2 人_運費", "2 張訂單：甲、乙", "A1,A2", 125, "pending", "同批寄出"],
  ]);
  const options = await shipper.advancePayments.orderOptions();
  for (const no of ["A1", "A2"]) assert.deepEqual(options.find((o) => o.orderNo === no)?.registeredCategories, ["運費"]);

  // 合成一筆的代墊可以修改金額
  await shipper.advancePayments.update({ id: rows[0].id, orderName: rows[0].orderName!, orderNo: rows[0].orderNo!, buyer: rows[0].buyer!, category: "運費", amount: "130" });
  assert.equal((await shipper.advancePayments.list({}))[0].amount, 130);

  // 退回的訂單可以重新登記，不算登記過
  await admin.advancePayments.review({ id: rows[0].id, approve: false });
  assert.deepEqual((await shipper.advancePayments.orderOptions()).find((o) => o.orderNo === "A2")?.registeredCategories, []);

  // 30 天內下訂的已完成訂單仍列出並標已完成；超過 30 天的不列
  sqlite.prepare("UPDATE web_orders SET tab = 'completed' WHERE order_no = 'A1'").run();
  assert.deepEqual(
    (await shipper.advancePayments.orderOptions()).map((o) => [o.orderNo, o.completed]).sort(),
    [["A1", true], ["A2", false]],
  );
  sqlite.prepare("UPDATE web_orders SET ordered_at = ? WHERE order_no = 'A1'").run(Date.now() - 31 * 86400_000);
  assert.deepEqual((await shipper.advancePayments.orderOptions()).map((o) => o.orderNo), ["A2"]);

  // 同一人下兩張訂單算一人；管理員替老師登記不用審核，直接進子記帳表
  await admin.advancePayments.createBatch({
    recipientType: "teacher",
    recipientId: 903,
    category: "運費",
    amount: "60",
    orders: orders.map((o) => ({ ...o, buyer: "甲" })),
  });
  const balances = sqlite.prepare("SELECT item_name i, personal_balance b FROM teacher_ledger WHERE teacher_id = 903 ORDER BY id").all();
  assert.deepEqual(balances, [{ i: "甲_運費", b: 60 }]);
  await assert.rejects(admin.advancePayments.createBatch({ category: "運費", amount: "60", orders }), /請選擇代墊的人/);
});

test("官網推送寄件代碼：存進訂單、代墊選單帶出來；同一個代碼算一包", async () => {
  const { db, sqlite, shipper } = setup();
  const { handlePushRequest, PUSH_KEY_NAME } = await import("../server/webOrdersSync");
  const { packageCount } = await import("../client/src/components/BatchOrderPicker");
  const key = "lxs_test_key";
  const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  sqlite.prepare("INSERT INTO integration_keys (name, key_hash, created_at) VALUES (?, ?, ?)").run(PUSH_KEY_NAME, hash, Date.now());
  const order = (orderNo: string, buyer: string, trackingCode?: string | null) => ({
    orderNo,
    orderedAt: new Date().toISOString(),
    buyer,
    total: 100,
    status: "paid",
    items: [],
    ...(trackingCode === undefined ? {} : { trackingCode }),
  });
  const push = (orders: unknown[]) => handlePushRequest(db, `Bearer ${key}`, { orders });
  assert.equal((await push([order("LX-20261108-001", "甲", "H3827065"), order("LX-20261108-002", "甲", "H3827065"), order("LX-20261108-003", "乙", null)]))[0], 200);

  const options = await shipper.advancePayments.orderOptions();
  const code = (no: string) => options.find((o) => o.orderNo === no)?.trackingCode;
  assert.deepEqual([code("LX-20261108-001"), code("LX-20261108-002"), code("LX-20261108-003")], ["H3827065", "H3827065", null]);
  assert.equal(packageCount(options), 2);

  // 舊版官網沒送這欄：保留原本的代碼；送 null：清掉
  await push([order("LX-20261108-001", "甲")]);
  assert.equal((await shipper.advancePayments.orderOptions()).find((o) => o.orderNo === "LX-20261108-001")?.trackingCode, "H3827065");
  await push([order("LX-20261108-001", "甲", null)]);
  assert.equal((await shipper.advancePayments.orderOptions()).find((o) => o.orderNo === "LX-20261108-001")?.trackingCode, null);
});
