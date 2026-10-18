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
