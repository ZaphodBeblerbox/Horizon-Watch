"""telegram_vision: the model describes the picture (stubbed here), code
decides the event and the place, within the budget, once per picture."""
import datetime as dt
import io
import json
import os
import sqlite3
import types

import pytest

import openai_gate
import telegram_ingest as tg
import telegram_signals as ts
import telegram_vision as tv

POLICE = {"scene": "Riot police fire tear gas at a crowd on a large square at night", "content_kind": "footage",
          "crowd": {"present": True, "estimate": 400}, "protest_signs": True,
          "police": {"present": True, "actions": ["tear_gas", "charge"]}, "military": {"present": False, "vehicles": []},
          "fire_smoke": True, "explosion": False, "damage": False, "weapons_visible": False, "injured_or_dead": False,
          "landmarks": ["Monument à la République"], "signage_text": ["Place de la République"],
          "place_guess": "Place de la République, Paris, France", "place_country": "fr",
          "place_evidence": "the statue of Marianne and a street sign", "time_of_day": "night", "confidence": 0.85}
MEME = {"scene": "A cartoon of a politician", "content_kind": "meme", "confidence": 0.9}


# ── the decision is code ───────────────────────────────────────────────────

def test_police_action_on_a_crowd_is_unrest():
    d = tv.decide(POLICE)
    assert d["event_type"] == "unrest" and "tear gas" in d["what"] and "~400" in d["what"]


def test_memes_screenshots_and_unsure_readings_are_nothing():
    assert tv.decide(MEME)["event_type"] is None
    assert tv.decide({**POLICE, "content_kind": "screenshot"})["event_type"] is None
    assert tv.decide({**POLICE, "confidence": 0.3})["event_type"] is None


def test_thresholds():
    small = {"content_kind": "footage", "confidence": 0.8, "crowd": {"present": True, "estimate": 20}}
    assert tv.decide(small)["event_type"] is None                       # twenty people is not a gathering
    assert tv.decide({**small, "protest_signs": True})["event_type"] == "unrest"
    tanks = {"content_kind": "footage", "confidence": 0.8, "military": {"present": True, "vehicles": ["tank", "apc"]}}
    assert tv.decide(tanks)["event_type"] == "movement"
    boom = {"content_kind": "footage", "confidence": 0.7, "explosion": True}
    assert tv.decide(boom)["event_type"] == "explosion"
    assert tv.decide({"content_kind": "footage", "confidence": 0.5, "fire_smoke": True})["event_type"] is None


def test_a_place_from_the_picture_needs_evidence_and_confidence():
    assert tv.place_from_picture(POLICE, None) == ("Place de la République, Paris, France", "fr")
    assert tv.place_from_picture({**POLICE, "place_evidence": ""}, None) == (None, None)
    assert tv.place_from_picture({**POLICE, "confidence": 0.5}, None) == (None, None)


def test_a_place_from_the_picture_is_never_the_channels_country_or_a_bare_guess():
    """2026-10-22: the guess took the channel's country when it gave none, and counted without
    anything recognised or read in the picture."""
    assert tv.place_from_picture({**POLICE, "place_country": ""}, "fr") == (None, None)        # no fallback to the chat
    assert tv.place_from_picture({**POLICE, "landmarks": [], "signage_text": []}, "fr") == (None, None)
    assert tv.place_from_picture({**POLICE, "landmarks": [], "signage_text": ["Place de la République"]}, None)[1] == "fr"


def test_a_guess_does_not_outrank_a_place_the_text_names(db, monkeypatch):
    _post(db, 4900, text="Les CRS chargent à Châtelet")
    con = tg._con()
    con.execute("UPDATE telegram_posts SET place='Châtelet', country_code='fr', precision='city' WHERE msg_id=4900")
    con.commit()
    con.close()
    seen = []
    monkeypatch.setattr(tg, "locate", lambda place, prec, cc: seen.append(place) or (None, "no"))
    tv.run_once(client=FakeClient(POLICE))
    assert seen == ["Châtelet"]                       # the picture's "Place de la République" was not tried
    r = sqlite3.connect(db.path).execute("SELECT lat, unpublished_reason FROM telegram_posts WHERE msg_id=4900").fetchone()
    assert r[0] is None


def test_priority_prefers_active_places_and_groups_over_stock_photos():
    stock = {"role": "aggregator", "chat_kind": "channel", "text": "Kenya: un chef de secte condamné", "media": "photo"}
    street = {"role": "group", "chat_kind": "forum", "text": "", "media": "video", "channel": "LeGrandQG", "cc": "fr"}
    assert tv.priority(stock, set(), set()) < tv.MIN_PRIORITY
    assert tv.priority(street, {"fr"}, {"LeGrandQG"}) >= tv.VIDEO_PRIORITY
    placed = {**street, "lat": 48.8}
    assert tv.priority(placed, {"fr"}, {"LeGrandQG"}) < tv.priority(street, {"fr"}, {"LeGrandQG"})


# ── a pass ─────────────────────────────────────────────────────────────────

def _jpeg(color=(200, 30, 30)) -> bytes:
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (1280, 720), color).save(b, "JPEG")
    return b.getvalue()


class FakeClient:
    """The OpenAI client's chat.completions.create, answering `answer`."""

    def __init__(self, answer, fail=None):
        self.calls = []
        self.answer, self.fail = answer, fail
        self.chat = types.SimpleNamespace(completions=types.SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        if self.fail:
            raise self.fail
        msg = types.SimpleNamespace(content=json.dumps(self.answer))
        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)],
                                     usage=types.SimpleNamespace(prompt_tokens=1200, completion_tokens=200))


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "akili.db")
    media = tmp_path / "media"
    media.mkdir()
    monkeypatch.setattr(tg, "_db_path", lambda: path)
    monkeypatch.setattr(tg, "MEDIA_DIR", str(media))
    monkeypatch.setattr(ts, "chat_context", lambda chan: {"country": "fr", "region": None})
    monkeypatch.setattr(tv, "ENABLED", True)
    monkeypatch.setattr(openai_gate, "_QUOTA", {"until": 0.0, "since": None, "hits": 0, "last": None})
    for k in ("processed", "signals", "failed", "skipped_duplicate"):
        monkeypatch.setitem(tv.STATUS, k, 0)
    import usage_tracker
    monkeypatch.setattr(usage_tracker, "record_call", lambda **kw: None)
    return types.SimpleNamespace(path=path, media=media)


def _post(db, mid, text="", media="photo", kind="forum", role="group", chan="LeGrandQG", picture=None, at=None):
    name = f"{chan}_{mid}.jpg"
    (db.media / name).write_bytes(picture or _jpeg())
    con = tg._con()
    con.execute("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, thumb, chat_kind, role,"
                " classified, relevant, unpublished_reason) VALUES (?,?,?,?,?,?,?,?,?,1,0,?)",
                (chan, mid, "GJ2026 | Le Grand QG", at or dt.datetime.now(dt.timezone.utc).isoformat(), text, media, name,
                 kind, role, tg.GROUP_NO_CUE))
    con.execute("INSERT OR REPLACE INTO telegram_chat_state (channel, last_cue_at) VALUES (?, ?)",
                (chan, dt.datetime.now(dt.timezone.utc).isoformat()))
    con.commit()
    con.close()


def test_a_bare_group_photo_becomes_a_placed_signal_with_its_media(db, monkeypatch):
    """The owner's case: a member's picture sent with no words, screened as
    chatter, is police firing tear gas at République."""
    _post(db, 4816)
    monkeypatch.setattr(tg, "locate", lambda place, prec, cc: ({"lat": 48.8674, "lon": 2.3636, "display_name": "Place de la République"}, None)
                        if cc == "fr" and "République" in place else (None, "no"))
    client = FakeClient(POLICE)
    out = tv.run_once(client=client)
    assert out["vision_read"] == 1 and out["vision_signals"] == 1
    # the model was shown the picture, downsized, with the post's context
    content = client.calls[0]["messages"][1]["content"]
    assert content[1]["type"] == "image_url" and content[1]["image_url"]["detail"] == "low"
    assert client.calls[0]["model"] == tv.VISION_MODEL
    con = sqlite3.connect(db.path)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM telegram_posts WHERE msg_id=4816").fetchone()
    assert (r["relevant"], r["event_type"], r["read_by"], r["lat"]) == (1, "unrest", "vision", 48.8674)
    assert r["vision_decision"].startswith("signal:") and r["vision_cost"] > 0
    assert json.loads(r["vision_json"])["crowd"]["estimate"] == 400            # auditable
    # on the map and the feed, carrying its picture and what it shows
    pin = next(p for p in tg.published(24) if p.get("msg_id") == 4816)
    assert pin["photo_url"] == pin["media_url"] == "/api/telegram/media/LeGrandQG_4816.jpg"
    assert "tear gas" in pin["headline"] and pin["vision"]["scene"].startswith("Riot police")
    assert any("police" in f for f in pin["vision"]["flags"])


def test_the_same_picture_is_read_once(db, monkeypatch):
    monkeypatch.setattr(tg, "locate", lambda *a: (None, "no"))
    pic = _jpeg((10, 200, 10))
    _post(db, 1, picture=pic)
    _post(db, 2, picture=pic, chan="GJ2026IDF")                       # forwarded to another group
    client = FakeClient(POLICE)
    out = tv.run_once(client=client)
    assert len(client.calls) == 1 and out["vision_duplicates"] == 1
    con = sqlite3.connect(db.path)
    assert con.execute("SELECT COUNT(*) FROM telegram_posts WHERE vision_json IS NOT NULL").fetchone()[0] == 2


def test_hourly_cap_stops_model_calls(db, monkeypatch):
    monkeypatch.setattr(tg, "locate", lambda *a: (None, "no"))
    monkeypatch.setattr(tv, "PER_HOUR", 2)
    for i in range(5):
        _post(db, 100 + i, picture=_jpeg((i * 40, 10, 10)))
    client = FakeClient(MEME)
    tv.run_once(client=client)
    assert len(client.calls) == 2
    tv.run_once(client=client)
    assert len(client.calls) == 2                                      # the hour's budget is spent
    con = tg._con()
    left = tv.budget(con, dt.datetime.now(dt.timezone.utc))
    con.close()
    assert left["hour_left"] == 0 and left["calls_left"] == 0
    assert tv.status()["budget"]["hour_left"] == 0


def test_dollar_cap_stops_model_calls(db, monkeypatch):
    monkeypatch.setattr(tg, "locate", lambda *a: (None, "no"))
    monkeypatch.setattr(tv, "USD_PER_DAY", 0.0001)
    for i in range(3):
        _post(db, 200 + i, picture=_jpeg((10, i * 50, 10)))
    client = FakeClient(MEME)
    tv.run_once(client=client)
    tv.run_once(client=client)
    assert len(client.calls) == 1


def test_low_priority_pictures_are_not_sent(db, monkeypatch):
    # a news channel's stock photo, nothing in its words, no active place
    monkeypatch.setattr(ts, "chat_context", lambda chan: {"country": None, "region": None})
    _post(db, 300, text="📰 Kenya : le chef d'une secte reconnu coupable", kind="channel", role="aggregator", chan="congonet24")
    con = tg._con()
    con.execute("DELETE FROM telegram_chat_state")
    con.commit()
    con.close()
    client = FakeClient(POLICE)
    tv.run_once(client=client)
    assert client.calls == [] and tv.STATUS["skipped_low_priority"] == 1


def test_out_of_credit_is_counted_and_pauses(db, monkeypatch):
    _post(db, 400)
    _post(db, 401, picture=_jpeg((1, 2, 3)))
    client = FakeClient(POLICE, fail=Exception("Error code: 429 insufficient_quota credit_balance_exhausted"))
    out = tv.run_once(client=client)
    assert out["vision_failed"] == 1 and len(client.calls) == 1        # stopped after the first
    assert tv.STATUS["failed"] == 1 and "insufficient_quota" in tv.STATUS["last_error"]
    assert openai_gate.quota_paused()
    # not marked: read once the credit is back
    assert sqlite3.connect(db.path).execute("SELECT COUNT(*) FROM telegram_posts WHERE vision_checked IS NULL").fetchone()[0] == 2


def test_video_frames_are_sent_together(db, monkeypatch):
    monkeypatch.setattr(tg, "locate", lambda *a: (None, "no"))
    _post(db, 500, media="video")
    monkeypatch.setattr(tg, "video_path", lambda chan, mid: ("/tmp/x.mp4", None))
    monkeypatch.setattr(tv, "video_frames", lambda path: [_jpeg((9, 9, 9)), _jpeg((99, 9, 9)), _jpeg((9, 99, 9))])
    client = FakeClient({**POLICE, "place_guess": "", "place_evidence": ""})
    tv.run_once(client=client)
    content = client.calls[0]["messages"][1]["content"]
    assert sum(1 for c in content if c["type"] == "image_url") == 3 and "3 frames" in content[0]["text"]
    r = sqlite3.connect(db.path).execute("SELECT vision_decision, unpublished_reason FROM telegram_posts").fetchone()
    assert "3 frames" in r[0] and "no place" in r[1]                    # a signal for the feed, not the map


def test_frames_are_taken_with_imageio_ffmpeg_and_not_kept(tmp_path, monkeypatch):
    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        open(cmd[-1], "wb").write(b"jpeg")
    monkeypatch.setattr(tv, "_ffmpeg", lambda: "/bin/ffmpeg")
    monkeypatch.setattr(tv.subprocess, "run", run)
    import imageio_ffmpeg
    monkeypatch.setattr(imageio_ffmpeg, "count_frames_and_secs", lambda p: (300, 10.0))
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    frames = tv.video_frames(str(video))
    assert frames == [b"jpeg"] * 3
    assert [c[c.index("-ss") + 1] for c in calls] == ["1.50", "5.00", "8.50"]
    assert not os.path.exists(os.path.dirname(calls[0][-1]))            # temp frames removed
