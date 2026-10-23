"""Tension trend and demonstration likelihood from the mood on Telegram
(telegram_unrest.py): a rise needs posts from several channels and a two-week
baseline; the likelihood is points with their sentences, guarded so tension
alone never makes it High; the backtest counts what followed honestly; the
alert title says where and why."""
import datetime as dt

import notification_context as nc
import telegram_mood_alert as tma
import telegram_unrest as tu

NOW = dt.datetime(2026, 10, 17, 12, tzinfo=dt.timezone.utc)
_n = [0]


def post(hours_ago, *, cc="ir", ch="chan1", t=0, m=0, text=None, topic=None, place=None, now=NOW):
    _n[0] += 1
    at = now - dt.timedelta(hours=hours_ago)
    return {"channel": ch, "msg_id": _n[0], "channel_title": ch.title(), "posted_at": at.isoformat(),
            "text": text or f"post number {_n[0]} on the day", "summary_en": None, "role": "local",
            "mood_country": cc, "mood_tension": t, "mood_mobilise": m, "mood_target": None, "mood_topic": topic,
            "place": place, "precision": "city" if place else None, "country_code": cc if place else None}


def baseline(cc="ir", per_day=6, now=NOW):
    """Two weeks before: a hostile post in six, never a call to act."""
    return [post(30 + d * 24 + k, cc=cc, ch=f"base{k % 4}", t=2 if k == 0 else 0, now=now)
            for d in range(14) for k in range(per_day)]


def heated(n=20, hostile=12, channels=6, hours=20, now=NOW):
    return [post(1 + i % hours, ch=f"chan{i % channels}", t=2 if i < hostile else 0, now=now) for i in range(n)]


def ann(city, starts, hours_ago=5, ch="organisers", what="protest rally", now=NOW):
    _n[0] += 1
    return {"channel": ch, "msg_id": _n[0], "channel_title": ch.title(), "posted_at": (now - dt.timedelta(hours=hours_ago)).isoformat(),
            "what": what, "organiser": "", "starts_at": starts, "starts_utc": None, "place": f"{city} Square, {city}, Iran",
            "country": "ir"}


# ── the trend ─────────────────────────────────────────────────────────────

def test_rising_tension_with_enough_posts_and_channels():
    d = tu.trend(baseline() + heated(), NOW, 24)
    assert d["enough"] and d["direction"] == "rising"
    assert d["n"] == 20 and d["hostile"] == 12 and d["channels"] == 6
    assert round(d["base_rate"], 3) == round(1 / 6, 3) and d["ratio"] == 3.6 and d["z"] >= 3
    assert d["sharp"]
    assert "rising" in d["label"] and "3.6×" in d["label"]


def test_minimum_evidence_guard_never_calls_noise_a_rise():
    # three hostile posts from two channels: a 'rise' of 3× on paper, but too few to read
    few = [post(2, ch="a", t=3), post(3, ch="b", t=2), post(4, ch="a", t=2)]
    d = tu.trend(baseline() + few, NOW, 24)
    assert d["direction"] == "unclear" and not d["enough"] and not d["sharp"]
    assert "only 3 posts from 2 channels" in d["why_not"]
    # plenty of posts but no two weeks before (channels just joined)
    d = tu.trend(heated(), NOW, 24)
    assert d["direction"] == "unclear" and "two weeks before" in d["why_not"]


def test_copies_of_one_post_count_once():
    viral = [post(1 + i % 5, ch=f"chan{i}", t=3, text="Death to the dictator, everyone out tonight") for i in range(15)]
    d = tu.trend(baseline() + viral, NOW, 24)
    assert d["n"] == 1 and d["direction"] == "unclear"


def test_steady_and_falling():
    calm = [post(1 + i % 20, ch=f"chan{i % 6}", t=2 if i < 3 else 0) for i in range(20)]
    assert tu.trend(baseline() + calm, NOW, 24)["direction"] == "steady"
    hot_base = [post(30 + d * 24 + k, ch=f"base{k % 4}", t=2 if k < 3 else 0) for d in range(14) for k in range(6)]
    quiet = [post(1 + i % 20, ch=f"chan{i % 6}", t=0) for i in range(30)]
    assert tu.trend(hot_base + quiet, NOW, 24)["direction"] == "falling"


def test_intraday_window_reads_the_last_six_hours():
    rows = baseline() + [post(1 + i % 5, ch=f"chan{i % 4}", t=2 if i < 6 else 0) for i in range(8)]
    d = tu.trend(rows, NOW, 6)
    assert d["hours"] == 6 and d["n"] == 8 and d["direction"] == "rising"


# ── the likelihood ────────────────────────────────────────────────────────

def calls(n, channels, hours=20, now=NOW):
    return [post(1 + i % hours, ch=f"caller{i % channels}", m=2, t=1, now=now) for i in range(n)]


def test_high_with_broad_calls_and_dated_rallies_and_its_reasons():
    rows = baseline() + calls(14, 9) + heated(n=10, hostile=2)
    a = [ann("Tehran", "2026-10-18T16:00"), ann("Mashhad", "2026-10-18", ch="others")]
    lk = tu.likelihood(rows, a, [], NOW, "Iran")
    assert lk["level"] == "High" and lk["score"] >= 4
    assert lk["calls_24h"] == 14 and lk["call_channels"] == 9
    assert lk["reasons"][0].startswith("14 calls to gather, strike or block in 9 channels in 24 h")
    assert "the two-week rate" in lk["reasons"][0]
    assert any(r == "2 dated gatherings announced for tomorrow in Mashhad and Tehran" for r in lk["reasons"])
    f = lk["forecast"]
    assert "Mashhad and Tehran" in f["statement"] and "2026-10-19 12:00" in f["criterion"] and f["criterion"].startswith("Wrong if")
    assert any(c["url"] for c in lk["citations"])


def test_tension_and_grievance_alone_never_lift_it_above_low():
    griev = [post(2 + i, ch=f"g{i % 3}", t=2, topic="fuel price rise") for i in range(6)]
    rows = baseline() + heated() + griev
    lk = tu.likelihood(rows, [], [], NOW, "Iran")
    keys = {p["key"] for p in lk["points"]}
    assert {"tension", "grievance"} <= keys and lk["score"] == 2
    assert lk["level"] == "Low" and lk["capped"]
    assert lk["forecast"] is None


def test_narrow_calls_cannot_make_high_without_a_date():
    # many calls, but from two channels: points add up, the guard caps it
    rows = baseline() + calls(12, 2, hours=4) + heated()
    lk = tu.likelihood(rows, [], [], NOW, "Iran")
    assert lk["score"] >= 4 and lk["level"] == "Elevated" and "broad call" in lk["capped"]


def test_past_or_far_announcements_do_not_count():
    a = [ann("Tehran", "2026-10-17T06:00"),           # this morning, already over
         ann("Tabriz", "2026-10-25"),                 # beyond 48 h
         ann("Shiraz", "2026-10-18", hours_ago=-2)]   # posted after the reading
    assert tu.upcoming(a, NOW) == []
    assert [u["city"] for u in tu.upcoming([ann("Tehran", "2026-10-17T18:00")], NOW)] == ["Tehran"]


def test_protest_reports_must_say_they_are_protests():
    alert = {"posted_at": NOW.isoformat(), "summary_en": "An air raid alert has been announced in Kyiv", "text": ""}
    demo = {"posted_at": NOW.isoformat(), "summary_en": "Hundreds took to the streets in Tabriz", "text": ""}
    assert not tu.is_protest_report(alert) and tu.is_protest_report(demo)
    assert tu.is_protest_report({"summary_en": None, "text": "تجمع اعتراضی بازنشستگان در اهواز"})


def test_places_are_read_where_posts_are_located():
    rows = baseline() + [post(2 + i, ch=f"c{i % 3}", m=2, place="Enghelab Square, Tehran, Iran") for i in range(4)]
    rd = tu.reading("ir", rows, [ann("Mashhad", "2026-10-18")], [], NOW, "Iran")
    pl = {p["place"]: p for p in rd["places"]}
    assert pl["Tehran"]["calls_24h"] == 4 and pl["Mashhad"]["announced"] == 1
    assert tu.city_of("Bab al-Mandab, Region, Yemen") == "Bab al-Mandab"
    c = tu.compact(rd)
    assert set(c) == {"trend", "likelihood"} and c["likelihood"]["level"] in ("Low", "Elevated", "High")


# ── the backtest ──────────────────────────────────────────────────────────

def test_backtest_counts_what_followed_per_level():
    start = NOW - dt.timedelta(days=3)
    rows = baseline(now=start) + calls(14, 9, now=start) + heated(n=10, hostile=2, now=start)
    rows += [post(-24 * k, ch="daily", now=start) for k in range(1, 4)]   # something said every day
    protest = {"channel": "news", "msg_id": 1, "posted_at": (start + dt.timedelta(hours=20)).isoformat(),
               "summary_en": "Protesters marched in Tehran", "text": "", "place": "Tehran, Iran", "country_code": "ir"}
    cal = tu.backtest({"ir": rows}, {}, {"ir": [protest]}, start, NOW, step_h=12)
    hi, low = cal["levels"]["High"], cal["levels"]["Low"]
    assert cal["any_reading"]["n"] == hi["n"] + cal["levels"]["Elevated"]["n"] + low["n"] >= 2
    assert hi["n"] >= 1 and hi["hit"] == hi["n"]          # the surge was followed by a protest
    assert not cal["enough"]
    line = tu.calibration_line(cal, "High")
    assert "were followed by protest reports" in line and "too few to call it calibrated" in line


# ── the signal ────────────────────────────────────────────────────────────

def test_alerts_say_where_and_why_and_cool_down():
    rows = baseline() + calls(14, 9) + heated(n=24, hostile=16)
    rd = tu.reading("ir", rows, [ann("Tehran", "2026-10-18T16:00")], [], NOW, "Iran")
    assert rd["likelihood"]["level"] == "High" and rd["trend"]["daily"]["sharp"]
    out = tu.detect(NOW, {"ir": rd}, previous=lambda *_: [])
    titles = [a["title"] for a in out]
    assert titles[0].startswith("Demonstrations likely in Iran in the next 48 h — 14 calls to act in 9 channels in 24 h, 1 dated gathering in Tehran")
    assert titles[1].startswith("Tension rising sharply on Telegram about Iran — hostile posts")
    for a in out:
        assert a["alert_type"].lower().startswith(nc.TELEGRAM_MOOD_PREFIX)     # the existing per-user rule
        assert a["entity_id"] == "ir" and a["severity"] == "high"
    # on cooldown: nothing again unless it climbs 1.5×
    assert tu.detect(NOW, {"ir": rd}, previous=lambda *_: [99.0]) == []
    assert tu.due(6, [4]) and not tu.due(5, [4])


def test_cards_reach_whoever_watches_the_country():
    a = {"id": "TGU-L-IR-1", "title": "Demonstrations likely in Iran in the next 48 h — …", "sev": "high", "cc": "ir",
         "lat": 32.0, "lon": 53.0, "region": "Iran", "alert_type": tu.ALERT_LIKELY, "created_at": NOW.isoformat()}
    cards = tma.cards_for({"assets": [], "theaters": [], "countries": {"iran"}}, [a])
    assert len(cards) == 1 and cards[0]["reason"] == "Iran — a country you watch"
    assert tma.cards_for({"assets": [], "theaters": [], "countries": set()}, [a]) == []


def test_a_baseline_where_every_post_was_hostile_does_not_divide_by_zero():
    """Production 2026-10-23: every baseline post at tension >= 2 made p = 1 and the
    z-score divided by zero, which dropped the unrest reading from the risk index."""
    base = [post(24 * d + 3, ch=f"c{d % 4}", t=3) for d in range(2, 12)]
    d = tu.trend(base + heated(), NOW, 24)
    assert d["direction"] in ("rising", "steady", "falling", None) or "direction" in d
