"""Per-user priority (DATAMINR_PLAN §4d table, B2): Critical / Urgent / Alert from the act, corroboration and how
near the user's assets, theaters and countries it is."""
import pytest

import events as ev

OFFICE = {"lat": 48.8600, "lon": 2.3500, "radius": 10.0, "name": "HQ", "label": "office"}
USER = {"assets": [OFFICE], "theaters": [{"lat": 48.86, "lon": 2.35, "reach": 350.0, "name": "Paris Watch", "id": "t1"}],
        "countries": {"germany"}, "topics": set(), "alerts": {}}


def E(act="explosion", level="unverified", n=1, lat=48.8600, lon=2.3500, cc="fr", status="developing"):
    return {"id": "ev_x", "act": act, "lat": lat, "lon": lon, "country_code": cc, "status": status,
            "corroboration": {"level": level, "n_independent": n}}


@pytest.mark.parametrize("event,want", [
    (E("explosion", "corroborated", 2, lat=48.90), "flash"),                 # high-impact, corroborated, in the asset circle
    (E("explosion", "eyewitness", 1, lat=48.90), "flash"),
    (E("arrest", "unverified", 1, lat=48.865), "flash"),                     # any act within 2 km of an asset
    (E("troops_sighted", "unverified", 1, lat=48.865), "urgent"),            # troops are not
    (E("explosion", "unverified", 1, lat=48.92), "urgent"),                  # uncorroborated high impact in an asset circle
    (E("crowd_movement", "unverified", 1, lat=48.92), "urgent"),             # any act inside an asset circle
    (E("explosion", "unverified", 3, lat=49.5), "flash"),                    # 3+ sources in a theater
    (E("explosion", "corroborated", 2, lat=49.5), "urgent"),                 # corroborated high impact in a theater
    (E("explosion", "unverified", 1, lat=49.5), "alert"),                    # uncorroborated in a theater
    (E("crowd_movement", "corroborated", 2, lat=49.5), "alert"),             # not high impact
    (E("explosion", "eyewitness", 1, lat=52.52, lon=13.40, cc="de"), "urgent"),   # a watched country
    (E("explosion", "unverified", 1, lat=52.52, lon=13.40, cc="de"), "alert"),
    (E("explosion", "corroborated", 3, lat=48.86, status="ended"), "alert"),       # ended: never above Alert
])
def test_the_priority_table(event, want, monkeypatch):
    monkeypatch.setattr("user_concern._country_name", lambda cc: {"de": "Germany", "fr": "France"}.get(cc))
    assert ev.priority_for(event, USER)["priority"] == want


def test_outside_the_profile_there_is_no_priority(monkeypatch):
    monkeypatch.setattr("user_concern._country_name", lambda cc: "Ukraine")
    assert ev.priority_for(E(lat=50.45, lon=30.52, cc="ua"), USER) is None


def test_priority_says_why_and_how_far():
    p = ev.priority_for(E("arrest", lat=48.865), USER)
    assert p["scope"] == "asset" and p["km"] < 1 and "HQ" in p["why"] and p["label"] == "Critical" and p["sev"] == "critical"
    t = ev.priority_for(E("explosion", lat=49.5), USER)
    assert t["scope"] == "theater" and t["theater_id"] == "t1"


def test_thresholds_compare_in_order():
    assert ev.at_least("flash", "urgent") and ev.at_least("urgent", "urgent") and not ev.at_least("alert", "urgent")
    assert not ev.at_least(None, "alert")
