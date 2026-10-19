"""loadtest.py — N simulated clients against a running backend, replaying
what one open phone actually requests.

THE MIX is production's, not a guess: Railway's edge log for one iPhone
over the healthy eight minutes before the 2026-10-19 19:38 UTC collapse
(per minute: presence 7.3 POST + 7.3 GET, warnings inbox 6.6, chat unread
5.1, notifications 3.9, Telegram feed 3.4, Telegram posts 2.6, surface 2.4,
Telegram live 2.0, Desk posts 1.4, theaters 1.4, health 1.5, my-assets 0.8,
…). Each client polls each endpoint on its own timer with a random phase,
like independent components do; a client never has two requests for the
same endpoint in flight (that is the browser's own behaviour per hook only
since 2026-10-19 — see usePoll). A separate prober asks /api/health/live
every second: its latency is what the phone's "Server slow" line reads.

Usage (backend/, server already running on a seeded scratch DATA_DIR —
see tools/loadtest_seed.py):
    python tools/loadtest.py --base http://127.0.0.1:8103 --clients 3 --seconds 60
    python tools/loadtest.py --clients 5 --max-p95 2.0     # exit 1 if p95 is worse

Prints overall and per-endpoint p50/p95/max, errors and timeouts, and the
health probe's p50/p95/max.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import sys
import time

import httpx

# (method, path, every_s) — one open phone, production 2026-10-19
PHONE = [
    ("POST", "/api/presence?record_ref=app:online", 15),
    ("GET", "/api/presence?record_ref=app:online", 15),
    ("GET", "/api/warnings/inbox?seen=1", 9),
    ("GET", "/api/chat/unread", 12),
    ("GET", "/api/notifications?limit=60", 15),
    ("GET", "/api/telegram/feed", 18),
    ("GET", "/api/telegram/posts", 23),
    ("GET", "/api/surface", 25),
    ("GET", "/api/telegram/live", 30),
    ("GET", "/api/desk/posts", 45),
    ("GET", "/api/theaters", 45),
    ("GET", "/api/health/detailed", 60),
    ("GET", "/api/my-assets", 80),
    ("GET", "/api/enrich/outlook", 120),
    ("GET", "/api/chat/conversations", 160),
    ("GET", "/api/general", 240),
    ("GET", "/api/routes/demonstrations", 240),
    ("GET", "/api/routes/demonstrations/situation", 240),
    ("GET", "/api/routes/demonstrations/street", 240),
    ("GET", "/api/telegram/situations", 240),
    ("GET", "/api/alerts/fusions", 300),
    ("GET", "/api/alerts/surges", 300),
]
PASSWORD = "loadtest-pw"


def pct(xs: list[float], p: float) -> float:
    if not xs:
        return float("nan")
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))]


async def login(client: httpx.AsyncClient, i: int) -> None:
    r = await client.post("/api/auth/login", json={"email": f"loadtest{i}@test.local", "password": PASSWORD},
                          timeout=120)
    r.raise_for_status()


async def poller(client, method, path, every, until, rec, timeout):
    await asyncio.sleep(random.random() * min(every, 10))       # independent components start apart
    while time.monotonic() < until - 0.5:
        t0 = time.monotonic()
        status = None
        try:
            r = await client.request(method, path, timeout=timeout)
            status = r.status_code
            await r.aread()
        except httpx.TimeoutException:
            status = "timeout"
        except httpx.HTTPError as e:
            status = type(e).__name__
        dt = time.monotonic() - t0
        rec.append((path.split("?")[0], method, dt, status, len(r.content) if isinstance(status, int) else 0))
        await asyncio.sleep(max(0.0, min(every - dt, until - time.monotonic())))


async def health_probe(base, until, out):
    async with httpx.AsyncClient(base_url=base) as c:
        while time.monotonic() < until:
            t0 = time.monotonic()
            try:
                await c.get("/api/health/live", timeout=30)
                out.append(time.monotonic() - t0)
            except httpx.HTTPError:
                out.append(30.0)
            await asyncio.sleep(max(0.0, 1.0 - (time.monotonic() - t0)))


async def run(base: str, clients: int, seconds: float, timeout: float, users: int = 6) -> dict:
    rec: list = []
    probe: list = []
    sessions = []
    for i in range(1, clients + 1):
        c = httpx.AsyncClient(base_url=base, limits=httpx.Limits(max_connections=12))
        await login(c, (i - 1) % users + 1)   # more phones than accounts: people sign in twice
        sessions.append(c)
    until = time.monotonic() + seconds
    tasks = [asyncio.create_task(health_probe(base, until, probe))]
    for c in sessions:
        for method, path, every in PHONE:
            tasks.append(asyncio.create_task(poller(c, method, path, every, until, rec, timeout)))
    await asyncio.gather(*tasks)
    for c in sessions:
        await c.aclose()
    lat = [x[2] for x in rec]
    bad = [x for x in rec if not (isinstance(x[3], int) and x[3] < 500)]
    per = {}
    for path, method, dt, status, size in rec:
        per.setdefault(f"{method} {path}", []).append((dt, status, size))
    return {
        "clients": clients, "seconds": seconds, "requests": len(rec),
        "p50": pct(lat, .5), "p95": pct(lat, .95), "max": max(lat) if lat else float("nan"),
        "errors": len(bad), "error_kinds": sorted({str(x[3]) for x in bad}),
        "health_p50": pct(probe, .5), "health_p95": pct(probe, .95), "health_max": max(probe) if probe else float("nan"),
        "per_endpoint": {k: {"n": len(v), "p50": pct([d for d, _, _ in v], .5), "p95": pct([d for d, _, _ in v], .95),
                             "max": max(d for d, _, _ in v), "bytes": int(statistics.median([s for _, _, s in v]))}
                         for k, v in per.items()},
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8103")
    ap.add_argument("--clients", type=int, default=3)
    ap.add_argument("--seconds", type=float, default=60)
    ap.add_argument("--timeout", type=float, default=30, help="per request, like apiFetch's 30 s")
    ap.add_argument("--max-p95", type=float, default=None, help="exit 1 if the overall p95 (s) is above this")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--users", type=int, default=6, help="accounts seeded by loadtest_seed.py")
    a = ap.parse_args()
    res = asyncio.run(run(a.base, a.clients, a.seconds, a.timeout, a.users))
    if a.json:
        print(json.dumps(res))
    else:
        print(f"{res['clients']} clients, {res['seconds']:.0f}s: {res['requests']} requests, "
              f"p50 {res['p50']:.3f}s p95 {res['p95']:.3f}s max {res['max']:.2f}s, errors {res['errors']} {res['error_kinds']}; "
              f"health/live p50 {res['health_p50']:.3f}s p95 {res['health_p95']:.3f}s max {res['health_max']:.2f}s")
        for k, v in sorted(res["per_endpoint"].items(), key=lambda kv: -kv[1]["p95"]):
            print(f"  {v['p95']:7.3f}s p95 {v['p50']:7.3f}s p50 {v['max']:7.2f}s max n={v['n']:4d} {v['bytes']:>8}B  {k}")
    if a.max_p95 is not None and not res["p95"] <= a.max_p95:
        print(f"FAIL: p95 {res['p95']:.3f}s > {a.max_p95}s", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
