import { useState } from "react";

export const BATCH_LIMIT = 150;

export interface OrderOption {
  orderNo: string;
  orderedAt: number;
  buyer: string;
  items: string[];
  completed?: boolean;
  /** 寄件代碼：同一個代碼＝同一包 */
  trackingCode?: string | null;
  registeredCategories: string[];
}

/** 包裹數：寄件代碼相同算一包，沒有代碼的一張訂單算一包 */
export function packageCount(orders: OrderOption[]) {
  const codes = new Set<string>();
  let noCode = 0;
  for (const o of orders) {
    if (o.trackingCode) codes.add(o.trackingCode);
    else noCode++;
  }
  return codes.size + noCode;
}

/** 多張訂單一起登記代墊：這裡只勾訂單，金額填這批的總金額。picked＝勾選的訂單編號；全選不勾已完成的訂單（可能和同人另一張訂單同一包），要的話自己勾 */
export default function BatchOrderPicker({
  orders,
  category,
  picked,
  onChange,
}: {
  orders: OrderOption[];
  category: string;
  picked: string[];
  onChange: (picked: string[]) => void;
}) {
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const visible = orders.filter((o) => !q || `${o.orderNo} ${o.buyer} ${o.items.join(" ")}`.toLowerCase().includes(q));
  const isRegistered = (o: OrderOption) => o.registeredCategories.includes(category);
  const count = picked.length;
  const pickedOrders = orders.filter((o) => picked.includes(o.orderNo));
  const packages = packageCount(pickedOrders);
  // 同一個寄件代碼的訂單（同一包）一起勾、一起取消
  const sameBox = (o: OrderOption) => (o.trackingCode ? orders.filter((x) => x.trackingCode === o.trackingCode).map((x) => x.orderNo) : [o.orderNo]);
  const boxSize = (o: OrderOption) => (o.trackingCode ? orders.filter((x) => x.trackingCode === o.trackingCode).length : 1);

  function toggle(o: OrderOption) {
    const box = sameBox(o);
    onChange(picked.includes(o.orderNo) ? picked.filter((no) => !box.includes(no)) : [...new Set([...picked, ...box])]);
  }

  function selectVisible() {
    const add = visible.filter((o) => !isRegistered(o) && !o.completed).flatMap(sameBox);
    onChange([...new Set([...picked, ...add])]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-48">
          <label className="label">搜尋訂單</label>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="訂單編號、下訂人、品項" />
        </div>
        <button className="btn-secondary" type="button" onClick={selectVisible}>
          全選
        </button>
        <button className="btn-secondary" type="button" onClick={() => onChange([])} disabled={!count}>
          清除
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
        {visible.map((o) => {
          const checked = picked.includes(o.orderNo);
          return (
            <label key={o.orderNo} className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer ${checked ? "bg-brand-50" : ""}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(o)} />
              <span className="min-w-0">
                <span className="font-medium">{o.buyer}</span>
                <span className="text-xs text-slate-400 ml-2">
                  #{o.orderNo}・{new Date(o.orderedAt).toLocaleDateString()}
                </span>
                {o.trackingCode && (
                  <span className="text-xs text-sky-700 bg-sky-50 rounded px-1.5 py-0.5 ml-2">
                    寄件代碼 {o.trackingCode}
                    {boxSize(o) > 1 && `・同一包 ${boxSize(o)} 張`}
                  </span>
                )}
                {o.completed && <span className="text-xs text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5 ml-2">已完成</span>}
                {isRegistered(o) && <span className="text-xs text-amber-600 ml-2">已登記過{category}</span>}
                <span className="block text-xs text-slate-500 truncate">{o.items.join("、")}</span>
              </span>
            </label>
          );
        })}
        {visible.length === 0 && <div className="text-center text-slate-400 py-6 text-sm">沒有符合的訂單</div>}
      </div>
      <div className={`text-sm ${count > BATCH_LIMIT ? "text-red-600" : "text-slate-600"}`}>
        已選 {count} 張訂單、{packages} 包，合計一筆代墊
        {pickedOrders.some((o) => !o.trackingCode) && <span className="text-slate-400">（沒有寄件代碼的訂單一張算一包）</span>}
        {orders.some((o) => o.completed) && <span className="text-slate-400">（全選不含已完成的訂單）</span>}
        {count > BATCH_LIMIT && `（一次最多 ${BATCH_LIMIT} 張）`}
      </div>
    </div>
  );
}
