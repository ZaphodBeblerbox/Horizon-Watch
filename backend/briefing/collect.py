"""
briefing/collect.py — the evidence for one issue: what happened in the
period that reaches this recipient.

Reads every store the console keeps — detector alerts (AIS, ADS-B, GPS
interference, sanctions), fusions, published Telegram posts and
announcements, GeoConfirmed placemarks, news, surge events and the imagery
detections — for the reporting period, over the area the profile covers
(its sites and countries).

Then, in order:

  categorise  every signal gets its threat category (owned_assets.category)
  reach       it is kept only for a vector that takes that category AND
              covers its place: within a site's radius, inside a vector
              country, or the same kind of target elsewhere in a site's
              country (a precedent). A sanctioned tanker in the Baltic
              reaches no vector of a Berlin substation; a protest outside
              it does.
  merge       reports of the same event (same category, same day, within
              15 km, or the same words) become one event with every source
              kept — corroboration is counted in independent source
              families, which is what the FACT tag needs (two).
  score       severity × closeness × corroboration.
  select      stratified: no day and no vector may crowd out the rest, so
              a quiet week still shows its one relevant event.

Each kept event is numbered S-01, S-02 … — the ids the writer cites and the
reader can open. Imagery detections carry a crop of the scene (cut from the
stored scan image) to print as Parallax's own figures. Everything here is
code; no model is called.
"""
from __future__ import annotations

import base64
import datetime as _dt
import io
import json
import math
import re
import sqlite3
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

from . import spec

# how many events the writer gets to choose from, per cadence
TAKE = {"daily": 40, "weekly": 120, "monthly": 320}
CROPS = {"daily": 1, "weekly": 3, "monthly": 6}
ROWS_PER_SOURCE = 120000
MERGE_KM = 15.0

PLACE_W = {"site": 1.0, "city": 0.55, "precedent": 0.6, "country": 0.35, "keyword": 0.3}

# Detectors that report a standing condition rather than an event: hundreds
# of GPS-interference cells a week, every dark ship, every tank in a scene.
# One of them is noise; the period's run of them is the finding. They are
# folded into one pattern per vector and detector (days active, peak, places).
PATTERNS = {"gps_interference", "military_aircraft", "AIS_DARK_SHIP", "Sanctioned Vessel", "Sanctioned Vessel (Possible)",
            "AIS_CHOKEPOINT_ACTIVITY", "AIS_POSITION_JUMP", "storage_tank", "port_infrastructure", "structural_change"}

# Geocodes from text (news, aggregator posts) are city-level at best: inside a
# city they say "in Berlin", not "1 km from our site".
CITY_LEVEL = {"news", "surge"}
STREETISH = re.compile(r"\d|stra(ß|ss)e|street|\bstr\.|road|avenue|platz|center|centre|kunden", re.I)

# who is a party: state-aligned outlets and channels whose word is a claim, not a report
INTERESTED = re.compile(r"\b(tass|ria novosti|rt\b|sputnik|xinhua|global times|cgtn|press ?tv|irna|tasnim|fars|"
                        r"kcna|al[- ]?manar|mil\.ru|mod russia|idf|ukraine mod|general staff|houthi|saba)\b", re.I)

# an act of force or disruption, named in so many words (en, de, fr)
ACT = re.compile(r"\b(attack\w*|strike\w*|struck|explosion|explod\w*|blast|bomb\w*|drone\w*|missile\w*|shell\w*|shot|shooting|"
                 r"killed|wounded|injured|clash\w*|riot\w*|protest\w*|sabotag\w*|arson|fire|blaze|hack\w*|cyber\w*|outage|"
                 r"blackout|destroy\w*|damag\w*|zerstör\w*|beschädig\w*|détrui\w*|endommag\w*|raid\w*|seiz\w*|hijack\w*|anschlag\w*|angriff\w*|explosion|brand\w*|sabotage|drohne\w*|"
                 r"demonstration\w*|krawall\w*|attaque\w*|frappe\w*|incendie\w*|émeute\w*|manifestation\w*)\b", re.I)

FAMILY = {"alert": "sensor", "fusion": "sensor", "imagery": "imagery", "telegram": "telegram",
          "announcement": "telegram", "geoconfirmed": "geoconfirmed", "news": "news", "surge": "news"}


def _db_path() -> str:
    try:
        from paths import DB_PATH
        return str(DB_PATH)
    except Exception:                                        # noqa: BLE001
        return str(Path(__file__).resolve().parent.parent / "data" / "akili.db")


def km(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 12742 * math.asin(min(1.0, math.sqrt(h)))


# ── countries as shapes ──────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _country_shapes():
    from shapely.geometry import shape
    from shapely.prepared import prep
    p = Path(__file__).resolve().parent.parent / "geo" / "countries.geojson"
    out = {}
    for f in json.loads(p.read_text())["features"]:
        props = f.get("properties") or {}
        try:
            g = shape(f["geometry"])
        except Exception:                                    # noqa: BLE001
            continue
        out[props.get("name")] = {"geom": g, "prep": prep(g), "bbox": g.bounds, "iso2": props.get("ISO3166-1-Alpha-2")}
    return out


def country_at(lat: float, lon: float) -> str | None:
    """The country a point is in, or None at sea — never a guess."""
    from shapely.geometry import Point
    pt = Point(lon, lat)
    for name, c in _country_shapes().items():
        w, s, e, n = c["bbox"]
        if w <= lon <= e and s <= lat <= n and c["prep"].contains(pt):
            return name
    return None


def iso2(name: str | None) -> str | None:
    c = _country_shapes().get(name or "")
    return c["iso2"] if c else None


# ── reading the stores ───────────────────────────────────────────────────────

def _ts(t: _dt.datetime, sep: str = " ") -> str:
    return t.astimezone(_dt.timezone.utc).replace(tzinfo=None).isoformat(sep=sep, timespec="seconds")


def _bboxes(profile: dict) -> list[tuple[float, float, float, float]]:
    """Boxes (west, south, east, north) that cover the sites and the countries."""
    out = []
    for s in profile.get("sites") or []:
        if s.get("lat") is None or s.get("lon") is None:
            continue
        r = float(s.get("radius_km") or 25)
        dlat = r / 111.0
        dlon = r / (111.0 * max(0.2, math.cos(math.radians(s["lat"]))))
        out.append((s["lon"] - dlon, s["lat"] - dlat, s["lon"] + dlon, s["lat"] + dlat))
    shapes = _country_shapes()
    names = set(profile.get("countries") or [])
    for v in profile.get("vectors") or []:
        names |= set(v.get("countries") or [])
    # precedents: a site's own country is searched for its kind of target
    for s in profile.get("sites") or []:
        if s.get("country"):
            names.add(s["country"])
    for n in names:
        if n in shapes:
            out.append(shapes[n]["bbox"])
    return out


def _bbox_sql(lat: str, lon: str, boxes) -> tuple[str, list]:
    if not boxes:
        return "0", []
    parts, args = [], []
    for w, s, e, n in boxes:
        parts.append(f"({lat} BETWEEN ? AND ? AND {lon} BETWEEN ? AND ?)")
        args += [s, n, w, e]
    return "(" + " OR ".join(parts) + ")", args


DATE_ONLY = re.compile(r"^\s*\d{1,2} [A-Z]{3} \d{4}\s*$")
COORD_TITLE = re.compile(r"^\s*-?\d+(\.\d+)?°[NS]\s+-?\d+(\.\d+)?°[EW]\b")


def _j(v, default=None):
    try:
        return json.loads(v) if isinstance(v, str) else (v if v is not None else default)
    except (TypeError, ValueError):
        return default


def _first_url(text: str | None) -> str | None:
    m = re.search(r"https?://\S+", text or "")
    return m.group(0).rstrip(").,") if m else None


def read_items(con, start: _dt.datetime, end: _dt.datetime, boxes, counts: Counter, isos: list[str] | None = None) -> list[dict]:
    """Every signal of the period inside the boxes, as uniform items."""
    items: list[dict] = []
    a, b = _ts(start), _ts(end)
    aT, bT = _ts(start, "T"), _ts(end, "T")

    def q(name, sql, args):
        try:
            rows = con.execute(sql, args).fetchall()
        except sqlite3.OperationalError as e:
            print(f"[briefing/collect] {name} skipped: {e}")
            return []
        counts[name] += len(rows)
        return rows

    where, args = _bbox_sql("lat", "lon", boxes)
    for r in q("alerts", f"SELECT alert_id, source, alert_type, title, severity, lat, lon, region, country_code, entity_name, "
                         f"entity_type, raw_json, created_at, fire_count FROM alerts WHERE created_at >= ? AND created_at < ? AND {where} "
                         f"ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC "
                         f"LIMIT {ROWS_PER_SOURCE}", [a, b, *args]):
        raw = _j(r["raw_json"], {}) or {}
        title, detail, url, kind = r["title"] or r["alert_type"], raw.get("message") or "", None, "alert"
        if r["alert_type"] == "geoconfirmed_event":
            # titled with its date; what happened is in the placemark's description
            inner = raw.get("raw") or ""
            if isinstance(inner, dict):
                desc, inner = str(inner.get("description") or ""), str(inner.get("original_source") or "")
            else:
                m = re.search(r"'description': ['\"](.+?)['\"], '", inner)
                desc = m.group(1) if m else ""
            desc = re.sub(r"^[\d:\s\-–,]+(-|–)\s*", "", desc)
            title, detail, url, kind = desc[:160] or title, desc, _first_url(inner), "geoconfirmed"
        items.append({"ref": f"alert:{r['alert_id']}", "kind": kind, "source": "GeoConfirmed" if kind == "geoconfirmed" else (r["source"] or ""),
                      "detector": r["alert_type"], "url": url,
                      "title": title, "detail": detail, "severity": r["severity"],
                      "lat": r["lat"], "lon": r["lon"], "when": r["created_at"], "place": r["region"] or "",
                      "entity": r["entity_name"] or "", "count": r["fire_count"] or 1})

    for r in q("fusion", f"SELECT fusion_id, title, narrative, severity, confidence, domains, location_name, lat, lon, created_at, "
                         f"signal_count, key_signals FROM fusion_events WHERE created_at >= ? AND created_at < ? AND {where} "
                         f"LIMIT {ROWS_PER_SOURCE}", [a, b, *args]):
        domains = _j(r["domains"], []) or []
        keys = [re.sub(r"^[\w ()]+:\s*", "", k) for k in (_j(r["key_signals"], []) or [])]
        keys = [k for k in keys if not DATE_ONLY.match(k)]
        title = r["title"] or ""
        if (COORD_TITLE.match(title) or DATE_ONLY.match(title)) and keys:
            title = keys[0]                                  # "52.39°N 13.54°E Intelligence Event" says nothing
        place = re.sub(r"\s*·\s*-?\d+\.\d+°[NS].*$", "", r["location_name"] or "")
        items.append({"ref": f"fusion:{r['fusion_id']}", "kind": "fusion", "source": "FUSION " + " ".join(domains), "detector": "fusion",
                      "title": title, "detail": r["narrative"] or "; ".join(keys)[:600],
                      "severity": r["severity"], "lat": r["lat"], "lon": r["lon"], "when": r["created_at"],
                      "place": "" if COORD_TITLE.match(place) else place, "confidence": r["confidence"], "keys": keys})

    for r in q("telegram", f"SELECT channel, msg_id, channel_title, posted_at, headline, summary_en, event_type, place, lat, lon, "
                           f"role, party, claim, first_hand, media, thumb, graphic, unpublished_reason FROM telegram_posts "
                           f"WHERE relevant = 1 AND posted_at >= ? AND posted_at < ? AND {where}", [aT, bT, *args]):
        if r["unpublished_reason"] and "announce" not in (r["unpublished_reason"] or ""):
            # published posts only: what the console refused to publish is not evidence either
            continue
        items.append({"ref": f"telegram:{r['channel']}/{r['msg_id']}", "kind": "telegram", "source": f"Telegram @{r['channel']}",
                      "detector": r["event_type"] or "telegram", "title": r["headline"] or "", "detail": r["summary_en"] or "",
                      "severity": "high" if r["event_type"] in ("attack", "explosion", "strike") else "medium",
                      "lat": r["lat"], "lon": r["lon"], "when": r["posted_at"], "place": r["place"] or "",
                      "url": f"https://t.me/{r['channel']}/{r['msg_id']}", "first_hand": bool(r["first_hand"]),
                      "interested": bool(r["party"]) or bool(INTERESTED.search(r["channel_title"] or "")),
                      "media": r["media"] if r["media"] not in (None, "none") else None, "graphic": bool(r["graphic"]),
                      "city_level": r["role"] == "aggregator" or not r["first_hand"]})

    gwhere, gargs = _bbox_sql("latitude", "longitude", boxes)
    for r in q("geoconfirmed", f"SELECT id, title, name, description, date, latitude, longitude, faction, category, original_source, "
                               f"theatre_slug FROM geoconfirmed_placemarks WHERE date >= ? AND date < ? AND {gwhere} "
                               f"LIMIT {ROWS_PER_SOURCE}", [a, b, *gargs]):
        title = r["title"] or r["name"] or ""
        items.append({"ref": f"geoconfirmed:{r['id']}", "kind": "geoconfirmed", "source": "GeoConfirmed", "detector": r["category"] or "",
                      "title": title, "detail": (r["description"] or "")[:600], "severity": "high" if r["category"] == "conflict" else "medium",
                      "lat": r["latitude"], "lon": r["longitude"], "when": r["date"],
                      "place": title.split(" — ", 1)[1] if " — " in title else "", "url": _first_url(r["original_source"])})

    for r in q("news", f"SELECT id, url, title, source_name, published, lat, lon, location_name, country_code, tier, relevance_score, "
                       f"article_type, context_summary FROM news_articles WHERE published >= ? AND published < ? AND COALESCE(status, '') != 'retired' AND "
                       f"({where} OR country_code IN ({','.join('?' * len(isos or [])) or 'NULL'}))", [aT, bT, *args, *(isos or [])]):
        items.append({"ref": f"news:{r['id']}", "kind": "news", "source": r["source_name"] or "", "detector": r["article_type"] or "news",
                      "title": r["title"] or "", "detail": r["context_summary"] or "", "severity": "high" if (r["relevance_score"] or 0) >= 8 else "medium",
                      "lat": r["lat"], "lon": r["lon"], "when": r["published"],
                      "place": "" if STREETISH.search(r["location_name"] or "") else (r["location_name"] or ""),
                      "url": r["url"], "tier": r["tier"], "interested": bool(INTERESTED.search(r["source_name"] or ""))})

    for r in q("surge", f"SELECT surge_id, headline, location_name, lat, lon, severity, created_at, why_it_matters, context_summary "
                        f"FROM surge_events WHERE created_at >= ? AND created_at < ? AND {where}", [a, b, *args]):
        items.append({"ref": f"surge:{r['surge_id']}", "kind": "surge", "source": "Parallax news surge", "detector": "surge",
                      "title": r["headline"] or "", "detail": r["why_it_matters"] or r["context_summary"] or "", "severity": r["severity"],
                      "lat": r["lat"], "lon": r["lon"], "when": r["created_at"], "place": r["location_name"] or ""})

    items += read_gdelt(start, end, boxes, isos or [], counts)

    dwhere, dargs = _bbox_sql("centroid_lat", "centroid_lon", boxes)
    for r in q("imagery", f"SELECT detection_id, scan_id, zone_id, instrument, object_type, confidence, centroid_lat, centroid_lon, "
                          f"geo_geometry, area_m2, severity, alert_tier, attributes, nearest_port, nearest_infrastructure, created_at "
                          f"FROM sentinel_detections WHERE created_at >= ? AND created_at < ? AND {dwhere} "
                          f"AND COALESCE(reviewed_status, '') NOT IN ('rejected', 'false_positive')", [a, b, *dargs]):
        attrs = _j(r["attributes"], {}) or {}
        what = r["object_type"].replace("_", " ")
        if attrs.get("vessel_length_m"):
            what += f", about {attrs['vessel_length_m']:.0f} m"
        items.append({"ref": f"imagery:{r['detection_id']}", "kind": "imagery", "source": f"Parallax imagery ({r['instrument'] or 'Sentinel'})",
                      "detector": r["object_type"], "title": f"{what} detected" + (f" near {r['nearest_port']}" if r["nearest_port"] else ""),
                      "detail": f"confidence {r['confidence']:.2f}" + (f", change: {attrs['change_type']}" if attrs.get("change_type") else ""),
                      "severity": r["severity"] or "info", "lat": r["centroid_lat"], "lon": r["centroid_lon"], "when": r["created_at"],
                      "place": r["nearest_infrastructure"] or r["nearest_port"] or "", "scan_id": r["scan_id"], "zone_id": r["zone_id"],
                      "geometry": _j(r["geo_geometry"]), "confidence": r["confidence"]})
    return [i for i in items if i.get("lat") is not None and i.get("lon") is not None]


def read_gdelt(start: _dt.datetime, end: _dt.datetime, boxes, isos: list[str], counts: Counter) -> list[dict]:
    """GDELT stories the judge read (gdelt_judge): one item per article, at
    the place the judge named. Unjudged stories are left out, as on the map.
    The cache holds the last days only — older periods rest on the research."""
    try:
        from paths import data_path
        ev = json.loads(Path(data_path("gdelt_events_cache.json")).read_text()).get("events") or []
        judged = json.loads(Path(data_path("gdelt_judgements.json")).read_text())
    except Exception as e:                                  # noqa: BLE001
        print(f"[briefing/collect] gdelt skipped: {e}")
        return []
    a, b = start.strftime("%Y%m%d"), end.strftime("%Y%m%d")
    out, seen = [], set()
    for e in ev:
        url = e.get("source_url")
        j = judged.get(url or "")
        if not j or url in seen or not (a <= str(e.get("date") or "") <= b):
            continue
        if not j.get("keep"):
            continue                                         # the judge's verdict, as on the map
        lat, lon = e.get("lat"), e.get("lon")
        if lat is None or lon is None:
            continue
        inside = any(w <= lon <= ea and s <= lat <= n for w, s, ea, n in boxes) or (e.get("country_code") in isos)
        if not inside:
            continue
        where = j.get("where")
        try:
            import gdelt_judge
            if where and not gdelt_judge.place_matches(where, e.get("location_name") or e.get("location") or ""):
                continue                                     # the coder's other cities: the story did not happen there
        except Exception:                                    # noqa: BLE001
            pass
        seen.add(url)
        counts["gdelt"] += 1
        d = str(e.get("date"))
        out.append({"ref": f"gdelt:{e.get('id')}", "kind": "news", "source": re.sub(r"^www\.", "", url.split("/")[2]) if "//" in url else "GDELT",
                    "detector": j.get("category") or "news", "title": j.get("headline") or e.get("headline") or "",
                    "detail": f"{j.get('act') or ''} by {j.get('actor') or 'unknown'}; {j.get('casualties') or 0} casualties reported",
                    "severity": "high" if j.get("force") and (j.get("casualties") or 0) > 0 else "medium",
                    "lat": lat, "lon": lon, "when": f"{d[:4]}-{d[4:6]}-{d[6:8]} 12:00:00", "place": where or e.get("location_name") or "",
                    "url": url, "interested": bool(INTERESTED.search(url)), "mentions": e.get("mentions")})
    return out


# ── reach: which vector, if any, an item is for ─────────────────────────────

def _targets_for(kind: str | None):
    try:
        from routers.my_assets import TARGET_WORDS, KIND_TARGETS
    except Exception:                                        # noqa: BLE001
        return None
    groups = KIND_TARGETS.get(kind or "")
    if not groups:
        return None
    return re.compile(r"\b(" + "|".join(TARGET_WORDS[g] for g in groups) + r")", re.I)


PRECEDENT_ACTS = {"sabotage", "kinetic", "fire", "unrest"}


def reach(item: dict, profile: dict, sites_by_id: dict, targets: dict) -> dict | None:
    """The best match of an item to the profile's vectors, or None."""
    import owned_assets as oa
    cat = item["category"]
    text = f"{item.get('title') or ''} {item.get('detail') or ''}"
    best = None
    for v in profile.get("vectors") or []:
        cats = set(v.get("categories") or [])
        if cat not in cats and cat != "other":
            continue
        cand = None
        for sid in v.get("sites") or []:
            s = sites_by_id.get(sid)
            if not s or s.get("lat") is None:
                continue
            if not oa.reaches(s.get("kind"), cat):
                continue
            r = float(s.get("radius_km") or 25)
            d = km(s["lat"], s["lon"], item["lat"], item["lon"])
            imp = {"critical": 1.2, "high": 1.0}.get(s.get("importance"), 0.85)
            if d <= r:
                city = item["kind"] in CITY_LEVEL or item.get("city_level")
                w = (PLACE_W["city"] if city else PLACE_W["site"] * (0.4 + 0.6 * (1 - d / r))) * imp
                if not cand or w > cand["w"]:
                    cand = {"how": "city" if city else "site", "w": w, "site": s["id"], "site_name": s["name"], "km": round(d, 1)}
            elif (cat in PRECEDENT_ACTS and s.get("country") and item.get("country") == s["country"]
                  and targets.get(s["id"]) is not None and targets[s["id"]].search(text)):
                w = PLACE_W["precedent"] * imp
                if not cand or w > cand["w"]:
                    cand = {"how": "precedent", "w": w, "site": s["id"], "site_name": s["name"], "km": round(d, 1)}
        if not cand and item.get("country") and item["country"] in (v.get("countries") or []):
            cand = {"how": "country", "w": PLACE_W["country"] * (0.6 if cat == "other" else 1.0)}
        if not cand and v.get("keywords"):
            kw = [k for k in v["keywords"] if re.search(r"\b" + re.escape(k), text, re.I)]
            if kw:
                cand = {"how": "keyword", "w": PLACE_W["keyword"], "keywords": kw}
        if cand and cat == "other" and cand["how"] == "site":
            cand["w"] *= 0.6
        if cand and (not best or cand["w"] > best["w"]):
            best = {**cand, "vector": v["id"], "vector_name": v["name"]}
    return best


# ── merge reports of the same event ──────────────────────────────────────────

def _norm(title: str) -> str:
    t = re.sub(r"[\d.,%()°]+", "#", (title or "").lower())
    return re.sub(r"\s+", " ", t).strip()[:90]


def _day(when) -> str:
    return str(when or "")[:10]


def merge(items: list[dict]) -> list[dict]:
    """Reports of one event become one event; every source is kept."""
    events: list[dict] = []
    index: dict[tuple, list[int]] = defaultdict(list)
    for it in sorted(items, key=lambda x: -x["score0"]):
        key = (it["category"], _day(it["when"]))
        hit = None
        for ix in index[key]:
            e = events[ix]
            d = km(e["lat"], e["lon"], it["lat"], it["lon"])
            if d <= MERGE_KM or (d <= 150 and _norm(e["title"]) == _norm(it["title"])):
                hit = e
                break
        if hit is None:
            ev = {**it, "reports": [it], "families": {FAMILY.get(it["kind"], it["kind"])}, "sources": [it["source"]]}
            index[key].append(len(events))
            events.append(ev)
        else:
            hit["reports"].append(it)
            hit["families"].add(FAMILY.get(it["kind"], it["kind"]))
            if it["source"] not in hit["sources"]:
                hit["sources"].append(it["source"])
            if not hit.get("url") and it.get("url"):
                hit["url"] = it["url"]
            if not hit.get("place") and it.get("place"):
                hit["place"] = it["place"]
    # the same event on several days (a fire burning at the same port) is one event that recurred
    folded: list[dict] = []
    for e in sorted(events, key=lambda x: -x["score0"]):
        twin = next((f for f in folded if f["vector"] == e["vector"] and f["category"] == e["category"]
                     and _norm(f["title"]) == _norm(e["title"]) and km(f["lat"], f["lon"], e["lat"], e["lon"]) <= MERGE_KM), None)
        if twin is None:
            e["days"] = {_day(e["when"])}
            folded.append(e)
            continue
        twin["reports"] += e["reports"]
        twin["families"] |= e["families"]
        twin["days"].add(_day(e["when"]))
        twin["sources"] += [x for x in e["sources"] if x not in twin["sources"]]
    events = folded
    for e in events:
        if len(e["days"]) > 1:
            e["recurring"] = sorted(e["days"])
        e["corroboration"] = len(e["families"])
        e["interested_only"] = all(r.get("interested") for r in e["reports"])
        e["score"] = round(e["score0"] * (1 + 0.35 * math.log2(e["corroboration"])) * (1 + 0.1 * math.log2(len(e["reports"]))), 4)
    return events


def patterns(items: list[dict], start: _dt.datetime, days: int) -> list[dict]:
    """One event per vector and detector: how often, how many days, the peak."""
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for it in items:
        groups[(it["vector"], it["detector"])].append(it)
    out = []
    for (vec, det), its in groups.items():
        peak = max(its, key=lambda x: (x["score0"], str(x["when"])))
        by_day = Counter(_day(i["when"]) for i in its)
        places = Counter((i.get("place") or i.get("country") or "").strip() for i in its)
        places.pop("", None)
        active = len(by_day)
        ev = {**peak, "pattern": True, "reports": its, "families": {FAMILY.get(peak["kind"], peak["kind"])}, "sources": [peak["source"]],
              "title": peak["title"], "days_active": active, "per_day": dict(sorted(by_day.items())),
              "places": [p for p, _ in places.most_common(6)], "first": min(str(i["when"]) for i in its), "last": max(str(i["when"]) for i in its)}
        ev["score0"] = peak["score0"] * (0.6 + 0.4 * active / max(1, days)) * (1 + 0.15 * math.log2(len(its)))
        out.append(ev)
    for e in out:
        e["corroboration"] = 1
        e["interested_only"] = False
        e["score"] = round(e["score0"], 4)
    return out


# ── select: stratified by day and by vector ─────────────────────────────────

def select(events: list[dict], take: int, days: int) -> list[dict]:
    if len(events) <= take:
        return sorted(events, key=lambda e: -e["score"])
    per_day = max(3, math.ceil(take / max(1, days) * 2.5))
    vectors = Counter(e["vector"] for e in events)
    floor = {v: min(n, max(2, take // (len(vectors) * 4))) for v, n in vectors.items()}
    chosen, used_day, used_vec = [], Counter(), Counter()
    ranked = sorted(events, key=lambda e: -e["score"])
    # first: each vector its floor, so a quiet vector still appears
    for e in ranked:
        if used_vec[e["vector"]] < floor[e["vector"]]:
            chosen.append(e); used_vec[e["vector"]] += 1; used_day[_day(e["when"])] += 1
    picked = {id(e) for e in chosen}
    for e in ranked:
        if len(chosen) >= take:
            break
        if id(e) in picked or used_day[_day(e["when"])] >= per_day:
            continue
        chosen.append(e); used_vec[e["vector"]] += 1; used_day[_day(e["when"])] += 1
    for e in ranked:                                         # a busy period: fill what the day caps left
        if len(chosen) >= take:
            break
        if id(e) not in {id(c) for c in chosen}:
            chosen.append(e)
    return sorted(chosen, key=lambda e: -e["score"])


# ── imagery crops ─────────────────────────────────────────────────────────────

def crop(con, item: dict, size: int = 420) -> str | None:
    """A PNG data URI of the scene around a detection, the detection boxed."""
    try:
        from PIL import Image, ImageDraw
        s = con.execute("SELECT image_b64, zone_id FROM sentinel_scans WHERE scan_id = ?", (item["scan_id"],)).fetchone()
        if not s or not s["image_b64"]:
            return None
        z = con.execute("SELECT bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat FROM watch_zones WHERE id = ?",
                        (s["zone_id"] or item.get("zone_id"),)).fetchone()
        if not z:
            return None
        w, so, e, n = (float(x) for x in z)
        raw = s["image_b64"].split(",", 1)[-1]
        img = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
        W, H = img.size

        def px(lon, lat):
            return (lon - w) / (e - w) * W, (n - lat) / (n - so) * H

        g = item.get("geometry") or {}
        ring = (g.get("coordinates") or [[]])[0] if g.get("type") == "Polygon" else []
        pts = [px(c[0], c[1]) for c in ring] or [px(item["lon"], item["lat"])]
        x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
        y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if not (0 <= cx < W and 0 <= cy < H):
            return None
        half = max(110, (x1 - x0) * 4, (y1 - y0) * 4)       # enough of the scene to read it
        box = (int(max(0, cx - half)), int(max(0, cy - half)), int(min(W, cx + half)), int(min(H, cy + half)))
        tile = img.crop(box)
        scale = size / max(tile.size)
        tile = tile.resize((max(1, int(tile.size[0] * scale)), max(1, int(tile.size[1] * scale))), Image.LANCZOS)
        d = ImageDraw.Draw(tile)
        bx = [((x - box[0]) * scale, (y - box[1]) * scale) for x, y in ((x0, y0), (x1, y1))]
        pad = 6
        d.rectangle([bx[0][0] - pad, bx[0][1] - pad, bx[1][0] + pad, bx[1][1] + pad], outline=(184, 137, 47), width=2)
        buf = io.BytesIO()
        tile.save(buf, format="PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception as ex:                                  # noqa: BLE001
        print(f"[briefing/collect] crop {item.get('ref')} failed: {ex}")
        return None


# ── the whole pass ───────────────────────────────────────────────────────────

def period_for(cadence: str, end: _dt.datetime | None = None) -> tuple[_dt.datetime, _dt.datetime]:
    end = end or _dt.datetime.now(_dt.timezone.utc)
    return end - _dt.timedelta(days=spec.PERIOD_DAYS[cadence]), end


def collect(profile: dict, cadence: str, start: _dt.datetime | None = None, end: _dt.datetime | None = None,
            db_path: str | None = None, take: int | None = None) -> dict:
    """The evidence for one issue. See the module docstring."""
    import owned_assets as oa
    if start is None or end is None:
        start, end = period_for(cadence, end)
    days = max(1, round((end - start).total_seconds() / 86400))
    con = sqlite3.connect(db_path or _db_path(), timeout=60)
    con.row_factory = sqlite3.Row
    counts: Counter = Counter()
    try:
        boxes = _bboxes(profile)
        names = set(profile.get("countries") or []) | {c for v in profile.get("vectors") or [] for c in v.get("countries") or []}
        isos = [x for x in (iso2(n) for n in names) if x]
        items = read_items(con, start, end, boxes, counts, isos) if boxes else []
        sites_by_id = {s["id"]: s for s in profile.get("sites") or []}
        targets = {sid: _targets_for(s.get("kind")) for sid, s in sites_by_id.items()}
        kept, by_cat_reached = [], Counter()
        for it in items:
            it["country"] = country_at(float(it["lat"]), float(it["lon"]))
            it["category"] = oa.category({"kind": {"telegram": "footage", "geoconfirmed": "verified footage", "news": "news",
                                                   "imagery": "imagery"}.get(it["kind"], it["kind"]),
                                          "title": f"{str(it.get('detector') or '').replace('_', ' ')} {it['title']} {' '.join(it.get('keys') or [])}",
                                          "source": it["source"]})
            if it["kind"] in ("news", "geoconfirmed", "telegram") and it["category"] in ("other", "kinetic") and not ACT.search(f"{it['title']} {it.get('detail') or ''}"):
                continue                                     # "kinetic" by the source's default, with no act named
            m = reach(it, profile, sites_by_id, targets)
            if not m:
                continue
            by_cat_reached[it["category"]] += 1
            sev = oa.SEV_W.get(str(it.get("severity") or "").lower(), 0.25 if it["kind"] == "imagery" else 0.3)
            it.update({"match": m, "vector": m["vector"], "score0": sev * m["w"]})
            kept.append(it)
        discrete = [i for i in kept if i.get("detector") not in PATTERNS]
        events = merge(discrete) + patterns([i for i in kept if i.get("detector") in PATTERNS], start, days)
        chosen = select(events, take or TAKE[cadence], days)
        # numbered in time order: S-01 is the earliest, as a chronology reads
        chosen.sort(key=lambda e: str(e["when"]))
        for i, e in enumerate(chosen, 1):
            e["sid"] = f"S-{i:02d}" if len(chosen) < 100 else f"S-{i:03d}"
        crops_left = CROPS[cadence]
        for e in sorted((e for e in chosen if e["kind"] == "imagery"), key=lambda x: -x["score"]):
            if crops_left <= 0:
                break
            uri = crop(con, e)
            if uri:
                e["image"] = uri
                crops_left -= 1
    finally:
        con.close()
    funnel = {"read": sum(counts.values()), "read_by_store": dict(counts), "reached": len(kept),
              "events": len(events), "corroborated": sum(1 for e in events if e["corroboration"] >= 2), "used": len(chosen)}
    return {
        "cadence": cadence, "start": start.isoformat(), "end": end.isoformat(), "days": days,
        "events": [public(e) for e in chosen],
        "funnel": funnel,
        "by_vector": dict(Counter(e["vector"] for e in chosen)),
        "by_category": dict(Counter(e["category"] for e in chosen)),
        "reached_by_category": dict(by_cat_reached),
        "series": series(kept, start, days),
    }


def public(e: dict) -> dict:
    """An event as the writer and the reader see it."""
    m = e["match"]
    place = e.get("place") or ""
    if not place:
        place = (f"{m['km']} km from {m['site_name']}" if m.get("site_name") and m["how"] == "site" else e.get("country") or "")
    out = {"sid": e["sid"], "ref": e["ref"], "kind": e["kind"], "when": str(e["when"]), "title": e["title"], "detail": (e.get("detail") or "")[:700],
           "place": place, "country": e.get("country"), "lat": round(float(e["lat"]), 4), "lon": round(float(e["lon"]), 4),
           "category": e["category"], "severity": e.get("severity"), "vector": e["vector"], "vector_name": m["vector_name"],
           "reach": m["how"], "site": m.get("site_name"), "km": m.get("km"), "sources": e["sources"][:8], "reports": len(e["reports"]),
           "corroboration": e["corroboration"], "interested_only": e["interested_only"], "url": e.get("url"),
           "score": e["score"], "detector": e.get("detector")}
    if e.get("recurring"):
        out["recurring"] = e["recurring"]
    if e.get("pattern"):
        out.update({"pattern": True, "days_active": e["days_active"], "per_day": e["per_day"], "places": e["places"],
                    "first": e["first"], "last": e["last"]})
    if e.get("image"):
        out["image"] = e["image"]
    if e.get("media"):
        out["media"] = e["media"]
    return out


def series(items: list[dict], start: _dt.datetime, days: int) -> dict:
    """Reached signals per day and category, for the period's chart."""
    labels = [(start + _dt.timedelta(days=i)).date().isoformat() for i in range(days + 1)]
    out: dict[str, list[int]] = {}
    for it in items:
        d = _day(it["when"])
        if d in labels:
            out.setdefault(it["category"], [0] * len(labels))[labels.index(d)] += 1
    return {"days": labels, "counts": out}
