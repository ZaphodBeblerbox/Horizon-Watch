"""
exposure_index.py — the real "exposure index" score for a trackable entity
(a WatchZone or StrategicZone) on the new Dossiers page, per Build
Specification v2.0 §8.4/§6.

score = clamp(0..100,
    40 * severityWeight     # normalised severity-rank^2 sum of ring signals
  + 25 * dependencyWeight   # matched impacts / total dependencies
  + 20 * persistence        # share of the 14-day window with >=1 ring signal
  + 15 * corroboration)     # mean confidence of ring signals with a real
                            # confidence-like value
delta = score - score(14 days ago)

Ground rules this module follows:
- "Ring signals" are read from the real, already-populated OntologyLink
  table (entity_type='watch_zone'|'strategic_zone', entity_id=str(zone.id)),
  not recomputed from scratch — this is the same real linkage
  write_alert()/link_article() already produce, so Overview, Risk drivers,
  History, and this score all stay consistent with one real set.
- dependencyWeight has no real backing data for either entity type today
  (no Dependency/AssetLink model exists, and the Asset table is empty) —
  every score here uses the REDUCED formula (severityWeight/persistence/
  corroboration only, renormalized to sum 100), never a placeholder value
  for the missing term. This is documented here and must be stated in any
  report on this feature, not silently glossed over.
- corroboration is the mean of REAL confidence-like values only
  (OntologyLink.confidence when a link actually has one — true only for
  Haiku entity-mention hits; NewsArticle.relevance_score/100 for
  article-sourced links; FusionEvent.confidence for fusion-sourced links).
  A ring signal with no real confidence-like field is excluded from the
  average rather than defaulted to a fabricated number.
"""
from __future__ import annotations
import datetime
import json
import math
import re

_SEV_RANK = {"critical": 4, "high": 3, "medium": 2, "moderate": 2, "info": 1, "low": 1}
_TIER_SEV = {1: "critical", 2: "high", 3: "medium", 4: "info"}
_DOMAIN_BY_SOURCE = {"ais": "maritime", "adsb": "air", "article": "news", "fusion": "zones"}

# ── Real deterministic severity override for news-article ring signals ──────
# _TIER_SEV above is a flat remap of a Claude Haiku tier judgment
# (article_intelligence.py) — real, but model-driven, not the standing rule
# ("severity must be deterministic and auditable, never model-only"). This
# checks a real, disclosed subset of that rule against real data before
# falling back to _TIER_SEV: real keyword matches for loss-of-life/facility-
# damage, and real geographic proximity (via the same _ANOMALY_CHOKEPOINTS
# centroids main.py's anomaly detector already uses) to a named maritime
# chokepoint combined with real closure/interdiction keywords. The rule's
# third criterion ("confirmed outage of a dependency with no tested
# alternative") is NOT evaluated here — same gap as WEIGHTS_REDUCED above, no
# real Dependency/AssetLink model exists in this deployment to check it
# against, and this deliberately does not fabricate one. When none of the
# real checks fire, this returns None and the caller keeps using _TIER_SEV —
# a deterministic override, not a full replacement of every case.
_CHOKEPOINT_CENTROIDS = {
    "Strait of Hormuz":    (26.5, 56.4),
    "Bab el-Mandeb":       (12.6, 43.4),
    "Suez Canal":          (30.5, 32.4),
    "Strait of Malacca":   (3.0, 103.5),
    "Taiwan Strait":       (23.5, 120.2),
    "Strait of Gibraltar": (35.9, -5.6),
}
_CHOKEPOINT_PROXIMITY_KM = 100.0
# Whole-word matches only (compiled with \b boundaries below) — plain
# substring matching on short roots like "kill"/"dead"/"mined" would false-
# positive on "skill(ed)"/"deadline"/"undermined".
_CASUALTY_DAMAGE_KEYWORDS = [
    "killed", "kills", "kill", "dead", "deaths", "fatalities",
    "fatality", "casualties", "died", "destroyed", "leveled", "razed",
]
_CORRIDOR_CLOSURE_KEYWORDS = [
    "closed", "closure", "blockade", "blockaded", "interdiction",
    "interdicted", "halted", "suspended", "impassable", "mined",
]
_DEGRADATION_OR_ADVISORY_KEYWORDS = [
    "disrupted", "delayed", "rerouted", "damaged", "outage", "advisory",
]


def _any_whole_word(text: str, words: list[str]) -> bool:
    return any(re.search(rf"\b{re.escape(w)}\b", text) for w in words)


def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _near_named_chokepoint(lat, lon) -> bool:
    if lat is None or lon is None:
        return False
    return any(
        _haversine_km(lat, lon, c_lat, c_lon) <= _CHOKEPOINT_PROXIMITY_KM
        for c_lat, c_lon in _CHOKEPOINT_CENTROIDS.values()
    )


# Written-out numbers that routinely carry a casualty count in a headline.
# Digits are handled by the regex below; these are the words that are not
# digits but are still counts.
_WORD_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
    "twelve": 12, "dozen": 12, "dozens": 24, "scores": 40, "hundreds": 100,
    "thousands": 1000,
}
# A count only counts when it is ATTACHED to a casualty word. "12 killed"
# is a magnitude; "12 drones" in a headline that also says "killed" is not.
_COUNT_NEAR_CASUALTY = re.compile(
    r"(?:(\d{1,6})|(" + "|".join(_WORD_NUMBERS) + r"))\s+"
    r"(?:\w+\s+){0,2}?"
    r"(?:killed|kills|dead|deaths|died|fatalities|fatality|casualties)"
    r"|(?:killed|kills|dead|deaths|died|fatalities|fatality|casualties)"
    r"(?:\s+\w+){0,2}?\s+(?:(\d{1,6})|(" + "|".join(_WORD_NUMBERS) + r"))",
    re.IGNORECASE,
)

# MASS-CASUALTY THRESHOLD. Ten is where a single incident stops being one
# and starts being an event with its own response. It is a judgement, and
# it is written here once so it can be argued with, rather than implied by
# a keyword list.
_MASS_CASUALTY_N = 10


def _casualty_count(t: str) -> int | None:
    """The casualty number a headline actually states, or None if it states
    none. None means 'unknown scale', never 'zero'."""
    best = None
    for m in _COUNT_NEAR_CASUALTY.finditer(t):
        for g in m.groups():
            if not g:
                continue
            n = int(g) if g.isdigit() else _WORD_NUMBERS.get(g.lower())
            if n is not None:
                best = n if best is None else max(best, n)
    return best


def classify_severity_deterministic(text: str, lat=None, lon=None) -> str | None:
    """Real rule-based severity check; returns None (defer to _TIER_SEV) when
    nothing real fires rather than guessing.

    WHY THIS GRADES INSTEAD OF FLAGGING. This used to return "critical" for
    any headline containing a casualty or damage word. Over a feed that is
    almost entirely conflict reporting, that word is in nearly every
    headline: measured on the live surface pool, 50 items out of 50 came
    back critical. A severity scale that puts 100% of its corpus in the top
    tier carries no information — the colour stops being a reason to look
    at one row rather than another, which is the only job it has.

    So presence of a casualty word establishes that something violent
    happened; the SCALE it happened at decides the tier. A headline that
    states a number is graded on that number. A headline that does not is
    "significant" — it happened, the scale is unknown, and claiming the top
    tier on an unknown is the same mistake in a smaller font.

    It also used to return "high", which is not one of the four tiers the
    rest of the system uses (low / elevated / significant / critical).
    TIER_RANK did not know the word, so every item that took that branch
    was scored as rank 0 — the BOTTOM — while reading as though it were
    near the top.
    """
    t = (text or "").lower()
    if not t:
        return None

    # A closed strait is critical regardless of body count: the consequence
    # is the closure, and it is already the thing being watched.
    if _near_named_chokepoint(lat, lon) and _any_whole_word(t, _CORRIDOR_CLOSURE_KEYWORDS):
        return "critical"

    if _any_whole_word(t, _CASUALTY_DAMAGE_KEYWORDS):
        n = _casualty_count(t)
        if n is None:
            return "significant"
        return "critical" if n >= _MASS_CASUALTY_N else "significant"

    if _any_whole_word(t, _DEGRADATION_OR_ADVISORY_KEYWORDS):
        return "elevated"

    return None

RING_MARGIN_KM = 15.0
PERSISTENCE_WINDOW_DAYS = 14
LINKED_SIGNALS_RADIUS_KM = 1400.0

# Reduced-formula renormalization: real weights only (severity 40 + persistence 20
# + corroboration 15 = 75), scaled back up to sum 100 since dependencyWeight (25)
# has no real data for these entity types.
_REDUCED_SCALE = 100.0 / 75.0
WEIGHTS_REDUCED = {"severity": 40 * _REDUCED_SCALE, "dependency": 0.0,
                   "persistence": 20 * _REDUCED_SCALE, "corroboration": 15 * _REDUCED_SCALE}


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(a)))


def get_entity(entity_type: str, code: str, db):
    """code is the real business key (WatchZone.system_id or StrategicZone.zone_id)."""
    from database import WatchZone, StrategicZone
    if entity_type == "watch_zone":
        row = db.query(WatchZone).filter(WatchZone.system_id == code).first()
        if not row:
            return None
        return {
            "entity_type": "watch_zone", "id": row.id, "code": row.system_id,
            "name": row.name, "polygon_geojson": row.polygon_geojson,
            "bbox": [row.bbox_min_lon, row.bbox_min_lat, row.bbox_max_lon, row.bbox_max_lat],
            "severity_baseline": "high" if row.priority == "high" else "medium",
            "description": row.description,
        }
    if entity_type == "strategic_zone":
        row = db.query(StrategicZone).filter(StrategicZone.zone_id == code).first()
        if not row:
            return None
        return {
            "entity_type": "strategic_zone", "id": row.id, "code": row.zone_id,
            "name": row.name, "polygon_geojson": row.polygon_geojson,
            "bbox": [row.bbox_min_lon, row.bbox_min_lat, row.bbox_max_lon, row.bbox_max_lat],
            "severity_baseline": row.severity_baseline,
            "description": row.description,
        }
    return None


def list_entities(db):
    from database import WatchZone, StrategicZone
    out = []
    for row in db.query(WatchZone).filter(WatchZone.enabled == True).all():  # noqa: E712
        out.append({"entity_type": "watch_zone", "id": row.id, "code": row.system_id, "name": row.name,
                     "type_label": "Watch Zone", "severity_baseline": "high" if row.priority == "high" else "medium"})
    for row in db.query(StrategicZone).filter(StrategicZone.enabled == True).all():  # noqa: E712
        out.append({"entity_type": "strategic_zone", "id": row.id, "code": row.zone_id, "name": row.name,
                     "type_label": "Strategic Zone", "severity_baseline": row.severity_baseline})
    return out


_SOURCE_BUCKET = {"ais": "alert", "adsb": "alert", "article": "article", "fusion": "fusion"}


def _bulk_hydrate(links, db):
    """Real severity/confidence/lat/lon/title/timestamp for many
    OntologyLinks' real source rows, in exactly 3 bulk `IN` queries (one per
    real source table) rather than one query per link — a data-rich zone
    can have thousands of real links, and this page needs to stay
    responsive. Returns {(bucket, source_id): real-fields-dict}, where
    `bucket` groups ais/adsb together (both live in Alert, keyed by the
    already-globally-unique alert_id) — the caller re-attaches the link's
    own authoritative source_type for `domain` classification, this never
    re-guesses ais-vs-adsb from the Alert row itself."""
    from database import Alert, NewsArticle, FusionEvent
    alert_ids = {l.source_id for l in links if _SOURCE_BUCKET.get(l.source_type) == "alert"}
    article_ids = {l.source_id for l in links if l.source_type == "article"}
    fusion_ids = {l.source_id for l in links if l.source_type == "fusion"}

    out = {}
    if alert_ids:
        for a in db.query(Alert).filter(Alert.alert_id.in_(alert_ids)).all():
            out[("alert", a.alert_id)] = {
                "severity": (a.severity or "medium").lower(), "confidence": None,
                "lat": a.lat, "lon": a.lon, "title": a.title, "created_at": a.created_at,
            }
    if article_ids:
        for n in db.query(NewsArticle).filter(NewsArticle.url.in_(article_ids)).all():
            severity = classify_severity_deterministic(n.title, n.lat, n.lon) or _TIER_SEV.get(n.tier, "medium")
            out[("article", n.url)] = {
                "severity": severity,
                "confidence": (n.relevance_score / 100.0) if n.relevance_score is not None else None,
                "lat": n.lat, "lon": n.lon, "title": n.title, "created_at": n.ingested_at,
            }
    if fusion_ids:
        for f in db.query(FusionEvent).filter(FusionEvent.fusion_id.in_(fusion_ids)).all():
            out[("fusion", f.fusion_id)] = {
                "severity": (f.severity or "medium").lower(), "confidence": f.confidence,
                "lat": f.lat, "lon": f.lon, "title": f.title, "created_at": f.created_at,
            }
    return out


def ring_signals(entity, db, since=None, until=None, _cache=None):
    """Real hydrated ring signals for this entity, from the real, already-
    populated OntologyLink table — the one set Overview/Risk drivers/
    History/the score all share.

    Hydration is batched into 3 bulk queries total (see `_bulk_hydrate`)
    rather than one query per link. `_cache` (keyed by (bucket, source_id))
    additionally lets repeated overlapping windows against the same entity
    (e.g. this endpoint's now/14-days-ago/history windows) skip
    re-hydrating sources they've already seen.
    """
    from database import OntologyLink
    q = db.query(OntologyLink).filter(
        OntologyLink.entity_type == entity["entity_type"], OntologyLink.entity_id == str(entity["id"]),
    )
    if since is not None:
        q = q.filter(OntologyLink.created_at >= since)
    if until is not None:
        q = q.filter(OntologyLink.created_at < until)
    links = q.order_by(OntologyLink.created_at.desc()).all()

    def bucket_key(l):
        return (_SOURCE_BUCKET.get(l.source_type, l.source_type), l.source_id)

    to_hydrate = [l for l in links if _cache is None or bucket_key(l) not in _cache]
    fresh = _bulk_hydrate(to_hydrate, db) if to_hydrate else {}
    if _cache is not None:
        for l in to_hydrate:
            _cache[bucket_key(l)] = fresh.get(bucket_key(l))

    out = []
    for link in links:
        key = bucket_key(link)
        fields = _cache.get(key) if _cache is not None else fresh.get(key)
        if not fields:
            continue
        confidence = link.confidence if link.confidence is not None else fields["confidence"]
        out.append({
            **fields, "confidence": confidence, "source_id": link.source_id,
            "domain": _DOMAIN_BY_SOURCE.get(link.source_type, "zones"),
            "link_type": link.link_type, "distance_km": link.distance_km,
        })
    return out


def score_from_signals(signals):
    if not signals:
        return {"score": 0.0, "components": {"severity": 0.0, "dependency": None, "persistence": 0.0, "corroboration": 0.0},
                "signal_count": 0, "critical_count": 0}

    # severityWeight — normalised sum of rank^2 (worst case: every signal
    # critical, rank^2=16) so a handful of critical hits saturates quickly
    # without needing an arbitrary signal-count cap.
    ranks = [_SEV_RANK.get(s["severity"], 2) for s in signals]
    sev_sum = sum(r * r for r in ranks)
    sev_max = 16 * len(signals)
    severity = sev_sum / sev_max if sev_max else 0.0

    # persistence — share of the 14 real days with >=1 real ring signal.
    days_with_signal = {s["created_at"].date() for s in signals if s["created_at"]}
    persistence = len(days_with_signal) / PERSISTENCE_WINDOW_DAYS

    # corroboration — mean of only the REAL confidence-like values present;
    # honestly 0 (not fabricated) if none of the ring signals carry one.
    confidences = [s["confidence"] for s in signals if s["confidence"] is not None]
    corroboration = (sum(confidences) / len(confidences)) if confidences else 0.0

    w = WEIGHTS_REDUCED
    score = w["severity"] * severity + w["persistence"] * persistence + w["corroboration"] * corroboration
    score = max(0.0, min(100.0, score))
    critical_count = sum(1 for s in signals if s["severity"] == "critical")

    return {
        "score": round(score, 1),
        "components": {"severity": round(severity, 3), "dependency": None,
                        "persistence": round(persistence, 3), "corroboration": round(corroboration, 3)},
        "signal_count": len(signals), "critical_count": critical_count,
    }


def compute_score(entity, db, as_of=None):
    """Single-timepoint score — one real hydration pass over its own 14-day
    window. For repeated timepoints against the same entity (score_history's
    31 points), use `score_history`/`compute_score_series` instead, which
    share one hydration pass rather than repeating it per point."""
    as_of = as_of or datetime.datetime.utcnow()
    since = as_of - datetime.timedelta(days=PERSISTENCE_WINDOW_DAYS)
    signals = ring_signals(entity, db, since=since, until=as_of)
    return score_from_signals(signals)


def score_history(entity, db, days=30):
    """Real daily score series over the trailing N days — each point is the
    real formula computed with its own 14-day trailing window ending that
    day, not an interpolation between two endpoints. Does ONE real hydration
    pass over the full (days + 14)-day span and re-filters it in memory per
    day, rather than re-querying/re-hydrating per day — a data-rich zone can
    have thousands of real links, and this page needs to stay responsive."""
    now = datetime.datetime.utcnow()
    span_start = now - datetime.timedelta(days=days + PERSISTENCE_WINDOW_DAYS)
    cache = {}
    all_signals = ring_signals(entity, db, since=span_start, until=now, _cache=cache)

    points = []
    for i in range(days, -1, -1):
        as_of = now - datetime.timedelta(days=i)
        since = as_of - datetime.timedelta(days=PERSISTENCE_WINDOW_DAYS)
        window = [s for s in all_signals if s["created_at"] and since <= s["created_at"] < as_of]
        r = score_from_signals(window)
        points.append({"date": as_of.date().isoformat(), "score": r["score"]})
    return points


def band_for_score(score: float) -> str:
    if score >= 75: return "critical"
    if score >= 50: return "high"
    if score >= 25: return "moderate"
    return "low"


def linked_entities(entity, db, limit=10):
    """Real 2-hop co-occurrence: other entities that share a real
    OntologyLink.source_id with this one (no entity-to-entity relationship
    model exists today — OntologyClaim is the intended one and is empty —
    so this is an honest derivation from real shared evidence, not a
    modeled dependency)."""
    from database import OntologyLink
    my_links = db.query(OntologyLink).filter(
        OntologyLink.entity_type == entity["entity_type"], OntologyLink.entity_id == str(entity["id"]),
    ).all()
    source_ids = {l.source_id for l in my_links}
    if not source_ids:
        return []
    others = db.query(OntologyLink).filter(
        OntologyLink.source_id.in_(source_ids),
        ~((OntologyLink.entity_type == entity["entity_type"]) & (OntologyLink.entity_id == str(entity["id"]))),
    ).all()
    tally = {}
    for l in others:
        key = (l.entity_type, l.entity_id, l.entity_name)
        tally[key] = tally.get(key, 0) + 1
    out = [{"entity_type": k[0], "entity_id": k[1], "name": k[2], "shared_count": v} for k, v in tally.items()]
    out.sort(key=lambda x: -x["shared_count"])
    return out[:limit]


def nearby_signals(entity, db, radius_km=LINKED_SIGNALS_RADIUS_KM, limit=200):
    """Every real signal within radius_km of the entity's real centroid —
    a much wider, independent search from "ring signals" (which come from
    OntologyLink), per the right pane's literal 1,400km requirement."""
    from database import Alert, NewsArticle, FusionEvent
    poly = json.loads(entity["polygon_geojson"]) if entity.get("polygon_geojson") else None
    if poly and poly.get("type") == "Polygon":
        coords = poly["coordinates"][0]
        clat = sum(c[1] for c in coords) / len(coords)
        clon = sum(c[0] for c in coords) / len(coords)
    else:
        b = entity["bbox"]
        clon, clat = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2

    out = []
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=7)
    for a in db.query(Alert).filter(Alert.created_at >= cutoff, Alert.lat.isnot(None), Alert.lon.isnot(None)).limit(3000).all():
        d = _haversine_km(clat, clon, a.lat, a.lon)
        if d <= radius_km:
            out.append({"id": a.alert_id, "title": a.title, "severity": (a.severity or "medium").lower(),
                        "created_at": a.created_at, "distance_km": round(d, 1), "domain": _DOMAIN_BY_SOURCE.get((a.source or "").lower(), "zones")})
    for n in db.query(NewsArticle).filter(NewsArticle.ingested_at >= cutoff, NewsArticle.lat.isnot(None), NewsArticle.lon.isnot(None)).limit(3000).all():
        d = _haversine_km(clat, clon, n.lat, n.lon)
        if d <= radius_km:
            out.append({"id": n.url, "title": n.title, "severity": _TIER_SEV.get(n.tier, "medium"),
                        "created_at": n.ingested_at, "distance_km": round(d, 1), "domain": "news"})
    for f in db.query(FusionEvent).filter(FusionEvent.created_at >= cutoff, FusionEvent.lat.isnot(None), FusionEvent.lon.isnot(None)).limit(1000).all():
        d = _haversine_km(clat, clon, f.lat, f.lon)
        if d <= radius_km:
            out.append({"id": f.fusion_id, "title": f.title, "severity": (f.severity or "medium").lower(),
                        "created_at": f.created_at, "distance_km": round(d, 1), "domain": "zones"})
    out.sort(key=lambda s: s["created_at"], reverse=True)
    return out[:limit], (clat, clon)


def signal_mix_by_domain(signals):
    tally = {}
    for s in signals:
        tally[s["domain"]] = tally.get(s["domain"], 0) + 1
    return tally


def analyst_judgement_fallback(name, score, delta, signal_count, critical_count):
    direction = "up" if delta > 0 else "down" if delta < 0 else "flat"
    dstr = f"{abs(round(delta, 1))}"
    tail = ("Treat the corridor as constrained for planning purposes and hold the contingency "
            "routing in place.") if critical_count else "No change to continuity posture is warranted on current reporting."
    return (f"{name} sits at {round(score, 1)} on the exposure index, {direction} {dstr} points over the "
            f"fortnight. {signal_count} signals fall inside the exposure ring, {critical_count} of them critical. {tail}")
