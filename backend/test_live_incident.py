"""live_incident: the model extracts (stubbed here), the CODE decides — quotes
verbatim, place in the text, event time inside the window, only the quoted
place geocoded, the answer at the level the text stated, ambiguity rejected,
caps, the model out → the rule path under the same discipline."""
import datetime as dt
import json
import sqlite3
import types

import pytest

import live_incident as li
import openai_gate
import telegram_ingest as tg
import telegram_signals as ts

NOW = dt.datetime(2026, 10, 22, 14, 0, tzinfo=dt.timezone.utc)
PUB = "2026-10-22T13:58:00+00:00"
TEXT = "BREAKING: police are charging protesters right now at Place de la République in Paris, France"


def good(**kw):
    a = {"is_live": True, "event_type": "police_intervention", "event_time": "2026-10-22T13:57:00Z", "certainty": "verified",
         "location": {"name_as_written": "Place de la République", "level": "street", "context_as_written": ["Paris", "France"]},
         "other_places_mentioned": [], "ambiguity_note": None, "evidence_quote_time": "right now",
         "evidence_quote_place": "at Place de la République in Paris", "evidence_quote_act": "police are charging",
         "first_hand": False, "reject_class": None, "direction": None, "reject_reason": None}
    a.update(kw)
    return a


def city(name, lat, lon, typ="city", cls="place", rank=16, **kw):
    return {"lat": lat, "lon": lon, "display_name": f"{name}, somewhere", "class": cls, "type": typ, "place_rank": rank,
            "address": {}, **kw}


# ── the code's checks (a), (b), (c) ────────────────────────────────────────

def test_a_good_answer_passes_every_check():
    v = li.verify(good(), TEXT, PUB, NOW)
    assert v["ok"], v["reasons"]
    assert v["event_time"] == "2026-10-22T13:57:00+00:00" and v["level"] == "street" and v["context"] == ["Paris", "France"]


@pytest.mark.parametrize("patch,why", [
    ({"evidence_quote_time": "this very second"}, "time quote is not in the text"),
    ({"evidence_quote_place": "on the Champs-Élysées"}, "place quote is not in the text"),
    ({"evidence_quote_time": None}, "time quote is not in the text"),
    ({"evidence_quote_place": ""}, "place quote is not in the text"),
    ({"location": {"name_as_written": "Place de la Bastille", "level": "street", "context_as_written": []}}, "place as written is not in the text"),
    ({"location": {"name_as_written": "Place de la République", "level": "street", "context_as_written": ["Île-de-France"]}}, "context"),
    ({"location": {"name_as_written": "Place de la République", "level": "plaza", "context_as_written": []}}, "level"),
    ({"location": None}, "no location stated"),
    ({"event_type": "other"}, "event type"),
    ({"event_type": None}, "event type"),
    ({"certainty": "probably"}, "certainty"),
    ({"event_time": None}, "event time missing"),
    ({"event_time": "this morning"}, "event time missing"),
    ({"event_time": "2026-10-22T14:30:00Z"}, "after the post"),        # in the future of the post
    ({"event_time": "2026-10-22T12:30:00Z"}, "before the post"),       # 88 min before
    ({"is_live": False, "reject_reason": "a recap"}, "model: a recap"),
])
def test_the_code_rejects(patch, why):
    v = li.verify(good(**patch), TEXT, PUB, NOW)
    assert not v["ok"] and any(why in r for r in v["reasons"]), v["reasons"]


def test_quotes_tolerate_whitespace_and_case_only():
    assert li.verify(good(evidence_quote_time="RIGHT   now"), TEXT, PUB, NOW)["ok"]
    assert not li.verify(good(evidence_quote_time="right  there"), TEXT, PUB, NOW)["ok"]
    assert li.in_text("Place de la République", TEXT) is True        # a no-break space is not a difference
    assert li.in_text("x", "x") is False                                 # too short to prove anything


def test_a_time_quote_that_points_to_an_earlier_time_is_rejected():
    text = "Yesterday evening, police charged protesters at Place de la République in Paris"
    a = good(evidence_quote_time="Yesterday evening", evidence_quote_place="at Place de la République in Paris",
             event_time="2026-10-22T13:55:00Z")
    v = li.verify(a, text, PUB, NOW)
    assert not v["ok"] and any("earlier time" in r for r in v["reasons"])


def test_the_live_window_is_checked_at_read_time():
    # judged late: the post (and its event) are 70 min old when the code reads them
    late = NOW + dt.timedelta(minutes=70)
    v = li.verify(good(), TEXT, PUB, late)
    assert not v["ok"] and any("window has passed" in r for r in v["reasons"])


def test_an_event_a_moment_after_the_post_is_clipped_to_it_not_trusted():
    v = li.verify(good(event_time="2026-10-22T13:58:40Z"), TEXT, PUB, NOW)
    assert v["ok"] and v["event_time"] == "2026-10-22T13:58:00+00:00"


# ── live is derived on read ────────────────────────────────────────────────

def test_live_is_derived_from_event_time_and_now():
    row = {"live_verdict": "live", "event_time": "2026-10-22T13:00:00+00:00"}
    assert li.is_live_now(row, NOW)                                          # 60 min
    assert not li.is_live_now(row, NOW + dt.timedelta(minutes=1))            # 61 min: out
    assert li.live_fields(row, NOW + dt.timedelta(minutes=5))["live_state"] == "past"
    assert not li.is_live_now({"live_verdict": "rejected: x", "event_time": row["event_time"]}, NOW)
    assert not li.is_live_now({"live_verdict": "live", "event_time": None}, NOW)
    assert li.live_fields({}, NOW)["live_state"] == "unchecked" and li.live_fields({}, NOW)["event_time"] is None
    assert li.live_fields({"live_verdict": "rejected: recap", "event_time": "x"}, NOW)["event_time"] is None


# ── (d) geocoding: only the quoted place, at the stated level ──────────────

def test_only_the_quoted_place_and_its_quoted_context_go_to_the_geocoder():
    asked = []

    def geo(q):
        asked.append(q)
        return [city("Rue Saint-Maur", 48.8675, 2.3638, typ="residential", cls="highway", rank=26, display_name="Rue Saint-Maur, Paris, France")]
    hit, why, info = li.resolve_place("Rue Saint-Maur", "street", ["Paris", "France"], "charge rue Saint-Maur à Paris, France", geocode=geo)
    assert why is None and hit["lat"] == 48.8675
    # the place and its quoted context, then the context alone (to check the street lies in that city):
    # never the channel's city or country
    assert asked[0] == "Rue Saint-Maur, Paris, France" and set(asked) <= {"Rue Saint-Maur, Paris, France", "Paris", "France"}


def test_no_context_in_the_text_means_none_is_added():
    asked = []
    li.resolve_place("Kharkiv", "city", [], "Explosions in Kharkiv now", geocode=lambda q: asked.append(q) or [city("Kharkiv", 49.99, 36.23)])
    assert asked == ["Kharkiv"]


def test_homonyms_the_text_does_not_tell_apart_are_rejected_not_resolved_to_the_famous_one():
    spring = [city("Springfield, Illinois", 39.8, -89.65), city("Springfield, Missouri", 37.2, -93.3),
              city("Springfield, Massachusetts", 42.1, -72.6)]
    hit, why, info = li.resolve_place("Springfield", "city", [], "tornado in Springfield now", geocode=lambda q: spring)
    assert hit is None and "3 different places" in why and "does not say which" in info["ambiguity_note"]
    # the same name, one answer nearby twice (a city and its district): not ambiguous
    near = [city("Kharkiv", 49.99, 36.23), city("Kharkiv", 50.0, 36.25)]
    assert li.resolve_place("Kharkiv", "city", [], "Kharkiv now", geocode=lambda q: near)[0] is not None


def test_context_from_the_text_resolves_the_homonym():
    def geo(q):
        return [city("Georgetown, Guyana", 6.80, -58.15)] if "Guyana" in q else [city("Georgetown, DC", 38.9, -77.07), city("Georgetown, Texas", 30.6, -97.7)]
    assert li.resolve_place("Georgetown", "city", [], "shots in Georgetown", geocode=geo)[0] is None
    hit, why, _ = li.resolve_place("Georgetown", "city", ["Guyana"], "shots in Georgetown, Guyana", geocode=geo)
    assert why is None and hit["lat"] == 6.80


def test_the_local_gazetteer_needs_the_text_to_name_the_city():
    """'Châtelet' alone is not Paris — the gazetteer is Paris-only."""
    asked = []
    hit, why, _ = li.resolve_place("Châtelet", "street", [], "la police charge à Châtelet", geocode=lambda q: asked.append(q) or [])
    assert hit is None and asked == ["Châtelet"]                       # fell through to the geocoder, found nothing
    hit, why, info = li.resolve_place("Châtelet", "street", ["Paris"], "la police charge à Châtelet, à Paris", geocode=lambda q: asked.append(q) or [])
    assert why is None and hit.get("local") and abs(hit["lat"] - 48.8576) < 0.01 and asked == ["Châtelet"]


def test_the_answer_must_be_at_the_level_the_text_stated():
    province = [city("Kidal", 18.4, 1.4, typ="state", rank=8)]
    hit, why, _ = li.resolve_place("Kidal", "city", [], "strike in Kidal now", geocode=lambda q: province)
    assert hit is None and "another level" in why
    assert li.resolve_place("Kidal", "region", [], "x", geocode=lambda q: province)[1].startswith("stated level 'region' is too coarse")
    assert li.resolve_place("Mali", "country", [], "x", geocode=lambda q: province)[1].startswith("stated level 'country' is too coarse")
    # a street named at 'street' level that the geocoder only knows as a suburb: not the same thing
    hood = [city("Marais", 48.86, 2.36, typ="suburb", rank=20)]
    assert li.resolve_place("Rue de Rivoli", "street", [], "x Rue de Rivoli", geocode=lambda q: hood)[0] is None
    # a venue
    venue = [{"lat": 51.543, "lon": 0.009, "display_name": "Westfield Stratford City", "class": "shop", "type": "mall", "place_rank": 30}]
    assert li.resolve_place("Westfield", "venue", ["Stratford"], "Westfield Stratford", geocode=lambda q: venue)[0]["lat"] == 51.543


def test_an_answer_that_does_not_carry_the_name_is_a_mismatch():
    wrong = [city("Dnipro", 51.5, 31.2, address={"state": "Chernihiv Oblast"})]
    hit, why, _ = li.resolve_place("Kryvorizhzhia", "city", [], "x Kryvorizhzhia", geocode=lambda q: wrong)
    assert hit is None and "another level" in why
    # non-Latin names are not compared: the answer is in the local language
    assert li.resolve_place("بيتونيا", "city", [], "x", geocode=lambda q: [city("بيتونيا‎", 31.9, 35.17)])[0] is not None


def test_the_query_is_the_places_own_name_plus_context_the_text_quotes():
    t = "frappes israéliennes sur la ville de Nabatieh, dans le sud du Liban"
    assert li.query_plan("ville de Nabatieh", None, ["dans le sud du Liban"], t) == ["Nabatieh, Liban"]
    assert li.query_plan("central Kharkiv", "Kharkiv", ["Ukraine"], "explosions in central Kharkiv, Ukraine") == ["Kharkiv, Ukraine"]
    # a dictionary form the text does not support is ignored: the model cannot bring a place in
    assert li.query_plan("Châtelet", "Paris Châtelet", [], "à Châtelet") == ["Châtelet"]
    assert li.query_plan("Харкові", "Харків", [], "Зараз у Харкові лунають вибухи") == ["Харків"]
    assert li.query_plan("Белгороде", "Белгород", [], "в Белгороде работает ПВО") == ["Белгород"]
    assert li.query_plan("Курске", "Москва", [], "сейчас в Курске слышны взрывы") == ["Курске"]
    # with context given the bare name is never asked
    assert "Georgetown" not in li.query_plan("Georgetown", None, ["Guyana"], "Georgetown, Guyana")
    # the channel's city never appears
    assert all("Paris" not in q for q in li.query_plan("Rue Saint-Maur", None, [], "charge rue Saint-Maur"))


def test_a_clear_leader_by_importance_is_not_a_guess_but_equals_are_ambiguous():
    paris = [city("Paris, France", 48.85, 2.35, importance=0.9), city("Paris, Texas", 33.66, -95.55, importance=0.53)]
    hit, why, info = li.resolve_place("Paris", "city", [], "shots in Paris", geocode=lambda q: paris)
    assert why is None and hit["lat"] == 48.85 and "clear leader" in info["dominance"]
    close = [city("Springfield, IL", 39.8, -89.6, importance=0.613), city("Springfield, MA", 42.1, -72.6, importance=0.611)]
    assert li.resolve_place("Springfield", "city", [], "x", geocode=lambda q: close)[0] is None
    kursk = [city("Курск", 51.7, 36.2, importance=0.64), city("Курск village", 59.3, 29.1, typ="village", rank=19, importance=0.37)]
    assert li.resolve_place("Курск", "city", [], "x", geocode=lambda q: kursk)[0]["lat"] == 51.7


def test_a_city_state_is_a_city_and_an_oblast_is_a_region():
    tbilisi = {"class": "boundary", "type": "administrative", "place_rank": 8, "address": {"city": "თბილისი", "country": "x"}}
    oblast = {"class": "boundary", "type": "administrative", "place_rank": 8, "address": {"state": "Харківська область"}}
    assert li.hit_level(tbilisi) == "city" and li.hit_level(oblast) == "region"
    assert li.hit_level({"class": "boundary", "type": "administrative", "place_rank": 16, "address": {"city": "Lyon", "county": "Rhône"}}) == "city"
    assert li.hit_level({"class": "boundary", "type": "administrative", "place_rank": 15, "address": {"suburb": "x", "city": "Paris"}}) == "neighborhood"
    assert li.hit_level({"class": "shop", "type": "supermarket", "place_rank": 30}) == "venue"


def test_coarser_fallback_is_off_by_default_and_audited_when_on(monkeypatch):
    def geo(q):
        return [city("Tbilisi", 41.7, 44.8, address={"city": "Tbilisi"}, cls="boundary", typ="administrative", rank=8)] if q == "Tbilisi" else []
    text = "protesters are blocking the main avenue in Tbilisi, Georgia"
    hit, why, _ = li.resolve_place("main avenue", "street", ["Tbilisi", "Georgia"], text, geocode=geo)
    assert hit is None
    monkeypatch.setattr(li, "COARSER_FALLBACK", True)
    hit, why, info = li.resolve_place("main avenue", "street", ["Tbilisi", "Georgia"], text, geocode=geo)
    assert hit["lat"] == 41.7 and "city level" in info["fallback"] and info["fallback_level"] == "city"


def test_the_context_must_show_in_a_comparable_answer():
    """A street named like one in another city is not the street of the text."""
    dnipro = city("Дніпро", 48.46, 35.04, display_name="Дніпро, Україна")
    street = lambda lat, lon: city("Y", lat, lon, typ="residential", cls="highway", rank=26, display_name="проспект Яворницького")
    text = "у Дніпрі, на проспекті Яворницького"

    def geo(lat, lon):
        return lambda q: [dnipro] if q == "Дніпрі" else [street(lat, lon)]
    hit, why, info = li.resolve_place("проспекті Яворницького", "street", ["у Дніпрі"], text, geocode=geo(47.84, 35.14), geocoder_name="Яворницького")
    assert hit is None and "from Дніпрі" in why and info["context_check"]           # a street of that name 70 km away
    assert li.resolve_place("проспекті Яворницького", "street", ["у Дніпрі"], text, geocode=geo(48.46, 35.05), geocoder_name="Яворницького")[0]["lat"] == 48.46
    # a context that resolves to no city leaves nothing to compare with
    assert li.resolve_place("проспекті Яворницького", "street", ["у Дніпрі"], text, geocode=lambda q: [] if q == "Дніпрі" else [street(47.8, 35.1)],
                            geocoder_name="Яворницького")[0] is not None
    # another script: cannot be compared, the geocoder's reading of the query stands
    tbilisi = {"class": "boundary", "type": "administrative", "place_rank": 8, "address": {"city": "თბილისი", "ISO3166-2-lvl4": "GE-TB"},
               "display_name": "თბილისი, საქართველო", "lat": 41.7, "lon": 44.8}
    assert li.resolve_place("Tbilisi", "city", ["Georgia"], "x", geocode=lambda q: [tbilisi])[0] is not None


def test_the_dictionary_form_must_come_from_the_place_as_written_not_from_the_context():
    """Red Square → 'Москва' would pin a venue called Moscow: the model may only shorten the place it copied."""
    t = "Сейчас на Красной площади в Москве задерживают участников"
    assert li.query_plan("Красной площади", "Москва", ["в Москве"], t) == ["Красной площади, Москве"]
    assert li.query_plan("Красной площади", None, [], t) == ["Красной площади"]


def test_geocoder_budget_and_empty_answers():
    assert "budget" in li.resolve_place("Kharkiv", "city", [], "x", geocode=lambda q: [], budget=[0])[1]
    assert "did not resolve" in li.resolve_place("Atlantis", "city", [], "x", geocode=lambda q: [])[1]


def test_decide_end_to_end():
    d = li.decide(good(), TEXT, PUB, NOW, geocode=lambda q: [city("Place de la République", 48.8675, 2.3638, typ="square", rank=26)])
    assert d["verdict"] == "live" and abs(d["pin"]["lat"] - 48.8675) < 0.001 and d["audit"]["geocode"]["query"].startswith("Place de la République")
    # live, but the place is only a region: live, unplaced (never pinned at a centroid)
    reg = good(location={"name_as_written": "Paris", "level": "region", "context_as_written": []})
    d = li.decide(reg, TEXT, PUB, NOW, geocode=lambda q: pytest.fail("a region is not geocoded"))
    assert d["verdict"].startswith("live, unplaced") and d["pin"] is None and d["ok"]
    # ambiguity is a rejection and keeps the note
    amb = [city("Springfield", 1, 1), city("Springfield", 40, 40)]
    t = "Police charge protesters right now in Springfield"
    a = good(location={"name_as_written": "Springfield", "level": "city", "context_as_written": []},
             evidence_quote_place="in Springfield", evidence_quote_time="right now", evidence_quote_act="Police charge")
    d = li.decide(a, t, PUB, NOW, geocode=lambda q: amb)
    assert d["verdict"].startswith("rejected: 2 different places") and not d["ok"] and "does not say which" in d["audit"]["geocode"]["ambiguity_note"]


# ── the prefilter ──────────────────────────────────────────────────────────

def test_prefilter_spares_the_model_what_cannot_be_an_incident():
    assert li.prefilter("🛸 Харків (Харківська обл.) Загроза застосування БПЛА. Перейдіть в укриття!") == (False, False)
    assert li.prefilter("🟢 Сумський район Відбій тривоги. Будьте обережні!") == (False, False)
    assert li.prefilter("ok") == (False, False)
    assert li.prefilter("Big discount on shoes in the mall this weekend only, come and see") == (False, False)
    assert li.prefilter("Explosions heard in central Kharkiv now")[0] is True
    assert li.prefilter("Реактивний БпЛА курсом на Миколаїв з півдня, будьте уважні") == (True, True)


# ── the pass: a database and a stubbed model ───────────────────────────────

@pytest.fixture
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "akili.db")
    monkeypatch.setattr(tg, "_db_path", lambda: path)
    monkeypatch.setattr(ts, "chat_context", lambda chan: {"country": "fr", "region": "Paris"})
    monkeypatch.setattr(openai_gate, "_QUOTA", {"until": 0.0, "since": None, "hits": 0, "last": None})
    for k in ("extracted", "live", "rejected", "unplaced", "reused", "skipped_prefilter", "capped", "failed_calls"):
        monkeypatch.setitem(li.STATUS, k, 0)
    return path


def _post(mid, text=TEXT, at=PUB, chan="LeGrandQG", read_by=None, lat=None):
    con = tg._con()
    con.execute("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, chat_kind, role, read_by, lat)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)", (chan, mid, chan, at, text, "none", "channel", "aggregator", read_by, lat))
    con.commit()
    con.close()


def _row(path, mid):
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM telegram_posts WHERE msg_id=?", (mid,)).fetchone()
    con.close()
    return dict(r)


REPUBLIQUE = lambda q: [city("Place de la République", 48.8675, 2.3638, typ="square", rank=26, country_code="fr")]


def test_a_live_answer_is_pinned_and_audited(db):
    kh = "BREAKING: explosions in central Kharkiv, Ukraine, air defence is active right now"
    _post(1, text=kh)
    calls = []

    def ext(text, pub, name, region):
        calls.append((text, pub, name, region))
        return good(event_type="explosion", location={"name_as_written": "Kharkiv", "level": "city", "context_as_written": ["Ukraine"]},
                    evidence_quote_place="central Kharkiv, Ukraine", evidence_quote_act="explosions"), 0.0007
    out = li.run_once(now=NOW, extract_fn=ext,
                      geocode=lambda q: [city("Kharkiv", 49.99, 36.23, country_code="ua", display_name="Kharkiv, Ukraine")])
    assert out["live"] == 1 and calls[0][1] == PUB
    r = _row(db, 1)
    assert (r["live_verdict"], r["event_time"], r["precision"], r["event_type"], r["lat"]) == ("live", "2026-10-22T13:57:00+00:00", "city", "explosion", 49.99)
    audit = json.loads(r["live_json"])
    assert audit["model"]["evidence_quote_time"] == "right now" and audit["verify"]["ok"] and audit["geocode"]["query"] == "Kharkiv, Ukraine"
    # on read: the event's time rides with the post; live while inside the window of now
    p = [x for x in tg.published(24 * 400) if x["msg_id"] == 1][0]
    assert p["event_time"] == r["event_time"] and p["posted_at"] == PUB and p["headline"] and p["live_state"] in ("past", "live")
    assert li.live_fields(_row(db, 1), NOW + dt.timedelta(minutes=30))["live"] is True
    assert li.live_fields(_row(db, 1), NOW + dt.timedelta(minutes=62))["live_state"] == "past"


def test_a_rejected_answer_is_not_pinned_and_says_why(db):
    _post(2)
    li.run_once(now=NOW, extract_fn=lambda *a: (good(evidence_quote_time="seconds ago"), 0.0007), geocode=REPUBLIQUE)
    r = _row(db, 2)
    assert r["lat"] is None and r["live_verdict"].startswith("rejected: time quote is not in the text") and r["event_time"] is None
    assert li.STATUS["rejected"] == 1 and li.STATUS["rejections"]


def test_a_model_pin_the_older_reading_made_is_kept_as_context_not_live(db):
    _post(3, lat=48.0)
    li.run_once(now=NOW, extract_fn=lambda *a: ({"is_live": False, "reject_reason": "a recap"}, 0.0007), geocode=REPUBLIQUE)
    r = _row(db, 3)
    assert r["lat"] == 48.0 and r["live_verdict"] == "rejected: model: a recap"          # not labelled live
    assert li.live_fields(r, NOW)["live"] is False and li.live_fields(r, NOW)["event_time"] is None


def test_a_rule_pin_the_strict_reading_does_not_stand_behind_is_withdrawn(db):
    _post(4, lat=48.0, read_by="rule")
    li.run_once(now=NOW, extract_fn=lambda *a: ({"is_live": False, "reject_reason": "no time"}, 0.0007), geocode=REPUBLIQUE)
    assert _row(db, 4)["lat"] is None


def test_the_older_reading_does_not_move_a_live_pin(db, monkeypatch):
    """classify() ran after the extractor: the live pin keeps ITS place."""
    _post(5, at=dt.datetime.now(dt.timezone.utc).isoformat())
    n = dt.datetime.now(dt.timezone.utc)
    li.run_once(now=n, extract_fn=lambda *a: (good(event_time=(n - dt.timedelta(minutes=1)).isoformat()), 0.0007), geocode=REPUBLIQUE)
    assert _row(db, 5)["live_verdict"] == "live"
    monkeypatch.setattr(tg, "_model_pass", lambda rows: [{"relevant": False, "event_type": "other", "place": "Lyon", "precision": "city",
                                                           "country_code": "fr", "headline": "x"} for _ in rows])
    monkeypatch.setattr(openai_gate, "get_client", lambda purpose: object())
    tg.classify()
    r = _row(db, 5)
    assert (r["place"], r["event_type"], r["relevant"], r["read_by"]) == ("Place de la République", "unrest", 1, "model")
    assert abs(r["lat"] - 48.8675) < 0.001


def test_identical_texts_are_one_call(db):
    _post(6, chan="a")
    _post(7, chan="b")
    _post(8, chan="c")
    calls = []
    out = li.run_once(now=NOW, extract_fn=lambda *a: calls.append(a) or (good(), 0.0007), geocode=REPUBLIQUE)
    assert len(calls) == 1 and out["live"] == 3 and out["reused"] == 2
    # and a later pass finds them judged
    assert li.run_once(now=NOW, extract_fn=lambda *a: pytest.fail("judged twice"), geocode=REPUBLIQUE)["considered"] == 0


def test_a_text_judged_for_another_post_is_verified_again_for_this_ones_time(db):
    _post(9, chan="a")
    li.run_once(now=NOW, extract_fn=lambda *a: (good(), 0.0007), geocode=REPUBLIQUE)
    # the same words 50 minutes later: its own time is checked, so the lent event time is now too old
    later = NOW + dt.timedelta(minutes=50)
    _post(10, chan="b", at=later.isoformat())
    li.run_once(now=later, extract_fn=lambda *a: pytest.fail("called"), geocode=REPUBLIQUE)
    assert _row(db, 10)["live_verdict"] == "live" or _row(db, 10)["live_verdict"].startswith("rejected")


def test_the_prefilter_keeps_air_raid_warnings_away_from_the_model(db):
    _post(11, text="🛸 Харків (Харківська обл.) Загроза застосування БПЛА. Перейдіть в укриття!")
    out = li.run_once(now=NOW, extract_fn=lambda *a: pytest.fail("a warning reached the model"), geocode=REPUBLIQUE)
    assert out["skipped"] == 1 and _row(db, 11)["live_verdict"].startswith("skipped")


def test_caps_per_hour_and_per_day(db, monkeypatch):
    monkeypatch.setattr(li, "PER_HOUR", 2)
    for i in range(5):
        _post(20 + i, text=f"{TEXT} #{i}")
    calls = []
    out = li.run_once(now=NOW, extract_fn=lambda *a: calls.append(a) or (good(), 0.0007), geocode=REPUBLIQUE)
    assert len(calls) == 2 and out["capped"] == 3 and li.STATUS["capped"] == 3
    # the hour's budget is spent: nothing more until it frees up
    out = li.run_once(now=NOW, extract_fn=lambda *a: pytest.fail("over the cap"), geocode=REPUBLIQUE)
    assert out["capped"] == 3
    b = li.budget(tg._con(), NOW)
    assert b["hour"] == 2 and b["left"] == 0 and b["per_hour"] == 2
    monkeypatch.setattr(li, "PER_HOUR", 100)
    monkeypatch.setattr(li, "PER_DAY", 2)
    assert li.budget(tg._con(), NOW)["left"] == 0


def test_the_model_out_leaves_posts_unjudged_for_the_rule_path(db):
    _post(30)
    out = li.run_once(now=NOW, extract_fn=lambda *a: (None, 0.0), geocode=REPUBLIQUE)
    assert out["model_out"] and _row(db, 30)["live_checked"] is None
    out = li.run_once(now=NOW, gate_ok=False, extract_fn=lambda *a: pytest.fail("gate said no"), geocode=REPUBLIQUE)
    assert out["model_out"] and li.STATUS["model_out_passes"] >= 1
    # the credit pause closes the gate for real
    openai_gate.note_error(Exception("insufficient_quota"))
    monkeypatch_key = pytest.MonkeyPatch()
    monkeypatch_key.setenv("OPENAI_API_KEY", "sk-test")
    try:
        assert openai_gate.get_client(openai_gate.LIVE_INCIDENT) is None
        assert li.extract("x", PUB, "s", "r") == (None, 0.0)
    finally:
        monkeypatch_key.undo()
        openai_gate.note_ok()


def test_a_purpose_missing_from_the_production_list_is_said_loudly_not_silently_off(db, monkeypatch, capsys):
    """HW_OPENAI_PURPOSES in production is an explicit list without live_incident."""
    monkeypatch.setenv("HW_OPENAI_PURPOSES", "voice,explain,enrich,forecast,outlook,fusion,context")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setitem(li._GATE_LOG, "at", 0.0)
    assert "HW_OPENAI_PURPOSES" in li.gate_reason()
    _post(40)
    out = li.run_once(now=NOW, geocode=REPUBLIQUE)                 # the real gate, no stub
    assert out["model_out"] and "NOT RUNNING" in capsys.readouterr().out
    assert "HW_OPENAI_PURPOSES" in li.status()["gate_closed_because"]
    monkeypatch.setenv("HW_OPENAI_PURPOSES", "voice,live_incident")
    assert li.gate_reason() is None


def test_failed_calls_are_counted_loudly_and_retried(db, capsys):
    _post(31)

    def boom(*a):
        raise RuntimeError("500 upstream")
    out = li.run_once(now=NOW, extract_fn=boom, geocode=REPUBLIQUE)
    assert out["failed"] == 1 and li.STATUS["failed_calls"] == 1 and "500 upstream" in li.STATUS["last_error"]
    assert "[live-incident] error" in capsys.readouterr().out
    assert _row(db, 31)["live_checked"] is None                  # still in the window: tried again next pass
    assert li.run_once(now=NOW, extract_fn=lambda *a: (good(), 0.0007), geocode=REPUBLIQUE)["live"] == 1


def test_posts_older_than_the_window_are_not_read(db):
    _post(32, at="2026-10-22T12:00:00+00:00")
    out = li.run_once(now=NOW, extract_fn=lambda *a: pytest.fail("too old"), geocode=REPUBLIQUE)
    assert out["considered"] == 0


def test_the_request_has_the_spec_and_the_strict_schema():
    seen = {}

    class C:
        chat = types.SimpleNamespace(completions=types.SimpleNamespace(create=lambda **kw: seen.update(kw) or types.SimpleNamespace(
            choices=[types.SimpleNamespace(message=types.SimpleNamespace(content=json.dumps(good())))],
            usage=types.SimpleNamespace(prompt_tokens=1000, completion_tokens=150))))
    raw, cost = li.extract(TEXT, PUB, "Le Grand QG", "Paris, France", client=C())
    assert raw["is_live"] is True and cost == pytest.approx(1000 * 0.4e-6 + 150 * 1.6e-6)
    assert seen["temperature"] == 0 and seen["model"] == li.MODEL
    assert seen["response_format"]["json_schema"]["strict"] is True
    sysmsg = seen["messages"][0]["content"]
    assert "A wrong signal is far worse than a missing signal. When in doubt, reject." in sysmsg
    assert "source_region (context only, NOT evidence of the event location)" in sysmsg and "police_intervention" in sysmsg and "NOT SIGNALS" in sysmsg
    user = json.loads(seen["messages"][1]["content"])
    assert user["published_at"] == PUB and user["source_region"] == "Paris, France"
    sch = li.SCHEMA
    assert set(sch["required"]) == set(sch["properties"]) and sch["additionalProperties"] is False


# ── the rule path, same discipline ─────────────────────────────────────────

def test_rule_live_needs_present_tense_no_earlier_time_and_a_recent_post():
    fresh = (NOW - dt.timedelta(minutes=5)).isoformat()
    assert li.rule_live("BREAKING: Artillery shelling targets the town of Mansouri", fresh, NOW)[0]
    assert li.rule_live("عاجل | طيران الاحتلال يشن غارة على بلدة برعشيت", fresh, NOW)[0]
    assert li.rule_live("Срочно: обстрел Белгорода", fresh, NOW)[0]
    assert not li.rule_live("Artillery shelling targets the town of Mansouri", fresh, NOW)[0]          # no cue
    assert not li.rule_live("BREAKING: strike on Mansouri yesterday evening", fresh, NOW)[0]            # an earlier time
    assert not li.rule_live("Breaking: shelling of Mansouri on Tuesday", fresh, NOW)[0]
    assert not li.rule_live("Breaking: strike on Mansouri", (NOW - dt.timedelta(minutes=90)).isoformat(), NOW)[0]   # old post
    assert not li.rule_live("Breaking: strike on Mansouri", (NOW + dt.timedelta(minutes=30)).isoformat(), NOW)[0]  # from the future


@pytest.fixture
def rdb(tmp_path, monkeypatch):
    path = str(tmp_path / "akili.db")
    monkeypatch.setattr(tg, "_db_path", lambda: path)
    monkeypatch.setattr(ts, "chat_context", lambda chan: {"country": "fr", "region": "Paris"})
    monkeypatch.setattr(openai_gate, "_QUOTA", {"until": 0.0, "since": None, "hits": 0, "last": None})
    return path


def _rule_pass(path, monkeypatch, texts, at=None, locator=None):
    con = tg._con()
    at = at or dt.datetime.now(dt.timezone.utc).isoformat()
    for i, t in enumerate(texts):
        con.execute("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, chat_kind, role)"
                    " VALUES (?,?,?,?,?,?,?,?)", ("chan", i + 1, "chan", at, t, "none", "channel", "aggregator"))
    con.commit()
    monkeypatch.setattr(tg, "locate", locator or (lambda p, pr, cc: ({"lat": 33.2, "lon": 35.2, "display_name": p}, None)))
    monkeypatch.setattr(tg, "_model_pass", lambda rows: None)
    tg.classify()
    con = sqlite3.connect(path)
    return {r[0]: r[1:] for r in con.execute("SELECT msg_id, lat, live_verdict, event_time, unpublished_reason FROM telegram_posts")}


def test_with_the_model_out_a_present_tense_post_with_its_place_is_pinned_live(rdb, monkeypatch):
    got = _rule_pass(rdb, monkeypatch, ["BREAKING: Artillery shelling targets the town of Mansouri, southern Lebanon"])
    assert got[1][0] == 33.2 and got[1][1] == "rule-live" and got[1][2]
    p = [x for x in tg.published(24)][0]
    assert p["live"] is True and p["live_basis"] == "rule" and p["event_time"] == got[1][2]


def test_with_the_model_out_a_recap_or_old_post_is_read_not_pinned(rdb, monkeypatch):
    got = _rule_pass(rdb, monkeypatch, ["Artillery shelling targets the town of Mansouri, southern Lebanon",       # no cue
                                        "BREAKING: Artillery shelling hit the town of Mansouri, southern Lebanon yesterday"])  # earlier time
    assert got[1][0] is None and "not live by rule" in got[1][3]
    assert got[2][0] is None and "earlier time" in got[2][3]


def test_with_the_model_out_a_post_older_than_the_window_is_read_not_pinned(rdb, monkeypatch):
    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=120)).isoformat()
    got = _rule_pass(rdb, monkeypatch, ["BREAKING: Artillery shelling targets the town of Mansouri, southern Lebanon"], at=old)
    assert got[1][0] is None and "min old" in got[1][3]


def test_with_the_model_out_the_channels_country_is_not_evidence_of_the_place(rdb, monkeypatch):
    """'Châtelet' in a French channel: no country in the text, so no pin (before: Paris)."""
    seen = []
    got = _rule_pass(rdb, monkeypatch, ["🔴 Police charged protesters in Châtelet, tear gas in use"],
                     locator=lambda p, pr, cc: seen.append((p, cc)) or ({"lat": 48.85, "lon": 2.34, "display_name": p}, None))
    assert got[1][0] is None and seen == [] and "names no country" in got[1][3]


def test_with_the_model_out_an_air_raid_warning_is_not_a_signal(rdb, monkeypatch):
    got = _rule_pass(rdb, monkeypatch, ["⚡️ 🛸 Київ (Київська обл.) Загроза застосування БПЛА. Перейдіть в укриття!"])
    assert got[1][0] is None and got[1][1] is None


def test_the_model_path_drops_warnings_it_would_have_pinned(rdb, monkeypatch):
    con = tg._con()
    con.execute("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, chat_kind, role)"
                " VALUES ('UkraineAlarmSignal', 1, 't', ?, ?, 'none', 'channel', 'aggregator')",
                (dt.datetime.now(dt.timezone.utc).isoformat(), "🛸 Дніпро (Дніпропетровська обл.) Загроза застосування БПЛА. Перейдіть в укриття!"))
    con.commit()
    con.close()
    monkeypatch.setattr(openai_gate, "get_client", lambda purpose: object())
    monkeypatch.setattr(tg, "_model_pass", lambda rows: [{"relevant": True, "event_type": "unrest", "place": "Dnipro, Ukraine", "precision": "city",
                                                           "country_code": "ua", "headline": "x"} for _ in rows])
    monkeypatch.setattr(tg, "locate", lambda *a: ({"lat": 48.4, "lon": 35.0, "display_name": "Dnipro"}, None))
    tg.classify()
    r = sqlite3.connect(rdb).execute("SELECT lat, unpublished_reason FROM telegram_posts").fetchone()
    assert r[0] is None and "alert" in r[1]


def test_the_notification_cards_are_the_live_signals_and_nothing_else(monkeypatch):
    """Phone and desktop read the same server card: the live signals (live_signals.py), with the act and the place
    as the title and the honest source line as the reason. A Telegram post that is not a signal is no card."""
    import main
    import live_signals
    main._TG_CARDS_CACHE.clear()
    sig = {"id": "ls-a-1", "act": "arrest", "title": "Arrest at rue de Rivoli, Paris", "place": "rue de Rivoli", "lat": 48.86, "lon": 2.33,
           "country_code": "fr", "event_time": "2026-10-22T13:50:00+00:00", "muted": False, "high_impact": True,
           "corroboration": {"level": "eyewitness", "n_sources": 1, "line": "Eyewitness, unverified"},
           "sources": [{"url": "https://t.me/a/1"}], "media": None, "channel": "a", "msg_id": 1}
    monkeypatch.setattr(live_signals, "signals", lambda *a, **k: [sig])
    monkeypatch.setattr(tg, "published", lambda *a, **k: pytest.fail("the notification feed no longer reads the old pins"))
    cards = main._telegram_report_cards(24)
    main._TG_CARDS_CACHE.clear()
    assert [c["id"] for c in cards] == ["ls-a-1"]
    assert cards[0]["title"] == "Arrest at rue de Rivoli, Paris" and cards[0]["reason"] == "Eyewitness, unverified"
    assert cards[0]["created_at"] == "2026-10-22T13:50:00+00:00" and cards[0]["sev"] == "high"
    assert not main._ungated_telegram_card(cards[0])
    for bad in ({"id": "TGC-LeGrandQG-6347"}, {"id": "tg-x-1", "kind": "telegram"}, {"id": "now:abc"}, {"id": "a", "alert_type": "Telegram mood: rise"}):
        assert main._ungated_telegram_card(bad)


def test_the_rule_path_does_not_place_a_settlement_name_the_country_has_twice(monkeypatch):
    import geocode_utils
    import telegram_rules as tr
    two = [{"lat": 10.2, "lon": -64.6, "class": "place", "type": "city", "country_code": "ve", "importance": 0.4},
           {"lat": 10.7, "lon": -62.5, "class": "place", "type": "village", "country_code": "ve", "importance": 0.38}]
    monkeypatch.setattr(geocode_utils, "geocode_cached", lambda q, codes=None, *a, **k: two)
    monkeypatch.setattr(tg, "locate", lambda p, pr, cc: ({"lat": 10.7, "lon": -62.5, "display_name": p, "class": "place", "type": "village"}, None))
    x = tr.read("⚡️ Explosion at the refinery in Puerto La Cruz, Venezuela")
    hit, place, cc, why = tr.resolve(x, [5])
    assert hit is None and "different places" in why
    # a clear leader is placed
    two[1]["importance"] = 0.1
    two[0]["importance"] = 0.5
    assert tr.resolve(x, [5])[0] is not None


def test_pins_leave_the_map_after_a_day_and_warnings_never_pin(tmp_path, monkeypatch):
    """published(pins=True): dated by the event (else the post), gone PIN_MAX_H after it;
    an air-raid warning pinned before the rule existed is hidden; lists keep their window."""
    import datetime as dt, sqlite3
    import telegram_ingest as tg
    db = tmp_path / "t.db"
    monkeypatch.setattr(tg, "_db_path", lambda: str(db))
    con = tg._con()
    now = dt.datetime.now(dt.timezone.utc)
    def row(mid, hours_ago, text, event_hours=None):
        ts = (now - dt.timedelta(hours=hours_ago)).isoformat()
        ev = (now - dt.timedelta(hours=event_hours)).isoformat() if event_hours is not None else None
        con.execute("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, lat, lon, place, event_type, headline, role, event_time, live_verdict) "
                    "VALUES ('c', ?, 'C', ?, ?, 48.85, 2.35, 'Paris', 'conflict', ?, 'aggregator', ?, ?)", (mid, ts, text, f"h{mid}", ev, "live" if mid in (1, 3, 4) else None))
    row(1, 2, "Explosion at the depot, fire spreading")
    row(2, 30, "Explosion at the depot, fire spreading")                   # posted 30 h ago
    row(3, 2, "Strike earlier, now over", event_hours=40)                  # posted 2 h ago about an event 40 h old
    row(4, 2, "Загроза застосування БПЛА. Перейдіть в укриття!")           # an air-raid warning
    con.commit(); con.close()
    ids = lambda **k: sorted(p["msg_id"] for p in tg.published(72, **k))
    assert ids(pins=True) == [1]
    assert 2 in ids() and 3 in ids() and 4 not in ids()
