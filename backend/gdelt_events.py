import asyncio
import csv
import gzip
import hashlib
import html as _html_module
import io
import json
import os
import re
import threading
import time
import urllib.parse
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

LAST15_URL_CANDIDATES = [
    "https://data.gdeltproject.org/gdeltv2/lastupdate.txt",
    "http://data.gdeltproject.org/gdeltv2/lastupdate.txt",
]
MASTERFILELIST_URL_CANDIDATES = [
    "https://data.gdeltproject.org/gdeltv2/masterfilelist.txt",
    "http://data.gdeltproject.org/gdeltv2/masterfilelist.txt",
]

TARGET_COUNTRY_CODES = {
    "TZ", "KE", "UG", "RW", "BI", "CD", "SO", "ET", "SS", "SD", "MZ", "ZM", "MW",
}
RECENT_FILES_TO_PULL = int(os.getenv("GDELT_RECENT_FILES_TO_PULL", "12"))
MAX_EVENTS_CACHE = int(os.getenv("GDELT_MAX_EVENTS_CACHE", "20000"))
MAX_EVENTS_RETURNED = int(os.getenv("GDELT_MAX_EVENTS_RETURNED", "5000"))

LIST_TIMEOUT_SECONDS = 20.0
FILE_TIMEOUT_SECONDS = 30.0
LIST_RETRY_BACKOFFS = (0.5, 1.0, 2.0)
_USER_AGENT = "AkiliDashboard/1.0 (gdelt-ingestor)"
_PERSIST_PATH = Path(__file__).resolve().parent / "data" / "gdelt_events_cache.json"

# ── GDELT relevance filter ─────────────────────────────────────────────────────
# Kinetic events: protest, force posture, coerce, assault, fight, mass violence.
KINETIC_ROOT_CODES: frozenset[str] = frozenset({"14", "15", "17", "18", "19", "20"})

# VERBAL CONFLICT — the half that used to be thrown away.
#
# This filter kept only the kinetic codes, so every statement, threat and
# rejection was discarded before it was ever stored. The consequence was
# concrete and observed: through September 2026 Western leaders shifted
# markedly in how they spoke about Russia, and this system could not have
# noticed, because CAMEO 11/12/13 never survived ingest.
#
# Rhetoric is the earliest signal there is. It precedes force posture, which
# precedes force. A system that only ingests violence can only ever report
# violence that has already happened.
#
#   10 Demand           11 Disapprove       12 Reject
#   13 Threaten         16 Reduce relations
VERBAL_ROOT_CODES: frozenset[str] = frozenset({"10", "11", "12", "13", "16"})

RELEVANT_ROOT_CODES: frozenset[str] = KINETIC_ROOT_CODES | VERBAL_ROOT_CODES
# NumSources CANNOT BE USED AS A CORROBORATION TEST IN THIS FEED, and the
# cost of assuming otherwise was that the map layer never drew a single
# pin. Measured against the live 15-minute export: NumSources is 1 for
# 66 of 66 kinetic rows, because each row is emitted from one source
# document — the field is structurally constant here, not a signal that
# happens to be low. Requiring 2 therefore rejected 100% of kinetic
# events, silently and permanently. The same mistake was found and fixed
# on the verbal path earlier and left standing on this one.
#
# NumMentions is the field that actually varies (1 to 10+ in the same
# file) and it is what corroboration is read from on both paths now.
# Kept env-overridable and defaulted to 1 so it is inert rather than
# removed, because an operator may still want it on a fuller archive.
GDELT_MIN_SOURCES   = int(os.getenv("GDELT_MIN_SOURCES", "1"))
# Speech is cheap, so a statement needs corroboration — but it has to be
# measured with the field that actually carries it. NumSources counts
# distinct documents WITHIN one 15-minute file and is 1 for roughly 87% of
# verbal rows (measured: 113 of 130 in a real file, maximum 3). Gating
# verbal events on sources therefore excluded every single one of them and
# the unfilter changed nothing. NumMentions is the field that varies, so
# that is what corroboration means here.
GDELT_VERBAL_MIN_SOURCES = int(os.getenv("GDELT_VERBAL_MIN_SOURCES", "1"))
GDELT_VERBAL_MIN_MENTIONS = int(os.getenv("GDELT_VERBAL_MIN_MENTIONS", "3"))
# The corroboration bar for kinetic events. Three mentions of one coded
# event is the difference between a story being carried and a single wire
# item; measured on the live file it keeps 30 of 66 kinetic rows, 21 of
# which are drawable as pins.
GDELT_MIN_MENTIONS  = int(os.getenv("GDELT_MIN_MENTIONS", "3"))
GDELT_GOLDSTEIN_NEG = -3.0     # conflictual threshold (below = relevant)
GDELT_GOLDSTEIN_POS = 7.0      # high-cooperation threshold (above = relevant)


def _bool_env(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


# Temporarily disabled by default to avoid empty output during validation.
APPLY_COUNTRY_FILTER = _bool_env("GDELT_APPLY_COUNTRY_FILTER", False)
GDELT_SSL_VERIFY = _bool_env("GDELT_SSL_VERIFY", False)

_CACHE_LOCK = threading.Lock()

# ── Headline cache (URL → fetched title; "" = tried but found nothing) ────────
_HEADLINE_CACHE: dict[str, str] = {}
_HEADLINE_CACHE_LOCK = threading.Lock()
_HEADLINE_SEMAPHORE = 10    # max concurrent article fetches per enrichment run
_HEADLINE_TIMEOUT   = 5.0   # seconds per URL

EVENTS_CACHE: dict[str, Any] = {
    "updated_at": None,
    "events": [],
    "source_files": [],
    "files_attempted": 0,
    "files_loaded": 0,
    "errors": [],
}

_DEBUG_STATE: dict[str, Any] = {
    "last_refresh_ok": False,
    "last_refresh_error": None,
    "last_source_mode": "none",
    "last_files_attempted": [],
    "last_files_loaded": [],
}

# GDELT EVENT export indexes.
# Newer exports commonly have 61 columns; older variants are shorter.
_IDX_GLOBALEVENTID = 0
_IDX_SQLDATE = 1
_IDX_ACTOR1_NAME = 6
_IDX_ACTOR1_COUNTRYCODE = 7
_IDX_ACTOR2_NAME = 16
_IDX_ACTOR2_COUNTRYCODE = 17
_IDX_EVENT_CODE = 26
_IDX_EVENT_BASE_CODE = 27
_IDX_EVENT_ROOT_CODE = 28  # QuadClass is at 29 — do NOT mix up
_IDX_GOLDSTEIN = 30
_IDX_NUM_MENTIONS = 31
# Real, standard GDELT 2.0 Event Export column (AvgTone) — the next real
# field after NumArticles(33) in GDELT's own documented fixed schema. Added
# for the real GDELT country risk index (Parallax translation step 1, Part
# 4) — previously never extracted at all despite being a real field in
# every real event row this app already downloads.
_IDX_AVGTONE = 34
_IDX_NUM_SOURCES = 32
_IDX_NUM_ARTICLES = 33
# ActionGeo_Type — HOW PRECISELY GDELT PLACED THIS EVENT.
#   1 = country centroid   2 = US state   3 = US city
#   4 = world city         5 = world state
# It was never captured, so nothing downstream could tell a city-level
# coordinate from a country centroid. That distinction is the whole
# difference between a usable pin and the "213 articles on the US centroid"
# failure that got the old news layer removed.
_IDX_ACTION_GEO_TYPE_NEW = 51
_IDX_ACTION_GEO_TYPE_OLD = 50

# Geo types precise enough to draw. A country or state centroid is not a
# place anything happened; it is the middle of a polygon.
PINNABLE_GEO_TYPES: frozenset[str] = frozenset({"3", "4"})

_IDX_ACTION_GEO_FULLNAME_NEW = 52
_IDX_ACTION_GEO_COUNTRYCODE_NEW = 53
_IDX_ACTION_GEO_LAT_NEW = 56
_IDX_ACTION_GEO_LON_NEW = 57
_IDX_SOURCE_URL_NEW = 60
_IDX_ACTION_GEO_FULLNAME_OLD = 51
_IDX_ACTION_GEO_COUNTRYCODE_OLD = 52
_IDX_ACTION_GEO_LAT_OLD = 54
_IDX_ACTION_GEO_LON_OLD = 55
_IDX_SOURCE_URL_OLD = 58


def _safe_int(value: str, default: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return default


def _safe_float(value: str, default: float | None = None) -> float | None:
    try:
        return float(value)
    except Exception:
        return default


def _as_iso_date(sql_date: str) -> str:
    raw = (sql_date or "").strip()
    if len(raw) != 8 or not raw.isdigit():
        return raw
    return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"


def get_event_label(root_code: str) -> str:
    mapping = {
        "01": "Public Statement",
        "02": "Appeal",
        "03": "Intent to Cooperate",
        "04": "Consult",
        "05": "Diplomatic Cooperation",
        "06": "Material Cooperation",
        "07": "Provide Aid",
        "08": "Yield",
        "09": "Investigate",
        "10": "Demand",
        "11": "Disapprove",
        "12": "Reject",
        "13": "Threaten",
        "14": "Protest",
        "15": "Exhibit Force",
        "16": "Reduce Relations",
        "17": "Coerce",
        "18": "Assault",
        "19": "Fight",
        "20": "Mass Violence",
    }
    key = (root_code or "").strip().zfill(2)
    return mapping.get(key, f"CAMEO {key or '?'}")


def build_event_summary(ev: dict[str, Any]) -> str:
    date_raw = str(ev.get("date") or ev.get("event_date") or "").strip()
    if len(date_raw) == 8 and date_raw.isdigit():
        date_text = f"{date_raw[:4]}-{date_raw[4:6]}-{date_raw[6:8]}"
    else:
        date_text = date_raw or "unknown date"

    location = str(ev.get("location") or ev.get("action_geo_full_name") or "").strip()
    country = str(ev.get("country_code") or ev.get("action_geo_country_code") or "").strip()
    if location and country and country not in location:
        place_text = f"{location} ({country})"
    else:
        place_text = location or country or "unknown location"

    event_type = str(ev.get("event_type") or ev.get("event_label") or "GDELT event").strip()
    root_code = str(ev.get("event_root_code") or "").strip().zfill(2) if ev.get("event_root_code") else ""

    actor1 = str(ev.get("actor1") or "").strip()
    actor2 = str(ev.get("actor2") or "").strip()
    if actor1 and actor2:
        actor_text = f"{actor1} and {actor2} were involved"
    elif actor1:
        actor_text = f"{actor1} was involved"
    elif actor2:
        actor_text = f"{actor2} was involved"
    else:
        actor_text = "unknown actors were involved"

    goldstein_raw = ev.get("goldstein")
    try:
        goldstein_text = f"{float(goldstein_raw):.1f}"
    except Exception:
        goldstein_text = "N/A"

    mentions = int(ev.get("mentions", ev.get("num_mentions", 0)) or 0)
    sources = int(ev.get("sources", ev.get("num_sources", 0)) or 0)
    articles = int(ev.get("articles", ev.get("num_articles", 0)) or 0)

    line1 = f"On {date_text} in {place_text}, {actor_text} in {event_type.lower()}."
    line2 = f"Event category: {event_type}{f' (root {root_code})' if root_code else ''}. Intensity (Goldstein): {goldstein_text}."
    line3 = f"Coverage: {mentions} mentions across {sources} sources / {articles} articles."
    return " ".join([line1, line2, line3])


def _first_field(row: list[str], *indices: int) -> str:
    for idx in indices:
        if 0 <= idx < len(row):
            val = row[idx]
            if val is not None:
                return val
    return ""


def _extract_url_from_line(line: str) -> str | None:
    for token in line.strip().split():
        if token.startswith("http://") or token.startswith("https://"):
            return token
    return None


def _is_event_export_url(url: str) -> bool:
    u = (url or "").strip().lower()
    if not u:
        return False
    if ".mentions." in u or ".gkg." in u or "translation" in u:
        return False
    return u.endswith(".export.csv.zip")


def _download_text_with_retries(url_candidates: list[str], timeout: float, label: str) -> tuple[str | None, str | None, str | None]:
    last_error = None
    for candidate in url_candidates:
        for idx, backoff in enumerate(LIST_RETRY_BACKOFFS, start=1):
            try:
                with httpx.Client(
                    timeout=timeout,
                    follow_redirects=True,
                    headers={"User-Agent": _USER_AGENT},
                    verify=GDELT_SSL_VERIFY,
                ) as client_h:
                    resp = client_h.get(candidate)
                    resp.raise_for_status()
                    return resp.text, candidate, None
            except Exception as ex:
                last_error = f"{label} {candidate} attempt={idx} failed: {type(ex).__name__}: {ex}"
                if idx < len(LIST_RETRY_BACKOFFS):
                    time.sleep(backoff)
    return None, None, last_error


def _download_bytes_with_retries(url: str, timeout: float = FILE_TIMEOUT_SECONDS) -> bytes | None:
    last_ex = None
    for idx, backoff in enumerate((0.5, 1.0, 2.0), start=1):
        try:
            with httpx.Client(
                timeout=timeout,
                follow_redirects=True,
                headers={"User-Agent": _USER_AGENT},
                verify=GDELT_SSL_VERIFY,
            ) as client_h:
                resp = client_h.get(url)
                resp.raise_for_status()
                return resp.content
        except Exception as ex:
            last_ex = ex
            if idx < 3:
                time.sleep(backoff)
    print(f"[gdelt] download failed {url}: {type(last_ex).__name__}: {last_ex}")
    return None


def _parse_lastupdate_text(text: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for line in text.splitlines():
        u = _extract_url_from_line(line)
        if not u or not _is_event_export_url(u) or u in seen:
            continue
        urls.append(u)
        seen.add(u)
    urls.sort(key=lambda x: Path(urllib.parse.urlparse(x).path).name, reverse=True)
    return urls


def _parse_masterfilelist_text(text: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for line in text.splitlines():
        parts = line.strip().split(maxsplit=2)
        if len(parts) < 3:
            continue
        u = parts[2].strip()
        if not _is_event_export_url(u) or u in seen:
            continue
        urls.append(u)
        seen.add(u)
    return urls


def fetch_gdelt_event_file_urls() -> tuple[list[str], str, str | None]:
    """
    Returns (urls, source_mode, error_message).
    source_mode: last15min | masterfilelist | none
    """
    txt, used_url, err = _download_text_with_retries(LAST15_URL_CANDIDATES, LIST_TIMEOUT_SECONDS, "lastupdate")
    if txt:
        urls = _parse_lastupdate_text(txt)
        if urls:
            return urls[: max(1, RECENT_FILES_TO_PULL)], "last15min", None
        err = "lastupdate parsed but contained no EVENT export URLs"
    elif err:
        print(f"[gdelt] {err}")

    txt, used_url, err2 = _download_text_with_retries(MASTERFILELIST_URL_CANDIDATES, LIST_TIMEOUT_SECONDS, "masterfilelist")
    if txt:
        all_urls = _parse_masterfilelist_text(txt)
        if all_urls:
            # masterfilelist is chronological; take newest tail
            selected = all_urls[-max(1, RECENT_FILES_TO_PULL):]
            selected.reverse()
            return selected, "masterfilelist", None
        err2 = "masterfilelist parsed but contained no EVENT export URLs"
    elif err2:
        print(f"[gdelt] {err2}")

    combined_err = " | ".join([e for e in [err, err2] if e]) or "unable to fetch GDELT file lists"
    return [], "none", combined_err


def _url_variants(url: str) -> list[str]:
    u = (url or "").strip()
    if not u:
        return []
    variants = [u]
    if u.startswith("http://"):
        variants.append("https://" + u[len("http://"):])
    return variants


def _collect_events_from_urls(
    urls: list[str],
    seen_keys: set[tuple[str, float, float]] | None = None,
) -> tuple[list[dict[str, Any]], list[str], list[str], set[tuple[str, float, float]]]:
    """
    Parse a URL set defensively:
    - try HTTPS variant when an HTTP URL fails
    - deduplicate by event_id + rounded coordinates
    """
    if seen_keys is None:
        seen_keys = set()

    collected: list[dict[str, Any]] = []
    loaded_urls: list[str] = []
    failed_urls: list[str] = []

    for original_url in urls:
        parsed_rows: list[dict[str, Any]] = []
        loaded_from = None

        for candidate_url in _url_variants(original_url):
            parsed_rows = download_and_parse_event_file(candidate_url)
            if parsed_rows:
                loaded_from = candidate_url
                break

        if loaded_from is None:
            failed_urls.append(original_url)
            continue

        loaded_urls.append(loaded_from)
        for ev in parsed_rows:
            # Relevance filter: root code + Goldstein + source/mention minimums
            if not _passes_filter(ev):
                continue

            cc = (ev.get("action_geo_country_code") or "").upper()
            if APPLY_COUNTRY_FILTER and cc and cc not in TARGET_COUNTRY_CODES:
                continue

            lat = _safe_float(str(ev.get("lat", "")))
            lon = _safe_float(str(ev.get("lon", "")))
            if lat is None or lon is None:
                continue

            key = (str(ev.get("event_id", "")), round(lat, 4), round(lon, 4))
            if key in seen_keys:
                continue
            seen_keys.add(key)
            collected.append(ev)

            if len(collected) >= MAX_EVENTS_CACHE:
                return collected, loaded_urls, failed_urls, seen_keys

    return collected, loaded_urls, failed_urls, seen_keys


def _iter_event_rows_from_payload(url: str, payload: bytes):
    lower = url.lower()
    if lower.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
            if not names:
                return
            with zf.open(names[0], "r") as fh:
                text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace", newline="")
                reader = csv.reader(text, delimiter="\t")
                for idx, row in enumerate(reader):
                    yield idx, row
        return

    if lower.endswith(".gz"):
        with gzip.GzipFile(fileobj=io.BytesIO(payload), mode="rb") as gz:
            text = io.TextIOWrapper(gz, encoding="utf-8", errors="replace", newline="")
            reader = csv.reader(text, delimiter="\t")
            for idx, row in enumerate(reader):
                yield idx, row
        return


def _normalize_row(row: list[str], source_url: str, row_index: int) -> dict[str, Any] | None:
    min_needed = min(_IDX_ACTION_GEO_LON_OLD, _IDX_ACTION_GEO_LON_NEW)
    if len(row) <= min_needed:
        return None

    lat_raw = _first_field(row, _IDX_ACTION_GEO_LAT_NEW, _IDX_ACTION_GEO_LAT_OLD)
    lon_raw = _first_field(row, _IDX_ACTION_GEO_LON_NEW, _IDX_ACTION_GEO_LON_OLD)
    lat = _safe_float(lat_raw)
    lon = _safe_float(lon_raw)
    if lat is None or lon is None:
        return None

    raw_event_id = str((row[_IDX_GLOBALEVENTID] or "").strip())
    if raw_event_id:
        event_id = raw_event_id
    else:
        seed = f"{source_url}|{row_index}|{row[_IDX_SQLDATE] if len(row) > _IDX_SQLDATE else ''}|{lat}|{lon}"
        event_id = hashlib.md5(seed.encode("utf-8")).hexdigest()[:24]

    sql_date_raw = (row[_IDX_SQLDATE] or "").strip()
    event_root_code = (row[_IDX_EVENT_ROOT_CODE] or "").strip()
    event_type = get_event_label(event_root_code)
    event_code = (row[_IDX_EVENT_CODE] or "").strip()
    event_base_code = (row[_IDX_EVENT_BASE_CODE] or "").strip()
    actor1 = (row[_IDX_ACTOR1_NAME] or "").strip()
    actor2 = (row[_IDX_ACTOR2_NAME] or "").strip()
    actor1_country = (row[_IDX_ACTOR1_COUNTRYCODE] or "").strip().upper()
    actor2_country = (row[_IDX_ACTOR2_COUNTRYCODE] or "").strip().upper()
    goldstein = _safe_float(row[_IDX_GOLDSTEIN], 0.0)
    avg_tone = _safe_float(row[_IDX_AVGTONE]) if len(row) > _IDX_AVGTONE else None
    mentions = _safe_int(row[_IDX_NUM_MENTIONS], 0)
    sources = _safe_int(row[_IDX_NUM_SOURCES], 0)
    articles = _safe_int(row[_IDX_NUM_ARTICLES], 0)
    action_geo_type = (_first_field(row, _IDX_ACTION_GEO_TYPE_NEW,
                                    _IDX_ACTION_GEO_TYPE_OLD) or "").strip()
    location = (_first_field(row, _IDX_ACTION_GEO_FULLNAME_NEW, _IDX_ACTION_GEO_FULLNAME_OLD) or "").strip()
    country_code = (_first_field(row, _IDX_ACTION_GEO_COUNTRYCODE_NEW, _IDX_ACTION_GEO_COUNTRYCODE_OLD) or "").strip().upper()
    source_article = (_first_field(row, _IDX_SOURCE_URL_NEW, _IDX_SOURCE_URL_OLD) or "").strip()

    # Clean actor names for frontend display (no all-caps CAMEO strings)
    actors_display = _describe_actors(actor1, actor2)

    iso_date = _as_iso_date(sql_date_raw)
    tier     = _severity_tier_gdelt(goldstein or 0.0)

    base_event = {
        "id": event_id,
        "date": sql_date_raw,
        "actor1": actor1,
        "actor2": actor2,
        "actor1_country": actor1_country,
        "actor2_country": actor2_country,
        "event_code": event_code,
        "event_base_code": event_base_code,
        "event_root_code": event_root_code,
        "event_type": event_type,
        "goldstein": goldstein,
        "avg_tone": avg_tone,  # real GDELT AvgTone — None (never fabricated) when absent from a real row
        "mentions": mentions,
        "sources": sources,
        "articles": articles,
        "location": location,
        "country_code": country_code,
        "lat": float(lat),
        "lon": float(lon),
        "source_url": source_article,
        "dataset": "GDELT",
        # ── Frontend-facing display fields ──────────────────────────────
        "location_name":   location,
        "goldstein_score": goldstein,
        "severity_tier":   tier,
        "actors":          actors_display,
    }
    fallback = _readable_fallback(base_event)
    base_event["summary"]  = fallback
    base_event["headline"] = fallback   # overwritten by enrichment if fetch succeeds
    # Whether the headline is the ARTICLE'S OWN TITLE or a sentence this
    # module generated from CAMEO codes. Length cannot tell them apart —
    # "Armed clashes reported involving Police and Cartel in Sydney" is
    # generated, reads like a headline and clears every readability test,
    # which is precisely how a map fills with pins that assert something
    # happened without any journalist having said so. Tracked as a fact
    # rather than guessed at.
    base_event["headline_is_article"] = False

    return {
        # Normalized frontend-facing fields
        **base_event,

        # Backward-compatible aliases used across current code paths
        "event_id":   event_id,
        "event_date": iso_date,
        "event_label":  event_type,
        "actor":        actors_display or " vs ".join([a for a in [actor1, actor2] if a]) or "Unknown",
        "num_mentions": mentions,
        "num_sources":  sources,
        "num_articles": articles,
        "action_geo_type": action_geo_type,
        # Whether this event may be drawn as a point at all. Verbal events
        # are excluded regardless of geo type: GDELT places them at a
        # location NAMED IN THE ARTICLE, so "Guterres disapproves of the US"
        # was placed in Tehran because the piece was about Iran. That is not
        # a location, it is a coincidence of vocabulary.
        "pinnable": (action_geo_type in PINNABLE_GEO_TYPES
                     and event_root_code not in VERBAL_ROOT_CODES),
        "action_geo_country_code": country_code,
        "action_geo_full_name":    location,
    }


def download_and_parse_event_file(url: str) -> list[dict[str, Any]]:
    """
    Download a GDELT EVENT export file and return normalized event dicts.
    """
    events: list[dict[str, Any]] = []
    payload = _download_bytes_with_retries(url, timeout=FILE_TIMEOUT_SECONDS)
    if payload is None:
        return events

    try:
        for row_index, row in _iter_event_rows_from_payload(url, payload) or []:
            ev = _normalize_row(row, url, row_index)
            if ev is not None:
                events.append(ev)
    except Exception as ex:
        print(f"[gdelt] parse failed {url}: {type(ex).__name__}: {ex}")
    return events


def _persist_cache() -> None:
    try:
        _PERSIST_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _CACHE_LOCK:
            data = {
                "updated_at": EVENTS_CACHE.get("updated_at"),
                "events": EVENTS_CACHE.get("events", [])[:MAX_EVENTS_CACHE],
                "source_files": EVENTS_CACHE.get("source_files", []),
            }
        with _PERSIST_PATH.open("w", encoding="utf-8") as fh:
            json.dump(data, fh)
    except Exception as ex:
        print(f"[gdelt] persist failed: {type(ex).__name__}: {ex}")


def _load_persisted_cache() -> None:
    if not _PERSIST_PATH.exists():
        return
    try:
        with _PERSIST_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return
        events = data.get("events", [])
        if not isinstance(events, list):
            events = []
        with _CACHE_LOCK:
            EVENTS_CACHE["updated_at"] = data.get("updated_at")
            EVENTS_CACHE["events"] = events[:MAX_EVENTS_CACHE]
            EVENTS_CACHE["source_files"] = data.get("source_files", [])
    except Exception as ex:
        print(f"[gdelt] load persisted cache failed: {type(ex).__name__}: {ex}")


# ── Event filtering ───────────────────────────────────────────────────────────

def _passes_filter(ev: dict[str, Any]) -> bool:
    """Return True only for high-signal events worth surfacing to the frontend."""
    root = str(ev.get("event_root_code") or "").strip().zfill(2)
    if root not in RELEVANT_ROOT_CODES:
        return False

    g = float(ev.get("goldstein") if ev.get("goldstein") is not None else 0.0)
    if root in VERBAL_ROOT_CODES:
        # The Goldstein magnitude test cannot be applied to speech. CAMEO
        # scores rhetoric gently by design — "Disapprove" is -2.0, well
        # inside the -3.0 conflictual threshold — so admitting the verbal
        # codes while keeping that test would have changed nothing. What
        # makes a statement matter is not its score but the fact that it
        # departs from how these two actors normally speak, and that is a
        # question about a trend, not about one event. Noise is controlled
        # by the corroboration minimums below instead.
        pass
    elif not (g < GDELT_GOLDSTEIN_NEG or g > GDELT_GOLDSTEIN_POS):
        return False
    min_sources = GDELT_VERBAL_MIN_SOURCES if root in VERBAL_ROOT_CODES else GDELT_MIN_SOURCES
    if int(ev.get("sources") or ev.get("num_sources") or 0) < min_sources:
        return False
    min_mentions = (GDELT_VERBAL_MIN_MENTIONS if root in VERBAL_ROOT_CODES
                    else GDELT_MIN_MENTIONS)
    if int(ev.get("mentions") or ev.get("num_mentions") or 0) < min_mentions:
        return False
    return True


# ── What a map pin must be able to say ────────────────────────────────────
#
# A GDELT event becomes a pin only if it can present three things: a real
# TITLE a person can read, a LOCATION precise enough to mean something, and
# a SOURCE they can check. Anything short of that is a coloured dot asserting
# that a machine believes something happened near here, which is how the
# previous news layer lost the reader's trust.

# A URL that is a tag, category, index or search page is not an article. It
# cannot be cited as the source of one event, because it is a rotating list.
_NON_ARTICLE_URL_MARKERS = ("/tag/", "/tags/", "/category/", "/categories/",
                            "/search", "/index?", "?more=", "/topics/",
                            "/author/", "/rss", "/feed")

# Below this a "headline" is a fragment, not a sentence. Measured: real
# article titles in this feed run 40-90 characters.
MIN_HEADLINE_CHARS = 28


def is_article_url(url: str) -> bool:
    u = (url or "").strip().lower()
    if not u.startswith("http"):
        return False
    return not any(m in u for m in _NON_ARTICLE_URL_MARKERS)


def has_readable_title(headline: str) -> bool:
    h = (headline or "").strip()
    if len(h) < MIN_HEADLINE_CHARS:
        return False
    # A title that is one unbroken token is a slug or an error page.
    return len(h.split()) >= 4


def map_point(ev: dict) -> dict | None:
    """The pin, or nothing.

    Returns a flat record shaped for the map — title, context, location,
    source — or None when this event cannot honestly be drawn. Returning
    None rather than a degraded pin is the point: a map is read at a glance
    and a weak pin is indistinguishable from a strong one.
    """
    if not ev.get("pinnable"):
        return None
    if not is_article_url(ev.get("source_url")):
        return None
    # A pin must quote a journalist, not this module. An event whose
    # headline fetch failed still has a perfectly readable generated
    # sentence, and drawing it would put a machine's paraphrase on the map
    # in the voice of a news report.
    if not ev.get("headline_is_article"):
        return None
    title = (ev.get("headline") or "").strip()
    if not has_readable_title(title):
        return None
    lat, lon = ev.get("lat"), ev.get("lon")
    if lat is None or lon is None:
        return None

    # The context line says what KIND of event GDELT coded and how strongly,
    # in words rather than a CAMEO number, so the reader is never asked to
    # know the codebook.
    actors = " → ".join([a for a in (ev.get("actor1"), ev.get("actor2")) if a])
    bits = [b for b in (ev.get("event_type"), actors) if b]
    if ev.get("mentions"):
        bits.append(f"{ev['mentions']} mentions")

    return {
        "id": ev.get("id") or ev.get("event_id"),
        "source": "GDELT",
        "title": title,
        "context": " · ".join(bits),
        "location_name": ev.get("location") or ev.get("location_name") or "",
        "lat": lat, "lon": lon,
        "date": ev.get("event_date") or ev.get("date"),
        "source_url": ev.get("source_url"),
        "event_type": ev.get("event_type"),
        "goldstein": ev.get("goldstein"),
        "tone": ev.get("avg_tone"),
        "mentions": ev.get("mentions"),
        # Said plainly so the map can render it differently from a
        # GeoConfirmed square: this is a machine reading a wire story, not a
        # human who found the building in the video.
        "confidence": "machine-coded",
        "geo_precision": "city",
    }


def map_points(events: list) -> list:
    """Every event that can honestly be drawn, one pin per story per place.

    GDELT codes one article into several events — a single report of a
    shooting yields "Fight" and "Coerce" at identical coordinates, which
    would stack two pins on one spot and read as two incidents. They are
    one story, so they become one pin that names both codings.
    """
    best: dict = {}
    for ev in events or []:
        p = map_point(ev)
        if p is None:
            continue
        # Same article, same place — the same event seen twice by the coder.
        key = (p["source_url"], round(p["lat"], 3), round(p["lon"], 3))
        prev = best.get(key)
        if prev is None:
            p["event_types"] = [p["event_type"]] if p["event_type"] else []
            best[key] = p
            continue
        if p["event_type"] and p["event_type"] not in prev["event_types"]:
            prev["event_types"].append(p["event_type"])
        # Keep the most conflictual coding as the headline interpretation:
        # "Fight" is the fact, "Coerce" is the framing.
        if (p.get("goldstein") or 0) < (prev.get("goldstein") or 0):
            prev["event_type"] = p["event_type"]
            prev["goldstein"] = p["goldstein"]
        prev["mentions"] = max(prev.get("mentions") or 0, p.get("mentions") or 0)

    out = []
    for p in best.values():
        types = [t for t in p.get("event_types", []) if t]
        actors = p["context"].split(" · ")[1] if " · " in p["context"] else ""
        bits = [" / ".join(types) if types else p.get("event_type") or ""]
        if actors and actors != p.get("event_type"):
            bits.append(actors)
        if p.get("mentions"):
            bits.append(f"{p['mentions']} mentions")
        p["context"] = " · ".join([b for b in bits if b])
        out.append(p)
    return out


# ── Actor name cleaning ───────────────────────────────────────────────────────

# GDELT actors are all-caps noun phrases (e.g. "WEST BANK", "MILITARY",
# "GOVERNMENT").  Clean them into readable title-cased strings.
_ACTOR_SKIP = frozenset({
    "UNKNOWN", "", "N/A", "-",
})

def _clean_actor(name: str) -> str:
    """Convert a GDELT actor string to plain English or return empty string."""
    if not name:
        return ""
    # Strip inline type/country annotations like "MILITARY (TZA)" or arrows
    name = re.sub(r'\s*\([^)]{1,6}\)\s*', ' ', name)  # "(TZA)" etc.
    name = re.sub(r'->.*$', '', name)                   # "FOO->BAR"
    name = name.strip()
    if name.upper() in _ACTOR_SKIP or len(name) <= 2:
        return ""
    # All-caps → Title Case
    if name == name.upper():
        return name.title()
    return name


def _describe_actors(actor1: str, actor2: str) -> str:
    """Return a plain-English actor description, or empty string if none usable."""
    a1 = _clean_actor(actor1)
    a2 = _clean_actor(actor2)
    if a1 and a2 and a1.lower() != a2.lower():
        return f"{a1} and {a2}"
    return a1 or a2


# ── Severity tier from Goldstein scale ────────────────────────────────────────

def _severity_tier_gdelt(goldstein: float) -> str:
    if goldstein <= -7:
        return "critical"
    if goldstein <= -5:
        return "significant"
    if goldstein < -3:
        return "elevated"
    return "low"   # catches > +7 (high cooperation, rare with root codes 14-20)


# ── Headline enrichment ───────────────────────────────────────────────────────

# Root-code-specific plain-English fallback phrases.
# Used when headline fetch fails — never shows raw CAMEO labels.
_ROOT_PHRASE: dict[str, str] = {
    "14": "Protest reported",
    "15": "Show of force reported",
    "17": "Coercive action reported",
    "18": "Armed assault reported",
    "19": "Armed clashes reported",
    "20": "Mass violence reported",
}

def _readable_fallback(ev: dict[str, Any]) -> str:
    """
    Clean plain-English description from root code + actors + location.
    Never shows raw CAMEO codes, all-caps actor strings, or Goldstein values.
    """
    root     = str(ev.get("event_root_code") or "").strip().zfill(2)
    phrase   = _ROOT_PHRASE.get(root, "Incident reported")
    location = (ev.get("location") or ev.get("action_geo_full_name") or "").strip()
    actors   = _describe_actors(
        ev.get("actor1") or "",
        ev.get("actor2") or "",
    )

    parts: list[str] = [phrase]
    if actors:
        parts.append(f"involving {actors}")
    if location:
        parts.append(f"in {location}")

    date = (ev.get("event_date") or ev.get("date") or "").strip()
    if len(date) == 8 and date.isdigit():
        date = f"{date[:4]}-{date[4:6]}-{date[6:8]}"
    if date:
        parts.append(f"({date})")

    return " ".join(parts)


def _clean_html_title(raw: str) -> str:
    """Unescape HTML entities and strip trailing site-name suffixes."""
    title = _html_module.unescape(raw).strip()
    # Strip a trailing " - Site Name" / " | Site Name" / " — Site Name".
    #
    # The separator must have WHITESPACE BEFORE IT. Without that requirement
    # any hyphenated word near the end of a headline was treated as a site
    # name and everything after it discarded:
    #
    #   "Mecca Alliance will be 'game-changer' for regional security"
    #     -> "Mecca Alliance will be 'game"
    #
    # 10 of 47 cached headlines were truncated this way, several mid-word.
    # A headline is the whole reason a map pin is readable, so a title that
    # stops mid-sentence is worse than showing the raw one.
    title = re.sub(r'\s+[|\u2013\u2014-]\s*[^|\u2013\u2014]{3,60}$', '', title).strip()
    return title


async def _fetch_one_headline(url: str, sem: asyncio.Semaphore) -> tuple[str, str]:
    """Fetch a single article URL and return (url, headline). Returns "" on any failure."""
    if not url or not url.startswith("http"):
        return url, ""

    async with sem:
        try:
            async with httpx.AsyncClient(
                timeout=_HEADLINE_TIMEOUT,
                follow_redirects=True,
                headers={"User-Agent": _USER_AGENT, "Accept-Language": "en"},
                verify=GDELT_SSL_VERIFY,
            ) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                html_text = resp.text[:65536]   # cap at 64 KB — title is always near the top
        except Exception:
            return url, ""

    # og:title — two possible attribute orderings
    m = re.search(
        r'<meta\b[^>]+\bproperty=["\']og:title["\'][^>]+\bcontent=["\']([^"\']{3,250})["\']',
        html_text, re.I,
    ) or re.search(
        r'<meta\b[^>]+\bcontent=["\']([^"\']{3,250})["\'][^>]+\bproperty=["\']og:title["\']',
        html_text, re.I,
    )
    if m:
        title = _clean_html_title(m.group(1))
        if title:
            return url, title

    # <title> tag fallback
    m = re.search(r'<title[^>]*>\s*([^<]{3,250}?)\s*</title>', html_text, re.I | re.S)
    if m:
        title = _clean_html_title(m.group(1))
        if title:
            return url, title

    return url, ""


async def _enrich_with_headlines(events: list[dict[str, Any]]) -> None:
    """
    Fetch real article headlines for events that have a source_url.
    - Results cached by URL across cycles (_HEADLINE_CACHE).
    - At most _HEADLINE_SEMAPHORE concurrent HTTP requests at once.
    - On any failure the existing summary (readable fallback) is kept.
    """
    # Group events by URL
    url_to_events: dict[str, list[dict[str, Any]]] = {}
    for ev in events:
        url = (ev.get("source_url") or "").strip()
        if url:
            url_to_events.setdefault(url, []).append(ev)

    urls_needed: list[str] = []
    with _HEADLINE_CACHE_LOCK:
        for url, evs in url_to_events.items():
            cached = _HEADLINE_CACHE.get(url)
            if cached is not None:              # already fetched (possibly empty string)
                if cached:
                    for ev in evs:
                        ev["summary"]  = cached
                        ev["headline"] = cached
                        ev["headline_is_article"] = True
            else:
                urls_needed.append(url)

    if not urls_needed:
        return

    sem = asyncio.Semaphore(_HEADLINE_SEMAPHORE)
    results = await asyncio.gather(
        *[_fetch_one_headline(url, sem) for url in urls_needed],
        return_exceptions=True,
    )

    fetched = 0
    with _HEADLINE_CACHE_LOCK:
        for result in results:
            if isinstance(result, Exception):
                continue
            url, headline = result
            _HEADLINE_CACHE[url] = headline         # cache "" for misses to avoid retrying
            if headline:
                fetched += 1
                for ev in url_to_events.get(url, []):
                    ev["summary"]  = headline
                    ev["headline"] = headline
                    ev["headline_is_article"] = True

    total = len(urls_needed)
    print(f"[gdelt] headline enrichment: fetched {fetched}/{total} new URLs "
          f"(cache size={len(_HEADLINE_CACHE)})")


def refresh_cache() -> dict[str, Any]:
    urls, source_mode, list_err = fetch_gdelt_event_file_urls()
    recent_urls = urls[: max(1, RECENT_FILES_TO_PULL)]
    source_mode_effective = source_mode

    if not recent_urls:
        with _CACHE_LOCK:
            _DEBUG_STATE["last_refresh_ok"] = False
            _DEBUG_STATE["last_refresh_error"] = list_err or "no candidate event files"
            _DEBUG_STATE["last_source_mode"] = source_mode_effective
            _DEBUG_STATE["last_files_attempted"] = []
            _DEBUG_STATE["last_files_loaded"] = []
        print(f"[gdelt] no file URLs available: {_DEBUG_STATE['last_refresh_error']}")
        return get_cached_events(MAX_EVENTS_RETURNED)

    seen_keys: set[tuple[str, float, float]] = set()
    filtered_events, loaded_urls, parse_errors, seen_keys = _collect_events_from_urls(
        recent_urls,
        seen_keys=seen_keys,
    )

    # If lastupdate list yielded no usable events, retry with masterfilelist recent exports.
    if not filtered_events and source_mode == "last15min":
        master_txt, _, master_err = _download_text_with_retries(
            MASTERFILELIST_URL_CANDIDATES,
            LIST_TIMEOUT_SECONDS,
            "masterfilelist-fallback",
        )
        if master_txt:
            master_urls = _parse_masterfilelist_text(master_txt)
            fallback_urls = master_urls[-max(1, RECENT_FILES_TO_PULL):]
            fallback_urls.reverse()
            if fallback_urls:
                fallback_events, fallback_loaded, fallback_errors, seen_keys = _collect_events_from_urls(
                    fallback_urls,
                    seen_keys=seen_keys,
                )
                if fallback_events:
                    filtered_events = fallback_events
                    loaded_urls = fallback_loaded
                    parse_errors.extend(fallback_errors)
                    recent_urls = fallback_urls
                    source_mode_effective = "masterfilelist"
        elif master_err:
            parse_errors.append(f"master_fallback_error:{master_err}")

    filtered_events.sort(
        key=lambda e: (
            str(e.get("event_date", "")),
            _safe_int(str(e.get("num_mentions", 0))),
            _safe_int(str(e.get("num_articles", 0))),
        ),
        reverse=True,
    )

    # Enrich summaries with real article headlines.
    # Uses a fresh event loop per call (safe from any thread, no interference
    # with uvicorn's event loop which lives on a different thread).
    if filtered_events:
        try:
            loop = asyncio.new_event_loop()
            loop.run_until_complete(_enrich_with_headlines(filtered_events))
        except Exception as ex:
            print(f"[gdelt] headline enrichment error: {type(ex).__name__}: {ex}")
        finally:
            try:
                loop.close()
            except Exception:
                pass

    refresh_error = None
    refresh_ok = len(filtered_events) > 0
    if not refresh_ok:
        refresh_error = list_err or "parsed files but produced zero geolocated events"

    with _CACHE_LOCK:
        EVENTS_CACHE["updated_at"] = datetime.now(timezone.utc).isoformat()
        EVENTS_CACHE["events"] = filtered_events[:MAX_EVENTS_CACHE]
        EVENTS_CACHE["source_files"] = recent_urls
        EVENTS_CACHE["files_attempted"] = len(recent_urls)
        EVENTS_CACHE["files_loaded"] = len(loaded_urls)
        EVENTS_CACHE["errors"] = parse_errors[:30]

        _DEBUG_STATE["last_refresh_ok"] = refresh_ok
        _DEBUG_STATE["last_refresh_error"] = refresh_error
        _DEBUG_STATE["last_source_mode"] = source_mode_effective
        _DEBUG_STATE["last_files_attempted"] = recent_urls[:10]
        _DEBUG_STATE["last_files_loaded"] = loaded_urls[:10]

    _persist_cache()
    print(
        f"[gdelt] refreshed mode={source_mode_effective} files_attempted={len(recent_urls)} "
        f"files_loaded={len(loaded_urls)} events={len(filtered_events)} "
        f"country_filter={'on' if APPLY_COUNTRY_FILTER else 'off'} errors={len(parse_errors)}"
    )
    return get_cached_events(MAX_EVENTS_RETURNED)


def get_cached_events(limit: int = MAX_EVENTS_RETURNED) -> dict[str, Any]:
    with _CACHE_LOCK:
        events = EVENTS_CACHE.get("events", [])
        return {
            "updated_at": EVENTS_CACHE.get("updated_at"),
            "events": list(events[: max(1, limit)]),
            "total_cached": len(events),
            "source_files": list(EVENTS_CACHE.get("source_files", [])),
            "files_attempted": EVENTS_CACHE.get("files_attempted", 0),
            "files_loaded": EVENTS_CACHE.get("files_loaded", 0),
            "errors": list(EVENTS_CACHE.get("errors", [])),
        }


def get_debug_status() -> dict[str, Any]:
    with _CACHE_LOCK:
        return {
            "cache_updated_at": EVENTS_CACHE.get("updated_at"),
            "cache_event_count": len(EVENTS_CACHE.get("events", [])),
            "last_refresh_ok": bool(_DEBUG_STATE.get("last_refresh_ok", False)),
            "last_refresh_error": _DEBUG_STATE.get("last_refresh_error"),
            "last_source_mode": _DEBUG_STATE.get("last_source_mode", "none"),
            "last_files_attempted": list(_DEBUG_STATE.get("last_files_attempted", []))[:10],
            "last_files_loaded": list(_DEBUG_STATE.get("last_files_loaded", []))[:10],
        }


_load_persisted_cache()
