"""
surge_engine.py — Article surge detection.

Tracks per-(country, article_type) article volumes and detects:
  VOLUME_SURGE   — rolling count exceeds N× 7-day baseline
  VELOCITY_SPIKE — N articles arrive within a short burst window

On detection, creates a SurgeEvent in the DB, feeds the fusion engine
as a NEWS domain signal, and updates _surge_scores for threat heatmap.
"""

import json
import uuid
import datetime
from datetime import timedelta

ELIGIBLE_TYPES_DEFAULT = [
    "conflict", "maritime", "aviation",
    "infrastructure", "energy", "cyber", "disaster",
]

SEV_TO_BONUS = {"medium": 10, "high": 18, "critical": 25}

# Module-level cache: (country, region_id) → {score_bonus, expires_at}
# Read by threat_matrix.py to add surge_bonus to region scores.
_surge_scores: dict = {}


def _gen_id() -> str:
    return uuid.uuid4().hex[:6].upper()


class SurgeEngine:
    def __init__(self):
        # (country, article_type) → [{"ts": datetime, "title": str, "source": str}]
        self.article_buffer: dict  = {}
        # (country, article_type) → [datetime]  — last 60 min only
        self.velocity_buffer: dict = {}
        # (country, article_type) → expires_at datetime
        self.cooldown: dict = {}

    # ── Public API ────────────────────────────────────────────────────────────

    def on_article(self, article: dict):
        """
        Call for every new article after LLM extraction.
        article must have: article_type, location_country, location_name,
          region_id (nullable), lat (nullable), lon (nullable),
          title, source, relevance_score.
        """
        article_type = (article.get("article_type") or "").lower()
        country      = article.get("location_country") or article.get("resolved_country_code")
        if not country or not article_type:
            return

        config = self._load_config()
        if not config or not config.enabled:
            return

        try:
            eligible = json.loads(config.eligible_types or "[]")
        except (json.JSONDecodeError, TypeError):
            eligible = ELIGIBLE_TYPES_DEFAULT
        if article_type not in eligible:
            return

        key = (country, article_type)
        now = datetime.datetime.utcnow()

        # ── Update article buffer ──────────────────────────────────────────
        buf = self.article_buffer.setdefault(key, [])
        buf.append({
            "ts":     now,
            "title":  (article.get("title") or "")[:100],
            "source": (article.get("source") or "")[:50],
        })
        # Prune to baseline_days
        cutoff_bl = now - timedelta(days=config.baseline_days)
        self.article_buffer[key] = [e for e in buf if e["ts"] > cutoff_bl]

        # ── Update velocity buffer ─────────────────────────────────────────
        vbuf = self.velocity_buffer.setdefault(key, [])
        vbuf.append(now)
        cutoff_v = now - timedelta(minutes=60)
        self.velocity_buffer[key] = [t for t in vbuf if t > cutoff_v]

        # ── Check cooldown ─────────────────────────────────────────────────
        if self._in_cooldown(key, now):
            return

        # Velocity first (more urgent)
        self._check_velocity(key, article, config, now)
        if self._in_cooldown(key, now):
            return
        self._check_volume(key, article, config, now)

    def expire_old_surges(self):
        """Mark expired SurgeEvents. Call every 15 minutes."""
        try:
            from database import get_db as _gdb
            from sqlalchemy import text
            with _gdb() as db:
                db.execute(text(
                    "UPDATE surge_events SET status='expired' "
                    "WHERE expires_at < :now AND status='active'"
                ), {"now": datetime.datetime.utcnow()})
                db.commit()
        except Exception as e:
            print(f"[surge] expire error: {e}")

        # Prune stale surge_scores
        now = datetime.datetime.utcnow()
        for k in list(_surge_scores.keys()):
            if _surge_scores[k]["expires_at"] < now:
                del _surge_scores[k]

    # ── Private ───────────────────────────────────────────────────────────────

    def _load_config(self):
        try:
            from database import get_db as _gdb, SurgeConfig
            with _gdb() as db:
                cfg = db.query(SurgeConfig).first()
                if cfg is None:
                    cfg = SurgeConfig()
                    db.add(cfg)
                    db.commit()
                    db.refresh(cfg)
                # Return a plain dict so it outlives the session
                return _ConfigSnapshot(
                    enabled=cfg.enabled,
                    volume_window_hours=cfg.volume_window_hours,
                    volume_multiplier=cfg.volume_multiplier,
                    velocity_window_minutes=cfg.velocity_window_minutes,
                    velocity_threshold=cfg.velocity_threshold,
                    baseline_days=cfg.baseline_days,
                    eligible_types=cfg.eligible_types,
                    cooldown_minutes=cfg.cooldown_minutes,
                )
        except Exception as e:
            print(f"[surge] config load error: {e}")
            return None

    def _check_velocity(self, key, article, config, now):
        country, article_type = key
        window_start = now - timedelta(minutes=config.velocity_window_minutes)
        recent = [t for t in self.velocity_buffer.get(key, []) if t > window_start]
        if len(recent) < config.velocity_threshold:
            return
        severity = "critical" if len(recent) >= config.velocity_threshold * 2 else "high"
        self._fire_surge(
            surge_type="VELOCITY_SPIKE",
            article=article,
            article_type=article_type,
            country=country,
            article_count=len(recent),
            baseline_count=None,
            multiplier=None,
            time_window=f"{len(recent)} {article_type} articles in {config.velocity_window_minutes} minutes",
            severity=severity,
            config=config,
            now=now,
        )
        self._set_cooldown(key, now, config)

    def _check_volume(self, key, article, config, now):
        country, article_type = key
        buf = self.article_buffer.get(key, [])
        if not buf:
            return
        window_start = now - timedelta(hours=config.volume_window_hours)
        recent_count = sum(1 for e in buf if e["ts"] > window_start)

        # 7-day baseline: average articles per volume_window_hours
        oldest = min(e["ts"] for e in buf)
        days_of_data = max(1, min(config.baseline_days, (now - oldest).total_seconds() / 86400 + 1))
        baseline_per_window = (len(buf) / days_of_data) * (config.volume_window_hours / 24)
        if baseline_per_window < 3:
            return

        multiplier = recent_count / baseline_per_window
        if multiplier < config.volume_multiplier:
            return

        severity = "medium" if multiplier < 3 else "high" if multiplier < 5 else "critical"
        self._fire_surge(
            surge_type="VOLUME_SURGE",
            article=article,
            article_type=article_type,
            country=country,
            article_count=recent_count,
            baseline_count=round(baseline_per_window, 1),
            multiplier=round(multiplier, 2),
            time_window=f"{recent_count} {article_type} articles in {config.volume_window_hours}h ({multiplier:.1f}× above baseline)",
            severity=severity,
            config=config,
            now=now,
        )
        self._set_cooldown(key, now, config)

    def _fire_surge(self, *, surge_type, article, article_type, country,
                    article_count, baseline_count, multiplier, time_window,
                    severity, config, now):
        location_name = article.get("location_name") or country
        region_id     = article.get("region_id")
        lat           = article.get("lat")
        lon           = article.get("lon")
        headline      = f"{article_type.title()} {'spike' if surge_type == 'VELOCITY_SPIKE' else 'surge'} — {location_name}"

        key = (country, article_type)
        evidence = [
            {"title": e["title"], "source": e["source"]}
            for e in self.article_buffer.get(key, [])
            if e["ts"] > (now - timedelta(hours=max(config.volume_window_hours, 1)))
        ][:10]

        surge_id = f"SURGE-{_gen_id()}"
        try:
            from database import get_db as _gdb, SurgeEvent
            with _gdb() as db:
                ev = SurgeEvent(
                    surge_id=surge_id,
                    expires_at=now + timedelta(hours=6),
                    location_name=location_name,
                    location_country=country,
                    region_id=region_id,
                    lat=lat,
                    lon=lon,
                    article_type=article_type,
                    surge_type=surge_type,
                    article_count=article_count,
                    baseline_count=baseline_count,
                    multiplier=multiplier,
                    time_window_description=time_window,
                    severity=severity,
                    headline=headline,
                    evidence_items=json.dumps(evidence),
                    status="active",
                )
                db.add(ev)
                db.commit()
            print(f"[surge] {surge_type}: {headline} | {time_window} | sev={severity}")
        except Exception as e:
            print(f"[surge] DB write error: {e}")
            return

        # Persist as Alert + create OntologyLinks + mark region dirty
        try:
            from alert_writer import write_alert as _write_alert, _mark_region_dirty as _mrd
            from entity_linker import entity_linker as _el
            _write_alert({
                "id":         surge_id,
                "source":     "surge",
                "alert_type": f"surge_{surge_type.lower()}",
                "title":      headline,
                "severity":   severity,
                "lat":        lat,
                "lon":        lon,
                "region":     region_id,
                "country_code": country,
            })
            _el.link_alert(surge_id, "surge", lat, lon, headline)
            _mrd(region_id)
        except Exception as _aw_e:
            print(f"[surge] alert persist error: {_aw_e}")

        # Feed fusion engine
        try:
            from fusion_engine import fusion_engine as _fe
            _fe.on_signal({
                "signal_id":     f"SURGE-{surge_id}",
                "domain":        "NEWS",
                "severity":      severity,
                "lat":           lat,
                "lon":           lon,
                "location_name": location_name,
                "region_id":     region_id,
                "country":       country,
                "timestamp":     now,
                "alert_id":      None,
                "assessment_id": None,
                "rule_id":       None,
                "rule_name":     f"SURGE: {article_type} {surge_type}",
                "summary":       f"{headline} — {time_window}",
            })
        except Exception as e:
            print(f"[surge] fusion signal error: {e}")

        # Update threat matrix score cache
        _surge_scores[(country, region_id)] = {
            "score_bonus": SEV_TO_BONUS.get(severity, 10),
            "expires_at":  now + timedelta(hours=6),
        }

    def _in_cooldown(self, key, now) -> bool:
        exp = self.cooldown.get(key)
        return exp is not None and now < exp

    def _set_cooldown(self, key, now, config):
        self.cooldown[key] = now + timedelta(minutes=config.cooldown_minutes)

    def get_buffer_stats(self) -> dict:
        return {
            "total_locations_tracked": len(self.article_buffer),
            "total_articles_buffered": sum(len(v) for v in self.article_buffer.values()),
        }


class _ConfigSnapshot:
    """Lightweight snapshot so config values outlive the DB session."""
    __slots__ = (
        "enabled", "volume_window_hours", "volume_multiplier",
        "velocity_window_minutes", "velocity_threshold", "baseline_days",
        "eligible_types", "cooldown_minutes",
    )
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


# Module-level singleton
surge_engine = SurgeEngine()
