import math
from datetime import datetime, timezone

try:
    from shapely.geometry import Point, MultiLineString as _MultiLineString
    _SHAPELY = True
except ImportError:
    _SHAPELY = False


class AISAnomalyDetector:
    """Rule-based AIS vessel anomaly detection."""

    def __init__(self):
        self.rules = []
        # Loiter state: (mmsi, cable_system_id) -> {first_within, last_within, alerted}
        self._loiter: dict = {}

    def load_rules(self, rules):
        self.rules = rules

    def check_vessel(self, vessel, cables=None, chokepoints=None, all_vessels=None):
        if not vessel.get("lat") or not vessel.get("lng"):
            return []
        alerts = []
        for rule in self.rules:
            if rule.get("status") != "active":
                continue
            if rule.get("source") not in ("AIS", "ais"):
                continue
            trigger = rule.get("trigger_type", "")
            params  = rule.get("params", {})

            if trigger == "stationary_near_infrastructure":
                speed = vessel.get("speed", 99)
                if speed <= params.get("max_speed_knots", 0.5) and cables:
                    for cable in cables:
                        hit = self._nearest_cable_point(
                            vessel["lat"], vessel["lng"],
                            cable.get("coordinates", []),
                            params.get("proximity_km", 10),
                        )
                        if hit is not None:
                            alerts.append(self._make_alert(rule, vessel,
                                f"Vessel stationary {hit:.1f}km from {cable.get('name','submarine cable')}"))
                            break

            elif trigger == "speed_anomaly":
                speed = vessel.get("speed", 0)
                if speed > params.get("max_speed_knots", 25):
                    alerts.append(self._make_alert(rule, vessel,
                        f"Speed anomaly: {vessel.get('name','?')} at {speed:.1f} kn"))

            elif trigger == "ship_to_ship":
                if all_vessels and vessel.get("speed", 99) <= params.get("max_speed_knots", 2):
                    own_mmsi = str(vessel.get("mmsi", ""))
                    for other_mmsi, other in all_vessels.items():
                        if str(other_mmsi) == own_mmsi:
                            continue
                        if not other.get("lat") or not other.get("lng"):
                            continue
                        if other.get("speed", 99) > params.get("max_speed_knots", 2):
                            continue
                        dist_m = self._haversine(
                            vessel["lat"], vessel["lng"], other["lat"], other["lng"]
                        ) * 1000
                        if dist_m <= params.get("proximity_meters", 500):
                            alerts.append(self._make_alert(rule, vessel,
                                f"Ship-to-ship: {vessel.get('name','?')} within "
                                f"{dist_m:.0f}m of {other.get('name','?')}"))
                            break

            elif trigger == "transponder_gap":
                pass   # requires history tracking

            elif trigger == "route_deviation":
                pass   # requires route DB

        return alerts

    # ── Loitering near cable ──────────────────────────────────────────────────

    def check_loitering(self, vessel, db_cables: list, loiter_rules: list, now: datetime) -> list:
        """
        Check vessel position against AIS_LOITERING_NEAR_CABLE rules.

        db_cables entries must have: system_id, region_id, name, geometry (GeoJSON dict)
        loiter_rules entries must have: params.target, params.distance_metres,
            params.duration_minutes, params.max_speed_knots
        """
        if not vessel.get("lat") or not vessel.get("lng"):
            return []
        alerts = []
        speed = float(vessel.get("speed") or 0)

        for rule in loiter_rules:
            if not rule.get("enabled", True):
                continue
            params           = rule.get("params") or {}
            max_speed        = float(params.get("max_speed_knots", 2.0))
            distance_metres  = float(params.get("distance_metres", 500))
            duration_minutes = float(params.get("duration_minutes", 30))
            target           = str(params.get("target", "ALL")).upper()

            if speed > max_speed:
                # Vessel too fast — clear any loiter state it had for this rule
                for key in list(self._loiter.keys()):
                    if key[0] == vessel["mmsi"] and key[2] == rule.get("id"):
                        del self._loiter[key]
                continue

            in_scope = self._cables_in_scope(db_cables, target)
            for cable in in_scope:
                cable_sys_id = cable.get("system_id") or cable.get("cable_id", "")
                state_key = (vessel["mmsi"], cable_sys_id, rule.get("id"))

                dist_m = self._point_to_cable_metres(
                    vessel["lat"], vessel["lng"], cable.get("geometry", {})
                )

                if dist_m is None or dist_m > distance_metres:
                    # Not within range — clear loiter state
                    self._loiter.pop(state_key, None)
                    continue

                # Within range — update loiter state
                state = self._loiter.get(state_key)
                if state is None:
                    self._loiter[state_key] = {
                        "first_within": now,
                        "last_within":  now,
                        "min_dist_m":   dist_m,
                        "alerted":      False,
                    }
                    continue

                state["last_within"] = now
                state["min_dist_m"]  = min(state["min_dist_m"], dist_m)

                if state["alerted"]:
                    continue

                elapsed = (now - state["first_within"]).total_seconds() / 60.0
                if elapsed >= duration_minutes:
                    state["alerted"] = True
                    alerts.append({
                        "id":           f"loiter_{int(now.timestamp()*1000)}",
                        "rule_id":      rule.get("id"),
                        "rule_name":    "AIS_LOITERING_NEAR_CABLE",
                        "rule_trigger": "AIS_LOITERING_NEAR_CABLE",
                        "source":       "AIS",
                        "severity":     "high",
                        "vessel":       vessel.get("name") or str(vessel.get("mmsi")),
                        "mmsi":         vessel.get("mmsi"),
                        "lat":          vessel.get("lat"),
                        "lng":          vessel.get("lng"),
                        "speed":        speed,
                        "flag":         vessel.get("flag"),
                        "message": (
                            f"AIS loitering near cable: {vessel.get('name') or vessel['mmsi']} "
                            f"within {dist_m:.0f}m of {cable.get('name',cable_sys_id)} "
                            f"for {elapsed:.0f} min"
                        ),
                        "cable_system_id": cable_sys_id,
                        "cable_name":      cable.get("name", cable_sys_id),
                        "cable_region_id": cable.get("region_id"),
                        "duration_minutes_observed": round(elapsed, 1),
                        "distance_metres_observed":  round(dist_m, 1),
                        "timestamp": now.isoformat(),
                        "provenance": {
                            "source_type":       "AIS",
                            "source_entity":     vessel.get("mmsi"),
                            "detection_rule":    "AIS_LOITERING_NEAR_CABLE",
                            "trigger_reason":    "AIS_LOITERING_NEAR_CABLE",
                            "params_at_trigger": params,
                        },
                    })
        return alerts

    def purge_stale_loiter(self, now: datetime, max_gap_minutes: float = 15.0):
        """Remove loiter entries where last_within is older than max_gap_minutes."""
        stale = [
            k for k, v in self._loiter.items()
            if (now - v["last_within"]).total_seconds() / 60.0 > max_gap_minutes
        ]
        for k in stale:
            del self._loiter[k]

    # ── Helpers ───────────────────────────────────────────────────────────────

    def check_port_loitering(self, vessel, db_ports: list, rules: list, now) -> list:
        """
        Check vessel position against AIS loitering rules whose infra_type is Port.
        db_ports entries must have: system_id, port_name, latitude, longitude,
            boundary_radius_metres (used as default proximity unless rule overrides).
        """
        if not vessel.get("lat") or not vessel.get("lng"):
            return []
        alerts = []
        speed = float(vessel.get("speed") or 0)

        for rule in rules:
            if not rule.get("enabled", True):
                continue
            params           = rule.get("params") or {}
            max_speed        = float(params.get("max_speed_knots", 2.0))
            proximity_m      = float(params.get("proximity_metres", 2000))
            duration_minutes = float(params.get("duration_minutes", 60))
            target           = str(params.get("target", "ALL")).upper()
            icon_type        = params.get("icon_type", "LOITERING_PORT")
            severity         = rule.get("severity", "high")

            if speed > max_speed:
                for key in list(self._loiter.keys()):
                    if key[0] == vessel["mmsi"] and key[2] == rule.get("id"):
                        del self._loiter[key]
                continue

            in_scope = self._ports_in_scope(db_ports, target)
            for port in in_scope:
                port_sys_id  = port.get("system_id", "")
                port_lat     = float(port.get("latitude") or port.get("lat") or 0)
                port_lon     = float(port.get("longitude") or port.get("lon") or 0)
                port_radius  = float(port.get("boundary_radius_metres") or proximity_m)
                effective_m  = max(proximity_m, port_radius)
                state_key    = (vessel["mmsi"], port_sys_id, rule.get("id"))

                dist_m = self._haversine(vessel["lat"], vessel["lng"], port_lat, port_lon) * 1_000
                if dist_m > effective_m:
                    self._loiter.pop(state_key, None)
                    continue

                state = self._loiter.get(state_key)
                if state is None:
                    self._loiter[state_key] = {
                        "first_within": now,
                        "last_within":  now,
                        "min_dist_m":   dist_m,
                        "alerted":      False,
                    }
                    continue

                state["last_within"] = now
                state["min_dist_m"]  = min(state["min_dist_m"], dist_m)

                if state["alerted"]:
                    continue

                elapsed = (now - state["first_within"]).total_seconds() / 60.0
                if elapsed >= duration_minutes:
                    state["alerted"] = True
                    port_name = port.get("port_name") or port_sys_id
                    alerts.append({
                        "id":           f"portloiter_{int(now.timestamp()*1000)}",
                        "rule_id":      rule.get("id"),
                        "rule_name":    rule.get("rule_name", "AIS_LOITERING_NEAR_INFRA"),
                        "rule_trigger": "AIS_LOITERING_NEAR_INFRA",
                        "source":       "AIS",
                        "severity":     severity,
                        "icon_type":    icon_type,
                        "vessel":       vessel.get("name") or str(vessel.get("mmsi")),
                        "mmsi":         vessel.get("mmsi"),
                        "lat":          vessel.get("lat"),
                        "lng":          vessel.get("lng"),
                        "speed":        speed,
                        "flag":         vessel.get("flag"),
                        "message": (
                            f"Port loitering: {vessel.get('name') or vessel['mmsi']} "
                            f"within {dist_m:.0f}m of {port_name} "
                            f"for {elapsed:.0f} min"
                        ),
                        "port_system_id": port_sys_id,
                        "port_name":      port_name,
                        "duration_minutes_observed": round(elapsed, 1),
                        "distance_metres_observed":  round(dist_m, 1),
                        "timestamp": now.isoformat(),
                        "provenance": {
                            "source_type":       "AIS",
                            "source_entity":     vessel.get("mmsi"),
                            "detection_rule":    "AIS_LOITERING_NEAR_INFRA",
                            "trigger_reason":    "AIS_LOITERING_NEAR_INFRA",
                            "params_at_trigger": params,
                        },
                    })
        return alerts

    # ── Strategic-port name list (shared constant) ────────────────────────────
    STRATEGIC_PORT_NAMES = [
        "Shanghai", "Singapore", "Rotterdam", "Antwerpen",
        "Port Said East", "Bandar Abbas", "Colombo", "Mumbai (ex Bombay)",
        "Djibouti", "As Suways (Suez)", "Istanbul", "Hamburg",
        "Vladivostok", "Busan", "Yokohama", "Los Angeles",
        "Houston", "Haifa", "Durban", "Hong Kong",
        "Abu Dhabi", "Genova", "Novorossiysk", "Piraeus",
        "Port Klang (Pelabuhan Klang)", "Shenzhen", "Tianjin",
        "Guangzhou", "Qingdao", "Shuaiba",
    ]

    @staticmethod
    def _cables_in_scope(db_cables: list, target: str) -> list:
        t = target.upper()
        if t == "ALL":
            return db_cables
        # Accept both "REG-NORSEA" and "REGION:REG-NORSEA"
        if t.startswith("REGION:"):
            t = t[len("REGION:"):]
        if t.startswith("REG-"):
            return [c for c in db_cables if (c.get("region_id") or "").upper() == t]
        # Single cable system_id
        return [c for c in db_cables if (c.get("system_id") or "").upper() == t]

    @classmethod
    def _ports_in_scope(cls, db_ports: list, target: str) -> list:
        """Filter db_ports by target.  Handles ALL, PORTS:STRATEGIC, REG-xxx."""
        t = target.upper()
        if t == "ALL":
            return db_ports
        if t == "PORTS:STRATEGIC":
            names = {n.upper() for n in cls.STRATEGIC_PORT_NAMES}
            return [p for p in db_ports if (p.get("port_name") or "").upper() in names]
        if t.startswith("REGION:"):
            t = t[len("REGION:"):]
        if t.startswith("REG-"):
            return [p for p in db_ports if (p.get("region_id") or "").upper() == t]
        # Single port system_id
        return [p for p in db_ports if (p.get("system_id") or "").upper() == t]

    @staticmethod
    def _point_to_cable_metres(lat: float, lon: float, geometry: dict) -> float | None:
        """Point-to-MultiLineString distance in metres. Uses Shapely when available."""
        coords_list = geometry.get("coordinates", [])
        if not coords_list:
            return None

        # Flatten MultiLineString segments into a list of segments
        if geometry.get("type") == "MultiLineString":
            segments = coords_list
        elif geometry.get("type") == "LineString":
            segments = [coords_list]
        else:
            return None

        if _SHAPELY:
            try:
                lines = []
                for seg in segments:
                    if len(seg) >= 2:
                        lines.append(seg)
                if not lines:
                    return None
                cable_geom = _MultiLineString(lines)
                pt = Point(lon, lat)
                dist_deg = pt.distance(cable_geom)
                # Convert degrees → metres using equatorial approximation (ok for < 1km)
                cos_lat = math.cos(math.radians(lat))
                metres_per_deg_lon = 111_320.0 * cos_lat
                metres_per_deg_lat = 110_574.0
                # Use average of lat and lon scales as a simple scalar
                scale = (metres_per_deg_lat + metres_per_deg_lon) / 2.0
                return dist_deg * scale
            except Exception:
                pass

        # Fallback: iterate all segment points, return min haversine distance
        best_m = None
        for seg in segments:
            for cx, cy in seg:
                try:
                    d_m = AISAnomalyDetector._haversine(lat, lon, cy, cx) * 1_000
                    if best_m is None or d_m < best_m:
                        best_m = d_m
                except (TypeError, ValueError):
                    continue
        return best_m

    def _nearest_cable_point(self, lat, lng, coords, max_km):
        best = None
        for coord in coords:
            try:
                d = self._haversine(lat, lng, coord[1], coord[0])
            except (IndexError, TypeError):
                continue
            if d <= max_km:
                if best is None or d < best:
                    best = d
        return best

    def _make_alert(self, rule, vessel, message):
        return {
            "id":           f"alert_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "rule_id":      rule.get("id"),
            "rule_name":    rule.get("name"),
            "rule_trigger": rule.get("trigger_type"),
            "source":       "AIS",
            "severity":     rule.get("severity", "medium"),
            "vessel":       vessel.get("name") or str(vessel.get("mmsi", "Unknown")),
            "mmsi":         vessel.get("mmsi"),
            "lat":          vessel.get("lat"),
            "lng":          vessel.get("lng"),
            "speed":        vessel.get("speed"),
            "heading":      vessel.get("heading"),
            "flag":         vessel.get("flag"),
            "destination":  vessel.get("destination"),
            "message":      message,
            "timestamp":    datetime.now(timezone.utc).isoformat(),
            "provenance": {
                "source_type":       "AIS",
                "source_entity":     vessel.get("mmsi"),
                "detection_rule":    rule.get("name"),
                "trigger_reason":    rule.get("trigger_type"),
                "params_at_trigger": rule.get("params", {}),
            },
        }

    @staticmethod
    def _haversine(lat1, lon1, lat2, lon2):
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(dlon / 2) ** 2
        )
        return R * 2 * math.asin(math.sqrt(min(a, 1.0)))
