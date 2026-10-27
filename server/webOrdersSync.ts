import { z } from "zod";
import { eq } from "drizzle-orm";
import { integrationKeys, webOrders } from "./schema";

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
export const syncPayload = z.object({ orders: z.array(orderRow).max(5000) });

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
  return [200, await upsertWebOrders(db, parsed.data.orders)];
}

