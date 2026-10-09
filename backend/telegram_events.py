"""
telegram_events.py — what Telegram says WILL happen, and what is happening
NOW, each at its own place.

ANNOUNCED. "Science Po est bloqué, les lycéens d'Île-de-France sont appelés
à prendre la Bastille demain à 15h" is a warning: tomorrow at 15:00 there
will be a crowd at Bastille. A gilets jaunes post listing twenty cities,
each with its own square and hour, is twenty warnings. The first reading
(telegram_ingest.read_announcements, 2026-10-06) kept one event per post,
so a list became one pin in one city. Here the model returns every event a
post announces, one per place, each with:
  - when, in the place's own time zone (so a reminder can fire before it);
  - what is likely to happen there, and what someone nearby should do —
    both must name the place, or they are dropped (the owner's rule: no
    generic output; "stay safe" names nothing and nobody can act on it).

NOW. "Tous ceux présents sur le boulevard Saint-Germain attention, ils
sont en train de faire une nasse", "the PLC has made a tactical withdrawal
from Dhubab": a development on the ground that someone near it must know
in minutes, not a map pin for tomorrow. A second cheap pass reads the last
hours of posts that carry such cues and keeps each development at its
place, valid for a few hours.

Who is told is decided per user in event_watch.py. Model calls go to
OpenAI through openai_gate (Claude writes briefings only).
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import sqlite3

import telegram_ingest as tg

BATCH = 10
SITUATION_HOURS = 3          # how far back the live pass reads, and how long a development stays live
SLOW_SITUATION_HOURS = 12    # a withdrawal or an advance changes a front for longer than a kettle lasts

DDL = [
    """CREATE TABLE IF NOT EXISTS telegram_announcements (
        channel TEXT NOT NULL, msg_id INTEGER NOT NULL, idx INTEGER NOT NULL,
        posted_at TEXT, what TEXT, cause TEXT, organiser TEXT,
        starts_at TEXT,           -- local time at the place: YYYY-MM-DDTHH:MM or YYYY-MM-DD
        tz TEXT, starts_utc TEXT, -- IANA zone; the start in UTC when an hour is known
        place TEXT, precision TEXT, lat REAL, lon REAL, country TEXT,
        expect TEXT, advice TEXT,
        PRIMARY KEY (channel, msg_id, idx))""",
    """CREATE TABLE IF NOT EXISTS telegram_situations (
        channel TEXT NOT NULL, msg_id INTEGER NOT NULL, idx INTEGER NOT NULL,
        posted_at TEXT, valid_until TEXT, kind TEXT, actor TEXT, happening TEXT,
        place TEXT, precision TEXT, lat REAL, lon REAL, country TEXT,
        expect TEXT, advice TEXT,
        PRIMARY KEY (channel, msg_id, idx))""",
]


def _con():
    con = tg._con()
    for d in DDL:
        con.execute(d)
    have = {r[1] for r in con.execute("PRAGMA table_info(telegram_posts)")}
    for col in ("events_checked", "situation_checked"):
        if col not in have:
            con.execute(f"ALTER TABLE telegram_posts ADD COLUMN {col} INTEGER")
    return con


# ── time ────────────────────────────────────────────────────────────────────

def zone_for(tz: str | None, country_code: str | None):
    """The place's time zone: the model's IANA name if real, else the
    country's when it has only one. None when neither holds — a reminder
    is then not timed rather than timed wrong."""
    from zoneinfo import ZoneInfo
    for name in (tz,):
        if name:
            try:
                return ZoneInfo(name)
            except Exception:                                  # noqa: BLE001
                pass
    try:
        import pytz
        zones = pytz.country_timezones.get((country_code or "").upper()) or []
        # One zone, or several that keep the same clock (Germany lists
        # Europe/Berlin and Europe/Busingen): any of them is right.
        probe = _dt.datetime.now(_dt.timezone.utc)
        if zones and len({ZoneInfo(z).utcoffset(probe) for z in zones}) == 1:
            return ZoneInfo(zones[0])
    except Exception:                                          # noqa: BLE001
        pass
    return None


def to_utc(starts_at: str | None, zone) -> str | None:
    """'2026-10-11T15:00' in the place's zone → ISO UTC. Date-only → None."""
    if not starts_at or "T" not in starts_at or zone is None:
        return None
    try:
        local = _dt.datetime.fromisoformat(starts_at).replace(tzinfo=zone)
    except ValueError:
        return None
    return local.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_future(starts_at: str, starts_utc: str | None, posted_at: str, what: str | None) -> bool:
    """Announced means: a gathering, starting after the post was written.
    With the zone known the comparison is exact (15 minutes' slack); without
    it, telegram_ingest's rule with its 90 minutes' slack."""
    if not tg.GATHERING.search(what or ""):
        return False
    if starts_utc:
        try:
            posted = _dt.datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
            start = _dt.datetime.fromisoformat(starts_utc.replace("Z", "+00:00"))
        except ValueError:
            return False
        if posted.tzinfo is None:
            posted = posted.replace(tzinfo=_dt.timezone.utc)
        return start > posted - _dt.timedelta(minutes=15)
    return tg.is_announcement(what, starts_at, posted_at)


# ── no generic output ───────────────────────────────────────────────────────

_STOP = {"the", "de", "la", "le", "les", "du", "des", "rue", "place", "boulevard", "avenue", "street",
         "square", "city", "and", "of", "in", "et"}


def place_words(place: str | None) -> set[str]:
    words = re.findall(r"[\w'’-]{4,}", (place or "").lower())
    return {w for w in words if w not in _STOP}


def names_place(text: str | None, place: str | None) -> bool:
    """A sentence is specific when it names the place (any distinctive word
    of it). 'Avoid the area' is dropped; 'Avoid Place de la Bastille from
    14:30' is kept."""
    t = (text or "").lower()
    return bool(t.strip()) and any(w in t for w in place_words(place))


def specific(text: str | None, place: str | None, limit: int = 240) -> str | None:
    return (text or "").strip()[:limit] if names_place(text, place) else None


# ── announced ───────────────────────────────────────────────────────────────

ANNOUNCE_SYSTEM = """You read Telegram posts for announcements of FUTURE public gatherings or
collective actions: demonstrations, marches, rallies, vigils, strikes, blockades, occupations.
Each post is prefixed with the date and weekday it was posted.
An announcement names something that has NOT happened yet when posted, with a place and a day.
NOT announcements: reports of something happening or that happened, livestreams or videos of past
events, commentary, calls with no place or no day. Meetings, speeches, trainings and works are not
gatherings.
ONE EVENT PER PLACE: a post listing several cities or meeting points, each with its own place and
time, is several events. Give every one.
For each numbered post return an object in "results" (same order): {"events": [...]}, empty when
the post announces nothing. Each event:
  what: 2-5 English words naming the KIND of gathering with one of: protest, demonstration, march,
    rally, vigil, strike, blockade, occupation, sit-in, walkout. A gilets jaunes "acte" is a
    "gilets jaunes rally"; a "rassemblement" is a "rally". E.g. "student march", "road blockade".
  cause: what it is about, under 10 English words, or ""
  organiser: who calls it, as the post says (union, collective, channel), or ""
  starts_at: local time at the place, "YYYY-MM-DDTHH:MM", or "YYYY-MM-DD" if no hour. Resolve
    "tomorrow", "Saturday", "demain", "morgen" against the posting date.
  timezone: the IANA time zone of the place, e.g. "Europe/Paris"
  place: the most precise place named, "Place, City, Country" in English
  precision: site | street | district | city | region | country | none
  country_code: ISO 3166-1 alpha-2, lowercase
  expect: one sentence on what is likely to happen there, NAMING THE PLACE: route, likely size if
    the post supports it, likely police response, what closes. Nothing the post and the kind of
    event do not support.
  advice: one sentence for someone near it, NAMING THE PLACE and the time window, e.g. "Avoid
    Place de la Bastille and Rue de la Roquette from 14:30 to 18:00".
Return JSON {"results": [...]}."""


def _model(system: str, rows: list, max_tokens: int = 3500) -> list:
    import openai_gate
    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None:
        raise RuntimeError("no model")
    model = openai_gate.model_for(openai_gate.ENRICH)
    numbered = "\n\n".join(
        f"{i+1}. [posted {r['posted_at'][:16].replace('T', ' ')} UTC ({tg._weekday(r['posted_at'])}) | "
        f"{r['channel_title'] or r['channel']}] {(r['text'] or '')[:1400]}"
        for i, r in enumerate(rows))
    resp = client.chat.completions.create(
        model=model, temperature=0, max_tokens=max_tokens, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system}, {"role": "user", "content": numbered}])
    u = getattr(resp, "usage", None)
    if u:
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=u.prompt_tokens, output_tokens=u.completion_tokens,
                                      call_type="telegram", model=model, headline=f"events · {len(rows)} posts")
        except Exception:                                      # noqa: BLE001
            pass
    return json.loads(resp.choices[0].message.content or "{}").get("results") or []


def clean_announcement(ev: dict, posted_at: str) -> dict | None:
    """One event from the model, checked in code. None when it is not a
    dated, placed, future gathering. Geocoding is the caller's."""
    ev = ev or {}
    start = tg.parse_start(ev.get("starts_at"), posted_at)
    if not start:
        return None
    zone = zone_for(ev.get("timezone"), ev.get("country_code"))
    utc = to_utc(start, zone)
    if not is_future(start, utc, posted_at, ev.get("what")):
        return None
    place = (ev.get("place") or "").strip()
    if not place:
        return None
    return {
        "what": (ev.get("what") or "")[:60], "cause": (ev.get("cause") or "")[:120],
        "organiser": (ev.get("organiser") or "")[:80],
        "starts_at": start, "tz": getattr(zone, "key", None), "starts_utc": utc,
        "place": place, "precision": ev.get("precision"), "country": (ev.get("country_code") or "").lower(),
        "expect": specific(ev.get("expect"), place), "advice": specific(ev.get("advice"), place),
    }


def read_announcements(limit: int = 60, days: int = 7) -> dict:
    """Posts not yet read for events: cue-matched ones go to the model, the
    rest are marked read. Every event kept is geocoded by the pins' rule."""
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=days)).isoformat()
    con = _con()
    con.row_factory = sqlite3.Row
    cand = con.execute("SELECT channel, channel_title, posted_at, text, msg_id FROM telegram_posts"
                       " WHERE events_checked IS NULL AND posted_at >= ? AND text IS NOT NULL AND length(text) > 40"
                       " ORDER BY posted_at DESC LIMIT ?", (cutoff, limit * 4)).fetchall()
    skip = [r for r in cand if not tg.ANNOUNCE_CUES.search(r["text"] or "")]
    con.executemany("UPDATE telegram_posts SET events_checked=1 WHERE channel=? AND msg_id=?",
                    [(r["channel"], r["msg_id"]) for r in skip])
    con.commit()
    rows = [r for r in cand if tg.ANNOUNCE_CUES.search(r["text"] or "")][:limit]
    found = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        try:
            res = _model(ANNOUNCE_SYSTEM, chunk)
        except Exception as e:                                 # noqa: BLE001
            print(f"[telegram-events] announcement pass failed: {type(e).__name__}: {e}", flush=True)
            continue
        for r, x in zip(chunk, res):
            events = (x or {}).get("events") or []
            n = 0
            for ev in events[:40]:
                c = clean_announcement(ev, r["posted_at"])
                if not c:
                    continue
                hit, _why = tg.locate(c["place"], c["precision"], c["country"])
                if not hit:
                    continue
                con.execute(
                    "INSERT OR REPLACE INTO telegram_announcements (channel, msg_id, idx, posted_at, what, cause,"
                    " organiser, starts_at, tz, starts_utc, place, precision, lat, lon, country, expect, advice)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (r["channel"], r["msg_id"], n, r["posted_at"], c["what"], c["cause"], c["organiser"],
                     c["starts_at"], c["tz"], c["starts_utc"], c["place"], c["precision"], hit["lat"], hit["lon"],
                     c["country"], c["expect"], c["advice"]))
                n += 1
            found += n
            con.execute("UPDATE telegram_posts SET events_checked=1 WHERE channel=? AND msg_id=?", (r["channel"], r["msg_id"]))
        con.commit()
    con.close()
    return {"events_read": len(rows), "events_announced": found}


def adopt_single_announcements() -> int:
    """Announcements read before this module (one per post, on
    telegram_posts) become rows here, so nothing announced is lost."""
    con = _con()
    rows = con.execute(
        "SELECT p.channel, p.msg_id, p.posted_at, p.announce_what, p.announce_cause, p.announce_at, p.announce_place,"
        " p.announce_lat, p.announce_lon, p.announce_country FROM telegram_posts p"
        " WHERE p.announce_at IS NOT NULL AND p.announce_lat IS NOT NULL AND NOT EXISTS"
        " (SELECT 1 FROM telegram_announcements a WHERE a.channel=p.channel AND a.msg_id=p.msg_id)").fetchall()
    for ch, mid, posted, what, cause, at, place, lat, lon, cc in rows:
        zone = zone_for(None, cc)
        con.execute("INSERT OR IGNORE INTO telegram_announcements (channel, msg_id, idx, posted_at, what, cause, starts_at,"
                    " tz, starts_utc, place, lat, lon, country) VALUES (?,?,0,?,?,?,?,?,?,?,?,?,?)",
                    (ch, mid, posted, what, cause, at, getattr(zone, "key", None), to_utc(at, zone), place, lat, lon, cc))
    con.commit()
    con.close()
    return len(rows)


def _short_place(place: str | None) -> str:
    parts = [p.strip() for p in (place or "").split(",") if p.strip()]
    return ", ".join(parts[:2])


def announcements(days_ahead: int = 30) -> list[dict]:
    """Every announced event still to come, soonest first; one per what,
    place (about 1 km) and day however many channels or posts carried it."""
    now = _dt.datetime.now(_dt.timezone.utc)
    today = now.strftime("%Y-%m-%d")
    horizon = (now + _dt.timedelta(days=days_ahead)).strftime("%Y-%m-%d")
    con = _con()
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT a.*, p.channel_title, p.text, p.summary_en, p.lang, p.role, p.party FROM telegram_announcements a"
        " JOIN telegram_posts p ON p.channel=a.channel AND p.msg_id=a.msg_id"
        " WHERE substr(a.starts_at,1,10) >= ? AND substr(a.starts_at,1,10) <= ?"
        " ORDER BY a.starts_at, a.posted_at", (today, horizon)).fetchall()
    con.close()
    out, seen = [], {}
    for r in rows:
        if r["starts_utc"] and r["starts_utc"] < now.strftime("%Y-%m-%dT%H:%M:%SZ"):
            continue
        # Checked again on read: rows adopted from the first reading include
        # what it let through ("speech event", "committee meeting").
        if not is_future(r["starts_at"], r["starts_utc"], r["posted_at"] or "", r["what"]):
            continue
        key = ((r["what"] or "").lower(), round(r["lat"], 2), round(r["lon"], 2), r["starts_at"][:10])
        label = r["channel_title"] or r["channel"]
        if key in seen:
            s = seen[key]
            if label not in s["also_reported_by"] and label != s["channel_title"]:
                s["also_reported_by"].append(label)
            continue
        what = (r["what"] or "gathering").strip()
        item = {
            "id": f"tga-{r['channel']}-{r['msg_id']}-{r['idx']}", "announcement": True,
            "post_id": f"{r['channel']}/{r['msg_id']}",
            "headline": f"{what[:1].upper()}{what[1:]} announced: {_short_place(r['place'])} — {tg._when_label(r['starts_at'])}",
            "what": what, "cause": r["cause"] or "", "organiser": r["organiser"] or "",
            "starts_at": r["starts_at"], "starts_utc": r["starts_utc"], "tz": r["tz"],
            "when_label": tg._when_label(r["starts_at"]),
            "place": r["place"], "country_code": r["country"], "lat": r["lat"], "lon": r["lon"],
            "expect": r["expect"], "advice": r["advice"],
            "channel": r["channel"], "channel_title": r["channel_title"], "msg_id": r["msg_id"],
            "posted_at": r["posted_at"], "text": r["text"], "summary_en": r["summary_en"], "lang": r["lang"],
            "url": None if r["channel"].startswith("c/") else f"https://t.me/{r['channel']}/{r['msg_id']}",
            "role": r["role"], "party": r["party"], "also_reported_by": [],
            "verification": "announced in advance — " + tg.ROLE_LABEL.get(r["role"] or "aggregator", tg.ROLE_LABEL["aggregator"]),
        }
        out.append(item)
        seen[key] = item
    return out


# ── now ─────────────────────────────────────────────────────────────────────

SITUATION_CUES = re.compile(
    r"(nasse|kettl|encercl|charg|lacrymo|gaz|tear.?gas|renfort|reinforc|\bcrs\b|brav|gendarm|bloqu|fermé|"
    r"ferme |closed|clos(e|ing) |repli|retrait|withdr|retreat|pull(ed|s|ing)? (back|out)|advanc|avanc|"
    r"checkpoint|barrage|évacu|evacu|clash|affront|heurts|kessel|wasserwerfer|räum|انسحاب|تعزيزات|اشتباك|"
    r"تقدم|انسحب|حاجز)", re.I)

SITUATION_SYSTEM = """You read Telegram posts for LIVE developments on the ground that someone nearby
must know about within minutes: police kettling a crowd (a "nasse"), charges, tear gas, water
cannon, reinforcements being sent somewhere, roads or stations closed, clashes moving, a force
withdrawing from or entering a place, a checkpoint set up, an evacuation.
Only what is happening at the time of posting. NOT: announcements of future events, analysis,
history, videos of something earlier, general statements.
For each numbered post return an object in "results" (same order): {"events": [...]}, empty when
the post reports no live development. Each event:
  kind: kettle | charge | tear_gas | water_cannon | reinforcements | clashes | closure | withdrawal |
        advance | checkpoint | evacuation | other
  actor: who acts, e.g. "French riot police (CRS)", "PLC forces", "Houthi fighters"
  happening: one English sentence: who does what, where, NAMING THE PLACE
  place: the most precise place named, "Place, City, Country" in English
  precision: site | street | district | city | region | country | none
  country_code: ISO 3166-1 alpha-2, lowercase
  expect: one sentence on what is likely to follow in the next hours, NAMING THE PLACE
  advice: one sentence for someone near it now, NAMING THE PLACE (which streets to avoid, which way out)
Return JSON {"results": [...]}."""

SITUATION_KINDS = {"kettle", "charge", "tear_gas", "water_cannon", "reinforcements", "clashes", "closure",
                   "withdrawal", "advance", "checkpoint", "evacuation", "other"}
PRECISE_ENOUGH = {"site", "street", "district", "city", "town", "village"}


def clean_situation(ev: dict, posted_at: str) -> dict | None:
    ev = ev or {}
    kind = (ev.get("kind") or "").strip().lower()
    place = (ev.get("place") or "").strip()
    if kind not in SITUATION_KINDS or not place or (ev.get("precision") or "") not in PRECISE_ENOUGH:
        return None
    happening = specific(ev.get("happening"), place, 200)
    if not happening:
        return None
    try:
        posted = _dt.datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    if posted.tzinfo is None:
        posted = posted.replace(tzinfo=_dt.timezone.utc)
    hours = SLOW_SITUATION_HOURS if kind in ("withdrawal", "advance") else SITUATION_HOURS
    return {
        "kind": kind, "actor": (ev.get("actor") or "")[:80], "happening": happening,
        "place": place, "precision": ev.get("precision"), "country": (ev.get("country_code") or "").lower(),
        "expect": specific(ev.get("expect"), place), "advice": specific(ev.get("advice"), place),
        "valid_until": (posted + _dt.timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def read_situations(limit: int = 40) -> dict:
    """The last few hours' posts that carry a live cue, read once each."""
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=SITUATION_HOURS)).isoformat()
    con = _con()
    con.row_factory = sqlite3.Row
    cand = con.execute("SELECT channel, channel_title, posted_at, text, msg_id FROM telegram_posts"
                       " WHERE situation_checked IS NULL AND posted_at >= ? AND text IS NOT NULL AND length(text) > 25"
                       " ORDER BY posted_at DESC LIMIT ?", (cutoff, limit * 4)).fetchall()
    skip = [r for r in cand if not SITUATION_CUES.search(r["text"] or "")]
    con.executemany("UPDATE telegram_posts SET situation_checked=1 WHERE channel=? AND msg_id=?",
                    [(r["channel"], r["msg_id"]) for r in skip])
    con.commit()
    rows = [r for r in cand if SITUATION_CUES.search(r["text"] or "")][:limit]
    found = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        try:
            res = _model(SITUATION_SYSTEM, chunk, max_tokens=2500)
        except Exception as e:                                 # noqa: BLE001
            print(f"[telegram-events] situation pass failed: {type(e).__name__}: {e}", flush=True)
            continue
        for r, x in zip(chunk, res):
            n = 0
            for ev in ((x or {}).get("events") or [])[:10]:
                c = clean_situation(ev, r["posted_at"])
                if not c:
                    continue
                hit, _why = tg.locate(c["place"], c["precision"], c["country"])
                if not hit:
                    continue
                con.execute(
                    "INSERT OR REPLACE INTO telegram_situations (channel, msg_id, idx, posted_at, valid_until, kind, actor,"
                    " happening, place, precision, lat, lon, country, expect, advice) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (r["channel"], r["msg_id"], n, r["posted_at"], c["valid_until"], c["kind"], c["actor"], c["happening"],
                     c["place"], c["precision"], hit["lat"], hit["lon"], c["country"], c["expect"], c["advice"]))
                n += 1
            found += n
            con.execute("UPDATE telegram_posts SET situation_checked=1 WHERE channel=? AND msg_id=?", (r["channel"], r["msg_id"]))
        con.commit()
    con.close()
    return {"situations_read": len(rows), "situations": found}


def situations() -> list[dict]:
    """Developments still live, newest first."""
    now = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    con = _con()
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT s.*, p.channel_title, p.text, p.role FROM telegram_situations s"
        " JOIN telegram_posts p ON p.channel=s.channel AND p.msg_id=s.msg_id"
        " WHERE s.valid_until > ? ORDER BY s.posted_at DESC", (now,)).fetchall()
    con.close()
    return [{
        "id": f"tgs-{r['channel']}-{r['msg_id']}-{r['idx']}", "situation": True,
        "kind": r["kind"], "actor": r["actor"], "happening": r["happening"],
        "place": r["place"], "country_code": r["country"], "lat": r["lat"], "lon": r["lon"],
        "expect": r["expect"], "advice": r["advice"],
        "posted_at": r["posted_at"], "valid_until": r["valid_until"],
        "channel": r["channel"], "channel_title": r["channel_title"], "msg_id": r["msg_id"], "text": r["text"],
        "url": None if r["channel"].startswith("c/") else f"https://t.me/{r['channel']}/{r['msg_id']}",
        "verification": tg.ROLE_LABEL.get(r["role"] or "aggregator", tg.ROLE_LABEL["aggregator"]),
    } for r in rows]


def run_once() -> dict:
    out = {}
    try:
        out["adopted"] = adopt_single_announcements()
    except Exception as e:                                     # noqa: BLE001
        print(f"[telegram-events] adopt failed: {type(e).__name__}: {e}", flush=True)
    for fn in (read_announcements, read_situations):
        try:
            out.update(fn())
        except Exception as e:                                 # noqa: BLE001
            print(f"[telegram-events] {fn.__name__} failed: {type(e).__name__}: {e}", flush=True)
    return out
