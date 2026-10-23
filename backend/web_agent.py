"""
web_agent.py — the web agent (owner, 2026-10-23): "like Dataminr, have the web
agent", "when we have 'shots fired at Trappes, Yvelines' we should have the web
agent give us more information on what actually happened there", and "when
it's 100% sure and corroborated with information across multiple domains,
place signals on the map so we have them near real time".

THREE USES, ONE CALL.
  research()      one OpenAI Responses API call with the web_search tool
                  (openai_gate purpose 'web_agent'). The assistant's
                  `web_search` tool imports it; keep the signature.
  enrich_once()   an important live signal (shots, explosion, strike, missile,
                  arrest, police action) at a WATCHED point (a user's theater,
                  position or asset, watch_gate's union) gets one research call
                  "what happened at <place>, <act>, <time>", at most once per
                  incident; the answer is attached to the signal on read as
                  `web_context` (the card's "What we found").
  autoplace_once() OFF unless WEB_AGENT_AUTOPLACE=1. One watched focus area per
                  pass is searched for recent incidents; a signal is placed
                  ONLY when corroborate() accepts it (below).

MODEL EXTRACTS, CODE DECIDES (memory: model extracts, code resolves).
  * A finding's URL must be one the search tool itself returned (its sources or
    its url_citation annotations): a URL the model wrote is never kept.
  * Places: the model gives the place AS WRITTEN with its level and context;
    the code geocodes it (live_incident.resolve_place: level must match,
    homonyms rejected). The model never gives coordinates.
  * Times are parsed in code; one in the future is dropped.

CORROBORATION (autoplace). A web signal is created only when ALL hold:
  * at least MIN_SOURCES (2) independent reputable sources: different
    registrable domains, none on the blocklist (social media, aggregators,
    wikis, blogs), and not reposts of each other (near-identical titles count
    once);
  * the place resolves to a specific point (venue, street, neighbourhood or
    city level), the same act at places within GROUP_KM;
  * the incident (or its first report) is inside the last AUTOPLACE_HOURS;
  * not a duplicate of an existing signal (DEDUP_KM, DEDUP_MIN, same act
    family): a duplicate is merged into that signal instead (its citations
    become the signal's web context and count as corroboration).
  Our own data nearby (a Telegram post with a position, a news title naming
  the place) is recorded as cross-domain support and said on the card.

SPEND (owner rule, memory "model calls where watched"): only for watched
points; caps per user per day, per incident (once), per hour/day for the
enrichment, per day for autoplace, a global USD per day, and a per-call
estimate ceiling — all env-tunable — under openai_gate's monthly budget. Each
call is written to usage_tracker (tokens + the search fee) so it counts
against OPENAI_BUDGET_USD. Answers are cached per (query, place, day).

DERIVED ON READ. Stored: research answers, enrichment answers, placed web
signals (data/web_agent.db). decorate() joins them onto live_signals' build.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import math
import os
import re
import sqlite3
import threading
import time
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode


def _env_f(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)) or default)
    except ValueError:
        return default


def _env_i(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)) or default)
    except ValueError:
        return default


def _env_b(name: str, default: str = "0") -> bool:
    return (os.getenv(name, default) or default).strip().lower() in ("1", "true", "yes", "on")


PURPOSE = "web_agent"
MODEL = (os.getenv("WEB_AGENT_MODEL") or "gpt-4.1-mini").strip()   # web_search needs 4o-mini / 4.1-mini or larger
ENABLED = _env_b("WEB_AGENT_ENABLED", "1")
SEARCH_FEE_USD = _env_f("WEB_AGENT_SEARCH_FEE_USD", 0.01)           # OpenAI's per-search fee
SEARCH_BLOCK_TOKENS = _env_i("WEB_AGENT_SEARCH_BLOCK_TOKENS", 8000)  # search content billed as input (estimate only)
MAX_OUTPUT_TOKENS = _env_i("WEB_AGENT_MAX_OUTPUT_TOKENS", 1200)
MAX_CALL_USD = _env_f("WEB_AGENT_MAX_CALL_USD", 0.05)               # a call whose estimate exceeds this is not made
DAILY_USD = _env_f("WEB_AGENT_DAILY_USD", 0.50)                     # all web-agent calls, per UTC day
USER_PER_DAY = _env_i("WEB_AGENT_USER_PER_DAY", 10)                 # research() calls per signed-in user per day
ENRICH_PER_HOUR = _env_i("WEB_AGENT_ENRICH_PER_HOUR", 4)
ENRICH_PER_DAY = _env_i("WEB_AGENT_ENRICH_PER_DAY", 15)
ENRICH_DELAY_MIN = _env_f("WEB_AGENT_ENRICH_DELAY_MIN", 5)          # let outlets publish before asking
ENRICH_ACTS = frozenset((os.getenv("WEB_AGENT_ENRICH_ACTS") or
                         "shots_fired,explosion,strike,missile_launch,missile_impact,arrest,police_intervention").split(","))
AUTOPLACE = _env_b("WEB_AGENT_AUTOPLACE", "0")
AUTOPLACE_PER_DAY = _env_i("WEB_AGENT_AUTOPLACE_PER_DAY", 12)
AUTOPLACE_EVERY_MIN = _env_f("WEB_AGENT_AUTOPLACE_EVERY_MIN", 30)
AUTOPLACE_AREA_GAP_MIN = _env_f("WEB_AGENT_AUTOPLACE_AREA_GAP_MIN", 120)
AUTOPLACE_HOURS = _env_f("WEB_AGENT_AUTOPLACE_HOURS", 3)
AUTOPLACE_MAX_REACH_KM = _env_f("WEB_AGENT_AUTOPLACE_MAX_REACH_KM", 400)   # watch_gate.FOCUS_KM: city-scale areas only
MIN_SOURCES = max(2, _env_i("WEB_AGENT_MIN_SOURCES", 2))
TIMEOUT_S = _env_f("WEB_AGENT_TIMEOUT_S", 45)
MAX_FINDINGS = 6
GEOCODES_PER_CALL = 6
HINT_KM = 100.0             # a finding placed further than this from the asked-about point keeps no coordinates
GROUP_KM = 5.0
GROUP_MIN = 180.0
DEDUP_KM = 3.0
DEDUP_MIN = 90.0
SKEW_MIN = 5.0
LIVE_WINDOW_MIN = 60        # live_signals.LIVE_WINDOW_MIN: a web signal is drawn 60 min after its latest report

# not independent reporting: social media, aggregators, wikis, blogs, video
BLOCKED = frozenset("""
x.com twitter.com facebook.com instagram.com tiktok.com youtube.com youtu.be reddit.com t.me telegram.me telegram.org
vk.com ok.ru threads.net bsky.app mastodon.social linkedin.com pinterest.com snapchat.com rumble.com
news.google.com google.com msn.com yahoo.com flipboard.com newsbreak.com ground.news inkl.com newsnow.co.uk
pressreader.com newsnow.com bing.com duckduckgo.com allsides.com feedly.com
wikipedia.org wikimedia.org medium.com substack.com blogspot.com wordpress.com tumblr.com quora.com
liveuamap.com
""".split()) | frozenset(d.strip().lower() for d in (os.getenv("WEB_AGENT_BLOCK_DOMAINS") or "").split(",") if d.strip())

_SECOND_LEVEL = {"co", "com", "org", "net", "gov", "ac", "edu", "gouv", "govt", "nic", "or", "ne", "go"}
_TRACKING = re.compile(r"^(utm_|fbclid|gclid|mc_|ref$|ref_|cmpid|xtor|at_)", re.I)

_LOCK = threading.Lock()
STATS = {"research_calls": 0, "cache_hits": 0, "skipped": {}, "dropped_urls": 0, "enrich_runs": 0,
         "autoplace_runs": 0, "placed": 0, "merged": 0, "rejected": {}}


# ── small pure helpers ──────────────────────────────────────────────────────

def _now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _iso(d: _dt.datetime | None) -> str | None:
    return d.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def parse_time(v) -> _dt.datetime | None:
    if not v or not isinstance(v, str):
        return None
    s = v.strip().replace("Z", "+00:00")
    try:
        d = _dt.datetime.fromisoformat(s)
    except ValueError:
        try:
            d = _dt.datetime.strptime(s[:10], "%Y-%m-%d")
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=_dt.timezone.utc)
    return d.astimezone(_dt.timezone.utc)


def norm_text(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).casefold()


def norm_url(u: str | None) -> str | None:
    """One spelling per article: scheme and host lower case, no www, no
    fragment, no tracking parameters, no trailing slash."""
    if not u or not isinstance(u, str):
        return None
    try:
        p = urlsplit(u.strip())
    except ValueError:
        return None
    if p.scheme not in ("http", "https") or not p.netloc:
        return None
    host = p.netloc.lower()
    host = host[4:] if host.startswith("www.") else host
    q = urlencode([(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if not _TRACKING.match(k)])
    path = p.path.rstrip("/") or "/"
    return urlunsplit(("https", host, path, q, ""))


def domain_of(u: str | None) -> str | None:
    """The registrable domain (bbc.co.uk, lemonde.fr), by a small rule: no public-suffix list."""
    try:
        host = (urlsplit(u or "").hostname or "").lower().strip(".")
    except ValueError:
        return None
    if not host:
        return None
    parts = host.split(".")
    if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in _SECOND_LEVEL:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def blocked(domain: str | None) -> bool:
    if not domain:
        return True
    return domain in BLOCKED or any(domain.endswith("." + b) for b in BLOCKED)


def km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.radians
    h = (math.sin(r(b_lat - a_lat) / 2) ** 2 + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lon - a_lon) / 2) ** 2)
    return 12742 * math.asin(math.sqrt(min(1.0, h)))


def _words(s: str | None) -> set[str]:
    return {w for w in re.findall(r"\w{3,}", norm_text(s)) if not w.isdigit()}


def repost(a: str | None, b: str | None) -> bool:
    """Two headlines that are the same copy (a wire story run by two sites, a rewrite of one article)."""
    wa, wb = _words(a), _words(b)
    if len(wa) < 3 or len(wb) < 3:
        return False
    return len(wa & wb) / min(len(wa), len(wb)) >= 0.8


def _day(now: _dt.datetime | None = None) -> str:
    return (now or _now()).strftime("%Y-%m-%d")


def cache_key(query: str, place: str | None, day: str) -> str:
    return hashlib.sha1(f"{norm_text(query)}|{norm_text(place)}|{day}".encode("utf-8")).hexdigest()[:32]


# ── storage ─────────────────────────────────────────────────────────────────

DDL = (
    "CREATE TABLE IF NOT EXISTS research_cache (key TEXT PRIMARY KEY, query TEXT, place TEXT, day TEXT, at REAL, result TEXT)",
    "CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL, day TEXT, user TEXT, kind TEXT,"
    " cost REAL, query TEXT, ok INTEGER, error TEXT)",
    "CREATE INDEX IF NOT EXISTS ix_calls_day ON calls (day)",
    "CREATE TABLE IF NOT EXISTS enrichments (item_id TEXT PRIMARY KEY, at REAL, lat REAL, lon REAL, act TEXT,"
    " event_time TEXT, query TEXT, result TEXT)",
    "CREATE TABLE IF NOT EXISTS web_signals (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, act TEXT, place TEXT,"
    " context TEXT, country_code TEXT, lat REAL, lon REAL, level TEXT, incident_time TEXT, reported_at TEXT,"
    " n_sources INTEGER, domains TEXT, citations TEXT, cross TEXT, summary TEXT)",
    "CREATE TABLE IF NOT EXISTS areas (key TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, last_searched REAL)",
    "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)",
)


def _db_path() -> str:
    from paths import data_path
    return str(data_path("web_agent.db"))


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(_db_path(), timeout=30)
    con.row_factory = sqlite3.Row
    for d in DDL:
        con.execute(d)
    return con


def _kv_set(con, k: str, v) -> None:
    con.execute("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", (k, json.dumps(v)))


def _kv_get(con, k: str, default=None):
    r = con.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    if not r:
        return default
    try:
        return json.loads(r["v"])
    except (TypeError, ValueError):
        return default


def note_error(where: str, e: BaseException | str) -> None:
    """Never silent (memory: silent failure pattern): logged, and on /api/web-agent/status."""
    msg = f"{where}: {type(e).__name__}: {e}" if isinstance(e, BaseException) else f"{where}: {e}"
    print(f"[web-agent] error: {msg[:300]}", flush=True)
    try:
        with _con() as con:
            _kv_set(con, "last_error", {"at": _iso(_now()), "error": msg[:500]})
    except sqlite3.Error:
        pass


def _bump(key: str, sub: str | None = None) -> None:
    with _LOCK:
        if sub is None:
            STATS[key] = STATS.get(key, 0) + 1
        else:
            STATS[key][sub] = STATS[key].get(sub, 0) + 1


def spent_today(con, day: str | None = None) -> float:
    r = con.execute("SELECT COALESCE(SUM(cost), 0) FROM calls WHERE day=?", (day or _day(),)).fetchone()
    return float(r[0] or 0.0)


def calls_today(con, *, user: str | None = None, kind: str | None = None, since: float | None = None,
                day: str | None = None) -> int:
    q, args = "SELECT COUNT(*) FROM calls WHERE day=?", [day or _day()]
    if user is not None:
        q += " AND user=?"
        args.append(user)
    if kind is not None:
        q += " AND kind=?"
        args.append(kind)
    if since is not None:
        q += " AND at>=?"
        args.append(since)
    return int(con.execute(q, args).fetchone()[0])


# ── the model ───────────────────────────────────────────────────────────────

INSTRUCTIONS = """You research news for a security monitoring app. Use web search to answer the question with
recent, specific reporting. Answer with JSON only, no prose around it:
{"findings": [{"title": "<the article's headline, in English>",
               "url": "<the article's URL exactly as the search returned it>",
               "source": "<the outlet's name>",
               "published_at": "<ISO 8601 UTC publication time, or null>",
               "summary": "<one or two sentences in English: what this article says happened. Facts only, with numbers as written.>",
               "place": "<the most specific place the article names for the incident, as written, e.g. 'Trappes'>",
               "place_level": "venue|street|neighborhood|city|region|country",
               "place_context": ["<the city, region and country the article gives for that place>"],
               "act": "shots_fired|explosion|strike|missile_launch|missile_impact|arrest|police_intervention|crowd_movement|troops_sighted|other",
               "event_time": "<ISO 8601 UTC time of the incident if the article states it, else null>"}],
 "note": "<one sentence in English: what is established overall, or 'Nothing found.'>"}
Rules:
- One finding per article, at most 6, newest first. Only articles the search returned; never write a URL yourself.
- News outlets and official sources only: no social media posts, aggregators, wikis or blogs.
- Never give coordinates. Never guess a place or a time the article does not state.
- If nothing relevant was found, answer {"findings": [], "note": "Nothing found."}."""


def _client():
    import openai_gate
    return openai_gate.get_client(PURPOSE)


def _price(model: str) -> tuple[float, float]:
    import openai_gate
    return openai_gate.price_for(model)


def estimate_call_usd(model: str | None = None, prompt_chars: int = 2500) -> float:
    pin, pout = _price(model or MODEL)
    return SEARCH_FEE_USD + (prompt_chars / 4 + SEARCH_BLOCK_TOKENS) * pin + MAX_OUTPUT_TOKENS * pout


def _search(client, instructions: str, prompt: str, user_location: dict | None = None) -> dict:
    """One Responses API call with the web_search tool. -> {text, urls, input_tokens, output_tokens, searches, model}.
    Tests replace this function; no test reaches the network."""
    tool = {"type": "web_search", "search_context_size": "low"}
    if user_location:
        tool["user_location"] = {"type": "approximate", **user_location}
    resp = client.with_options(timeout=TIMEOUT_S).responses.create(
        model=MODEL, instructions=instructions, input=prompt, tools=[tool], tool_choice="auto",
        include=["web_search_call.action.sources"], max_output_tokens=MAX_OUTPUT_TOKENS, temperature=0)
    urls: dict[str, str] = {}
    searches = 0
    text_parts = []
    for item in getattr(resp, "output", None) or []:
        typ = getattr(item, "type", None)
        if typ == "web_search_call":
            searches += 1
            action = getattr(item, "action", None)
            for s in (getattr(action, "sources", None) or []):
                u = getattr(s, "url", None) or (s.get("url") if isinstance(s, dict) else None)
                if u:
                    urls[u] = ""
        elif typ == "message":
            for c in getattr(item, "content", None) or []:
                t = getattr(c, "text", None)
                if t:
                    text_parts.append(t)
                for a in getattr(c, "annotations", None) or []:
                    if getattr(a, "type", None) == "url_citation" and getattr(a, "url", None):
                        urls[a.url] = getattr(a, "title", "") or ""
    usage = getattr(resp, "usage", None)
    return {"text": "".join(text_parts) or (getattr(resp, "output_text", "") or ""), "urls": urls,
            "input_tokens": int(getattr(usage, "input_tokens", 0) or 0) if usage else 0,
            "output_tokens": int(getattr(usage, "output_tokens", 0) or 0) if usage else 0,
            "searches": searches, "model": getattr(resp, "model", None) or MODEL}


def parse_answer(text: str | None) -> dict:
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    i, j = t.find("{"), t.rfind("}")
    if i < 0 or j <= i:
        return {}
    try:
        d = json.loads(t[i:j + 1])
    except ValueError:
        return {}
    return d if isinstance(d, dict) else {}


def _geocoder():
    from geocode_utils import geocode_place
    return geocode_place


def resolve(place: str | None, level: str | None, context, *, geocode=None, budget: list | None = None) -> dict | None:
    """The finding's place as written -> {lat, lon, level, country_code, label} by live_incident's resolver
    (the stated level must match, homonyms rejected). None when not a point (region, country, ambiguous)."""
    import live_incident as li
    name = (place or "").strip()
    level = (level or "").strip().lower()
    if len(name) < 2 or level not in li.PIN_LEVELS:
        return None
    ctx = [c.strip() for c in (context or []) if isinstance(c, str) and c.strip()][:3]
    text = ", ".join([name] + ctx)
    try:
        hit, _why, _info = li.resolve_place(name, level, ctx, text, geocode=geocode or _geocoder(), budget=budget)
    except Exception as e:                                     # noqa: BLE001
        print(f"[web-agent] error: resolving {name!r}: {type(e).__name__}: {e}", flush=True)
        return None
    if not hit or hit.get("lat") is None:
        return None
    lvl = (_info or {}).get("fallback_level") or level
    return {"lat": round(float(hit["lat"]), 5), "lon": round(float(hit["lon"]), 5), "level": lvl,
            "country_code": ((hit.get("address") or {}).get("country_code") or hit.get("country_code") or "").lower() or None,
            "label": text}


def verify_findings(raw: dict, urls: dict, *, now: _dt.datetime, lat=None, lon=None, since_hours=None,
                    geocode=None) -> tuple[list[dict], int]:
    """The model's findings kept only when the code can stand behind them. -> (findings, dropped)."""
    import live_incident as li
    allowed = {norm_url(u) for u in urls}
    allowed.discard(None)
    out, seen, dropped = [], set(), 0
    budget = [GEOCODES_PER_CALL]
    since = now - _dt.timedelta(hours=float(since_hours)) if since_hours else None
    for f in (raw.get("findings") or [])[: MAX_FINDINGS * 2]:
        if not isinstance(f, dict):
            continue
        u = norm_url(f.get("url"))
        if not u or u not in allowed or u in seen:
            dropped += 1                                       # a URL the search did not return: never kept
            continue
        summary = str(f.get("summary") or "").strip()
        title = str(f.get("title") or "").strip()
        if not summary and not title:
            dropped += 1
            continue
        pub = parse_time(f.get("published_at"))
        if pub and pub > now + _dt.timedelta(minutes=SKEW_MIN):
            pub = None
        if since and pub and pub < since:
            dropped += 1
            continue
        ev = parse_time(f.get("event_time"))
        if ev and ev > now + _dt.timedelta(minutes=SKEW_MIN):
            ev = None
        seen.add(u)
        dom = domain_of(u)
        place = str(f.get("place") or "").strip()[:120] or None
        ctx = f.get("place_context") if isinstance(f.get("place_context"), list) else []
        where = resolve(place, f.get("place_level"), ctx, geocode=geocode, budget=budget) if place else None
        if where and lat is not None and lon is not None and km(lat, lon, where["lat"], where["lon"]) > HINT_KM:
            where = None                                       # a namesake far from the place asked about
        act = f.get("act") if f.get("act") in li.ACTS else None
        original = next((x for x in urls if norm_url(x) == u), f.get("url"))
        out.append({
            "title": title[:240], "url": original, "source": (str(f.get("source") or "").strip()[:80] or dom),
            "domain": dom, "published_at": _iso(pub), "summary": summary[:600],
            "lat": where["lat"] if where else None, "lon": where["lon"] if where else None,
            "place": place, "place_context": [str(c)[:60] for c in ctx[:3]],
            "level": where["level"] if where else (str(f.get("place_level") or "").lower() or None),
            "country_code": where["country_code"] if where else None,
            "act": act, "event_time": _iso(ev),
        })
        if len(out) >= MAX_FINDINGS:
            break
    return out, dropped


# ── research ────────────────────────────────────────────────────────────────

def _empty(note: str, **extra) -> dict:
    return {"findings": [], "spent_usd": 0.0, "note": note, **extra}


def _record_usage(model: str, res: dict, cost_fee: float, item: str) -> None:
    try:
        import usage_tracker
        usage_tracker.record_call(input_tokens=res.get("input_tokens", 0), output_tokens=res.get("output_tokens", 0),
                                  call_type="web_agent", model=model, headline=f"web search: {item[:90]}",
                                  item_id=item[:200], extra_cost_usd=cost_fee)
    except Exception as e:                                     # noqa: BLE001
        print(f"[web-agent] error: usage not recorded: {type(e).__name__}: {e}", flush=True)


def _research(query: str, *, lat=None, lon=None, place=None, since_hours=None, user=None, kind: str = "tool",
              now: _dt.datetime | None = None, geocode=None) -> dict:
    now = now or _now()
    q = re.sub(r"\s+", " ", str(query or "")).strip()[:400]
    if len(q) < 3:
        return _empty("Nothing to search for.")
    day = _day(now)
    key = cache_key(q, place, day)
    uid = str(user.get("id") or user.get("email")) if isinstance(user, dict) else (str(user) if user else None)
    with _con() as con:
        r = con.execute("SELECT result FROM research_cache WHERE key=?", (key,)).fetchone()
        if r:
            _bump("cache_hits")
            try:
                d = json.loads(r["result"])
                return {**d, "spent_usd": 0.0, "cached": True}
            except (TypeError, ValueError):
                pass
        if not ENABLED:
            _bump("skipped", "disabled")
            return _empty("The web agent is switched off (WEB_AGENT_ENABLED=0).")
        if uid and calls_today(con, user=uid, day=day) >= USER_PER_DAY:
            _bump("skipped", "user_cap")
            return _empty(f"Daily web search limit reached for this user ({USER_PER_DAY} a day).")
        est = estimate_call_usd(MODEL, len(INSTRUCTIONS) + len(q) + 200)
        if est > MAX_CALL_USD:
            _bump("skipped", "call_cap")
            return _empty(f"A web search would cost about ${est:.3f}, over the per-call cap ${MAX_CALL_USD:.3f}.")
        if spent_today(con, day) + est > DAILY_USD:
            _bump("skipped", "daily_cap")
            return _empty(f"The web agent's daily budget (${DAILY_USD:.2f}) is spent; it resumes tomorrow (UTC).")
    client = _client()
    if client is None:
        _bump("skipped", "no_model")
        return _empty("The web agent's model is unavailable (purpose off, monthly budget spent, out of credit or no key).")
    since_line = ""
    if since_hours:
        since_line = f"\nOnly reporting published after {_iso(now - _dt.timedelta(hours=float(since_hours)))}."
    prompt = f"Question: {q}" + (f"\nPlace: {place}" if place else "") + since_line + f"\nNow: {_iso(now)}"
    loc = None                                                 # the question names the place; lat/lon check the answers
    import openai_gate
    _bump("research_calls")
    try:
        res = _search(client, INSTRUCTIONS, prompt, loc)
        openai_gate.note_ok()
    except Exception as e:                                     # noqa: BLE001
        openai_gate.note_error(e)
        note_error("research", e)
        with _con() as con:
            con.execute("INSERT INTO calls (at, day, user, kind, cost, query, ok, error) VALUES (?,?,?,?,?,?,0,?)",
                        (time.time(), day, uid, kind, 0.0, q, f"{type(e).__name__}: {str(e)[:200]}"))
        return _empty("The web search failed; nothing was found.")
    model = res.get("model") or MODEL
    pin, pout = _price(model)
    fee = SEARCH_FEE_USD * max(1, int(res.get("searches") or 0))
    cost = round(res.get("input_tokens", 0) * pin + res.get("output_tokens", 0) * pout + fee, 6)
    _record_usage(model, res, fee, q)
    raw = parse_answer(res.get("text"))
    findings, dropped = verify_findings(raw, res.get("urls") or {}, now=now, lat=lat, lon=lon,
                                        since_hours=since_hours, geocode=geocode)
    if dropped:
        with _LOCK:
            STATS["dropped_urls"] += dropped
    note = str(raw.get("note") or "").strip()[:400] if raw else ""
    if not raw:
        note = "The web search answered in a form we could not read."
    elif not findings:
        note = note if note and "nothing" in note.lower() else "Nothing found that the search itself cited."
    out = {"findings": findings, "spent_usd": cost, "note": note, "query": q, "searched_at": _iso(now)}
    with _con() as con:
        con.execute("INSERT INTO calls (at, day, user, kind, cost, query, ok, error) VALUES (?,?,?,?,?,?,1,NULL)",
                    (time.time(), day, uid, kind, cost, q))
        if raw:
            con.execute("INSERT OR REPLACE INTO research_cache (key, query, place, day, at, result) VALUES (?,?,?,?,?,?)",
                        (key, q, place, day, time.time(), json.dumps({k: v for k, v in out.items() if k != "spent_usd"})))
    return out


def research(query, *, lat=None, lon=None, place=None, since_hours=None, user=None) -> dict:
    """Search the web for `query` (optionally about `place`, near lat/lon, only reporting from the last
    `since_hours`). -> {"findings": [{title, url, source, published_at, summary, lat, lon, place, ...}],
    "spent_usd", "note"}. Cached per (query, place, UTC day); capped per user (`user`: the signed-in user's
    dict or id), per day and per call. Never raises."""
    try:
        return _research(query, lat=lat, lon=lon, place=place, since_hours=since_hours, user=user,
                         kind="user" if user else "tool")
    except Exception as e:                                     # noqa: BLE001
        note_error("research", e)
        return _empty("The web agent failed; nothing was found.")


# ── where someone watches ───────────────────────────────────────────────────

def _watch() -> dict:
    import watch_gate
    return watch_gate.watched()


def watched_point(lat, lon, w: dict) -> str | None:
    """The name of the watched point (a theater, a position, an asset) this place lies in, else None.
    A whole watched COUNTRY is not enough to spend a web search, and an open gate (no profiles) is not either."""
    if lat is None or lon is None:
        return None
    for p in (w or {}).get("points") or []:
        try:
            if km(float(p["lat"]), float(p["lon"]), float(lat), float(lon)) <= float(p["reach"]):
                return p.get("name") or "a watched place"
        except (KeyError, TypeError, ValueError):
            continue
    return None


# ── enrichment: what happened at <place> ────────────────────────────────────

def enrichment_query(sig: dict) -> str:
    import live_incident as li
    act = li.act_label(sig.get("act")).lower()
    where = ", ".join([x for x in [sig.get("place")] + list(sig.get("context") or [])[:1] if x])
    t = parse_time(sig.get("first_event_time") or sig.get("event_time"))
    when = t.strftime("%d %B %Y around %H:%M UTC") if t else "today"
    return f"What happened at {where}: {act} reported on {when}? Who was involved, casualties, what the authorities say."


def _enriched(con, sig: dict) -> bool:
    if con.execute("SELECT 1 FROM enrichments WHERE item_id=?", (sig["id"],)).fetchone():
        return True
    t = parse_time(sig.get("first_event_time") or sig.get("event_time"))
    for r in con.execute("SELECT lat, lon, act, event_time FROM enrichments WHERE at>=?", (time.time() - 12 * 3600,)):
        rt = parse_time(r["event_time"])
        if (r["act"] == sig.get("act") and km(r["lat"], r["lon"], sig["lat"], sig["lon"]) <= DEDUP_KM
                and t and rt and abs((t - rt).total_seconds()) / 60 <= DEDUP_MIN):
            return True                                        # the same incident under another id
    return False


def enrich_once(*, now: _dt.datetime | None = None, signals: list[dict] | None = None, watch: dict | None = None,
                max_runs: int = 1, geocode=None) -> dict:
    """One research call for the newest important live signal at a watched point that has none yet."""
    now = now or _now()
    out = {"considered": 0, "enriched": 0, "skipped": None}
    if signals is None:
        import live_signals
        signals = live_signals.signals()
    w = watch if watch is not None else _watch()
    with _con() as con:
        hour = calls_today(con, kind="enrich", since=time.time() - 3600)
        today = calls_today(con, kind="enrich")
    for s in signals:
        if out["enriched"] >= max_runs:
            break
        if s.get("source_kind") == "web" or s.get("act") not in ENRICH_ACTS or s.get("lat") is None:
            continue
        t = parse_time(s.get("first_event_time") or s.get("event_time"))
        if not t or (now - t).total_seconds() / 60 < ENRICH_DELAY_MIN:
            continue
        where = watched_point(s["lat"], s["lon"], w)
        if not where:
            continue
        out["considered"] += 1
        with _con() as con:
            if _enriched(con, s):
                continue
        if hour >= ENRICH_PER_HOUR or today >= ENRICH_PER_DAY:
            out["skipped"] = "enrichment cap"
            _bump("skipped", "enrich_cap")
            break
        q = enrichment_query(s)
        place = ", ".join([x for x in [s.get("place")] + list(s.get("context") or [])[:1] if x])
        res = _research(q, lat=s["lat"], lon=s["lon"], place=place, since_hours=12, kind="enrich", now=now, geocode=geocode)
        if not res.get("query") and not res.get("cached"):
            out["skipped"] = res.get("note")                   # a cap or the model off: try again later, nothing stored
            break
        ctx = {"summary": res.get("note"), "findings": res.get("findings") or [], "query": q,
               "checked_at": res.get("searched_at") or _iso(now), "watched": where}
        with _con() as con:
            con.execute("INSERT OR REPLACE INTO enrichments (item_id, at, lat, lon, act, event_time, query, result)"
                        " VALUES (?,?,?,?,?,?,?,?)", (s["id"], time.time(), s["lat"], s["lon"], s.get("act"),
                                                      _iso(t), q, json.dumps(ctx)))
        hour += 1
        today += 1
        out["enriched"] += 1
        _bump("enrich_runs")
    return out


# ── autoplace: corroborated incidents we do not have ────────────────────────

_FAMILY = {"shots_fired": "violence", "explosion": "violence", "strike": "violence", "missile_impact": "violence",
           "missile_launch": "violence", "arrest": "police", "police_intervention": "police",
           "crowd_movement": "crowd", "troops_sighted": "troops"}


def same_family(a: str | None, b: str | None) -> bool:
    return bool(a) and bool(b) and (a == b or _FAMILY.get(a) == _FAMILY.get(b))


def independent(findings: list[dict]) -> list[dict]:
    """One finding per independent source: a different registrable domain, not blocked, and not a repost
    (near-identical headline) of one already counted."""
    kept: list[dict] = []
    for f in sorted(findings, key=lambda x: x.get("published_at") or ""):
        d = f.get("domain") or domain_of(f.get("url"))
        if blocked(d):
            continue
        if any(k["domain"] == d for k in kept):
            continue
        if any(repost(k.get("title"), f.get("title")) for k in kept):
            continue
        kept.append({**f, "domain": d})
    return kept


_LEVEL_RANK = {"venue": 0, "street": 1, "neighborhood": 2, "city": 3}


def corroborate(findings: list[dict], now: _dt.datetime, hours: float = AUTOPLACE_HOURS) -> tuple[list[dict], list[dict]]:
    """Pure. -> (accepted incidents, rejections [{reason, ...}]). See the module's CORROBORATION rule."""
    import live_incident as li
    usable, rejected = [], []
    lo = now - _dt.timedelta(hours=hours)
    hi = now + _dt.timedelta(minutes=SKEW_MIN)
    for f in findings:
        why = None
        t = parse_time(f.get("event_time")) or parse_time(f.get("published_at"))
        if f.get("act") not in li.ACTS:
            why = "no act of the vocabulary"
        elif f.get("lat") is None or f.get("lon") is None or f.get("level") not in _LEVEL_RANK:
            why = "place not resolvable to a specific point"
        elif t is None:
            why = "no time"
        elif not (lo <= t <= hi):
            why = "outside the time window"
        elif blocked(f.get("domain") or domain_of(f.get("url"))):
            why = "not an independent outlet"
        if why:
            rejected.append({"reason": why, "url": f.get("url"), "place": f.get("place")})
            continue
        usable.append({**f, "_t": t})
    n = len(usable)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(n):
        for j in range(i + 1, n):
            a, b = usable[i], usable[j]
            if (same_family(a["act"], b["act"]) and km(a["lat"], a["lon"], b["lat"], b["lon"]) <= GROUP_KM
                    and abs((a["_t"] - b["_t"]).total_seconds()) / 60 <= GROUP_MIN):
                parent[find(i)] = find(j)
    groups: dict[int, list[dict]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(usable[i])
    accepted = []
    for g in groups.values():
        ind = independent(g)
        if len(ind) < MIN_SOURCES:
            domains = {x.get("domain") for x in g}
            reason = ("one source" if len(g) == 1 else "same domain" if len(domains) == 1 else "reposts of one story")
            rejected.append({"reason": reason, "url": g[0].get("url"), "place": g[0].get("place"), "n": len(g)})
            continue
        best = min(g, key=lambda x: _LEVEL_RANK.get(x["level"], 9))
        acts = [x["act"] for x in g]
        act = max(set(acts), key=acts.count)
        times = [x["_t"] for x in g]
        pubs = [parse_time(x.get("published_at")) for x in ind]
        pubs = [p for p in pubs if p] or times
        accepted.append({
            "act": act, "place": best.get("place"), "context": [c for c in best.get("place_context") or []][:2],
            "lat": best["lat"], "lon": best["lon"], "level": best["level"], "country_code": best.get("country_code"),
            "incident_time": _iso(min(times)), "reported_at": _iso(max(pubs)), "n_sources": len(ind),
            "domains": [x["domain"] for x in ind],
            "citations": [{k: x.get(k) for k in ("title", "url", "source", "domain", "published_at", "summary")} for x in ind],
            "summary": ind[0].get("summary"),
        })
    return accepted, rejected


def find_duplicate(cand: dict, signals: list[dict]) -> dict | None:
    """An existing signal for the same incident: within DEDUP_KM and DEDUP_MIN, same act family."""
    t = parse_time(cand.get("incident_time") or cand.get("event_time"))
    for s in signals:
        if s.get("lat") is None or not same_family(cand.get("act"), s.get("act")):
            continue
        st = parse_time(s.get("first_event_time") or s.get("incident_time") or s.get("event_time"))
        st2 = parse_time(s.get("event_time"))
        if not t or not st:
            continue
        dt_min = min(abs((t - x).total_seconds()) / 60 for x in (st, st2) if x)
        if dt_min <= DEDUP_MIN and km(cand["lat"], cand["lon"], s["lat"], s["lon"]) <= DEDUP_KM:
            return s
    return None


def own_support(lat: float, lon: float, place: str | None, since: _dt.datetime) -> dict:
    """Our own data near the incident since `since`: Telegram posts with a position within 10 km, news titles
    (rss_items) naming the place. Cheap reads; failures count as none."""
    out = {"telegram_posts": 0, "news_items": 0}
    d = 10.0 / 111.0
    try:
        import telegram_ingest as tg
        con = tg._con()
        try:
            out["telegram_posts"] = int(con.execute(
                "SELECT COUNT(*) FROM telegram_posts WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND posted_at >= ?",
                (lat - d, lat + d, lon - d * 2, lon + d * 2, since.isoformat())).fetchone()[0])
        finally:
            con.close()
    except Exception:                                          # noqa: BLE001
        pass
    name = (place or "").split(",")[0].strip()
    if len(name) >= 4:
        try:
            import rss_pulse
            con = rss_pulse.connect()
            try:
                out["news_items"] = int(con.execute(
                    "SELECT COUNT(DISTINCT url) FROM rss_items WHERE published >= ? AND title LIKE ?",
                    (_iso(since), f"%{name}%")).fetchone()[0])
            finally:
                con.close()
        except Exception:                                      # noqa: BLE001
            pass
    return out


def place_incidents(accepted: list[dict], *, signals: list[dict], now: _dt.datetime, support=own_support) -> dict:
    """Store each accepted incident as a web signal, or merge it into the signal it duplicates."""
    out = {"placed": [], "merged": []}
    with _con() as con:
        stored = [_row_signal(dict(r), now) for r in con.execute(
            "SELECT * FROM web_signals WHERE incident_time >= ?", (_iso(now - _dt.timedelta(hours=24)),))]
        for c in accepted:
            dup = find_duplicate(c, [s for s in signals if s.get("source_kind") != "web"])
            if dup is not None:
                # the incident is already on the map: its citations go onto that signal (decorate), nothing new drawn
                sid = "wm-" + hashlib.sha1(f"{dup['id']}".encode()).hexdigest()[:16]
                _upsert(con, sid, c, now, merged_into=dup["id"])
                out["merged"].append(dup["id"])
                _bump("merged")
                continue
            prev = find_duplicate(c, stored)
            since = parse_time(c["incident_time"]) - _dt.timedelta(hours=1)
            cross = support(c["lat"], c["lon"], c.get("place"), since)
            if prev is not None:
                _upsert(con, prev["id"], c, now, cross=cross, existing=prev)
                out["merged"].append(prev["id"])
                continue
            sid = "web-" + hashlib.sha1(f"{c['act']}|{c['lat']:.3f}|{c['lon']:.3f}|{c['incident_time']}".encode()).hexdigest()[:16]
            _upsert(con, sid, c, now, cross=cross)
            out["placed"].append(sid)
            _bump("placed")
    return out


def _upsert(con, sid: str, c: dict, now: _dt.datetime, *, cross: dict | None = None, existing: dict | None = None,
            merged_into: str | None = None) -> None:
    cits = list(c["citations"])
    if existing:
        have = {norm_url(x.get("url")) for x in existing.get("citations") or []}
        cits = list(existing.get("citations") or []) + [x for x in cits if norm_url(x.get("url")) not in have]
    if not existing:
        r = con.execute("SELECT citations FROM web_signals WHERE id=?", (sid,)).fetchone()
        if r:
            old = json.loads(r["citations"] or "[]")
            have = {norm_url(x.get("url")) for x in old}
            cits = old + [x for x in cits if norm_url(x.get("url")) not in have]
    domains = list(dict.fromkeys(x.get("domain") or domain_of(x.get("url")) for x in cits))
    reported = max([c["reported_at"]] + [x.get("published_at") for x in cits if x.get("published_at")])
    incident = min([c["incident_time"]] + ([existing["first_event_time"]] if existing and existing.get("first_event_time") else []))
    con.execute(
        "INSERT OR REPLACE INTO web_signals (id, created_at, updated_at, act, place, context, country_code, lat, lon, level,"
        " incident_time, reported_at, n_sources, domains, citations, cross, summary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (sid, (existing or {}).get("created_at") or _iso(now), _iso(now), c["act"], c.get("place"),
         json.dumps(c.get("context") or []), c.get("country_code"), c["lat"], c["lon"], c.get("level"), incident, reported,
         len(domains), json.dumps(domains), json.dumps(cits[:8]),
         json.dumps({**(cross or {}), **({"merged_into": merged_into} if merged_into else {})}), c.get("summary")))


def _row_signal(r: dict, now: _dt.datetime) -> dict:
    """A stored web signal in live_signals' shape (one family on the map), source_kind 'web'."""
    import live_incident as li
    ctx = json.loads(r.get("context") or "[]")
    cits = json.loads(r.get("citations") or "[]")
    cross = json.loads(r.get("cross") or "{}")
    n = int(r.get("n_sources") or len(cits))
    reported = parse_time(r.get("reported_at"))
    incident = parse_time(r.get("incident_time"))
    live = bool(reported and incident and (now - reported).total_seconds() / 60 <= LIVE_WINDOW_MIN
                and (now - incident).total_seconds() / 3600 <= AUTOPLACE_HOURS)
    own = []
    if cross.get("telegram_posts"):
        own.append(f"{cross['telegram_posts']} Telegram post{'s' if cross['telegram_posts'] > 1 else ''} nearby")
    if cross.get("news_items"):
        own.append(f"{cross['news_items']} news item{'s' if cross['news_items'] > 1 else ''} naming it")
    line = f"Corroborated by {n} sources (web)" + (f", and {', '.join(own)}" if own else "")
    title = li.card_headline(r["act"], None, r.get("place"), ctx)
    return {
        "id": r["id"], "kind": "live_signal", "source_kind": "web", "act": r["act"], "act_label": li.act_label(r["act"]),
        "title": title, "lines": [], "count": len(cits), "place": r.get("place"), "context": ctx[:1],
        "country_code": r.get("country_code"), "lat": r["lat"], "lon": r["lon"],
        # drawn like every signal: 60 min after its LATEST report; the incident's own time is first_event_time
        "event_time": r.get("reported_at"), "first_event_time": r.get("incident_time"), "posted_at": r.get("reported_at"),
        "live": live, "messages": [],
        "corroboration": {"level": "corroborated", "n_sources": n, "first_hand": False, "with_media": False,
                          "line": line, "web_sources": n, "cross_domain": cross},
        "muted": False, "high_impact": r["act"] in li.HIGH_IMPACT, "media": None, "all_media": [], "direction": None,
        "sources": [{"channel_title": c.get("source") or c.get("domain"), "posted_at": c.get("published_at"), "url": c.get("url")}
                    for c in cits][:4],
        "channels": [], "msg_id": None, "channel": None, "citations": cits,
        "web_context": {"summary": r.get("summary"), "findings": cits, "checked_at": r.get("updated_at")},
        "created_at": r.get("created_at"), "level": r.get("level"), "_merged_into": cross.get("merged_into"),
    }


def _area_name(lat: float, lon: float, fallback: str | None) -> str | None:
    try:
        from geocode_utils import reverse_geocode
        r = reverse_geocode(lat, lon) or {}
        lab = r.get("label") or ""
        parts = [p.strip() for p in lab.split(",") if p.strip()]
        if parts:
            return ", ".join(dict.fromkeys([parts[0], parts[-1]])) if len(parts) > 1 else parts[0]
    except Exception:                                          # noqa: BLE001
        pass
    return fallback


def autoplace_areas(w: dict) -> list[dict]:
    """Watched focus points (a city-scale theater, a position, an asset), merged within 25 km."""
    pts = []
    for p in (w or {}).get("points") or []:
        try:
            if float(p["reach"]) > AUTOPLACE_MAX_REACH_KM:
                continue
            if any(km(p["lat"], p["lon"], q["lat"], q["lon"]) <= 25 for q in pts):
                continue
            pts.append({"lat": float(p["lat"]), "lon": float(p["lon"]), "name": p.get("name"),
                        "key": f"{round(float(p['lat']), 2)},{round(float(p['lon']), 2)}"})
        except (KeyError, TypeError, ValueError):
            continue
    return pts


def autoplace_once(*, now: _dt.datetime | None = None, watch: dict | None = None, signals: list[dict] | None = None,
                   geocode=None, support=own_support, area_name=_area_name, force: bool = False) -> dict:
    """Search one watched area (the least recently searched) for incidents in the last AUTOPLACE_HOURS, and
    place the corroborated ones. Off unless WEB_AGENT_AUTOPLACE=1 (or force, for tests)."""
    now = now or _now()
    out = {"area": None, "accepted": 0, "rejected": 0, "placed": [], "merged": [], "skipped": None}
    if not (AUTOPLACE or force):
        out["skipped"] = "off (WEB_AGENT_AUTOPLACE=0)"
        return out
    w = watch if watch is not None else _watch()
    areas = autoplace_areas(w)
    if not areas:
        out["skipped"] = "no watched area"
        return out
    with _con() as con:
        if calls_today(con, kind="autoplace") >= AUTOPLACE_PER_DAY:
            out["skipped"] = "autoplace daily cap"
            return out
        last_pass = _kv_get(con, "autoplace_last_pass", 0) or 0
        if not force and time.time() - float(last_pass) < AUTOPLACE_EVERY_MIN * 60:
            out["skipped"] = "not due"
            return out
        last = {r["key"]: r["last_searched"] or 0 for r in con.execute("SELECT key, last_searched FROM areas")}
        due = [a for a in areas if time.time() - last.get(a["key"], 0) >= AUTOPLACE_AREA_GAP_MIN * 60]
        if not due:
            out["skipped"] = "every area searched recently"
            return out
        area = min(due, key=lambda a: last.get(a["key"], 0))
        r = con.execute("SELECT name FROM areas WHERE key=?", (area["key"],)).fetchone()
        name = r["name"] if r and r["name"] else None
    if not name:
        name = area_name(area["lat"], area["lon"], area.get("name"))
    if not name:
        out["skipped"] = "area has no name to search"
        return out
    with _con() as con:
        con.execute("INSERT OR REPLACE INTO areas (key, name, lat, lon, last_searched) VALUES (?,?,?,?,?)",
                    (area["key"], name, area["lat"], area["lon"], time.time()))
        _kv_set(con, "autoplace_last_pass", time.time())
    out["area"] = name
    hrs = AUTOPLACE_HOURS
    q = (f"Incidents in or near {name} in the last {hrs:g} hours (as of {now.strftime('%d %B %Y %H:00 UTC')}): "
         "shootings, explosions, attacks, strikes, clashes, arrests or police operations. Each with its exact place and time.")
    res = _research(q, lat=area["lat"], lon=area["lon"], place=name, since_hours=hrs, kind="autoplace", now=now, geocode=geocode)
    _bump("autoplace_runs")
    accepted, rejected = corroborate(res.get("findings") or [], now, hrs)
    for rj in rejected:
        _bump("rejected", rj["reason"])
    out["accepted"], out["rejected"] = len(accepted), len(rejected)
    if accepted:
        if signals is None:
            import live_signals
            signals = live_signals.signals()
        placed = place_incidents(accepted, signals=signals, now=now, support=support)
        out.update(placed)
    with _con() as con:
        _kv_set(con, "autoplace_last", {"at": _iso(now), **{k: v for k, v in out.items()}})
    return out


# ── on read: the live signals with their web context, and the web signals ──

def decorate(sigs: list[dict], now: _dt.datetime | None = None) -> list[dict]:
    """live_signals' build plus: `web_context` on each signal the agent researched; the stored web signals that
    are live and new; a web signal that duplicates a Telegram signal merged into it (its citations become the
    signal's web context and count as independent corroboration). Returns a new list; inputs not mutated."""
    now = now or _now()
    if not os.path.exists(_db_path()):
        return sigs
    with _con() as con:
        enr = {r["item_id"]: dict(r) for r in con.execute(
            "SELECT * FROM enrichments WHERE at >= ?", (time.time() - 24 * 3600,))}
        web = [_row_signal(dict(r), now) for r in con.execute(
            "SELECT * FROM web_signals WHERE reported_at >= ?", (_iso(now - _dt.timedelta(hours=AUTOPLACE_HOURS + 1)),))]
    if not enr and not web:
        return sigs
    out = []
    for s in sigs:
        e = enr.get(s.get("id"))
        if e is None:
            t = parse_time(s.get("first_event_time") or s.get("event_time"))
            for x in enr.values():
                xt = parse_time(x["event_time"])
                if (x["act"] == s.get("act") and s.get("lat") is not None and km(x["lat"], x["lon"], s["lat"], s["lon"]) <= DEDUP_KM
                        and t and xt and abs((t - xt).total_seconds()) / 60 <= DEDUP_MIN):
                    e = x
                    break
        s2 = dict(s)
        if e is not None:
            try:
                s2["web_context"] = json.loads(e["result"])
            except (TypeError, ValueError):
                pass
        out.append(s2)
    for w in web:
        target = None
        if w.get("_merged_into"):
            target = next((s for s in out if s.get("id") == w["_merged_into"]), None)
        if target is None:
            target = find_duplicate({**w, "incident_time": w.get("first_event_time")},
                                    [s for s in out if s.get("source_kind") != "web"])
        if target is not None:
            ctx = dict(target.get("web_context") or {})
            have = {norm_url(f.get("url")) for f in ctx.get("findings") or []}
            ctx["findings"] = list(ctx.get("findings") or []) + [c for c in w["citations"] if norm_url(c.get("url")) not in have]
            ctx.setdefault("summary", w["web_context"].get("summary"))
            target["web_context"] = ctx
            corr = dict(target.get("corroboration") or {})
            n = int(corr.get("n_sources") or 1) + int(w["corroboration"]["n_sources"])
            corr.update(level="corroborated", n_sources=n, web_sources=w["corroboration"]["n_sources"],
                        line=f"Corroborated by {n} sources (incl. {w['corroboration']['n_sources']} on the web)")
            target["corroboration"] = corr
            target["muted"] = False
            continue
        if w["live"] and not w.get("_merged_into"):
            out.append({k: v for k, v in w.items() if not k.startswith("_")})
    out.sort(key=lambda s: s.get("event_time") or "", reverse=True)
    return out


def get_context(item_id: str) -> dict | None:
    """The stored web context of one item (enrichment), or None."""
    try:
        with _con() as con:
            r = con.execute("SELECT result FROM enrichments WHERE item_id=?", (item_id,)).fetchone()
        return json.loads(r["result"]) if r else None
    except (sqlite3.Error, TypeError, ValueError):
        return None


# ── the loop's one pass, and status ─────────────────────────────────────────

def run_once(now: _dt.datetime | None = None) -> dict:
    """One background pass: the enrichment, then the autoplace when it is on and due. Errors are counted and
    said, never swallowed silently."""
    out = {}
    try:
        out["enrich"] = enrich_once(now=now)
    except Exception as e:                                     # noqa: BLE001
        note_error("enrich pass", e)
        out["enrich"] = {"error": str(e)[:200]}
    if AUTOPLACE:
        try:
            out["autoplace"] = autoplace_once(now=now)
        except Exception as e:                                 # noqa: BLE001
            note_error("autoplace pass", e)
            out["autoplace"] = {"error": str(e)[:200]}
    try:
        with _con() as con:
            _kv_set(con, "last_pass", {"at": _iso(_now()), **{k: v for k, v in out.items()}})
    except sqlite3.Error:
        pass
    return out


def status() -> dict:
    """What the agent did today and why it may be quiet. Read from the database, so the web process answers
    for a loop that ran in the worker."""
    day = _day()
    with _con() as con:
        by_kind = {r["kind"]: {"calls": r["n"], "spent_usd": round(r["c"] or 0.0, 4)} for r in con.execute(
            "SELECT kind, COUNT(*) AS n, SUM(cost) AS c FROM calls WHERE day=? GROUP BY kind", (day,))}
        failed = int(con.execute("SELECT COUNT(*) FROM calls WHERE day=? AND ok=0", (day,)).fetchone()[0])
        spent = spent_today(con, day)
        month = float(con.execute("SELECT COALESCE(SUM(cost),0) FROM calls WHERE day LIKE ?", (day[:7] + "%",)).fetchone()[0])
        n_enr = int(con.execute("SELECT COUNT(*) FROM enrichments WHERE at >= ?", (time.time() - 86400,)).fetchone()[0])
        n_web = int(con.execute("SELECT COUNT(*) FROM web_signals WHERE created_at >= ?",
                                (_iso(_now() - _dt.timedelta(hours=24)),)).fetchone()[0])
        n_cache = int(con.execute("SELECT COUNT(*) FROM research_cache WHERE day=?", (day,)).fetchone()[0])
        last_error = _kv_get(con, "last_error")
        last_pass = _kv_get(con, "last_pass")
        last_auto = _kv_get(con, "autoplace_last")
    import openai_gate
    with _LOCK:
        stats = json.loads(json.dumps(STATS))
    return {
        "enabled": ENABLED, "purpose": PURPOSE, "purpose_enabled": openai_gate.is_enabled(PURPOSE), "model": MODEL,
        "autoplace": AUTOPLACE, "day": day, "calls_today": by_kind, "failed_today": failed,
        "spent_today_usd": round(spent, 4), "spent_month_usd": round(month, 4), "daily_cap_usd": DAILY_USD,
        "caps": {"per_user_per_day": USER_PER_DAY, "per_call_usd": MAX_CALL_USD, "enrich_per_hour": ENRICH_PER_HOUR,
                 "enrich_per_day": ENRICH_PER_DAY, "autoplace_per_day": AUTOPLACE_PER_DAY,
                 "autoplace_every_min": AUTOPLACE_EVERY_MIN, "min_sources": MIN_SOURCES},
        "estimate_per_call_usd": round(estimate_call_usd(), 4),
        "enriched_24h": n_enr, "web_signals_24h": n_web, "cached_today": n_cache,
        "last_pass": last_pass, "autoplace_last": last_auto, "last_error": last_error,
        "this_process": stats,
    }
