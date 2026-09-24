"""
sync_cursor.py — "give me everything after cursor X".

THE SHAPE A LOCAL-FIRST CLIENT NEEDS. Not "the last 48 hours", which
re-sends everything on every poll and cannot be resumed, but a cursor the
client stores and hands back. A dropped connection costs the rows that
were in flight, not the window.

WHY THE CURSOR IS (timestamp, id) AND NOT A TIMESTAMP. Many rows share a
timestamp — a scan writes hundreds of detections in the same second — so
a bare timestamp cursor either re-sends a whole second on every call or
skips the tail of one. The pair is unique and totally ordered, so
resumption lands exactly where it stopped.

WHAT IS CACHEABLE AND WHAT IS NOT. Detected signals, fusion cells and
scored items, plus the reference rows they point at. NOT the raw
firehose: millions of AIS pings will not fit on a laptop and would not
be read if they did. A client asking for everything gets what a person
could actually use.
"""
from __future__ import annotations
import base64
import json
import sqlite3

#: Nothing may ask for more than this in one page, however it asks.
MAX_PAGE = 500

#: How much history a client may pull on a cold start. Sized so a laptop
#: that syncs, closes and reopens twelve hours later still has context.
COLD_START_HOURS = 72


def encode_cursor(ts: str, row_id) -> str:
    """Opaque to the client, so its shape can change without a migration."""
    raw = json.dumps({"t": ts, "i": row_id}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cur: str | None) -> tuple | None:
    if not cur:
        return None
    try:
        pad = "=" * (-len(cur) % 4)
        raw = base64.urlsafe_b64decode(cur + pad).decode()
        d = json.loads(raw)
        return (str(d["t"]), d["i"])
    except Exception:                                        # noqa: BLE001
        # A corrupt cursor is a cold start, not an error. The client gets
        # a full window rather than a 400 it cannot act on offline.
        return None


def page(conn: sqlite3.Connection, *, table: str, ts_col: str, id_col: str,
         columns: list, cursor: str | None = None, limit: int = 200,
         where: str = "", params: tuple = ()) -> dict:
    """One page of rows after `cursor`, oldest first, with the next cursor.

    Ordered by (ts, id) so the cursor is exact. `where` is composed by the
    caller, never by the client.
    """
    limit = max(1, min(MAX_PAGE, int(limit or 200)))
    cur = decode_cursor(cursor)
    cols = ", ".join(columns)

    clauses, args = [], list(params)
    if where:
        clauses.append(f"({where})")
    if cur:
        clauses.append(f"({ts_col} > ? OR ({ts_col} = ? AND {id_col} > ?))")
        args += [cur[0], cur[0], cur[1]]
    else:
        clauses.append(
            f"{ts_col} >= datetime('now', '-{int(COLD_START_HOURS)} hours')")
    sql = (f"SELECT {cols} FROM {table}"
           + (" WHERE " + " AND ".join(clauses) if clauses else "")
           + f" ORDER BY {ts_col} ASC, {id_col} ASC LIMIT ?")
    args.append(limit)

    try:
        rows = conn.execute(sql, args).fetchall()
    except sqlite3.Error as e:
        return {"rows": [], "cursor": cursor, "more": False, "error": str(e)}

    out = [dict(zip(columns, r)) for r in rows]
    nxt = cursor
    if out:
        last = out[-1]
        nxt = encode_cursor(str(last[ts_col]), last[id_col])
    return {
        "rows": out,
        "cursor": nxt,
        # `more` is honest: a full page means there may be another, an
        # empty or short one means the client is caught up and can stop
        # polling until its next interval.
        "more": len(out) == limit,
        "count": len(out),
    }
