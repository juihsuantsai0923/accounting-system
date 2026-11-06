import { useState } from "react";

export const BATCH_LIMIT = 150;

export interface OrderOption {
  orderNo: string;
  orderedAt: number;
  buyer: string;
  items: string[];
  registeredCategories: string[];
}

/** 多筆代墊：勾選官網訂單，每張填金額。picked＝訂單編號 → 金額字串 */
export default function BatchOrderPicker({
  orders,
  category,
  picked,
  onChange,
}: {
  orders: OrderOption[];
  category: string;
  picked: Record<string, string>;
  onChange: (picked: Record<string, string>) => void;
}) {
  const [search, setSearch] = useState("");
  const [sameAmount, setSameAmount] = useState("");

  const q = search.trim().toLowerCase();
  const visible = orders.filter((o) => !q || `${o.orderNo} ${o.buyer} ${o.items.join(" ")}`.toLowerCase().includes(q));
  const isRegistered = (o: OrderOption) => o.registeredCategories.includes(category);
  const count = Object.keys(picked).length;
  const total = Object.values(picked).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);

  function toggle(orderNo: string) {
    const next = { ...picked };
    if (orderNo in next) delete next[orderNo];
    else next[orderNo] = sameAmount;
    onChange(next);
  }

  function selectVisible() {
    const next = { ...picked };
    for (const o of visible) if (!isRegistered(o) && !(o.orderNo in next)) next[o.orderNo] = sameAmount;
    onChange(next);
  }

  function applySameAmount(value: string) {
    setSameAmount(value);
    onChange(Object.fromEntries(Object.keys(picked).map((k) => [k, value])));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-48">
          <label className="label">搜尋訂單</label>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="訂單編號、下訂人、品項" />
        </div>
        <div className="w-36">
          <label className="label">每筆金額（全部套用）</label>
          <input className="input" inputMode="numeric" value={sameAmount} onChange={(e) => applySameAmount(e.target.value.replace(/[^\d]/g, ""))} />
        </div>
        <button className="btn-secondary" type="button" onClick={selectVisible}>
          全選
        </button>
        <button className="btn-secondary" type="button" onClick={() => onChange({})} disabled={!count}>
          清除
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
        {visible.map((o) => {
          const checked = o.orderNo in picked;
          return (
            <div key={o.orderNo} className={`flex items-center gap-3 px-3 py-2 text-sm ${checked ? "bg-brand-50" : ""}`}>
              <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                <input type="checkbox" checked={checked} onChange={() => toggle(o.orderNo)} />
                <span className="min-w-0">
                  <span className="font-medium">{o.buyer}</span>
                  <span className="text-xs text-slate-400 ml-2">
                    #{o.orderNo}・{new Date(o.orderedAt).toLocaleDateString()}
                  </span>
                  {isRegistered(o) && <span className="text-xs text-amber-600 ml-2">已登記過{category}</span>}
                  <span className="block text-xs text-slate-500 truncate">{o.items.join("、")}</span>
                </span>
              </label>
              {checked && (
                <input
                  className="input !w-24"
                  inputMode="numeric"
                  aria-label={`${o.buyer} 金額`}
                  value={picked[o.orderNo]}
                  onChange={(e) => onChange({ ...picked, [o.orderNo]: e.target.value.replace(/[^\d]/g, "") })}
                  placeholder="金額"
                />
              )}
            </div>
          );
        })}
        {visible.length === 0 && <div className="text-center text-slate-400 py-6 text-sm">沒有符合的訂單</div>}
      </div>
      <div className={`text-sm ${count > BATCH_LIMIT ? "text-red-600" : "text-slate-600"}`}>
        已選 {count} 筆，共 NT${total.toLocaleString()}
        {count > BATCH_LIMIT && `（一次最多 ${BATCH_LIMIT} 筆）`}
      </div>
    </div>
  );
}
