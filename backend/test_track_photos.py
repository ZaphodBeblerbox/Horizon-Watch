"""
Aircraft and ship photographs: right source, right credit, cached, and no
personal data in the outbound request.
"""
import json
import time
import urllib.parse

import pytest

from services import track_photos as tp


class _Resp:
    def __init__(self, body):
        self._b = json.dumps(body).encode()

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


PS_HIT = {"photos": [{
    "id": "1", "thumbnail": {"src": "https://t.plnspttrs.net/1_t.jpg"},
    "thumbnail_large": {"src": "https://t.plnspttrs.net/1_280.jpg"},
    "link": "https://www.planespotters.net/photo/1/ei-dcl", "photographer": "Jane Spotter",
}]}
WD_SEARCH = {"query": {"search": [{"title": "Q104378621"}]}}
WD_CLAIMS = {"claims": {"P18": [{"rank": "preferred", "mainsnak": {"datavalue": {"value": "Ever Given 01.jpg"}}}]}}
COMMONS_FILE = {"query": {"pages": {"1": {"title": "File:Ever Given 01.jpg", "imageinfo": [{
    "url": "https://upload.wikimedia.org/x/Ever_Given_01.jpg",
    "thumburl": "https://upload.wikimedia.org/x/800px-Ever_Given_01.jpg",
    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Ever_Given_01.jpg",
    "extmetadata": {"Artist": {"value": '<a href="//commons.wikimedia.org/wiki/User:Kees">Kees Torn</a>'},
                    "LicenseShortName": {"value": "CC BY-SA 2.0"},
                    "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/2.0"}},
}]}}}}


@pytest.fixture
def net(monkeypatch, tmp_path):
    """Route outbound URLs to canned answers; record every Request."""
    tp.reset_cache(tmp_path / "cache.json")
    seen = []
    routes = {}

    def fake_urlopen(req, timeout=None):
        seen.append(req)
        url = req.full_url
        for frag, body in routes.items():
            if frag in urllib.parse.unquote_plus(url):
                if isinstance(body, Exception):
                    raise body
                return _Resp(body)
        return _Resp({"photos": []} if "planespotters" in url else {})

    monkeypatch.setattr(tp.urllib.request, "urlopen", fake_urlopen)
    yield routes, seen
    tp.reset_cache(None)


def test_aircraft_by_hex_carries_planespotters_credit(net):
    routes, seen = net
    routes["photos/hex/4ca87c"] = PS_HIT
    r = tp.aircraft_photo("adsb-4CA87C")
    assert r["available"] and r["matched_by"] == "icao24"
    assert r["thumbnail_url"] == "https://t.plnspttrs.net/1_280.jpg"   # hotlinked, never re-hosted
    assert r["photographer"] == "Jane Spotter"
    assert r["link_url"].startswith("https://www.planespotters.net/photo/")
    assert r["source"] == "planespotters.net"


def test_aircraft_falls_back_to_registration(net):
    routes, _ = net
    routes["photos/reg/EI-DCL"] = PS_HIT
    r = tp.aircraft_photo("4ca87c", "ei-dcl")
    assert r["available"] and r["matched_by"] == "registration"


def test_vessel_by_imo_from_wikidata_with_licence(net):
    routes, _ = net
    routes["haswbstatement:P458=9811000"] = WD_SEARCH
    routes["wbgetclaims"] = WD_CLAIMS
    routes["File:Ever Given 01.jpg"] = COMMONS_FILE
    r = tp.vessel_photo("IMO 9811000")
    assert r["available"] and r["matched_by"] == "imo"
    assert r["photographer"] == "Kees Torn"            # HTML stripped
    assert r["licence"] == "CC BY-SA 2.0"
    assert r["licence_url"].startswith("https://creativecommons.org/")
    assert r["link_url"].startswith("https://commons.wikimedia.org/wiki/File:")
    assert r["thumbnail_url"].endswith("800px-Ever_Given_01.jpg")


def test_vessel_needs_a_valid_imo(net):
    _, seen = net
    assert tp.vessel_photo(None)["available"] is False
    bad = tp.vessel_photo("9811001")                    # wrong check digit
    assert bad["available"] is False and "check digit" in bad["reason"]
    assert seen == []                                   # nothing went out
    assert tp.valid_imo("9811000") == "9811000"
    assert tp.valid_imo("9074729") == "9074729"


def test_ambiguous_wikidata_match_is_no_match(net):
    routes, _ = net
    routes["haswbstatement:P458=9811000"] = {"query": {"search": [{"title": "Q1"}, {"title": "Q2"}]}}
    assert tp.vessel_photo("9811000")["available"] is False


def test_positive_cached_seven_days_negative_one(net, monkeypatch):
    routes, seen = net
    routes["photos/hex/4ca87c"] = PS_HIT
    tp.aircraft_photo("4ca87c")
    n = len(seen)
    tp.aircraft_photo("4ca87c")
    assert len(seen) == n                               # served from cache

    tp.aircraft_photo("aaaaaa")                          # a miss
    n = len(seen)
    tp.aircraft_photo("aaaaaa")
    assert len(seen) == n                               # the miss is cached too

    # the file survives a restart
    tp.reset_cache(tp._path())
    tp.aircraft_photo("4ca87c")
    assert len(seen) == n

    real = time.time
    monkeypatch.setattr(tp.time, "time", lambda: real() + 2 * 86400)
    tp.aircraft_photo("aaaaaa")                          # negative expired after 1 day
    assert len(seen) > n
    n = len(seen)
    tp.aircraft_photo("4ca87c")                          # positive still good at 2 days
    assert len(seen) == n
    monkeypatch.setattr(tp.time, "time", lambda: real() + 8 * 86400)
    tp.aircraft_photo("4ca87c")
    assert len(seen) > n


def test_network_failure_is_not_cached(net):
    routes, seen = net
    routes["photos/hex/4ca87c"] = OSError("timeout")
    r = tp.aircraft_photo("4ca87c")
    assert r["available"] is False and "did not answer" in r["reason"]
    routes["photos/hex/4ca87c"] = PS_HIT
    assert tp.aircraft_photo("4ca87c")["available"] is True


def test_outbound_ceiling(net, monkeypatch):
    monkeypatch.setattr(tp, "MAX_PER_MINUTE", 2)
    tp.aircraft_photo("000001")
    tp.aircraft_photo("000002")
    r = tp.aircraft_photo("000003")
    assert r["available"] is False and "rate-limited" in r["reason"]


def test_no_email_or_personal_data_in_requests(net):
    routes, seen = net
    routes["photos/hex/4ca87c"] = PS_HIT
    routes["haswbstatement:P458=9811000"] = WD_SEARCH
    routes["wbgetclaims"] = WD_CLAIMS
    routes["File:Ever Given 01.jpg"] = COMMONS_FILE
    tp.aircraft_photo("4ca87c", "EI-DCL")
    tp.vessel_photo("9811000")
    assert seen
    for req in seen:
        for k, v in req.header_items():
            assert "@" not in v, f"{k} carries an address: {v}"
        assert "@" not in req.full_url
        assert req.get_header("User-agent") == tp.USER_AGENT
    assert "@" not in tp.USER_AGENT and "http" in tp.USER_AGENT


def test_endpoints_registered_and_run_off_the_loop():
    src = open("main.py").read()
    for route, fn in (("/api/photos/aircraft", "aircraft_photo"), ("/api/photos/vessel", "vessel_photo")):
        i = src.index(f'@app.get("{route}")')
        body = src[i:i + 1200]
        assert "run_in_executor" in body and fn in body
