"""
activity_rollup.py — keep the long-term activity record (activity_daily)
growing.

activity_daily (day × domain × 1° cell → positions seen, average speed) is
the long-term numeric record of where ships and aircraft were. It was
written once, by the 2026-10-05 clean-up (prune_history.py), and by nothing
after — so it ended on 5 October while track_density kept the hourly cells
for its 30-day retention. Found 2026-10-10 building the Analytics page.

Every completed day missing from activity_daily is rolled up from
track_density, one transaction per day, a week at most per call; called from
the history-maintenance pass (main._prune_history_once, worker process).
"""
from __future__ import annotations

import datetime as _dt
import sqlite3

SQL = """
    INSERT OR REPLACE INTO activity_daily (day, domain, grid_lat, grid_lon, count, avg_speed)
    SELECT date(hour), domain,
           CAST(CASE WHEN grid_lat < 0 THEN grid_lat - 0.999 ELSE grid_lat END AS INTEGER),
           CAST(CASE WHEN grid_lon < 0 THEN grid_lon - 0.999 ELSE grid_lon END AS INTEGER),
           SUM(count), AVG(avg_speed)
    FROM track_density
    WHERE hour >= ? AND hour < ?
    GROUP BY 1, 2, 3, 4
"""


def roll_missing_days(db_path: str, max_days: int = 7, today: _dt.date | None = None) -> list[str]:
    today = today or _dt.datetime.now(_dt.timezone.utc).date()
    con = sqlite3.connect(db_path, timeout=60)
    try:
        last = con.execute("SELECT max(day) FROM activity_daily").fetchone()[0]
        first_td = con.execute("SELECT min(hour) FROM track_density").fetchone()[0]
        if not first_td:
            return []
        start = _dt.date.fromisoformat(str(first_td)[:10])
        if last:
            start = max(start, _dt.date.fromisoformat(last) + _dt.timedelta(days=1))
        done = []
        d = start
        while d < today and len(done) < max_days:          # completed days only
            nxt = d + _dt.timedelta(days=1)
            con.execute(SQL, (d.isoformat(), nxt.isoformat()))
            con.commit()
            done.append(d.isoformat())
            d = nxt
        return done
    finally:
        con.close()
