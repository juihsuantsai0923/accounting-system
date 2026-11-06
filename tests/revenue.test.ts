import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb, webOrder } from "./helpers";
import { loadCatalog, planOrder } from "../server/webOrderRecord";
import { insertIncome } from "../server/routers/mainLedger";
import { recalcBookShares } from "../server/bookShares";

/** 規劃一張官網訂單（不寫入） */
async function plan(db: any, order: ReturnType<typeof webOrder>) {
  return planOrder(db, order, {}, await loadCatalog(db));
}

/** 規劃後照官網對帳「確認入帳」的方式寫進帳本 */
async function record(db: any, order: ReturnType<typeof webOrder>) {
  const p = await plan(db, order);
  assert.deepEqual(p.errors, []);
  const c = p.combined!;
  return insertIncome(
    db,
    1,
    { itemName: c.itemName, categoryId: c.categoryId, categoryName: c.categoryName, amount: c.amount, note: c.note, incomeSource: c.incomeSource, breakdown: c.breakdown },
    c.distributions,
    (d) => d.itemNameSuffix
  );
}

const part = (p: Awaited<ReturnType<typeof plan>>, name: string) => {
  const found = p.parts.find((x) => x.itemName === name);
  assert.ok(found, `找不到項目 ${name}`);
  return found;
};
const owner = (x: { distributions: { role: string; amount: number }[] }) => x.distributions.find((d) => d.role === "owner")!.amount;
const adminFee = (x: { distributions: { role: string; amount: number }[] }) =>
  x.distributions.filter((d) => d.role === "team_bonus").map((d) => d.amount);

test("優惠碼 5% 用課程原價 15000 算、小班家教不折（劉代雯 LX-20261029-001）", async () => {
  const { db } = makeDb();
  const p = await plan(
    db,
    webOrder("LX-20261029-001", 86589, 1031, [
      ["數學工具先修課程（一年方案）", 9000],
      ["科學班物理衝刺班 2026-2027", 27000],
      ["科學班化學衝刺班 2026-2027", 18000],
      ["科學班生物衝刺班 2026-2027", 18000],
      ["科學班地球科學衝刺班 2026-2027", 10000],
      ["物理先修課程（上下冊刷題本）", 1580],
      ["化學先修課程（上下冊刷題本）", 1580],
      ["生物先修課程（上下冊刷題本）", 1580],
      ["地科先修課程（地科刷題本）", 880],
    ])
  );
  assert.deepEqual(p.errors, []);
  assert.equal(p.recordedTotal, 86589);
  assert.equal(part(p, "數學工具先修課程").amount, 8250);
  assert.equal(part(p, "科學班物理衝刺班 2026-2027").amount, 27000);
  assert.equal(part(p, "物理 上下冊刷題本").amount, 1501);
  assert.equal(part(p, "地科刷題本").amount, 836);
  assert.match(p.combined!.note, /優惠碼 5% 折 1,031 元（小班家教不折）/);
});

test("書籍：公積金 25%＋行政費 10% 三人平分，老師拿其餘", async () => {
  const { db } = makeDb();
  const p = await plan(db, webOrder("T-1", 3350, 0, [["物理先修課程（四本全套）", 3350]]));
  const b = part(p, "物理 四本全套");
  assert.equal(owner(b), 3350 - Math.round(3350 * 0.35)); // 2177
  assert.deepEqual(adminFee(b), [111, 111, 111]);
  assert.equal(b.reserve, 3350 - 2177 - 333);
});

test("純書籍訂單用 15% 優惠碼還原官網折扣（徐婉寧 LX-20261030-003）", async () => {
  const { db } = makeDb();
  const p = await plan(
    db,
    webOrder("LX-20261030-003", 4777, 843, [
      ["物理先修課程（上下冊刷題本）", 1580],
      ["化學先修課程（上下冊刷題本）", 1580],
      ["生物先修課程（上下冊刷題本）", 1580],
      ["地科先修課程（地科刷題本）", 880],
    ])
  );
  assert.deepEqual(p.errors, []);
  assert.equal(p.recordedTotal, 4777);
  assert.deepEqual(
    p.parts.map((x) => x.amount),
    [1343, 1343, 1343, 748]
  );
  assert.equal(owner(part(p, "物理 上下冊刷題本")), 1343 - Math.round(1343 * 0.35));
  assert.match(p.combined!.note, /優惠碼 15% 折 843 元/);
});

test("行事曆全部留公積金，不分給任何人", async () => {
  const { db } = makeDb();
  const p = await plan(
    db,
    webOrder("LX-20261030-002", 27300, 0, [
      ["科學班倒數行事曆（2026 8月-2027 3月）", 300],
      ["科學班物理衝刺班 2026-2027", 27000],
    ])
  );
  const cal = part(p, "科學班倒數行事曆（2026 8月-2027 3月）");
  assert.equal(cal.amount, 300);
  assert.deepEqual(cal.distributions, []);
  assert.equal(cal.reserve, 300);
  assert.equal(owner(part(p, "科學班物理衝刺班 2026-2027")), 21600);
});

test("運費算進書籍那筆、全部留公積金", async () => {
  const { db } = makeDb();
  const p = await plan(db, webOrder("T-2", 3410, 0, [["物理先修課程（四本全套）", 3350]]));
  assert.equal(p.shipping, 60);
  assert.equal(p.recordedTotal, 3410);
  const ship = part(p, "運費");
  assert.equal(ship.amount, 60);
  assert.deepEqual(ship.distributions, []);
  assert.equal(owner(part(p, "物理 四本全套")), 2177);
});

test("老師子記帳表的書籍分潤寫書名", async () => {
  const { db, sqlite } = makeDb();
  await record(db, webOrder("T-3", 3350, 0, [["物理先修課程（四本全套）", 3350]]));
  const names = (sqlite.prepare("SELECT item_name FROM teacher_ledger ORDER BY id").all() as any[]).map((r) => r.item_name);
  assert.deepEqual(names, ["物理 四本全套（書籍分潤）", "物理 四本全套（行政費）", "物理 四本全套（行政費）", "物理 四本全套（行政費）"]);
});

test("書籍公積金比例改了，舊帳重算只改老師那一份、分配表與餘額跟著改", async () => {
  const { db, sqlite } = makeDb();
  sqlite.exec("UPDATE revenue_settings SET book_reserve_rate = 0.1");
  await record(db, webOrder("T-4", 3300, 0, [["物理先修課程（四本全套）", 3300]])); // 舊比例：老師 2640
  await record(db, webOrder("T-5", 27000, 0, [["科學班物理衝刺班 2026-2027", 27000]]));
  sqlite.exec("UPDATE revenue_settings SET book_reserve_rate = 0.25");

  const preview = await recalcBookShares(db, true);
  assert.equal(preview.changes.length, 1);
  assert.equal((sqlite.prepare("SELECT personal_amount a FROM teacher_ledger WHERE id = 1").get() as any).a, 2640); // dryRun 不寫

  const r = await recalcBookShares(db);
  assert.deepEqual(r.changes.map((c) => [c.before, c.after]), [[2640, 2145]]);
  assert.equal(r.diff, -495);
  const t = (sql: string) => sqlite.prepare(sql).get() as any;
  assert.equal(t("SELECT personal_amount a FROM teacher_ledger WHERE id = 1").a, 2145);
  assert.equal(t("SELECT amount a FROM ledger_distribution WHERE id = 1").a, 2145);
  assert.equal(t("SELECT SUM(amount) a FROM ledger_distribution WHERE recipient_id <> 2 AND main_ledger_id = 1").a, 220); // 行政費不動
  // 蔡睿軒：書籍 2145＋行政費 110＋家教 21600＋家教行政費 900
  assert.equal(t("SELECT personal_balance b FROM teacher_ledger WHERE teacher_id = 2 ORDER BY id DESC LIMIT 1").b, 2145 + 110 + 21600 + 900);
  assert.equal((await recalcBookShares(db)).changes.length, 0); // 重跑不會再改
});

test("帳務檢查：系統外刪掉一筆記錄會被抓到", async () => {
  const { checkIntegrity } = await import("../server/integrity");
  const { db, sqlite } = makeDb();
  await record(db, webOrder("T-6", 3300, 0, [["物理先修課程（四本全套）", 3300]]));
  await record(db, webOrder("T-7", 27000, 0, [["科學班物理衝刺班 2026-2027", 27000]]));
  assert.deepEqual(await checkIntegrity(db), []);
  sqlite.exec("DELETE FROM main_ledger WHERE id = 1"); // 不經過系統刪除
  const issues = await checkIntegrity(db);
  assert.ok(issues.some((t) => t.includes("帳本有 1 筆存的餘額")));
  assert.ok(issues.some((t) => t.includes("掛在已刪除的帳本記錄上")));
});

test("行政費依權重分：4 : 3.5 : 1.5 : 1，出貨員記在推銷者子帳，零頭留公積金", async () => {
  const { computeTutoringIncome, computeTrialIncome } = await import("../server/revenueCalc");
  const { db, sqlite } = makeDb();
  sqlite.exec("UPDATE revenue_settings SET admin_fee_rate = 0.2");
  sqlite.exec("INSERT INTO salespeople (id, name, is_active, created_at, updated_at) VALUES (1, '出貨員', 1, 0, 0)");
  sqlite.exec("DELETE FROM revenue_team_members");
  sqlite.exec(
    "INSERT INTO revenue_team_members (recipient_type, recipient_id, weight, created_at) VALUES ('teacher', 2, 4, 0), ('teacher', 4, 3.5, 0), ('teacher', 3, 1.5, 0), ('salesperson', 1, 1, 0)"
  );
  const t = await computeTutoringIncome(db, { courseId: 4, amount: 27000 });
  assert.equal(t.teacherShare, 18900);
  assert.equal(t.reserve, 2700);
  assert.deepEqual(adminFee(t), [2160, 1890, 810, 540]);
  assert.equal(t.distributions.at(-1)!.type, "salesperson");

  const trial = await computeTrialIncome(db, { courseId: 7, amount: 999 });
  assert.equal(trial.teacherShare, 699);
  assert.deepEqual(adminFee(trial), [80, 70, 30, 20]);
  assert.equal(trial.reserve, 999 - 699 - 200);
});
