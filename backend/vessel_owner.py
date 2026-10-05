"""
vessel_owner.py — who owns the ship, from the registry, by MMSI.

The flag is free (mmsi_lookup: the MID), and it is the least useful hop:
a Liberian flag says where a ship is registered, not who stands behind
it. Nothing local carries ownership — sanctioned_entities.owner_chain is
empty across all 458k rows, ftm_things knows 1,370 MMSIs, and name
prefixes (MSC, Maersk) resolve 2.1% of this feed.

Global Fishing Watch's vessel-identity dataset does: registry records
with the registered owner, the owner's country, the source (IMO, national
registers) and the period it held. GFW_TOKEN is already in backend/.env.

WHAT THIS IS AND IS NOT. A REGISTERED OWNER, not an operator or a
beneficial owner; it says so in what it returns. Measured on 25 random
live vessels: 5 have one, 15 are known to GFW only from their own AIS, 4
are not found — the feed is mostly small European craft. Where it hits it
is the hop the flag hides: a Liberia-flagged ship owned by Harren
Partner, Germany.

THE MODEL OF IDENTITY. GFW returns several candidate entries per query.
Only an owner record whose own ssvid equals the MMSI asked about counts,
and if more than one owner name shares the latest period, nothing is
returned: two owners at once is a question, not an answer.

Lookups happen when someone opens a vessel, never in bulk. The raw
response is cached (the expensive input); the owner is derived on read,
so a fix here reaches cached vessels at once.
"""
from __future__ import annotations

import json as _json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://gateway.api.globalfishingwatch.org/v3/vessels/search"
DATASET = "public-global-vessel-identity:latest"
CACHE_TTL_S = 24 * 3600
CACHE_MAX = 5000
BACKOFF_S = 300

_cache: dict[str, tuple[float, dict | None]] = {}
_backoff_until = 0.0


def _token() -> str | None:
    return (os.getenv("GFW_TOKEN") or "").strip() or None


def _is_ship_mmsi(mmsi: str) -> bool:
    return len(mmsi) == 9 and mmsi.isdigit() and mmsi[0] in "234567"


def fetch(mmsi: str) -> dict | None:
    """The raw GFW search response for one MMSI, cached; None if unavailable.

    A refusal (403/429/5xx) backs off for five minutes rather than retrying
    on every click: it is someone else's rate limit.
    """
    global _backoff_until
    now = time.time()
    hit = _cache.get(mmsi)
    if hit and now - hit[0] < CACHE_TTL_S:
        return hit[1]
    tok = _token()
    if not tok or now < _backoff_until:
        return None
    q = urllib.parse.urlencode([("query", mmsi), ("datasets[0]", DATASET),
                                ("includes[0]", "OWNERSHIP")])
    # GFW's edge refuses Python's default User-Agent with a 403.
    req = urllib.request.Request(f"{BASE}?{q}", headers={
        "Authorization": f"Bearer {tok}", "User-Agent": "HorizonWatch/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = _json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code in (403, 429) or e.code >= 500:
            _backoff_until = now + BACKOFF_S
        return None
    except Exception:
        return None
    if len(_cache) >= CACHE_MAX:
        _cache.pop(next(iter(_cache)))
    _cache[mmsi] = (now, raw)
    return raw


def owner_from(raw: dict | None, mmsi: str) -> dict:
    """Derive {owner, registry, reason} from a GFW response. Pure."""
    ents = (raw or {}).get("entries") or []
    owners = [o for e in ents for o in (e.get("registryOwners") or [])
              if str(o.get("ssvid")) == mmsi and o.get("name")]
    regs = [r for e in ents for r in (e.get("registryInfo") or [])
            if str(r.get("ssvid")) == mmsi]
    registry = None
    if regs:
        r = max(regs, key=lambda r: str(r.get("transmissionDateTo") or r.get("latestVesselInfo") or ""))
        registry = {k: r.get(k) for k in ("shipname", "imo", "callsign") if r.get(k)}

    if not owners:
        reason = ("No registry record for this MMSI." if not ents and raw is not None
                  else "Registered, but no owner on record." if regs
                  else "Known only from its own AIS broadcasts; no registry record."
                  if ents else "Registry lookup unavailable.")
        return {"owner": None, "registry": registry, "reason": reason}

    latest = max(str(o.get("dateTo") or "") for o in owners)
    current = {o["name"].strip(): o for o in owners if str(o.get("dateTo") or "") == latest}
    if len(current) > 1:
        return {"owner": None, "registry": registry,
                "reason": f"Registry lists {len(current)} owners for the same period: "
                          + ", ".join(sorted(current)) + "."}
    name, o = next(iter(current.items()))
    try:
        from location_extract import country_name_from_code
        country = country_name_from_code(o.get("flag") or "")
    except Exception:
        country = None
    return {
        "owner": {
            "name": name,
            "country": country,
            "since": (o.get("dateFrom") or "")[:10] or None,
            "until": (o.get("dateTo") or "")[:10] or None,
            "source": ", ".join(o.get("sourceCode") or []) or None,
            "kind": "registered owner",
        },
        "registry": registry,
        "reason": None,
    }


def lookup(mmsi) -> dict:
    m = str(mmsi or "").strip()
    if not _is_ship_mmsi(m):
        return {"owner": None, "registry": None,
                "reason": "Not a ship MMSI, so there is no registry to ask."}
    return owner_from(fetch(m), m)
