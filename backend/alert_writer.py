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
from provenance import provenance_for_alert_source


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
        source   = str(alert_dict.get("source") or "manual")
        # Real provenance (Parallax translation step 1, Part 2) — populated
        # per real Alert.source at write time (source varies row to row,
        # unlike the single-source tables); (None, None) for surge/fusion/
        # manual, which the real mapping table doesn't cover — left
        # honestly unclassified rather than guessed at.
        origin_class, licence_tier = provenance_for_alert_source(source)

        # ── Key-name fallbacks ────────────────────────────────────────
        # Not cosmetic. A 2026-09 audit of 346,570 active alerts found 87% of
        # the table unusable because three producer key names were never
        # read here:
        #
        #   * the AIS and ADS-B detectors emit "lng", not "lon"  → 302,284
        #     rows stored lon = NULL, i.e. unplottable and unplaceable by any
        #     geographic rule, while the real longitude sat in raw_json.
        #   * those detectors type their output with "rule_name"/
        #     "rule_trigger", not "alert_type"  → 290,119 rows typed
        #     "unknown" that are really AIS_DARK_SHIP (286,436),
        #     AIS_POSITION_JUMP (2,430) and AIS_LOITERING_NEAR_CABLE (1,237).
        #   * they put their prose in "message", not "title"  → 302,274 rows
        #     with an empty title.
        #
        # Every fallback is additive and ordered so an explicit key always
        # wins; a producer that already sets the canonical name is unaffected.
        alert_type = str(
            alert_dict.get("alert_type")
            or alert_dict.get("type")
            or alert_dict.get("rule_name")
            or alert_dict.get("rule_trigger")
            or "unknown"
        )
        lat = _float(alert_dict.get("lat"))
        lon = _float(alert_dict.get("lon"))
        if lon is None:
            lon = _float(alert_dict.get("lng"))
        if lon is None:
            lon = _float(alert_dict.get("longitude"))
        if lat is None:
            lat = _float(alert_dict.get("latitude"))

        title = str(
            alert_dict.get("title") or alert_dict.get("headline") or ""
        ).strip()

        # Last resort only: a title that is empty, or that is nothing but a
        # publication date (GeoConfirmed's placemark names are dates — 3,305
        # alerts titled "02 SEP 2026"), is replaced by a sentence built from
        # the facts the alert already carries. An informative title is never
        # touched.
        try:
            import notification_context as _nc
            if _nc.is_dateish_title(title):
                built = _nc.headline({**alert_dict, "alert_type": alert_type,
                                      "title": title, "lat": lat, "lon": lon,
                                      "raw": alert_dict})
                if built:
                    title = built
        except Exception as _e:
            print(f"[alert-writer] headline build skipped: {_e}")

        row = Alert(
            alert_id        = alert_id,
            source          = source,
            alert_type      = alert_type,
            title           = title,
            severity        = str(alert_dict.get("severity") or "medium"),
            lat             = lat,
            lon             = lon,
            region          = region,
            country_code    = alert_dict.get("country_code") or None,
            entity_type     = alert_dict.get("entity_type") or None,
            entity_id       = str(alert_dict.get("entity_id") or alert_dict.get("mmsi") or alert_dict.get("icao") or ""),
            entity_name     = alert_dict.get("entity_name") or alert_dict.get("vessel_name") or alert_dict.get("callsign") or None,
            raw_json        = json.dumps(alert_dict, default=str),
            zone_ids        = json.dumps(alert_dict.get("zone_ids") or []),
            tags            = json.dumps(alert_dict.get("tags") or []),
            origin_class    = origin_class,
            licence_tier    = licence_tier,
            status          = "active",
            expires_at      = alert_dict.get("expires_at") or None,
        )

        with get_db() as db:
            # Deduplicate by alert_id if it already exists
            existing = db.query(Alert).filter(Alert.alert_id == alert_id).first()
            if existing:
                return None
            db.add(row)
            db.commit()

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
