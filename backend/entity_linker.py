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


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _link_id() -> str:
    return "LNK-" + uuid.uuid4().hex[:8].upper()


# Proximity thresholds in km
_CABLE_KM    = 50.0
_PORT_KM     = 30.0
_AIRPORT_KM  = 20.0
_ZONE_KM     = 0.0   # point-in-polygon not implemented; use centroid proxy ≤ 100km
_ZONE_BBOX   = True  # use bounding box check instead


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
                cables = db.query(
                    CableSegment.id, CableSegment.cable_name,
                    CableSegment.midpoint_lat, CableSegment.midpoint_lon,
                    CableSegment.system_id,
                ).all()
                self._cables = [
                    {"id": str(r.system_id or r.id), "name": r.cable_name or "",
                     "lat": r.midpoint_lat or 0.0, "lon": r.midpoint_lon or 0.0}
                    for r in cables if r.midpoint_lat is not None
                ]
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
                airports = db.query(
                    Airport.id, Airport.name, Airport.iata_code,
                    Airport.latitude, Airport.longitude,
                ).all()
                self._airports = [
                    {"id": str(r.id), "name": r.name or r.iata_code or "",
                     "lat": r.latitude or 0.0, "lon": r.longitude or 0.0}
                    for r in airports if r.latitude is not None
                ]
            except Exception as _e:
                print(f"[entity-linker] airports load error: {_e}")

            try:
                wz = db.query(
                    WatchZone.id, WatchZone.name,
                    WatchZone.center_lat, WatchZone.center_lon, WatchZone.radius_km,
                ).all()
                self._watch_zones = [
                    {"id": str(r.id), "name": r.name or "",
                     "lat": r.center_lat or 0.0, "lon": r.center_lon or 0.0,
                     "radius_km": r.radius_km or 50.0}
                    for r in wz if r.center_lat is not None
                ]
            except Exception as _e:
                print(f"[entity-linker] watch_zones load error: {_e}")

            try:
                # Try with active filter first; fall back to all zones if column missing
                try:
                    sz = db.query(
                        StrategicZone.id, StrategicZone.name,
                        StrategicZone.center_lat, StrategicZone.center_lon,
                    ).filter(StrategicZone.active == True).all()
                except Exception:
                    sz = db.query(
                        StrategicZone.id, StrategicZone.name,
                        StrategicZone.center_lat, StrategicZone.center_lon,
                    ).all()
                self._strategic_zones = [
                    {"id": str(r.id), "name": r.name or "",
                     "lat": r.center_lat or 0.0, "lon": r.center_lon or 0.0}
                    for r in sz if r.center_lat is not None
                ]
            except Exception as _e:
                print(f"[entity-linker] strategic_zones load error: {_e}")

        finally:
            # Always mark loaded so link methods don't no-op
            with self._lock:
                self._loaded = True
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

    def link_article(self, url: str,
                     lat: Optional[float], lon: Optional[float],
                     title: str = '', entities: list = None):
        """Write OntologyLink rows for a news article."""
        if not self._loaded:
            return
        links = self._proximity_links("article", url, lat, lon)
        links += self._mention_links("article", url, title)
        if entities:
            links += self._entity_mention_links("article", url, entities)
        self._persist_links(links)

    def link_fusion_event(self, fusion_id: str,
                          lat: Optional[float], lon: Optional[float],
                          title: str = ''):
        """Write OntologyLink rows for a fusion event."""
        if not self._loaded:
            return
        links = self._proximity_links("fusion", fusion_id, lat, lon)
        links += self._mention_links("fusion", fusion_id, title)
        self._persist_links(links)

    # ── Internal helpers ───────────────────────────────────────────────────

    def _proximity_links(self, source_type: str, source_id: str,
                         lat: Optional[float], lon: Optional[float]) -> list[dict]:
        if lat is None or lon is None:
            return []
        results = []

        for cable in self._cables:
            d = _haversine_km(lat, lon, cable["lat"], cable["lon"])
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
            d = _haversine_km(lat, lon, zone["lat"], zone["lon"])
            if d <= zone["radius_km"]:
                results.append(self._make_link(
                    source_type, source_id, "watch_zone", zone["id"], zone["name"],
                    "proximity", d,
                ))

        for zone in self._strategic_zones:
            d = _haversine_km(lat, lon, zone["lat"], zone["lon"])
            if d <= 150.0:
                results.append(self._make_link(
                    source_type, source_id, "strategic_zone", zone["id"], zone["name"],
                    "proximity", d,
                ))

        return results

    def _mention_links(self, source_type: str, source_id: str,
                       title: str) -> list[dict]:
        if not title:
            return []
        results = []
        tl = title.lower()

        for port in self._ports:
            if port["name"] and len(port["name"]) >= 4:
                if re.search(r'\b' + re.escape(port["name"].lower()) + r'\b', tl):
                    results.append(self._make_link(
                        source_type, source_id, "port", port["id"], port["name"],
                        "mention",
                    ))

        for ap in self._airports:
            if ap["name"] and len(ap["name"]) >= 4:
                if re.search(r'\b' + re.escape(ap["name"].lower()) + r'\b', tl):
                    results.append(self._make_link(
                        source_type, source_id, "airport", ap["id"], ap["name"],
                        "mention",
                    ))

        return results

    def _entity_mention_links(self, source_type: str, source_id: str,
                               entities: list) -> list[dict]:
        """Map Haiku-extracted entities to ontology objects by name match."""
        results = []
        for ent in (entities or []):
            ent_name = (ent.get("name") or "").lower()
            ent_type = (ent.get("type") or "").lower()
            if not ent_name or len(ent_name) < 3:
                continue

            if ent_type in ("port", "harbor", "terminal"):
                for port in self._ports:
                    if port["name"] and ent_name in port["name"].lower():
                        results.append(self._make_link(
                            source_type, source_id, "port", port["id"], port["name"],
                            "mention", confidence=0.8,
                        ))
                        break

            elif ent_type in ("airport", "airfield", "airbase"):
                for ap in self._airports:
                    if ap["name"] and ent_name in ap["name"].lower():
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
                db.commit()
        except Exception as ex:
            print(f"[entity-linker] persist error: {ex}")


# Singleton
entity_linker = EntityLinker()
