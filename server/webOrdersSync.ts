import { z } from "zod";
import { eq } from "drizzle-orm";
import { books, coupons, courses, integrationKeys, teachers, webOrders } from "./schema";
import { SUBJECT_TEACHERS } from "./revenueCalc";

/**
 * 官網訂單同步（書籤小工具用）。
 * 書籤小工具在使用者已登入的官網後台讀出訂單，帶著「官網同步金鑰」POST 到 /api/web-orders/sync。
 * 這把金鑰只能寫入官網訂單快照，不能讀任何帳務資料；資料庫只存它的 SHA-256。
 * Express 與 Cloudflare Worker 共用（db 由呼叫端傳入）。
 */
export const SYNC_KEY_NAME = "web_orders_sync";

export async function sha256Hex(text: string) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newSyncKey() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
  return "lxs_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifySyncKey(db: any, key: string | null) {
  if (!key) return false;
  const [row] = await db.select().from(integrationKeys).where(eq(integrationKeys.name, SYNC_KEY_NAME)).limit(1);
  if (!row) return false;
  return row.keyHash === (await sha256Hex(key));
}

/** 跟 scripts/web_orders_to_sql.py 同一種格式：[編號, 台灣時間, 買家, 實付, 折扣, 狀態, 分頁, [[品名, 單價, 預購, 組合包]...]] */
const orderRow = z.tuple([
  z.string().regex(/^LX-\d{8}-\d{3}$/),
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
  z.string().min(1).max(100),
  z.number().int().min(0),
  z.number().int().min(0),
  z.string().min(1).max(50),
  z.enum(["pending", "completed", "cancelled"]),
  z.array(z.tuple([z.string().min(1).max(300), z.number().int().min(0), z.union([z.literal(0), z.literal(1)]), z.union([z.literal(0), z.literal(1)])])).max(100),
]);
/**
 * 官網商品清單（課程、書籍、優惠碼），書籤在官網後台「課程管理」「書籍管理」「定價與優惠」讀出來：
 *   courses：[名稱, online|tutoring, 科目, 定價]
 *   books：[名稱, book|workbook|bundle|notebook, 價格]
 *   coupons：[代碼, 折扣比例 0~1, 到期日 YYYY-MM-DD 或 null, 是否啟用]
 */
const catalogPayload = z.object({
  courses: z.array(z.tuple([z.string().min(1).max(200), z.enum(["online", "tutoring"]), z.string().max(20), z.number().int().min(0)])).max(500),
  books: z.array(z.tuple([z.string().min(1).max(200), z.enum(["book", "workbook", "bundle", "notebook"]), z.number().int().min(0)])).max(1000),
  coupons: z.array(z.tuple([z.string().min(1).max(50), z.number().min(0).max(1), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), z.boolean()])).max(500),
});
export const syncPayload = z.object({ orders: z.array(orderRow).max(5000), catalog: catalogPayload.optional() });

/**
 * 把官網商品清單同步進來：課程、書籍、優惠碼都以官網為準（用名稱／代碼對應）。
 * 課程的主理老師照科目自動對（SUBJECT_TEACHERS）；小班家教的上課期間官網沒有，保留原本的。
 * 官網上沒有的書、優惠碼標成停用（不刪，舊記錄還會用到）。
 */
export async function upsertCatalog(db: any, cat: z.infer<typeof catalogPayload>) {
  const now = Date.now();
  const teacherRows: { id: number; name: string }[] = await db.select({ id: teachers.id, name: teachers.name }).from(teachers);
  const teacherFor = (subject: string) => {
    const s = SUBJECT_TEACHERS.find((x) => x.subject === subject || x.keywords.includes(subject));
    return teacherRows.find((t) => t.name === s?.teacherName)?.id ?? null;
  };
  const existingCourses: any[] = await db.select().from(courses);
  for (const [name, category, subject, price] of cat.courses) {
    const teacherId = teacherFor(subject);
    const found = existingCourses.find((c) => c.name === name);
    if (found) await db.update(courses).set({ category, originalPrice: price, teacherId: teacherId ?? found.teacherId, updatedAt: now }).where(eq(courses.id, found.id));
    else await db.insert(courses).values({ name, category, originalPrice: price, teacherId, type: "personal" });
  }
  const existingBooks: any[] = await db.select().from(books);
  const seenBooks = new Set<string>();
  let order = 0;
  for (const [name, kind, price] of cat.books) {
    seenBooks.add(name);
    order += 1;
    const found = existingBooks.find((b) => b.name === name);
    if (found) await db.update(books).set({ kind, price, isActive: true, sortOrder: order, updatedAt: now }).where(eq(books.id, found.id));
    else await db.insert(books).values({ name, kind, price, isActive: true, sortOrder: order });
  }
  if (cat.books.length) {
    for (const b of existingBooks) if (!seenBooks.has(b.name) && b.isActive) await db.update(books).set({ isActive: false, updatedAt: now }).where(eq(books.id, b.id));
  }
  const existingCoupons: any[] = await db.select().from(coupons);
  const seenCoupons = new Set<string>();
  for (const [code, rate, validUntil, active] of cat.coupons) {
    seenCoupons.add(code);
    const found = existingCoupons.find((c) => c.code === code);
    if (found) await db.update(coupons).set({ discountRate: rate, validUntil, isActive: active, updatedAt: now }).where(eq(coupons.id, found.id));
    else await db.insert(coupons).values({ code, discountRate: rate, validUntil, isActive: active });
  }
  if (cat.coupons.length) {
    for (const c of existingCoupons) if (!seenCoupons.has(c.code) && c.isActive) await db.update(coupons).set({ isActive: false, updatedAt: now }).where(eq(coupons.id, c.id));
  }
  return { courses: cat.courses.length, books: cat.books.length, coupons: cat.coupons.length };
}

/** 寫入／更新訂單快照：官網的欄位以最新為準，記帳這邊的手動標記（manual_status、manual_note）保留 */
export async function upsertWebOrders(db: any, rows: z.infer<typeof orderRow>[]) {
  const now = Date.now();
  for (const [no, at, buyer, total, discount, status, tab, items] of rows) {
    const orderedAt = new Date(`${at}+08:00`).getTime();
    const itemsJson = JSON.stringify(items.map(([name, price, pre, bun]) => ({ name, price, preorder: !!pre, bundle: !!bun })));
    await db
      .insert(webOrders)
      .values({ orderNo: no, orderedAt, buyer, total, discount, statusLabel: status, tab, items: itemsJson, syncedAt: now })
      .onConflictDoUpdate({
        target: webOrders.orderNo,
        set: { orderedAt, buyer, total, discount, statusLabel: status, tab, items: itemsJson, syncedAt: now },
      });
  }
  await db.update(integrationKeys).set({ lastUsedAt: now }).where(eq(integrationKeys.name, SYNC_KEY_NAME));
  return { count: rows.length, syncedAt: now };
}

/** /api/web-orders/sync 的處理：回傳 [狀態碼, JSON] */
export async function handleSyncRequest(db: any, key: string | null, body: unknown): Promise<[number, unknown]> {
  if (!(await verifySyncKey(db, key))) return [401, { error: "同步金鑰不正確，請到記帳系統「官網對帳」重新產生書籤" }];
  const parsed = syncPayload.safeParse(body);
  if (!parsed.success) return [400, { error: "訂單資料格式不對，官網可能改版了", detail: parsed.error.issues.slice(0, 3) }];
  const result = await upsertWebOrders(db, parsed.data.orders);
  const catalog = parsed.data.catalog ? await upsertCatalog(db, parsed.data.catalog) : null;
  return [200, { ...result, catalog }];
}

