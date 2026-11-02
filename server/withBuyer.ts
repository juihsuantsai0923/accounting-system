import { inArray } from "drizzle-orm";
import { mainLedger } from "./schema";
import { parseNote } from "./noteFormat";

/** 子記帳表每一筆補上「買家」：從對應帳本記錄的備註拿（只給姓名，不給備註其他內容） */
export async function withBuyer<T extends { mainLedgerId: number | null }>(db: any, rows: T[]): Promise<(T & { buyer: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.mainLedgerId).filter((x): x is number => x != null))];
  const notes = new Map<number, string | null>();
  for (let i = 0; i < ids.length; i += 90) {
    const part = await db.select({ id: mainLedger.id, note: mainLedger.note }).from(mainLedger).where(inArray(mainLedger.id, ids.slice(i, i + 90)));
    for (const r of part) notes.set(r.id, r.note);
  }
  return rows.map((r) => ({ ...r, buyer: r.mainLedgerId != null ? parseNote(notes.get(r.mainLedgerId)).buyer ?? null : null }));
}
