"""
source_card.py — a cited source, read inside Parallax as OUR post card (owner, 2026-10-24: "sources open locally,
in our own UI").

A Telegram post, an X post, a news article or a web finding is shown by the client as one card: the channel or
outlet, the time, the original text with its English, its media through our proxy, and a short summary of what
happened. Never Telegram's or X's own embed.

    card(url)                 what we already hold about the source, no model: a Telegram post from
                              telegram_posts (text, English, media URLs through /api/telegram/media|video), an X post
                              through x_posts.fetch (author, text, photos, video), anything else its host only (the
                              caller merges the card it was given: a web finding's title and summary)
    summary(url, ...)         the short "what happened" and, for a text not in English, its English. Generated ON
                              CLICK ONLY: one model call (openai_gate purpose 'explain': reading a source and saying
                              what it amounts to), cached per source URL so a second reader, or a second click, costs
                              nothing. With the model off, capped or failing, the code answers with no summary and
                              says why; nothing is cached then, so the next click once the model is back gets one.

The model only restates the given text: it is told to add nothing, and a summary is kept only if it is non-empty
and short. Per-user cap SUMMARY_PER_USER_DAY (cache hits are free).
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import sqlite3
import threading
from urllib.parse import urlparse

TG_POST = re.compile(r"^https?://(?:www\.)?t(?:elegram)?\.me/(?:s/)?(c/\d{5,15}|[A-Za-z0-9_]{3,64})/(\d{1,12})", re.I)
X_STATUS = re.compile(r"^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([^/?#]+)/status(?:es)?/(\d{5,25})", re.I)

MAX_TEXT = 4000                 # what the model reads of a source
MAX_SUMMARY = 600               # a summary longer than this is not short
SUMMARY_PER_USER_DAY = int(os.getenv("SOURCE_SUMMARY_PER_USER_DAY", "80"))
PURPOSE = "explain"

SYSTEM = (
    "You read one source (a Telegram post, an X post, a news article or a web page) for an analyst. "
    "Answer in JSON: {\"summary\": \"...\", \"english\": \"...\"}. "
    "summary: one to three short sentences in English saying what happened according to the source: who did what, "
    "where and when, as the source states it, attributed (\"the channel says\") when it is a claim. Add nothing the "
    "text does not say; no speculation, no background. If the source reports no event, say in one sentence what it "
    "says. english: the source's text translated into English when it is not in English, else an empty string."
)

DB_PATH: str | None = None       # tests point this at a temporary file
_lock = threading.Lock()
_ready: set[str] = set()


def _db_path() -> str:
    if DB_PATH:
        return DB_PATH
    try:
        from main import DATA_DIR
        return os.path.join(DATA_DIR, "akili.db")
    except Exception:                                          # noqa: BLE001
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "akili.db")


def _con():
    p = _db_path()
    con = sqlite3.connect(p, timeout=10)
    if p not in _ready:
        con.execute("CREATE TABLE IF NOT EXISTS source_summaries (url TEXT PRIMARY KEY, summary TEXT, english TEXT,"
                    " model TEXT, cost REAL, created_at TEXT)")
        con.execute("CREATE TABLE IF NOT EXISTS source_summary_use (user_id TEXT, day TEXT, n INTEGER,"
                    " PRIMARY KEY (user_id, day))")
        con.commit()
        _ready.add(p)
    return con


def norm_url(url: str | None) -> str:
    """One key per source: no fragment, no tracking query, t.me/s/x/1 is t.me/x/1, twitter.com is x.com."""
    u = str(url or "").strip()
    m = TG_POST.match(u)
    if m:
        return f"https://t.me/{m.group(1)}/{int(m.group(2))}"
    m = X_STATUS.match(u)
    if m:
        return f"https://x.com/{m.group(1)}/status/{m.group(2)}"
    return u.split("#", 1)[0]


def kind_of(url: str | None) -> str:
    u = str(url or "")
    if TG_POST.match(u):
        return "telegram"
    if X_STATUS.match(u):
        return "x"
    return "web"


def host_of(url: str | None) -> str:
    try:
        return (urlparse(str(url or "")).hostname or "").removeprefix("www.")
    except ValueError:
        return ""


# ── the card, without a model ───────────────────────────────────────────

def _telegram_row(chan: str, msg_id: int, db_path: str | None = None):
    path = db_path or _db_path()
    try:
        con = sqlite3.connect(path, timeout=10)
        con.row_factory = sqlite3.Row
        r = con.execute("SELECT * FROM telegram_posts WHERE channel=? AND msg_id=?", (chan, msg_id)).fetchone()
        con.close()
        return r
    except sqlite3.Error:
        return None


def _col(r, k):
    try:
        return r[k]
    except (IndexError, KeyError):
        return None


def telegram_card(url: str, row=None) -> dict:
    m = TG_POST.match(url)
    chan, msg_id = m.group(1), int(m.group(2))
    r = row if row is not None else _telegram_row(chan, msg_id)
    out = {"kind": "telegram", "url": norm_url(url), "known": r is not None, "source": f"@{chan}" if "/" not in chan else "Telegram",
           "handle": chan if "/" not in chan else None}
    if r is None:
        return out
    import telegram_ingest as tg
    lang = _col(r, "lang")
    text = _col(r, "text") or ""
    en = _col(r, "summary_en")
    out.update({
        "source": _col(r, "channel_title") or out["source"], "at": _col(r, "posted_at"),
        "event_time": _col(r, "event_time"), "headline": _col(r, "headline"),
        "text": text, "lang": lang,
        # the classifier's English, when the post is not in English (telegram_ingest: summary_en)
        "english": en if (en and lang and lang != "en" and en.strip() != text.strip()) else None,
        "place": _col(r, "place"), "lat": _col(r, "lat"), "lon": _col(r, "lon"),
        "role": _col(r, "role"), "channel": chan, "msg_id": msg_id,
        "media": _col(r, "media") if _col(r, "media") in ("photo", "video") else None,
        "graphic": bool(_col(r, "graphic")),
        **tg.media_urls(chan, msg_id, _col(r, "media"), _col(r, "thumb")),
    })
    return out


def x_card(url: str, fetch=None) -> dict:
    m = X_STATUS.match(url)
    handle, pid = m.group(1), m.group(2)
    out = {"kind": "x", "url": norm_url(url), "known": False, "source": f"@{handle}", "handle": handle, "x_id": pid}
    if fetch is None:
        import x_posts
        fetch = x_posts.fetch
    try:
        p = fetch(pid)
    except Exception:                                          # noqa: BLE001
        p = None
    if not p:
        return out
    out.update({"known": True, "source": p.get("author") or out["source"], "handle": p.get("handle") or handle,
                "avatar": p.get("avatar"), "at": p.get("created_at"), "text": p.get("text") or "", "lang": p.get("lang"),
                "photos": p.get("photos") or [], "videos": p.get("videos") or [], "sensitive": bool(p.get("sensitive"))})
    return out


def card(url: str, *, fetch_x=None, tg_row=None) -> dict:
    u = str(url or "").strip()
    if not re.match(r"^https?://", u, re.I):
        raise ValueError("a source is an http(s) link")
    k = kind_of(u)
    if k == "telegram":
        c = telegram_card(u, tg_row)
    elif k == "x":
        c = x_card(u, fetch_x)
    else:
        c = {"kind": "web", "url": norm_url(u), "known": False, "source": host_of(u)}
    c["summary"] = cached_summary(c["url"])
    return c


# ── the summary, on click ───────────────────────────────────────────────

def cached_summary(url: str) -> dict | None:
    try:
        with _lock:
            con = _con()
            r = con.execute("SELECT summary, english, model, created_at FROM source_summaries WHERE url=?", (norm_url(url),)).fetchone()
            con.close()
    except sqlite3.Error:
        return None
    if not r:
        return None
    return {"summary": r[0], "english": r[1] or None, "model": r[2], "at": r[3], "path": "cache"}


def _store(url: str, summary: str, english: str | None, model: str, cost: float) -> None:
    with _lock:
        con = _con()
        con.execute("INSERT OR REPLACE INTO source_summaries VALUES (?,?,?,?,?,?)",
                    (norm_url(url), summary, english or None, model, cost, _dt.datetime.utcnow().isoformat(timespec="seconds")))
        con.commit()
        con.close()


def _use(user_id: str, add: int = 0) -> int:
    day = _dt.datetime.utcnow().strftime("%Y-%m-%d")
    with _lock:
        con = _con()
        if add:
            con.execute("INSERT INTO source_summary_use VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET n = n + ?",
                        (user_id, day, add, add))
            con.commit()
        r = con.execute("SELECT n FROM source_summary_use WHERE user_id=? AND day=?", (user_id, day)).fetchone()
        con.close()
    return int(r[0]) if r else 0


def _material(c: dict, given: dict | None) -> str:
    """The text the model reads: what we hold, else what the caller was shown (a web finding's title and summary)."""
    g = given or {}
    parts = [c.get("headline") if c.get("kind") == "telegram" else None, c.get("text")]
    if not any(parts):
        parts = [g.get("title"), g.get("text") or g.get("summary")]
    body = "\n".join(str(p).strip() for p in parts if p and str(p).strip())
    return body[:MAX_TEXT]


def summary(url: str, *, user_id: str = "anon", given: dict | None = None, client=None, card_now: dict | None = None) -> dict:
    """{summary, english, path: cache|model|off, why?}. One model call at most, only when not cached."""
    key = norm_url(url)
    hit = cached_summary(key)
    if hit:
        return hit
    c = card_now or card(key)
    text = _material(c, given)
    if not text:
        return {"summary": None, "english": None, "path": "off", "why": "There is no text to summarise."}
    import openai_gate as g
    if client is None:
        if _use(user_id) >= SUMMARY_PER_USER_DAY:
            return {"summary": None, "english": None, "path": "off", "why": "Today's summaries are used up."}
        client = g.get_client(PURPOSE)
    if client is None:
        why = g.refusal(PURPOSE) if hasattr(g, "refusal") else None
        return {"summary": None, "english": None, "path": "off", "why": why or "The model is not available right now."}
    model = g.model_for(PURPOSE)
    meta = {k: c.get(k) for k in ("source", "at", "place", "lang") if c.get(k)}
    msgs = [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"<meta>{json.dumps(meta, ensure_ascii=False)}</meta>\n<source>{text}</source>"}]
    try:
        resp = client.chat.completions.create(model=model, messages=msgs, temperature=0.1, max_tokens=700,
                                              response_format={"type": "json_object"}, timeout=20)
    except Exception as e:                                     # noqa: BLE001
        try:
            g.note_error(e)
        except Exception:                                      # noqa: BLE001
            pass
        print(f"[source-card] error: summary: {type(e).__name__}: {str(e)[:200]}", flush=True)
        return {"summary": None, "english": None, "path": "off", "why": "The model did not answer."}
    _use(user_id, 1)
    u = getattr(resp, "usage", None)
    ti, to = (int(getattr(u, "prompt_tokens", 0) or 0), int(getattr(u, "completion_tokens", 0) or 0)) if u else (0, 0)
    pin, pout = g.price_for(model)
    cost = ti * pin + to * pout
    try:
        import usage_tracker
        usage_tracker.record_call(input_tokens=ti, output_tokens=to, call_type="source_summary", model=model,
                                  headline=f"source summary: {key[:90]}", item_id=key[:200], purpose=PURPOSE)
    except Exception as e:                                     # noqa: BLE001
        print(f"[source-card] error: usage not recorded: {type(e).__name__}: {e}", flush=True)
    try:
        out = json.loads(resp.choices[0].message.content or "{}")
    except (ValueError, TypeError, AttributeError, IndexError):
        out = {}
    s = str(out.get("summary") or "").strip() if isinstance(out, dict) else ""
    en = str(out.get("english") or "").strip() if isinstance(out, dict) else ""
    if not s or len(s) > MAX_SUMMARY:
        return {"summary": None, "english": None, "path": "off", "why": "The model's answer was not usable."}
    if c.get("lang") == "en" or en == (c.get("text") or "").strip():
        en = ""
    _store(key, s, en or None, model, cost)
    return {"summary": s, "english": en or None, "model": model, "path": "model"}
