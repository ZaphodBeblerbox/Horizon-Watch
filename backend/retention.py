"""
retention.py — the job that stops the database growing to ten gigabytes again.

THE DEFECT WAS NEVER THE SIZE. It was that nothing pruned. track_density,
vessel_history and aircraft_history accumulated every position ever
received, forever, and the only reason anybody noticed was the disk filling
up — at which point the app, the build and the dev server all stopped at
once.

So this runs on a schedule and is boring on purpose:

  - roll yesterday's raw positions into the daily aggregates
  - delete raw positions older than KEEP_DAYS
  - leave the aggregates alone; they are the long-term record

It does NOT vacuum. A vacuum needs room for a second copy of the file and
takes minutes, and a retention job that can fail on a full disk is a
retention job that will. Deleted rows become free pages that the next
inserts reuse, so the file stops growing without ever needing to shrink.

    from retention import run_retention
    run_retention()                 # once a day is plenty
"""
from __future__ import annotations

import datetime
import os
import sqlite3

KEEP_DAYS = int(os.getenv("TRACK_RETENTION_DAYS", "3"))

# Imported from the one-off tool so the rollup SQL has a single definition.
# Two copies of "how a day is aggregated" would diverge, and the divergence
# would only show up months later as a gap in the numbers.
from prune_history import ROLLUP_DDL, ROLLUPS


def _db_path() -> str:
    try:
        from main import DATA_DIR
        return os.path.join(DATA_DIR, "akili.db")
    except Exception:
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "akili.db")


def run_retention(keep_days: int | None = None, verbose: bool = True) -> dict:
    keep = KEEP_DAYS if keep_days is None else keep_days
    path = _db_path()
    if not os.path.exists(path):
        return {"ok": False, "why": "no database"}

    out = {"ok": True, "keep_days": keep, "rolled": {}, "deleted": {}}
    con = sqlite3.connect(path, timeout=120, isolation_level=None)
    try:
        con.execute("PRAGMA temp_store=MEMORY")
        for ddl in ROLLUP_DDL:
            con.execute(ddl)

        # Roll up EVERYTHING still present, not just the part about to be
        # deleted. INSERT OR REPLACE makes it idempotent, and a day that is
        # still accumulating is simply recomputed next time.
        for name, sql in ROLLUPS:
            if not _table_exists(con, _source_of(sql)):
                continue
            con.execute("BEGIN")
            con.execute(sql)
            con.execute("COMMIT")
            out["rolled"][name] = con.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]

        cutoff = (datetime.datetime.utcnow()
                  - datetime.timedelta(days=keep)).strftime("%Y-%m-%d %H:%M:%S")
        for t in ("vessel_history", "aircraft_history"):
            if not _table_exists(con, t):
                continue
            con.execute("BEGIN")
            cur = con.execute(f"DELETE FROM {t} WHERE timestamp < ?", (cutoff,))
            con.execute("COMMIT")
            out["deleted"][t] = cur.rowcount
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except sqlite3.Error as e:
        out = {"ok": False, "why": str(e)}
    finally:
        con.close()

    if verbose:
        print(f"[retention] {out}", flush=True)
    return out


def _table_exists(con, name: str) -> bool:
    return bool(con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def _source_of(sql: str) -> str:
    """The table a rollup reads from, taken out of its own FROM clause so
    this cannot disagree with the SQL it is guarding."""
    import re
    m = re.search(r"\bFROM\s+(\w+)", sql, re.I)
    return m.group(1) if m else ""


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=None)
    run_retention(ap.parse_args().days)
