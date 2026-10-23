"""
outlook.py — what today may actually bring.

WHAT THIS REPLACES. The Home screen said things like:

    50%  Escalation in one-sided violence against civilians
         0-3 months · below its own base rate of 52%

That is a number about a CATEGORY. It names no actor, no place, no object
and no cause, it is scoped to a quarter rather than to today, and a
probability within a point or two of its own base rate is the model saying
it has no view. Nobody can act on it, and nobody can be wrong about it.

WHAT IT SAYS INSTEAD. One sentence per thing, with the four parts that make
a forecast a forecast:

    Sudan · RSF may attempt to retake Babanusa
    because a convoy was ambushed on the Tillaberi road yesterday
    and the garrison's resupply has not been reported since.

An actor, a place, an action, and the signals it rests on — quoted from the
signals this console holds, so the claim can be checked in one click.

THE GUARD THAT MATTERS. Every statement must cite at least one signal from
the list it was given, quoted as given. A statement citing nothing, or
citing something that was never in the list, is dropped and counted. The
base rates are still passed in as CONTEXT so the model knows what is
ordinary — but a base rate is not a forecast and is no longer presented as
one.
"""
from __future__ import annotations

import json
import re

# VERBS THAT CANNOT BE WRONG. A forecast that something may "face
# scrutiny" or "come under pressure" is unfalsifiable: no observation
# settles it either way, so it carries a probability while meaning nothing.
# The prompt forbids them; this enforces it, because a prompt is a request
# and the whole point of this rewrite is that the number can later be shown
# to have been wrong.
_HOLLOW = re.compile(
    r"\b(face|faces|facing|come|comes|coming)\s+(under\s+|increased\s+|renewed\s+|"
    r"further\s+|mounting\s+|growing\s+)*"
    r"(scrutiny|pressure|criticism|attention|calls|condemnation|questions|backlash)\b"
    r"|\b(see|sees|draw|draws|attract|attracts)\s+(increased\s+|further\s+|more\s+)?"
    r"(scrutiny|attention|criticism|condemnation)\b"
    r"|\bbe\s+(urged|pressed|called|expected|criticised|criticized)\b"
    r"|\bmay\s+(consider|discuss|debate|review|assess)\b",
    re.I)

# FORECASTS THAT CANNOT BE RIGHT EITHER. "Road accidents may continue to
# claim lives in Kenya" is not unfalsifiable — it is CERTAIN, and a 60% on a
# certainty carries no information at all. The tell is a statement about the
# continuation of a background phenomenon rather than about a change: a new
# actor, a new place, a specific target, a threshold crossed.
_TAUTOLOGY = re.compile(
    r"\bmay\s+(continue|persist|remain|endure|go\s+on)\b"
    r"|\bmay\s+continue\s+to\b"
    r"|\bmay\s+(see|experience)\s+(further|continued|ongoing|more)\b"
    r"|\b(escalate|intensify|increase|worsen|deteriorate)\s+further\b"
    r"|\bmay\s+(still|likely)\s+be\b",
    re.I)

MAX_SIGNALS = 45
MAX_STATEMENTS = 6
MAX_TOKENS = 1400

# WHY EVERY STATEMENT WAS DROPPED (production, 2026-10-23: 2 statements, 4
# citations "not in the input", 2 uncited, nothing shown). The model was asked
# to quote headlines EXACTLY, and the headlines it was given are GeoConfirmed's
# ("… — Kup'yans'k", "“Atmosphere”"): a model re-types an ellipsis as "...",
# curly quotes as straight ones, and an exact-string match then calls an honest
# citation a fabrication. Each signal now carries an id ([S7]); the model cites
# ids and the code checks each id exists (model extracts, code verifies). A
# quoted headline is still accepted when it matches after normalising quotes,
# dashes, ellipses and spacing.
# And the pool it read was mostly GDELT, which is not a signal on Home (owner,
# 2026-10-13); select_signals keeps our own sources only, as /api/surface does.

SYSTEM = (
    "You write the day's outlook for an intelligence console, from the "
    "signals it currently holds. Each signal line starts with its id, e.g. [S7].\n"
    "Reply with JSON only:\n"
    '{"outlook": [{"place": <the named place: a town, site, region or country '
    'the cited signals name>, "actor": <the named force, group or state that '
    'may act>, "act": <the physical act, e.g. "strike", "seize", "close", '
    '"withdraw">, "statement": <one plain English sentence naming the actor, '
    'the act and the place, e.g. "RSF may attempt to retake Babanusa">, '
    '"because": <one sentence: why, from the signals>, '
    '"resolves_by": <ISO date within the next 14 days>, "criterion": <how '
    'anybody would later decide this happened or did not: a specific, '
    'observable, checkable event>, "probability": <integer 5-95>, '
    '"citations": [<ids of the signals it rests on, e.g. "S7">], "watch_for": '
    '[<1-3 specific, observable indicators that this is coming true: a named '
    'force moving, a named place hit, a named route closing>]}]}\n\n'
    "RULES.\n"
    "- NAME THINGS. 'RSF may attempt to retake Babanusa' is a forecast. "
    "'Escalation in non-state conflict' is a category and is useless.\n"
    "- FORECAST A CHANGE, NOT A CONTINUATION. 'Road accidents may continue "
    "to claim lives in Kenya' is certain and therefore worthless, and so is "
    "'fighting may escalate further'. Forecast something that would be NEW: "
    "a named actor acting, a specific place taken or struck, a route or port "
    "closed, a threshold crossed. If all a place's signals support is 'more "
    "of the same', write nothing about that place.\n"
    "- A PHYSICAL, OBSERVABLE ACTION ONLY. Something moves, fires, closes, "
    "opens, seizes, withdraws, strikes, blockades, is captured, is "
    "evacuated. REJECT your own sentence if it says a party may 'face "
    "scrutiny', 'come under pressure', 'see attention', 'be criticised', "
    "'face calls for', 'consider', 'be urged to' or anything else that is a "
    "reaction rather than an act — those are unfalsifiable and are exactly "
    "what makes a forecast worthless. Write nothing rather than one of "
    "those.\n"
    "- NEVER EXPAND OR INTERPRET AN ACRONYM you cannot resolve from the "
    "signals themselves. If a headline says 'RSF' about road safety, it is "
    "not Sudan's Rapid Support Forces. Never name an actor the signals do "
    "not name; where the actor is ambiguous, write nothing about it.\n"
    "- Every statement MUST cite at least one signal by its id ([S7] is cited "
    "as \"S7\"). Cite only ids from the list; never invent one.\n"
    "- Every statement names an ACTOR, a PLACE and an ACT. If no actor is "
    "identifiable from the signals, write nothing about it.\n"
    "- The place must be one the cited signals name.\n"
    "- Say only what the signals support. No outside knowledge, no figures "
    "that are not in them.\n"
    "- EVERY STATEMENT NEEDS A RESOLUTION CRITERION — a specific observable "
    "event that would later settle it, naming WHO would report it or WHAT "
    "would be seen. 'Fighting intensifies' cannot be settled and is "
    "therefore not a forecast. 'A wire service reports RSF control of "
    "Babanusa, or RSF claims it publicly' can be. 'Reports of increased "
    "activity' is too vague — say reported by whom, and what counts as "
    "increased.\n"
    "- The probability is your own judgement on that criterion being met by "
    "that date. Use the full range. 50 means you have no view, so avoid it "
    "unless you truly have none.\n"
    "- Prefer the few places where something specific is building over "
    "broad coverage. Six statements at most; fewer is better than padding.\n"
    "- If the signals support nothing specific, return an empty list. An "
    "empty outlook is a true statement about a quiet day."
)


def _is_gdelt(s: dict) -> bool:
    return str(s.get("source") or "").lower() == "gdelt" or str(s.get("id") or "").startswith("gdelt_")


def select_signals(pool: list[dict], limit: int = MAX_SIGNALS) -> list[dict]:
    """What the outlook may read: our own signals (no GDELT: news is not a
    signal on Home), one per headline, in the pool's order, at most `limit`."""
    out, seen = [], set()
    for s in pool or []:
        if not isinstance(s, dict) or _is_gdelt(s):
            continue
        k = norm_text(s.get("headline"))
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(s)
        if len(out) >= limit:
            break
    return out


_QUOTES = str.maketrans({"‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "`": "'",
                         "“": '"', "”": '"', "„": '"', "«": '"', "»": '"',
                         "–": "-", "—": "-", "−": "-", " ": " "})


def norm_text(s) -> str:
    """A headline as compared: quotes, dashes, ellipses and spacing normalised, case folded."""
    t = str(s or "").translate(_QUOTES).replace("…", "...")
    t = re.sub(r"\.{3,}", "...", t)
    return re.sub(r"\s+", " ", t).strip(" .\"'").casefold()


_SEV_PREFIX = re.compile(r"^\s*\[?s?\d+\]?\s*[|:-]?\s*|^\s*(critical|significant|high|elevated|moderate|low|routine)\s*\|\s*", re.I)


def _resolve_cite(c, by_id: dict, by_norm: dict) -> dict | None:
    """One citation -> the signal it names, or None. An id ("S7", "[S7]") or a
    headline quoted as given (normalised), also when the model copied the
    whole line ("[S7] HIGH | headline | place | ...")."""
    raw = str(c or "").strip()
    m = re.fullmatch(r"\[?\s*[sS]\s*(\d+)\s*\]?", raw)
    if m:
        return by_id.get(int(m.group(1)))
    m = re.match(r"\[\s*[sS]\s*(\d+)\s*\]", raw)
    if m and by_id.get(int(m.group(1))):
        return by_id[int(m.group(1))]
    for cand in (raw, _SEV_PREFIX.sub("", raw), _SEV_PREFIX.sub("", raw).split(" | ")[0]):
        hit = by_norm.get(norm_text(cand))
        if hit:
            return hit
    return None


_STOP = {"the", "of", "and", "in", "on", "at", "city", "region", "oblast", "province", "district", "area", "near", "north",
         "south", "east", "west", "northern", "southern", "eastern", "western", "central", "a", "an", "de", "la", "le"}


def _place_grounded(place: str, cites: list[dict]) -> bool:
    """The statement's place is one its cited signals name: a word of it
    appears in a cited headline or location."""
    words = [w for w in re.findall(r"[^\W\d_]{3,}", norm_text(place)) if w not in _STOP]
    if not words:
        return False
    hay = " ".join(norm_text(f"{c.get('headline') or ''} {c.get('location') or ''}") for c in cites)
    return any(w in hay for w in words)


def _signal_lines(signals: list[dict]) -> list[str]:
    out = []
    for i, s in enumerate(signals[:MAX_SIGNALS], 1):
        out.append(f"[S{i}] " + " | ".join(str(x) for x in (
            str(s.get("severity_tier") or "routine").upper(),
            s.get("headline") or "",
            s.get("location") or "",
            s.get("source") or "",
            str(s.get("published_at") or "")[:16],
        ) if x))
    return out


def build_outlook(signals: list[dict], base_rates: list[dict] | None = None) -> dict:
    """The day's outlook, or an honest empty one."""
    import openai_gate

    signals = select_signals(signals)
    if not signals:
        return {"ok": True, "outlook": [], "count": 0,
                "note": "The console is holding nothing today. There is no "
                        "outlook to give, which is itself the finding."}

    client = openai_gate.get_client(openai_gate.OUTLOOK)
    if client is None:
        st = openai_gate.status()
        return {"ok": False, "outlook": [], "count": len(signals),
                "why": ("The month's model budget is spent."
                        if st["over_budget"] else "The outlook is not configured.")}

    lines = _signal_lines(signals)
    # The base rates go in as context, labelled as what they are. They tell
    # the model what is ordinary; they are not the answer.
    context = ""
    if base_rates:
        bits = []
        for b in base_rates[:8]:
            try:
                bits.append(f"{b.get('label')}: now {round(float(b.get('p') or 0)*100)}%, "
                            f"usually {round(float(b.get('base') or 0)*100)}%")
            except (TypeError, ValueError):
                continue
        if bits:
            context = ("\n\nFor context only — category-level rates, NOT the "
                       "answer and not to be restated:\n" + "\n".join(bits))

    model = openai_gate.model_for(openai_gate.OUTLOOK)
    # THE DATE, SAID. Without it the model dated every statement by its
    # signals' day (resolves_by = yesterday) and the code, rightly, dropped
    # them all as already past (reproduced on the production pool, 2026-10-23).
    import datetime as _dt
    today = _dt.date.today()
    dated = (f"TODAY IS {today.isoformat()}. resolves_by must be between "
             f"{(today + _dt.timedelta(days=1)).isoformat()} and {(today + _dt.timedelta(days=14)).isoformat()}.\n\n")
    try:
        resp = client.chat.completions.create(
            model=model, max_tokens=MAX_TOKENS, temperature=0.2,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content":
                       dated + f"SIGNALS THE CONSOLE HOLDS ({len(lines)}):\n"
                       + "\n".join(lines) + context}],
        )
    except Exception as e:
        return {"ok": False, "outlook": [], "count": len(signals),
                "why": f"The model did not answer: {e}"}

    usage = getattr(resp, "usage", None)
    if usage:
        try:
            import usage_tracker
            usage_tracker.record_call(
                input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                call_type="outlook", model=model, headline="daily outlook")
        except Exception:
            pass

    try:
        d = json.loads(resp.choices[0].message.content or "{}")
    except (json.JSONDecodeError, IndexError, AttributeError):
        return {"ok": False, "outlook": [], "count": len(signals),
                "why": "The model did not answer in the agreed format."}

    res = validate(d.get("outlook") or [], signals)
    print(f"[outlook] built from {len(signals)} signals: {len(res['outlook'])} kept of {len(d.get('outlook') or [])} "
          f"(unknown citations {res['fabricated_citations']}, uncited {res['uncited_dropped']}, "
          f"no criterion {res['uncheckable_dropped']}, hollow {res['hollow_dropped']}, "
          f"no actor/place/act {res['incomplete_dropped']}, place not in its signals {res['ungrounded_dropped']}, "
          f"no date {res['undated_dropped']})", flush=True)
    return {"ok": True, "count": len(signals), **res}


def validate(raw: list, signals: list[dict]) -> dict:
    """Keep only statements that cite a signal we actually gave it.

    A forecast nobody can check is an opinion with a percentage on it, and
    the whole point of this replacing the base-rate block is that each line
    can be followed back to the thing it came from.
    """
    sigs = signals[:MAX_SIGNALS]
    by_id = {i: s for i, s in enumerate(sigs, 1)}
    by_norm = {}
    for s in sigs:
        by_norm.setdefault(norm_text(s.get("headline")), s)
    kept, dropped, uncited, uncheckable, hollow = [], 0, 0, 0, 0
    incomplete = ungrounded = undated = 0
    for o in raw:
        if not isinstance(o, dict):
            dropped += 1
            continue
        statement = str(o.get("statement") or "").strip()
        if not statement:
            dropped += 1
            continue
        cites, seen = [], set()
        for c in (o.get("citations") or []):
            s = _resolve_cite(c, by_id, by_norm)
            if s is None:
                dropped += 1
                continue
            if id(s) in seen:
                continue
            seen.add(id(s))
            cites.append({
                "headline": s.get("headline"), "source": s.get("source"),
                "location": s.get("location"), "lat": s.get("lat"),
                "lon": s.get("lon"), "url": s.get("url"),
                "severity": s.get("severity_tier"),
            })
        if not cites:
            # The line that makes this feature worth having. Without a
            # citation it is indistinguishable from the thing it replaced.
            uncited += 1
            continue
        # ACTOR + PLACE + ACT (owner's rule for a forecast): a statement
        # without a named actor or place, or without the act, is a category.
        actor = str(o.get("actor") or "").strip()
        place = str(o.get("place") or "").strip()
        act = str(o.get("act") or "").strip()
        if not actor or actor.lower() in ("null", "none", "unknown") or not place or not act:
            incomplete += 1
            continue
        # the place is the cited signals' place, not the model's knowledge
        if not _place_grounded(place, cites):
            ungrounded += 1
            continue
        # A STATEMENT WITH NO CRITERION IS NOT A FORECAST. It is the thing
        # this replaced: a sentence nobody can ever be wrong about. Dropped,
        # not softened.
        criterion = str(o.get("criterion") or "").strip()
        if len(criterion) < 12:
            uncheckable += 1
            continue
        if _HOLLOW.search(statement) or _TAUTOLOGY.search(statement):
            hollow += 1
            continue
        # ... and a date by which it is settled
        resolves = _clean_date(o.get("resolves_by"))
        if not resolves:
            undated += 1
            continue
        kept.append({
            "place": place[:80],
            "actor": actor[:80],
            "act": act[:60],
            "statement": statement[:300],
            "because": str(o.get("because") or "").strip()[:300] or None,
            "criterion": criterion[:300],
            "resolves_by": resolves,
            "probability": _clean_probability(o.get("probability")),
            "citations": cites[:4],
            "watch_for": [str(w).strip()[:160] for w in (o.get("watch_for") or []) if str(w).strip()][:3],
            # Where it is: the first citation that has a position, so the
            # console can offer a watch zone or a theater on the spot.
            "lat": next((c.get("lat") for c in cites if c.get("lat") is not None), None),
            "lon": next((c.get("lon") for c in cites if c.get("lon") is not None), None),
        })
    return {
        "outlook": kept[:MAX_STATEMENTS],
        # Counted and returned, so a model that fabricates often is visible
        # rather than quietly filtered.
        "fabricated_citations": dropped,
        "uncited_dropped": uncited,
        "uncheckable_dropped": uncheckable,
        "hollow_dropped": hollow,
        "incomplete_dropped": incomplete,
        "ungrounded_dropped": ungrounded,
        "undated_dropped": undated,
    }


def _clean_probability(v) -> int | None:
    """A probability, or None.

    Clamped to 5-95 rather than 0-100: a model that says 0 or 100 from a
    handful of wire reports is not expressing certainty, it is failing to
    express doubt, and a 0 can never be scored usefully either.
    """
    try:
        n = int(round(float(v)))
    except (TypeError, ValueError):
        return None
    return max(5, min(95, n))


def _clean_date(v) -> str | None:
    """A resolution date inside the next fortnight, or None.

    A forecast that resolves in six months cannot be scored this quarter,
    and one that resolved yesterday is not a forecast.
    """
    import datetime as _dt
    try:
        d = _dt.date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None
    today = _dt.date.today()
    if d <= today:
        return None                      # settled today or before: not a forecast
    return min(d, today + _dt.timedelta(days=14)).isoformat()
