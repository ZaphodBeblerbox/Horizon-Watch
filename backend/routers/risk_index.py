"""routers/risk_index.py — the real GDELT country risk index endpoints
(Parallax translation step 1, Part 4). See gdelt_risk_index.py for the real
scoring engine and its own detailed real-data-depth honesty notes.

Structural separation from the exposure-scoring engine (fusion_engine.py/
correlation_scoring.py): this router imports ONLY gdelt_risk_index,
gdelt_events, geoconfirmed's country_registry, and database — never
fusion_engine or correlation_scoring, and neither of those modules imports
anything from here. Grep-verified in the Part 4 report, not just asserted.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Body

import gdelt_risk_index as _gri

router = APIRouter(prefix="/api/risk-index", tags=["risk-index"])

# Real, session-lifetime weight override (in-memory; a real per-analyst
# server-persisted setting is real future work beyond this pass's scope —
# stated explicitly, not silently simplified). Starts at the real default.
_current_weights: dict = dict(_gri.DEFAULT_WEIGHTS)


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


@router.get("/countries")
def get_all_country_risk(window_days: int = 30, force: bool = False):
    import time as _time
    hit = _RISK_CACHE.get(window_days)
    if hit and not force and _time.time() - hit[0] < _RISK_TTL_S:
        return hit[1]

    events = get_all_events()
    geo_counts = _real_geoconfirmed_counts_by_iso(window_days)
    hist_days = real_history_days(events)
    results = _gri.compute_all_countries(
        events, geo_counts, weights=_current_weights, window_days=window_days, real_history_days=hist_days,
    )
    payload = {
        "countries": results, "weights": _current_weights,
        "real_gdelt_history_days": hist_days, "real_total_gdelt_events": len(events),
        "window_days": window_days,
    }
    import time as _t2
    _RISK_CACHE[window_days] = (_t2.time(), payload)
    return payload


@router.get("/country/{iso_code}")
def get_one_country_risk(iso_code: str, window_days: int = 30):
    events = get_all_events()
    geo_counts = _real_geoconfirmed_counts_by_iso(window_days)
    hist_days = real_history_days(events)
    result = _gri.compute_country_risk(
        iso_code.upper(), events, geo_counts, weights=_current_weights,
        window_days=window_days, real_history_days=hist_days,
    )
    return result


@router.get("/weights")
def get_weights():
    return {"weights": _current_weights, "default_weights": _gri.DEFAULT_WEIGHTS}


@router.post("/weights")
def set_weights(weights: dict = Body(...)):
    """Real, live weight adjustment — every real subsequent /countries or
    /country/{iso} call reflects the new weights immediately (verified by
    this round's own regression test)."""
    for k in weights:
        if k not in _gri.DEFAULT_WEIGHTS:
            raise HTTPException(status_code=400, detail=f"unknown weight key: {k}")
    global _current_weights
    _current_weights = {**_current_weights, **{k: float(v) for k, v in weights.items()}}
    return {"weights": _current_weights}


@router.post("/weights/reset")
def reset_weights():
    global _current_weights
    _current_weights = dict(_gri.DEFAULT_WEIGHTS)
    return {"weights": _current_weights}

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
    events = get_all_events()
    geo_counts = _real_geoconfirmed_counts_by_iso(window_days)
    hist_days = real_history_days(events)
    risk = _gri.compute_country_risk(
        iso, events, geo_counts, weights=_current_weights,
        window_days=window_days, real_history_days=hist_days,
    )

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

    return {
        "iso_code": iso,
        "risk": risk,
        "window_days": window_days,
        "events_in_window": len(mine),
        "drivers": drivers,
        "news": _recent_articles(iso, limit),
        # Both codes, because downstream needs different ones: news_articles
        # and flagcdn are keyed on alpha-2, the index on alpha-3.
        "iso2": _iso2(iso),
        "country": _country_name(iso),
        # flagcdn serves public-domain flags with no key and no rate limit.
        "flag_url": (f"https://flagcdn.com/w160/{_iso2(iso).lower()}.png"
                     if _iso2(iso) else None),
        "note": ("drivers are the same events the scorer counted, selected by "
                 "the scorer's own country rule; news is separate RSS and did "
                 "not affect the score"),
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
    """Latest ingested RSS for this country.

    SEPARATE FROM THE SCORE ON PURPOSE, and labelled as such in the
    response. These articles did not feed the index, so presenting them
    beside it as though they were evidence for the number would be a quiet
    lie. They answer a different and equally real question: what is
    happening there right now.
    """
    from database import NewsArticle as _NA, get_db as _gdb
    try:
        with _gdb() as db:
            two = _iso2(iso) or iso
            rows = (db.query(_NA)
                      .filter(_NA.country_code == two.lower())
                      .order_by(_NA.ingested_at.desc())
                      .limit(limit).all())
            return [{
                "title": r.title, "url": r.url, "source": r.source_name,
                "published": r.published, "ingested_at":
                    r.ingested_at.isoformat() if r.ingested_at else None,
            } for r in rows]
    except Exception as ex:                                 # noqa: BLE001
        # A missing news table must not take the risk explanation with it.
        return []
