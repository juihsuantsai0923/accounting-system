import { useEffect, useRef, useState } from "react";

interface Option {
  id: number;
  name: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: number | "";
  onChange: (id: number) => void;
  placeholder?: string;
  className?: string;
}

/**
 * 下拉搜尋選單：人員、課程、書目變多之後，一般 <select> 要一直往下滑很難找，
 * 這個元件讓使用者可以直接打字篩選，適合用在選項很多的表單欄位。
 */
export default function SearchableSelect({ options, value, onChange, placeholder = "請選擇...", className = "" }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <button type="button" className="input text-left flex items-center justify-between" onClick={() => setOpen((v) => !v)}>
        <span className={selected ? "" : "text-slate-400"}>{selected ? selected.name : placeholder}</span>
        <span className="text-slate-400 ml-2 shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 flex flex-col">
          <input
            autoFocus
            className="input rounded-none rounded-t-lg border-0 border-b border-slate-200 focus:ring-0"
            placeholder="輸入關鍵字搜尋..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">查無符合的選項</div>}
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 ${o.id === value ? "bg-brand-50 text-brand-700 font-medium" : ""}`}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {o.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
