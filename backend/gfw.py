"""
gfw.py — Global Fishing Watch events.

WHY THIS EXISTS. Our own AIS feed is terrestrial and Europe-heavy, so
the map implies the Baltic is the busiest, most incident-prone water on
earth and that nothing happens in Hormuz or the Malacca Strait. GFW
processes satellite AIS globally and publishes the derived events, so
this fills in the part of the ocean our receivers cannot hear.

WHAT IT IS NOT. These are not live positions and must never be drawn as
if they were. GFW publishes events after processing, and the newest
entry is typically several days old — measured at four days on the
first live query. Every response carries the lag so the caller can say
so out loud.

The four event types are all ones an analyst would otherwise be
guessing at:

  encounters   two vessels meeting at sea, which is how a cargo moves
               between hulls without a port record
  loitering    a vessel holding station away from port
  gaps         AIS stopped transmitting and later resumed — "going
               dark", though a gap is equally often a receiver problem,
               which is why the raw duration travels with it
  port-visits  arrivals and departures

Authentication is a bearer token in backend/.env (GFW_TOKEN), which is
gitignored.
"""
from __future__ import annotations

import datetime as _dt
import json as _json
import logging
import os
import time
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)

BASE = "https://gateway.api.globalfishingwatch.org"

#: Event kind → GFW dataset id. The plurals matter; the singular forms
#: return 404 rather than an error that says what is wrong.
DATASETS = {
    "encounters":  "public-global-encounters-events:latest",
    "loitering":   "public-global-loitering-events:latest",
    "gaps":        "public-global-gaps-events:latest",
    "port-visits": "public-global-port-visits-events:latest",
}

#: Events are published days behind real time, so re-asking every few
#: minutes buys nothing and spends someone else's rate limit.
CACHE_TTL_S = 3600

_cache: dict = {}


def token() -> str | None:
    return (os.getenv("GFW_TOKEN") or "").strip() or None


def available() -> bool:
    return token() is not None


def _post(path: str, payload: dict, timeout: int = 45) -> dict | None:
    tok = token()
    if not tok:
        return None
    req = urllib.request.Request(
        BASE + path,
        data=_json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {tok}",
            "Content-Type": "application/json",
            "User-Agent": "HorizonWatch/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return _json.loads(r.read())
    except urllib.error.HTTPError as e:
        # Logged with the body, because GFW's 4xx bodies say which
        # property it objected to and a bare status code does not.
        logger.warning("gfw: HTTP %s for %s — %s", e.code, path,
                       e.read()[:300].decode(errors="replace"))
    except Exception:
        logger.exception("gfw: request failed for %s", path)
    return None


def _vessel(v: dict | None) -> dict | None:
    """One vessel, with the fields an analyst reads first.

    `ssvid` is the MMSI. Names are self-reported over AIS and are
    frequently mangled — "XNOI 93 P8 C794%" is a real one — so the name
    is passed through exactly as received rather than tidied into
    something that looks more trustworthy than it is.
    """
    if not isinstance(v, dict):
        return None
    return {
        "name": (v.get("name") or "").strip() or None,
        "mmsi": v.get("ssvid"),
        "flag": v.get("flag"),
        "type": v.get("type"),
    }


def normalise(entry: dict, kind: str) -> dict | None:
    """One GFW event in this app's shape, or None if it has no position."""
    if not isinstance(entry, dict):
        return None
    pos = entry.get("position") or {}
    lat, lon = pos.get("lat"), pos.get("lon")
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None

    vessels = [v for v in (_vessel(entry.get("vessel")),) if v]
    detail = entry.get(kind.rstrip("s").replace("-", "_")) or entry.get("encounter") or {}
    if isinstance(detail, dict):
        other = _vessel(detail.get("vessel"))
        if other:
            vessels.append(other)

    dist = entry.get("distances") or {}
    out = {
        "id": entry.get("id"),
        "kind": kind,
        "type": entry.get("type"),
        "start": entry.get("start"),
        "end": entry.get("end"),
        "lat": float(lat),
        "lon": float(lon),
        "vessels": vessels,
        "km_from_shore": dist.get("startDistanceFromShoreKm"),
        "km_from_port": dist.get("startDistanceFromPortKm"),
        "eez": (entry.get("regions") or {}).get("eez") or [],
        "high_seas": bool((entry.get("regions") or {}).get("highSeas")),
        # GFW's own assessment, carried through under its own name
        # rather than restated as ours.
        "gfw_potential_risk": detail.get("potentialRisk") if isinstance(detail, dict) else None,
    }
    if kind == "encounters" and isinstance(detail, dict):
        out["median_distance_km"] = detail.get("medianDistanceKilometers")
        out["encounter_type"] = detail.get("type")
    return out


def _lag_days(events: list) -> float | None:
    """How far behind real time the newest event is, in days."""
    stamps = [e.get("start") for e in events if e.get("start")]
    if not stamps:
        return None
    try:
        newest = max(_dt.datetime.fromisoformat(s.replace("Z", "+00:00")) for s in stamps)
    except ValueError:
        return None
    now = _dt.datetime.now(_dt.timezone.utc)
    return round(max(0.0, (now - newest).total_seconds() / 86400), 1)


def events(kind: str = "encounters", days: int = 14, limit: int = 200,
           force: bool = False) -> dict:
    """Recent events of one kind, worldwide.

    Returns the events plus how stale they are, because "no encounters
    in the last three days" is a statement about GFW's publishing
    schedule, not about the sea.
    """
    if kind not in DATASETS:
        return {"available": False, "error": f"unknown event kind {kind!r}",
                "events": [], "kinds": sorted(DATASETS)}
    if not available():
        return {"available": False, "error": "GFW_TOKEN not configured",
                "events": [], "kinds": sorted(DATASETS)}

    key = f"{kind}:{days}:{limit}"
    hit = _cache.get(key)
    if hit and not force and (time.time() - hit["ts"]) < CACHE_TTL_S:
        return {**hit["data"], "cached": True}

    end = _dt.date.today()
    start = end - _dt.timedelta(days=max(1, days))
    raw = _post(
        f"/v3/events?limit={int(limit)}&offset=0&sort=-start",
        {"datasets": [DATASETS[kind]],
         "startDate": start.isoformat(), "endDate": end.isoformat()},
    )
    if raw is None:
        # A failed call is not an empty ocean. Serve what we last had.
        if hit:
            return {**hit["data"], "cached": True, "stale": True}
        return {"available": False, "error": "GFW request failed",
                "events": [], "kinds": sorted(DATASETS)}

    entries = raw.get("entries") or []
    out = [e for e in (normalise(x, kind) for x in entries) if e]
    data = {
        "available": True,
        "kind": kind,
        "events": out,
        "returned": len(out),
        "total_matching": raw.get("total"),
        "window_days": days,
        # The number that keeps this honest.
        "lag_days": _lag_days(out),
        "source": "Global Fishing Watch",
        "source_url": "https://globalfishingwatch.org/",
        "note": "Derived events published after processing, not live positions.",
        "kinds": sorted(DATASETS),
    }
    _cache[key] = {"ts": time.time(), "data": data}
    return data
