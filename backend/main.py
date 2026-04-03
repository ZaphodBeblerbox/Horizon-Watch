# ══════════════════════════════════════════════════════════════════════════════
# AKILI — INTELLIGENCE CORRELATION PRINCIPLE
# Every data point must be evaluated in the context of all other data points.
# When building any endpoint, always ask: what other layers does this data touch?
# Surface those connections automatically — never wait for the analyst to find
# them manually. Routes touch conflict events, infrastructure, and live traffic.
# Aircraft touch airspace, airports, and conflict zones. News touches locations
# and actors in the conflict dataset. Connect everything.
# ══════════════════════════════════════════════════════════════════════════════

import os
import math
import re
import socket as _socket
import time as time_module
import time
import asyncio
import threading
import json as _json
import csv as _csv
import io as _io
import urllib.request
import urllib.parse
import urllib.error
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import httpx
from fastapi import Body
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()

DATA_DIR = (
    "/var/lib/railway"
    if os.getenv("RAILWAY_ENVIRONMENT")
    else os.path.join(os.path.dirname(__file__), "data")
)
os.makedirs(DATA_DIR, exist_ok=True)

# Set global socket timeout so feedparser (urllib) and other stdlib HTTP calls
# never hang indefinitely — critical for Railway where some RSS feeds time out.
_socket.setdefaulttimeout(20)

from typing import Optional
from fastapi import FastAPI, HTTPException, Query, Request, Depends
from fastapi.responses import Response as FastAPIResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import anthropic
import feedparser
from email.utils import parsedate_to_datetime

from tanzania_context import get_context_for_prompt, get_minimal_context, get_full_context
from rss_feeds import ADDITIONAL_SCAN_FEEDS, RSS_FEED_META

# ── Web push (optional — gracefully disabled if pywebpush not installed) ──────
try:
    from pywebpush import webpush, WebPushException as _WebPushException
    _WEBPUSH_OK = True
except ImportError:
    _WEBPUSH_OK = False

_VAPID_PRIVATE_KEY = """-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgIXmUByMl47z+93/q
w8OYINpr7eTh+lAh7ARnAMvU0CShRANCAATqXQyqJfz9pQC4GLtN8m1ybdgjVzYG
jqn+AMFKug9IJvJSs8ivbu1NfjVPIHeNuwsxeDknR8HEyLNQwntQ+MdP
-----END PRIVATE KEY-----"""
_VAPID_CLAIMS     = {"sub": "mailto:admin@trifectatechnologies.co"}
_PUSH_SUBS: dict  = {}          # user_id → subscription JSON
_PUSH_SUBS_LOCK   = threading.Lock()
from geocode_utils import geocode_place, get_geocode_stats
from scoring import score_news_markers, geo_gate_passes
from location_extract import (
    rank_location_candidates,
    extract_country_mentions,
    country_code_from_name,
    country_name_from_code,
)
from article_extract import get_article_preview
import usage_tracker
from classifier import classify_event
import event_store as es
import event_bridge

try:
    from langdetect import detect as _langdetect_detect
    _HAS_LANGDETECT = True
except ImportError:
    _HAS_LANGDETECT = False
    print("[startup] WARNING: langdetect not installed — translation disabled. Run: pip install langdetect")

try:
    import spacy as _spacy
    _nlp = _spacy.load("en_core_web_sm")
    _HAS_SPACY = True
except Exception:
    _HAS_SPACY = False
    _nlp = None
    print("[startup] WARNING: spaCy not available — news conflict extraction disabled.")
    print("[startup]   Run: pip install spacy && python -m spacy download en_core_web_sm")

try:
    from shapely.geometry import shape as _shape
    _HAS_SHAPELY = True
except ImportError:
    _HAS_SHAPELY = False

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:3000",
        "https://horizon-watch.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ── Auth utilities (imported from app_shared to keep main.py lean) ────────────
from app_shared import (
    HAS_AUTH as _HAS_AUTH,
    pwd_context as _pwd_context,
    auth_bearer as _auth_bearer,
    make_jwt as _make_jwt,
    decode_jwt as _decode_jwt,
    get_user_from_token as _get_user_from_token,
    get_optional_user,
    require_approved_user,
    require_admin_user,
    send_email as _send_email,
    user_dict as _user_dict,
    FRONTEND_URL as _FRONTEND_URL,
    RESEND_API_KEY as _RESEND_API_KEY,
    JWT_SECRET as _JWT_SECRET,
    JWT_ALGORITHM as _JWT_ALGORITHM,
    JWT_EXPIRE_DAYS as _JWT_EXPIRE_DAYS,
)
# Compatibility aliases
_HAS_AUTH = _HAS_AUTH
_HTTPCreds = None  # only used in moved auth code

# ── Routers ───────────────────────────────────────────────────────────────────
from routers import auth as _auth_router, admin as _admin_router
from routers import intelligence as _intel_router, briefings as _briefings_router
from routers import infrastructure as _infra_router
app.include_router(_auth_router.router)
app.include_router(_admin_router.router)
app.include_router(_intel_router.router)
app.include_router(_briefings_router.router)
app.include_router(_infra_router.router)

# ── Optional fastapi-cache2 response caching ──────────────────────────────────
try:
    from fastapi_cache import FastAPICache
    from fastapi_cache.backends.inmemory import InMemoryBackend
    from fastapi_cache.decorator import cache as _response_cache
    _HAS_RESPONSE_CACHE = True
except ImportError:
    _HAS_RESPONSE_CACHE = False
    def _response_cache(*a, **kw):
        def _dec(fn): return fn
        return _dec

_api_key = os.getenv("ANTHROPIC_API_KEY")
if not _api_key:
    print("[startup] WARNING: ANTHROPIC_API_KEY is not set — /analyse will return an error until a key is provided.")

client = anthropic.Anthropic(api_key=_api_key) if _api_key else None

CLAUDE_BUDGET_USD = float(os.getenv("CLAUDE_BUDGET_USD", "5.40"))

_COPERNICUS_CLIENT_ID = os.getenv("COPERNICUS_CLIENT_ID", "").strip()
_COPERNICUS_CLIENT_SECRET = os.getenv("COPERNICUS_CLIENT_SECRET", "").strip()

# ── Auth configuration ────────────────────────────────────────────────────────
if _COPERNICUS_CLIENT_ID and _COPERNICUS_CLIENT_SECRET:
    print("[startup] Copernicus credentials detected — satellite search will prefer OAuth mode.")
else:
    print("[startup] Copernicus credentials missing — satellite search will use public mode.")

_analysis_cache: dict = {}
_geocode_proxy_cache: dict[tuple[str, int], list[dict]] = {}

# ── Mission Profile context helper ────────────────────────────────────────────

def _format_profile_context(profile: dict | None) -> str:
    """Convert a frontend Mission Profile object to a Claude system context string."""
    if not profile:
        return ""
    name       = (profile.get("displayName") or "").strip()
    role       = profile.get("role", "Analyst")
    focus      = profile.get("focusRegions", [])
    domains    = profile.get("infraDomains", [])
    chokepoints = profile.get("chokepoints", [])
    threshold_map = {0: "Minimal (high-severity events only)", 1: "Standard", 2: "High Sensitivity (broad monitoring)"}
    threshold  = threshold_map.get(profile.get("threshold", 1), "Standard")
    active_sits = (profile.get("activeSituations") or "").strip()

    lines = ["ANALYST MISSION PROFILE:"]
    lines.append(f"Analyst: {name} ({role})" if name else f"Role: {role}")
    if focus:
        lines.append(f"Focus regions: {', '.join(focus)}")
    if domains:
        lines.append(f"Infrastructure domains of interest: {', '.join(domains)}")
    if chokepoints:
        lines.append(f"Chokepoints monitored: {', '.join(chokepoints)}")
    lines.append(f"Alert sensitivity: {threshold}")
    if active_sits:
        lines.append(f"Active situations: {active_sits}")
    lines.append(
        "\nFrame all analysis through the lens of this analyst profile. "
        "Prioritise information relevant to their stated focus regions, "
        "infrastructure domains, and monitored chokepoints. "
        "Be explicit about relevance or lack thereof to their specific focus areas. "
        "Frame analysis relative to the analyst's stated focus regions and interests, not any default geography."
    )
    return "\n".join(lines) + "\n\n"


def _profile_cache_suffix(profile: dict | None) -> str:
    """Short deterministic suffix for cache keys, empty string if no profile."""
    if not profile:
        return ""
    import hashlib, json as _json2
    raw = _json2.dumps(profile, sort_keys=True, separators=(",", ":"))
    return f"_p{hashlib.md5(raw.encode()).hexdigest()[:8]}"


# ── Mock POI infrastructure database ─────────────────────────────────────────
# Major global airports, ports, and government sites.
# Used in /route/analyse to flag critical infrastructure near a route.
_POIS = [
    # Airports — Global
    {"name": "Dubai International Airport",    "type": "airport",    "lat":  25.253,  "lon":  55.365},
    {"name": "Istanbul Airport",               "type": "airport",    "lat":  41.275,  "lon":  28.752},
    {"name": "Singapore Changi Airport",       "type": "airport",    "lat":   1.359,  "lon": 103.989},
    {"name": "Frankfurt Airport",              "type": "airport",    "lat":  50.037,  "lon":   8.563},
    {"name": "Nairobi JKIA",                   "type": "airport",    "lat":  -1.319,  "lon":  36.926},
    {"name": "Cairo International Airport",    "type": "airport",    "lat":  30.122,  "lon":  31.406},
    {"name": "Karachi Jinnah Airport",         "type": "airport",    "lat":  24.907,  "lon":  67.161},
    {"name": "Lagos Murtala Muhammed Airport", "type": "airport",    "lat":   6.577,  "lon":   3.321},
    # Ports — Global
    {"name": "Port of Singapore",              "type": "port",       "lat":   1.265,  "lon": 103.820},
    {"name": "Port of Rotterdam",              "type": "port",       "lat":  51.950,  "lon":   4.130},
    {"name": "Jebel Ali Port (Dubai)",         "type": "port",       "lat":  24.990,  "lon":  55.058},
    {"name": "Port of Mombasa",                "type": "port",       "lat":  -4.066,  "lon":  39.661},
    {"name": "Djibouti Port",                  "type": "port",       "lat":  11.589,  "lon":  43.145},
    {"name": "Port of Aden",                   "type": "port",       "lat":  12.779,  "lon":  45.029},
    {"name": "Bandar Abbas Port",              "type": "port",       "lat":  27.183,  "lon":  56.277},
    {"name": "Port of Dar es Salaam",          "type": "port",       "lat":  -6.823,  "lon":  39.289},
    # Government — Global
    {"name": "UN Headquarters (New York)",     "type": "government", "lat":  40.749,  "lon": -73.968},
    {"name": "EU Council (Brussels)",          "type": "government", "lat":  50.846,  "lon":   4.365},
    {"name": "African Union HQ (Addis Ababa)", "type": "government", "lat":   9.024,  "lon":  38.763},
    {"name": "Arab League HQ (Cairo)",         "type": "government", "lat":  30.060,  "lon":  31.228},
]

# ── Infrastructure layer — Overpass query strings per category ────────────────
_INFRA_CACHE: dict = {}
INFRA_CACHE_TTL = 6 * 3600  # 6 hours


_INFRA_QUERIES: dict[str, str] = {
    "medical":     'node["amenity"~"hospital|clinic|pharmacy|doctors|health_post"];way["amenity"~"hospital|clinic"]',
    "security":    'node["amenity"~"police|fire_station"];node["military"~"base|checkpoint"]',
    "transport":   'node["aeroway"~"aerodrome|helipad"];node["amenity"="bus_station"];node["railway"="station"]',
    "power":       'node["power"~"plant|substation"];way["power"~"plant|substation"]',
    "military":    'node["military"~"base|barracks|checkpoint"];way["military"~"base|barracks"]',
    "comms":       'node["man_made"~"mast|tower"];node["telecom"~"exchange|data_center"]',
    "government":  'node["amenity"~"townhall|government|embassy|courthouse|prison"]',
    "chokepoints": 'node["barrier"~"border_control|checkpoint|toll_booth"];way["bridge"="yes"]["highway"]',
    "utilities":   'node["man_made"~"water_tower|water_works|pumping_station"];node["amenity"~"water_point|fuel"]',
    "pipelines":   'way["man_made"="pipeline"];way["pipeline"];relation["man_made"="pipeline"]',
}

# ── Static infrastructure datasets (loaded once at startup) ──────────────────
# Used by /events/context — never queries Overpass on demand.
# Format: [{id, name, category, lat, lon, subcategory, ...}, ...]

_STATIC_AIRPORTS:     list[dict] = []
_STATIC_PORTS:        list[dict] = []
_STATIC_POWERPLANTS:  list[dict] = []

def _load_static_infra_datasets() -> None:
    """Load airports, ports, and power plants from bundled CSVs into memory."""
    global _STATIC_AIRPORTS, _STATIC_PORTS, _STATIC_POWERPLANTS

    def _csv_rows(path: Path) -> list[dict]:
        try:
            with open(path, newline="", encoding="utf-8-sig") as fh:
                return list(_csv.DictReader(fh))
        except Exception as ex:
            print(f"[static_infra] Could not load {path.name}: {ex}")
            return []

    airports_raw = _csv_rows(BASE_DIR / "airports_cache.csv")
    for row in airports_raw:
        try:
            lat = float(row["latitude_deg"])
            lon = float(row["longitude_deg"])
        except (KeyError, ValueError, TypeError):
            continue
        if not math.isfinite(lat) or not math.isfinite(lon):
            continue
        # Only meaningful airport types (skip seaplane_base, balloonport, etc.)
        atype = (row.get("type") or "").lower()
        if atype not in ("large_airport", "medium_airport", "small_airport", "heliport"):
            continue
        _STATIC_AIRPORTS.append({
            "id":          f"apt_{row.get('ident') or row.get('id') or len(_STATIC_AIRPORTS)}",
            "name":        row.get("name") or row.get("municipality") or "Airport",
            "category":    "transport",
            "subcategory": atype,
            "lat":         lat,
            "lon":         lon,
            "codes": {
                "icao": row.get("icao_code") or row.get("ident") or "",
                "iata": row.get("iata_code") or "",
            },
        })

    ports_raw = _csv_rows(BASE_DIR / "ports_cache.csv")
    for row in ports_raw:
        try:
            lat = float(row.get("Latitude") or 0)
            lon = float(row.get("Longitude") or 0)
        except (ValueError, TypeError):
            continue
        if lat == 0 and lon == 0:
            continue
        if not math.isfinite(lat) or not math.isfinite(lon):
            continue
        _STATIC_PORTS.append({
            "id":          f"port_{row.get('OID_') or len(_STATIC_PORTS)}",
            "name":        row.get("Main Port Name") or row.get("Alternate Port Name") or "Port",
            "category":    "transport",
            "subcategory": "port",
            "lat":         lat,
            "lon":         lon,
            "codes":       {},
        })

    pp_raw = _csv_rows(BASE_DIR / "powerplants_cache.csv")
    for row in pp_raw:
        try:
            lat = float(row.get("latitude") or 0)
            lon = float(row.get("longitude") or 0)
        except (ValueError, TypeError):
            continue
        if lat == 0 and lon == 0:
            continue
        if not math.isfinite(lat) or not math.isfinite(lon):
            continue
        cap = row.get("capacity_mw")
        try:
            cap_f = float(cap) if cap else 0.0
        except (ValueError, TypeError):
            cap_f = 0.0
        _STATIC_POWERPLANTS.append({
            "id":          f"pp_{row.get('gppd_idnr') or len(_STATIC_POWERPLANTS)}",
            "name":        row.get("name") or "Power Plant",
            "category":    "power",
            "subcategory": row.get("primary_fuel") or "power",
            "lat":         lat,
            "lon":         lon,
            "capacity_mw": cap_f,
            "country":     row.get("country_long") or row.get("country") or "",
            "codes":       {},
        })

    print(f"[static_infra] Loaded {len(_STATIC_AIRPORTS)} airports, "
          f"{len(_STATIC_PORTS)} ports, {len(_STATIC_POWERPLANTS)} power plants")

_load_static_infra_datasets()

# ── Surface pool ──────────────────────────────────────────────────────────────
_SURFACE_POOL: list = []
_SURFACE_POOL_LOCK = threading.Lock()
_SURFACE_POOL_UPDATED_AT: str | None = None
_SURFACE_POOL_LAST_NONEMPTY: float = 0.0   # time.time() of last pool with items
_SURFACE_BUILD_LOCK = threading.Lock()

# ── Prefetch + enrichment caches ──────────────────────────────────────────────
_PREFETCH_CACHE: dict  = {}   # event_id → {infra_nodes: [...], fetched_at: ts, ttl: 7200}
_PREFETCH_LOCK         = threading.Lock()
_PREFETCH_INFLIGHT: dict[str, threading.Event] = {}
_ENRICHMENT_CACHE: dict = {}  # event_id → {enrichment: {...}, prose: str, fetched_at: ts, ttl: 21600}
_ENRICHMENT_LOCK       = threading.Lock()
_AUTO_ENRICH_DAILY_LIMIT = 5
_AUTO_ENRICH_DAILY_SPEND_CAP = 0.18   # USD

# ── Auto-brief store — background Claude briefs keyed by item/chokepoint id ───
_AUTO_BRIEF_STORE: dict = {}            # item_id      → {brief, generated_at}
_AUTO_BRIEF_LOCK  = threading.Lock()
_CHOKEPOINT_STATUS_PREV: dict = {}      # cp_name      → previous status string
_CHOKEPOINT_BRIEF_STORE: dict = {}      # "cp_{name}_{status}" → {brief, generated_at}

AUTO_BRIEF_CLUSTER_SCORE_THRESHOLD = 75
AUTO_BRIEF_DAILY_CALL_LIMIT        = 15

# ── Real-time alert ingestion ─────────────────────────────────────────────────
_ALERTS_QUEUE: list      = []          # all real-time alerts, newest last
_ALERTS_QUEUE_LOCK       = threading.Lock()
_ALERTS_QUEUE_MAX        = 500
_OREF_SEEN_IDS: set      = set()      # dedup: alertDate + first_area
_OREF_FAILURES           = 0
_OREF_MAX_FAILURES       = 10
_OREF_SUSPENDED          = False
_USGS_SEEN_IDS: set      = set()      # dedup: USGS feature id
_GDACS_SEEN_GUIDS: set   = set()      # dedup: GDACS entry guid

# ── Data source health tracking ───────────────────────────────────────────────
_DS_STATUS: dict = {
    "oref":     {"last_poll": None, "last_alert": None, "failures": 0, "suspended": False},
    "usgs":     {"last_poll": None, "last_event": None, "failures": 0},
    "gdacs":    {"last_poll": None, "failures": 0},
    "rss":      {"last_run": None,  "feeds_ok": 0, "feeds_total": 0, "failures": 0},
    "ais":      {"connected": False, "failures": 0, "message": None},
    "airports": {"last_download": None, "count": 0},
    "ports":    {"last_download": None, "count": 0},
    "power":    {"last_download": None, "count": 0},
    "copernicus": {"token_valid": False, "expires_at": None},
    "imb":      {"last_poll": None, "failures": 0},
}
_DS_STATUS_LOCK = threading.Lock()
_IMB_INCIDENTS: list = []

# ── Daily intelligence briefing ───────────────────────────────────────────────
_BRIEFING_FILE          = BASE_DIR / "briefings.json"
_BRIEFING_LOCK          = threading.Lock()
_BRIEFING_STORE: list   = []      # list of briefing dicts, newest last
_BRIEFING_RATE_LIMIT_S  = 7200    # 2 hours between manual regenerates

# ── News conflict extraction state ────────────────────────────────────────────
_NEWS_CONFLICT_MARKERS: list = []
_NEWS_ARTICLE_STORE: dict[str, dict] = {}   # url -> enriched article snapshot (may have lat/lon None)
_NEWS_STORE_LOCK = threading.Lock()
_PROCESSED_URLS: set = set()
_FIRST_EXTRACTION_DONE = False   # cleared on first cycle so all current articles are processed fresh
_executor = ThreadPoolExecutor(max_workers=4)   # for blocking I/O in sync extraction
_NEWS_STORE_MAX_ARTICLES = 2000
_NEWS_WINDOW_HOURS = 168
_NEWS_MARKER_WINDOW_HOURS = 168
_NEWS_FEED_ENTRY_LIMIT = 50

_FEED_RUN_STATS = {
    "feeds_total": 0,
    "feeds_ok": 0,
    "feeds_failed": 0,
    "feeds_attempted": 0,
    "failed_feeds": {},
    "last_run_at": None,
}
_FEED_RUN_STATS_LOCK = threading.Lock()

TRIGGER_KEYWORDS = [
    "attack", "explosion", "bomb", "blast", "shooting", "killed", "arrested",
    "protest", "riot", "clash", "violence", "militia", "military", "troops",
    "insurgent", "rebel", "coup", "security", "threat", "unrest", "conflict",
    "casualt", "fatali", "wounded", "hostage", "ambush", "raid",
]
HIGH_CONFIDENCE_SOURCES  = {
    # African regional — location-specific, strong editorial
    "AllAfrica Tanzania", "AllAfrica Kenya", "AllAfrica Uganda",
    "AllAfrica East Africa", "AllAfrica Rwanda", "AllAfrica South Sudan",
    "Africa News", "Kyiv Independent",
    # International wire / broadcaster — strong editorial standards
    "Gulf News", "Khaleej Times", "Tagesschau", "RTS", "CNN",
    "Arab News", "Jerusalem Post", "Times of Israel", "Anadolu Agency",
    "Pakistan Tribune", "Alaraby",
    # Official / authoritative conflict sources
    "UN News", "Relief Web",
    # Investigative / analysis — verified methodology
    "Bellingcat", "ISW", "War on the Rocks", "Defense One",
}
MEDIUM_CONFIDENCE_SOURCES = {
    "BBC Africa", "BBC World", "Al Jazeera", "Guardian Africa",
    "Reuters World", "AP News", "Middle East Eye", "Africa Intelligence",
    "France24", "DW News", "Al Arabiya", "Euronews", "Global Voices", "OCCRP",
    "Times of India", "Dawn Pakistan", "Nikkei Asia",
    "Sahara Reporters", "Morocco World News", "Maghrebi", "Nation Africa",
    "New Arab",
    # State-affiliated — capped at medium regardless of specificity
    "TASS", "VOA News", "Radio Free Europe", "Ukrinform",
    # Tabloid / opinion-heavy — capped at medium regardless of specificity
    "Bild", "Fox News",
}


def _location_key(item: dict) -> str | None:
    lat = item.get("lat")
    lon = item.get("lon")
    if lat is None or lon is None:
        return None
    try:
        return f"{round(float(lat), 1)}:{round(float(lon), 1)}"
    except Exception:
        return None


def _recent_location_counts(items: list, hours: int = 6) -> dict[str, int]:
    """
    Count events per coarse location bucket within the last N hours.
    Used for +10 significance boost when 2+ events occur in same location.
    """
    cutoff = time_module.time() - (hours * 3600)
    counts: dict[str, int] = {}
    for item in items:
        key = _location_key(item)
        if not key:
            continue
        ts = _parse_iso_ts(item.get("published_at", "") or item.get("date", ""))
        if ts and ts >= cutoff:
            counts[key] = counts.get(key, 0) + 1
    return counts


def _score_significance(item: dict, classification: dict, profile: dict | None, recent_count: int = 0) -> int:
    """
    Score 0-100 for whether an item warrants infrastructure prefetch + possible auto-enrichment.
    Built on top of the existing relevance_score.
    """
    score = int(item.get("relevance_score") or 0)

    # Boost for high-threat event types
    if classification.get("type") in ("explosion", "missile", "armed_clash"):
        score += 20

    # Boost if within a profile focus region
    if profile and profile.get("focusRegions"):
        lat, lon = item.get("lat"), item.get("lon")
        if lat is not None and lon is not None:
            from scoring import REGION_BBOXES
            for region in profile["focusRegions"]:
                bbox = REGION_BBOXES.get(region)
                if bbox is None:
                    score += 15; break
                s, n, w, e = bbox[0], bbox[1], bbox[2], bbox[3]
                if s <= float(lat) <= n and w <= float(lon) <= e:
                    score += 15; break

    # Boost if headline/summary mentions infrastructure keywords matching profile priorities
    if profile and profile.get("infraDomains"):
        text = f"{item.get('headline','')} {item.get('summary','')} {item.get('context','')}".lower()
        for domain in profile["infraDomains"]:
            if str(domain).lower() in text:
                score += 10
                break

    # Boost if same location has had 2+ events in last 6 hours
    if recent_count >= 2:
        score += 10

    # Penalty for low classifier confidence
    if classification.get("confidence", 1.0) < 0.6:
        score -= 20

    return max(0, min(100, score))




def _parse_event_ts(event: dict) -> float:
    for key in ("published_at", "event_date", "date"):
        raw = str(event.get(key) or "").strip()
        if not raw:
            continue
        try:
            if raw.isdigit() and len(raw) == 8:
                return datetime.strptime(raw, "%Y%m%d").replace(tzinfo=timezone.utc).timestamp()
            if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
                return datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
        except Exception:
            continue
    return 0.0


def _event_zone_weight(event: dict, now_ts: float) -> float:
    severity = {
        "critical": 1.0,
        "significant": 0.8,
        "elevated": 0.55,
        "low": 0.3,
    }.get(str(event.get("severity_tier") or "low"), 0.3)
    recency_hours = max(0.0, (now_ts - _parse_event_ts(event)) / 3600.0)
    recency = 1.0 if recency_hours <= 6 else 0.8 if recency_hours <= 24 else 0.55 if recency_hours <= 72 else 0.3
    relevance = min(1.0, max(0.2, float(event.get("relevance_score") or 40) / 100.0))
    return severity * 0.45 + recency * 0.35 + relevance * 0.20


def _cluster_conflict_events(events: list[dict], threshold_km: float = 140.0) -> list[list[dict]]:
    clusters: list[list[dict]] = []
    used = [False] * len(events)
    for i, event in enumerate(events):
        if used[i]:
            continue
        cluster = [event]
        used[i] = True
        grown = True
        while grown:
            grown = False
            for j, candidate in enumerate(events):
                if used[j]:
                    continue
                if any(
                    _haversine_km(candidate["lat"], candidate["lon"], member["lat"], member["lon"]) <= threshold_km
                    or (
                        str(candidate.get("country_code") or "").upper()
                        and str(candidate.get("country_code") or "").upper() == str(member.get("country_code") or "").upper()
                        and _haversine_km(candidate["lat"], candidate["lon"], member["lat"], member["lon"]) <= max(450.0, threshold_km * 2.5)
                    )
                    for member in cluster
                ):
                    cluster.append(candidate)
                    used[j] = True
                    grown = True
        clusters.append(cluster)
    return clusters


def _convex_hull_latlon(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(points) <= 1:
        return points
    pts = sorted({(float(lat), float(lon)) for lat, lon in points}, key=lambda p: (p[1], p[0]))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    return [(lat, lon) for lat, lon in hull]


def _expand_latlon_polygon(points: list[tuple[float, float]], expand_km: float) -> list[list[float]]:
    if not points:
        return []
    c_lat = sum(lat for lat, _ in points) / len(points)
    c_lon = sum(lon for _, lon in points) / len(points)
    expanded = []
    lat_add = expand_km / 111.0
    lon_add = expand_km / max(20.0, 111.0 * abs(math.cos(math.radians(c_lat))))
    for lat, lon in points:
        d_lat = lat - c_lat
        d_lon = lon - c_lon
        dist = math.sqrt(d_lat * d_lat + d_lon * d_lon)
        if dist < 1e-9:
            expanded.append([lat + lat_add, lon])
            continue
        scale = (dist + max(lat_add, lon_add)) / dist
        expanded.append([c_lat + d_lat * scale, c_lon + d_lon * scale])
    return expanded

@app.get("/events")
def get_events(
    north: Optional[float] = Query(None),
    south: Optional[float] = Query(None),
    east:  Optional[float] = Query(None),
    west:  Optional[float] = Query(None),
    zoom:  Optional[int]   = Query(None),
    country: Optional[str] = Query(None),
    compact: bool = Query(True),
):
    """Removed — GDELT data source removed. Use /api/v2/events instead."""
    return {"events": [], "updated_at": None, "diagnostics": {"returned": 0}}


@app.get("/conflict-zones")
def get_conflict_zones(
    north: Optional[float] = Query(None),
    south: Optional[float] = Query(None),
    east: Optional[float] = Query(None),
    west: Optional[float] = Query(None),
    zoom: Optional[int] = Query(None),
    country: Optional[str] = Query(None),
):
    """Removed — GDELT data source removed."""
    return {"zones": [], "updated_at": None, "diagnostics": {"returned": 0}}


@app.get("/api/usage")
def get_usage():
    """Return Claude API token usage and budget stats."""
    return usage_tracker.get_stats(CLAUDE_BUDGET_USD)


_SYSTEM_SETTINGS: dict = {}
_SETTINGS_LOCK = threading.Lock()

@app.put("/api/settings")
def put_settings(body: dict):
    """Store frontend system settings (briefing time, refresh intervals, etc.)."""
    with _SETTINGS_LOCK:
        _SYSTEM_SETTINGS.update(body)
    return {"ok": True}

@app.get("/api/settings")
def get_settings():
    """Return current system settings."""
    with _SETTINGS_LOCK:
        return dict(_SYSTEM_SETTINGS)


@app.post("/api/push/subscribe")
async def push_subscribe(request: Request):
    """Store a browser push subscription for the current user."""
    user = _get_current_user(request)
    uid  = user["id"] if user else request.headers.get("x-forwarded-for", "anon")
    data = await request.json()
    with _PUSH_SUBS_LOCK:
        _PUSH_SUBS[uid] = data
    return {"status": "subscribed"}

@app.post("/api/push/unsubscribe")
async def push_unsubscribe(request: Request):
    """Remove push subscription for current user."""
    user = _get_current_user(request)
    uid  = user["id"] if user else None
    if uid:
        with _PUSH_SUBS_LOCK:
            _PUSH_SUBS.pop(uid, None)
    return {"status": "unsubscribed"}

def _send_push(uid: str, title: str, body: str, data: dict | None = None) -> None:
    """Send a Web Push notification to one subscribed user (fire-and-forget)."""
    if not _WEBPUSH_OK:
        return
    with _PUSH_SUBS_LOCK:
        sub = _PUSH_SUBS.get(uid)
    if not sub:
        return
    import json as _j
    payload = _j.dumps({"title": title, "body": body, **(data or {})})
    try:
        webpush(
            subscription_info=sub,
            data=payload,
            vapid_private_key=_VAPID_PRIVATE_KEY,
            vapid_claims=_VAPID_CLAIMS,
        )
    except Exception as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status == 410:           # Subscription expired
            with _PUSH_SUBS_LOCK:
                _PUSH_SUBS.pop(uid, None)
        print(f"[push] send failed for {uid}: {e}")

def _broadcast_push(title: str, body: str, data: dict | None = None) -> None:
    """Send a push notification to all subscribed users (background thread)."""
    with _PUSH_SUBS_LOCK:
        uids = list(_PUSH_SUBS.keys())
    for uid in uids:
        threading.Thread(target=_send_push, args=(uid, title, body, data), daemon=True).start()

@app.get("/api/health/detailed")
def get_health_detailed():
    """Return backend status, data source statuses, and Claude usage stats."""
    import time as _time
    start = _time.monotonic()

    # Backend ping (always succeeds if this endpoint runs)
    ping_ms = round((_time.monotonic() - start) * 1000, 1)

    with _DS_STATUS_LOCK:
        ds = {k: dict(v) for k, v in _DS_STATUS.items()}

    def _status(failures: int, last_poll) -> str:
        if last_poll is None:
            return "pending"
        return "degraded" if failures > 2 else "ok"

    sources = [
        {
            "id":        "oref",
            "name":      "IDF Home Front Command (OREF)",
            "type":      "real-time alerts",
            "last_fetch": ds["oref"].get("last_poll"),
            "status":    "degraded" if ds["oref"].get("suspended") else _status(ds["oref"].get("failures", 0), ds["oref"].get("last_poll")),
            "status_label": "Geo-blocked" if ds["oref"].get("suspended") else None,
            "failures":  ds["oref"].get("failures", 0),
            "last_alert": ds["oref"].get("last_alert"),
            "message":   "Polling suspended after repeated geo-blocked failures" if ds["oref"].get("suspended") else None,
        },
        {
            "id":        "usgs",
            "name":      "USGS Earthquake Feed",
            "type":      "real-time alerts",
            "last_fetch": ds["usgs"].get("last_poll"),
            "status":    _status(ds["usgs"].get("failures", 0), ds["usgs"].get("last_poll")),
            "failures":  ds["usgs"].get("failures", 0),
            "last_event": ds["usgs"].get("last_event"),
        },
        {
            "id":        "gdacs",
            "name":      "GDACS Natural Hazards",
            "type":      "real-time alerts",
            "last_fetch": ds["gdacs"].get("last_poll"),
            "status":    _status(ds["gdacs"].get("failures", 0), ds["gdacs"].get("last_poll")),
            "failures":  ds["gdacs"].get("failures", 0),
        },
        {
            "id":        "rss",
            "name":      "RSS News Feeds",
            "type":      "news",
            "last_fetch": ds["rss"].get("last_run"),
            "status":    _status(ds["rss"].get("failures", 0), ds["rss"].get("last_run")),
            "failures":  ds["rss"].get("failures", 0),
            "feeds_ok":  ds["rss"].get("feeds_ok", 0),
            "feeds_total": ds["rss"].get("feeds_total", 0),
            "feeds_attempted": _FEED_RUN_STATS.get("feeds_total", 0),
            "feeds_successful": _FEED_RUN_STATS.get("feeds_ok", 0),
            "feeds_failed": len(_FEED_RUN_STATS.get("failed_feeds", {})),
            "last_error_message": next(iter(_FEED_RUN_STATS.get("failed_feeds", {}).values()), None),
        },
        {
            "id":        "ais",
            "name":      "AISStream Live Vessels",
            "type":      "maritime",
            "last_fetch": _AIS_STATUS.get("last_poll"),
            "status":    "ok" if _AIS_STATUS.get("connected") else ("degraded" if not _AISSTREAM_KEY or _AIS_STATUS.get("error") else "pending"),
            "failures":  0,
            "message":   _AIS_STATUS.get("error") or ("AISSTREAM_API_KEY missing — Railway WebSocket ingest is disabled" if not _AISSTREAM_KEY else None),
            "key_configured": bool(_AISSTREAM_KEY),
            "vessel_count": _AIS_STATUS.get("vessel_count", 0),
        },
        {
            "id":        "airports",
            "name":      "OurAirports Database",
            "type":      "infrastructure",
            "last_fetch": ds["airports"].get("last_download"),
            "status":    "ok" if ds["airports"].get("count", 0) > 0 else "pending",
            "record_count": ds["airports"].get("count", 0),
        },
        {
            "id":        "ports",
            "name":      "World Port Index",
            "type":      "infrastructure",
            "last_fetch": ds["ports"].get("last_download"),
            "status":    "ok" if ds["ports"].get("count", 0) > 0 else "pending",
            "record_count": ds["ports"].get("count", 0),
        },
        {
            "id":        "power",
            "name":      "OpenInfraMap Power Grid",
            "type":      "infrastructure",
            "last_fetch": ds["power"].get("last_download"),
            "status":    "ok" if ds["power"].get("count", 0) > 0 else "pending",
            "record_count": ds["power"].get("count", 0),
        },
        {
            "id":        "copernicus",
            "name":      "Copernicus EMS",
            "type":      "satellite",
            "last_fetch": None,
            "status":    "ok" if ds["copernicus"].get("token_valid") else "degraded",
            "token_valid": ds["copernicus"].get("token_valid", False),
            "expires_at":  ds["copernicus"].get("expires_at"),
        },
        {
            "id":        "imb",
            "name":      "IMB Piracy Reports",
            "type":      "maritime",
            "last_fetch": ds["imb"].get("last_poll"),
            "status":    _status(ds["imb"].get("failures", 0), ds["imb"].get("last_poll")),
            "failures":  ds["imb"].get("failures", 0),
        },
    ]

    usage = usage_tracker.get_stats(CLAUDE_BUDGET_USD)

    return {
        "backend": {
            "status":  "ok",
            "ping_ms": ping_ms,
            "version": "2.0",
        },
        "data_sources": sources,
        "claude_usage": usage,
    }


def _load_imb_incidents() -> list:
    global _IMB_INCIDENTS
    path = BASE_DIR / "data" / "imb_piracy.json"
    try:
        if path.exists():
            payload = _json.loads(path.read_text())
            _IMB_INCIDENTS = payload if isinstance(payload, list) else payload.get("incidents", [])
        else:
            _IMB_INCIDENTS = []
        with _DS_STATUS_LOCK:
            _DS_STATUS["imb"]["last_poll"] = datetime.now(timezone.utc).isoformat()
            _DS_STATUS["imb"]["failures"] = 0
        print(f"[imb] fetched {len(_IMB_INCIDENTS)} incidents")
    except Exception as ex:
        with _DS_STATUS_LOCK:
            _DS_STATUS["imb"]["failures"] = _DS_STATUS["imb"].get("failures", 0) + 1
        print(f"[imb] fetch error: {ex}")
        _IMB_INCIDENTS = []
    return _IMB_INCIDENTS


@app.get("/api/infrastructure/imb-piracy")
def api_imb_piracy():
    return _load_imb_incidents()


@app.post("/api/sources/init")
async def init_source(source: str):
    """Trigger an immediate one-shot fetch for a named data source."""
    valid = {"oref", "usgs", "gdacs", "rss"}
    if source not in valid:
        return {"ok": False, "source": source, "message": f"Unknown source. Valid: {', '.join(sorted(valid))}"}
    if source == "rss":
        loop = asyncio.get_event_loop()
        loop.run_in_executor(_executor, _run_news_conflict_extraction_sync)
        return {"ok": True, "source": source, "message": "RSS extraction triggered immediately"}
    # For oref/usgs/gdacs the loops are already running on their own schedules;
    # reset last_poll so the UI shows it as pending until the next cycle completes.
    with _DS_STATUS_LOCK:
        _DS_STATUS[source]["last_poll"] = None
        _DS_STATUS[source]["failures"] = 0
    return {"ok": True, "source": source, "message": f"{source} status reset — next poll will update"}




@app.get("/geocode")
async def geocode_places(
    q: str = Query(..., min_length=1),
    limit: int = Query(5, ge=1, le=10),
):
    query = (q or "").strip()
    if not query:
        return []

    cache_key = (query.lower(), limit)
    cached = _geocode_proxy_cache.get(cache_key)
    if cached is not None:
        print(f"[geocode] cache hit q='{query}' limit={limit} results={len(cached)}")
        return cached

    params = {
        "format": "json",
        "q": query,
        "limit": str(limit),
        "addressdetails": "1",
    }
    print(f"[geocode] incoming q='{query}' limit={limit}")
    try:
        async with httpx.AsyncClient(
            timeout=10.0,
            headers={"User-Agent": "AkiliDashboard/1.0 (contact: dev@local)"},
        ) as client_h:
            req = client_h.build_request(
                "GET",
                "https://nominatim.openstreetmap.org/search",
                params=params,
            )
            print(f"[geocode] nominatim url={req.url}")
            r = await client_h.send(req)
            preview = (r.text or "")[:200].replace("\n", " ")
            print(f"[geocode] nominatim status={r.status_code}")
            print(f"[geocode] response preview='{preview}'")
            r.raise_for_status()
            try:
                raw = r.json()
            except Exception as parse_ex:
                print(f"[geocode] json parse error: {parse_ex}")
                return []
    except Exception as ex:
        print(f"[geocode-proxy] error for '{query}': {ex}")
        return []

    results = []
    for item in raw if isinstance(raw, list) else []:
        try:
            lat = float(item.get("lat"))
            lon = float(item.get("lon"))
        except (TypeError, ValueError):
            continue
        results.append({
            "display_name": item.get("display_name", ""),
            "lat": lat,
            "lon": lon,
        })

    print(f"[geocode] parsed result count={len(results)}")
    _geocode_proxy_cache[cache_key] = results
    return results


@app.post("/analyse")
async def analyse_event(payload: dict):
    if not client:
        return {"error": "ANTHROPIC_API_KEY is not set. Add it to backend/.env and restart the server."}

    event         = payload.get("event", {})
    event_id      = event.get("id")
    contextual    = bool(payload.get("contextual", False))
    mission_brief = payload.get("mission_brief", "")
    profile       = payload.get("profile", None)

    cache_key = f"{event_id}_ctx" if contextual else event_id
    if mission_brief:
        import hashlib
        cache_key = f"{cache_key}_m{hashlib.md5(mission_brief.encode()).hexdigest()[:8]}"
    cache_key = (cache_key or "") + _profile_cache_suffix(profile)
    if cache_key and cache_key in _analysis_cache:
        print(f"[analyse] CACHE HIT  {cache_key}")
        return _analysis_cache[cache_key]

    # Gate 3: persistent dedup cache (survives restarts)
    if cache_key:
        dedup_hit = usage_tracker.check_dedup(cache_key)
        if dedup_hit is not None:
            print(f"[analyse] DEDUP HIT  {cache_key}")
            _analysis_cache[cache_key] = dedup_hit
            return dedup_hit

    print(f"[analyse] CACHE MISS {cache_key} — calling Claude API (contextual={contextual})")

    profile_context = _format_profile_context(profile)

    mission_context = ""
    if mission_brief:
        mission_context = (
            f"ANALYST MISSION CONTEXT:\n"
            f"The analyst is currently working on the following mission objective:\n"
            f"{mission_brief}\n"
            f"Frame all analysis in the context of this mission. Prioritise information "
            f"relevant to this objective. If this event is irrelevant to the mission, "
            f"say so directly in one sentence rather than producing a full brief.\n\n"
        )

    context_block = profile_context + mission_context + (get_context_for_prompt() + "\n\n" if contextual else "")

    _event_data = (
        f"- Date: {event.get('date')}\n"
        f"- Type: {event.get('type')} / {event.get('subtype')}\n"
        f"- Actor: {event.get('actor')}\n"
        f"- Location: {event.get('location')} ({event.get('lat')}, {event.get('lng')})\n"
        f"- Fatalities: {event.get('fatalities')}\n"
        f"- Description: {event.get('description')}"
    )

    if contextual:
        prompt = f"""{context_block}You are Akili, a senior intelligence analyst.
Your job is not to describe what happened — it is to tell the analyst what it means and what they should consider doing. The person reading this brief is intelligent but not an intelligence professional. They need clarity, not jargon. They need action options, not scores.

EVENT:
{_event_data}

Write a structured brief with exactly these five sections. Be direct. Be specific. Never use vague language like "it may be worth considering" — say what you mean.

## WHAT HAPPENED
One paragraph. Plain language. What is this event, who is involved, where, when. No jargon. If something is unconfirmed, say so plainly.

## WHY THIS MATTERS
One to three paragraphs. Be specific about the interests at stake relative to the analyst's focus regions. Reference real assets, relationships, trade routes, or vulnerabilities. If it is not relevant to their focus areas, say so directly and explain why. Do not inflate relevance.

## WHAT THIS COULD MEAN IN 30, 90, AND 180 DAYS
Three short bullet points — one per time horizon. What is the realistic trajectory if nothing changes? What could accelerate or reverse it?

## WHAT TO CONSIDER
Two to four concrete, specific options — diplomatic, economic, security, or commercial. For each: what it is, what it achieves, what it risks or costs. If there is a clear best option, say so.

## CONFIDENCE AND SOURCE QUALITY
One sentence on how reliable this information is and what would change the assessment.

Regional Relevance: [X]/10 — [one sentence on concrete interest, not abstract geopolitics]"""
    else:
        prompt = f"""You are a geopolitical intelligence analyst.

Produce a structured intelligence brief for the following conflict event. Be concise, analytical, and intelligence-grade — not journalistic. Total response must be under 500 tokens.

EVENT DATA:
{_event_data}

Respond in clean markdown with exactly these five sections and no other text:

## Event Summary
What happened, when, where, and who was involved.

## Immediate Impact Assessment
Civilian risk level, displacement likelihood, and any infrastructure affected.

## Actor Context
Who this actor is, their known behaviour patterns, and regional affiliations.

## Nearby Sites & Areas Affected
Based on the location name and coordinates, reason about what is likely nearby — ports, roads, borders, urban centres, key infrastructure — and how this event may affect them.

## Escalation Outlook
Likelihood of escalation given the event type, actor profile, and regional context. Rate as Low / Medium / High and justify briefly."""

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=700 if contextual else 600,
            messages=[{"role": "user", "content": prompt}]
        )
        usage_tracker.record_call(message.usage.input_tokens, message.usage.output_tokens)
        text = message.content[0].text.strip()
        result = {"markdown": text}
        if cache_key:
            _analysis_cache[cache_key] = result
            usage_tracker.store_dedup(cache_key, result)
        return result
    except Exception as e:
        print(f"[analyse] ERROR: {type(e).__name__}: {e}")
        return {"error": str(e)}


@app.post("/analyse/area")
async def analyse_area(body: dict = Body(...)):
    """
    Area-level contextual enrichment analysis.
    Accepts a cluster of events from a map click area.
    Returns structured JSON enrichment data + prose analysis.
    """
    headlines          = body.get("headlines", [])        # list of {title, source, date, url, description}
    lat                = float(body.get("lat", 0))
    lon                = float(body.get("lon", 0))
    radius_km          = float(body.get("radius_km", 300))
    location_name      = body.get("location_name", "")
    nearby_chokepoints = body.get("nearby_chokepoints", [])   # list of chokepoint names
    nearby_infra       = body.get("nearby_infra", [])         # list of {name, type, lat, lon}
    profile            = body.get("profile")
    mission_brief      = body.get("mission_brief", "")

    if not headlines:
        return {"error": "No headlines provided"}

    # Build cache key
    import hashlib
    headline_hash = hashlib.md5("|".join(h.get("title", "") for h in headlines[:8]).encode()).hexdigest()[:12]
    cache_key = f"area:{round(lat,1)}:{round(lon,1)}:{headline_hash}"
    if profile:
        cache_key += _profile_cache_suffix(profile)

    # Check persistent dedup cache
    cached = usage_tracker.check_dedup(cache_key)
    if cached:
        return cached

    # Format headlines for prompt
    headline_lines = []
    for i, h in enumerate(headlines[:8], 1):
        title  = h.get("title", "")
        source = h.get("source", "")
        date   = (h.get("date") or h.get("published", ""))[:10]
        desc   = (h.get("description") or h.get("summary", ""))[:200]
        headline_lines.append(f"{i}. [{source}] {date}: {title}")
        if desc:
            headline_lines.append(f"   {desc}")

    # Format nearby infrastructure
    infra_lines = []
    for item in nearby_infra[:10]:
        dist = ""
        if item.get("distance_km"):
            dist = f" ({item['distance_km']:.0f}km)"
        infra_lines.append(f"- {item.get('name', '?')} [{item.get('type', '?')}]{dist}")

    profile_context = _format_profile_context(profile) if profile else ""
    chokepoint_str  = ", ".join(nearby_chokepoints) if nearby_chokepoints else "none identified"
    infra_str       = "\n".join(infra_lines) if infra_lines else "none provided"

    prompt = f"""{profile_context}You are an intelligence analyst. Analyse the following cluster of events from around {location_name or f"{lat:.2f}°, {lon:.2f}°"} (radius ~{radius_km:.0f}km).

EVENTS IN AREA:
{chr(10).join(headline_lines)}

NEARBY CHOKEPOINTS: {chokepoint_str}

NEARBY INFRASTRUCTURE:
{infra_str}

{'MISSION CONTEXT: ' + mission_brief if mission_brief else ''}

Respond in exactly two parts:

PART 1 — Output a JSON block (wrapped in ```json``` tags) with this exact structure:
{{
  "relevance_score": <0-100>,
  "relevant_to_profile": <true/false>,
  "event_classification": "<conflict|maritime|aviation|energy|political|protest|disaster>",
  "primary_location": {{"name": "<place name>", "lat": <lat>, "lon": <lon>}},
  "aggressor_entities": ["<country code or name>"],
  "affected_entities": ["<country code or name>"],
  "highlight_chokepoints": ["<chokepoint names from the provided list if relevant>"],
  "affected_shipping_routes": [{{"from": "<port/region>", "to": "<port/region>", "reason": "<brief>"}}],
  "relevant_infrastructure": [{{"name": "<name>", "type": "<type>", "lat": <lat>, "lon": <lon>, "relevance": "<brief>"}}],
  "conflict_polygon": [[<lat>, <lon>]],
  "severity": "<critical|significant|elevated|low>",
  "icon_type": "<explosion|armed_clash|missile|maritime|aviation|energy|protest|political|disaster>"
}}

PART 2 — Write exactly 3 paragraphs of analytical prose (no headers, no bullets):
Paragraph 1: What is happening and the geopolitical context.
Paragraph 2: Infrastructure and economic consequences, supply chain or energy implications.
Paragraph 3: Key indicators to monitor over the next 30-90 days.

Keep total prose to 250 words maximum."""

    loop = asyncio.get_event_loop()

    def _call():
        return client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=900,
            messages=[{"role": "user", "content": prompt}],
        )

    try:
        resp = await loop.run_in_executor(_executor, _call)
    except Exception as ex:
        return {"error": str(ex)}

    raw_text = resp.content[0].text if resp.content else ""
    usage_tracker.record_call(
        resp.usage.input_tokens,
        resp.usage.output_tokens,
        call_type="analysis",
        headline=f"area:{location_name or f'{lat:.1f},{lon:.1f}'}",
    )

    # Parse JSON block from response
    json_match = re.search(r"```json\s*(.*?)\s*```", raw_text, re.DOTALL)
    enrichment = {}
    if json_match:
        try:
            enrichment = _json.loads(json_match.group(1))
        except _json.JSONDecodeError:
            pass

    # Extract prose (everything after the json block)
    prose = raw_text
    if json_match:
        prose = raw_text[json_match.end():].strip()
    # Remove any stray PART markers
    prose = re.sub(r"PART [12][:\s\u2014]*", "", prose).strip()

    result = {
        "enrichment":     enrichment,
        "prose":          prose,
        "raw":            raw_text,
        "location":       location_name or f"{lat:.2f}°, {lon:.2f}°",
        "headline_count": len(headlines[:8]),
    }

    usage_tracker.store_dedup(cache_key, result)
    return result


# ── /analyse-news ──────────────────────────────────────────────────────────────

_news_analysis_cache: dict = {}   # keyed by marker URL (stable unique id)

@app.post("/analyse-news")
async def analyse_news_marker(payload: dict):
    """Produce a Claude intelligence brief for a news-derived conflict marker."""
    if not client:
        return {"error": "ANTHROPIC_API_KEY is not set. Add it to backend/.env and restart the server."}

    marker        = payload.get("marker", {})
    contextual    = bool(payload.get("contextual", False))
    mission_brief = payload.get("mission_brief", "")
    profile       = payload.get("profile", None)

    url       = marker.get("url", "")
    cache_key = f"{url}_ctx" if contextual else url
    if mission_brief:
        import hashlib
        cache_key = f"{cache_key}_m{hashlib.md5(mission_brief.encode()).hexdigest()[:8]}"
    cache_key = (cache_key or "") + _profile_cache_suffix(profile)
    if cache_key and cache_key in _news_analysis_cache:
        print(f"[analyse-news] CACHE HIT {cache_key[:60]}")
        return _news_analysis_cache[cache_key]

    # Gate 3: persistent dedup cache (survives restarts)
    if cache_key:
        dedup_hit = usage_tracker.check_dedup("news:" + cache_key)
        if dedup_hit is not None:
            print(f"[analyse-news] DEDUP HIT {cache_key[:60]}")
            _news_analysis_cache[cache_key] = dedup_hit
            return dedup_hit

    print(f"[analyse-news] calling Claude for: {marker.get('headline', '')[:60]} (contextual={contextual})")

    profile_context = _format_profile_context(profile)

    mission_context = ""
    if mission_brief:
        mission_context = (
            f"ANALYST MISSION CONTEXT:\n"
            f"The analyst is currently working on the following mission objective:\n"
            f"{mission_brief}\n"
            f"Frame all analysis in the context of this mission. Prioritise information "
            f"relevant to this objective. If this event is irrelevant to the mission, "
            f"say so directly in one sentence rather than producing a full brief.\n\n"
        )
    context_block = profile_context + mission_context + (get_minimal_context() + "\n\n" if contextual else "")

    _news_data = (
        f"Headline: {marker.get('headline', '')}\n"
        f"Source: {marker.get('source', '')} ({marker.get('confidence', '?')} confidence)\n"
        f"Location: {marker.get('location', '')} ({marker.get('lat', '')}, {marker.get('lon', '')})\n"
        f"Published: {marker.get('published', '')}\n"
        f"URL: {marker.get('url', '')}"
    )

    if contextual:
        prompt = f"""{context_block}You are Akili, a senior intelligence analyst.
Your job is not to describe what happened — it is to tell the analyst what it means and what they should consider. This report is unverified — apply scepticism proportionate to the source quality.

NEWS REPORT:
{_news_data}

Write a structured brief with exactly these five sections. Be direct. If the report is low-confidence or irrelevant to the analyst's focus, say so plainly — do not manufacture importance.

## WHAT HAPPENED
One paragraph. Plain language. What does this report describe — who, what, where, when. Note explicitly if unconfirmed.

## WHY THIS MATTERS
One to two paragraphs. Be specific about actual interests at stake. Reference real assets, relationships, trade routes, or vulnerabilities from the strategic context. If it is not relevant, say so directly. Do not inflate relevance.

## WHAT THIS COULD MEAN IN 30, 90, AND 180 DAYS
Three short bullet points — one per time horizon. Realistic trajectory if nothing changes. What could accelerate or reverse it.

## WHAT TO CONSIDER
One to three concrete options — diplomatic, economic, security, or commercial. For each: what it is, what it achieves, what it risks. If the right response is to monitor but not act, say so and explain the trigger that would change that.

## CONFIDENCE AND SOURCE QUALITY
One sentence on source reliability. Note if state-affiliated, unverified, or corroborated. State what additional information would change the assessment.

Regional Relevance: [X]/10 — [one sentence on concrete interest, not abstract geopolitics]"""
    else:
        prompt = f"""You are a geopolitical intelligence analyst.

Analyse the following news-derived conflict report. The source is unverified — apply appropriate scepticism.

{_news_data}

Respond in clean markdown with EXACTLY these five sections and no other text:

## Event Summary
What the report describes — who, what, where, when.

## Likely Actors and Context
Known groups or state actors active in this region, relevant historical context.

## Regional Implications
Effects on neighbouring areas, civilian populations, or strategic infrastructure.

## Connection to Known Conflicts
Cross-reference with any known ongoing conflicts in this region. Note if this appears to be part of a larger pattern.

## Source Reliability Assessment
Evaluate this source's credibility. Note if state-affiliated, tabloid, or unverified. Rate confidence: HIGH / MEDIUM / LOW with one sentence of justification.

Keep the entire response under 400 tokens. Be specific and analytical."""

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=600 if contextual else 500,
            messages=[{"role": "user", "content": prompt}]
        )
        usage_tracker.record_call(message.usage.input_tokens, message.usage.output_tokens)
        result = {"markdown": message.content[0].text.strip()}
        if cache_key:
            _news_analysis_cache[cache_key] = result
            usage_tracker.store_dedup("news:" + cache_key, result)
        return result
    except Exception as e:
        print(f"[analyse-news] ERROR: {type(e).__name__}: {e}")
        return {"error": str(e)}


# ── /news ─────────────────────────────────────────────────────────────────────

_news_cache: dict = {}
NEWS_CACHE_TTL = 15 * 60  # seconds

# Translation cache: original title → (translated_title, detected_lang)
_translation_cache: dict[str, tuple[str, str]] = {}

# Per-country/region RSS sources. Keys are lowercase country names matching
# what the GeoJSON name property sends (after .lower()).
COUNTRY_SOURCES: dict[str, list[tuple[str, str]]] = {

    # ── East Africa ────────────────────────────────────────────────────────────
    "united republic of tanzania": [
        ("AllAfrica Tanzania", "https://allafrica.com/tools/headlines/rdf/tanzania/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Guardian Africa",    "https://www.theguardian.com/world/africa/rss"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "tanzania": [
        ("AllAfrica Tanzania", "https://allafrica.com/tools/headlines/rdf/tanzania/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Guardian Africa",    "https://www.theguardian.com/world/africa/rss"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "kenya": [
        ("AllAfrica Kenya",    "https://allafrica.com/tools/headlines/rdf/kenya/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Guardian Africa",    "https://www.theguardian.com/world/africa/rss"),
    ],
    "ethiopia": [
        ("AllAfrica Ethiopia", "https://allafrica.com/tools/headlines/rdf/ethiopia/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "uganda": [
        ("AllAfrica Uganda",   "https://allafrica.com/tools/headlines/rdf/uganda/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "rwanda": [
        ("AllAfrica Rwanda",   "https://allafrica.com/tools/headlines/rdf/rwanda/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "burundi": [
        ("AllAfrica Burundi",  "https://allafrica.com/tools/headlines/rdf/burundi/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "somalia": [
        ("AllAfrica Somalia",  "https://allafrica.com/tools/headlines/rdf/somalia/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "djibouti": [
        ("AllAfrica Djibouti", "https://allafrica.com/tools/headlines/rdf/djibouti/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "eritrea": [
        ("AllAfrica Eritrea",  "https://allafrica.com/tools/headlines/rdf/eritrea/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],

    # ── Sudan ──────────────────────────────────────────────────────────────────
    "sudan": [
        ("AllAfrica Sudan",    "https://allafrica.com/tools/headlines/rdf/sudan/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "south sudan": [
        ("AllAfrica S.Sudan",  "https://allafrica.com/tools/headlines/rdf/southsudan/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],

    # ── North Africa ───────────────────────────────────────────────────────────
    "egypt": [
        ("AllAfrica Egypt",    "https://allafrica.com/tools/headlines/rdf/egypt/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "libya": [
        ("AllAfrica Libya",    "https://allafrica.com/tools/headlines/rdf/libya/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "tunisia": [
        ("AllAfrica Tunisia",  "https://allafrica.com/tools/headlines/rdf/tunisia/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "algeria": [
        ("AllAfrica Algeria",  "https://allafrica.com/tools/headlines/rdf/algeria/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "morocco": [
        ("AllAfrica Morocco",  "https://allafrica.com/tools/headlines/rdf/morocco/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],

    # ── West Africa ────────────────────────────────────────────────────────────
    "nigeria": [
        ("AllAfrica Nigeria",  "https://allafrica.com/tools/headlines/rdf/nigeria/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Guardian Africa",    "https://www.theguardian.com/world/africa/rss"),
    ],
    "ghana": [
        ("AllAfrica Ghana",    "https://allafrica.com/tools/headlines/rdf/ghana/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "senegal": [
        ("AllAfrica Senegal",  "https://allafrica.com/tools/headlines/rdf/senegal/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "mali": [
        ("AllAfrica Mali",     "https://allafrica.com/tools/headlines/rdf/mali/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "burkina faso": [
        ("AllAfrica Burkina",  "https://allafrica.com/tools/headlines/rdf/burkinafaso/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "niger": [
        ("AllAfrica Niger",    "https://allafrica.com/tools/headlines/rdf/niger/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "côte d'ivoire": [
        ("AllAfrica IvoryCoast", "https://allafrica.com/tools/headlines/rdf/cotedivoire/headlines.rdf"),
        ("BBC Africa",           "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "cameroon": [
        ("AllAfrica Cameroon", "https://allafrica.com/tools/headlines/rdf/cameroon/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "guinea": [
        ("AllAfrica Guinea",   "https://allafrica.com/tools/headlines/rdf/guinea/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "sierra leone": [
        ("AllAfrica SierraLeone", "https://allafrica.com/tools/headlines/rdf/sierraleone/headlines.rdf"),
        ("BBC Africa",            "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "liberia": [
        ("AllAfrica Liberia",  "https://allafrica.com/tools/headlines/rdf/liberia/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],

    # ── Central Africa ─────────────────────────────────────────────────────────
    "democratic republic of the congo": [
        ("AllAfrica DRC",      "https://allafrica.com/tools/headlines/rdf/drc/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Guardian Africa",    "https://www.theguardian.com/world/africa/rss"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "republic of the congo": [
        ("AllAfrica Congo",    "https://allafrica.com/tools/headlines/rdf/congo/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "chad": [
        ("AllAfrica Chad",     "https://allafrica.com/tools/headlines/rdf/chad/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "central african republic": [
        ("AllAfrica CAR",      "https://allafrica.com/tools/headlines/rdf/centralafricanrepublic/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "gabon": [
        ("AllAfrica Gabon",    "https://allafrica.com/tools/headlines/rdf/gabon/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],

    # ── Southern Africa ────────────────────────────────────────────────────────
    "south africa": [
        ("AllAfrica S.Africa", "https://allafrica.com/tools/headlines/rdf/southafrica/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Guardian Africa",    "https://www.theguardian.com/world/africa/rss"),
    ],
    "mozambique": [
        ("AllAfrica Mozambique", "https://allafrica.com/tools/headlines/rdf/mozambique/headlines.rdf"),
        ("BBC Africa",           "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "zambia": [
        ("AllAfrica Zambia",   "https://allafrica.com/tools/headlines/rdf/zambia/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "zimbabwe": [
        ("AllAfrica Zimbabwe", "https://allafrica.com/tools/headlines/rdf/zimbabwe/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "malawi": [
        ("AllAfrica Malawi",   "https://allafrica.com/tools/headlines/rdf/malawi/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "angola": [
        ("AllAfrica Angola",   "https://allafrica.com/tools/headlines/rdf/angola/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "madagascar": [
        ("AllAfrica Madagascar", "https://allafrica.com/tools/headlines/rdf/madagascar/headlines.rdf"),
        ("BBC Africa",           "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "namibia": [
        ("AllAfrica Namibia",  "https://allafrica.com/tools/headlines/rdf/namibia/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "botswana": [
        ("AllAfrica Botswana", "https://allafrica.com/tools/headlines/rdf/botswana/headlines.rdf"),
        ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],

    # ── Middle East ────────────────────────────────────────────────────────────
    "israel": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "palestine": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "iran": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "iraq": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
    ],
    "syria": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "yemen": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
    ],
    "saudi arabia": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "united arab emirates": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "turkey": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "jordan": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
    ],
    "lebanon": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
    ],
    "qatar": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
    ],
    "kuwait": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
    ],
    "oman": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
    ],
    "bahrain": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Middle East",    "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
    ],
    "afghanistan": [
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],

    # ── Russia / FSU ───────────────────────────────────────────────────────────
    "russia": [
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "ukraine": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "belarus": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "georgia": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "armenia": [
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "azerbaijan": [
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "kazakhstan": [
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],

    # ── Asia-Pacific ───────────────────────────────────────────────────────────
    "china": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "india": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "pakistan": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "myanmar": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "north korea": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "south korea": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "japan": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "taiwan": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "indonesia": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "philippines": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "thailand": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "vietnam": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
    ],
    "bangladesh": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "sri lanka": [
        ("BBC Asia",           "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],

    # ── Western Europe ─────────────────────────────────────────────────────────
    "france": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "germany": [
        ("Deutsche Welle",     "https://rss.dw.com/rdf/rss-en-all"),
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "united kingdom": [
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "spain": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "italy": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "poland": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "hungary": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "serbia": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "greece": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "austria": [
        ("Deutsche Welle",     "https://rss.dw.com/rdf/rss-en-all"),
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "switzerland": [
        ("Deutsche Welle",     "https://rss.dw.com/rdf/rss-en-all"),
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "netherlands": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "sweden": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "kosovo": [
        ("BBC Europe",         "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],

    # ── Americas ───────────────────────────────────────────────────────────────
    "united states of america": [
        ("BBC Americas",       "http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "canada": [
        ("BBC Americas",       "http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
    "mexico": [
        ("BBC Latin America",  "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml"),
        ("BBC Americas",       "http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "brazil": [
        ("BBC Latin America",  "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("Guardian World",     "https://www.theguardian.com/world/rss"),
    ],
    "venezuela": [
        ("BBC Latin America",  "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "colombia": [
        ("BBC Latin America",  "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "cuba": [
        ("BBC Latin America",  "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "haiti": [
        ("BBC Latin America",  "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "nicaragua": [
        ("BBC Latin America",  "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "ecuador": [
        ("BBC Latin America",  "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "peru": [
        ("BBC Latin America",  "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml"),
        ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "argentina": [
        ("BBC Latin America",  "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml"),
        ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
}

# Global fallback when no country-specific sources are defined.
GLOBAL_FALLBACK_FEEDS = [
    ("BBC World",          "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ("Al Jazeera",         "https://www.aljazeera.com/xml/rss/all.xml"),
    ("BBC Africa",         "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ("AllAfrica",          "https://allafrica.com/tools/headlines/rdf/africa/headlines.rdf"),
    ("Guardian Africa",    "https://www.theguardian.com/world/africa/rss"),
]

# Known aliases, abbreviations, and major cities for common countries.
_COUNTRY_ALIASES: dict[str, list[str]] = {
    "united arab emirates":               ["uae", "dubai", "abu dhabi", "emirates", "sharjah"],
    "united states of america":           ["usa", "american", "washington", "us government"],
    "united kingdom":                     ["uk", "britain", "british", "london", "england", "scotland", "wales"],
    "democratic republic of the congo":   ["drc", "kinshasa", "congo-kinshasa", "dr congo"],
    "republic of the congo":              ["brazzaville", "congo-brazzaville"],
    "côte d'ivoire":                      ["ivory coast", "abidjan", "cote d'ivoire"],
    "myanmar":                            ["burma", "rangoon", "yangon"],
    "iran":                               ["tehran", "persian", "iranian"],
    "russia":                             ["moscow", "kremlin", "russian", "putin"],
    "china":                              ["beijing", "chinese", "prc", "shanghai"],
    "north korea":                        ["pyongyang", "dprk", "kim jong"],
    "south korea":                        ["seoul", "korean"],
    "saudi arabia":                       ["riyadh", "saudi", "jeddah"],
    "south africa":                       ["johannesburg", "cape town", "pretoria", "s. africa", "jo'burg"],
    "kenya":                              ["nairobi", "kenyan"],
    "united republic of tanzania":        ["tanzania", "dar es salaam", "dodoma", "tanzanian"],
    "tanzania":                           ["dar es salaam", "dodoma", "tanzanian"],
    "ethiopia":                           ["addis ababa", "addis", "ethiopian"],
    "egypt":                              ["cairo", "egyptian"],
    "nigeria":                            ["abuja", "lagos", "nigerian"],
    "ghana":                              ["accra", "ghanaian"],
    "mozambique":                         ["maputo"],
    "zambia":                             ["lusaka"],
    "zimbabwe":                           ["harare"],
    "somalia":                            ["mogadishu", "somali"],
    "rwanda":                             ["kigali", "rwandan"],
    "uganda":                             ["kampala", "ugandan"],
    "sudan":                              ["khartoum", "sudanese"],
    "south sudan":                        ["juba"],
    "mali":                               ["bamako", "malian"],
    "burkina faso":                       ["ouagadougou"],
    "niger":                              ["niamey"],
    "chad":                               ["n'djamena"],
    "cameroon":                           ["yaounde", "douala"],
    "israel":                             ["tel aviv", "jerusalem", "israeli", "idf"],
    "ukraine":                            ["kyiv", "kiev", "ukrainian", "zelenskyy"],
    "turkey":                             ["ankara", "istanbul", "turkish", "erdogan"],
    "senegal":                            ["dakar", "senegalese"],
    "djibouti":                           ["djiboutian"],
    "france":                             ["paris", "french", "macron"],
    "germany":                            ["berlin", "german"],
    "india":                              ["delhi", "mumbai", "indian", "modi"],
    "pakistan":                           ["islamabad", "karachi", "pakistani"],
    "afghanistan":                        ["kabul", "afghan", "taliban"],
    "myanmar":                            ["burma", "naypyidaw"],
    "syria":                              ["damascus", "syrian", "aleppo"],
    "iraq":                               ["baghdad", "iraqi"],
    "yemen":                              ["sanaa", "yemeni", "houthi"],
    "libya":                              ["tripoli", "benghazi", "libyan"],
    "venezuela":                          ["caracas", "maduro"],
    "brazil":                             ["brasilia", "rio", "lula"],
}

# Stop words excluded from the significant-word fallback.
_STOP = {
    "the", "of", "and", "or", "in", "at", "to", "for", "a", "an", "la", "de",
    "united", "republic", "democratic", "peoples", "kingdom", "states", "federation",
    "north", "south", "east", "west", "new", "islands", "island", "central",
}


def _country_terms(country: str) -> list[str]:
    """Return all search terms (lowercase) for a country name."""
    name_lower = country.lower()
    terms: set[str] = {name_lower}
    terms.update(_COUNTRY_ALIASES.get(name_lower, []))
    for word in name_lower.split():
        if word not in _STOP and len(word) > 3:
            terms.add(word)
    return list(terms)


def _parse_ts(ts: str) -> float:
    """Return UTC Unix timestamp; returns 0.0 (sorts to end) on parse failure."""
    try:
        from datetime import datetime
        return datetime.strptime(ts, "%Y%m%dT%H%M%SZ").timestamp()
    except Exception:
        pass
    try:
        return parsedate_to_datetime(ts).timestamp()
    except Exception:
        return 0.0


def _translate_title(title: str) -> tuple[str, str, str]:
    """
    Detect language and translate to English if needed.
    Returns (display_title, language_code, translation_note).
    translation_note is "" for English, "[auto-translated]" on success,
    "[translation failed]" if LibreTranslate was unreachable.
    """
    if not title:
        return title, "en", ""

    # Return cached result immediately
    if title in _translation_cache:
        cached_title, cached_lang = _translation_cache[title]
        note = "[auto-translated]" if cached_lang != "en" else ""
        return cached_title, cached_lang, note

    # Detect language
    if not _HAS_LANGDETECT:
        _translation_cache[title] = (title, "en")
        return title, "en", ""

    try:
        lang = _langdetect_detect(title)
    except Exception:
        _translation_cache[title] = (title, "en")
        return title, "en", ""

    if lang == "en":
        _translation_cache[title] = (title, "en")
        return title, "en", ""

    # Non-English: attempt LibreTranslate (3s timeout)
    try:
        body = _json.dumps({
            "q": title, "source": lang, "target": "en", "format": "text"
        }).encode()
        req = urllib.request.Request(
            "https://libretranslate.com/translate",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = _json.loads(resp.read())
            translated = data.get("translatedText", title)
            _translation_cache[title] = (translated, lang)
            return translated, lang, "[auto-translated]"
    except Exception as exc:
        print(f"[translate] lang={lang} failed: {type(exc).__name__}")
        _translation_cache[title] = (title, lang)
        return title, lang, "[translation failed]"


_EAST_AFRICA_CODES = {"tz", "ke", "ug", "rw", "bi", "cd", "so", "et", "sd", "ss", "mz", "zm", "mw"}
_REGION_COUNTRY_CODES = {
    "east_africa": _EAST_AFRICA_CODES,
    "africa": {
        "dz", "ao", "bj", "bw", "bf", "bi", "cv", "cm", "cf", "td", "km", "cd", "dj", "eg", "gq",
        "er", "sz", "et", "ga", "gm", "gh", "gn", "gw", "ci", "ke", "ls", "lr", "ly", "mg", "mw",
        "ml", "mr", "mu", "ma", "mz", "na", "ne", "ng", "rw", "st", "sn", "sc", "sl", "so", "za",
        "ss", "sd", "tz", "tg", "tn", "ug", "zm", "zw",
    },
    "middle_east": {"ae", "bh", "eg", "iq", "ir", "il", "jo", "kw", "lb", "om", "ps", "qa", "sa", "sy", "tr", "ye"},
    "europe": {
        "al", "ad", "at", "be", "ba", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu",
        "is", "ie", "it", "xk", "lv", "li", "lt", "lu", "mt", "md", "mc", "me", "nl", "mk", "no", "pl",
        "pt", "ro", "sm", "rs", "sk", "si", "es", "se", "ch", "ua", "gb",
    },
    "asia": {
        "af", "am", "az", "bd", "bt", "bn", "kh", "cn", "ge", "hk", "in", "id", "jp", "kz", "kg", "la", "my",
        "mn", "mm", "np", "kp", "pk", "ph", "sg", "kr", "lk", "tw", "tj", "th", "tl", "tm", "uz", "vn",
    },
    "americas": {
        "ag", "ar", "bs", "bb", "bz", "bo", "br", "ca", "cl", "co", "cr", "cu", "dm", "do", "ec", "sv", "gd",
        "gt", "gy", "ht", "hn", "jm", "mx", "ni", "pa", "py", "pe", "kn", "lc", "vc", "sr", "tt", "us", "uy", "ve",
    },
}

_COUNTRY_CENTROIDS_BY_CODE = {
    "tz": (-6.0, 35.0, "Tanzania"),
    "ke": (0.1, 37.9, "Kenya"),
    "ug": (1.3, 32.3, "Uganda"),
    "rw": (-1.95, 30.1, "Rwanda"),
    "bi": (-3.3, 29.9, "Burundi"),
    "cd": (-2.9, 23.7, "Democratic Republic of the Congo"),
    "so": (5.2, 46.2, "Somalia"),
    "et": (9.1, 40.5, "Ethiopia"),
    "sd": (15.6, 30.5, "Sudan"),
    "ss": (7.9, 30.1, "South Sudan"),
    "mz": (-18.7, 35.5, "Mozambique"),
    "zm": (-13.1, 27.8, "Zambia"),
    "mw": (-13.3, 34.3, "Malawi"),
    "zw": (-19.0, 29.1, "Zimbabwe"),
    "za": (-30.6, 22.9, "South Africa"),
}

_CITY_CENTROIDS = {
    "dar es salaam": (-6.7924, 39.2083, "Dar es Salaam", "tz"),
    "dodoma": (-6.1630, 35.7516, "Dodoma", "tz"),
    "nairobi": (-1.2864, 36.8172, "Nairobi", "ke"),
    "kampala": (0.3476, 32.5825, "Kampala", "ug"),
    "mogadishu": (2.0469, 45.3182, "Mogadishu", "so"),
    "addis ababa": (8.9806, 38.7578, "Addis Ababa", "et"),
    "juba": (4.8594, 31.5713, "Juba", "ss"),
    "khartoum": (15.5007, 32.5599, "Khartoum", "sd"),
}

_GEO_VALIDATION_STATS = {
    "strict_success": 0,
    "relaxed_success": 0,
    "fallback_country": 0,
    "none": 0,
    "rejected_due_to_country_mismatch": 0,
}
_BAD_CANDIDATE_MISMATCHES = Counter()
_GEO_STATS_LOCK = threading.Lock()


def _record_geo_resolution(stage: str) -> None:
    with _GEO_STATS_LOCK:
        if stage in _GEO_VALIDATION_STATS:
            _GEO_VALIDATION_STATS[stage] += 1


def _record_geo_mismatch(candidate: str) -> None:
    with _GEO_STATS_LOCK:
        _GEO_VALIDATION_STATS["rejected_due_to_country_mismatch"] += 1
        if candidate:
            _BAD_CANDIDATE_MISMATCHES[candidate] += 1


def _snapshot_geo_validation_stats() -> dict:
    with _GEO_STATS_LOCK:
        return {
            **_GEO_VALIDATION_STATS,
            "top_bad_candidates": _BAD_CANDIDATE_MISMATCHES.most_common(10),
        }


def _infer_feed_region(source_name: str = "", feed_url: str = "") -> str:
    meta_region = ((RSS_FEED_META.get(feed_url or "", {}) or {}).get("region") or "").strip().lower()
    if meta_region in {"east_africa", "africa", "middle_east", "europe", "asia", "americas", "global"}:
        return meta_region
    s = f"{source_name} {feed_url}".lower()
    if any(token in s for token in ("tanzania", "kenya", "uganda", "rwanda", "burundi", "somalia", "ethiopia", "south sudan", "congo", "eastafrica")):
        return "east_africa"
    if "east africa" in s:
        return "east_africa"
    if any(token in s for token in ("middle east", "arab", "israel", "iran", "iraq", "lebanon", "gaza", "saudi", "qatar", "oman", "tehran")):
        return "middle_east"
    if any(token in s for token in ("europe", "eu", "balkan", "ukraine", "germany", "france", "italy", "spain", "swiss")):
        return "europe"
    if any(token in s for token in ("asia", "india", "china", "japan", "korea", "taiwan", "thai", "vietnam", "pakistan", "philipp")):
        return "asia"
    if any(token in s for token in ("america", "canada", "mexico", "brazil", "argentina", "peru", "colombia", "chile")):
        return "americas"
    if "africa" in s or "allafrica" in s:
        return "africa"
    return "global"


def validate_geo(
    expected_countries: set[str],
    geo_result: dict,
    query: str,
    east_africa_bias: bool = False,
    feed_region: str = "global",
) -> bool:
    cc = (geo_result.get("country_code") or "").lower()
    if expected_countries:
        return cc in expected_countries

    if east_africa_bias:
        return cc in _EAST_AFRICA_CODES

    query_country = country_code_from_name(query)
    if query_country:
        return cc == query_country

    # Support "City, Country" candidates.
    if "," in query:
        tail = query.split(",")[-1].strip()
        tail_country = country_code_from_name(tail)
        if tail_country:
            return cc == tail_country

    region = (feed_region or "global").strip().lower()
    if region in _REGION_COUNTRY_CODES:
        return cc in _REGION_COUNTRY_CODES[region]

    # Global feeds are intentionally permissive to preserve marker volume.
    return bool(cc)


def _fallback_city_from_text(text_blob: str, expected_countries: set[str]) -> Optional[dict]:
    text = (text_blob or "").lower()
    for city_key, (lat, lon, display, cc) in _CITY_CENTROIDS.items():
        if re.search(rf"\b{re.escape(city_key)}\b", text):
            if expected_countries and cc not in expected_countries:
                continue
            return {
                "lat": lat,
                "lon": lon,
                "display_name": f"{display} (centroid fallback)",
                "type": "fallback_city",
                "class": "fallback",
                "boundingbox": [],
                "address": {"country_code": cc, "country": country_name_from_code(cc) or ""},
                "country_code": cc,
                "country": country_name_from_code(cc) or "",
            }
    return None


def _fallback_country_by_code(country_code: str) -> Optional[dict]:
    cc = (country_code or "").lower()
    if cc not in _COUNTRY_CENTROIDS_BY_CODE:
        return None
    lat, lon, display = _COUNTRY_CENTROIDS_BY_CODE[cc]
    return {
        "lat": lat,
        "lon": lon,
        "display_name": f"{display} (centroid fallback)",
        "type": "fallback_country",
        "class": "fallback",
        "boundingbox": [],
        "address": {"country_code": cc, "country": display},
        "country_code": cc,
        "country": display,
    }


def _geocode_from_text_blob(
    title: str,
    summary: str,
    source_name: str = "",
    feed_url: str = "",
    max_candidates: int = 5,
    allow_live_lookup: bool = True,
) -> tuple[Optional[dict], Optional[str], list[str], dict]:
    """
    Region-aware staged geocoding:
    1) strict candidate geocode with country/region validation
    2) relaxed country-only geocode when expected countries exist
    3) safe fallback (country centroid when exactly one expected country; city fallback)
    """
    # Position-weighted candidate extraction: title locations rank highest,
    # then first-100-word body, then remainder. This prevents incidental country
    # mentions deep in an article from displacing the headline location.
    candidates = rank_location_candidates(title or "", summary or "")
    text_blob  = f"{title or ''} {summary or ''}".strip()
    expected_countries = extract_country_mentions(text_blob)

    # Augment with gazetteer (appended after ranked candidates to preserve order)
    seen = {c.lower() for c in candidates}
    for loc in extract_locations_gazetteer(text_blob):
        key = loc.lower()
        if key not in seen:
            candidates.append(loc)
            seen.add(key)

    feed_region = _infer_feed_region(source_name, feed_url)
    east_africa_bias = bool(expected_countries & _EAST_AFRICA_CODES) or feed_region in {"africa", "east_africa"}
    region_bias = "east_africa" if east_africa_bias else None
    meta = {
        "location_confidence": "none",
        "resolved_country_code": None,
        "resolved_display_name": None,
        "expected_countries": sorted(expected_countries),
    }

    # Stage 1: strict geocode with validation.
    if allow_live_lookup:
        for candidate in candidates[:max_candidates]:
            geo_candidates = geocode_place(
                candidate,
                expected_country_codes=sorted(expected_countries) if expected_countries else None,
                region_bias=region_bias,
            )
            for geo in geo_candidates:
                if validate_geo(
                    expected_countries,
                    geo,
                    candidate,
                    east_africa_bias=east_africa_bias,
                    feed_region=feed_region,
                ):
                    meta["location_confidence"] = "strict"
                    meta["resolved_country_code"] = (geo.get("country_code") or "").lower() or None
                    meta["resolved_display_name"] = geo.get("display_name")
                    _record_geo_resolution("strict_success")
                    return geo, candidate, candidates, meta
                # Explicit title mention overrides country-mismatch rejection:
                # if the location candidate appears verbatim in the article title,
                # trust the geocode regardless of expected-country mismatch.
                _title_lower = (title or "").lower()
                _cand_lower  = (candidate or "").lower()
                if _cand_lower and len(_cand_lower) > 3 and _cand_lower in _title_lower:
                    meta["location_confidence"] = "strict"
                    meta["resolved_country_code"] = (geo.get("country_code") or "").lower() or None
                    meta["resolved_display_name"] = geo.get("display_name")
                    _record_geo_resolution("strict_success")
                    return geo, candidate, candidates, meta
                _record_geo_mismatch(candidate)

    # Stage 2: relaxed country-only lookup for expected countries.
    if expected_countries and allow_live_lookup:
        for cc in sorted(expected_countries):
            country_name = country_name_from_code(cc) or cc
            geo_candidates = geocode_place(
                country_name,
                expected_country_codes=[cc],
                region_bias="east_africa" if cc in _EAST_AFRICA_CODES else None,
            )
            for geo in geo_candidates:
                if validate_geo(
                    {cc},
                    geo,
                    country_name,
                    east_africa_bias=cc in _EAST_AFRICA_CODES,
                    feed_region=feed_region,
                ):
                    meta["location_confidence"] = "relaxed"
                    meta["resolved_country_code"] = cc
                    meta["resolved_display_name"] = geo.get("display_name")
                    _record_geo_resolution("relaxed_success")
                    return geo, country_name, candidates, meta
                _record_geo_mismatch(country_name)

    # Stage 3a: known city fallback.
    fallback_city = _fallback_city_from_text(text_blob, expected_countries)
    if fallback_city:
        meta["location_confidence"] = "relaxed"
        meta["resolved_country_code"] = fallback_city.get("country_code")
        meta["resolved_display_name"] = fallback_city.get("display_name")
        _record_geo_resolution("relaxed_success")
        return fallback_city, fallback_city.get("display_name"), candidates, meta

    # Stage 3b: deterministic country centroid fallback.
    if len(expected_countries) == 1:
        cc = next(iter(expected_countries))
        fallback_country = _fallback_country_by_code(cc)
        if fallback_country:
            meta["location_confidence"] = "fallback_country"
            meta["resolved_country_code"] = cc
            meta["resolved_display_name"] = fallback_country.get("display_name")
            _record_geo_resolution("fallback_country")
            return fallback_country, fallback_country.get("display_name"), candidates, meta

    _record_geo_resolution("none")
    return None, None, candidates, meta


def _enrich_article_geo(
    article: dict,
    title: str,
    summary: str,
    source_name: str = "",
    feed_url: str = "",
    allow_live_lookup: bool = True,
) -> tuple[dict, Optional[str], dict]:
    """
    Add location_name/lat/lon keys without removing existing article fields.
    """
    geo, winning_candidate, _, meta = _geocode_from_text_blob(
        title,
        summary,
        source_name=source_name,
        feed_url=feed_url,
        allow_live_lookup=allow_live_lookup,
    )
    enriched = {**article}
    if geo:
        enriched["location_name"] = geo.get("display_name")
        enriched["lat"] = geo.get("lat")
        enriched["lon"] = geo.get("lon")
        enriched["location_confidence"] = meta.get("location_confidence", "none")
        enriched["resolved_country_code"] = meta.get("resolved_country_code")
        enriched["resolved_display_name"] = meta.get("resolved_display_name")
    else:
        enriched["location_name"] = None
        enriched["lat"] = None
        enriched["lon"] = None
        enriched["location_confidence"] = "none"
        enriched["resolved_country_code"] = None
        enriched["resolved_display_name"] = None
    return enriched, winning_candidate, meta


@app.get("/news")
@_response_cache(expire=60)
def get_news(country: str):
    cache_key = country.lower()
    cached = _news_cache.get(cache_key)
    if cached and time.time() - cached["at"] < NEWS_CACHE_TTL:
        print(f"[news] CACHE HIT  {country}")
        return cached["data"]

    terms = _country_terms(country)
    print(f"[news] CACHE MISS {country} — terms: {terms}")

    # Country-specific sources if available, else global fallback
    feeds = COUNTRY_SOURCES.get(cache_key, GLOBAL_FALLBACK_FEEDS)
    tier = "country-specific" if cache_key in COUNTRY_SOURCES else "global fallback"
    print(f"[news] Using {tier} feeds ({len(feeds)} sources)")

    articles = []
    for source_name, feed_url in feeds:
        try:
            feed = feedparser.parse(feed_url)
            total = len(feed.entries)
            matched = []
            for entry in feed.entries:
                text = (entry.get("title", "") + " " + entry.get("summary", "")).lower()
                if any(t in text for t in terms):
                    matched.append(entry)
            print(f"[news]   {source_name}: {total} entries → {len(matched)} matched")
            for entry in matched:
                articles.append({
                    "title":     entry.get("title", ""),
                    "url":       entry.get("link", ""),
                    "source":    source_name,
                    "timestamp": entry.get("published", entry.get("updated", "")),
                    "_summary":  entry.get("summary", "") or "",
                })
        except Exception as e:
            print(f"[news]   {source_name} error: {e}")

    # Deduplicate by URL, sort newest first
    seen, unique = set(), []
    for a in articles:
        if a["url"] and a["url"] not in seen:
            seen.add(a["url"])
            unique.append(a)

    # Supplement: if country-specific feeds returned fewer than 3 articles,
    # also query global fallback feeds so the panel is never empty.
    if tier == "country-specific" and len(unique) < 3:
        print(f"[news] {country}: only {len(unique)} articles from country feeds — supplementing with global fallback")
        for source_name, feed_url in GLOBAL_FALLBACK_FEEDS:
            try:
                feed = feedparser.parse(feed_url)
                matched = [e for e in feed.entries
                           if any(t in (e.get("title","")+" "+e.get("summary","")).lower() for t in terms)]
                print(f"[news]   (supplement) {source_name}: {len(feed.entries)} → {len(matched)} matched")
                for entry in matched:
                    url = entry.get("link", "")
                    if url and url not in seen:
                        seen.add(url)
                        unique.append({
                            "title":     entry.get("title", ""),
                            "url":       url,
                            "source":    source_name,
                            "timestamp": entry.get("published", entry.get("updated", "")),
                            "_summary":  entry.get("summary", "") or "",
                        })
            except Exception as e:
                print(f"[news]   (supplement) {source_name} error: {e}")

    unique.sort(key=lambda a: _parse_ts(a["timestamp"]), reverse=True)
    print(f"[news] {country}: {len(unique)} unique articles — translating...")

    # Translate non-English titles, cap at 15
    result_articles = []
    geo_success = 0
    geo_fail = 0
    successful_candidates = Counter()
    geo_stats_before = get_geocode_stats()
    for a in unique[:15]:
        display_title, lang, note = _translate_title(a["title"])
        enriched, winner, _ = _enrich_article_geo({
            "title":            display_title,
            "url":              a.get("url", ""),
            "source":           a.get("source", ""),
            "timestamp":        a.get("timestamp", ""),
            "language":         lang,
            "translation_note": note,
        }, a.get("title", ""), a.get("_summary", ""), source_name=a.get("source", ""))
        if enriched.get("lat") is not None and enriched.get("lon") is not None:
            geo_success += 1
            if winner:
                successful_candidates[winner] += 1
        else:
            geo_fail += 1
        result_articles.append(enriched)

    geo_stats_after = get_geocode_stats()
    calls_delta = geo_stats_after["http_calls"] - geo_stats_before["http_calls"]
    top_candidates = [c for c, _ in successful_candidates.most_common(5)]
    print(
        f"[news] {country}: parsed={len(result_articles)} "
        f"with_coords={geo_success} without_coords={geo_fail} "
        f"nominatim_calls={calls_delta} top_candidates={top_candidates}"
    )
    print(f"[news] {country}: {len(result_articles)} articles returned")
    result = {"articles": result_articles}
    _news_cache[cache_key] = {"at": time.time(), "data": result}
    return result


# ── /news/breaking + /news/region ─────────────────────────────────────────────

_BREAKING_FEEDS = [
    ("BBC World",  "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
]

# Per-region feeds. Region-specific feeds (AllAfrica regional, BBC regional)
# are already filtered by geography — any article from them counts.
# Broader feeds (DW All, BBC World) are filtered with _REGION_TERMS.
_REGION_FEEDS: dict[str, list[tuple[str, str]]] = {
    "east_africa": [
        ("AllAfrica East Africa", "https://allafrica.com/tools/headlines/rdf/eastafrica/headlines.rdf"),
        ("BBC Africa",            "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "west_africa": [
        ("AllAfrica West Africa", "https://allafrica.com/tools/headlines/rdf/westafrica/headlines.rdf"),
        ("BBC Africa",            "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "north_africa": [
        ("AllAfrica North Africa", "https://allafrica.com/tools/headlines/rdf/northafrica/headlines.rdf"),
        ("BBC Africa",             "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ],
    "middle_east": [
        ("Middle East Eye", "https://www.middleeasteye.net/rss"),
        ("Al Jazeera",      "https://www.aljazeera.com/xml/rss/all.xml"),
    ],
    "europe": [
        ("BBC Europe",     "http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
        ("Deutsche Welle", "https://rss.dw.com/rdf/rss-en-all"),
    ],
    "americas": [
        ("BBC Americas",      "http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml"),
        ("BBC Latin America", "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml"),
        ("NPR World",         "https://feeds.npr.org/1004/rss.xml"),
    ],
    "asia_pacific": [
        ("BBC Asia", "http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
        ("DW Asia",  "https://rss.dw.com/rdf/rss-en-asia"),
    ],
    "russia": [
        ("Deutsche Welle", "https://rss.dw.com/rdf/rss-en-eu"),
        ("BBC World",      "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ],
}

# Keywords used to prefer relevant articles when feeds are broader than the region.
_REGION_TERMS: dict[str, list[str]] = {
    "east_africa":  ["kenya", "ethiopia", "uganda", "tanzania", "rwanda", "burundi", "somalia",
                     "east africa", "horn of africa", "nairobi", "addis", "kampala"],
    "west_africa":  ["nigeria", "ghana", "senegal", "mali", "burkina", "niger", "ivory coast",
                     "west africa", "sahel", "abuja", "accra", "dakar", "liberia", "sierra leone"],
    "north_africa": ["egypt", "libya", "morocco", "algeria", "tunisia", "sudan",
                     "north africa", "cairo", "tripoli", "maghreb"],
    "middle_east":  ["israel", "gaza", "iran", "iraq", "syria", "lebanon", "saudi", "yemen",
                     "jordan", "houthi", "middle east", "gulf", "tehran", "jerusalem", "hezbollah"],
    "europe":       ["europe", "european", "ukraine", "france", "germany", "britain", "nato",
                     "brussels", "poland", "hungary", "czech", "balkan", "finland", "sweden"],
    "americas":     ["united states", "canada", "brazil", "mexico", "trump", "latin america",
                     "colombia", "venezuela", "argentina", "washington", "ottawa", "havana"],
    "asia_pacific": ["china", "india", "japan", "korea", "taiwan", "myanmar", "asia", "pacific",
                     "asean", "beijing", "tokyo", "seoul", "delhi", "indonesia", "philippines"],
    "russia":       ["russia", "russian", "moscow", "kremlin", "putin", "ukraine", "kyiv",
                     "central asia", "kazakhstan", "siberia", "wagner", "volodymyr"],
}

_region_cache: dict = {}
REGION_CACHE_TTL = 15 * 60  # seconds


def _best_article_from_feed(feed_entries, source_name, terms: list[str]) -> list[dict]:
    """Return up to 3 articles from a feed, preferring those matching terms."""
    if not feed_entries:
        return []
    matched = [e for e in feed_entries
               if any(t in (e.get("title", "") + " " + e.get("summary", "")).lower() for t in terms)]
    pool = matched if matched else feed_entries[:3]
    out = []
    for e in pool[:3]:
        summary_raw = e.get("summary", "") or ""
        out.append({
            "title":     e.get("title", ""),
            "url":       e.get("link", ""),
            "source":    source_name,
            "timestamp": e.get("published", e.get("updated", "")),
            "summary":   summary_raw[:300],
        })
    return out


@app.get("/news/breaking")
@_response_cache(expire=30)
def get_news_breaking():
    """Top 2 global headlines — one from BBC World, one from Al Jazeera."""
    cached = _region_cache.get("breaking")
    if cached and time.time() - cached["at"] < REGION_CACHE_TTL:
        print("[breaking] CACHE HIT")
        return cached["data"]

    print("[breaking] CACHE MISS — fetching")
    articles = []
    geo_success = 0
    geo_fail = 0
    successful_candidates = Counter()
    geo_stats_before = get_geocode_stats()
    for source_name, feed_url in _BREAKING_FEEDS:
        try:
            feed = feedparser.parse(feed_url)
            if feed.entries:
                e = feed.entries[0]
                base_article = {
                    "title":     e.get("title", ""),
                    "url":       e.get("link", ""),
                    "source":    source_name,
                    "timestamp": e.get("published", e.get("updated", "")),
                    "summary":   (e.get("summary", "") or "")[:300],
                }
                enriched, winner, _ = _enrich_article_geo(
                    base_article,
                    base_article["title"],
                    base_article["summary"],
                    source_name=source_name,
                    feed_url=feed_url,
                )
                if enriched.get("lat") is not None and enriched.get("lon") is not None:
                    geo_success += 1
                    if winner:
                        successful_candidates[winner] += 1
                else:
                    geo_fail += 1
                articles.append(enriched)
                print(f"[breaking]   {source_name}: '{e.get('title','')[:60]}'")
        except Exception as ex:
            print(f"[breaking]   {source_name} error: {ex}")

    geo_stats_after = get_geocode_stats()
    calls_delta = geo_stats_after["http_calls"] - geo_stats_before["http_calls"]
    top_candidates = [c for c, _ in successful_candidates.most_common(5)]
    print(
        f"[breaking] parsed={len(articles[:2])} with_coords={geo_success} "
        f"without_coords={geo_fail} nominatim_calls={calls_delta} top_candidates={top_candidates}"
    )
    result = {"articles": articles[:2]}
    _region_cache["breaking"] = {"at": time.time(), "data": result}
    return result


@app.get("/news/region")
@_response_cache(expire=30)
def get_news_region():
    """One top headline per global region. All 8 regions returned in a single call."""
    cached = _region_cache.get("all_regions")
    if cached and time.time() - cached["at"] < REGION_CACHE_TTL:
        print("[region] CACHE HIT")
        return cached["data"]

    print("[region] CACHE MISS — fetching all regions")
    result: dict = {}
    geo_success = 0
    geo_fail = 0
    successful_candidates = Counter()
    geo_stats_before = get_geocode_stats()

    for region, feeds in _REGION_FEEDS.items():
        terms = _REGION_TERMS.get(region, [])
        candidates: list[dict] = []

        for source_name, feed_url in feeds:
            try:
                feed = feedparser.parse(feed_url)
                articles = _best_article_from_feed(feed.entries, source_name, terms)
                print(f"[region]   {region}/{source_name}: {len(feed.entries)} entries → {len(articles)} candidates")
                candidates.extend(articles)
            except Exception as ex:
                print(f"[region]   {region}/{source_name} error: {ex}")

        if candidates:
            candidates.sort(key=lambda a: _parse_ts(a["timestamp"]), reverse=True)
            enriched, winner, _ = _enrich_article_geo(
                candidates[0],
                candidates[0].get("title", ""),
                candidates[0].get("summary", ""),
                source_name=candidates[0].get("source", ""),
            )
            if enriched.get("lat") is not None and enriched.get("lon") is not None:
                geo_success += 1
                if winner:
                    successful_candidates[winner] += 1
            else:
                geo_fail += 1
            result[region] = enriched
        else:
            result[region] = None

    geo_stats_after = get_geocode_stats()
    calls_delta = geo_stats_after["http_calls"] - geo_stats_before["http_calls"]
    top_candidates = [c for c, _ in successful_candidates.most_common(5)]
    print(
        f"[region] parsed={sum(1 for v in result.values() if v)} with_coords={geo_success} "
        f"without_coords={geo_fail} nominatim_calls={calls_delta} top_candidates={top_candidates}"
    )
    print(f"[region] done — {sum(1 for v in result.values() if v)} of {len(result)} regions have articles")
    _region_cache["all_regions"] = {"at": time.time(), "data": result}
    return result


# ── /adsb ──────────────────────────────────────────────────────────────────────

_adsb_cache: dict = {}

@app.get("/adsb")
@_response_cache(expire=15)
def get_adsb(
    lat:  float = Query(...),
    lon:  float = Query(...),
    dist: int   = Query(250),
):
    """Live ADS-B aircraft from adsb.lol within dist nautical miles of lat/lon. Cached 15 s."""
    key = f"{round(lat, 2)},{round(lon, 2)},{dist}"
    cached = _adsb_cache.get(key)
    if cached and (time.time() - cached["ts"]) < 15:
        return {"aircraft": cached["data"]}

    url = f"https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{dist}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Akili/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = _json.loads(resp.read())
    except Exception as e:
        print(f"[adsb] fetch error: {e}")
        return {"aircraft": []}

    sample = raw.get("ac", [{}])[0] if raw.get("ac") else {}
    print(f"[adsb] raw keys={list(raw.keys())} total={raw.get('total','?')} sample_fields={list(sample.keys())[:12]}")

    aircraft = []
    for ac in raw.get("ac", []):
        lat_ac = ac.get("lat")
        lon_ac = ac.get("lon")
        if lat_ac is None or lon_ac is None:
            continue
        db_flags = int(ac.get("dbFlags") or 0)
        aircraft.append({
            "icao":        (ac.get("hex") or "").upper(),
            "flight":      (ac.get("flight") or "").strip(),
            "lat":         lat_ac,
            "lon":         lon_ac,
            "alt_baro":    ac.get("alt_baro"),
            "gs":          ac.get("gs"),
            "track":       ac.get("track"),
            "category":    ac.get("category") or "",
            "military":    bool(db_flags & 1),
            "interesting": bool(db_flags & 2),
            "type":        ac.get("t") or "",
        })

    print(f"[adsb] lat={lat:.2f} lon={lon:.2f} dist={dist}nm → {len(aircraft)} aircraft")
    _adsb_cache[key] = {"ts": time.time(), "data": aircraft}
    return {"aircraft": aircraft}


# ── Aviation enrichment: route + photo ────────────────────────────────────────

from services.flight_route_service   import get_route  as _get_route
from services.aircraft_photo_service import get_photo  as _get_photo
from services.vessel_photo_service   import get_photo  as _get_vessel_photo

@app.get("/api/aviation/test")
async def aviation_test():
    """Smoke-test endpoint — confirms aviation routes are registered."""
    return {"status": "aviation routes working", "endpoints": [
        "/api/aviation/test",
        "/api/aviation/route/{icao24}",
        "/api/aviation/photo/{icao24}",
    ]}


@app.get("/api/aviation/route/{icao24}")
async def aviation_route(icao24: str, callsign: Optional[str] = Query(default=None)):
    """Return departure/destination airports for an ICAO24 hex code.

    Primary source: OpenSky Network (/flights/aircraft, last 24 h).
    Fallback: AeroDataBox (RapidAPI) → AviationStack by callsign.
    Results cached 30 min — safe to call on every aircraft click.
    """
    print(f"[route-endpoint] called: icao24={icao24!r} callsign={callsign!r}")
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(_executor, _get_route, icao24, callsign)
    print(f"[route-endpoint] result for {icao24}: {data}")
    return data


@app.get("/api/aviation/photo/{icao24}")
async def aviation_photo(icao24: str):
    """Return a real aircraft photo from Planespotters.net for an ICAO24 hex.

    Returns { photo_url, thumbnail_url, photographer } or nulls if not found.
    Results are cached 6 h on the backend.
    """
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(_executor, _get_photo, icao24)
    return data


@app.get("/api/vessel/photo/{mmsi}")
async def vessel_photo(mmsi: str):
    """Return vessel photo availability and URLs from MarineTraffic CDN.

    Probes the CDN with a HEAD request and checks content-type.
    Results cached 6 h on the backend.
    Returns { available, thumbnail_url, full_url }.
    """
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(_executor, _get_vessel_photo, mmsi)
    return data


# ── Real-time alert helpers ───────────────────────────────────────────────────

def _parse_iso_ts(s: str) -> float:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _nearest_infra(lat: float, lon: float, radius_km: float) -> list[dict]:
    """Return _POIS within radius_km, sorted by distance ascending."""
    results = []
    for poi in _POIS:
        d = math.sqrt(  # fast Euclidean approximation for filtering
            ((lat - poi["lat"]) * 111.0) ** 2 +
            ((lon - poi["lon"]) * 111.0 * math.cos(math.radians(lat))) ** 2
        )
        if d <= radius_km * 1.3:   # rough pre-filter
            from scoring import _haversine_km as _hk
            exact = _hk(lat, lon, poi["lat"], poi["lon"])
            if exact <= radius_km:
                results.append({"name": poi["name"], "type": poi["type"], "distance_km": round(exact, 1)})
    results.sort(key=lambda x: x["distance_km"])
    return results


def _push_real_time_alert(alert: dict) -> None:
    """Append alert to queue and inject into surface pool immediately."""
    now_iso = datetime.now(timezone.utc).isoformat()
    alert.setdefault("pushed_at", now_iso)
    with _ALERTS_QUEUE_LOCK:
        _ALERTS_QUEUE.append(alert)
        if len(_ALERTS_QUEUE) > _ALERTS_QUEUE_MAX:
            del _ALERTS_QUEUE[: len(_ALERTS_QUEUE) - _ALERTS_QUEUE_MAX]

    # Classification + significance gate
    classification = classify_event(
        alert.get("headline", "") or alert.get("title", ""),
        alert.get("description", "") or alert.get("summary", ""),
        alert.get("source", ""),
    )
    if alert.get("source_type") is None and alert.get("type"):
        alert["source_type"] = alert.get("type")
    alert["type"]   = classification.get("type")
    alert["icon"]   = classification.get("icon")
    alert["color"]  = classification.get("color")
    alert["confidence"] = classification.get("confidence")
    alert["infrastructure_types_to_preload"] = classification.get("infrastructure_types_to_preload", [])

    recent_counts = _recent_location_counts(_SURFACE_POOL + [alert], hours=6)
    loc_key = _location_key(alert)
    recent_count = recent_counts.get(loc_key, 0) if loc_key else 0
    significance = _score_significance(alert, classification, _ACTIVE_PROFILE, recent_count)
    alert["significance_score"] = significance
    if significance >= 80:
        alert["auto_enrichment_gate"] = "AUTO_ENRICH"
    elif significance >= 55:
        alert["auto_enrichment_gate"] = "SURFACE"
    else:
        alert["auto_enrichment_gate"] = "DISCARD"

    if alert["auto_enrichment_gate"] == "DISCARD":
        return

    # Also inject into surface pool immediately so it appears without waiting for cycle
    with _SURFACE_POOL_LOCK:
        existing_ids = {i.get("id") for i in _SURFACE_POOL}
        if alert.get("id") not in existing_ids:
            _SURFACE_POOL.append(alert)

    # Background prefetch + auto-enrich
    if alert.get("lat") is not None and alert.get("lon") is not None:
        threading.Thread(target=_prefetch_event_infra, args=(alert,), daemon=True).start()
    if alert.get("auto_enrichment_gate") == "AUTO_ENRICH":
        threading.Thread(target=_maybe_auto_enrich_batch, args=([alert],), daemon=True).start()

    # Browser push notification for critical / significant alerts
    tier = alert.get("severity_tier", "")
    if tier in ("critical", "significant") and _WEBPUSH_OK and _PUSH_SUBS:
        headline = (alert.get("headline") or alert.get("title") or "New alert")[:120]
        location = alert.get("location") or ""
        body     = f"{location} — {headline}" if location else headline
        title    = "CRITICAL ALERT" if tier == "critical" else "Horizon Watch"
        push_data = {
            "severity": tier,
            "id":       alert.get("id"),
            "url":      "/",
        }
        threading.Thread(
            target=_broadcast_push,
            args=(title, body, push_data),
            daemon=True,
        ).start()


# ── Route intelligence helpers ────────────────────────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points in kilometres."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi       = math.radians(lat2 - lat1)
    dlambda    = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _sample_coords(geojson_coords: list, every: int = 5) -> list:
    """Return every Nth [lon, lat] coordinate pair as (lat, lon) tuples."""
    sampled = geojson_coords[::every] if len(geojson_coords) > every else geojson_coords
    # Always include the last point
    if geojson_coords and geojson_coords[-1] not in sampled:
        sampled = sampled + [geojson_coords[-1]]
    return [(c[1], c[0]) for c in sampled]   # (lat, lon)


def _min_dist_to_route(pt_lat: float, pt_lon: float, route_pts: list) -> float:
    """Minimum haversine distance (km) from a point to any sampled route coordinate."""
    return min(_haversine_km(pt_lat, pt_lon, rlat, rlon) for rlat, rlon in route_pts)



_SAFETY_TYPE_WEIGHT = {
    "Battles":                      10,
    "Explosions/Remote violence":    8,
    "Violence against civilians":    7,
    "Riots":                         5,
    "Protests":                      3,
    "Strategic developments":        2,
    "Fight":                        10,
    "Assault":                       8,
    "Unconventional Mass Violence":  9,
    "Exhibit Force Posture":         5,
    "Coerce":                        4,
    "Threaten":                      4,
    "Protest":                       3,
}


# ── /route ───────────────────────────────────────────────────────────────────

@app.post("/route")
def get_route(body: dict = Body(...)):
    """Fetch a route from OSRM for an ordered list of [lat, lon] waypoints."""
    points = body.get("points", [])   # [[lat, lon], ...]
    mode   = body.get("mode", "driving")

    if len(points) < 2:
        return {"error": "At least 2 points required"}

    valid_modes = {"driving", "walking", "cycling"}
    if mode not in valid_modes:
        mode = "driving"

    # OSRM expects lon,lat pairs separated by semicolons
    coord_str = ";".join(f"{lon},{lat}" for lat, lon in points)
    url = (
        f"http://router.project-osrm.org/route/v1/{mode}/{coord_str}"
        f"?overview=full&geometries=geojson&steps=true"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Akili/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = _json.loads(resp.read())
    except Exception as e:
        print(f"[route] OSRM fetch error: {e}")
        return {"error": str(e)}

    if not raw.get("routes"):
        return {"error": "No route found"}

    route    = raw["routes"][0]
    geometry = route["geometry"]
    coords   = geometry["coordinates"]   # [[lon, lat], ...]

    steps = []
    for leg in route.get("legs", []):
        for step in leg.get("steps", []):
            maneuver = step.get("maneuver", {})
            steps.append({
                "type":        maneuver.get("type", ""),
                "modifier":    maneuver.get("modifier", ""),
                "instruction": step.get("name", ""),
                "distance_m":  round(step.get("distance", 0)),
            })

    result = {
        "geometry":     geometry,
        "coordinates":  coords,
        "distance_km":  round(route["distance"] / 1000, 2),
        "duration_min": round(route["duration"] / 60, 1),
        "steps":        steps,
    }
    print(f"[route] {mode} {len(points)} pts → {result['distance_km']}km {result['duration_min']}min")
    return result


# ── /route/analyse ────────────────────────────────────────────────────────────

_route_analyse_cache: dict = {}
ROUTE_ANALYSE_CACHE_TTL = 1800  # 30 minutes

@app.post("/route/analyse")
def analyse_route(body: dict = Body(...)):
    """
    Cross-reference a route against conflict events, infrastructure POIs,
    and produce a Claude-generated intelligence brief.
    Correlation principle: route data touches conflict, infrastructure, and traffic layers.
    """
    coords        = body.get("coordinates", [])
    distance_km   = body.get("distance_km", 0)
    duration_min  = body.get("duration_min", 0)
    origin_lat    = body.get("origin_lat", 0)
    origin_lon    = body.get("origin_lon", 0)
    dest_lat      = body.get("dest_lat", 0)
    dest_lon      = body.get("dest_lon", 0)
    nearby_news   = [
        n for n in body.get("nearby_news", [])
        if n.get("confidence") in ("high", "medium")
    ][:5]
    contextual    = bool(body.get("contextual", False))
    mission_brief = body.get("mission_brief", "")
    profile       = body.get("profile", None)

    if not coords:
        return {"error": "No route coordinates provided"}

    # ── 0. Cache check ────────────────────────────────────────────────────
    base_key  = f"{round(origin_lat,3)},{round(origin_lon,3)}→{round(dest_lat,3)},{round(dest_lon,3)}"
    cache_key = f"{base_key}_ctx" if contextual else base_key
    if mission_brief:
        import hashlib
        cache_key = f"{cache_key}_m{hashlib.md5(mission_brief.encode()).hexdigest()[:8]}"
    cache_key += _profile_cache_suffix(profile)
    cached = _route_analyse_cache.get(cache_key)
    if cached and (time.time() - cached["ts"]) < ROUTE_ANALYSE_CACHE_TTL:
        print(f"[route/analyse] cache hit for {cache_key}")
        return {**cached["data"], "cached": True}

    route_pts = _sample_coords(coords, every=5)   # (lat, lon) tuples

    # ── 1. Conflict events within 15km in last 90 days ────────────────────
    recent_events = es.get_active_events(max_age_hours=2160, limit=1000)
    conflict_events = []
    for ev in recent_events:
        try:
            ev_lat = float(ev.get("lat"))
            ev_lon = float(ev.get("lon"))
        except (ValueError, TypeError):
            continue
        dist = _min_dist_to_route(ev_lat, ev_lon, route_pts)
        if dist <= 15.0:
            event_date = str(ev.get("published") or "")[:10]
            conflict_events.append({
                "type":       ev.get("event_type") or ev.get("severity_tier") or "Conflict",
                "subtype":    ev.get("source") or "",
                "actor":      ev.get("source_name") or "Unknown",
                "location":   ev.get("location") or ev.get("country_code") or "",
                "date":       event_date,
                "fatalities": 0,
                "lat":        ev_lat,
                "lon":        ev_lon,
                "dist_km":    round(dist, 1),
            })

    # Sort by recency then fatalities, cap at 10
    conflict_events.sort(key=lambda e: (e["date"], e["fatalities"]), reverse=True)
    conflict_events = conflict_events[:10]
    print(f"[route/analyse] {len(conflict_events)} conflict events within 15km")

    # ── 2. Infrastructure within 10km ─────────────────────────────────────
    infrastructure = []
    for poi in _POIS:
        dist = _min_dist_to_route(poi["lat"], poi["lon"], route_pts)
        if dist <= 10.0:
            infrastructure.append({**poi, "dist_km": round(dist, 1)})

    infrastructure.sort(key=lambda p: p["dist_km"])
    print(f"[route/analyse] {len(infrastructure)} infrastructure items within 10km")

    # ── 3. Safety score (0–100) ───────────────────────────────────────────
    score = 100.0
    today = datetime.now(timezone.utc).date()
    for ev in conflict_events:
        type_w = _SAFETY_TYPE_WEIGHT.get(ev["type"], 3)
        try:
            days_ago = (today - datetime.strptime(ev["date"], "%Y-%m-%d").date()).days
        except ValueError:
            days_ago = 45
        recency  = 1.5 if days_ago < 30 else 1.0 if days_ago < 60 else 0.5
        dist_f   = 2.0 if ev["dist_km"] < 5 else 1.5 if ev["dist_km"] < 10 else 1.0
        deduction = type_w * recency * dist_f + ev["fatalities"] * 0.3
        score -= deduction
    safety_score = max(0, min(100, round(score)))
    print(f"[route/analyse] safety score = {safety_score}")

    # ── 4. Claude intelligence brief ──────────────────────────────────────
    conflict_summary = "\n".join(
        f"  - [{ev['date']}] {ev['type']} by {ev['actor']} at {ev['location']}"
        for ev in conflict_events
    ) or "  None within 15km in last 90 days."

    infra_summary = "\n".join(
        f"  - {p['name']} ({p['type']}, {p['dist_km']}km from route)"
        for p in infrastructure
    ) or "  None within 10km."

    score_label = "HIGH RISK" if safety_score < 50 else "MODERATE RISK" if safety_score < 80 else "LOW RISK"

    news_section = ""
    if nearby_news:
        lines = "\n".join(
            f"  - [UNVERIFIED - NEWS SOURCE] [{n.get('confidence','?').upper()}] "
            f"{n.get('headline','')} ({n.get('source','')}, {n.get('published','')[:10]}) "
            f"— {n.get('location_name', n.get('location',''))}"
            for n in nearby_news
        )
        news_section = f"\nRECENT NEWS EVENTS NEAR THIS ROUTE (last 24h, unverified):\n{lines}\nCross-reference these news reports with the conflict data above. If corroborated, elevate threat assessment accordingly. If contradicted, note the discrepancy.\n"

    _profile_ctx = _format_profile_context(profile)
    _mission_context = ""
    if mission_brief:
        _mission_context = (
            f"ANALYST MISSION CONTEXT:\n"
            f"The analyst is currently working on the following mission objective:\n"
            f"{mission_brief}\n"
            f"Frame all analysis in the context of this mission. Prioritise information "
            f"relevant to this objective. If this route is irrelevant to the mission, "
            f"say so directly in one sentence rather than producing a full brief.\n\n"
        )
    context_block = _profile_ctx + _mission_context + (get_context_for_prompt(sections=["security", "foreign_policy", "current_context_2025", "analytical_framework"]) + "\n\n" if contextual else "")

    _route_data = (
        f"Distance: {distance_km}km | Estimated travel time: {duration_min} minutes\n"
        f"Origin: {origin_lat:.4f}°N, {origin_lon:.4f}°E\n"
        f"Destination: {dest_lat:.4f}°N, {dest_lon:.4f}°E\n"
        f"Safety Score: {safety_score}/100 ({score_label})\n\n"
        f"CONFLICT EVENTS WITHIN 15KM (last 90 days):\n{conflict_summary}\n\n"
        f"INFRASTRUCTURE WITHIN 10KM:\n{infra_summary}"
        f"{news_section}"
    )

    if contextual:
        prompt = f"""{context_block}You are Akili, a senior intelligence analyst.
Your job is not to list what is along this route — it is to tell the analyst whether to use it, how, and what to watch for. Be direct. If the route is dangerous, say so. If it is safe, say so.

ROUTE:
{_route_data}

Write a structured brief with exactly these five sections.

## WHAT THIS ROUTE IS
One paragraph. Describe the corridor in plain terms — what kind of road, what terrain, what it connects, and who typically uses it. Note any known chokepoints or border crossings.

## WHY THIS MATTERS
Be specific about the strategic interest in this corridor — trade flows, military access, regional connectivity, or economic exposure. If the route has no special strategic significance, say so.

## WHAT THIS COULD MEAN IN 30, 90, AND 180 DAYS
Three bullet points — one per time horizon. Security trajectory given current conflict data. What events would make this route safer or more dangerous.

## ROUTE ASSESSMENT AND RECOMMENDATIONS
State the verdict directly: is this route advisable right now, with precautions, or not at all. Then give specific actionable guidance: recommended travel windows, checkpoints to expect, what to avoid, what resources exist en route (medical, security, communications). If an alternative route is meaningfully safer, describe it specifically — not just "consider alternatives." If the route is clear, confirm that and state what would change the assessment.

## CONFIDENCE AND SOURCE QUALITY
One sentence on data reliability. Note the age of conflict data and what ground truth would change this assessment.

Regional Relevance: [X]/10 — [one sentence on concrete interest in this specific corridor]"""
    else:
        prompt = f"""You are an intelligence analyst producing a route security brief.

{_route_data}

Produce a structured route intelligence brief with EXACTLY these five ## sections and no other text:

## Route Summary
Travel time, distance, key corridor characteristics and current conditions.

## Threat Assessment
Specific dangers with km markers or location names. Rate overall threat HIGH/MODERATE/LOW.

## Infrastructure Exposure
Critical sites near the route and their operational/security implications.

## Recommended Precautions
Specific actionable steps for this route and current threat environment.

## Alternative Routing Recommendation
{'Provide a specific alternative route recommendation — safety score is below 60 or significant threats detected.' if safety_score < 60 else 'Confirm primary route is acceptable or note minor optimisations.'}

Keep the entire response under 500 tokens. Be specific, not generic."""

    brief = None
    brief_error = None
    if client:
        try:
            msg = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=650 if contextual else 500,
                messages=[{"role": "user", "content": prompt}],
            )
            usage_tracker.record_call(msg.usage.input_tokens, msg.usage.output_tokens)
            brief = msg.content[0].text.strip()
        except Exception as e:
            brief_error = str(e)
            print(f"[route/analyse] Claude error: {e}")
    else:
        brief_error = "ANTHROPIC_API_KEY not configured"

    result = {
        "conflict_events": conflict_events,
        "infrastructure":  infrastructure,
        "safety_score":    safety_score,
        "brief":           brief,
        "brief_error":     brief_error,
        "cached":          False,
    }
    _route_analyse_cache[cache_key] = {"ts": time.time(), "data": result}
    return result




# ── Overpass fetch helper ──────────────────────────────────────────────────────

_OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


def _fetch_overpass(query: str, retries: int = 3) -> dict:
    """Fetch from Overpass API with retry (429/504) and URL rotation for redundancy."""
    data_bytes = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(retries):
        url = _OVERPASS_URLS[attempt % len(_OVERPASS_URLS)]
        try:
            req = urllib.request.Request(
                url, data=data_bytes,
                headers={"User-Agent": "Akili/1.0", "Content-Type": "application/x-www-form-urlencoded"},
            )
            with urllib.request.urlopen(req, timeout=40) as resp:
                return _json.loads(resp.read())
        except urllib.error.HTTPError as ex:
            if ex.code in (429, 504) and attempt < retries - 1:
                wait = 5 * (attempt + 1)
                print(f"[overpass] HTTP {ex.code} attempt {attempt+1} ({url}), retrying in {wait}s")
                time.sleep(wait)
            else:
                print(f"[overpass] HTTP {ex.code} — giving up after {attempt+1} attempt(s)")
                return {"elements": []}
        except Exception as ex:
            print(f"[overpass] error attempt {attempt+1} ({url}): {ex}")
            if attempt < retries - 1:
                time.sleep(3)
            else:
                return {"elements": []}
    return {"elements": []}



# ── /infrastructure/all — batch multi-category query ──────────────────────────

# Static infra types (hospitals, police, military) cache for 7 days; dynamic 6h
_INFRA_STATIC_CATS = {"medical", "security", "military", "government"}
INFRA_CACHE_TTL_STATIC  = 7 * 86400
INFRA_CACHE_TTL_DYNAMIC = 6 * 3600



# ── News conflict extraction (spaCy NER + keyword fallback) ───────────────────

# Known East/Southern African cities and regions for keyword fallback.
# Used when spaCy en_core_web_sm is not installed.
_EA_LOCATIONS = [
    # Tanzania
    "Dar es Salaam", "Dodoma", "Mwanza", "Arusha", "Zanzibar", "Mbeya", "Morogoro",
    "Tanga", "Kagera", "Kigoma", "Tabora", "Lindi", "Mtwara", "Iringa", "Songea",
    "Shinyanga", "Geita", "Simiyu", "Rukwa", "Katavi", "Njombe", "Kilimanjaro",
    # Kenya
    "Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Garissa", "Mandera",
    "Wajir", "Lamu", "Turkana", "Kitale", "Thika", "Malindi",
    # Uganda
    "Kampala", "Gulu", "Lira", "Jinja", "Mbale", "Arua", "Kasese", "Mbarara",
    # Rwanda
    "Kigali", "Butare", "Gisenyi", "Musanze",
    # Burundi
    "Bujumbura", "Gitega", "Ngozi",
    # DRC (eastern)
    "Goma", "Bukavu", "Butembo", "Beni", "Ituri", "Uvira", "Rutshuru",
    # South Sudan
    "Juba", "Malakal", "Wau", "Bentiu",
    # Somalia
    "Mogadishu", "Kismayo", "Hargeisa", "Puntland",
    # Ethiopia
    "Addis Ababa", "Tigray", "Amhara", "Afar", "Dire Dawa",
    # Mozambique
    "Maputo", "Beira", "Nampula", "Cabo Delgado", "Nacala",
    # General regional terms
    "East Africa", "Great Lakes", "Horn of Africa",
]
_EA_LOCATIONS_LOWER = [loc.lower() for loc in _EA_LOCATIONS]

# Country-level names checked as a last resort when no city/region is matched.
_ALWAYS_INCLUDE_LOCATIONS = {
    "Tanzania", "Kenya", "Uganda", "Rwanda", "Burundi",
    "DRC", "Congo", "Mozambique", "Somalia", "Ethiopia", "South Sudan",
}
_ALWAYS_INCLUDE_LOWER = {loc.lower() for loc in _ALWAYS_INCLUDE_LOCATIONS}


def _extract_locations_fallback(text: str) -> list[str]:
    """Keyword-based location extraction. Used when spaCy is not available."""
    text_lower = text.lower()
    return [loc for loc, loc_l in zip(_EA_LOCATIONS, _EA_LOCATIONS_LOWER) if loc_l in text_lower]


def _extract_locations_spacy(text: str) -> list:
    """Return unique GPE/LOC entity strings from text. spaCy NER → keyword fallback → country names."""
    if _HAS_SPACY and _nlp is not None:
        locs = list({ent.text for ent in _nlp(text).ents if ent.label_ in ("GPE", "LOC")})
    else:
        locs = _extract_locations_fallback(text)
    if not locs:
        text_lower = text.lower()
        locs = [loc for loc in _ALWAYS_INCLUDE_LOCATIONS if loc.lower() in text_lower]
    return locs


# ── Gazetteer: ~300 globally significant cities + conflict-relevant locations ──
_GAZETTEER = [
    # Middle East
    "Gaza", "Tel Aviv", "Jerusalem", "Beirut", "Damascus", "Aleppo", "Mosul",
    "Baghdad", "Basra", "Erbil", "Tehran", "Isfahan", "Mashhad", "Shiraz",
    "Sanaa", "Aden", "Hodeidah", "Riyadh", "Jeddah", "Mecca", "Medina",
    "Dubai", "Abu Dhabi", "Doha", "Kuwait City", "Manama", "Muscat",
    "Kabul", "Kandahar", "Herat", "Mazar-i-Sharif",
    # Africa
    "Cairo", "Alexandria", "Khartoum", "Omdurman", "Darfur", "Juba",
    "Nairobi", "Mombasa", "Kampala", "Kigali", "Bujumbura", "Dar es Salaam",
    "Dodoma", "Arusha", "Zanzibar", "Mogadishu", "Hargeisa", "Addis Ababa",
    "Asmara", "Djibouti", "Goma", "Bukavu", "Kinshasa", "Lubumbashi",
    "Bangui", "Ndjamena", "Niamey", "Ouagadougou", "Bamako", "Dakar",
    "Abidjan", "Accra", "Lagos", "Abuja", "Kano", "Maiduguri", "Kaduna",
    "Yaounde", "Douala", "Libreville", "Brazzaville", "Luanda", "Maputo",
    "Harare", "Lusaka", "Lilongwe", "Antananarivo", "Johannesburg", "Cape Town",
    "Durban", "Pretoria", "Tripoli", "Benghazi", "Misrata", "Tunis", "Algiers",
    "Rabat", "Casablanca", "Marrakech",
    # Europe / Ukraine
    "Kyiv", "Kharkiv", "Mariupol", "Kherson", "Zaporizhzhia", "Odessa",
    "Donetsk", "Luhansk", "Bakhmut", "Avdiivka", "Moscow", "Saint Petersburg",
    "Minsk", "Belgrade", "Pristina", "Sarajevo", "Tirana", "Tbilisi",
    "Yerevan", "Baku", "Stepanakert",
    # Asia
    "Islamabad", "Karachi", "Lahore", "Peshawar", "Quetta", "Mumbai",
    "Delhi", "New Delhi", "Chennai", "Kolkata", "Dhaka", "Chittagong",
    "Yangon", "Mandalay", "Naypyidaw", "Bangkok", "Phnom Penh", "Vientiane",
    "Hanoi", "Ho Chi Minh City", "Manila", "Mindanao", "Jakarta", "Banda Aceh",
    "Beijing", "Shanghai", "Xinjiang", "Urumqi", "Lhasa", "Hong Kong",
    "Taipei", "Seoul", "Pyongyang", "Tokyo",
    # Americas
    "Port-au-Prince", "Tegucigalpa", "Managua", "San Salvador", "Guatemala City",
    "Bogota", "Medellin", "Cali", "Caracas", "Maracaibo", "Quito", "Lima",
    "La Paz", "Cochabamba", "Asuncion", "Buenos Aires", "Santiago",
    # Countries as fallback
    "Afghanistan", "Pakistan", "Iran", "Iraq", "Syria", "Lebanon", "Yemen",
    "Libya", "Sudan", "Somalia", "Ethiopia", "Mali", "Niger", "Burkina Faso",
    "Myanmar", "Ukraine", "Russia", "Venezuela", "Haiti", "Colombia",
    "Democratic Republic of Congo", "Central African Republic", "Chad",
    "South Sudan", "Eritrea", "North Korea", "Palestine", "Israel",
    "Saudi Arabia", "United Arab Emirates", "Qatar", "Bahrain", "Kuwait",
    "Georgia", "Armenia", "Azerbaijan", "Serbia", "Kosovo", "Bosnia",
    "Tanzania", "Kenya", "Uganda", "Rwanda", "Mozambique", "Zimbabwe",
    "Nigeria", "Ghana", "Cameroon", "Senegal", "Tunisia", "Algeria", "Morocco",
    "Egypt", "Jordan", "Turkey", "India", "Bangladesh", "Sri Lanka",
    "Indonesia", "Philippines", "Thailand", "Vietnam",
]
_GAZETTEER_LOWER = [p.lower() for p in _GAZETTEER]


def extract_locations_gazetteer(text: str) -> list[str]:
    """
    Fast string-match against global gazetteer, then layer spaCy NER on top.
    Gazetteer runs even without spaCy, giving reliable results for known cities.
    """
    found: list[str] = []
    seen: set[str] = set()
    text_lower = text.lower()
    for place, place_lower in zip(_GAZETTEER, _GAZETTEER_LOWER):
        if place_lower in text_lower and place not in seen:
            found.append(place)
            seen.add(place)
    # Layer spaCy on top to catch locations the gazetteer misses
    if _HAS_SPACY and _nlp is not None:
        for ent in _nlp(text).ents:
            if ent.label_ in ("GPE", "LOC") and ent.text not in seen:
                found.append(ent.text)
                seen.add(ent.text)
    return found[:3]


# ── Nominatim cache — each unique place is geocoded only once per process ──────
_nominatim_cache: dict = {}


def _geocode(location_name: str) -> dict | None:
    """Geocode a place name via Nominatim. Results cached for process lifetime."""
    if location_name in _nominatim_cache:
        return _nominatim_cache[location_name]
    time.sleep(1.1)   # Nominatim policy: ≥1s between uncached requests
    nom_url = (
        f"https://nominatim.openstreetmap.org/search"
        f"?q={urllib.parse.quote(location_name)}&format=json&limit=1&addressdetails=1"
    )
    try:
        req = urllib.request.Request(nom_url, headers=_NOM_HEADERS)
        with urllib.request.urlopen(req, timeout=8) as resp:
            results = _json.loads(resp.read())
        result = results[0] if results else None
    except Exception as ex:
        print(f"[geocode] error for '{location_name}': {ex}")
        result = None
    _nominatim_cache[location_name] = result
    return result


def _score_confidence(source_name: str, nominatim_result: dict) -> str:
    """Return 'high', 'medium', or 'low' based on source tier + location specificity.
    High = specific place (town/village/suburb, span<0.1°) from local/regional source.
    Medium = district/country-level OR specific place from a global source.
    Low = everything else.
    No geographic proximity downgrade — system is now global.
    """
    source_tier = 2 if source_name in HIGH_CONFIDENCE_SOURCES else \
                  1 if source_name in MEDIUM_CONFIDENCE_SOURCES else 0
    addr_type = nominatim_result.get("type", "")
    addr_class = nominatim_result.get("class", "")
    # Specific place types (town, village, suburb, hamlet, neighbourhood)
    specific_types = {"town", "village", "suburb", "hamlet", "neighbourhood", "quarter",
                      "city_district", "isolated_dwelling"}
    is_specific = addr_type in specific_types or addr_class in {"amenity", "building", "highway"}
    bbox = nominatim_result.get("boundingbox", [])
    if len(bbox) == 4:
        span = max(abs(float(bbox[1]) - float(bbox[0])), abs(float(bbox[3]) - float(bbox[2])))
        is_specific = is_specific or span < 0.1
        loc_tier = 2 if is_specific else 1 if span < 0.5 else 0
    else:
        loc_tier = 1 if is_specific else 0
    total = source_tier + loc_tier
    return "high" if total >= 3 else "medium" if total >= 1 else "low"


_NOM_HEADERS = {"User-Agent": "Akili/1.0 (geopolitical intelligence platform; open-source)"}

# ── Gate 0: headline security relevance filter ────────────────────────────────
# Any headline for an intelligence platform must contain at least one of these.
# Articles whose headlines contain NONE of these keywords are irrelevant to
# geopolitical/security monitoring (sports, entertainment, lifestyle, etc.)
# and are rejected before geocoding to avoid wasting Nominatim quota.
_GATE0_SECURITY_KEYWORDS: frozenset[str] = frozenset({
    # Violence / conflict
    "attack", "conflict", "war", "battle", "fighting", "gunfire", "shooting",
    "airstrike", "air strike", "bomb", "blast", "explosion", "missile", "rocket",
    "strike", "killed", "kill", "dead", "death", "casualties", "fatalities",
    "wounded", "injured", "troops", "military", "forces", "rebel", "insurgent",
    "jihadist", "terrorist", "terrorism", "siege", "offensive", "shelling",
    "ceasefire", "coup", "hostage", "captured", "detained", "arrested", "executed",
    # Maritime / transport
    "ship", "vessel", "tanker", "naval", "piracy", "hijack", "port", "harbour",
    "harbor", "fleet", "submarine", "coast guard", "coastguard", "maritime",
    "aircraft", "airport", "runway", "airspace", "airline", "drone", "uav",
    # Infrastructure / energy
    "pipeline", "power plant", "electricity", "grid", "blackout", "outage",
    "internet", "network", "cable", "refinery", "oil", "gas", "fuel", "nuclear",
    # Political / civil
    "protest", "demonstration", "riot", "election", "sanctions", "embargo",
    "government", "president", "minister", "parliament", "coup", "referendum",
    "crisis", "emergency", "displaced", "refugee", "evacuate", "blockade",
    # Security signals
    "intelligence", "espionage", "spy", "surveillance", "cybersecurity",
    "hacker", "breach", "leak", "arrest", "warrant", "extradition",
})


def _gate0_passes(title: str, summary: str = "") -> bool:
    """
    Gate 0: headline-level relevance pre-filter.
    Rejects articles whose headline contains zero security keywords.
    The summary is also checked so genuinely relevant articles with bland
    headlines (e.g., UN agency reports) still pass.
    """
    text = (f"{title} {summary[:200]}").lower()
    return any(kw in text for kw in _GATE0_SECURITY_KEYWORDS)


# ── Event type pre-classifier ─────────────────────────────────────────────────
# Requires 2+ distinct keyword matches to assign a non-general category.
_EVENT_TYPE_KEYWORDS: dict[str, list[str]] = {
    "aviation":  ["airport", "aircraft", "flight", "airline", "runway", "notam",
                  "airspace", "pilot", "crash", "drone", "aviation", "atc", "aerodrome"],
    "maritime":  ["port", "ship", "vessel", "tanker", "strait", "cargo", "naval",
                  "coast guard", "coastguard", "piracy", "maritime", "harbour", "harbor",
                  "freighter", "shipping", "sea lane", "dock"],
    "energy":    ["pipeline", "oil", "gas", "refinery", "power plant", "electricity",
                  "grid", "substation", "lng", "petroleum", "fuel", "drilling", "nuclear",
                  "energy", "blackout", "outage"],
    "conflict":  ["attack", "strike", "explosion", "bomb", "missile", "gunfire",
                  "military", "troops", "rebel", "battle", "fighting", "airstrike",
                  "shelling", "siege", "killed", "casualties", "war"],
    "telecom":   ["internet", "network", "cable", "outage", "shutdown", "signal",
                  "broadband", "fiber", "satellite", "telecom", "communications"],
}


def _classify_event_type(title: str, summary: str = "") -> str:
    """
    Classify article into event type. Requires ≥2 distinct keyword matches.
    Returns category name or 'general' if no category meets the threshold.
    """
    text = (f"{title} {summary[:500]}").lower()
    best_cat = "general"
    best_count = 0
    for cat, keywords in _EVENT_TYPE_KEYWORDS.items():
        matches = sum(1 for kw in keywords if kw in text)
        if matches >= 2 and matches > best_count:
            best_count = matches
            best_cat = cat
    return best_cat


_SCAN_FEEDS = [
    # ── African regional ──────────────────────────────────────────────────────
    ("AllAfrica Tanzania",    "https://allafrica.com/tools/headlines/rdf/tanzania/headlines.rdf"),
    ("AllAfrica East Africa", "https://allafrica.com/tools/headlines/rdf/eastafrica/headlines.rdf"),
    ("AllAfrica Kenya",       "https://allafrica.com/tools/headlines/rdf/kenya/headlines.rdf"),
    ("AllAfrica Uganda",      "https://allafrica.com/tools/headlines/rdf/uganda/headlines.rdf"),
    ("AllAfrica Rwanda",      "https://allafrica.com/tools/headlines/rdf/rwanda/headlines.rdf"),
    ("AllAfrica South Sudan", "https://allafrica.com/tools/headlines/rdf/southsudan/headlines.rdf"),
    ("Africa News",           "https://www.africanews.com/feed/"),
    ("Sahara Reporters",      "https://saharareporters.com/rss.xml"),
    ("Morocco World News",    "https://www.moroccoworldnews.com/feed"),
    ("Maghrebi",              "https://maghrebi.org/feed"),
    ("Nation Africa",         "https://nation.africa/kenya/feed"),
    ("Africa Intelligence",   "https://www.africa-intelligence.com/rss.xml"),
    # ── Global wire / broadcasters ────────────────────────────────────────────
    ("BBC Africa",            "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
    ("BBC World",             "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ("CNN",                   "https://rss.cnn.com/rss/edition_world.rss"),   # https (was http)
    ("Al Jazeera",            "https://www.aljazeera.com/xml/rss/all.xml"),
    ("Reuters World",         "https://feeds.reuters.com/reuters/worldNews"),
    ("AP News",               "https://rsshub.app/apnews/topics/world-news"),
    ("France24",              "https://www.france24.com/en/rss"),
    ("DW News",               "https://rss.dw.com/rdf/rss-en-all"),
    ("Euronews",              "https://feeds.feedburner.com/euronews/en/news"),
    ("Tagesschau",            "https://www.tagesschau.de/xml/rss2/"),
    ("RTS",                   "https://www.rts.ch/rss/info/index.xml"),       # fixed URL
    ("VOA News",              "https://www.voanews.com/api/zyrqmveiq_"),
    ("Radio Free Europe",     "https://www.rferl.org/api/epiqq"),
    # ── Official / humanitarian ───────────────────────────────────────────────
    ("UN News",               "https://news.un.org/feed/subscribe/en/news/all/rss.xml"),
    ("Relief Web",            "https://reliefweb.int/headlines/rss.xml"),
    # ── Middle East / South Asia ──────────────────────────────────────────────
    ("Al Arabiya",            "https://english.alarabiya.net/tools/rss"),
    ("Middle East Eye",       "https://www.middleeasteye.net/rss"),
    ("New Arab",              "https://www.newarab.com/rss"),
    ("Alaraby",               "https://www.alaraby.co.uk/rss"),
    ("Gulf News",             "https://gulfnews.com/rss"),
    ("Khaleej Times",         "https://www.khaleejtimes.com/rss"),
    ("Arab News",             "https://www.arabnews.com/rss"),
    ("Jerusalem Post",        "https://www.jpost.com/rss/rssfeedsfrontpage.aspx"),
    ("Times of Israel",       "https://www.timesofisrael.com/feed"),
    ("Anadolu Agency",        "https://www.aa.com.tr/en/rss/default?cat=world"),
    ("Times of India",        "https://timesofindia.indiatimes.com/rssfeedstopstories.cms"),
    ("Dawn Pakistan",         "https://www.dawn.com/feeds/home"),
    ("Pakistan Tribune",      "https://tribune.com.pk/feed/breaking-news"),
    # ── Eastern Europe / Eurasia ──────────────────────────────────────────────
    ("Kyiv Independent",      "https://kyivindependent.com/rss"),
    ("Ukrinform",             "https://www.ukrinform.net/rss/block-lastnews"),
    ("TASS",                  "https://tass.com/rss/v2.xml"),               # state-affiliated
    # ── East Asia ─────────────────────────────────────────────────────────────
    ("Nikkei Asia",           "https://asia.nikkei.com/rss/feed/nar"),      # replaces SCMP (blocked)
    # ── Investigative / analysis ──────────────────────────────────────────────
    ("OCCRP",                 "https://www.occrp.org/en/rss"),
    ("Global Voices",         "https://globalvoices.org/feed"),
    ("Bellingcat",            "https://www.bellingcat.com/feed/"),
    ("ISW",                   "https://www.understandingwar.org/rss.xml"),
    ("War on the Rocks",      "https://warontherocks.com/feed/"),
    ("Defense One",           "https://www.defenseone.com/rss/all/"),
    # ── Tabloid / opinion-heavy (capped at medium) ────────────────────────────
    ("Fox News",              "https://feeds.foxnews.com/foxnews/world"),    # fixed URL
    ("Bild",                  "https://www.bild.de/rssfeeds/vw/rss-16725492,dzbildplus=false,view=rss2.bild.xml"),  # fixed URL
]

# Append expanded regional/global feeds without removing existing ones.
# Deduplicate feed URLs while preserving first-seen source naming.
_seen_feed_urls = {url for _, url in _SCAN_FEEDS}
_SCAN_FEED_REGION: dict[str, str] = {}
for source_name, feed_url in _SCAN_FEEDS:
    if not feed_url:
        continue
    _SCAN_FEED_REGION[feed_url] = _infer_feed_region(source_name, feed_url)

for source_name, feed_url in ADDITIONAL_SCAN_FEEDS:
    if not feed_url or feed_url in _seen_feed_urls:
        continue
    _SCAN_FEEDS.append((source_name, feed_url))
    _seen_feed_urls.add(feed_url)
    _SCAN_FEED_REGION[feed_url] = _infer_feed_region(source_name, feed_url)

_feed_regions_counter = Counter(_SCAN_FEED_REGION.values())
print(
    f"[feeds] scan registry loaded {len(_SCAN_FEEDS)} total feeds "
    f"({len(ADDITIONAL_SCAN_FEEDS)} additional candidates) regions={dict(_feed_regions_counter)}"
)


def _make_news_marker(article: dict) -> Optional[dict]:
    lat = article.get("lat")
    lon = article.get("lon")
    if lat is None or lon is None:
        return None
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(lat_f) and math.isfinite(lon_f)):
        return None
    return {
        "headline": article.get("title", ""),
        "source": article.get("source", ""),
        "url": article.get("url", ""),
        "lat": lat_f,
        "lon": lon_f,
        "feed_region": article.get("feed_region", "global"),
        "location": (article.get("location_name") or "")[:80],
        "location_name": article.get("location_name"),
        "confidence": article.get("confidence", "medium"),
        "location_confidence": article.get("location_confidence", "none"),
        "resolved_country_code": article.get("resolved_country_code"),
        "resolved_display_name": article.get("resolved_display_name"),
        "published": article.get("published", datetime.now(timezone.utc).isoformat()),
        "expires_at": article.get("expires_at", (datetime.now(timezone.utc) + timedelta(hours=_NEWS_MARKER_WINDOW_HOURS)).isoformat()),
        "image_url":   article.get("image_url") or article.get("og_image") or article.get("image") or None,
        "summary":     (article.get("summary") or article.get("description") or "")[:400],
        "source_name": article.get("source_name") or article.get("feed_name") or article.get("source") or "",
        "num_sources": article.get("num_sources") or 1,
    }


_REGION_FALLBACK_CENTROIDS = {
    # Africa
    "east_africa":    {"lat": -2.0,  "lon":  35.0,  "display_name": "East Africa"},
    "horn_of_africa": {"lat": 10.0,  "lon":  45.0,  "display_name": "Horn of Africa"},
    "great_lakes":    {"lat": -4.0,  "lon":  30.0,  "display_name": "Great Lakes Region"},
    "sahel":          {"lat": 15.0,  "lon":   3.5,  "display_name": "Sahel"},
    "africa":         {"lat":  1.5,  "lon":  20.0,  "display_name": "Africa"},
    "west_africa":    {"lat": 12.0,  "lon":  -0.5,  "display_name": "West Africa"},
    "north_africa":   {"lat": 28.0,  "lon":  17.0,  "display_name": "North Africa"},
    "southern_africa":{"lat":-23.5,  "lon":  24.0,  "display_name": "Southern Africa"},
    "central_africa": {"lat":  0.0,  "lon":  20.0,  "display_name": "Central Africa"},
    # Middle East
    "middle_east":    {"lat": 33.5,  "lon":  45.5,  "display_name": "Middle East"},
    "levant":         {"lat": 33.5,  "lon":  38.5,  "display_name": "Levant"},
    "gulf_states":    {"lat": 26.0,  "lon":  53.0,  "display_name": "Gulf States"},
    "red_sea":        {"lat": 21.0,  "lon":  46.0,  "display_name": "Red Sea / Arabian Peninsula"},
    "iran":           {"lat": 32.5,  "lon":  54.0,  "display_name": "Iran"},
    "iraq":           {"lat": 33.5,  "lon":  43.7,  "display_name": "Iraq"},
    "yemen":          {"lat": 15.5,  "lon":  48.5,  "display_name": "Yemen"},
    # Asia
    "asia":           {"lat": 30.0,  "lon": 100.0,  "display_name": "Asia"},
    "south_asia":     {"lat": 21.5,  "lon":  77.5,  "display_name": "South Asia"},
    "southeast_asia": {"lat":  9.0,  "lon": 116.0,  "display_name": "Southeast Asia"},
    "central_asia":   {"lat": 45.5,  "lon":  68.0,  "display_name": "Central Asia"},
    "east_asia":      {"lat": 36.0,  "lon": 109.5,  "display_name": "East Asia"},
    "mediterranean":  {"lat": 38.0,  "lon":  18.0,  "display_name": "Mediterranean"},
    "indian_ocean":   {"lat": -5.0,  "lon":  70.0,  "display_name": "Indian Ocean"},
    # Europe
    "europe":         {"lat": 53.5,  "lon":  10.0,  "display_name": "Europe"},
    "eastern_europe": {"lat": 51.5,  "lon":  27.0,  "display_name": "Eastern Europe"},
    "ukraine":        {"lat": 48.5,  "lon":  31.5,  "display_name": "Ukraine"},
    "balkans":        {"lat": 42.5,  "lon":  21.2,  "display_name": "Balkans"},
    "russia":         {"lat": 63.5,  "lon":  47.0,  "display_name": "Russia"},
    "caucasus":       {"lat": 42.0,  "lon":  45.0,  "display_name": "Caucasus"},
    # Americas
    "americas":       {"lat": 10.0,  "lon": -75.0,  "display_name": "Americas"},
    "north_america":  {"lat": 48.0,  "lon": -95.0,  "display_name": "North America"},
    "central_america":{"lat": 16.0,  "lon": -75.5,  "display_name": "Central America"},
    "latin_america":  {"lat":-22.0,  "lon": -58.0,  "display_name": "South America"},
    "south_america":  {"lat":-22.0,  "lon": -58.0,  "display_name": "South America"},
    # Oceania
    "australia":      {"lat":-27.5,  "lon": 133.0,  "display_name": "Australia"},
    # Global
    "global":         {"lat": 20.0,  "lon":   0.0,  "display_name": "Global"},
}


def _normalize_region(region: str) -> str:
    r = (region or "global").strip().lower()
    if r in _REGION_FALLBACK_CENTROIDS:
        return r
    return "global"


def _resolve_marker_location(article: dict) -> Optional[dict]:
    marker = _make_news_marker(article)
    if marker:
        return marker

    region = _normalize_region(article.get("feed_region", "global"))
    fallback = _REGION_FALLBACK_CENTROIDS.get(region, _REGION_FALLBACK_CENTROIDS["global"])
    fallback_conf = "fallback_region" if region != "global" else "fallback_global"
    enriched = {**article}
    enriched["feed_region"] = region
    enriched["lat"] = fallback["lat"]
    enriched["lon"] = fallback["lon"]
    enriched["location_name"] = fallback["display_name"]
    if (enriched.get("location_confidence") or "none") == "none":
        enriched["location_confidence"] = fallback_conf
    enriched["resolved_display_name"] = enriched.get("resolved_display_name") or fallback["display_name"]
    return _make_news_marker(enriched)


def _build_marker_set(articles: list[dict], per_region: int = 150, max_total: int = 900) -> tuple[list[dict], dict[str, int]]:
    buckets: dict[str, list[dict]] = {}
    for article in articles:
        region = _normalize_region(article.get("feed_region", "global"))
        buckets.setdefault(region, []).append(article)

    for region in buckets:
        buckets[region].sort(key=lambda a: a.get("published", ""), reverse=True)

    selected: list[dict] = []
    seen_urls: set[str] = set()
    counts_by_region: dict[str, int] = {}

    for region, bucket in buckets.items():
        taken = 0
        for article in bucket:
            if len(selected) >= max_total or taken >= per_region:
                break
            url = article.get("url", "")
            if url and url in seen_urls:
                continue
            marker = _resolve_marker_location(article)
            if not marker:
                continue
            if url:
                seen_urls.add(url)
            selected.append(marker)
            taken += 1
        counts_by_region[region] = taken

    if len(selected) < max_total:
        leftovers: list[dict] = []
        for bucket in buckets.values():
            leftovers.extend(bucket)
        leftovers.sort(key=lambda a: a.get("published", ""), reverse=True)

        for article in leftovers:
            if len(selected) >= max_total:
                break
            url = article.get("url", "")
            if url and url in seen_urls:
                continue
            marker = _resolve_marker_location(article)
            if not marker:
                continue
            region = _normalize_region(marker.get("feed_region", "global"))
            counts_by_region[region] = counts_by_region.get(region, 0) + 1
            if url:
                seen_urls.add(url)
            selected.append(marker)

    selected.sort(key=lambda m: m.get("published", ""), reverse=True)
    return selected[:max_total], counts_by_region


def _prune_news_article_store(max_items: int = _NEWS_STORE_MAX_ARTICLES) -> None:
    with _NEWS_STORE_LOCK:
        if len(_NEWS_ARTICLE_STORE) <= max_items:
            return
        sorted_items = sorted(
            _NEWS_ARTICLE_STORE.items(),
            key=lambda kv: kv[1].get("published", ""),
            reverse=True,
        )
        keep = dict(sorted_items[:max_items])
        _NEWS_ARTICLE_STORE.clear()
        _NEWS_ARTICLE_STORE.update(keep)
    _PROCESSED_URLS.intersection_update(set(_NEWS_ARTICLE_STORE.keys()))


def _upsert_news_article(article: dict) -> None:
    url = article.get("url")
    if not url:
        return
    with _NEWS_STORE_LOCK:
        existing = _NEWS_ARTICLE_STORE.get(url, {})
        merged = {**existing, **article}
        _NEWS_ARTICLE_STORE[url] = merged


def _merge_conflict_markers(new_markers: list[dict]) -> None:
    global _NEWS_CONFLICT_MARKERS
    now_iso = datetime.now(timezone.utc).isoformat()
    merged = [m for m in (_NEWS_CONFLICT_MARKERS + new_markers) if m.get("expires_at", "") > now_iso]
    seen_urls = set()
    deduped = []
    for marker in merged:
        url = marker.get("url")
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        deduped.append(marker)
    _NEWS_CONFLICT_MARKERS = deduped


def _run_news_conflict_extraction_sync():
    """
    Synchronous extraction pass — runs in ThreadPoolExecutor so blocking I/O
    (feedparser HTTP, Nominatim HTTP) never touches the asyncio event loop.
    Prints per-feed diagnostics for every source to aid debugging.
    """
    global _NEWS_CONFLICT_MARKERS, _PROCESSED_URLS, _FIRST_EXTRACTION_DONE

    MAX_NOM_CALLS = 100       # hard cap per cycle (only counts uncached HTTP calls)
    nom_calls = 0
    new_markers = []
    feeds_loaded = 0
    articles_fetched = 0
    cycle_unique_urls: set[str] = set()
    nom_cap_logged = False
    total_articles_parsed = 0
    articles_with_coords = 0
    articles_without_coords = 0
    successful_candidates = Counter()
    failed_feeds: dict = {}
    geo_stats_before = get_geocode_stats()

    # On the very first cycle, clear processed URLs so all current articles are evaluated fresh
    if not _FIRST_EXTRACTION_DONE:
        _PROCESSED_URLS.clear()
        print("[news-conflicts] First cycle — processed URL cache cleared")

    # Purge stale markers at start of each cycle
    now_iso = datetime.now(timezone.utc).isoformat()
    _NEWS_CONFLICT_MARKERS[:] = [
        m for m in _NEWS_CONFLICT_MARKERS
        if m.get("expires_at", "") > now_iso
    ]

    # ── Parallel feed fetch (20 concurrent HTTP workers) ──────────────────────
    def _prefetch_feed(args):
        sn, fu = args
        try:
            return sn, fu, feedparser.parse(fu, agent="Mozilla/5.0", request_headers={"Accept": "application/rss+xml, application/xml, text/xml"}), None
        except Exception as ex:
            return sn, fu, None, ex

    from concurrent.futures import ThreadPoolExecutor as _FetchTPE
    with _FetchTPE(max_workers=20, thread_name_prefix="rss-fetch") as _fp:
        _scan_results = list(_fp.map(_prefetch_feed, _SCAN_FEEDS))

    for source_name, feed_url, feed, _fetch_err in _scan_results:
        # ── Per-feed diagnostic counters ──────────────────────────────────────
        f_articles = 0
        f_locations = 0
        f_geocoded = 0
        f_added = 0
        feed_region = _SCAN_FEED_REGION.get(feed_url) or _infer_feed_region(source_name, feed_url)

        try:
            if _fetch_err:
                raise _fetch_err
            f_articles = len(feed.entries)
            feeds_loaded += 1
            articles_fetched += f_articles
        except Exception as ex:
            print(f"[feed] {source_name}: ERROR fetching — {ex}")
            failed_feeds[f"{source_name} | {feed_url}"] = str(ex)
            continue

        for entry in feed.entries[:_NEWS_FEED_ENTRY_LIMIT]:
            url = entry.get("link", "")
            if not url:
                continue
            cycle_unique_urls.add(url)
            if url in _PROCESSED_URLS:
                continue
            total_articles_parsed += 1
            title   = entry.get("title", "") or ""
            summary = entry.get("summary", "") or ""
            # Extract image URL from RSS entry (media:content, media:thumbnail, enclosures)
            entry_image_url: Optional[str] = None
            try:
                mc = entry.get("media_content", [])
                if mc:
                    entry_image_url = mc[0].get("url") or None
                if not entry_image_url:
                    mt = entry.get("media_thumbnail", [])
                    if mt:
                        entry_image_url = mt[0].get("url") or None
                if not entry_image_url:
                    for enc in (entry.get("enclosures") or []):
                        if (enc.get("type") or "").startswith("image/"):
                            entry_image_url = enc.get("url") or enc.get("href") or None
                            break
            except Exception:
                entry_image_url = None

            try:
                pp = entry.get("published_parsed") or entry.get("updated_parsed")
                published_iso = datetime(*pp[:6], tzinfo=timezone.utc).isoformat() if pp else datetime.now(timezone.utc).isoformat()
            except Exception:
                published_iso = datetime.now(timezone.utc).isoformat()
            expires_iso = (datetime.now(timezone.utc) + timedelta(hours=_NEWS_MARKER_WINDOW_HOURS)).isoformat()

            _PROCESSED_URLS.add(url)

            # ── Gate 0: headline security relevance ───────────────────────────
            if not _gate0_passes(title, summary):
                print(f"[gate0] REJECT '{title[:80]}' (no security keywords) [{source_name}]")
                continue

            # ── Event type pre-classification ─────────────────────────────────
            article_event_type = _classify_event_type(title, summary)

            allow_live_lookup = nom_calls < MAX_NOM_CALLS
            if not allow_live_lookup and not nom_cap_logged:
                print(f"[feed] Nominatim cap ({MAX_NOM_CALLS}) reached — continuing feed scan with cached geocodes/fallback only")
                nom_cap_logged = True

            stats_before = get_geocode_stats()
            geo, winning_candidate, candidates, meta = _geocode_from_text_blob(
                title,
                summary,
                source_name=source_name,
                feed_url=feed_url,
                max_candidates=5,
                allow_live_lookup=allow_live_lookup,
            )
            stats_after = get_geocode_stats()
            if stats_after["http_calls"] > stats_before["http_calls"]:
                nom_calls += (stats_after["http_calls"] - stats_before["http_calls"])
            f_locations += len(candidates[:5])

            if not geo:
                articles_without_coords += 1
                _upsert_news_article({
                    "url": url,
                    "title": title,
                    "source": source_name,
                    "feed_region": feed_region,
                    "summary": summary[:400],
                    "published": published_iso,
                    "expires_at": expires_iso,
                    "location_name": None,
                    "lat": None,
                    "lon": None,
                    "confidence": "low",
                    "location_confidence": meta.get("location_confidence", "none"),
                    "resolved_country_code": meta.get("resolved_country_code"),
                    "resolved_display_name": meta.get("resolved_display_name"),
                    "geocode_candidate": winning_candidate,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                continue

            articles_with_coords += 1
            f_geocoded += 1
            geo_type = str(geo.get("type") or "").lower()
            location_confidence = meta.get("location_confidence", "none")
            if geo_type.startswith("fallback") or location_confidence in {"relaxed", "fallback_country"}:
                confidence = "medium"
            else:
                confidence = _score_confidence(source_name, geo)
                if confidence == "low" and location_confidence == "strict":
                    confidence = "medium"

            lat = float(geo.get("lat", 0))
            lon = float(geo.get("lon", 0))
            if lat == 0.0 and lon == 0.0:
                _upsert_news_article({
                    "url": url,
                    "title": title,
                    "source": source_name,
                    "feed_region": feed_region,
                    "summary": summary[:400],
                    "published": published_iso,
                    "expires_at": expires_iso,
                    "location_name": geo.get("display_name"),
                    "lat": None,
                    "lon": None,
                    "confidence": confidence,
                    "location_confidence": location_confidence,
                    "resolved_country_code": meta.get("resolved_country_code"),
                    "resolved_display_name": meta.get("resolved_display_name"),
                    "geocode_candidate": winning_candidate,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                continue

            if winning_candidate:
                successful_candidates[winning_candidate] += 1

            article_record = {
                "url": url,
                "title": title,
                "source": source_name,
                "feed_region": feed_region,
                "summary": summary[:400],
                "published": published_iso,
                "expires_at": expires_iso,
                "location_name": geo.get("display_name"),
                "lat": lat,
                "lon": lon,
                "confidence": confidence,
                "location_confidence": location_confidence,
                "resolved_country_code": meta.get("resolved_country_code"),
                "resolved_display_name": meta.get("resolved_display_name"),
                "geocode_candidate": winning_candidate,
                "event_type": article_event_type,
                "image_url": entry_image_url,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            _upsert_news_article(article_record)
            marker = _make_news_marker(article_record)
            if marker:
                new_markers.append(marker)
                f_added += 1

        print(f"[feed] {source_name}: {f_articles} articles — {f_locations} locs — {f_geocoded} geocoded — {f_added} added")

    _merge_conflict_markers(new_markers)
    _prune_news_article_store()
    _FIRST_EXTRACTION_DONE = True
    geo_stats_after = get_geocode_stats()
    nom_cache_size = geo_stats_after["cache_size"]
    nom_calls_delta = geo_stats_after["http_calls"] - geo_stats_before["http_calls"]
    top_candidates = [c for c, _ in successful_candidates.most_common(5)]
    geo_validation_stats = _snapshot_geo_validation_stats()
    print(f"[news-conflicts] feeds loaded={feeds_loaded} articles fetched={articles_fetched} articles after dedup={len(cycle_unique_urls)}")
    print(
        f"[news-conflicts] total_articles_parsed={total_articles_parsed} "
        f"with_coords={articles_with_coords} without_coords={articles_without_coords} "
        f"nominatim_calls={nom_calls_delta} top_candidates={top_candidates}"
    )
    print(f"[news-conflicts] geo_validation={geo_validation_stats}")
    print(f"[news-conflicts] {len(new_markers)} new, {len(_NEWS_CONFLICT_MARKERS)} total active, {nom_calls} HTTP geocode calls, {nom_cache_size} places cached")
    now_iso = datetime.now(timezone.utc).isoformat()
    with _FEED_RUN_STATS_LOCK:
        _FEED_RUN_STATS["feeds_total"]    = len(_SCAN_FEEDS)
        _FEED_RUN_STATS["feeds_ok"]       = feeds_loaded
        _FEED_RUN_STATS["feeds_failed"]   = len(_SCAN_FEEDS) - feeds_loaded
        _FEED_RUN_STATS["feeds_attempted"] = len(_SCAN_FEEDS)
        _FEED_RUN_STATS["failed_feeds"]   = failed_feeds
        _FEED_RUN_STATS["last_run_at"]    = now_iso
    # Sync to DS_STATUS so health endpoint shows current last_poll
    with _DS_STATUS_LOCK:
        _DS_STATUS["rss"]["last_run"]    = now_iso
        _DS_STATUS["rss"]["feeds_ok"]    = feeds_loaded
        _DS_STATUS["rss"]["feeds_total"] = len(_SCAN_FEEDS)
        _DS_STATUS["rss"]["failures"]    = max(0, len(_SCAN_FEEDS) - feeds_loaded)


def _run_background_news_geocode_sync(max_articles: int = 120):
    """
    Background pass: enrich recent store articles missing coordinates.
    Does not fetch feeds; only geocodes existing in-memory article records.
    """
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(hours=_NEWS_WINDOW_HOURS)).isoformat()
    with _NEWS_STORE_LOCK:
        pending = [
            a for a in _NEWS_ARTICLE_STORE.values()
            if a.get("published", "") >= cutoff_iso
            and (a.get("lat") is None or a.get("lon") is None)
            and a.get("url")
        ]

    if not pending:
        print("[news-geo-worker] no pending articles")
        return

    pending.sort(key=lambda a: a.get("published", ""), reverse=True)
    pending = pending[:max_articles]

    geo_stats_before = get_geocode_stats()
    successful_candidates = Counter()
    added_markers = []
    updated = 0
    still_missing = 0

    for article in pending:
        title = article.get("title", "") or ""
        summary = article.get("summary", "") or ""
        source = article.get("source", "") or ""
        feed_region = _normalize_region(article.get("feed_region", "global"))

        geo, winner, _, meta = _geocode_from_text_blob(
            title,
            summary,
            source_name=source,
            max_candidates=5,
            allow_live_lookup=True,
        )
        if not geo:
            # Use feed_region centroid as fallback when Nominatim fails
            if feed_region and feed_region != "global" and feed_region in _REGION_FALLBACK_CENTROIDS:
                centroid = _REGION_FALLBACK_CENTROIDS[feed_region]
                lat = centroid["lat"]
                lon = centroid["lon"]
                updated_article = {
                    "url": article["url"],
                    "title": title,
                    "source": source,
                    "feed_region": feed_region,
                    "summary": summary[:400],
                    "published": article.get("published", datetime.now(timezone.utc).isoformat()),
                    "expires_at": article.get("expires_at", (datetime.now(timezone.utc) + timedelta(hours=_NEWS_MARKER_WINDOW_HOURS)).isoformat()),
                    "location_name": feed_region.replace("_", " ").title(),
                    "lat": lat,
                    "lon": lon,
                    "confidence": "low",
                    "location_confidence": "fallback_region",
                    "resolved_country_code": "",
                    "resolved_display_name": feed_region.replace("_", " ").title(),
                    "geocode_candidate": feed_region,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                _upsert_news_article(updated_article)
                marker = _make_news_marker(updated_article)
                if marker:
                    added_markers.append(marker)
                updated += 1
            else:
                still_missing += 1
                _upsert_news_article({
                    "url": article["url"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
            continue

        try:
            lat = float(geo.get("lat", 0))
            lon = float(geo.get("lon", 0))
        except (TypeError, ValueError):
            still_missing += 1
            continue
        if lat == 0.0 and lon == 0.0:
            still_missing += 1
            continue

        geo_type = str(geo.get("type") or "").lower()
        location_confidence = meta.get("location_confidence", "none")
        if geo_type.startswith("fallback") or location_confidence in {"relaxed", "fallback_country"}:
            confidence = "medium"
        else:
            confidence = _score_confidence(source, geo)
            if confidence == "low" and location_confidence == "strict":
                confidence = "medium"

        if winner:
            successful_candidates[winner] += 1

        updated += 1
        updated_article = {
            "url": article["url"],
            "title": title,
            "source": source,
            "feed_region": feed_region,
            "summary": summary[:400],
            "published": article.get("published", datetime.now(timezone.utc).isoformat()),
            "expires_at": article.get("expires_at", (datetime.now(timezone.utc) + timedelta(hours=_NEWS_MARKER_WINDOW_HOURS)).isoformat()),
            "location_name": geo.get("display_name"),
            "lat": lat,
            "lon": lon,
            "confidence": confidence,
            "location_confidence": location_confidence,
            "resolved_country_code": meta.get("resolved_country_code"),
            "resolved_display_name": meta.get("resolved_display_name"),
            "geocode_candidate": winner,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        _upsert_news_article(updated_article)
        marker = _make_news_marker(updated_article)
        if marker:
            added_markers.append(marker)

    if added_markers:
        _merge_conflict_markers(added_markers)
    _prune_news_article_store()

    geo_stats_after = get_geocode_stats()
    calls_delta = geo_stats_after["http_calls"] - geo_stats_before["http_calls"]
    top_candidates = [c for c, _ in successful_candidates.most_common(5)]
    geo_validation_stats = _snapshot_geo_validation_stats()
    print(
        f"[news-geo-worker] scanned={len(pending)} updated={updated} "
        f"still_missing={still_missing} nominatim_calls={calls_delta} "
        f"top_candidates={top_candidates} markers_total={len(_NEWS_CONFLICT_MARKERS)}"
    )
    print(f"[news-geo-worker] geo_validation={geo_validation_stats}")


async def _extract_news_conflicts_loop():
    """Async wrapper: immediate first run on startup, then every 30 minutes."""
    loop = asyncio.get_event_loop()
    # Run immediately — no startup delay
    print(f"[news-conflicts] Starting first extraction cycle (feeds={len(_SCAN_FEEDS)})…")
    t0 = asyncio.get_event_loop().time()
    try:
        await loop.run_in_executor(_executor, _run_news_conflict_extraction_sync)
        elapsed = asyncio.get_event_loop().time() - t0
        print(f"[news-conflicts] First cycle complete in {elapsed:.0f}s — articles={len(_NEWS_ARTICLE_STORE)} markers={len(_NEWS_CONFLICT_MARKERS)}")
    except Exception as ex:
        print(f"[news-conflicts] startup run error: {ex}")
    while True:
        await asyncio.sleep(1800)   # 30 minutes
        t0 = asyncio.get_event_loop().time()
        try:
            await loop.run_in_executor(_executor, _run_news_conflict_extraction_sync)
            elapsed = asyncio.get_event_loop().time() - t0
            print(f"[news-conflicts] Cycle complete in {elapsed:.0f}s — articles={len(_NEWS_ARTICLE_STORE)} markers={len(_NEWS_CONFLICT_MARKERS)}")
        except Exception as ex:
            print(f"[news-conflicts] loop error: {ex}")


async def _background_news_geocode_loop():
    """Async wrapper for periodic background geocoding of pending articles."""
    loop = asyncio.get_event_loop()
    await asyncio.sleep(5)  # let first feed extraction warm up the store
    while True:
        try:
            await loop.run_in_executor(_executor, _run_background_news_geocode_sync)
        except Exception as ex:
            print(f"[news-geo-worker] loop error: {ex}")
        await asyncio.sleep(180)  # every 3 minutes



def _prefetch_event_infra(item: dict) -> list:
    """
    For an event item, fetch nearby infrastructure nodes (200km radius) for the
    categories listed in infrastructure_types_to_preload. Results stored in _PREFETCH_CACHE.
    Returns the list of infra nodes.
    """
    item_id  = item.get("id", "")
    if not item_id:
        return []

    now = time_module.time()
    owner = False
    inflight_evt: threading.Event | None = None
    with _PREFETCH_LOCK:
        cached = _PREFETCH_CACHE.get(item_id)
        if cached and (now - cached["fetched_at"]) < cached["ttl"]:
            return cached["infra_nodes"]
        inflight_evt = _PREFETCH_INFLIGHT.get(item_id)
        if inflight_evt is None:
            inflight_evt = threading.Event()
            _PREFETCH_INFLIGHT[item_id] = inflight_evt
            owner = True

    if not owner and inflight_evt is not None:
        if inflight_evt.wait(timeout=6.0):
            with _PREFETCH_LOCK:
                cached = _PREFETCH_CACHE.get(item_id)
                if cached and (time_module.time() - cached["fetched_at"]) < cached["ttl"]:
                    return cached["infra_nodes"]

    try:
        lat = item.get("lat")
        lon = item.get("lon")
        if lat is None or lon is None:
            return []

        cats = item.get("infrastructure_types_to_preload") or []
        nodes: list = []
        R_KM = 200.0

        # Compute rough bbox for 200km
        d_lat = R_KM / 111.0
        d_lon = R_KM / (111.0 * abs(math.cos(math.radians(float(lat)))) + 0.001)
        s = round(float(lat) - d_lat, 4)
        n = round(float(lat) + d_lat, 4)
        w = round(float(lon) - d_lon, 4)
        e = round(float(lon) + d_lon, 4)

        bbox_str = f"{s},{w},{n},{e}"

        def _feature_coords(feat: dict) -> tuple[float, float] | None:
            geom = feat.get("geometry") or {}
            gtype = geom.get("type")
            coords = geom.get("coordinates")
            if not coords:
                return None
            try:
                if gtype == "Point":
                    lon0, lat0 = coords
                elif gtype == "LineString":
                    lon0, lat0 = coords[0]
                elif gtype == "Polygon":
                    lon0, lat0 = coords[0][0]
                elif gtype == "MultiPolygon":
                    lon0, lat0 = coords[0][0][0]
                else:
                    return None
                return float(lat0), float(lon0)
            except Exception:
                return None

        if "airports" in cats:
            try:
                airports = _ensure_airports()
                for ap in airports:
                    alat = float(ap.get("latitude_deg") or 0)
                    alon = float(ap.get("longitude_deg") or 0)
                    dist = _haversine_km(float(lat), float(lon), alat, alon)
                    if dist <= R_KM:
                        nodes.append({
                            "name":     ap.get("name", ""),
                            "type":     "airport",
                            "subtype":  ap.get("type",""),
                            "lat":      alat,
                            "lon":      alon,
                            "distance_km": round(dist, 1),
                            "id":       ap.get("ident",""),
                        })
            except Exception as ex:
                print(f"[prefetch] airports error: {ex}")

        if "ports" in cats:
            try:
                ports = _ensure_ports()
                for p in ports:
                    plat = float(p.get("LATITUDE") or 0)
                    plon = float(p.get("LONGITUDE") or 0)
                    dist = _haversine_km(float(lat), float(lon), plat, plon)
                    if dist <= R_KM:
                        nodes.append({
                            "name":       p.get("PORT_NAME",""),
                            "type":       "port",
                            "lat":        plat,
                            "lon":        plon,
                            "distance_km": round(dist, 1),
                            "country":    p.get("COUNTRY",""),
                        })
            except Exception as ex:
                print(f"[prefetch] ports error: {ex}")

        if "power_plants" in cats:
            try:
                plants = _ensure_powerplants()
                for pp in plants:
                    plat = float(pp.get("latitude") or 0)
                    plon = float(pp.get("longitude") or 0)
                    dist = _haversine_km(float(lat), float(lon), plat, plon)
                    if dist <= R_KM:
                        nodes.append({
                            "name":       pp.get("name",""),
                            "type":       "power_plant",
                            "subtype":    pp.get("primary_fuel",""),
                            "lat":        plat,
                            "lon":        plon,
                            "distance_km": round(dist, 1),
                            "capacity_mw": pp.get("capacity_mw",""),
                        })
            except Exception as ex:
                print(f"[prefetch] power error: {ex}")

        if "chokepoints" in cats:
            try:
                from scoring import CHOKEPOINT_LOCS
                for cp_name, (cp_lat, cp_lon, cp_radius) in CHOKEPOINT_LOCS.items():
                    dist = _haversine_km(float(lat), float(lon), cp_lat, cp_lon)
                    if dist <= R_KM + cp_radius:
                        nodes.append({
                            "name":        cp_name,
                            "type":        "chokepoint",
                            "lat":         cp_lat,
                            "lon":         cp_lon,
                            "distance_km": round(dist, 1),
                        })
            except Exception as ex:
                print(f"[prefetch] chokepoints error: {ex}")

        osm_map = {"hospitals": "medical", "military": "military", "pipelines": "pipelines"}
        for cat in cats:
            if cat not in osm_map:
                continue
            osm_cat = osm_map[cat]
            try:
                data = get_infrastructure(category=osm_cat, bbox=bbox_str)
                for feat in data.get("features", []):
                    coords = _feature_coords(feat)
                    if not coords:
                        continue
                    plat, plon = coords
                    dist = _haversine_km(float(lat), float(lon), plat, plon)
                    if dist <= R_KM:
                        props = feat.get("properties") or {}
                        nodes.append({
                            "name":       props.get("name") or props.get("operator") or osm_cat,
                            "type":       "hospital" if cat == "hospitals" else ("military" if cat == "military" else "pipeline"),
                            "lat":        plat,
                            "lon":        plon,
                            "distance_km": round(dist, 1),
                        })
            except Exception as ex:
                print(f"[prefetch] {osm_cat} error: {ex}")

        # Cap at 30 nodes total, sort by distance
        nodes.sort(key=lambda x: x.get("distance_km", 999))
        nodes = nodes[:30]

        with _PREFETCH_LOCK:
            _PREFETCH_CACHE[item_id] = {
                "infra_nodes": nodes,
                "fetched_at":  now,
                "ttl":         7200,  # 2 hours
            }

        return nodes
    finally:
        if owner:
            with _PREFETCH_LOCK:
                evt = _PREFETCH_INFLIGHT.pop(item_id, None)
                if evt is not None:
                    evt.set()


def _build_enrichment_prompt(item: dict, pre_infra: list, profile: dict | None) -> str:
    headline  = item.get("headline", "")
    summary   = item.get("summary", "") or item.get("context", "")
    location  = item.get("location", "")
    lat, lon  = item.get("lat"), item.get("lon")
    clf_type  = item.get("type", "general")
    clf_icon  = item.get("icon", "diamond")
    clf_color = item.get("color", "grey")
    clf_conf  = item.get("confidence", 0.4)

    from scoring import CHOKEPOINT_LOCS
    nearby_cps = []
    if lat is not None and lon is not None:
        for cp_name, (cp_lat, cp_lon, cp_r) in CHOKEPOINT_LOCS.items():
            if _haversine_km(float(lat), float(lon), cp_lat, cp_lon) <= cp_r + 300:
                nearby_cps.append(cp_name)

    profile_ctx = _format_profile_context(profile) if profile else ""
    infra_lines = "\n".join(f"- {n['name']} [{n['type']}] {n.get('distance_km','')}km" for n in pre_infra[:12])
    cp_str      = ", ".join(nearby_cps) if nearby_cps else "none"
    try:
        chokepoint_statuses = [_compute_chokepoint_status(cp) for cp in _CHOKEPOINT_DEFS]
        cp_status_lines = "\n".join(
            f"- {c.get('name')}: {c.get('current_status')}" for c in chokepoint_statuses
        )
    except Exception:
        cp_status_lines = "unavailable"

    return (
        f"{profile_ctx}You are an intelligence analyst. This event has been flagged for enrichment.\n\n"
        f"EVENT: {headline}\n"
        f"SUMMARY: {summary}\n"
        f"CLASSIFICATION: type={clf_type}, icon={clf_icon}, color={clf_color}, confidence={clf_conf}\n"
        f"LOCATION: {location}\n"
        f"COORDINATES: {lat}, {lon}\n\n"
        f"NEARBY INFRASTRUCTURE:\n{infra_lines or 'none'}\n\n"
        f"NEARBY CHOKEPOINTS: {cp_str}\n\n"
        f"CURRENT CHOKEPOINT STATUSES:\n{cp_status_lines}\n\n"
        f"Respond in two parts:\n"
        f"PART 1 — JSON block (```json```):\n"
        '{{"relevance_score":<0-100>,"relevant_to_profile":<true/false>,'
        '"event_classification":"<conflict|maritime|aviation|energy|political|protest|disaster>",'
        '"primary_location":{"name":"<name>","lat":<lat>,"lon":<lon>},'
        '"aggressor_entities":["<name>"],"affected_entities":["<name>"],'
        '"highlight_chokepoints":["<name>"],'
        '"affected_shipping_routes":[{"from":"<>","to":"<>","reason":"<>"}],'
        '"relevant_infrastructure":[{"name":"<>","type":"<>","lat":<>,"lon":<>,"relevance":"<>"}],'
        '"conflict_polygon":[[<lat>,<lon>]],'
        '"severity":"<critical|significant|elevated|low>",'
        '"icon_type":"<explosion|armed_clash|missile|maritime|aviation|energy|protest|political|disaster>"}\n\n'
        f"PART 2 — 3 paragraphs of analytical prose, max 200 words."
    )


def _parse_enrichment_response(raw: str) -> tuple[dict, str]:
    json_m = re.search(r"```json\\s*(.*?)\\s*```", raw, re.DOTALL)
    enrichment = {}
    if json_m:
        try:
            enrichment = _json.loads(json_m.group(1))
        except Exception:
            enrichment = {}
    prose = raw[json_m.end():].strip() if json_m else raw
    prose = re.sub(r"PART [12][:\\s\\u2014]*", "", prose).strip()
    return enrichment, prose


def _maybe_auto_enrich_batch(items: list) -> None:
    """
    For items with AUTO_ENRICH gate, call Claude if budget/limit allows.
    Checks: enrichment not cached, daily auto-enrich count < limit, spend < cap.
    """
    if not client:
        return

    for item in items:
        if item.get("auto_enrichment_gate") != "AUTO_ENRICH":
            continue

        item_id = item.get("id", "")
        if not item_id:
            continue

        # Check enrichment cache
        now = time_module.time()
        with _ENRICHMENT_LOCK:
            cached = _ENRICHMENT_CACHE.get(item_id)
            if cached and (now - cached["fetched_at"]) < cached["ttl"]:
                print(f"[auto-enrich] skip {item_id} — cached")
                continue  # already enriched

        # Check dedup store (persistent 6h)
        dedup_key = f"auto_enrich_{item_id}"
        if usage_tracker.check_dedup(dedup_key) is not None:
            print(f"[auto-enrich] skip {item_id} — dedup")
            continue

        # Geographic gate — only enrich events within 3000km of a profile focus region
        _GEO_GATE_CENTROIDS = [
            ("East Africa",   -2.0,  37.0),
            ("Middle East",   25.0,  45.0),
            ("Horn of Africa", 8.0,  46.0),
            ("North Africa",  25.0,  17.0),
            ("Indian Ocean", -20.0,  70.0),
        ]
        ev_lat = item.get("lat")
        ev_lon = item.get("lon")
        if ev_lat is not None and ev_lon is not None:
            min_dist = min(
                _haversine_km(float(ev_lat), float(ev_lon), clat, clon)
                for _, clat, clon in _GEO_GATE_CENTROIDS
            )
            if min_dist > 3000:
                print(f"[auto-enrich] skip {item_id} — outside geo gate ({min_dist:.0f}km from nearest focus region)")
                continue

        # Check daily auto-enrich limit
        auto_calls_today = usage_tracker.get_calls_today_by_type("auto_enrichment")
        if auto_calls_today >= _AUTO_ENRICH_DAILY_LIMIT:
            print(f"[auto-enrich] daily limit reached ({_AUTO_ENRICH_DAILY_LIMIT}), skipping {item_id}")
            continue

        # Check daily spend cap
        today_cost = float(usage_tracker.get_today_cost())
        if today_cost >= _AUTO_ENRICH_DAILY_SPEND_CAP:
            print(f"[auto-enrich] daily spend cap exceeded (${_AUTO_ENRICH_DAILY_SPEND_CAP:.2f}), skipping {item_id}")
            continue

        # Gather context
        pre_infra = _PREFETCH_CACHE.get(item_id, {}).get("infra_nodes", [])
        headline  = item.get("headline", "")
        location  = item.get("location", "")
        clf_type  = item.get("type", "general")
        prompt = _build_enrichment_prompt(item, pre_infra, _ACTIVE_PROFILE)

        try:
            resp = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=700,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text if resp.content else ""
            usage_tracker.record_call(
                resp.usage.input_tokens,
                resp.usage.output_tokens,
                call_type="auto_enrichment",
                headline=headline[:80],
            )

            enrichment, prose = _parse_enrichment_response(raw)

            result = {"enrichment": enrichment, "prose": prose, "auto": True}
            usage_tracker.store_dedup(dedup_key, result)

            with _ENRICHMENT_LOCK:
                _ENRICHMENT_CACHE[item_id] = {
                    "enrichment": enrichment,
                    "prose":      prose,
                    "auto":       True,
                    "fetched_at": now,
                    "ttl":        21600,  # 6 hours
                }
            print(f"[auto-enrich] enriched {item_id} ({clf_type} @ {location})")

        except Exception as ex:
            print(f"[auto-enrich] error for {item_id}: {ex}")


def _build_surface_pool() -> list:
    """
    Build ranked surface pool (top 50 items) from news conflicts.
    All events are included regardless of geography; scoring naturally ranks
    profile-relevant events higher. No Claude calls — all context is rule-based.
    """
    import hashlib

    def _collect_news_items(apply_geo_gate: bool) -> list[dict]:
        """Inner helper — build news marker items with configurable geo gate."""
        result: list[dict] = []
        try:
            now_iso     = datetime.now(timezone.utc).isoformat()
            cutoff_news = (datetime.now(timezone.utc) - timedelta(hours=_NEWS_MARKER_WINDOW_HOURS)).isoformat()
            active_news = [
                m for m in _NEWS_CONFLICT_MARKERS
                if m.get("expires_at", "") > now_iso and m.get("published", "") >= cutoff_news
            ]
            scored_news = score_news_markers(active_news, _ACTIVE_PROFILE, apply_filter=False)

            for marker in scored_news:
                lat = marker.get("lat");  lon = marker.get("lon")
                if lat is None or lon is None:
                    continue
                if apply_geo_gate and not geo_gate_passes(float(lat), float(lon), _ACTIVE_PROFILE):
                    continue

                tier      = marker.get("severity_tier") or "elevated"
                relevance = int(marker.get("relevance_score") or 50)
                headline  = marker.get("headline") or "News conflict event"
                location  = marker.get("location") or marker.get("country") or "Unknown"
                url       = marker.get("url") or ""
                marker_id = f"news_{hashlib.md5((url or headline).encode()).hexdigest()[:12]}"
                ctx       = marker.get("context") or usage_tracker.rule_based_summary(
                    event_type=marker.get("event_type") or "", location=location, count=1, hours=48
                )
                result.append({
                    "id":              marker_id,
                    "source_type":     "news_event",
                    "type":            "news_event",
                    "lat":             float(lat),
                    "lon":             float(lon),
                    "location":        location,
                    "severity_tier":   tier,
                    "headline":        headline,
                    "context":         ctx,
                    "relevance_score": relevance,
                    "analysed":        usage_tracker.check_dedup("news:" + url) is not None if url else False,
                    "source":          marker.get("source") or "rss",
                    "published_at":    marker.get("published") or datetime.now(timezone.utc).isoformat(),
                    "url":             url,
                    "confidence":      marker.get("confidence"),
                    "marker":          marker,
                })
        except Exception as ex:
            import traceback
            print(f"[surface] news source error: {ex}")
            traceback.print_exc()
        return result

    # ── First pass ────────────────────────────────────────────────────────────
    items = _collect_news_items(apply_geo_gate=True)

    # ── Fallback: if pool is sparse, relax geo gate ───────────────────────────
    if len(items) < 3:
        print(
            f"[surface] WARNING: only {len(items)} items after strict pass "
            f"(news_markers={len(_NEWS_CONFLICT_MARKERS)}) — "
            f"retrying without geo gate"
        )
        fallback_news  = _collect_news_items(apply_geo_gate=False)
        fallback_all   = fallback_news

        # Merge: keep strict items, add fallback items not already in pool
        existing_ids = {i["id"] for i in items}
        for item in fallback_all:
            if item["id"] not in existing_ids:
                # Mark fallback items so UI can indicate lower confidence
                items.append({**item, "fallback": True})
                existing_ids.add(item["id"])

        print(f"[surface] fallback pass yielded {len(items)} total items")

    # ── Classification + significance gate ───────────────────────────────────
    recent_counts = _recent_location_counts(items, hours=6)
    gated: list[dict] = []
    for item in items:
        classification = classify_event(
            item.get("headline", ""),
            item.get("context", "") or item.get("summary", ""),
            item.get("source", ""),
        )
        # Preserve original source type
        if item.get("source_type") is None and item.get("type"):
            item["source_type"] = item.get("type")
        # Overwrite type with classifier output for frontend markers
        item["type"]   = classification.get("type")
        item["icon"]   = classification.get("icon")
        item["color"]  = classification.get("color")
        item["confidence"] = classification.get("confidence")
        item["infrastructure_types_to_preload"] = classification.get("infrastructure_types_to_preload", [])

        loc_key = _location_key(item)
        recent_count = recent_counts.get(loc_key, 0) if loc_key else 0
        significance = _score_significance(item, classification, _ACTIVE_PROFILE, recent_count)
        item["significance_score"] = significance
        if significance >= 80:
            item["auto_enrichment_gate"] = "AUTO_ENRICH"
        elif significance >= 40:
            item["auto_enrichment_gate"] = "SURFACE"
        else:
            item["auto_enrichment_gate"] = "DISCARD"

        if item["auto_enrichment_gate"] == "DISCARD":
            continue

        # Background prefetch for SURFACE/AUTO_ENRICH
        if item.get("lat") is not None and item.get("lon") is not None:
            threading.Thread(target=_prefetch_event_infra, args=(item,), daemon=True).start()

        gated.append(item)

    gated.sort(key=lambda x: x["relevance_score"], reverse=True)
    return gated[:50]


# ── Auto-brief helpers ────────────────────────────────────────────────────────

def _get_calls_today() -> int:
    """Return total Claude calls made today from the usage tracker."""
    stats = usage_tracker.get_stats(CLAUDE_BUDGET_USD)
    return int(stats.get("calls_today", 0))


def _auto_brief_cluster(item: dict) -> str | None:
    """
    Generate a short Claude cluster brief for a high-scoring surface item.
    Returns the markdown string or None on failure/skip.
    Checks: dedup cache (24h), daily call limit.
    """
    if not client:
        return None
    item_id   = item.get("id", "")
    dedup_key = f"auto_cluster_{item_id}"
    if usage_tracker.check_dedup(dedup_key) is not None:
        return None   # already generated within 24h
    if _get_calls_today() >= AUTO_BRIEF_DAILY_CALL_LIMIT:
        print(f"[auto-brief] daily limit reached ({AUTO_BRIEF_DAILY_CALL_LIMIT}), skipping cluster brief for {item_id}")
        return None

    location = item.get("location", "Unknown")
    count    = item.get("count", 1)
    avg_g    = item.get("avg_goldstein", "N/A")
    context  = item.get("context", "")
    profile_ctx = _format_profile_context(_ACTIVE_PROFILE)

    prompt = (
        f"{profile_ctx}"
        f"You are Akili, an intelligence analyst. Produce a concise 2-paragraph cluster brief "
        f"(max 200 tokens) for the following conflict cluster. Paragraph 1: what is happening and "
        f"who is likely involved. Paragraph 2: immediate implications for regional stability and "
        f"any actionable monitoring recommendations. Be direct — no filler phrases.\n\n"
        f"CLUSTER DATA:\n"
        f"- Location: {location}\n"
        f"- Incidents in 72h: {count}\n"
        f"- Avg Goldstein severity: {avg_g}\n"
        f"- Context: {context}\n"
    )
    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=250,
            messages=[{"role": "user", "content": prompt}]
        )
        usage_tracker.record_call(message.usage.input_tokens, message.usage.output_tokens)
        text = message.content[0].text.strip()
        usage_tracker.store_dedup(dedup_key, {"markdown": text})
        print(f"[auto-brief] cluster brief generated for {item_id} ({len(text)} chars)")
        return text
    except Exception as ex:
        print(f"[auto-brief] cluster brief error for {item_id}: {ex}")
        return None


def _auto_brief_chokepoint(cp_name: str, status: str, strategic_description: str, headlines: list[str]) -> str | None:
    """
    Generate a one-paragraph Claude impact assessment for a chokepoint status elevation.
    Returns markdown string or None on failure/skip.
    """
    if not client:
        return None
    dedup_key = f"auto_choke_{cp_name}_{status}"
    if usage_tracker.check_dedup(dedup_key) is not None:
        return None
    if _get_calls_today() >= AUTO_BRIEF_DAILY_CALL_LIMIT:
        print(f"[auto-brief] daily limit reached, skipping chokepoint brief for {cp_name}")
        return None

    headlines_block = "\n".join(f"- {h}" for h in headlines[:5]) if headlines else "- No specific headlines matched"
    profile_ctx = _format_profile_context(_ACTIVE_PROFILE)

    prompt = (
        f"{profile_ctx}"
        f"You are Akili, an intelligence analyst. The {cp_name} has just moved to {status.upper()} status. "
        f"Write a single focused paragraph (max 150 tokens) assessing the immediate operational impact: "
        f"which trade flows, energy shipments, or military movements are affected; "
        f"what is the likely duration; and what is the single most important thing a regional decision-maker "
        f"should watch in the next 48 hours. Be direct and specific — no hedging.\n\n"
        f"STRATEGIC CONTEXT: {strategic_description}\n\n"
        f"RECENT ACTIVITY:\n{headlines_block}\n"
    )
    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )
        usage_tracker.record_call(message.usage.input_tokens, message.usage.output_tokens)
        text = message.content[0].text.strip()
        usage_tracker.store_dedup(dedup_key, {"markdown": text})
        print(f"[auto-brief] chokepoint brief generated for {cp_name} ({status}): {len(text)} chars")
        return text
    except Exception as ex:
        print(f"[auto-brief] chokepoint brief error for {cp_name}: {ex}")
        return None


async def _run_auto_cluster_briefs(pool: list) -> None:
    """
    Background coroutine: for each high-scoring pool item, generate a cluster brief
    if it passes all gates (score > threshold, within focus region, under daily limit).
    Runs in the executor so Claude calls don't block the event loop.
    """
    eligible = [
        item for item in pool
        if (item.get("relevance_score", 0) >= AUTO_BRIEF_CLUSTER_SCORE_THRESHOLD
            and item.get("source_type") == "conflict_zone"
            and geo_gate_passes(item.get("lat", 0), item.get("lon", 0), _ACTIVE_PROFILE))
    ]
    if not eligible:
        return

    loop = asyncio.get_event_loop()
    for item in eligible:
        if _get_calls_today() >= AUTO_BRIEF_DAILY_CALL_LIMIT:
            break
        brief = await loop.run_in_executor(_executor, _auto_brief_cluster, item)
        if brief:
            with _AUTO_BRIEF_LOCK:
                _AUTO_BRIEF_STORE[item["id"]] = {
                    "brief":        brief,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }


async def _run_auto_chokepoint_briefs(results: list) -> None:
    """
    Background coroutine: for each chokepoint that just elevated, generate an impact brief.
    """
    loop = asyncio.get_event_loop()
    for cp in results:
        name       = cp.get("name", "")
        new_status = cp.get("current_status", "normal")
        prev_status = _CHOKEPOINT_STATUS_PREV.get(name, "normal")

        # Only trigger on upward transitions: normal → elevated/disrupted, elevated → disrupted
        if new_status == "normal" or new_status == prev_status:
            _CHOKEPOINT_STATUS_PREV[name] = new_status
            continue

        _CHOKEPOINT_STATUS_PREV[name] = new_status

        if _get_calls_today() >= AUTO_BRIEF_DAILY_CALL_LIMIT:
            break

        strategic_description = cp.get("strategic_description", "")
        headlines             = cp.get("recent_headlines", [])

        brief = await loop.run_in_executor(
            _executor,
            _auto_brief_chokepoint,
            name, new_status, strategic_description, headlines,
        )
        if brief:
            store_key = f"cp_{name}_{new_status}"
            with _AUTO_BRIEF_LOCK:
                _CHOKEPOINT_BRIEF_STORE[store_key] = {
                    "brief":        brief,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }


async def _surface_pool_loop():
    """Rebuild the surface pool shortly after startup, then keep it warm."""
    global _SURFACE_POOL, _SURFACE_POOL_UPDATED_AT, _SURFACE_POOL_LAST_NONEMPTY
    await asyncio.sleep(5)
    while True:
        try:
            loop     = asyncio.get_event_loop()
            new_pool = await loop.run_in_executor(_executor, _refresh_surface_pool_sync, "loop")
            with _SURFACE_POOL_LOCK:
                if not new_pool:
                    prev_len = len(_SURFACE_POOL)
                    print(f"[surface] WARNING: rebuild returned 0 items — retaining previous pool ({prev_len} items). "
                          f"news_markers={len(_NEWS_CONFLICT_MARKERS)}")
            # Fire off auto-brief generation for this fresh pool (non-blocking)
            if new_pool:
                asyncio.create_task(_run_auto_cluster_briefs(new_pool))
                loop.run_in_executor(_executor, _maybe_auto_enrich_batch, new_pool)
        except Exception as ex:
            import traceback
            print(f"[surface] pool refresh error: {ex}")
            traceback.print_exc()

        # If pool has been empty for >5 minutes, retry in 60s; otherwise normal 10-min cycle
        with _SURFACE_POOL_LOCK:
            is_empty = len(_SURFACE_POOL) == 0
        if is_empty and (time.time() - _SURFACE_POOL_LAST_NONEMPTY) > 300:
            print(f"[surface] pool empty for >{int((time.time()-_SURFACE_POOL_LAST_NONEMPTY)//60)}min — scheduling fast retry in 60s")
            await asyncio.sleep(60)
        else:
            await asyncio.sleep(600)  # 10 minutes


def _refresh_surface_pool_sync(reason: str = "manual") -> list:
    global _SURFACE_POOL, _SURFACE_POOL_UPDATED_AT, _SURFACE_POOL_LAST_NONEMPTY
    if not _SURFACE_BUILD_LOCK.acquire(blocking=False):
        with _SURFACE_POOL_LOCK:
            return list(_SURFACE_POOL)
    try:
        new_pool = _build_surface_pool()
        if new_pool:
            with _SURFACE_POOL_LOCK:
                _SURFACE_POOL = new_pool
                _SURFACE_POOL_UPDATED_AT = datetime.now(timezone.utc).isoformat()
                _SURFACE_POOL_LAST_NONEMPTY = time.time()
            print(f"[surface] {reason} refresh — {len(new_pool)} items")
        return new_pool
    finally:
        _SURFACE_BUILD_LOCK.release()


# ── Daily intelligence briefing — helpers ─────────────────────────────────────

def _load_briefing_store() -> list:
    try:
        if _BRIEFING_FILE.exists():
            return _json.loads(_BRIEFING_FILE.read_text(encoding="utf-8"))
    except Exception as ex:
        print(f"[briefing] load error: {ex}")
    return []


def _save_briefing_store(store: list) -> None:
    try:
        _BRIEFING_FILE.write_text(
            _json.dumps(store[-30:], indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception as ex:
        print(f"[briefing] save error: {ex}")


def _next_0800_utc() -> str:
    """Return ISO string for the next 08:00 UTC."""
    now    = datetime.now(timezone.utc)
    target = now.replace(hour=8, minute=0, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return target.isoformat()


def _generate_briefing_sync(manual: bool = False) -> dict | None:
    """
    Gather context from the surface pool and news markers, then call
    Claude to produce a structured daily intelligence briefing.
    Returns the briefing dict (persisted to briefings.json) or None on failure.
    """
    if not client:
        print("[briefing] no Claude client — skipping")
        return None

    now_iso    = datetime.now(timezone.utc).isoformat()
    cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    # ── Surface pool ──────────────────────────────────────────────────────────
    with _SURFACE_POOL_LOCK:
        pool_items = list(_SURFACE_POOL)

    surface_lines: list[str] = []
    for item in pool_items[:50]:
        surface_lines.append(
            f"  [{item.get('severity_tier','?').upper()}] "
            f"{item.get('headline','')} — {item.get('location','')} "
            f"(score={item.get('relevance_score',0)}, src={item.get('source','')})"
        )

    # ── Recent news markers ───────────────────────────────────────────────────
    active_news = [
        m for m in _NEWS_CONFLICT_MARKERS
        if m.get("expires_at", "") > now_iso and m.get("published", cutoff_24h) >= cutoff_24h
    ]
    news_lines: list[str] = []
    for m in active_news[:20]:
        news_lines.append(
            f"  [{m.get('confidence','?').upper()}] "
            f"{m.get('headline','')} — {m.get('location','')}"
        )

    # ── Chokepoint status (from auto-brief store) ─────────────────────────────
    cp_lines: list[str] = []
    with _AUTO_BRIEF_LOCK:
        for cp_name, entry in list(_CHOKEPOINT_BRIEF_STORE.items()):
            status = entry.get("status", "elevated")
            note   = entry.get("brief", "")[:120]
            cp_lines.append(f"  {cp_name}: {status.upper()} — {note}")
    if not cp_lines:
        cp_lines = ["  No chokepoint alerts currently active."]

    # ── Build prompt ──────────────────────────────────────────────────────────
    focus_regions = (_ACTIVE_PROFILE or {}).get("focusRegions", ["Global"])
    regions_str   = ", ".join(focus_regions) if focus_regions else "Global"
    profile_ctx   = _format_profile_context(_ACTIVE_PROFILE)

    context_block = (
        f"SURFACE POOL (top scored items):\n"  + ("\n".join(surface_lines) or "  No items.") +
        f"\n\nNEWS CONFLICT MARKERS (past 24h):\n" + ("\n".join(news_lines) or "  None.") +
        f"\n\nCHOKEPOINT STATUS:\n" + "\n".join(cp_lines)
    )

    system_prompt = (
        "You are an intelligence analyst producing a daily briefing for a geopolitical "
        "infrastructure monitoring platform. The operator monitors the following regions: "
        f"{regions_str}. "
        "Focus areas include telecommunications, maritime, and aviation infrastructure. "
        "Your briefing must be analytical, not just descriptive. "
        "Structure your response exactly as follows:\n\n"
        "SITUATION OVERVIEW — 2-3 sentences on the dominant theme of the past 24 hours.\n\n"
        "KEY DEVELOPMENTS — exactly 4-6 items, each formatted as: "
        "[LOCATION/DOMAIN] Development. So what: one sentence assessment of operational significance.\n\n"
        "INDICATORS TO WATCH — exactly 3-4 specific observable events that would confirm or deny "
        "the developing pattern in the next 24-48 hours.\n\n"
        "INFRASTRUCTURE STATUS — for each watched chokepoint: name, status, one-sentence note "
        "if status is not normal.\n\n"
        "TREND LINE — one paragraph on the 7-day pattern across focus regions.\n\n"
        "Be precise. Use intelligence analysis language. Do not hedge unnecessarily. "
        "If the data is insufficient to assess something, say so once and move on."
    )

    user_prompt = (
        f"{profile_ctx}"
        f"Generate today's intelligence briefing based on the following operational data:\n\n"
        f"{context_block}\n\n"
        f"Current UTC time: {now_iso}"
    )

    try:
        message = client.messages.create(
            model    = "claude-sonnet-4-20250514",
            max_tokens = 1200,
            system   = system_prompt,
            messages = [{"role": "user", "content": user_prompt}],
        )
        usage_tracker.record_call(message.usage.input_tokens, message.usage.output_tokens)
        text    = message.content[0].text.strip()
        tokens  = message.usage.input_tokens + message.usage.output_tokens
        briefing = {
            "generated_at":         now_iso,
            "valid_until":          _next_0800_utc(),
            "content":              text,
            "model":                "claude-sonnet-4-20250514",
            "tokens_used":          tokens,
            "manually_regenerated": manual,
        }
        with _BRIEFING_LOCK:
            _BRIEFING_STORE.append(briefing)
            _save_briefing_store(_BRIEFING_STORE)
        _save_briefing_as_document(briefing)
        print(f"[briefing] generated — {tokens} tokens, manual={manual}")
        return briefing
    except Exception as ex:
        print(f"[briefing] generation error: {ex}")
        return None


# ── Document management ───────────────────────────────────────────────────────

_DOCS_DIR   = BASE_DIR / "documents"
_STD_FOLDERS = ["claude-briefings", "my-documents", "saved-analysis", "archived"]
_FOLDER_LABELS = {
    "claude-briefings": "Claude Briefings",
    "my-documents":     "My Documents",
    "saved-analysis":   "Saved Analysis",
    "archived":         "Archived",
}

def _ensure_docs_dirs() -> None:
    for f in _STD_FOLDERS:
        (_DOCS_DIR / f).mkdir(parents=True, exist_ok=True)


# ── Geo data caching (countries + EEZ) ───────────────────────────────────────

_GEO_DIR              = BASE_DIR / "geo"
_GEO_COUNTRIES_FILE   = _GEO_DIR / "countries.geojson"
_GEO_EEZ_FILE         = _GEO_DIR / "eez.geojson"
_GEO_REFRESH_INTERVAL = 30 * 24 * 3600   # 30 days

_COUNTRIES_URL = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"
_EEZ_URL       = (
    "https://geo.vliz.be/geoserver/MarineRegions/ows"
    "?service=WFS&version=1.0.0&request=GetFeature"
    "&typeName=MarineRegions:eez_boundaries&maxFeatures=5000"
    "&outputFormat=application%2Fjson"
)

_GEO_DIR.mkdir(parents=True, exist_ok=True)


def _simplify_geojson(data: dict, tolerance: float = 0.05) -> dict:
    """Simplify GeoJSON geometries using Shapely if available, otherwise return as-is."""
    if not _HAS_SHAPELY:
        return data
    features = []
    for f in data.get("features", []):
        try:
            geom      = _shape(f["geometry"])
            simplified = geom.simplify(tolerance, preserve_topology=True)
            nf = dict(f)
            nf["geometry"] = simplified.__geo_interface__
            features.append(nf)
        except Exception:
            features.append(f)
    return {"type": "FeatureCollection", "features": features}


def _fetch_geo(url: str, dest: Path, simplify_tolerance: float = 0.05) -> bool:
    """Download a GeoJSON URL, optionally simplify, save to dest. Returns True on success."""
    try:
        req  = urllib.request.Request(url, headers={"User-Agent": "Akili/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
        data = _json.loads(raw)
        if data.get("type") != "FeatureCollection" or not data.get("features"):
            return False
        data = _simplify_geojson(data, simplify_tolerance)
        dest.write_text(_json.dumps(data, separators=(",", ":")), encoding="utf-8")
        print(f"[geo] cached {len(data['features'])} features → {dest.name}")
        return True
    except Exception as ex:
        print(f"[geo] fetch failed for {dest.name}: {ex}")
        return False


def _geo_needs_refresh(path: Path) -> bool:
    if not path.exists():
        return True
    return (time_module.time() - path.stat().st_mtime) > _GEO_REFRESH_INTERVAL


async def _geo_refresh_loop() -> None:
    """Monthly background refresh of geo caches."""
    await asyncio.sleep(5)   # let other startup tasks go first
    loop = asyncio.get_event_loop()
    while True:
        if _geo_needs_refresh(_GEO_COUNTRIES_FILE):
            await loop.run_in_executor(
                _executor, lambda: _fetch_geo(_COUNTRIES_URL, _GEO_COUNTRIES_FILE, 0.04)
            )
        if _geo_needs_refresh(_GEO_EEZ_FILE):
            await loop.run_in_executor(
                _executor, lambda: _fetch_geo(_EEZ_URL, _GEO_EEZ_FILE, 0.04)
            )
        await asyncio.sleep(6 * 3600)   # re-check every 6 hours


@app.get("/geo/countries")
async def geo_countries_endpoint():
    if not _GEO_COUNTRIES_FILE.exists():
        raise HTTPException(503, "Countries GeoJSON not yet cached — try again in a moment")
    data = _json.loads(_GEO_COUNTRIES_FILE.read_text(encoding="utf-8"))
    return data


_EEZ_CACHE: dict | None = None


def _ensure_eez_cache():
    global _EEZ_CACHE
    if _EEZ_CACHE is None and _GEO_EEZ_FILE.exists():
        _EEZ_CACHE = _json.loads(_GEO_EEZ_FILE.read_text(encoding="utf-8"))
        print(f"[eez] loaded {len(_EEZ_CACHE.get('features', []))} zones into cache")


@app.get("/geo/eez")
async def geo_eez_endpoint():
    _ensure_eez_cache()
    if _EEZ_CACHE:
        return _EEZ_CACHE
    return {"type": "FeatureCollection", "features": []}


async def _fetch_wiki_eez(name: str) -> str:
    """Fetch Wikipedia extract for an EEZ zone name."""
    try:
        slug = urllib.parse.quote(name.replace(" ", "_"))
        url  = f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}"
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
            if r.status_code == 200:
                return r.json().get("extract", "")
    except Exception:
        pass
    return ""


@app.get("/geo/eez/{mrgid}")
async def geo_eez_detail(mrgid: int):
    """Return detail + Wikipedia extract for a single EEZ zone."""
    _ensure_eez_cache()
    if not _EEZ_CACHE:
        raise HTTPException(503, "EEZ data not loaded")

    feature = next(
        (f for f in _EEZ_CACHE.get("features", [])
         if f.get("properties", {}).get("mrgid") == mrgid),
        None,
    )
    if not feature:
        raise HTTPException(404, "EEZ zone not found")

    p    = feature["properties"]
    name = p.get("geoname", "")
    wiki = await _fetch_wiki_eez(name)

    return {
        "mrgid":     mrgid,
        "name":      name,
        "country":   p.get("territory1"),
        "iso_code":  p.get("iso_ter1"),
        "sovereign": p.get("sovereign1"),
        "area_km2":  p.get("area_km2"),
        "pol_type":  p.get("pol_type"),
        "wikipedia": wiki,
    }


def _load_doc(folder: str, doc_id: str) -> dict | None:
    try:
        return _json.loads((_DOCS_DIR / folder / f"{doc_id}.json").read_text(encoding="utf-8"))
    except Exception:
        return None


def _persist_doc(folder: str, doc_id: str, doc: dict) -> None:
    (_DOCS_DIR / folder / f"{doc_id}.json").write_text(
        _json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def _doc_summary(doc: dict, doc_id: str, folder: str) -> dict:
    content = doc.get("content", "")
    return {
        "id":          doc_id,
        "title":       doc.get("title", "Untitled"),
        "folder":      folder,
        "created_at":  doc.get("created_at", ""),
        "modified_at": doc.get("modified_at", ""),
        "word_count":  len(content.split()) if content else 0,
        "read_only":   doc.get("read_only", False),
        "metadata":    doc.get("metadata", {}),
    }


def _list_docs_in_folder(folder: str) -> list[dict]:
    """Return sorted list of doc summaries for a folder."""
    folder_dir = _DOCS_DIR / folder
    if not folder_dir.exists():
        return []
    docs = []
    for path in folder_dir.glob("*.json"):
        doc = _load_doc(folder, path.stem)
        if doc:
            docs.append(_doc_summary(doc, path.stem, folder))
    docs.sort(key=lambda d: d.get("modified_at", ""), reverse=True)
    return docs


def _auto_archive_old_briefings() -> None:
    """Move claude-briefings older than 30 days to archived/."""
    _ensure_docs_dirs()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    for path in (_DOCS_DIR / "claude-briefings").glob("*.json"):
        try:
            doc = _json.loads(path.read_text(encoding="utf-8"))
            if doc.get("created_at", "9999") < cutoff:
                doc["folder"] = "archived"
                archived_path = _DOCS_DIR / "archived" / path.name
                archived_path.write_text(_json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
                path.unlink()
        except Exception:
            pass


def _save_briefing_as_document(briefing: dict) -> None:
    """Persist a generated briefing to the document store (claude-briefings folder)."""
    _ensure_docs_dirs()
    try:
        gen_at   = briefing.get("generated_at", "")
        date_str = gen_at[:10] if len(gen_at) >= 10 else datetime.now(timezone.utc).strftime("%Y-%m-%d")
        doc_id   = f"briefing-{date_str}"
        doc = {
            "id":          doc_id,
            "title":       f"Daily Briefing — {date_str}",
            "folder":      "claude-briefings",
            "content":     briefing.get("content", ""),
            "created_at":  gen_at,
            "modified_at": gen_at,
            "read_only":   True,
            "metadata": {
                "model":                briefing.get("model", ""),
                "tokens_used":          briefing.get("tokens_used"),
                "valid_until":          briefing.get("valid_until", ""),
                "manually_regenerated": briefing.get("manually_regenerated", False),
            },
        }
        _persist_doc("claude-briefings", doc_id, doc)
        _auto_archive_old_briefings()
    except Exception as ex:
        print(f"[docs] failed to save briefing document: {ex}")


# ── Document CRUD endpoints ───────────────────────────────────────────────────
# NOTE: /api/documents/folders must be declared BEFORE /api/documents/{doc_id}

@app.get("/api/documents/folders")
def get_document_folders():
    """Return folder structure with document counts."""
    _ensure_docs_dirs()
    folders = []
    for fid in _STD_FOLDERS:
        docs = _list_docs_in_folder(fid)
        folders.append({"id": fid, "label": _FOLDER_LABELS[fid], "count": len(docs)})
    return {"folders": folders}


@app.get("/api/documents")
def list_documents(folder: str = Query(None), q: str = Query(None)):
    """List all documents (metadata only). Optional folder filter and search query."""
    _ensure_docs_dirs()
    target_folders = [folder] if folder and folder in _STD_FOLDERS else _STD_FOLDERS
    all_docs = []
    for fid in target_folders:
        all_docs.extend(_list_docs_in_folder(fid))
    if q:
        ql = q.lower()
        filtered = []
        for d in all_docs:
            if ql in d.get("title", "").lower():
                filtered.append(d)
                continue
            # Full content search — reload doc
            doc = _load_doc(d["folder"], d["id"])
            if doc and ql in doc.get("content", "").lower():
                filtered.append(d)
        all_docs = filtered
    all_docs.sort(key=lambda d: d.get("modified_at", ""), reverse=True)
    return {"documents": all_docs, "count": len(all_docs)}


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str, folder: str = Query(None)):
    """Get a single document including its content."""
    _ensure_docs_dirs()
    search_folders = [folder] if folder else _STD_FOLDERS
    for fid in search_folders:
        doc = _load_doc(fid, doc_id)
        if doc:
            return {"document": doc}
    raise HTTPException(status_code=404, detail="Document not found")


@app.post("/api/documents")
def create_document(body: dict = Body(...)):
    """Create a new document. Returns the created document."""
    _ensure_docs_dirs()
    import uuid as _uuid
    folder = body.get("folder", "my-documents")
    if folder not in _STD_FOLDERS or folder == "archived":
        folder = "my-documents"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc_id  = str(_uuid.uuid4())
    doc = {
        "id":          doc_id,
        "title":       (body.get("title") or "Untitled Document").strip(),
        "folder":      folder,
        "content":     body.get("content", ""),
        "created_at":  now_iso,
        "modified_at": now_iso,
        "read_only":   False,
        "metadata":    body.get("metadata", {}),
    }
    _persist_doc(folder, doc_id, doc)
    return {"document": doc}


@app.put("/api/documents/{doc_id}")
def update_document(doc_id: str, body: dict = Body(...)):
    """Update title and/or content of a document."""
    _ensure_docs_dirs()
    for fid in _STD_FOLDERS:
        doc = _load_doc(fid, doc_id)
        if doc:
            if doc.get("read_only"):
                raise HTTPException(status_code=403, detail="Document is read-only")
            if "title" in body:
                doc["title"] = (body["title"] or "Untitled Document").strip()
            if "content" in body:
                doc["content"] = body["content"]
            doc["modified_at"] = datetime.now(timezone.utc).isoformat()
            _persist_doc(fid, doc_id, doc)
            return {"document": _doc_summary(doc, doc_id, fid)}
    raise HTTPException(status_code=404, detail="Document not found")


@app.delete("/api/documents/{doc_id}")
def archive_document(doc_id: str):
    """Move a document to the Archived folder."""
    _ensure_docs_dirs()
    for fid in _STD_FOLDERS:
        if fid == "archived":
            continue
        src = _DOCS_DIR / fid / f"{doc_id}.json"
        if src.exists():
            try:
                doc = _json.loads(src.read_text(encoding="utf-8"))
                doc["folder"] = "archived"
                doc["modified_at"] = datetime.now(timezone.utc).isoformat()
                dst = _DOCS_DIR / "archived" / f"{doc_id}.json"
                dst.write_text(_json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
                src.unlink()
                return {"ok": True}
            except Exception as ex:
                raise HTTPException(status_code=500, detail=str(ex))
    raise HTTPException(status_code=404, detail="Document not found")


async def _daily_briefing_loop():
    """Fire briefing generation once daily at 08:00 UTC."""
    await asyncio.sleep(120)   # let pool + news settle on startup
    while True:
        now    = datetime.now(timezone.utc)
        target = now.replace(hour=8, minute=0, second=0, microsecond=0)
        if now >= target:
            target += timedelta(days=1)
        wait_secs = (target - now).total_seconds()
        print(f"[briefing] next daily generation in {wait_secs / 3600:.1f}h ({target.strftime('%Y-%m-%d %H:%M UTC')})")
        await asyncio.sleep(wait_secs)
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(_executor, lambda: _generate_briefing_sync(manual=False))
        except Exception as ex:
            print(f"[briefing] daily generation error: {ex}")


async def _startup_warmup_tasks():
    try:
        from database import migrate_db, init_db
        migrate_db()
        init_db()
        print("[startup] database initialised and admins seeded")
    except Exception as e:
        print(f"[startup] database init error: {e}")
    """Run slow cache/data warmups after the API is already accepting requests."""
    loop = asyncio.get_event_loop()

    try:
        if _geo_needs_refresh(_GEO_COUNTRIES_FILE):
            await asyncio.wait_for(
                loop.run_in_executor(
                    _executor,
                    lambda: _fetch_geo(_COUNTRIES_URL, _GEO_COUNTRIES_FILE, 0.04),
                ),
                timeout=70,
            )
        if _GEO_COUNTRIES_FILE.exists():
            print("[startup] countries.geojson cached")
    except Exception as ex:
        print(f"[startup] countries.geojson cache error: {ex}")

    try:
        await asyncio.wait_for(loop.run_in_executor(_executor, _ensure_airports), timeout=45)
        await asyncio.wait_for(loop.run_in_executor(_executor, _ensure_ports), timeout=75)
        await asyncio.wait_for(loop.run_in_executor(_executor, _ensure_powerplants), timeout=75)
        print("[startup] infrastructure CSVs loaded and _DS_STATUS updated (airports, ports, power plants all green)")
    except Exception as ex:
        print(f"[startup] infrastructure preload error: {ex}")

    # Start unified event bridge
    try:
        def get_news_store():
            return dict(_NEWS_ARTICLE_STORE)
        def get_conflict_markers():
            return list(_NEWS_CONFLICT_MARKERS)
        asyncio.create_task(event_bridge.bridge_loop(
            get_news_store, get_conflict_markers,
            save_path=os.path.join(DATA_DIR, "event_store.json"),
        ))
        print("[startup] unified event bridge started")
    except Exception as ex:
        print(f"[startup] event bridge error: {ex}")


# ══════════════════════════════════════════════════════════════════════════════
# AIS VESSEL TRACKING — aisstream.io WebSocket bridge
# Requires AISSTREAM_API_KEY in environment. Subscribes to focus-region bbox
# only; evicts positions older than 5 min; capped at 2000 vessels in memory.
# ══════════════════════════════════════════════════════════════════════════════

_AISSTREAM_KEY   = os.getenv("AISSTREAM_API_KEY", "")
_AIS_VESSELS:    dict = {}   # keyed by MMSI string
_AIS_LOCK        = threading.Lock()
_AIS_STATUS      = {"connected": False, "error": None, "vessel_count": 0, "last_msg": None, "last_poll": None}
_AIS_MSG_COUNTER = 0         # total messages received this connection
_AIS_LAST_LOG_T  = 0.0      # time of last periodic log

_AIS_BBOXES = [
    [[15, 45], [32, 65]],    # Persian Gulf / Arabian Sea
    [[10, 32], [30, 45]],    # Red Sea
    [[30, 20], [42, 42]],    # Eastern Mediterranean
    [[-15, 38], [12, 65]],   # East Africa / Indian Ocean
    [[-2, 98], [10, 108]],   # Strait of Malacca
]

_AIS_SHIP_TYPE_MAP = {
    # tankers 80-89
    **{i: "tanker" for i in range(80, 90)},
    # cargo 70-79
    **{i: "cargo" for i in range(70, 80)},
    # passenger 60-69
    **{i: "passenger" for i in range(60, 70)},
    # military 35
    35: "military",
    # pleasure craft 36-37
    36: "other", 37: "other",
    # high speed 40-49
    **{i: "other" for i in range(40, 50)},
}

def _ais_ship_type(type_code: int) -> str:
    return _AIS_SHIP_TYPE_MAP.get(type_code, "other")

async def _ais_websocket_loop():
    """Persistent WebSocket connection to aisstream.io. Reconnects on disconnect."""
    global _AIS_STATUS, _AIS_MSG_COUNTER, _AIS_LAST_LOG_T
    if not _AISSTREAM_KEY:
        _AIS_STATUS = {"connected": False, "error": "AISSTREAM_API_KEY not set", "vessel_count": 0, "last_msg": None}
        print("[ais] AISSTREAM_API_KEY not configured — live AIS disabled")
        return
    try:
        import websockets as _ws
    except ImportError:
        _AIS_STATUS = {"connected": False, "error": "websockets package not installed", "vessel_count": 0, "last_msg": None}
        print("[ais] websockets package not installed — pip install websockets")
        return

    subscribe_msg = _json.dumps({
        "APIKey": _AISSTREAM_KEY,
        "BoundingBoxes": _AIS_BBOXES,
        "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
    })
    AIS_URL = "wss://stream.aisstream.io/v0/stream"
    AIS_TTL = 300  # 5 minutes
    reconnect_delay = 5  # start short, back off on repeat failures

    while True:
        try:
            print(f"[ais] connecting to aisstream.io (bboxes: {len(_AIS_BBOXES)} regions) …")
            async with _ws.connect(AIS_URL, ping_interval=20, ping_timeout=15, open_timeout=15) as ws:
                await ws.send(subscribe_msg)
                _AIS_STATUS["connected"] = True
                _AIS_STATUS["error"]     = None
                _AIS_MSG_COUNTER = 0
                _AIS_LAST_LOG_T  = time.time()
                reconnect_delay  = 5  # reset backoff on successful connect
                print("[ais] connected and subscribed to aisstream.io")
                async for raw in ws:
                    try:
                        msg   = _json.loads(raw)
                        mtype = msg.get("MessageType", "")
                        meta  = msg.get("MetaData", {})
                        mmsi  = str(meta.get("MMSI", ""))
                        if not mmsi:
                            continue
                        now = time.time()
                        _AIS_MSG_COUNTER += 1
                        # Log throughput every 60 s
                        if now - _AIS_LAST_LOG_T >= 60:
                            print(f"[ais] {_AIS_MSG_COUNTER} msgs in last 60s — {len(_AIS_VESSELS)} vessels tracked")
                            _AIS_MSG_COUNTER = 0
                            _AIS_LAST_LOG_T  = now
                        with _AIS_LOCK:
                            vessel = _AIS_VESSELS.get(mmsi, {"mmsi": mmsi})
                            if mtype == "PositionReport":
                                pr = msg.get("Message", {}).get("PositionReport", {})
                                lat = pr.get("Latitude")
                                lon = pr.get("Longitude")
                                if lat is not None and lon is not None:
                                    vessel["lat"]         = float(lat)
                                    vessel["lon"]         = float(lon)
                                    vessel["heading"]     = pr.get("TrueHeading") or pr.get("Cog") or 0
                                    vessel["speed"]       = round(float(pr.get("Sog") or 0), 1)
                                    vessel["last_update"] = now
                                    if "ship_type_code" in vessel:
                                        vessel["ship_type"] = _ais_ship_type(vessel["ship_type_code"])
                            elif mtype == "ShipStaticData":
                                sd = msg.get("Message", {}).get("ShipStaticData", {})
                                vessel["name"]           = (sd.get("Name") or "").strip() or vessel.get("name","")
                                vessel["destination"]    = (sd.get("Destination") or "").strip()
                                vessel["ship_type_code"] = sd.get("Type") or 0
                                vessel["ship_type"]      = _ais_ship_type(sd.get("Type") or 0)
                                vessel["callsign"]       = (sd.get("CallSign") or "").strip()
                                vessel["last_update"]    = now
                            vessel["mmsi"] = mmsi
                            _AIS_VESSELS[mmsi] = vessel
                            # Cap at 2000, evict oldest
                            if len(_AIS_VESSELS) > 2000:
                                oldest = min(_AIS_VESSELS, key=lambda k: _AIS_VESSELS[k].get("last_update", 0))
                                del _AIS_VESSELS[oldest]
                        _AIS_STATUS["vessel_count"] = len(_AIS_VESSELS)
                        _AIS_STATUS["last_msg"]     = time.strftime("%H:%M:%S", time.gmtime())
                        _AIS_STATUS["last_poll"]    = datetime.now(timezone.utc).isoformat()
                    except Exception:
                        continue
        except Exception as ex:
            _AIS_STATUS["connected"] = False
            _AIS_STATUS["error"]     = str(ex)
            print(f"[ais] disconnected: {ex!r} — reconnecting in {reconnect_delay}s")
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 60)  # exponential backoff, cap 60s

        # Evict stale entries every reconnect cycle
        now = time.time()
        with _AIS_LOCK:
            stale = [k for k, v in _AIS_VESSELS.items() if now - v.get("last_update", 0) > AIS_TTL]
            for k in stale:
                del _AIS_VESSELS[k]


@app.get("/api/ais/vessels")
async def api_ais_vessels(bbox: str = Query(None, description="south,west,north,east")):
    """Return AIS vessel positions within bbox (or all if no bbox), capped at 500."""
    # Evict stale entries (older than 5 min)
    now = time.time()
    with _AIS_LOCK:
        stale = [k for k, v in _AIS_VESSELS.items() if now - v.get("last_update", 0) > 300]
        for k in stale:
            del _AIS_VESSELS[k]
        vessels = list(_AIS_VESSELS.values())

    if bbox:
        try:
            south, west, north, east = [float(x) for x in bbox.split(",")]
            vessels = [v for v in vessels
                       if v.get("lat") is not None and v.get("lon") is not None
                       and south <= v["lat"] <= north
                       and (west <= v["lon"] <= east if west <= east else (v["lon"] >= west or v["lon"] <= east))]
        except Exception:
            pass

    # Only return vessels with a known position
    vessels = [v for v in vessels if v.get("lat") is not None and v.get("lon") is not None]
    vessels = sorted(vessels, key=lambda v: v.get("last_update", 0), reverse=True)[:500]

    return {
        "vessels": vessels,
        "total":   len(vessels),
        "status":  _AIS_STATUS,
    }


@app.get("/api/ais/status")
async def api_ais_status():
    """Return AIS WebSocket connection status."""
    with _AIS_LOCK:
        count = len(_AIS_VESSELS)
    return {**_AIS_STATUS, "vessel_count": count, "key_configured": bool(_AISSTREAM_KEY)}


# ── Overwatch: satellite imagery object detection (ONNX — no torch/CUDA) ──────

_OW_DOTA_CLASSES = [
    "plane","ship","storage-tank","baseball-diamond","tennis-court",
    "basketball-court","ground-track-field","harbor","bridge",
    "large-vehicle","small-vehicle","helicopter","roundabout",
    "soccer-ball-field","swimming-pool",
]
_OW_COCO_CLASSES = [
    "person","bicycle","car","motorcycle","airplane","bus","train","truck","boat",
    "traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat",
    "dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack",
    "umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball",
    "kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket",
    "bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple",
    "sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair",
    "couch","potted plant","bed","dining table","toilet","tv","laptop","mouse",
    "remote","keyboard","cell phone","microwave","oven","toaster","sink",
    "refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush",
]

# Category / subcategory taxonomy for detections (frontend mirrors this)
_OW_CATEGORY_MAP = {
    "plane":              ("Aircraft",       "Fixed-Wing"),
    "airplane":           ("Aircraft",       "Fixed-Wing"),
    "helicopter":         ("Aircraft",       "Rotary-Wing"),
    "ship":               ("Vessel",         "Large Ship"),
    "boat":               ("Vessel",         "Small Vessel"),
    "harbor":             ("Infrastructure", "Port/Harbor"),
    "bridge":             ("Infrastructure", "Bridge"),
    "train":              ("Infrastructure", "Rail"),
    "large-vehicle":      ("Vehicle",        "Heavy Vehicle"),
    "large vehicle":      ("Vehicle",        "Heavy Vehicle"),
    "truck":              ("Vehicle",        "Heavy Vehicle"),
    "bus":                ("Vehicle",        "Heavy Vehicle"),
    "small-vehicle":      ("Vehicle",        "Light Vehicle"),
    "small vehicle":      ("Vehicle",        "Light Vehicle"),
    "car":                ("Vehicle",        "Light Vehicle"),
    "motorcycle":         ("Vehicle",        "Motorcycle"),
    "storage-tank":       ("Structure",      "Storage Tank"),
    "storage tank":       ("Structure",      "Storage Tank"),
    "roundabout":         ("Structure",      "Road Feature"),
    "baseball-diamond":   ("Facility",       "Sports"),
    "tennis-court":       ("Facility",       "Sports"),
    "basketball-court":   ("Facility",       "Sports"),
    "ground-track-field": ("Facility",       "Sports"),
    "soccer-ball-field":  ("Facility",       "Sports"),
    "swimming-pool":      ("Facility",       "Recreational"),
    # COCO extras
    "person":             ("Person",         "Pedestrian"),
    "bicycle":            ("Vehicle",        "Bicycle"),
}

# Two sessions — DOTA OBB (satellite, default) and COCO (fallback)
_ort_sessions     = {}
_ort_session_lock = threading.Lock()

def _get_ort_session(model_key="dota"):
    with _ort_session_lock:
        if model_key in _ort_sessions:
            return _ort_sessions[model_key]
        try:
            import onnxruntime as ort
            fname = "yolov8n-obb.onnx" if model_key == "dota" else "yolov8n.onnx"
            path  = str(BASE_DIR / fname)
            sess  = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
            _ort_sessions[model_key] = sess
            print(f"[overwatch] loaded {fname}")
        except Exception as e:
            print(f"[overwatch] session load failed ({model_key}): {e}")
            _ort_sessions[model_key] = None
        return _ort_sessions[model_key]

def _ow_nms(boxes, scores, iou_threshold):
    """Axis-aligned NMS. boxes: (N,4) xyxy. Returns list of kept indices."""
    import numpy as np
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
    order = scores.argsort()[::-1]
    keep  = []
    while order.size > 0:
        i = order[0]; keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]]); yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]]); yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou   = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        order = order[np.where(iou <= iou_threshold)[0] + 1]
    return keep

def _ow_obb_corners(cx, cy, w, h, angle):
    """Compute 4 corner points of a rotated box. All values in pixel space."""
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    hw, hh = w / 2, h / 2
    offsets = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    return [(cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a) for dx, dy in offsets]

def _ow_lat_to_tile_y_frac(lat, zoom):
    lat_rad = math.radians(lat)
    return (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * (2 ** zoom)

def _ow_lon_to_tile_x_frac(lon, zoom):
    return (lon + 180.0) / 360.0 * (2 ** zoom)

def _fetch_esri_tile(z, x, y):
    from PIL import Image
    url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 HorizonWatch/1.0"})
    with urllib.request.urlopen(req, timeout=12) as r:
        return Image.open(_io.BytesIO(r.read())).convert("RGB")

def _run_overwatch_inference(bounds, zoom, confidence, enhance=False, model_key="dota"):
    """Blocking: fetch Esri tiles, stitch, crop, run ONNX, return geo detections."""
    import concurrent.futures
    import numpy as np
    from PIL import Image

    north, south, east, west = bounds["north"], bounds["south"], bounds["east"], bounds["west"]
    TILE_SZ  = 256
    is_dota  = (model_key == "dota")
    INPUT_SZ = 1024 if is_dota else 640
    classes  = _OW_DOTA_CLASSES if is_dota else _OW_COCO_CLASSES

    # ── Tile fetch ────────────────────────────────────────────────────────────
    x_min = int(_ow_lon_to_tile_x_frac(west,  zoom))
    x_max = int(_ow_lon_to_tile_x_frac(east,  zoom))
    y_min = int(_ow_lat_to_tile_y_frac(north, zoom))
    y_max = int(_ow_lat_to_tile_y_frac(south, zoom))
    x_min, x_max = min(x_min, x_max), max(x_min, x_max)
    y_min, y_max = min(y_min, y_max), max(y_min, y_max)

    tile_count = (x_max - x_min + 1) * (y_max - y_min + 1)
    if tile_count > 10000:
        return {"error": f"Area too large ({tile_count} tiles). Draw a smaller region.", "count": 0, "detections": []}
    if tile_count > 1000:
        print(f"[overwatch] large area: {tile_count} tiles — this will take several minutes")

    stitch_w = (x_max - x_min + 1) * TILE_SZ
    stitch_h = (y_max - y_min + 1) * TILE_SZ
    stitched  = Image.new("RGB", (stitch_w, stitch_h))

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        futs = {pool.submit(_fetch_esri_tile, zoom, x, y): (x, y)
                for x in range(x_min, x_max + 1) for y in range(y_min, y_max + 1)}
        for fut, (x, y) in futs.items():
            try:
                stitched.paste(fut.result(timeout=15), ((x - x_min) * TILE_SZ, (y - y_min) * TILE_SZ))
            except Exception as e:
                print(f"[overwatch] tile {zoom}/{x}/{y} failed: {e}")

    def lon_to_px(lon): return (_ow_lon_to_tile_x_frac(lon, zoom) - x_min) * TILE_SZ
    def lat_to_py(lat): return (_ow_lat_to_tile_y_frac(lat, zoom) - y_min) * TILE_SZ

    cx1 = int(max(0, lon_to_px(west)));  cx2 = int(min(stitch_w, lon_to_px(east)))
    cy1 = int(max(0, lat_to_py(north))); cy2 = int(min(stitch_h, lat_to_py(south)))
    if cx2 <= cx1 or cy2 <= cy1:
        return {"error": "Crop region is empty — check bounds.", "count": 0, "detections": []}

    cropped = stitched.crop((cx1, cy1, cx2, cy2))
    img_w, img_h = cropped.size
    print(f"[overwatch] crop → {img_w}×{img_h}px zoom={zoom} model={model_key}")

    # ── Tiled ONNX inference (delegates to shared helper) ────────────────────
    result = _run_inference_on_image(cropped, bounds, confidence, enhance, model_key)
    import gc
    del stitched, cropped
    gc.collect()
    result["zoom_used"] = int(zoom)
    return result


def _run_inference_on_image(cropped, bounds, confidence, enhance=False, model_key="dota"):
    """Run tiled ONNX inference on a PIL Image cropped to `bounds`. Returns detection dict."""
    import numpy as np
    from PIL import Image

    is_dota  = (model_key == "dota")
    INPUT_SZ = 1024 if is_dota else 640
    classes  = _OW_DOTA_CLASSES if is_dota else _OW_COCO_CLASSES

    north, south, east, west = bounds["north"], bounds["south"], bounds["east"], bounds["west"]
    img_w, img_h = cropped.size

    session = _get_ort_session(model_key)
    if session is None:
        return {"error": f"ONNX session unavailable (model={model_key})", "count": 0, "detections": []}

    n_cls   = len(classes)
    OVERLAP = 100
    STRIDE  = INPUT_SZ - OVERLAP

    def _tile_starts(dim):
        if dim <= INPUT_SZ:
            return [0]
        starts = list(range(0, dim - INPUT_SZ, STRIDE))
        if starts[-1] + INPUT_SZ < dim:
            starts.append(dim - INPUT_SZ)
        return starts

    xs_starts = _tile_starts(img_w)
    ys_starts = _tile_starts(img_h)
    print(f"[overwatch] tiled: {len(xs_starts)}×{len(ys_starts)}={len(xs_starts)*len(ys_starts)} inference tiles on {img_w}×{img_h}px")

    # pixel → geo helpers (full cropped image coordinate space)
    def px_lat(py): return float(north - (py / img_h) * (north - south))
    def px_lon(px): return float(west  + (px / img_w) * (east  - west))

    def _unpad(v, pad, sc, lim):
        return float(min(max((v - pad) / sc, 0.0), lim))

    all_aa_boxes   = []   # [x1,y1,x2,y2] in full-image pixels — for NMS
    all_scores     = []
    all_class_ids  = []
    all_corners_px = []   # list of [(x,y)×4] in full-image pixels — for geo conversion

    for ty in ys_starts:
        for tx in xs_starts:
            tw = min(INPUT_SZ, img_w - tx)
            th = min(INPUT_SZ, img_h - ty)
            tile = cropped.crop((tx, ty, tx + tw, ty + th))

            sc_t = min(INPUT_SZ / tw, INPUT_SZ / th)
            nw_t = int(tw * sc_t); nh_t = int(th * sc_t)
            px_t = (INPUT_SZ - nw_t) // 2; py_t = (INPUT_SZ - nh_t) // 2
            pad_tile = Image.new("RGB", (INPUT_SZ, INPUT_SZ), (114, 114, 114))
            pad_tile.paste(tile.resize((nw_t, nh_t), Image.BILINEAR), (px_t, py_t))

            arr_t = np.array(pad_tile, dtype=np.float32) / 255.0
            arr_t = np.transpose(arr_t, (2, 0, 1))[np.newaxis]
            del pad_tile, tile

            try:
                raw_t = session.run(None, {session.get_inputs()[0].name: arr_t})[0]
            except Exception as e:
                print(f"[overwatch] tile ({tx},{ty}) failed: {e}")
                del arr_t
                continue
            del arr_t

            pr_t = raw_t[0].T
            del raw_t
            if is_dota:
                bxy_t = pr_t[:, :4]; sc_cls = pr_t[:, 4:19]; ang_t = pr_t[:, 19]
            else:
                bxy_t = pr_t[:, :4]; sc_cls = pr_t[:, 4:]; ang_t = np.zeros(len(pr_t))

            ms_t = sc_cls.max(axis=1); ci_t = sc_cls.argmax(axis=1)
            ok   = ms_t > confidence
            if not ok.any():
                del pr_t
                continue

            bxy_ok = bxy_t[ok]; ms_ok = ms_t[ok]; ci_ok = ci_t[ok]; ang_ok = ang_t[ok]
            del pr_t

            for i in range(len(bxy_ok)):
                cx_p, cy_p, w_p, h_p = bxy_ok[i]
                angle = float(ang_ok[i])
                if is_dota:
                    pts_lb = _ow_obb_corners(cx_p, cy_p, w_p, h_p, angle)
                    corners_full = [
                        (_unpad(p[0], px_t, sc_t, tw) + tx,
                         _unpad(p[1], py_t, sc_t, th) + ty)
                        for p in pts_lb
                    ]
                    xs_f = [p[0] for p in corners_full]
                    ys_f = [p[1] for p in corners_full]
                    aa   = [min(xs_f), min(ys_f), max(xs_f), max(ys_f)]
                else:
                    x1_f = _unpad(cx_p - w_p/2, px_t, sc_t, tw) + tx
                    y1_f = _unpad(cy_p - h_p/2, py_t, sc_t, th) + ty
                    x2_f = _unpad(cx_p + w_p/2, px_t, sc_t, tw) + tx
                    y2_f = _unpad(cy_p + h_p/2, py_t, sc_t, th) + ty
                    aa   = [x1_f, y1_f, x2_f, y2_f]
                    corners_full = [(x1_f, y1_f), (x2_f, y1_f), (x2_f, y2_f), (x1_f, y2_f)]
                all_aa_boxes.append(aa)
                all_scores.append(float(ms_ok[i]))
                all_class_ids.append(int(ci_ok[i]))
                all_corners_px.append(corners_full)

    # ── Global NMS across all tiles ───────────────────────────────────────────
    detections = []
    if all_aa_boxes:
        aa_arr = np.array(all_aa_boxes, dtype=np.float32)
        sc_arr = np.array(all_scores,   dtype=np.float32)

        for idx in _ow_nms(aa_arr, sc_arr, 0.45):
            cls_id  = all_class_ids[idx]
            conf    = round(all_scores[idx], 3)
            corners = all_corners_px[idx]
            xs_f    = [p[0] for p in corners]
            ys_f    = [p[1] for p in corners]
            corners_geo = [[px_lat(y), px_lon(x)] for x, y in corners]
            center_geo  = [px_lat(sum(ys_f) / 4), px_lon(sum(xs_f) / 4)]
            px_box      = [min(xs_f), min(ys_f), max(xs_f), max(ys_f)]

            cls_name = classes[cls_id] if cls_id < n_cls else "unknown"
            cat, subcat = _OW_CATEGORY_MAP.get(cls_name, ("Object", "Unknown"))
            detections.append({
                "class":       cls_name,
                "category":    cat,
                "subcategory": subcat,
                "confidence":  conf,
                "center":      center_geo,
                "corners":     corners_geo,
                "_px":         px_box,
            })

    # ── Optional Claude enhance pass ──────────────────────────────────────────
    if enhance and detections:
        import base64 as _b64
        _ant_key = os.getenv("ANTHROPIC_API_KEY")
        if _ant_key:
            try:
                _ant = anthropic.Anthropic(api_key=_ant_key)
                for det in detections[:10]:
                    x1, y1, x2, y2 = det.pop("_px")
                    pad = 20
                    crop_obj = cropped.crop((max(0, int(x1)-pad), max(0, int(y1)-pad),
                                            min(img_w, int(x2)+pad), min(img_h, int(y2)+pad)))
                    buf = _io.BytesIO(); crop_obj.save(buf, format="PNG")
                    crop_b64 = _b64.b64encode(buf.getvalue()).decode()
                    try:
                        resp = _ant.messages.create(
                            model="claude-sonnet-4-6", max_tokens=80,
                            messages=[{"role": "user", "content": [
                                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": crop_b64}},
                                {"type": "text", "text": f"YOLO detected '{det['class']}' in satellite imagery. Give specific type. Reply ONLY with JSON: {{\"specific_type\": \"...\"}}"},
                            ]}],
                        )
                        det["specific_type"] = _json.loads(resp.content[0].text).get("specific_type", det["class"])
                    except Exception as e_cls:
                        print(f"[overwatch] classify error: {e_cls}")
                for det in detections[10:]:
                    det.pop("_px", None)
            except Exception as e_enh:
                print(f"[overwatch] enhance error: {e_enh}")
                for det in detections: det.pop("_px", None)
        else:
            for det in detections: det.pop("_px", None)
    else:
        for det in detections: det.pop("_px", None)

    print(f"[overwatch] {len(detections)} detections (model={model_key}, conf≥{confidence})")

    # Free memory explicitly
    import gc
    del all_aa_boxes, all_corners_px, all_scores, all_class_ids
    gc.collect()

    return {
        "detections": detections,
        "count":      len(detections),
        "model":      f"onnx-{model_key}",
        "enhanced":   bool(enhance),
    }

@app.post("/api/overwatch/detect")
async def overwatch_detect(request: Request):
    """Fetch Esri satellite tiles, run ONNX YOLOv8 (DOTA OBB default), return geo detections."""
    try:
        body       = await request.json()
        bounds     = body.get("bounds")
        zoom       = int(body.get("zoom", 15))
        confidence = float(body.get("confidence", 0.15))   # lower default for aerial
        enhance    = bool(body.get("enhance", False))
        model_key  = "coco" if body.get("model") == "coco" else "dota"
        if not bounds or not all(k in bounds for k in ("north", "south", "east", "west")):
            return JSONResponse({"error": "bounds {north,south,east,west} required", "count": 0, "detections": []})
        zoom = max(10, min(zoom, 18))
        import functools
        loop   = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, functools.partial(_run_overwatch_inference, bounds, zoom, confidence, enhance, model_key)
        )
        return JSONResponse(result)
    except Exception as e:
        print(f"[overwatch] endpoint error: {e}")
        return JSONResponse({"error": str(e), "count": 0, "detections": []})


@app.post("/api/overwatch/detect-image")
async def overwatch_detect_image(request: Request):
    """Run ONNX inference on a caller-supplied base64 PNG (e.g. Sentinel-2 image)."""
    import base64 as _b64
    import functools
    try:
        body       = await request.json()
        image_b64  = body.get("image", "")
        bounds     = body.get("bounds")
        confidence = float(body.get("confidence", 0.15))
        enhance    = bool(body.get("enhance", False))
        model_key  = "coco" if body.get("model") == "coco" else "dota"

        if not image_b64 or not bounds or not all(k in bounds for k in ("north", "south", "east", "west")):
            return JSONResponse({"error": "image (base64) and bounds {north,south,east,west} required", "count": 0, "detections": []})

        # Strip optional data-URL prefix
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]

        from PIL import Image
        img_bytes = _b64.b64decode(image_b64)
        cropped   = Image.open(_io.BytesIO(img_bytes)).convert("RGB")
        print(f"[overwatch/detect-image] {cropped.size[0]}×{cropped.size[1]}px model={model_key} conf={confidence}")

        loop   = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, functools.partial(_run_inference_on_image, cropped, bounds, confidence, enhance, model_key)
        )
        result["zoom_used"] = None   # no tile zoom — image supplied directly
        return JSONResponse(result)
    except Exception as e:
        print(f"[overwatch/detect-image] error: {e}")
        return JSONResponse({"error": str(e), "count": 0, "detections": []})


@app.post("/api/overwatch/analyze")
async def overwatch_analyze(request: Request):
    """Claude intelligence assessment of Overwatch detection results."""
    try:
        body       = await request.json()
        detections = body.get("detections", [])
        bounds     = body.get("bounds", {})
        if not detections:
            return JSONResponse({"error": "No detections to analyze"})
        # Summarise by specific_type > class
        summary: dict = {}
        for d in detections:
            cls = d.get("specific_type") or d.get("class", "unknown")
            summary[cls] = summary.get(cls, 0) + 1
        center_lat = (bounds.get("north", 0) + bounds.get("south", 0)) / 2
        center_lon = (bounds.get("east", 0)  + bounds.get("west", 0))  / 2
        prompt = f"""You are a senior geospatial intelligence analyst. Analyze the following satellite imagery detection results.

Location: approximately {center_lat:.4f}°N, {center_lon:.4f}°E

Objects detected:
{_json.dumps(summary, indent=2)}

Total: {len(detections)} objects

Provide a concise intelligence assessment:
1. What facility/area is this likely to be? (airport, port, military base, industrial zone, etc.)
2. What is the operational significance of what we see?
3. Any notable observations (unusual concentrations, military assets, strategic implications)?
4. If near known conflict zones or chokepoints, what is the relevance?

Write in intelligence briefing style — 3–4 paragraphs maximum."""

        client = anthropic.Anthropic()
        resp   = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
        return JSONResponse({"analysis": resp.content[0].text, "summary": summary})
    except Exception as e:
        print(f"[overwatch/analyze] error: {e}")
        return JSONResponse({"error": str(e)})


@app.on_event("startup")
async def startup_event():
    global _BRIEFING_STORE
    print(f"[startup] *** HORIZON WATCH STARTING — env='{os.getenv('RAILWAY_ENVIRONMENT','local')}' DATA_DIR={DATA_DIR} ***")
    # Initialise response cache
    if _HAS_RESPONSE_CACHE:
        FastAPICache.init(InMemoryBackend())
        print("[startup] fastapi-cache2 response cache initialised")
    # Load persisted event store
    try:
        es.load_from_disk(os.path.join(DATA_DIR, "event_store.json"))
    except Exception as _e:
        print(f"[startup] event store load error: {_e}")
    # Initialise user database
    try:
        from database import init_db
        init_db()
        print("[startup] database initialised")
    except Exception as _e:
        print(f"[startup] database init failed: {_e}")
    print("[startup] classifier.py loaded")
    print("[startup] significance scorer initialised")
    print("[startup] prefetch cache initialised")

    # Ensure document directories exist
    _ensure_docs_dirs()

    # Load persisted briefing history
    with _BRIEFING_LOCK:
        _BRIEFING_STORE = _load_briefing_store()
    print(f"[startup] loaded {len(_BRIEFING_STORE)} briefing(s) from disk")

    asyncio.create_task(_extract_news_conflicts_loop())
    asyncio.create_task(_background_news_geocode_loop())
    asyncio.create_task(_surface_pool_loop())
    asyncio.create_task(_daily_briefing_loop())
    asyncio.create_task(_oref_loop())
    asyncio.create_task(_usgs_loop())
    asyncio.create_task(_gdacs_loop())
    asyncio.create_task(_geo_refresh_loop())
    asyncio.create_task(_startup_warmup_tasks())
    asyncio.create_task(_ais_websocket_loop())
    spacy_mode = "spaCy NER" if _HAS_SPACY else "keyword fallback"
    print(f"[startup] All background tasks started ({spacy_mode}). feeds={len(_SCAN_FEEDS)} executor_workers=4")


# ── Pikud HaOref (Israel missile alerts) ─────────────────────────────────────

async def _oref_loop():
    global _OREF_SEEN_IDS, _OREF_FAILURES, _OREF_SUSPENDED
    url  = "https://www.oref.org.il/WarningMessages/History/AlertsHistory.json"
    loop = asyncio.get_event_loop()
    # Seed seen IDs from first fetch — don't treat existing history as new
    seeded = False
    while True:
        if _OREF_SUSPENDED:
            return
        try:
            def _fetch_oref():
                req = urllib.request.Request(url, headers={
                    "User-Agent":       "Mozilla/5.0",
                    "Referer":          "https://www.oref.org.il/",
                    "X-Requested-With": "XMLHttpRequest",
                })
                with urllib.request.urlopen(req, timeout=10) as r:
                    return r.read().decode("utf-8-sig")
            raw    = await loop.run_in_executor(_executor, _fetch_oref)
            alerts = _json.loads(raw) if raw.strip() else []
            if not isinstance(alerts, list):
                alerts = []
            for alert in alerts:
                alert_date = str(alert.get("alertDate") or "")
                areas      = alert.get("data") or []
                if not areas:
                    continue
                first_area = areas[0] if isinstance(areas[0], str) else str(areas[0])
                uid        = f"{alert_date}_{first_area}"
                if not seeded:
                    _OREF_SEEN_IDS.add(uid)
                    continue
                if uid in _OREF_SEEN_IDS:
                    continue
                _OREF_SEEN_IDS.add(uid)
                if len(_OREF_SEEN_IDS) > 2000:
                    _OREF_SEEN_IDS = set(list(_OREF_SEEN_IDS)[-1000:])
                title = str(alert.get("title") or "Missile / Rocket Alert")
                # Geocode — try Nominatim for the area name
                geo = geocode_place(first_area + ", Israel")
                lat = float(geo["lat"]) if geo else 31.5
                lon = float(geo["lon"]) if geo else 34.8
                event_id = f"oref_{uid}".replace(" ", "_")[:80]
                _push_real_time_alert({
                    "id":            event_id,
                    "type":          "missile_warning",
                    "event_type":    "missile_warning",
                    "severity_tier": "critical",
                    "headline":      title,
                    "location":      f"{first_area}, Israel",
                    "lat":           lat,
                    "lon":           lon,
                    "source":        "IL-HFC",
                    "date":          alert_date,
                    "areas":         areas,
                    "priority":      True,
                })
                print(f"[oref] NEW missile warning: {title} — {first_area}")
            seeded = True
            with _DS_STATUS_LOCK:
                _DS_STATUS["oref"]["last_poll"] = datetime.now(timezone.utc).isoformat()
                _DS_STATUS["oref"]["failures"]  = 0
                _DS_STATUS["oref"]["suspended"] = False
            _OREF_FAILURES = 0
        except Exception as ex:
            print(f"[oref] fetch error: {ex}")
            seeded = True   # don't block seeding on error
            _OREF_FAILURES += 1
            with _DS_STATUS_LOCK:
                _DS_STATUS["oref"]["failures"] = _OREF_FAILURES
                _DS_STATUS["oref"]["suspended"] = _OREF_FAILURES >= _OREF_MAX_FAILURES
            if _OREF_FAILURES >= _OREF_MAX_FAILURES:
                _OREF_SUSPENDED = True
                print("[oref] geo-blocked — polling suspended permanently after 10 failures")
                return
        await asyncio.sleep(20)


# ── USGS earthquake feed ──────────────────────────────────────────────────────

async def _usgs_loop():
    global _USGS_SEEN_IDS
    url  = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson"
    loop = asyncio.get_event_loop()
    seeded = False
    while True:
        try:
            def _fetch_usgs():
                with urllib.request.urlopen(url, timeout=15) as r:
                    return r.read().decode()
            raw      = await loop.run_in_executor(_executor, _fetch_usgs)
            data     = _json.loads(raw)
            features = data.get("features", [])
            for feat in features:
                fid = feat.get("id", "")
                if not seeded:
                    _USGS_SEEN_IDS.add(fid)
                    continue
                if fid in _USGS_SEEN_IDS:
                    continue
                props  = feat.get("properties", {})
                coords = feat.get("geometry", {}).get("coordinates", [0, 0, 0])
                lon    = float(coords[0])
                lat    = float(coords[1])
                mag    = float(props.get("mag") or 0)
                place  = str(props.get("place") or "Unknown")
                # Filter: M>=5.0 always; M>=4.5 only if infra within 500 km
                if mag < 4.5:
                    _USGS_SEEN_IDS.add(fid)
                    continue
                nearby_500 = _nearest_infra(lat, lon, 500.0)
                if mag < 5.0 and not nearby_500:
                    _USGS_SEEN_IDS.add(fid)
                    continue
                _USGS_SEEN_IDS.add(fid)
                if len(_USGS_SEEN_IDS) > 2000:
                    _USGS_SEEN_IDS = set(list(_USGS_SEEN_IDS)[-1000:])
                nearby_150 = _nearest_infra(lat, lon, 150.0)
                tier       = "critical" if mag >= 7.0 else "significant" if mag >= 6.0 else "elevated"
                headline   = f"M{mag:.1f} earthquake — {place}"
                context    = (f"Nearest infrastructure: {nearby_150[0]['name']} ({nearby_150[0]['distance_km']}km)"
                              if nearby_150 else "")
                event_time = props.get("time") or 0
                event_iso  = (datetime.fromtimestamp(event_time / 1000, tz=timezone.utc).isoformat()
                              if event_time else "")
                _push_real_time_alert({
                    "id":            f"usgs_{fid}",
                    "type":          "earthquake",
                    "event_type":    "earthquake",
                    "severity_tier": tier,
                    "headline":      headline,
                    "location":      place,
                    "lat":           lat,
                    "lon":           lon,
                    "source":        "USGS",
                    "date":          event_iso,
                    "magnitude":     mag,
                    "context":       context,
                    "nearby_infra":  nearby_150,
                    "priority":      mag >= 5.5 or bool(nearby_150),
                })
                print(f"[usgs] NEW earthquake: {headline}")
            seeded = True
            with _DS_STATUS_LOCK:
                _DS_STATUS["usgs"]["last_poll"]  = datetime.now(timezone.utc).isoformat()
                _DS_STATUS["usgs"]["failures"]   = 0
        except Exception as ex:
            print(f"[usgs] fetch error: {ex}")
            seeded = True
            with _DS_STATUS_LOCK:
                _DS_STATUS["usgs"]["failures"] = _DS_STATUS["usgs"].get("failures", 0) + 1
        await asyncio.sleep(60)


# ── GDACS natural hazards ─────────────────────────────────────────────────────

async def _gdacs_loop():
    global _GDACS_SEEN_GUIDS
    url  = "https://www.gdacs.org/xml/rss.xml"
    loop = asyncio.get_event_loop()
    seeded = False
    _TYPE_MAP = {"eq": "earthquake", "tc": "cyclone", "fl": "flood", "vo": "volcano"}
    while True:
        try:
            def _fetch_gdacs():
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    return r.read().decode("utf-8", errors="replace")
            raw  = await loop.run_in_executor(_executor, _fetch_gdacs)
            feed = feedparser.parse(raw)
            for entry in feed.entries:
                guid = (entry.get("id") or entry.get("guid") or
                        entry.get("link") or entry.get("title") or "")
                if not seeded:
                    _GDACS_SEEN_GUIDS.add(guid)
                    continue
                if guid in _GDACS_SEEN_GUIDS:
                    continue
                alert_level = (
                    entry.get("gdacs_alertlevel") or
                    entry.get("alertlevel") or ""
                ).lower().strip()
                event_type_raw = (
                    entry.get("gdacs_eventtype") or
                    entry.get("eventtype") or ""
                ).lower().strip()
                title = str(entry.get("title") or "")
                # Only orange / red alerts get real-time push
                if alert_level not in ("orange", "red"):
                    _GDACS_SEEN_GUIDS.add(guid)
                    continue
                _GDACS_SEEN_GUIDS.add(guid)
                if len(_GDACS_SEEN_GUIDS) > 2000:
                    _GDACS_SEEN_GUIDS = set(list(_GDACS_SEEN_GUIDS)[-1000:])
                try:
                    lat = float(entry.get("gdacs_latitude") or entry.get("geo_lat") or 0)
                    lon = float(entry.get("gdacs_longitude") or entry.get("geo_long") or 0)
                except Exception:
                    lat, lon = 0.0, 0.0
                ev_type  = _TYPE_MAP.get(event_type_raw, event_type_raw or "natural_hazard")
                tier     = "critical" if alert_level == "red" else "significant"
                safe_guid = re.sub(r"[^a-zA-Z0-9_-]", "_", guid)[-60:]
                _push_real_time_alert({
                    "id":            f"gdacs_{safe_guid}",
                    "type":          ev_type,
                    "event_type":    ev_type,
                    "severity_tier": tier,
                    "headline":      title,
                    "location":      str(entry.get("gdacs_country") or "Unknown"),
                    "lat":           lat,
                    "lon":           lon,
                    "source":        "GDACS",
                    "date":          str(entry.get("published") or ""),
                    "alert_level":   alert_level,
                    "priority":      True,
                })
                print(f"[gdacs] NEW {alert_level} alert: {title}")
            seeded = True
            with _DS_STATUS_LOCK:
                _DS_STATUS["gdacs"]["last_poll"] = datetime.now(timezone.utc).isoformat()
                _DS_STATUS["gdacs"]["failures"]  = 0
        except Exception as ex:
            print(f"[gdacs] fetch error: {ex}")
            seeded = True
            with _DS_STATUS_LOCK:
                _DS_STATUS["gdacs"]["failures"] = _DS_STATUS["gdacs"].get("failures", 0) + 1
        await asyncio.sleep(300)



@app.get("/api/alerts/new")
def get_new_alerts(since: str = Query(None)):
    """Return real-time alerts pushed after the given ISO timestamp.
    If `since` is omitted, return the last 20 alerts."""
    with _ALERTS_QUEUE_LOCK:
        queue = list(_ALERTS_QUEUE)
    if not since:
        return {"alerts": queue[-20:], "count": len(queue[-20:])}
    try:
        since_ts = datetime.fromisoformat(since.replace("Z", "+00:00")).timestamp()
    except Exception:
        since_ts = 0.0
    new_alerts = [a for a in queue if _parse_iso_ts(a.get("pushed_at", "")) > since_ts]
    return {"alerts": new_alerts, "count": len(new_alerts)}


@app.get("/api/surface")
def get_surface_pool():
    """Return the current ranked surface pool (top 15 scored items), with any auto-briefs attached."""
    started = time.perf_counter()
    with _SURFACE_POOL_LOCK:
        pool    = list(_SURFACE_POOL)
        updated = _SURFACE_POOL_UPDATED_AT
    if not pool:
        pool = _refresh_surface_pool_sync("api-empty")
        with _SURFACE_POOL_LOCK:
            updated = _SURFACE_POOL_UPDATED_AT
    # Attach auto-briefs inline — no extra round-trip needed
    t_attach = time.perf_counter()
    with _AUTO_BRIEF_LOCK:
        enriched = []
        for item in pool:
            entry = _AUTO_BRIEF_STORE.get(item.get("id", ""))
            if entry:
                item = {**item, "auto_brief": entry["brief"], "auto_brief_at": entry["generated_at"]}
            enriched.append(item)
    attach_ms = (time.perf_counter() - t_attach) * 1000
    total_ms = (time.perf_counter() - started) * 1000
    payload_bytes = len(_json.dumps(enriched, ensure_ascii=False).encode("utf-8"))
    print(f"[surface/api] count={len(enriched)} attach_ms={attach_ms:.1f} total_ms={total_ms:.1f} payload={payload_bytes}B")
    return {
        "items": enriched,
        "updated_at": updated,
        "count": len(enriched),
        "diagnostics": {
            "attach_ms": round(attach_ms, 1),
            "fetch_ms": round(total_ms, 1),
            "payload_bytes": payload_bytes,
        },
    }


def _get_surface_item(event_id: str) -> dict | None:
    with _SURFACE_POOL_LOCK:
        for item in _SURFACE_POOL:
            if str(item.get("id")) == str(event_id):
                return dict(item)
    return None


@app.get("/api/events/{event_id}/context")
def get_event_context(event_id: str):
    item = _get_surface_item(event_id)
    if not item:
        raise HTTPException(404, "Event not found")

    now = time_module.time()
    with _PREFETCH_LOCK:
        cached = _PREFETCH_CACHE.get(event_id)
        if cached and (now - cached["fetched_at"]) < cached["ttl"]:
            return {"event_id": event_id, "infra_nodes": cached["infra_nodes"], "cached": True}

    nodes = _prefetch_event_infra(item)
    return {"event_id": event_id, "infra_nodes": nodes, "cached": False}


@app.get("/api/events/{event_id}/enrichment")
def get_event_enrichment(event_id: str):
    now = time_module.time()
    with _ENRICHMENT_LOCK:
        cached = _ENRICHMENT_CACHE.get(event_id)
        if cached and (now - cached["fetched_at"]) < cached["ttl"]:
            return {**cached, "cached": True}
    return None


@app.post("/api/events/{event_id}/enrich")
async def enrich_event(event_id: str, body: dict = Body(default={})):
    item = _get_surface_item(event_id)
    if not item:
        raise HTTPException(404, "Event not found")
    if not client:
        raise HTTPException(503, "Claude client not configured")

    # Budget cap check
    stats = usage_tracker.get_stats(CLAUDE_BUDGET_USD)
    if float(stats.get("budget_remaining_usd", 0)) <= 0:
        return {"error": "Claude budget cap reached"}

    now = time_module.time()
    with _ENRICHMENT_LOCK:
        cached = _ENRICHMENT_CACHE.get(event_id)
        if cached and (now - cached["fetched_at"]) < cached["ttl"]:
            return {**cached, "cached": True}

    profile = body.get("profile") or _ACTIVE_PROFILE
    pre_infra = _PREFETCH_CACHE.get(event_id, {}).get("infra_nodes", [])
    if not pre_infra:
        pre_infra = _prefetch_event_infra(item)

    prompt = _build_enrichment_prompt(item, pre_infra, profile)
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=700,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text if resp.content else ""
        usage_tracker.record_call(
            resp.usage.input_tokens,
            resp.usage.output_tokens,
            call_type="user_enrichment",
            headline=str(item.get("headline", ""))[:80],
        )
        enrichment, prose = _parse_enrichment_response(raw)
        with _ENRICHMENT_LOCK:
            _ENRICHMENT_CACHE[event_id] = {
                "enrichment": enrichment,
                "prose":      prose,
                "auto":       False,
                "fetched_at": now,
                "ttl":        21600,
            }
        return {**_ENRICHMENT_CACHE[event_id], "cached": False}
    except Exception as ex:
        return {"error": f"{type(ex).__name__}: {ex}"}


@app.post("/api/surface/refresh")
async def force_surface_refresh():
    """Force an immediate rebuild of the surface pool. Useful after profile saves or news ingestion."""
    loop     = asyncio.get_event_loop()
    new_pool = await loop.run_in_executor(_executor, _refresh_surface_pool_sync, "manual")
    with _SURFACE_POOL_LOCK:
        updated = _SURFACE_POOL_UPDATED_AT
    if new_pool:
        asyncio.create_task(_run_auto_cluster_briefs(new_pool))
        loop.run_in_executor(_executor, _maybe_auto_enrich_batch, new_pool)
    return {"ok": True, "count": len(new_pool), "updated_at": updated}


@app.post("/api/surface/analyse")
async def analyse_surface_item(payload: dict):
    """Analyse a surface pool item via Claude; dispatches to existing analyse endpoints."""
    item      = payload.get("item", {})
    profile   = payload.get("profile", None)
    contextual = bool(payload.get("contextual", True))

    if item.get("source_type") == "news_event":
        marker = item.get("marker") or item
        return await analyse_news_marker({
            "marker":     marker,
            "contextual": contextual,
            "profile":    profile,
        })
    else:
        # Conflict zone — synthesise an event object for the /analyse pipeline
        event = {
            "id":          item.get("id"),
            "date":        (item.get("published_at") or "")[:10],
            "type":        "Conflict Cluster",
            "subtype":     "News",
            "actor":       "Multiple actors",
            "location":    item.get("location", "Unknown"),
            "lat":         item.get("lat"),
            "lng":         item.get("lon"),
            "fatalities":  0,
            "description": (
                f"{item.get('count', 'Multiple')} conflict incidents near "
                f"{item.get('location', 'Unknown')} in the past 72 hours. "
                f"Average Goldstein severity: {item.get('avg_goldstein', 'N/A')}. "
                f"Intensity: {item.get('intensity', 'N/A')}. "
                f"{item.get('context', '')}"
            ),
        }
        return await analyse_event({
            "event":      event,
            "contextual": contextual,
            "profile":    profile,
        })


@app.get("/news-conflicts")
@_response_cache(expire=120)
def get_news_conflicts(
    south: float = Query(None),
    west:  float = Query(None),
    north: float = Query(None),
    east:  float = Query(None),
):
    """Return active (non-expired) news-derived conflict markers, scored and
    filtered by the active Mission Profile.
    If south/west/north/east are provided, filter to that bbox only.
    Omit bbox to get all markers (used for the global count badge).
    """
    cutoff  = (datetime.now(timezone.utc) - timedelta(hours=_NEWS_MARKER_WINDOW_HOURS)).isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()
    active  = [
        m for m in _NEWS_CONFLICT_MARKERS
        if m.get("expires_at", "") > now_iso and m.get("published", "") >= cutoff
    ]
    if None not in (south, west, north, east):
        active = [m for m in active
                  if south <= m["lat"] <= north and west <= m["lon"] <= east]

    # Score without score-threshold filter (so low-scoring but geolocated markers still show)
    scored = score_news_markers(active, _ACTIVE_PROFILE, apply_filter=False)
    # Apply geo gate manually so theater/region filter still works
    if _ACTIVE_PROFILE and _ACTIVE_PROFILE.get("focusRegions") and "Global" not in _ACTIVE_PROFILE.get("focusRegions", []):
        scored = [m for m in scored if geo_gate_passes(float(m.get("lat", 0)), float(m.get("lon", 0)), _ACTIVE_PROFILE)]
    return {"markers": scored, "count": len(scored)}


@app.get("/news-geocoded")
def get_news_geocoded():
    """
    Compatibility-safe endpoint returning a balanced global marker set.
    Keeps existing object shape and adds additive stats fields.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=_NEWS_MARKER_WINDOW_HOURS)).isoformat()
    with _NEWS_STORE_LOCK:
        recent = [a for a in _NEWS_ARTICLE_STORE.values() if a.get("published", "") >= cutoff]
    markers, counts_by_region = _build_marker_set(recent, per_region=150, max_total=900)
    return {"articles": markers, "count": len(markers), "counts_by_region": counts_by_region}


@app.get("/debug/news-geo-status")
def debug_news_geo_status():
    """
    Report current in-memory geocoding state without triggering any new geocoding.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=_NEWS_WINDOW_HOURS)).isoformat()
    with _NEWS_STORE_LOCK:
        recent = [a for a in _NEWS_ARTICLE_STORE.values() if a.get("published", "") >= cutoff]

    geocoded = [a for a in recent if a.get("lat") is not None and a.get("lon") is not None]
    non_geocoded = [a for a in recent if a.get("lat") is None or a.get("lon") is None]

    sample_geocoded = [
        {
            "title": a.get("title", ""),
            "lat": a.get("lat"),
            "lon": a.get("lon"),
            "location_name": a.get("location_name"),
            "location_confidence": a.get("location_confidence"),
            "resolved_country_code": a.get("resolved_country_code"),
            "resolved_display_name": a.get("resolved_display_name"),
            "url": a.get("url", ""),
        }
        for a in geocoded[:5]
    ]
    sample_non_geocoded = [
        {
            "title": a.get("title", ""),
            "url": a.get("url", ""),
        }
        for a in non_geocoded[:5]
    ]

    return {
        "total_articles_recent": len(recent),
        "geocoded_articles": len(geocoded),
        "sample_geocoded": sample_geocoded,
        "sample_non_geocoded": sample_non_geocoded,
        "geocode_stats": get_geocode_stats(),
        "geo_validation_stats": _snapshot_geo_validation_stats(),
    }


@app.get("/debug/news-stats")
def debug_news_stats():
    """
    End-to-end diagnostics for feed health, article pool size, and marker output.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=_NEWS_WINDOW_HOURS)).isoformat()
    with _NEWS_STORE_LOCK:
        recent = [a for a in _NEWS_ARTICLE_STORE.values() if a.get("published", "") >= cutoff]
        unique_count = len(_NEWS_ARTICLE_STORE)

    markers, markers_by_region = _build_marker_set(recent, per_region=150, max_total=900)
    confidence_counts = Counter((m.get("location_confidence") or "none") for m in markers)

    with _FEED_RUN_STATS_LOCK:
        failed_top_20 = list(_FEED_RUN_STATS["failed_feeds"].items())[:20]
        feeds_total = _FEED_RUN_STATS["feeds_total"] or len(_SCAN_FEEDS)
        feeds_ok = _FEED_RUN_STATS["feeds_ok"]
        feeds_failed = _FEED_RUN_STATS["feeds_failed"] or max(0, feeds_total - feeds_ok)
        last_run_at = _FEED_RUN_STATS["last_run_at"]

    return {
        "feeds_total": feeds_total,
        "feeds_ok": feeds_ok,
        "feeds_failed": feeds_failed,
        "failing_feeds_top20": [{"feed": feed, "error": msg} for feed, msg in failed_top_20],
        "articles_total_recent": len(recent),
        "articles_unique": unique_count,
        "markers_returned_total": len(markers),
        "markers_by_region": markers_by_region,
        "location_confidence_counts": dict(confidence_counts),
        "last_feed_run_at": last_run_at,
    }



# ── /news-conflicts/debug ──────────────────────────────────────────────────────

@app.get("/news-conflicts/debug")
def debug_news_conflicts():
    """
    Run one full pass of news conflict extraction and return a per-article diagnostic log.
    Does NOT update _NEWS_CONFLICT_MARKERS or _PROCESSED_URLS.
    Ignores _PROCESSED_URLS so previously-seen articles are re-evaluated.
    """
    SCAN_FEEDS = [
        ("AllAfrica Tanzania",    "https://allafrica.com/tools/headlines/rdf/tanzania/headlines.rdf"),
        ("AllAfrica East Africa", "https://allafrica.com/tools/headlines/rdf/eastafrica/headlines.rdf"),
        ("BBC Africa",            "http://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        ("Al Jazeera",            "https://www.aljazeera.com/xml/rss/all.xml"),
        ("AllAfrica Kenya",       "https://allafrica.com/tools/headlines/rdf/kenya/headlines.rdf"),
        ("AllAfrica Uganda",      "https://allafrica.com/tools/headlines/rdf/uganda/headlines.rdf"),
    ]
    report = {
        "spacy_available":  _HAS_SPACY,
        "extraction_mode":  "spaCy NER" if _HAS_SPACY else "keyword fallback",
        "ea_locations_count": len(_EA_LOCATIONS),
        "feeds":            [],
    }

    for source_name, feed_url in SCAN_FEEDS:
        feed_report = {
            "source":           source_name,
            "url":              feed_url,
            "status":           "ok",
            "entry_count":      0,
            "sample_titles":    [],
            "trigger_matches":  0,
            "location_matches": 0,
            "markers_produced": 0,
            "articles":         [],
        }
        try:
            feed = feedparser.parse(feed_url)
            feed_report["entry_count"] = len(feed.entries)
            feed_report["sample_titles"] = [e.get("title", "") for e in feed.entries[:3]]
            if getattr(feed, "bozo", False):
                feed_report["bozo"] = str(getattr(feed, "bozo_exception", "unknown"))
        except Exception as ex:
            feed_report["status"] = f"error: {ex}"
            report["feeds"].append(feed_report)
            continue

        # Only inspect trigger-matching articles (cap at 50 per feed)
        for entry in feed.entries[:50]:
            title   = entry.get("title", "") or ""
            summary = entry.get("summary", "") or ""
            text    = (title + " " + summary).lower()
            matched_kws = [kw for kw in TRIGGER_KEYWORDS if kw in text]
            if not matched_kws:
                continue

            art = {
                "title":          title[:150],
                "summary":        summary[:200],
                "triggers":       matched_kws[:6],
                "locations":      [],
                "geocode":        [],
                "outcome":        "",
            }
            feed_report["trigger_matches"] += 1

            locations = _extract_locations_spacy(title + " " + summary)
            art["locations"] = locations

            if not locations:
                art["outcome"] = "SKIP — no locations extracted"
                feed_report["articles"].append(art)
                continue

            feed_report["location_matches"] += 1
            marker_added = False

            for loc in locations[:3]:
                nom_url = (
                    f"https://nominatim.openstreetmap.org/search"
                    f"?q={urllib.parse.quote(loc)}&format=json&limit=1"
                )
                geo = {"location": loc, "nominatim_url": nom_url, "raw": None, "confidence": None}
                try:
                    req = urllib.request.Request(nom_url, headers={"User-Agent": "Akili/1.0"})
                    with urllib.request.urlopen(req, timeout=6) as resp:
                        results = _json.loads(resp.read())
                    if results:
                        r   = results[0]
                        lat = float(r.get("lat", 0))
                        lon = float(r.get("lon", 0))
                        conf = _score_confidence(source_name, r)
                        geo.update({
                            "raw":        {"lat": lat, "lon": lon, "display_name": r.get("display_name", "")[:100]},
                            "confidence": conf,
                        })
                        if conf != "low":
                            marker_added = True
                    else:
                        geo["raw"] = "EMPTY — Nominatim returned no results"
                except Exception as ex:
                    geo["raw"] = f"ERROR: {ex}"
                art["geocode"].append(geo)

            art["outcome"] = "MARKER_ADDED" if marker_added else "SKIP — geocode empty/low-confidence"
            if marker_added:
                feed_report["markers_produced"] += 1
            feed_report["articles"].append(art)

        report["feeds"].append(feed_report)

    return report


# ── /satellite/search ─────────────────────────────────────────────────────────
# Queries satellite imagery STAC endpoints. If Copernicus OAuth credentials are
# configured, tries authenticated CDSE first, then falls back to Earth Search.

_COPERNICUS_TOKEN_CACHE: dict = {"access_token": None, "expires_at": 0.0}
_COPERNICUS_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
_EARTH_SEARCH_STAC_URL = "https://earth-search.aws.element84.com/v1/search"


async def _get_copernicus_access_token(client_h: httpx.AsyncClient) -> tuple[Optional[str], Optional[str]]:
    """Get (and cache) CDSE OAuth token for client_credentials auth."""
    if not (_COPERNICUS_CLIENT_ID and _COPERNICUS_CLIENT_SECRET):
        return None, "missing_credentials"

    now = time.time()
    token = _COPERNICUS_TOKEN_CACHE.get("access_token")
    expires_at = float(_COPERNICUS_TOKEN_CACHE.get("expires_at", 0.0))
    if token and expires_at - now > 60:
        return token, None

    form = {
        "grant_type": "client_credentials",
        "client_id": _COPERNICUS_CLIENT_ID,
        "client_secret": _COPERNICUS_CLIENT_SECRET,
    }
    try:
        resp = await client_h.post(
            _COPERNICUS_TOKEN_URL,
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        payload = resp.json()
        access_token = payload.get("access_token")
        expires_in = int(payload.get("expires_in", 3600))
        if not access_token:
            return None, "token_missing_in_response"
        _COPERNICUS_TOKEN_CACHE["access_token"] = access_token
        _COPERNICUS_TOKEN_CACHE["expires_at"] = now + max(300, expires_in - 120)
        return access_token, None
    except Exception as ex:
        return None, str(ex)


def _normalise_satellite_items(data: dict, source_label: str) -> list[dict]:
    seen_tiles: dict = {}  # tile_id → item, keep most recent per granule
    for feature in data.get("features", []):
        props = feature.get("properties", {})
        assets = feature.get("assets", {})

        thumbnail = None
        for key in ("thumbnail", "overview"):
            href = assets.get(key, {}).get("href", "")
            if href.startswith("https://"):
                thumbnail = href
                break
        if not thumbnail:
            continue

        # Full-resolution COG for the visual (true-colour) band
        visual_href = None
        for key in ("visual", "TCI", "TCI_10m"):
            href = assets.get(key, {}).get("href", "")
            if href:
                visual_href = href
                break

        feature_id = feature.get("id", "")
        tile_id = props.get("grid:code") or (feature_id[:20] if feature_id else "unknown")
        item = {
            "id": feature_id,
            "tile_id": tile_id,
            "bbox": feature.get("bbox", []),   # [west, south, east, north]
            "geometry": feature.get("geometry"),
            "datetime": props.get("datetime"),
            "cloud_cover": props.get("eo:cloud_cover"),
            "platform": props.get("platform", "sentinel-2"),
            "collection": "sentinel-2-l2a",
            "source": source_label,
            "thumbnail": thumbnail,
            "visual_href": visual_href,
        }
        if tile_id not in seen_tiles:
            seen_tiles[tile_id] = item
    return list(seen_tiles.values())


@app.get("/satellite/auth-status")
async def satellite_auth_status():
    configured = bool(_COPERNICUS_CLIENT_ID and _COPERNICUS_CLIENT_SECRET)
    if not configured:
        return {
            "configured": False,
            "auth_mode": "public",
            "message": "COPERNICUS_CLIENT_ID / COPERNICUS_CLIENT_SECRET missing",
        }

    async with httpx.AsyncClient(timeout=12.0) as client_h:
        token, err = await _get_copernicus_access_token(client_h)
    return {
        "configured": configured,
        "auth_mode": "copernicus_oauth" if token else "public",
        "token_ok": bool(token),
        "message": None if token else err,
    }


async def _satellite_search_impl(bbox, max_cloud=20, days_back=60, date_range: str | None = None):
    try:
        bbox = [float(v) for v in bbox]
        if len(bbox) != 4:
            raise ValueError("bbox must have 4 values")
    except Exception:
        return {"items": [], "error": "Invalid bbox. Expected [west, south, east, north].", "count": 0}

    try:
        max_cloud = max(0, min(100, int(max_cloud)))
    except Exception:
        max_cloud = 20
    try:
        days_back = max(1, min(365, int(days_back)))
    except Exception:
        days_back = 60

    if date_range:
        dt_range = str(date_range)
    else:
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=days_back)
        dt_range = f"{start_dt.strftime('%Y-%m-%dT%H:%M:%SZ')}/{end_dt.strftime('%Y-%m-%dT%H:%M:%SZ')}"

    payload = {
        "collections": ["sentinel-2-l2a"],
        "bbox": bbox,
        "datetime": dt_range,
        "query": {"eo:cloud_cover": {"lte": max_cloud}},
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
        "limit": 100,
        "fields": {
            "include": [
                "id", "bbox", "geometry",
                "properties.datetime", "properties.eo:cloud_cover",
                "properties.platform", "properties.grid:code",
                "assets.thumbnail", "assets.overview",
                "assets.visual", "assets.TCI", "assets.TCI_10m",
            ]
        },
    }

    auth_mode = "public"
    auth_error = None
    source_label = "ESA / Copernicus via AWS Earth Search"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client_h:
            # Use Copernicus OAuth for discovery when credentials are present.
            # AWS Earth Search is used for the actual tile rendering (public HTTPS COGs).
            # We run the Earth Search query regardless; Copernicus is only for auth status.
            if _COPERNICUS_CLIENT_ID and _COPERNICUS_CLIENT_SECRET:
                token, token_err = await _get_copernicus_access_token(client_h)
                if token:
                    auth_mode = "copernicus_oauth"
                else:
                    auth_error = token_err

            resp = await client_h.post(_EARTH_SEARCH_STAC_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()

    except Exception as ex:
        print(f"[satellite/search] error: {ex}")
        return {
            "items": [],
            "error": str(ex),
            "count": 0,
            "auth_mode": auth_mode,
            "auth_error": auth_error,
        }

    result = _normalise_satellite_items(data, source_label)
    return {
        "items": result,
        "count": len(result),
        "error": None,
        "auth_mode": auth_mode,
        "auth_error": None,
        "credentials_configured": bool(_COPERNICUS_CLIENT_ID and _COPERNICUS_CLIENT_SECRET),
    }


@app.post("/satellite/search")
async def satellite_search(request: Request):
    body = await request.json()
    return await _satellite_search_impl(
        body.get("bbox"),
        body.get("max_cloud", 20),
        body.get("days_back", 60),
    )


@app.get("/api/satellite/search")
async def api_satellite_search(
    bbox: str = Query(..., description="west,south,east,north"),
    date: str = Query(None, description="YYYY-MM-DD/YYYY-MM-DD"),
):
    try:
        bbox_values = [float(v) for v in bbox.split(",")]
    except Exception:
        bbox_values = bbox
    return await _satellite_search_impl(
        bbox_values,
        20,
        60,
        date_range=date,
    )


# ── /satellite/tile — Sentinel Hub Process API tile proxy ────────────────────
# Serves 256×256 true-colour Sentinel-2 tiles via Sentinel Hub (sh.dataspace.copernicus.eu).
# The frontend uses this as a TileLayer URL template so Leaflet fills {z}/{x}/{y}.
# Requires COPERNICUS_CLIENT_ID / COPERNICUS_CLIENT_SECRET in .env.

_SH_PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"

_EVALSCRIPT_TRUE_COLOUR = """//VERSION=3
function setup() {
  return { input: ["B04", "B03", "B02", "dataMask"], output: { bands: 4 } }
}
function evaluatePixel(s) {
  return [3.5 * s.B04, 3.5 * s.B03, 3.5 * s.B02, s.dataMask]
}"""

# ── Per-type evalscripts ──────────────────────────────────────────────────────
_EVALSCRIPTS = {
    "true-colour": _EVALSCRIPT_TRUE_COLOUR,

    "false-colour": """//VERSION=3
function setup(){return{input:["B08","B04","B03","dataMask"],output:{bands:4}}}
function evaluatePixel(s){return[3.5*s.B08,3.5*s.B04,3.5*s.B03,s.dataMask]}""",

    "highlight-optimized": """//VERSION=3
function setup(){return{input:["B04","B03","B02","dataMask"],output:{bands:4}}}
function evaluatePixel(s){
  var a=[s.B04,s.B03,s.B02];var mx=Math.max(a[0],a[1],a[2]);
  if(mx>1/3.5){var f=1/(3.5*mx);return[f*s.B04,f*s.B03,f*s.B02,s.dataMask]}
  return[3.5*s.B04,3.5*s.B03,3.5*s.B02,s.dataMask]}""",

    "ndvi": """//VERSION=3
function setup(){return{input:["B08","B04","dataMask"],output:{bands:4}}}
function evaluatePixel(s){
  var n=(s.B08-s.B04)/(s.B08+s.B04+1e-6);
  var c=colorBlend(n,[-1,-0.5,0,0.2,0.4,0.6,1],
    [[0.05,0.05,0.05],[0.75,0.4,0.1],[0.9,0.9,0.2],[0.5,0.8,0.2],
     [0.2,0.6,0.1],[0.1,0.4,0.05],[0.05,0.25,0.05]]);
  return[c[0],c[1],c[2],s.dataMask]}""",

    "false-colour-urban": """//VERSION=3
function setup(){return{input:["B12","B11","B04","dataMask"],output:{bands:4}}}
function evaluatePixel(s){return[3.5*s.B12,3.5*s.B11,3.5*s.B04,s.dataMask]}""",

    "moisture-index": """//VERSION=3
function setup(){return{input:["B8A","B11","dataMask"],output:{bands:4}}}
function evaluatePixel(s){
  var mi=(s.B8A-s.B11)/(s.B8A+s.B11+1e-6);
  var c=colorBlend(mi,[-1,-0.5,0,0.2,0.4,0.6,1],
    [[0.7,0.3,0.05],[0.9,0.7,0.3],[0.9,0.9,0.7],[0.7,0.9,0.5],
     [0.3,0.7,0.2],[0.1,0.4,0.1],[0.0,0.2,0.05]]);
  return[c[0],c[1],c[2],s.dataMask]}""",

    "swir": """//VERSION=3
function setup(){return{input:["B12","B8A","B04","dataMask"],output:{bands:4}}}
function evaluatePixel(s){return[3.5*s.B12,3.5*s.B8A,3.5*s.B04,s.dataMask]}""",

    "ndwi": """//VERSION=3
function setup(){return{input:["B03","B08","dataMask"],output:{bands:4}}}
function evaluatePixel(s){
  var n=(s.B03-s.B08)/(s.B03+s.B08+1e-6);
  var c=colorBlend(n,[-1,-0.3,0,0.2,0.5,1],
    [[0.5,0.3,0.1],[0.8,0.8,0.6],[0.9,0.9,0.9],[0.5,0.7,0.9],
     [0.1,0.5,0.8],[0.0,0.2,0.6]]);
  return[c[0],c[1],c[2],s.dataMask]}""",

    "ndsi": """//VERSION=3
function setup(){return{input:["B03","B11","dataMask"],output:{bands:4}}}
function evaluatePixel(s){
  var n=(s.B03-s.B11)/(s.B03+s.B11+1e-6);
  var c=colorBlend(n,[-1,0,0.2,0.4,0.6,1],
    [[0.5,0.3,0.1],[0.8,0.7,0.5],[0.9,0.9,0.9],[0.96,0.97,1],
     [0.7,0.85,1],[0.4,0.7,1]]);
  return[c[0],c[1],c[2],s.dataMask]}""",
}


def _tile_to_bbox_wgs84(z: int, x: int, y: int) -> list[float]:
    """Convert XYZ slippy-map tile to [west, south, east, north] in WGS84."""
    n = 2 ** z
    lon_w = x / n * 360.0 - 180.0
    lon_e = (x + 1) / n * 360.0 - 180.0
    lat_n = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat_s = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return [lon_w, lat_s, lon_e, lat_n]


# Minimal 1×1 transparent PNG (44 bytes) returned for out-of-range zoom levels
_TRANSPARENT_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)

@app.get("/satellite/tile/{z}/{x}/{y}.png")
async def satellite_tile_png(z: int, x: int, y: int, dt: str = ""):
    """Proxy a 256×256 true-colour Sentinel-2 PNG tile via Sentinel Hub Process API."""
    # Sentinel-2 is meaningless below zoom 8 (~5km/px) — return transparent tile
    if z < 8:
        return FastAPIResponse(content=_TRANSPARENT_PNG, media_type="image/png")

    if not (_COPERNICUS_CLIENT_ID and _COPERNICUS_CLIENT_SECRET):
        raise HTTPException(status_code=503, detail="Sentinel Hub credentials not configured")

    async with httpx.AsyncClient(timeout=30.0) as client_h:
        token, err = await _get_copernicus_access_token(client_h)
        if not token:
            raise HTTPException(status_code=502, detail=f"Sentinel Hub auth failed: {err}")

        bbox = _tile_to_bbox_wgs84(z, x, y)

        if dt:
            date_part = dt[:10]
            time_range = {
                "from": f"{date_part}T00:00:00Z",
                "to":   f"{date_part}T23:59:59Z",
            }
        else:
            now = datetime.now(timezone.utc)
            time_range = {
                "from": (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "to":   now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }

        payload = {
            "input": {
                "bounds": {
                    "bbox": bbox,
                    "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"},
                },
                "data": [{
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "timeRange": time_range,
                        "mosaickingOrder": "mostRecent",
                        "maxCloudCoverage": 100,
                    },
                }],
            },
            "output": {
                "width": 256,
                "height": 256,
                "responses": [{"identifier": "default", "format": {"type": "image/png"}}],
            },
            "evalscript": _EVALSCRIPT_TRUE_COLOUR,
        }

        resp = await client_h.post(
            _SH_PROCESS_URL,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])

        return FastAPIResponse(content=resp.content, media_type="image/png")


# ── /api/sentinel/imagery — full-area Sentinel-2 Process API ─────────────────
# Returns a single base64-PNG for an arbitrary bounding box (drawn by the user).
# Uses the same credentials/token cache as the tile proxy above.

@app.post("/api/sentinel/imagery")
async def sentinel_imagery(request: Request):
    """Fetch a full Sentinel-2 image for a drawn bounding box.
    Supports image_type (true-colour|false-colour|highlight-optimized|ndvi|
    false-colour-urban|moisture-index|swir|ndwi|ndsi) and optional date (YYYY-MM-DD)."""
    import base64 as _b64
    try:
        body       = await request.json()
        bounds     = body.get("bounds", {})
        max_cloud  = int(body.get("max_cloud", 20))
        days_back  = int(body.get("days_back", 90))
        image_type = body.get("image_type", "true-colour")
        date_str   = body.get("date")   # optional YYYY-MM-DD for exact scene

        west  = bounds.get("west");  east  = bounds.get("east")
        south = bounds.get("south"); north = bounds.get("north")
        if None in (west, east, south, north):
            return JSONResponse({"error": "bounds {north,south,east,west} required"}, status_code=400)

        if not (_COPERNICUS_CLIENT_ID and _COPERNICUS_CLIENT_SECRET):
            return JSONResponse({"error": "Copernicus credentials not configured"}, status_code=503)

        evalscript = _EVALSCRIPTS.get(image_type, _EVALSCRIPT_TRUE_COLOUR)

        # ── Cap image size at 2500×2500 ───────────────────────────────────────
        lat_span = abs(north - south)
        lng_span = abs(east  - west)
        req_w = body.get("width");  req_h = body.get("height")
        if req_w and req_h:
            width  = min(2500, max(32, int(req_w)))
            height = min(2500, max(32, int(req_h)))
        else:
            width  = min(2500, max(256, int(lng_span * 11100)))
            height = min(2500, max(256, int(lat_span * 11100)))

        now = datetime.now(timezone.utc)
        if date_str:
            time_range = {
                "from": f"{date_str}T00:00:00Z",
                "to":   f"{date_str}T23:59:59Z",
            }
            mosaic_order = "mostRecent"
        else:
            time_range = {
                "from": (now - timedelta(days=days_back)).strftime("%Y-%m-%dT00:00:00Z"),
                "to":   now.strftime("%Y-%m-%dT23:59:59Z"),
            }
            mosaic_order = "leastCC"

        payload = {
            "input": {
                "bounds": {
                    "bbox": [west, south, east, north],
                    "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"},
                },
                "data": [{
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "maxCloudCoverage": max_cloud if not date_str else 100,
                        "timeRange": time_range,
                        "mosaickingOrder": mosaic_order,
                    },
                }],
            },
            "output": {
                "width":  width,
                "height": height,
                "responses": [{"identifier": "default", "format": {"type": "image/png"}}],
            },
            "evalscript": evalscript,
        }

        async with httpx.AsyncClient(timeout=60.0) as client_h:
            token, err = await _get_copernicus_access_token(client_h)
            if not token:
                return JSONResponse({"error": f"Sentinel Hub auth failed: {err}"}, status_code=502)

            resp = await client_h.post(
                _SH_PROCESS_URL,
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )

        if resp.status_code == 200:
            img_b64 = _b64.b64encode(resp.content).decode()
            return JSONResponse({
                "image":      img_b64,
                "width":      width,
                "height":     height,
                "bounds":     bounds,
                "cloud_max":  max_cloud,
                "days_back":  days_back,
                "image_type": image_type,
                "date":       date_str,
            })
        else:
            detail = resp.text[:500]
            print(f"[sentinel/imagery] Process API {resp.status_code}: {detail}")
            return JSONResponse(
                {"error": f"Sentinel Hub API error {resp.status_code}", "detail": detail},
                status_code=resp.status_code,
            )
    except Exception as e:
        print(f"[sentinel/imagery] error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/sentinel/dates")
async def sentinel_dates(request: Request):
    """Return available Sentinel-2 scene dates for a bounding box (STAC search)."""
    try:
        body      = await request.json()
        bounds    = body.get("bounds", {})
        max_cloud = int(body.get("max_cloud", 40))
        days_back = int(body.get("days_back", 180))

        west  = bounds.get("west");  east  = bounds.get("east")
        south = bounds.get("south"); north = bounds.get("north")
        if None in (west, east, south, north):
            return JSONResponse({"error": "bounds required"}, status_code=400)

        items, err = await _satellite_search_impl(
            bbox=[west, south, east, north],
            max_cloud=max_cloud,
            days_back=days_back,
        )
        if err:
            return JSONResponse({"error": err}, status_code=500)

        seen = set(); dates = []
        for it in (items or []):
            dt = (it.get("datetime") or "")[:10]
            cc = it.get("cloud_cover")
            if dt and dt not in seen:
                seen.add(dt)
                dates.append({"date": dt, "cloud_cover": round(cc, 1) if cc is not None else None})
        dates = sorted(dates, key=lambda d: d["date"], reverse=True)[:10]
        return JSONResponse({"dates": dates})
    except Exception as e:
        print(f"[sentinel/dates] error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


# ── /annotations/save & /annotations/load ────────────────────────────────────

ANNOTATIONS_FILE = BASE_DIR / "annotations.json"

@app.post("/annotations/save")
async def save_annotations(request: Request):
    data = await request.json()
    ANNOTATIONS_FILE.write_text(_json.dumps(data, indent=2))
    return {"status": "saved"}

@app.get("/annotations/load")
async def load_annotations():
    if not ANNOTATIONS_FILE.exists():
        return {"points": [], "zones": [], "links": []}
    return _json.loads(ANNOTATIONS_FILE.read_text())


# ── /satellites/tle ───────────────────────────────────────────────────────────

_sat_cache: dict = {"data": None, "fetched_at": 0}

OWNERSHIP_KEYWORDS = {
    "SENTINEL":    {"owner": "ESA / Copernicus",        "flag": "🇪🇺"},
    "LANDSAT":     {"owner": "NASA / USGS",             "flag": "🇺🇸"},
    "TERRA":       {"owner": "NASA",                    "flag": "🇺🇸"},
    "AQUA":        {"owner": "NASA",                    "flag": "🇺🇸"},
    "NOAA":        {"owner": "NOAA / USA",              "flag": "🇺🇸"},
    "METOP":       {"owner": "EUMETSAT / ESA",          "flag": "🇪🇺"},
    "SUOMI":       {"owner": "NASA / NOAA",             "flag": "🇺🇸"},
    "ISS":         {"owner": "International",           "flag": "🌍"},
    "TIANGONG":    {"owner": "CNSA / China",            "flag": "🇨🇳"},
    "CSS":         {"owner": "CNSA / China",            "flag": "🇨🇳"},
    "SPOT":        {"owner": "Airbus / France",         "flag": "🇫🇷"},
    "PLEIADES":    {"owner": "Airbus / France",         "flag": "🇫🇷"},
    "WORLDVIEW":   {"owner": "Maxar / USA",             "flag": "🇺🇸"},
    "GEOEYE":      {"owner": "Maxar / USA",             "flag": "🇺🇸"},
    "KOMPSAT":     {"owner": "KARI / South Korea",      "flag": "🇰🇷"},
    "RESOURCESAT": {"owner": "ISRO / India",            "flag": "🇮🇳"},
    "CARTOSAT":    {"owner": "ISRO / India",            "flag": "🇮🇳"},
    "RADARSAT":    {"owner": "CSA / Canada",            "flag": "🇨🇦"},
    "COSMO":       {"owner": "ASI / Italy",             "flag": "🇮🇹"},
    "PLANET":      {"owner": "Planet Labs / USA",       "flag": "🇺🇸"},
    "FLOCK":       {"owner": "Planet Labs / USA",       "flag": "🇺🇸"},
    "SKYSAT":      {"owner": "Planet Labs / USA",       "flag": "🇺🇸"},
    "SPIRE":       {"owner": "Spire Global / USA",      "flag": "🇺🇸"},
    "LEMUR":       {"owner": "Spire Global / USA",      "flag": "🇺🇸"},
    "USA":         {"owner": "US Military / NRO",       "flag": "🇺🇸"},
    "KH-":         {"owner": "NRO / USA (Classified)",  "flag": "🇺🇸"},
    "COSMOS":      {"owner": "Russian Military",        "flag": "🇷🇺"},
    "YAOGAN":      {"owner": "PLA / China",             "flag": "🇨🇳"},
    "ZIYUAN":      {"owner": "CNSA / China",            "flag": "🇨🇳"},
    "OFEK":        {"owner": "IAF / Israel",            "flag": "🇮🇱"},
    "EROS":        {"owner": "ImageSat / Israel",       "flag": "🇮🇱"},
}

@app.get("/satellites/tle")
async def get_satellite_tles():
    global _sat_cache
    if _sat_cache["data"] and (time_module.time() - _sat_cache["fetched_at"]) < 7200:
        return _sat_cache["data"]

    GROUPS = [
        ("https://celestrak.org/NORAD/elements/gp.php?GROUP=earth-observation&FORMAT=JSON", "Earth Observation"),
        ("https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=JSON",           "Weather"),
        ("https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=JSON",          "Space Stations"),
        ("https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=JSON",          "Military"),
        ("https://celestrak.org/NORAD/elements/gp.php?GROUP=radar&FORMAT=JSON",             "Radar / SAR"),
        ("https://celestrak.org/NORAD/elements/gp.php?GROUP=planet&FORMAT=JSON",            "Commercial (Planet)"),
        ("https://celestrak.org/NORAD/elements/gp.php?GROUP=spire&FORMAT=JSON",             "Commercial (Spire)"),
    ]

    results = []
    async with httpx.AsyncClient(timeout=20.0) as client_h:
        for url, category in GROUPS:
            try:
                resp = await client_h.get(url)
                resp.raise_for_status()
                sats = resp.json()
                for sat in sats:
                    name = sat.get("OBJECT_NAME", "UNKNOWN")
                    ownership = {"owner": "Unknown", "flag": "🛰"}
                    for kw, meta in OWNERSHIP_KEYWORDS.items():
                        if kw in name.upper():
                            ownership = meta
                            break
                    results.append({
                        **sat,           # preserve ALL CelesTrak OMM fields for json2satrec
                        "name":     name,
                        "norad_id": sat.get("NORAD_CAT_ID"),
                        "category": category,
                        "owner":    ownership["owner"],
                        "flag":     ownership["flag"],
                    })
            except Exception:
                continue

    payload = {
        "satellites":  results,
        "count":       len(results),
        "fetched_at":  datetime.now(timezone.utc).isoformat(),
    }
    _sat_cache = {"data": payload, "fetched_at": time_module.time()}
    return payload


# ── /situations/save & /situations/load ──────────────────────────────────────

SITUATIONS_FILE = BASE_DIR / "situations.json"

@app.post("/situations/save")
async def save_situations(request: Request):
    data = await request.json()
    SITUATIONS_FILE.write_text(_json.dumps(data, indent=2))
    return {"status": "saved"}

@app.get("/situations/load")
async def load_situations():
    if not SITUATIONS_FILE.exists():
        return {"situations": [], "active_id": None}
    return _json.loads(SITUATIONS_FILE.read_text())


# ── /profile — Mission Profile persistence ────────────────────────────────────

PROFILE_FILE = BASE_DIR / "profile.json"

# In-memory cache of the active profile — loaded on startup, updated on save.
_ACTIVE_PROFILE: dict | None = None

def _load_profile_from_disk() -> dict | None:
    try:
        if PROFILE_FILE.exists():
            return _json.loads(PROFILE_FILE.read_text())
    except Exception as exc:
        print(f"[profile] load error: {exc}")
    return None

# Load on module import (i.e. at server startup)
_ACTIVE_PROFILE = _load_profile_from_disk()
if _ACTIVE_PROFILE:
    print(f"[profile] loaded profile for '{_ACTIVE_PROFILE.get('displayName', 'unknown')}' "
          f"({_ACTIVE_PROFILE.get('role', '?')}) — threshold={_ACTIVE_PROFILE.get('threshold', 1)}")
else:
    print("[profile] no saved profile — events will use default scoring until profile is set")

@app.post("/profile/save")
async def save_profile(request: Request):
    global _ACTIVE_PROFILE
    data = await request.json()
    PROFILE_FILE.write_text(_json.dumps(data, indent=2))
    _ACTIVE_PROFILE = data
    print(f"[profile] updated: '{data.get('displayName', '')}' ({data.get('role', '?')}) "
          f"threshold={data.get('threshold', 1)} "
          f"regions={data.get('focusRegions', [])}")
    # Rebuild surface pool synchronously so the response contains fresh data.
    loop = asyncio.get_event_loop()
    new_pool = await loop.run_in_executor(_executor, _refresh_surface_pool_sync, "profile-save")
    with _SURFACE_POOL_LOCK:
        updated_at = _SURFACE_POOL_UPDATED_AT or datetime.now(timezone.utc).isoformat()
        if not new_pool:
            print(f"[profile/save] pool rebuild returned 0 items — retaining previous pool ({len(_SURFACE_POOL)} items)")
    if new_pool:
        asyncio.create_task(_run_auto_cluster_briefs(new_pool))
    # Attach auto-briefs to returned items
    with _AUTO_BRIEF_LOCK:
        enriched = []
        for item in (new_pool or _SURFACE_POOL):
            entry = _AUTO_BRIEF_STORE.get(item.get("id", ""))
            if entry:
                item = {**item, "auto_brief": entry["brief"], "auto_brief_at": entry["generated_at"]}
            enriched.append(item)
    return {"status": "saved", "items": enriched, "updated_at": updated_at, "count": len(enriched)}

@app.get("/profile/load")
async def load_profile():
    if not PROFILE_FILE.exists():
        return {"profile": None}
    try:
        return {"profile": _json.loads(PROFILE_FILE.read_text())}
    except Exception:
        return {"profile": None}


# ── /chat — mission chat using Haiku (cost-optimised) ────────────────────────

@app.post("/chat")
async def mission_chat(request: Request):
    if not client:
        return {"error": "ANTHROPIC_API_KEY not configured"}
    body = await request.json()
    messages      = body.get("messages", [])[-6:]   # enforce 6-message cap
    mission_brief = body.get("mission_brief", "")
    contextual    = body.get("contextual", False)

    system = (
        "You are Akili, a senior intelligence analyst. "
        "Answer questions directly, concisely, and accurately. "
        "If you don't know something, say so. Never fabricate intelligence.\n\n"
    )
    if mission_brief:
        system += f"CURRENT MISSION:\n{mission_brief}\n\n"
    if contextual:
        system += get_minimal_context()

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        system=system,
        messages=messages,
    )

    input_tokens  = response.usage.input_tokens
    output_tokens = response.usage.output_tokens
    cost_usd      = (input_tokens * 0.0000008) + (output_tokens * 0.000004)
    usage_tracker.record_call(input_tokens, output_tokens)

    return {
        "response": response.content[0].text,
        "usage": {
            "input_tokens":  input_tokens,
            "output_tokens": output_tokens,
            "cost_usd":      round(cost_usd, 5),
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# CONTEXTUAL DETAIL PANEL — airports, ADSB, annotations, detail-analyse
# ══════════════════════════════════════════════════════════════════════════════

_AIRPORTS_CACHE:    list  = []
_AIRPORTS_CACHE_TS: float = 0.0
_AIRPORTS_CACHE_FILE = BASE_DIR / "airports_cache.csv"
_AIRPORT_TYPE_RANK   = {"large_airport": 0, "medium_airport": 1, "small_airport": 2,
                         "seaplane_base": 3, "heliport": 4}


_AIRPORT_KEEP_TYPES = {"large_airport", "medium_airport"}
_AIRPORT_KEEP_FIELDS = {
    "ident", "name", "type", "municipality", "iso_country",
    "latitude_deg", "longitude_deg", "wikipedia_link",
    "iata_code", "gps_code",
}

def _ensure_airports() -> list:
    global _AIRPORTS_CACHE, _AIRPORTS_CACHE_TS
    def _mark(count: int) -> None:
        with _DS_STATUS_LOCK:
            _DS_STATUS["airports"]["last_download"] = datetime.now(timezone.utc).isoformat()
            _DS_STATUS["airports"]["count"] = int(count)
    if _AIRPORTS_CACHE and (time.time() - _AIRPORTS_CACHE_TS < 86400):
        _mark(len(_AIRPORTS_CACHE))
        return _AIRPORTS_CACHE
    if _AIRPORTS_CACHE_FILE.exists() and (time.time() - _AIRPORTS_CACHE_FILE.stat().st_mtime < 7 * 86400):
        with open(_AIRPORTS_CACHE_FILE, encoding="utf-8", errors="replace") as fh:
            rows = list(_csv.DictReader(fh))
        _AIRPORTS_CACHE = [
            {k: v for k, v in r.items() if k in _AIRPORT_KEEP_FIELDS}
            for r in rows if r.get("type") in _AIRPORT_KEEP_TYPES
        ]
        _AIRPORTS_CACHE_TS = time.time()
        _mark(len(_AIRPORTS_CACHE))
        return _AIRPORTS_CACHE
    resp = httpx.get("https://ourairports.com/data/airports.csv", timeout=30, follow_redirects=True)
    resp.raise_for_status()
    _AIRPORTS_CACHE_FILE.write_bytes(resp.content)
    all_rows = list(_csv.DictReader(_io.StringIO(resp.text)))
    _AIRPORTS_CACHE = [
        {k: v for k, v in r.items() if k in _AIRPORT_KEEP_FIELDS}
        for r in all_rows if r.get("type") in _AIRPORT_KEEP_TYPES
    ]
    _AIRPORTS_CACHE_TS = time.time()
    _mark(len(_AIRPORTS_CACHE))
    return _AIRPORTS_CACHE


# ── World Port Index ───────────────────────────────────────────────────────────

_PORTS_CACHE:    list  = []
_PORTS_CACHE_TS: float = 0.0
_PORTS_CACHE_FILE = BASE_DIR / "ports_cache.csv"
_PORT_KEEP_FIELDS = {
    "PORT_NAME", "COUNTRY", "LATITUDE", "LONGITUDE",
    "HARBOR_TYPE", "HARBOR_SIZE", "MAX_VESSEL_SIZE",
    "GOOD_HOLDING_GROUND", "FACILITIES",
}
# WPI CSV uses mixed-case column names with spaces — map to expected uppercase keys
_WPI_COL_MAP = {
    "Main Port Name":          "PORT_NAME",
    "Country Code":            "COUNTRY",
    "Latitude":                "LATITUDE",
    "Longitude":               "LONGITUDE",
    "Harbor Type":             "HARBOR_TYPE",
    "Harbor Size":             "HARBOR_SIZE",
    "Maximum Vessel Length (m)": "MAX_VESSEL_SIZE",
    "Good Holding Ground":     "GOOD_HOLDING_GROUND",
    "Facilities":              "FACILITIES",
}
def _normalize_wpi_row(r: dict) -> dict:
    """Map mixed-case WPI column names to the uppercase keys expected by _PORT_KEEP_FIELDS."""
    out = {}
    for k, v in r.items():
        mapped = _WPI_COL_MAP.get(k) or k.strip().upper().replace(" ", "_")
        out[mapped] = v
    return out
_WPI_URL = "https://msi.nga.mil/api/publications/download?type=view&key=16920959/SFH00000/UpdatedPub150.csv"

def _ensure_ports() -> list:
    global _PORTS_CACHE, _PORTS_CACHE_TS
    def _mark(count: int) -> None:
        with _DS_STATUS_LOCK:
            _DS_STATUS["ports"]["last_download"] = datetime.now(timezone.utc).isoformat()
            _DS_STATUS["ports"]["count"] = int(count)
    if _PORTS_CACHE and (time.time() - _PORTS_CACHE_TS < 86400):
        _mark(len(_PORTS_CACHE))
        return _PORTS_CACHE
    if _PORTS_CACHE_FILE.exists() and (time.time() - _PORTS_CACHE_FILE.stat().st_mtime < 7 * 86400):
        with open(_PORTS_CACHE_FILE, encoding="utf-8", errors="replace") as fh:
            rows = [_normalize_wpi_row(r) for r in _csv.DictReader(fh)]
        _PORTS_CACHE = [{k: v for k, v in r.items() if k in _PORT_KEEP_FIELDS} for r in rows]
        _PORTS_CACHE_TS = time.time()
        _mark(len(_PORTS_CACHE))
        return _PORTS_CACHE
    try:
        resp = httpx.get(_WPI_URL, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        _PORTS_CACHE_FILE.write_bytes(resp.content)
        all_rows = [_normalize_wpi_row(r) for r in _csv.DictReader(_io.StringIO(resp.text))]
        _PORTS_CACHE = [{k: v for k, v in r.items() if k in _PORT_KEEP_FIELDS} for r in all_rows]
    except Exception as exc:
        print(f"[ports] download failed: {exc} — serving empty list")
        _PORTS_CACHE = []
    _PORTS_CACHE_TS = time.time()
    _mark(len(_PORTS_CACHE))
    return _PORTS_CACHE


# ── Global Power Plant Database (WRI) ─────────────────────────────────────────

_POWER_CACHE:    list  = []
_POWER_CACHE_TS: float = 0.0
_POWER_CACHE_FILE = BASE_DIR / "powerplants_cache.csv"
_POWER_KEEP_FIELDS = {
    "name", "country", "capacity_mw", "primary_fuel", "owner", "gppd_idnr",
    "latitude", "longitude", "commissioning_year",
}
_GPDD_URL = (
    "https://raw.githubusercontent.com/wri/global-power-plant-database"
    "/master/output_database/global_power_plant_database.csv"
)

def _ensure_powerplants() -> list:
    global _POWER_CACHE, _POWER_CACHE_TS
    def _mark(count: int) -> None:
        with _DS_STATUS_LOCK:
            _DS_STATUS["power"]["last_download"] = datetime.now(timezone.utc).isoformat()
            _DS_STATUS["power"]["count"] = int(count)
    if _POWER_CACHE and (time.time() - _POWER_CACHE_TS < 86400):
        _mark(len(_POWER_CACHE))
        return _POWER_CACHE
    if _POWER_CACHE_FILE.exists() and (time.time() - _POWER_CACHE_FILE.stat().st_mtime < 7 * 86400):
        with open(_POWER_CACHE_FILE, encoding="utf-8", errors="replace") as fh:
            rows = list(_csv.DictReader(fh))
        _POWER_CACHE = [{k: v for k, v in r.items() if k in _POWER_KEEP_FIELDS} for r in rows]
        _POWER_CACHE_TS = time.time()
        _mark(len(_POWER_CACHE))
        return _POWER_CACHE
    try:
        resp = httpx.get(_GPDD_URL, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        _POWER_CACHE_FILE.write_bytes(resp.content)
        all_rows = list(_csv.DictReader(_io.StringIO(resp.text)))
        _POWER_CACHE = [{k: v for k, v in r.items() if k in _POWER_KEEP_FIELDS} for r in all_rows]
    except Exception as exc:
        print(f"[power] download failed: {exc} — serving empty list")
        _POWER_CACHE = []
    _POWER_CACHE_TS = time.time()
    _mark(len(_POWER_CACHE))
    return _POWER_CACHE


# ── Infrastructure normalization / precision ─────────────────────────────────

def _clean_infra_value(value) -> str | None:
    text = str(value or "").strip()
    return text or None


def _name_quality_score(name: str | None) -> int:
    if not name:
        return 0
    generic = {"transport", "infrastructure", "facility", "military", "industrial"}
    lowered = name.strip().lower()
    if lowered in generic:
        return 0
    return 10 if len(lowered) >= 4 else 4


def _source_dataset_score(source_dataset: str) -> int:
    return {
        "ourairports": 30,
        "world_port_index": 28,
        "global_power_plant_database": 26,
        "osm": 10,
    }.get(source_dataset, 8)


def _precision_score(record: dict) -> int:
    score = _source_dataset_score(str(record.get("source_dataset") or ""))
    if record.get("subcategory"): score += 20
    if record.get("owner"): score += 12
    if record.get("operator"): score += 12
    if any(v for v in (record.get("codes") or {}).values()): score += 18
    if record.get("country"): score += 6
    score += _name_quality_score(record.get("name"))
    return min(score, 100)


def is_precise_infrastructure(record: dict) -> bool:
    name = (record.get("name") or "").strip().lower()
    subcategory = (record.get("subcategory") or "").strip().lower()
    generic_names = {"transport", "infrastructure", "facility", "military", "industrial"}
    if not name or name in generic_names:
        return False
    if not subcategory and not record.get("owner") and not record.get("operator") and not any((record.get("codes") or {}).values()):
        return False
    return int(record.get("precision_score") or 0) >= 35


def _normalize_airport_record(r: dict, lat: float, lon: float, distance_km: float) -> dict:
    codes = {
        "icao": _clean_infra_value(r.get("gps_code") or r.get("ident")),
        "iata": _clean_infra_value(r.get("iata_code")),
    }
    rec = {
        "id": _clean_infra_value(r.get("ident")) or f"airport_{lat:.4f}_{lon:.4f}",
        "name": _clean_infra_value(r.get("name")),
        "category": "transport",
        "subcategory": _clean_infra_value(r.get("type")) or "airport",
        "owner": None,
        "operator": None,
        "country": _clean_infra_value(r.get("iso_country")),
        "lat": lat,
        "lon": lon,
        "source_dataset": "ourairports",
        "codes": codes,
        "distance_km": round(distance_km, 1),
        "infra_type": "airport",
        "type": _clean_infra_value(r.get("type")),
        "municipality": _clean_infra_value(r.get("municipality")),
        "wikipedia": _clean_infra_value(r.get("wikipedia_link")),
    }
    rec["precision_score"] = _precision_score(rec)
    return rec


def _normalize_port_record(r: dict, lat: float, lon: float, distance_km: float) -> dict:
    codes = {
        "unlocode": _clean_infra_value(r.get("UNLOCODE")),
    }
    rec = {
        "id": _clean_infra_value(r.get("UNLOCODE")) or f"port_{lat:.4f}_{lon:.4f}",
        "name": _clean_infra_value(r.get("PORT_NAME")),
        "category": "maritime",
        "subcategory": _clean_infra_value(r.get("HARBOR_TYPE")) or "port",
        "owner": None,
        "operator": None,
        "country": _clean_infra_value(r.get("COUNTRY")),
        "lat": lat,
        "lon": lon,
        "source_dataset": "world_port_index",
        "codes": codes,
        "distance_km": round(distance_km, 1),
        "infra_type": "port",
        "harbor_type": _clean_infra_value(r.get("HARBOR_TYPE")),
        "harbor_size": _clean_infra_value(r.get("HARBOR_SIZE")),
        "max_vessel_size": _clean_infra_value(r.get("MAX_VESSEL_SIZE")),
        "good_holding_ground": _clean_infra_value(r.get("GOOD_HOLDING_GROUND")),
        "facilities": _clean_infra_value(r.get("FACILITIES")),
    }
    rec["precision_score"] = _precision_score(rec)
    return rec


def _normalize_power_record(r: dict, lat: float, lon: float, distance_km: float) -> dict:
    rec = {
        "id": _clean_infra_value(r.get("gppd_idnr")) or f"power_{lat:.4f}_{lon:.4f}",
        "name": _clean_infra_value(r.get("name")),
        "category": "energy",
        "subcategory": _clean_infra_value(r.get("primary_fuel")) or "power_plant",
        "owner": _clean_infra_value(r.get("owner")),
        "operator": _clean_infra_value(r.get("owner")),
        "country": _clean_infra_value(r.get("country")),
        "lat": lat,
        "lon": lon,
        "source_dataset": "global_power_plant_database",
        "codes": {},
        "distance_km": round(distance_km, 1),
        "infra_type": "power",
        "primary_fuel": _clean_infra_value(r.get("primary_fuel")),
        "capacity_mw": _clean_infra_value(r.get("capacity_mw")),
        "commissioning_year": _clean_infra_value(r.get("commissioning_year")),
    }
    rec["precision_score"] = _precision_score(rec)
    return rec


# ── /api/infrastructure/nearby ────────────────────────────────────────────────

@app.get("/api/infrastructure/nearby")
async def api_infrastructure_nearby(
    lat:    float,
    lon:    float,
    radius: float = Query(200, description="Search radius in km"),
    type:   str   = Query("airport", description="airport | port | power"),
):
    """Return infrastructure nodes within radius_km, sorted by distance."""
    started = time.perf_counter()
    loop = asyncio.get_event_loop()
    if type == "airport":
        rows = await loop.run_in_executor(_executor, _ensure_airports)
        results = []
        for r in rows:
            try:
                rlat = float(r.get("latitude_deg") or 0)
                rlon = float(r.get("longitude_deg") or 0)
                if not (rlat or rlon):
                    continue
                dist = _haversine_km(lat, lon, rlat, rlon)
                if dist <= radius:
                    rec = _normalize_airport_record(r, rlat, rlon, dist)
                    if is_precise_infrastructure(rec):
                        results.append(rec)
            except Exception:
                continue
        results.sort(key=lambda x: (_AIRPORT_TYPE_RANK.get(x.get("type", ""), 5), x["distance_km"]))
        payload = {"items": results[:120], "total": len(results), "type": "airport"}
        payload["diagnostics"] = {
            "fetch_ms": round((time.perf_counter() - started) * 1000, 1),
            "payload_bytes": len(_json.dumps(payload["items"], ensure_ascii=False).encode("utf-8")),
        }
        return payload

    elif type == "port":
        rows = await loop.run_in_executor(_executor, _ensure_ports)
        results = []
        for r in rows:
            try:
                rlat = float(r.get("LATITUDE") or 0)
                rlon = float(r.get("LONGITUDE") or 0)
                if not (rlat or rlon):
                    continue
                # Filter to major ports only
                harbor_size = (r.get("HARBOR_SIZE") or "").strip().title()
                if harbor_size not in ("Large", "Medium"):
                    continue
                dist = _haversine_km(lat, lon, rlat, rlon)
                if dist <= radius:
                    rec = _normalize_port_record(r, rlat, rlon, dist)
                    if is_precise_infrastructure(rec):
                        results.append(rec)
            except Exception:
                continue
        results.sort(key=lambda x: x["distance_km"])
        payload = {"items": results[:120], "total": len(results), "type": "port"}
        payload["diagnostics"] = {
            "fetch_ms": round((time.perf_counter() - started) * 1000, 1),
            "payload_bytes": len(_json.dumps(payload["items"], ensure_ascii=False).encode("utf-8")),
        }
        return payload

    elif type == "power":
        rows = await loop.run_in_executor(_executor, _ensure_powerplants)
        results = []
        for r in rows:
            try:
                rlat = float(r.get("latitude") or 0)
                rlon = float(r.get("longitude") or 0)
                if not (rlat or rlon):
                    continue
                dist = _haversine_km(lat, lon, rlat, rlon)
                if dist <= radius:
                    rec = _normalize_power_record(r, rlat, rlon, dist)
                    if is_precise_infrastructure(rec):
                        results.append(rec)
            except Exception:
                continue
        # Sort larger plants first (more strategically relevant), then by distance
        def _power_sort(x):
            try:
                cap = float(x["capacity_mw"]) if x["capacity_mw"] else 0
            except (ValueError, TypeError):
                cap = 0
            return (-cap, x["distance_km"])
        results.sort(key=_power_sort)
        payload = {"items": results[:120], "total": len(results), "type": "power"}
        payload["diagnostics"] = {
            "fetch_ms": round((time.perf_counter() - started) * 1000, 1),
            "payload_bytes": len(_json.dumps(payload["items"], ensure_ascii=False).encode("utf-8")),
        }
        return payload

    return {"items": [], "total": 0, "type": type, "error": "Unknown type. Use airport | port | power"}


# ── /api/infrastructure/ports ─────────────────────────────────────────────────

@app.get("/api/infrastructure/ports")
async def api_infrastructure_ports(
    bbox: str = Query(..., description="south,west,north,east"),
    limit: int = Query(300, ge=1, le=500),
):
    """Return Large/Medium ports within the given bounding box, capped at `limit`."""
    try:
        parts = [float(x) for x in bbox.split(",")]
        south, west, north, east = parts
    except Exception:
        return {"items": [], "error": "bbox must be south,west,north,east"}

    loop = asyncio.get_event_loop()
    rows = await loop.run_in_executor(_executor, _ensure_ports)

    results = []
    for r in rows:
        try:
            rlat = float(r.get("LATITUDE") or 0)
            rlon = float(r.get("LONGITUDE") or 0)
            if not (rlat or rlon):
                continue
            harbor_size = (r.get("HARBOR_SIZE") or "").strip().title()
            if harbor_size not in ("Large", "Medium"):
                continue
            # bbox filter (handle antimeridian wrap for west>east)
            if not (south <= rlat <= north):
                continue
            if west <= east:
                if not (west <= rlon <= east):
                    continue
            else:  # crosses antimeridian
                if not (rlon >= west or rlon <= east):
                    continue
            rec = {
                "lat": rlat,
                "lon": rlon,
                "name": _clean_infra_value(r.get("PORT_NAME")) or "Unknown Port",
                "country": _clean_infra_value(r.get("COUNTRY")),
                "harbor_type": _clean_infra_value(r.get("HARBOR_TYPE")),
                "harbor_size": harbor_size,
                "max_vessel_size": _clean_infra_value(r.get("MAX_VESSEL_SIZE")),
                "good_holding_ground": _clean_infra_value(r.get("GOOD_HOLDING_GROUND")),
                "infra_type": "port",
            }
            results.append(rec)
        except Exception:
            continue

    # Sort Large before Medium, then by name
    results.sort(key=lambda x: (0 if x["harbor_size"] == "Large" else 1, x["name"] or ""))
    return {"items": results[:limit], "total": len(results)}


# ── /api/infrastructure/chokepoints ──────────────────────────────────────────

_CHOKEPOINT_DEFS = [
    {
        "name": "Strait of Hormuz",
        "lat": 26.5, "lon": 56.4,
        "polygon_bounds": [25.5, 54.5, 27.5, 58.0],
        "strategic_description": "Controls ~20% of global oil trade. Connects Persian Gulf to Gulf of Oman.",
        "monitored_keywords": ["Strait of Hormuz", "Hormuz", "Persian Gulf shipping"],
    },
    {
        "name": "Suez Canal",
        "lat": 30.5, "lon": 32.4,
        "polygon_bounds": [29.9, 32.2, 31.3, 32.7],
        "strategic_description": "Connects Mediterranean to Red Sea. ~12% of global trade, 1 million barrels of oil daily.",
        "monitored_keywords": ["Suez Canal", "Suez", "Suez blockage"],
    },
    {
        "name": "Bab el-Mandeb",
        "lat": 12.6, "lon": 43.4,
        "polygon_bounds": [11.5, 42.5, 13.5, 44.5],
        "strategic_description": "Gateway between Red Sea and Gulf of Aden. Key oil and LNG route linking Europe and Asia.",
        "monitored_keywords": ["Bab el-Mandeb", "Bab-el-Mandeb", "Red Sea strait", "Houthi shipping"],
    },
    {
        "name": "Strait of Malacca",
        "lat": 3.0, "lon": 103.5,
        "polygon_bounds": [1.0, 99.0, 6.0, 105.0],
        "strategic_description": "World's most important shipping lane; ~80% of China's oil imports pass through.",
        "monitored_keywords": ["Strait of Malacca", "Malacca", "Malacca Strait", "South China Sea"],
    },
    {
        "name": "Strait of Gibraltar",
        "lat": 35.9, "lon": -5.6,
        "polygon_bounds": [35.7, -6.2, 36.2, -5.0],
        "strategic_description": "Atlantic–Mediterranean gateway. Critical NATO maritime passage.",
        "monitored_keywords": ["Strait of Gibraltar", "Gibraltar", "Mediterranean gateway"],
    },
    {
        "name": "Turkish Straits / Bosphorus",
        "lat": 41.1, "lon": 29.0,
        "polygon_bounds": [40.9, 28.5, 41.6, 29.5],
        "strategic_description": "Black Sea access. Turkey controls passage under Montreux Convention.",
        "monitored_keywords": ["Bosphorus", "Turkish Straits", "Dardanelles", "Black Sea access"],
    },
    {
        "name": "Danish Straits",
        "lat": 56.0, "lon": 10.5,
        "polygon_bounds": [55.0, 9.0, 58.0, 12.5],
        "strategic_description": "Baltic Sea access connecting to North Sea. Critical for Russian Baltic Fleet.",
        "monitored_keywords": ["Danish Straits", "Øresund", "Sound", "Kattegat", "Baltic access"],
    },
    {
        "name": "Strait of Lombok",
        "lat": -8.7, "lon": 115.7,
        "polygon_bounds": [-9.0, 115.3, -8.0, 116.2],
        "strategic_description": "Indonesian alternative to Malacca for deep-draft vessels.",
        "monitored_keywords": ["Strait of Lombok", "Lombok Strait", "Indonesian straits"],
    },
    {
        "name": "Mozambique Channel",
        "lat": -17.0, "lon": 40.5,
        "polygon_bounds": [-26.0, 35.0, -10.0, 47.0],
        "strategic_description": "Connects Indian Ocean south of Africa. Major oil tanker route.",
        "monitored_keywords": ["Mozambique Channel", "Mozambique", "Mozambique shipping"],
    },
    {
        "name": "Cape of Good Hope",
        "lat": -34.4, "lon": 18.5,
        "polygon_bounds": [-35.5, 17.5, -33.5, 20.0],
        "strategic_description": "Alternative route to Suez for very large crude carriers; used when Suez is unavailable.",
        "monitored_keywords": ["Cape of Good Hope", "Cape Route", "South Africa shipping"],
    },
    {
        "name": "Panama Canal",
        "lat": 9.0, "lon": -79.7,
        "polygon_bounds": [8.7, -80.2, 9.5, -79.2],
        "strategic_description": "Connects Atlantic and Pacific. Handles ~6% of global sea trade; drought-impacted in 2023.",
        "monitored_keywords": ["Panama Canal", "Panama", "Panama Canal restrictions"],
    },
    {
        "name": "Luzon Strait",
        "lat": 20.5, "lon": 121.5,
        "polygon_bounds": [19.0, 119.5, 22.0, 122.5],
        "strategic_description": "Deep-water passage between South China Sea and Pacific. Critical US Navy route.",
        "monitored_keywords": ["Luzon Strait", "Luzon", "South China Sea passage", "PLAN"],
    },
]


def _compute_chokepoint_status(cp: dict) -> dict:
    """
    Check last 48h of news conflict markers for keyword matches.
    >= 5 matches → disrupted
    >= 2 matches → elevated
    else → normal
    """
    keywords = [kw.lower() for kw in cp.get("monitored_keywords", [])]
    cutoff   = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    matches  = 0
    matched_headlines: list[str] = []

    # Check news conflict markers
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        for m in _NEWS_CONFLICT_MARKERS:
            if m.get("expires_at", "") < now_iso:
                continue
            if m.get("published", "") < cutoff:
                continue
            haystack = (m.get("headline") or "").lower()
            if any(kw in haystack for kw in keywords):
                matches += 1
                if len(matched_headlines) < 5:
                    matched_headlines.append(m.get("headline", ""))
    except Exception:
        pass

    if matches >= 5:
        status = "disrupted"
    elif matches >= 2:
        status = "elevated"
    else:
        status = "normal"

    return {
        **cp,
        "current_status":      status,
        "match_count":         matches,
        "recent_headlines":    matched_headlines,
    }


@app.get("/api/infrastructure/chokepoints")
async def api_infrastructure_chokepoints():
    """Return 12 global strategic chokepoints with computed current status and any auto-briefs."""
    loop    = asyncio.get_event_loop()
    results = await loop.run_in_executor(
        _executor,
        lambda: [_compute_chokepoint_status(cp) for cp in _CHOKEPOINT_DEFS]
    )
    # Fire background auto-brief generation for newly elevated chokepoints
    asyncio.create_task(_run_auto_chokepoint_briefs(results))

    # Attach any existing chokepoint briefs
    with _AUTO_BRIEF_LOCK:
        enriched = []
        for cp in results:
            name       = cp.get("name", "")
            status     = cp.get("current_status", "normal")
            store_key  = f"cp_{name}_{status}"
            entry      = _CHOKEPOINT_BRIEF_STORE.get(store_key)
            if entry:
                cp = {**cp, "auto_brief": entry["brief"], "auto_brief_at": entry["generated_at"]}
            enriched.append(cp)
    return {"chokepoints": enriched}


_OG_CACHE: dict[str, str | None] = {}

@app.get("/api/og")
async def get_og_image(url: str = Query(...)):
    """Return og:image URL for an article URL. Cached in-memory."""
    if url in _OG_CACHE:
        return {"thumbnail": _OG_CACHE[url]}
    try:
        import re as _re
        async with httpx.AsyncClient(timeout=6, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; AkiliBot/1.0)"})
        html = resp.text
        # Try both attribute orderings for og:image meta tag
        m = _re.search(
            r'<meta\s[^>]*property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']',
            html, _re.I
        ) or _re.search(
            r'<meta\s[^>]*content=["\']([^"\']+)["\'][^>]*property=["\']og:image["\']',
            html, _re.I
        )
        thumb = m.group(1).strip() if m else None
    except Exception:
        thumb = None
    _OG_CACHE[url] = thumb
    return {"thumbnail": thumb}


@app.get("/api/airports/nearby")
async def api_airports_nearby(lat: float, lon: float, radius_km: float = 150, limit: int = 5):
    try:
        airports = await asyncio.get_event_loop().run_in_executor(_executor, _ensure_airports)
    except Exception as exc:
        return {"airports": [], "error": str(exc)}
    results = []
    for row in airports:
        try:
            if row.get("type") == "closed":
                continue
            alat = float(row.get("latitude_deg")  or 0)
            alon = float(row.get("longitude_deg") or 0)
            if not alat and not alon:
                continue
            dist = _haversine_km(lat, lon, alat, alon)
            if dist <= radius_km:
                results.append({
                    "ident":        row.get("ident", ""),
                    "name":         row.get("name", ""),
                    "icao":         row.get("gps_code", "") or row.get("ident", ""),
                    "iata":         row.get("iata_code", ""),
                    "type":         row.get("type", ""),
                    "lat":          alat,
                    "lon":          alon,
                    "distance_km":  round(dist, 1),
                    "municipality": row.get("municipality", ""),
                    "country":      row.get("iso_country", ""),
                })
        except Exception:
            continue
    results.sort(key=lambda x: (_AIRPORT_TYPE_RANK.get(x["type"], 5), x["distance_km"]))
    return {"airports": results[:limit], "total": len(results)}



@app.get("/api/annotations")
async def api_get_annotations():
    p = BASE_DIR / "annotations.json"
    if not p.exists():
        return {"points": [], "zones": [], "links": []}
    try:
        return _json.loads(p.read_text())
    except Exception:
        return {"points": [], "zones": [], "links": []}


@app.post("/api/annotations")
async def api_post_annotations(request: Request):
    data = await request.json()
    (BASE_DIR / "annotations.json").write_text(_json.dumps(data, indent=2))
    return {"ok": True}


@app.post("/api/surface/detail-analyse")
async def detail_analyse_surface_item(payload: dict):
    """Enhanced surface analysis: [[Location]] markers, airport/ADSB context, 24h dedup."""
    item       = payload.get("item", {})
    profile    = payload.get("profile", None)
    airports   = payload.get("airports", [])
    adsb_count = int(payload.get("adsb_count", 0))

    cache_key = "detail:" + str(item.get("id", ""))
    cached    = usage_tracker.check_dedup(cache_key)
    if cached:
        return {"markdown": cached.get("result", ""), "cached": True,
                "cached_at": cached.get("stored_at", "")}

    if not client:
        return {"error": "Claude API not configured"}

    airport_ctx = ""
    if airports:
        lines       = [f"- {a['name']} ({a['icao']}), {a['distance_km']}km, {a['type']}"
                       for a in airports[:3]]
        airport_ctx = "NEARBY AIRPORTS:\n" + "\n".join(lines) + "\n"

    adsb_ctx = f"AIRCRAFT IN AREA: {adsb_count} aircraft within 200km\n" if adsb_count else ""

    profile_ctx = ""
    if profile:
        role    = profile.get("role", "")
        regions = ", ".join(profile.get("focusRegions", []))
        domains = ", ".join(profile.get("infraDomains", []))
        profile_ctx = f"\nANALYST CONTEXT: {role}"
        if regions: profile_ctx += f", focus regions: {regions}"
        if domains: profile_ctx += f", infrastructure domains: {domains}"

    system = (
        "You are a geopolitical intelligence analyst. Write a 3-paragraph assessment:\n"
        "  Para 1 — Situation summary\n"
        "  Para 2 — Risk and impact assessment\n"
        "  Para 3 — Recommended actions\n\n"
        "FORMAT RULE: whenever you name a specific location (country, city, airport, strait, port, "
        "airspace, region), wrap it in double square brackets so it renders as a clickable map link. "
        "Example: [[Kenya]], [[Nairobi]], [[Entebbe International Airport]], [[Gulf of Aden]]. "
        "Do NOT bracket generic nouns. Only proper named locations.\n"
        + profile_ctx
    )

    event_text = (
        f"HEADLINE: {item.get('headline', 'Unknown')}\n"
        f"LOCATION: {item.get('location', 'Unknown')}\n"
        f"TYPE: {item.get('type', 'Unknown')}\n"
        f"SEVERITY: {item.get('severity_tier', 'Unknown')}\n"
        f"CONTEXT: {item.get('context', '')}\n"
        f"{airport_ctx}{adsb_ctx}"
    )

    try:
        region_ctx = get_minimal_context()
    except Exception:
        region_ctx = ""

    try:
        response = client.messages.create(
            model      = "claude-sonnet-4-6",
            max_tokens = 650,
            system     = system + ("\n\n" + region_ctx if region_ctx else ""),
            messages   = [{"role": "user", "content": event_text}],
        )
        text = response.content[0].text
        usage_tracker.record_call(response.usage.input_tokens, response.usage.output_tokens)
        now_iso = datetime.now(timezone.utc).isoformat()
        usage_tracker.store_dedup(cache_key, {"result": text, "stored_at": now_iso})
        return {"markdown": text, "cached": False}
    except Exception as exc:
        return {"error": str(exc)}


# ══════════════════════════════════════════════════════════════════════════════
# PERSON OF INTEREST (POI) MODULE
# ══════════════════════════════════════════════════════════════════════════════

import uuid as _poi_uuid
import base64 as _b64
import subprocess as _subproc
import base64 as _b64

_POI_FILE        = BASE_DIR / "data" / "poi.json"
_POI_PHOTO_DIR   = BASE_DIR / "data" / "poi_photos"
_POI_INVEST: dict = {}   # poi_id → {status, results}
_POI_INVEST_LOCK  = threading.Lock()

def _poi_load() -> list:
    try:
        if _POI_FILE.exists():
            return _json.loads(_POI_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return []

def _poi_save(pois: list) -> None:
    _POI_FILE.parent.mkdir(parents=True, exist_ok=True)
    _POI_FILE.write_text(_json.dumps(pois, indent=2, ensure_ascii=False), encoding="utf-8")

@app.get("/api/poi")
async def poi_list():
    return _poi_load()

@app.post("/api/poi")
async def poi_create(body: dict = Body(...)):
    pois = _poi_load()
    poi  = {
        "id":           str(_poi_uuid.uuid4())[:12],
        "name":         body.get("name") or "New Profile",
        "tag":          body.get("tag", "unknown"),
        "notes":        body.get("notes", ""),
        "photo_path":   None,
        "identifiers":  body.get("identifiers", {}),
        "investigation_results": None,
        "created_at":   datetime.now(timezone.utc).isoformat(),
        "updated_at":   datetime.now(timezone.utc).isoformat(),
    }
    pois.append(poi)
    _poi_save(pois)
    return poi

@app.put("/api/poi/{poi_id}")
async def poi_update(poi_id: str, body: dict = Body(...)):
    pois = _poi_load()
    poi_idx = next((i for i, p in enumerate(pois) if p["id"] == poi_id), None)
    if poi_idx is None:
        raise HTTPException(404, "POI not found")

    # Handle profile photo upload (base64 data URL)
    photo_b64 = body.pop("photo_base64", None) or body.pop("photo_b64", None)
    if photo_b64:
        _POI_PHOTO_DIR.mkdir(parents=True, exist_ok=True)
        photo_path = _POI_PHOTO_DIR / f"{poi_id}.jpg"
        raw = photo_b64.split(",", 1)[-1] if "," in photo_b64 else photo_b64
        photo_path.write_bytes(_b64.b64decode(raw))
        pois[poi_idx]["photo_path"] = str(photo_path)
        print(f"[poi] photo saved for {poi_id} ({len(raw)} chars b64)")

    # Handle gallery image removals and additions
    gallery_remove_indices = body.pop("gallery_remove_indices", None) or []
    gallery_b64_add = body.pop("gallery_b64_add", None) or []

    if gallery_remove_indices or gallery_b64_add:
        _POI_PHOTO_DIR.mkdir(parents=True, exist_ok=True)
        current_gallery = list(pois[poi_idx].get("gallery_images", []))

        for idx in sorted(set(int(i) for i in gallery_remove_indices), reverse=True):
            if 0 <= idx < len(current_gallery):
                old_path = Path(current_gallery[idx])
                if old_path.exists():
                    try: old_path.unlink()
                    except Exception: pass
                current_gallery.pop(idx)

        for b64 in gallery_b64_add:
            n = len(current_gallery)
            gallery_path = _POI_PHOTO_DIR / f"{poi_id}_gallery_{n}.jpg"
            while gallery_path.exists():
                n += 1
                gallery_path = _POI_PHOTO_DIR / f"{poi_id}_gallery_{n}.jpg"
            try:
                raw = b64.split(",", 1)[-1] if "," in b64 else b64
                gallery_path.write_bytes(_b64.b64decode(raw))
                current_gallery.append(str(gallery_path))
            except Exception:
                pass

        pois[poi_idx]["gallery_images"] = current_gallery

    # Always strip gallery_images from body to prevent stale client list overwriting server state
    body.pop("gallery_images", None)

    # Handle bidirectional relations sync
    if "relations" in body:
        old_relations = pois[poi_idx].get("relations", [])
        new_relations = body.get("relations", [])
        old_rel_ids = {r["poi_id"] for r in old_relations if r.get("poi_id")}
        new_rel_ids = {r["poi_id"] for r in new_relations if r.get("poi_id")}
        added_ids   = new_rel_ids - old_rel_ids
        removed_ids = old_rel_ids - new_rel_ids
        current_name = body.get("name") or pois[poi_idx].get("name", "")

        for other_id in added_ids:
            rel = next((r for r in new_relations if r.get("poi_id") == other_id), None)
            if not rel: continue
            other_idx = next((i for i, p in enumerate(pois) if p["id"] == other_id), None)
            if other_idx is None: continue
            other_rels = list(pois[other_idx].get("relations", []))
            if not any(r.get("poi_id") == poi_id for r in other_rels):
                other_rels.append({
                    "poi_id": poi_id, "poi_name": current_name,
                    "relation_type": rel.get("relation_type", "associate"), "notes": "",
                })
                pois[other_idx]["relations"] = other_rels
                pois[other_idx]["updated_at"] = datetime.now(timezone.utc).isoformat()

        for other_id in removed_ids:
            other_idx = next((i for i, p in enumerate(pois) if p["id"] == other_id), None)
            if other_idx is None: continue
            pois[other_idx]["relations"] = [r for r in pois[other_idx].get("relations", []) if r.get("poi_id") != poi_id]
            pois[other_idx]["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Apply remaining fields
    for k, v in body.items():
        if k in ("id", "created_at"):
            continue
        if k == "last_investigation" and not v:
            continue
        pois[poi_idx][k] = v

    pois[poi_idx]["updated_at"] = datetime.now(timezone.utc).isoformat()
    _poi_save(pois)
    return pois[poi_idx]

@app.delete("/api/poi/{poi_id}")
async def poi_delete(poi_id: str):
    pois = _poi_load()
    poi = next((p for p in pois if p["id"] == poi_id), None)
    if poi:
        # Remove gallery images
        for img_path in poi.get("gallery_images", []):
            try:
                gp = Path(img_path)
                if gp.exists(): gp.unlink()
            except Exception: pass
        # Remove reverse relations from other POIs
        for other in pois:
            if other["id"] == poi_id: continue
            if any(r.get("poi_id") == poi_id for r in other.get("relations", [])):
                other["relations"] = [r for r in other.get("relations", []) if r.get("poi_id") != poi_id]
    pois = [p for p in pois if p["id"] != poi_id]
    _poi_save(pois)
    photo = _POI_PHOTO_DIR / f"{poi_id}.jpg"
    if photo.exists():
        try: photo.unlink()
        except Exception: pass
    return {"ok": True}

@app.get("/api/poi/{poi_id}/photo")
async def poi_photo(poi_id: str):
    photo = _POI_PHOTO_DIR / f"{poi_id}.jpg"
    if not photo.exists():
        raise HTTPException(404, "No photo")
    from fastapi.responses import FileResponse
    return FileResponse(str(photo), media_type="image/jpeg")

@app.get("/api/poi/{poi_id}/gallery/{idx}")
async def poi_gallery_image(poi_id: str, idx: int):
    pois = _poi_load()
    poi = next((p for p in pois if p["id"] == poi_id), None)
    if not poi:
        raise HTTPException(404, "POI not found")
    gallery = poi.get("gallery_images", [])
    if idx < 0 or idx >= len(gallery):
        raise HTTPException(404, "Gallery image not found")
    img_path = Path(gallery[idx])
    if not img_path.exists():
        raise HTTPException(404, "Gallery image file not found")
    from fastapi.responses import FileResponse
    return FileResponse(str(img_path), media_type="image/jpeg")

# ── Investigation runner ───────────────────────────────────────────────────

def _run_holehe(email: str) -> list:
    """Run holehe CLI, return list of {platform, url, found} for found-only."""
    try:
        r = _subproc.run(
            ["holehe", email, "--only-used", "--no-clear"],
            capture_output=True, text=True, timeout=60,
            cwd=str(BASE_DIR),
        )
        results = []
        for line in r.stdout.splitlines():
            line = line.strip()
            # holehe prints "[+] Platform" for found accounts
            if line.startswith("[+]"):
                parts = line[3:].strip().split()
                platform = parts[0] if parts else line[3:].strip()
                url_part = parts[1] if len(parts) > 1 else ""
                results.append({"platform": platform, "url": url_part, "found": True})
        return results
    except Exception as exc:
        return [{"error": str(exc)}]

def _run_sherlock(username: str, platforms: list | None = None) -> list:
    """Run sherlock CLI, return list of found URLs."""
    try:
        cmd = ["sherlock", username, "--timeout", "10", "--print-found", "--no-color"]
        if platforms:
            for p in platforms:
                cmd += ["--site", p]
        r = _subproc.run(
            cmd,
            capture_output=True, text=True, timeout=90,
            cwd=str(BASE_DIR),
        )
        results = []
        for line in r.stdout.splitlines():
            line = line.strip()
            if line.startswith("[+]"):
                # "[+] Platform: https://..."
                colon = line.find(":")
                if colon > 0:
                    rest = line[colon + 1:].strip()
                    platform = line[3:colon].strip()
                    results.append({"platform": platform, "url": rest})
                else:
                    results.append({"platform": line[3:].strip(), "url": ""})
        return results
    except Exception as exc:
        return [{"error": str(exc)}]

def _run_exif(photo_path: str) -> dict:
    """Extract EXIF data including GPS."""
    try:
        import exifread
        with open(photo_path, "rb") as fh:
            tags = exifread.process_file(fh, details=False)
        out = {}
        # GPS
        def _gps_val(tag):
            v = tags.get(tag)
            if v is None: return None
            ratios = v.values
            deg = float(ratios[0].num) / float(ratios[0].den)
            mn  = float(ratios[1].num) / float(ratios[1].den)
            sec = float(ratios[2].num) / float(ratios[2].den)
            return deg + mn / 60 + sec / 3600
        lat = _gps_val("GPS GPSLatitude")
        lon = _gps_val("GPS GPSLongitude")
        if lat is not None and lon is not None:
            lat_ref = str(tags.get("GPS GPSLatitudeRef", "N"))
            lon_ref = str(tags.get("GPS GPSLongitudeRef", "E"))
            if "S" in lat_ref: lat = -lat
            if "W" in lon_ref: lon = -lon
            out["gps_lat"] = round(lat, 6)
            out["gps_lon"] = round(lon, 6)
            # Reverse geocode
            try:
                geo = geocode_place(f"{lat},{lon}")
                if geo:
                    out["gps_location"] = geo.get("display_name", "")
            except Exception:
                pass
        for field, tag_key in [
            ("datetime",     "EXIF DateTimeOriginal"),
            ("device_make",  "Image Make"),
            ("device_model", "Image Model"),
            ("software",     "Image Software"),
        ]:
            v = tags.get(tag_key)
            if v:
                out[field] = str(v)
        return out
    except Exception as exc:
        return {"error": str(exc)}

def _run_phone(number: str) -> dict:
    """Query opencnam free tier for carrier/country."""
    try:
        clean = "".join(c for c in number if c.isdigit() or c == "+")
        url   = f"https://api.opencnam.com/v3/phone/{clean}?format=json"
        resp  = httpx.get(url, timeout=10)
        if resp.status_code == 200:
            return resp.json()
        return {"status": resp.status_code, "note": "no data from opencnam"}
    except Exception as exc:
        return {"error": str(exc)}

def _run_name_search(name: str) -> list:
    """Search surface pool and briefings for name mentions."""
    name_lower = name.lower()
    matches = []
    # Search surface pool
    with _SURFACE_POOL_LOCK:
        pool_copy = list(_SURFACE_POOL)
    for item in pool_copy:
        text = f"{item.get('headline','')} {item.get('context','')}".lower()
        if name_lower in text:
            matches.append({
                "source": "surface_pool",
                "headline": item.get("headline", ""),
                "location": item.get("location", ""),
                "date": item.get("published_at") or item.get("date", ""),
            })
    # Search briefings
    try:
        briefings_dir = BASE_DIR / "briefings"
        if briefings_dir.exists():
            for f in sorted(briefings_dir.glob("*.json"))[-10:]:
                try:
                    b = _json.loads(f.read_text())
                    text = _json.dumps(b).lower()
                    if name_lower in text:
                        matches.append({
                            "source": "briefing",
                            "headline": b.get("title") or b.get("headline", f.stem),
                            "location": "",
                            "date": b.get("created_at", ""),
                        })
                except Exception:
                    pass
    except Exception:
        pass
    return matches[:10]

def _investigate_worker(poi_id: str, identifiers: dict, photo_path: str | None, platforms: list | None = None) -> None:
    """Background thread: run all applicable tools, update _POI_INVEST cache."""
    results = {"holehe": None, "sherlock": None, "exif": None, "phone": None, "mentions": None}

    with _POI_INVEST_LOCK:
        _POI_INVEST[poi_id] = {"status": "running", "results": results}

    def _set(key, val):
        with _POI_INVEST_LOCK:
            _POI_INVEST[poi_id]["results"][key] = val

    threads = []

    if identifiers.get("email"):
        t = threading.Thread(target=lambda: _set("holehe", _run_holehe(identifiers["email"])), daemon=True)
        t.start(); threads.append(t)

    if identifiers.get("username"):
        uname = identifiers["username"]
        plats = platforms or []
        t = threading.Thread(target=lambda: _set("sherlock", _run_sherlock(uname, plats)), daemon=True)
        t.start(); threads.append(t)

    if photo_path and Path(photo_path).exists():
        t = threading.Thread(target=lambda: _set("exif", _run_exif(photo_path)), daemon=True)
        t.start(); threads.append(t)

    if identifiers.get("phone"):
        t = threading.Thread(target=lambda: _set("phone", _run_phone(identifiers["phone"])), daemon=True)
        t.start(); threads.append(t)

    if identifiers.get("full_name"):
        t = threading.Thread(target=lambda: _set("mentions", _run_name_search(identifiers["full_name"])), daemon=True)
        t.start(); threads.append(t)

    for t in threads:
        t.join(timeout=120)

    _complete_at = datetime.now(timezone.utc).isoformat()
    with _POI_INVEST_LOCK:
        _POI_INVEST[poi_id]["status"] = "complete"
        _POI_INVEST[poi_id]["run_at"] = _complete_at

    # Build last_investigation record and persist to poi.json
    try:
        with _POI_INVEST_LOCK:
            final_results = dict(_POI_INVEST[poi_id]["results"])

        run_at = _complete_at

        # Pre-compute graph nodes/edges so frontend can render without re-deriving
        graph_nodes: list = [{"id": "__poi__", "type": "poi", "label": "POI"}]
        graph_edges: list = []
        for r in (final_results.get("holehe") or []):
            if r.get("found") and not r.get("error"):
                nid = f"h_{r['platform']}"
                graph_nodes.append({"id": nid, "type": "email", "label": r["platform"], "url": r.get("url")})
                graph_edges.append({"source": "__poi__", "target": nid})
        for r in (final_results.get("sherlock") or []):
            if not r.get("error"):
                nid = f"s_{r['platform']}"
                graph_nodes.append({"id": nid, "type": "social", "label": r["platform"], "url": r.get("url")})
                graph_edges.append({"source": "__poi__", "target": nid})
        phone = final_results.get("phone")
        if phone and not phone.get("error") and phone.get("carrier"):
            graph_nodes.append({"id": "phone_nd", "type": "phone", "label": phone["carrier"]})
            graph_edges.append({"source": "__poi__", "target": "phone_nd"})

        last_inv = {
            "run_at": run_at,
            "status": "complete",
            "results": final_results,
            "graph_nodes": graph_nodes,
            "graph_edges": graph_edges,
        }

        pois = _poi_load()
        for p in pois:
            if p["id"] == poi_id:
                p["last_investigation"] = last_inv
                p["updated_at"] = run_at
                break
        _poi_save(pois)
    except Exception:
        pass

@app.post("/api/poi/{poi_id}/investigate")
async def poi_investigate(poi_id: str, request: Request):
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    platforms = body.get("platforms") or []
    print(f"[poi-investigate] {poi_id} platforms={platforms}")
    pois = _poi_load()
    poi  = next((p for p in pois if p["id"] == poi_id), None)
    if not poi:
        raise HTTPException(404, "POI not found")
    with _POI_INVEST_LOCK:
        current = _POI_INVEST.get(poi_id, {})
        if current.get("status") == "running":
            return {"started": False, "note": "already running"}
    threading.Thread(
        target=_investigate_worker,
        args=(poi_id, poi.get("identifiers", {}), poi.get("photo_path"), platforms),
        daemon=True,
    ).start()
    return {"started": True}

@app.get("/api/poi/{poi_id}/investigate/results")
async def poi_investigate_results(poi_id: str):
    with _POI_INVEST_LOCK:
        state = _POI_INVEST.get(poi_id)
    if state is None:
        pois = _poi_load()
        poi  = next((p for p in pois if p["id"] == poi_id), None)
        if poi and poi.get("last_investigation"):
            li = poi["last_investigation"]
            return {"status": "complete", "results": li["results"], "run_at": li.get("run_at")}
        # fallback: old investigation_results field
        if poi and poi.get("investigation_results"):
            return {"status": "complete", "results": poi["investigation_results"]}
        return {"status": "idle", "results": {}}
    return {"status": state["status"], "results": state.get("results", {}), "run_at": state.get("run_at")}

# ══════════════════════════════════════════════════════════════════════════════
# NAMED INFRASTRUCTURE DATASETS
# Pipelines (GEM), Shipping Routes (hardcoded), Cables (named queries),
# and Naval Deployments.
# ══════════════════════════════════════════════════════════════════════════════

# ── Dataset paths ─────────────────────────────────────────────────────────────
_PIPELINES_PATH          = BASE_DIR / "data" / "pipelines.json"
_SHIPPING_ROUTES_PATH    = BASE_DIR / "data" / "shipping_routes.json"
_DEPLOYMENTS_PATH        = BASE_DIR / "data" / "deployments.json"
print(f"[init] BASE_DIR={BASE_DIR} DATA_DIR={DATA_DIR} deployments_exists={_DEPLOYMENTS_PATH.exists()}")
_MIL_ENRICHMENT_PATH     = BASE_DIR / "data" / "military_enrichment.json"
_CABLE_GEO_PATH          = BASE_DIR.parent / "public" / "data" / "cable-geo.json"
_LANDING_GEO_PATH        = BASE_DIR.parent / "public" / "data" / "landing-point-geo.json"

# ── Military enrichment ───────────────────────────────────────────────────────
_MILITARY_ENRICHMENT: list = []
try:
    _MILITARY_ENRICHMENT = _json.loads(_MIL_ENRICHMENT_PATH.read_text())
    print(f"[mil_enrich] loaded {len(_MILITARY_ENRICHMENT)} entries")
except Exception:
    pass

def _mil_enrich_match(name: str) -> dict | None:
    """Fuzzy-match an Overpass military feature name against enrichment entries."""
    nl = name.lower().strip()
    for entry in _MILITARY_ENRICHMENT:
        el = (entry.get("name") or "").lower().strip()
        if el and (el in nl or nl in el):
            return entry
    return None

# ── Pipeline dataset ──────────────────────────────────────────────────────────
_PIPELINES_DATA:   dict  = {}
_PIPELINES_LOCK    = threading.Lock()

def _load_pipelines() -> dict:
    with _PIPELINES_LOCK:
        global _PIPELINES_DATA
        try:
            raw = _json.loads(_PIPELINES_PATH.read_text())
            _PIPELINES_DATA = raw
        except Exception as ex:
            print(f"[pipelines] load failed: {ex}")
            _PIPELINES_DATA = {"pipelines": [], "error": str(ex)}
        return _PIPELINES_DATA

def _refresh_pipelines_from_remote() -> None:
    """Try to download fresh pipeline data from GEM. Background thread safe."""
    URLS = [
        "https://raw.githubusercontent.com/GlobalEnergyMonitor/GOPIT/refs/heads/main/data/pipelines.geojson",
        "https://raw.githubusercontent.com/GlobalEnergyMonitor/GOPIT/main/data/GOPIT_pipelines.geojson",
    ]
    raw = None
    for URL in URLS:
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": "NAGINI/2.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = _json.loads(r.read())
            if raw.get("features"):
                break
        except Exception as ex:
            print(f"[pipelines] URL {URL} failed: {ex}")
            raw = None
    if not raw:
        print("[pipelines] all remote URLs failed — pipeline data unavailable")
        return
    try:
        features = raw.get("features", [])
        pipelines = []
        for i, feat in enumerate(features):
            props = feat.get("properties") or {}
            geom  = feat.get("geometry") or {}
            gtype = geom.get("type", "")
            coords_list = [geom["coordinates"]] if gtype == "LineString" else geom.get("coordinates", [])
            total_km = 0.0
            for coords in coords_list:
                for j in range(1, len(coords)):
                    x1,y1 = coords[j-1]; x2,y2 = coords[j]
                    dlat = math.radians(y2-y1); dlon = math.radians(x2-x1)
                    a = math.sin(dlat/2)**2 + math.cos(math.radians(y1))*math.cos(math.radians(y2))*math.sin(dlon/2)**2
                    total_km += 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))
            pipelines.append({
                "id":           props.get("id") or props.get("GEM_phase_id") or f"gem_{i}",
                "name":         props.get("pipeline_name") or props.get("name") or "Unknown Pipeline",
                "operator":     props.get("operator") or props.get("Owner") or "",
                "type":         (props.get("Fuel") or props.get("fuel") or "gas").lower(),
                "status":       (props.get("Status") or props.get("status") or "operating").lower(),
                "country":      props.get("Countries") or props.get("country") or "",
                "length_km":    round(total_km, 1),
                "route_geojson":{"type": gtype, "coordinates": geom.get("coordinates", [])},
            })
        out = {
            "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "source": "Global Energy Monitor GOPIT",
            "pipelines": pipelines,
        }
        _PIPELINES_PATH.write_text(_json.dumps(out, ensure_ascii=False))
        with _PIPELINES_LOCK:
            global _PIPELINES_DATA
            _PIPELINES_DATA = out
        print(f"[pipelines] refreshed from remote: {len(pipelines)} pipelines")
    except Exception as ex:
        print(f"[pipelines] remote refresh failed: {ex}")

_load_pipelines()

# ── Shipping routes dataset ────────────────────────────────────────────────────
_SHIPPING_ROUTES: list = []
try:
    _SHIPPING_ROUTES = _json.loads(_SHIPPING_ROUTES_PATH.read_text())
    print(f"[shipping_routes] loaded {len(_SHIPPING_ROUTES)} named routes")
except Exception as ex:
    print(f"[shipping_routes] load failed: {ex}")

# ── Cable dataset (loaded lazily from public/data/) ────────────────────────────
_CABLE_DATA:   dict  = {}
_CABLE_LOADED: bool  = False
_CABLE_LOCK    = threading.Lock()

def _get_cable_data() -> dict:
    global _CABLE_DATA, _CABLE_LOADED
    with _CABLE_LOCK:
        if _CABLE_LOADED:
            return _CABLE_DATA
        try:
            cables_raw   = _json.loads(_CABLE_GEO_PATH.read_text())
            landings_raw = _json.loads(_LANDING_GEO_PATH.read_text())
            cables   = cables_raw.get("features", [])
            landings = landings_raw.get("features", [])
            # Build landing-point → cable name associations
            CELL = 0.5
            grid: dict = {}
            for feat in cables:
                geom  = feat.get("geometry") or {}
                name  = (feat.get("properties") or {}).get("name", "")
                for line in (geom.get("coordinates", []) if geom.get("type") == "MultiLineString" else [geom.get("coordinates", [])]):
                    for (lng, lat) in line:
                        key = (round(lat / CELL), round(lng / CELL))
                        grid.setdefault(key, []).append(name)
            landing_cables: dict = {}
            for feat in landings:
                geom = feat.get("geometry") or {}
                if geom.get("type") != "Point":
                    continue
                lng, lat = geom["coordinates"]
                key = (round(lat / CELL), round(lng / CELL))
                nearby = set()
                for dl in range(-1, 2):
                    for dm in range(-1, 2):
                        for n in grid.get((key[0]+dl, key[1]+dm), []):
                            nearby.add(n)
                pid = (feat.get("properties") or {}).get("id", "")
                if pid:
                    landing_cables[pid] = list(nearby)
            _CABLE_DATA    = {"cables": cables, "landings": landings, "landing_cables": landing_cables}
            _CABLE_LOADED  = True
            print(f"[cables] loaded {len(cables)} cables, {len(landings)} landing points")
        except Exception as ex:
            print(f"[cables] load failed: {ex}")
            _CABLE_DATA    = {"cables": [], "landings": [], "landing_cables": {}}
            _CABLE_LOADED  = True
        return _CABLE_DATA

# ── Deployments dataset ────────────────────────────────────────────────────────
def _load_deployments() -> dict:
    print(f"[deployments] reading from {_DEPLOYMENTS_PATH} (exists={_DEPLOYMENTS_PATH.exists()})")
    try:
        return _json.loads(_DEPLOYMENTS_PATH.read_text())
    except Exception as ex:
        print(f"[deployments] load failed: {ex}")
        return {"carrier_strike_groups": [], "amphibious_ready_groups": [], "notable_surface_units": []}

# ── Fuzzy name match helper ────────────────────────────────────────────────────
def _name_matches(query: str, target: str) -> bool:
    """Case-insensitive substring match."""
    if not query or not target:
        return False
    return query.lower() in target.lower()

def _haversine_infra(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1); dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlon/2)**2
    return R * 2 * math.asin(min(1.0, math.sqrt(a)))

def _route_passes_near(coords: list, lat: float, lon: float, radius_km: float) -> bool:
    """True if any segment of the route passes within radius_km of (lat, lon)."""
    for (lng, clat) in coords:
        if _haversine_infra(lat, lon, clat, lng) <= radius_km:
            return True
    return False


# ── Endpoints: Pipelines ──────────────────────────────────────────────────────

@app.get("/api/infrastructure/pipelines")
def api_pipelines_search(
    name:    str = Query(None, description="Fuzzy name search"),
    status:  str = Query(None, description="Filter by status: operating|construction|proposed"),
    type:    str = Query(None, description="Filter by type: oil|gas|lng"),
    limit:   int = Query(2000, ge=1, le=5000),
    country: str = Query(None, description="Filter by country substring"),
    refresh: bool = Query(False, description="Force remote refresh (background)"),
):
    """Search named pipelines from the GEM GOPIT dataset."""
    if refresh:
        threading.Thread(target=_refresh_pipelines_from_remote, daemon=True).start()
    data = _PIPELINES_DATA
    pipelines = list(data.get("pipelines", []))
    if name:
        pipelines = [p for p in pipelines if _name_matches(name, p.get("name",""))]
    if status:
        pipelines = [p for p in pipelines if (p.get("status","") or "").lower().startswith(status.lower())]
    if type:
        pipelines = [p for p in pipelines if (p.get("type","") or "").lower().startswith(type.lower())]
    if country:
        pipelines = [p for p in pipelines if _name_matches(country, p.get("country",""))]
    return {
        "pipelines":    pipelines[:limit],
        "total":        len(pipelines),
        "last_updated": data.get("last_updated"),
        "source":       data.get("source"),
    }


@app.get("/api/infrastructure/pipelines/near")
def api_pipelines_near(
    lat:    float = Query(...),
    lon:    float = Query(...),
    radius: float = Query(200, description="Search radius in km"),
):
    """Return pipelines whose route passes within radius km of the given coordinates."""
    pipelines = _PIPELINES_DATA.get("pipelines", [])
    results = []
    for p in pipelines:
        geom   = p.get("route_geojson") or {}
        gtype  = geom.get("type","")
        coords_lists = [geom["coordinates"]] if gtype == "LineString" else geom.get("coordinates", [])
        for coords in coords_lists:
            if _route_passes_near(coords, lat, lon, radius):
                results.append(p)
                break
    return {"pipelines": results, "total": len(results)}


# ── Endpoints: Shipping Routes ─────────────────────────────────────────────────

@app.get("/api/infrastructure/shipping-routes")
def api_shipping_routes(
    chokepoint: str   = Query(None, description="Filter by chokepoint ID substring"),
    near_lat:   float = Query(None),
    near_lon:   float = Query(None),
    radius:     float = Query(200, description="Search radius in km (used with near_lat/near_lon)"),
):
    """Return named strategic shipping route segments."""
    routes = list(_SHIPPING_ROUTES)
    if chokepoint:
        routes = [r for r in routes if any(chokepoint.lower() in cp for cp in r.get("chokepoints", []))]
    if near_lat is not None and near_lon is not None:
        def route_near(r) -> bool:
            for (lng, lat) in r.get("coordinates", []):
                if _haversine_infra(near_lat, near_lon, lat, lng) <= radius:
                    return True
            return False
        routes = [r for r in routes if route_near(r)]
    return {"routes": routes, "total": len(routes)}


# ── Endpoints: Cables ─────────────────────────────────────────────────────────

@app.get("/api/infrastructure/cables")
def api_cables(
    name:     str   = Query(None, description="Fuzzy name search"),
    country:  str   = Query(None, description="Filter cables landing in country (name substring)"),
    near_lat: float = Query(None),
    near_lon: float = Query(None),
    radius:   float = Query(200, description="Search radius in km for landing points"),
):
    """Query submarine cables by name, country, or proximity of landing points."""
    cd = _get_cable_data()
    cables   = cd["cables"]
    landings = cd["landings"]

    if name:
        cables = [f for f in cables if _name_matches(name, (f.get("properties") or {}).get("name",""))]

    elif country:
        # Find landing points matching country, then get their associated cable names
        country_cable_names: set = set()
        for feat in landings:
            props = feat.get("properties") or {}
            if _name_matches(country, props.get("country","")) or _name_matches(country, props.get("name","")):
                pid = props.get("id","")
                for cname in cd["landing_cables"].get(pid, []):
                    country_cable_names.add(cname)
        cables = [f for f in cables if (f.get("properties") or {}).get("name","") in country_cable_names]

    elif near_lat is not None and near_lon is not None:
        # Find landing points within radius, get their cable names
        near_cable_names: set = set()
        for feat in landings:
            geom = feat.get("geometry") or {}
            if geom.get("type") != "Point":
                continue
            lng, lat = geom["coordinates"]
            if _haversine_infra(near_lat, near_lon, lat, lng) <= radius:
                pid = (feat.get("properties") or {}).get("id","")
                for cname in cd["landing_cables"].get(pid, []):
                    near_cable_names.add(cname)
        cables = [f for f in cables if (f.get("properties") or {}).get("name","") in near_cable_names]

    # Strip full geometry if more than 5 results (just return metadata)
    def summarise(feat):
        props = feat.get("properties") or {}
        geom  = feat.get("geometry") or {}
        return {
            "name":       props.get("name",""),
            "id":         props.get("id",""),
            "color":      props.get("color",""),
            "rfs":        props.get("rfs",""),
            "length":     props.get("length",""),
            "owners":     props.get("owners",""),
            "has_geometry": bool(geom.get("coordinates")),
        }

    if len(cables) == 1:
        feat  = cables[0]
        props = feat.get("properties") or {}
        return {
            "cables": [feat],
            "total":  1,
            "name":   props.get("name",""),
        }

    return {"cables": [summarise(f) for f in cables[:100]], "total": len(cables)}


# ── Endpoints: Deployments ────────────────────────────────────────────────────

@app.get("/api/debug/paths")
def api_debug_paths():
    """Debug: return resolved filesystem paths and file existence."""
    import os as _os
    dep = _DEPLOYMENTS_PATH
    data_dir = Path(DATA_DIR)
    event_store_path = data_dir / "event_store.json"
    return {
        "BASE_DIR": str(BASE_DIR),
        "DATA_DIR": DATA_DIR,
        "deployments_path": str(dep),
        "deployments_exists": dep.exists(),
        "deployments_size": dep.stat().st_size if dep.exists() else None,
        "event_store_path": str(event_store_path),
        "event_store_exists": event_store_path.exists(),
        "cwd": _os.getcwd(),
        "railway_env": _os.getenv("RAILWAY_ENVIRONMENT", ""),
        "data_dir_files": sorted([f.name for f in data_dir.iterdir()]) if data_dir.exists() else [],
        "base_dir_data_files": sorted([f.name for f in (BASE_DIR / "data").iterdir()]) if (BASE_DIR / "data").exists() else [],
    }


@app.get("/api/deployments")
def api_deployments_get():
    """Return current known naval deployments."""
    return _load_deployments()


@app.put("/api/deployments")
def api_deployments_put(payload: dict = Body(...)):
    """Replace the deployments file with the provided payload."""
    try:
        _DEPLOYMENTS_PATH.write_text(_json.dumps(payload, indent=2, ensure_ascii=False))
        return {"ok": True, "last_updated": payload.get("last_updated")}
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex))



