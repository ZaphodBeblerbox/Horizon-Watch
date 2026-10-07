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
             model, decided by keep() here — a yes/no with a list of
             exceptions let every county-court shooting through.
    act, force, actor — what physically happened and who did it, so a
             peaceful march, an arrest or a reaction is not "unrest".
    where  — the one place it happened, as named in the headline.

and the answer is cached by URL in data/gdelt_judgements.json. The map
then draws a story only if it was kept, and only at the coded location
that matches `where` — one pin per story, at the right city, and one pin
for many outlets reporting the same thing at the same place.

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
from paths import data_path as _data_path
_PATH = str(_data_path("gdelt_judgements.json"))
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

# What physically happened, read separately from the category: the category
# alone let "students protest at Cornell", "police tighten security for
# festivals" and six arrests in one terror-plot story through as unrest and
# terrorism (2026-10-06). The map wants acts of force and movements of force.
ACTS_DRAWN = {"attack", "clash", "riot", "seizure", "deployment", "interception"}
UNREST_ACTORS = {"rioters", "crowd", "state_forces", "police", "armed_group", "settlers"}
NEVER_ACTORS = {"individual", "criminal"}      # a lone attacker or a crime is not a security event

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
- act: the act the headline REPORTS AS NEWS, exactly one of (a denial, a letter, a condemnation or a claim about an
  attack is a statement, not an attack):
  attack (a strike, bombing, shooting, raid, arson, ambush), clash (two armed sides fighting), riot (a crowd using force),
  seizure (a ship, place or people taken by force), deployment (forces moved or positioned), interception (a missile,
  drone or aircraft intercepted or shot down), exercise, arrest, protest (peaceful), statement (a claim, condemnation,
  warning, reaction or report about an event), plan (something announced or prepared), other
- force: true only if, in this incident, someone was killed or injured or property was destroyed by force.
- actor: who acted, exactly one of: state_forces (military), police, armed_group, terrorist_group, settlers, rioters,
  crowd, criminal, individual (one person acting alone: a pupil, a gunman), unknown
- casualties: the number of people the headline says were killed or injured in this incident, 0 if none, null if unsaid
- headline: a short plain English headline (max 12 words) naming who did what where. No numbers that are not in the original.
Answer as JSON: {"results": [{"n": 1, "category": "...", "incident": true, "where": "...", "act": "...", "force": true,
"actor": "...", "casualties": 0, "headline": "..."}, ...]}"""


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


def keep(j: dict) -> bool:
    """The model classifies; this decides. A drawn category, one concrete
    incident, and an act of force or a movement of force. Violent unrest
    additionally needs force used by a crowd or the state — not a lone
    pupil, a criminal, or a protest that passed off peacefully."""
    cat, act, actor = j.get("category"), j.get("act"), j.get("actor")
    if cat not in MAP_CATEGORIES or not j.get("incident") or act not in ACTS_DRAWN or actor in NEVER_ACTORS:
        return False
    if act == "deployment" and actor == "police":
        return False                                   # festival security is not a force movement
    if cat == "violent_unrest":
        # A crowd's force with people hurt, or settlers/armed men burning homes.
        hurt = isinstance(j.get("casualties"), int) and j["casualties"] > 0
        return bool(j.get("force")) and actor in UNREST_ACTORS and (hurt or actor in ("settlers", "armed_group"))
    if act in ("attack", "clash", "riot"):
        return bool(j.get("force")) or cat in ("armed_conflict", "terrorism", "maritime_security")
    return True


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
    """The judged place must be one the headline itself names — its most
    specific part, not merely the country: "Houthis claim attacks on Saudi
    airports" names Saudi Arabia, not Mecca, and was pinned at Mecca
    because the coder chose it. Stops the model from taking a coder's
    wrong city off the list ("Gaza strike" at Bokkos)."""
    t = _fold(title)
    head = (where or "").split(",")[0]
    words = [w for w in _fold(head).split() if len(w) >= 4]
    return bool(words) and all(re.search(rf"\b{w}", t) for w in words)


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
            j = {"category": cat, "incident": incident,
                 "act": r.get("act") if isinstance(r.get("act"), str) else None,
                 "force": r.get("force") is True,
                 "actor": r.get("actor") if isinstance(r.get("actor"), str) else None,
                 "casualties": r.get("casualties") if isinstance(r.get("casualties"), int) else None,
                 "where": r.get("where") if isinstance(r.get("where"), str) else None,
                 "headline": head.strip()[:160] if isinstance(head, str) and head.strip() else None}
            j["keep"] = keep(j)
            out[i] = j
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


def _one_per_story(kept: list[dict], cache: dict) -> list[dict]:
    """Many outlets, one event: the RAF Fairford arrests were six pins.
    Stories of the same act at the same judged place are one pin —
    the most-mentioned — carrying how many reports it stands for."""
    groups: dict[tuple, list[dict]] = {}
    for p in kept:
        j = cache.get(p.get("source_url")) or {}
        # By place and act, not category: one outlet's "ISIS attack near
        # Kirkuk" is terrorism, another's is armed conflict — one event.
        key = (j.get("act"), _fold((p.get("judged_where") or "").split(",")[0]).strip())
        groups.setdefault(key, []).append(p)
    out = []
    for ps in groups.values():
        best = dict(max(ps, key=lambda q: q.get("mentions") or 0))
        if len(ps) > 1:
            best["reports"] = len(ps)
            best["other_urls"] = [q.get("source_url") for q in ps if q is not best and q.get("source_url") != best.get("source_url")][:8]
        out.append(best)
    return out


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
                for u, ps in by_url.items() if "casualties" not in cache.get(u, {})}
    if unjudged and not _RUNNING.is_set():
        _RUNNING.set()
        threading.Thread(target=_run, args=(unjudged,), daemon=True, name="gdelt-judge").start()

    kept = []
    for url, ps in by_url.items():
        j = cache.get(url)
        if not j or not keep(j) or not headline_names(j.get("where"), ps[0]["title"]):
            continue
        if j.get("act") == "deployment" and re.search(r"\bpolice\b", ps[0]["title"], re.I):
            continue                                   # the model called the police "state forces"
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
    kept = _one_per_story(kept, cache)
    counts = {"stories": len(by_url), "judged": sum(1 for u in by_url if u in cache),
              "kept": len(kept), "pending": len(unjudged)}
    return kept, counts
