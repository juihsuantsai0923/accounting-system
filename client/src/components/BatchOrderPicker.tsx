import { useState } from "react";

export const BATCH_LIMIT = 150;

export interface OrderOption {
  orderNo: string;
  orderedAt: number;
  buyer: string;
  items: string[];
  completed?: boolean;
  registeredCategories: string[];
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

  function toggle(orderNo: string) {
    onChange(picked.includes(orderNo) ? picked.filter((no) => no !== orderNo) : [...picked, orderNo]);
  }

  function selectVisible() {
    onChange([...new Set([...picked, ...visible.filter((o) => !isRegistered(o) && !o.completed).map((o) => o.orderNo)])]);
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
              <input type="checkbox" checked={checked} onChange={() => toggle(o.orderNo)} />
              <span className="min-w-0">
                <span className="font-medium">{o.buyer}</span>
                <span className="text-xs text-slate-400 ml-2">
                  #{o.orderNo}・{new Date(o.orderedAt).toLocaleDateString()}
                </span>
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
        已選 {count} 張訂單，合計一筆代墊
        {orders.some((o) => o.completed) && <span className="text-slate-400">（全選不含已完成的訂單）</span>}
        {count > BATCH_LIMIT && `（一次最多 ${BATCH_LIMIT} 張）`}
      </div>
    </div>
  );
}
