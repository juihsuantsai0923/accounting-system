import { useState } from "react";
import { trpc } from "../lib/trpc";

function fmt(n: number) {
  return n < 0 ? `−NT$${Math.abs(n).toLocaleString()}` : `NT$${n.toLocaleString()}`;
}

const KIND_LABEL: Record<string, string> = { tutoring: "小班家教", course: "線上課程", book: "書籍", skip: "不入帳", unknown: "對不到" };

type Override = { orderNo: string; idx: number; kind: "tutoring" | "book" | "skip"; id?: number };

/**
 * 官網訂單「確認入帳（已收到錢）」的預覽視窗：
 * 列出每張訂單拆成哪幾筆、公積金與每位老師各拿多少；對不到的品項可以手動選對應的課程或書。
 */
export default function RecordOrdersDialog({ orderNos, onClose, onDone }: { orderNos: string[]; onClose: () => void; onDone: (msg: string) => void }) {
  const utils = trpc.useUtils();
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [orderCoupons, setOrderCoupons] = useState<{ orderNo: string; couponId: number }[]>([]);
  const [received, setReceived] = useState<Record<string, string>>({});
  const partials = Object.entries(received)
    .filter(([, v]) => parseInt(v || "0", 10) > 0)
    .map(([orderNo, v]) => ({ orderNo, received: parseInt(v, 10) }));
  const preview = trpc.webOrders.previewRecord.useQuery({ orderNos, overrides, coupons: orderCoupons, partials });
  const couponsQuery = trpc.coupons.list.useQuery();
  const teachers = trpc.teachers.list.useQuery();
  const salespeople = trpc.salespeople.list.useQuery();
  const booksQuery = trpc.books.list.useQuery();
  const coursesQuery = trpc.courses.list.useQuery();
  const record = trpc.webOrders.recordOrders.useMutation({
    onSuccess: () => {
      utils.webOrders.reconcile.invalidate();
      utils.mainLedger.list.invalidate();
      utils.mainLedger.unpaidList.invalidate();
      utils.teacherLedger.invalidate();
      utils.salespersonLedger.invalidate();
      utils.reports.invalidate();
    },
  });

  const plans = preview.data ?? [];
  const hasError = plans.some((p: any) => p.errors.length);
  const grand = plans.reduce((s: number, p: any) => s + p.recordedTotal, 0);
  const grandReserve = plans.reduce((s: number, p: any) => s + (p.combined?.reserve ?? 0), 0);

  function nameOf(type: string, id: number) {
    const list = type === "teacher" ? teachers.data : salespeople.data;
    return list?.find((x: any) => x.id === id)?.name ?? `#${id}`;
  }

  function setOverride(orderNo: string, idx: number, value: string) {
    setOverrides((prev) => {
      const rest = prev.filter((o) => !(o.orderNo === orderNo && o.idx === idx));
      if (!value) return rest;
      const [kind, id] = value.split(":");
      return [...rest, { orderNo, idx, kind: kind as Override["kind"], id: id ? Number(id) : undefined }];
    });
  }

  function setOrderCoupon(orderNo: string, value: string) {
    setOrderCoupons((prev) => {
      const rest = prev.filter((c) => c.orderNo !== orderNo);
      return value ? [...rest, { orderNo, couponId: Number(value) }] : rest;
    });
  }

  const influencerCoupons = (couponsQuery.data ?? []).filter((c: any) => c.isActive && c.salespersonId);
  const tutoringCourses = (coursesQuery.data ?? []).filter((c: any) => c.category === "tutoring");
  const activeBooks = (booksQuery.data ?? []).filter((b: any) => b.isActive);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">確認入帳（已收到錢）</h2>
            <p className="text-xs text-slate-500 mt-1">
              每張訂單記成帳本一筆，裡面每個品項各自照規則分：小班家教、線上課程分給老師，書籍依科目分給老師（行事曆留公積金）。官網優惠碼折扣只算在線上課程與書籍（小班家教不折），運費算進書籍。
            </p>
          </div>
          <button className="text-slate-400 hover:text-slate-600 text-xl leading-none" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        {preview.isLoading && <div className="text-sm text-slate-500">計算中...</div>}
        {preview.error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{preview.error.message}</div>}

        {plans.map((p: any) => (
          <div key={p.orderNo} className="border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <span className="font-medium">{p.buyer}</span>
                <span className="ml-2 text-xs text-slate-400 font-mono">{p.orderNo}</span>
              </div>
              <div className="text-sm text-slate-600">
                官網實付 {fmt(p.total)}
                {p.discount > 0 && <span className="text-slate-400">（折扣 {fmt(p.discount)}）</span>}
                {p.shipping > 0 && <span className="text-slate-400">（運費 {fmt(p.shipping)}）</span>}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="text-slate-600">部分入帳：這次收到</label>
              <input
                className="input !w-32"
                inputMode="numeric"
                placeholder="全額"
                value={received[p.orderNo] ?? ""}
                onChange={(e) => setReceived((prev) => ({ ...prev, [p.orderNo]: e.target.value.replace(/[^\d]/g, "") }))}
              />
              {p.unpaidAmount > 0 && <span className="text-xs text-amber-700">還沒繳 {fmt(p.unpaidAmount)}，分潤照整張訂單算，公積金暫時吸收</span>}
            </div>

            {p.influencerEligible && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="text-slate-600">用了哪組網紅碼</label>
                <select className="input !w-48" value={p.couponId ?? ""} onChange={(e) => setOrderCoupon(p.orderNo, e.target.value)}>
                  <option value="">沒有用網紅碼</option>
                  {influencerCoupons.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-400">線上課程、書籍改照售價分，網紅佣金 5%</span>
              </div>
            )}

            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>官網品項</th>
                  <th>定價</th>
                  <th>記帳對應</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l: any) => {
                  const ov = overrides.find((o) => o.orderNo === p.orderNo && o.idx === l.idx);
                  const editable = l.kind === "unknown" || ov;
                  return (
                    <tr key={l.idx}>
                      <td className="text-sm">{l.name}</td>
                      <td className="whitespace-nowrap text-sm">{fmt(l.price)}</td>
                      <td className="text-sm">
                        {editable ? (
                          <select
                            className={`input ${l.kind === "unknown" ? "border-red-300" : ""}`}
                            value={ov ? `${ov.kind}${ov.id ? `:${ov.id}` : ""}` : ""}
                            onChange={(e) => setOverride(p.orderNo, l.idx, e.target.value)}
                          >
                            <option value="">{ov ? "↺ 還原自動對應" : "⚠ 請選對應項目"}</option>
                            <option value="skip">不入帳（例如贈品）</option>
                            <optgroup label="小班家教">
                              {tutoringCourses.map((c: any) => (
                                <option key={c.id} value={`tutoring:${c.id}`}>
                                  {c.name}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="書籍">
                              {activeBooks.map((b: any) => (
                                <option key={b.id} value={`book:${b.id}`}>
                                  {b.name}（{fmt(b.price)}）
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        ) : (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{KIND_LABEL[l.kind]}</span>
                            {l.targetName}
                            {l.kind === "course" && l.years && <span className="text-xs text-slate-400">{l.years} 年方案</span>}
                            <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setOverride(p.orderNo, l.idx, "skip")}>
                              改
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {p.combined && (
              <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
                <div className="text-xs text-slate-500">
                  帳本寫一筆 <b className="text-slate-700">{fmt(p.combined.amount)}</b>（{p.combined.categoryName}），其中：
                </div>
                {p.parts.map((e: any, i: number) => (
                  <div key={i} className="flex flex-wrap justify-between gap-2">
                    <span>
                      <span className="text-slate-400 mr-1">{KIND_LABEL[e.kind]}</span>
                      {e.itemName}
                    </span>
                    <span className="text-slate-600">
                      {fmt(e.amount)}
                      <span className="text-xs text-slate-400 ml-2">
                        公積金 {fmt(e.reserve)}
                        {e.distributions
                          .filter((d: any) => d.amount > 0)
                          .map((d: any) => `、${nameOf(d.type, d.recipientId)} ${fmt(d.amount)}`)
                          .join("")}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {p.errors.map((err: string) => (
              <div key={err} className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                ✕ {err}
              </div>
            ))}
          </div>
        ))}

        {record.error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{record.error.message}</div>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="text-sm text-slate-700">
            {plans.length} 張訂單，共入帳 <b>{fmt(grand)}</b>
            <span className="text-slate-400">（其中公積金 {fmt(grandReserve)}）</span>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>
              取消
            </button>
            <button
              className="btn-primary"
              disabled={!plans.length || hasError || record.isPending || preview.isFetching}
              onClick={async () => {
                const r = await record.mutateAsync({ orderNos, overrides, coupons: orderCoupons, partials });
                onDone(`已入帳 ${r.orders} 張訂單（每張一筆記錄），共 ${fmt(r.total)}。`);
              }}
            >
              {record.isPending ? "入帳中..." : "確認入帳"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
