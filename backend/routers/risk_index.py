"""routers/risk_index.py — the country risk index endpoints.

Since 2026-10-18 the index is a cross-reference of four source families —
GDELT, news (RSS), Telegram and GeoConfirmed — scored and combined in
risk_crossref.py; gdelt_risk_index.py still scores the GDELT family.

Structural separation from the exposure-scoring engine (fusion_engine.py/
correlation_scoring.py): this router never imports fusion_engine or
correlation_scoring, and neither of those modules imports anything from
here.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Body

import gdelt_risk_index as _gri
import risk_crossref as _rx

router = APIRouter(prefix="/api/risk-index", tags=["risk-index"])

# Session-lifetime weight override, in memory. The weights are the four
# SOURCE FAMILIES (gdelt, rss, telegram, geoconfirmed); GDELT's own parts
# (volume, tone, Goldstein) keep their fixed internal weights.
_current_weights: dict = dict(_rx.DEFAULT_FAMILY_WEIGHTS)


def _real_geoconfirmed_counts_by_iso(window_days: int) -> dict:
    """Real GeoConfirmed placemark counts per real ISO country code in the
    real window, resolved via the same real country_registry.py used
    elsewhere in this app (never a second, disagreeing country-resolution
    mechanism)."""
    import datetime
    import country_registry
    from database import SessionLocal, GeoConfirmedPlacemark

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=window_days)
    counts: dict = {}
    with SessionLocal() as db:
        rows = db.query(GeoConfirmedPlacemark.plus_code).filter(
            GeoConfirmedPlacemark.status == "active",
            GeoConfirmedPlacemark.date >= cutoff,
        ).all()
    import country_codes as _cc
    for (plus_code,) in rows:
        if not plus_code:
            continue
        raw = plus_code.rsplit(",", 1)[-1].strip() if "," in plus_code else None
        if not raw:
            continue
        resolved = country_registry.canonical_country(raw)
        if resolved:
            # country_registry speaks ISO alpha-2; the index is keyed on
            # alpha-3 so that GDELT's FIPS and CAMEO codes can be compared
            # against it at all. Converted here, once.
            iso3 = _cc.from_iso2(resolved[0])
            if iso3:
                counts[iso3] = counts.get(iso3, 0) + 1
    return counts


def get_all_events() -> list:
    import gdelt_events
    return gdelt_events.EVENTS_CACHE.get("events", [])


def real_history_days(events: list) -> float:
    dts = [d for d in (_gri._event_dt(e) for e in events) if d is not None]
    if len(dts) < 2:
        return 0.0
    return (max(dts) - min(dts)).total_seconds() / 86400.0


#: The whole-world risk computation, memoised.
#:
#: compute_all_countries() scores 121 countries, and each one makes
#: three full passes over the GDELT event list — measured at 4,840,000
#: calls to _country_matches and 19.4 seconds for one invocation.
#:
#: It was being run from scratch on EVERY /api/notifications request,
#: and the front end polls that every 20 seconds. So the tray's endpoint
#: could never be faster than 19 seconds no matter what else was fixed:
#: not the missing index, not the per-alert coverage N+1, neither of
#: which touched this.
#:
#: Its only inputs are the GDELT event cache, which refreshes every 15
#: minutes, and the GeoConfirmed counts. Recomputing between refreshes
#: cannot produce a different answer, so a TTL under the refresh
#: interval is exact rather than approximate.
#: MUST EXCEED THE WARMER'S INTERVAL. The background warmer refreshes
#: this every 720s. With a 600s TTL the cache lapsed for two minutes in
#: every cycle, and whichever request arrived in that window paid the
#: full 19-second recompute — which is exactly what production showed:
#: 13s, 22s, 12s, then 1.2s once warm. 900s both covers the warmer and
#: matches GDELT's own 15-minute refresh, so an entry can never be
#: staler than its inputs.
_RISK_CACHE: dict = {}
_RISK_TTL_S = 900


import threading as _threading

_RISK_LOCK = _threading.Lock()


@router.get("/countries")
def get_all_country_risk(window_days: int = 30, force: bool = False):
    """Every country's risk. One computation at a time (cold requests used
    to compute 121 countries each, side by side: 22–118 s apiece under load),
    and an expired result is served while one request refreshes it."""
    import time as _time
    hit = _RISK_CACHE.get(window_days)
    if hit and not force and _time.time() - hit[0] < _RISK_TTL_S:
        return hit[1]
    if hit and not force and not _RISK_LOCK.acquire(blocking=False):
        return hit[1]                  # someone is refreshing it: the last answer, now
    if not (hit and not force):
        _RISK_LOCK.acquire()
        fresh = _RISK_CACHE.get(window_days)
        if fresh and not force and _time.time() - fresh[0] < _RISK_TTL_S:
            _RISK_LOCK.release()
            return fresh[1]            # computed by the request we waited for
    try:
        return _compute_all(window_days)
    finally:
        _RISK_LOCK.release()


def _ro_con():
    """A read-only connection to the app database: the index only reads."""
    import sqlite3
    from paths import DATA_DIR
    return sqlite3.connect(f"file:{DATA_DIR}/akili.db?mode=ro", uri=True, timeout=30)


def _to_iso3(by_cc2: dict) -> dict:
    """{alpha-2: x} -> {alpha-3: x}; codes that do not resolve are dropped."""
    import country_codes as _cc
    out = {}
    for cc, v in (by_cc2 or {}).items():
        iso3 = _cc.from_iso2(str(cc or "").upper()) if cc else None
        if iso3:
            out[iso3] = v
    return out


def _telegram_stats(days: int = 7) -> dict:
    """Per country (alpha-2), over the last `days`: located event posts and
    their channels, mood-rated posts (tension, calls to act, channels), calls
    to violence raised as alerts, stated intents, and the two live readings
    (telegram_unrest: demonstrations / tension; telegram_mood_alert: calls
    for conflict rising). Four GROUP BYs on indexed time columns plus the
    two readings the mood page already caches for five minutes."""
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc)
    since_iso = (now - _dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
    since_sql = (now - _dt.timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    out: dict = {}

    def row(cc):
        return out.setdefault(str(cc).lower(), {})

    con = _ro_con()
    try:
        for cc, n, ch in con.execute(
                "SELECT lower(country_code), COUNT(*), COUNT(DISTINCT channel) FROM telegram_posts"
                " WHERE posted_at >= ? AND relevant = 1 AND country_code IS NOT NULL AND country_code != ''"
                " GROUP BY 1", (since_iso,)):
            row(cc).update(reports=n, report_channels=ch)
        for cc, n, tsum, calls, ch in con.execute(
                "SELECT lower(mood_country), COUNT(*), SUM(COALESCE(mood_tension, 0)),"
                " SUM(CASE WHEN mood_mobilise >= 2 THEN 1 ELSE 0 END), COUNT(DISTINCT channel)"
                " FROM telegram_posts WHERE posted_at >= ? AND mood_checked = 1"
                " AND mood_country IS NOT NULL AND mood_country != '' GROUP BY 1", (since_iso,)):
            row(cc).update(mood_n=n, mood_tension_sum=tsum or 0, mood_calls=calls or 0, mood_channels=ch)
        try:
            import telegram_mood_alert as _tma
            for cc, n in con.execute(
                    "SELECT lower(country_code), COUNT(*) FROM alerts WHERE alert_type = ? AND created_at >= ?"
                    " AND country_code IS NOT NULL GROUP BY 1", (_tma.CALL_TYPE, since_sql)):
                row(cc)["violence_calls"] = n
        except Exception as e:                                  # noqa: BLE001
            print(f"[risk-index] error: telegram calls: {type(e).__name__}: {e}", flush=True)
        try:
            for cc, n in con.execute(
                    "SELECT lower(country), COUNT(*) FROM telegram_intents WHERE kind = 'intent'"
                    " AND posted_at >= ? AND country IS NOT NULL AND country != '' GROUP BY 1", (since_iso,)):
                row(cc)["intents"] = n
        except Exception as e:                                  # noqa: BLE001  (table made by telegram_signals)
            if "no such table" not in str(e):
                print(f"[risk-index] error: telegram intents: {type(e).__name__}: {e}", flush=True)
    finally:
        con.close()
    try:
        import telegram_unrest as _tu
        for cc, rd in (_tu.evaluate() or {}).items():
            d = ((rd.get("trend") or {}).get("daily")) or {}
            row(cc).update(unrest_level=((rd.get("likelihood") or {}).get("level")),
                           trend=d.get("direction"), sharp=bool(d.get("sharp")))
    except Exception as e:                                      # noqa: BLE001
        print(f"[risk-index] error: telegram unrest: {type(e).__name__}: {e}", flush=True)
    try:
        import telegram_mood_alert as _tma
        for cc, ind in (_tma.evaluate() or {}).items():
            if ind.get("rising"):
                row(cc).update(conflict_rising=True, conflict_severity=ind.get("severity"))
    except Exception as e:                                      # noqa: BLE001
        print(f"[risk-index] error: telegram conflict calls: {type(e).__name__}: {e}", flush=True)
    return {cc: v for cc, v in out.items() if len(cc) == 2}


def _rss_stats(days: int = 7) -> dict:
    import rss_pulse
    return rss_pulse.country_stats(days)


def _family_inputs() -> dict:
    """RSS and Telegram readings per country (alpha-3), each loader timed and
    allowed to fail on its own: a broken family is reported, never fatal."""
    import time as _t
    out = {"rss": {}, "telegram": {}, "timing_s": {}, "errors": {}}
    for name, fn in (("rss", lambda: _rss_stats(_rx.WINDOW_DAYS["rss"])),
                     ("telegram", lambda: _telegram_stats(_rx.WINDOW_DAYS["telegram"]))):
        t0 = _t.monotonic()
        try:
            out[name] = _to_iso3(fn())
        except Exception as e:                                  # noqa: BLE001
            out["errors"][name] = f"{type(e).__name__}: {e}"
            print(f"[risk-index] error: {name} family: {type(e).__name__}: {e}", flush=True)
        out["timing_s"][name] = round(_t.monotonic() - t0, 2)
    return out


def _compute_all(window_days: int) -> dict:
    import time as _t
    t0 = _t.monotonic()
    events = get_all_events()
    geo_counts = _real_geoconfirmed_counts_by_iso(window_days)
    t_geo = _t.monotonic()
    hist_days = real_history_days(events)
    gdelt_rows = _gri.compute_all_countries(
        events, geo_counts, weights=None, window_days=window_days, real_history_days=hist_days,
    )
    t_gdelt = _t.monotonic()
    fam = _family_inputs()
    results = _rx.score_all(gdelt_rows, geo_counts, fam["rss"], fam["telegram"],
                            weights=_current_weights, window_days=window_days)
    timing = {"geoconfirmed": round(t_geo - t0, 2), "gdelt": round(t_gdelt - t_geo, 2), **fam["timing_s"],
              "total": round(_t.monotonic() - t0, 2)}
    if timing["total"] > 5:
        print(f"[risk-index] computed {len(results)} countries in {timing['total']}s {timing}", flush=True)
    payload = {
        "countries": results, "weights": _current_weights,
        "families": [{"key": f, "label": _rx.FAMILY_LABEL[f], "window_days": _rx.WINDOW_DAYS[f],
                      "full_evidence": _rx.FULL_EVIDENCE[f], "corroborates_at": _rx.CORROBORATES_AT[f]}
                     for f in _rx.FAMILIES],
        "family_errors": fam["errors"], "timing_s": timing,
        "method": ("cross-reference of four source families; one family alone is capped below band 4, "
                   "two below band 5; confidence is the number of agreeing families"),
        "real_gdelt_history_days": hist_days, "real_total_gdelt_events": len(events),
        "window_days": window_days,
    }
    _RISK_CACHE[window_days] = (_t.time(), payload)
    return payload


def _country_row(iso: str, window_days: int = 30) -> dict | None:
    """One country, from the cached whole-world computation — never a second
    per-request computation that could disagree with the ranking."""
    iso = (iso or "").upper()
    if len(iso) == 2:
        import country_codes as _cc
        iso = _cc.from_iso2(iso) or iso
    payload = get_all_country_risk(window_days=window_days)
    for row in payload.get("countries") or []:
        if row.get("iso_code") == iso:
            return row
    return None


@router.get("/country/{iso_code}")
def get_one_country_risk(iso_code: str, window_days: int = 30):
    row = _country_row(iso_code, window_days)
    if row is None:
        return {"iso_code": iso_code.upper(), "score": None, "band": None,
                "status": "no source family observed this country in its window"}
    return row


@router.get("/weights")
def get_weights():
    return {"weights": _current_weights, "default_weights": _rx.DEFAULT_FAMILY_WEIGHTS}


@router.post("/weights")
def set_weights(weights: dict = Body(...)):
    """Live family-weight adjustment. The cached ranking is dropped so the
    next read recomputes with the new weights."""
    for k in weights:
        if k not in _rx.DEFAULT_FAMILY_WEIGHTS:
            raise HTTPException(status_code=400, detail=f"unknown weight key: {k}")
    global _current_weights
    _current_weights = {**_current_weights, **{k: float(v) for k, v in weights.items()}}
    _expire_cache()
    return {"weights": _current_weights}


@router.post("/weights/reset")
def reset_weights():
    global _current_weights
    _current_weights = dict(_rx.DEFAULT_FAMILY_WEIGHTS)
    _expire_cache()
    return {"weights": _current_weights}


def _expire_cache() -> None:
    """Mark every cached ranking stale WITHOUT removing it: the next read
    refreshes it while concurrent readers keep the previous answer
    (build-then-swap, never clear-then-rebuild)."""
    for k, (_stamp, payload) in list(_RISK_CACHE.items()):
        _RISK_CACHE[k] = (0.0, payload)

@router.get("/country/{iso_code}/explain")
def explain_country_risk(iso_code: str, window_days: int = 30, limit: int = 8):
    """Why this country scores what it scores, and what has happened there.

    A band on a choropleth is unarguable and unactionable. Three things
    make it usable, and all three already exist somewhere in this process:
    the score's own decomposition, the EVENTS that produced it, and what
    the wires are saying now.

    THE EVENTS ARE SELECTED BY THE SCORER'S OWN RULE. _country_matches is
    the same predicate compute_country_risk uses, so this list cannot
    quietly disagree with the number it claims to explain — an explanation
    derived from a different rule than the thing it explains is worse than
    none, because it is checkable and wrong.
    """
    iso = (iso_code or "").upper()
    if len(iso) == 2:
        import country_codes as _cc
        iso = _cc.from_iso2(iso) or iso
    events = get_all_events()
    risk = _country_row(iso, window_days) or {
        "iso_code": iso, "score": None, "band": None,
        "status": "no source family observed this country in its window"}

    # The events behind the score, newest first.
    import datetime as _dt
    cutoff = _dt.datetime.utcnow() - _dt.timedelta(days=window_days)
    mine = []
    for e in events:
        if not _gri._country_matches(e, iso):
            continue
        dt = _gri._event_dt(e)
        if dt is None or dt < cutoff:
            continue
        mine.append((dt, e))
    mine.sort(key=lambda p: p[0], reverse=True)

    drivers = [{
        "date": dt.date().isoformat(),
        "title": (e.get("headline") or e.get("summary") or "").strip() or None,
        "event_type": e.get("event_type"),
        "goldstein": e.get("goldstein"),
        "tone": e.get("avg_tone"),
        "mentions": e.get("mentions"),
        "location": e.get("location") or e.get("location_name"),
        "source_url": e.get("source_url"),
        # Whether a journalist wrote this sentence or this system did.
        "headline_is_article": bool(e.get("headline_is_article")),
    } for dt, e in mine[:limit]]

    # RELEVANCE, NOT CENSORSHIP. Each driver says whether the cheap model
    # judged it security or general news; the drivers are the score's own
    # evidence, so general ones are marked, not removed — the panel shows the
    # security ones and counts the rest. News is context only: general items
    # are dropped from it.
    news = _recent_articles(iso, limit * 3)
    try:
        from routers import enrichment as _en
        rd = _en.relevance_of([{"headline": d.get("title") or d.get("event_type")} for d in drivers])
        for i, d in enumerate(drivers):
            d["relevance"] = rd.get(i)
        rn = _en.relevance_of([{"headline": n.get("title")} for n in news])
        news = [n for i, n in enumerate(news) if rn.get(i) != "general"]
    except Exception:
        pass
    return {
        "iso_code": iso,
        "risk": risk,
        "window_days": window_days,
        "events_in_window": len(mine),
        "drivers": drivers,
        "news": news[:limit],
        # Both codes, because downstream needs different ones: news_articles
        # and flagcdn are keyed on alpha-2, the index on alpha-3.
        "iso2": _iso2(iso),
        "country": _country_name(iso),
        # flagcdn serves public-domain flags with no key and no rate limit.
        "flag_url": (f"https://flagcdn.com/w160/{_iso2(iso).lower()}.png"
                     if _iso2(iso) else None),
        "note": ("drivers are the GDELT events the GDELT family counted, selected by the "
                 "scorer's own country rule; news is the RSS family's own security articles "
                 "(rss_pulse), which the news family counted"),
    }


def _iso2(iso: str) -> str | None:
    import country_codes as _cc
    c = (iso or "").upper()
    if len(c) == 2:
        return c if c in _cc.ISO2_TO_ISO3 else None
    return _cc.ISO3_TO_ISO2.get(c)


def _country_name(iso: str) -> str | None:
    """The country's own name, so a panel never has to show a code."""
    import country_registry
    two = _iso2(iso)
    if not two:
        return None
    # country_registry's own alpha-2 -> name table, rather than a second
    # list of country names that could disagree with it.
    return getattr(country_registry, "_ISO_TO_NAME", {}).get(two)


def _recent_articles(iso: str, limit: int) -> list:
    """The newest security articles about this country from the RSS family
    (rss_pulse.rss_items) — the articles the news family counted.

    news_articles, which this read before, stopped being written on
    2026-09-11 when the old article pipeline was retired, so the country
    panel's "latest news" had been a month old.
    """
    two = _iso2(iso) or iso
    try:
        import rss_pulse
        return rss_pulse.recent_items(two, limit=limit, days=_rx.WINDOW_DAYS["rss"])
    except Exception:                                       # noqa: BLE001
        # A missing news table must not take the risk explanation with it.
        return []
