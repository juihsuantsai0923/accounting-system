import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./helpers";
import { levelHistory, levelOf, thresholdOf } from "../client/src/lib/levels";
import { buildCustomers, buildPnL, newVsReturning, type AEntry } from "../client/src/lib/analytics";
import { runDueRecurring, twDate } from "../server/recurring";
import { checkIntegrity } from "../server/integrity";
import { orderMessage, ordersToShip, shipperShippingMessage } from "../server/lineNotify";

test("等級門檻：1 萬起、每 10 級步距變大", () => {
  assert.equal(thresholdOf(1), 10_000);
  assert.equal(thresholdOf(10), 100_000);
  assert.equal(thresholdOf(11), 120_000);
  assert.equal(thresholdOf(20), 300_000);
  assert.equal(thresholdOf(30), 800_000);
  assert.equal(thresholdOf(40), 1_800_000);
  assert.equal(thresholdOf(50), 3_800_000);
  assert.equal(thresholdOf(51), 4_300_000);
  assert.equal(levelOf(9_999).level, 0);
  const lv = levelOf(125_000);
  assert.equal(lv.level, 11);
  assert.equal(lv.tier.title, "成長");
  assert.equal(lv.toNext, 15_000);
  assert.equal(levelOf(100_000).tier.title, "起步"); // Lv10 還是起步
});

test("升級紀錄：一筆大收入可以連升好幾級", () => {
  const h = levelHistory([
    { amount: 5_000, createdAt: 1 },
    { amount: 26_000, createdAt: 2 },
  ]);
  assert.deepEqual(h.map((x) => [x.level, x.at]), [[1, 2], [2, 2], [3, 2]]);
});

const e = (over: Partial<AEntry>): AEntry => ({
  id: 1,
  type: "income",
  itemName: "x",
  categoryId: 1,
  categoryName: "書籍",
  amount: 0,
  note: null,
  incomeSource: "book",
  breakdown: null,
  distributed: 0,
  salaryTeacherId: null,
  salarySalespersonId: null,
  createdAt: new Date(2026, 9, 5).getTime(),
  ...over,
});

test("損益表：分潤算成本、薪水撥款不重複算、創始基金不算營業額", () => {
  const rows = [
    e({ id: 1, amount: 27_000, incomeSource: "tutoring", categoryName: "小班家教", distributed: 24_300 }),
    e({ id: 2, amount: 3_300, distributed: 2_475 }),
    e({ id: 3, type: "expense", amount: 24_300, categoryName: "薪水－蔡睿軒", salaryTeacherId: 2, distributed: 24_300, incomeSource: null }),
    e({ id: 4, type: "expense", amount: 500, categoryName: "網站訂閱費", incomeSource: null }),
    e({ id: 5, amount: 100_000, categoryName: "創始基金", incomeSource: "other", distributed: 100_000 }),
  ];
  const p = buildPnL(rows, "month", new Set()).get("2026-10")!;
  assert.equal(p.revenue, 30_300);
  assert.equal(p.bySource.tutoring, 27_000);
  assert.equal(p.teacherShare, 26_775);
  assert.equal(p.gross, 3_525);
  assert.equal(p.expenses, 500);
  assert.equal(p.net, 3_025);
  assert.equal(p.nonRevenue, 100_000);
  assert.ok(buildPnL(rows, "quarter", new Set()).has("2026 Q4"));
});

test("客戶分析：用買家姓名算回購與購買組合", () => {
  const rows = [
    e({ id: 1, amount: 27_000, incomeSource: "tutoring", categoryName: "小班家教", itemName: "科學班物理衝刺班", note: "買家：王小明", createdAt: new Date(2026, 8, 1).getTime() }),
    e({ id: 2, amount: 1_580, itemName: "物理 上下冊刷題本", note: "買家：王小明｜官網訂單：LX-1", createdAt: new Date(2026, 9, 1).getTime() }),
    e({ id: 3, amount: 880, itemName: "地科刷題本", note: "買家：李大華" }),
    e({ id: 4, amount: 300, itemName: "行事曆" }),
  ];
  const { customers, noBuyer } = buildCustomers(rows, new Set());
  assert.equal(noBuyer, 1);
  const wang = customers.find((c) => c.name === "王小明")!;
  assert.equal(wang.orders, 2);
  assert.equal(wang.total, 28_580);
  assert.deepEqual([...wang.sources].sort(), ["book", "tutoring"]);
  assert.deepEqual([...wang.subjects], ["物理"]);
  assert.deepEqual(newVsReturning(rows), [
    { month: "2026-09", newCount: 1, returning: 0 },
    { month: "2026-10", newCount: 1, returning: 1 },
  ]);
});

test("定期收支：到了日子才記、同月只記一次、餘額重算", async () => {
  const { db, sqlite } = makeDb();
  const now = Date.now();
  sqlite.prepare("INSERT INTO expense_types (id, name, created_at, updated_at) VALUES (9, '網站訂閱費', ?, ?)").run(now, now);
  sqlite.prepare("INSERT INTO expense_types (id, name, teacher_id, created_at, updated_at) VALUES (10, '薪水－蔡睿軒', 2, ?, ?)").run(now, now);
  const add = (cat: number, day: number) =>
    sqlite
      .prepare("INSERT INTO recurring_entries (type, item_name, category_id, amount, day_of_month, is_active, created_at, updated_at) VALUES ('expense', ?, ?, 350, ?, 1, ?, ?)")
      .run(`規則${cat}-${day}`, cat, day, now, now);
  add(9, 5);
  add(9, 20);
  add(10, 1); // 薪水類別不能自動記
  const day10 = new Date("2026-11-10T02:00:00Z").getTime(); // 台灣 11/10 上午
  assert.deepEqual(twDate(day10), { month: "2026-11", day: 10 });
  const first = await runDueRecurring(db, day10);
  assert.deepEqual(first.map((c) => c.itemName), ["規則9-5"]);
  assert.equal((await runDueRecurring(db, day10)).length, 0); // 同一天再跑不會重複
  const row = sqlite.prepare("SELECT category_name c, balance b, note n FROM main_ledger").get() as any;
  assert.equal(row.c, "網站訂閱費");
  assert.equal(row.b, -350);
  assert.match(row.n, /每月定期支出（2026-11）/);
  assert.deepEqual(await checkIntegrity(db), []);
  const day21 = new Date("2026-11-21T02:00:00Z").getTime();
  assert.deepEqual((await runDueRecurring(db, day21)).map((c) => c.itemName), ["規則9-20"]);
});

test("LINE 訂單通知文字", () => {
  const t = orderMessage(
    [{ orderNo: "LX-20261103-001", buyer: "王小明", total: 3300, statusLabel: "待付款", items: ["物理先修課程（四本全套）"] }],
    [{ orderNo: "LX-20261102-002", buyer: "李大華", from: "待付款", to: "課程已開通" }]
  );
  assert.match(t, /新訂單 LX-20261103-001/);
  assert.match(t, /NT\$3,300（待付款）/);
  assert.match(t, /LX-20261102-002（李大華）：待付款 → 課程已開通/);
});

test("出貨員只收待出貨：收到款、有書要寄才通知，訊息只列要寄的書、不含金額", () => {
  const courses = new Set(["科學班物理衝刺班 2026-2027"]);
  const toShip = ordersToShip(
    [
      // 新訂單還沒付款：不發
      { orderNo: "LX-20261120-001", buyer: "王小明", statusLabel: "待付款", items: ["物理先修課程（四本全套）", "運費"] },
      // 線上付款一進來就已開通：發，課程方案不列
      { orderNo: "LX-20261120-002", buyer: "陳小美", statusLabel: "課程已開通", items: ["數學工具先修課程（一年方案）", "科學班倒數行事曆（2027 4月-2028 3月）"] },
    ],
    [
      // 待付款 → 課程已開通（後台選「2. 待出貨」）：發，只列書
      { orderNo: "LX-20261119-003", buyer: "李大華", from: "待付款", to: "課程已開通", items: ["科學班物理衝刺班 2026-2027", "物理先修課程（上下冊刷題本）", "運費"] },
      // 只有課程：不發
      { orderNo: "LX-20261119-004", buyer: "林小安", from: "待付款", to: "課程已開通", items: ["科學班物理衝刺班 2026-2027"] },
      // 直接完成（書已寄）、已開通 → 完成、取消：不發
      { orderNo: "LX-20261119-005", buyer: "張小強", from: "待付款", to: "訂單完成", items: ["物理先修課程（四本全套）"] },
      { orderNo: "LX-20261119-006", buyer: "張小強", from: "課程已開通", to: "訂單完成", items: ["物理先修課程（四本全套）"] },
      { orderNo: "LX-20261119-007", buyer: "張小強", from: "待付款", to: "已取消", items: ["物理先修課程（四本全套）"] },
    ],
    courses
  );
  assert.deepEqual(
    toShip.map((o) => o.orderNo),
    ["LX-20261120-002", "LX-20261119-003"]
  );
  const text = shipperShippingMessage(toShip);
  assert.equal(
    text,
    "📦 待出貨 LX-20261120-002\n買家：陳小美\n要寄：科學班倒數行事曆（2027 4月-2028 3月）\n\n📦 待出貨 LX-20261119-003\n買家：李大華\n要寄：物理先修課程（上下冊刷題本）"
  );
  assert.ok(!text.includes("NT$"));
  assert.equal(shipperShippingMessage([]), "");
});
