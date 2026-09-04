"""
report_sections.py — Maps a real Report (its claims + council_findings) and
its originating ReportSnapshot content onto the Restructure 08.26 fixed
10-section report layout (+ Annex A). Single source of truth for BOTH the
PDF renderer (report_pdf.py) and the frontend-facing section API
(GET /api/reports/{report_id}/sections) — they call the exact same function,
so the in-app editor and the exported PDF cannot structurally diverge.

Real-data honesty note — 3 of the 10 spec sections have no genuinely real
backing data in this codebase as it stands today. Rather than fabricate
content for them, each is rendered honestly (empty + a note), or mapped to
the closest real, citable data actually available:

  - Points of Interest & Changes (6): the only "POI" data anywhere in this
    codebase is a 20-row hardcoded, self-labeled "Mock POI infrastructure
    database" (backend/main.py's `_POIS`) built for an unrelated route-
    analysis feature — not report content, not queryable, not linked to
    ReportSnapshot/claims in any way. This section renders empty with an
    explicit note rather than pretending that list is real report data.
  - Alerts & Notable Events (7): raw Alert rows are read into
    prepare_intelligence_picture() but only survive into the snapshot if
    their domain is AIS or ADS-B (folded into those anomaly buckets) —
    fusion/surge/manual-source alerts are read, quality-checked, counted,
    and then dropped before the snapshot is written. The closest genuinely
    real, already-citable "notable event" data is fusion_events and
    surge_events, so this section maps to claims citing those two.
  - Outlook / Watch Items (9): real forward-looking data exists
    (ForesightAssessment / the snapshot's `foresight_risks` key) but wasn't
    a claim-citable snapshot section before this module — report_council.py's
    _SNAPSHOT_SECTION_ID_FIELDS has been extended with "foresight_risks" so
    a claim can genuinely cite it, closing the gap rather than leaving this
    section permanently uncitable.

Claims whose citation doesn't map to any of the 10 sections (an "external"
citation, or a snapshot_ref to a section — e.g. strategic_zones already
covered under Area Overview, or a genuinely unrecognized one) are never
silently dropped — they're collected into the Annex so every real claim in
the report is still visible somewhere.
"""
from __future__ import annotations
from typing import Optional


SECTIONS = [
    {"number": "1",  "id": "key_judgments",       "title": "Key Judgments",
     "content_rule": "3-7 high-confidence bullets; most important first", "cite_sections": []},
    {"number": "2",  "id": "area_overview",        "title": "Area Overview",
     "content_rule": "Geographic context, AOIs, overview map snapshot(s)", "cite_sections": ["strategic_zones"]},
    {"number": "3",  "id": "maritime_activity",    "title": "Maritime Activity",
     "content_rule": "AIS movements, density, notable tracks, proximity to POIs", "cite_sections": ["ais_anomalies"]},
    {"number": "4",  "id": "aerial_activity",      "title": "Aerial Activity",
     "content_rule": "ADS-B movements, altitude bands, notable tracks", "cite_sections": ["adsb_anomalies"]},
    {"number": "5",  "id": "imagery_detection",    "title": "Imagery & Object Detection",
     "content_rule": "Sentinel analysis, Overwatch results, confirmed/dismissed", "cite_sections": ["sentinel_detections"]},
    {"number": "6",  "id": "poi_changes",          "title": "Points of Interest & Changes",
     "content_rule": "New/updated/archived POIs, revision highlights, linked news", "cite_sections": []},
    {"number": "7",  "id": "alerts_events",        "title": "Alerts & Notable Events",
     "content_rule": "Severity-ordered alerts generated and acknowledged", "cite_sections": ["fusion_events", "surge_events"]},
    {"number": "8",  "id": "open_source_context",  "title": "Open-Source Context",
     "content_rule": "Relevant news/OSINT geo-tagged or thematically linked", "cite_sections": ["news_assessments", "top_articles"]},
    {"number": "9",  "id": "outlook_watch",        "title": "Outlook / Watch Items",
     "content_rule": "Forward indicators and collection priorities", "cite_sections": ["foresight_risks"]},
    {"number": "10", "id": "collection_gaps",      "title": "Collection Gaps & Confidence",
     "content_rule": "Limitations, confidence language, gaps explicit", "cite_sections": []},
    {"number": "A",  "id": "annex",                "title": "Annexes",
     "content_rule": "Track tables, detection lists, raw counts, glossary", "cite_sections": []},
]

_SECTION_BY_ID = {s["id"]: s for s in SECTIONS}
_MAPPED_CITE_SECTIONS = {cs for s in SECTIONS for cs in s["cite_sections"]}

# Sections with genuinely no real backing data today (see module docstring).
_NO_REAL_DATA_NOTES = {
    "poi_changes": (
        "No real POI (points-of-interest) subsystem exists in this build — "
        "the only POI-like data anywhere in the codebase is a small, "
        "self-labeled \"Mock POI infrastructure database\" (backend/main.py) "
        "built for an unrelated route-analysis feature, not real report "
        "content. This section is intentionally left empty rather than "
        "filled with fabricated entries."
    ),
}


def _claim_citation_section(claim: dict) -> Optional[str]:
    citation = claim.get("citation") or {}
    if citation.get("type") == "snapshot_ref":
        return citation.get("section")
    return None


def _findings_for_claim(claim_id: str, council_findings: Optional[dict]) -> list[dict]:
    """Every real council finding that references this claim_id, across all
    3 real check families — the anchor point a frontend comment attaches to."""
    if not council_findings:
        return []
    out = []
    for f in (council_findings.get("deterministic") or []):
        if f.get("claim_id") == claim_id:
            out.append({"kind": f.get("check"), "passed": f.get("passed"), "detail": f.get("detail")})
    cf = council_findings.get("citation_fidelity") or {}
    for f in (cf.get("findings") or []):
        if f.get("claim_id") == claim_id:
            out.append({"kind": "citation_fidelity", "verdict": f.get("verdict"), "comment": f.get("comment")})
    comp = council_findings.get("completeness") or {}
    for f in (comp.get("per_claim") or []):
        if f.get("claim_id") == claim_id:
            out.append({"kind": "completeness", "comment": f.get("comment")})
    return out


def _claim_region(lat, lon) -> Optional[str]:
    if lat is None or lon is None:
        return None
    import threat_matrix
    for name, info in threat_matrix.REGIONS.items():
        if threat_matrix._in_bbox(lat, lon, info["bbox"]):
            return name
    return "Other"


def _claim_view(claim: dict, council_findings: Optional[dict]) -> dict:
    lat, lon = claim.get("lat"), claim.get("lon")
    return {
        "claim_id": claim.get("claim_id"),
        "text": claim.get("text"),
        "citation": claim.get("citation"),
        "source_evaluation": claim.get("source_evaluation"),
        "findings": _findings_for_claim(claim.get("claim_id"), council_findings),
        # Real lat/lon (when the claim carried one — see main.py's
        # _validate_claims) plus a region computed the same way Analytics'
        # region breakdown is: on the fly against threat_matrix's bboxes,
        # since no ingest path stores a region on a claim/alert/signal today.
        "lat": lat, "lon": lon, "region": _claim_region(lat, lon),
    }


def build_report_sections(report: dict, snapshot_content: Optional[dict], snapshot_meta: Optional[dict] = None) -> list[dict]:
    """report: the _report_to_dict() shape (title, key_judgments, claims,
    council_findings, ...). snapshot_content: the real ReportSnapshot's
    parsed content_json (or None if the snapshot no longer exists).
    snapshot_meta: optional {label, period_start, period_end, source} pulled
    from the ReportSnapshot row itself (not inside content_json) for Area
    Overview. Returns the 10 sections + Annex, in fixed order, every one
    real — never fabricated.
    """
    claims = report.get("claims") or []
    council_findings = report.get("council_findings")
    snapshot_content = snapshot_content or {}
    snapshot_meta = snapshot_meta or {}

    claimed_ids = set()
    out = []
    for spec in SECTIONS:
        if spec["id"] == "annex":
            continue  # built last, once we know which claims went unmapped
        section = {
            "number": spec["number"], "section_id": spec["id"], "title": spec["title"],
            "content_rule": spec["content_rule"], "claims": [], "note": None,
        }

        if spec["id"] == "key_judgments":
            section["key_judgments"] = report.get("key_judgments")

        if spec["id"] == "area_overview":
            section["focus"] = report.get("title")
            section["period_start"] = snapshot_meta.get("period_start")
            section["period_end"] = snapshot_meta.get("period_end")
            section["label"] = snapshot_meta.get("label")
            section["elevated_regions"] = (snapshot_content.get("threat_overview") or {}).get("elevated_regions") or []

        if spec["id"] == "collection_gaps":
            comp = council_findings.get("completeness") if council_findings else None
            section["overall_comment"] = (comp or {}).get("overall_comment")
            section["completeness_status"] = (comp or {}).get("status")
            section["alerts_excluded_low_quality"] = (snapshot_content.get("statistics") or {}).get("alerts_excluded_low_quality")

        if spec["id"] in _NO_REAL_DATA_NOTES:
            section["note"] = _NO_REAL_DATA_NOTES[spec["id"]]

        for c in claims:
            csec = _claim_citation_section(c)
            if csec in spec["cite_sections"]:
                section["claims"].append(_claim_view(c, council_findings))
                claimed_ids.add(c.get("claim_id"))

        out.append(section)

    # Annex — real raw counts from the snapshot, plus every claim that didn't
    # map to one of the 10 sections above (external citations, or a
    # snapshot_ref to a real citable section this layout doesn't have a
    # dedicated place for) so nothing real is silently dropped.
    annex_spec = _SECTION_BY_ID["annex"]
    unmapped_claims = [_claim_view(c, council_findings) for c in claims if c.get("claim_id") not in claimed_ids]
    raw_counts = {
        key: len(snapshot_content.get(key) or [])
        for key in ("ais_anomalies", "adsb_anomalies", "fusion_events", "surge_events",
                    "sentinel_detections", "news_assessments", "strategic_zones",
                    "top_articles", "foresight_risks")
        if key in snapshot_content
    }
    out.append({
        "number": annex_spec["number"], "section_id": annex_spec["id"], "title": annex_spec["title"],
        "content_rule": annex_spec["content_rule"], "claims": unmapped_claims,
        "note": None, "raw_counts": raw_counts,
    })
    return out
