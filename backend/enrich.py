"""
enrich.py — making a signal usable, and making mentions converge.

TWO JOBS, AND ONLY ONE OF THEM IS THE MODEL'S.

1. EXTRACTION is the model's. "Tanker IRINA, MMSI 636019825, Iranian-linked,
   transiting Hormuz" is free text; pulling (name=IRINA, mmsi=636019825,
   flag=IR, kind=vessel, place=Hormuz) out of it is exactly the small,
   repeated judgement a cheap model is good at and a regex is not.

2. RESOLUTION IS CODE'S. Deciding that three extractions are the same ship
   is a deterministic question once the fields are out: an MMSI is an
   identity, a normalised name plus a kind is a candidate. The model is
   never asked "are these the same?", because a model that answers that
   wrongly merges two ships and nobody can see why.

So the model proposes fields and the code decides identity. The key is
reproducible, auditable and free to recompute; the expensive part runs once
per signal.

HEADLINES. A wire headline like "Road crashes killed 14 people a day on
average in September: RSF" is about a country it never names. Rewriting is
cheap and the original is always kept — an improved headline that cannot be
compared against what arrived is a headline nobody should trust.

    python enrich.py --sample 5     # try it on real signals, print the result
"""
from __future__ import annotations

import json
import re
import unicodedata

BATCH = 10          # signals per model call — amortises the system prompt
MAX_TOKENS = 900

SYSTEM = (
    "You extract structured facts from one-line intelligence signals.\n"
    "For each numbered signal, reply with an object in the same order:\n"
    '{"n": <number>, "headline": <a clearer headline, or null if the given '
    'one is already clear>, "entities": [{"kind": "vessel"|"aircraft"|"org"|'
    '"person"|"place"|"facility", "name": <proper name>, "mmsi": <9 digits '
    'or null>, "icao24": <6 hex or null>, "flag": <ISO-2 country or null>, '
    '"role": <one or two words, or null>}]}\n'
    # The literal word JSON has to appear, or the API refuses the
    # response_format and the whole batch comes back unenriched.
    "Reply with JSON only: {\"results\": [ ... ]} and nothing else.\n\n"
    "RULES.\n"
    "- Extract only what the text says. Never a fact you know from "
    "elsewhere, never a guess at an MMSI, an ICAO or a flag.\n"
    "- ALWAYS extract the country as a place entity when the text names or "
    "contains one. Half of all signals fail to join to a country, and the "
    "country is usually sitting in the text.\n"
    "- ALWAYS extract every NAMED ACTOR too: an armed group, a military or "
    "police force, a government or ministry, a party, an agency, a company, "
    "an NGO. 'Israel says it killed a Hamas commander' names two actors and "
    "a place, and all three must come back. The console's WHO view is empty "
    "because nothing was reading actors out of this text — a place without "
    "the parties acting in it answers half the question.\n"
    "- An actor's kind: 'org' for a group, force, agency, party or company; "
    "'person' for a named individual; 'facility' for a specific installation, "
    "port, airfield or plant.\n"
    "- REWRITE A HEADLINE THAT DOES NOT SAY WHERE. "
    "'Road crashes killed 14 people a day in September: RSF' with "
    "'Dhaka, Bangladesh' in the text should become 'Bangladesh: road "
    "crashes killed 14 people a day in September'. A headline a reader "
    "cannot place is the commonest defect in this data.\n"
    "- A rewrite may add NO information: no figure, no claim, no cause "
    "that is not already there. Only clarity and the place.\n"
    "- If nothing can be extracted, return an empty entities list. Keep "
    "names as written, without titles."
)


# ── resolution: deterministic, and the model never touches it ───────────

_PUNCT = re.compile(r"[^a-z0-9 ]+")
_SLASHED = re.compile(r"\bm\s*[./]\s*([vt])\b")
_FILLER = re.compile(r"\b(mv|ms|mt|the|tanker|vessel|ship|cargo|bulk|carrier)\b")


def norm_name(s: str) -> str:
    """A name reduced to what two spellings of it have in common.

    Accents folded, punctuation dropped, and the vessel-prefix noise that
    makes "MV IRINA", "M/V Irina" and "tanker Irina" look like three ships
    removed. Not a fuzzy match — a canonical form, so equality is the test
    and the result is reproducible.
    """
    t = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    # The slashed prefixes first. Stripping punctuation turns "m/v" into
    # "m v", which the filler below cannot see as one word — so "M/V Irina"
    # stayed "m v irina" and did not match "MV Irina".
    t = _SLASHED.sub(r"m\1", t)
    t = _PUNCT.sub(" ", t)
    t = _FILLER.sub(" ", t)
    return " ".join(t.split())


def resolution_key(e: dict) -> str | None:
    """The identity of an extracted entity, or None if it has none.

    AN IDENTIFIER WINS OVER A NAME, always. An MMSI is issued and unique;
    a name is a label two ships can share and one ship can change. So
    "Irina" with an MMSI and "Irina" without resolve to the same key only
    when the one without is matched by name to a mention that had it —
    which is what link_mentions below does, in code, visibly.
    """
    kind = (e.get("kind") or "").strip().lower()
    mmsi = re.sub(r"\D", "", str(e.get("mmsi") or ""))
    if kind == "vessel" and len(mmsi) == 9:
        return f"vessel:mmsi:{mmsi}"
    icao = re.sub(r"[^0-9a-f]", "", str(e.get("icao24") or "").lower())
    if kind == "aircraft" and len(icao) == 6:
        return f"aircraft:icao:{icao}"
    name = norm_name(e.get("name"))
    if not name:
        return None
    return f"{kind or 'thing'}:name:{name}"


def link_mentions(entities: list[dict]) -> dict[str, str]:
    """Fold name-keyed mentions onto identifier-keyed ones.

    This is the Irina case. Three mentions —
        tanker IRINA                       -> vessel:name:irina
        IRINA, MMSI 636019825              -> vessel:mmsi:636019825
        Irina, Iranian-flagged, at Hormuz  -> vessel:name:irina
    — become one, because the middle mention proves which ship the name
    belongs to. The mapping is returned rather than applied, so what was
    merged into what is inspectable instead of implicit.

    It only ever folds a NAME onto an IDENTIFIER, never a name onto another
    name: two mentions of "Irina" with no identifier between them are not
    evidence of anything.
    """
    by_name: dict[tuple[str, str], str] = {}
    for e in entities:
        key = resolution_key(e)
        if not key or ":name:" in key:
            continue
        nm = norm_name(e.get("name"))
        if nm:
            by_name[((e.get("kind") or "thing").lower(), nm)] = key

    out: dict[str, str] = {}
    for e in entities:
        key = resolution_key(e)
        if not key:
            continue
        if ":name:" in key:
            canonical = by_name.get(((e.get("kind") or "thing").lower(), norm_name(e.get("name"))))
            if canonical:
                out[key] = canonical
    return out


# ── the model call ──────────────────────────────────────────────────────

def enrich_batch(signals: list[dict]) -> list[dict]:
    """Extract and rewrite, for up to BATCH signals in one call.

    Each input needs an `id` and a `text`. Returns one result per input, in
    the same order, with `enriched: False` when the model was unavailable —
    never a partial list, because a caller matching results to inputs by
    position cannot survive a short answer.
    """
    import openai_gate
    out = [{"id": s.get("id"), "enriched": False, "headline": None,
            "entities": [], "keys": []} for s in signals]
    if not signals:
        return out

    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None:
        return out

    numbered = "\n".join(f"{i+1}. {str(s.get('text') or '')[:400]}"
                         for i, s in enumerate(signals))
    model = openai_gate.model_for(openai_gate.ENRICH)
    try:
        resp = client.chat.completions.create(
            model=model, max_tokens=MAX_TOKENS, temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": numbered}],
        )
    except Exception as e:
        # SAY WHY. This used to swallow the exception and return every
        # signal unenriched, which is indistinguishable from "the model had
        # nothing to say" — and a prompt that the API rejected outright
        # looked exactly like a quiet day.
        why = f"{type(e).__name__}: {e}"[:300]
        print(f"[enrich] batch failed — {why}", flush=True)
        for r in out:
            r["error"] = why
        return out

    usage = getattr(resp, "usage", None)
    if usage:
        try:
            import usage_tracker
            usage_tracker.record_call(
                input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                call_type="enrich", model=model,
                headline=f"{len(signals)} signals")
        except Exception:
            pass

    try:
        payload = json.loads(resp.choices[0].message.content or "{}")
        results = payload.get("results") or []
    except (json.JSONDecodeError, IndexError, AttributeError) as e:
        why = f"unparseable answer: {type(e).__name__}"
        print(f"[enrich] {why}", flush=True)
        for r in out:
            r["error"] = why
        return out

    by_n = {}
    for r in results:
        try:
            by_n[int(r.get("n"))] = r
        except (TypeError, ValueError):
            continue

    for i, s in enumerate(signals):
        r = by_n.get(i + 1)
        if not r:
            continue
        ents = [e for e in (r.get("entities") or []) if isinstance(e, dict)]
        # A rewritten headline that is longer than the original, or that
        # adds a number the original did not have, is the model embroidering
        # rather than clarifying.
        head = r.get("headline")
        original = str(s.get("text") or "")
        if isinstance(head, str):
            head = head.strip()[:300]
            if not head or head == original or _adds_numbers(original, head):
                head = None
        else:
            head = None
        out[i] = {
            "id": s.get("id"), "enriched": True,
            "headline": head,
            "entities": ents,
            "keys": [k for k in (resolution_key(e) for e in ents) if k],
        }
    return out


_NUM = re.compile(r"\d+")


def _adds_numbers(original: str, rewritten: str) -> bool:
    """Does the rewrite contain a figure the original did not?

    The one hallucination that matters in a headline is a number, because a
    number is what gets quoted. Catching it is a set comparison, and is
    cheaper and more reliable than asking the model to promise.
    """
    return bool(set(_NUM.findall(rewritten)) - set(_NUM.findall(original)))


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=5)
    a = ap.parse_args()

    import main as _main
    with _main._SURFACE_POOL_LOCK:
        pool = list(_main._SURFACE_POOL)[:a.sample]
    sigs = [{"id": p.get("id"), "text": " — ".join(
        x for x in (p.get("headline"), p.get("location")) if x)} for p in pool]
    for before, after in zip(sigs, enrich_batch(sigs)):
        print("·", before["text"][:90])
        if after["headline"]:
            print("  →", after["headline"])
        for e, k in zip(after["entities"], after["keys"] + [None] * 9):
            print(f"    {e.get('kind'):<9} {str(e.get('name'))[:28]:<28} {k or ''}")
        print()
