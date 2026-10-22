"""
upcoming_gate.py — what an announced (upcoming) gathering needs to be listed.

Small and pure on purpose: the Desk's Upcoming list (telegram_ingest.upcoming)
uses it, and the Protests layer can use the same rule, so the two never
disagree (2026-10-23).

An announcement is listed only with
  * a REAL FUTURE TIME: a stated time of day still ahead of now, or a stated
    day after today. A bare day that is today cannot be told from one that is
    over ("2026-10-22" was still listed on the 23rd's morning as upcoming), and
    a time that is only the post's own clock is not the event's.
  * a NAMED PLACE: the first part of the place names somewhere ("Place de la
    République", "Lyon"), not a kind of place ("Place, Bordeaux, France" was
    the word "place" geocoded to a hamlet), not a bare country, and a point that
    is not a country's centre.

Each check returns (ok, why); `why` says what failed, for the audit.
"""
from __future__ import annotations

import datetime as _dt
import re

_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _parse(v) -> _dt.datetime | None:
    s = str(v or "").strip()
    if not s:
        return None
    try:
        d = _dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)


def future_time(starts_at, starts_utc=None, posted_at=None, now: _dt.datetime | None = None) -> tuple[bool, str]:
    """(ok, why): the announcement states a time still to come."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    s = str(starts_at or "").strip()
    if not s:
        return False, "no time stated"
    if _DATE_ONLY.match(s):
        if s > now.strftime("%Y-%m-%d"):
            return True, "a day after today"
        return False, "only a day, and it is today or past"
    at = _parse(starts_utc) or _parse(s)
    if at is None:
        return False, f"time '{s[:25]}' unreadable"
    if at <= now:
        return False, "the time has passed"
    pa = _parse(posted_at)
    if pa is not None and abs((at - pa).total_seconds()) < 60:
        return False, "the time is the post's own clock"
    return True, "a stated time ahead"


def _country_names() -> set[str]:
    """Every country name the product uses (location_extract's tables)."""
    try:
        import location_extract as le
        names = set(str(n).lower() for n in le._COUNTRY_NAME_BY_CODE.values())
        names |= set(str(n).lower() for n in le._iso_names().values())
        names |= set(str(n).lower() for n in le._CODE_GAP_NAMES.values())
        return names
    except Exception:                                           # noqa: BLE001
        return set()


_COUNTRIES: set[str] | None = None


def _is_country(name: str, country_code: str | None) -> bool:
    global _COUNTRIES
    n = name.strip().lower()
    if not n:
        return False
    try:
        import user_concern as uc
        if country_code and (uc._country_name(country_code) or "").lower() == n:
            return True
    except Exception:                                           # noqa: BLE001
        pass
    if _COUNTRIES is None:
        _COUNTRIES = _country_names()
    return n in _COUNTRIES


def named_place(place, lat=None, lon=None, country_code=None) -> tuple[bool, str]:
    """(ok, why): the place names somewhere a person could go."""
    parts = [p.strip() for p in str(place or "").split(",") if p.strip()]
    if not parts:
        return False, "no place stated"
    first = parts[0]
    from textclean import is_generic_place
    if is_generic_place(first):
        return False, f"'{first}' is a kind of place, not a place"
    if len(parts) == 1 and _is_country(first, country_code):
        return False, "only a country"
    if lat is None or lon is None:
        return False, "no point"
    try:
        import strike_events
        if strike_events.is_country_centroid(lat, lon):
            return False, "the point is a country's centre"
    except Exception:                                           # noqa: BLE001
        pass
    return True, "a named place"


def listed(item: dict, now: _dt.datetime | None = None) -> tuple[bool, str]:
    """Both rules on one announcement dict (telegram_events.announcements' shape:
    starts_at, starts_utc, posted_at, place, lat, lon, country_code)."""
    ok, why = future_time(item.get("starts_at"), item.get("starts_utc"), item.get("posted_at"), now)
    if not ok:
        return False, why
    return named_place(item.get("place"), item.get("lat"), item.get("lon"), item.get("country_code"))


def keep(items: list[dict], now: _dt.datetime | None = None) -> list[dict]:
    """The announcements that may be listed."""
    return [it for it in items or [] if listed(it, now)[0]]
