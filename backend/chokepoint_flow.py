"""
chokepoint_flow.py — is traffic through a chokepoint below its normal level?

activity_daily already holds the time series: AIS positions per day per 1°
cell. A chokepoint's baseline is its own trailing mean. This module reads
the cells under each chokepoint's polygon_bounds and says, per chokepoint,
how today compares with its previous fortnight — or why it cannot say.

THE RAW COUNT CANNOT BE USED. This backend records only while it runs, so
the global AIS total per day ranged from 5,900 to 6.2 million positions in
the first month, with whole days missing. A raw count against its trailing
mean measures uptime, and would call a laptop left closed a blockade. The
measure is therefore the chokepoint's SHARE of every AIS position observed
that day, which uptime scales top and bottom alike, and days whose global
total is under a quarter of the median are dropped as too thin to read.

A ZERO IS NOT A CLOSURE. aisstream is a volunteer network of shore
receivers. Over the first month it recorded no vessel at all in the Strait
of Hormuz box, though the subscription covers the Gulf: there are no
receivers in range. Such a chokepoint is reported as unmeasurable with that
reason, never as "traffic down 100%". The same goes for a baseline too
noisy to tell a change from its ordinary day-to-day swing.

ONLY COMPLETED DAYS. A day still in progress holds whichever hours were
recorded so far, and regional traffic peaks at local daytime, so a partial
day's share is biased by the clock. The current UTC day is excluded.

The unit is positions, not ships or transits, and the area is every 1° cell
the chokepoint's bounds touch, which includes approaches. Both are stated
in what this returns rather than rounded up into "vessel throughput".
"""
from __future__ import annotations

import math
import os
import sqlite3
import statistics

BASELINE_DAYS = 14
MIN_BASELINE_DAYS = 7
THIN_DAY_FRACTION = 0.25   # of the median global total
MAX_BASELINE_CV = 0.5      # day-to-day variation above which no change is called
MIN_MEAN_POSITIONS = 200   # per day in the box, below which a share is noise
CHANGE_SIGMA = 2.0
CHANGE_MIN_FRACTION = 0.15


def _db_path() -> str:
    try:
        from main import DATA_DIR
        return os.path.join(DATA_DIR, "akili.db")
    except Exception:
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "akili.db")


def cells_for_bounds(bounds) -> tuple[int, int, int, int]:
    """[south, west, north, east] -> the whole-degree cell range it touches.

    Cells are keyed by the floor of their corner (prune_history.py), so a
    north edge of exactly 27.0 does not pull in the 27° row.
    """
    s, w, n, e = bounds
    return (math.floor(s), math.floor(w),
            math.floor(n - 1e-9), math.floor(e - 1e-9))


def assess(name: str, box_by_day: dict, global_by_day: dict) -> dict:
    """One chokepoint's flow against its own baseline. Pure, for testing.

    box_by_day: day -> AIS positions in the chokepoint's cells.
    global_by_day: day -> AIS positions everywhere.
    """
    days_all = sorted(global_by_day)
    if not days_all:
        return _unmeasurable(name, [], "No AIS history recorded yet.")
    median = statistics.median(global_by_day.values())
    days = [d for d in days_all if global_by_day[d] >= THIN_DAY_FRACTION * median]
    series = [{"day": d, "positions": int(box_by_day.get(d, 0)),
               "share_pct": round(100.0 * box_by_day.get(d, 0) / global_by_day[d], 4)}
              for d in days]

    total = sum(box_by_day.get(d, 0) for d in days_all)
    if total == 0:
        return _unmeasurable(name, series,
            f"No AIS coverage: 0 positions recorded here in {len(days_all)} days. "
            "The receiver network has nothing in range, so a zero here is not a closure.")
    if len(days) < MIN_BASELINE_DAYS + 1:
        return _unmeasurable(name, series,
            f"Only {len(days)} days with enough feed to compare; "
            f"{MIN_BASELINE_DAYS + 1} are needed.")

    latest, base = series[-1], series[-1 - BASELINE_DAYS:-1]
    shares = [p["share_pct"] for p in base]
    mean = statistics.mean(shares)
    sd = statistics.pstdev(shares)
    mean_positions = statistics.mean(p["positions"] for p in base)
    if mean_positions < MIN_MEAN_POSITIONS:
        return _unmeasurable(name, series,
            f"Too little traffic observed to compare: {mean_positions:.1f} positions a day on average "
            f"over the previous {len(base)} days.")
    cv = sd / mean if mean else float("inf")
    if cv > MAX_BASELINE_CV:
        return _unmeasurable(name, series,
            f"Too variable to call a change: its daily share swings by {cv:.0%} "
            f"over the previous {len(base)} days.")

    change = latest["share_pct"] / mean - 1.0
    if abs(latest["share_pct"] - mean) > CHANGE_SIGMA * sd and abs(change) >= CHANGE_MIN_FRACTION:
        verdict = "below normal" if change < 0 else "above normal"
    else:
        verdict = "within normal range"
    direction = "below" if change < 0 else "above"
    summary = (f"{name}: {latest['share_pct']:.2f}% of observed AIS positions on {latest['day']}, "
               f"against {mean:.2f}% over the previous {len(base)} days "
               f"({abs(change):.0%} {direction}; {verdict}).")
    return {
        "name": name, "measurable": True, "verdict": verdict,
        "day": latest["day"], "share_pct": latest["share_pct"],
        "positions": latest["positions"],
        "baseline_share_pct": round(mean, 4), "baseline_days": len(base),
        "baseline_cv": round(cv, 3), "change_pct": round(100 * change, 1),
        "summary": summary, "series": series,
        "unit": "AIS positions in the 1° cells the chokepoint touches",
    }


def _unmeasurable(name: str, series: list, reason: str) -> dict:
    return {"name": name, "measurable": False, "verdict": None,
            "summary": f"{name}: {reason}", "reason": reason, "series": series,
            "unit": "AIS positions in the 1° cells the chokepoint touches"}


def chokepoint_flows(defs: list, path: str | None = None, days: int = 45) -> dict:
    """name -> assess() for every chokepoint with polygon_bounds."""
    con = sqlite3.connect(f"file:{path or _db_path()}?mode=ro", uri=True, timeout=30)
    try:
        cutoff, today = con.execute("SELECT date('now', ?), date('now')", (f"-{days} days",)).fetchone()
        global_by_day = dict(con.execute(
            "SELECT day, SUM(count) FROM activity_daily "
            "WHERE domain = 'ais' AND day >= ? AND day < ? GROUP BY day", (cutoff, today)))
        out = {}
        for cp in defs:
            bounds = cp.get("polygon_bounds")
            if not bounds or len(bounds) != 4:
                continue
            s, w, n, e = cells_for_bounds(bounds)
            box = dict(con.execute(
                "SELECT day, SUM(count) FROM activity_daily "
                "WHERE domain = 'ais' AND day >= ? AND day < ? "
                "AND grid_lat BETWEEN ? AND ? AND grid_lon BETWEEN ? AND ? GROUP BY day",
                (cutoff, today, s, n, w, e)))
            out[cp["name"]] = assess(cp["name"], box, global_by_day)
        return out
    finally:
        con.close()
