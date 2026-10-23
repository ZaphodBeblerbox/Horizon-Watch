"""
protests.py — the PROTESTS layer: live now, today, upcoming (owner, 2026-10-23).

THE OWNER: "I want to be able to say: this is happening right now, live. I also
want: what will take place in this area tomorrow. And: this happened during
the day." "Protests should be an actual layer." And for Saturday 2026-10-24
in Paris: every development in real time, the crowd's position and direction
over time, and police movement, as separate items.

THREE FRAMES, one build (GET /api/protests?frame=live|today|upcoming):

  live      what is on the ground NOW, from the strict live gate only:
              * live signals (live_signals.py) of a protest's acts: a crowd, a
                police intervention, an arrest;
              * street reports (street_reports.py, read only out of live-gated
                posts) of police tactics: kettle, charge, tear gas, water
                cannon, LBD, police moving in (with the street they came by);
              * announced protests in progress (protest_status.py: starting,
                ongoing, dispersing) WITH an on-the-ground report in the last
                LIVE_REPORT_MIN — the clock alone never makes one live;
              * the crowd's track (path, heading, "last seen 14:05, 4 min ago")
                and the police's, linked from those positions by walking speed
                (demonstrations.link_tracks), each its own item and icon.
  today     what happened during the day: the same acts since local midnight
              of the place (else the last 24 h) that are no longer live, and
              the announced protests that took place (ended / dispersing, with
              evidence: a "no sign it happened" is not a protest), each with
              what happened and when ("Rally at Place de la République,
              14:00–17:30, organisers 10,000; 12 arrests"). Incidents within
              FOLD_M of a protest and inside its window are folded into its
              card: one event per real incident (Dataminr's logic).
  upcoming  announced protests and calls to gather for the next UPCOMING_D
              days: a real future date (and the hour when one is given), a
              named place (not "place", not a bare country), the organiser and
              cause when the announcement says them, and its source.

POLICE IS NOT THE MILITARY (force_context.py): troops, the front and war
theatres never enter this layer.

COMPUTED ONCE FOR EVERYBODY (shared_cache.SharedCache, CACHE_S fresh, served
stale while one thread rebuilds), filtered per user AFTER (profile_filter /
user_concern): never a per-user rebuild (the 2026-10-19 multi-user stall).
Derived on read; nothing is stored.
"""
from __future__ import annotations

import datetime as _dt
import re

from textclean import strip_emoji

CACHE_S = 15
MAX_STALE_S = 120
LIVE_REPORT_MIN = 60          # an announced protest is live only with a report from there this recent
TRACK_LOOKBACK_MIN = 180      # positions linked into a crowd's or the police's track
TRACK_LIVE_MIN = 60           # a track whose last position is older is not live
UPCOMING_D = 7
FOLD_M = 1500.0
DAY_FALLBACK_H = 24

PROTEST_ACTS = {"crowd_movement": "crowd", "police_intervention": "police", "arrest": "arrest"}
POLICE_TACTICS = {"kettle", "charge", "tear_gas", "water_cannon", "lbd", "police_arrival"}
TACTIC_KIND = {**{k: "police" for k in POLICE_TACTICS}, "arrests": "arrest", "crowd": "crowd",
               "barricade": "clash", "fire": "clash", "gunfire": "clash"}
KIND_LABEL = {"protest": "Protest", "crowd": "Crowd", "police": "Police", "arrest": "Arrests", "clash": "Clashes",
              "crowd_track": "Crowd movement", "police_track": "Police movement", "planned": "Planned"}


# ── small helpers ───────────────────────────────────────────────────────────

def _utc(v) -> _dt.datetime | None:
    if not v:
        return None
    if isinstance(v, _dt.datetime):
        return v if v.tzinfo else v.replace(tzinfo=_dt.timezone.utc)
    try:
        t = _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)


def iso(t: _dt.datetime | None) -> str | None:
    return t.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if t else None


def metres(a_lat, a_lon, b_lat, b_lon) -> float:
    import live_signals as ls
    return ls.metres(a_lat, a_lon, b_lat, b_lon)


def zone(cc: str | None):
    try:
        import protest_status as ps
        return ps.zone_of(cc) or _dt.timezone.utc
    except Exception:                                          # noqa: BLE001
        return _dt.timezone.utc


def hhmm(t: _dt.datetime | None, z) -> str:
    return t.astimezone(z).strftime("%H:%M") if t else ""


def ago(t: _dt.datetime | None, now: _dt.datetime) -> str:
    if not t:
        return ""
    m = max(0.0, (now - t).total_seconds() / 60)
    if m < 1:
        return "just now"
    if m < 60:
        return f"{int(round(m))} min ago"
    return f"{int(m // 60)} h {int(m % 60):02d} ago" if m % 60 >= 5 else f"{int(m // 60)} h ago"


_LINK = re.compile(r"https?://\S+|t\.me/\S+|@\w+|#\w+")
_JUNK = re.compile(r"(?im)^.*(abonne|subscribe|rejoignez|join us|follow us|suivez|partagez|share).*$")


def clean_message(text: str | None, limit: int = 220) -> str:
    """A post as a card line: no emoji, no links, handles, hashtags or 'subscribe' lines, one line, cut at a word."""
    t = _JUNK.sub(" ", text or "")
    t = _LINK.sub(" ", t)
    t = strip_emoji(t)
    t = re.sub(r"\s+", " ", t).strip(" -–—·|:")
    if len(t) > limit:
        t = t[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return t


def named_place(place: str | None) -> bool:
    """A real place: not empty, not a bare 'place' / 'la place', not a country alone."""
    first = str(place or "").split(",")[0].strip()
    if not first or len(first) < 3:
        return False
    try:
        from textclean import is_generic_place
        if is_generic_place(first):
            return False
    except Exception:                                          # noqa: BLE001
        pass
    try:
        import country_registry
        if country_registry.canonical_country(first) and "," not in str(place or "").strip(", "):
            return False
    except Exception:                                          # noqa: BLE001
        pass
    return True


def local_midnight(now: _dt.datetime, z) -> _dt.datetime:
    loc = now.astimezone(z)
    return loc.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(_dt.timezone.utc)


def happened_today(t: _dt.datetime | None, cc: str | None, now: _dt.datetime) -> bool:
    """Since local midnight of the place; a place with no country: the last DAY_FALLBACK_H hours."""
    if not t or t > now + _dt.timedelta(minutes=2):
        return False
    if cc:
        return t >= local_midnight(now, zone(cc))
    return now - t <= _dt.timedelta(hours=DAY_FALLBACK_H)


# ── items ───────────────────────────────────────────────────────────────────

def _base(**kw) -> dict:
    out = {"id": None, "frame": None, "kind": None, "act": None, "title": "", "line": "", "when": "", "lat": None, "lon": None,
           "place": None, "city": None, "country_code": None, "tz": None, "first_seen": None, "last_update": None,
           "corroboration": None, "sources": [], "messages": [], "media": None, "all_media": [], "track": None,
           "from": None, "lines": [], "live": False, "muted": False}
    out.update(kw)
    return out


def _messages(msgs: list[dict], z, limit: int = 3) -> list[dict]:
    out, seen = [], set()
    for m in msgs:
        txt = clean_message(m.get("text"))
        if not txt or txt.lower() in seen:
            continue
        seen.add(txt.lower())
        t = _utc(m.get("event_time") or m.get("posted_at"))
        out.append({"hhmm": hhmm(t, z), "at": iso(t), "text": txt, "translated": bool(m.get("translated")),
                    "channel_title": clean_message(m.get("channel_title"), 60), "url": m.get("url")})
        if len(out) >= limit:
            break
    return out


def from_signal(s: dict, frame: str, now: _dt.datetime) -> dict | None:
    """A live_signals signal of a protest's act → an item."""
    kind = PROTEST_ACTS.get(s.get("act"))
    if not kind:
        return None
    cc = s.get("country_code")
    z = zone(cc)
    first, last = _utc(s.get("first_event_time")), _utc(s.get("event_time"))
    when = (f"{hhmm(last, z)}, {ago(last, now)}" if frame == "live"
            else (f"{hhmm(first, z)}–{hhmm(last, z)}" if first and last and hhmm(first, z) != hhmm(last, z) else hhmm(last, z)))
    return _base(id=f"pr-{s['id']}", frame=frame, kind=kind, act=s["act"], title=strip_emoji(s.get("title") or ""),
                 line=(s.get("corroboration") or {}).get("line") or "", when=when, lat=s["lat"], lon=s["lon"],
                 place=s.get("place"), country_code=cc, tz=getattr(z, "key", None), first_seen=iso(first), last_update=iso(last),
                 corroboration=s.get("corroboration"), sources=s.get("sources") or [], messages=_messages(s.get("messages") or [], z),
                 media=s.get("media"), all_media=s.get("all_media") or [], lines=[ln["text"] for ln in s.get("lines") or []],
                 live=frame == "live", muted=bool(s.get("muted")), refs=list(s.get("refs") or []),
                 track={"bearing": (s.get("direction") or {}).get("bearing"), "toward": (s.get("direction") or {}).get("toward_place")}
                 if s.get("direction") else None)


def from_street(r: dict, frame: str, now: _dt.datetime) -> dict | None:
    """A street report (police tactic, arrests, a crowd, clashes) at a named place → an item."""
    kind = TACTIC_KIND.get(r.get("tactic"))
    if not kind or r.get("lat") is None or not named_place(r.get("place")):
        return None
    cc = r.get("country_code")
    z = zone(cc)
    first, last = _utc(r.get("first_at")), _utc(r.get("at"))
    msgs = [{"text": s.get("translation") or s.get("text"), "translated": s.get("translated_by") == "model",
             "posted_at": s.get("posted_at"), "channel_title": s.get("channel_title"), "url": s.get("url")}
            for s in reversed(r.get("sources") or [])]
    media = None
    if r.get("thumb_url") or r.get("video_url"):
        media = {"kind": "video" if r.get("video_url") else "photo", "thumb_url": r.get("thumb_url"), "video_url": r.get("video_url")}
    n_ch = r.get("n_channels") or 1
    line = (f"Reported in {n_ch} chats, unverified" if n_ch > 1 else "1 source, unverified")
    when = (f"{hhmm(last, z)}, {ago(last, now)}" if frame == "live"
            else (f"{hhmm(first, z)}–{hhmm(last, z)}" if first and last and hhmm(first, z) != hhmm(last, z) else hhmm(last, z)))
    fr = None
    if r.get("from") or r.get("from_bearing") is not None:
        fr = {**(r.get("from") or {}), "bearing": r.get("from_bearing"), "place": r.get("from_place")}
    return _base(id=f"pr-{r['id']}", frame=frame, kind=kind, act=r.get("tactic"), title=strip_emoji(r.get("title") or ""),
                 line=line, when=when, lat=r["lat"], lon=r["lon"], place=r.get("place"), city=r.get("city"), country_code=cc,
                 tz=getattr(z, "key", None), first_seen=iso(first), last_update=iso(last),
                 corroboration={"level": "reported", "n_sources": n_ch, "line": line},
                 sources=[{"channel_title": s.get("channel_title"), "posted_at": s.get("posted_at"), "url": s.get("url")}
                          for s in reversed(r.get("sources") or [])][:4],
                 messages=_messages(msgs, z), media=media, all_media=[media] if media else [], live=frame == "live",
                 **{"from": fr})


def _crowd_words(p: dict) -> str:
    c = p.get("crowd") or {}
    return (c.get("label") or "").strip()


def from_protest(p: dict, frame: str, now: _dt.datetime) -> dict | None:
    """An announced protest (protest_status) → an item of the frame it belongs to, or None."""
    st = p.get("status") or {}
    key = st.get("key")
    cc = p.get("country_code")
    z = zone(cc)
    start = _utc(p.get("starts_utc"))
    if not named_place(p.get("place")) or start is None:
        return None
    last_rep = _utc(st.get("last_report_at"))
    ends = None
    title = strip_emoji(p.get("title") or "")
    crowd = _crowd_words(p)
    if frame == "live":
        if key not in ("starting", "ongoing", "dispersing"):
            return None
        if not last_rep or (now - last_rep).total_seconds() / 60 > LIVE_REPORT_MIN:
            return None                                       # the clock alone never makes it live
        line = "; ".join(x for x in (strip_emoji(p.get("status_label") or ""), crowd) if x)
        when = f"since {hhmm(_utc(st.get('since')) or start, z)}, last report {ago(last_rep, now)}"
    elif frame == "today":
        if key not in ("ended", "dispersing") or st.get("basis") != "evidence" or not happened_today(start, cc, now):
            return None
        a, b = _utc(st.get("since")) or start, _utc(st.get("until")) or last_rep
        when = f"{hhmm(a, z)}–{hhmm(b, z)}" if b and hhmm(a, z) != hhmm(b, z) else hhmm(a, z)
        line = "; ".join(x for x in (f"{title}, {when}", crowd) if x)
        ends = iso(b)
    elif frame == "upcoming":
        if key != "planned" or start <= now or start > now + _dt.timedelta(days=UPCOMING_D):
            return None
        when = p.get("starts_label") or ""
        if p.get("start_approx"):
            when = when.replace("(no time given)", "(time not given)")
        line = when
    else:
        return None
    srcs = [{"channel_title": clean_message(s.get("channel_title"), 60), "posted_at": s.get("posted_at"), "url": s.get("url")}
            for s in (p.get("sources") or [])][:4]
    msgs = [{"text": e.get("title"), "posted_at": e.get("at"), "channel_title": e.get("source"), "url": e.get("url")}
            for e in (p.get("evidence") or [])]
    media = (p.get("media") or [None])[0] if frame != "upcoming" else None
    tracks = p.get("crowd_tracks") or []
    return _base(id=f"pr-{p['id']}-{frame}", frame=frame, kind="planned" if frame == "upcoming" else "protest", act="protest",
                 title=title, line=line, when=when, lat=p["lat"], lon=p["lon"], place=p.get("place"), city=p.get("city"),
                 country_code=cc, tz=p.get("tz"), first_seen=p.get("announced_at"), last_update=iso(last_rep) or p.get("announced_at"),
                 starts_utc=p.get("starts_utc"), start_approx=bool(p.get("start_approx")), ends_utc=ends,
                 corroboration={"level": "announced", "n_sources": p.get("n_sources") or len(srcs),
                                "line": f"Announced by {p.get('n_sources') or len(srcs)} source{'s' if (p.get('n_sources') or len(srcs)) != 1 else ''}"},
                 sources=srcs, messages=_messages(msgs, z) if frame != "upcoming" else [],
                 media=media if isinstance(media, dict) else None, all_media=[m for m in (p.get("media") or [])[:4] if isinstance(m, dict)]
                 if frame != "upcoming" else [], live=frame == "live", crowd=crowd or None,
                 organiser=None, cause=None, n_tracks=len(tracks))


def from_announcement(a: dict, now: _dt.datetime) -> dict | None:
    """telegram_ingest.upcoming() item not already a protest_status protest → an upcoming item."""
    if a.get("lat") is None or not named_place(a.get("place")):
        return None
    cc = (a.get("country_code") or "").lower() or None
    z = zone(cc)
    start = _utc(a.get("starts_utc"))
    approx = start is None
    if start is None:
        try:
            d = _dt.date.fromisoformat(str(a.get("starts_at") or "")[:10])
        except ValueError:
            return None
        if d < now.astimezone(z).date():
            return None
        start = _dt.datetime(d.year, d.month, d.day, 12, tzinfo=z).astimezone(_dt.timezone.utc)
    elif start <= now:
        return None
    if start > now + _dt.timedelta(days=UPCOMING_D):
        return None
    import protest_status as ps
    when = f"{ps.day_label(start, now, z)} " + ("(time not given)" if approx else ps.hhmm(start, z))
    what = (a.get("what") or "gathering").strip()
    short = ", ".join(x.strip() for x in str(a.get("place") or "").split(",")[:2] if x.strip())
    title = f"{what[:1].upper()}{what[1:]} at {short.split(',')[0]}"
    by = clean_message(a.get("organiser"), 80)
    cause = clean_message(a.get("cause"), 120)
    line = "; ".join(x for x in (when, f"called by {by}" if by else "", cause) if x)
    srcs = [{"channel_title": clean_message(a.get("channel_title"), 60), "posted_at": a.get("posted_at"), "url": a.get("url")}]
    srcs += [{"channel_title": clean_message(x, 60), "posted_at": None, "url": None} for x in (a.get("also_reported_by") or [])[:3]]
    return _base(id=f"pr-{a['id']}", frame="upcoming", kind="planned", act="protest", title=strip_emoji(title), line=line,
                 when=when, lat=a["lat"], lon=a["lon"], place=a.get("place"), country_code=cc, tz=getattr(z, "key", None),
                 first_seen=a.get("posted_at"), last_update=a.get("posted_at"), starts_utc=iso(start), start_approx=approx,
                 corroboration={"level": "announced", "n_sources": len(srcs), "line": f"Announced by {len(srcs)} source{'s' if len(srcs) != 1 else ''}"},
                 sources=srcs, organiser=by or None, cause=cause or None)


# ── tracks: the crowd's and the police's movement ──────────────────────────

def tracks(positions: list[dict], kind: str, now: _dt.datetime) -> list[dict]:
    """positions: {id, lat, lon, at, place, country, text, title, url, source} → track items (2+ places, last
    position within TRACK_LIVE_MIN). Linked by walking speed (demonstrations.link_tracks)."""
    import demonstrations as dm
    pos = [p for p in positions if p.get("lat") is not None and _utc(p.get("at"))
           and (now - _utc(p["at"])).total_seconds() / 60 <= TRACK_LOOKBACK_MIN]
    out = []
    for t in dm.link_tracks(pos, now, lambda cc: zone(cc), min_nodes=2):
        last = _utc(t["last_at"])
        if not last or (now - last).total_seconds() / 60 > TRACK_LIVE_MIN:
            continue
        cc = t.get("country") or None
        z = zone(cc)
        place = str(t["last"].get("place") or "").split(",")[0]
        who = "Crowd" if kind == "crowd_track" else "Police"
        title = f"{who} moving, last seen at {place}" if place else f"{who} moving"
        out.append(_base(id=f"pr-{kind}-{t['id']}", frame="live", kind=kind, act=kind, title=title,
                         line=f"Path from {t['n_reports']} reports, reconstructed",
                         when=f"last seen {hhmm(last, z)}, {ago(last, now)}", lat=t["last"]["lat"], lon=t["last"]["lon"],
                         place=t["last"].get("place"), city=t.get("city"), country_code=cc, tz=getattr(z, "key", None),
                         first_seen=t.get("started_at"), last_update=iso(last), live=True,
                         track={"points": [{"lat": p["lat"], "lon": p["lon"], "at": p["at"], "place": p.get("place")} for p in t["points"]],
                                "bearing": t.get("heading_deg"), "n_reports": t["n_reports"]}))
    return out


def _position(i: dict) -> dict:
    # the live gate already read this as a crowd on the move (crowd_movement) or police acting at a place: that act is
    # the movement evidence link_score asks for, so it is said in the words it reads ("moving")
    return {"id": i["id"], "lat": i["lat"], "lon": i["lon"], "at": i["last_update"], "place": i.get("place") or "",
            "country": i.get("country_code") or "",
            "text": " ".join([m["text"] for m in i.get("messages") or []] + ["moving"]),
            "title": i["title"], "url": (i.get("sources") or [{}])[0].get("url"), "source": "Telegram"}


# ── the build (pure, given its inputs) ─────────────────────────────────────

def _same_event(a: dict, b: dict, m: float = 200.0, minutes: float = 45.0) -> bool:
    ta, tb = _utc(a.get("last_update")), _utc(b.get("last_update"))
    if not ta or not tb or abs((ta - tb).total_seconds()) / 60 > minutes:
        return False
    return metres(a["lat"], a["lon"], b["lat"], b["lon"]) <= m


def _merge_into(keep: dict, other: dict) -> None:
    """One event per real incident: a second reading of the same thing updates the first."""
    seen = {m["text"] for m in keep["messages"]}
    keep["messages"] = sorted(keep["messages"] + [m for m in other["messages"] if m["text"] not in seen],
                              key=lambda m: m.get("at") or "", reverse=True)[:3]
    keep["sources"] = (keep["sources"] + [s for s in other["sources"] if s not in keep["sources"]])[:4]
    if not keep.get("media") and other.get("media"):
        keep["media"], keep["all_media"] = other["media"], other.get("all_media") or [other["media"]]
    if other.get("from") and not keep.get("from"):
        keep["from"] = other["from"]
    if other.get("refs"):
        keep["refs"] = list(dict.fromkeys((keep.get("refs") or []) + other["refs"]))
    for k, f in (("first_seen", min), ("last_update", max)):
        vals = [v for v in (keep.get(k), other.get(k)) if v]
        keep[k] = f(vals) if vals else None


def dedupe(items: list[dict]) -> list[dict]:
    out: list[dict] = []
    for it in items:
        hit = next((o for o in out if o["kind"] == it["kind"] and _same_event(o, it)), None)
        if hit:
            _merge_into(hit, it)
        else:
            out.append(it)
    return out


ARREST_N = re.compile(r"(\d{1,4})\s+(?:interpellations?|arrestations?|interpelles?|interpellés?|arrests?|arrested|detained|"
                      r"personnes? interpell\w*|gardes? a vue|gardes? à vue|detenidos?|arrestati|fermati)", re.I)


def arrests_in(texts: list[str]) -> int | None:
    best = None
    for t in texts:
        for m in ARREST_N.finditer(t or ""):
            n = int(m.group(1))
            if n < 5000:
                best = max(best or 0, n)
    return best


def fold_into_protests(protests_today: list[dict], items: list[dict]) -> list[dict]:
    """Today: incidents near a protest and inside its window become lines of its card ("12 arrests; police
    charge"), not markers of their own. Returns the items left standing."""
    left = []
    for it in items:
        host = None
        t = _utc(it.get("last_update"))
        for p in protests_today:
            a, b = _utc(p.get("starts_utc")), _utc(p.get("ends_utc")) or _utc(p.get("last_update"))
            if a and t and (t < a - _dt.timedelta(hours=1) or (b and t > b + _dt.timedelta(hours=2))):
                continue
            if metres(p["lat"], p["lon"], it["lat"], it["lon"]) <= FOLD_M:
                host = p
                break
        if host is None:
            left.append(it)
            continue
        host.setdefault("_folded", []).append(it)
    for p in protests_today:
        f = p.pop("_folded", [])
        if not f:
            continue
        texts = [m["text"] for x in f for m in x.get("messages") or []] + [x["title"] for x in f]
        n = arrests_in(texts)
        bits = []
        if n:
            bits.append(f"{n} arrests")
        elif any(x["kind"] == "arrest" for x in f):
            bits.append("arrests reported")
        pol = [x for x in f if x["kind"] == "police"]
        if pol:
            bits.append(clean_message(pol[0]["title"], 60).lower() if len(pol) == 1 else f"{len(pol)} police interventions")
        if any(x["kind"] == "clash" for x in f):
            bits.append("clashes")
        if bits:
            p["line"] = "; ".join([p["line"]] + bits)
        p["lines"] = [x["title"] for x in f][:5]
        for x in f:
            _merge_into(p, {**x, "first_seen": None, "last_update": None})
    return left


def build(*, signals_day: list[dict], street_day: list[dict], protests: list[dict], announcements: list[dict],
          now: _dt.datetime) -> dict:
    """{live: [...], today: [...], upcoming: [...]} from the shared inputs. Pure.
    signals_day: live_signals.build(live_only=False) over the last 24 h; street_day: street_reports.signals(24);
    protests: protest_status.snapshot()['protests']; announcements: telegram_ingest.upcoming()."""
    import force_context as fc
    live, today = [], []
    for s in signals_day:
        if (s.get("country_code") or "") in fc.WAR_THEATRES:
            continue
        frame = "live" if s.get("live") else "today"
        t = _utc(s.get("event_time"))
        if frame == "today" and not happened_today(t, s.get("country_code"), now):
            continue
        it = from_signal(s, frame, now)
        if it:
            (live if frame == "live" else today).append(it)
    for r in street_day:
        if (r.get("country_code") or "") in fc.WAR_THEATRES:
            continue
        frame = "live" if r.get("current") else "today"
        if frame == "today" and not happened_today(_utc(r.get("at")), r.get("country_code"), now):
            continue
        it = from_street(r, frame, now)
        if it:
            (live if frame == "live" else today).append(it)
    live, today = dedupe(live), dedupe(today)
    # the crowd's and the police's movement, from the live positions of the last hours
    pos_crowd = [_position(i) for i in live + today if i["kind"] == "crowd"
                 and (now - _utc(i["last_update"])).total_seconds() / 60 <= TRACK_LOOKBACK_MIN]
    pos_police = [_position(i) for i in live + today if i["kind"] == "police"
                  and (now - _utc(i["last_update"])).total_seconds() / 60 <= TRACK_LOOKBACK_MIN]
    live += tracks(pos_crowd, "crowd_track", now) + tracks(pos_police, "police_track", now)
    p_live = [x for x in (from_protest(p, "live", now) for p in protests) if x]
    p_today = [x for x in (from_protest(p, "today", now) for p in protests) if x]
    upcoming = [x for x in (from_protest(p, "upcoming", now) for p in protests) if x]
    # announcements not already one of protest_status's protests (same post, or same place and day)
    keys = {(s.get("channel"), s.get("msg_id")) for p in protests for s in p.get("sources") or []}
    for a in announcements:
        if (a.get("channel"), a.get("msg_id")) in keys:
            # protest_status has it: lend it the organiser and the cause
            for u in upcoming:
                if any((s.get("url") and s.get("url") == a.get("url")) for s in u["sources"]):
                    by, cause = clean_message(a.get("organiser"), 80), clean_message(a.get("cause"), 120)
                    u["organiser"], u["cause"] = by or None, cause or None
                    u["line"] = "; ".join(x for x in (u["line"], f"called by {by}" if by else "", cause) if x)
            continue
        it = from_announcement(a, now)
        if not it:
            continue
        day = (it["starts_utc"] or "")[:10]
        if any(metres(u["lat"], u["lon"], it["lat"], it["lon"]) <= 500 and (u.get("starts_utc") or "")[:10] == day for u in upcoming):
            continue
        upcoming.append(it)
    today = p_today + fold_into_protests(p_today, today)
    live = p_live + live
    order = {"protest": 0, "crowd_track": 1, "police_track": 2, "police": 3, "arrest": 4, "clash": 5, "crowd": 6}
    live.sort(key=lambda i: (order.get(i["kind"], 9), -(_utc(i["last_update"]) or now).timestamp()))
    today.sort(key=lambda i: -(_utc(i["last_update"]) or _utc(i.get("starts_utc")) or now).timestamp())
    upcoming.sort(key=lambda i: i.get("starts_utc") or "")
    return {"live": live, "today": today, "upcoming": upcoming}


# ── reading (blocking: call from a thread) ─────────────────────────────────

def compute(now: _dt.datetime | None = None) -> dict:
    now = now or _dt.datetime.now(_dt.timezone.utc)
    errors = {}
    sigs = []
    try:
        import live_signals as ls
        import telegram_ingest as tg
        con = tg._con()
        try:
            atoms = ls.read_atoms(con, now - _dt.timedelta(hours=DAY_FALLBACK_H + 2))
            atoms = [a for a in atoms if a["act"] in PROTEST_ACTS]
            sigs = ls.build(atoms, ls.attach_media(con, atoms), now, live_only=False)
        finally:
            con.close()
    except Exception as e:                                     # noqa: BLE001
        errors["signals"] = f"{type(e).__name__}: {e}"
    street = []
    try:
        import street_reports as srp
        street = srp.signals(24.0)
    except Exception as e:                                     # noqa: BLE001
        errors["street"] = f"{type(e).__name__}: {e}"
    prot = []
    try:
        import protest_status as ps
        prot = ps.snapshot()["protests"]
    except Exception as e:                                     # noqa: BLE001
        errors["protests"] = f"{type(e).__name__}: {e}"
    ann = []
    try:
        import telegram_ingest as tg
        ann = tg.upcoming(UPCOMING_D + 1)
    except Exception as e:                                     # noqa: BLE001
        errors["announcements"] = f"{type(e).__name__}: {e}"
    for k, v in errors.items():
        print(f"[protests] error: {k}: {v}", flush=True)
    out = build(signals_day=sigs, street_day=street, protests=prot, announcements=ann, now=now)
    # an item that belongs to a stored event carries its id, status and evolving brief (events.py); the layer's
    # own accuracy rules above are untouched: this only adds fields
    try:
        import events
        events.annotate([i for f in ("live", "today") for i in out.get(f) or []], lambda i: i.get("refs"))
    except Exception as e:                                     # noqa: BLE001
        errors["events"] = f"{type(e).__name__}: {e}"
        print(f"[protests] error: events: {errors['events']}", flush=True)
    out["generated_at"] = iso(now)
    out["errors"] = errors
    return out


from shared_cache import SharedCache  # noqa: E402
_CACHE = SharedCache("protests", ttl=CACHE_S, max_stale=MAX_STALE_S)


def snapshot() -> dict:
    """The three frames, built once for everybody."""
    return _CACHE.get("all", compute)


FRAMES = ("live", "today", "upcoming")


def empty_note(counts: dict, frame: str) -> str | None:
    """What the layer says when the frame is empty in the user's areas."""
    if counts.get(frame):
        return None
    head = {"live": "Nothing live in your areas right now.", "today": "Nothing reported in your areas today.",
            "upcoming": "Nothing announced in your areas for the next 7 days."}[frame]
    rest = []
    for f, word in (("live", "live now"), ("today", "today"), ("upcoming", "upcoming")):
        if f != frame and counts.get(f):
            n = counts[f]
            rest.append(f"{n} {'protest' if n == 1 else 'protests'} {word}" if f != "upcoming" else f"{n} upcoming")
    return head + (" " + ", ".join(rest) + "." if rest else "")


def for_user(user, frame: str = "live") -> dict:
    """One user's answer: the shared build filtered by their profile (a copy; nothing shared is changed)."""
    import profile_filter as pf
    snap = snapshot()
    sc = pf.scope(user)
    kept, hidden = {}, 0
    for f in FRAMES:
        k, h = sc.filter(snap.get(f) or [])
        kept[f] = k
        hidden += h
    counts = {f: len([i for i in kept[f] if i["kind"] not in ("crowd_track", "police_track")]) for f in FRAMES}
    frame = frame if frame in FRAMES else "live"
    return {"frame": frame, "items": kept[frame], "counts": counts, "note": empty_note(counts, frame),
            "any_live": bool(kept["live"]), "refresh_s": 15 if kept["live"] else 60,
            "generated_at": snap.get("generated_at"), "profile": sc.block(hidden)}
