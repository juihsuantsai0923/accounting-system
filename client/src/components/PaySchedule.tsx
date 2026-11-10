import { trpc } from "../lib/trpc";

function fmt(n: number) {
  return n < 0 ? `−NT$${Math.abs(n).toLocaleString()}` : `NT$${n.toLocaleString()}`;
}

/** 2026-12-15 → 12/15（跨年加年份） */
export function paydayLabel(pd: string, withYear = false) {
  const [y, m, d] = pd.split("-").map(Number);
  return withYear ? `${y}/${m}/${d}` : `${m}/${d}`;
}

/**
 * 發薪：每月 15 日發「截至上個月底已到期 − 已發放」。
 * 管理員看任何人（傳 kind/id）；老師、推銷者、出貨員本人只拿得到自己的（後端會換成本人）。
 */
export default function PaySchedule({ kind, id }: { kind?: "teacher" | "salesperson"; id?: number }) {
  const q = trpc.payroll.person.useQuery(kind && id ? { recipientType: kind, recipientId: id } : {}, { retry: false });
  const s = q.data;
  if (q.error) return <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{q.error.message}</div>;
  if (!s) return null;
  const upcoming = s.paydays.filter((p) => p.payday > s.next.payday && p.due > 0);
  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${s.next.prepaid > 0 ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-4`}>
        <div className="card border-l-4 border-gold-500">
          <div className="text-sm text-slate-500">下次發薪 {paydayLabel(s.next.payday, true)} 可發</div>
          <div className="text-2xl font-semibold mt-1 text-brand-700">{fmt(s.next.payable)}</div>
          <div className="text-xs text-slate-400 mt-1">{s.next.payday.endsWith("-12-31") ? "截至 12 月底" : "截至上個月底"}已到期、還沒發的</div>
        </div>
        {s.next.prepaid > 0 && (
          <div className="card">
            <div className="text-sm text-slate-500">已預付</div>
            <div className="text-2xl font-semibold mt-1 text-emerald-700">{fmt(s.next.prepaid)}</div>
            <div className="text-xs text-slate-400 mt-1">已經先發、還沒到期的部分，之後到期就不用再發</div>
          </div>
        )}
        <div className="card">
          <div className="text-sm text-slate-500">尚未到期</div>
          <div className="text-2xl font-semibold mt-1 text-slate-700">{fmt(s.next.notYetDue)}</div>
          <div className="text-xs text-slate-400 mt-1">還沒上的課、家長還沒繳的學費、這個月才入帳的，到期後下一次發薪發</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">公司目前欠款</div>
          <div className="text-2xl font-semibold mt-1 text-amber-600">{fmt(Math.max(0, s.balance))}</div>
          <div className="text-xs text-slate-400 mt-1">＝可發 ＋ 尚未到期</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="text-sm text-slate-500 mb-2">之後每次發薪（依目前的帳預估）</div>
          {upcoming.length ? (
            <table className="w-full text-sm">
              <tbody>
                {upcoming.map((p) => (
                  <tr key={p.payday} className="border-t border-slate-100">
                    <td className="py-1.5">{paydayLabel(p.payday, true)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(p.due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-slate-400">之後沒有新到期的金額</div>
          )}
        </div>
        <div className="card">
          <div className="text-sm text-slate-500 mb-2">發薪紀錄</div>
          {s.payouts.length ? (
            <table className="w-full text-sm">
              <tbody>
                {[...s.payouts].reverse().map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-1.5">{new Date(p.at).toLocaleDateString()}</td>
                    <td className="py-1.5 text-slate-500">{paydayLabel(p.payday)} 那次</td>
                    <td className="py-1.5 text-right tabular-nums text-emerald-700">{fmt(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-slate-400">還沒發放過</div>
          )}
        </div>
      </div>
    </div>
  );
}
