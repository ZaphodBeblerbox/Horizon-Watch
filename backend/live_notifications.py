"""
live_notifications.py — the other things worth interrupting someone for.

WHAT WAS WRONG. /api/notifications read one table: Alert. Everything this
system has learned to detect since — GDELT pins, GeoConfirmed
confirmations, surges, fusion points, country risk moves — writes
somewhere else entirely, so none of it could ever raise a card. Measured
on the live feed: 60 of 60 notifications were AIS sanctioned-vessel
alerts. The tray, the stack and the whole arrival-tracking mechanism were
built and working, and being fed by a single source.

WHAT EARNS A CARD, AND WHAT DOES NOT. Not everything new is worth an
interruption, and a system that shouts at every event gets muted, which
costs more than it gains:

  - a GDELT pin must already have survived map_points (city-level geo, a
    kinetic code, a real article, a journalist's headline) AND fall inside
    a watched zone, chokepoint or strategic area
  - a GeoConfirmed placemark is human-verified, so it qualifies on arrival
  - a surge must clear its own Poisson gate
  - a fusion point must have two independent modalities
  - a country's risk must cross a BAND, not merely wobble — a score moving
    64.1 to 64.3 is noise, and notifying on it is how a feed becomes wallpaper

EVERY CARD SAYS WHY IT FIRED, in the same `reason` field the Alert path
uses, because an analyst who disagrees with a notification needs to see
the rule rather than guess at it.
"""
from __future__ import annotations

import datetime
import json
import os
import re
from pathlib import Path

# Goldstein is -10 (use of force) to +10 (cooperation). A pin has to be
# meaningfully conflictual before it interrupts anyone.
GDELT_NOTIFY_GOLDSTEIN = float(os.getenv("GDELT_NOTIFY_GOLDSTEIN", "-5.0"))

_STATE_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent / "data"))
_RISK_STATE = _STATE_DIR / "risk_band_state.json"


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _sev_from_goldstein(g) -> str:
    try:
        g = float(g)
    except (TypeError, ValueError):
        return "moderate"
    if g <= -8:
        return "critical"
    if g <= -6:
        return "high"
    return "moderate"


def _place_of(lat, lon) -> str | None:
    """A watched zone, chokepoint or strategic water, or None.

    The same relevance geography the Alert path uses. Reusing it is the
    point: two notifications from different feeds should not answer "why
    am I seeing this" by two different rules.
    """
    if lat is None or lon is None:
        return None
    try:
        import notification_context as _nc
        p = _nc.describe_place(lat, lon)
    except Exception:                                       # noqa: BLE001
        return None
    return p.get("zone") or p.get("chokepoint") or (p.get("waters") if p.get("watched") else None)


def gdelt_items(hours: int = 48, limit: int = 40) -> list[dict]:
    """Drawable, conflictual GDELT pins as notifications."""
    out = []
    try:
        import gdelt_events as _ge
        cutoff = (_now() - datetime.timedelta(hours=hours)).date().isoformat()
        for pin in _ge.map_points(_ge.EVENTS_CACHE.get("events") or []):
            date = str(pin.get("date") or "")[:10]
            if date and date < cutoff:
                continue
            # GOLDSTEIN CANNOT BE THE GATE. Measured on the live feed, it
            # is -10.0 for essentially every root-19 event, including
            # "Prince Harry receives call from King Charles" and "This
            # website is unavailable in your location". A threshold on a
            # saturated field admits everything, exactly as NumSources
            # rejected everything.
            #
            # GEOGRAPHY IS THE GATE, using the same describe_place() the
            # Alert path already uses — so a GDELT card and a vessel card
            # answer "why am I seeing this" the same way. Measured: 215
            # drawable pins to 67 notifiable, dropping the Nova Scotia
            # trade dispute while keeping the Moscow drone barrage, North
            # Korean missile launches and Hormuz.
            place = _place_of(pin.get("lat"), pin.get("lon"))
            if not place:
                continue
            g = pin.get("goldstein")
            out.append({
                "id": f"gdelt-{pin['id']}",
                "title": pin["title"],
                "sev": _sev_from_goldstein(g),
                "reason": (f"{pin.get('event_type') or 'kinetic event'} reported in "
                           f"{place} · {pin.get('mentions') or 0} mentions "
                           f"· machine-coded from a wire story"),
                "notify": True,
                "kind": "signal",
                "source": "GDELT",
                "lat": pin.get("lat"), "lon": pin.get("lon"),
                "region": pin.get("location_name"),
                "url": pin.get("source_url"),
                "created_at": f"{date}T00:00:00+00:00" if date else None,
            })
            if len(out) >= limit:
                break
    except Exception as ex:                                 # noqa: BLE001
        print(f"[live-notif] gdelt: {type(ex).__name__}: {ex}")
    return out


def geoconfirmed_items(hours: int = 48, limit: int = 30) -> list[dict]:
    """Human-verified, individually geolocated incidents."""
    out = []
    try:
        from database import GeoConfirmedPlacemark, get_db
        cutoff = (_now() - datetime.timedelta(hours=hours)).replace(tzinfo=None)
        with get_db() as db:
            rows = (db.query(GeoConfirmedPlacemark)
                      .filter(GeoConfirmedPlacemark.status == "active",
                              GeoConfirmedPlacemark.date >= cutoff)
                      .order_by(GeoConfirmedPlacemark.date.desc())
                      .limit(limit).all())
            for p in rows:
                if p.latitude is None or p.longitude is None:
                    continue
                out.append({
                    "id": f"geoconfirmed-{p.id}",
                    "title": p.title or p.description or "Confirmed incident",
                    "sev": "high",
                    # This is the strongest evidence class on the map and the
                    # reason says so, because it is what distinguishes it
                    # from the GDELT card directly above it.
                    "reason": "human-verified geolocation · GeoConfirmed",
                    "notify": True,
                    "kind": "confirm",
                    "source": "GeoConfirmed",
                    "lat": float(p.latitude), "lon": float(p.longitude),
                    "region": p.theatre_slug,
                    "created_at": p.date.isoformat() if p.date else None,
                })
    except Exception as ex:                                 # noqa: BLE001
        print(f"[live-notif] geoconfirmed: {type(ex).__name__}: {ex}")
    return out


def derived_items(limit: int = 20) -> list[dict]:
    """Surges and fusion points — the findings the system computes itself."""
    out = []
    try:
        import alerts_derived as _D
        from routers import alerts_derived as _R
        import time as _t
        at = _t.time()
        # Both return a dict, not a list, and both take an explicit limit.
        surges = (_R._surges_sync(at, 7.0, 90.0, None, limit) or {}).get("surges") or []
        for s in surges[:limit]:
            mult = s.get("mult")
            out.append({
                "id": f"surge-{s.get('id')}",
                "title": f"{s.get('cat', 'activity')} reporting surging around "
                         f"{s.get('place') or 'an unnamed cell'}",
                "sev": "high" if (mult or 0) >= 8 else "moderate",
                "reason": (f"{s.get('n')} in {int(s.get('window_days', 7))}d against "
                           f"{float(s.get('expected', 0)):.1f} expected "
                           f"— {float(mult or 0):.1f}x this cell's own baseline"),
                "notify": True,
                "kind": "surge",
                "source": "surge detection",
                "lat": s.get("lat"), "lon": s.get("lon"),
                "region": s.get("place"),
                "created_at": _now().isoformat(),
            })
        fusions = (_R._fusions_sync(at, 3.0, None, limit) or {}).get("fusions") or []
        for f in fusions[:limit]:
            mods = f.get("mods") or []
            out.append({
                "id": f"fusion-{f.get('id')}",
                "title": f.get("headline") or "Independent sources agree",
                "sev": "critical" if len(mods) >= 3 else "high",
                "reason": f"{len(mods)} independent modalities agree: {', '.join(mods)}",
                "notify": True,
                "kind": "fusion",
                "source": "fusion",
                "lat": f.get("lat"), "lon": f.get("lon"),
                "region": f.get("place"),
                "created_at": _now().isoformat(),
            })
    except Exception as ex:                                 # noqa: BLE001
        print(f"[live-notif] derived: {type(ex).__name__}: {ex}")
    return out


def frontline_items(days: int = 7, limit: int = 12) -> list[dict]:
    """Ground that changed hands, across every theatre we can see.

    THE MOST CONSEQUENTIAL THING ON THIS MAP, and until now the only feed
    with no way to interrupt anyone. A town changing sides outranks a
    machine-coded wire story about the same region by a wide margin, so
    these are severity-high by default and critical when an airport,
    port or crossing changes hands — those are the ones that alter what
    is possible next, not merely what happened.
    """
    out = []

    # Ukraine: measured area, not a list of towns.
    try:
        import frontlines as _fl
        d = _fl.changes(days=days)
        if d.get("available") and (d.get("gained_km2") or d.get("lost_km2")):
            g, l = d.get("gained_km2") or 0, d.get("lost_km2") or 0
            net = g - l
            out.append({
                "id": f"frontline-ukraine-{d['from_snapshot']['id']}-{d['to_snapshot']['id']}",
                "title": (f"Ukraine front moved: {g:.0f} km² occupied, "
                          f"{l:.0f} km² retaken in {days}d"),
                "sev": "high" if abs(net) >= 50 else "moderate",
                "reason": (f"measured between DeepStateMap snapshots "
                           f"{str(d['from_snapshot']['at'])[:10]} and "
                           f"{str(d['to_snapshot']['at'])[:10]}"),
                "notify": True,
                "kind": "escalate",
                "source": "DeepStateMap",
                "lat": None, "lon": None,
                "region": "Ukraine",
                "created_at": _now().isoformat(),
            })
    except Exception as ex:                                 # noqa: BLE001
        print(f"[live-notif] frontline ukraine: {type(ex).__name__}: {ex}")

    # The wiki theatres: named towns, which is the more actionable form.
    try:
        import wiki_warmaps as _wm
        for key in _wm.THEATRES:
            try:
                # Cached only: the tray must never wait on sixteen
                # Wikipedia round-trips. A background warm fills this.
                d = _wm.changes(key, days=days, cached_only=True)
            except Exception:                               # noqa: BLE001
                continue
            if not d.get("available"):
                continue
            for c in d["changes"]:
                if c["kind"] != "changed_hands" or not c.get("place"):
                    continue
                place = c["place"]
                strategic = bool(re.search(
                    r"\b(airport|airfield|air ?base|port|harbou?r|crossing|"
                    r"bridge|refinery|terminal|dam|power)\b", place, re.I))
                out.append({
                    "id": f"frontline-{key}-{c['lat']:.3f}-{c['lon']:.3f}-{c['to_colour']}",
                    "title": f"{place} changed hands — now {c['to']}",
                    # A crossing or an airfield changes what is possible
                    # next; a village changes what happened.
                    "sev": "critical" if strategic else "high",
                    "reason": f"{c['from']} → {c['to']} · {d['label']} · "
                              f"per the war map's own revision history",
                    "notify": True,
                    "kind": "confirm",
                    "source": _wm.SOURCE,
                    "lat": c["lat"], "lon": c["lon"],
                    "region": d["label"],
                    "created_at": _now().isoformat(),
                })
    except Exception as ex:                                 # noqa: BLE001
        print(f"[live-notif] frontline warmaps: {type(ex).__name__}: {ex}")

    # Strategic sites first, then everything else.
    out.sort(key=lambda o: 0 if o["sev"] == "critical" else 1)
    return out[:limit]


def _load_bands() -> dict:
    try:
        return json.loads(_RISK_STATE.read_text())
    except Exception:
        return {}


def _save_bands(b: dict) -> None:
    try:
        _RISK_STATE.parent.mkdir(parents=True, exist_ok=True)
        _RISK_STATE.write_text(json.dumps(b))
    except Exception as ex:                                 # noqa: BLE001
        print(f"[live-notif] risk state save: {type(ex).__name__}: {ex}")


def risk_change_items(current: list[dict]) -> list[dict]:
    """Countries whose risk BAND moved since the last check.

    A band, not a score. Scores wobble continuously as the event window
    slides, and a card for every wobble is how a feed becomes wallpaper;
    a band change is the smallest movement that means something different
    has to be done. State is persisted so a restart does not replay every
    country as newly-changed.
    """
    out = []
    prev = _load_bands()
    nxt = {}
    for row in current or []:
        iso = row.get("iso_code")
        band = row.get("band")
        if not iso or band is None:
            continue
        nxt[iso] = band
        was = prev.get(iso)
        if was is None or was == band:
            continue
        direction = "rose" if band > was else "fell"
        out.append({
            "id": f"risk-{iso}-{was}-{band}",
            "title": f"{iso} country risk {direction} to band {band}",
            "sev": "high" if band >= 4 and band > was else "moderate",
            "reason": (f"band {was} → {band} "
                       f"(score {row.get('score')}) on the GDELT risk index"),
            "notify": True,
            "kind": "escalate",
            "source": "risk index",
            "lat": None, "lon": None,
            "region": iso,
            "created_at": _now().isoformat(),
        })
    if nxt:
        _save_bands({**prev, **nxt})
    return out
