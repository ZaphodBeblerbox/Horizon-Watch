"""Police and crowds moving at a named place are LIVE (owner, Paris, Saturday 2026-10-24).

The production posts of that morning (read-only, /api/telegram/posts?hours=3) were judged not live: no clock in
the text, a deployment was not a police act, "blindé" read as troops, "FLASH" not a present-tense cue. A police
deployment, position or movement, or a crowd moving, at a place the text names, in a post of the last 45 minutes
is a live police (or crowd) item, "relayed, unverified" when nobody says they see it. War reporting stays
troops; a past event and an announcement stay out."""
import datetime as dt
import json
import sqlite3

import pytest

import force_context as fc
import live_incident as li
import live_signals as ls
import openai_gate
import protests as pr
import street_reports as sr
import telegram_ingest as tg
import telegram_signals as ts

NOW = dt.datetime(2026, 10, 24, 9, 40, tzinfo=dt.timezone.utc)

CENTAURE_AN = ("🇫🇷 FLASH - Un blindé CENTAURE de la gendarmerie est déployé devant l’Assemblée nationale, à Paris. "
               "(via @CLPRESSFR)\n\n› Ouvrir sur X")
CENTAURE_AN_AT = "2026-10-24T09:22:45+00:00"
CENTAURE_ELYSEE = ("🇫🇷 FLASH - Des blindés CENTAURE de la gendarmerie sont déployés aux abords du palais de l’Élysée, à Paris. "
                   "(via @CLPRESSFR)\n› Ouvrir sur X")
CENTAURE_ELYSEE_AT = "2026-10-24T08:46:45+00:00"
ME_OBSERVER = ("⚡️ France: Al Mayadeen's correspondent in Paris: Police are moving to change the route of demonstrations "
               "inside Paris, while protesters insist on their demand to organize demonstrations in the capital.")
ME_OBSERVER_AT = "2026-10-24T08:46:40+00:00"
CORTEGE = "Le cortège remonte le boulevard Voltaire vers Nation"
VERS_BASTILLE = "Les manifestants se dirigent vers la place de la Bastille"

WAR = "Des blindés de l'armée russe sont déployés aux abords de Koupiansk, les troupes avancent vers l'ouest"
WAR_EN = "Russian troops and armored vehicles are moving toward Pokrovsk"
WAR_POLICE = "La police militaire russe et des blindés sont déployés à Koupiansk"
HIER = "Hier, des blindés CENTAURE de la gendarmerie étaient déployés devant l’Assemblée nationale, à Paris."
DEMAIN = "Demain, des blindés CENTAURE de la gendarmerie seront déployés devant l’Assemblée nationale, à Paris."

ELYSEE_NOW = dt.datetime(2026, 10, 24, 9, 10, tzinfo=dt.timezone.utc)


# ── the rule ────────────────────────────────────────────────────────────────

def test_the_gendarmeries_armour_is_police_not_troops():
    assert not fc.is_military(CENTAURE_AN, "fr") and not fc.is_military(CENTAURE_ELYSEE, None)
    assert fc.is_military(WAR, None) and fc.is_military(WAR_EN, None)


@pytest.mark.parametrize("text,at,now,place,label", [
    (CENTAURE_AN, CENTAURE_AN_AT, NOW, "Assemblée nationale", "Police deployed"),
    (CENTAURE_ELYSEE, CENTAURE_ELYSEE_AT, ELYSEE_NOW, "Palais de l'Élysée", "Police deployed"),
])
def test_a_relayed_gendarmerie_deployment_with_no_clock_is_a_live_police_item(text, at, now, place, label):
    d = li.presence_decide(text, at, now, "fr")
    assert d["ok"] and d["act"] == "police_intervention" and d["relayed"]
    v = li.presence_verdict(text, at, now, country_code="fr")
    assert v and v["verdict"] == "live" and v["name"] == place and v["level"] == "venue"
    assert v["event_time"] == li.iso(li.parse_utc(at)) and v["audit"]["presence"]["relayed"] is True
    assert li.card_headline(v["act"], v["quote"], v["name"], v["audit"]["verify"]["context"]) == f"{label} at {place}, Paris"


def test_police_moving_inside_a_city_pins_at_the_city_the_post_names():
    row = {"lat": 48.8534951, "lon": 2.3483915, "precision": "city", "place": "Paris, France", "country_code": "fr",
           "geocoded_as": "Paris, Île-de-France, France métropolitaine, France"}
    v = li.presence_verdict(ME_OBSERVER, ME_OBSERVER_AT, ELYSEE_NOW, row=row)
    assert v and v["act"] == "police_intervention" and v["name"] == "Paris" and v["level"] == "city"
    assert li.act_label(v["act"], v["quote"]) == "Police moving"


@pytest.mark.parametrize("text,why", [
    (WAR, ""), (WAR_EN, ""), (WAR_POLICE, "troops"), (HIER, "earlier time"), (DEMAIN, "to come"),
])
def test_war_a_past_event_and_tomorrows_announcement_stay_out(text, why):
    d = li.presence_decide(text, CENTAURE_AN_AT, NOW, None)
    assert not d["ok"] and why in d["why"]
    assert li.presence_verdict(text, CENTAURE_AN_AT, NOW) is None


def test_older_than_45_minutes_is_not_live_by_the_rule():
    d = li.presence_decide(CENTAURE_AN, CENTAURE_AN_AT, li.parse_utc(CENTAURE_AN_AT) + dt.timedelta(minutes=46), "fr")
    assert not d["ok"] and "45" in d["why"]


def test_a_crowd_moving_is_a_crowd_item_with_its_heading():
    v = li.presence_verdict(CORTEGE, CENTAURE_AN_AT, NOW)
    assert v and v["act"] == "crowd_movement" and v["name"] == "Boulevard Voltaire"
    assert v["direction"]["toward_place"] == "Place de la Nation" and v["direction"]["lat"]
    assert li.card_headline(v["act"], v["quote"], v["name"], [], v["direction"]) == \
        "Crowd at Boulevard Voltaire, moving toward Place de la Nation"
    w = li.presence_verdict(VERS_BASTILLE, CENTAURE_AN_AT, NOW)
    assert w and w["act"] == "crowd_movement" and w["name"] == "Place de la Bastille" and w["direction"]["heading_only"]
    assert li.card_headline(w["act"], w["quote"], w["name"], [], w["direction"]) == "Crowd heading to Place de la Bastille"


def test_the_gazetteer_finds_the_elysee_after_du():
    assert sr.place_in("aux abords du palais de l’Élysée")["name"] == "Palais de l'Élysée"
    assert sr.place_in("le président de la République a dit") is None


def test_the_strict_gate_is_unchanged_for_everything_else():
    # an act that is not a movement keeps the clock rule
    assert li.presence_decide("Des tirs de LBD place de la République", CENTAURE_AN_AT, NOW)["ok"] is False
    assert li.presence_decide("Macron parle de la police", CENTAURE_AN_AT, NOW)["ok"] is False


# ── the pass, the model's rejection, and what readers get ──────────────────

@pytest.fixture
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "akili.db")
    monkeypatch.setattr(tg, "_db_path", lambda: path)
    monkeypatch.setattr(ts, "chat_context", lambda chan: {"country": "fr", "region": "Paris"})
    monkeypatch.setattr(openai_gate, "_QUOTA", {"until": 0.0, "since": None, "hits": 0, "last": None})
    return path


def _post(mid, text, at, chan="AlertesInfos", **cols):
    con = tg._con()
    con.execute("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, chat_kind, role)"
                " VALUES (?,?,?,?,?,?,?,?)", (chan, mid, chan, at, text, "none", "channel", "aggregator"))
    for k, v in cols.items():
        con.execute(f"UPDATE telegram_posts SET {k}=? WHERE msg_id=?", (v, mid))
    con.commit()
    con.close()


def _row(path, mid):
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    r = dict(con.execute("SELECT * FROM telegram_posts WHERE msg_id=?", (mid,)).fetchone())
    con.close()
    return r


REJECTED = {"is_live": False, "event_type": "troops_sighted", "event_time": None, "certainty": "unverified",
            "location": None, "other_places_mentioned": [], "ambiguity_note": None, "evidence_quote_time": None,
            "evidence_quote_place": None, "evidence_quote_act": None, "first_hand": False, "reject_class": "news",
            "reject_reason": "the event time cannot be established from the text", "direction": None}


def test_the_pass_pins_the_paris_posts_without_a_model_call_and_readers_see_police(db):
    _post(10485, CENTAURE_AN, CENTAURE_AN_AT)
    _post(10490, WAR, "2026-10-24T09:30:00+00:00")
    _post(10491, HIER, "2026-10-24T09:31:00+00:00")
    calls = []

    def ext(text, *a):
        calls.append(text)
        return dict(REJECTED), 0.0007
    li.run_once(now=NOW, extract_fn=ext, geocode=lambda q: [])
    r = _row(db, 10485)
    assert r["live_verdict"] == "live" and r["event_time"] == "2026-10-24T09:22:45+00:00"
    assert (round(r["lat"], 3), r["precision"], r["event_type"]) == (48.862, "site", "unrest")
    assert r["headline"] == "Police deployed at Assemblée nationale, Paris"
    assert CENTAURE_AN not in calls                       # decided by the code, no model call spent
    assert _row(db, 10490)["live_verdict"] != "live" and _row(db, 10491)["live_verdict"] != "live"
    assert li.live_fields(r, NOW)["live"] is True
    assert li.live_fields(r, li.parse_utc(CENTAURE_AN_AT) + dt.timedelta(minutes=50))["live"] is False   # 45 min window
    # the live signals layer
    con = tg._con()
    try:
        atoms = ls.read_atoms(con, NOW - dt.timedelta(hours=3))
    finally:
        con.close()
    sig = [s for s in ls.build(atoms, now=NOW) if s["channel"] == "AlertesInfos"]
    assert len(sig) == 1 and sig[0]["act"] == "police_intervention" and sig[0]["live"]
    assert sig[0]["corroboration"]["line"] == "Relayed, unverified" and sig[0]["corroboration"]["relayed"]
    assert sig[0]["title"] == "Police deployed at Assemblée nationale, Paris" and not sig[0]["muted"]
    # /api/protests?frame=live: a police item
    out = pr.build(signals_day=ls.build(atoms, now=NOW, live_only=False), street_day=[], protests=[], announcements=[], now=NOW)
    pol = [i for i in out["live"] if i["kind"] == "police"]
    assert len(pol) == 1 and pol[0]["title"] == "Police deployed at Assemblée nationale, Paris"
    assert pol[0]["line"] == "Relayed, unverified" and pol[0]["live"]


def test_a_model_rejection_for_want_of_a_clock_is_overridden_with_the_models_place(db):
    """A place the gazetteer does not know: the model's location, geocoded, carries the movement."""
    text = "FLASH - Les CRS se positionnent devant la préfecture de Nantes (via @actu)"
    _post(20, text, "2026-10-24T09:30:00+00:00")
    raw = dict(REJECTED, location={"name_as_written": "préfecture de Nantes", "name_for_geocoder": None, "level": "venue",
                                   "context_as_written": []})
    nantes = [{"lat": 47.2175, "lon": -1.5536, "display_name": "Préfecture de Nantes, Nantes, France", "class": "amenity",
               "type": "townhall", "place_rank": 30, "address": {"amenity": "Préfecture", "city": "Nantes"}, "country_code": "fr"}]
    li.run_once(now=NOW, extract_fn=lambda *a: (raw, 0.0007), geocode=lambda q: nantes)
    r = _row(db, 20)
    assert r["live_verdict"] == "live" and r["lat"] == 47.2175 and r["headline"].startswith("Police deployed at préfecture de Nantes")
    audit = json.loads(r["live_json"])
    assert audit["presence"]["place_by"] == "model location" and "model" in (audit.get("model_rejected") or "model")


def test_the_model_vetoes_a_recap_or_a_past_story(db):
    text = "FLASH - Les CRS se positionnent devant la préfecture de Nantes"
    raw = dict(REJECTED, reject_class="recap", location={"name_as_written": "préfecture de Nantes", "name_for_geocoder": None,
                                                         "level": "venue", "context_as_written": []})
    d = li.decide(raw, text, "2026-10-24T09:30:00+00:00", NOW, geocode=lambda q: [])
    assert d["verdict"].startswith("rejected")


def test_the_model_reads_troops_the_code_reads_the_gendarmerie(db):
    raw = {"is_live": True, "event_type": "troops_sighted", "event_time": "2026-10-24T09:22:00Z", "certainty": "unverified",
           "location": {"name_as_written": "Assemblée nationale", "name_for_geocoder": None, "level": "venue",
                        "context_as_written": ["Paris"]},
           "other_places_mentioned": [], "ambiguity_note": None, "evidence_quote_time": "est déployé",
           "evidence_quote_place": "devant l’Assemblée nationale", "evidence_quote_act": "Un blindé CENTAURE de la gendarmerie",
           "first_hand": False, "reject_class": None, "reject_reason": None, "direction": None}
    d = li.decide(raw, CENTAURE_AN, CENTAURE_AN_AT, NOW, geocode=lambda q: [])
    assert d["verdict"] == "live" and d["act"] == "police_intervention"


def test_the_rule_path_with_the_model_out_reads_movements_too(db, monkeypatch):
    import telegram_rules
    _post(30, CORTEGE, "2026-10-24T09:35:00+00:00", chan="GJ2026IDF")
    monkeypatch.setattr(telegram_rules, "resolve", lambda x, b=None: (None, None, None, "no place"))
    real_now = dt.datetime.now(dt.timezone.utc)
    con = tg._con()
    try:
        con.execute("UPDATE telegram_posts SET posted_at=? WHERE msg_id=30", (li.iso(real_now - dt.timedelta(minutes=3)),))
        con.commit()
        row = con.execute("SELECT channel, channel_title, text, msg_id, role, party, media, posted_at, topic_id, topic_title,"
                          " chat_kind FROM telegram_posts WHERE msg_id=30").fetchone()
        tg.classify_by_rules(con, [row])
    finally:
        con.close()
    r = _row(db, 30)
    assert r["live_verdict"] == "rule-live" and r["headline"] == "Crowd at Boulevard Voltaire, moving toward Place de la Nation"
    a = ls.atom_of(r)
    assert a and a["act"] == "crowd_movement" and a["direction"]["toward_place"] == "Place de la Nation"


def test_backfill_rereads_the_morning_posts_the_model_turned_down(db):
    """The Centaure posts of 2026-10-24 were rejected before the rule existed: the backfill writes them as the rule
    would have then (live in their own 45 minutes, so they are in Today), with no model call; idempotent."""
    _post(10485, CENTAURE_AN, CENTAURE_AN_AT, live_checked=1, live_verdict="not live: no time", live_cost=0.0007)
    _post(10490, WAR, "2026-10-24T09:30:00+00:00", live_checked=1, live_verdict="not live")
    later = li.parse_utc(CENTAURE_AN_AT) + dt.timedelta(hours=3)
    out = li.backfill_presence(now=later)
    assert out["live"] == 1
    r = _row(db, 10485)
    assert r["live_verdict"] == "live" and r["event_time"] == "2026-10-24T09:22:45+00:00"
    assert r["headline"] == "Police deployed at Assemblée nationale, Paris"
    assert li.live_fields(r, later)["live"] is False and li.live_fields(r, later)["live_state"] == "past"
    assert _row(db, 10490)["live_verdict"] != "live"
    assert li.backfill_presence(now=later)["live"] == 0
