import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { books, coupons, courses, integrationKeys, teachers, webOrders } from "./schema";
import { SUBJECT_TEACHERS, ensureCouponSalesperson } from "./revenueCalc";

/**
 * 官網訂單同步（書籤小工具用）。
 * 書籤小工具在使用者已登入的官網後台讀出訂單，帶著「官網同步金鑰」POST 到 /api/web-orders/sync。
 * 這把金鑰只能寫入官網訂單快照，不能讀任何帳務資料；資料庫只存它的 SHA-256。
 * Express 與 Cloudflare Worker 共用（db 由呼叫端傳入）。
 */
export const SYNC_KEY_NAME = "web_orders_sync";
/** 官網伺服器自動推送用的金鑰（跟書籤分開，重新產生其中一把不會影響另一把） */
export const PUSH_KEY_NAME = "web_orders_push";
export type SyncKeyName = typeof SYNC_KEY_NAME | typeof PUSH_KEY_NAME;

export async function sha256Hex(text: string) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newSyncKey() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
  return "lxs_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifySyncKey(db: any, key: string | null, name: SyncKeyName = SYNC_KEY_NAME) {
  if (!key) return false;
  const [row] = await db.select().from(integrationKeys).where(eq(integrationKeys.name, name)).limit(1);
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
  for (const [rawName, category, subject, price] of cat.courses) {
    // 舊版書籤會把卡片上的「課程設定（上課資訊・常見問題・首頁・學員）→」連結文字黏進課名（2026-10-30 因此多建了 10 門假課程）
    const name = rawName.replace(/\s*課程設定（[^）]*）\s*→?\s*$/, "").trim();
    if (!name) continue;
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
    const saved = found ?? (await db.insert(coupons).values({ code, discountRate: rate, validUntil, isActive: active }).returning())[0];
    if (active) await ensureCouponSalesperson(db, saved);
  }
  if (cat.coupons.length) {
    for (const c of existingCoupons) if (!seenCoupons.has(c.code) && c.isActive) await db.update(coupons).set({ isActive: false, updatedAt: now }).where(eq(coupons.id, c.id));
  }
  return { courses: cat.courses.length, books: cat.books.length, coupons: cat.coupons.length };
}

/** 寫入／更新訂單快照：官網的欄位以最新為準，記帳這邊的手動標記（manual_status、manual_note）保留 */
export async function upsertWebOrders(db: any, rows: z.infer<typeof orderRow>[], keyName: SyncKeyName = SYNC_KEY_NAME) {
  const now = Date.now();
  // 記下哪些是新訂單、哪些狀態變了（給 LINE 通知用）
  const nos = rows.map((r) => r[0]);
  const before = new Map<string, any>();
  for (let i = 0; i < nos.length; i += 90)
    for (const o of await db.select().from(webOrders).where(inArray(webOrders.orderNo, nos.slice(i, i + 90)))) before.set(o.orderNo, o);
  const created: { orderNo: string; buyer: string; total: number; statusLabel: string; items: string[] }[] = [];
  const changed: { orderNo: string; buyer: string; from: string; to: string }[] = [];
  for (const [no, at, buyer, total, discount, status, tab, items] of rows) {
    const old = before.get(no);
    if (!old) created.push({ orderNo: no, buyer, total, statusLabel: status, items: items.map((it) => it[0]) });
    else if (old.statusLabel !== status) changed.push({ orderNo: no, buyer, from: old.statusLabel, to: status });
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
  await db.update(integrationKeys).set({ lastUsedAt: now }).where(eq(integrationKeys.name, keyName));
  return { count: rows.length, syncedAt: now, created, changed };
}

/** /api/web-orders/sync 的處理：回傳 [狀態碼, JSON] */
export async function handleSyncRequest(db: any, key: string | null, body: unknown): Promise<[number, unknown]> {
  if (!(await verifySyncKey(db, key))) return [401, { error: "同步金鑰不正確，請到記帳系統「官網對帳」重新產生書籤" }];
  const parsed = syncPayload.safeParse(body);
  if (!parsed.success) return [400, { error: "訂單資料格式不對，官網可能改版了", detail: parsed.error.issues.slice(0, 3) }];
  const { count, syncedAt } = await upsertWebOrders(db, parsed.data.orders);
  const catalog = parsed.data.catalog ? await upsertCatalog(db, parsed.data.catalog) : null;
  return [200, { count, syncedAt, catalog }];
}


/**
 * 官網伺服器自動推送（/api/web-orders/push）：官網有新訂單、訂單狀態改變、商品改變時主動送過來。
 * 格式是給工程師看得懂的物件（規格見 官網自動同步規格.md），這裡轉成跟書籤一樣的格式再寫入。
 * 驗證用 Authorization: Bearer <自動同步金鑰>。
 */
const pushOrder = z.object({
  orderNo: z.string().regex(/^LX-\d{8}-\d{3}$/),
  orderedAt: z.string().min(10).max(40),
  buyer: z.string().min(1).max(100),
  total: z.number().int().min(0),
  discount: z.number().int().min(0).default(0),
  status: z.enum(["pending_payment", "paid", "completed", "cancelled"]),
  statusLabel: z.string().min(1).max(50).optional(),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        price: z.number().int().min(0),
        preorder: z.boolean().default(false),
        bundle: z.boolean().default(false),
      })
    )
    .max(100),
});
const pushCatalog = z.object({
  courses: z.array(z.object({ name: z.string().min(1).max(200), category: z.enum(["online", "tutoring"]), subject: z.string().max(20), price: z.number().int().min(0) })).max(500).optional(),
  books: z.array(z.object({ name: z.string().min(1).max(200), kind: z.enum(["book", "workbook", "bundle", "notebook"]), price: z.number().int().min(0) })).max(1000).optional(),
  coupons: z
    .array(z.object({ code: z.string().min(1).max(50), discountRate: z.number().min(0).max(1), validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), active: z.boolean() }))
    .max(500)
    .optional(),
});
export const pushPayload = z.object({ orders: z.array(pushOrder).max(5000).default([]), catalog: pushCatalog.optional() });

const DEFAULT_LABEL = { pending_payment: "待付款", paid: "已付款", completed: "訂單完成", cancelled: "已取消" } as const;

/** 物件格式 → 書籤的陣列格式。時間一律換成台灣時間；對帳靠「待付款」這個字判斷沒付錢，所以已付款的訂單不能用這個字 */
export function pushOrderToRow(o: z.infer<typeof pushOrder>): z.infer<typeof orderRow> {
  const ms = Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(o.orderedAt) ? o.orderedAt : `${o.orderedAt}+08:00`);
  if (Number.isNaN(ms)) throw new Error(`訂單 ${o.orderNo} 的 orderedAt 看不懂：${o.orderedAt}`);
  const at = new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 19);
  let label = o.statusLabel ?? DEFAULT_LABEL[o.status];
  if (o.status === "pending_payment") label = "待付款";
  else if (label === "待付款") label = DEFAULT_LABEL[o.status];
  const tab = o.status === "completed" ? "completed" : o.status === "cancelled" ? "cancelled" : "pending";
  return [o.orderNo, at, o.buyer, o.total, o.discount, label, tab, o.items.map((i) => [i.name, i.price, i.preorder ? 1 : 0, i.bundle ? 1 : 0] as [string, number, 0 | 1, 0 | 1])];
}

/** /api/web-orders/push 的處理：回傳 [狀態碼, JSON] */
export type OrderChanges = Pick<Awaited<ReturnType<typeof upsertWebOrders>>, "created" | "changed">;

/** onChanges：有新訂單或狀態改變時呼叫（Worker 用來發 LINE 通知） */
export async function handlePushRequest(
  db: any,
  authorization: string | null,
  body: unknown,
  onChanges?: (c: OrderChanges) => Promise<unknown>
): Promise<[number, unknown]> {
  const key = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  if (!(await verifySyncKey(db, key, PUSH_KEY_NAME))) return [401, { error: "自動同步金鑰不正確" }];
  const parsed = pushPayload.safeParse(body);
  if (!parsed.success) return [400, { error: "資料格式不對", detail: parsed.error.issues.slice(0, 5) }];
  let rows: z.infer<typeof orderRow>[];
  try {
    rows = parsed.data.orders.map(pushOrderToRow);
  } catch (e: any) {
    return [400, { error: e.message }];
  }
  const { count, syncedAt, created, changed } = await upsertWebOrders(db, rows, PUSH_KEY_NAME);
  if (onChanges && (created.length || changed.length)) {
    try {
      await onChanges({ created, changed });
    } catch (e) {
      console.error("LINE 通知失敗", e); // 通知失敗不影響同步
    }
  }
  const c = parsed.data.catalog;
  const catalog = c
    ? await upsertCatalog(db, {
        courses: (c.courses ?? []).map((x) => [x.name, x.category, x.subject, x.price] as [string, "online" | "tutoring", string, number]),
        books: (c.books ?? []).map((x) => [x.name, x.kind, x.price] as [string, "book" | "workbook" | "bundle" | "notebook", number]),
        coupons: (c.coupons ?? []).map((x) => [x.code, x.discountRate, x.validUntil, x.active] as [string, number, string | null, boolean]),
      })
    : null;
  return [200, { ok: true, count, syncedAt, catalog }];
}
