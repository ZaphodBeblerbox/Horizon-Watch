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
import threading
import time

REMIND_BEFORE_MIN = 90
MORNING_HOUR = 7
NEW_ANNOUNCEMENT_HOURS = 48
PUSH_FRESH_MIN = 15          # notificationStore.MAX_INTERRUPT_AGE_MS: nothing older pops up either
CAPS = {"announcement": 8, "reminder": 6, "live": 10}

_lock = threading.Lock()
_events_cache: dict = {"at": 0.0, "ann": [], "now": []}
_concern_cache: dict[str, tuple[float, dict]] = {}
EVENTS_TTL_S = 60
CONCERN_TTL_S = 60          # a new theater or interest counts within a minute


def km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.radians
    h = (math.sin(r(b_lat - a_lat) / 2) ** 2
         + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lon - a_lon) / 2) ** 2)
    return 12742 * math.asin(math.sqrt(min(1.0, h)))


def theater_reach_km(view: dict) -> float:
    return max(350.0, float(view.get("height") or 2_000_000) / 1000 * 0.9)


# ── what concerns a user ────────────────────────────────────────────────────

def concern_of(uid: str) -> dict:
    """{assets: [...], theaters: [...], countries: {lowercase names}}."""
    with _lock:
        hit = _concern_cache.get(uid)
        if hit and time.time() - hit[0] < CONCERN_TTL_S:
            return hit[1]
    c = {"assets": [], "theaters": [], "countries": set()}
    try:
        import owned_assets as oa
        for a in oa.list_for(uid):
            if a.get("lat") is not None and a.get("lon") is not None:
                c["assets"].append({"lat": float(a["lat"]), "lon": float(a["lon"]),
                                    "radius": max(5.0, float(a.get("radius_km") or 25)),
                                    "name": a.get("name") or "asset",
                                    "label": (a.get("kind_label") or "asset").lower()})
    except Exception as e:                                     # noqa: BLE001
        print(f"[event_watch] assets for {uid}: {type(e).__name__}: {e}", flush=True)
    try:
        from database import Theater, User, get_db
        with get_db() as db:
            for t in db.query(Theater).filter(Theater.owner_user_id == uid).all():
                v = t.view or {}
                if v.get("lat") is not None and v.get("lon") is not None:
                    c["theaters"].append({"lat": float(v["lat"]), "lon": float(v["lon"]),
                                          "reach": theater_reach_km(v), "name": t.name})
            u = db.query(User).filter(User.id == uid).first()
            interests = ((u.settings or {}).get("interests") or {}) if u else {}
            c["countries"] = {str(x).strip().lower() for x in (interests.get("countries") or []) if x}
            # where the user is (asked once in the app): watched like an asset
            here = interests.get("here") or {}
            try:
                c["assets"].append({"lat": float(here["lat"]), "lon": float(here["lon"]),
                                    "radius": max(5.0, float(here.get("radius_km") or 30)),
                                    "name": "where you are", "label": "", "me": True})
            except (KeyError, TypeError, ValueError):
                pass
            regions = regions_table()
            for r in interests.get("regions") or []:
                c["countries"] |= {x.lower() for x in regions.get(r, [])}
    except Exception as e:                                     # noqa: BLE001
        print(f"[event_watch] profile for {uid}: {type(e).__name__}: {e}", flush=True)
    with _lock:
        _concern_cache[uid] = (time.time(), c)
    return c


_REGIONS: dict | None = None


def regions_table() -> dict:
    """The one-click regions of Settings › Your interests: the copy in
    backend/seed (production deploys backend/ only), kept equal to the
    frontend's src/state/interests.js REGIONS by test_seed_copies.py."""
    global _REGIONS
    if _REGIONS is None:
        import json as _json
        from paths import SEED_DIR
        try:
            _REGIONS = _json.loads((SEED_DIR / "interest_regions.json").read_text(encoding="utf-8"))["regions"]
        except Exception as e:                                 # noqa: BLE001
            print(f"[event_watch] regions table unreadable: {type(e).__name__}: {e}", flush=True)
            _REGIONS = {}
    return _REGIONS


def _country_name(code: str | None) -> str | None:
    if not code:
        return None
    try:
        from location_extract import country_name_from_code
        return country_name_from_code(code)
    except Exception:                                          # noqa: BLE001
        return None


def why(ev: dict, c: dict) -> tuple[str, str] | None:
    """(reason, strength) when this event concerns the user, else None.
    strength: "asset" (closest), "theater", "country"."""
    lat, lon = ev.get("lat"), ev.get("lon")
    if lat is None or lon is None:
        return None
    near = []
    for a in c["assets"]:
        d = km(a["lat"], a["lon"], lat, lon)
        if d <= a["radius"]:
            near.append((d, a))
    if near:
        near.sort(key=lambda x: x[0])
        d, a = near[0]
        dist = "under 1 km" if d < 1 else f"{round(d)} km"
        if len(near) == 1:
            if a.get("me"):
                return f"{dist} from where you are", "asset"
            return f"{dist} from your {a['label']} {a['name']}", "asset"
        # several assets at one place: one card naming them all
        names = [x[1]["name"] for x in near]
        listed = ", ".join(names[:-1]) + f" and {names[-1]}" if len(names) <= 4 else f"{', '.join(names[:3])} and {len(names) - 3} more"
        return f"{dist} from your assets {listed}", "asset"
    for t in c["theaters"]:
        if km(t["lat"], t["lon"], lat, lon) <= t["reach"]:
            return f"in your theater {t['name']}", "theater"
    name = _country_name(ev.get("country_code"))
    if name and name.lower() in c["countries"]:
        return f"{name} — a country you watch", "country"
    return None


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
    return cards


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


def push_body(card: dict) -> str:
    return " · ".join(x for x in (card.get("advice") or card.get("expect"), card.get("reason")) if x)[:220]


# What pops up on screen (src/state/notificationStore.js interrupts()) is
# what goes to a closed app: the same rule, so the two cannot disagree.
INTERRUPT_KINDS = {"escalate", "assign", "rfi", "telegram", "surge", "fusion", "live", "livestream"}


def interrupts(card: dict) -> bool:
    sev, kind = card.get("sev"), card.get("kind") or "signal"
    return (sev == "critical" or kind in INTERRUPT_KINDS
            or (kind == "signal" and sev == "high") or (kind == "announcement" and sev == "high"))


PUSH_SINGLES = 2      # pushed one by one per sweep; the rest go as one "and N more"
APP_NAME = "Parallax"


def _own(card: dict) -> bool:
    """A card already made for this user: their events, their assets."""
    return str(card.get("id") or "").startswith(("ann:", "soon:", "now:", "asset:")) or card.get("kind") == "asset"


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
    and an "N more". `c` is kept for callers and for a narrower rule later."""
    return interrupts(card)


def bundle(cards: list[dict]) -> list[tuple[str, str, dict]]:
    """(title, body, data) to send: the first PUSH_SINGLES as themselves,
    the rest as one summary, so a burst is one buzz, not twelve."""
    rank = {"critical": 0, "high": 1}
    cards = sorted(cards, key=lambda x: (rank.get(x.get("sev"), 2), str(x.get("created_at") or "")))
    # WHAT A CLOSED APP SHOWS (owner, 2026-10-10): the Parallax X, the app's
    # name and the headline — nothing else. The data says where a click goes.
    out = [(APP_NAME, str(x["title"])[:180], {"id": x["id"], "kind": x.get("kind"), "severity": x.get("sev"),
                                              "lat": x.get("lat"), "lon": x.get("lon"),
                                              "asset_id": x.get("asset_id"), "livestream_id": x.get("livestream_id")})
           for x in cards[:PUSH_SINGLES]]
    rest = cards[PUSH_SINGLES:]
    if rest:
        out.append((APP_NAME, f"{len(rest)} more: " + "; ".join(str(x["title"])[:60] for x in rest[:2]) + (" …" if len(rest) > 2 else ""),
                    {"id": "more:" + rest[0]["id"], "kind": "signal"}))
    return out


def sweep(send, feed=None) -> int:
    """Send every fresh card that would pop up on screen, once, to each
    subscribed user. `send(uid, title, body, data)` is main._send_push;
    `feed(uid)` is that user's whole notification feed
    (main._notification_feed), else only this module's own cards."""
    from database import PushSubscription, get_db
    with get_db() as db:
        uids = [r[0] for r in db.query(PushSubscription.user_id).distinct().all()]
    if not uids:
        return 0
    now = _dt.datetime.now(_dt.timezone.utc)
    fresh_after = now - _dt.timedelta(minutes=PUSH_FRESH_MIN)
    con = _push_con()
    sent = 0
    try:
        for uid in uids:
            c = concern_of(str(uid))
            due = []
            for card in (feed(str(uid)) if feed else cards_for(str(uid), now)):
                created = _utc(card.get("created_at"))
                if not created or created < fresh_after or not notifies(card, c):
                    continue
                cur = con.execute("INSERT OR IGNORE INTO event_pushes (user_id, item_id, sent_at) VALUES (?,?,?)",
                                  (str(uid), card["id"], _iso(now)))
                if cur.rowcount:
                    due.append(card)
            con.commit()
            for title, body, data in bundle(due):
                send(str(uid), title, body, data)
                sent += 1
        con.execute("DELETE FROM event_pushes WHERE sent_at < ?", (_iso(now - _dt.timedelta(days=14)),))
        con.commit()
    finally:
        con.close()
    return sent
