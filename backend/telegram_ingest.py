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
import re
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
from paths import DATA_DIR as _DATA_DIR
TG_DIR = os.path.join(str(_DATA_DIR), "telegram")  # the login session: losing it means logging in again
MEDIA_DIR = os.path.join(TG_DIR, "media")
VIDEO_MAX_MB = 80
# Videos are not kept on this machine (the owner, 2026-10-06: long-term
# media belongs on the server). One is fetched from Telegram when opened,
# into the system temp dir, and gone half an hour later — long enough for
# the player's range requests and a replay, not an archive.
#
# On the server, TELEGRAM_VIDEO_STORE=volume keeps them on the data volume
# instead — the long-term archive — pruned by age and total size
# (TELEGRAM_VIDEO_KEEP_DAYS, default 90; TELEGRAM_VIDEO_KEEP_MB, default 20 GB).
VIDEO_STORE = os.getenv("TELEGRAM_VIDEO_STORE", "temp").strip().lower()
if VIDEO_STORE == "volume":
    VIDEO_DIR = os.path.join(TG_DIR, "video")
    VIDEO_KEEP_DAYS = float(os.getenv("TELEGRAM_VIDEO_KEEP_DAYS", "90"))
    VIDEO_KEEP_MB = float(os.getenv("TELEGRAM_VIDEO_KEEP_MB", "20000"))
else:
    VIDEO_DIR = os.path.join(__import__("tempfile").gettempdir(), "parallax-telegram-video")
    VIDEO_KEEP_DAYS = 30 / (24 * 60)
    VIDEO_KEEP_MB = 300
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
                 "first_hand": "INTEGER", "graphic": "INTEGER", "graphic_score": "REAL",
                 "announce_checked": "INTEGER", "announce_what": "TEXT", "announce_cause": "TEXT",
                 "announce_at": "TEXT", "announce_place": "TEXT", "announce_lat": "REAL", "announce_lon": "REAL",
                 "announce_country": "TEXT"}

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
    from geocode_utils import geocode_place, prefer_settlement
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
            hits = prefer_settlement(hits)
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
            # Unrest is published too, as its own category the map can show
            # or hide (the owner, 2026-10-07: riots and civil unrest belong in
            # the system, separable by a toggle). Same rules as fighting:
            # a precise place, and footage first-hand from reposting channels.
            kinetic = (x.get("event_type") or "other") in KINETIC or x.get("event_type") == "unrest"
            if rel and not kinetic:
                hit, why = None, f"not a kinetic event ({x.get('event_type') or 'other'})"
            # TEXT REPORTS AND RECAPS COUNT TOO (the owner, 2026-10-07: "as many
            # interesting Telegram signals as possible"). A reposting channel's
            # text-only post or a recap was dropped; 287 of 524 such posts in
            # two days named a precise place. They are published when the
            # place is precise — the same rule as everything else — and say
            # what they are (no footage; a relay, not first-hand).
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


# ── Sensitive content ───────────────────────────────────────────────────────
# Footage of dead or injured people is shown behind a warning (the owner,
# 2026-10-06). Two readings, either is enough — a warning shown in error
# costs a click, one missed shows someone a body:
#   what the post SAYS: killed, bodies, massacre, injured …
#   what the picture SHOWS: OpenAI's moderation model (free, not counted
#     against the cap) scoring text and thumbnail together for graphic
#     violence. It sees one frame, not the video, and scores a wrapped
#     child's body at 0.2 — so the bar is low.
GRAPHIC_WORDS = re.compile(
    r"\b(dead|death|deaths|died|kill(?:ed|ing|s)?|bod(?:y|ies)|corpses?|remains|martyr\w*|massacre\w*|"
    r"exterminat\w*|execut(?:ed|ion|ions)|behead\w*|slaughter\w*|wounded|injur(?:ed|ies|es)|"
    r"casualt(?:y|ies)|assassinat\w*|blood\w*|mutilat\w*|charred)\b", re.I)
GRAPHIC_SCORE = 0.10


def graphic_by_words(*texts: str | None) -> bool:
    return bool(GRAPHIC_WORDS.search(" ".join(t or "" for t in texts)))


def _moderation_score(client, text: str, thumb_path: str | None) -> float | None:
    import base64
    parts = [{"type": "text", "text": text[:2000] or "-"}]
    if thumb_path and os.path.exists(thumb_path):
        with open(thumb_path, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode()
        parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
    try:
        r = client.moderations.create(model="omni-moderation-latest", input=parts)
        return float(r.results[0].category_scores.violence_graphic or 0.0)
    except Exception as e:
        print(f"[telegram] moderation failed: {type(e).__name__}: {e}", flush=True)
        return None


def screen_graphic(limit: int = 80, days: int = 7) -> int:
    """Set `graphic` on recent posts with media that have not been screened."""
    import openai_gate
    client = openai_gate.get_client(openai_gate.ENRICH)
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=days)).isoformat()
    con = _con()
    rows = con.execute("SELECT channel, msg_id, headline, summary_en, text, thumb FROM telegram_posts"
                       " WHERE graphic IS NULL AND classified=1 AND media IN ('photo','video') AND posted_at >= ?"
                       " ORDER BY posted_at DESC LIMIT ?", (cutoff, limit)).fetchall()
    n = 0
    for chan, mid, head, summ, text, thumb in rows:
        words = graphic_by_words(head, summ)
        score = None
        if client is not None:
            score = _moderation_score(client, f"{head or ''}\n{summ or ''}\n{(text or '')[:1200]}",
                                      os.path.join(MEDIA_DIR, thumb) if thumb else None)
        if score is None and client is not None and not words:
            continue        # try again next pass rather than call it safe
        flag = words or (score is not None and score >= GRAPHIC_SCORE)
        con.execute("UPDATE telegram_posts SET graphic=?, graphic_score=? WHERE channel=? AND msg_id=?",
                    (int(flag), score, chan, mid))
        n += 1
    con.commit()
    con.close()
    return n


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
    # Announced gatherings are forward signals: at the place, dated by when
    # they were announced, saying when they start.
    for a in upcoming():
        out.append({
            **a, "type": "telegram", "source_type": "telegram_announcement",
            "source": a["channel_title"] or a["channel"],
            "context": " · ".join(x for x in (a["cause"], a.get("summary_en")) if x),
            "location": a["place"], "location_country": country_name_from_code(a["country_code"] or "") or None,
            "published_at": a["posted_at"], "confidence": 0.5, "severity_tier": "moderate",
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


def prune_videos(keep_days: float = VIDEO_KEEP_DAYS, keep_mb: float = VIDEO_KEEP_MB, now: float | None = None) -> int:
    """Videos are a short-lived cache: video_path() fetches any of them again
    on demand. Prefetching kept every one (1 GB in two days filled the disk
    on 2026-10-06), so: none older than keep_days, and the newest under
    keep_mb in total. Thumbnails stay — they are small and the record."""
    import time
    now = now or time.time()
    try:
        vids = [(e.path, e.stat()) for e in os.scandir(VIDEO_DIR) if e.name.endswith(".mp4")]
    except FileNotFoundError:
        return 0
    vids.sort(key=lambda v: -v[1].st_mtime)
    gone, total = 0, 0
    for path, st in vids:
        total += st.st_size
        if now - st.st_mtime > keep_days * 86400 or total > keep_mb * 1024 * 1024:
            try:
                os.remove(path)
                gone += 1
            except OSError:
                pass
    return gone


def prefetch_videos(limit: int = 15) -> int:
    """Download the videos of newly published posts so they play at once
    when opened, instead of after a fetch from Telegram on first click."""
    con = _con()
    rows = con.execute("SELECT channel, msg_id FROM telegram_posts WHERE lat IS NOT NULL AND media='video'"
                       " ORDER BY posted_at DESC LIMIT 40").fetchall()
    con.close()
    got = 0
    for chan, mid in rows:
        if os.path.exists(_video_file(chan, mid)):
            continue
        try:
            path, _ = video_path(chan, mid)
            got += int(bool(path))
        except Exception as e:
            print(f"[telegram] video prefetch {chan}/{mid} failed: {type(e).__name__}: {e}", flush=True)
        if got >= limit:
            break
    return got


# ── Announced: what a post says WILL happen ─────────────────────────────────
# Some channels are read for what is coming, not what happened (the owner,
# 2026-10-06: a gilets jaunes channel saying "tomorrow 11:00, demonstration
# at République" is a signal). A second, cheap pass reads posts that name a
# day or a time and keeps those announcing a public gathering or collective
# action at a place — with when (resolved against the post's own date) and
# where (geocoded by the same rule as every pin).
ANNOUNCE_CUES = re.compile(
    r"(demain|ce soir|aujourd.hui|samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi|rdv|rendez.vous|rassemblement|"
    r"manif|appel|grève|blocage|cortège|tomorrow|tonight|saturday|sunday|monday|tuesday|wednesday|thursday|friday|"
    r"rally|march|protest|strike|blockade|vigil|morgen|heute|samstag|sonntag|montag|dienstag|mittwoch|donnerstag|"
    r"freitag|uhr|kundgebung|demo|mahnwache|aufzug|streik|📅|🕓|📍|\b\d{1,2}[:h]\d{2}\b|\b\d{1,2}\.\d{1,2}\.)", re.I)

ANNOUNCE_SYSTEM = """You read Telegram posts for announcements of FUTURE public gatherings or
collective actions: demonstrations, marches, rallies, vigils, strikes, blockades, occupations.
Each post is prefixed with the date it was posted.
An announcement names something that has NOT happened yet when posted, with a place and a day.
NOT announcements: reports of something happening or that happened, livestreams or videos of past
events, commentary, calls with no place or no day. A post whose date is the posting day and that
describes the crowd, the clashes or the turnout is a REPORT, not an announcement. Meetings,
speeches, trainings and construction works are not gatherings.
For each numbered post return an object in "results" (same order):
  announced: true or false
  what: 2-5 English words, e.g. "protest march", "student strike", "road blockade"
  cause: what it is about, under 10 English words, or ""
  starts_at: when it starts, local time at the place, "YYYY-MM-DDTHH:MM", or "YYYY-MM-DD" if no hour
    is given. Resolve "tomorrow", "Saturday", "demain", "morgen" against the posting date.
  place: the most precise place named, "Place, City, Country" in English; "" if none
  precision: site | street | district | city | region | country | none
  country_code: ISO 3166-1 alpha-2, lowercase, or ""
Return JSON {"results": [...]}."""


def _announce_pass(client, model, rows):
    numbered = "\n\n".join(f"{i+1}. [posted {r[2][:10]} ({_weekday(r[2])}) | {r[1] or r[0]}] {(r[3] or '')[:900]}"
                             for i, r in enumerate(rows))
    resp = client.chat.completions.create(
        model=model, temperature=0, max_tokens=2000, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": ANNOUNCE_SYSTEM}, {"role": "user", "content": numbered}])
    u = getattr(resp, "usage", None)
    if u:
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=u.prompt_tokens, output_tokens=u.completion_tokens,
                                      call_type="telegram", model=model, headline=f"announcements · {len(rows)} posts")
        except Exception:
            pass
    return json.loads(resp.choices[0].message.content or "{}").get("results") or []


def _weekday(iso: str) -> str:
    try:
        return _dt.date.fromisoformat(iso[:10]).strftime("%A")
    except ValueError:
        return "?"


def parse_start(s: str | None, posted_at: str) -> str | None:
    """A model's start time, kept only if it is a real date not before the
    post's own day (an announcement is of something to come)."""
    s = (s or "").strip()
    try:
        when = _dt.datetime.fromisoformat(s) if "T" in s else _dt.datetime.fromisoformat(s + "T00:00")
    except ValueError:
        return None
    try:
        posted = _dt.date.fromisoformat(posted_at[:10])
    except ValueError:
        return None
    if when.date() < posted or when.date() > posted + _dt.timedelta(days=120):
        return None
    return when.strftime("%Y-%m-%dT%H:%M") if "T" in s else when.strftime("%Y-%m-%d")


GATHERING = re.compile(r"(protest|demonstrat|march|rally|vigil|strike|blockade|occupation|gathering|sit-in|"
                       r"walkout|boycott|procession|commemorat|riot|mahnwache|kundgebung|manif|rassemblement)", re.I)


def is_announcement(what: str | None, start: str | None, posted_at: str) -> bool:
    """The model proposes; this decides. A gathering or collective action,
    starting after the post was written — the model reads "thousands rally
    in Paris" posted that day, or a livestream of last night's vigil, as an
    announcement often enough that the date has to be checked in code."""
    if not start or not GATHERING.search(what or ""):
        return False
    try:
        posted = _dt.datetime.fromisoformat(posted_at.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return False
    if "T" in start:
        # Local time at the place against UTC posting time: 90 minutes' slack.
        return _dt.datetime.fromisoformat(start) > posted - _dt.timedelta(minutes=90)
    return _dt.date.fromisoformat(start) > posted.date()


def read_announcements(limit: int = 90, days: int = 7) -> dict:
    import openai_gate
    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None:
        return {"announcements": "no model"}
    model = openai_gate.model_for(openai_gate.ENRICH)
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=days)).isoformat()
    con = _con()
    cand = con.execute("SELECT channel, channel_title, posted_at, text, msg_id FROM telegram_posts"
                       " WHERE announce_checked IS NULL AND posted_at >= ? AND text IS NOT NULL AND length(text) > 40"
                       " ORDER BY posted_at DESC LIMIT ?", (cutoff, limit * 4)).fetchall()
    skip = [r for r in cand if not ANNOUNCE_CUES.search(r[3] or "")]
    con.executemany("UPDATE telegram_posts SET announce_checked=1 WHERE channel=? AND msg_id=?", [(r[0], r[4]) for r in skip])
    rows = [r for r in cand if ANNOUNCE_CUES.search(r[3] or "")][:limit]
    found = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        try:
            res = _announce_pass(client, model, chunk)
        except Exception as e:
            print(f"[telegram] announcement pass failed: {type(e).__name__}: {e}", flush=True)
            continue
        for r, x in zip(chunk, res):
            x = x or {}
            start = parse_start(x.get("starts_at"), r[2]) if x.get("announced") else None
            if start and not is_announcement(x.get("what"), start, r[2]):
                start = None
            hit = None
            if start:
                hit, _why = locate(x.get("place"), x.get("precision"), x.get("country_code"))
            con.execute("UPDATE telegram_posts SET announce_checked=1, announce_what=?, announce_cause=?, announce_at=?,"
                        " announce_place=?, announce_lat=?, announce_lon=?, announce_country=? WHERE channel=? AND msg_id=?",
                        ((x.get("what") or "")[:60] if hit else None, (x.get("cause") or "")[:120] if hit else None,
                         start if hit else None, x.get("place") if hit else None,
                         hit and hit["lat"], hit and hit["lon"], (x.get("country_code") or "").lower() if hit else None,
                         r[0], r[4]))
            found += int(bool(hit))
        con.commit()
    con.commit()
    con.close()
    return {"announcements_read": len(rows), "announced": found}


def _when_label(start: str) -> str:
    try:
        d = _dt.datetime.fromisoformat(start if "T" in start else start + "T00:00")
    except ValueError:
        return start
    day = d.strftime("%a %-d %b")
    return f"{day}, {d.strftime('%H:%M')}" if "T" in start else day


def upcoming(days_ahead: int = 30) -> list[dict]:
    """Announced gatherings that have not happened yet, soonest first; one
    per what, place and day however many channels carried it. Served from
    telegram_events (every place a post names); the one-per-post reading
    below is the fallback if that module fails."""
    try:
        import telegram_events
        return telegram_events.announcements(days_ahead)
    except Exception as e:                                      # noqa: BLE001
        print(f"[telegram] events unavailable, one-per-post fallback: {type(e).__name__}: {e}", flush=True)
    today = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")
    con = _con()
    con.row_factory = sqlite3.Row
    rows = con.execute("SELECT * FROM telegram_posts WHERE announce_at IS NOT NULL AND announce_lat IS NOT NULL"
                       " AND substr(announce_at,1,10) >= ? ORDER BY announce_at, posted_at", (today,)).fetchall()
    con.close()
    out, seen = [], {}
    horizon = (_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(days=days_ahead)).strftime("%Y-%m-%d")
    for r in rows:
        if r["announce_at"][:10] > horizon or not is_announcement(r["announce_what"], r["announce_at"], r["posted_at"]):
            continue
        key = ((r["announce_what"] or "").lower(), round(r["announce_lat"], 2), round(r["announce_lon"], 2), r["announce_at"][:10])
        label = r["channel_title"] or r["channel"]
        if key in seen:
            if label not in seen[key]["also_reported_by"] and label != seen[key]["channel_title"]:
                seen[key]["also_reported_by"].append(label)
            continue
        place = (r["announce_place"] or "").split(",")
        short = ", ".join(p.strip() for p in place[:2] if p.strip())
        what = (r["announce_what"] or "gathering").strip()
        out.append({
            "id": f"tga-{r['channel']}-{r['msg_id']}", "announcement": True,
            "headline": f"{what[:1].upper()}{what[1:]} announced: {short} — {_when_label(r['announce_at'])}",
            "what": what, "cause": r["announce_cause"] or "", "starts_at": r["announce_at"],
            "when_label": _when_label(r["announce_at"]),
            "place": r["announce_place"], "country_code": r["announce_country"],
            "lat": r["announce_lat"], "lon": r["announce_lon"],
            "channel": r["channel"], "channel_title": r["channel_title"], "msg_id": r["msg_id"],
            "posted_at": r["posted_at"], "text": r["text"], "summary_en": r["summary_en"], "lang": r["lang"],
            "url": None if r["channel"].startswith("c/") else f"https://t.me/{r['channel']}/{r['msg_id']}",
            "role": r["role"], "party": r["party"], "also_reported_by": [],
            "verification": "announced in advance — " + ROLE_LABEL.get(r["role"] or "aggregator", ROLE_LABEL["aggregator"]),
        })
        seen[key] = out[-1]
    return out


# What makes a post UNREST rather than police news: it names the act. The
# model's own "unrest" label also takes arrests, accidents and air-raid
# alerts, which are not what the unrest layer is for.
UNREST_WORDS = re.compile(
    r"\b(protest\w*|demonstrat\w*|riot\w*|unrest|rall(y|ies)|march(es|ed)?|blockade\w*|block(ed|ing) (the )?road|"
    r"clash\w* with (police|security)|tear ?gas|lbd|water cannon|police charge\w*|tumult|looting|uprising|"
    r"strike action|general strike|walkout|occupation of|sit-in|manif\w*|émeute\w*|kundgebung|krawall\w*|ausschreitung\w*)\b", re.I)


def is_unrest(r) -> bool:
    if r["event_type"] != "unrest":
        return False
    if r["announce_at"] and is_announcement(r["announce_what"], r["announce_at"], r["posted_at"]):
        return False            # shown as an announcement (upcoming), not as an event
    return bool(UNREST_WORDS.search(f"{r['headline'] or ''} {r['summary_en'] or ''}"))


def republish_dropped(hours: int = LOOKBACK_HOURS, limit: int = 60) -> int:
    """Posts dropped by the old footage and recap rules (before 2026-10-07)
    are placed now by the current rule: a precise place. A batch per pass —
    the geocoder takes one request a second."""
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=hours)).isoformat()
    con = _con()
    rows = con.execute("SELECT channel, msg_id, place, precision, country_code FROM telegram_posts"
                       " WHERE relevant=1 AND lat IS NULL AND posted_at >= ?"
                       " AND unpublished_reason IN ('no photo or video from a reposting channel', 'recap, not a first-hand account')"
                       " ORDER BY posted_at DESC LIMIT ?", (cutoff, limit)).fetchall()
    n = 0
    for chan, mid, place, prec, cc in rows:
        hit, why = locate(place, prec, cc)
        con.execute("UPDATE telegram_posts SET lat=?, lon=?, geocoded_as=?, unpublished_reason=? WHERE channel=? AND msg_id=?",
                    (hit and hit["lat"], hit and hit["lon"], hit and hit.get("display_name"), why, chan, mid))
        n += int(hit is not None)
    con.commit()
    con.close()
    return n


def publish_unrest_backlog(days: int = 7) -> int:
    """Posts screened before unrest was published: placed now, by the same rule."""
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=days)).isoformat()
    con = _con()
    rows = con.execute("SELECT channel, msg_id, place, precision, country_code, role, media, first_hand FROM telegram_posts"
                       " WHERE event_type='unrest' AND relevant=1 AND lat IS NULL AND posted_at >= ?"
                       " AND (unpublished_reason LIKE 'not a kinetic event%' OR unpublished_reason LIKE 'recap,%')", (cutoff,)).fetchall()
    n = 0
    for chan, mid, place, prec, cc, role, media, first_hand in rows:
        role = role or "aggregator"
        if role in ("aggregator", "partisan", "outlet") and (media or "none") == "none":
            why, hit = "no photo or video from a reposting channel", None
        else:
            hit, why = locate(place, prec, cc)
        con.execute("UPDATE telegram_posts SET lat=?, lon=?, geocoded_as=?, unpublished_reason=? WHERE channel=? AND msg_id=?",
                    (hit and hit["lat"], hit and hit["lon"], hit and hit.get("display_name"), why, chan, mid))
        n += int(hit is not None)
    con.commit()
    con.close()
    return n


def _is_graphic(r) -> bool:
    """Screened: what the screen said. Not yet: the words alone, so nothing
    is shown unwarned while it waits for its turn."""
    g = r["graphic"]
    return bool(g) if g is not None else graphic_by_words(r["headline"], r["summary_en"])


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
        lat, lon = r["lat"], r["lon"]
        if r["event_type"] == "unrest" and not is_unrest(r):
            continue
        # ONE EVENT, ONE PIN. Channels post a claim as several messages and
        # others repost it; the same headline at the same place on the same
        # day is one event, shown once, with who else carried it.
        key = ((r["headline"] or "").strip().lower(), round(lat, 2), round(lon, 2), r["posted_at"][:10])
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
            "country_code": r["country_code"], "lat": lat, "lon": lon, "geocoded_as": r["geocoded_as"],
            "media": r["media"], "thumb_url": f"/api/telegram/media/{r['thumb']}" if r["thumb"] else None,
            "url": None if chan.startswith("c/") else f"https://t.me/{chan}/{r['msg_id']}",
            "also_reported_by": [],
            "views": r["views"], "lang": r["lang"], "summary_en": r["summary_en"],
            "role": r["role"], "party": r["party"], "claim": bool(r["claim"]),
            "first_hand": bool(r["first_hand"]), "msg_id": r["msg_id"],
            "severity_tier": severity_of(r),
            "graphic": _is_graphic(r),
            "category": "unrest" if r["event_type"] == "unrest" else "conflict",
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
            "graphic": _is_graphic(r), "media": r["media"], "thumb_url": f"/api/telegram/media/{r['thumb']}" if r["thumb"] else None,
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


_LAST_FULL = {"at": 0.0}
FULL_EVERY_S = 30 * 60


def run_once(hours: int = 6) -> dict:
    """One pass. Every minute the last six hours; every half hour, and on
    the first pass, the whole LOOKBACK_HOURS (48) — a server that starts
    empty, or misses an hour, would otherwise never have the day before."""
    if not (configured() and logged_in()):
        return {"skipped": "not configured or not logged in"}
    full = time.time() - _LAST_FULL["at"] > FULL_EVERY_S
    with _SESSION_LOCK:
        new = asyncio.run(_collect(LOOKBACK_HOURS if full else hours))
    if full:
        _LAST_FULL["at"] = time.time()
    out = {"collected": new, "full_pass": full, **classify()}
    out["republished"] = republish_dropped()
    out["screened"] = screen_graphic()
    # Announced events (one per place, with reminders' times) and live
    # developments: telegram_events.py. read_announcements below is the
    # first, one-per-post reading, kept for its tests and history.
    import telegram_events
    out.update(telegram_events.run_once())
    # The mood per country (telegram_sentiment.py): each post rated once.
    try:
        import telegram_sentiment
        out.update(telegram_sentiment.read_mood())
    except Exception as e:                                      # noqa: BLE001
        print(f"[telegram] mood pass failed: {type(e).__name__}: {e}", flush=True)
    # Prefetched only where videos are kept (the server's volume), so the
    # newest play the moment they are opened; on a laptop a video is fetched
    # when opened and gone half an hour later (the owner, 2026-10-06).
    if VIDEO_STORE == "volume":
        out["videos_prefetched"] = prefetch_videos()
    out["videos_pruned"] = prune_videos()
    return out


def _peer(chan: str):
    """A channel as Telethon addresses it: its username, or — for a channel
    without one ("c/<id>", as _collect names it) — its numeric id, which the
    session knows because the account is a member."""
    if chan.startswith("c/"):
        from telethon.tl.types import PeerChannel
        return PeerChannel(int(chan[2:]))
    return chan


def _video_file(chan: str, msg_id: int) -> str:
    return os.path.join(VIDEO_DIR, f"{chan.replace('/', '_')}_{msg_id}.mp4")


async def _download_video(chan: str, msg_id: int, path: str) -> str | None:
    client = await _connected()
    try:
        m = await client.get_messages(_peer(chan), ids=msg_id)
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
    os.makedirs(VIDEO_DIR, exist_ok=True)
    prune_videos()
    path = _video_file(chan, msg_id)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        os.utime(path)                       # still being watched: keep it a while
        return path, None
    with _SESSION_LOCK:
        got = asyncio.run(_download_video(chan, msg_id, path))
    return (got, None) if got else (None, f"no video, or larger than {VIDEO_MAX_MB} MB")


# ── signing in from the console ────────────────────────────────────────────
# The server has no terminal to answer Telegram's prompts, so a super admin
# signs the account in from Settings: a phone number, then the code Telegram
# sends to that account's app (and its password, if two-step verification is
# on). The session lands in SESSION on the data volume, like a terminal
# login's; collection picks it up on its next pass.
_PENDING: dict = {}          # {"phone": str, "hash": str, "at": float}


def _run(coro):
    with _SESSION_LOCK:
        return asyncio.run(coro)


async def _authorised_name() -> str | None:
    client = _client()
    await client.connect()
    try:
        if not await client.is_user_authorized():
            return None
        me = await client.get_me()
        return " ".join(x for x in (me.first_name, me.last_name) if x) or me.username or "signed in"
    finally:
        await client.disconnect()


def login_status() -> dict:
    if not configured():
        return {"configured": False, "signed_in": False}
    try:
        name = _run(_authorised_name()) if logged_in() else None
    except Exception as e:                                   # noqa: BLE001
        return {"configured": True, "signed_in": False, "error": f"{type(e).__name__}: {e}"}
    return {"configured": True, "signed_in": bool(name), "account": name,
            "awaiting_code": bool(_PENDING) and time.time() - _PENDING.get("at", 0) < 600}


def login_start(phone: str) -> dict:
    """Ask Telegram to send a sign-in code to the account's app."""
    if not configured():
        return {"ok": False, "error": "TELEGRAM_API_ID and TELEGRAM_API_HASH are not set on this server"}
    phone = re.sub(r"[^\d+]", "", phone or "")
    if len(phone) < 8:
        return {"ok": False, "error": "a phone number in international form, e.g. +4917612345678"}

    async def go():
        client = _client()
        await client.connect()
        try:
            sent = await client.send_code_request(phone)
            return sent.phone_code_hash
        finally:
            await client.disconnect()
    try:
        h = _run(go())
    except Exception as e:                                   # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    _PENDING.clear()
    _PENDING.update({"phone": phone, "hash": h, "at": time.time()})
    return {"ok": True, "sent": True}


def login_code(code: str, password: str | None = None) -> dict:
    """Finish signing in with the code (and the two-step password, if asked)."""
    if not _PENDING or time.time() - _PENDING.get("at", 0) > 600:
        return {"ok": False, "error": "no code was requested in the last ten minutes — start again"}
    from telethon.errors import SessionPasswordNeededError, PhoneCodeInvalidError, PhoneCodeExpiredError, PasswordHashInvalidError

    async def go():
        client = _client()
        await client.connect()
        try:
            try:
                await client.sign_in(_PENDING["phone"], (code or "").strip(), phone_code_hash=_PENDING["hash"])
            except SessionPasswordNeededError:
                if not password:
                    return {"ok": False, "need_password": True}
                await client.sign_in(password=password)
            me = await client.get_me()
            return {"ok": True, "account": " ".join(x for x in (me.first_name, me.last_name) if x) or me.username}
        finally:
            await client.disconnect()
    try:
        out = _run(go())
    except PhoneCodeInvalidError:
        return {"ok": False, "error": "that code is not right"}
    except PhoneCodeExpiredError:
        _PENDING.clear()
        return {"ok": False, "error": "the code expired — start again"}
    except PasswordHashInvalidError:
        return {"ok": False, "need_password": True, "error": "that password is not right"}
    except Exception as e:                                   # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    if out.get("ok"):
        _PENDING.clear()
    return out


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
