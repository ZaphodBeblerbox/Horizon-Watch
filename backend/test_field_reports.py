"""User reports (field_reports.py, routers/field_reports.py): parsing, validation and default expiry, who reads a
report (the Desk's rule), expired and ended reports hidden on read, author-only edit and end, delete by the author
or a superadmin, and the live-signals feed carrying reports to 'everyone' as source kind 'user'."""
import datetime as dt

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import field_reports as fr
from routers import desk
from routers import field_reports as api

ANA = {"id": "ana", "name": "Ana Lopez", "company": "Trifecta Technologies"}
BEN = {"id": "ben", "name": "Ben", "company": " trifecta  technologies"}      # same firm, typed differently
CEM = {"id": "cem", "name": "Cem", "company": "Acme Logistics"}
ROOT = {"id": "root", "name": "Root", "company": "Elsewhere", "is_super_admin": True}
USERS = {u["id"]: u for u in (ANA, BEN, CEM, ROOT)}
NOW = dt.datetime(2026, 10, 24, 12, 0, tzinfo=dt.timezone.utc)
PARIS = {"lat": 48.8674, "lon": 2.3636, "place": "Place de la République, Paris"}


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(fr, "_db_path", lambda: str(tmp_path / "akili.db"))
    yield


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api, "_me", lambda request: USERS[request.headers["x-user"]])
    monkeypatch.setattr(api, "_audience", lambda body, me: desk._audience_of(None, body, me))
    app = FastAPI()
    app.include_router(api.router)
    return TestClient(app)


def _post(c, who, **body):
    return c.post("/api/field-reports", json={"kind": "police", "title": "Police sighting", **PARIS, **body}, headers={"x-user": who})


def _ids(c, who):
    return sorted(r["title"] for r in c.get("/api/field-reports", headers={"x-user": who}).json()["reports"])


# ── parsing ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,kind", [
    ("police sighting at Place de la République", "police"), ("cops everywhere", "police"), ("CRS en place", "police"),
    ("des gendarmes rue de Rivoli", "police"), ("riot police lined up", "police"),
    ("big crowd at Bastille", "crowd"), ("protest march on the boulevard", "crowd"), ("manifestation devant la mairie", "crowd"),
    ("rassemblement place de la Nation", "crowd"),
    ("clashes with police", "clashes"), ("riot near the station", "clashes"), ("affrontements à Nanterre", "clashes"),
    ("barricade on the bridge", "roadblock"), ("road blocked by trucks", "roadblock"), ("checkpoint at the exit", "roadblock"),
    ("car on fire", "fire"), ("incendie d'un bus", "fire"), ("blaze in the warehouse", "fire"),
    ("loud blast heard", "explosion"), ("une explosion à la gare", "explosion"),
    ("shots fired near the market", "shots"), ("gunfire", "shots"), ("coups de feu entendus", "shots"),
    ("nice weather", None), ("", None),
])
def test_parse_kind(text, kind):
    assert fr.parse_kind(text) == kind


@pytest.mark.parametrize("text,hours", [
    ("expires in 12 h", 12), ("12h", 12), ("for 2 hours", 2), ("30 min", 0.5), ("1 day", 24),
    ("expires in 6 hours", 6), ("12 heures", 12), ("1h30", 1.5), ("an hour", 1), ("2 jours", 48), ("no time here", None),
])
def test_parse_expiry(text, hours):
    assert fr.parse_expiry(text) == hours


def test_default_expiry_by_kind_and_the_cap():
    for kind, h in fr.DEFAULT_EXPIRY_H.items():
        v = fr.validate({"kind": kind, **PARIS}, now=NOW)
        assert fr.parse_time(v["expires_at"]) - NOW == dt.timedelta(hours=h)
    v = fr.validate({"kind": "fire", "expires_in_h": 500, **PARIS}, now=NOW)
    assert fr.parse_time(v["expires_at"]) - NOW == dt.timedelta(hours=fr.MAX_EXPIRY_H)
    v = fr.validate({"kind": "crowd", "expires_in_h": 12, **PARIS}, now=NOW)
    assert fr.parse_time(v["expires_at"]) - NOW == dt.timedelta(hours=12)
    assert v["title"] == "Crowd at Place de la République, Paris" and v["occurred_at"] == fr.iso(NOW)


def test_validate_says_what_is_wrong():
    with pytest.raises(ValueError, match="kind"):
        fr.validate({"kind": "aliens", **PARIS}, now=NOW)
    with pytest.raises(ValueError, match="place"):
        fr.validate({"kind": "police"}, now=NOW)
    with pytest.raises(ValueError, match="happened"):
        fr.validate({"kind": "police", "occurred_at": fr.iso(NOW + dt.timedelta(hours=1)), **PARIS}, now=NOW)
    with pytest.raises(ValueError, match="at least"):
        fr.validate({"kind": "police", "expires_at": fr.iso(NOW), **PARIS}, now=NOW)
    with pytest.raises(ValueError, match="audience"):
        fr.validate({"kind": "police", "audience": "the world", **PARIS}, now=NOW)
    with pytest.raises(ValueError, match="media"):
        fr.validate({"kind": "police", "media": [{"url": "javascript:alert(1)", "type": "image"}], **PARIS}, now=NOW)
    # the kind read from the words when not given
    assert fr.validate({"title": "Cops at the station", **PARIS}, now=NOW)["kind"] == "police"


# ── the API ─────────────────────────────────────────────────────────────────

def test_create_returns_the_report(client):
    r = _post(client, "ana", note="a dozen vans", media=[{"url": "https://example.org/a.jpg", "type": "image"}])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kind"] == "police" and d["mine"] and d["audience"] == "company"
    assert d["author"] == {"id": "ana", "name": "Ana Lopez"}
    assert d["label"] == "Reported by Ana Lopez, unverified"
    assert d["media"] == [{"type": "image", "url": "https://example.org/a.jpg"}]
    assert set(d) >= {"id", "kind", "title", "note", "place", "lat", "lon", "occurred_at", "expires_at", "ended_at",
                      "author", "audience", "media", "mine", "label"}
    assert _post(client, "ana", kind="spaceship").status_code == 400


def test_scope_company_everyone_and_another_company(client):
    _post(client, "ana", title="company one")
    _post(client, "ana", title="for everyone", audience="everyone")
    assert _ids(client, "ana") == ["company one", "for everyone"]
    assert _ids(client, "ben") == ["company one", "for everyone"]          # same firm
    assert _ids(client, "cem") == ["for everyone"]                         # another company
    other = client.get("/api/field-reports", headers={"x-user": "ana"}).json()["reports"]
    hidden = next(r for r in other if r["title"] == "company one")["id"]
    assert client.get(f"/api/field-reports/{hidden}", headers={"x-user": "cem"}).status_code == 404


def test_expired_and_ended_reports_are_hidden(client, monkeypatch):
    a = _post(client, "ana", title="short", expires_in_h=1).json()
    b = _post(client, "ana", title="ended").json()
    assert client.post(f"/api/field-reports/{b['id']}/end", headers={"x-user": "ana"}).json()["ended_at"]
    assert _ids(client, "ana") == ["short"]
    later = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=2)
    monkeypatch.setattr(fr, "_utcnow", lambda: later)
    assert _ids(client, "ana") == []
    assert client.get(f"/api/field-reports/{a['id']}", headers={"x-user": "ana"}).json()["active"] is False


def test_only_the_author_edits_and_ends(client):
    d = _post(client, "ana").json()
    r = client.patch(f"/api/field-reports/{d['id']}", json={"title": "Two vans", "note": "moving east", "expires_in_h": 5},
                     headers={"x-user": "ben"})
    assert r.status_code == 403
    r = client.patch(f"/api/field-reports/{d['id']}", json={"title": "Two vans", "note": "moving east", "expires_in_h": 5},
                     headers={"x-user": "ana"})
    assert r.status_code == 200 and r.json()["title"] == "Two vans" and r.json()["note"] == "moving east"
    assert client.post(f"/api/field-reports/{d['id']}/end", headers={"x-user": "ben"}).status_code == 403
    assert client.post(f"/api/field-reports/{d['id']}/end", headers={"x-user": "ana"}).status_code == 200


def test_delete_by_the_author_or_a_superadmin(client):
    a = _post(client, "ana", title="a", audience="everyone").json()
    b = _post(client, "ana", title="b", audience="everyone").json()
    assert client.delete(f"/api/field-reports/{a['id']}", headers={"x-user": "cem"}).status_code == 403
    assert client.delete(f"/api/field-reports/{a['id']}", headers={"x-user": "ana"}).status_code == 200
    assert client.delete(f"/api/field-reports/{b['id']}", headers={"x-user": "root"}).status_code == 200
    assert _ids(client, "ana") == []


# ── feeds ───────────────────────────────────────────────────────────────────

def test_live_signals_carry_reports_to_everyone_as_user(client):
    _post(client, "ana", title="Police at République", audience="everyone")
    _post(client, "ana", title="company only")
    sigs = fr.add_to_signals([])
    assert [s["title"] for s in sigs] == ["Police at République"]          # the shared feed: 'everyone' only
    s = sigs[0]
    assert s["source_kind"] == "user" and s["act"] == "police_intervention" and s["kind"] == "live_signal"
    assert s["corroboration"]["line"] == "Reported by Ana Lopez, unverified"
    assert s["corroboration"]["independent"] is False and s["corroboration"]["level"] == "unverified"
    assert s["refs"][0].startswith("user:")


def test_live_signals_signals_include_them(client, monkeypatch, tmp_path):
    import sqlite3
    import live_signals as ls
    _post(client, "ana", title="Crowd at Nation", kind="crowd", audience="everyone")
    tg = tmp_path / "tg.db"
    sqlite3.connect(tg).close()
    ls._SIGNALS.clear()
    got = ls.signals(str(tg))
    mine = [s for s in got if s.get("source_kind") == "user"]
    assert mine and mine[0]["act"] == "crowd_movement" and mine[0]["label"].startswith("Reported by Ana Lopez")


def test_reports_join_an_event_without_counting_as_a_source():
    import sqlite3
    import events
    con = sqlite3.connect(":memory:")
    events.ensure_tables(con)
    t = NOW - dt.timedelta(minutes=5)
    eid = events.assign_member(con, {"kind": "live_signal", "ref": "tg:x:1", "act": "police_intervention", "event_time": fr.iso(t),
                                     "lat": 48.8674, "lon": 2.3636, "precision": "site", "channel": "x", "text": "police"}, NOW)
    out = events.reconcile(con, NOW, atoms=[], situations=[], others=[], concerns=[], watch={}, attention_rows=[],
                           brief_fn=lambda *a, **k: None,
                           user_reports=[{"ref": "user:fr_1", "act": "police_intervention", "lat": 48.8675, "lon": 2.3637,
                                          "at": fr.iso(NOW), "label": "Police (Reported by Ana, unverified)"}])
    assert out["joined_other"] == 1
    kinds = {r[0]: r[1] for r in con.execute("SELECT ref, kind FROM event_members WHERE event_id=?", (eid,))}
    assert kinds["user:fr_1"] == "user"
    members = events._q(con, "SELECT * FROM event_members WHERE event_id=?", (eid,))
    assert events.corroboration(members)["n_independent"] == 1                 # a user report is not an independent source


def test_protest_items_for_the_user(client, monkeypatch):
    monkeypatch.setattr(desk, "desk_identity", lambda me, db=None: me)
    _post(client, "ana", title="Police at République")
    _post(client, "ana", title="Fire", kind="fire")
    items = fr.protest_items(BEN)
    assert [i["title"] for i in items] == ["Police at République"]
    assert items[0]["kind"] == "police" and items[0]["source_kind"] == "user" and items[0]["line"].startswith("Reported by")
    assert fr.protest_items(CEM) == []
