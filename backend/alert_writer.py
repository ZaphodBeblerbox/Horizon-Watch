"""
alert_writer.py — Persists forge alerts, news articles, and signals to SQLite.

All functions are synchronous — called from executor threads.
Dirty-region tracking triggers fast threat-matrix refreshes.
"""

from __future__ import annotations
import uuid
import json
import threading
import datetime
from typing import Optional

from database import get_db, Alert, NewsArticle

# ── Dedup cooldowns (hours) per alert type ─────────────────────────────────
_DEDUP_COOLDOWN: dict[str, int] = {
    "Sanctioned Vessel":     24,
    "SANCTIONED_VESSEL":     24,
    "Ship-to-Ship Transfer": 12,
    "STS_TRANSFER":          12,
    "Cable Loiterer":         6,
    "AIS_CABLE_LOITER":       6,
    "Dark Ship":              8,
    "AIS_DARK_SHIP":          8,
    "Military Squawk":        4,
    "ADSB_MILITARY_SQUAWK":   4,
}
_DEDUP_DEFAULT_HOURS = 3

# ── Correlation constants ──────────────────────────────────────────────────
_CORRELATION_RADIUS_KM    = 300
_CORRELATION_WINDOW_HOURS = 6


# ── ID generators ──────────────────────────────────────────────────────────

def _alert_id() -> str:
    return "ALT-" + uuid.uuid4().hex[:8].upper()


def _article_id() -> str:
    return "ART-" + uuid.uuid4().hex[:8].upper()


# ── Dirty-region tracking ──────────────────────────────────────────────────

_dirty_lock    = threading.Lock()
_dirty_regions: set[str] = set()
_dirty_timer:  dict[str, float] = {}   # region → epoch of last mark


def _mark_region_dirty(region: Optional[str]):
    if not region:
        return
    import time
    with _dirty_lock:
        _dirty_regions.add(region)
        _dirty_timer[region] = time.time()
    try:
        from event_bus import event_bus as _eb, Events as _Ev
        _eb.publish_sync(_Ev.THREAT_REGION_DIRTY, {"region": region})
    except Exception:
        pass


def pop_dirty_regions() -> set[str]:
    """Return and clear the dirty set (called by the 30-s threat-matrix refresh)."""
    with _dirty_lock:
        regions = set(_dirty_regions)
        _dirty_regions.clear()
        return regions


# ── Alert persistence ──────────────────────────────────────────────────────

def write_alert(alert_dict: dict) -> Optional[str]:
    """
    Persist a forge alert dict to the alerts table.
    Returns the alert_id on success, None on failure or duplicate.

    alert_dict keys used:
      title, source (ais|adsb|surge|fusion|manual), alert_type, severity,
      lat, lon, region, country_code, entity_type, entity_id, entity_name,
      zone_ids (list), tags (list), expires_at (datetime|None), raw (full dict)
    """
    try:
        alert_id = alert_dict.get("id") or _alert_id()
        region   = alert_dict.get("region") or None

        alert_type = str(alert_dict.get("alert_type") or alert_dict.get("rule_name") or alert_dict.get("type") or "unknown")
        entity_id  = str(alert_dict.get("entity_id") or alert_dict.get("mmsi") or alert_dict.get("icao") or "")
        source     = str(alert_dict.get("source") or alert_dict.get("domain") or "manual")
        severity   = str(alert_dict.get("severity") or "medium")

        # ── Dedup key: domain:entity_id:alert_type ────────────────────────
        dedup_key = f"{source}:{entity_id}:{alert_type}" if entity_id else ""

        row = Alert(
            alert_id        = alert_id,
            source          = source,
            alert_type      = alert_type,
            title           = str(alert_dict.get("title") or alert_dict.get("headline") or ""),
            severity        = severity,
            lat             = _float(alert_dict.get("lat")),
            lon             = _float(alert_dict.get("lon")),
            region          = region,
            country_code    = alert_dict.get("country_code") or None,
            entity_type     = alert_dict.get("entity_type") or None,
            entity_id       = entity_id,
            entity_name     = alert_dict.get("entity_name") or alert_dict.get("vessel_name") or alert_dict.get("callsign") or None,
            raw_json        = json.dumps(alert_dict, default=str),
            zone_ids        = json.dumps(alert_dict.get("zone_ids") or []),
            tags            = json.dumps(alert_dict.get("tags") or []),
            status          = "active",
            expires_at      = alert_dict.get("expires_at") or None,
            dedup_key       = dedup_key or None,
            fire_count      = 1,
        )

        with get_db() as db:
            # ── Exact alert_id dedup ──────────────────────────────────────
            existing = db.query(Alert).filter(Alert.alert_id == alert_id).first()
            if existing:
                return None

            # ── Rule-based cooldown dedup ─────────────────────────────────
            if dedup_key:
                cooldown_h = _DEDUP_COOLDOWN.get(alert_type, _DEDUP_DEFAULT_HOURS)
                cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=cooldown_h)
                dup = (db.query(Alert)
                       .filter(Alert.dedup_key == dedup_key,
                               Alert.created_at >= cutoff,
                               Alert.status == "active")
                       .first())
                if dup:
                    # Update position + bump fire count on existing entry
                    dup.fire_count  = (dup.fire_count or 1) + 1
                    if row.lat:  dup.lat = row.lat
                    if row.lon:  dup.lon = row.lon
                    db.commit()
                    print(f"[alert-writer] Dedup: {dedup_key} fired {dup.fire_count}x")
                    return dup.alert_id

            db.add(row)
            db.commit()
            saved_id = row.alert_id

            # ── Post-save: run correlation (same DB session is closed; open new) ──
            try:
                _correlate_alert(saved_id)
            except Exception as _ce:
                print(f"[alert-writer] Correlation error: {_ce}")

            alert_id = saved_id

        _mark_region_dirty(region)

        try:
            from event_bus import event_bus as _eb, Events as _Ev
            _eb.publish_sync(_Ev.ALERT_CREATED, {
                "alert_id": alert_id,
                "source":   row.source,
                "severity": row.severity,
                "title":    row.title,
                "lat":      row.lat,
                "lon":      row.lon,
                "region":   region,
            })
        except Exception:
            pass

        return alert_id

    except Exception as ex:
        print(f"[alert-writer] write_alert error: {ex}")
        return None


# ── Alert correlation ─────────────────────────────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl   = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _correlate_alert(alert_id: str) -> None:
    """Find nearby recent alerts from different domains and link them bidirectionally."""
    with get_db() as db:
        alert = db.query(Alert).filter(Alert.alert_id == alert_id).first()
        if not alert or not alert.lat or not alert.lon:
            return

        cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=_CORRELATION_WINDOW_HOURS)
        deg    = _CORRELATION_RADIUS_KM / 111.0

        nearby = db.query(Alert).filter(
            Alert.alert_id != alert_id,
            Alert.source   != alert.source,
            Alert.status   == "active",
            Alert.created_at >= cutoff,
            Alert.lat.between(alert.lat - deg, alert.lat + deg),
            Alert.lon.between(alert.lon - deg, alert.lon + deg),
        ).all()

        correlated = [
            other for other in nearby
            if _haversine_km(alert.lat, alert.lon, other.lat, other.lon) <= _CORRELATION_RADIUS_KM
        ]
        if not correlated:
            return

        domains_set  = {alert.source} | {o.source for o in correlated}
        domain_str   = "+".join(sorted(domains_set))
        n_domains    = len(domains_set)
        corr_score   = min(1.0, 0.3 * n_domains + 0.1 * len(correlated))
        score_boost  = 10 * (n_domains - 1)

        alert.correlated_alert_ids = json.dumps([o.alert_id for o in correlated])
        alert.correlation_score    = corr_score
        alert.correlation_domains  = domain_str
        alert.severity             = _upgrade_severity(alert.severity, n_domains)

        for other in correlated:
            other_ids = json.loads(other.correlated_alert_ids or "[]")
            if alert_id not in other_ids:
                other_ids.append(alert_id)
                other.correlated_alert_ids = json.dumps(other_ids)
            other.correlation_domains = domain_str
            other.correlation_score   = corr_score
            other.severity            = _upgrade_severity(other.severity, n_domains)

        db.commit()

        if n_domains >= 2:
            print(f"[alert-writer] Correlation: {domain_str} "
                  f"({len(correlated)} alerts within {_CORRELATION_RADIUS_KM}km) "
                  f"score={corr_score:.2f}")

        # Schedule analyst note for high/critical alerts
        if alert.severity in ("high", "critical") and not alert.analyst_note:
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(_async_analyst_note(alert_id))
            except Exception:
                pass


def _upgrade_severity(current: str, n_domains: int) -> str:
    """Boost severity when multi-domain correlation present."""
    order = ["low", "medium", "high", "critical"]
    idx   = order.index(current) if current in order else 1
    if n_domains >= 3 and idx < 3:
        idx = min(3, idx + 1)
    elif n_domains >= 2 and idx < 2:
        idx = 2
    return order[idx]


async def _async_analyst_note(alert_id: str) -> None:
    """Generate a Haiku analyst note for a high/critical alert."""
    try:
        import anthropic
        with get_db() as db:
            alert = db.query(Alert).filter(Alert.alert_id == alert_id).first()
            if not alert or alert.analyst_note:
                return

            raw = {}
            try:
                raw = json.loads(alert.raw_json or "{}")
            except Exception:
                pass

            corr_ctx = ""
            corr_ids = json.loads(alert.correlated_alert_ids or "[]")
            if corr_ids:
                corr_ctx = (f"\nThis alert correlates with {len(corr_ids)} other signals "
                            f"across {alert.correlation_domains} within 300km in the last 6 hours.")

            prompt = (
                f"Intelligence alert:\n"
                f"Domain: {alert.source}\nRule: {alert.alert_type}\n"
                f"Title: {alert.title}\nSeverity: {alert.severity}\n"
                f"Location: {alert.lat}, {alert.lon}\n"
                f"Country: {alert.country_code or 'Unknown'}\n"
                f"Zone context: {raw.get('zone_ids', [])}\n"
                f"{corr_ctx}\n\n"
                f"Write one paragraph (3-4 sentences) analyst note. "
                f"State what happened, where, why it matters operationally, and what to watch. "
                f"No preamble."
            )

            client = anthropic.Anthropic()
            msg    = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}],
            )
            note = msg.content[0].text.strip()
            alert.analyst_note = note[:600]
            db.commit()
            print(f"[alert-writer] Analyst note generated for {alert_id}")

    except Exception as e:
        print(f"[alert-writer] Analyst note failed for {alert_id}: {e}")


# ── News article persistence ───────────────────────────────────────────────

def write_news_article(article: dict) -> bool:
    """
    Upsert a news article dict into news_articles table.
    Returns True if inserted/updated, False on error or skip.

    article dict is the enriched article record from main.py's RSS pipeline.
    """
    url = article.get("url") or article.get("link") or ""
    if not url:
        return False

    try:
        entities_raw = article.get("entities") or []
        entities_json = json.dumps(entities_raw, default=str) if entities_raw else "[]"

        region = article.get("region") or None

        with get_db() as db:
            existing = db.query(NewsArticle).filter(NewsArticle.url == url).first()
            if existing:
                # Update intelligence fields if LLM data is now available
                if article.get("llm_extracted") and not existing.llm_extracted:
                    existing.article_type    = article.get("article_type") or existing.article_type
                    existing.tier            = _int(article.get("tier") or article.get("relevance_tier_num")) or existing.tier
                    existing.relevance_score = _float(article.get("llm_relevance_score")) or existing.relevance_score
                    existing.event_title     = article.get("event_title") or existing.event_title
                    existing.context_summary = article.get("context_summary") or existing.context_summary
                    existing.is_breaking     = bool(article.get("is_breaking"))
                    existing.llm_extracted   = True
                    existing.entities_json   = entities_json
                    db.commit()
                return True

            row = NewsArticle(
                url             = url,
                title           = str(article.get("title") or article.get("headline") or ""),
                source_name     = article.get("source_name") or article.get("feed_name") or None,
                published       = str(article.get("published") or article.get("pubDate") or ""),
                lat             = _float(article.get("lat")),
                lon             = _float(article.get("lon")),
                location_name   = article.get("location_name") or article.get("resolved_display_name") or None,
                country_code    = article.get("resolved_country_code") or article.get("country_code") or None,
                article_type    = article.get("article_type") or None,
                tier            = _int(article.get("tier") or article.get("relevance_tier_num")),
                relevance_score = _float(article.get("llm_relevance_score")),
                event_title     = article.get("event_title") or None,
                context_summary = article.get("context_summary") or None,
                is_breaking     = bool(article.get("is_breaking")),
                llm_extracted   = bool(article.get("llm_extracted")),
                entities_json   = entities_json,
                image_url       = article.get("image_url") or article.get("og_image") or None,
                body            = (article.get("body") or article.get("content") or "")[:4000],
                region          = region,
            )
            db.add(row)
            db.commit()

        _mark_region_dirty(region)

        try:
            from event_bus import event_bus as _eb, Events as _Ev
            _eb.publish_sync(_Ev.ARTICLE_CREATED, {"article": article, "url": url})
        except Exception:
            pass

        return True

    except Exception as ex:
        print(f"[alert-writer] write_news_article error: {ex}")
        return False


# ── Helpers ────────────────────────────────────────────────────────────────

def _float(v) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _int(v) -> Optional[int]:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None
