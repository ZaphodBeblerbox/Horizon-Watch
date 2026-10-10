"""
analytics_dashboard.py — the Analytics page's numbers (owner, 2026-10-10:
"a full new analytics page … graphs to visualise everything").

Everything is counted in SQL and kept for five minutes per view (range,
country, kind): the production database is 42 GB on a network volume, and a
page that recounted 355,000 alerts on every visit would be the slowest thing
in the console. A stale view is served while a fresh one is built.

Severity is folded to the console's four bands; alert types get the names
an analyst would use. Nothing here is modelled — it is what was recorded.
"""
from __future__ import annotations

import datetime as _dt
import sqlite3
import threading
import time

TTL_S = 300
_cache: dict = {}
_lock = threading.Lock()

BAND = {"critical": "critical", "high": "high", "significant": "high", "medium": "moderate", "moderate": "moderate",
        "elevated": "moderate", "low": "low", "info": "low"}
KIND_LABEL = {
    "AIS_DARK_SHIP": "Dark ships (AIS switched off)", "gps_interference": "GPS interference",
    "military_aircraft": "Military aircraft", "Sanctioned Vessel": "Sanctioned vessels",
    "Sanctioned Vessel (Possible)": "Possible sanctioned vessels", "geoconfirmed_event": "Confirmed events (GeoConfirmed)",
    "AIS_CHOKEPOINT_ACTIVITY": "Chokepoint activity", "AIS_POSITION_JUMP": "AIS position jumps (spoofing)",
    "surge_velocity_spike": "Surges (speed)", "surge_volume_surge": "Surges (volume)", "imminence": "Imminence",
    "Heat": "Heat (thermal anomalies)", "Imagery signal": "Imagery signals",
}


def kind_label(k: str | None) -> str:
    k = k or "unknown"
    return KIND_LABEL.get(k) or k.replace("_", " ").strip().capitalize()


def _days(n: int, end: _dt.date) -> list[str]:
    return [(end - _dt.timedelta(days=n - 1 - i)).isoformat() for i in range(n)]


def _iso2(c) -> str | None:
    """Alerts store "ua", "UKRAINE" and "russia" in the same column: one key."""
    c = (c or "").strip()
    if not c:
        return None
    if len(c) == 2:
        return c.lower()
    return _names_to_iso2().get(c.lower())


_N2C: dict | None = None


def _names_to_iso2() -> dict:
    """Every country name (and alias) → ISO2, from the shipped 191-country
    table and location_extract's aliases."""
    global _N2C
    if _N2C is None:
        out = {}
        try:
            import location_extract as le
            for code, name in le._iso_names().items():
                if len(code) == 2:
                    out[name.lower()] = code
            for code, name in le._iso_names().items():
                if len(code) == 3 and name.lower() in out:
                    out[code] = out[name.lower()]
            for alias, code in getattr(le, "_COUNTRY_ALIAS_TO_CODE", {}).items():
                if code and len(code) == 2:
                    out.setdefault(alias.lower(), code.lower())
            for alias, name in getattr(le, "_COUNTRY_ALIASES", {}).items():
                if name.lower() in out:
                    out.setdefault(alias.lower(), out[name.lower()])
        except Exception:                                      # noqa: BLE001
            pass
        _N2C = out
    return _N2C


def _country_name(cc):
    try:
        from location_extract import country_name_from_code
        return country_name_from_code(cc) or (cc or "").upper()
    except Exception:                                          # noqa: BLE001
        return (cc or "").upper()


DDL = """CREATE TABLE IF NOT EXISTS alert_daily (
    day TEXT NOT NULL, severity TEXT NOT NULL, kind TEXT NOT NULL, cc TEXT NOT NULL, n INTEGER NOT NULL,
    PRIMARY KEY (day, severity, kind, cc))"""


def refresh_daily(db_path: str, keep_days: int = 92, max_new_days: int = 5, today: _dt.date | None = None) -> list[str]:
    """Keep alert_daily (day × severity × kind × country → count) current:
    today and yesterday recounted every call, older days once, a few per
    call — each day is one indexed range, so a backfill never holds the
    write lock for long. The Analytics page reads only this table."""
    today = today or _dt.datetime.now(_dt.timezone.utc).date()
    con = sqlite3.connect(db_path, timeout=60)
    try:
        con.execute(DDL)
        have = {r[0] for r in con.execute("SELECT DISTINCT day FROM alert_daily")}
        want = [(today - _dt.timedelta(days=i)).isoformat() for i in range(keep_days)]
        todo = [d for d in want[:2]] + [d for d in want[2:] if d not in have][:max_new_days]
        for d in todo:
            nxt = (_dt.date.fromisoformat(d) + _dt.timedelta(days=1)).isoformat()
            rows = con.execute("SELECT lower(coalesce(severity,'')), coalesce(alert_type,'unknown'), coalesce(country_code,''), count(*)"
                               " FROM alerts WHERE created_at >= ? AND created_at < ? GROUP BY 1, 2, 3", (d, nxt)).fetchall()
            folded: dict = {}
            for sev, kind, c, n in rows:
                key = (BAND.get(sev, "moderate"), kind, _iso2(c) or "")
                folded[key] = folded.get(key, 0) + n
            con.execute("DELETE FROM alert_daily WHERE day = ?", (d,))
            # a day with no alerts still counts as done
            con.executemany("INSERT INTO alert_daily VALUES (?,?,?,?,?)",
                            [(d, b, k, c, n) for (b, k, c), n in folded.items()] or [(d, "", "", "", 0)])
            con.commit()
        con.execute("DELETE FROM alert_daily WHERE day < ?", (want[-1],))
        con.commit()
        return todo
    finally:
        con.close()


def build(db_path: str, days: int = 30, country: str | None = None, kind: str | None = None,
          today: _dt.date | None = None) -> dict:
    today = today or _dt.datetime.now(_dt.timezone.utc).date()
    span = _days(days, today)
    since, prev_since = span[0], (today - _dt.timedelta(days=2 * days - 1)).isoformat()
    con = sqlite3.connect(db_path, timeout=30)
    con.row_factory = sqlite3.Row
    try:
        # From the daily summary (refresh_daily), not the 355,000-row
        # alerts table: any filter answers in milliseconds.
        try:
            con.execute(DDL)
        except sqlite3.OperationalError:
            pass
        where, args = ["day >= ?"], [prev_since]
        if kind:
            where.append("kind = ?"); args.append(kind)
        if country:
            where.append("cc = ?"); args.append(country.lower())
        rows = con.execute(f"SELECT day d, severity s, kind k, cc c, n FROM alert_daily WHERE {' AND '.join(where)}", args).fetchall()
        per_day = {d: {"critical": 0, "high": 0, "moderate": 0, "low": 0} for d in span}
        kinds_n, countries_n = {}, {}
        prev_total = prev_crit = 0
        for r in rows:
            if r["d"] < since:
                prev_total += r["n"]; prev_crit += r["n"] if r["s"] == "critical" else 0
                continue
            if not r["n"]:
                continue                                       # an empty day's marker
            if r["d"] in per_day:
                per_day[r["d"]][r["s"]] = per_day[r["d"]].get(r["s"], 0) + r["n"]
            kinds_n[r["k"]] = kinds_n.get(r["k"], 0) + r["n"]
            if r["c"]:
                countries_n[r["c"]] = countries_n.get(r["c"], 0) + r["n"]
        covered = {r["d"] for r in rows}
        total = sum(sum(v.values()) for v in per_day.values())
        critical = sum(v["critical"] for v in per_day.values())
        # a comparison only where the period before is actually recorded
        prev = (prev_total, prev_crit) if any(d < since for d in covered) else (0, 0)
        kinds = [{"key": k, "label": kind_label(k), "value": n} for k, n in sorted(kinds_n.items(), key=lambda x: -x[1])[:14]]
        countries = [{"key": c, "label": _country_name(c), "value": n} for c, n in sorted(countries_n.items(), key=lambda x: -x[1])[:15]]

        # ships and aircraft observed per day (the long-term activity record)
        act = {d: {"ais": 0, "adsb": 0} for d in span}
        try:
            for r in con.execute("SELECT day, domain, sum(count) n FROM activity_daily WHERE day >= ? GROUP BY day, domain", (since,)):
                if r["day"] in act and r["domain"] in act[r["day"]]:
                    act[r["day"]][r["domain"]] = r["n"]
        except sqlite3.OperationalError:
            pass

        # fusions per day
        fus = {d: 0 for d in span}
        fwhere, fargs = "created_at >= ?", [since]
        if country:
            fwhere += " AND lower(location_country) IN (?, ?)"
            fargs += [country.lower(), _country_name(country).lower()]
        try:
            for r in con.execute(f"SELECT substr(created_at,1,10) d, count(*) n FROM fusion_events WHERE {fwhere} GROUP BY d", fargs):
                if r["d"] in fus:
                    fus[r["d"]] = r["n"]
        except sqlite3.OperationalError:
            pass

        # Telegram per day, by what kind of event; busiest channels
        tg_types = ["strike", "attack", "clash", "movement", "unrest", "other"]
        tg = {d: {t: 0 for t in tg_types} for d in span}
        channels = []
        twhere, targs = "posted_at >= ? AND relevant = 1", [since]
        if country:
            twhere += " AND lower(country_code) = ?"; targs.append(country.lower())
        try:
            for r in con.execute(f"SELECT substr(posted_at,1,10) d, event_type e, count(*) n FROM telegram_posts WHERE {twhere} GROUP BY d, e", targs):
                if r["d"] in tg:
                    e = r["e"] if r["e"] in tg_types else "other"
                    tg[r["d"]][e] += r["n"]
            channels = [{"key": r["c"], "label": r["t"] or r["c"], "value": r["n"]}
                        for r in con.execute(f"SELECT channel c, max(channel_title) t, count(*) n FROM telegram_posts WHERE {twhere}"
                                             " GROUP BY c ORDER BY n DESC LIMIT 10", targs)]
        except sqlite3.OperationalError:
            pass
    finally:
        con.close()

    # forecasts: what was said, and how it turned out
    forecasts = None
    try:
        import outlook_store
        fc = sqlite3.connect(outlook_store._path(), timeout=10)
        rows = fc.execute("SELECT outcome, count(*) FROM outlook_forecasts GROUP BY outcome").fetchall()
        fc.close()
        f = dict(rows)
        resolved = f.get("happened", 0) + f.get("did_not", 0)
        forecasts = {"made": sum(f.values()), "open": f.get("open", 0), "happened": f.get("happened", 0),
                     "did_not": f.get("did_not", 0), "void": f.get("void", 0), "resolved": resolved}
    except Exception:                                          # noqa: BLE001
        pass

    # the wars: reports per day (conflict_context's own count)
    wars = []
    try:
        import conflict_context as cc
        for c in cc.conflicts():
            series = c.get("daily") or []
            n = sum(x["n"] for x in series)
            if n and (not country or country.lower() in (c.get("countries") or [])):
                wars.append({"id": c["id"], "name": c["name"], "trend": c.get("trend"), "n": n, "center": c.get("center"),
                             "days": [{"date": x["date"], "n": x["n"]} for x in series]})
        wars.sort(key=lambda w: -w["n"])
    except Exception:                                          # noqa: BLE001
        pass

    def delta(now, before):
        return None if not before else round(100 * (now - before) / before)

    tg_total = sum(sum(v.values()) for v in tg.values())
    return {
        "days": days, "country": country, "country_name": _country_name(country) if country else None,
        "kind": kind, "kind_label": kind_label(kind) if kind else None, "span": [span[0], span[-1]],
        "kpis": [
            {"key": "alerts", "label": "Alerts", "value": total, "delta": delta(total, prev[0] or 0),
             "spark": [sum(per_day[d].values()) for d in span]},
            {"key": "critical", "label": "Critical alerts", "value": critical, "delta": delta(critical, prev[1] or 0),
             "spark": [per_day[d]["critical"] for d in span]},
            {"key": "fusions", "label": "Fusions", "value": sum(fus.values()), "delta": None, "spark": [fus[d] for d in span]},
            {"key": "telegram", "label": "Telegram reports", "value": tg_total, "delta": None,
             "spark": [sum(tg[d].values()) for d in span]},
            {"key": "countries", "label": "Countries with alerts", "value": len(countries_n), "delta": None, "spark": None},
        ],
        "alerts_per_day": [{"date": d, **per_day[d]} for d in span],
        "kinds": kinds, "countries": countries,
        "activity": [{"date": d, **act[d]} for d in span],
        "fusions_per_day": [{"date": d, "n": fus[d]} for d in span],
        "telegram_per_day": [{"date": d, **tg[d]} for d in span], "telegram_types": tg_types, "channels": channels,
        "wars": wars[:9], "forecasts": forecasts,
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
    }


def cached(db_path: str, days: int, country: str | None, kind: str | None) -> dict:
    key = (days, country, kind)
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL_S:
        return hit[1]
    if hit:
        # stale: serve it and rebuild behind it
        def _run():
            try:
                v = build(db_path, days, country, kind)
                with _lock:
                    _cache[key] = (time.time(), v)
            except Exception as e:                             # noqa: BLE001
                print(f"[analytics] rebuild failed: {type(e).__name__}: {e}", flush=True)
        threading.Thread(target=_run, daemon=True, name="analytics").start()
        return hit[1]
    v = build(db_path, days, country, kind)
    with _lock:
        _cache[key] = (time.time(), v)
    return v


def day_detail(db_path: str, date: str, country: str | None = None, kind: str | None = None, limit: int = 25) -> list[dict]:
    """The day's most serious alerts, for a click on a column."""
    where, args = ["created_at >= ? AND created_at < ?"], [date, (_dt.date.fromisoformat(date) + _dt.timedelta(days=1)).isoformat()]
    if country:
        where.append("lower(country_code) = ?"); args.append(country.lower())
    if kind:
        where.append("alert_type = ?"); args.append(kind)
    con = sqlite3.connect(db_path, timeout=30)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT alert_id, alert_type, title, severity, country_code, lat, lon, created_at FROM alerts WHERE "
            + " AND ".join(where)
            + " ORDER BY CASE lower(severity) WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'significant' THEN 1"
              " WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC LIMIT ?", args + [limit]).fetchall()
    finally:
        con.close()
    return [{"id": r["alert_id"], "kind": kind_label(r["alert_type"]), "title": r["title"],
             "band": BAND.get((r["severity"] or "").lower(), "moderate"), "country": _country_name(r["country_code"]) if r["country_code"] else None,
             "lat": r["lat"], "lon": r["lon"], "at": r["created_at"]} for r in rows]
