import { test } from "node:test";
import assert from "node:assert/strict";
import { corpIncomeTax, monthlySales, personalTax, personalTaxOn, taxIncluded, withholdingFor } from "../client/src/lib/tax";
import type { AEntry } from "../client/src/lib/analytics";

test("營所稅：12 萬以下免稅、緩衝區取超過部分的一半、之後 20%", () => {
  assert.equal(corpIncomeTax(120_000), 0);
  assert.equal(corpIncomeTax(150_000), 15_000); // min(30,000, 15,000)
  assert.equal(corpIncomeTax(200_000), 40_000); // 兩種算法剛好相等
  assert.equal(corpIncomeTax(1_000_000), 200_000);
});

test("綜所稅級距（115 年度）與累進差額", () => {
  assert.equal(personalTax(610_000), 30_500);
  assert.equal(personalTax(1_000_000), 77_300); // 12% − 42,700
  assert.equal(personalTax(1_380_000), 122_900);
  // 單身、薪資 60 萬：600,000 − 227,000 − 101,000 − 136,000 = 136,000 → 6,800
  assert.deepEqual(personalTaxOn(600_000, "salary"), { net: 136_000, tax: 6_800 });
  assert.equal(personalTaxOn(200_000, "business").tax, 0);
});

test("內含 5% 營業稅", () => {
  assert.equal(taxIncluded(105_000), 5_000);
});

test("扣繳：執行業務單次 ≥ 20,010 扣 10%、≥ 2 萬扣補充保費", () => {
  assert.deepEqual(withholdingFor([20_000, 30_000, 19_999], "professional"), { withhold: 3_000, nhi: Math.round(20_000 * 0.0211) + Math.round(30_000 * 0.0211), count: 2 });
  assert.equal(withholdingFor([20_010], "professional").withhold, 2_001); // 扣繳稅額超過 2,000 才扣
  assert.deepEqual(withholdingFor([29_500, 95_000], "salary"), { withhold: 4_750, nhi: Math.round(29_500 * 0.0211) + Math.round(95_000 * 0.0211), count: 2 });
});

test("每月營業額：勞務／貨物分開判斷起徵點與 20 萬", () => {
  const e = (amount: number, source: string, month: number): AEntry => ({
    id: month,
    type: "income",
    itemName: "x",
    categoryId: 1,
    categoryName: source === "book" ? "書籍" : "小班家教",
    amount,
    note: null,
    incomeSource: source,
    breakdown: null,
    distributed: 0,
    salaryTeacherId: null,
    salarySalespersonId: null,
    createdAt: new Date(2026, month - 1, 10).getTime(),
  });
  const rows = monthlySales([e(30_000, "tutoring", 7), e(40_000, "book", 7), e(250_000, "tutoring", 10), e(5_000, "book", 1)], "2026", new Set());
  const jul = rows.find((r) => r.month === "2026-07")!;
  assert.equal(jul.overThreshold, true); // 30,000/50,000 + 40,000/100,000 = 1.0
  assert.equal(rows.find((r) => r.month === "2026-01")!.overThreshold, false);
  assert.equal(rows.find((r) => r.month === "2026-10")!.overSmallScale, true);
});
