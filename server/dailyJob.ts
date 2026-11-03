import { appRouter } from "./routers/index";
import { checkIntegrity } from "./integrity";
import { runDueRecurring } from "./recurring";
import { lineConfigured, money, sendLine, type LineConfig } from "./lineNotify";

/**
 * 每天早上 9 點的排程（wrangler.toml [triggers]）：
 *   1. 記定期收支
 *   2. 帳務自我檢查
 *   3. 官網訂單對帳（有對不上的、待付款超過 3 天的）
 *   4. 還沒處理的帳號申請
 * 有事情才發 LINE；沒事不吵。
 */
export async function dailyJob(db: any, cfg: LineConfig) {
  const lines: string[] = [];
  const created = await runDueRecurring(db);
  if (created.length) lines.push(`📒 自動記了 ${created.length} 筆定期收支：`, ...created.map((c) => `・${c.itemName} ${c.type === "income" ? "+" : "−"}${money(c.amount)}`));

  const issues = await checkIntegrity(db);
  if (issues.length) lines.push("⚠ 帳務檢查：", ...issues.map((t) => `・${t}`));

  const caller = appRouter.createCaller({ db, user: { id: 0, role: "super_admin", realRole: "super_admin" } } as any);
  const rec: any = await caller.webOrders.reconcile();
  const bad = rec.orders.filter((o: any) => ["missing", "probable", "mismatch", "matched_gross"].includes(o.result));
  if (bad.length) lines.push(`🔍 官網有 ${bad.length} 張訂單跟帳本對不上（${bad.slice(0, 5).map((o: any) => o.orderNo).join("、")}${bad.length > 5 ? "…" : ""}）`);
  const stale = rec.orders.filter((o: any) => o.result === "receivable" && Date.now() - o.orderedAt > 3 * 86400_000);
  if (stale.length) lines.push(`💰 ${stale.length} 張訂單待付款超過 3 天，共 ${money(stale.reduce((s: number, o: any) => s + o.total, 0))}`);

  const pendingRequests = await caller.accountRequests.pendingCount();
  if (pendingRequests) lines.push(`👤 有 ${pendingRequests} 個帳號申請還沒處理（管理面板 → 帳號申請）`);

  if (lines.length && lineConfigured(cfg)) await sendLine(cfg, ["澈點科學財務系統 每日提醒", "", ...lines].join("\n"));
  return lines;
}
