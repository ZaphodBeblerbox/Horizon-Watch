"""
observation_ontology.py — an observation, and why we believe it.

ontology_claims has existed with exactly the right columns and zero rows:
source_title, source_publisher, source_url, source_date, source_excerpt,
confidence, status. It was designed to let the system say "we believe X
because of Y" and nothing has ever written to it.

WHAT GOES IN, AND WHY IT MATTERS THAT IT IS NOT EVERYTHING. An imagery
detection, a GDELT event and a corroborated cluster are all CLAIMS ABOUT
THE WORLD that something asserted on some evidence. A vessel position from
AIS is not — it is a measurement, it already lives in its own table, and
copying it here would turn the claim store into a second, worse copy of the
telemetry.

THE EVIDENCE IS THE POINT. A claim without its source is an assertion, and
an assertion the reader cannot check is worse than silence, because it
looks like knowledge. Every row written here carries what produced it: the
article for a GDELT event, the scan and model for a detection, the list of
agreeing sources for a cluster.

CONFIDENCE IS INHERITED, NEVER INVENTED. A detection's confidence is the
model's own; a cluster's is its independence count. Nothing here computes a
new number, because a number with no derivation is the most persuasive kind
of lie a system can tell.
"""
from __future__ import annotations

import datetime
import hashlib
import json

# What kind of thing each observation becomes in the entity graph. Kept
# narrow on purpose: an ontology that absorbs every row of telemetry stops
# being a model of the world and becomes a slow copy of the database.
ENTITY_TYPE = {
    "imagery": "Observed Object",
    "sar_vessel": "Observed Object",
    "sar_change": "Structural Change",
    "gdelt": "Reported Event",
    "firms": "Thermal Anomaly",
    "corroborated": "Corroborated Finding",
}


def claim_id_for(kind: str, key: str) -> str:
    """Stable across re-ingest, so the same observation is one claim.

    Derived from what identifies the observation rather than from when it
    was written, or a nightly re-read of the same feed would accumulate a
    fresh row per run and the store would measure uptime rather than events.
    """
    return f"{kind}-" + hashlib.md5(f"{kind}|{key}".encode()).hexdigest()[:20]


def _iso(v):
    if v is None:
        return None
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()
    return str(v)


def claim_from_gdelt(point: dict) -> dict | None:
    """A drawable GDELT event as a claim, with its article as the evidence."""
    if not point.get("source_url") or not point.get("title"):
        return None
    return {
        "claim_id": claim_id_for("gdelt", str(point.get("id"))),
        "entity_a_label": point["title"][:300],
        "entity_a_type": ENTITY_TYPE["gdelt"],
        "relationship_type": "reported_at",
        "entity_b_label": point.get("location_name") or "unknown location",
        "entity_b_type": "Place",
        "as_of": _iso(point.get("date")),
        # GDELT is a machine reading a wire story. That ceiling is stated
        # here rather than left for a reader to infer from the source name.
        "confidence": 0.4,
        "source_title": point["title"][:300],
        "source_publisher": _publisher(point["source_url"]),
        "source_url": point["source_url"],
        "source_date": _iso(point.get("date")),
        "source_excerpt": point.get("context"),
        "status": "unreviewed",
        "origin_class": "machine",
    }


def claim_from_detection(det: dict, scan: dict) -> dict | None:
    """An imagery detection as a claim, with the scan as the evidence."""
    if det.get("centroid_lat") is None or det.get("centroid_lon") is None:
        return None
    attrs = det.get("attributes")
    if isinstance(attrs, str):
        try:
            attrs = json.loads(attrs)
        except Exception:
            attrs = {}
    attrs = attrs or {}
    where = f"{det['centroid_lat']:.5f}, {det['centroid_lon']:.5f}"
    label = (det.get("object_type") or "object").replace("_", " ")
    return {
        "claim_id": claim_id_for("detection", str(det.get("detection_id"))),
        "entity_a_label": f"{label} at {where}",
        "entity_a_type": ENTITY_TYPE.get(det.get("provenance", "imagery"),
                                         "Observed Object"),
        "relationship_type": "detected_in",
        "entity_b_label": scan.get("zone_name") or scan.get("scan_id") or "scan",
        "entity_b_type": "Imagery Scan",
        "as_of": _iso(scan.get("image_timestamp_utc") or scan.get("created_at")),
        # The MODEL's own confidence, not a new number.
        "confidence": det.get("confidence"),
        "source_title": (f"{scan.get('instrument', 'OPTICAL')} scan "
                         f"{str(scan.get('scan_id'))[:8]}"),
        "source_publisher": attrs.get("model") or "detector",
        "source_url": None,
        "source_date": _iso(scan.get("image_timestamp_utc")),
        # What would let a person check it: where, how big, how precisely
        # the sensor could place it.
        "source_excerpt": json.dumps({
            "centroid": [det["centroid_lat"], det["centroid_lon"]],
            "area_m2": det.get("area_m2"),
            "pixel_resolution_m": attrs.get("pixel_resolution_m"),
            "geolocation_uncertainty_m": attrs.get("geolocation_uncertainty_m"),
            "change_type": attrs.get("change_type"),
        }),
        "status": "unreviewed",
        "origin_class": "machine",
    }


def claim_from_cluster(cluster: dict) -> dict | None:
    """A corroborated cluster as a claim. The evidence is the agreement.

    This is the only claim here whose confidence rises above its members',
    and the reason is stated in the excerpt: several INDEPENDENT ways of
    looking put something at one place and time. Without the independence
    count the number would be unjustifiable.
    """
    if not cluster.get("corroborated"):
        return None
    key = f"{cluster['lat']:.4f}|{cluster['lon']:.4f}|{cluster['first_seen']}"
    return {
        "claim_id": claim_id_for("corroborated", key),
        "entity_a_label": cluster["headline"][:300],
        "entity_a_type": ENTITY_TYPE["corroborated"],
        "relationship_type": "observed_at",
        "entity_b_label": f"{cluster['lat']:.4f}, {cluster['lon']:.4f}",
        "entity_b_type": "Place",
        "as_of": cluster.get("last_seen"),
        "confidence": cluster.get("confidence"),
        "source_title": cluster["headline"][:300],
        "source_publisher": ", ".join(cluster.get("sources", [])),
        "source_url": (cluster.get("urls") or [None])[0],
        "source_date": cluster.get("last_seen"),
        "source_excerpt": json.dumps({
            "independent_modalities": cluster.get("independent_modalities"),
            "modalities": cluster.get("modalities"),
            "members": cluster.get("detail", [])[:8],
        }),
        "status": "unreviewed",
        "origin_class": "derived",
    }


def _publisher(url: str) -> str:
    try:
        host = url.split("//", 1)[-1].split("/", 1)[0]
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def write_claims(db, claims: list[dict]) -> dict:
    """Persist claims, skipping ones already known.

    Returns counts rather than raising on a duplicate: re-ingesting a feed
    is normal and must be cheap, not an error.
    """
    from database import OntologyClaim

    written = skipped = 0
    for c in claims:
        if c is None:
            continue
        exists = (db.query(OntologyClaim)
                    .filter(OntologyClaim.claim_id == c["claim_id"]).first())
        if exists:
            skipped += 1
            continue
        db.add(OntologyClaim(**c))
        written += 1
    return {"written": written, "skipped": skipped}
