"""
fusion_engine.py — Multi-domain signal correlation and fusion.

FusionEngine:
  - Receives signals from AIS / NEWS / ADSB / SENTINEL rule fires
  - Groups signals by geographic key (region > country > geohash)
  - When 2+ domains + 2+ signals converge, creates a FusionEvent
  - Calls Claude Haiku to generate title, subtitle, narrative, key_signals, threat_indicators
  - Fires a callback (set_fire_callback) so main.py can push to _forge_alerts / SSE

Module-level singleton: fusion_engine = FusionEngine()
"""

import json
import uuid
import math
import datetime
from datetime import timedelta


FUSION_WINDOW_HOURS   = 2
MIN_DOMAINS_FOR_FUSION = 2
MIN_SIGNALS_FOR_FUSION = 2

DOMAIN_COLORS = {
    "AIS":      "#34AADC",
    "NEWS":     "#FF9500",
    "SENTINEL": "#30D158",
    "ADSB":     "#5856D6",
}

SEV_ORDER = {"info": 0, "medium": 1, "high": 2, "critical": 3}
SEV_NAMES = ["info", "medium", "high", "critical"]


def _new_fusion_id() -> str:
    return f"FUSION-{uuid.uuid4().hex[:8].upper()}"


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


class FusionEngine:
    def __init__(self):
        # geo_key → [signal, ...]
        self.active_signals: dict  = {}
        # fusion_id → {fusion_id, title, ...}  (in-memory mirror of DB rows)
        self.active_fusions: dict  = {}
        # signal_id → fusion_id
        self.signal_to_fusion: dict = {}
        # Recent signal log (last 200, for /api/signals/recent)
        self._recent_signals: list = []
        # Fusion settings (mutable by operator)
        self.fusion_window_hours    = FUSION_WINDOW_HOURS
        self.min_domains            = MIN_DOMAINS_FOR_FUSION
        self.min_signals            = MIN_SIGNALS_FOR_FUSION
        # Callback: fn(fusion_dict, suppressed_signal_ids)
        self._fire_callback = None

    def set_fire_callback(self, fn):
        self._fire_callback = fn

    # ── Public API ────────────────────────────────────────────────────────────

    def on_signal(self, signal: dict):
        """
        Call whenever any rule fires an alert or assessment.
        Required keys: signal_id, domain, severity, lat, lon, location_name,
          region_id (nullable), country (nullable), timestamp (datetime),
          assessment_id (nullable), alert_id (nullable), rule_id, rule_name, summary
        """
        signal.setdefault("timestamp", datetime.datetime.utcnow())
        self._log_signal(signal)

        geo_key = self._resolve_geo_key(signal)
        self._add_signal(geo_key, signal)
        self._evaluate_fusion(geo_key)

    def get_recent_signals(self, limit: int = 50) -> list:
        return list(reversed(self._recent_signals[-limit:]))

    def expire_old_signals(self):
        """Prune stale signals and mark DB fusions expired. Call every 15 min."""
        cutoff = datetime.datetime.utcnow() - timedelta(hours=self.fusion_window_hours)
        for geo_key in list(self.active_signals.keys()):
            self.active_signals[geo_key] = [
                s for s in self.active_signals[geo_key]
                if s["timestamp"] > cutoff
            ]
            if not self.active_signals[geo_key]:
                del self.active_signals[geo_key]

        try:
            from database import get_db
            from sqlalchemy import text
            with get_db() as db:
                db.execute(text(
                    "UPDATE fusion_events SET status='expired' "
                    "WHERE expires_at < :now AND status='active'"
                ), {"now": datetime.datetime.utcnow()})
                db.commit()
        except Exception as e:
            print(f"[fusion] expire error: {e}")

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _log_signal(self, signal: dict):
        self._recent_signals.append({
            "signal_id":    signal.get("signal_id"),
            "domain":       signal.get("domain"),
            "severity":     signal.get("severity"),
            "rule_name":    signal.get("rule_name"),
            "location_name": signal.get("location_name"),
            "summary":      signal.get("summary", "")[:120],
            "timestamp":    signal["timestamp"].isoformat() if isinstance(signal["timestamp"], datetime.datetime) else signal["timestamp"],
        })
        if len(self._recent_signals) > 200:
            self._recent_signals = self._recent_signals[-200:]

    def _resolve_geo_key(self, signal: dict) -> str:
        if signal.get("region_id"):
            return f"REG:{signal['region_id']}"
        if signal.get("country"):
            return f"CTY:{signal['country'].lower()}"
        lat = signal.get("lat")
        lon = signal.get("lon")
        if lat is not None and lon is not None:
            return f"GEO:{round(lat, 1)},{round(lon, 1)}"
        return "GEO:unknown"

    def _add_signal(self, geo_key: str, signal: dict):
        bucket = self.active_signals.setdefault(geo_key, [])
        cutoff = datetime.datetime.utcnow() - timedelta(hours=self.fusion_window_hours)
        bucket = [s for s in bucket if s["timestamp"] > cutoff]
        # Deduplicate by signal_id
        existing_ids = {s["signal_id"] for s in bucket}
        if signal["signal_id"] not in existing_ids:
            bucket.append(signal)
        self.active_signals[geo_key] = bucket

    def _evaluate_fusion(self, geo_key: str):
        signals = self.active_signals.get(geo_key, [])
        if not signals:
            return

        domains = set(s["domain"] for s in signals)
        if len(domains) < self.min_domains:
            return
        if len(signals) < self.min_signals:
            return

        existing = self._find_existing_fusion(geo_key)
        if existing:
            self._update_fusion(existing, signals, geo_key, domains)
        else:
            self._create_fusion(signals, geo_key, domains)

    def _find_existing_fusion(self, geo_key: str):
        """Return active in-memory fusion for geo_key, or None."""
        for fid, f in self.active_fusions.items():
            if f.get("geo_key") == geo_key and f.get("status") == "active":
                return f
        return None

    def _composite_severity(self, signals: list, domains: set) -> str:
        max_sev = max(SEV_ORDER.get(s.get("severity", "info"), 0) for s in signals)
        if len(domains) >= 3 and max_sev < 3:
            max_sev += 1
        return SEV_NAMES[max_sev]

    def _best_location_name(self, signals: list) -> str:
        for s in signals:
            if s.get("location_name"):
                return s["location_name"]
        return "Unknown Location"

    def _signal_radius_km(self, signals: list) -> float:
        coords = [(s["lat"], s["lon"]) for s in signals if s.get("lat") and s.get("lon")]
        if len(coords) < 2:
            return 0.0
        lat0, lon0 = coords[0]
        return max(_haversine_km(lat0, lon0, lat, lon) for lat, lon in coords[1:])

    def _centroid(self, signals: list):
        coords = [(s["lat"], s["lon"]) for s in signals if s.get("lat") is not None and s.get("lon") is not None]
        if not coords:
            return None, None
        return sum(c[0] for c in coords) / len(coords), sum(c[1] for c in coords) / len(coords)

    def _calc_confidence(self, domains: set, signals: list) -> float:
        return min(0.98, 0.5 + (len(domains) - 1) * 0.15 + max(0, len(signals) - 2) * 0.05)

    # ── Haiku assessment generation ───────────────────────────────────────────

    def _generate_haiku_assessment(self, signals: list, domains: set, severity: str, location_name: str) -> tuple:
        """Returns (title, subtitle, narrative, key_signals, threat_indicators)."""
        try:
            import anthropic, json as _j
            signal_summaries = "\n".join(
                f"- [{s['domain']}] {s.get('rule_name','?')}: {str(s.get('summary',''))[:100]}"
                for s in signals[:10]
            )
            domain_str = ", ".join(sorted(domains))
            prompt = f"""You are an intelligence analyst. Multiple surveillance systems have detected correlated activity at {location_name}.

Contributing signals ({len(signals)} total across {len(domains)} domains — {domain_str}):
{signal_summaries}

Severity: {severity}

Generate a structured intelligence assessment. Return ONLY valid JSON with no markdown:
{{
  "title": "3-5 word intelligence event name, specific and geographically descriptive, e.g. 'Hormuz Maritime Escalation' or 'Baltic Cable Threat Cluster'",
  "subtitle": "one concise line describing domain convergence, e.g. 'AIS anomaly + news pattern + Sentinel detection'",
  "narrative": "3-4 sentences. What is happening, where, why it matters operationally, and what the convergence of signals suggests. Written for a senior intelligence analyst. Be specific.",
  "key_signals": [
    "most significant signal bullet point",
    "second most significant",
    "third if relevant",
    "fourth if relevant"
  ],
  "threat_indicators": [
    "specific named threat 1, e.g. 'Possible cable sabotage preparation'",
    "specific named threat 2"
  ]
}}"""
            client = anthropic.Anthropic()
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=400,
                temperature=0,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = msg.content[0].text.strip()
            if raw.startswith("```"):
                parts = raw.split("```")
                raw = parts[1] if len(parts) > 1 else raw
                if raw.startswith("json"):
                    raw = raw[4:].lstrip()
            parsed = _j.loads(raw)
            return (
                parsed.get("title", f"{location_name} Intelligence Event"),
                parsed.get("subtitle", f"{domain_str} convergence"),
                parsed.get("narrative", "Multi-domain signals detected."),
                parsed.get("key_signals", []),
                parsed.get("threat_indicators", []),
            )
        except Exception as e:
            print(f"[fusion] Haiku assessment error: {e}")
            dom_str = " + ".join(sorted(domains))
            return (
                f"{location_name} Intelligence Event",
                f"{dom_str} convergence",
                f"Multi-domain intelligence signals detected at {location_name}. {len(signals)} signals across {len(domains)} domains indicate elevated activity requiring analyst review.",
                [f"{s.get('rule_name','Signal')}: {str(s.get('summary',''))[:80]}" for s in signals[:4]],
                ["Multi-domain signal convergence detected"],
            )

    # ── Fusion lifecycle ──────────────────────────────────────────────────────

    def _create_fusion(self, signals: list, geo_key: str, domains: set):
        from database import get_db, FusionEvent
        severity   = self._composite_severity(signals, domains)
        confidence = self._calc_confidence(domains, signals)
        lat, lon   = self._centroid(signals)
        location_name = self._best_location_name(signals)
        region_id  = next((s.get("region_id") for s in signals if s.get("region_id")), None)
        country    = next((s.get("country") for s in signals if s.get("country")), None)
        fusion_id  = _new_fusion_id()

        title, subtitle, narrative, key_signals, threat_indicators = \
            self._generate_haiku_assessment(signals, domains, severity, location_name)

        try:
            with get_db() as db:
                fe = FusionEvent(
                    fusion_id               = fusion_id,
                    title                   = title[:200],
                    subtitle                = subtitle[:300],
                    narrative               = narrative,
                    severity                = severity,
                    confidence              = round(confidence, 3),
                    domain_count            = len(domains),
                    domains                 = json.dumps(sorted(domains)),
                    fusion_type             = "MULTI_DOMAIN",
                    location_name           = location_name,
                    location_country        = country,
                    region_id               = region_id,
                    lat                     = lat,
                    lon                     = lon,
                    radius_km               = round(self._signal_radius_km(signals), 1),
                    contributing_assessments= json.dumps([s["assessment_id"] for s in signals if s.get("assessment_id")]),
                    contributing_alert_ids  = json.dumps([s["alert_id"] for s in signals if s.get("alert_id")]),
                    contributing_rule_ids   = json.dumps(list(set(str(s["rule_id"]) for s in signals if s.get("rule_id")))),
                    signal_count            = len(signals),
                    key_signals             = json.dumps(key_signals),
                    recommended_actions     = json.dumps([]),
                    threat_indicators       = json.dumps(threat_indicators),
                    marker_type             = "FUSION_EVENT",
                    marker_visible          = True,
                    status                  = "active",
                    expires_at              = datetime.datetime.utcnow() + timedelta(hours=48),
                )
                db.add(fe)
                db.commit()
                db.refresh(fe)

                # Suppress individual assessment markers that are now fused
                self._suppress_assessments(db, [s["assessment_id"] for s in signals if s.get("assessment_id")])

        except Exception as e:
            print(f"[fusion] DB write error: {e}")
            return

        # Register in-memory
        fusion_dict = {
            "fusion_id":     fusion_id,
            "geo_key":       geo_key,
            "title":         title,
            "subtitle":      subtitle,
            "narrative":     narrative,
            "severity":      severity,
            "confidence":    round(confidence, 3),
            "domains":       sorted(domains),
            "domain_count":  len(domains),
            "location_name": location_name,
            "lat":           lat,
            "lon":           lon,
            "signal_count":  len(signals),
            "key_signals":   key_signals,
            "threat_indicators": threat_indicators,
            "status":        "active",
            "created_at":    datetime.datetime.utcnow().isoformat(),
        }
        self.active_fusions[fusion_id] = fusion_dict

        for s in signals:
            self.signal_to_fusion[s["signal_id"]] = fusion_id

        print(f"[fusion] NEW {fusion_id}: {title} | {len(signals)} signals / {len(domains)} domains | {severity}")

        if self._fire_callback:
            suppressed_alert_ids = [s["alert_id"] for s in signals if s.get("alert_id")]
            self._fire_callback(fusion_dict, suppressed_alert_ids)

    def _update_fusion(self, existing: dict, signals: list, geo_key: str, domains: set):
        from database import get_db, FusionEvent
        fusion_id   = existing["fusion_id"]
        old_domains = set(existing.get("domains", []))
        all_domains = domains | old_domains
        severity    = self._composite_severity(signals, all_domains)
        confidence  = self._calc_confidence(all_domains, signals)

        location_name = existing.get("location_name") or self._best_location_name(signals)

        title, subtitle, narrative, key_signals, threat_indicators = \
            self._generate_haiku_assessment(signals, all_domains, severity, location_name)

        try:
            with get_db() as db:
                fe = db.query(FusionEvent).filter(FusionEvent.fusion_id == fusion_id).first()
                if fe:
                    fe.title              = title[:200]
                    fe.subtitle           = subtitle[:300]
                    fe.narrative          = narrative
                    fe.severity           = severity
                    fe.confidence         = round(confidence, 3)
                    fe.domain_count       = len(all_domains)
                    fe.domains            = json.dumps(sorted(all_domains))
                    fe.signal_count       = len(signals)
                    fe.key_signals        = json.dumps(key_signals)
                    fe.threat_indicators  = json.dumps(threat_indicators)
                    fe.updated_at         = datetime.datetime.utcnow()
                    # Extend expiry
                    fe.expires_at         = datetime.datetime.utcnow() + timedelta(hours=48)

                    new_assessments = [s["assessment_id"] for s in signals if s.get("assessment_id") and s["signal_id"] not in self.signal_to_fusion]
                    self._suppress_assessments(db, new_assessments)
                    db.commit()
        except Exception as e:
            print(f"[fusion] update error: {e}")
            return

        existing.update({
            "title":         title,
            "subtitle":      subtitle,
            "narrative":     narrative,
            "severity":      severity,
            "confidence":    round(confidence, 3),
            "domains":       sorted(all_domains),
            "domain_count":  len(all_domains),
            "signal_count":  len(signals),
            "key_signals":   key_signals,
            "threat_indicators": threat_indicators,
        })
        for s in signals:
            self.signal_to_fusion[s["signal_id"]] = fusion_id

        print(f"[fusion] UPDATE {fusion_id}: {title} | {len(signals)} signals / {len(all_domains)} domains")

        if self._fire_callback:
            suppressed_alert_ids = [s["alert_id"] for s in signals if s.get("alert_id") and s["signal_id"] not in self.signal_to_fusion]
            self._fire_callback(existing, suppressed_alert_ids)

    def _suppress_assessments(self, db, assessment_ids: list):
        if not assessment_ids:
            return
        try:
            from sqlalchemy import text
            for aid in assessment_ids:
                db.execute(text(
                    "UPDATE intelligence_assessments SET marker_visible=0 WHERE assessment_id=:id"
                ), {"id": aid})
        except Exception as e:
            print(f"[fusion] suppress error: {e}")


# Module-level singleton
fusion_engine = FusionEngine()
