import math
from datetime import datetime, timedelta


class AISAnomalyDetector:
    """Rule-based AIS vessel anomaly detection."""

    def __init__(self):
        self.rules = []

    def load_rules(self, rules):
        self.rules = rules

    def check_vessel(self, vessel, cables=None, chokepoints=None, history=None):
        alerts = []
        for rule in self.rules:
            if rule.get("status") != "active":
                continue
            if rule.get("source") not in ("AIS", "ais"):
                continue
            trigger = rule.get("trigger_type", "").lower()
            if "stationary" in trigger or "loiter" in trigger:
                a = self._check_stationary(vessel, rule, cables)
                if a:
                    alerts.append(a)
            elif "dark" in trigger or "transponder" in trigger:
                a = self._check_dark_transit(vessel, rule, history)
                if a:
                    alerts.append(a)
            elif "deviation" in trigger:
                a = self._check_route_deviation(vessel, rule)
                if a:
                    alerts.append(a)
            elif "speed" in trigger:
                a = self._check_speed_anomaly(vessel, rule)
                if a:
                    alerts.append(a)
        return alerts

    def _check_stationary(self, vessel, rule, cables=None):
        if vessel.get("speed", 0) > 0.5:
            return None
        if cables:
            for cable in cables:
                for coord in cable.get("coordinates", []):
                    dist = self._haversine(
                        vessel["lat"], vessel["lng"], coord[1], coord[0]
                    )
                    if dist < 10:
                        return self._alert(
                            rule, "high", vessel,
                            f"Vessel {vessel.get('name', 'Unknown')} stationary "
                            f"within {dist:.1f}km of {cable.get('name', 'submarine cable')}",
                            source="ais_anomaly",
                        )
        return None

    def _check_dark_transit(self, vessel, rule, history=None):
        if not history:
            return None
        last_seen = history.get("last_seen")
        if not last_seen:
            return None
        try:
            gap = (
                datetime.utcnow() - datetime.fromisoformat(last_seen)
            ).total_seconds()
        except Exception:
            return None
        threshold = rule.get("params", {}).get("gap_minutes", 30) * 60
        if gap > threshold:
            return self._alert(
                rule, "high", vessel,
                f"AIS gap of {int(gap / 60)} min for {vessel.get('name', 'Unknown')}",
                source="ais_anomaly",
            )
        return None

    def _check_speed_anomaly(self, vessel, rule):
        speed = vessel.get("speed", 0)
        max_speed = rule.get("params", {}).get("max_speed", 25)
        if speed > max_speed:
            return self._alert(
                rule, "medium", vessel,
                f"Unusual speed {speed} kn for {vessel.get('name', 'Unknown')}",
                source="ais_anomaly",
            )
        return None

    def _check_route_deviation(self, vessel, rule):
        return None

    def _alert(self, rule, severity, vessel, message, source="ais_anomaly"):
        return {
            "rule_id":   rule.get("id"),
            "rule_name": rule.get("name"),
            "source":    source,
            "severity":  severity,
            "vessel":    vessel.get("name", vessel.get("mmsi")),
            "mmsi":      vessel.get("mmsi"),
            "lat":       vessel.get("lat"),
            "lng":       vessel.get("lng"),
            "message":   message,
            "timestamp": datetime.utcnow().isoformat(),
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
        return R * 2 * math.asin(math.sqrt(min(a, 1)))
