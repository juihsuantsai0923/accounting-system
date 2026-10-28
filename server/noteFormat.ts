/**
 * 母記帳表備註的統一格式：固定欄位依序用「｜」隔開，每欄「標籤：內容」，例如
 *   買家：張崇瑋｜官網訂單：LX-20261027-004｜說明：書籍含運費 60 元
 * 沒填的欄位就不出現。前後端共用（前端表單組字串、列表拆開顯示；後端入帳時補優惠碼等資訊）。
 * 對帳靠「買家」比對姓名、靠「官網訂單」避免重複入帳。
 */
export const NOTE_FIELDS = [
  { key: "buyer", label: "買家" },
  { key: "order", label: "官網訂單" },
  { key: "coupon", label: "優惠碼" },
  { key: "memo", label: "說明" },
] as const;

export type NoteKey = (typeof NOTE_FIELDS)[number]["key"];
export type NoteParts = Partial<Record<NoteKey, string>>;

export function formatNote(parts: NoteParts): string | undefined {
  const out = NOTE_FIELDS.map(({ key, label }) => {
    const v = parts[key]?.replace(/｜/g, "/").trim();
    return v ? `${label}：${v}` : null;
  }).filter(Boolean);
  return out.length ? out.join("｜") : undefined;
}

/** 拆回各欄位；不是這個格式的舊文字一律當「說明」 */
export function parseNote(note: string | null | undefined): NoteParts {
  const parts: NoteParts = {};
  if (!note) return parts;
  const extra: string[] = [];
  for (const seg of note.split("｜")) {
    const s = seg.trim();
    if (!s) continue;
    const f = NOTE_FIELDS.find(({ label }) => s.startsWith(`${label}：`));
    if (f && !parts[f.key]) parts[f.key] = s.slice(f.label.length + 1).trim();
    else extra.push(s);
  }
  if (extra.length) parts.memo = [parts.memo, ...extra].filter(Boolean).join("；");
  return parts;
}

/** 在既有備註上補欄位（說明用「；」接在後面） */
export function mergeNote(note: string | null | undefined, add: NoteParts) {
  const p = parseNote(note);
  for (const { key } of NOTE_FIELDS) {
    const v = add[key]?.trim();
    if (!v) continue;
    p[key] = key === "memo" && p.memo ? `${p.memo}；${v}` : v;
  }
  return formatNote(p);
}
