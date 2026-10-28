import { useState } from "react";
import { trpc } from "../lib/trpc";
import NoteFields from "./NoteFields";
import { formatNote, parseNote, type NoteParts } from "../../../server/noteFormat";

function fmtDateTime(ts: number) {
  return new Date(ts).toLocaleString("zh-TW", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * 編輯母記帳表的一筆記錄：項目名稱、備註各欄都能改；
 * 金額只有沒分給任何人的記錄能改（有分潤的要刪掉重記，子記帳表才不會對不起來）。
 */
export default function EditEntryDialog({ entry, onClose }: { entry: any; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [itemName, setItemName] = useState<string>(entry.itemName);
  const [note, setNote] = useState<NoteParts>(parseNote(entry.note));
  const [amount, setAmount] = useState<string>(String(entry.amount));
  const update = trpc.mainLedger.update.useMutation({
    onSuccess: () => {
      utils.mainLedger.list.invalidate();
      utils.reports.invalidate();
      utils.webOrders.reconcile.invalidate();
      onClose();
    },
  });
  const amountLocked = entry.distributed > 0;
  const fields = entry.type === "income" ? (["buyer", "order", "coupon", "memo"] as const) : (["memo"] as const);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <form
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-12 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({
            id: entry.id,
            itemName,
            note: formatNote(note) ?? "",
            amount: amountLocked ? undefined : parseInt(amount || "0", 10),
          });
        }}
      >
        <div className="flex justify-between items-start gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">編輯記錄</h2>
            <p className="text-xs text-slate-500 mt-1">
              {new Date(entry.createdAt).toLocaleDateString()}・{entry.type === "income" ? "收入" : "支出"}・{entry.categoryName}
              ・最後編輯 {fmtDateTime(entry.editedAt ?? entry.createdAt)}
            </p>
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-600 text-xl leading-none" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="label">項目名稱</label>
            <input className="input" value={itemName} onChange={(e) => setItemName(e.target.value)} required />
          </div>
          <div>
            <label className="label">金額</label>
            <input
              className="input"
              inputMode="numeric"
              value={amount}
              disabled={amountLocked}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            />
            {amountLocked && <p className="text-xs text-slate-400 mt-1">這筆有分給個人，金額不能直接改；要改請刪除後重新入帳。</p>}
          </div>
        </div>

        <NoteFields value={note} onChange={setNote} fields={[...fields]} />

        {update.error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{update.error.message}</div>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn-primary" disabled={update.isPending}>
            {update.isPending ? "儲存中..." : "儲存"}
          </button>
        </div>
      </form>
    </div>
  );
}
