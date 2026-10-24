"""A cited source as our own card (source_card.py): the card from what we hold, the summary on click with one model
call cached per URL, and no summary (and nothing cached) when the model is off."""
import json
import os
import sqlite3
import sys
from types import SimpleNamespace as NS

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import source_card as S  # noqa: E402


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    p = str(tmp_path / "s.db")
    S.DB_PATH = p
    S._ready.clear()
    con = sqlite3.connect(p)
    con.execute("CREATE TABLE telegram_posts (channel TEXT, msg_id INTEGER, channel_title TEXT, posted_at TEXT, text TEXT,"
                " media TEXT, thumb TEXT, headline TEXT, place TEXT, lat REAL, lon REAL, lang TEXT, summary_en TEXT,"
                " role TEXT, graphic INTEGER, event_time TEXT)")
    con.execute("INSERT INTO telegram_posts VALUES ('rybar', 1234, 'Rybar', '2026-10-24T08:00:00+00:00',"
                " 'Взрыв в порту Одессы', 'photo', 'rybar_1234.jpg', 'Explosion at Odesa port', 'Odesa, Ukraine',"
                " 46.48, 30.73, 'ru', 'An explosion at the port of Odesa', 'partisan', 0, NULL)")
    con.commit(); con.close()
    monkeypatch.setattr(S, "_telegram_row", lambda chan, mid, db_path=None: _row(p, chan, mid))
    import usage_tracker
    monkeypatch.setattr(usage_tracker, "record_call", lambda **kw: None)
    yield
    S.DB_PATH = None


def _row(p, chan, mid):
    con = sqlite3.connect(p)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM telegram_posts WHERE channel=? AND msg_id=?", (chan, mid)).fetchone()
    con.close()
    return r


class FakeClient:
    def __init__(self, content):
        self.calls = 0
        self.content = content
        self.chat = NS(completions=NS(create=self._create))

    def _create(self, **kw):
        self.calls += 1
        return NS(choices=[NS(message=NS(content=json.dumps(self.content)))], usage=NS(prompt_tokens=200, completion_tokens=60))


def test_urls_normalise_to_one_key():
    assert S.norm_url("https://t.me/s/rybar/1234?single") == "https://t.me/rybar/1234"
    assert S.norm_url("https://twitter.com/GeoConfirmed/status/1850000000000000000") == "https://x.com/GeoConfirmed/status/1850000000000000000"
    assert S.norm_url("https://www.bbc.com/news/x#top") == "https://www.bbc.com/news/x"
    assert S.kind_of("https://t.me/c/1181169156/135924") == "telegram"


def test_telegram_card_from_what_we_hold():
    c = S.card("https://t.me/s/rybar/1234")
    assert c["kind"] == "telegram" and c["known"] and c["source"] == "Rybar"
    assert c["text"] == "Взрыв в порту Одессы" and c["english"] == "An explosion at the port of Odesa"
    assert c["thumb_url"] == "/api/telegram/media/rybar_1234.jpg" and c["media"] == "photo"
    assert c["summary"] is None


def test_unknown_telegram_post_and_web_page_say_little():
    c = S.card("https://t.me/someone/9")
    assert c["known"] is False and c["source"] == "@someone"
    w = S.card("https://www.reuters.com/world/a")
    assert w["kind"] == "web" and w["source"] == "reuters.com"
    with pytest.raises(ValueError):
        S.card("javascript:alert(1)")


def test_x_card_through_the_fetcher():
    post = {"author": "GeoConfirmed", "handle": "GeoConfirmed", "text": "Strike in Kherson", "created_at": "2026-10-24T07:00:00",
            "photos": ["https://pbs.twimg.com/media/a.jpg"], "videos": [], "lang": "en"}
    c = S.card("https://x.com/GeoConfirmed/status/1850000000000000000", fetch_x=lambda pid: post)
    assert c["kind"] == "x" and c["known"] and c["text"] == "Strike in Kherson" and c["photos"]
    off = S.card("https://x.com/GeoConfirmed/status/1850000000000000001", fetch_x=lambda pid: None)
    assert off["known"] is False and off["source"] == "@GeoConfirmed"


def test_summary_once_then_cached():
    fc = FakeClient({"summary": "The channel says an explosion hit the port of Odesa on 24 October.", "english": "Explosion in the port of Odesa"})
    a = S.summary("https://t.me/rybar/1234", user_id="u1", client=fc)
    assert a["path"] == "model" and "Odesa" in a["summary"] and a["english"] == "Explosion in the port of Odesa"
    b = S.summary("https://t.me/s/rybar/1234", user_id="u2", client=fc)
    assert b["path"] == "cache" and b["summary"] == a["summary"]
    assert fc.calls == 1
    assert S.card("https://t.me/rybar/1234")["summary"]["summary"] == a["summary"]


def test_model_off_gives_no_summary_and_caches_nothing(monkeypatch):
    import openai_gate
    monkeypatch.setattr(openai_gate, "get_client", lambda purpose, api_key=None: None)
    out = S.summary("https://t.me/rybar/1234", user_id="u1")
    assert out["path"] == "off" and out["summary"] is None and out["why"]
    assert S.cached_summary("https://t.me/rybar/1234") is None


def test_web_finding_summarised_from_what_the_reader_was_shown():
    fc = FakeClient({"summary": "Reuters reports a fire at the refinery.", "english": ""})
    out = S.summary("https://www.reuters.com/world/a", user_id="u1", client=fc,
                    given={"title": "Fire at refinery", "summary": "A fire broke out at the refinery overnight."})
    assert out["path"] == "model" and out["english"] is None
    nothing = S.summary("https://example.com/empty", user_id="u1", client=fc, given={})
    assert nothing["path"] == "off" and fc.calls == 1


def test_an_unusable_answer_is_not_kept():
    fc = FakeClient({"summary": "", "english": ""})
    out = S.summary("https://t.me/rybar/1234", user_id="u1", client=fc)
    assert out["path"] == "off" and S.cached_summary("https://t.me/rybar/1234") is None
