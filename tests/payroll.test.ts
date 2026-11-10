import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./helpers";
import { appRouter } from "../server/routers";
import { cutoffOf, nextPayday, paydayOfPayout, payrollTable } from "../server/payroll";
import { twDayStart, vatOf } from "../server/revenueCalc";
import { taxReserveOf } from "../server/routers/payroll";
import { reserveTrail } from "../server/ledger";

const at = (d: string, hour = 12) => twDayStart(d) + hour * 3600 * 1000;
const NOW = at("2026-11-10");

function setup() {
  const { db, sqlite } = makeDb();
  sqlite.prepare("UPDATE courses SET start_date = '2026-10-31', end_date = '2027-03-06' WHERE id = 4").run();
  const admin = appRouter.createCaller({ db, user: { id: 1, role: "super_admin" } } as any);
  /** 把一筆帳本記錄（和它的子記帳表列）改成指定時間入帳 */
  const dateEntry = (id: number, d: string) => {
    sqlite.prepare("UPDATE main_ledger SET created_at = ? WHERE id = ?").run(at(d), id);
    sqlite.prepare("UPDATE teacher_ledger SET created_at = ? WHERE main_ledger_id = ?").run(at(d), id);
  };
  return { db, sqlite, admin, dateEntry };
}

const PERIOD = twDayStart("2027-03-07") - twDayStart("2026-10-31"); // 物理衝刺班 10/31～3/6，共 127 天

test("發薪日：每月 15 日發上個月底以前到期的；撥款算在同一個月那次", () => {
  assert.equal(nextPayday(at("2026-11-10")), "2026-11-15");
  assert.equal(nextPayday(at("2026-11-15", 20)), "2026-11-15");
  assert.equal(nextPayday(at("2026-11-16")), "2026-12-15");
  assert.equal(nextPayday(at("2026-12-20")), "2027-01-15");
  assert.equal(cutoffOf("2026-12-15"), twDayStart("2026-12-01"));
  assert.equal(paydayOfPayout(at("2026-11-14")), "2026-11-15");
  assert.equal(paydayOfPayout(at("2026-11-20")), "2026-11-15");
  // 12/31 加發：12 月下旬的下一次是 12/31，到期算到 12 月底；12/16 以後的撥款算 12/31 那次
  assert.equal(nextPayday(at("2026-12-20"), true), "2026-12-31");
  assert.equal(cutoffOf("2026-12-31"), twDayStart("2027-01-01"));
  assert.equal(paydayOfPayout(at("2026-12-10"), true), "2026-12-15");
  assert.equal(paydayOfPayout(at("2026-12-28"), true), "2026-12-31");
});

test("登記前的帳（這一屆）入帳就到期，不攤提；12/31 加發 12 月的；先發了還沒到期的顯示已預付、不顯示負數", async () => {
  const { db, admin, dateEntry } = setup();
  const a = await admin.mainLedger.createTutoringIncome({ items: [{ courseId: 4, amount: 27000 }] });
  dateEntry(a.entry.id, "2026-10-20");
  const b = await admin.mainLedger.createTutoringIncome({ items: [{ courseId: 4, amount: 27000 }] });
  dateEntry(b.entry.id, "2026-12-10");
  const t = await payrollTable(db, NOW);
  const cai = t.people.find((p) => p.name === "蔡睿軒")!;
  const each = cai.balance / 2;
  assert.deepEqual(t.paydays, ["2026-11-15", "2026-12-15", "2026-12-31"]); // 沒有攤提，不用排到明年
  assert.deepEqual(cai.paydays.map((p) => p.due), [each, 0, each]);
  // 11/15 一次發完全部（含 12 月才入帳那筆）＝預付
  await admin.payroll.markPaid({ recipientType: "teacher", recipientId: 2, amount: cai.balance, payday: "2026-11-15" });
  const p = (await payrollTable(db, NOW)).people.find((x) => x.name === "蔡睿軒")!;
  assert.equal(p.next.payable, 0);
  assert.equal(p.next.prepaid, each);
  assert.equal(p.next.notYetDue, 0);
  assert.equal(p.balance, 0);
});

test("登記後的衝刺班按天攤提：上個月底以前入帳才算，插班生入班前的天數入帳後下一次一起發；書籍入帳就到期", async () => {
  const { db, admin, dateEntry } = setup();
  // 攤提只用在登記日以後入帳的（稅率設 0，這裡只看攤提）
  await admin.revenueSettings.updateTaxReserve({ vatRatePercent: 0, registrationDate: "2026-01-01", reserveFloor: 0, reserveFrozen: 0, payDec31: false });
  const a = await admin.mainLedger.createTutoringIncome({ items: [{ courseId: 4, amount: 27000 }] });
  dateEntry(a.entry.id, "2026-10-20");
  const b = await admin.mainLedger.createTutoringIncome({ items: [{ courseId: 4, amount: 27000 }] });
  dateEntry(b.entry.id, "2026-12-03"); // 12 月才入帳的插班生
  const c = await admin.mainLedger.createBookIncome({ lines: [{ bookId: 6, qty: 1 }], couponId: null, amount: 1580 });
  dateEntry(c.entry.id, "2026-11-05");

  const owner = 27000 - Math.round(27000 * 0.2); // 測試設定：公積金 10%＋行政費 10%
  const book = 1580 - Math.round(1580 * 0.35);
  const frac = (d: string) => Math.max(0, Math.min(1, (twDayStart(d) - twDayStart("2026-10-31")) / PERIOD));
  const t = await payrollTable(db, NOW);
  const cai = t.people.find((p) => p.name === "蔡睿軒")!;
  const cum = (pd: string) => cai.paydays.find((p) => p.payday === pd)!.cumVested;
  // 11/15：只有 10/20 那筆，到期 10/31 一天；11/5 的書要等 12/15
  const adminFee = (n: number) => Math.floor((Math.round(n * 0.1) * 1) / 3 + 1e-9); // 行政費三人平分
  const bookFee = adminFee(1580);
  assert.equal(cum("2026-11-15"), Math.round((owner + adminFee(27000)) * frac("2026-11-01")));
  assert.equal(cum("2026-12-15"), Math.round((owner + adminFee(27000)) * frac("2026-12-01") + book + bookFee));
  // 1/15：12/3 的插班生從開課算起的天數一起到期
  assert.equal(cum("2027-01-15"), Math.round((owner + adminFee(27000)) * 2 * frac("2027-01-01") + book + bookFee));
  // 全部到期＝子記帳表餘額
  assert.equal(cai.paydays[cai.paydays.length - 1].cumVested, cai.balance);
  assert.equal(cai.paydays.reduce((s, p) => s + p.due, 0), cai.balance);
  assert.equal(cai.next.payday, "2026-11-15");
  assert.equal(cai.next.payable + cai.next.notYetDue, cai.balance);
});

test("部分入帳：沒收到的學費不到期，補收後下一個 15 日才發；撥款扣掉可發", async () => {
  const { db, sqlite, admin, dateEntry } = setup();
  const a = await admin.mainLedger.createBookIncome({ lines: [{ bookId: 26, qty: 10 }], couponId: null, amount: 8800 });
  dateEntry(a.entry.id, "2026-10-10");
  await admin.mainLedger.update({ id: a.entry.id, itemName: "地科刷題本×10", unpaidAmount: 4400 });
  sqlite.prepare("DELETE FROM payment_receipts").run(); // 上面是入帳時就沒收齊，不是補收
  const chen = () => payrollTable(db, NOW).then((t) => t.people.find((p) => p.name === "陳宥勳")!);
  const full = 8800 - Math.round(8800 * 0.35);
  let p = await chen();
  assert.equal(p.paydays[0].cumVested, Math.round(full / 2));
  assert.equal(p.paydays[p.paydays.length - 1].cumVested, Math.round(full / 2)); // 沒收到的那半永遠不到期

  await admin.mainLedger.receivePayment({ id: a.entry.id, amount: 4400 });
  sqlite.prepare("UPDATE payment_receipts SET received_at = ?").run(at("2026-11-20"));
  p = await chen();
  assert.equal(p.paydays[0].cumVested, Math.round(full / 2)); // 11/15 不變
  assert.equal(p.paydays[1].cumVested, full); // 12/15 補收的一起發

  await admin.payroll.markPaid({ recipientType: "teacher", recipientId: 5, amount: 2000, payday: "2026-11-15" });
  const t = await payrollTable(db, NOW);
  p = t.people.find((x) => x.name === "陳宥勳")!;
  assert.equal(p.paydays[0].paid, 2000);
  assert.equal(p.totalPaid, 2000);
  assert.equal(p.next.payable, Math.round(full / 2) - 2000);
  assert.equal(p.balance, full - 2000);
});

test("發薪表權限：只有管理員看得到全部；老師、出貨員只看得到自己", async () => {
  const { db, sqlite } = setup();
  sqlite.prepare("INSERT INTO salespeople (id, name, created_at, updated_at) VALUES (1, '余彩霞', 0, 0)").run();
  sqlite.prepare("INSERT INTO shippers (id, name, created_at, updated_at) VALUES (1, '余彩霞', 0, 0)").run();
  const teacher = appRouter.createCaller({ db, user: { id: 4, role: "teacher_self", linkedTeacherId: 3 } } as any);
  const shipper = appRouter.createCaller({ db, user: { id: 9, role: "shipper_self", linkedShipperId: 1 } } as any);
  const finance = appRouter.createCaller({ db, user: { id: 8, role: "finance_staff" } } as any);
  await assert.rejects(teacher.payroll.table(), /只有管理員/);
  await assert.rejects(shipper.payroll.table(), /出貨員只能使用代墊功能|只有管理員/);
  await assert.rejects(teacher.payroll.markPaid({ recipientType: "teacher", recipientId: 3, amount: 1, payday: "2026-11-15" }));
  await assert.rejects(teacher.payroll.yearEndPreview({ year: 2026, reservedNextYear: 0 }), /只有管理員/);
  assert.equal((await teacher.payroll.person({ recipientType: "teacher", recipientId: 2 }))!.name, "王歆宜"); // 傳別人的 id 也只看到自己
  assert.equal((await shipper.payroll.person({}))!.name, "余彩霞");
  assert.ok(await finance.payroll.table());
});

test("營業稅：登記日以後的收入先扣 5/105 進稅金準備再分；繳稅不扣公積金", async () => {
  const { db, sqlite, admin } = setup();
  sqlite.prepare("INSERT INTO expense_types (name, created_at, updated_at) VALUES ('營業稅', 0, 0)").run();
  assert.equal(vatOf({ vatRate: 0.05, registrationDate: null }, 10500), 0);
  assert.equal(vatOf({ vatRate: 0.05, registrationDate: "2026-12-01" }, 10500, at("2026-11-30")), 0);
  assert.equal(vatOf({ vatRate: 0.05, registrationDate: "2026-12-01" }, 10500, twDayStart("2026-12-01")), 500);

  const before = await admin.mainLedger.createTutoringIncome({ items: [{ courseId: 4, amount: 10000 }] });
  assert.equal(before.entry.taxAmount, 0);
  await admin.revenueSettings.updateTaxReserve({ vatRatePercent: 5, registrationDate: "2026-01-01", reserveFloor: 100000, reserveFrozen: 37000 });
  const r = await admin.mainLedger.createTutoringIncome({ items: [{ courseId: 4, amount: 10500 }] });
  assert.equal(r.entry.taxAmount, 500);
  const rows = sqlite.prepare("SELECT personal_amount FROM teacher_ledger WHERE main_ledger_id = ? ORDER BY id").all(r.entry.id) as any[];
  assert.equal(rows[0].personal_amount, 8000); // 10000 − 公積金 1000 − 行政費 1000
  assert.equal(r.reserve, 10500 - 500 - rows.reduce((s, x) => s + x.personal_amount, 0));
  assert.equal(await taxReserveOf(db), 500);
  const reserve = (await reserveTrail(db)).current;

  const vat = sqlite.prepare("SELECT id FROM expense_types WHERE name = '營業稅'").get() as any;
  await admin.mainLedger.create({ type: "expense", itemName: "11-12 月營業稅", categoryId: vat.id, amount: "500" });
  assert.equal(await taxReserveOf(db), 0);
  assert.equal((await reserveTrail(db)).current, reserve); // 公積金不變
});

test("年終結算：公積金扣凍結、水位、預留後，依當年分潤占比分；確認才寫入，不能重複", async () => {
  const { db, sqlite, admin } = setup();
  await admin.revenueSettings.updateTaxReserve({ vatRatePercent: 5, registrationDate: null, reserveFloor: 1000, reserveFrozen: 500 });
  await admin.mainLedger.createTutoringIncome({ items: [{ courseId: 4, amount: 27000 }, { courseId: 5, amount: 18000 }] });
  const p = await admin.payroll.yearEndPreview({ year: Number(new Date().getFullYear()), reservedNextYear: 200 });
  const reserve = (await reserveTrail(db)).current;
  assert.equal(p.available, reserve - 500 - 1000 - 200);
  const cai = p.shares.find((s) => s.name === "蔡睿軒")!;
  assert.equal(cai.amount, Math.floor((p.available * cai.earned) / p.totalEarned));
  await admin.payroll.yearEndApply({ year: p.year, reservedNextYear: 200, expectedTotal: p.total });
  const n = (sqlite.prepare(`SELECT count(*) n FROM teacher_ledger WHERE item_name = '${p.year} 年終分潤'`).get() as any).n;
  assert.equal(n, p.shares.filter((s) => s.amount > 0).length);
  assert.equal((await reserveTrail(db)).current, reserve - p.total);
  await assert.rejects(admin.payroll.yearEndApply({ year: p.year, reservedNextYear: 200, expectedTotal: p.total }), /結算過/);
});
