import { NOTE_FIELDS, parseNote, type NoteKey, type NoteParts } from "../../../server/noteFormat";

const PLACEHOLDER: Record<NoteKey, string> = {
  buyer: "付錢的人，例如 張崇瑋",
  order: "例如 LX-20261027-004",
  coupon: "例如 LEVIAX001",
  memo: "其他要記的事",
};

/**
 * 備註分欄填寫：買家、官網訂單、優惠碼、說明各一格，送出時組成統一格式。
 * fields 決定這張表單要顯示哪幾格（例如支出只要「說明」）。
 */
export default function NoteFields({
  value,
  onChange,
  fields,
}: {
  value: NoteParts;
  onChange: (v: NoteParts) => void;
  fields: NoteKey[];
}) {
  return (
    <div className={`grid grid-cols-1 gap-4 ${fields.length === 4 ? "sm:grid-cols-2" : fields.length > 1 ? "sm:grid-cols-3" : ""}`}>
      {NOTE_FIELDS.filter((f) => fields.includes(f.key)).map((f) => (
        <div key={f.key}>
          <label className="label">{f.label}（選填）</label>
          <input
            className="input"
            value={value[f.key] ?? ""}
            placeholder={PLACEHOLDER[f.key]}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

/** 列表裡顯示備註：每欄加上灰色標籤，一眼看出寫的是什麼 */
export function NoteView({ note }: { note: string | null | undefined }) {
  const p = parseNote(note);
  const shown = NOTE_FIELDS.filter((f) => p[f.key]);
  if (!shown.length) return null;
  return (
    <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
      {shown.map((f) => (
        <span key={f.key}>
          <span className="text-slate-400">{f.label}</span> {p[f.key]}
        </span>
      ))}
    </div>
  );
}
