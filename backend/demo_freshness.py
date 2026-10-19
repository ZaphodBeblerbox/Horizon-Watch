"""demo_freshness.py — one rule for how long a demonstration stays news.

The owner, 2026-10-19: "I don't want to know about demonstrations that
happened 24 hours ago unless it's in a statistic."

A demonstration and everything that comes with it (its calls, the crowds,
the police interventions, the street reports, the footage from there)
leaves the map, the Desk, Home, the notifications and the cards once its
LAST ACTIVITY is more than MAX_AGE_H old. Statistics (counts, trends, the
mood, the unrest likelihood) read the tables directly and keep counting it.

Derived on read, never stored (memory: "derive on read, don't store"):
nothing is flagged or deleted, each reader asks keep() on the way out, so a
change to the rule applies to everything at once. The same rule is in
src/globe/freshness.js for the clients' own guard — keep the two the same.

Last activity is the newest of the item's own times: its last report
(last_at, at, last_report_at, posted_at), the end it was seen to have
(until), and its start (starts_utc) — so an announcement made two days ago
for a march tomorrow is not old news, and one whose march is on stays.
"""
from __future__ import annotations

import datetime as _dt

MAX_AGE_H = 24

# what makes an item a demonstration's: its category, its kind or its signal
DEMO_CATEGORIES = {"unrest"}
DEMO_KINDS = {"street_report", "protest", "demonstration", "police_action", "demo_crowd", "protest_track",
              "intent", "at", "announcement"}
DEMO_SIGNAL_KINDS = {"street_report", "intent", "at"}

_TIME_KEYS = ("last_at", "at", "last_report_at", "posted_at", "until", "starts_utc", "starts_at", "created_at", "published_at")


def _utc(v) -> _dt.datetime | None:
    if not v:
        return None
    if isinstance(v, _dt.datetime):
        return v if v.tzinfo else v.replace(tzinfo=_dt.timezone.utc)
    try:
        d = _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)


def is_demo(item: dict) -> bool:
    """A demonstration's item: unrest, a street report, a protest, a call or
    a position, a crowd, footage from the ground."""
    if not isinstance(item, dict):
        return False
    if str(item.get("category") or "").lower() in DEMO_CATEGORIES or str(item.get("event_type") or "").lower() in DEMO_CATEGORIES:
        return True
    if item.get("street_report") or item.get("on_ground"):
        return True
    if str(item.get("signal_kind") or "") in DEMO_SIGNAL_KINDS:
        return True
    return str(item.get("kind") or "") in DEMO_KINDS


def last_activity(item: dict) -> _dt.datetime | None:
    """The newest of the item's own times (its status's too)."""
    ts = [_utc(item.get(k)) for k in _TIME_KEYS]
    st = item.get("status") if isinstance(item.get("status"), dict) else None
    ps = item.get("protest_status") if isinstance(item.get("protest_status"), dict) else None
    for s in (st, ps):
        if s:
            ts += [_utc(s.get(k)) for k in ("last_report_at", "until", "since", "starts_utc")]
    it = item.get("intent") if isinstance(item.get("intent"), dict) else None
    if it:
        ts.append(_utc(it.get("starts_utc")))
    ts = [t for t in ts if t is not None]
    return max(ts) if ts else None


def stale(item: dict, now: _dt.datetime | None = None, max_age_h: float = MAX_AGE_H) -> bool:
    """Is this a demonstration's item whose last activity is older than
    max_age_h? An item with no time at all is kept (nothing says it is old)."""
    if not is_demo(item):
        return False
    last = last_activity(item)
    if last is None:
        return False
    now = now or _dt.datetime.now(_dt.timezone.utc)
    return (now - last).total_seconds() > max_age_h * 3600


def keep(items: list[dict] | None, now: _dt.datetime | None = None, max_age_h: float = MAX_AGE_H) -> list[dict]:
    """The items still worth showing: everything but the old demonstrations'."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    return [x for x in (items or []) if not stale(x, now, max_age_h)]
