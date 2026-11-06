"""2026-11-07 行政費比例改成 蔡睿軒 4、潘彥宇 3.5、王歆宜 2、余彩霞 0.5：只重分第一筆小班家教（含）之後的行政費。

用法：python scripts/recalc_admin_split_20261107.py <D1 export.sql> <輸出.sql>
行政費總額、老師主理分潤、公積金都不變，只改四個人之間的分配。
"""
import sqlite3
import sys
import time

WEIGHTS = {("teacher", 2): 4.0, ("teacher", 4): 3.5, ("teacher", 3): 2.0, ("salesperson", 1): 0.5}
SUFFIX = "（行政費）"


def main(src, dst):
    dump = open(src, encoding="utf-8").read()
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(dump.replace("PRAGMA defer_foreign_keys=TRUE;", "").replace("BEGIN TRANSACTION;", "").replace("COMMIT;", ""))
    c.executescript("DROP TABLE IF EXISTS integration_keys;")

    entries = c.execute("SELECT * FROM main_ledger WHERE deleted_at IS NULL AND type = 'income' ORDER BY created_at, id").fetchall()
    cutoff = next(e["created_at"] for e in entries if e["income_source"] == "tutoring" or "tutoring" in (e["breakdown"] or ""))
    total_w = sum(WEIGHTS.values())
    now = int(time.time() * 1000)
    stmts = []
    for (typ, rid), w in WEIGHTS.items():
        stmts.append(f"UPDATE revenue_team_members SET weight = {w} WHERE recipient_type = '{typ}' AND recipient_id = {rid}")

    changed = set()
    for tbl, typ, col in (("teacher_ledger", "teacher", "teacher_id"), ("salesperson_ledger", "salesperson", "salesperson_id")):
        rows = c.execute(
            f"SELECT l.* FROM {tbl} l JOIN main_ledger m ON m.id = l.main_ledger_id WHERE m.created_at >= ? AND l.item_name LIKE ?", (cutoff, "%" + SUFFIX)
        ).fetchall()
        for r in rows:
            key = (typ, r[col])
            base = r["original_amount"]
            admin = int(base * 0.2 + 0.5 + 1e-9)
            new = int(admin * WEIGHTS[key] / total_w + 1e-9)
            if new != r["personal_amount"]:
                s = f"UPDATE {tbl} SET personal_amount = {new}, updated_at = {now} WHERE id = {r['id']}"
                stmts.append(s)
                c.execute(s)
                changed.add(r["main_ledger_id"])

    # 分配表沒有項目名稱，受影響的記錄用子記帳表重建
    next_d = c.execute("SELECT MAX(id) FROM ledger_distribution").fetchone()[0] + 1
    for mid in sorted(changed):
        created = c.execute("SELECT created_at FROM main_ledger WHERE id = ?", (mid,)).fetchone()[0]
        s = f"DELETE FROM ledger_distribution WHERE main_ledger_id = {mid}"
        stmts.append(s)
        c.execute(s)
        for tbl, typ, col in (("teacher_ledger", "teacher", "teacher_id"), ("salesperson_ledger", "salesperson", "salesperson_id")):
            for r in c.execute(f"SELECT {col} rid, personal_amount a FROM {tbl} WHERE main_ledger_id = ? AND source_type = 'distribution' ORDER BY id", (mid,)).fetchall():
                s = (
                    "INSERT INTO ledger_distribution (id, main_ledger_id, distribution_type, recipient_id, amount, created_at, updated_at) "
                    f"VALUES ({next_d}, {mid}, '{typ}', {r['rid']}, {r['a']}, {created}, {now})"
                )
                stmts.append(s)
                c.execute(s)
                next_d += 1

    def delta(r):
        if r["source_type"] == "advance":
            return r["personal_amount"]
        if r["source_type"] == "advance_settlement":
            return -r["personal_amount"]
        return r["personal_amount"] if r["type"] == "income" else -r["personal_amount"]

    finals = {}
    for tbl, col in (("teacher_ledger", "teacher_id"), ("salesperson_ledger", "salesperson_id")):
        for (pid,) in c.execute(f"SELECT DISTINCT {col} FROM {tbl}").fetchall():
            run = 0
            for r in c.execute(f"SELECT * FROM {tbl} WHERE {col} = ? ORDER BY created_at, id", (pid,)).fetchall():
                run += delta(r)
                if r["personal_balance"] != run:
                    s = f"UPDATE {tbl} SET personal_balance = {run} WHERE id = {r['id']}"
                    stmts.append(s)
                    c.execute(s)
            finals[(tbl, pid)] = run

    stmts.append(
        "INSERT INTO audit_log (actor_id, action, target_type, target_id, before_data, after_data, created_at) "
        f"VALUES (1, 'recalcAdminSplit20261107', 'mainLedger', 0, NULL, '4:3.5:2:0.5', {now})"
    )
    open(dst, "w", encoding="utf-8").write(";\n".join(stmts) + ";\n")

    names = {r["id"]: r["name"] for r in c.execute("SELECT id, name FROM teachers")}
    names_s = {r["id"]: r["name"] for r in c.execute("SELECT id, name FROM salespeople")}
    main_bal = c.execute("SELECT SUM(CASE type WHEN 'income' THEN amount ELSE -amount END) FROM main_ledger WHERE deleted_at IS NULL").fetchone()[0]
    print("statements", len(stmts), "entries", len(changed))
    for (tbl, pid), v in sorted(finals.items()):
        print((names if tbl == "teacher_ledger" else names_s)[pid], v)
    print("母帳餘額", main_bal, "公積金", main_bal - sum(finals.values()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
