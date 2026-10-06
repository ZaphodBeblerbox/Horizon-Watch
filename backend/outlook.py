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
MAX_TOKENS = 900

SYSTEM = (
    "You write the day's outlook for an intelligence console, from the "
    "signals it currently holds.\n"
    "Reply with JSON only:\n"
    '{"outlook": [{"place": <country or region>, "actor": <who may act, or '
    'null if genuinely no actor is identifiable>, "statement": <one sentence: '
    'what may happen>, "because": <one sentence: why, from the signals>, '
    '"resolves_by": <ISO date within the next 14 days>, "criterion": <how '
    'anybody would later decide this happened or did not: a specific, '
    'observable, checkable event>, "probability": <integer 5-95>, '
    '"citations": [<headlines, quoted EXACTLY as given>], "watch_for": '
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
    "not Sudan's Rapid Support Forces. Where an abbreviation is ambiguous, "
    "leave the actor null and describe it as the signal does.\n"
    "- Every statement MUST cite at least one headline from the list, "
    "quoted exactly. Never invent, never merge two headlines into one "
    "quotation, never paraphrase a quotation.\n"
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


def _signal_lines(signals: list[dict]) -> list[str]:
    out = []
    for s in signals[:MAX_SIGNALS]:
        out.append(" | ".join(str(x) for x in (
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
    try:
        resp = client.chat.completions.create(
            model=model, max_tokens=MAX_TOKENS, temperature=0.2,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content":
                       f"SIGNALS THE CONSOLE HOLDS ({len(lines)}):\n"
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

    return {"ok": True, "count": len(signals), **validate(d.get("outlook") or [], signals)}


def validate(raw: list, signals: list[dict]) -> dict:
    """Keep only statements that cite a signal we actually gave it.

    A forecast nobody can check is an opinion with a percentage on it, and
    the whole point of this replacing the base-rate block is that each line
    can be followed back to the thing it came from.
    """
    by_head = {(s.get("headline") or "").strip().lower(): s for s in signals}
    kept, dropped, uncited, uncheckable, hollow = [], 0, 0, 0, 0
    for o in raw:
        if not isinstance(o, dict):
            dropped += 1
            continue
        statement = str(o.get("statement") or "").strip()
        if not statement:
            dropped += 1
            continue
        cites = []
        for c in (o.get("citations") or []):
            s = by_head.get(str(c).strip().lower())
            if s:
                cites.append({
                    "headline": s.get("headline"), "source": s.get("source"),
                    "location": s.get("location"), "lat": s.get("lat"),
                    "lon": s.get("lon"), "url": s.get("url"),
                    "severity": s.get("severity_tier"),
                })
            else:
                dropped += 1
        if not cites:
            # The line that makes this feature worth having. Without a
            # citation it is indistinguishable from the thing it replaced.
            uncited += 1
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
        kept.append({
            "place": str(o.get("place") or "").strip()[:80] or None,
            "actor": (str(o.get("actor")).strip()[:80] if o.get("actor") else None),
            "statement": statement[:300],
            "because": str(o.get("because") or "").strip()[:300] or None,
            "criterion": criterion[:300],
            "resolves_by": _clean_date(o.get("resolves_by")),
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
    if d < today:
        return None
    return min(d, today + _dt.timedelta(days=14)).isoformat()
