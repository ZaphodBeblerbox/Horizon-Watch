"""
live_signals.py — the signals the map draws, and the notifications announce.
ONE FAMILY, ONE GATE (owner, 2026-10-22: "signals are still not live").

WHAT IT IS. A signal is one of the owner's acts (live_incident.ACTS: arrest,
shots fired, explosion, strike, missile launch / impact, a crowd on the ground
moving, troops sighted, police intervention) at a place the post itself names,
read by the strict extractor (live_incident.py) as happening now. Nothing else
is drawn: no footage mark, no announced protest, no opinion, no "call to
violence", no street report the old rules read out of a word ("République" in
"président de la République").

DERIVED ON READ (memory: derive on read, don't store). What is stored is the
extractor's whole answer (telegram_posts.live_json, live_verdict, event_time).
Everything below is computed from those rows each time (cached for seconds):
  * live          the event is within LIVE_WINDOW_MIN of now (a crowd still being
                  reported: within 60 min of its last report, at most CROWD_MAX_MIN
                  after its first);
  * one event, one marker   signals of the same event (within MERGE_M and
                  MERGE_MIN of each other, any act) are one signal whose card lists
                  them: the gravest act is the headline, the others short lines;
  * corroboration first-hand wording, or two or more independent sources (other
                  channels, not forwards of each other) within CORROB_MIN and
                  CORROB_M, or a media attachment. Said honestly on the card
                  ("Eyewitness, unverified", "Corroborated by 3 sources", "1 source,
                  unverified"); a high-impact act with none of them is `muted`,
                  drawn faintly, never hidden;
  * media         only as an attachment: the signal's own post's picture or video, or
                  a captionless picture or video of the same channel and thread within
                  MEDIA_GAP_S. It is never a mark of its own.
  * text          no emoji, no channel list, no raw post text: "Police charge at
                  Sorbonne, Paris" and a source line.
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import re
import sqlite3

import live_incident as li
from textclean import strip_emoji

LIVE_WINDOW_MIN = li.LIVE_WINDOW_MIN          # 60
CROWD_MAX_MIN = 180                           # a crowd still being reported stays at most this long after its first report
MERGE_M = 150.0
MERGE_MIN = 60.0
CORROB_M = 300.0
CORROB_MIN = 15.0
MEDIA_GAP_S = 300
CACHE_S = 10
LOOKBACK_MIN = CROWD_MAX_MIN

# the gravest first: the card's headline is the first act present
RANK = ["shots_fired", "missile_impact", "missile_launch", "explosion", "strike", "arrest", "police_intervention",
        "troops_sighted", "crowd_movement"]


def metres(a_lat, a_lon, b_lat, b_lon) -> float:
    r = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def bearing(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lon - a_lon)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _tokens(s: str | None) -> set[str]:
    return {w for w in re.findall(r"\w{3,}", li.fold(s)) if not w.isdigit()}


def same_words(a: str | None, b: str | None) -> bool:
    """One text is a forward or a copy of the other: most of the shorter one's words are in the other."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    return len(ta & tb) / min(len(ta), len(tb)) >= 0.6


# ── atoms: one live post ────────────────────────────────────────────────────

def _audit(row: dict) -> dict:
    try:
        d = json.loads(row.get("live_json") or "{}")
        return d if isinstance(d, dict) else {}
    except (TypeError, ValueError):
        return {}


def atom_of(row: dict) -> dict | None:
    """The act, place and time a live post stands for, from the extractor's stored answer. None when
    the row is not a signal of the vocabulary (an older reading with no act, say)."""
    if (row.get("live_verdict") or "") not in ("live", "rule-live"):
        return None
    if row.get("lat") is None or row.get("lon") is None:
        return None
    a = _audit(row)
    v = a.get("verify") or {}
    r = a.get("rule") or {}
    act = v.get("act") or r.get("act")
    if act not in li.ACTS:
        return None
    if act == "police_intervention":
        import force_context                      # war reporting is troops, never police (derived on read: old rows too)
        if force_context.is_military(row.get("text"), row.get("country_code")):
            act = "troops_sighted"
    ev = li.parse_utc(row.get("event_time"))
    if ev is None:
        return None
    from textclean import is_generic_place
    name = v.get("name") or (r.get("place") or "").split(",")[0] or row.get("place") or ""
    if is_generic_place(name):
        return None
    quote = (a.get("model") or {}).get("evidence_quote_act") or r.get("quote")
    text = row.get("text") or ""
    first_hand = bool(v.get("first_hand")) or bool(row.get("first_hand")) or bool(
        re.search(r"\b(?:je vois|on est (?:a|sur|devant|au)|sous mes yeux|i can see|we are (?:at|on|in)|je suis (?:a|sur|devant))\b", li.fold(text).replace("’", "'")))
    return {"channel": row["channel"], "msg_id": row["msg_id"], "topic_id": row.get("topic_id"),
            "channel_title": strip_emoji(row.get("channel_title") or row["channel"]), "posted_at": row.get("posted_at"),
            "event_time": ev, "act": act, "quote": quote, "name": strip_emoji(name), "context": [strip_emoji(c) for c in (v.get("context") or [])],
            "lat": float(row["lat"]), "lon": float(row["lon"]), "text": text, "first_hand": first_hand,
            "certainty": (a.get("model") or {}).get("certainty"), "direction": a.get("direction_resolved") or v.get("direction"),
            "media": row.get("media") or "none", "thumb": row.get("thumb"), "read_by": row.get("read_by"),
            "country_code": row.get("country_code")}


# ── the build (pure) ────────────────────────────────────────────────────────

def _find(parent: list[int], i: int) -> int:
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i


def clusters(atoms: list[dict]) -> list[list[dict]]:
    """One event, one marker: atoms within MERGE_M and MERGE_MIN of each other, whatever their acts."""
    n = len(atoms)
    parent = list(range(n))
    for i in range(n):
        for j in range(i + 1, n):
            a, b = atoms[i], atoms[j]
            if abs((a["event_time"] - b["event_time"]).total_seconds()) / 60 > MERGE_MIN:
                continue
            if metres(a["lat"], a["lon"], b["lat"], b["lon"]) <= MERGE_M:
                parent[_find(parent, i)] = _find(parent, j)
    groups: dict[int, list[dict]] = {}
    for i in range(n):
        groups.setdefault(_find(parent, i), []).append(atoms[i])
    return list(groups.values())


def independent_sources(atom: dict, atoms: list[dict]) -> list[dict]:
    """The atoms that independently say what `atom` says: another channel, within CORROB_MIN and CORROB_M,
    and not a forward of it (nor of each other)."""
    seen = [atom]
    for o in sorted(atoms, key=lambda x: x["event_time"]):
        if o is atom or o["channel"] == atom["channel"]:
            continue
        if abs((o["event_time"] - atom["event_time"]).total_seconds()) / 60 > CORROB_MIN:
            continue
        if metres(atom["lat"], atom["lon"], o["lat"], o["lon"]) > CORROB_M:
            continue
        if any(s["channel"] == o["channel"] or same_words(s["text"], o["text"]) for s in seen):
            continue
        seen.append(o)
    return seen


def source_line(level: str, n: int, with_media: bool) -> str:
    if n >= 2:
        return f"Corroborated by {n} sources"
    if level == "eyewitness":
        return "Eyewitness, with footage, unverified" if with_media else "Eyewitness, unverified"
    if with_media:
        return "With footage, unverified"
    return "1 source, unverified"


def build(atoms: list[dict], media_by_atom: dict | None = None, now: _dt.datetime | None = None) -> list[dict]:
    """Signals (newest event first) from live posts' atoms. Pure."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    media_by_atom = media_by_atom or {}
    out: list[dict] = []
    for grp in clusters(atoms):
        grp.sort(key=lambda a: a["event_time"])
        first, last = grp[0], grp[-1]
        acts = [a["act"] for a in grp]
        primary_act = min(acts, key=lambda x: RANK.index(x))
        primary = max((a for a in grp if a["act"] == primary_act), key=lambda a: a["event_time"])
        # LIVE: 60 min after the latest report of it; a crowd still being reported keeps up to 3 h from its first
        age_last = (now - last["event_time"]).total_seconds() / 60
        age_first = (now - first["event_time"]).total_seconds() / 60
        if age_last < -li.SKEW_S / 60:
            continue
        crowd = primary_act == "crowd_movement"
        if age_last > LIVE_WINDOW_MIN or (not crowd and (now - primary["event_time"]).total_seconds() / 60 > LIVE_WINDOW_MIN):
            continue
        if crowd and age_first > CROWD_MAX_MIN:
            continue
        # corroboration, per member then the best of them
        n_best, hand = 1, any(a["first_hand"] for a in grp)
        for a in grp:
            n_best = max(n_best, len(independent_sources(a, atoms)))
        media = []
        for a in grp:
            media += media_by_atom.get((a["channel"], a["msg_id"]), [])
        level = "corroborated" if n_best >= 2 else ("eyewitness" if hand else ("footage" if media else "unverified"))
        line = source_line(level if level != "footage" else "unverified", n_best, bool(media))
        muted = primary_act in li.HIGH_IMPACT and level == "unverified"
        title = li.card_headline(primary_act, primary.get("quote"), primary["name"], primary["context"], primary.get("direction"))
        extra = []
        seen_lines = {title}
        for a in sorted(grp, key=lambda x: x["event_time"], reverse=True):
            if a is primary:
                continue
            ln = li.card_headline(a["act"], a.get("quote"), a["name"], a["context"], a.get("direction"))
            if ln not in seen_lines:
                seen_lines.add(ln)
                extra.append({"act": a["act"], "text": ln})
        direction = None
        d = primary.get("direction") if crowd else None
        if isinstance(d, dict) and d.get("lat") is not None and d.get("lon") is not None:
            direction = {"toward_place": strip_emoji(d.get("toward_place") or ""), "lat": d["lat"], "lon": d["lon"],
                         "bearing": round(bearing(primary["lat"], primary["lon"], d["lat"], d["lon"]), 1)}
        chans = list(dict.fromkeys(a["channel"] for a in grp))
        srcs = [{"channel_title": a["channel_title"], "posted_at": a["posted_at"],
                 "url": None if str(a["channel"]).startswith(("c/", "u/", "g/")) else f"https://t.me/{a['channel']}/{a['msg_id']}"}
                for a in sorted(grp, key=lambda x: x["event_time"], reverse=True)][:4]
        # video first, then a photo
        media.sort(key=lambda m: 0 if m["kind"] == "video" else 1)
        out.append({
            "id": f"ls-{first['channel']}-{first['msg_id']}", "kind": "live_signal", "act": primary_act,
            "act_label": li.act_label(primary_act, primary.get("quote")), "title": title, "lines": extra,
            "count": len(grp), "place": strip_emoji(primary["name"]), "context": [strip_emoji(c) for c in primary["context"][:1]],
            "country_code": (primary.get("country_code") or "").lower() or None,
            "lat": primary["lat"], "lon": primary["lon"],
            "event_time": li.iso(last["event_time"]), "first_event_time": li.iso(first["event_time"]),
            "posted_at": last["posted_at"], "live": True,
            "corroboration": {"level": level, "n_sources": n_best, "first_hand": hand, "with_media": bool(media),
                              "line": line},
            "muted": muted, "high_impact": primary_act in li.HIGH_IMPACT,
            "media": media[0] if media else None, "all_media": media[:4],
            "direction": direction, "sources": srcs, "channels": chans, "msg_id": primary["msg_id"], "channel": primary["channel"],
        })
    out.sort(key=lambda s: s["event_time"], reverse=True)
    return out


# ── reading the database ────────────────────────────────────────────────────

def _media_of(row: dict) -> dict | None:
    import telegram_ingest as tg
    if (row.get("media") or "none") not in ("photo", "video"):
        return None
    u = tg.media_urls(row["channel"], row["msg_id"], row["media"], row.get("thumb"))
    if not (u.get("thumb_url") or u.get("video_url")):
        return None
    return {"kind": row["media"], "thumb_url": u["thumb_url"], "video_url": u["video_url"], "media_url": u["media_url"],
            "channel": row["channel"], "msg_id": row["msg_id"], "graphic": False}


def attach_media(con, atoms: list[dict]) -> dict:
    """{(channel, msg_id): [media]}. THE RULE (owner, 2026-10-22: media only if the same post / thread / author within
    minutes says the same thing at the same place): the live post's own picture or video (the post is the one
    that names the act and the place), or a CAPTIONLESS picture or video of the same channel and thread within
    MEDIA_GAP_S and three messages of it (Telegram sends the words and the video as two messages). A picture with
    its own caption that is not this post is not attached: it says its own thing."""
    out: dict = {}
    for a in atoms:
        key = (a["channel"], a["msg_id"])
        got = []
        own = _media_of({"channel": a["channel"], "msg_id": a["msg_id"], "media": a["media"], "thumb": a["thumb"]})
        if own:
            got.append(own)
        try:
            rows = con.execute(
                "SELECT channel, msg_id, media, thumb, posted_at, topic_id FROM telegram_posts WHERE channel=? AND msg_id BETWEEN ? AND ?"
                " AND msg_id != ? AND media IN ('photo','video') AND TRIM(COALESCE(text,'')) = ''",
                (a["channel"], a["msg_id"] - 3, a["msg_id"] + 3, a["msg_id"])).fetchall()
        except sqlite3.Error:
            rows = []
        pa = li.parse_utc(a["posted_at"])
        for r in rows:
            rd = dict(zip(("channel", "msg_id", "media", "thumb", "posted_at", "topic_id"), r))
            if rd["topic_id"] != a.get("topic_id"):
                continue
            pr = li.parse_utc(rd["posted_at"])
            if pa and pr and abs((pr - pa).total_seconds()) <= MEDIA_GAP_S:
                m = _media_of(rd)
                if m:
                    got.append(m)
        if got:
            out[key] = got
    return out


def read(con, now: _dt.datetime | None = None) -> list[dict]:
    now = now or _dt.datetime.now(_dt.timezone.utc)
    since = li.iso(now - _dt.timedelta(minutes=LOOKBACK_MIN + 5))
    prev = con.row_factory
    con.row_factory = sqlite3.Row
    try:
        cols = {r[1] for r in con.execute("PRAGMA table_info(telegram_posts)")}
        if "live_verdict" not in cols or "event_time" not in cols:
            return []
        want = ["channel", "msg_id", "channel_title", "topic_id", "posted_at", "text", "media", "thumb", "lat", "lon", "place",
                "country_code", "event_time", "live_verdict", "live_json", "first_hand", "read_by"]
        rows = [dict(r) for r in con.execute(
            f"SELECT {', '.join(want)} FROM telegram_posts WHERE live_verdict IN ('live','rule-live') AND event_time >= ?"
            " AND lat IS NOT NULL AND COALESCE(role,'') != 'ignore' ORDER BY event_time DESC LIMIT 500", (since,))]
    finally:
        con.row_factory = prev
    atoms = [a for a in (atom_of(r) for r in rows) if a]
    return build(atoms, attach_media(con, atoms), now)


from shared_cache import SharedCache  # noqa: E402
_SIGNALS = SharedCache("live-signals", ttl=CACHE_S, max_stale=60)
_STATUS = {"reads": 0, "last_count": None, "last_error": None}


def signals(db_path: str | None = None) -> list[dict]:
    """The live signals now. One read serves every caller (shared_cache)."""
    def _build():
        import telegram_ingest as tg
        con = sqlite3.connect(db_path, timeout=30) if db_path else tg._con()
        try:
            out = read(con)
            _STATUS["reads"] += 1
            _STATUS["last_count"] = len(out)
            _STATUS["last_error"] = None
            return out
        except sqlite3.OperationalError as e:
            _STATUS["last_error"] = f"{type(e).__name__}: {e}"
            print(f"[live-signals] error: read: {e}", flush=True)
            return []
        finally:
            con.close()
    return _SIGNALS.get(("live", db_path), _build)


def status() -> dict:
    return dict(_STATUS)


def notification_cards(sigs: list[dict] | None = None, cap: int = 25) -> list[dict]:
    """The same signals as notification cards (main._notification_feed): the act and the place in the
    title, the source line and the age in `reason`; muted (uncorroborated high-impact) ones are moderate,
    corroborated or first-hand ones high; footage is never a card of its own."""
    sigs = signals() if sigs is None else sigs
    cards = []
    for s in sigs[:cap]:
        sev = "moderate" if s["muted"] else "high"
        if s["corroboration"]["n_sources"] >= 3 and s["high_impact"]:
            sev = "critical"
        cards.append({
            "id": s["id"], "kind": "telegram", "sev": sev, "title": s["title"],
            "reason": s["corroboration"]["line"], "lat": s["lat"], "lon": s["lon"], "country_code": s["country_code"],
            "region": s["place"], "created_at": s["event_time"], "source": "telegram", "live_signal": True,
            "act": s["act"], "url": (s["sources"][0]["url"] if s["sources"] else None),
            "media": (s["media"] or {}).get("kind"), "thumb_url": (s["media"] or {}).get("thumb_url"),
            "channel": s["channel"], "msg_id": s["msg_id"],
        })
    return cards
