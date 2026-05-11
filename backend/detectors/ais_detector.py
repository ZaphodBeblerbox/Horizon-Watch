import math
from datetime import datetime, timezone


class AISAnomalyDetector:
    """Rule-based AIS vessel anomaly detection."""

    def __init__(self):
        self.rules = []

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
                            break  # one alert per rule per vessel

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
                # Requires history tracking — placeholder
                pass

            elif trigger == "route_deviation":
                # Placeholder — destination analysis needs route DB
                pass

        return alerts

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
            "rule_id":   rule.get("id"),
            "rule_name": rule.get("name"),
            "source":    "AIS",
            "severity":  rule.get("severity", "medium"),
            "vessel":    vessel.get("name") or str(vessel.get("mmsi", "Unknown")),
            "mmsi":      vessel.get("mmsi"),
            "lat":       vessel.get("lat"),
            "lng":       vessel.get("lng"),
            "message":   message,
            "timestamp": datetime.now(timezone.utc).isoformat(),
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
