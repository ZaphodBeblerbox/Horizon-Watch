"""
gdelt_judge.py — which GDELT stories belong on the map, and where.

GDELT's coder reads "Fight" into a court case, a dementia interview and an
opinion column, and pins one story at every city the article names: the
Patriots-to-Saudi story landed in Tehran, the Houthi strike on Aramco in
Riyadh, Hajjah and Khurais at once. Coding rules cannot fix that — the
words are fine, the reading is wrong.

So each ARTICLE (not each coded event) is read once by the cheap model
(openai_gate ENRICH) with three questions:

    category — armed conflict, terrorism, military movement, maritime
             security or violent unrest are drawn; crime, courts,
             accidents, opinion and politics are not. Classified by the
             model, decided by MAP_CATEGORIES here — a yes/no with a
             list of exceptions let every county-court shooting through.
    where  — the one place it happened, as named in the headline.

and the answer is cached by URL in data/gdelt_judgements.json. The map
then draws a story only if it was kept, and only at the coded location
that matches `where` — one pin per story, at the right city.

Unjudged stories are not drawn. The judge runs in the background, a few
seconds behind the feed; a wrong pin is worse than a late one.
"""
from __future__ import annotations

import json
import os
import re
import threading
import unicodedata

BATCH = 25
BUDGET_PER_PASS = 200
_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "gdelt_judgements.json")
_LOCK = threading.Lock()
_RUNNING = threading.Event()
_CACHE: dict | None = None

# Codings worth paying to read. Coerce and Protest are mostly framing and
# politics; they are read only when the coverage is wide.
ROOTS_ALWAYS = {"Fight", "Assault", "Mass Violence", "Exhibit Force"}
ROOTS_IF_WIDE = {"Coerce", "Protest"}
WIDE_MENTIONS = 10

# The model classifies; the code decides. A yes/no with a long list of
# exceptions let through every county-court shooting; a forced choice of
# category does not.
MAP_CATEGORIES = {"armed_conflict", "terrorism", "military_movement", "maritime_security", "violent_unrest"}

SYSTEM = """You classify news headlines for a conflict and security monitoring map.
For each numbered item (a headline, then the places a machine coder associated with it), give:
- category, exactly one of:
  armed_conflict    strikes, shelling, battles, clashes between armed forces or armed groups, drone/missile attacks, sieges, displacement from fighting
  terrorism         attacks by terrorist or jihadist groups, bombings, kidnappings by armed groups
  military_movement deployments, troop or naval movements, mobilisation, interceptions, airspace violations (NOT exercises or training)
  maritime_security piracy, ship seizures, attacks on ships, blockades
  violent_unrest    riots by people with clashes, deaths or serious injuries; lethal repression of protesters; coups
                    (peaceful protests, marches, detentions, school closures are politics; animals are other)
  crime             shootings, murders, stabbings, assaults, drugs, robberies, gangs, manhunts, by criminals or lone individuals
  legal             courts, trials, sentences, executions, lawsuits, charges, investigations
  accident          crashes, disasters, training or exercise deaths, emergencies
  opinion           analysis, commentary, personal stories, anniversaries, retrospectives
  politics          statements, diplomacy, agreements, policy, elections, threats without an event
  other             anything else
- incident: true only if the headline reports one specific incident that happened (an attack, a clash, a strike, a
  seizure, a deployment, a riot). False for trends, analyses, crises "deepening", plans, rallies being planned,
  reactions, aftermath stories, campus or student protests, and anything without a concrete act.
- where: the single place where the event happened, as the HEADLINE names it, as specific as it allows
  ("Khurais, Saudi Arabia"), or null if the headline names no place. The coder's places are often wrong:
  use one only if the headline is about that place. Never the place of the speaker or the newspaper.
- headline: a short plain English headline (max 12 words) naming who did what where. No numbers that are not in the original.
Answer as JSON: {"results": [{"n": 1, "category": "...", "incident": true, "where": "...", "headline": "..."}, ...]}"""


def _load() -> dict:
    global _CACHE
    if _CACHE is None:
        try:
            with open(_PATH, encoding="utf-8") as fh:
                _CACHE = json.load(fh)
        except (OSError, ValueError):
            _CACHE = {}
    return _CACHE


def _save() -> None:
    tmp = _PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(_CACHE, fh)
    os.replace(tmp, _PATH)


def worth_reading(p: dict) -> bool:
    types = set(p.get("event_types") or [p.get("event_type")])
    if types & ROOTS_ALWAYS:
        return True
    return bool(types & ROOTS_IF_WIDE) and (p.get("mentions") or 0) >= WIDE_MENTIONS


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z ]+", " ", s)


def place_matches(where: str | None, location_name: str) -> bool:
    """Does the coded location name the place the model says it happened?
    The first named part of `where` (the most specific) must appear in it."""
    if not where:
        return False
    parts = [x for x in where.split(",") if x.strip()]
    head = _fold(parts[0]).strip() if parts else ""
    if len(head) < 3:
        return False
    if len(parts) == 1:
        # Only a country or region is known: draw it only where GDELT also
        # coded just that, never at whichever city it happened to pick.
        return _fold(location_name.split(",")[0]).strip() == head
    return head in _fold(location_name)


def headline_names(where: str | None, title: str) -> bool:
    """The judged place must be one the headline itself names: any word of
    four letters or more of `where` appears in the title. Stops the model
    from picking a coder's wrong city off the list ("Gaza strike" at Bokkos)."""
    t = _fold(title)
    return any(len(w) >= 4 and re.search(rf"\b{w}", t) for w in _fold(where or "").split())


def judge_batch(stories: list[dict]) -> list[dict | None]:
    """[{title, places}] -> [{category, keep, where, headline}] in order, None when unanswered."""
    import openai_gate
    out: list[dict | None] = [None] * len(stories)
    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None or not stories:
        return out
    numbered = "\n".join(f"{i+1}. {s['title'][:240]} [places: {'; '.join(s['places'])[:200]}]"
                         for i, s in enumerate(stories))
    model = openai_gate.model_for(openai_gate.ENRICH)
    try:
        resp = client.chat.completions.create(
            model=model, temperature=0, max_tokens=2500,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": numbered}])
    except Exception as e:                                   # noqa: BLE001
        print(f"[gdelt_judge] batch failed — {type(e).__name__}: {str(e)[:200]}", flush=True)
        return out
    usage = getattr(resp, "usage", None)
    if usage:
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                                      call_type="enrich", model=model, headline=f"gdelt judge {len(stories)}")
        except Exception:                                    # noqa: BLE001
            pass
    try:
        results = json.loads(resp.choices[0].message.content or "{}").get("results") or []
    except (ValueError, IndexError, AttributeError):
        print("[gdelt_judge] unparseable answer", flush=True)
        return out
    for r in results:
        try:
            i = int(r.get("n")) - 1
        except (TypeError, ValueError):
            continue
        if 0 <= i < len(out):
            head = r.get("headline")
            cat = r.get("category") if isinstance(r.get("category"), str) else None
            incident = r.get("incident") is True
            out[i] = {"category": cat, "incident": incident, "keep": cat in MAP_CATEGORIES and incident,
                      "where": r.get("where") if isinstance(r.get("where"), str) else None,
                      "headline": head.strip()[:160] if isinstance(head, str) and head.strip() else None}
    return out


def _run(stories: dict[str, dict]) -> None:
    try:
        todo = list(stories.items())[:BUDGET_PER_PASS]
        for k in range(0, len(todo), BATCH):
            chunk = todo[k:k + BATCH]
            answers = judge_batch([s for _, s in chunk])
            with _LOCK:
                cache = _load()
                for (url, _), a in zip(chunk, answers):
                    if a is not None:
                        cache[url] = a
                _save()
    finally:
        _RUNNING.clear()


def filter_points(points: list[dict]) -> tuple[list[dict], dict]:
    """The map's GDELT pins, judged. Starts a background pass for unjudged
    stories and never blocks. Returns (kept points, counts)."""
    with _LOCK:
        cache = dict(_load())
    by_url: dict[str, list[dict]] = {}
    for p in points:
        if worth_reading(p):
            by_url.setdefault(p["source_url"], []).append(p)

    unjudged = {u: {"title": ps[0]["title"], "places": sorted({q.get("location_name") or "" for q in ps})}
                for u, ps in by_url.items() if "incident" not in cache.get(u, {})}
    if unjudged and not _RUNNING.is_set():
        _RUNNING.set()
        threading.Thread(target=_run, args=(unjudged,), daemon=True, name="gdelt-judge").start()

    kept = []
    for url, ps in by_url.items():
        j = cache.get(url)
        if not j or not j.get("keep") or not headline_names(j.get("where"), ps[0]["title"]):
            continue
        at = [p for p in ps if place_matches(j.get("where"), p.get("location_name") or "")]
        if not at:
            continue
        # One pin per story: the most-mentioned coding at the right place.
        p = dict(max(at, key=lambda q: q.get("mentions") or 0))
        if j.get("headline"):
            p["original_title"] = p["title"]
            p["title"] = j["headline"]
        p["judged_where"] = j.get("where")
        kept.append(p)
    counts = {"stories": len(by_url), "judged": sum(1 for u in by_url if u in cache),
              "kept": len(kept), "pending": len(unjudged)}
    return kept, counts
