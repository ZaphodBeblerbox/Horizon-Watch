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

    def calculate_region_threat(self, region_name, signals, correlations=None):
        base_score = sum(self.weights.get(k, 0) * signals.get(k, 0) for k in self.weights)

        # Correlation bonus — multi-domain corroborations boost the score
        corr_bonus = 0.0
        for c in (correlations or []):
            sev = c.get("severity", "")
            if sev == "CRITICAL":   corr_bonus += 0.30
            elif sev == "HIGH":     corr_bonus += 0.20
            elif sev == "ELEVATED": corr_bonus += 0.10
        corr_bonus = min(corr_bonus, 0.40)

        # Repeat-offender and escalation bonuses
        rep_bonus = min(sum(1 for c in (correlations or []) if c.get("type") == "repeat_offender") * 0.05, 0.15)
        esc_bonus = min(sum(1 for c in (correlations or []) if c.get("type") == "escalation_sequence") * 0.10, 0.20)

        final_score = min(1.0, base_score + corr_bonus + rep_bonus + esc_bonus)

        if final_score > 0.7:   level = "CRITICAL"
        elif final_score > 0.5: level = "HIGH"
        elif final_score > 0.3: level = "ELEVATED"
        else:                   level = "LOW"

        return {
            "region":    region_name,
            "score":     round(final_score, 3),
            "level":     level,
            "breakdown": {
                k: round(self.weights.get(k, 0) * signals.get(k, 0), 3)
                for k in self.weights
            },
            "correlation_bonus":          round(corr_bonus + rep_bonus + esc_bonus, 3),
            "contributing_correlations":  len(correlations or []),
        }
