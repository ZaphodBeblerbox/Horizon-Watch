"""
entity_linker.py — Links events (alerts, signals, articles) to ontology entities.

All methods are synchronous — called from executor threads, not coroutines.
Uses DB-backed proximity and mention matching against:
  - cable_segments (cables)
  - ports (PortBoundary)
  - airports (Airport)
  - watch_zones (WatchZone)
  - strategic_zones (StrategicZone)
"""

from __future__ import annotations
import re
import uuid
import math
import json
import threading
import datetime
from typing import Optional

from database import (
    get_db, OntologyLink,
    CableSegment, PortBoundary, Airport, WatchZone, StrategicZone,
)

try:
    from shapely.geometry import Point as _ShpPoint, shape as _shp_shape
    from shapely.ops import nearest_points as _shp_nearest_points
    _HAS_SHAPELY = True
except ImportError:
    _HAS_SHAPELY = False


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _link_id() -> str:
    return "LNK-" + uuid.uuid4().hex[:8].upper()


# Proximity thresholds in km
_CABLE_KM        = 50.0   # real min-distance-to-cable-route, not a midpoint proxy
_PORT_KM         = 30.0
_AIRPORT_KM      = 20.0
_ZONE_MARGIN_KM  = 15.0   # "near but not inside" margin, measured from the real polygon boundary


def _ds_status_lock_and_dict():
    """Lazily fetch main.py's _DS_STATUS / _DS_STATUS_LOCK. Imported lazily
    (function-local, not at module top) because main.py imports entity_linker
    only indirectly through fusion_engine.py/surge_engine.py at call time, not
    eagerly at its own top level — but a top-level import here would still
    risk import-order issues at process start, so this defers to call time
    the same way sentinel_ml.py's `_get_obb_session` does for main.py."""
    try:
        from main import _DS_STATUS, _DS_STATUS_LOCK
    except ImportError:
        from backend.main import _DS_STATUS, _DS_STATUS_LOCK
    return _DS_STATUS, _DS_STATUS_LOCK


def _mark_entity_linker_failure(err: str) -> None:
    """Best-effort health-tracking update. Never raises — a health-tracking
    bug must never break real entity-linking behavior."""
    try:
        _DS_STATUS, _DS_STATUS_LOCK = _ds_status_lock_and_dict()
        with _DS_STATUS_LOCK:
            st = _DS_STATUS["entity_linker"]
            st["failures"] = st.get("failures", 0) + 1
            st["last_error"] = err
    except Exception:
        pass


class EntityLinker:
    """
    Maintains lightweight in-memory caches of static ontology entities
    (cables, ports, airports, zones) and writes OntologyLink rows for
    each event it processes.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # Caches: list of dicts with essential fields only
        self._cables: list[dict]    = []
        self._ports: list[dict]     = []
        self._airports: list[dict]  = []
        self._watch_zones: list[dict]    = []
        self._strategic_zones: list[dict] = []
        self._loaded = False

    # ── Cache loading ──────────────────────────────────────────────────────

    def load_cache(self, db=None):
        """Load entity caches from DB. Each table query is independent so one
        missing/broken table never blocks the others."""
        own_db = db is None
        if own_db:
            ctx = get_db()
            db = ctx.__enter__()
        try:
            try:
                # CableSegment stores its route as raw GeoJSON (LineString/MultiLineString)
                # in `geometry` — there is no midpoint_lat/midpoint_lon column (an earlier
                # version of this cache assumed one that was never added to the schema,
                # so this query threw on every load and cable linking was silently dead).
                # A single midpoint would also be a poor proxy for a cable that can span
                # thousands of km anyway — real min-distance-to-route (below) is used instead.
                cables = db.query(
                    CableSegment.id, CableSegment.cable_name,
                    CableSegment.geometry, CableSegment.system_id,
                ).all()
                self._cables = []
                for r in cables:
                    geom = None
                    if _HAS_SHAPELY and r.geometry:
                        try:
                            geom = _shp_shape(r.geometry)
                        except Exception as _ge:
                            print(f"[entity-linker] cable {r.system_id or r.id} has unparsable geometry: {_ge}")
                    if geom is not None:
                        self._cables.append({"id": str(r.system_id or r.id), "name": r.cable_name or "", "geom": geom})
            except Exception as _e:
                print(f"[entity-linker] cables load error: {_e}")

            try:
                ports = db.query(
                    PortBoundary.id, PortBoundary.port_name,
                    PortBoundary.latitude, PortBoundary.longitude,
                    PortBoundary.system_id,
                ).all()
                self._ports = [
                    {"id": str(r.system_id or r.id), "name": r.port_name or "",
                     "lat": r.latitude or 0.0, "lon": r.longitude or 0.0}
                    for r in ports if r.latitude is not None
                ]
            except Exception as _e:
                print(f"[entity-linker] ports load error: {_e}")

            try:
                # Airport's name column is `airport_name`, not `name` — the previous
                # query referenced a column that doesn't exist on this model at all,
                # so it threw on every load and airport linking was silently dead.
                airports = db.query(
                    Airport.id, Airport.airport_name, Airport.iata_code,
                    Airport.latitude, Airport.longitude,
                ).all()
                self._airports = [
                    {"id": str(r.id), "name": r.airport_name or r.iata_code or "",
                     "lat": r.latitude or 0.0, "lon": r.longitude or 0.0}
                    for r in airports if r.latitude is not None
                ]
            except Exception as _e:
                print(f"[entity-linker] airports load error: {_e}")

            try:
                # WatchZone has no center_lat/center_lon/radius_km columns — it stores a
                # real polygon (`polygon_geojson`) plus a bbox for cheap filtering. The
                # previous query referenced nonexistent centroid columns, so it threw on
                # every load and watch-zone linking was silently dead. Real point-in-polygon
                # containment (via shapely) is used below instead of a centroid-distance proxy.
                wz = db.query(
                    WatchZone.id, WatchZone.name, WatchZone.polygon_geojson,
                    WatchZone.bbox_min_lon, WatchZone.bbox_min_lat,
                    WatchZone.bbox_max_lon, WatchZone.bbox_max_lat,
                ).filter(WatchZone.enabled == True).all()
                self._watch_zones = []
                for r in wz:
                    poly = None
                    if _HAS_SHAPELY:
                        try:
                            poly = _shp_shape(json.loads(r.polygon_geojson))
                        except Exception as _pe:
                            print(f"[entity-linker] watch_zone {r.id} has unparsable polygon: {_pe}")
                    self._watch_zones.append({
                        "id": str(r.id), "name": r.name or "",
                        "bbox": (r.bbox_min_lon, r.bbox_min_lat, r.bbox_max_lon, r.bbox_max_lat),
                        "polygon": poly,
                    })
            except Exception as _e:
                print(f"[entity-linker] watch_zones load error: {_e}")

            try:
                # Same story as WatchZone: no center_lat/center_lon, and the column is
                # `enabled` not `active`. Real polygon containment used below.
                sz = db.query(
                    StrategicZone.id, StrategicZone.name, StrategicZone.polygon_geojson,
                    StrategicZone.bbox_min_lon, StrategicZone.bbox_min_lat,
                    StrategicZone.bbox_max_lon, StrategicZone.bbox_max_lat,
                ).filter(StrategicZone.enabled == True).all()
                self._strategic_zones = []
                for r in sz:
                    poly = None
                    if _HAS_SHAPELY:
                        try:
                            poly = _shp_shape(json.loads(r.polygon_geojson))
                        except Exception as _pe:
                            print(f"[entity-linker] strategic_zone {r.id} has unparsable polygon: {_pe}")
                    self._strategic_zones.append({
                        "id": str(r.id), "name": r.name or "",
                        "bbox": (r.bbox_min_lon, r.bbox_min_lat, r.bbox_max_lon, r.bbox_max_lat),
                        "polygon": poly,
                    })
            except Exception as _e:
                print(f"[entity-linker] strategic_zones load error: {_e}")

        finally:
            # Always mark loaded so link methods don't no-op
            with self._lock:
                self._loaded = True
            try:
                _DS_STATUS, _DS_STATUS_LOCK = _ds_status_lock_and_dict()
                with _DS_STATUS_LOCK:
                    _DS_STATUS["entity_linker"]["loaded"] = True
            except Exception:
                pass
            if own_db:
                ctx.__exit__(None, None, None)

        print(f"[entity-linker] cache loaded: cables={len(self._cables)} "
              f"ports={len(self._ports)} airports={len(self._airports)} "
              f"zones={len(self._watch_zones)}+{len(self._strategic_zones)}")

    # ── Public link methods ────────────────────────────────────────────────

    def link_alert(self, alert_id: str, source_type: str,
                   lat: Optional[float], lon: Optional[float],
                   title: str = '', raw_json: dict = None):
        """Write OntologyLink rows for an alert."""
        if not self._loaded:
            print(f"[entity-linker] link_alert skipped — cache not loaded (alert={alert_id})")
            return
        try:
            links = self._proximity_links(source_type, alert_id, lat, lon)
            links += self._mention_links(source_type, alert_id, title)
            self._persist_links(links)
        except Exception as ex:
            print(f"[entity-linker] link_alert FAILED ({alert_id}): {type(ex).__name__}: {ex}")
            _mark_entity_linker_failure(f"link_alert({alert_id}): {type(ex).__name__}: {ex}")

    def link_article(self, url: str,
                     lat: Optional[float], lon: Optional[float],
                     title: str = '', entities: list = None):
        """Write OntologyLink rows for a news article."""
        if not self._loaded:
            return
        # Real guard (not just relying on the caller's broad wrapper) — a
        # crash here used to propagate up to whatever try/except main.py
        # happens to wrap the call site in, which is fragile and gave no
        # dedicated health signal. Matches link_alert's existing pattern.
        try:
            links = self._proximity_links("article", url, lat, lon)
            links += self._mention_links("article", url, title)
            if entities:
                links += self._entity_mention_links("article", url, entities)
            self._persist_links(links)
        except Exception as ex:
            print(f"[entity-linker] link_article FAILED ({url}): {type(ex).__name__}: {ex}")
            _mark_entity_linker_failure(f"link_article({url}): {type(ex).__name__}: {ex}")

    def link_fusion_event(self, fusion_id: str,
                          lat: Optional[float], lon: Optional[float],
                          title: str = ''):
        """Write OntologyLink rows for a fusion event."""
        if not self._loaded:
            return
        # Real guard (not just relying on the caller's broad wrapper) — see
        # link_article's comment above; same rationale.
        try:
            links = self._proximity_links("fusion", fusion_id, lat, lon)
            links += self._mention_links("fusion", fusion_id, title)
            self._persist_links(links)
        except Exception as ex:
            print(f"[entity-linker] link_fusion_event FAILED ({fusion_id}): {type(ex).__name__}: {ex}")
            _mark_entity_linker_failure(f"link_fusion_event({fusion_id}): {type(ex).__name__}: {ex}")

    # ── Internal helpers ───────────────────────────────────────────────────

    def _proximity_links(self, source_type: str, source_id: str,
                         lat: Optional[float], lon: Optional[float]) -> list[dict]:
        if lat is None or lon is None:
            return []
        results = []
        pt = _ShpPoint(lon, lat) if _HAS_SHAPELY else None

        for cable in self._cables:
            # Real min-distance from the point to the cable's actual route geometry —
            # not a stand-in single "midpoint", which would be badly wrong for a cable
            # spanning thousands of km (a point near one landing station but far from
            # the route's midpoint would be incorrectly excluded).
            if pt is None:
                continue
            try:
                nearest = _shp_nearest_points(pt, cable["geom"])[1]
                d = _haversine_km(lat, lon, nearest.y, nearest.x)
            except Exception:
                continue
            if d <= _CABLE_KM:
                results.append(self._make_link(
                    source_type, source_id, "cable", cable["id"], cable["name"],
                    "proximity", d,
                ))

        for port in self._ports:
            d = _haversine_km(lat, lon, port["lat"], port["lon"])
            if d <= _PORT_KM:
                results.append(self._make_link(
                    source_type, source_id, "port", port["id"], port["name"],
                    "proximity", d,
                ))

        for ap in self._airports:
            d = _haversine_km(lat, lon, ap["lat"], ap["lon"])
            if d <= _AIRPORT_KM:
                results.append(self._make_link(
                    source_type, source_id, "airport", ap["id"], ap["name"],
                    "proximity", d,
                ))

        for zone in self._watch_zones:
            link = self._zone_link(source_type, source_id, "watch_zone", zone, lat, lon, pt)
            if link:
                results.append(link)

        for zone in self._strategic_zones:
            link = self._zone_link(source_type, source_id, "strategic_zone", zone, lat, lon, pt)
            if link:
                results.append(link)

        return results

    @staticmethod
    def _zone_link(source_type: str, source_id: str, entity_type: str,
                   zone: dict, lat: float, lon: float, pt) -> Optional[dict]:
        """Real point-in-polygon containment (via shapely) against the zone's actual
        polygon, replacing the previous centroid-distance proxy. A point strictly
        inside the polygon links as "contains" at distance 0; a point outside but
        within _ZONE_MARGIN_KM of the real boundary links as "proximity" with its
        genuine distance to that boundary. Zones with no parseable polygon (shapely
        unavailable, or malformed polygon_geojson) are skipped rather than faked
        with a bbox or centroid guess."""
        min_lon, min_lat, max_lon, max_lat = zone["bbox"]
        pad_deg = 0.3  # ~33km at the equator — cheap pre-filter before the real geometry check
        if not (min_lon - pad_deg <= lon <= max_lon + pad_deg and min_lat - pad_deg <= lat <= max_lat + pad_deg):
            return None
        poly = zone.get("polygon")
        if poly is None or pt is None:
            return None
        if poly.contains(pt):
            return EntityLinker._make_link(
                source_type, source_id, entity_type, zone["id"], zone["name"],
                "contains", 0.0,
            )
        try:
            nearest = _shp_nearest_points(pt, poly.boundary)[1]
            d = _haversine_km(lat, lon, nearest.y, nearest.x)
        except Exception:
            return None
        if d <= _ZONE_MARGIN_KM:
            return EntityLinker._make_link(
                source_type, source_id, entity_type, zone["id"], zone["name"],
                "proximity", d,
            )
        return None

    def _mention_links(self, source_type: str, source_id: str,
                       title: str) -> list[dict]:
        if not title:
            return []
        results = []
        tl = title.lower()

        # This runs per alert over ~11.7k ports + ~49k airports. Building and
        # running a regex for each one meant ~61k regex compiles per alert —
        # far past re's 512-entry cache, so nothing was reused. py-spy caught
        # this holding the GIL on 2026-09-16, starving the event loop.
        # A word-boundary match requires the substring to be present, so the
        # cheap `in` test short-circuits identically and the regex now runs
        # only for the handful of real candidates. Lowercased names are cached
        # on first use rather than recomputed per alert.
        for port in self._ports:
            nm = port.get("_lname")
            if nm is None:
                nm = port["_lname"] = (port["name"] or "").lower()
            if len(nm) >= 4 and nm in tl:
                if re.search(r'\b' + re.escape(nm) + r'\b', tl):
                    results.append(self._make_link(
                        source_type, source_id, "port", port["id"], port["name"],
                        "mention",
                    ))

        for ap in self._airports:
            nm = ap.get("_lname")
            if nm is None:
                nm = ap["_lname"] = (ap["name"] or "").lower()
            if len(nm) >= 4 and nm in tl:
                if re.search(r'\b' + re.escape(nm) + r'\b', tl):
                    results.append(self._make_link(
                        source_type, source_id, "airport", ap["id"], ap["name"],
                        "mention",
                    ))

        return results

    def _entity_mention_links(self, source_type: str, source_id: str,
                               entities: list) -> list[dict]:
        """Map Haiku-extracted entities to ontology objects by name match.

        Uses a `\\b` word-boundary match of the *whole* extracted entity name
        against the candidate port/airport name — the same technique
        `_mention_links` above already uses for title matching — rather than
        a bare substring check. A bare `ent_name in port_name.lower()` check
        used to accept ANY fragment match: a short, generic Haiku-extracted
        term (e.g. "san", "port", a 3-character minimum was the only guard)
        would match as a fragment inside the name of any port/airport that
        happens to contain those letters in sequence, mid-word ("san" inside
        "Santos", "aden" inside a hypothetical "Aidenberg Port"), creating a
        fabricated OntologyLink between a news article and a real but
        completely unrelated port or airport. This is the same
        short-generic-substring false-positive shape that made the sanctions
        vessel matcher flag unrelated ships (see sanctions_loader.py
        check_vessel) — fixed here the same way _mention_links already
        avoids it: require ent_name to appear as a whole word/phrase, not an
        arbitrary substring.
        """
        results = []
        for ent in (entities or []):
            ent_name = (ent.get("name") or "").lower()
            ent_type = (ent.get("type") or "").lower()
            if not ent_name or len(ent_name) < 3:
                continue
            try:
                pattern = re.compile(r'\b' + re.escape(ent_name) + r'\b')
            except re.error:
                continue

            if ent_type in ("port", "harbor", "terminal"):
                for port in self._ports:
                    if port["name"] and pattern.search(port["name"].lower()):
                        results.append(self._make_link(
                            source_type, source_id, "port", port["id"], port["name"],
                            "mention", confidence=0.8,
                        ))
                        break

            elif ent_type in ("airport", "airfield", "airbase"):
                for ap in self._airports:
                    if ap["name"] and pattern.search(ap["name"].lower()):
                        results.append(self._make_link(
                            source_type, source_id, "airport", ap["id"], ap["name"],
                            "mention", confidence=0.8,
                        ))
                        break

        return results

    @staticmethod
    def _make_link(source_type: str, source_id: str,
                   entity_type: str, entity_id: str, entity_name: str,
                   link_type: str, distance_km: float = None,
                   confidence: float = None):
        # confidence defaults to None ("not yet computed") rather than a fabricated 1.0 — no
        # code here actually estimates a real confidence for proximity or title-mention links,
        # so claiming certainty for them would be exactly the kind of fake-but-plausible-looking
        # field the no-fake-data policy is aimed at. Only _entity_mention_links (Haiku-extracted
        # entity mentions) has ever passed an explicit, deliberately-chosen value (0.8) here.
        if not source_id or not entity_id:
            return None
        return {
            "link_id":     _link_id(),
            "source_type": source_type,
            "source_id":   source_id,
            "entity_type": entity_type,
            "entity_id":   entity_id,
            "entity_name": entity_name,
            "link_type":   link_type,
            "distance_km": distance_km,
            "confidence":  confidence,
            "created_at":  datetime.datetime.utcnow(),
        }

    @staticmethod
    def _persist_links(links: list[dict]):
        links = [l for l in links if l is not None]
        if not links:
            return
        written = 0
        try:
            with get_db() as db:
                for lnk in links:
                    # Skip duplicates (same source + entity)
                    exists = db.query(OntologyLink).filter(
                        OntologyLink.source_type == lnk["source_type"],
                        OntologyLink.source_id   == lnk["source_id"],
                        OntologyLink.entity_type == lnk["entity_type"],
                        OntologyLink.entity_id   == lnk["entity_id"],
                    ).first()
                    if not exists:
                        db.add(OntologyLink(**lnk))
                        written += 1
                db.commit()
            try:
                _DS_STATUS, _DS_STATUS_LOCK = _ds_status_lock_and_dict()
                with _DS_STATUS_LOCK:
                    st = _DS_STATUS["entity_linker"]
                    st["links_written"] = st.get("links_written", 0) + written
                    st["failures"] = 0
                    st["last_success"] = datetime.datetime.utcnow().isoformat()
            except Exception:
                pass
        except Exception as ex:
            print(f"[entity-linker] persist error: {ex}")
            _mark_entity_linker_failure(f"_persist_links: {type(ex).__name__}: {ex}")


# Singleton
entity_linker = EntityLinker()
