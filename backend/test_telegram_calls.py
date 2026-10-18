"""One call to violence on Telegram, one signal (telegram_mood_alert.build_call_alerts)."""
import datetime as dt
import telegram_mood_alert as t

NOW = dt.datetime(2026, 10, 18, 12, tzinfo=dt.timezone.utc)


def row(ch, mid, text, mob=3, ten=2, cc="fr", lat=None, lon=None, target=None, t_="2026-10-18T11:00:00"):
    return {"channel": ch, "msg_id": mid, "channel_title": ch.title(), "posted_at": t_, "text": text, "summary_en": text,
            "headline": None, "place": "Paris" if lat else None, "lat": lat, "lon": lon, "mood_country": cc,
            "mood_tension": ten, "mood_mobilise": mob, "mood_target": target, "mood_topic": "protest"}


def test_one_call_one_signal_with_citation():
    a = t.build_call_alerts([row("gj", 1, "Allez on attaque l'Elysee ce soir", lat=48.87, lon=2.31, target="Élysée")], NOW)
    assert len(a) == 1 and a[0]["alert_type"].startswith("Telegram mood")
    assert "Élysée" in a[0]["title"] and "«" in a[0]["title"] and a[0]["raw"]["citations"][0]["url"] == "https://t.me/gj/1"
    assert a[0]["lat"] == 48.87 and a[0]["raw"]["placed"] == "post"


def test_copies_merge_and_three_channels_are_critical():
    txt = "Prenez les armes contre la police demain"
    a = t.build_call_alerts([row("a", 1, txt), row("b", 2, txt), row("c", 3, txt)], NOW)
    assert len(a) == 1 and a[0]["severity"] == "critical" and len(a[0]["raw"]["channels"]) == 3


def test_tension_alone_without_war_words_is_not_a_call():
    assert t.build_call_alerts([row("a", 1, "Ce gouvernement est une honte", mob=1, ten=3)], NOW) == []
    assert len(t.build_call_alerts([row("a", 1, "Vengeance ! aux armes citoyens", mob=1, ten=3)], NOW)) == 1


def test_already_raised_is_not_raised_again():
    r = [row("gj", 7, "On attaque maintenant")]
    first = t.detect_calls(NOW, rows=r, existing=set())
    assert len(first) == 1
    assert t.detect_calls(NOW, rows=r, existing={first[0]["id"]}) == []


def test_a_model_rating_alone_is_not_a_call():
    # a real false positive: a utilities notice rated "call to confront"
    assert t.build_call_alerts([row("k", 1, "Water supply is partially disrupted in Kyiv due to problems with electricity")], NOW) == []
