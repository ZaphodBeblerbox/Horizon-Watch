"""
event_watch.py — announced events and live developments, as notifications
for the people they concern.

WHO IS TOLD. An announced march at Bastille matters to someone whose
office is on Rue de la Roquette, to someone watching Paris, to someone who
added France to their interests — and to nobody else. So each event is
held against each user's own:
  - assets: within the asset's watch radius (at least 5 km);
  - theaters: inside the framed view (camera height × 0.9 km, at least
    350 km — the same reach src/state/interests.js gives a theater);
  - countries they added in Settings › Your interests.
The card says which one fired, in `reason`, like every other card.

WHAT THEY ARE TOLD, AND WHEN.
  - when it is announced: one card per post, however many places the post
    names, listing the ones that concern this user ("Rallies called in 23
    places, Sat 14:00 — Paris (République), Lyon (Bellecour), Nantes …");
  - before it starts: 90 minutes ahead when the hour is known, at 07:00 on
    the day when it is not ("Today 15:00: student march at Place de la
    Bastille — starts in 85 min"), one card per place;
  - while it happens: a live development (a kettle forming, reinforcements
    sent, a withdrawal) the moment it is read.
Each card carries what is likely to happen and what to do, both naming the
place (telegram_events drops them otherwise).

PUSH. sweep() runs every minute and sends each new card once to the user's
devices (main._send_push), so a reminder reaches a phone in a pocket.
"""
from __future__ import annotations

import datetime as _dt
import math
import re
import threading
import time

REMIND_BEFORE_MIN = 90
MORNING_HOUR = 7
NEW_ANNOUNCEMENT_HOURS = 48
PUSH_FRESH_MIN = 15          # notificationStore.MAX_INTERRUPT_AGE_MS: nothing older pops up either
CAPS = {"announcement": 8, "reminder": 6, "live": 10}

_lock = threading.Lock()
_events_cache: dict = {"at": 0.0, "ann": [], "now": []}
EVENTS_TTL_S = 60


# The rule itself — what concerns a user — lives in user_concern.py, shared
# with the per-user filter on the maps and lists (owner, 2026-10-22), so the
# two cannot drift. Re-exported here: callers and tests use these names.
from user_concern import (CONCERN_TTL_S, _concern_cache, concern_of, km, regions_table,  # noqa: E402,F401
                          theater_reach_km, why)


# ── the events ──────────────────────────────────────────────────────────────

def _events() -> tuple[list, list]:
    with _lock:
        if time.time() - _events_cache["at"] < EVENTS_TTL_S:
            return _events_cache["ann"], _events_cache["now"]
    import telegram_events as te
    try:
        ann, now = te.announcements(), te.situations()
    except Exception as e:                                     # noqa: BLE001
        print(f"[event_watch] events: {type(e).__name__}: {e}", flush=True)
        ann, now = [], []
    with _lock:
        _events_cache.update(at=time.time(), ann=ann, now=now)
    return ann, now


def _utc(s: str | None) -> _dt.datetime | None:
    if not s:
        return None
    try:
        d = _dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)


def _iso(d: _dt.datetime) -> str:
    return d.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _short(place: str | None) -> str:
    parts = [p.strip() for p in (place or "").split(",") if p.strip()]
    return ", ".join(parts[:2]) or "the place named"


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def remind_window(ev: dict, now: _dt.datetime) -> tuple[_dt.datetime, _dt.datetime] | None:
    """When the reminder for this event shows: from 90 minutes before a
    timed start until the start; on a date-only day from 07:00 to 20:00
    local (UTC when the zone is not known)."""
    start = _utc(ev.get("starts_utc"))
    if start:
        return start - _dt.timedelta(minutes=REMIND_BEFORE_MIN), start
    day = (ev.get("starts_at") or "")[:10]
    try:
        d = _dt.date.fromisoformat(day)
    except ValueError:
        return None
    zone = _dt.timezone.utc
    if ev.get("tz"):
        try:
            from zoneinfo import ZoneInfo
            zone = ZoneInfo(ev["tz"])
        except Exception:                                      # noqa: BLE001
            pass
    a = _dt.datetime(d.year, d.month, d.day, MORNING_HOUR, tzinfo=zone)
    b = _dt.datetime(d.year, d.month, d.day, 20, tzinfo=zone)
    return a, b


def _local_hhmm(ev: dict) -> str | None:
    s = ev.get("starts_at") or ""
    return s[11:16] if "T" in s else None


def cards_for(uid: str, now: _dt.datetime | None = None) -> list[dict]:
    now = now or _dt.datetime.now(_dt.timezone.utc)
    c = concern_of(uid)
    if not (c["assets"] or c["theaters"] or c["countries"]):
        return []
    ann, live = _events()
    cards: list[dict] = []

    # Announced: one card per post, listing the places that concern this user.
    fresh_after = now - _dt.timedelta(hours=NEW_ANNOUNCEMENT_HOURS)
    by_post: dict[str, list] = {}
    for ev in ann:
        posted = _utc(ev.get("posted_at"))
        if not posted or posted < fresh_after:
            continue
        w = why(ev, c)
        if w:
            by_post.setdefault(ev["post_id"], []).append((ev, w))
    rank = {"asset": 0, "theater": 1, "country": 2}
    new_cards = []
    for post_id, evs in by_post.items():
        evs.sort(key=lambda x: (rank[x[1][1]], x[0]["starts_at"]))
        ev, (reason, strength) = evs[0]
        what = ev["what"] or "gathering"
        who = f"{ev['organiser']}: " if ev.get("organiser") else ""
        if len(evs) == 1:
            title = f"{who}{_cap(what)} announced at {_short(ev['place'])} — {ev['when_label']}"
        else:
            places = [_short(e["place"]).split(",")[0] for e, _w in evs]
            more = f" and {len(places) - 3} more" if len(places) > 3 else ""
            title = f"{who}{_cap(what)} called in {len(places)} places that concern you — {ev['when_label']}: {', '.join(places[:3])}{more}"
        new_cards.append({
            "id": f"ann:{post_id}", "title": title, "kind": "announcement", "alert_type": "Announced",
            "sev": "high" if strength == "asset" else "moderate",
            "reason": reason + (f" · {len(evs)} places" if len(evs) > 1 else ""),
            "expect": ev.get("expect"), "advice": ev.get("advice"),
            "lat": ev["lat"], "lon": ev["lon"], "source": ev.get("channel_title") or ev.get("channel"),
            "url": ev.get("url"), "starts_at": ev["starts_at"], "notify": True,
            "created_at": ev["posted_at"],
            "places": [{"place": e["place"], "when": e["when_label"], "lat": e["lat"], "lon": e["lon"]} for e, _w in evs[:40]],
        })
    new_cards.sort(key=lambda x: x["created_at"], reverse=True)
    cards += new_cards[:CAPS["announcement"]]

    # Before it starts: one card per place.
    soon = []
    for ev in ann:
        win = remind_window(ev, now)
        if not win or not (win[0] <= now < win[1]):
            continue
        w = why(ev, c)
        if not w:
            continue
        hhmm = _local_hhmm(ev)
        start = _utc(ev.get("starts_utc"))
        lead = f" — starts in {max(1, round((start - now).total_seconds() / 60))} min" if start else ""
        title = (f"Today {hhmm}: {ev['what']} at {_short(ev['place'])}{lead}" if hhmm
                 else f"Today: {ev['what']} at {_short(ev['place'])}")
        soon.append({
            "id": f"soon:{ev['id']}", "title": title, "kind": "announcement", "alert_type": "Starting soon",
            "sev": "high", "reason": w[0], "expect": ev.get("expect"), "advice": ev.get("advice"),
            "lat": ev["lat"], "lon": ev["lon"], "source": ev.get("channel_title") or ev.get("channel"),
            "url": ev.get("url"), "starts_at": ev["starts_at"], "notify": True,
            "created_at": _iso(win[0]), "_rank": (rank[w[1]], ev["starts_at"]),
        })
    soon.sort(key=lambda x: x.pop("_rank"))
    cards += soon[:CAPS["reminder"]]

    # Happening now.
    nows = []
    for ev in live:
        w = why(ev, c)
        if not w:
            continue
        nows.append({
            "id": f"now:{ev['id']}", "title": ev["happening"], "kind": "live", "alert_type": "On the ground now",
            "sev": "critical" if w[1] == "asset" else "high", "reason": w[0],
            "expect": ev.get("expect"), "advice": ev.get("advice"),
            "lat": ev["lat"], "lon": ev["lon"], "source": ev.get("channel_title") or ev.get("channel"),
            "url": ev.get("url"), "notify": True, "created_at": ev["posted_at"],
        })
    cards += nows[:CAPS["live"]]

    # An announced protest seen on the ground (protest_status.py): "Ongoing ·
    # since 14:00 (reports 3 min ago): protest march at Place de la République
    # — est. 1,500–3,000 · from 3 photos + 2 reports". Once per status, and
    # only on reports from there (the clock alone was the reminder's job).
    # The announcement's own card says where it stands too.
    try:
        import protest_status as ps
        idx = ps.by_post()
        for card in new_cards[:CAPS["announcement"]]:
            ch, _, mid = card["id"][4:].rpartition("/")         # "ann:<channel>/<msg_id>"
            p = idx.get((ch, int(mid))) if mid.isdigit() else None
            if p:
                card["status_label"] = p["status_label"]
                card["protest_status"] = ps.status_brief(p)
                if p["status"]["key"] in ps.OVER:
                    card["_over"] = True                       # its gathering is over: no longer a card
        cards[:] = [x for x in cards if not x.pop("_over", False)]
        seen_p = set()
        for p in idx.values():
            st = p["status"]
            if p["id"] in seen_p or st["key"] not in ("starting", "ongoing", "dispersing") or st.get("basis") != "evidence":
                continue
            seen_p.add(p["id"])
            w = why({"lat": p["lat"], "lon": p["lon"], "country_code": p.get("country_code")}, c)
            if not w:
                continue
            crowd = (p.get("crowd") or {}).get("label")
            cards.append({
                "id": f"protest:{p['id']}:{st['key']}", "kind": "live", "alert_type": "Protest, now",
                "title": f"{p['status_label']}: {p['title'][:1].lower()}{p['title'][1:]}" + (f" — {crowd}" if crowd else ""),
                "sev": "high" if w[1] == "asset" else "moderate", "reason": w[0],
                "lat": p["lat"], "lon": p["lon"], "source": (p["sources"][0].get("channel_title") if p["sources"] else None),
                "url": p["sources"][0].get("url") if p["sources"] else None, "notify": st["key"] != "dispersing",
                "created_at": st.get("last_report_at") or _iso(now), "status_label": p["status_label"],
                "protest_status": ps.status_brief(p),
            })
    except Exception as e:                                     # noqa: BLE001
        print(f"[event_watch] error: protest status: {type(e).__name__}: {e}", flush=True)

    # Calls for armed conflict rising on Telegram about a country this user
    # has an asset in, a theater over, or an interest in
    # (telegram_mood_alert.py): the alert's own card, with their reason.
    try:
        import telegram_mood_alert as tma
        cards += tma.cards_for(c)
    except Exception as e:                                     # noqa: BLE001
        print(f"[tg-mood] error: cards for {uid}: {type(e).__name__}: {e}", flush=True)
    # Public calls to block or act at a place within 25 km of their asset or
    # of where they are, and the count inside each theater
    # (endangered_places.py).
    try:
        import endangered_places as ep
        cards += ep.cards_for(c, now)
    except Exception as e:                                     # noqa: BLE001
        print(f"[endangered] error: cards for {uid}: {type(e).__name__}: {e}", flush=True)
    # a demonstration whose last activity is over 24 h old is not a card any
    # more (owner, 2026-10-19; demo_freshness.py): announcements and protests
    import demo_freshness as dfr
    return [x for x in cards if not ((x.get("kind") == "announcement" or str(x.get("id") or "").startswith("protest:"))
                                     and dfr.stale({**x, "kind": "announcement"}, now))]


def notifications_for(uid: str | None) -> list[dict]:
    if not uid:
        return []
    try:
        return cards_for(str(uid))
    except Exception as e:                                     # noqa: BLE001
        print(f"[event_watch] cards for {uid}: {type(e).__name__}: {e}", flush=True)
        return []


# ── push, once per card ─────────────────────────────────────────────────────

def _push_con():
    import sqlite3
    import telegram_ingest as tg
    con = sqlite3.connect(tg._db_path(), timeout=30)
    con.execute("CREATE TABLE IF NOT EXISTS event_pushes (user_id TEXT NOT NULL, item_id TEXT NOT NULL,"
                " sent_at TEXT, PRIMARY KEY (user_id, item_id))")
    return con


def _ensure_push_log(con) -> None:
    """What was actually sent (the hourly cap, the per-event spacing, the digest's "never pushed")."""
    con.execute("CREATE TABLE IF NOT EXISTS push_log (user_id TEXT NOT NULL, item_id TEXT NOT NULL, event_key TEXT,"
                " priority TEXT, kind TEXT, flash INTEGER DEFAULT 0, sent_at TEXT NOT NULL)")
    con.execute("CREATE INDEX IF NOT EXISTS ix_push_log_user ON push_log(user_id, sent_at)")


# ── events: per-user priority, the update rule, alert fatigue (DATAMINR_PLAN B2, B4) ──
#
# WHO IS TOLD, AND WHEN (one server rule for the phone's push and the desktop's notification):
#   * a NEW event: the first time it reaches the user's threshold for where it is (their assets, a theater,
#     a country; default Urgent near assets and in theaters, Critical for countries) — card id ev:<id>;
#   * a SIGNIFICANT update (events.changes: a graver act, corroboration up, a casualty number, a move, priority
#     up): card id ev:<id>:v<n>, its push carries data.id = ev:<id> so the phone REPLACES the earlier notification
#     (public/sw-push.js tag) and the app replaces the earlier card (notificationStore eventKey);
#   * everything else is silent: the card in the feed says "Updated 14:32 · v3".
# FATIGUE (settings.interests.alerts, Settings › Alerts and the assistant):
#   thresholds per scope ("assets", "theaters", "countries", "theater:<id>"), mutes of an event or an area
#   (a Critical event near an asset still gets through an area mute unless `hard`), quiet hours (Critical only),
#   at most HOURLY_CAP pushes an hour (Critical and safety excluded; the rest as one "N more"), one push per
#   event per EVENT_SPACING_MIN (except a rise to Critical), and a digest at 07:00 and 19:00 local listing what
#   concerned the user and never pushed.
DEFAULT_THRESHOLDS = {"assets": "urgent", "theaters": "urgent", "countries": "flash"}
SCOPE_KEY = {"asset": "assets", "theater": "theaters", "country": "countries"}
EVENT_SPACING_MIN = 20
EVENT_PUSH_FRESH_MIN = 45
HOURLY_CAP = 6
MORE_SPACING_MIN = 15
DIGEST_HOURS = (7, 19)
DIGEST_WINDOW_MIN = 15
DIGEST_LOOKBACK_H = 12
SAFETY_KINDS = {"exit", "warning", "message"}              # never held by quiet hours or the hourly cap
PUSH_TITLE = {"flash": "Critical alert", "urgent": "Urgent", "alert": "Alert"}
LEVELS = ("alert", "urgent", "flash")


def _zone(name: str | None):
    if not name:
        return None
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(str(name))
    except Exception:                                          # noqa: BLE001
        return None


def _hhmm_ok(s) -> bool:
    return isinstance(s, str) and bool(re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", s))


def validate_alerts(a) -> dict:
    """settings.interests.alerts as the server stores it: unknown keys and bad values dropped (PATCH validation)."""
    if not isinstance(a, dict):
        return {}
    out: dict = {}
    th = a.get("thresholds")
    if isinstance(th, dict):
        out["thresholds"] = {str(k)[:80]: v for k, v in th.items()
                             if v in LEVELS + ("off",) and (k in SCOPE_KEY.values() or str(k).startswith("theater:"))}
    if isinstance(a.get("level"), str):
        out["level"] = a["level"][:32]
    mutes = []
    for m in a.get("mutes") or []:
        if not isinstance(m, dict) or not isinstance(m.get("until"), str) or _utc(m.get("until")) is None:
            continue
        if m.get("event_id"):
            mutes.append({"event_id": str(m["event_id"])[:64], "until": m["until"]})
        else:
            try:
                lat, lon, r = float(m["lat"]), float(m["lon"]), float(m.get("radius_km") or 5)
            except (KeyError, TypeError, ValueError):
                continue
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                mutes.append({"lat": lat, "lon": lon, "radius_km": max(0.5, min(r, 500.0)), "until": m["until"],
                              "hard": bool(m.get("hard")), "label": str(m.get("label") or "")[:80] or None})
    if "mutes" in a:
        out["mutes"] = mutes[-50:]
    q = a.get("quiet_hours")
    if q is None and "quiet_hours" in a:
        out["quiet_hours"] = None
    elif isinstance(q, dict) and _hhmm_ok(q.get("start")) and _hhmm_ok(q.get("end")):
        out["quiet_hours"] = {"start": q["start"], "end": q["end"], "tz": q.get("tz") if _zone(q.get("tz")) else None,
                              "enabled": q.get("enabled", True) is not False}
    if "hourly_cap" in a:
        try:
            out["hourly_cap"] = max(1, min(int(a["hourly_cap"]), 60))
        except (TypeError, ValueError):
            pass
    if "digest" in a:
        out["digest"] = bool(a["digest"])
    if _zone(a.get("tz")):
        out["tz"] = a["tz"]
    return out


def alert_rules(c: dict, uid: str | None = None) -> dict:
    """The user's rules with defaults filled in."""
    a = validate_alerts((c or {}).get("alerts") or {})
    th = dict(DEFAULT_THRESHOLDS)
    th.update(a.get("thresholds") or {})
    q = a.get("quiet_hours") if (a.get("quiet_hours") or {}).get("enabled", True) else None
    tz = _zone(a.get("tz")) or _zone((q or {}).get("tz")) or _zone(_attention_tz(uid)) or _dt.timezone.utc
    return {"thresholds": th, "mutes": a.get("mutes") or [], "quiet_hours": q, "hourly_cap": a.get("hourly_cap", HOURLY_CAP),
            "digest": a.get("digest", True), "tz": tz}


def _attention_tz(uid: str | None) -> str | None:
    """The time zone the user's own app reported with its attention heartbeat (attention.py)."""
    if not uid:
        return None
    try:
        import attention
        return attention.tz_of(uid)
    except Exception:                                          # noqa: BLE001
        return None


def threshold_for(rules: dict, pr: dict) -> str:
    if pr.get("scope") == "theater" and pr.get("theater_id") and f"theater:{pr['theater_id']}" in rules["thresholds"]:
        return rules["thresholds"][f"theater:{pr['theater_id']}"]
    return rules["thresholds"].get(SCOPE_KEY.get(pr.get("scope"), "countries"), "flash")


def muted_by(rules: dict, item: dict, pr: dict | None, now: _dt.datetime) -> str | None:
    """Why this item is muted for the user, or None."""
    eid = item.get("event_id")
    for m in rules["mutes"]:
        until = _utc(m.get("until"))
        if not until or until <= now:
            continue
        if m.get("event_id"):
            if eid and m["event_id"] == eid:
                return "you muted this event"
            continue
        if item.get("lat") is None or item.get("lon") is None:
            continue
        if km(m["lat"], m["lon"], float(item["lat"]), float(item["lon"])) <= m["radius_km"]:
            if pr and pr.get("priority") == "flash" and pr.get("scope") == "asset" and not m.get("hard"):
                continue                                       # Critical near an asset gets through a soft area mute
            return f"you muted {m.get('label') or 'this area'}"
    return None


def in_quiet_hours(rules: dict, now: _dt.datetime) -> bool:
    q = rules.get("quiet_hours")
    if not q:
        return False
    tz = _zone(q.get("tz")) or rules["tz"]
    local = now.astimezone(tz).strftime("%H:%M")
    a, b = q["start"], q["end"]
    return (a <= local < b) if a <= b else (local >= a or local < b)


def _event_views(hours: float = 12.0) -> dict:
    try:
        import events
        return {v["id"]: v for v in events.recent_shared(hours)}
    except Exception as e:                                     # noqa: BLE001
        print(f"[event_watch] error: events: {type(e).__name__}: {e}", flush=True)
        return {}


def _follows_of(uid: str | None) -> list[dict]:
    if not uid:
        return []
    try:
        import events
        con = events.connect()
        try:
            return events.follows_of(con, str(uid))
        finally:
            con.close()
    except Exception as e:                                     # noqa: BLE001
        print(f"[event_watch] error: follows of {uid}: {type(e).__name__}: {e}", flush=True)
        return []


def personalize(items: list[dict], uid: str | None, c: dict | None = None, now: _dt.datetime | None = None,
                views: dict | None = None, follows: list[dict] | None = None) -> list[dict]:
    """The event cards of a feed, made this user's: per-user priority (Critical / Urgent / Alert) and why, the
    update's id (ev:<id>:v<n>, the latest significant version), and whether it notifies (`ev_notify`: at the
    user's threshold, not muted, not ended, Critical only in quiet hours). Copies; other cards untouched."""
    if not items or not any(it.get("event_id") for it in items):
        return items
    now = now or _dt.datetime.now(_dt.timezone.utc)
    c = c if c is not None else (concern_of(str(uid)) if uid else {"assets": [], "theaters": [], "countries": set(), "topics": set()})
    rules = alert_rules(c, uid)
    views = _event_views() if views is None else views
    import events
    if follows is None:
        follows = _follows_of(uid)
    followed = events.followed_ids(follows, views.values()) if follows else set()
    out = []
    for it in items:
        eid = it.get("event_id")
        v = views.get(eid) if eid else None
        if not v:
            out.append(it)
            continue
        card = dict(it)
        pr = events.priority_for(v, c)
        head = v.get("headline") or card.get("title")
        corr = (v.get("corroboration") or {}).get("line")
        b = v.get("brief") or {}
        sig = v.get("significant_brief") or {}
        card.update({"event_key": f"ev:{eid}", "event_status": v["status"], "first_seen": v["first_seen"],
                     "last_update": v["last_update"], "brief_version": b.get("version"), "brief_summary": b.get("summary"),
                     "title": head})
        if pr:
            card.update({"sev": pr["sev"], "priority": pr["priority"], "priority_label": pr["label"],
                         "alert_type": pr["label"], "reason": " · ".join(x for x in (pr["why"], corr) if x)})
        if sig.get("version", 0) > 1:
            card["id"] = f"ev:{eid}:v{sig['version']}"
            card["update"] = True
            card["what_changed"] = sig.get("what_changed")
            card["created_at"] = sig.get("created_at") or card.get("created_at")
        else:
            card["id"] = f"ev:{eid}"
            card["update"] = False
        is_followed = eid in followed
        card["followed"] = is_followed
        if is_followed and not pr:
            card["reason"] = " · ".join(x for x in ("You follow it", corr) if x)
        why = pr["why"] if pr else ("you follow it" if is_followed else (card.get("reason") or ""))
        level = PUSH_TITLE.get((pr or {}).get("priority"), "Followed" if is_followed else "On the ground now")
        # NEW EVENT vs UPDATE, said in so many words (owner, 2026-10-23)
        card["push_title"] = f"{'Update' if card['update'] else 'New event'} · {level}"
        card["alert_type"] = card["push_title"]
        card["push_body_new"] = " — ".join(x for x in (head, why) if x)[:220]
        card["push_body"] = (f"Update: {card.get('what_changed') or 'new reports'}. {card['push_body_new']}"[:220]
                             if card["update"] else card["push_body_new"])
        if card["update"]:
            card["title"] = f"Update: {card.get('what_changed') or 'new reports'} — {head}"[:200]
        reason = None
        if not pr and not is_followed:
            reason = "outside your profile"
        elif v["status"] in ("ended", "contradicted") and not (is_followed and v["status"] == "contradicted"):
            reason = f"{v['status']}"
        elif not is_followed and not events.at_least(pr["priority"], threshold_for(rules, pr)):
            reason = f"below your threshold ({threshold_for(rules, pr)})"
        else:
            reason = muted_by(rules, card, pr, now)
            if not reason and in_quiet_hours(rules, now) and (pr or {}).get("priority") != "flash":
                reason = "quiet hours (Critical only)"
        card["ev_notify"] = reason is None
        card["silent_reason"] = reason
        card["muted"] = bool(reason and reason.startswith("you muted"))
        out.append(card)
    return out


def push_body(card: dict) -> str:
    return " · ".join(x for x in (card.get("advice") or card.get("expect"), card.get("reason")) if x)[:220]


# What pops up on screen (src/state/notificationStore.js interrupts()) is
# what goes to a closed app: the same rule, so the two cannot disagree.
# "message" and "desk" (inbox_notify.py, owner 2026-10-19): a chat message
# for you, a new post on your desk — personal, so they exist only in the feed
# of the people they are for.
INTERRUPT_KINDS = {"escalate", "assign", "rfi", "telegram", "surge", "fusion", "live", "livestream", "exit", "warning",
                   "message", "desk"}


def interrupts(card: dict) -> bool:
    sev, kind = card.get("sev"), card.get("kind") or "signal"
    return (sev == "critical" or kind in INTERRUPT_KINDS
            or (kind == "signal" and sev == "high") or (kind == "announcement" and sev == "high"))


PUSH_SINGLES = 2      # pushed one by one per sweep; the rest go as one "and N more"
APP_NAME = "Parallax"


def _own(card: dict) -> bool:
    """A card already made for this user: their events, their assets."""
    return str(card.get("id") or "").startswith(("ann:", "soon:", "now:", "asset:", "exit:")) or card.get("kind") in ("asset", "exit")


def worth_pushing(card: dict, c: dict) -> bool:
    """The shared feed (frontlines, surges, risk moves) is the same for
    everyone; on a locked phone only what touches this user's assets,
    theaters or countries — or is critical — earns a buzz. Measured
    2026-10-10: without this one sweep sent eleven Yemen frontline changes
    at once to a user who watches Paris."""
    # a channel we read going live is rare and for everyone (telegram_live.py)
    if _own(card) or card.get("sev") == "critical" or card.get("kind") == "livestream":
        return True
    return why(card, c) is not None


def notifies(card: dict, c: dict) -> bool:
    """WHAT A NOTIFICATION IS — the one rule for every device with the app
    closed (phone push, the desktop app's macOS notification): whatever
    would take the desktop's screen (interrupts). THE PHONE GETS WHAT THE
    DESKTOP GETS (owner, 2026-10-10), so relevance (worth_pushing) no
    longer narrows it; a burst is still bundled (bundle) into two pushes
    and an "N more".

    AN EVENT (DATAMINR_PLAN B2/B4): what personalize() decided (`ev_notify`): new or significantly updated, at
    the user's threshold, not muted, Critical only in quiet hours. Other cards: an area the user muted and
    quiet hours (Critical and safety cards only) hold them back too."""
    if card.get("event_id") and "ev_notify" in card:
        return bool(card["ev_notify"])
    if not interrupts(card):
        return False
    if (card.get("kind") or "") in SAFETY_KINDS or c is None:
        return True
    try:
        rules = alert_rules(c)
        now = _dt.datetime.now(_dt.timezone.utc)
        if muted_by(rules, card, None, now):
            return False
        if card.get("sev") != "critical" and in_quiet_hours(rules, now):
            return False
    except Exception as e:                                     # noqa: BLE001
        print(f"[event_watch] error: alert rules: {type(e).__name__}: {e}", flush=True)
    return True


# The notification's title: what kind of thing it is, in a few words —
# the same names the app's own cards use (notificationStore.js KIND).
KIND_LABEL = {"escalate": "Escalation", "assign": "Assigned to you", "rfi": "Request for information",
              "telegram": "Telegram report", "surge": "Surge", "fusion": "Fusion point", "live": "On the ground now",
              "livestream": "Live on Telegram", "announcement": "Announced", "asset": "Near your asset", "exit": "Leave now", "warning": "WARNING",
              "confirm": "Confirmed", "detector": "Detector", "signal": "Signal",
              "message": "Message", "desk": "On the Desk"}


def label_for(card: dict) -> str:
    # a card that knows its own title (a message: who, and in which chat)
    if card.get("push_title"):
        return str(card["push_title"])[:120]
    kind = card.get("kind") or "signal"
    if card.get("sev") == "critical" and kind in ("signal", "detector", "confirm"):
        return "Critical alert"
    label = KIND_LABEL.get(kind, "Notification")
    return f"Critical · {label}" if card.get("sev") == "critical" else label


def body_for(card: dict) -> str:
    """The headline, then its context (where, why) when that adds something."""
    if card.get("push_body"):
        return str(card["push_body"])[:220]
    head = str(card.get("title") or "").strip()
    ctx = str(card.get("reason") or card.get("region") or "").strip()
    return (f"{head} — {ctx}" if ctx and ctx.lower() not in head.lower() else head)[:220]


# russia_loiter_watch.ALERT_TYPE (not imported: that module pulls in the
# AIS geometry this one never needs).
VESSEL_THREAT_TYPE = "Russia-linked vessel loitering"
_RUL_ID = re.compile(r"(?:^|[^A-Z])RUL-(\d{6,})-")


def mmsi_of(card: dict) -> str | None:
    """The MMSI of a vessel-of-concern card, so a click opens the vessel
    itself even before (or without) the alert being fetched: the card's own
    mmsi, its entity id when it is that alert type, else the one in its id
    (RUL-<mmsi>-<episode start>)."""
    m = str(card.get("mmsi") or "").strip()
    if m.isdigit() and len(m) >= 6:
        return m
    if card.get("alert_type") == VESSEL_THREAT_TYPE:
        e = str(card.get("entity_id") or "").strip()
        if e.isdigit() and len(e) >= 6:
            return e
    hit = _RUL_ID.search(str(card.get("id") or ""))
    return hit.group(1) if hit else None


def bundle(cards: list[dict]) -> list[tuple[str, str, dict]]:
    """(title, body, data) to send: the first PUSH_SINGLES as themselves,
    the rest as one summary, so a burst is one buzz, not twelve."""
    rank = {"critical": 0, "high": 1}
    cards = sorted(cards, key=lambda x: (rank.get(x.get("sev"), 2), str(x.get("created_at") or "")))
    # WHAT A CLOSED APP SHOWS (owner, 2026-10-11): the system already says
    # "from Parallax" beside the X, so the title is only what KIND of
    # notification it is ("Critical alert", "Telegram report") and the text
    # under it carries the headline and its context. The data says where a
    # click goes.
    # an event's push carries the EVENT's key as its id: the phone's service worker uses it as the notification's
    # tag, so an update replaces the earlier notification instead of stacking (public/sw-push.js)
    out = [(label_for(x), body_for(x), {"id": x.get("event_key") or x["id"], "item_id": x["id"], "event_id": x.get("event_id"),
                                              "kind": x.get("kind"), "severity": x.get("sev"),
                                              "lat": x.get("lat"), "lon": x.get("lon"),
                                              "asset_id": x.get("asset_id"), "livestream_id": x.get("livestream_id"),
                                              "route_plan_id": x.get("route_plan_id"),
                                              # a message opens its conversation, a desk card its post
                                              "conversation_id": x.get("conversation_id"), "post_id": x.get("post_id"),
                                              "alert_type": x.get("alert_type"), "mmsi": mmsi_of(x)})
           for x in cards[:PUSH_SINGLES]]
    rest = cards[PUSH_SINGLES:]
    if rest:
        out.append((f"{len(rest)} more notifications", "; ".join(str(x["title"])[:60] for x in rest[:2]) + (" …" if len(rest) > 2 else ""),
                    {"id": "more:" + rest[0]["id"], "kind": "signal"}))
    return out


def sweep(send, feed=None, now: _dt.datetime | None = None) -> int:
    """Send every fresh card that would pop up on screen, once, to each
    subscribed user. `send(uid, title, body, data)` is main._send_push;
    `feed(uid)` is that user's whole notification feed
    (main._notification_feed), else only this module's own cards."""
    from database import PushSubscription, get_db
    with get_db() as db:
        uids = [r[0] for r in db.query(PushSubscription.user_id).distinct().all()]
    if not uids:
        return 0
    now = now or _dt.datetime.now(_dt.timezone.utc)
    con = _push_con()
    _ensure_push_log(con)
    sent = 0
    try:
        for uid in uids:
            uid = str(uid)
            c = concern_of(uid)
            items = personalize(feed(uid) if feed else cards_for(uid, now), uid, c, now)
            due = due_cards(con, uid, items, c, now)
            con.commit()
            for title, body, data, card in deliver_plan(con, uid, due, alert_rules(c, uid), now):
                send(uid, title, body, data)
                log_push(con, uid, data, card, now)
                sent += 1
            sent += send_digest(con, uid, c, now, send)
            con.commit()
        con.execute("DELETE FROM event_pushes WHERE sent_at < ?", (_iso(now - _dt.timedelta(days=14)),))
        con.execute("DELETE FROM push_log WHERE sent_at < ?", (_iso(now - _dt.timedelta(days=14)),))
        con.commit()
    finally:
        con.close()
    return sent


def _last_push(con, uid: str, event_key: str) -> tuple[str, str | None] | None:
    r = con.execute("SELECT sent_at, priority FROM push_log WHERE user_id=? AND event_key=? ORDER BY sent_at DESC LIMIT 1",
                    (uid, event_key)).fetchone()
    return (r[0], r[1]) if r else None


def due_cards(con, uid: str, items: list[dict], c: dict, now: _dt.datetime) -> list[dict]:
    """The cards to send this sweep, each once (event_pushes). An event: new or a significant update, at most one
    push per EVENT_SPACING_MIN (a rise to Critical excepted); an update inside that window waits and goes out
    after it as the latest version (coalesced). The first push about an event is its new-event text."""
    fresh_std = now - _dt.timedelta(minutes=PUSH_FRESH_MIN)
    fresh_ev = now - _dt.timedelta(minutes=EVENT_PUSH_FRESH_MIN)
    due = []
    for card in items:
        created = _utc(card.get("created_at"))
        key = card.get("event_key")
        if not created or created < (fresh_ev if key else fresh_std) or not notifies(card, c):
            continue
        if key:
            if con.execute("SELECT 1 FROM event_pushes WHERE user_id=? AND item_id=?", (uid, card["id"])).fetchone():
                continue
            last = _last_push(con, uid, key)
            if last:
                age = (now - (_utc(last[0]) or now)).total_seconds() / 60
                rise_to_flash = card.get("priority") == "flash" and last[1] != "flash"
                if age < EVENT_SPACING_MIN and not rise_to_flash:
                    continue                                    # coalesced: retried after the window
            else:
                card = {**card, "push_body": card.get("push_body_new") or card.get("push_body")}
        cur = con.execute("INSERT OR IGNORE INTO event_pushes (user_id, item_id, sent_at) VALUES (?,?,?)", (uid, card["id"], _iso(now)))
        if cur.rowcount:
            if key:
                # every version up to this one is told by this push
                con.execute("INSERT OR IGNORE INTO event_pushes (user_id, item_id, sent_at) VALUES (?,?,?)", (uid, key, _iso(now)))
            due.append(card)
    return due


def _exempt(card: dict) -> bool:
    return card.get("priority") == "flash" or card.get("sev") == "critical" or (card.get("kind") or "") in SAFETY_KINDS


def deliver_plan(con, uid: str, due: list[dict], rules: dict, now: _dt.datetime) -> list[tuple]:
    """(title, body, data, card) to send: Critical and safety cards always; others up to the hourly cap, two as
    themselves and the rest as one "N more"; past the cap one "N more" at most every MORE_SPACING_MIN, else held
    (the cards stay in the feed and the digest)."""
    if not due:
        return []
    hour_ago = _iso(now - _dt.timedelta(hours=1))
    sent_hour = con.execute("SELECT COUNT(*) FROM push_log WHERE user_id=? AND sent_at>=? AND flash=0 AND kind!='more'",
                            (uid, hour_ago)).fetchone()[0]
    allowed = max(0, int(rules.get("hourly_cap") or HOURLY_CAP) - sent_hour)
    must = [x for x in due if _exempt(x)]
    rest = [x for x in due if not _exempt(x)]
    plan = [(t, b, d, next((x for x in must if (x.get("event_key") or x["id"]) == d["id"]), None))
            for t, b, d in bundle(must)] if must else []
    take, over = rest[:allowed], rest[allowed:]
    if take:
        for t, b, d in bundle(take):
            plan.append((t, b, d, next((x for x in take if (x.get("event_key") or x["id"]) == d["id"]), None)))
    if over:
        recent_more = con.execute("SELECT 1 FROM push_log WHERE user_id=? AND kind='more' AND sent_at>=?",
                                  (uid, _iso(now - _dt.timedelta(minutes=MORE_SPACING_MIN)))).fetchone()
        if not recent_more:
            plan.append((f"{len(over)} more notifications",
                         "; ".join(str(x["title"])[:60] for x in over[:2]) + (" …" if len(over) > 2 else ""),
                         {"id": "more:" + over[0]["id"], "kind": "more"}, None))
    return plan


def log_push(con, uid: str, data: dict, card: dict | None, now: _dt.datetime) -> None:
    kind = "more" if str(data.get("id", "")).startswith("more:") else ((card or {}).get("kind") or data.get("kind") or "")
    con.execute("INSERT INTO push_log (user_id, item_id, event_key, priority, kind, flash, sent_at) VALUES (?,?,?,?,?,?,?)",
                (uid, str((card or {}).get("id") or data.get("id")), (card or {}).get("event_key"), (card or {}).get("priority"),
                 kind, int(bool(card and _exempt(card))), _iso(now)))


def digest_slot(rules: dict, now: _dt.datetime) -> str | None:
    local = now.astimezone(rules["tz"])
    for h in DIGEST_HOURS:
        if local.hour == h and local.minute < DIGEST_WINDOW_MIN:
            return f"{local.date().isoformat()}:{h:02d}"
    return None


def digest_items(con, uid: str, c: dict, now: _dt.datetime, views: dict | None = None) -> list[dict]:
    """The events of the last DIGEST_LOOKBACK_H that concern the user and never pushed, nor were in a digest."""
    import events
    views = _event_views(DIGEST_LOOKBACK_H) if views is None else views
    rules = alert_rules(c, uid)
    out = []
    since = now - _dt.timedelta(hours=DIGEST_LOOKBACK_H)
    for v in views.values():
        if (_utc(v.get("last_update")) or now) < since or v.get("status") == "contradicted":
            continue
        pr = events.priority_for(v, c)
        if not pr or muted_by(rules, {"event_id": v["id"], "lat": v.get("lat"), "lon": v.get("lon")}, pr, now):
            continue
        if _last_push(con, uid, f"ev:{v['id']}"):
            continue
        if con.execute("SELECT 1 FROM event_pushes WHERE user_id=? AND item_id=?", (uid, f"dig:{v['id']}")).fetchone():
            continue
        out.append({**v, "_pr": pr})
    out.sort(key=lambda v: v.get("last_update") or "", reverse=True)
    return out


def send_digest(con, uid: str, c: dict, now: _dt.datetime, send, views: dict | None = None) -> int:
    """Twice a day (07:00 and 19:00 local): one push listing what concerned the user and never pushed. Built in
    code, no model."""
    rules = alert_rules(c, uid)
    if not rules.get("digest"):
        return 0
    slot = digest_slot(rules, now)
    if not slot:
        return 0
    cur = con.execute("INSERT OR IGNORE INTO event_pushes (user_id, item_id, sent_at) VALUES (?,?,?)", (uid, f"digest:{slot}", _iso(now)))
    if not cur.rowcount:
        return 0
    items = digest_items(con, uid, c, now, views)
    if not items:
        return 0
    for v in items:
        con.execute("INSERT OR IGNORE INTO event_pushes (user_id, item_id, sent_at) VALUES (?,?,?)", (uid, f"dig:{v['id']}", _iso(now)))
    n = len(items)
    title = f"Digest · {n} {'event' if n == 1 else 'events'} in your areas"
    body = "; ".join(f"{v['headline']} ({v['status_label'].lower()})" for v in items[:4]) + (" …" if n > 4 else "")
    data = {"id": f"digest:{slot}", "kind": "signal", "event_ids": [v["id"] for v in items[:20]]}
    send(uid, title, body[:220], data)
    log_push(con, uid, data, {"id": data["id"], "kind": "digest"}, now)
    return 1
