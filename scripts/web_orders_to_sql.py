"""把官網訂單快照（JSON）轉成寫入 D1 web_orders 的 SQL。

用法：
  python scripts/web_orders_to_sql.py <快照.json> <輸出.sql>
  npx.cmd wrangler d1 execute accounting-system-db --remote --file=<輸出.sql>

快照格式（每筆一個陣列）：
  [訂單編號, 下單時間(台灣時間 YYYY-MM-DDTHH:MM:SS), 買家, 實付金額, 折扣, 官網狀態, 分頁(pending|completed|cancelled),
   [[品名, 單價, 是否預購(0/1), 是否組合包(0/1)], ...]]

已存在的訂單會更新官網的資料（狀態、金額、品項），但保留記帳系統這邊手動標記的對帳狀態與備註。
快照含買家姓名，不要放進 git。
"""
import json
import sys
import time
from datetime import datetime, timedelta, timezone

TW = timezone(timedelta(hours=8))


def q(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def main(src: str, dst: str) -> None:
    rows = json.load(open(src, encoding="utf-8"))
    now = int(time.time() * 1000)
    out = []
    for no, at, buyer, total, discount, status, tab, items in rows:
        ts = int(datetime.fromisoformat(at).replace(tzinfo=TW).timestamp() * 1000)
        items_json = json.dumps(
            [{"name": n, "price": p, "preorder": bool(pre), "bundle": bool(bun)} for n, p, pre, bun in items],
            ensure_ascii=False,
        )
        out.append(
            "INSERT INTO web_orders (order_no, ordered_at, buyer, total, discount, status_label, tab, items, synced_at) "
            f"VALUES ({q(no)}, {ts}, {q(buyer)}, {int(total)}, {int(discount)}, {q(status)}, {q(tab)}, {q(items_json)}, {now}) "
            "ON CONFLICT(order_no) DO UPDATE SET ordered_at = excluded.ordered_at, buyer = excluded.buyer, total = excluded.total, "
            "discount = excluded.discount, status_label = excluded.status_label, tab = excluded.tab, items = excluded.items, "
            "synced_at = excluded.synced_at;"
        )
    open(dst, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
    print(f"{len(rows)} 筆訂單 → {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
