class ThreatEngine:
    """Combines signals from all detectors into a unified threat score per region."""

    DEFAULT_WEIGHTS = {
        "ais_anomaly":       0.25,
        "adsb_anomaly":      0.15,
        "news_escalation":   0.30,
        "satellite_change":  0.20,
        "event_density":     0.10,
    }

    def __init__(self):
        self.weights = dict(self.DEFAULT_WEIGHTS)

    def load_weights(self, weights):
        self.weights = weights

    def calculate_region_threat(self, region_name, signals):
        score = sum(self.weights.get(k, 0) * signals.get(k, 0) for k in self.weights)
        if score > 0.7:
            level = "CRITICAL"
        elif score > 0.5:
            level = "HIGH"
        elif score > 0.3:
            level = "ELEVATED"
        else:
            level = "LOW"
        return {
            "region":    region_name,
            "score":     round(score, 3),
            "level":     level,
            "breakdown": {
                k: round(self.weights.get(k, 0) * signals.get(k, 0), 3)
                for k in self.weights
            },
        }
