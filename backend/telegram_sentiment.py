"""
telegram_sentiment.py — the mood on Telegram, per country, over time:
how tense the talk is, and how ready people are to act.

The owner's question (2026-10-10): is tension rising in France, and the
willingness to act on it? Each post is rated once, by a cheap model, on two
small scales, in its own voice:

  tension     0 informational · 1 critical or worried · 2 angry, hostile ·
              3 rage, dehumanising language, threats
  mobilise    0 none · 1 support for action · 2 calls to gather, strike or
              block (collective action) · 3 calls to confront, attack, riot
              or take up arms, or praise of violence as the way

plus whom the hostility or the action aims at, the topic, and the country
whose situation the post is about (most posts carry no place).

Code turns those into a daily index per country, 0–100: half the mean
tension, half the share of posts calling people to act (2 or more). The
recent three days are compared with the eleven before. A reading is only as
broad as the channels joined — partisan channels speak for their side — so
every answer says which kinds of channel it rests on. Model calls go to
OpenAI through openai_gate (Claude writes briefings only).
"""
from __future__ import annotations

import datetime as _dt
import json
import sqlite3
from collections import Counter

import telegram_ingest as tg

BATCH = 25
MIN_POSTS = 12          # a country needs this many rated posts in the window to be read
WINDOW_DAYS = 14
RECENT_DAYS = 3

COLUMNS = {"mood_checked": "INTEGER", "mood_country": "TEXT", "mood_tension": "INTEGER",
           "mood_mobilise": "INTEGER", "mood_target": "TEXT", "mood_topic": "TEXT"}

SYSTEM = """You rate Telegram posts for an intelligence console, each in its own voice (not the
events it reports, but how it speaks and what it asks of its readers).
For each numbered post return an object in "results" (same order):
  tension: 0 neutral or informational | 1 critical, worried | 2 angry, hostile |
           3 rage, dehumanising language, threats
  mobilise: 0 no call to act | 1 expresses support for action or protest |
            2 calls people to gather, march, strike, block or occupy |
            3 calls to confront, attack, riot or take up arms, or praises violence as the way
  target: whom the hostility or the action is aimed at, 1-3 English words ("police",
          "the government", "migrants", "Israel"), "" if no one
  topic: 2-4 English words
  country: ISO 3166-1 alpha-2 (lowercase) of the country whose own situation the post is about,
           "" if none or several
Return JSON {"results": [...]}."""


def _con():
    con = tg._con()
    have = {r[1] for r in con.execute("PRAGMA table_info(telegram_posts)")}
    for col, typ in COLUMNS.items():
        if col not in have:
            con.execute(f"ALTER TABLE telegram_posts ADD COLUMN {col} {typ}")
    return con


def _clamp(v, hi=3):
    try:
        return max(0, min(hi, int(v)))
    except (TypeError, ValueError):
        return None


def read_mood(limit: int = 75, days: int = WINDOW_DAYS) -> dict:
    """Rate posts not yet rated, newest first."""
    import openai_gate
    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None:
        return {"mood": "no model"}
    model = openai_gate.model_for(openai_gate.ENRICH)
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=days)).isoformat()
    con = _con()
    rows = con.execute("SELECT channel, msg_id, channel_title, posted_at, text FROM telegram_posts"
                       " WHERE mood_checked IS NULL AND posted_at >= ? AND text IS NOT NULL AND length(text) > 30"
                       " ORDER BY posted_at DESC LIMIT ?", (cutoff, limit)).fetchall()
    rated = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        numbered = "\n\n".join(f"{k+1}. [{r[2] or r[0]}] {(r[4] or '')[:700]}" for k, r in enumerate(chunk))
        try:
            resp = client.chat.completions.create(
                model=model, temperature=0, max_tokens=2200, response_format={"type": "json_object"},
                messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": numbered}])
            res = json.loads(resp.choices[0].message.content or "{}").get("results") or []
            u = getattr(resp, "usage", None)
            if u:
                try:
                    import usage_tracker
                    usage_tracker.record_call(input_tokens=u.prompt_tokens, output_tokens=u.completion_tokens,
                                              call_type="telegram", model=model, headline=f"mood · {len(chunk)} posts")
                except Exception:                              # noqa: BLE001
                    pass
        except Exception as e:                                 # noqa: BLE001
            print(f"[telegram-mood] pass failed: {type(e).__name__}: {e}", flush=True)
            continue
        for r, x in zip(chunk, res):
            x = x or {}
            cc = str(x.get("country") or "").strip().lower()
            con.execute("UPDATE telegram_posts SET mood_checked=1, mood_country=?, mood_tension=?, mood_mobilise=?,"
                        " mood_target=?, mood_topic=? WHERE channel=? AND msg_id=?",
                        (cc if len(cc) == 2 else None, _clamp(x.get("tension")), _clamp(x.get("mobilise")),
                         (str(x.get("target") or "").strip()[:40] or None), (str(x.get("topic") or "").strip()[:60] or None),
                         r[0], r[1]))
            rated += 1
        con.commit()
    con.close()
    return {"mood_rated": rated}


def index_of(tensions: list, mobilises: list) -> int | None:
    """0–100: half the mean tension (of 3), half the share calling to act."""
    t = [x for x in tensions if x is not None]
    m = [x for x in mobilises if x is not None]
    if not t and not m:
        return None
    mean_t = sum(t) / len(t) if t else 0
    calls = sum(1 for x in m if x >= 2) / len(m) if m else 0
    return round(100 * (0.5 * mean_t / 3 + 0.5 * calls))


def _rows(country: str | None, since: str):
    con = _con()
    con.row_factory = sqlite3.Row
    q = ("SELECT channel, msg_id, channel_title, posted_at, text, summary_en, role, mood_country, mood_tension,"
         " mood_mobilise, mood_target, mood_topic FROM telegram_posts WHERE mood_checked=1 AND posted_at >= ?")
    args = [since]
    if country:
        q += " AND mood_country=?"
        args.append(country)
    rows = con.execute(q + " ORDER BY posted_at", args).fetchall()
    con.close()
    return rows


def series(country: str, days: int = WINDOW_DAYS, now: _dt.datetime | None = None, rows=None) -> dict:
    """Daily index for one country, with the recent change and the posts
    that call people to act."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    start = (now - _dt.timedelta(days=days - 1)).strftime("%Y-%m-%d")
    rows = rows if rows is not None else _rows(country.lower(), start)
    dates = [(now - _dt.timedelta(days=days - 1 - i)).strftime("%Y-%m-%d") for i in range(days)]
    by = {d: [] for d in dates}
    for r in rows:
        d = str(r["posted_at"])[:10]
        if d in by:
            by[d].append(r)
    out_days = []
    for d in dates:
        rs = by[d]
        out_days.append({
            "date": d, "n": len(rs),
            "index": index_of([r["mood_tension"] for r in rs], [r["mood_mobilise"] for r in rs]),
            "calls": sum(1 for r in rs if (r["mood_mobilise"] or 0) >= 2),
            "violent_calls": sum(1 for r in rs if (r["mood_mobilise"] or 0) >= 3),
        })
    recent = [r for d in dates[-RECENT_DAYS:] for r in by[d]]
    before = [r for d in dates[:-RECENT_DAYS] for r in by[d]]
    now_ix = index_of([r["mood_tension"] for r in recent], [r["mood_mobilise"] for r in recent])
    base_ix = index_of([r["mood_tension"] for r in before], [r["mood_mobilise"] for r in before])
    allr = recent + before
    calls = sorted((r for r in allr if (r["mood_mobilise"] or 0) >= 2), key=lambda r: r["posted_at"], reverse=True)
    return {
        "country": country.lower(), "days": out_days, "n": len(allr),
        "index_recent": now_ix, "index_before": base_ix,
        "index_window": index_of([r["mood_tension"] for r in allr], [r["mood_mobilise"] for r in allr]),
        "n_recent": len(recent),
        "change": (now_ix - base_ix) if now_ix is not None and base_ix is not None else None,
        "targets": [t for t, _ in Counter(r["mood_target"] for r in allr if r["mood_target"]).most_common(5)],
        "topics": [t for t, _ in Counter(r["mood_topic"] for r in allr if r["mood_topic"]).most_common(5)],
        "sources": dict(Counter(r["role"] or "aggregator" for r in allr)),
        "calls": [{"channel": r["channel_title"] or r["channel"], "posted_at": r["posted_at"], "mobilise": r["mood_mobilise"],
                   "target": r["mood_target"], "topic": r["mood_topic"], "role": r["role"],
                   "text": (r["summary_en"] or r["text"] or "")[:280],
                   "url": None if str(r["channel"]).startswith("c/") else f"https://t.me/{r['channel']}/{r['msg_id']}"}
                  for r in calls[:12]],
    }


def countries(days: int = WINDOW_DAYS, now: _dt.datetime | None = None) -> list[dict]:
    """Every country with enough rated posts, the sharpest rise first."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    start = (now - _dt.timedelta(days=days - 1)).strftime("%Y-%m-%d")
    by: dict[str, list] = {}
    for r in _rows(None, start):
        if r["mood_country"]:
            by.setdefault(r["mood_country"], []).append(r)
    try:
        from location_extract import country_name_from_code
    except Exception:                                          # noqa: BLE001
        country_name_from_code = lambda c: None  # noqa: E731
    out = []
    for cc, rows in by.items():
        if len(rows) < MIN_POSTS:
            continue
        s = series(cc, days, now, rows)
        out.append({"country": cc, "name": country_name_from_code(cc) or cc.upper(), "n": s["n"],
                    "index_window": s["index_window"], "index_recent": s["index_recent"], "change": s["change"],
                    "topics": s["topics"][:2]})
    # The sharpest rise first; without a comparison (no recent or no
    # earlier posts), the highest two-week index.
    out.sort(key=lambda x: (x["change"] is None, -(x["change"] or 0), -(x["index_window"] or 0)))
    return out
