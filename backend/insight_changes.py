"""
insight_changes.py — what changed: this window against the one before it.

The owner (2026-10-06): Insight's "what changed" listed the top signals and
did not answer the question. A change is a difference between two equal
windows, so that is what this computes — per country, per kind of evidence:

    verified     GeoConfirmed placemarks (someone found the place in the video)
    ground       published Telegram footage (located, screened)
    claims       a party's own official statements
    military     military aircraft seen (ADS-B alerts)
    jamming      GPS interference cells
    heat         new heat at places that matter (heat_watch)
    fusions      several kinds of evidence agreeing at one place

…and, around them: places with activity now and none before ("lit up"),
ground that changed hands (the war maps' revision history), and countries
that went quiet. AIS dark-ship alerts are left out: 35,000 a week is the
background, not a change.

WHAT IS COMPARED IS THE WORLD, NOT OUR COLLECTION. Measured 2026-10-06: the
backend collected nothing 30 Sep–2 Oct, the GPS detector began writing ~20k
rows a day on 4 Oct, Telegram started on 3 Oct, and GeoConfirmed publishes
days after the event. Raw counts would report every one of those as an
escalation. So:
  - each kind is counted per day (hour, for 24 h) it was actually being
    collected, and a kind not collected in both windows is not compared
    ("no baseline yet") rather than shown as a surge;
  - jamming counts distinct cells a day, military flights distinct aircraft
    a day — not the detector's rows;
  - for the instruments (jamming, military flights, fusions, heat) a
    country is compared by its SHARE of the worldwide total: the GPS detector
    was widened on 4 Oct and saw more everywhere at once, which is a change
    in us; one country's share rising is a change in the world;
  - GeoConfirmed's windows end two days ago, for its reporting lag.

The sentences are assembled here from the numbers, not by a model, so every
figure on the page can be checked against its rows.
"""
from __future__ import annotations

import datetime as _dt
import math
import re
import os
import sqlite3
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
RANGES = {"24h": 24, "7d": 168, "30d": 720}
INSTRUMENTS = {"military", "jamming", "heat", "fusions"}
INDICATORS = {
    "verified": "verified events", "ground": "reports from the ground", "claims": "official claims",
    "military": "military flights", "jamming": "GPS jamming", "heat": "new heat", "fusions": "fusions",
}
ALERT_KIND = {"military_aircraft": "military", "gps_interference": "jamming", "Heat": "heat", "Multi-source agreement": "fusions"}


def _db_path() -> str:
    try:
        from main import DATA_DIR
        return os.path.join(DATA_DIR, "akili.db")
    except Exception:                                         # noqa: BLE001
        return os.path.join(HERE, "data", "akili.db")


_NAME: dict = {}


def _country_name(code: str | None) -> str | None:
    if not code:
        return None
    if code in _NAME:
        return _NAME[code]
    _NAME[code] = _country_name_uncached(code)
    return _NAME[code]


def _country_name_uncached(code: str | None) -> str | None:
    try:
        from location_extract import country_name_from_code
        return country_name_from_code(code) or code
    except Exception:                                         # noqa: BLE001
        return code


_COUNTRY_CELL: dict = {}


def _country_at(lat, lon) -> str | None:
    """The country at a point, cached per quarter-degree cell: tens of
    thousands of rows cost a few hundred polygon tests, not one each."""
    if lat is None or lon is None:
        return None
    key = (round(float(lat) * 4), round(float(lon) * 4))
    if key not in _COUNTRY_CELL:
        try:
            from geo_land import country_at
            _COUNTRY_CELL[key] = country_at(lat, lon)
        except Exception:                                     # noqa: BLE001
            _COUNTRY_CELL[key] = None
    return _COUNTRY_CELL[key]


def _bucket(when, hourly: bool) -> str:
    w = str(when or "").replace("T", " ")
    return w[:13] if hourly else w[:10]


def events(since: _dt.datetime, until: _dt.datetime, hourly: bool = False) -> list[dict]:
    """Every counted item in [since, until): {kind, country, title, when, lat, lon, source, bucket, key}.
    `key` identifies the thing counted (a jammed cell a day, an aircraft a day, else the item)."""
    s, u = since.strftime("%Y-%m-%d %H:%M:%S"), until.strftime("%Y-%m-%d %H:%M:%S")
    lag = _dt.timedelta(days=2)
    gs, gu = (since - lag).strftime("%Y-%m-%d"), (until - lag).strftime("%Y-%m-%d")
    out: list[dict] = []
    con = sqlite3.connect(_db_path(), timeout=30)
    con.row_factory = sqlite3.Row
    try:
        for r in con.execute("SELECT id, name, description, date, latitude, longitude FROM geoconfirmed_placemarks WHERE date >= ? AND date < ?", (gs, gu)):
            if r["latitude"] is None:
                continue
            # some placemarks are named only by their date; the description says what it shows
            name = (r["name"] or "").strip()
            if not name or re.fullmatch(r"[\d\s/.-]*[A-Z]{3}[\s\d/.-]*", name) or len(name) < 6:
                desc = re.sub(r"<[^>]+>", " ", r["description"] or "")
                desc = re.sub(r"https?://\S+", "", desc)
                name = re.sub(r"\s+", " ", desc).strip()[:140] or name
            out.append({"kind": "verified", "country": _country_at(r["latitude"], r["longitude"]), "title": name,
                        "when": r["date"], "lat": r["latitude"], "lon": r["longitude"], "source": "GeoConfirmed", "key": f"gc{r['id']}"})
        for r in con.execute("SELECT channel, msg_id, headline, posted_at, lat, lon, country_code, role, claim, place, event_type, party "
                             "FROM telegram_posts WHERE posted_at >= ? AND posted_at < ? AND headline IS NOT NULL",
                             (since.isoformat(), until.isoformat())):
            official_claim = r["role"] == "official" and r["claim"] == 1
            if not official_claim and r["lat"] is None:
                continue
            out.append({"kind": "claims" if official_claim else "ground",
                        "country": _country_name(r["country_code"]) or (_country_at(r["lat"], r["lon"]) if r["lat"] is not None else None),
                        "title": r["headline"], "when": r["posted_at"], "lat": r["lat"], "lon": r["lon"],
                        "source": (r["party"] if official_claim else None) or r["channel"], "type": r["event_type"], "place": r["place"],
                        "key": f"tg{r['channel']}{r['msg_id']}"})
        for r in con.execute("SELECT alert_type, title, created_at, lat, lon, country_code FROM alerts WHERE created_at >= ? AND created_at < ? "
                             "AND alert_type IN ('military_aircraft','gps_interference','Heat','Multi-source agreement')", (s, u)):
            kind = ALERT_KIND[r["alert_type"]]
            day = _bucket(r["created_at"], hourly)
            if kind == "jamming":
                key = f"j{day}{round(r['lat'] or 0)}:{round(r['lon'] or 0)}"
            elif kind == "military":
                m = re.search(r"aircraft\s+([A-Z0-9]{3,8})", r["title"] or "")
                key = f"m{day}{m.group(1) if m else r['title']}"
            else:
                key = f"a{r['created_at']}{r['title']}"
            out.append({"kind": kind,
                        "country": _country_name(r["country_code"]) or (_country_at(r["lat"], r["lon"]) if r["lat"] is not None else None),
                        "title": r["title"], "when": r["created_at"], "lat": r["lat"], "lon": r["lon"], "source": r["alert_type"], "key": key})
    finally:
        con.close()
    for e in out:
        e["bucket"] = _bucket(e["when"], hourly)
    return [e for e in out if e.get("country")]


def _score(cur: int, prev: int) -> float:
    return abs(math.log((cur + 1) / (prev + 1))) * math.sqrt(cur + prev)


def coverage(items: list[dict]) -> dict:
    """Per kind: the buckets (days or hours) in which it was collected at all."""
    cov = defaultdict(set)
    for e in items:
        cov[e["kind"]].add(e["bucket"])
    return {k: len(v) for k, v in cov.items()}


def compare(cur: list[dict], prev: list[dict], *, min_count: int = 3) -> dict:
    """Pure: the two windows' items -> countries that escalated, calmed, places that lit up.
    Counts are distinct things, compared per bucket of actual collection."""
    cov_c, cov_p = coverage(cur), coverage(prev)
    comparable = {k for k in INDICATORS if cov_c.get(k) and cov_p.get(k)}
    cc, pc = defaultdict(set), defaultdict(set)
    by_country_items = defaultdict(list)
    for e in cur:
        cc[(e["country"], e["kind"])].add(e.get("key") or id(e))
        by_country_items[e["country"]].append(e)
    for e in prev:
        pc[(e["country"], e["kind"])].add(e.get("key") or id(e))
    tot_c, tot_p = Counter(), Counter()
    for (country, kind), keys in cc.items():
        tot_c[kind] += len(keys)
    for (country, kind), keys in pc.items():
        tot_p[kind] += len(keys)
    countries = defaultdict(list)
    for key in set(cc) | set(pc):
        country, kind = key
        if kind not in comparable:
            continue
        c = len(cc.get(key, ()))
        if kind in INSTRUMENTS:
            # the previous window scaled to this window's worldwide total
            p = round(len(pc.get(key, ())) * tot_c[kind] / tot_p[kind], 1) if tot_p.get(kind) else 0
        else:
            # the previous window scaled to the same amount of collection
            p = round(len(pc.get(key, ())) * cov_c[kind] / cov_p[kind], 1)
        if max(c, p) < min_count:
            continue
        # Jamming is the weakest change signal: the detector's reach keeps
        # changing. It needs an established baseline and never reads as "new".
        if kind == "jamming" and p < 10:
            continue
        ratio = (c + 1) / (p + 1)
        if c >= min_count and p == 0:
            direction = "new"
        elif ratio >= 1.6:
            direction = "up"
        elif p >= min_count + 1 and c <= p * 0.45:
            direction = "down"
        else:
            continue
        weight = 0.35 if kind == "jamming" else 1.0
        countries[country].append({"key": kind, "label": INDICATORS[kind], "cur": c, "prev": p,
                                   "ratio": round(c / p, 1) if p else None, "dir": direction, "score": round(_score(c, p) * weight, 2)})
    up, down = [], []
    for country, inds in countries.items():
        inds.sort(key=lambda x: -x["score"])
        rising = [i for i in inds if i["dir"] in ("up", "new")]
        falling = [i for i in inds if i["dir"] == "down"]
        # what drove it: the newest strong examples of the rising kinds
        kinds = {i["key"] for i in rising}
        ex = [e for e in by_country_items.get(country, []) if e["kind"] in kinds and e["kind"] not in ("jamming",)]
        ex.sort(key=lambda e: str(e.get("when") or ""), reverse=True)
        seen, examples = set(), []
        for e in ex:
            t = (e.get("title") or "").strip()
            if t and t.lower() not in seen:
                seen.add(t.lower()); examples.append({k: e.get(k) for k in ("title", "when", "lat", "lon", "source", "kind")})
            if len(examples) >= 4:
                break
        types = Counter(e.get("type") for e in ex if e.get("type"))
        if rising:
            up.append({"country": country, "indicators": rising, "score": round(sum(i["score"] for i in rising), 2),
                       "examples": examples, "driven_by": [t for t, _ in types.most_common(2)]})
        if falling and not rising:
            down.append({"country": country, "indicators": falling, "score": round(sum(i["score"] for i in falling), 2)})
    up.sort(key=lambda x: -x["score"]); down.sort(key=lambda x: -x["score"])
    return {"escalating": up[:12], "calmer": down[:8], "lit_up": lit_up(cur, prev),
            "coverage": {k: {"now": cov_c.get(k, 0), "before": cov_p.get(k, 0), "compared": k in comparable} for k in INDICATORS}}


def lit_up(cur: list[dict], prev: list[dict], cell: float = 0.5, min_count: int = 2) -> list[dict]:
    """Half-degree cells with located verified/ground activity now and none before."""
    key = lambda e: (math.floor(e["lat"] / cell), math.floor(e["lon"] / cell))  # noqa: E731
    keep = ("verified", "ground", "heat", "fusions")
    before = {key(e) for e in prev if e["kind"] in keep and e.get("lat") is not None}
    cells = defaultdict(list)
    for e in cur:
        if e["kind"] in keep and e.get("lat") is not None and key(e) not in before:
            cells[key(e)].append(e)
    out = []
    for items in cells.values():
        if len(items) < min_count:
            continue
        items.sort(key=lambda e: str(e.get("when") or ""), reverse=True)
        place = next((e.get("place") for e in items if e.get("place")), None)
        lat = sum(e["lat"] for e in items) / len(items); lon = sum(e["lon"] for e in items) / len(items)
        out.append({"place": place or items[0]["country"], "country": items[0]["country"], "lat": round(lat, 3), "lon": round(lon, 3),
                    "count": len(items), "examples": [{k: e.get(k) for k in ("title", "when", "source", "kind")} for e in items[:3]]})
    out.sort(key=lambda x: -x["count"])
    return out[:10]


def _fmt_ind(i: dict) -> str:
    if i["dir"] == "new":
        return f"{i['cur']} {i['label']} where there were none"
    if i["dir"] == "down":
        return f"{i['label']} down to {i['cur']} from {i['prev']:g}"
    return f"{i['label']} {i['ratio']}× ({i['cur']}, from {i['prev']:g})"


def headline(result: dict, hours: int) -> list[str]:
    """Up to three sentences, built from the numbers."""
    span = {24: "the last 24 hours", 168: "the last 7 days", 720: "the last 30 days"}.get(hours, f"the last {hours} h")
    out = []
    lead = [c for c in result["escalating"] if any(i["key"] != "jamming" for i in c["indicators"])]
    for c in lead[:2]:
        top = next(i for i in c["indicators"] if i["key"] != "jamming")
        why = f" — {c['examples'][0]['title']}" if c.get("examples") else ""
        out.append(f"{c['country']}: {_fmt_ind(top)} in {span}{why}.")
    if result.get("frontlines"):
        f = result["frontlines"][0]
        more = len(result["frontlines"]) - 1
        out.append(f"{f['title']}{f' (and {more} more changes of control)' if more > 0 else ''}.")
    elif result["lit_up"]:
        h = result["lit_up"][0]
        out.append(f"New activity around {h['place']}: {h['count']} reports where there were none.")
    if not out and result["calmer"]:
        c = result["calmer"][0]
        out.append(f"{c['country']} went quieter: {_fmt_ind(c['indicators'][0])}.")
    return out[:3]


def changes(range_key: str = "7d", now: _dt.datetime | None = None) -> dict:
    hours = RANGES.get(range_key, 168)
    now = now or _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)
    w0, w1 = now - _dt.timedelta(hours=hours), now
    p0 = w0 - _dt.timedelta(hours=hours)
    hourly = hours <= 24
    cur, prev = events(w0, w1, hourly), events(p0, w0, hourly)
    result = compare(cur, prev)
    try:
        import live_notifications as ln
        result["frontlines"] = [{"title": f.get("title"), "sub": f.get("reason") or f.get("sub"), "lat": f.get("lat"), "lon": f.get("lon"),
                                 "when": f.get("published_at") or f.get("created_at")}
                                for f in ln.frontline_items(days=max(1, hours // 24), limit=12)]
    except Exception:                                         # noqa: BLE001
        result["frontlines"] = []
    result["headline"] = headline(result, hours)
    result.update({"range": range_key, "from": w0.isoformat() + "Z", "to": w1.isoformat() + "Z", "previous_from": p0.isoformat() + "Z",
                   "counted": {"now": len(cur), "before": len(prev)}})
    return result
