"""
evacuation.py — ADVISE EVACUATION: a person in danger is sent, in one press,
the safest way to one of our SAFE HOUSES (owner, 2026-10-12: "press 'Advise
for Evacuation' for a person; they get the signal and automatically get the
safest exit route, leading to our predetermined safe houses … If the safe
house is not inside the country itself, find the quickest way to the safest
airport — the safest route out of the country, even multi-hop — creative
ways to get the asset to the safe house").

SAFE HOUSES are assets of kind "safe_house" (owned_assets.py), their own
fields in `details`: capacity / occupancy, status open|closed, contact, and
who may use one (allowed_users / allowed_teams — empty: anyone who can see
the house). usable() drops the closed, the full (occupancy + evacuations
already sent there in the last day ≥ capacity) and those this person may not
use, each with its reason.

THE PLAN (build). From the person's LIVE position:
  1. IN-COUNTRY: the usable safe houses in the same country (country_at —
     the borders in geo/countries.geojson) are routed to with safe_route.plan
     (explicit destinations, exposure-scored, never through a hazard core).
     If one is reachable, the itineraries are those ("direct").
  2. ABROAD, when no safe house in the country is reachable (or there is
     none, or a house abroad was asked for): for the nearest houses abroad,
       · OVERLAND via a border crossing (border_crossings.json, curated; else
         OSM barrier=border_control from Overpass, cached) — ground →
         crossing → ground; the crossing's risk from our own signals near it;
       · BY AIR: ground to one of the safest airports near the person
         (large/medium with an IATA code, in the same country, not inside a
         danger ring, best ground route), the flight scored by air_route
         (conflict-zone bulletins, GPS interference … — a do-not-operate area
         on the path rules it out), then ground from the airport nearest the
         house; flight availability is NOT known: "check flights";
       · BY SEA (sea_route) only when neither of those works.
  3. Every itinerary is scored: total exposure (ground legs: safe_route's
     weight × minutes; air: air_route's weight × minutes; a crossing: its
     base risk + our signals there) + TIME_COST_PER_H per hour door to door
     (airport and border waits included). The best 3 are offered, marked
     recommended / fastest / lowest exposure, each with what is ASSUMED.
  4. Nothing safe now: SHELTER at the nearest safe point away from the
     dangers (safe_route's automatic exit) and re-plan.

SENDING (advise). The plan is saved (route_plans, purpose "evacuate") and
sent with asset_warnings.send(kind="evacuate", route={route_plan_id,
safe_house, legs …}): the person's red takeover reads EVACUATE, sounds its
alarm, and "Open the route" opens the itinerary. The sender sees the
acknowledgement (asset_warnings) and the PROGRESS (progress()): the person's
live position against the route — leg, distance left, ETA, off-route.

Blocking parts (SQLite, shapely, air_route) run in threads; the ground
routers are async (safe_route).
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import json
import math
import re
import time
from pathlib import Path

import safe_route as sr

CODE_DIR = Path(__file__).resolve().parent
CROSSINGS_PATH = CODE_DIR / "border_crossings.json"
COUNTRIES_PATH = CODE_DIR / "geo" / "countries.geojson"

TIME_COST_PER_H = 0.25          # exposure units one hour door to door is worth
AIRPORT_BEFORE_H = 2.0          # check-in, security, boarding — an assumption, said so
AIRPORT_AFTER_H = 0.5           # landing to kerb
FLIGHT_EXTRA_MIN = 25           # taxi, climb and descent on top of air_route's cruise-speed minutes
BORDER_WAIT_H = 1.0             # outside Schengen; 0.25 inside
BORDER_BASE_RISK = 0.6          # a border post is a place things go wrong; 0.1 inside Schengen
ORIGIN_AIRPORT_KM = 350
DEST_AIRPORT_KM = 250
MAX_OVERLAND_KM = 1500
ABROAD_HOUSES = 2               # the nearest houses abroad tried
OFF_ROUTE_M = {"foot": 80, "car": 300, "truck": 300}
ARRIVED_M = 150
LONG_LEG_M = 6000               # a leg longer than this is driven whatever the mode asked
RESERVE_HOURS = 24
MAX_ITINERARIES = 3


# ── countries ──────────────────────────────────────────────────────────────
# geo/countries.geojson gives France, Norway and Kosovo as "-99" (Natural
# Earth); their codes are put back by name here.
_FIX = {"France": ("FRA", "FR"), "Norway": ("NOR", "NO"), "Kosovo": ("XKX", "XK")}
_CTRY = None


def _countries():
    global _CTRY
    if _CTRY is None:
        import shapely
        from shapely.geometry import shape
        rows = []
        for f in json.loads(COUNTRIES_PATH.read_text()).get("features") or []:
            p = f.get("properties") or {}
            iso3, iso2 = p.get("ISO3166-1-Alpha-3"), p.get("ISO3166-1-Alpha-2")
            if iso3 in (None, "-99"):
                iso3, iso2 = _FIX.get(p.get("name"), (None, None))
            if not iso3:
                continue
            try:
                g = shape(f["geometry"]).buffer(0)
            except Exception:                                # noqa: BLE001
                continue
            rows.append((iso3, iso2, p.get("name") or iso3, g))
        _CTRY = (rows, shapely.STRtree([r[3] for r in rows]))
    return _CTRY


def country_at(lat: float, lon: float) -> dict | None:
    """{iso3, iso2, name} of the country at a point (the nearest within ~30 km on a coast)."""
    from shapely.geometry import Point
    rows, tree = _countries()
    pt = Point(float(lon), float(lat))
    hit = tree.query(pt, predicate="within")
    if len(hit):
        r = rows[int(hit[0])]
    else:
        i = tree.nearest(pt)
        if i is None or rows[int(i)][3].distance(pt) > 0.3:
            return None
        r = rows[int(i)]
    return {"iso3": r[0], "iso2": r[1], "name": r[2]}


# ── safe houses ────────────────────────────────────────────────────────────

def _uid(user: dict) -> str:
    return str(user.get("id") or user.get("email"))


def house_view(a: dict, reserved: int = 0) -> dict:
    d = a.get("details") or {}
    return {"id": a["id"], "name": a["name"], "kind": a.get("kind"), "kind_label": a.get("kind_label"),
            "declared": a.get("kind") != "safe_house", "lat": a.get("lat"), "lon": a.get("lon"), "address": a.get("address"),
            "country": a.get("country"), "notes": a.get("notes"), "status": d.get("status") or "open",
            "capacity": d.get("capacity"), "occupancy": d.get("occupancy"), "reserved": reserved,
            "contact": d.get("contact"), "allowed_users": d.get("allowed_users") or [], "allowed_teams": d.get("allowed_teams") or [],
            "owner_id": a.get("owner_id"), "shared": a.get("shared")}


def visible_houses(user: dict) -> list[dict]:
    """The safe houses this user can see: their own, shared ones, all of them for an admin."""
    import owned_assets as oa
    import position_stream as ps
    # of the kind, or any building declared one (details.safe_house)
    out = {a["id"]: a for a in oa.list_for(_uid(user)) if oa.is_safe_house(a)}
    if ps.is_admin(user):
        con = oa._con()
        try:
            for r in con.execute("SELECT * FROM owned_assets WHERE kind='safe_house' OR json_extract(details, '$.safe_house') = 1"):
                a = oa._row(r)
                if oa.is_safe_house(a):
                    out.setdefault(a["id"], a)
        finally:
            con.close()
    return list(out.values())


def may_use(house: dict, person: dict | None) -> bool:
    users, teams = house.get("allowed_users") or [], house.get("allowed_teams") or []
    if not users and not teams:
        return True
    if not person:
        return False
    import position_stream as ps
    if str(person.get("id")) in users:
        return True
    keys = {str(t).strip().lower() for t in teams}
    return bool((person.get("team_id") and str(person["team_id"]).lower() in keys)
                or (ps.company_key(person.get("company")) and ps.company_key(person.get("company")) in {ps.company_key(t) for t in teams}))


def reservations(now: _dt.datetime | None = None) -> dict:
    """Evacuations sent to each house in the last day, not withdrawn: places taken."""
    import asset_warnings as aw
    since = ((now or _dt.datetime.now(_dt.timezone.utc)) - _dt.timedelta(hours=RESERVE_HOURS)).isoformat()
    con = aw._con()
    try:
        rows = con.execute("SELECT route FROM warnings WHERE kind='evacuate' AND cancelled_at IS NULL AND created_at >= ?", (since,)).fetchall()
    finally:
        con.close()
    out: dict = {}
    for (r,) in rows:
        try:
            hid = (json.loads(r or "{}") or {}).get("safe_house_id")
        except (TypeError, ValueError):
            hid = None
        if hid:
            out[hid] = out.get(hid, 0) + 1
    return out


def usable(houses: list[dict], person: dict | None, reserved: dict | None = None) -> tuple[list[dict], list[dict]]:
    """-> (usable house views, [{house, reason}] left out)."""
    reserved = reserved or {}
    ok, out = [], []
    for a in houses:
        h = house_view(a, reserved.get(a["id"], 0))
        if h["lat"] is None or h["lon"] is None:
            out.append({"house": h, "reason": "no position"})
        elif h["status"] != "open":
            out.append({"house": h, "reason": "closed"})
        elif h["capacity"] is not None and (h["occupancy"] or 0) + h["reserved"] >= h["capacity"]:
            out.append({"house": h, "reason": f"full ({(h['occupancy'] or 0) + h['reserved']} of {h['capacity']})"})
        elif not may_use(h, person):
            out.append({"house": h, "reason": "not for this person"})
        else:
            ok.append(h)
    return ok, out


# ── airports, crossings ────────────────────────────────────────────────────

_MILITARY = re.compile(r"\b(air base|airbase|base a[ée]rienne|military|naval air|army air|RAF|AFB|BA \d+)\b", re.I)


def airports_near(lat: float, lon: float, km: float, iso2: str | None = None, limit: int = 4) -> list[dict]:
    """Large / medium airports with an IATA code (scheduled service, roughly) within km, nearest first."""
    import air_route as ar
    dlat = km / 111.0
    dlon = km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    q = ("SELECT * FROM airports WHERE airport_type IN ('large_airport','medium_airport') AND iata_code IS NOT NULL "
         "AND iata_code != '' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?")
    args = [lat - dlat, lat + dlat, lon - dlon, lon + dlon]
    if iso2:
        q += " AND country_code = ?"
        args.append(iso2)
    try:
        con = ar._ro()
    except Exception:                                        # noqa: BLE001
        return []
    try:
        rows = [ar._ap(r) for r in con.execute(q, args)]
    except Exception:                                        # noqa: BLE001
        rows = []
    finally:
        con.close()
    for a in rows:
        a["distance_km"] = round(sr.metres(lat, lon, a["lat"], a["lon"]) / 1000, 1)
        a["code"] = a.get("iata") or a.get("icao")
    # an air base is not a way out for a civilian
    rows = [a for a in rows if a["distance_km"] <= km and not _MILITARY.search(a.get("name") or "")]
    # A LARGE AIRPORT WHEN THERE IS ONE: a medium one with an IATA code can be a
    # flying club's field (Toussus-le-Noble near Paris) — no airline to take
    if any(a.get("type") == "large_airport" for a in rows):
        rows = [a for a in rows if a.get("type") == "large_airport"]
    # a large airport is worth some extra road: more flights, more ways out
    rows.sort(key=lambda a: a["distance_km"] * (0.6 if a.get("type") == "large_airport" else 1.0))
    return rows[:limit]


def curated_crossings() -> list[dict]:
    try:
        return json.loads(CROSSINGS_PATH.read_text()).get("crossings") or []
    except (OSError, ValueError):
        return []


_OSM_CROSSINGS: dict = {}


async def osm_crossings(s: float, w: float, n: float, e: float) -> list[dict]:
    """OSM border_control nodes in a box (Overpass; cached a day; [] when it is down)."""
    key = tuple(round(v, 1) for v in (s, w, n, e))
    hit = _OSM_CROSSINGS.get(key)
    if hit and time.time() - hit[0] < 86400:
        return hit[1]
    import httpx
    q = f'[out:json][timeout:10];node["barrier"="border_control"]({s},{w},{n},{e});out 300;'
    out: list[dict] = []
    for url in sr.OVERPASS_URLS[:2]:
        try:
            wait = sr._slot("overpass")
            if wait > 0:
                await asyncio.sleep(wait)
            async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": sr.USER_AGENT}) as c:
                r = await c.post(url, data={"data": q})
            for el in r.json().get("elements") or []:
                t = el.get("tags") or {}
                out.append({"id": f"osm-{el['id']}", "name": t.get("name") or t.get("name:en") or "Border control",
                            "lat": el["lat"], "lon": el["lon"], "countries": None, "road": None, "source": "OSM"})
            break
        except Exception:                                    # noqa: BLE001
            continue
    _OSM_CROSSINGS[key] = (time.time(), out)
    return out


def crossings_for(origin: tuple, house: dict, iso_o: str | None, iso_h: str | None, pool: list[dict],
                  max_detour: float = 1.35, limit: int = 2) -> list[dict]:
    """Crossings out of the origin's country on the way to the house: the
    pair's own first, then any out of the country with a small detour."""
    direct = max(1.0, sr.metres(origin[0], origin[1], house["lat"], house["lon"]))
    out = []
    for c in pool:
        cs = set(c.get("countries") or [])
        if cs and iso_o and iso_o not in cs:
            continue
        via = sr.metres(origin[0], origin[1], c["lat"], c["lon"]) + sr.metres(c["lat"], c["lon"], house["lat"], house["lon"])
        ratio = via / direct
        if ratio > max_detour:
            continue
        pair = bool(iso_h and cs == {iso_o, iso_h})
        out.append((0 if pair else 1, ratio, c))
    out.sort(key=lambda x: (x[0], x[1]))
    return [c for _, _, c in out[:limit]]


# ── legs ───────────────────────────────────────────────────────────────────

def _dur(s: float) -> str:
    m = int(round((s or 0) / 60))
    return f"{m // 60} h {m % 60:02d}" if m >= 60 else f"{max(1, m)} min"


def _pt(p: dict) -> dict:
    return {"lat": round(float(p["lat"]), 6), "lon": round(float(p["lon"]), 6), "name": p.get("name")}


def ground_leg(route: dict, frm: dict, to: dict, mode: str) -> dict:
    md = sr.mode_of(mode)
    return {"kind": "ground", "mode": md["name"], "mode_label": md["label"],
            "label": f"{'Walk' if md['name'] == 'foot' else 'Drive'} to {to.get('name') or 'the next point'}",
            "from": _pt(frm), "to": _pt(to), "coords": route["coords"], "steps": route.get("steps") or [],
            "distance_m": route["distance_m"], "duration_s": route["duration_s"], "wait_s": 0,
            "duration_label": route.get("duration_label") or _dur(route["duration_s"]),
            "exposure": route.get("exposure") or 0.0, "through_core": route.get("through_core") or [],
            "leave_via": route.get("leave_via"), "closest": route.get("closest") or [], "router": route.get("router"),
            "links": sr.map_links(route, (frm["lat"], frm["lon"]), md["maps"])}


def air_leg(o: dict, d: dict, ap: dict) -> dict | None:
    """The recommended path of an air_route plan as a leg; None when every
    path crosses a do-not-operate area."""
    cands = ap.get("candidates") or []
    c = next((x for x in cands if x.get("key") == ap.get("recommended")), cands[0] if cands else None)
    if not c or (c.get("score") or {}).get("hard_minutes", 0) > 0:
        return None
    sc = c["score"]
    dur_s = (sc["minutes"] + FLIGHT_EXTRA_MIN) * 60
    wait = (AIRPORT_BEFORE_H + AIRPORT_AFTER_H) * 3600
    name = lambda a: f"{a.get('code')} {a.get('city') or a.get('name') or ''}".strip()   # noqa: E731
    return {"kind": "air", "mode": "air", "mode_label": "Flight", "label": f"Fly {name(o)} → {name(d)}",
            "from": {**_pt(o), "name": o.get("name"), "code": o.get("code")}, "to": {**_pt(d), "name": d.get("name"), "code": d.get("code")},
            "coords": c["coords"], "distance_m": round(sc["distance_km"] * 1000), "duration_s": round(dur_s), "wait_s": round(wait),
            "duration_label": f"~{_dur(dur_s)} gate to gate", "exposure": round(float(sc["exposure"]), 3), "risk": c.get("risk"),
            "through_core": [], "path_label": c.get("label"),
            "steps": [{"text": f"Go to {o.get('name')} ({o.get('code')}). Allow about {AIRPORT_BEFORE_H:g} h before departure."},
                      {"text": f"Fly to {d.get('name')} ({d.get('code')}) — about {_dur(dur_s)} in the air."
                               f"{' ' + ap['tradeoff'] if ap.get('tradeoff') else ''}"},
                      {"text": "Flight availability is NOT known here — check flights before you go."}],
            "assumptions": ["Flight availability, seats and schedules are not known — check flights.",
                            f"{AIRPORT_BEFORE_H:g} h at the departure airport and {AIRPORT_AFTER_H:g} h at arrival assumed; "
                            f"flight time from cruise speed plus {FLIGHT_EXTRA_MIN} min for taxi, climb and descent."]
                           + list(ap.get("warnings") or [])[:2]}


def border_leg(c: dict, hazards: list[dict]) -> dict:
    schengen = bool(c.get("schengen"))
    near = [h for h in hazards if sr.metres(c["lat"], c["lon"], h["lat"], h["lon"]) <= max(3000, 2 * h["radius_m"])]
    risk = (0.1 if schengen else BORDER_BASE_RISK) + sum(h["weight"] for h in near)
    wait = (0.25 if schengen else BORDER_WAIT_H) * 3600
    status = (f"{len(near)} danger(s) reported near it: " + "; ".join(f"{h['label']}" for h in near[:3])) if near \
        else "nothing reported near it in our signals"
    return {"kind": "border", "mode": "border", "mode_label": "Border crossing", "label": f"Cross at {c['name']}",
            "from": _pt(c), "to": _pt(c), "coords": [[c["lat"], c["lon"]]], "distance_m": 0, "duration_s": 0, "wait_s": round(wait),
            "duration_label": f"allow ~{_dur(wait)}", "exposure": round(risk, 3), "through_core": [],
            "crossing": {"id": c.get("id"), "name": c["name"], "road": c.get("road"), "countries": c.get("countries"),
                         "schengen": schengen, "source": c.get("source") or "curated", "note": c.get("note")},
            "steps": [{"text": f"Cross the border at {c['name']}{' (' + c['road'] + ')' if c.get('road') else ''}.", "lat": c["lat"], "lon": c["lon"]},
                      {"text": f"Border status from our signals only — {status}. Carry your passport."}],
            "assumptions": ["Border status is known only from our own signals — it may be closed or slow without our knowing.",
                            f"About {_dur(wait)} at the crossing assumed."]}


def itinerary(kind: str, legs: list[dict], house: dict | None, extra: list[str] | None = None) -> dict:
    exp = round(sum(float(l.get("exposure") or 0) for l in legs), 3)
    secs = sum((l.get("duration_s") or 0) + (l.get("wait_s") or 0) for l in legs)
    score = round(exp + TIME_COST_PER_H * secs / 3600, 3)
    parts = []
    for l in legs:
        if l["kind"] == "ground":
            parts.append(f"{'walk' if l['mode'] == 'foot' else 'drive'} {l['duration_label']} to {l['to'].get('name') or 'the next point'}")
        elif l["kind"] == "air":
            parts.append(f"fly {l['from'].get('code')} → {l['to'].get('code')} (~{_dur(l['duration_s'])} — check flights)")
        elif l["kind"] == "border":
            parts.append(f"cross at {l['crossing']['name']}")
        elif l["kind"] == "sea":
            parts.append(f"sail {l['from'].get('name')} → {l['to'].get('name')} (~{_dur(l['duration_s'])} — check sailings)")
    text = ", ".join(parts)
    title = {"direct": "Direct", "air": "By air", "overland": "Overland", "sea": "By sea", "shelter": "Shelter, then re-plan"}.get(kind, kind)
    key = f"{kind}:" + "|".join(f"{l['mode']}@{l['to']['lat']:.3f},{l['to']['lon']:.3f}" for l in legs)
    assumptions = [a for l in legs for a in (l.get("assumptions") or [])] + list(extra or [])
    return {"key": key, "kind": kind, "title": title, "summary": (text[:1].upper() + text[1:] + ".") if text else "",
            "legs": legs, "duration_s": round(secs), "duration_label": _dur(secs), "exposure": exp, "score": score,
            "destination": house, "assumptions": list(dict.fromkeys(assumptions)), "ok": not any(l.get("through_core") for l in legs)}


# ── planning ───────────────────────────────────────────────────────────────

def _same(a: dict, b: dict) -> bool:
    return abs(float(a["lat"]) - float(b["lat"])) < 1e-6 and abs(float(a["lon"]) - float(b["lon"])) < 1e-6


async def ground_best(origin: tuple, dests: list[dict], mode: str, hazards: list[dict], now, fetchers: dict) -> list:
    """[(dest, best safe route or None)] — one safe_route.plan per MAX_DESTINATIONS."""
    out = []
    for i in range(0, len(dests), sr.MAX_DESTINATIONS):
        chunk = dests[i:i + sr.MAX_DESTINATIONS]
        dl = [{"lat": d["lat"], "lon": d["lon"], "name": d.get("name"), **({"id": d["id"]} if d.get("id") else {})} for d in chunk]
        # IN A THREAD WITH ITS OWN LOOP: scoring a 500 km route against dozens of
        # hazards (15 m samples) is seconds of pure Python — never on the server's loop
        p = await asyncio.to_thread(lambda: asyncio.run(sr.plan(origin[0], origin[1], mode, hazards=hazards, now=now, use_pois=False,
                                                                destinations=dl, **fetchers)))
        for d in chunk:
            rs = [c for c in p.get("candidates") or [] if not c["through_core"] and _same(c["dest"], d)]
            out.append((d, min(rs, key=lambda c: (c["score"], c["duration_s"])) if rs else None))
    return out


def _leg_mode(mode: str, a: dict, b: dict) -> str:
    return "car" if mode == "foot" and sr.metres(a["lat"], a["lon"], b["lat"], b["lon"]) > LONG_LEG_M else mode


class Deps:
    """What the planner calls out to — replaced in tests."""

    def __init__(self, hazards_at=None, air_plan=None, airports=None, crossings=None, osm=None, sea_plan=None, ports=None,
                 fetch_valhalla=None, fetch_osrm=None):
        self.hazards_at = hazards_at or (lambda lat, lon, km, now: sr.hazards_near(lat, lon, km, now))
        self.air_plan = air_plan or _default_air
        self.airports = airports or airports_near
        self.crossings = crossings or curated_crossings
        self.osm = osm if osm is not None else osm_crossings
        self.sea_plan = sea_plan or _default_sea
        self.ports = ports or _default_ports
        self.fetchers = {k: v for k, v in (("fetch_valhalla", fetch_valhalla), ("fetch_osrm", fetch_osrm)) if v}


def _default_air(o: dict, d: dict) -> dict:
    import air_route as ar
    return ar.plan({"lat": o["lat"], "lon": o["lon"], "code": o.get("code"), "name": o.get("name")},
                   {"lat": d["lat"], "lon": d["lon"], "code": d.get("code"), "name": d.get("name")}, ar.hazard_set())


def _default_sea(o: dict, d: dict) -> dict:
    import sea_route as sea
    return sea.plan((o["lat"], o["lon"]), (d["lat"], d["lon"]), ship_type="passenger", origin_name=o.get("name"), dest_name=d.get("name"))


def _default_ports(lat: float, lon: float, km: float) -> list[dict]:
    import sea_route as sea
    out = [dict(p, distance_km=round(sr.metres(lat, lon, p["lat"], p["lon"]) / 1000, 1)) for p in sea.ports() if p.get("major")]
    return sorted([p for p in out if p["distance_km"] <= km], key=lambda p: p["distance_km"])[:2]


async def _hz(deps: Deps, lat: float, lon: float, km: float, now) -> list[dict]:
    try:
        return await asyncio.to_thread(deps.hazards_at, lat, lon, km, now)
    except Exception as e:                                   # noqa: BLE001
        print(f"[evacuation] error: hazards: {type(e).__name__}: {e}", flush=True)
        return []


async def via_air(origin: tuple, house: dict, mode: str, iso2: str | None, hz0: list[dict], deps: Deps, now) -> list[dict]:
    """ground → the safest airport near the person → flight → ground to the house."""
    o_aps = await asyncio.to_thread(deps.airports, origin[0], origin[1], ORIGIN_AIRPORT_KM, iso2, 4)
    # an airport inside a danger ring is no way out
    o_aps = [a for a in o_aps if not any(sr.metres(a["lat"], a["lon"], h["lat"], h["lon"]) <= h["radius_m"] and h["weight"] >= 0.3 for h in hz0)]
    d_aps = await asyncio.to_thread(deps.airports, house["lat"], house["lon"], DEST_AIRPORT_KM, None, 2)
    if not o_aps or not d_aps:
        return []
    start = {"lat": origin[0], "lon": origin[1], "name": "your position"}
    reach = await ground_best(origin, o_aps, _leg_mode(mode, start, o_aps[0]), hz0, now, deps.fetchers)
    reach = sorted([(a, r) for a, r in reach if r], key=lambda x: (x[1]["score"], x[1]["duration_s"]))[:2]
    out = []
    for d_ap in d_aps[:1]:
        hz_d = await _hz(deps, d_ap["lat"], d_ap["lon"], 40.0, now)
        last = None
        if sr.metres(d_ap["lat"], d_ap["lon"], house["lat"], house["lon"]) > 200:
            got = await ground_best((d_ap["lat"], d_ap["lon"]), [house], _leg_mode(mode, d_ap, house), hz_d, now, deps.fetchers)
            last = got[0][1]
            if not last:
                continue
        for o_ap, r1 in reach:
            if o_ap.get("code") == d_ap.get("code"):
                continue
            try:
                ap = await asyncio.to_thread(deps.air_plan, o_ap, d_ap)
            except Exception as e:                           # noqa: BLE001
                print(f"[evacuation] error: air plan {o_ap.get('code')}→{d_ap.get('code')}: {type(e).__name__}: {e}", flush=True)
                continue
            leg = air_leg(o_ap, d_ap, ap)
            if not leg:
                continue
            legs = [ground_leg(r1, start, {**o_ap, "name": f"{o_ap.get('name')} ({o_ap.get('code')})"}, r1["mode"]), leg]
            if last:
                legs.append(ground_leg(last, {**d_ap, "name": d_ap.get("name")}, house, last["mode"]))
            out.append(itinerary("air", legs, house))
    return out


async def via_border(origin: tuple, house: dict, mode: str, iso_o: str | None, iso_h: str | None, hz0: list[dict],
                     deps: Deps, now) -> list[dict]:
    """ground → a border crossing → ground to the house."""
    if sr.metres(origin[0], origin[1], house["lat"], house["lon"]) > MAX_OVERLAND_KM * 1000:
        return []
    pool = await asyncio.to_thread(deps.crossings)
    picks = crossings_for(origin, house, iso_o, iso_h, pool)
    if not picks and deps.osm:
        s, n = sorted((origin[0], house["lat"]))
        w, e = sorted((origin[1], house["lon"]))
        if n - s < 8 and e - w < 8:
            osm = await deps.osm(s - 0.3, w - 0.3, n + 0.3, e + 0.3)
            picks = crossings_for(origin, house, None, None, osm, max_detour=1.25)
    out = []
    start = {"lat": origin[0], "lon": origin[1], "name": "your position"}
    for c in picks:
        got = await ground_best(origin, [c], _leg_mode(mode, start, c), hz0, now, deps.fetchers)
        r1 = got[0][1]
        if not r1:
            continue
        hz_c = await _hz(deps, c["lat"], c["lon"], 40.0, now)
        got2 = await ground_best((c["lat"], c["lon"]), [house], _leg_mode(mode, c, house), hz_c, now, deps.fetchers)
        r2 = got2[0][1]
        if not r2:
            continue
        cpt = {"lat": c["lat"], "lon": c["lon"], "name": f"the border at {c['name']}"}
        out.append(itinerary("overland", [ground_leg(r1, start, cpt, r1["mode"]), border_leg(c, hz_c),
                                          ground_leg(r2, cpt, house, r2["mode"])], house))
    return out


async def via_sea(origin: tuple, house: dict, mode: str, hz0: list[dict], deps: Deps, now) -> list[dict]:
    """The creative fallback: ground → a port → sea → ground. Sailings are not known."""
    try:
        o_ports = await asyncio.to_thread(deps.ports, origin[0], origin[1], 150)
        d_ports = await asyncio.to_thread(deps.ports, house["lat"], house["lon"], 150)
    except Exception:                                        # noqa: BLE001
        return []
    if not o_ports or not d_ports:
        return []
    op, dp = o_ports[0], d_ports[0]
    start = {"lat": origin[0], "lon": origin[1], "name": "your position"}
    r1 = (await ground_best(origin, [op], _leg_mode(mode, start, op), hz0, now, deps.fetchers))[0][1]
    if not r1:
        return []
    try:
        sp = await asyncio.to_thread(deps.sea_plan, op, dp)
    except Exception:                                        # noqa: BLE001
        return []
    c = (sp.get("candidates") or [None])[0] if sp.get("ok") else None
    if not c:
        return []
    hz_d = await _hz(deps, dp["lat"], dp["lon"], 40.0, now)
    r3 = (await ground_best((dp["lat"], dp["lon"]), [house], _leg_mode(mode, dp, house), hz_d, now, deps.fetchers))[0][1]
    if not r3:
        return []
    hours = float(c.get("hours") or 0)
    sea_leg = {"kind": "sea", "mode": "sea", "mode_label": "By sea", "label": f"Sail {op.get('name')} → {dp.get('name')}",
               "from": _pt(op), "to": _pt(dp), "coords": c.get("coords") or [], "distance_m": round(float(c.get("distance_nm") or 0) * 1852),
               "duration_s": round(hours * 3600), "wait_s": 3 * 3600, "duration_label": f"~{_dur(hours * 3600)} at sea",
               "exposure": round(float((c.get("exposure") or {}).get("risk_hours") or 0), 3), "through_core": [],
               "steps": [{"text": f"Go to the port of {op.get('name')}."}, {"text": f"Sail to {dp.get('name')} — about {_dur(hours * 3600)}."},
                         {"text": "Sailings are NOT known here — check ferries or arrange a boat."}],
               "assumptions": ["Ferry or boat availability is not known — check sailings.", "3 h at the port assumed."]}
    return [itinerary("sea", [ground_leg(r1, start, op, r1["mode"]), sea_leg, ground_leg(r3, dp, house, r3["mode"])], house)]


async def shelter(origin: tuple, mode: str, hz0: list[dict], deps: Deps, now) -> list[dict]:
    """No safe way to a safe house now: the nearest safe point away from the dangers, then re-plan."""
    p = await asyncio.to_thread(lambda: asyncio.run(sr.plan(origin[0], origin[1], mode, hazards=hz0, now=now, use_pois=not deps.fetchers, **deps.fetchers)))
    r = p.get("safest")
    if not r:
        return []
    start = {"lat": origin[0], "lon": origin[1], "name": "your position"}
    dest = {**r["dest"], "name": f"{r['dest'].get('name') or 'a safe point'} — shelter there"}
    return [itinerary("shelter", [ground_leg(r, start, dest, mode)], None,
                      ["No safe way to a safe house was found now: shelter at this point, stay reachable, and re-plan."])]


def _tag(its: list[dict]) -> list[dict]:
    ok = [i for i in its if i["ok"]]
    if not ok:
        return its
    rec = min(ok, key=lambda i: i["score"])
    fast = min(ok, key=lambda i: i["duration_s"])
    low = min(ok, key=lambda i: (i["exposure"], i["duration_s"]))
    for i in its:
        i["tags"] = [t for t, x in (("recommended", rec), ("fastest", fast), ("lowest exposure", low)) if i is x]
    return its


def _pick(its: list[dict]) -> list[dict]:
    """The best few, at most one per kind first, recommended on top."""
    its = sorted([i for i in its if i["ok"]], key=lambda i: i["score"])
    seen, first, rest = set(), [], []
    for i in its:
        (rest if i["kind"] in seen else first).append(i)
        seen.add(i["kind"])
    return _tag((first + rest)[:MAX_ITINERARIES])


async def build(origin: tuple, houses: list[dict], mode: str = "car", *, excluded: list[dict] | None = None,
                house_id: str | None = None, include_abroad: bool = False, now: _dt.datetime | None = None,
                deps: Deps | None = None) -> dict:
    """The evacuation plan from `origin` to the best of `houses` (usable() views)."""
    deps = deps or Deps()
    now = now or _dt.datetime.now(_dt.timezone.utc)
    md = sr.mode_of(mode)
    mode = md["name"]
    lat, lon = origin
    c_o = await asyncio.to_thread(country_at, lat, lon)
    iso_o = (c_o or {}).get("iso3")
    for h in houses:
        if "iso3" not in h:
            c = await asyncio.to_thread(country_at, h["lat"], h["lon"])
            h["iso3"], h["country_name"] = (c or {}).get("iso3"), (c or {}).get("name")
            h["distance_km"] = round(sr.metres(lat, lon, h["lat"], h["lon"]) / 1000, 1)
    if house_id:
        houses = [h for h in houses if h["id"] == house_id]
    hz0 = await _hz(deps, lat, lon, 40.0, now)
    home = sorted([h for h in houses if h["iso3"] and h["iso3"] == iso_o], key=lambda h: h["distance_km"])
    abroad = sorted([h for h in houses if not (h["iso3"] and h["iso3"] == iso_o)], key=lambda h: h["distance_km"])
    its: list[dict] = []
    tried: list[dict] = []
    start = {"lat": lat, "lon": lon, "name": "your position"}
    if home:
        for h, r in await ground_best(origin, home[:10], _leg_mode(mode, start, home[0]), hz0, now, deps.fetchers):
            tried.append({"house": h["name"], "id": h["id"], "reached": bool(r), "how": "direct"})
            if r:
                its.append(itinerary("direct", [ground_leg(r, start, h, r["mode"])], h))
    if abroad and (include_abroad or house_id or not its):
        for h in abroad[:ABROAD_HOUSES]:
            found = await via_border(origin, h, mode, iso_o, h["iso3"], hz0, deps, now)
            found += await via_air(origin, h, mode, (c_o or {}).get("iso2"), hz0, deps, now)
            if not found:
                found = await via_sea(origin, h, mode, hz0, deps, now)
            tried.append({"house": h["name"], "id": h["id"], "reached": bool(found), "how": ", ".join(sorted({i["kind"] for i in found})) or "none"})
            its += found
    chosen = _pick(its)
    status = "ok"
    if not chosen:
        chosen = _tag(await shelter(origin, mode if mode != "truck" else "car", hz0, deps, now))
        status = "shelter" if chosen else "no_route"
    rec = chosen[0] if chosen else None
    first = next((l for l in (rec or {}).get("legs", []) if l["kind"] == "ground"), None)
    plan = {
        "kind": "evacuation", "purpose": "evacuate", "mode": mode, "mode_label": md["label"],
        "origin": {"lat": lat, "lon": lon}, "origin_country": c_o, "generated_at": now.isoformat(),
        "status": status, "itineraries": chosen, "recommended": rec["key"] if rec else None,
        "destination": rec["destination"] if rec else None,
        "houses": [{k: h.get(k) for k in ("id", "name", "lat", "lon", "iso3", "country_name", "distance_km", "capacity", "reserved")} for h in houses],
        "excluded": [{"id": x["house"]["id"], "name": x["house"]["name"], "reason": x["reason"]} for x in excluded or []],
        "tried": tried,
        "hazards": hz0,
        # the current ground leg, in the single-route shape the rest of the route code reads
        "safest": ({"key": rec["key"], "coords": first["coords"], "steps": first["steps"], "distance_m": first["distance_m"],
                    "duration_s": first["duration_s"], "duration_label": first["duration_label"], "exposure": first["exposure"],
                    "dest": first["to"], "leave_via": first.get("leave_via"), "through_core": []} if first else None),
        "links": (first or {}).get("links") or {},
        "explanation": explain(status, rec, houses, excluded),
        "attribution": sr.ATTRIBUTION, "fix_the_map": sr.FIX_THE_MAP,
    }
    return plan


def explain(status: str, rec: dict | None, houses: list[dict], excluded: list[dict] | None) -> str:
    if status == "no_route":
        return "No route could be planned now (the routing services did not answer). Move away from the danger and try again in a minute."
    if status == "shelter":
        why = "no safe house can be reached safely now" if houses else "no safe house is open to this person"
        return f"Shelter: {why}. Get to the safe point shown, stay reachable, and re-plan."
    h = rec["destination"] or {}
    if rec["kind"] == "direct":
        leg = rec["legs"][0]
        return (f"Evacuate to {h.get('name')} — {'walk' if leg['mode'] == 'foot' else 'drive'} about {leg['duration_label']} "
                f"({leg['distance_m'] / 1000:.1f} km), the way with the least exposure to the dangers near you.")
    abroad = rec["kind"] in ("air", "overland", "sea")
    return (f"{'Evacuate abroad' if abroad else 'Evacuate'} to {h.get('name')}"
            f"{' (' + h['country_name'] + ')' if abroad and h.get('country_name') else ''} — {rec['summary'][:1].lower() + rec['summary'][1:]} "
            f"About {rec['duration_label']} door to door.")


# ── progress ───────────────────────────────────────────────────────────────

def _seg_dist(p, a, b) -> tuple[float, float]:
    """(metres from p to segment ab, fraction along it) — local flat projection."""
    k = math.cos(math.radians(p[0]))
    ax, ay = (a[1] - p[1]) * k, a[0] - p[0]
    bx, by = (b[1] - p[1]) * k, b[0] - p[0]
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
    x, y = ax + t * dx, ay + t * dy
    return math.hypot(x, y) * 111_195, t


def progress(plan: dict, pos: dict | None, itinerary_key: str | None = None, now: _dt.datetime | None = None) -> dict:
    """Where the person is against the itinerary: {leg_index, leg_label, off_route_m, off_route,
    remaining_m, remaining_s, eta, done_fraction, arrived}."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    its = plan.get("itineraries") or []
    it = next((i for i in its if i["key"] == (itinerary_key or plan.get("recommended"))), its[0] if its else None)
    if not it or not pos:
        return {"known": False, "position": pos}
    p = (float(pos["lat"]), float(pos["lon"]))
    best = None
    for li, leg in enumerate(it["legs"]):
        c = leg.get("coords") or []
        if leg["kind"] in ("air", "sea") or len(c) < 2:
            continue
        done = 0.0
        for a, b in zip(c, c[1:]):
            seg = sr.metres(a[0], a[1], b[0], b[1])
            d, t = _seg_dist(p, a, b)
            if best is None or d < best[0]:
                best = (d, li, (done + t * seg) / max(1.0, leg["distance_m"] or sr.length_m(c)))
            done += seg
    dest = (it.get("destination") or it["legs"][-1]["to"])
    to_dest = sr.metres(p[0], p[1], dest["lat"], dest["lon"])
    if best is None:
        return {"known": True, "position": pos, "leg_index": 0, "leg_label": it["legs"][0]["label"], "off_route_m": None,
                "off_route": False, "arrived": to_dest <= ARRIVED_M}
    d, li, frac = best
    frac = max(0.0, min(1.0, frac))
    leg = it["legs"][li]
    rem_s = (1 - frac) * (leg["duration_s"] or 0) + sum((l["duration_s"] or 0) + (l.get("wait_s") or 0) for l in it["legs"][li + 1:])
    rem_m = (1 - frac) * (leg["distance_m"] or 0) + sum(l["distance_m"] or 0 for l in it["legs"][li + 1:])
    total = sum((l["duration_s"] or 0) + (l.get("wait_s") or 0) for l in it["legs"]) or 1
    lim = OFF_ROUTE_M.get(leg.get("mode"), 300)
    return {"known": True, "position": pos, "itinerary": it["key"], "leg_index": li, "leg_label": leg["label"],
            "off_route_m": round(d), "off_route": d > lim, "off_route_limit_m": lim,
            "remaining_m": round(rem_m), "remaining_s": round(rem_s), "remaining_label": _dur(rem_s),
            "eta": (now + _dt.timedelta(seconds=rem_s)).isoformat(), "done_fraction": round(1 - rem_s / total, 3),
            "arrived": to_dest <= ARRIVED_M}


# ── advise ─────────────────────────────────────────────────────────────────

class Refused(Exception):
    pass


def may_advise(asset: dict | None, user: dict) -> bool:
    import position_stream as ps
    return bool(asset) and (str(asset.get("owner_id")) == _uid(user) or ps.is_admin(user))


def _person_position(asset: dict) -> dict | None:
    import owned_assets as oa
    uid = (asset.get("identifiers") or {}).get("user_id")
    last = oa.latest(str(uid)) if uid else None
    if last:
        return {"lat": last["lat"], "lon": last["lon"], "at": last["at"], "accuracy_m": last.get("accuracy_m"),
                "coarse": oa.is_coarse(last.get("accuracy_m"), last.get("source"))}
    if asset.get("lat") is not None:
        return {"lat": asset["lat"], "lon": asset["lon"], "at": asset.get("updated_at"), "coarse": False}
    return None


async def plan_for(sender: dict, asset_id: str, mode: str = "car", house_id: str | None = None, include_abroad: bool = False,
                   now: _dt.datetime | None = None, deps: Deps | None = None, save: bool = True) -> dict:
    """Plan (and save) an evacuation for the person linked to an asset."""
    import owned_assets as oa
    import position_stream as ps
    import route_plans as rp
    asset = await asyncio.to_thread(oa.visible_to, str(asset_id), sender)
    if not may_advise(asset, sender):
        raise Refused("only the asset's owner or an admin can advise an evacuation")
    linked = (asset.get("identifiers") or {}).get("user_id")
    if not linked:
        raise ValueError("nobody is linked to this asset — link a person first")
    pos = await asyncio.to_thread(_person_position, asset)
    if not pos:
        raise ValueError("no position for this person yet")
    person = {"id": str(linked), **(ps.user_index().get(str(linked)) or {})}
    houses = await asyncio.to_thread(visible_houses, sender)
    ok, out = usable(houses, person, await asyncio.to_thread(reservations, now))
    plan = await build((pos["lat"], pos["lon"]), ok, mode, excluded=out, house_id=house_id, include_abroad=include_abroad,
                       now=now, deps=deps)
    plan["subject"] = {"kind": "asset", "asset_id": asset["id"], "name": asset["name"], "user_id": str(linked),
                       "position_at": pos.get("at"), "coarse": pos.get("coarse"), "can_send": True}
    plan["id"] = None
    if save:
        req = {"purpose": "evacuate", "from": {"asset_id": asset["id"]}, "to": {"safe_house_id": house_id} if house_id else None,
               "mode": plan["mode"], "include_abroad": include_abroad}
        plan["id"] = await asyncio.to_thread(rp.save, _uid(sender), req, plan, asset["id"], str(linked))
    return plan


def route_payload(plan: dict, itinerary_key: str | None = None) -> dict:
    its = plan.get("itineraries") or []
    it = next((i for i in its if i["key"] == (itinerary_key or plan.get("recommended"))), its[0] if its else None)
    h = (it or {}).get("destination") or {}
    first = next((l for l in (it or {}).get("legs", []) if l["kind"] == "ground"), None)
    return {"route_plan_id": plan.get("id"), "kind": "evacuation", "itinerary": (it or {}).get("key"),
            "safe_house": h.get("name"), "safe_house_id": h.get("id"),
            "safe_house_at": {"lat": h["lat"], "lon": h["lon"]} if h.get("lat") is not None else None,
            "summary": (it or {}).get("summary"), "duration_label": (it or {}).get("duration_label"),
            "legs": [{"mode": l["mode"], "label": l["label"], "duration_label": l["duration_label"]} for l in (it or {}).get("legs", [])],
            "links": (first or {}).get("links") or {}, "status": plan.get("status")}


def default_message(plan: dict, itinerary_key: str | None = None) -> str:
    r = route_payload(plan, itinerary_key)
    if plan.get("status") == "shelter":
        return "Evacuate now: get to the safe point on your route and shelter there. Stay reachable — we will re-plan."
    if not r.get("safe_house"):
        return "Evacuate now: move away from the danger. Stay reachable."
    it = chosenItinerary(plan, itinerary_key)
    if it and it["kind"] == "direct":
        leg = it["legs"][0]
        return f"Evacuate now to {r['safe_house']} — {'walk' if leg['mode'] == 'foot' else 'drive'} about {leg['duration_label']}."[:aw_max()]
    return f"Evacuate now to {r['safe_house']}. {r.get('summary') or ''}"[:aw_max()].strip()


def chosenItinerary(plan: dict, key: str | None = None) -> dict | None:
    its = plan.get("itineraries") or []
    return next((i for i in its if i["key"] == (key or plan.get("recommended"))), its[0] if its else None)


def aw_max() -> int:
    import asset_warnings as aw
    return aw.MAX_MESSAGE


async def advise(sender: dict, asset_id: str, *, mode: str = "car", message: str | None = None, house_id: str | None = None,
                 plan_id: str | None = None, itinerary_key: str | None = None, include_abroad: bool = False,
                 now: _dt.datetime | None = None, deps: Deps | None = None, push=None) -> dict:
    """ADVISE EVACUATION: plan (or take the previewed plan_id), save, and send
    as an EVACUATE warning carrying the route. -> {warning, plan}"""
    import asset_warnings as aw
    import owned_assets as oa
    import route_plans as rp
    plan = None
    if plan_id:
        row = await asyncio.to_thread(rp.get, plan_id)
        if not row or not rp.visible(row, sender) or (row.get("plan") or {}).get("kind") != "evacuation" or row.get("asset_id") != asset_id:
            raise Refused("no such evacuation plan")
        a = await asyncio.to_thread(oa.visible_to, str(asset_id), sender)
        if not may_advise(a, sender):
            raise Refused("only the asset's owner or an admin can advise an evacuation")
        plan = {**row["plan"], "id": plan_id}
    else:
        plan = await plan_for(sender, asset_id, mode, house_id, include_abroad, now, deps)
    msg = (message or "").strip() or default_message(plan, itinerary_key)
    w = await asyncio.to_thread(lambda: aw.send(sender, msg, asset_id=asset_id, severity="critical",
                                                route=route_payload(plan, itinerary_key), kind="evacuate", push=push, now=now))
    return {"warning": w, "plan": plan}


async def recheck(row: dict, user: dict, replan: bool = False) -> dict:
    """GET /api/routes/{id} for an evacuation plan: the current ground leg
    against the hazards now; re-planned from the person's position on
    ?replan=1 or when it has become unsafe (by whoever may advise)."""
    import owned_assets as oa
    import route_plans as rp
    plan = row["plan"] or {}
    o = plan.get("origin") or row["origin"]
    hz = await asyncio.to_thread(sr.hazards_near, o["lat"], o["lon"], sr.HAZARD_SEARCH_KM, None)
    coords = (plan.get("safest") or {}).get("coords") or []
    check = sr.still_safe(coords, hz) if coords else {"safe": plan.get("status") == "ok", "through_core": [], "inside": []}
    a = await asyncio.to_thread(oa.visible_to, str(row.get("asset_id") or ""), user) if row.get("asset_id") else None
    if (replan or not check["safe"]) and may_advise(a, user):
        req = row.get("request") or {}
        fresh = await plan_for(user, a["id"], req.get("mode") or plan.get("mode") or "car",
                               (req.get("to") or {}).get("safe_house_id"), bool(req.get("include_abroad")), save=False)
        await asyncio.to_thread(rp.update, row["id"], fresh.get("status") or "ok", {**fresh, "id": row["id"]})
        return {**fresh, "id": row["id"], "check": check, "rerouted": True,
                "changed_because": None if check["safe"] else "A new danger is on the way — the evacuation was re-planned."}
    return {**plan, "id": row["id"], "check": check, "rerouted": False}


# ── HTTP ───────────────────────────────────────────────────────────────────

from fastapi import APIRouter, Body, HTTPException, Request  # noqa: E402

router = APIRouter(prefix="/api/evacuations", tags=["evacuation"])


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


@router.get("/safe-houses")
async def api_houses(request: Request):
    """The safe houses I can see (the map layer), with places taken."""
    me = _me(request)
    houses = await asyncio.to_thread(visible_houses, me)
    res = await asyncio.to_thread(reservations)
    return {"safe_houses": [house_view(a, res.get(a["id"], 0)) for a in houses]}


@router.post("/plan")
async def api_plan(request: Request, body: dict = Body(...)):
    """A preview: the itineraries, saved, not sent."""
    me = _me(request)
    try:
        return await plan_for(me, str(body.get("asset_id") or ""), body.get("mode") or "car", body.get("house_id"),
                              bool(body.get("include_abroad")))
    except Refused as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("")
async def api_advise(request: Request, body: dict = Body(...)):
    """ADVISE EVACUATION {asset_id, mode?, message?, house_id?, plan_id?, itinerary?}."""
    import asset_warnings as aw
    me = _me(request)
    try:
        return await advise(me, str(body.get("asset_id") or ""), mode=body.get("mode") or "car", message=body.get("message"),
                            house_id=body.get("house_id"), plan_id=body.get("plan_id"), itinerary_key=body.get("itinerary"),
                            include_abroad=bool(body.get("include_abroad")))
    except (Refused, aw.Refused) as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


def _progress_of(w: dict, now: _dt.datetime | None = None) -> dict:
    import owned_assets as oa
    import route_plans as rp
    route = w.get("route") or {}
    row = rp.get(route.get("route_plan_id")) if route.get("route_plan_id") else None
    last = oa.latest(str(w["to_user"]))
    pos = {"lat": last["lat"], "lon": last["lon"], "at": last["at"], "accuracy_m": last.get("accuracy_m")} if last else None
    pr = progress((row or {}).get("plan") or {}, pos, route.get("itinerary"), now) if row else {"known": False, "position": pos}
    return {"warning": w, "progress": pr, "route": route}


@router.get("/latest")
def api_latest(request: Request, asset_id: str):
    """The last evacuation advised for an asset, its acknowledgement and the person's progress."""
    import asset_warnings as aw
    me = _me(request)
    try:
        ws = [w for w in aw.sent(me, asset_id=asset_id, limit=20) if w.get("kind") == "evacuate"]
    except aw.Refused as e:
        raise HTTPException(404, str(e))
    return _progress_of(ws[0]) if ws else {"warning": None, "progress": None}


@router.get("/{wid}/progress")
def api_progress(wid: str, request: Request):
    import asset_warnings as aw
    import owned_assets as oa
    import position_stream as ps
    me = _me(request)
    w = aw.get(wid)
    if not w or w.get("kind") != "evacuate":
        raise HTTPException(404, "no such evacuation")
    seen = (w["from_user"] == _uid(me) or w["to_user"] == _uid(me) or ps.is_admin(me)
            or (w.get("asset_id") and oa.visible_to(w["asset_id"], me)))
    if not seen:
        raise HTTPException(404, "no such evacuation")
    return _progress_of(w)
