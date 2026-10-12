"""Linking a person to an asset, and the WARNING channel (owner, 2026-10-12).

  1. "link a user to an asset, and that automatically links the user's live
     location to that asset" — including someone outside the company;
  2. "send a WARNING signal … it must go above everything else" — delivered
     at once, acknowledged back to the sender, sent again while unseen;
  3. who sees whom: an outsider linked to my asset shows, strangers never.
"""
import datetime as dt
import os

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import asset_warnings as aw
import owned_assets as oa
import position_stream as ps
from routers import my_assets

USERS = {
    "owner": {"name": "Olivia", "team_id": None, "company": "Trifecta"},
    "col": {"name": "Colin", "team_id": None, "company": "trifecta"},
    "driver": {"name": "Dmitri", "team_id": None, "company": "Taxi Co"},     # outside the company
    "zed": {"name": "Zed", "team_id": None, "company": "Acme"},              # a stranger
    "root": {"name": "Root", "team_id": None, "company": None},
}


def _user(uid):
    u = USERS.get(uid)
    if not u:
        raise HTTPException(401, "authentication required")
    return {"id": uid, "email": f"{uid}@test.local", **u, **({"is_super_admin": True} if uid == "root" else {})}


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = os.path.join(tmp_path, "t.db")
    monkeypatch.setattr(oa, "_db_path", lambda: path)
    monkeypatch.setattr(oa, "_last_prune", 0.0)
    monkeypatch.setattr(oa, "MIN_INTERVAL_S", 0)
    monkeypatch.setattr(ps, "_users", lambda: USERS)
    monkeypatch.setattr(ps, "HUB", ps.Hub())
    monkeypatch.setattr(my_assets, "_directory", lambda: [{"id": k, "name": v["name"], "email": f"{k}@test.local",
                                                           "company": v["company"], "team_id": v["team_id"]} for k, v in USERS.items()])
    import asset_watch
    monkeypatch.setattr(asset_watch, "invalidate", lambda uid: None)
    return path


@pytest.fixture
def pushes(monkeypatch):
    sent = []
    monkeypatch.setattr(aw, "_default_push", lambda uid, title, body, data: sent.append((uid, title, body, data)) or [{"ok": True}])
    return sent


@pytest.fixture
def client(db, monkeypatch):
    me = lambda request: _user(request.headers.get("x-test-user") or "")    # noqa: E731
    monkeypatch.setattr(my_assets, "_me", me)
    monkeypatch.setattr(aw, "_me", me)
    app = FastAPI()
    app.include_router(my_assets.router)
    app.include_router(aw.router)
    return TestClient(app)


def H(uid):
    return {"x-test-user": uid}


def _van(owner="owner"):
    return oa.create(owner, {"name": "Van 1", "kind": "vehicle_car", "lat": 48.80, "lon": 2.30, "shared": True})


# ── 1. link / unlink ──────────────────────────────────────────────────────

def test_link_puts_the_asset_at_the_person_and_it_follows_them(client):
    van = _van()
    t0 = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=5)
    oa.record_position("driver", 48.85, 2.35, 8, "gps", now=t0)
    r = client.put(f"/api/my-assets/{van['id']}/link", json={"user_id": "driver"}, headers=H("owner"))
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["user"]["id"] == "driver" and v["user"]["name"] == "Dmitri" and v["live"] is True
    a = oa.get(van["id"], "owner")
    assert a["identifiers"]["user_id"] == "driver" and (a["lat"], a["lon"]) == (48.85, 2.35)
    assert a["updated_at"] == t0.isoformat()                     # the phone's time, not the click's
    # from now on, every position moves it (and its track)
    oa.record_position("driver", 48.86, 2.36, 8, "gps")
    a = oa.get(van["id"], "owner")
    assert (a["lat"], a["lon"]) == (48.86, 2.36)
    assert [p["lat"] for p in oa.track(van["id"])] == [48.85, 48.86]
    assert oa.position(a)["source"] == "their phone, live"
    # unlink: it stays where it was last seen, and no longer moves
    r = client.delete(f"/api/my-assets/{van['id']}/link", headers=H("owner"))
    assert r.status_code == 200 and r.json()["user"] is None
    oa.record_position("driver", 40.0, 3.0, 8, "gps")
    a = oa.get(van["id"], "owner")
    assert "user_id" not in a["identifiers"] and (a["lat"], a["lon"]) == (48.86, 2.36)


def test_only_the_owner_or_an_admin_links(client):
    van = _van()
    assert client.put(f"/api/my-assets/{van['id']}/link", json={"user_id": "driver"}, headers=H("zed")).status_code == 404
    assert client.put(f"/api/my-assets/{van['id']}/link", json={"user_id": "nobody"}, headers=H("owner")).status_code == 400
    assert client.put(f"/api/my-assets/{van['id']}/link", json={"user_id": "driver"}, headers=H("root")).status_code == 200


def test_a_live_phone_outranks_ais_for_a_linked_vessel(db):
    boat = oa.create("owner", {"name": "Tender", "kind": "vessel_tanker", "identifiers": {"mmsi": "123456789"}, "lat": 1, "lon": 1})
    oa.record_position("driver", 43.0, 5.0, 8, "gps")
    oa.link_user(boat["id"], "driver")
    a = oa.get(boat["id"], "owner")
    p = oa.position(a, live_vessel=lambda m: {"lat": 10.0, "lon": 10.0, "timestamp": 0})
    assert (p["lat"], p["lon"]) == (43.0, 5.0) and p["source"] == "their phone, live"


def test_linkable_users_puts_my_organisation_first_and_marks_outsiders(client):
    us = client.get("/api/my-assets/linkable-users", headers=H("owner")).json()["users"]
    aff = {u["id"]: u["affiliation"] for u in us}
    assert aff["owner"] == "you" and aff["col"] == "organisation" and aff["driver"] == "outside"
    assert [u["affiliation"] for u in us][:2] == ["you", "organisation"]
    assert [u["id"] for u in client.get("/api/my-assets/linkable-users?q=taxi", headers=H("owner")).json()["users"]] == ["driver"]


# ── 3. who sees whom, through a link ─────────────────────────────────────

def test_an_outsider_linked_to_my_asset_shows_and_a_stranger_never(client):
    van = _van()
    oa.record_position("driver", 48.85, 2.35, 8, "gps")
    oa.record_position("zed", 48.0, 2.0, 8, "gps")
    who = lambda u: {p["user_id"] for p in client.get("/api/my-assets/people", headers=H(u)).json()["people"]}  # noqa: E731
    assert who("owner") == set()                                   # neither is affiliated yet
    client.put(f"/api/my-assets/{van['id']}/link", json={"user_id": "driver"}, headers=H("owner"))
    assert who("owner") == {"driver"} and who("col") == {"driver"}  # my colleague too
    assert who("zed") == {"zed"}                                    # only themself
    assert who("root") == {"driver", "zed"}                         # an admin sees everyone
    assert client.get("/api/my-assets/people/driver/track", headers=H("owner")).status_code == 200
    assert client.get("/api/my-assets/people/driver/track", headers=H("zed")).status_code == 404


def test_the_live_stream_tells_the_asset_owner_about_an_outsider(db):
    import asyncio
    van = _van()
    oa.link_user(van["id"], "driver")

    async def run():
        subs = {u: ps.HUB.subscribe(_user(u)) for u in ("owner", "zed")}
        ps.publish_position(_user("driver"), 1.0, 2.0, 5, "gps", "t", [{"id": van["id"], "owner_id": "owner", "shared": False}])
        await asyncio.sleep(0)
        got = subs["owner"].queue.get_nowait()
        assert got["user_id"] == "driver" and got["assets"] == [{"id": van["id"]}]
        assert "linked_owners" not in got and "company" not in got
        assert subs["zed"].queue.empty()
    asyncio.run(run())


# ── 2. the warning ────────────────────────────────────────────────────────

def test_a_warning_is_pushed_at_once_as_the_top_kind_and_acknowledged_back(client, pushes):
    van = _van()
    oa.record_position("driver", 48.85, 2.35, 8, "gps")
    client.put(f"/api/my-assets/{van['id']}/link", json={"user_id": "driver"}, headers=H("owner"))
    r = client.post("/api/warnings", json={"asset_id": van["id"], "message": "Two cars following you since the bridge"}, headers=H("owner"))
    assert r.status_code == 200, r.text
    w = r.json()
    assert w["to_user"] == "driver" and w["status"] == "sent" and w["severity"] == "critical"
    uid, title, body, data = pushes[0]
    assert uid == "driver" and title == "WARNING" and "Olivia: Two cars following you" in body and "Van 1" in body
    assert data["kind"] == "warning" and data["warning_id"] == w["id"] and data["severity"] == "critical"
    # the sender's page: not yet seen
    sent = client.get(f"/api/warnings/sent?asset_id={van['id']}", headers=H("owner")).json()["warnings"]
    assert sent[0]["status"] == "sent"
    # the phone's poll: it is there, and now seen
    inbox = client.get("/api/warnings/inbox", headers=H("driver")).json()["warnings"]
    assert [x["id"] for x in inbox] == [w["id"]]
    assert client.get(f"/api/warnings/sent?asset_id={van['id']}", headers=H("owner")).json()["warnings"][0]["status"] == "seen"
    # only the person warned acknowledges
    assert client.post(f"/api/warnings/{w['id']}/ack", headers=H("col")).status_code == 404
    r = client.post(f"/api/warnings/{w['id']}/ack", headers=H("driver"))
    assert r.status_code == 200 and r.json()["status"] == "acknowledged" and r.json()["acked_at"]
    assert pushes[-1][0] == "owner" and pushes[-1][1] == "Warning acknowledged"
    assert client.get("/api/warnings/inbox", headers=H("driver")).json()["warnings"] == []
    got = client.get(f"/api/warnings/sent?asset_id={van['id']}", headers=H("col")).json()["warnings"][0]
    assert got["status"] == "acknowledged"                          # the whole desk sees it


def test_a_warning_needs_a_linked_person_and_never_reaches_a_stranger(client, pushes):
    van = _van()
    assert client.post("/api/warnings", json={"asset_id": van["id"], "message": "x"}, headers=H("owner")).status_code == 400
    assert client.post("/api/warnings", json={"to_user_id": "zed", "message": "x"}, headers=H("owner")).status_code == 404
    assert client.post("/api/warnings", json={"to_user_id": "col", "message": ""}, headers=H("owner")).status_code == 400
    assert client.post("/api/warnings", json={"to_user_id": "col", "message": "x", "severity": "meh"}, headers=H("owner")).status_code == 400
    assert client.post("/api/warnings", json={"to_user_id": "col", "message": "Leave the café"}, headers=H("owner")).status_code == 200
    assert [p[0] for p in pushes] == ["col"]


def test_unacknowledged_it_is_sent_again_then_stops(db, pushes, monkeypatch):
    monkeypatch.setattr(aw, "RESEND_S", 120)
    monkeypatch.setattr(aw, "MAX_SENDS", 3)
    t0 = dt.datetime.now(dt.timezone.utc)
    w = aw.send(_user("owner"), "Check your mirrors", to_user_id="col", now=t0)
    assert len(pushes) == 1
    assert aw.resend_due(now=t0 + dt.timedelta(seconds=60)) == 0          # not yet
    assert aw.resend_due(now=t0 + dt.timedelta(seconds=121)) == 1
    assert pushes[-1][1] == "WARNING (reminder 1)"
    assert aw.resend_due(now=t0 + dt.timedelta(seconds=150)) == 0          # counted from the last send
    assert aw.resend_due(now=t0 + dt.timedelta(seconds=250)) == 1
    assert aw.resend_due(now=t0 + dt.timedelta(seconds=500)) == 0          # MAX_SENDS reached
    assert aw.get(w["id"])["sends"] == 3
    w2 = aw.send(_user("owner"), "Second", to_user_id="col", now=t0)
    aw.ack(_user("col"), w2["id"], now=t0 + dt.timedelta(seconds=10))
    assert aw.resend_due(now=t0 + dt.timedelta(seconds=1000)) == 0          # acknowledged: never again


def test_the_stream_carries_the_warning_and_its_acknowledgement(db, pushes):
    import asyncio

    async def run():
        subs = {u: ps.HUB.subscribe(_user(u)) for u in ("owner", "col", "zed")}
        w = aw.send(_user("owner"), "Turn back", to_user_id="col")
        await asyncio.sleep(0)
        ev = subs["col"].queue.get_nowait()
        assert ev["event"] == "warning" and ev["warning"]["id"] == w["id"]
        assert subs["owner"].queue.empty() and subs["zed"].queue.empty()
        aw.ack(_user("col"), w["id"])
        await asyncio.sleep(0)
        ev = subs["owner"].queue.get_nowait()
        assert ev["event"] == "warning_update" and ev["warning"]["status"] == "acknowledged"
    asyncio.run(run())


def test_send_carries_a_route_for_what_comes_next(db, pushes):
    """The later "advise evacuation" uses this channel with its route."""
    w = aw.send(_user("owner"), "Go to the safe house", to_user_id="col", kind="evacuate",
                route={"route_plan_id": "RP-1", "safe_house": "Hotel Nord"})
    assert w["kind"] == "evacuate" and w["route"]["route_plan_id"] == "RP-1"
    assert pushes[0][1] == "EVACUATE" and pushes[0][3]["route_plan_id"] == "RP-1"
    assert aw.inbox(_user("col"))[0]["route"]["safe_house"] == "Hotel Nord"


def test_the_sender_can_withdraw_it(client, pushes):
    w = client.post("/api/warnings", json={"to_user_id": "col", "message": "Sent by mistake"}, headers=H("owner")).json()
    assert client.post(f"/api/warnings/{w['id']}/cancel", headers=H("zed")).status_code == 404
    assert client.post(f"/api/warnings/{w['id']}/cancel", headers=H("owner")).json()["status"] == "cancelled"
    assert client.get("/api/warnings/inbox", headers=H("col")).json()["warnings"] == []


def test_a_strangers_shared_live_asset_is_not_in_my_register(client, monkeypatch):
    oa.record_position("zed", 48.0, 2.0, 8, "gps")
    oa.create("zed", {"name": "Zed (live)", "kind": "person", "lat": 48.0, "lon": 2.0, "shared": True, "identifiers": {"user_id": "zed"}})
    monkeypatch.setattr(my_assets, "situation", lambda a: {"position": None, "exposure": "unknown", "signals": []})
    names = lambda u: [a["name"] for a in client.get("/api/my-assets", headers=H(u)).json()["assets"]]   # noqa: E731
    assert "Zed (live)" not in names("owner")
    assert "Zed (live)" in names("zed") and "Zed (live)" in names("root")
