import { useMemo, useState } from "react";
import { trpc } from "../lib/trpc";
import { fmt } from "../components/DashboardCharts";
import type { AEntry } from "../lib/analytics";
import {
  TAX,
  corpIncomeTax,
  monthlySales,
  payeeSummary,
  personalTaxOn,
  taxIncluded,
  withholdingFor,
  yearExpenses,
  yearShares,
} from "../lib/tax";

/**
 * 稅務專區：依目前的營業額與營運模式，列出可能的稅務問題，並做營業稅、所得稅、老師扣繳的粗估。
 * 只是幫忙抓方向，正式做法要問會計師／記帳士或國稅局（免費諮詢 0800-000-321）。
 */

const LEVEL = {
  high: { label: "高", cls: "bg-red-50 text-red-700 ring-red-200" },
  mid: { label: "中", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  low: { label: "低", cls: "bg-slate-50 text-slate-600 ring-slate-200" },
} as const;

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg text-brand-700">{title}</h2>
        {note && <p className="text-xs text-slate-400 mt-1">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function NumInput({ label, value, onChange, suffix, hint }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input className="input" inputMode="decimal" value={String(value)} onChange={(e) => onChange(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} />
        {suffix && <span className="text-sm text-slate-500 shrink-0">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

const Row = ({ label, value, strong, sub }: { label: string; value: string; strong?: boolean; sub?: string }) => (
  <div className={`flex items-baseline justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0 ${strong ? "font-semibold text-brand-700" : ""}`}>
    <span className="text-sm">
      {label}
      {sub && <span className="block text-xs text-slate-400 font-normal">{sub}</span>}
    </span>
    <span className="tabular-nums text-sm shrink-0">{value}</span>
  </div>
);

export default function TaxPage() {
  const ledger = trpc.mainLedger.list.useQuery();
  const courses = trpc.courses.list.useQuery();
  const teachers = trpc.teachers.list.useQuery();
  const salespeople = trpc.salespeople.list.useQuery();
  const personStats = trpc.reports.personStats.useQuery();
  const courseNames = useMemo(() => new Set((courses.data ?? []).map((c) => c.name)), [courses.data]);
  const entries = (ledger.data ?? []) as AEntry[];
  const thisYear = String(new Date().getFullYear());
  const years = useMemo(() => [...new Set([thisYear, ...entries.map((e) => String(new Date(e.createdAt).getFullYear()))])].sort().reverse(), [entries, thisYear]);
  const [year, setYear] = useState(thisYear);

  const months = useMemo(() => monthlySales(entries, year, courseNames), [entries, year, courseNames]);
  const actual = months.reduce((s, m) => s + m.total, 0);
  const actualService = months.reduce((s, m) => s + m.service, 0);
  const actualGoods = months.reduce((s, m) => s + m.goods, 0);
  const actualExpenses = yearExpenses(entries, year);
  const actualShares = yearShares(entries, year);

  // 試算條件（預設＝這一年到今天的實際數字，可以改成整年預估）
  const [override, setOverride] = useState<{ revenue?: number; shares?: number; expenses?: number }>({});
  const revenue = override.revenue ?? actual;
  const shares = override.shares ?? actualShares;
  const expenses = override.expenses ?? actualExpenses;
  const goodsRatio = actual ? actualGoods / actual : 0;
  const goods = Math.round(revenue * goodsRatio);
  const service = revenue - goods;
  const tutoringRatio = useMemo(() => {
    let t = 0;
    for (const e of entries) {
      if (e.type !== "income" || !String(new Date(e.createdAt).getFullYear()).startsWith(year)) continue;
      if (e.incomeSource === "tutoring") t += e.amount;
      else if (e.breakdown) for (const p of JSON.parse(e.breakdown)) if (p.source === "tutoring") t += p.amount;
    }
    return actual ? t / actual : 0;
  }, [entries, year, actual]);
  const tutoring = Math.round(revenue * tutoringRatio);
  const [invoiceRatio, setInvoiceRatio] = useState(50);
  const [partners, setPartners] = useState(4);
  const [profitRate, setProfitRate] = useState(6);
  const [payKind, setPayKind] = useState<"professional" | "salary">("professional");
  const [expenseRate, setExpenseRate] = useState(0);

  const overThresholdMonths = months.filter((m) => m.overThreshold);
  const overSmallMonths = months.filter((m) => m.overSmallScale);
  const profit = revenue - shares - expenses;

  // ── 營業稅四種情境 ──
  const inputVat = taxIncluded(Math.round(expenses * (invoiceRatio / 100)));
  const vat = {
    unregistered: taxIncluded(revenue),
    smallScale: Math.round(revenue * TAX.smallScaleRate),
    invoice: Math.max(0, taxIncluded(revenue) - inputVat),
    licensed: Math.max(0, taxIncluded(revenue - tutoring) - inputVat),
  };

  // ── 所得稅 ──
  const corpTax = corpIncomeTax(Math.max(0, profit - vat.invoice));
  const perPartner = Math.round(Math.max(0, profit - vat.invoice) / Math.max(1, partners));
  const partnerTax = personalTaxOn(perPartner, "business");
  const smallScaleIncome = Math.round(revenue * (profitRate / 100));
  const smallPerPartner = Math.round(smallScaleIncome / Math.max(1, partners));
  const smallPartnerTax = personalTaxOn(smallPerPartner, "business");

  // ── 老師扣繳 ──
  const names = new Map<string, string>([
    ...(teachers.data ?? []).map((t: any) => [`t${t.id}`, t.name] as [string, string]),
    ...(salespeople.data ?? []).map((s: any) => [`s${s.id}`, s.name] as [string, string]),
  ]);
  // 有實際撥款就用撥款；還沒撥款的，假設每個月的分潤當月撥一次，先估扣繳金額
  const actualPayouts = new Map(payeeSummary(entries, year, names).map((p) => [p.key, p.payouts]));
  const payees = (personStats.data ?? [])
    .map((s: any) => {
      const key = `${s.recipientType === "teacher" ? "t" : "s"}${s.recipientId}`;
      const monthly = Object.entries(s.monthly as Record<string, { earned: number; paid: number }>).filter(([m]) => m.startsWith(year));
      const earned = monthly.reduce((t, [, v]) => t + v.earned, 0);
      const paidList = actualPayouts.get(key) ?? [];
      const basis = paidList.length ? paidList : monthly.map(([, v]) => v.earned).filter((v) => v > 0);
      return {
        key,
        name: s.name as string,
        earned,
        paid: paidList.reduce((t, x) => t + x, 0),
        paidCount: paidList.length,
        estimated: !paidList.length,
        ...withholdingFor(basis, payKind),
        personal: personalTaxOn(earned, payKind, expenseRate / 100),
      };
    })
    .filter((p) => p.earned > 0 || p.paid > 0);

  if (ledger.isLoading) return <div className="p-8 text-center text-slate-400">載入中…</div>;
  if (ledger.error) return <div className="p-8 text-center text-red-600">{ledger.error.message}</div>;

  const kept = revenue - shares - expenses;
  const issues: { level: keyof typeof LEVEL; title: string; body: React.ReactNode; todo: string }[] = [
    {
      level: kept > 0 && vat.invoice >= kept * 0.5 ? "high" : "mid",
      title: "營業稅會吃掉公司的留存",
      body: (
        <>
          現在的分潤是用「實收金額」（含稅）去分：{year} 年營業額 {fmt(revenue)} 中，分給老師／推銷者 {fmt(shares)}（{revenue ? Math.round((shares / revenue) * 100) : 0}%），
          扣掉公帳支出後公司只留 <b>{fmt(kept)}</b>。開發票後的 5% 營業稅約 <b>{fmt(vat.invoice)}</b> 全部由公司負擔，
          {kept > 0 ? <>相當於留存的 <b>{Math.round((vat.invoice / kept) * 100)}%</b>。</> : <>已經超過公司留存。</>}
        </>
      ),
      todo: "辦登記前先決定：分潤改用未稅金額（實收 ÷ 1.05）計算、或調整定價；改分潤規則時，帳本「分潤參數」可以一起調。",
    },
    {
      level: overThresholdMonths.length ? "high" : "mid",
      title: "營業稅稅籍登記",
      body: (
        <>
          每月銷售勞務達 5 萬、或銷售貨物達 10 萬（兩種都有時：勞務÷5 萬＋貨物÷10 萬 ≥ 1）就要辦稅籍登記並繳營業稅；網路銷售也一樣，網頁上要揭露營業人名稱與統一編號。
          {year} 年已有 <b>{overThresholdMonths.length}</b> 個月達到起徵點（{overThresholdMonths.map((m) => m.month).join("、") || "無"}）。
          沒登記被查到：除了補稅，還可能處 3,000～30,000 元罰鍰，漏稅部分另依漏稅額處罰（實務常見 0.5～1 倍，法定最高 5 倍）。
        </>
      ),
      todo: "還沒辦稅籍登記的話，盡快向國稅局辦理（公司、行號或稅籍登記擇一），並確認要不要用統一發票。",
    },
    {
      level: overSmallMonths.length ? "high" : "low",
      title: "能不能用小規模營業人（1%）",
      body: (
        <>
          小規模營業人是每月銷售額未達 20 萬，由國稅局按季查定、稅率 1%、免開統一發票。
          {year} 年有 <b>{overSmallMonths.length}</b> 個月超過 20 萬（{overSmallMonths.map((m) => `${m.month} ${fmt(m.total)}`).join("、") || "無"}），
          小班衝刺班開課前一次收整年學費，旺季一個月就會超過，很可能被要求使用統一發票、按 5% 申報。
        </>
      ),
      todo: "跟會計師討論以「整年平均」還是「旺季」認定；若會超過，就直接規劃 5%（開發票）的價格與流程。",
    },
    {
      level: "high",
      title: "小班衝刺班要不要立案（短期補習班）",
      body: (
        <>
          補習及進修教育法：未立案以補習班或類似名義招生，負責人可處 5～25 萬元罰鍰並命停辦。短期補習班的定義是「固定場址、對外招生 5 人以上並收費」；
          你們用 Google Meet 上課，純線上是否算補習班，目前沒有找到主管機關的明確函釋，見解不一。另外，依法立案的補習班收的補習費免營業稅，但「公司」經營的補習班自 107 年起要課稅。
        </>
      ),
      todo: "以書面向所在縣市教育局函詢「純線上小班課程是否需立案」，保留回函。",
    },
    {
      level: "mid",
      title: "整年學費一次預收",
      body: (
        <>
          營業稅：收到錢就要開發票、算進當期銷售額（不是上完課才算）。所得稅：公司採權責制時，預收的學費要按上課期間分攤成收入，
          年底還沒上的部分是「預收收入」（負債），不是當年的獲利。
          帳本已經有每門衝刺班的上課期間，儀表板的「小班家教預收」就是這個金額。
        </>
      ),
      todo: "年底結帳時把預收學費攤提表給會計師；有退費時，發票要開折讓單。",
    },
    {
      level: "mid",
      title: "老師分潤的所得類別、扣繳與二代健保",
      body: (
        <>
          公司付給老師的分潤，要判斷是「執行業務所得（9A／9B）」還是「薪資所得（50）」：有僱傭關係算薪資，沒有的通常算執行業務或講演鐘點費。
          執行業務單次給付 ≥ 20,010 元要先扣 10% 所得稅，≥ 2 萬元要扣 2.11% 二代健保補充保費；兼職薪資單次 ≥ 基本工資 29,500 元扣補充保費，≥ 90,501 元扣 5% 所得稅。
          每年 1 月底前要申報並寄扣繳憑單給老師。
        </>
      ),
      todo: "和老師簽合作（承攬）契約、確定所得類別；撥款時照下方試算預扣，並記錄每次撥款日期與金額。",
    },
    {
      level: "low",
      title: "書籍的營業稅",
      body: (
        <>
          書籍屬於「貨物」，一般要課 5% 營業稅。依《文化藝術事業減免營業稅及娛樂稅辦法》，完成公司或商業登記的出版事業，
          有 ISBN（電子書 EISBN）的圖書可以向文化部申請免徵營業稅（110 年 3 月起實施，為期 5 年，可延長一次，要確認目前是否延長）。
        </>
      ),
      todo: "自編講義、刷題本申請 ISBN；登記後評估向文化部申請圖書免營業稅。",
    },
    {
      level: "low",
      title: "創始基金是借款",
      body: <>創始基金是要還給出資人的借款，不是營業收入，也不用繳營業稅；帳本已經把它排除在營業額外。</>,
      todo: "留借據或出資協議，載明金額、還款方式。",
    },
    {
      level: "mid",
      title: "收款帳戶與憑證",
      body: (
        <>國稅局會從金流查核網路銷售。用個人帳戶收學費、書款，所得會被認定是帳戶主人的；支出沒有發票或收據，就不能當費用、也不能扣進項稅額。</>
      ),
      todo: "辦好登記後改用公司（行號）帳戶收款；所有支出留發票（打統編）或收據，記帳時附上照片。",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl text-brand-700">稅務專區</h1>
        <select className="input !w-32" value={year} onChange={(e) => setYear(e.target.value)}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-sm text-amber-800">
        這裡是依帳本數字和公開資料做的<b>粗估與提醒</b>，不是正式的稅務意見。稅率與門檻是 115 年（2026 年）的規定；實際怎麼登記、怎麼申報，請以國稅局（免費諮詢 0800-000-321）和會計師、記帳士的意見為準。
      </div>

      {/* ── 營業概況 ── */}
      <Card title={`${year} 年營業概況`} note="營業額不含創始基金。勞務＝小班家教、線上課程、其他收入；貨物＝書籍、行事曆。">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "營業額", value: actual },
            { label: "勞務", value: actualService },
            { label: "貨物（書籍）", value: actualGoods },
            { label: "老師分潤", value: actualShares },
          ].map((k) => (
            <div key={k.label} className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">{k.label}</div>
              <div className="text-lg font-semibold text-slate-800 mt-0.5">{fmt(k.value)}</div>
            </div>
          ))}
        </div>
        <div className="table-wrap">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th>月份</th>
                <th className="text-right">勞務</th>
                <th className="text-right">貨物</th>
                <th className="text-right">合計</th>
                <th>起徵點（勞務 5 萬／貨物 10 萬）</th>
                <th>小規模（20 萬）</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td className="text-right tabular-nums">{fmt(m.service)}</td>
                  <td className="text-right tabular-nums">{fmt(m.goods)}</td>
                  <td className="text-right tabular-nums font-medium">{fmt(m.total)}</td>
                  <td>{m.overThreshold ? <span className="text-red-600">已達，要辦稅籍</span> : <span className="text-slate-400">未達</span>}</td>
                  <td>{m.overSmallScale ? <span className="text-red-600">超過</span> : <span className="text-slate-400">未超過</span>}</td>
                </tr>
              ))}
              {!months.length && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-400 py-6">
                    這一年還沒有營業額
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── 可能的稅務問題 ── */}
      <Card title="可能的稅務問題" note="依目前的營運模式：官網賣線上課程與書籍、Google Meet 小班衝刺班一次收整年學費、老師按分潤領錢、創始基金借款。">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {issues.map((it) => (
            <div key={it.title} className="rounded-xl ring-1 ring-slate-200 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs rounded-full px-2 py-0.5 ring-1 ${LEVEL[it.level].cls}`}>風險 {LEVEL[it.level].label}</span>
                <h3 className="font-medium text-brand-700">{it.title}</h3>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">{it.body}</p>
              <p className="text-sm text-brand-700 bg-brand-50 rounded-lg px-3 py-2">建議：{it.todo}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ── 試算條件 ── */}
      <Card title="試算條件" note={`預設是 ${year} 年到今天的實際數字；想估整年，改成預估的全年金額。`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <NumInput label="全年營業額" value={revenue} onChange={(v) => setOverride({ ...override, revenue: v })} suffix="元" hint={`實際 ${fmt(actual)}`} />
          <NumInput label="老師／推銷者分潤" value={shares} onChange={(v) => setOverride({ ...override, shares: v })} suffix="元" hint={`實際 ${fmt(actualShares)}`} />
          <NumInput label="公帳支出" value={expenses} onChange={(v) => setOverride({ ...override, expenses: v })} suffix="元" hint={`實際 ${fmt(actualExpenses)}（不含薪水撥款）`} />
          <NumInput label="支出中拿得到發票的比例" value={invoiceRatio} onChange={setInvoiceRatio} suffix="%" hint="可以扣進項稅額" />
          <NumInput label="合夥人／股東人數" value={partners} onChange={setPartners} suffix="人" hint="獨資填 1" />
          <NumInput label="小規模的核定純益率" value={profitRate} onChange={setProfitRate} suffix="%" hint="國稅局依行業核定，請向國稅局確認" />
        </div>
        {Object.keys(override).length > 0 && (
          <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setOverride({})}>
            改回實際數字
          </button>
        )}
      </Card>

      {/* ── 營業稅 ── */}
      <Card title="營業稅試算（四種情境）" note="假設對外售價已經含稅；開發票時可以扣掉支出發票上的進項稅額。">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            {
              title: "現況：沒有稅籍，被查到",
              tone: "ring-red-200 bg-red-50/40",
              value: vat.unregistered,
              lines: [
                ["補繳營業稅（5%）", fmt(vat.unregistered)],
                ["漏稅罰（0.5～1 倍）", `${fmt(Math.round(vat.unregistered * 0.5))}～${fmt(vat.unregistered)}`],
                ["未辦登記罰鍰", "3,000～30,000"],
              ],
              note: "最壞的情況，金額還不含所得稅補稅。",
            },
            {
              title: "小規模營業人（1%）",
              tone: overSmallMonths.length ? "ring-amber-200" : "ring-emerald-200",
              value: vat.smallScale,
              lines: [["營業額 × 1%", fmt(vat.smallScale)]],
              note: overSmallMonths.length ? `有 ${overSmallMonths.length} 個月超過 20 萬，可能不適用。` : "每月都未達 20 萬才適用。",
            },
            {
              title: "使用統一發票（5%）",
              tone: "ring-brand-200",
              value: vat.invoice,
              lines: [
                ["銷項稅額", fmt(taxIncluded(revenue))],
                ["減：進項稅額", `−${fmt(inputVat)}`],
              ],
              note: "公司或一般行號、月營業額常超過 20 萬時的做法。",
            },
            {
              title: "衝刺班立案為補習班",
              tone: "ring-brand-200",
              value: vat.licensed,
              lines: [
                ["小班家教學費（免稅）", fmt(tutoring)],
                ["線上課程＋書籍 5%", fmt(taxIncluded(revenue - tutoring))],
                ["減：進項稅額", `−${fmt(inputVat)}`],
              ],
              note: "要以補習班（不是公司）立案；公司經營的補習班自 107 年起仍要課稅。",
            },
          ].map((s) => (
            <div key={s.title} className={`rounded-xl ring-1 p-4 ${s.tone}`}>
              <div className="text-sm text-slate-600">{s.title}</div>
              <div className="text-2xl font-semibold text-brand-700 mt-1">{fmt(s.value)}</div>
              <div className="mt-2">
                {s.lines.map(([l, v]) => (
                  <Row key={l} label={l} value={v} />
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-2">{s.note}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400">
          勞務 {fmt(service)}、貨物 {fmt(goods)}；小班家教佔營業額約 {Math.round(tutoringRatio * 100)}%。5% 的稅額＝含稅金額 × 5 ÷ 105。
        </p>
      </Card>

      {/* ── 所得稅 ── */}
      <Card title="所得稅試算" note="淨利＝營業額 − 老師分潤 − 公帳支出 − 營業稅（用「使用統一發票」情境）。">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="rounded-xl ring-1 ring-slate-200 p-4">
            <h3 className="font-medium text-brand-700">公司（有限公司）</h3>
            <Row label="淨利（課稅所得）" value={fmt(Math.max(0, profit - vat.invoice))} />
            <Row label="營利事業所得稅" value={fmt(corpTax)} strong sub="12 萬以下免稅；超過的 20%，但不超過超過 12 萬部分的一半" />
            <p className="text-xs text-slate-500 mt-2">盈餘分配給股東時，股東另外要把股利併入綜所稅（可抵減 8.5%）或分開按 28% 計稅。</p>
          </div>
          <div className="rounded-xl ring-1 ring-slate-200 p-4">
            <h3 className="font-medium text-brand-700">獨資／合夥（一般，開發票）</h3>
            <Row label="淨利" value={fmt(Math.max(0, profit - vat.invoice))} />
            <Row label={`每位合夥人的營利所得（${partners} 人平分）`} value={fmt(perPartner)} />
            <Row label="每人綜所稅（只有這份所得、單身）" value={fmt(partnerTax.tax)} strong />
            <p className="text-xs text-slate-500 mt-2">107 年起獨資、合夥不用繳營所稅，5 月仍要辦結算申報；所得直接算資本主或合夥人的營利所得。</p>
          </div>
          <div className="rounded-xl ring-1 ring-slate-200 p-4">
            <h3 className="font-medium text-brand-700">小規模營業人</h3>
            <Row label={`國稅局核定所得（營業額 × ${profitRate}%）`} value={fmt(smallScaleIncome)} />
            <Row label={`每位合夥人的營利所得（${partners} 人）`} value={fmt(smallPerPartner)} />
            <Row label="每人綜所稅（只有這份所得、單身）" value={fmt(smallPartnerTax.tax)} strong />
            <p className="text-xs text-slate-500 mt-2">不用辦結算申報，由國稅局核定所得後直接歸到資本主或合夥人。純益率依行業而定，請向國稅局確認。</p>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          115 年度綜所稅：免稅額 10.1 萬、標準扣除額 13.6 萬、薪資特別扣除額 22.7 萬；所得淨額 61 萬以下 5%、138 萬以下 12%、277 萬以下 20%、519 萬以下 30%、以上 40%。
        </p>
      </Card>

      {/* ── 老師扣繳 ── */}
      <Card title="老師分潤的扣繳與二代健保" note={`扣繳和補充保費在付錢時發生：有撥款的照 ${year} 年每次撥款金額算，還沒撥款的假設每月分潤當月撥一次。綜所稅用全年分潤估。`}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label">老師的所得類別</label>
            <select className="input !w-56" value={payKind} onChange={(e) => setPayKind(e.target.value as typeof payKind)}>
              <option value="professional">執行業務所得（沒有僱傭關係）</option>
              <option value="salary">兼職薪資所得（有僱傭關係）</option>
            </select>
          </div>
          {payKind === "professional" && (
            <div className="w-56">
              <NumInput label="執行業務費用率" value={expenseRate} onChange={setExpenseRate} suffix="%" hint="依國稅局公告的行業費用率" />
            </div>
          )}
        </div>
        <div className="table-wrap">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th>姓名</th>
                <th className="text-right">{year} 年分潤</th>
                <th className="text-right">已撥款</th>
                <th className="text-right">應預扣所得稅</th>
                <th className="text-right">應扣補充保費</th>
                <th className="text-right">本人綜所稅粗估</th>
              </tr>
            </thead>
            <tbody>
              {payees.map((p) => (
                <tr key={p.key}>
                  <td className="font-medium">
                    {p.name}
                    {p.estimated && <span className="block text-xs text-slate-400 font-normal">還沒撥款，假設每月撥一次</span>}
                  </td>
                  <td className="text-right tabular-nums">{fmt(p.earned)}</td>
                  <td className="text-right tabular-nums">
                    {fmt(p.paid)}
                    <span className="text-xs text-slate-400 ml-1">（{p.paidCount} 次）</span>
                  </td>
                  <td className="text-right tabular-nums">{fmt(p.withhold)}</td>
                  <td className="text-right tabular-nums">
                    {fmt(p.nhi)}
                    <span className="text-xs text-slate-400 ml-1">（{p.count} 次）</span>
                  </td>
                  <td className="text-right tabular-nums">{fmt(p.personal.tax)}</td>
                </tr>
              ))}
              {!payees.length && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-400 py-6">
                    這一年還沒有分潤
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">
          {payKind === "professional"
            ? "執行業務：單次 ≥ 20,010 元扣 10%（扣繳稅額 2,000 元以下免扣）；單次 ≥ 2 萬元扣 2.11% 補充保費（有在職場投保等身分可能免扣）。"
            : "兼職薪資：單次 ≥ 90,501 元扣 5%；單次 ≥ 基本工資 29,500 元扣 2.11% 補充保費。公司身為投保單位，另有雇主補充保費。"}
          「本人綜所稅粗估」假設老師單身、只有這一份所得、用標準扣除額，實際要看各自的全年所得。
        </p>
      </Card>

      {/* ── 行事曆 ── */}
      <Card title="報稅行事曆（辦好登記之後）">
        <div className="table-wrap">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th>時間</th>
                <th>要做的事</th>
                <th>適用</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["單數月 1–15 日", "申報繳納前兩個月的營業稅（401 申報書）", "使用統一發票"],
                ["1、4、7、10 月", "國稅局寄發上一季的查定營業稅繳款書，按 1% 繳納", "小規模營業人"],
                ["每月 10 日前", "繳納上個月預扣的所得稅（扣繳稅款）", "有預扣老師所得稅時"],
                ["次月底前", "繳納上個月扣的二代健保補充保費", "有扣補充保費時"],
                ["1 月 31 日前", "申報上一年度扣（免）繳憑單，並寄給老師", "有付老師報酬"],
                ["5 月 1–31 日", "營利事業所得稅結算申報（獨資、合夥只申報不繳稅）", "公司、一般行號"],
                ["5 月 1–31 日", "個人綜合所得稅結算申報（合夥人、老師各自申報）", "所有人"],
              ].map(([t, w, a]) => (
                <tr key={t + w}>
                  <td className="whitespace-nowrap">{t}</td>
                  <td>{w}</td>
                  <td className="text-slate-500">{a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── 參考資料 ── */}
      <Card title="參考資料">
        <ul className="text-sm space-y-1.5 list-disc pl-5 text-slate-600">
          {[
            ["財政部稅務入口網：網路交易課稅專區（起徵點 114 年起調為貨物 10 萬、勞務 5 萬）", "https://www.etax.nat.gov.tw/etwmain/tax-info/network-transaction-taxtation-area/q-and-a"],
            ["財政部稅務入口網：營業稅節稅手冊（小規模營業人查定課徵）", "https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-saving-manual/national/business-tax/6opmkDW"],
            ["工商時報：財政部澄清月銷售額未達 20 萬仍維持 1% 查定課徵（2026/3）", "https://ctee.com.tw/news/20260320700584-430301"],
            ["財政部稅務入口網：獨資合夥組織免計算繳納結算稅額", "https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-saving-manual/national/profit-seeking-enterprise-income-tax/7KLMbzD"],
            ["TVBS：115 年度綜所稅免稅額、扣除額、級距", "https://health.tvbs.com.tw/life/359279"],
            ["Ettoday：未立案補習班與公司經營之補習班自 107 年起課徵營業稅", "https://finance.ettoday.net/news/1079562"],
            ["法律百科：線上小班課程是否屬短期補習班", "https://www.legis-pedia.com/QA/question/3052/"],
            ["104 人力銀行：未辦稅籍登記罰 3,000～30,000 元", "https://blog.104.com.tw/?p=174922"],
            ["KPMG：出版品免徵營業稅新制（文化藝術事業減免營業稅辦法）", "https://kpmg.com/tw/zh/home/media/press-releases/2021/11/tax-mitigation-for-publishers.html"],
            ["115 年常用各類所得扣繳率簡表（薪資起扣 90,501 元、基本工資 29,500 元）", "https://gad.nfu.edu.tw/uploads/asset/data/6a5e1ae14eae35daa9be6078/115-%E5%B8%B8%E7%94%A8%E5%90%84%E9%A1%9E%E6%89%80%E5%BE%97%E6%89%A3%E7%B9%B3%E7%B0%A1%E8%A1%A8.pdf"],
            ["健保署：二代健保補充保費（費率 2.11%）", "https://www.nhi.gov.tw/ch/dl-26432-f744a781bf4043618d0bd5b4a4c5518a-1.pdf"],
          ].map(([t, u]) => (
            <li key={u}>
              <a className="text-brand-600 hover:underline" href={u} target="_blank" rel="noreferrer">
                {t}
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
