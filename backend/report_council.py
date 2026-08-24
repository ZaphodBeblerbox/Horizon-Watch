"""
report_council.py — The Phase 3 review pipeline for draft intelligence reports.

There is no prior art in this codebase for "a second AI pass checking a
first AI pass" — this is genuinely new territory, built as the roadmap's
recommended hybrid: a sequential structure, where the fact-check stage
itself splits into a cheap deterministic pass (things code can just check)
and a small number of model-based passes with genuinely different lenses
(things that need judgment). Nothing here writes to the live report itself —
run_council() returns a findings dict that the caller attaches to the report
for a human reviewer to read before approving anything.

Deterministic pass — no model call, no cost, no judgment call to get wrong:
  - citation_exists: does each claim's citation actually point at something
    real in the snapshot it claims to cite? (Or, for an external citation,
    is there actually a URL?) A claim citing "signal FUS-1234" that isn't in
    the snapshot is caught here, not by an LLM that might not notice either.
  - geo_sanity: if a claim asserts a zone name for a given lat/lon, does the
    real zone polygon (genuine shapely containment, per the Phase 2 fix)
    actually contain that point?

Model-based lenses (skipped gracefully, not faked, if no client is configured):
  - citation_fidelity: does the claim's own wording overstate what its cited
    excerpt actually supports?
  - completeness: what caveats, missing context, or alternative reads should
    a reviewer see before approving this report?
"""
from __future__ import annotations
import json
import re
from typing import Optional


# ── Deterministic pass ──────────────────────────────────────────────────────

_SNAPSHOT_SECTION_ID_FIELDS = {
    "ais_anomalies":       "signal_id",
    "adsb_anomalies":      "signal_id",
    "fusion_events":       "fusion_id",
    "surge_events":        "surge_id",
    "sentinel_detections": "detection_id",
    "news_assessments":    "assessment_id",
    "strategic_zones":     "zone_id",
    "top_articles":        "url",
}


def _find_snapshot_item(section: str, item_id: str, snapshot_content: dict) -> Optional[dict]:
    id_field = _SNAPSHOT_SECTION_ID_FIELDS.get(section)
    if not id_field:
        return None
    for item in (snapshot_content.get(section) or []):
        if str(item.get(id_field)) == str(item_id):
            return item
    return None


def verify_citation(citation: dict, snapshot_content: dict) -> tuple[bool, str]:
    """Returns (verified, detail). Never assumes a citation is good just
    because it's well-formed — it has to point at something that's actually
    there."""
    if not isinstance(citation, dict):
        return False, "citation is missing or not an object"
    ctype = citation.get("type")
    if ctype == "external":
        url = (citation.get("url") or "").strip()
        if url:
            return True, "external citation has a URL"
        return False, "external citation is missing a url"
    if ctype == "snapshot_ref":
        section = citation.get("section")
        item_id = citation.get("item_id")
        if not section or not item_id:
            return False, "snapshot_ref citation is missing section or item_id"
        if section not in _SNAPSHOT_SECTION_ID_FIELDS:
            return False, f"unknown snapshot section '{section}'"
        item = _find_snapshot_item(section, item_id, snapshot_content)
        if item is not None:
            return True, f"found {item_id} in snapshot section {section}"
        return False, f"{item_id} not found in snapshot section {section} — the snapshot doesn't actually contain this"
    return False, f"unrecognized citation type '{ctype}' (expected 'snapshot_ref' or 'external')"


def check_geo_sanity(claim: dict, db=None) -> Optional[tuple[bool, str]]:
    """If a claim asserts a zone name alongside coordinates, verify the real
    zone polygon actually contains that point (reuses the same genuine
    shapely containment the Phase 2 entity_linker fix introduced). Returns
    None if the claim makes no geo assertion to check."""
    zone_name = (claim.get("asserted_zone") or "").strip()
    lat = claim.get("lat")
    lon = claim.get("lon") if claim.get("lon") is not None else claim.get("lng")
    if not zone_name or lat is None or lon is None:
        return None
    try:
        from relevance_scorer import relevance_scorer
        containing = relevance_scorer.get_containing_zones(float(lat), float(lon), db)
    except Exception as ex:
        return False, f"zone check failed to run: {ex}"
    hit = any(zone_name.lower() in (z.get("name") or "").lower() for z in containing)
    if hit:
        return True, f"'{zone_name}' genuinely contains ({lat}, {lon})"
    names = ", ".join(z.get("name", "?") for z in containing) or "none"
    return False, f"'{zone_name}' does NOT contain ({lat}, {lon}) — zones actually containing this point: {names}"


def run_deterministic_checks(claims: list, snapshot_content: dict, db=None) -> list[dict]:
    findings = []
    for c in claims:
        cid = c.get("claim_id", "?")
        verified, detail = verify_citation(c.get("citation") or {}, snapshot_content)
        findings.append({
            "claim_id": cid, "check": "citation_exists", "passed": verified, "detail": detail,
        })
        geo = check_geo_sanity(c, db)
        if geo is not None:
            passed, detail = geo
            findings.append({
                "claim_id": cid, "check": "geo_sanity", "passed": passed, "detail": detail,
            })
    return findings


# ── Tolerant JSON extraction for model responses ────────────────────────────

def _extract_json(text: str):
    """Finds whichever bracketed structure actually starts first — an array
    or an object — rather than blindly trying '[' before '{', which would
    wrongly match a nested empty list (e.g. "per_claim": []) inside an
    object as if it were the whole response."""
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    idx_arr = text.find("[")
    idx_obj = text.find("{")
    candidates = [(i, o, c) for i, o, c in ((idx_arr, "[", "]"), (idx_obj, "{", "}")) if i != -1]
    if not candidates:
        return None
    start, opener, closer = min(candidates, key=lambda t: t[0])
    end = text.rfind(closer)
    if end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


def _claims_context(claims: list, snapshot_content: dict) -> str:
    lines = []
    for c in claims:
        cite = c.get("citation") or {}
        excerpt = ""
        if cite.get("type") == "snapshot_ref":
            item = _find_snapshot_item(cite.get("section", ""), cite.get("item_id", ""), snapshot_content)
            if item:
                excerpt = json.dumps(item, ensure_ascii=False, default=str)[:400]
        elif cite.get("type") == "external":
            excerpt = f"(external source: {cite.get('url')})"
        lines.append(f"- claim_id={c.get('claim_id')}: \"{c.get('text','')}\"\n  cited data: {excerpt or '(none found)'}")
    return "\n".join(lines)


# ── Model-based lenses ───────────────────────────────────────────────────────

def run_citation_fidelity_lens(claims: list, snapshot_content: dict, client, usage_tracker_mod) -> dict:
    """Does each claim's own wording overstate what its cited data actually
    supports? Skipped (not faked) if no Claude client is configured."""
    if client is None:
        return {"status": "skipped", "reason": "no Claude client configured", "findings": []}
    if not claims:
        return {"status": "ok", "findings": []}
    system = (
        "You are a skeptical fact-checker reviewing an intelligence report's claims against "
        "the raw data each claim cites. For each claim, judge ONLY whether the claim's wording "
        "is supported by its cited data — not whether the underlying event is important. "
        "Flag any overstatement, missing hedge, or claim that goes beyond what the data shows."
    )
    user = (
        "Claims and their cited data:\n\n" + _claims_context(claims, snapshot_content) +
        "\n\nReturn ONLY a JSON array, one object per claim_id: "
        '[{"claim_id": "...", "verdict": "supported"|"overstated"|"unsupported", "comment": "one or two sentences"}]'
    )
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-5-20251015", max_tokens=1500,
            system=system, messages=[{"role": "user", "content": user}],
        )
        text = resp.content[0].text
        if usage_tracker_mod is not None:
            usage_tracker_mod.record_call(
                getattr(resp.usage, "input_tokens", 0), getattr(resp.usage, "output_tokens", 0),
                call_type="report_council", headline="Council: citation fidelity lens",
            )
        parsed = _extract_json(text)
        if isinstance(parsed, list):
            return {"status": "ok", "findings": parsed}
        return {"status": "error", "reason": "could not parse model response", "raw": text[:500], "findings": []}
    except Exception as ex:
        return {"status": "error", "reason": str(ex), "findings": []}


def run_completeness_lens(report_title: str, key_judgments: str, claims: list, client, usage_tracker_mod) -> dict:
    """What caveats, missing context, or alternative reads should a reviewer
    see before approving? Skipped (not faked) if no Claude client is configured."""
    if client is None:
        return {"status": "skipped", "reason": "no Claude client configured", "findings": []}
    system = (
        "You are an experienced intelligence reviewer. You are NOT fact-checking whether claims "
        "are individually true — a separate pass does that. Your job is completeness: what would "
        "a careful reviewer want flagged before this report gets approved? Missing caveats, "
        "alternative interpretations, claims that need more sourcing, or scope the report doesn't "
        "cover but implies."
    )
    claim_lines = "\n".join(f"- {c.get('claim_id')}: {c.get('text','')}" for c in claims)
    user = (
        f"Report title: {report_title}\n\nKey judgments:\n{key_judgments or '(none written)'}\n\n"
        f"Claims:\n{claim_lines or '(no claims)'}\n\n"
        'Return ONLY a JSON object: {"overall_comment": "...", '
        '"per_claim": [{"claim_id": "...", "comment": "..."}]} — per_claim may be an empty list '
        "if no individual claim needs a note."
    )
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-5-20251015", max_tokens=1200,
            system=system, messages=[{"role": "user", "content": user}],
        )
        text = resp.content[0].text
        if usage_tracker_mod is not None:
            usage_tracker_mod.record_call(
                getattr(resp.usage, "input_tokens", 0), getattr(resp.usage, "output_tokens", 0),
                call_type="report_council", headline="Council: completeness lens",
            )
        parsed = _extract_json(text)
        if isinstance(parsed, dict):
            return {"status": "ok", **parsed}
        return {"status": "error", "reason": "could not parse model response", "raw": text[:500], "findings": []}
    except Exception as ex:
        return {"status": "error", "reason": str(ex), "findings": []}


# ── Orchestration ────────────────────────────────────────────────────────────

def run_council(report_title: str, key_judgments: str, claims: list, snapshot_content: dict,
                 client=None, usage_tracker_mod=None, db=None) -> dict:
    """Runs the full sequential review: deterministic pass first (cheap,
    always runs), then the two model-based lenses (skipped gracefully if no
    client). Returns one findings dict — never a single blended verdict."""
    deterministic = run_deterministic_checks(claims, snapshot_content, db)
    citation_fidelity = run_citation_fidelity_lens(claims, snapshot_content, client, usage_tracker_mod)
    completeness = run_completeness_lens(report_title, key_judgments, claims, client, usage_tracker_mod)
    return {
        "deterministic":      deterministic,
        "citation_fidelity":  citation_fidelity,
        "completeness":       completeness,
    }
