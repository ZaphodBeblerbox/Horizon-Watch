"""
vessel_identity.py — a ship we have already identified stays identified.

WHY EVERY VESSEL LOOKED LIKE "UNKNOWN". AIS splits a ship's identity from
its position across different message types. A PositionReport (type 1/2/3)
carries lat, lon, speed and heading and NO name; ShipStaticData (type 5)
carries the name, callsign and ship type and is broadcast roughly every
six minutes. So position outnumbers identity by about thirty to one, and
measured on 2,076,858 stored rows:

    position / speed / heading   100%
    ship_type known (non-zero)     2%
    name                           2.1%
    flag                           0%

The live map reads a dict that is rebuilt from scratch on every restart,
and a restarting process is flooded with position reports long before the
next static message arrives — so for the first several minutes everything
is nameless, and anything that never re-broadcasts stays nameless.

NONE OF THAT IDENTITY WAS ACTUALLY LOST. 11,745 of 30,971 distinct MMSIs
have a name somewhere in history. A ship does not stop being the Argo
because its last packet was a position report.

FLAG IS NOT EVEN A LOOKUP AGAINST HISTORY. The first three digits of an
MMSI are the MID, which is the flag state — it is derivable for every
vessel that has ever appeared, and we were storing it for none of them.
"""
from __future__ import annotations

import time

_CACHE: dict = {}
_CACHE_TTL = 30 * 60
_LOADED_AT = 0.0


def _load_known() -> dict:
    """MMSI → the best identity history holds for it.

    One pass, cached: this is thirty thousand rows and the alternative is
    a query per vessel per poll.
    """
    global _LOADED_AT
    if _CACHE and time.time() - _LOADED_AT < _CACHE_TTL:
        return _CACHE

    known: dict = {}
    try:
        from database import VesselHistory, get_db
        with get_db() as db:
            # Newest first so the first row seen for an MMSI is its most
            # recent identity — names and destinations do change.
            rows = (db.query(VesselHistory.mmsi, VesselHistory.name,
                             VesselHistory.ship_type, VesselHistory.ship_type_text,
                             VesselHistory.destination)
                      .filter(VesselHistory.name.isnot(None),
                              VesselHistory.name != "")
                      .order_by(VesselHistory.id.desc())
                      .limit(200000).all())
        for mmsi, name, stype, stext, dest in rows:
            key = str(mmsi)
            if key in known:
                continue
            known[key] = {
                "name": (name or "").strip() or None,
                "ship_type": stype if stype not in (0, "0", None) else None,
                "ship_type_text": (stext or "").strip() or None,
                "destination": (dest or "").strip() or None,
            }
    except Exception as ex:                                 # noqa: BLE001
        print(f"[vessel-identity] load failed: {type(ex).__name__}: {ex}")
        return _CACHE

    _CACHE.clear()
    _CACHE.update(known)
    _LOADED_AT = time.time()
    print(f"[vessel-identity] {len(known)} vessels identifiable from history")
    return _CACHE


def flag_of(mmsi) -> dict | None:
    """Flag state from the MMSI's MID. Always available, never a guess."""
    try:
        from mmsi_lookup import lookup_mmsi
        f = lookup_mmsi(str(mmsi))
    except Exception:                                       # noqa: BLE001
        return None
    # "Unknown"/XX is what the lookup returns for a MID it cannot place.
    # Passing that through would put a flag called "Unknown" on the map —
    # a field that looks populated and means nothing, which is worse than
    # an empty one because it stops anybody asking.
    country = (f or {}).get("flag_country")
    if not country or country.strip().lower() == "unknown":
        return None
    if str((f or {}).get("flag_iso2") or "").upper() == "XX":
        return None
    return {"flag": f.get("flag_country"), "flag_iso2": f.get("flag_iso2"),
            "flag_emoji": f.get("flag_emoji")}


def enrich(vessel: dict) -> dict:
    """Fill in what we already know about this ship.

    Only ever ADDS. A live packet always wins over history — if the ship
    is broadcasting a name right now, that is the name, and a stale one
    from last week must not overwrite it.
    """
    if not vessel:
        return vessel
    mmsi = str(vessel.get("mmsi") or "").strip()
    if not mmsi:
        return vessel

    out = dict(vessel)
    known = _load_known().get(mmsi)
    if known:
        for field in ("name", "ship_type_text", "destination"):
            if not out.get(field) and known.get(field):
                out[field] = known[field]
                out.setdefault("identity_from", {})[field] = "earlier AIS static message"
        if known.get("ship_type") and out.get("ship_type") in (None, 0, "0"):
            out["ship_type"] = known["ship_type"]
            out.setdefault("identity_from", {})["ship_type"] = "earlier AIS static message"

    f = flag_of(mmsi)
    if f and not out.get("flag"):
        out.update(f)
        out.setdefault("identity_from", {})["flag"] = "MMSI maritime identification digits"

    # Say plainly that nobody has told us, rather than leaving a blank the
    # reader has to interpret.
    if not out.get("name"):
        out["name_status"] = "no AIS static message seen for this MMSI yet"
    return out


def enrich_all(vessels: list) -> list:
    _load_known()
    return [enrich(v) for v in vessels or []]


def stats() -> dict:
    known = _load_known()
    return {"identifiable": len(known), "cached_at": _LOADED_AT}
