"""
owned_assets.py — what WE have in the world, and what is happening to it.

The asset register: the owner's own vessels (by MMSI/IMO), aircraft (by
ICAO hex), vehicles, factories, offices, warehouses, ports, airports, power
plants, substations, people and teams. Not the sourced infrastructure
catalogue in database.py's `Asset` (a register of other people's ports and
bases, with citations) — this is the list of things a desk protects.

For each asset the console answers four questions, in order:

  where is it      fixed assets have a point; vessels and aircraft are looked
                   up live (AIS / ADS-B caches) and fall back to the last
                   position recorded with the asset.
  what matters     every recent signal within the asset's radius — alerts,
                   fusions, published Telegram footage, the surface pool —
                   ranked by severity, distance and age (rank()). Pure code.
  how it affects   the cheap model (openai_gate ENRICH) reads the asset and
  us, what could   its top signals and writes (gpt-4o, OPENAI_ASSET_MODEL): the impact on this asset, what
  come next, what  could affect it next (falsifiable: actor, place, act, a
  to do            criterion and a date — the owner's rule for forecasts),
                   and measures to take. It may only cite the signals it was
                   given; uncited claims are dropped (brief()).

Per user: an asset belongs to whoever registered it; `shared` shows it to
the whole team. Stored in akili.db (table owned_assets), briefs cached per
asset and per set of signals (table owned_asset_briefs).
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import math
import os
import sqlite3
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))

# kind -> label, group, default radius (km), whether it moves, identifier fields
KINDS: dict[str, dict] = {
    "vessel_tanker":     {"label": "Tanker",              "group": "Vessels",   "radius": 50,  "moves": True,  "ids": ["mmsi", "imo"]},
    "vessel_container":  {"label": "Container ship",      "group": "Vessels",   "radius": 50,  "moves": True,  "ids": ["mmsi", "imo"]},
    "vessel_bulk":       {"label": "Bulk carrier",        "group": "Vessels",   "radius": 50,  "moves": True,  "ids": ["mmsi", "imo"]},
    "vessel_lng":        {"label": "LNG carrier",         "group": "Vessels",   "radius": 50,  "moves": True,  "ids": ["mmsi", "imo"]},
    "vessel_general":    {"label": "General cargo",       "group": "Vessels",   "radius": 50,  "moves": True,  "ids": ["mmsi", "imo"]},
    "vessel_offshore":   {"label": "Offshore / supply",   "group": "Vessels",   "radius": 40,  "moves": True,  "ids": ["mmsi", "imo"]},
    "vessel_yacht":      {"label": "Yacht",               "group": "Vessels",   "radius": 30,  "moves": True,  "ids": ["mmsi", "imo"]},
    "vessel_passenger":  {"label": "Passenger ship / ferry", "group": "Vessels", "radius": 50, "moves": True,  "ids": ["mmsi", "imo"]},
    "vessel_military":   {"label": "Naval vessel",        "group": "Vessels",   "radius": 60,  "moves": True,  "ids": ["mmsi", "imo"]},
    "vessel_fishing":    {"label": "Fishing vessel",      "group": "Vessels",   "radius": 30,  "moves": True,  "ids": ["mmsi", "imo"]},
    "aircraft_cargo":    {"label": "Cargo aircraft",      "group": "Aircraft",  "radius": 100, "moves": True,  "ids": ["icao", "registration"]},
    "aircraft_passenger": {"label": "Passenger aircraft", "group": "Aircraft",  "radius": 100, "moves": True,  "ids": ["icao", "registration"]},
    "aircraft_business": {"label": "Business jet",        "group": "Aircraft",  "radius": 100, "moves": True,  "ids": ["icao", "registration"]},
    "helicopter":        {"label": "Helicopter",          "group": "Aircraft",  "radius": 40,  "moves": True,  "ids": ["icao", "registration"]},
    "aircraft_widebody": {"label": "Wide-body airliner",  "group": "Aircraft",  "radius": 100, "moves": True,  "ids": ["icao", "registration"]},
    "aircraft_regional": {"label": "Regional jet",        "group": "Aircraft",  "radius": 100, "moves": True,  "ids": ["icao", "registration"]},
    "aircraft_turboprop": {"label": "Turboprop",          "group": "Aircraft",  "radius": 80,  "moves": True,  "ids": ["icao", "registration"]},
    "aircraft_light":    {"label": "Light aircraft",      "group": "Aircraft",  "radius": 50,  "moves": True,  "ids": ["icao", "registration"]},
    "aircraft_military": {"label": "Military jet",        "group": "Aircraft",  "radius": 150, "moves": True,  "ids": ["icao", "registration"]},
    "vehicle_truck":     {"label": "Truck",               "group": "Vehicles",  "radius": 25,  "moves": False, "ids": ["plate"]},
    "vehicle_car":       {"label": "Car",                 "group": "Vehicles",  "radius": 20,  "moves": False, "ids": ["plate"]},
    "vehicle_armoured":  {"label": "Armoured vehicle",    "group": "Vehicles",  "radius": 25,  "moves": False, "ids": ["plate"]},
    "factory":           {"label": "Factory",             "group": "Sites",     "radius": 25,  "moves": False, "ids": []},
    "office":            {"label": "Office",              "group": "Sites",     "radius": 15,  "moves": False, "ids": []},
    "warehouse":         {"label": "Warehouse",           "group": "Sites",     "radius": 20,  "moves": False, "ids": []},
    "refinery":          {"label": "Refinery",            "group": "Energy",    "radius": 30,  "moves": False, "ids": []},
    "power_plant":       {"label": "Power plant",         "group": "Energy",    "radius": 30,  "moves": False, "ids": []},
    "substation":        {"label": "Electric substation", "group": "Energy",    "radius": 20,  "moves": False, "ids": []},
    "nuclear_plant":     {"label": "Nuclear power plant", "group": "Energy",    "radius": 50,  "moves": False, "ids": []},
    "wind_farm":         {"label": "Wind farm",           "group": "Energy",    "radius": 20,  "moves": False, "ids": []},
    "solar_farm":        {"label": "Solar farm",          "group": "Energy",    "radius": 15,  "moves": False, "ids": []},
    "hydro_dam":         {"label": "Hydro dam",           "group": "Energy",    "radius": 30,  "moves": False, "ids": []},
    "power_line":        {"label": "Power line",          "group": "Energy",    "radius": 20,  "moves": False, "ids": []},
    "pipeline":          {"label": "Pipeline",            "group": "Energy",    "radius": 30,  "moves": False, "ids": []},
    "oil_well":          {"label": "Oil or gas well",     "group": "Energy",    "radius": 20,  "moves": False, "ids": []},
    "tank_farm":         {"label": "Tank farm / terminal", "group": "Energy",   "radius": 25,  "moves": False, "ids": []},
    "telecom_mast":      {"label": "Telecom mast",        "group": "Telecoms",  "radius": 10,  "moves": False, "ids": []},
    "data_center":       {"label": "Data centre",         "group": "Telecoms",  "radius": 15,  "moves": False, "ids": []},
    "subsea_cable":      {"label": "Subsea cable / landing", "group": "Telecoms", "radius": 30, "moves": False, "ids": []},
    "port":              {"label": "Port terminal",       "group": "Transport", "radius": 30,  "moves": False, "ids": []},
    "airport":           {"label": "Airport",             "group": "Transport", "radius": 30,  "moves": False, "ids": []},
    # A person can be linked to a team member (identifiers.user_id): their
    # phone, with their consent, moves the asset (live_position below).
    "person":            {"label": "Person",              "group": "People",    "radius": 15,  "moves": True,  "ids": ["user_id"]},
    "team":              {"label": "Team",                "group": "People",    "radius": 20,  "moves": False, "ids": []},
}
IMPORTANCE = ("critical", "high", "normal")
ASSET_MODEL = os.getenv("OPENAI_ASSET_MODEL", "gpt-4o")
FIELDS = ("name", "kind", "lat", "lon", "radius_km", "country", "importance", "notes", "identifiers", "shared")

DDL = """
CREATE TABLE IF NOT EXISTS owned_assets (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,
    identifiers TEXT,             -- JSON {mmsi, imo, icao, registration, plate}
    lat REAL, lon REAL,           -- fixed point, or the last known position of a mover
    radius_km   REAL,
    country     TEXT,
    address     TEXT,             -- as found by the address search or the map pin
    importance  TEXT DEFAULT 'normal',
    notes       TEXT,
    shared      INTEGER DEFAULT 0,
    created_at  TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_owned_assets_owner ON owned_assets (owner_id);
CREATE TABLE IF NOT EXISTS owned_asset_track (
    asset_id TEXT NOT NULL, at TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, accuracy_m REAL
);
CREATE INDEX IF NOT EXISTS ix_owned_asset_track ON owned_asset_track (asset_id, at);
CREATE TABLE IF NOT EXISTS owned_asset_briefs (
    asset_id    TEXT NOT NULL,
    signals_key TEXT NOT NULL,
    brief       TEXT NOT NULL,
    created_at  TEXT,
    PRIMARY KEY (asset_id, signals_key)
);
"""


def _db_path() -> str:
    try:
        from main import DATA_DIR
        return os.path.join(DATA_DIR, "akili.db")
    except Exception:                                        # noqa: BLE001
        return os.path.join(HERE, "data", "akili.db")


def _con():
    con = sqlite3.connect(_db_path(), timeout=60)
    con.executescript(DDL)
    if "address" not in {r[1] for r in con.execute("PRAGMA table_info(owned_assets)")}:
        con.execute("ALTER TABLE owned_assets ADD COLUMN address TEXT")
    con.row_factory = sqlite3.Row
    return con


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def km(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2
    return 12742 * math.asin(math.sqrt(min(1.0, h)))


# ── the register ─────────────────────────────────────────────────────────

def clean(body: dict, partial: bool = False) -> dict:
    """What a client sent, checked. Raises ValueError with a sentence."""
    out = {}
    if not partial or "name" in body:
        name = str(body.get("name") or "").strip()
        if not name:
            raise ValueError("an asset needs a name")
        out["name"] = name[:120]
    if not partial or "kind" in body:
        kind = str(body.get("kind") or "")
        if kind not in KINDS:
            raise ValueError(f"unknown kind '{kind}'")
        out["kind"] = kind
    for f in ("lat", "lon", "radius_km"):
        if f in body:
            v = body.get(f)
            out[f] = None if v in (None, "") else float(v)
    if out.get("lat") is not None and not -90 <= out["lat"] <= 90:
        raise ValueError("latitude out of range")
    if out.get("lon") is not None and not -180 <= out["lon"] <= 180:
        raise ValueError("longitude out of range")
    if out.get("radius_km") is not None and not 1 <= out["radius_km"] <= 500:
        raise ValueError("radius must be between 1 and 500 km")
    if "importance" in body:
        imp = str(body.get("importance") or "normal")
        if imp not in IMPORTANCE:
            raise ValueError("importance is critical, high or normal")
        out["importance"] = imp
    for f in ("country", "notes", "address"):
        if f in body:
            out[f] = (str(body.get(f) or "").strip() or None) if body.get(f) is not None else None
    if "identifiers" in body:
        ids = body.get("identifiers") or {}
        allowed = {"mmsi", "imo", "icao", "registration", "plate", "user_id"}
        out["identifiers"] = {k: str(v).strip() for k, v in ids.items() if k in allowed and str(v or "").strip()}
        if "mmsi" in out["identifiers"] and not out["identifiers"]["mmsi"].isdigit():
            raise ValueError("an MMSI is nine digits")
        if "icao" in out["identifiers"]:
            out["identifiers"]["icao"] = out["identifiers"]["icao"].lower()
    if "shared" in body:
        out["shared"] = 1 if body.get("shared") else 0
    if not partial:
        kind = KINDS[out["kind"]]
        has_point = out.get("lat") is not None and out.get("lon") is not None
        has_id = any(k in (out.get("identifiers") or {}) for k in ("mmsi", "icao"))
        if not has_point and not (kind["moves"] and has_id):
            raise ValueError("place it on the map, or give a vessel's MMSI or an aircraft's ICAO code")
    return out


def _row(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["identifiers"] = json.loads(d.get("identifiers") or "{}")
    d["shared"] = bool(d.get("shared"))
    k = KINDS.get(d["kind"], {})
    d["kind_label"], d["group"] = k.get("label", d["kind"]), k.get("group", "Other")
    d["radius_km"] = d.get("radius_km") or k.get("radius", 25)
    return d


def list_for(user_id: str) -> list[dict]:
    con = _con()
    rows = con.execute("SELECT * FROM owned_assets WHERE owner_id=? OR shared=1 ORDER BY "
                       "CASE importance WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, name",
                       (str(user_id),)).fetchall()
    con.close()
    return [_row(r) for r in rows]


def get(asset_id: str, user_id: str) -> dict | None:
    con = _con()
    r = con.execute("SELECT * FROM owned_assets WHERE id=? AND (owner_id=? OR shared=1)", (asset_id, str(user_id))).fetchone()
    con.close()
    return _row(r) if r else None


def create(user_id: str, body: dict) -> dict:
    d = clean(body)
    aid = f"OA-{uuid.uuid4().hex[:8]}"
    con = _con()
    con.execute("INSERT INTO owned_assets (id, owner_id, name, kind, identifiers, lat, lon, radius_km, country, address, importance,"
                " notes, shared, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (aid, str(user_id), d["name"], d["kind"], json.dumps(d.get("identifiers") or {}), d.get("lat"), d.get("lon"),
                 d.get("radius_km"), d.get("country"), d.get("address"), d.get("importance") or "normal", d.get("notes"), d.get("shared", 0),
                 _now(), _now()))
    con.commit(); con.close()
    return get(aid, user_id)


def update(asset_id: str, user_id: str, body: dict) -> dict | None:
    d = clean(body, partial=True)
    if not d:
        return get(asset_id, user_id)
    if "identifiers" in d:
        d["identifiers"] = json.dumps(d["identifiers"])
    sets = ", ".join(f"{k}=?" for k in d)
    con = _con()
    cur = con.execute(f"UPDATE owned_assets SET {sets}, updated_at=? WHERE id=? AND owner_id=?",
                      (*d.values(), _now(), asset_id, str(user_id)))
    con.commit(); con.close()
    return get(asset_id, user_id) if cur.rowcount else None


def delete(asset_id: str, user_id: str) -> bool:
    con = _con()
    cur = con.execute("DELETE FROM owned_assets WHERE id=? AND owner_id=?", (asset_id, str(user_id)))
    con.execute("DELETE FROM owned_asset_briefs WHERE asset_id=?", (asset_id,))
    con.commit(); con.close()
    return cur.rowcount > 0


# ── people who share where they are ──────────────────────────────────────
# A team member who turns on "Share my live location" on their phone sends
# its position while the app is open (src/location/liveShare.js). Every
# person asset linked to them (identifiers.user_id) moves there; each move
# is kept for seven days as a trail; the assessment of what is near them is
# redone at once (asset_watch.invalidate). Nothing is sent without that
# switch, and turning it off stops it.
TRACK_KEEP_DAYS = 7
LIVE_FRESH_S = 15 * 60


def linked_to(user_id: str) -> list[dict]:
    con = _con()
    rows = con.execute("SELECT * FROM owned_assets WHERE json_extract(identifiers, '$.user_id') = ?",
                       (str(user_id),)).fetchall()
    con.close()
    return [_row(r) for r in rows]


def live_position(user_id: str, lat: float, lon: float, accuracy_m: float | None = None) -> list[dict]:
    """Move every asset linked to this user — a person, or the vehicle or
    vessel they are with (identifiers.user_id, any kind); returns them."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("position out of range")
    now = _now()
    con = _con()
    rows = con.execute("SELECT id, owner_id FROM owned_assets WHERE json_extract(identifiers, '$.user_id') = ?",
                       (str(user_id),)).fetchall()
    for r in rows:
        con.execute("UPDATE owned_assets SET lat=?, lon=?, updated_at=? WHERE id=?", (lat, lon, now, r["id"]))
        con.execute("INSERT INTO owned_asset_track (asset_id, at, lat, lon, accuracy_m) VALUES (?,?,?,?,?)",
                    (r["id"], now, lat, lon, accuracy_m))
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=TRACK_KEEP_DAYS)).isoformat()
    con.execute("DELETE FROM owned_asset_track WHERE at < ?", (cutoff,))
    con.commit(); con.close()
    return [{"id": r["id"], "owner_id": r["owner_id"]} for r in rows]


def track(asset_id: str, hours: int = 24) -> list[dict]:
    since = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=hours)).isoformat()
    con = _con()
    rows = con.execute("SELECT at, lat, lon, accuracy_m FROM owned_asset_track WHERE asset_id=? AND at >= ? ORDER BY at",
                       (asset_id, since)).fetchall()
    con.close()
    return [dict(r) for r in rows]


# ── where it is ──────────────────────────────────────────────────────────

def _iso(t):
    """Epoch seconds (AIS/ADS-B caches) or text -> ISO text."""
    if isinstance(t, (int, float)):
        return _dt.datetime.fromtimestamp(t, _dt.timezone.utc).isoformat()
    return t


def position(asset: dict, live_vessel=None, live_aircraft=None) -> dict | None:
    """{lat, lon, as_of, source} — live for a mover we can see, else the
    recorded point. live_vessel(mmsi)/live_aircraft(icao) return a dict with
    lat/lon (and a timestamp) or None."""
    ids = asset.get("identifiers") or {}
    if live_vessel and ids.get("mmsi"):
        v = live_vessel(ids["mmsi"])
        if v and v.get("lat") is not None and (v.get("lon") if v.get("lon") is not None else v.get("lng")) is not None:
            live = v.get("_live", True)
            return {"lat": float(v["lat"]), "lon": float(v.get("lon", v.get("lng"))),
                    "as_of": _iso(v.get("timestamp") or v.get("last_seen") or v.get("last_update")),
                    "source": "AIS, live" if live else "AIS, last seen",
                    "speed_kn": (v.get("speed") or v.get("sog")) if live else None, "heading": v.get("heading") or v.get("cog")}
    if live_aircraft and ids.get("icao"):
        a = live_aircraft(ids["icao"])
        if a and a.get("lat") is not None and a.get("lon") is not None:
            return {"lat": float(a["lat"]), "lon": float(a["lon"]), "as_of": _iso(a.get("last_seen")), "source": "ADS-B, live",
                    "altitude_ft": a.get("alt_baro") or a.get("altitude"), "heading": a.get("track")}
    if ids.get("user_id") and asset.get("lat") is not None and asset.get("lon") is not None:
        try:
            age = (_dt.datetime.now(_dt.timezone.utc) - _dt.datetime.fromisoformat(str(asset.get("updated_at")))).total_seconds()
        except (TypeError, ValueError):
            age = 1e9
        return {"lat": asset["lat"], "lon": asset["lon"], "as_of": asset.get("updated_at"),
                "source": "their phone, live" if age <= LIVE_FRESH_S else "their phone, last shared"}
    if asset.get("lat") is not None and asset.get("lon") is not None:
        moves = KINDS.get(asset["kind"], {}).get("moves")
        return {"lat": asset["lat"], "lon": asset["lon"], "as_of": asset.get("updated_at"),
                "source": "last recorded position" if moves else "registered location"}
    return None


# ── what matters ─────────────────────────────────────────────────────────

SEV_W = {"critical": 1.0, "high": 0.7, "significant": 0.7, "elevated": 0.5, "moderate": 0.4, "medium": 0.4, "low": 0.15, "routine": 0.15}


# ── what can touch what ──────────────────────────────────────────────────────
# A sanctioned tanker loitering in the Baltic is not a signal for a
# substation in Berlin; a protest called for the street outside it is (the
# owner, 2026-10-07). Each signal is put in a category, and each kind of
# asset lists the categories that can reach it.
import re as _re

CATEGORY_RULES = [
    # the detectors' own subjects first: narrow, and never anything else
    ("maritime", _re.compile(r"sanctioned:\s", _re.I)),      # the fusion's "⚠ SANCTIONED: Dignity detected"
    ("maritime", _re.compile(r"\b(sanction\w* vessel|dark ship|ship-to-ship|sts transfer|loiter\w*|ais_\w*|ais gap)\b", _re.I)),
    ("navigation", _re.compile(r"\b(gps|gnss|jamming|spoofing|navigation interference)\b", _re.I)),
    ("aviation", _re.compile(r"\b(military aircraft|isr pattern|squawk\w*|emergency declared|awacs)\b", _re.I)),
    # then what happened, whoever did it
    ("unrest", _re.compile(r"\b(protest\w*|demonstrat\w*|riot\w*|unrest|rally|march|blockade|clashes with police|"
                           r"tear gas|lbd|police charge|looting|strike action|walkout|manif\w*|kundgebung)\b", _re.I)),
    ("sabotage", _re.compile(r"\b(sabotag\w*|arson|cable cut|cut cable|cyber\w*|hack\w*|outage|blackout|drone sighting|"
                             r"drones? over|suspicious|tamper\w*|vandal\w*|explosive device|derail\w*)\b", _re.I)),
    ("kinetic", _re.compile(r"\b(strike|struck|attack\w*|explosion|blast|missile|drone|shelling|bomb\w*|clash\w*|"
                            r"killed|casualt\w*|interception|intercept\w*|raid|assault|shot|shooting|firing)\b", _re.I)),
    ("fire", _re.compile(r"\b(fire|blaze|heat|thermal|burning|wildfire)\b", _re.I)),
    # then the general subjects, when nothing above was said
    ("maritime", _re.compile(r"\b(vessel|tanker|freighter|cargo ship|naval|warship|frigate|port call|anchorage|ais)\b", _re.I)),
    ("aviation", _re.compile(r"\b(aircraft|flight|airspace|air force|fighter jet|bomber)\b", _re.I)),
    ("crime", _re.compile(r"\b(stabbing|robbery|murder|arrest\w*|police|gang|kidnap\w*)\b", _re.I)),
]
KIND_CATEGORY = {"footage": None, "verified footage": "kinetic", "news": "kinetic", "fusion": "kinetic",
                 "Heat": "fire", "thermal_anomaly": "fire", "telegram_announcement": "unrest"}
LAND = {"kinetic", "unrest", "sabotage", "fire", "crime"}
REACHES = {
    "Vessels": {"maritime", "kinetic", "sabotage", "navigation"},
    "Aircraft": {"aviation", "kinetic", "navigation"},
    "Vehicles": LAND,
    "Sites": LAND,
    "Energy": LAND,
    "Telecoms": LAND,
    "Transport": LAND | {"maritime", "aviation", "navigation"},
    "People": LAND,
}
# kinds that sit at or on the water take maritime signals too
WET = {"port", "subsea_cable", "vessel_offshore", "tank_farm", "pipeline", "refinery"}
AIRSIDE = {"airport"}


# A fusion is what its feeds saw: AIS and GPS together is a ship and jamming
# at sea, not violence, whatever the fusion is called.
FEED_CATEGORY = {"AIS": "maritime", "SAR": "maritime", "ADSB": "aviation", "ADS-B": "aviation", "GPS": "navigation", "GNSS": "navigation"}


def category(item: dict) -> str:
    """What kind of threat a signal is (CATEGORY_RULES; first match on its kind, then its words)."""
    k = str(item.get("kind") or "")
    if k == "fusion":
        feeds = set(_re.findall(r"[A-Z][A-Z\-]+", str(item.get("source") or "")))
        mapped = {FEED_CATEGORY[f] for f in feeds if f in FEED_CATEGORY}
        if feeds and len(mapped) == len(feeds & set(FEED_CATEGORY)) and feeds <= set(FEED_CATEGORY) | {"FUSION"}:
            # only sensor feeds about ships, aircraft and navigation: the most specific of them
            for c in ("maritime", "aviation", "navigation"):
                if c in mapped:
                    return c
    if k in KIND_CATEGORY and KIND_CATEGORY[k]:
        hint = KIND_CATEGORY[k]
    else:
        hint = None
    text = f"{k} {item.get('title') or ''}"
    for cat, rx in CATEGORY_RULES:
        if rx.search(text):
            # a named act beats the source's default (a GDELT protest is unrest, not kinetic)
            return cat
    return hint or "other"


def reaches(asset_kind: str | None, cat: str) -> bool:
    if not asset_kind or asset_kind not in KINDS:
        return True
    cats = set(REACHES.get(KINDS[asset_kind]["group"], LAND))
    if asset_kind in WET:
        cats |= {"maritime", "navigation"}
    if asset_kind in AIRSIDE:
        cats |= {"aviation", "navigation"}
    return cat in cats or cat == "other"


def rank(at: dict, radius_km: float, items: list[dict], now: _dt.datetime | None = None,
         hours: float = 72, limit: int = 25, kind: str | None = None) -> list[dict]:
    """Signals within the radius, most important first: severity, then
    closeness (linear to zero at the edge), then age (half weight at 24 h).
    Each item: {id, title, lat, lon, severity, when, source, kind}."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    out = []
    for it in items:
        if it.get("lat") is None or it.get("lon") is None:
            continue
        d = km(at["lat"], at["lon"], float(it["lat"]), float(it["lon"]))
        if d > radius_km:
            continue
        try:
            t = _dt.datetime.fromisoformat(str(it.get("when")).replace("Z", "+00:00").replace(" ", "T"))
            if t.tzinfo is None:
                t = t.replace(tzinfo=_dt.timezone.utc)
            age_h = max(0.0, (now - t).total_seconds() / 3600)
        except (TypeError, ValueError):
            age_h = hours / 2
        if age_h > hours:
            continue
        cat = category(it)
        if not reaches(kind, cat):
            continue
        it = {**it, "category": cat}
        w = SEV_W.get(str(it.get("severity") or "").lower(), 0.3)
        score = w * (0.35 + 0.65 * (1 - d / radius_km)) * (0.5 ** (age_h / 24))
        out.append({**it, "km": round(d, 1), "age_h": round(age_h, 1), "score": round(score, 4)})
    # one item per story: outlets repeat it, and detectors restate it with new
    # numbers ("6 of 23 aircraft", "4 of 16 aircraft") — compared without digits
    import re as _re
    best: dict[str, dict] = {}
    for it in sorted(out, key=lambda x: -x["score"]):
        key = _re.sub(r"[\d.,%()]+", "#", str(it.get("title") or it.get("id")).strip().lower())
        best.setdefault(key, it)
    return sorted(best.values(), key=lambda x: -x["score"])[:limit]


def exposure(ranked: list[dict]) -> str:
    """One word for the list: how exposed the asset is right now."""
    if not ranked:
        return "quiet"
    top = ranked[0]["score"]
    crit = sum(1 for r in ranked if str(r.get("severity")).lower() == "critical" and r["km"] <= 15)
    if crit or top >= 0.6:
        return "high"
    if top >= 0.3 or len(ranked) >= 6:
        return "elevated"
    return "low"


# ── how it affects us ────────────────────────────────────────────────────

SYSTEM = """You advise a security and operations desk about ONE of its own assets, using ONLY the signals given.
Each nearby signal has an id like a1: what happened, what raised it (the detector, channel or analyst), its category,
its distance and age. Signals e1, e2 … are not nearby: they are attacks or sabotage on the SAME KIND of target
elsewhere in the asset's country — precedents, which can matter more than an unrelated event next door.
The asset's notes say what depends on it.

RELEVANCE FIRST. A signal only belongs in your answer if it can plausibly touch THIS kind of asset: a protest or
sabotage near a substation can; a sanctioned tanker or a military aircraft over the sea cannot, however close.
Leave out what cannot touch it — do not mention it at all.

Write JSON:
- impact: 2-5 sentences. For each event you keep: WHAT happened (who did what, where, when, how far from the asset),
  WHAT RAISED IT (the detector, channel or analyst named in the signal) and WHY it bears on this asset (its kind,
  its staff, power, cargo, route, customers as the notes say). Precedents (e-ids): say what was hit and how, and what
  that implies for this asset. Cite ids in square brackets, e.g. [a1], [e2].
- could_affect: up to 3 developments that could hit the asset next, each
  {"what": "<actor> <act> <named place>", "why": "the signals behind it, with [ids]",
   "watch_for": "the observable sign it is starting — specific enough to be checked",
   "by": "YYYY-MM-DD, within 14 days"}.
  The actor and the place must come from the signals, in the signals' own words — never add a district, road or
  building the signals do not name. (Style example, about another place — never reuse it: "RSF shelling of the
  El Fasher market".) BAD: "Escalation of violence", "Supply disruptions", "Increased tension".
- measures: up to 5 actions for THIS asset, most urgent first, each {"action": "...", "why": "[ids]"}. Name what to do,
  for whom or what, and until when or until which sign. (Style example, about another asset — never reuse it: "Hold
  the tanker at anchor off Djibouti until two days pass without attacks on shipping in the strait".) BAD: "Increase security protocols", "Monitor local news",
  "Establish a communication plan", "Stay vigilant".
- one_line: one sentence for a list view naming the nearest serious event and its distance.
If the signals do not bear on the asset, say so plainly in impact and leave the lists empty. Never invent events.
Answer as JSON: {"impact": "...", "could_affect": [...], "measures": [...], "one_line": "..."}"""

# Advice anyone could give about anything is not advice; dropped whatever the model says.
GENERIC = ("monitor local news", "monitor the news", "monitor news", "stay vigilant", "stay informed", "remain vigilant",
           "increase security protocols", "enhance security", "communication plan", "review security", "situational awareness",
           "escalation of violence", "increased tension", "deteriorating security", "monitor the situation",
           "until further notice", "reassess")


def _signals_key(ranked: list[dict]) -> str:
    return hashlib.sha1("|".join(str(r.get("id")) for r in ranked[:12]).encode()).hexdigest()[:16]


def cited_only(raw: dict, ids: set[str]) -> dict:
    """Keep what the model wrote only where it cites the signals it was given."""
    def cites(s) -> list[str]:
        import re
        return [c for c in re.findall(r"\[([^\]]+)\]", str(s or "")) if c in ids]
    generic = lambda t: any(g in str(t or "").lower() for g in GENERIC)  # noqa: E731
    could = [c for c in (raw.get("could_affect") or []) if isinstance(c, dict) and c.get("what") and cites(c.get("why"))
             and not generic(c.get("what")) and len(str(c.get("what")).split()) >= 4]
    measures = [m for m in (raw.get("measures") or []) if isinstance(m, dict) and m.get("action") and cites(m.get("why"))
                and not generic(m.get("action"))]
    return {
        "impact": str(raw.get("impact") or "").strip()[:1800] or None,
        "could_affect": [{k: str(c.get(k) or "")[:300] for k in ("what", "why", "watch_for", "by")} for c in could[:3]],
        "measures": [{"action": str(m["action"])[:300], "why": str(m.get("why") or "")[:200]} for m in measures[:5]],
        "one_line": str(raw.get("one_line") or "").strip()[:240] or None,
    }


def brief(asset: dict, at: dict | None, ranked: list[dict], force: bool = False, analogues: list[dict] | None = None) -> dict:
    """The model's reading of the asset's situation, cached per set of signals."""
    analogues = analogues or []
    if not ranked and not analogues:
        return {"impact": None, "could_affect": [], "measures": [], "one_line": "Nothing within range in the last 72 hours.",
                "signals_key": None, "cached": False}
    key = _signals_key(ranked + analogues) + "-v2"
    con = _con()
    if not force:
        r = con.execute("SELECT brief, created_at FROM owned_asset_briefs WHERE asset_id=? AND signals_key=?", (asset["id"], key)).fetchone()
        if r:
            con.close()
            return {**json.loads(r["brief"]), "signals_key": key, "cached": True, "written_at": r["created_at"]}
    con.close()
    import openai_gate
    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None:
        return {"error": "the model is unavailable (no key, or the monthly cap is reached)"}
    short = {}
    lines = []
    for i, s in enumerate(ranked[:12]):
        sid = f"a{i + 1}"
        short[sid] = s.get("id")
        lines.append(f"[{sid}] {s.get('title')} — {s['km']} km away, {s['age_h']} h ago, {s.get('severity') or 'unrated'}, "
                     f"category {s.get('category') or category(s)}. Raised by {s.get('trigger') or s.get('source') or s.get('kind')}."
                     + (f" What happened: {s['detail']}" if s.get("detail") else "")
                     + (f" Place: {s['place']}." if s.get("place") else ""))
    if analogues:
        lines.append("\nThe same kind of target elsewhere in the country (precedents):")
        for i, s in enumerate(analogues[:6]):
            sid = f"e{i + 1}"
            short[sid] = s.get("id")
            lines.append(f"[{sid}] {s.get('title')} — {s.get('place') or ''}, {s.get('km') if s.get('km') is not None else '?'} km away, "
                         f"{str(s.get('when') or '')[:10]}, category {s.get('category')}. Raised by {s.get('trigger') or s.get('source')}."
                         + (f" What happened: {s['detail']}" if s.get("detail") else ""))
    k = KINDS.get(asset["kind"], {})
    where = f"{at['lat']:.3f}, {at['lon']:.3f} ({at.get('source')})" if at else "unknown"
    prompt = (f"Asset: {asset['name']} — {k.get('label', asset['kind'])}, importance {asset.get('importance')}, "
              f"country {asset.get('country') or 'unknown'}, position {where}, watch radius {asset['radius_km']} km.\n"
              f"Notes: {asset.get('notes') or 'none'}\nToday: {_dt.date.today().isoformat()}\n\nSignals:\n" + "\n".join(lines))
    # The stronger model: written rarely (cached per set of signals), read by
    # people deciding what to do with their staff — the cheap one misread who
    # was fighting whom. About a cent a brief, under the same monthly cap.
    model = ASSET_MODEL
    try:
        resp = client.chat.completions.create(
            model=model, temperature=0.2, max_tokens=1300, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}])
    except Exception as e:                                   # noqa: BLE001
        return {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    usage = getattr(resp, "usage", None)
    if usage:
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                                      call_type="enrich", model=model, headline=f"asset {asset['name']}")
        except Exception:                                    # noqa: BLE001
            pass
    try:
        raw = json.loads(resp.choices[0].message.content or "{}")
    except ValueError:
        return {"error": "unreadable answer"}
    out = cited_only(raw, set(short))
    out["cites"] = short                                     # a1 -> the real signal id
    con = _con()
    con.execute("INSERT OR REPLACE INTO owned_asset_briefs (asset_id, signals_key, brief, created_at) VALUES (?,?,?,?)",
                (asset["id"], key, json.dumps(out), _now()))
    con.commit(); con.close()
    return {**out, "signals_key": key, "cached": False, "written_at": _now()}
