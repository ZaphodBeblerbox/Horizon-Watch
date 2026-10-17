"""The map's "Demonstrations, live" layer (demonstrations.py): the planner's
own hazards the world over, and protester movement linked from located
Telegram reports into tracks. Fixture posts; no network, no model."""
import datetime as dt
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import demonstrations as dm
import safe_route as sr

NOW = dt.datetime(2026, 10, 17, 14, 0, tzinfo=dt.timezone.utc)      # 16:00 in Paris
REP = (48.8674, 2.3636)          # Place de la République
BAS = (48.8532, 2.3692)          # Place de la Bastille, ~1.6 km south
NAT = (48.8483, 2.3958)          # Place de la Nation, ~2 km east of Bastille
OPE = (48.8711, 2.3319)          # Opéra
LYON = (45.7578, 4.8320)         # Bellecour


def _at(minutes_ago: float) -> str:
    return (NOW - dt.timedelta(minutes=minutes_ago)).isoformat()


def rep(rid, ll, minutes_ago, place, text, country="fr"):
    return {"id": rid, "lat": ll[0], "lon": ll[1], "at": _at(minutes_ago), "place": place, "country": country,
            "text": text, "title": text[:60], "url": f"https://t.me/chan/{rid}", "source": "Telegram · chan"}


def paris_march():
    return [
        rep("r1", REP, 120, "Place de la République, Paris, France",
            "Le cortège part de la place de la République et se dirige vers Bastille"),
        rep("r2", BAS, 80, "Place de la Bastille, Paris, France", "Thousands of protesters have reached Place de la Bastille"),
        rep("r2b", BAS, 70, "Place de la Bastille, Paris, France", "Manifestants toujours à Bastille, tension avec les CRS"),
        rep("r3", NAT, 30, "Place de la Nation, Paris, France", "The march has left Bastille and is now at Place de la Nation"),
    ]


# ── words ───────────────────────────────────────────────────────────────────

def test_destinations_in_the_languages_the_ingest_reads():
    assert dm.destinations("Le cortège se dirige vers la Bastille, les CRS sont là") == ["bastille"]
    assert "nation" in dm.destinations("Les manifestants en direction de Nation")[0]
    assert dm.destinations("Protesters heading to Parliament Square after the speeches")[0].startswith("parliament square")
    assert dm.destinations("Crowd marching on the Interior Ministry")[0].startswith("interior ministry")
    assert dm.destinations("Der Demozug zieht in Richtung Alexanderplatz")[-1].startswith("alexanderplatz")
    assert dm.destinations("La marcha avanza hacia Plaza de Mayo")[0].startswith("plaza de mayo")
    assert dm.destinations("Police kettle protesters at Opéra") == []


def test_crowd_and_movement_words():
    assert dm.is_crowd("Le cortège avance boulevard Voltaire")
    assert dm.is_crowd("Thousands of protesters gathered")
    assert not dm.is_crowd("Air raid alert declared in Kyiv")
    assert dm.moves("Demonstrators moving towards the station")
    assert not dm.moves("Police kettle protesters at Opéra")


def test_city_of_a_place():
    assert dm.city_of("Boulevard Saint-Germain, Paris, France") == "paris"
    assert dm.city_of("Place de la République, Paris, Île-de-France, France") == "paris"
    assert dm.city_of("Paris, France") == "paris"


# ── linking ─────────────────────────────────────────────────────────────────

def test_a_march_is_linked_in_time_order_with_its_sources():
    tracks = dm.link_tracks(paris_march(), NOW, lambda cc: ZoneInfo("Europe/Paris"))
    assert len(tracks) == 1
    t = tracks[0]
    assert t["reconstructed"] and "reconstructed" in t["title"] and t["city"] == "Paris"
    assert [p["place"].split(",")[0] for p in t["points"]] == ["Place de la République", "Place de la Bastille", "Place de la Nation"]
    # the second Bastille report joined Bastille rather than starting a hop
    assert [s["id"] for s in t["points"][1]["sources"]] == ["r2", "r2b"]
    s0, s1 = t["segments"]
    assert "said it was heading to Place de la Bastille" in s0["why"]
    assert "the later report names Place de la Bastille" in s1["why"]
    assert {r["id"] for r in s0["sources"]} == {"r1", "r2", "r2b"}
    assert {r["id"] for r in s1["sources"]} == {"r2b", "r3"}
    assert all(r["url"] and r["published_at"] and r["title"] for r in s1["sources"])
    assert s0["age_min"] > s1["age_min"]                 # older segments fade
    assert t["last"]["label"] == "last reported 15:30"   # 30 min before 16:00 Paris time
    assert 90 < t["heading_deg"] < 130                   # Bastille → Nation is east-south-east
    assert t["n_reports"] == 4


def test_last_reported_is_utc_without_a_zone():
    t = dm.link_tracks(paris_march(), NOW)[0]
    assert t["last"]["label"] == "last reported 13:30 UTC"


def test_other_cities_too_late_and_too_far_are_not_linked():
    rs = paris_march() + [
        rep("lyon", LYON, 60, "Place Bellecour, Lyon, France", "Le cortège se dirige vers Bellecour"),
        # 3 h 10 after Nation: a new day's crowd, not this one
        rep("late", BAS, 30 - 190, "Place de la Bastille, Paris, France", "Marchers heading back to Bastille"),
    ]
    tracks = dm.link_tracks(rs, NOW + dt.timedelta(hours=4))
    assert len(tracks) == 1 and all(p["sources"][0]["id"] not in ("lyon", "late") for p in tracks[0]["points"])


def test_a_hop_faster_than_walking_is_not_the_same_crowd():
    rs = [rep("a", REP, 20, "Place de la République, Paris, France", "Le cortège se dirige vers La Défense"),
          rep("b", (48.8919, 2.2380), 15, "La Défense, Puteaux, France", "Protesters marching at La Défense")]
    assert dm.link_tracks(rs, NOW) == []              # ~10 km in 5 min


def test_no_evidence_no_link():
    rs = [rep("a", OPE, 50, "Opéra, Paris, France", "Police kettle protesters at Opéra"),
          rep("b", (48.8763, 2.3253), 20, "Gare Saint-Lazare, Paris, France", "Clashes between protesters and police at Gare Saint-Lazare")]
    assert dm.link_tracks(rs, NOW) == []


def test_link_score_rules():
    a = {**rep("a", REP, 60, "Place de la République, Paris, France", "cortège se dirige vers Bastille"), "city": "paris"}
    b = {**rep("b", BAS, 30, "Place de la Bastille, Paris, France", "rassemblement"), "city": "paris"}
    score, why = dm.link_score(a, b)
    assert score == 4 and len(why) == 2
    assert dm.link_score(b, a) is None                    # backwards in time
    assert dm.link_score(a, {**b, "country": "be"}) is None


# ── reads ───────────────────────────────────────────────────────────────────

def test_reads_located_crowd_posts_and_situations(tmp_path, monkeypatch):
    import telegram_events as te
    import telegram_ingest as tg
    monkeypatch.setattr(tg, "_db_path", lambda: str(tmp_path / "t.db"))
    con = te._con()
    cols = "(channel, msg_id, channel_title, posted_at, text, headline, summary_en, place, precision, country_code, lat, lon)"
    con.executemany(f"INSERT INTO telegram_posts {cols} VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [
        ("chan", 1, "Chan", _at(90), "Le cortège se dirige vers Bastille", "March leaves République", None,
         "Place de la République, Paris, France", "site", "fr", *REP),
        ("chan", 2, "Chan", _at(60), "Paris", "Protest in Paris", None, "Paris, France", "city", "fr", 48.85, 2.35),   # city pin
        ("chan", 3, "Chan", _at(50), "Air raid alert", "Air raid alert in Kyiv", None, "Podil, Kyiv, Ukraine", "district", "ua", 50.46, 30.51),
        ("chan", 4, "Chan", _at(30), "Nasse à Bastille", None, None, "Place de la Bastille, Paris, France", "site", "fr", *BAS),
    ])
    con.execute("INSERT INTO telegram_situations (channel, msg_id, idx, posted_at, valid_until, kind, happening, place,"
                " precision, lat, lon, country) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                ("chan", 4, 0, _at(30), _at(-150), "kettle", "Police kettle the crowd at Place de la Bastille",
                 "Place de la Bastille, Paris, France", "site", *BAS, "fr"))
    con.commit()
    con.close()
    rs = dm.read_reports(NOW)
    assert [r["id"] for r in rs] == ["tg-chan-1", "tg-chan-4"]          # the situation is the same post, same place
    t = dm.link_tracks(rs, NOW)
    assert len(t) == 1 and t[0]["segments"][0]["sources"][0]["url"] == "https://t.me/chan/1"


def test_current_is_the_planners_hazards_without_the_front(monkeypatch):
    calls = {}

    def fake(s, n, w, e, now=None, providers=None):
        calls["box"], calls["providers"] = (s, n, w, e), providers
        return [{"id": "k", "kind": "kettle"}, {"id": "a", "kind": "advance"}, {"id": "v", "kind": "verified"},
                {"id": "m", "kind": "march"}]
    monkeypatch.setattr(sr, "hazards_in_box", fake)
    assert [h["id"] for h in dm.current(NOW)] == ["k", "m"]
    assert calls["box"] == (-90, 90, -180, 180) and "unrest" in calls["providers"]


def test_hazards_in_box_reads_the_same_providers(monkeypatch):
    h = sr.make_hazard(hid="x", kind="kettle", lat=REP[0], lon=REP[1], weight=1, at=_at(5), place="République",
                       what="kettle", source="t")
    monkeypatch.setitem(sr.PROVIDERS, "fake", {"name": "fake", "label": "", "description": "",
                                               "fn": lambda box, inside, now: [h, dict(h), {**h, "id": "y", "lat": 10.0}]})
    got = sr.hazards_in_box(40, 60, -10, 20, NOW, ["fake"])
    assert [x["id"] for x in got] == ["x", "y"] and got[0]["provider"] == "fake"   # deduplicated per place and kind


def test_endpoint(monkeypatch):
    from routers import routes

    def me(request):
        if request.headers.get("x-test-user") != "anna":
            raise HTTPException(401, "authentication required")
        return {"id": "anna"}
    monkeypatch.setattr(routes, "_me", me)
    monkeypatch.setattr(dm, "current", lambda now=None: [{"id": "k", "kind": "kettle"}])
    monkeypatch.setattr(dm, "read_reports", lambda now=None, hours=dm.LOOKBACK_H: paris_march())
    dm._memo.clear()
    app = FastAPI()
    app.include_router(routes.router)
    c = TestClient(app)
    assert c.get("/api/routes/demonstrations").status_code == 401
    d = c.get("/api/routes/demonstrations", headers={"x-test-user": "anna"}).json()
    assert d["demonstrations"][0]["id"] == "k" and len(d["tracks"]) == 1
    assert d["linking"]["window_h"] == 3 and "Reconstructed" in d["note"]
    dm._memo.clear()


@pytest.fixture(autouse=True)
def _clear():
    dm._memo.clear()
    yield
    dm._memo.clear()
