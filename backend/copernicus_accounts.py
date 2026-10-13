"""
copernicus_accounts.py — which Copernicus (CDSE / Sentinel Hub) account to use.

The primary account is COPERNICUS_CLIENT_ID/SECRET; a backup is
COPERNICUS_CLIENT_ID_2/SECRET_2. When an account answers 403
ACCESS_INSUFFICIENT_PROCESSING_UNITS (its processing-unit quota is spent),
it is set aside for SATURATED_S and the next one is used, so imagery keeps
coming (owner, 2026-10-13: "so we always have images"). After that the
primary is tried again first.
"""
from __future__ import annotations

import os
import threading
import time

SATURATED_S = 6 * 3600
_LOCK = threading.Lock()
_SATURATED: dict[str, float] = {}       # client_id -> set aside until


def accounts() -> list[tuple[str, str]]:
    """[(client_id, client_secret)], primary first; only complete pairs."""
    out = []
    for suffix in ("", "_2"):
        cid = os.getenv(f"COPERNICUS_CLIENT_ID{suffix}", "").strip()
        sec = os.getenv(f"COPERNICUS_CLIENT_SECRET{suffix}", "").strip()
        if cid and sec:
            out.append((cid, sec))
    return out


def active(now: float | None = None) -> tuple[str, str] | None:
    """The first account not set aside; if all are, the one freed soonest."""
    now = now or time.time()
    accs = accounts()
    if not accs:
        return None
    with _LOCK:
        for a in accs:
            if _SATURATED.get(a[0], 0) <= now:
                return a
        return min(accs, key=lambda a: _SATURATED.get(a[0], 0))


def is_quota_exhausted(status: int, text: str) -> bool:
    return status == 403 and "PROCESSING_UNITS" in (text or "")


def mark_saturated(client_id: str, now: float | None = None) -> bool:
    """Set an account aside. True when another account is available."""
    now = now or time.time()
    with _LOCK:
        _SATURATED[client_id] = now + SATURATED_S
    others = [a for a in accounts() if a[0] != client_id and _SATURATED.get(a[0], 0) <= now]
    print(f"[copernicus] account …{client_id[-6:]} out of processing units; "
          f"{'switching to the backup' if others else 'no other account left'}", flush=True)
    return bool(others)
