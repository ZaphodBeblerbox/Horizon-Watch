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
import uuid
import socket as _socket
import time as time_module
import time
import asyncio
import threading
import json as _json
import csv as _csv
import io as _io
import shutil as _shutil
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
from fastapi import FastAPI, HTTPException, Query, Request, Depends, UploadFile, File, Form
from fastapi.responses import Response as FastAPIResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import anthropic
import feedparser
from email.utils import parsedate_to_datetime

from rss_feeds import ADDITIONAL_SCAN_FEEDS, RSS_FEED_META, LOCAL_CITY_FEEDS
from database import get_db

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
from article_intelligence import analyse_article
import usage_tracker
from classifier import classify_event
import event_store as es
import event_bridge
import threat_matrix
from alert_writer import write_alert as _write_alert_base, write_news_article

def write_alert(alert_dict: dict):
    """Write alert to DB and feed to fusion engine."""
    result = _write_alert_base(alert_dict)
    # Feed every alert to the fusion engine for multi-domain correlation
    try:
        if _fusion_engine:
            _fusion_engine.on_signal({
                "signal_id":     alert_dict.get("id") or result or "",
                "domain":        (alert_dict.get("source") or alert_dict.get("domain") or "UNKNOWN").upper(),
                "rule_name":     alert_dict.get("alert_type") or alert_dict.get("rule_name") or "",
                "severity":      alert_dict.get("severity") or "medium",
                "confidence":    float(alert_dict.get("confidence") or 0.8),
                "relevance_score": float(alert_dict.get("relevance_score") or 50),
                "lat":           alert_dict.get("lat"),
                "lon":           alert_dict.get("lon"),
                "country":       alert_dict.get("country_code") or alert_dict.get("country"),
                "summary":       (alert_dict.get("title") or "")[:200],
                "created_at":    datetime.now(timezone.utc).isoformat(),
            })
    except Exception:
        pass
    return result
from sanctions_loader import sanctions_loader
from entity_linker import entity_linker
from event_bus import event_bus, Events

try:
    from langdetect import detect as _langdetect_detect
    _HAS_LANGDETECT = True
except ImportError:
    _HAS_LANGDETECT = False
    print("[startup] WARNING: langdetect not installed — translation disabled. Run: pip install langdetect")

try:
    import spacy as _spacy
    try:
        _nlp = _spacy.load("en_core_web_sm")
    except OSError:
        import subprocess, sys
        print("[startup] en_core_web_sm not found — downloading now…")
        subprocess.run(
            [sys.executable, "-m", "spacy", "download", "en_core_web_sm"],
            check=True, capture_output=True
        )
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
        "https://horizon-watch-production.up.railway.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ── Static response cache (ETag + Cache-Control for heavy GeoJSON endpoints) ──
import hashlib as _hashlib
_static_resp_cache: dict = {}

def _cached_json_response(key: str, data_func, max_age: int = 3600):
    import time as _time_mod
    now = _time_mod.time()
    entry = _static_resp_cache.get(key)
    if entry is None or entry["expires"] < now:
        import json as _json_mod
        data = data_func()
        body = _json_mod.dumps(data)
        etag = _hashlib.md5(body.encode()).hexdigest()[:16]
        entry = {"body": body, "etag": etag, "expires": now + max_age}
        _static_resp_cache[key] = entry
    return FastAPIResponse(
        content=entry["body"],
        media_type="application/json",
        headers={"Cache-Control": f"public, max-age={max_age}", "ETag": entry["etag"]},
    )

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
    # detectors imported below after path setup
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
from routers import tile_proxy as _tile_proxy_router
from routers import analytics as _analytics_router
app.include_router(_auth_router.router)
app.include_router(_admin_router.router)
app.include_router(_intel_router.router)
app.include_router(_briefings_router.router)
app.include_router(_infra_router.router)
app.include_router(_tile_proxy_router.router)
app.include_router(_analytics_router.router)

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

try:
    from detectors.ais_detector import AISAnomalyDetector as _AISAnomalyDetector
    from detectors.adsb_detector import ADSBPatternDetector as _ADSBPatternDetector
    from detectors.threat_engine import ThreatEngine as _ThreatEngine
    from detectors.correlation_engine import (
        CorrelationEngine as _CorrelationEngine,
        EscalationEngine as _EscalationEngine,
        DarkShipDetector as _DarkShipDetector,
        ADSBLoiterDetector as _ADSBLoiterDetector,
        ChokepointActivityDetector as _ChokepointActivityDetector,
        NewsPatternEngine as _NewsPatternEngine,
        NEWS_PATTERNS as _NEWS_PATTERNS,
        news_pattern_engine as _news_pattern_engine,
    )
    _HAS_DETECTORS = True
except ImportError as _det_err:
    print(f"[startup] detectors not available: {_det_err}")
    _HAS_DETECTORS = False

try:
    from fusion_engine import fusion_engine as _fusion_engine
    _HAS_FUSION = True
except ImportError as _fe_err:
    print(f"[startup] fusion engine not available: {_fe_err}")
    _fusion_engine = None
    _HAS_FUSION = False

try:
    from surge_engine import surge_engine as _surge_engine
    _HAS_SURGE = True
except ImportError as _se_err:
    print(f"[startup] surge engine not available: {_se_err}")
    _surge_engine = None
    _HAS_SURGE = False

_api_key = os.getenv("ANTHROPIC_API_KEY")
if not _api_key:
    print("[startup] WARNING: ANTHROPIC_API_KEY is not set — /analyse will return an error until a key is provided.")

client = anthropic.Anthropic(api_key=_api_key) if _api_key else None

CLAUDE_BUDGET_USD             = float(os.getenv("CLAUDE_BUDGET_USD",             "10.0"))
CLAUDE_DAILY_HARD_CAP_USD     = float(os.getenv("CLAUDE_DAILY_HARD_CAP_USD",     "10.0"))
MAX_LLM_ARTICLE_CALLS_PER_DAY = int(  os.getenv("MAX_LLM_ARTICLE_CALLS_PER_DAY", "500"))

_COPERNICUS_CLIENT_ID = os.getenv("COPERNICUS_CLIENT_ID", "").strip()
_COPERNICUS_CLIENT_SECRET = os.getenv("COPERNICUS_CLIENT_SECRET", "").strip()

# ── Auth configuration ────────────────────────────────────────────────────────
if _COPERNICUS_CLIENT_ID and _COPERNICUS_CLIENT_SECRET:
    print("[startup] Copernicus credentials detected — satellite search will prefer OAuth mode.")
else:
    print("[startup] Copernicus credentials missing — satellite search will use public mode.")

_analysis_cache: dict = {}
_geocode_proxy_cache: dict[tuple[str, int], list[dict]] = {}
_nominatim_search_cache: dict[str, tuple[list, float]] = {}  # { query_lower: (results, ts) }
_NOMINATIM_CACHE_TTL = 300  # 5 minutes
_zone_image_cache: dict[str, list[str]] = {}  # zone_id → [url, ...]

_ZONE_SEARCH_QUERIES: dict[str, list[str]] = {
    "SZONE-001": ["Ukraine war Donbas 2023", "Bakhmut battle", "Zaporizhzhia front"],
    "SZONE-002": ["Taiwan Strait warship", "PLA Navy exercise", "Taiwan military"],
    "SZONE-003": ["Sudan Khartoum war 2023", "RSF Sudan", "Darfur conflict"],
    "SZONE-004": ["Gaza Strip conflict 2023", "Iron Dome Israel", "Gaza airstrike"],
    "SZONE-005": ["South China Sea island", "Spratly Islands aerial", "PLAN warship"],
    "SZONE-006": ["Sahel Mali military", "Burkina Faso insurgency", "Niger coup 2023"],
    "SZONE-007": ["Natanz nuclear facility", "Iran ballistic missile", "Isfahan nuclear"],
    "SZONE-008": ["Korean DMZ soldiers", "North Korea missile launch", "DPRK military"],
    "SZONE-009": ["Myanmar civil war 2022", "Burma military junta", "Mandalay protest"],
    "SZONE-010": ["Gulf of Aden ship", "Houthi attack vessel", "Red Sea shipping"],
    "SZONE-011": ["Baltic Sea NATO warship", "Kaliningrad Russia", "Baltic exercise"],
    "SZONE-012": ["Aleppo Syria ruins", "Syria war aftermath", "Damascus Syria"],
    "SZONE-013": ["Strait of Hormuz oil tanker", "IRGC patrol boat", "Persian Gulf ship"],
    "SZONE-014": ["Tigray Ethiopia war", "Addis Ababa Ethiopia", "Horn of Africa"],
    "SZONE-015": ["Venezuela Caracas crisis", "Essequibo border", "Venezuela protest"],
}

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
        except FileNotFoundError:
            print(f"[static_infra] {path.name} not found — skipping (will use DB or download)")
            return []
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

# ── Director background job queue ────────────────────────────────────────────
_DIRECTOR_JOBS: dict = {}   # job_id → { status, progress, intent, created_at, result, error }

# ── Last prepared intelligence picture ───────────────────────────────────────
_last_intelligence_picture: dict = {}

# ── Anomaly alerts ───────────────────────────────────────────────────────────
_ANOMALY_ALERTS: list = []

# ── ADS-B and AIS history recording throttle ─────────────────────────────────
_ADSB_LAST_RECORDED: dict = {}   # icao24 → last record timestamp (float)
_AIS_LAST_RECORDED:  dict = {}   # mmsi   → last record timestamp (float)

# ── News conflict extraction state ────────────────────────────────────────────
_NEWS_CONFLICT_MARKERS: list = []
_NEWS_ARTICLE_STORE: dict[str, dict] = {}   # url -> enriched article snapshot (may have lat/lon None)
_NEWS_STORE_LOCK = threading.Lock()
_PROCESSED_URLS: dict = {}       # url → timestamp (float), evicted after 72h
_PROCESSED_URLS_TTL = 72 * 3600  # 72 hours in seconds
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
    _today_spend = usage_tracker.get_today_cost()
    _article_calls_today = usage_tracker.get_calls_today_by_type("article_intelligence")
    usage["today_cost_usd"]       = round(_today_spend, 4)
    usage["daily_cap_usd"]        = CLAUDE_DAILY_HARD_CAP_USD
    usage["cap_remaining_usd"]    = round(max(0.0, CLAUDE_DAILY_HARD_CAP_USD - _today_spend), 4)
    usage["cap_pct_used"]         = round(_today_spend / CLAUDE_DAILY_HARD_CAP_USD * 100) if CLAUDE_DAILY_HARD_CAP_USD > 0 else 0
    usage["article_calls_today"]  = _article_calls_today
    usage["article_calls_cap"]    = MAX_LLM_ARTICLE_CALLS_PER_DAY

    return {
        "backend": {
            "status":  "ok",
            "ping_ms": ping_ms,
            "version": "2.0",
        },
        "data_sources": sources,
        "claude_usage": usage,
    }


# ── Storage API ───────────────────────────────────────────────────────────────

def _fmt_bytes(n: int) -> str:
    if n >= 1 << 30: return f"{n / (1<<30):.2f} GB"
    if n >= 1 << 20: return f"{n / (1<<20):.1f} MB"
    if n >= 1 << 10: return f"{n / (1<<10):.1f} KB"
    return f"{n} B"


@app.get("/api/storage/stats")
def get_storage_stats():
    import subprocess as _sp

    # ── Disk ─────────────────────────────────────────────────────────────────
    disk_raw = _sp.run(
        "df -h / | tail -1", capture_output=True, text=True, shell=True
    ).stdout.strip().split()

    # ── Database file ─────────────────────────────────────────────────────────
    db_path = os.path.join(DATA_DIR, "akili.db")
    db_bytes = os.path.getsize(db_path) if os.path.exists(db_path) else 0

    # ── Table row counts via SQLite ───────────────────────────────────────────
    table_counts: dict = {}
    try:
        import sqlite3 as _sqlite3
        conn = _sqlite3.connect(db_path)
        cur  = conn.cursor()
        tables = cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        for (tname,) in tables:
            table_counts[tname] = cur.execute(
                f"SELECT COUNT(*) FROM [{tname}]"
            ).fetchone()[0]
        freelist = cur.execute("PRAGMA freelist_count").fetchone()[0]
        page_size = cur.execute("PRAGMA page_size").fetchone()[0]
        reclaimable_bytes = freelist * page_size
        conn.close()
    except Exception as _dbe:
        reclaimable_bytes = 0
        print(f"[storage] db audit error: {_dbe}")

    # ── ML models ─────────────────────────────────────────────────────────────
    model_files = ["yolov8n.pt", "yolov8n.onnx", "yolov8n-obb.pt", "yolov8n-obb.onnx"]
    model_bytes = sum(
        os.path.getsize(os.path.join(BASE_DIR, f))
        for f in model_files
        if os.path.exists(os.path.join(BASE_DIR, f))
    )

    # ── Geocode cache ─────────────────────────────────────────────────────────
    geocache_dir = os.path.join(DATA_DIR, "geocode_cache")
    geocache_bytes = 0
    geocache_files = 0
    if os.path.isdir(geocache_dir):
        for fn in os.listdir(geocache_dir):
            fp = os.path.join(geocache_dir, fn)
            if os.path.isfile(fp):
                geocache_bytes += os.path.getsize(fp)
                geocache_files += 1

    # ── Event store ───────────────────────────────────────────────────────────
    es_path = os.path.join(DATA_DIR, "event_store.json")
    event_store_bytes = os.path.getsize(es_path) if os.path.exists(es_path) else 0

    # ── Sentinel images (PNG cache) ───────────────────────────────────────────
    sentinel_result = _sp.run(
        f'find {DATA_DIR} -name "*.png" 2>/dev/null | wc -l',
        capture_output=True, text=True, shell=True
    ).stdout.strip()
    sentinel_images = int(sentinel_result) if sentinel_result.isdigit() else 0

    sentinel_bytes_result = _sp.run(
        f'find {DATA_DIR} -name "*.png" -exec du -sb {{}} + 2>/dev/null | awk \'{{sum+=$1}} END {{print sum+0}}\'',
        capture_output=True, text=True, shell=True
    ).stdout.strip()
    sentinel_bytes = int(sentinel_bytes_result) if sentinel_bytes_result.isdigit() else 0

    # ── Python venv ───────────────────────────────────────────────────────────
    venv_raw = _sp.run(
        "du -sb /app/.venv 2>/dev/null | cut -f1 || echo 0",
        capture_output=True, text=True, shell=True
    ).stdout.strip().split("\n")[0]
    venv_bytes = int(venv_raw) if venv_raw.isdigit() else 0

    # ── Top tables by rough size estimate ─────────────────────────────────────
    top_tables = sorted(
        [{"table": k, "rows": v} for k, v in table_counts.items()],
        key=lambda x: x["rows"], reverse=True
    )[:10]

    return {
        "disk": {
            "total":   disk_raw[1] if len(disk_raw) > 1 else "?",
            "used":    disk_raw[2] if len(disk_raw) > 2 else "?",
            "free":    disk_raw[3] if len(disk_raw) > 3 else "?",
            "percent": disk_raw[4] if len(disk_raw) > 4 else "?",
        },
        "database": {
            "bytes":            db_bytes,
            "human":            _fmt_bytes(db_bytes),
            "reclaimable_bytes": reclaimable_bytes,
            "reclaimable_human": _fmt_bytes(reclaimable_bytes),
            "top_tables":       top_tables,
        },
        "ml_models": {
            "bytes": model_bytes,
            "human": _fmt_bytes(model_bytes),
            "files": model_files,
        },
        "geocoder_cache": {
            "bytes": geocache_bytes,
            "human": _fmt_bytes(geocache_bytes),
            "files": geocache_files,
        },
        "event_store": {
            "bytes": event_store_bytes,
            "human": _fmt_bytes(event_store_bytes),
        },
        "sentinel_images": {
            "count": sentinel_images,
            "bytes": sentinel_bytes,
            "human": _fmt_bytes(sentinel_bytes),
        },
        "venv": {
            "bytes": venv_bytes,
            "human": _fmt_bytes(venv_bytes),
        },
    }


@app.post("/api/storage/clear-geocache")
def storage_clear_geocache():
    geocache_dir = os.path.join(DATA_DIR, "geocode_cache")
    if not os.path.isdir(geocache_dir):
        return {"cleared_bytes": 0, "files_deleted": 0}
    cleared = 0
    deleted = 0
    for fn in os.listdir(geocache_dir):
        fp = os.path.join(geocache_dir, fn)
        if os.path.isfile(fp):
            try:
                cleared += os.path.getsize(fp)
                os.remove(fp)
                deleted += 1
            except Exception:
                pass
    print(f"[storage] geocache cleared: {deleted} files, {_fmt_bytes(cleared)}")
    return {"cleared_bytes": cleared, "cleared_human": _fmt_bytes(cleared), "files_deleted": deleted}


@app.post("/api/storage/clear-sentinel-cache")
def storage_clear_sentinel():
    import subprocess as _sp
    result = _sp.run(
        f'find {DATA_DIR} -name "*.png" 2>/dev/null',
        capture_output=True, text=True, shell=True
    )
    files = [f.strip() for f in result.stdout.strip().splitlines() if f.strip()]
    cleared = 0
    deleted = 0
    for fp in files:
        try:
            cleared += os.path.getsize(fp)
            os.remove(fp)
            deleted += 1
        except Exception:
            pass
    print(f"[storage] sentinel cache cleared: {deleted} files, {_fmt_bytes(cleared)}")
    return {"cleared_bytes": cleared, "cleared_human": _fmt_bytes(cleared), "files_deleted": deleted}


@app.post("/api/storage/prune-history")
async def storage_prune_history(request: Request):
    """Delete aircraft_history, vessel_history, and track_density rows older
    than `days` days, then run VACUUM to reclaim disk space."""
    body = await request.json()
    days = max(1, int(body.get("days", 7)))
    import sqlite3 as _sqlite3, datetime as _dt

    db_path   = os.path.join(DATA_DIR, "akili.db")
    cutoff    = (_dt.datetime.utcnow() - _dt.timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    size_before = os.path.getsize(db_path) if os.path.exists(db_path) else 0

    deleted: dict = {}
    try:
        conn = _sqlite3.connect(db_path, timeout=30)
        cur  = conn.cursor()
        for table in ("aircraft_history", "vessel_history"):
            cur.execute(f"DELETE FROM [{table}] WHERE timestamp < ?", (cutoff,))
            deleted[table] = cur.rowcount
        # track_density — prune by hour column
        cur.execute("DELETE FROM track_density WHERE hour < ?", (cutoff,))
        deleted["track_density"] = cur.rowcount
        conn.commit()
        print(f"[storage] pruned rows: {deleted}")
        print(f"[storage] running VACUUM…")
        conn.execute("VACUUM")
        conn.close()
    except Exception as _e:
        print(f"[storage] prune error: {_e}")
        return {"ok": False, "error": str(_e)}

    size_after  = os.path.getsize(db_path) if os.path.exists(db_path) else 0
    reclaimed   = size_before - size_after
    return {
        "ok":             True,
        "days_kept":      days,
        "deleted":        deleted,
        "size_before":    _fmt_bytes(size_before),
        "size_after":     _fmt_bytes(size_after),
        "reclaimed":      _fmt_bytes(max(reclaimed, 0)),
        "reclaimed_bytes": max(reclaimed, 0),
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

    context_block = profile_context + mission_context

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
    context_block = profile_context + mission_context

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
NEWS_CACHE_TTL = 5 * 60  # seconds (reduced from 15m to 5m for fresher data)

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
    use_spacy: bool = True,
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
    for loc in extract_locations_gazetteer(text_blob, use_spacy=use_spacy):
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
_GLOBAL_ADSB_CACHE: dict = {}  # icao(upper) → aircraft dict with 'last_seen' float

GLOBAL_ADSB_REGIONS = [
    {"name": "Europe/Middle East", "lat": 40.0,  "lon": 22.5,  "dist": 3000},
    {"name": "East Asia",          "lat": 27.5,  "lon": 105.0, "dist": 3000},
    {"name": "Americas",           "lat": 25.0,  "lon": -80.0, "dist": 3000},
    {"name": "Africa",             "lat": -12.5, "lon": 17.5,  "dist": 3000},
    {"name": "South Asia/Oceania", "lat": -5.0,  "lon": 120.0, "dist": 3000},
]

@app.get("/adsb")
@_response_cache(expire=30)
def get_adsb(
    lat:  float = Query(...),
    lon:  float = Query(...),
    dist: int   = Query(250),
):
    """Live ADS-B aircraft from adsb.lol within dist nautical miles of lat/lon. Cached 30 s."""
    key = f"{round(lat, 2)},{round(lon, 2)},{dist}"
    cached = _adsb_cache.get(key)
    if cached and (time.time() - cached["ts"]) < 30:
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
    now_ts = time.time()
    _adsb_cache[key] = {"ts": now_ts, "data": aircraft}
    # Populate global cache from viewport results too
    for ac in aircraft:
        _GLOBAL_ADSB_CACHE[ac["icao"]] = {**ac, "hex": ac["icao"], "last_seen": now_ts}
    # Record to history (throttled — only new records, once per aircraft per minute)
    try:
        _record_adsb_history(aircraft)
    except Exception:
        pass
    return {"aircraft": aircraft}


# ── Aviation enrichment: route + photo ────────────────────────────────────────

from services.flight_route_service   import get_route  as _get_route
from services.aircraft_photo_service import get_photo  as _get_photo
from services.vessel_photo_service   import get_photo  as _get_vessel_photo
import services.director_service as _director_svc

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


# ── Director Mode ─────────────────────────────────────────────────────────────

@app.get("/api/director/snapshot")
async def director_snapshot():
    """Return a compact intelligence snapshot for the Director prompt (<4 000 tokens)."""
    with _SURFACE_POOL_LOCK:
        surface_pool = list(_SURFACE_POOL)

    # Aggregate any recently cached ADS-B aircraft across all per-region cache entries
    now_ts = time.time()
    adsb_latest: list[dict] = []
    seen_icao: set[str] = set()
    for entry in _adsb_cache.values():
        if now_ts - entry.get("ts", 0) < 120:   # only entries fresher than 2 min
            for ac in (entry.get("data") or []):
                icao = ac.get("icao") or ac.get("hex") or ""
                if icao and icao not in seen_icao:
                    seen_icao.add(icao)
                    adsb_latest.append(ac)

    snapshot = _director_svc.build_snapshot(
        surface_pool=surface_pool,
        ais_vessels=_AIS_VESSELS,
        adsb_cache_latest=adsb_latest,
        event_store_fn=es.get_active_events,
        active_profile=_ACTIVE_PROFILE,
        static_airports=_STATIC_AIRPORTS,
        static_ports=_STATIC_PORTS,
    )
    return snapshot


@app.post("/api/director/generate")
async def director_generate(
    request: Request,
    current_user=Depends(get_optional_user),
):
    """
    Generate a director briefing.
    - With body { "intent": "..." } → uses existing snapshot-based generation (legacy path)
    - Without body / empty intent → uses intelligence picture + Claude Opus (new path)
    """
    if not client:
        raise HTTPException(503, "Claude client not configured")

    try:
        body = await request.json()
    except Exception:
        body = {}

    intent   = (body.get("intent") or "").strip()
    snapshot = body.get("snapshot") or {}

    # ── Legacy path: intent provided → existing snapshot-based generation ─────
    if intent:
        if not isinstance(snapshot, dict) or not snapshot:
            with _SURFACE_POOL_LOCK:
                surface_pool = list(_SURFACE_POOL)
            now_ts = time.time()
            adsb_latest: list[dict] = []
            seen_icao: set[str] = set()
            for entry in _adsb_cache.values():
                if now_ts - entry.get("ts", 0) < 120:
                    for ac in (entry.get("data") or []):
                        icao = ac.get("icao") or ac.get("hex") or ""
                        if icao and icao not in seen_icao:
                            seen_icao.add(icao)
                            adsb_latest.append(ac)
            snapshot = _director_svc.build_snapshot(
                surface_pool=surface_pool,
                ais_vessels=_AIS_VESSELS,
                adsb_cache_latest=adsb_latest,
                event_store_fn=es.get_active_events,
                active_profile=_ACTIVE_PROFILE,
                static_airports=_STATIC_AIRPORTS,
                static_ports=_STATIC_PORTS,
            )
        loop = asyncio.get_event_loop()
        try:
            sequence = await asyncio.wait_for(
                loop.run_in_executor(
                    _executor,
                    lambda: _director_svc.generate_sequence(
                        intent=intent,
                        snapshot=snapshot,
                        client=client,
                        usage_tracker=usage_tracker,
                        profile=_ACTIVE_PROFILE,
                    ),
                ),
                timeout=200,
            )
        except asyncio.TimeoutError:
            raise HTTPException(504, "Director generation timed out — try a shorter briefing intent")
        except ValueError as exc:
            raise HTTPException(502, str(exc))
        return sequence

    # ── Intelligence picture path: no intent → full Opus briefing ────────────
    global _last_intelligence_picture
    loop = asyncio.get_event_loop()

    from briefing_prep import prepare_intelligence_picture as _prep_ip
    _fe = _fusion_engine  # capture ref for lambda
    try:
        pic = await asyncio.wait_for(
            loop.run_in_executor(
                _executor,
                lambda: _prep_ip(
                    db=next(_db_gen()),
                    forge_alerts=list(_forge_alerts),
                    fusion_engine_instance=_fe,
                ),
            ),
            timeout=30,
        )
    except Exception as _e:
        raise HTTPException(500, f"Intelligence picture failed: {_e}")

    _last_intelligence_picture = pic

    # Truncate picture for prompt to avoid token blowout
    def _truncated_pic(p: dict) -> dict:
        import copy
        t = copy.deepcopy(p)
        if len(t.get("ais_anomalies", [])) > 5:
            t["ais_anomalies"] = t["ais_anomalies"][:5]
        if len(t.get("adsb_anomalies", [])) > 5:
            t["adsb_anomalies"] = t["adsb_anomalies"][:5]
        return t

    def _json_default(obj):
        if hasattr(obj, "isoformat"):
            return obj.isoformat()
        return str(obj)
    pic_str = _json.dumps(_truncated_pic(pic), ensure_ascii=False, separators=(",", ":"), default=_json_default)
    pic_str = pic_str[:8000]  # hard cap — keeps prompt fast and avoids token blowout

    _BRIEFING_SYSTEM = (
        "You are a senior intelligence analyst presenting a classified briefing "
        "to a strategic decision-maker. You have access to a real-time intelligence "
        "picture combining AIS vessel tracking, ADS-B aircraft monitoring, satellite "
        "imagery analysis, and news intelligence.\n\n"
        "Generate a structured briefing as a JSON array of segments. Each segment "
        "represents one camera position on a globe and one narrative point. Be "
        "specific, factual, and use only the data provided. Do not invent events "
        "or locations not in the data.\n\n"
        "Rules:\n"
        "- If no significant activity exists for a domain, do not fabricate it\n"
        "- Every location must have real coordinates from the data provided\n"
        "- Segments should flow geographically where possible\n"
        "- Lead with the most critical fusion events\n"
        "- End with a trend summary and watch items\n"
        "Return ONLY a valid JSON array. No preamble, no markdown fences."
    )
    _BRIEFING_USER = (
        "Generate an intelligence briefing from this real-time picture.\n\n"
        "INTELLIGENCE PICTURE:\n" + pic_str + "\n\n"
        "Return a JSON array where each element has:\n"
        '{"segment_index": integer, "title": "ALL CAPS SHORT TITLE", '
        '"narrative": "3-6 sentences. Specific, factual, analyst voice.", '
        '"lat": float, "lon": float, '
        '"altitude": float (50000-150000 incident, 300000-600000 regional, '
        '1000000-3000000 global), '
        '"markers": [{"lat":f,"lon":f,"label":"short","icon_type":"ALERT","severity":"medium"}], '
        '"source_type": "fusion|surge|ais|adsb|sentinel|news|overview", '
        '"source_id": "id or null", '
        '"zone_ids": ["SZONE-xxx"]}\n\n'
        "Briefing structure:\n"
        "1. One global overview segment (altitude ~4000000)\n"
        "2. Segments for each active fusion event (most critical first)\n"
        "3. Segments for elevated regions with active signals\n"
        "4. Segments for notable AIS/ADSB anomalies in strategic zones\n"
        "5. Segments for Sentinel detections if present\n"
        "6. One closing trend segment\n\n"
        "Minimum 5, maximum 30 segments. Quality over quantity."
    )

    def _call_claude():
        raw = ""
        with client.messages.stream(
            model="claude-sonnet-4-5-20251015",
            max_tokens=1500,
            system=_BRIEFING_SYSTEM,
            messages=[{"role": "user", "content": _BRIEFING_USER}],
        ) as stream:
            for chunk in stream.text_stream:
                raw += chunk
        final = stream.get_final_message()
        usage_tracker.record_call(
            final.usage.input_tokens,
            final.usage.output_tokens,
            call_type="director_briefing",
            headline="Director: intelligence picture briefing",
        )
        return raw.strip()

    try:
        raw = await asyncio.wait_for(
            loop.run_in_executor(_executor, _call_claude),
            timeout=200,
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "Briefing generation timed out")
    except Exception as _claude_err:
        raise HTTPException(502, f"Briefing generation failed: {_claude_err}")

    # Parse JSON
    segments = _parse_briefing_json(raw)
    if not segments:
        raise HTTPException(502, f"Failed to parse briefing JSON. Raw: {raw[:300]}")

    return {
        "segments":   segments,
        "generated_at": pic["generated_at"],
        "statistics": pic["statistics"],
        "threat_overview": pic["threat_overview"],
    }


def _parse_briefing_json(raw: str) -> list:
    """Tolerant JSON parser for the segments array."""
    import re as _re2
    text = raw.strip()
    # Strip markdown fences
    text = _re2.sub(r"^```(?:json)?\s*", "", text)
    text = _re2.sub(r"\s*```$", "", text)
    # Find first [ ... ]
    bracket = text.find("[")
    if bracket >= 0:
        text = text[bracket:]
    try:
        result = _json.loads(text)
        if isinstance(result, list):
            return result
    except Exception:
        pass
    # Try to find just the array part
    match = _re2.search(r"\[.*\]", text, _re2.DOTALL)
    if match:
        try:
            result = _json.loads(match.group(0))
            if isinstance(result, list):
                return result
        except Exception:
            pass
    return []


def _db_gen():
    """One-shot generator yielding a single DB session."""
    from database import get_db as _gdb_ip
    with _gdb_ip() as _sess:
        yield _sess


@app.post("/api/director/prepare-briefing")
async def director_prepare_briefing(current_user=Depends(get_optional_user)):
    """
    Aggregate all active intelligence signals into a structured picture.
    Stores the result in memory for GET /api/director/intelligence-picture.
    """
    global _last_intelligence_picture
    loop = asyncio.get_event_loop()
    from briefing_prep import prepare_intelligence_picture as _prep_ip
    _fe = _fusion_engine
    try:
        pic = await asyncio.wait_for(
            loop.run_in_executor(
                _executor,
                lambda: _prep_ip(
                    db=next(_db_gen()),
                    forge_alerts=list(_forge_alerts),
                    fusion_engine_instance=_fe,
                ),
            ),
            timeout=30,
        )
    except Exception as _e:
        raise HTTPException(500, f"Intelligence picture failed: {_e}")
    _last_intelligence_picture = pic
    return pic


@app.get("/api/director/intelligence-picture")
async def director_intelligence_picture(current_user=Depends(get_optional_user)):
    """Return the most recently prepared intelligence picture."""
    if not _last_intelligence_picture:
        asyncio.create_task(director_prepare_briefing(current_user=None))
        return {
            "status":  "preparing",
            "message": "Intelligence picture is being compiled. Retry in 30 seconds.",
            "regions": [],
            "alerts":  [],
            "fusions": [],
        }
    return _last_intelligence_picture


@app.post("/api/director/save")
async def director_save(
    request: Request,
    current_user=Depends(get_optional_user),
):
    """Persist a director sequence to disk and add to _BRIEFING_STORE."""
    body = await request.json()
    sequence = body.get("sequence") or body
    if not isinstance(sequence, dict) or "actions" not in sequence:
        raise HTTPException(400, "sequence with actions is required")
    # Accept optional transcript and intent from the request body
    transcript = body.get("transcript") or _director_svc.sequence_to_transcript(sequence)
    intent     = body.get("intent") or sequence.get("intent", "Director Briefing")
    path       = _director_svc.save_sequence(sequence)
    seq_id     = sequence.get("id") or path

    # Push to main briefing store so it appears in the Briefings tab
    username = current_user.get("username", "analyst") if isinstance(current_user, dict) else str(current_user)
    briefing_entry = {
        "id":          seq_id,
        "type":        "director",
        "title":       intent[:120],
        "content":     transcript,
        "actions":     sequence.get("actions", []),
        "created_at":  sequence.get("created_at") or datetime.now(timezone.utc).isoformat(),
        "created_by":  username,
        "action_count": len(sequence.get("actions", [])),
    }
    with _BRIEFING_LOCK:
        _BRIEFING_STORE.append(briefing_entry)
        if len(_BRIEFING_STORE) > 50:
            _BRIEFING_STORE[:] = _BRIEFING_STORE[-50:]
        _save_briefing_store(_BRIEFING_STORE)

    return {"saved": True, "path": path, "id": seq_id}


@app.post("/api/director/submit")
async def director_submit(
    request: Request,
    current_user=Depends(get_optional_user),
):
    """Submit a director briefing request for background generation. Returns job_id immediately."""
    if not client:
        raise HTTPException(503, "Claude client not configured")

    body = await request.json()
    intent = (body.get("intent") or "").strip()
    if not intent:
        raise HTTPException(400, "intent is required")

    job_id = str(uuid.uuid4())
    _DIRECTOR_JOBS[job_id] = {
        "status":     "generating",
        "progress":   "Building intelligence snapshot...",
        "intent":     intent,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "result":     None,
        "error":      None,
    }

    async def _run():
        try:
            _DIRECTOR_JOBS[job_id]["progress"] = "Analyzing intelligence data..."
            # Build snapshot (same logic as generate endpoint)
            with _SURFACE_POOL_LOCK:
                surface_pool = list(_SURFACE_POOL)
            now_ts2 = time.time()
            adsb_latest2: list[dict] = []
            seen2: set[str] = set()
            for entry in _adsb_cache.values():
                if now_ts2 - entry.get("ts", 0) < 120:
                    for ac in (entry.get("data") or []):
                        icao = ac.get("icao") or ac.get("hex") or ""
                        if icao and icao not in seen2:
                            seen2.add(icao)
                            adsb_latest2.append(ac)
            snapshot = _director_svc.build_snapshot(
                surface_pool=surface_pool,
                ais_vessels=_AIS_VESSELS,
                adsb_cache_latest=adsb_latest2,
                event_store_fn=es.get_active_events,
                active_profile=_ACTIVE_PROFILE,
                static_airports=_STATIC_AIRPORTS,
                static_ports=_STATIC_PORTS,
            )
            _DIRECTOR_JOBS[job_id]["progress"] = "Claude is composing your briefing..."
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                _executor,
                lambda: _director_svc.generate_sequence(
                    intent=intent,
                    snapshot=snapshot,
                    client=client,
                    usage_tracker=usage_tracker,
                    profile=_ACTIVE_PROFILE,
                ),
            )
            _DIRECTOR_JOBS[job_id]["progress"] = "Briefing ready!"
            _DIRECTOR_JOBS[job_id]["status"]   = "complete"
            _DIRECTOR_JOBS[job_id]["result"]   = result

            # Auto-save to _BRIEFING_STORE so the result survives page refresh
            try:
                transcript = _director_svc.sequence_to_transcript(result) if hasattr(_director_svc, "sequence_to_transcript") else ""
                _now_iso = datetime.now(timezone.utc).isoformat()
                briefing_entry = {
                    "id":           job_id,
                    "type":         "director",
                    "title":        intent[:120],
                    "content":      transcript,
                    "actions":      result.get("actions", []) if isinstance(result, dict) else [],
                    "result":       result,
                    "created_at":   _now_iso,
                    "generated_at": _now_iso,
                    "created_by":   "auto",
                    "action_count": len(result.get("actions", [])) if isinstance(result, dict) else 0,
                }
                with _BRIEFING_LOCK:
                    _BRIEFING_STORE.append(briefing_entry)
                    if len(_BRIEFING_STORE) > 50:
                        _BRIEFING_STORE[:] = _BRIEFING_STORE[-50:]
                    _save_briefing_store(_BRIEFING_STORE)
                print(f"[DIRECTOR] Auto-saved briefing '{intent[:60]}' to store")
            except Exception as _save_exc:
                print(f"[DIRECTOR] Auto-save failed (non-fatal): {_save_exc}")

        except Exception as exc:
            print(f"[DIRECTOR] Background generation failed: {exc}")
            _DIRECTOR_JOBS[job_id]["status"] = "error"
            _DIRECTOR_JOBS[job_id]["error"]  = str(exc)

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "generating"}


@app.get("/api/director/status/{job_id}")
async def director_status(
    job_id: str,
    current_user=Depends(get_optional_user),
):
    """Poll the status of a background director generation job."""
    job = _DIRECTOR_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    elapsed_seconds = 0
    try:
        created = datetime.fromisoformat(job["created_at"])
        elapsed_seconds = int((datetime.utcnow() - created).total_seconds())
    except Exception:
        pass
    response = {
        "job_id":          job_id,
        "status":          job["status"],
        "progress":        job["progress"],
        "intent":          job["intent"],
        "created_at":      job["created_at"],
        "elapsed_seconds": elapsed_seconds,
    }
    if job["status"] == "complete":
        response["result"] = job["result"]
    elif job["status"] == "error":
        response["error"] = job["error"]
    return response


@app.get("/api/director/video-search")
async def director_video_search(
    q: str,
    current_user=Depends(get_optional_user),
):
    """Search Wikimedia Commons for a short video clip. Falls back to None if not found."""
    import urllib.parse as _urlparse

    def _search():
        url    = "https://commons.wikimedia.org/w/api.php"
        params = {
            "action":     "query",
            "generator":  "search",
            "gsrsearch":  f"{q} filetype:video",
            "gsrnamespace": 6,
            "gsrlimit":   5,
            "prop":       "imageinfo|info",
            "iiprop":     "url|mime|size|duration",
            "format":     "json",
        }
        try:
            r = requests.get(url, params=params, headers={"User-Agent": "HorizonWatch/2.0"}, timeout=10)
            return r.json() if r.status_code == 200 else None
        except Exception:
            return None

    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(_executor, _search)

    if data and "query" in data and "pages" in data.get("query", {}):
        for page_id, page in data["query"]["pages"].items():
            imageinfo = (page.get("imageinfo") or [{}])[0]
            mime      = imageinfo.get("mime", "")
            if mime.startswith("video/") or mime == "image/gif":
                return {
                    "video_url": imageinfo.get("url"),
                    "mime":      mime,
                    "duration":  imageinfo.get("duration"),
                    "caption":   page.get("title", "").replace("File:", ""),
                }
    return {"video_url": None, "fallback": True}


@app.get("/api/director/test-briefing")
async def director_test_briefing():
    """Return a handcrafted test briefing that exercises every major action handler."""
    return {
        "title": "Director Mode Diagnostic — Strait of Hormuz Full Handler Test",
        "intent": "test",
        "actions": [
            # ── Scene 1: Intro — country highlights ───────────────────────────
            {"action": "fly_to", "lat": 26.3, "lon": 55.5, "zoom": 6, "duration": 3000},
            {"action": "highlight_country", "name": "Iran", "context": "focus", "label": "IRGCN ZONE"},
            {"action": "highlight_country", "name": "Oman", "context": "allied"},
            {"action": "highlight_country", "name": "United Arab Emirates", "context": "allied"},
            {"action": "narrate", "heading": "STRAIT OF HORMUZ CRISIS", "text": "Twenty-one percent of the world's liquid petroleum passes through the Strait of Hormuz daily. IRGCN forces have deployed patrol boats to the narrows as tensions escalate over Iranian nuclear activity."},
            # ── Scene 2: Chokepoint + place_event + place_location ────────────
            {"action": "show_chokepoint", "name": "Strait of Hormuz"},
            {"action": "place_event", "title": "Tanker Interdiction Zone", "lat": 26.44, "lon": 56.35,
             "type": "maritime", "severity": "critical",
             "summary": "IRGCN patrol boats establishing interdiction line across the inbound TSS lane.",
             "source": "UKMTO"},
            {"action": "place_location", "name": "Bandar Abbas", "lat": 27.19, "lon": 56.27,
             "type": "base", "description": "Primary IRGCN surface fleet base — home to fast-attack craft and mine-laying vessels."},
            {"action": "place_location", "name": "Abu Musa Island", "lat": 25.88, "lon": 55.03,
             "type": "base", "description": "Iranian military installation with YJ-12 anti-ship missile batteries — 150km range covers entire strait."},
            {"action": "place_image_marker", "name": "Bandar Abbas Port", "lat": 27.19, "lon": 56.27,
             "query": "Bandar Abbas Iran naval port IRGC", "caption": "IRGCN HQ — fast-attack craft home port", "size": "medium"},
            {"action": "place_image_marker", "name": "Abu Musa Island", "lat": 25.88, "lon": 55.03,
             "query": "Abu Musa Island Iran Persian Gulf aerial", "caption": "Iranian garrison with anti-ship missile batteries", "size": "small"},
            {"action": "narrate", "heading": "FORCE POSTURE", "text": "Bandar Abbas hosts the IRGCN surface fleet. Abu Musa Island, one hundred and fifty kilometres to the west, carries anti-ship missile batteries capable of reaching any vessel in the strait."},
            # ── Scene 3: Abu Musa missile range circle (animated expand) ──────
            {"action": "fly_to", "lat": 26.00, "lon": 55.50, "zoom": 7, "duration": 2500},
            {"action": "draw_circle", "center": [25.88, 55.03], "radius_km": 150,
             "color": "#ff3333", "label": "Anti-ship missile range (150km)",
             "fill": True, "animated_expand": True, "expand_duration": 2500},
            {"action": "place_image_marker", "name": "YJ-12 Anti-Ship Missile", "lat": 25.88, "lon": 55.03,
             "query": "YJ-12 anti-ship cruise missile China military", "caption": "Mach 3+ sea-skimming — 400km range", "size": "small"},
            {"action": "narrate", "heading": "MISSILE THREAT ENVELOPE", "text": "The animated circle shows the one hundred and fifty kilometre threat envelope of Abu Musa Island's anti-ship missile batteries. Every vessel transiting the strait falls within this range."},
            # ── Scene 4: IRGCN patrol vector arrow — Bandar Abbas south through water
            {"action": "fly_to", "lat": 26.70, "lon": 56.25, "zoom": 7, "duration": 2000},
            # From Bandar Abbas [27.19, 56.27] south-southwest through the strait channel
            # to interdiction point [26.38, 56.25] — entirely in water east of Musandam
            {"action": "place_image_marker", "name": "IRGC Fast Attack Craft", "lat": 26.90, "lon": 56.30,
             "query": "IRGC Iran fast attack boat speedboat naval", "caption": "Armed with C-802 missiles and RPGs", "size": "small"},
            {"action": "draw_arrow",
             "from": [27.19, 56.27],
             "to":   [26.38, 56.25],
             "color": "#ff4444", "label": "IRGCN patrol vector"},
            {"action": "narrate", "heading": "IRGCN PATROL VECTOR", "text": "The patrol vector arrow traces the IRGCN route south from Bandar Abbas, through the deep-water channel east of Qeshm Island, toward the traffic separation scheme narrows."},
            # ── Scene 5: TSS shipping lanes — precise water-following paths ───
            {"action": "clear_scene"},
            {"action": "fly_to", "lat": 26.30, "lon": 56.45, "zoom": 8, "duration": 2500},
            {"action": "show_chokepoint", "name": "Strait of Hormuz"},
            # Inbound TSS lane: Gulf of Oman → Persian Gulf
            # Arc AROUND Musandam — tip is at 26.38°N, 56.27°E
            # All points pass east and south of the tip, confirmed in water
            {"action": "draw_animated_line",
             "points": [
                 [25.20, 57.20],   # Gulf of Oman — well southeast, open water
                 [25.50, 57.00],   # Approach corridor
                 [25.80, 56.80],   # Along Oman coast — in water
                 [26.00, 56.65],   # Curving north toward narrows
                 [26.15, 56.52],   # Approaching narrows
                 [26.25, 56.43],   # South of Musandam tip — in water
                 [26.32, 56.37],   # Just south/east of tip — CRITICAL in water
                 [26.38, 56.32],   # Clearing the tip — stays east of 56.27°E
                 [26.42, 56.27],   # North side of narrows — entering Gulf
                 [26.50, 56.18],   # Clearing into Persian Gulf
                 [26.60, 56.05],   # Open Gulf
                 [26.75, 55.90]    # Into the Gulf proper
             ],
             "color": "#00ccff", "duration": 4000, "label": "Inbound TSS lane", "dashed": False},
            # Outbound TSS lane: Persian Gulf → Gulf of Oman
            # Runs slightly north of inbound lane, same water corridor
            {"action": "draw_animated_line",
             "points": [
                 [26.75, 56.00],   # Persian Gulf
                 [26.60, 56.12],   # Heading east toward narrows
                 [26.50, 56.22],   # Approaching narrows
                 [26.42, 56.32],   # Through narrows — north of inbound
                 [26.35, 56.40],   # Past Musandam — in water
                 [26.25, 56.50],   # South of tip — confirmed water
                 [26.10, 56.60],   # Along Oman coast
                 [25.90, 56.75],   # Curving south
                 [25.60, 56.95],   # Gulf of Oman
                 [25.20, 57.20]    # Open water
             ],
             "color": "#ffaa00", "duration": 4000, "label": "Outbound TSS lane", "dashed": True},
            {"action": "narrate", "heading": "TRAFFIC SEPARATION SCHEME", "text": "The two animated lines trace the actual IMO Traffic Separation Scheme through the Strait. Inbound vessels in cyan use the southern lane. Outbound tankers in amber use the northern lane. Both pass south of the Musandam Peninsula in open water."},
            # ── Scene 6: Missile trajectory — Abu Musa to shipping lane ──────
            # From Abu Musa [25.88, 55.03] to inbound lane at [26.22, 56.42] — all water
            {"action": "draw_arrow",
             "from": [25.88, 55.03],
             "to":   [26.22, 56.42],
             "color": "#ff0000", "label": "Simulated anti-ship missile trajectory"},
            {"action": "impact", "lat": 26.22, "lon": 56.42, "color": "#ff5500", "label": "Strike zone"},
            {"action": "narrate", "heading": "STRIKE SCENARIO", "text": "A simulated YJ-12 missile trajectory from Abu Musa Island reaches the inbound shipping lane in under three minutes. The impact marker shows the potential strike zone directly in the traffic separation scheme."},
            # ── Scene 7: IRGCN patrol movement — precise water paths ──────────
            {"action": "clear_scene"},
            {"action": "fly_to", "lat": 26.80, "lon": 56.20, "zoom": 8, "duration": 2500},
            # All patrol paths depart Bandar Abbas [27.19, 56.27] and move SOUTH
            # through the water east of Qeshm Island, staying in the channel
            {"action": "animate_movement", "speed": 0.25, "units": [
                {"origin": [27.19, 56.27], "destination": [26.55, 56.28],
                 "path": [
                     [27.19, 56.27],   # Bandar Abbas port — confirmed water
                     [27.10, 56.30],   # Departing port
                     [26.95, 56.32],   # South along Iranian coast
                     [26.85, 56.30],   # East of Qeshm Island — in water
                     [26.70, 56.27],   # Approaching channel center
                     [26.55, 56.28]    # Interdiction line — in water
                 ],
                 "icon": "patrol", "faction": "hostile", "label": "IRGC-201"},
                {"origin": [27.19, 56.27], "destination": [26.50, 56.20],
                 "path": [
                     [27.19, 56.27],
                     [27.05, 56.28],
                     [26.90, 56.25],
                     [26.75, 56.22],
                     [26.62, 56.20],
                     [26.50, 56.20]
                 ],
                 "icon": "patrol", "faction": "hostile", "label": "IRGC-203"},
                {"origin": [27.19, 56.27], "destination": [26.60, 56.35],
                 "path": [
                     [27.19, 56.27],
                     [27.08, 56.32],
                     [26.92, 56.35],
                     [26.78, 56.36],
                     [26.68, 56.35],
                     [26.60, 56.35]
                 ],
                 "icon": "patrol", "faction": "hostile", "label": "IRGC-207"}
            ]},
            {"action": "narrate", "heading": "IRGCN DEPLOYMENT", "text": "Three IRGCN patrol boats depart Bandar Abbas and move south through the channel east of Qeshm Island. All routes confirmed in water. The patrol line establishes an interdiction posture across the traffic separation scheme."},
            # ── Scene 8: US carrier strike group approaching from southeast ───
            # All points in Gulf of Oman open water — southeast of Musandam
            {"action": "animate_movement", "speed": 0.2, "units": [
                {"origin": [24.80, 57.50], "destination": [25.70, 56.80],
                 "path": [
                     [24.80, 57.50],   # Gulf of Oman — open water
                     [25.00, 57.30],
                     [25.20, 57.10],
                     [25.40, 56.95],
                     [25.55, 56.85],
                     [25.70, 56.80]    # Approach position — confirmed water
                 ],
                 "icon": "carrier", "faction": "allied", "label": "USS Lincoln"},
                {"origin": [24.70, 57.40], "destination": [25.60, 56.75],
                 "path": [
                     [24.70, 57.40],
                     [24.90, 57.20],
                     [25.10, 57.05],
                     [25.30, 56.90],
                     [25.45, 56.80],
                     [25.60, 56.75]
                 ],
                 "icon": "warship", "faction": "allied", "label": "USS Philippine Sea"},
                {"origin": [24.90, 57.60], "destination": [25.80, 56.85],
                 "path": [
                     [24.90, 57.60],
                     [25.10, 57.40],
                     [25.30, 57.20],
                     [25.50, 57.00],
                     [25.65, 56.90],
                     [25.80, 56.85]
                 ],
                 "icon": "warship", "faction": "allied", "label": "USS Chafee"}
            ]},
            {"action": "place_image_marker", "name": "USS Abraham Lincoln", "lat": 25.00, "lon": 57.50,
             "query": "USS Abraham Lincoln CVN-72 aircraft carrier Nimitz", "caption": "CVN-72 — CSG-3 flagship, Nimitz-class nuclear carrier", "size": "large"},
            {"action": "place_image_marker", "name": "USS Philippine Sea", "lat": 24.70, "lon": 57.40,
             "query": "USS Philippine Sea CG-58 Ticonderoga cruiser", "caption": "CG-58 Ticonderoga-class guided missile cruiser", "size": "small"},
            {"action": "narrate", "heading": "CSG RESPONSE", "text": "Carrier Strike Group Three approaches from the Gulf of Oman. The USS Lincoln, USS Philippine Sea, and USS Chafee transit northwest in formation through open water, taking up a position at the strait entrance. All routes southeast of Musandam — confirmed in water."},
            # ── Scene 9: pulse_hotspot ────────────────────────────────────────
            {"action": "clear_scene"},
            {"action": "fly_to", "lat": 26.38, "lon": 56.25, "zoom": 8, "duration": 2000},
            {"action": "pulse_hotspot", "lat": 26.38, "lon": 56.25,
             "color": "#ff4444", "label": "INTERDICTION ZONE", "duration": 5000},
            {"action": "narrate", "heading": "INTERDICTION ZONE", "text": "The pulsing rings mark the active IRGCN interdiction zone at the strait narrows — the point where nineteen million barrels of oil pass daily."},
            # ── Scene 10: spotlight ───────────────────────────────────────────
            {"action": "fly_to", "lat": 26.38, "lon": 56.25, "zoom": 9, "duration": 2000},
            {"action": "spotlight", "lat": 26.38, "lon": 56.25, "radius_px": 200, "duration": 4000},
            {"action": "narrate", "heading": "NARROWS FOCUS", "text": "The spotlight isolates the narrowest point of the strait — approximately 39 kilometres wide at this position between Musandam and Qeshm Island."},
            # ── Scene 11: data_callout ────────────────────────────────────────
            {"action": "data_callout", "label": "DAILY OIL TRANSIT", "value": "21%",
             "subtitle": "Of global liquid petroleum — 19.2M barrels/day through this chokepoint",
             "color": "#f59e0b", "screen_position": "top-right", "duration": 5000},
            {"action": "narrate", "heading": "ECONOMIC STAKES", "text": "Twenty-one percent of global liquid petroleum passes through this strait. Any sustained disruption would trigger immediate oil price spikes and supply chain cascades across Asia, Europe, and North America."},
            # ── Scene 12: chart ───────────────────────────────────────────────
            {"action": "clear_scene"},
            {"action": "show_chart", "title": "Hormuz Tanker Transits (vessels/day)", "color": "#56cfff",
             "duration": 8000,
             "data": [
                 {"label": "Jan", "value": 18}, {"label": "Feb", "value": 19},
                 {"label": "Mar", "value": 20}, {"label": "Apr", "value": 21},
                 {"label": "May", "value": 20}, {"label": "Jun", "value": 19},
                 {"label": "Jul", "value": 21}, {"label": "Aug", "value": 22},
                 {"label": "Sep", "value": 21}, {"label": "Oct", "value": 20},
                 {"label": "Nov", "value": 18}, {"label": "Dec", "value": 12}
             ],
             "event_marker": {"index": 11, "label": "Crisis begins"}},
            {"action": "narrate", "heading": "TRANSIT DATA", "text": "Daily vessel transits remained stable between eighteen and twenty-two ships through November, then dropped sharply to twelve in December as the crisis began. Full-screen chart shown first, then moves to sidebar."},
            # ── Scene 12b: oil facility image ─────────────────────────────────
            {"action": "place_image_marker", "name": "Kharg Island Oil Terminal", "lat": 29.23, "lon": 50.32,
             "query": "Kharg Island oil terminal Iran aerial Persian Gulf", "caption": "Handles 90% of Iranian crude exports — primary economic leverage", "size": "large"},
            {"action": "place_image_marker", "name": "VLCC Tanker", "lat": 26.40, "lon": 56.30,
             "query": "VLCC supertanker crude oil loading berth", "caption": "Very Large Crude Carrier — 2 million barrel capacity", "size": "small"},
            # ── Scene 13: country_info_overlay ────────────────────────────────
            {"action": "clear_scene"},
            {"action": "fly_to", "lat": 32.00, "lon": 53.00, "zoom": 5, "duration": 2500},
            {"action": "highlight_country", "name": "Iran", "context": "focus"},
            {"action": "place_image_marker", "name": "Natanz Nuclear Facility", "lat": 33.72, "lon": 51.73,
             "query": "Natanz nuclear enrichment facility Iran satellite image", "caption": "Underground centrifuge halls — 3,200+ operating units", "size": "medium"},
            {"action": "country_info_overlay", "name": "Iran", "headline": "STRATEGIC ASSESSMENT",
             "stat_value": "3,200+", "stat_label": "ACTIVE NUCLEAR CENTRIFUGES",
             "position": [32.00, 53.00]},
            {"action": "narrate", "heading": "IRAN ASSESSMENT", "text": "Iran's nuclear program provides the strategic context for this maritime confrontation. Over three thousand two hundred centrifuges are now enriching uranium, creating leverage for the regime in any negotiated settlement."},
            # ── Scene 14: formation ───────────────────────────────────────────
            {"action": "clear_scene"},
            {"action": "fly_to", "lat": 26.38, "lon": 56.25, "zoom": 8, "duration": 2500},
            {"action": "formation", "pattern": "surround", "target": [26.38, 56.25], "units": [
                # Units placed in open water — all in the strait channel
                {"lat": 26.52, "lon": 56.45, "type": "patrol", "faction": "hostile", "label": "IRGC-201"},
                {"lat": 26.22, "lon": 56.10, "type": "patrol", "faction": "hostile", "label": "IRGC-203"},
                {"lat": 26.55, "lon": 56.10, "type": "patrol", "faction": "hostile", "label": "IRGC-207"},
                {"lat": 26.38, "lon": 56.25, "type": "tanker_ship", "faction": "subject", "label": "MT Pacific"}
            ]},
            {"action": "narrate", "heading": "VESSEL INTERDICTION", "text": "Three IRGCN patrol boats execute a surround pattern on the MT Pacific, a laden crude carrier in the inbound lane. All units positioned in the water channel."},
            # ── Scene 15: recap_overview ──────────────────────────────────────
            {"action": "clear_scene"},
            {"action": "recap_overview", "color": "#56cfff", "duration": 6000, "locations": [
                {"lat": 27.19, "lon": 56.27, "label": "Bandar Abbas (IRGCN HQ)"},
                {"lat": 25.88, "lon": 55.03, "label": "Abu Musa (Missile Base)"},
                {"lat": 26.38, "lon": 56.25, "label": "Strait Narrows"},
                {"lat": 25.30, "lon": 57.10, "label": "CSG-3 Approach"},
                {"lat": 14.79, "lon": 42.95, "label": "Bab el-Mandeb"}
            ]},
            {"action": "narrate", "heading": "STRATEGIC OVERVIEW", "text": "Recap overview connecting the five key sites — Bandar Abbas, Abu Musa, the strait narrows, the carrier approach position, and Bab el-Mandeb. Staggered dots appear then connect with a dashed line."},
            # ── Scene 16: click_event popup ───────────────────────────────────
            {"action": "fly_to", "lat": 26.38, "lon": 56.25, "zoom": 9, "duration": 2000},
            {"action": "place_event", "title": "MT Pacific Interdiction", "lat": 26.38, "lon": 56.25,
             "type": "maritime", "severity": "critical",
             "summary": "IRGCN patrol boats have stopped MT Pacific at the strait narrows. Crew reports armed personnel aboard. UKMTO advisory issued.",
             "source": "UKMTO"},
            {"action": "click_event", "title": "MT Pacific Interdiction"},
            {"action": "narrate", "heading": "ACTIVE INCIDENT", "text": "Popup card showing the MT Pacific interdiction event with severity, summary, and source. Image search fires asynchronously to show a relevant photograph."},
            # ── Scene 17: clear_all + final ───────────────────────────────────
            {"action": "clear_all"},
            {"action": "fly_to", "lat": 26.00, "lon": 54.50, "zoom": 5, "duration": 3000},
            {"action": "narrate", "heading": "DIAGNOSTIC COMPLETE", "text": "All seventeen scenes completed. Every handler exercised with precise in-water coordinates. If you see this narration, the Director Mode diagnostic briefing played through to completion without errors."}
        ]
    }


@app.get("/api/director/list")
async def director_list():
    """List saved director sequences (newest first)."""
    return {"sequences": _director_svc.list_sequences()}


@app.get("/api/director/load/{seq_id}")
async def director_load(seq_id: str):
    """Load a saved director sequence by ID."""
    seq = _director_svc.load_sequence(seq_id)
    if seq is None:
        raise HTTPException(404, f"Sequence {seq_id!r} not found")
    return seq


@app.get("/api/director/transcript/{seq_id}")
async def director_transcript(seq_id: str):
    """Return a plain-text transcript for a saved sequence."""
    seq = _director_svc.load_sequence(seq_id)
    if seq is None:
        raise HTTPException(404, f"Sequence {seq_id!r} not found")
    text = _director_svc.sequence_to_transcript(seq)
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(text)


@app.post("/api/admin/reset-zone-intervals")
async def admin_reset_zone_intervals(current_user=Depends(get_optional_user)):
    """Set all WatchZone scan_interval_hours to 120 (5 days) and recalculate next_scan_at."""
    from database import WatchZone
    updated = 0
    with get_db() as db:
        zones = db.query(WatchZone).all()
        now   = datetime.utcnow()
        for z in zones:
            z.scan_interval_hours = 120
            z.next_scan_at = (z.last_scan_at or now) + __import__("datetime").timedelta(hours=120)
            updated += 1
        db.commit()
    return {"updated": updated, "scan_interval_hours": 120}


# ── Director person dossier ───────────────────────────────────────────────────

_PERSON_CACHE: dict[str, dict] = {}
_PERSON_CACHE_TTL = 86400  # 24 hours


@app.get("/api/director/person/{name}")
async def director_person(name: str, current_user=Depends(get_optional_user)):
    """Fetch person info and photo from Wikipedia (24h cache)."""
    cache_key = f"person:{name.lower().strip()}"
    cached = _PERSON_CACHE.get(cache_key)
    if cached and (time.time() - cached["fetched_at"]) < _PERSON_CACHE_TTL:
        return cached["data"]

    def _fetch_person():
        wiki_name = name.strip().replace(" ", "_")
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{wiki_name}"
        try:
            resp = requests.get(url, headers={"User-Agent": "HorizonWatch/1.0"}, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "name":         data.get("title", name),
                    "description":  data.get("description", ""),
                    "extract":      (data.get("extract") or "")[:400],
                    "image":        data.get("thumbnail", {}).get("source"),
                    "image_width":  data.get("thumbnail", {}).get("width"),
                    "image_height": data.get("thumbnail", {}).get("height"),
                    "page_url":     data.get("content_urls", {}).get("desktop", {}).get("page", ""),
                    "found":        True,
                }
        except Exception as ex:
            print(f"[person] Wikipedia lookup failed for {name}: {ex}")
        return {"name": name, "found": False}

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_executor, _fetch_person)
    _PERSON_CACHE[cache_key] = {"data": result, "fetched_at": time.time()}
    return result


# ── Director satellite analysis ───────────────────────────────────────────────

# Cache: (lat_r3, lon_r3) → {observations, timestamp}
_SAT_ANALYSIS_CACHE: dict[str, dict] = {}
_SAT_ANALYSIS_CACHE_TTL = 6 * 3600  # 6 hours


@app.post("/api/director/analyse-satellite")
async def director_analyse_satellite(
    request: Request,
    current_user=Depends(get_optional_user),
):
    """Capture a Sentinel-2 tile at lat/lon and run Claude Vision analysis."""
    if not client:
        raise HTTPException(503, "Claude client not configured")

    body = await request.json()
    lat       = float(body.get("lat", 0))
    lon       = float(body.get("lon", 0))
    radius_km = float(body.get("radius_km", 5))
    label     = str(body.get("label", "") or "")[:100]

    # Cache key — round to 3 decimal places (~100m)
    cache_key = f"{lat:.3f},{lon:.3f}"
    now = time.time()
    cached = _SAT_ANALYSIS_CACHE.get(cache_key)
    if cached and (now - cached.get("ts", 0)) < _SAT_ANALYSIS_CACHE_TTL:
        return {
            "observations": cached["observations"],
            "location": {"lat": lat, "lon": lon},
            "label": label,
            "timestamp": cached["timestamp"],
            "cached": True,
        }

    # Build Sentinel-2 WMS tile URL (256×256 PNG, zoom ~14)
    # Using the Copernicus WMS through the app's existing /sentinel proxy pattern
    # We request a tile via the OGC WMS interface
    import math as _math
    zoom = 14
    # Convert lat/lon to tile numbers
    lat_r = _math.radians(lat)
    n = 2 ** zoom
    tile_x = int((lon + 180.0) / 360.0 * n)
    tile_y = int((1.0 - _math.log(_math.tan(lat_r) + 1.0 / _math.cos(lat_r)) / _math.pi) / 2.0 * n)

    # Sentinel-2 CloudFree WMS (public, no auth required for basic tiles)
    # Use BBOX approach for better control
    def _tile_to_latlon(x, y, z):
        n2 = 2 ** z
        lon_deg = x / n2 * 360.0 - 180.0
        lat_rad = _math.atan(_math.sinh(_math.pi * (1 - 2 * y / n2)))
        lat_deg = _math.degrees(lat_rad)
        return lat_deg, lon_deg

    lat_max, lon_min = _tile_to_latlon(tile_x, tile_y, zoom)
    lat_min, lon_max = _tile_to_latlon(tile_x + 1, tile_y + 1, zoom)
    bbox = f"{lon_min},{lat_min},{lon_max},{lat_max}"

    wms_url = (
        "https://services.sentinel-hub.com/ogc/wms/ed64bf38-0a00-43a2-a1e2-b89eba4c4d4e"
        "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap"
        "&LAYERS=TRUE-COLOR&FORMAT=image/png&WIDTH=256&HEIGHT=256"
        f"&CRS=EPSG:4326&BBOX={lat_min},{lon_min},{lat_max},{lon_max}"
    )
    # Fallback to a public Sentinel-2 WMS (EO Browser style)
    wms_url_fallback = (
        "https://sh.dataspace.copernicus.eu/ogc/wms/0d2a0c5e-4809-40be-9b47-c1e7e8a73778"
        "?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
        "&LAYERS=TRUE-COLOR&FORMAT=image/png&WIDTH=256&HEIGHT=256"
        f"&CRS=EPSG:4326&BBOX={lat_min},{lon_min},{lat_max},{lon_max}"
    )

    image_b64 = None
    import base64 as _base64

    for url in (wms_url, wms_url_fallback):
        try:
            resp = httpx.get(
                url,
                timeout=15,
                headers={"User-Agent": "HorizonWatch/2.0 satellite-analysis"},
                follow_redirects=True,
            )
            if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("image/"):
                image_b64 = _base64.b64encode(resp.content).decode("utf-8")
                break
        except Exception:
            continue

    observations = ""
    if image_b64:
        try:
            loop = asyncio.get_event_loop()
            vision_msg = await loop.run_in_executor(
                _executor,
                lambda: client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=400,
                    messages=[{
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": image_b64,
                                },
                            },
                            {
                                "type": "text",
                                "text": (
                                    f"You are a satellite imagery analyst. Analyze this Sentinel-2 satellite "
                                    f"image centered at {lat:.4f}, {lon:.4f} ({label}). "
                                    "Describe what you observe: terrain, structures, vessels, vehicles, "
                                    "activity patterns, any notable features. "
                                    "Keep your analysis to 3-5 concise observations. "
                                    "If the image is cloudy or unclear, say so."
                                ),
                            },
                        ],
                    }],
                ),
            )
            observations = vision_msg.content[0].text.strip()
            usage_tracker.record_call(
                vision_msg.usage.input_tokens,
                vision_msg.usage.output_tokens,
                call_type="satellite_analysis",
                headline=f"Sat analysis: {label or f'{lat:.3f},{lon:.3f}'}",
            )
        except Exception as exc:
            observations = f"Satellite imagery analysis unavailable: {exc}"
    else:
        observations = "Satellite imagery could not be retrieved for this location at this time."

    ts = datetime.now(timezone.utc).isoformat()
    _SAT_ANALYSIS_CACHE[cache_key] = {
        "observations": observations,
        "ts": now,
        "timestamp": ts,
    }
    return {
        "observations": observations,
        "location": {"lat": lat, "lon": lon},
        "label": label,
        "timestamp": ts,
        "cached": False,
    }


# ── City & spaceflight news caches ───────────────────────────────────────────
_CITY_NEWS_CACHE: dict = {}       # cache_key → {articles, fetched_at}

# ── City news locality helpers ─────────────────────────────────────────────────

_CITY_LOCAL_KEYWORDS: dict[str, list[str]] = {
    "Paris": ["paris", "parisien", "île-de-france", "ile-de-france", "arrondissement",
              "métro", "metro", "rer ", "ratp", "banlieue", "val-de-marne",
              "seine-saint-denis", "hauts-de-seine", "yvelines", "essonne",
              "montmartre", "marais", "bastille", "châtelet", "chatelet", "belleville",
              "ménilmontant", "pigalle", "republique", "république", "nation",
              "défense", "defense", "la villette"],
    "Berlin": ["berlin", "berliner", "kreuzberg", "neukölln", "neukolln", "mitte",
               "charlottenburg", "spandau", "tempelhof", "schöneberg", "friedrichshain",
               "prenzlauer", "pankow", "reinickendorf", "bvg", "s-bahn", "u-bahn",
               "alexanderplatz", "kurfürstendamm", "kudamm", "potsdamer", "brandenburger"],
    "Dubai": ["dubai", "dxb", "jumeirah", "deira", "bur dubai", "marina", "downtown",
              "palm", "jebel ali", "sheikh zayed", "rta", "emaar", "difc",
              "expo city", "business bay", "creek", "al quoz"],
    "Dakar": ["dakar", "dakarois", "plateau", "medina", "yoff", "almadies", "ouakam",
              "ngor", "pikine", "guédiawaye", "rufisque", "thiaroye", "parcelles"],
    "Hannover": ["hannover", "hannoverschen", "linden", "nordstadt", "südstadt",
                 "herrenhausen", "bothfeld", "döhren", "ricklingen", "maschsee",
                 "üstra", "messe hannover"],
    "Magdeburg": ["magdeburg", "magdeburger", "buckau", "sudenburg", "stadtfeld",
                  "altstadt", "reform", "neue neustadt", "rothensee", "cracau", "elbe"],
}

_INTL_SIGNALS = [
    "états-unis", "etats-unis", "washington", "trump", "biden", "russie", "russia",
    "ukraine", "chine", "china", "israel", "gaza", "iran", "irak", "iraq",
    "syrie", "syria", "united states", "usa ", "kremlin", "poutine", "putin",
    "zelensky", "nato", "otan",
]


def _is_local_article(article: dict, city_name: str) -> bool:
    title   = (article.get("title")   or "").lower()
    summary = (article.get("summary") or "").lower()
    text    = title + " " + summary

    keywords = _CITY_LOCAL_KEYWORDS.get(city_name, [city_name.lower()])
    for kw in keywords:
        if kw in text:
            return True

    # Local-tier feeds are kept unless clearly international
    if article.get("tier") == "local":
        return not any(sig in text for sig in _INTL_SIGNALS)

    return False


def _is_fresh_article(article: dict, max_age_hours: int = 72) -> bool:
    ts = article.get("timestamp")
    if not ts:
        return True
    try:
        import datetime as _dt
        dt = _dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        age_h = (_dt.datetime.now(_dt.timezone.utc) - dt).total_seconds() / 3600
        return age_h <= max_age_hours
    except Exception:
        return True

_SPACEFLIGHT_CACHE: dict = {}     # "spaceflight_all" → {articles, source_count, fetched_at}
_CITY_NEWS_TTL = 300              # 5 minutes


def _fetch_single_feed(url: str):
    """Fetch and parse a single RSS feed URL. Returns feedparser result or None."""
    try:
        return feedparser.parse(url, agent="Mozilla/5.0", request_headers={"Accept": "application/rss+xml,application/xml,text/xml"})
    except Exception:
        return None


def _entry_timestamp(entry) -> str | None:
    """Extract ISO timestamp from a feedparser entry."""
    pp = entry.get("published_parsed") or entry.get("updated_parsed")
    if pp:
        try:
            return datetime(*pp[:6], tzinfo=timezone.utc).isoformat()
        except Exception:
            pass
    return None


@app.get("/api/news/cities")
async def list_city_feeds():
    """Return available city feeds with metadata."""
    from rss_feeds import CITY_FEEDS
    return {
        "cities": [
            {
                "name":       name,
                "country":    data["country"],
                "lat":        data["lat"],
                "lon":        data["lon"],
                "language":   data["language"],
                "feed_count": len(data["feeds"]),
            }
            for name, data in CITY_FEEDS.items()
        ]
    }


@app.get("/api/news/city/{city_name}")
async def get_city_news(city_name: str, current_user=Depends(get_optional_user)):
    """Fetch fresh articles from city-specific feeds (5-minute cache)."""
    from rss_feeds import CITY_FEEDS
    city = CITY_FEEDS.get(city_name)
    if not city:
        return JSONResponse(
            {"error": f"Unknown city: {city_name}", "available": list(CITY_FEEDS.keys())},
            status_code=404,
        )

    cache_key = f"city_news:{city_name.lower()}"
    cached = _CITY_NEWS_CACHE.get(cache_key)
    if cached and (time.time() - cached["fetched_at"]) < _CITY_NEWS_TTL:
        return cached["data"]

    def _fetch_city():
        results = []
        from concurrent.futures import as_completed, ThreadPoolExecutor as _CityTPE
        with _CityTPE(max_workers=10, thread_name_prefix="city-feed") as pool:
            futures = {pool.submit(_fetch_single_feed, f["url"]): f for f in city["feeds"]}
            for future in as_completed(futures, timeout=15):
                feed_meta = futures[future]
                try:
                    parsed = future.result()
                    if not parsed or not parsed.entries:
                        continue
                    for entry in parsed.entries[:10]:
                        ts = _entry_timestamp(entry)
                        domain = feed_meta["url"].split("/")[2] if "/" in feed_meta["url"] else feed_meta["url"]
                        # Extract image URL
                        image_url = None
                        mc = entry.get("media_content") or []
                        if mc: image_url = mc[0].get("url")
                        if not image_url:
                            mt = entry.get("media_thumbnail") or []
                            if mt: image_url = mt[0].get("url")
                        if not image_url:
                            for enc in (entry.get("enclosures") or []):
                                if (enc.get("type") or "").startswith("image/"):
                                    image_url = enc.get("href") or enc.get("url"); break
                        if not image_url:
                            desc = entry.get("summary") or entry.get("description") or ""
                            m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc)
                            if m: image_url = m.group(1)
                        # Strip HTML from summary
                        raw_summary = entry.get("summary") or entry.get("description") or ""
                        summary = re.sub(r'<[^>]+>', '', raw_summary).strip()[:300]
                        results.append({
                            "title":     (entry.get("title") or "").strip(),
                            "link":      entry.get("link", ""),
                            "source":    domain,
                            "timestamp": ts,
                            "language":  feed_meta.get("lang", city.get("language", "en")),
                            "tier":      feed_meta.get("tier", "local"),
                            "summary":   summary,
                            "image_url": image_url,
                            "city":      city_name,
                            "country":   city["country"],
                        })
                except Exception as ex:
                    print(f"[city-news] feed error {feed_meta.get('url','?')[:60]}: {ex}")
        results.sort(key=lambda a: a.get("timestamp") or "", reverse=True)
        # Apply locality + freshness filters
        results = [
            a for a in results
            if _is_local_article(a, city_name) and _is_fresh_article(a)
        ]
        return results[:60]

    loop = asyncio.get_event_loop()
    articles = await loop.run_in_executor(_executor, _fetch_city)

    data = {
        "city":          city_name,
        "country":       city["country"],
        "language":      city["language"],
        "lat":           city["lat"],
        "lon":           city["lon"],
        "article_count": len(articles),
        "articles":      articles,
        "fetched_at":    datetime.now(timezone.utc).isoformat(),
    }
    _CITY_NEWS_CACHE[cache_key] = {"data": data, "fetched_at": time.time()}
    return data


@app.get("/api/news/spaceflight")
async def get_spaceflight_news(current_user=Depends(get_optional_user)):
    """Aggregated spaceflight news from 40+ sources (5-minute cache)."""
    cache_key = "spaceflight_all"
    cached = _SPACEFLIGHT_CACHE.get(cache_key)
    if cached and (time.time() - cached["fetched_at"]) < _CITY_NEWS_TTL:
        return {"articles": cached["articles"], "source_count": cached["source_count"]}

    from rss_feeds import SPACEFLIGHT_FEEDS

    def _fetch_spaceflight():
        results = []
        successful = 0
        from concurrent.futures import as_completed, ThreadPoolExecutor as _SFT
        with _SFT(max_workers=15, thread_name_prefix="sf-feed") as pool:
            futures = {pool.submit(_fetch_single_feed, f["url"]): f for f in SPACEFLIGHT_FEEDS}
            for future in as_completed(futures, timeout=20):
                feed_meta = futures[future]
                try:
                    parsed = future.result()
                    if not parsed or not parsed.entries:
                        continue
                    successful += 1
                    for entry in parsed.entries[:5]:
                        ts = _entry_timestamp(entry)
                        # Extract image URL
                        image_url = None
                        mc = entry.get("media_content") or []
                        if mc: image_url = mc[0].get("url")
                        if not image_url:
                            mt = entry.get("media_thumbnail") or []
                            if mt: image_url = mt[0].get("url")
                        if not image_url:
                            for enc in (entry.get("enclosures") or []):
                                if (enc.get("type") or "").startswith("image/"):
                                    image_url = enc.get("href") or enc.get("url"); break
                        if not image_url:
                            desc = entry.get("summary") or entry.get("description") or ""
                            m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc)
                            if m: image_url = m.group(1)
                        raw_summary = entry.get("summary") or entry.get("description") or ""
                        summary = re.sub(r'<[^>]+>', '', raw_summary).strip()[:300]
                        results.append({
                            "title":     (entry.get("title") or "").strip(),
                            "link":      entry.get("link", ""),
                            "source":    feed_meta.get("name", "Unknown"),
                            "timestamp": ts,
                            "summary":   summary,
                            "image_url": image_url,
                        })
                except Exception:
                    pass
        results.sort(key=lambda a: a.get("timestamp") or "", reverse=True)
        return results[:100], successful

    loop = asyncio.get_event_loop()
    articles, successful = await loop.run_in_executor(_executor, _fetch_spaceflight)

    _SPACEFLIGHT_CACHE[cache_key] = {
        "articles":     articles,
        "source_count": successful,
        "fetched_at":   time.time(),
    }
    return {"articles": articles, "source_count": successful}


# ── Stock news & market indices ───────────────────────────────────────────────

_STOCK_NEWS_CACHE:  dict = {}   # "stocks_all" → {articles, fetched_at}
_MARKET_DATA_CACHE: dict = {}   # "indices" → {data, fetched_at}
_STOCK_CACHE_TTL = 300          # 5 minutes


def _extract_image(entry) -> str | None:
    """Extract best image URL from a feedparser entry."""
    mc = entry.get("media_content") or []
    if mc:
        return mc[0].get("url")
    mt = entry.get("media_thumbnail") or []
    if mt:
        return mt[0].get("url")
    for enc in (entry.get("enclosures") or []):
        if (enc.get("type") or "").startswith("image/"):
            return enc.get("href") or enc.get("url")
    desc = entry.get("summary") or entry.get("description") or ""
    m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc)
    return m.group(1) if m else None


@app.get("/api/news/stocks")
async def get_stock_news(current_user=Depends(get_optional_user)):
    """Aggregated financial/markets news from 30+ sources (5-minute cache)."""
    cache_key = "stocks_all"
    cached = _STOCK_NEWS_CACHE.get(cache_key)
    if cached and (time.time() - cached["fetched_at"]) < _STOCK_CACHE_TTL:
        return {"articles": cached["articles"], "source_count": cached["source_count"]}

    from rss_feeds import STOCK_FEEDS

    def _fetch_stocks():
        results = []
        successful = 0
        from concurrent.futures import as_completed, ThreadPoolExecutor as _StockTPE
        with _StockTPE(max_workers=12, thread_name_prefix="stock-feed") as pool:
            futures = {pool.submit(_fetch_single_feed, f["url"]): f for f in STOCK_FEEDS}
            for future in as_completed(futures, timeout=20):
                feed_meta = futures[future]
                try:
                    parsed = future.result()
                    if not parsed or not parsed.entries:
                        continue
                    successful += 1
                    for entry in parsed.entries[:5]:
                        ts = _entry_timestamp(entry)
                        raw_summary = entry.get("summary") or entry.get("description") or ""
                        summary = re.sub(r'<[^>]+>', '', raw_summary).strip()[:300]
                        results.append({
                            "title":     (entry.get("title") or "").strip(),
                            "link":      entry.get("link", ""),
                            "source":    feed_meta.get("name", "Unknown"),
                            "timestamp": ts,
                            "summary":   summary,
                            "image_url": _extract_image(entry),
                        })
                except Exception:
                    pass
        results.sort(key=lambda a: a.get("timestamp") or "", reverse=True)
        return results[:100], successful

    loop = asyncio.get_event_loop()
    articles, successful = await loop.run_in_executor(_executor, _fetch_stocks)

    _STOCK_NEWS_CACHE[cache_key] = {
        "articles":     articles,
        "source_count": successful,
        "fetched_at":   time.time(),
    }
    return {"articles": articles, "source_count": successful}


_INDICES_CONFIG = [
    {"symbol": "^GSPC",  "name": "S&P 500",   "category": "equity"},
    {"symbol": "^DJI",   "name": "Dow Jones",  "category": "equity"},
    {"symbol": "^IXIC",  "name": "NASDAQ",     "category": "equity"},
    {"symbol": "^FTSE",  "name": "FTSE 100",   "category": "equity"},
    {"symbol": "^GDAXI", "name": "DAX",        "category": "equity"},
    {"symbol": "^N225",  "name": "Nikkei 225", "category": "equity"},
    {"symbol": "CL=F",   "name": "Crude Oil",  "category": "commodity"},
    {"symbol": "GC=F",   "name": "Gold",       "category": "commodity"},
    {"symbol": "BTC-USD","name": "Bitcoin",    "category": "crypto"},
]


def _fetch_index(symbol: str) -> dict | None:
    """Fetch 1-day chart data from Yahoo Finance v8 API."""
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        "?range=1d&interval=15m&includePrePost=false"
    )
    try:
        import urllib.request as _ur
        req = _ur.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with _ur.urlopen(req, timeout=6) as resp:
            data = _json.loads(resp.read().decode())
        result = data.get("chart", {}).get("result", [None])[0]
        if not result:
            return None
        meta   = result.get("meta", {})
        closes = (result.get("indicators", {}).get("quote", [{}]) or [{}])[0].get("close") or []
        closes = [c for c in closes if c is not None]
        price      = meta.get("regularMarketPrice") or (closes[-1] if closes else None)
        prev_close = meta.get("previousClose") or meta.get("chartPreviousClose") or (closes[0] if closes else None)
        if not price or not prev_close:
            return None
        change_pct = ((price - prev_close) / prev_close) * 100
        sparkline  = closes[-20:] if len(closes) >= 20 else closes
        return {
            "symbol":     symbol,
            "name":       next((c["name"] for c in _INDICES_CONFIG if c["symbol"] == symbol), symbol),
            "category":   next((c["category"] for c in _INDICES_CONFIG if c["symbol"] == symbol), "equity"),
            "price":      round(price, 2),
            "prev_close": round(prev_close, 2),
            "change_pct": round(change_pct, 2),
            "sparkline":  [round(v, 2) for v in sparkline],
        }
    except Exception as ex:
        print(f"[indices] {symbol} error: {ex}")
        return None


@app.get("/api/stocks/indices")
async def get_market_indices(current_user=Depends(get_optional_user)):
    """Live index/commodity/crypto prices with sparkline (5-minute cache)."""
    cache_key = "indices"
    cached = _MARKET_DATA_CACHE.get(cache_key)
    if cached and (time.time() - cached["fetched_at"]) < _STOCK_CACHE_TTL:
        return {"indices": cached["data"]}

    from concurrent.futures import as_completed, ThreadPoolExecutor as _IdxTPE
    with _IdxTPE(max_workers=9, thread_name_prefix="idx") as pool:
        futures = {pool.submit(_fetch_index, cfg["symbol"]): cfg for cfg in _INDICES_CONFIG}
        results = []
        for future in as_completed(futures, timeout=12):
            r = future.result()
            if r:
                results.append(r)

    results.sort(key=lambda x: ["equity", "commodity", "crypto"].index(x["category"]))
    _MARKET_DATA_CACHE[cache_key] = {"data": results, "fetched_at": time.time()}
    return {"indices": results}


# ── YouTube news reels ────────────────────────────────────────────────────────

YOUTUBE_NEWS_CHANNELS = [
    {"name": "Al Jazeera English", "id": "UCNye-wNBqNL5ZzHSJdYkf3A"},
    {"name": "BBC News",            "id": "UC16niRr50-MSBwiO3YDb3RA"},
    {"name": "France 24 English",   "id": "UCQfwfsi5VrQ8yKZ-UWmAoBw"},
    {"name": "DW News",             "id": "UCknLrEdhRCp1aegoMqRaCZg"},
    {"name": "Reuters",             "id": "UChqUTb7kYRX8-EiaN3XFrSQ"},
    {"name": "Sky News",            "id": "UCoMdktPbSTixAyNGwb-UYkQ"},
    {"name": "TRT World",           "id": "UC7_gcs09iThXybpVgjHZ_7g"},
    {"name": "Bloomberg",           "id": "UCIALMKvObZNtJ6AmdCLP7Lg"},
    {"name": "CNN International",   "id": "UCupvZG-5ko_eiXAupbDfxWw"},
]

_youtube_reels_cache: list = []
_youtube_reels_last_fetch: datetime | None = None


async def _fetch_youtube_reels() -> list:
    import httpx
    from xml.etree import ElementTree as ET

    ns = {
        "atom":  "http://www.w3.org/2005/Atom",
        "yt":    "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/",
    }
    videos = []
    async with httpx.AsyncClient(timeout=10) as client:
        for channel in YOUTUBE_NEWS_CHANNELS:
            try:
                url = (f"https://www.youtube.com/feeds/videos.xml"
                       f"?channel_id={channel['id']}")
                r = await client.get(url)
                if r.status_code != 200:
                    continue
                root    = ET.fromstring(r.text)
                entries = root.findall("atom:entry", ns)
                for entry in entries[:3]:
                    video_id  = entry.find("yt:videoId", ns)
                    title     = entry.find("atom:title", ns)
                    published = entry.find("atom:published", ns)
                    thumbnail = entry.find(".//media:thumbnail", ns)
                    if video_id is None:
                        continue
                    vid = video_id.text
                    videos.append({
                        "video_id":  vid,
                        "title":     title.text if title is not None else "",
                        "channel":   channel["name"],
                        "channel_id": channel["id"],
                        "published": published.text if published is not None else "",
                        "thumbnail": (thumbnail.get("url") if thumbnail is not None
                                      else f"https://img.youtube.com/vi/{vid}/mqdefault.jpg"),
                        "embed_url": (f"https://www.youtube.com/embed/{vid}"
                                      f"?autoplay=1&mute=1&controls=1&rel=0&modestbranding=1"),
                    })
            except Exception as e:
                print(f"[youtube] Failed {channel['name']}: {e}")

    videos.sort(key=lambda x: x.get("published", ""), reverse=True)
    return videos


async def _youtube_reels_loop():
    global _youtube_reels_cache, _youtube_reels_last_fetch
    while True:
        try:
            videos = await _fetch_youtube_reels()
            if videos:
                _youtube_reels_cache     = videos
                _youtube_reels_last_fetch = datetime.utcnow()
                print(f"[youtube] Refreshed {len(videos)} videos")
        except Exception as e:
            print(f"[youtube] Refresh failed: {e}")
        await asyncio.sleep(1800)


@app.get("/api/news/reels")
async def get_news_reels(current_user=Depends(get_optional_user)):
    """Return cached YouTube news reels. Fetches immediately if cache is empty."""
    global _youtube_reels_cache, _youtube_reels_last_fetch
    if not _youtube_reels_cache:
        try:
            videos = await _fetch_youtube_reels()
            if videos:
                _youtube_reels_cache     = videos
                _youtube_reels_last_fetch = datetime.utcnow()
        except Exception as e:
            print(f"[youtube] On-demand fetch failed: {e}")
    return {
        "videos":       _youtube_reels_cache,
        "count":        len(_youtube_reels_cache),
        "last_updated": _youtube_reels_last_fetch.isoformat() if _youtube_reels_last_fetch else None,
        "channels":     len(YOUTUBE_NEWS_CHANNELS),
    }


# ── YouTube Shorts news feed ──────────────────────────────────────────────────

SHORTS_CHANNELS = [
    {"name": "Al Jazeera",      "channel_id": "UCNye-wNBqNL5ZzHSJdYkf3A", "playlist_id": "UUSHNye-wNBqNL5ZzHSJdYkf3A",  "color": "#FF6B00"},
    {"name": "BBC News",        "channel_id": "UC16niRr50-MSBwiO3YDb3RA", "playlist_id": "UUSH16niRr50-MSBwiO3YDb3RA",  "color": "#BB1919"},
    {"name": "France 24",       "channel_id": "UCQfwfsi5VrQ8yKZ-UWmAoBw", "playlist_id": "UUSHQfwfsi5VrQ8yKZ-UWmAoBw",  "color": "#003F7F"},
    {"name": "DW News",         "channel_id": "UCknLrEdhRCp1aegoMqRaCZg", "playlist_id": "UUSHknLrEdhRCp1aegoMqRaCZg", "color": "#C8002D"},
    {"name": "Reuters",         "channel_id": "UChqUTb7kYRX8-EiaN3XFrSQ", "playlist_id": "UUSHhqUTb7kYRX8-EiaN3XFrSQ", "color": "#FF8000"},
    {"name": "Sky News",        "channel_id": "UCoMdktPbSTixAyNGwb-UYkQ", "playlist_id": "UUSHoMdktPbSTixAyNGwb-UYkQ", "color": "#E4003B"},
    {"name": "TRT World",       "channel_id": "UC7_gcs09iThXybpVgjHZ_7g", "playlist_id": "UUSH7_gcs09iThXybpVgjHZ_7g",  "color": "#E30613"},
    {"name": "Bloomberg",       "channel_id": "UCIALMKvObZNtJ6AmdCLP7Lg", "playlist_id": "UUSHIALMKvObZNtJ6AmdCLP7Lg", "color": "#5B9BD5"},
    {"name": "CNN International","channel_id": "UCupvZG-5ko_eiXAupbDfxWw", "playlist_id": "UUSHupvZG-5ko_eiXAupbDfxWw", "color": "#CC0000"},
]

_shorts_cache: list         = []
_shorts_cache_ts: datetime | None = None
_SHORTS_TTL = 1800


async def _fetch_shorts_feed() -> list:
    import httpx
    from xml.etree import ElementTree as ET

    ns = {
        "atom":  "http://www.w3.org/2005/Atom",
        "yt":    "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/",
    }
    by_channel: dict = {}
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        for ch in SHORTS_CHANNELS:
            # Try Shorts playlist first, fall back to regular channel feed
            urls = [
                f"https://www.youtube.com/feeds/videos.xml?playlist_id={ch['playlist_id']}",
                f"https://www.youtube.com/feeds/videos.xml?channel_id={ch['channel_id']}",
            ]
            for url in urls:
                try:
                    r = await client.get(url)
                    if r.status_code != 200 or "<entry>" not in r.text:
                        continue
                    root    = ET.fromstring(r.text)
                    entries = root.findall("atom:entry", ns)
                    shorts  = []
                    for entry in entries[:5]:
                        vid_el   = entry.find("yt:videoId", ns)
                        title_el = entry.find("atom:title", ns)
                        pub_el   = entry.find("atom:published", ns)
                        thumb_el = entry.find(".//media:thumbnail", ns)
                        if vid_el is None:
                            continue
                        vid = vid_el.text
                        shorts.append({
                            "video_id":      vid,
                            "title":         title_el.text if title_el is not None else "",
                            "channel":       ch["name"],
                            "channel_color": ch["color"],
                            "published":     pub_el.text if pub_el is not None else "",
                            "thumbnail":     (thumb_el.get("url") if thumb_el is not None
                                              else f"https://img.youtube.com/vi/{vid}/mqdefault.jpg"),
                            "embed_url":     (f"https://www.youtube.com/embed/{vid}"
                                              f"?autoplay=1&mute=1&controls=0&rel=0"
                                              f"&modestbranding=1&playsinline=1&loop=1&playlist={vid}"),
                            "shorts_url":    f"https://youtube.com/shorts/{vid}",
                        })
                    if shorts:
                        by_channel[ch["name"]] = shorts
                        break
                except Exception as e:
                    print(f"[shorts] {ch['name']} {url}: {e}")

    # Round-robin interleave so feed isn't all one channel
    interleaved: list = []
    max_len = max((len(v) for v in by_channel.values()), default=0)
    for i in range(max_len):
        for ch_shorts in by_channel.values():
            if i < len(ch_shorts):
                interleaved.append(ch_shorts[i])
    return interleaved


async def _shorts_refresh_loop():
    global _shorts_cache, _shorts_cache_ts
    await asyncio.sleep(240)  # staggered startup — not critical
    while True:
        try:
            videos = await _fetch_shorts_feed()
            if videos:
                _shorts_cache    = videos
                _shorts_cache_ts = datetime.utcnow()
                print(f"[shorts] Refreshed: {len(videos)} shorts")
        except Exception as e:
            print(f"[shorts] Refresh error: {e}")
        await asyncio.sleep(_SHORTS_TTL)


@app.get("/api/news/shorts")
async def get_news_shorts(current_user=Depends(get_optional_user)):
    """Return cached YouTube Shorts news feed. Fetches immediately if cache empty."""
    global _shorts_cache, _shorts_cache_ts
    if not _shorts_cache:
        try:
            videos = await _fetch_shorts_feed()
            if videos:
                _shorts_cache    = videos
                _shorts_cache_ts = datetime.utcnow()
        except Exception as e:
            print(f"[shorts] On-demand fetch failed: {e}")
    return {
        "shorts":       _shorts_cache,
        "count":        len(_shorts_cache),
        "last_updated": _shorts_cache_ts.isoformat() if _shorts_cache_ts else None,
        "channels":     len(SHORTS_CHANNELS),
    }


# ── Director image search (Wikimedia Commons) ────────────────────────────────

_IMG_SEARCH_CACHE: dict = {}      # query → {result, ts}
_IMG_SEARCH_TTL   = 24 * 3600    # 24-hour cache
_IMG_SEARCH_LAST  = 0.0          # rate-limit: 1 req per 2s
_IMG_SEARCH_LOCK  = threading.Lock()


def _wikimedia_image_search(query: str) -> dict | None:
    """Fetch first suitable photograph from Wikimedia Commons. Returns dict or None."""
    # Add filetype hint to get bitmap photos, not diagrams/documents
    search_q = urllib.parse.quote(f"{query} filetype:bitmap")
    url = (
        "https://commons.wikimedia.org/w/api.php?"
        "action=query&generator=search&gsrsearch=" + search_q +
        "&gsrnamespace=6&gsrlimit=12"
        "&prop=imageinfo&iiprop=url%7Cmime%7Csize%7Cextmetadata&iiurlwidth=700"
        "&format=json"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "NAGINI/2.0 (intelligence platform)"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = _json.loads(resp.read().decode())
    except Exception:
        return None

    pages = (data.get("query") or {}).get("pages") or {}
    if not pages:
        return None

    # Sort pages by page_id (higher = often more relevant for recent searches)
    sorted_pages = sorted(pages.values(), key=lambda p: p.get("index", 0))

    for page in sorted_pages:
        info_list = page.get("imageinfo") or []
        if not info_list:
            continue
        info = info_list[0]
        thumb = info.get("thumburl") or info.get("url") or ""
        if not thumb:
            continue

        # Skip non-photo content
        lower_url = thumb.lower()
        if any(lower_url.endswith(ext) for ext in (".svg", ".pdf", ".gif", ".tif", ".tiff", ".webp")):
            continue
        mime = info.get("mime", "")
        if mime and mime not in ("image/jpeg", "image/png", "image/jpg"):
            continue

        # Skip tiny images (icons, thumbnails)
        width  = info.get("width", 0) or 0
        height = info.get("height", 0) or 0
        if width < 400 or height < 250:
            continue

        ext_meta = info.get("extmetadata") or {}
        desc_short = (ext_meta.get("ImageDescription") or {}).get("value") or ""
        caption = re.sub(r"<[^>]+>", "", desc_short).strip()[:180] or query
        artist_raw = (ext_meta.get("Artist") or {}).get("value") or ""
        artist = re.sub(r"<[^>]+>", "", artist_raw).strip()[:80]
        attribution = f"© {artist} / Wikimedia Commons" if artist else "Wikimedia Commons"
        return {
            "image_url":   thumb,
            "caption":     caption,
            "source":      "wikimedia",
            "attribution": attribution,
        }
    return None


_WIKI_IMAGE_CACHE: dict = {}

@app.get("/api/image/wiki")
async def get_wiki_image(q: str = Query(..., min_length=1, max_length=200)):
    """Wikipedia REST API image proxy — fast, reliable, no auth required. Cached in memory."""
    if q in _WIKI_IMAGE_CACHE:
        return _WIKI_IMAGE_CACHE[q]
    # Try query variations: original, spaces→underscores, strip hyphens
    variants: list[str] = []
    for v in [q, q.replace(" ", "_"), q.replace("-", " ")]:
        if v not in variants:
            variants.append(v)
    async with httpx.AsyncClient(timeout=6) as client:
        for variant in variants:
            try:
                resp = await client.get(
                    f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(variant)}",
                    headers={"User-Agent": "NAGINI/2.0 (intelligence platform)"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    thumb = (
                        (data.get("thumbnail") or {}).get("source")
                        or (data.get("originalimage") or {}).get("source")
                    )
                    if thumb:
                        result = {
                            "image":   thumb,
                            "extract": (data.get("extract") or "")[:200],
                            "title":   data.get("title", q),
                        }
                        _WIKI_IMAGE_CACHE[q] = result
                        return result
            except Exception:
                continue
    result = {"image": None, "extract": None, "title": q}
    _WIKI_IMAGE_CACHE[q] = result
    return result


@app.get("/api/director/image-search")
async def director_image_search(
    q: str = Query(..., min_length=2, max_length=200),
    location: str = Query(None, max_length=100),
    current_user=Depends(get_optional_user),
):
    """Search Wikimedia Commons for a contextual image matching the query."""
    global _IMG_SEARCH_LAST
    now = time.time()

    # Build effective query, appending location if provided and not already in q
    effective_q = q
    if location:
        loc_norm = location.strip().lower()
        if loc_norm not in q.lower():
            effective_q = f"{q} {location.strip()}"

    # Check cache
    cached = _IMG_SEARCH_CACHE.get(effective_q)
    if cached and (now - cached["ts"]) < _IMG_SEARCH_TTL:
        return cached["result"] or {"image_url": None}

    # Rate limit: 1 request per 2 seconds
    with _IMG_SEARCH_LOCK:
        elapsed = time.time() - _IMG_SEARCH_LAST
        if elapsed < 2.0:
            import asyncio as _aio
            await _aio.sleep(2.0 - elapsed)
        _IMG_SEARCH_LAST = time.time()

    result = _wikimedia_image_search(effective_q)
    # Fallback: try without location if result is empty
    if not result and location and effective_q != q:
        result = _wikimedia_image_search(q)
    _IMG_SEARCH_CACHE[effective_q] = {"result": result, "ts": now}
    return result or {"image_url": None}


@app.post("/api/tts")
async def text_to_speech(request: Request):
    """ElevenLabs TTS proxy — streams audio/mpeg back to Director Mode."""
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "text is required"}, status_code=400)
    voice_id = body.get("voice_id") or "fjnwTZkKtQOJaYzGLa6n"
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        return JSONResponse({"error": "ElevenLabs not configured"}, status_code=503)
    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json={
                    "text": text,
                    "model_id": "eleven_turbo_v2_5",
                    "voice_settings": {"stability": 0.6, "similarity_boost": 0.8, "style": 0.3},
                },
            )
        if resp.status_code == 200:
            return FastAPIResponse(content=resp.content, media_type="audio/mpeg",
                                   headers={"Content-Type": "audio/mpeg", "Cache-Control": "no-store"})
        error_text = resp.text[:300]
        print(f"[TTS] ElevenLabs error {resp.status_code}: {error_text}")
        return JSONResponse({"error": f"ElevenLabs: {resp.status_code}", "detail": error_text},
                            status_code=resp.status_code)
    except Exception as _e:
        print(f"[TTS] request failed: {_e}")
        return JSONResponse({"error": str(_e)}, status_code=502)


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
    context_block = _profile_ctx + _mission_context

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


def extract_locations_gazetteer(text: str, use_spacy: bool = True) -> list[str]:
    """
    Fast string-match against global gazetteer, then layer spaCy NER on top.
    Gazetteer runs even without spaCy, giving reliable results for known cities.
    Pass use_spacy=False to skip spaCy (saves CPU for low-tier articles).
    """
    found: list[str] = []
    seen: set[str] = set()
    text_lower = text.lower()
    for place, place_lower in zip(_GAZETTEER, _GAZETTEER_LOWER):
        if place_lower in text_lower and place not in seen:
            found.append(place)
            seen.add(place)
    # Layer spaCy on top to catch locations the gazetteer misses
    if use_spacy and _HAS_SPACY and _nlp is not None:
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


def _fetch_og_image(url: str, timeout: int = 3) -> Optional[str]:
    """Fetch Open Graph image URL from article page. Best-effort, short timeout."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            html = resp.read(65536).decode("utf-8", errors="ignore")
        for pattern in [
            r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
            r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
        ]:
            m = re.search(pattern, html, re.I)
            if m:
                return m.group(1)
    except Exception:
        pass
    return None


# ── Gate filters ──────────────────────────────────────────────────────────────
# Any headline for an intelligence platform must contain at least one of these.
# Articles whose headlines contain NONE of these keywords are irrelevant to
# geopolitical/security monitoring (sports, entertainment, lifestyle, etc.)
# and are rejected before geocoding to avoid wasting Nominatim quota.
_STRATEGIC_KEYWORDS: frozenset[str] = frozenset({
    # Violence / conflict
    "attack", "attacks", "conflict", "war", "battle", "fighting", "gunfire", "shooting",
    "airstrike", "air strike", "bomb", "blast", "explosion", "missile", "rocket",
    "strike", "killed", "kill", "dead", "death", "casualties", "fatalities",
    "wounded", "injured", "troops", "military", "forces", "rebel", "insurgent",
    "jihadist", "terrorist", "terrorism", "siege", "offensive", "shelling",
    "ceasefire", "coup", "hostage", "captured", "detained", "arrested", "executed",
    "clashes", "offensive", "advance", "retreat", "frontline", "front line",
    # Maritime / transport
    "ship", "vessel", "tanker", "naval", "piracy", "hijack", "port", "harbour",
    "harbor", "fleet", "submarine", "coast guard", "coastguard", "maritime",
    "aircraft", "airport", "runway", "airspace", "airline", "drone", "uav",
    "strait", "blockade", "sanctions", "embargo",
    # Infrastructure / energy
    "pipeline", "power plant", "electricity", "grid", "blackout", "outage",
    "internet", "network", "cable", "refinery", "oil", "gas", "fuel", "nuclear",
    "cybersecurity", "cyberattack", "ransomware", "hack",
    # Political / civil
    "protest", "demonstration", "riot", "election", "sanctions", "embargo",
    "government", "president", "minister", "parliament", "coup", "referendum",
    "crisis", "emergency", "displaced", "refugee", "evacuate", "blockade",
    "uprising", "revolution", "martial law", "state of emergency",
    # Security signals
    "intelligence", "espionage", "spy", "surveillance",
    "breach", "leak", "warrant", "extradition",
    # Disaster / humanitarian
    "earthquake", "tsunami", "flood", "cyclone", "typhoon", "hurricane",
    "wildfire", "eruption", "disaster", "famine", "humanitarian",
})

# Gate 2: hard blacklist — titles clearly about sports/entertainment/lifestyle.
# Checked BEFORE strategic keywords to reject obvious noise quickly.
_BLACKLIST_PHRASES: frozenset[str] = frozenset({
    # Sports
    "premier league", "champions league", "world cup final", "super bowl",
    "nba finals", "nfl ", "nba ", "nhl ", "mlb ", "mls ",
    "formula 1", "formula one", "grand prix", "wimbledon", "us open tennis",
    "australian open", "french open", "golf tournament", "golf championship",
    "soccer match", "football match", "football game", "rugby match",
    "cricket match", "boxing match", "ufc ", "wrestling match",
    # Entertainment / celebrity
    "box office", "oscar winner", "grammy award", "emmy award",
    "celebrity", "actor arrested", "actress", "pop star", "music video",
    "album release", "movie release", "film review", "tv show", "reality show",
    "season finale", "netflix series", "streaming series",
    # Lifestyle / wellness
    "best diet", "weight loss tips", "fitness tips", "skincare routine",
    "beauty products", "fashion week", "travel tips", "vacation guide",
    "restaurant review", "food recipe", "holiday deals",
    # Micro-finance / irrelevant business
    "payday loan", "microfinance", "microloan", "fintech app",
    "cryptocurrency price", "bitcoin price", "nft sales",
})


def _blacklist_gate_fails(title: str) -> bool:
    """Returns True if the title matches a blacklisted phrase (article should be dropped)."""
    text = title.lower()
    return any(phrase in text for phrase in _BLACKLIST_PHRASES)


def _strategic_gate_passes(title: str, summary: str = "") -> bool:
    """
    Gate 4: positive strategic keyword gate for global feeds.
    Rejects articles whose title+summary contains zero security/geopolitical keywords.
    """
    text = (f"{title} {summary[:200]}").lower()
    return any(kw in text for kw in _STRATEGIC_KEYWORDS)


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

# Local city feeds: bypass Gate 0 keyword filter, use city coordinates as default geocode
# Lookup: url → (country, city, default_lat, default_lon)
_LOCAL_FEED_CITY: dict[str, tuple[str, str, float, float]] = {}
for source_name, feed_url, country, city, city_lat, city_lon in LOCAL_CITY_FEEDS:
    if not feed_url or feed_url in _seen_feed_urls:
        continue
    _SCAN_FEEDS.append((source_name, feed_url))
    _seen_feed_urls.add(feed_url)
    _SCAN_FEED_REGION[feed_url] = "europe"
    _LOCAL_FEED_CITY[feed_url] = (country, city, city_lat, city_lon)

_feed_regions_counter = Counter(_SCAN_FEED_REGION.values())
print(
    f"[feeds] scan registry loaded {len(_SCAN_FEEDS)} total feeds "
    f"({len(ADDITIONAL_SCAN_FEEDS)} additional candidates, {len(_LOCAL_FEED_CITY)} local-city) regions={dict(_feed_regions_counter)}"
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
        "image_url":       article.get("image_url") or article.get("og_image") or article.get("image") or None,
        "summary":         (article.get("summary") or article.get("description") or "")[:400],
        "source_name":     article.get("source_name") or article.get("feed_name") or article.get("source") or "",
        "num_sources":     article.get("num_sources") or 1,
        # LLM intelligence fields
        "event_title":     article.get("event_title"),
        "article_type":    article.get("article_type") or "other",
        "icon_type":       article.get("icon_type") or "other",
        "tier":            article.get("tier") or 3,
        "context_summary": article.get("context_summary") or "",
        "is_breaking":     article.get("is_breaking") or False,
        "llm_relevance_score": article.get("llm_relevance_score") or 0,
        "llm_extracted":   article.get("llm_extracted") or False,
        "show_on_map":     article.get("location_confidence", "none") not in ("country", "none", "fallback_country"),
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
    # Evict processed URL entries older than 72h so the cache doesn't block new articles
    _cutoff = time.time() - _PROCESSED_URLS_TTL
    stale_urls = [u for u, ts in _PROCESSED_URLS.items() if ts < _cutoff]
    for _su in stale_urls:
        _PROCESSED_URLS.pop(_su, None)
    # Evict director background jobs older than 1 hour
    _now_utc = datetime.now(timezone.utc)
    for _jid in list(_DIRECTOR_JOBS.keys()):
        try:
            _created = datetime.fromisoformat(_DIRECTOR_JOBS[_jid]["created_at"])
            if (_now_utc - _created).total_seconds() > 3600:
                del _DIRECTOR_JOBS[_jid]
        except Exception:
            pass


def _upsert_news_article(article: dict) -> None:
    url = article.get("url")
    if not url:
        return
    # Strip raw HTML body before storing — context_summary is the useful part
    if "body" in article:
        import re as _re_html
        article["body"] = _re_html.sub(r'<[^>]+>', '', article.get("body") or "")[:500]
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


def _claude_budget_ok() -> bool:
    """Return False and log if today's Claude spend has reached the daily hard cap."""
    today_spend = usage_tracker.get_today_cost()
    if today_spend >= CLAUDE_DAILY_HARD_CAP_USD:
        print(f"[claude] Daily cap hit: ${today_spend:.3f} >= "
              f"${CLAUDE_DAILY_HARD_CAP_USD} — skipping call")
        return False
    return True


_GATE1_SYSTEM = (
    "You are an intelligence relevance analyst. Score each article 1-5 for operational "
    "relevance to the active mission profile. 5=directly relevant, 3=tangentially relevant, "
    "1=not relevant. Respond ONLY with a JSON array matching the input order: "
    '[{"id":"...","score":N,"reason":"short reason"}, ...]'
)


def _gate1_filter_markers(markers: list[dict]) -> None:
    """Batch-score up to 30 markers with Claude and remove those scoring 1-2.

    Modifies the markers list IN PLACE.  One Claude call per feed cycle max.
    Stores relevance_score + relevance_reason on each surviving marker.
    """
    if not markers or not _ACTIVE_PROFILE or not client:
        return
    if not _claude_budget_ok():
        return

    batch = markers[:30]
    profile_ctx = _format_profile_context(_ACTIVE_PROFILE)

    items_json = _json.dumps([
        {"id": m.get("id", str(i)), "title": m.get("title", "")[:150], "summary": (m.get("summary") or "")[:200]}
        for i, m in enumerate(batch)
    ], ensure_ascii=False)

    user_prompt = (
        f"Mission profile:\n{profile_ctx}\n\nArticles to score:\n{items_json}\n\n"
        "Respond ONLY with the JSON array."
    )

    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=800,
            system=_GATE1_SYSTEM,
            messages=[{"role": "user", "content": user_prompt}],
        )
        usage_tracker.record_call(
            msg.usage.input_tokens,
            msg.usage.output_tokens,
            call_type="gate1_relevance",
            headline=f"Gate1: {len(batch)} articles",
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])
        scores = _json.loads(raw)
    except Exception as exc:
        print(f"[gate1] Claude call failed: {exc}")
        return

    # Build lookup: id → score entry
    score_map: dict[str, dict] = {}
    for entry in (scores if isinstance(scores, list) else []):
        if isinstance(entry, dict) and "id" in entry:
            score_map[str(entry["id"])] = entry

    # Tag markers with score; collect indices to remove (score ≤ 2)
    to_remove: set[int] = set()
    for i, marker in enumerate(batch):
        mid = marker.get("id", str(i))
        entry = score_map.get(str(mid)) or score_map.get(mid)
        if entry:
            score = int(entry.get("score", 3))
            marker["relevance_score"] = score
            marker["relevance_reason"] = (entry.get("reason") or "")[:120]
            if score <= 2:
                to_remove.add(i)
                print(f"[gate1] REJECT score={score} '{marker.get('title','')[:80]}'")
            else:
                print(f"[gate1] KEEP   score={score} '{marker.get('title','')[:80]}'")

    # Remove low-relevance markers from the list (iterate in reverse to preserve indices)
    for i in sorted(to_remove, reverse=True):
        if i < len(markers):
            markers.pop(i)

    print(f"[gate1] scored {len(batch)} articles — removed {len(to_remove)}")


_NOMINATIM_PERSON_TYPES = {"person", "given_name", "surname", "family_name"}

def _geocode_result_matches_country(geocode_result: dict, expected_iso) -> bool:
    """Return True if Nominatim result country matches the LLM-expected ISO2.
    If expected_iso is None/unknown, or Nominatim didn't return a country, always accept.
    Always rejects results where Nominatim identifies a person name rather than a place."""
    # Reject person-name results — Nominatim can geocode "Trump" to US locations
    result_type = str(geocode_result.get("type") or "").lower()
    result_cls  = str(geocode_result.get("class") or "").lower()
    if result_type in _NOMINATIM_PERSON_TYPES or result_cls in _NOMINATIM_PERSON_TYPES:
        print(f"[geocode_guard] Rejected person/name result: type={result_type} class={result_cls}")
        return False
    if not expected_iso:
        return True
    result_cc = (geocode_result.get("address") or {}).get("country_code", "").lower().strip()
    if not result_cc:
        return True
    match = result_cc == str(expected_iso).lower().strip()
    print(f"[geocode_guard] expected={str(expected_iso).lower()} got={result_cc} match={match}")
    return match


def _run_news_conflict_extraction_sync():
    """
    Synchronous extraction pass — runs in ThreadPoolExecutor so blocking I/O
    (feedparser HTTP, Nominatim HTTP) never touches the asyncio event loop.
    Prints per-feed diagnostics for every source to aid debugging.
    """
    global _NEWS_CONFLICT_MARKERS, _PROCESSED_URLS, _FIRST_EXTRACTION_DONE

    # Reload NEWS_PATTERN rules into engine each cycle (picks up DB changes)
    if _news_pattern_engine:
        try:
            from database import RuleConfig, get_db as _gdb_np
            with _gdb_np() as _db_np:
                _np_rows = _db_np.query(RuleConfig).filter(
                    RuleConfig.trigger_type == "NEWS_PATTERN",
                    RuleConfig.enabled == True,  # noqa: E712
                ).all()
            import json as _jnp
            _np_rule_dicts = [
                {
                    "id":           r.id,
                    "name":         r.name,
                    "rule_name":    r.rule_name,
                    "trigger_type": r.trigger_type,
                    "severity":     r.severity,
                    "icon_type":    r.icon_type,
                    "enabled":      r.enabled,
                    "params":       _jnp.loads(r.params) if isinstance(r.params, str) else (r.params or {}),
                }
                for r in _np_rows
            ]
            _news_pattern_engine.reload_rules(_np_rule_dicts)
        except Exception:
            pass

    MAX_NOM_CALLS           = 100   # hard cap per cycle (only counts uncached HTTP calls)
    MAX_LLM_CALLS_PER_CYCLE = 25    # production default — demo mode used 100
    nom_calls = 0
    llm_calls_this_cycle = 0
    new_markers = []
    feeds_loaded = 0
    articles_fetched = 0
    cycle_unique_urls: set[str] = set()
    nom_cap_logged = False
    total_articles_parsed = 0
    articles_with_coords = 0
    articles_without_coords = 0
    rejected_stale = 0
    rejected_gate0 = 0
    rejected_no_geo = 0
    successful_candidates = Counter()
    failed_feeds: dict = {}
    geo_stats_before = get_geocode_stats()

    # On the very first cycle, clear processed URLs so all current articles are evaluated fresh
    if not _FIRST_EXTRACTION_DONE:
        _PROCESSED_URLS.clear()
        print(f"[news-conflicts] First cycle — processed URL cache cleared")
    else:
        print(f"[news-conflicts] Processed URL cache size: {len(_PROCESSED_URLS)}")

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

    MAX_FEEDS_PER_CYCLE = 150  # cap per cycle; shuffle ensures coverage rotates
    import random as _rnd_feeds
    _feeds_this_cycle = list(_SCAN_FEEDS)
    _rnd_feeds.shuffle(_feeds_this_cycle)
    _feeds_this_cycle = _feeds_this_cycle[:MAX_FEEDS_PER_CYCLE]

    from concurrent.futures import ThreadPoolExecutor as _FetchTPE
    with _FetchTPE(max_workers=20, thread_name_prefix="rss-fetch") as _fp:
        _scan_results = list(_fp.map(_prefetch_feed, _feeds_this_cycle))

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

            # ── Freshness filter: skip articles older than NEWS_WINDOW_HOURS (7 days) ──
            try:
                pub_age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(published_iso)).total_seconds() / 3600
                if pub_age_h > _NEWS_WINDOW_HOURS:
                    rejected_stale += 1
                    continue
            except Exception:
                pass

            # ── Language filter: only process EN / FR / DE ──────────────────────
            if _HAS_LANGDETECT:
                try:
                    _art_lang = _langdetect_detect(f"{title} {summary[:200]}")
                except Exception:
                    _art_lang = "unknown"
                if _art_lang not in ("en", "fr", "de"):
                    print(f"[feed] Skipped article (lang={_art_lang}): {title[:60]}")
                    continue

            # Mark as processed only AFTER freshness check (so stale articles don't
            # permanently clog the dedup cache if the filter threshold changes)
            _PROCESSED_URLS[url] = time.time()

            # ── Gate 2: hard blacklist (sports/entertainment/lifestyle) ──────────
            if _blacklist_gate_fails(title):
                rejected_gate0 += 1
                continue

            # ── Gate 3: local city feed routing (bypass Gate 4) ───────────────
            _city_meta = _LOCAL_FEED_CITY.get(feed_url)
            if _city_meta:
                _city_country, _city_name, _city_lat, _city_lon = _city_meta
            else:
                # ── Gate 4: strategic keyword filter for global feeds ─────────
                if not _strategic_gate_passes(title, summary):
                    rejected_gate0 += 1
                    continue

            # ── Event type pre-classification ─────────────────────────────────
            article_event_type = _classify_event_type(title, summary)

            # ── LLM article analysis (before geocoding — gates on tier) ───────
            _clean_body = re.sub(r'<[^>]+>', '', summary or '')
            _intel = None
            _intel_llm_called = False
            _article_calls_today = usage_tracker.get_calls_today_by_type("article_intelligence")
            _can_call_llm = (
                client
                and llm_calls_this_cycle < MAX_LLM_CALLS_PER_CYCLE
                and _article_calls_today < MAX_LLM_ARTICLE_CALLS_PER_DAY
                and _claude_budget_ok()
            )
            if _can_call_llm:
                try:
                    print(f"[article_intel] Calling Haiku for: {title[:60]}")
                    _intel = analyse_article(title, _clean_body, source_name)
                    llm_calls_this_cycle += 1
                    _intel_llm_called = True
                    print(f"[article_intel] Got tier={_intel.get('tier')} "
                          f"type={_intel.get('article_type')} "
                          f"score={_intel.get('relevance_score')}")
                    time.sleep(0.1)
                except Exception as _ai_err:
                    import traceback as _tb
                    print(f"[article_intel] FAILED: {type(_ai_err).__name__}: {_ai_err}")
                    _tb.print_exc()
            elif not client:
                if llm_calls_this_cycle == 0:
                    print("[article_intel] SKIPPED — Anthropic client is None (ANTHROPIC_API_KEY not set?)")
            elif _article_calls_today >= MAX_LLM_ARTICLE_CALLS_PER_DAY:
                if llm_calls_this_cycle == 0:
                    print(f"[article_intel] Daily cap hit ({_article_calls_today}/{MAX_LLM_ARTICLE_CALLS_PER_DAY}) — remaining articles use fallback")
            elif llm_calls_this_cycle >= MAX_LLM_CALLS_PER_CYCLE:
                if llm_calls_this_cycle == MAX_LLM_CALLS_PER_CYCLE:
                    print(f"[article_intel] Cycle cap reached ({MAX_LLM_CALLS_PER_CYCLE}) — remaining articles use fallback")
            if _intel is None:
                _intel = {
                    "location": None, "location_country": None, "location_confidence": "none",
                    "article_type": "other", "icon_type": "other", "tier": 3,
                    "relevance_score": 5.0, "event_title": None, "has_image": False,
                    "is_breaking": False, "context_summary": "",
                }
            _intel_tier    = int(_intel.get("tier") or 3)
            _intel_loc     = _intel.get("location")
            _intel_conf    = _intel.get("location_confidence", "none")
            _intel_country = _intel.get("location_country")
            _intel_score   = float(_intel.get("relevance_score") or 0)

            # Drop tier 4 before geocoding (avoids wasting Nominatim quota)
            if _intel_tier >= 4:
                rejected_gate0 += 1
                continue

            allow_live_lookup = nom_calls < MAX_NOM_CALLS
            if not allow_live_lookup and not nom_cap_logged:
                print(f"[feed] Nominatim cap ({MAX_NOM_CALLS}) reached — continuing feed scan with cached geocodes/fallback only")
                nom_cap_logged = True

            winning_candidate = None
            candidates: list = []
            _LLM_REJECT_TYPES = {"amenity", "office", "building", "shop",
                                 "person", "given_name", "surname", "family_name"}

            # ── Geocoding ─────────────────────────────────────────────────────
            if _city_meta:
                geo = {"lat": _city_lat, "lon": _city_lon, "display_name": _city_name, "type": "city_default"}
                winning_candidate = _city_name
                candidates = [_city_name]
                meta = {"location_confidence": "city_feed", "resolved_country_code": None, "resolved_display_name": _city_name}
                # Tier 1 city feed: attempt street-level precision geocoding
                if _intel_tier == 1 and _intel_loc and _intel_conf == "city" and allow_live_lookup:
                    try:
                        _sl_query = f"{_intel_loc}, {_city_name}, {_city_country}"
                        _sl_geos  = geocode_place(_sl_query)
                        if _sl_geos:
                            _sl      = _sl_geos[0]
                            _sl_type = str(_sl.get("type") or "").lower()
                            _sl_cls  = str(_sl.get("class") or "").lower()
                            _sl_lat  = float(_sl.get("lat", 0))
                            _sl_lon  = float(_sl.get("lon", 0))
                            _SL_GOOD = {"highway", "place", "suburb", "neighbourhood", "quarter"}
                            if (_sl_type in _SL_GOOD or _sl_cls in _SL_GOOD) and _sl_lat != 0.0:
                                geo  = {"lat": _sl_lat, "lon": _sl_lon, "display_name": _sl.get("display_name"), "type": _sl.get("type")}
                                meta = {
                                    "location_confidence": "llm_street",
                                    "resolved_country_code": (_sl.get("address") or {}).get("country_code"),
                                    "resolved_display_name": _sl.get("display_name"),
                                }
                                nom_calls += 1
                    except Exception:
                        pass
            else:
                geo = None
                stats_before = get_geocode_stats()

                # Primary: geocode LLM-extracted location (more precise than text-blob NER)
                if _intel_loc and _intel_conf in ("city", "region", "country") and allow_live_lookup:
                    try:
                        _lgeos = geocode_place(_intel_loc)
                        if _lgeos:
                            _lg    = _lgeos[0]
                            _ltype = str(_lg.get("type") or "").lower()
                            _lcls  = str(_lg.get("class") or "").lower()
                            _llat  = float(_lg.get("lat", 0))
                            _llon  = float(_lg.get("lon", 0))
                            if (_llat != 0.0 and _llon != 0.0
                                    and _ltype not in _LLM_REJECT_TYPES
                                    and _lcls  not in _LLM_REJECT_TYPES
                                    and _geocode_result_matches_country(_lg, _intel_country)):
                                geo = {"lat": _llat, "lon": _llon, "display_name": _lg.get("display_name"), "type": _lg.get("type")}
                                meta = {
                                    "location_confidence": "llm_geocoded",
                                    "resolved_country_code": (_lg.get("address") or {}).get("country_code"),
                                    "resolved_display_name": _lg.get("display_name"),
                                }
                                winning_candidate = _intel_loc
                    except Exception:
                        pass

                # Fallback: text-blob NER geocoding (spaCy only for tier 1)
                if not geo:
                    geo, winning_candidate, candidates, meta = _geocode_from_text_blob(
                        title,
                        summary,
                        source_name=source_name,
                        feed_url=feed_url,
                        max_candidates=5,
                        allow_live_lookup=allow_live_lookup,
                        use_spacy=(_intel_tier == 1),
                    )

                stats_after = get_geocode_stats()
                if stats_after["http_calls"] > stats_before["http_calls"]:
                    nom_calls += (stats_after["http_calls"] - stats_before["http_calls"])
                f_locations += len(candidates[:5])

            if not geo:
                articles_without_coords += 1
                rejected_no_geo += 1
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

            # OG image fetch for tier 1/2 articles with has_image=True
            if _intel.get("has_image") and not entry_image_url:
                entry_image_url = _fetch_og_image(url)

            article_record = {
                "url":                   url,
                "title":                 title,
                "source":                source_name,
                "feed_region":           feed_region,
                "summary":               summary[:400],
                "published":             published_iso,
                "expires_at":            expires_iso,
                "location_name":         geo.get("display_name"),
                "lat":                   lat,
                "lon":                   lon,
                "confidence":            confidence,
                "location_confidence":   location_confidence,
                "resolved_country_code": meta.get("resolved_country_code"),
                "resolved_display_name": meta.get("resolved_display_name"),
                "geocode_candidate":     winning_candidate,
                "event_type":            article_event_type,
                "image_url":             entry_image_url,
                "updated_at":            datetime.now(timezone.utc).isoformat(),
                # LLM intelligence fields
                "extracted_location":    _intel_loc or "",
                "extraction_confidence": _intel_conf or "none",
                "location_country":      _intel_country or "",
                "article_type":          _intel.get("article_type") or "other",
                "icon_type":             _intel.get("icon_type") or "other",
                "tier":                  _intel_tier,
                "llm_relevance_score":   _intel_score,
                "event_title":           _intel.get("event_title"),
                "has_image":             _intel.get("has_image", False),
                "is_breaking":           _intel.get("is_breaking", False),
                "context_summary":       _intel.get("context_summary", ""),
                "llm_extracted":         _intel_llm_called,
                "entities":              _intel.get("entities") or [],
                "source_name":           source_name,
            }

            _upsert_news_article(article_record)
            try:
                write_news_article(article_record)
                if _intel_llm_called and article_record.get("lat") is not None:
                    entity_linker.link_article(
                        url=url,
                        lat=article_record.get("lat"),
                        lon=article_record.get("lon"),
                        title=title,
                        entities=article_record.get("entities") or [],
                    )
            except Exception as _aw_err:
                print(f"[alert-writer] news article persist error: {_aw_err}")

            # Feed news pattern engine → fusion (tier 1 only)
            if (_news_pattern_engine
                    and _intel_tier == 1
                    and article_record.get("lat") is not None
                    and (article_record.get("location_country") or article_record.get("resolved_country_code"))):
                try:
                    _news_pattern_engine.on_article_ingested(article_record)
                except Exception:
                    pass

            # Feed surge engine — keyword path (all articles, no LLM required)
            if _surge_engine:
                try:
                    _surge_engine.on_raw_article({
                        "title":  article_record.get("title", ""),
                        "source": article_record.get("source", ""),
                        "url":    article_record.get("url", ""),
                    })
                except Exception:
                    pass

            # Feed surge engine — LLM-enriched path (tiers 1-3 with resolved country)
            if _surge_engine and article_record.get("location_country"):
                try:
                    _surge_engine.on_article(article_record)
                except Exception:
                    pass

            marker = _make_news_marker(article_record)
            if marker:
                new_markers.append(marker)
                f_added += 1

        print(f"[feed] {source_name}: {f_articles} articles — {f_locations} locs — {f_geocoded} geocoded — {f_added} added")

    # ── Gate 1: Claude relevance scoring (only when mission profile active) ──────
    if new_markers and _ACTIVE_PROFILE and client:
        try:
            _gate1_filter_markers(new_markers)
        except Exception as _g1_err:
            print(f"[gate1] error — skipping filter: {_g1_err}")

    _merge_conflict_markers(new_markers)
    _prune_news_article_store()
    _FIRST_EXTRACTION_DONE = True
    geo_stats_after = get_geocode_stats()
    nom_cache_size = geo_stats_after["cache_size"]
    nom_calls_delta = geo_stats_after["http_calls"] - geo_stats_before["http_calls"]
    top_candidates = [c for c, _ in successful_candidates.most_common(5)]
    geo_validation_stats = _snapshot_geo_validation_stats()
    print(
        f"[news-conflicts] CYCLE SUMMARY: feeds={feeds_loaded}/{len(_SCAN_FEEDS)} "
        f"fetched={articles_fetched} dedup_unique={len(cycle_unique_urls)} parsed={total_articles_parsed} "
        f"rejected_stale={rejected_stale} rejected_gate0={rejected_gate0} rejected_no_geo={rejected_no_geo} "
        f"geocoded={articles_with_coords} new_markers={len(new_markers)} total_active={len(_NEWS_CONFLICT_MARKERS)} "
        f"dedup_cache={len(_PROCESSED_URLS)} nominatim_calls={nom_calls_delta}"
    )
    print(f"[news-conflicts] top_candidates={top_candidates}")
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
    """Async wrapper: staggered 45s startup delay, then every 30 minutes."""
    await asyncio.sleep(45)  # staggered startup — prevents thundering herd
    loop = asyncio.get_event_loop()
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
            # Write news_points snapshot
            try:
                from database import NewsArticle
                with get_db() as _sn_db:
                    _pts = (_sn_db.query(NewsArticle)
                                  .filter(NewsArticle.lat.isnot(None), NewsArticle.lon.isnot(None))
                                  .order_by(NewsArticle.ingested_at.desc())
                                  .limit(2000).all())
                _news_snap = [
                    {"id": n.id, "lat": n.lat, "lon": n.lon,
                     "title": (n.event_title or n.title or "")[:150],
                     "domain": "NEWS", "relevance": n.relevance_score or 0,
                     "tier": n.tier, "ingested_at": n.ingested_at.isoformat() if n.ingested_at else ""}
                    for n in _pts
                ]
                _write_snapshot_sync("news_points", _news_snap)
            except Exception as _nse:
                print(f"[SNAPSHOT] news_points error: {_nse}")
        except Exception as ex:
            print(f"[news-conflicts] loop error: {ex}")


async def _background_news_geocode_loop():
    """Async wrapper for periodic background geocoding of pending articles."""
    await asyncio.sleep(120)  # staggered startup
    loop = asyncio.get_event_loop()
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
    """Rebuild the surface pool, staggered 90s after startup, then every 10 min."""
    global _SURFACE_POOL, _SURFACE_POOL_UPDATED_AT, _SURFACE_POOL_LAST_NONEMPTY
    await asyncio.sleep(90)  # staggered startup
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
                # Write surge_events snapshot alongside surface pool rebuild
                try:
                    from database import SurgeEvent as _SE
                    with get_db() as _sedb:
                        _se_rows = (_sedb.query(_SE)
                                         .filter(_SE.status == "active")
                                         .order_by(_SE.created_at.desc())
                                         .limit(50).all())
                    await _write_snapshot("surge_events", [
                        {"surge_id": s.surge_id, "headline": s.headline,
                         "severity": s.severity, "lat": s.lat, "lon": s.lon,
                         "article_count": s.article_count,
                         "location_name": s.location_name,
                         "location_country": s.location_country,
                         "context_summary": s.context_summary,
                         "created_at": s.created_at.isoformat() if s.created_at else None,
                         "expires_at": s.expires_at.isoformat() if s.expires_at else None}
                        for s in _se_rows
                    ])
                except Exception as _ses:
                    print(f"[SNAPSHOT] surge_events error: {_ses}")
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


def _surface_pool_cache_load() -> list | None:
    """Return pool from DB cache if < 4 hours old, else None."""
    try:
        from database import SurfacePoolCache
        cutoff = datetime.utcnow() - timedelta(hours=4)
        with get_db() as _db:
            row = (_db.query(SurfacePoolCache)
                      .filter(SurfacePoolCache.cached_at >= cutoff)
                      .order_by(SurfacePoolCache.cached_at.desc())
                      .first())
        if row:
            pool = _json.loads(row.pool_json)
            print(f"[surface] DB cache hit — {len(pool)} items (age={int((datetime.utcnow()-row.cached_at).total_seconds()//60)}min)")
            return pool
    except Exception as _e:
        print(f"[surface] cache load error: {_e}")
    return None

def _surface_pool_cache_save(pool: list) -> None:
    """Upsert pool to DB cache (delete old rows first)."""
    try:
        from database import SurfacePoolCache
        with get_db() as _db:
            _db.query(SurfacePoolCache).delete(synchronize_session=False)
            _db.add(SurfacePoolCache(
                cached_at=datetime.utcnow(),
                pool_json=_json.dumps(pool, default=str),
            ))
            _db.commit()
    except Exception as _e:
        print(f"[surface] cache save error: {_e}")

# ── Horizon Snapshot: pre-built JSON cache for zero-latency cold starts ───────

def _write_snapshot_sync(key: str, payload) -> None:
    """Upsert a snapshot row. Called from executor threads or async contexts."""
    try:
        from database import HorizonSnapshot
        data = _json.dumps(payload, default=str, ensure_ascii=False)
        with get_db() as _db:
            row = _db.query(HorizonSnapshot).filter_by(key=key).first()
            if row:
                row.payload  = data
                row.built_at = datetime.utcnow()
            else:
                _db.add(HorizonSnapshot(key=key, payload=data, built_at=datetime.utcnow()))
            _db.commit()
        print(f"[SNAPSHOT] {key} written ({len(data)} bytes)")
    except Exception as _se:
        print(f"[SNAPSHOT] write error for {key}: {_se}")

async def _write_snapshot(key: str, payload) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(_executor, _write_snapshot_sync, key, payload)

def _read_snapshot(key: str):
    """Sync read for startup use. Returns parsed JSON or None."""
    try:
        from database import HorizonSnapshot
        with get_db() as _db:
            row = _db.query(HorizonSnapshot).filter_by(key=key).first()
        if row:
            return _json.loads(row.payload), row.built_at
    except Exception as _se:
        print(f"[SNAPSHOT] read error for {key}: {_se}")
    return None, None


async def _startup_snapshot_prefill() -> None:
    """
    On startup: build any missing or stale (>6h) snapshots directly from the DB.
    No external calls, no Claude — pure DB reads. Completes in 2-3 seconds.
    """
    await asyncio.sleep(3)  # let DB init settle
    cutoff = datetime.utcnow() - timedelta(hours=6)
    written = 0
    print("[STARTUP] snapshot prefill starting…")

    def _age_ok(key: str) -> bool:
        _, built_at = _read_snapshot(key)
        return built_at is not None and built_at > cutoff

    try:
        from database import (
            NewsArticle as _NAp, Alert as _ALp, FusionEvent as _FEp,
            SurgeEvent as _SEp, ForesightAssessment as _FAp, ThreatSnapshotHourly as _TSHp,
        )
        loop = asyncio.get_event_loop()

        if not _age_ok("news_points"):
            def _build_news():
                with get_db() as _db:
                    rows = (_db.query(_NAp)
                               .filter(_NAp.lat.isnot(None), _NAp.lon.isnot(None))
                               .order_by(_NAp.ingested_at.desc()).limit(2000).all())
                return [{"id": n.id, "lat": n.lat, "lon": n.lon,
                         "title": (n.event_title or n.title or "")[:150],
                         "domain": "NEWS", "relevance": n.relevance_score or 0,
                         "tier": n.tier, "ingested_at": n.ingested_at.isoformat() if n.ingested_at else ""}
                        for n in rows]
            _write_snapshot_sync("news_points", await loop.run_in_executor(_executor, _build_news))
            written += 1

        if not _age_ok("alerts_active"):
            def _build_alerts():
                with get_db() as _db:
                    rows = (_db.query(_ALp).filter(_ALp.status == "active")
                               .order_by(_ALp.created_at.desc()).limit(500).all())
                return [{"alert_id": a.alert_id, "source": a.source, "alert_type": a.alert_type,
                         "title": a.title, "severity": a.severity, "lat": a.lat, "lon": a.lon,
                         "country_code": a.country_code, "status": a.status,
                         "relevance_score": a.relevance_score,
                         "created_at": a.created_at.isoformat() if a.created_at else None}
                        for a in rows]
            _write_snapshot_sync("alerts_active", await loop.run_in_executor(_executor, _build_alerts))
            written += 1

        if not _age_ok("fusions"):
            def _build_fusions():
                with get_db() as _db:
                    rows = (_db.query(_FEp).filter(_FEp.status == "active")
                               .order_by(_FEp.created_at.desc()).limit(100).all())
                return [{"fusion_id": f.fusion_id, "title": f.title, "subtitle": f.subtitle,
                         "narrative": f.narrative, "severity": f.severity,
                         "confidence": f.confidence, "lat": f.lat, "lon": f.lon,
                         "signal_count": f.signal_count, "domains": f.domains,
                         "key_signals": f.key_signals, "status": f.status,
                         "marker_visible": f.marker_visible,
                         "created_at": f.created_at.isoformat() if f.created_at else None,
                         "expires_at": f.expires_at.isoformat() if f.expires_at else None}
                        for f in rows]
            _write_snapshot_sync("fusions", await loop.run_in_executor(_executor, _build_fusions))
            written += 1

        if not _age_ok("surge_events"):
            def _build_surges():
                with get_db() as _db:
                    rows = (_db.query(_SEp).filter(_SEp.status == "active")
                               .order_by(_SEp.created_at.desc()).limit(50).all())
                return [{"surge_id": s.surge_id, "headline": s.headline, "severity": s.severity,
                         "lat": s.lat, "lon": s.lon, "article_count": s.article_count,
                         "location_name": s.location_name, "location_country": s.location_country,
                         "context_summary": s.context_summary,
                         "created_at": s.created_at.isoformat() if s.created_at else None,
                         "expires_at": s.expires_at.isoformat() if s.expires_at else None}
                        for s in rows]
            _write_snapshot_sync("surge_events", await loop.run_in_executor(_executor, _build_surges))
            written += 1

        if not _age_ok("foresight_latest"):
            def _build_foresight():
                with get_db() as _db:
                    rows = (_db.query(_FAp).order_by(_FAp.generated_at.desc()).limit(20).all())
                return [{"zone_id": r.zone_id, "zone_name": r.zone_name,
                         "escalation_probability_30d": r.escalation_probability_30d,
                         "confidence": r.confidence, "analyst_note": r.analyst_note,
                         "situation_summary": r.situation_summary,
                         "generated_at": r.generated_at.isoformat() if r.generated_at else None}
                        for r in rows]
            _write_snapshot_sync("foresight_latest", await loop.run_in_executor(_executor, _build_foresight))
            written += 1

        if not _age_ok("threat_matrix"):
            def _build_tm():
                with get_db() as _db:
                    rows = (_db.query(_TSHp).order_by(_TSHp.snapshot_at.desc()).limit(100).all())
                return [{"region_name": r.region_name, "region_id": r.region_id,
                         "score": r.score, "threat_level": r.threat_level,
                         "snapshot_at": r.snapshot_at.isoformat() if r.snapshot_at else None}
                        for r in rows]
            _write_snapshot_sync("threat_matrix", await loop.run_in_executor(_executor, _build_tm))
            written += 1

    except Exception as _pre:
        print(f"[STARTUP] snapshot prefill error: {_pre}")

    print(f"[STARTUP] snapshot prefill complete — {written} keys written")


def _refresh_surface_pool_sync(reason: str = "manual") -> list:
    global _SURFACE_POOL, _SURFACE_POOL_UPDATED_AT, _SURFACE_POOL_LAST_NONEMPTY
    if not _SURFACE_BUILD_LOCK.acquire(blocking=False):
        with _SURFACE_POOL_LOCK:
            return list(_SURFACE_POOL)
    try:
        # Check DB cache first — avoids full rebuild on cold start
        if reason in ("api-empty", "loop") and not _SURFACE_POOL:
            cached = _surface_pool_cache_load()
            if cached:
                with _SURFACE_POOL_LOCK:
                    _SURFACE_POOL = cached
                    _SURFACE_POOL_UPDATED_AT = datetime.now(timezone.utc).isoformat()
                    _SURFACE_POOL_LAST_NONEMPTY = time.time()
                return cached

        new_pool = _build_surface_pool()
        if new_pool:
            with _SURFACE_POOL_LOCK:
                _SURFACE_POOL = new_pool
                _SURFACE_POOL_UPDATED_AT = datetime.now(timezone.utc).isoformat()
                _SURFACE_POOL_LAST_NONEMPTY = time.time()
            print(f"[surface] {reason} refresh — {len(new_pool)} items")
            _surface_pool_cache_save(new_pool)  # persist for next cold start
            _write_snapshot_sync("surface_pool", new_pool)
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
    await asyncio.sleep(30)  # staggered startup
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
    return _cached_json_response(
        "geo_countries",
        lambda: _json.loads(_GEO_COUNTRIES_FILE.read_text(encoding="utf-8")),
        max_age=3600,
    )


# ── Land-shape cache for route validation ────────────────────────────────────
_LAND_SHAPES_CACHE: list | None = None

def _get_land_shapes():
    global _LAND_SHAPES_CACHE
    if _LAND_SHAPES_CACHE is not None:
        return _LAND_SHAPES_CACHE
    if not _HAS_SHAPELY or not _GEO_COUNTRIES_FILE.exists():
        return []
    try:
        data = _json.loads(_GEO_COUNTRIES_FILE.read_text(encoding="utf-8"))
        _LAND_SHAPES_CACHE = [_shape(f["geometry"]) for f in data.get("features", []) if f.get("geometry")]
        print(f"[validate-route] cached {len(_LAND_SHAPES_CACHE)} country shapes")
    except Exception as e:
        print(f"[validate-route] shape cache error: {e}")
        _LAND_SHAPES_CACHE = []
    return _LAND_SHAPES_CACHE


def _validate_route_sync(points: list) -> dict:
    if not _HAS_SHAPELY:
        return {"points": [{"lat": p[0], "lon": p[1], "is_water": None} for p in points]}
    from shapely.geometry import Point
    from shapely.ops import nearest_points
    land_shapes = _get_land_shapes()
    if not land_shapes:
        return {"points": [{"lat": p[0], "lon": p[1], "is_water": None} for p in points]}
    result_pts = []
    for lat, lon in points:
        pt      = Point(lon, lat)
        on_land = any(s.contains(pt) for s in land_shapes)
        if not on_land:
            result_pts.append({"lat": lat, "lon": lon, "is_water": True})
        else:
            # Snap to nearest coastline
            snapped = False
            for s in land_shapes:
                if s.contains(pt):
                    try:
                        coast = nearest_points(pt, s.boundary)[1]
                        result_pts.append({
                            "lat": coast.y, "lon": coast.x,
                            "is_water": True, "snapped": True,
                            "original": {"lat": lat, "lon": lon},
                        })
                        snapped = True
                    except Exception:
                        pass
                    break
            if not snapped:
                result_pts.append({"lat": lat, "lon": lon, "is_water": False})
    return {"points": result_pts}


@app.post("/api/geo/validate-route")
async def geo_validate_route(request: Request):
    """
    Check each point in a route for land/water, snapping land points to the
    nearest coast.  Body: {"points": [[lat, lon], ...]}
    """
    try:
        body   = await request.json()
        points = body.get("points", [])
        if not points:
            return JSONResponse({"points": []})
        import functools
        loop   = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, functools.partial(_validate_route_sync, points))
        return JSONResponse(result)
    except Exception as e:
        print(f"[validate-route] endpoint error: {e}")
        return JSONResponse({"error": str(e), "points": []})


_EEZ_CACHE: dict | None = None


def _ensure_eez_cache():
    global _EEZ_CACHE
    if _EEZ_CACHE is None and _GEO_EEZ_FILE.exists():
        _EEZ_CACHE = _json.loads(_GEO_EEZ_FILE.read_text(encoding="utf-8"))
        print(f"[eez] loaded {len(_EEZ_CACHE.get('features', []))} zones into cache")


@app.get("/geo/eez")
async def geo_eez_endpoint():
    _ensure_eez_cache()
    return _cached_json_response(
        "geo_eez",
        lambda: _EEZ_CACHE if _EEZ_CACHE else {"type": "FeatureCollection", "features": []},
        max_age=3600,
    )


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


# Daily briefing loop removed — briefings are now Director Mode on-demand only.
# Manual generation still available via POST /api/briefing/generate
# async def _daily_briefing_loop(): ...


@app.get("/api/briefing/latest")
def get_latest_briefing():
    """Return the most recent briefing with rate-limit metadata."""
    with _BRIEFING_LOCK:
        store = list(_BRIEFING_STORE)
    if not store:
        return {"briefing": None, "can_regenerate": True, "next_regen_secs": 0}
    latest = store[-1]
    now = datetime.now(timezone.utc)
    gen_at_str = latest.get("generated_at", "")
    try:
        gen_at = datetime.fromisoformat(gen_at_str)
        if gen_at.tzinfo is None:
            gen_at = gen_at.replace(tzinfo=timezone.utc)
        elapsed = (now - gen_at).total_seconds()
        remaining = max(0, _BRIEFING_RATE_LIMIT_S - elapsed)
        can_regen = remaining == 0
    except Exception:
        remaining = 0
        can_regen = True
    return {
        "briefing": latest,
        "can_regenerate": can_regen,
        "next_regen_secs": int(remaining),
    }


@app.post("/api/briefing/generate")
async def generate_briefing_manual(current_user=Depends(get_optional_user)):
    """Manually trigger a briefing regeneration (rate-limited to once per 2 hours)."""
    with _BRIEFING_LOCK:
        store = list(_BRIEFING_STORE)
    if store:
        latest = store[-1]
        gen_at_str = latest.get("generated_at", "")
        try:
            gen_at = datetime.fromisoformat(gen_at_str)
            if gen_at.tzinfo is None:
                gen_at = gen_at.replace(tzinfo=timezone.utc)
            elapsed = (datetime.now(timezone.utc) - gen_at).total_seconds()
            remaining = max(0, _BRIEFING_RATE_LIMIT_S - elapsed)
            if remaining > 0:
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limited. Try again in {int(remaining)} seconds.",
                )
        except HTTPException:
            raise
        except Exception:
            pass
    loop = asyncio.get_event_loop()
    briefing = await loop.run_in_executor(_executor, lambda: _generate_briefing_sync(manual=True))
    if briefing is None:
        raise HTTPException(status_code=500, detail="Briefing generation failed")
    return {"briefing": briefing, "can_regenerate": False, "next_regen_secs": _BRIEFING_RATE_LIMIT_S}


async def _startup_warmup_tasks():
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
_sanctions_alerted: dict = {}   # mmsi → epoch of last sanctions alert (in-memory cooldown)
_sts_candidates:    dict = {}   # (mmsi_a, mmsi_b) → proximity tracking state

# ── Forge detection engine instances ─────────────────────────────────────────
if _HAS_DETECTORS:
    _ais_detector        = _AISAnomalyDetector()
    _adsb_detector       = _ADSBPatternDetector()
    _threat_engine       = _ThreatEngine()
    _correlation_engine  = _CorrelationEngine()
    _escalation_engine   = _EscalationEngine()
    _dark_ship_detector  = _DarkShipDetector()
    _adsb_loiter_detector = _ADSBLoiterDetector()
    _chokepoint_detector  = _ChokepointActivityDetector()
else:
    _ais_detector = _adsb_detector = _threat_engine = _correlation_engine = None
    _escalation_engine = _dark_ship_detector = _adsb_loiter_detector = None
    _chokepoint_detector = None
    _news_pattern_engine = None


def _news_assessment_fire(rule: dict, matching_articles: list, location: str, trigger_article: dict) -> None:
    """Callback fired by NewsPatternEngine when a pattern threshold is exceeded."""
    import json as _jf
    import uuid as _uuid
    try:
        from intelligence_schema import IntelligenceAssessment
        from database import get_db as _get_db
    except ImportError:
        return
    if not _news_pattern_engine:
        return

    pattern_type = (rule.get("params") or {}).get("pattern_type") if isinstance(rule.get("params"), dict) else None
    if not pattern_type:
        try:
            _p = _jf.loads(rule.get("params") or "{}")
            pattern_type = _p.get("pattern_type")
        except Exception:
            return
    if not pattern_type:
        return

    pdef = _NEWS_PATTERNS.get(pattern_type, {})
    count     = len(matching_articles)
    tf_hours  = int((rule.get("params") or {}).get("timeframe_hours", pdef.get("default_timeframe", 24)) if isinstance(rule.get("params"), dict) else pdef.get("default_timeframe", 24))
    sources   = list({a.get("source", "") for a in matching_articles[:5] if a.get("source")})
    source_list = ", ".join(sources) or "various"

    headline  = pdef.get("headline_template", "Intelligence pattern — {location}").format(
        location=location, count=count, timeframe=tf_hours)
    summary   = pdef.get("summary_template", "{count} articles in {timeframe}h for {location}.").format(
        count=count, location=location, timeframe=tf_hours, source_list=source_list)

    avg_rel   = sum(a.get("relevance_score", 5) for a in matching_articles) / count
    key_signals = [
        f"{count} articles in {tf_hours}h",
        f"Location: {location.upper()}",
        f"Pattern: {pattern_type}",
        f"Avg relevance: {avg_rel:.1f}/10",
        f"Sources: {source_list}",
    ]

    threshold = int((rule.get("params") or {}).get("article_count_threshold", pdef.get("default_threshold", 3)) if isinstance(rule.get("params"), dict) else pdef.get("default_threshold", 3))
    confidence = min(0.95, 0.5 + (count / max(threshold, 1) - 1) * 0.2)

    evidence = [
        {
            "title":          a.get("title", ""),
            "source":         a.get("source", ""),
            "article_type":   a.get("article_type", ""),
            "relevance_score": a.get("relevance_score", 0),
            "url":            a.get("url", ""),
        }
        for a in matching_articles[:3]
    ]

    lat = trigger_article.get("lat")
    lon = trigger_article.get("lon")
    assess_id = f"ASSESS-{_uuid.uuid4().hex[:8].upper()}"

    try:
        with _get_db() as _db:
            _ass = IntelligenceAssessment(
                assessment_id         = assess_id,
                assessment_type       = pattern_type,
                domain                = "NEWS",
                severity              = pdef.get("severity", "medium"),
                location_name         = location.upper(),
                location_country      = location if len(location) == 2 else None,
                confidence            = round(confidence, 3),
                confidence_reasoning  = f"{count} articles exceed threshold of {threshold}",
                evidence_count        = count,
                evidence_items        = _jf.dumps(evidence),
                timeframe_hours       = tf_hours,
                headline              = headline[:200],
                summary               = summary,
                key_signals           = _jf.dumps(key_signals),
                recommended_actions   = _jf.dumps([]),
                source_rule_id        = rule.get("id"),
                source_rule_name      = rule.get("name") or rule.get("rule_name"),
                contributing_alert_ids = _jf.dumps([]),
                marker_type           = pdef.get("marker_type", "UNKNOWN_CONTACT"),
                marker_visible        = True,
                expires_at            = datetime.utcnow() + timedelta(hours=24),
                lat                   = lat,
                lon                   = lon,
            )
            _db.add(_ass)
            _db.commit()
    except Exception as _db_err:
        print(f"[news-pattern] DB write failed: {_db_err}")

    # Persist as Alert + OntologyLinks + mark region dirty
    try:
        _region_id = trigger_article.get("region_id") or None
        write_alert({
            "id":         assess_id,
            "source":     "news",
            "alert_type": f"news_{pattern_type.lower()}",
            "title":      headline,
            "severity":   pdef.get("severity", "medium"),
            "lat":        lat,
            "lon":        lon,
            "region":     _region_id,
        })
        entity_linker.link_alert(assess_id, "article", lat, lon, headline)
        from alert_writer import _mark_region_dirty as _mrd_naf
        _mrd_naf(_region_id)
    except Exception as _naf_e:
        print(f"[news-pattern] alert persist error: {_naf_e}")

    # Append to forge alerts so globe layer picks it up immediately
    _alert = {
        "id":             f"news_pattern_{int(time.time()*1000)}",
        "rule_id":        rule.get("id"),
        "rule_name":      f"NEWS_{pattern_type}",
        "source":         "NEWS",
        "severity":       pdef.get("severity", "medium"),
        "icon_type":      pdef.get("marker_type", "UNKNOWN_CONTACT"),
        "lat":            lat,
        "lng":            lon,
        "title":          headline,
        "message":        summary,
        "assessment_id":  assess_id,
        "location":       location.upper(),
        "pattern_type":   pattern_type,
        "evidence_count": count,
        "key_signals":    key_signals,
        "timestamp":      datetime.utcnow().isoformat(),
        "provenance": {
            "source_type":    "NEWS",
            "detection_rule": f"NEWS_{pattern_type}",
            "trigger_reason": pattern_type,
        },
    }
    _forge_alerts.append(_alert)
    print(f"[news-pattern] fired {pattern_type} for {location.upper()} ({count} articles, conf={confidence:.2f})")

    # Feed fusion engine via normalize_signal
    if _fusion_engine:
        try:
            _fusion_engine.on_signal(normalize_signal(
                "NEWS",
                {
                    "severity":      pdef.get("severity", "medium"),
                    "lat":           lat,
                    "lon":           lon,
                    "location_name": location.upper(),
                    "country":       location if len(location) == 2 else None,
                    "rule_id":       rule.get("id"),
                    "rule_name":     rule.get("name") or rule.get("rule_name"),
                    "title":         headline,
                    "assessment_id": assess_id,
                },
            ))
        except Exception as _fe_err:
            print(f"[fusion] news signal error: {_fe_err}")


# ── Graph SSE client registry ──────────────────────────────────────────────
_graph_sse_queues: list = []   # list of asyncio.Queue, one per connected SSE client


def _graph_sse_push(msg: dict):
    """Push a message to all connected graph SSE clients."""
    import json as _js
    data = _js.dumps(msg, default=str)
    for q in list(_graph_sse_queues):
        try:
            q.put_nowait(data)
        except Exception:
            pass


# ── Event bus handlers ─────────────────────────────────────────────────────

async def _on_alert_created(payload: dict):
    _graph_sse_push({"event": "node_added", "payload": {
        "id": payload.get("alert_id"), "type": "alert",
        "label": payload.get("title", "")[:60],
        "severity": payload.get("severity"), "domain": payload.get("source"),
        "lat": payload.get("lat"), "lon": payload.get("lon"),
        "is_live": True,
    }})


async def _on_article_created(payload: dict):
    article = payload.get("article", {})
    if not article.get("location_country"):
        return
    # Defer to surge / news-pattern engines — already wired directly, no double-feed


async def _on_fusion_created(payload: dict):
    _graph_sse_push({"event": "node_added", "payload": {
        "id": payload.get("fusion_id"), "type": "fusion_event",
        "label": payload.get("title", "")[:60],
        "severity": payload.get("severity"), "domain": "FUSION",
        "lat": payload.get("lat"), "lon": payload.get("lon"),
        "is_live": True,
    }})


async def _on_surge_created(payload: dict):
    _graph_sse_push({"event": "node_added", "payload": {
        "id": payload.get("surge_id"), "type": "surge",
        "label": payload.get("headline", "")[:60],
        "severity": payload.get("severity"), "domain": "NEWS",
        "lat": payload.get("lat"), "lon": payload.get("lon"),
        "is_live": True,
    }})


async def _on_threat_dirty(payload: dict):
    region = payload.get("region")
    if not region:
        return
    try:
        from database import get_db as _gdb_td
        with _gdb_td() as _td_db:
            score = threat_matrix.compute_threat_score(region, _td_db, list(_forge_alerts))
        _graph_sse_push({"event": "score_updated", "payload": {"region": region, **score}})
    except Exception as _td_e:
        print(f"[event-bus] threat_dirty handler error: {_td_e}")


def normalize_signal(domain: str, source_obj: dict, alert_id: str = None) -> dict:
    """Normalize any alert/event into a standard signal dict for fusion_engine.on_signal()."""
    import uuid as _uuidn
    return {
        "signal_id":     f"SIG-{_uuidn.uuid4().hex[:8].upper()}",
        "domain":        domain,
        "alert_id":      alert_id,
        "severity":      source_obj.get("severity", "medium"),
        "confidence":    source_obj.get("confidence", 0.8),
        "relevance_score": source_obj.get("relevance_score", 50),
        "lat":           source_obj.get("lat"),
        "lon":           source_obj.get("lng") or source_obj.get("lon"),
        "location_name": (source_obj.get("location_name") or
                          source_obj.get("location") or
                          source_obj.get("region_id")),
        "region_id":     source_obj.get("region_id"),
        "country":       source_obj.get("country"),
        "timestamp":     datetime.utcnow(),
        "rule_id":       source_obj.get("rule_id"),
        "rule_name":     source_obj.get("rule_name") or source_obj.get("rule_trigger", ""),
        "summary":       (source_obj.get("title") or source_obj.get("message", ""))[:200],
        "assessment_id": source_obj.get("assessment_id"),
    }


_forge_alerts: list = []          # in-memory rolling 24h alert buffer
_correlation_assessments: list = []  # cross-domain correlation results (24h)
_last_cycle_stats: dict = {}         # stats from the most-recent detection cycle
_cycle_history: list = []            # last 20 detection cycle summaries
_AIS_STATUS      = {"connected": False, "error": None, "vessel_count": 0, "last_msg": None, "last_poll": None}
_AIS_MSG_COUNTER = 0         # total messages received this connection
_AIS_LAST_LOG_T  = 0.0      # time of last periodic log

_AIS_BBOXES = [
    [[15, 45], [32, 65]],     # Persian Gulf / Arabian Sea
    [[10, 32], [30, 45]],     # Red Sea / Bab el-Mandeb
    [[30, 20], [42, 42]],     # Eastern Mediterranean
    [[-15, 38], [12, 65]],    # East Africa / Indian Ocean / Horn
    [[-2, 98], [10, 108]],    # Strait of Malacca
    [[20, -10], [60, 40]],    # North Atlantic / Europe
    [[-10, 100], [30, 145]],  # Pacific / SE Asia
    [[-55, -80], [15, -30]],  # South America / South Atlantic
    [[15, -100], [55, -60]],  # North America coastal
    [[-35, 10], [20, 55]],    # Sub-Saharan Africa
    [[5, 105], [25, 125]],    # South China Sea (explicit)
    [[40, 27], [47, 42]],     # Black Sea
    [[53, 10], [66, 30]],     # Baltic Sea
    [[35, -6], [45, 2]],      # Gibraltar Strait
    [[-25, 32], [-12, 48]],   # Mozambique Channel
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


# ── Sanctions check (fired on every new AIS position, O(1) in-memory) ────────

async def _check_sanctions_on_update(vessel: dict) -> None:
    """Check if a vessel is on a sanctions list; write critical alert if so."""
    global _sanctions_alerted
    mmsi = str(vessel.get("mmsi", ""))
    name = vessel.get("name", "")
    if not mmsi:
        return

    hit = sanctions_loader.check_vessel(mmsi=mmsi, name=name)
    if not hit:
        return

    # In-memory cooldown — skip if alerted within last 6 hours
    now_epoch = time.time()
    if now_epoch - _sanctions_alerted.get(mmsi, 0) < 21600:
        return

    # DB cooldown — avoid duplicate alerts even across restarts
    try:
        from database import get_db as _gdb, Alert as _Alert
        with _gdb() as _db:
            existing = _db.query(_Alert).filter(
                _Alert.entity_id == mmsi,
                _Alert.alert_type == "Sanctioned Vessel",
                _Alert.created_at >= datetime.utcnow() - timedelta(hours=6),
            ).first()
            if existing:
                _sanctions_alerted[mmsi] = now_epoch
                return
    except Exception:
        pass

    explanation = sanctions_loader.get_sanction_explanation(hit)
    vessel_name = hit.get("name") or name or mmsi

    alert_dict = {
        "domain":         "AIS",
        "source":         "AIS",
        "alert_type":     "Sanctioned Vessel",
        "rule_id":        "AIS-SANCTIONS",
        "rule_name":      "Sanctioned Vessel",
        "title":          f"⚠ SANCTIONED: {vessel_name} detected",
        "message":        (
            f"Sanctioned vessel {vessel_name} (MMSI {mmsi}) detected. "
            f"Listed by: {', '.join(explanation['sanction_lists'][:2])}."
        ),
        "severity":       "critical",
        "confidence":     0.95,
        "relevance_score": 100,
        "lat":            vessel.get("lat"),
        "lon":            vessel.get("lon"),
        "mmsi":           mmsi,
        "imo":            hit.get("imo"),
        "vessel_name":    vessel_name,
        "vessel":         vessel_name,
        "source_id":      mmsi,
        "entity_id":      mmsi,
        "entity_name":    vessel_name,
        "timestamp":      datetime.utcnow().isoformat(),
        "payload": {
            "mmsi":           mmsi,
            "imo":            hit.get("imo"),
            "vessel_name":    vessel_name,
            "sanction_lists": explanation["sanction_lists"],
            "flag":           hit.get("flag"),
            "owner":          hit.get("owner"),
            "speed":          vessel.get("speed"),
            "heading":        vessel.get("heading"),
            "rule_name":      "Sanctioned Vessel",
            "explanation":    explanation,
        },
    }

    write_alert(alert_dict)
    global _forge_alerts
    _forge_alerts.append(alert_dict)
    _sanctions_alerted[mmsi] = now_epoch
    print(f"[sanctions] CRITICAL: Sanctioned vessel {vessel_name} (MMSI {mmsi}) at "
          f"{vessel.get('lat')}, {vessel.get('lon')}")


# ── Ship-to-Ship transfer detection ──────────────────────────────────────────

STS_PROXIMITY_M      = 500     # max distance between vessels (metres)
STS_SPEED_KNOTS      = 2.0    # both vessels must be at or below this speed
STS_MIN_DURATION_MIN = 30     # minimum tracked proximity before alert fires
STS_OFFSHORE_MIN_KM  = 5.0    # must be this far from any port
STS_COOLDOWN_HOURS   = 12     # re-alert cooldown per unique pair


async def _run_sts_detection() -> None:
    """
    Spatial O(n²) scan across all slow-moving vessels.
    n ≤ 2000, so worst case ~2M comparisons. Runs every 5 minutes.
    """
    global _sts_candidates

    with _AIS_LOCK:
        vessels = [
            dict(v) for v in _AIS_VESSELS.values()
            if v.get("lat") and v.get("lon") and v.get("speed", 99) <= STS_SPEED_KNOTS
        ]

    now = datetime.utcnow()

    # Expire candidates not updated in 90 minutes (handles pairs that leave proximity
    # and never return — they are already dropped by new_candidates logic, but
    # this guards against edge-cases where _sts_candidates retains orphaned entries)
    _sts_candidates = {
        k: v for k, v in _sts_candidates.items()
        if (now - v.get("last_seen", now)).total_seconds() < 5400
    }

    n = len(vessels)
    new_candidates: dict = {}

    for i in range(n):
        for j in range(i + 1, n):
            a, b = vessels[i], vessels[j]

            # Skip pure fishing pairs — not indicative of STS evasion
            type_a = (a.get("ship_type") or "").upper()
            type_b = (b.get("ship_type") or "").upper()
            if "FISHING" in type_a and "FISHING" in type_b:
                continue

            dist = _haversine_m(a["lat"], a["lon"], b["lat"], b["lon"])
            if dist > STS_PROXIMITY_M:
                continue

            pair_key = tuple(sorted([str(a.get("mmsi", "")), str(b.get("mmsi", ""))]))

            if pair_key in _sts_candidates:
                existing = _sts_candidates[pair_key]
                existing["last_seen"] = now
                existing["min_dist"]  = min(existing.get("min_dist", dist), dist)
                pos_entry = {
                    "lat": (a["lat"] + b["lat"]) / 2,
                    "lon": (a["lon"] + b["lon"]) / 2,
                    "dist_m": dist,
                    "timestamp": now.isoformat(),
                }
                existing["positions"].append(pos_entry)
                # Cap positions list — only last/first 10 needed for alert payload
                if len(existing["positions"]) > 20:
                    existing["positions"] = existing["positions"][-20:]
                new_candidates[pair_key] = existing
            else:
                new_candidates[pair_key] = {
                    "mmsi_a":     str(a.get("mmsi", "")),
                    "mmsi_b":     str(b.get("mmsi", "")),
                    "vessel_a":   a,
                    "vessel_b":   b,
                    "first_seen": now,
                    "last_seen":  now,
                    "min_dist":   dist,
                    "positions":  [{
                        "lat": (a["lat"] + b["lat"]) / 2,
                        "lon": (a["lon"] + b["lon"]) / 2,
                        "dist_m": dist,
                        "timestamp": now.isoformat(),
                    }],
                    "alerted": False,
                }

    _sts_candidates = new_candidates

    # Evaluate candidates that have been tracked long enough
    for pair_key, candidate in list(_sts_candidates.items()):
        if candidate.get("alerted"):
            continue

        duration_min = (candidate["last_seen"] - candidate["first_seen"]).total_seconds() / 60
        if duration_min < STS_MIN_DURATION_MIN:
            continue

        midlat = candidate["positions"][-1]["lat"]
        midlon = candidate["positions"][-1]["lon"]

        dist_to_port = _distance_to_nearest_port_km(midlat, midlon)
        if dist_to_port < STS_OFFSHORE_MIN_KM:
            continue  # in port/anchorage — expected behaviour

        mmsi_a  = candidate["mmsi_a"]
        mmsi_b  = candidate["mmsi_b"]
        pair_id = f"{mmsi_a}_{mmsi_b}"

        # DB cooldown
        try:
            from database import get_db as _gdb, Alert as _AlertM
            with _gdb() as _db:
                existing_alert = _db.query(_AlertM).filter(
                    _AlertM.entity_id == pair_id,
                    _AlertM.alert_type == "Ship-to-Ship Transfer",
                    _AlertM.created_at >= now - timedelta(hours=STS_COOLDOWN_HOURS),
                ).first()
                if existing_alert:
                    candidate["alerted"] = True
                    continue
        except Exception:
            pass

        a_v = candidate["vessel_a"]
        b_v = candidate["vessel_b"]
        sanction_a = sanctions_loader.check_vessel(mmsi=mmsi_a, name=a_v.get("name", ""))
        sanction_b = sanctions_loader.check_vessel(mmsi=mmsi_b, name=b_v.get("name", ""))
        is_sanctions_related = bool(sanction_a or sanction_b)
        severity = "critical" if is_sanctions_related else "high"

        name_a = a_v.get("name") or mmsi_a
        name_b = b_v.get("name") or mmsi_b

        sanction_context = ""
        if sanction_a:
            exp = sanctions_loader.get_sanction_explanation(sanction_a)
            sanction_context += f"\n⚠ {name_a} is SANCTIONED by {', '.join(exp['sanction_lists'][:2])}."
        if sanction_b:
            exp = sanctions_loader.get_sanction_explanation(sanction_b)
            sanction_context += f"\n⚠ {name_b} is SANCTIONED by {', '.join(exp['sanction_lists'][:2])}."

        alert_dict = {
            "domain":         "AIS",
            "source":         "AIS",
            "alert_type":     "Ship-to-Ship Transfer",
            "rule_id":        "AIS-STS",
            "rule_name":      "Ship-to-Ship Transfer",
            "title":          f"STS: {name_a} ↔ {name_b} ({int(duration_min)}min, {int(candidate['min_dist'])}m)",
            "message":        (
                f"Possible ship-to-ship transfer detected. "
                f"{name_a} (MMSI {mmsi_a}) and {name_b} (MMSI {mmsi_b}) have been within "
                f"{int(candidate['min_dist'])}m of each other for {int(duration_min)} minutes, "
                f"{dist_to_port:.1f}km from nearest port.{sanction_context}"
            ),
            "severity":       severity,
            "confidence":     min(0.9, 0.5 + duration_min / 200),
            "relevance_score": 100 if is_sanctions_related else 70,
            "lat":            midlat,
            "lon":            midlon,
            "mmsi":           mmsi_a,
            "source_id":      pair_id,
            "entity_id":      pair_id,
            "entity_name":    f"{name_a} / {name_b}",
            "timestamp":      now.isoformat(),
            "payload": {
                "rule_name":           "Ship-to-Ship Transfer",
                "mmsi_a":              mmsi_a,
                "mmsi_b":              mmsi_b,
                "vessel_a_name":       name_a,
                "vessel_b_name":       name_b,
                "vessel_a_flag":       a_v.get("flag"),
                "vessel_b_flag":       b_v.get("flag"),
                "vessel_a_type":       a_v.get("ship_type"),
                "vessel_b_type":       b_v.get("ship_type"),
                "duration_min":        int(duration_min),
                "min_distance_m":      int(candidate["min_dist"]),
                "distance_to_port_km": round(dist_to_port, 1),
                "is_sanctions_related": is_sanctions_related,
                "sanctioned_vessel":   sanction_a or sanction_b,
                "track_positions":     candidate["positions"][-10:],
                "explanation": {
                    "what": (
                        "Two vessels have been in extremely close proximity "
                        "offshore for an extended period."
                    ),
                    "why": (
                        "Offshore STS transfers are a primary mechanism for "
                        "sanctions evasion — Iranian crude oil, Russian petroleum, "
                        "North Korean arms. The receiving vessel typically has no "
                        "connection to the sanctioned cargo origin."
                    ),
                    "watch": (
                        "Track both vessels after separation. Note destination ports. "
                        "Check cargo declarations. Cross-reference flag states and "
                        "ownership chains against sanctions lists."
                    ),
                },
            },
        }

        write_alert(alert_dict)
        global _forge_alerts
        _forge_alerts.append(alert_dict)
        candidate["alerted"] = True
        print(f"[ais] STS ALERT: {name_a} ↔ {name_b} "
              f"({int(duration_min)}min, {'SANCTIONED' if is_sanctions_related else 'clean'})")


async def _sts_detection_loop() -> None:
    """Run STS proximity scan every 5 minutes."""
    await asyncio.sleep(130)  # staggered startup
    while True:
        try:
            await _run_sts_detection()
        except Exception as _sts_err:
            print(f"[sts] scan error: {_sts_err}")
        await asyncio.sleep(300)


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
            import ssl as _ssl_mod
            _ais_ssl_ctx = _ssl_mod.create_default_context()
            _ais_ssl_ctx.check_hostname = False
            _ais_ssl_ctx.verify_mode = _ssl_mod.CERT_NONE
            async with _ws.connect(AIS_URL, ssl=_ais_ssl_ctx, ping_interval=20, ping_timeout=15, open_timeout=15) as ws:
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
                            # Record to history (throttled)
                            try:
                                _record_ais_history(mmsi, vessel)
                            except Exception:
                                pass
                            # Cap at 2000, evict oldest
                            if len(_AIS_VESSELS) > 2000:
                                oldest = min(_AIS_VESSELS, key=lambda k: _AIS_VESSELS[k].get("last_update", 0))
                                del _AIS_VESSELS[oldest]
                        # Sanctions check — fast O(1) in-memory pre-filter, async task only on hit
                        if (mtype == "PositionReport"
                                and sanctions_loader._sanctions_by_mmsi
                                and (mmsi in sanctions_loader._sanctions_by_mmsi
                                     or (vessel.get("name", "").upper().strip()
                                         in sanctions_loader._sanctions_by_name))):
                            asyncio.create_task(_check_sanctions_on_update(dict(vessel)))
                        _AIS_STATUS["vessel_count"] = len(_AIS_VESSELS)
                        _AIS_STATUS["last_msg"]     = time.strftime("%H:%M:%S", time.gmtime())
                        _AIS_STATUS["last_poll"]    = datetime.now(timezone.utc).isoformat()
                    except Exception:
                        continue
        except Exception as ex:
            _AIS_STATUS["connected"] = False
            _AIS_STATUS["error"]     = str(ex)
            print(f"[ais] disconnected: {ex!r} — reconnecting in {reconnect_delay}s")
            # Preserve vessel_count from last known state — don't reset to 0 on disconnect
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 300)  # exponential backoff, cap 5 min

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


# ══════════════════════════════════════════════════════════════════════════════
# SYSTEM 2 — ADS-B and AIS History Recording
# ══════════════════════════════════════════════════════════════════════════════

def _record_adsb_history(aircraft_list):
    """Record ADS-B positions to history (throttled per aircraft per 60s) AND
    aggregate to track_density grid cells (always)."""
    try:
        from database import AircraftHistory, get_db
        from track_aggregator import aggregate_tracks
    except ImportError:
        return

    # Always aggregate the full batch — cheap upsert, gives heatmap coverage
    try:
        aggregate_tracks(aircraft_list, domain="adsb")
    except Exception as e:
        print(f"[adsb-aggregate] error: {e}")

    now = time.time()
    now_dt = datetime.utcnow()
    records = []
    for ac in aircraft_list:
        icao24 = (ac.get('icao') or ac.get('hex') or '').lower()
        if not icao24:
            continue
        last = _ADSB_LAST_RECORDED.get(icao24)
        if last and (now - last) < 60:
            continue
        _ADSB_LAST_RECORDED[icao24] = now
        if ac.get('lat') is None or ac.get('lon') is None:
            continue
        records.append(AircraftHistory(
            icao24=icao24,
            callsign=(ac.get('flight') or '').strip(),
            lat=ac.get('lat'),
            lon=ac.get('lon'),
            altitude=ac.get('alt_baro'),
            speed=ac.get('gs'),
            heading=ac.get('track'),
            aircraft_type=ac.get('type') or ac.get('t') or '',
            is_military=bool(ac.get('military', False)),
            timestamp=now_dt,
        ))
    if records:
        try:
            with get_db() as db:
                db.add_all(records)
                db.commit()
        except Exception as e:
            print(f"[adsb-history] record error: {e}")


# AIS aggregation buffer — flushed by _ais_aggregate_loop every 60s
_AIS_AGG_BUFFER: dict[str, dict] = {}
_AIS_AGG_LOCK   = threading.Lock()


def _record_ais_history(mmsi, vessel_data):
    """Record AIS vessel position to history (throttled 5 min per vessel) AND
    accumulate into the aggregation buffer (one entry per mmsi, latest wins)."""
    try:
        from database import VesselHistory, get_db
    except ImportError:
        return

    if vessel_data.get('lat') is None or vessel_data.get('lon') is None:
        return

    # Always update the aggregation buffer with the latest position for this mmsi
    try:
        with _AIS_AGG_LOCK:
            _AIS_AGG_BUFFER[mmsi] = {
                "lat":       vessel_data.get('lat'),
                "lon":       vessel_data.get('lon'),
                "speed":     vessel_data.get('speed'),
                "ship_type": vessel_data.get('ship_type', ''),
            }
    except Exception:
        pass

    now = time.time()
    last = _AIS_LAST_RECORDED.get(mmsi)
    if last and (now - last) < 300:
        return
    _AIS_LAST_RECORDED[mmsi] = now
    try:
        record = VesselHistory(
            mmsi=mmsi,
            name=vessel_data.get('name', ''),
            ship_type=vessel_data.get('ship_type_code', 0),
            ship_type_text=vessel_data.get('ship_type', ''),
            lat=vessel_data.get('lat'),
            lon=vessel_data.get('lon'),
            speed=vessel_data.get('speed'),
            heading=vessel_data.get('heading'),
            flag=vessel_data.get('flag', '') or vessel_data.get('country', ''),
            destination=vessel_data.get('destination', ''),
            timestamp=datetime.utcnow(),
        )
        with get_db() as db:
            db.add(record)
            db.commit()
    except Exception as e:
        print(f"[ais-history] record error: {e}")


async def _ais_aggregate_loop():
    """Flush the AIS aggregation buffer to track_density every 60s."""
    while True:
        await asyncio.sleep(60)
        try:
            from track_aggregator import aggregate_tracks
            with _AIS_AGG_LOCK:
                if not _AIS_AGG_BUFFER:
                    continue
                batch = list(_AIS_AGG_BUFFER.values())
                _AIS_AGG_BUFFER.clear()
            aggregate_tracks(batch, domain="ais")
        except Exception as e:
            print(f"[ais-aggregate] loop error: {e}")


async def _prune_history_loop():
    """Delete raw history older than 24 hours and aggregated density older
    than 90 days. Runs once per day."""
    while True:
        await asyncio.sleep(86400)
        try:
            from database import AircraftHistory, VesselHistory, TrackDensity, get_db
            now = datetime.utcnow()
            raw_cutoff     = now - timedelta(hours=24)
            density_cutoff = now - timedelta(days=90)
            with get_db() as db:
                deleted_ac = db.query(AircraftHistory).filter(AircraftHistory.timestamp < raw_cutoff).delete()
                deleted_vs = db.query(VesselHistory).filter(VesselHistory.timestamp < raw_cutoff).delete()
                deleted_td = db.query(TrackDensity).filter(TrackDensity.hour < density_cutoff).delete()
                db.commit()
            print(f"[history-prune] raw: -{deleted_ac} ac, -{deleted_vs} vs (>24h); density: -{deleted_td} (>90d)")
        except Exception as e:
            print(f"[history-prune] error: {e}")


@app.get("/api/history/aircraft")
async def get_aircraft_history(
    icao24: str = Query(None),
    lat: float = Query(None),
    lon: float = Query(None),
    radius_km: float = Query(50),
    hours: int = Query(24),
    user=Depends(get_optional_user),
):
    try:
        from database import AircraftHistory, get_db
    except ImportError:
        return {"count": 0, "positions": []}
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    with get_db() as db:
        q = db.query(AircraftHistory).filter(AircraftHistory.timestamp >= cutoff)
        if icao24:
            q = q.filter(AircraftHistory.icao24 == icao24.lower())
        if lat is not None and lon is not None:
            lat_r = radius_km / 111.0
            lon_r = radius_km / (111.0 * max(0.1, abs(math.cos(math.radians(lat)))))
            q = q.filter(
                AircraftHistory.lat.between(lat - lat_r, lat + lat_r),
                AircraftHistory.lon.between(lon - lon_r, lon + lon_r),
            )
        results = q.order_by(AircraftHistory.timestamp.desc()).limit(5000).all()
    return {
        "count": len(results),
        "positions": [
            {"icao24": r.icao24, "callsign": r.callsign, "lat": r.lat, "lon": r.lon,
             "altitude": r.altitude, "speed": r.speed, "heading": r.heading,
             "type": r.aircraft_type, "military": r.is_military,
             "timestamp": r.timestamp.isoformat()}
            for r in results
        ],
    }


@app.get("/api/vessels/{mmsi}/identity")
def get_vessel_identity(mmsi: str):
    """MMSI → flag/country identity (lightweight, no DB query)."""
    from mmsi_lookup import lookup_mmsi
    return {"mmsi": mmsi, "identity": lookup_mmsi(mmsi)}


@app.get("/api/aircraft/{icao_hex}/identity")
def get_aircraft_identity(icao_hex: str):
    """ICAO hex → military/service identity (lightweight, no DB query)."""
    from icao_lookup import lookup_icao_hex
    return {"icao_hex": icao_hex, "identity": lookup_icao_hex(icao_hex)}


# Rolling 20-position track buffer per military ICAO hex (populated by ADSB processing)
_military_tracks: dict = {}   # icao_hex.upper() → [{lat,lon,alt,speed,heading,ts}, ...]


@app.get("/api/adsb/military-track/{icao_hex}")
async def get_military_track(icao_hex: str):
    """Return rolling track for a military aircraft — in-memory first, DB fallback."""
    hex_upper = icao_hex.upper()
    track = list(_military_tracks.get(hex_upper, []))
    if not track:
        # Fallback: reconstruct from alert history for this ICAO
        try:
            from database import Alert
            with get_db() as _db:
                rows = (_db.query(Alert)
                           .filter(Alert.entity_id == icao_hex)
                           .order_by(Alert.created_at.desc())
                           .limit(20).all())
            track = [
                {"lat": r.lat, "lon": r.lon,
                 "ts": r.created_at.isoformat() if r.created_at else None}
                for r in rows if r.lat and r.lon
            ]
        except Exception as _te:
            print(f"[military-track] fallback error: {_te}")
    return {"icao_hex": hex_upper, "track_points": track}


@app.get("/api/history/vessels")
async def get_vessel_history(
    mmsi: str = Query(None),
    lat: float = Query(None),
    lon: float = Query(None),
    radius_km: float = Query(50),
    hours: int = Query(24),
    user=Depends(get_optional_user),
):
    try:
        from database import VesselHistory, get_db
    except ImportError:
        return {"count": 0, "positions": []}
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    with get_db() as db:
        q = db.query(VesselHistory).filter(VesselHistory.timestamp >= cutoff)
        if mmsi:
            q = q.filter(VesselHistory.mmsi == mmsi)
        if lat is not None and lon is not None:
            lat_r = radius_km / 111.0
            lon_r = radius_km / (111.0 * max(0.1, abs(math.cos(math.radians(lat)))))
            q = q.filter(
                VesselHistory.lat.between(lat - lat_r, lat + lat_r),
                VesselHistory.lon.between(lon - lon_r, lon + lon_r),
            )
        results = q.order_by(VesselHistory.timestamp.desc()).limit(5000).all()
    return {
        "count": len(results),
        "positions": [
            {"mmsi": r.mmsi, "name": r.name, "ship_type": r.ship_type,
             "ship_type_text": r.ship_type_text, "lat": r.lat, "lon": r.lon,
             "speed": r.speed, "heading": r.heading, "flag": r.flag,
             "destination": r.destination, "timestamp": r.timestamp.isoformat()}
            for r in results
        ],
    }


@app.get("/api/history/snapshot")
async def get_historical_snapshot(
    timestamp: str = Query(..., description="ISO format timestamp"),
    user=Depends(get_optional_user),
):
    """Return aircraft and vessel positions nearest to the requested timestamp."""
    try:
        from database import AircraftHistory, VesselHistory, get_db
        target = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).replace(tzinfo=None)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid timestamp: {e}")
    window = timedelta(minutes=5)
    with get_db() as db:
        aircraft = db.query(AircraftHistory).filter(
            AircraftHistory.timestamp.between(target - window, target + window)
        ).all()
        aircraft_map = {}
        for ac in aircraft:
            if ac.icao24 not in aircraft_map or ac.timestamp > aircraft_map[ac.icao24].timestamp:
                aircraft_map[ac.icao24] = ac
        vessels = db.query(VesselHistory).filter(
            VesselHistory.timestamp.between(target - window, target + window)
        ).all()
        vessel_map = {}
        for v in vessels:
            if v.mmsi not in vessel_map or v.timestamp > vessel_map[v.mmsi].timestamp:
                vessel_map[v.mmsi] = v
    return {
        "timestamp": target.isoformat(),
        "aircraft": [
            {"icao24": ac.icao24, "callsign": ac.callsign, "lat": ac.lat, "lon": ac.lon,
             "altitude": ac.altitude, "speed": ac.speed, "heading": ac.heading,
             "military": ac.is_military}
            for ac in aircraft_map.values()
        ],
        "vessels": [
            {"mmsi": v.mmsi, "name": v.name, "lat": v.lat, "lon": v.lon,
             "speed": v.speed, "heading": v.heading, "ship_type_text": v.ship_type_text}
            for v in vessel_map.values()
        ],
        "aircraft_count": len(aircraft_map),
        "vessel_count": len(vessel_map),
    }


# ══════════════════════════════════════════════════════════════════════════════
# SYSTEM 4 — Passive Anomaly Detection
# ══════════════════════════════════════════════════════════════════════════════

_ANOMALY_CHOKEPOINTS = {
    "Strait of Hormuz":   {"center_lat": 26.5,  "center_lon": 56.4},
    "Bab el-Mandeb":      {"center_lat": 12.6,  "center_lon": 43.4},
    "Suez Canal":         {"center_lat": 30.5,  "center_lon": 32.4},
    "Strait of Malacca":  {"center_lat": 3.0,   "center_lon": 103.5},
    "Taiwan Strait":      {"center_lat": 23.5,  "center_lon": 120.2},
    "Strait of Gibraltar":{"center_lat": 35.9,  "center_lon": -5.6},
}

_MIL_CALLSIGN_PREFIXES = [
    'RCH', 'DUKE', 'EVAC', 'RRR', 'TOPCAT', 'RAGE', 'DARK', 'VIPER',
    'HAVOC', 'CNV', 'NAVY', 'VENUS', 'REACH', 'PAT', 'GOLD', 'SKULL',
]


def _haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    """Distance in metres between two lat/lon points."""
    return _haversine(lat1, lon1, lat2, lon2) * 1000.0


def _distance_to_nearest_port_km(lat, lon) -> float:
    """Returns km distance to nearest PortBoundary (pre-filtered within 0.5°)."""
    try:
        from database import PortBoundary as _PB, get_db as _gdb
        deg_r = 0.5
        with _gdb() as _db:
            ports = _db.query(_PB).filter(
                _PB.latitude.between(lat - deg_r, lat + deg_r),
                _PB.longitude.between(lon - deg_r, lon + deg_r),
            ).all()
        if not ports:
            return 999.0
        dists = [
            _haversine(lat, lon, p.latitude, p.longitude)
            for p in ports if p.latitude and p.longitude
        ]
        return min(dists) if dists else 999.0
    except Exception:
        return 999.0


def _is_military_callsign(callsign):
    cs = (callsign or '').strip().upper()
    return any(cs.startswith(p) for p in _MIL_CALLSIGN_PREFIXES)


def _cluster_by_location(markers, radius_km=100):
    clusters = []
    used = set()
    for i, m in enumerate(markers):
        if i in used:
            continue
        cluster = [m]
        used.add(i)
        for j, m2 in enumerate(markers):
            if j in used:
                continue
            if _haversine(m.get('lat', 0), m.get('lon', 0), m2.get('lat', 0), m2.get('lon', 0)) < radius_km:
                cluster.append(m2)
                used.add(j)
        clusters.append(cluster)
    return clusters


def _cluster_center(cluster):
    lats = [m.get('lat', 0) for m in cluster if m.get('lat')]
    lons = [m.get('lon', 0) for m in cluster if m.get('lon')]
    if not lats:
        return (0, 0)
    return (sum(lats) / len(lats), sum(lons) / len(lons))


async def _global_adsb_cache_loop():
    """Poll ADS-B globally every 60s to populate _GLOBAL_ADSB_CACHE for anomaly detection."""
    global _GLOBAL_ADSB_CACHE
    await asyncio.sleep(30)
    while True:
        try:
            loop = asyncio.get_event_loop()
            for region in GLOBAL_ADSB_REGIONS:
                url = f"https://api.adsb.lol/v2/lat/{region['lat']}/lon/{region['lon']}/dist/{region['dist']}"
                def _fetch(u=url):
                    try:
                        import urllib.request as _ur
                        req = _ur.Request(u, headers={"User-Agent": "Akili/1.0"})
                        with _ur.urlopen(req, timeout=15) as r:
                            return _json.loads(r.read()).get("ac", [])
                    except Exception:
                        return []
                aircraft_raw = await loop.run_in_executor(_executor, _fetch)
                now_ts = time.time()
                for ac in aircraft_raw:
                    hex_id = (ac.get("hex") or "").upper()
                    if not hex_id:
                        continue
                    db_flags = int(ac.get("dbFlags") or 0)
                    _GLOBAL_ADSB_CACHE[hex_id] = {
                        "hex":        hex_id,
                        "icao":       hex_id,
                        "flight":     (ac.get("flight") or "").strip(),
                        "lat":        ac.get("lat"),
                        "lon":        ac.get("lon"),
                        "alt_baro":   ac.get("alt_baro"),
                        "gs":         ac.get("gs"),
                        "track":      ac.get("track"),
                        "category":   ac.get("category") or "",
                        "military":   bool(db_flags & 1),
                        "interesting":bool(db_flags & 2),
                        "type":       ac.get("t") or "",
                        "last_seen":  now_ts,
                    }
                # Record to history
                mapped = [{"icao": (ac.get("hex") or "").upper(), "flight": (ac.get("flight") or "").strip(),
                            "lat": ac.get("lat"), "lon": ac.get("lon"), "alt_baro": ac.get("alt_baro"),
                            "gs": ac.get("gs"), "track": ac.get("track"), "category": ac.get("category") or "",
                            "military": bool(int(ac.get("dbFlags") or 0) & 1), "type": ac.get("t") or ""}
                           for ac in aircraft_raw if ac.get("lat") is not None]
                try:
                    _record_adsb_history(mapped)
                except Exception:
                    pass
                await asyncio.sleep(2)
            # Prune entries older than 10 minutes
            cutoff = time.time() - 600
            stale = [k for k, v in list(_GLOBAL_ADSB_CACHE.items()) if v.get("last_seen", 0) < cutoff]
            for k in stale:
                _GLOBAL_ADSB_CACHE.pop(k, None)
            print(f"[ADSB-GLOBAL] {len(_GLOBAL_ADSB_CACHE)} aircraft tracked globally")
        except Exception as e:
            print(f"[ADSB-GLOBAL] loop error: {e}")
        await asyncio.sleep(120)


def _cross_domain_correlation(now_iso: str) -> list:
    """Check for military vessels/aircraft near recent high-severity news events."""
    results = []
    cutoff_iso = (datetime.utcnow() - timedelta(hours=2)).isoformat()
    recent_news = [
        m for m in _NEWS_CONFLICT_MARKERS
        if isinstance(m, dict)
        and m.get('timestamp', '') > cutoff_iso
        and m.get('severity') in ('critical', 'significant')
        and m.get('lat') and m.get('lon')
    ]
    for news in recent_news[:10]:
        nlat = news.get('lat', 0)
        nlon = news.get('lon', 0)
        nearby_vessels = []
        with _AIS_LOCK:
            for mmsi, vessel in _AIS_VESSELS.items():
                if vessel.get('ship_type', 0) in range(35, 40):
                    d = _haversine(nlat, nlon, vessel.get('lat', 0) or 0, vessel.get('lon', 0) or 0)
                    if d < 100:
                        nearby_vessels.append({"mmsi": mmsi, "name": vessel.get('name', 'Unknown'), "distance_km": round(d, 1)})
        nearby_ac = []
        for ac in list(_GLOBAL_ADSB_CACHE.values()):
            if ac.get('military') or _is_military_callsign(ac.get('flight', '')):
                d = _haversine(nlat, nlon, ac.get('lat', 0) or 0, ac.get('lon', 0) or 0)
                if d < 200:
                    nearby_ac.append({"callsign": (ac.get('flight') or '').strip() or ac.get('hex', ''), "icao24": ac.get('hex', ''), "distance_km": round(d, 1)})
        if nearby_vessels or nearby_ac:
            results.append({
                "id": str(uuid.uuid4()),
                "type": "cross_domain_correlation",
                "severity": "significant",
                "title": f"Military activity near: {(news.get('title') or '')[:60]}",
                "subtitle": f"{len(nearby_vessels)} military vessel(s), {len(nearby_ac)} military aircraft nearby",
                "description": (
                    f"A {news.get('severity', '')} security event was reported near ({nlat:.2f}, {nlon:.2f}). "
                    f"{len(nearby_vessels)} military vessel(s) and {len(nearby_ac)} military aircraft are within proximity."
                ),
                "reason": f"News severity '{news.get('severity','')}' + {len(nearby_vessels)} military vessels <100km + {len(nearby_ac)} military aircraft <200km",
                "lat": nlat, "lon": nlon,
                "timestamp": now_iso,
                "entity": news.get('url', '') or f"news_{int(nlat*10)}_{int(nlon*10)}",
                "entity_name": (news.get('title') or '')[:80],
                "entity_type": "correlation",
                "correlated_data": {
                    "news": {"title": news.get('title'), "source": news.get('source'), "severity": news.get('severity')},
                    "vessels": nearby_vessels[:5],
                    "aircraft": nearby_ac[:5],
                },
                "classification": None,
                "pinned": False,
                "dismissed": False,
            })
    return results


async def _anomaly_detection_loop():
    """Run rule-based anomaly checks every 5 minutes."""
    global _ANOMALY_ALERTS
    await asyncio.sleep(60)   # let startup settle
    while True:
        await asyncio.sleep(300)
        try:
            new_alerts = []
            now_iso = datetime.utcnow().isoformat()

            # Check 1: vessel stopped in chokepoint
            with _AIS_LOCK:
                vessels_snapshot = list(_AIS_VESSELS.items())
            for mmsi, vessel in vessels_snapshot:
                speed = vessel.get('speed', 0) or 0
                lat = vessel.get('lat', 0) or 0
                lon = vessel.get('lon', 0) or 0
                if speed < 0.5 and lat and lon:
                    for cp_name, cp_data in _ANOMALY_CHOKEPOINTS.items():
                        dist = _haversine(lat, lon, cp_data['center_lat'], cp_data['center_lon'])
                        if dist < 50:
                            vessel_name = vessel.get('name', 'Unknown')
                            vessel_flag = vessel.get('flag', '') or ''
                            vessel_type = vessel.get('ship_type_text', '') or 'vessel'
                            new_alerts.append({
                                "id": str(uuid.uuid4()),
                                "type": "vessel_stopped_chokepoint",
                                "severity": "elevated",
                                "title": f"Vessel stationary in {cp_name}",
                                "subtitle": f"{vessel_name} ({(vessel_flag + '-flagged ') if vessel_flag else ''}{vessel_type})",
                                "description": f"MMSI {mmsi} — {vessel_name} has been stationary ({speed:.1f} kts) within the {cp_name} shipping lane. Normal transit speed is 12–15 knots.",
                                "reason": f"Speed ({speed:.1f} kts) below 0.5 kt threshold while within {round(dist):.0f}km of {cp_name}",
                                "lat": lat, "lon": lon,
                                "timestamp": now_iso,
                                "entity": mmsi,
                                "entity_name": vessel_name,
                                "entity_type": "vessel",
                                "classification": None,
                                "pinned": False,
                                "dismissed": False,
                            })

            # Check 2: military aircraft far from known chokepoints (uses global cache for wider coverage)
            all_ac = list(_GLOBAL_ADSB_CACHE.values())
            if not all_ac:
                for entry in _adsb_cache.values():
                    all_ac.extend(entry.get('data', []))
            for ac in all_ac:
                callsign = ac.get('flight', '')
                if ac.get('military') or _is_military_callsign(callsign):
                    lat = ac.get('lat', 0) or 0
                    lon = ac.get('lon', 0) or 0
                    if not lat:
                        continue
                    min_dist = min(
                        _haversine(lat, lon, cp['center_lat'], cp['center_lon'])
                        for cp in _ANOMALY_CHOKEPOINTS.values()
                    )
                    if min_dist > 1500:
                        icao = ac.get('icao', ac.get('hex', ''))
                        cs_display = callsign.strip() or icao
                        new_alerts.append({
                            "id": str(uuid.uuid4()),
                            "type": "military_aircraft_unusual",
                            "severity": "elevated",
                            "title": "Military aircraft in unusual position",
                            "subtitle": f"{cs_display} — {int(min_dist)}km from nearest chokepoint",
                            "description": f"Military aircraft {cs_display} is operating {int(min_dist)}km from the nearest monitored chokepoint. This may indicate a long-range patrol, strategic movement, or unscheduled operation.",
                            "reason": f"Military callsign/flag detected {int(min_dist)}km from nearest chokepoint (threshold: 1500km)",
                            "lat": lat, "lon": lon,
                            "timestamp": now_iso,
                            "entity": icao,
                            "entity_name": cs_display,
                            "entity_type": "aircraft",
                            "classification": None,
                            "pinned": False,
                            "dismissed": False,
                        })

            # Check 3: news spike (4+ markers in same 100km area within 2 hours)
            cutoff_dt = datetime.utcnow() - timedelta(hours=2)
            cutoff_iso = cutoff_dt.isoformat()
            recent_markers = [
                m for m in _NEWS_CONFLICT_MARKERS
                if isinstance(m, dict) and m.get('timestamp', '') > cutoff_iso and m.get('lat') and m.get('lon')
            ]
            if recent_markers:
                clusters = _cluster_by_location(recent_markers, radius_km=100)
                for cluster in clusters:
                    if len(cluster) >= 4:
                        center = _cluster_center(cluster)
                        area_name = cluster[0].get('location', '') or f"({center[0]:.1f}, {center[1]:.1f})"
                        headlines = "; ".join(c.get('title', '')[:60] for c in cluster[:3])
                        new_alerts.append({
                            "id": str(uuid.uuid4()),
                            "type": "news_spike",
                            "severity": "significant",
                            "title": f"News spike: {len(cluster)} articles near {area_name}",
                            "subtitle": f"{len(cluster)} reports within 100km in the past 2 hours",
                            "description": f"Multiple news sources are reporting from near {area_name}. Sample headlines: {headlines}",
                            "reason": f"{len(cluster)} news markers clustered within 100km radius in 2 hours (threshold: 4)",
                            "lat": center[0], "lon": center[1],
                            "timestamp": now_iso,
                            "entity": f"cluster_{int(center[0]*10)}_{int(center[1]*10)}",
                            "entity_name": area_name,
                            "entity_type": "news_cluster",
                            "classification": None,
                            "pinned": False,
                            "dismissed": False,
                        })

            # Check 4: cross-domain correlation
            new_alerts.extend(_cross_domain_correlation(now_iso))

            # Deduplicate and append (skip dismissed alerts from matching)
            existing_keys = {(a.get('entity'), a.get('type')) for a in _ANOMALY_ALERTS if not a.get('dismissed')}
            for alert in new_alerts:
                key = (alert.get('entity'), alert.get('type'))
                if key not in existing_keys:
                    if not alert.get('id'):
                        alert['id'] = str(uuid.uuid4())
                    _ANOMALY_ALERTS.append(alert)
                    existing_keys.add(key)
                    print(f"[anomaly] new alert: {alert['title']}")

            # Keep last 100
            if len(_ANOMALY_ALERTS) > 100:
                _ANOMALY_ALERTS[:] = _ANOMALY_ALERTS[-100:]

        except Exception as e:
            print(f"[anomaly] detection loop error: {e}")


def _calculate_overall_threat_level(alerts):
    if any(a.get('severity') == 'critical' for a in alerts):
        return 'critical'
    if sum(1 for a in alerts if a.get('severity') == 'significant') >= 3:
        return 'significant'
    if len(alerts) >= 5:
        return 'elevated'
    return 'normal'


@app.get("/api/alerts/anomalies")
async def get_anomaly_alerts(user=Depends(get_optional_user)):
    return {"count": len(_ANOMALY_ALERTS), "alerts": _ANOMALY_ALERTS[-50:]}


@app.get("/api/alerts/recent")
async def get_recent_alerts(
    rule_name: str = Query(None, description="Filter by rule_name (checks both _ANOMALY_ALERTS and _forge_alerts)"),
    hours: int = Query(6, description="Lookback window in hours"),
    user=Depends(get_optional_user),
):
    cutoff = (datetime.utcnow() - timedelta(hours=hours)).isoformat()
    recent = [a for a in _ANOMALY_ALERTS if a.get('timestamp', '') > cutoff and not a.get('dismissed')]
    if rule_name:
        # Also search the forge alert buffer (contains AIS/ADSB/NEWS/loitering alerts)
        forge_recent = [
            a for a in _forge_alerts
            if a.get('timestamp', '') > cutoff
            and (a.get('rule_name') == rule_name or a.get('rule_trigger') == rule_name)
        ]
        if forge_recent:
            return {"count": len(forge_recent), "alerts": forge_recent[-50:], "threat_level": "normal"}
        filtered = [a for a in recent if a.get('rule_name') == rule_name]
        return {"count": len(filtered), "alerts": filtered, "threat_level": "normal"}
    return {
        "count": len(recent),
        "alerts": recent,
        "threat_level": _calculate_overall_threat_level(recent),
    }


@app.post("/api/alerts/{alert_id}/classify")
async def classify_alert(alert_id: str, request: Request, user=Depends(get_optional_user)):
    body = await request.json()
    classification = body.get("classification")
    for alert in _ANOMALY_ALERTS:
        if alert.get("id") == alert_id:
            alert["classification"] = classification
            alert["classified_by"] = getattr(user, "email", "anonymous") if user else "anonymous"
            alert["classified_at"] = datetime.utcnow().isoformat()
            if classification == "dismiss":
                alert["dismissed"] = True
            return {"status": "ok", "alert": alert}
    return JSONResponse({"error": "Alert not found"}, status_code=404)


@app.post("/api/alerts/{alert_id}/pin")
async def pin_alert(alert_id: str, user=Depends(get_optional_user)):
    for alert in _ANOMALY_ALERTS:
        if alert.get("id") == alert_id:
            alert["pinned"] = not alert.get("pinned", False)
            return {"status": "ok", "pinned": alert["pinned"]}
    return JSONResponse({"error": "Alert not found"}, status_code=404)


# ══════════════════════════════════════════════════════════════════════════════
# SYSTEM 5 — Weekly Statistical Snapshots
# ══════════════════════════════════════════════════════════════════════════════

async def _generate_weekly_snapshot():
    """Gather stats from history tables and ask Claude to produce a narrative summary."""
    try:
        from database import AircraftHistory, VesselHistory, WeeklySnapshot, get_db
    except ImportError:
        print("[weekly] database models not available")
        return

    week_end   = datetime.utcnow()
    week_start = week_end - timedelta(days=7)
    print(f"[weekly] generating snapshot {week_start.date()} → {week_end.date()}")

    with get_db() as db:
        vessel_count = db.query(VesselHistory).filter(
            VesselHistory.timestamp.between(week_start, week_end)
        ).count()

        chokepoint_traffic = {}
        for cp_name, cp_data in _ANOMALY_CHOKEPOINTS.items():
            cp_lat, cp_lon = cp_data['center_lat'], cp_data['center_lon']
            lat_r = 50 / 111.0
            lon_r = 50 / (111.0 * max(0.1, abs(math.cos(math.radians(cp_lat)))))
            count = db.query(VesselHistory).filter(
                VesselHistory.timestamp.between(week_start, week_end),
                VesselHistory.lat.between(cp_lat - lat_r, cp_lat + lat_r),
                VesselHistory.lon.between(cp_lon - lon_r, cp_lon + lon_r),
            ).count()
            chokepoint_traffic[cp_name] = count

        aircraft_count = db.query(AircraftHistory).filter(
            AircraftHistory.timestamp.between(week_start, week_end)
        ).count()
        military_count = db.query(AircraftHistory).filter(
            AircraftHistory.timestamp.between(week_start, week_end),
            AircraftHistory.is_military == True,
        ).count()

    news_by_region = {}
    news_by_severity = {"critical": 0, "significant": 0, "elevated": 0, "low": 0}
    for marker in _NEWS_CONFLICT_MARKERS:
        region = marker.get('region', 'unknown')
        news_by_region[region] = news_by_region.get(region, 0) + 1
        sev = marker.get('severity', 'low')
        if sev in news_by_severity:
            news_by_severity[sev] += 1

    alert_by_type = {}
    for alert in _ANOMALY_ALERTS:
        atype = alert.get('type', 'unknown')
        alert_by_type[atype] = alert_by_type.get(atype, 0) + 1

    maritime_stats = {
        "total_vessel_positions": vessel_count,
        "avg_daily_positions": vessel_count // 7,
        "chokepoint_traffic": chokepoint_traffic,
    }
    aviation_stats = {
        "total_aircraft_positions": aircraft_count,
        "military_positions": military_count,
        "military_ratio": round(military_count / max(aircraft_count, 1) * 100, 1),
    }
    news_stats = {
        "by_region": news_by_region,
        "by_severity": news_by_severity,
        "total": sum(news_by_region.values()),
    }

    stats_text = _json.dumps({
        "maritime": maritime_stats,
        "aviation": aviation_stats,
        "news": news_stats,
        "alerts": alert_by_type,
    }, indent=2)

    summary = stats_text   # fallback if Claude unavailable
    threat_assessment = '{}'
    trends = '{}'

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if api_key:
        try:
            import anthropic as _anthropic
            def _call_claude():
                client = _anthropic.Anthropic(api_key=api_key)
                resp = client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=1500,
                    system=(
                        "You are a weekly intelligence analyst for Horizon Watch. "
                        "Produce a structured JSON analysis. Include: "
                        "'summary' (3-paragraph narrative), "
                        "'threat_levels' (dict: region → green/amber/red), "
                        "'trends' (dict: topic → increasing/stable/decreasing). "
                        "Respond with JSON only."
                    ),
                    messages=[{"role": "user", "content": f"Weekly stats {week_start.date()} to {week_end.date()}:\n\n{stats_text}"}],
                )
                return resp.content[0].text
            loop = asyncio.get_event_loop()
            analysis = await loop.run_in_executor(_executor, _call_claude)
            try:
                parsed = _json.loads(analysis)
                summary = parsed.get('summary', analysis)
                threat_assessment = _json.dumps(parsed.get('threat_levels', {}))
                trends = _json.dumps(parsed.get('trends', {}))
            except Exception:
                summary = analysis
        except Exception as e:
            print(f"[weekly] Claude analysis failed: {e}")

    snapshot = WeeklySnapshot(
        week_start=week_start,
        week_end=week_end,
        maritime_stats=_json.dumps(maritime_stats),
        aviation_stats=_json.dumps(aviation_stats),
        news_stats=_json.dumps(news_stats),
        alert_stats=_json.dumps(alert_by_type),
        summary=summary,
        threat_assessment=threat_assessment,
        trends=trends,
    )
    try:
        from database import get_db
        with get_db() as db:
            db.add(snapshot)
            db.commit()
        print(f"[weekly] snapshot saved for {week_start.date()}")
    except Exception as e:
        print(f"[weekly] save error: {e}")


async def _weekly_snapshot_loop():
    """Wait until next Sunday midnight UTC, then generate weekly snapshot."""
    while True:
        now = datetime.utcnow()
        days_until_sunday = (6 - now.weekday()) % 7
        if days_until_sunday == 0 and now.hour >= 1:
            days_until_sunday = 7
        next_sunday = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=days_until_sunday)
        wait_seconds = (next_sunday - now).total_seconds()
        print(f"[weekly] next snapshot in {wait_seconds / 3600:.1f} hours")
        await asyncio.sleep(wait_seconds)
        try:
            await _generate_weekly_snapshot()
        except Exception as e:
            print(f"[weekly] generation failed: {e}")


@app.get("/api/statistics/weekly")
async def get_weekly_snapshots(weeks: int = Query(12), user=Depends(get_optional_user)):
    try:
        from database import WeeklySnapshot, get_db
    except ImportError:
        return {"count": 0, "snapshots": []}
    with get_db() as db:
        snapshots = db.query(WeeklySnapshot).order_by(WeeklySnapshot.week_start.desc()).limit(weeks).all()
    return {
        "count": len(snapshots),
        "snapshots": [
            {
                "week_start": s.week_start.isoformat(),
                "week_end":   s.week_end.isoformat(),
                "maritime":   _json.loads(s.maritime_stats or '{}'),
                "aviation":   _json.loads(s.aviation_stats or '{}'),
                "news":       _json.loads(s.news_stats or '{}'),
                "alerts":     _json.loads(s.alert_stats or '{}'),
                "summary":    s.summary or '',
                "threat_assessment": _json.loads(s.threat_assessment or '{}'),
                "trends":     _json.loads(s.trends or '{}'),
            }
            for s in snapshots
        ],
    }


# ── Overwatch: satellite imagery object detection (ONNX — no torch/CUDA) ──────

_OW_DOTA_CLASSES = [
    "plane","ship","storage-tank","baseball-diamond","tennis-court",
    "basketball-court","ground-track-field","harbor","bridge",
    "large-vehicle","small-vehicle","helicopter","roundabout",
    "soccer-ball-field","swimming-pool",
]
# DOTA v2 extends with container-crane, airport, helipad (indices 15-17).
# yolov8m-obb is the medium-size model trained on DOTAv1 (same 15 classes,
# better accuracy). "dota-v2" key loads yolov8m-obb and falls back to nano.
_OW_DOTA_V2_CLASSES = _OW_DOTA_CLASSES + ["container-crane", "airport", "helipad"]
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
    # DOTA v2 additions
    "container-crane":    ("Infrastructure", "Container Crane"),
    "airport":            ("Aviation",       "Airport"),
    "helipad":            ("Aviation",       "Helipad"),
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
            if model_key == "dota-v2":
                fname = "yolov8m-obb.onnx"
                path  = str(BASE_DIR / fname)
                if not os.path.exists(path):
                    print(f"[overwatch] dota-v2: {fname} not found — downloading yolov8m-obb...")
                    try:
                        from ultralytics import YOLO as _YOLO
                        _m = _YOLO("yolov8m-obb.pt")
                        _m.export(format="onnx", imgsz=1024)
                        import shutil as _sh
                        _src = BASE_DIR / "yolov8m-obb.onnx"
                        if not _src.exists():
                            _src = Path("yolov8m-obb.onnx")
                        if _src.exists():
                            _sh.move(str(_src), path)
                        print(f"[overwatch] dota-v2 model ready at {path}")
                    except Exception as _dl:
                        print(f"[overwatch] dota-v2 download failed: {_dl} — falling back to nano OBB")
                        fname = "yolov8n-obb.onnx"
                        path  = str(BASE_DIR / fname)
            elif model_key == "dota":
                fname = "yolov8n-obb.onnx"
                path  = str(BASE_DIR / fname)
            else:
                fname = "yolov8n.onnx"
                path  = str(BASE_DIR / fname)
            sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
            _ort_sessions[model_key] = sess
            print(f"[overwatch] loaded {fname} (model_key={model_key})")
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
    is_dota  = model_key in ("dota", "dota-v2")
    INPUT_SZ = 1024 if is_dota else 640
    classes  = (_OW_DOTA_V2_CLASSES if model_key == "dota-v2" else
                _OW_DOTA_CLASSES    if is_dota else
                _OW_COCO_CLASSES)

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


def _run_inference_on_image(cropped, bounds, confidence, enhance=False, model_key="dota", keep_px=False):
    """Run tiled ONNX inference on a PIL Image cropped to `bounds`. Returns detection dict."""
    import numpy as np
    from PIL import Image

    is_dota  = model_key in ("dota", "dota-v2")
    INPUT_SZ = 1024 if is_dota else 640
    classes  = (_OW_DOTA_V2_CLASSES if model_key == "dota-v2" else
                _OW_DOTA_CLASSES    if is_dota else
                _OW_COCO_CLASSES)

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
            if model_key == "dota-v2":
                # 18 classes: cols 4..21, angle at col 22
                bxy_t = pr_t[:, :4]; sc_cls = pr_t[:, 4:22]; ang_t = pr_t[:, 22]
            elif is_dota:
                # 15 classes: cols 4..18, angle at col 19
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

    # Save pixel boxes before enhance/cleanup so keep_px can restore them
    _px_saved = {id(d): d.get("_px") for d in detections} if keep_px else {}

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

    # Restore saved pixel boxes if requested
    if keep_px:
        for det in detections:
            px = _px_saved.get(id(det))
            if px is not None:
                det["_px"] = px

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


# ── _convert_overwatch_detections ─────────────────────────────────────────────

def _convert_overwatch_detections(raw_dets: list, band_type: str = "TRUE_COLOR") -> list:
    """Convert _run_overwatch_inference output to SentinelDetection schema dicts."""
    import json as _j, math as _m

    _DOTA_TO_TYPE = {
        "ship": "vessel", "large-vehicle": "vessel", "small-vehicle": "vehicle",
        "plane": "aircraft", "helicopter": "aircraft",
        "storage-tank": "infrastructure_change", "swimming-pool": "infrastructure_change",
        "harbor": "infrastructure_change", "bridge": "infrastructure_change",
        "ground-track-field": "infrastructure_change", "basketball-court": "infrastructure_change",
        "soccer-ball-field": "infrastructure_change", "roundabout": "infrastructure_change",
        "tennis-court": "infrastructure_change", "baseball-diamond": "infrastructure_change",
    }

    def _hav(lat1, lon1, lat2, lon2):
        R = 6_371_000
        dl = _m.radians(lat2 - lat1); dg = _m.radians(lon2 - lon1)
        a = _m.sin(dl/2)**2 + _m.cos(_m.radians(lat1)) * _m.cos(_m.radians(lat2)) * _m.sin(dg/2)**2
        return R * 2 * _m.asin(_m.sqrt(a))

    results = []
    for d in raw_dets:
        center  = d.get("center", [0, 0])   # [lat, lon]
        corners = d.get("corners", [])
        cls     = d.get("class", "unknown")
        conf    = float(d.get("confidence", 0.0))
        obj_type = _DOTA_TO_TYPE.get(cls, cls.replace("-", "_").lower())

        geo_geometry = est_length_m = est_width_m = area_m2 = None
        if corners:
            lats = [c[0] for c in corners]; lons = [c[1] for c in corners]
            ring = [[min(lons), min(lats)], [max(lons), min(lats)],
                    [max(lons), max(lats)], [min(lons), max(lats)], [min(lons), min(lats)]]
            geo_geometry = _j.dumps({"type": "Polygon", "coordinates": [ring]})
            lat_m = _hav(min(lats), min(lons), max(lats), min(lons))
            lon_m = _hav(min(lats), min(lons), min(lats), max(lons))
            area_m2      = round(lat_m * lon_m, 1)
            est_length_m = round(max(lat_m, lon_m), 1)
            est_width_m  = round(min(lat_m, lon_m), 1)

        sev        = "high"      if conf > 0.7 else ("medium" if conf > 0.4 else "info")
        alert_tier = "immediate" if conf > 0.7 and obj_type == "vessel" else (
                     "digest"    if conf > 0.35 else "silent")

        results.append({
            "object_type":   obj_type,
            "confidence":    round(conf, 3),
            "centroid_lat":  round(float(center[0]), 6),
            "centroid_lon":  round(float(center[1]), 6),
            "geo_geometry":  geo_geometry,
            "area_m2":       area_m2,
            "severity":      sev,
            "alert_tier":    alert_tier,
            "matched_to_ais": False,
            "attributes":    _j.dumps({
                "class":             cls,
                "category":          d.get("category", "Object"),
                "subcategory":       d.get("subcategory", ""),
                "estimated_length_m": est_length_m,
                "estimated_width_m":  est_width_m,
                "band_type":         band_type,
            }),
        })
    return results


# ── _run_overwatch_detection_sync ─────────────────────────────────────────────

def _run_overwatch_detection_sync(bbox: dict, band_type: str = "TRUE_COLOR",
                                   confidence: float = 0.15) -> list:
    """Blocking detection for TRUE_COLOR band via ESRI DOTA YOLO."""
    west  = float(bbox["min_lon"])
    south = float(bbox["min_lat"])
    east  = float(bbox["max_lon"])
    north = float(bbox["max_lat"])
    bounds = {"north": north, "south": south, "east": east, "west": west}

    result = _run_overwatch_inference(bounds, zoom=17, confidence=confidence,
                                      enhance=False, model_key="dota")
    if result.get("error"):
        print(f"[overwatch_detection] ESRI error: {result['error']}")
        return []
    return _convert_overwatch_detections(result.get("detections", []), "TRUE_COLOR")


@app.post("/api/overwatch/detect")
async def overwatch_detect(request: Request):
    """Fetch Esri satellite tiles, run ONNX YOLOv8 (DOTA OBB default), return geo detections."""
    try:
        body       = await request.json()
        bounds     = body.get("bounds")
        zoom       = int(body.get("zoom", 15))
        confidence = float(body.get("confidence", 0.15))   # lower default for aerial
        enhance    = bool(body.get("enhance", False))
        _m = body.get("model", "dota")
        model_key  = "coco" if _m == "coco" else ("dota-v2" if _m == "dota-v2" else "dota")
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
        _m = body.get("model", "dota")
        model_key  = "coco" if _m == "coco" else ("dota-v2" if _m == "dota-v2" else "dota")

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


@app.post("/api/overwatch/scans")
async def overwatch_scans_create(request: Request):
    """Persist a completed Overwatch scan record for analytics."""
    import json as _json
    try:
        from backend.database import OverwatchScanRecord
    except ImportError:
        from database import OverwatchScanRecord
    try:
        body = await request.json()
        with get_db() as db:
            rec = OverwatchScanRecord(
                zone_name      = body.get("zone_name"),
                bounds_json    = _json.dumps(body.get("bounds")) if body.get("bounds") else None,
                polygon_json   = _json.dumps(body.get("polygon")) if body.get("polygon") else None,
                total          = int(body.get("total", 0)),
                by_category    = _json.dumps(body.get("by_category", {})),
                avg_confidence = body.get("avg_confidence"),
                imagery_source = body.get("imagery_source"),
                imagery_type   = body.get("imagery_type"),
                model_used     = body.get("model_used"),
            )
            db.add(rec)
            db.commit()
            db.refresh(rec)
            return JSONResponse({"id": rec.id, "created_at": rec.created_at.isoformat()})
    except Exception as e:
        print(f"[overwatch/scans POST] error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/overwatch/scans")
async def overwatch_scans_list(request: Request, limit: int = 50):
    """Return recent Overwatch scan records for analytics charts."""
    import json as _json
    try:
        from backend.database import OverwatchScanRecord
    except ImportError:
        from database import OverwatchScanRecord
    try:
        with get_db() as db:
            rows = db.query(OverwatchScanRecord).order_by(OverwatchScanRecord.created_at.desc()).limit(limit).all()
            records = []
            for r in rows:
                records.append({
                    "id":             r.id,
                    "zone_name":      r.zone_name,
                    "total":          r.total,
                    "by_category":    _json.loads(r.by_category) if r.by_category else {},
                    "avg_confidence": r.avg_confidence,
                    "imagery_source": r.imagery_source,
                    "imagery_type":   r.imagery_type,
                    "model_used":     r.model_used,
                    "created_at":     r.created_at.isoformat() if r.created_at else None,
                })
            return JSONResponse({"scans": records})
    except Exception as e:
        print(f"[overwatch/scans GET] error: {e}")
        return JSONResponse({"scans": [], "error": str(e)})


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


async def _sentinel_zone_scheduler_loop():
    """Background loop: every 15 minutes, trigger scans for due WatchZones."""
    import asyncio as _asyncio_sched
    await _asyncio_sched.sleep(165)  # staggered startup
    _sched_interval = 15 * 60  # 15 minutes

    while True:
        try:
            await _asyncio_sched.sleep(_sched_interval)
            from database import WatchZone, get_db as _gdb
            now_sched = datetime.now(timezone.utc).replace(tzinfo=None)
            with _gdb() as _db:
                due_zones = (
                    _db.query(WatchZone)
                    .filter(
                        WatchZone.enabled == True,
                        WatchZone.next_scan_at <= now_sched,
                    )
                    .all()
                )
                zone_data = [
                    {
                        "id": z.id, "system_id": z.system_id, "name": z.name,
                        "bbox_min_lon": z.bbox_min_lon, "bbox_min_lat": z.bbox_min_lat,
                        "bbox_max_lon": z.bbox_max_lon, "bbox_max_lat": z.bbox_max_lat,
                        "ml_tasks": z.ml_tasks, "scan_interval_hours": z.scan_interval_hours,
                        "alert_threshold": z.alert_threshold,
                    }
                    for z in due_zones
                ]

            for zd in zone_data:
                print(f"[sentinel-scheduler] Scan triggered for zone {zd['system_id']} ({zd['name']})")
                async def _run_zone(zone_dict=zd):
                    try:
                        from sentinel_scanner import SentinelScanner as _Sc
                        await _asyncio_sched.get_event_loop().run_in_executor(
                            None, lambda: _Sc().run_scan(zone_dict, triggered_by="schedule")
                        )
                    except Exception as _e:
                        print(f"[sentinel-scheduler] scan error for {zone_dict['system_id']}: {_e}")
                _asyncio_sched.ensure_future(_run_zone())

        except Exception as _sched_e:
            print(f"[sentinel-scheduler] loop error: {_sched_e}")
            await _asyncio_sched.sleep(60)


def _auto_ingest() -> None:
    """
    Checks each reference table and runs ingestion/seeding if empty.
    Runs in a thread executor — safe to block.
    """
    import sys as _sys
    _be_dir = os.path.dirname(__file__)
    if _be_dir not in _sys.path:
        _sys.path.insert(0, _be_dir)

    from database import (
        CableSegment, LandingPoint, PortBoundary, Airport,
        RegionDefinition, RuleConfig, OntologyEntity, SessionLocal as _SL,
    )

    def _count(model):
        with _SL() as _db:
            return _db.query(model).count()

    # 1. Regions
    if _count(RegionDefinition) == 0:
        print("[auto-ingest] Regions: seeding …")
        try:
            from ingest_cables import populate_regions, REGION_DEFS
            with _SL() as _db:
                populate_regions(_db)
            print(f"[auto-ingest] Regions: {len(REGION_DEFS)} seeded")
        except Exception as _e:
            print(f"[auto-ingest] Regions seed failed: {_e}")
    else:
        print(f"[auto-ingest] Regions: {_count(RegionDefinition)} present, skipping")

    # 2 & 3. Cables + Landing Points
    cable_count = _count(CableSegment)
    if cable_count == 0:
        print("[auto-ingest] Cables: ingesting from TeleGeography…")
        try:
            from ingest_cables import run_ingest as _ingest_cables
            stats = _ingest_cables()
            print(f"[auto-ingest] Cables: {stats}")
        except Exception as _e:
            print(f"[auto-ingest] Cables ingest failed: {_e}")
    else:
        print(f"[auto-ingest] Cables: {cable_count} present, skipping")

    # 4. Ports
    port_count = _count(PortBoundary)
    if port_count == 0:
        print("[auto-ingest] Ports: ingesting from UN LOCODE…")
        try:
            from ingest_ports import run_ingest as _ingest_ports
            stats = _ingest_ports()
            print(f"[auto-ingest] Ports: {stats}")
        except Exception as _e:
            print(f"[auto-ingest] Ports ingest failed: {_e}")
    else:
        print(f"[auto-ingest] Ports: {port_count} present, skipping")

    # 5. Airports
    arpt_count = _count(Airport)
    if arpt_count == 0:
        print("[auto-ingest] Airports: ingesting from OurAirports…")
        try:
            from ingest_airports import run_ingest as _ingest_airports
            stats = _ingest_airports()
            print(f"[auto-ingest] Airports: {stats}")
        except Exception as _e:
            print(f"[auto-ingest] Airports ingest failed: {_e}")
    else:
        print(f"[auto-ingest] Airports: {arpt_count} present, skipping")

    # 6. Rules
    rule_count = _count(RuleConfig)
    if rule_count == 0:
        print("[auto-ingest] Rules: seeding canonical rule set…")
        try:
            from seed_rules import seed_db as _seed_rules
            stats = _seed_rules()
            print(f"[auto-ingest] Rules: {stats}")
        except Exception as _e:
            print(f"[auto-ingest] Rules seed failed: {_e}")
    else:
        print(f"[auto-ingest] Rules: {rule_count} present, skipping")

    # 7. OntologyEntity minimum check
    onto_count = _count(OntologyEntity)
    expected_min = 100
    if onto_count < expected_min:
        print(f"[auto-ingest] OntologyEntity: {onto_count} < {expected_min} expected — re-running ontology registration …")
        try:
            from ingest_cables import register_ontology_entities as _reg_cables
            from ingest_ports import register_ontology_entities as _reg_ports
            from ingest_airports import register_ontology_entities as _reg_airports
            with _SL() as _db:
                n_c = _reg_cables(_db)
                n_p = _reg_ports(_db)
                n_a = _reg_airports(_db)
            print(f"[auto-ingest] Ontology re-registered: cables={n_c} ports={n_p} airports={n_a}")
        except Exception as _e:
            print(f"[auto-ingest] Ontology re-registration failed: {_e}")
    else:
        print(f"[auto-ingest] OntologyEntity: {onto_count} present, ok")

    # 8. Chokepoints in OntologyEntity
    try:
        with _SL() as _db:
            choke_in_onto = _db.query(OntologyEntity).filter(
                OntologyEntity.entity_type == "Chokepoint"
            ).count()
        if choke_in_onto < len(_CHOKEPOINT_DEFS):
            print(f"[auto-ingest] Chokepoints: {choke_in_onto}/{len(_CHOKEPOINT_DEFS)} — seeding …")
            with _SL() as _db:
                for cp in _CHOKEPOINT_DEFS:
                    sid = cp["system_id"]
                    existing = _db.query(OntologyEntity).filter(
                        OntologyEntity.system_id == sid
                    ).first()
                    poly_coords = cp.get("polygon", [])
                    meta = _json.dumps({
                        "lat": cp.get("lat") or cp.get("center_lat"),
                        "lon": cp.get("lon") or cp.get("center_lng"),
                        "polygon": poly_coords,
                        "polygon_bounds": cp.get("polygon_bounds"),
                        "threat_level": cp.get("threat_level", "standard"),
                    })
                    if existing:
                        existing.entity_metadata = meta
                    else:
                        _db.add(OntologyEntity(
                            system_id       = sid,
                            entity_type     = "Chokepoint",
                            name            = cp["name"],
                            infra_type      = "Chokepoint",
                            entity_metadata = meta,
                        ))
                _db.commit()
            print(f"[auto-ingest] Chokepoints: seeded {len(_CHOKEPOINT_DEFS)} entries")
        else:
            print(f"[auto-ingest] Chokepoints: {choke_in_onto} present, ok")
    except Exception as _e:
        print(f"[auto-ingest] Chokepoints seed failed: {_e}")

    # 9. Strategic Zones baseline
    try:
        with _SL() as _db:
            from database import StrategicZone as _SZ
            sz_count = _db.query(_SZ).count()
        if sz_count == 0:
            print("[auto-ingest] StrategicZones: seeding baseline…")
            from seed_strategic_zones import seed_strategic_zones as _seed_sz
            stats = _seed_sz()
            print(f"[auto-ingest] StrategicZones: {stats}")
        else:
            print(f"[auto-ingest] StrategicZones: {sz_count} present, ok")
    except Exception as _e:
        print(f"[auto-ingest] StrategicZones seed failed: {_e}")

    print("[auto-ingest] ✓ complete")


async def _auto_ingest_task():
    """Wraps _auto_ingest() to run in executor after a short startup delay."""
    await asyncio.sleep(30)  # staggered startup
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(_executor, _auto_ingest)
    except Exception as _e:
        print(f"[auto-ingest] task error: {_e}")


async def _zone_images_warmup_task():
    """Load zone images from DB metadata into the in-memory cache on startup."""
    await asyncio.sleep(30)  # staggered startup
    try:
        from database import StrategicZone, get_db
        with get_db() as db:
            zones = db.query(StrategicZone).filter(StrategicZone.enabled == True).all()
        for z in zones:
            if z.zone_id in _zone_image_cache:
                continue
            try:
                meta   = _json.loads(z.zone_metadata) if z.zone_metadata else {}
                images = meta.get("images", [])
                if images:
                    _zone_image_cache[z.zone_id] = images
            except Exception:
                pass
        print(f"[zone-images] warmup complete — {len(_zone_image_cache)} zones cached")
    except Exception as ex:
        print(f"[zone-images] warmup error: {ex}")


async def _fusion_expire_loop():
    """Prune stale fusion signals and surge events every 15 minutes."""
    await asyncio.sleep(30)
    while True:
        try:
            if _fusion_engine:
                _fusion_engine.expire_old_signals()
            if _surge_engine:
                _surge_engine.expire_old_surges()
        except Exception as _fxe:
            print(f"[fusion] expire loop error: {_fxe}")
        await asyncio.sleep(900)   # 15 minutes


def _tm_get_fusions():
    _fusions = []
    try:
        if _fusion_engine:
            from database import FusionEvent as _FE_tm, get_db as _gdb_fe
            with _gdb_fe() as _dbtm:
                _fusions = [
                    {"lat": r.lat, "lon": r.lon, "severity": r.severity}
                    for r in _dbtm.query(_FE_tm).filter(
                        _FE_tm.status == "active", _FE_tm.marker_visible == True
                    ).all()
                ]
    except Exception:
        pass
    return _fusions


def _tm_refresh_once():
    """Run a single threat-matrix refresh cycle. Safe to call from any context."""
    try:
        from database import get_db as _gdb_tm
        active_events = []
        try:
            active_events = es.get_active_events()
        except Exception:
            pass
        fusions = _tm_get_fusions()
        with _gdb_tm() as _db:
            threat_matrix.refresh_cache(_db, list(_forge_alerts), active_events, fusions)
            now_utc = datetime.utcnow()
            if now_utc.hour == 0 and now_utc.minute < 5:
                threat_matrix.save_daily_snapshot(_db, list(_forge_alerts), active_events)
                print("[threat-matrix] daily snapshot saved")
        print("[threat-matrix] cache refreshed")
    except Exception as _tm_e:
        print(f"[threat-matrix] refresh error: {_tm_e}")


async def _daily_db_purge_loop():
    """Run once daily (at 03:00 UTC) to prune old rows and keep the DB lean."""
    await asyncio.sleep(240)  # staggered startup
    while True:
        now = datetime.now(timezone.utc)
        # Run at 03:xx UTC
        if now.hour == 3:
            try:
                from database import get_db as _gdb_purge, Alert, SurgeEvent, FusionSignal, ThreatMatrixSnapshot, OntologyLink
                cutoff_7d  = datetime.now(timezone.utc) - timedelta(days=7)
                cutoff_30d = datetime.now(timezone.utc) - timedelta(days=30)
                cutoff_48h = datetime.now(timezone.utc) - timedelta(hours=48)
                deleted = {}
                with _gdb_purge() as _pdb:
                    deleted["old_alerts"] = _pdb.query(Alert).filter(
                        Alert.created_at < cutoff_7d, Alert.status != "active"
                    ).delete(synchronize_session=False)
                    deleted["expired_surges"] = _pdb.query(SurgeEvent).filter(
                        SurgeEvent.expires_at < cutoff_48h
                    ).delete(synchronize_session=False)
                    deleted["expired_fusions"] = _pdb.query(FusionSignal).filter(
                        FusionSignal.expires_at < datetime.now(timezone.utc)
                    ).delete(synchronize_session=False)
                    deleted["old_snapshots"] = _pdb.query(ThreatMatrixSnapshot).filter(
                        ThreatMatrixSnapshot.snapshot_at < cutoff_30d
                    ).delete(synchronize_session=False)
                    deleted["old_links"] = _pdb.query(OntologyLink).filter(
                        OntologyLink.created_at < cutoff_30d
                    ).delete(synchronize_session=False)
                    _pdb.commit()
                print(f"[purge] Daily DB purge complete: {deleted}")
            except Exception as _pe:
                print(f"[purge] Daily DB purge error: {_pe}")
            # Sleep 23h to avoid running twice in the same 03:xx window
            await asyncio.sleep(82800)
        else:
            await asyncio.sleep(1800)


async def _trajectory_loop():
    """Compute and persist ThreatTrajectory rows every hour."""
    await asyncio.sleep(75)  # staggered startup
    while True:
        try:
            from database import ThreatTrajectory
            from threat_matrix import REGIONS, compute_trajectory
            with get_db() as _tdb:
                for region_name in REGIONS:
                    try:
                        t = compute_trajectory(region_name, _tdb)
                        _tdb.add(ThreatTrajectory(
                            zone_id      = region_name,
                            zone_name    = region_name,
                            score_now    = t["score_now"],
                            threat_level = t["threat_level"],
                            velocity_1d  = t["velocity_1d"],
                            velocity_3d  = t["velocity_3d"],
                            velocity_7d  = t["velocity_7d"],
                            acceleration = t["acceleration"],
                            trajectory   = t["trajectory"],
                            computed_at  = datetime.utcnow(),
                        ))
                    except Exception as _te:
                        print(f"[trajectory] {region_name}: {_te}")
                _tdb.commit()
            print(f"[trajectory] updated {len(REGIONS)} zones")
        except Exception as _tl_err:
            print(f"[trajectory] loop error: {_tl_err}")
        await asyncio.sleep(3600)


async def _foresight_loop():
    """Run foresight analysis cycle every hour — analyses top 3 qualifying zones."""
    await asyncio.sleep(210)  # staggered startup
    while True:
        try:
            import foresight_engine
            with get_db() as _fdb:
                await foresight_engine.run_foresight_cycle(_fdb, list(_forge_alerts))
            # Write foresight_latest snapshot
            try:
                from database import ForesightAssessment as _FA
                with get_db() as _fadb:
                    _fa_rows = (_fadb.query(_FA)
                                     .order_by(_FA.generated_at.desc())
                                     .limit(20).all())
                await _write_snapshot("foresight_latest", [
                    {"zone_id": r.zone_id, "zone_name": r.zone_name,
                     "escalation_probability_30d": r.escalation_probability_30d,
                     "confidence": r.confidence, "analyst_note": r.analyst_note,
                     "situation_summary": r.situation_summary,
                     "generated_at": r.generated_at.isoformat() if r.generated_at else None}
                    for r in _fa_rows
                ])
            except Exception as _fase:
                print(f"[SNAPSHOT] foresight_latest error: {_fase}")
        except Exception as _fl_err:
            print(f"[foresight] loop error: {_fl_err}")
        await asyncio.sleep(3600)


async def _threat_snapshot_loop():
    """Write hourly ThreatSnapshotHourly rows for trend computation."""
    await asyncio.sleep(100)  # staggered startup
    while True:
        try:
            from database import get_db as _gdb_ts
            active_events = []
            try:
                active_events = es.get_active_events()
            except Exception:
                pass
            with _gdb_ts() as _ts_db:
                n = threat_matrix.save_hourly_snapshot(_ts_db, list(_forge_alerts), active_events)
            print(f"[threat-snapshot] wrote {n} hourly rows")
            # Write threat_matrix snapshot
            try:
                from database import ThreatSnapshotHourly as _TSH
                with get_db() as _tmdb:
                    _tm_rows = (_tmdb.query(_TSH)
                                     .order_by(_TSH.snapshot_at.desc())
                                     .limit(100).all())
                _write_snapshot_sync("threat_matrix", [
                    {"region_name": r.region_name, "region_id": r.region_id,
                     "score": r.score, "threat_level": r.threat_level,
                     "snapshot_at": r.snapshot_at.isoformat() if r.snapshot_at else None}
                    for r in _tm_rows
                ])
            except Exception as _tme:
                print(f"[SNAPSHOT] threat_matrix error: {_tme}")
        except Exception as _tse:
            print(f"[threat-snapshot] error: {_tse}")
        await asyncio.sleep(3600)


async def _threat_matrix_loop():
    """Hourly threat-matrix cache refresh + midnight daily snapshot."""
    # Immediate first run — don't wait an hour for data
    await asyncio.sleep(15)
    _tm_refresh_once()
    while True:
        await asyncio.sleep(3600)
        _tm_refresh_once()


async def _dirty_region_refresh_loop():
    """Refreshes threat-matrix scores for dirty regions every 30 seconds."""
    from alert_writer import pop_dirty_regions
    await asyncio.sleep(30)
    while True:
        try:
            dirty = pop_dirty_regions()
            if dirty:
                from database import get_db as _gdb_dr
                active_events = []
                try:
                    active_events = es.get_active_events()
                except Exception:
                    pass
                with _gdb_dr() as _dr_db:
                    threat_matrix.refresh_dirty_regions(
                        dirty, _dr_db, list(_forge_alerts), active_events,
                    )
                print(f"[threat-matrix] dirty-region refresh: {dirty}")
        except Exception as _dr_e:
            print(f"[threat-matrix] dirty-region loop error: {_dr_e}")
        await asyncio.sleep(30)


def _reset_recent_llm_extractions(days: int = 7) -> int:
    """Clear llm_extracted flag for recent articles so they are re-run with the
    current prompt (e.g. after a prompt change that adds location_country).
    Returns the count of articles reset."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    reset_count = 0
    with _NEWS_STORE_LOCK:
        for art in _NEWS_ARTICLE_STORE.values():
            if not art.get("llm_extracted"):
                continue
            pub = art.get("published") or art.get("updated_at") or ""
            try:
                pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00")) if pub else None
            except (ValueError, AttributeError):
                pub_dt = None
            if pub_dt and pub_dt >= cutoff:
                art["llm_extracted"] = False
                reset_count += 1
    return reset_count


@app.on_event("startup")
async def startup_event():
    global _BRIEFING_STORE
    loop = asyncio.get_event_loop()
    print(f"[startup] *** HORIZON WATCH STARTING — env='{os.getenv('RAILWAY_ENVIRONMENT','local')}' DATA_DIR={DATA_DIR} ***")
    print(f"[startup] ELEVENLABS_API_KEY present: {bool(os.getenv('ELEVENLABS_API_KEY'))}")
    print(f"[startup] ANTHROPIC_API_KEY present: {bool(os.getenv('ANTHROPIC_API_KEY'))}")
    # Initialise response cache
    if _HAS_RESPONSE_CACHE:
        FastAPICache.init(InMemoryBackend())
        print("[startup] fastapi-cache2 response cache initialised")
    # Load persisted event store (executor: file I/O can block on Railway's network volume)
    try:
        _es_path = os.path.join(DATA_DIR, "event_store.json")
        await asyncio.wait_for(
            loop.run_in_executor(_executor, lambda: es.load_from_disk(_es_path)),
            timeout=30,
        )
    except Exception as _e:
        print(f"[startup] event store load error: {_e}")
    # Initialise user database (executor: SQLite + bcrypt block the event loop)
    try:
        from database import migrate_db as _migrate_db, init_db as _init_db
        await asyncio.wait_for(loop.run_in_executor(_executor, _migrate_db), timeout=30)
        await asyncio.wait_for(loop.run_in_executor(_executor, _init_db), timeout=30)
        print("[startup] database initialised")

    except Exception as _e:
        print(f"[startup] database init failed: {_e}")

    # Rebuild _forge_alerts from DB and load entity linker cache
    try:
        def _rebuild_from_db():
            global _forge_alerts
            from database import get_db as _gdb, Alert as _AlertModel
            import json as _json2
            cutoff = (datetime.utcnow() - timedelta(hours=24)).isoformat()
            rebuilt = []
            with _gdb() as _db:
                rows = (_db.query(_AlertModel)
                        .filter(_AlertModel.status == "active",
                                _AlertModel.created_at >= datetime.utcnow() - timedelta(hours=24))
                        .order_by(_AlertModel.created_at.asc())
                        .all())
                for row in rows:
                    try:
                        d = _json2.loads(row.raw_json or "{}")
                    except Exception:
                        d = {}
                    d.setdefault("id",        row.alert_id)
                    d.setdefault("title",     row.title)
                    d.setdefault("severity",  row.severity)
                    d.setdefault("lat",       row.lat)
                    d.setdefault("lng",       row.lon)
                    d.setdefault("source",    row.source)
                    d.setdefault("timestamp", row.created_at.isoformat() if row.created_at else "")
                    rebuilt.append(d)
            _forge_alerts = rebuilt
            print(f"[startup] rebuilt _forge_alerts from DB: {len(rebuilt)} alerts")
            entity_linker.load_cache()
        await asyncio.wait_for(loop.run_in_executor(_executor, _rebuild_from_db), timeout=30)
    except Exception as _e:
        print(f"[startup] forge_alerts rebuild error: {_e}")

    print("[startup] classifier.py loaded")
    print("[startup] significance scorer initialised")
    print("[startup] prefetch cache initialised")

    # Ensure document directories exist
    _ensure_docs_dirs()

    # Load persisted briefing history (executor: file I/O)
    try:
        _store = await asyncio.wait_for(
            loop.run_in_executor(_executor, _load_briefing_store),
            timeout=15,
        )
        with _BRIEFING_LOCK:
            _BRIEFING_STORE = _store
    except Exception as _e:
        print(f"[startup] briefing store load error: {_e}")
    print(f"[startup] loaded {len(_BRIEFING_STORE)} briefing(s) from disk")

    _reset_count = _reset_recent_llm_extractions(days=7)
    print(f"[startup] reset llm_extracted for {_reset_count} recent articles (prompt update)")

    # Wire NewsPatternEngine fire callback
    if _news_pattern_engine:
        _news_pattern_engine.set_fire_callback(_news_assessment_fire)
        print("[startup] NewsPatternEngine fire callback registered")

    # Wire FusionEngine fire callback
    if _fusion_engine:
        def _fusion_fire_callback(fusion_dict: dict, suppressed_alert_ids: list):
            """Append fusion event as a forge alert and suppress individual markers."""
            _forge_alert = {
                "id":           fusion_dict["fusion_id"],
                "fusion_id":    fusion_dict["fusion_id"],
                "rule_name":    "INTELLIGENCE_FUSION",
                "source":       "FUSION",
                "severity":     fusion_dict.get("severity", "high"),
                "icon_type":    "FUSION_EVENT",
                "lat":          fusion_dict.get("lat"),
                "lng":          fusion_dict.get("lon"),
                "title":        fusion_dict.get("title"),
                "message":      fusion_dict.get("narrative", ""),
                "subtitle":     fusion_dict.get("subtitle"),
                "domains":      fusion_dict.get("domains", []),
                "signal_count": fusion_dict.get("signal_count", 0),
                "confidence":   fusion_dict.get("confidence", 0.5),
                "key_signals":  fusion_dict.get("key_signals", []),
                "threat_indicators": fusion_dict.get("threat_indicators", []),
                "timestamp":    datetime.utcnow().isoformat(),
                "provenance": {"source_type": "FUSION", "detection_rule": "INTELLIGENCE_FUSION"},
            }
            global _forge_alerts
            _forge_alerts.append(_forge_alert)
            # Remove suppressed individual alert markers
            _forge_alerts = [a for a in _forge_alerts if a.get("id") not in suppressed_alert_ids]

        _fusion_engine.set_fire_callback(_fusion_fire_callback)
        print("[startup] FusionEngine fire callback registered")
        # Reload persisted signals NOW that the callback is wired,
        # so any fusions that re-cross their threshold can actually fire.
        _fusion_engine._reload_signals_from_db()
        print("[startup] FusionEngine signals reloaded from DB")
        asyncio.create_task(_fusion_expire_loop())

    asyncio.create_task(_extract_news_conflicts_loop())
    asyncio.create_task(_background_news_geocode_loop())
    asyncio.create_task(_surface_pool_loop())
    # _daily_briefing_loop removed — Director Mode generates briefings on demand
    asyncio.create_task(_oref_loop())
    asyncio.create_task(_usgs_loop())
    asyncio.create_task(_gdacs_loop())
    asyncio.create_task(_geo_refresh_loop())
    asyncio.create_task(_startup_warmup_tasks())
    asyncio.create_task(_ais_websocket_loop())
    asyncio.create_task(_prune_history_loop())
    asyncio.create_task(_ais_aggregate_loop())
    # asyncio.create_task(_anomaly_detection_loop())  # disabled — too many false positives
    asyncio.create_task(_weekly_snapshot_loop())
    asyncio.create_task(_global_adsb_cache_loop())
    # Forge detection engine
    if _HAS_DETECTORS:
        _weights_file = os.path.join(DATA_DIR, "forge", "forge_weights.json")
        try:
            with open(_weights_file) as _wf:
                _threat_engine.load_weights(_json.load(_wf))
            print(f"[forge] loaded saved weights: {_threat_engine.weights}")
        except Exception:
            print("[forge] using default threat weights")
        asyncio.create_task(_youtube_reels_loop())
    asyncio.create_task(_shorts_refresh_loop())
    asyncio.create_task(_forge_detection_cycle())
    asyncio.create_task(_sts_detection_loop())
    asyncio.create_task(_sentinel_zone_scheduler_loop())
    asyncio.create_task(_auto_ingest_task())
    asyncio.create_task(_zone_images_warmup_task())
    asyncio.create_task(_threat_matrix_loop())
    asyncio.create_task(_threat_snapshot_loop())
    asyncio.create_task(_dirty_region_refresh_loop())
    asyncio.create_task(_daily_db_purge_loop())
    asyncio.create_task(_trajectory_loop())
    asyncio.create_task(_foresight_loop())
    asyncio.create_task(_startup_snapshot_prefill())

    # Load OpenSanctions vessel list in background (non-blocking)
    async def _load_sanctions_bg():
        await asyncio.sleep(15)   # let DB settle first
        try:
            from database import SessionLocal as _SL
            with _SL() as _sdb:
                stats = await sanctions_loader.load_or_refresh(_sdb)
            print(f"[startup] Sanctions list: {stats.get('vessels', 0)} vessels loaded "
                  f"({stats.get('by_mmsi', 0)} by MMSI)")
        except Exception as _se:
            print(f"[startup] Sanctions load failed: {_se}")
    asyncio.create_task(_load_sanctions_bg())

    async def _director_auto_prepare():
        await asyncio.sleep(120)
        try:
            await director_prepare_briefing(current_user=None)
            print("[startup] director auto-prepare complete")
        except Exception as _e:
            print(f"[startup] director auto-prepare failed: {_e}")
    asyncio.create_task(_director_auto_prepare())

    # ── Event bus ─────────────────────────────────────────────────────────
    _evt_loop = asyncio.get_event_loop()
    event_bus.set_loop(_evt_loop)
    event_bus.subscribe(Events.ALERT_CREATED,          _on_alert_created)
    event_bus.subscribe(Events.ARTICLE_CREATED,        _on_article_created)
    event_bus.subscribe(Events.FUSION_CREATED,         _on_fusion_created)
    event_bus.subscribe(Events.SURGE_CREATED,          _on_surge_created)
    event_bus.subscribe(Events.THREAT_REGION_DIRTY,    _on_threat_dirty)
    asyncio.create_task(event_bus.start())
    print("[startup] event bus started")

    spacy_mode = "spaCy NER" if _HAS_SPACY else "keyword fallback"
    print(f"[startup] Poll intervals — AIS: WebSocket | ADSB: 120s | RSS: 1800s")
    print(f"[startup] All background tasks started ({spacy_mode}). feeds={len(_SCAN_FEEDS)} executor_workers=4")


# ── Pikud HaOref (Israel missile alerts) ─────────────────────────────────────

async def _oref_loop():
    global _OREF_SEEN_IDS, _OREF_FAILURES, _OREF_SUSPENDED
    await asyncio.sleep(35)  # staggered startup
    url  = "https://www.oref.org.il/WarningMessages/History/AlertsHistory.json"
    loop = asyncio.get_event_loop()
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
    await asyncio.sleep(35)  # staggered startup
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
    await asyncio.sleep(35)  # staggered startup
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
def get_surface_pool(response: FastAPIResponse):
    """Return the current ranked surface pool (top 15 scored items), with any auto-briefs attached."""
    started = time.perf_counter()
    cache_status = "hit"
    with _SURFACE_POOL_LOCK:
        pool    = list(_SURFACE_POOL)
        updated = _SURFACE_POOL_UPDATED_AT
    if not pool:
        # Try DB cache before triggering expensive rebuild
        cached = _surface_pool_cache_load()
        if cached:
            with _SURFACE_POOL_LOCK:
                _SURFACE_POOL[:] = cached
                pool = cached
                updated = _SURFACE_POOL_UPDATED_AT
        else:
            cache_status = "miss"
            pool = _refresh_surface_pool_sync("api-empty")
            with _SURFACE_POOL_LOCK:
                updated = _SURFACE_POOL_UPDATED_AT
    response.headers["X-Surface-Cache"] = cache_status
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


# ── /api/admin/backfill-article-intelligence ──────────────────────────────────

@app.post("/api/admin/backfill-article-intelligence")
async def backfill_article_intelligence():
    """
    One-time backfill: process all articles in _NEWS_ARTICLE_STORE that
    haven't been LLM-extracted yet. Run after deploy to backfill existing data.
    """
    if not client:
        return {"error": "ANTHROPIC_API_KEY not set"}

    loop = asyncio.get_event_loop()

    def _run():
        with _NEWS_STORE_LOCK:
            pending = [
                (url, dict(a)) for url, a in _NEWS_ARTICLE_STORE.items()
                if not a.get("llm_extracted")
            ]
        total = len(pending)
        processed = 0
        for url, article in pending:
            title   = article.get("title") or ""
            summary = article.get("summary") or ""
            source  = article.get("source") or ""
            if not title:
                continue
            try:
                intel = analyse_article(title, summary, source)
                updates = {
                    "extracted_location":    intel.get("location") or "",
                    "extraction_confidence": intel.get("location_confidence") or "none",
                    "article_type":          intel.get("article_type") or "other",
                    "icon_type":             intel.get("icon_type") or "other",
                    "tier":                  intel.get("tier") or 3,
                    "llm_relevance_score":   intel.get("relevance_score"),
                    "event_title":           intel.get("event_title"),
                    "is_breaking":           intel.get("is_breaking", False),
                    "context_summary":       intel.get("context_summary", ""),
                    "llm_extracted":         True,
                }
                # If LLM found a location and article has no coords, try geocoding
                llm_loc = intel.get("location")
                if llm_loc and not article.get("lat"):
                    _lgeos = geocode_place(llm_loc)
                    if _lgeos:
                        _lg = _lgeos[0]
                        _llat = float(_lg.get("lat", 0))
                        _llon = float(_lg.get("lon", 0))
                        if (_llat != 0.0 and _llon != 0.0
                                and _geocode_result_matches_country(_lg, intel.get("location_country"))):
                            updates["lat"] = _llat
                            updates["lon"] = _llon
                            updates["location_name"] = _lg.get("display_name")
                            updates["location_confidence"] = "llm_geocoded"
                with _NEWS_STORE_LOCK:
                    if url in _NEWS_ARTICLE_STORE:
                        _NEWS_ARTICLE_STORE[url].update(updates)
                processed += 1
            except Exception as _err:
                print(f"[backfill-intel] error on '{title[:50]}': {_err}")
            time.sleep(0.1)
        return {"total": total, "processed": processed, "remaining": total - processed}

    result = await loop.run_in_executor(_executor, _run)
    return result


# ── Horizon Snapshot fast-path endpoints ─────────────────────────────────────

_SNAPSHOT_KEYS = [
    "surface_pool", "news_points", "alerts_active", "forge_alerts",
    "fusions", "surge_events", "foresight_latest", "threat_matrix", "briefing_latest",
]

@app.get("/api/snapshot/status")
def snapshot_status():
    try:
        from database import HorizonSnapshot
        with get_db() as _db:
            rows = _db.query(HorizonSnapshot).all()
        snapshots = {}
        for r in rows:
            snapshots[r.key] = {
                "built_at":   r.built_at.isoformat() if r.built_at else None,
                "size_bytes": len(r.payload.encode("utf-8")) if r.payload else 0,
            }
        return {"snapshots": snapshots}
    except Exception as e:
        return {"snapshots": {}, "error": str(e)}

def _snapshot_endpoint(key: str):
    data, built_at = _read_snapshot(key)
    if data is None:
        return {"data": None, "built_at": None, "cache": "miss"}
    return {
        "data":     data,
        "built_at": built_at.isoformat() if built_at else None,
        "cache":    "hit",
    }

@app.get("/api/snapshot/surface_pool")
def snapshot_surface_pool():     return _snapshot_endpoint("surface_pool")

@app.get("/api/snapshot/news_points")
def snapshot_news_points():      return _snapshot_endpoint("news_points")

@app.get("/api/snapshot/alerts_active")
def snapshot_alerts_active():    return _snapshot_endpoint("alerts_active")

@app.get("/api/snapshot/forge_alerts")
def snapshot_forge_alerts():     return _snapshot_endpoint("forge_alerts")

@app.get("/api/snapshot/fusions")
def snapshot_fusions():          return _snapshot_endpoint("fusions")

@app.get("/api/snapshot/surge_events")
def snapshot_surge_events():     return _snapshot_endpoint("surge_events")

@app.get("/api/snapshot/foresight_latest")
def snapshot_foresight_latest(): return _snapshot_endpoint("foresight_latest")

@app.get("/api/snapshot/threat_matrix")
def snapshot_threat_matrix():    return _snapshot_endpoint("threat_matrix")

@app.get("/api/snapshot/briefing_latest")
def snapshot_briefing_latest():  return _snapshot_endpoint("briefing_latest")


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
        expires_at_ts = now + max(300, expires_in - 120)
        _COPERNICUS_TOKEN_CACHE["access_token"] = access_token
        _COPERNICUS_TOKEN_CACHE["expires_at"] = expires_at_ts
        with _DS_STATUS_LOCK:
            _DS_STATUS["copernicus"]["token_valid"] = True
            _DS_STATUS["copernicus"]["expires_at"] = expires_at_ts
        return access_token, None
    except Exception as ex:
        with _DS_STATUS_LOCK:
            _DS_STATUS["copernicus"]["token_valid"] = False
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
        # Accept both "type" (new sidebar) and "image_type" (legacy)
        image_type = body.get("image_type") or body.get("type", "true-colour")
        # Normalise underscore variants to dash variants used by _EVALSCRIPTS
        _TYPE_ALIASES = {
            "true_color":   "true-colour",
            "false_color":  "false-colour",
            "true_colour":  "true-colour",
            "false_colour": "false-colour",
        }
        image_type = _TYPE_ALIASES.get(image_type, image_type)
        date_str   = body.get("date")   # optional YYYY-MM-DD for exact scene

        west  = bounds.get("west");  east  = bounds.get("east")
        south = bounds.get("south"); north = bounds.get("north")
        if None in (west, east, south, north):
            return JSONResponse({"error": "bounds {north,south,east,west} required"})

        if not (_COPERNICUS_CLIENT_ID and _COPERNICUS_CLIENT_SECRET):
            return JSONResponse({"error": "Copernicus credentials not configured"})

        evalscript = _EVALSCRIPTS.get(image_type, _EVALSCRIPT_TRUE_COLOUR)

        # ── Stepped size based on bbox span ──────────────────────────────────
        lat_span = abs(north - south)
        lng_span = abs(east  - west)
        req_w = body.get("width");  req_h = body.get("height")
        if req_w and req_h:
            width  = min(2500, max(32, int(req_w)))
            height = min(2500, max(32, int(req_h)))
        else:
            max_span = max(lat_span, lng_span)
            if max_span < 0.1:
                width = height = 512
            elif max_span < 0.5:
                width = height = 1024
            else:
                width = height = 2048

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
                return JSONResponse({"error": f"Sentinel Hub auth failed: {err}"})

            resp = await client_h.post(
                _SH_PROCESS_URL,
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )

        if resp.status_code == 200:
            img_b64 = _b64.b64encode(resp.content).decode()
            return JSONResponse({
                "image":       img_b64,
                "width":       width,
                "height":      height,
                "bounds":      bounds,
                "cloud_cover": max_cloud,
                "days_back":   days_back,
                "type":        image_type,
                "image_type":  image_type,
                "date":        date_str,
            })
        else:
            detail = resp.text[:500]
            print(f"[sentinel/imagery] Process API {resp.status_code}: {detail}")
            return JSONResponse({"error": f"Sentinel Hub API error {resp.status_code}", "detail": detail})
    except Exception as e:
        print(f"[sentinel/imagery] error: {e}")
        return JSONResponse({"error": str(e)})


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
        pass

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
        "system_id": "CHOKE-001",
        "name": "Strait of Hormuz",
        "lat": 26.5, "lon": 56.4,
        "polygon_bounds": [25.5, 54.5, 27.5, 58.0],
        "polygon": [
            [26.45496154043563, 54.83213569539235],
            [25.62912825527243, 55.52895334532315],
            [25.71044862071026, 55.72679300972084],
            [25.79953536826465, 55.90109489656296],
            [26.24514555342548, 56.15666659083359],
            [26.40922350596732, 56.3299940862639],
            [26.3964600334261, 56.50116360535718],
            [25.78613938664508, 56.40104632562489],
            [25.72043798434647, 56.30632981956199],
            [25.62886265873773, 56.31013287567782],
            [25.60136076724721, 56.37607080497331],
            [25.79261153921045, 57.26546343441144],
            [26.45344306385928, 57.04353309698143],
            [26.69763197669941, 57.05494216697125],
            [27.00331720861606, 56.85073337871168],
            [27.15332810522341, 56.60249140917256],
            [27.16066113686722, 56.28916313118259],
            [26.96212109618719, 56.2969550376506],
            [26.6897638845019, 55.96251130873996],
            [26.65141236431435, 55.69120843437669],
            [26.5370442064279, 55.27921797942465],
            [26.7153487533384, 55.1565909104791],
            [26.45496154043563, 54.83213569539235],
        ],
        "strategic_description": "Controls ~20% of global oil trade. Connects Persian Gulf to Gulf of Oman.",
        "monitored_keywords": ["Strait of Hormuz", "Hormuz", "Persian Gulf shipping"],
    },
    {
        "system_id": "CHOKE-002",
        "name": "Suez Canal",
        "lat": 30.5, "lon": 32.4,
        "polygon_bounds": [29.9, 32.2, 31.3, 32.7],
        "polygon": [
            [31.24467953516879, 32.30118564352306],
            [31.10444844717359, 32.30266712109401],
            [30.80112184420241, 32.31241890568655],
            [30.771529882314, 32.31769525385681],
            [30.69935928763639, 32.3410586403492],
            [30.64043251078027, 32.32499809158347],
            [30.56053848920329, 32.30515017340799],
            [30.51175260982979, 32.33758885764722],
            [30.45545585601027, 32.34584231038237],
            [30.40964649965364, 32.34650692017977],
            [30.40174645750083, 32.31128000949985],
            [30.36055735738074, 32.30493355239871],
            [30.33243303790832, 32.30741471414107],
            [30.28525655024196, 32.3484845479605],
            [30.23431241938055, 32.52026666468875],
            [30.18890421799261, 32.56194321131943],
            [30.10920680317747, 32.56861033749613],
            [30.05730470037089, 32.56979855178427],
            [30.00808799718977, 32.57955539787641],
            [29.95531862419705, 32.58055201240585],
            [29.93213842683943, 32.55819885034602],
            [29.92748990605539, 32.56313377865743],
            [29.95089206947766, 32.58510266856214],
            [29.98532282429323, 32.58840318772711],
            [30.04920485337975, 32.57498635319865],
            [30.20625732195517, 32.57672604398426],
            [30.24742073227144, 32.54900164308022],
            [30.28320307720908, 32.45407019231271],
            [30.33684297489516, 32.44493500811471],
            [30.3938560625594, 32.38186733971607],
            [30.41334227130125, 32.36398268780024],
            [30.45062059695007, 32.36084340203232],
            [30.59188803843862, 32.33250562178453],
            [30.70125381276034, 32.3531332886747],
            [30.7320589672356, 32.34267613096305],
            [30.80926545054388, 32.3199931791247],
            [30.90170031099978, 32.31657360578762],
            [31.10238256575503, 32.31285084399367],
            [31.15245160429606, 32.3431634716665],
            [31.23457925272847, 32.36259092067413],
            [31.27016639174261, 32.32068545323914],
            [31.24467953516879, 32.30118564352306],
        ],
        "strategic_description": "Connects Mediterranean to Red Sea. ~12% of global trade, 1 million barrels of oil daily.",
        "monitored_keywords": ["Suez Canal", "Suez", "Suez blockage"],
    },
    {
        "system_id": "CHOKE-003",
        "name": "Bab el-Mandeb",
        "lat": 12.6, "lon": 43.4,
        "polygon_bounds": [11.5, 42.5, 13.5, 44.5],
        "polygon": [
            [12.45282966953583, 43.34088705310668],
            [12.2592158104991, 43.40206416128849],
            [12.63854697332219, 43.90002988027648],
            [12.73638629255974, 43.58739652399679],
            [12.67122393193894, 43.52401379258128],
            [12.68330267438698, 43.44441667452298],
            [12.82938267612522, 43.47457299482402],
            [13.06441340874839, 43.32384562213154],
            [12.92185541197779, 43.02883683715334],
            [12.45282966953583, 43.34088705310668],
        ],
        "strategic_description": "Gateway between Red Sea and Gulf of Aden. Key oil and LNG route linking Europe and Asia.",
        "monitored_keywords": ["Bab el-Mandeb", "Bab-el-Mandeb", "Red Sea strait", "Houthi shipping"],
    },
    {
        "system_id": "CHOKE-004",
        "name": "Strait of Malacca",
        "lat": 3.0, "lon": 103.5,
        "polygon_bounds": [1.0, 99.0, 6.0, 105.0],
        "polygon": [
            [1.995403060916556, 101.3624273521426],
            [2.083625611348094, 101.5045581333199],
            [2.134116603907936, 101.655748392181],
            [1.954353485630168, 101.7710047625645],
            [1.727040442697845, 101.6612499048179],
            [1.535280572315169, 101.9277882377807],
            [1.614334128810148, 102.0313954292689],
            [1.510309274399511, 102.4845736402618],
            [1.154971015725261, 102.4784289388365],
            [1.080619115062463, 102.6295256852913],
            [1.176953390161864, 102.7632901351257],
            [1.092518912414125, 103.0105365518487],
            [0.8567051701589243, 103.1784768127406],
            [1.249973584563105, 103.5304631695499],
            [1.507947230213522, 103.3992882051806],
            [1.751146305847749, 102.9745458365892],
            [1.832268623693282, 102.9050062272656],
            [1.880505779743753, 102.6945624199714],
            [2.08311458158521, 102.5051097788774],
            [2.241846096658057, 102.1052784502246],
            [2.354302062008842, 102.0735104747048],
            [2.444304028509836, 101.8750307743647],
            [2.604161335632954, 101.7799562424357],
            [2.619483854265792, 101.6555069304043],
            [2.744079748142226, 101.4458508665666],
            [2.335213753222361, 101.0587264733385],
            [1.995403060916556, 101.3624273521426],
        ],
        "strategic_description": "World's most important shipping lane; ~80% of China's oil imports pass through.",
        "monitored_keywords": ["Strait of Malacca", "Malacca", "Malacca Strait", "South China Sea"],
    },
    {
        "system_id": "CHOKE-005",
        "name": "Strait of Gibraltar",
        "lat": 35.9, "lon": -5.6,
        "polygon_bounds": [35.7, -6.2, 36.2, -5.0],
        "polygon": [
            [36.16969788139049, -6.035405613830781],
            [35.79296107573852, -5.927298191933326],
            [35.79098065791726, -5.801480348189159],
            [35.77837608305592, -5.794074385423738],
            [35.78026076601697, -5.774970777177812],
            [35.80188526726089, -5.749520345752559],
            [35.81721480445081, -5.751334476196286],
            [35.83912281717355, -5.688019900682974],
            [35.82852935914157, -5.649745620872581],
            [35.8353771648917, -5.62461357377693],
            [35.82979628131852, -5.598947693104485],
            [35.84662687536444, -5.564522266714106],
            [35.84859484369717, -5.55019545792912],
            [35.85642494247169, -5.543376635855246],
            [35.86831977918222, -5.543351522189929],
            [35.90893138184412, -5.482361159408562],
            [35.91600388322919, -5.461826469925172],
            [35.91025745443972, -5.438417057715917],
            [35.91660867663568, -5.419402779205178],
            [35.92122388621294, -5.404882258839746],
            [35.91654775399325, -5.370238757448799],
            [35.89801467530137, -5.335534810346258],
            [35.89829188472393, -5.322928622702228],
            [35.89526194075059, -5.300747554202979],
            [35.90449386549779, -5.289595017012479],
            [36.11392401289902, -5.342567760419374],
            [36.13535602615911, -5.365227278059528],
            [36.15855915300806, -5.368410877949189],
            [36.17742395123273, -5.387858326500204],
            [36.17864287128715, -5.411169734191529],
            [36.17137957324005, -5.4306738378754],
            [36.15478987186889, -5.442313855716526],
            [36.09116654397025, -5.44133561870594],
            [36.08153230031679, -5.42805875377899],
            [36.06869789741123, -5.432550870585952],
            [36.06857340047181, -5.442378863331418],
            [36.0625081116256, -5.444406034717332],
            [36.05576417144426, -5.450762284045209],
            [36.0530139880423, -5.461022215625114],
            [36.05146892553353, -5.468288725113188],
            [36.05438887081029, -5.483481961954885],
            [36.04474473658151, -5.501498539255895],
            [36.00860483553978, -5.603734326168897],
            [36.04194658369207, -5.63550358229462],
            [36.05586765661424, -5.664613467039273],
            [36.06564451445028, -5.689481490755136],
            [36.06122005838835, -5.711682518509454],
            [36.06762302979691, -5.735747797118039],
            [36.08207974956557, -5.764067225751237],
            [36.08857318242396, -5.777332161284754],
            [36.08592172786875, -5.787024262479339],
            [36.07872985906487, -5.798543859905435],
            [36.18768613139926, -5.918700129050296],
            [36.16969788139049, -6.035405613830781],
        ],
        "strategic_description": "Atlantic–Mediterranean gateway. Critical NATO maritime passage.",
        "monitored_keywords": ["Strait of Gibraltar", "Gibraltar", "Mediterranean gateway"],
    },
    {
        "system_id": "CHOKE-006",
        "name": "Turkish Straits / Bosphorus",
        "lat": 41.1, "lon": 29.0,
        "polygon_bounds": [40.9, 28.5, 41.6, 29.5],
        "polygon": [
            [41.00183517612999, 28.9780438430991],
            [40.99097889189881, 29.01641998184357],
            [40.99628515876343, 29.0217233162115],
            [41.00708545461207, 29.0105027185846],
            [41.02329376279454, 29.00768839856096],
            [41.04899179390036, 29.05131157372387],
            [41.06092609358404, 29.05188092044294],
            [41.06479018703362, 29.05740297162058],
            [41.07309177309634, 29.05532666160786],
            [41.07674593886497, 29.06485185149258],
            [41.09972817671526, 29.06592403152596],
            [41.10685455355238, 29.07377137368994],
            [41.10767280488813, 29.08244108411187],
            [41.11664285856101, 29.09129330994934],
            [41.12115506679033, 29.09848603278806],
            [41.13306726081378, 29.09349743627364],
            [41.14214172479985, 29.07371310571971],
            [41.15480527757245, 29.07896513451845],
            [41.16092685844536, 29.07353002821221],
            [41.17865783038553, 29.08662454874344],
            [41.18616439078247, 29.11634582274278],
            [41.19986967325682, 29.11892008691665],
            [41.20842633015301, 29.1307447235254],
            [41.21491624592427, 29.15058890460756],
            [41.21770450834848, 29.16207194154452],
            [41.2240528893672, 29.16760745524388],
            [41.23540273019233, 29.11331338198456],
            [41.21761839598113, 29.1061485188099],
            [41.21200116991822, 29.11034556851538],
            [41.19810655909332, 29.08893959883229],
            [41.18251821071844, 29.07608538938084],
            [41.173585919239, 29.07141986358718],
            [41.1698359811989, 29.05873057394504],
            [41.1575681081961, 29.03526451932171],
            [41.12913129630033, 29.06731754300153],
            [41.12108564767902, 29.07229165536265],
            [41.11455971117401, 29.06028182856074],
            [41.09623936108552, 29.05342838592923],
            [41.0840105497699, 29.05713364778731],
            [41.07848487099551, 29.0444356913817],
            [41.06912720454634, 29.04618027439583],
            [41.06186410740047, 29.03853294722292],
            [41.05116932513615, 29.03403032154246],
            [41.03700913438475, 28.99583433514965],
            [41.02489261463676, 28.98310992214029],
            [41.0181463980358, 28.98564609213615],
            [41.00183517612999, 28.9780438430991],
        ],
        "strategic_description": "Black Sea access. Turkey controls passage under Montreux Convention.",
        "monitored_keywords": ["Bosphorus", "Turkish Straits", "Dardanelles", "Black Sea access"],
    },
    {
        "system_id": "CHOKE-007",
        "name": "Danish Straits",
        "lat": 56.0, "lon": 10.5,
        "polygon_bounds": [55.0, 9.0, 58.0, 12.5],
        "polygon": [
            [56.11591536511848, 12.35848251007932],
            [56.10228351905172, 12.38507180079433],
            [56.100296939267, 12.40949905154289],
            [56.09429655717405, 12.42981759427206],
            [56.08876460754731, 12.51569318471632],
            [56.04027868148, 12.62422116168639],
            [56.06483340616344, 12.67797831365115],
            [56.14558228473325, 12.56980900001729],
            [56.24952485717788, 12.52444538500705],
            [56.12870051988068, 12.31560362737501],
            [56.11591536511848, 12.35848251007932],
        ],
        "strategic_description": "Baltic Sea access connecting to North Sea. Critical for Russian Baltic Fleet.",
        "monitored_keywords": ["Danish Straits", "Øresund", "Sound", "Kattegat", "Baltic access"],
    },
    {
        "system_id": "CHOKE-008",
        "name": "Strait of Lombok",
        "lat": -8.7, "lon": 115.7,
        "polygon_bounds": [-9.0, 115.3, -8.0, 116.2],
        "polygon": [
            [-8.0, 115.5], [-8.0, 116.0], [-8.5, 116.2],
            [-9.0, 116.2], [-9.0, 115.4], [-8.5, 115.3], [-8.0, 115.5],
        ],
        "strategic_description": "Indonesian alternative to Malacca for deep-draft vessels.",
        "monitored_keywords": ["Strait of Lombok", "Lombok Strait", "Indonesian straits"],
    },
    {
        "system_id": "CHOKE-009",
        "name": "Mozambique Channel",
        "lat": -17.0, "lon": 40.5,
        "polygon_bounds": [-26.0, 35.0, -10.0, 47.0],
        "polygon": [
            [-15.55516958546517, 40.52950878218399],
            [-16.98180876304449, 39.07256617180247],
            [-17.55584441299782, 37.35587209036758],
            [-18.89703140346284, 36.0994733864559],
            [-20.18303713778162, 34.83951823502701],
            [-22.52950196015883, 35.59583665184374],
            [-21.92548839631508, 43.19107967360961],
            [-21.73650738161318, 43.33563582682436],
            [-21.62037052198124, 43.44981037290505],
            [-21.4262142583079, 43.42406596025938],
            [-21.28499691869615, 43.50012838622695],
            [-21.22192848086553, 43.69514865619925],
            [-20.14315677246857, 44.38976428815526],
            [-19.53399120419083, 44.38340800229093],
            [-18.4946276248469, 44.00507136001883],
            [-17.33663286520624, 43.98476157831375],
            [-16.14731333622495, 44.54622685982573],
            [-15.92642891162515, 45.30291037400602],
            [-15.5929418609849, 46.31901878246733],
            [-15.00265445729084, 47.10238319626129],
            [-14.34483097884362, 47.65825733029556],
            [-12.59503828677731, 40.59596509151854],
            [-15.55516958546517, 40.52950878218399],
        ],
        "strategic_description": "Connects Indian Ocean south of Africa. Major oil tanker route.",
        "monitored_keywords": ["Mozambique Channel", "Mozambique", "Mozambique shipping"],
    },
    {
        "system_id": "CHOKE-010",
        "name": "Cape of Good Hope",
        "lat": -34.4, "lon": 18.5,
        "polygon_bounds": [-35.5, 17.5, -33.5, 20.0],
        "polygon": [
            [-39.36100834636292, 13.9754436926137],
            [-39.41023626047757, 27.84578238477849],
            [-34.07138744246208, 25.64916230285606],
            [-33.97468290669521, 25.0299445134626],
            [-34.27120780582721, 24.73024905553254],
            [-33.98337608141084, 23.89930682226183],
            [-34.11683293512792, 23.35377385525357],
            [-33.99414379797566, 22.6047361045455],
            [-34.40520702350582, 21.69709340658492],
            [-34.85114583186469, 19.93440595057201],
            [-34.64379832542308, 19.37807166302456],
            [-34.42994736161411, 19.03603203892176],
            [-34.38156821895332, 18.49635581440023],
            [-34.14520023162071, 18.27788810509916],
            [-33.61593792288365, 18.35874488213614],
            [-33.03036829065508, 17.85556922494347],
            [-39.36100834636292, 13.9754436926137],
        ],
        "strategic_description": "Alternative route to Suez for very large crude carriers; used when Suez is unavailable.",
        "monitored_keywords": ["Cape of Good Hope", "Cape Route", "South Africa shipping"],
    },
    {
        "system_id": "CHOKE-011",
        "name": "Panama Canal",
        "lat": 9.0, "lon": -79.7,
        "polygon_bounds": [8.7, -80.2, 9.5, -79.2],
        "polygon": [
            [8.922558325696906, -79.5600247753524],
            [8.931853777310277, -79.54543273718842],
            [8.948950991463327, -79.56721817692063],
            [8.951029998968187, -79.56608839217148],
            [8.953402148031657, -79.56804260208035],
            [8.956787888685735, -79.56451973664383],
            [8.963799557007874, -79.57036115311588],
            [8.967191662163359, -79.57377827111537],
            [8.985629232100949, -79.5799843732633],
            [8.990755350612462, -79.58363036507528],
            [8.994320357567352, -79.5874254981766],
            [9.008752964153432, -79.59804372602721],
            [9.013521979671495, -79.60158482627803],
            [9.027804719654773, -79.62677278793051],
            [9.0408903029647, -79.64461799581059],
            [9.053486625215831, -79.65319987914553],
            [9.058614083505494, -79.65697688723745],
            [9.067236789151234, -79.66792818684203],
            [9.070472620867397, -79.67068699458228],
            [9.079079488624137, -79.67461391776105],
            [9.08691395194259, -79.67840062521951],
            [9.10655055148162, -79.6886249729635],
            [9.108969226232126, -79.6907377648627],
            [9.118937715572944, -79.70668882433978],
            [9.123653657889662, -79.73939026055311],
            [9.12346338245665, -79.75242468655843],
            [9.118655277004672, -79.76518199734301],
            [9.116566255684397, -79.77015807907614],
            [9.116887086192358, -79.7745314880365],
            [9.12188195860826, -79.77646892359679],
            [9.122192110303134, -79.78619213145181],
            [9.119923146223153, -79.78656679887578],
            [9.120903687112891, -79.79417076215177],
            [9.126928350903615, -79.80053134802057],
            [9.133574008834154, -79.79793195223618],
            [9.137223953049878, -79.79650662346769],
            [9.157304576187849, -79.79548926108653],
            [9.159008958945765, -79.80644172419345],
            [9.171826953776774, -79.80439885853386],
            [9.176855332435974, -79.80614229690376],
            [9.180942115637308, -79.7991274388739],
            [9.186982012256566, -79.80621311828763],
            [9.17956132488896, -79.83122334989723],
            [9.187242751498459, -79.84096534948991],
            [9.189591308970455, -79.84835979153458],
            [9.184749595749146, -79.85679604389075],
            [9.264301032174645, -79.9097769221779],
            [9.311377221141806, -79.9166925580024],
            [9.318143324628142, -79.91026578942],
            [9.32517400566279, -79.90737772841449],
            [9.327922288511525, -79.91188342066366],
            [9.33101555574501, -79.91042339248598],
            [9.33385645667601, -79.91366482242279],
            [9.344495969880729, -79.90584959981668],
            [9.350567957480164, -79.90767598694138],
            [9.35232074331736, -79.91386461773634],
            [9.355652954545675, -79.91502454911007],
            [9.354658608095287, -79.90616238912305],
            [9.35690833557582, -79.90526806189496],
            [9.363839075263346, -79.90823898064143],
            [9.367427104069744, -79.90282611958546],
            [9.365636648493926, -79.89402466395522],
            [9.396765858714671, -79.88500701271455],
            [9.374438598164621, -79.95152146141261],
            [9.360062521470429, -79.94971211262005],
            [9.340090970092264, -79.95007994484838],
            [9.326807545365979, -79.94672093543356],
            [9.32130079510765, -79.95146328529766],
            [9.313731622337258, -79.94684406312403],
            [9.30995101796678, -79.93659322436233],
            [9.314399378285797, -79.92658868124229],
            [9.309901731389534, -79.92198600200518],
            [9.267064580000499, -79.92469847824539],
            [9.179326091084143, -79.86477423780801],
            [9.174765001674796, -79.86146912344979],
            [9.177266138956346, -79.85130170731196],
            [9.182035734701367, -79.84742189492503],
            [9.177294597094136, -79.84249649879668],
            [9.171986058761503, -79.84162469324079],
            [9.175370301702225, -79.83443179007554],
            [9.165314199958612, -79.83684594308306],
            [9.163501019866526, -79.83041171866601],
            [9.164718373589988, -79.82466243151107],
            [9.16230007504752, -79.81973328500949],
            [9.152714316847735, -79.82240364673839],
            [9.120161864928614, -79.81123121173114],
            [9.106521007746149, -79.8041928813484],
            [9.099008845998048, -79.79178560387801],
            [9.110250057917758, -79.78776183258745],
            [9.11188249478349, -79.77549815391153],
            [9.106314350384373, -79.76985187689206],
            [9.097782020581272, -79.7525445727651],
            [9.099349423610308, -79.74899892599538],
            [9.114791132959322, -79.75825240927664],
            [9.117780388707176, -79.75132446524236],
            [9.105605735570293, -79.74546812372847],
            [9.117187886576588, -79.74252155646164],
            [9.117427388902113, -79.73637582728561],
            [9.107884200092855, -79.72470263913984],
            [9.11376530177264, -79.71820282378074],
            [9.106445547635884, -79.69477223786662],
            [9.0870938925432, -79.68083682312687],
            [9.065883251662994, -79.67113290283605],
            [9.056832688298233, -79.65961535592345],
            [9.036967814342962, -79.64378749706519],
            [9.020893573236382, -79.62468263480933],
            [9.011970226818523, -79.61680969359448],
            [8.994802017549917, -79.60154198896723],
            [8.985728144349007, -79.59480333062587],
            [8.963568878897322, -79.57727495342266],
            [8.955385890118324, -79.57367363423867],
            [8.943265545860497, -79.57100008519329],
            [8.9416984688374, -79.56796816972714],
            [8.930524511426032, -79.56213190221783],
            [8.922558325696906, -79.5600247753524],
        ],
        "strategic_description": "Connects Atlantic and Pacific. Handles ~6% of global sea trade; drought-impacted in 2023.",
        "monitored_keywords": ["Panama Canal", "Panama", "Panama Canal restrictions"],
    },
    {
        "system_id": "CHOKE-012",
        "name": "Luzon Strait",
        "lat": 20.5, "lon": 121.5,
        "polygon_bounds": [19.0, 119.5, 22.0, 122.5],
        "polygon": [
            [19.5, 120.0], [19.5, 122.0], [20.5, 122.5],
            [22.0, 122.0], [22.0, 120.5], [21.0, 119.5], [19.5, 120.0],
        ],
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


@app.get("/api/chokepoints")
def api_chokepoints_geojson():
    """Return all chokepoints as a GeoJSON FeatureCollection with Polygon geometry."""
    features = []
    for cp in _CHOKEPOINT_DEFS:
        poly = cp.get("polygon")
        if not poly or len(poly) < 3:
            # fall back to bbox rectangle from polygon_bounds
            pb = cp.get("polygon_bounds")
            if pb and len(pb) == 4:
                s, w, n, e = pb
                poly = [[w, s], [e, s], [e, n], [w, n], [w, s]]
        if poly:
            # _CHOKEPOINT_DEFS stores [lat, lon]; GeoJSON requires [lon, lat]
            coords = [[c[1], c[0]] for c in poly]
            if coords[0] != coords[-1]:
                coords = coords + [coords[0]]
            geometry = {"type": "Polygon", "coordinates": [coords]}
        else:
            geometry = None
        features.append({
            "type": "Feature",
            "geometry": geometry,
            "properties": {
                "name":                    cp.get("name"),
                "lat":                     cp.get("lat"),
                "lon":                     cp.get("lon"),
                "strategic_description":   cp.get("strategic_description", ""),
                "monitored_keywords":      cp.get("monitored_keywords", []),
                "threat_level":            cp.get("threat_level", "standard"),
            },
        })
    return {"type": "FeatureCollection", "features": features}


@app.get("/api/chokepoints/{chokepoint_id}/status")
async def api_chokepoint_status(chokepoint_id: str):
    """Return live status + satellite image for a single chokepoint."""
    cp = next((c for c in _CHOKEPOINT_DEFS
               if c.get("system_id") == chokepoint_id
               or c.get("id") == chokepoint_id
               or c.get("name", "").lower().replace(" ", "-") == chokepoint_id.lower()), None)
    if not cp:
        raise HTTPException(status_code=404, detail=f"Chokepoint '{chokepoint_id}' not found")

    loop   = asyncio.get_event_loop()
    result = await loop.run_in_executor(_executor, lambda: _compute_chokepoint_status(cp))

    try:
        from chokepoint_images import fetch_chokepoint_image as _cpimg_async
        img_url, img_caption = await _cpimg_async(cp["name"])
    except Exception:
        img_url, img_caption = None, None

    return {
        **result,
        "chokepoint_id": chokepoint_id,
        "system_id":     cp.get("system_id"),
        "name":          cp.get("name"),
        "lat":           cp.get("lat"),
        "lon":           cp.get("lon"),
        "image_url":     img_url,
        "image_caption": img_caption,
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

    # Attach any existing chokepoint briefs + satellite imagery (from cache only — sync path)
    try:
        from chokepoint_images import _image_cache as _cpimg_cache
    except ImportError:
        _cpimg_cache = {}

    with _AUTO_BRIEF_LOCK:
        enriched = []
        for cp in results:
            name       = cp.get("name", "")
            status     = cp.get("current_status", "normal")
            store_key  = f"cp_{name}_{status}"
            entry      = _CHOKEPOINT_BRIEF_STORE.get(store_key)
            if entry:
                cp = {**cp, "auto_brief": entry["brief"], "auto_brief_at": entry["generated_at"]}
            # Attach cached satellite image if available
            if name in _cpimg_cache:
                img_url, img_caption = _cpimg_cache[name]
                cp = {**cp, "image_url": img_url, "image_caption": img_caption}
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
        except FileNotFoundError:
            print("[pipelines] pipelines.json not found — skipping (will fetch from remote)")
            _PIPELINES_DATA = {"pipelines": []}
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
except FileNotFoundError:
    print("[shipping_routes] shipping_routes.json not found — skipping")
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
    response: FastAPIResponse,
    name:     str   = Query(None, description="Fuzzy name search"),
    country:  str   = Query(None, description="Filter cables landing in country (name substring)"),
    near_lat: float = Query(None),
    near_lon: float = Query(None),
    radius:   float = Query(200, description="Search radius in km for landing points"),
):
    """Query submarine cables by name, country, or proximity of landing points."""
    if not name and not country and near_lat is None:
        response.headers["Cache-Control"] = "public, max-age=3600"
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


# ── Endpoints: Cables (database-backed) ───────────────────────────────────────

def _cable_feature(row) -> dict:
    return {
        "type": "Feature",
        "geometry": row.geometry,
        "properties": {
            "cable_id":          row.cable_id,
            "cable_name":        row.cable_name,
            "system_id":         row.system_id,
            "infra_type":        row.infra_type,
            "region_id":         row.region_id,
            "owners":            row.owners,
            "rfs_year":          row.rfs_year,
            "length_km":         row.length_km,
            "country_a":         row.country_a,
            "country_b":         row.country_b,
            "all_countries":     row.all_countries,
            "landing_point_ids": row.landing_point_ids,
        },
    }


@app.get("/api/cables")
def api_cables_db(response: FastAPIResponse):
    """Return all submarine cables as a GeoJSON FeatureCollection (DB-backed)."""
    from database import CableSegment, get_db
    response.headers["Cache-Control"] = "public, max-age=3600"
    with get_db() as db:
        rows = db.query(CableSegment).all()
    features = [_cable_feature(r) for r in rows]
    return {"type": "FeatureCollection", "features": features, "total": len(features)}


@app.get("/api/cables/landing-points")
def api_landing_points(response: FastAPIResponse):
    """Return all cable landing points as a GeoJSON FeatureCollection (DB-backed)."""
    from database import LandingPoint, get_db
    response.headers["Cache-Control"] = "public, max-age=3600"
    with get_db() as db:
        rows = db.query(LandingPoint).all()
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [row.longitude, row.latitude]},
            "properties": {
                "landing_point_id": row.landing_point_id,
                "name":             row.name,
                "country":          row.country,
                "cable_ids":        [c.strip() for c in row.cable_ids.split(",")] if row.cable_ids else [],
            },
        }
        for row in rows
    ]
    return {"type": "FeatureCollection", "features": features, "total": len(features)}


@app.get("/api/cables/landing-points/{landing_point_id:path}")
def api_landing_point_by_id(landing_point_id: str):
    """Return a single landing point by landing_point_id."""
    from database import LandingPoint, get_db
    with get_db() as db:
        row = db.query(LandingPoint).filter(LandingPoint.landing_point_id == landing_point_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Landing point '{landing_point_id}' not found")
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [row.longitude, row.latitude]},
        "properties": {
            "landing_point_id": row.landing_point_id,
            "name":             row.name,
            "country":          row.country,
            "cable_ids":        [c.strip() for c in row.cable_ids.split(",")] if row.cable_ids else [],
        },
    }


@app.get("/api/cables/by-country/{country_name}")
def api_cables_by_country(country_name: str, response: FastAPIResponse):
    """Return all cables touching the given country as a GeoJSON FeatureCollection."""
    from database import CableSegment, get_db
    response.headers["Cache-Control"] = "public, max-age=600"
    search = country_name.lower()
    with get_db() as db:
        rows = db.query(CableSegment).filter(
            CableSegment.all_countries.ilike(f"%{search}%")
        ).all()
    features = [_cable_feature(r) for r in rows]
    return {"type": "FeatureCollection", "features": features, "total": len(features)}


@app.get("/api/cables/regions")
def api_cables_regions(response: FastAPIResponse):
    """Return all region definitions (id, name, description)."""
    from database import RegionDefinition, get_db
    response.headers["Cache-Control"] = "public, max-age=3600"
    with get_db() as db:
        rows = db.query(RegionDefinition).order_by(RegionDefinition.region_id).all()
    return {
        "regions": [
            {"region_id": r.region_id, "region_name": r.region_name, "description": r.description}
            for r in rows
        ],
        "total": len(rows),
    }


@app.get("/api/cables/{cable_id}")
def api_cable_by_id(cable_id: str):
    """Return a single submarine cable by cable_id as a GeoJSON Feature (DB-backed)."""
    from database import CableSegment, get_db
    with get_db() as db:
        row = db.query(CableSegment).filter(CableSegment.cable_id == cable_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Cable '{cable_id}' not found")
    return _cable_feature(row)


# ══════════════════════════════════════════════════════════════════════════════
# PORTS — PortBoundary endpoints
# ══════════════════════════════════════════════════════════════════════════════

def _port_feature(row) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [row.longitude, row.latitude]},
        "properties": {
            "system_id":              row.system_id,
            "port_name":              row.port_name,
            "country":                row.country,
            "locode":                 row.locode,
            "region_id":              row.region_id,
            "port_size":              row.port_size,
            "boundary_radius_metres": row.boundary_radius_metres,
            "infra_type":             row.infra_type,
        },
    }


import math as _math_ports
# _haversine_m is defined once above (canonical definition — see def _haversine_m near _haversine)


@app.get("/api/ports")
def api_ports(response: FastAPIResponse):
    """All ports as GeoJSON FeatureCollection."""
    from database import PortBoundary, get_db
    response.headers["Cache-Control"] = "public, max-age=3600"
    with get_db() as db:
        rows = db.query(PortBoundary).all()
    return {"type": "FeatureCollection", "features": [_port_feature(r) for r in rows], "total": len(rows)}


@app.get("/api/ports/near")
def api_ports_near(
    lat: float = Query(...),
    lon: float = Query(...),
    radius_km: float = Query(50.0),
):
    """Return all ports within radius_km of (lat, lon)."""
    from database import PortBoundary, get_db
    radius_m = radius_km * 1000
    # Rough bounding box filter first, then precise haversine
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * _math_ports.cos(_math_ports.radians(lat)) + 0.0001)
    with get_db() as db:
        candidates = db.query(PortBoundary).filter(
            PortBoundary.latitude.between(lat - dlat, lat + dlat),
            PortBoundary.longitude.between(lon - dlon, lon + dlon),
        ).all()
    nearby = [r for r in candidates if _haversine_m(lat, lon, r.latitude, r.longitude) <= radius_m]
    return {"type": "FeatureCollection", "features": [_port_feature(r) for r in nearby], "total": len(nearby)}


@app.post("/api/ports/check-in-boundary")
async def api_ports_check_in_boundary(request: Request):
    """
    Check if a position falls within any port's boundary_radius_metres.
    Body: { lat, lon }
    Returns: { in_port: bool, port: null | {system_id, port_name, country, boundary_radius_metres} }
    """
    from database import PortBoundary, get_db
    body = await request.json()
    lat  = float(body.get("lat", 0))
    lon  = float(body.get("lon", 0))

    # Coarse bbox: max boundary = 15 km → ~0.135 deg lat
    dlat = 0.14
    dlon = 0.20
    with get_db() as db:
        candidates = db.query(PortBoundary).filter(
            PortBoundary.latitude.between(lat - dlat, lat + dlat),
            PortBoundary.longitude.between(lon - dlon, lon + dlon),
        ).all()

    for port in candidates:
        dist_m = _haversine_m(lat, lon, port.latitude, port.longitude)
        if dist_m <= port.boundary_radius_metres:
            return {
                "in_port": True,
                "port": {
                    "system_id":              port.system_id,
                    "port_name":              port.port_name,
                    "country":                port.country,
                    "boundary_radius_metres": port.boundary_radius_metres,
                    "distance_metres":        round(dist_m),
                },
            }
    return {"in_port": False, "port": None}


@app.get("/api/ports/by-region/{region_id}")
def api_ports_by_region(region_id: str, response: FastAPIResponse):
    """All ports in a given region."""
    from database import PortBoundary, get_db
    response.headers["Cache-Control"] = "public, max-age=3600"
    with get_db() as db:
        rows = db.query(PortBoundary).filter(PortBoundary.region_id == region_id).all()
    return {"type": "FeatureCollection", "features": [_port_feature(r) for r in rows], "total": len(rows)}


@app.get("/api/ports/in-viewport")
def api_ports_in_viewport(
    min_lat: float = Query(...),
    max_lat: float = Query(...),
    min_lon: float = Query(...),
    max_lon: float = Query(...),
    response: FastAPIResponse = None,
):
    """Ports within a viewport bounding box — max 200, very-large first."""
    from database import PortBoundary, get_db
    from sqlalchemy import case
    if response:
        response.headers["Cache-Control"] = "public, max-age=30"
    size_order = case(
        (PortBoundary.port_size == "Very Large", 0),
        (PortBoundary.port_size == "Large",      1),
        (PortBoundary.port_size == "Medium",      2),
        else_=3,
    )
    with get_db() as db:
        rows = (
            db.query(PortBoundary)
            .filter(
                PortBoundary.latitude .between(min_lat, max_lat),
                PortBoundary.longitude.between(min_lon, max_lon),
            )
            .order_by(size_order)
            .limit(200)
            .all()
        )
    return {"type": "FeatureCollection", "features": [_port_feature(r) for r in rows]}


@app.get("/api/ports/{system_id}")
def api_port_by_system_id(system_id: str):
    """Single port by system_id."""
    from database import PortBoundary, get_db
    with get_db() as db:
        row = db.query(PortBoundary).filter(PortBoundary.system_id == system_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Port '{system_id}' not found")
    return _port_feature(row)


# ── Endpoints: Airports ───────────────────────────────────────────────────────

def _airport_feature(row) -> dict:
    import json as _json_apt
    meta = {}
    try:
        meta = _json_apt.loads(row.airport_metadata) if row.airport_metadata else {}
    except Exception:
        pass
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [row.longitude, row.latitude]},
        "properties": {
            "system_id":    row.system_id,
            "ident":        row.ident,
            "icao_code":    row.icao_code,
            "iata_code":    row.iata_code,
            "airport_name": row.airport_name,
            "airport_type": row.airport_type,
            "country_code": row.country_code,
            "country_name": row.country_name,
            "region_id":    row.region_id,
            "municipality": row.municipality,
            "elevation_ft": row.elevation_ft,
            "infra_type":   row.infra_type,
            **{k: v for k, v in meta.items() if k not in ("lat", "lon")},
        },
    }


@app.get("/api/airports")
def api_airports(
    response: FastAPIResponse,
    type:         str = Query(None, description="Filter by airport_type"),
    region_id:    str = Query(None, description="Filter by region_id"),
    country_code: str = Query(None, description="Filter by ISO-2 country code"),
):
    """All airports as GeoJSON FeatureCollection, with optional filters."""
    from database import Airport, get_db
    response.headers["Cache-Control"] = "public, max-age=300"
    with get_db() as db:
        q = db.query(Airport)
        if type:
            q = q.filter(Airport.airport_type == type)
        if region_id:
            q = q.filter(Airport.region_id == region_id)
        if country_code:
            q = q.filter(Airport.country_code == country_code.upper())
        rows = q.all()
    return {"type": "FeatureCollection", "features": [_airport_feature(r) for r in rows]}


@app.get("/api/airports/search")
def api_airports_search(q: str = Query(..., description="Name, ICAO, IATA, or municipality")):
    """Search airports by name, ICAO, IATA, or municipality — top 20 matches."""
    from database import Airport, get_db
    from sqlalchemy import or_
    term = f"%{q.strip()}%"
    with get_db() as db:
        rows = (
            db.query(Airport)
            .filter(or_(
                Airport.airport_name.ilike(term),
                Airport.icao_code.ilike(term),
                Airport.iata_code.ilike(term),
                Airport.municipality.ilike(term),
                Airport.ident.ilike(term),
            ))
            .limit(20)
            .all()
        )
    return {"type": "FeatureCollection", "features": [_airport_feature(r) for r in rows]}


@app.get("/api/airports/near")
def api_airports_near(
    lat:       float = Query(...),
    lon:       float = Query(...),
    radius_km: float = Query(50.0),
):
    """All airports within radius_km of a point."""
    from database import Airport, get_db
    deg_lat = radius_km / 111.0
    deg_lon = radius_km / (111.0 * abs(__import__("math").cos(__import__("math").radians(lat))) + 1e-9)
    with get_db() as db:
        candidates = db.query(Airport).filter(
            Airport.latitude .between(lat - deg_lat, lat + deg_lat),
            Airport.longitude.between(lon - deg_lon, lon + deg_lon),
        ).all()
    results = [r for r in candidates if _haversine_m(lat, lon, r.latitude, r.longitude) <= radius_km * 1000]
    return {"type": "FeatureCollection", "features": [_airport_feature(r) for r in results]}


def _clean_display_name(display_name: str) -> str:
    """Strip non-Latin characters and tidy punctuation from a Nominatim display_name."""
    import re
    cleaned = re.sub(r'[^\x00-\x7FÀ-ɏḀ-ỿ,.\-\s]', '', display_name)
    cleaned = re.sub(r',\s*,', ',', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned.strip(',').strip()


def _shorten_display_name(display_name: str) -> str:
    """Collapse 'City, Region, Sub, Country' → 'City, Country'."""
    parts = [p.strip() for p in display_name.split(',')]
    parts = [p for p in parts if p]
    if len(parts) >= 2:
        return f"{parts[0]}, {parts[-1]}"
    return parts[0] if parts else display_name


@app.get("/api/search")
async def unified_search(
    q:     str = Query(..., min_length=2),
    types: str = Query("all"),
    limit: int = Query(10, ge=1, le=20),
):
    """
    Unified search across airports, ports, cables, chokepoints, assessments,
    fusion events, watch zones, rules, POIs, and Nominatim geographic search.
    Returns up to 15 ranked results.
    """
    q = q.strip()
    if len(q) < 2:
        return []

    want_set = None if types.lower() == "all" else set(types.lower().split(","))

    def _want(t: str) -> bool:
        return want_set is None or t in want_set

    term = f"%{q}%"
    q_lo = q.lower()

    def _db_search() -> list:
        from database import (
            Airport, PortBoundary, CableSegment, OntologyEntity,
            FusionEvent, WatchZone, RuleConfig, get_db,
        )
        from sqlalchemy import or_
        hits: list = []
        try:
            with get_db() as db:
                if _want("airport"):
                    rows = db.query(Airport).filter(or_(
                        Airport.airport_name.ilike(term),
                        Airport.icao_code.ilike(term),
                        Airport.iata_code.ilike(term),
                        Airport.municipality.ilike(term),
                        Airport.country_name.ilike(term),
                    )).limit(10).all()
                    for r in rows:
                        hits.append({
                            "type": "airport",
                            "system_id": r.system_id,
                            "name": r.airport_name,
                            "icao": r.icao_code,
                            "iata": r.iata_code,
                            "country": r.country_name or r.country_code,
                            "lat": r.latitude,
                            "lon": r.longitude,
                            "airport_type": r.airport_type,
                        })

                if _want("port"):
                    rows = db.query(PortBoundary).filter(or_(
                        PortBoundary.port_name.ilike(term),
                        PortBoundary.country.ilike(term),
                    )).limit(10).all()
                    for r in rows:
                        hits.append({
                            "type": "port",
                            "system_id": r.system_id,
                            "name": r.port_name,
                            "country": r.country,
                            "lat": r.latitude,
                            "lon": r.longitude,
                            "port_size": r.port_size,
                        })

                if _want("cable"):
                    import re as _re
                    ilike_rows = db.query(CableSegment).filter(or_(
                        CableSegment.cable_name.ilike(term),
                        CableSegment.owners.ilike(term),
                        CableSegment.all_countries.ilike(term),
                    )).limit(10).all()
                    # Compact normalized fallback — handles "SEA-ME-WE 5" → "seamewe5"
                    q_compact = _re.sub(r'[^a-z0-9]', '', q_lo)
                    norm_rows = []
                    if len(q_compact) >= 3:
                        seen_ids = {r.cable_id for r in ilike_rows}
                        slim = db.query(
                            CableSegment.cable_id, CableSegment.cable_name,
                            CableSegment.owners, CableSegment.all_countries,
                            CableSegment.system_id, CableSegment.region_id,
                        ).all()
                        for r in slim:
                            cid   = _re.sub(r'[^a-z0-9]', '', (r.cable_id   or "").lower())
                            cname = _re.sub(r'[^a-z0-9]', '', (r.cable_name or "").lower())
                            if (q_compact in cname or q_compact in cid) and r.cable_id not in seen_ids:
                                norm_rows.append(r)
                                seen_ids.add(r.cable_id)
                    for r in (ilike_rows + norm_rows)[:10]:
                        hits.append({
                            "type": "cable",
                            "system_id": r.system_id or r.cable_id,
                            "name": r.cable_name,
                            "owners": r.owners,
                            "region_id": r.region_id,
                            "all_countries": r.all_countries,
                            "lat": None,
                            "lon": None,
                        })

                if _want("chokepoint"):
                    rows = db.query(OntologyEntity).filter(
                        OntologyEntity.entity_type.ilike("Chokepoint"),
                        OntologyEntity.name.ilike(term),
                    ).limit(10).all()
                    for r in rows:
                        try:
                            meta = _json.loads(r.entity_metadata or "{}")
                        except Exception:
                            meta = {}
                        hits.append({
                            "type": "chokepoint",
                            "system_id": r.system_id,
                            "name": r.name,
                            "lat": meta.get("lat"),
                            "lon": meta.get("lon"),
                        })

                if _want("assessment"):
                    try:
                        from intelligence_schema import IntelligenceAssessment
                        rows = (
                            db.query(IntelligenceAssessment)
                            .filter(or_(
                                IntelligenceAssessment.headline.ilike(term),
                                IntelligenceAssessment.location_name.ilike(term),
                            ))
                            .order_by(IntelligenceAssessment.created_at.desc())
                            .limit(10).all()
                        )
                        for r in rows:
                            hits.append({
                                "type": "assessment",
                                "assessment_id": r.assessment_id,
                                "name": r.headline,
                                "severity": r.severity,
                                "lat": r.lat,
                                "lon": r.lon,
                                "location_name": r.location_name,
                            })
                    except Exception:
                        pass

                if _want("fusion"):
                    rows = (
                        db.query(FusionEvent)
                        .filter(or_(
                            FusionEvent.title.ilike(term),
                            FusionEvent.location_name.ilike(term),
                        ))
                        .order_by(FusionEvent.created_at.desc())
                        .limit(10).all()
                    )
                    for r in rows:
                        hits.append({
                            "type": "fusion",
                            "fusion_id": r.fusion_id,
                            "name": r.title,
                            "severity": r.severity,
                            "lat": r.lat,
                            "lon": r.lon,
                            "location_name": r.location_name,
                        })

                if _want("zone"):
                    rows = db.query(WatchZone).filter(or_(
                        WatchZone.name.ilike(term),
                        WatchZone.description.ilike(term),
                    )).limit(10).all()
                    for r in rows:
                        hits.append({
                            "type": "zone",
                            "system_id": r.system_id,
                            "name": r.name,
                            "priority": r.priority,
                            "lat": ((r.bbox_min_lat or 0) + (r.bbox_max_lat or 0)) / 2 or None,
                            "lon": ((r.bbox_min_lon or 0) + (r.bbox_max_lon or 0)) / 2 or None,
                        })

                if _want("rule"):
                    rows = db.query(RuleConfig).filter(or_(
                        RuleConfig.rule_name.ilike(term),
                        RuleConfig.name.ilike(term),
                    )).limit(10).all()
                    for r in rows:
                        hits.append({
                            "type": "rule",
                            "id": r.id,
                            "name": r.name or r.rule_name,
                            "rule_name": r.rule_name,
                            "trigger_type": r.trigger_type,
                            "lat": None,
                            "lon": None,
                        })

                if _want("strategic_zone"):
                    try:
                        from database import StrategicZone as _SZ
                        rows = db.query(_SZ).filter(
                            _SZ.enabled == True,
                            or_(
                                _SZ.name.ilike(term),
                                _SZ.description.ilike(term),
                                _SZ.zone_type.ilike(term),
                            )
                        ).limit(10).all()
                        for r in rows:
                            lat = (r.bbox_min_lat + r.bbox_max_lat) / 2
                            lon = (r.bbox_min_lon + r.bbox_max_lon) / 2
                            hits.append({
                                "type": "strategic_zone",
                                "system_id": r.zone_id,
                                "name": r.name,
                                "zone_type": r.zone_type,
                                "severity_baseline": r.severity_baseline,
                                "colour": r.colour,
                                "description": r.description,
                                "lat": lat,
                                "lon": lon,
                            })
                    except Exception:
                        pass
        except Exception as ex:
            print(f"[search] db error: {ex}")
        return hits

    def _poi_search() -> list:
        if not _want("poi"):
            return []
        hits = []
        try:
            for p in _poi_load():
                name  = (p.get("name")  or "").lower()
                notes = (p.get("notes") or "").lower()
                if q_lo in name or q_lo in notes:
                    hits.append({
                        "type": "poi",
                        "id": p.get("id"),
                        "name": p.get("name") or "Unknown",
                        "lat": p.get("lat"),
                        "lon": p.get("lon"),
                        "icon_type": p.get("icon_type"),
                    })
        except Exception:
            pass
        return hits[:5]

    loop = asyncio.get_event_loop()
    db_hits, poi_hits = await asyncio.gather(
        loop.run_in_executor(_executor, _db_search),
        loop.run_in_executor(_executor, _poi_search),
    )

    all_db = db_hits + poi_hits

    nom_hits: list = []
    if _want("location") or _want("city") or _want("country") or (len(all_db) < 3 and not _want("strategic_zone")):
        import time as _time
        _cache_key = q.lower().strip()
        _cached_nom, _cached_ts = _nominatim_search_cache.get(_cache_key, (None, 0))
        if _cached_nom is not None and _time.time() - _cached_ts < _NOMINATIM_CACHE_TTL:
            nom_hits = _cached_nom
        else:
            try:
                async with httpx.AsyncClient(
                    timeout=5.0,
                    headers={
                        "User-Agent": "AkiliDashboard/1.0 (contact: dev@local)",
                        "Accept-Language": "en",
                    },
                ) as hc:
                    r = await hc.get(
                        "https://nominatim.openstreetmap.org/search",
                        params={"format": "json", "q": q, "limit": "5", "addressdetails": "1"},
                    )
                    r.raise_for_status()
                    raw = r.json()
                for item in (raw if isinstance(raw, list) else []):
                    try:
                        raw_display = item.get("display_name", "")
                        cleaned     = _clean_display_name(raw_display)
                        short       = _shorten_display_name(cleaned)
                        nom_hits.append({
                            "type":         "location",
                            "name":         cleaned.split(",")[0].strip(),
                            "display_name": short,
                            "lat":          float(item["lat"]),
                            "lon":          float(item["lon"]),
                            "osm_type":     item.get("osm_type"),
                            "category":     item.get("class") or item.get("category"),
                            "country_code": (item.get("address") or {}).get("country_code"),
                        })
                    except (KeyError, TypeError, ValueError):
                        pass
                _nominatim_search_cache[_cache_key] = (nom_hits, _time.time())
            except Exception as ex:
                print(f"[search] nominatim error: {ex}")

    def _score(r: dict) -> int:
        if (r.get("name") or "").lower() == q_lo:
            return 0
        if r["type"] in ("airport", "port", "chokepoint"):
            return 1
        if r["type"] in ("cable", "zone", "rule", "poi", "strategic_zone"):
            return 2
        if r["type"] in ("assessment", "fusion"):
            return 3
        return 4

    combined = sorted(all_db + nom_hits, key=_score)
    return combined[:15]


@app.get("/api/airports/by-region/{region_id}")
def api_airports_by_region(region_id: str, response: FastAPIResponse):
    """All airports in a region."""
    from database import Airport, get_db
    response.headers["Cache-Control"] = "public, max-age=300"
    with get_db() as db:
        rows = db.query(Airport).filter(Airport.region_id == region_id).all()
    return {"type": "FeatureCollection", "features": [_airport_feature(r) for r in rows]}


@app.get("/api/airports/in-viewport")
def api_airports_in_viewport(
    min_lat: float = Query(...),
    max_lat: float = Query(...),
    min_lon: float = Query(...),
    max_lon: float = Query(...),
    response: FastAPIResponse = None,
):
    """Airports within a viewport bounding box — max 200, large airports first."""
    from database import Airport, get_db
    from sqlalchemy import case
    if response:
        response.headers["Cache-Control"] = "public, max-age=30"
    type_order = case(
        (Airport.airport_type == "large_airport",  0),
        (Airport.airport_type == "medium_airport", 1),
        (Airport.airport_type == "seaplane_base",  2),
        else_=3,
    )
    with get_db() as db:
        rows = (
            db.query(Airport)
            .filter(
                Airport.latitude .between(min_lat, max_lat),
                Airport.longitude.between(min_lon, max_lon),
            )
            .order_by(type_order)
            .limit(200)
            .all()
        )
    return {"type": "FeatureCollection", "features": [_airport_feature(r) for r in rows]}


@app.get("/api/airports/{system_id}")
def api_airport_by_system_id(system_id: str):
    """Single airport by system_id or ICAO ident."""
    from database import Airport, get_db
    from sqlalchemy import or_
    with get_db() as db:
        row = db.query(Airport).filter(
            or_(Airport.system_id == system_id, Airport.ident == system_id.upper())
        ).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Airport '{system_id}' not found")
    return _airport_feature(row)


# ── Endpoints: Ontology entities (DB-backed) ──────────────────────────────────

@app.get("/api/ontology/entities")
def api_ontology_entities(
    response: FastAPIResponse,
    type: str = Query(None, description="Filter by entity_type (e.g. 'Submarine Cable')"),
    region_id: str = Query(None, description="Filter by region_id"),
):
    """Return ontology entities from the DB, optionally filtered by type or region."""
    import json as _json_ont
    from database import OntologyEntity, get_db
    response.headers["Cache-Control"] = "public, max-age=300"
    with get_db() as db:
        q = db.query(OntologyEntity)
        if type:
            q = q.filter(OntologyEntity.entity_type == type)
        if region_id:
            q = q.filter(OntologyEntity.region_id == region_id)
        rows = q.all()
    return {
        "entities": [
            {
                "system_id":   r.system_id,
                "entity_type": r.entity_type,
                "name":        r.name,
                "infra_type":  r.infra_type,
                "region_id":   r.region_id,
                "metadata":    _json_ont.loads(r.entity_metadata) if r.entity_metadata else {},
            }
            for r in rows
        ],
        "total": len(rows),
    }


# ── Endpoints: Rule configs (DB-backed) ───────────────────────────────────────

def _rule_row_to_dict(row) -> dict:
    import json as _jr
    params = _jr.loads(row.params) if isinstance(row.params, str) else (row.params or {})
    return {
        "id":           row.id,
        "system_id":    f"RULE-{row.id}",
        "name":         row.name or row.rule_name,
        "rule_name":    row.rule_name,
        "trigger_type": row.trigger_type or row.rule_name,
        "severity":     row.severity or params.get("severity", "medium"),
        "icon_type":    row.icon_type or params.get("icon_type"),
        "enabled":      row.enabled,
        "params":       params,
        "created_at":   row.created_at.isoformat() if row.created_at else None,
        "updated_at":   row.updated_at.isoformat() if row.updated_at else None,
    }


@app.get("/api/rules")
def api_rules_list():
    """Return all rule configs."""
    from database import RuleConfig, get_db
    with get_db() as db:
        rows = db.query(RuleConfig).order_by(RuleConfig.id).all()
    return {"rules": [_rule_row_to_dict(r) for r in rows], "total": len(rows)}


@app.post("/api/rules")
def api_rules_create(body: dict):
    """
    Create a rule config.
    Body: { name?, rule_name/trigger_type, severity?, icon_type?, params?, enabled? }
    trigger_type and rule_name are treated as the same field (trigger_type wins).
    """
    import json as _jc
    from database import RuleConfig, OntologyEntity, get_db
    import datetime as _dt
    trigger_type = body.get("trigger_type") or body.get("rule_name")
    if not trigger_type:
        raise HTTPException(status_code=422, detail="trigger_type (or rule_name) is required")
    name      = body.get("name") or trigger_type
    severity  = body.get("severity", "medium")
    icon_type = body.get("icon_type") or body.get("params", {}).get("icon_type")
    params    = body.get("params", {})
    enabled   = bool(body.get("enabled", True))
    params_str = _jc.dumps(params, ensure_ascii=False)
    now = _dt.datetime.utcnow()
    with get_db() as db:
        row = RuleConfig(
            name=name, rule_name=trigger_type, trigger_type=trigger_type,
            severity=severity, icon_type=icon_type,
            enabled=enabled, params=params_str,
            created_at=now, updated_at=now,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        # Upsert OntologyEntity
        onto_id  = f"RULE-{row.id}"
        onto_meta = _jc.dumps({
            "rule_name":    trigger_type,
            "trigger_type": trigger_type,
            "severity":     severity,
            "icon_type":    icon_type,
            "params":       params,
        }, ensure_ascii=False)
        existing = db.query(OntologyEntity).filter(OntologyEntity.system_id == onto_id).first()
        if existing:
            existing.name            = name
            existing.infra_type      = trigger_type
            existing.entity_metadata = onto_meta
        else:
            db.add(OntologyEntity(
                system_id=onto_id, entity_type="Rule",
                name=name, infra_type=trigger_type,
                entity_metadata=onto_meta,
            ))
        db.commit()
        return _rule_row_to_dict(row)


@app.put("/api/rules/{rule_id}")
def api_rules_update(rule_id: int, body: dict):
    """Update a rule config. Accepts: enabled, params (partial ok)."""
    import json as _ju
    import datetime as _dt
    from database import RuleConfig, get_db
    with get_db() as db:
        row = db.query(RuleConfig).filter(RuleConfig.id == rule_id).first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Rule {rule_id} not found")
        if "enabled" in body:
            row.enabled = bool(body["enabled"])
        if "params" in body:
            row.params = _ju.dumps(body["params"], ensure_ascii=False)
        if "rule_name" in body:
            row.rule_name = body["rule_name"]
        row.updated_at = _dt.datetime.utcnow()
        db.commit()
        db.refresh(row)
        return _rule_row_to_dict(row)


@app.delete("/api/rules/{rule_id}")
def api_rules_delete(rule_id: int):
    """Delete a rule config by id."""
    from database import RuleConfig, OntologyEntity, get_db
    with get_db() as db:
        row = db.query(RuleConfig).filter(RuleConfig.id == rule_id).first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Rule {rule_id} not found")
        db.delete(row)
        # Remove matching OntologyEntity
        onto = db.query(OntologyEntity).filter(OntologyEntity.system_id == f"RULE-{rule_id}").first()
        if onto:
            db.delete(onto)
        db.commit()
    return {"deleted": rule_id}


# ── Escalation Chains ────────────────────────────────────────────────────────

def _chain_row_to_dict(row, rule_map: dict = None) -> dict:
    import json as _jch
    ids = [int(x) for x in row.rule_ids.split(",") if x.strip().isdigit()]
    rule_names = [rule_map.get(i, f"RULE-{i}") for i in ids] if rule_map else []
    return {
        "id":                  row.id,
        "system_id":           f"CHAIN-{row.id}",
        "chain_name":          row.chain_name,
        "rule_ids":            ids,
        "rule_names":          rule_names,
        "escalated_severity":  row.escalated_severity,
        "escalated_icon_type": row.escalated_icon_type,
        "time_window_minutes": row.time_window_minutes,
    }


@app.get("/api/escalation-chains")
def api_chains_list():
    """Return all escalation chains with resolved rule names."""
    from database import EscalationChain, RuleConfig, get_db
    with get_db() as db:
        rows  = db.query(EscalationChain).order_by(EscalationChain.id).all()
        rules = db.query(RuleConfig).all()
    rule_map = {r.id: (r.name or r.rule_name) for r in rules}
    return [_chain_row_to_dict(r, rule_map) for r in rows]


@app.post("/api/escalation-chains")
def api_chains_create(body: dict):
    """
    Create an escalation chain.
    Body: { chain_name, rule_ids (list[int]), escalated_severity,
            escalated_icon_type, time_window_minutes? }
    """
    import json as _jchc
    from database import EscalationChain, RuleConfig, OntologyEntity, get_db
    import datetime as _dt
    chain_name    = body.get("chain_name")
    rule_ids_raw  = body.get("rule_ids", [])
    esc_severity  = body.get("escalated_severity", "critical")
    esc_icon      = body.get("escalated_icon_type", "ESCALATED_DUAL")
    window_min    = int(body.get("time_window_minutes", 30))
    if not chain_name:
        raise HTTPException(status_code=422, detail="chain_name is required")
    if not rule_ids_raw:
        raise HTTPException(status_code=422, detail="rule_ids must be a non-empty list")
    ids_str = ",".join(str(i) for i in rule_ids_raw)
    now = _dt.datetime.utcnow()
    with get_db() as db:
        row = EscalationChain(
            chain_name=chain_name, rule_ids=ids_str,
            escalated_severity=esc_severity, escalated_icon_type=esc_icon,
            time_window_minutes=window_min,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        # Resolve rule names for ontology metadata
        rules = db.query(RuleConfig).filter(RuleConfig.id.in_(rule_ids_raw)).all()
        rule_map = {r.id: (r.name or r.rule_name) for r in rules}
        rule_names = [rule_map.get(i, f"RULE-{i}") for i in rule_ids_raw]
        onto_id  = f"CHAIN-{row.id}"
        onto_meta = _jchc.dumps({
            "escalated_severity":  esc_severity,
            "escalated_icon_type": esc_icon,
            "time_window_minutes": window_min,
            "rule_ids":            list(rule_ids_raw),
            "rule_names":          rule_names,
        }, ensure_ascii=False)
        existing = db.query(OntologyEntity).filter(OntologyEntity.system_id == onto_id).first()
        if existing:
            existing.name            = chain_name
            existing.entity_metadata = onto_meta
        else:
            db.add(OntologyEntity(
                system_id=onto_id, entity_type="Escalation Chain",
                name=chain_name, entity_metadata=onto_meta,
            ))
        db.commit()
        return _chain_row_to_dict(row, rule_map)


@app.delete("/api/escalation-chains/{chain_id}")
def api_chains_delete(chain_id: int):
    """Delete an escalation chain."""
    from database import EscalationChain, OntologyEntity, get_db
    with get_db() as db:
        row = db.query(EscalationChain).filter(EscalationChain.id == chain_id).first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Chain {chain_id} not found")
        db.delete(row)
        onto = db.query(OntologyEntity).filter(OntologyEntity.system_id == f"CHAIN-{chain_id}").first()
        if onto:
            db.delete(onto)
        db.commit()
    return {"deleted": chain_id}


def _conn_row_to_dict(row, rule_map: dict) -> dict:
    return {
        "id":                         row.id,
        "system_id":                  f"CONN-{row.id}",
        "connection_name":            row.connection_name,
        "rule_id_a":                  row.rule_id_a,
        "rule_id_b":                  row.rule_id_b,
        "rule_name_a":                rule_map.get(row.rule_id_a, f"RULE-{row.rule_id_a}"),
        "rule_name_b":                rule_map.get(row.rule_id_b, f"RULE-{row.rule_id_b}"),
        "relationship_type":          row.relationship_type,
        "escalated_severity":         row.escalated_severity,
        "escalated_icon_type":        row.escalated_icon_type,
        "sequence_window_minutes":    row.sequence_window_minutes,
        "suppression_window_minutes": row.suppression_window_minutes,
        "time_window_minutes":        row.time_window_minutes,
        "notes":                      row.notes,
        "created_at":                 row.created_at.isoformat() if row.created_at else None,
    }


@app.get("/api/rule-connections")
def api_rule_connections_list():
    """Return all rule connections with resolved rule names."""
    from database import RuleConnection, RuleConfig, get_db
    with get_db() as db:
        rows  = db.query(RuleConnection).order_by(RuleConnection.id).all()
        rules = db.query(RuleConfig).all()
    rule_map = {r.id: (r.name or r.rule_name) for r in rules}
    return [_conn_row_to_dict(r, rule_map) for r in rows]


@app.post("/api/rule-connections")
def api_rule_connections_create(body: dict):
    """
    Create a rule connection.
    Body: { connection_name, rule_id_a, rule_id_b, relationship_type,
            escalated_severity?, escalated_icon_type?,
            sequence_window_minutes?, suppression_window_minutes?,
            time_window_minutes?, notes? }
    """
    import json as _jrc
    import datetime as _dt
    from database import RuleConnection, RuleConfig, OntologyEntity, get_db
    conn_name = body.get("connection_name") or ""
    rule_id_a = body.get("rule_id_a")
    rule_id_b = body.get("rule_id_b")
    rel_type  = body.get("relationship_type", "ESCALATION").upper()
    if not rule_id_a or not rule_id_b:
        raise HTTPException(status_code=422, detail="rule_id_a and rule_id_b are required")
    if rel_type not in ("ESCALATION", "CORRELATION", "SEQUENCE", "SUPPRESSION"):
        raise HTTPException(status_code=422, detail=f"Invalid relationship_type: {rel_type}")
    with get_db() as db:
        row = RuleConnection(
            connection_name=conn_name or f"{rel_type} Connection",
            rule_id_a=int(rule_id_a),
            rule_id_b=int(rule_id_b),
            relationship_type=rel_type,
            escalated_severity=body.get("escalated_severity"),
            escalated_icon_type=body.get("escalated_icon_type"),
            sequence_window_minutes=body.get("sequence_window_minutes"),
            suppression_window_minutes=body.get("suppression_window_minutes"),
            time_window_minutes=int(body.get("time_window_minutes") or 30),
            notes=body.get("notes"),
            created_at=_dt.datetime.utcnow(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        rules = db.query(RuleConfig).filter(RuleConfig.id.in_([row.rule_id_a, row.rule_id_b])).all()
        rule_map = {r.id: (r.name or r.rule_name) for r in rules}
        onto_id  = f"CONN-{row.id}"
        onto_meta = _jrc.dumps({
            "relationship_type": rel_type,
            "rule_id_a": row.rule_id_a,
            "rule_id_b": row.rule_id_b,
            "rule_name_a": rule_map.get(row.rule_id_a, ""),
            "rule_name_b": rule_map.get(row.rule_id_b, ""),
        }, ensure_ascii=False)
        existing = db.query(OntologyEntity).filter(OntologyEntity.system_id == onto_id).first()
        if existing:
            existing.name            = row.connection_name
            existing.entity_metadata = onto_meta
        else:
            db.add(OntologyEntity(
                system_id=onto_id, entity_type="Rule Connection",
                name=row.connection_name, entity_metadata=onto_meta,
            ))
        db.commit()
        return _conn_row_to_dict(row, rule_map)


@app.put("/api/rule-connections/{conn_id}")
def api_rule_connections_update(conn_id: int, body: dict):
    """Update an existing rule connection."""
    import json as _jrcu
    from database import RuleConnection, RuleConfig, OntologyEntity, get_db
    with get_db() as db:
        row = db.query(RuleConnection).filter(RuleConnection.id == conn_id).first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Connection {conn_id} not found")
        if "connection_name" in body:
            row.connection_name = body["connection_name"]
        if "relationship_type" in body:
            rel = body["relationship_type"].upper()
            if rel not in ("ESCALATION", "CORRELATION", "SEQUENCE", "SUPPRESSION"):
                raise HTTPException(status_code=422, detail=f"Invalid relationship_type: {rel}")
            row.relationship_type = rel
        for field in ("escalated_severity", "escalated_icon_type", "notes"):
            if field in body:
                setattr(row, field, body[field])
        for int_field in ("sequence_window_minutes", "suppression_window_minutes", "time_window_minutes"):
            if int_field in body and body[int_field] is not None:
                setattr(row, int_field, int(body[int_field]))
        rules = db.query(RuleConfig).filter(RuleConfig.id.in_([row.rule_id_a, row.rule_id_b])).all()
        rule_map = {r.id: (r.name or r.rule_name) for r in rules}
        onto = db.query(OntologyEntity).filter(OntologyEntity.system_id == f"CONN-{conn_id}").first()
        if onto:
            onto.name = row.connection_name
            onto.entity_metadata = _jrcu.dumps({
                "relationship_type": row.relationship_type,
                "rule_id_a": row.rule_id_a,
                "rule_id_b": row.rule_id_b,
                "rule_name_a": rule_map.get(row.rule_id_a, ""),
                "rule_name_b": rule_map.get(row.rule_id_b, ""),
            }, ensure_ascii=False)
        db.commit()
        return _conn_row_to_dict(row, rule_map)


@app.delete("/api/rule-connections/{conn_id}")
def api_rule_connections_delete(conn_id: int):
    """Delete a rule connection."""
    from database import RuleConnection, OntologyEntity, get_db
    with get_db() as db:
        row = db.query(RuleConnection).filter(RuleConnection.id == conn_id).first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Connection {conn_id} not found")
        db.delete(row)
        onto = db.query(OntologyEntity).filter(OntologyEntity.system_id == f"CONN-{conn_id}").first()
        if onto:
            db.delete(onto)
        db.commit()
    return {"deleted": conn_id}


@app.post("/api/rules/test")
def api_rules_test(body: dict):
    """
    Replay a loitering rule against the last 60 min of position history for a vessel.
    Body: { rule_id: int, vessel_mmsi: str }
    """
    import json as _jt
    from database import RuleConfig, VesselHistory, CableSegment, get_db
    from datetime import timedelta
    from detectors.ais_detector import AISAnomalyDetector as _AIS

    rule_id     = body.get("rule_id")
    vessel_mmsi = str(body.get("vessel_mmsi", ""))
    if not rule_id or not vessel_mmsi:
        raise HTTPException(status_code=422, detail="rule_id and vessel_mmsi required")

    with get_db() as db:
        rule_row = db.query(RuleConfig).filter(RuleConfig.id == rule_id).first()
        if not rule_row:
            raise HTTPException(status_code=404, detail=f"Rule {rule_id} not found")
        if rule_row.rule_name not in ("AIS_LOITERING_NEAR_CABLE", "AIS_LOITERING_NEAR_INFRA"):
            raise HTTPException(status_code=422, detail="Only loitering rules supported")

        cutoff   = datetime.now(timezone.utc) - timedelta(minutes=60)
        history  = (
            db.query(VesselHistory)
            .filter(VesselHistory.mmsi == vessel_mmsi,
                    VesselHistory.timestamp >= cutoff)
            .order_by(VesselHistory.timestamp)
            .all()
        )

        params_v = _jt.loads(rule_row.params) if isinstance(rule_row.params, str) else rule_row.params
        target   = str(params_v.get("target", "ALL")).upper()

        cables_all = db.query(CableSegment).all()
        if target == "ALL":
            cables_scope = cables_all
        elif target.startswith("REG-"):
            cables_scope = [c for c in cables_all if (c.region_id or "") == target]
        else:
            cables_scope = [c for c in cables_all if (c.system_id or "") == target]

        cables_for_detector = [
            {
                "system_id": c.system_id,
                "cable_id":  c.cable_id,
                "name":      c.cable_name,
                "region_id": c.region_id,
                "geometry":  c.geometry,
            }
            for c in cables_scope
        ]

    if not history:
        return {
            "would_fire": False,
            "reason": "No position history for this vessel in the last 60 minutes",
            "matched_cables": [],
            "positions_checked": 0,
        }

    rule_dict = {
        "id":        rule_row.id,
        "rule_name": rule_row.rule_name,
        "enabled":   rule_row.enabled,
        "params":    params_v,
    }

    # Simulate the rule over the history using a fresh detector instance
    tester = _AIS()
    all_alerts: list = []
    for pos in history:
        vessel = {
            "mmsi":  vessel_mmsi,
            "name":  pos.name or vessel_mmsi,
            "lat":   pos.lat,
            "lng":   pos.lon,
            "speed": pos.speed or 0,
            "flag":  pos.flag,
        }
        ts = pos.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        hits = tester.check_loitering(vessel, cables_for_detector, [rule_dict], ts)
        all_alerts.extend(hits)

    matched_cables = list({a["cable_system_id"] for a in all_alerts})
    would_fire     = len(all_alerts) > 0

    return {
        "would_fire":         would_fire,
        "reason":             (
            f"Rule would fire: loitering detected near {matched_cables}"
            if would_fire else "No loitering detected in last 60 min history"
        ),
        "matched_cables":     matched_cables,
        "alert_count":        len(all_alerts),
        "positions_checked":  len(history),
        "alerts":             all_alerts[:5],
    }


# ── Endpoints: Watch Zones (Sentinel surveillance) ────────────────────────────

import json as _json_wz
import math as _math_wz


def _zone_row_to_dict(row) -> dict:
    return {
        "id":                   row.id,
        "system_id":            row.system_id,
        "name":                 row.name,
        "description":          row.description,
        "polygon_geojson":      _json_wz.loads(row.polygon_geojson) if isinstance(row.polygon_geojson, str) else row.polygon_geojson,
        "bbox":                 {"min_lon": row.bbox_min_lon, "min_lat": row.bbox_min_lat,
                                 "max_lon": row.bbox_max_lon, "max_lat": row.bbox_max_lat},
        "priority":             row.priority,
        "scan_interval_hours":  row.scan_interval_hours,
        "enabled":              row.enabled,
        "created_by":           row.created_by,
        "created_at":           row.created_at.isoformat() if row.created_at else None,
        "last_scanned_at":      row.last_scanned_at.isoformat() if row.last_scanned_at else None,
        "next_scan_at":         row.next_scan_at.isoformat() if row.next_scan_at else None,
        "ml_tasks":             _json_wz.loads(row.ml_tasks) if isinstance(row.ml_tasks, str) else (row.ml_tasks or []),
        "alert_threshold":      row.alert_threshold,
        "metadata":             _json_wz.loads(row.zone_metadata) if row.zone_metadata else {},
    }


def _derive_bbox(polygon_geojson: dict) -> tuple:
    """Return (min_lon, min_lat, max_lon, max_lat) from a GeoJSON Polygon."""
    coords = polygon_geojson.get("coordinates", [[]])[0]
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return min(lons), min(lats), max(lons), max(lats)


def _next_zone_system_id(db) -> str:
    from database import WatchZone
    count = db.query(WatchZone).count()
    return f"ZONE-{(count + 1):03d}"


def _next_scan_system_id(db) -> str:
    from database import SentinelScan
    count = db.query(SentinelScan).count()
    return f"SCAN-{(count + 1):04d}"


def _scan_row_to_dict(row) -> dict:
    summary = None
    if row.result_summary:
        try:
            summary = _json_wz.loads(row.result_summary)
        except Exception:
            summary = row.result_summary
    return {
        "id":                   row.id,
        "scan_id":              row.scan_id,
        "zone_id":              row.zone_id,
        "triggered_by":         row.triggered_by,
        "status":               row.status,
        "created_at":           row.created_at.isoformat() if row.created_at else None,
        "completed_at":         row.completed_at.isoformat() if row.completed_at else None,
        "image_id":             row.image_id,
        "image_timestamp_utc":  row.image_timestamp_utc.isoformat() if row.image_timestamp_utc else None,
        "cloud_cover_percent":  row.cloud_cover_percent,
        "image_age_hours":      row.image_age_hours,
        "result_summary":       summary,
        "alert_fired":          row.alert_fired,
        "error_message":        row.error_message,
    }


def _detection_row_to_dict(row) -> dict:
    attrs = None
    if row.attributes:
        try:
            attrs = _json_wz.loads(row.attributes)
        except Exception:
            attrs = row.attributes
    geo = None
    if row.geo_geometry:
        try:
            geo = _json_wz.loads(row.geo_geometry)
        except Exception:
            geo = row.geo_geometry
    return {
        "id":                      row.id,
        "detection_id":            row.detection_id,
        "scan_id":                 row.scan_id,
        "zone_id":                 row.zone_id,
        "object_type":             row.object_type,
        "confidence":              row.confidence,
        "centroid_lat":            row.centroid_lat,
        "centroid_lon":            row.centroid_lon,
        "geo_geometry":            geo,
        "area_m2":                 row.area_m2,
        "severity":                row.severity,
        "alert_tier":              row.alert_tier,
        "attributes":              attrs,
        "image_crop_url":          row.image_crop_url,
        "overlay_url":             row.overlay_url,
        "matched_to_ais":          row.matched_to_ais,
        "nearest_port":            row.nearest_port,
        "nearest_infrastructure":  row.nearest_infrastructure,
        "nearest_chokepoint":      row.nearest_chokepoint,
        "created_at":              row.created_at.isoformat() if row.created_at else None,
    }


@app.post("/api/watch-zones")
def api_watch_zones_create(body: dict):
    from database import WatchZone, OntologyEntity, get_db
    import datetime as _dt_wz

    name            = (body.get("name") or "").strip()
    polygon_raw     = body.get("polygon_geojson")
    if not name:
        raise HTTPException(status_code=422, detail="name is required")
    if not polygon_raw:
        raise HTTPException(status_code=422, detail="polygon_geojson is required")

    poly = polygon_raw if isinstance(polygon_raw, dict) else _json_wz.loads(polygon_raw)
    min_lon, min_lat, max_lon, max_lat = _derive_bbox(poly)

    scan_interval = int(body.get("scan_interval_hours", 24))
    ml_tasks      = body.get("ml_tasks", [])
    now           = _dt_wz.datetime.utcnow()
    next_scan     = now + _dt_wz.timedelta(hours=scan_interval)

    with get_db() as db:
        system_id = _next_zone_system_id(db)
        zone = WatchZone(
            system_id           = system_id,
            name                = name,
            description         = body.get("description"),
            polygon_geojson     = _json_wz.dumps(poly),
            bbox_min_lon        = min_lon,
            bbox_min_lat        = min_lat,
            bbox_max_lon        = max_lon,
            bbox_max_lat        = max_lat,
            priority            = body.get("priority", "medium"),
            scan_interval_hours = scan_interval,
            enabled             = True,
            created_by          = body.get("created_by"),
            created_at          = now,
            next_scan_at        = next_scan,
            ml_tasks            = _json_wz.dumps(ml_tasks),
            alert_threshold     = body.get("alert_threshold", "both"),
            zone_metadata       = _json_wz.dumps(body.get("metadata", {})),
        )
        db.add(zone)
        db.flush()

        onto_meta = _json_wz.dumps({
            "priority":            zone.priority,
            "scan_interval_hours": zone.scan_interval_hours,
            "bbox": {"min_lon": min_lon, "min_lat": min_lat,
                     "max_lon": max_lon, "max_lat": max_lat},
        }, ensure_ascii=False)
        existing_onto = db.query(OntologyEntity).filter(
            OntologyEntity.system_id == system_id
        ).first()
        if existing_onto:
            existing_onto.name            = name
            existing_onto.entity_metadata = onto_meta
        else:
            db.add(OntologyEntity(
                system_id       = system_id,
                entity_type     = "Watch Zone",
                name            = name,
                infra_type      = "SENTINEL_ZONE",
                entity_metadata = onto_meta,
            ))
        db.commit()
        db.refresh(zone)
        return _zone_row_to_dict(zone)


@app.get("/api/watch-zones")
def api_watch_zones_list():
    from database import WatchZone, get_db
    with get_db() as db:
        zones = db.query(WatchZone).order_by(WatchZone.id).all()
        return [_zone_row_to_dict(z) for z in zones]


@app.get("/api/watch-zones/{system_id}")
def api_watch_zone_get(system_id: str):
    from database import WatchZone, get_db
    with get_db() as db:
        zone = db.query(WatchZone).filter(WatchZone.system_id == system_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail=f"Watch zone {system_id} not found")
        return _zone_row_to_dict(zone)


@app.put("/api/watch-zones/{system_id}")
def api_watch_zone_update(system_id: str, body: dict):
    from database import WatchZone, OntologyEntity, get_db
    import datetime as _dt_wz

    with get_db() as db:
        zone = db.query(WatchZone).filter(WatchZone.system_id == system_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail=f"Watch zone {system_id} not found")

        interval_changed = False
        if "name" in body:
            zone.name = body["name"]
        if "description" in body:
            zone.description = body["description"]
        if "polygon_geojson" in body:
            poly = body["polygon_geojson"] if isinstance(body["polygon_geojson"], dict) else _json_wz.loads(body["polygon_geojson"])
            zone.polygon_geojson = _json_wz.dumps(poly)
            zone.bbox_min_lon, zone.bbox_min_lat, zone.bbox_max_lon, zone.bbox_max_lat = _derive_bbox(poly)
        if "priority" in body:
            zone.priority = body["priority"]
        if "scan_interval_hours" in body:
            zone.scan_interval_hours = int(body["scan_interval_hours"])
            interval_changed = True
        if "enabled" in body:
            zone.enabled = bool(body["enabled"])
        if "ml_tasks" in body:
            zone.ml_tasks = _json_wz.dumps(body["ml_tasks"])
        if "alert_threshold" in body:
            zone.alert_threshold = body["alert_threshold"]
        if "metadata" in body:
            zone.zone_metadata = _json_wz.dumps(body["metadata"])

        if interval_changed:
            zone.next_scan_at = _dt_wz.datetime.utcnow() + _dt_wz.timedelta(hours=zone.scan_interval_hours)

        onto = db.query(OntologyEntity).filter(OntologyEntity.system_id == system_id).first()
        if onto:
            onto.name = zone.name
            onto.entity_metadata = _json_wz.dumps({
                "priority":            zone.priority,
                "scan_interval_hours": zone.scan_interval_hours,
                "bbox": {"min_lon": zone.bbox_min_lon, "min_lat": zone.bbox_min_lat,
                         "max_lon": zone.bbox_max_lon, "max_lat": zone.bbox_max_lat},
            }, ensure_ascii=False)

        db.commit()
        db.refresh(zone)
        return _zone_row_to_dict(zone)


@app.delete("/api/watch-zones/{system_id}")
def api_watch_zone_delete(system_id: str):
    """Hard delete — removes zone and all associated scans/detections."""
    from database import WatchZone, SentinelScan, SentinelDetection, get_db
    with get_db() as db:
        zone = db.query(WatchZone).filter(WatchZone.system_id == system_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail=f"Watch zone {system_id} not found")
        scans = db.query(SentinelScan).filter(SentinelScan.zone_id == zone.id).all()
        for scan in scans:
            db.query(SentinelDetection).filter(SentinelDetection.scan_id == scan.scan_id).delete()
        db.query(SentinelScan).filter(SentinelScan.zone_id == zone.id).delete()
        db.delete(zone)
        db.commit()
        return {"deleted": system_id, "scans_purged": len(scans)}


@app.get("/api/watch-zones/{system_id}/scans")
def api_watch_zone_scans(system_id: str):
    from database import WatchZone, SentinelScan, get_db
    with get_db() as db:
        zone = db.query(WatchZone).filter(WatchZone.system_id == system_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail=f"Watch zone {system_id} not found")
        scans = (
            db.query(SentinelScan)
            .filter(SentinelScan.zone_id == zone.id)
            .order_by(SentinelScan.created_at.desc())
            .all()
        )
        return [_scan_row_to_dict(s) for s in scans]


@app.get("/api/watch-zones/{system_id}/detections")
def api_watch_zone_detections(
    system_id: str,
    object_type: str = None,
    min_confidence: float = None,
    since: str = None,
):
    from database import WatchZone, SentinelDetection, get_db
    import datetime as _dt_wz

    with get_db() as db:
        zone = db.query(WatchZone).filter(WatchZone.system_id == system_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail=f"Watch zone {system_id} not found")

        q = db.query(SentinelDetection).filter(SentinelDetection.zone_id == zone.id)
        if object_type:
            q = q.filter(SentinelDetection.object_type == object_type)
        if min_confidence is not None:
            q = q.filter(SentinelDetection.confidence >= min_confidence)
        if since:
            try:
                since_dt = _dt_wz.datetime.fromisoformat(since.replace("Z", "+00:00")).replace(tzinfo=None)
                q = q.filter(SentinelDetection.created_at >= since_dt)
            except Exception:
                pass
        detections = q.order_by(SentinelDetection.created_at.desc()).all()
        return [_detection_row_to_dict(d) for d in detections]


@app.get("/api/watch-zones/{system_id}/analytics")
def api_watch_zone_analytics(system_id: str):
    from database import WatchZone, SentinelScan, SentinelDetection, get_db
    import datetime as _dt_wz
    from collections import defaultdict

    with get_db() as db:
        zone = db.query(WatchZone).filter(WatchZone.system_id == system_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail=f"Watch zone {system_id} not found")

        all_scans = db.query(SentinelScan).filter(SentinelScan.zone_id == zone.id).all()
        all_detections = db.query(SentinelDetection).filter(SentinelDetection.zone_id == zone.id).all()

        now = _dt_wz.datetime.utcnow()
        cutoff_30 = now - _dt_wz.timedelta(days=30)

        scans_30 = [s for s in all_scans if s.created_at and s.created_at >= cutoff_30]

        det_by_type: dict = defaultdict(int)
        for d in all_detections:
            det_by_type[d.object_type] += 1

        # Detections over time — group by date
        det_by_date: dict = defaultdict(lambda: defaultdict(int))
        for d in all_detections:
            if d.created_at:
                day = d.created_at.strftime("%Y-%m-%d")
                det_by_date[day][d.object_type] += 1

        detections_over_time = []
        for day in sorted(det_by_date.keys()):
            entry = {"date": day, "count": sum(det_by_date[day].values()), "types": dict(det_by_date[day])}
            detections_over_time.append(entry)

        # Vessel trend — compare first half vs second half of 30-day window
        vessel_dets = [d for d in all_detections if d.object_type == "vessel" and d.created_at and d.created_at >= cutoff_30]
        mid = cutoff_30 + _dt_wz.timedelta(days=15)
        first_half = [d for d in vessel_dets if d.created_at < mid]
        second_half = [d for d in vessel_dets if d.created_at >= mid]
        if len(first_half) == 0:
            trend = "stable"
        elif len(second_half) > len(first_half) * 1.2:
            trend = "increasing"
        elif len(second_half) < len(first_half) * 0.8:
            trend = "decreasing"
        else:
            trend = "stable"

        # Vessel baseline: avg vessels per scan over all scans
        vessel_counts_per_scan = []
        for scan in all_scans:
            if scan.result_summary:
                try:
                    s = _json_wz.loads(scan.result_summary) if isinstance(scan.result_summary, str) else scan.result_summary
                    vc = (s.get("by_type") or {}).get("vessel", 0)
                    vessel_counts_per_scan.append(vc)
                except Exception:
                    pass
        baseline = sum(vessel_counts_per_scan) / len(vessel_counts_per_scan) if vessel_counts_per_scan else 0
        current = vessel_counts_per_scan[-1] if vessel_counts_per_scan else 0
        change_pct = ((current - baseline) / baseline * 100) if baseline > 0 else 0.0

        # Last fire / smoke detections
        fires = [d for d in all_detections if d.object_type == "fire" and d.created_at]
        smokes = [d for d in all_detections if d.object_type == "smoke_plume" and d.created_at]
        last_fire = max((d.created_at for d in fires), default=None)
        last_smoke = max((d.created_at for d in smokes), default=None)

        return {
            "zone_id":                   zone.system_id,
            "zone_name":                 zone.name,
            "scans_total":               len(all_scans),
            "scans_last_30_days":        len(scans_30),
            "detections_by_type":        dict(det_by_type),
            "detections_over_time":      detections_over_time,
            "vessel_activity_trend":     trend,
            "last_fire_detected":        last_fire.isoformat() if last_fire else None,
            "last_smoke_detected":       last_smoke.isoformat() if last_smoke else None,
            "baseline_vessel_count":     round(baseline, 2),
            "current_vessel_count":      float(current),
            "change_vs_baseline_pct":    round(change_pct, 1),
        }


@app.post("/api/watch-zones/{system_id}/scan-now")
async def api_watch_zone_scan_now(system_id: str):
    from database import WatchZone, SentinelScan, get_db
    import asyncio as _asyncio_wz, datetime as _dt_wz

    with get_db() as db:
        zone = db.query(WatchZone).filter(WatchZone.system_id == system_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail=f"Watch zone {system_id} not found")
        zone_dict = {
            "id": zone.id, "system_id": zone.system_id, "name": zone.name,
            "bbox_min_lon": zone.bbox_min_lon, "bbox_min_lat": zone.bbox_min_lat,
            "bbox_max_lon": zone.bbox_max_lon, "bbox_max_lat": zone.bbox_max_lat,
            "ml_tasks": zone.ml_tasks, "scan_interval_hours": zone.scan_interval_hours,
            "alert_threshold": zone.alert_threshold,
        }

    # Launch scan as background task — scanner creates its own scan record
    async def _run():
        try:
            from sentinel_scanner import SentinelScanner as _Sc
            await _asyncio_wz.get_event_loop().run_in_executor(
                None, lambda: _Sc().run_scan(zone_dict, triggered_by="manual")
            )
        except Exception as _e:
            print(f"[scan-now] scan error for {system_id}: {_e}")
    _asyncio_wz.ensure_future(_run())

    # Return a lightweight immediate response (scan_id assigned by scanner async)
    with get_db() as db:
        # Check if scanner already created the row (very fast start)
        latest = (db.query(SentinelScan)
                  .filter(SentinelScan.zone_id == zone_dict["id"],
                          SentinelScan.triggered_by == "manual")
                  .order_by(SentinelScan.id.desc()).first())
        if latest:
            return _scan_row_to_dict(latest)
    return {"scan_id": "pending", "status": "pending", "zone_id": system_id,
            "message": "Scan launched — check GET /api/watch-zones/{id}/scans for status"}


@app.get("/api/watch-zones/{zone_id}/scans/{scan_id}/detections")
def api_scan_detections(zone_id: str, scan_id: str):
    """Return all detections for a specific scan as a GeoJSON FeatureCollection."""
    from database import WatchZone, SentinelDetection, get_db

    with get_db() as db:
        zone = db.query(WatchZone).filter(WatchZone.system_id == zone_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail=f"Watch zone {zone_id} not found")

        dets = (
            db.query(SentinelDetection)
            .filter(
                SentinelDetection.zone_id == zone.id,
                SentinelDetection.scan_id == scan_id,
            )
            .order_by(SentinelDetection.id)
            .all()
        )

        features = []
        for d in dets:
            props = {
                "detection_id":   d.detection_id,
                "object_type":    d.object_type,
                "confidence":     d.confidence,
                "severity":       d.severity,
                "alert_tier":     d.alert_tier,
                "matched_to_ais": d.matched_to_ais,
                "area_m2":        d.area_m2,
                "scan_id":        d.scan_id,
                "zone_id":        zone_id,
                "created_at":     d.created_at.isoformat() if d.created_at else None,
            }
            attrs = {}
            if d.attributes:
                try:
                    attrs = _json_wz.loads(d.attributes)
                except Exception:
                    pass
            props.update(attrs)

            # Point feature — centroid
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [d.centroid_lon, d.centroid_lat]},
                "properties": {**props, "feature_role": "centroid"},
            })

            # Polygon feature — geo_bbox if present
            if d.geo_geometry:
                try:
                    geo = _json_wz.loads(d.geo_geometry) if isinstance(d.geo_geometry, str) else d.geo_geometry
                    features.append({
                        "type": "Feature",
                        "geometry": geo,
                        "properties": {**props, "feature_role": "bbox", "parent_detection_id": d.detection_id},
                    })
                except Exception:
                    pass

        return {
            "type": "FeatureCollection",
            "features": features,
            "scan_id": scan_id,
            "zone_id": zone_id,
            "total_detections": len(dets),
        }


# ── Debug: news pipeline status ───────────────────────────────────────────────

@app.get("/api/debug/news-status")
async def debug_news_status():
    """Comprehensive news pipeline diagnostic — no auth required for emergency triage."""
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc)

    # Article store
    with _NEWS_STORE_LOCK:
        store_count = len(_NEWS_ARTICLE_STORE)
        store_articles = list(_NEWS_ARTICLE_STORE.values())

    newest_article = None
    oldest_article = None
    with_coords = 0
    if store_articles:
        store_articles_sorted = sorted(store_articles, key=lambda a: a.get("published", ""), reverse=True)
        newest_article = store_articles_sorted[0]
        oldest_article = store_articles_sorted[-1]
        with_coords = sum(1 for a in store_articles if a.get("lat") is not None)

    # Compute freshness of newest
    newest_age_h = None
    if newest_article:
        try:
            pub = newest_article.get("published") or ""
            newest_age_h = (now - _dt.datetime.fromisoformat(pub)).total_seconds() / 3600
        except Exception:
            pass

    # Conflict markers
    markers_count = len(_NEWS_CONFLICT_MARKERS)
    marker_sample = []
    if _NEWS_CONFLICT_MARKERS:
        for m in _NEWS_CONFLICT_MARKERS[:5]:
            marker_sample.append({"title": (m.get("title") or "?")[:70], "published": m.get("published", "?")[:16]})

    # Dedup cache
    dedup_count = len(_PROCESSED_URLS)
    dedup_oldest_ts = None
    if _PROCESSED_URLS and isinstance(_PROCESSED_URLS, dict):
        try:
            dedup_oldest_ts = _dt.datetime.fromtimestamp(min(_PROCESSED_URLS.values()), tz=_dt.timezone.utc).isoformat()
        except Exception:
            pass

    # Surface pool
    with _SURFACE_POOL_LOCK:
        surface_count = len(_SURFACE_POOL)

    # Feed run stats
    with _FEED_RUN_STATS_LOCK:
        feed_stats = dict(_FEED_RUN_STATS)

    return {
        "timestamp": now.isoformat(),
        "news_window_hours": _NEWS_WINDOW_HOURS,
        "article_store": {
            "count": store_count,
            "with_coords": with_coords,
            "without_coords": store_count - with_coords,
            "newest_title": (newest_article.get("title") or "?")[:80] if newest_article else None,
            "newest_published": (newest_article.get("published") or "?")[:16] if newest_article else None,
            "newest_age_hours": round(newest_age_h, 1) if newest_age_h is not None else None,
            "oldest_published": (oldest_article.get("published") or "?")[:16] if oldest_article else None,
        },
        "conflict_markers": {
            "count": markers_count,
            "sample": marker_sample,
        },
        "dedup_cache": {
            "count": dedup_count,
            "type": "dict_ttl_72h",
            "oldest_entry_at": dedup_oldest_ts,
        },
        "surface_pool": {"count": surface_count},
        "feed_stats": {
            "feeds_total": feed_stats.get("feeds_total", 0),
            "feeds_ok": feed_stats.get("feeds_ok", 0),
            "last_run_at": feed_stats.get("last_run_at"),
        },
        "first_extraction_done": _FIRST_EXTRACTION_DONE,
    }


# ── Debug: feed freshness ─────────────────────────────────────────────────────

@app.get("/api/debug/feed-freshness")
async def debug_feed_freshness(current_user=Depends(get_optional_user)):
    """Check each RSS feed's latest article age — shows which feeds are returning fresh content."""
    import datetime as _dt
    results = []
    def _check_feed(args):
        sn, fu = args
        try:
            parsed = feedparser.parse(fu, agent="Mozilla/5.0", request_headers={"Accept": "application/rss+xml, application/xml, text/xml"})
            if not parsed.entries:
                return {"feed": sn, "url": fu[:80], "entries": 0, "age_hours": None, "fresh": False}
            entry = parsed.entries[0]
            pp = entry.get("published_parsed") or entry.get("updated_parsed")
            if pp:
                pub_dt = _dt.datetime(*pp[:6], tzinfo=_dt.timezone.utc)
                age_h = (_dt.datetime.now(_dt.timezone.utc) - pub_dt).total_seconds() / 3600
            else:
                age_h = None
            return {
                "feed":       sn,
                "url":        fu[:80],
                "entries":    len(parsed.entries),
                "latest":     entry.get("title", "?")[:70],
                "age_hours":  round(age_h, 1) if age_h is not None else None,
                "fresh":      age_h is not None and age_h < 24,
            }
        except Exception as ex:
            return {"feed": sn, "url": fu[:80], "error": str(ex)[:80], "fresh": False}

    from concurrent.futures import ThreadPoolExecutor as _FreshTPE
    import asyncio as _aio
    loop = _aio.get_event_loop()
    results = await loop.run_in_executor(
        _executor,
        lambda: list(_FreshTPE(max_workers=20).map(_check_feed, _SCAN_FEEDS)),
    )
    results.sort(key=lambda x: x.get("age_hours") or 9999)
    fresh_count = sum(1 for r in results if r.get("fresh"))
    return {
        "total_feeds":  len(results),
        "fresh_feeds":  fresh_count,
        "stale_feeds":  len(results) - fresh_count,
        "processed_url_cache_size": len(_PROCESSED_URLS),
        "feeds": results,
    }


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


# ══════════════════════════════════════════════════════════════════════════════
# Forge — Intelligence Training Lab (admin-only)
# Data stored as JSON files in DATA_DIR/forge/
# ══════════════════════════════════════════════════════════════════════════════

_FORGE_DIR      = Path(DATA_DIR) / "forge"
_FORGE_PASSCODE = "2212429391"


async def _require_forge(request: Request):
    """Accept either the forge passcode header OR a valid admin Bearer token."""
    if request.headers.get("X-Forge-Passcode", "") == _FORGE_PASSCODE:
        return True
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            user = await _get_user_from_token(auth.split(" ", 1)[1])
            if user and getattr(user, "is_admin", False):
                return True
        except Exception:
            pass
    raise HTTPException(status_code=401, detail="Forge access denied")


@app.post("/api/forge/auth")
async def forge_auth(request: Request):
    """Passcode-only access gate — no login required."""
    body     = await request.json()
    passcode = body.get("passcode", "")
    if passcode == _FORGE_PASSCODE:
        ts = int(datetime.utcnow().timestamp())
        return {"access": True, "token": f"forge_{ts}"}
    return JSONResponse({"access": False, "error": "Invalid passcode"}, status_code=401)

def _forge_load(filename: str) -> list:
    path = _FORGE_DIR / filename
    if not path.exists():
        return []
    try:
        return _json.loads(path.read_text())
    except Exception:
        return []

def _forge_save(filename: str, data: list):
    _FORGE_DIR.mkdir(parents=True, exist_ok=True)
    (_FORGE_DIR / filename).write_text(_json.dumps(data, indent=2, ensure_ascii=False))


_FORGE_UPLOAD_DIR = _FORGE_DIR / "uploads"


def _load_forge_rules() -> list:
    return _forge_load("rules.json")


def _guess_entity_type(type_str: str, has_mmsi: bool) -> str:
    t = (type_str or "").lower()
    if has_mmsi or "vessel" in t or "ship" in t or "tanker" in t: return "vessel"
    if "aircraft" in t or "plane" in t or "heli" in t: return "aircraft"
    if "port" in t: return "port"
    if "airport" in t or "airbase" in t or "air base" in t: return "airport"
    if "cable" in t: return "cable"
    if "pipeline" in t or "power" in t or "energy" in t: return "facility"
    if "military" in t or "base" in t or "camp" in t: return "facility"
    if "person" in t or "leader" in t: return "person"
    if "group" in t or "militia" in t or "organization" in t: return "group"
    return "facility"


def _add_entities_to_ontology(entities: list):
    ontology = _forge_ontology_load()
    changed = False
    for entity in entities:
        existing = next(
            (n for n in ontology["nodes"] if n["label"].lower() == entity["label"].lower()),
            None,
        )
        if existing:
            if entity.get("lat") and not existing.get("lat"):
                existing["lat"] = entity["lat"]
                existing["lng"] = entity.get("lng")
                changed = True
            continue
        safe_label = entity["label"][:20].replace(" ", "_").lower()
        node_id = f"{entity['type']}_{len(ontology['nodes'])+1}_{safe_label}"
        ontology["nodes"].append({
            "id":          node_id,
            "type":        entity["type"],
            "label":       entity["label"],
            "description": entity.get("description", ""),
            "lat":         entity.get("lat"),
            "lng":         entity.get("lng"),
            "source":      "upload",
        })
        changed = True
    if changed:
        _forge_ontology_save(ontology)


async def _process_csv_upload(filepath: str, description: str) -> dict:
    import csv as _csv2
    entities = []
    try:
        with open(filepath, newline="", encoding="utf-8-sig") as f:
            reader = _csv2.DictReader(f)
            headers = list(reader.fieldnames or [])
            lat_col  = next((h for h in headers if h.lower() in ("lat", "latitude", "y")), None)
            lng_col  = next((h for h in headers if h.lower() in ("lng", "lon", "longitude", "x")), None)
            name_col = next((h for h in headers if h.lower() in ("name", "title", "label", "vessel_name", "facility")), None)
            type_col = next((h for h in headers if h.lower() in ("type", "category", "kind")), None)
            mmsi_col = next((h for h in headers if h.lower() in ("mmsi", "imo")), None)
            has_mmsi = mmsi_col is not None
            for row in reader:
                try:
                    lat = float(row[lat_col]) if lat_col and row.get(lat_col) else None
                    lng = float(row[lng_col]) if lng_col and row.get(lng_col) else None
                except (ValueError, TypeError):
                    lat = lng = None
                entities.append({
                    "label": (row.get(name_col) or f"Entity {len(entities)+1}") if name_col else f"Entity {len(entities)+1}",
                    "type":  _guess_entity_type(row.get(type_col, "") if type_col else "", has_mmsi),
                    "lat":   lat,
                    "lng":   lng,
                })
    except Exception as exc:
        return {"status": "error", "entities_extracted": 0, "details": {"error": str(exc)}}
    _add_entities_to_ontology(entities)
    return {
        "status": "processed",
        "entities_extracted": len(entities),
        "details": {"columns": headers, "rows": len(entities), "has_coordinates": lat_col is not None and lng_col is not None},
    }


async def _process_kml_upload(filepath: str, description: str) -> dict:
    from xml.etree import ElementTree as ET
    try:
        tree = ET.parse(filepath)
        root = tree.getroot()
        ns   = "{http://www.opengis.net/kml/2.2}"
        entities = []
        for placemark in root.iter(f"{ns}Placemark"):
            name_el = placemark.find(f"{ns}name")
            name    = (name_el.text or "Unnamed") if name_el is not None else "Unnamed"
            desc_el = placemark.find(f"{ns}description")
            desc    = (desc_el.text or "") if desc_el is not None else ""
            coords  = []
            for coord_el in placemark.iter(f"{ns}coordinates"):
                if coord_el.text:
                    for c in coord_el.text.strip().split():
                        parts = c.split(",")
                        if len(parts) >= 2:
                            try:
                                coords.append((float(parts[1]), float(parts[0])))
                            except ValueError:
                                pass
            if coords:
                entities.append({
                    "label":       name,
                    "description": desc,
                    "type":        "facility" if len(coords) == 1 else "route",
                    "lat":         coords[0][0],
                    "lng":         coords[0][1],
                })
        _add_entities_to_ontology(entities)
        return {"status": "processed", "entities_extracted": len(entities), "details": {"placemarks": len(entities)}}
    except Exception as exc:
        return {"status": "error", "entities_extracted": 0, "details": {"error": str(exc)}}


async def _process_geojson_upload(filepath: str, description: str) -> dict:
    try:
        with open(filepath, encoding="utf-8") as f:
            data = _json.load(f)
        features = data.get("features", []) if data.get("type") == "FeatureCollection" else [data]
        entities = []
        for feat in features:
            props = feat.get("properties") or {}
            geom  = feat.get("geometry") or {}
            lat = lng = None
            gtype = geom.get("type", "")
            coords = geom.get("coordinates", [])
            if gtype == "Point" and len(coords) >= 2:
                lng, lat = float(coords[0]), float(coords[1])
            elif gtype == "LineString" and coords:
                mid = coords[len(coords) // 2]
                lng, lat = float(mid[0]), float(mid[1])
            elif gtype == "Polygon" and coords:
                ring = coords[0]
                if ring:
                    lat = sum(c[1] for c in ring) / len(ring)
                    lng = sum(c[0] for c in ring) / len(ring)
            entities.append({
                "label": props.get("name") or props.get("NAME") or f"Feature {len(entities)+1}",
                "type":  _guess_entity_type(props.get("type", ""), False),
                "lat":   lat,
                "lng":   lng,
            })
        _add_entities_to_ontology(entities)
        return {"status": "processed", "entities_extracted": len(entities), "details": {"features": len(features)}}
    except Exception as exc:
        return {"status": "error", "entities_extracted": 0, "details": {"error": str(exc)}}


async def _process_document_upload(filepath: str, description: str) -> dict:
    ext  = filepath.rsplit(".", 1)[-1].lower() if "." in filepath else ""
    text = ""
    if ext == "pdf":
        try:
            import pdfplumber
            with pdfplumber.open(filepath) as pdf:
                for page in pdf.pages[:20]:
                    text += page.extract_text() or ""
        except Exception:
            text = ""
    if not text:
        try:
            with open(filepath, encoding="utf-8", errors="replace") as f:
                text = f.read(50000)
        except Exception:
            pass
    if not text.strip():
        return {"status": "error", "entities_extracted": 0, "details": {"error": "No text extracted"}}
    if not client:
        return {"status": "error", "entities_extracted": 0, "details": {"error": "ANTHROPIC_API_KEY not set"}}
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            messages=[{"role": "user", "content": (
                "Extract all named entities from this intelligence document. "
                "Return ONLY a JSON array of objects, no other text.\n"
                'Each object: {"name":"entity name","type":"person|country|organization|facility|weapon|vessel|aircraft|event","description":"brief description","lat":null,"lng":null}\n'
                "If you know the approximate coordinates, include them. Otherwise leave null.\n\n"
                f"Document:\n{text[:30000]}"
            )}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        entities_raw = _json.loads(raw)
    except Exception:
        entities_raw = []
    entities = [
        {"label": e.get("name", "Unknown"), "type": e.get("type", "facility"),
         "description": e.get("description", ""), "lat": e.get("lat"), "lng": e.get("lng")}
        for e in entities_raw
    ]
    _add_entities_to_ontology(entities)
    return {
        "status": "processed",
        "entities_extracted": len(entities),
        "details": {"text_length": len(text), "claude_extracted": len(entities_raw)},
    }


# ── Upload endpoints ──────────────────────────────────────────────────────────

@app.post("/api/forge/upload")
async def forge_upload(
    file: UploadFile = File(...),
    mission_id: str  = Form("mission_default"),
    data_type: str   = Form("auto"),
    description: str = Form(""),
    _forge=Depends(_require_forge),
):
    _FORGE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    ts       = int(datetime.utcnow().timestamp())
    filename = f"{ts}_{file.filename}"
    filepath = str(_FORGE_UPLOAD_DIR / filename)
    with open(filepath, "wb") as fout:
        _shutil.copyfileobj(file.file, fout)

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if data_type == "auto":
        data_type = {
            "kml": "kml", "kmz": "kml",
            "csv": "csv",
            "geojson": "geojson", "json": "geojson",
            "pdf": "document", "txt": "document", "doc": "document", "docx": "document",
            "png": "imagery", "jpg": "imagery", "jpeg": "imagery",
            "tif": "imagery", "tiff": "imagery",
        }.get(ext, "document")

    if   data_type == "csv":      result = await _process_csv_upload(filepath, description)
    elif data_type == "kml":      result = await _process_kml_upload(filepath, description)
    elif data_type == "geojson":  result = await _process_geojson_upload(filepath, description)
    elif data_type == "document": result = await _process_document_upload(filepath, description)
    else:                         result = {"status": "stored", "entities_extracted": 0, "details": {}}

    uploads = _forge_load("uploads.json")
    record = {
        "id":                 f"upload_{len(uploads)}_{ts}",
        "filename":           file.filename,
        "stored_as":          filename,
        "type":               data_type,
        "description":        description,
        "mission_id":         mission_id,
        "uploaded_by":        getattr(_forge, "email", "admin"),
        "uploaded_at":        datetime.utcnow().isoformat(),
        "entities_extracted": result.get("entities_extracted", 0),
        "rules_generated":    result.get("rules_generated", 0),
        "status":             result.get("status", "processed"),
        "details":            result.get("details", {}),
    }
    uploads.append(record)
    _forge_save("uploads.json", uploads)
    return record


@app.get("/api/forge/uploads")
def forge_get_uploads(_forge=Depends(_require_forge)):
    uploads = _forge_load("uploads.json")
    return list(reversed(uploads))


# ── Auto-rule generation ──────────────────────────────────────────────────────

@app.post("/api/forge/auto-generate-rules")
async def forge_auto_generate_rules(request: Request, _forge=Depends(_require_forge)):
    body        = await request.json()
    mission_id  = body.get("mission_id", "mission_default")
    ontology    = _forge_ontology_load()
    existing    = _load_forge_rules()
    exist_names = {r["name"] for r in existing}
    new_rules   = []

    def _next_id():
        return f"rule_auto_{len(existing) + len(new_rules) + 1}_{int(datetime.utcnow().timestamp())}"

    for cable in (n for n in ontology["nodes"] if n["type"] == "cable"):
        name = f"Cable Loiterer — {cable['label'][:30]}"
        if name not in exist_names:
            new_rules.append({
                "id": _next_id(), "name": name,
                "description": f"Vessel stationary near {cable['label']}",
                "source": "AIS", "trigger_type": "stationary_near_infrastructure",
                "status": "active", "triggers": 0, "lastTrigger": "never",
                "params": {"infra_type": "cable", "infra_name": cable["label"],
                           "max_speed_knots": 0.5, "proximity_km": 10, "min_duration_minutes": 120},
                "severity": "high", "auto_generated": True, "entity_id": cable.get("id"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            exist_names.add(name)

    for cp in (n for n in ontology["nodes"] if n["type"] == "chokepoint"):
        name = f"Dark Ship — {cp['label'][:30]}"
        if name not in exist_names:
            new_rules.append({
                "id": _next_id(), "name": name,
                "description": f"AIS transponder gap near {cp['label']}",
                "source": "AIS", "trigger_type": "transponder_gap",
                "status": "active", "triggers": 0, "lastTrigger": "never",
                "params": {"gap_minutes": 30, "proximity_km": 100, "chokepoint": cp["label"]},
                "severity": "high", "auto_generated": True, "entity_id": cp.get("id"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            exist_names.add(name)

    fac_count = 0
    for fac in (n for n in ontology["nodes"] if n["type"] in ("facility", "airport") and n.get("lat")):
        if fac_count >= 10:
            break
        name = f"Satellite Watch — {fac['label'][:30]}"
        if name not in exist_names:
            new_rules.append({
                "id": _next_id(), "name": name,
                "description": f"Weekly satellite scan of {fac['label']}",
                "source": "SATELLITE", "trigger_type": "change_detection",
                "status": "active", "triggers": 0, "lastTrigger": "never",
                "params": {"lat": fac["lat"], "lng": fac["lng"], "frequency": "weekly", "change_threshold_pct": 20},
                "severity": "medium", "auto_generated": True, "entity_id": fac.get("id"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            exist_names.add(name)
            fac_count += 1

    nodes_by_id = {n["id"]: n for n in ontology["nodes"]}
    for edge in ontology.get("edges", []):
        if edge.get("type") not in ("threatens", "operates"):
            continue
        src = nodes_by_id.get(edge.get("source"))
        tgt = nodes_by_id.get(edge.get("target"))
        if src and tgt and src["type"] == "group" and tgt["type"] in ("country", "chokepoint"):
            name = f"News Surge — {src['label']} / {tgt['label']}"
            if name not in exist_names:
                new_rules.append({
                    "id": _next_id(), "name": name,
                    "description": f"Elevated news mentioning {src['label']} and {tgt['label']}",
                    "source": "NEWS", "trigger_type": "event_surge",
                    "status": "active", "triggers": 0, "lastTrigger": "never",
                    "params": {"keywords": [src["label"], tgt["label"]], "multiplier": 2, "window_days": 7},
                    "severity": "medium", "auto_generated": True,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                exist_names.add(name)

    if new_rules:
        _forge_save("rules.json", existing + new_rules)

    return {"rules_generated": len(new_rules), "rules": new_rules}


@app.get("/api/forge/rules")
def forge_get_rules(_forge=Depends(_require_forge)):
    return {"rules": _forge_load("rules.json")}


@app.post("/api/forge/rules")
async def forge_create_rule(request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    rules = _forge_load("rules.json")
    rule = {
        "id":          str(uuid.uuid4()),
        "name":        body.get("name", "Unnamed Rule"),
        "source":      body.get("source", "AIS"),
        "trigger_type": body.get("trigger_type", ""),
        "description": body.get("description", ""),
        "status":      body.get("status", "active"),
        "triggers":    0,
        "lastTrigger": "never",
        "created_at":  datetime.now(timezone.utc).isoformat(),
    }
    rules.insert(0, rule)
    _forge_save("rules.json", rules)
    return rule


@app.put("/api/forge/rules/{rule_id}")
async def forge_update_rule(rule_id: str, request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    rules = _forge_load("rules.json")
    for i, r in enumerate(rules):
        if r.get("id") == rule_id:
            rules[i] = {**r, **{k: v for k, v in body.items() if k != "id"}}
            _forge_save("rules.json", rules)
            return rules[i]
    raise HTTPException(status_code=404, detail="Rule not found")


@app.delete("/api/forge/rules/{rule_id}")
def forge_delete_rule(rule_id: str, _forge=Depends(_require_forge)):
    rules = _forge_load("rules.json")
    rules = [r for r in rules if r.get("id") != rule_id]
    _forge_save("rules.json", rules)
    return {"ok": True}


@app.get("/api/forge/watch-areas")
def forge_get_watch_areas(_forge=Depends(_require_forge)):
    return {"areas": _forge_load("watch_areas.json")}


@app.post("/api/forge/watch-areas")
async def forge_create_watch_area(request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    areas = _forge_load("watch_areas.json")
    area = {
        "id":         str(uuid.uuid4()),
        "name":       body.get("name", "Unnamed Area"),
        "coords":     body.get("coords", ""),
        "lat":        body.get("lat"),
        "lon":        body.get("lon"),
        "frequency":  body.get("frequency", "Weekly"),
        "lastScan":   "never",
        "detections": 0,
        "change":     "No data",
        "status":     "normal",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    areas.insert(0, area)
    _forge_save("watch_areas.json", areas)
    return area


@app.delete("/api/forge/watch-areas/{area_id}")
def forge_delete_watch_area(area_id: str, _forge=Depends(_require_forge)):
    areas = _forge_load("watch_areas.json")
    areas = [a for a in areas if a.get("id") != area_id]
    _forge_save("watch_areas.json", areas)
    return {"ok": True}


@app.post("/api/forge/watch-areas/{area_id}/scan")
async def forge_scan_watch_area(area_id: str, request: Request, _forge=Depends(_require_forge)):
    areas = _forge_load("watch_areas.json")
    area  = next((a for a in areas if a.get("id") == area_id), None)
    if not area:
        raise HTTPException(status_code=404, detail="Watch area not found")

    bounds = area.get("bounds")
    if not bounds and area.get("lat") and area.get("lng"):
        lat, lng = float(area["lat"]), float(area.get("lng") or area.get("lon", 0))
        delta = 0.5
        bounds = [lat - delta, lng - delta, lat + delta, lng + delta]
    if not bounds:
        raise HTTPException(status_code=422, detail="Watch area has no bounds or coordinates")

    try:
        loop  = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            functools.partial(_run_overwatch_inference, bounds, 17, 0.2, False, "dota"),
        )
        detections = result.get("detections", []) if isinstance(result, dict) else []
    except Exception as _se:
        detections = []
        print(f"[forge/scan] {area_id} error: {_se}")

    now = datetime.now(timezone.utc).isoformat()
    for a in areas:
        if a.get("id") == area_id:
            a["last_scan"]   = now
            a["detections"]  = len(detections)
            a["last_change"] = now
            a["status"]      = "alert" if len(detections) > (a.get("baseline_detections") or 0) else "ok"
            break
    _forge_save("watch_areas.json", areas)
    return {"ok": True, "detections": len(detections), "last_scan": now, "status": areas[next((i for i, a in enumerate(areas) if a.get("id") == area_id), 0)].get("status")}


@app.get("/api/forge/brain-status")
def forge_brain_status(_forge=Depends(_require_forge)):
    return {
        **_last_cycle_stats,
        "detector_ready": _HAS_DETECTORS,
        "alerts_in_memory": len(_forge_alerts),
        "correlations_in_memory": len(_correlation_assessments),
    }


@app.get("/api/forge/detections")
def forge_get_detections(_forge=Depends(_require_forge)):
    return {"detections": _forge_load("detection_corrections.json")}


@app.post("/api/forge/detection/{detection_id}/confirm")
def forge_confirm_detection(detection_id: str, _forge=Depends(_require_forge)):
    items = _forge_load("detection_corrections.json")
    for item in items:
        if item.get("id") == detection_id:
            item["review"] = "confirmed"
            item["reviewed_at"] = datetime.now(timezone.utc).isoformat()
            break
    else:
        items.append({"id": detection_id, "review": "confirmed", "reviewed_at": datetime.now(timezone.utc).isoformat()})
    _forge_save("detection_corrections.json", items)
    return {"ok": True}


@app.post("/api/forge/detection/{detection_id}/correct")
async def forge_correct_detection(detection_id: str, request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    items = _forge_load("detection_corrections.json")
    for item in items:
        if item.get("id") == detection_id:
            item["review"] = "corrected"
            item["correct_label"] = body.get("label")
            item["reviewed_at"] = datetime.now(timezone.utc).isoformat()
            break
    else:
        items.append({
            "id": detection_id,
            "review": "corrected",
            "correct_label": body.get("label"),
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        })
    _forge_save("detection_corrections.json", items)
    return {"ok": True}


# ── Forge Phase 2: batch scan helper ──────────────────────────────────────────

_FORGE_SCAN_SITES = [
    {"name": "Isfahan Air Base",    "lat": 32.64, "lon": 51.68},
    {"name": "Bandar Abbas Naval",  "lat": 27.18, "lon": 56.28},
    {"name": "Hmeimim Air Base",    "lat": 35.41, "lon": 35.95},
    {"name": "Tartus Naval Base",   "lat": 34.89, "lon": 35.87},
    {"name": "Latakia Port",        "lat": 35.52, "lon": 35.77},
    {"name": "Erebuni Airport",     "lat": 40.12, "lon": 44.46},
    {"name": "Tabriz Airport",      "lat": 38.13, "lon": 46.23},
    {"name": "Natanz Nuclear",      "lat": 33.72, "lon": 51.73},
    {"name": "Bushehr Naval",       "lat": 28.92, "lon": 50.83},
    {"name": "Karachi Port",        "lat": 24.84, "lon": 67.02},
]

_FORGE_CLASS_COLORS = {
    "plane":              "#4A9EE0",
    "helicopter":         "#4A9EE0",
    "helicopter-pad":     "#4A9EE0",
    "ship":               "#5BC97F",
    "harbor":             "#5BC97F",
    "storage-tank":       "#E8B23A",
    "large-vehicle":      "#E8B23A",
    "small-vehicle":      "#E8B23A",
    "vehicle":            "#E8B23A",
    "bridge":             "#9AA4B5",
    "roundabout":         "#9AA4B5",
    "baseball-diamond":   "#9AA4B5",
    "tennis-court":       "#9AA4B5",
    "basketball-court":   "#9AA4B5",
    "ground-track-field": "#9AA4B5",
    "soccer-ball-field":  "#9AA4B5",
    "swimming-pool":      "#22d3ee",
}


def _run_batch_scan_for_site(site, zoom=15):
    """Fetch satellite tiles, run ONNX (or mock), return detections with crop_image / full_image / bbox overlays."""
    import random, base64, io
    from PIL import Image

    lat, lon = float(site["lat"]), float(site["lon"])
    pad = 0.012  # ~1.2 km radius
    TILE_SZ   = 256
    CROP_SIZE = 160  # px crop thumbnail
    MAX_FULL  = 512  # max dimension of full_image

    x_min = int(_ow_lon_to_tile_x_frac(lon - pad, zoom))
    x_max = int(_ow_lon_to_tile_x_frac(lon + pad, zoom))
    y_min = int(_ow_lat_to_tile_y_frac(lat + pad, zoom))
    y_max = int(_ow_lat_to_tile_y_frac(lat - pad, zoom))
    x_min, x_max = min(x_min, x_max), max(x_min, x_max)
    y_min, y_max = min(y_min, y_max), max(y_min, y_max)

    stitch_w = (x_max - x_min + 1) * TILE_SZ
    stitch_h = (y_max - y_min + 1) * TILE_SZ
    stitched = Image.new("RGB", (stitch_w, stitch_h))

    for xi in range(x_min, x_max + 1):
        for yi in range(y_min, y_max + 1):
            try:
                tile = _fetch_esri_tile(zoom, xi, yi)
                stitched.paste(tile, ((xi - x_min) * TILE_SZ, (yi - y_min) * TILE_SZ))
            except Exception as e:
                print(f"[forge/batch] tile {zoom}/{xi}/{yi} failed: {e}")

    img_w, img_h = stitched.size

    def px_lat(py): return float((lat + pad) - (py / img_h) * (2 * pad))
    def px_lon(px_): return float((lon - pad) + (px_ / img_w) * (2 * pad))

    try:
        _rf = Image.Resampling.LANCZOS
    except AttributeError:
        _rf = Image.ANTIALIAS  # Pillow < 9

    # Encode full stitched image at reduced size
    full_thumb = stitched.copy()
    full_thumb.thumbnail((MAX_FULL, MAX_FULL), _rf)
    _fbuf = io.BytesIO()
    full_thumb.save(_fbuf, "JPEG", quality=72)
    full_b64 = base64.b64encode(_fbuf.getvalue()).decode()
    del full_thumb, _fbuf
    full_w = min(img_w, MAX_FULL)
    full_h = min(img_h, MAX_FULL)
    scale_x = full_w / img_w
    scale_y = full_h / img_h

    def make_crop_b64(x1, y1, x2, y2, px=28):
        cx1 = max(0, x1 - px);  cy1 = max(0, y1 - px)
        cx2 = min(img_w, x2 + px); cy2 = min(img_h, y2 + px)
        crop = stitched.crop((cx1, cy1, cx2, cy2)).resize((CROP_SIZE, CROP_SIZE), _rf)
        buf = io.BytesIO(); crop.save(buf, "JPEG", quality=75)
        cw = cx2 - cx1; ch = cy2 - cy1
        box = {
            "x": round((x1 - cx1) / cw * 100, 1),
            "y": round((y1 - cy1) / ch * 100, 1),
            "w": round((x2 - x1)  / cw * 100, 1),
            "h": round((y2 - y1)  / ch * 100, 1),
        }
        return base64.b64encode(buf.getvalue()).decode(), box

    session = _get_ort_session("dota")
    raw_dets = []  # list of (det, [x1,y1,x2,y2])

    if session is not None:
        bounds = {"north": lat + pad, "south": lat - pad, "east": lon + pad, "west": lon - pad}
        result = _run_inference_on_image(stitched, bounds, 0.35, False, "dota", keep_px=True)
        for det in result.get("detections", []):
            px_box = det.pop("_px", None)
            if not px_box:
                c = det.get("center", [lat, lon])
                cx = int((c[1] - (lon - pad)) / (2 * pad) * img_w)
                cy = int(((lat + pad) - c[0]) / (2 * pad) * img_h)
                px_box = [cx - 32, cy - 32, cx + 32, cy + 32]
            raw_dets.append((det, [int(v) for v in px_box]))
    else:
        MOCK_CLASSES = ["plane", "large-vehicle", "vehicle", "ship", "storage-tank", "helicopter-pad"]
        for _ in range(random.randint(2, 6)):
            cx = random.randint(64, img_w - 64)
            cy = random.randint(64, img_h - 64)
            w  = random.randint(28, 68); h = random.randint(28, 68)
            cls = random.choice(MOCK_CLASSES)
            raw_dets.append(({
                "class": cls, "category": "Object", "subcategory": "Unknown",
                "confidence": round(random.uniform(0.52, 0.91), 2),
                "center": [round(px_lat(cy), 5), round(px_lon(cx), 5)],
                "lat": round(px_lat(cy), 5), "lon": round(px_lon(cx), 5),
                "mock": True,
            }, [max(0, cx-w//2), max(0, cy-h//2), min(img_w, cx+w//2), min(img_h, cy+h//2)]))

    # Build all_detections as percentage positions in the (possibly downscaled) full_image
    all_dets_pct = []
    for det, (x1, y1, x2, y2) in raw_dets:
        color = _FORGE_CLASS_COLORS.get((det.get("class") or "").lower(), "#38bdf8")
        all_dets_pct.append({
            "label":      det.get("class", "unknown"),
            "confidence": det.get("confidence", 0),
            "x_pct":      round(x1 * scale_x / full_w * 100, 1),
            "y_pct":      round(y1 * scale_y / full_h * 100, 1),
            "w_pct":      round((x2 - x1) * scale_x / full_w * 100, 1),
            "h_pct":      round((y2 - y1) * scale_y / full_h * 100, 1),
            "color":      color,
        })

    detections_out = []
    for det, (x1, y1, x2, y2) in raw_dets:
        cls_name = (det.get("class") or "unknown").lower()
        color    = _FORGE_CLASS_COLORS.get(cls_name, "#38bdf8")
        crop_b64, box_in_crop = make_crop_b64(x1, y1, x2, y2)
        det.update({
            "id":             str(uuid.uuid4()),
            "site":           site["name"],
            "crop_image":     crop_b64,
            "full_image":     full_b64,
            "box_in_crop":    box_in_crop,
            "all_detections": all_dets_pct,
            "color":          color,
        })
        detections_out.append(det)

    import gc
    del stitched
    gc.collect()
    return detections_out


# ── Forge Phase 2: batch generation endpoints ──────────────────────────────────

@app.post("/api/forge/overwatch/generate-batch")
async def forge_overwatch_generate_batch(request: Request, _forge=Depends(_require_forge)):
    import functools, random
    body = await request.json()
    n = min(int(body.get("n", 10)), 20)

    sites = list(_FORGE_SCAN_SITES)
    for area in _forge_load("watch_areas.json"):
        if area.get("lat") and area.get("lon"):
            sites.append({"name": area["name"], "lat": area["lat"], "lon": area["lon"]})
    random.shuffle(sites)

    loop = asyncio.get_event_loop()
    all_detections = []
    for site in sites[:3]:
        try:
            dets = await loop.run_in_executor(None, functools.partial(_run_batch_scan_for_site, site))
            all_detections.extend(dets)
        except Exception as e:
            print(f"[forge/overwatch/batch] {site['name']} failed: {e}")

    random.shuffle(all_detections)
    result = all_detections[:n]
    return {"detections": result, "count": len(result)}


@app.post("/api/forge/ais/generate-batch")
async def forge_ais_generate_batch(request: Request, _forge=Depends(_require_forge)):
    import random
    body = await request.json()
    n = min(int(body.get("n", 20)), 50)

    vessels = [v for v in _AIS_VESSELS.values() if v.get("lat") and v.get("lon")]

    if len(vessels) < 5:
        MOCK_TYPES  = ["Tanker", "Cargo", "Container Ship", "Military", "Fishing", "Bulk Carrier", "General Cargo"]
        MOCK_FLAGS  = ["Iran", "Russia", "China", "Panama", "Marshall Islands", "Liberia", "Bahamas", "Singapore"]
        MOCK_DESTS  = ["Bandar Abbas", "Jeddah", "Shanghai", "Rotterdam", "Houston", "Novorossiysk", "Tartus", ""]
        vessels = []
        for _ in range(n):
            mmsi = str(random.randint(300000000, 799999999))
            vessels.append({
                "mmsi":        mmsi,
                "name":        f"VESSEL {random.randint(100, 999)}",
                "ship_type":   random.choice(MOCK_TYPES),
                "flag":        random.choice(MOCK_FLAGS),
                "lat":         round(random.uniform(15, 45), 4),
                "lon":         round(random.uniform(30, 80), 4),
                "speed":       round(random.uniform(0, 18), 1),
                "heading":     random.randint(0, 359),
                "destination": random.choice(MOCK_DESTS),
                "callsign":    f"A{random.randint(1000, 9999)}",
                "mock":        True,
            })
    else:
        random.shuffle(vessels)
        vessels = vessels[:n]

    for v in vessels:
        v["review_id"] = str(uuid.uuid4())

    return {"vessels": vessels, "count": len(vessels)}


@app.post("/api/forge/news/generate-batch")
async def forge_news_generate_batch(request: Request, _forge=Depends(_require_forge)):
    import random
    body = await request.json()
    n = min(int(body.get("n", 15)), 50)

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=72)).isoformat()
    with _NEWS_STORE_LOCK:
        candidates = [
            a for a in _NEWS_ARTICLE_STORE.values()
            if a.get("published", "") >= cutoff and a.get("title")
        ]

    if len(candidates) < 3:
        MOCK_TITLES = [
            "Iran IRGC Conducts Naval Exercise Near Strait of Hormuz",
            "Houthi Missile Strike Targets Red Sea Shipping Lane",
            "Russia Deploys Additional Forces to Hmeimim Air Base",
            "Sudan Armed Forces Report Ambush Near El Fasher",
            "Turkish Drone Strike Kills 12 PKK Militants in Northern Iraq",
            "China Expands Naval Base Facilities at Djibouti",
            "Al-Shabaab Claims Ambush on AU Convoy in Somalia",
            "Israeli Airstrikes Target Syrian Military Positions Near Deir ez-Zor",
        ]
        MOCK_TIERS   = ["critical", "significant", "elevated", "low"]
        MOCK_TYPES   = ["Conflict", "Explosion / Remote Violence", "Strategic Developments"]
        MOCK_SOURCES = ["Reuters", "AP", "BBC World", "Al Jazeera", "The Guardian"]
        candidates = []
        for i, title in enumerate(MOCK_TITLES):
            candidates.append({
                "id":            str(uuid.uuid4()),
                "url":           f"https://example.com/mock/{i}",
                "title":         title,
                "source":        random.choice(MOCK_SOURCES),
                "published":     (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 48))).isoformat(),
                "severity_tier": random.choice(MOCK_TIERS),
                "event_type":    random.choice(MOCK_TYPES),
                "lat":           round(random.uniform(10, 45), 3),
                "lon":           round(random.uniform(25, 75), 3),
                "mock":          True,
            })
    else:
        random.shuffle(candidates)
        candidates = candidates[:n]

    articles = []
    for a in candidates:
        articles.append({
            "id":            a.get("id") or a.get("url") or str(uuid.uuid4()),
            "url":           a.get("url", ""),
            "title":         a.get("title", ""),
            "source":        a.get("source") or a.get("feed_source") or "Unknown",
            "published":     a.get("published", ""),
            "severity_tier": a.get("severity_tier") or "elevated",
            "event_type":    a.get("event_type") or a.get("type") or "Conflict",
            "lat":           a.get("lat"),
            "lon":           a.get("lon"),
            "region":        a.get("region") or a.get("feed_region") or "",
            "mock":          a.get("mock", False),
        })

    return {"articles": articles, "count": len(articles)}


@app.post("/api/forge/detection/label")
async def forge_label_detection(request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    detection_id = body.get("id") or body.get("detection_id")
    if not detection_id:
        raise HTTPException(status_code=400, detail="id required")

    labels = _forge_load("forge_labels.json")
    entry = {
        "id":           detection_id,
        "label":        body.get("label"),
        "correction":   body.get("correction"),
        "source_type":  body.get("source_type", "overwatch"),
        "reason":       body.get("reason"),
        "severity":     body.get("severity"),
        "event_type":   body.get("event_type"),
        "labeled_at":   datetime.now(timezone.utc).isoformat(),
        "labeled_by":   getattr(_user, "email", None) or getattr(_user, "username", None),
    }
    for i, existing in enumerate(labels):
        if existing.get("id") == detection_id:
            labels[i] = entry
            _forge_save("forge_labels.json", labels)
            return {"ok": True}
    labels.insert(0, entry)
    _forge_save("forge_labels.json", labels)
    return {"ok": True}


@app.get("/api/forge/labels")
def forge_get_labels(_forge=Depends(_require_forge)):
    return {"labels": _forge_load("forge_labels.json")}


# ═══════════════════════════════════════════════════════════════════════════════
# FORGE DETECTION ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

def _auto_add_ontology_edge(alert: dict):
    """Automatically wire a detection alert into the ontology graph."""
    try:
        ontology = _forge_ontology_load()
        mmsi = alert.get("mmsi")
        if not mmsi:
            return
        vessel_id = f"vessel_{mmsi}"
        if not any(n["id"] == vessel_id for n in ontology["nodes"]):
            ontology["nodes"].append({
                "id":    vessel_id,
                "type":  "vessel",
                "label": alert.get("vessel") or f"MMSI:{mmsi}",
                "lat":   alert.get("lat"),
                "lng":   alert.get("lng"),
            })
        msg = (alert.get("message") or "").lower()
        # Connect vessel to a cable node it is threatening
        for node in ontology["nodes"]:
            if node["type"] != "cable":
                continue
            if node["label"].lower() in msg:
                edge_id = f"e_auto_{alert.get('rule_id')}_{mmsi}"
                if not any(e["id"] == edge_id for e in ontology["edges"]):
                    ontology["edges"].append({
                        "id":     edge_id,
                        "source": vessel_id,
                        "target": node["id"],
                        "type":   "threatens",
                        "auto":   True,
                    })
                break
        _forge_ontology_save(ontology)
    except Exception:
        pass


def _auto_add_correlation_to_ontology(assessment: dict):
    """Add a cross-domain correlation as a node in the ontology, linking related entities."""
    try:
        if not assessment.get("related_entities"):
            return
        ontology = _forge_ontology_load()
        corr_id = f"corr_{int(datetime.now(timezone.utc).timestamp())}"
        ontology["nodes"].append({
            "id":          corr_id,
            "type":        "correlation",
            "label":       f"{assessment['severity']}: {assessment['narrative'][:60]}",
            "description": assessment.get("recommendation", ""),
            "lat":         assessment.get("lat"),
            "lng":         assessment.get("lng"),
            "severity":    assessment["severity"],
            "confidence":  assessment.get("confidence"),
        })
        for entity in assessment.get("related_entities", []):
            edge_id = f"e_{corr_id}_{entity['id']}"
            if not any(e["id"] == edge_id for e in ontology["edges"]):
                ontology["edges"].append({
                    "id":     edge_id,
                    "source": corr_id,
                    "target": entity["id"],
                    "type":   "correlates_with",
                    "auto":   True,
                })
        _forge_ontology_save(ontology)
    except Exception:
        pass


def _prep_cables_for_detector():
    """Extract cable coordinate lists for proximity checks, sampled to cap CPU."""
    try:
        raw_cables = _get_cable_data().get("cables", [])
        result = []
        for feat in raw_cables[:60]:
            geom = (feat.get("geometry") or {})
            name = ((feat.get("properties") or {}).get("name") or "cable")
            coords: list = []
            if geom.get("type") == "LineString":
                coords = geom.get("coordinates", [])
            elif geom.get("type") == "MultiLineString":
                for seg in geom.get("coordinates", []):
                    coords.extend(seg)
            result.append({"name": name, "coordinates": coords[::8]})
        return result
    except Exception:
        return []


_CABLES_DB_CACHE: list = []
_CABLES_DB_CACHE_TS: float = 0.0
_CABLES_DB_CACHE_TTL: float = 300.0   # refresh every 5 min


def _prep_cables_from_db() -> list:
    """Load cable data from DB for loitering detection. Cached."""
    global _CABLES_DB_CACHE, _CABLES_DB_CACHE_TS
    import time as _time
    now = _time.time()
    if _CABLES_DB_CACHE and (now - _CABLES_DB_CACHE_TS) < _CABLES_DB_CACHE_TTL:
        return _CABLES_DB_CACHE
    try:
        from database import CableSegment, get_db
        with get_db() as _db:
            rows = _db.query(CableSegment).all()
        result = []
        for row in rows:
            geom = row.geometry or {}
            # Sample coords to cap CPU (every 8th point per segment)
            coords: list = []
            for seg in geom.get("coordinates", []):
                coords.extend(seg[::8])
            sampled_geom = {
                "type": geom.get("type", "MultiLineString"),
                "coordinates": [seg[::8] for seg in geom.get("coordinates", []) if seg],
            }
            result.append({
                "system_id": row.system_id,
                "cable_id":  row.cable_id,
                "name":      row.cable_name,
                "region_id": row.region_id,
                "geometry":  sampled_geom,
                "coordinates": coords,
            })
        _CABLES_DB_CACHE = result
        _CABLES_DB_CACHE_TS = now
        return result
    except Exception as _e:
        print(f"[cables-db] load error: {_e}")
        return _CABLES_DB_CACHE   # return stale cache on error


def _normalize_vessel(raw, mmsi=None):
    """Normalize AIS vessel data to consistent field names used by detectors."""
    if not raw:
        return None
    try:
        lat = float(raw.get("lat") or raw.get("latitude") or raw.get("Latitude") or 0)
        lng = float(
            raw.get("lng") or raw.get("lon") or raw.get("longitude") or raw.get("Longitude") or 0
        )
        if lat == 0 and lng == 0:
            return None
        return {
            "mmsi":        str(mmsi or raw.get("mmsi") or raw.get("MMSI") or ""),
            "name":        raw.get("name") or raw.get("shipName") or raw.get("ship_name") or raw.get("Name") or f"MMSI:{mmsi}",
            "lat":         lat,
            "lng":         lng,
            "speed":       float(raw.get("speed") or raw.get("sog") or raw.get("SpeedOverGround") or 0),
            "heading":     float(raw.get("heading") or raw.get("cog") or raw.get("CourseOverGround") or 0),
            "ship_type":   str(raw.get("ship_type") or raw.get("type") or raw.get("Type") or raw.get("shipType") or ""),
            "destination": str(raw.get("destination") or raw.get("Destination") or ""),
            "flag":        str(raw.get("flag") or raw.get("country") or raw.get("Flag") or ""),
        }
    except (ValueError, TypeError):
        return None


async def _forge_detection_cycle():
    """Run every 5 minutes: apply all active Forge rules to live data, then correlate."""
    global _forge_alerts, _correlation_assessments, _last_cycle_stats
    await asyncio.sleep(60)  # staggered startup
    while True:
        try:
            cycle_start = datetime.now(timezone.utc)

            # Bootstrap default rules on first run; backfill missing sources on subsequent runs
            rules = _forge_load("rules.json")
            try:
                from detectors.default_rules import DEFAULT_RULES as _DR
                if not rules:
                    rules = _DR
                    _forge_save("rules.json", rules)
                    print("[forge-brain] bootstrapped default rules")
                else:
                    existing_ids = {r.get("id") for r in rules}
                    added = [r for r in _DR if r.get("id") not in existing_ids]
                    if added:
                        rules = rules + added
                        _forge_save("rules.json", rules)
                        print(f"[forge-brain] backfilled {len(added)} missing default rules: {[r['id'] for r in added]}")
            except ImportError:
                if not rules:
                    rules = []
            active_rules = [r for r in rules if r.get("status") == "active"]

            cables = _prep_cables_for_detector()

            # Stage 1 — AIS anomaly detection
            _ais_detector.load_rules([r for r in active_rules if r.get("source") in ("AIS", "ais")])
            with _AIS_LOCK:
                vessels_snap = dict(_AIS_VESSELS)

            # Pre-normalize the entire AIS snapshot
            normalized_snap = {}
            for _m, _v in vessels_snap.items():
                _n = _normalize_vessel(_v, _m)
                if _n:
                    normalized_snap[_m] = _n

            new_ais_alerts: list = []
            vessels_checked = len(normalized_snap)
            for mmsi, vessel in normalized_snap.items():
                try:
                    hits = _ais_detector.check_vessel(
                        vessel,
                        cables=cables,
                        chokepoints=_CHOKEPOINT_DEFS,
                        all_vessels=normalized_snap,
                    )
                    new_ais_alerts.extend(hits)
                except Exception:
                    pass
            print(f"[forge-brain] Stage1 AIS: {vessels_checked} vessels → {len(new_ais_alerts)} alerts")

            # Stage 1b — Loitering near infrastructure (cables + ports)
            try:
                from database import RuleConfig, PortBoundary as _PB1b, get_db
                import json as _json_lc
                with get_db() as _ldb:
                    loiter_rule_rows = _ldb.query(RuleConfig).filter(
                        RuleConfig.rule_name.in_(["AIS_LOITERING_NEAR_CABLE", "AIS_LOITERING_NEAR_INFRA"]),
                        RuleConfig.enabled == True,
                    ).all()
                loiter_rules = [
                    {"id": r.id, "rule_name": r.rule_name, "enabled": r.enabled,
                     "params": _json_lc.loads(r.params) if isinstance(r.params, str) else r.params}
                    for r in loiter_rule_rows
                ]
                if loiter_rules:
                    # Split rules: cable rules vs port rules
                    cable_loiter_rules = [
                        r for r in loiter_rules
                        if (r["params"].get("infra_type") or "").lower() != "port"
                        and str(r["params"].get("target", "")).upper() != "PORTS:STRATEGIC"
                    ]
                    port_loiter_rules = [
                        r for r in loiter_rules
                        if (r["params"].get("infra_type") or "").lower() == "port"
                        or str(r["params"].get("target", "")).upper() == "PORTS:STRATEGIC"
                    ]

                    cables_db = _prep_cables_from_db() if cable_loiter_rules else []
                    # Load all ports for port loitering rules
                    ports_db: list = []
                    if port_loiter_rules:
                        with get_db() as _pdb:
                            _pb_rows = _pdb.query(_PB1b).all()
                        ports_db = [
                            {
                                "system_id": p.system_id,
                                "port_name": p.port_name,
                                "latitude":  p.latitude,
                                "longitude": p.longitude,
                                "region_id": p.region_id,
                                "boundary_radius_metres": p.boundary_radius_metres,
                            }
                            for p in _pb_rows
                        ]

                    cycle_now = datetime.now(timezone.utc)
                    loiter_hits: list = []
                    for _mmsi, _vessel in normalized_snap.items():
                        try:
                            if cable_loiter_rules:
                                hits = _ais_detector.check_loitering(
                                    _vessel, cables_db, cable_loiter_rules, cycle_now
                                )
                                loiter_hits.extend(hits)
                            if port_loiter_rules and ports_db:
                                hits = _ais_detector.check_port_loitering(
                                    _vessel, ports_db, port_loiter_rules, cycle_now
                                )
                                loiter_hits.extend(hits)
                        except Exception:
                            pass
                    _ais_detector.purge_stale_loiter(cycle_now)
                    for _lhit in loiter_hits:
                        try:
                            _broadcast_push(
                                title=f"Loitering — {_lhit.get('port_name') or _lhit.get('cable_name', 'infrastructure')}",
                                body=_lhit.get("message", "AIS loitering near infrastructure"),
                                data={"type": "loitering_alert", "lat": _lhit.get("lat"), "lng": _lhit.get("lng")},
                            )
                        except Exception:
                            pass
                    new_ais_alerts.extend(loiter_hits)
                    print(f"[forge-brain] Stage1b loitering: {len(cable_loiter_rules)} cable / {len(port_loiter_rules)} port rules → {len(loiter_hits)} alert(s)")
            except Exception as _le:
                print(f"[forge-brain] loitering check error: {_le}")

            # Stage 1d — Dark ship (AIS gap) detection (DB-backed AIS_DARK_SHIP rules)
            new_dark_alerts: list = []
            try:
                from database import RuleConfig, get_db
                import json as _json_ds
                with get_db() as _ddb:
                    dark_rule_rows = _ddb.query(RuleConfig).filter(
                        RuleConfig.rule_name == "AIS_DARK_SHIP",
                        RuleConfig.enabled == True,
                    ).all()
                dark_rules = [
                    {"id": r.id, "rule_name": r.rule_name, "enabled": r.enabled,
                     "params": _json_ds.loads(r.params) if isinstance(r.params, str) else r.params}
                    for r in dark_rule_rows
                ]
                if _dark_ship_detector is not None:
                    cycle_now = datetime.now(timezone.utc)
                    _dark_ship_detector.update(normalized_snap, cycle_now)
                    if dark_rules:
                        active_mmsis = set(normalized_snap.keys())
                        new_dark_alerts = _dark_ship_detector.scan(dark_rules, cycle_now, active_mmsis)
                        _dark_ship_detector.purge_stale(cycle_now)
                        new_ais_alerts.extend(new_dark_alerts)
                        print(f"[forge-brain] Stage1d dark-ship: {len(dark_rules)} rule(s), {len(new_dark_alerts)} alert(s)")
            except Exception as _de:
                print(f"[forge-brain] dark-ship check error: {_de}")

            # Stage 1e — Chokepoint activity (transit + loitering inside strategic polygons)
            new_choke_alerts: list = []
            try:
                from database import RuleConfig, get_db
                import json as _json_ck
                with get_db() as _ckdb:
                    ck_rule_rows = _ckdb.query(RuleConfig).filter(
                        RuleConfig.rule_name == "AIS_CHOKEPOINT_ACTIVITY",
                        RuleConfig.enabled == True,
                    ).all()
                ck_rules = [
                    {"id": r.id, "rule_name": r.rule_name, "enabled": r.enabled,
                     "severity": r.severity or "medium",
                     "params": _json_ck.loads(r.params) if isinstance(r.params, str) else r.params}
                    for r in ck_rule_rows
                ]
                if ck_rules and _chokepoint_detector is not None:
                    cycle_now = datetime.now(timezone.utc)
                    new_choke_alerts = _chokepoint_detector.check(
                        normalized_snap, ck_rules, _CHOKEPOINT_DEFS, cycle_now
                    )
                    _chokepoint_detector.purge_stale(cycle_now)
                    new_ais_alerts.extend(new_choke_alerts)
                    print(f"[forge-brain] Stage1e chokepoint: {len(ck_rules)} rule(s), {len(new_choke_alerts)} alert(s)")
            except Exception as _cke:
                print(f"[forge-brain] chokepoint check error: {_cke}")

            # Stage 2 — ADS-B anomaly detection via _adsb_detector
            new_adsb_alerts: list = []
            adsb_forge_rules = [r for r in active_rules if r.get("source") in ("ADSB", "adsb")]
            # Build combined callsign prefix set from forge rules + detector built-ins
            forge_prefixes = []
            for _r in adsb_forge_rules:
                forge_prefixes.extend(_r.get("params", {}).get("callsign_prefixes", []))
            emergency_codes = {"7500", "7600", "7700"}
            for _r in adsb_forge_rules:
                emergency_codes.update(_r.get("params", {}).get("squawk_codes", []))
            try:
                for ac in list(_GLOBAL_ADSB_CACHE.values())[:500]:
                    hits = _adsb_detector.check_aircraft(
                        ac, military_callsigns=forge_prefixes if forge_prefixes else None
                    )
                    # Attach rule metadata from matching forge rule where possible
                    for h in hits:
                        h["source"] = "ADSB"
                        if h.get("type") == "emergency_squawk":
                            rule = next((r for r in adsb_forge_rules if r.get("trigger_type") == "emergency_squawk"), None)
                        else:
                            rule = next((r for r in adsb_forge_rules if r.get("trigger_type") == "military_callsign"), None)
                        if rule:
                            h["rule_id"]   = rule.get("id")
                            h["rule_name"] = rule.get("name")
                            h["severity"]  = rule.get("severity", h.get("severity", "info"))
                    new_adsb_alerts.extend(hits)
            except Exception as _ae:
                print(f"[forge-brain] adsb error: {_ae}")

            # Stage 2b — ADSB loitering near airport (DB-backed rules)
            new_adsb_loiter_alerts: list = []
            try:
                from database import RuleConfig, Airport, get_db
                import json as _json_al
                with get_db() as _aldb:
                    al_rule_rows = _aldb.query(RuleConfig).filter(
                        RuleConfig.rule_name == "ADSB_LOITERING_NEAR_AIRPORT",
                        RuleConfig.enabled == True,
                    ).all()
                al_rules = [
                    {"id": r.id, "rule_name": r.rule_name, "enabled": r.enabled,
                     "params": _json_al.loads(r.params) if isinstance(r.params, str) else r.params}
                    for r in al_rule_rows
                ]
                if al_rules and _adsb_loiter_detector is not None:
                    cycle_now = datetime.now(timezone.utc)

                    def _airports_fn(region_id=None, types=None):
                        try:
                            with get_db() as _apdb:
                                q = _apdb.query(Airport)
                                if region_id:
                                    q = q.filter(Airport.region_id == region_id)
                                if types:
                                    from sqlalchemy import or_ as _or
                                    q = q.filter(_or(*[Airport.airport_type == t for t in types]))
                                rows = q.all()
                            return [
                                {"system_id": r.system_id, "ident": r.ident,
                                 "icao_code": r.icao_code, "airport_name": r.airport_name,
                                 "lat": r.latitude, "lon": r.longitude,
                                 "airport_type": r.airport_type}
                                for r in rows
                            ]
                        except Exception:
                            return []

                    ac_snap = {k: v for k, v in _GLOBAL_ADSB_CACHE.items()}
                    new_adsb_loiter_alerts = _adsb_loiter_detector.check(
                        ac_snap, al_rules, cycle_now, airports_fn=_airports_fn
                    )
                    _adsb_loiter_detector.purge_stale(cycle_now)
                    for _alrt in new_adsb_loiter_alerts:
                        try:
                            _broadcast_push(
                                title=_alrt.get("title", "Aircraft loitering near airport"),
                                body=_alrt.get("message", ""),
                                data={"type": "adsb_loiter_alert",
                                      "lat": _alrt.get("lat"), "lng": _alrt.get("lng")},
                            )
                        except Exception:
                            pass
                    new_adsb_alerts.extend(new_adsb_loiter_alerts)
                    print(f"[forge-brain] Stage2b ADSB loiter: {len(al_rules)} rule(s), {len(new_adsb_loiter_alerts)} alert(s)")
            except Exception as _ale:
                print(f"[forge-brain] ADSB loiter check error: {_ale}")

            # Stage 3 — News event scoring
            new_news_alerts: list = []
            news_rules = [r for r in active_rules if r.get("source") in ("NEWS", "news")]
            news_checked = 0
            try:
                raw_events = es.get_active_events()[:100]
                news_checked = len(raw_events)
                for ev in raw_events:
                    sev_raw = ev.get("severity") or ev.get("score", 0)
                    sev_map = {"critical": 5, "high": 4, "elevated": 3, "medium": 2, "low": 1}
                    sev_num = sev_map.get(str(sev_raw).lower(), 0) if isinstance(sev_raw, str) else (sev_raw or 0)
                    title = (ev.get("headline") or ev.get("title") or "").lower()
                    body  = (ev.get("summary") or ev.get("body") or "").lower()
                    text  = title + " " + body
                    for rule in news_rules:
                        trigger = rule.get("trigger_type", "")
                        params  = rule.get("params", {})
                        keywords = params.get("keywords", [])
                        threshold = params.get("min_severity", 3)
                        hit = False
                        if keywords:
                            hit = any(kw.lower() in text for kw in keywords) and sev_num >= threshold
                        elif trigger == "event_surge" or not trigger:
                            hit = sev_num >= max(threshold, 4)
                        if hit:
                            new_news_alerts.append({
                                "rule_id":   rule.get("id"),
                                "rule_name": rule.get("name"),
                                "source":    "NEWS",
                                "severity":  "high" if sev_num >= 4 else "medium",
                                "message":   f"News match: '{(ev.get('headline') or ev.get('title') or '')[:70]}'",
                                "lat":       ev.get("lat"),
                                "lng":       ev.get("lng") or ev.get("lon"),
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                                "provenance": {
                                    "source_type": "NEWS",
                                    "source_entity": ev.get("id") or ev.get("event_id"),
                                    "detection_rule": rule.get("name"),
                                    "trigger_reason": trigger,
                                    "params_at_trigger": params,
                                },
                            })
                            break  # one alert per event per cycle
            except Exception as _ne:
                print(f"[forge-brain] news error: {_ne}")

            # Stage 4 — Cross-domain correlation engine
            new_assessments: list = []
            try:
                ontology = _forge_ontology_load()
                recent_events: list = []
                try:
                    recent_events = [
                        {"lat": e.get("lat"), "lng": e.get("lng") or e.get("lon"),
                         "title": e.get("headline") or e.get("title") or "",
                         "severity": e.get("severity", "medium"),
                         "published": e.get("published_at") or e.get("published") or ""}
                        for e in es.get_active_events()[:50]
                        if e.get("lat") and (e.get("lng") or e.get("lon"))
                    ]
                except Exception:
                    pass

                new_assessments = _correlation_engine.correlate(
                    ais_alerts=new_ais_alerts,
                    adsb_alerts=new_adsb_alerts,
                    news_events=recent_events,
                    satellite_changes=[],
                    ontology=ontology,
                )

                for a in new_assessments:
                    if a.get("severity") in ("HIGH", "CRITICAL") and a.get("type") == "correlation":
                        _auto_add_correlation_to_ontology(a)

            except Exception as _ce:
                print(f"[forge-brain] correlation error: {_ce}")

            # Auto-wire cable alerts into ontology
            for alert in new_ais_alerts:
                if "cable" in (alert.get("message") or "").lower():
                    _auto_add_ontology_edge(alert)

            # Escalation + Rule-Connection chaining
            try:
                if _escalation_engine is not None:
                    try:
                        from database import EscalationChain as _EC, RuleConnection as _RC, get_db
                        import json as _jec
                        with get_db() as _ecdb:
                            _chain_rows = _ecdb.query(_EC).all()
                            _conn_rows  = _ecdb.query(_RC).all()
                        # Merge EscalationChain + ESCALATION RuleConnection rows into chains list
                        _chains_input = [
                            {
                                "chain_name":          c.chain_name,
                                "rule_ids":            c.rule_ids,
                                "escalated_severity":  c.escalated_severity,
                                "escalated_icon_type": c.escalated_icon_type,
                                "time_window_minutes": c.time_window_minutes,
                            }
                            for c in _chain_rows
                        ] + [
                            {
                                "chain_name":          rc.connection_name,
                                "rule_ids":            f"{rc.rule_id_a},{rc.rule_id_b}",
                                "escalated_severity":  rc.escalated_severity or "critical",
                                "escalated_icon_type": rc.escalated_icon_type or "ESCALATED_DUAL",
                                "time_window_minutes": rc.time_window_minutes or 30,
                            }
                            for rc in _conn_rows if rc.relationship_type == "ESCALATION"
                        ]
                        _escalation_engine.reload_chains(_chains_input)
                        # Index non-ESCALATION connections for post-processing
                        _seq_conns  = [rc for rc in _conn_rows if rc.relationship_type == "SEQUENCE"]
                        _supp_conns = [rc for rc in _conn_rows if rc.relationship_type == "SUPPRESSION"]
                        _corr_conns = [rc for rc in _conn_rows if rc.relationship_type == "CORRELATION"]
                    except Exception:
                        _seq_conns = _supp_conns = _corr_conns = []

                    _cycle_now_esc = datetime.now(timezone.utc)
                    new_ais_alerts = _escalation_engine.process(new_ais_alerts, _cycle_now_esc)

                    # Apply SEQUENCE, SUPPRESSION, CORRELATION post-escalation
                    if _seq_conns or _supp_conns or _corr_conns:
                        # Build per-vessel fired-rule-id index from escalation engine state
                        _fired: dict = {}  # mmsi → set of rule_id strings
                        for _mmsi_k, _entries in _escalation_engine._active.items():
                            _fired[_mmsi_k] = {e["rule_id"] for e in _entries if e["rule_id"]}
                        _suppressed_ids: set = set()
                        for _a in new_ais_alerts:
                            _a_mmsi    = str(_a.get("mmsi") or "")
                            _a_rule_id = str(_a.get("rule_id") or "")
                            fired_for_vessel = _fired.get(_a_mmsi, set())
                            # SEQUENCE: suppress rule_b if rule_a has not fired on same vessel
                            for _sc in _seq_conns:
                                if _a_rule_id == str(_sc.rule_id_b):
                                    if str(_sc.rule_id_a) not in fired_for_vessel:
                                        _suppressed_ids.add(_a.get("id", ""))
                            # SUPPRESSION: suppress rule_b when rule_a fires on same vessel
                            for _sp in _supp_conns:
                                if _a_rule_id == str(_sp.rule_id_b):
                                    if str(_sp.rule_id_a) in fired_for_vessel:
                                        _suppressed_ids.add(_a.get("id", ""))
                            # CORRELATION: tag both alerts
                            for _cr in _corr_conns:
                                if _a_rule_id in (str(_cr.rule_id_a), str(_cr.rule_id_b)):
                                    _a.setdefault("correlations", []).append(_cr.connection_name)
                        if _suppressed_ids:
                            new_ais_alerts = [_a for _a in new_ais_alerts if _a.get("id", "") not in _suppressed_ids]
            except Exception as _ee:
                print(f"[forge-brain] escalation error: {_ee}")

            all_new = new_ais_alerts + new_adsb_alerts + new_news_alerts
            _forge_alerts.extend(all_new)
            _correlation_assessments.extend(new_assessments)
            # Persist new alerts to DB
            for _aw_alert in all_new:
                try:
                    _src = "ais" if _aw_alert in new_ais_alerts else ("adsb" if _aw_alert in new_adsb_alerts else "news")
                    write_alert({**_aw_alert, "source": _src})
                    _a_lat = _aw_alert.get("lat")
                    _a_lon = _aw_alert.get("lng") or _aw_alert.get("lon")
                    if _a_lat is not None and _a_lon is not None:
                        entity_linker.link_alert(
                            alert_id=_aw_alert.get("id", ""),
                            source_type=_src,
                            lat=_a_lat,
                            lon=_a_lon,
                            title=_aw_alert.get("title") or _aw_alert.get("message", ""),
                        )
                except Exception as _aw_e:
                    print(f"[alert-writer] alert persist error: {_aw_e}")

            # Feed AIS and ADSB alerts into fusion engine via normalize_signal
            if _fusion_engine:
                try:
                    for _fa in new_ais_alerts:
                        _fusion_engine.on_signal(normalize_signal(
                            "AIS",
                            {**_fa, "location_name": _fa.get("location_name") or _fa.get("vessel") or ""},
                            alert_id=_fa.get("id"),
                        ))
                    for _fa in new_adsb_alerts:
                        _fusion_engine.on_signal(normalize_signal(
                            "ADSB",
                            {**_fa, "location_name": _fa.get("location_name") or _fa.get("aircraft") or ""},
                            alert_id=_fa.get("id"),
                        ))
                except Exception as _fe_err2:
                    print(f"[fusion] forge-brain signal error: {_fe_err2}")

            # Trim to 24h
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
            _forge_alerts = [a for a in _forge_alerts if a.get("timestamp", "") > cutoff]
            _correlation_assessments = [a for a in _correlation_assessments if a.get("timestamp", "") > cutoff]

            # Deduplicate (rule+entity per hour)
            seen: set = set()
            deduped: list = []
            for a in reversed(_forge_alerts):
                key = f"{a.get('rule_id')}|{a.get('mmsi') or a.get('aircraft') or a.get('message','')[:30]}|{(a.get('timestamp',''))[:13]}"
                if key not in seen:
                    seen.add(key)
                    deduped.append(a)
            _forge_alerts = list(reversed(deduped))[:200]
            _correlation_assessments = _correlation_assessments[-200:]

            cycle_s = (datetime.now(timezone.utc) - cycle_start).total_seconds()
            active_rule_count = len(active_rules)
            _last_cycle_stats = {
                "last_cycle":        datetime.now(timezone.utc).isoformat(),
                "vessels_tracked":   len(normalized_snap),
                "aircraft_tracked":  len(_GLOBAL_ADSB_CACHE),
                "rules_active":      active_rule_count,
                "ais_alerts":        len(new_ais_alerts),
                "dark_alerts":       len(new_dark_alerts),
                "adsb_alerts":       len(new_adsb_alerts),
                "news_alerts":       len(new_news_alerts),
                "new_correlations":  len(new_assessments),
                "alerts_24h":        len(_forge_alerts),
                "correlations_24h":  len(_correlation_assessments),
                "weights":           _threat_engine.weights if _threat_engine else {},
            }
            _cycle_history.append({
                "ts":          _last_cycle_stats["last_cycle"],
                "vessels":     len(normalized_snap),
                "aircraft":    len(_GLOBAL_ADSB_CACHE),
                "news":        news_checked,
                "rules":       active_rule_count,
                "ais_alerts":  len(new_ais_alerts),
                "adsb_alerts": len(new_adsb_alerts),
                "news_alerts": len(new_news_alerts),
                "correlations": len(new_assessments),
                "alerts_24h":  len(_forge_alerts),
            })
            while len(_cycle_history) > 50:
                _cycle_history.pop(0)
            print(
                f"[forge-brain] {cycle_s:.1f}s — "
                f"{len(normalized_snap)}v/{len(_GLOBAL_ADSB_CACHE)}ac/{news_checked}nw → "
                f"{len(new_ais_alerts)}+{len(new_adsb_alerts)}+{len(new_news_alerts)} alerts, "
                f"{len(new_assessments)} correlations, {len(_forge_alerts)} total"
            )
            _write_snapshot_sync("forge_alerts", list(_forge_alerts))
            # Write alerts_active from DB
            try:
                from database import Alert as _AlertSnap, FusionEvent as _FESnap
                with get_db() as _adb:
                    _active_alerts = _adb.query(_AlertSnap).filter(
                        _AlertSnap.status == "active"
                    ).order_by(_AlertSnap.created_at.desc()).limit(500).all()
                _write_snapshot_sync("alerts_active", [
                    {"alert_id": a.alert_id, "source": a.source, "alert_type": a.alert_type,
                     "title": a.title, "severity": a.severity, "lat": a.lat, "lon": a.lon,
                     "country_code": a.country_code, "status": a.status,
                     "relevance_score": a.relevance_score,
                     "created_at": a.created_at.isoformat() if a.created_at else None}
                    for a in _active_alerts
                ])
                with get_db() as _fedb:
                    _fe_rows = (_fedb.query(_FESnap)
                                     .filter(_FESnap.status == "active")
                                     .order_by(_FESnap.created_at.desc())
                                     .limit(100).all())
                _write_snapshot_sync("fusions", [
                    {"fusion_id": f.fusion_id, "title": f.title, "subtitle": f.subtitle,
                     "narrative": f.narrative, "severity": f.severity,
                     "confidence": f.confidence, "lat": f.lat, "lon": f.lon,
                     "signal_count": f.signal_count, "domains": f.domains,
                     "key_signals": f.key_signals, "status": f.status,
                     "created_at": f.created_at.isoformat() if f.created_at else None,
                     "expires_at": f.expires_at.isoformat() if f.expires_at else None,
                     "marker_visible": f.marker_visible}
                    for f in _fe_rows
                ])
            except Exception as _ase:
                print(f"[SNAPSHOT] alerts_active/fusions error: {_ase}")
        except Exception as _ex:
            print(f"[forge-brain] cycle error: {_ex}")
        await asyncio.sleep(300)


# ── Forge aircraft feed (ADSB global cache) ───────────────────────────────────

@app.get("/api/forge/aircraft")
def forge_get_aircraft(_forge=Depends(_require_forge)):
    aircraft = sorted(
        _GLOBAL_ADSB_CACHE.values(),
        key=lambda a: a.get("last_seen", 0), reverse=True
    )[:500]
    return {"aircraft": aircraft, "total": len(aircraft)}


# ── Forge source config ───────────────────────────────────────────────────────

def _get_forge_config() -> dict:
    path = _FORGE_DIR / "forge_config.json"
    if not path.exists():
        return {}
    try:
        return _json.loads(path.read_text())
    except Exception:
        return {}


def _save_forge_config(cfg: dict):
    _FORGE_DIR.mkdir(parents=True, exist_ok=True)
    (_FORGE_DIR / "forge_config.json").write_text(_json.dumps(cfg, indent=2))


@app.get("/api/forge/source/{source_id}/config")
def forge_get_source_config(source_id: str, _forge=Depends(_require_forge)):
    cfg = _get_forge_config()
    src_cfg = cfg.get(source_id, {})

    if source_id == "src_ais":
        src_cfg.setdefault("bboxes", len(_AIS_BBOXES))
        src_cfg.setdefault("vessels_tracked", len(_AIS_VESSELS))
        src_cfg.setdefault("filters", cfg.get("src_ais", {}).get("filters", []))

    elif source_id == "src_news":
        src_cfg.setdefault("keywords", cfg.get("src_news", {}).get("keywords", []))
        src_cfg.setdefault("feed_count", len(_SCAN_FEEDS) if "_SCAN_FEEDS" in dir() else 277)
        health = {}
        for name, url in (_DS_STATUS or {}).items():
            if isinstance(url, dict):
                health[name] = url.get("failures", 0)
        src_cfg["feed_health"] = health

    elif source_id == "src_uploads":
        uploads = _forge_load("uploads.json")
        src_cfg["uploads"] = uploads
        src_cfg["count"] = len(uploads)

    elif source_id == "src_satellite":
        src_cfg.setdefault("token_set", bool(src_cfg.get("sentinel_token", "")))

    elif source_id == "src_adsb":
        src_cfg.setdefault("refresh_ms", 10000)

    return src_cfg


@app.put("/api/forge/source/{source_id}/config")
async def forge_update_source_config(source_id: str, request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    cfg = _get_forge_config()
    cfg[source_id] = {**(cfg.get(source_id) or {}), **body}
    _save_forge_config(cfg)
    return cfg[source_id]


# ── Forge rule dry-run ────────────────────────────────────────────────────────

@app.post("/api/forge/rules/{rule_id}/test")
def forge_test_rule(rule_id: str, _forge=Depends(_require_forge)):
    if not _HAS_DETECTORS:
        raise HTTPException(status_code=503, detail="Detector engine not available")
    rules = _forge_load("rules.json")
    rule = next((r for r in rules if r.get("id") == rule_id), None)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    source = rule.get("source", "AIS")
    hits: list = []
    checked = 0

    if source == "AIS":
        tester = _AISAnomalyDetector()
        tester.load_rules([{**rule, "status": "active"}])
        cables = _prep_cables_for_detector()
        with _AIS_LOCK:
            vessels_snap = dict(_AIS_VESSELS)
        normalized = {}
        for _m, _v in vessels_snap.items():
            _n = _normalize_vessel(_v, _m)
            if _n:
                normalized[_m] = _n
        checked = min(len(normalized), 500)
        for vessel in list(normalized.values())[:500]:
            hits.extend(tester.check_vessel(vessel, cables=cables,
                                            chokepoints=_CHOKEPOINT_DEFS,
                                            all_vessels=normalized))
        label = "vessels"

    elif source == "ADSB":
        for ac in list(_GLOBAL_ADSB_CACHE.values())[:500]:
            checked += 1
            hits.extend(_adsb_detector.check_aircraft(ac))
        label = "aircraft"

    elif source == "NEWS":
        keywords = [kw.lower() for kw in rule.get("params", {}).get("keywords", [])]
        sev_map  = {"critical": 5, "high": 4, "elevated": 3, "medium": 2, "low": 1}
        try:
            events = es.get_active_events()
        except Exception:
            events = []
        for ev in events[:500]:
            checked += 1
            text = ((ev.get("headline") or ev.get("title") or "") + " " +
                    (ev.get("summary") or ev.get("body") or "")).lower()
            sev_raw = ev.get("severity") or ev.get("score", 0)
            sev_num = sev_map.get(str(sev_raw).lower(), 0) if isinstance(sev_raw, str) else (sev_raw or 0)
            matched = (any(kw in text for kw in keywords) if keywords else sev_num >= 4)
            if matched:
                hits.append({
                    "message":  f"Match: '{(ev.get('headline') or ev.get('title') or '')[:60]}'",
                    "severity": ev.get("severity", "medium"),
                })
        label = "news events"

    else:
        label = "items"

    return {
        "rule_id":       rule_id,
        "rule_name":     rule.get("name"),
        "source":        source,
        "checked":       checked,
        "label":         label,
        "would_trigger": len(hits),
        "hits":          len(hits),
        "sample_alerts": hits[:5],
        "sample":        hits[:5],
    }


# ── Forge training stats ──────────────────────────────────────────────────────

@app.get("/api/forge/training/stats/{detector_id}")
def forge_training_stats(detector_id: str, _forge=Depends(_require_forge)):
    labels = _forge_load("forge_labels.json")
    type_map = {
        "det_overwatch": "overwatch",
        "det_ais":       "ais",
        "det_adsb":      "ais",
        "det_news":      "news",
    }
    src_type = type_map.get(detector_id)
    if src_type:
        labels = [l for l in labels if l.get("source_type") == src_type]

    total     = len(labels)
    confirmed = sum(1 for l in labels if l.get("label") in ("confirm", "confirmed", "correct"))
    corrected = sum(1 for l in labels if l.get("label") in ("correct", "corrected", "adjusted"))
    skipped   = sum(1 for l in labels if l.get("label") == "skip")
    accuracy  = round(confirmed / max(confirmed + corrected, 1) * 100, 1)

    # Per-class breakdown for overwatch
    classes: dict = {}
    for l in labels:
        cls = l.get("original_label") or l.get("class") or "unknown"
        if cls not in classes:
            classes[cls] = {"confirmed": 0, "corrected": 0, "total": 0}
        classes[cls]["total"] += 1
        if l.get("label") in ("confirm", "confirmed"):
            classes[cls]["confirmed"] += 1
        elif l.get("label") in ("correct", "corrected", "adjusted"):
            classes[cls]["corrected"] += 1

    return {
        "detector_id": detector_id,
        "total":       total,
        "confirmed":   confirmed,
        "corrected":   corrected,
        "skipped":     skipped,
        "accuracy":    accuracy,
        "classes":     classes,
        "recent":      labels[-20:][::-1],
    }


# ── Forge training export ─────────────────────────────────────────────────────

@app.get("/api/forge/training/export/{fmt}")
def forge_training_export(fmt: str, _forge=Depends(_require_forge)):
    from fastapi.responses import Response
    labels = _forge_load("forge_labels.json")

    if fmt == "json":
        content = _json.dumps(labels, indent=2)
        return Response(content=content, media_type="application/json",
                        headers={"Content-Disposition": "attachment; filename=forge_labels.json"})

    elif fmt == "csv":
        import io
        buf = io.StringIO()
        buf.write("id,label,source_type,original_label,correction,labeled_at\n")
        for l in labels:
            row = ",".join([
                str(l.get("id", "")),
                str(l.get("label", "")),
                str(l.get("source_type", "")),
                str(l.get("original_label", "")),
                str(l.get("correction", "")),
                str(l.get("labeled_at", "")),
            ])
            buf.write(row + "\n")
        return Response(content=buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": "attachment; filename=forge_labels.csv"})

    elif fmt == "yolo":
        import io, zipfile
        buf = io.BytesIO()
        ow_labels = [l for l in labels if l.get("source_type") == "overwatch"]
        classes = sorted(set(l.get("correction") or l.get("original_label", "unknown") for l in ow_labels))
        cls_map = {c: i for i, c in enumerate(classes)}
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("classes.txt", "\n".join(classes))
            for i, l in enumerate(ow_labels):
                cls_name = l.get("correction") or l.get("original_label", "unknown")
                cls_idx  = cls_map.get(cls_name, 0)
                zf.writestr(f"labels/{i:05d}.txt", f"{cls_idx} 0.5 0.5 0.5 0.5\n")
        return Response(content=buf.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": "attachment; filename=forge_yolo_export.zip"})

    raise HTTPException(status_code=400, detail=f"Unknown format: {fmt}")


# ── Forge model download ──────────────────────────────────────────────────────

@app.get("/api/forge/models/download/{model_name}")
def forge_download_model(model_name: str, _forge=Depends(_require_forge)):
    from fastapi.responses import FileResponse
    safe = model_name.replace("/", "").replace("..", "")
    backend_dir = Path(__file__).parent
    path = backend_dir / safe
    if not path.exists() or not safe.endswith(".onnx"):
        raise HTTPException(status_code=404, detail="Model not found")
    return FileResponse(str(path), media_type="application/octet-stream",
                        headers={"Content-Disposition": f"attachment; filename={safe}"})


# ── Forge brain inspect ───────────────────────────────────────────────────────

@app.get("/api/forge/brain/inspect")
def forge_brain_inspect(_forge=Depends(_require_forge)):
    rules = _forge_load("rules.json")
    labels = _forge_load("forge_labels.json")
    confirmed = sum(1 for l in labels if l.get("label") in ("confirm", "confirmed", "correct"))
    corrected  = sum(1 for l in labels if l.get("label") in ("correct", "corrected", "adjusted"))

    # ML models
    backend_dir = Path(__file__).parent
    models = []
    for fname in ("yolov8n-obb.onnx", "yolov8n.onnx"):
        fpath = backend_dir / fname
        if fpath.exists():
            models.append({
                "name":    fname,
                "size_mb": round(fpath.stat().st_size / (1024 * 1024), 1),
                "status":  "active" if "obb" in fname else "standby",
            })

    # Correlation engine params
    corr_params = {}
    if _correlation_engine:
        try:
            corr_params = {
                "time_window_s":    getattr(_correlation_engine, "time_window",    3600),
                "distance_km":      getattr(_correlation_engine, "distance_km",    150),
                "min_confidence":   getattr(_correlation_engine, "min_confidence", 0.6),
                "min_signals":      getattr(_correlation_engine, "min_signals",    2),
            }
        except Exception:
            pass

    return {
        "weights":         _threat_engine.weights if _threat_engine else {},
        "corr_params":     corr_params,
        "rules_total":     len(rules),
        "rules_active":    sum(1 for r in rules if r.get("status") == "active"),
        "rules_by_source": {
            src: sum(1 for r in rules if r.get("source") == src)
            for src in ("AIS", "ADSB", "NEWS", "SATELLITE")
        },
        "models":          models,
        "training_labels": len(labels),
        "training_accuracy": round(confirmed / max(confirmed + corrected, 1) * 100, 1),
        "cycle_history":   list(reversed(_cycle_history)),
        "live": {
            "vessels":      len(_AIS_VESSELS),
            "aircraft":     len(_GLOBAL_ADSB_CACHE),
            "alerts_24h":   len(_forge_alerts),
            "correlations": len(_correlation_assessments),
        },
    }


# ── Intelligence Assessments ─────────────────────────────────────────────────


def _assessment_to_dict(row) -> dict:
    import json as _ja
    def _parse(s):
        try:
            return _ja.loads(s) if isinstance(s, str) else (s or [])
        except Exception:
            return []
    return {
        "id":                    row.id,
        "assessment_id":         row.assessment_id,
        "assessment_type":       row.assessment_type,
        "domain":                row.domain,
        "severity":              row.severity,
        "location_name":         row.location_name,
        "location_country":      row.location_country,
        "region_id":             row.region_id,
        "lat":                   row.lat,
        "lon":                   row.lon,
        "confidence":            row.confidence,
        "confidence_reasoning":  row.confidence_reasoning,
        "evidence_count":        row.evidence_count,
        "evidence_items":        _parse(row.evidence_items),
        "timeframe_hours":       row.timeframe_hours,
        "headline":              row.headline,
        "summary":               row.summary,
        "key_signals":           _parse(row.key_signals),
        "recommended_actions":   _parse(row.recommended_actions),
        "source_rule_id":        row.source_rule_id,
        "source_rule_name":      row.source_rule_name,
        "marker_type":           row.marker_type,
        "marker_visible":        row.marker_visible,
        "created_at":            row.created_at.isoformat() if row.created_at else None,
        "expires_at":            row.expires_at.isoformat() if row.expires_at else None,
    }


@app.get("/api/assessments")
def api_assessments_list(
    domain: str = None,
    assessment_type: str = None,
    severity: str = None,
    since: str = None,
    location: str = None,
    marker_visible: bool = None,
):
    """Return non-expired IntelligenceAssessment rows, newest first."""
    try:
        from intelligence_schema import IntelligenceAssessment
        from database import get_db as _gdb_a
    except ImportError:
        return []
    with _gdb_a() as _db:
        q = _db.query(IntelligenceAssessment).filter(
            IntelligenceAssessment.expires_at > datetime.utcnow()
        )
        if domain:
            q = q.filter(IntelligenceAssessment.domain == domain)
        if assessment_type:
            q = q.filter(IntelligenceAssessment.assessment_type == assessment_type)
        if severity:
            q = q.filter(IntelligenceAssessment.severity == severity)
        if since:
            try:
                since_dt = datetime.fromisoformat(since.replace("Z", "+00:00")).replace(tzinfo=None)
                q = q.filter(IntelligenceAssessment.created_at >= since_dt)
            except Exception:
                pass
        if location:
            q = q.filter(IntelligenceAssessment.location_country == location.lower())
        if marker_visible is not None:
            q = q.filter(IntelligenceAssessment.marker_visible == marker_visible)
        rows = q.order_by(IntelligenceAssessment.created_at.desc()).limit(200).all()
    return [_assessment_to_dict(r) for r in rows]


@app.get("/api/assessments/for-claude")
def api_assessments_for_claude():
    """Return last 24h of assessments formatted for Claude consumption."""
    try:
        from intelligence_schema import IntelligenceAssessment
        from database import get_db as _gdb_c
    except ImportError:
        return []
    SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "info": 3}
    cutoff = datetime.utcnow() - timedelta(hours=24)
    with _gdb_c() as _db:
        rows = _db.query(IntelligenceAssessment).filter(
            IntelligenceAssessment.created_at >= cutoff,
            IntelligenceAssessment.expires_at > datetime.utcnow(),
        ).all()
    import json as _jc
    def _parse(s):
        try:
            return _jc.loads(s) if isinstance(s, str) else (s or [])
        except Exception:
            return []
    items = []
    for r in rows:
        items.append({
            "type":           r.assessment_type,
            "headline":       r.headline,
            "location":       r.location_name,
            "confidence":     r.confidence,
            "severity":       r.severity,
            "signals":        _parse(r.key_signals),
            "evidence_count": r.evidence_count,
            "timeframe_hours": r.timeframe_hours,
            "summary":        r.summary,
            "created_at":     r.created_at.isoformat() if r.created_at else None,
        })
    items.sort(key=lambda x: (SEV_ORDER.get(x["severity"], 4), -(x["confidence"] or 0)))
    return items


@app.get("/api/assessments/{assessment_id}")
def api_assessments_get(assessment_id: str):
    """Return a single IntelligenceAssessment by assessment_id."""
    try:
        from intelligence_schema import IntelligenceAssessment
        from database import get_db as _gdb_g
    except ImportError:
        raise HTTPException(status_code=503, detail="Intelligence schema not available")
    with _gdb_g() as _db:
        row = _db.query(IntelligenceAssessment).filter(
            IntelligenceAssessment.assessment_id == assessment_id
        ).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Assessment {assessment_id} not found")
    return _assessment_to_dict(row)


@app.delete("/api/assessments/{assessment_id}")
def api_assessments_delete(assessment_id: str):
    """Dismiss an assessment (operator manual action)."""
    try:
        from intelligence_schema import IntelligenceAssessment
        from database import get_db as _gdb_d
    except ImportError:
        raise HTTPException(status_code=503, detail="Intelligence schema not available")
    with _gdb_d() as _db:
        row = _db.query(IntelligenceAssessment).filter(
            IntelligenceAssessment.assessment_id == assessment_id
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Assessment {assessment_id} not found")
        _db.delete(row)
        _db.commit()
    return {"deleted": assessment_id}


# ── Intelligence Fusion endpoints ─────────────────────────────────────────────

@app.get("/api/fusions")
def api_fusions_list(
    status: str = "active",
    severity: str = None,
    since: str = None,
    limit: int = 100,
):
    try:
        from database import get_db as _gdb_f, FusionEvent as _FE
        import json as _json
    except ImportError:
        raise HTTPException(status_code=503, detail="Fusion engine not available")
    with _gdb_f() as _db:
        q = _db.query(_FE)
        if status and status != "all":
            q = q.filter(_FE.status == status)
        if severity:
            q = q.filter(_FE.severity == severity)
        if since:
            try:
                _since_dt = datetime.fromisoformat(since)
                q = q.filter(_FE.created_at >= _since_dt)
            except ValueError:
                pass
        rows = q.order_by(_FE.created_at.desc()).limit(limit).all()
        result = []
        for r in rows:
            result.append({
                "fusion_id": r.fusion_id,
                "title": r.title,
                "subtitle": r.subtitle,
                "narrative": r.narrative,
                "severity": r.severity,
                "confidence": r.confidence,
                "domain_count": r.domain_count,
                "domains": _json.loads(r.domains or "[]"),
                "fusion_type": r.fusion_type,
                "location_name": r.location_name,
                "location_country": r.location_country,
                "region_id": r.region_id,
                "lat": r.lat,
                "lon": r.lon,
                "radius_km": r.radius_km,
                "signal_count": r.signal_count,
                "key_signals": _json.loads(r.key_signals or "[]"),
                "threat_indicators": _json.loads(r.threat_indicators or "[]"),
                "recommended_actions": _json.loads(r.recommended_actions or "[]"),
                "contributing_assessments": _json.loads(r.contributing_assessments or "[]"),
                "contributing_alert_ids": _json.loads(r.contributing_alert_ids or "[]"),
                "contributing_rule_ids": _json.loads(r.contributing_rule_ids or "[]"),
                "marker_type": r.marker_type,
                "marker_visible": r.marker_visible,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                "expires_at": r.expires_at.isoformat() if r.expires_at else None,
                "analyst_notes": r.analyst_notes,
            })
        return result


@app.get("/api/fusions/for-claude")
def api_fusions_for_claude(limit: int = 20):
    """Stripped fusion records for Director context injection."""
    try:
        from database import get_db as _gdb_f, FusionEvent as _FE
        import json as _json
    except ImportError:
        raise HTTPException(status_code=503, detail="Fusion engine not available")
    with _gdb_f() as _db:
        rows = (
            _db.query(_FE)
            .filter(_FE.status == "active", _FE.marker_visible == True)
            .order_by(_FE.severity.desc(), _FE.confidence.desc())
            .limit(limit)
            .all()
        )
        result = []
        for r in rows:
            result.append({
                "fusion_id": r.fusion_id,
                "title": r.title,
                "subtitle": r.subtitle,
                "narrative": r.narrative,
                "severity": r.severity,
                "confidence": round(r.confidence, 2),
                "domains": _json.loads(r.domains or "[]"),
                "location_name": r.location_name,
                "location_country": r.location_country,
                "signal_count": r.signal_count,
                "key_signals": _json.loads(r.key_signals or "[]"),
                "threat_indicators": _json.loads(r.threat_indicators or "[]"),
                "created_at": r.created_at.isoformat() if r.created_at else None,
            })
        return result


@app.get("/api/fusions/{fusion_id}")
def api_fusions_get(fusion_id: str):
    try:
        from database import get_db as _gdb_f, FusionEvent as _FE
        import json as _json
    except ImportError:
        raise HTTPException(status_code=503, detail="Fusion engine not available")
    with _gdb_f() as _db:
        r = _db.query(_FE).filter(_FE.fusion_id == fusion_id).first()
        if not r:
            raise HTTPException(status_code=404, detail=f"Fusion {fusion_id} not found")
        signals = []
        if _fusion_engine:
            for sig in _fusion_engine.get_recent_signals():
                if sig.get("signal_id") in _json.loads(r.contributing_alert_ids or "[]"):
                    signals.append(sig)
        return {
            "fusion_id": r.fusion_id,
            "title": r.title,
            "subtitle": r.subtitle,
            "narrative": r.narrative,
            "severity": r.severity,
            "confidence": r.confidence,
            "domain_count": r.domain_count,
            "domains": _json.loads(r.domains or "[]"),
            "fusion_type": r.fusion_type,
            "location_name": r.location_name,
            "location_country": r.location_country,
            "region_id": r.region_id,
            "lat": r.lat,
            "lon": r.lon,
            "radius_km": r.radius_km,
            "signal_count": r.signal_count,
            "key_signals": _json.loads(r.key_signals or "[]"),
            "threat_indicators": _json.loads(r.threat_indicators or "[]"),
            "recommended_actions": _json.loads(r.recommended_actions or "[]"),
            "contributing_assessments": _json.loads(r.contributing_assessments or "[]"),
            "contributing_alert_ids": _json.loads(r.contributing_alert_ids or "[]"),
            "contributing_rule_ids": _json.loads(r.contributing_rule_ids or "[]"),
            "marker_type": r.marker_type,
            "marker_visible": r.marker_visible,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            "expires_at": r.expires_at.isoformat() if r.expires_at else None,
            "analyst_notes": r.analyst_notes,
            "resolved_signals": signals,
        }


@app.get("/api/fusions/{fusion_id}/signals")
def api_fusions_signals(fusion_id: str):
    """Return source signals for a fusion event. Never returns 500."""
    signals    = []
    fusion_lat = None
    fusion_lon = None

    try:
        # ── Step 1: load the fusion event ────────────────────────────────────
        fusion = None
        try:
            from database import FusionEvent as _FE_s
            with get_db() as _db_fe:
                fusion = _db_fe.query(_FE_s).filter(
                    _FE_s.fusion_id == fusion_id
                ).first()
        except Exception as _fe_err:
            print(f"[fusion_signals] FusionEvent query failed: {_fe_err}")

        if not fusion:
            return {"fusion_id": fusion_id, "signals": [], "signal_count": 0}

        fusion_lat = getattr(fusion, "lat", None)
        fusion_lon = getattr(fusion, "lon", None)
        geo_key    = getattr(fusion, "geo_key", None)

        # ── Step 2: FusionSignal table by geo_key ────────────────────────────
        try:
            from database import FusionSignal as _FS_s
            cutoff_fs = datetime.utcnow() - timedelta(hours=24)
            with get_db() as _db_fs:
                q = _db_fs.query(_FS_s).filter(
                    _FS_s.created_at >= cutoff_fs
                )
                if geo_key:
                    q = q.filter(_FS_s.geo_key == geo_key)
                db_sigs = q.order_by(_FS_s.created_at.desc()).limit(20).all()
            for s in db_sigs:
                if not getattr(s, "lat", None) or not getattr(s, "lon", None):
                    continue
                signals.append({
                    "signal_id":  s.signal_id,
                    "domain":     s.domain or "UNKNOWN",
                    "rule_name":  s.rule_name or "",
                    "summary":    (s.summary or "")[:200],
                    "severity":   s.severity or "medium",
                    "confidence": s.confidence or 0.8,
                    "lat":        s.lat,
                    "lon":        s.lon,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                })
        except Exception as _fs_err:
            print(f"[fusion_signals] FusionSignal query failed: {_fs_err}")

        # ── Step 3: in-memory engine signals matching contributing ids ───────
        if _fusion_engine:
            try:
                import json as _js
                alert_ids = set(_js.loads(getattr(fusion, "contributing_alert_ids", None) or "[]"))
                seen = {s["signal_id"] for s in signals}
                for sig in _fusion_engine.get_recent_signals():
                    sid = sig.get("signal_id")
                    if not sid or sid in seen or sid not in alert_ids:
                        continue
                    if not sig.get("lat") or not sig.get("lon"):
                        continue
                    ts = sig.get("timestamp")
                    signals.append({
                        "signal_id":  sid,
                        "domain":     sig.get("domain") or "UNKNOWN",
                        "rule_name":  sig.get("rule_name") or "",
                        "summary":    str(sig.get("summary", ""))[:200],
                        "severity":   sig.get("severity") or "medium",
                        "confidence": sig.get("confidence") or 0.8,
                        "lat":        sig.get("lat"),
                        "lon":        sig.get("lon"),
                        "created_at": ts.isoformat() if hasattr(ts, "isoformat") else str(ts) if ts else None,
                    })
                    seen.add(sid)
            except Exception as _me_err:
                print(f"[fusion_signals] in-memory engine scan failed: {_me_err}")

        # ── Step 4: fallback to nearby alerts ────────────────────────────────
        if not signals and fusion_lat and fusion_lon:
            try:
                from database import Alert as _AL_s
                cutoff_al = datetime.utcnow() - timedelta(hours=48)
                deg = 3.0
                with get_db() as _db_al:
                    nearby = (
                        _db_al.query(_AL_s)
                        .filter(
                            _AL_s.lat.between(fusion_lat - deg, fusion_lat + deg),
                            _AL_s.lon.between(fusion_lon - deg, fusion_lon + deg),
                            _AL_s.created_at >= cutoff_al,
                        )
                        .order_by(_AL_s.relevance_score.desc())
                        .limit(15)
                        .all()
                    )
                for a in nearby:
                    if not a.lat or not a.lon:
                        continue
                    signals.append({
                        "signal_id":  a.alert_id,
                        "domain":     a.domain or "UNKNOWN",
                        "rule_name":  a.rule_name or "",
                        "summary":    (a.title or "")[:200],
                        "severity":   a.severity or "medium",
                        "confidence": a.confidence or 0.8,
                        "lat":        a.lat,
                        "lon":        a.lon,
                        "created_at": a.created_at.isoformat() if a.created_at else None,
                    })
            except Exception as _al_err:
                print(f"[fusion_signals] Alert fallback failed: {_al_err}")

    except Exception as _outer:
        import traceback as _tb
        print(f"[fusion_signals] outer error: {_outer}")
        _tb.print_exc()
        return {"fusion_id": fusion_id, "signals": [], "signal_count": 0, "error": str(_outer)}

    return {
        "fusion_id":    fusion_id,
        "fusion_lat":   fusion_lat,
        "fusion_lon":   fusion_lon,
        "signal_count": len(signals),
        "signals":      signals,
    }


# ══════════════════════════════════════════════════════════════════════════════
# FORESIGHT ENGINE — Escalation prediction endpoints
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/foresight/global/summary")
async def api_foresight_global():
    """Top escalation risks across all zones (last 24h assessments)."""
    try:
        from database import ForesightAssessment as _FA
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
        with get_db() as _db:
            rows = (
                _db.query(_FA)
                .filter(_FA.generated_at >= cutoff)
                .order_by(_FA.escalation_probability_30d.desc())
                .limit(10)
                .all()
            )
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "top_risks": [
                {
                    "zone_id":                     r.zone_id,
                    "zone_name":                   r.zone_name,
                    "escalation_probability_30d":  r.escalation_probability_30d,
                    "confidence":                  r.confidence,
                    "analyst_note":                r.analyst_note,
                    "situation_summary":           r.situation_summary,
                    "generated_at":                r.generated_at.isoformat() if r.generated_at else None,
                }
                for r in rows
            ],
        }
    except Exception as e:
        print(f"[foresight/global] error: {e}")
        return {"generated_at": datetime.utcnow().isoformat(), "top_risks": []}


@app.get("/api/foresight/{zone_id}")
async def api_foresight_get(zone_id: str):
    """Latest foresight assessment for a zone."""
    try:
        from database import ForesightAssessment as _FA
        import json as _j
        with get_db() as _db:
            latest = (
                _db.query(_FA)
                .filter(_FA.zone_id == zone_id)
                .order_by(_FA.generated_at.desc())
                .first()
            )
        if not latest:
            return {"zone_id": zone_id, "assessment": None}
        a = latest
        return {
            "zone_id":                      a.zone_id,
            "zone_name":                    a.zone_name,
            "generated_at":                 a.generated_at.isoformat() if a.generated_at else None,
            "score_at_generation":          a.score_at_generation,
            "model_used":                   a.model_used,
            "situation_summary":            a.situation_summary,
            "trajectory_assessment":        a.trajectory_assessment,
            "escalation_probability_30d":   a.escalation_probability_30d,
            "probability_basis":            a.probability_basis,
            "early_warning_indicators":     _j.loads(a.early_warning_indicators or "[]"),
            "likely_scenarios":             _j.loads(a.likely_scenarios or "[]"),
            "pattern_matches":              _j.loads(a.pattern_matches or "[]"),
            "intelligence_gaps":            _j.loads(a.intelligence_gaps or "[]"),
            "confidence":                   a.confidence,
            "analyst_note":                 a.analyst_note,
            "expires_at":                   a.expires_at.isoformat() if a.expires_at else None,
        }
    except Exception as e:
        print(f"[foresight] get error for {zone_id}: {e}")
        return {"zone_id": zone_id, "assessment": None, "error": str(e)}


@app.post("/api/foresight/{zone_id}/trigger")
async def api_foresight_trigger(zone_id: str):
    """Force a fresh foresight assessment for a zone (bypasses cooldown)."""
    try:
        import foresight_engine
        from threat_matrix import compute_threat_score
        with get_db() as _db:
            score = compute_threat_score(zone_id, _db).get("threat_score", 0.0)
            assessment = await foresight_engine.run_foresight_analysis(
                zone_id, zone_id, float(score), _db, force=True
            )
        return {"triggered": True, "zone_id": zone_id, "assessment": assessment}
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"triggered": False, "error": str(e)}


@app.put("/api/fusions/{fusion_id}")
async def api_fusions_update(fusion_id: str, request: Request):
    try:
        from database import get_db as _gdb_f, FusionEvent as _FE
    except ImportError:
        raise HTTPException(status_code=503, detail="Fusion engine not available")
    body = await request.json()
    allowed = {"analyst_notes", "status", "marker_visible"}
    with _gdb_f() as _db:
        r = _db.query(_FE).filter(_FE.fusion_id == fusion_id).first()
        if not r:
            raise HTTPException(status_code=404, detail=f"Fusion {fusion_id} not found")
        for field in allowed:
            if field in body:
                setattr(r, field, body[field])
        r.updated_at = datetime.utcnow()
        _db.commit()
    return {"updated": fusion_id}


@app.delete("/api/fusions/{fusion_id}")
def api_fusions_delete(fusion_id: str):
    try:
        from database import get_db as _gdb_f, FusionEvent as _FE
    except ImportError:
        raise HTTPException(status_code=503, detail="Fusion engine not available")
    with _gdb_f() as _db:
        r = _db.query(_FE).filter(_FE.fusion_id == fusion_id).first()
        if not r:
            raise HTTPException(status_code=404, detail=f"Fusion {fusion_id} not found")
        r.status = "resolved"
        r.marker_visible = False
        r.resolved_at = datetime.utcnow()
        r.updated_at = datetime.utcnow()
        _db.commit()
    return {"resolved": fusion_id}


@app.get("/api/signals/recent")
def api_signals_recent(limit: int = 50):
    if not _fusion_engine:
        return []
    sigs = _fusion_engine.get_recent_signals()
    result = []
    for sig in sigs[-limit:]:
        ts = sig.get("timestamp")
        result.append({
            **sig,
            "timestamp": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
        })
    return list(reversed(result))


_fusion_settings: dict = {
    "fusion_window_hours": 2,
    "min_domains": 2,
    "min_signals": 2,
}


@app.get("/api/fusion-settings")
def api_fusion_settings_get():
    return _fusion_settings


@app.put("/api/fusion-settings")
async def api_fusion_settings_put(request: Request):
    body = await request.json()
    allowed = {"fusion_window_hours", "min_domains", "min_signals"}
    for key in allowed:
        if key in body:
            _fusion_settings[key] = body[key]
            if _fusion_engine:
                if key == "fusion_window_hours":
                    _fusion_engine.window_hours = float(body[key])
                elif key == "min_domains":
                    _fusion_engine.min_domains = int(body[key])
                elif key == "min_signals":
                    _fusion_engine.min_signals = int(body[key])
    return _fusion_settings


# ── Surge API ─────────────────────────────────────────────────────────────────

@app.get("/api/surge/config")
def api_surge_config_get():
    from database import SurgeConfig
    import json as _json
    with get_db() as db:
        cfg = db.query(SurgeConfig).first()
        if cfg is None:
            cfg = SurgeConfig()
            db.add(cfg)
            db.commit()
            db.refresh(cfg)
        try:
            eligible = _json.loads(cfg.eligible_types or "[]")
        except Exception:
            eligible = []
        return {
            "enabled":                  cfg.enabled,
            "volume_window_hours":      cfg.volume_window_hours,
            "volume_multiplier":        cfg.volume_multiplier,
            "velocity_window_minutes":  cfg.velocity_window_minutes,
            "velocity_threshold":       cfg.velocity_threshold,
            "baseline_days":            cfg.baseline_days,
            "eligible_types":           eligible,
            "cooldown_minutes":         cfg.cooldown_minutes,
        }


@app.put("/api/surge/config")
async def api_surge_config_put(request: Request):
    from database import SurgeConfig
    import json as _json
    body = await request.json()
    with get_db() as db:
        cfg = db.query(SurgeConfig).first()
        if cfg is None:
            cfg = SurgeConfig()
            db.add(cfg)
        allowed_bool  = {"enabled"}
        allowed_int   = {"volume_window_hours", "velocity_window_minutes", "velocity_threshold",
                         "baseline_days", "cooldown_minutes"}
        allowed_float = {"volume_multiplier"}
        for k in allowed_bool:
            if k in body:
                setattr(cfg, k, bool(body[k]))
        for k in allowed_int:
            if k in body:
                setattr(cfg, k, int(body[k]))
        for k in allowed_float:
            if k in body:
                setattr(cfg, k, float(body[k]))
        if "eligible_types" in body:
            cfg.eligible_types = _json.dumps(body["eligible_types"])
        db.commit()
        db.refresh(cfg)
        try:
            eligible = _json.loads(cfg.eligible_types or "[]")
        except Exception:
            eligible = []
        return {
            "enabled":                  cfg.enabled,
            "volume_window_hours":      cfg.volume_window_hours,
            "volume_multiplier":        cfg.volume_multiplier,
            "velocity_window_minutes":  cfg.velocity_window_minutes,
            "velocity_threshold":       cfg.velocity_threshold,
            "baseline_days":            cfg.baseline_days,
            "eligible_types":           eligible,
            "cooldown_minutes":         cfg.cooldown_minutes,
        }


@app.get("/api/surge/events")
def api_surge_events(
    status: str = None,
    article_type: str = None,
    country: str = None,
    limit: int = 50,
):
    from database import SurgeEvent
    import json as _json
    with get_db() as db:
        q = db.query(SurgeEvent)
        if status:
            q = q.filter(SurgeEvent.status == status)
        if article_type:
            q = q.filter(SurgeEvent.article_type == article_type)
        if country:
            q = q.filter(SurgeEvent.location_country == country)
        rows = q.order_by(SurgeEvent.created_at.desc()).limit(limit).all()
        result = []
        for r in rows:
            try:
                evidence = _json.loads(r.evidence_items or "[]")
            except Exception:
                evidence = []
            result.append({
                "id":                       r.id,
                "surge_id":                 r.surge_id,
                "created_at":               r.created_at.isoformat() if r.created_at else None,
                "expires_at":               r.expires_at.isoformat() if r.expires_at else None,
                "location_name":            r.location_name,
                "location_country":         r.location_country,
                "region_id":                r.region_id,
                "lat":                      r.lat,
                "lon":                      r.lon,
                "article_type":             r.article_type,
                "surge_type":               r.surge_type,
                "article_count":            r.article_count,
                "baseline_count":           r.baseline_count,
                "multiplier":               r.multiplier,
                "time_window_description":  r.time_window_description,
                "severity":                 r.severity,
                "headline":                 r.headline,
                "evidence_items":           evidence,
                "keyword":                  r.keyword,
                "context_summary":          r.context_summary,
                "why_it_matters":           r.why_it_matters,
                "status":                   r.status,
            })
        return result


@app.get("/api/surge/stats")
def api_surge_stats():
    from database import SurgeEvent
    with get_db() as db:
        active = db.query(SurgeEvent).filter(SurgeEvent.status == "active").all()
        by_type: dict = {}
        by_severity: dict = {}
        hottest: dict = {}
        for ev in active:
            by_type[ev.article_type]   = by_type.get(ev.article_type, 0) + 1
            by_severity[ev.severity]   = by_severity.get(ev.severity, 0) + 1
            loc = ev.location_country or ev.location_name or "unknown"
            hottest[loc] = hottest.get(loc, 0) + 1
        hottest_location = max(hottest, key=hottest.get) if hottest else None
        buf_stats = {}
        if _surge_engine:
            buf_stats = _surge_engine.get_buffer_stats()
        return {
            "active_surges":    len(active),
            "by_type":          by_type,
            "by_severity":      by_severity,
            "hottest_location": hottest_location,
            "buffer_stats":     buf_stats,
        }


# ── Alert explanations ────────────────────────────────────────────────────────

ALERT_EXPLANATIONS = {
    "Cable Loiterer":           "A vessel has been stationary or slow-moving over a subsea cable route for an extended period. This behaviour is associated with cable tapping, maintenance reconnaissance, or pre-sabotage positioning.",
    "Dark Ship":                "A vessel has disabled or is not transmitting its AIS transponder. This is a common technique used to conceal illicit cargo transfers, sanctions evasion, and covert military operations.",
    "Chokepoint Loitering":     "A vessel is lingering without clear purpose in or near a major maritime chokepoint (Strait of Hormuz, Bab-el-Mandeb, Suez Canal, etc.). This can indicate surveillance, blockade preparation, or pre-positioning.",
    "Ship-to-Ship Transfer": (
        "Two vessels have been in extremely close proximity (under 500m) offshore for 30+ minutes, "
        "moving slowly or stopped. Offshore STS transfers are the primary mechanism for sanctions "
        "evasion — transferring Iranian crude oil, Russian petroleum, or North Korean arms between "
        "vessels so the receiving ship has no connection to the sanctioned origin. This method has "
        "increased 400% since 2022 due to expanded sanctions regimes. "
        "Track both vessels after separation. Note destination ports and cargo declarations. "
        "Check both flag states and ownership chains against sanctions lists. "
        "Look for AIS gaps before or after the transfer."
    ),
    "Sanctioned Vessel": (
        "A vessel appearing on international sanctions lists has been detected at this position. "
        "Sanctioned vessels are prohibited from port access, insurance, financial services, and "
        "flag registration in signatory countries. Their continued operation despite sanctions "
        "indicates active evasion — they may use multiple MMSIs, false flags, identity changes, "
        "or intermediary ownership structures. "
        "Note current flag state vs registered flag. Check for recent AIS gaps (going dark). "
        "Look for nearby vessels that may be facilitating transfer or supply. "
        "Report to relevant authorities if within national jurisdiction."
    ),
    "Military Squawk":          "An aircraft is broadcasting a military transponder code. This indicates the aircraft is operating under military rules or has declared an emergency relevant to military operations.",
    "Transponder Anomaly":      "An aircraft's transponder has exhibited unusual behaviour — including sudden code changes, squawk 7700 (emergency), 7600 (radio failure), or 7500 (hijack). Warrants immediate monitoring.",
    "Vessel Speed Anomaly":     "A vessel's speed is significantly outside the normal range for its vessel type and location. May indicate mechanical issues, evasion, or rendezvous with another vessel.",
    "Port Entry Anomaly":       "A vessel with unusual or high-risk flags has entered a monitored port. May indicate sanctions circumvention or dual-use cargo.",
    "Loitering":                "An asset has remained stationary or slow-moving in a location of strategic interest beyond expected operational parameters.",
    "surge_velocity_spike":     "A rapid burst of news reporting has been detected from multiple sources about a single location or topic. Velocity spikes often precede major escalation events.",
    "surge_volume_surge":       "The volume of news reporting about this region has significantly exceeded the 7-day baseline, indicating sustained elevated activity or an ongoing developing situation.",
    "surge_keyword_surge":      "Multiple independent news sources have published articles containing a high-priority intelligence keyword. This keyword-triggered alert fires without LLM enrichment to ensure zero latency on emerging events.",
}

def _get_alert_explanation(alert_type: str, title: str = "") -> str:
    """Return an explanation string for an alert, matched by alert_type or title substring."""
    if alert_type in ALERT_EXPLANATIONS:
        return ALERT_EXPLANATIONS[alert_type]
    title_lower = (title or "").lower()
    for key, explanation in ALERT_EXPLANATIONS.items():
        if key.lower() in title_lower:
            return explanation
    return ""


def _enrich_alert(alert: dict) -> dict:
    """Inject flag, military allegiance, and explanation into a forge alert dict."""
    import json as _j
    src = (alert.get("source") or "").upper()

    if src == "AIS":
        mmsi = str(alert.get("mmsi") or "")
        if not mmsi:
            raw = alert.get("payload") or alert.get("raw_json") or "{}"
            if isinstance(raw, str):
                try: raw = _j.loads(raw)
                except: raw = {}
            mmsi = str(raw.get("mmsi") or "")
        if mmsi:
            try:
                from mmsi_lookup import lookup_mmsi
                ident = lookup_mmsi(mmsi)
                alert["vessel_flag"]      = ident["flag_emoji"]
                alert["vessel_country"]   = ident["flag_country"]
                alert["vessel_flag_url"]  = ident["flag_url"]
                alert["vessel_flag_iso2"] = ident["flag_iso2"]
            except Exception:
                pass

    elif src == "ADSB":
        icao = (alert.get("icao") or alert.get("hex") or "").strip()
        if not icao:
            raw = alert.get("payload") or alert.get("raw_json") or "{}"
            if isinstance(raw, str):
                try: raw = _j.loads(raw)
                except: raw = {}
            icao = str(raw.get("icao_hex") or raw.get("hex") or "")
        if icao:
            try:
                from icao_lookup import lookup_icao_hex
                ident = lookup_icao_hex(icao)
                alert["aircraft_military"]  = ident.get("military", False)
                alert["aircraft_country"]   = ident.get("country")
                alert["aircraft_service"]   = ident.get("service")
                alert["aircraft_flag"]      = ident.get("flag_emoji")
                alert["aircraft_flag_url"]  = ident.get("flag_url")
                alert["aircraft_flag_iso2"] = ident.get("flag_iso2")
                # Planespotters thumbnail (no auth required)
                alert["aircraft_image_url"] = f"https://api.planespotters.net/pub/photos/hex/{icao}"
            except Exception:
                pass

    rule_name = alert.get("rule_name") or alert.get("alert_type") or alert.get("rule") or alert.get("rule_type") or ""
    if not alert.get("explanation"):
        alert["explanation"] = _get_alert_explanation(rule_name, alert.get("message") or alert.get("title") or "")

    # Expose correlation + dedup fields (populated from DB-backed alerts)
    if "correlated_alert_ids" not in alert:
        alert["correlated_alert_ids"] = []
    elif isinstance(alert["correlated_alert_ids"], str):
        try:
            alert["correlated_alert_ids"] = _json.loads(alert["correlated_alert_ids"])
        except Exception:
            alert["correlated_alert_ids"] = []

    alert["is_correlated"]      = bool(alert.get("correlated_alert_ids"))
    alert["correlation_score"]  = alert.get("correlation_score") or 0
    alert["correlation_domains"]= alert.get("correlation_domains") or ""
    alert["analyst_note"]       = alert.get("analyst_note") or ""
    alert["fire_count"]         = alert.get("fire_count") or 1
    alert["dedup_key"]          = alert.get("dedup_key") or ""
    alert["rule_name"]          = rule_name  # normalise field name

    return alert


# ── Forge alerts ──────────────────────────────────────────────────────────────

def _dedup_alerts(alerts: list) -> list:
    return alerts


@app.get("/api/forge/alerts")
def forge_get_alerts(_forge=Depends(_require_forge)):
    enriched = [_enrich_alert(dict(a)) for a in _forge_alerts]
    return _dedup_alerts(enriched)


# ── Sanctions API endpoints ────────────────────────────────────────────────────

@app.get("/api/sanctions/mmsi-list")
def get_sanctions_mmsi_list(_=Depends(get_optional_user)):
    """Return all MMSIs from the in-memory sanctions index for frontend filtering."""
    mmsi_list = list(sanctions_loader._sanctions_by_mmsi.keys()) \
        if hasattr(sanctions_loader, "_sanctions_by_mmsi") else []
    return {"mmsi_list": mmsi_list, "count": len(mmsi_list)}


@app.get("/api/sanctions/stats")
def sanctions_stats(_=Depends(get_optional_user)):
    return sanctions_loader.stats()


@app.post("/api/sanctions/check")
async def sanctions_check(body: dict, _=Depends(get_optional_user)):
    mmsi = str(body.get("mmsi") or "").strip() or None
    imo  = str(body.get("imo")  or "").strip() or None
    name = str(body.get("name") or "").strip() or None
    hit  = sanctions_loader.check_vessel(mmsi=mmsi, imo=imo, name=name)
    if not hit:
        return {"hit": False}
    return {
        "hit":         True,
        "sanction":    hit,
        "explanation": sanctions_loader.get_sanction_explanation(hit),
    }


@app.get("/api/sanctions/hits")
def sanctions_hits(hours: int = 24, _=Depends(get_optional_user)):
    from database import Alert as _AM, get_db as _gdb
    with _gdb() as _db:
        rows = (
            _db.query(_AM)
            .filter(
                _AM.alert_type == "Sanctioned Vessel",
                _AM.created_at >= datetime.utcnow() - timedelta(hours=hours),
            )
            .order_by(_AM.created_at.desc())
            .limit(200)
            .all()
        )
    import json as _jh
    results = []
    for row in rows:
        try:
            d = _jh.loads(row.raw_json or "{}")
        except Exception:
            d = {}
        d.setdefault("id",       row.alert_id)
        d.setdefault("title",    row.title)
        d.setdefault("severity", row.severity)
        d.setdefault("lat",      row.lat)
        d.setdefault("lon",      row.lon)
        results.append(d)
    return {"hits": results, "count": len(results), "hours": hours}


@app.post("/api/sanctions/refresh")
async def sanctions_refresh(_=Depends(get_optional_user)):
    from database import SessionLocal as _SL
    sanctions_loader._last_loaded = None   # force refresh
    with _SL() as _db:
        stats = await sanctions_loader.load_or_refresh(_db)
    return stats


# ── Persistence API endpoints ──────────────────────────────────────────────────

@app.get("/api/alerts")
def api_get_alerts(
    source: str = None,
    alert_type: str = None,
    region: str = None,
    severity: str = None,
    status: str = "active",
    limit: int = 100,
    current_user=Depends(get_optional_user),
):
    from database import Alert as _AlertModel, get_db as _gdb_api
    with _gdb_api() as _db:
        q = _db.query(_AlertModel).filter(_AlertModel.status == status)
        if source:
            q = q.filter(_AlertModel.source == source)
        if alert_type:
            q = q.filter(_AlertModel.alert_type == alert_type)
        if region:
            q = q.filter(_AlertModel.region == region)
        if severity:
            q = q.filter(_AlertModel.severity == severity)
        rows = q.order_by(_AlertModel.created_at.desc()).limit(limit).all()
        return [
            {
                "alert_id":    r.alert_id, "source": r.source, "alert_type": r.alert_type,
                "title":       r.title, "severity": r.severity, "lat": r.lat, "lon": r.lon,
                "region":      r.region, "country_code": r.country_code,
                "entity_type": r.entity_type, "entity_id": r.entity_id, "entity_name": r.entity_name,
                "zone_ids":    r.zone_ids, "tags": r.tags, "status": r.status,
                "created_at":  r.created_at.isoformat() if r.created_at else None,
                "expires_at":  r.expires_at.isoformat() if r.expires_at else None,
                "explanation": _get_alert_explanation(r.alert_type, r.title),
            }
            for r in rows
        ]


@app.get("/api/alerts/{alert_id}")
def api_get_alert(alert_id: str, current_user=Depends(get_optional_user)):
    from database import Alert as _AlertModel, get_db as _gdb_api
    with _gdb_api() as _db:
        r = _db.query(_AlertModel).filter(_AlertModel.alert_id == alert_id).first()
        if not r:
            raise HTTPException(status_code=404, detail="Alert not found")
        import json as _j
        return {
            "alert_id":    r.alert_id, "source": r.source, "alert_type": r.alert_type,
            "title":       r.title, "severity": r.severity, "lat": r.lat, "lon": r.lon,
            "region":      r.region, "country_code": r.country_code,
            "entity_type": r.entity_type, "entity_id": r.entity_id, "entity_name": r.entity_name,
            "raw_json":    _j.loads(r.raw_json or "{}"),
            "zone_ids":    _j.loads(r.zone_ids or "[]"),
            "tags":        _j.loads(r.tags or "[]"),
            "status":      r.status,
            "created_at":  r.created_at.isoformat() if r.created_at else None,
            "expires_at":  r.expires_at.isoformat() if r.expires_at else None,
        }


@app.get("/api/signals")
def api_get_signals(
    domain: str = None,
    region: str = None,
    limit: int = 100,
    current_user=Depends(get_optional_user),
):
    from database import Signal as _SignalModel, get_db as _gdb_api
    with _gdb_api() as _db:
        q = _db.query(_SignalModel)
        if domain:
            q = q.filter(_SignalModel.domain == domain)
        if region:
            q = q.filter(_SignalModel.region == region)
        rows = q.order_by(_SignalModel.created_at.desc()).limit(limit).all()
        return [
            {
                "signal_id":   r.signal_id, "domain": r.domain, "signal_type": r.signal_type,
                "geo_key":     r.geo_key, "lat": r.lat, "lon": r.lon,
                "region":      r.region, "country_code": r.country_code,
                "source_id":   r.source_id, "title": r.title, "score": r.score,
                "fusion_id":   r.fusion_id,
                "created_at":  r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]


@app.get("/api/news-articles")
def api_get_news_articles(
    article_type: str = None,
    country_code: str = None,
    region: str = None,
    tier: int = None,
    llm_only: bool = False,
    limit: int = 100,
    current_user=Depends(get_optional_user),
):
    from database import NewsArticle as _NAModel, get_db as _gdb_api
    import json as _j
    with _gdb_api() as _db:
        q = _db.query(_NAModel)
        if article_type:
            q = q.filter(_NAModel.article_type == article_type)
        if country_code:
            q = q.filter(_NAModel.country_code == country_code)
        if region:
            q = q.filter(_NAModel.region == region)
        if tier is not None:
            q = q.filter(_NAModel.tier == tier)
        if llm_only:
            q = q.filter(_NAModel.llm_extracted == True)
        rows = q.order_by(_NAModel.ingested_at.desc()).limit(limit).all()
        return [
            {
                "url":            r.url, "title": r.title, "source_name": r.source_name,
                "published":      r.published, "lat": r.lat, "lon": r.lon,
                "location_name":  r.location_name, "country_code": r.country_code,
                "article_type":   r.article_type, "tier": r.tier, "relevance_score": r.relevance_score,
                "event_title":    r.event_title, "context_summary": r.context_summary,
                "is_breaking":    r.is_breaking, "llm_extracted": r.llm_extracted,
                "entities":       _j.loads(r.entities_json or "[]"),
                "image_url":      r.image_url, "region": r.region,
                "ingested_at":    r.ingested_at.isoformat() if r.ingested_at else None,
            }
            for r in rows
        ]


@app.get("/api/news-articles/{url:path}")
def api_get_news_article(url: str, current_user=Depends(get_optional_user)):
    from database import NewsArticle as _NAModel, get_db as _gdb_api
    import json as _j
    with _gdb_api() as _db:
        r = _db.query(_NAModel).filter(_NAModel.url == url).first()
        if not r:
            raise HTTPException(status_code=404, detail="Article not found")
        return {
            "url":           r.url, "title": r.title, "source_name": r.source_name,
            "published":     r.published, "lat": r.lat, "lon": r.lon,
            "location_name": r.location_name, "country_code": r.country_code,
            "article_type":  r.article_type, "tier": r.tier, "relevance_score": r.relevance_score,
            "event_title":   r.event_title, "context_summary": r.context_summary,
            "is_breaking":   r.is_breaking, "llm_extracted": r.llm_extracted,
            "entities":      _j.loads(r.entities_json or "[]"),
            "image_url":     r.image_url, "body": r.body, "region": r.region,
            "ingested_at":   r.ingested_at.isoformat() if r.ingested_at else None,
        }


@app.get("/api/ontology-links")
def api_get_ontology_links(
    entity_type: str = None,
    entity_id: str = None,
    source_type: str = None,
    source_id: str = None,
    limit: int = 100,
    current_user=Depends(get_optional_user),
):
    from database import OntologyLink as _OLModel, get_db as _gdb_api
    with _gdb_api() as _db:
        q = _db.query(_OLModel)
        if entity_type:
            q = q.filter(_OLModel.entity_type == entity_type)
        if entity_id:
            q = q.filter(_OLModel.entity_id == entity_id)
        if source_type:
            q = q.filter(_OLModel.source_type == source_type)
        if source_id:
            q = q.filter(_OLModel.source_id == source_id)
        rows = q.order_by(_OLModel.created_at.desc()).limit(limit).all()
        return [
            {
                "link_id":     r.link_id, "source_type": r.source_type, "source_id": r.source_id,
                "entity_type": r.entity_type, "entity_id": r.entity_id, "entity_name": r.entity_name,
                "link_type":   r.link_type, "distance_km": r.distance_km, "confidence": r.confidence,
                "created_at":  r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]


@app.get("/api/entities/{entity_type}/{entity_id}/profile")
def api_get_entity_profile(entity_type: str, entity_id: str, current_user=Depends(get_optional_user)):
    """Full intelligence profile for any ontology entity."""
    from database import (OntologyLink as _OLM, Alert as _AM, NewsArticle as _NAM,
                          FusionEvent as _FEM, SurgeEvent as _SEM,
                          OntologyEntity as _OEM, get_db as _gdb_p)
    import json as _jprof
    now = datetime.utcnow()
    cutoff_24h = now - timedelta(hours=24)
    cutoff_48h = now - timedelta(hours=48)

    with _gdb_p() as _db:
        # 1. Entity record
        ent = _db.query(_OEM).filter(_OEM.system_id == entity_id).first()
        entity_data = None
        if ent:
            entity_data = {
                "system_id":   ent.system_id, "entity_type": ent.entity_type,
                "name":        ent.name, "infra_type": ent.infra_type,
                "region_id":   ent.region_id,
                "metadata":    _jprof.loads(ent.entity_metadata or "{}"),
            }

        # 2. All OntologyLinks to this entity (last 48h)
        links = (_db.query(_OLM)
                 .filter(_OLM.entity_type == entity_type,
                         _OLM.entity_id   == entity_id,
                         _OLM.created_at  >= cutoff_48h)
                 .order_by(_OLM.created_at.desc())
                 .limit(200).all())

        alert_ids   = [l.source_id for l in links if l.source_type in ("alert","ais","adsb","sentinel","surge","news")]
        article_urls = [l.source_id for l in links if l.source_type == "article"]
        fusion_ids  = [l.source_id for l in links if l.source_type == "fusion"]

        # 3. Linked Alerts (last 24h)
        active_alerts = []
        if alert_ids:
            rows = (_db.query(_AM)
                    .filter(_AM.alert_id.in_(alert_ids),
                            _AM.status == "active",
                            _AM.created_at >= cutoff_24h)
                    .order_by(_AM.created_at.desc()).limit(20).all())
            active_alerts = [
                {"alert_id": r.alert_id, "title": r.title, "severity": r.severity,
                 "source": r.source, "lat": r.lat, "lon": r.lon,
                 "created_at": r.created_at.isoformat() if r.created_at else None}
                for r in rows
            ]

        # 4. Linked News Articles (last 48h)
        recent_articles = []
        if article_urls:
            rows = (_db.query(_NAM)
                    .filter(_NAM.url.in_(article_urls),
                            _NAM.ingested_at >= cutoff_48h)
                    .order_by(_NAM.ingested_at.desc()).limit(20).all())
            recent_articles = [
                {"url": r.url, "title": r.event_title or r.title,
                 "article_type": r.article_type, "tier": r.tier,
                 "ingested_at": r.ingested_at.isoformat() if r.ingested_at else None}
                for r in rows
            ]

        # 5. Linked Fusion Events
        active_fusions = []
        if fusion_ids:
            rows = (_db.query(_FEM)
                    .filter(_FEM.fusion_id.in_(fusion_ids),
                            _FEM.status == "active")
                    .limit(10).all())
            active_fusions = [
                {"fusion_id": r.fusion_id, "title": r.title,
                 "severity": r.severity, "confidence": r.confidence,
                 "domains": _jprof.loads(r.domains or "[]")}
                for r in rows
            ]

        # 6. Active Surges in same region (via entity's region_id)
        active_surges = []
        if ent and ent.region_id:
            rows = (_db.query(_SEM)
                    .filter(_SEM.region_id == ent.region_id,
                            _SEM.status == "active",
                            _SEM.expires_at > now)
                    .order_by(_SEM.expires_at.desc()).limit(5).all())
            active_surges = [
                {"surge_id": r.surge_id, "headline": r.headline,
                 "severity": r.severity, "article_type": r.article_type}
                for r in rows
            ]

        # 7. Threat contribution
        severities = [a["severity"] for a in active_alerts]
        sev_order  = {"critical": 4, "high": 3, "medium": 2, "info": 1, "low": 0}
        highest    = max(severities, key=lambda s: sev_order.get(s, 0)) if severities else None

        recent_links = [
            {"link_id": l.link_id, "source_type": l.source_type, "source_id": l.source_id,
             "link_type": l.link_type, "distance_km": l.distance_km,
             "created_at": l.created_at.isoformat() if l.created_at else None}
            for l in links[:50]
        ]

        return {
            "entity":              entity_data,
            "active_alerts":       active_alerts,
            "recent_articles":     recent_articles,
            "active_fusions":      active_fusions,
            "active_surges":       active_surges,
            "threat_contribution": {
                "alert_count":          len(active_alerts),
                "highest_severity":     highest,
                "linked_fusion_count":  len(active_fusions),
                "linked_surge_count":   len(active_surges),
            },
            "recent_links":        recent_links,
        }


@app.get("/api/entities/{entity_type}/{entity_id}/links")
def api_get_entity_links(entity_type: str, entity_id: str, current_user=Depends(get_optional_user)):
    from database import OntologyLink as _OLModel, get_db as _gdb_api
    with _gdb_api() as _db:
        rows = (_db.query(_OLModel)
                .filter(_OLModel.entity_type == entity_type, _OLModel.entity_id == entity_id)
                .order_by(_OLModel.created_at.desc())
                .limit(200)
                .all())
        return [
            {
                "link_id":     r.link_id, "source_type": r.source_type, "source_id": r.source_id,
                "link_type":   r.link_type, "distance_km": r.distance_km, "confidence": r.confidence,
                "created_at":  r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]


@app.get("/api/entities/{entity_type}/{entity_id}/timeline")
def api_get_entity_timeline(
    entity_type: str, entity_id: str,
    days: int = 7,
    current_user=Depends(get_optional_user),
):
    from database import OntologyLink as _OLModel, Alert as _AlertModel, NewsArticle as _NAModel, get_db as _gdb_api
    import json as _j
    since = datetime.utcnow() - timedelta(days=days)
    with _gdb_api() as _db:
        links = (_db.query(_OLModel)
                 .filter(_OLModel.entity_type == entity_type,
                         _OLModel.entity_id == entity_id,
                         _OLModel.created_at >= since)
                 .order_by(_OLModel.created_at.desc())
                 .limit(200)
                 .all())
        events = []
        for lnk in links:
            item = {
                "link_id":     lnk.link_id, "source_type": lnk.source_type,
                "source_id":   lnk.source_id, "link_type": lnk.link_type,
                "distance_km": lnk.distance_km,
                "ts":          lnk.created_at.isoformat() if lnk.created_at else None,
            }
            if lnk.source_type == "alert":
                r = _db.query(_AlertModel).filter(_AlertModel.alert_id == lnk.source_id).first()
                if r:
                    item["title"]    = r.title
                    item["severity"] = r.severity
            elif lnk.source_type == "article":
                r = _db.query(_NAModel).filter(_NAModel.url == lnk.source_id).first()
                if r:
                    item["title"]        = r.event_title or r.title
                    item["article_type"] = r.article_type
                    item["tier"]         = r.tier
            events.append(item)
        return {"entity_type": entity_type, "entity_id": entity_id, "days": days, "events": events}


# ── Ontology graph endpoints ────────────────────────────────────────────────

@app.get("/api/ontology/graph")
def api_ontology_graph(
    include_airports: bool = False,
    include_ports: bool = False,
    include_cables: bool = True,
    include_live: bool = True,
    severity_filter: str = None,
    since: str = None,
    limit_live: int = 200,
    current_user=Depends(get_optional_user),
):
    from database import (
        OntologyEntity as _OEM, Alert as _AM, FusionEvent as _FEM,
        SurgeEvent as _SEM, OntologyLink as _OLM, RuleConnection as _RCM,
        Airport as _AirM, PortBoundary as _PortM, CableSegment as _CabM,
        get_db as _gdb_g,
    )
    from intelligence_schema import IntelligenceAssessment as _IAM
    import json as _jg
    now = datetime.utcnow()
    cutoff_live = now - timedelta(hours=24)
    cutoff_links = now - timedelta(hours=48)
    if since:
        try:
            cutoff_live = datetime.fromisoformat(since.rstrip("Z"))
        except Exception:
            pass

    SEV_ORDER = {"critical": 4, "high": 3, "medium": 2, "info": 1, "low": 0}

    nodes = []
    edges = []
    live_alert_count = 0
    live_fusion_count = 0

    with _gdb_g() as _db:
        # ── Static OntologyEntity nodes ───────────────────────────────────
        q_ent = _db.query(_OEM)
        ents = q_ent.limit(2000).all()
        for e in ents:
            etype = (e.entity_type or "").lower()
            if etype in ("airport", "large_airport") and not include_airports:
                continue
            if etype == "port" and not include_ports:
                continue
            if etype == "cable" and not include_cables:
                continue
            nodes.append({
                "id":    e.system_id, "type": e.entity_type,
                "label": e.name or e.system_id,
                "region_id": e.region_id, "infra_type": e.infra_type,
                "is_live": False,
            })

        # Static infra nodes (cables only unless flags set)
        if include_cables:
            for r in _db.query(_CabM.system_id, _CabM.cable_name).limit(500).all():
                if r.system_id:
                    nodes.append({"id": r.system_id, "type": "cable",
                                  "label": r.cable_name or r.system_id, "is_live": False})
        if include_ports:
            for r in _db.query(_PortM.id, _PortM.port_name, _PortM.system_id).limit(200).all():
                sid = str(r.system_id or r.id)
                nodes.append({"id": sid, "type": "port",
                              "label": r.port_name or sid, "is_live": False})
        if include_airports:
            for r in _db.query(_AirM.id, _AirM.name, _AirM.airport_type).filter(
                    _AirM.airport_type == "large_airport").limit(300).all():
                nodes.append({"id": str(r.id), "type": "airport",
                              "label": r.name or str(r.id), "is_live": False})

        # ── Live nodes ────────────────────────────────────────────────────
        if include_live:
            q_alr = (_db.query(_AM).filter(_AM.status == "active", _AM.created_at >= cutoff_live)
                     .order_by(_AM.created_at.desc()).limit(limit_live).all())
            for r in q_alr:
                if severity_filter and SEV_ORDER.get(r.severity, 0) < SEV_ORDER.get(severity_filter, 0):
                    continue
                nodes.append({
                    "id": r.alert_id, "type": "alert", "label": r.title[:60],
                    "severity": r.severity, "domain": r.source,
                    "lat": r.lat, "lon": r.lon,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "is_live": True,
                })
                live_alert_count += 1

            for r in (_db.query(_FEM).filter(_FEM.status == "active", _FEM.expires_at > now)
                      .limit(50).all()):
                nodes.append({
                    "id": r.fusion_id, "type": "fusion_event", "label": r.title[:60],
                    "severity": r.severity, "domain": "FUSION",
                    "lat": r.lat, "lon": r.lon,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "is_live": True,
                })
                live_fusion_count += 1

            for r in (_db.query(_SEM).filter(_SEM.status == "active", _SEM.expires_at > now)
                      .limit(30).all()):
                nodes.append({
                    "id": r.surge_id, "type": "surge", "label": r.headline[:60],
                    "severity": r.severity, "domain": "NEWS",
                    "lat": r.lat, "lon": r.lon,
                    "is_live": True,
                })

            for r in (_db.query(_IAM).filter(_IAM.expires_at > now,
                      _IAM.severity.in_(["high", "critical"])).limit(30).all()):
                nodes.append({
                    "id": r.assessment_id, "type": "assessment", "label": r.headline[:60],
                    "severity": r.severity, "domain": r.domain,
                    "lat": r.lat, "lon": r.lon, "is_live": True,
                })

        # ── Static edges (RuleConnections) ────────────────────────────────
        for r in _db.query(_RCM).limit(500).all():
            edges.append({
                "id":         f"RC-{r.id}",
                "source":     str(r.rule_id_a), "target": str(r.rule_id_b),
                "type":       r.relationship_type,
                "confidence": 1.0, "is_live": False,
            })

        # ── Dynamic edges (OntologyLinks, last 48h) ───────────────────────
        dyn_links = (_db.query(_OLM)
                     .filter(_OLM.created_at >= cutoff_links)
                     .order_by(_OLM.created_at.desc())
                     .limit(1000).all())
        for r in dyn_links:
            edges.append({
                "id":         r.link_id,
                "source":     r.source_id, "target": r.entity_id,
                "type":       r.link_type,
                "confidence": r.confidence,
                "distance_km": r.distance_km,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "is_live":    True,
            })

    # Deduplicate nodes by id
    seen_ids: set = set()
    unique_nodes = []
    for n in nodes:
        if n["id"] not in seen_ids:
            seen_ids.add(n["id"])
            unique_nodes.append(n)

    return {
        "nodes": unique_nodes,
        "edges": edges,
        "stats": {
            "total_nodes":    len(unique_nodes),
            "total_edges":    len(edges),
            "live_alerts":    live_alert_count,
            "live_fusions":   live_fusion_count,
            "static_entities": sum(1 for n in unique_nodes if not n.get("is_live")),
            "dynamic_links":  sum(1 for e in edges if e.get("is_live")),
        },
    }


@app.get("/api/ontology/graph/delta")
def api_ontology_graph_delta(
    since: str,
    current_user=Depends(get_optional_user),
):
    """Return only nodes/edges created after `since` (ISO timestamp)."""
    return api_ontology_graph(
        include_cables=True, include_live=True, since=since, limit_live=500,
        current_user=current_user,
    )


@app.get("/api/ontology/graph/stream")
async def api_ontology_graph_stream():
    # Temporarily disabled — persistent connections were causing backend instability
    from fastapi.responses import Response
    return Response(content="", media_type="text/event-stream")


# ── Threat matrix explainability ─────────────────────────────────────────────

@app.get("/api/analytics/threat-matrix/{region_name}/explain")
async def api_threat_matrix_explain(
    region_name: str,
    current_user=Depends(get_optional_user),
):
    from database import (Alert as _AMex, FusionEvent as _FMex, SurgeEvent as _SMex,
                          SentinelDetection as _SDex, OntologyLink as _OLex,
                          get_db as _gdb_ex)
    import json as _jex
    from threat_matrix import REGIONS, _in_bbox, _threat_level
    region_name_decoded = region_name.replace("+", " ")
    region = REGIONS.get(region_name_decoded)
    if not region:
        raise HTTPException(status_code=404, detail=f"Region '{region_name_decoded}' not found")

    bbox   = region["bbox"]
    now    = datetime.utcnow()
    cutoff = now - timedelta(hours=24)

    with _gdb_ex() as _db:
        # Collect driver data
        db_alerts = (_db.query(_AMex)
                     .filter(_AMex.status == "active", _AMex.created_at >= cutoff,
                             _AMex.lat.between(bbox["min_lat"], bbox["max_lat"]),
                             _AMex.lon.between(bbox["min_lon"], bbox["max_lon"]))
                     .order_by(_AMex.created_at.desc()).limit(20).all())

        fusions = (_db.query(_FMex)
                   .filter(_FMex.status == "active", _FMex.expires_at > now,
                           _FMex.lat.isnot(None))
                   .all())
        fusions_in = [f for f in fusions if _in_bbox(f.lat, f.lon, bbox)]

        surges = (_db.query(_SMex)
                  .filter(_SMex.status == "active", _SMex.expires_at > now)
                  .all())
        surges_in = [s for s in surges
                     if _in_bbox(s.lat, s.lon, bbox) if s.lat]

        sentinels = (_db.query(_SDex)
                     .filter(_SDex.created_at >= cutoff)
                     .all())
        sents_in = [d for d in sentinels if _in_bbox(d.centroid_lat, d.centroid_lon, bbox)]

        links_in = (_db.query(_OLex)
                    .filter(_OLex.created_at >= cutoff)
                    .limit(50).all())

        # Score breakdown
        SEV_W = {"info": 0.5, "medium": 1, "high": 2, "critical": 4}
        weighted = sum(SEV_W.get(a.severity or "medium", 1) for a in db_alerts)
        forge_n  = len([a for a in db_alerts if a.source in ("ais","adsb","sentinel")])
        sent_sc  = sum(SEV_W.get(d.severity or "info", 1) for d in sents_in)
        fus_sc   = len(fusions_in) * 15
        surge_sc = sum(10 for _ in surges_in)
        link_sc  = min(len(links_in), 10)
        base_sc  = min(weighted * 2, 40)
        forge_sc = min(forge_n * 5, 25)
        total    = min(base_sc + forge_sc + min(sent_sc, 20) + min(fus_sc, 30)
                       + min(surge_sc, 25) + link_sc, 100.0)

        drivers = {
            "alerts":    [{"alert_id": a.alert_id, "title": a.title,
                           "severity": a.severity, "source": a.source,
                           "lat": a.lat, "lon": a.lon} for a in db_alerts[:5]],
            "fusions":   [{"fusion_id": f.fusion_id, "title": f.title,
                           "severity": f.severity, "confidence": f.confidence}
                          for f in fusions_in[:5]],
            "surges":    [{"surge_id": s.surge_id, "headline": s.headline,
                           "severity": s.severity} for s in surges_in[:3]],
            "sentinels": [{"detection_id": d.detection_id, "object_type": d.object_type,
                           "severity": d.severity, "confidence": d.confidence,
                           "nearest_port": d.nearest_port} for d in sents_in[:3]],
            "links":     [{"link_id": l.link_id, "source_type": l.source_type,
                           "entity_type": l.entity_type, "entity_name": l.entity_name}
                          for l in links_in[:5]],
        }

    # Generate Haiku explanation
    explanation = ""
    if client:
        try:
            driver_txt = (
                f"Region: {region_name_decoded}\n"
                f"Alert count: {len(db_alerts)} (forge: {forge_n})\n"
                f"Fusion events: {len(fusions_in)}\n"
                f"Surge events: {len(surges_in)}\n"
                f"Sentinel detections: {len(sents_in)}\n"
                f"Top alerts: {'; '.join(a['title'] for a in drivers['alerts'][:3])}\n"
                f"Top fusions: {'; '.join(f['title'] for f in drivers['fusions'][:2])}\n"
            )
            _msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=200, temperature=0,
                system="You are an intelligence analyst. Write one precise paragraph explaining why this region has an elevated threat score. Analyst voice, specific, no preamble.",
                messages=[{"role": "user", "content": driver_txt}],
            )
            explanation = _msg.content[0].text.strip()
        except Exception as _hex:
            explanation = f"Score driven by {len(db_alerts)} active alerts and {len(fusions_in)} fusion events in {region_name_decoded}."

    return {
        "region":      region_name_decoded,
        "score":       round(total, 1),
        "threat_level": _threat_level(total),
        "explanation": explanation,
        "drivers":     drivers,
        "score_breakdown": {
            "base_alert_score": round(base_sc, 1),
            "forge_bonus":      round(forge_sc, 1),
            "fusion_score":     round(min(fus_sc, 30), 1),
            "surge_bonus":      round(min(surge_sc, 25), 1),
            "sentinel_score":   round(min(sent_sc, 20), 1),
            "link_bonus":       link_sc,
            "total":            round(total, 1),
        },
    }


@app.get("/api/forge/correlations")
def forge_get_correlations(_forge=Depends(_require_forge)):
    return sorted(
        _correlation_assessments,
        key=lambda x: (x.get("confidence", 0), x.get("signal_count", 0)),
        reverse=True,
    )


@app.post("/api/forge/alerts/{alert_idx}/feedback")
async def forge_alert_feedback(alert_idx: int, request: Request, _forge=Depends(_require_forge)):
    body    = await request.json()
    action  = body.get("action")  # 'confirm' or 'false_alarm'
    if not _HAS_DETECTORS:
        raise HTTPException(status_code=503, detail="Detector engine not available")
    if alert_idx >= len(_forge_alerts):
        raise HTTPException(status_code=404, detail="Alert index out of range")

    alert   = _forge_alerts[alert_idx]
    source  = alert.get("source", "ais_anomaly")
    rule_id = alert.get("rule_id")

    # Map alert source to threat-engine weight key
    weight_key = (
        "ais_anomaly"     if source == "AIS"  else
        "adsb_anomaly"    if source == "ADSB" else
        "news_escalation" if source == "NEWS" else
        source
    )

    if action == "confirm":
        current = _threat_engine.weights.get(weight_key, 0.2)
        _threat_engine.weights[weight_key] = min(0.5, current + 0.01)
    elif action == "false_alarm":
        current = _threat_engine.weights.get(weight_key, 0.2)
        _threat_engine.weights[weight_key] = max(0.05, current - 0.01)

    total = sum(_threat_engine.weights.values()) or 1
    _threat_engine.weights = {k: round(v / total, 4) for k, v in _threat_engine.weights.items()}

    # Adjust rule sensitivity if alert came from a named rule
    rule_adjusted = False
    if rule_id and action == "false_alarm":
        rules = _load_forge_rules()
        for rule in rules:
            if rule.get("id") == rule_id:
                p = rule.setdefault("params", {})
                if "proximity_km" in p:
                    p["proximity_km"] = max(1, p["proximity_km"] - 1)
                if "max_speed_knots" in p:
                    p["max_speed_knots"] = round(max(0.1, p["max_speed_knots"] - 0.1), 2)
                if "gap_minutes" in p:
                    p["gap_minutes"] = min(120, p["gap_minutes"] + 5)
                rule["last_feedback"]  = action
                rule["feedback_count"] = rule.get("feedback_count", 0) + 1
                rule_adjusted = True
                break
        if rule_adjusted:
            _forge_save("rules.json", rules)

    _FORGE_DIR.mkdir(parents=True, exist_ok=True)
    (_FORGE_DIR / "forge_weights.json").write_text(_json.dumps(_threat_engine.weights, indent=2))
    return {"weights": _threat_engine.weights, "rule_adjusted": rule_id if rule_adjusted else None}


# ── Threat scores ─────────────────────────────────────────────────────────────

_THREAT_REGION_BOUNDS = {
    "Persian Gulf":    {"lat": [23.0, 30.0], "lng": [48.0, 60.0]},
    "Red Sea":         {"lat": [12.0, 30.0], "lng": [32.0, 45.0]},
    "East Med":        {"lat": [30.0, 37.0], "lng": [25.0, 37.0]},
    "Sahel":           {"lat": [10.0, 20.0], "lng": [-15.0, 15.0]},
    "Horn of Africa":  {"lat": [-5.0, 15.0], "lng": [35.0, 55.0]},
    "South China Sea": {"lat": [5.0, 25.0],  "lng": [105.0, 125.0]},
    "Black Sea":       {"lat": [40.0, 47.0], "lng": [27.0, 42.0]},
    "Baltic":          {"lat": [53.0, 66.0], "lng": [10.0, 30.0]},
}


def _in_region(lat, lng, bounds):
    if lat is None or lng is None:
        return False
    return (bounds["lat"][0] <= lat <= bounds["lat"][1] and
            bounds["lng"][0] <= lng <= bounds["lng"][1])


_THREAT_REGION_BOUNDS_V2 = {
    "Persian Gulf":          {"lat": [23.0, 30.0], "lng": [48.0, 60.0]},
    "Red Sea / Bab el-Mandeb": {"lat": [12.0, 22.0], "lng": [32.0, 45.0]},
    "East Mediterranean":    {"lat": [30.0, 37.0], "lng": [25.0, 37.0]},
    "Sahel":                 {"lat": [10.0, 20.0], "lng": [-15.0, 15.0]},
    "Horn of Africa":        {"lat": [-5.0, 15.0], "lng": [35.0, 55.0]},
    "South China Sea":       {"lat":  [5.0, 25.0], "lng": [105.0, 125.0]},
    "Black Sea / Ukraine":   {"lat": [40.0, 50.0], "lng": [27.0, 42.0]},
    "Baltic":                {"lat": [53.0, 66.0], "lng": [10.0, 30.0]},
    "Taiwan Strait":         {"lat": [22.0, 28.0], "lng": [116.0, 125.0]},
    "Indian Ocean":          {"lat": [-10.0, 15.0], "lng": [55.0, 80.0]},
}


@app.get("/api/forge/threat-scores")
def forge_threat_scores(_forge=Depends(_require_forge)):
    if not _HAS_DETECTORS:
        return []

    # Snapshot live data once
    with _AIS_LOCK:
        vessels_snap = list(_AIS_VESSELS.values())
    active_events = []
    try:
        active_events = es.get_active_events()
    except Exception:
        pass

    scores = []
    for region_name, bounds in _THREAT_REGION_BOUNDS_V2.items():
        # Forge alerts
        region_alerts = [a for a in _forge_alerts if _in_region(a.get("lat"), a.get("lng"), bounds)]
        ais_alerts    = [a for a in region_alerts if a.get("source") == "AIS"]
        adsb_alerts   = [a for a in region_alerts if a.get("source") == "ADSB"]

        # ALL news events in region (not just high severity — density matters)
        news_count = sum(
            1 for ev in active_events
            if _in_region(ev.get("lat"), ev.get("lng") or ev.get("lon"), bounds)
        )

        # High-severity news for escalation signal
        news_high = sum(
            1 for ev in active_events
            if _in_region(ev.get("lat"), ev.get("lng") or ev.get("lon"), bounds)
            and (ev.get("severity") or "").lower() in ("high", "critical")
        )

        # Live vessels in region (even without alerts — density is signal)
        vessel_count = sum(
            1 for v in vessels_snap
            if _in_region(v.get("lat"), v.get("lon") or v.get("lng"), bounds)
        )

        region_corrs = [c for c in _correlation_assessments
                        if _in_region(c.get("lat"), c.get("lng"), bounds)]

        signals = {
            "ais_anomaly":      min(len(ais_alerts)  * 0.15, 1.0),
            "adsb_anomaly":     min(len(adsb_alerts) * 0.20, 1.0),
            "news_escalation":  min(news_high         * 0.08 + news_count * 0.01, 1.0),
            "satellite_change": 0.0,
            "event_density":    min(news_count * 0.02 + vessel_count * 0.005, 1.0),
        }
        result = _threat_engine.calculate_region_threat(region_name, signals, correlations=region_corrs)
        result["alert_count"]    = len(region_alerts)
        result["vessel_count"]   = vessel_count
        result["news_count"]     = news_count
        result["corr_count"]     = len(region_corrs)
        result["signals_raw"] = {
            "ais_alerts":       len(ais_alerts),
            "adsb_alerts":      len(adsb_alerts),
            "news_events":      news_count,
            "news_high":        news_high,
            "vessels_tracked":  vessel_count,
            "correlations":     len(region_corrs),
        }
        scores.append(result)

    scores.sort(key=lambda x: x["score"], reverse=True)
    return scores


@app.get("/api/analytics/threat-matrix")
def analytics_threat_matrix():
    """Current threat scores for all regions — from hourly in-memory cache."""
    cached = threat_matrix.get_cached_scores()
    if cached:
        return cached
    # Cache cold (first startup) — compute live
    active_events = []
    try:
        active_events = es.get_active_events()
    except Exception:
        pass
    _fusions_live = []
    try:
        if _fusion_engine:
            from database import FusionEvent as _FE_live, get_db as _gdb_fev
            with _gdb_fev() as _dbfev:
                _fusions_live = [
                    {"lat": r.lat, "lon": r.lon, "severity": r.severity}
                    for r in _dbfev.query(_FE_live).filter(
                        _FE_live.status == "active", _FE_live.marker_visible == True
                    ).all()
                ]
    except Exception:
        pass
    from database import get_db as _gdb_tm2
    with _gdb_tm2() as _db:
        return threat_matrix.refresh_cache(_db, list(_forge_alerts), active_events, _fusions_live)


@app.get("/api/analytics/threat-matrix/history")
def analytics_threat_matrix_history(
    region_name: str = Query(None),
    days: int = Query(30, ge=1, le=365),
):
    """Historical threat snapshots for a region (or all regions)."""
    from database import ThreatMatrixSnapshot, get_db as _gdb_tm3
    import json as _j
    cutoff = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    with _gdb_tm3() as _db:
        q = _db.query(ThreatMatrixSnapshot).filter(ThreatMatrixSnapshot.snapshot_date >= cutoff)
        if region_name:
            q = q.filter(ThreatMatrixSnapshot.region_name == region_name)
        rows = q.order_by(ThreatMatrixSnapshot.snapshot_date).all()
        return [
            {
                "snapshot_date":             r.snapshot_date,
                "region_name":               r.region_name,
                "region_id":                 r.region_id,
                "threat_score":              r.threat_score,
                "threat_level":              r.threat_level,
                "alert_count":               r.alert_count,
                "forge_alert_count":         r.forge_alert_count,
                "sentinel_detection_count":  r.sentinel_detection_count,
                "news_event_count":          r.news_event_count,
                "contributing_signals":      _j.loads(r.contributing_signals or "[]"),
            }
            for r in rows
        ]


# ── Training data export ──────────────────────────────────────────────────────

@app.get("/api/forge/export-training-data")
def forge_export_training_data(_forge=Depends(_require_forge)):
    labels = _forge_load("forge_labels.json")
    confirmed = [l for l in labels if l.get("label") == "confirmed"]
    corrected  = [l for l in labels if l.get("label") == "corrected"]
    return {
        "total":               len(labels),
        "confirmed":           len(confirmed),
        "corrected":           len(corrected),
        "labels":              labels,
        "ready_for_training":  len(labels) >= 500,
    }


# ── Ontology ──────────────────────────────────────────────────────────────────

def _forge_ontology_load():
    path = _FORGE_DIR / "forge_ontology.json"
    if not path.exists():
        return {"nodes": [], "edges": []}
    try:
        return _json.loads(path.read_text())
    except Exception:
        return {"nodes": [], "edges": []}


def _forge_ontology_save(ontology: dict):
    _FORGE_DIR.mkdir(parents=True, exist_ok=True)
    (_FORGE_DIR / "forge_ontology.json").write_text(
        _json.dumps(ontology, indent=2, ensure_ascii=False)
    )


@app.get("/api/forge/ontology")
def forge_get_ontology(_forge=Depends(_require_forge)):
    result = _forge_ontology_load()
    if not result.get("nodes"):
        result = api_ontology_graph(current_user=None)
    return result


@app.post("/api/forge/ontology/build")
async def forge_build_ontology(_forge=Depends(_require_forge)):
    import random as _random
    # Merge: keep existing nodes/edges, only add new ones by label
    existing = _forge_ontology_load()
    nodes: list = list(existing.get("nodes", []))
    edges: list = list(existing.get("edges", []))
    existing_labels: set = {n["label"].lower() for n in nodes}
    existing_edge_keys: set = {(e.get("source"), e.get("target"), e.get("type")) for e in edges}
    _nc = [len(nodes)]

    def add_node(type_, label, description="", lat=None, lng=None):
        key = label.lower()
        if key in existing_labels:
            return next((n["id"] for n in nodes if n["label"].lower() == key), None)
        existing_labels.add(key)
        _nc[0] += 1
        nid = f"{type_}_{_nc[0]}"
        nodes.append({"id": nid, "type": type_, "label": label,
                      "description": description, "lat": lat, "lng": lng})
        return nid

    def add_edge(src, tgt, rel):
        if not src or not tgt:
            return
        key = (src, tgt, rel)
        if key in existing_edge_keys:
            return
        existing_edge_keys.add(key)
        edges.append({"id": f"e_{len(edges)}", "source": src, "target": tgt, "type": rel})

    # ── Chokepoints ──────────────────────────────────────────────────────────
    chokepoint_ids: dict = {}
    try:
        for cp in _CHOKEPOINT_DEFS[:20]:
            nid = add_node("chokepoint", cp["name"],
                           f"Threat: {cp.get('threat_level','standard')}",
                           cp.get("lat") or cp.get("center_lat"),
                           cp.get("lon") or cp.get("center_lng"))
            chokepoint_ids[cp["name"]] = nid
        print(f"[ontology] {len(chokepoint_ids)} chokepoints")
    except Exception as _e:
        print(f"[ontology] chokepoints failed: {_e}")

    # ── Countries ────────────────────────────────────────────────────────────
    key_countries = [
        "Iran", "United States", "Russia", "China", "Israel", "Saudi Arabia",
        "Yemen", "Mali", "Sudan", "Ukraine", "Turkey", "Egypt", "France",
        "United Kingdom", "India", "Somalia", "Djibouti", "Oman", "UAE", "Qatar",
        "Iraq", "Syria", "Libya", "Nigeria", "Chad", "Niger", "Kenya",
        "South Korea", "North Korea", "Taiwan", "Pakistan", "Afghanistan",
        "Lebanon", "Jordan", "Bahrain", "Kuwait", "Myanmar", "Philippines",
        "Ethiopia", "Eritrea", "South Sudan", "Mozambique", "Tanzania",
        "Congo", "Palestine",
    ]
    country_ids: dict = {}
    try:
        for c in key_countries:
            country_ids[c] = add_node("country", c)
        alliances = [
            ("United States", "Israel", "ally"), ("United States", "Saudi Arabia", "ally"),
            ("United States", "UAE", "ally"),     ("United States", "United Kingdom", "ally"),
            ("United States", "South Korea", "ally"),
            ("Russia", "Iran", "ally"),           ("Russia", "Syria", "ally"),
            ("China", "North Korea", "ally"),     ("China", "Russia", "partner"),
            ("Iran", "Syria", "ally"),            ("Iran", "Yemen", "proxy"),
            ("Saudi Arabia", "UAE", "ally"),      ("Turkey", "Qatar", "ally"),
            ("Ethiopia", "Eritrea", "tension"),   ("India", "Pakistan", "rival"),
            ("Israel", "Iran", "adversary"),      ("United States", "Russia", "adversary"),
            ("United States", "China", "rival"),  ("Ukraine", "Russia", "war"),
            ("Israel", "Lebanon", "tension"),
        ]
        for c1, c2, rel in alliances:
            if c1 in country_ids and c2 in country_ids:
                add_edge(country_ids[c1], country_ids[c2], rel)
        cp_country_map = {
            "Strait of Hormuz":  ["Iran", "Oman", "UAE"],
            "Bab el-Mandeb":     ["Yemen", "Djibouti", "Eritrea"],
            "Suez Canal":        ["Egypt"],
            "Taiwan Strait":     ["Taiwan", "China"],
            "Strait of Malacca": ["Myanmar", "Malaysia", "Indonesia"],
            "Bosphorus":         ["Turkey"],
            "Cape of Good Hope": ["South Africa"],
            "Mozambique Channel":["Mozambique", "Tanzania"],
            "Gibraltar Strait":  ["Spain", "Morocco"],
            "Kerch Strait":      ["Russia", "Ukraine"],
        }
        for cp_name, countries in cp_country_map.items():
            if cp_name in chokepoint_ids:
                for c in countries:
                    if c in country_ids:
                        add_edge(chokepoint_ids[cp_name], country_ids[c], "located_in")
        print(f"[ontology] {len(country_ids)} countries")
    except Exception as _e:
        print(f"[ontology] countries failed: {_e}")

    # ── Groups ───────────────────────────────────────────────────────────────
    group_ids: dict = {}
    try:
        groups = [
            ("IRGC",         "Iran",       "Islamic Revolutionary Guard Corps"),
            ("IRGC Navy",    "Iran",       "Fast attack craft — Strait of Hormuz"),
            ("Hezbollah",    "Lebanon",    "Iran-backed militia — Bekaa Valley HQ"),
            ("Houthi",       "Yemen",      "Ansar Allah — anti-ship missile capability"),
            ("Hamas",        "Palestine",  "Gaza-based militant group"),
            ("JNIM",         "Mali",       "Al-Qaeda affiliate — Sahel belt"),
            ("ISIS Sahel",   "Niger",      "Islamic State affiliate — Tri-border area"),
            ("Boko Haram",   "Nigeria",    "Islamist insurgency — Lake Chad basin"),
            ("Al-Shabaab",   "Somalia",    "Al-Qaeda affiliate — Horn of Africa"),
            ("RSF",          "Sudan",      "Rapid Support Forces — Hemedti"),
            ("SAF",          "Sudan",      "Sudanese Armed Forces — Burhan"),
            ("Wagner",       "Russia",     "PMC — Africa operations"),
            ("PLA Navy",     "China",      "People's Liberation Army Navy"),
            ("PLA Air Force","China",      "Strategic air and missile power"),
            ("M23",          "Congo",      "Rwanda-backed armed group — eastern DRC"),
        ]
        for name, country, desc in groups:
            nid = add_node("group", name, desc)
            group_ids[name] = nid
            if country in country_ids:
                add_edge(nid, country_ids[country], "operates")
        group_sponsors = [
            ("IRGC", "Hezbollah", "sponsors"), ("IRGC", "Houthi", "sponsors"),
            ("IRGC", "Hamas", "sponsors"),      ("Wagner", "RSF", "supports"),
            ("JNIM", "ISIS Sahel", "rivals"),
        ]
        for g1, g2, rel in group_sponsors:
            if g1 in group_ids and g2 in group_ids:
                add_edge(group_ids[g1], group_ids[g2], rel)
        group_threats = {
            "IRGC Navy": ["Strait of Hormuz"],
            "Houthi":    ["Bab el-Mandeb"],
            "PLA Navy":  ["Taiwan Strait", "South China Sea"],
        }
        for g, cp_names in group_threats.items():
            if g in group_ids:
                for cp_name in cp_names:
                    if cp_name in chokepoint_ids:
                        add_edge(group_ids[g], chokepoint_ids[cp_name], "threatens")
        print(f"[ontology] {len(group_ids)} groups")
    except Exception as _e:
        print(f"[ontology] groups failed: {_e}")

    # ── Key People ───────────────────────────────────────────────────────────
    try:
        people = [
            ("Ali Khamenei",          "Iran",        "Supreme Leader"),
            ("Vladimir Putin",        "Russia",      "President"),
            ("Xi Jinping",            "China",       "President / General Secretary"),
            ("Benjamin Netanyahu",    "Israel",      "Prime Minister"),
            ("Abdel Fattah al-Burhan","Sudan",       "SAF Commander / de facto President"),
            ("Hemedti",               "Sudan",       "RSF Commander"),
            ("Assimi Goita",          "Mali",        "Military leader / junta"),
            ("Kim Jong Un",           "North Korea", "Supreme Leader"),
            ("Volodymyr Zelenskyy",   "Ukraine",     "President"),
            ("Abdel Fattah el-Sisi",  "Egypt",       "President"),
            ("Recep Tayyip Erdogan",  "Turkey",      "President"),
        ]
        for name, country, desc in people:
            nid = add_node("person", name, desc)
            if country in country_ids:
                add_edge(nid, country_ids[country], "leads")
        print(f"[ontology] {len(people)} people")
    except Exception as _e:
        print(f"[ontology] people failed: {_e}")

    # ── Live AIS vessels (sample 25) ─────────────────────────────────────────
    try:
        with _AIS_LOCK:
            vessels_snap = list(_AIS_VESSELS.items())
        _random.shuffle(vessels_snap)
        vessel_count = 0
        for mmsi, raw in vessels_snap[:25]:
            v = _normalize_vessel(raw, mmsi)
            if v:
                add_node("vessel", v["name"],
                         f"MMSI:{v['mmsi']} | {v.get('ship_type','?')} | {v['speed']}kn | Flag:{v['flag']}",
                         v["lat"], v["lng"])
                vessel_count += 1
        print(f"[ontology] {vessel_count} vessels")
    except Exception as _e:
        print(f"[ontology] vessels failed: {_e}")

    # ── Live aircraft (sample 15) ────────────────────────────────────────────
    try:
        ac_list = list(_GLOBAL_ADSB_CACHE.items())
        _random.shuffle(ac_list)
        ac_count = 0
        for hex_id, ac in ac_list[:15]:
            if ac.get("lat") and ac.get("lon"):
                callsign = (ac.get("flight") or hex_id).strip()
                add_node("aircraft", callsign,
                         f"Alt:{ac.get('alt_baro','?')}ft | Squawk:{ac.get('squawk','')}",
                         float(ac["lat"]), float(ac["lon"]))
                ac_count += 1
        print(f"[ontology] {ac_count} aircraft")
    except Exception as _e:
        print(f"[ontology] aircraft failed: {_e}")

    # ── Recent news events (20) ──────────────────────────────────────────────
    try:
        ev_count = 0
        for ev in es.get_active_events()[:20]:
            ev_lat = ev.get("lat")
            ev_lng = ev.get("lng") or ev.get("lon")
            if ev_lat and ev_lng:
                nid = add_node("event", (ev.get("headline") or ev.get("title") or "")[:50],
                               f"Severity: {ev.get('severity','unknown')}",
                               ev_lat, ev_lng)
                ev_count += 1
                country = ev.get("country")
                if country and country in country_ids:
                    add_edge(nid, country_ids[country], "located_in")
                else:
                    body_text = ((ev.get("headline") or ev.get("title","")) + " " + (ev.get("summary",""))).lower()
                    for cname, cid in country_ids.items():
                        if cname.lower() in body_text:
                            add_edge(nid, cid, "located_in")
                            break
        print(f"[ontology] {ev_count} events")
    except Exception as _e:
        print(f"[ontology] events failed: {_e}")

    # ── Cables (all from DB OntologyEntity) ──────────────────────────────────
    try:
        import json as _jcbl
        from database import OntologyEntity as _OE, get_db as _gcbl
        with _gcbl() as _cdb:
            cable_ents = _cdb.query(_OE).filter(_OE.entity_type == "Submarine Cable").all()
        for ce in cable_ents:
            meta = {}
            try:
                meta = _jcbl.loads(ce.entity_metadata) if ce.entity_metadata else {}
            except Exception:
                pass
            desc = f"{ce.system_id} | {ce.region_id or '—'}"
            if meta.get("owners"):
                desc += f" | {str(meta['owners'])[:40]}"
            add_node("cable", ce.name, desc)
        print(f"[ontology] {len(cable_ents)} cables")
    except Exception as _e:
        print(f"[ontology] cables failed: {_e}")

    # ── Active detection rules (forge file + DB RuleConfig) ──────────────────
    try:
        rules = _forge_load("rules.json")
        if not rules:
            from detectors.default_rules import DEFAULT_RULES as _DR
            rules = _DR
        active_rules = [r for r in rules if r.get("status") == "active"]
        for rule in active_rules:
            nid = add_node("rule", rule["name"],
                           f"{rule.get('source','')} | {rule.get('trigger_type','')} | {rule.get('severity','')}")
            cp_name = (rule.get("params") or {}).get("chokepoint", "")
            if cp_name and cp_name in chokepoint_ids:
                add_edge(nid, chokepoint_ids[cp_name], "monitors")
        # Also add DB-backed RuleConfig rules
        db_rule_count = 0
        try:
            import json as _jrdb
            from database import RuleConfig as _RC, get_db as _grdb
            with _grdb() as _rdb:
                db_rules = _rdb.query(_RC).all()
            for r in db_rules:
                p = _jrdb.loads(r.params) if isinstance(r.params, str) else (r.params or {})
                status = "enabled" if r.enabled else "disabled"
                desc = f"DB | {status} | target={p.get('target','ALL')} | {p.get('infra_type','')}"
                add_node("rule", f"RULE-{r.id}: {r.rule_name}", desc)
                db_rule_count += 1
        except Exception as _rde:
            print(f"[ontology] db rules failed: {_rde}")
        print(f"[ontology] {len(active_rules)} forge rules, {db_rule_count} db rules")

        # Escalation chains
        chain_count = 0
        try:
            from database import EscalationChain as _ECb, get_db as _gecb
            with _gecb() as _ecbdb:
                _chains_b = _ecbdb.query(_ECb).all()
            for ch in _chains_b:
                desc = (
                    f"Escalates to {ch.escalated_severity} ({ch.escalated_icon_type})"
                    f" within {ch.time_window_minutes} min | rules {ch.rule_ids}"
                )
                add_node("escalation chain", ch.chain_name, desc)
                chain_count += 1
        except Exception as _ece:
            print(f"[ontology] escalation chains failed: {_ece}")
        print(f"[ontology] {chain_count} escalation chains")
    except Exception as _e:
        print(f"[ontology] rules failed: {_e}")

    # ── Recent alerts (10) ───────────────────────────────────────────────────
    try:
        for a in _forge_alerts[-10:]:
            add_node("alert", (a.get("message") or "")[:50],
                     f"{a.get('source','')} | {a.get('severity','')}",
                     a.get("lat"), a.get("lng"))
        print(f"[ontology] {min(10, len(_forge_alerts))} alerts")
    except Exception as _e:
        print(f"[ontology] alerts failed: {_e}")

    ontology = {
        "nodes":    nodes,
        "edges":    edges,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "stats":    {"nodes": len(nodes), "edges": len(edges)},
    }
    _forge_ontology_save(ontology)
    print(f"[ontology] BUILD COMPLETE: {len(nodes)} nodes, {len(edges)} edges")
    return {"status": "complete", "nodes": len(nodes), "edges": len(edges), "built_at": ontology["built_at"]}


@app.get("/api/forge/models")
def forge_get_models(_forge=Depends(_require_forge)):
    """Return real ML model info from disk + training data stats."""
    models = []
    backend_dir = Path(__file__).parent
    for fname in ("yolov8n-obb.onnx", "yolov8n.onnx"):
        fpath = backend_dir / fname
        if fpath.exists():
            size_mb = round(fpath.stat().st_size / (1024 * 1024), 1)
            models.append({
                "name":     fname,
                "type":     "Object Detection (DOTA OBB)" if "obb" in fname else "Object Detection (COCO)",
                "size_mb":  size_mb,
                "classes":  15 if "obb" in fname else 80,
                "status":   "active" if "obb" in fname else "standby",
            })

    labels = _forge_load("forge_labels.json")
    confirmed = sum(1 for l in labels if l.get("label") in ("confirm", "confirmed"))
    corrected  = sum(1 for l in labels if l.get("label") in ("correct",  "corrected"))
    return {
        "models": models,
        "training_data": {
            "total":              len(labels),
            "confirmed":          confirmed,
            "corrected":          corrected,
            "skipped":            len(labels) - confirmed - corrected,
            "ready_for_training": len(labels) >= 500,
        },
    }


@app.post("/api/forge/ontology/node")
async def forge_add_ontology_node(request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    ontology = _forge_ontology_load()
    nid = f"{body['type']}_{len(ontology['nodes'])+1}_{int(datetime.now(timezone.utc).timestamp())}"
    node = {
        "id":          nid,
        "type":        body["type"],
        "label":       body["label"],
        "description": body.get("description", ""),
        "lat":         body.get("lat"),
        "lng":         body.get("lng"),
        "manual":      True,
    }
    ontology["nodes"].append(node)
    _forge_ontology_save(ontology)
    return node


@app.delete("/api/forge/ontology/node/{node_id}")
async def forge_delete_ontology_node(node_id: str, _forge=Depends(_require_forge)):
    ontology = _forge_ontology_load()
    ontology["nodes"] = [n for n in ontology["nodes"] if n.get("id") != node_id]
    ontology["edges"] = [e for e in ontology["edges"] if e.get("source") != node_id and e.get("target") != node_id]
    _forge_ontology_save(ontology)
    return {"deleted": node_id}


@app.post("/api/forge/ontology/edge")
async def forge_add_ontology_edge(request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    ontology = _forge_ontology_load()
    new_edge = {
        "id":     f"e_manual_{len(ontology['edges'])}",
        "source": body["source"],
        "target": body["target"],
        "type":   body["type"],
        "manual": True,
    }
    ontology["edges"].append(new_edge)
    _forge_ontology_save(ontology)
    return new_edge


@app.delete("/api/forge/ontology/edge/{edge_id}")
def forge_delete_ontology_edge(edge_id: str, _forge=Depends(_require_forge)):
    ontology = _forge_ontology_load()
    ontology["edges"] = [e for e in ontology["edges"] if e.get("id") != edge_id]
    _forge_ontology_save(ontology)
    return {"deleted": edge_id}


_FORGE_ONTOLOGY_POS_FILE = _FORGE_DIR / "forge_ontology_positions.json"

@app.post("/api/forge/ontology/positions")
async def save_ontology_positions(request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    _FORGE_DIR.mkdir(parents=True, exist_ok=True)
    _FORGE_ONTOLOGY_POS_FILE.write_text(_json.dumps(body))
    return {"saved": True}

@app.get("/api/forge/ontology/positions")
def get_ontology_positions(_forge=Depends(_require_forge)):
    try:
        return _json.loads(_FORGE_ONTOLOGY_POS_FILE.read_text())
    except Exception:
        return {}


# ═══════════════════════════════════════════════════════════════════════════════
# FORGE MISSIONS
# ═══════════════════════════════════════════════════════════════════════════════

_FORGE_MISSION_FILE = "forge_missions.json"

_DEFAULT_MISSION = {
    "id": "mission_default",
    "name": "Global Monitoring",
    "description": "Full-spectrum global intelligence monitoring",
    "active": True,
    "created": "2026-01-01T00:00:00",
    "regions": [
        {"name": "Persian Gulf",    "bounds": [23, 48, 30, 60]},
        {"name": "Red Sea",         "bounds": [12, 32, 30, 45]},
        {"name": "East Med",        "bounds": [30, 25, 37, 36]},
        {"name": "Sahel",           "bounds": [10, -15, 20, 15]},
        {"name": "Horn of Africa",  "bounds": [-5, 35, 15, 55]},
        {"name": "South China Sea", "bounds": [5, 105, 25, 125]},
        {"name": "Black Sea",       "bounds": [40, 27, 47, 42]},
        {"name": "Baltic",          "bounds": [53, 10, 66, 30]},
    ],
    "data_sources": {
        "ais":       {"enabled": True,  "bboxes": "global"},
        "adsb":      {"enabled": True,  "regions": "global"},
        "news":      {"enabled": True,  "feeds": "all", "keywords": []},
        "satellite": {"enabled": True,  "watch_areas": []},
    },
    "rules": "all",
    "focus_entities": [],
}


@app.get("/api/forge/missions")
def forge_get_missions(_forge=Depends(_require_forge)):
    missions = _forge_load(_FORGE_MISSION_FILE)
    if not missions:
        missions = [_DEFAULT_MISSION]
        _forge_save(_FORGE_MISSION_FILE, missions)
    return missions


@app.post("/api/forge/missions")
async def forge_create_mission(request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    missions = _forge_load(_FORGE_MISSION_FILE)
    if not missions:
        missions = [_DEFAULT_MISSION]
    mission = {
        "id":             f"mission_{int(datetime.now(timezone.utc).timestamp())}",
        "name":           body.get("name", "Untitled Mission"),
        "description":    body.get("description", ""),
        "active":         False,
        "created":        datetime.now(timezone.utc).isoformat(),
        "regions":        body.get("regions", []),
        "data_sources":   body.get("data_sources", {}),
        "rules":          body.get("rules", "all"),
        "focus_entities": body.get("focus_entities", []),
    }
    missions.append(mission)
    _forge_save(_FORGE_MISSION_FILE, missions)
    return mission


# ── Pipeline persistence ───────────────────────────────────────────────────────

_FORGE_PIPELINE_FILE = _FORGE_DIR / "pipeline.json"


def _load_pipeline() -> dict:
    try:
        return _json.loads(_FORGE_PIPELINE_FILE.read_text())
    except Exception:
        return {}


def _save_pipeline(data: dict):
    _FORGE_DIR.mkdir(parents=True, exist_ok=True)
    _FORGE_PIPELINE_FILE.write_text(_json.dumps(data, indent=2, ensure_ascii=False))


@app.get("/api/forge/pipeline")
async def forge_get_pipeline(_forge=Depends(_require_forge)):
    data = _load_pipeline()
    if not data:
        return {"nodes": [], "edges": [], "status": "default"}
    return data


@app.post("/api/forge/pipeline/save")
async def forge_save_pipeline(request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    nodes = body.get("nodes", [])
    edges = body.get("edges", [])
    _save_pipeline({"nodes": nodes, "edges": edges, "saved_at": datetime.utcnow().isoformat()})
    await _apply_pipeline_changes({"nodes": nodes, "edges": edges})
    return {"saved": True}


@app.post("/api/forge/pipeline/delete-node")
async def forge_delete_pipeline_node(request: Request, _forge=Depends(_require_forge)):
    body    = await request.json()
    node_id = body.get("node_id", "")
    if node_id.startswith("det_"):
        src_map = {"det_ais": "AIS", "det_adsb": "ADSB", "det_news": "NEWS", "det_overwatch": "SATELLITE"}
        source  = src_map.get(node_id)
        if source:
            rules = _load_forge_rules()
            for r in rules:
                if r.get("source") == source:
                    r["status"] = "disabled_by_pipeline"
            _forge_save("rules.json", rules)
    return {"deleted": node_id}


@app.post("/api/forge/pipeline/delete-edge")
async def forge_delete_pipeline_edge(request: Request, _forge=Depends(_require_forge)):
    body = await request.json()
    print(f"[forge-pipeline] edge removed: {body.get('from')} → {body.get('to')}")
    return {"deleted": True}


@app.post("/api/forge/pipeline/toggle-node")
async def forge_toggle_pipeline_node(request: Request, _forge=Depends(_require_forge)):
    body       = await request.json()
    node_id    = body.get("node_id", "")
    new_status = body.get("status", "active")
    src_map    = {"det_ais": "AIS", "det_adsb": "ADSB", "det_news": "NEWS", "det_overwatch": "SATELLITE"}
    source     = src_map.get(node_id)
    if source:
        rules = _load_forge_rules()
        for r in rules:
            if r.get("source") == source:
                r["status"] = "active" if new_status == "active" else "paused"
        _forge_save("rules.json", rules)
    print(f"[forge-pipeline] {node_id} → {new_status}")
    return {"node_id": node_id, "status": new_status}


async def _apply_pipeline_changes(pipeline: dict):
    nodes  = pipeline.get("nodes", [])
    edges  = pipeline.get("edges", [])
    active_dets = {e["to"] for e in edges if e.get("to", "").startswith("det_")}
    src_map = {"det_ais": "AIS", "det_adsb": "ADSB", "det_news": "NEWS", "det_overwatch": "SATELLITE"}
    rules   = _load_forge_rules()
    changed = False
    for det_id, source in src_map.items():
        det_node  = next((n for n in nodes if n.get("id") == det_id), None)
        is_active = det_id in active_dets and det_node and det_node.get("status") == "active"
        for r in rules:
            if r.get("source") != source:
                continue
            if not is_active and r.get("status") == "active":
                r["status"] = "paused_by_pipeline"; changed = True
            elif is_active and r.get("status") == "paused_by_pipeline":
                r["status"] = "active"; changed = True
    if changed:
        _forge_save("rules.json", rules)


@app.put("/api/forge/missions/{mission_id}/activate")
def forge_activate_mission(mission_id: str, _forge=Depends(_require_forge)):
    missions = _forge_load(_FORGE_MISSION_FILE)
    if not missions:
        missions = [_DEFAULT_MISSION]
    for m in missions:
        m["active"] = (m["id"] == mission_id)
    _forge_save(_FORGE_MISSION_FILE, missions)
    return {"activated": mission_id}


# ── Strategic Zones API ───────────────────────────────────────────────────────

@app.get("/api/strategic-zones")
def api_list_strategic_zones(
    zone_type:         str | None = Query(None),
    severity_baseline: str | None = Query(None),
    is_baseline:       bool | None = Query(None),
    enabled_only:      bool        = Query(True),
):
    from database import StrategicZone, get_db
    from sqlalchemy import and_
    filters = []
    if enabled_only:
        filters.append(StrategicZone.enabled == True)
    if zone_type:
        filters.append(StrategicZone.zone_type == zone_type.upper())
    if severity_baseline:
        filters.append(StrategicZone.severity_baseline == severity_baseline.lower())
    if is_baseline is not None:
        filters.append(StrategicZone.is_baseline == is_baseline)
    with get_db() as db:
        rows = db.query(StrategicZone).filter(and_(*filters) if filters else True).all()
    return [_sz_to_dict(r) for r in rows]


@app.post("/api/strategic-zones", status_code=201)
def api_create_strategic_zone(body: dict):
    import uuid, datetime as _dt
    from database import StrategicZone, OntologyEntity, get_db
    coords = body.get("coordinates")
    if not coords or not isinstance(coords, list):
        raise HTTPException(status_code=400, detail="coordinates required (list of [lon,lat])")
    zone_id = body.get("zone_id") or f"SZONE-{uuid.uuid4().hex[:8].upper()}"
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)
    geojson = _json.dumps({"type": "Polygon", "coordinates": [coords]})
    zone = StrategicZone(
        zone_id           = zone_id,
        name              = body.get("name", "Unnamed Zone"),
        zone_type         = (body.get("zone_type") or "CUSTOM").upper(),
        severity_baseline = body.get("severity_baseline", "medium").lower(),
        polygon_geojson   = geojson,
        bbox_min_lon      = min_lon,
        bbox_min_lat      = min_lat,
        bbox_max_lon      = max_lon,
        bbox_max_lat      = max_lat,
        colour            = body.get("colour", "#FF9500"),
        description       = body.get("description"),
        is_baseline       = False,
        enabled           = True,
        created_at        = _dt.datetime.utcnow(),
        zone_metadata     = _json.dumps({"severity_baseline": body.get("severity_baseline", "medium"), "colour": body.get("colour", "#FF9500")}),
    )
    with get_db() as db:
        existing = db.query(StrategicZone).filter_by(zone_id=zone_id).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"zone_id '{zone_id}' already exists")
        db.add(zone)
        oe = db.query(OntologyEntity).filter_by(system_id=zone_id).first()
        meta = _json.dumps({"lat": (min_lat + max_lat) / 2, "lon": (min_lon + max_lon) / 2,
                            "severity_baseline": zone.severity_baseline, "colour": zone.colour,
                            "description": zone.description, "is_baseline": False})
        if oe:
            oe.name = zone.name; oe.infra_type = zone.zone_type; oe.entity_metadata = meta
        else:
            db.add(OntologyEntity(system_id=zone_id, entity_type="Strategic Zone",
                                  name=zone.name, infra_type=zone.zone_type, entity_metadata=meta))
        db.commit()
        return _sz_to_dict(db.query(StrategicZone).filter_by(zone_id=zone_id).first())


@app.put("/api/strategic-zones/{zone_id}")
def api_update_strategic_zone(zone_id: str, body: dict):
    import datetime as _dt
    from database import StrategicZone, OntologyEntity, get_db
    with get_db() as db:
        zone = db.query(StrategicZone).filter_by(zone_id=zone_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")
        if zone.is_baseline and body.get("coordinates"):
            raise HTTPException(status_code=403, detail="Cannot change polygon of baseline zones")
        if "name" in body:
            zone.name = body["name"]
        if "zone_type" in body:
            zone.zone_type = body["zone_type"].upper()
        if "severity_baseline" in body:
            zone.severity_baseline = body["severity_baseline"].lower()
        if "colour" in body:
            zone.colour = body["colour"]
        if "description" in body:
            zone.description = body["description"]
        if "enabled" in body:
            zone.enabled = bool(body["enabled"])
        if "coordinates" in body and not zone.is_baseline:
            coords = body["coordinates"]
            lons = [c[0] for c in coords]; lats = [c[1] for c in coords]
            zone.bbox_min_lon = min(lons); zone.bbox_max_lon = max(lons)
            zone.bbox_min_lat = min(lats); zone.bbox_max_lat = max(lats)
            zone.polygon_geojson = _json.dumps({"type": "Polygon", "coordinates": [coords]})
        zone.updated_at = _dt.datetime.utcnow()
        oe = db.query(OntologyEntity).filter_by(system_id=zone_id).first()
        if oe:
            oe.name = zone.name; oe.infra_type = zone.zone_type
            oe.entity_metadata = _json.dumps({
                "lat": (zone.bbox_min_lat + zone.bbox_max_lat) / 2,
                "lon": (zone.bbox_min_lon + zone.bbox_max_lon) / 2,
                "severity_baseline": zone.severity_baseline,
                "colour": zone.colour,
                "description": zone.description,
                "is_baseline": zone.is_baseline,
            })
        db.commit()
        return _sz_to_dict(db.query(StrategicZone).filter_by(zone_id=zone_id).first())


@app.delete("/api/strategic-zones/{zone_id}")
def api_delete_strategic_zone(zone_id: str):
    from database import StrategicZone, get_db
    with get_db() as db:
        zone = db.query(StrategicZone).filter_by(zone_id=zone_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")
        if zone.is_baseline:
            # Soft-delete: disable baseline zones instead of hard delete
            zone.enabled = False
            db.commit()
            return {"status": "disabled", "zone_id": zone_id}
        db.delete(zone)
        db.commit()
    return {"status": "deleted", "zone_id": zone_id}


@app.get("/api/strategic-zones/{zone_id}")
def api_get_strategic_zone(zone_id: str):
    from database import StrategicZone, get_db
    with get_db() as db:
        zone = db.query(StrategicZone).filter_by(zone_id=zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")
    return _sz_to_dict(zone)


@app.get("/api/strategic-zones/{zone_id}/signals")
def api_zone_signals(
    zone_id: str,
    limit: int = Query(50, ge=1, le=200),
):
    """AIS alerts, news assessments, and fusion events that overlap this zone's bounding box."""
    from database import StrategicZone, FusionEvent, get_db
    from sqlalchemy import or_
    with get_db() as db:
        zone = db.query(StrategicZone).filter_by(zone_id=zone_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")

        min_lat, max_lat = zone.bbox_min_lat, zone.bbox_max_lat
        min_lon, max_lon = zone.bbox_min_lon, zone.bbox_max_lon

        fusions = (
            db.query(FusionEvent)
            .filter(
                FusionEvent.lat.between(min_lat, max_lat),
                FusionEvent.lon.between(min_lon, max_lon),
            )
            .order_by(FusionEvent.created_at.desc())
            .limit(limit)
            .all()
        )
        fusion_hits = [
            {
                "signal_type": "fusion",
                "id": r.fusion_id,
                "title": r.title,
                "severity": r.severity,
                "lat": r.lat,
                "lon": r.lon,
                "location_name": r.location_name,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in fusions
        ]

        # News assessments
        assessment_hits = []
        try:
            from intelligence_schema import IntelligenceAssessment
            assessments = (
                db.query(IntelligenceAssessment)
                .filter(
                    IntelligenceAssessment.lat.between(min_lat, max_lat),
                    IntelligenceAssessment.lon.between(min_lon, max_lon),
                )
                .order_by(IntelligenceAssessment.created_at.desc())
                .limit(limit)
                .all()
            )
            assessment_hits = [
                {
                    "signal_type": "assessment",
                    "id": r.assessment_id,
                    "title": r.headline,
                    "severity": r.severity,
                    "lat": r.lat,
                    "lon": r.lon,
                    "location_name": r.location_name,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in assessments
            ]
        except Exception:
            pass

    # AIS/ADSB alerts from in-memory _forge_alerts
    alert_hits = []
    try:
        for a in _forge_alerts[-500:]:
            a_lat = a.get("lat"); a_lon = a.get("lng") or a.get("lon")
            if a_lat is None or a_lon is None:
                continue
            if min_lat <= a_lat <= max_lat and min_lon <= a_lon <= max_lon:
                alert_hits.append({
                    "signal_type": a.get("source", "alert").lower(),
                    "id": a.get("id"),
                    "title": a.get("title") or a.get("rule_name"),
                    "severity": a.get("severity"),
                    "lat": a_lat,
                    "lon": a_lon,
                    "created_at": a.get("timestamp"),
                })
    except Exception:
        pass

    all_signals = sorted(
        fusion_hits + assessment_hits + alert_hits,
        key=lambda x: x.get("created_at") or "",
        reverse=True,
    )
    return {
        "zone_id": zone_id,
        "signal_count": len(all_signals),
        "signals": all_signals[:limit],
    }


async def _fetch_zone_images_from_wikimedia(zone_id: str) -> list[str]:
    """Fetch up to 3 representative images from Wikimedia Commons for a strategic zone."""
    images: list[str] = []
    queries = _ZONE_SEARCH_QUERIES.get(zone_id, [])
    try:
        async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": "HorizonWatch/1.0"}) as client:
            for query in queries:
                if len(images) >= 3:
                    break
                try:
                    r = await client.get(
                        "https://commons.wikimedia.org/w/api.php",
                        params={
                            "action":       "query",
                            "generator":    "search",
                            "gsrnamespace": "6",
                            "gsrsearch":    query,
                            "gsrlimit":     "6",
                            "prop":         "imageinfo",
                            "iiprop":       "url|mime|size",
                            "iiurlwidth":   "800",
                            "format":       "json",
                        },
                    )
                    data = r.json()
                    pages = data.get("query", {}).get("pages", {})
                    for page in sorted(pages.values(), key=lambda p: p.get("index", 999)):
                        info_list = page.get("imageinfo", [])
                        if not info_list:
                            continue
                        info  = info_list[0]
                        mime  = info.get("mime", "")
                        url   = info.get("thumburl") or info.get("url", "")
                        width = info.get("thumbwidth") or info.get("width", 0) or 0
                        if url and ("image/jpeg" in mime or "image/png" in mime) and int(width) >= 400:
                            images.append(url)
                            if len(images) >= 3:
                                break
                except Exception as ex:
                    print(f"[zone-images] query '{query}' failed: {ex}")
    except Exception as ex:
        print(f"[zone-images] client error for {zone_id}: {ex}")
    print(f"[zone-images] {zone_id}: found {len(images)} images")
    return images[:3]


@app.get("/api/strategic-zones/{zone_id}/images")
async def api_zone_images(zone_id: str):
    """Return up to 3 image URLs for a zone; fetch from Wikimedia if not cached."""
    if zone_id in _zone_image_cache:
        return {"zone_id": zone_id, "images": _zone_image_cache[zone_id]}
    # Load from DB metadata
    from database import StrategicZone, get_db
    with get_db() as db:
        zone = db.query(StrategicZone).filter_by(zone_id=zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")
    try:
        meta   = _json.loads(zone.zone_metadata) if zone.zone_metadata else {}
        images = meta.get("images", [])
    except Exception:
        images = []
    if images:
        _zone_image_cache[zone_id] = images
        return {"zone_id": zone_id, "images": images}
    # Nothing stored — fetch from Wikimedia and persist
    images = await _fetch_zone_images_from_wikimedia(zone_id)
    _zone_image_cache[zone_id] = images
    try:
        with get_db() as db:
            z2 = db.query(StrategicZone).filter_by(zone_id=zone_id).first()
            if z2:
                meta2 = _json.loads(z2.zone_metadata) if z2.zone_metadata else {}
                meta2["images"] = images
                z2.zone_metadata = _json.dumps(meta2)
                db.commit()
    except Exception:
        pass
    return {"zone_id": zone_id, "images": images}


@app.post("/api/strategic-zones/{zone_id}/refresh-images")
async def api_refresh_zone_images(zone_id: str):
    """Force-refresh Wikimedia images for a zone and persist to metadata."""
    from database import StrategicZone, get_db
    images = await _fetch_zone_images_from_wikimedia(zone_id)
    _zone_image_cache[zone_id] = images
    try:
        with get_db() as db:
            zone = db.query(StrategicZone).filter_by(zone_id=zone_id).first()
            if zone:
                meta = _json.loads(zone.zone_metadata) if zone.zone_metadata else {}
                meta["images"] = images
                zone.zone_metadata = _json.dumps(meta)
                db.commit()
    except Exception:
        pass
    return {"zone_id": zone_id, "images": images}


# ── Drone Operator — HLS proxy, SSE, detection ingest, stream status ────────

# ── Drone Operator — SSE, detection ingest, stream status ──────────────────

_drone_sse_queues:        list = []
_drone_detections_latest: list = []


def _drone_sse_push(msg: dict) -> None:
    import json as _js
    data = _js.dumps(msg, default=str)
    for q in list(_drone_sse_queues):
        try:
            q.put_nowait(data)
        except Exception:
            pass


@app.get("/api/drone/events")
async def drone_sse_stream():
    """SSE stream — pushes drone_detections events to the browser."""
    import asyncio
    q: asyncio.Queue = asyncio.Queue()
    _drone_sse_queues.append(q)

    async def _gen():
        try:
            while True:
                data = await q.get()
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            try:
                _drone_sse_queues.remove(q)
            except ValueError:
                pass

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/drone/detections")
async def receive_drone_detections(body: dict):
    """Receive detections from drone_worker.py and push via SSE."""
    global _drone_detections_latest
    dets = body.get("detections", [])
    ts   = body.get("timestamp",   0)
    _drone_detections_latest = dets
    _drone_sse_push({
        "type":           "drone_detections",
        "detections":     dets,
        "timestamp":      ts,
        "total_in_frame": len(dets),
    })
    return {"received": len(dets)}


@app.get("/api/drone/detections/latest")
async def get_latest_drone_detections():
    return {"detections": _drone_detections_latest, "count": len(_drone_detections_latest)}


@app.get("/api/drone/stream/status")
async def drone_stream_status():
    """Check whether an nginx-rtmp HLS stream is active."""
    import httpx
    try:
        r = httpx.get("http://localhost:8080/stat", timeout=2)
        active = "horizon" in r.text
        return {
            "active":   active,
            "hls_url":  "http://localhost:8080/hls/horizon.m3u8",
            "rtmp_url": "rtmp://localhost:1935/live/horizon",
        }
    except Exception:
        return {"active": False}


def _sz_to_dict(z) -> dict:
    if z is None:
        return {}
    try:
        coords = _json.loads(z.polygon_geojson).get("coordinates", [[]])[0]
    except Exception:
        coords = []
    return {
        "zone_id":           z.zone_id,
        "name":              z.name,
        "zone_type":         z.zone_type,
        "severity_baseline": z.severity_baseline,
        "colour":            z.colour,
        "description":       z.description,
        "is_baseline":       z.is_baseline,
        "enabled":           z.enabled,
        "coordinates":       coords,
        "bbox":              [z.bbox_min_lon, z.bbox_min_lat, z.bbox_max_lon, z.bbox_max_lat],
        "lat":               (z.bbox_min_lat + z.bbox_max_lat) / 2,
        "lon":               (z.bbox_min_lon + z.bbox_max_lon) / 2,
        "images":            (_json.loads(z.zone_metadata) if z.zone_metadata else {}).get("images", []),
        "created_at":        z.created_at.isoformat() if z.created_at else None,
        "updated_at":        z.updated_at.isoformat() if z.updated_at else None,
    }
