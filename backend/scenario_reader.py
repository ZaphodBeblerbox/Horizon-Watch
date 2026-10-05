"""
scenario_reader.py — turning a paragraph into a scenario, and reading one
against what is actually happening.

TWO THINGS, BOTH THE SAME SHAPE OF JUDGEMENT.

1. INGESTION. A scenario is structured — a target, an aggressor, a course
   of action, some analogues — and people do not think in forms. They say
   "Iran closes Hormuz with mines and fast-attack craft against tanker
   traffic, like the tanker war". Turning that sentence into those fields
   is extraction, which is cheap and which a form cannot do.

2. READING. A scenario is a hypothesis. What makes it useful is knowing
   which of today's signals bear on it, and what the EARLIEST observable
   indicator would be — the thing that, if seen, moves the hypothesis.
   That is a judgement over a small, specific set of facts.

THE MODEL PROPOSES, forecast_scenarios.create VALIDATES. Nothing here
writes a scenario: it returns fields for review. A scenario invented by a
model and saved without a person seeing it would be a forecast about
nothing, carrying the authority of the system that stored it.
"""
from __future__ import annotations

import json

COA = ("ground", "air", "missile", "amphibious", "hybrid")

DRAFT_SYSTEM = (
    "You turn one paragraph of analyst shorthand into a structured conflict "
    "scenario. Reply with JSON only:\n"
    '{"name": <4-8 words>, "target": <country>, "target_place": <city or '
    'objective, or null>, "aggressor": <country or armed group>, "coa": one '
    f'of {list(COA)}, "analogues": [<past conflicts named or clearly '
    'implied, at most 3>], "note": <what the text says that the fields do '
    'not carry>, "confidence": 0-1}\n\n'
    "RULES.\n"
    "- THE PARTY THAT ACTS IS THE AGGRESSOR, ALWAYS. In 'Iran closes "
    "Hormuz with mines against tanker traffic', Iran is the aggressor — "
    "never the target. Putting the acting party in 'target' inverts the "
    "whole scenario.\n"
    "- The target is who or what is acted UPON. Where that is not a "
    "country — a strait, a shipping lane, a pipeline — name the country "
    "whose territory or waters it lies in and put the specific objective "
    "in 'target_place'.\n"
    "- Never infer a party the text does not name or clearly imply. Leave "
    "it empty and say so in the note; an empty field a person fills in is "
    "better than a guess they have to notice.\n"
    "- 'coa' is how force would be applied, and the five listed are the "
    "ONLY values: the console's feasibility rules are written against them, "
    "so a sixth is discarded and the field comes back empty. A maritime "
    "action — mining, blockade, interdiction, fast-attack craft — is "
    "'hybrid' unless it is a landing, which is 'amphibious'. Pick the "
    "single closest.\n"
    "- Analogues must be past conflicts, not places."
)

READ_SYSTEM = (
    "You are given one conflict scenario and every signal the console "
    "currently holds for its target. Reply with JSON only:\n"
    '{"bearing": [{"headline": <the signal, quoted exactly>, "why": <one '
    'line on how it bears on this scenario>, "direction": "supports"|'
    '"weakens"|"ambiguous"}], "indicators": [{"indicator": <a single '
    'observable thing>, "where": <place or null>, "why_early": <one line>}], '
    '"assessment": <two sentences at most>}\n\n'
    "RULES. Only signals from the list, quoted as given — never invent one, "
    "never generalise several into one. A signal that does not bear on the "
    "scenario is left out rather than stretched. Indicators must be things "
    "somebody could actually OBSERVE in this console — a vessel movement, a "
    "flight, a closure, a statement — not sentiments or intentions. If "
    "nothing in the list bears on the scenario, return empty lists and say "
    "so in the assessment. Do not assign probabilities."
)


def draft_from_text(text: str) -> dict:
    """Propose scenario fields from a paragraph. Never saves."""
    import openai_gate
    text = (text or "").strip()[:2000]
    if not text:
        return {"ok": False, "why": "nothing to read"}

    client = openai_gate.get_client(openai_gate.FORECAST)
    if client is None:
        st = openai_gate.status()
        return {"ok": False, "why": ("The month's model budget is spent."
                                     if st["over_budget"]
                                     else "Scenario reading is not configured.")}
    model = openai_gate.model_for(openai_gate.FORECAST)
    try:
        resp = client.chat.completions.create(
            model=model, max_tokens=420, temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": DRAFT_SYSTEM},
                      {"role": "user", "content": text}],
        )
    except Exception as e:
        return {"ok": False, "why": f"The model did not answer: {e}"}

    _bill(resp, model, "forecast_draft", text[:60])
    try:
        d = json.loads(resp.choices[0].message.content or "{}")
    except (json.JSONDecodeError, IndexError, AttributeError):
        return {"ok": False, "why": "The model did not answer in the agreed format."}

    # Coerced here, and still validated again by forecast_scenarios.create
    # when somebody saves it. Two checks because this one is about shape and
    # that one is about rules.
    coa = str(d.get("coa") or "").strip().lower()
    fields = {
        "name": str(d.get("name") or "").strip()[:120],
        "target": str(d.get("target") or "").strip()[:80],
        "target_place": (str(d.get("target_place")).strip()[:80]
                         if d.get("target_place") else None),
        "aggressor": str(d.get("aggressor") or "").strip()[:80],
        "coa": coa if coa in COA else None,
        "analogues": [str(a).strip()[:80] for a in (d.get("analogues") or [])][:3],
        "note": str(d.get("note") or "").strip()[:600],
    }
    problems = []
    if not fields["name"]:
        problems.append("it has no name")
    if not fields["target"]:
        problems.append("no target was named")
    if not fields["aggressor"]:
        problems.append("no aggressor was named")
    if fields["target"] and fields["target"].lower() == fields["aggressor"].lower():
        problems.append("the target and the aggressor came back the same")
    return {
        "ok": True, "fields": fields,
        "confidence": float(d.get("confidence") or 0.0),
        # Said plainly, because a draft with a missing target is a draft a
        # person has to finish rather than one to be saved.
        "needs": problems,
    }


def read_against_signals(scenario: dict, signals: list[dict]) -> dict:
    """Which of these signals bear on this scenario, and what to watch for."""
    import openai_gate
    if not signals:
        return {"ok": True, "bearing": [], "indicators": [], "count": 0,
                "assessment": f"Nothing the console holds names "
                              f"{scenario.get('target') or 'this target'}. "
                              f"The scenario is unaffected either way."}

    client = openai_gate.get_client(openai_gate.FORECAST)
    if client is None:
        st = openai_gate.status()
        return {"ok": False, "why": ("The month's model budget is spent."
                                     if st["over_budget"]
                                     else "Scenario reading is not configured.")}

    scen = (f"Name: {scenario.get('name')}\n"
            f"Target: {scenario.get('target')}"
            f"{' / ' + scenario['target_place'] if scenario.get('target_place') else ''}\n"
            f"Aggressor: {scenario.get('aggressor')}\n"
            f"Course of action: {scenario.get('coa') or 'unspecified'}\n"
            f"Analogues: {', '.join(scenario.get('analogues') or []) or 'none'}\n"
            f"Note: {scenario.get('note') or ''}")
    lines = []
    for s in signals[:30]:
        lines.append(" | ".join(str(x) for x in (
            str(s.get("severity_tier") or "routine").upper(),
            s.get("headline") or "", s.get("location") or "",
            s.get("source") or "") if x))

    model = openai_gate.model_for(openai_gate.FORECAST)
    try:
        resp = client.chat.completions.create(
            model=model, max_tokens=700, temperature=0.1,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": READ_SYSTEM},
                      {"role": "user", "content":
                       f"SCENARIO\n{scen}\n\nSIGNALS ({len(lines)})\n" + "\n".join(lines)}],
        )
    except Exception as e:
        return {"ok": False, "why": f"The model did not answer: {e}"}

    _bill(resp, model, "forecast_read", str(scenario.get("name"))[:60])
    try:
        d = json.loads(resp.choices[0].message.content or "{}")
    except (json.JSONDecodeError, IndexError, AttributeError):
        return {"ok": False, "why": "The model did not answer in the agreed format."}

    # A quoted signal that is not in the list given is a fabrication, and
    # it is the one failure that would make this untrustworthy. Dropped,
    # and counted, rather than shown.
    given = {(s.get("headline") or "").strip().lower() for s in signals}
    bearing, dropped = [], 0
    for b in (d.get("bearing") or []):
        head = str(b.get("headline") or "").strip()
        if head.lower() in given:
            bearing.append({"headline": head,
                            "why": str(b.get("why") or "")[:300],
                            "direction": (str(b.get("direction") or "ambiguous").lower()
                                          if str(b.get("direction") or "").lower()
                                          in ("supports", "weakens", "ambiguous") else "ambiguous")})
        else:
            dropped += 1
    return {
        "ok": True, "count": len(signals),
        "bearing": bearing,
        "indicators": [{"indicator": str(i.get("indicator") or "")[:200],
                        "where": (str(i.get("where")).strip()[:80] if i.get("where") else None),
                        "why_early": str(i.get("why_early") or "")[:300]}
                       for i in (d.get("indicators") or [])][:8],
        "assessment": str(d.get("assessment") or "")[:600],
        "fabricated_dropped": dropped,
    }


def _bill(resp, model, call_type, headline):
    usage = getattr(resp, "usage", None)
    if not usage:
        return
    try:
        import usage_tracker
        usage_tracker.record_call(
            input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
            call_type=call_type, model=model, headline=headline)
    except Exception:
        pass
