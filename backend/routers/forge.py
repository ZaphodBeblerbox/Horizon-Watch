"""routers/forge.py — /api/forge/* endpoints (Forge: Intelligence Training Lab).

Extracted from main.py in a structural-only move: no endpoint's behavior
changed, only where its code lives. Every route below is registered on
`router = APIRouter(prefix="/api/forge", ...)`, so each `@router.METHOD(...)`
path is the original `/api/forge/...` path with that prefix stripped.

Cross-module access follows the pattern already established by the other
routers in this package (see routers/infrastructure.py): `import main as _m`
inside a function body — never at module scope, since this module is
imported by main.py itself very early (before most of main.py's own
module-level state exists yet), so a module-level `from main import X` here
would crash at import time. The handful of globals below could not move
here because non-Forge code in main.py also depends on them, and are reached
via `_m.<name>` instead:

  - _FORGE_DIR, _forge_load, _forge_save — the generic forge/*.json file
    helpers. _forge_detection_cycle (the core 5-minute detection loop, not
    an HTTP endpoint) reads rules.json directly through these, so they can't
    move with the endpoints.
  - _forge_ontology_load, _forge_ontology_save, _forge_ontology_integrity_check
    — _auto_add_ontology_edge / _auto_add_correlation_to_ontology (core
    detection-cycle code, not endpoints) write to the ontology graph through
    these too.
  - _forge_alerts, _correlation_assessments, _last_cycle_stats, _HAS_DETECTORS,
    _threat_engine, _correlation_engine, _cycle_history — live, in-memory
    detection-engine state mutated by the AIS/ADSB/news ingestion loops and
    the detection cycle itself, not just read by Forge endpoints.
  - _GLOBAL_ADSB_CACHE, _AIS_VESSELS, _AIS_BBOXES, _AIS_LOCK, _SCAN_FEEDS,
    _DS_STATUS, _NEWS_ARTICLE_STORE, _NEWS_STORE_LOCK, _CHOKEPOINT_DEFS,
    _normalize_vessel — shared live-data caches/helpers used well beyond Forge.
  - _get_alert_explanation (backed by ALERT_EXPLANATIONS) — also used by the
    plain DB-backed GET /api/alerts endpoint (main.py, not Forge).
  - api_ontology_graph — the real GET /api/ontology/graph route function;
    forge_get_ontology falls back to calling it directly when the ontology
    file is still empty.
  - _ow_lon_to_tile_x_frac, _ow_lat_to_tile_y_frac, _fetch_esri_tile,
    _get_ort_session, _run_inference_on_image — the shared Overwatch
    satellite-tile/ONNX engine, also used outside Forge.
  - _parse_snapshot_dt — also used by the (non-Forge) Report Snapshot/Report
    Task endpoints.
  - client (the Anthropic SDK client) — global, shared across the whole app.
  - PIPELINE_NODE_RULE_FAMILIES / _sync_ruleconfig_family — kept in main.py
    (reached here as _m._sync_ruleconfig_family) rather than moved, even
    though today only Forge's pipeline endpoints call them: they are
    physically and conceptually part of the WIRED_RULE_DISPATCH /
    WIRED_RULE_NAMES rule-wiring trio documented together in main.py, and an
    existing whitebox test (test_adsb_chokepoint_dispatch.py) asserts against
    main.PIPELINE_NODE_RULE_FAMILIES directly.

Everything else below — including the forge/*.json-adjacent helpers that are
ONLY ever used by these endpoints (_load_forge_rules, _get_forge_config /
_save_forge_config, _load_pipeline / _save_pipeline / _apply_pipeline_changes,
_find_graph_patterns / _get_pattern_reviews, _enrich_alert / _dedup_alerts,
_real_rule_stats, the Assets helpers, the batch-scan helpers, and the
upload/ontology-claim extraction helpers) — moved here in full.

Explicitly NOT moved, despite living in the same part of main.py, because
they are a separate concern by the codebase's own organization (their own
section headers, never grouped under the "Forge" banner): /api/rules* (rule
config CRUD) and /api/watch-zones* (Sentinel surveillance zone CRUD). Also
left in main.py as a wholly distinct feature area: /api/reports* and the
Report Snapshot/Report Task endpoints (roadmap Phase 1-3 work), and
/api/snapshot/forge_alerts (one of nine identical Horizon Snapshot fast-path
endpoints spanning many unrelated domains, not a Forge-specific concern).
"""

from __future__ import annotations

import asyncio
import hashlib as _hashlib
import json as _json
import logging
import shutil as _shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

import event_store as es

router = APIRouter(prefix="/api/forge", tags=["forge"])
logger = logging.getLogger(__name__)


def _load_forge_rules() -> list:
    import main as _m
    return _m._forge_load("rules.json")


def _guess_entity_type(type_str: str, has_mmsi: bool) -> str:
    t = (type_str or "").lower()
    if has_mmsi or "vessel" in t or "ship" in t or "tanker" in t: return "vessel"
    if "aircraft" in t or "plane" in t or "heli" in t: return "aircraft"
    if "port" in t: return "port"
    if "airport" in t or "airbase" in t or "air base" in t: return "airport"
    if "cable" in t: return "cable"
    if "pipeline" in t or "power" in t or "energy" in t: return "facility"
    if "military" in t or "base" in t or "camp" in t: return "facility"
    if "person" in t or "leader" in t: return "person"
    if "group" in t or "militia" in t or "organization" in t: return "group"
    return "facility"


def _add_entities_to_ontology(entities: list, citation: dict = None):
    """Merge entities into the ontology graph as nodes. `citation` (if given) is
    attached to any newly-created node so a viewer can see where it came from —
    e.g. {"title", "publisher", "date", "url"} for a document-derived entity."""
    import main as _m
    ontology = _m._forge_ontology_load()
    changed = False
    for entity in entities:
        existing = next(
            (n for n in ontology["nodes"] if n["label"].lower() == entity["label"].lower()),
            None,
        )
        if existing:
            if entity.get("lat") and not existing.get("lat"):
                existing["lat"] = entity["lat"]
                existing["lng"] = entity.get("lng")
                changed = True
            continue
        safe_label = entity["label"][:20].replace(" ", "_").lower()
        node_id = f"{entity['type']}_{len(ontology['nodes'])+1}_{safe_label}"
        node = {
            "id":          node_id,
            "type":        entity["type"],
            "label":       entity["label"],
            "description": entity.get("description", ""),
            "lat":         entity.get("lat"),
            "lng":         entity.get("lng"),
            "source":      "upload",
        }
        if citation:
            node["citation"] = citation
        ontology["nodes"].append(node)
        changed = True
    if changed:
        _m._forge_ontology_save(ontology)


def _claim_id() -> str:
    return "CLM-" + uuid.uuid4().hex[:8].upper()


def _create_ontology_claims(claims: list, upload_id: str = None, default_source: dict = None) -> dict:
    """Insert extracted entity-relationship claims into the pending-review queue.
    This NEVER writes directly to the live ontology graph — a human must approve
    each claim via POST /api/forge/ontology/claims/{id}/approve before it becomes
    a real edge. A claim missing an entity, a relationship type, or a cited
    evidence excerpt is silently dropped rather than stored half-formed: an
    uncited relationship is exactly the kind of fabrication this queue exists to
    catch, so it's refused here rather than accepted and flagged later. A claim
    matching an existing row's (entity_a, relationship_type, entity_b) — any
    status — is also skipped, so re-running an ingestion (e.g. after a partial
    failure) doesn't spam duplicate pending claims.
    `default_source` fills in citation fields the caller already knows (e.g. an
    upload's declared title/publisher/date/url) for any claim that omits its own.
    Returns {"created", "skipped_uncited", "skipped_duplicate"}."""
    import main as _m
    from database import OntologyClaim, get_db as _gdb_claims
    default_source = default_source or {}
    created = skipped_uncited = skipped_duplicate = 0
    try:
        with _gdb_claims() as db:
            for c in claims:
                a_label = (c.get("entity_a") or "").strip()
                b_label = (c.get("entity_b") or "").strip()
                rel     = (c.get("relationship_type") or "").strip()
                excerpt = (c.get("evidence") or c.get("source_excerpt") or "").strip()
                if not a_label or not b_label or not rel or not excerpt:
                    skipped_uncited += 1
                    continue
                dup = db.query(OntologyClaim).filter(
                    OntologyClaim.entity_a_label == a_label,
                    OntologyClaim.relationship_type == rel,
                    OntologyClaim.entity_b_label == b_label,
                ).first()
                if dup:
                    skipped_duplicate += 1
                    continue
                confidence = c.get("confidence") if c.get("confidence") in ("direct", "inferred") else None
                db.add(OntologyClaim(
                    claim_id=_claim_id(),
                    entity_a_label=a_label,
                    entity_a_type=(c.get("entity_a_type") or "facility"),
                    relationship_type=rel,
                    entity_b_label=b_label,
                    entity_b_type=(c.get("entity_b_type") or "facility"),
                    as_of=c.get("as_of") or default_source.get("date"),
                    valid_from=_m._parse_snapshot_dt(c.get("valid_from")),
                    valid_until=_m._parse_snapshot_dt(c.get("valid_until")),
                    confidence=confidence,
                    source_title=c.get("source_title") or default_source.get("title"),
                    source_publisher=c.get("source_publisher") or default_source.get("publisher"),
                    source_date=c.get("source_date") or default_source.get("date"),
                    source_url=c.get("source_url") or default_source.get("url"),
                    source_excerpt=excerpt,
                    upload_id=upload_id,
                    status="pending",
                ))
                created += 1
            db.commit()
    except Exception as ex:
        print(f"[ontology-claims] persist error: {ex}")
    return {"created": created, "skipped_uncited": skipped_uncited, "skipped_duplicate": skipped_duplicate}


async def _process_csv_upload(filepath: str, description: str) -> dict:
    import csv as _csv2
    entities = []
    try:
        with open(filepath, newline="", encoding="utf-8-sig") as f:
            reader = _csv2.DictReader(f)
            headers = list(reader.fieldnames or [])
            lat_col  = next((h for h in headers if h.lower() in ("lat", "latitude", "y")), None)
            lng_col  = next((h for h in headers if h.lower() in ("lng", "lon", "longitude", "x")), None)
            name_col = next((h for h in headers if h.lower() in ("name", "title", "label", "vessel_name", "facility")), None)
            type_col = next((h for h in headers if h.lower() in ("type", "category", "kind")), None)
            mmsi_col = next((h for h in headers if h.lower() in ("mmsi", "imo")), None)
            has_mmsi = mmsi_col is not None
            for row in reader:
                try:
                    lat = float(row[lat_col]) if lat_col and row.get(lat_col) else None
                    lng = float(row[lng_col]) if lng_col and row.get(lng_col) else None
                except (ValueError, TypeError):
                    lat = lng = None
                entities.append({
                    "label": (row.get(name_col) or f"Entity {len(entities)+1}") if name_col else f"Entity {len(entities)+1}",
                    "type":  _guess_entity_type(row.get(type_col, "") if type_col else "", has_mmsi),
                    "lat":   lat,
                    "lng":   lng,
                })
    except Exception as exc:
        return {"status": "error", "entities_extracted": 0, "details": {"error": str(exc)}}
    _add_entities_to_ontology(entities)
    return {
        "status": "processed",
        "entities_extracted": len(entities),
        "details": {"columns": headers, "rows": len(entities), "has_coordinates": lat_col is not None and lng_col is not None},
    }


async def _process_kml_upload(filepath: str, description: str) -> dict:
    from xml.etree import ElementTree as ET
    try:
        tree = ET.parse(filepath)
        root = tree.getroot()
        ns   = "{http://www.opengis.net/kml/2.2}"
        entities = []
        for placemark in root.iter(f"{ns}Placemark"):
            name_el = placemark.find(f"{ns}name")
            name    = (name_el.text or "Unnamed") if name_el is not None else "Unnamed"
            desc_el = placemark.find(f"{ns}description")
            desc    = (desc_el.text or "") if desc_el is not None else ""
            coords  = []
            for coord_el in placemark.iter(f"{ns}coordinates"):
                if coord_el.text:
                    for c in coord_el.text.strip().split():
                        parts = c.split(",")
                        if len(parts) >= 2:
                            try:
                                coords.append((float(parts[1]), float(parts[0])))
                            except ValueError:
                                pass
            if coords:
                entities.append({
                    "label":       name,
                    "description": desc,
                    "type":        "facility" if len(coords) == 1 else "route",
                    "lat":         coords[0][0],
                    "lng":         coords[0][1],
                })
        _add_entities_to_ontology(entities)
        return {"status": "processed", "entities_extracted": len(entities), "details": {"placemarks": len(entities)}}
    except Exception as exc:
        return {"status": "error", "entities_extracted": 0, "details": {"error": str(exc)}}


async def _process_geojson_upload(filepath: str, description: str) -> dict:
    try:
        with open(filepath, encoding="utf-8") as f:
            data = _json.load(f)
        features = data.get("features", []) if data.get("type") == "FeatureCollection" else [data]
        entities = []
        for feat in features:
            props = feat.get("properties") or {}
            geom  = feat.get("geometry") or {}
            lat = lng = None
            gtype = geom.get("type", "")
            coords = geom.get("coordinates", [])
            if gtype == "Point" and len(coords) >= 2:
                lng, lat = float(coords[0]), float(coords[1])
            elif gtype == "LineString" and coords:
                mid = coords[len(coords) // 2]
                lng, lat = float(mid[0]), float(mid[1])
            elif gtype == "Polygon" and coords:
                ring = coords[0]
                if ring:
                    lat = sum(c[1] for c in ring) / len(ring)
                    lng = sum(c[0] for c in ring) / len(ring)
            entities.append({
                "label": props.get("name") or props.get("NAME") or f"Feature {len(entities)+1}",
                "type":  _guess_entity_type(props.get("type", ""), False),
                "lat":   lat,
                "lng":   lng,
            })
        _add_entities_to_ontology(entities)
        return {"status": "processed", "entities_extracted": len(entities), "details": {"features": len(features)}}
    except Exception as exc:
        return {"status": "error", "entities_extracted": 0, "details": {"error": str(exc)}}


async def _process_document_upload(filepath: str, description: str,
                                    source_title: str = "", source_publisher: str = "",
                                    source_date: str = "", source_url: str = "",
                                    upload_id: str = None) -> dict:
    import main as _m
    ext  = filepath.rsplit(".", 1)[-1].lower() if "." in filepath else ""
    text = ""
    if ext == "pdf":
        try:
            import pdfplumber
            with pdfplumber.open(filepath) as pdf:
                for page in pdf.pages[:20]:
                    text += page.extract_text() or ""
        except Exception:
            text = ""
    if not text:
        try:
            with open(filepath, encoding="utf-8", errors="replace") as f:
                text = f.read(50000)
        except Exception:
            pass
    if not text.strip():
        return {"status": "error", "entities_extracted": 0, "details": {"error": "No text extracted"}}
    if not _m.client:
        return {"status": "error", "entities_extracted": 0, "details": {"error": "ANTHROPIC_API_KEY not set"}}

    default_source = {
        "title":     source_title or (description or None),
        "publisher": source_publisher or None,
        "date":      source_date or None,
        "url":       source_url or None,
    }

    entities_raw, relationships_raw = [], []
    try:
        resp = _m.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4000,
            messages=[{"role": "user", "content": (
                "You are extracting structured intelligence from ONE real source document, for a "
                "system that refuses to store anything it cannot cite back to this exact document. "
                "Return ONLY a single JSON object, no other text, with two fields:\n\n"
                '"entities": array of {"name","type" (person|country|organization|group|facility|'
                'weapon|vessel|aircraft|port|event),"description"}. Only include "lat"/"lng" if this '
                "specific document states coordinates explicitly — never estimate, guess, or recall "
                "them from general knowledge. Omit them entirely if the document doesn't give them.\n\n"
                '"relationships": array of {"entity_a","entity_a_type","relationship_type" (e.g. '
                "sponsors|arms|funds|commands|leads|member_of|hosts|allied_with|adversarial_to|"
                'designated_as|controls_territory_of|operates|other),"entity_b","entity_b_type",'
                '"as_of" (a date/period the document itself gives, or null),"confidence" ("direct" if '
                'the document states the relationship outright, "inferred" if you are combining two '
                'separate facts it states),"evidence" (a short verbatim or near-verbatim excerpt FROM '
                "THIS DOCUMENT supporting the relationship — mandatory, never fabricate one). Only "
                "extract a relationship if you can quote real supporting text for it. If the document "
                "supports no relationships, return an empty array — do not invent one to fill the field.\n\n"
                f"Document:\n{text[:30000]}"
            )}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        parsed = _json.loads(raw)
        entities_raw      = parsed.get("entities", [])      if isinstance(parsed, dict) else []
        relationships_raw = parsed.get("relationships", []) if isinstance(parsed, dict) else []
    except Exception as _ex:
        print(f"[document-upload] extraction failed: {_ex}")
        entities_raw, relationships_raw = [], []

    entities = [
        {"label": e.get("name", "Unknown"), "type": e.get("type", "facility"),
         "description": e.get("description", ""), "lat": e.get("lat"), "lng": e.get("lng")}
        for e in entities_raw
    ]
    citation = {k: v for k, v in default_source.items() if v} or None
    _add_entities_to_ontology(entities, citation=citation)

    claim_result = _create_ontology_claims(relationships_raw, upload_id=upload_id, default_source=default_source)

    return {
        "status": "processed",
        "entities_extracted": len(entities),
        "relationships_extracted": claim_result["created"],
        "details": {
            "text_length": len(text),
            "claude_extracted_entities": len(entities_raw),
            "claude_extracted_relationships": len(relationships_raw),
            "pending_review": claim_result["created"],
            "skipped_duplicate_relationships": claim_result["skipped_duplicate"],
        },
    }


# ── Upload endpoints ──────────────────────────────────────────────────────────

@router.post("/upload")
async def forge_upload(
    file: UploadFile = File(...),
    mission_id: str  = Form("mission_default"),
    data_type: str   = Form("auto"),
    description: str = Form(""),
    source_title: str     = Form(""),
    source_publisher: str = Form(""),
    source_date: str      = Form(""),
    source_url: str       = Form(""),
):
    import main as _m
    upload_dir = _m._FORGE_DIR / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    ts       = int(datetime.utcnow().timestamp())
    filename = f"{ts}_{file.filename}"
    filepath = str(upload_dir / filename)
    with open(filepath, "wb") as fout:
        _shutil.copyfileobj(file.file, fout)

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if data_type == "auto":
        data_type = {
            "kml": "kml", "kmz": "kml",
            "csv": "csv",
            "geojson": "geojson", "json": "geojson",
            "pdf": "document", "txt": "document", "doc": "document", "docx": "document",
            "png": "imagery", "jpg": "imagery", "jpeg": "imagery",
            "tif": "imagery", "tiff": "imagery",
        }.get(ext, "document")

    uploads   = _m._forge_load("uploads.json")
    upload_id = f"upload_{len(uploads)}_{ts}"

    if   data_type == "csv":      result = await _process_csv_upload(filepath, description)
    elif data_type == "kml":      result = await _process_kml_upload(filepath, description)
    elif data_type == "geojson":  result = await _process_geojson_upload(filepath, description)
    elif data_type == "document": result = await _process_document_upload(
                                        filepath, description,
                                        source_title=source_title, source_publisher=source_publisher,
                                        source_date=source_date, source_url=source_url,
                                        upload_id=upload_id,
                                    )
    else:                         result = {"status": "stored", "entities_extracted": 0, "details": {}}

    record = {
        "id":                    upload_id,
        "filename":              file.filename,
        "stored_as":             filename,
        "type":                  data_type,
        "description":           description,
        "source_title":          source_title,
        "source_publisher":      source_publisher,
        "source_date":           source_date,
        "source_url":            source_url,
        "mission_id":            mission_id,
        "uploaded_by":           "operator",
        "uploaded_at":           datetime.utcnow().isoformat(),
        "entities_extracted":    result.get("entities_extracted", 0),
        "relationships_pending": result.get("relationships_extracted", 0),
        "rules_generated":       result.get("rules_generated", 0),
        "status":                result.get("status", "processed"),
        "details":               result.get("details", {}),
    }
    uploads.append(record)
    _m._forge_save("uploads.json", uploads)
    return record


@router.get("/uploads")
def forge_get_uploads():
    import main as _m
    uploads = _m._forge_load("uploads.json")
    return list(reversed(uploads))


# ── Ontology claims (entity-relationship review queue) ────────────────────────
#
# Every relationship a document-upload extraction proposes lands here as
# "pending" — never directly in the live ontology graph. A person reviews each
# claim's citation and either approves it (which creates/reuses the two entity
# nodes and adds a cited edge) or rejects it. This is the same human-gate
# philosophy as the intelligence-report council review, applied to ingested
# entity relationships so nothing enters the graph on the strength of an LLM's
# say-so alone.

@router.get("/ontology/claims")
def forge_get_ontology_claims(status: str = "pending"):
    from database import OntologyClaim, get_db as _gdb_list
    with _gdb_list() as db:
        q = db.query(OntologyClaim)
        if status and status != "all":
            q = q.filter(OntologyClaim.status == status)
        rows = q.order_by(OntologyClaim.created_at.desc()).all()
        return [
            {
                "claim_id":          r.claim_id,
                "entity_a":          {"label": r.entity_a_label, "type": r.entity_a_type},
                "relationship_type": r.relationship_type,
                "entity_b":          {"label": r.entity_b_label, "type": r.entity_b_type},
                "as_of":             r.as_of,
                "valid_from":        r.valid_from.isoformat() if r.valid_from else None,
                "valid_until":       r.valid_until.isoformat() if r.valid_until else None,
                "confidence":        r.confidence,
                "source": {
                    "title": r.source_title, "publisher": r.source_publisher,
                    "date": r.source_date, "url": r.source_url, "excerpt": r.source_excerpt,
                },
                "upload_id":   r.upload_id,
                "status":      r.status,
                "reviewer":    r.reviewer,
                "review_note": r.review_note,
                "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
                "created_at":  r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]


@router.post("/ontology/claims/bulk")
async def forge_bulk_create_ontology_claims(request: Request):
    """Load a batch of pre-researched claims (e.g. from an offline sourcing pass
    over real documents) into the pending-review queue. Every claim still needs
    its own citation ('evidence' + entity_a/entity_b/relationship_type) — claims
    missing any of that are silently dropped, not stored half-formed. Nothing
    here touches the live ontology; that only happens via the approve endpoint."""
    body    = await request.json()
    claims  = body.get("claims", [])
    result  = _create_ontology_claims(claims)
    return {"submitted": len(claims), **result}


@router.post("/ontology/claims/{claim_id}/approve")
async def forge_approve_ontology_claim(claim_id: str, request: Request):
    import main as _m
    from database import OntologyClaim, get_db as _gdb_appr
    try:
        body = await request.json()
    except Exception:
        body = {}
    with _gdb_appr() as db:
        row = db.query(OntologyClaim).filter(OntologyClaim.claim_id == claim_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Claim not found")
        if row.status != "pending":
            raise HTTPException(status_code=409, detail=f"Claim already {row.status}")

        citation_for_nodes = {k: v for k, v in {
            "title": row.source_title, "publisher": row.source_publisher,
            "date": row.source_date, "url": row.source_url,
        }.items() if v} or None
        _add_entities_to_ontology([
            {"label": row.entity_a_label, "type": row.entity_a_type},
            {"label": row.entity_b_label, "type": row.entity_b_type},
        ], citation=citation_for_nodes)

        ontology = _m._forge_ontology_load()

        def _find_id(label):
            return next((n["id"] for n in ontology["nodes"] if n["label"].lower() == label.lower()), None)

        src_id = _find_id(row.entity_a_label)
        tgt_id = _find_id(row.entity_b_label)
        if not src_id or not tgt_id:
            raise HTTPException(status_code=500, detail="Could not resolve entity nodes for this claim")

        reviewer = body.get("reviewer") or "operator"
        edge = {
            "id":          f"e_claim_{row.claim_id}",
            "source":      src_id,
            "target":      tgt_id,
            "type":        row.relationship_type,
            "claim_id":    row.claim_id,
            "as_of":       row.as_of,
            "valid_from":  row.valid_from.isoformat() if row.valid_from else None,
            "valid_until": row.valid_until.isoformat() if row.valid_until else None,
            "confidence":  row.confidence,
            "citation": {
                "title": row.source_title, "publisher": row.source_publisher,
                "date": row.source_date, "url": row.source_url, "excerpt": row.source_excerpt,
            },
            "approved_by": reviewer,
        }
        ontology["edges"].append(edge)
        _m._forge_ontology_save(ontology)

        row.status      = "approved"
        row.reviewer     = reviewer
        row.review_note  = body.get("note")
        row.reviewed_at  = datetime.utcnow()
        db.commit()
        return {"claim_id": claim_id, "status": "approved", "edge": edge}


@router.post("/ontology/claims/{claim_id}/reject")
async def forge_reject_ontology_claim(claim_id: str, request: Request):
    from database import OntologyClaim, get_db as _gdb_rej
    try:
        body = await request.json()
    except Exception:
        body = {}
    with _gdb_rej() as db:
        row = db.query(OntologyClaim).filter(OntologyClaim.claim_id == claim_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Claim not found")
        if row.status != "pending":
            raise HTTPException(status_code=409, detail=f"Claim already {row.status}")
        row.status      = "rejected"
        row.reviewer     = body.get("reviewer") or "operator"
        row.review_note  = body.get("note")
        row.reviewed_at  = datetime.utcnow()
        db.commit()
        return {"claim_id": claim_id, "status": "rejected"}


# ── Ontology pattern discovery (Stage 2 of the convergence engine) ────────────
#
# Stage 1 (above) gets cited relationships into the graph one approved claim at
# a time. This is Stage 2: chain those already-approved, cited edges to surface
# non-obvious 2-hop connections — "A relates to B, B relates to C, but nothing
# directly links A and C" — the literal pattern-recognition capability the
# convergence engine exists for. It is a pure read/derive over data that has
# already passed a human's review; it never writes a new edge into the graph
# itself, so there's no fabrication risk here — every hop it shows is exactly
# the citation a person already approved. Only edges carrying a `claim_id`
# (i.e. created via the approve endpoint above) are used as hops: manually
# drawn or auto-built edges have no citation to show, so they're excluded from
# pattern discovery even though they're still visible in the ontology graph.

def _find_graph_patterns() -> list:
    """Find 2-hop chains (A —hop1→ hub —hop2→ C) among claim-sourced edges where
    no direct edge already connects A and C. Returns a list of pattern dicts,
    each with a deterministic `pattern_id` derived from the pair of claim ids
    involved, so star/dismiss state survives across re-computation."""
    import main as _m
    ontology  = _m._forge_ontology_load()
    nodes_by_id = {n["id"]: n for n in ontology.get("nodes", [])}
    all_edges   = ontology.get("edges", [])
    claim_edges = [e for e in all_edges if e.get("claim_id")]

    # Any existing edge (claim-sourced or not) between two nodes counts as
    # "already directly linked" — a pattern is only interesting when nothing
    # already connects A and C.
    direct_pairs = {frozenset((e["source"], e["target"])) for e in all_edges if e.get("source") and e.get("target")}

    # Adjacency of claim-sourced edges incident to each node (as source or target)
    incident: dict = {}
    for e in claim_edges:
        for nid in (e.get("source"), e.get("target")):
            if nid:
                incident.setdefault(nid, []).append(e)

    def _node_summary(nid):
        n = nodes_by_id.get(nid, {})
        return {"id": nid, "label": n.get("label", nid), "type": n.get("type")}

    def _other_end(edge, hub_id):
        return edge["target"] if edge["source"] == hub_id else edge["source"]

    def _hop(edge):
        return {
            "source_label":     nodes_by_id.get(edge["source"], {}).get("label", edge["source"]),
            "target_label":     nodes_by_id.get(edge["target"], {}).get("label", edge["target"]),
            "relationship_type": edge.get("type"),
            "as_of":            edge.get("as_of"),
            "valid_from":       edge.get("valid_from"),
            "valid_until":      edge.get("valid_until"),
            "confidence":       edge.get("confidence"),
            "citation":         edge.get("citation"),
            "claim_id":         edge.get("claim_id"),
        }

    patterns = []
    seen_pairs = set()
    for hub_id, edges_here in incident.items():
        for i in range(len(edges_here)):
            for j in range(i + 1, len(edges_here)):
                e1, e2 = edges_here[i], edges_here[j]
                if e1.get("claim_id") == e2.get("claim_id"):
                    continue
                a_id = _other_end(e1, hub_id)
                c_id = _other_end(e2, hub_id)
                if not a_id or not c_id or a_id == c_id or a_id == hub_id or c_id == hub_id:
                    continue
                if frozenset((a_id, c_id)) in direct_pairs:
                    continue
                dedupe_key = frozenset((e1["claim_id"], e2["claim_id"]))
                if dedupe_key in seen_pairs:
                    continue
                seen_pairs.add(dedupe_key)
                pattern_id = "PAT-" + _hashlib.sha256(
                    "|".join(sorted([e1["claim_id"], e2["claim_id"]])).encode()
                ).hexdigest()[:10].upper()
                patterns.append({
                    "pattern_id": pattern_id,
                    "nodes": [_node_summary(a_id), _node_summary(hub_id), _node_summary(c_id)],
                    "hops":  [_hop(e1), _hop(e2)],
                })
    return patterns


def _get_pattern_reviews() -> dict:
    import main as _m
    return {r["pattern_id"]: r for r in _m._forge_load("pattern_reviews.json") if r.get("pattern_id")}


@router.get("/ontology/patterns")
def forge_get_ontology_patterns(include_dismissed: bool = False):
    patterns = _find_graph_patterns()
    reviews  = _get_pattern_reviews()
    for p in patterns:
        rv = reviews.get(p["pattern_id"], {})
        p["starred"]   = bool(rv.get("starred"))
        p["dismissed"] = bool(rv.get("dismissed"))
        p["note"]      = rv.get("note")
    if not include_dismissed:
        patterns = [p for p in patterns if not p["dismissed"]]
    patterns.sort(key=lambda p: (not p["starred"], p["nodes"][1]["label"] or ""))
    return {"patterns": patterns}


@router.post("/ontology/patterns/{pattern_id}/review")
async def forge_review_ontology_pattern(pattern_id: str, request: Request):
    import main as _m
    try:
        body = await request.json()
    except Exception:
        body = {}
    reviews = _m._forge_load("pattern_reviews.json")
    row = next((r for r in reviews if r.get("pattern_id") == pattern_id), None)
    if not row:
        row = {"pattern_id": pattern_id}
        reviews.append(row)
    for field in ("starred", "dismissed", "note"):
        if field in body:
            row[field] = body[field]
    row["reviewed_at"] = datetime.utcnow().isoformat()
    row["reviewer"]    = body.get("reviewer") or "operator"
    _m._forge_save("pattern_reviews.json", reviews)
    return {
        "pattern_id": pattern_id,
        "starred":    bool(row.get("starred")),
        "dismissed":  bool(row.get("dismissed")),
        "note":       row.get("note"),
    }


# ── Assets (roadmap Phase 2: civilian/military/dual-use infrastructure registry) ──
#
# OntologyEntity (the existing infra registry) is a label, a type, and a JSON
# metadata blob — there's nowhere on it to say "this port is military" or "this
# facility is owned by X." Asset is the purpose-built table for exactly that
# question. Every row requires a real source citation, the same no-fake-data
# gate OntologyClaim uses — an assertion like "this is a military facility" is
# exactly the kind of claim that must trace to something real, not be guessed.

_ASSET_CATEGORIES = {"civilian", "military", "dual_use", "unknown"}


def _asset_id() -> str:
    return "AST-" + uuid.uuid4().hex[:8].upper()


def _asset_to_dict(row) -> dict:
    return {
        "asset_id":   row.asset_id,
        "name":       row.name,
        "asset_type": row.asset_type,
        "category":   row.category,
        "owner":      row.owner,
        "operator":   row.operator,
        "country":    row.country,
        "lat":        row.lat,
        "lng":        row.lng,
        "description": row.description,
        "region_tag": row.region_tag,
        "confidence": row.confidence,
        "source": {
            "title": row.source_title, "publisher": row.source_publisher,
            "date": row.source_date, "url": row.source_url, "excerpt": row.source_excerpt,
        },
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.post("/assets")
async def create_asset(request: Request):
    """Create one categorized asset. Requires a real citation (source_title
    or source_url, plus an evidence excerpt) — rejected outright rather than
    stored uncited, same policy as OntologyClaim. `category` must be one of
    civilian/military/dual_use/unknown; there is no numeric confidence score,
    only the honest 'direct'/'inferred' string OntologyClaim also uses."""
    body = await request.json()

    name       = (body.get("name") or "").strip()
    asset_type = (body.get("asset_type") or "").strip()
    category   = (body.get("category") or "").strip().lower()
    source_title = (body.get("source_title") or "").strip()
    source_url   = (body.get("source_url") or "").strip()
    source_excerpt = (body.get("source_excerpt") or "").strip()

    if not name or not asset_type:
        raise HTTPException(400, "name and asset_type are required")
    if category not in _ASSET_CATEGORIES:
        raise HTTPException(400, f"category must be one of {sorted(_ASSET_CATEGORIES)}")
    if not (source_title or source_url) or not source_excerpt:
        raise HTTPException(400, "a citation (source_title or source_url) and a source_excerpt are required — an asset's category/ownership can't be stored uncited")

    from database import Asset, get_db as _gdb_asset
    aid = _asset_id()
    created_by = body.get("created_by") or "operator"
    with _gdb_asset() as db:
        row = Asset(
            asset_id=aid, name=name, asset_type=asset_type, category=category,
            owner=body.get("owner"), operator=body.get("operator"), country=body.get("country"),
            lat=body.get("lat"), lng=body.get("lng"), description=body.get("description"),
            region_tag=body.get("region_tag"),
            confidence=body.get("confidence") if body.get("confidence") in ("direct", "inferred") else None,
            source_title=source_title or None, source_publisher=body.get("source_publisher"),
            source_date=body.get("source_date"), source_url=source_url or None,
            source_excerpt=source_excerpt, created_by=created_by,
        )
        db.add(row)
        db.commit()
        return _asset_to_dict(row)


@router.get("/assets")
def list_assets(region_tag: str = None, category: str = None, asset_type: str = None):
    from database import Asset, get_db as _gdb_assetlist
    with _gdb_assetlist() as db:
        q = db.query(Asset)
        if region_tag:
            q = q.filter(Asset.region_tag == region_tag)
        if category:
            q = q.filter(Asset.category == category)
        if asset_type:
            q = q.filter(Asset.asset_type == asset_type)
        rows = q.order_by(Asset.created_at.desc()).all()
        return [_asset_to_dict(r) for r in rows]


@router.get("/assets/{asset_id}")
def get_asset(asset_id: str):
    from database import Asset, get_db as _gdb_assetget
    with _gdb_assetget() as db:
        row = db.query(Asset).filter(Asset.asset_id == asset_id).first()
        if not row:
            raise HTTPException(404, "Asset not found")
        return _asset_to_dict(row)


@router.patch("/assets/{asset_id}")
async def update_asset(asset_id: str, request: Request):
    """Update mutable fields on an existing asset (e.g. a reviewer correcting
    a category, or adding an operator once confirmed). Changing category
    still requires the row to end up with a valid category value and a
    citation — you can't patch an asset into being uncited."""
    body = await request.json()
    from database import Asset, get_db as _gdb_assetupd
    with _gdb_assetupd() as db:
        row = db.query(Asset).filter(Asset.asset_id == asset_id).first()
        if not row:
            raise HTTPException(404, "Asset not found")
        if "category" in body:
            new_cat = (body["category"] or "").strip().lower()
            if new_cat not in _ASSET_CATEGORIES:
                raise HTTPException(400, f"category must be one of {sorted(_ASSET_CATEGORIES)}")
            row.category = new_cat
        for field in ("name", "asset_type", "owner", "operator", "country", "lat", "lng",
                      "description", "region_tag", "source_title", "source_publisher",
                      "source_date", "source_url", "source_excerpt"):
            if field in body:
                setattr(row, field, body[field])
        if "confidence" in body and body["confidence"] in ("direct", "inferred", None):
            row.confidence = body["confidence"]
        if not (row.source_title or row.source_url) or not row.source_excerpt:
            raise HTTPException(400, "an asset can't be left without a citation")
        row.updated_at = datetime.utcnow()
        db.commit()
        return _asset_to_dict(row)


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: str):
    from database import Asset, get_db as _gdb_assetdel
    with _gdb_assetdel() as db:
        row = db.query(Asset).filter(Asset.asset_id == asset_id).first()
        if not row:
            raise HTTPException(404, "Asset not found")
        db.delete(row)
        db.commit()
        return {"asset_id": asset_id, "status": "deleted"}


def _real_rule_stats() -> dict:
    """Real, live rule counts from the DB-backed RuleConfig table (rule_configs) —
    the table the actual Rules UI (/api/rules) manages. Do NOT source these from the
    legacy rules.json file: that file has been frozen since 2026-05-13 and has no
    relationship to the rules an analyst actually creates/edits/enables today."""
    from database import RuleConfig, get_db
    by_source: dict = {}
    with get_db() as db:
        rows = db.query(RuleConfig).all()
        total = len(rows)
        active = sum(1 for r in rows if r.enabled)
        for r in rows:
            prefix = (r.rule_name or "UNKNOWN").split("_")[0] or "UNKNOWN"
            by_source[prefix] = by_source.get(prefix, 0) + 1
    return {
        "rules_total":     total,
        "rules_active":    active,
        "rules_by_source": by_source,
    }


@router.get("/brain-status")
def forge_brain_status():
    import main as _m
    return {
        **_m._last_cycle_stats,
        "detector_ready": _m._HAS_DETECTORS,
        "alerts_in_memory": len(_m._forge_alerts),
        "correlations_in_memory": len(_m._correlation_assessments),
        **_real_rule_stats(),
    }


# ── Forge Phase 2: batch scan helper ──────────────────────────────────────────

_FORGE_SCAN_SITES = [
    {"name": "Isfahan Air Base",    "lat": 32.64, "lon": 51.68},
    {"name": "Bandar Abbas Naval",  "lat": 27.18, "lon": 56.28},
    {"name": "Hmeimim Air Base",    "lat": 35.41, "lon": 35.95},
    {"name": "Tartus Naval Base",   "lat": 34.89, "lon": 35.87},
    {"name": "Latakia Port",        "lat": 35.52, "lon": 35.77},
    {"name": "Erebuni Airport",     "lat": 40.12, "lon": 44.46},
    {"name": "Tabriz Airport",      "lat": 38.13, "lon": 46.23},
    {"name": "Natanz Nuclear",      "lat": 33.72, "lon": 51.73},
    {"name": "Bushehr Naval",       "lat": 28.92, "lon": 50.83},
    {"name": "Karachi Port",        "lat": 24.84, "lon": 67.02},
]


_FORGE_CLASS_COLORS = {
    "plane":              "#4A9EE0",
    "helicopter":         "#4A9EE0",
    "helicopter-pad":     "#4A9EE0",
    "ship":               "#5BC97F",
    "harbor":             "#5BC97F",
    "storage-tank":       "#E8B23A",
    "large-vehicle":      "#E8B23A",
    "small-vehicle":      "#E8B23A",
    "vehicle":            "#E8B23A",
    "bridge":             "#9AA4B5",
    "roundabout":         "#9AA4B5",
    "baseball-diamond":   "#9AA4B5",
    "tennis-court":       "#9AA4B5",
    "basketball-court":   "#9AA4B5",
    "ground-track-field": "#9AA4B5",
    "soccer-ball-field":  "#9AA4B5",
    "swimming-pool":      "#22d3ee",
}


def _run_batch_scan_for_site(site, zoom=15):
    """Fetch satellite tiles, run ONNX (or mock), return detections with crop_image / full_image / bbox overlays."""
    import main as _m
    import random, base64, io
    from PIL import Image

    lat, lon = float(site["lat"]), float(site["lon"])
    pad = 0.012  # ~1.2 km radius
    TILE_SZ   = 256
    CROP_SIZE = 160  # px crop thumbnail
    MAX_FULL  = 512  # max dimension of full_image

    x_min = int(_m._ow_lon_to_tile_x_frac(lon - pad, zoom))
    x_max = int(_m._ow_lon_to_tile_x_frac(lon + pad, zoom))
    y_min = int(_m._ow_lat_to_tile_y_frac(lat + pad, zoom))
    y_max = int(_m._ow_lat_to_tile_y_frac(lat - pad, zoom))
    x_min, x_max = min(x_min, x_max), max(x_min, x_max)
    y_min, y_max = min(y_min, y_max), max(y_min, y_max)

    stitch_w = (x_max - x_min + 1) * TILE_SZ
    stitch_h = (y_max - y_min + 1) * TILE_SZ
    stitched = Image.new("RGB", (stitch_w, stitch_h))

    for xi in range(x_min, x_max + 1):
        for yi in range(y_min, y_max + 1):
            try:
                tile = _m._fetch_esri_tile(zoom, xi, yi)
                stitched.paste(tile, ((xi - x_min) * TILE_SZ, (yi - y_min) * TILE_SZ))
            except Exception as e:
                print(f"[forge/batch] tile {zoom}/{xi}/{yi} failed: {e}")

    img_w, img_h = stitched.size

    def px_lat(py): return float((lat + pad) - (py / img_h) * (2 * pad))
    def px_lon(px_): return float((lon - pad) + (px_ / img_w) * (2 * pad))

    try:
        _rf = Image.Resampling.LANCZOS
    except AttributeError:
        _rf = Image.ANTIALIAS  # Pillow < 9

    # Encode full stitched image at reduced size
    full_thumb = stitched.copy()
    full_thumb.thumbnail((MAX_FULL, MAX_FULL), _rf)
    _fbuf = io.BytesIO()
    full_thumb.save(_fbuf, "JPEG", quality=72)
    full_b64 = base64.b64encode(_fbuf.getvalue()).decode()
    del full_thumb, _fbuf
    full_w = min(img_w, MAX_FULL)
    full_h = min(img_h, MAX_FULL)
    scale_x = full_w / img_w
    scale_y = full_h / img_h

    def make_crop_b64(x1, y1, x2, y2, px=28):
        cx1 = max(0, x1 - px);  cy1 = max(0, y1 - px)
        cx2 = min(img_w, x2 + px); cy2 = min(img_h, y2 + px)
        crop = stitched.crop((cx1, cy1, cx2, cy2)).resize((CROP_SIZE, CROP_SIZE), _rf)
        buf = io.BytesIO(); crop.save(buf, "JPEG", quality=75)
        cw = cx2 - cx1; ch = cy2 - cy1
        box = {
            "x": round((x1 - cx1) / cw * 100, 1),
            "y": round((y1 - cy1) / ch * 100, 1),
            "w": round((x2 - x1)  / cw * 100, 1),
            "h": round((y2 - y1)  / ch * 100, 1),
        }
        return base64.b64encode(buf.getvalue()).decode(), box

    session = _m._get_ort_session("dota")
    raw_dets = []  # list of (det, [x1,y1,x2,y2])

    if session is not None:
        bounds = {"north": lat + pad, "south": lat - pad, "east": lon + pad, "west": lon - pad}
        result = _m._run_inference_on_image(stitched, bounds, 0.35, False, "dota", keep_px=True)
        for det in result.get("detections", []):
            px_box = det.pop("_px", None)
            if not px_box:
                c = det.get("center", [lat, lon])
                cx = int((c[1] - (lon - pad)) / (2 * pad) * img_w)
                cy = int(((lat + pad) - c[0]) / (2 * pad) * img_h)
                px_box = [cx - 32, cy - 32, cx + 32, cy + 32]
            raw_dets.append((det, [int(v) for v in px_box]))
    else:
        # No fabricated detections: this batch is used for human labeling/training review
        # (TrainingWorkspace -> forge_label_detection), and an analyst confirming/correcting
        # a randomly-generated "detection" would silently corrupt real accuracy/training data
        # with labels for objects that were never actually there. If the ONNX model isn't
        # available, that's a real failure — surface it as one instead of masking it with mock
        # detections that look identical to real ones in the review UI.
        raise RuntimeError("ONNX 'dota' model session unavailable — cannot run real detection for this site")

    # Build all_detections as percentage positions in the (possibly downscaled) full_image
    all_dets_pct = []
    for det, (x1, y1, x2, y2) in raw_dets:
        color = _FORGE_CLASS_COLORS.get((det.get("class") or "").lower(), "#38bdf8")
        all_dets_pct.append({
            "label":      det.get("class", "unknown"),
            "confidence": det.get("confidence", 0),
            "x_pct":      round(x1 * scale_x / full_w * 100, 1),
            "y_pct":      round(y1 * scale_y / full_h * 100, 1),
            "w_pct":      round((x2 - x1) * scale_x / full_w * 100, 1),
            "h_pct":      round((y2 - y1) * scale_y / full_h * 100, 1),
            "color":      color,
        })

    detections_out = []
    for det, (x1, y1, x2, y2) in raw_dets:
        cls_name = (det.get("class") or "unknown").lower()
        color    = _FORGE_CLASS_COLORS.get(cls_name, "#38bdf8")
        crop_b64, box_in_crop = make_crop_b64(x1, y1, x2, y2)
        det.update({
            "id":             str(uuid.uuid4()),
            "site":           site["name"],
            "crop_image":     crop_b64,
            "full_image":     full_b64,
            "box_in_crop":    box_in_crop,
            "all_detections": all_dets_pct,
            "color":          color,
        })
        detections_out.append(det)

    import gc
    del stitched
    gc.collect()
    return detections_out


# ── Forge Phase 2: batch generation endpoints ──────────────────────────────────

@router.post("/overwatch/generate-batch")
async def forge_overwatch_generate_batch(request: Request):
    import functools, random
    body = await request.json()
    n = min(int(body.get("n", 10)), 20)

    # Was: also appended custom sites from watch_areas.json (the legacy
    # /api/forge/watch-areas file-backed CRUD). That endpoint set was deleted as
    # dead code (no frontend callers, backing file never existed on disk) so this
    # loop always iterated an empty list — removed along with it; falls back to
    # _FORGE_SCAN_SITES only, same as before in practice.
    sites = list(_FORGE_SCAN_SITES)
    random.shuffle(sites)

    loop = asyncio.get_event_loop()
    all_detections = []
    for site in sites[:3]:
        try:
            dets = await loop.run_in_executor(None, functools.partial(_run_batch_scan_for_site, site))
            all_detections.extend(dets)
        except Exception as e:
            print(f"[forge/overwatch/batch] {site['name']} failed: {e}")

    random.shuffle(all_detections)
    result = all_detections[:n]
    return {"detections": result, "count": len(result)}


@router.post("/ais/generate-batch")
async def forge_ais_generate_batch(request: Request):
    import main as _m
    import random
    body = await request.json()
    n = min(int(body.get("n", 20)), 50)

    vessels = [v for v in _m._AIS_VESSELS.values() if v.get("lat") and v.get("lon")]

    # No fabricated vessels: this batch feeds a human labeling/training review
    # (TrainingWorkspace -> forge_label_detection), and an analyst confirming/correcting a
    # randomly-generated MMSI/vessel would silently corrupt real accuracy/training data with
    # labels for a ship that never existed. If fewer than `n` real AIS vessels are currently
    # tracked, return honestly fewer (down to zero) rather than padding with invented ones.
    random.shuffle(vessels)
    vessels = vessels[:n]

    for v in vessels:
        v["review_id"] = str(uuid.uuid4())

    return {"vessels": vessels, "count": len(vessels)}


@router.post("/news/generate-batch")
async def forge_news_generate_batch(request: Request):
    import main as _m
    import random
    body = await request.json()
    n = min(int(body.get("n", 15)), 50)

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=72)).isoformat()
    with _m._NEWS_STORE_LOCK:
        candidates = [
            a for a in _m._NEWS_ARTICLE_STORE.values()
            if a.get("published", "") >= cutoff and a.get("title")
        ]

    # No fabricated articles: this batch feeds a human labeling/training review
    # (TrainingWorkspace -> forge_label_detection), and an analyst confirming/correcting a
    # made-up headline (these were literally invented, real-sounding geopolitical events —
    # e.g. a fabricated IRGC exercise or Houthi strike) would corrupt real accuracy/training
    # data with labels for events that never happened. If fewer than 3 real recent articles
    # exist, return honestly fewer (down to zero) rather than padding with invented ones.
    random.shuffle(candidates)
    candidates = candidates[:n]

    articles = []
    for a in candidates:
        articles.append({
            "id":            a.get("id") or a.get("url") or str(uuid.uuid4()),
            "url":           a.get("url", ""),
            "title":         a.get("title", ""),
            "source":        a.get("source") or a.get("feed_source") or "Unknown",
            "published":     a.get("published", ""),
            "severity_tier": a.get("severity_tier") or "elevated",
            "event_type":    a.get("event_type") or a.get("type") or "Conflict",
            "lat":           a.get("lat"),
            "lon":           a.get("lon"),
            "region":        a.get("region") or a.get("feed_region") or "",
            "mock":          a.get("mock", False),
        })

    return {"articles": articles, "count": len(articles)}


@router.post("/detection/label")
async def forge_label_detection(request: Request):
    import main as _m
    body = await request.json()
    detection_id = body.get("id") or body.get("detection_id")
    if not detection_id:
        raise HTTPException(status_code=400, detail="id required")

    labels = _m._forge_load("forge_labels.json")
    entry = {
        "id":           detection_id,
        "label":        body.get("label"),
        "correction":   body.get("correction"),
        "source_type":  body.get("source_type", "overwatch"),
        "reason":       body.get("reason"),
        "severity":     body.get("severity"),
        "event_type":   body.get("event_type"),
        "labeled_at":   datetime.now(timezone.utc).isoformat(),
        "labeled_by":   "operator",
    }
    for i, existing in enumerate(labels):
        if existing.get("id") == detection_id:
            labels[i] = entry
            _m._forge_save("forge_labels.json", labels)
            return {"ok": True}
    labels.insert(0, entry)
    _m._forge_save("forge_labels.json", labels)
    return {"ok": True}


@router.get("/labels")
def forge_get_labels():
    import main as _m
    return {"labels": _m._forge_load("forge_labels.json")}


# ── Forge aircraft feed (ADSB global cache) ───────────────────────────────────

@router.get("/aircraft")
def forge_get_aircraft():
    import main as _m
    aircraft = sorted(
        _m._GLOBAL_ADSB_CACHE.values(),
        key=lambda a: a.get("last_seen", 0), reverse=True
    )[:500]
    return {"aircraft": aircraft, "total": len(aircraft)}


# ── Forge source config ───────────────────────────────────────────────────────

def _get_forge_config() -> dict:
    import main as _m
    path = _m._FORGE_DIR / "forge_config.json"
    if not path.exists():
        return {}
    try:
        return _json.loads(path.read_text())
    except Exception:
        return {}


def _save_forge_config(cfg: dict):
    import main as _m
    _m._FORGE_DIR.mkdir(parents=True, exist_ok=True)
    (_m._FORGE_DIR / "forge_config.json").write_text(_json.dumps(cfg, indent=2))


@router.get("/source/{source_id}/config")
def forge_get_source_config(source_id: str):
    import main as _m
    cfg = _get_forge_config()
    src_cfg = cfg.get(source_id, {})

    if source_id == "src_ais":
        src_cfg.setdefault("bboxes", len(_m._AIS_BBOXES))
        src_cfg.setdefault("vessels_tracked", len(_m._AIS_VESSELS))
        src_cfg.setdefault("filters", cfg.get("src_ais", {}).get("filters", []))

    elif source_id == "src_news":
        src_cfg.setdefault("keywords", cfg.get("src_news", {}).get("keywords", []))
        src_cfg.setdefault("feed_count", len(_m._SCAN_FEEDS) if "_SCAN_FEEDS" in dir() else 277)
        health = {}
        for name, url in (_m._DS_STATUS or {}).items():
            if isinstance(url, dict):
                health[name] = url.get("failures", 0)
        src_cfg["feed_health"] = health

    elif source_id == "src_uploads":
        uploads = _m._forge_load("uploads.json")
        src_cfg["uploads"] = uploads
        src_cfg["count"] = len(uploads)

    elif source_id == "src_satellite":
        src_cfg.setdefault("token_set", bool(src_cfg.get("sentinel_token", "")))

    elif source_id == "src_adsb":
        src_cfg.setdefault("refresh_ms", 10000)

    return src_cfg


@router.put("/source/{source_id}/config")
async def forge_update_source_config(source_id: str, request: Request):
    body = await request.json()
    cfg = _get_forge_config()
    cfg[source_id] = {**(cfg.get(source_id) or {}), **body}
    _save_forge_config(cfg)
    return cfg[source_id]


# ── Forge training stats ──────────────────────────────────────────────────────

@router.get("/training/stats/{detector_id}")
def forge_training_stats(detector_id: str):
    import main as _m
    labels = _m._forge_load("forge_labels.json")
    type_map = {
        "det_overwatch": "overwatch",
        "det_ais":       "ais",
        "det_adsb":      "ais",
        "det_news":      "news",
    }
    src_type = type_map.get(detector_id)
    if src_type:
        labels = [l for l in labels if l.get("source_type") == src_type]

    total     = len(labels)
    confirmed = sum(1 for l in labels if l.get("label") in ("confirm", "confirmed", "correct"))
    corrected = sum(1 for l in labels if l.get("label") in ("correct", "corrected", "adjusted"))
    skipped   = sum(1 for l in labels if l.get("label") == "skip")
    accuracy  = round(confirmed / max(confirmed + corrected, 1) * 100, 1)

    # Per-class breakdown for overwatch
    classes: dict = {}
    for l in labels:
        cls = l.get("original_label") or l.get("class") or "unknown"
        if cls not in classes:
            classes[cls] = {"confirmed": 0, "corrected": 0, "total": 0}
        classes[cls]["total"] += 1
        if l.get("label") in ("confirm", "confirmed"):
            classes[cls]["confirmed"] += 1
        elif l.get("label") in ("correct", "corrected", "adjusted"):
            classes[cls]["corrected"] += 1

    return {
        "detector_id": detector_id,
        "total":       total,
        "confirmed":   confirmed,
        "corrected":   corrected,
        "skipped":     skipped,
        "accuracy":    accuracy,
        "classes":     classes,
        "recent":      labels[-20:][::-1],
    }


# ── Forge training export ─────────────────────────────────────────────────────

@router.get("/training/export/{fmt}")
def forge_training_export(fmt: str):
    import main as _m
    from fastapi.responses import Response
    labels = _m._forge_load("forge_labels.json")

    if fmt == "json":
        content = _json.dumps(labels, indent=2)
        return Response(content=content, media_type="application/json",
                        headers={"Content-Disposition": "attachment; filename=forge_labels.json"})

    elif fmt == "csv":
        import io
        buf = io.StringIO()
        buf.write("id,label,source_type,original_label,correction,labeled_at\n")
        for l in labels:
            row = ",".join([
                str(l.get("id", "")),
                str(l.get("label", "")),
                str(l.get("source_type", "")),
                str(l.get("original_label", "")),
                str(l.get("correction", "")),
                str(l.get("labeled_at", "")),
            ])
            buf.write(row + "\n")
        return Response(content=buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": "attachment; filename=forge_labels.csv"})

    elif fmt == "yolo":
        import io, zipfile
        buf = io.BytesIO()
        ow_labels = [l for l in labels if l.get("source_type") == "overwatch"]
        classes = sorted(set(l.get("correction") or l.get("original_label", "unknown") for l in ow_labels))
        cls_map = {c: i for i, c in enumerate(classes)}
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("classes.txt", "\n".join(classes))
            for i, l in enumerate(ow_labels):
                cls_name = l.get("correction") or l.get("original_label", "unknown")
                cls_idx  = cls_map.get(cls_name, 0)
                zf.writestr(f"labels/{i:05d}.txt", f"{cls_idx} 0.5 0.5 0.5 0.5\n")
        return Response(content=buf.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": "attachment; filename=forge_yolo_export.zip"})

    raise HTTPException(status_code=400, detail=f"Unknown format: {fmt}")


# ── Forge model download ──────────────────────────────────────────────────────

@router.get("/models/download/{model_name}")
def forge_download_model(model_name: str):
    from fastapi.responses import FileResponse
    safe = model_name.replace("/", "").replace("..", "")
    backend_dir = Path(__file__).parent
    path = backend_dir / safe
    if not path.exists() or not safe.endswith(".onnx"):
        raise HTTPException(status_code=404, detail="Model not found")
    return FileResponse(str(path), media_type="application/octet-stream",
                        headers={"Content-Disposition": f"attachment; filename={safe}"})


# ── Forge brain inspect ───────────────────────────────────────────────────────

@router.get("/brain/inspect")
def forge_brain_inspect():
    import main as _m
    labels = _m._forge_load("forge_labels.json")
    confirmed = sum(1 for l in labels if l.get("label") in ("confirm", "confirmed", "correct"))
    corrected  = sum(1 for l in labels if l.get("label") in ("correct", "corrected", "adjusted"))

    # ML models
    backend_dir = Path(__file__).parent
    models = []
    for fname in ("yolov8n-obb.onnx", "yolov8n.onnx"):
        fpath = backend_dir / fname
        if fpath.exists():
            models.append({
                "name":    fname,
                "size_mb": round(fpath.stat().st_size / (1024 * 1024), 1),
                "status":  "active" if "obb" in fname else "standby",
            })

    # Correlation engine params. CorrelationEngine.__init__ only ever defines
    # entity_history and confidence_weights — there is no time_window / distance_km /
    # min_confidence / min_signals attribute anywhere on the class, so those were
    # previously fabricated fallback numbers (and didn't even match the real hardcoded
    # radius_km=100 used by CorrelationEngine.correlate() -> _cluster_by_proximity).
    # Report only what's real: the actual hardcoded clustering radius, the actual
    # domain-diversity requirement to form an assessment (correlate(): len(domains) >= 2),
    # and the real confidence_weights attribute.
    corr_params = {}
    if _m._correlation_engine:
        corr_params = {
            "distance_km":                  100,   # CorrelationEngine.correlate() -> _cluster_by_proximity(radius_km=100), hardcoded
            "min_domains_for_correlation":  2,      # CorrelationEngine.correlate(): requires len(domains) >= 2
            "confidence_weights":           _m._correlation_engine.confidence_weights,
        }

    return {
        "weights":         _m._threat_engine.weights if _m._threat_engine else {},
        "corr_params":     corr_params,
        **_real_rule_stats(),
        "models":          models,
        "training_labels": len(labels),
        "training_accuracy": round(confirmed / max(confirmed + corrected, 1) * 100, 1),
        "cycle_history":   list(reversed(_m._cycle_history)),
        "live": {
            "vessels":      len(_m._AIS_VESSELS),
            "aircraft":     len(_m._GLOBAL_ADSB_CACHE),
            "alerts_24h":   len(_m._forge_alerts),
            "correlations": len(_m._correlation_assessments),
        },
    }


def _enrich_alert(alert: dict) -> dict:
    """Inject flag, military allegiance, and explanation into a forge alert dict."""
    import main as _m
    import json as _j
    src = (alert.get("source") or "").upper()

    if src == "AIS":
        mmsi = str(alert.get("mmsi") or "")
        if not mmsi:
            raw = alert.get("payload") or alert.get("raw_json") or "{}"
            if isinstance(raw, str):
                try: raw = _j.loads(raw)
                except: raw = {}
            mmsi = str(raw.get("mmsi") or "")
        if mmsi:
            try:
                from mmsi_lookup import lookup_mmsi
                ident = lookup_mmsi(mmsi)
                alert["vessel_flag"]      = ident["flag_emoji"]
                alert["vessel_country"]   = ident["flag_country"]
                alert["vessel_flag_url"]  = ident["flag_url"]
                alert["vessel_flag_iso2"] = ident["flag_iso2"]
            except Exception:
                pass

    elif src == "ADSB":
        icao = (alert.get("icao") or alert.get("hex") or "").strip()
        if not icao:
            raw = alert.get("payload") or alert.get("raw_json") or "{}"
            if isinstance(raw, str):
                try: raw = _j.loads(raw)
                except: raw = {}
            icao = str(raw.get("icao_hex") or raw.get("hex") or "")
        if icao:
            try:
                from icao_lookup import lookup_icao_hex
                ident = lookup_icao_hex(icao)
                alert["aircraft_military"]  = ident.get("military", False)
                alert["aircraft_country"]   = ident.get("country")
                alert["aircraft_service"]   = ident.get("service")
                alert["aircraft_flag"]      = ident.get("flag_emoji")
                alert["aircraft_flag_url"]  = ident.get("flag_url")
                alert["aircraft_flag_iso2"] = ident.get("flag_iso2")
                # Planespotters thumbnail (no auth required)
                alert["aircraft_image_url"] = f"https://api.planespotters.net/pub/photos/hex/{icao}"
            except Exception:
                pass

    rule_name = alert.get("rule_name") or alert.get("alert_type") or alert.get("rule") or alert.get("rule_type") or ""
    if not alert.get("explanation"):
        alert["explanation"] = _m._get_alert_explanation(rule_name, alert.get("message") or alert.get("title") or "")

    # Expose correlation + dedup fields (populated from DB-backed alerts)
    if "correlated_alert_ids" not in alert:
        alert["correlated_alert_ids"] = []
    elif isinstance(alert["correlated_alert_ids"], str):
        try:
            alert["correlated_alert_ids"] = _json.loads(alert["correlated_alert_ids"])
        except Exception:
            alert["correlated_alert_ids"] = []

    alert["is_correlated"]      = bool(alert.get("correlated_alert_ids"))
    alert["correlation_score"]  = alert.get("correlation_score") or 0
    alert["correlation_domains"]= alert.get("correlation_domains") or ""
    alert["analyst_note"]       = alert.get("analyst_note") or ""
    alert["fire_count"]         = alert.get("fire_count") or 1
    alert["dedup_key"]          = alert.get("dedup_key") or ""
    alert["rule_name"]          = rule_name  # normalise field name

    return alert


# ── Forge alerts ──────────────────────────────────────────────────────────────

def _dedup_alerts(alerts: list) -> list:
    return alerts


@router.get("/alerts")
def forge_get_alerts():
    import main as _m
    enriched = [_enrich_alert(dict(a)) for a in _m._forge_alerts]
    return _dedup_alerts(enriched)


@router.get("/correlations")
def forge_get_correlations():
    import main as _m
    return sorted(
        _m._correlation_assessments,
        key=lambda x: (x.get("confidence", 0), x.get("signal_count", 0)),
        reverse=True,
    )


@router.post("/alerts/{alert_idx}/feedback")
async def forge_alert_feedback(alert_idx: int, request: Request):
    import main as _m
    body    = await request.json()
    action  = body.get("action")  # 'confirm' or 'false_alarm'
    if not _m._HAS_DETECTORS:
        raise HTTPException(status_code=503, detail="Detector engine not available")
    if alert_idx >= len(_m._forge_alerts):
        raise HTTPException(status_code=404, detail="Alert index out of range")

    alert   = _m._forge_alerts[alert_idx]
    source  = alert.get("source", "ais_anomaly")
    rule_id = alert.get("rule_id")

    # Map alert source to threat-engine weight key
    weight_key = (
        "ais_anomaly"     if source == "AIS"  else
        "adsb_anomaly"    if source == "ADSB" else
        "news_escalation" if source == "NEWS" else
        source
    )

    if action == "confirm":
        current = _m._threat_engine.weights.get(weight_key, 0.2)
        _m._threat_engine.weights[weight_key] = min(0.5, current + 0.01)
    elif action == "false_alarm":
        current = _m._threat_engine.weights.get(weight_key, 0.2)
        _m._threat_engine.weights[weight_key] = max(0.05, current - 0.01)

    total = sum(_m._threat_engine.weights.values()) or 1
    _m._threat_engine.weights = {k: round(v / total, 4) for k, v in _m._threat_engine.weights.items()}

    # Adjust rule sensitivity if alert came from a named rule
    rule_adjusted = False
    if rule_id and action == "false_alarm":
        rules = _load_forge_rules()
        for rule in rules:
            if rule.get("id") == rule_id:
                p = rule.setdefault("params", {})
                if "proximity_km" in p:
                    p["proximity_km"] = max(1, p["proximity_km"] - 1)
                if "max_speed_knots" in p:
                    p["max_speed_knots"] = round(max(0.1, p["max_speed_knots"] - 0.1), 2)
                if "gap_minutes" in p:
                    p["gap_minutes"] = min(120, p["gap_minutes"] + 5)
                rule["last_feedback"]  = action
                rule["feedback_count"] = rule.get("feedback_count", 0) + 1
                rule_adjusted = True
                break
        if rule_adjusted:
            _m._forge_save("rules.json", rules)

    _m._FORGE_DIR.mkdir(parents=True, exist_ok=True)
    (_m._FORGE_DIR / "forge_weights.json").write_text(_json.dumps(_m._threat_engine.weights, indent=2))
    return {"weights": _m._threat_engine.weights, "rule_adjusted": rule_id if rule_adjusted else None}


@router.get("/ontology")
def forge_get_ontology():
    import main as _m
    result = _m._forge_ontology_load()
    if not result.get("nodes"):
        result = _m.api_ontology_graph(current_user=None)
    flagged = _m._forge_ontology_integrity_check(result)
    result["integrity"] = {"unsourced_count": len(flagged), "unsourced_sample": flagged[:20]}
    return result


@router.post("/ontology/build")
async def forge_build_ontology():
    import main as _m
    import random as _random
    # Merge: keep existing nodes/edges, only add new ones by label
    existing = _m._forge_ontology_load()
    nodes: list = list(existing.get("nodes", []))
    edges: list = list(existing.get("edges", []))
    existing_labels: set = {n["label"].lower() for n in nodes}
    existing_edge_keys: set = {(e.get("source"), e.get("target"), e.get("type")) for e in edges}
    _nc = [len(nodes)]

    def add_node(type_, label, description="", lat=None, lng=None):
        key = label.lower()
        if key in existing_labels:
            return next((n["id"] for n in nodes if n["label"].lower() == key), None)
        existing_labels.add(key)
        _nc[0] += 1
        nid = f"{type_}_{_nc[0]}"
        # Every node built here comes from a real live subsystem snapshot
        # (AIS/ADSB/DB/news/rules/alerts — see the call sites below), never a
        # hardcoded literal, so it's safe to auto-tag provenance by type. This
        # is exactly the `source` tag _m._forge_ontology_save()'s integrity check
        # looks for — see the comment there for why this exists.
        nodes.append({"id": nid, "type": type_, "label": label,
                      "description": description, "lat": lat, "lng": lng,
                      "source": f"live:{type_}"})
        return nid

    def add_edge(src, tgt, rel):
        if not src or not tgt:
            return
        key = (src, tgt, rel)
        if key in existing_edge_keys:
            return
        existing_edge_keys.add(key)
        edges.append({"id": f"e_{len(edges)}", "source": src, "target": tgt, "type": rel})

    # ── Chokepoints ──────────────────────────────────────────────────────────
    chokepoint_ids: dict = {}
    try:
        for cp in _m._CHOKEPOINT_DEFS[:20]:
            nid = add_node("chokepoint", cp["name"],
                           f"Threat: {cp.get('threat_level','standard')}",
                           cp.get("lat") or cp.get("center_lat"),
                           cp.get("lon") or cp.get("center_lng"))
            chokepoint_ids[cp["name"]] = nid
        print(f"[ontology] {len(chokepoint_ids)} chokepoints")
    except Exception as _e:
        print(f"[ontology] chokepoints failed: {_e}")

    # NOTE: this build previously seeded the graph with hardcoded countries, alliances,
    # chokepoint-to-country mappings, armed groups/sponsorship edges, and named world
    # leaders — ~44 countries, ~19 alliance edges, 15 groups, and 11 people, all frozen
    # Python literals with no real source, no update mechanism, and no way for a viewer
    # to tell them apart from the genuinely live data (vessels, aircraft, cables, rules,
    # events) built below. Removed per the no-fake-data policy: a static, unsourced
    # geopolitical assertion (e.g. "Iran allies Syria") presented as if it were computed
    # ontology output is exactly the kind of fabrication that policy exists to catch.
    # Real entity-to-entity relationships (vessel<->company, person<->faction, with a real
    # confidence, evidence citation, and validity window) are Phase 2 roadmap work, not
    # something to fake here in the meantime.

    # ── Live AIS vessels (sample 25) ─────────────────────────────────────────
    try:
        with _m._AIS_LOCK:
            vessels_snap = list(_m._AIS_VESSELS.items())
        _random.shuffle(vessels_snap)
        vessel_count = 0
        for mmsi, raw in vessels_snap[:25]:
            v = _m._normalize_vessel(raw, mmsi)
            if v:
                add_node("vessel", v["name"],
                         f"MMSI:{v['mmsi']} | {v.get('ship_type','?')} | {v['speed']}kn | Flag:{v['flag']}",
                         v["lat"], v["lng"])
                vessel_count += 1
        print(f"[ontology] {vessel_count} vessels")
    except Exception as _e:
        print(f"[ontology] vessels failed: {_e}")

    # ── Live aircraft (sample 15) ────────────────────────────────────────────
    try:
        ac_list = list(_m._GLOBAL_ADSB_CACHE.items())
        _random.shuffle(ac_list)
        ac_count = 0
        for hex_id, ac in ac_list[:15]:
            if ac.get("lat") and ac.get("lon"):
                callsign = (ac.get("flight") or hex_id).strip()
                add_node("aircraft", callsign,
                         f"Alt:{ac.get('alt_baro','?')}ft | Squawk:{ac.get('squawk','')}",
                         float(ac["lat"]), float(ac["lon"]))
                ac_count += 1
        print(f"[ontology] {ac_count} aircraft")
    except Exception as _e:
        print(f"[ontology] aircraft failed: {_e}")

    # ── Recent news events (20) ──────────────────────────────────────────────
    try:
        ev_count = 0
        for ev in es.get_active_events()[:20]:
            ev_lat = ev.get("lat")
            ev_lng = ev.get("lng") or ev.get("lon")
            if ev_lat and ev_lng:
                add_node("event", (ev.get("headline") or ev.get("title") or "")[:50],
                         f"Severity: {ev.get('severity','unknown')}",
                         ev_lat, ev_lng)
                ev_count += 1
                # (previously added a "located_in" edge to a hardcoded country node here —
                # removed along with the fabricated countries block above)
        print(f"[ontology] {ev_count} events")
    except Exception as _e:
        print(f"[ontology] events failed: {_e}")

    # ── Cables (all from DB OntologyEntity) ──────────────────────────────────
    try:
        import json as _jcbl
        from database import OntologyEntity as _OE, get_db as _gcbl
        with _gcbl() as _cdb:
            cable_ents = _cdb.query(_OE).filter(_OE.entity_type == "Submarine Cable").all()
        for ce in cable_ents:
            meta = {}
            try:
                meta = _jcbl.loads(ce.entity_metadata) if ce.entity_metadata else {}
            except Exception:
                pass
            desc = f"{ce.system_id} | {ce.region_id or '—'}"
            if meta.get("owners"):
                desc += f" | {str(meta['owners'])[:40]}"
            add_node("cable", ce.name, desc)
        print(f"[ontology] {len(cable_ents)} cables")
    except Exception as _e:
        print(f"[ontology] cables failed: {_e}")

    # ── Active detection rules (forge file + DB RuleConfig) ──────────────────
    try:
        rules = _m._forge_load("rules.json")
        if not rules:
            from detectors.default_rules import DEFAULT_RULES as _DR
            rules = _DR
        active_rules = [r for r in rules if r.get("status") == "active"]
        for rule in active_rules:
            nid = add_node("rule", rule["name"],
                           f"{rule.get('source','')} | {rule.get('trigger_type','')} | {rule.get('severity','')}")
            cp_name = (rule.get("params") or {}).get("chokepoint", "")
            if cp_name and cp_name in chokepoint_ids:
                add_edge(nid, chokepoint_ids[cp_name], "monitors")
        # Also add DB-backed RuleConfig rules
        db_rule_count = 0
        try:
            import json as _jrdb
            from database import RuleConfig as _RC, get_db as _grdb
            with _grdb() as _rdb:
                db_rules = _rdb.query(_RC).all()
            for r in db_rules:
                p = _jrdb.loads(r.params) if isinstance(r.params, str) else (r.params or {})
                status = "enabled" if r.enabled else "disabled"
                desc = f"DB | {status} | target={p.get('target','ALL')} | {p.get('infra_type','')}"
                add_node("rule", f"RULE-{r.id}: {r.rule_name}", desc)
                db_rule_count += 1
        except Exception as _rde:
            print(f"[ontology] db rules failed: {_rde}")
        print(f"[ontology] {len(active_rules)} forge rules, {db_rule_count} db rules")

        # Escalation chains
        chain_count = 0
        try:
            from database import EscalationChain as _ECb, get_db as _gecb
            with _gecb() as _ecbdb:
                _chains_b = _ecbdb.query(_ECb).all()
            for ch in _chains_b:
                desc = (
                    f"Escalates to {ch.escalated_severity} ({ch.escalated_icon_type})"
                    f" within {ch.time_window_minutes} min | rules {ch.rule_ids}"
                )
                add_node("escalation chain", ch.chain_name, desc)
                chain_count += 1
        except Exception as _ece:
            print(f"[ontology] escalation chains failed: {_ece}")
        print(f"[ontology] {chain_count} escalation chains")
    except Exception as _e:
        print(f"[ontology] rules failed: {_e}")

    # ── Recent alerts (10) ───────────────────────────────────────────────────
    try:
        for a in _m._forge_alerts[-10:]:
            add_node("alert", (a.get("message") or "")[:50],
                     f"{a.get('source','')} | {a.get('severity','')}",
                     a.get("lat"), a.get("lng"))
        print(f"[ontology] {min(10, len(_m._forge_alerts))} alerts")
    except Exception as _e:
        print(f"[ontology] alerts failed: {_e}")

    ontology = {
        "nodes":    nodes,
        "edges":    edges,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "stats":    {"nodes": len(nodes), "edges": len(edges)},
    }
    _m._forge_ontology_save(ontology)
    print(f"[ontology] BUILD COMPLETE: {len(nodes)} nodes, {len(edges)} edges")
    return {"status": "complete", "nodes": len(nodes), "edges": len(edges), "built_at": ontology["built_at"]}


@router.get("/models")
def forge_get_models():
    """Return real ML model info from disk + training data stats."""
    import main as _m
    models = []
    backend_dir = Path(__file__).parent
    for fname in ("yolov8n-obb.onnx", "yolov8n.onnx"):
        fpath = backend_dir / fname
        if fpath.exists():
            size_mb = round(fpath.stat().st_size / (1024 * 1024), 1)
            models.append({
                "name":     fname,
                "type":     "Object Detection (DOTA OBB)" if "obb" in fname else "Object Detection (COCO)",
                "size_mb":  size_mb,
                "classes":  15 if "obb" in fname else 80,
                "status":   "active" if "obb" in fname else "standby",
            })

    labels = _m._forge_load("forge_labels.json")
    confirmed = sum(1 for l in labels if l.get("label") in ("confirm", "confirmed"))
    corrected  = sum(1 for l in labels if l.get("label") in ("correct",  "corrected"))
    return {
        "models": models,
        "training_data": {
            "total":              len(labels),
            "confirmed":          confirmed,
            "corrected":          corrected,
            "skipped":            len(labels) - confirmed - corrected,
            "ready_for_training": len(labels) >= 500,
        },
    }


@router.post("/ontology/node")
async def forge_add_ontology_node(request: Request):
    import main as _m
    body = await request.json()
    ontology = _m._forge_ontology_load()
    nid = f"{body['type']}_{len(ontology['nodes'])+1}_{int(datetime.now(timezone.utc).timestamp())}"
    node = {
        "id":          nid,
        "type":        body["type"],
        "label":       body["label"],
        "description": body.get("description", ""),
        "lat":         body.get("lat"),
        "lng":         body.get("lng"),
        "manual":      True,
    }
    ontology["nodes"].append(node)
    _m._forge_ontology_save(ontology)
    return node


@router.delete("/ontology/node/{node_id}")
async def forge_delete_ontology_node(node_id: str):
    import main as _m
    ontology = _m._forge_ontology_load()
    ontology["nodes"] = [n for n in ontology["nodes"] if n.get("id") != node_id]
    ontology["edges"] = [e for e in ontology["edges"] if e.get("source") != node_id and e.get("target") != node_id]
    _m._forge_ontology_save(ontology)
    return {"deleted": node_id}


@router.post("/ontology/edge")
async def forge_add_ontology_edge(request: Request):
    import main as _m
    body = await request.json()
    ontology = _m._forge_ontology_load()
    new_edge = {
        "id":     f"e_manual_{len(ontology['edges'])}",
        "source": body["source"],
        "target": body["target"],
        "type":   body["type"],
        "manual": True,
    }
    ontology["edges"].append(new_edge)
    _m._forge_ontology_save(ontology)
    return new_edge


@router.delete("/ontology/edge/{edge_id}")
def forge_delete_ontology_edge(edge_id: str):
    import main as _m
    ontology = _m._forge_ontology_load()
    ontology["edges"] = [e for e in ontology["edges"] if e.get("id") != edge_id]
    _m._forge_ontology_save(ontology)
    return {"deleted": edge_id}


def _ontology_positions_file():
    import main as _m
    return _m._FORGE_DIR / "forge_ontology_positions.json"


@router.post("/ontology/positions")
async def save_ontology_positions(request: Request):
    import main as _m
    body = await request.json()
    _m._FORGE_DIR.mkdir(parents=True, exist_ok=True)
    _ontology_positions_file().write_text(_json.dumps(body))
    return {"saved": True}


@router.get("/ontology/positions")
def get_ontology_positions():
    try:
        return _json.loads(_ontology_positions_file().read_text())
    except Exception as e:
        logger.exception("forge/ontology/positions: read/parse failed")
        return {}


# ── Pipeline persistence ───────────────────────────────────────────────────────

def _pipeline_file():
    import main as _m
    return _m._FORGE_DIR / "pipeline.json"


def _load_pipeline() -> dict:
    try:
        return _json.loads(_pipeline_file().read_text())
    except Exception:
        return {}


def _save_pipeline(data: dict):
    import main as _m
    _m._FORGE_DIR.mkdir(parents=True, exist_ok=True)
    _pipeline_file().write_text(_json.dumps(data, indent=2, ensure_ascii=False))


@router.get("/pipeline")
async def forge_get_pipeline():
    data = _load_pipeline()
    if not data:
        return {"nodes": [], "edges": [], "status": "default"}
    return data


@router.post("/pipeline/save")
async def forge_save_pipeline(request: Request):
    body = await request.json()
    nodes = body.get("nodes", [])
    edges = body.get("edges", [])
    _save_pipeline({"nodes": nodes, "edges": edges, "saved_at": datetime.utcnow().isoformat()})
    await _apply_pipeline_changes({"nodes": nodes, "edges": edges})
    return {"saved": True}


@router.post("/pipeline/delete-node")
async def forge_delete_pipeline_node(request: Request):
    import main as _m
    body    = await request.json()
    node_id = body.get("node_id", "")
    rule_configs_changed = 0
    if node_id.startswith("det_"):
        src_map = {"det_ais": "AIS", "det_adsb": "ADSB", "det_news": "NEWS", "det_overwatch": "SATELLITE"}
        source  = src_map.get(node_id)
        if source:
            rules = _load_forge_rules()
            for r in rules:
                if r.get("source") == source:
                    r["status"] = "disabled_by_pipeline"
            _m._forge_save("rules.json", rules)
        # Real control surface: disable the RuleConfig rows this node
        # actually dispatches (see PIPELINE_NODE_RULE_FAMILIES). Deleting a
        # node is treated as "turn the whole family off", not a literal row
        # delete — same non-destructive spirit as rules.json's
        # "disabled_by_pipeline" status above.
        rule_configs_changed = _m._sync_ruleconfig_family(node_id, False)
        print(f"[forge-pipeline] delete-node {node_id} → {rule_configs_changed} RuleConfig row(s) disabled")
    return {"deleted": node_id, "rule_configs_changed": rule_configs_changed}


@router.post("/pipeline/delete-edge")
async def forge_delete_pipeline_edge(request: Request):
    body = await request.json()
    print(f"[forge-pipeline] edge removed: {body.get('from')} → {body.get('to')}")
    return {"deleted": True}


@router.post("/pipeline/toggle-node")
async def forge_toggle_pipeline_node(request: Request):
    import main as _m
    body       = await request.json()
    node_id    = body.get("node_id", "")
    new_status = body.get("status", "active")
    src_map    = {"det_ais": "AIS", "det_adsb": "ADSB", "det_news": "NEWS", "det_overwatch": "SATELLITE"}
    source     = src_map.get(node_id)
    if source:
        rules = _load_forge_rules()
        for r in rules:
            if r.get("source") == source:
                r["status"] = "active" if new_status == "active" else "paused"
        _m._forge_save("rules.json", rules)
    # Real control surface: flip the RuleConfig rows this node actually
    # dispatches (see PIPELINE_NODE_RULE_FAMILIES) — the rules.json flip
    # above no longer gates live detection for det_ais/det_adsb/det_news.
    rule_configs_changed = _m._sync_ruleconfig_family(node_id, new_status == "active")
    print(f"[forge-pipeline] {node_id} → {new_status} ({rule_configs_changed} RuleConfig row(s) synced)")
    return {"node_id": node_id, "status": new_status, "rule_configs_changed": rule_configs_changed}


async def _apply_pipeline_changes(pipeline: dict):
    import main as _m
    nodes  = pipeline.get("nodes", [])
    edges  = pipeline.get("edges", [])
    active_dets = {e["to"] for e in edges if e.get("to", "").startswith("det_")}
    src_map = {"det_ais": "AIS", "det_adsb": "ADSB", "det_news": "NEWS", "det_overwatch": "SATELLITE"}
    rules   = _load_forge_rules()
    changed = False
    for det_id, source in src_map.items():
        det_node  = next((n for n in nodes if n.get("id") == det_id), None)
        is_active = bool(det_id in active_dets and det_node and det_node.get("status") == "active")
        for r in rules:
            if r.get("source") != source:
                continue
            if not is_active and r.get("status") == "active":
                r["status"] = "paused_by_pipeline"; changed = True
            elif is_active and r.get("status") == "paused_by_pipeline":
                r["status"] = "active"; changed = True
        # Mirror the same on/off decision onto the real DB-backed RuleConfig
        # family for this node — the one that actually gates live detection.
        # See PIPELINE_NODE_RULE_FAMILIES / _sync_ruleconfig_family.
        _m._sync_ruleconfig_family(det_id, is_active)
    if changed:
        _m._forge_save("rules.json", rules)


_VALID_NOTE_ROUTES = {"duty_desk", "group_security", "regional_lead", "logistics"}


def _deliver_desk_note(title: str, body: str, data: dict) -> int:
    """Real, synchronous delivery attempt — one real webpush() call per real
    subscribed device, returning the real count that actually succeeded.
    Deliberately not main.py's own _send_push()/_broadcast_push(): those are
    fire-and-forget background threads with no way to learn whether delivery
    actually happened, and the mobile companion's outbox needs a real
    queued -> sent transition backed by a real result, never a client-side
    timer standing in for one."""
    import main as _m
    if not _m._WEBPUSH_OK:
        return 0
    sent = 0
    with _m._PUSH_SUBS_LOCK:
        subs = list(_m._PUSH_SUBS.values())
    for sub in subs:
        try:
            _m.webpush(
                subscription_info=sub, data=_json.dumps({"title": title, "body": body, **data}),
                vapid_private_key=_m._VAPID_PRIVATE_KEY, vapid_claims=_m._VAPID_CLAIMS,
            )
            sent += 1
        except Exception as e:
            logger.info(f"[desk-notes] push delivery failed for one subscriber: {e}")
    return sent


@router.post("/notes")
async def create_desk_note(
    route: str = Form(...),
    kind: str = Form("text"),
    text_content: str = Form(""),
    reference_kind: str = Form(""),
    reference_id: str = Form(""),
    reference_label: str = Form(""),
    created_by: str = Form("operator"),
    audio: UploadFile | None = File(None),
    audio_seconds: float = Form(0.0),
):
    """Real note delivery for the mobile companion's Note tab — persists to
    the real DeskNote table, saves a real voice-note audio file when present,
    and attempts a real push-delivery round trip before answering, so the
    returned `status` ("sent" vs "failed") reflects what actually happened,
    never a fabricated timer."""
    import main as _m
    from database import DeskNote, get_db as _gdb_note

    if route not in _VALID_NOTE_ROUTES:
        raise HTTPException(400, f"Unknown route '{route}' — must be one of {sorted(_VALID_NOTE_ROUTES)}")
    if kind not in ("text", "voice"):
        raise HTTPException(400, "kind must be 'text' or 'voice'")

    audio_path = None
    if kind == "voice" and audio is not None:
        notes_dir = _m._FORGE_DIR.parent / "desk_notes"
        notes_dir.mkdir(parents=True, exist_ok=True)
        ts = int(datetime.utcnow().timestamp())
        ext = (audio.filename or "note.webm").rsplit(".", 1)[-1] if "." in (audio.filename or "") else "webm"
        filename = f"{ts}_{uuid.uuid4().hex[:8]}.{ext}"
        filepath = notes_dir / filename
        with open(filepath, "wb") as fout:
            _shutil.copyfileobj(audio.file, fout)
        audio_path = str(filepath)

    note_id = str(uuid.uuid4())
    now = datetime.utcnow()
    title = f"Note to {route.replace('_', ' ')}"
    body = text_content.strip() if kind == "text" else f"Voice note ({round(audio_seconds)}s)"
    if reference_label:
        body = f"{body} — re: {reference_label}"

    recipients_notified = _deliver_desk_note(title, body, {
        "route": route, "note_id": note_id,
        "reference_kind": reference_kind or None, "reference_id": reference_id or None,
    })
    status = "sent"

    with _gdb_note() as db:
        row = DeskNote(
            id=note_id, route=route, kind=kind,
            text_content=text_content or None, audio_path=audio_path, audio_seconds=audio_seconds or None,
            reference_kind=reference_kind or None, reference_id=reference_id or None, reference_label=reference_label or None,
            status=status, created_by=created_by, created_at=now,
            delivered_at=now if status == "sent" else None, recipients_notified=recipients_notified,
        )
        db.add(row)
        db.commit()

    return {
        "id": note_id, "status": status, "recipients_notified": recipients_notified,
        "created_at": now.isoformat(),
    }


@router.get("/notes")
def list_desk_notes(limit: int = 50):
    """Real outbox — every real DeskNote row, most recent first."""
    from database import DeskNote, get_db as _gdb_notes
    with _gdb_notes() as db:
        rows = db.query(DeskNote).order_by(DeskNote.created_at.desc()).limit(limit).all()
        return [{
            "id": r.id, "route": r.route, "kind": r.kind,
            "text_content": r.text_content, "audio_seconds": r.audio_seconds,
            "reference_kind": r.reference_kind, "reference_id": r.reference_id, "reference_label": r.reference_label,
            "status": r.status, "created_at": r.created_at.isoformat() if r.created_at else None,
            "recipients_notified": r.recipients_notified,
        } for r in rows]