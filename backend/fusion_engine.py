import llm_gate
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
from fusion_title import headline as _fusion_headline, is_template as _fusion_is_template
import re
import time
import threading
import uuid
import math
import datetime
from datetime import timedelta

import correlation_scoring as _cs


FUSION_WINDOW_HOURS   = 2
MIN_DOMAINS_FOR_FUSION = 2
MIN_SIGNALS_FOR_FUSION = 2

# How often one geo bucket may be evaluated, in seconds. This is a
# throttle, not a delay: the first signal into a quiet bucket still
# evaluates immediately. It only bounds what a burst can cost.
EVAL_MIN_INTERVAL_S = 15.0

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


#: Marker key for a signal that has no place at all. It is persisted
#: under this key so it survives a restart and stays visible, but it is
#: never a correlation bucket — see _resolve_geo_key and the restore
#: path, both of which must agree about that or the bug returns on the
#: next process start.
UNLOCATED_KEY = "GEO:unlocated"

#: Most signals one geo bucket keeps. The fusion window bounds their AGE;
#: this bounds their NUMBER, which the window never did.
MAX_BUCKET = 400
#: How often a bucket may report its arrival rate, in seconds.
SIGNAL_LOG_INTERVAL_S = 30



# Said once per process, not once per fusion — see the None check below.
_NARRATIVE_OFF_REPORTED = False


_COORDISH = re.compile(r"^\s*-?\d+(\.\d+)?°\s*[NS]")


def _coord_name(lat, lon) -> str | None:
    """A position as something a person reads, or None if there is none."""
    if lat is None or lon is None:
        return None
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    return (f"{abs(lat):.2f}\u00b0{'N' if lat >= 0 else 'S'} "
            f"{abs(lon):.2f}\u00b0{'E' if lon >= 0 else 'W'}")


def _name_from_geo_key(geo_key: str) -> str | None:
    """The place a fusion's own key names.

    "CTY:mx" is Mexico and "GEO:19.25,-99.25" is a point. Both were
    discarded in favour of "Unknown Location", which is the one thing the
    key never says.
    """
    key = str(geo_key or "")
    if key.startswith("CTY:"):
        code = key[4:].strip()
        try:
            from location_extract import country_name_from_code
            return country_name_from_code(code) or (code.upper() if code else None)
        except Exception:
            return code.upper() or None
    if key.startswith("GEO:") and "," in key:
        lat, _, lon = key[4:].partition(",")
        return _coord_name(lat.strip(), lon.strip())
    return None


class FusionEngine:
    def __init__(self):
        # geo_key → [signal, ...]
        self.active_signals: dict  = {}
        #: geo_key -> set of domains currently in that bucket.
        #: Maintained in _add_signal's existing pass so the
        #: single-domain check in _evaluate_fusion is O(1).
        self._bucket_domains: dict = {}
        # fusion_id → {fusion_id, title, ...}  (in-memory mirror of DB rows)
        self.active_fusions: dict  = {}
        # signal_id → fusion_id
        self.signal_to_fusion: dict = {}
        # Recent signal log (last 200, for /api/signals/recent)
        self._recent_signals: list = []
        #: Coalescing state. A bucket is evaluated at most once per
        #: EVAL_MIN_INTERVAL_S; signals that arrive inside that window mark
        #: it dirty instead, and the drain picks it up. See
        #: _request_fusion_eval for why this is the difference between a
        #: server that answers and one that does not.
        self._dirty: dict     = {}
        #: geo_key -> {n, since}. Arrival counters for the rate log above.
        self._sig_log: dict   = {}
        self._last_eval: dict = {}
        #: _evaluate_fusion mutates active_fusions and writes rows. It is
        #: reached both from on_signal (any ingest thread) and from the
        #: drain (the maintenance executor), so it needs a lock.
        self._eval_lock = threading.Lock()
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
        # An unlocated signal is still a signal: it is logged above and
        # stored below so it survives a restart and stays visible. It is
        # only kept out of the geographic correlation, which it could
        # never have contributed to honestly.
        correlatable = geo_key is not None
        if not correlatable:
            geo_key = UNLOCATED_KEY
        else:
            # ONE LINE PER SIGNAL IS THE OUTAGE, NOT THE DIAGNOSTIC.
            # GDELT arrives in bursts of hundreds into one bucket. Writing
            # a line for each blocks on a pipe nobody is draining, which is
            # log-rate backpressure — the same mechanism that killed seven
            # deploys here before. The useful fact is the RATE and where it
            # is going, so that is what gets reported, once a window.
            self._count_signal(geo_key, signal)
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

        if not correlatable:
            return

        self._request_fusion_eval(geo_key)

    def get_recent_signals(self, limit: int = 50) -> list:
        return list(reversed(self._recent_signals[-limit:]))

    def expire_old_signals(self):
        """Prune stale signals and mark DB fusions expired. Call every 15 min."""
        with self._eval_lock:
            self._expire_buckets()
        self._expire_db_fusions()

    def _expire_buckets(self):
        cutoff = datetime.datetime.utcnow() - timedelta(hours=self.fusion_window_hours)
        for geo_key in list(self.active_signals.keys()):
            self.active_signals[geo_key] = [
                s for s in self.active_signals[geo_key]
                if s["timestamp"] > cutoff
            ]
            if not self.active_signals[geo_key]:
                del self.active_signals[geo_key]
                self._bucket_domains.pop(geo_key, None)
                # The coalescing bookkeeping is keyed by geo_key too, and
                # nothing else ever removes an entry — every country and
                # zone that has ever seen a signal would keep one forever.
                self._dirty.pop(geo_key, None)
                self._last_eval.pop(geo_key, None)
            else:
                self._bucket_domains[geo_key] = {
                    s["domain"] for s in self.active_signals[geo_key]}

    def _expire_db_fusions(self):
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
        # A SIGNAL WITH NO PLACE CANNOT BE FUSED BY PLACE. Everything
        # that reached here — no region, no strategic zone, no country,
        # no coordinates — used to be dropped into one shared
        # "GEO:unknown" bucket, which then behaved like the busiest
        # location on earth. Measured live: 2,433 AIS and ADS-B signals
        # in it, re-evaluated in full on every single incoming signal,
        # on the event loop. That is where the backend's multi-second
        # stalls were coming from — a trivial query behind it took 15s.
        #
        # It was also wrong on its own terms. Fusion means several
        # independent domains reporting the SAME PLACE; "unknown" is not
        # a place, so any fusion point it produced corroborated nothing.
        # Returning None means the signal is still logged and still
        # persisted — it is simply not a candidate for geographic
        # correlation, which it never honestly was.
        return None

    def _count_signal(self, geo_key: str, signal: dict):
        """Report arrivals as a rate, once per window, per bucket."""
        now = time.time()
        st = self._sig_log.get(geo_key)
        if st is None:
            st = self._sig_log[geo_key] = {"n": 0, "since": now}
        st["n"] += 1
        if now - st["since"] >= SIGNAL_LOG_INTERVAL_S:
            held = len(self.active_signals.get(geo_key, ()))
            print(f"[FUSION] {geo_key}: {st['n']} signals in "
                  f"{now - st['since']:.0f}s (holding {held}"
                  f"{'/' + str(MAX_BUCKET) + ' CAPPED' if held >= MAX_BUCKET else ''}), "
                  f"latest {signal.get('domain')}")
            st["n"] = 0
            st["since"] = now

    def _add_signal(self, geo_key: str, signal: dict):
        # GUARDED BECAUSE INGEST IS NO LONGER SINGLE-THREADED. GDELT now
        # feeds from a worker thread (see main._gdelt_loop) while the drain
        # evaluates from the maintenance executor. Both touch
        # active_signals. The lock is taken and released here, and again
        # separately in _request_fusion_eval — never nested, so a plain
        # Lock is enough.
        with self._eval_lock:
            self._add_signal_locked(geo_key, signal)

    def _add_signal_locked(self, geo_key: str, signal: dict):
        bucket = self.active_signals.setdefault(geo_key, [])
        cutoff = datetime.datetime.utcnow() - timedelta(hours=self.fusion_window_hours)
        # ONE pass, not two. This runs per arriving signal against a
        # bucket that reached 10,012 entries for CTY:us in production,
        # and the domain set it collects on the way is what lets
        # _evaluate_fusion refuse a hopeless bucket in O(1).
        kept, ids, doms = [], set(), set()
        for s in bucket:
            if s["timestamp"] > cutoff:
                kept.append(s)
                ids.add(s["signal_id"])
                doms.add(s["domain"])
        if signal["signal_id"] not in ids:
            kept.append(signal)
            doms.add(signal["domain"])

        # A SIZE CAP, NOT JUST A TIME WINDOW. The window bounds how OLD a
        # bucket's contents are and says nothing about how many there are.
        # A country-level key such as CTY:us collects everything GDELT
        # reports for that country inside the window — it reached 10,012
        # entries in production — and the scan above runs once per
        # arriving signal, so a burst of n signals costs O(n²).
        #
        # Keeping the newest MAX_BUCKET is not a loss of meaning:
        # correlation across thousands of signals sharing only a country
        # is not a correlation, and _evaluate_fusion already refuses a
        # bucket that holds a single domain. What the cap removes is the
        # tail that was never going to change the answer.
        if len(kept) > MAX_BUCKET:
            kept = kept[-MAX_BUCKET:]
            doms = {s["domain"] for s in kept}

        self.active_signals[geo_key] = kept
        self._bucket_domains[geo_key] = doms

    def _domain_count(self, geo_key: str, signals: list) -> int:
        """How many distinct domains are in this bucket, cheaply.

        Uses the set maintained by _add_signal when it is there, and
        otherwise counts with an early exit — the restore path appends to
        active_signals directly, so the cache can legitimately be absent.
        Two is all the caller needs to know.
        """
        cached = self._bucket_domains.get(geo_key)
        if cached is not None:
            return len(cached)
        seen = set()
        for s in signals:
            seen.add(s.get("domain"))
            if len(seen) >= 2:
                break
        return len(seen)

    def _request_fusion_eval(self, geo_key: str):
        """Evaluate this bucket, but not more than once per interval.

        WHY THIS EXISTS. _evaluate_fusion is not cheap and _update_fusion,
        which it calls for any already-fused bucket, is expensive: it opens
        a DB session, runs score_cluster (two more DB queries), and may
        call the narrative model. All of that ran ONCE PER ARRIVING SIGNAL.

        GDELT does not arrive one signal at a time; it arrives in bursts of
        hundreds into the same geo bucket. In production zone:SZONE-004
        held 635 signals and climbing, and every one of those arrivals
        re-scored the whole bucket against the database on the event loop.
        The process stayed alive and kept logging while answering no HTTP
        at all — the signature is FUSION lines still streaming in the logs
        next to health checks that never complete.

        Coalescing costs nothing in fidelity. The evaluation that runs
        after a burst sees the same bucket the 300 skipped ones would have
        seen, only more of it. What it removes is 299 redundant re-scores
        of a verdict that had not changed.
        """
        now = time.monotonic()
        last = self._last_eval.get(geo_key)
        if last is not None and (now - last) < EVAL_MIN_INTERVAL_S:
            self._dirty[geo_key] = True
            return
        self._last_eval[geo_key] = now
        self._dirty.pop(geo_key, None)
        with self._eval_lock:
            self._evaluate_fusion(geo_key)

    def drain_pending_evaluations(self, max_buckets: int = 100) -> int:
        """Evaluate buckets that went dirty while throttled.

        Without this a bucket that stops receiving signals mid-throttle
        would never be evaluated again — the burst would be silently
        dropped rather than deferred. Called off the event loop.
        """
        now = time.monotonic()
        ready = [k for k in list(self._dirty)
                 if (now - self._last_eval.get(k, 0.0)) >= EVAL_MIN_INTERVAL_S]
        for geo_key in ready[:max_buckets]:
            self._dirty.pop(geo_key, None)
            self._last_eval[geo_key] = now
            try:
                with self._eval_lock:
                    self._evaluate_fusion(geo_key)
            except Exception as e:                           # noqa: BLE001
                # One bad bucket must not stop the drain, or a single
                # poisoned geo_key freezes fusion for every other one.
                print(f"[FUSION] drain error on {geo_key}: {e}")
        return min(len(ready), max_buckets)

    def _evaluate_fusion(self, geo_key: str):
        signals = self.active_signals.get(geo_key, [])
        if not signals:
            return

        # A SINGLE-DOMAIN BUCKET CAN NEVER FUSE. domain_diversity_score's
        # own docstring says so by construction, and the floor check below
        # already rejected every one of them — but only AFTER three O(n)
        # passes and two log lines, per arriving signal.
        #
        # In production CTY:us reached 10,012 signals, all GDELT. That is
        # 4.26ms of event-loop time and two log lines to reach a verdict
        # that was never in doubt, on every signal that arrived. GDELT
        # alone exceeds the ~235 signals/sec that leaves, and two lines
        # per signal crosses Railway's 500 logs/sec ceiling at the same
        # rate — at which point print() blocks on a backpressured pipe and
        # takes the event loop with it. The healthcheck then goes
        # unanswered and the platform kills a container that is, by its
        # own account, busy.
        #
        # So the verdict is reached first, and nothing is computed or
        # logged to reach it. Behaviour is unchanged: these buckets
        # returned here anyway.
        if self._domain_count(geo_key, signals) < 2:
            return

        # Once per evaluation, not once per arriving signal. This is the
        # line that shows a bucket growing without bound, so it is worth
        # keeping — at the coalesced rate it cannot itself flood the log.
        print(f"[FUSION] Active signals for {geo_key}: {len(signals)} | "
              f"domains={self._bucket_domains.get(geo_key) or '?'}")

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

    def _best_location_name(self, signals: list, geo_key: str = "") -> str:
        """A name for where this is, falling back to where it actually is.

        NO NAME IS NOT NO PLACE. A fusion only exists because its signals
        shared a position — the engine's own key is a coordinate, e.g.
        GEO:33.2500,134.2500 — so returning "Unknown Location" discards the
        one fact every signal in the bundle agrees on. AIS and GPS signals
        routinely carry lat/lon and no place string, which is why live
        fusions read "Unknown Location Intelligence Event" while sitting on
        a known point in the Philippine Sea.

        A coordinate is not as good as a name, and it is not pretending to
        be one. It is the truth, and an analyst can act on it.
        """
        for s in signals:
            if s.get("location_name") and not _COORDISH.match(str(s["location_name"])):
                return s["location_name"]
        # The waters or chokepoint it is in, named — the same describer the
        # notifications use — before a bare coordinate.
        lat, lon = self._centroid(signals)
        if lat is not None:
            try:
                import geo_land
                country = geo_land.country_at(lat, lon)
                if country:
                    coord = _coord_name(lat, lon)
                    return f"{country} · {coord}" if coord else country
            except Exception:                                # noqa: BLE001
                pass
            try:
                import notification_context as _nc
                d = _nc.describe_place(lat, lon)
                water = d.get("chokepoint") or d.get("waters")
                if water:
                    # The water named, the point kept: "North Pacific" alone
                    # is vaguer than the coordinate it replaced.
                    water = re.sub(r"^the\s+", "", str(water), flags=re.I)
                    coord = _coord_name(lat, lon)
                    return f"{water} · {coord}" if coord else water
            except Exception:                                # noqa: BLE001
                pass
        for s in signals:
            name = _coord_name(s.get("lat"), s.get("lon"))
            if name:
                return name

        # THE KEY ITSELF NAMES THE PLACE. A country-clustered fusion is
        # keyed "CTY:mx" and a grid one "GEO:19.25,-99.25" — both say where
        # this is, and both were being thrown away in favour of the words
        # "Unknown Location".
        from_key = _name_from_geo_key(geo_key)
        if from_key:
            return from_key

        return "Unknown Location"

    def _signal_radius_km(self, signals: list) -> float:
        coords = [(s["lat"], s["lon"]) for s in signals if s.get("lat") and s.get("lon")]
        if len(coords) < 2:
            return 0.0
        lat0, lon0 = coords[0]
        return max(_haversine_km(lat0, lon0, lat, lon) for lat, lon in coords[1:])

    def _centroid(self, signals: list):
        # WHERE SOMETHING WAS SEEN, not where an area's centre is. A GPS
        # interference signal is a 0.5° grid cell, its "position" the cell's
        # middle; averaged with a vessel at sea it put "Sanctioned vessel
        # VERA amid GPS jamming" at 52.25°N 14.25°E — inland Poland. Point
        # observations decide the position; area signals only when alone.
        def _xy(sig):
            try:
                return float(sig["lat"]), float(sig["lon"])
            except (KeyError, TypeError, ValueError):
                return None
        pts = [s for s in signals if str(s.get("domain") or "").upper() != "GPS" and _xy(s)] \
            or [s for s in signals if _xy(s)]
        coords = [_xy(s) for s in pts]
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
        # The signals say what happened and where; "<place> Intelligence
        # Event" said neither (fusion_title.py).
        from fusion_title import headline as _headline
        title = _headline(signals, location_name) or f"{location_name} Intelligence Event"
        return (
            title,
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
            # OPENAI WRITES THIS, NOT CLAUDE. Claude is reserved for
            # briefings and the decks built from them; everything else runs
            # on OpenAI under its own monthly cap. The validator below is
            # unchanged and still rejects anything the signals do not
            # support, so the writer swapped but the guard did not.
            import fusion_narrative as _fn
            written = _fn.write(signals, domains, severity, location_name,
                                score=score, item_id=item_id)
            if written is not None:
                title, subtitle, narrative, key_signals, threat_indicators = written
                ok, violations = self._validate_narrative(
                    narrative, key_signals, threat_indicators, signals, domains,
                    location_name, shared_entity_names)
                if ok:
                    return (title, subtitle, narrative, key_signals, threat_indicators)
                print(f"[fusion] narrative validator caught unsupported claim(s) "
                      f"{violations} — using the template instead", flush=True)
                return self._template_narrative(signals, domains, location_name)

            client = llm_gate.get_client("fusion_narrative")
            if client is None:
                # NOT AN ERROR, AND SAID ONCE. The purpose is switched off
                # or unconfigured, and the deterministic template is the
                # designed fallback — but this fell through to
                # `client.messages` anyway and logged
                # "[fusion] Haiku assessment error: 'NoneType' object has no
                # attribute 'messages'" once per fusion event, which makes a
                # feature that is merely off look like one that is broken.
                global _NARRATIVE_OFF_REPORTED
                if not _NARRATIVE_OFF_REPORTED:
                    print("[fusion] no narrative writer is available "
                          "(OpenAI 'fusion' purpose off or over budget, and "
                          "Claude is reserved for briefings) — every fusion "
                          "will use the deterministic template")
                    _NARRATIVE_OFF_REPORTED = True
                return self._template_narrative(signals, domains, location_name)

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
                client = llm_gate.get_client("fusion_narrative")
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
        location_name = self._best_location_name(signals, geo_key)

        # A FUSION WITHOUT A PLACE IS NOT PUBLISHED. It is a map object: an
        # analyst finds it by looking at where it is. One that cannot say
        # where it is cannot be checked, cannot be acted on, and sits in the
        # list implying something happened somewhere. 226 of 811 stored
        # fusions were in that state.
        #
        # Dropped rather than labelled, and said in the log, because the
        # fix for an unlocatable cluster is upstream in whatever produced
        # signals with no position.
        if location_name == "Unknown Location":
            print(f"[fusion] not creating a fusion for {geo_key or 'no key'}: "
                  f"{len(signals)} signal(s) across {len(domains)} domain(s) and "
                  f"no resolvable location", flush=True)
            return
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

        location_name = (existing.get("location_name")
                         or self._best_location_name(signals, geo_key))

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
                # THE DEDUP SET IS BUILT ONCE PER BUCKET, NOT PER ROW.
                # It used to be rebuilt inside this loop, which made the
                # restore O(rows x bucket size). In production that was
                # 72,045 rows against buckets reaching 10,012 entries:
                # the first restore took 194s and the second — which
                # loads nothing, because everything is already in memory —
                # took 419s, purely rebuilding sets to discover that.
                #
                # Those two calls are 613 of the 646 seconds this service
                # took to reach "Uvicorn running". Railway's healthcheck
                # window is 600. The container was killed 46 seconds
                # before the app it was waiting for finished starting, on
                # seven consecutive deploys.
                seen_by_key: dict = {}
                for row in rows:
                    try:
                        payload = _json.loads(row.payload or "{}")
                        if not payload.get("signal_id"):
                            payload["signal_id"] = row.signal_id
                        if not isinstance(payload.get("timestamp"), datetime.datetime):
                            payload["timestamp"] = row.created_at
                        geo_key = row.geo_key
                        # THE RESTORE PATH HAD THE SAME BUG AS THE LIVE
                        # ONE. Unlocated signals are persisted so they
                        # survive a restart and stay visible, under the
                        # marker key "GEO:unlocated" — but loading them
                        # back into active_signals put them straight into
                        # one shared bucket again, and on the next restart
                        # 287 of them were evaluated together and produced
                        # "Unknown Location Intelligence Event | 287
                        # signals / 2 domains". Fixing only on_signal()
                        # meant the bug came back every time the process
                        # restarted, which is exactly when nobody is
                        # watching the log.
                        #
                        # "Unknown" is not a place, so it is not a
                        # correlation bucket. These stay persisted and
                        # stay out of the geographic correlation.
                        if not geo_key or geo_key == UNLOCATED_KEY:
                            continue
                        bucket = self.active_signals.setdefault(geo_key, [])
                        ids = seen_by_key.get(geo_key)
                        if ids is None:
                            ids = seen_by_key[geo_key] = {
                                s["signal_id"] for s in bucket}
                        if row.signal_id not in ids:
                            bucket.append(payload)
                            ids.add(row.signal_id)
                            reloaded += 1
                    except Exception:
                        pass
                # The restore appends to active_signals directly, so the
                # domain cache _evaluate_fusion relies on is rebuilt here
                # rather than left stale. A stale cache would be the worst
                # kind of wrong: it would silently suppress fusions for a
                # bucket that had since become multi-domain.
                self._bucket_domains = {
                    k: {s["domain"] for s in v if s.get("domain")}
                    for k, v in self.active_signals.items()}
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
                        # Derived on read for rows stored with the old template
                        # title, so the fix reaches existing fusions at once.
                        "title":         (_fusion_headline(json.loads(row.key_signals or "[]"), row.location_name or "")
                                          if _fusion_is_template(row.title) else None) or row.title,
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
# THE SIGNAL RESTORE IS NOT DONE AT IMPORT ANY MORE. It reads every
# unexpired row of fusion_signals — 72,045 of them in production, off a
# network volume, materialised as ORM objects — and it ran here, before
# uvicorn had bound a socket. Together with the second restore in main's
# startup handler it accounted for 613 of the 646 seconds the service
# took to reach "Uvicorn running", against a 600-second healthcheck
# window. Seven consecutive deploys were killed 46 seconds short.
#
# The fusions above stay: that restore is small (10 rows, ~13s) and the
# signal restore's re-evaluation pass depends on it having happened.
# main.py now schedules the signal restore as a background task, so the
# process serves health checks while it runs.
