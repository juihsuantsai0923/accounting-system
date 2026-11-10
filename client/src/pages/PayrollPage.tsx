import { useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useAuth, canManage } from "../lib/auth";
import { downloadTextFile } from "../lib/download";
import { paydayLabel } from "../components/PaySchedule";

function fmt(n: number) {
  return n < 0 ? `−${Math.abs(n).toLocaleString()}` : n.toLocaleString();
}

function csv(headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
}

type Person = {
  recipientType: "teacher" | "salesperson";
  recipientId: number;
  name: string;
  isShipper: boolean;
  balance: number;
  totalPaid: number;
  next: { payday: string; payable: number; notYetDue: number };
  paydays: { payday: string; due: number; paid: number }[];
};

/** 記錄發放：金額預設＝這次可發，可改；按下去在帳本記一筆該人的薪水撥款 */
function PayButton({ p, payday }: { p: Person; payday: string }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(p.next.payable));
  const [date, setDate] = useState("");
  const pay = trpc.payroll.markPaid.useMutation({
    onSuccess: () => {
      setOpen(false);
      utils.payroll.invalidate();
      utils.mainLedger.list.invalidate();
      utils.reports.invalidate();
    },
  });
  if (!open)
    return (
      <button type="button" className="text-xs text-brand-600 hover:underline mt-1" onClick={() => setOpen(true)}>
        記錄發放
      </button>
    );
  return (
    <div className="mt-1 space-y-1 text-left">
      <input className="input !py-1 !text-xs" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
      <input className="input !py-1 !text-xs" type="date" value={date} onChange={(e) => setDate(e.target.value)} title="發放日（空白＝今天）" />
      <div className="flex gap-1">
        <button
          type="button"
          className="btn-primary !px-2 !py-1 !text-xs"
          disabled={!amount || pay.isPending}
          onClick={() =>
            pay.mutate({ recipientType: p.recipientType, recipientId: p.recipientId, amount: parseInt(amount, 10), payday, paidDate: date || undefined })
          }
        >
          確認
        </button>
        <button type="button" className="btn-secondary !px-2 !py-1 !text-xs" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
      {pay.error && <div className="text-xs text-red-600">{pay.error.message}</div>}
    </div>
  );
}

/**
 * 發薪表（只有管理員看得到）：每個人一列、每個 15 日一欄。
 * 應發＝那次新到期的金額（截至上個月底），已發＝那個月的薪水撥款。下次發薪那一欄可以直接記錄發放。
 */
export default function PayrollPage() {
  const { user } = useAuth();
  const q = trpc.payroll.table.useQuery(undefined, { retry: false });
  const t = q.data;
  const people = (t?.people ?? []) as Person[];
  const manage = canManage(user?.role);

  function download() {
    if (!t) return;
    const headers = ["身份", "姓名", ...t.paydays.flatMap((pd) => [`${pd} 應發`, `${pd} 已發`]), "已發合計", "公司欠款", `${t.nextPayday} 可發`, "尚未到期"];
    const rows = people.map((p) => [
      p.recipientType === "teacher" ? "教師" : p.isShipper ? "出貨員" : "推銷者",
      p.name,
      ...p.paydays.flatMap((d) => [d.due, d.paid]),
      p.totalPaid,
      p.balance,
      p.next.payable,
      p.next.notYetDue,
    ]);
    downloadTextFile(`發薪表_${new Date().toISOString().slice(0, 10)}.csv`, csv(headers, rows));
  }

  if (q.error) return <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{q.error.message}</div>;
  const sum = (f: (p: Person) => number) => people.reduce((s, p) => s + f(p), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl text-brand-700">發薪表</h1>
        <button className="btn-secondary" onClick={download} disabled={!t}>
          下載 CSV
        </button>
      </div>
      <p className="text-sm text-slate-600">
        每月 15 日發「截至上個月底已到期 − 已發放」。衝刺班依課程期間按天攤提；書籍、線上課程、試上、代墊入帳就到期；家長還沒繳的學費，收到後下一個 15 日才發。
        之後的欄位是依目前的帳預估。
      </p>
      {!t ? (
        <div className="text-slate-400">載入中…</div>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left sticky left-0 bg-slate-50">姓名</th>
                {t.paydays.map((pd) => (
                  <th key={pd} className={`px-3 py-2 text-right ${pd === t.nextPayday ? "bg-amber-50 text-amber-800" : ""}`}>
                    {paydayLabel(pd, true)}
                    {pd === t.nextPayday && <div className="text-[10px] font-normal">下次發薪</div>}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">公司欠款</th>
                <th className="px-3 py-2 text-right">尚未到期</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={`${p.recipientType}-${p.recipientId}`} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 sticky left-0 bg-white">
                    <Link to={`/${p.recipientType}/${p.recipientId}/dashboard`} className="text-brand-700 hover:underline">
                      {p.name}
                    </Link>
                    <span className="ml-1 text-xs text-slate-400">{p.recipientType === "teacher" ? "教師" : p.isShipper ? "出貨員" : "推銷者"}</span>
                  </td>
                  {p.paydays.map((d) => {
                    const isNext = d.payday === t.nextPayday;
                    const past = d.payday < t.nextPayday;
                    return (
                      <td key={d.payday} className={`px-3 py-2 text-right tabular-nums ${isNext ? "bg-amber-50" : ""} ${past || isNext ? "" : "text-slate-400"}`}>
                        <div>{fmt(d.due)}</div>
                        {d.paid > 0 && <div className="text-xs text-emerald-700">已發 {fmt(d.paid)}</div>}
                        {isNext && (
                          <>
                            <div className="text-xs text-amber-800">可發 {fmt(p.next.payable)}</div>
                            {manage && p.next.payable > 0 && <PayButton p={p} payday={d.payday} />}
                          </>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(p.balance)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmt(p.next.notYetDue)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 font-semibold">
                <td className="px-3 py-2 sticky left-0 bg-white">合計</td>
                {t.paydays.map((pd, i) => (
                  <td key={pd} className={`px-3 py-2 text-right tabular-nums ${pd === t.nextPayday ? "bg-amber-50" : ""}`}>
                    <div>{fmt(sum((p) => p.paydays[i]?.due ?? 0))}</div>
                    {sum((p) => p.paydays[i]?.paid ?? 0) > 0 && <div className="text-xs text-emerald-700">已發 {fmt(sum((p) => p.paydays[i]?.paid ?? 0))}</div>}
                    {pd === t.nextPayday && <div className="text-xs text-amber-800">可發 {fmt(sum((p) => p.next.payable))}</div>}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{fmt(sum((p) => p.balance))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(sum((p) => p.next.notYetDue))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
