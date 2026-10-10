"""
conflict_context.py — the current wars, explained: who fights, why, what is
at stake, and where each stands now.

TWO LAYERS, KEPT APART ON PURPOSE.
  - The baseline (seed/conflicts.json): the sides, their leaders, backers
    and aims, why they fight, what is at stake. Slow-moving facts, written
    into the repository and dated; an edited copy in DATA_DIR wins.
  - Where it stands now: written by a model ONLY from this system's own
    reports of the last two weeks, each sentence citing the reports it
    rests on. The cheap models' own knowledge ends in 2024 — they would
    describe Syria with Assad in power — so they are never asked what they
    know, only what the reports say. A sentence that cites nothing it was
    given is dropped; a conflict with no reports says so instead.

Refreshed in the background (main._conflict_context_loop) every six hours,
and only for a conflict whose set of reports changed.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import threading

from paths import DATA_DIR, seeded

WINDOW_DAYS = 14
MAX_REPORTS = 24
CONTEXT_MODEL = os.getenv("CONTEXT_MODEL", "gpt-4.1-mini")
_STATE = DATA_DIR / "conflict_context.json"
_lock = threading.Lock()
_seed_cache: dict = {"mtime": None, "data": None}


def baseline() -> dict:
    path = seeded("conflicts.json")
    mtime = os.path.getmtime(path)
    if _seed_cache["mtime"] != mtime:
        with open(path, encoding="utf-8") as fh:
            _seed_cache.update(mtime=mtime, data=json.load(fh))
    return _seed_cache["data"]


def _load_state() -> dict:
    try:
        return json.loads(_STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_state(state: dict) -> None:
    tmp = _STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(_STATE)


def _country_names(codes) -> set[str]:
    try:
        from location_extract import country_name_from_code
    except Exception:                                          # noqa: BLE001
        return set()
    out = set()
    for c in codes:
        n = country_name_from_code(c)
        if n:
            out.add(n.lower())
    return out


def _when(sig: dict) -> _dt.datetime | None:
    s = str(sig.get("published_at") or sig.get("posted_at") or sig.get("created_at") or "")
    try:
        d = _dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)


def reports_for(conflict: dict, signals: list[dict], now: _dt.datetime | None = None, limit: int | None = MAX_REPORTS) -> list[dict]:
    """This conflict's reports from the last two weeks, newest first: in one
    of its countries, or naming one of its sides or places."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    names = _country_names(conflict["match_countries"] if "match_countries" in conflict else conflict.get("countries") or [])
    terms = [t for t in conflict.get("watch_terms") or [] if t]
    rx = re.compile(r"\b(" + "|".join(re.escape(t) for t in terms) + r")\b", re.I) if terms else None
    out, seen = [], set()
    for s in signals:
        head = str(s.get("headline") or s.get("title") or "").strip()
        if not head:
            continue
        when = _when(s)
        if not when or (now - when).days > WINDOW_DAYS:
            continue
        country = str(s.get("location_country") or "").lower()
        if not (country in names or (rx and rx.search(head))):
            continue
        key = head.lower()[:90]
        if key in seen:
            continue
        seen.add(key)
        out.append({"id": str(s.get("id") or key), "headline": head[:220], "when": when,
                    "source": s.get("source") or s.get("source_type"), "place": s.get("location") or s.get("place"),
                    "url": s.get("url") or s.get("link")})
    out.sort(key=lambda r: r["when"], reverse=True)
    return out if limit is None else out[:limit]


def daily(reports: list[dict], now: _dt.datetime | None = None) -> list[dict]:
    """Reports per day over the window, oldest first, each with its first
    few headlines — the chart in the conflict card, and what a click on a
    day lists."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    days = [(now - _dt.timedelta(days=WINDOW_DAYS - 1 - i)).strftime("%Y-%m-%d") for i in range(WINDOW_DAYS)]
    by = {d: [] for d in days}
    for r in reports:
        d = r["when"].strftime("%Y-%m-%d")
        if d in by:
            by[d].append(r)
    return [{"date": d, "n": len(by[d]),
             "reports": [{"headline": r["headline"], "url": r["url"], "source": r["source"]} for r in by[d][:6]]} for d in days]


SYSTEM = """You write "where it stands now" for one armed conflict for an intelligence console.
Use ONLY the numbered reports given. Do not add anything from your own knowledge: it is out of
date. Every sentence names who did what, and where, and cites the numbers of the reports it rests
on. Most significant first. If the reports disagree, say so.
Leave out reports that are not about this conflict's fighting, forces or politics (anniversaries,
unrelated crime, commentary). Never write that nothing happened: return fewer items, or
{"now": []} when no report is about the conflict.
Return JSON:
{"now": [{"text": "one sentence", "cites": [numbers]}],   (2 to 5 items)
 "trend": "escalating" | "steady" | "de-escalating" | "unclear",
 "trend_why": "one sentence citing report numbers in brackets, e.g. [3][7]"}"""


def _ask(conflict: dict, reports: list[dict]) -> dict:
    import openai_gate
    client = openai_gate.get_client(openai_gate.CONTEXT)
    if client is None:
        raise RuntimeError("model unavailable")
    lines = "\n".join(f"{i+1}. [{r['when'].strftime('%d %b %Y')}{' · ' + r['place'] if r['place'] else ''}] {r['headline']}"
                      for i, r in enumerate(reports))
    user = (f"Conflict: {conflict['name']} ({conflict['sides_line']}).\n"
            f"Sides: {'; '.join(f['name'] for f in conflict.get('factions') or [])}.\n\nReports:\n{lines}")
    resp = client.chat.completions.create(
        model=CONTEXT_MODEL, temperature=0, max_tokens=900, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}])
    u = getattr(resp, "usage", None)
    if u:
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=u.prompt_tokens, output_tokens=u.completion_tokens,
                                      call_type="context", model=CONTEXT_MODEL, headline=f"conflict context · {conflict['id']}")
        except Exception:                                      # noqa: BLE001
            pass
    return json.loads(resp.choices[0].message.content or "{}")


def checked(answer: dict, reports: list[dict]) -> dict | None:
    """Keep only sentences that cite reports they were given; map the
    numbers to the reports themselves."""
    def src(n):
        r = reports[n - 1]
        return {"id": r["id"], "headline": r["headline"], "source": r["source"],
                "when": r["when"].strftime("%Y-%m-%dT%H:%MZ"), "url": r["url"]}
    now = []
    for item in (answer or {}).get("now") or []:
        text = re.sub(r"\s*\[\d+\]", "", str((item or {}).get("text") or "")).strip()
        cites = [int(c) for c in (item or {}).get("cites") or [] if str(c).isdigit() and 1 <= int(c) <= len(reports)]
        if len(text.split()) < 6 or not cites or re.search(r"\bno (recent|new) (conflict )?(events?|reports?|activity)\b", text, re.I):
            continue
        now.append({"text": text[:300], "sources": [src(c) for c in dict.fromkeys(cites)]})
    if not now:
        return None
    trend = answer.get("trend") if answer.get("trend") in ("escalating", "steady", "de-escalating", "unclear") else "unclear"
    why = str(answer.get("trend_why") or "").strip()
    why_cites = [int(c) for c in re.findall(r"\[(\d+)\]", why) if 1 <= int(c) <= len(reports)]
    return {"now": now[:5], "trend": trend,
            "trend_why": re.sub(r"\s*\[\d+\]", "", why)[:240] if why_cites else None,
            "trend_sources": [src(c) for c in dict.fromkeys(why_cites)]}


def refresh(signals: list[dict], only: set[str] | None = None) -> dict:
    """Rebuild 'where it stands now' for each conflict whose reports changed."""
    state = _load_state()
    built, skipped, empty, failed = 0, 0, 0, 0
    now = _dt.datetime.now(_dt.timezone.utc)
    for c in baseline()["conflicts"]:
        if only and c["id"] not in only:
            continue
        every = reports_for(c, signals, now, limit=None)
        reports = every[:MAX_REPORTS]
        digest = hashlib.sha1("|".join(r["id"] for r in reports).encode()).hexdigest()
        prev = state.get(c["id"]) or {}
        # The day counts cost nothing and move with every report: always.
        prev["daily"] = daily(every, now)
        state[c["id"]] = prev
        if prev.get("digest") == digest and prev.get("built_at"):
            skipped += 1
            continue
        if not reports:
            state[c["id"]] = {"digest": digest, "built_at": now.isoformat(), "now": None, "n_reports": 0, "daily": prev["daily"]}
            empty += 1
            continue
        try:
            got = checked(_ask(c, reports), reports)
        except Exception as e:                                 # noqa: BLE001
            print(f"[conflict-context] {c['id']}: {type(e).__name__}: {e}", flush=True)
            failed += 1
            continue
        if not got and prev.get("now"):
            # Nothing usable this time: keep the last good picture, with
            # its own date, rather than replace it with nothing.
            state[c["id"]] = {**prev, "digest": digest, "n_reports": len(reports)}
        else:
            state[c["id"]] = {"digest": digest, "built_at": now.isoformat(), "n_reports": len(reports), "daily": prev["daily"],
                              "as_of": reports[0]["when"].strftime("%Y-%m-%dT%H:%MZ"), **(got or {"now": None})}
        built += 1
    with _lock:
        _save_state(state)
    return {"built": built, "unchanged": skipped, "no_reports": empty, "failed": failed}


def conflicts(countries: set[str] | None = None, ids: set[str] | None = None) -> list[dict]:
    """Baseline plus where each stands now, for the API."""
    base = baseline()
    state = _load_state()
    out = []
    for c in base["conflicts"]:
        if ids and c["id"] not in ids:
            continue
        if countries and not (set(c.get("countries") or []) & countries):
            continue
        s = state.get(c["id"]) or {}
        out.append({**{k: v for k, v in c.items() if k not in ("watch_terms", "match_countries")},
                    "reviewed": base.get("reviewed"),
                    # names too: signals carry "Sudan", not "sd"
                    "country_names": sorted(_country_names(c.get("countries") or [])),
                    # report numbers stripped on read too: a state written
                    # before the stripping keeps its text until its reports change
                    "now": [{**n, "text": re.sub(r"\s*\[\d+\]", "", n.get("text") or "")} for n in s["now"]] if s.get("now") else None,
                    "trend": s.get("trend"), "trend_why": s.get("trend_why"),
                    "trend_sources": s.get("trend_sources") or [], "as_of": s.get("as_of"),
                    "n_reports": s.get("n_reports"), "built_at": s.get("built_at"), "daily": s.get("daily") or []})
    return out
