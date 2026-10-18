"""A city's demonstration situation (demo_situation.py): fallback extraction
of calls and self-reported positions (French, English), the adapter for the
ingestion's structured intent, convergence scoring, route junctions, and the
whole pipeline over fixture posts with routing stubbed. No network, no model."""
import asyncio
import datetime as dt
from zoneinfo import ZoneInfo

import pytest

import demo_situation as ds
import demonstrations as dm

NOW = dt.datetime(2026, 10, 17, 14, 0, tzinfo=dt.timezone.utc)      # 16:00 in Paris
PARIS = ZoneInfo("Europe/Paris")
ELY = (48.8704, 2.3167)
CON = (48.8656, 2.3212)
REP = (48.8674, 2.3636)
BAS = (48.8532, 2.3692)


def _at(m):
    return (NOW - dt.timedelta(minutes=m)).isoformat()


# ── fallback extraction ─────────────────────────────────────────────────────

@pytest.mark.parametrize("text,target,act,when", [
    ("Tous à l'Élysée maintenant !", "Palais de l'Élysée", "gather", "now"),
    ("Rendez-vous place de la Concorde à 16h", "Place de la Concorde", "gather", "2026-10-17T14:00:00Z"),
    ("On va prendre Beauvau", "Place Beauvau (ministère de l'Intérieur)", "attack", None),
    ("Bloquons la gare de Lyon à 18h30", "Gare de Lyon", "block", "2026-10-17T16:30:00Z"),
    ("Everyone to the Elysee palace now", "Palais de l'Élysée", "gather", "now"),
    ("Meet at Concorde at 17:00", "Place de la Concorde", "gather", "2026-10-17T15:00:00Z"),
    ("RDV à République 18h", "Place de la République", "gather", "2026-10-17T16:00:00Z"),
    ("Protesters: storm the Elysee!", "Palais de l'Élysée", "attack", None),
])
def test_calls_fr_en(text, target, act, when):
    out = ds.extract_intents(text, _at(60), PARIS, "paris")
    assert [(i["target"], i["act"], i["when"]) for i in out] == [(target, act, when)]
    assert out[0]["place"]["lat"] and out[0]["how"] == "keywords"


@pytest.mark.parametrize("text", ["tous les jours on lutte", "Vive la République !", "take care everyone", "on va voir"])
def test_a_cue_without_a_place_is_no_call(text):
    assert ds.extract_intents(text, _at(5), PARIS, "paris") == []


def test_no_catastrophic_backtracking():
    """The first version's optional-space lead words ("(a|la|de)\\s*)*") hung on
    a real 72 h read: every split of "aaaa…" was tried. Long, cue-dense text
    must stay fast."""
    import time
    text = ("tous a la de du devant sur vers les l'" * 200) + " a" * 3000 + " on est au la de " * 300
    t0 = time.monotonic()
    ds.extract_intents(text, _at(1), PARIS, "paris")
    ds.extract_positions(text + " manifestants devant la la la la " * 200, "paris")
    ds.resolve_place("a " * 2000 + "concorde")
    assert time.monotonic() - t0 < 1.0


def test_war_news_verbs_are_not_calls():
    """Read as calls on the 72 h real-data run before the rule."""
    lp = ds.learned_place("p:obolon", "Obolon district, Kyiv, Ukraine", 50.50, 30.50)
    assert ds.extract_intents("Woman killed in enemy attack in Obolon district", _at(5), None, "kyiv", learned=[lp]) == []
    assert ds.extract_intents("Tu-95MS groups take off from Engels-2", _at(5), None, None) == []
    assert ds.extract_intents("Storm warning: take the Concorde exit", _at(5), PARIS, "paris") == []


def test_named_days():
    out = ds.extract_intents("Rendez-vous le 8 octobre à 14h30 place de la Bastille", _at(60), PARIS, "paris")
    assert out[0]["start_at"] == "2026-10-08T12:30:00Z"
    out = ds.extract_intents("Meet at Concorde on October 20", _at(60), PARIS, "paris")
    assert out[0]["when"] == "2026-10-20"
    assert ds.immediacy({"start_at": out[0]["start_at"], "at": _at(60)}, NOW) == 0.25


def test_tomorrow_is_tomorrow():
    out = ds.extract_intents("Rassemblement demain 15h place de la Bastille", _at(60), PARIS, "paris")
    assert out[0]["start_at"] == "2026-10-18T13:00:00Z"


@pytest.mark.parametrize("text,place,kind", [
    ("On est devant l'Élysée, ça chauffe", "Palais de l'Élysée", "at"),
    ("Nous sommes place de la Concorde", "Place de la Concorde", "at"),
    ("Les manifestants sont place de la Concorde", "Place de la Concorde", "at"),
    ("We're at Concorde, police everywhere", "Place de la Concorde", "at"),
    ("Foule immense devant l'Élysée", "Palais de l'Élysée", "mentioned"),
    ("Thousands of protesters outside the Elysee", "Palais de l'Élysée", "mentioned"),
])
def test_positions_fr_en(text, place, kind):
    out = ds.extract_positions(text, "paris")
    assert [(p["place"]["name"], p["kind"]) for p in out] == [(place, kind)]


def test_where_people_are_called_to_is_not_where_they_are():
    t = "Tous devant l'Élysée à 18h"
    calls = ds.extract_intents(t, _at(5), PARIS, "paris")
    assert ds.extract_positions(t, "paris", exclude={c["place"]["id"] for c in calls}) == []


def test_ambiguous_names_only_after_a_cue():
    assert ds.resolve_place("Vive la République") is None
    assert ds.resolve_place("à République", strict_ok=True)["name"] == "Place de la République"


def test_learned_places_resolve():
    lp = ds.learned_place("p:x", "Rue de Rivoli, Paris, France", 48.8590, 2.3470)
    assert ds.resolve_place("le cortège est rue de Rivoli", "paris", learned=[lp])["name"] == "Rue de Rivoli"


# ── structured intent adapter ───────────────────────────────────────────────

def test_structured_intent_shapes():
    row = {"posted_at": _at(10), "intent": '{"act": "attack", "target": "Palais de l\'Élysée", "when": "now", "confidence": 0.9}'}
    out = ds.structured_intents(row, None, PARIS, "paris")
    assert out[0]["act"] == "attack" and out[0]["place"]["name"] == "Palais de l'Élysée"
    assert out[0]["when"] == "now" and out[0]["confidence"] == 0.9 and out[0]["how"] == "model"
    # a list, target as an object with coordinates, a clock time on the post's day
    row = {"posted_at": _at(10), "intents_json": [{"act": "gather", "target": {"name": "Somewhere new", "lat": 48.85, "lon": 2.30},
                                                  "when": "17:30"}]}
    out = ds.structured_intents(row, None, PARIS, "paris")
    assert out[0]["place"]["lat"] == 48.85 and out[0]["start_at"] == "2026-10-17T15:30:00Z" and out[0]["confidence"] == 0.7
    # coordinates next to a known place: the known place
    row = {"intent": {"act": "march", "target": "Concorde", "target_lat": 48.8657, "target_lon": 2.3213}}
    assert ds.structured_intents(row, _at(1), PARIS)[0]["place"]["name"] == "Place de la Concorde"


def test_structured_intent_tolerates_junk():
    for v in (None, "", "not json", "[1, 2]", '{"act": "gather"}', '{"target": "nowhere at all"}'):
        assert ds.structured_intents({"intent": v}, _at(1), PARIS, "paris") == []
    assert ds.structured_positions({"positions": "{"}, _at(1)) == []


def test_structured_positions():
    row = {"posted_at": _at(20), "positions_json": '[{"kind": "at", "place": "Place de la Concorde", "at_time": "now"},'
                                                    ' {"kind": "at", "place": "x", "lat": 48.86, "lon": 2.33, "at_time": "%s"}]' % _at(5)}
    out = ds.structured_positions(row, None, "paris")
    assert out[0]["place"]["name"] == "Place de la Concorde" and out[0]["at"] == dm._utc(_at(20)).isoformat()
    assert out[1]["place"]["lat"] == 48.86 and out[1]["at"] == _at(5)
    # an intent of kind "at" is a position
    assert ds.structured_positions({"intent": {"kind": "at", "target": "Bastille"}}, _at(1), "paris")[0]["place"]["name"] == "Place de la Bastille"


# ── scoring ─────────────────────────────────────────────────────────────────

def _call(cid, ll, m, ch="c1", when="now", kind="call", start=None):
    return {"id": cid, "kind": kind, "act": "gather", "place": {"id": f"g:{ll}", "name": str(ll), "lat": ll[0], "lon": ll[1]},
            "at": _at(m), "when": when, "start_at": start, "confidence": 0.6, "channel": ch}


def _crowd(cid, ll, m, place="somewhere", heading=None):
    return {"id": cid, "lat": ll[0], "lon": ll[1], "at": _at(m), "place": place, "hhmm": "15:50", "n_reports": 2,
            "heading_to": heading}


def test_called_and_reachable_ranks_first():
    ely = {"id": "tgt-e", "place_id": "e", "name": "Élysée", "lat": ELY[0], "lon": ELY[1],
           "calls": [_call(f"e{i}", ELY, 20 + i * 10, ch=f"c{i % 4}") for i in range(6)]}
    bas = {"id": "tgt-b", "place_id": "b", "name": "Bastille", "lat": BAS[0], "lon": BAS[1], "calls": [_call("b1", BAS, 30)]}
    crowds = [_crowd("g1", CON, 10, "Place de la Concorde, Paris"), _crowd("g2", REP, 20), _crowd("g3", (48.8700, 2.3245), 5)]
    etas = {("g1", "tgt-e"): {"min": 8, "m": 700, "routed": True}, ("g2", "tgt-e"): {"min": 40, "m": 3300, "routed": True},
            ("g3", "tgt-e"): {"min": 9, "m": 800, "routed": True},
            ("g1", "tgt-b"): {"min": 75, "m": 5000, "routed": True}, ("g2", "tgt-b"): {"min": 28, "m": 1900, "routed": True},
            ("g3", "tgt-b"): {"min": 70, "m": 4800, "routed": True}}
    out = ds.score_targets([bas, ely], crowds, etas, NOW)
    assert [t["name"] for t in out] == ["Élysée", "Bastille"]
    e = out[0]
    assert 0.5 < e["score"] <= ds.SCORE_CAP and e["groups_within"] == 3
    assert "named in 6 calls in the last 70 min (4 channels)" in e["explanation"]
    assert "3 groups within 40 min walk" in e["explanation"] and "last seen at" in e["explanation"]


def test_one_spammy_channel_is_capped():
    t = lambda calls: {"id": "t", "place_id": "t", "name": "X", "lat": ELY[0], "lon": ELY[1], "calls": calls}  # noqa: E731
    one = ds.score_targets([t([_call(f"a{i}", ELY, 5, ch="spam") for i in range(20)])], [], {}, NOW)[0]
    many = ds.score_targets([t([_call(f"a{i}", ELY, 5, ch=f"c{i}") for i in range(5)])], [], {}, NOW)[0]
    assert one["C"] == ds.CHANNEL_CAP and many["score"] > one["score"]


def test_immediacy_and_recency():
    assert ds.immediacy({"when": "now", "at": _at(10)}, NOW) == 1.0
    assert ds.immediacy({"start_at": (NOW + dt.timedelta(minutes=30)).isoformat(), "at": _at(10)}, NOW) == 1.0
    assert ds.immediacy({"start_at": (NOW + dt.timedelta(hours=2)).isoformat(), "at": _at(10)}, NOW) == 0.6
    assert ds.immediacy({"start_at": (NOW + dt.timedelta(hours=20)).isoformat(), "at": _at(10)}, NOW) == 0.25
    assert ds.call_weight(_call("a", ELY, 5), NOW) > ds.call_weight(_call("b", ELY, 200), NOW)


def test_a_crowd_heading_there_and_a_crowd_there():
    ely = {"id": "tgt-e", "place_id": "e", "name": "Élysée", "lat": ELY[0], "lon": ELY[1], "calls": []}
    h = ds.score_targets([ely], [_crowd("g", CON, 5, heading={"id": "e"})], {("g", "tgt-e"): {"min": 10, "m": 800, "routed": True}}, NOW)[0]
    n = ds.score_targets([ely], [_crowd("g", CON, 5)], {("g", "tgt-e"): {"min": 10, "m": 800, "routed": True}}, NOW)[0]
    assert h["score"] > n["score"] and "heading there" in h["explanation"]
    there = ds.score_targets([ely], [_crowd("g", (48.8705, 2.3168), 5)], {}, NOW)[0]
    assert there["reach"][0]["there"] and "already there" in there["explanation"]


def test_far_or_stale_crowds_do_not_count():
    ely = {"id": "tgt-e", "place_id": "e", "name": "Élysée", "lat": ELY[0], "lon": ELY[1], "calls": []}
    out = ds.score_targets([ely], [_crowd("far", (48.80, 2.45), 5), _crowd("old", CON, 400)], {}, NOW)[0]
    assert out["reach"] == [] and out["score"] == 0


def test_estimate_without_routing():
    e = ds.estimate_eta({"lat": CON[0], "lon": CON[1]}, {"lat": ELY[0], "lon": ELY[1]})
    assert not e["routed"] and 8 < e["min"] < 15


def test_route_junction():
    # A: west→east along lat 48.86, then north; B joins A's line from the south half-way
    a = [[48.86, 2.30 + i * 0.001] for i in range(21)] + [[48.86 + i * 0.001, 2.32] for i in range(1, 6)]
    b = [[48.85 + i * 0.001, 2.31] for i in range(10)] + [[48.86, 2.31 + i * 0.001] for i in range(11)] + a[21:]
    ia, ib = ds.route_junction(a, b)
    assert a[ia] == pytest.approx([48.86, 2.31])
    top = {"id": "t", "name": "Target", "lat": a[-1][0], "lon": a[-1][1], "score": 0.8}
    js = ds.junctions(top, [{"crowd_id": "A", "coords": a, "eta_min": 30}, {"crowd_id": "B", "coords": b, "eta_min": 30}], [])
    assert len(js) == 1 and js[0]["kind"] == "junction" and js[0]["score"] == 0.48
    assert ds.route_junction([[0, 0], [0, 0.01]], [[1, 1], [1, 1.01]]) is None


# ── the pipeline, fixture posts, routing stubbed ────────────────────────────

def post(mid, minutes_ago, text, place=None, ll=(None, None), precision=None, **kw):
    return {"channel": "chan", "msg_id": mid, "channel_title": "Chan", "posted_at": _at(minutes_ago), "text": text,
            "headline": None, "summary_en": None, "place": place, "precision": precision, "country_code": "fr",
            "lat": ll[0], "lon": ll[1], **kw}


def paris_posts():
    return [
        post(1, 100, "Tous à l'Élysée maintenant !", "Paris, France", (48.8566, 2.3522), "city"),
        post(2, 80, "Rendez-vous devant l'Élysée, on y va", "Paris, France", (48.8566, 2.3522), "city"),
        post(3, 40, "Everyone to the Elysee now", "Paris, France", (48.8566, 2.3522), "city"),
        post(4, 15, "On est place de la Concorde, des milliers de manifestants", "Paris, France", (48.8566, 2.3522), "city"),
        post(5, 10, "Foule immense devant l'Élysée", "Paris, France", (48.8566, 2.3522), "city"),
        post(6, 30, "Le cortège part de République et se dirige vers l'Élysée", "Place de la République, Paris, France", REP, "site"),
    ]


def test_gather_and_city_model():
    reports = [x for x in (dm.post_report(_Row(p)) for p in paris_posts()) if x]
    parts = ds.gather(NOW, paris_posts(), reports, [])
    paris = parts["cities"]["paris"]
    crowds = ds.build_crowds(paris["reports"], NOW, None, parts["learned"])
    assert {c["place"].split(",")[0] for c in crowds} >= {"Place de la Concorde", "Palais de l'Élysée"}
    # the crowd that left République "heading to the Élysée" is linked to the
    # report of a crowd at the Élysée twenty minutes later: one crowd, its path
    ely = next(c for c in crowds if c["place"].startswith("Palais de l'Élysée"))
    assert [p["place"].split(",")[0] for p in ely["path"]] == ["Place de la République", "Palais de l'Élysée"]
    m = ds.city_model("paris", crowds, paris["calls"], paris["devs"], {}, {}, NOW)
    top = m["convergence"][0]
    assert top["name"] == "Palais de l'Élysée" and top["rank"] == 1
    assert "named in" in top["explanation"] and "already there" in top["explanation"]
    assert all(not r["routed"] for r in m["routes"]) and m["routes"]
    assert m["counts"]["calls_2h"] >= 3 and m["developments"][0]["hhmm"]
    s = ds.summary(m, NOW)
    assert "Élysée" in s["headline"] and "estimate" in s["headline"] and s["latest"]


class _Row(dict):
    def __getitem__(self, k):
        return self.get(k)


def test_situation_routes_and_budget(monkeypatch):
    """The endpoint's coroutine: routing stubbed (instant table, one slow route that
    misses the budget and is drawn straight, estimated, until the next poll)."""
    reports = [x for x in (dm.post_report(_Row(p)) for p in paris_posts()) if x]
    monkeypatch.setattr(ds, "read_inputs", lambda now: {"posts": paris_posts(), "reports": reports, "hazards": [],
                                                        "places": [], "intent_rows": {}})
    import safe_route as sr
    sr._route_cache.clear()
    ds._memo.clear()
    calls = {"table": 0, "route": 0}

    async def table(c, t):
        calls["table"] += 1
        out = {(i, j): (600.0, 900.0) for i in range(len(c)) for j in range(len(t))}
        sr._cache_put("ot:" + ds._table_url(c, t), out)
        return out

    async def walk(g, t):
        calls["route"] += 1
        await asyncio.sleep(5)

    monkeypatch.setattr(ds, "osrm_table", table)
    monkeypatch.setattr(ds, "_walk", walk)
    monkeypatch.setattr(ds, "ROUTING_BUDGET_S", 0.2)

    async def run():
        import time as _t
        t0 = _t.monotonic()
        out = await ds.situation(NOW, "Paris")
        return out, _t.monotonic() - t0

    out, took = asyncio.run(run())
    assert took < 2
    p = out["cities"][0]
    assert p["city"] == "paris" and calls["table"] == 1
    assert p["routing"]["etas_routed"] > 0 and p["routes"] and not any(r["routed"] for r in p["routes"])
    assert any(r["eta_min"] == 12.5 and r["routed"] for c in p["convergence"] for r in c.get("reach") or [])
    assert p["convergence"][0]["name"] == "Palais de l'Élysée"


def test_routing_waits_while_the_planner_queue_is_busy(monkeypatch):
    """Somebody's way out first: no new routing request while the planner's
    OSRM queue is backed up — ETAs are then straight-line estimates."""
    import time as _t
    import safe_route as sr
    reports = [x for x in (dm.post_report(_Row(p)) for p in paris_posts()) if x]
    monkeypatch.setattr(ds, "read_inputs", lambda now: {"posts": paris_posts(), "reports": reports, "hazards": [],
                                                        "places": [], "intent_rows": {}})
    sr._route_cache.clear()
    calls = []

    async def nope(c, t):
        calls.append(1)

    monkeypatch.setattr(ds, "osrm_table", nope)
    monkeypatch.setattr(ds, "_walk", nope)
    monkeypatch.setitem(sr._next_slot, "osrm", _t.monotonic() + 30)
    out = asyncio.run(ds.situation(NOW, "paris"))
    assert calls == [] and out["cities"][0]["routing"]["etas_routed"] == 0
    assert out["cities"][0]["convergence"][0]["name"] == "Palais de l'Élysée"


def test_a_crowd_heading_somewhere_makes_it_a_target():
    p = [post(9, 20, "Le cortège part de République et se dirige vers Bastille", "Place de la République, Paris, France", REP, "site")]
    reports = [x for x in (dm.post_report(_Row(x)) for x in p) if x]
    parts = ds.gather(NOW, p, reports, [])
    crowds = ds.build_crowds(parts["cities"]["paris"]["reports"], NOW)
    assert crowds[0]["heading_to"]["name"] == "Place de la Bastille"
    m = ds.city_model("paris", crowds, [], [], {}, {}, NOW)
    assert m["convergence"][0]["name"] == "Place de la Bastille"
    assert "heading there" in m["convergence"][0]["explanation"] and m["routes"][0]["coords"][0] == [REP[0], REP[1]]


def test_reads_telegram_intents_table_shape():
    """telegram_signals.py writes immediate/starts_utc, not "when" (2026-10-18)."""
    import demo_situation as ds
    now = "2026-10-17T16:05:00Z"
    row = {"intents": [{"kind": "intent", "act": "attack", "target": "Palais de l'Élysée", "lat": 48.8704, "lon": 2.3167,
                        "immediate": 1, "starts_utc": now, "confidence": 0.9}]}
    out = ds.structured_intents(row, posted_at=now, city="paris")
    assert out and out[0]["when"] == "now"


# ── crowd-tracking accuracy (2026-10-18): streets, routed paths, "now" ─────

RIVOLI = (48.8592, 2.3466)


@pytest.fixture(autouse=True)
def _no_geocoder(monkeypatch):
    """No test asks Nominatim: every street phrase is a known miss unless a
    test stubs the cache, and nothing starts the lookup thread."""
    monkeypatch.setattr(ds, "_geo_cached", lambda q, box: [])
    monkeypatch.setattr(ds, "_start_geo_thread", lambda: None)
    ds._geo_q.clear()
    yield
    ds._geo_q.clear()


def test_street_phrases():
    assert ds.street_phrase("le cortege est rue de rivoli maintenant") == "rue de rivoli"
    assert ds.street_phrase("on passe pont alexandre iii vers la concorde") == "pont alexandre iii"
    assert ds.street_phrase("boulevard saint-germain a 15h") == "boulevard saint-germain"
    assert ds.street_phrase("rue du 4 septembre") == "rue du 4 septembre"
    assert ds.street_phrase("tous les jours") is None and ds.street_phrase("la rue") is None


def test_street_geocoding_cache_only_then_background(monkeypatch):
    """A street not asked yet: nothing now, queued once; the background
    lookup (stubbed geocoder) fills the cache; the next read has it. A hit
    outside the city is refused."""
    cache: dict = {}
    looked: list = []
    monkeypatch.setattr(ds, "_geo_cached", lambda q, box: cache.get(q))

    def lookup(q, box):
        looked.append((q, box))
        cache[q] = [{"lat": RIVOLI[0], "lon": RIVOLI[1], "display_name": "Rue de Rivoli, Quartier des Halles, Paris, France"}]
        return cache[q]

    monkeypatch.setattr(ds, "_geo_lookup", lookup)
    assert ds.extract_positions("On est rue de Rivoli, ça gaze", "paris") == []
    assert ds.extract_positions("on est rue de Rivoli", "paris") == []
    assert list(ds._geo_q) == ["rue de rivoli, Paris"]          # once, however often it is read
    assert ds.geo_drain() == 1 and len(looked) == 1
    box = looked[0][1]
    assert box[0] < RIVOLI[1] < box[2] and box[1] < RIVOLI[0] < box[3]
    out = ds.extract_positions("On est rue de Rivoli, ça gaze", "paris")
    assert out[0]["kind"] == "at" and out[0]["place"]["name"] == "Rue de Rivoli"
    assert out[0]["place"]["lat"] == RIVOLI[0] and out[0]["place"]["city"] == "paris"
    # a "hit" 40 km out is not the street people mean
    cache["rue de la paix, Paris"] = [{"lat": 49.2, "lon": 2.35, "display_name": "Rue de la Paix, Senlis"}]
    assert ds.resolve_place("rue de la paix", "paris") is None
    # no city, no lookup; war-news verbs never geocode
    assert ds.resolve_place("rue de la gare", None) is None and not ds._geo_q
    assert ds.extract_intents("take rue de Rivoli", _at(1), PARIS, "paris") == []


def test_gather_reads_a_post_again_once_its_street_is_back(monkeypatch):
    cache: dict = {}
    monkeypatch.setattr(ds, "_geo_cached", lambda q, box: cache.get(q))
    monkeypatch.setattr(ds, "_geo_lookup", lambda q, box: cache.setdefault(q, [{"lat": RIVOLI[0], "lon": RIVOLI[1],
                                                                                "display_name": "Rue de Rivoli, Paris"}]))
    ds._EXTRACTED.clear()
    p = [post(70, 5, "On est rue de Rivoli, des milliers de manifestants", "Paris, France", (48.8566, 2.3522), "city")]
    assert not ds.gather(NOW, p, [], [])["cities"].get("paris", {}).get("reports")
    ds.geo_drain()
    parts = ds.gather(NOW, p, [], [])
    r = parts["cities"]["paris"]["reports"][0]
    assert r["position_kind"] == "at" and (r["lat"], r["lon"]) == RIVOLI and r["place"].startswith("Rue de Rivoli")


def test_path_legs_routed_or_estimated():
    path = [{"lat": REP[0], "lon": REP[1], "place": "République"}, {"lat": REP[0] + 0.0005, "lon": REP[1], "place": "near"},
            {"lat": CON[0], "lon": CON[1], "place": "Concorde"}]
    via = [[REP[0] + 0.0004, REP[1]], [48.866, 2.34], [CON[0], CON[1] + 0.0002]]
    legs = ds.path_legs(path, lambda a, b: via if b["place"] == "Concorde" else None)
    assert [x["routed"] for x in legs] == [False, True]
    assert legs[0]["estimated"] is False                       # 55 m: a straight line is the street
    assert legs[1]["coords"][0] == [path[1]["lat"], path[1]["lon"]] and legs[1]["coords"][-1] == [CON[0], CON[1]]
    assert legs[1]["distance_m"] >= round(dm.metres(path[1]["lat"], path[1]["lon"], *CON)) - 1
    legs = ds.path_legs(path, lambda a, b: None)
    assert legs[1]["routed"] is False and legs[1]["estimated"] is True
    assert [b["place"] for a, b in ds.hops_to_route(path)] == ["Concorde"]


def test_situation_routes_crowd_paths_through_the_cache(monkeypatch):
    """A crowd's path hop is walked on the street network once the planner's
    cache has the route (stubbed _cache_get); until then a straight line,
    estimated — and the request is spawned within the pass's quota."""
    import safe_route as sr
    reports = [x for x in (dm.post_report(_Row(p)) for p in paris_posts()) if x]
    monkeypatch.setattr(ds, "read_inputs", lambda now: {"posts": paris_posts(), "reports": reports, "hazards": [],
                                                        "places": [], "intent_rows": {}})
    ds._memo.clear()
    ds._tasks.clear()
    spawned = []

    async def walk(g, t):
        spawned.append((g["lat"], t["lat"]))
        return []

    async def table(c, t):
        return None

    monkeypatch.setattr(ds, "_walk", walk)
    monkeypatch.setattr(ds, "osrm_table", table)
    monkeypatch.setattr(ds, "ROUTING_BUDGET_S", 0.1)
    monkeypatch.setattr(ds, "NEW_REQUESTS_PER_PASS", 20)
    monkeypatch.setitem(sr._next_slot, "osrm", 0.0)
    hop = [[REP[0], REP[1] - 0.001], [48.869, 2.34], [ELY[0], ELY[1] + 0.001]]
    store: dict = {}
    monkeypatch.setattr(sr, "_cache_get", lambda k: store.get(k))
    out = asyncio.run(ds.situation(NOW, "paris"))
    ely = next(g for g in out["cities"][0]["crowds"] if g["place"].startswith("Palais de l'Élysée"))
    assert ely["path_legs"][0]["routed"] is False and ely["path_legs"][0]["estimated"] is True
    assert (REP[0], ELY[0]) in spawned
    store[ds._route_key({"lat": REP[0], "lon": REP[1]}, {"lat": ELY[0], "lon": ELY[1]})] = [{"coords": hop}]
    out = asyncio.run(ds.situation(NOW, "paris"))
    ely = next(g for g in out["cities"][0]["crowds"] if g["place"].startswith("Palais de l'Élysée"))
    leg = ely["path_legs"][0]
    assert leg["routed"] is True and leg["coords"][1:-1] == hop and leg["coords"][0] == [REP[0], REP[1]]
    assert out["cities"][0]["routing"]["path_legs_routed"] >= 1


def test_path_routing_never_runs_while_the_planner_is_busy(monkeypatch):
    import time as _t
    import safe_route as sr
    reports = [x for x in (dm.post_report(_Row(p)) for p in paris_posts()) if x]
    monkeypatch.setattr(ds, "read_inputs", lambda now: {"posts": paris_posts(), "reports": reports, "hazards": [],
                                                        "places": [], "intent_rows": {}})
    ds._tasks.clear()
    calls = []

    async def nope(*a):
        calls.append(a)

    monkeypatch.setattr(ds, "_walk", nope)
    monkeypatch.setattr(ds, "osrm_table", nope)
    monkeypatch.setattr(sr, "_cache_get", lambda k: None)
    monkeypatch.setitem(sr._next_slot, "osrm", _t.monotonic() + 30)
    out = asyncio.run(ds.situation(NOW, "paris"))
    assert calls == [] and all(not x["routed"] for g in out["cities"][0]["crowds"] for x in g["path_legs"])


def test_now_estimate_along_heading_and_capped():
    g = {"id": "c1", "lat": REP[0], "lon": REP[1], "at": _at(15), "heading_to": {"id": "g:bas", "name": "Bastille",
                                                                                "lat": BAS[0], "lon": BAS[1]}}
    est, reach = ds.now_estimate(g, NOW, [])
    walked = 15 * ds.CROWD_KMH * 1000 / 60                    # 1000 m in 15 min
    assert reach == round(walked) and est["basis"] == "heading_to" and est["to"] == "Bastille"
    assert est["routed"] is False and est["advanced_m"] == round(walked / ds.DETOUR)
    assert dm.metres(REP[0], REP[1], est["lat"], est["lon"]) == pytest.approx(walked / ds.DETOUR, rel=0.01)
    assert est["trail"][0] == [REP[0], REP[1]] and est["trail"][-1] == [est["lat"], est["lon"]]
    # long after, it is at Bastille, not past it; the reach is capped
    est, reach = ds.now_estimate({**g, "at": _at(200)}, NOW, [])
    assert est["arrived"] and (est["lat"], est["lon"]) == pytest.approx(BAS) and reach == ds.REACH_CAP_M
    # along the routed line to its top convergence point, at full walking speed
    line = {"crowd_id": "c1", "target_id": "tgt-x", "target_name": "Élysée", "routed": True,
            "coords": [[CON[0], CON[1]], [ELY[0], CON[1]], [ELY[0], ELY[1]]]}
    est, _ = ds.now_estimate({"id": "c1", "lat": CON[0], "lon": CON[1], "at": _at(3)}, NOW, [line])
    assert est["basis"] == "convergence" and est["to"] == "Élysée" and est["routed"]
    assert est["advanced_m"] == 200 and est["lon"] == pytest.approx(CON[1])     # still on the first leg, due north
    # no direction: no point, only how far it could be
    est, reach = ds.now_estimate({"id": "c2", "lat": CON[0], "lon": CON[1], "at": _at(6)}, NOW, [line])
    assert est is None and reach == 400


def test_city_model_gives_each_crowd_a_now_estimate():
    p = [post(9, 20, "Le cortège part de République et se dirige vers Bastille", "Place de la République, Paris, France", REP, "site")]
    reports = [x for x in (dm.post_report(_Row(x)) for x in p) if x]
    crowds = ds.build_crowds(ds.gather(NOW, p, reports, [])["cities"]["paris"]["reports"], NOW)
    m = ds.city_model("paris", crowds, [], [], {}, {}, NOW)
    g = m["crowds"][0]
    assert g["age_min"] == 20 and g["now_est"]["basis"] == "heading_to" and g["now_est"]["to"] == "Place de la Bastille"
    assert 0 < dm.metres(REP[0], REP[1], g["now_est"]["lat"], g["now_est"]["lon"]) < dm.metres(*REP, *BAS)
    assert g["reach_m"] == round(20 * ds.CROWD_KMH * 1000 / 60)


def _rep(rid, ll, m, text, place, **kw):
    return {"id": rid, "lat": ll[0], "lon": ll[1], "at": _at(m), "country": "fr", "text": text, "place": place, **kw}


def test_self_reported_position_outranks_a_second_hand_report():
    """"On est à Concorde" at 15:50, then a news channel's "crowd outside the
    Élysée" at 15:55: the crowd is where its people said."""
    rs = [_rep("pos-chan/1-0", CON, 10, "on est place de la Concorde, ca bouge vers l'Elysee", "Place de la Concorde, Paris, FR",
               position_kind="at"),
          _rep("tg-news-2", ELY, 5, "crowd marching outside the Elysee", "Palais de l'Élysée, Paris, FR")]
    g = ds.build_crowds(rs, NOW)[0]
    assert g["place"].startswith("Place de la Concorde") and g["self_reported"] and g["at"] == _at(10)
    assert g["age_min"] == 10 and g["outranked"][0]["place"].startswith("Palais de l'Élysée")
    assert g["last_report_at"] == _at(5)
    # a second-hand report well after it (20 min): the crowd has moved on
    rs2 = [rs[0], {**rs[1], "at": _at(-10)}]
    g = ds.build_crowds(rs2, NOW + dt.timedelta(minutes=10))[0]
    assert g["place"].startswith("Palais de l'Élysée") and not g["self_reported"]
    # a crowd post that only mentions a place is not a self-report
    m = [{**rs[0], "id": "pos-chan/3-0", "position_kind": "mentioned"}]
    assert ds.build_crowds(m, NOW)[0]["self_reported"] is False


def test_age_is_since_the_report_not_since_it_was_read():
    rs = [_rep("tg-a", CON, 42, "foule", "Place de la Concorde, Paris, FR")]
    g = ds.build_crowds(rs, NOW)[0]
    assert g["age_min"] == 42 and g["at"] == _at(42)
