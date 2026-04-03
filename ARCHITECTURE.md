# Horizon Watch — Architecture Reference

> Generated 2026-04-03 via comprehensive codebase audit (read-only, no files modified).

---

## 1. Project Overview

**Horizon Watch** (internal codename "Akili") is a full-stack geopolitical intelligence platform built for real-time situational awareness. It aggregates live ADS-B aircraft tracks, AIS vessel positions, RSS news feeds (50+ sources), earthquake alerts, disaster data, and satellite imagery onto an interactive Leaflet map, then uses Claude to enrich flagged events and generate daily intelligence briefings.

**Primary use case:** Security analysts and field operators monitoring East Africa, the Middle East, and other conflict-adjacent regions need a single pane of glass across air, sea, infrastructure, and news layers.

**Tech stack summary:**

| Layer | Stack |
|---|---|
| Frontend | React 18 + React-Leaflet 4 + Leaflet 1.9 + Vite 5 |
| Backend | FastAPI (Python) + SQLite + SQLAlchemy |
| AI | Anthropic Claude Sonnet (`claude-sonnet-4-20250514`) |
| ADS-B | adsb.lol API |
| AIS | aisstream.io WebSocket |
| Satellite | Copernicus/Sentinel-2 (OAuth2) |
| Deployment | Railway (backend) + Vercel (frontend) |

---

## 2. Directory Structure

```
NAGINI 2.0/
├── backend/
│   ├── main.py                    # 7500+ line monolith — all HTTP + WS handlers
│   ├── database.py                # SQLite schema: users, direct_messages
│   ├── app_shared.py              # JWT helpers, FastAPI auth dependencies
│   ├── event_store.py             # Unified in-memory event store (GDELT+RSS+USGS)
│   ├── event_bridge.py            # Bridge: news store → event_store ingest loop
│   ├── scoring.py                 # Significance scoring, GDELT weighting, region bboxes
│   ├── classifier.py              # Event type classification (keyword-based)
│   ├── gdelt_events.py            # GDELT GKG CSV downloader and parser
│   ├── rss_feeds.py               # RSS_FEED_META, ADDITIONAL_SCAN_FEEDS registry
│   ├── geocode.py                 # Nominatim wrapper with caching + country helpers
│   ├── routers/
│   │   ├── auth.py                # /api/auth/* and /api/user/*
│   │   ├── admin.py               # /api/admin/*
│   │   ├── intelligence.py        # /api/v2/events (unified event store)
│   │   ├── briefings.py           # /api/briefing/latest + generate
│   │   └── infrastructure.py      # /infrastructure, /infrastructure/all, /corridor, /analyse
│   ├── services/
│   │   ├── flight_route_service.py   # hexdb.io: route + type + airline + reg (parallel)
│   │   ├── aircraft_photo_service.py # Planespotters.net photo lookup, 6h cache
│   │   └── vessel_photo_service.py   # MarineTraffic CDN HEAD probe, 6h cache
│   ├── geo/                       # Cached GeoJSON: countries.geojson, eez.geojson
│   ├── data/                      # Static CSVs: airports, ports, power plants, pipelines
│   ├── documents/                 # User documents: claude-briefings/, my-documents/, etc.
│   ├── .env                       # Secrets (not committed)
│   ├── Procfile                   # Railway: uvicorn main:app --host 0.0.0.0 --port $PORT
│   └── requirements.txt
├── src/
│   ├── main.jsx                   # React entry: ErrorBoundary + push notification init
│   ├── app.jsx                    # Root app: auth, tabs, surface pool, global state
│   ├── auth.js                    # Token helpers: getToken/setToken/clearToken/apiFetch
│   ├── apiBase.js                 # API_BASE: env var → Railway URL → localhost:8000
│   ├── soundSystem.js             # Web Audio alert tones
│   └── components/
│       ├── mappage.jsx            # Map + all layers (aircraft, vessel, news, infra, satellite)
│       ├── LayersPanel.jsx        # Layer toggle sidebar
│       ├── TopBar.jsx             # Top navigation bar
│       ├── Sidebar.jsx            # Left sidebar
│       ├── BottomNav.jsx          # Mobile bottom nav
│       ├── MobileDrawer.jsx       # Mobile slide-out drawer
│       ├── LoginPage.jsx          # Auth gate
│       ├── AdminPanel.jsx         # Super-admin user management
│       ├── BriefingPanel.jsx      # Daily intelligence briefing tab
│       ├── NewsPage.jsx           # Country-specific news tab
│       ├── SurfaceDetailPanel.jsx # Event detail right panel
│       ├── NotificationsDrawer.jsx# Surface pool alert list
│       ├── OverwatchSidebar.jsx   # Overwatch polygon drawing + analysis
│       ├── ChatPanel.jsx          # Group chat
│       ├── DirectChatPanel.jsx    # 1:1 direct messages (WebSocket)
│       ├── MissionProfilePanel.jsx# Focus regions + mission context editor
│       ├── WorkspacesPanel.jsx    # Named map workspaces
│       ├── SituationsPanel.jsx    # Saved situation snapshots
│       ├── POIPanel.jsx           # Points of interest editor
│       ├── NotificationBar.jsx    # Top alert banner from /api/v2/notifications
│       ├── AlertStrip.jsx         # Flagged item banner
│       ├── ToastSystem.jsx        # Toast notifications
│       ├── SettingsPanel.jsx      # User settings
│       ├── HealthPanel.jsx        # Backend data source health
│       ├── ProfilePanel.jsx       # User profile
│       ├── PreferencesPanel.jsx   # Display preferences
│       ├── LoadingScreen.jsx      # Startup splash
│       ├── StartupModal.jsx       # First-run setup
│       ├── StartupChoiceModal.jsx # Map/News/Briefing choice on login
│       ├── WelcomeBackModal.jsx   # Session return modal
│       └── tvwidget.jsx           # TV/dashboard widget mode
├── vite.config.js                 # Dev proxy: non-asset → localhost:8000
├── package.json
└── ARCHITECTURE.md                # This file
```

---

## 3. Backend Architecture

### 3.1 FastAPI Application (`backend/main.py`)

The entire backend is a ~7,500-line FastAPI monolith. All HTTP endpoints, background loops, caching dictionaries, helper functions, and startup tasks live in this file. Routers for auth, admin, intelligence, briefings, and infrastructure are registered via `app.include_router()`.

**Middleware stack (applied in order):**
1. `GZipMiddleware` — compresses responses ≥ 1 kB
2. `CORSMiddleware` — allows all origins (permissive for development)

**Thread pool:** A shared `ThreadPoolExecutor` (`_executor`) is used throughout via `loop.run_in_executor()` to offload all blocking I/O (HTTP calls, file reads, feed parsing, Claude calls) without blocking the asyncio event loop.

### 3.2 HTTP Endpoints (complete list)

#### Auth & Users (`routers/auth.py`)
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Return JWT |
| GET | `/api/auth/me` | Verify token, return user |
| POST | `/api/auth/change-password` | Change own password |
| POST | `/api/auth/forgot-password` | Send reset email (Resend API) |
| POST | `/api/auth/reset-password` | Consume reset token |
| POST | `/api/auth/session` | Update last_seen + current_view |
| GET | `/api/users/search` | Search approved users (for DM) |
| POST | `/api/user/location` | Store GPS coordinates |
| GET | `/api/user/missed-activity` | Unread DMs + surface events since last session |

#### Admin (`routers/admin.py`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/users` | List all users |
| PUT | `/api/admin/users/{id}` | Update user (approval, role, ban) |
| DELETE | `/api/admin/users/{id}` | Delete user |

Super-admin accounts (seeded in `init_db()`) cannot be modified by other admins.

#### Intelligence / Events (`routers/intelligence.py`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/v2/events` | Unified event store — `mode=threads` or `mode=events` |
| GET | `/api/v2/events/stats` | Event store debug stats |
| GET | `/api/v2/events/{id}` | Single event or thread |
| GET | `/api/v2/notifications` | Recent elevated+ events for notification bar |

#### Briefings (`routers/briefings.py`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/briefing/latest` | Most recent daily briefing + rate limit metadata |
| POST | `/api/briefing/generate` | Manually trigger Claude briefing (rate-limited 2h) |

#### Infrastructure (`routers/infrastructure.py`)
| Method | Path | Description |
|---|---|---|
| GET | `/infrastructure` | OSM features for a category + bbox (Overpass, 6h cache) |
| GET | `/infrastructure/all` | Batch multi-category Overpass query |
| POST | `/infrastructure/corridor` | Infrastructure within buffer_km of a route |
| POST | `/infrastructure/analyse` | Claude brief for a single infrastructure point |
| GET | `/infrastructure/test` | Connectivity smoke test (Dar es Salaam hospitals) |

#### News
| Method | Path | Description |
|---|---|---|
| GET | `/news?country=X` | RSS articles for a country, geocoded, translated, 15 cap |
| GET | `/news/breaking` | Top 2 global headlines (BBC + Al Jazeera) |
| GET | `/news/region` | One headline per global region (8 regions) |

#### ADS-B / Aviation
| Method | Path | Description |
|---|---|---|
| GET | `/adsb` | Live aircraft from adsb.lol (250nm radius, 15s cache) |
| GET | `/api/aviation/test` | Smoke test |
| GET | `/api/aviation/route/{icao24}` | hexdb.io route + type + airline + reg (30min cache) |
| GET | `/api/aviation/photo/{icao24}` | Planespotters.net photo (6h cache) |

#### Vessels / Maritime
| Method | Path | Description |
|---|---|---|
| GET | `/api/vessel/photo/{mmsi}` | MarineTraffic CDN photo probe (6h cache) |
| GET | `/ais` | Current in-memory AIS vessel positions (live from WebSocket) |

#### Map / Geo
| Method | Path | Description |
|---|---|---|
| GET | `/geo/countries` | World countries GeoJSON (monthly refresh) |
| GET | `/geo/eez` | EEZ boundaries GeoJSON |
| GET | `/geo/eez/{mrgid}` | Single EEZ zone + Wikipedia extract |
| POST | `/route` | OSRM route between waypoints |
| POST | `/route/analyse` | OSRM route + Claude security brief |
| GET | `/geocode` | Nominatim forward geocode |

#### Intelligence Analysis
| Method | Path | Description |
|---|---|---|
| POST | `/analyse` | Claude event analysis (contextual or basic) |
| POST | `/analyse/area` | Claude area analysis with polygon |
| POST | `/analyse-news` | Claude news article summary |

#### Surface / Alerts
| Method | Path | Description |
|---|---|---|
| GET | `/api/surface` | Ranked surface pool (top 50 gated events) |
| GET | `/api/surface/enrich/{id}` | Auto-enrichment result for a surface item |
| GET | `/news-conflicts` | All geocoded news conflict markers |
| POST | `/push/subscribe` | Register browser push subscription |
| DELETE | `/push/subscribe` | Remove push subscription |

#### Satellite / Sentinel
| Method | Path | Description |
|---|---|---|
| GET | `/sentinel` | Sentinel-2 true-color tile WMS proxy (Copernicus auth) |

#### Miscellaneous
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Basic health |
| GET | `/health/detailed` | All data source statuses |
| GET | `/api/health/usage` | Claude token usage + daily cost |
| GET | `/profile/load` | Load active mission profile |
| POST | `/profile/save` | Save mission profile + rebuild surface pool |
| GET | `/chokepoints` | Live status for 15 strategic chokepoints |
| GET | `/api/alerts` | Recent real-time alert queue |
| GET | `/api/v2/notifications` | Notification bar feed |
| GET + POST + DELETE | `/api/documents/*` | Document management (briefings, analysis) |
| GET | `/api/piracy` | IMB live piracy incidents |
| GET | `/api/oref` | Israeli Red Alert (OREF) live alerts |
| GET | `/api/usgs` | USGS earthquake feed |
| GET | `/api/gdacs` | GDACS disaster alerts |

### 3.3 Database (`backend/database.py`)

**Engine:** SQLite file (`horizon_watch.db` in backend directory).  
**ORM:** SQLAlchemy 2 (sync engine, thread-safe with `check_same_thread=False`).  
**Migration:** Manual column-add migration via `migrate_db()` — no Alembic.

**`users` table (35 columns):**
- Identity: `id`, `username`, `email`, `password_hash`
- Auth: `is_approved`, `is_admin`, `is_super_admin`, `is_banned`
- Profile: `full_name`, `organization`, `role`, `bio`, `avatar_url`
- Location: `last_lat`, `last_lon`, `last_location_at`
- Session: `last_seen`, `current_view`, `session_count`
- Preferences: `notification_prefs` (JSON string)
- Password reset: `reset_token`, `reset_token_expires`
- Timestamps: `created_at`, `updated_at`

**`direct_messages` table (8 columns):**  
`id`, `sender_id`, `recipient_id`, `content`, `created_at`, `read_at`, `is_deleted`, `deleted_by`

**Startup:** `init_db()` seeds two hardcoded super-admin accounts on every startup (no-op if they already exist).

### 3.4 Authentication (`backend/app_shared.py`)

- **Algorithm:** JWT HS256
- **Secret:** `JWT_SECRET` env var (default: `hw-prod-secret-change-me-2026-trifecta` — CHANGE IN PROD)
- **Expiry:** 7 days
- **Storage:** `localStorage["hw-auth-token"]` on the frontend
- **Hashing:** bcrypt via passlib
- **Dependencies:**
  - `get_optional_user` — returns user or None (for public endpoints)
  - `require_approved_user` — 401 if no token, 403 if not approved
  - `require_admin_user` — 403 if not admin

### 3.5 Background Tasks (started in `@app.on_event("startup")`)

All are `asyncio.Task` created at startup, using `loop.run_in_executor()` for blocking work:

| Task | Interval | Purpose |
|---|---|---|
| `_extract_news_conflicts_loop` | Immediate + every 30 min | Fetch 50+ RSS feeds, Gate-0 filter, geocode (Nominatim), build conflict markers |
| `_background_news_geocode_loop` | Every 3 min | Retry geocoding for articles that missed coordinates |
| `_surface_pool_loop` | Every 10 min | Rebuild ranked top-50 surface pool from news markers |
| `_daily_briefing_loop` | Every day at 08:00 UTC | Generate Claude daily intelligence briefing |
| `_ais_websocket_loop` | Persistent WebSocket | Connect to aisstream.io, receive vessel position updates |
| `_oref_loop` | Every 30s | Poll Israeli Red Alert API |
| `_usgs_loop` | Every 2 min | Poll USGS earthquake feed |
| `_gdacs_loop` | Periodic | Poll GDACS disaster feed |
| `_geo_refresh_loop` | Every 6h check | Refresh countries/EEZ GeoJSON if >30 days old |
| `_startup_warmup_tasks` | Once | Warm up surface pool, load event store from disk |

### 3.6 Event Store (`backend/event_store.py`)

Central in-memory store merging events from all sources:

- **`_EVENT_STORE`:** `dict[str, dict]` keyed by content hash (SHA256 of URL or title+coords). 72-hour TTL.
- **`_THREAD_STORE`:** Events grouped into threads by geographic proximity (55km), time (24h), type compatibility, and keyword overlap (≥15%).
- **Severity tiers:** `low` → `elevated` → `significant` → `critical` (based on Goldstein score + significance score)
- **Persistence:** `save_to_disk()` / `load_from_disk()` for crash recovery — atomic write via `.tmp` + `os.replace()`
- **Thread building:** Runs on every surface pool rebuild; groups events into thread summaries with timeline, actors, casualties, and corroboration count.

### 3.7 RSS Feed Pipeline

**Sources:** 50+ feeds across Africa, Middle East, Europe, Asia, Americas (see `_SCAN_FEEDS` in `main.py`). Supplemented by `ADDITIONAL_SCAN_FEEDS` from `rss_feeds.py`.

**Pipeline per cycle:**
1. **Parallel fetch** — 20 concurrent HTTP workers fetch all feeds simultaneously
2. **Gate 0** — headline security keyword filter; rejects sports/lifestyle articles
3. **Event type classification** — keyword-based (`conflict`, `maritime`, `aviation`, `energy`, `telecom`, `general`)
4. **Geocoding** — 3-stage Nominatim pipeline:
   - Stage 1: Strict — candidate location + country validation
   - Stage 2: Relaxed — country-only lookup
   - Stage 3: Fallback — known city centroids or country centroids
5. **Confidence scoring** — `high/medium/low` based on source tier (local/regional/global) × location specificity (town/district/country)
6. **Deduplication** — URL-based processed set prevents re-processing same articles
7. **Marker creation** — geocoded articles become `_NEWS_CONFLICT_MARKERS` for map display

**Translation:** Non-English titles detected via `langdetect`, translated via LibreTranslate (3s timeout, graceful fallback to original).

### 3.8 Surface Pool Pipeline

The surface pool is the ranked list of intelligence items surfaced to users:

1. Collect active news conflict markers
2. Score with `score_news_markers()` from `scoring.py`
3. Apply geo gate (events within 3000km of profile focus regions)
4. Classify with `classify_event()` (assigns type, icon, color)
5. Score significance with `_score_significance()` (0–100)
6. Gate: DISCARD (<40), SURFACE (40–79), AUTO_ENRICH (≥80)
7. Background prefetch: infrastructure nodes within 200km for each item
8. AUTO_ENRICH items: Claude call for enrichment (JSON + prose)
9. Sort by relevance, cap at 50

### 3.9 AIS WebSocket (`aisstream.io`)

- Connects to `wss://stream.aisstream.io/v0/stream` with AISSTREAM_API_KEY
- Subscribes to a focus-region bounding box
- Receives `PositionReport` messages, decodes ship type codes
- Stores up to 2,000 vessels in `_AIS_VESSELS` dict (keyed by MMSI)
- Evicts positions older than 5 minutes
- Reconnects automatically on disconnect with exponential backoff
- Disabled gracefully if key is missing or `websockets` package not installed

### 3.10 Caching Strategy

All caches are in-memory Python dicts with TTL timestamps. No Redis or external cache.

| Cache | TTL | Key |
|---|---|---|
| Route (hexdb.io) | 30 min | `icao24.lower()` |
| Aircraft photo | 6 h | `icao24` |
| Vessel photo | 6 h | `mmsi` |
| ADS-B | 15 s | `lat,lon,dist` |
| News (by country) | 15 min | `country.lower()` |
| Region news | 15 min | `"all_regions"` |
| Infrastructure (static) | 7 days | `category:bbox` |
| Infrastructure (dynamic) | 6 h | `category:bbox` |
| Route analysis | 30 min | origin→dest hash |
| Nominatim geocode | Process lifetime | place name |
| Event prefetch infra | 2 h | event id |
| Auto-enrichment | 6 h | event id |
| EEZ GeoJSON | 30 days (file) | file mtime |
| Countries GeoJSON | 30 days (file) | file mtime |

### 3.11 Claude Usage Tracking

`usage_tracker` (in `main.py`) tracks:
- Input/output tokens per call
- Call type (`auto_enrichment`, `route_analyse`, `cluster_brief`, etc.)
- Daily cost estimate (at Claude Sonnet pricing)
- Dedup store (6h per event id) to prevent re-enrichment
- Daily auto-enrichment limit (`_AUTO_ENRICH_DAILY_LIMIT`)
- Daily spend cap (`_AUTO_ENRICH_DAILY_SPEND_CAP`)

---

## 4. Frontend Architecture

### 4.1 Entry Point & Auth Flow

**`src/main.jsx`:** Wraps `<App>` in `ErrorBoundary`. Registers service worker for Web Push notifications on mount.

**`src/app.jsx`:** Root component (~900+ lines). On mount:
1. Checks `localStorage["hw-auth-token"]` via `getToken()`
2. If token exists, calls `GET /api/auth/me` to validate and load user
3. If no user → renders `<LoginPage>` (full-page auth gate)
4. If user → renders full application
5. Posts session tracking every 60s
6. Sends GPS coordinates every 5 minutes

### 4.2 Application Shell

**Layout:** Full-viewport flex column: `TopBar` → content row → (optional) `BottomNav` on mobile.

**Content row:** Left `Sidebar` → main content area (map or tab panel) → right panel slot (300px, glassmorphism).

**Tab system:** Tabs stored in `localStorage["akili_tabs"]`. Supported tab types: `map`, `news`, `briefing`. Default: single Map tab.

**Right panel slots** (mutually exclusive): `layers`, `detail`, `profile`, `settings`, `health`, `workspaces`, `situations`, `chat`, `alerts`, `poi`.

**State managed in `App`:**
- `currentUser` — authenticated user object
- `profile` — mission profile (focusRegions, context, etc.)
- `surfaceItems` — ranked event pool from `/api/surface`
- `selectedSurface` — currently viewed event
- `tabs` / `activeTabId` — tab system
- `rightPanel` — active right-panel slot
- `searchTarget` — pan/zoom target sent to MapPage

### 4.3 Map Page (`src/components/mappage.jsx`)

The largest component (~2,500+ lines). Uses React-Leaflet. All layers render inside a single `<MapContainer>`.

**Map layers (controlled by LayersPanel toggles):**

| Layer | Source | Refresh |
|---|---|---|
| **Aircraft (ADS-B)** | `GET /adsb` | Polling interval (~15s) |
| **Vessels (AIS)** | `GET /ais` | Polling interval |
| **News conflict markers** | `GET /news-conflicts` | Polling interval |
| **Infrastructure** | `GET /infrastructure/all` | On demand (bbox change) |
| **Satellite (Sentinel-2)** | `GET /sentinel` (WMS proxy) | Static when enabled |
| **Countries** | `GET /geo/countries` | On mount |
| **EEZ zones** | `GET /geo/eez` | On mount |
| **GDELT events** | Via event store | Background |
| **Earthquakes** | Via `/api/usgs` | Background |

**Aircraft Layer (`AircraftLayer` component within mappage.jsx):**
- Classification: `_acClassify(ac)` — military (dbFlags bit 0), helicopter (category A7), GA (A1/A2), commercial (A3-A6 or IATA callsign regex)
- Icons: `_acIconParts()` — SVG `L.divIcon` per type:
  - Military: red/orange airliner SVG + `ac-glow-mil` pulsing CSS animation
  - Commercial: cyan airliner SVG + `ac-glow-cyan`
  - Helicopter: green side-profile SVG (rotor, fuselage, cockpit, skids) + `ac-glow-grn`
  - GA: white top-down prop plane SVG + `ac-glow-wht`
- Icons rotate with aircraft track angle
- Filter panel (bottom-left): Military/Commercial/Helicopter/GA checkboxes — `createPortal` outside map DOM
- Follow mode: clicking an aircraft enters follow mode; shows callsign + route in follow bar
- Route lookup: on aircraft click, calls `GET /api/aviation/route/{icao24}` (hexdb.io)
- Photo: calls `GET /api/aviation/photo/{icao24}` (Planespotters.net)
- Tooltip: ICAO, callsign, altitude, speed, departure/destination
- Detail panel: route visualization (polyline between airports), type, registration, airline

**Glow animations (CSS keyframes in MAP_STYLES):**
```css
ac-glow-mil  → red/orange drop-shadow, 2.2s cycle
ac-glow-cyan → cyan drop-shadow, 2.5s cycle
ac-glow-grn  → green drop-shadow, 2.3s cycle
ac-glow-wht  → white drop-shadow, 3.0s cycle
```

**Vessel Layer:**
- AIS vessel markers colored by ship type
- Click shows MMSI, vessel name, speed, heading, type
- Photo lookup: `GET /api/vessel/photo/{mmsi}`

**News Conflict Layer:**
- Colored markers (high/medium/low confidence)
- Click shows headline, source, location, link
- Hovering shows tooltip

**Satellite Layer:**
- Copernicus Sentinel-2 true-color WMS via backend proxy
- Configurable date range
- Thumbnail history panel

**Overwatch:**
- Polygon drawing tool (click-to-draw vertices)
- On close: sends polygon to `/analyse/area` (Claude analysis)
- Results shown in `OverwatchSidebar`

### 4.4 Mission Profile

Stored in `localStorage` and synced to backend (`/profile/save`).

Fields: `focusRegions` (list of region names), `missionContext` (free text), `operatorRole`, `threatLevel`, `priorityInfrastructure`.

Profile is injected into every Claude prompt as a context preamble. Saving the profile rebuilds the surface pool server-side.

### 4.5 News Page (`NewsPage.jsx`)

- Dropdown to select country
- Calls `GET /news?country=X` on selection
- Displays article cards with: title, source, timestamp, location pin
- Articles are geocoded — clicking a card pans the map to that location

### 4.6 Briefing Panel (`BriefingPanel.jsx`)

- Fetches `GET /api/briefing/latest`
- Displays structured Claude briefing: Situation Overview, Key Developments, Indicators to Watch, Infrastructure Status, Trend Line
- Manual regenerate button (rate-limited 2h, shows countdown)
- Briefing auto-generates daily at 08:00 UTC

### 4.7 Chat System

**Group chat (`ChatPanel.jsx`):** HTTP polling to `/chat/messages`. Simple room-based messages.

**Direct chat (`DirectChatPanel.jsx`):** WebSocket connection per conversation to `/ws/dm/{user_id}`. Threads stored in `direct_messages` SQLite table.

### 4.8 `apiBase.js`

```js
const API_BASE =
    import.meta.env.VITE_API_BASE ||       // Vercel env var
    "https://your-app.railway.app" ||       // Railway production URL (hardcoded fallback)
    "http://localhost:8000"
```

In development, Vite proxy (`vite.config.js`) intercepts non-asset requests and forwards to `localhost:8000`, so the hardcoded fallback is only needed in production.

---

## 5. Data Flow Diagrams

### 5.1 News Conflict Marker Pipeline

```
50+ RSS Feeds
     │ (parallel HTTP, 20 workers)
     ▼
feedparser.parse()
     │
Gate 0: security keyword filter → REJECT non-security articles
     │
Event type classification (keyword matching)
     │
3-stage geocoding (Nominatim → city fallback → country centroid)
     │
Confidence scoring (source tier × location specificity)
     │
_NEWS_ARTICLE_STORE (in-memory, URL-keyed)
     │
_NEWS_CONFLICT_MARKERS (geocoded articles with lat/lon)
     │
_build_surface_pool()
     │ (classify + significance score + geo gate)
     ▼
_SURFACE_POOL (top 50 items)
     │
GET /api/surface → frontend surfaceItems
     │
NotificationsDrawer + NotificationBar + SurfaceDetailPanel
```

### 5.2 Aircraft Track Flow

```
adsb.lol API (REST)
     │ GET /v2/lat/{lat}/lon/{lon}/dist/{dist}
     │ (15s cache per lat/lon/dist key)
     ▼
GET /adsb → { aircraft: [...] }
     │
AircraftLayer.jsx (React-Leaflet)
     │ _acClassify() → type
     │ _acIconParts() → SVG divIcon with CSS glow
     ▼
Leaflet markers (rotated, pulsing)
     │ onClick
     ▼
GET /api/aviation/route/{icao24}
     │ hexdb.io: hex-route, hex-type, hex-airline, hex-reg (parallel)
     │ (30min cache)
     ▼
Route display in tooltip + follow bar + detail panel

GET /api/aviation/photo/{icao24}
     │ Planespotters.net (6h cache)
     ▼
Photo in detail panel
```

### 5.3 Auto-Enrichment Flow

```
_SURFACE_POOL item (significance ≥ 80 → AUTO_ENRICH)
     │
_prefetch_event_infra() [background thread]
     │ airports CSV + ports CSV + power plants CSV + OSM (Overpass)
     │ within 200km of event
     ▼
_PREFETCH_CACHE[item_id]

_maybe_auto_enrich_batch() [background thread]
     │ Check: dedup cache, daily limit, spend cap, geo gate (3000km)
     │
     ▼ Claude Sonnet call
Prompt: event data + nearby infra + chokepoint statuses + profile
Response: JSON block (relevance, actors, severity, infra) + prose
     │
_ENRICHMENT_CACHE[item_id] (6h TTL)
     │
GET /api/surface/enrich/{id} → frontend detail panel
```

### 5.4 Daily Briefing Flow

```
08:00 UTC daily (or manual trigger via POST /api/briefing/generate)
     │
_generate_briefing_sync()
     │ Gather: surface pool top 50 + news markers (24h) + chokepoint statuses
     │
     ▼ Claude Sonnet call (system prompt + user prompt)
5-section structured briefing text
     │
_BRIEFING_STORE (in-memory list, last 30 kept)
backend/documents/claude-briefings/{id}.json
     │
GET /api/briefing/latest → BriefingPanel.jsx
```

---

## 6. External APIs & Services

| Service | Usage | Auth | Limits/Notes |
|---|---|---|---|
| **adsb.lol** | Live ADS-B aircraft | None (free) | 250nm radius, 15s cache |
| **aisstream.io** | Live AIS vessels (WebSocket) | API key (`AISSTREAM_API_KEY`) | Focus-region bbox subscription |
| **hexdb.io** | Aircraft route, type, airline, registration | None (free) | 4 parallel requests per lookup; limited route coverage |
| **Planespotters.net** | Aircraft photos | None (free) | 6h cache |
| **MarineTraffic CDN** | Vessel photos (HEAD probe) | None (CDN guess) | 6h cache |
| **Copernicus/Sentinel** | Satellite imagery WMS | OAuth2 (`COPERNICUS_CLIENT_ID/SECRET`) | Proxied via backend |
| **Anthropic Claude** | Event enrichment, route analysis, briefings, area analysis | API key (`ANTHROPIC_API_KEY`) | Model: `claude-sonnet-4-20250514`; daily budget tracked |
| **Nominatim (OSM)** | Forward geocoding | User-Agent header | ≥1s between uncached requests; 100 calls/cycle cap |
| **Overpass API** | Infrastructure queries (OSM) | None | 3 URLs rotated; retry on 429/504 |
| **OSRM** | Route planning | None (public instance) | `router.project-osrm.org` |
| **LibreTranslate** | Article title translation | None | 3s timeout; falls back to original |
| **Wikipedia REST** | Infrastructure + EEZ descriptions | None | `en.wikipedia.org/api/rest_v1` |
| **IMB Piracy** | Live piracy incidents | None (scrape) | Polled periodically |
| **OREF (pikud-haoref.org.il)** | Israeli Red Alert | None | Polled every 30s |
| **USGS** | Earthquake feed | None | Polled every 2 min |
| **GDACS** | Disaster alerts | None | Polled periodically |
| **Resend** | Password reset emails | API key (`RESEND_API_KEY`) | Currently empty (not configured) |

---

## 7. Current State & Known Issues

### Working
- ADS-B aircraft layer with type-specific icons, glow animations, filter panel
- hexdb.io route + type + airline + registration lookup (confirmed working for real aircraft)
- AIS vessel layer (if AISSTREAM_API_KEY configured)
- News conflict markers (geocoded RSS → map pins)
- Surface pool + auto-enrichment pipeline
- Daily Claude briefing generation
- JWT auth + user management + admin panel
- Infrastructure layer (Overpass OSM)
- Route planning + route analysis (Claude)
- Country news panel
- EEZ layer + country boundary layer
- Sentinel-2 satellite imagery

### Known Issues / Limitations
1. **hexdb.io route coverage is sparse** — `hex-route` returns 404 for most aircraft. Type, airline, and registration work better.
2. **JWT_SECRET is a weak default** — `hw-prod-secret-change-me-2026-trifecta` must be changed in production (currently hardcoded in `.env`).
3. **All caches are in-memory** — backend restart loses all cached data, surface pool, and news markers (event store has disk persistence but news markers do not).
4. **No database migrations** — `migrate_db()` only adds columns; column removal, type changes, or index changes require manual SQL.
5. **CORS is fully permissive** — `allow_origins=["*"]` is inappropriate for production.
6. **Nominatim rate limiting** — the 1.1s sleep between uncached requests means large feed cycles take minutes; 100-call cap per cycle helps but means some articles miss coordinates on first pass.
7. **Resend API key missing** — password reset emails will fail silently.
8. **`AERODATABOX_API_KEY` and `AVIATIONSTACK_API_KEY` are empty** — these services are no longer used (replaced by hexdb.io) but the env vars remain.
9. **No test suite** — no unit tests, integration tests, or CI pipeline.
10. **Main.py is a 7,500-line monolith** — difficult to navigate; needs decomposition into routers.

---

## 8. Deployment

### Backend (Railway)
- **Procfile:** `web: uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Environment:** All secrets via Railway env vars (see `.env` for the list)
- **Persistent storage:** SQLite file + event store JSON + briefings JSON + geo cache + documents are all on-disk — Railway volume or ephemeral filesystem (check Railway config)
- **Python version:** Assumed 3.11+ (uses `match`, `type hints with |`)

### Frontend (Vercel)
- **Build:** `npm run build` → Vite outputs to `dist/`
- **Env var:** `VITE_API_BASE` must be set to the Railway backend URL
- **Routing:** SPA (all routes served `index.html`)

### Local Development
- Backend: `cd backend && uvicorn main:app --reload --port 8000`
- Frontend: `npm run dev` (Vite dev server on port 5173, proxies API to 8000)

---

## 9. Security

### Strengths
- bcrypt password hashing (cost factor from passlib default)
- JWT with 7-day expiry
- Super-admin protection (cannot modify other super admins)
- Claude prompt injection mitigation (profile context is labeled and structured)
- Gate 0 keyword filter prevents geocoding of irrelevant content

### Weaknesses / Risks
- **JWT secret is a known default** in `.env` — must be rotated before any production exposure
- **CORS allows all origins** — any site can make credentialed requests
- **SQLite with no connection pooling** — concurrent writes may be slow but are thread-safe via `check_same_thread=False`
- **No rate limiting on most endpoints** — `/news`, `/adsb`, `/analyse` etc. can be hammered
- **API keys in plaintext `.env`** — `ANTHROPIC_API_KEY`, `COPERNICUS_CLIENT_SECRET`, `AISSTREAM_API_KEY` exposed if `.env` is committed (it should not be)
- **No input sanitization on map bbox/coords** — floats only, no geographic bounds validation
- **Auto-enrichment geo gate** is hardcoded to Africa/Middle East centroids — not profile-driven

---

## 10. Technical Debt

### High Priority
1. **Extract main.py into modules** — news pipeline, surface pool, enrichment, briefing, satellite, geo endpoints, chokepoints, documents each warrant their own router/service file
2. **Add integration tests** — at minimum for the auth flow, surface pool, and event store
3. **Replace Nominatim with a paid geocoder** for production throughput (1.1s/call × 100/cycle = ~2 minutes blocked)
4. **Persistent caches** — use Redis or a SQLite cache table so backend restarts don't cold-start the news pipeline

### Medium Priority
5. **Database migrations** — adopt Alembic so schema changes can be managed safely
6. **Rate limiting** — add `slowapi` or similar to protect `/analyse`, `/news`, `/adsb`
7. **CORS tightening** — restrict to known frontend origins
8. **Event bridge loop** — `event_bridge.py` bridges news store into event store; the polling interval and dedup logic need review for production load
9. **AIS vessel cap** — 2,000 vessels at 5-minute TTL may be insufficient for dense shipping lanes

### Low Priority
10. **Remove legacy env vars** — `AERODATABOX_API_KEY`, `AVIATIONSTACK_API_KEY` are unused
11. **Vite proxy** — replace hardcoded Railway URL fallback in `apiBase.js` with an env var
12. **Map layer rendering** — `L.divIcon` SVGs are built as template strings; move to a React SVG component pattern for easier maintenance
13. **`useEffect` dependency arrays** — several suppress exhaustive-deps warnings; review for stale closure bugs
14. **Document system** — folder structure is hardcoded (`claude-briefings`, `my-documents`, `saved-analysis`, `archived`); user-defined folders would require schema changes
