"""watch_gate: model calls only for posts someone watches (owner, 2026-10-23)."""
import datetime as dt

import pytest

import live_incident as li
import openai_gate
import telegram_ingest as tg
import telegram_signals as ts
import watch_gate as wg
from test_live_incident import NOW, PUB, REPUBLIQUE, TEXT, _post, _row, good

FAKE_COUNTRY = {(48, 2): "France", (49, 2): "France", (41, 12): "Italy", (50, 30): "Ukraine"}


def fake_country_at(lat, lon):
    return FAKE_COUNTRY.get((int(lat), int(lon)))


PARIS_USER = {"assets": [{"lat": 48.8687, "lon": 2.3712, "radius": 30.0, "name": "where you are", "me": True}],
              "theaters": [{"lat": 48.86, "lon": 2.354, "reach": 350.0, "name": "Paris Watch"}],
              "countries": set(), "topics": set(), "only_mine": None}


def union(*concerns):
    return wg.build(list(concerns), country_at=fake_country_at)


def test_union_is_built_once_from_every_profile_and_ignores_empty_ones():
    w = union(PARIS_USER, {"assets": [], "theaters": [], "countries": set(), "topics": set()})
    assert not w["open"] and w["users_with_profile"] == 1
    assert "france" in w["countries"] and "italy" not in w["countries"]
    assert any(p["focus"] for p in w["points"])


def test_no_profile_anywhere_leaves_the_gate_open():
    assert union()["open"]
    assert wg.judge({"text": "anything"}, union())[0]


def test_a_french_chat_is_watched_an_italian_one_is_not():
    w = union(PARIS_USER)
    assert wg.judge({"text": "corteo a Roma adesso"}, w, chat_country="fr")[0]
    ok, _f, why = wg.judge({"text": "corteo a Roma adesso, polizia in piazza"}, w, chat_country="it")
    assert not ok and "outside" in why


def test_a_named_square_in_paris_is_a_focus_post():
    w = union(PARIS_USER)
    ok, focus, _ = wg.judge({"text": "Les CRS chargent à République maintenant"}, w, chat_country=None)
    assert ok and focus


def test_a_post_with_no_hint_is_not_watched():
    ok, _f, why = wg.judge({"text": "breaking: something happened"}, union(PARIS_USER), chat_country=None)
    assert not ok and "no place" in why


def test_run_once_spends_no_model_call_on_unwatched_posts(tmp_path, monkeypatch):
    path = str(tmp_path / "akili.db")
    monkeypatch.setattr(tg, "_db_path", lambda: path)
    monkeypatch.setattr(openai_gate, "_QUOTA", {"until": 0.0, "since": None, "hits": 0, "last": None})
    for k in ("model_calls", "skipped_not_watched", "focus_first"):
        monkeypatch.setitem(li.STATUS, k, 0)
    cc = {"LeGrandQG": "fr", "ItaliaLive": "it"}
    monkeypatch.setattr(ts, "chat_context", lambda chan: {"country": cc.get(chan), "region": None})
    _post(1, text=TEXT, chan="LeGrandQG")
    _post(2, text="BREAKING: la polizia carica i manifestanti adesso in piazza del Popolo a Roma", chan="ItaliaLive")
    calls = []
    out = li.run_once(now=NOW, extract_fn=lambda *a: calls.append(a) or (good(), 0.0007), geocode=REPUBLIQUE,
                      watch=union(PARIS_USER))
    assert len(calls) == 1 and "République" in calls[0][0]
    assert out["not_watched"] == 1 and li.STATUS["skipped_not_watched"] == 1 and li.STATUS["model_calls"] == 1
    assert _row(path, 2)["live_verdict"].startswith("skipped: not watched")
    st = li.status()
    assert "watch_gate" in st and st["skipped_not_watched"] == 1
