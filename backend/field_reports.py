"""
field_reports.py — USER REPORTS (owner, 2026-10-24): somebody reports what they see on the ground, e.g.
"police sighting at Place de la République in Paris, expires in 12 h, police icon".

WHAT A REPORT IS. One person's sighting at one place: a kind (KINDS), a title, an optional note and picture, the
time it happened, and when it stops being true (expires_at: by default DEFAULT_EXPIRY_H[kind] after it happened,
the author may set it, never more than MAX_EXPIRY_H from now). The author may end it early. It is always
"Reported by <name>, unverified": nobody checked it, and it never counts as an independent source.

WHO SEES IT (the Desk's rule, routers/desk.py, reused, not copied): your company by default; 'everyone'; or
'people' named. The scoped list (GET /api/field-reports) is the source for the map.

DERIVED ON READ (memory: derive on read, don't store): "active" is computed each read — not ended, not deleted,
expires_at in the future. Nothing sweeps the table to hide old ones, so nothing can stop hiding them.

FEEDS. live_signals.signals() is one shared answer for every user, so only reports to 'everyone' go into it
(as source_kind 'user'); the same for events (events.reconcile: they join an event, never create one). The
Protests layer (protests.for_user) is per user, so it takes the user's own visible police/crowd/clashes reports.

STORE. A table in the app DB (akili.db), created on first use like owned_assets.py (CREATE TABLE IF NOT EXISTS).

PUBLIC CONTRACT (the assistant's `report` tool depends on it): KINDS, DEFAULT_EXPIRY_H, MAX_EXPIRY_H,
parse_kind(text), parse_expiry(text), validate(data).
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import sqlite3
import threading
import unicodedata
import uuid
from types import SimpleNamespace

HERE = os.path.dirname(os.path.abspath(__file__))

KINDS = ("police", "crowd", "clashes", "roadblock", "fire", "explosion", "shots", "other")
KIND_LABEL = {"police": "Police", "crowd": "Crowd", "clashes": "Clashes", "roadblock": "Roadblock", "fire": "Fire",
              "explosion": "Explosion", "shots": "Shots fired", "other": "Report"}
DEFAULT_EXPIRY_H = {"police": 2, "crowd": 3, "clashes": 2, "roadblock": 6, "fire": 6, "explosion": 6, "shots": 2, "other": 6}
MAX_EXPIRY_H = 72
MIN_EXPIRY_MIN = 10            # an expiry sooner than this is a typo, not a report
MAX_PAST_H = 24                # a report of something that happened earlier than this is a story, not a sighting
TITLE_MAX = 120
NOTE_MAX = 1000
PLACE_MAX = 200
MAX_MEDIA = 4
MEDIA_TYPES = ("image", "video")
AUDIENCES = ("company", "everyone", "people")
# the live-signal acts (live_incident.ACTS where one fits; our own word where none does)
ACT = {"police": "police_intervention", "crowd": "crowd_movement", "clashes": "clash", "roadblock": "roadblock",
       "fire": "fire", "explosion": "explosion", "shots": "shots_fired", "other": "other"}
# the Protests layer's kinds (protests.py KIND_LABEL)
PROTEST_KIND = {"police": "police", "crowd": "crowd", "clashes": "clash"}


# ── parsing (pure) ──────────────────────────────────────────────────────────

def fold(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode("ascii")
    return s.lower().replace("’", "'")


# gravest first; "riot police" is police, not a riot
_RIOT_POLICE = re.compile(r"\b(riot police|riot cops|police anti[- ]?emeute|forces anti[- ]?emeute)\b")
_KIND_RX = [
    ("shots", re.compile(r"\b(shots?( fired)?|gun ?fire|gunshots?|shooting|shoot-?out|coups? de feu|fusillades?|tirs? (a balles|d'armes?)|tire?urs?)\b")),
    ("explosion", re.compile(r"\b(explosions?|blasts?|bang|bombs?|deflagrations?|detonations?|explose|explosifs?)\b")),
    ("clashes", re.compile(r"\b(clash(es|ing)?|riots?|rioting|fight(ing|s)?|scuffles?|brawls?|affrontements?|heurts|emeutes?|echauffourees?|bagarres?)\b")),
    ("roadblock", re.compile(r"\b(road ?blocks?|barricades?|road (is )?blocked|blocked road|checkpoints?|road closed|barrages?( routiers?| de police)?|"
                             r"routes? (bloquee|barree)s?|points? de controle|blocages?)\b")),
    ("fire", re.compile(r"\b(fires?|burning|blaze|flames?|on fire|feu|incendies?|brule|brulent|en flammes|flammes)\b")),
    ("police", re.compile(r"\b(police|policemen|policiers?|cops?|crs|gendarmes?|gendarmerie|brav-?m|bac|flics?|keufs?|"
                          r"forces de l'ordre|officers?|police vans?|fourgons?)\b")),
    ("crowd", re.compile(r"\b(crowds?|protests?|protesters?|march(es|ers)?|rall(y|ies)|demonstrations?|demonstrators?|gathering|"
                         r"foules?|manifs?|manifestations?|manifestants?|cortege|rassemblements?|defiles?|attroupements?)\b")),
]


def parse_kind(text: str | None) -> str | None:
    """The report's kind from free text, English or French; None when nothing names one."""
    t = fold(text)
    if not t.strip():
        return None
    t = _RIOT_POLICE.sub(" police ", t)
    for kind, rx in _KIND_RX:
        if rx.search(t):
            return kind
    return None


_NUM = r"(\d+(?:[.,]\d+)?|an?|one|une?|half an?|une demi-?)"
_WORDS = {"a": 1.0, "an": 1.0, "one": 1.0, "un": 1.0, "une": 1.0, "half a": 0.5, "half an": 0.5, "une demi-": 0.5,
          "une demi": 0.5}


def _num(s: str) -> float:
    s = s.strip()
    if s in _WORDS:
        return _WORDS[s]
    return float(s.replace(",", "."))


def parse_expiry(text: str | None) -> float | None:
    """How long it holds, in hours, from free text: "12 h", "12h", "for 2 hours", "30 min", "1 day",
    "expires in 6 hours", "12 heures", "1h30". None when the text gives no duration."""
    t = fold(text)
    if not t.strip():
        return None
    m = re.search(r"\b(\d{1,2})\s*h\s*(\d{2})\b", t)                    # 1h30
    if m:
        return int(m.group(1)) + int(m.group(2)) / 60
    m = re.search(rf"\b{_NUM}\s*(days?|jours?|d)\b", t)
    if m:
        return _num(m.group(1)) * 24
    m = re.search(rf"\b{_NUM}\s*(hours?|hrs?|h|heures?)\b", t)
    if m:
        return _num(m.group(1))
    if re.search(r"\b(half an hour|une demi-?heure)\b", t):
        return 0.5
    m = re.search(r"\b(\d+(?:[.,]\d+)?)\s*(minutes?|mins?|mn|m)\b", t)
    if m:
        return _num(m.group(1)) / 60
    return None


# ── validation (pure) ───────────────────────────────────────────────────────

def _utcnow() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def parse_time(v) -> _dt.datetime | None:
    if v is None or v == "":
        return None
    if isinstance(v, _dt.datetime):
        t = v
    else:
        try:
            t = _dt.datetime.fromisoformat(str(v).strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)


def iso(t: _dt.datetime | None) -> str | None:
    return t.astimezone(_dt.timezone.utc).isoformat().replace("+00:00", "Z") if t else None


def _clean_text(v, n: int) -> str:
    s = re.sub(r"[ \t\r\f\v]+", " ", str(v or "")).strip()
    return s[:n]


def _clean_media(v) -> list[dict]:
    if v in (None, ""):
        return []
    if not isinstance(v, list):
        raise ValueError("media is a list of {url, type}")
    out = []
    for m in v[:MAX_MEDIA]:
        if not isinstance(m, dict):
            raise ValueError("each media item is {url, type}")
        typ = str(m.get("type") or "").lower() or ("video" if str(m.get("mime") or "").startswith("video/") else "image")
        if typ not in MEDIA_TYPES:
            raise ValueError("a media item is an image or a video")
        path = str(m.get("path") or "").strip()
        url = str(m.get("url") or "").strip()
        if path:
            # a file uploaded through the desk's upload (POST /api/desk/files): <user>/<uuid>.<ext>, nothing else
            if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}/[0-9a-f-]{36}\.[a-z0-9]{2,5}", path):
                raise ValueError("that media file is not one uploaded here")
            out.append({"type": typ, "path": path, "mime": str(m.get("mime") or "")[:80] or None,
                        "name": _clean_text(m.get("name"), 120) or None})
        elif url:
            if not re.match(r"^https?://", url, re.I) or len(url) > 2000:
                raise ValueError("a media url must be http(s)")
            out.append({"type": typ, "url": url})
        else:
            raise ValueError("a media item needs a url")
    return out


def default_title(kind: str, place: str | None) -> str:
    return f"{KIND_LABEL[kind]} at {place}"[:TITLE_MAX] if place else KIND_LABEL[kind]


def validate(data: dict, now: _dt.datetime | None = None) -> dict:
    """A create body, cleaned: {kind, title, note, place, lat, lon, occurred_at, expires_at, audience, shared_with,
    media}. Pure. Raises ValueError with a message a person can read. Resolves the defaults: the kind from the
    title or note when not given, the occurred time (now), the expiry from the kind (DEFAULT_EXPIRY_H) or from
    expires_in_h, capped at MAX_EXPIRY_H from now."""
    if not isinstance(data, dict):
        raise ValueError("a report is a JSON object")
    now = now or _utcnow()
    kind = str(data.get("kind") or "").strip().lower()
    if not kind:
        kind = parse_kind(f"{data.get('title') or ''} {data.get('note') or ''}") or ""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    try:
        lat, lon = float(data.get("lat")), float(data.get("lon"))
    except (TypeError, ValueError):
        raise ValueError("a report needs a place on the map (lat and lon)")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        raise ValueError("that is not a place on the map")
    place = _clean_text(data.get("place"), PLACE_MAX) or None
    title = _clean_text(data.get("title"), TITLE_MAX) or default_title(kind, place)
    note = str(data.get("note") or "").strip()[:NOTE_MAX] or None

    occurred = now if data.get("occurred_at") in (None, "") else parse_time(data.get("occurred_at"))
    if occurred is None:
        raise ValueError("occurred_at is not a time")
    if occurred > now + _dt.timedelta(minutes=5):
        raise ValueError("a report is of something that has happened, not of something to come")
    if occurred < now - _dt.timedelta(hours=MAX_PAST_H):
        raise ValueError(f"a report is of something seen in the last {MAX_PAST_H} hours")

    if data.get("expires_at") not in (None, ""):
        expires = parse_time(data.get("expires_at"))
        if expires is None:
            raise ValueError("expires_at is not a time")
    elif data.get("expires_in_h") not in (None, ""):
        try:
            h = float(data.get("expires_in_h"))
        except (TypeError, ValueError):
            h = parse_expiry(str(data.get("expires_in_h")))
            if h is None:
                raise ValueError("expires_in_h is a number of hours")
        if h <= 0:
            raise ValueError("a report must hold for some time")
        expires = now + _dt.timedelta(hours=h)
    else:
        expires = max(occurred + _dt.timedelta(hours=DEFAULT_EXPIRY_H[kind]), now + _dt.timedelta(minutes=30))
    if expires < now + _dt.timedelta(minutes=MIN_EXPIRY_MIN):
        raise ValueError(f"a report must hold at least {MIN_EXPIRY_MIN} minutes")
    expires = min(expires, now + _dt.timedelta(hours=MAX_EXPIRY_H))

    audience = str(data.get("audience") or "").strip().lower() or None
    if audience is not None and audience not in AUDIENCES:
        raise ValueError(f"audience must be one of {', '.join(AUDIENCES)}")
    shared = data.get("shared_with") or []
    if not isinstance(shared, list):
        raise ValueError("shared_with is a list of user ids")
    return {"kind": kind, "title": title, "note": note, "place": place, "lat": round(lat, 6), "lon": round(lon, 6),
            "occurred_at": iso(occurred), "expires_at": iso(expires), "audience": audience,
            "shared_with": [str(x) for x in shared if x][:50], "media": _clean_media(data.get("media"))}


def clean_update(data: dict, row: dict, now: _dt.datetime | None = None) -> dict:
    """What an author may change: title, note, place, expiry (expires_at or expires_in_h, same caps)."""
    if not isinstance(data, dict):
        raise ValueError("an update is a JSON object")
    now = now or _utcnow()
    out = {}
    if "title" in data:
        out["title"] = _clean_text(data.get("title"), TITLE_MAX) or default_title(row["kind"], data.get("place") or row.get("place"))
    if "note" in data:
        out["note"] = str(data.get("note") or "").strip()[:NOTE_MAX] or None
    if "place" in data:
        out["place"] = _clean_text(data.get("place"), PLACE_MAX) or None
    if data.get("expires_at") not in (None, "") or data.get("expires_in_h") not in (None, ""):
        if data.get("expires_at") not in (None, ""):
            expires = parse_time(data.get("expires_at"))
            if expires is None:
                raise ValueError("expires_at is not a time")
        else:
            try:
                h = float(data.get("expires_in_h"))
            except (TypeError, ValueError):
                raise ValueError("expires_in_h is a number of hours")
            expires = now + _dt.timedelta(hours=h)
        if expires < now + _dt.timedelta(minutes=MIN_EXPIRY_MIN):
            raise ValueError(f"a report must hold at least {MIN_EXPIRY_MIN} minutes — end it instead")
        out["expires_at"] = iso(min(expires, now + _dt.timedelta(hours=MAX_EXPIRY_H)))
    return out


# ── the store ───────────────────────────────────────────────────────────────

DDL = """
CREATE TABLE IF NOT EXISTS field_reports (
    id               TEXT PRIMARY KEY,
    kind             TEXT NOT NULL,
    title            TEXT NOT NULL,
    note             TEXT,
    place            TEXT,
    lat              REAL NOT NULL,
    lon              REAL NOT NULL,
    occurred_at      TEXT NOT NULL,
    expires_at       TEXT NOT NULL,
    ended_at         TEXT,
    deleted_at       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT,
    author_user_id   TEXT NOT NULL,
    author_name      TEXT,
    audience         TEXT NOT NULL DEFAULT 'company',
    audience_company TEXT,
    shared_with      TEXT,
    media_json       TEXT
);
CREATE INDEX IF NOT EXISTS ix_field_reports_expires ON field_reports (expires_at);
CREATE INDEX IF NOT EXISTS ix_field_reports_author ON field_reports (author_user_id);
"""
_lock = threading.Lock()


def _db_path() -> str:
    try:
        from main import DATA_DIR
        return os.path.join(DATA_DIR, "akili.db")
    except Exception:                                        # noqa: BLE001
        return os.path.join(HERE, "data", "akili.db")


def _con(timeout: float = 30):
    con = sqlite3.connect(_db_path(), timeout=timeout)
    con.executescript(DDL)
    con.row_factory = sqlite3.Row
    return con


def ensure_table() -> None:
    """The additive migration, run at startup (and again, harmlessly, by every connection)."""
    con = _con()
    con.close()


def company_key(s: str | None) -> str | None:
    from routers.desk import company_key as _ck
    return _ck(s)


def can_read(row: dict, me: dict | None) -> bool:
    """The Desk's rule (routers/desk.can_read), on a report row. No session: only 'everyone'."""
    if not me:
        return row.get("audience") == "everyone"
    from routers.desk import can_read as _desk_can_read
    return _desk_can_read(SimpleNamespace(author_user_id=row.get("author_user_id"), audience=row.get("audience"),
                                          audience_company=row.get("audience_company"),
                                          shared_with=row.get("shared_with")), me)


def is_active(row: dict, now: _dt.datetime | None = None) -> bool:
    now = now or _utcnow()
    if row.get("ended_at") or row.get("deleted_at"):
        return False
    exp = parse_time(row.get("expires_at"))
    return bool(exp and exp > now)


def label_of(row: dict) -> str:
    return f"Reported by {row.get('author_name') or 'a user'}, unverified"


def _media_out(row: dict) -> list[dict]:
    try:
        media = json.loads(row.get("media_json") or "[]")
    except ValueError:
        media = []
    out = []
    for i, m in enumerate(media if isinstance(media, list) else []):
        if m.get("path"):
            out.append({"type": m.get("type") or "image", "url": f"/api/field-reports/{row['id']}/media/{i}",
                        "mime": m.get("mime"), "name": m.get("name")})
        elif m.get("url"):
            out.append({"type": m.get("type") or "image", "url": m["url"]})
    return out


def to_dict(row: dict, me: dict | None = None, now: _dt.datetime | None = None) -> dict:
    """The report as every reader gets it."""
    now = now or _utcnow()
    try:
        shared = json.loads(row.get("shared_with") or "[]")
    except ValueError:
        shared = []
    mine = bool(me and row.get("author_user_id") == me.get("id"))
    return {"id": row["id"], "kind": row["kind"], "kind_label": KIND_LABEL.get(row["kind"], "Report"), "title": row["title"],
            "note": row.get("note"), "place": row.get("place"), "lat": row["lat"], "lon": row["lon"],
            "occurred_at": iso(parse_time(row.get("occurred_at"))), "expires_at": iso(parse_time(row.get("expires_at"))),
            "ended_at": iso(parse_time(row.get("ended_at"))), "created_at": iso(parse_time(row.get("created_at"))),
            "author": {"id": row.get("author_user_id"), "name": row.get("author_name") or "a user"},
            "audience": row.get("audience"), "audience_company": row.get("audience_company") if mine else None,
            "shared_with": shared if mine else [], "media": _media_out(row), "mine": mine,
            "active": is_active(row, now), "label": label_of(row), "source_kind": "user", "verified": False}


def _rows(where: str = "", args=()) -> list[dict]:
    con = _con()
    try:
        return [dict(r) for r in con.execute(f"SELECT * FROM field_reports {where}", args).fetchall()]
    finally:
        con.close()


def _row(report_id: str) -> dict | None:
    rows = _rows("WHERE id=? AND deleted_at IS NULL", (str(report_id),))
    return rows[0] if rows else None


def create(me: dict, clean: dict, audience: tuple, now: _dt.datetime | None = None) -> dict:
    """Store a validated report. `audience` = (audience, audience_company, shared_with JSON or None), as
    routers/desk._audience_of resolves it."""
    now = now or _utcnow()
    rid = "fr_" + uuid.uuid4().hex[:12]
    a, co, shared = audience
    for m in clean.get("media") or []:
        if m.get("path") and not m["path"].startswith(_safe_seg(me["id"]) + "/"):
            raise ValueError("that media file is not yours")
    row = {"id": rid, "kind": clean["kind"], "title": clean["title"], "note": clean.get("note"), "place": clean.get("place"),
           "lat": clean["lat"], "lon": clean["lon"], "occurred_at": clean["occurred_at"], "expires_at": clean["expires_at"],
           "ended_at": None, "deleted_at": None, "created_at": iso(now), "updated_at": None,
           "author_user_id": me["id"], "author_name": (me.get("name") or me.get("email") or "a user").split("@")[0][:80],
           "audience": a, "audience_company": co, "shared_with": shared,
           "media_json": json.dumps(clean.get("media") or []) if clean.get("media") else None}
    with _lock:
        con = _con()
        try:
            cols = list(row)
            con.execute(f"INSERT INTO field_reports ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                        [row[c] for c in cols])
            con.commit()
        finally:
            con.close()
    return row


def _safe_seg(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", s or "")[:64] or "_"


def active_for(me: dict | None, now: _dt.datetime | None = None, bbox: tuple | None = None) -> list[dict]:
    """The reports this user may read that are active now, newest first. bbox = (south, west, north, east)."""
    now = now or _utcnow()
    rows = _rows("WHERE deleted_at IS NULL AND ended_at IS NULL AND expires_at > ? ORDER BY occurred_at DESC LIMIT 2000",
                 (iso(now),))
    out = []
    for r in rows:
        if not is_active(r, now) or not can_read(r, me):
            continue
        if bbox:
            s, w, n, e = bbox
            if not (s <= r["lat"] <= n and (w <= r["lon"] <= e if w <= e else (r["lon"] >= w or r["lon"] <= e))):
                continue
        out.append(to_dict(r, me, now))
    return out


def get_visible(report_id: str, me: dict | None) -> dict | None:
    """The row, or None when it does not exist or is not this user's to read (the same answer)."""
    r = _row(report_id)
    return r if r and can_read(r, me) else None


def update(report_id: str, me: dict, changes: dict, now: _dt.datetime | None = None) -> dict:
    now = now or _utcnow()
    if not changes:
        return _row(report_id)
    sets = ", ".join(f"{k}=?" for k in changes) + ", updated_at=?"
    with _lock:
        con = _con()
        try:
            con.execute(f"UPDATE field_reports SET {sets} WHERE id=?", [*changes.values(), iso(now), report_id])
            con.commit()
        finally:
            con.close()
    return _row(report_id)


def end(report_id: str, now: _dt.datetime | None = None) -> dict:
    now = now or _utcnow()
    with _lock:
        con = _con()
        try:
            con.execute("UPDATE field_reports SET ended_at=COALESCE(ended_at, ?), updated_at=? WHERE id=?", (iso(now), iso(now), report_id))
            con.commit()
        finally:
            con.close()
    return _row(report_id)


def delete(report_id: str, now: _dt.datetime | None = None) -> None:
    now = now or _utcnow()
    with _lock:
        con = _con()
        try:
            con.execute("UPDATE field_reports SET deleted_at=? WHERE id=?", (iso(now), report_id))
            con.commit()
        finally:
            con.close()


def media_file(row: dict, n: int) -> dict | None:
    try:
        media = json.loads(row.get("media_json") or "[]")
        m = media[n]
    except (ValueError, IndexError, TypeError):
        return None
    return m if isinstance(m, dict) and m.get("path") else None


# ── feeds ───────────────────────────────────────────────────────────────────

def _public_active(now: _dt.datetime) -> list[dict]:
    """Active reports to 'everyone': the only ones a shared (unscoped) feed may carry."""
    try:
        rows = _rows("WHERE deleted_at IS NULL AND ended_at IS NULL AND audience='everyone' AND expires_at > ?"
                     " ORDER BY occurred_at DESC LIMIT 500", (iso(now),))
    except sqlite3.Error as e:
        print(f"[field-reports] error: read: {type(e).__name__}: {e}", flush=True)
        return []
    return [r for r in rows if is_active(r, now)]


def signal_of(row: dict, now: _dt.datetime | None = None) -> dict:
    """A report in live_signals' shape, source_kind 'user': labelled, unverified, never an independent source."""
    import live_incident as li
    now = now or _utcnow()
    act = ACT.get(row["kind"], "other")
    label = label_of(row)
    occurred = iso(parse_time(row.get("occurred_at")))
    media = [{"kind": m["type"], "thumb_url": m["url"] if m["type"] == "image" else None,
              "video_url": m["url"] if m["type"] == "video" else None, "media_url": m["url"], "graphic": False}
             for m in _media_out(row)]
    return {
        "id": f"fr-{row['id']}", "kind": "live_signal", "source_kind": "user", "report_id": row["id"],
        "report_kind": row["kind"], "act": act, "act_label": KIND_LABEL.get(row["kind"], "Report"), "title": row["title"],
        "lines": [], "count": 1, "place": row.get("place"), "context": [], "country_code": None,
        "lat": row["lat"], "lon": row["lon"], "event_time": occurred, "first_event_time": occurred,
        "posted_at": iso(parse_time(row.get("created_at"))), "expires_at": iso(parse_time(row.get("expires_at"))), "live": True,
        "messages": [{"posted_at": iso(parse_time(row.get("created_at"))), "event_time": occurred, "channel_title": label,
                      "text": row.get("note") or row["title"], "translated": False, "url": None}],
        "corroboration": {"level": "unverified", "n_sources": 1, "first_hand": True, "with_media": bool(media),
                          "line": label, "independent": False, "user_reports": 1},
        "muted": act in li.HIGH_IMPACT, "high_impact": act in li.HIGH_IMPACT,
        "media": media[0] if media else None, "all_media": media, "direction": None,
        "sources": [{"channel_title": label, "posted_at": iso(parse_time(row.get("created_at"))), "url": None}],
        "channels": [], "msg_id": None, "channel": None, "label": label, "verified": False,
        "author": {"id": row.get("author_user_id"), "name": row.get("author_name") or "a user"},
        "refs": [f"user:{row['id']}"],
    }


def add_to_signals(sigs: list[dict], now: _dt.datetime | None = None) -> list[dict]:
    """live_signals.signals() plus the active reports to 'everyone' (a new list; newest first)."""
    now = now or _utcnow()
    extra = [signal_of(r, now) for r in _public_active(now)]
    if not extra:
        return sigs
    out = list(sigs) + extra
    out.sort(key=lambda s: s.get("event_time") or "", reverse=True)
    return out


def event_members(now: _dt.datetime | None = None) -> list[dict]:
    """Active reports to 'everyone', for events.reconcile (they join an event, kind 'user')."""
    now = now or _utcnow()
    return [{"ref": f"user:{r['id']}", "kind": "user", "act": ACT.get(r["kind"]), "lat": r["lat"], "lon": r["lon"],
             "at": r["occurred_at"], "label": f"{r['title']} ({label_of(r)})"} for r in _public_active(now)]


def protest_items(me: dict | None, now: _dt.datetime | None = None) -> list[dict]:
    """The user's visible police / crowd / clashes reports as Protests-layer 'live' items (protests.py's shape)."""
    import protests as pr
    now = now or _utcnow()
    if me:
        try:                                                   # removed from their company's desk: no company
            from routers.desk import desk_identity
            me = desk_identity(me)
        except Exception as e:                                 # noqa: BLE001
            print(f"[field-reports] error: desk identity: {type(e).__name__}: {e}", flush=True)
    out = []
    for d in active_for(me, now):
        kind = PROTEST_KIND.get(d["kind"])
        if not kind:
            continue
        t = parse_time(d["occurred_at"])
        z = pr.zone(None)
        out.append(pr._base(id=f"pr-fr-{d['id']}", frame="live", kind=kind, act=ACT[d["kind"]], title=d["title"],
                            line=d["label"], when=f"{pr.hhmm(t, z)}, {pr.ago(t, now)}", lat=d["lat"], lon=d["lon"],
                            place=d["place"], first_seen=d["occurred_at"], last_update=d["occurred_at"],
                            corroboration={"level": "unverified", "n_sources": 1, "line": d["label"], "independent": False},
                            sources=[{"channel_title": d["label"], "posted_at": d["created_at"], "url": None}],
                            messages=[{"hhmm": pr.hhmm(t, z), "at": d["occurred_at"], "text": d["note"] or d["title"],
                                       "translated": False, "channel_title": d["label"], "url": None}],
                            live=True, muted=False, refs=[f"user:{d['id']}"], source_kind="user", report_id=d["id"],
                            expires_at=d["expires_at"], label=d["label"], author=d["author"], mine=d["mine"]))
    return out
