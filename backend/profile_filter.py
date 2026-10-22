"""
profile_filter.py — the per-user profile filter, shaped for each endpoint.

user_concern.py decides whether one item concerns one user. This module
applies that to the answers the maps, Home, the Desk and the lists return,
AFTER the shared build: every cache underneath (SharedCache, street_reports,
the surface pool, demonstrations' memo) is computed once for everybody and
only read here. Nothing is rebuilt per user, and nothing a cache holds is
mutated — answers are copied before a list is replaced (the 2026-10-19
multi-user stall was per-user work on a shared path).

Every filtered dict answer carries `profile`: {filtered, hidden, has_profile,
switch, hint}; a bare list carries the same in the header X-Profile-Hidden
(+ X-Profile-Filtered). The settings page reads the counts from
/api/profile/scope.
"""
from __future__ import annotations

from typing import Callable

import user_concern as uc


def scope(user) -> uc.Scope:
    try:
        return uc.scope_for(user)
    except Exception as e:                                       # noqa: BLE001
        print(f"[profile-filter] error: scope: {type(e).__name__}: {e}", flush=True)
        return uc.Scope(None)


def lists(answer: dict, user, *keys: str, sc: uc.Scope | None = None) -> dict:
    """A copy of `answer` with each named list filtered, plus `profile`."""
    sc = sc or scope(user)
    out = dict(answer)
    hidden = 0
    for k in keys:
        if isinstance(out.get(k), list):
            out[k], n = sc.filter(out[k])
            hidden += n
    out["profile"] = sc.block(hidden)
    return out


def bare(items: list, user, response=None, key: Callable | None = None, sc: uc.Scope | None = None) -> list:
    """A filtered list for an endpoint that answers a bare list; the count
    goes in headers."""
    sc = sc or scope(user)
    kept, hidden = sc.filter(items, key)
    if response is not None:
        response.headers["X-Profile-Filtered"] = "1" if sc.active else "0"
        response.headers["X-Profile-Hidden"] = str(hidden)
    return kept


def paged(user, fetch: Callable, before, limit: int, list_key: str, max_pages: int = 6) -> dict:
    """A paged feed, filtered. A page the filter empties would stop the
    reader, so more pages are read (bounded) until `limit` kept or the end.
    `fetch(before)` -> {list_key: [...], "next": cursor}. The cursor is the
    last page READ, so nothing repeats and nothing is skipped."""
    sc = scope(user)
    res = fetch(before)
    if not sc.active:
        return {**res, "profile": sc.block(0)}
    kept, hidden = sc.filter(res.get(list_key))
    for _ in range(max_pages - 1):
        if len(kept) >= limit or not res.get("next"):
            break
        res = fetch(res["next"])
        k, h = sc.filter(res.get(list_key))
        kept += k
        hidden += h
    return {**res, list_key: kept, "profile": sc.block(hidden)}


# ── demonstrations / street reports ─────────────────────────────────────────

def demonstrations(snap: dict, user) -> dict:
    """The map's demonstrations layer: hazards, crowd tracks, protests."""
    return lists(snap, user, "demonstrations", "tracks", "protests")


def street(snap: dict, user) -> dict:
    sc = scope(user)
    out = lists(snap, user, "reports", sc=sc)
    if isinstance(out.get("reports"), list):
        out["located"] = sum(1 for s in out["reports"] if s.get("lat") is not None)
    return out


def situation(answer: dict, user) -> dict:
    """demo_situation's per-city answer: a city is kept by where its crowds are."""
    return lists(answer, user, "cities")


# ── notifications ───────────────────────────────────────────────────────────

# Cards made for one person or one team, not about "the world": they are
# theirs whatever the place says.
PERSONAL_KINDS = {"message", "desk", "warning", "asset", "exit", "assign", "rfi", "escalate", "livestream"}


def personal(card: dict) -> bool:
    import event_watch as ew
    return card.get("kind") in PERSONAL_KINDS or ew._own(card) or bool(card.get("asset_id"))


def notifications(items: list, user) -> list:
    """The tray (and the push sweep) held to the same profile as the lists:
    personal cards stay, the rest must concern the user."""
    sc = scope(user)
    if not sc.active:
        return items
    return [it for it in items if personal(it) or sc.concerns(it)[0]]


def mood(answer: dict, user) -> dict:
    """Mood by country (the list; one country asked for by name is shown)."""
    if "countries" not in answer:
        return answer
    return lists(answer, user, "countries")
