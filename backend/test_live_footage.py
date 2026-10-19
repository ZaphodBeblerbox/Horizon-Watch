"""live_footage: one strip of Telegram footage — merged, one card per video,
videos first, newest first, cached for everyone."""
import threading
import time

import live_footage as lf


def row(chan, mid, at, media="video", text="", relevant=1, **kw):
    return {"channel": chan, "msg_id": mid, "channel_title": kw.pop("title", chan.title()), "posted_at": at,
            "text": text, "media": media, "thumb": f"{chan}_{mid}.jpg", "relevant": relevant,
            "role": kw.pop("role", "aggregator"), "claim": kw.pop("claim", 0), **kw}


def test_videos_lead_newest_first_and_pictures_follow_only_when_videos_are_few():
    rows = [row("a", 1, "2026-10-18T10:00:00+00:00"), row("b", 2, "2026-10-18T11:00:00+00:00"),
            row("c", 3, "2026-10-18T12:00:00+00:00", media="photo")]
    got = lf.build(rows, {})
    assert [x["id"] for x in got] == ["tg-b-2", "tg-a-1", "tg-c-3"]
    many = [row("v", i, f"2026-10-18T0{i}:00:00+00:00") for i in range(1, 8)] + [row("p", 9, "2026-10-18T09:30:00+00:00", media="photo")]
    got = lf.build(many, {})
    assert all(x["media"] == "video" for x in got) and len(got) == 7


def test_a_forward_is_one_card_with_the_other_chats_listed():
    rows = [row("orig", 5, "2026-10-18T10:00:00+00:00", media_key="d42", title="Original"),
            row("fwd", 77, "2026-10-18T10:05:00+00:00", media_key="d42", title="Forwarder", place="Kharkiv", lat=50.0, lon=36.2)]
    got = lf.build(rows, {})
    assert len(got) == 1
    it = got[0]
    assert it["id"] == "tg-orig-5" and it["also_in"] == ["Forwarder"]
    assert it["place"] == "Kharkiv" and it["lat"] == 50.0           # learnt from the copy


def test_same_words_same_media_without_a_media_id_is_one_card():
    t = "Strike on the port of Odesa this morning — video https://t.me/x/1"
    rows = [row("a", 1, "2026-10-18T10:00:00+00:00", text=t), row("b", 2, "2026-10-18T10:02:00+00:00", text=t.replace("https://t.me/x/1", "@b")),
            row("c", 3, "2026-10-18T10:03:00+00:00", text=t, media="photo")]
    got = lf.build(rows, {})
    assert sorted(x["id"] for x in got) == ["tg-a-1", "tg-c-3"]


def test_irrelevant_ignored_and_official_claims_are_left_out():
    rows = [row("a", 1, "2026-10-18T10:00:00+00:00", relevant=0), row("b", 2, "2026-10-18T10:00:00+00:00", role="ignore"),
            row("c", 3, "2026-10-18T10:00:00+00:00", role="official", claim=1), row("d", 4, "2026-10-18T10:00:00+00:00", thumb=None)]
    assert lf.build(rows, {}) == []


def test_street_footage_is_kept_and_marked_on_the_ground_with_its_place():
    street = [{"headline": "Tear gas at République", "place": "Place de la République", "lat": 48.867, "lon": 2.363,
               "sources": [{"channel": "grp", "msg_id": 10, "translation": "They are gassing at Répu"}]}]
    pos = [{"signal_kind": "at", "headline": "Crowd says it is at Concorde", "place": "Concorde", "lat": 48.865, "lon": 2.321,
            "sources": [{"channel": "grp2", "msg_id": 4}]},
           {"signal_kind": "call", "headline": "Call to gather", "sources": [{"channel": "grp3", "msg_id": 1}]}]
    g = lf.ground_index(street, pos)
    rows = [row("grp", 10, "2026-10-18T18:00:00+00:00", relevant=0, text="ça gaze à Répu"),
            row("grp", 11, "2026-10-18T18:00:30+00:00", relevant=0, text=""),          # the video sent after the words
            row("grp2", 4, "2026-10-18T18:01:00+00:00", relevant=0, text="on est à Concorde"),
            row("grp3", 1, "2026-10-18T18:02:00+00:00", relevant=0, text="rdv 18h")]   # a call is not footage from the ground
    got = {x["id"]: x for x in lf.build(rows, g)}
    assert set(got) == {"tg-grp-10", "tg-grp-11", "tg-grp2-4"}
    assert got["tg-grp-10"]["on_ground"] and got["tg-grp-10"]["caption"] == "They are gassing at Répu"
    assert got["tg-grp-11"]["place"] == "Place de la République" and got["tg-grp-11"]["lat"] == 48.867
    assert got["tg-grp2-4"]["ground_kind"] == "position"


def test_caption_prefers_the_english_headline_then_summary_then_original():
    rows = [row("a", 1, "2026-10-18T10:00:00+00:00", text="Удар по Харкову", headline="Strike on Kharkiv"),
            row("b", 2, "2026-10-18T10:01:00+00:00", text="Удар по Одесі", summary_en="A strike hit Odesa."),
            row("c", 3, "2026-10-18T10:02:00+00:00", text="Вибух у Сумах")]
    got = {x["id"]: x["caption"] for x in lf.build(rows, {})}
    assert got == {"tg-a-1": "Strike on Kharkiv", "tg-b-2": "A strike hit Odesa.", "tg-c-3": "Вибух у Сумах"}


def test_one_build_for_concurrent_requests_then_cached(monkeypatch):
    lf._cache.clear()
    calls = []

    def slow_rows(hours):
        calls.append(hours)
        time.sleep(0.15)
        return [row("a", 1, "2026-10-18T10:00:00+00:00")]
    monkeypatch.setattr(lf, "_rows", slow_rows)
    monkeypatch.setattr(lf, "_ground", lambda hours: {})
    out = []
    ts = [threading.Thread(target=lambda: out.append(lf.footage(48, 40))) for _ in range(6)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(calls) == 1 and len(out) == 6 and all(o is out[0] for o in out)
    assert lf.cached(48, 40) is out[0]
    monkeypatch.setattr(lf, "CACHE_S", 0)
    assert lf.cached(48, 40) is None
    lf._cache.clear()
