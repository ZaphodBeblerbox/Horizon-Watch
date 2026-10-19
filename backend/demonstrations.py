"""
demonstrations.py — the map's "Demonstrations, live" layer (owner,
2026-10-17: "Inside the 'Get Me Out' UI we have all the things, for example
the current demonstrations … We want that also to be a layer that we can
toggle onto the actual map. I want to be able to more or less follow in real
time the demonstrations and happenings in a city", and "display the
movements of protesters in more or less real time, depending on what signals
are sent on Telegram and what people are saying").

TWO THINGS, ONE ANSWER (GET /api/routes/demonstrations, routers/routes.py):

CURRENT. Every demonstration and happening the route planner knows about,
anywhere: safe_route.hazards_in_box over the world, through the planner's
own providers (unrest, called gatherings, strikes, roadblocks, and the
unrest/crime alerts) — the same hazards, decayed and deduplicated the same
way, so the map and "Get me out" never disagree. Military kinds (an armed
advance, a withdrawal, violence alerts, GeoConfirmed war footage) are the
front, not a city's streets, and are left to their own layers.

MOVEMENT, RECONSTRUCTED FROM REPORTS. Nobody tracks a crowd; channels say
where it is now and where it is going ("le cortège se dirige vers Bastille",
"protesters marching on Parliament"). link_tracks() chains the located
reports of the last hours into tracks, per city:
  · a report is a Telegram post (or a live development read out of one)
    located to a site, a street or a district — a city-level pin is the
    city's centre and would draw movement that never happened — and saying
    there is a crowd;
  · B follows A when they are in the same city (same name, or within
    CITY_NEAR_M), B comes 0–LINK_WINDOW_H after A, and the crowd could have
    walked it: distance ≤ WALK_KMH × elapsed + HOP_SLACK_M (geocoded
    centroids of streets are a few hundred metres out), never over MAX_HOP_M;
  · and something says it is the same crowd (score ≥ MIN_SCORE): A said it
    was heading to B's place (+3), B names where A was (+2), a march/route
    word in either ("heading to", "moving towards", "marching on", "en
    direction de", "se dirige vers", "in Richtung" …) (+1). French, German,
    Spanish are matched on the original text (accents folded); every post
    also has the model's English rendering (summary_en), which is matched too;
  · a report within SAME_PLACE_M of the track's head is the crowd still
    there: it joins that point and moves its "last reported" time on.
Each report joins the best-scoring open track or starts its own; a track is
drawn once it has two places. Every segment carries the posts that put the
crowd at its two ends, and why they were linked — a reader can always check.
Pure functions here (link_tracks, link_score, destinations); the reads at
the bottom. Blocking (SQLite): call from a thread.
"""
from __future__ import annotations

import datetime as _dt
import math
import re
import sqlite3
import time
import unicodedata

LOOKBACK_H = 6               # how far back reports are read for movement
LINK_WINDOW_H = 3            # B can follow A at most this long after it
WALK_KMH = 6.0               # a brisk march; a crowd running from a charge does not keep it up
HOP_SLACK_M = 1500           # geocoded street / district centroids are a few hundred metres out, each end
MAX_HOP_M = 8000             # never a hop longer than this, however long the gap
SAME_PLACE_M = 150           # closer than this to the head: the crowd is still there
CITY_NEAR_M = 3000           # two places this close are one city whatever their names
MIN_SCORE = 1
PRECISE = {"site", "street", "district"}
CROWD_SITUATIONS = {"kettle", "charge", "tear_gas", "water_cannon", "clashes", "evacuation", "other"}
MILITARY_KINDS = {"advance", "withdrawal", "kinetic", "verified"}
DEMO_PROVIDERS = ["unrest", "endangered_calls", "strikes", "roadblocks", "violence"]
RECONSTRUCTED = "Reconstructed from Telegram reports — not tracked"

# ── words ───────────────────────────────────────────────────────────────────


def fold(text: str | None) -> str:
    """Lower case, accents dropped: "Le cortège se dirige vers la République"
    → "le cortege se dirige vers la republique"."""
    t = unicodedata.normalize("NFKD", str(text or ""))
    return "".join(c for c in t if not unicodedata.combining(c)).lower().replace("’", "'")


_STOP = {"the", "de", "la", "le", "les", "du", "des", "rue", "place", "boulevard", "avenue", "street", "square",
         "city", "and", "of", "in", "et", "vers", "towards", "toward", "pont", "quai", "platz", "strasse", "road"}


def words(place: str | None) -> set[str]:
    """The distinctive words of a place name (4+ letters, folded)."""
    return {w for w in re.findall(r"[\w'-]{4,}", fold(place)) if w not in _STOP}


def place_words(place: str | None) -> set[str]:
    """The distinctive words of a place's first part — "Place de la
    Bastille, Paris, France" → {"bastille"}: the city and country are shared
    by every report in a city and say nothing about where the crowd is."""
    return words(str(place or "").split(",")[0])


# A destination: "heading to X", "marching on X", "se dirige vers X", "in Richtung X" …
_DEST = re.compile(
    r"\b(?:heading|headed|moving|marching|march(?:es|ed)?|walking|proceeding|advancing|converging|streaming|"
    r"making (?:its|their) way|on (?:its|their) way|set(?:ting)? off)\s+(?:to(?:wards?)?|toward|for|on|onto|"
    r"in the direction of)\s+(?P<en>[^.,;:!?\n()]{3,60})"
    r"|\b(?:en direction (?:de la |de l'|du |des |de |d')?|se dirig\w* vers |part\w* vers |vers (?:la |le |les |l')?|"
    r"en route vers |rejoin\w* (?:la |le |les |l')?|remont\w* (?:vers )?|descend\w* (?:vers )?)(?P<fr>[^.,;:!?\n()]{3,60})"
    r"|\b(?:in richtung|richtung|zieh\w* (?:zum|zur|nach|in richtung)|auf dem weg (?:zum|zur|nach))\s+(?P<de>[^.,;:!?\n()]{3,60})"
    r"|\b(?:hacia|rumbo a|se dirig\w* (?:a|hacia))\s+(?P<es>[^.,;:!?\n()]{3,60})")

# A crowd on the move, with or without a destination.
_MOVE = re.compile(
    r"\b(march\w*|marche\w*|cortege\w*|procession\w*|defile\w*|parade|moving|heading|headed|advancing|converg\w*|"
    r"se dirig\w*|en direction|on the move|en route|set off|demozug|demonstrationszug|zieh\w*|in richtung|"
    r"manifestacion|marcha)\b|مسير|צועד|צעדה|шеств")

# A crowd at all — anything else (an arrest, an air-raid alert) is not a demonstration.
_CROWD = re.compile(
    r"\b(protest\w*|demonstrat\w*|riot\w*|rall(y|ies)|march\w*|crowd\w*|manif\w*|cortege\w*|rassemblement\w*|"
    r"foule\w*|marcheurs|emeute\w*|nasse|kettl\w*|tear ?gas|lacrymo\w*|water cannon|kundgebung\w*|demonstrant\w*|"
    r"demo|krawall\w*|manifestacion\w*|marcha|sit-in|blockade\w*|blocage\w*|occupation)\b|مظاهر|مسير|הפגנ|מפגינ|"
    r"протест|митинг|шеств")


def destinations(text: str | None) -> list[str]:
    """Where the text says the crowd is going (folded), in order."""
    out = []
    for m in _DEST.finditer(fold(text)):
        d = next((g for g in m.groups() if g), "").strip()
        d = re.sub(r"^(?:the|la|le|les|l'|el|der|die|das|den|dem)\s*", "", d).strip()
        if d:
            out.append(d)
    return out


def is_crowd(text: str | None) -> bool:
    return bool(_CROWD.search(fold(text)))


def moves(text: str | None) -> bool:
    return bool(_MOVE.search(fold(text)))


# ── geometry ────────────────────────────────────────────────────────────────

def metres(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2)
    return 12_742_000.0 * math.asin(min(1.0, math.sqrt(h)))


def bearing(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lon - a_lon)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _utc(v) -> _dt.datetime | None:
    if v in (None, ""):
        return None
    if isinstance(v, _dt.datetime):
        return v if v.tzinfo else v.replace(tzinfo=_dt.timezone.utc)
    try:
        t = _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00").replace(" ", "T"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)


def city_of(place: str | None) -> str:
    """"Boulevard Saint-Germain, Paris, France" → "paris"; "Paris, France" → "paris"."""
    parts = [p.strip() for p in str(place or "").split(",") if p.strip()]
    if not parts:
        return ""
    return fold(parts[1] if len(parts) >= 3 else parts[0])


# ── linking ─────────────────────────────────────────────────────────────────

def link_score(a: dict, b: dict) -> tuple[int, list[str]] | None:
    """Can report B follow the node A (its place, its time, its reports)?
    None when it cannot (another city, too long after, too far to walk);
    else (score, why). A node: {lat, lon, at, place, city, country, text}."""
    ta, tb = _utc(a["at"]), _utc(b["at"])
    if not ta or not tb:
        return None
    dt_h = (tb - ta).total_seconds() / 3600
    if dt_h < 0 or dt_h > LINK_WINDOW_H:
        return None
    d = metres(a["lat"], a["lon"], b["lat"], b["lon"])
    if a.get("country") and b.get("country") and a["country"] != b["country"]:
        return None
    if not (a.get("city") and a.get("city") == b.get("city")) and d > CITY_NEAR_M:
        return None
    if d > min(MAX_HOP_M, WALK_KMH * 1000 * dt_h + HOP_SLACK_M):
        return None
    score, why = 0, []
    bw = place_words(b.get("place"))
    for dest in destinations(a.get("text")):
        if words(dest) & bw:
            score += 3
            why.append(f"said it was heading to {b.get('place', '').split(',')[0]}")
            break
    aw = place_words(a.get("place")) - bw
    if aw and any(w in fold(b.get("text")) for w in aw):
        score += 2
        why.append(f"the later report names {a.get('place', '').split(',')[0]}")
    if moves(a.get("text")) or moves(b.get("text")):
        score += 1
        why.append("march or route words")
    return score, why


def _ref(r: dict) -> dict:
    """A source post as the details card shows it."""
    return {"id": r["id"], "title": r.get("title"), "url": r.get("url"), "source": r.get("source"),
            "published_at": r.get("at"), "place": r.get("place"), "text": (r.get("text") or "")[:400]}


def link_tracks(reports: list[dict], now: _dt.datetime | None = None, zone_of=None, min_nodes: int = 2) -> list[dict]:
    """reports: {id, lat, lon, at, place, country?, text, title?, url?, source?}
    → tracks (min_nodes places or more — two for the movement layer; one for
    the city situation, demo_situation.py, where a crowd seen once is still a
    crowd), newest first. zone_of(country) → a tzinfo for the "last reported
    HH:MM" (UTC when None)."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    rs = sorted((r for r in reports if r.get("lat") is not None and r.get("lon") is not None and _utc(r.get("at"))),
                key=lambda r: _utc(r["at"]))
    tracks: list[dict] = []          # {"nodes": [node], "why": [[str]]}
    for r in rs:
        r = {**r, "city": r.get("city") or city_of(r.get("place")), "country": (r.get("country") or "").lower()}
        best = None
        for t in tracks:
            head = t["nodes"][-1]
            res = link_score(head, r)
            if res is None:
                continue
            same = metres(head["lat"], head["lon"], r["lat"], r["lon"]) <= SAME_PLACE_M
            score, why = res
            if not same and score < MIN_SCORE:
                continue
            gap = (_utc(r["at"]) - _utc(head["at"])).total_seconds()
            key = (1 if same else 0, score, -gap)
            if best is None or key > best[0]:
                best = (key, t, same, why)
        if best and best[2]:
            head = best[1]["nodes"][-1]
            head["reports"].append(r)
            head["at"] = r["at"]
            head["text"] = f"{head['text']} {r.get('text') or ''}"
        elif best:
            best[1]["nodes"].append(_node(r))
            best[1]["why"].append(best[3])
        else:
            tracks.append({"nodes": [_node(r)], "why": []})
    out = [_public(t, now, zone_of) for t in tracks if len(t["nodes"]) >= max(1, min_nodes)]
    return sorted(out, key=lambda t: t["last_at"], reverse=True)


def _node(r: dict) -> dict:
    return {"lat": float(r["lat"]), "lon": float(r["lon"]), "at": r["at"], "first_at": r["at"], "place": r.get("place") or "",
            "city": r["city"], "country": r["country"], "text": r.get("text") or "", "reports": [r]}


def hhmm(at, zone=None) -> str:
    t = _utc(at)
    if not t:
        return ""
    return t.astimezone(zone).strftime("%H:%M") if zone else t.strftime("%H:%M UTC")


def _public(t: dict, now: _dt.datetime, zone_of) -> dict:
    nodes = t["nodes"]
    last, first = nodes[-1], nodes[0]
    zone = None
    if zone_of:
        try:
            zone = zone_of(last["country"])
        except Exception:                                      # noqa: BLE001
            zone = None
    age = lambda at: round((now - _utc(at)).total_seconds() / 60, 1)  # noqa: E731
    segments = []
    for i in range(1, len(nodes)):
        a, b = nodes[i - 1], nodes[i]
        seen, refs = set(), []
        for r in a["reports"][-1:] + b["reports"]:
            if r["id"] not in seen:
                seen.add(r["id"])
                refs.append(_ref(r))
        segments.append({
            "i": i - 1,
            "from": {"lat": a["lat"], "lon": a["lon"], "place": a["place"], "at": a["at"]},
            "to": {"lat": b["lat"], "lon": b["lon"], "place": b["place"], "at": b["first_at"]},
            "at": b["first_at"], "age_min": age(b["first_at"]),
            "distance_m": round(metres(a["lat"], a["lon"], b["lat"], b["lon"])),
            "why": t["why"][i - 1], "sources": refs,
        })
    n = sum(len(x["reports"]) for x in nodes)
    city = (last["place"].split(",")[1].strip() if len(last["place"].split(",")) >= 3 else last["place"].split(",")[0].strip()) or last["city"]
    prev = nodes[-2] if len(nodes) >= 2 else None
    label = f"last reported {hhmm(last['at'], zone)}"
    return {
        "id": f"pt-{first['reports'][0]['id']}",
        "kind": "protest_track", "reconstructed": True, "note": RECONSTRUCTED,
        "city": city, "country": last["country"],
        "title": (f"Crowd movement in {city}, reconstructed from {n} reports" if prev
                  else f"Crowd reported in {city}, {n} report{'s' if n != 1 else ''}"),
        "points": [{"lat": x["lat"], "lon": x["lon"], "at": x["at"], "first_at": x["first_at"], "place": x["place"],
                    "sources": [_ref(r) for r in x["reports"]]} for x in nodes],
        "segments": segments,
        "started_at": first["first_at"], "last_at": last["at"], "age_min": age(last["at"]),
        "last": {"lat": last["lat"], "lon": last["lon"], "at": last["at"], "place": last["place"],
                 "hhmm": hhmm(last["at"], zone), "label": label},
        "heading_deg": round(bearing(prev["lat"], prev["lon"], last["lat"], last["lon"]), 1) if prev else None,
        "n_reports": n,
    }


# ── reads ───────────────────────────────────────────────────────────────────

def post_report(r) -> dict | None:
    """A located Telegram post → a report, or None (no crowd, a city-level
    pin, an announcement of something to come)."""
    if r["lat"] is None or (r["precision"] or "") not in PRECISE:
        return None
    text = " ".join(x for x in (r["headline"], r["summary_en"], r["text"]) if x)
    if not is_crowd(text):
        return None
    if r["announce_at"]:
        import telegram_ingest as tg
        if tg.is_announcement(r["announce_what"], r["announce_at"], r["posted_at"] or ""):
            return None
    return {"id": f"tg-{r['channel']}-{r['msg_id']}", "post": f"{r['channel']}/{r['msg_id']}", "lat": r["lat"], "lon": r["lon"], "at": r["posted_at"],
            "place": r["place"] or "", "country": r["country_code"] or "", "text": text,
            "title": r["headline"] or (r["summary_en"] or "")[:120] or "Telegram post",
            "url": None if str(r["channel"]).startswith(("c/", "u/", "g/")) else f"https://t.me/{r['channel']}/{r['msg_id']}",
            "source": f"Telegram · {r['channel_title'] or r['channel']}"}


def situation_report(r) -> dict | None:
    if r["lat"] is None or (r["kind"] or "") not in CROWD_SITUATIONS or (r["precision"] or "") not in PRECISE:
        return None
    text = " ".join(x for x in (r["happening"], r["text"]) if x)
    if r["kind"] == "other" and not is_crowd(text):
        return None
    return {"id": f"tgs-{r['channel']}-{r['msg_id']}-{r['idx']}", "post": f"{r['channel']}/{r['msg_id']}", "lat": r["lat"], "lon": r["lon"], "at": r["posted_at"],
            "place": r["place"] or "", "country": r["country"] or "", "text": text,
            "title": r["happening"] or "Live development",
            "url": None if str(r["channel"]).startswith(("c/", "u/", "g/")) else f"https://t.me/{r['channel']}/{r['msg_id']}",
            "source": f"Telegram · {r['channel_title'] or r['channel']}"}


def read_reports(now: _dt.datetime | None = None, hours: float = LOOKBACK_H) -> list[dict]:
    now = now or _dt.datetime.now(_dt.timezone.utc)
    import telegram_events as te
    cutoff = (now - _dt.timedelta(hours=hours)).isoformat()
    con = te._con()
    con.row_factory = sqlite3.Row
    out: list[dict] = []
    try:
        for r in con.execute("SELECT channel, msg_id, channel_title, posted_at, text, headline, summary_en, place, precision,"
                             " country_code, lat, lon, announce_at, announce_what FROM telegram_posts"
                             " WHERE lat IS NOT NULL AND posted_at >= ? ORDER BY posted_at LIMIT 3000", (cutoff,)):
            x = post_report(r)
            if x:
                out.append(x)
        for r in con.execute("SELECT s.*, p.channel_title, p.text FROM telegram_situations s"
                             " JOIN telegram_posts p ON p.channel=s.channel AND p.msg_id=s.msg_id"
                             " WHERE s.posted_at >= ? ORDER BY s.posted_at LIMIT 2000", (cutoff,)):
            x = situation_report(r)
            if x:
                out.append(x)
    finally:
        con.close()
    # a post and the development read out of it, at the same place: once
    seen, uniq = set(), []
    for x in out:
        k = (x["post"], round(x["lat"], 3), round(x["lon"], 3))
        if k in seen:
            continue
        seen.add(k)
        uniq.append(x)
    return uniq


def current(now: _dt.datetime | None = None) -> list[dict]:
    """Every demonstration and happening the route planner knows about, the
    world over (the planner's own hazards, military kinds left out)."""
    import safe_route as sr
    hz = sr.hazards_in_box(-90, 90, -180, 180, now, DEMO_PROVIDERS)
    return [h for h in hz if h["kind"] not in MILITARY_KINDS]


_memo: dict = {}
MEMO_S = 30


def snapshot(now: _dt.datetime | None = None) -> dict:
    """The layer's answer: current demonstrations and reconstructed movement,
    read at most every MEMO_S seconds (every phone polls each minute)."""
    hit = _memo.get("v")
    if now is None and hit and time.time() - hit[0] < MEMO_S:
        return hit[1]
    t = now or _dt.datetime.now(_dt.timezone.utc)
    out = {"generated_at": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "demonstrations": [], "tracks": [], "protests": [], "note": RECONSTRUCTED,
           "linking": {"lookback_h": LOOKBACK_H, "window_h": LINK_WINDOW_H, "walk_kmh": WALK_KMH,
                       "slack_m": HOP_SLACK_M, "max_hop_m": MAX_HOP_M, "same_place_m": SAME_PLACE_M}}
    try:
        out["demonstrations"] = current(t)
    except Exception as ex:                                    # noqa: BLE001
        print(f"[demonstrations] error: current: {type(ex).__name__}: {ex}", flush=True)
    try:
        import telegram_events as te
        out["tracks"] = link_tracks(read_reports(t), t, lambda cc: te.zone_for(None, cc))
    except Exception as ex:                                    # noqa: BLE001
        print(f"[demonstrations] error: tracks: {type(ex).__name__}: {ex}", flush=True)
    try:
        # announced protests with where they stand now ("Ongoing · since 14:00"),
        # their photos and videos and the crowd's size (protest_status.py)
        import protest_status as ps
        out["protests"] = ps.snapshot(now)["protests"]
        out["demonstrations"] = status_hazards(out["demonstrations"], out["protests"])
        # a protest whose last activity is over 24 h old is off the map and
        # the cards (demo_freshness.py; the statistics count it elsewhere)
        import demo_freshness as dfr
        out["protests"] = [p for p in out["protests"] if not dfr.stale({**p, "kind": "protest"}, t)]
    except Exception as ex:                                    # noqa: BLE001
        out["protests"] = []
        print(f"[demonstrations] error: protests: {type(ex).__name__}: {ex}", flush=True)
    if now is None:
        _memo["v"] = (time.time(), out)
    return out


def status_hazards(hazards: list[dict], protests: list[dict]) -> list[dict]:
    """An announced gathering among the planner's hazards carries its
    protest's status, so its card reads "Ongoing · since 14:00", not
    "under way for 840 min" (the hazard's id is the announcement's,
    tga-<channel>-<msg_id>-<idx>); once its protest is over (Ended / No
    sign it happened) it is not on this layer at all (owner, 2026-10-19)."""
    out = []
    by_src = {}
    for p in protests:
        for s in p.get("sources") or []:
            by_src.setdefault(f"{s['channel']}-{s['msg_id']}", p)
    for h in hazards:
        hid = str(h.get("id") or "")
        if not hid.startswith("tga-"):
            out.append(h)
            continue
        body = hid[4:]
        p = by_src.get(body) or by_src.get(body.rsplit("-", 1)[0])
        if p:
            h["protest_id"] = p["id"]
            h["protest_status"] = {"key": p["status"]["key"], "label": p["status_label"], "since": p["status"].get("since"),
                                   "until": p["status"].get("until"), "starts_utc": p.get("starts_utc"),
                                   "last_report_at": p["status"].get("last_report_at"), "tz": p.get("tz"),
                                   "start_approx": p.get("start_approx"), "crowd": (p.get("crowd") or {}).get("label")}
            if p["status"]["key"] in ("ended", "no_show"):
                continue
        out.append(h)
    return out
