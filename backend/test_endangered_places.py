"""endangered_places.py — parsing both public sources, the call labels,
status and colour derived on read, the alert plan (no flood, updated in
place), the per-user cards, and that no personal data is kept."""
import datetime as dt
import json

import pytest

import endangered_places as ep

UTC = dt.timezone.utc

# Small recordings of the real shapes (2026-10-11).
SITES = {"maj": "2026-09-15", "lieux": [
    [806103973, "raffinerie", 45.67386, 4.84738, "Raffinerie de Feyzin", "TotalEnergies (TotalEnergies Raffinage France)",
     "Feyzin", "69320", "69"],
    [806301207, "raffinerie", 47.31297, -2.0706, "Raffinerie de Donges", "TotalEnergies (TotalEnergies Raffinage France)",
     "Donges", "44480", "44"],
    [805600030, "depot", 46.13868, 3.45162, "Dépôt pétrolier de Cusset", "Établissements Lagarde Écoénergies",
     "Cusset", "03300", "03"],
    [600001034, "manif", 48.85, 2.35, "Préfecture", "", "Paris", "75001", "75"],              # nothing declared
    [700330000, "manif", 44.84146, -0.57049, "Place de la Bourse", "", "Bordeaux", "33000", "33", "14:00", 1],
    [700491000, "manif", 47.47115, -0.55172, "Place du Ralliement", "", "Angers", "49100", "49", "14:00", 0],
]}
LIEUX = {"lieux": [
    [500000004, "manif", 44.55759, 4.75128, "Rond point historique du KFC", "Jean Dupont 06 12 34 56 78",
     "Montélimar", "26200", "26", "10:00", 0, 0],
]}
STATIONS = {"source": "DGCCRF", "colonnes": ["id", "lat", "lon", "ville", "cp", "adresse", "dep", "gazole", "e10", "maj"],
            "stations": [[7400006, 44.61, 4.725, "MEYSSE", "07400", "2 AVENUE DE LA GARE", "07", 2.3, 2.1, "2026-09-15"],
                         [1000001, 46.201, 5.198, "BOURG", "01000", "AVENUE X", "01", 2.4, None, "2026-09-15"]]}
ACTIONS = {"stations_avec_action": 5, "total": 6, "actions": {
    "806103973": [["barrage_filtrant", "07:00"]],
    "805600030": [["tractage", "10:00"]],
    "7400006": [["barrage_filtrant", "07:00"], ["pancartes", "00:00"]],
    "500000004": [["rond_point", "10:00"]],
    "700491000": [["manifestation", "14:00"]],
    "99999999": [["rassemblement", "10:00"]],                        # not on any list
}}
FRAMA = {"layer-1": {"name": "Entreprise du complexe militaro-industriel", "features": [
    {"geometry": {"type": "Point", "coordinates": [5.4, 43.5]},
     "properties": {"NOM": "ACME DEFENSE", "ADRESSE": "1 RUE X, 13290 AIX-EN-PROVENCE", "TYPE": "TECHNOLOGIE",
                    "SECTEUR": "Logiciel", "DOMAINE": "défense"}},
    {"geometry": {"type": "Polygon", "coordinates": []}, "properties": {"NOM": "AREA"}},
]}, "layer-2": {"name": "Drones", "features": [
    {"geometry": {"type": "Point", "coordinates": [5.4, 43.5]}, "properties": {"Nom": "ACME DEFENSE", "Type": "TECHNOLOGIE"}},
]}}
RAW = {"sites": SITES, "lieux": LIEUX, "stations": STATIONS, "actions": ACTIONS, "framacarte": FRAMA}
DATE = "2026-10-17"
BEFORE = dt.datetime(2026, 10, 11, 14, 0, tzinfo=UTC)


def places():
    p, stats = ep.build(RAW, {}, DATE, BEFORE)
    return {x["id"]: x for x in p}, stats


def test_call_labels_and_levels():
    assert ep.call_type("barrage_filtrant") == ("Filtering roadblock", "high")
    assert ep.call_type("operation_escargot") == ("Slow-drive convoy", "high")
    assert ep.call_type("piquet_de_greve")[1] == "high"
    assert ep.call_type("rassemblement") == ("Gathering", "medium")
    assert ep.call_type("tractage") == ("Leafleting", "low")
    assert ep.call_type("pancartes")[1] == "low"
    assert ep.call_type("something_new") == ("Something new", "medium")
    # every type the site's carte.js offers is mapped
    for t in ("rassemblement", "tractage", "pancartes", "prise_de_parole", "barrage_filtrant", "operation_escargot",
              "manifestation", "piquet_de_greve", "rond_point", "autre"):
        assert t in ep.CALL_TYPES


def test_parse_17octobre():
    p, stats = places()
    assert p["gj:806103973"]["kind"] == "refinery"
    assert p["gj:806103973"]["operator"].startswith("TotalEnergies")
    assert p["gj:806103973"]["calls"][0]["label_en"] == "Filtering roadblock"
    assert p["gj:806103973"]["calls"][0]["time"] == "07:00"
    assert p["gj:806301207"]["calls"] == []                       # a refinery is listed even without a call
    assert p["gj:805600030"]["kind"] == "fuel_depot" and p["gj:805600030"]["level"] == "low"
    st = p["gj:7400006"]
    assert st["kind"] == "fuel_station" and st["city"] == "MEYSSE" and "2 AVENUE DE LA GARE" in st["name"]
    assert [c["time"] for c in st["calls"]] == ["07:00", None]   # 00:00 = time to be confirmed
    assert p["gj:500000004"]["kind"] == "roundabout"
    assert p["gj:700330000"]["calls"][0]["announced"] is True    # announced rendez-vous, no declaration
    assert p["gj:700491000"]["kind"] == "gathering"
    assert "gj:600001034" not in p                               # a prefecture with nothing declared
    assert "gj:1000001" not in p                                 # a station without a call is not listed
    assert stats["unplaced_calls"] == 1
    assert stats["by_call"]["barrage_filtrant"] == 2
    assert all(c["source_url"].startswith("https://17octobregiletjaune.net/carte/#lieu=") for x in p.values()
               for c in x["calls"])


def test_parse_framacarte_dedupes_and_whitelists():
    p, _ = places()
    fc = [x for x in p.values() if x["kind"] == "arms_company"]
    assert len(fc) == 1                                          # same name, same spot, two lists
    a = fc[0]
    assert a["lists"] == ["Entreprise du complexe militaro-industriel", "Drones"]
    assert a["city"] == "Aix-En-Provence" and a["postcode"] == "13290"
    assert a["calls"] == [] and "anti-militarist" in a["note"]


def test_no_personal_data_kept():
    p, _ = places()
    blob = json.dumps(list(p.values()), ensure_ascii=False)
    assert "Jean Dupont" not in blob and "06 12 34 56" not in blob      # a visitor's free text on a gathering
    for x in p.values():
        assert not ({"user", "uid", "appel", "signataires", "email", "description"} & set(x))
    # the Framacarte strip keeps only whitelisted fields
    layer = {"features": [{"geometry": {"type": "Point", "coordinates": [1, 2]},
                           "properties": {"NOM": "X", "user": "osm-editor", "uid": "123", "DESCRIPTION": "Mr Y"}}]}
    kept = ep._strip("framacarte", layer)["features"][0]["properties"]
    assert kept == {"NOM": "X"}
    # the petition endpoint is never a source
    assert not any("appel" in u for u in ep.GJ_URLS.values())


def test_status_and_alarm_derived_on_read():
    p, _ = places()
    ref, depot, listed = p["gj:806103973"], p["gj:805600030"], p["gj:806301207"]
    q = ep.annotate(ref, BEFORE)
    assert q["status"] == "upcoming" and q["alarm"] == "amber"       # 6 days out: not yet red
    q = ep.annotate(ref, dt.datetime(2026, 10, 16, 12, 0, tzinfo=UTC))
    assert q["alarm"] == "red"                                       # roadblock within 48 h
    q = ep.annotate(ref, dt.datetime(2026, 10, 17, 9, 0, tzinfo=UTC))
    assert q["status"] == "call active today" and q["alarm"] == "red"
    assert ep.annotate(depot, dt.datetime(2026, 10, 16, 12, 0, tzinfo=UTC))["alarm"] == "amber"   # leafleting
    assert ep.annotate(listed, BEFORE)["status"] == "listed (no call)"
    assert ep.annotate(listed, BEFORE)["alarm"] == "grey"
    q = ep.annotate(ref, dt.datetime(2026, 10, 18, 12, 0, tzinfo=UTC))
    assert q["status"] == "past" and q["alarm"] == "grey"
    assert ep.annotate(ref, BEFORE)["calls"][0]["line"] == \
        "Filtering roadblock called for Sat 17 Oct, 07:00 — source: 17octobregiletjaune.net"


def test_query_filters_and_bbox():
    pl, _ = ep.build(RAW, {}, DATE, BEFORE)
    data = {"built_at": "x", "action_date": DATE, "sources": [], "stats": {}, "places": pl}
    q = ep.query(data=data, now=BEFORE)
    assert q["counts"]["places"] == len(pl) and q["calls_within_7_days"] is True
    q = ep.query(bbox="45,4,46,5", data=data, now=BEFORE)
    assert {x["id"] for x in q["places"]} == {"gj:806103973"}
    q = ep.query(status="listed (no call)", data=data, now=BEFORE)
    assert all(x["status"] == "listed (no call)" for x in q["places"])
    q = ep.query(kind="refinery", data=data, now=BEFORE)
    assert {x["kind"] for x in q["places"]} == {"refinery"}
    assert ep.query(data=data, now=dt.datetime(2026, 10, 30, tzinfo=UTC))["calls_within_7_days"] is False


def test_alert_plan_no_flood_and_updated_in_place():
    pl, _ = ep.build(RAW, {}, DATE, BEFORE)
    plan = ep.plan_alerts(pl, DATE, {}, BEFORE)
    ids = [a["id"] for a in plan["new"]]
    # one summary, one per refinery/depot with a HIGH call (not the leafleting depot, not the station)
    assert ids == ["EPL-SUM-20261017", "EPL-806103973-20261017"]
    summ = plan["new"][0]
    assert summ["alert_type"] == ep.TYPE_SUMMARY and summ["severity"] == "high"
    assert summ["title"].startswith("Gilets jaunes call 7 actions at 6 places in France for Sat 17 Oct — 2 filtering roadblocks; "
                                  "2 at fuel stations, 2 at refineries and fuel depots")
    place = plan["new"][1]
    assert place["title"] == ("Gilets jaunes: Filtering roadblock called at Raffinerie de Feyzin "
                              "(refinery, TotalEnergies) — Sat 17 Oct, 07:00")
    assert "fuel supply" in place["reason"]
    sent = {a["id"]: a["_sig"] for a in plan["new"]}
    # nothing changed: nothing to write
    assert ep.plan_alerts(pl, DATE, sent, BEFORE) == {"new": [], "update": []}
    # one more call: the summary is UPDATED, not written again
    raw2 = json.loads(json.dumps(RAW))
    raw2["actions"]["actions"]["1000001"] = [["operation_escargot", "08:00"]]
    pl2, _ = ep.build(raw2, {}, DATE, BEFORE)
    plan2 = ep.plan_alerts(pl2, DATE, sent, BEFORE)
    assert plan2["new"] == [] and [a["id"] for a in plan2["update"]] == ["EPL-SUM-20261017"]
    assert "1 slow-drive convoy" in plan2["update"][0]["title"]
    # nothing after the day
    assert ep.plan_alerts(pl, DATE, {}, dt.datetime(2026, 10, 18, 8, 0, tzinfo=UTC)) == {"new": [], "update": []}
    # the writer never sees the internal signature
    assert "_sig" not in ep.for_writer(summ)


def test_morning_reminder_once_on_the_day():
    pl, _ = ep.build(RAW, {}, DATE, BEFORE)
    assert ep.day_alert(pl, DATE, BEFORE) is None
    morning = dt.datetime(2026, 10, 17, 5, 0, tzinfo=UTC)               # 07:00 Paris
    a = ep.day_alert(pl, DATE, morning)
    assert a["id"] == "EPL-DAY-20261017"
    assert a["title"].startswith("Today: gilets jaunes actions at 6 places in France — 2 filtering roadblocks from 07:00")
    assert "Feyzin" in a["title"]
    plan = ep.plan_alerts(pl, DATE, {"EPL-SUM-20261017": [7, 6], "EPL-806103973-20261017": ["806103973|barrage_filtrant|07:00|2026-10-17"]}, morning)
    assert [x["id"] for x in plan["new"]] == ["EPL-DAY-20261017"]
    assert ep.day_alert(pl, DATE, dt.datetime(2026, 10, 17, 14, 0, tzinfo=UTC)) is None    # 16:00 Paris


def test_notification_rules_pass_them():
    import event_watch as ew
    import general_feed as gf
    import notification_context as nc
    pl, _ = ep.build(RAW, {}, DATE, BEFORE)
    for a in ep.plan_alerts(pl, DATE, {}, BEFORE)["new"]:
        v = nc.notification_relevance({"alert_type": a["alert_type"], "severity": "high", "raw": ep.for_writer(a),
                                       "lat": a["lat"], "lon": a["lon"], "title": a["title"]})
        assert v["notify"] and v["sev"] == "high" and v["reason"] == a["reason"]
        kind = nc.notification_kind(a["alert_type"])
        assert kind == "signal"
        assert ew.interrupts({"sev": v["sev"], "kind": kind})
        assert nc.headline({"alert_type": a["alert_type"], "title": a["title"], "raw": ep.for_writer(a)}) == a["title"]
        assert gf.is_own_alert_type(a["alert_type"]) and gf.is_own_source(a["source"])
        assert not gf.is_news(a["source"], a["alert_type"])
    for t in ep.ALERT_TYPES:
        assert t in gf.EVENT_TYPES


def test_cards_for_assets_and_theaters():
    pl, _ = ep.build(RAW, {"806103973|barrage_filtrant|07:00|2026-10-17": "2026-10-11T13:00:00Z"}, DATE, BEFORE)
    data = {"places": pl}
    c = {"assets": [{"lat": 45.70, "lon": 4.85, "radius": 5.0, "name": "Lyon South depot", "label": "site"}],
         "theaters": [], "countries": set()}
    cards = ep.cards_for(c, BEFORE, data)
    assert len(cards) == 1
    k = cards[0]
    assert k["title"] == "Filtering roadblock called at Raffinerie de Feyzin — Sat 17 Oct, 07:00"
    assert k["reason"] == "3 km from your site Lyon South depot"
    assert k["kind"] == "announcement" and k["sev"] == "high" and k["created_at"] == "2026-10-11T13:00:00Z"
    # 40 km away: outside 25 km
    far = {"assets": [{"lat": 46.05, "lon": 4.85, "radius": 5.0, "name": "X", "label": "site"}], "theaters": []}
    assert ep.cards_for(far, BEFORE, data) == []
    # where you are
    me = {"assets": [{"lat": 44.62, "lon": 4.73, "radius": 30, "name": "where you are", "label": "", "me": True}], "theaters": []}
    titles = [x["reason"] for x in ep.cards_for(me, BEFORE, data)]
    assert "1 km from where you are" in titles
    # a theater over part of the country: one card with the count (twice the same theater: once)
    rhone = {"lat": 45.2, "lon": 4.8, "reach": 350.0, "name": "Rhône valley"}
    th = {"assets": [], "theaters": [rhone, {**rhone, "name": "Rhône again"}]}
    cards = ep.cards_for(th, BEFORE, data)
    assert len(cards) == 1 and cards[0]["id"] == "epl-th:Rhône valley:2026-10-17"
    assert cards[0]["title"].startswith("Gilets jaunes: 5 actions called at 4 places in your theater Rhône valley for Sat 17 Oct — 2 filtering roadblocks")
    # a theater over all of France is the national summary again: no card
    whole = {"assets": [], "theaters": [{"lat": 46.0, "lon": 2.5, "reach": 900.0, "name": "France"}]}
    assert ep.cards_for(whole, BEFORE, data) == []
    # after the day, nothing; more than a week before, nothing yet
    assert ep.cards_for(c, dt.datetime(2026, 10, 18, 12, tzinfo=UTC), data) == []
    assert ep.cards_for(c, dt.datetime(2026, 10, 9, 12, tzinfo=UTC), data) == []


def test_refresh_keeps_copy_when_site_goes_away(tmp_path, monkeypatch):
    monkeypatch.setattr(ep, "_dir", lambda: tmp_path)
    bodies = {ep.GJ_URLS["sites"]: SITES, ep.GJ_URLS["lieux"]: LIEUX, ep.GJ_URLS["stations"]: STATIONS,
              ep.GJ_URLS["actions"]: ACTIONS}

    def fake(url, cond=None, timeout=30, max_bytes=0):
        if url == ep.GJ_PAGE:
            return b"<title>Carte des mobilisations \xc2\xb7 17 octobre 2026 gilet jaune</title>", {}
        if url == ep.FC_MAP_URL:
            raise OSError("offline")
        if url not in bodies:
            raise OSError("404")
        return json.dumps(bodies[url]).encode(), {"etag": '"e1"'}
    monkeypatch.setattr(ep, "_fetch", fake)
    r = ep.refresh(BEFORE, force=True)
    assert r["places"] == 7 and r["calls"] == 7 and r["new_calls"] == 7
    assert any("framacarte" in e for e in r["errors"])
    # the site wiped: empty calls list, 404 on the rest — the copy stays
    bodies[ep.GJ_URLS["actions"]] = {"actions": {}}
    del bodies[ep.GJ_URLS["sites"]]
    r = ep.refresh(BEFORE + dt.timedelta(hours=1), force=True)
    assert r["calls"] == 7 and r["new_calls"] == 0
    assert any("empty" in e for e in r["errors"]) and any("sites" in e for e in r["errors"])
    d = json.loads((tmp_path / "places.json").read_text())
    assert d["action_date"] == "2026-10-17" and d["stats"]["calls"] == 7
    meta = json.loads((tmp_path / "meta.json").read_text())
    assert meta["http"]["lieux"]["etag"] == '"e1"'


def test_action_date_from_page():
    assert ep._action_date_from_page("<title>Carte des mobilisations · 17 octobre 2026 gilet jaune</title>") == "2026-10-17"
    assert ep._action_date_from_page("<title>nothing</title>") is None


@pytest.mark.parametrize("bad", [None, {}, {"lieux": []}])
def test_implausible_sites_rejected(bad):
    assert not ep._plausible("sites", bad)


# ── "Active only": called here, or a call within reach ───────────────────

def _pl(pid, lat, lon, kind="arms_company", calls=None, **kw):
    return {"id": pid, "source": "x", "kind": kind, "kind_label": kind, "name": pid, "lat": lat, "lon": lon,
            "calls": calls or [], **kw}


def _call(date="2026-10-17", time="14:00", kind="manifestation", level="medium"):
    return {"kind": kind, "label_en": "March / demonstration", "level": level, "date": date, "time": time,
            "source_url": "u", "key": f"{kind}|{date}|{time}"}


LYON = (45.7578, 4.8320)                                    # Place Bellecour


def _off(km_north=0.0, km_east=0.0, at=LYON):
    import math
    return (at[0] + km_north / 111.0, at[1] + km_east / (111.0 * math.cos(math.radians(at[0]))))


def test_nearby_calls_within_the_radius_only():
    rally = _pl("rally", *LYON, kind="gathering", calls=[_call()], name="Place Bellecour", city="Lyon")
    near = _pl("near", *_off(1.2))                           # 1.2 km north
    edge = _pl("edge", *_off(0, 1.95))                       # 1.95 km east
    far = _pl("far", *_off(2.6))                             # 2.6 km
    places = [ep.annotate(p, BEFORE) for p in (rally, near, edge, far)]
    out = ep.nearby_calls(places, 2.0, BEFORE)
    assert set(out) == {"near", "edge"}                       # the rally itself is not "near" itself
    n = out["near"][0]
    assert n["id"] == "rally" and abs(n["distance_km"] - 1.2) < 0.02
    assert n["line"].startswith("March / demonstration called for Sat 17 Oct, 14:00")
    assert set(ep.nearby_calls(places, 3.0, BEFORE)) == {"near", "edge", "far"}   # configurable


def test_nearby_ignores_past_calls_listed_places_and_approximate_points():
    past = _pl("past", *LYON, kind="gathering", calls=[_call(date="2026-10-01")])
    listed = _pl("listed", *_off(0.3))                       # no call: not a call point
    strike = _pl("strike", *_off(0.5), kind="strike", calls=[_call()])            # a province centroid
    approx = _pl("approx", *_off(0.6), kind="action", calls=[_call()], approx="approximate (centre of the city)")
    town = _pl("town", *_off(0.7), kind="gathering", calls=[_call()], name="Lyon", city="Lyon")   # just a town's name
    target = _pl("target", *_off(0.1))
    places = [ep.annotate(p, BEFORE) for p in (past, listed, strike, approx, town, target)]
    assert ep.nearby_calls(places, 2.0, BEFORE) == {}


def test_nearby_at_high_latitude():
    north = (69.65, 18.96)                                   # Tromsø: a degree of longitude is ~39 km
    a = _pl("a", *north, kind="gathering", calls=[_call()], name="Place Stortorget")
    b = _pl("b", *_off(0, 1.8, at=north))
    c = _pl("c", *_off(0, 2.3, at=north))
    out = ep.nearby_calls([ep.annotate(p, BEFORE) for p in (a, b, c)], 2.0, BEFORE)
    assert set(out) == {"b"}


def test_query_active_only():
    rally = _pl("rally", *LYON, kind="gathering", calls=[_call()], name="Place Bellecour")
    near = _pl("near", *_off(0.8))
    far = _pl("far", *_off(5))
    called = _pl("called", 48.85, 2.35, kind="fuel_depot", calls=[_call(kind="barrage_filtrant", level="high")])
    done = _pl("done", 43.3, 5.37, kind="gathering", calls=[_call(date="2026-10-01")])
    data = {"built_at": "x", "action_date": DATE, "sources": [], "stats": {}, "places": [rally, near, far, called, done]}
    q = ep.query(data=data, now=BEFORE, active=True)
    got = {p["id"]: p for p in q["places"]}
    assert set(got) == {"rally", "near", "called"}
    assert got["rally"]["active"] == "called" and got["called"]["active"] == "called"
    assert got["near"]["active"] == "nearby"
    assert got["near"]["nearby_calls"][0]["name"] == "Place Bellecour" and got["near"]["nearby_count"] == 1
    assert q["counts"]["active"] == 3 and q["counts"]["nearby"] == 1 and q["active_only"] is True
    assert q["nearby_km"] == ep.NEARBY_KM == 2.0
    # without the filter every place comes back; the near one still says why it is active
    allq = ep.query(data=data, now=BEFORE)
    assert len(allq["places"]) == 5
    assert next(p for p in allq["places"] if p["id"] == "near")["active"] == "nearby"
    assert "active" not in next(p for p in allq["places"] if p["id"] == "far")
    # a wider radius, clamped
    assert {p["id"] for p in ep.query(data=data, now=BEFORE, active=True, radius_km=10)["places"]} == \
        {"rally", "near", "far", "called"}
    assert ep.query(data=data, now=BEFORE, active=True, radius_km=10_000)["nearby_km"] == ep.NEARBY_MAX_KM
    # the country chips count the active places, even for kind=none
    cc = ep.query(data=data, now=BEFORE, kind="none")["countries"]
    assert cc[0]["active"] == 3 and cc[0]["places"] == 5


def test_every_place_gets_a_model_type():
    pl, _ = ep.build(RAW, {}, DATE, BEFORE)
    data = {"built_at": "x", "action_date": DATE, "sources": [], "stats": {}, "places": pl}
    q = ep.query(data=data, now=BEFORE)
    by_name = {p["name"]: p for p in q["places"]}
    assert by_name["Raffinerie de Feyzin"]["model_type"] == "refinery"
    assert by_name["Place de la Bourse"]["model_type"] == "town_square"
    assert by_name["Place de la Bourse"]["model_label"] == "Town or market square"
    assert all(p["model_type"] for p in q["places"])
