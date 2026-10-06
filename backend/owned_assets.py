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
    "aircraft_cargo":    {"label": "Cargo aircraft",      "group": "Aircraft",  "radius": 100, "moves": True,  "ids": ["icao", "registration"]},
    "aircraft_passenger": {"label": "Passenger aircraft", "group": "Aircraft",  "radius": 100, "moves": True,  "ids": ["icao", "registration"]},
    "aircraft_business": {"label": "Business jet",        "group": "Aircraft",  "radius": 100, "moves": True,  "ids": ["icao", "registration"]},
    "helicopter":        {"label": "Helicopter",          "group": "Aircraft",  "radius": 40,  "moves": True,  "ids": ["icao", "registration"]},
    "vehicle_truck":     {"label": "Truck",               "group": "Vehicles",  "radius": 25,  "moves": False, "ids": ["plate"]},
    "vehicle_car":       {"label": "Car",                 "group": "Vehicles",  "radius": 20,  "moves": False, "ids": ["plate"]},
    "vehicle_armoured":  {"label": "Armoured vehicle",    "group": "Vehicles",  "radius": 25,  "moves": False, "ids": ["plate"]},
    "factory":           {"label": "Factory",             "group": "Sites",     "radius": 25,  "moves": False, "ids": []},
    "office":            {"label": "Office",              "group": "Sites",     "radius": 15,  "moves": False, "ids": []},
    "warehouse":         {"label": "Warehouse",           "group": "Sites",     "radius": 20,  "moves": False, "ids": []},
    "refinery":          {"label": "Refinery",            "group": "Energy",    "radius": 30,  "moves": False, "ids": []},
    "power_plant":       {"label": "Power plant",         "group": "Energy",    "radius": 30,  "moves": False, "ids": []},
    "substation":        {"label": "Electric substation", "group": "Energy",    "radius": 20,  "moves": False, "ids": []},
    "port":              {"label": "Port terminal",       "group": "Transport", "radius": 30,  "moves": False, "ids": []},
    "airport":           {"label": "Airport",             "group": "Transport", "radius": 30,  "moves": False, "ids": []},
    "person":            {"label": "Person",              "group": "People",    "radius": 15,  "moves": False, "ids": []},
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
    importance  TEXT DEFAULT 'normal',
    notes       TEXT,
    shared      INTEGER DEFAULT 0,
    created_at  TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_owned_assets_owner ON owned_assets (owner_id);
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
    for f in ("country", "notes"):
        if f in body:
            out[f] = (str(body.get(f) or "").strip() or None) if body.get(f) is not None else None
    if "identifiers" in body:
        ids = body.get("identifiers") or {}
        allowed = {"mmsi", "imo", "icao", "registration", "plate"}
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
    con.execute("INSERT INTO owned_assets (id, owner_id, name, kind, identifiers, lat, lon, radius_km, country, importance,"
                " notes, shared, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (aid, str(user_id), d["name"], d["kind"], json.dumps(d.get("identifiers") or {}), d.get("lat"), d.get("lon"),
                 d.get("radius_km"), d.get("country"), d.get("importance") or "normal", d.get("notes"), d.get("shared", 0),
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
    if asset.get("lat") is not None and asset.get("lon") is not None:
        moves = KINDS.get(asset["kind"], {}).get("moves")
        return {"lat": asset["lat"], "lon": asset["lon"], "as_of": asset.get("updated_at"),
                "source": "last recorded position" if moves else "registered location"}
    return None


# ── what matters ─────────────────────────────────────────────────────────

SEV_W = {"critical": 1.0, "high": 0.7, "significant": 0.7, "elevated": 0.5, "moderate": 0.4, "medium": 0.4, "low": 0.15, "routine": 0.15}


def rank(at: dict, radius_km: float, items: list[dict], now: _dt.datetime | None = None,
         hours: float = 72, limit: int = 25) -> list[dict]:
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
        w = SEV_W.get(str(it.get("severity") or "").lower(), 0.3)
        score = w * (0.35 + 0.65 * (1 - d / radius_km)) * (0.5 ** (age_h / 24))
        out.append({**it, "km": round(d, 1), "age_h": round(age_h, 1), "score": round(score, 4)})
    # one item per title (outlets repeat a story), the best-scored kept
    best: dict[str, dict] = {}
    for it in sorted(out, key=lambda x: -x["score"]):
        best.setdefault(str(it.get("title") or it.get("id")).strip().lower(), it)
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
Each signal has an id like a1, its distance from the asset, its age and source. The asset's notes say what depends on it.

Write JSON:
- impact: 2-4 sentences: what these specific events mean for THIS asset — name the events (who did what, where, how
  far away) and the concrete consequence for the asset as its notes describe it (its staff, cargo, route, power,
  customers). Cite ids in square brackets, e.g. [a1].
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
        "impact": str(raw.get("impact") or "").strip()[:1200] or None,
        "could_affect": [{k: str(c.get(k) or "")[:300] for k in ("what", "why", "watch_for", "by")} for c in could[:3]],
        "measures": [{"action": str(m["action"])[:300], "why": str(m.get("why") or "")[:200]} for m in measures[:5]],
        "one_line": str(raw.get("one_line") or "").strip()[:240] or None,
    }


def brief(asset: dict, at: dict | None, ranked: list[dict], force: bool = False) -> dict:
    """The model's reading of the asset's situation, cached per set of signals."""
    if not ranked:
        return {"impact": None, "could_affect": [], "measures": [], "one_line": "Nothing within range in the last 72 hours.",
                "signals_key": None, "cached": False}
    key = _signals_key(ranked)
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
                     f"{s.get('source') or s.get('kind') or ''}")
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
            model=model, temperature=0.2, max_tokens=900, response_format={"type": "json_object"},
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
