"""The country risk index as a cross-reference of four source families
(risk_crossref.py, owner 2026-10-18): GDELT, news (RSS), Telegram and
GeoConfirmed, each visible, corroboration raising confidence, and no single
family able to carry a country to the top band."""
import risk_crossref as rx


def _gdelt(tone=80.0, share=0.5, n=200):
    return {"components": {
        "vol": {"score": None, "status": "insufficient_history"},
        "tone": {"score": tone, "status": "ok", "mean_tone": -(tone / 5 - 10), "n_events": n},
        "gold": {"score": share * 100, "status": "ok", "share_below_threshold": share, "n_events": n},
    }}


RSS_HOT = {"total": 200, "conflict": 90, "unrest": 40, "outlets": 30,
           "sources": [{"source": "A", "n": 50}, {"source": "B", "n": 40}]}
TG_HOT = {"reports": 400, "report_channels": 12, "mood_n": 300, "mood_tension_sum": 600,
          "mood_calls": 90, "mood_channels": 15}


def test_one_family_alone_cannot_reach_the_top_band():
    # GDELT at its maximum, nothing else observed.
    r = rx.score_country("XXX", _gdelt(100, 1.0, 1000), None, None, None)
    assert r["families"]["gdelt"]["score"] == 100
    assert r["corroborating"] == ["gdelt"]
    assert r["score"] < 60 and r["band"] <= 3
    assert r["capped"] and r["confidence"] == "low"


def test_any_single_family_is_capped_below_band_4():
    for fam in ("rss", "telegram", "geoconfirmed"):
        args = {"rss": (None, RSS_HOT, None, None), "telegram": (None, None, TG_HOT, None),
                "geoconfirmed": (None, None, None, 500)}[fam]
        r = rx.score_country("XXX", *args)
        assert r["corroborating"] == [fam], fam
        assert r["band"] <= 3, (fam, r["score"])


def test_two_agreeing_families_stop_below_band_5():
    r = rx.score_country("XXX", _gdelt(100, 1.0, 1000), RSS_HOT, None, None)
    assert set(r["corroborating"]) == {"gdelt", "rss"}
    assert r["confidence"] == "medium"
    assert r["score"] < 78 and r["band"] == 4


def test_three_agreeing_families_can_reach_the_top_band():
    r = rx.score_country("XXX", _gdelt(100, 1.0, 1000), RSS_HOT, TG_HOT, 500)
    assert len(r["corroborating"]) >= 3
    assert r["confidence"] == "high"
    assert not r["capped"]
    assert r["band"] == 5


def test_corroboration_raises_the_score_of_the_same_evidence():
    alone = rx.score_country("XXX", _gdelt(95, 0.8, 500), None, None, None)
    with_news = rx.score_country("XXX", _gdelt(95, 0.8, 500), RSS_HOT, None, None)
    assert with_news["score"] > alone["score"]


def test_breakdown_lists_every_family_with_counts_and_contributions():
    r = rx.score_country("XXX", _gdelt(), RSS_HOT, TG_HOT, 12)
    assert set(r["families"]) == {"gdelt", "rss", "telegram", "geoconfirmed"}
    for f, d in r["families"].items():
        for key in ("label", "score", "count", "window_days", "corroborates", "summary", "evidence_weight"):
            assert key in d, (f, key)
    assert r["families"]["rss"]["count"] == 200
    assert r["families"]["telegram"]["voices"] == 15
    assert r["families"]["geoconfirmed"]["count"] == 12
    # contributions add up to the index (incl. the calm baseline)
    assert abs(sum(r["contributions"].values()) - r["score"]) < 0.1
    assert r["components"] is r["families"]


def test_a_family_with_no_observation_is_left_out_not_read_as_calm():
    hot = rx.score_country("XXX", _gdelt(90, 0.7, 300), RSS_HOT, None, None)
    assert hot["families"]["telegram"]["score"] is None
    assert hot["families"]["telegram"]["status"] == "no_posts"
    assert "telegram" not in hot["weights_used"]


def test_thin_evidence_is_pulled_toward_calm():
    thin = rx.score_country("XXX", _gdelt(80, 0.5, 2), None, None, None)
    full = rx.score_country("XXX", _gdelt(80, 0.5, 400), None, None, None)
    # the same family reading on 2 events stays out of band 3 (42+)
    assert thin["score"] < 42 and thin["band"] <= 2
    assert full["score"] > thin["score"] + 15


def test_a_single_channel_cannot_corroborate():
    one = dict(TG_HOT, report_channels=1, mood_channels=1)
    r = rx.score_country("XXX", None, None, one, None)
    assert r["families"]["telegram"]["score"] >= rx.CORROBORATES_AT["telegram"]
    assert not r["families"]["telegram"]["corroborates"]


def test_telegram_alarms_count_without_volume():
    quiet = rx.telegram_family({"mood_n": 30, "mood_tension_sum": 15, "mood_calls": 1, "mood_channels": 4})
    alarmed = rx.telegram_family({"mood_n": 30, "mood_tension_sum": 15, "mood_calls": 1, "mood_channels": 4,
                                  "unrest_level": "High", "conflict_rising": True, "violence_calls": 4})
    assert alarmed["score"] > quiet["score"] + 30
    assert "demonstrations high" in alarmed["summary"]


def test_rss_judges_own_press_against_its_own_share():
    # Same share of violence; a country's own press writes about everything,
    # so 15 % there is as alarming as 36 % in foreign press.
    foreign = rx.rss_family({"total": 100, "conflict": 36, "unrest": 0, "outlets": 5})
    domestic = rx.rss_family({"total": 100, "conflict": 15, "unrest": 0, "outlets": 5,
                              "domestic_total": 100, "domestic_conflict": 15})
    assert abs(foreign["detail"]["share_score"] - domestic["detail"]["share_score"]) < 1


def test_score_all_only_scores_observed_countries():
    rows = rx.score_all([{"iso_code": "AAA", **_gdelt()}], {"BBB": 4}, {"CCC": RSS_HOT}, {"DDD": TG_HOT})
    assert {r["iso_code"] for r in rows} == {"AAA", "BBB", "CCC", "DDD"}
    assert all(r["score"] is not None for r in rows)


def test_weights_move_the_mix():
    base = rx.score_country("XXX", _gdelt(100, 1.0, 1000), RSS_HOT, None, None)
    heavy = rx.score_country("XXX", _gdelt(100, 1.0, 1000), RSS_HOT, None, None,
                             weights={"gdelt": 0.9, "rss": 0.05})
    assert heavy["weights_used"]["gdelt"] > base["weights_used"]["gdelt"]
