"""2026-11-07 舊帳重算：把所有課程、小班家教、試上、書籍收入改成新分潤規則。

用法：python scripts/recalc_shares_20261107.py <D1 export.sql> <輸出.sql>
只讀 export，產生要在 D1 跑的 SQL，並在記憶體裡套用一次做檢查。行事曆、運費、創始基金、其他收入不動。
migrations/0021_team_weights.sql 要先跑。
"""
import json
import sqlite3
import sys
import time

RESERVE, ADMIN, BOOK_RESERVE = 0.1, 0.2, 0.35
SHIPPER_SALESPERSON_ID = 1
TEAM = [("teacher", 2, 4.0), ("teacher", 4, 3.5), ("teacher", 3, 1.5), ("salesperson", SHIPPER_SALESPERSON_ID, 1.0)]
SUBJECTS = [(("物理",), 2), (("化學",), 3), (("生物",), 4), (("地科", "地球科學"), 5), (("數學",), 2)]
# 試上依原本拿分潤的老師對到課程
TRIAL_COURSE_BY_TEACHER = {2: 4, 3: 5, 4: 6, 5: 7}


def r0(x):
    """跟 JS Math.round 一樣：.5 進位"""
    import math
    return math.floor(x + 0.5 + 1e-9)


def split(amount, teacher, reserve_rate, owner_label, admin_label):
    company = r0(amount * (reserve_rate + ADMIN))
    admin = r0(amount * ADMIN)
    total_w = sum(w for _, _, w in TEAM)
    out = [("teacher", teacher, amount - company, owner_label)]
    for typ, rid, w in TEAM:
        out.append((typ, rid, int(admin * w / total_w + 1e-9), admin_label))
    return out


def subject_teacher(name):
    for keys, tid in SUBJECTS:
        if any(k in name for k in keys):
            return tid
    return None


def sql_str(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def main(src, dst):
    dump = open(src, encoding="utf-8").read()
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(dump.replace("PRAGMA defer_foreign_keys=TRUE;", "").replace("BEGIN TRANSACTION;", "").replace("COMMIT;", ""))
    c.executescript("DROP TABLE IF EXISTS integration_keys;")
    try:
        c.execute("ALTER TABLE revenue_team_members ADD COLUMN weight REAL NOT NULL DEFAULT 1")
    except sqlite3.OperationalError:
        pass

    courses = {r["name"]: r for r in c.execute("SELECT * FROM courses")}
    notebooks = {r["id"] for r in c.execute("SELECT id FROM books WHERE kind = 'notebook'")}
    shipper = c.execute("SELECT name FROM shippers WHERE is_active = 1").fetchall()
    assert len(shipper) == 1, "出貨員應該只有 1 位"
    assert c.execute("SELECT COUNT(*) FROM salespeople").fetchone()[0] == 0, "推銷者名單不是空的，要改 SHIPPER_SALESPERSON_ID"
    assert c.execute("SELECT COUNT(*) FROM salesperson_ledger").fetchone()[0] == 0

    now = int(time.time() * 1000)
    stmts = [
        f"INSERT INTO salespeople (id, name, note, is_active, created_at, updated_at) VALUES ({SHIPPER_SALESPERSON_ID}, {sql_str(shipper[0]['name'])}, '出貨員（行政費分配）', 1, {now}, {now})",
        f"UPDATE revenue_settings SET reserve_rate = {RESERVE}, admin_fee_rate = {ADMIN}, book_reserve_rate = {BOOK_RESERVE}, updated_at = {now} WHERE id = 1",
        "UPDATE revenue_team_members SET weight = 4 WHERE recipient_type = 'teacher' AND recipient_id = 2",
        "UPDATE revenue_team_members SET weight = 3.5 WHERE recipient_type = 'teacher' AND recipient_id = 4",
        "UPDATE revenue_team_members SET weight = 1.5 WHERE recipient_type = 'teacher' AND recipient_id = 3",
        f"INSERT INTO revenue_team_members (recipient_type, recipient_id, weight, created_at) VALUES ('salesperson', {SHIPPER_SALESPERSON_ID}, 1, {now})",
    ]

    entries = c.execute("SELECT * FROM main_ledger WHERE deleted_at IS NULL AND type = 'income' ORDER BY created_at, id").fetchall()
    next_t = c.execute("SELECT MAX(id) FROM teacher_ledger").fetchone()[0] + 1
    next_s = 1
    next_d = c.execute("SELECT MAX(id) FROM ledger_distribution").fetchone()[0] + 1
    report = []

    for e in entries:
        cat, src_type = e["category_name"], e["income_source"]
        if cat in ("創始基金", "其他"):
            continue
        if e["breakdown"]:
            parts = json.loads(e["breakdown"])
        elif cat == "試上":
            parts = [{"source": "trial", "name": e["item_name"], "categoryId": e["category_id"], "amount": e["amount"]}]
        elif src_type in ("tutoring", "course", "book"):
            parts = [{"source": src_type, "name": e["item_name"], "categoryId": e["category_id"], "amount": e["amount"]}]
        elif cat in courses:
            parts = [{"source": "course", "name": e["item_name"], "categoryId": e["category_id"], "amount": e["amount"]}]
        else:
            raise SystemExit(f"認不出來的收入 #{e['id']} {cat}")

        old_rows = c.execute("SELECT * FROM teacher_ledger WHERE main_ledger_id = ? AND source_type = 'distribution'", (e["id"],)).fetchall()
        dists = []  # (type, id, amount, label, base)
        for p in parts:
            name, amount, source = p["name"], p["amount"], p["source"]
            if source == "tutoring":
                course = courses.get(name)
                assert course and course["teacher_id"], name
                rows = split(amount, course["teacher_id"], RESERVE, f"{name}（小班家教分潤）", f"{name}（行政費）")
            elif source == "course":
                course = courses.get(name)
                assert course and course["teacher_id"], name
                rows = split(amount, course["teacher_id"], RESERVE, f"{name}（課程主理分潤）", f"{name}（行政費）")
            elif source == "trial":
                owners = {r["teacher_id"] for r in old_rows}
                assert len(owners) == 1, e["id"]
                teacher = owners.pop()
                new_course = TRIAL_COURSE_BY_TEACHER[teacher]
                stmts.append(f"UPDATE main_ledger SET income_source = 'trial', category_id = {new_course} WHERE id = {e['id']}")
                rows = split(amount, teacher, RESERVE, f"{name}（試上分潤）", f"{name}（行政費）")
            elif source == "book":
                if name == "運費" or p["categoryId"] in notebooks or "行事曆" in name:
                    continue
                teacher = subject_teacher(name)
                if not teacher:
                    continue
                rows = split(amount, teacher, BOOK_RESERVE, f"{name}（書籍分潤）", f"{name}（行政費）")
            else:
                raise SystemExit(f"認不出來的來源 #{e['id']} {source}")
            dists += [(t, rid, a, label, amount) for t, rid, a, label in rows]

        if not dists and not old_rows:
            continue
        assert sum(d[2] for d in dists) <= e["amount"], e["id"]
        stmts.append(f"DELETE FROM teacher_ledger WHERE main_ledger_id = {e['id']} AND source_type = 'distribution'")
        stmts.append(f"DELETE FROM ledger_distribution WHERE main_ledger_id = {e['id']}")
        new_cat = cat
        cat_id = e["category_id"]
        if cat == "試上":
            cat_id = TRIAL_COURSE_BY_TEACHER[next(r["teacher_id"] for r in old_rows)]
        for typ, rid, amount, label, base in dists:
            if amount <= 0:
                continue
            stmts.append(
                "INSERT INTO ledger_distribution (id, main_ledger_id, distribution_type, recipient_id, amount, created_at, updated_at) "
                f"VALUES ({next_d}, {e['id']}, '{typ}', {rid}, {amount}, {e['created_at']}, {now})"
            )
            next_d += 1
            if typ == "teacher":
                tbl, col, lid = "teacher_ledger", "teacher_id", next_t
                next_t += 1
            else:
                tbl, col, lid = "salesperson_ledger", "salesperson_id", next_s
                next_s += 1
            stmts.append(
                f"INSERT INTO {tbl} (id, {col}, main_ledger_id, source_type, type, item_name, category_id, category_name, original_amount, personal_amount, personal_balance, edited_by, created_at, updated_at) "
                f"VALUES ({lid}, {rid}, {e['id']}, 'distribution', 'income', {sql_str(label)}, {cat_id}, {sql_str(new_cat)}, {base}, {amount}, 0, {sql_str(e['edited_by'])}, {e['created_at']}, {now})"
            )
        report.append((e["id"], e["amount"], sum(d[2] for d in dists if d[2] > 0)))

    for s in stmts:
        c.execute(s)

    # 餘額：依時間排序累加（跟 server/ledger.ts recalculateBalance 相同）
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
        f"VALUES (1, 'recalcShares20261107', 'mainLedger', 0, NULL, {sql_str(json.dumps({'adminFee': ADMIN, 'bookReserve': BOOK_RESERVE, 'team': TEAM}))}, {now})"
    )
    open(dst, "w", encoding="utf-8").write(";\n".join(stmts) + ";\n")

    names = {r["id"]: r["name"] for r in c.execute("SELECT id, name FROM teachers")}
    names_s = {r["id"]: r["name"] for r in c.execute("SELECT id, name FROM salespeople")}
    main_bal = c.execute("SELECT SUM(CASE type WHEN 'income' THEN amount ELSE -amount END) FROM main_ledger WHERE deleted_at IS NULL").fetchone()[0]
    owed = sum(finals.values())
    print("statements", len(stmts), "entries", len(report))
    for (tbl, pid), v in sorted(finals.items()):
        print(tbl, (names if tbl == "teacher_ledger" else names_s)[pid], v)
    print("母帳餘額", main_bal, "子帳合計", owed, "公積金", main_bal - owed)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
