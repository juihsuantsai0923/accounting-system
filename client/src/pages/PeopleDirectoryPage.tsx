import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";

interface Props {
  kind: "teacher" | "salesperson";
}

/**
 * 教師/推銷者名單較多時，導覽列不會再逐一列出每個人的分頁，
 * 而是統一先進到這個列表頁，用搜尋框篩選姓名後再點進去看該對象的子記帳表。
 */
export function PeopleDirectory({ kind }: Props) {
  const navigate = useNavigate();
  const teachersQuery = trpc.teachers.list.useQuery(undefined, { enabled: kind === "teacher" });
  const salespeopleQuery = trpc.salespeople.list.useQuery(undefined, { enabled: kind === "salesperson" });
  const [query, setQuery] = useState("");

  const list = (kind === "teacher" ? teachersQuery.data : salespeopleQuery.data) ?? [];
  const filtered = list.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const label = kind === "teacher" ? "教師" : "推銷者";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">{label}列表</h1>
      <div className="card space-y-4">
        <input className="input" placeholder={`搜尋${label}姓名...`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn-secondary justify-start truncate"
              onClick={() => navigate(`/${kind}/${p.id}`)}
              title={p.name}
            >
              {p.name}
            </button>
          ))}
          {filtered.length === 0 && <div className="col-span-full text-center text-slate-400 py-6">查無符合的{label}</div>}
        </div>
      </div>
    </div>
  );
}

export function SalespeopleDirectoryPage() {
  return <PeopleDirectory kind="salesperson" />;
}
