/**
 * 書籍與優惠碼的初始資料（2026-10-26 依 Leviax 官網「書籍管理」「定價與優惠」整理）。
 * 本機開發在 db.ts 啟動時用 INSERT OR IGNORE 寫入；正式環境 D1 由 migrations/0004_books_tutoring.sql 寫入同樣的資料。
 * 之後新增或改價請直接在管理面板「書籍管理」「優惠碼管理」操作，不用改這個檔案。
 */
export type BookKind = "book" | "workbook" | "bundle" | "notebook";

const SUBJECT_BOOKS: { subject: string; vol: [string, string] | null }[] = [
  { subject: "物理", vol: ["上", "下"] },
  { subject: "化學", vol: ["上", "下"] },
  { subject: "生物", vol: ["上", "下"] },
  { subject: "地科", vol: null },
];

function buildBooks() {
  const rows: { name: string; kind: BookKind; price: number }[] = [];
  for (const { subject, vol } of SUBJECT_BOOKS) {
    if (vol) {
      const [a, b] = vol;
      rows.push(
        { name: `${subject}（${a}）`, kind: "book", price: 980 },
        { name: `${subject}（${b}）`, kind: "book", price: 980 },
        { name: `${subject}刷題本（${a}）`, kind: "workbook", price: 880 },
        { name: `${subject}刷題本（${b}）`, kind: "workbook", price: 880 },
        { name: `${subject} 上下冊講義套書`, kind: "bundle", price: 1760 },
        { name: `${subject} 上下冊刷題本`, kind: "bundle", price: 1580 },
        { name: `${subject} 上冊全套（講義＋刷題本）`, kind: "bundle", price: 1680 },
        { name: `${subject} 四本全套`, kind: "bundle", price: 3350 }
      );
    } else {
      rows.push(
        { name: `${subject}先修課程`, kind: "book", price: 980 },
        { name: `${subject}刷題本`, kind: "workbook", price: 880 },
        { name: `${subject} 全套（講義＋刷題本）`, kind: "bundle", price: 1680 }
      );
    }
  }
  rows.push(
    { name: "科學班倒數行事曆（2026 8月-2027 3月）", kind: "notebook", price: 300 },
    { name: "科學班倒數行事曆（2027 4月-2028 3月）", kind: "notebook", price: 350 }
  );
  return rows.map((r, i) => ({ ...r, sortOrder: i + 1 }));
}

export const SEED_BOOKS = buildBooks();

export const SEED_COUPONS: { code: string; discountRate: number; validUntil: string | null }[] = [
  { code: "TUTOR2026", discountRate: 0.15, validUntil: "2027-03-15" },
  { code: "SGGS010", discountRate: 0.1, validUntil: null },
  { code: "IVY009", discountRate: 0.1, validUntil: null },
  { code: "SWEETY008", discountRate: 0.05, validUntil: null },
  { code: "CCCLEE007", discountRate: 0.05, validUntil: null },
  { code: "SZLUBA006", discountRate: 0.05, validUntil: null },
  { code: "STUDYN005", discountRate: 0.05, validUntil: null },
  { code: "MING004", discountRate: 0.05, validUntil: null },
  { code: "CINDY003", discountRate: 0.05, validUntil: null },
  { code: "SNORLAX002", discountRate: 0.05, validUntil: null },
  { code: "LEVIAX001", discountRate: 0.05, validUntil: null },
];

export const BOOK_KIND_LABELS: Record<BookKind, string> = {
  book: "講義",
  workbook: "刷題本",
  bundle: "組合包",
  notebook: "筆記本",
};
