import { useState } from "react";

interface Item {
  id: number;
  name: string;
  hint?: string;
  group?: string;
}

/**
 * 複選清單：一次勾好幾本書／好幾門課，不用一筆一筆加。
 * 選項多的時候可以打字篩選；依 group 分組顯示。
 */
export default function CheckList({
  items,
  selected,
  onToggle,
  placeholder = "打字篩選...",
}: {
  items: Item[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = items.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = [...new Set(filtered.map((i) => i.group ?? ""))];
  return (
    <div className="border border-slate-200 rounded-lg">
      {items.length > 8 && (
        <div className="p-2 border-b border-slate-100">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
        </div>
      )}
      <div className="max-h-72 overflow-y-auto p-2 space-y-2">
        {groups.map((g) => (
          <div key={g}>
            {g && <div className="text-xs font-medium text-slate-400 px-1 mb-1">{g}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {filtered
                .filter((i) => (i.group ?? "") === g)
                .map((i) => (
                  <label
                    key={i.id}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer ${
                      selected.has(i.id) ? "bg-brand-50 text-brand-800" : "hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <input type="checkbox" checked={selected.has(i.id)} onChange={() => onToggle(i.id)} />
                    <span className="flex-1">{i.name}</span>
                    {i.hint && <span className="text-xs text-slate-400 whitespace-nowrap">{i.hint}</span>}
                  </label>
                ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="text-sm text-slate-400 px-1 py-2">找不到符合的項目</div>}
      </div>
    </div>
  );
}
