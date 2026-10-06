"""
telegram_ingest.py — the channels you joined, as located signals.

Reads every broadcast channel the logged-in account has joined (Telethon,
TELEGRAM_API_ID / TELEGRAM_API_HASH in backend/.env, session file in
data/telegram/, gitignored), keeps each post's text, a thumbnail of its
photo or video, and its t.me link — the original plays in the console
through Telegram's embed, as X posts do.

THE MODEL READS, THE CODE DECIDES (as enrich.py). A cheap OpenAI pass over
new posts says, per post: does it have intelligence value (most channel
traffic is commentary, adverts and reposts — dropped), a short English
headline, and the most precise place it names, with that place's country.
The CODE then geocodes the place and publishes the post only if

    - the place is a village, town, city, street or site (not a region or
      a country: a pin on a country centroid is not a location), and
    - the geocoder's country is the country the post is about.

A post that fails either stays in the store, unpublished, with the reason.
Telegram is unverified by nature; every published post says so and names
its channel.

    python3 telegram_ingest.py login    # once, in a terminal: phone + code
    python3 telegram_ingest.py run      # one collect + classify pass
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import json
import os
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TG_DIR = os.path.join(HERE, "data", "telegram")
MEDIA_DIR = os.path.join(TG_DIR, "media")
SESSION = os.path.join(TG_DIR, "parallax")
LOOKBACK_HOURS = 48
PER_CHANNEL = 150
BATCH = 15
PRECISE = {"site", "street", "village", "town", "district", "city"}
# What the map is for (owner, 2026-10-05): fighting, strikes, movements,
# damage — "a new school opened in Koulouba" is not news here, even with a
# precise place — nor is civil unrest or police news ("officers arrested
# in Eilat"): the map wants the front line.
KINETIC = {"strike", "attack", "clash", "movement", "seizure", "explosion", "interception",
           "infrastructure_damage", "maritime", "aviation"}


def _db_path() -> str:
    try:
        from main import DATA_DIR
        return os.path.join(DATA_DIR, "akili.db")
    except Exception:
        return os.path.join(HERE, "data", "akili.db")


DDL = """
CREATE TABLE IF NOT EXISTS telegram_posts (
    channel     TEXT NOT NULL,
    msg_id      INTEGER NOT NULL,
    channel_title TEXT,
    posted_at   TEXT NOT NULL,
    text        TEXT,
    media       TEXT,          -- photo | video | none
    thumb       TEXT,          -- file name under data/telegram/media
    views       INTEGER,
    classified  INTEGER DEFAULT 0,
    relevant    INTEGER,
    headline    TEXT,
    event_type  TEXT,
    place       TEXT,
    precision   TEXT,
    country_code TEXT,
    lat REAL, lon REAL,
    geocoded_as TEXT,
    unpublished_reason TEXT,
    PRIMARY KEY (channel, msg_id)
)"""
EXTRA_COLUMNS = {"lang": "TEXT", "summary_en": "TEXT", "role": "TEXT", "party": "TEXT", "claim": "INTEGER",
                 "first_hand": "INTEGER"}

# What each channel is (telegram_channels.json). Unlisted = aggregator.
CHANNELS_FILE = os.path.join(HERE, "telegram_channels.json")


def channel_info(chan: str) -> dict:
    try:
        with open(CHANNELS_FILE) as fh:
            reg = json.load(fh)
    except Exception:
        reg = {}
    info = reg.get(chan) or {}
    return {"role": info.get("role") or "aggregator", "party": info.get("party"), "lang": info.get("lang")}


ROLE_LABEL = {
    "official": "official statement — a party's own claim",
    "local": "local reporting — unverified",
    "outlet": "news outlet",
    "aggregator": "OSINT aggregator — unverified",
    "partisan": "partisan aggregator — unverified",
}


def _con():
    con = sqlite3.connect(_db_path(), timeout=60)
    con.execute(DDL)
    have = {r[1] for r in con.execute("PRAGMA table_info(telegram_posts)")}
    for col, typ in EXTRA_COLUMNS.items():
        if col not in have:
            con.execute(f"ALTER TABLE telegram_posts ADD COLUMN {col} {typ}")
    return con


def configured() -> bool:
    return bool(os.getenv("TELEGRAM_API_ID") and os.getenv("TELEGRAM_API_HASH"))


def logged_in() -> bool:
    return os.path.exists(SESSION + ".session")


def _client():
    from telethon import TelegramClient
    os.makedirs(MEDIA_DIR, exist_ok=True)
    return TelegramClient(SESSION, int(os.environ["TELEGRAM_API_ID"]), os.environ["TELEGRAM_API_HASH"])


# ── collect ─────────────────────────────────────────────────────────────

async def _connected():
    """A connected, authorised client — never an interactive prompt. The
    backend cannot type a phone number; `async with client` would ask for one
    whenever the session is not (yet) authorised, which crashed the loop
    with EOFError while the owner was still logging in."""
    client = _client()
    await client.connect()
    if not await client.is_user_authorized():
        await client.disconnect()
        raise RuntimeError("Telegram session is not authorised — run: python3 telegram_ingest.py login")
    return client


async def _collect(hours: int = LOOKBACK_HOURS) -> int:
    from telethon.tl.types import MessageMediaDocument, MessageMediaPhoto
    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=hours)
    con = _con()
    have = {(c, m) for c, m in con.execute("SELECT channel, msg_id FROM telegram_posts")}
    new = 0
    client = await _connected()
    try:
      async for d in client.iter_dialogs():
            ent = d.entity
            if not (d.is_channel and getattr(ent, "broadcast", False)):
                continue
            chan = getattr(ent, "username", None) or f"c/{ent.id}"
            info = channel_info(chan)
            if info["role"] == "ignore":
                continue                      # joined, judged useless (telegram_channels.json)
            async for m in client.iter_messages(ent, limit=PER_CHANNEL):
                if m.date < cutoff:
                    break
                text = (m.message or "").strip()
                if not text or (chan, m.id) in have:
                    continue
                # A forward is someone else's post: the original is ingested
                # from its own channel if it matters, so skip the copy.
                if m.fwd_from is not None and info["role"] != "official":
                    continue
                media, thumb = "none", None
                if isinstance(m.media, MessageMediaPhoto):
                    media = "photo"
                elif isinstance(m.media, MessageMediaDocument) and (m.file and (m.file.mime_type or "").startswith("video")):
                    media = "video"
                if media != "none":
                    name = f"{chan.replace('/', '_')}_{m.id}.jpg"
                    path = os.path.join(MEDIA_DIR, name)
                    try:
                        # The smallest useful size: a picture of what the post
                        # shows, not the post's full video.
                        got = await client.download_media(m, file=path, thumb=-1 if media == "video" else None)
                        thumb = name if got else None
                    except Exception:
                        thumb = None
                con.execute(
                    "INSERT OR IGNORE INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, thumb, views, role, party)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (chan, m.id, getattr(ent, "title", chan), m.date.isoformat(), text[:4000], media, thumb, m.views,
                     info["role"], info["party"]))
                new += 1
    finally:
        await client.disconnect()
    con.commit(); con.close()
    return new


# ── classify + locate ───────────────────────────────────────────────────

SYSTEM = """You screen Telegram channel posts for an intelligence console.
Posts may be in Arabic, Hebrew, Russian or English; always answer in English.
Each post is prefixed [channel | role | party]. role "official" means the post
is that party's own statement.
For each numbered post return an object in "results" (same order) with:
  relevant: true only if it reports a specific event that happened or was
    claimed, with security, military, maritime, aviation, energy/infrastructure
    or civil-unrest significance (strikes, attacks, clashes, troop or vessel
    movements, seizures, explosions, interceptions, infrastructure damage,
    evacuations, protests). FALSE for: commentary, opinion, analysis, speeches
    with no event, ads, fundraising, memes, quizzes, domestic civil news
    (schools, traffic, weather, politics with no security event), tourism,
    economy and trade figures, religious or social disputes, announced
    routine training or drills, sports, obituaries, and vague posts that
    name no place.
  claim: true if the post asserts an action by its own side (official
    statements, "our forces struck…") — such claims are unverified.
  headline: max 14 words, English, plain: who did what, where. If claim is
    true, attribute it: "Houthi forces say they struck …". No hype, no emoji.
  summary_en: 1–2 sentences, a faithful English rendering of what the post
    says (translate; do not add facts).
  lang: ISO 639-1 language of the post.
  event_type: one of strike, attack, clash, movement, seizure, explosion,
    interception, infrastructure_damage, unrest, maritime, aviation, other.
    Use "other" for anything that is not violence, military activity or
    damage — openings, visits, ceremonies, announcements, aid, politics.
  first_hand: true if the post is a local, on-the-ground account or footage
    of the event (eyewitness, footage, a statement by a party to it), false
    if it is a recap, analysis or summary of others' reports.
  place: the MOST PRECISE place the post itself names, written
    "Place, Region, Country" in English. Never infer a place the post does
    not name. Empty if none.
  precision: site | street | village | town | city | region | country | none
  country_code: ISO 3166-1 alpha-2 of that place, lowercase, or "".
Return JSON {"results": [...]}."""


def _model_pass(rows):
    import openai_gate
    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None:
        return None
    model = openai_gate.model_for(openai_gate.ENRICH)
    numbered = "\n\n".join(f"{i+1}. [{r[1]} | {r[4] or 'aggregator'} | {r[5] or '-'}] {r[2][:700]}" for i, r in enumerate(rows))
    resp = client.chat.completions.create(
        model=model, temperature=0, max_tokens=2500, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": numbered}])
    u = getattr(resp, "usage", None)
    if u:
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=u.prompt_tokens, output_tokens=u.completion_tokens,
                                      call_type="telegram", model=model, headline=f"{len(rows)} posts")
        except Exception:
            pass
    return (json.loads(resp.choices[0].message.content or "{}").get("results") or [])


def locate(place: str, precision: str, country_code: str) -> tuple[dict | None, str | None]:
    """(geocoded, None) or (None, reason). The publish rule, in one place."""
    if (precision or "") not in PRECISE:
        return None, f"place too vague to pin ({precision or 'none'})"
    if not place or not country_code:
        return None, "no named place"
    from geocode_utils import geocode_place
    cc = country_code.lower()
    parts = [p.strip() for p in place.split(",") if p.strip()]
    # The full form first, then the named place with only its country:
    # "Ras Al-Arah, Bab Al-Mandab, Yemen" fails where "Ras Al-Arah, Yemen"
    # resolves; the middle part is context the post added.
    tries = [place] + ([f"{parts[0]}, {parts[-1]}"] if len(parts) > 2 else [])
    hits = []
    for q in tries:
        hits = [h for h in geocode_place(q, expected_country_codes=[cc]) if (h.get("country_code") or "").lower() == cc]
        if hits:
            break
    if not hits:
        return None, f"'{place}' did not resolve inside {country_code.upper()}"
    return hits[0], None


def classify(limit: int = 120) -> dict:
    con = _con()
    rows = con.execute("SELECT channel, channel_title, text, msg_id, role, party, media FROM telegram_posts WHERE classified=0"
                       " ORDER BY posted_at DESC LIMIT ?", (limit,)).fetchall()
    done = kept = 0
    # The model calls run four at a time (11 s each, one after another made
    # a backlog crawl); place lookups and writes stay serial — the geocoder
    # allows one request a second.
    from concurrent.futures import ThreadPoolExecutor
    chunks = [rows[i:i + BATCH] for i in range(0, len(rows), BATCH)]

    def run(chunk):
        try:
            return _model_pass(chunk)
        except Exception as e:
            print(f"[telegram] model pass failed: {type(e).__name__}: {e}", flush=True)
            return None
    with ThreadPoolExecutor(max_workers=4) as pool:
        answers = list(pool.map(run, chunks))
    for chunk, res in zip(chunks, answers):
        if res is None:
            continue
        for r, x in zip(chunk, res):
            x = x or {}
            rel = bool(x.get("relevant"))
            role = r[4] or "aggregator"
            # An official channel relaying someone else's news ("Moscow mayor
            # reports drones neutralised" on a Houthi channel) is not that
            # party's communiqué: screen it as a reposting channel.
            if role == "official" and not x.get("claim"):
                role = "outlet"
            # Aggregators repost everything; what makes one of their posts
            # worth a pin is footage of the thing. Without a photo or video
            # it is a sentence someone else wrote first.
            kinetic = (x.get("event_type") or "other") in KINETIC
            if rel and not kinetic:
                hit, why = None, f"not a kinetic event ({x.get('event_type') or 'other'})"
            elif rel and role in ("aggregator", "partisan", "outlet") and (r[6] or "none") == "none":
                hit, why = None, "no photo or video from a reposting channel"
            elif rel and role in ("aggregator", "partisan") and not x.get("first_hand"):
                hit, why = None, "recap, not a first-hand account"
            elif not rel:
                hit, why = None, "not relevant"
            else:
                hit, why = locate(x.get("place"), x.get("precision"), x.get("country_code"))
            con.execute(
                "UPDATE telegram_posts SET classified=1, relevant=?, headline=?, event_type=?, place=?, precision=?,"
                " country_code=?, lat=?, lon=?, geocoded_as=?, unpublished_reason=?, lang=?, summary_en=?, claim=?,"
                " first_hand=? WHERE channel=? AND msg_id=?",
                (int(rel), (x.get("headline") or "")[:200], x.get("event_type"), x.get("place"), x.get("precision"),
                 (x.get("country_code") or "").lower(), hit and hit["lat"], hit and hit["lon"],
                 hit and hit.get("display_name"), why, x.get("lang"), (x.get("summary_en") or "")[:800],
                 int(bool(x.get("claim"))), int(bool(x.get("first_hand"))), r[0], r[3]))
            done += 1
            kept += int(hit is not None)
        con.commit()
    con.close()
    return {"classified": done, "published": kept}


HARD = {"strike", "attack", "explosion", "clash", "interception"}


def severity_of(r) -> str:
    """Critical: violence with video that is first-hand or a party's own
    claim — the footage the owner wants to see first. Everything else that
    reached the map is significant."""
    if (r["event_type"] in HARD and r["media"] == "video"
            and (r["first_hand"] or (r["role"] == "official" and r["claim"]))):
        return "critical"
    return "significant"


def as_surface_items(hours: int = 24) -> list[dict]:
    """Published posts in the shape of a surface-pool item, so Home, Inbox,
    Newest critical and briefings treat them as signals like any other."""
    try:
        from location_extract import country_name_from_code
    except Exception:
        country_name_from_code = lambda c: None  # noqa: E731
    out = []
    # Statements reach the Inbox and Home as signals, without a position
    # anything could draw (the place they name is kept as cite_lat/lon).
    for st in statements(hours):
        out.append({
            **st, "type": "telegram", "source_type": "telegram_statement",
            "source": st["channel_title"] or st["channel"], "context": st.get("summary_en") or "",
            "location": st["place"], "location_country": country_name_from_code(st["country_code"] or "") or None,
            "published_at": st["posted_at"], "confidence": 0.6, "lat": None, "lon": None,
            "severity_tier": "critical" if st["important"] else "moderate",
        })
    for p in published(hours):
        out.append({
            **p,
            "id": p["id"], "type": "telegram", "source_type": "telegram",
            "source": p["channel_title"] or p["channel"],
            "headline": p["headline"], "context": p.get("summary_en") or "",
            "location": p["place"], "location_country": country_name_from_code(p["country_code"] or "") or None,
            "published_at": p["posted_at"], "confidence": 0.6 if p["role"] == "official" else 0.5,
        })
    return out


def prefetch_videos(limit: int = 15) -> int:
    """Download the videos of newly published posts so they play at once
    when opened, instead of after a fetch from Telegram on first click."""
    con = _con()
    rows = con.execute("SELECT channel, msg_id FROM telegram_posts WHERE lat IS NOT NULL AND media='video'"
                       " ORDER BY posted_at DESC LIMIT 40").fetchall()
    con.close()
    got = 0
    for chan, mid in rows:
        if chan.startswith("c/") or os.path.exists(os.path.join(MEDIA_DIR, f"{chan}_{mid}.mp4")):
            continue
        try:
            path, _ = video_path(chan, mid)
            got += int(bool(path))
        except Exception as e:
            print(f"[telegram] video prefetch {chan}/{mid} failed: {type(e).__name__}: {e}", flush=True)
        if got >= limit:
            break
    return got


def published(hours: int = 72) -> list[dict]:
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=hours)).isoformat()
    con = _con()
    con.row_factory = sqlite3.Row
    # A party's own claim is a STATEMENT, not a pin (statements()): an
    # official channel's "we struck X" is cited and notified, never drawn as
    # if someone on the ground had filmed it.
    rows = con.execute("SELECT * FROM telegram_posts WHERE lat IS NOT NULL AND posted_at >= ?"
                       " AND NOT (role = 'official' AND claim = 1) ORDER BY posted_at DESC",
                       (cutoff,)).fetchall()
    con.close()
    out, seen = [], {}
    for r in rows:
        chan = r["channel"]
        # ONE EVENT, ONE PIN. Channels post a claim as several messages and
        # others repost it; the same headline at the same place on the same
        # day is one event, shown once, with who else carried it.
        key = ((r["headline"] or "").strip().lower(), round(r["lat"], 2), round(r["lon"], 2), r["posted_at"][:10])
        if key in seen:
            first = seen[key]
            label = r["channel_title"] or chan
            if label != first["channel_title"] and label not in first["also_reported_by"]:
                first["also_reported_by"].append(label)
            if not first["thumb_url"] and r["thumb"]:
                first["thumb_url"] = f"/api/telegram/media/{r['thumb']}"
            continue
        out.append({
            "id": f"tg-{chan}-{r['msg_id']}", "headline": r["headline"], "text": r["text"],
            "channel": chan, "channel_title": r["channel_title"], "posted_at": r["posted_at"],
            "event_type": r["event_type"], "place": r["place"], "precision": r["precision"],
            "country_code": r["country_code"], "lat": r["lat"], "lon": r["lon"], "geocoded_as": r["geocoded_as"],
            "media": r["media"], "thumb_url": f"/api/telegram/media/{r['thumb']}" if r["thumb"] else None,
            "url": None if chan.startswith("c/") else f"https://t.me/{chan}/{r['msg_id']}",
            "also_reported_by": [],
            "views": r["views"], "lang": r["lang"], "summary_en": r["summary_en"],
            "role": r["role"], "party": r["party"], "claim": bool(r["claim"]),
            "first_hand": bool(r["first_hand"]), "msg_id": r["msg_id"],
            "severity_tier": severity_of(r),
            "verification": (f"{r['party']} — " if r["party"] and r["role"] == "official" else "")
                            + ROLE_LABEL.get(r["role"] or "aggregator", ROLE_LABEL["aggregator"]),
        })
        seen[key] = out[-1]
    return out


# Worth interrupting for: a party claiming it struck, attacked, intercepted
# or seized something — "IDF announces strikes on Gaza". Repelled advances,
# movements and condemnations go to the Inbox only.
IMPORTANT = {"strike", "attack", "interception", "explosion", "seizure"}


def statements(hours: int = 72) -> list[dict]:
    """Official channels' own claims: the IDF announcing strikes, the
    Houthi spokesman claiming a missile attack, the RSF claiming a town.
    Never map pins. They go to the Inbox and are cited on events near what
    they name; one that claims an attack or a strike is `important` and
    raises a notification."""
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=hours)).isoformat()
    con = _con()
    con.row_factory = sqlite3.Row
    rows = con.execute("SELECT * FROM telegram_posts WHERE role='official' AND claim=1 AND relevant=1"
                       " AND posted_at >= ? ORDER BY posted_at DESC", (cutoff,)).fetchall()
    con.close()
    out, seen = [], set()
    for r in rows:
        key = ((r["headline"] or "").strip().lower(), r["channel"], r["posted_at"][:10])
        if key in seen:
            continue
        seen.add(key)
        chan = r["channel"]
        out.append({
            "id": f"tgs-{chan}-{r['msg_id']}", "statement": True,
            "headline": r["headline"], "text": r["text"], "summary_en": r["summary_en"],
            "channel": chan, "channel_title": r["channel_title"], "party": r["party"],
            "posted_at": r["posted_at"], "event_type": r["event_type"], "place": r["place"],
            "country_code": r["country_code"], "cite_lat": r["lat"], "cite_lon": r["lon"],
            "media": r["media"], "thumb_url": f"/api/telegram/media/{r['thumb']}" if r["thumb"] else None,
            "url": None if chan.startswith("c/") else f"https://t.me/{chan}/{r['msg_id']}",
            "important": (r["event_type"] or "") in IMPORTANT, "msg_id": r["msg_id"], "lang": r["lang"],
            "verification": f"{r['party'] or r['channel_title']} — official statement, the party's own claim",
        })
    return out


def statements_near(lat: float, lon: float, hours: int = 72, km: float = 75, country: str | None = None) -> list[dict]:
    """Statements about a place: located within `km`, or naming the same
    country when they could not be placed more precisely."""
    import math
    def dist(a, b, c, d):
        p1, p2 = math.radians(a), math.radians(c)
        h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(d - b) / 2) ** 2
        return 12742 * math.asin(math.sqrt(h))
    # Most claims name a region ("near Bab al-Mandab, Yemen"), not a point:
    # those match on the country — given, or the one the point lies in.
    try:
        from location_extract import country_name_from_code
    except Exception:
        country_name_from_code = lambda c: None  # noqa: E731
    land = None
    if not country:
        try:
            from geo_land import country_at
            land = (country_at(lat, lon) or "").lower() or None
        except Exception:
            land = None

    def same_country(cc):
        if not cc:
            return False
        if country:
            return cc.lower() == country.lower()
        return bool(land) and (country_name_from_code(cc) or "").lower() == land

    out = []
    for s in statements(hours):
        if s["cite_lat"] is not None and dist(lat, lon, s["cite_lat"], s["cite_lon"]) <= km:
            out.append({**s, "km": round(dist(lat, lon, s["cite_lat"], s["cite_lon"]))})
        elif s["cite_lat"] is None and same_country(s["country_code"]):
            out.append({**s, "km": None})
    return out


def stats() -> dict:
    con = _con()
    q = lambda sql: con.execute(sql).fetchone()[0]
    out = {"configured": configured(), "logged_in": logged_in(),
           "posts": q("SELECT COUNT(*) FROM telegram_posts"),
           "classified": q("SELECT COUNT(*) FROM telegram_posts WHERE classified=1"),
           "relevant": q("SELECT COUNT(*) FROM telegram_posts WHERE relevant=1"),
           "published": q("SELECT COUNT(*) FROM telegram_posts WHERE lat IS NOT NULL"),
           "channels": q("SELECT COUNT(DISTINCT channel) FROM telegram_posts"),
           "unpublished_reasons": dict(con.execute(
               "SELECT unpublished_reason, COUNT(*) FROM telegram_posts WHERE relevant=1 AND lat IS NULL"
               " GROUP BY unpublished_reason ORDER BY 2 DESC LIMIT 8").fetchall())}
    con.close()
    return out


import threading
# One Telethon session file, used by the live loop and by video fetches:
# never two clients on it at once (its SQLite would lock).
_SESSION_LOCK = threading.Lock()
VIDEO_MAX_MB = 80


def run_once(hours: int = 6) -> dict:
    if not (configured() and logged_in()):
        return {"skipped": "not configured or not logged in"}
    with _SESSION_LOCK:
        new = asyncio.run(_collect(hours))
    out = {"collected": new, **classify()}
    out["videos"] = prefetch_videos()
    return out


async def _download_video(chan: str, msg_id: int, path: str) -> str | None:
    client = await _connected()
    try:
        m = await client.get_messages(chan, ids=msg_id)
        if not m or not m.file or not (m.file.mime_type or "").startswith("video"):
            return None
        if (m.file.size or 0) > VIDEO_MAX_MB * 1024 * 1024:
            return None
        return await client.download_media(m, file=path)
    finally:
        await client.disconnect()


def video_path(chan: str, msg_id: int) -> tuple[str | None, str | None]:
    """The post's video as a local file, fetched once and kept. (path, None)
    or (None, reason). Telegram's embed refuses large videos ("Media is too
    big"), so the console plays its own copy instead."""
    if chan.startswith("c/"):
        return None, "private channel"
    os.makedirs(MEDIA_DIR, exist_ok=True)
    path = os.path.join(MEDIA_DIR, f"{chan}_{msg_id}.mp4")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path, None
    with _SESSION_LOCK:
        got = asyncio.run(_download_video(chan, msg_id, path))
    return (got, None) if got else (None, f"no video, or larger than {VIDEO_MAX_MB} MB")


async def _login():
    async with _client() as client:          # interactive on purpose: a person is at the terminal          # prompts for phone and code on first run
        me = await client.get_me()
        n = 0
        async for d in client.iter_dialogs():
            n += int(bool(d.is_channel and getattr(d.entity, "broadcast", False)))
        print(f"Logged in as {me.first_name}. {n} channels joined.")


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(HERE, ".env"))
    except Exception:
        pass
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "login":
        asyncio.run(_login())
    else:
        t = time.time()
        print(run_once(), f"{time.time()-t:.0f}s")
        print(stats())
