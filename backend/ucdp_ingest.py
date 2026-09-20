"""
ucdp_ingest.py — UCDP georeferenced conflict events, free and global.

WHY THIS AND NOT ACLED. ACLED is not free — confirmed with them directly.
UCDP's API now wants a token, but its BULK CSVs remain openly downloadable,
and the Candidate Events release publishes monthly with village-level
coordinates and day-level dates.

WHAT IT FIXES. GeoConfirmed is live and exact but overwhelmingly Ukraine:
2,652 of roughly 3,000 events in the last 90 days, with Yemen getting 38 —
0.4 a day. One monthly UCDP file carried 43 Yemen events on its own, plus
Colombia, Pakistan, Nigeria, Mali, Mexico and DRC, theatres GeoConfirmed
effectively ignores.

WHAT IT CANNOT DO, and this is not a detail. It lags roughly two months: a
file downloaded in September carried events through 31 July. It is a
BASELINE — "is this district unusually active for itself?" — and never an
answer to "what happened today". Presenting a two-month-old event beside a
three-hour-old thermal hotspot without saying so would be the worst kind of
quiet lie, so every row records its own lag and the loader reports it.
"""
from __future__ import annotations

import csv
import io
import os
import re
import urllib.request
from datetime import datetime, timezone

INDEX_URL = "https://ucdp.uu.se/downloads/index.html"
BASE = "https://ucdp.uu.se/downloads/candidateged/"
_UA = "HorizonWatch/2.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"

# UCDP type_of_violence: 1 state-based, 2 non-state, 3 one-sided.
VIOLENCE_TYPE = {
    "1": "state-based conflict",
    "2": "non-state conflict",
    "3": "one-sided violence against civilians",
}

# UCDP geocoding precision (where_prec). 1-2 are the ones worth a pin: an
# exact site or a nearby village. 4 and above is "somewhere in this
# province", which is the country-centroid failure in another costume.
PINNABLE_PRECISION = {"1", "2", "3"}


def available_files(timeout: int = 60) -> list[str]:
    """Candidate-event CSVs currently published, newest-looking last."""
    req = urllib.request.Request(INDEX_URL, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        html = r.read().decode("utf-8", "replace")
    names = sorted(set(re.findall(r'candidateged/([A-Za-z0-9_.\-]+\.csv)', html)))
    return names


def latest_file(timeout: int = 60) -> str | None:
    """The most recent monthly release.

    Sorted by the version/month digits in the name rather than
    alphabetically, because "v26_0_7" and "v26_01_26_06" do not order
    correctly as strings and picking the wrong one silently ingests an
    older month.
    """
    files = available_files(timeout=timeout)
    if not files:
        return None

    def key(name):
        return [int(x) for x in re.findall(r"\d+", name)] or [0]

    return sorted(files, key=key)[-1]


def fetch_events(filename: str | None = None, timeout: int = 300) -> dict:
    """Download and parse one monthly release. Never raises."""
    try:
        fn = filename or latest_file()
        if not fn:
            return {"status": "error", "error": "no candidate files listed",
                    "events": []}
        req = urllib.request.Request(BASE + fn, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
    except Exception as e:                                  # noqa: BLE001
        return {"status": "error", "error": f"{type(e).__name__}: {e}",
                "events": []}

    rows = list(csv.DictReader(io.StringIO(raw)))
    events = [e for e in (normalise(r) for r in rows) if e]
    latest = max((e["date"] for e in events), default=None)
    lag_days = None
    if latest:
        try:
            lag_days = (datetime.now(timezone.utc).date()
                        - datetime.fromisoformat(latest[:10]).date()).days
        except Exception:
            pass

    return {
        "status": "ok", "file": fn, "events": events,
        "rows": len(rows), "usable": len(events),
        "latest_event": latest,
        # The lag is reported every time, never assumed known.
        "lag_days": lag_days,
        "note": ("UCDP publishes monthly and lags by roughly two months — a "
                 "baseline for what is normal in a district, not a report of "
                 "what happened today"),
    }


def normalise(row: dict) -> dict | None:
    """One UCDP row into the shape the rest of the system speaks."""
    try:
        lat = float(row.get("latitude") or "")
        lon = float(row.get("longitude") or "")
    except (TypeError, ValueError):
        return None
    date = (row.get("date_start") or "").strip()
    if not date:
        return None

    prec = str(row.get("where_prec") or "").strip()
    deaths = 0
    for k in ("best", "deaths_civilians", "deaths_a", "deaths_b"):
        try:
            deaths = max(deaths, int(float(row.get(k) or 0)))
        except (TypeError, ValueError):
            pass

    side_a = (row.get("side_a") or "").strip()
    side_b = (row.get("side_b") or "").strip()
    vtype = VIOLENCE_TYPE.get(str(row.get("type_of_violence") or "").strip(), "conflict event")

    return {
        "source": "ucdp",
        "id": f"ucdp-{row.get('id') or row.get('relid')}",
        "lat": lat, "lon": lon,
        "date": date[:10],
        "country": (row.get("country") or "").strip(),
        "adm1": (row.get("adm_1") or "").strip(),
        "deaths": deaths,
        "side_a": side_a, "side_b": side_b,
        "violence_type": vtype,
        "conflict_name": (row.get("conflict_name") or "").strip(),
        "where_prec": prec,
        # Only site- or village-level rows may be drawn. A province-level
        # coordinate is the country-centroid problem wearing a costume.
        "pinnable": prec in PINNABLE_PRECISION,
        "label": headline(vtype, side_a, side_b, deaths),
        "source_url": "https://ucdp.uu.se/downloads/",
    }


def headline(vtype: str, side_a: str, side_b: str, deaths: int) -> str:
    """A sentence, not a row of codes.

    UCDP's actor names are already human-readable, so the only work is
    saying what kind of violence it was and how many died — which is the
    part that decides whether anyone should look.
    """
    who = " vs ".join([s for s in (side_a, side_b) if s and not s.startswith("XXX")])
    toll = f"{deaths} killed" if deaths else "no recorded deaths"
    return f"{vtype.capitalize()} — {toll}" + (f" ({who})" if who else "")


def by_country(events: list[dict]) -> dict:
    from collections import Counter
    return dict(Counter(e["country"] for e in events).most_common())


def baseline_rate(events: list[dict], country: str, adm1: str | None = None,
                  months: int = 6) -> dict:
    """How active a district normally is, so "unusual" can mean something.

    This is UCDP's real job here. It cannot say what happened today, but it
    can say that a place averaging four events a month is not a place where
    three fires and a radar change in one week is routine.
    """
    sel = [e for e in events if e["country"] == country
           and (adm1 is None or e["adm1"] == adm1)]
    return {
        "country": country, "adm1": adm1,
        "events": len(sel),
        "deaths": sum(e["deaths"] for e in sel),
        "per_month": round(len(sel) / max(1, months), 2),
        "window_months": months,
    }
