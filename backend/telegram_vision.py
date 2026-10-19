"""
telegram_vision.py — what a Telegram photo or video SHOWS, as a signal.

THE OWNER (2026-10-19): "not captivating enough images and videos from
Telegram (even if they are private messages) in order to generate signals.
We have the OpenAI API, which should be able to understand certain things,
so make use of it." On that day 1,551 of 5,268 posts in 24 h carried a photo
or a video; nothing ever looked at one. A group member's bare video of
police charging a crowd ("", "Partagez", "Venez nombreux") was screened as
chatter because its words said nothing.

THE MODEL EXTRACTS, THE CODE DECIDES. The vision model (VISION_MODEL) is
given the picture (a photo, or three frames of a video) and the post's words
as context, and returns only what is visible, as JSON (EXTRACT_SYSTEM):
crowd and its size, police and what they do, soldiers and vehicles, fire,
smoke, damage, weapons, signs and landmarks, time of day. Whether that is an
event, which kind, and where, is decided here in code (decide()), with
thresholds anyone can read; a place becomes coordinates only through
telegram_ingest.locate (a settlement or site inside the right country). The
model's answer and the decision are kept on the post (vision_json,
vision_decision) so every signal can be audited back to what was seen.

THE SAME PIPELINE AS TEXT. A post the picture turns into an event is
written to telegram_posts like the text reading (relevant, event_type,
headline, lat/lon), so the map, the Desk, the surface pool and the
notifications take it as they take any other — with the media on it
(telegram_ingest.media_urls).

BUDGETED. Per hour and per day caps (PER_HOUR, PER_DAY), a dollar cap per
day (USD_PER_DAY), at most VIDEOS_PER_HOUR videos opened for frames; the
same picture is read once (its hash: forwards and reposts reuse the
reading); posts are taken by priority (priority()): chats with a street
cue, countries with active protests or calls, local and group sources,
words of an event — not channels' stock photos. All counts survive a
restart (they are read from the table).

OFF THE EVENT LOOP. main._telegram_vision_loop runs run_once() on a
one-thread pool of its own, never on a request path or the shared executor.
"""
from __future__ import annotations

import base64
import datetime as _dt
import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile

ENABLED = os.getenv("TG_VISION", "1").strip() != "0"
VISION_MODEL = (os.getenv("TG_VISION_MODEL") or "gpt-4.1-mini").strip()
PER_HOUR = int(os.getenv("TG_VISION_PER_HOUR", "15"))
PER_DAY = int(os.getenv("TG_VISION_PER_DAY", "200"))
USD_PER_DAY = float(os.getenv("TG_VISION_USD_DAY", "0.25"))
VIDEOS_PER_HOUR = int(os.getenv("TG_VISION_VIDEOS_PER_HOUR", "4"))
PER_PASS = 6                  # model calls a pass (a pass a minute)
WINDOW_H = 6                  # how far back a picture is still worth reading
MIN_PRIORITY = 3
VIDEO_PRIORITY = 5            # a video is opened for frames only this high
MAX_SIDE = 768                # pixels: what the model is sent (cost), not what is kept
FRAMES = (0.15, 0.5, 0.85)    # where in a video the frames are taken
MIN_CONFIDENCE = 0.45
PLACE_CONFIDENCE = 0.6        # a place read from a landmark or a sign needs more
CROWD_MIN = 50                # people, for a crowd alone to be a gathering

STATUS = {"enabled": ENABLED, "model": VISION_MODEL, "processed": 0, "signals": 0, "enriched": 0,
          "skipped_duplicate": 0, "skipped_low_priority": 0, "skipped_budget": 0, "failed": 0,
          "last_error": None, "last_run": None, "last_signal": None}

NOT_EVENTS = {"screenshot", "meme", "map", "document", "portrait", "graphic_design", "advert"}
POLICE_ACTIONS = {"tear_gas", "water_cannon", "charge", "kettle", "arrests", "batons", "firearms", "rubber_bullets"}
ACTION_WORDS = {"tear_gas": "tear gas", "water_cannon": "a water cannon", "charge": "a charge", "kettle": "kettling",
                "arrests": "arrests", "batons": "batons", "firearms": "firearms", "rubber_bullets": "rubber bullets"}

EXTRACT_SYSTEM = """You look at pictures from Telegram posts (one photo, or frames of one video) for a
security console, and describe ONLY what is visible. The post's own words are given as context:
use them to read signs or names you can see, never to add things you cannot see.
Return JSON:
{"scene": "one plain English sentence: what the picture shows",
 "content_kind": "footage" (a camera recording of a real scene) | "photo_of_event" | "screenshot" |
   "meme" | "map" | "document" | "portrait" | "graphic_design" | "advert" | "other",
 "crowd": {"present": bool, "estimate": integer number of people visible or null},
 "protest_signs": bool (banners, placards, flags carried by a crowd, yellow vests worn by a crowd),
 "police": {"present": bool, "actions": [any of "tear_gas", "water_cannon", "charge", "kettle",
   "arrests", "batons", "firearms", "rubber_bullets"]},
 "military": {"present": bool, "vehicles": [e.g. "tank", "apc", "truck", "artillery", "drone",
   "helicopter", "aircraft", "warship"]},
 "fire_smoke": bool, "explosion": bool (a blast or its fireball/shockwave visible),
 "damage": bool (destroyed or burnt buildings, vehicles or infrastructure),
 "weapons_visible": bool, "injured_or_dead": bool,
 "landmarks": ["named landmark you recognise with confidence, e.g. 'Arc de Triomphe'"],
 "signage_text": ["text visible on signs, street names, shop fronts, exactly as written"],
 "place_guess": "the most precise place the picture itself shows, 'Place, City, Country', or ''",
 "place_country": "ISO 3166-1 alpha-2 of that place, lowercase, or ''",
 "place_evidence": "what in the picture shows the place (landmark, sign), or '' if none",
 "time_of_day": "day" | "night" | "dusk_dawn" | "unknown",
 "confidence": 0.0-1.0 (how sure you are of this description)}
Never invent a place: place_guess stays '' unless a landmark or sign in the picture shows it."""


# ── what is worth looking at ────────────────────────────────────────────────

def priority(p: dict, active: set, hot: set) -> int:
    """How much a post's picture is worth a model call. Pure. p carries
    role, chat_kind, text, country_code, channel, lat, relevant, read_by,
    media, cc (the chat's country)."""
    role = p.get("role") or "aggregator"
    s = {"local": 3, "group": 3, "official": 2}.get(role, 1)
    if p.get("chat_kind") in ("group", "forum", "private"):
        s = max(s, 2)
    if words_of_event(p.get("text")):
        s += 2
    if p.get("channel") in hot:
        s += 2
    cc = (p.get("country_code") or p.get("cc") or "").lower()
    if cc and cc in active:
        s += 3
    if p.get("lat") is not None:
        s -= 2                 # already a signal: the picture would only confirm it
    if p.get("media") == "video":
        s += 1
    return s


def words_of_event(text: str | None) -> bool:
    t = text or ""
    try:
        import telegram_rules
        if telegram_rules.event_of(t)[0]:
            return True
    except Exception:                                          # noqa: BLE001
        pass
    try:
        import telegram_ingest
        return telegram_ingest.street_cue(t) or bool(telegram_ingest.UNREST_WORDS.search(t))
    except Exception:                                          # noqa: BLE001
        return False


def active_countries(con, now: _dt.datetime) -> set:
    """Countries with calls, positions or unrest in the last 12 h: where a
    crowd's picture is most likely the start of something."""
    since = (now - _dt.timedelta(hours=12)).isoformat()
    out = set()
    try:
        out |= {r[0] for r in con.execute("SELECT DISTINCT country FROM telegram_intents WHERE posted_at >= ?"
                                          " AND country IS NOT NULL AND country != ''", (since,))}
    except Exception:                                          # noqa: BLE001
        pass
    out |= {r[0] for r in con.execute("SELECT DISTINCT country_code FROM telegram_posts WHERE posted_at >= ?"
                                      " AND relevant=1 AND event_type='unrest' AND country_code IS NOT NULL"
                                      " AND country_code != ''", (since,))}
    return {str(c).lower() for c in out if c}


def hot_chats(con, now: _dt.datetime, minutes: int = 30) -> set:
    since = (now - _dt.timedelta(minutes=minutes)).isoformat()
    try:
        return {r[0] for r in con.execute("SELECT channel FROM telegram_chat_state WHERE last_cue_at >= ?", (since,))}
    except Exception:                                          # noqa: BLE001
        return set()


# ── budget ───────────────────────────────────────────────────────────────────

def budget(con, now: _dt.datetime) -> dict:
    """What is left, read from the table (survives a restart)."""
    h = (now - _dt.timedelta(hours=1)).isoformat()
    d = (now - _dt.timedelta(hours=24)).isoformat()
    n_h = con.execute("SELECT COUNT(*) FROM telegram_posts WHERE vision_checked=1 AND vision_cost > 0 AND vision_at >= ?",
                      (h,)).fetchone()[0]
    n_d, usd_d = con.execute("SELECT COUNT(*), COALESCE(SUM(vision_cost), 0) FROM telegram_posts WHERE vision_checked=1"
                             " AND vision_cost > 0 AND vision_at >= ?", (d,)).fetchone()
    v_h = con.execute("SELECT COUNT(*) FROM telegram_posts WHERE vision_checked=1 AND vision_cost > 0 AND vision_at >= ?"
                      " AND media='video' AND vision_decision LIKE '%frames%'", (h,)).fetchone()[0]
    return {"hour_left": max(0, PER_HOUR - n_h), "day_left": max(0, PER_DAY - n_d),
            "usd_today": round(usd_d, 4), "usd_left": round(max(0.0, USD_PER_DAY - usd_d), 4),
            "videos_left": max(0, VIDEOS_PER_HOUR - v_h),
            "calls_left": 0 if usd_d >= USD_PER_DAY else max(0, min(PER_HOUR - n_h, PER_DAY - n_d))}


# ── pictures ─────────────────────────────────────────────────────────────────

def image_hash(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def prepare(data: bytes) -> bytes:
    """A JPEG no larger than MAX_SIDE for the model (what it costs is by
    pixels); the stored picture is untouched."""
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        im = im.convert("RGB")
        im.thumbnail((MAX_SIDE, MAX_SIDE))
        out = io.BytesIO()
        im.save(out, "JPEG", quality=82)
        return out.getvalue()
    except Exception:                                          # noqa: BLE001
        return data


def _ffmpeg() -> str | None:
    try:
        import telegram_live
        return telegram_live._ffmpeg()
    except Exception:                                          # noqa: BLE001
        return shutil.which("ffmpeg")


def video_frames(path: str, at=FRAMES) -> list[bytes]:
    """A few frames of a video (imageio-ffmpeg's static binary; the
    laptop's Homebrew ffmpeg is broken). Written to a temp dir that is
    removed before returning: nothing is kept."""
    ff = _ffmpeg()
    if not ff or not os.path.exists(path):
        return []
    try:
        import imageio_ffmpeg
        _n, secs = imageio_ffmpeg.count_frames_and_secs(path)
    except Exception:                                          # noqa: BLE001
        secs = 0
    tmp = tempfile.mkdtemp(prefix="tgv-")
    out = []
    try:
        for i, f in enumerate(at):
            t = max(0.0, (secs or 0) * f)
            dst = os.path.join(tmp, f"{i}.jpg")
            subprocess.run([ff, "-nostdin", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1",
                            "-vf", f"scale='min({MAX_SIDE},iw)':-2", "-y", dst], timeout=30, capture_output=True)
            if os.path.exists(dst) and os.path.getsize(dst) > 0:
                with open(dst, "rb") as fh:
                    out.append(fh.read())
            if not secs:
                break           # unknown length: the first frame only
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


# ── the model ───────────────────────────────────────────────────────────────

def extract(client, images: list[bytes], post: dict, model: str = VISION_MODEL) -> tuple[dict, float]:
    """(the model's description, its cost in USD). Raises on a failed call."""
    import openai_gate
    ctx = (f"Post from «{post.get('channel_title') or post.get('channel')}»"
           f"{' › ' + post['topic_title'] if post.get('topic_title') else ''}"
           f" ({post.get('chat_kind') or 'channel'}), {post.get('posted_at', '')[:16]} UTC. "
           f"Its words: «{(post.get('text') or '').strip()[:600] or '(none)'}»"
           + (f" — {len(images)} frames of one video, in order." if len(images) > 1 else ""))
    content = [{"type": "text", "text": ctx}] + [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(b).decode(),
                                            "detail": "low"}} for b in images]
    resp = client.chat.completions.create(
        model=model, temperature=0, max_tokens=450, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": EXTRACT_SYSTEM}, {"role": "user", "content": content}])
    u = getattr(resp, "usage", None)
    cost = 0.0
    if u:
        pin, pout = openai_gate.price_for(model)
        cost = u.prompt_tokens * pin + u.completion_tokens * pout
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=u.prompt_tokens, output_tokens=u.completion_tokens,
                                      call_type="telegram_vision", model=model,
                                      headline=f"{post.get('channel')}/{post.get('msg_id')}")
        except Exception:                                      # noqa: BLE001
            pass
    x = json.loads(resp.choices[0].message.content or "{}")
    return (x if isinstance(x, dict) else {}), max(cost, 1e-6)


# ── the decision (code, not the model) ──────────────────────────────────────

def _b(v) -> bool:
    return v is True or (isinstance(v, str) and v.lower() == "true")


def _crowd(x: dict) -> int | None:
    c = x.get("crowd") or {}
    try:
        n = int(c.get("estimate")) if c.get("estimate") is not None else None
    except (TypeError, ValueError):
        n = None
    if n is None and _b(c.get("present")):
        return 0
    return n


def decide(x: dict) -> dict:
    """What a picture's description amounts to. Pure. Returns
    {event_type or None, what (English phrase), reason, graphic}. The
    thresholds are the rule; the model only said what it saw."""
    kind = (x.get("content_kind") or "other").lower()
    try:
        conf = float(x.get("confidence") or 0)
    except (TypeError, ValueError):
        conf = 0.0
    graphic = _b(x.get("injured_or_dead"))
    if kind in NOT_EVENTS:
        return {"event_type": None, "what": None, "reason": f"not a picture of an event ({kind})", "graphic": graphic}
    if conf < MIN_CONFIDENCE:
        return {"event_type": None, "what": None, "reason": f"the model was unsure ({conf:.2f})", "graphic": graphic}
    police = x.get("police") or {}
    actions = [a for a in (police.get("actions") or []) if a in POLICE_ACTIONS]
    mil = x.get("military") or {}
    vehicles = [str(v) for v in (mil.get("vehicles") or []) if v]
    n = _crowd(x)
    crowd_txt = f" (~{n:,} people)" if n else ""
    if _b(x.get("explosion")):
        return {"event_type": "explosion", "what": "Explosion seen in footage", "reason": "explosion visible",
                "graphic": graphic}
    if actions:                 # an action seen is police seen, whatever "present" says
        acts = ", ".join(ACTION_WORDS[a] for a in actions[:3])
        return {"event_type": "unrest", "what": f"Police use {acts} on a crowd{crowd_txt}" if n is not None
                else f"Police use {acts}", "reason": f"police action visible: {', '.join(actions)}", "graphic": graphic}
    if n is not None and (n >= CROWD_MIN or (_b(x.get("protest_signs")) and n >= 15)):
        police_txt = ", police present" if _b(police.get("present")) else ""
        return {"event_type": "unrest", "what": f"Crowd{crowd_txt} with banners or placards{police_txt}"
                if _b(x.get("protest_signs")) else f"Large crowd{crowd_txt}{police_txt}",
                "reason": f"crowd of {n} visible" + (" with protest signs" if _b(x.get("protest_signs")) else ""),
                "graphic": graphic}
    if _b(mil.get("present")) and vehicles:
        return {"event_type": "movement", "what": f"Military vehicles seen ({', '.join(vehicles[:3])})",
                "reason": "military vehicles visible", "graphic": graphic}
    if _b(x.get("fire_smoke")) and _b(x.get("damage")):
        return {"event_type": "strike" if _b(mil.get("present")) or _b(x.get("weapons_visible")) else "infrastructure_damage",
                "what": "Fire and damage seen in footage", "reason": "fire or smoke with damage visible", "graphic": graphic}
    if _b(x.get("damage")) and conf >= PLACE_CONFIDENCE:
        return {"event_type": "infrastructure_damage", "what": "Damage seen in footage", "reason": "damage visible",
                "graphic": graphic}
    if _b(x.get("fire_smoke")) and conf >= PLACE_CONFIDENCE:
        return {"event_type": "infrastructure_damage", "what": "Fire or smoke seen in footage", "reason": "fire or smoke visible",
                "graphic": graphic}
    return {"event_type": None, "what": None, "reason": "nothing of security interest visible", "graphic": graphic}


def place_from_picture(x: dict, chat_cc: str | None) -> tuple[str | None, str | None]:
    """(place, country) the picture itself shows — a landmark or a sign —
    or (None, None). The model's guess counts only with evidence named and
    enough confidence."""
    try:
        conf = float(x.get("confidence") or 0)
    except (TypeError, ValueError):
        conf = 0.0
    place = (x.get("place_guess") or "").strip()
    if not place or not (x.get("place_evidence") or "").strip() or conf < PLACE_CONFIDENCE:
        return None, None
    cc = (x.get("place_country") or chat_cc or "").strip().lower()
    return (place, cc) if len(cc) == 2 else (None, None)


def card(x: dict, decision: str | None = None) -> dict:
    """What the signal card shows of the reading."""
    flags = []
    n = _crowd(x)
    if n:
        flags.append(f"crowd ~{n:,}")
    pol = x.get("police") or {}
    if _b(pol.get("present")):
        flags.append("police" + (": " + ", ".join(ACTION_WORDS.get(a, a) for a in pol.get("actions") or [] if a in ACTION_WORDS)
                                 if pol.get("actions") else ""))
    mil = x.get("military") or {}
    if _b(mil.get("present")):
        flags.append("military" + (f" ({', '.join(map(str, (mil.get('vehicles') or [])[:3]))})" if mil.get("vehicles") else ""))
    for k, label in (("explosion", "explosion"), ("fire_smoke", "fire/smoke"), ("damage", "damage"),
                     ("weapons_visible", "weapons")):
        if _b(x.get(k)):
            flags.append(label)
    if x.get("time_of_day") in ("night", "dusk_dawn"):
        flags.append(str(x["time_of_day"]).replace("_", "/"))
    return {"scene": x.get("scene"), "flags": flags, "landmarks": x.get("landmarks") or [],
            "signs": (x.get("signage_text") or [])[:4], "decision": decision,
            "note": "What the picture shows, described by a model; the event and place were decided by rule"}


# ── one pass ─────────────────────────────────────────────────────────────────

def _cols():
    return ("channel, msg_id, channel_title, posted_at, text, media, thumb, role, chat_kind, topic_title, country_code,"
            " place, precision, lat, lon, relevant, read_by, headline, summary_en, event_type, classified")


def candidates(con, now: _dt.datetime) -> list[dict]:
    since = (now - _dt.timedelta(hours=WINDOW_H)).isoformat()
    names = [c.strip() for c in _cols().split(",")]
    rows = con.execute(f"SELECT {_cols()} FROM telegram_posts WHERE media IN ('photo','video') AND thumb IS NOT NULL"
                       " AND vision_checked IS NULL AND posted_at >= ? AND COALESCE(role,'') != 'ignore'"
                       " ORDER BY posted_at DESC LIMIT 2000", (since,)).fetchall()
    return [dict(zip(names, r)) for r in rows]


def apply(con, post: dict, x: dict, cost: float, digest: str, *, frames: int = 0, budget_geocode: list | None = None) -> str:
    """Write the reading and what code decided. Returns the decision text."""
    import telegram_ingest
    import telegram_signals
    d = decide(x)
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    via = f" ({frames} frames)" if frames > 1 else ""
    base = {"vision_checked": 1, "vision_at": now, "vision_json": json.dumps(x, ensure_ascii=False)[:6000],
            "vision_hash": digest, "vision_cost": round(cost, 6)}
    if d["graphic"]:
        base["graphic"] = 1
    decision = d["reason"] + via
    sets = dict(base)
    if d["event_type"] and post.get("lat") is not None and post.get("relevant"):
        decision = f"confirms the post: {d['reason']}{via}"
        sets["first_hand"] = 1
        STATUS["enriched"] += 1
    elif d["event_type"]:
        # A NEW SIGNAL FROM THE PICTURE. The place: the post's words first
        # (the text reading already resolved it, or named it), then what the
        # picture itself shows (a landmark, a sign).
        hit = None
        place, cc, prec = post.get("place"), (post.get("country_code") or ""), post.get("precision") or "town"
        if post.get("lat") is not None:
            hit = {"lat": post["lat"], "lon": post["lon"], "display_name": None}
        elif place and cc:
            hit, _ = telegram_ingest.locate(place, prec if prec in telegram_ingest.PRECISE else "town", cc)
        if hit is None:
            try:
                chat_cc = telegram_signals.chat_context(post["channel"]).get("country")
            except Exception:                                  # noqa: BLE001
                chat_cc = None
            vp, vcc = place_from_picture(x, chat_cc or cc or None)
            if vp and (budget_geocode is None or budget_geocode[0] > 0):
                if budget_geocode is not None:
                    budget_geocode[0] -= 1
                hit, _ = telegram_ingest.locate(vp, "site", vcc)
                if hit:
                    place, cc = vp, vcc
        what = d["what"]
        sets.update({"classified": 1, "relevant": 1, "event_type": d["event_type"], "read_by": "vision",
                     "headline": (f"{what} — {place}" if place else what)[:200],
                     "summary_en": post.get("summary_en") or x.get("scene"),
                     "first_hand": 1, "place": place, "country_code": (cc or "").lower() or None})
        if hit:
            if post.get("lat") is None:
                sets.update({"lat": hit["lat"], "lon": hit["lon"], "geocoded_as": hit.get("display_name"),
                             "precision": prec if place == post.get("place") else "site"})
            sets["unpublished_reason"] = None
            decision = f"signal: {d['reason']}{via}, placed at {place}"
            STATUS["last_signal"] = {"post": f"{post['channel']}/{post['msg_id']}", "headline": sets["headline"], "at": now}
        else:
            sets["unpublished_reason"] = "seen in the picture, but no place to pin (words or landmark)"
            decision = f"signal, unplaced: {d['reason']}{via}"
        STATUS["signals"] += 1
    sets["vision_decision"] = decision[:300]
    keys = list(sets)
    con.execute(f"UPDATE telegram_posts SET {', '.join(k + '=?' for k in keys)} WHERE channel=? AND msg_id=?",
                [sets[k] for k in keys] + [post["channel"], post["msg_id"]])
    return decision


def _picture(post: dict, use_video: bool) -> tuple[list[bytes], bytes | None]:
    """(images for the model, the bytes the hash is of)."""
    import telegram_ingest
    still = None
    p = os.path.join(telegram_ingest.MEDIA_DIR, post["thumb"]) if post.get("thumb") else None
    if p and os.path.exists(p):
        with open(p, "rb") as fh:
            still = fh.read()
    if use_video and post.get("media") == "video":
        try:
            path, _why = telegram_ingest.video_path(post["channel"], post["msg_id"])
            frames = video_frames(path) if path else []
        except Exception as e:                                 # noqa: BLE001
            print(f"[tg-vision] frames of {post['channel']}/{post['msg_id']}: {type(e).__name__}: {e}", flush=True)
            frames = []
        if frames:
            return [prepare(f) for f in frames], still or frames[0]
    return ([prepare(still)] if still else []), still


def run_once(now: _dt.datetime | None = None, client=None) -> dict:
    """One pass: the best pictures within budget. Synchronous: run it on
    its own pool (main._telegram_vision_loop)."""
    import openai_gate
    import telegram_ingest
    now = now or _dt.datetime.now(_dt.timezone.utc)
    STATUS["last_run"] = now.isoformat()
    if not ENABLED:
        return {"vision": "off (TG_VISION=0)"}
    con = telegram_ingest._con()
    out = {"vision_read": 0, "vision_signals": 0, "vision_duplicates": 0, "vision_failed": 0}
    try:
        left = budget(con, now)
        cand = candidates(con, now)
        if not cand:
            return out
        active, hot = active_countries(con, now), hot_chats(con, now)
        try:
            import telegram_signals
            ccs = {c: telegram_signals.chat_context(c).get("country") for c in {p["channel"] for p in cand}}
        except Exception:                                      # noqa: BLE001
            ccs = {}
        for p in cand:
            p["cc"] = ccs.get(p["channel"])
            p["score"] = priority(p, active, hot)
        cand.sort(key=lambda p: (p["score"], p["posted_at"]), reverse=True)
        worth = [p for p in cand if p["score"] >= MIN_PRIORITY]
        STATUS["skipped_low_priority"] = len(cand) - len(worth)
        if worth and left["calls_left"] <= 0:
            STATUS["skipped_budget"] += 1
            out["vision_budget"] = "spent"
            return out
        if client is None:
            client = openai_gate.get_client(openai_gate.ENRICH)
        geocodes = [6]
        calls = 0
        videos_left = left["videos_left"]
        spent = 0.0
        for p in worth:
            if calls >= min(PER_PASS, left["calls_left"]) or left["usd_today"] + spent >= USD_PER_DAY:
                break
            use_video = p["media"] == "video" and p["score"] >= VIDEO_PRIORITY and videos_left > 0
            images, raw = _picture(p, use_video)
            if not images or raw is None:
                con.execute("UPDATE telegram_posts SET vision_checked=-1, vision_at=?, vision_decision=?"
                            " WHERE channel=? AND msg_id=?", (now.isoformat(), "no picture on disk", p["channel"], p["msg_id"]))
                continue
            digest = image_hash(raw)
            # THE SAME PICTURE ONCE: a forward or a repost reuses the reading.
            seen = con.execute("SELECT vision_json FROM telegram_posts WHERE vision_hash=? AND vision_json IS NOT NULL"
                               " LIMIT 1", (digest,)).fetchone()
            if seen:
                apply(con, p, json.loads(seen[0]), 0.0, digest, budget_geocode=geocodes)
                STATUS["skipped_duplicate"] += 1
                out["vision_duplicates"] += 1
                continue
            if client is None:
                out["vision_model"] = "unavailable (no key, over budget or out of credit)"
                break
            try:
                x, cost = extract(client, images, p)
                openai_gate.note_ok()
            except Exception as e:                             # noqa: BLE001
                STATUS["failed"] += 1
                STATUS["last_error"] = f"{type(e).__name__}: {str(e)[:200]}"
                out["vision_failed"] += 1
                print(f"[tg-vision] error: {p['channel']}/{p['msg_id']}: {type(e).__name__}: {e} "
                      f"(failed {STATUS['failed']} so far)", flush=True)
                if openai_gate.note_error(e):
                    break                      # out of credit: the rest wait (not marked, read when it is back)
                con.execute("UPDATE telegram_posts SET vision_checked=-1, vision_at=?, vision_decision=?"
                            " WHERE channel=? AND msg_id=?",
                            (now.isoformat(), f"failed: {type(e).__name__}"[:300], p["channel"], p["msg_id"]))
                continue
            calls += 1
            spent += cost
            if len(images) > 1:
                videos_left -= 1
            decision = apply(con, p, x, cost, digest, frames=len(images), budget_geocode=geocodes)
            STATUS["processed"] += 1
            out["vision_read"] += 1
            out["vision_signals"] += int(decision.startswith("signal"))
            con.commit()
        con.commit()
    finally:
        con.close()
    if out["vision_read"] or out["vision_failed"]:
        print(f"[tg-vision] {out}", flush=True)
    return out


def status() -> dict:
    """For /api/telegram/status: counts since start, and the budget left."""
    out = dict(STATUS)
    out.update({"per_hour": PER_HOUR, "per_day": PER_DAY, "usd_per_day": USD_PER_DAY,
                "videos_per_hour": VIDEOS_PER_HOUR})
    try:
        import telegram_ingest
        con = telegram_ingest._con()
        try:
            out["budget"] = budget(con, _dt.datetime.now(_dt.timezone.utc))
            out["read_24h"] = dict(con.execute(
                "SELECT CASE WHEN vision_decision LIKE 'signal%' THEN 'signal' WHEN vision_decision LIKE 'confirms%'"
                " THEN 'confirmed' WHEN vision_checked=-1 THEN 'failed' ELSE 'nothing' END, COUNT(*)"
                " FROM telegram_posts WHERE vision_at >= ? GROUP BY 1",
                ((_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=24)).isoformat(),)).fetchall())
        finally:
            con.close()
    except Exception as e:                                     # noqa: BLE001
        out["budget_error"] = f"{type(e).__name__}: {e}"
    return out
