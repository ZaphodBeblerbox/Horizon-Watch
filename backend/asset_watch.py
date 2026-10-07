"""
asset_watch.py — what is happening to YOUR assets, as notifications.

The tray is shared: an alert earns a card by its own rules
(notification_context.notification_relevance), the same for everyone. What
makes something matter to one user is that it is near something of theirs —
a strike 12 km from their tanker is a card for them however routine the feed
calls it. So each user's assets are ranked against every signal in their
radius (the asset register's own ranking, routers/my_assets.situation) and
the ones that count become cards that say which asset and how far:

    "Drone strike on Ras Isa terminal — 18 km from MT Aurora (your tanker)"

What counts: high or critical within the radius, or anything in the inner
quarter of it, in the last 24 hours. Ranking an asset reads several sources,
so it is never done on the tray's request: each user's cards are rebuilt in
the background at most every five minutes and the request reads the last
set (empty the first time, filled a few seconds later).
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

REFRESH_S = 300
MAX_AGE_H = 24
_cache: dict[str, tuple[float, list[dict]]] = {}
_running: set[str] = set()
_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="asset-watch")

_SEV = {"critical": "critical", "high": "high", "significant": "high", "elevated": "moderate"}


def counts(sig: dict, radius_km: float) -> bool:
    if sig.get("age_h") is not None and sig["age_h"] > MAX_AGE_H:
        return False
    sev = str(sig.get("severity") or "").lower()
    return sev in ("critical", "high", "significant") or (sig.get("km") or 1e9) <= radius_km / 4


def cards_for(asset: dict, sit: dict) -> list[dict]:
    """Notification cards for one asset's ranked situation."""
    out = []
    label = (asset.get("kind_label") or "asset").lower()
    for s in sit.get("signals") or []:
        if not counts(s, asset.get("radius_km") or 50):
            continue
        dist = "under 1 km" if (s.get("km") or 0) < 1 else f"{round(s['km'])} km"
        title = str(s.get("title") or "A signal").strip().rstrip(".")
        out.append({
            "id": f"asset:{asset['id']}:{s.get('id')}",
            "signal_id": s.get("id"),
            "title": f"{title} — {dist} from {asset['name']} (your {label})",
            "sev": _SEV.get(str(s.get("severity") or "").lower(), "moderate"),
            "reason": f"within {round(asset.get('radius_km') or 0)} km of your {label} {asset['name']}",
            "notify": True, "kind": "asset",
            "alert_type": "Asset exposure", "source": s.get("source"),
            "lat": s.get("lat"), "lon": s.get("lon"),
            "entity_id": asset["id"], "entity_name": asset["name"],
            "asset_id": asset["id"],
            "created_at": s.get("when"),
        })
    return out


def _rebuild(uid: str) -> None:
    try:
        import owned_assets as oa
        from routers.my_assets import situation
        cards: list[dict] = []
        for a in oa.list_for(uid):
            try:
                cards += cards_for(a, situation(a))
            except Exception as e:                       # noqa: BLE001 — one asset never blanks the rest
                print(f"[asset_watch] {a.get('name')}: {type(e).__name__}: {e}", flush=True)
        cards.sort(key=lambda c: str(c.get("created_at") or ""), reverse=True)
        with _lock:
            _cache[uid] = (time.time(), cards[:30])
    except Exception as e:                               # noqa: BLE001
        print(f"[asset_watch] rebuild failed for {uid}: {type(e).__name__}: {e}", flush=True)
        with _lock:
            _cache[uid] = (time.time(), _cache.get(uid, (0, []))[1])
    finally:
        with _lock:
            _running.discard(uid)


def notifications_for(uid: str | None) -> list[dict]:
    """The last cards for this user; schedules a rebuild when they are stale."""
    if not uid:
        return []
    with _lock:
        at, cards = _cache.get(uid, (0.0, []))
        stale = time.time() - at > REFRESH_S
        if stale and uid not in _running:
            _running.add(uid)
            _pool.submit(_rebuild, uid)
    return list(cards)
