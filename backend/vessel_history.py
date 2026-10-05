"""
vessel_history.py — a ship's last 90 days, from Global Fishing Watch.

A live position says where a ship is. What an analyst asks next is where it
has been and what it has done: which ports it called at, whether it met
another ship at sea (how cargo moves between hulls without a port record),
whether it held station in open water, whether it went dark — and whether
it has sailed under other names and flags. GFW publishes all of it per
vessel, from satellite AIS, so it covers the water our own receivers do not
(Hormuz, Bab el-Mandeb).

GFW keys events by its own vessel id, which the identity search returns
(vessel_owner.fetch, already cached). Events are published days behind real
time; the lag travels with the answer.

The raw responses are cached; everything shown is derived on read
(summarise), so a fix here reaches cached ships at once.

A GAP IS NOT GUILT. Receivers fail. GFW's own `intentionalDisabling` flag
says whether its model thinks the transmitter was switched off, and that
flag is what the warning repeats — under GFW's name, not as our finding.
"""
from __future__ import annotations

import datetime as _dt
import time

WINDOW_DAYS = 90
CACHE_TTL_S = 6 * 3600
KINDS = ("port-visits", "encounters", "loitering", "gaps")

_cache: dict[str, tuple[float, dict]] = {}


def _hours(start: str | None, end: str | None) -> float | None:
    try:
        a = _dt.datetime.fromisoformat(str(start).replace("Z", "+00:00"))
        b = _dt.datetime.fromisoformat(str(end).replace("Z", "+00:00"))
        return round((b - a).total_seconds() / 3600, 1)
    except (TypeError, ValueError):
        return None


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def vessel_ids(raw: dict | None, mmsi: str) -> list[str]:
    """GFW vessel ids for this MMSI from an identity-search response."""
    out = set()
    for e in (raw or {}).get("entries") or []:
        for r in (e.get("selfReportedInfo") or []) + (e.get("registryInfo") or []):
            if str(r.get("ssvid")) == mmsi and r.get("id"):
                out.add(r["id"])
    return sorted(out)


def identities(raw: dict | None, mmsi: str) -> list[dict]:
    """Every name and flag this MMSI has broadcast, oldest first."""
    seen = {}
    for e in (raw or {}).get("entries") or []:
        for r in e.get("selfReportedInfo") or []:
            if str(r.get("ssvid")) != mmsi:
                continue
            key = ((r.get("shipname") or "").strip().upper(), r.get("flag"))
            if not key[0] and not key[1]:
                continue
            a = (r.get("transmissionDateFrom") or "")[:10] or None
            b = (r.get("transmissionDateTo") or "")[:10] or None
            cur = seen.get(key)
            if cur:
                cur["from"] = min(filter(None, [cur["from"], a]), default=None)
                cur["to"] = max(filter(None, [cur["to"], b]), default=None)
            else:
                seen[key] = {"name": key[0] or None, "flag": key[1], "from": a, "to": b}
    return sorted(seen.values(), key=lambda x: x["from"] or "")


def summarise(events_by_kind: dict, idents: list[dict], now: _dt.datetime | None = None) -> dict:
    """The pattern of life, from raw GFW event entries. Pure."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    ports, meets, holds, dark = [], [], [], []
    for e in events_by_kind.get("port-visits") or []:
        pv = e.get("port_visit") or {}
        anc = pv.get("startAnchorage") or pv.get("endAnchorage") or {}
        name = anc.get("name") or anc.get("topDestination") or anc.get("id")
        ports.append({"port": (name or "unnamed anchorage").title() if name and name.isupper() else (name or "unnamed anchorage"),
                      "country_code": anc.get("flag"), "start": e.get("start"), "end": e.get("end"),
                      "hours": _f(pv.get("durationHrs")) or _hours(e.get("start"), e.get("end")),
                      "lat": anc.get("lat"), "lon": anc.get("lon")})
    for e in events_by_kind.get("encounters") or []:
        enc = e.get("encounter") or {}
        other = enc.get("vessel") or {}
        meets.append({"start": e.get("start"), "hours": _hours(e.get("start"), e.get("end")),
                      "with": {"name": other.get("name"), "flag": other.get("flag"),
                               "type": other.get("type"), "mmsi": other.get("ssvid")},
                      "gfw_potential_risk": bool(enc.get("potentialRisk")),
                      "lat": (e.get("position") or {}).get("lat"), "lon": (e.get("position") or {}).get("lon")})
    for e in events_by_kind.get("loitering") or []:
        holds.append({"start": e.get("start"), "hours": _hours(e.get("start"), e.get("end")),
                      "km_from_shore": _f((e.get("distances") or {}).get("startDistanceFromShoreKm")),
                      "lat": (e.get("position") or {}).get("lat"), "lon": (e.get("position") or {}).get("lon")})
    for e in events_by_kind.get("gaps") or []:
        g = e.get("gap") or {}
        dark.append({"start": e.get("start"), "hours": _f(g.get("durationHours")) or _hours(e.get("start"), e.get("end")),
                     "km": _f(g.get("distanceKm")), "gfw_intentional": bool(g.get("intentionalDisabling")),
                     "lat": (e.get("position") or {}).get("lat"), "lon": (e.get("position") or {}).get("lon")})
    for lst in (ports, meets, holds, dark):
        lst.sort(key=lambda x: x.get("start") or "", reverse=True)

    stamps = [x["start"] for x in ports + meets + holds + dark if x.get("start")]
    lag = None
    if stamps:
        newest = max(_dt.datetime.fromisoformat(s.replace("Z", "+00:00")) for s in stamps)
        lag = round(max(0.0, (now - newest).total_seconds() / 86400), 1)

    warnings = []
    intentional = [d for d in dark if d["gfw_intentional"]]
    if intentional:
        longest = max(intentional, key=lambda d: d["hours"] or 0)
        warnings.append(f"Went dark {len(intentional)} time{'s' if len(intentional) > 1 else ''}"
                        f" that GFW judges intentional — longest {round(longest['hours'] or 0)} h")
    if meets:
        risky = [m for m in meets if m["gfw_potential_risk"]]
        warnings.append(f"Met {len(meets)} vessel{'s' if len(meets) > 1 else ''} at sea"
                        + (f", {len(risky)} flagged by GFW as potential risk" if risky else ""))
    names = {i["name"] for i in idents if i["name"]}
    flags = {i["flag"] for i in idents if i["flag"]}
    if len(names) > 1 or len(flags) > 1:
        warnings.append(f"Has broadcast {len(names)} name{'s' if len(names) != 1 else ''}"
                        f" and {len(flags)} flag{'s' if len(flags) != 1 else ''}")

    countries = []
    for p in ports:
        if p["country_code"] and p["country_code"] not in countries:
            countries.append(p["country_code"])
    parts = []
    if ports:
        parts.append(f"{len(ports)} port call{'s' if len(ports) > 1 else ''}, last {ports[0]['port']}")
    else:
        parts.append("no port calls")
    parts.append(f"{len(meets)} meeting{'s' if len(meets) != 1 else ''} at sea")
    parts.append(f"{len(dark)} dark period{'s' if len(dark) != 1 else ''}")
    return {
        "window_days": WINDOW_DAYS, "lag_days": lag,
        "summary": " · ".join(parts),
        "warnings": warnings,
        "port_calls": ports, "port_countries": countries,
        "encounters": meets, "loitering": holds, "dark_periods": dark,
        "identities": idents,
        "source": "Global Fishing Watch",
        "note": "Derived from satellite AIS and published days after the fact.",
    }


def fetch_events(ids: list[str]) -> dict | None:
    """Raw event entries per kind for these GFW vessel ids, cached."""
    import gfw
    key = ",".join(ids)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return hit[1]
    end = _dt.date.today()
    start = end - _dt.timedelta(days=WINDOW_DAYS)
    # In parallel: one after another, a first look took 38 s.
    from concurrent.futures import ThreadPoolExecutor

    def one(kind):
        return kind, gfw._post("/v3/events?limit=100&offset=0&sort=-start",
                               {"datasets": [gfw.DATASETS[kind]], "vessels": ids,
                                "startDate": start.isoformat(), "endDate": end.isoformat()})
    with ThreadPoolExecutor(max_workers=len(KINDS)) as pool:
        got = dict(pool.map(one, KINDS))
    if any(r is None for r in got.values()):
        return hit[1] if hit else None
    out = {k: (r.get("entries") or []) for k, r in got.items()}
    _cache[key] = (time.time(), out)
    return out


def pattern_of_life(mmsi) -> dict:
    import vessel_owner
    m = str(mmsi or "").strip()
    if not vessel_owner._is_ship_mmsi(m):
        return {"available": False, "reason": "Not a ship MMSI."}
    raw = vessel_owner.fetch(m)
    if raw is None:
        return {"available": False, "reason": "Global Fishing Watch is unavailable right now."}
    ids = vessel_ids(raw, m)
    if not ids:
        return {"available": False, "reason": "Global Fishing Watch has no record of this vessel."}
    ev = fetch_events(ids)
    if ev is None:
        return {"available": False, "reason": "Global Fishing Watch did not answer for this vessel's events."}
    return {"available": True, **summarise(ev, identities(raw, m))}
