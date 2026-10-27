import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth, canManage } from "../lib/auth";

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

type Filter = "action" | "receivable" | "ok" | "closed" | "all";
const FILTERS: { key: Filter; label: string; test: (r: string) => boolean }[] = [
  { key: "action", label: "需要處理", test: (r) => NEEDS_ACTION.has(r) },
  { key: "receivable", label: "應收", test: (r) => r === "receivable" },
  { key: "ok", label: "相符", test: (r) => r === "matched" || r === "manual" },
  { key: "closed", label: "取消／不需入帳", test: (r) => r === "cancelled" || r === "ignored" },
  { key: "all", label: "全部", test: () => true },
];

export default function ReconcilePage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const query = trpc.webOrders.reconcile.useQuery();
  const setManual = trpc.webOrders.setManualStatus.useMutation({ onSuccess: () => utils.webOrders.reconcile.invalidate() });
  const [filter, setFilter] = useState<Filter>("action");

  const data = query.data;
  const orders = data?.orders ?? [];
  const count = (f: Filter) => orders.filter((o: any) => FILTERS.find((x) => x.key === f)!.test(o.result)).length;
  const visible = orders.filter((o: any) => FILTERS.find((x) => x.key === filter)!.test(o.result));
  const manage = canManage(user?.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">官網對帳</h1>
        <p className="text-sm text-slate-500 mt-1">
          把 Leviax 官網的訂單和母記帳表對起來：官網已付款但沒記帳、金額對不上、還沒付款的應收帳款，一次看清楚。
          {data?.syncedAt ? ` 官網資料最後同步：${fmtTime(data.syncedAt)}。` : " 還沒有同步過官網訂單。"}
        </p>
      </div>

      {query.error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{query.error.message}</div>}

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
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>下單時間</th>
                <th>訂單</th>
                <th>品項</th>
                <th>官網實付</th>
                <th>官網狀態</th>
                <th>對帳結果</th>
                <th>母記帳表</th>
                {manage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((o: any) => {
                const r = RESULT[o.result];
                return (
                  <tr key={o.orderNo}>
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
                        {o.manualStatus ? (
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
                  <td colSpan={manage ? 8 : 7} className="text-center text-slate-400 py-6">
                    {filter === "action" ? "沒有需要處理的訂單 ✓" : "沒有訂單"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(data?.offline.length ?? 0) > 0 && (
        <div className="card space-y-2">
          <h2 className="font-medium text-slate-700">記帳有、官網沒有</h2>
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
