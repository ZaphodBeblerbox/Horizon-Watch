"""
Cross-domain intelligence correlation engine.
Takes signals from all detectors and produces correlated assessments.

Also contains:
- EscalationEngine  — per-vessel multi-rule chaining (dual / triple escalation)
- STSDetector       — ship-to-ship proximity outside port boundaries
- DarkShipDetector  — AIS gap / dark-ship detection
"""
from datetime import datetime, timezone, timedelta
import math
import uuid


# ── Severity helpers ──────────────────────────────────────────────────────────

SEV_SCORES = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}
SEV_NAMES  = {4: "critical", 3: "high", 2: "medium", 1: "low", 0: "info"}

def _escalate_severity(sev: str) -> str:
    score = SEV_SCORES.get(sev.lower(), 1)
    return SEV_NAMES.get(min(score + 1, 4), "critical")


# ══════════════════════════════════════════════════════════════════════════════
# ESCALATION ENGINE
# ══════════════════════════════════════════════════════════════════════════════

class EscalationEngine:
    """
    Per-vessel multi-rule chaining.
    When 2+ distinct rules fire on the same vessel within 30 minutes,
    suppress individual alerts and emit one escalated combined alert.
    """

    WINDOW_MINUTES = 30

    def __init__(self):
        # mmsi → list of {rule_name, icon_type, severity, fired_at, alert_id}
        self._active: dict = {}

    def process(self, alerts: list, now: datetime) -> list:
        """
        Process a batch of new alerts through the escalation logic.
        Returns the final list of alerts to emit (individual or escalated).
        """
        if not alerts:
            return []

        cutoff = now - timedelta(minutes=self.WINDOW_MINUTES)

        # Purge stale entries
        for mmsi in list(self._active.keys()):
            self._active[mmsi] = [
                e for e in self._active[mmsi] if e["fired_at"] >= cutoff
            ]
            if not self._active[mmsi]:
                del self._active[mmsi]

        # Group incoming alerts by mmsi
        by_mmsi: dict = {}
        for a in alerts:
            mmsi = a.get("mmsi") or a.get("vessel")
            if not mmsi:
                continue
            by_mmsi.setdefault(str(mmsi), []).append(a)

        final_alerts: list = []
        suppressed_ids: set = set()

        for mmsi, vessel_alerts in by_mmsi.items():
            for a in vessel_alerts:
                rule_name = a.get("rule_name") or a.get("rule_trigger") or "unknown"
                icon_type = a.get("icon_type", "UNKNOWN_CONTACT")
                severity  = a.get("severity", "medium")
                alert_id  = a.get("id", str(uuid.uuid4()))
                self._active.setdefault(mmsi, []).append({
                    "rule_name": rule_name,
                    "icon_type": icon_type,
                    "severity":  severity,
                    "fired_at":  now,
                    "alert_id":  alert_id,
                })

            # Distinct rules active for this vessel in the window
            active = self._active.get(mmsi, [])
            distinct_rules = list({e["rule_name"]: e for e in active}.values())
            count = len(distinct_rules)

            if count == 1:
                # No escalation — pass through
                final_alerts.extend(vessel_alerts)
            elif count == 2:
                # Dual escalation
                for a in vessel_alerts:
                    suppressed_ids.add(a.get("id", ""))
                r1, r2     = distinct_rules[0], distinct_rules[1]
                max_sev    = max(SEV_SCORES.get(r["severity"], 1) for r in distinct_rules)
                new_sev    = _escalate_severity(SEV_NAMES.get(max_sev, "medium"))
                sample     = vessel_alerts[0]
                final_alerts.append(self._make_escalated(
                    "ESCALATED_DUAL",
                    f"{sample.get('vessel', mmsi)} — dual anomaly: {r1['rule_name']} + {r2['rule_name']}",
                    f"Two simultaneous detection rules fired within {self.WINDOW_MINUTES} min: "
                    f"{r1['rule_name']} and {r2['rule_name']}",
                    new_sev, sample, now,
                ))
            elif count >= 3:
                # Triple escalation
                for a in vessel_alerts:
                    suppressed_ids.add(a.get("id", ""))
                rule_names = " + ".join(r["rule_name"] for r in distinct_rules[:3])
                max_sev    = max(SEV_SCORES.get(r["severity"], 1) for r in distinct_rules)
                sample     = vessel_alerts[0]
                final_alerts.append(self._make_escalated(
                    "ESCALATED_TRIPLE",
                    f"{sample.get('vessel', mmsi)} — triple anomaly: {rule_names}",
                    f"{count} simultaneous detection rules fired within {self.WINDOW_MINUTES} min: {rule_names}",
                    "critical", sample, now,
                ))

        # Also pass alerts with no mmsi through unchanged
        for a in alerts:
            if not (a.get("mmsi") or a.get("vessel")):
                final_alerts.append(a)

        # Strip individually suppressed alerts that were rolled into escalations
        return [a for a in final_alerts if a.get("id", "") not in suppressed_ids]

    @staticmethod
    def _make_escalated(icon_type: str, title: str, body: str, severity: str, sample: dict, now: datetime) -> dict:
        return {
            "id":           f"esc_{int(now.timestamp()*1000)}",
            "rule_name":    icon_type,
            "rule_trigger": icon_type,
            "source":       "AIS",
            "severity":     severity,
            "icon_type":    icon_type,
            "vessel":       sample.get("vessel") or str(sample.get("mmsi", "?")),
            "mmsi":         sample.get("mmsi"),
            "lat":          sample.get("lat"),
            "lng":          sample.get("lng"),
            "message":      body,
            "title":        title,
            "timestamp":    now.isoformat(),
            "provenance": {
                "source_type":    "AIS",
                "detection_rule": icon_type,
                "trigger_reason": icon_type,
            },
        }


# ══════════════════════════════════════════════════════════════════════════════
# STS DETECTOR — ship-to-ship proximity outside port boundaries
# ══════════════════════════════════════════════════════════════════════════════

class STSDetector:
    """
    Detects ship-to-ship (STS) transfers: two vessels within proximity_metres
    of each other for >= min_duration_minutes, both outside any port boundary,
    both speed <= max_speed_knots.
    """

    def __init__(self):
        # (mmsi_a, mmsi_b) → {first_seen, alerted}
        self._tracking: dict = {}
        # mmsi → last known position {lat, lon, speed}
        self._positions: dict = {}

    def update_positions(self, vessels: dict) -> None:
        """Update last-known positions from the live AIS snapshot."""
        for mmsi, v in vessels.items():
            if v.get("lat") and v.get("lng"):
                self._positions[str(mmsi)] = {
                    "lat":   v["lat"],
                    "lng":   v["lng"],
                    "speed": float(v.get("speed") or 0),
                    "name":  v.get("name") or str(mmsi),
                }

    def check(self, vessels: dict, rules: list, now: datetime, port_check_fn=None) -> list:
        """
        vessels: dict of mmsi → normalized vessel dict (must have lat, lng, speed, name)
        rules:   list of STS rule dicts with params
        port_check_fn: callable(lat, lon) → bool — True if inside a port
        """
        alerts: list = []
        vessel_list = [
            (str(mmsi), v) for mmsi, v in vessels.items()
            if v.get("lat") and v.get("lng")
        ]
        if len(vessel_list) < 2:
            return alerts

        for rule in rules:
            if not rule.get("enabled", True):
                continue
            params            = rule.get("params", {})
            proximity_m       = float(params.get("proximity_metres", 500))
            min_dur_min       = float(params.get("min_duration_minutes", 30))
            max_speed         = float(params.get("max_speed_knots", 2.0))

            for i in range(len(vessel_list)):
                mmsi_a, v_a = vessel_list[i]
                if float(v_a.get("speed") or 0) > max_speed:
                    continue
                for j in range(i + 1, len(vessel_list)):
                    mmsi_b, v_b = vessel_list[j]
                    if float(v_b.get("speed") or 0) > max_speed:
                        continue

                    dist_m = _haversine_m(v_a["lat"], v_a["lng"], v_b["lat"], v_b["lng"])
                    if dist_m > proximity_m:
                        # Clear stale STS state
                        key = tuple(sorted([mmsi_a, mmsi_b]))
                        self._tracking.pop(key, None)
                        continue

                    # Check port boundaries
                    if port_check_fn:
                        if port_check_fn(v_a["lat"], v_a["lng"]) or port_check_fn(v_b["lat"], v_b["lng"]):
                            continue  # Normal port activity — skip

                    key = tuple(sorted([mmsi_a, mmsi_b]))
                    state = self._tracking.get(key)
                    if state is None:
                        self._tracking[key] = {"first_seen": now, "alerted": False}
                        continue

                    if state["alerted"]:
                        continue

                    elapsed_min = (now - state["first_seen"]).total_seconds() / 60.0
                    if elapsed_min >= min_dur_min:
                        state["alerted"] = True
                        mid_lat = (v_a["lat"] + v_b["lat"]) / 2
                        mid_lng = (v_a["lng"] + v_b["lng"]) / 2
                        name_a  = v_a.get("name", mmsi_a)
                        name_b  = v_b.get("name", mmsi_b)
                        alerts.append({
                            "id":           f"sts_{int(now.timestamp()*1000)}_{mmsi_a}",
                            "rule_id":      rule.get("id"),
                            "rule_name":    "AIS_STS_PROXIMITY",
                            "rule_trigger": "AIS_STS_PROXIMITY",
                            "source":       "AIS",
                            "severity":     "high",
                            "icon_type":    "STS_TRANSFER",
                            "vessel":       f"{name_a} + {name_b}",
                            "mmsi":         mmsi_a,
                            "mmsi_b":       mmsi_b,
                            "lat":          mid_lat,
                            "lng":          mid_lng,
                            "speed":        float(v_a.get("speed") or 0),
                            "message": (
                                f"Possible STS transfer: {name_a} + {name_b} "
                                f"within {dist_m:.0f}m for {elapsed_min:.0f} min, "
                                f"both outside port boundaries, speed ≤ {max_speed} kn"
                            ),
                            "timestamp": now.isoformat(),
                            "provenance": {
                                "source_type":    "AIS",
                                "detection_rule": "AIS_STS_PROXIMITY",
                                "trigger_reason": "AIS_STS_PROXIMITY",
                            },
                        })

        # Purge stale STS pairs (> 60 min)
        cutoff = now - timedelta(minutes=60)
        self._tracking = {k: v for k, v in self._tracking.items() if v["first_seen"] >= cutoff}

        return alerts

    def purge_stale(self, now: datetime, max_gap_minutes: float = 60.0) -> None:
        cutoff = now - timedelta(minutes=max_gap_minutes)
        self._tracking = {k: v for k, v in self._tracking.items() if v["first_seen"] >= cutoff}


# ══════════════════════════════════════════════════════════════════════════════
# DARK SHIP DETECTOR — AIS gap detection
# ══════════════════════════════════════════════════════════════════════════════

class DarkShipDetector:
    """
    Detects vessels that disappear from AIS while underway (transponder gap).

    Maintains last_seen[mmsi] = {timestamp, lat, lon, speed, name, region_id}
    Scans every cycle for vessels not updated in >= min_gap_minutes.
    """

    def __init__(self):
        # mmsi → {timestamp, lat, lon, speed, name, region_id, alerted_at}
        self._last_seen: dict = {}

    def update(self, vessels: dict, now: datetime, region_fn=None) -> None:
        """Update last-seen from current AIS snapshot."""
        for mmsi, v in vessels.items():
            if not (v.get("lat") and v.get("lng")):
                continue
            lat = v["lat"]
            lon = v.get("lng") or v.get("lon", 0)
            region_id = region_fn(lat, lon) if region_fn else None
            self._last_seen[str(mmsi)] = {
                "timestamp": now,
                "lat":       lat,
                "lon":       lon,
                "speed":     float(v.get("speed") or 0),
                "name":      v.get("name") or str(mmsi),
                "region_id": region_id,
                "alerted_at": self._last_seen.get(str(mmsi), {}).get("alerted_at"),
            }

    def scan(self, rules: list, now: datetime, active_mmsis: set) -> list:
        """
        Scan for vessels absent from the live feed for >= min_gap_minutes.
        active_mmsis: set of mmsi strings currently visible in AIS feed.
        """
        alerts: list = []

        for rule in rules:
            if not rule.get("enabled", True):
                continue
            params          = rule.get("params", {})
            min_gap_min     = float(params.get("min_gap_minutes", 60))
            min_speed_before = float(params.get("min_speed_before_gap", 1.0))
            target_region   = str(params.get("last_known_region", "ALL")).upper()

            for mmsi, state in list(self._last_seen.items()):
                if mmsi in active_mmsis:
                    continue  # Still visible — not dark

                last_ts = state["timestamp"]
                gap_min = (now - last_ts).total_seconds() / 60.0

                if gap_min < min_gap_min:
                    continue

                # Filter: must have been moving before going dark
                if state["speed"] < min_speed_before:
                    continue

                # Filter: region scope
                if target_region != "ALL":
                    if (state.get("region_id") or "").upper() != target_region:
                        continue

                # Don't re-alert the same vessel for the same gap event
                alerted_at = state.get("alerted_at")
                if alerted_at and (now - alerted_at).total_seconds() / 60.0 < min_gap_min * 2:
                    continue

                self._last_seen[mmsi]["alerted_at"] = now
                alerts.append({
                    "id":           f"dark_{int(now.timestamp()*1000)}_{mmsi}",
                    "rule_id":      rule.get("id"),
                    "rule_name":    "AIS_DARK_SHIP",
                    "rule_trigger": "AIS_DARK_SHIP",
                    "source":       "AIS",
                    "severity":     "high",
                    "icon_type":    "DARK_SHIP",
                    "vessel":       state["name"],
                    "mmsi":         mmsi,
                    "lat":          state["lat"],
                    "lng":          state["lon"],
                    "speed":        state["speed"],
                    "message": (
                        f"Dark ship: {state['name']} — no AIS signal for {gap_min:.0f} min. "
                        f"Last position: {state['lat']:.3f}, {state['lon']:.3f} "
                        f"(region {state.get('region_id', '?')}). "
                        f"Last speed: {state['speed']:.1f} kn."
                    ),
                    "timestamp":    now.isoformat(),
                    "gap_minutes":  round(gap_min, 1),
                    "provenance": {
                        "source_type":    "AIS",
                        "detection_rule": "AIS_DARK_SHIP",
                        "trigger_reason": "AIS_DARK_SHIP",
                    },
                })

        return alerts

    def purge_stale(self, now: datetime, max_age_hours: float = 48.0) -> None:
        cutoff = now - timedelta(hours=max_age_hours)
        self._last_seen = {k: v for k, v in self._last_seen.items() if v["timestamp"] >= cutoff}


# ══════════════════════════════════════════════════════════════════════════════
# CORRELATION ENGINE (unchanged public interface)
# ══════════════════════════════════════════════════════════════════════════════

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
        assessments = []

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

        clusters = self._cluster_by_proximity(all_signals, radius_km=100)
        for cluster in clusters:
            if len(cluster) < 2:
                continue
            domains = set(s["source"] for s in cluster)
            if len(domains) >= 2:
                assessment = self._assess_cluster(cluster, domains, ontology)
                if assessment:
                    assessments.append(assessment)

        assessments.extend(self._detect_temporal_sequences(all_signals))
        assessments.extend(self._check_entity_reputation(ais_alerts))
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

        severities = [s.get("severity", "low") for s in cluster]
        avg_sev = sum(SEV_SCORES.get(sv, 1) for sv in severities) / len(severities)

        if "AIS" in domains and "ADSB" in domains:   avg_sev += 1.0
        if "NEWS" in domains and avg_sev >= 2:        avg_sev += 0.5

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
            if domain == "AIS":    parts.append(f"Maritime: {len(dsigs)} vessel anomalies")
            elif domain == "ADSB": parts.append(f"Aviation: {len(dsigs)} aircraft activities")
            elif domain == "NEWS": parts.append(f"OSINT: {len(dsigs)} news events")
            elif domain == "SAT":  parts.append(f"Satellite: {len(dsigs)} imagery changes")

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

        for key, region_signals in grid.items():
            if len(region_signals) < 3:
                continue
            sorted_sigs = sorted(region_signals, key=lambda x: x.get("timestamp", ""))
            scores = [SEV_SCORES.get(s.get("severity", "low"), 1) for s in sorted_sigs]
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
            if "AIS" in domains:  recs.append("Task maritime patrol asset for close monitoring.")
            if "ADSB" in domains: recs.append("Alert air defense coordination centre.")
            if "NEWS" in domains: recs.append("Monitor open-source media for escalation indicators.")
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


# ── Module-level haversine (metres) used by STS/Dark detectors ───────────────

def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(min(a, 1.0)))
