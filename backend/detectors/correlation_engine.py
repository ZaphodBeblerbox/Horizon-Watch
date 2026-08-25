"""
Cross-domain intelligence correlation engine.
Takes signals from all detectors and produces correlated assessments.

Also contains:
- EscalationEngine      — per-vessel multi-rule chaining (dual / triple escalation)
- DarkShipDetector      — AIS gap / dark-ship detection
- ADSBLoiterDetector    — ADS-B aircraft loitering near airport
- NewsPatternEngine     — rolling article buffer, NEWS_PATTERN rule evaluation
"""
from datetime import datetime, timezone, timedelta
import math
import uuid
import json

# ── Sanctions vessel detection ────────────────────────────────────────────────
_sanctions_alert_cooldown: dict = {}  # mmsi → datetime of last fire


def _check_sanctions_hit(mmsi: str, vessel: dict) -> "dict | None":
    try:
        from sanctions_loader import sanctions_loader as _sl
    except ImportError:
        return None
    hit = _sl.check_vessel(mmsi=mmsi)
    if not hit:
        return None
    now = datetime.utcnow()
    last_fired = _sanctions_alert_cooldown.get(mmsi)
    if last_fired and (now - last_fired).total_seconds() < 6 * 3600:
        return None
    _sanctions_alert_cooldown[mmsi] = now
    name = vessel.get("name") or vessel.get("vessel_name") or mmsi
    lat  = float(vessel.get("lat") or 0)
    lon  = float(vessel.get("lon") or vessel.get("lng") or 0)
    flag = vessel.get("flag") or vessel.get("country") or hit.get("flag") or "unknown"
    return {
        "rule_id":        "SANCTIONS_VESSEL_DETECTED",
        "alert_category": "SANCTIONS_VIOLATION",
        "mmsi":           mmsi,
        "vessel_name":    name,
        "title":          f"Sanctioned Vessel: {name}",
        "description": (
            f"{name} ({mmsi}) — sanctioned vessel transmitting AIS at "
            f"{lat:.3f}, {lon:.3f}. Flag: {flag}."
        ),
        "lat":            lat,
        "lon":            lon,
        "severity":       "critical",
        "sanctions_hit":  True,
        "timestamp":      now.isoformat(),
    }


# ══════════════════════════════════════════════════════════════════════════════
# NEWS PATTERN REGISTRY
# ══════════════════════════════════════════════════════════════════════════════

NEWS_PATTERNS = {
    "RISING_TENSIONS": {
        "description":       "Multiple conflict/military articles about same location",
        "default_article_types": ["conflict", "aviation"],
        "default_threshold": 5,
        "default_timeframe": 6,
        "default_min_relevance": 6.0,
        "severity":          "high",
        "marker_type":       "RISING_TENSIONS",
        "headline_template": "Rising tensions detected — {location}",
        "summary_template":  "{count} conflict-related articles in {timeframe}h mentioning {location}. Sources: {source_list}",
    },
    "PORT_DISRUPTION": {
        "description":       "Multiple maritime articles mentioning same port",
        "default_article_types": ["maritime", "infrastructure"],
        "default_threshold": 3,
        "default_timeframe": 12,
        "default_min_relevance": 5.0,
        "default_keywords": ["port", "terminal", "shipping", "vessel", "cargo",
                             "blockade", "closure", "attack"],
        "severity":          "high",
        "marker_type":       "PORT_DISRUPTION",
        "headline_template": "Port disruption signals — {location}",
        "summary_template":  "{count} maritime articles in {timeframe}h mentioning {location}.",
    },
    "INFRASTRUCTURE_THREAT": {
        "description":       "Articles mentioning attacks or damage to infrastructure",
        "default_article_types": ["infrastructure", "energy", "cyber"],
        "default_threshold": 2,
        "default_timeframe": 6,
        "default_min_relevance": 7.0,
        "default_keywords": ["attack", "damage", "destroyed", "sabotage",
                             "explosion", "fire", "outage", "pipeline", "cable", "power"],
        "severity":          "high",
        "marker_type":       "INFRASTRUCTURE_THREAT",
        "headline_template": "Infrastructure threat signals — {location}",
        "summary_template":  "{count} infrastructure-related articles in {timeframe}h flagging {location}.",
    },
    "ESCALATION_SPIKE": {
        "description":       "Sudden surge in article volume about a region",
        "default_article_types": ["conflict", "political", "maritime"],
        "default_threshold": 10,
        "default_timeframe": 3,
        "default_min_relevance": 5.0,
        "severity":          "critical",
        "marker_type":       "ESCALATION_SPIKE",
        "headline_template": "Escalation spike detected — {location}",
        "summary_template":  "{count} articles in {timeframe}h — significant volume increase for {location}.",
    },
    "SANCTIONS_PRESSURE": {
        "description":       "Multiple articles about sanctions targeting same country",
        "default_article_types": ["political", "economic"],
        "default_threshold": 4,
        "default_timeframe": 24,
        "default_min_relevance": 5.0,
        "default_keywords": ["sanction", "embargo", "restriction", "ban",
                             "freeze", "penalty", "tariff"],
        "severity":          "medium",
        "marker_type":       "SANCTIONS_PRESSURE",
        "headline_template": "Sanctions pressure — {location}",
        "summary_template":  "{count} sanctions-related articles in {timeframe}h targeting {location}.",
    },
    "MILITARY_MOBILISATION": {
        "description":       "Articles mentioning troop movements or military buildup",
        "default_article_types": ["conflict", "political"],
        "default_threshold": 3,
        "default_timeframe": 12,
        "default_min_relevance": 7.0,
        "default_keywords": ["troops", "military", "forces", "deploy", "mobilise",
                             "mobilize", "exercise", "drill", "warship", "aircraft carrier",
                             "buildup", "reinforcement", "battalion", "regiment"],
        "severity":          "high",
        "marker_type":       "MILITARY_MOBILISATION",
        "headline_template": "Military mobilisation signals — {location}",
        "summary_template":  "{count} mobilisation-related articles in {timeframe}h for {location}.",
    },
    "HUMANITARIAN_CRISIS": {
        "description":       "Articles mentioning civilian casualties or displacement",
        "default_article_types": ["conflict", "disaster"],
        "default_threshold": 4,
        "default_timeframe": 24,
        "default_min_relevance": 6.0,
        "default_keywords": ["civilian", "casualties", "displaced", "refugees",
                             "famine", "humanitarian", "aid", "evacuation", "massacre"],
        "severity":          "high",
        "marker_type":       "HUMANITARIAN_CRISIS",
        "headline_template": "Humanitarian crisis signals — {location}",
        "summary_template":  "{count} humanitarian articles in {timeframe}h covering {location}.",
    },
    "CEASEFIRE_BREAKDOWN": {
        "description":       "Articles suggesting peace process failing or ceasefire violated",
        "default_article_types": ["conflict", "political"],
        "default_threshold": 3,
        "default_timeframe": 6,
        "default_min_relevance": 7.0,
        "default_keywords": ["ceasefire", "peace talks", "violation", "collapsed",
                             "breakdown", "resumed fighting", "offensive"],
        "severity":          "critical",
        "marker_type":       "CEASEFIRE_BREAKDOWN",
        "headline_template": "Ceasefire breakdown signals — {location}",
        "summary_template":  "{count} ceasefire-related articles in {timeframe}h flagging {location}.",
    },
    "ENERGY_SUPPLY_RISK": {
        "description":       "Articles suggesting threat to energy supply chains",
        "default_article_types": ["energy", "maritime", "infrastructure"],
        "default_threshold": 3,
        "default_timeframe": 12,
        "default_min_relevance": 6.0,
        "default_keywords": ["oil", "gas", "LNG", "pipeline", "refinery",
                             "tanker", "supply", "shortage", "disruption", "export", "OPEC"],
        "severity":          "medium",
        "marker_type":       "ENERGY_SUPPLY_RISK",
        "headline_template": "Energy supply risk signals — {location}",
        "summary_template":  "{count} energy-supply articles in {timeframe}h flagging {location}.",
    },
}


# ══════════════════════════════════════════════════════════════════════════════
# NEWS PATTERN ENGINE
# ══════════════════════════════════════════════════════════════════════════════

class NewsPatternEngine:
    """
    Maintains a rolling 72-hour article buffer keyed by location_country.
    On each ingested article, evaluates all enabled NEWS_PATTERN rules.
    When a pattern threshold is met (and not in cooldown), calls the fire callback.
    """

    BUFFER_MAX_AGE_HOURS = 72

    def __init__(self):
        # location_key (ISO2 or region_id) → [ article_dict, ... ]
        self._buffer: dict = {}
        # (rule_id, location) → datetime when cooldown expires
        self._cooldowns: dict = {}
        # Active rule list (loaded externally via reload_rules)
        self._rules: list = []
        # Callback invoked on pattern fire: fn(rule, matching, location, trigger_article)
        self._on_fire = None

    def set_fire_callback(self, fn) -> None:
        self._on_fire = fn

    def reload_rules(self, rules: list) -> None:
        """Replace the active NEWS_PATTERN rule list."""
        self._rules = [
            r for r in rules
            if (r.get("trigger_type") or r.get("rule_name")) == "NEWS_PATTERN"
            and r.get("enabled", True)
        ]

    def on_article_ingested(self, article: dict) -> None:
        """Called for every fully-processed article (has article_type + coords)."""
        self._add_to_buffer(article)
        for rule in self._rules:
            try:
                self._check_pattern(rule, article)
            except Exception as _e:
                pass  # Never crash the ingestion pipeline

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _add_to_buffer(self, article: dict) -> None:
        """Add article to buffer under its location_country key. Prune stale."""
        country = (
            article.get("location_country")
            or article.get("resolved_country_code")
            or ""
        ).lower().strip()
        if not country:
            return

        now = datetime.utcnow()
        entry = {
            "ingested_at":    now,
            "location_country": country,
            "article_type":   (article.get("article_type") or "other").lower(),
            "relevance_score": float(article.get("llm_relevance_score") or 0),
            "title":          article.get("title") or "",
            "source":         article.get("source") or "",
            "url":            article.get("url") or "",
            "summary":        (article.get("summary") or "")[:200],
            "lat":            article.get("lat"),
            "lon":            article.get("lon"),
        }

        bucket = self._buffer.setdefault(country, [])
        bucket.append(entry)

        # Prune articles older than BUFFER_MAX_AGE_HOURS
        cutoff = now - timedelta(hours=self.BUFFER_MAX_AGE_HOURS)
        self._buffer[country] = [a for a in bucket if a["ingested_at"] >= cutoff]

    def _check_pattern(self, rule: dict, trigger_article: dict) -> None:
        params = rule.get("params") or {}
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except Exception:
                return

        pattern_type   = params.get("pattern_type")
        if not pattern_type or pattern_type not in NEWS_PATTERNS:
            return

        location_scope  = params.get("location_scope", "ALL")
        timeframe_hours = int(params.get("timeframe_hours",
                              NEWS_PATTERNS[pattern_type].get("default_timeframe", 24)))
        threshold       = int(params.get("article_count_threshold",
                              NEWS_PATTERNS[pattern_type].get("default_threshold", 3)))
        min_relevance   = float(params.get("min_relevance_score",
                                NEWS_PATTERNS[pattern_type].get("default_min_relevance", 5.0)))
        article_types   = params.get("article_types",
                          NEWS_PATTERNS[pattern_type].get("default_article_types", []))
        kw_required     = params.get("keywords_required",
                          NEWS_PATTERNS[pattern_type].get("default_keywords"))
        kw_excluded     = params.get("keywords_excluded") or []

        location = self._resolve_scope(location_scope, trigger_article)
        if not location:
            return

        # Check cooldown
        cooldown_hours = int(params.get("cooldown_hours", 2))
        cd_key = (str(rule.get("id") or rule.get("rule_name")), location)
        if cd_key in self._cooldowns and datetime.utcnow() < self._cooldowns[cd_key]:
            return

        # Filter buffer
        cutoff = datetime.utcnow() - timedelta(hours=timeframe_hours)
        bucket = self._buffer.get(location.lower(), [])

        matching = [
            a for a in bucket
            if a["ingested_at"] >= cutoff
            and a["relevance_score"] >= min_relevance
            and (not article_types or a["article_type"] in [t.lower() for t in article_types])
            and self._matches_keywords(a, kw_required, kw_excluded)
        ]

        if len(matching) < threshold:
            return

        # Fire
        if self._on_fire:
            self._on_fire(rule, matching, location, trigger_article)

        # Set cooldown
        self._cooldowns[cd_key] = datetime.utcnow() + timedelta(hours=cooldown_hours)

    @staticmethod
    def _resolve_scope(scope: str, article: dict) -> str | None:
        if scope == "ALL":
            return (
                article.get("location_country")
                or article.get("resolved_country_code")
                or ""
            ).lower().strip() or None
        if scope.startswith("COUNTRY:"):
            return scope.split(":", 1)[1].lower().strip()
        if scope.startswith("REGION:"):
            return scope.split(":", 1)[1].lower().strip()
        return None

    @staticmethod
    def _matches_keywords(article: dict, required: list | None, excluded: list | None) -> bool:
        if not required and not excluded:
            return True
        text = (article.get("title", "") + " " + article.get("summary", "")).lower()
        if excluded:
            for kw in excluded:
                if kw.lower() in text:
                    return False
        if required:
            return any(kw.lower() in text for kw in required)
        return True


# Module-level singleton used by main.py
news_pattern_engine = NewsPatternEngine()


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
    When 2+ distinct rules fire on the same vessel within a time window,
    emit one escalated combined alert.

    Chains loaded from EscalationChain DB table define specific escalation
    profiles (icon_type, severity, window).  Falls back to generic
    ESCALATED_DUAL / ESCALATED_TRIPLE when no chain matches.
    """

    DEFAULT_WINDOW_MINUTES = 30

    def __init__(self):
        # mmsi → list of {rule_id, rule_name, icon_type, severity, fired_at, alert_id}
        self._active: dict = {}
        # List of chain dicts: {rule_id_set, escalated_severity, escalated_icon_type, window_min}
        self._chains: list = []

    def reload_chains(self, chains: list) -> None:
        """
        Replace the active chain list.
        Each chain dict must have: rule_ids (comma-str or list), escalated_severity,
        escalated_icon_type, time_window_minutes.
        """
        parsed = []
        for c in chains:
            rid_raw = c.get("rule_ids", "")
            if isinstance(rid_raw, str):
                rid_set = {r.strip() for r in rid_raw.split(",") if r.strip()}
            else:
                rid_set = {str(r) for r in rid_raw}
            parsed.append({
                "rule_id_set":          rid_set,
                "name":                 c.get("chain_name", ""),
                "escalated_severity":   c.get("escalated_severity", "critical"),
                "escalated_icon_type":  c.get("escalated_icon_type", "ESCALATED_DUAL"),
                "window_min":           int(c.get("time_window_minutes") or self.DEFAULT_WINDOW_MINUTES),
            })
        self._chains = parsed

    def process(self, alerts: list, now: datetime) -> list:
        """
        Process a batch of new alerts through the escalation logic.
        Returns the final list of alerts to emit (individual or escalated).
        """
        if not alerts:
            return []

        # Determine window: use minimum chain window if chains loaded
        window_min = self.DEFAULT_WINDOW_MINUTES
        if self._chains:
            window_min = min(c["window_min"] for c in self._chains)
        cutoff = now - timedelta(minutes=window_min)

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
                rule_id   = str(a.get("rule_id") or "")
                self._active.setdefault(mmsi, []).append({
                    "rule_id":   rule_id,
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

            if count < 2:
                final_alerts.extend(vessel_alerts)
                continue

            # Try to find a matching chain
            active_rule_ids = {e["rule_id"] for e in active if e["rule_id"]}
            matched_chain = self._best_chain(active_rule_ids, now)

            for a in vessel_alerts:
                suppressed_ids.add(a.get("id", ""))

            rule_names_str = " + ".join(r["rule_name"] for r in distinct_rules[:3])
            sample = vessel_alerts[0]

            if matched_chain:
                icon_type = matched_chain["escalated_icon_type"]
                severity  = matched_chain["escalated_severity"]
                chain_name = matched_chain["name"]
                title = (
                    f"{sample.get('vessel', mmsi)} — {chain_name}: "
                    f"{rule_names_str}"
                )
                body = (
                    f"Escalation chain '{chain_name}' triggered within "
                    f"{matched_chain['window_min']} min: {rule_names_str}"
                )
            elif count == 2:
                icon_type = "ESCALATED_DUAL"
                r1, r2   = distinct_rules[0], distinct_rules[1]
                max_sev  = max(SEV_SCORES.get(r["severity"], 1) for r in distinct_rules)
                severity = _escalate_severity(SEV_NAMES.get(max_sev, "medium"))
                title = f"{sample.get('vessel', mmsi)} — dual anomaly: {r1['rule_name']} + {r2['rule_name']}"
                body  = (
                    f"Two simultaneous detection rules fired within {window_min} min: "
                    f"{r1['rule_name']} and {r2['rule_name']}"
                )
            else:
                icon_type = "ESCALATED_TRIPLE"
                severity  = "critical"
                title = f"{sample.get('vessel', mmsi)} — triple anomaly: {rule_names_str}"
                body  = (
                    f"{count} simultaneous detection rules fired within {window_min} min: "
                    f"{rule_names_str}"
                )

            final_alerts.append(self._make_escalated(icon_type, title, body, severity, sample, now))

        # Also pass alerts with no mmsi through unchanged
        for a in alerts:
            if not (a.get("mmsi") or a.get("vessel")):
                final_alerts.append(a)

        return [a for a in final_alerts if a.get("id", "") not in suppressed_ids]

    def _best_chain(self, active_rule_ids: set, now: datetime):
        """Return the chain with the most overlapping rule_ids, or None."""
        if not self._chains or not active_rule_ids:
            return None
        best = None
        best_overlap = 0
        for c in self._chains:
            overlap = len(c["rule_id_set"] & active_rule_ids)
            # Chain triggers only when ≥2 of its rules are represented
            if overlap >= 2 and overlap > best_overlap:
                best_overlap = overlap
                best = c
        return best

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

        # Sanctions check — runs on ALL known vessels (active and dark)
        for mmsi, state in list(self._last_seen.items()):
            sanction_alert = _check_sanctions_hit(mmsi, {
                "name": state["name"],
                "lat":  state["lat"],
                "lon":  state["lon"],
            })
            if sanction_alert:
                alerts.append(sanction_alert)

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


# ══════════════════════════════════════════════════════════════════════════════
# ADSB LOITER DETECTOR
# ══════════════════════════════════════════════════════════════════════════════

class ADSBLoiterDetector:
    """
    Detects ADS-B aircraft loitering near airports.

    Rule trigger_type: "ADSB_LOITERING_NEAR_AIRPORT"
    Rule params:
        target            str   "ALL" | "REGION:<region_id>" | "ID:<system_id>"
        airport_types     list  e.g. ["large_airport", "medium_airport"]
        proximity_km      float aircraft must be within this distance
        min_duration_minutes int  must be continuously tracked this long
        max_speed_knots   float  aircraft must be slow (circling)
    """

    def __init__(self):
        # (icao24, airport_system_id) → {first_within, last_within, alerted_at}
        self._tracking: dict = {}

    def check(
        self,
        aircraft: dict,           # {icao24: {lat, lon, speed (kts), callsign, …}}
        rules: list,
        now: datetime,
        airports_fn=None,         # callable(region_id=None, types=None) → list of airport dicts
    ) -> list:
        alerts = []
        if not rules or airports_fn is None:
            return alerts

        for rule in rules:
            params       = rule.get("params", {})
            target       = params.get("target", "ALL")
            apt_types    = params.get("airport_types") or []
            prox_km      = float(params.get("proximity_km", 5.0))
            min_dur_min  = float(params.get("min_duration_minutes", 20))
            max_spd      = float(params.get("max_speed_knots", 200))

            # Resolve region / single-ID scope
            region_filter = None
            single_id     = None
            if target.startswith("REGION:"):
                region_filter = target.split(":", 1)[1]
            elif target.startswith("ID:"):
                single_id = target.split(":", 1)[1]

            airports = airports_fn(region_id=region_filter, types=apt_types or None)
            if single_id:
                airports = [a for a in airports if a.get("system_id") == single_id
                            or a.get("ident") == single_id or a.get("icao_code") == single_id]

            for icao24, ac in aircraft.items():
                try:
                    ac_lat   = float(ac.get("lat") or ac.get("latitude") or 0)
                    ac_lon   = float(ac.get("lon") or ac.get("longitude") or ac.get("lng") or 0)
                    ac_spd   = float(ac.get("speed") or ac.get("velocity") or 0)
                    callsign = (ac.get("callsign") or icao24).strip()
                except (TypeError, ValueError):
                    continue

                # An aircraft with no reported position (e.g. a fresh cache
                # entry seen before its first position report, or a feed row
                # that only carries identity fields) falls through every
                # `or 0` above to lat=0, lon=0 — Null Island, in the Gulf of
                # Guinea. Treating that as a real fix would let it "loiter
                # near" any airport that happens to sit close to (0, 0).
                # Skip aircraft with no real position instead of correlating
                # them against a fabricated one.
                if ac_lat == 0 and ac_lon == 0:
                    continue

                if ac_spd > max_spd:
                    continue

                for apt in airports:
                    apt_lat = float(apt.get("lat") or apt.get("latitude") or 0)
                    apt_lon = float(apt.get("lon") or apt.get("longitude") or 0)
                    dist_km = _haversine_m(ac_lat, ac_lon, apt_lat, apt_lon) / 1000.0

                    if dist_km > prox_km:
                        # Outside proximity — remove tracking entry
                        self._tracking.pop((icao24, apt["system_id"]), None)
                        continue

                    key = (icao24, apt["system_id"])
                    state = self._tracking.get(key)
                    if state is None:
                        self._tracking[key] = {
                            "first_within": now,
                            "last_within":  now,
                            "alerted_at":   None,
                        }
                        continue

                    state["last_within"] = now
                    duration_min = (now - state["first_within"]).total_seconds() / 60.0

                    if duration_min < min_dur_min:
                        continue

                    # Re-alert suppression: once per 2× min_duration window
                    if state["alerted_at"] is not None:
                        since_alert = (now - state["alerted_at"]).total_seconds() / 60.0
                        if since_alert < min_dur_min * 2:
                            continue

                    state["alerted_at"] = now
                    apt_name = apt.get("airport_name") or apt.get("name") or apt["system_id"]
                    icao_code = apt.get("icao_code") or apt.get("ident") or ""
                    alerts.append({
                        "id":           str(uuid.uuid4()),
                        "rule_id":      rule.get("id"),
                        "rule_name":    rule.get("rule_name", "ADSB_LOITERING_NEAR_AIRPORT"),
                        "source":       "ADSB",
                        "icon_type":    params.get("icon_type", "LOITERING_INFRA"),
                        "trigger_type": "ADSB_LOITERING_NEAR_AIRPORT",
                        "severity":     rule.get("severity", "high"),
                        "title":        f"{callsign} loitering near {apt_name}",
                        "message": (
                            f"Aircraft {icao24} within {dist_km:.1f}km of "
                            f"{apt_name} ({icao_code}) for "
                            f"{duration_min:.0f} min at {ac_spd:.0f} kts"
                        ),
                        "mmsi":         None,
                        "icao24":       icao24,
                        "callsign":     callsign,
                        "lat":          ac_lat,
                        "lng":          ac_lon,
                        "airport_system_id": apt["system_id"],
                        "airport_name":      apt_name,
                        "airport_icao":      icao_code,
                        "distance_km":       round(dist_km, 2),
                        "duration_minutes":  round(duration_min, 1),
                        "timestamp":    now.isoformat(),
                        "provenance": {
                            "source_type":      "ADSB",
                            "source_entity":    icao24,
                            "detection_rule":   rule.get("rule_name"),
                            "trigger_reason":   "ADSB_LOITERING_NEAR_AIRPORT",
                            "params_at_trigger": params,
                        },
                    })

        return alerts

    def purge_stale(self, now: datetime, max_gap_minutes: float = 30.0) -> None:
        cutoff = now - timedelta(minutes=max_gap_minutes)
        stale = [k for k, v in self._tracking.items() if v["last_within"] < cutoff]
        for k in stale:
            del self._tracking[k]


# ══════════════════════════════════════════════════════════════════════════════
# CHOKEPOINT ACTIVITY DETECTOR — transit and loitering inside strategic polygons
# ══════════════════════════════════════════════════════════════════════════════

class ChokepointActivityDetector:
    """
    Detects vessels transiting or loitering inside strategic chokepoint polygons.

    Rule trigger_type: AIS_CHOKEPOINT_ACTIVITY
    Rule params:
        target                       "ALL" | "ID:CHOKE-001" | comma-sep IDs
        monitor_transit              bool  — fire once on polygon entry
        monitor_loitering            bool  — fire when slow inside polygon long enough
        min_loiter_duration_minutes  int
        max_loiter_speed_knots       float
        vessel_types                 list|null  e.g. ["Tanker", "Unknown"]
        flag_states                  list|str|null  ISO-2 codes
    """

    def __init__(self):
        # (mmsi, choke_system_id) → {first_seen, last_seen, transit_alerted, loiter_alerted_at}
        self._inside: dict = {}

    def check(
        self,
        vessels: dict,      # {mmsi: normalized vessel dict}
        rules: list,
        chokepoints: list,  # _CHOKEPOINT_DEFS entries
        now: datetime,
    ) -> list:
        try:
            from shapely.geometry import Point, Polygon as _Polygon
        except ImportError:
            return []

        alerts: list = []
        if not rules or not chokepoints:
            return alerts

        # Build shapely polygon cache {system_id: Polygon}
        poly_cache: dict = {}
        for cp in chokepoints:
            sid      = cp.get("system_id")
            raw_poly = cp.get("polygon")
            if not sid or not raw_poly or len(raw_poly) < 3:
                continue
            try:
                # _CHOKEPOINT_DEFS polygon is [[lat, lon], ...] — shapely wants (lon, lat)
                poly_cache[sid] = _Polygon([(c[1], c[0]) for c in raw_poly])
            except Exception:
                pass

        for rule in rules:
            if not rule.get("enabled", True):
                continue
            params            = rule.get("params", {})
            target            = str(params.get("target", "ALL"))
            monitor_transit   = bool(params.get("monitor_transit", True))
            monitor_loitering = bool(params.get("monitor_loitering", False))
            min_loiter_min    = float(params.get("min_loiter_duration_minutes", 45))
            max_loiter_spd    = float(params.get("max_loiter_speed_knots", 1.0))
            vessel_types      = params.get("vessel_types") or None
            flag_filter       = params.get("flag_states") or None
            if isinstance(flag_filter, str):
                flag_filter = [f.strip() for f in flag_filter.split(",") if f.strip()]
            rule_severity = rule.get("severity", "medium")
            rule_id       = rule.get("id")

            in_scope = self._resolve_scope(target, list(poly_cache.keys()))

            for mmsi, vessel in vessels.items():
                try:
                    v_lat   = float(vessel.get("lat") or 0)
                    v_lon   = float(vessel.get("lng") or vessel.get("lon") or 0)
                    v_speed = float(vessel.get("speed") or 0)
                except (TypeError, ValueError):
                    continue
                if not v_lat or not v_lon:
                    continue

                v_type = (vessel.get("ship_type_text") or vessel.get("type") or "").strip()
                v_flag = (vessel.get("flag") or "").strip().upper()
                v_name = vessel.get("name") or str(mmsi)

                if vessel_types and not any(vt.lower() in v_type.lower() for vt in vessel_types):
                    continue
                if flag_filter and v_flag not in [f.upper() for f in flag_filter]:
                    continue

                pt = Point(v_lon, v_lat)

                for sid in in_scope:
                    poly = poly_cache.get(sid)
                    if poly is None:
                        continue

                    inside = poly.contains(pt)
                    key    = (str(mmsi), sid)

                    if not inside:
                        self._inside.pop(key, None)
                        continue

                    state = self._inside.get(key)
                    if state is None:
                        state = {
                            "first_seen":      now,
                            "last_seen":       now,
                            "transit_alerted": False,
                            "loiter_alerted_at": None,
                        }
                        self._inside[key] = state
                    state["last_seen"] = now

                    cp = next((c for c in chokepoints if c.get("system_id") == sid), {})

                    if monitor_transit and not state["transit_alerted"]:
                        state["transit_alerted"] = True
                        alerts.append(self._make_alert(
                            "CHOKEPOINT_TRANSIT", rule_id, rule_severity,
                            mmsi, v_name, v_lat, v_lon, v_speed, cp, now,
                            f"{v_name} entered {cp.get('name', sid)} "
                            f"({v_type or 'vessel'}, {v_speed:.1f} kn)",
                        ))

                    if monitor_loitering and v_speed <= max_loiter_spd:
                        dur_min    = (now - state["first_seen"]).total_seconds() / 60.0
                        alerted_at = state.get("loiter_alerted_at")
                        if dur_min >= min_loiter_min and (
                            alerted_at is None
                            or (now - alerted_at).total_seconds() / 60.0 >= min_loiter_min * 2
                        ):
                            state["loiter_alerted_at"] = now
                            alerts.append(self._make_alert(
                                "CHOKEPOINT_LOITER", rule_id, rule_severity,
                                mmsi, v_name, v_lat, v_lon, v_speed, cp, now,
                                f"{v_name} loitering in {cp.get('name', sid)}: "
                                f"{dur_min:.0f} min at {v_speed:.1f} kn",
                            ))

        return alerts

    def purge_stale(self, now: datetime, max_gap_minutes: float = 120.0) -> None:
        cutoff = now - timedelta(minutes=max_gap_minutes)
        stale  = [k for k, v in self._inside.items() if v["last_seen"] < cutoff]
        for k in stale:
            del self._inside[k]

    @staticmethod
    def _resolve_scope(target: str, all_ids: list) -> list:
        if target.strip().upper() == "ALL":
            return all_ids
        resolved = []
        for part in target.split(","):
            part = part.strip()
            if part.upper().startswith("ID:"):
                resolved.append(part[3:].strip())
            else:
                resolved.append(part)
        return [sid for sid in resolved if sid in all_ids]

    @staticmethod
    def _make_alert(
        icon_type: str, rule_id, severity: str,
        mmsi, vessel_name: str, lat: float, lon: float, speed: float,
        cp: dict, now: datetime, message: str,
    ) -> dict:
        label = "Transit" if icon_type == "CHOKEPOINT_TRANSIT" else "Loitering"
        return {
            "id":           f"choke_{icon_type.lower()}_{int(now.timestamp()*1000)}_{mmsi}",
            "rule_id":      rule_id,
            "rule_name":    "AIS_CHOKEPOINT_ACTIVITY",
            "rule_trigger": "AIS_CHOKEPOINT_ACTIVITY",
            "source":       "AIS",
            "icon_type":    icon_type,
            "severity":     severity,
            "vessel":       vessel_name,
            "mmsi":         mmsi,
            "lat":          lat,
            "lng":          lon,
            "speed":        speed,
            "chokepoint_system_id": cp.get("system_id"),
            "chokepoint_name":      cp.get("name"),
            "message":      message,
            "title":        f"Chokepoint {label} — {cp.get('name', '')}",
            "timestamp":    now.isoformat(),
            "provenance": {
                "source_type":    "AIS",
                "detection_rule": "AIS_CHOKEPOINT_ACTIVITY",
                "trigger_reason": icon_type,
            },
        }


# ══════════════════════════════════════════════════════════════════════════════
# AIS SPOOFING / MMSI-INTEGRITY DETECTOR
# ══════════════════════════════════════════════════════════════════════════════

class AISSpoofingDetector:
    """
    Flags two kinds of AIS integrity anomaly for a given MMSI, comparing this
    detection cycle's normalized snapshot against the previous cycle's
    (~5 minute cadence — this compares cycle-to-cycle snapshots, NOT raw
    per-message websocket deltas):

      1. Position jump — the implied speed between the last two reported
         positions for an MMSI exceeds a physically-impossible threshold
         (default 100 knots — far above any real vessel, including fast
         ferries/hydrofoils which top out around 40-50 knots).
      2. Identity mismatch — the vessel's reported `name` changes between two
         specific, non-placeholder values across consecutive cycles.

    HONEST SCOPE NOTE (read before trusting the alert label): this pipeline
    has a single AIS ingestion path and keeps exactly one "last known
    state" per MMSI — there is no multi-receiver correlation that could
    directly observe two different vessels broadcasting on the same MMSI at
    the same instant. Both failure modes above collapse to the identical
    observable signal in this single last-position/identity cache: a
    discontinuity between consecutive reports for one MMSI. That
    discontinuity is consistent with genuine GPS/AIS spoofing, with two
    distinct physical vessels colliding on a reused or misconfigured MMSI,
    or — more mundanely — a legitimate MMSI reassignment or a garbled
    upstream message. This detector cannot and does not distinguish those
    cases; it surfaces the discontinuity as an "MMSI integrity anomaly" for
    a human to investigate further, and both the alert message and the
    trigger_reason say so rather than overclaiming "spoofing detected".

    Design note: only `name` is used to trigger the identity-mismatch alert.
    `ship_type` is deliberately excluded from the trigger because it commonly
    (and legitimately) updates from an empty/"unknown" default to a real
    value as more static AIS data arrives for a vessel — flagging that
    transition would be a guaranteed false positive on nearly every vessel's
    first few cycles. `name` does not have that problem: `_normalize_vessel`
    only ever fills in a synthetic "MMSI:<n>" placeholder when the real name
    is absent, and that placeholder is treated as non-real (see
    `_is_real_name`) so a name only trips this check when it moves between
    two genuinely different, real-looking values.
    """

    POSITION_JUMP_KNOTS  = 100.0   # generous, false-positive-resistant cutoff
    MIN_ELAPSED_SECONDS  = 30.0    # ignore intervals shorter than this (GPS jitter / duplicate cycle)
    KM_PER_NM            = 1.852

    _PLACEHOLDER_NAMES = {"", "UNKNOWN", "UNKNOWN VESSEL", "N/A", "NONE", "NULL"}

    def __init__(self):
        # mmsi (str) -> {lat, lng, timestamp, name, ship_type}
        self._last: dict = {}

    def check(self, mmsi, vessel: dict, now: datetime) -> list:
        """
        vessel: a _normalize_vessel()-shaped dict (lat, lng, name, ship_type,
                speed, ...) for ONE mmsi, from the current detection cycle.
        Returns a list of alert dicts. Never raises, never returns None.
        """
        try:
            if not vessel.get("lat") or not vessel.get("lng"):
                return []
            mmsi = str(mmsi)
            lat  = vessel["lat"]
            lng  = vessel["lng"]
            name = (vessel.get("name") or "").strip()
            ship_type = (vessel.get("ship_type") or "").strip()

            prev = self._last.get(mmsi)
            alerts: list = []

            if prev is not None:
                elapsed_s = (now - prev["timestamp"]).total_seconds()
                if elapsed_s >= self.MIN_ELAPSED_SECONDS:
                    from scoring import _haversine_km
                    dist_km = _haversine_km(prev["lat"], prev["lng"], lat, lng)
                    implied_knots = (dist_km / (elapsed_s / 3600.0)) / self.KM_PER_NM
                    if implied_knots > self.POSITION_JUMP_KNOTS:
                        alerts.append(self._make_position_alert(
                            mmsi, vessel, prev, dist_km, implied_knots, elapsed_s, now,
                        ))

                if (self._is_real_name(name, mmsi)
                        and self._is_real_name(prev.get("name", ""), mmsi)
                        and not self._same_text(name, prev.get("name", ""))):
                    alerts.append(self._make_identity_alert(mmsi, vessel, prev, now))

            # Record current cycle as the new "previous" regardless of whether
            # anything fired, so drift is tracked continuously rather than reset.
            self._last[mmsi] = {
                "lat": lat, "lng": lng, "timestamp": now,
                "name": name, "ship_type": ship_type,
            }
            return alerts
        except Exception:
            return []

    def purge_stale(self, now: datetime, max_age_hours: float = 48.0) -> None:
        cutoff = now - timedelta(hours=max_age_hours)
        self._last = {k: v for k, v in self._last.items() if v["timestamp"] >= cutoff}

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _same_text(a: str, b: str) -> bool:
        return (a or "").strip().casefold() == (b or "").strip().casefold()

    @classmethod
    def _is_real_name(cls, name: str, mmsi: str) -> bool:
        if not name:
            return False
        n = name.strip().upper()
        if n in cls._PLACEHOLDER_NAMES:
            return False
        if n == f"MMSI:{mmsi}".upper():
            return False
        return True

    @staticmethod
    def _make_position_alert(mmsi, vessel, prev, dist_km, implied_knots, elapsed_s, now) -> dict:
        vname = vessel.get("name") or str(mmsi)
        return {
            "id":           f"aisspoof_jump_{int(now.timestamp()*1000)}_{mmsi}",
            "rule_id":      "AIS_POSITION_JUMP",
            "rule_name":    "AIS_POSITION_JUMP",
            "rule_trigger": "AIS_POSITION_JUMP",
            "source":       "AIS",
            "severity":     "high",
            "icon_type":    "POSITION_JUMP",
            "vessel":       vname,
            "mmsi":         mmsi,
            "lat":          vessel.get("lat"),
            "lng":          vessel.get("lng"),
            "speed":        vessel.get("speed"),
            "message": (
                f"{vname} (MMSI {mmsi}) jumped {dist_km:.1f}km in {elapsed_s:.0f}s "
                f"(implied {implied_knots:.0f} kn) — physically implausible for a "
                f"vessel. MMSI integrity anomaly: consistent with AIS spoofing, "
                f"MMSI reuse by a different vessel, or a data error — not "
                f"distinguishable from this signal alone."
            ),
            "timestamp":    now.isoformat(),
            "provenance": {
                "source_type":    "AIS",
                "source_entity":  mmsi,
                "detection_rule": "AIS_POSITION_JUMP",
                "trigger_reason": "implied_speed_exceeds_threshold",
                "params_at_trigger": {
                    "threshold_knots": AISSpoofingDetector.POSITION_JUMP_KNOTS,
                    "implied_knots":   round(implied_knots, 1),
                    "distance_km":     round(dist_km, 2),
                    "elapsed_seconds": round(elapsed_s, 1),
                    "prev_lat":        prev["lat"],
                    "prev_lng":        prev["lng"],
                },
            },
        }

    @staticmethod
    def _make_identity_alert(mmsi, vessel, prev, now) -> dict:
        vname = vessel.get("name") or str(mmsi)
        prev_name = prev.get("name", "")
        return {
            "id":           f"aisspoof_ident_{int(now.timestamp()*1000)}_{mmsi}",
            "rule_id":      "AIS_IDENTITY_MISMATCH",
            "rule_name":    "AIS_IDENTITY_MISMATCH",
            "rule_trigger": "AIS_IDENTITY_MISMATCH",
            "source":       "AIS",
            "severity":     "high",
            "icon_type":    "IDENTITY_CHANGE",
            "vessel":       vname,
            "mmsi":         mmsi,
            "lat":          vessel.get("lat"),
            "lng":          vessel.get("lng"),
            "speed":        vessel.get("speed"),
            "message": (
                f"MMSI {mmsi} reported name '{prev_name}' last cycle, now reports "
                f"'{vname}'. MMSI integrity anomaly: consistent with AIS spoofing, "
                f"MMSI reuse by a different vessel, or a data error — not "
                f"distinguishable from this signal alone."
            ),
            "timestamp":    now.isoformat(),
            "provenance": {
                "source_type":    "AIS",
                "source_entity":  mmsi,
                "detection_rule": "AIS_IDENTITY_MISMATCH",
                "trigger_reason": "name_changed_between_cycles",
                "params_at_trigger": {
                    "previous_name": prev_name,
                    "current_name":  vname,
                },
            },
        }
