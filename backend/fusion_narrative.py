"""
fusion_narrative.py — writing up a cluster of signals that converged.

WHAT IT REPLACES. Every fusion read:

    Unknown Location Intelligence Event
    AIS + GPS convergence
    "Multi-domain intelligence signals detected at Unknown Location. 8
     signals across 2 domains indicate elevated activity requiring analyst
     review."
    threat: ["Multi-domain signal convergence detected"]

That is the deterministic template, used because the model purpose was off.
It names no vessel, no place and no actor, and "requires analyst review" is
true of every row in the system. It is the same defect as a forecast that
says "escalation in non-state conflict": a sentence nobody can act on and
nobody can be wrong about.

WHY HERE AND NOT IN llm_gate. Claude is reserved for briefings and the
decks built from them. This runs on OpenAI under the same monthly cap as
the voice command, the outlook and the enrichment.

WHAT IS GIVEN AND WHAT IS NOT. The model gets the signals, the domains, the
computed correlation strength and the shared entities — as DECIDED FACTS.
It is never asked to score, rank or estimate anything: those numbers are
computed by correlation_scoring.py and a model restating them in its own
words is how a computed 62 becomes "high confidence" in a report.

Its output then goes through the engine's own _validate_narrative, which
rejects any entity, place or figure not present in the inputs — and on a
second failure the deterministic template is used instead. A fluent
narrative about things that are not there is worse than a dull one.
"""
from __future__ import annotations

import json

MAX_TOKENS = 500

SYSTEM = (
    "You write up a cluster of intelligence signals that converged on one "
    "place and time, for an analyst who will act on it.\n"
    "Reply with JSON only:\n"
    '{"title": <6-9 words naming WHAT and WHERE>, "subtitle": <4-6 words>, '
    '"narrative": <2-3 sentences>, "key_signals": [<up to 4, each one line>], '
    '"threat_indicators": [<up to 2 themes the given signals evidence>]}\n\n'
    "RULES.\n"
    "- NAME THINGS. 'Two tankers dark off Hodeidah during GPS interference' "
    "is a title. 'Multi-domain Intelligence Event' is not — it describes the "
    "system's own plumbing rather than the world.\n"
    "- Use ONLY the signals and facts given. Never an entity, place, vessel, "
    "figure or date that is not in them. There is a validator, and anything "
    "invented is discarded along with the rest of your answer.\n"
    "- The correlation strength and its components are already computed. "
    "Narrate around them; never restate, re-score or re-interpret them.\n"
    "- Where the location is given as coordinates, use the coordinates. Do "
    "not guess the nearest port or country.\n"
    "- No recommendations, no 'requires analyst review', no probability."
)


def write(signals: list, domains: set, severity: str, location_name: str,
          score: dict | None = None, item_id: str = "") -> tuple | None:
    """(title, subtitle, narrative, key_signals, threat_indicators), or None.

    None means the caller should use its deterministic template — the
    purpose is off, the budget is spent, or the model did not answer in the
    agreed shape. Returning None rather than raising keeps this a quality
    difference rather than an outage.
    """
    import openai_gate

    client = openai_gate.get_client(openai_gate.FUSION)
    if client is None:
        return None

    score = score or {}
    components = score.get("components") or {}
    strength = score.get("strength")
    shared = score.get("shared_entities") or []

    lines = [f"- [{s.get('domain','?')}] {s.get('rule_name','?')}: "
             f"{str(s.get('summary',''))[:120]}" for s in signals[:10]]

    facts = [f"Location: {location_name}",
             f"Domains: {', '.join(sorted(domains))}",
             f"Severity (computed): {severity}"]
    if strength is not None:
        facts.append(f"Correlation strength (computed, 0-100): {strength}")
    if components:
        facts.append("Components (computed): " + ", ".join(
            f"{k}={v}" for k, v in components.items() if v is not None))
    if shared:
        facts.append("Entities shared across these signals: " + ", ".join(map(str, shared[:8])))

    model = openai_gate.model_for(openai_gate.FUSION)
    try:
        resp = client.chat.completions.create(
            model=model, max_tokens=MAX_TOKENS, temperature=0.2,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content":
                       "FACTS (already decided — do not re-score)\n"
                       + "\n".join(facts)
                       + f"\n\nSIGNALS ({len(lines)})\n" + "\n".join(lines)}],
        )
    except Exception as e:
        print(f"[fusion] narrative model did not answer: {type(e).__name__}: {e}", flush=True)
        return None

    usage = getattr(resp, "usage", None)
    if usage:
        try:
            import usage_tracker
            usage_tracker.record_call(
                input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                call_type="fusion_narrative", model=model,
                headline=location_name, item_id=item_id)
        except Exception:
            pass

    try:
        d = json.loads(resp.choices[0].message.content or "{}")
    except (json.JSONDecodeError, IndexError, AttributeError):
        return None

    title = str(d.get("title") or "").strip()[:120]
    narrative = str(d.get("narrative") or "").strip()[:900]
    if not title or not narrative:
        return None
    return (
        title,
        str(d.get("subtitle") or "").strip()[:80],
        narrative,
        [str(x)[:200] for x in (d.get("key_signals") or [])][:4],
        [str(x)[:160] for x in (d.get("threat_indicators") or [])][:2],
    )
