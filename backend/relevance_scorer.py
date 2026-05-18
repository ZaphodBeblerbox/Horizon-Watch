"""
relevance_scorer.py — Score signals 0-100 based on strategic zone context.

Key factors:
  +50  signal is inside an enabled strategic zone's polygon
  +25  signal is inside zone bbox but not polygon (fringe proximity)
  +15  zone is CONFLICT_ACTIVE, NUCLEAR_SENSITIVE, MILITARY_SENSITIVE,
       CHOKEPOINT_EXTENDED, or severity_baseline=critical/high
  +10  active surge event overlaps the zone
  +10  active fusion event within 200km
  +10  ADSB domain near NUCLEAR_SENSITIVE or MILITARY_SENSITIVE zone
  +15  AIS domain near CHOKEPOINT_EXTENDED or ECONOMIC_CRITICAL zone
  +5   other domain/zone type match
"""
from __future__ import annotations
import json
import threading
from typing import Optional

try:
    from shapely.geometry import Point, shape as _shp_shape
    _HAS_SHAPELY = True
except ImportError:
    _HAS_SHAPELY = False


class RelevanceScorer:
    def __init__(self):
        self._lock      = threading.Lock()
        self._zones     = []   # list of dicts from _load_zones()
        self._zones_ts  = 0.0  # epoch of last load
        self._ttl       = 120  # seconds between DB reloads

    # ── Public API ────────────────────────────────────────────────────────────

    def score_signal(self, signal: dict, db=None) -> int:
        """
        Score a single signal dict.  Expects keys: lat, lon, domain (optional),
        signal_type (optional).  Returns integer 0-100.
        """
        lat = signal.get("lat")
        lon = signal.get("lon")
        if lat is None or lon is None:
            return 0

        zones = self._get_zones(db)
        score = 0

        containing, fringe = self._classify_zones(lat, lon, zones)

        _HIGH_THREAT = {"CONFLICT_ACTIVE", "NUCLEAR_SENSITIVE", "MILITARY_SENSITIVE", "CHOKEPOINT_EXTENDED"}
        if containing:
            score += 50
            if any(z["severity_baseline"] in ("critical", "high") or z["zone_type"] in _HIGH_THREAT
                   for z in containing):
                score += 15
        elif fringe:
            score += 25
            if any(z["severity_baseline"] in ("critical", "high") for z in fringe):
                score += 8

        score += self._surge_bonus(lat, lon, db)
        score += self._fusion_bonus(lat, lon, db)
        score += self._domain_bonus(signal, containing + fringe)

        return min(score, 100)

    def score_all_active_signals(self, signals: list[dict], db=None) -> list[dict]:
        """Batch-score a list of signal dicts; returns same list with 'relevance_score' added."""
        zones = self._get_zones(db)
        for s in signals:
            lat = s.get("lat")
            lon = s.get("lon")
            if lat is None or lon is None:
                s["relevance_score"] = 0
                continue
            containing, fringe = self._classify_zones(lat, lon, zones)
            _HT = {"CONFLICT_ACTIVE", "NUCLEAR_SENSITIVE", "MILITARY_SENSITIVE", "CHOKEPOINT_EXTENDED"}
            score = 0
            if containing:
                score += 50
                if any(z["severity_baseline"] in ("critical", "high") or z["zone_type"] in _HT
                       for z in containing):
                    score += 15
            elif fringe:
                score += 25
                if any(z["severity_baseline"] in ("critical", "high") for z in fringe):
                    score += 8
            score += self._surge_bonus(lat, lon, db)
            score += self._fusion_bonus(lat, lon, db)
            score += self._domain_bonus(s, containing + fringe)
            s["relevance_score"] = min(score, 100)
        return signals

    def get_containing_zones(self, lat: float, lon: float, db=None) -> list[dict]:
        """Return all enabled zones whose polygon contains the point."""
        zones = self._get_zones(db)
        containing, _ = self._classify_zones(lat, lon, zones)
        return containing

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _get_zones(self, db=None) -> list[dict]:
        import time
        with self._lock:
            if time.time() - self._zones_ts < self._ttl and self._zones:
                return self._zones
        zones = self._load_zones(db)
        with self._lock:
            self._zones    = zones
            self._zones_ts = time.time()
        return zones

    def _load_zones(self, db=None) -> list[dict]:
        try:
            from database import StrategicZone, get_db
            ctx = get_db() if db is None else _NullCtx(db)
            with ctx as session:
                rows = session.query(StrategicZone).filter(StrategicZone.enabled == True).all()
            out = []
            for r in rows:
                try:
                    poly = json.loads(r.polygon_geojson)
                except Exception:
                    poly = None
                out.append({
                    "zone_id":           r.zone_id,
                    "name":              r.name,
                    "zone_type":         r.zone_type,
                    "severity_baseline": r.severity_baseline,
                    "colour":            r.colour,
                    "bbox":              (r.bbox_min_lon, r.bbox_min_lat, r.bbox_max_lon, r.bbox_max_lat),
                    "polygon_geojson":   poly,
                })
            return out
        except Exception as ex:
            print(f"[relevance-scorer] zone load error: {ex}")
            return []

    def _classify_zones(
        self, lat: float, lon: float, zones: list[dict]
    ) -> tuple[list[dict], list[dict]]:
        """Return (containing_zones, fringe_zones) for a given point."""
        containing: list[dict] = []
        fringe:     list[dict] = []
        pt = Point(lon, lat) if _HAS_SHAPELY else None
        for z in zones:
            min_lon, min_lat, max_lon, max_lat = z["bbox"]
            in_bbox = (min_lon <= lon <= max_lon) and (min_lat <= lat <= max_lat)
            if not in_bbox:
                continue
            poly_geo = z.get("polygon_geojson")
            if _HAS_SHAPELY and poly_geo and pt is not None:
                try:
                    poly = _shp_shape(poly_geo)
                    if poly.contains(pt):
                        containing.append(z)
                    else:
                        fringe.append(z)
                    continue
                except Exception:
                    pass
            # Fallback: bbox hit counts as containing when shapely unavailable
            containing.append(z)
        return containing, fringe

    def _surge_bonus(self, lat: float, lon: float, db=None) -> int:
        """+10 if there is an active surge event whose bbox overlaps this point."""
        try:
            from database import SurgeEvent, get_db
            from sqlalchemy import and_
            ctx = get_db() if db is None else _NullCtx(db)
            with ctx as session:
                hit = session.query(SurgeEvent).filter(
                    and_(
                        SurgeEvent.bbox_min_lat <= lat, SurgeEvent.bbox_max_lat >= lat,
                        SurgeEvent.bbox_min_lon <= lon, SurgeEvent.bbox_max_lon >= lon,
                    )
                ).first()
            return 10 if hit else 0
        except Exception:
            return 0

    def _fusion_bonus(self, lat: float, lon: float, db=None) -> int:
        """
        +10 if the nearest recent fusion event is within ~200 km of the signal.
        Uses a rough bbox check (2 degrees ≈ 220 km).
        """
        try:
            from database import FusionEvent, get_db
            ctx = get_db() if db is None else _NullCtx(db)
            with ctx as session:
                hit = session.query(FusionEvent).filter(
                    FusionEvent.lat.between(lat - 2.0, lat + 2.0),
                    FusionEvent.lon.between(lon - 2.0, lon + 2.0),
                ).first()
            return 10 if hit else 0
        except Exception:
            return 0

    def _domain_bonus(self, signal: dict, nearby_zones: list[dict]) -> int:
        """
        Domain/zone specialty bonus.
        +15 AIS near CHOKEPOINT_EXTENDED or ECONOMIC_CRITICAL (key shipping lanes)
        +10 ADSB near NUCLEAR_SENSITIVE or MILITARY_SENSITIVE (surveillance-relevant)
        +5  other domain/zone type match
        """
        if not nearby_zones:
            return 0
        domain = (signal.get("domain") or signal.get("signal_type") or "").upper()
        best = 0
        for z in nearby_zones:
            zt = z.get("zone_type", "")
            if domain == "AIS" and zt in ("CHOKEPOINT_EXTENDED", "ECONOMIC_CRITICAL"):
                best = max(best, 15)
            elif domain == "ADSB" and zt in ("NUCLEAR_SENSITIVE", "MILITARY_SENSITIVE"):
                best = max(best, 10)
            elif domain in ("ADSB", "AIS") and zt in ("CONFLICT_ACTIVE", "CONFLICT_FROZEN"):
                best = max(best, 5)
        return best

    def invalidate_cache(self):
        with self._lock:
            self._zones_ts = 0.0


class _NullCtx:
    def __init__(self, db):
        self._db = db
    def __enter__(self):
        return self._db
    def __exit__(self, *_):
        pass


# Singleton
relevance_scorer = RelevanceScorer()
