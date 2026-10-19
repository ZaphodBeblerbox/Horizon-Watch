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
