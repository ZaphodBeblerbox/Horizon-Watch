"""Private chats are read (owner, 2026-10-19): one-to-one chats and legacy
groups, beside channels and supergroups — never bots, the account itself or
Telegram's service notices. A fake client stands in for Telethon: never a
real Telegram client here (a second client kills the live ingest)."""
import asyncio
import datetime as dt
import sqlite3
import types

import pytest

import telegram_ingest as tg
import telegram_live
import telegram_signals as ts


def _dialog(ent, *, user=False, group=False, channel=False, top=10):
    return types.SimpleNamespace(entity=ent, is_user=user, is_group=group, is_channel=channel,
                                 message=types.SimpleNamespace(id=top))


def _msg(mid, text, *, media=None, out=False, at=None):
    return types.SimpleNamespace(id=mid, message=text, media=media, out=out, fwd_from=None, views=None, action=None,
                                 file=None, reply_to=None,
                                 date=at or dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=5))


class FakeClient:
    def __init__(self, dialogs, messages):
        self.dialogs, self.messages, self.downloads = dialogs, messages, []

    async def iter_dialogs(self):
        for d in self.dialogs:
            yield d

    async def iter_messages(self, ent, limit=None, min_id=0):
        for m in self.messages.get(ent.id, []):
            yield m

    async def download_media(self, m, file=None, thumb=None):
        self.downloads.append(file)
        return None                                  # nothing written: no media on a laptop

    async def disconnect(self):
        pass


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "akili.db")
    monkeypatch.setattr(tg, "_db_path", lambda: path)
    monkeypatch.setattr(ts, "chat_context", lambda chan: {"country": "fr", "region": None})

    async def nothing(*a, **k):
        return []
    monkeypatch.setattr(tg, "_join_registered", nothing)
    monkeypatch.setattr(telegram_live, "note_active", nothing)
    monkeypatch.setattr(telegram_live, "confirm_live", nothing)
    return path


def _run(monkeypatch, client):
    async def connected():
        return client
    monkeypatch.setattr(tg, "_connected", connected)
    return asyncio.run(tg._collect(6))


def test_private_chats_and_legacy_groups_are_read(db, monkeypatch):
    from telethon.tl.types import MessageMediaPhoto
    person = types.SimpleNamespace(id=5551234, first_name="Camille", last_name="R.", bot=False, is_self=False,
                                   deleted=False, support=False)
    legacy = types.SimpleNamespace(id=4440001, title="Gilets jaunes Rouen (privé)")
    bot = types.SimpleNamespace(id=999, first_name="Kharkiv_Lifebot", bot=True)
    service = types.SimpleNamespace(id=777000, first_name="Telegram", bot=False)
    me = types.SimpleNamespace(id=1, first_name="Me", is_self=True)
    client = FakeClient(
        [_dialog(person, user=True), _dialog(legacy, group=True), _dialog(bot, user=True),
         _dialog(service, user=True), _dialog(me, user=True)],
        {5551234: [_msg(1, "Les CRS chargent à Répu, ça gaze"), _msg(2, "", media=MessageMediaPhoto(photo=None)),
                   _msg(3, "je t'envoie la vidéo", out=True)],
         4440001: [_msg(7, "On bloque le rond-point de Barentin maintenant")],
         999: [_msg(1, "КАБ на Тишки")], 777000: [_msg(1, "Login code: 12345")], 1: [_msg(1, "note to self")]})
    assert _run(monkeypatch, client) == 3
    con = sqlite3.connect(db)
    rows = con.execute("SELECT channel, msg_id, chat_kind, channel_title, role, media FROM telegram_posts ORDER BY 1, 2").fetchall()
    assert rows == [("g/4440001", 7, "group", "Gilets jaunes Rouen (privé)", "group", "none"),
                    ("u/5551234", 1, "private", "Camille R.", "group", "none"),
                    ("u/5551234", 2, "private", "Camille R.", "group", "photo")]
    # a bare picture in a private chat is fetched (the picture is the message)
    assert any(f.endswith("u_5551234_2.jpg") for f in client.downloads)
    assert dict(con.execute("SELECT channel, kind FROM telegram_chat_state")) == {"u/5551234": "private", "g/4440001": "group"}


def test_private_chats_can_be_switched_off(monkeypatch):
    person = types.SimpleNamespace(id=5, first_name="A", bot=False, is_self=False, deleted=False, support=False)
    assert tg.private_chat_kind(_dialog(person, user=True), person) == (True, False)
    monkeypatch.setattr(tg, "READ_PRIVATE", False)
    assert tg.private_chat_kind(_dialog(person, user=True), person) == (False, False)


def test_ignore_in_the_registry_still_holds_for_private_chats(db, monkeypatch):
    legacy = types.SimpleNamespace(id=4440002, title="Family")
    monkeypatch.setattr(tg, "channel_info", lambda chan, default_role="aggregator":
                        {"role": "ignore" if chan == "g/4440002" else default_role, "party": None, "lang": None})
    client = FakeClient([_dialog(legacy, group=True)], {4440002: [_msg(1, "On va à la manif demain")]})
    assert _run(monkeypatch, client) == 0


def test_private_posts_link_nowhere_public_but_play_their_video():
    assert tg.post_url("u/5551234", 2) is None and tg.post_url("GJ2026IDF", 2) == "https://t.me/GJ2026IDF/2"
    m = tg.media_urls("u/5551234", 2, "video", "u_5551234_2.jpg")
    assert m["video_url"] == "/api/telegram/video/~u5551234/2" and m["media_url"] == m["video_url"]
    assert tg.chan_from_url("~u5551234") == "u/5551234" and tg.chan_from_url("~g4440001") == "g/4440001"
    assert tg.chan_from_url("-1001181169156") == "c/1181169156" and tg.chan_from_url("../etc") is None
    from telethon.tl.types import PeerChat, PeerUser
    assert isinstance(tg._peer("u/5551234"), PeerUser) and isinstance(tg._peer("g/4440001"), PeerChat)


def test_private_chatter_is_screened_before_any_model(db, monkeypatch):
    con = tg._con()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    con.executemany("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, chat_kind, role)"
                    " VALUES ('u/5', ?, 'A', ?, ?, 'none', 'private', 'group')",
                    [(1, now, "ok merci"), (2, now, "Les CRS chargent à Répu, ça gaze")])
    con.commit()
    con.close()
    seen = []
    monkeypatch.setattr(tg, "_model_pass", lambda rows: (seen.extend(r[3] for r in rows) or [{} for _ in rows]))
    out = tg.classify()
    assert seen == [2] and out["group_chatter_skipped"] == 1
