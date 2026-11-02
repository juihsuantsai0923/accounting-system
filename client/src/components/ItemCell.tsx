import { useState } from "react";
import { NOTE_FIELDS, parseNote } from "../../../server/noteFormat";

/**
 * 帳本「項目」欄：合併記帳的項目名稱是「A、B、C」一長串，加上備註會把表格撐得很寬。
 * 預設只顯示第一項（＋還有幾項），點一下往下展開成直的清單，連同備註一行一行列出來。
 * 結尾的「（小班家教分潤）」這類說明當成整筆的標籤，不算一項。
 */
export default function ItemCell({ itemName, note }: { itemName: string; note?: string | null }) {
  const [open, setOpen] = useState(false);
  const m = itemName.match(/^(.*)（([^（）、]*)）$/);
  const body = m && m[1].includes("、") ? m[1] : itemName;
  const suffix = m && m[1].includes("、") ? m[2] : null;
  const items = body.split("、").map((s) => s.trim()).filter(Boolean);
  const p = parseNote(note);
  const noteRows = NOTE_FIELDS.filter((f) => p[f.key]);
  const expandable = items.length > 1 || noteRows.length > 0;

  if (!expandable) return <span>{itemName}</span>;
  return (
    <div className="min-w-[10rem]">
      <button
        type="button"
        className="text-left inline-flex items-start gap-1 hover:text-brand-700"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-slate-400 text-xs mt-0.5 w-3 shrink-0" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span>
          {items[0]}
          {items.length > 1 && <span className="text-xs text-slate-400 ml-1">等 {items.length} 項</span>}
          {suffix && <span className="text-xs text-slate-400 ml-1">（{suffix}）</span>}
        </span>
      </button>
      {open && (
        <div className="pl-4 mt-1 space-y-0.5 whitespace-normal max-w-xs">
          {items.length > 1 && (
            <ul className="text-sm text-slate-700 list-disc pl-4">
              {items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          )}
          {noteRows.map((f) => (
            <div key={f.key} className="text-xs text-slate-500">
              <span className="text-slate-400">{f.label}</span> {p[f.key]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
