"""
report_draft.py — the real Claude-authored drafting pass for a ReportTask.

Nothing in this codebase called Claude to actually write a report's content
before this: POST /api/reports/tasks/{id}/draft only ever created an empty
Report shell, populated (if at all) by claims the caller passed in by hand —
"drafting" meant a human typing claims into EditingWorkspace from scratch.
This module is the real, new drafting call the Reports follow-up round asked
for: it turns a frozen ReportSnapshot's content into real key_judgments +
real claims with real citations, organized explicitly per category (most
important news, imagery-analysis results, traffic summary) rather than a
generic "write a report" instruction that leaves the model guessing at what
data it has and how to use it.

Ground rule: no fake data. A category with genuinely nothing real to report
gets an honest "no significant activity" sentence, both by explicit prompt
instruction and because the model is only ever shown the categories that
actually have real items — an empty category is described as empty in the
prompt, never hidden or backfilled with invented content.
"""
from __future__ import annotations
import json
import re

import report_language


_STRIP_MD = re.compile(r"```(?:json)?\s*|\s*```")


def _extract_json(text: str):
    try:
        return json.loads(_STRIP_MD.sub("", text).strip())
    except Exception:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except Exception:
            return None
    return None


# Real report sections a drafted claim can land in, and the real snapshot
# section(s) it may cite for each — mirrors report_sections.py's SECTIONS
# exactly (that module is the single source of truth for both the PDF and
# the editor, so a claim's section/citation here must stay valid there).
_DRAFTABLE_SECTIONS = {
    "area_overview":     {"cite": ["strategic_zones"]},
    "maritime_activity": {"cite": ["ais_anomalies"]},
    "aerial_activity":   {"cite": ["adsb_anomalies"]},
    "imagery_detection": {"cite": ["sentinel_detections"]},
    "alerts_events":      {"cite": ["fusion_events", "surge_events"]},
    "open_source_context": {"cite": ["news_assessments", "top_articles"]},
    "outlook_watch":      {"cite": ["foresight_risks"]},
}

_ITEM_ID_FIELD = {
    "ais_anomalies": "signal_id", "adsb_anomalies": "signal_id",
    "fusion_events": "fusion_id", "surge_events": "surge_id",
    "sentinel_detections": "detection_id", "news_assessments": "assessment_id",
    "strategic_zones": "zone_id", "top_articles": "url", "foresight_risks": "zone",
}

# Fields that carry an item's OWN time, place and basis. None of these
# reached the prompt before: the model was asked to draft a dated situation
# report from evidence with no dates, no coordinates and no statement of
# which detector fired. It could only write vaguely, because vague was all
# it had.
_ITEM_TIME_FIELDS = ("created_at", "ts", "timestamp", "published_at", "detected_at", "time_window")
_ITEM_PLACE_FIELDS = ("location_name", "location", "nearest_port", "zone", "region")

_ITEM_LABEL_FIELDS = {
    "ais_anomalies": ("location_name", "summary"),
    "adsb_anomalies": ("location_name", "summary"),
    "fusion_events": ("title", "narrative"),
    "surge_events": ("headline", "time_window"),
    "sentinel_detections": ("object_type", "nearest_port"),
    "news_assessments": ("headline", "summary"),
    "strategic_zones": ("name", "description"),
    "top_articles": ("title", "context_summary"),
    "foresight_risks": ("zone", "situation"),
}


def _iso_day(value) -> str | None:
    """A date the model can actually write into a sentence."""
    if not value:
        return None
    text = str(value)
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})", text)
    if m:
        return f"{m.group(3)}{_MONTHS[int(m.group(2)) - 1]} {m.group(4)}{m.group(5)}Z"
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", text)
    if m:
        return f"{m.group(3)}{_MONTHS[int(m.group(2)) - 1]}"
    return text[:40] or None


_MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")


_RULE_NAMEISH = re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$")


def _first(item: dict, fields) -> str | None:
    for f in fields:
        v = item.get(f)
        if v:
            return str(v)
    return None


def _place(item: dict) -> str | None:
    """A place a sentence can actually name.

    AIS anomaly rows carry the DETECTOR NAME in location_name — the real
    value there is "AIS_DARK_SHIP", not a port. Passing that through as a
    location makes the model write "a vessel off AIS_DARK_SHIP", which is
    both wrong and obviously machine-generated. An identifier-shaped value
    is not a place, so fall through to coordinates instead.
    """
    value = _first(item, _ITEM_PLACE_FIELDS)
    if not value:
        return None
    if _RULE_NAMEISH.match(value.strip()):
        return None
    if value.strip() == str(item.get("rule_name") or "").strip():
        return None
    return value


def _corroboration(item: dict) -> int | None:
    """How many INDEPENDENT modalities stand behind this item.

    This is the two-source test the whole product is built on, and it was
    never shown to the drafting model — so a fusion of four modalities and a
    single unconfirmed report read identically in the prompt and could be
    written up with identical confidence.
    """
    doms = item.get("domains")
    if isinstance(doms, (list, tuple, set)):
        return len({str(d) for d in doms if d}) or None
    sigs = item.get("key_signals")
    if isinstance(sigs, (list, tuple)) and sigs:
        kinds = {str(s.get("domain") or s.get("type") or "") for s in sigs if isinstance(s, dict)}
        kinds.discard("")
        return len(kinds) or None
    return None


def _candidate_items(snapshot_content: dict, cite_sections: list[str], limit: int = 12) -> list[dict]:
    """Real, citable candidate items for one or more snapshot sections, each
    tagged with its real section + item_id so the model can only ever cite
    something that is actually there.

    Each candidate also carries its own WHEN, WHERE, BASIS and PROVENANCE
    where the real item has them. Those fields exist on every snapshot item
    and used to be dropped on the floor here.
    """
    out = []
    for section in cite_sections:
        id_field = _ITEM_ID_FIELD[section]
        label_fields = _ITEM_LABEL_FIELDS[section]
        available = snapshot_content.get(section) or []
        for item in available[:limit]:
            item_id = item.get(id_field)
            if not item_id:
                continue
            lat, lon = item.get("lat"), item.get("lon")
            coords = None
            if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                coords = f"{abs(lat):.2f}{'N' if lat >= 0 else 'S'} {abs(lon):.2f}{'E' if lon >= 0 else 'W'}"
            out.append({
                "cite_section": section,
                "item_id": str(item_id),
                "title": item.get("title") or item.get("headline") or item.get("name"),
                "when": _iso_day(_first(item, _ITEM_TIME_FIELDS)),
                "where": _place(item),
                "coords": coords,
                # What actually fired. "AIS_DARK_SHIP" is a claim a reader can
                # weigh; "an anomaly" is not.
                "basis": item.get("rule_name") or item.get("detector") or item.get("kind"),
                "modality": item.get("domain") or item.get("modality"),
                "corroboration": _corroboration(item),
                "origin_class": item.get("origin_class"),
                "licence_tier": item.get("licence_tier"),
                "summary": {k: item.get(k) for k in label_fields if item.get(k)},
                "severity": item.get("severity"), "confidence": item.get("confidence"),
                "relevance_score": item.get("relevance_score"),
            })
        # Truncation is stated, not silent: the model needs to know it is
        # looking at a sample, or it will write "the only activity observed".
        if len(available) > limit and out:
            out[-1]["_truncated_from"] = len(available)
    return out


def _ontology_context_names(snapshot_content: dict, cite_sections: list[str], limit: int = 12) -> list[str]:
    """Real ontology-linked entity names (the same real linked_zones/
    linked_cables/linked_ports fields backend/main.py's get_report_xref_index
    already reads off these same items) touching this draft's candidate
    items — informational context only, never a new citable category (the
    model would have no real item_id to cite for one), so a claim can still
    only ever cite a real snapshot item_id already validated below. Lets
    generated prose naturally mention a real cable/port/zone name rather
    than the Network-and-attribution reader section being the only place
    this real data ever surfaces."""
    names: set[str] = set()
    for section in cite_sections:
        for item in (snapshot_content.get(section) or [])[:limit]:
            for key in ("linked_zones", "linked_cables", "linked_ports"):
                for name in (item.get(key) or []):
                    if name:
                        names.add(str(name).strip())
    return sorted(names)


def _format_candidates(candidates: list[dict]) -> str:
    if not candidates:
        return "(none — genuinely nothing real available for this category right now)"
    lines = []
    truncated = None
    for c in candidates:
        truncated = c.get("_truncated_from") or truncated
        head = [f"item_id={c['item_id']}", f"cite_section={c['cite_section']}"]
        if c.get("when"):
            head.append(f"when={c['when']}")
        if c.get("where"):
            head.append(f"where={c['where']}")
        elif c.get("coords"):
            head.append(f"at={c['coords']}")
        if c.get("severity"):
            head.append(f"severity={c['severity']}")
        if c.get("confidence") is not None:
            head.append(f"confidence={c['confidence']}")
        if c.get("relevance_score") is not None:
            head.append(f"relevance={c['relevance_score']}")
        if c.get("basis"):
            head.append(f"basis={c['basis']}")
        if c.get("modality"):
            head.append(f"modality={c['modality']}")
        if c.get("corroboration"):
            head.append(f"independent_modalities={c['corroboration']}")
        # Two axes, never collapsed into one field.
        if c.get("origin_class"):
            head.append(f"origin_class={c['origin_class']}")
        if c.get("licence_tier"):
            head.append(f"licence_tier={c['licence_tier']}")
        title = c.get("title")
        summary = " | ".join(f"{k}: {v}" for k, v in (c.get("summary") or {}).items())
        body = " — ".join(x for x in (title, summary) if x)
        lines.append(f"  - [{', '.join(head)}] {body}")
    if truncated:
        lines.append(f"  (showing the top {len(candidates)} of {truncated} real items in this "
                     f"category — do not write as though these were the only ones)")
    return "\n".join(lines)


# §S4.3's document sections. The analyst ticks these in Generate; before
# this they were collected in the UI and never sent anywhere, so turning
# "Recommended actions" off changed nothing about what came back.
_DOC_SECTION_LABELS = {
    "executive_judgement": "an executive judgement",
    "signal_assessment": "a signal-by-signal assessment",
    "exposure_impact": "exposure and continuity impact",
    "indicators_warnings": "indicators and warnings",
    "recommended_actions": "recommended actions",
    "sourcing_method": "sourcing and method",
}


def _sections_block(sections) -> str:
    if not sections:
        return ""
    keep = [s for s in sections if s in _DOC_SECTION_LABELS]
    if not keep or len(keep) == len(_DOC_SECTION_LABELS):
        return ""
    drop = [k for k in _DOC_SECTION_LABELS if k not in keep]
    out = ("The analyst has chosen which sections this document contains. Include: "
           + ", ".join(_DOC_SECTION_LABELS[k] for k in keep) + ".")
    if "indicators_warnings" in drop:
        out += " Return an EMPTY warnings list."
    if "recommended_actions" in drop:
        out += " Return an EMPTY actions list."
    if "sourcing_method" in drop:
        out += (" The analyst has switched off the sourcing and method section; still cite "
                "item_ids exactly as required, since citations are how claims are validated.")
    return out


_SYSTEM = (
    "You are an intelligence analyst drafting a structured situation report from a real, "
    "pre-assembled intelligence picture. You are given real, already-selected and ranked "
    "candidate items per category, each with a real item_id — you may ONLY cite an item_id "
    "you were actually given, never invent one. If a category's candidate list says none are "
    "available, you MUST write an honest sentence saying so for that category "
    "(e.g. 'No significant imagery-detection activity identified in this window') — never "
    "invent a plausible-sounding item to fill the gap. Write with the flat, precise, hedge-where-"
    "warranted register of a real analyst — not marketing language, not vague filler."
)


_EMPTY_NOTE = "No signals were selected for this cycle."


def generate_draft(snapshot_content: dict, focus: str | None, region_label: str | None, client, usage_tracker_mod,
                    force_empty: bool = False, standing_instruction: str | None = None,
                    language: str | None = None, sections: list | None = None) -> dict:
    """Draft key_judgments + claims from a real ReportSnapshot's content.

    Returns {"status": "ok", "key_judgments": str, "claims": [...], "narrative": {...}}
    on success, or {"status": "skipped"|"error", "reason": ...} — never fakes
    a draft when the model can't be reached; the caller falls back to an
    empty, honestly-labeled draft rather than fabricated claims.

    force_empty=True is the deliberate "generate without evidence" run (§0):
    skips the API call entirely rather than sending an empty evidence array
    and letting the model invent content to fill the gap — every
    evidence-dependent field gets the same honest empty-state note.
    """
    if force_empty:
        return {
            "status": "ok", "key_judgments": _EMPTY_NOTE, "claims": [],
            "narrative": {"second_para": _EMPTY_NOTE, "bottom_line": _EMPTY_NOTE, "warnings": [], "actions": []},
        }
    if client is None:
        return {"status": "skipped", "reason": "no Claude client configured"}

    traffic = snapshot_content.get("traffic_summary") or {}
    stats = snapshot_content.get("statistics") or {}

    per_section_candidates = {
        section: _candidate_items(snapshot_content, cfg["cite"])
        for section, cfg in _DRAFTABLE_SECTIONS.items()
    }
    all_cite_sections = [s for cfg in _DRAFTABLE_SECTIONS.values() for s in cfg["cite"]]
    ontology_names = _ontology_context_names(snapshot_content, all_cite_sections)

    user = f"""Scope: {focus or region_label or 'Global overview'}
Generated at: {snapshot_content.get('generated_at')}

REAL TRAFFIC VOLUME (not individually citable — for Key Judgments context only):
  Active vessels tracked (window): {traffic.get('active_vessel_count', 'unknown')}
  Active aircraft tracked (window): {traffic.get('active_aircraft_count', 'unknown')}
  Loitering-pattern alerts: {traffic.get('loitering_count', 0)}
  Dark-ship (AIS gap) alerts: {traffic.get('dark_ship_count', 0)}
  Sanctioned-vessel hits: {traffic.get('sanctioned_vessel_count', 0)}
  Chokepoint activity alerts: {traffic.get('chokepoint_activity_count', 0)}
  Window: {traffic.get('window_hours', 24)}h

REAL, PRE-RANKED CANDIDATE ITEMS PER SECTION (cite ONLY these item_ids):

[maritime_activity — notable AIS vessel anomalies]
{_format_candidates(per_section_candidates['maritime_activity'])}

[aerial_activity — notable ADS-B aircraft anomalies]
{_format_candidates(per_section_candidates['aerial_activity'])}

[imagery_detection — real satellite/Overwatch scan detections]
{_format_candidates(per_section_candidates['imagery_detection'])}

[open_source_context — most important real, ranked news items]
{_format_candidates(per_section_candidates['open_source_context'])}

[alerts_events — active multi-domain fusion/surge events]
{_format_candidates(per_section_candidates['alerts_events'])}

[area_overview — active strategic zones]
{_format_candidates(per_section_candidates['area_overview'])}

[outlook_watch — real forward-looking escalation risk assessments]
{_format_candidates(per_section_candidates['outlook_watch'])}

Statistics: {json.dumps(stats)}

{report_language.prompt_block(language)}
{_sections_block(sections)}
{f"REAL ONTOLOGY CONTEXT (real cable/port/strategic-zone names already linked to the items above — mention naturally in prose where relevant; this is context, not a new citable category, so still cite only the real item_ids above): {', '.join(ontology_names)}" if ontology_names else ""}
{f"Standing instruction from the requesting analyst (apply it, but never let it override the no-fabrication rules above): {standing_instruction.strip()}" if standing_instruction and standing_instruction.strip() else ""}

Write:
1. key_judgments: 3-7 high-confidence bullet-point sentences, most important first,
   covering the real traffic volume context above plus the most significant real items
   across all categories. Plain sentences separated by newlines, no markdown bullets.
2. claims: one claim per genuinely significant real candidate item you want to highlight
   (do not force one for every single item if there are many similar ones — pick the
   real, significant ones). Also include ONE claim per category that has NO real
   candidates, with an honest "no significant activity" text and citation omitted
   (see below).

3. second_para: one supporting paragraph (2-4 sentences) giving real context behind
   the key judgements above — quantify only what the evidence/statistics state.
4. bottom_line: one single sentence, the single most important takeaway for a reader
   who reads nothing else. If nothing here rises to that level, say so honestly
   (e.g. "No single development in this window meets the bar for a bottom-line call.").
5. warnings: a real list of short indicator/warning strings grounded in the evidence
   above (empty list if genuinely none warrant flagging — never invent one to fill it).
6. actions: a real list of [text, owner, by] triples — recommended actions, a
   plausible real owner role (e.g. "Duty analyst", "Fleet security"), and a relative
   deadline like "D+2" — grounded in the evidence above (empty list if none warrant it).

Return ONLY this JSON shape:
{{
  "key_judgments": "...",
  "claims": [
    {{"section": "maritime_activity", "text": "...", "cite_section": "ais_anomalies", "item_id": "..."}},
    {{"section": "imagery_detection", "text": "No significant imagery-detection activity identified in this window.", "cite_section": null, "item_id": null}}
  ],
  "second_para": "...",
  "bottom_line": "...",
  "warnings": ["...", "..."],
  "actions": [["...", "...", "D+2"], ["...", "...", "D+7"]]
}}
"""

    try:
        resp = client.messages.create(
            model="claude-sonnet-5", max_tokens=6000,
            system=_SYSTEM, messages=[{"role": "user", "content": user}],
        )
        text = None
        for block in resp.content or []:
            if getattr(block, "type", None) == "text":
                text = block.text
                break
        text = text or ""
        if usage_tracker_mod is not None:
            usage_tracker_mod.record_call(
                getattr(resp.usage, "input_tokens", 0), getattr(resp.usage, "output_tokens", 0),
                call_type="report_draft", headline="Snapshot report drafting",
            )
        parsed = _extract_json(text)
        if not isinstance(parsed, dict) or "claims" not in parsed:
            return {"status": "error", "reason": "could not parse model response", "raw": text[:800]}
    except Exception as ex:
        return {"status": "error", "reason": str(ex)}

    # Build real, validated claims — a claim whose model-proposed item_id
    # isn't actually one of the real candidates we offered is dropped
    # (never trusted blindly), not silently rewritten into something that
    # would pass validation by accident.
    valid_ids = {
        (c["cite_section"], c["item_id"])
        for items in per_section_candidates.values() for c in items
    }
    claims = []
    no_activity_notes = []
    for c in parsed.get("claims") or []:
        text_ = (c.get("text") or "").strip()
        if not text_:
            continue
        cite_section, item_id = c.get("cite_section"), c.get("item_id")
        if cite_section and item_id and (cite_section, str(item_id)) in valid_ids:
            claims.append({
                "text": text_,
                "citation": {"type": "snapshot_ref", "section": cite_section, "item_id": str(item_id)},
                "report_section": c.get("section"),
            })
        elif cite_section or item_id:
            # Model proposed a citation we can't verify — drop it rather
            # than trust an unverifiable one.
            continue
        else:
            # An honest "no real activity in this category" statement has
            # no real item to cite by construction — every claim needs a
            # real citation (_validate_claims(), main.py), so this can't
            # become a claim. report_sections.py already renders an honest
            # "No claims cite <section> data in this report" for a section
            # with zero claims, so folding the model's more specific,
            # analyst-voiced version into key_judgments (free text, no
            # citation required) is what actually surfaces this sentence,
            # rather than losing it.
            no_activity_notes.append(text_)

    key_judgments = (parsed.get("key_judgments") or "").strip()
    if no_activity_notes:
        key_judgments = (key_judgments + "\n" + "\n".join(no_activity_notes)).strip()

    narrative = _narrative_with_fallback(parsed, claims, stats, traffic)

    return {
        "status": "ok",
        "key_judgments": key_judgments,
        "claims": claims,
        "narrative": narrative,
    }


def _narrative_with_fallback(parsed: dict, claims: list[dict], stats: dict, traffic: dict) -> dict:
    """second_para/bottom_line/warnings/actions, falling back field-by-field
    to a deterministic, evidence-derived template when the model omits one —
    never an empty section standing in for a field the model just forgot,
    and never fabricated content when the model gave nothing usable."""
    critical_claims = sum(1 for c in claims if "critical" in (c.get("citation") or {}).get("section", ""))
    total = stats.get("total_active_signals")
    regions = stats.get("elevated_regions")

    second_para = (parsed.get("second_para") or "").strip()
    if not second_para:
        bits = []
        if total is not None:
            bits.append(f"{total} active signals")
        if regions is not None:
            bits.append(f"{regions} elevated regions")
        second_para = (
            f"This reflects {', '.join(bits)} in the current window."
            if bits else "No further real context is available for this window."
        )

    bottom_line = (parsed.get("bottom_line") or "").strip()
    if not bottom_line:
        crit = stats.get("critical_signals") or 0
        bottom_line = (
            f"{crit} critical-severity signal{'s' if crit != 1 else ''} require immediate attention."
            if crit else "No critical-severity signals were identified in this window."
        )

    warnings = [w.strip() for w in (parsed.get("warnings") or []) if isinstance(w, str) and w.strip()]
    if not parsed.get("warnings"):
        warnings = []  # honest empty state, not fabricated — no fallback text needed for an empty list

    actions = [
        a for a in (parsed.get("actions") or [])
        if isinstance(a, list) and len(a) == 3 and all(isinstance(x, str) and x.strip() for x in a)
    ]

    return {"second_para": second_para, "bottom_line": bottom_line, "warnings": warnings, "actions": actions}
