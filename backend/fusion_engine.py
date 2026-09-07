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
import re
import uuid
import math
import datetime
from datetime import timedelta

import correlation_scoring as _cs


FUSION_WINDOW_HOURS   = 2
MIN_DOMAINS_FOR_FUSION = 2
MIN_SIGNALS_FOR_FUSION = 2

# Real cost-control fix (2026-09 spend audit): _generate_haiku_assessment()
# was completely unmetered and unthrottled — _update_fusion() re-fired it on
# every single contributing signal added to an already-existing cluster, and
# a restart re-fired it again for every active cluster (see
# _reload_fusions_from_db()'s docstring for the duplicate-row half of that
# bug). A real narrative doesn't need sub-30-minute freshness; a genuinely
# NEW domain joining the cluster is real news and still regenerates
# immediately regardless of this timer.
FUSION_NARRATIVE_MIN_REFRESH_MINUTES = 30

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


# ── Zone bbox cache for geo key resolution (loaded once from DB) ──────────────
_zone_bboxes: list = []
_zone_bboxes_loaded: bool = False


def _maybe_load_zone_bboxes():
    global _zone_bboxes, _zone_bboxes_loaded
    if _zone_bboxes_loaded:
        return
    try:
        from database import SessionLocal, StrategicZone
        db = SessionLocal()
        try:
            zones = db.query(StrategicZone).filter_by(enabled=True).all()
            _zone_bboxes = [{
                "zone_id": z.zone_id,
                "min_lat": z.bbox_min_lat, "max_lat": z.bbox_max_lat,
                "min_lon": z.bbox_min_lon, "max_lon": z.bbox_max_lon,
                "area": (z.bbox_max_lat - z.bbox_min_lat) * (z.bbox_max_lon - z.bbox_min_lon),
            } for z in zones]
            _zone_bboxes.sort(key=lambda z: z["area"])  # smallest zone first → most specific
            _zone_bboxes_loaded = True
            print(f"[fusion] Loaded {len(_zone_bboxes)} zone bboxes for geo key resolution")
        finally:
            db.close()
    except Exception as e:
        print(f"[fusion] Zone bbox load error: {e}")


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

        # Attach relevance score from strategic zone context
        try:
            from relevance_scorer import relevance_scorer as _rs
            signal.setdefault("relevance_score", _rs.score_signal(signal))
        except Exception:
            signal.setdefault("relevance_score", 0)

        self._log_signal(signal)

        geo_key = self._resolve_geo_key(signal)
        print(f"[FUSION] Signal received: {signal.get('domain')} | "
              f"{signal.get('signal_id')} | geo_key={geo_key} | relevance={signal.get('relevance_score', 0)}")
        self._add_signal(geo_key, signal)

        # Persist to DB so signals survive restarts
        try:
            from database import SessionLocal, FusionSignal
            import json as _json
            _db = SessionLocal()
            try:
                sig_id = signal.get("signal_id") or str(uuid.uuid4())
                expires = datetime.datetime.utcnow() + timedelta(hours=max(self.fusion_window_hours, 12))
                existing = _db.query(FusionSignal).filter_by(signal_id=sig_id).first()
                if existing:
                    existing.expires_at = expires
                    existing.payload    = _json.dumps(signal, default=str)
                else:
                    _db.add(FusionSignal(
                        signal_id=sig_id,
                        domain=signal.get("domain", ""),
                        geo_key=geo_key,
                        severity=signal.get("severity", "medium"),
                        confidence=float(signal.get("confidence", 0.8)),
                        relevance_score=float(signal.get("relevance_score", 0)),
                        lat=signal.get("lat"),
                        lon=signal.get("lon"),
                        location_name=signal.get("location_name"),
                        region_id=signal.get("region_id"),
                        country=signal.get("country"),
                        rule_name=signal.get("rule_name"),
                        summary=str(signal.get("summary", ""))[:500],
                        payload=_json.dumps(signal, default=str),
                        expires_at=expires,
                    ))
                _db.commit()
            finally:
                _db.close()
        except Exception as _pe:
            print(f"[fusion] Signal persist error: {_pe}")

        current = self.active_signals.get(geo_key, [])
        domains_now = set(s["domain"] for s in current)
        print(f"[FUSION] Active signals for {geo_key}: {len(current)} | domains={domains_now}")
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
        lat = signal.get("lat")
        lon = signal.get("lon")
        if lat is not None and lon is not None:
            # Zone bbox lookup — signals in the same strategic zone always fuse
            _maybe_load_zone_bboxes()
            for zb in _zone_bboxes:
                if (zb["min_lat"] <= lat <= zb["max_lat"] and
                        zb["min_lon"] <= lon <= zb["max_lon"]):
                    return f"zone:{zb['zone_id']}"
        if signal.get("country"):
            return f"CTY:{signal['country'].lower()}"
        if lat is not None and lon is not None:
            # Real radius-based lookup (correlation_scoring.py Part 1),
            # replacing the old round(lat,1)/round(lon,1) grid — that
            # rounding created a real false-negative: two signals a few km
            # apart but on opposite sides of a ~0.1-degree cell boundary
            # never shared a geo_key and so could never fuse. Only reached
            # when a signal has no region_id, no matching strategic zone,
            # and no country — the tiers above are real named geographic
            # entities, unaffected by this change.
            return _cs.find_or_create_radius_geo_key(lat, lon, datetime.datetime.utcnow(), self.active_signals)
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

        # Prioritise strategically relevant signals when scoring
        high_relevance = [s for s in signals if s.get("relevance_score", 0) >= 30]
        candidate_pool = high_relevance if len(high_relevance) >= self.min_signals else signals

        domains = set(s["domain"] for s in candidate_pool)
        domain_score, domain_breakdown = _cs.domain_diversity_score(candidate_pool)
        print(f"[FUSION] Evaluating {geo_key}: {len(signals)} signals ({len(high_relevance)} high-relevance), "
              f"{len(domains)} domains={domains} domain_diversity_score={domain_score:.3f} "
              f"(floor={_cs.DOMAIN_DIVERSITY_FLOOR})")
        # Real, graduated, reliability-weighted domain-diversity floor
        # (correlation_scoring.py Part 3) replaces the old hard "exactly
        # 2+ domains" gate — a genuinely single-domain cluster (regardless
        # of how many signals pile up within that one domain) can never
        # clear this floor by construction (see domain_diversity_score's
        # docstring), so the real cross-domain-corroboration requirement
        # is preserved, just graduated by source reliability rather than a
        # blunt count. self.min_domains is kept only for the existing
        # operator settings API's backward compatibility — it no longer
        # independently gates fusion.
        if domain_score < _cs.DOMAIN_DIVERSITY_FLOOR:
            print(f"[FUSION] Domain diversity {domain_score:.3f} below floor {_cs.DOMAIN_DIVERSITY_FLOOR}, skipping")
            return
        # Real raw-volume floor — orthogonal to domain diversity: even a
        # perfectly-diverse pair of signals shouldn't fire off a near-empty
        # candidate pool. Still real and operator-configurable.
        if len(candidate_pool) < self.min_signals:
            print(f"[FUSION] Not enough signals ({len(candidate_pool)} < {self.min_signals}), skipping")
            return

        existing = self._find_existing_fusion(geo_key)
        if existing:
            self._update_fusion(existing, candidate_pool, geo_key, domains)
        else:
            self._create_fusion(candidate_pool, geo_key, domains)

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

    # ── Haiku assessment generation ───────────────────────────────────────────
    #
    # Part 6 of the correlation-engine deepening pass: every judgment about
    # WHETHER/HOW STRONGLY signals correlate is decided entirely by
    # correlation_scoring.py before this method is ever called (see
    # _create_fusion/_update_fusion, which compute the real `score` bundle
    # and pass it in). This method's only job is turning that already-
    # decided bundle into readable prose — the prompt below explicitly
    # forbids introducing any fact not present in the bundle, and forbids
    # the model stating its own confidence/strength number. A real
    # deterministic validator (_validate_narrative) checks every candidate
    # named entity the model's prose mentions against the real bundle
    # vocabulary, reusing the same normalized-token-set discipline
    # report_council.py's citation/zone-name checks already use — not a
    # new one-off approach. A violation triggers one regeneration with the
    # violation named back to the model; a second violation falls back to
    # a plain, deterministic template narrative built only from the
    # bundle's own fields (no LLM), and logs which path fired.

    @staticmethod
    def _bundle_vocabulary_text(signals: list, domains: set, location_name: str, shared_entity_names: list) -> str:
        parts = [location_name or ""]
        for s in signals:
            parts.append(str(s.get("rule_name") or ""))
            parts.append(str(s.get("summary") or ""))
            parts.append(str(s.get("location_name") or ""))
            parts.append(str(s.get("domain") or ""))
        parts.extend(domains or [])
        parts.extend(shared_entity_names or [])
        return " ".join(parts)

    _NARRATIVE_STOPWORDS = {
        "the", "a", "an", "of", "in", "at", "to", "and", "or", "is", "was",
        "are", "were", "this", "that", "possible", "detected", "signal",
        "signals", "event", "activity", "near", "multiple", "real",
    }

    @staticmethod
    def _normalize_narrative_tokens(text: str) -> set:
        s = (text or "").lower()
        s = re.sub(r"[^\w\s]", " ", s)
        return {w for w in s.split() if w and w not in FusionEngine._NARRATIVE_STOPWORDS}

    @staticmethod
    def _candidate_named_entities(text: str) -> list:
        """Real, simple heuristic: runs of 2+ consecutive capitalized words
        are candidate named entities/places a narrative might introduce —
        the kind of thing worth checking against the bundle. A single
        capitalized word is too weak a signal on its own (sentence-initial
        capitalization, domain names like 'AIS') to check without a real
        risk of false positives, so this deliberately only flags multi-word
        proper-noun-shaped phrases."""
        return re.findall(r"\b[A-Z][a-zA-Z0-9\-]+(?:\s+[A-Z][a-zA-Z0-9\-]+)+\b", text or "")

    @classmethod
    def _validate_narrative(cls, narrative: str, key_signals: list, threat_indicators: list,
                             signals: list, domains: set, location_name: str,
                             shared_entity_names: list) -> tuple:
        """Returns (ok: bool, violations: list[str]). A violation is a
        candidate named entity/place mentioned in the model's prose whose
        significant words are not a subset of the real bundle vocabulary —
        i.e. the model introduced something not actually in its input."""
        vocab = cls._normalize_narrative_tokens(
            cls._bundle_vocabulary_text(signals, domains, location_name, shared_entity_names)
        )
        violations = []
        for text in [narrative] + list(key_signals or []) + list(threat_indicators or []):
            for phrase in cls._candidate_named_entities(str(text)):
                phrase_tokens = cls._normalize_narrative_tokens(phrase)
                if len(phrase_tokens) < 2:
                    continue
                if not phrase_tokens.issubset(vocab):
                    violations.append(phrase)
        return (len(violations) == 0, violations)

    @staticmethod
    def _template_narrative(signals: list, domains: set, location_name: str) -> tuple:
        """Real deterministic fallback — plain sentences built only from
        the bundle's own fields, no LLM. Used whenever no real API client
        is configured, the API call itself fails, or the model's narrative
        fails validation twice (see _generate_haiku_assessment)."""
        dom_str = " + ".join(sorted(domains))
        return (
            f"{location_name} Intelligence Event",
            f"{dom_str} convergence",
            f"Multi-domain intelligence signals detected at {location_name}. {len(signals)} signals across {len(domains)} domains indicate elevated activity requiring analyst review.",
            [f"{s.get('rule_name','Signal')}: {str(s.get('summary',''))[:80]}" for s in signals[:4]],
            ["Multi-domain signal convergence detected"],
        )

    def _generate_haiku_assessment(self, signals: list, domains: set, severity: str, location_name: str,
                                    score: dict = None, item_id: str = "") -> tuple:
        """Returns (title, subtitle, narrative, key_signals, threat_indicators).
        `score` is the real, already-computed correlation_scoring.score_cluster()
        bundle for this cluster (may be None for callers not yet passing one,
        e.g. before Part 5 wiring) — when present, its real components and
        final strength are given to the model as decided facts, never asked
        for. `item_id` (the real fusion_id) is threaded through to
        usage_tracker.record_call so this call site is no longer invisible
        to the real per-call spend audit (2026-09) — every real API call
        made here, including the one-time regeneration retry, is logged."""
        score = score or {}
        shared_entity_names = score.get("shared_entities") or []
        try:
            import anthropic, json as _j
            signal_summaries = "\n".join(
                f"- [{s['domain']}] {s.get('rule_name','?')}: {str(s.get('summary',''))[:100]}"
                for s in signals[:10]
            )
            domain_str = ", ".join(sorted(domains))
            components = score.get("components") or {}
            strength = score.get("strength")
            facts_block = f"Severity: {severity}"
            if strength is not None:
                facts_block += (
                    f"\nCorrelation strength (already computed, 0-100, DO NOT restate or alter this number "
                    f"in your own words — just narrate around it): {strength}"
                    f"\nComponent evidence (already computed): geo-temporal={components.get('geo_temporal')}, "
                    f"graph={components.get('graph')}, domain_diversity={components.get('domain_diversity')}, "
                    f"statistical={components.get('statistical')}"
                )
            if shared_entity_names:
                facts_block += f"\nShared linked infrastructure entities (already computed, real): {', '.join(shared_entity_names)}"

            prompt = f"""You are an intelligence analyst. Multiple surveillance systems have detected correlated activity at {location_name}.

Contributing signals ({len(signals)} total across {len(domains)} domains — {domain_str}):
{signal_summaries}

{facts_block}

IMPORTANT — you are narrating a correlation that has ALREADY been fully decided by
real code. Do not introduce any fact, entity, place, or figure that is not present
above. Do not assign, restate, or re-derive a confidence/strength number in your own
words — one is already given; refer to it qualitatively (e.g. "strong", "moderate")
if you wish, never with a different number of your own.

Generate a structured intelligence assessment. Return ONLY valid JSON with no markdown:
{{
  "title": "3-5 word intelligence event name, specific and geographically descriptive, e.g. 'Hormuz Maritime Escalation' or 'Baltic Cable Threat Cluster'",
  "subtitle": "one concise line describing domain convergence, e.g. 'AIS anomaly + news pattern + Sentinel detection'",
  "narrative": "3-4 sentences. What is happening, where, and what the convergence of the GIVEN signals suggests — using only facts given above. Written for a senior intelligence analyst. Be specific.",
  "key_signals": [
    "most significant signal bullet point, drawn only from the signals given above",
    "second most significant",
    "third if relevant",
    "fourth if relevant"
  ],
  "threat_indicators": [
    "a threat theme directly evidenced by the given signals/rule names — describe what the given signals indicate, do not invent a scenario not evidenced above",
    "second if relevant"
  ]
}}"""
            client = anthropic.Anthropic()

            def _call_and_parse():
                msg = client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=400,
                    temperature=0,
                    messages=[{"role": "user", "content": prompt}],
                )
                try:
                    import usage_tracker as _ut
                    _ut.record_call(
                        msg.usage.input_tokens, msg.usage.output_tokens,
                        call_type="fusion_narrative", headline=location_name,
                        model="claude-haiku-4-5-20251001", item_id=item_id,
                    )
                except Exception as _ut_e:
                    print(f"[fusion] usage_tracker record error: {_ut_e}")
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

            title, subtitle, narrative, key_signals, threat_indicators = _call_and_parse()
            ok, violations = self._validate_narrative(
                narrative, key_signals, threat_indicators, signals, domains, location_name, shared_entity_names)
            if not ok:
                print(f"[fusion] narrative validator caught unsupported claim(s) {violations} — regenerating once")
                prompt += (
                    f"\n\nYour previous attempt mentioned the following, which are NOT present in the "
                    f"signals/facts given above: {violations}. Regenerate using ONLY the facts given above — "
                    f"do not name any entity, place, or figure not listed there."
                )
                client = anthropic.Anthropic()
                title, subtitle, narrative, key_signals, threat_indicators = _call_and_parse()
                ok2, violations2 = self._validate_narrative(
                    narrative, key_signals, threat_indicators, signals, domains, location_name, shared_entity_names)
                if not ok2:
                    print(f"[fusion] narrative validator caught unsupported claim(s) again {violations2} — "
                          f"falling back to deterministic template narrative")
                    return self._template_narrative(signals, domains, location_name)
                print("[fusion] regenerated narrative passed validation")
            return (title, subtitle, narrative, key_signals, threat_indicators)
        except Exception as e:
            print(f"[fusion] Haiku assessment error: {e}")
            return self._template_narrative(signals, domains, location_name)

    # ── Fusion lifecycle ──────────────────────────────────────────────────────

    def _create_fusion(self, signals: list, geo_key: str, domains: set):
        from database import get_db, FusionEvent
        severity   = self._composite_severity(signals, domains)
        lat, lon   = self._centroid(signals)
        location_name = self._best_location_name(signals)
        region_id  = next((s.get("region_id") for s in signals if s.get("region_id")), None)
        country    = next((s.get("country") for s in signals if s.get("country")), None)
        fusion_id  = _new_fusion_id()

        # Real correlation-strength scoring (correlation_scoring.py, Parts
        # 1-5) — computed BEFORE the model is ever called, so the model
        # only narrates a bundle that is already fully decided.
        try:
            with get_db() as _score_db:
                score = _cs.score_cluster(signals, _score_db)
        except Exception as _score_e:
            print(f"[fusion] correlation scoring error: {_score_e}")
            score = {}
        confidence = (score.get("strength") or 0.0) / 100.0

        title, subtitle, narrative, key_signals, threat_indicators = \
            self._generate_haiku_assessment(signals, domains, severity, location_name, score=score, item_id=fusion_id)
        narrative_generated_at = datetime.datetime.utcnow()

        try:
            with get_db() as db:
                fe = FusionEvent(
                    fusion_id               = fusion_id,
                    geo_key                 = geo_key,
                    title                   = title[:200],
                    subtitle                = subtitle[:300],
                    narrative               = narrative,
                    narrative_generated_at  = narrative_generated_at,
                    severity                = severity,
                    confidence              = round(confidence, 3),
                    correlation_strength    = score.get("strength"),
                    correlation_components  = json.dumps(score, default=str) if score else None,
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

                # Register fusion event as an OntologyEntity so it appears in the registry
                try:
                    from database import OntologyEntity as _OE
                    _oe = db.query(_OE).filter(_OE.system_id == fusion_id).first()
                    _meta = json.dumps({
                        "severity":     severity,
                        "confidence":   round(confidence, 3),
                        "domains":      sorted(domains),
                        "signal_count": len(signals),
                        "location":     location_name,
                        "created_at":   datetime.datetime.utcnow().isoformat(),
                    })
                    if _oe:
                        _oe.name            = title[:200]
                        _oe.entity_metadata = _meta
                    else:
                        db.add(_OE(
                            system_id       = fusion_id,
                            entity_type     = "fusion_event",
                            name            = title[:200],
                            infra_type      = "MULTI_DOMAIN",
                            region_id       = region_id,
                            entity_metadata = _meta,
                        ))
                    db.commit()
                except Exception as _oe_e:
                    print(f"[fusion] OntologyEntity upsert error: {_oe_e}")

        except Exception as e:
            print(f"[fusion] DB write error: {e}")
            return

        # Link fusion event to nearby ontology entities (cables, ports, airports, zones)
        try:
            from entity_linker import entity_linker as _el
            _el.link_fusion_event(fusion_id, lat, lon, title)
        except Exception as _el_e:
            print(f"[fusion] entity_linker error: {_el_e}")

        try:
            from event_bus import event_bus as _eb, Events as _Ev
            _eb.publish_sync(_Ev.FUSION_CREATED, {
                "fusion_id": fusion_id, "title": title,
                "severity":  severity, "lat": lat, "lon": lon,
            })
        except Exception:
            pass

        # Register in-memory
        fusion_dict = {
            "fusion_id":     fusion_id,
            "geo_key":       geo_key,
            "title":         title,
            "subtitle":      subtitle,
            "narrative":     narrative,
            "severity":      severity,
            "confidence":    round(confidence, 3),
            "correlation_strength":   score.get("strength"),
            "correlation_components": score,
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
            "narrative_generated_at": narrative_generated_at,
        }
        self.active_fusions[fusion_id] = fusion_dict

        for s in signals:
            self.signal_to_fusion[s["signal_id"]] = fusion_id

        print(f"[fusion] NEW {fusion_id}: {title} | {len(signals)} signals / {len(domains)} domains | {severity}")

        if self._fire_callback:
            suppressed_alert_ids = [s["alert_id"] for s in signals if s.get("alert_id")]
            self._fire_callback(fusion_dict, suppressed_alert_ids)

    def _narrative_refresh_due(self, existing: dict) -> bool:
        """Real gate on _generate_haiku_assessment (2026-09 spend audit) —
        without this, _update_fusion re-narrated on EVERY contributing
        signal added to an already-existing cluster, completely unmetered.
        A cluster with no narrative yet always regenerates; otherwise only
        after FUSION_NARRATIVE_MIN_REFRESH_MINUTES have actually elapsed
        since the last real generation (new-domain arrivals are handled
        separately by the caller, which always regenerates for those)."""
        if not existing.get("narrative"):
            return True
        last = existing.get("narrative_generated_at")
        if not last:
            return True
        if isinstance(last, str):
            try:
                last = datetime.datetime.fromisoformat(last)
            except Exception:
                return True
        elapsed_min = (datetime.datetime.utcnow() - last).total_seconds() / 60.0
        return elapsed_min >= FUSION_NARRATIVE_MIN_REFRESH_MINUTES

    def _update_fusion(self, existing: dict, signals: list, geo_key: str, domains: set):
        from database import get_db, FusionEvent
        fusion_id   = existing["fusion_id"]
        old_domains = set(existing.get("domains", []))
        all_domains = domains | old_domains
        new_domains_joined = domains - old_domains
        severity    = self._composite_severity(signals, all_domains)

        location_name = existing.get("location_name") or self._best_location_name(signals)

        try:
            with get_db() as _score_db:
                score = _cs.score_cluster(signals, _score_db)
        except Exception as _score_e:
            print(f"[fusion] correlation scoring error: {_score_e}")
            score = {}
        confidence = (score.get("strength") or 0.0) / 100.0

        should_regenerate = bool(new_domains_joined) or self._narrative_refresh_due(existing)
        if should_regenerate:
            title, subtitle, narrative, key_signals, threat_indicators = \
                self._generate_haiku_assessment(signals, all_domains, severity, location_name, score=score, item_id=fusion_id)
            narrative_generated_at = datetime.datetime.utcnow()
        else:
            title, subtitle, narrative = existing["title"], existing["subtitle"], existing["narrative"]
            key_signals, threat_indicators = existing.get("key_signals", []), existing.get("threat_indicators", [])
            narrative_generated_at = existing.get("narrative_generated_at")
            print(f"[fusion] SKIP narrative regen for {fusion_id} — no new domain, "
                  f"refreshed within the last {FUSION_NARRATIVE_MIN_REFRESH_MINUTES}m")

        try:
            with get_db() as db:
                fe = db.query(FusionEvent).filter(FusionEvent.fusion_id == fusion_id).first()
                if fe:
                    fe.title              = title[:200]
                    fe.subtitle           = subtitle[:300]
                    fe.narrative          = narrative
                    if should_regenerate:
                        fe.narrative_generated_at = narrative_generated_at
                    fe.severity           = severity
                    fe.confidence         = round(confidence, 3)
                    fe.correlation_strength   = score.get("strength")
                    fe.correlation_components = json.dumps(score, default=str) if score else None
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
            "correlation_strength":   score.get("strength"),
            "correlation_components": score,
            "domains":       sorted(all_domains),
            "domain_count":  len(all_domains),
            "signal_count":  len(signals),
            "key_signals":   key_signals,
            "threat_indicators": threat_indicators,
            "narrative_generated_at": narrative_generated_at,
        })
        for s in signals:
            self.signal_to_fusion[s["signal_id"]] = fusion_id

        print(f"[fusion] UPDATE {fusion_id}: {title} | {len(signals)} signals / {len(all_domains)} domains")

        if self._fire_callback:
            suppressed_alert_ids = [s["alert_id"] for s in signals if s.get("alert_id") and s["signal_id"] not in self.signal_to_fusion]
            self._fire_callback(existing, suppressed_alert_ids)

    def _reload_signals_from_db(self):
        """Reload non-expired fusion signals from DB on startup."""
        try:
            from database import SessionLocal, FusionSignal
            import json as _json
            _db = SessionLocal()
            try:
                now = datetime.datetime.utcnow()
                # Exclude AUTOMATED TEST / TEST-* rows (test_gdelt_fusion_signal.py's
                # own convention) — without this, every restart re-evaluates fusion
                # for leftover test geo keys below (line ~615), minting a fresh
                # "AUTOMATED TEST" FusionEvent and a Haiku assessment call attempt
                # on every single startup for data that was already resolved.
                rows = (
                    _db.query(FusionSignal)
                    .filter(FusionSignal.expires_at > now)
                    .filter(
                        (FusionSignal.location_name.is_(None))
                        | (~FusionSignal.location_name.like("%AUTOMATED TEST%"))
                    )
                    .filter(
                        (FusionSignal.signal_id.is_(None))
                        | (~FusionSignal.signal_id.like("TEST-%"))
                    )
                    .all()
                )
                reloaded = 0
                for row in rows:
                    try:
                        payload = _json.loads(row.payload or "{}")
                        if not payload.get("signal_id"):
                            payload["signal_id"] = row.signal_id
                        if not isinstance(payload.get("timestamp"), datetime.datetime):
                            payload["timestamp"] = row.created_at
                        geo_key = row.geo_key
                        if geo_key not in self.active_signals:
                            self.active_signals[geo_key] = []
                        existing_ids = {s["signal_id"] for s in self.active_signals[geo_key]}
                        if row.signal_id not in existing_ids:
                            self.active_signals[geo_key].append(payload)
                            reloaded += 1
                    except Exception:
                        pass
                print(f"[fusion] Reloaded {reloaded} signals from DB "
                      f"({len(self.active_signals)} geo keys)")

                # Also restore _recent_signals — this (not active_signals) is what
                # GET /api/signals/recent / the Signal Monitor panel actually serves.
                # Previously only active_signals was restored here, so the panel
                # always showed "0 signals" after every restart even when real
                # signal history existed in the DB. Respect the same maxsize=200
                # cap and oldest-first storage order _log_signal() uses (
                # get_recent_signals() reverses to most-recent-first at read time).
                try:
                    recent_rows = list(reversed(
                        _db.query(FusionSignal)
                        .filter(
                            (FusionSignal.location_name.is_(None))
                            | (~FusionSignal.location_name.like("%AUTOMATED TEST%"))
                        )
                        .filter(
                            (FusionSignal.signal_id.is_(None))
                            | (~FusionSignal.signal_id.like("TEST-%"))
                        )
                        .order_by(FusionSignal.created_at.desc())
                        .limit(200)
                        .all()
                    ))
                    _recent: list = []
                    for row in recent_rows:
                        try:
                            payload = _json.loads(row.payload or "{}")
                        except Exception:
                            payload = {}
                        ts = payload.get("timestamp")
                        if not isinstance(ts, str):
                            ts = row.created_at.isoformat() if row.created_at else ""
                        _recent.append({
                            "signal_id":     payload.get("signal_id") or row.signal_id,
                            "domain":        payload.get("domain") or row.domain,
                            "severity":      payload.get("severity") or row.severity,
                            "rule_name":     payload.get("rule_name") or row.rule_name,
                            "location_name": payload.get("location_name") or row.location_name,
                            "summary":       str(payload.get("summary") or row.summary or "")[:120],
                            "timestamp":     ts,
                        })
                    self._recent_signals = _recent
                    print(f"[fusion] Reloaded {len(self._recent_signals)} recent signals from DB")
                except Exception as _rs_e:
                    print(f"[fusion] recent-signals reload error: {_rs_e}")

                # Re-evaluate fusion for any geo key that now meets thresholds
                for geo_key in list(self.active_signals.keys()):
                    self._evaluate_fusion(geo_key)
            finally:
                _db.close()
        except Exception as e:
            print(f"[fusion] Signal reload error: {e}")

    def _reload_fusions_from_db(self):
        """Rebuild the in-memory active_fusions registry from real, active,
        non-expired FusionEvent rows on startup.

        Real bug fix (2026-09 spend audit): this previously didn't exist at
        all — active_fusions started empty on every restart, so
        _find_existing_fusion() always returned None for a geo_key that
        already had a real FusionEvent row, routing _evaluate_fusion() back
        into _create_fusion() instead of _update_fusion(). That meant every
        restart minted a genuinely NEW duplicate FusionEvent row (new
        fusion_id, duplicate DB row) AND a fresh, completely unmetered Haiku
        call for every cluster that was already fused — not just a wasted
        re-narration, a real data-integrity bug too. Must run BEFORE
        _reload_signals_from_db(), whose own re-evaluation pass depends on
        active_fusions already reflecting reality so it correctly falls
        into the (now-throttled) _update_fusion() path instead."""
        try:
            from database import SessionLocal, FusionEvent
            _db = SessionLocal()
            try:
                now = datetime.datetime.utcnow()
                rows = (
                    _db.query(FusionEvent)
                    .filter(FusionEvent.status == "active")
                    .filter(FusionEvent.expires_at > now)
                    .filter(FusionEvent.geo_key.isnot(None))
                    .all()
                )
                for row in rows:
                    try:
                        domains = json.loads(row.domains or "[]")
                    except Exception:
                        domains = []
                    try:
                        key_signals = json.loads(row.key_signals or "[]")
                    except Exception:
                        key_signals = []
                    try:
                        threat_indicators = json.loads(row.threat_indicators or "[]")
                    except Exception:
                        threat_indicators = []
                    try:
                        correlation_components = json.loads(row.correlation_components) if row.correlation_components else {}
                    except Exception:
                        correlation_components = {}
                    self.active_fusions[row.fusion_id] = {
                        "fusion_id":     row.fusion_id,
                        "geo_key":       row.geo_key,
                        "title":         row.title,
                        "subtitle":      row.subtitle,
                        "narrative":     row.narrative,
                        "severity":      row.severity,
                        "confidence":    row.confidence,
                        "correlation_strength":   row.correlation_strength,
                        "correlation_components": correlation_components,
                        "domains":       domains,
                        "domain_count":  row.domain_count,
                        "location_name": row.location_name,
                        "lat":           row.lat,
                        "lon":           row.lon,
                        "signal_count":  row.signal_count,
                        "key_signals":   key_signals,
                        "threat_indicators": threat_indicators,
                        "status":        row.status,
                        "created_at":    row.created_at.isoformat() if row.created_at else None,
                        "narrative_generated_at": row.narrative_generated_at,
                    }
                print(f"[fusion] Reloaded {len(rows)} active fusion events from DB "
                      f"({sum(1 for r in rows if r.geo_key)} with a real geo_key)")
            finally:
                _db.close()
        except Exception as e:
            print(f"[fusion] Fusion reload error: {e}")

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
# Order matters: active_fusions must be reloaded BEFORE active_signals, since
# _reload_signals_from_db()'s own re-evaluation pass depends on
# _find_existing_fusion() already seeing real existing fusions (see
# _reload_fusions_from_db()'s docstring for the bug this fixes).
fusion_engine._reload_fusions_from_db()
fusion_engine._reload_signals_from_db()
