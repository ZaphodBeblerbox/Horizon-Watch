"""
telegram_live.py — livestreams in the channels we read: noticed when they
start, watchable on demand.

DETECTION. A channel that goes live posts a service message ("… started a
live stream", MessageActionGroupCall with no duration); the collector
(telegram_ingest._collect) hands every one to note_action(), which records
it. The same action WITH a duration says it ended. Only channels we read
count: the registry's role is not "ignore" — the same whitelist as every
other Telegram signal. The place is the channel's: the country most of its
located posts are in. A started stream becomes a notification ("Ukraine —
livestream started: Real Kyiv. Click to watch.") and a live entry on Home;
the start itself is the signal.

WATCHING (owner, 2026-10-10). Nothing is recorded in the background. When
someone clicks Watch, a Session for that call starts: a second, in-memory
copy of the server's Telegram session (so the minute-by-minute collector is
never blocked) joins the call in stream mode, asks Telegram for the stream's
channels (phone.getGroupCallStreamChannels) and pulls its one-second chunks
from the stream data centre (upload.getFile with InputGroupCallStream).
Each chunk's media is cut out of Telegram's stream container (unwrap) and
remuxed by ffmpeg into an HLS segment; /api/telegram/live/{id}/index.m3u8
serves the last few. The session ends when nobody has asked for the
playlist for WATCH_IDLE_S, or the call ends, and its files are deleted.

The join payload and the chunk container are below Telegram's documented
API surface (tgcalls / TDesktop). unwrap() accepts Telegram's header when
present and otherwise finds the media by its own signature, and every
failure is reported on the session's status rather than swallowed — but
until a real stream has been watched on the server this part is unproven.
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import json
import os
import random
import shutil
import sqlite3
import struct
import subprocess
import tempfile
import threading
import time

WATCH_IDLE_S = 45
WINDOW = 8                       # segments in the live playlist
CHUNK_MS = 1000                  # scale 0: one-second chunks
LIVE_DIR = os.path.join(tempfile.gettempdir(), "parallax-telegram-live")

DDL = """
CREATE TABLE IF NOT EXISTS telegram_livestreams (
    id          TEXT PRIMARY KEY,          -- "<channel>:<call id>"
    channel     TEXT NOT NULL,
    channel_title TEXT,
    call_id     INTEGER, access_hash INTEGER,
    msg_id      INTEGER,
    title       TEXT,
    country_code TEXT,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    duration_s  INTEGER,
    checked_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_tg_live_started ON telegram_livestreams (started_at);
"""


def _db_path() -> str:
    import telegram_ingest
    return telegram_ingest._db_path()


def _con():
    con = sqlite3.connect(_db_path(), timeout=60)
    con.executescript(DDL)
    con.row_factory = sqlite3.Row
    return con


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


# ── detection ──────────────────────────────────────────────────────────────

def channel_country(con, channel: str) -> str | None:
    r = con.execute("SELECT country_code, count(*) n FROM telegram_posts WHERE channel=? AND country_code IS NOT NULL"
                    " AND country_code != '' GROUP BY 1 ORDER BY n DESC LIMIT 1", (channel,)).fetchone()
    return r[0] if r else None


def note_action(channel: str, channel_title: str | None, msg, *, role: str = "aggregator") -> str | None:
    """Record a group-call service message from a channel we read. Returns
    "started", "ended" or None."""
    if role == "ignore":
        return None
    act = getattr(msg, "action", None)
    if type(act).__name__ != "MessageActionGroupCall":
        return None
    call = getattr(act, "call", None)
    cid, ah = getattr(call, "id", None), getattr(call, "access_hash", None)
    if cid is None:
        return None
    key = f"{channel}:{cid}"
    con = _con()
    try:
        dur = getattr(act, "duration", None)
        when = msg.date.astimezone(_dt.timezone.utc).isoformat() if getattr(msg, "date", None) else _now()
        if dur:                                            # the same call, over
            end = (_dt.datetime.fromisoformat(when)).isoformat()
            cur = con.execute("UPDATE telegram_livestreams SET ended_at=?, duration_s=? WHERE id=?", (end, int(dur), key))
            if not cur.rowcount:
                start = (_dt.datetime.fromisoformat(when) - _dt.timedelta(seconds=int(dur))).isoformat()
                con.execute("INSERT OR IGNORE INTO telegram_livestreams (id, channel, channel_title, call_id, access_hash, msg_id,"
                            " country_code, started_at, ended_at, duration_s) VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (key, channel, channel_title, cid, ah, msg.id, channel_country(con, channel), start, end, int(dur)))
            con.commit()
            return "ended"
        con.execute("INSERT OR IGNORE INTO telegram_livestreams (id, channel, channel_title, call_id, access_hash, msg_id,"
                    " country_code, started_at) VALUES (?,?,?,?,?,?,?,?)",
                    (key, channel, channel_title, cid, ah, msg.id, channel_country(con, channel), when))
        con.commit()
        return "started"
    finally:
        con.close()


async def confirm_live(client) -> int:
    """Ask Telegram whether each open stream is still on (phone.getGroupCall);
    a discarded call is closed. Returns how many are live."""
    from telethon.tl.functions.phone import GetGroupCallRequest
    from telethon.tl.types import InputGroupCall
    con = _con()
    live = 0
    try:
        for r in con.execute("SELECT * FROM telegram_livestreams WHERE ended_at IS NULL").fetchall():
            try:
                res = await client(GetGroupCallRequest(call=InputGroupCall(id=r["call_id"], access_hash=r["access_hash"]), limit=1))
                call = res.call
                if type(call).__name__ == "GroupCallDiscarded":
                    con.execute("UPDATE telegram_livestreams SET ended_at=?, duration_s=? WHERE id=?",
                                (_now(), getattr(call, "duration", None), r["id"]))
                else:
                    live += 1
                    con.execute("UPDATE telegram_livestreams SET title=coalesce(?, title), checked_at=? WHERE id=?",
                                (getattr(call, "title", None), _now(), r["id"]))
            except Exception as e:                         # noqa: BLE001
                print(f"[telegram-live] check {r['id']}: {type(e).__name__}: {e}", flush=True)
                # a call we can no longer see after six hours is over
                if _age_h(r["started_at"]) > 6:
                    con.execute("UPDATE telegram_livestreams SET ended_at=? WHERE id=?", (_now(), r["id"]))
        con.commit()
    finally:
        con.close()
    return live


def _age_h(iso: str) -> float:
    try:
        return (_dt.datetime.now(_dt.timezone.utc) - _dt.datetime.fromisoformat(iso)).total_seconds() / 3600
    except (TypeError, ValueError):
        return 1e9


def live_now(max_age_h: float = 12) -> list[dict]:
    """Streams on now, newest first, each with its place and how to watch."""
    try:
        con = _con()
    except Exception:                                          # noqa: BLE001
        return []
    try:
        rows = con.execute("SELECT * FROM telegram_livestreams WHERE ended_at IS NULL ORDER BY started_at DESC").fetchall()
    finally:
        con.close()
    out = []
    for r in rows:
        if _age_h(r["started_at"]) > max_age_h:
            continue
        out.append(describe(dict(r)))
    return out


def describe(r: dict) -> dict:
    place = None
    if r.get("country_code"):
        try:
            from location_extract import country_name_from_code
            place = country_name_from_code(r["country_code"]) or None
        except Exception:                                      # noqa: BLE001
            place = None
    name = r.get("channel_title") or r["channel"]
    head = f"{place} — livestream started: {name}" if place else f"Livestream started: {name}"
    return {**r, "place": place, "headline": head, "watch_url": f"/api/telegram/live/{r['id']}/index.m3u8"}


def notifications() -> list[dict]:
    """Tray cards for streams on now ("Click to watch")."""
    out = []
    for s in live_now():
        out.append({
            "id": f"live:{s['id']}", "kind": "livestream", "sev": "high",
            "title": f"{s['headline']}. Click to watch.",
            "reason": s.get("title") or "a channel we read went live",
            "alert_type": "Telegram livestream", "source": "telegram",
            "created_at": s["started_at"], "notify": True,
            "livestream_id": s["id"], "channel": s["channel"],
        })
    return out


# ── watching ───────────────────────────────────────────────────────────────

SIGNATURE = 0xA12E810D
_MAGIC = [(b"ftyp", 4), (b"OggS", 0), (b"\x1aE\xdf\xa3", 0)]


def unwrap(chunk: bytes) -> tuple[bytes, str | None]:
    """The media inside one stream chunk, and its container ("mp4", "ogg",
    "mkv" or None). Telegram's chunks may carry a header (signature, the
    container's name, channel events) before the media; it is read when
    present, and otherwise the media is found by its own signature."""
    if len(chunk) >= 8 and struct.unpack("<I", chunk[:4])[0] == SIGNATURE:
        try:
            n = struct.unpack("<i", chunk[4:8])[0]
            container = chunk[8:8 + n].decode("ascii", "replace")
            pos = 8 + n
            pos += (4 - pos % 4) % 4
            pos += 4                                           # active mask
            (count,) = struct.unpack("<i", chunk[pos:pos + 4]); pos += 4
            for _ in range(max(0, min(count, 64))):
                pos += 4                                       # offset
                (ln,) = struct.unpack("<i", chunk[pos:pos + 4]); pos += 4 + ln
                pos += (4 - pos % 4) % 4
                pos += 8                                       # rotation, extra
            body = chunk[pos:]
            found = _find_media(body)
            if found:
                return found
            return body, container or None
        except (struct.error, ValueError):
            pass
    found = _find_media(chunk)
    return found if found else (chunk, None)


def _find_media(b: bytes):
    head = b[:65536]
    best = None
    for magic, back in _MAGIC:
        i = head.find(magic)
        if i >= 0:
            start = max(0, i - back)
            kind = {b"ftyp": "mp4", b"OggS": "ogg"}.get(magic, "mkv")
            if best is None or start < best[0]:
                best = (start, kind)
    return (b[best[0]:], best[1]) if best else None


def _ffmpeg() -> str | None:
    """The static ffmpeg shipped by imageio-ffmpeg (requirements.txt; it has
    libx264 on every platform), else one on the PATH."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:                                          # noqa: BLE001
        return shutil.which("ffmpeg")


def playlist(seq0: int, segments: list[str], target_s: int = 2, ended: bool = False) -> str:
    lines = ["#EXTM3U", "#EXT-X-VERSION:3", f"#EXT-X-TARGETDURATION:{target_s}", f"#EXT-X-MEDIA-SEQUENCE:{seq0}"]
    for s in segments:
        lines += [f"#EXTINF:{CHUNK_MS / 1000:.3f},", s]
    if ended:
        lines.append("#EXT-X-ENDLIST")
    return "\n".join(lines) + "\n"


class Session:
    """One stream being watched: a thread with its own Telegram client."""

    def __init__(self, stream: dict):
        self.stream = stream
        self.dir = os.path.join(LIVE_DIR, stream["id"].replace("/", "_").replace(":", "_"))
        os.makedirs(self.dir, exist_ok=True)
        self.seq = 0
        self.segments: list[str] = []
        self.last_view = time.time()
        self.status = "starting"
        self.error: str | None = None
        self.ended = False
        self._stop = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True, name=f"tg-live-{stream['id'][:20]}")
        self.thread.start()

    def touch(self):
        self.last_view = time.time()

    def stop(self):
        self._stop.set()

    def m3u8(self) -> str:
        return playlist(max(0, self.seq - len(self.segments)), list(self.segments), ended=self.ended)

    def _run(self):
        try:
            asyncio.run(self._pull())
        except Exception as e:                                 # noqa: BLE001
            self.error = f"{type(e).__name__}: {e}"
            self.status = "failed"
            print(f"[telegram-live] {self.stream['id']}: {self.error}", flush=True)
        finally:
            self.ended = True
            shutil.rmtree(self.dir, ignore_errors=True)
            with _LOCK:
                if _SESSIONS.get(self.stream["id"]) is self:
                    _SESSIONS.pop(self.stream["id"], None)

    async def _pull(self):
        from telethon import TelegramClient
        from telethon.sessions import StringSession
        from telethon.tl.functions.phone import (GetGroupCallRequest, GetGroupCallStreamChannelsRequest,
                                                 JoinGroupCallRequest, LeaveGroupCallRequest)
        from telethon.tl.functions.upload import GetFileRequest
        from telethon.tl.types import DataJSON, InputGroupCall, InputGroupCallStream, InputPeerSelf
        import telegram_ingest as ti

        ff = _ffmpeg()
        if not ff:
            raise RuntimeError("ffmpeg is not available on the server")
        # an in-memory copy of the server's session: the collector keeps its file
        with ti._SESSION_LOCK:
            file_client = ti._client()
            sess = StringSession.save(file_client.session)
            file_client.session.close()
        client = TelegramClient(StringSession(sess), int(os.environ["TELEGRAM_API_ID"]), os.environ["TELEGRAM_API_HASH"])
        await client.connect()
        call = InputGroupCall(id=self.stream["call_id"], access_hash=self.stream["access_hash"])
        joined = False
        try:
            info = (await client(GetGroupCallRequest(call=call, limit=1))).call
            if type(info).__name__ == "GroupCallDiscarded":
                self.status = "ended"
                return
            dc = getattr(info, "stream_dc_id", None)
            # Stream mode: a listener's join; the server answers with the
            # stream to fetch rather than a WebRTC connection.
            payload = {"ufrag": "%08x" % random.getrandbits(32), "pwd": "%024x" % random.getrandbits(96),
                       "fingerprints": [], "ssrc": random.getrandbits(31)}
            await client(JoinGroupCallRequest(call=call, join_as=InputPeerSelf(), params=DataJSON(data=json.dumps(payload)),
                                              muted=True, video_stopped=True))
            joined = True
            sender = await client._borrow_exported_sender(dc) if dc and dc != client.session.dc_id else None
            fetch = (lambda req: sender.send(req)) if sender else (lambda req: client(req))
            try:
                chans = await fetch(GetGroupCallStreamChannelsRequest(call=call))
                ch = sorted(chans.channels, key=lambda c: -c.last_timestamp_ms)[0] if chans.channels else None
                if not ch:
                    raise RuntimeError("the call has no stream channels (not a broadcast stream)")
                t = ch.last_timestamp_ms - 2 * CHUNK_MS
                self.status = "playing"
                while not self._stop.is_set():
                    if time.time() - self.last_view > WATCH_IDLE_S:
                        self.status = "stopped: nobody watching"
                        break
                    loc = InputGroupCallStream(call=call, time_ms=t, scale=ch.scale, video_channel=ch.channel, video_quality=2)
                    try:
                        part = await fetch(GetFileRequest(location=loc, offset=0, limit=512 * 1024))
                    except Exception as e:                     # noqa: BLE001
                        name = type(e).__name__
                        if "TimeTooBig" in name or "TIME_TOO_BIG" in str(e):
                            await asyncio.sleep(0.5)           # not produced yet
                            continue
                        if "GroupcallJoinMissing" in name or "GROUPCALL_JOIN_MISSING" in str(e):
                            raise
                        raise
                    data = getattr(part, "bytes", b"") or b""
                    if data:
                        await asyncio.get_event_loop().run_in_executor(None, self._segment, ff, data)
                    t += CHUNK_MS
                    if self.seq % 15 == 0:
                        res = (await client(GetGroupCallRequest(call=call, limit=1))).call
                        if type(res).__name__ == "GroupCallDiscarded":
                            self.status = "ended"
                            break
            finally:
                if sender:
                    await client._return_exported_sender(sender)
        finally:
            if joined:
                try:
                    await client(LeaveGroupCallRequest(call=call, source=0))
                except Exception:                              # noqa: BLE001
                    pass
            await client.disconnect()

    def _segment(self, ff: str, chunk: bytes):
        media, kind = unwrap(chunk)
        name = f"s{self.seq:06d}.ts"
        src = os.path.join(self.dir, f"in{self.seq:06d}.{kind or 'bin'}")
        with open(src, "wb") as fh:
            fh.write(media)
        out = os.path.join(self.dir, name)
        # browsers play H.264 + AAC in HLS; the stream's own codecs are re-encoded, fast
        r = subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y", "-i", src,
                            "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-c:a", "aac", "-ac", "2",
                            "-f", "mpegts", "-output_ts_offset", str(self.seq * CHUNK_MS / 1000), out],
                           capture_output=True, timeout=20)
        os.remove(src)
        if r.returncode != 0 or not os.path.exists(out):
            self.error = (r.stderr or b"").decode("utf-8", "replace")[-300:] or "ffmpeg produced nothing"
            return
        self.segments.append(name)
        self.seq += 1
        while len(self.segments) > WINDOW:
            old = self.segments.pop(0)
            try:
                os.remove(os.path.join(self.dir, old))
            except OSError:
                pass


_SESSIONS: dict[str, Session] = {}
_LOCK = threading.Lock()


def get_stream(stream_id: str) -> dict | None:
    con = _con()
    try:
        r = con.execute("SELECT * FROM telegram_livestreams WHERE id=?", (stream_id,)).fetchone()
        return dict(r) if r else None
    finally:
        con.close()


def watch(stream_id: str) -> Session | None:
    """The session for this stream, started on the first viewer."""
    with _LOCK:
        s = _SESSIONS.get(stream_id)
        if s and not s.ended:
            s.touch()
            return s
    st = get_stream(stream_id)
    if not st or st.get("ended_at"):
        return None
    with _LOCK:
        s = _SESSIONS.get(stream_id)
        if not s or s.ended:
            s = Session(st)
            _SESSIONS[stream_id] = s
        s.touch()
        return s


def segment_path(stream_id: str, name: str) -> str | None:
    with _LOCK:
        s = _SESSIONS.get(stream_id)
    if not s or not name.endswith(".ts") or "/" in name or ".." in name:
        return None
    s.touch()
    p = os.path.join(s.dir, name)
    return p if os.path.exists(p) else None
