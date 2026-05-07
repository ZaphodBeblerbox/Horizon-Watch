"""
event_store.py — Unified intelligence event store for Horizon Watch.

Merges GDELT signals, RSS news articles, USGS earthquakes, and other sources
into a single coherent event store with threading, confidence scoring, and
infrastructure relevance assessment.

Architecture:
- All sources feed into _EVENT_STORE (dict keyed by content hash)
- Background thread groups related events into threads
- Events expire after 72 hours (configurable)
- Theater filter applies at query time, not ingest time
- No Claude calls — all logic is deterministic Python
"""

from __future__ import annotations
import hashlib
import math
import re
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Optional

# ── Infrastructure relevance matrix ──────────────────────────────────────────
# Only these infrastructure types are shown for each event type.
# This prevents irrelevant infrastructure (pharmacies, coffee shops) from
# cluttering the analyst view.
INFRA_RELEVANCE: dict[str, list[str]] = {
    "airstrike":    ["airport", "military_base", "military_airfield", "power_plant", "port", "radar"],
    "missile":      ["airport", "military_base", "power_plant", "port", "chokepoint"],
    "armed_clash":  ["military_base", "hospital", "checkpoint", "police"],
    "explosion":    ["hospital", "power_plant", "pipeline", "port"],
    "maritime":     ["port", "chokepoint", "naval_base", "pipeline"],
    "earthquake":   ["hospital", "power_plant", "airport", "port", "dam"],
    "protest":      ["government", "police", "military_base"],
    "fire":         ["hospital", "power_plant", "pipeline", "airport"],
    "chemical":     ["hospital", "power_plant", "military_base"],
    "nuclear":      ["hospital", "power_plant", "military_base", "port"],
    "flood":        ["hospital", "power_plant", "airport", "dam"],
    "conflict_zone":["military_base", "hospital", "airport", "power_plant"],
    "general":      ["hospital", "airport", "military_base"],
}

# ── Event type classifier keywords ───────────────────────────────────────────
# Keywords use whole-word matching via _kw_match() below.
# Short words like "sea" and "port" caused massive false positives via
# substring matching ("transport"→port, "disease"→sea, "reports"→port).
EVENT_TYPE_KEYWORDS: dict[str, list[str]] = {
    "airstrike":    ["airstrike", "airstrikes", "air strike", "bombing", "bombed", "warplane", "bomber", "drone strike", "air raid"],
    "missile":      ["missile", "missiles", "ballistic", "cruise missile", "rocket attack", "rocket fire"],
    "armed_clash":  ["clash", "clashes", "fighting", "battle", "gunfire", "shooting", "killed", "wounded", "combat", "offensive", "troops", "soldiers", "rebels", "casualties"],
    "explosion":    ["explosion", "blast", "bomb", "detonation", "ied", "car bomb", "suicide bomb"],
    "maritime":     ["warship", "naval", "navy", "tanker", "piracy", "sea mine", "drone boat", "ship seized", "vessel seized", "coast guard"],
    "protest":      ["protest", "protests", "demonstration", "rally", "riot", "riots", "unrest", "uprising"],
    "earthquake":   ["earthquake", "tremor", "seismic", "magnitude", "quake"],
    "fire":         ["wildfire", "forest fire", "blaze", "inferno", "arson"],
    "chemical":     ["chemical attack", "gas attack", "nerve agent", "chlorine", "sarin"],
    "assassination":["assassinated", "targeted killing", "shot dead", "executed"],
    "coerce":       ["sanctions", "threatens", "ultimatum", "ceasefire"],
}

# ── Actor extraction patterns ─────────────────────────────────────────────────
KNOWN_ACTORS = [
    "Israel", "IDF", "Israeli", "Hezbollah", "Hamas", "Islamic Jihad",
    "Iran", "IRGC", "Iranian", "Houthi", "Yemen", "Saudi Arabia",
    "Russia", "Ukraine", "NATO", "US", "American", "France", "UK",
    "Syria", "Assad", "Turkey", "ISIS", "Al-Qaeda", "PKK",
    "China", "Taiwan", "North Korea", "South Korea",
    "Ethiopia", "Eritrea", "Sudan", "Somalia", "Al-Shabaab",
]

# ── Clean title patterns ──────────────────────────────────────────────────────
_TITLE_STRIP = [
    re.compile(r'^(BREAKING|UPDATE|WATCH|EXCLUSIVE|ALERT):\s*', re.I),
    re.compile(r'\s*[-–—]\s*(Reuters|AP|AFP|BBC|CNN|Al Jazeera|Guardian|Times|Fox)\s*$', re.I),
    re.compile(r'\s*(says|according to|reports say|officials say|sources say).*$', re.I),
    re.compile(r'\s*\|\s*.*$'),
    re.compile(r'^\d{4}-\d{2}-\d{2}[T\s][\d:]+\s*'),
]


def clean_title(headline: str, max_len: int = 80) -> str:
    """Strip filler phrases and truncate to clean analyst-style title."""
    if not headline:
        return "Unknown event"
    t = headline.strip()
    for pattern in _TITLE_STRIP:
        t = pattern.sub('', t).strip()
    if len(t) > max_len:
        t = t[:max_len-3].rsplit(' ', 1)[0] + '...'
    return t or headline[:max_len]


def classify_event_type(title: str, body: str = '') -> str:
    """Classify event type from title and body text using whole-word matching."""
    text = (title + ' ' + body).lower()
    scores = {etype: 0 for etype in EVENT_TYPE_KEYWORDS}
    for etype, keywords in EVENT_TYPE_KEYWORDS.items():
        for kw in keywords:
            # Use word-boundary regex to avoid substring false positives:
            # "port" must not match "transport", "sea" must not match "disease".
            if re.search(r'\b' + re.escape(kw) + r'\b', text):
                scores[etype] += 1
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else 'general'


def extract_actors(title: str, body: str = '') -> list[str]:
    """Extract known actors mentioned in the text."""
    text = title + ' ' + body
    found = []
    for actor in KNOWN_ACTORS:
        if actor.lower() in text.lower() and actor not in found:
            found.append(actor)
    return found[:4]  # Max 4 actors


def extract_casualties(text: str) -> Optional[str]:
    """Extract casualty information from text using regex."""
    patterns = [
        re.compile(r'(\d+)\s+(?:people\s+)?(?:killed|dead|died)', re.I),
        re.compile(r'(\d+)\s+(?:people\s+)?(?:wounded|injured|hurt)', re.I),
        re.compile(r'killed\s+(?:at least\s+)?(\d+)', re.I),
        re.compile(r'(\d+)\s+casualties', re.I),
    ]
    results = []
    for p in patterns:
        m = p.search(text)
        if m:
            results.append(m.group(0))
    return '; '.join(results[:2]) if results else None


def event_content_hash(url: str = '', title: str = '', lat: float = 0, lon: float = 0) -> str:
    """Generate stable content hash for deduplication."""
    if url:
        return hashlib.sha256(url.encode()).hexdigest()[:16]
    key = f"{title[:50]}_{round(lat,2)}_{round(lon,2)}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in km between two lat/lon points."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def keyword_overlap(text1: str, text2: str) -> float:
    """Calculate keyword overlap ratio between two texts (0-1)."""
    stop = {'the','a','an','is','in','of','to','and','or','for','on','at','by','with','from','that','this','was','are','were','has','have','had','be','been','it','its','he','she','they','we','i','as','up','but','not','no','so','if','than','then','when','where','who','what','how'}
    w1 = set(re.findall(r'\b\w{4,}\b', text1.lower())) - stop
    w2 = set(re.findall(r'\b\w{4,}\b', text2.lower())) - stop
    if not w1 or not w2:
        return 0.0
    return len(w1 & w2) / min(len(w1), len(w2))


# ── Event Store ───────────────────────────────────────────────────────────────

_EVENT_STORE: dict[str, dict] = {}
_EVENT_STORE_LOCK = threading.Lock()
_THREAD_STORE: dict[str, dict] = {}
_THREAD_STORE_LOCK = threading.Lock()
_LAST_THREAD_BUILD: float = 0.0

EVENT_TTL_HOURS = 72  # Events expire after 72 hours


def ingest_event(
    source: str,
    title: str,
    url: str = '',
    lat: float = 0.0,
    lon: float = 0.0,
    location: str = '',
    country_code: str = '',
    published: Optional[str] = None,
    body: str = '',
    summary: str = '',
    image_url: str = '',
    source_name: str = '',
    event_type: str = '',
    severity_tier: str = '',
    significance_score: int = 0,
    gdelt_goldstein: float = 0.0,
    gdelt_mentions: int = 0,
    location_confidence: str = '',
    extra: dict = None,
) -> Optional[str]:
    """
    Ingest a single event into the unified store.
    Returns the event ID if successfully ingested, None if duplicate/filtered.
    """
    if not title or lat == 0.0 or lon == 0.0:
        return None

    event_id = event_content_hash(url, title, lat, lon)
    now = datetime.now(timezone.utc)

    with _EVENT_STORE_LOCK:
        existing = _EVENT_STORE.get(event_id)
        if existing:
            # Update corroboration count and sources
            existing['corroboration_count'] = existing.get('corroboration_count', 1) + 1
            if source_name and source_name not in existing.get('sources', []):
                existing.setdefault('sources', []).append(source_name)
            # Boost significance for corroborated events
            existing['significance_score'] = min(100, existing.get('significance_score', 0) + 10)
            # Upgrade generic event_type to a specific one if we have better info.
            # This corrects events that were stored before the bridge classifier was
            # refined (previously everything mapped to "conflict" or "general").
            _GENERIC_TYPES = {'general', 'conflict', 'energy', 'telecom', 'aviation', ''}
            stored_type = existing.get('event_type', 'general')
            if stored_type in _GENERIC_TYPES:
                reclassified = classify_event_type(title, body or summary)
                if reclassified not in _GENERIC_TYPES:
                    existing['event_type'] = reclassified
                    existing['infra_types'] = INFRA_RELEVANCE.get(reclassified, INFRA_RELEVANCE['general'])
            return event_id

        # Classify event type if not provided
        if not event_type:
            event_type = classify_event_type(title, body or summary)

        # Calculate severity tier if not provided
        if not severity_tier:
            if significance_score >= 80 or gdelt_goldstein <= -7:
                severity_tier = 'critical'
            elif significance_score >= 60 or gdelt_goldstein <= -5:
                severity_tier = 'significant'
            elif significance_score >= 40 or gdelt_goldstein <= -3:
                severity_tier = 'elevated'
            else:
                severity_tier = 'low'

        # Extract actors and casualties from text
        full_text = title + ' ' + (body or summary or '')
        actors = extract_actors(title, body or summary)
        casualties = extract_casualties(full_text)

        # Clean the title
        clean = clean_title(title)

        # Calculate expiry
        pub_dt = None
        if published:
            try:
                pub_dt = datetime.fromisoformat(published.replace('Z', '+00:00'))
            except Exception:
                pass
        pub_dt = pub_dt or now
        expires_at = (pub_dt + timedelta(hours=EVENT_TTL_HOURS)).isoformat()

        event = {
            'id': event_id,
            'source': source,
            'source_name': source_name or source,
            'sources': [source_name or source] if source_name else [source],
            'title': title,
            'clean_title': clean,
            'url': url,
            'lat': lat,
            'lon': lon,
            'location': location,
            'country_code': country_code,
            'published': pub_dt.isoformat(),
            'ingested_at': now.isoformat(),
            'body': body[:2000] if body else '',  # Cap body at 2000 chars
            'summary': summary[:500] if summary else '',
            'image_url': image_url,
            'event_type': event_type,
            'severity_tier': severity_tier,
            'significance_score': significance_score or 50,
            'actors': actors,
            'casualties': casualties,
            'gdelt_goldstein': gdelt_goldstein,
            'gdelt_mentions': gdelt_mentions,
            'location_confidence': location_confidence,
            'corroboration_count': 1,
            'thread_id': None,
            'infra_types': INFRA_RELEVANCE.get(event_type, INFRA_RELEVANCE['general']),
            'expires_at': expires_at,
            **(extra or {}),
        }

        _EVENT_STORE[event_id] = event
        return event_id


def get_active_events(
    theater_bbox: Optional[tuple] = None,
    event_types: Optional[list] = None,
    min_severity: str = 'low',
    max_age_hours: int = 72,
    limit: int = 200,
) -> list[dict]:
    """
    Query active events from the store.

    Args:
        theater_bbox: (south, north, west, east) tuple or None for global
        event_types: filter to specific event types or None for all
        min_severity: minimum severity tier ('low', 'elevated', 'significant', 'critical')
        max_age_hours: only return events published within this many hours
        limit: maximum events to return
    """
    TIER_RANK = {'low': 0, 'elevated': 1, 'significant': 2, 'critical': 3}
    min_rank = TIER_RANK.get(min_severity, 0)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()

    with _EVENT_STORE_LOCK:
        events = list(_EVENT_STORE.values())

    result = []
    for ev in events:
        # Expiry check
        if ev.get('expires_at', '') < now_iso:
            continue
        # Age check
        if ev.get('published', '') < cutoff:
            continue
        # Severity check
        if TIER_RANK.get(ev.get('severity_tier', 'low'), 0) < min_rank:
            continue
        # Event type filter
        if event_types and ev.get('event_type') not in event_types:
            continue
        # Theater bbox filter
        if theater_bbox:
            s, n, w, e = theater_bbox
            lat, lon = ev.get('lat', 0), ev.get('lon', 0)
            if not (s <= lat <= n and w <= lon <= e):
                continue
        result.append(ev)

    # Sort by significance * recency
    def sort_key(ev):
        try:
            age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(
                ev.get('published', datetime.now(timezone.utc).isoformat()).replace('Z', '+00:00')
            )).total_seconds() / 3600
        except Exception:
            age_h = 72
        return ev.get('significance_score', 50) * max(0.1, 1 - age_h / 72)

    result.sort(key=sort_key, reverse=True)
    return result[:limit]


def build_threads() -> dict:
    """
    Group related events into threads.
    Two events belong to the same thread if:
    - Geographic proximity: within 55km
    - Same or related event type
    - Published within 24 hours of each other
    - Keyword overlap > 15%

    Returns updated thread store.
    """
    global _LAST_THREAD_BUILD

    now_iso = datetime.now(timezone.utc).isoformat()
    with _EVENT_STORE_LOCK:
        events = [e for e in _EVENT_STORE.values() if e.get('expires_at', '') > now_iso]

    if not events:
        return {}

    # Sort by published time
    events.sort(key=lambda e: e.get('published', ''))

    threads: dict[str, list] = {}      # thread_id -> [event_ids]
    event_thread_map: dict[str, str] = {}  # event_id -> thread_id

    # Related event types
    TYPE_GROUPS = {
        'airstrike':   {'airstrike', 'missile', 'explosion'},
        'missile':     {'airstrike', 'missile', 'explosion'},
        'explosion':   {'airstrike', 'missile', 'explosion', 'armed_clash'},
        'armed_clash': {'armed_clash', 'explosion', 'assassination'},
        'maritime':    {'maritime'},
        'protest':     {'protest'},
        'earthquake':  {'earthquake'},
    }

    for ev in events:
        ev_id   = ev['id']
        ev_lat  = ev.get('lat', 0)
        ev_lon  = ev.get('lon', 0)
        ev_type = ev.get('event_type', 'general')
        ev_text = ev.get('clean_title', '') + ' ' + ev.get('summary', '')
        ev_time_str = ev.get('published', '')

        matched_thread = None

        for thread_id, thread_event_ids in threads.items():
            if not thread_event_ids:
                continue
            rep_id = thread_event_ids[0]
            with _EVENT_STORE_LOCK:
                rep_ev = _EVENT_STORE.get(rep_id, {})
            if not rep_ev:
                continue

            rep_lat     = rep_ev.get('lat', 0)
            rep_lon     = rep_ev.get('lon', 0)
            rep_type    = rep_ev.get('event_type', 'general')
            rep_time_str = rep_ev.get('published', '')
            rep_text    = rep_ev.get('clean_title', '') + ' ' + rep_ev.get('summary', '')

            # Distance check (55km)
            if haversine_km(ev_lat, ev_lon, rep_lat, rep_lon) > 55:
                continue

            # Time check (24 hours)
            try:
                ev_time  = datetime.fromisoformat(ev_time_str.replace('Z', '+00:00'))
                rep_time = datetime.fromisoformat(rep_time_str.replace('Z', '+00:00'))
                if abs((ev_time - rep_time).total_seconds()) > 86400:
                    continue
            except Exception:
                continue

            # Type compatibility check
            related = TYPE_GROUPS.get(ev_type, {ev_type})
            if rep_type not in related and ev_type not in TYPE_GROUPS.get(rep_type, {rep_type}):
                continue

            # Keyword overlap check
            if keyword_overlap(ev_text, rep_text) < 0.15:
                continue

            matched_thread = thread_id
            break

        if matched_thread:
            threads[matched_thread].append(ev_id)
            event_thread_map[ev_id] = matched_thread
        else:
            thread_id = f"thread_{ev_id}"
            threads[thread_id] = [ev_id]
            event_thread_map[ev_id] = thread_id

    # Update thread_id on events
    with _EVENT_STORE_LOCK:
        for ev_id, thread_id in event_thread_map.items():
            if ev_id in _EVENT_STORE:
                _EVENT_STORE[ev_id]['thread_id'] = thread_id

    # Build thread summaries
    TIER_RANK = {'low': 0, 'elevated': 1, 'significant': 2, 'critical': 3}
    thread_summaries = {}

    for thread_id, ev_ids in threads.items():
        with _EVENT_STORE_LOCK:
            thread_events = [_EVENT_STORE.get(eid) for eid in ev_ids if eid in _EVENT_STORE]
        thread_events = [e for e in thread_events if e]
        if not thread_events:
            continue

        thread_events.sort(key=lambda e: e.get('published', ''))
        top_severity = max(thread_events, key=lambda e: TIER_RANK.get(e.get('severity_tier', 'low'), 0))
        latest = thread_events[-1]
        all_actors  = list({a for e in thread_events for a in e.get('actors', [])})
        all_sources = list({s for e in thread_events for s in e.get('sources', [])})

        thread_summaries[thread_id] = {
            'thread_id':          thread_id,
            'event_count':        len(thread_events),
            'headline':           latest.get('clean_title', ''),
            'lat':                latest.get('lat'),
            'lon':                latest.get('lon'),
            'location':           latest.get('location', ''),
            'event_type':         top_severity.get('event_type', 'general'),
            'severity_tier':      top_severity.get('severity_tier', 'low'),
            'significance_score': max(e.get('significance_score', 0) for e in thread_events),
            'actors':             all_actors[:4],
            'sources':            all_sources[:5],
            'image_url':          next((e.get('image_url') for e in reversed(thread_events) if e.get('image_url')), ''),
            'first_event':        thread_events[0].get('published', ''),
            'latest_event':       latest.get('published', ''),
            'timeline': [
                {
                    'id':          e['id'],
                    'published':   e.get('published', ''),
                    'clean_title': e.get('clean_title', ''),
                    'source_name': e.get('source_name', ''),
                    'url':         e.get('url', ''),
                    'event_type':  e.get('event_type', ''),
                    'casualties':  e.get('casualties'),
                }
                for e in thread_events
            ],
            'url':                 latest.get('url', ''),
            'source_name':         latest.get('source_name', ''),
            'body':                latest.get('body', '') or latest.get('summary', ''),
            'casualties':          next((e.get('casualties') for e in reversed(thread_events) if e.get('casualties')), None),
            'infra_types':         INFRA_RELEVANCE.get(top_severity.get('event_type', 'general'), INFRA_RELEVANCE['general']),
            'country_code':        latest.get('country_code', ''),
            'location_confidence': latest.get('location_confidence', ''),
            'corroboration_count': sum(e.get('corroboration_count', 1) for e in thread_events),
        }

    with _THREAD_STORE_LOCK:
        _THREAD_STORE.clear()
        _THREAD_STORE.update(thread_summaries)

    _LAST_THREAD_BUILD = time.time()
    print(f"[event-store] threaded {len(events)} events into {len(thread_summaries)} threads")
    return thread_summaries


def get_threads(
    theater_bbox: Optional[tuple] = None,
    min_severity: str = 'low',
    max_age_hours: int = 72,
    limit: int = 100,
) -> list[dict]:
    """Get thread summaries filtered by theater and severity."""
    TIER_RANK = {'low': 0, 'elevated': 1, 'significant': 2, 'critical': 3}
    min_rank = TIER_RANK.get(min_severity, 0)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()

    with _THREAD_STORE_LOCK:
        threads = list(_THREAD_STORE.values())

    result = []
    for t in threads:
        if t.get('latest_event', '') < cutoff:
            continue
        if TIER_RANK.get(t.get('severity_tier', 'low'), 0) < min_rank:
            continue
        if theater_bbox:
            s, n, w, e_bound = theater_bbox
            lat, lon = t.get('lat', 0), t.get('lon', 0)
            if not (s <= lat <= n and w <= lon <= e_bound):
                continue
        result.append(t)

    result.sort(key=lambda t: (
        TIER_RANK.get(t.get('severity_tier', 'low'), 0) * 40 +
        t.get('significance_score', 0) * 0.4 +
        t.get('event_count', 1) * 10 +
        t.get('corroboration_count', 1) * 5
    ), reverse=True)

    return result[:limit]


def get_store_stats() -> dict:
    """Return stats about the current event store."""
    with _EVENT_STORE_LOCK:
        total  = len(_EVENT_STORE)
        now_iso = datetime.now(timezone.utc).isoformat()
        active = sum(1 for e in _EVENT_STORE.values() if e.get('expires_at', '') > now_iso)
        by_source: dict[str, int] = defaultdict(int)
        by_type:   dict[str, int] = defaultdict(int)
        by_tier:   dict[str, int] = defaultdict(int)
        for e in _EVENT_STORE.values():
            by_source[e.get('source', 'unknown')] += 1
            by_type[e.get('event_type', 'unknown')] += 1
            by_tier[e.get('severity_tier', 'unknown')] += 1

    with _THREAD_STORE_LOCK:
        thread_count = len(_THREAD_STORE)

    return {
        'total_events':    total,
        'active_events':   active,
        'thread_count':    thread_count,
        'last_thread_build': datetime.fromtimestamp(_LAST_THREAD_BUILD).isoformat() if _LAST_THREAD_BUILD else None,
        'by_source': dict(by_source),
        'by_type':   dict(by_type),
        'by_tier':   dict(by_tier),
    }


def purge_expired() -> int:
    """Remove expired events from the store. Returns count removed."""
    now_iso = datetime.now(timezone.utc).isoformat()
    with _EVENT_STORE_LOCK:
        expired = [k for k, v in _EVENT_STORE.items() if v.get('expires_at', '') < now_iso]
        for k in expired:
            del _EVENT_STORE[k]
    return len(expired)


# ── Disk persistence ──────────────────────────────────────────────────────────

def save_to_disk(path: str) -> None:
    """Atomically persist event and thread stores to a JSON file."""
    import json
    import tempfile
    import os as _os
    with _EVENT_STORE_LOCK:
        events = dict(_EVENT_STORE)
    with _THREAD_STORE_LOCK:
        threads = dict(_THREAD_STORE)
    payload = {
        "events":   events,
        "threads":  threads,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        _os.replace(tmp, path)
        print(f"[event-store] saved {len(events)} events / {len(threads)} threads → {path}")
    except Exception as ex:
        print(f"[event-store] save error: {ex}")
        try:
            _os.unlink(tmp)
        except Exception:
            pass


def load_from_disk(path: str) -> None:
    """Load event and thread stores from a JSON file (called at startup)."""
    import json
    import os as _os
    if not _os.path.exists(path):
        print(f"[event-store] no persisted store at {path} — starting fresh")
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        events  = payload.get("events",  {})
        threads = payload.get("threads", {})
        saved_at = payload.get("saved_at", "unknown")
        # Purge already-expired events before loading
        now_iso = datetime.now(timezone.utc).isoformat()
        events  = {k: v for k, v in events.items()  if v.get("expires_at", "") > now_iso}
        with _EVENT_STORE_LOCK:
            _EVENT_STORE.update(events)
        with _THREAD_STORE_LOCK:
            _THREAD_STORE.update(threads)
        print(f"[startup] event store loaded: {len(events)} events, {len(threads)} threads (saved {saved_at})")
    except Exception as ex:
        print(f"[event-store] load error: {ex}")
