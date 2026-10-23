"""Server stability under several users (2026-10-19).

With three phones open, production queued 60-115 requests deep and the
liveness probe took 111 s. These pin the fixes that do not need a load:
the probe never waits for the request thread pool, and presence sends a
face, not a profile. The load itself is tools/loadtest.py, which runs here
only when LOADTEST_BASE points at a server started on a seeded scratch
DATA_DIR (tools/loadtest_seed.py) — it fails if the p95 of 5 phones
regresses past LOADTEST_MAX_P95 (seconds, default 1.5).
"""
import asyncio
import inspect
import os
import subprocess
import sys
import types

import pytest

import main


def test_liveness_probe_does_not_queue_for_the_thread_pool():
    route = next(r for r in main.app.routes if getattr(r, "path", None) == "/api/health/live")
    assert inspect.iscoroutinefunction(route.endpoint)
    assert asyncio.run(route.endpoint()) == {"status": "ok"}


def test_presence_sends_a_face_not_the_whole_profile():
    u = types.SimpleNamespace(
        id="u1", email="a@b.c", name="A", role="analyst", is_super_admin=False, approved=True,
        initials="A", avatar="data:image/jpeg;base64,xx", color="#123", timezone=None, shift=None,
        title="Analyst", company="X", location="Paris", bio="long text", cover="data:" + "x" * 370_000,
        avatar_pos=None, cover_pos=None, team_id=None, capability_role=None, theme=None,
        settings={"private": True})
    face = main._user_face(u)
    assert set(face) == {"id", "name", "email", "initials", "color", "avatar", "avatar_pos", "title"}
    assert "cover" not in face and "settings" not in face


@pytest.mark.skipif(not os.getenv("LOADTEST_BASE"), reason="needs a running server (LOADTEST_BASE)")
def test_five_phones_p95_does_not_regress():
    here = os.path.dirname(os.path.abspath(__file__))
    r = subprocess.run([sys.executable, os.path.join(here, "tools", "loadtest.py"),
                        "--base", os.environ["LOADTEST_BASE"], "--clients", "5",
                        "--seconds", os.getenv("LOADTEST_SECONDS", "60"),
                        "--max-p95", os.getenv("LOADTEST_MAX_P95", "1.5")],
                       capture_output=True, text=True, timeout=600)
    print(r.stdout)
    assert r.returncode == 0, r.stdout + r.stderr


def test_asset_list_answers_before_the_exposure_is_built(monkeypatch):
    """The registry must not wait for each asset's threat assessment (54 s on a cold server):
    the list answers at once, 'building' until the background pass has filled the exposure."""
    import asyncio, time
    from routers import my_assets as ma
    assets = [{"id": f"OA-{i}", "owner_id": "u1", "name": f"A{i}", "kind": "site", "lat": 48.0, "lon": 2.0,
               "radius_km": 5, "identifiers": {}} for i in range(3)]
    monkeypatch.setattr(ma.oa, "list_for", lambda uid: assets)
    monkeypatch.setattr(ma, "_me", lambda r: {"id": "u1", "email": "a@b"})
    monkeypatch.setattr(ma.oa, "position", lambda a, *x: {"lat": 48.0, "lon": 2.0})
    def slow(a):
        time.sleep(0.5)
        return {"exposure": "elevated", "signals": [{"title": "t"}]}
    monkeypatch.setattr(ma, "situation", slow)
    ma._EXPO.clear(); ma._EXPO_WARMING.clear()
    t = time.time()
    first = asyncio.run(ma.list_assets(object()))["assets"]
    assert time.time() - t < 0.4 and len(first) == 3 and all(a["building"] and a["exposure"] == "unknown" for a in first)
    time.sleep(2.2)
    second = asyncio.run(ma.list_assets(object()))["assets"]
    assert all(not a["building"] and a["exposure"] == "elevated" and a["signal_count"] == 1 for a in second)


def test_start_script_bounds_native_threads_and_malloc_arenas():
    """48 CPUs in production: ~150 idle native pool threads and 48 malloc arenas (2.45 GB)."""
    here = os.path.dirname(os.path.abspath(__file__))
    s = open(os.path.join(here, "start.sh"), encoding="utf-8").read()
    for var in ("MALLOC_ARENA_MAX", "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        assert f'export {var}="${{{var}:-' in s, var
    assert s.index("export MALLOC_ARENA_MAX") < s.index("python -m uvicorn")


def test_per_event_and_per_request_caches_are_capped():
    """Keyed by event id, url or a request's query and never evicted: they grew for
    the life of the web process (12.1 GB RSS seen 2026-10-19)."""
    for name in ("_PREFETCH_CACHE", "_ENRICHMENT_CACHE", "_CITY_NEWS_CACHE", "_WIKI_IMAGE_CACHE", "_OG_CACHE"):
        d = getattr(main, name)
        assert isinstance(d, main.CappedDict) and d.maxsize <= 5_000, name
    d = main.CappedDict(maxsize=3)
    for i in range(10):
        d[i] = i
    assert list(d) == [7, 8, 9]


def test_asset_exposure_cache_is_bounded(monkeypatch):
    """_EXPO kept one entry per (asset, position, identifiers) forever: every edit and every
    deleted asset stayed in memory. One entry per asset id, an age limit and a size cap."""
    from routers import my_assets as ma
    ma._EXPO.clear()
    monkeypatch.setattr(ma, "EXPO_MAX", 50)
    a = {"id": "OA-1", "lat": 1.0, "lon": 2.0, "radius_km": 5, "kind": "site", "identifiers": {}}
    ma._expo_put(ma._expo_key(a), {"exposure": "low"})
    ma._expo_put(ma._expo_key({**a, "lat": 1.5}), {"exposure": "high"})
    assert len(ma._EXPO) == 1 and next(iter(ma._EXPO.values()))[1]["exposure"] == "high"
    for i in range(200):
        ma._expo_put(ma._expo_key({**a, "id": f"OA-x{i}"}), {"exposure": "low"}, now=1000.0 + i)
    assert len(ma._EXPO) <= 50
    # an entry older than the age limit is gone at the next write
    ma._EXPO.clear()
    ma._expo_put(("old",), {}, now=0.0)
    ma._expo_put(("new",), {}, now=ma.EXPO_MAX_AGE_S + 10.0)
    assert list(ma._EXPO) == [("new",)]
    ma._EXPO.clear()
