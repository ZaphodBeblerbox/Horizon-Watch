"""Conflict context: a complete baseline, and a 'now' that only says what
the system's own reports say."""
import datetime as dt

import conflict_context as cc

NOW = dt.datetime(2026, 10, 10, tzinfo=dt.timezone.utc)


def test_every_conflict_says_who_why_and_what_is_at_stake():
    seen = set()
    for c in cc.baseline()["conflicts"]:
        assert c["id"] not in seen; seen.add(c["id"])
        for k in ("name", "sides_line", "summary", "since"):
            assert c[k], (c["id"], k)
        assert c["factions"] and all(f["name"] and f["aims"] for f in c["factions"]), c["id"]
        assert c["drivers"] and c["stakes"], c["id"]
        assert all(len(x) == 2 and x.islower() for x in c["countries"]), c["id"]
        assert len(c["center"]) == 2 and c["radius_km"] > 0, c["id"]
    assert {"sudan", "sahel", "drc", "somalia", "ethiopia", "nigeria", "mozambique", "libya", "south_sudan"} <= seen


def _sig(h, country=None, days=1):
    return {"id": h, "headline": h, "location_country": country, "published_at": (NOW - dt.timedelta(days=days)).isoformat()}


def test_reports_are_this_conflicts_and_recent():
    sudan = next(c for c in cc.baseline()["conflicts"] if c["id"] == "sudan")
    got = cc.reports_for(sudan, [_sig("RSF shells El Fasher"), _sig("Flood in Khartoum", "Sudan"),
                                 _sig("RSF old raid", days=30), _sig("Election in Kenya", "Kenya")], NOW)
    assert [r["headline"] for r in got] == ["RSF shells El Fasher", "Flood in Khartoum"]


def test_a_country_is_not_a_conflict_when_narrowed():
    kashmir = next(c for c in cc.baseline()["conflicts"] if c["id"] == "kashmir")
    got = cc.reports_for(kashmir, [_sig("Monsoon rains in Mumbai", "India"), _sig("Firing across the Line of Control", "India")], NOW)
    assert [r["headline"] for r in got] == ["Firing across the Line of Control"]


def test_only_cited_sentences_survive_and_cite_numbers_are_not_shown():
    reports = [{"id": f"r{i}", "headline": f"h{i}", "when": NOW, "source": "x", "url": None} for i in range(3)]
    out = cc.checked({"now": [
        {"text": "RSF fighters shelled El Fasher's last hospital [1][2]", "cites": [1, 2]},
        {"text": "Something nobody reported happened somewhere", "cites": []},
        {"text": "The army retook a town near the border", "cites": [9]},
        {"text": "There are no recent conflict events reported here", "cites": [3]},
    ], "trend": "escalating", "trend_why": "Shelling intensified [1]"}, reports)
    assert [n["text"] for n in out["now"]] == ["RSF fighters shelled El Fasher's last hospital"]
    assert [s["id"] for s in out["now"][0]["sources"]] == ["r0", "r1"]
    assert out["trend_why"] == "Shelling intensified" and out["trend_sources"][0]["id"] == "r0"
    assert cc.checked({"now": []}, reports) is None
