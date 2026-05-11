"""
Cross-domain intelligence correlation engine.
Takes signals from all detectors and produces correlated assessments.
"""
from datetime import datetime, timezone
import math


class CorrelationEngine:

    def __init__(self):
        self.entity_history = {}   # mmsi → {total, last_seen}
        self.confidence_weights = {
            "single":  0.30,
            "dual":    0.60,
            "triple":  0.85,
            "quad":    0.95,
        }

    # ── Public entry point ────────────────────────────────────────────────────

    def correlate(self, ais_alerts, adsb_alerts, news_events, satellite_changes, ontology):
        """
        Main loop. Takes all current signals and produces cross-domain assessments.
        Returns list of assessment dicts.
        """
        assessments = []

        # Normalise signals into a flat list with domain tags
        all_signals = []
        for a in ais_alerts:
            all_signals.append({**a, "domain": "maritime", "source": "AIS"})
        for a in adsb_alerts:
            all_signals.append({**a, "domain": "aviation", "source": "ADSB"})
        for e in news_events:
            lat = e.get("lat")
            lng = e.get("lng") or e.get("lon")
            if lat and lng:
                all_signals.append({
                    "lat":       lat,
                    "lng":       lng,
                    "message":   e.get("title") or e.get("headline") or "",
                    "severity":  e.get("severity", "medium"),
                    "domain":    "news",
                    "source":    "NEWS",
                    "timestamp": e.get("published") or e.get("published_at") or "",
                })
        for s in satellite_changes:
            all_signals.append({**s, "domain": "satellite", "source": "SAT"})

        # 1. Geographic clustering
        clusters = self._cluster_by_proximity(all_signals, radius_km=100)
        for cluster in clusters:
            if len(cluster) < 2:
                continue
            domains = set(s["source"] for s in cluster)
            if len(domains) >= 2:
                assessment = self._assess_cluster(cluster, domains, ontology)
                if assessment:
                    assessments.append(assessment)

        # 2. Temporal escalation sequences
        assessments.extend(self._detect_temporal_sequences(all_signals))

        # 3. Repeat-offender entity tracking
        assessments.extend(self._check_entity_reputation(ais_alerts))

        # 4. Ontology-link propagation
        assessments.extend(self._propagate_escalation(all_signals, ontology))

        return assessments

    # ── Clustering ────────────────────────────────────────────────────────────

    def _cluster_by_proximity(self, signals, radius_km=100):
        used = set()
        clusters = []
        for i, s1 in enumerate(signals):
            if i in used or not s1.get("lat"):
                continue
            cluster = [s1]
            used.add(i)
            for j, s2 in enumerate(signals):
                if j in used or not s2.get("lat"):
                    continue
                if self._haversine(s1["lat"], s1["lng"], s2["lat"], s2["lng"]) < radius_km:
                    cluster.append(s2)
                    used.add(j)
            clusters.append(cluster)
        return clusters

    # ── Cluster assessment ────────────────────────────────────────────────────

    def _assess_cluster(self, cluster, domains, ontology):
        n = len(domains)
        if n >= 4:   confidence = self.confidence_weights["quad"]
        elif n >= 3: confidence = self.confidence_weights["triple"]
        else:        confidence = self.confidence_weights["dual"]

        sev_scores = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}
        severities = [s.get("severity", "low") for s in cluster]
        avg_sev = sum(sev_scores.get(sv, 1) for sv in severities) / len(severities)

        if "AIS" in domains and "ADSB" in domains:
            avg_sev += 1.0
        if "NEWS" in domains and avg_sev >= 2:
            avg_sev += 0.5

        if avg_sev >= 3.5:   final_severity = "CRITICAL"
        elif avg_sev >= 2.5: final_severity = "HIGH"
        elif avg_sev >= 1.5: final_severity = "ELEVATED"
        else:                final_severity = "LOW"

        lats = [s["lat"] for s in cluster if s.get("lat")]
        lngs = [s["lng"] for s in cluster if s.get("lng")]
        center_lat = sum(lats) / len(lats) if lats else None
        center_lng = sum(lngs) / len(lngs) if lngs else None

        related = self._find_nearby_entities(center_lat, center_lng, ontology, radius_km=150)

        parts = []
        for domain in sorted(domains):
            dsigs = [s for s in cluster if s["source"] == domain]
            if domain == "AIS":
                parts.append(f"Maritime: {len(dsigs)} vessel anomalies")
            elif domain == "ADSB":
                parts.append(f"Aviation: {len(dsigs)} aircraft activities")
            elif domain == "NEWS":
                parts.append(f"OSINT: {len(dsigs)} news events")
            elif domain == "SAT":
                parts.append(f"Satellite: {len(dsigs)} imagery changes")

        return {
            "type":             "correlation",
            "severity":         final_severity,
            "confidence":       round(confidence, 2),
            "domains":          list(domains),
            "signal_count":     len(cluster),
            "lat":              center_lat,
            "lng":              center_lng,
            "narrative":        " | ".join(parts),
            "related_entities": related,
            "signals":          [{"source": s["source"], "message": s.get("message", "")[:100]} for s in cluster[:10]],
            "timestamp":        datetime.now(timezone.utc).isoformat(),
            "recommendation":   self._generate_recommendation(final_severity, domains, related),
        }

    # ── Temporal escalation detection ─────────────────────────────────────────

    def _detect_temporal_sequences(self, signals):
        assessments = []
        grid = {}
        for s in signals:
            if not s.get("lat"):
                continue
            key = (round(s["lat"]), round(s["lng"]))
            grid.setdefault(key, []).append(s)

        sev_scores = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}
        for key, region_signals in grid.items():
            if len(region_signals) < 3:
                continue
            sorted_sigs = sorted(region_signals, key=lambda x: x.get("timestamp", ""))
            scores = [sev_scores.get(s.get("severity", "low"), 1) for s in sorted_sigs]
            trend = sum(scores[i+1] - scores[i] for i in range(len(scores)-1)) / (len(scores)-1)
            if trend > 0.5:
                assessments.append({
                    "type":         "escalation_sequence",
                    "severity":     "HIGH",
                    "confidence":   0.70,
                    "lat":          key[0],
                    "lng":          key[1],
                    "narrative":    f"Escalation: {len(region_signals)} signals with rising severity (trend +{trend:.1f})",
                    "signal_count": len(region_signals),
                    "timestamp":    datetime.now(timezone.utc).isoformat(),
                })
        return assessments

    # ── Repeat-offender tracking ──────────────────────────────────────────────

    def _check_entity_reputation(self, ais_alerts):
        assessments = []
        entity_counts = {}
        for a in ais_alerts:
            mmsi = a.get("mmsi")
            if mmsi:
                if mmsi not in entity_counts:
                    entity_counts[mmsi] = {"count": 0, "alerts": [], "name": a.get("vessel", "Unknown")}
                entity_counts[mmsi]["count"] += 1
                entity_counts[mmsi]["alerts"].append(a)

        for mmsi, data in entity_counts.items():
            prev = self.entity_history.get(mmsi, {"total": 0})
            new_total = prev["total"] + data["count"]
            self.entity_history[mmsi] = {"total": new_total, "last_seen": datetime.now(timezone.utc).isoformat()}

            if new_total >= 3:
                last = data["alerts"][-1]
                assessments.append({
                    "type":       "repeat_offender",
                    "severity":   "HIGH" if new_total >= 5 else "ELEVATED",
                    "confidence": min(0.50 + new_total * 0.1, 0.95),
                    "lat":        last.get("lat"),
                    "lng":        last.get("lng"),
                    "narrative":  f"Repeat offender: {data['name']} (MMSI:{mmsi}) triggered {new_total} alerts total",
                    "entity":     data["name"],
                    "mmsi":       mmsi,
                    "signal_count": new_total,
                    "timestamp":  datetime.now(timezone.utc).isoformat(),
                })
        return assessments

    # ── Ontology propagation ──────────────────────────────────────────────────

    def _propagate_escalation(self, signals, ontology):
        assessments = []
        if not ontology:
            return assessments
        nodes = ontology.get("nodes", [])
        edges = ontology.get("edges", [])

        active_nodes = set()
        for signal in signals:
            if not signal.get("lat"):
                continue
            for node in nodes:
                if not node.get("lat"):
                    continue
                if self._haversine(signal["lat"], signal["lng"], node["lat"], node["lng"]) < 100:
                    active_nodes.add(node["id"])

        propagated = set()
        for node_id in active_nodes:
            for edge in edges:
                connected_id = None
                if edge.get("source") == node_id:   connected_id = edge.get("target")
                elif edge.get("target") == node_id: connected_id = edge.get("source")
                if not connected_id or connected_id in active_nodes or connected_id in propagated:
                    continue
                connected_node = next((n for n in nodes if n["id"] == connected_id), None)
                if connected_node and connected_node.get("type") in ("country", "chokepoint", "facility"):
                    propagated.add(connected_id)
                    origin_label = next((n["label"] for n in nodes if n["id"] == node_id), "unknown")
                    assessments.append({
                        "type":       "ontology_propagation",
                        "severity":   "ELEVATED",
                        "confidence": 0.50,
                        "lat":        connected_node.get("lat"),
                        "lng":        connected_node.get("lng"),
                        "narrative":  (
                            f"Network effect: activity near {origin_label} propagates threat to "
                            f"{connected_node['label']} via '{edge.get('type','link')}'"
                        ),
                        "signal_count": 1,
                        "timestamp":  datetime.now(timezone.utc).isoformat(),
                    })
        return assessments

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _find_nearby_entities(self, lat, lng, ontology, radius_km=150):
        if not ontology or lat is None or lng is None:
            return []
        nearby = []
        for node in ontology.get("nodes", []):
            if node.get("lat") and node.get("lng"):
                dist = self._haversine(lat, lng, node["lat"], node["lng"])
                if dist < radius_km:
                    nearby.append({
                        "id":          node["id"],
                        "label":       node["label"],
                        "type":        node["type"],
                        "distance_km": round(dist, 1),
                    })
        return sorted(nearby, key=lambda x: x["distance_km"])[:10]

    def _generate_recommendation(self, severity, domains, entities):
        if severity == "CRITICAL":
            return (
                "IMMEDIATE ACTION: Multi-source intelligence confirms critical threat. "
                "Activate response protocols and escalate to command."
            )
        if severity == "HIGH":
            recs = ["Increase surveillance frequency for affected area."]
            if "AIS" in domains:   recs.append("Task maritime patrol asset for close monitoring.")
            if "ADSB" in domains:  recs.append("Alert air defense coordination centre.")
            if "NEWS" in domains:  recs.append("Monitor open-source media for escalation indicators.")
            return " ".join(recs)
        if severity == "ELEVATED":
            return "Continue monitoring. Multiple signals suggest developing situation. Re-assess in 6 hours."
        return "Log and monitor. No immediate action required."

    @staticmethod
    def _haversine(lat1, lon1, lat2, lon2):
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (math.sin(dlat / 2) ** 2
             + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
             * math.sin(dlon / 2) ** 2)
        return R * 2 * math.asin(math.sqrt(min(a, 1.0)))
