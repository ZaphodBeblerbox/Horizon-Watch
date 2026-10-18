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

import threading
import time

_CACHE: dict = {}
_CACHE_TTL = 30 * 60
#: After a failed load, try again this soon rather than on every call.
_RETRY_AFTER_FAILURE_S = 60
_LOADED_AT = 0.0
#: Set while a load is running, so a second caller never starts another.
_LOADING = threading.Event()
_LOAD_LOCK = threading.Lock()


def _stale(now: float | None = None) -> bool:
    return ((now or time.time()) - _LOADED_AT) >= _CACHE_TTL


def _load_known(block: bool = False) -> dict:
    """MMSI → the best identity history holds for it.

    One pass, cached: this is thirty thousand rows and the alternative is
    a query per vessel per poll.

    THE CACHE USED TO BE KEYED ON ITS OWN CONTENTS (`if _CACHE and fresh`).
    When history held no named vessel at all — production on 2026-10-18,
    "[vessel-identity] 0 vessels identifiable from history" three thousand
    times a minute — an empty dict counted as "not loaded", so enrich()
    re-ran the whole-table query for EVERY vessel: 2,500 queries per
    /api/ais/vessels, on the event loop. The loop was blocked 55-70% of
    wall-clock for half an hour (12:50-13:20 UTC), and every endpoint, the
    health check included, timed out for every user. Freshness is now a
    property of WHEN we loaded, never of WHAT we found: an empty answer is
    an answer, and a failure is retried after a minute, not per vessel.

    NEVER ON A REQUEST'S CLOCK. The query scans a multi-million-row table
    on a network volume; a caller gets whatever is cached now and the
    refresh runs in a thread of its own (one at a time). `block=True` is
    for scripts and tests that want the answer before they go on.
    """
    if not _stale():
        return _CACHE
    if block:
        _refresh()
        return _CACHE
    if not _LOADING.is_set():
        # Set BEFORE the thread starts, or two callers both start one.
        _LOADING.set()
        try:
            threading.Thread(target=_refresh, args=(True,), name="vessel-identity",
                             daemon=True).start()
        except Exception:                                   # noqa: BLE001
            _LOADING.clear()
    return _CACHE


def _refresh(owned: bool = False) -> None:
    """Load identities from history, then swap them in (never clear first)."""
    global _LOADED_AT
    with _LOAD_LOCK:
        try:
            if not _stale():
                return
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
                    # TWO DIFFERENT SHAPES UNDER ONE NAME. The live path stores
                    # ship_type as a human label ("Cargo"); the history column
                    # stores the numeric AIS code (70). Copying the number into
                    # the live field broke the map outright — the client calls
                    # .toLowerCase() on it. Only the label is ever carried.
                    known[key] = {
                        "name": (name or "").strip() or None,
                        "ship_type": (stext or "").strip() or None,
                        "ship_type_code": stype if stype not in (0, "0", None) else None,
                        "destination": (dest or "").strip() or None,
                    }
            except Exception as ex:                         # noqa: BLE001
                print(f"[vessel-identity] load failed: {type(ex).__name__}: {ex}")
                # Keep what we had, and do not ask again for a minute.
                _LOADED_AT = time.time() - _CACHE_TTL + _RETRY_AFTER_FAILURE_S
                return
            _CACHE.clear()
            _CACHE.update(known)
            _LOADED_AT = time.time()
            print(f"[vessel-identity] {len(known)} vessels identifiable from history")
        finally:
            if owned:
                _LOADING.clear()


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


def enrich(vessel: dict, _known: dict | None = None) -> dict:
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
    known = (_known if _known is not None else _load_known()).get(mmsi)
    if known:
        for field in ("name", "destination"):
            if not out.get(field) and known.get(field):
                out[field] = known[field]
                out.setdefault("identity_from", {})[field] = "earlier AIS static message"
        # Always a label, never the numeric code — see above.
        if known.get("ship_type") and not out.get("ship_type"):
            out["ship_type"] = known["ship_type"]
            out["ship_type_text"] = known["ship_type"]
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
    known = _load_known()               # once per batch, never per vessel
    return [enrich(v, known) for v in vessels or []]


def stats() -> dict:
    known = _load_known()
    return {"identifiable": len(known), "cached_at": _LOADED_AT}
