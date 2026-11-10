import type { DistItem } from "./revenueCalc";

/** 一筆收入裡的一個項目（多門課、多本書合成一筆記錄時，用來保留每一項的來源與金額給報表用） */
export interface IncomePart {
  source: "course" | "tutoring" | "book";
  name: string;
  categoryId: number;
  categoryName: string;
  amount: number;
  distributions: DistItem[];
  /** 寫進個人子記帳表的項目名稱前綴，例如課程名稱 */
  personalLabel: string;
  /** 這一項先扣下來放稅金準備的營業稅（登記日以前是 0） */
  tax?: number;
}

/**
 * 把好幾個項目合成「一筆」母記帳表收入：金額加總、分潤全部帶上（各自寫進對應的人的子記帳表），
 * 剩下的留給公積金。只有一個項目時就跟原本單筆入帳一模一樣（不存明細）。
 */
export function combineIncome(parts: IncomePart[]) {
  const sources = [...new Set(parts.map((p) => p.source))];
  const single = parts.length === 1 ? parts[0] : null;
  const categoryName = single
    ? single.categoryName
    : sources.length === 1
      ? sources[0] === "tutoring"
        ? "小班家教"
        : sources[0] === "book"
          ? "書籍"
          : parts.every((p) => p.categoryName === parts[0].categoryName)
            ? parts[0].categoryName
            : "線上課程"
      : "多項收入";
  const distributions: DistItem[] = parts.flatMap((p) =>
    p.distributions.map((d) => ({ ...d, baseAmount: p.amount, itemNameSuffix: `${p.personalLabel}（${d.itemNameSuffix}）` }))
  );
  return {
    itemName: parts.map((p) => p.name).join("、"),
    categoryId: parts[0].categoryId,
    categoryName,
    amount: parts.reduce((s, p) => s + p.amount, 0),
    incomeSource: sources.length === 1 ? sources[0] : "mixed",
    distributions,
    breakdown: parts.length > 1 ? JSON.stringify(parts.map(({ source, name, categoryId, amount }) => ({ source, name, categoryId, amount }))) : null,
    taxAmount: parts.reduce((s, p) => s + (p.tax ?? 0), 0),
    reserve: parts.reduce((s, p) => s + p.amount - (p.tax ?? 0), 0) - distributions.reduce((s, d) => s + d.amount, 0),
  };
}
