"""telegram_live: service messages become livestreams; a chunk's media is
found inside Telegram's container; ffmpeg makes it an HLS segment."""
import datetime as dt
import os
import sqlite3
import struct
import subprocess
import types

import pytest

import telegram_live as tl


@pytest.fixture
def db(tmp_path, monkeypatch):
    p = str(tmp_path / "t.db")
    con = sqlite3.connect(p)
    con.execute("CREATE TABLE telegram_posts (channel TEXT, country_code TEXT)")
    con.executemany("INSERT INTO telegram_posts VALUES (?,?)", [("kyivlive", "ua"), ("kyivlive", "ua"), ("kyivlive", "pl")])
    con.commit(); con.close()
    monkeypatch.setattr(tl, "_db_path", lambda: p)
    return p


def _msg(duration=None, cid=77, at=None):
    MessageActionGroupCall = type("MessageActionGroupCall", (), {})
    act = MessageActionGroupCall()
    act.call = types.SimpleNamespace(id=cid, access_hash=5)
    act.duration = duration
    return types.SimpleNamespace(action=act, id=10, date=at or dt.datetime.now(dt.timezone.utc))


def test_start_then_end(db):
    assert tl.note_action("kyivlive", "Real Kyiv", _msg()) == "started"
    live = tl.live_now()
    assert len(live) == 1 and live[0]["country_code"] == "ua"
    assert live[0]["headline"] == "Ukraine — livestream started: Real Kyiv"
    n = tl.notifications()[0]
    assert n["title"].endswith("Click to watch.") and n["kind"] == "livestream"
    assert tl.note_action("kyivlive", "Real Kyiv", _msg(duration=600)) == "ended"
    assert tl.live_now() == []


def test_ignored_channels_and_other_actions(db):
    assert tl.note_action("x", "X", _msg(), role="ignore") is None
    other = types.SimpleNamespace(action=types.SimpleNamespace(), id=1, date=None)
    assert tl.note_action("x", "X", other) is None


def _header(container: bytes, events=1) -> bytes:
    b = struct.pack("<I", tl.SIGNATURE) + struct.pack("<i", len(container)) + container
    b += b"\0" * ((4 - len(b) % 4) % 4)
    b += struct.pack("<i", 1) + struct.pack("<i", events)
    for _ in range(events):
        eid = b"ep1"
        b += struct.pack("<i", 0) + struct.pack("<i", len(eid)) + eid
        b += b"\0" * ((4 - len(b) % 4) % 4)
        b += struct.pack("<ii", 0, 0)
    return b


def test_unwrap_with_and_without_header():
    mp4 = b"\0\0\0\x18ftypisom" + b"x" * 40
    media, kind = tl.unwrap(_header(b"mp4") + mp4)
    assert media == mp4 and kind == "mp4"
    media, kind = tl.unwrap(b"junk" + b"OggS" + b"y" * 20)
    assert media.startswith(b"OggS") and kind == "ogg"
    assert tl.unwrap(b"plain")[0] == b"plain"


def test_playlist_is_live_until_ended():
    p = tl.playlist(5, ["s000005.ts", "s000006.ts"])
    assert "#EXT-X-MEDIA-SEQUENCE:5" in p and "s000006.ts" in p and "ENDLIST" not in p
    assert tl.playlist(0, [], ended=True).rstrip().endswith("#EXT-X-ENDLIST")


def _ffmpeg_runs() -> bool:
    ff = tl._ffmpeg()
    try:
        return bool(ff) and subprocess.run([ff, "-version"], capture_output=True, timeout=20).returncode == 0
    except Exception:
        return False


@pytest.mark.skipif(not _ffmpeg_runs(), reason="no working ffmpeg here (the server has imageio-ffmpeg's)")
def test_a_wrapped_chunk_becomes_an_hls_segment(tmp_path):
    ff = tl._ffmpeg()
    src = tmp_path / "c.mp4"
    subprocess.run([ff, "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25", "-f", "lavfi",
                    "-i", "sine=frequency=440", "-t", "1", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", str(src)], check=True)
    s = object.__new__(tl.Session)
    s.dir, s.seq, s.segments, s.error = str(tmp_path), 0, [], None
    s._segment(ff, _header(b"mp4") + src.read_bytes())
    assert s.error is None, s.error
    assert s.segments == ["s000000.ts"] and os.path.getsize(tmp_path / "s000000.ts") > 1000
