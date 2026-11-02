import { useState } from "react";
import { NOTE_FIELDS, parseNote } from "../../../server/noteFormat";

/** 字寬：中日韓全形字算 2，其他算 1 */
function widthOf(s: string) {
  let w = 0;
  for (const ch of s) w += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 2 : 1;
  return w;
}

/** 收合時第一項最多這麼寬（跟「科學班物理衝刺班 2026-27」一樣），超過的後面變成… */
const MAX_WIDTH = widthOf("科學班物理衝刺班 2026-27");

function clip(s: string) {
  if (widthOf(s) <= MAX_WIDTH) return s;
  let out = "";
  for (const ch of s) {
    if (widthOf(out + ch) > MAX_WIDTH - 1) break;
    out += ch;
  }
  return out.trimEnd() + "…";
}

/**
 * 帳本「項目」欄：合併記帳的項目名稱是「A、B、C」一長串，加上備註會把表格撐得很寬。
 * 預設收合：只顯示第一項（去掉括號附註，太長的截成…）＋「等 N 項」；點一下往下展開成直的清單，連同備註一行一行列出來。
 * 買家另外有自己一欄，備註展開時就不再列買家。
 */
export default function ItemCell({ itemName, note }: { itemName: string; note?: string | null }) {
  const [open, setOpen] = useState(false);
  const items = itemName
    .split("、")
    .map((s) => s.trim())
    .filter(Boolean);
  const p = parseNote(note);
  const noteRows = NOTE_FIELDS.filter((f) => f.key !== "buyer" && p[f.key]);
  // 第一項去掉結尾的括號附註（例如「（2026 8月-2027 3月）」「（小班家教分潤）」）
  const first = (items[0] ?? itemName).replace(/\s*（[^（）]*）\s*$/, "") || items[0] || itemName;
  const shown = clip(first);
  const expandable = items.length > 1 || noteRows.length > 0 || shown !== items[0];

  if (!expandable) return <span>{itemName}</span>;
  return (
    <div>
      <button
        type="button"
        className="text-left inline-flex items-start gap-1 hover:text-brand-700"
        aria-expanded={open}
        title={open ? undefined : itemName}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-slate-400 text-xs mt-0.5 w-3 shrink-0" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span>
          {shown}
          {items.length > 1 && <span className="text-xs text-slate-400 ml-1">等 {items.length} 項</span>}
        </span>
      </button>
      {open && (
        <div className="pl-4 mt-1 space-y-0.5 whitespace-normal max-w-xs">
          <ul className={`text-sm text-slate-700 ${items.length > 1 ? "list-disc pl-4" : ""}`}>
            {items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
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
