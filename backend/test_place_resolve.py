"""A spoken place → a place in our data and a box sized by what it is
(place_resolve.py), and the voice intent that carries it (voice_ai._clean)."""
import json
import os

import place_resolve as pr
from routers.voice_ai import read_answer

FIX = json.load(open(os.path.join(os.path.dirname(__file__), "tests_fixtures", "places_king_fahd.json")))["candidates"]
CTX = {"people": [], "selected": False, "page": "imagery"}


def test_parse_the_sentence():
    r = pr.parse_request("Generate a watch area around King Fahd Airport")
    assert r == {"place": "King Fahd Airport", "kind": "airport", "size_km": None}
    r = pr.parse_request("create a satellite watch zone around the port of Tartus with 20 km")
    assert r["kind"] == "port" and r["size_km"] == 20.0 and pr.name_tokens(r["place"]) == ["tartus"]
    assert pr.parse_request("watch area around Kherson, 500 km")["size_km"] == pr.MAX_KM       # clamped


def test_king_fahd_airport_is_dammam_and_the_namesakes_are_offered():
    out = pr.resolve(FIX, "Generate a watch area around King Fahd Airport")
    assert out["ok"]
    p = out["place"]
    assert p["name"] == "King Fahd International Airport" and p["code"] == "OEDF"
    assert p["label"] == "King Fahd International Airport (OEDF, Dammam)"
    assert p["size_km"] == pr.SIZE_KM["large_airport"]
    names = [o["name"] for o in out["others"]]
    assert "King Fahd Air Base" in names and "King Fahd Industrial Port" in names
    assert "King Khalid International Airport" not in names            # not every word matches


def test_kind_said_wins_and_size_follows_the_kind():
    out = pr.resolve(FIX, "watch the King Fahd port")
    assert out["place"]["kind"] == "port" and out["place"]["size_km"] == pr.SIZE_KM["port"]
    out = pr.resolve(FIX, "watch area around King Fahd airport with 20 km")
    assert out["place"]["size_km"] == 20.0


def test_the_box_is_the_size_asked_for():
    poly = pr.square(26.4691, 49.798209, 8.0)
    (w, s), _, (e, n) = poly["coordinates"][0][0], None, poly["coordinates"][0][2]
    assert abs((n - s) * 110.574 - 8.0) < 0.01
    import math
    assert abs((e - w) * 111.320 * math.cos(math.radians(26.4691)) - 8.0) < 0.05


def test_nothing_named_or_nothing_found_says_so():
    assert not pr.resolve(FIX, "generate a watch area")["ok"]
    out = pr.resolve(FIX, "watch area around Atlantis airport")
    assert not out["ok"] and "Atlantis" in out["why"]


def test_icao_code_alone_resolves():
    out = pr.resolve(FIX, "watch area around OEDF")
    assert out["ok"] and out["place"]["code"] == "OEDF"


def test_voice_intent_is_checked():
    out = read_answer({"steps": [{"intent": "watch_place", "slots": {"place": "King Fahd Airport", "size_km": "8"}}]}, CTX)
    assert out["ok"] and out["steps"][0]["slots"] == {"place": "King Fahd Airport", "size_km": 8.0}
    # a model cannot hand over coordinates or a silly size
    out = read_answer({"steps": [{"intent": "watch_place", "slots": {"place": "Kherson", "size_km": "900", "lat": 1}}]}, CTX)
    assert out["steps"][0]["slots"] == {"place": "Kherson", "size_km": pr.MAX_KM}
    assert not read_answer({"steps": [{"intent": "watch_place", "slots": {"place": "the airport"}}]}, CTX)["ok"]
