"""Police is not the military (owner, 2026-10-23): war reporting never becomes a police act."""
import datetime as dt

import pytest

import force_context as fc
import live_incident as li
import live_signals as ls
import street_reports as sr

NOW = dt.datetime(2026, 10, 23, 16, 0, tzinfo=dt.timezone.utc)

MILITARY_POSTS = [
    # the production row behind "Police moving in at Palamarevka" (southfronteng/64842, 2026-10-22)
    ("Russian Army expands control west of Kupyansk, taking Moskovka and Malaya Shapkovka. Units advance on Palamarevka.", "ua"),
    ("Колона техніки ЗСУ рухається через Покровськ, бригада відходить на нові позиції", "ua"),
    ("Колонна ВСУ замечена у Купянска, бронетехника движется на запад", "ru"),
    ("Ukrainian troops moving in to reinforce positions near Chasiv Yar, armoured vehicles seen on the road", "ua"),
    ("Des soldats et des blindés russes arrivent à Koupiansk, la colonne avance vers l'ouest", None),
    ("Reinforcements arriving at the checkpoint north of Khan Younis, IDF tanks deployed", "ps"),
    ("Police and SBU units deployed in Kharkiv after the strike", "ua"),
]
POLICE_POSTS = [
    ("Les CRS chargent les manifestants place de la République, ça gaze de partout", "fr"),
    ("La BAC arrive en masse à Châtelet, les flics se positionnent devant le cortège", "fr"),
    ("Nasse en cours à Bastille, les gendarmes bloquent toutes les sorties", "fr"),
    ("Polizei setzt Wasserwerfer gegen Demonstranten am Alexanderplatz ein", "de"),
]


@pytest.mark.parametrize("text,cc", MILITARY_POSTS)
def test_war_reporting_is_military_never_police(text, cc):
    assert fc.is_military(text, cc)
    assert not fc.is_police(text, cc)
    assert not fc.police_act_ok(text, cc)


@pytest.mark.parametrize("text,cc", POLICE_POSTS)
def test_french_police_at_protest_is_police(text, cc):
    assert not fc.is_military(text, cc)
    assert fc.is_police(text, cc)


def _post(text, cc=None, chan="southfronteng"):
    return {"channel": chan, "msg_id": 64842, "posted_at": (NOW - dt.timedelta(minutes=5)).isoformat(), "text": text,
            "media": "none", "lat": None, "lon": None, "precision": None, "place": None, "country_code": cc}


def test_street_reports_drop_the_front():
    """The model's 'advance' and 'clashes' at Ukrainian villages were 'Police moving in' and 'Police charge'."""
    text = MILITARY_POSTS[0][0]
    sits = [{"kind": "advance", "place": "Palamarevka, Kharkiv Oblast, Ukraine", "country": "ua", "lat": 49.7, "lon": 37.5,
             "precision": "site"},
            {"kind": "clashes", "place": "Kupyansk, Ukraine", "country": "ua", "lat": 49.71, "lon": 37.61, "precision": "site"}]
    assert sr.read_post(_post(text, "ua"), sits) == []


def test_street_reports_troops_word_is_not_police():
    assert not any(k["kind"] == "police_arrival" for k in sr.tactics("des soldats arrivent en masse"))
    assert not any(k["kind"] == "police_arrival" for k in sr.tactics("troops are arriving"))


def test_street_reports_keep_french_police():
    reps = sr.read_post({**_post("ça nasse à Répu, les CRS bloquent tout", "fr", "GJ2026IDF")}, chat_city="Paris", protest_chat=True)
    assert any(r["kind"] == "kettle" for r in reps)


def test_situation_reinforcements_need_police_words():
    sits = [{"kind": "reinforcements", "place": "Place de la République, Paris, France", "country": "fr", "lat": 48.8674,
             "lon": 2.3636, "precision": "site"}]
    with_police = sr.read_post(_post("Des renforts de CRS arrivent à République", "fr", "GJ2026IDF"), sits, chat_city="Paris")
    assert any(r["kind"] == "police_arrival" for r in with_police)
    without = sr.read_post(_post("Des renforts arrivent", "fr", "GJ2026IDF"), sits, chat_city="Paris")
    assert not any(r["kind"] == "police_arrival" for r in without)


def test_rule_path_police_words_in_war_reporting_are_not_police():
    d = li.rule_decide("BREAKING: tear gas and troops now at the checkpoint, IDF tanks moving", (NOW - dt.timedelta(minutes=2)).isoformat(), NOW)
    assert d["act"] != "police_intervention"


def test_model_police_answer_in_war_text_becomes_troops():
    text = "Колона техніки ЗСУ зараз рухається через Покровськ"
    raw = {"event_type": "police_intervention", "certainty": "unverified", "evidence_quote_time": "зараз",
           "evidence_quote_place": "Покровськ", "evidence_quote_act": "Колона техніки ЗСУ",
           "location": {"name_as_written": "Покровськ", "level": "city", "context": []}}
    v = li.verify(raw, text, (NOW - dt.timedelta(minutes=2)).isoformat(), NOW)
    assert v["act"] != "police_intervention"


def test_live_signal_atom_rereads_old_police_rows_of_the_front():
    import json
    row = {"channel": "southfronteng", "msg_id": 1, "posted_at": NOW.isoformat(), "text": MILITARY_POSTS[3][0],
           "lat": 48.6, "lon": 38.0, "event_time": NOW.isoformat(), "live_verdict": "live", "country_code": "ua",
           "live_json": json.dumps({"verify": {"act": "police_intervention", "name": "Chasiv Yar", "context": []}})}
    a = ls.atom_of(row)
    assert a and a["act"] == "troops_sighted"
