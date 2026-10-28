import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { trpc, API_BASE } from "../lib/trpc";
import { useAuth, canManage } from "../lib/auth";
import RecordOrdersDialog from "../components/RecordOrdersDialog";

function fmt(n: number) {
  return n < 0 ? `−NT$${Math.abs(n).toLocaleString()}` : `NT$${n.toLocaleString()}`;
}
function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("zh-TW", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** 對帳結果：顏色＋圖示＋文字一起表示，不只靠顏色 */
const RESULT: Record<string, { label: string; icon: string; cls: string }> = {
  missing: { label: "未入帳", icon: "✕", cls: "bg-red-50 text-red-700" },
  probable: { label: "可能對應", icon: "?", cls: "bg-amber-50 text-amber-800" },
  mismatch: { label: "金額不符", icon: "!", cls: "bg-amber-50 text-amber-800" },
  matched_gross: { label: "記了原價", icon: "!", cls: "bg-amber-50 text-amber-800" },
  receivable: { label: "應收（待付款）", icon: "⏳", cls: "bg-brand-50 text-brand-700" },
  matched: { label: "相符", icon: "✓", cls: "bg-emerald-50 text-emerald-700" },
  manual: { label: "已人工確認", icon: "✓", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "已取消", icon: "–", cls: "bg-slate-100 text-slate-500" },
  ignored: { label: "不需入帳", icon: "–", cls: "bg-slate-100 text-slate-500" },
};
const NEEDS_ACTION = new Set(["missing", "probable", "mismatch", "matched_gross"]);
/** 可以勾選「確認入帳」的：待付款（應收）、官網已付款但記帳找不到 */
const RECORDABLE = new Set(["receivable", "missing"]);

type Filter = "action" | "receivable" | "ok" | "closed" | "all";
const FILTERS: { key: Filter; label: string; test: (r: string) => boolean }[] = [
  { key: "action", label: "需要處理", test: (r) => NEEDS_ACTION.has(r) },
  { key: "receivable", label: "應收", test: (r) => r === "receivable" },
  { key: "ok", label: "相符", test: (r) => r === "matched" || r === "manual" },
  { key: "closed", label: "取消／不需入帳", test: (r) => r === "cancelled" || r === "ignored" },
  { key: "all", label: "全部", test: () => true },
];

const WEBSITE_ORDERS_URL = "https://leviax-lab.vercel.app/admin/orders?tab=pending";

/** 書籤小工具：在官網後台點它，就會載入記帳系統的同步腳本 */
function bookmarkletFor(key: string) {
  const origin = window.location.origin;
  const cfg = JSON.stringify({ key, api: API_BASE || origin, back: `${origin}/reconcile?synced=1` });
  const code = `(function(){window.__LX_SYNC=${cfg};var s=document.createElement('script');s.src='${origin}/web-orders-sync.js?v='+Date.now();document.body.appendChild(s);})()`;
  return "javascript:" + encodeURIComponent(code);
}

/** React 會擋 href="javascript:..."，所以掛載後再用 setAttribute 設定 */
function BookmarkletLink({ href }: { href: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.setAttribute("href", href);
  }, [href]);
  return (
    <a
      ref={ref}
      onClick={(e) => {
        e.preventDefault();
        alert("請用拖的：按住這個按鈕，拖到瀏覽器上方的書籤列。");
      }}
      className="btn-gold gap-2 cursor-grab"
    >
      ⇅ 同步到記帳
    </a>
  );
}

function SyncPanel({ syncedAt, onRefresh }: { syncedAt: number | null; onRefresh: () => void }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const statusQuery = trpc.webOrders.syncKeyStatus.useQuery();
  const generate = trpc.webOrders.generateSyncKey.useMutation({ onSuccess: () => utils.webOrders.syncKeyStatus.invalidate() });
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const isAdmin = user?.role === "super_admin";
  const hasKey = statusQuery.data?.exists;

  // 回到這個分頁時自動重新整理，同步完不用手動按重新整理
  useEffect(() => {
    if (!waiting) return;
    const onFocus = () => onRefresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [waiting, onRefresh]);

  return (
    <div className="card space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-medium text-brand-700">和官網同步</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {syncedAt ? `上次同步：${fmtTime(syncedAt)}` : "還沒同步過"}
            {statusQuery.data?.lastUsedAt ? `（書籤最後使用：${fmtTime(statusQuery.data.lastUsedAt)}）` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-primary"
            disabled={!hasKey}
            title={hasKey ? undefined : "要先設定同步書籤"}
            onClick={() => {
              setWaiting(true);
              window.open(WEBSITE_ORDERS_URL, "_blank");
            }}
          >
            立即同步官網訂單
          </button>
          <button className="btn-secondary" onClick={() => setShowSetup((v) => !v)}>
            {hasKey ? "書籤設定" : "設定同步書籤"}
          </button>
        </div>
      </div>

      {waiting && (
        <div className="text-sm bg-brand-50 text-brand-800 rounded-lg px-3 py-2">
          已打開官網訂單頁。請在那個分頁點書籤列上的「⇅ 同步到記帳」，完成後會自動回到這裡並更新結果。
        </div>
      )}

      {(showSetup || (!hasKey && !statusQuery.isLoading)) && (
        <div className="border border-slate-200 rounded-lg p-4 space-y-3 text-sm text-slate-700">
          <div className="font-medium">一次性設定（每台電腦、每個瀏覽器做一次）</div>
          <ol className="list-decimal pl-5 space-y-1 text-slate-600">
            <li>瀏覽器要顯示書籤列（Chrome：Ctrl＋Shift＋B）。</li>
            <li>按下面的「產生同步書籤」，把出現的金色按鈕<b>拖到書籤列</b>。</li>
            <li>之後要對帳：按上面「立即同步官網訂單」→ 在打開的官網分頁點書籤「⇅ 同步到記帳」。</li>
          </ol>
          <p className="text-xs text-slate-500">
            書籤裡有一組專用金鑰，只能把官網訂單送進記帳系統，不能讀任何帳務資料；它會讀官網後台的訂單（你要已登入官網），但不讀電話、地址、匯款末五碼。
            {hasKey && " 重新產生後，之前拖過的書籤就會失效，要重新拖一次。"}
          </p>
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="btn-secondary"
                disabled={generate.isPending}
                onClick={async () => {
                  if (hasKey && !confirm("重新產生後，之前的同步書籤會失效。確定要重新產生嗎？")) return;
                  const r = await generate.mutateAsync();
                  setNewKey(r.key);
                }}
              >
                {generate.isPending ? "產生中..." : hasKey ? "重新產生同步書籤" : "產生同步書籤"}
              </button>
              {newKey && (
                <>
                  <BookmarkletLink href={bookmarkletFor(newKey)} />
                  <span className="text-xs text-amber-700">← 拖到書籤列（這個按鈕只會出現這一次）</span>
                </>
              )}
            </div>
          ) : (
            <p className="text-xs text-amber-700">產生同步書籤需要系統管理員權限，請管理員產生後把書籤分享給你。</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReconcilePage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const query = trpc.webOrders.reconcile.useQuery();
  const setManual = trpc.webOrders.setManualStatus.useMutation({ onSuccess: () => utils.webOrders.reconcile.invalidate() });
  const [filter, setFilter] = useState<Filter>("action");
  const [params, setParams] = useSearchParams();
  const justSynced = params.get("synced") === "1";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const data = query.data;
  const orders = data?.orders ?? [];
  const count = (f: Filter) => orders.filter((o: any) => FILTERS.find((x) => x.key === f)!.test(o.result)).length;
  const visible = orders.filter((o: any) => FILTERS.find((x) => x.key === filter)!.test(o.result));
  const manage = canManage(user?.role);
  const recordable = visible.filter((o: any) => RECORDABLE.has(o.result));
  const selectedOrders = orders.filter((o: any) => selected.has(o.orderNo) && RECORDABLE.has(o.result));
  const selectedTotal = selectedOrders.reduce((s: number, o: any) => s + o.total, 0);
  function toggle(no: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(no) ? next.delete(no) : next.add(no);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl text-brand-700">官網對帳</h1>
        <p className="text-sm text-slate-500 mt-1">
          把 Leviax 官網的訂單和帳本對起來：官網已付款但沒記帳、金額對不上、還沒付款的應收帳款，一次看清楚。
          {data?.syncedAt ? ` 官網資料最後同步：${fmtTime(data.syncedAt)}。` : " 還沒有同步過官網訂單。"}
        </p>
      </div>

      {query.error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{query.error.message}</div>}
      {justSynced && (
        <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 flex justify-between">
          <span>✓ 官網訂單已同步，下面是最新的對帳結果。</span>
          <button className="text-emerald-700 underline" onClick={() => setParams({})}>
            關閉
          </button>
        </div>
      )}

      {doneMsg && (
        <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 flex justify-between">
          <span>✓ {doneMsg}</span>
          <button className="text-emerald-700 underline" onClick={() => setDoneMsg(null)}>
            關閉
          </button>
        </div>
      )}

      {manage && <SyncPanel syncedAt={data?.syncedAt ?? null} onRefresh={() => query.refetch()} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="text-sm text-slate-500">應收帳款</div>
          <div className="text-2xl font-semibold mt-1 text-brand-700">{fmt(data?.receivable.total ?? 0)}</div>
          <div className="text-xs text-slate-400 mt-1">{data?.receivable.count ?? 0} 張待付款訂單</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">需要處理</div>
          <div className={`text-2xl font-semibold mt-1 ${count("action") ? "text-red-600" : "text-slate-800"}`}>{count("action")} 張</div>
          <div className="text-xs text-slate-400 mt-1">未入帳、可能對應、金額不符、記了原價</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">相符</div>
          <div className="text-2xl font-semibold mt-1 text-emerald-600">{count("ok")} 張</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">記帳有、官網沒有</div>
          <div className="text-2xl font-semibold mt-1 text-slate-800">{data?.offline.length ?? 0} 筆</div>
          <div className="text-xs text-slate-400 mt-1">可能是線下收款</div>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={filter === f.key ? "btn-primary" : "btn-secondary"} onClick={() => setFilter(f.key)}>
              {f.label}（{count(f.key)}）
            </button>
          ))}
        </div>
        {manage && recordable.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 bg-brand-50 rounded-lg px-3 py-2 text-sm">
            <span className="text-brand-800">
              {selectedOrders.length ? `已選 ${selectedOrders.length} 張，官網實付合計 ${fmt(selectedTotal)}` : "勾選已經收到錢的訂單，就能一次入帳"}
            </span>
            <button className="btn-primary" disabled={!selectedOrders.length} onClick={() => setDialogOpen(true)}>
              確認入帳（已收到錢）
            </button>
            {selectedOrders.length > 0 && (
              <button className="text-brand-700 underline" onClick={() => setSelected(new Set())}>
                全部取消
              </button>
            )}
          </div>
        )}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {manage && (
                  <th className="w-8">
                    {recordable.length > 0 && (
                      <input
                        type="checkbox"
                        aria-label="全選可入帳的訂單"
                        checked={recordable.every((o: any) => selected.has(o.orderNo))}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            recordable.forEach((o: any) => (e.target.checked ? next.add(o.orderNo) : next.delete(o.orderNo)));
                            return next;
                          })
                        }
                      />
                    )}
                  </th>
                )}
                <th>下單時間</th>
                <th>訂單</th>
                <th>品項</th>
                <th>官網實付</th>
                <th>官網狀態</th>
                <th>對帳結果</th>
                <th>帳本</th>
                {manage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((o: any) => {
                const r = RESULT[o.result];
                return (
                  <tr key={o.orderNo} className={selected.has(o.orderNo) ? "bg-brand-50/50" : undefined}>
                    {manage && (
                      <td>
                        {RECORDABLE.has(o.result) && (
                          <input type="checkbox" aria-label={`選取 ${o.buyer} 的訂單`} checked={selected.has(o.orderNo)} onChange={() => toggle(o.orderNo)} />
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap">{fmtTime(o.orderedAt)}</td>
                    <td className="whitespace-nowrap">
                      <div className="font-medium">{o.buyer}</div>
                      <div className="text-xs text-slate-400 font-mono">{o.orderNo}</div>
                    </td>
                    <td className="min-w-[14rem]">
                      {o.items.map((it: any, i: number) => (
                        <div key={i} className="text-xs text-slate-600">
                          {it.name} <span className="text-slate-400">{fmt(it.price)}</span>
                          {it.bundle && <span className="ml-1 rounded bg-slate-100 px-1 text-slate-500">組合包</span>}
                          {it.preorder && <span className="ml-1 rounded bg-gold-100 px-1 text-gold-800">預購</span>}
                        </div>
                      ))}
                    </td>
                    <td className="whitespace-nowrap">
                      {fmt(o.total)}
                      {o.discount > 0 && <div className="text-xs text-slate-400">折扣 {fmt(o.discount)}</div>}
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{o.statusLabel}</td>
                    <td className="min-w-[10rem]">
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${r.cls}`}>
                        <span aria-hidden>{r.icon}</span>
                        {r.label}
                      </span>
                      {o.message && <div className="text-xs text-slate-500 mt-1 whitespace-normal max-w-xs">{o.message}</div>}
                    </td>
                    <td className="whitespace-nowrap text-sm">
                      {o.ledgerIds.length ? (
                        <>
                          {fmt(o.ledgerAmount)}
                          <div className="text-xs text-slate-400">{o.ledgerIds.length} 筆記錄</div>
                        </>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    {manage && (
                      <td className="whitespace-nowrap space-x-1">
                        {o.manualStatus === "received" ? (
                          <span className="text-xs text-slate-400">已確認收款</span>
                        ) : o.manualStatus ? (
                          <button className="btn-secondary" onClick={() => setManual.mutate({ orderNo: o.orderNo, status: null })}>
                            取消標記
                          </button>
                        ) : (
                          NEEDS_ACTION.has(o.result) && (
                            <>
                              <button
                                className="btn-secondary"
                                title="已經人工核對過，這張沒問題"
                                onClick={() => {
                                  const note = prompt("備註（選填，例如：折扣已另記支出）") ?? undefined;
                                  setManual.mutate({ orderNo: o.orderNo, status: "matched", note: note || undefined });
                                }}
                              >
                                確認無誤
                              </button>
                              <button
                                className="btn-secondary"
                                title="這張訂單不需要記帳（例如測試、贈送）"
                                onClick={() => {
                                  const note = prompt("為什麼不需入帳？（選填）") ?? undefined;
                                  setManual.mutate({ orderNo: o.orderNo, status: "ignored", note: note || undefined });
                                }}
                              >
                                不需入帳
                              </button>
                            </>
                          )
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={manage ? 9 : 7} className="text-center text-slate-400 py-6">
                    {filter === "action" ? "沒有需要處理的訂單 ✓" : "沒有訂單"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {dialogOpen && (
        <RecordOrdersDialog
          orderNos={selectedOrders.map((o: any) => o.orderNo)}
          onClose={() => setDialogOpen(false)}
          onDone={(msg) => {
            setDialogOpen(false);
            setSelected(new Set());
            setDoneMsg(msg);
          }}
        />
      )}

      {(data?.offline.length ?? 0) > 0 && (
        <div className="card space-y-2">
          <h2 className="font-medium text-brand-700">記帳有、官網沒有</h2>
          <p className="text-xs text-slate-500">這些課程、書籍收入沒有對到官網訂單，可能是線下收款、轉帳直接付款，或官網訂單還沒同步。確認是線下收款就不用處理。</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>項目</th>
                  <th>類別</th>
                  <th>金額</th>
                </tr>
              </thead>
              <tbody>
                {data!.offline.map((e: any) => (
                  <tr key={e.id}>
                    <td>{new Date(e.createdAt).toLocaleDateString()}</td>
                    <td>
                      {e.itemName}
                      {e.note && <div className="text-xs text-slate-400">{e.note}</div>}
                    </td>
                    <td>{e.categoryName}</td>
                    <td>{fmt(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
