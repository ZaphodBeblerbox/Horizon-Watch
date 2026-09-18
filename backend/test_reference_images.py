"""Reference photographs for ports, airports and vessels — and the rule that
a wrong photo is worse than none."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from services.wikimedia_image_service import (
    _NOT_A_PHOTOGRAPH, _IS_AN_EVENT, _is_about, _candidates, _empty,
)


def test_a_logo_is_not_a_photograph_of_a_place():
    """"Port of Rotterdam" returns the authority's WORDMARK. A logo tells an
    analyst nothing about berth layout, crane count or storage yard, which is
    the entire reason to show a picture of a port."""
    for bad in ("Port_of_Rotterdam_logo.svg", "Port_of_Gdansk_logo.svg",
                "Coat_of_arms_of_Hamburg.png", "Flag_of_Singapore.svg",
                "Netherlands_location_map.png", "Karte_Hamburg.png"):
        assert _NOT_A_PHOTOGRAPH.search(bad), bad


def test_a_real_photograph_passes():
    for good in ("Aerial_photograph_of_the_port_of_Rotterdam_in_2017.jpg",
                 "IMO_9811000_EVER_GIVEN.jpg", "Hamburg,_Hafen_--_2016_--_3126.jpg",
                 "Yamal_2009.JPG"):
        assert not _NOT_A_PHOTOGRAPH.search(good), good


def test_an_event_article_is_not_an_article_about_the_place():
    """Wikipedia search resolves "Leipzig/Halle" to the 2026 drone-attack
    article, whose lead image is wreckage, not the airfield."""
    assert _IS_AN_EVENT.search("2026 Leipzig Airport drone attack")
    assert _IS_AN_EVENT.search("Sinking of the MV Example")
    assert not _IS_AN_EVENT.search("Heathrow Airport")
    assert not _IS_AN_EVENT.search("Port of Singapore")


def test_a_footballer_is_not_an_icebreaker():
    """This actually happened: "Yamal" resolved to Lamine Yamal. Showing an
    analyst a footballer captioned as a vessel is a confident wrong answer,
    and it looks right."""
    footballer = {"title": "Lamine Yamal", "description": "Spanish footballer (born 2007)",
                  "extract": "Lamine Yamal is a Spanish professional footballer."}
    icebreaker = {"title": "Yamal (icebreaker)", "description": "Russian nuclear icebreaker",
                  "extract": "Yamal is a Russian nuclear-powered icebreaker."}
    assert not _is_about(footballer, "vessel")
    assert _is_about(icebreaker, "vessel")


def test_a_city_is_not_a_port():
    city = {"title": "Rotterdam", "description": "City in South Holland, Netherlands",
            "extract": "Rotterdam is a city in the Netherlands."}
    port = {"title": "Port of Rotterdam", "description": "Port in the Netherlands",
            "extract": "The Port of Rotterdam is the largest seaport in Europe."}
    assert not _is_about(city, "port")
    assert _is_about(port, "port")


def test_title_guesses_are_specific_before_generic():
    """A bare facility name collides with the city it sits in."""
    assert _candidates("Rotterdam", "port")[0] == "Port of Rotterdam"
    assert _candidates("Rotterdam", "port")[-1] == "Rotterdam"
    assert _candidates("Heathrow", "airport")[0] == "Heathrow Airport"
    # an already-qualified name is not double-qualified
    assert _candidates("Leipzig/Halle Airport", "airport")[0] == "Leipzig/Halle Airport"


def test_absence_is_reported_not_papered_over():
    """"No photograph found" is a true and useful answer; a stock picture of
    some other port is not."""
    e = _empty("no photograph found")
    assert e["available"] is False
    assert e["image_url"] is None
    assert e["reason"] == "no photograph found"


def test_unknown_kind_does_not_filter_everything_out():
    assert _is_about({"title": "Anything"}, "something_else") is True
