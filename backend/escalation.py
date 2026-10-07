"""
escalation.py — is violence in a country rising against its own normal?

"Likelihood of intensification up x%" needs a baseline, and the live GDELT
store keeps one day. GDELT publishes a file per day going back years
(data.gdeltproject.org/events/YYYYMMDD.export.CSV.zip, ~3.5 MB), so this
rolls those into conflict_daily: per country (ISO3, via country_codes'
FIPS table — GDELT's country field is FIPS, not ISO) per day, the ROOT
events in CAMEO roots 18 assault, 19 fight, 20 mass violence ("violent"),
and 14 protest, kept apart.

THE MEASURE IS A SHARE, NOT A COUNT. GDELT's daily volume swings with the
news cycle, so a raw count against its mean measures the media. Each
country's share of the world's violent events is compared, last 3 days
against the previous 28: change in %, and how many standard deviations of
its own day-to-day share that is. Escalating = up at least 40% AND at
least 2 sd AND a baseline of at least 3 events a day — a country going
from 1 event to 3 is noise, not news.

    python3 escalation.py backfill 35     # fetch missing days
"""
from __future__ import annotations

import csv
import datetime as _dt
import io
import os
import sqlite3
import statistics
import sys
import urllib.request
import zipfile

URL = "http://data.gdeltproject.org/events/{d}.export.CSV.zip"
VIOLENT = {"18", "19", "20"}
PROTEST = {"14"}
RECENT_DAYS = 3
BASELINE_DAYS = 28
MIN_BASELINE_PER_DAY = 5.0
MIN_CHANGE = 0.40
MIN_SIGMA = 2.0

DDL = """CREATE TABLE IF NOT EXISTS conflict_daily (
    day TEXT NOT NULL, iso3 TEXT NOT NULL,
    violent INTEGER NOT NULL, protest INTEGER NOT NULL, mentions INTEGER NOT NULL,
    PRIMARY KEY (day, iso3))"""


def _db_path() -> str:
    from paths import DB_PATH
    return str(DB_PATH)


def _con():
    con = sqlite3.connect(_db_path(), timeout=60)
    con.execute(DDL)
    return con


def parse_day(raw_zip: bytes) -> dict[str, list[int]]:
    """iso3 -> [violent, protest, mentions] for one GDELT daily export."""
    from country_codes import from_fips
    out: dict[str, list[int]] = {}
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as z:
        with z.open(z.namelist()[0]) as fh:
            for row in csv.reader(io.TextIOWrapper(fh, "utf-8", errors="replace"), delimiter="\t"):
                if len(row) < 52 or row[25] != "1":          # root events only
                    continue
                root = row[28]
                if root not in VIOLENT and root not in PROTEST:
                    continue
                iso = from_fips(row[51])
                if not iso:
                    continue
                c = out.setdefault(iso, [0, 0, 0])
                c[0 if root in VIOLENT else 1] += 1
                try:
                    c[2] += int(row[31] or 0)
                except ValueError:
                    pass
    return out


def backfill(days: int = 35) -> int:
    con = _con()
    have = {r[0] for r in con.execute("SELECT DISTINCT day FROM conflict_daily")}
    today = _dt.datetime.now(_dt.timezone.utc).date()
    got = 0
    for k in range(1, days + 1):          # yesterday back: today's file is not complete
        d = today - _dt.timedelta(days=k)
        if d.isoformat() in have:
            continue
        try:
            raw = urllib.request.urlopen(URL.format(d=d.strftime("%Y%m%d")), timeout=60).read()
        except Exception as e:
            print(f"[escalation] {d}: {type(e).__name__}: {e}", flush=True)
            continue
        rows = parse_day(raw)
        con.executemany("INSERT OR REPLACE INTO conflict_daily VALUES (?,?,?,?,?)",
                        [(d.isoformat(), iso, v, p, m) for iso, (v, p, m) in rows.items()])
        con.commit()
        got += 1
    con.close()
    return got


def assess(by_day: dict[str, int], world_by_day: dict[str, int]) -> dict | None:
    """One country's escalation, from its daily violent counts and the
    world's. Pure, for testing. None when the history is too short."""
    days = sorted(d for d in world_by_day if world_by_day[d] > 0)
    if len(days) < RECENT_DAYS + 14:
        return None
    recent, base = days[-RECENT_DAYS:], days[-(RECENT_DAYS + BASELINE_DAYS):-RECENT_DAYS]
    share = lambda d: by_day.get(d, 0) / world_by_day[d]
    base_shares = [share(d) for d in base]
    mean, sd = statistics.mean(base_shares), statistics.pstdev(base_shares)
    base_per_day = statistics.mean(by_day.get(d, 0) for d in base)
    recent_share = statistics.mean(share(d) for d in recent)
    if mean <= 0:
        return None
    change = recent_share / mean - 1
    sigma = (recent_share - mean) / sd if sd > 0 else 0.0
    return {
        "change_pct": round(change * 100), "sigma": round(sigma, 1),
        "recent_per_day": round(statistics.mean(by_day.get(d, 0) for d in recent), 1),
        "baseline_per_day": round(base_per_day, 1),
        "escalating": change >= MIN_CHANGE and sigma >= MIN_SIGMA and base_per_day >= MIN_BASELINE_PER_DAY,
        "series": [{"day": d, "events": by_day.get(d, 0)} for d in base + recent],
        "window": {"recent": [recent[0], recent[-1]], "baseline": [base[0], base[-1]]},
    }


def escalations(limit: int = 12) -> dict:
    con = _con()
    rows = con.execute("SELECT day, iso3, violent FROM conflict_daily WHERE day >= date('now', '-40 days')").fetchall()
    con.close()
    world: dict[str, int] = {}
    per: dict[str, dict[str, int]] = {}
    for day, iso, v in rows:
        world[day] = world.get(day, 0) + v
        per.setdefault(iso, {})[day] = v
    from country_codes import name_of
    out = []
    for iso, by_day in per.items():
        a = assess(by_day, world)
        if a and a["baseline_per_day"] >= MIN_BASELINE_PER_DAY:
            out.append({"iso3": iso, "country": name_of(iso), **a})
    out.sort(key=lambda x: (not x["escalating"], -x["change_pct"]))
    return {"days": len(world), "countries": out[:limit],
            "rule": f"violent-event share, last {RECENT_DAYS} days vs previous {BASELINE_DAYS}; "
                    f"escalating = +{int(MIN_CHANGE*100)}% and {MIN_SIGMA:g} sd, baseline >= {MIN_BASELINE_PER_DAY:g}/day",
            "source": "GDELT 1.0 daily events, CAMEO roots 18-20"}


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "backfill":
        print("fetched", backfill(int(sys.argv[2]) if len(sys.argv) > 2 else 35), "days")
    r = escalations()
    print(r["days"], "days")
    for c in r["countries"]:
        print(f"  {c['country']:28} {c['change_pct']:+5d}%  {c['sigma']:+.1f}sd  {c['recent_per_day']}/d vs {c['baseline_per_day']}/d  {'ESCALATING' if c['escalating'] else ''}")
