"""Live location over HTTP: who may send it, what is kept, what moves.

The phone's position is the backbone of following people and the assets
they are with (owner, 2026-10-12). In production no phone position had ever
been stored: all 129 trail points of the owner's linked asset were the
desktop app's 5 km connection fix, and a locked database held POST /live
for 60 s on the event loop. These pin the fixed behaviour.
"""
import datetime as dt
import importlib
import os
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import owned_assets as oa
from routers import my_assets

T0 = dt.datetime(2026, 10, 12, 9, 0, tzinfo=dt.timezone.utc)


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = os.path.join(tmp_path, "t.db")
    monkeypatch.setattr(oa, "_db_path", lambda: path)
    monkeypatch.setattr(oa, "_last_prune", 0.0)
    return path


@pytest.fixture
def client(db, monkeypatch):
    """The router alone, signed in as whoever the X-Test-User header names
    (none: 401, as main._require_current_user answers)."""
    from fastapi import HTTPException

    def me(request):
        uid = request.headers.get("x-test-user")
        if not uid:
            raise HTTPException(401, "authentication required")
        return {"id": uid, "name": uid.title(), "email": f"{uid}@test.local"}
    monkeypatch.setattr(my_assets, "_me", me)
    app = FastAPI()
    app.include_router(my_assets.router)
    return TestClient(app)


def _post(c, user, **body):
    return c.post("/api/my-assets/live", json=body, headers={"x-test-user": user} if user else {})


# ── the store ─────────────────────────────────────────────────────────────

def test_positions_are_kept_per_user_as_a_history(db):
    for i in range(3):
        oa.record_position("anna", 48.85 + i * 0.01, 2.35, 12, "gps", now=T0 + dt.timedelta(minutes=2 * i))
    oa.record_position("ben", 50.0, 30.0, 20, "gps", now=T0)
    # read back with a window wide enough to include T0
    pts = [p for p in oa.positions("anna", hours=24 * 3650)]
    assert [round(p["lat"], 2) for p in pts] == [48.85, 48.86, 48.87]
    assert all(p["source"] == "gps" and p["at"] for p in pts)
    assert len(oa.positions("ben", hours=24 * 3650)) == 1


def test_rate_limited_per_user(db):
    oa.record_position("anna", 48.85, 2.35, 10, now=T0)
    with pytest.raises(oa.TooSoon) as e:
        oa.record_position("anna", 48.86, 2.35, 10, now=T0 + dt.timedelta(seconds=1))
    assert e.value.retry_after >= 1
    oa.record_position("ben", 1, 1, 10, now=T0 + dt.timedelta(seconds=1))      # someone else is not limited
    oa.record_position("anna", 48.86, 2.35, 10, now=T0 + dt.timedelta(seconds=oa.MIN_INTERVAL_S))


def test_a_connection_fix_never_overrides_a_fresh_phone_fix(db):
    """The desktop's 5 km IP fix every ten minutes used to move the person
    asset back to wherever the connection appears to be."""
    a = oa.create("boss", {"name": "Anna", "kind": "person", "lat": 0, "lon": 0, "identifiers": {"user_id": "anna"}})
    oa.record_position("anna", 48.8566, 2.3522, 8, "gps", now=T0)
    r = oa.record_position("anna", 47.3667, 8.5541, 5000, "ip", now=T0 + dt.timedelta(minutes=10))
    assert r["held"] and not r["stored"] and r["moved"] == []
    got = oa.get(a["id"], "boss")
    assert (got["lat"], got["lon"]) == (48.8566, 2.3522)
    # long after the phone fell silent, the connection is the best there is
    r = oa.record_position("anna", 47.3667, 8.5541, 5000, "ip", now=T0 + dt.timedelta(minutes=45))
    assert r["stored"] and [m["id"] for m in r["moved"]] == [a["id"]]


def test_the_same_city_level_place_is_not_a_new_trail_point(db):
    a = oa.create("boss", {"name": "Anna", "kind": "person", "lat": 0, "lon": 0, "identifiers": {"user_id": "anna"}})
    for i in range(5):
        oa.live_position("anna", 47.3667, 8.5541, 5000, "ip", now=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=10 * i))
    assert len(oa.track(a["id"], hours=48)) == 1


def test_position_says_what_kind_of_fix_it_is(db):
    a = oa.create("boss", {"name": "Anna", "kind": "person", "lat": 0, "lon": 0, "identifiers": {"user_id": "anna"}})
    oa.live_position("anna", 48.85, 2.35, 9, "gps")
    p = oa.position(oa.get(a["id"], "boss"))
    assert p["source"] == "their phone, live" and p["live"] and p["accuracy_m"] == 9
    oa.live_position("anna", 47.3, 8.5, 5000, "ip", now=dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1))
    # (the hold only spans PRECISE_HOLD_S; an hour later the coarse fix moves it)
    p = oa.position(oa.get(a["id"], "boss"))
    assert p["source"].startswith("their connection, city level")


def test_people_is_the_latest_position_of_each_sharer(db):
    now = dt.datetime.now(dt.timezone.utc)
    a = oa.create("boss", {"name": "Anna", "kind": "person", "lat": 0, "lon": 0, "identifiers": {"user_id": "anna"}})
    oa.record_position("anna", 48.85, 2.35, 10, now=now - dt.timedelta(minutes=30))
    oa.record_position("anna", 48.86, 2.36, 10, now=now - dt.timedelta(minutes=1))
    oa.record_position("ben", 50.0, 30.0, 10, now=now - dt.timedelta(hours=30))      # outside the window
    ppl = oa.people(hours=24, now=now)
    assert [p["user_id"] for p in ppl] == ["anna"]
    assert ppl[0]["lat"] == 48.86 and ppl[0]["live"] and ppl[0]["assets"] == [a["id"]]


# ── the endpoints ─────────────────────────────────────────────────────────

def test_live_needs_a_signed_in_user(client):
    assert _post(client, None, lat=48.85, lon=2.35).status_code == 401
    assert client.get("/api/my-assets/me/positions").status_code == 401
    assert client.get("/api/my-assets/people").status_code == 401


def test_live_moves_the_linked_asset_and_keeps_history(client, monkeypatch):
    r = _post(client, "anna", lat=48.85, lon=2.35, accuracy=8)
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["stored"] and first["linked"] == 1                # their own person asset, created
    aid = first["assets"][0]
    import time
    time.sleep(oa.MIN_INTERVAL_S)                                   # within the limit the server says 429
    r = _post(client, "anna", lat=48.86, lon=2.36, accuracy=8)
    assert r.status_code == 200 and r.json()["assets"] == [aid]
    h = client.get("/api/my-assets/me/positions", headers={"x-test-user": "anna"}).json()
    assert [p["lat"] for p in h["positions"]] == [48.85, 48.86] and h["latest"]["lat"] == 48.86
    t = client.get(f"/api/my-assets/{aid}/track", headers={"x-test-user": "anna"}).json()["track"]
    assert [p["lat"] for p in t] == [48.85, 48.86]
    a = oa.get(aid, "anna")
    assert (a["lat"], a["lon"]) == (48.86, 2.36)
    # ben, of anna's company, sees her; a stranger does not (position_stream.can_see)
    import position_stream as ps
    monkeypatch.setattr(ps, "_users", lambda: {"anna": {"name": "Anna", "company": "Red"}, "ben": {"name": "Ben", "company": "Red"},
                                               "zed": {"name": "Zed", "company": "Acme"}})
    monkeypatch.setattr(my_assets, "_me", lambda request: {"id": request.headers.get("x-test-user"),
                                                           "company": {"ben": "Red", "zed": "Acme"}.get(request.headers.get("x-test-user"))})
    ppl = client.get("/api/my-assets/people", headers={"x-test-user": "ben"}).json()["people"]
    assert ppl[0]["user_id"] == "anna" and ppl[0]["assets"] == [aid] and ppl[0]["name"] == "Anna"
    assert client.get("/api/my-assets/people", headers={"x-test-user": "zed"}).json()["people"] == []


def test_first_positions_at_once_make_one_asset(client, monkeypatch):
    """Two positions in flight together each found no linked asset and each
    created one (the 2026-10-12 browser run)."""
    import threading
    monkeypatch.setattr(oa, "MIN_INTERVAL_S", 0)
    real = oa.linked_to
    gate = threading.Barrier(2)

    def slow_linked(uid):
        try:
            gate.wait(timeout=0.5)       # both requests reach the check together
        except threading.BrokenBarrierError:
            pass
        return real(uid)
    monkeypatch.setattr(oa, "linked_to", slow_linked)
    out = []
    ts = [threading.Thread(target=lambda i=i: out.append(_post(client, "anna", lat=1 + i / 1000, lon=1, accuracy=5).status_code)) for i in range(2)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert out == [200, 200]
    assert len(real("anna")) == 1


def test_live_answers_429_with_retry_after(client):
    assert _post(client, "anna", lat=1, lon=1, accuracy=5).status_code == 200
    r = _post(client, "anna", lat=1.001, lon=1, accuracy=5)
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1


def test_live_rejects_a_bad_position(client):
    assert _post(client, "anna", lat=95, lon=0).status_code == 400
    assert _post(client, "anna", lon=0).status_code == 400
    assert _post(client, "anna", lat="x", lon=0).status_code == 400


def test_a_locked_database_answers_503_quickly(client, monkeypatch):
    import sqlite3

    def locked(*a, **k):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(oa, "record_position", locked)
    r = _post(client, "anna", lat=1, lon=1)
    assert r.status_code == 503 and r.headers.get("retry-after")


def test_live_is_not_run_on_the_event_loop():
    """It was async def doing SQLite with a 60 s busy timeout: one locked
    database stalled every request for a minute."""
    import inspect
    assert not inspect.iscoroutinefunction(my_assets.live)


# ── cross-site: the Vercel page on the Railway API carries a bearer ───────

@pytest.fixture
def real_user():
    main = importlib.import_module("main")
    from database import User, get_db
    from passlib.context import CryptContext
    pwd = CryptContext(schemes=["bcrypt"])
    uid, email, secret = str(uuid.uuid4()), f"loc-{uuid.uuid4().hex[:8]}@test.local", "hunter2-hunter2"
    with get_db() as s:
        s.add(User(id=uid, email=email, password_hash=pwd.hash(secret), name="Loc", role="analyst", approved=True))
        s.commit()
    yield main, {"id": uid, "email": email, "password": secret}
    with get_db() as s:
        s.query(User).filter(User.id == uid).delete()
        s.commit()


def test_cross_site_bearer_reaches_live(real_user, db):
    main, u = real_user
    c = TestClient(main.app)
    origin = {"Origin": "https://horizon-watch.vercel.app", "Host": "horizon-watch-production.up.railway.app"}
    r = c.post("/api/auth/login", json={"email": u["email"], "password": u["password"]}, headers=origin)
    token = r.json().get("session_token")
    assert token, "a cross-site page must be given the token to carry"
    fresh = TestClient(main.app)                                        # no cookie: Safari drops it cross-site
    body = {"lat": 48.85, "lon": 2.35, "accuracy": 10}
    assert fresh.post("/api/my-assets/live", json=body, headers=origin).status_code == 401
    r = fresh.post("/api/my-assets/live", json=body, headers={**origin, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert oa.positions(u["id"])[0]["lat"] == 48.85


def test_an_unmarked_coarse_fix_is_ip_and_never_overrides_the_phone(client, db):
    """The desktop app up to 1.1.18 sends its 5 km connection fix with no
    source: it was stored as gps and could override the phone's fix."""
    import time
    assert _post(client, "anna", lat=48.8566, lon=2.3522, accuracy=8, source="gps").status_code == 200
    time.sleep(oa.MIN_INTERVAL_S)
    r = _post(client, "anna", lat=47.3667, lon=8.5541, accuracy=5000)          # no source
    assert r.status_code == 200 and r.json()["held"] and r.json()["coarse"]
    assert oa.latest("anna")["source"] == "gps" and oa.latest("anna")["lat"] == 48.8566
    # alone (no fresh phone fix), it is kept — as ip, not gps
    assert _post(client, "ben", lat=47.3667, lon=8.5541, accuracy=5000).status_code == 200
    assert oa.latest("ben")["source"] == "ip"
    # the store infers it too
    r = oa.record_position("carl", 47.3667, 8.5541, 5000, None)
    assert oa.latest("carl")["source"] == "ip"
    # a precise unmarked fix is still gps
    oa.record_position("dora", 48.85, 2.35, 12, None)
    assert oa.latest("dora")["source"] == "gps"
