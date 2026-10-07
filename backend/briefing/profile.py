"""
briefing/profile.py — who a briefing is for, and what they care about.

A briefing is written for one recipient: an organisation, an addressee in
it, its sites, partners and products, and the exposure vectors the issue is
organised around ("Standort Deutschland", "Personal Kyjiw", "Lieferkette").
Each user keeps one profile (table briefing_profiles). Until they edit it,
it is derived from what the console already knows about them — their
registered assets (owned_assets), their interests (countries, regions,
topics in users.settings) and their company — so a first briefing never
needs a form filled in.

A vector is the unit of relevance: a name, the threat categories it takes
(owned_assets.CATEGORY_RULES: maritime, aviation, navigation, unrest,
sabotage, kinetic, fire, crime), the places it covers (sites with a radius,
and whole countries) and words that pull a story into it. collect.py scores
every signal against the vectors and drops what reaches none of them — the
Baltic tanker does not reach the Berlin substation.
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import sqlite3

from . import spec

DDL = """
CREATE TABLE IF NOT EXISTS briefing_profiles (
    user_id    TEXT PRIMARY KEY,
    profile    TEXT NOT NULL,
    updated_at TEXT
);
"""

CATEGORIES = ("maritime", "aviation", "navigation", "unrest", "sabotage", "kinetic", "fire", "crime")
LAND = ["unrest", "sabotage", "kinetic", "fire", "crime"]

# The interests' topics (src/state/interests.js TOPICS) as categories and words.
TOPIC_CATS = {"maritime": ["maritime", "navigation"], "aviation": ["aviation", "navigation"], "conflict": ["kinetic"],
              "energy": ["sabotage", "fire"], "cyber": ["sabotage"], "unrest": ["unrest"]}

# The regions a user can add in one click (interests.js REGIONS), as countries.
REGIONS = {
    "Red Sea & Horn of Africa": ["Yemen", "Saudi Arabia", "Eritrea", "Djibouti", "Somalia", "Ethiopia", "Sudan", "Egypt"],
    "Persian Gulf": ["Iran", "Iraq", "Kuwait", "Saudi Arabia", "Bahrain", "Qatar", "United Arab Emirates", "Oman"],
    "Levant": ["Israel", "Palestine", "Lebanon", "Syria", "Jordan"],
    "Ukraine & Black Sea": ["Ukraine", "Russia", "Moldova", "Romania", "Georgia", "Turkey", "Belarus"],
    "Baltic & Nordics": ["Estonia", "Latvia", "Lithuania", "Poland", "Finland", "Sweden", "Denmark", "Norway", "Germany"],
    "Sahel": ["Mali", "Burkina Faso", "Niger", "Chad", "Mauritania", "Nigeria", "Sudan"],
    "Great Lakes": ["Democratic Republic of the Congo", "Rwanda", "Uganda", "Burundi", "United Republic of Tanzania", "Kenya", "South Sudan"],
    "Taiwan Strait & South China Sea": ["Taiwan", "China", "Philippines", "Vietnam", "Malaysia", "Japan"],
    "Korean Peninsula": ["North Korea", "South Korea", "Japan", "China"],
    "South Asia": ["India", "Pakistan", "Afghanistan", "Bangladesh", "Myanmar", "Sri Lanka", "Nepal"],
    "Latin America": ["Venezuela", "Colombia", "Mexico", "Brazil", "Ecuador", "Peru", "Haiti", "Cuba"],
}

# Names people type for countries, to the names in geo/countries.geojson.
ALIASES = {"uae": "United Arab Emirates", "u.a.e.": "United Arab Emirates", "usa": "United States of America",
           "us": "United States of America", "united states": "United States of America", "uk": "United Kingdom",
           "deutschland": "Germany", "allemagne": "Germany", "frankreich": "France", "russland": "Russia",
           "türkei": "Turkey", "turkiye": "Turkey", "türkiye": "Turkey", "tanzania": "United Republic of Tanzania",
           "drc": "Democratic Republic of the Congo", "dr congo": "Democratic Republic of the Congo"}

# Vector names per asset group, in the three languages.
GROUP_VECTOR = {
    "Vessels":   {"de": "Schiffe und Seewege", "en": "Vessels and sea lanes", "fr": "Navires et routes maritimes"},
    "Aircraft":  {"de": "Luftfahrzeuge und Luftraum", "en": "Aircraft and airspace", "fr": "Aéronefs et espace aérien"},
    "Vehicles":  {"de": "Fahrzeuge und Transporte", "en": "Vehicles and transport", "fr": "Véhicules et transports"},
    "Sites":     {"de": "Standorte", "en": "Sites", "fr": "Sites"},
    "Energy":    {"de": "Energieanlagen", "en": "Energy installations", "fr": "Installations énergétiques"},
    "Telecoms":  {"de": "Telekommunikation und Daten", "en": "Telecoms and data", "fr": "Télécommunications et données"},
    "Transport": {"de": "Häfen und Flughäfen", "en": "Ports and airports", "fr": "Ports et aéroports"},
    "People":    {"de": "Personal und Teams", "en": "People and teams", "fr": "Personnel et équipes"},
}
COUNTRY_VECTOR = {"de": "Lage {c}", "en": "{c}: security situation", "fr": "{c} : situation sécuritaire"}


def localise(prof: dict, lang: str) -> dict:
    """The derived vector names in the issue's language; a name the user
    wrote stays as written."""
    from .countries import name as cname
    lang = lang if lang in spec.LANGUAGES else "de"
    for v in prof.get("vectors") or []:
        if v.get("origin") == "assets":
            group = next((g for g, names in GROUP_VECTOR.items() if v["name"] in names.values()), None)
            if group:
                v["name"] = GROUP_VECTOR[group][lang]
        elif v.get("origin") == "country" and v.get("countries"):
            c = v["countries"][0]
            if any(v["name"] == COUNTRY_VECTOR[l].format(c=x) for l in spec.LANGUAGES for x in (c, cname(c, l))):
                v["name"] = COUNTRY_VECTOR[lang].format(c=cname(c, lang))
    return prof


def _db_path() -> str:
    try:
        from paths import DB_PATH
        return str(DB_PATH)
    except Exception:                                        # noqa: BLE001
        import os
        return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "akili.db")


def _con(db_path: str | None = None):
    con = sqlite3.connect(db_path or _db_path(), timeout=60)
    con.executescript(DDL)
    con.row_factory = sqlite3.Row
    return con


def country_name(s: str | None) -> str | None:
    if not s:
        return None
    s = str(s).strip()
    return ALIASES.get(s.lower(), s)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40]


def _user(con, user_id: str) -> dict:
    r = con.execute("SELECT id, email, name, company, title, settings FROM users WHERE id = ?", (user_id,)).fetchone()
    if not r:
        return {"id": user_id}
    try:
        settings = json.loads(r["settings"] or "{}") or {}
    except (TypeError, ValueError):
        settings = {}
    return {"id": r["id"], "email": r["email"], "name": r["name"], "company": r["company"], "title": r["title"], "settings": settings}


def _assets(con, user_id: str) -> list[dict]:
    try:
        rows = con.execute("SELECT id, name, kind, lat, lon, radius_km, country, address, importance, identifiers FROM owned_assets "
                           "WHERE owner_id = ? OR shared = 1", (user_id,)).fetchall()
    except sqlite3.OperationalError:
        return []
    return [dict(r) for r in rows]


def _ids(v) -> dict:
    try:
        d = json.loads(v) if isinstance(v, str) else (v or {})
    except (TypeError, ValueError):
        d = {}
    return {k: str(d[k]) for k in ("mmsi", "imo", "icao", "registration") if d.get(k)}


def derive(user_id: str, db_path: str | None = None, language: str = "de") -> dict:
    """The profile the console can infer, before the user edits anything."""
    import owned_assets as oa
    con = _con(db_path)
    try:
        u = _user(con, user_id)
        assets = _assets(con, user_id)
    finally:
        con.close()
    interests = (u.get("settings") or {}).get("interests") or {}
    countries: list[str] = []
    for c in (interests.get("countries") or []):
        countries.append(country_name(c))
    for reg in (interests.get("regions") or []):
        countries += REGIONS.get(reg, [])
    sites, groups = [], {}
    for a in assets:
        k = oa.KINDS.get(a["kind"]) or {}
        group = k.get("group", "Sites")
        site = {"id": a["id"], "name": a["name"], "kind": a["kind"], "group": group, "lat": a["lat"], "lon": a["lon"],
                "radius_km": a.get("radius_km") or k.get("radius", 25), "country": country_name(a.get("country")),
                "address": a.get("address"), "importance": a.get("importance") or "normal", "moves": bool(k.get("moves")),
                "identifiers": _ids(a.get("identifiers"))}
        sites.append(site)
        groups.setdefault(group, []).append(site)
        if site["country"]:
            countries.append(site["country"])
    countries = list(dict.fromkeys(c for c in countries if c))
    lang = language if language in spec.LANGUAGES else "de"

    vectors = []
    for group, ss in groups.items():
        cats = set()
        for s in ss:
            cats |= {c for c in CATEGORIES if oa.reaches(s["kind"], c)}
        vectors.append({"id": f"V{len(vectors) + 1}", "key": f"group-{_slug(group)}", "name": GROUP_VECTOR.get(group, {}).get(lang, group),
                        "categories": sorted(cats), "sites": [s["id"] for s in ss], "countries": [], "keywords": [],
                        "decision_area": "", "origin": "assets"})
    for c in countries:
        vectors.append({"id": f"V{len(vectors) + 1}", "key": f"country-{_slug(c)}", "name": COUNTRY_VECTOR[lang].format(c=c),
                        "categories": LAND + ["navigation"], "sites": [], "countries": [c], "keywords": [],
                        "decision_area": "", "origin": "country"})
    topics = [t for t in (interests.get("topics") or []) if t in TOPIC_CATS]
    if topics and countries:
        # topics widen what the country vectors take (a maritime watcher wants the sea picture of their countries)
        extra = sorted({c for t in topics for c in TOPIC_CATS[t]})
        for v in vectors:
            if v["origin"] == "country":
                v["categories"] = sorted(set(v["categories"]) | set(extra))
    return {
        "version": 1,
        "derived": True,
        "org": u.get("company") or "",
        "addressee": u.get("title") or "",
        "contact": {"name": u.get("name") or "", "email": u.get("email") or ""},
        "sectors": [], "partners": [], "products": [], "policy_areas": [],
        "sites": sites,
        "countries": countries,
        "topics": topics,
        "vectors": vectors,
        "language": lang,
        "cadence": "weekly",
        "notes": "",
    }


EDITABLE = ("org", "addressee", "contact", "sectors", "partners", "products", "policy_areas", "countries", "topics",
            "vectors", "language", "cadence", "notes")


def clean(body: dict) -> dict:
    """What a user may set, checked. Sites stay the asset register's."""
    out: dict = {}
    for k in EDITABLE:
        if k not in body:
            continue
        v = body[k]
        if k in ("org", "addressee", "notes"):
            out[k] = str(v or "")[:500]
        elif k == "contact":
            v = v if isinstance(v, dict) else {}
            out[k] = {"name": str(v.get("name") or "")[:120], "email": str(v.get("email") or "")[:200]}
        elif k == "language":
            out[k] = v if v in spec.LANGUAGES else "de"
        elif k == "cadence":
            out[k] = v if v in spec.CADENCES else "weekly"
        elif k == "countries":
            out[k] = [country_name(x) for x in (v or []) if str(x).strip()][:40]
        elif k == "vectors":
            vs = []
            for i, x in enumerate((v or [])[:12], 1):
                if not isinstance(x, dict) or not str(x.get("name") or "").strip():
                    continue
                vs.append({"id": f"V{i}", "key": str(x.get("key") or _slug(str(x["name"]))),
                           "name": str(x["name"])[:80],
                           "categories": [c for c in (x.get("categories") or []) if c in CATEGORIES] or list(LAND),
                           "sites": [str(s) for s in (x.get("sites") or [])][:50],
                           "countries": [country_name(c) for c in (x.get("countries") or [])][:20],
                           "keywords": [str(w)[:40] for w in (x.get("keywords") or []) if str(w).strip()][:30],
                           "decision_area": str(x.get("decision_area") or "")[:120],
                           "origin": x.get("origin") or "user"})
            out[k] = vs
        else:
            out[k] = [str(x)[:120] for x in (v or []) if str(x).strip()][:30]
    return out


def get(user_id: str, db_path: str | None = None) -> dict:
    """The user's profile: what they saved over what is derived. Sites always
    come fresh from the asset register, so a new asset counts at once."""
    base = derive(user_id, db_path)
    con = _con(db_path)
    try:
        r = con.execute("SELECT profile, updated_at FROM briefing_profiles WHERE user_id = ?", (user_id,)).fetchone()
    finally:
        con.close()
    if not r:
        return base
    try:
        saved = json.loads(r["profile"]) or {}
    except (TypeError, ValueError):
        return base
    prof = {**base, **{k: saved[k] for k in EDITABLE if k in saved}, "derived": False, "updated_at": r["updated_at"]}
    # sites registered after the vectors were saved join the vector of their group
    known = {s for v in prof["vectors"] for s in v.get("sites", [])}
    for s in base["sites"]:
        if s["id"] in known:
            continue
        gv = next((v for v in prof["vectors"] if v.get("key") == f"group-{_slug(s['group'])}"), None)
        if gv:
            gv["sites"].append(s["id"])
    return prof


def save(user_id: str, body: dict, db_path: str | None = None) -> dict:
    data = clean(body)
    con = _con(db_path)
    try:
        con.execute("INSERT INTO briefing_profiles (user_id, profile, updated_at) VALUES (?, ?, ?) "
                    "ON CONFLICT(user_id) DO UPDATE SET profile = excluded.profile, updated_at = excluded.updated_at",
                    (user_id, json.dumps(data, ensure_ascii=False), _dt.datetime.now(_dt.timezone.utc).isoformat()))
        con.commit()
    finally:
        con.close()
    return get(user_id, db_path)


def reset(user_id: str, db_path: str | None = None) -> dict:
    con = _con(db_path)
    try:
        con.execute("DELETE FROM briefing_profiles WHERE user_id = ?", (user_id,))
        con.commit()
    finally:
        con.close()
    return derive(user_id, db_path)
