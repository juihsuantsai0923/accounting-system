/**
 * LINE 通知：用 LINE 官方帳號（Messaging API）推播給管理員。
 *   LINE_CHANNEL_ACCESS_TOKEN：Messaging API 的 Channel access token（Worker secret）
 *   LINE_NOTIFY_TO：要收通知的人的 LINE user ID（LINE Developers → 該 channel → Basic settings → Your user ID），多人用逗號分開（Worker secret）
 * 沒設定就什麼都不做（不會讓同步或排程失敗）。
 */
export interface LineConfig {
  token?: string;
  to?: string;
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
