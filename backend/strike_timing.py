"""
strike_timing.py — the quiet indicators that come before a strike.

The owner's observation (2026-10-10): major US strikes tend to start on a
Friday, and late-night activity around the Pentagon goes up before them.
Neither is a forecast; both are things an analyst glances at. So this is a
panel, never a notification, and every indicator says what it measured,
against what, and whether that is unusual.

  1. The week. Opening strikes of major US and Israeli operations since 1998
     (OPENINGS below, public record), by day at the target: how many began
     between Thursday evening and Saturday, and where today sits.
  2. US tankers airborne now (KC-135, KC-46, KC-10), against the median of
     each hour over the last day. Tankers go up before strike packages do.
  3. Command, control and reconnaissance aircraft airborne: E-4B, E-6B,
     RC-135, E-3, RQ-4, P-8 — listed by callsign.
  4. Military flights near Washington overnight (22:00–05:00 Eastern, within
     60 km of the Pentagon) against earlier nights.
  5. Heavy airlift (C-17, C-5) seen in the last 24 hours against earlier days.
  Raw positions are kept for 24 hours only, so 4 and 5 keep their own daily
  record (strike_indicator_days) and say "baseline still building" until it
  holds three days; until then they are never marked elevated.

US military aircraft are those with ICAO addresses AE0000–AFFFFF. The
"pizza" signal itself — how busy the restaurants near the Pentagon are —
has no legitimate feed: Google's popular-times data has no API and scraping
it is against its terms, so it is not used.
"""
from __future__ import annotations

import datetime as _dt
import sqlite3
import statistics
from zoneinfo import ZoneInfo

# Opening strikes: date and hour at the target (local), place. Public record.
OPENINGS = [
    ("1998-08-20T19:30", "Asia/Kabul", "Operation Infinite Reach (Afghanistan, Sudan)"),
    ("1998-12-16T23:00", "Asia/Baghdad", "Operation Desert Fox (Iraq)"),
    ("2001-10-07T21:00", "Asia/Kabul", "Operation Enduring Freedom (Afghanistan)"),
    ("2003-03-20T05:30", "Asia/Baghdad", "Invasion of Iraq"),
    ("2011-03-19T21:00", "Africa/Tripoli", "Operation Odyssey Dawn (Libya)"),
    ("2014-09-23T03:00", "Asia/Damascus", "First US strikes on ISIS in Syria"),
    ("2017-04-07T04:40", "Asia/Damascus", "Shayrat airbase strike (Syria)"),
    ("2018-04-14T04:00", "Asia/Damascus", "US, UK and French strikes on Syria"),
    ("2020-01-03T01:00", "Asia/Baghdad", "Strike on Qasem Soleimani (Baghdad)"),
    ("2024-01-12T02:30", "Asia/Aden", "US and UK strikes on the Houthis"),
    ("2024-02-02T23:00", "Asia/Baghdad", "US strikes in Iraq and Syria"),
    ("2024-04-19T04:00", "Asia/Tehran", "Israeli strike near Isfahan"),
    ("2024-09-27T18:20", "Asia/Beirut", "Israeli strike killing Hassan Nasrallah"),
    ("2024-10-26T02:00", "Asia/Tehran", "Israeli strikes on Iran"),
    ("2025-03-15T19:00", "Asia/Aden", "US campaign against the Houthis"),
    ("2025-06-13T03:00", "Asia/Tehran", "Israeli strikes on Iran (twelve-day war)"),
    ("2025-06-22T02:30", "Asia/Tehran", "US strikes on Fordow, Natanz and Isfahan"),
]

TANKERS = {"K35R", "K35E", "K46", "KC46", "DC10", "KC10"}
C2ISR = {"B742": "E-4B", "E6": "E-6B", "R135": "RC-135", "E3TF": "E-3", "E3CF": "E-3", "Q4": "RQ-4",
         "P8": "P-8", "E8": "E-8"}
AIRLIFT = {"C17", "C5", "C5M"}
PENTAGON = (38.8719, -77.0563)
EASTERN = ZoneInfo("America/New_York")


def us_military(icao: str | None) -> bool:
    try:
        return 0xAE0000 <= int(str(icao or ""), 16) <= 0xAFFFFF
    except ValueError:
        return False


def in_window(local: _dt.datetime) -> bool:
    """Thursday 18:00 to Saturday 23:59 at the target."""
    wd, h = local.weekday(), local.hour        # Mon 0 … Sun 6
    return (wd == 3 and h >= 18) or wd in (4, 5)


def week_pattern(now: _dt.datetime) -> dict:
    hits = []
    for when, tz, what in OPENINGS:
        local = _dt.datetime.fromisoformat(when)
        hits.append({"what": what, "date": when[:10], "weekday": local.strftime("%A"), "in_window": in_window(local)})
    k = sum(h["in_window"] for h in hits)
    gulf = now.astimezone(ZoneInfo("Asia/Riyadh"))
    inside = in_window(gulf)
    return {
        "id": "week", "label": "The week",
        "value": f"{k} of {len(hits)}", "elevated": inside,
        "text": (f"{k} of the {len(hits)} opening strikes in the reference list began between Thursday evening and "
                 f"Saturday at the target. Now: {gulf.strftime('%A %H:%M')} Gulf time — "
                 f"{'inside' if inside else 'outside'} that window."),
        "detail": hits,
    }


MIN_BASELINE_DAYS = 3


def _remember(con, day: str, key: str, value: int) -> None:
    """Keep the day's highest reading; the raw positions behind it are gone
    after 24 hours, so this record is the only baseline there is."""
    con.execute("CREATE TABLE IF NOT EXISTS strike_indicator_days (day TEXT NOT NULL, key TEXT NOT NULL,"
                " value INTEGER NOT NULL, PRIMARY KEY (day, key))")
    con.execute("INSERT INTO strike_indicator_days (day, key, value) VALUES (?,?,?)"
                " ON CONFLICT(day, key) DO UPDATE SET value=MAX(value, excluded.value)", (day, key, value))
    con.commit()


def _baseline(con, key: str, before_day: str, days: int = 28):
    """Median of the earlier days, or None until there are enough of them."""
    since = (_dt.date.fromisoformat(before_day) - _dt.timedelta(days=days)).isoformat()
    vals = [v for (v,) in con.execute("SELECT value FROM strike_indicator_days WHERE key=? AND day < ? AND day >= ?",
                                      (key, before_day, since)).fetchall()]
    return (statistics.median(vals), len(vals)) if len(vals) >= MIN_BASELINE_DAYS else (None, len(vals))


def _hist(con, since: str):
    """Only the rows the indicators read: US military addresses (the
    (icao24, timestamp) index serves the range) of the types watched, or
    anywhere near Washington. Reading every position of the last 40 hours
    into Python took over a minute on the production database."""
    types = sorted(TANKERS | set(C2ISR) | AIRLIFT)
    marks = ",".join("?" * len(types))
    return con.execute(
        "SELECT icao24, callsign, aircraft_type, lat, lon, timestamp FROM aircraft_history"
        " WHERE icao24 >= 'ae0000' AND icao24 <= 'afffff' AND timestamp >= ?"
        f" AND (UPPER(aircraft_type) IN ({marks}) OR (lat BETWEEN 38.3 AND 39.45 AND lon BETWEEN -77.8 AND -76.3))",
        [since, *types]).fetchall()


def tankers(rows, now: _dt.datetime) -> dict:
    by_hour: dict[str, set] = {}
    for icao, cs, typ, lat, lon, ts in rows:
        if (typ or "").upper() in TANKERS and us_military(icao):
            by_hour.setdefault(str(ts)[:13], set()).add(icao)
    cur_key = now.strftime("%Y-%m-%d %H")
    prev_key = (now - _dt.timedelta(hours=1)).strftime("%Y-%m-%d %H")
    current = len(by_hour.get(cur_key, set()) | by_hour.get(prev_key, set()))
    past = [len(v) for k, v in by_hour.items() if k not in (cur_key, prev_key)]
    base = statistics.median(past) if past else None
    elevated = base is not None and current >= max(3, 1.5 * base)
    return {"id": "tankers", "label": "US tankers airborne", "value": str(current),
            "baseline": base, "elevated": elevated,
            "text": (f"{current} US tankers seen in the last two hours" +
                     (f"; the hourly median over the last day is {base:g}." if base is not None else "; no baseline yet."))}


def c2isr(rows, now: _dt.datetime) -> dict:
    cutoff = (now - _dt.timedelta(minutes=45)).strftime("%Y-%m-%d %H:%M:%S")
    seen = {}
    for icao, cs, typ, lat, lon, ts in rows:
        name = C2ISR.get((typ or "").upper())
        if name and us_military(icao) and str(ts) >= cutoff:
            seen[icao] = {"type": name, "callsign": (cs or "").strip() or icao, "lat": lat, "lon": lon}
    flag = any(v["type"] in ("E-4B", "E-6B") for v in seen.values())
    names = ", ".join(f"{v['type']} {v['callsign']}" for v in list(seen.values())[:6])
    return {"id": "c2isr", "label": "Command and reconnaissance aircraft", "value": str(len(seen)), "elevated": flag,
            "text": (f"Airborne now: {names}." if seen else "None of the E-4B, E-6B, RC-135, E-3, RQ-4 or P-8 seen in the last 45 minutes.")
                    + (" An E-4B or E-6B (nuclear command aircraft) is up." if flag else ""),
            "detail": list(seen.values())}


def _km(a, b):
    import math
    r = math.radians
    h = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def washington_nights(con, rows, now: _dt.datetime) -> dict:
    """Military aircraft within 60 km of the Pentagon, 22:00–05:00 Eastern,
    last night, against earlier nights in the record."""
    local_now = now.astimezone(EASTERN)
    end = local_now.replace(hour=5, minute=0, second=0, microsecond=0)
    if local_now < end:
        end -= _dt.timedelta(days=1)
    start = end - _dt.timedelta(hours=7)
    ids = set()
    for icao, cs, typ, lat, lon, ts in rows:
        if lat is None or not us_military(icao):
            continue
        try:
            t = _dt.datetime.fromisoformat(str(ts)).replace(tzinfo=_dt.timezone.utc).astimezone(EASTERN)
        except ValueError:
            continue
        if start <= t < end and _km(PENTAGON, (lat, lon)) <= 60:
            ids.add(icao)
    night = end.date().isoformat()
    last = len(ids)
    _remember(con, night, "washington_night", last)
    base, n = _baseline(con, "washington_night", night)
    return {"id": "washington", "label": "Night flights near Washington", "value": str(last), "baseline": base,
            "elevated": base is not None and last >= max(4, 2 * base),
            "text": f"{last} US military aircraft within 60 km of the Pentagon last night (22:00–05:00 Eastern)"
                    + (f"; median {base:g} over the {n} nights before." if base is not None else f"; baseline still building ({n} of {MIN_BASELINE_DAYS} nights recorded).")}


def airlift(con, rows, now: _dt.datetime) -> dict:
    """US C-17s and C-5s seen in the last 24 hours, against earlier days in
    the record."""
    today = now.strftime("%Y-%m-%d")
    since = (now - _dt.timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
    t = len({icao for icao, cs, typ, lat, lon, ts in rows
             if str(ts) >= since and (typ or "").upper() in AIRLIFT and us_military(icao)})
    _remember(con, today, "airlift", t)
    base, n = _baseline(con, "airlift", today)
    return {"id": "airlift", "label": "Heavy airlift (C-17, C-5)", "value": str(t), "baseline": base,
            "elevated": base is not None and t >= max(5, 1.5 * base),
            "text": f"{t} US C-17s and C-5s seen in the last 24 hours"
                    + (f"; median {base:g} a day over the {n} days before." if base is not None else f"; baseline still building ({n} of {MIN_BASELINE_DAYS} days recorded).")}


def indicators(db_path: str, now: _dt.datetime | None = None) -> dict:
    now = now or _dt.datetime.now(_dt.timezone.utc)
    out = [week_pattern(now)]
    con = sqlite3.connect(db_path, timeout=10)
    try:
        rows = _hist(con, (now - _dt.timedelta(hours=40)).strftime("%Y-%m-%d %H:%M:%S"))
        naive_now = now.replace(tzinfo=None) if now.tzinfo else now
        out += [tankers(rows, naive_now), c2isr(rows, naive_now), washington_nights(con, rows, now), airlift(con, rows, naive_now)]
    finally:
        con.close()
    up = [i["label"] for i in out if i["elevated"]]
    return {"generated_at": now.isoformat(), "indicators": out, "elevated": len(up),
            "summary": (f"{len(up)} of {len(out)} indicators elevated: {', '.join(up)}." if up else f"None of the {len(out)} indicators is elevated."),
            "note": "Indicators, not a forecast; shown quietly and never notified."}


# A reading is kept and served; a page view never waits on the database.
import threading as _threading
import time as _time
_cache: dict = {"at": 0.0, "data": None}
_refreshing = _threading.Lock()
FRESH_S = 300


def cached(db_path: str) -> dict:
    """The last reading; refreshed in the background once it is five
    minutes old. Only the very first call computes inline."""
    if _cache["data"] is None:
        _cache.update(at=_time.time(), data=indicators(db_path))
    elif _time.time() - _cache["at"] > FRESH_S and _refreshing.acquire(blocking=False):
        def _run():
            try:
                _cache.update(at=_time.time(), data=indicators(db_path))
            finally:
                _refreshing.release()
        _threading.Thread(target=_run, name="strike-timing", daemon=True).start()
    return _cache["data"]
