"""
event_bridge.py — Bridges existing Horizon Watch data pipelines into the
unified event store.

Reads from:
- _NEWS_ARTICLE_STORE (RSS articles, geocoded)
- _NEWS_CONFLICT_MARKERS (classified conflict markers)
- GDELT cache (geographic signals)

Writes into:
- event_store._EVENT_STORE (unified store)

Runs every 2 minutes as a background task.
"""

from __future__ import annotations
import asyncio
import time
from datetime import datetime, timezone

import event_store as es


async def bridge_loop(get_news_store_fn, get_conflict_markers_fn, get_gdelt_fn, save_path: str = None):
    """
    Main bridge loop. Runs every 2 minutes.

    Args are callables that return the current state of each data store,
    passed in from main.py to avoid circular imports.
    save_path: if set, persists the event store to disk every 10 minutes.
    """
    print("[event-bridge] starting bridge loop")
    _last_save = 0.0
    while True:
        try:
            await asyncio.get_event_loop().run_in_executor(
                None,
                _run_bridge_sync,
                get_news_store_fn,
                get_conflict_markers_fn,
                get_gdelt_fn,
            )
        except Exception as ex:
            print(f"[event-bridge] error: {ex}")
        # Save to disk every 10 minutes if a path was provided
        if save_path and time.time() - _last_save >= 600:
            try:
                es.save_to_disk(save_path)
                _last_save = time.time()
            except Exception as ex:
                print(f"[event-bridge] disk save error: {ex}")
        await asyncio.sleep(120)  # every 2 minutes


def _run_bridge_sync(get_news_store_fn, get_conflict_markers_fn, get_gdelt_fn):
    """Synchronous bridge — ingest all current data into event store."""
    ingested = 0

    # ── Bridge RSS articles ────────────────────────────────────────────────
    try:
        news_store = get_news_store_fn()
        for url, article in news_store.items():
            lat = article.get('lat')
            lon = article.get('lon')
            if lat is None or lon is None:
                continue
            title = article.get('title') or article.get('headline') or ''
            if not title:
                continue
            result = es.ingest_event(
                source='rss',
                title=title,
                url=url,
                lat=float(lat),
                lon=float(lon),
                location=article.get('location_name') or article.get('resolved_display_name') or '',
                country_code=article.get('resolved_country_code') or '',
                published=article.get('published') or article.get('pubDate') or '',
                body=article.get('body') or article.get('content') or '',
                summary=article.get('summary') or article.get('description') or '',
                image_url=article.get('image_url') or article.get('og_image') or article.get('urlToImage') or '',
                source_name=article.get('source_name') or article.get('feed_name') or '',
                significance_score=int(article.get('relevance_score') or 50),
            )
            if result:
                ingested += 1
    except Exception as ex:
        print(f"[event-bridge] RSS bridge error: {ex}")

    # ── Bridge conflict markers ────────────────────────────────────────────
    try:
        markers = get_conflict_markers_fn()
        for m in markers:
            lat = m.get('lat')
            lon = m.get('lon')
            if lat is None or lon is None:
                continue
            result = es.ingest_event(
                source='rss_classified',
                title=m.get('headline') or m.get('title') or '',
                url=m.get('url') or '',
                lat=float(lat),
                lon=float(lon),
                location=m.get('location') or m.get('location_name') or '',
                country_code=m.get('country_code') or '',
                published=m.get('published') or '',
                summary=m.get('context') or m.get('summary') or '',
                image_url=m.get('image_url') or '',
                source_name=m.get('source_name') or '',
                event_type=m.get('type') or m.get('event_type') or '',
                severity_tier=m.get('severity_tier') or '',
                significance_score=int(m.get('relevance_score') or m.get('significance_score') or 50),
            )
            if result:
                ingested += 1
    except Exception as ex:
        print(f"[event-bridge] conflict marker bridge error: {ex}")

    # ── Bridge GDELT as signal amplifier ──────────────────────────────────
    try:
        gdelt_cache = get_gdelt_fn()
        events = gdelt_cache.get('events', []) if isinstance(gdelt_cache, dict) else []
        for ev in events:
            lat = ev.get('lat')
            lon = ev.get('lon')
            if lat is None or lon is None:
                continue
            goldstein = float(ev.get('goldstein') or 0)
            if goldstein >= -1.0:  # Only ingest negative (conflict) events
                continue
            title = (
                ev.get('headline') or
                ev.get('summary') or
                f"GDELT signal: {ev.get('location_name', 'unknown location')}"
            )
            result = es.ingest_event(
                source='gdelt',
                title=title,
                url=ev.get('source_url') or '',
                lat=float(lat),
                lon=float(lon),
                location=ev.get('location_name') or ev.get('location') or '',
                country_code=ev.get('action_geo_country_code') or ev.get('country_code') or '',
                published=str(ev.get('event_date') or ev.get('date') or ''),
                event_type=ev.get('event_type') or 'conflict_zone',
                gdelt_goldstein=goldstein,
                gdelt_mentions=int(ev.get('mentions') or ev.get('num_mentions') or 0),
                significance_score=max(10, min(70, int(abs(goldstein) * 7))),
            )
            if result:
                ingested += 1
    except Exception as ex:
        print(f"[event-bridge] GDELT bridge error: {ex}")

    # ── Purge expired events ──────────────────────────────────────────────
    purged = es.purge_expired()

    # ── Build threads (every 5 minutes) ──────────────────────────────────
    if time.time() - es._LAST_THREAD_BUILD > 300:
        es.build_threads()

    stats = es.get_store_stats()
    print(f"[event-bridge] ingested={ingested} purged={purged} active={stats['active_events']} threads={stats['thread_count']}")
