"""routers/intelligence.py — /api/v2/* unified event intelligence endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

import event_store as es

router = APIRouter(tags=["intelligence"])


@router.get("/api/v2/events")
def get_unified_events(
    south:         float = Query(None),
    north:         float = Query(None),
    west:          float = Query(None),
    east:          float = Query(None),
    theater:       str   = Query(None),
    min_severity:  str   = Query("low"),
    max_age_hours: int   = Query(72),
    limit:         int   = Query(200),
    mode:          str   = Query("threads"),  # "threads" or "events"
):
    """
    Unified event endpoint. Returns threaded or individual events.
    theater: region name from scoring.REGION_BBOXES (e.g. "Middle East")
    mode: "threads" returns grouped story threads, "events" returns individual events
    """
    from scoring import REGION_BBOXES
    # Late import to access _ACTIVE_PROFILE from main without circular dep
    import main as _m

    bbox = None
    if theater and theater in REGION_BBOXES and REGION_BBOXES[theater]:
        s, n, w, e = REGION_BBOXES[theater]
        bbox = (s, n, w, e)
    elif None not in (south, north, west, east):
        bbox = (south, north, west, east)
    elif _m._ACTIVE_PROFILE:
        focus = _m._ACTIVE_PROFILE.get("focusRegions", [])
        for region in focus:
            if region in REGION_BBOXES and REGION_BBOXES[region]:
                s, n, w, e = REGION_BBOXES[region]
                bbox = (s, n, w, e)
                break

    if mode == "threads":
        results = es.get_threads(
            theater_bbox=bbox,
            min_severity=min_severity,
            max_age_hours=max_age_hours,
            limit=limit,
        )
    else:
        results = es.get_active_events(
            theater_bbox=bbox,
            min_severity=min_severity,
            max_age_hours=max_age_hours,
            limit=limit,
        )

    return {
        "events":      results,
        "count":       len(results),
        "theater":     theater,
        "bbox":        bbox,
        "mode":        mode,
        "store_stats": es.get_store_stats(),
    }


@router.get("/api/v2/events/stats")
def get_event_store_stats():
    """Debug endpoint — show event store statistics."""
    return es.get_store_stats()


@router.get("/api/v2/events/{event_id}")
def get_unified_event(event_id: str):
    """Get a single event or thread by ID."""
    with es._THREAD_STORE_LOCK:
        thread = es._THREAD_STORE.get(event_id) or es._THREAD_STORE.get(f"thread_{event_id}")
    if thread:
        return {"type": "thread", "data": thread}
    with es._EVENT_STORE_LOCK:
        event = es._EVENT_STORE.get(event_id)
    if event:
        return {"type": "event", "data": event}
    raise HTTPException(status_code=404, detail="Event not found")


@router.get("/api/v2/notifications")
def get_recent_notifications(
    theater:       str = Query(None),
    limit:         int = Query(10),
    max_age_hours: int = Query(6),
):
    """
    Returns recent significant events for the notification bar.
    Sorted by published time descending. Only returns elevated+ severity.
    """
    from scoring import REGION_BBOXES
    import main as _m

    bbox = None
    if theater and theater in REGION_BBOXES and REGION_BBOXES[theater]:
        s, n, w, e = REGION_BBOXES[theater]
        bbox = (s, n, w, e)
    elif _m._ACTIVE_PROFILE:
        focus = _m._ACTIVE_PROFILE.get("focusRegions", [])
        for region in focus:
            if region in REGION_BBOXES and REGION_BBOXES[region]:
                s, n, w, e = REGION_BBOXES[region]
                bbox = (s, n, w, e)
                break

    events = es.get_active_events(
        theater_bbox=bbox,
        min_severity="elevated",
        max_age_hours=max_age_hours,
        limit=limit * 3,
    )
    events.sort(key=lambda e: e.get("published", ""), reverse=True)

    TYPE_ICONS = {
        "airstrike": "✦", "missile": "↑", "armed_clash": "✕",
        "explosion": "◉", "maritime": "▲", "protest": "◆",
        "earthquake": "⊕", "fire": "◈", "assassination": "◎",
        "coerce": "!", "general": "●",
    }
    notifications = []
    for ev in events[:limit]:
        notifications.append({
            "id":           ev["id"],
            "icon":         TYPE_ICONS.get(ev.get("event_type", "general"), "●"),
            "clean_title":  ev.get("clean_title", ""),
            "location":     ev.get("location", ""),
            "event_type":   ev.get("event_type", "general"),
            "severity_tier": ev.get("severity_tier", "low"),
            "published":    ev.get("published", ""),
            "lat":          ev.get("lat"),
            "lon":          ev.get("lon"),
            "source_name":  ev.get("source_name", ""),
        })

    return {"notifications": notifications, "count": len(notifications)}
