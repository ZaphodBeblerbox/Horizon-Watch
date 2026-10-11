"""Calls for armed conflict rising on Telegram (telegram_mood_alert.py): a
rise needs volume, several channels and a real jump on the two weeks before;
one viral post does not make one; one alert per country per day; the title
says where and how much; the notification says which of the user's assets
or theaters it concerns."""
import datetime as dt

import event_watch as ew
import notification_context as nc
import telegram_mood_alert as tma

NOW = dt.datetime(2026, 10, 11, 12, tzinfo=dt.timezone.utc)
_n = [0]


def post(hours_ago, *, cc="sd", ch="chan1", t=0, m=0, text=None):
    _n[0] += 1
    at = NOW - dt.timedelta(hours=hours_ago)
    return {"channel": ch, "msg_id": _n[0], "channel_title": ch.title(), "posted_at": at.isoformat(),
            "text": text or f"post number {_n[0]} about the situation", "summary_en": None,
            "mood_country": cc, "mood_tension": t, "mood_mobilise": m}


def baseline(cc="sd"):
    """Two weeks before: ten posts a day, a call for conflict every other day."""
    rows = []
    for d in range(14):
        for k in range(10):
            call = (k == 0 and d % 2 == 0)
            rows.append(post(30 + d * 24 + k, cc=cc, ch=f"base{k % 4}", m=3 if call else 0))
    return rows


def surge(calls=12, channels=5, posts=30, cc="sd"):
    rows = [post(1 + i % 20, cc=cc, ch=f"chan{i % channels}", m=3, t=2,
                 text=f"Take up arms against them, call number {i}") for i in range(calls)]
    rows += [post(2 + i % 20, cc=cc, ch="news", t=0) for i in range(posts - calls)]
    return rows


def test_what_counts_as_a_call_for_conflict():
    assert tma.is_conflict_call({"mood_mobilise": 3, "mood_tension": 1, "text": "x", "summary_en": None})
    assert tma.is_conflict_call({"mood_mobilise": 0, "mood_tension": 3, "text": "x", "summary_en": None})
    # a protest call is not one
    assert not tma.is_conflict_call({"mood_mobilise": 2, "mood_tension": 1, "summary_en": "Join the general strike on Saturday", "text": ""})
    # hostile, with the vocabulary of war or revenge, in any of the languages read
    assert tma.is_conflict_call({"mood_mobilise": 0, "mood_tension": 2, "summary_en": "We will take revenge for our martyrs", "text": ""})
    assert tma.is_conflict_call({"mood_mobilise": 2, "mood_tension": 1, "summary_en": None, "text": "النفير العام"})
    assert tma.is_conflict_call({"mood_mobilise": 2, "mood_tension": 2, "summary_en": None, "text": "Все к оружию!"})
    assert not tma.is_conflict_call({"mood_mobilise": 0, "mood_tension": 1, "summary_en": "Revenge is a film", "text": ""})


def test_a_rise_with_volume_and_channels_is_detected():
    ind = tma.indicator("sd", baseline() + surge(), NOW)
    assert ind["calls_24h"] == 12 and ind["n_24h"] == 30 and ind["channels_24h"] == 5
    assert ind["n_base"] == 140 and ind["calls_base"] == 7 and ind["base_rate"] == 0.05
    assert ind["ratio"] == 8.0 and ind["z"] >= 2.5
    assert ind["rising"] and ind["severity"] == "high"       # the day before was quiet: not sustained
    assert len(ind["series"]) == 14 and ind["series"][-1]["calls"] == 12
    assert len(ind["examples"]) == 3 and len({e["channel"] for e in ind["examples"]}) == 3


def test_too_few_calls_or_no_baseline_is_not_a_rise():
    assert not tma.indicator("sd", baseline() + surge(calls=6, posts=10), NOW)["rising"]
    assert not tma.indicator("sd", surge(), NOW)["rising"]           # nothing to compare with


def test_one_viral_post_does_not_trigger():
    viral = [post(1 + i, ch=f"chan{i}", m=3, text="Death to them all — take up arms tonight") for i in range(12)]
    rows = baseline() + viral + [post(3, ch="news") for _ in range(18)]
    ind = tma.indicator("sd", rows, NOW)
    assert ind["calls_24h"] == 1 and not ind["rising"]


def test_one_loud_channel_does_not_trigger():
    loud = [post(1 + i % 20, ch="loud", m=3, text=f"attack now {i}") for i in range(12)]
    loud += [post(2, ch="other1", m=3, text="to arms"), post(2, ch="other2", m=3, text="strike back")]
    ind = tma.indicator("sd", baseline() + loud + [post(3, ch="news") for _ in range(16)], NOW)
    assert ind["checks"]["volume"] and not ind["checks"]["channels"] and not ind["rising"]


def test_critical_needs_an_extreme_sustained_jump():
    day_before = [post(26 + i, ch=f"chan{i % 6}", m=3, text=f"yesterday call {i}") for i in range(6)]
    ind = tma.indicator("sd", baseline() + day_before + surge(calls=24, channels=8, posts=40), NOW)
    assert ind["rising"] and ind["severity"] == "critical"


def test_cooldown_one_a_day_unless_it_climbs():
    ind = tma.indicator("sd", baseline() + surge(), NOW)
    assert tma.due(ind, [])
    assert not tma.due(ind, [{"ratio": 8.0, "severity": "high"}])
    assert not tma.due(ind, [{"ratio": 6.0, "severity": "high"}])
    assert tma.due(ind, [{"ratio": 5.0, "severity": "high"}])          # climbed 1.6×
    out = tma.detect(NOW, readings={"sd": ind}, previous=lambda cc, now: [{"ratio": 8.0, "severity": "high"}], count=None)
    assert out == []
    out = tma.detect(NOW, readings={"sd": ind, "fr": tma.indicator("fr", [], NOW)}, previous=lambda cc, now: [], count=None)
    assert [a["country_code"] for a in out] == ["SD"]


def test_title_and_record_carry_context():
    ind = tma.indicator("sd", baseline() + surge(), NOW)
    a = tma.build_alert(ind, NOW, concerned_users=2)
    assert a["alert_type"].startswith("Telegram mood") and a["severity"] == "high"
    assert a["title"] == "Calls for armed conflict rising on Telegram in Sudan — 8× the two-week level, 5 channels"
    assert a["country_code"] == "SD" and a["region"] == "Sudan"
    assert 8 < a["lat"] < 22 and 22 < a["lon"] < 38                    # inside Sudan
    raw = a["raw"]
    assert raw["base_rate"] == 0.05 and len(raw["series"]) == 14 and len(raw["examples"]) == 3
    assert all(e["id"] and e["url"].startswith("https://t.me/") for e in raw["examples"])
    assert "(2 now)" in raw["concerns"] and "Sudan" in a["message"]


def _concern(**kw):
    return {"assets": kw.get("assets", []), "theaters": kw.get("theaters", []), "countries": kw.get("countries", set())}


def test_the_reason_names_the_users_asset_theater_or_country():
    khartoum = {"lat": 15.5, "lon": 32.56, "radius": 25, "name": "Khartoum depot", "label": "warehouse"}
    assert tma.concern_reason("sd", _concern(assets=[khartoum])) == "your warehouse Khartoum depot is in Sudan"
    theater = {"lat": 16.0, "lon": 31.0, "reach": 900, "name": "Horn & Nile"}
    assert tma.concern_reason("sd", _concern(theaters=[theater])) == "in your theater Horn & Nile"
    assert tma.concern_reason("sd", _concern(countries={"sudan"})) == "Sudan — a country you watch"
    paris = {"lat": 48.85, "lon": 2.35, "radius": 25, "name": "HQ", "label": "office"}
    assert tma.concern_reason("sd", _concern(assets=[paris], theaters=[{"lat": 48.8, "lon": 2.3, "reach": 350, "name": "Paris"}])) is None


def test_the_card_reaches_those_it_concerns_and_pops_up():
    alerts = [{"id": "TGM-SD-1", "title": "Calls for armed conflict rising on Telegram in Sudan — 8× the two-week level, 5 channels",
               "sev": "high", "cc": "sd", "lat": 15.4, "lon": 29.7, "region": "Sudan", "alert_type": tma.ALERT_TYPE,
               "created_at": "2026-10-11T11:00:00"}]
    mine = tma.cards_for(_concern(assets=[{"lat": 15.5, "lon": 32.56, "radius": 25, "name": "Khartoum depot", "label": "warehouse"}]), alerts)
    assert len(mine) == 1 and mine[0]["id"] == "TGM-SD-1" and mine[0]["kind"] == "signal"
    assert mine[0]["reason"] == "your warehouse Khartoum depot is in Sudan"
    assert ew.notifies(mine[0], None) and ew.label_for(mine[0]) == "Signal"
    assert tma.cards_for(_concern(countries={"france"}), alerts) == []


def test_without_a_user_only_a_critical_reaches_everyone():
    row = {"alert_type": tma.ALERT_TYPE, "severity": "high", "region": "Sudan", "lat": 15.4, "lon": 29.7,
           "raw_json": {"raw": {"reason": "calls for conflict about Sudan"}}}
    v = nc.notification_relevance(row)
    assert v["notify"] is False and "Sudan" in v["reason"]
    v = nc.notification_relevance({**row, "severity": "critical"})
    assert v["notify"] is True and v["sev"] == "critical"
    assert nc.notification_kind(tma.ALERT_TYPE) == "signal"
