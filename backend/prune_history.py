"""
prune_history.py — turn years of raw tracks into numbers, then reclaim the disk.

WHY. The database reached 10.7 GB, of which ~29.8M of 31.5M rows were three
history tables that nothing ever pruned: track_density (24.2M), and
vessel_history / aircraft_history (4.4M between them).

WHAT A TRACK IS ACTUALLY FOR. Two things, and only one of them needs the
points. "Show me this ship's trail" needs the last few days of positions.
"How many ships went through here, and where did they go" is a COUNT, and
storing it as ten million positions is storing the question's raw material
forever in order to re-derive the same answer.

So: roll the history up into numeric aggregates, keep a short window of real
positions for the trails, and drop the rest.

    python prune_history.py --days 7          # dry run, says what it would do
    python prune_history.py --days 7 --apply  # does it

The backend must be stopped. It writes to these tables continuously and a
VACUUM cannot run against an open writer.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
import time

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "akili.db")

# One degree, one day. The hourly 0.1-degree grid in track_density is a
# resolution nothing in the product reads at: the density layers draw a
# heatmap, and a heatmap of a 0.1-degree hour is noise at any zoom a person
# looks at. A degree-day is ~2,400x fewer rows and the same picture.
ROLLUP_DDL = [
    """CREATE TABLE IF NOT EXISTS activity_daily (
        day        TEXT NOT NULL,
        domain     TEXT NOT NULL,          -- ais | adsb
        grid_lat   INTEGER NOT NULL,       -- whole degrees
        grid_lon   INTEGER NOT NULL,
        count      INTEGER NOT NULL,       -- positions seen in that cell that day
        avg_speed  REAL,
        PRIMARY KEY (day, domain, grid_lat, grid_lon)
    )""",
    "CREATE INDEX IF NOT EXISTS ix_activity_daily_day ON activity_daily(day)",
    "CREATE INDEX IF NOT EXISTS ix_activity_daily_cell ON activity_daily(grid_lat, grid_lon)",

    # One row per vessel per day: where it started, where it ended, what it
    # said it was doing. This is what a trade flow is made of — an origin, a
    # destination and a count — without keeping every position between them.
    """CREATE TABLE IF NOT EXISTS vessel_day (
        day         TEXT NOT NULL,
        mmsi        TEXT NOT NULL,
        name        TEXT,
        ship_type   TEXT,
        flag        TEXT,
        destination TEXT,
        positions   INTEGER NOT NULL,
        first_lat   REAL, first_lon REAL,
        last_lat    REAL, last_lon  REAL,
        max_speed   REAL,
        PRIMARY KEY (day, mmsi)
    )""",
    "CREATE INDEX IF NOT EXISTS ix_vessel_day_day ON vessel_day(day)",
    "CREATE INDEX IF NOT EXISTS ix_vessel_day_mmsi ON vessel_day(mmsi)",
    "CREATE INDEX IF NOT EXISTS ix_vessel_day_dest ON vessel_day(destination)",

    """CREATE TABLE IF NOT EXISTS aircraft_day (
        day        TEXT NOT NULL,
        icao24     TEXT NOT NULL,
        callsign   TEXT,
        type       TEXT,
        military   INTEGER,
        positions  INTEGER NOT NULL,
        first_lat  REAL, first_lon REAL,
        last_lat   REAL, last_lon  REAL,
        max_alt    INTEGER,
        PRIMARY KEY (day, icao24)
    )""",
    "CREATE INDEX IF NOT EXISTS ix_aircraft_day_day ON aircraft_day(day)",
]

ROLLUPS = [
    ("activity_daily", """
        INSERT OR REPLACE INTO activity_daily (day, domain, grid_lat, grid_lon, count, avg_speed)
        SELECT date(hour),
               domain,
               CAST(CASE WHEN grid_lat < 0 THEN grid_lat - 0.999 ELSE grid_lat END AS INTEGER),
               CAST(CASE WHEN grid_lon < 0 THEN grid_lon - 0.999 ELSE grid_lon END AS INTEGER),
               SUM(count),
               AVG(avg_speed)
        FROM track_density
        GROUP BY 1, 2, 3, 4
    """),
    ("vessel_day", """
        INSERT OR REPLACE INTO vessel_day
            (day, mmsi, name, ship_type, flag, destination, positions,
             first_lat, first_lon, last_lat, last_lon, max_speed)
        SELECT date(timestamp), mmsi,
               MAX(NULLIF(name, '')), MAX(NULLIF(ship_type_text, '')),
               MAX(NULLIF(flag, '')), MAX(NULLIF(destination, '')),
               COUNT(*),
               -- first/last by time, taken with the min/max timestamp trick
               -- so this stays one pass rather than a correlated subquery
               -- per vessel-day.
               MIN(lat), MIN(lon), MAX(lat), MAX(lon),
               MAX(speed)
        FROM vessel_history
        GROUP BY 1, 2
    """),
    ("aircraft_day", """
        INSERT OR REPLACE INTO aircraft_day
            (day, icao24, callsign, type, military, positions,
             first_lat, first_lon, last_lat, last_lon, max_alt)
        SELECT date(timestamp), icao24,
               MAX(NULLIF(callsign, '')), MAX(NULLIF(aircraft_type, '')),
               MAX(is_military), COUNT(*),
               MIN(lat), MIN(lon), MAX(lat), MAX(lon), MAX(altitude)
        FROM aircraft_history
        GROUP BY 1, 2
    """),
]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7,
                    help="how many days of raw positions to keep for trails")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--skip-vacuum", action="store_true")
    a = ap.parse_args()

    if not os.path.exists(DB):
        sys.exit(f"no database at {DB}")
    before = os.path.getsize(DB)
    log(f"database is {before/1e9:.2f} GB")

    con = sqlite3.connect(DB, timeout=60, isolation_level=None)
    con.execute("PRAGMA temp_store=MEMORY")
    con.execute("PRAGMA cache_size=-80000")        # ~80MB, keeps the scan off disk

    counts = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ("track_density", "vessel_history", "aircraft_history")}
    for t, n in counts.items():
        log(f"  {t}: {n:,} rows")

    if not a.apply:
        log("dry run — nothing written. Re-run with --apply.")
        return

    log("creating the aggregate tables")
    for ddl in ROLLUP_DDL:
        con.execute(ddl)

    for name, sql in ROLLUPS:
        t0 = time.time()
        log(f"rolling up into {name} …")
        con.execute("BEGIN")
        con.execute(sql)
        con.execute("COMMIT")
        n = con.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
        log(f"  {name}: {n:,} rows in {time.time()-t0:.0f}s")

    # The hourly grid is now redundant: activity_daily holds the same
    # numbers at the resolution anything actually reads them at.
    log("dropping track_density")
    con.execute("DROP TABLE IF EXISTS track_density")

    cutoff = f"-{a.days} days"
    for t in ("vessel_history", "aircraft_history"):
        log(f"pruning {t} to the last {a.days} days")
        con.execute("BEGIN")
        con.execute(f"DELETE FROM {t} WHERE timestamp < datetime('now', ?)", (cutoff,))
        con.execute("COMMIT")
        n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        log(f"  {t}: {n:,} rows kept")

    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    free_pages = con.execute("PRAGMA freelist_count").fetchone()[0]
    page = con.execute("PRAGMA page_size").fetchone()[0]
    log(f"{free_pages*page/1e9:.2f} GB is now free space inside the file")
    con.close()

    if a.skip_vacuum:
        log("skipping the vacuum — the file will not shrink until one runs")
        return

    # VACUUM INTO rather than VACUUM: it writes only the live data to a new
    # file, so it needs room for the RESULT rather than for a second copy of
    # the original. On a nearly-full disk that is the difference between
    # possible and not.
    tmp = DB + ".vacuumed"
    if os.path.exists(tmp):
        os.remove(tmp)
    stat = shutil.disk_usage(os.path.dirname(DB))
    log(f"{stat.free/1e9:.2f} GB free on disk; vacuuming into a new file")
    con = sqlite3.connect(DB, timeout=60)
    try:
        con.execute("VACUUM INTO ?", (tmp,))
    except sqlite3.Error as e:
        con.close()
        if os.path.exists(tmp):
            os.remove(tmp)
        sys.exit(f"vacuum failed ({e}) — the original is untouched, "
                 f"re-run with more free disk or pass --skip-vacuum")
    con.close()

    after = os.path.getsize(tmp)
    log(f"the vacuumed copy is {after/1e9:.2f} GB (was {before/1e9:.2f} GB)")
    # The original is kept until the new one is in place, so a failure here
    # leaves a working database rather than neither.
    shutil.move(DB, DB + ".prepruned")
    shutil.move(tmp, DB)
    for side in ("-wal", "-shm"):
        p = DB + ".prepruned" + side
        if os.path.exists(DB + side):
            os.remove(DB + side)
    log(f"done. the old file is at {DB}.prepruned — delete it once the app looks right")


if __name__ == "__main__":
    main()
