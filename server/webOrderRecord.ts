import { isNull } from "drizzle-orm";
import { books, courses, mainLedger } from "./schema";
import { computeBookIncome, computeCourseIncome, computeTutoringIncome, CourseIncomeError } from "./revenueCalc";
import { combineIncome, type IncomePart } from "./combineIncome";
import { formatNote, parseNote } from "./noteFormat";

/**
 * 官網訂單 → 母記帳表：一張官網訂單入帳成「一筆」收入，裡面每個項目各自照規則分潤：
 *   小班家教（課程名稱＝官網品名）→ 扣公積金比例後給主理教師
 *   線上課程（「數學工具先修課程（三年方案）」這種）→ 走分潤精靈，金額用官網實付
 *   書籍／筆記本 → 全數留給公積金
 * 官網折扣依各品項定價比例攤；運費（實付比「定價−折扣」多出來的）算進書籍那筆。
 * 備註寫「買家：姓名｜官網訂單：編號」，對帳就會自動配到這張訂單，也用來避免重複入帳。
 */

export type LineKind = "tutoring" | "course" | "book" | "skip" | "unknown";
export type LineOverride = { kind: "tutoring" | "book"; id: number } | { kind: "skip" };

export interface PlannedLine {
  idx: number;
  name: string;
  price: number;
  kind: LineKind;
  targetId: number | null;
  targetName: string | null;
  years: 1 | 2 | 3 | null;
  amount: number; // 攤完折扣（書籍另加運費前）的金額
}

/** 這筆記帳的備註是不是寫著這張官網訂單（新格式「官網訂單：編號」） */
export function noteHasOrder(note: string | null | undefined, orderNo: string) {
  return parseNote(note).order === orderNo;
}

const YEARS: Record<string, 1 | 2 | 3> = { 一年: 1, 兩年: 2, 二年: 2, 三年: 3 };

/** 「物理先修課程（物理刷題本（上））」→ { prefix: "物理", inner: "物理刷題本（上）" } */
function splitWebName(name: string) {
  const open = name.indexOf("（");
  if (open < 0 || !name.endsWith("）")) return { prefix: name, inner: null as string | null };
  return { prefix: name.slice(0, open), inner: name.slice(open + 1, -1) };
}

function matchLine(name: string, price: number, allCourses: any[], allBooks: any[]): Omit<PlannedLine, "idx" | "amount"> {
  const base = { name, price, targetId: null, targetName: null, years: null };
  const course = allCourses.find((c) => c.name === name);
  if (course) return { ...base, kind: course.category === "tutoring" ? "tutoring" : "course", targetId: course.id, targetName: course.name, years: 1 };

  const { prefix, inner } = splitWebName(name);
  // 線上課程：「數學工具先修課程（三年方案）」
  const online = allCourses.find((c) => c.category !== "tutoring" && c.name === prefix);
  const yearKey = inner?.match(/^(一年|兩年|二年|三年)方案$/)?.[1];
  if (online && yearKey) return { ...base, kind: "course", targetId: online.id, targetName: online.name, years: YEARS[yearKey] };

  const book = (n: string) => allBooks.find((b) => b.name === n);
  const subject = prefix.replace(/先修課程$/, "");
  const found =
    book(name) ??
    (inner ? book(inner) ?? book(`${subject} ${inner}`) ?? book(`${subject}${inner}`) : undefined) ??
    // 行事曆在官網有很多種版本名稱，用價格對到筆記本
    (name.includes("行事曆") ? allBooks.find((b) => b.kind === "notebook" && b.price === price) : undefined);
  if (found) return { ...base, kind: "book", targetId: found.id, targetName: found.name };
  return { ...base, kind: "unknown" };
}

/** 依定價比例攤 pool 元，四捨五入的零頭給最貴的那一項 */
function allocate(prices: number[], pool: number) {
  const sum = prices.reduce((s, p) => s + p, 0);
  if (!sum || !pool) return prices.map(() => 0);
  const parts = prices.map((p) => Math.floor((pool * p) / sum));
  const rest = pool - parts.reduce((s, p) => s + p, 0);
  const maxIdx = prices.indexOf(Math.max(...prices));
  parts[maxIdx] += rest;
  return parts;
}

export async function loadCatalog(db: any) {
  return {
    courses: await db.select().from(courses),
    books: (await db.select().from(books)).filter((b: any) => b.isActive),
    ledger: await db.select({ note: mainLedger.note }).from(mainLedger).where(isNull(mainLedger.deletedAt)),
  };
}

/** 規劃一張訂單要怎麼入帳（只計算、不寫入） */
export async function planOrder(db: any, order: any, overrides: Record<number, LineOverride>, catalog: Awaited<ReturnType<typeof loadCatalog>>) {
  const errors: string[] = [];
  const items: { name: string; price: number }[] = JSON.parse(order.items);
  if (order.tab === "cancelled") errors.push("這張訂單在官網已取消");
  if (order.manualStatus === "ignored") errors.push("這張訂單已標記「不需入帳」");
  if (catalog.ledger.some((e: any) => noteHasOrder(e.note, order.orderNo))) errors.push("這張訂單已經入帳過了");

  const lines: PlannedLine[] = items.map((it, idx) => {
    const m = matchLine(it.name, it.price, catalog.courses, catalog.books);
    const o = overrides[idx];
    if (o?.kind === "skip") return { ...m, idx, kind: "skip", amount: 0 };
    if (o) {
      const list = o.kind === "book" ? catalog.books : catalog.courses;
      const t = list.find((x: any) => x.id === o.id);
      if (t) return { ...m, idx, kind: o.kind, targetId: t.id, targetName: t.name, years: o.kind === "tutoring" ? 1 : null, amount: 0 };
    }
    return { ...m, idx, amount: 0 };
  });

  const counted = lines.filter((l) => l.kind !== "skip");
  const listSum = counted.reduce((s, l) => s + l.price, 0);
  const extra = order.total - (listSum - order.discount);
  const discountPool = order.discount + Math.max(0, -extra);
  const shipping = Math.max(0, extra);
  const parts = allocate(counted.map((l) => l.price), discountPool);
  counted.forEach((l, i) => (l.amount = l.price - parts[i]));

  if (lines.some((l) => l.kind === "unknown")) errors.push("有品項對不到記帳系統的課程或書目，請選對應項目或設成不入帳");

  const entries: IncomePart[] = [];
  const noteBits: string[] = [];
  const bookLines = counted.filter((l) => l.kind === "book");
  const others = counted.filter((l) => l.kind === "tutoring" || l.kind === "course");
  // 沒有書可以放運費時，加到最後一門課
  const shippingToCourse = !bookLines.length && shipping > 0 && others.length ? others[others.length - 1] : null;
  if (!bookLines.length && !others.length && shipping > 0) errors.push("這張訂單只有運費可以入帳");

  try {
    for (const l of others) {
      const amount = l.amount + (l === shippingToCourse ? shipping : 0);
      if (l === shippingToCourse) noteBits.push(`${l.targetName}含運費 ${shipping} 元`);
      if (l.kind === "tutoring") {
        const r = await computeTutoringIncome(db, { courseId: l.targetId!, amount });
        entries.push({ source: "tutoring", name: r.course.name, categoryId: r.course.id, categoryName: "小班家教", amount, distributions: r.distributions, personalLabel: r.course.name });
      } else {
        const r = await computeCourseIncome(db, { courseId: l.targetId!, years: l.years ?? 1, hasCoupon: false, referral: null, amountOverride: amount });
        noteBits.push(`${r.course.name} ${l.years} 年方案`);
        entries.push({ source: "course", name: r.course.name, categoryId: r.course.id, categoryName: r.course.name, amount, distributions: r.distributions, personalLabel: r.course.name });
      }
    }
    if (bookLines.length) {
      const qty = new Map<number, number>();
      bookLines.forEach((l) => qty.set(l.targetId!, (qty.get(l.targetId!) ?? 0) + 1));
      const r = await computeBookIncome(db, { lines: [...qty].map(([bookId, q]) => ({ bookId, qty: q })), couponId: null });
      const amount = bookLines.reduce((s, l) => s + l.amount, 0) + shipping;
      if (shipping) noteBits.push(`書籍含運費 ${shipping} 元`);
      entries.push({ source: "book", name: r.itemName, categoryId: r.detail[0].bookId, categoryName: "書籍", amount, distributions: [], personalLabel: "書籍" });
    }
  } catch (e) {
    if (e instanceof CourseIncomeError) errors.push(e.message);
    else throw e;
  }
  if (entries.some((e) => e.amount <= 0)) errors.push("有一筆攤完折扣後金額是 0，請檢查");

  const combined = entries.length ? { ...combineIncome(entries), note: formatNote({ buyer: order.buyer, order: order.orderNo, memo: noteBits.join("；") }) } : null;
  return {
    orderNo: order.orderNo,
    buyer: order.buyer,
    total: order.total,
    discount: order.discount,
    statusLabel: order.statusLabel,
    shipping,
    lines,
    // 預覽用：這一筆收入裡的每個項目，各自的公積金與分潤
    parts: entries.map((e) => ({
      kind: e.source,
      itemName: e.name,
      amount: e.amount,
      reserve: e.amount - e.distributions.reduce((s, d) => s + d.amount, 0),
      distributions: e.distributions,
    })),
    combined,
    recordedTotal: combined?.amount ?? 0,
    errors,
  };
}
