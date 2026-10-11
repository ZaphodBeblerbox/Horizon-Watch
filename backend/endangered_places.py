"""
endangered_places.py — places that public calls name for blockades and
other actions, for business continuity (fuel supply, sites).

The owner (2026-10-11): "I have a list of places that might get blocked or
targeted by the GJ (gilets jaunes) — display these as endangered places
with specific calls to action to block them."

TWO PUBLIC SOURCES, read only, never written to:

A) 17octobregiletjaune.net — the gilets jaunes' map for Saturday
   17 October 2026 (carte/carte.js is the reference for every format here):
     /data/sites.json   refineries, fuel depots, and prefecture / announced
                        rendez-vous points: [id, genre, lat, lon, name,
                        operator, commune, cp, dep, (heure, annonce, rondpoint)]
     /api/lieux         places visitors added, same format
     /data/stations.json the DGCCRF fuel-station list (Licence Ouverte):
                        colonnes [id, lat, lon, ville, cp, adresse, dep, ...]
     /api/actions       {actions: {place id: [[type, "HH:MM"], ...]}} — the
                        calls to action, one list per place
   NOT read: /api/appel (the petition's signatories — personal data) and
   every POST endpoint. The site says its data is erased after 31 Dec 2026;
   past that date it is not polled, and a fetch that fails or comes back
   empty never replaces the copy we have.

B) Framacarte (uMap) map 213599, "La guerre se fabrique près de chez nous" —
   an anti-militarist map of arms-industry companies in the Sud region,
   published as places to act against. No dated call: each is "listed".
   Only the four company layers are read, and only whitelisted fields
   (name, type, sector, domain, address) — the infrastructure layer
   carries OpenStreetMap editors' user names and is not fetched.

WHAT A PLACE IS: {id, source, kind, name, operator, city, lat, lon, calls:
[{kind, label_en, level, date, time, source_url}], ...}. Status and colour
are DERIVED ON READ (annotate) from the calls and the clock, never stored:
  status  "call active today" | "upcoming" | "listed (no call)" | "past"
  alarm   red    a high-level call (roadblock, convoy, picket) today or
                 within 48 h
          amber  any other call still to come
          grey   listed without a call, or the calls are over

NOTIFICATIONS (avoiding a flood — 211 calls on 2026-10-11):
  a) one national summary per action day, updated in place as calls are
     added (never a second row);
  b) one alert per refinery / fuel depot with a high-level call (fuel
     supply), updated in place if more are added there;
  c) one reminder on the morning of the action day;
  d) per user, through event_watch: the places within 25 km of one of
     their assets (or where they are), one card each, capped; and one
     card per theater with the count inside it.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import threading
import urllib.error
import urllib.request

# ── sources ──────────────────────────────────────────────────────────────

GJ_SITE = "https://17octobregiletjaune.net"
GJ_LABEL = "17octobregiletjaune.net"
GJ_TELEGRAM = "https://t.me/info17octobre"
GJ_URLS = {
    "sites": f"{GJ_SITE}/data/sites.json",
    "stations": f"{GJ_SITE}/data/stations.json",
    "lieux": f"{GJ_SITE}/api/lieux",
    "actions": f"{GJ_SITE}/api/actions",
}
# The one day the site calls for ("Samedi 17 octobre 2026", carte.js and
# the page title). The page is read to confirm it; this is the fallback.
GJ_ACTION_DATE = "2026-10-17"
GJ_PAGE = f"{GJ_SITE}/carte/"
GJ_ERASED_AFTER = _dt.date(2026, 12, 31)      # "données effacées après le 31 décembre 2026"

FC_MAP_ID = 213599
FC_LABEL = "framacarte.org (anti-militarist map)"
FC_MAP_URL = f"https://framacarte.org/en/map/{FC_MAP_ID}/geojson/"
FC_LAYER_URL = "https://framacarte.org/en/datalayer/{map_id}/{pk}/"
FC_PUBLIC_URL = f"https://framacarte.org/m/{FC_MAP_ID}/"
# The company layers (by name); the technopoles, state bodies and the
# infrastructure layer (OSM editor names) are left out.
FC_LAYER_WORDS = ("armement", "militaro", "complicit", "drone")
FC_NOTE = ("Listed by an anti-militarist map (\"La guerre se fabrique près de chez nous\", "
           "Framacarte) as a target for action — no dated call")

USER_AGENT = "ParallaxMonitor/1.0 (read-only situational awareness; polls every 30 min)"
TZ = "Europe/Paris"
FRANCE = (46.6, 2.5)

# How often each source is read (seconds).
EVERY = {"actions": 30 * 60, "lieux": 30 * 60, "sites": 6 * 3600, "stations": 6 * 3600,
         "page": 24 * 3600, "framacarte": 24 * 3600}

# ── what each call means ────────────────────────────────────────────────
# Every type carte.js offers (TYPES), in plain English, with how much it
# disrupts a site: high = traffic or access is stopped or slowed on
# purpose; medium = a crowd at the place; low = words and paper.
CALL_TYPES = {
    "barrage_filtrant": ("Filtering roadblock", "high"),
    "operation_escargot": ("Slow-drive convoy", "high"),
    "piquet_de_greve": ("Strike picket", "high"),
    "blocage": ("Blockade", "high"),
    "rond_point": ("Roundabout occupation", "medium"),
    "manifestation": ("March / demonstration", "medium"),
    "rassemblement": ("Gathering", "medium"),
    "autre": ("Other action (unspecified)", "medium"),
    "prise_de_parole": ("Speeches", "low"),
    "tractage": ("Leafleting", "low"),
    "pancartes": ("Placards and banners", "low"),
}
LEVEL_RANK = {"high": 0, "medium": 1, "low": 2}
HIGH_PLURAL = {"barrage_filtrant": "filtering roadblocks", "operation_escargot": "slow-drive convoys",
               "piquet_de_greve": "strike pickets", "blocage": "blockades"}
HIGH_SINGULAR = {"barrage_filtrant": "filtering roadblock", "operation_escargot": "slow-drive convoy",
                 "piquet_de_greve": "strike picket", "blocage": "blockade"}

KIND_LABEL = {
    "refinery": "Refinery", "fuel_depot": "Fuel depot", "fuel_station": "Fuel station",
    "gathering": "Gathering point", "roundabout": "Roundabout", "arms_company": "Arms-industry company",
}
GENRE_KIND = {"raffinerie": "refinery", "depot": "fuel_depot", "manif": "gathering", "station": "fuel_station"}
FUEL_SUPPLY = ("refinery", "fuel_depot")


def call_type(kind: str) -> tuple[str, str]:
    """(English label, level) for a call type; an unknown one is named as
    it comes and counted medium (a crowd, until known otherwise)."""
    k = str(kind or "").strip().lower()
    if k in CALL_TYPES:
        return CALL_TYPES[k]
    return ((k.replace("_", " ").capitalize() or "Action"), "medium")


# ── storage ──────────────────────────────────────────────────────────────

_lock = threading.Lock()


def _dir():
    from paths import data_path
    p = data_path("endangered_places", "x").parent
    p.mkdir(parents=True, exist_ok=True)
    return p


def _read_json(name: str, default=None):
    try:
        with open(_dir() / name, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default
    except Exception as e:                                     # noqa: BLE001
        print(f"[endangered] error: {name} unreadable: {type(e).__name__}: {e}", flush=True)
        return default


def _write_json(name: str, data) -> None:
    p = _dir() / name
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, p)


# ── fetching, politely ───────────────────────────────────────────────────

class NotModified(Exception):
    pass


def _fetch(url: str, cond: dict | None = None, timeout: int = 30, max_bytes: int = 12_000_000):
    """(body bytes, {etag, last_modified}). Raises NotModified on a 304,
    anything else on failure. Conditional when the last answer gave an
    ETag or Last-Modified."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json, text/html;q=0.8"}
    cond = cond or {}
    if cond.get("etag"):
        headers["If-None-Match"] = cond["etag"]
    if cond.get("last_modified"):
        headers["If-Modified-Since"] = cond["last_modified"]
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise ValueError(f"over {max_bytes} bytes")
            return body, {"etag": r.headers.get("ETag"), "last_modified": r.headers.get("Last-Modified")}
    except urllib.error.HTTPError as e:
        if e.code == 304:
            raise NotModified() from None
        raise


def _due(meta: dict, key: str, now_ts: float, force: bool) -> bool:
    if force:
        return True
    last = (meta.get("http") or {}).get(key, {}).get("checked_at") or 0
    return now_ts - last >= EVERY.get(key.split(":")[0], 1800) - 60


def _record(meta: dict, key: str, now_ts: float, ok: bool, hdr: dict | None = None, error: str | None = None):
    h = meta.setdefault("http", {}).setdefault(key, {})
    h["checked_at"] = now_ts
    if ok:
        h["ok_at"] = now_ts
        h.pop("error", None)
        if hdr is not None:
            h["etag"], h["last_modified"] = hdr.get("etag"), hdr.get("last_modified")
    else:
        h["error"] = error


def _plausible(key: str, data) -> bool:
    """A body worth keeping. An empty or reshaped answer (the site wiped
    after the event, a Cloudflare page) never replaces the copy we have."""
    if key == "sites":
        return isinstance(data, dict) and isinstance(data.get("lieux"), list) and len(data["lieux"]) >= 5
    if key == "lieux":
        return isinstance(data, dict) and isinstance(data.get("lieux"), list)
    if key == "stations":
        return isinstance(data, dict) and isinstance(data.get("stations"), list) and len(data["stations"]) >= 1000
    if key == "actions":
        return isinstance(data, dict) and isinstance(data.get("actions"), dict)
    return data is not None


def _pull(meta: dict, key: str, url: str, fname: str, now_ts: float, errors: list, conditional=True) -> bool:
    """Fetch one source into its raw file. True when the file changed."""
    have = (_dir() / fname).exists()
    try:
        body, hdr = _fetch(url, (meta.get("http") or {}).get(key) if (conditional and have) else None)
    except NotModified:
        _record(meta, key, now_ts, True)
        return False
    except Exception as e:                                     # noqa: BLE001
        msg = f"{type(e).__name__}: {e}"
        _record(meta, key, now_ts, False, error=msg)
        errors.append(f"{key}: {msg}")
        print(f"[endangered] error: fetch {key} ({url}): {msg} — keeping the copy we have", flush=True)
        return False
    try:
        data = json.loads(body.decode("utf-8"))
    except Exception as e:                                     # noqa: BLE001
        msg = f"not JSON ({type(e).__name__})"
        _record(meta, key, now_ts, False, error=msg)
        errors.append(f"{key}: {msg}")
        print(f"[endangered] error: fetch {key}: {msg} — keeping the copy we have", flush=True)
        return False
    base = key.split(":")[0]
    if not _plausible(base, data):
        prev = _read_json(fname)
        if prev is not None and _plausible(base, prev):
            msg = "empty or unexpected answer"
            _record(meta, key, now_ts, False, error=msg)
            errors.append(f"{key}: {msg}")
            print(f"[endangered] error: {key}: {msg} — keeping the copy we have", flush=True)
            return False
    if base == "actions" and isinstance(data, dict) and not data.get("actions"):
        prev = _read_json(fname) or {}
        if prev.get("actions"):
            msg = "the calls list came back empty"
            _record(meta, key, now_ts, False, error=msg)
            errors.append(f"{key}: {msg}")
            print(f"[endangered] error: {key}: {msg} — keeping the {len(prev['actions'])} we have", flush=True)
            return False
    data = _strip(base, data)
    _write_json(fname, data)
    _record(meta, key, now_ts, True, hdr)
    return True


def _strip(base: str, data):
    """Only what is used is kept on disk. The station list is cut to its
    coordinates and address columns; Framacarte features to whitelisted
    fields (no editor names, no free-text descriptions)."""
    if base == "framacarte" and isinstance(data, dict):
        keep = ("NOM", "Nom", "NAME", "ADRESSE", "TYPE", "Type", "SECTEUR", "DOMAINE")
        feats = []
        for f in data.get("features") or []:
            p = f.get("properties") or {}
            feats.append({"geometry": f.get("geometry"), "properties": {k: p[k] for k in keep if p.get(k)}})
        return {"name": ((data.get("_umap_options") or {}).get("name")), "features": feats}
    return data


def _action_date_from_page(html: str) -> str | None:
    months = {"janvier": 1, "février": 2, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7,
              "août": 8, "aout": 8, "septembre": 9, "octobre": 10, "novembre": 11, "décembre": 12, "decembre": 12}
    m = re.search(r"<title>[^<]*?(\d{1,2})\s+(" + "|".join(months) + r")\s+(\d{4})", html, re.I)
    if not m:
        return None
    try:
        return _dt.date(int(m.group(3)), months[m.group(2).lower()], int(m.group(1))).isoformat()
    except ValueError:
        return None


def refresh(now: _dt.datetime | None = None, force: bool = False) -> dict:
    """Read whatever is due, rebuild the places, save them. Synchronous —
    run off the event loop. Returns what changed."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    now_ts = now.timestamp()
    errors: list[str] = []
    with _lock:
        meta = _read_json("meta.json", {}) or {}
        changed = False
        if now.date() <= GJ_ERASED_AFTER:
            for key in ("actions", "lieux", "sites", "stations"):
                if _due(meta, key, now_ts, force):
                    changed |= _pull(meta, key, GJ_URLS[key], f"gj_{key}.json", now_ts, errors)
            if _due(meta, "page", now_ts, force):
                try:
                    body, _h = _fetch(GJ_PAGE, timeout=20, max_bytes=2_000_000)
                    d = _action_date_from_page(body.decode("utf-8", "replace"))
                    if d and d != meta.get("action_date"):
                        meta["action_date"] = d
                        changed = True
                    _record(meta, "page", now_ts, True)
                except Exception as e:                         # noqa: BLE001
                    _record(meta, "page", now_ts, False, error=f"{type(e).__name__}: {e}")
                    print(f"[endangered] error: fetch page: {type(e).__name__}: {e}", flush=True)
        if _due(meta, "framacarte", now_ts, force):
            changed |= _pull_framacarte(meta, now_ts, errors)
        raw = load_raw(meta)
        places, stats = build(raw, meta.get("first_seen") or {}, meta.get("action_date") or GJ_ACTION_DATE, now)
        # When each call was first seen: "new" calls, and the time a
        # per-user card carries.
        fs = meta.setdefault("first_seen", {})
        new_calls = []
        for p in places:
            for c in p["calls"]:
                if c["key"] not in fs:
                    fs[c["key"]] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
                    c["first_seen"] = fs[c["key"]]
                    new_calls.append(c["key"])
        meta["built_at"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        out = {"built_at": meta["built_at"], "action_date": meta.get("action_date") or GJ_ACTION_DATE,
               "sources": source_status(meta), "stats": stats, "places": places}
        _write_json("places.json", out)
        _write_json("meta.json", meta)
    _places_cache["mtime"] = 0
    return {"places": len(places), "calls": stats["calls"], "new_calls": len(new_calls), "errors": errors,
            "changed": changed}


def _pull_framacarte(meta: dict, now_ts: float, errors: list) -> bool:
    try:
        body, _h = _fetch(FC_MAP_URL)
        m = json.loads(body.decode("utf-8"))
        props = m.get("properties") or {}
        tmpl = ((props.get("urls") or {}).get("datalayer_view") or "")
        layers = []
        for dl in props.get("datalayers") or []:
            name = str((dl.get("properties") or {}).get("name") or dl.get("name") or "")
            pk = dl.get("id") or (dl.get("properties") or {}).get("id")
            if pk and any(w in name.lower() for w in FC_LAYER_WORDS):
                layers.append((pk, name))
        meta["framacarte_layers"] = [{"id": pk, "name": n} for pk, n in layers]
        _record(meta, "framacarte", now_ts, True)
    except Exception as e:                                     # noqa: BLE001
        msg = f"{type(e).__name__}: {e}"
        _record(meta, "framacarte", now_ts, False, error=msg)
        errors.append(f"framacarte: {msg}")
        print(f"[endangered] error: fetch framacarte map: {msg} — keeping the copy we have", flush=True)
        return False
    changed = False
    for pk, _name in layers:
        url = (f"https://framacarte.org{tmpl.format(map_id=FC_MAP_ID, pk=pk)}" if tmpl.startswith("/")
               else FC_LAYER_URL.format(map_id=FC_MAP_ID, pk=pk))
        changed |= _pull(meta, f"framacarte:{pk}", url, f"fc_{pk}.json", now_ts, errors)
        # keep the layer's name with its features (uMap's layer body may not carry it)
        d = _read_json(f"fc_{pk}.json")
        if isinstance(d, dict) and not d.get("name"):
            d["name"] = _name
            _write_json(f"fc_{pk}.json", d)
    return changed


def load_raw(meta: dict | None = None) -> dict:
    meta = meta if meta is not None else (_read_json("meta.json", {}) or {})
    raw = {k: _read_json(f"gj_{k}.json") for k in ("sites", "lieux", "stations", "actions")}
    raw["framacarte"] = {}
    for layer in meta.get("framacarte_layers") or []:
        d = _read_json(f"fc_{layer['id']}.json")
        if d:
            raw["framacarte"][layer["id"]] = {"name": d.get("name") or layer.get("name"), "features": d.get("features") or []}
    return raw


# ── normalising ──────────────────────────────────────────────────────────

def _f(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def _s(v) -> str | None:
    s = re.sub(r"\s+", " ", str(v or "")).strip()
    return s or None


def _op_short(op: str | None) -> str | None:
    return (op or "").split(" (")[0].strip() or None


def _call(kind: str, hhmm, date: str, place_id: str, announced: bool = False) -> dict:
    label, level = call_type(kind)
    t = str(hhmm or "").strip()
    t = t if re.fullmatch(r"\d{2}:\d{2}", t) and t != "00:00" else None      # 00:00 = "à préciser"
    c = {"kind": kind, "label_en": label, "level": level, "date": date, "time": t,
         "source_url": f"{GJ_SITE}/carte/#lieu={place_id}", "key": f"{place_id}|{kind}|{t or '-'}|{date}"}
    if announced:
        c["announced"] = True
    return c


def build(raw: dict, first_seen: dict, action_date: str, now: _dt.datetime | None = None) -> tuple[list, dict]:
    """The endangered places from the raw sources. Pure: no network."""
    places: dict[str, dict] = {}
    actions = ((raw.get("actions") or {}).get("actions") or {})
    lieux = list(((raw.get("sites") or {}).get("lieux") or [])) + list(((raw.get("lieux") or {}).get("lieux") or []))
    placed = set()
    for l in lieux:
        if not isinstance(l, list) or len(l) < 9:
            continue
        pid, genre = str(l[0]), str(l[1])
        lat, lon = _f(l[2]), _f(l[3])
        if lat is None or lon is None:
            continue
        acts = actions.get(pid) or []
        announced = len(l) > 10 and l[10] == 1
        roundabout = (len(l) > 11 and l[11] == 1) or any(a and a[0] == "rond_point" for a in acts)
        kind = GENRE_KIND.get(genre)
        if not kind:
            continue
        if kind == "gathering" and not acts and not announced:
            continue                                        # a prefecture with nothing declared
        if kind == "gathering" and roundabout:
            kind = "roundabout"
        calls = [_call(a[0], a[1] if len(a) > 1 else None, action_date, pid) for a in acts if a]
        if not calls and announced:
            calls = [_call("rond_point" if roundabout else "manifestation", l[9] if len(l) > 9 else None,
                           action_date, pid, announced=True)]
        placed.add(pid)
        # The operator column is the operator for a refinery or depot; on a
        # gathering it is a free-text extra a visitor typed — not kept.
        operator = _s(l[5]) if kind in FUEL_SUPPLY else None
        places[pid] = {
            "id": f"gj:{pid}", "source": GJ_LABEL, "source_url": f"{GJ_SITE}/carte/#lieu={pid}",
            "kind": kind, "kind_label": KIND_LABEL[kind], "name": _s(l[4]) or KIND_LABEL[kind],
            "operator": operator, "city": _s(l[6]), "postcode": _s(l[7]), "dept": _s(l[8]),
            "lat": round(lat, 5), "lon": round(lon, 5), "calls": calls,
        }
    # Fuel stations named by a call: their place comes from the station list.
    st = raw.get("stations") or {}
    cols = st.get("colonnes") or ["id", "lat", "lon", "ville", "cp", "adresse", "dep"]
    ix = {c: i for i, c in enumerate(cols)}
    want = {k for k in actions if k not in placed}
    unplaced = 0
    if want:
        found = {}
        for row in st.get("stations") or []:
            try:
                sid = str(row[ix["id"]])
            except (IndexError, KeyError, TypeError):
                continue
            if sid in want:
                found[sid] = row
        for sid in sorted(want):
            row = found.get(sid)
            if row is None:
                unplaced += 1
                continue
            g = lambda c: row[ix[c]] if c in ix and ix[c] < len(row) else None   # noqa: E731
            lat, lon = _f(g("lat")), _f(g("lon"))
            if lat is None or lon is None:
                unplaced += 1
                continue
            addr = _s(g("adresse"))
            places[sid] = {
                "id": f"gj:{sid}", "source": GJ_LABEL, "source_url": f"{GJ_SITE}/carte/#lieu={sid}",
                "kind": "fuel_station", "kind_label": KIND_LABEL["fuel_station"],
                "name": f"Fuel station, {addr}" if addr else "Fuel station",
                "operator": None, "city": _s(g("ville")), "postcode": _s(g("cp")), "dept": _s(g("dep")),
                "lat": round(lat, 5), "lon": round(lon, 5),
                "calls": [_call(a[0], a[1] if len(a) > 1 else None, action_date, sid) for a in actions[sid] if a],
            }
    out = list(places.values())
    out += _framacarte_places(raw.get("framacarte") or {})
    for p in out:
        for c in p["calls"]:
            if c["key"] in first_seen:
                c["first_seen"] = first_seen[c["key"]]
        lv = sorted((c["level"] for c in p["calls"]), key=lambda x: LEVEL_RANK.get(x, 9))
        p["level"] = lv[0] if lv else None
    stats = stats_of(out)
    stats["unplaced_calls"] = unplaced
    return out, stats


_POSTCODE_CITY = re.compile(r"(\d{5})\s*,?\s*([A-ZÀ-Ýa-zà-ÿ' \-]+?)\s*(?:CEDEX.*)?$")


def _framacarte_places(layers: dict) -> list[dict]:
    seen: dict[tuple, dict] = {}
    for _pk, layer in layers.items():
        lname = _s(layer.get("name")) or "Framacarte"
        for f in layer.get("features") or []:
            g = f.get("geometry") or {}
            if g.get("type") != "Point":
                continue
            try:
                lon, lat = float(g["coordinates"][0]), float(g["coordinates"][1])
            except (KeyError, IndexError, TypeError, ValueError):
                continue
            p = f.get("properties") or {}
            name = _s(p.get("NOM") or p.get("Nom") or p.get("NAME"))
            if not name:
                continue
            key = (name.upper(), round(lat, 3), round(lon, 3))
            if key in seen:
                if lname not in seen[key]["lists"]:
                    seen[key]["lists"].append(lname)
                continue
            addr = _s(p.get("ADRESSE"))
            m = _POSTCODE_CITY.search(addr or "")
            seen[key] = {
                "id": "fc:" + hashlib.sha1("|".join(map(str, key)).encode()).hexdigest()[:10],
                "source": FC_LABEL, "source_url": FC_PUBLIC_URL,
                "kind": "arms_company", "kind_label": KIND_LABEL["arms_company"], "name": name,
                "operator": None, "city": (m.group(2).strip().title() if m else None),
                "postcode": (m.group(1) if m else None), "dept": (m.group(1)[:2] if m else None),
                "address": addr, "sector": _s(p.get("SECTEUR") or p.get("TYPE") or p.get("Type")),
                "domain": _s(p.get("DOMAINE")), "lists": [lname],
                "lat": round(lat, 5), "lon": round(lon, 5), "calls": [], "note": FC_NOTE,
            }
    return list(seen.values())


def stats_of(places: list[dict]) -> dict:
    by_kind, by_call, by_dept, by_level = {}, {}, {}, {}
    calls = 0
    for p in places:
        by_kind[p["kind"]] = by_kind.get(p["kind"], 0) + 1
        for c in p["calls"]:
            calls += 1
            by_call[c["kind"]] = by_call.get(c["kind"], 0) + 1
            by_level[c["level"]] = by_level.get(c["level"], 0) + 1
            if p.get("dept"):
                by_dept[p["dept"]] = by_dept.get(p["dept"], 0) + 1
    return {"places": len(places), "places_with_calls": sum(1 for p in places if p["calls"]), "calls": calls,
            "by_kind": by_kind, "by_call": by_call, "by_level": by_level,
            "top_departments": sorted(by_dept.items(), key=lambda x: -x[1])[:10]}


def source_status(meta: dict) -> list[dict]:
    h = meta.get("http") or {}

    def iso(ts):
        return _dt.datetime.fromtimestamp(ts, _dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ts else None
    gj = [h.get(k) or {} for k in ("actions", "lieux", "sites", "stations")]
    fc = [v for k, v in h.items() if k.startswith("framacarte")]
    return [
        {"name": GJ_LABEL, "url": f"{GJ_SITE}/carte/", "telegram": GJ_TELEGRAM,
         "ok_at": iso(max((x.get("ok_at") or 0) for x in gj)) if gj else None,
         "error": next((x.get("error") for x in gj if x.get("error")), None),
         "note": "Public map of the gilets jaunes' calls for Sat 17 Oct 2026; its data is erased after 31 Dec 2026"},
        {"name": FC_LABEL, "url": FC_PUBLIC_URL,
         "ok_at": iso(max((x.get("ok_at") or 0) for x in fc)) if fc else None,
         "error": next((x.get("error") for x in fc if x.get("error")), None),
         "note": "Arms-industry companies an anti-militarist map lists as targets for action"},
    ]


# ── derived on read ──────────────────────────────────────────────────────

def _zone():
    from zoneinfo import ZoneInfo
    return ZoneInfo(TZ)


def call_start(c: dict) -> _dt.datetime | None:
    try:
        d = _dt.date.fromisoformat(c["date"])
    except (KeyError, TypeError, ValueError):
        return None
    hh, mm = (c.get("time") or "07:00").split(":")
    return _dt.datetime(d.year, d.month, d.day, int(hh), int(mm), tzinfo=_zone())


def call_end(c: dict) -> _dt.datetime | None:
    try:
        d = _dt.date.fromisoformat(c["date"])
    except (KeyError, TypeError, ValueError):
        return None
    return _dt.datetime(d.year, d.month, d.day, 23, 59, tzinfo=_zone())


def when_label(c: dict) -> str:
    try:
        d = _dt.date.fromisoformat(c["date"])
    except (KeyError, TypeError, ValueError):
        return "date not given"
    day = f"{d.strftime('%a')} {d.day} {d.strftime('%b')}"
    return f"{day}, {c['time']}" if c.get("time") else f"{day}, time to be confirmed"


def call_line(c: dict, source: str = GJ_LABEL) -> str:
    """'Filtering roadblock called for Sat 17 Oct, 09:00 — source: 17octobregiletjaune.net'"""
    what = c["label_en"] + (" announced" if c.get("announced") else " called")
    return f"{what} for {when_label(c)} — source: {source}"


def annotate(p: dict, now: _dt.datetime | None = None) -> dict:
    """status and alarm, from the calls and the clock."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    today = now.astimezone(_zone()).date().isoformat()
    live = [c for c in p["calls"] if (call_end(c) or now) >= now]
    if not p["calls"]:
        status = "listed (no call)"
    elif any(c["date"] == today for c in live):
        status = "call active today"
    elif live:
        status = "upcoming"
    else:
        status = "past"
    alarm = "grey"
    for c in live:
        start = call_start(c)
        if c["level"] == "high" and start is not None and (start - now).total_seconds() <= 48 * 3600:
            alarm = "red"
            break
        alarm = "amber"
    nxt = min((call_start(c) for c in live if call_start(c)), default=None)
    q = {**p, "status": status, "alarm": alarm,
         "next_at": nxt.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if nxt else None,
         "calls": [{**{k: v for k, v in c.items() if k not in ("key", "first_seen")
                       and not (k == "source_url" and v == p.get("source_url"))},
                    "line": call_line(c, p["source"])} for c in p["calls"]]}
    return q


_places_cache: dict = {"mtime": 0, "data": None}


def load_places() -> dict:
    """The last build, re-read only when the file changes (both processes
    read the same file; the loop writes it)."""
    p = _dir() / "places.json"
    try:
        m = p.stat().st_mtime
    except FileNotFoundError:
        return {"built_at": None, "action_date": GJ_ACTION_DATE, "sources": [], "stats": {}, "places": []}
    if _places_cache["data"] is None or _places_cache["mtime"] != m:
        d = _read_json("places.json", None)
        if d is None:
            return _places_cache["data"] or {"built_at": None, "action_date": GJ_ACTION_DATE, "sources": [],
                                             "stats": {}, "places": []}
        _places_cache.update(mtime=m, data=d)
    return _places_cache["data"]


def query(bbox: str | None = None, status: str | None = None, kind: str | None = None,
          now: _dt.datetime | None = None, data: dict | None = None) -> dict:
    """GET /api/endangered-places: annotated places, optionally in a bbox
    (south,west,north,east), of some statuses / kinds (comma lists)."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    d = data if data is not None else load_places()
    box = None
    if bbox:
        try:
            s, w, n, e = (float(x) for x in bbox.split(","))
            box = (s, w, n, e)
        except ValueError:
            box = None
    want_status = {x.strip().lower() for x in (status or "").split(",") if x.strip()}
    want_kind = {x.strip().lower() for x in (kind or "").split(",") if x.strip()}
    out = []
    for p in d.get("places") or []:
        if box and not (box[0] <= p["lat"] <= box[2] and (box[1] <= p["lon"] <= box[3] if box[1] <= box[3]
                                                          else (p["lon"] >= box[1] or p["lon"] <= box[3]))):
            continue
        if want_kind and p["kind"] not in want_kind:
            continue
        q = annotate(p, now)
        if want_status and q["status"] not in want_status:
            continue
        out.append({k: v for k, v in q.items() if v is not None and v != []} | {"calls": q["calls"]})
    rank = {"red": 0, "amber": 1, "grey": 2}
    out.sort(key=lambda p: (rank[p["alarm"]], p.get("next_at") or "9999", p["name"]))
    counts = {"places": len(out), "red": sum(1 for p in out if p["alarm"] == "red"),
              "amber": sum(1 for p in out if p["alarm"] == "amber"),
              "grey": sum(1 for p in out if p["alarm"] == "grey"),
              "calls": sum(len(p["calls"]) for p in out)}
    return {"built_at": d.get("built_at"), "action_date": d.get("action_date"), "sources": d.get("sources") or [],
            "counts": counts, "stats": d.get("stats") or {}, "places": out,
            "calls_within_7_days": calls_within(d, now, 7)}


def calls_within(d: dict, now: _dt.datetime, days: int) -> bool:
    """Any call still to come within `days` (the map layer's default)."""
    for p in d.get("places") or []:
        for c in p["calls"]:
            s, e = call_start(c), call_end(c)
            if e and e >= now and s and (s - now).total_seconds() <= days * 86400:
                return True
    return False


# ── alerts ───────────────────────────────────────────────────────────────

SOURCE = "public-calls"
TYPE_SUMMARY = "Endangered places: calls to act"
TYPE_PLACE = "Endangered place: blockade called"
TYPE_DAY = "Endangered places: action day"
ALERT_TYPES = (TYPE_SUMMARY, TYPE_PLACE, TYPE_DAY)
SUMMARY_MIN_CALLS = 5
MORNING = (6, 13)            # the action day's reminder is written between 06:00 and 13:00 Paris time


def _n(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _high_phrase(counts: dict) -> str:
    parts = [_n(counts[k], HIGH_SINGULAR[k], HIGH_PLURAL[k]) for k in HIGH_PLURAL if counts.get(k)]
    return ", ".join(parts)


def _day_label(date: str) -> str:
    d = _dt.date.fromisoformat(date)
    return f"{d.strftime('%a')} {d.day} {d.strftime('%b')}"


def _expires(date: str) -> _dt.datetime:
    d = _dt.date.fromisoformat(date) + _dt.timedelta(days=1)
    return _dt.datetime(d.year, d.month, d.day, 23, 0)


def summary_alert(places: list[dict], date: str) -> dict | None:
    on_day = [(p, c) for p in places for c in p["calls"] if c["date"] == date and p["source"] == GJ_LABEL]
    if len(on_day) < SUMMARY_MIN_CALLS:
        return None
    counts: dict[str, int] = {}
    for _p, c in on_day:
        counts[c["kind"]] = counts.get(c["kind"], 0) + 1
    where: dict[str, int] = {}
    for p, _c in on_day:
        where[p["kind"]] = where.get(p["kind"], 0) + 1
    n_places = len({p["id"] for p, _c in on_day})
    hi = _high_phrase(counts)
    fuel = where.get("refinery", 0) + where.get("fuel_depot", 0)
    title = (f"Gilets jaunes call {len(on_day)} actions at {n_places} places in France for {_day_label(date)}"
             + (f" — {hi}" if hi else "")
             + (f"; {where.get('fuel_station', 0)} at fuel stations, {fuel} at refineries and fuel depots"
                if where.get("fuel_station") or fuel else ""))
    lines = ", ".join(f"{call_type(k)[0].lower()} {v}" for k, v in sorted(counts.items(), key=lambda x: -x[1]))
    fuel_names = sorted({p["name"] for p, c in on_day if p["kind"] in FUEL_SUPPLY and c["level"] == "high"})
    reason = (f"public calls on {GJ_LABEL} — {_n(len(on_day), 'action', 'actions')} at "
              f"{_n(n_places, 'place', 'places')} (fuel stations, refineries, depots, rallies)")
    message = (f"Calls posted on {GJ_LABEL} for {_day_label(date)}: {lines}. "
               + (f"High-disruption calls at fuel-supply sites: {', '.join(fuel_names[:8])}. " if fuel_names else "")
               + "Each place, its calls and the source are on the map layer “Endangered places”.")
    return {
        "id": f"EPL-SUM-{date.replace('-', '')}", "source": SOURCE, "alert_type": TYPE_SUMMARY,
        "title": title, "severity": "high", "lat": FRANCE[0], "lon": FRANCE[1], "region": "France",
        "country_code": "FR", "entity_type": "campaign", "entity_id": f"gj-{date}",
        "entity_name": "Gilets jaunes, 17 October", "confidence": 0.8, "message": message, "reason": reason,
        "expires_at": _expires(date),
        "raw": {"rule": "endangered_places_summary", "date": date, "calls": len(on_day), "places": n_places,
                "by_call": counts, "by_kind": where, "reason": reason, "source_url": f"{GJ_SITE}/carte/",
                "telegram": GJ_TELEGRAM},
        "_sig": [len(on_day), n_places],
    }


def place_alerts(places: list[dict], date: str) -> list[dict]:
    """One per refinery / fuel depot with a high-level call that day."""
    out = []
    for p in places:
        if p["kind"] not in FUEL_SUPPLY:
            continue
        high = [c for c in p["calls"] if c["date"] == date and c["level"] == "high"]
        if not high:
            continue
        high.sort(key=lambda c: c.get("time") or "99")
        first = high[0]
        op = _op_short(p.get("operator"))
        if op and op.lower() in p["name"].lower():
            op = None
        what = first["label_en"] if len(high) == 1 else " and ".join(sorted({c["label_en"] for c in high}))
        title = (f"Gilets jaunes: {what} called at {p['name']}"
                 f" ({p['kind_label'].lower()}{', ' + op if op else ''}{', ' + p['city'] if p.get('city') and p['city'] not in p['name'] else ''})"
                 f" — {when_label(first)}")
        reason = (f"{first['label_en'].lower()} called at a {p['kind_label'].lower()} — fuel supply in the area may be "
                  f"disrupted (source: {GJ_LABEL})")
        others = [c for c in p["calls"] if c not in high and c["date"] == date]
        message = "; ".join(call_line(c) for c in high + others) + "."
        pid = p["id"].split(":", 1)[1]
        out.append({
            "id": f"EPL-{pid}-{date.replace('-', '')}", "source": SOURCE, "alert_type": TYPE_PLACE,
            "title": title, "severity": "high", "lat": p["lat"], "lon": p["lon"],
            "region": f"{p.get('city') or ''}{' (' + p['dept'] + ')' if p.get('dept') else ''}".strip() or "France",
            "country_code": "FR", "entity_type": "place", "entity_id": p["id"], "entity_name": p["name"],
            "confidence": 0.7, "message": message, "reason": reason, "expires_at": _expires(date),
            "raw": {"rule": "endangered_place_high_call", "place_id": p["id"], "kind": p["kind"],
                    "operator": p.get("operator"), "calls": [{k: c.get(k) for k in ("kind", "label_en", "level", "date", "time")}
                                                             for c in high + others],
                    "reason": reason, "source_url": p["source_url"]},
            "_sig": sorted(c["key"] for c in high),
        })
    return out


def day_alert(places: list[dict], date: str, now: _dt.datetime) -> dict | None:
    local = now.astimezone(_zone())
    if local.date().isoformat() != date or not (MORNING[0] <= local.hour < MORNING[1]):
        return None
    on_day = [(p, c) for p in places for c in p["calls"] if c["date"] == date and p["source"] == GJ_LABEL]
    if not on_day:
        return None
    counts: dict[str, int] = {}
    first_high = None
    for _p, c in on_day:
        counts[c["kind"]] = counts.get(c["kind"], 0) + 1
        if c["level"] == "high" and c.get("time") and (first_high is None or c["time"] < first_high):
            first_high = c["time"]
    n_places = len({p["id"] for p, _c in on_day})
    hi = _high_phrase(counts)
    fuel = sorted({p["city"] or p["name"] for p, c in on_day if p["kind"] in FUEL_SUPPLY and c["level"] == "high"})
    title = (f"Today: gilets jaunes actions at {n_places} places in France"
             + (f" — {hi}" + (f" from {first_high}" if first_high else "") if hi else "")
             + (f"; fuel sites: {', '.join(fuel[:4])}{' and more' if len(fuel) > 4 else ''}" if fuel else ""))
    reason = f"the action day called on {GJ_LABEL}"
    return {
        "id": f"EPL-DAY-{date.replace('-', '')}", "source": SOURCE, "alert_type": TYPE_DAY,
        "title": title, "severity": "high", "lat": FRANCE[0], "lon": FRANCE[1], "region": "France",
        "country_code": "FR", "entity_type": "campaign", "entity_id": f"gj-{date}",
        "entity_name": "Gilets jaunes, 17 October", "confidence": 0.8, "reason": reason,
        "message": f"{len(on_day)} actions called today at {n_places} places. See the layer “Endangered places”.",
        "expires_at": _expires(date),
        "raw": {"rule": "endangered_places_day", "date": date, "calls": len(on_day), "by_call": counts,
                "reason": reason, "source_url": f"{GJ_SITE}/carte/"},
        "_sig": [date],
    }


def plan_alerts(places: list[dict], date: str, sent: dict, now: _dt.datetime) -> dict:
    """{"new": [...], "update": [...]} against what was already written
    (`sent`: alert id → signature). Nothing after the action day."""
    if now.astimezone(_zone()).date().isoformat() > date:
        return {"new": [], "update": []}
    want = [a for a in [summary_alert(places, date), day_alert(places, date, now)] if a] + place_alerts(places, date)
    new, upd = [], []
    for a in want:
        if a["id"] not in sent:
            new.append(a)
        elif sent[a["id"]] != a["_sig"]:
            upd.append(a)
    return {"new": new, "update": upd}


def due_alerts(now: _dt.datetime | None = None) -> dict:
    """What the loop should write now, from the last build."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    d = load_places()
    meta = _read_json("meta.json", {}) or {}
    return plan_alerts(d.get("places") or [], d.get("action_date") or GJ_ACTION_DATE, meta.get("alerts") or {}, now)


def mark_sent(alerts: list[dict]) -> None:
    with _lock:
        meta = _read_json("meta.json", {}) or {}
        s = meta.setdefault("alerts", {})
        for a in alerts:
            s[a["id"]] = a.get("_sig")
        _write_json("meta.json", meta)


def for_writer(a: dict) -> dict:
    return {k: v for k, v in a.items() if not k.startswith("_")}


def update_alert(a: dict) -> bool:
    """Bring an alert already written up to date in place — the same row,
    the same id, so the tray and the record show one, not two."""
    from database import Alert, get_db
    with get_db() as db:
        row = db.query(Alert).filter(Alert.alert_id == a["id"]).first()
        if row is None:
            return False
        row.title = a["title"]
        row.severity = a["severity"]
        row.raw_json = json.dumps(for_writer(a), default=str)
        db.commit()
    return True


# ── per user (event_watch.cards_for) ─────────────────────────────────────

NEAR_KM = 25.0
CAP_NEAR = 6
CARD_WINDOW_DAYS = 7
THEATER_ALL_SHARE = 0.8      # a theater holding this share of all places is the national summary again


def cards_for(c: dict, now: _dt.datetime | None = None, data: dict | None = None) -> list[dict]:
    """The calls that concern this user: one card per place within 25 km
    (or their asset's own watch radius, if wider) of an asset or of where
    they are; one card per theater with how many places are inside it."""
    import event_watch as ew
    now = now or _dt.datetime.now(_dt.timezone.utc)
    if not (c.get("assets") or c.get("theaters")):
        return []
    d = data if data is not None else load_places()
    live = []
    for p in d.get("places") or []:
        if not p["calls"]:
            continue
        q = annotate(p, now)
        # only calls that start within the week: a card is about disruption
        # coming, the layer and the summary carry the rest
        nxt = call_start({"date": q["next_at"][:10]}) if q.get("next_at") else None
        if q["status"] in ("upcoming", "call active today") and nxt and (nxt - now).total_seconds() <= CARD_WINDOW_DAYS * 86400:
            live.append((p, q))
    if not live:
        return []
    cards, near_ids = [], set()
    near = []
    for p, q in live:
        best = None
        for a in c.get("assets") or []:
            dist = ew.km(a["lat"], a["lon"], p["lat"], p["lon"])
            if dist <= max(NEAR_KM, float(a.get("radius") or 0)) and (best is None or dist < best[0]):
                best = (dist, a)
        if best:
            near.append((p, q, best))
    near.sort(key=lambda x: (LEVEL_RANK.get(x[0]["level"], 9), x[2][0]))
    for p, q, (dist, a) in near[:CAP_NEAR]:
        near_ids.add(p["id"])
        live_calls = [x for x in p["calls"] if (call_end(x) or now) >= now]
        live_calls.sort(key=lambda x: (LEVEL_RANK.get(x["level"], 9), x.get("time") or "99"))
        top = live_calls[0]
        dist_s = "under 1 km" if dist < 1 else f"{round(dist)} km"
        reason = (f"{dist_s} from where you are" if a.get("me")
                  else f"{dist_s} from your {(a.get('label') + ' ') if a.get('label') else ''}{a['name']}")
        more = f" (+{len(live_calls) - 1} more)" if len(live_calls) > 1 else ""
        title = f"{top['label_en']} called at {p['name']}{', ' + p['city'] if p.get('city') and p['city'] not in p['name'] else ''} — {when_label(top)}{more}"
        seen = [x.get("first_seen") for x in p["calls"] if x.get("first_seen")]
        cards.append({
            "id": f"epl:{p['id']}:{top['date']}", "title": title, "kind": "announcement",
            "alert_type": "Endangered place", "sev": "moderate" if p["level"] == "low" else "high",
            "reason": reason, "lat": p["lat"], "lon": p["lon"], "source": p["source"], "url": p["source_url"],
            "starts_at": q.get("next_at"), "notify": True, "created_at": min(seen) if seen else q.get("next_at"),
            "advice": f"Expect disruption around {p['name']} on {when_label(top).split(',')[0]}; check access and deliveries.",
        })
    seen_sets = set()
    for t in c.get("theaters") or []:
        inside = [(p, q) for p, q in live if ew.km(t["lat"], t["lon"], p["lat"], p["lon"]) <= t["reach"]]
        if not inside:
            continue
        # A theater over (nearly) all of France says what the national
        # summary already says; two theaters over the same places, once.
        ids = frozenset(p["id"] for p, _q in inside)
        if len(inside) >= THEATER_ALL_SHARE * len(live) or ids in seen_sets:
            continue
        seen_sets.add(ids)
        date = min(x["date"] for p, _q in inside for x in p["calls"])
        counts: dict[str, int] = {}
        for p, _q in inside:
            for x in p["calls"]:
                counts[x["kind"]] = counts.get(x["kind"], 0) + 1
        hi = _high_phrase(counts)
        n_calls = sum(counts.values())
        title = (f"Gilets jaunes: {_n(n_calls, 'action', 'actions')} called at {_n(len(inside), 'place', 'places')} "
                 f"in your theater {t['name']} for {_day_label(date)}" + (f" — {hi}" if hi else ""))
        seen = [x.get("first_seen") for p, _q in inside for x in p["calls"] if x.get("first_seen")]
        cards.append({
            "id": f"epl-th:{t['name']}:{date}", "title": title, "kind": "announcement",
            "alert_type": "Endangered places", "sev": "high" if hi else "moderate",
            "reason": f"in your theater {t['name']} · {len(inside)} places", "lat": t["lat"], "lon": t["lon"],
            "source": GJ_LABEL, "url": f"{GJ_SITE}/carte/", "notify": True,
            "created_at": min(seen) if seen else None,
        })
    return cards
