import { trpc } from "../lib/trpc";

function fmt(n: number) {
  return n < 0 ? `−NT$${Math.abs(n).toLocaleString()}` : `NT$${n.toLocaleString()}`;
}

/** 2026-11-30 → 2026 年 11 月 30 日（週一） */
export function fullDate(pd: string) {
  const [y, m, d] = pd.split("-").map(Number);
  const w = "日一二三四五六"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y} 年 ${m} 月 ${d} 日（週${w}）`;
}

/** 2026-12-31 → 12/31（withYear 加年份） */
export function paydayLabel(pd: string, withYear = false) {
  const [y, m, d] = pd.split("-").map(Number);
  return withYear ? `${y}/${m}/${d}` : `${m}/${d}`;
}

/**
 * 發薪：每月月底發「當月底以前已到期 − 已發放」。
 * 管理員看任何人（傳 kind/id）；老師、推銷者、出貨員本人只拿得到自己的（後端會換成本人）。
 */
export default function PaySchedule({ kind, id }: { kind?: "teacher" | "salesperson"; id?: number }) {
  const q = trpc.payroll.person.useQuery(kind && id ? { recipientType: kind, recipientId: id } : {}, { retry: false });
  const s = q.data;
  if (q.error) return <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{q.error.message}</div>;
  if (!s) return null;
  const upcoming = s.paydays.filter((p) => p.payday > s.next.payday && p.plan > 0);
  const laterDay = upcoming[0]?.payday;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-brand-700 text-white px-6 py-5 shadow-card">
        <div className="text-sm text-white/70 tracking-widest">下次發放</div>
        <div className="mt-2 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="text-xs text-white/60">發放日</div>
            <div className="text-2xl sm:text-3xl font-semibold">{fullDate(s.next.payday)}</div>
          </div>
          <div className="sm:text-right">
            <div className="text-xs text-white/60">預計發放金額</div>
            <div className="text-3xl sm:text-4xl font-semibold text-gold-400">{fmt(s.next.payable)}</div>
          </div>
        </div>
        <div className="mt-3 text-xs text-white/60">
          每月最後一天發薪，發的是到那天為止已到期、還沒發的金額。
          {s.next.later > 0 && (
            <span className="text-white/90">　這一屆的分潤分期發，其餘 {fmt(s.next.later)} 在之後的月底發{laterDay ? `（下一期 ${paydayLabel(laterDay, true)}）` : ""}。</span>
          )}
          {s.next.prepaid > 0 && <span className="text-white/90">　已預付 {fmt(s.next.prepaid)}（先發了還沒到期的，之後到期就不再發）。</span>}
          {s.next.notYetDue > 0 && <span>　尚未到期 {fmt(s.next.notYetDue)}（還沒上的課、家長還沒繳的學費），到期後的月底發。</span>}
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
                    <td className="py-1.5 text-right tabular-nums">{fmt(p.plan)}</td>
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
