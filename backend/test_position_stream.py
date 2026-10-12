"""Live positions, end to end: the phone's position reaches every viewer
allowed to see it within a second, by push (position_stream.py).

Pinned here: who may open the stream (a 60 s stream token, never a session
token in a URL), who receives what (self, team, admins; assets only to
those who may see them), that the history is thinned while the latest is
always kept, that 3 s updates pass the rate limit, and that neither the
database write nor the fan-out ever holds the event loop.
"""
import asyncio
import datetime as dt
import importlib
import json
import os
import socket
import threading
import time
import uuid

import httpx
import pytest
import uvicorn
from fastapi import FastAPI, HTTPException

import owned_assets as oa
import position_stream as ps
from routers import my_assets

T0 = dt.datetime(2026, 10, 12, 9, 0, tzinfo=dt.timezone.utc)


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = os.path.join(tmp_path, "t.db")
    monkeypatch.setattr(oa, "_db_path", lambda: path)
    monkeypatch.setattr(oa, "_last_prune", 0.0)
    return path


# ── who may see whom ──────────────────────────────────────────────────────

ANNA = {"id": "anna", "team_id": "red"}
BEN = {"id": "ben", "team_id": "red"}
CARL = {"id": "carl", "team_id": "blue"}
DORA = {"id": "dora", "team_id": None}
ADMIN = {"id": "root", "team_id": "blue", "is_super_admin": True}


def test_can_see_self_team_and_admins():
    assert ps.can_see(ANNA, "anna", "red")
    assert ps.can_see(BEN, "anna", "red")
    assert not ps.can_see(CARL, "anna", "red")            # another team
    assert not ps.can_see(DORA, "anna", "red")            # no team, no company in common: a stranger (2026-10-12)
    assert ps.can_see(ADMIN, "anna", "red")
    assert ps.can_see({"id": "x", "role": "admin", "team_id": "blue"}, "anna", "red")


def test_never_strangers_but_your_company_and_people_linked_to_your_assets():
    """LIVE VISIBILITY (owner, 2026-10-12): only your team or company, or
    people affiliated with you — a person outside the company linked to one
    of your assets still shows."""
    me = {"id": "me", "team_id": None, "company": "Trifecta Technologies"}
    # the same company, typed differently
    assert ps.can_see(me, "kim", None, "  trifecta   technologies ")
    # a stranger: another company, or none at all
    assert not ps.can_see(me, "zed", None, "Acme")
    assert not ps.can_see(me, "zed", None, None)
    assert not ps.can_see({"id": "nobody"}, "zed", None, None)
    # an outsider linked to an asset I own
    assert ps.can_see(me, "driver", None, "Taxi Co", [{"id": "me"}])
    # ... or owned by a colleague of my company
    assert ps.can_see(me, "driver", None, "Taxi Co", [{"id": "col", "company": "trifecta technologies"}])
    # linked to a stranger's asset: still a stranger to me
    assert not ps.can_see(me, "driver", None, "Taxi Co", [{"id": "zed", "company": "Acme"}])
    # their own "(live)" asset (owned by themselves) makes nobody affiliated
    assert not ps.can_see(me, "zed", None, "Acme", [{"id": "zed", "company": "Acme"}])
    # two teams are two organisations, whatever the free-text company says
    assert not ps.can_see({"id": "a", "team_id": "red", "company": "X"}, "b", "blue", "X")
    assert ps.can_see({"id": "a", "team_id": "red", "company": "X"}, "b", None, "X")


def test_visible_people_from_the_database(db, monkeypatch):
    """/people and the snapshot: the org rule plus links read from owned_assets."""
    users = {"me": {"name": "Me", "team_id": None, "company": "Trifecta"},
             "kim": {"name": "Kim", "team_id": None, "company": "trifecta"},
             "driver": {"name": "Driver", "team_id": None, "company": "Taxi Co"},
             "zed": {"name": "Zed", "team_id": None, "company": "Acme"}}
    monkeypatch.setattr(ps, "_users", lambda: users)
    a = oa.create("me", {"name": "Van 1", "kind": "vehicle_car", "lat": 1, "lon": 1})
    oa.link_user(a["id"], "driver")
    rows = [{"user_id": u, "lat": 1, "lon": 1, "at": "t", "assets": []} for u in users]
    seen = {p["user_id"]: p["name"] for p in ps.visible_people({"id": "me", "company": "Trifecta"}, rows)}
    assert seen == {"me": "Me", "kim": "Kim", "driver": "Driver"}         # never Zed
    assert ps.can_see_user({"id": "kim", "company": "trifecta"}, "driver")   # my colleague sees my driver too
    assert not ps.can_see_user({"id": "zed", "company": "Acme"}, "driver")
    oa.link_user(a["id"], None)                                           # unlinked: a stranger again
    assert not ps.can_see_user({"id": "me", "company": "Trifecta"}, "driver")


def test_the_stream_tells_only_the_person_warned():
    async def run():
        hub = ps.Hub()
        subs = {v["id"]: hub.subscribe(v) for v in (ANNA, BEN, ADMIN)}
        hub.publish({"type": "warning", "event": "warning", "to": ["ben"], "warning": {"id": "W-1"}})
        await asyncio.sleep(0)
        assert subs["anna"].queue.empty() and subs["root"].queue.empty()      # not even an admin
        got = subs["ben"].queue.get_nowait()
        assert got["warning"]["id"] == "W-1" and "to" not in got
    asyncio.run(run())


def test_an_asset_is_named_only_to_who_may_see_it():
    assets = [{"id": "OA-shared", "owner_id": "boss", "shared": True}, {"id": "OA-private", "owner_id": "boss", "shared": False}]
    assert [a["id"] for a in ps.visible_assets(BEN, assets)] == ["OA-shared"]
    assert [a["id"] for a in ps.visible_assets({"id": "boss"}, assets)] == ["OA-shared", "OA-private"]
    assert [a["id"] for a in ps.visible_assets(ADMIN, assets)] == ["OA-shared", "OA-private"]


def test_fan_out_reaches_allowed_viewers_only():
    async def run():
        hub = ps.Hub()
        subs = {v["id"]: hub.subscribe(v) for v in (ANNA, BEN, CARL, DORA, ADMIN)}
        hub.publish({"type": "position", "user_id": "anna", "team_id": "red", "name": "Anna", "lat": 1, "lon": 2,
                     "at": "t", "assets": [{"id": "OA-1", "owner_id": "anna", "shared": False}]})
        await asyncio.sleep(0)
        got = {k: (s.queue.get_nowait() if not s.queue.empty() else None) for k, s in subs.items()}
        assert got["carl"] is None and got["dora"] is None       # another team; no team at all
        for k in ("anna", "ben", "root"):
            assert got[k]["lat"] == 1 and "team_id" not in got[k]
        assert got["anna"]["assets"] == [{"id": "OA-1"}] and got["root"]["assets"] == [{"id": "OA-1"}]
        assert got["ben"]["assets"] == []                 # not shared, not his
        hub.unsubscribe(subs["ben"])
        hub.publish({"type": "position", "user_id": "anna", "team_id": "red", "lat": 3, "lon": 4, "at": "t", "assets": []})
        await asyncio.sleep(0)
        assert subs["ben"].queue.empty() and not subs["anna"].queue.empty()
    asyncio.run(run())


def test_a_slow_viewer_loses_the_oldest_never_the_newest():
    async def run():
        hub = ps.Hub()
        s = hub.subscribe(ANNA)
        for i in range(ps.QUEUE_MAX + 5):
            hub.publish({"type": "position", "user_id": "anna", "lat": i, "lon": 0, "at": "t", "assets": []})
        await asyncio.sleep(0)
        items = [s.queue.get_nowait() for _ in range(s.queue.qsize())]
        assert items[-1]["lat"] == ps.QUEUE_MAX + 4 and len(items) == ps.QUEUE_MAX and s.dropped == 5
    asyncio.run(run())


def test_publish_from_a_thread_never_waits_for_the_loop():
    """POST /live publishes from the threadpool: it hands the event over and
    returns, even while the loop is busy elsewhere."""
    async def run():
        hub = ps.Hub()
        s = hub.subscribe(ANNA)
        loop_busy = threading.Event()
        took = {}

        def from_thread():
            loop_busy.wait()
            t = time.perf_counter()
            hub.publish({"type": "position", "user_id": "anna", "lat": 9, "lon": 9, "at": "t", "assets": []})
            took["s"] = time.perf_counter() - t
        th = threading.Thread(target=from_thread)
        th.start()
        loop_busy.set()
        time.sleep(0.3)                                    # the loop is blocked right now
        th.join()
        assert took["s"] < 0.05
        await asyncio.sleep(0.01)
        assert s.queue.get_nowait()["lat"] == 9
    asyncio.run(run())


def test_nothing_is_published_with_no_stream_open():
    hub = ps.Hub()
    hub.publish({"type": "position", "user_id": "anna", "lat": 0, "lon": 0, "at": "t", "assets": []})
    assert hub.published == 0


# ── the store: latest always, history thinned ─────────────────────────────

def test_latest_always_history_thinned(db):
    """A walk sending every 3 s: the latest is every fix; the history a row
    per 10 m moved or per minute standing still."""
    a = oa.create("boss", {"name": "Anna", "kind": "person", "lat": 0, "lon": 0, "identifiers": {"user_id": "anna"}})
    lat = 48.85
    # standing still (2 m jitter) for 2 minutes at 3 s
    for i in range(41):
        r = oa.record_position("anna", lat + (i % 2) * 0.00002, 2.35, 8, "gps", now=T0 + dt.timedelta(seconds=3 * i))
        assert r["stored"]
    assert oa.latest("anna")["at"] == (T0 + dt.timedelta(seconds=120)).isoformat()
    hist = oa.positions("anna", hours=24 * 3650)
    assert len(hist) == 3                                  # t=0, t=60, t=120
    # walking ~15 m every 3 s: every fix is a history row
    for i in range(1, 6):
        r = oa.record_position("anna", lat + i * 0.000135, 2.35, 8, "gps", now=T0 + dt.timedelta(seconds=120 + 3 * i))
        assert r["history"]
    assert len(oa.positions("anna", hours=24 * 3650)) == 8
    # the linked asset is at the latest fix, its trail thinned the same way
    got = oa.get(a["id"], "boss")
    assert round(got["lat"], 6) == round(lat + 5 * 0.000135, 6)
    assert len(oa.track(a["id"], hours=24 * 3650)) == 8


def test_people_reads_the_latest_not_the_thinned_history(db):
    now = dt.datetime.now(dt.timezone.utc)
    oa.record_position("anna", 48.85, 2.35, 8, now=now - dt.timedelta(seconds=9))
    oa.record_position("anna", 48.85001, 2.35, 8, now=now - dt.timedelta(seconds=6))     # 1 m: no history row
    oa.record_position("anna", 48.85002, 2.35, 8, now=now - dt.timedelta(seconds=3))
    assert len(oa.positions("anna")) == 1
    p = oa.people(now=now)[0]
    assert p["lat"] == 48.85002 and p["live"]


def test_a_city_level_fix_is_held_against_the_latest_precise_one(db):
    oa.record_position("anna", 48.85, 2.35, 8, "gps", now=T0)
    r = oa.record_position("anna", 47.37, 8.55, 5000, "ip", now=T0 + dt.timedelta(minutes=5))
    assert r["held"] and not r["stored"]
    assert oa.latest("anna")["source"] == "gps"


def test_rate_limit_lets_3_s_updates_through(db):
    for i in range(10):
        oa.record_position("anna", 48.85 + i * 0.001, 2.35, 8, now=T0 + dt.timedelta(seconds=3 * i))
    with pytest.raises(oa.TooSoon):
        oa.record_position("anna", 48.87, 2.35, 8, now=T0 + dt.timedelta(seconds=27 + 1))
    assert oa.MIN_INTERVAL_S <= 3


def test_an_older_fix_never_replaces_the_latest(db):
    oa.record_position("anna", 1, 1, 8, now=T0 + dt.timedelta(seconds=30))
    oa.record_position("anna", 2, 2, 8, now=T0)
    assert oa.latest("anna")["lat"] == 1


# ── over HTTP, with a real server: the event arrives, the loop never waits ─

def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@pytest.fixture
def server(db, monkeypatch):
    """The two routers on a real uvicorn, signed in by X-Test-User (or ?t=user)."""
    users = {"anna": {"id": "anna", "name": "Anna", "team_id": "red"}, "ben": {"id": "ben", "name": "Ben", "team_id": "red"},
             "carl": {"id": "carl", "name": "Carl", "team_id": "blue"}}

    def me(request):
        u = users.get(request.headers.get("x-test-user") or "")
        if not u:
            raise HTTPException(401, "authentication required")
        return u
    monkeypatch.setattr(my_assets, "_me", me)
    monkeypatch.setattr(ps, "_viewer", lambda request, t: users.get(t or request.headers.get("x-test-user") or ""))
    monkeypatch.setattr(ps, "_users", lambda: {k: {"name": v["name"], "team_id": v["team_id"]} for k, v in users.items()})
    monkeypatch.setattr(ps, "HUB", ps.Hub())
    monkeypatch.setattr(ps, "KEEPALIVE_S", 0.5)
    app = FastAPI()
    app.include_router(my_assets.router)
    app.include_router(ps.router)

    @app.get("/ping")
    async def ping():
        return {"ok": True}
    port = _free_port()
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    th = threading.Thread(target=srv.run, daemon=True)
    th.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    th.join(timeout=5)


def _events(lines):
    name = None
    for line in lines:
        if line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            yield name, json.loads(line[5:])
            name = None
        elif line.startswith(":") and "keepalive" in line:
            yield "keepalive", None


def _read(base, viewer, out, n, stop, path="/api/positions/stream"):
    with httpx.Client(timeout=10) as c:
        with c.stream("GET", f"{base}{path}{'&' if '?' in path else '?'}t={viewer}") as r:
            out.append(("status", r.status_code, r.headers.get("content-type"), r.headers.get("x-accel-buffering")))
            for name, data in _events(r.iter_lines()):
                out.append((name, data, time.perf_counter()))
                if sum(1 for o in out if o[0] == "position") >= n or stop.is_set():
                    return


def test_stream_needs_a_viewer(server):
    r = httpx.get(f"{server}/api/positions/stream")
    assert r.status_code == 401


def test_positions_are_pushed_within_a_second_to_allowed_viewers(server):
    got = {"ben": [], "carl": []}
    stop = threading.Event()
    ts = [threading.Thread(target=_read, args=(server, v, got[v], 2, stop), daemon=True) for v in got]
    [t.start() for t in ts]
    time.sleep(0.6)                                         # both streams open, snapshots read
    sent = []
    with httpx.Client() as c:
        for i in range(2):
            sent.append(time.perf_counter())
            r = c.post(f"{server}/api/my-assets/live", json={"lat": 48.85 + i / 1000, "lon": 2.35, "accuracy": 8},
                       headers={"x-test-user": "anna"})
            assert r.status_code == 200, r.text
            time.sleep(oa.MIN_INTERVAL_S + 0.1)
    ts[0].join(timeout=5)
    stop.set()
    ben = got["ben"]
    assert ben[0][0] == "status" and ben[0][1] == 200 and ben[0][2].startswith("text/event-stream") and ben[0][3] == "no"
    assert any(o[0] == "snapshot" for o in ben)
    pos = [o for o in ben if o[0] == "position"]
    assert [p[1]["lat"] for p in pos] == [48.85, 48.851]
    assert pos[0][1]["name"] == "Anna" and pos[0][1]["user_id"] == "anna" and "team_id" not in pos[0][1]
    assert pos[0][1]["assets"]                              # her person asset, shared with the team
    lat = [p[2] - s for p, s in zip(pos, sent)]
    assert max(lat) < 1.0, lat
    assert not [o for o in got["carl"] if o[0] == "position"]    # another team: nothing


def test_snapshot_on_open_has_the_latest_positions(server):
    with httpx.Client() as c:
        assert c.post(f"{server}/api/my-assets/live", json={"lat": 10, "lon": 20, "accuracy": 8}, headers={"x-test-user": "anna"}).status_code == 200
    out, stop = [], threading.Event()
    th = threading.Thread(target=_read, args=(server, "ben", out, 99, stop), daemon=True)
    th.start()
    for _ in range(40):
        if any(o[0] == "snapshot" for o in out):
            break
        time.sleep(0.05)
    stop.set()
    snap = next(o[1] for o in out if o[0] == "snapshot")
    assert [(p["user_id"], p["lat"]) for p in snap["people"]] == [("anna", 10)]


def test_keepalive_comments_flow(server):
    out, stop = [], threading.Event()
    th = threading.Thread(target=_read, args=(server, "ben", out, 99, stop), daemon=True)
    th.start()
    time.sleep(1.4)
    stop.set()
    assert any(o[0] == "keepalive" for o in out)


def test_a_stream_ends_itself_and_says_so(server):
    out, stop = [], threading.Event()
    t = time.perf_counter()
    _read(server, "ben", out, 99, stop, path="/api/positions/stream?max_s=5")
    assert out[-1][0] == "bye" and 4.5 < time.perf_counter() - t < 8


def test_a_slow_database_write_never_holds_the_loop(server, monkeypatch):
    """The write runs in the threadpool: while it takes 1.5 s the server
    answers other requests at once and the open streams keep flowing."""
    real = oa.record_position

    def slow(*a, **k):
        time.sleep(1.5)
        return real(*a, **k)
    monkeypatch.setattr(oa, "record_position", slow)
    out, stop = [], threading.Event()
    th = threading.Thread(target=_read, args=(server, "ben", out, 1, stop), daemon=True)
    th.start()
    time.sleep(0.4)
    post = threading.Thread(target=lambda: httpx.post(f"{server}/api/my-assets/live", json={"lat": 1, "lon": 1, "accuracy": 5},
                                                      headers={"x-test-user": "anna"}, timeout=10))
    post.start()
    time.sleep(0.2)
    worst = 0.0
    for _ in range(5):
        t = time.perf_counter()
        assert httpx.get(f"{server}/ping").status_code == 200
        worst = max(worst, time.perf_counter() - t)
        time.sleep(0.15)
    post.join()
    th.join(timeout=5)
    stop.set()
    assert worst < 0.2, worst
    assert [o[1]["lat"] for o in out if o[0] == "position"] == [1]


# ── stream tokens (the real JWT secret) ───────────────────────────────────

@pytest.fixture(scope="module")
def main_mod():
    return importlib.import_module("main")


@pytest.fixture
def real_user(main_mod):
    from database import User, get_db
    uid = str(uuid.uuid4())
    with get_db() as s:
        s.add(User(id=uid, email=f"ps-{uid[:8]}@test.local", password_hash="x", name="PS", role="analyst", approved=True))
        s.commit()
    yield uid
    with get_db() as s:
        s.query(User).filter(User.id == uid).delete()
        s.commit()


def test_stream_token_opens_the_stream_and_expires(main_mod, real_user):
    tok = ps.make_token(real_user)
    assert ps.user_from_token(tok)["id"] == real_user
    old = ps.make_token(real_user, now=time.time() - ps.TOKEN_TTL_S - 5)
    assert ps.user_from_token(old) is None                  # expired
    assert ps.user_from_token(tok + "x") is None             # tampered


def test_a_session_token_is_not_a_stream_token_and_back(main_mod, real_user):
    session = main_mod._create_session_token(real_user)
    assert ps.user_from_token(session) is None               # never a session in a URL
    from starlette.requests import Request
    req = Request({"type": "http", "headers": [(b"authorization", f"Bearer {ps.make_token(real_user)}".encode())], "query_string": b""})
    assert main_mod._get_current_user(req) is None           # a stream token opens nothing else


def test_stream_token_endpoint_and_stream_over_the_real_app(main_mod, real_user):
    """Cross-site: the page holds a bearer, asks for a stream token, opens
    the stream with ?t= (EventSource cannot send headers)."""
    from fastapi.testclient import TestClient
    c = TestClient(main_mod.app)
    origin = {"Origin": "https://horizon-watch.vercel.app"}
    assert c.post("/api/positions/stream-token", headers=origin).status_code == 401
    bearer = {**origin, "Authorization": f"Bearer {main_mod._create_session_token(real_user)}"}
    r = c.post("/api/positions/stream-token", headers=bearer)
    assert r.status_code == 200 and r.json()["expires_in"] == ps.TOKEN_TTL_S
    assert r.headers.get("access-control-allow-origin") == "https://horizon-watch.vercel.app"
    assert ps.user_from_token(r.json()["token"])["id"] == real_user
    bad = c.get("/api/positions/stream?t=" + ps.make_token(real_user, now=time.time() - 3600))
    assert bad.status_code == 401
