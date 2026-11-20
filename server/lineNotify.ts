/**
 * LINE 通知：用 LINE 官方帳號（Messaging API）推播給管理員。
 *   LINE_CHANNEL_ACCESS_TOKEN：Messaging API 的 Channel access token（Worker secret）
 *   LINE_NOTIFY_TO：要收通知的人的 LINE user ID（LINE Developers → 該 channel → Basic settings → Your user ID），多人用逗號分開（Worker secret）
 *   LINE_NEW_ORDER_TO：出貨員（余彩霞），多人用逗號分開；只在訂單收到款、有書要寄（待出貨）時通知，其他狀態改變、每日提醒都不發（wrangler.toml [vars]，2026-11-20 起；原本是新訂單就發）
 * 沒設定就什麼都不做（不會讓同步或排程失敗）。
 */
export interface LineConfig {
  token?: string;
  to?: string;
  /** 出貨員：只收待出貨通知的 user ID（逗號分開） */
  newOrderTo?: string;
}

export function lineConfigured(cfg: LineConfig) {
  return !!(cfg.token && cfg.to);
}

export async function sendLine(cfg: LineConfig, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!lineConfigured(cfg)) return { ok: false, error: "還沒設定 LINE 通知" };
  const targets = cfg.to!.split(",").map((s) => s.trim()).filter(Boolean);
  for (const to of targets) {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    });
    if (!res.ok) return { ok: false, error: `LINE 回應 ${res.status}：${(await res.text()).slice(0, 200)}` };
  }
  return { ok: true };
}

export const money = (n: number) => `NT$${n.toLocaleString()}`;

/** 官網付款狀態文字（ORDER_STATUS_LABELS）：這兩個代表已收款、書可以開始寄（官網後台的「2. 待出貨」）；部分退款會在後面加註，所以比開頭 */
const READY_TO_SHIP = ["已匯款", "課程已開通"];
export const isReadyToShip = (label: string) => READY_TO_SHIP.some((s) => label.startsWith(s));

/** 要寄的東西：排除課程（品名＝課程名稱，或「課程（○○方案）」）與運費 */
export function shippableItems(items: string[], courseNames: Set<string>) {
  return items.filter((n) => n !== "運費" && !courseNames.has(n) && !/方案）$/.test(n));
}

type PushedOrder = { orderNo: string; buyer: string; items: string[] };
/**
 * 這次推送裡變成「待出貨」的訂單：待付款 → 已匯款／課程已開通，或一進來就已付款（線上付款）。
 * 只有課程、沒有書的訂單不列；直接跳到訂單完成的也不列（書已經寄了）。
 */
export function ordersToShip(
  created: (PushedOrder & { statusLabel: string })[],
  changed: (PushedOrder & { from: string; to: string })[],
  courseNames: Set<string>
) {
  return [
    ...created.filter((o) => isReadyToShip(o.statusLabel)),
    ...changed.filter((c) => c.from.startsWith("待付款") && isReadyToShip(c.to)),
  ]
    .map((o) => ({ orderNo: o.orderNo, buyer: o.buyer, items: shippableItems(o.items, courseNames) }))
    .filter((o) => o.items.length);
}

/** 給出貨員：每張待出貨訂單一段，只有訂單編號、買家、要寄的書，不含金額 */
export function shipperShippingMessage(orders: PushedOrder[]) {
  return orders.map((o) => [`📦 待出貨 ${o.orderNo}`, `買家：${o.buyer}`, `要寄：${o.items.join("、")}`].join("\n")).join("\n\n");
}

/** 查 LINE 好友的顯示名稱（只讀，不會傳訊息）；用來確認 user ID 填對人 */
export async function lineDisplayName(token: string, userId: string): Promise<{ userId: string; name?: string; error?: string }> {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { userId, error: `LINE 回應 ${res.status}` };
  const p: any = await res.json();
  return { userId, name: p.displayName };
}

/** 官網推送進來的新訂單、狀態改變 → 一則訊息 */
export function orderMessage(
  created: { orderNo: string; buyer: string; total: number; statusLabel: string; items: string[] }[],
  changed: { orderNo: string; buyer: string; from: string; to: string }[]
) {
  const lines: string[] = [];
  for (const o of created) {
    lines.push(`🛒 新訂單 ${o.orderNo}`, `買家：${o.buyer}`, `金額：${money(o.total)}（${o.statusLabel}）`, `品項：${o.items.join("、")}`, "");
  }
  for (const c of changed) lines.push(`🔄 ${c.orderNo}（${c.buyer}）：${c.from} → ${c.to}`);
  return lines.join("\n").trim();
}
