# Handoff — 2026-10-05

Written for the next session. Everything below was measured against the
live system, not inferred.

## Standing rules from the owner

- **Claude writes briefings and the decks built from them. Nothing else.**
  Every other model job goes to OpenAI through `openai_gate.py`, under one
  monthly cap (`HW_OPENAI_BUDGET_USD`, currently $11; spend to date ≈$0.015).
  `llm_gate.py` enforces this and its docstring says so.
- **No generic output, anywhere.** "Escalation in non-state conflict, 90%",
  "Multi-domain intelligence signals detected at Unknown Location", "50
  signals on the surface, 7 of them critical" — all rejected for the same
  reason: they name no actor, no place, no object, and nobody can act on
  them or be wrong about them. Anything the system says should name
  something.
- **Never "Unknown Location".** If a thing's place cannot be resolved, it is
  not published.
- Do not raise key rotation again.
- **Media is not stored on the owner's laptop** (2026-10-06). Telegram videos
  are fetched when opened and held 30 minutes in the temp dir; nothing is
  prefetched. Long-term media storage belongs on the server (item M).

## Gotchas that cost hours — read these first

1. **A 200 from `/api/health/live` is NOT readiness.** After boot this app
   spends ~2 minutes at ~100% CPU building snapshots and walking the
   ontology; requests are accepted and never answered. Browser probes
   launched into that window fail as "0 destinations render",
   "authentication required", "server did not respond within 30s" — all of
   which read as product bugs and are not. Use `./_settled.sh`: three
   consecutive sub-10ms health replies **with a 200 status** and the process
   under 40% CPU. (An earlier version checked time but not status, and a
   refused connection returns in 0.0003s, which read as "settled".)
2. **Caches hide fixes.** `backend/data/enrichment_cache.json` is keyed on
   signal text and stored *derived* values. A correct fix to
   `resolution_key` changed nothing live because cached rows kept their
   stale keys. Derive on read; cache only the expensive input. When a prompt
   changes, clear the entries it produced.
3. **Never report a guard as working against an empty result.** "0 role
   words over 0 links" confirms nothing. Wait for a non-empty case.
4. **`ps -M` reports nonsense for thread counts on macOS.** Use
   `top -l 1 -pid <pid> -stats th`.
5. The surface pool is cached in the DB (`surface_pool_cache`). Clear it to
   see a rebuild take effect.

## What was done (9 commits, `ff2c9e8` → `d0bd38a`)

### Database
- Root cause of the 10.7GB file: `TRACK_DENSITY_CLEANUP_ENABLED` defaults
  **false** in `main.py` and was never set after a 2026-09-16 incident. The
  cleanup had since been rewritten to batch and yield, and left off. 24.2M
  rows accumulated over three weeks.
- `track_density` (24.2M) → `activity_daily` (191k: day × domain × 1° cell →
  count, avg speed). `vessel_history` → `vessel_day` (68.5k). Likewise
  `aircraft_day` (101k). **These are the long-term numeric record** — query
  them for anything historical.
- Swapped to a vacuumed file: **10.74 GB → 2.55 GB**. Original kept at
  `backend/data/akili.db.prepruned` — delete when satisfied to reclaim 8.2GB.
  Side effect: `/api/fusions` went 18.3s → 0.67s.
- `backend/retention.py` + `prune_history.py` exist so this cannot recur.

### Signals and data quality
- **Country join: 0% → 100%.** A live pool had 0 of 50 signals with
  `location_country` while every one carried it as the last part of its
  location string. `location_extract.country_from_location()` resolves it
  (handles "(general)" suffixes, mojibake regions, and
  "United States" vs "United States of America"). Exact matching only.
- **Surface pool had no headline dedup.** 103 duplicate rows in one build; a
  Georgia shooting mapped to both Atlanta and Vienna, Austria. Deduped after
  the relevance sort; losing geocodes kept as `contested_locations`; the
  geocode whose words appear in the headline wins the place.
- **Enrichment** (`backend/enrich.py`): model extracts fields, **code decides
  identity**. Three mentions of "Irina" with one MMSI between them resolve to
  one ship. A bare role word ("Pastor", "Police") is never an entity.
  ~$0.00005/signal.

### Forecasting
- `backend/outlook.py` + `outlook_store.py`: named statements citing signals
  from the console, each with a probability, a resolution date and a
  criterion written before the fact, so they can be marked and scored.
  Rejects three defect classes in code: unfalsifiable ("may face
  scrutiny"), certain ("road accidents may continue to claim lives"), and
  unresolvable acronyms. Built on a 20-minute timer, served from cache in 5ms.
- `src/destinations/ForecastToday.jsx` is the UI; Forecast opens on it.

### Reliability
- `_prefetch_event_infra` spawned one thread per signal; the process reached
  **403 threads** parked on an Overpass endpoint that was refusing
  connections. Now a 4-worker pool plus a circuit breaker (6 consecutive
  failures → return empty for 5 minutes).
- `Math.max(...array)` throws `RangeError` past ~100k arguments and was in
  **8 places** over data-sized arrays. All replaced with
  `src/utils/extent.js`. This was the intermittent "Maximum call stack size
  exceeded".
- `useChrome`'s toggle called `updateSetting` inside a setState updater —
  React runs updaters during render, so every panel toggle notified all
  settings subscribers mid-render.

### Fusions
- 0 of 619 now say "Unknown Location" (was 484 of 811). `_best_location_name`
  falls back to the signals' position, then to the fusion's own key
  (`CTY:mx` → Mexico, `GEO:19.25,-99.25` → a point). A fusion whose location
  cannot be resolved is **not created**.
- `country_name_from_code` held only 19 entries (an East Africa subset); it
  now also reads `public/data/world-countries.json` (191 countries).
- Fusion narrative moved from Claude to OpenAI (`backend/fusion_narrative.py`),
  keeping the engine's existing `_validate_narrative` guard.

## The agreed work list, in order

1. ~~Aircraft chain~~ — done `15ffc8a`. Live: 58.4% of aircraft resolve.
2. ~~Chokepoint throughput vs baseline~~ — done `dbd949e`. Share of observed
   AIS, not raw count (raw tracks uptime). **Hormuz and Bab el-Mandeb have no
   AIS coverage at all** — needs a second source (GFW?), not code.
3. ~~Home header~~ — done `729951c`; theater cards were hardcoded and are now
   counted from signals per theater country.
4. ~~Minimap in Home~~ — done `eda6de0`, in the Suggested card (shared 2D `Minimap`).
5. ~~Vessel chain~~ — done: flag (MID table fixed, 98%+ of live vessels) →
   **registered owner** from GFW's registry on click (`vessel_owner.py`), ~20%
   of this small-craft-heavy feed. Original notes: MMSI first 3 digits = flag state (free, 100%). Operator
   is harder: `ftm_things` has only 1,370 MMSIs, `sanctioned_entities.owner_chain`
   is **empty across all 458k rows**. Vessel-name prefixes (MSC, Maersk,
   CMA CGM) resolve only 2.1% of this feed.
6. **Entity traversal API** — click → chain with evidence. Note the graph's
   1,264 "operates" edges are *military unit → equipment* from the Ukraine
   data, **not** commercial ownership. 36,222 vessel nodes, 0 with a
   commercial operator. No aircraft nodes at all.
7. **Then the UI work**: theater creation and what a theater *is*, first-login
   tour, first-login interest capture, Home personalised by interest,
   settings (time, defaults, **bring shortcuts back** — they exist in
   `app.jsx`'s keydown handler but are undiscoverable), default layers at
   login and per theater.
8. **Added by the owner 2026-10-05:**
   - **Search bar** — needs work (scope to be defined with the owner).
   - **Top-bar Layers button** — remove it.
   - **The "LM KA RT" avatars** in the top bar must show which users are
     actually online right now, not a fixed set.
   - **Auto night/day theme** has to actually work.
   - **Theater creation** (also in 7).
   - **First-login tour** (also in 7).
   - **Notifications only while the system is in use** — live events as they
     happen, never a backlog ("what happened 5 hours ago") on return.

### UI design direction (agreed 2026-10-05)
Professional and sleek, modern, solid; the owner likes the big headlines.
1. One set of rules: type scale, spacing, ONE heading style
   (`src/inspector/SectionLabel.jsx`), ONE date format (`src/utils/formatTime.js`:
   "5 Oct 2026" / "5 Oct 2026, 14:32Z"; `toLocaleString()` is still used ~38
   times elsewhere).
2. Shared pieces: panel header (headline = what happened; subtitle = kind ·
   place · date), section heading, attribute row, source row, empty sections
   hidden.
3. ~~Inspector first~~ — done: wrapping headline, Sources list with in-app
   viewer for X/Telegram (`SourceViewer.jsx`, `sourceEmbed.js`; news sites
   refuse framing and open in a tab), IDs folded into "Record details".
4. Next: carry the same pattern to the other side panels and the top bar.
   Sidebar icons stay monochrome (red/amber mean severity here); give the
   active module a clear accent instead.

### Owner's list, 2026-10-05 afternoon — status at end of session
Done (all verified in the browser, committed locally, NOT pushed):
1. ~~Theater title / favourites~~ — `b883b0d`. Also fixed: theaters loaded
   before sign-in, leaving placeholder tabs until a reload.
2. ~~Search~~ — `c3320af`, `c5a8411`. Typeahead under the box; countries
   and cities instant, streets/addresses via /api/search, coordinates, Enter
   flies there. One search: all old palette openers focus it.
3. ~~Share~~ — `bf03c95`. Copies a link with theater + camera.
4. ~~Notification count~~ — `4259f12`; ~~"now, not a backlog"~~ — `de9f98f`
   (events older than 30 min go to the tray as read; no pop-ups while hidden).
5. ~~Settings / tutorial missing~~ — `4289dc0`: ff2c9e8 had deleted eight
   overlays from the render (palette, tray, settings, capture, tutorial,
   update banner, toasts, live cards). Content of settings/tutorial NOT yet
   reviewed.
6. ~~Theater creation asks lat/lon~~ — `c5a8411`: name a place instead.
7. ~~Window layout~~ (part) — `01fa957`, `c667bd8`: real pane-edge insets,
   source viewer makes room, Layers closes when the map would be < 480px,
   notification cards stay off the inspector. Other panes (Overwatch, the
   GeoConfirmed strip) not yet checked against the same rule.
- Photo placeholder with pulsing Parallax X — `2d6bd9b`.
- Vessel/aircraft feed detail (draught, ETA, status; squawk, climb, target
  altitude, GPS) — `a139417`.

Done since (2026-10-05 evening → 2026-10-06), all committed locally, NOT pushed:
8. ~~Default layers~~ — `f4ed186`.  9. ~~Imagery page~~ — `3efdb1b`, `2dab452` (see below).
10. ~~Risk ranking~~ — `1dbf8e9` (evidence-first).  11/23. ~~Insight actionable~~ — `dd0b513`
    (escalation vs own 28-day baseline, "what may follow", watch-area / theater buttons).
12/19. ~~Cheap relevance filter~~ — `6737c3a`; GDELT map judged per article — `81e0407`.
13. ~~Vessel 90-day pattern of life~~ — `723fa72`; ROT in words — `521e60e`.
14. ~~Settings/tutorial content~~ — `2b91a89`.  15. ~~Infrastructure context~~ — `89a7c78`.
16. ~~Flows~~ — `dd3f77d`.  17. ~~One-object search~~ — `51f5bbe`.  18. ~~Track filters~~ — `75fcc48`.
20. ~~Newest critical headline/gradient~~ — `9015718`.  22. ~~Interests~~ — `8e58359` (asset registry still open).
24. ~~Telegram~~ — `a78ae64` … `38ac3d9` (joined channels, translated, AI-screened, blue diamonds, own video frame).
- Layout: panels slide, timeline pushes panels, notifications centred — `3b64b8d`; time labels and live
  notifications — `0d74ddd`; facility logos rejected — `88b4f74`.
- Notifications in words (country names, low/elevated/high/severe, squawk/FL decoded, dedupe, fusions name
  what agrees and only 3+ kinds of evidence interrupt) — `999c67c`.
- Fusions positioned on the observation, not a GPS-jamming cell centre; named by country/waters — `a4a5bc8`.

Imagery as it stands: passes are acquisitions (dedupe by sensor ±15 min); optical AND radar every pass
(radar ships kept only on water via an S2 NDWI mask); Esri sub-metre "sharp reference" with capture date;
any S2 date to compare; swipe/split/fade/blink; scene on the Situation map with a Cesium split swipe; per-area
"what matters here" (zone_context.py) feeding the imagery note (scene_note.py); 4 images kept per sensor;
draw/redraw areas on the map. Real resolution is 10 m (shown at 5 m, bicubic) — the sharp reference is the
sub-metre view; super-resolution was tried and removed 2026-09-20.

Done 2026-10-06 afternoon (local commits b3efa5c, 0ea2a70, 7fde09c):
- B/C/D: imagery signals on the map (own layer, pin hides up close); Heat / Imagery signals / Satellite
  base image are separate switches; heat_watch.py — new heat near watched areas, military sites,
  airports, or strong (≥30 MW), grouped per 15 km — notifies with Investigate / Scan buttons;
  automatic FIRE-… area creation off (FIRMS_AUTO_AOI=1 restores). Notifications never depended on
  layer switches; heat and imagery signals now always notify.
- E: fusions rebuilt (alerts_derived.py): an event (confirmation, report, Telegram, imagery signal,
  heat) and what corroborates it within 30 km / 48 h; tracking only within 10 km / 6 h; explained in
  words; 30 km mark on the map. Imagery feeds fusions as signals, not raw detections.
- "Watch with satellites" from any alert in the Inspector; map swipe handle spans the image only.
- Sanctions: name-only matches need the MMSI flag to agree — 5,485 namesake alerts retired.
- Wispr (K): voice bar works (filter verified by simulated dictation); navigation now falls back to
  the geocoder ("go to Hormuz" → the strait).

Still open, in order:
A. ~~Talk with the owner about what counts as an imagery signal and how~~ — done, imagery_signals.py.
A0. (was A) — before building imagery
   signals. When built, opening one on the map loads the image with its detections.
B. Layers: heat (FIRMS) toggle independent of the satellite overlay; an imagery-signals toggle that
   does not pull the full image overlay.
C. FIRMS heat inside areas of interest → notification asking "Investigate? / Scan?".
D. Notifications fire for new alerts even when the layer is toggled off.
E. Detection stability (same pass, different tile cut: 38 vs 15 tanks) and the fusion engine's rules
   (2.5° cell × 60 h co-occurrence is too loose).
F. Localizer workbench: place suggestions (country-restricted, OCR, satellite compare), shadow
   chronolocation (solarPosition.js), vehicle direction.
G. Asset registry; per-user profile (Blocker below). Telegram roles for newly joined channels
   (Middle_East_Spectator, InfosAes, liil050, sh_almoqawamma).
H. GDELT judge (gpt-4o-mini) still admits a few protests/crime as "violent unrest".
I. **Enhance the generated briefings** (owner, 2026-10-06).
M. **Long-term media storage on the server** (owner, 2026-10-06): Telegram videos (and later imagery
   archives) kept server-side, not on the laptop; locally they are a 30-minute temp cache only.
K. **Check the Wispr integration** (owner, 2026-10-06).
L. (LAST priority, owner 2026-10-06) Open sub-metre radar archives as a comparison layer: Umbra open data
   (Jebel Ali 33 passes Dec 2024–Jul 2025, Jeddah 13, Red Sea coast 21; archive ends Aug 2025) and Capella
   (Bandar Abbas, Bahrain, Kuwait, Muscat, Doha, Djibouti, Aden … ~1 image each). Also: check Sentinel-1
   ship detections against Umbra at Jebel Ali. Catalogues: s3.us-west-2.amazonaws.com/umbra-open-data-catalog/stac,
   capella-open-data.s3.us-west-2.amazonaws.com/stac.
J. Imagery signals are built (imagery_signals.py, by area kind); smoke plumes and active fires are in
   (smoke.py, found the Khurais plume 5 Oct); still missing: the map-layer separation in B. Multi-image super-resolution was TESTED and REJECTED
   (2026-10-06, storage tanks vs the sub-metre reference, Khor Fakkan + Jebel Ali):
   - AllenAI Satlas 8-image ESRGAN (4×): crisp tanks but invents texture (sea turned to olive
     "forest", desert to scrub — trained on US NAIP); detection collapsed to 0 confirmed tanks.
   - Registered shift-and-add (phase correlation, 2×): faithful, ±noise vs one pass.
   - Sub-pixel registration of the existing stack: passes already within 0.5–1 px at 5 m; ±noise.
   What stays: Sentinel Hub bicubic 5 m + mean of six clear passes for fixed objects (recall 0.54
   at Jebel Ali). Real resolution needs a sharper sensor (commercial: Planet, SkySat, Umbra/Capella SAR).

### Detection models (not in git — `backend/models/` is ignored)
The scanner runs `yolov8m-obb.onnx` (backend/, already present) and `backend/models/yolo26x-obb.onnx`.
Recreate the second with:
`python -c "from ultralytics import YOLO; YOLO('yolo26x-obb.pt').export(format='onnx', imgsz=1024, opset=17, simplify=True, end2end=False)"`
then move the .onnx into `backend/models/`. **end2end=False matters**: the default end-to-end head fails
on CoreML and takes 8 min a scene on CPU; the classic head runs at ~0.2 s a tile. Without the file the
ensemble falls back to one model and marks everything "probable".
Measured (storage tanks vs the sub-metre reference, 2026-10-06): both models agreeing = precision
0.90–1.00; v8m alone finds most but invents aircraft; YOLO11x was no better than v8m.

### Seen but not fixed
- Intermittent page error "the server did not respond within 30s" during
  browser probes, independent of the screen being tested.
- A Yemen signal headlined "fighting around Taiz" is geocoded to Lahj.
- A military aircraft (MAE4329) showed type "PC-21" from hexdb with a photo of
  a different airframe — route/type lookup and photo lookup disagree.
- `src/lib/ref.test.js` calls the live backend and fails whenever it is busy
  (e.g. right after a restart or under probe load) — not a code fault.
- Home theater cards read `THEATER_SCOPE` (the three seeded theaters), so a
  user-created theater does not appear there yet.

### Blocker for (7)

`focusRegions` currently only flies the camera — it filters nothing.
`_ACTIVE_PROFILE` in `main.py` is a **single global `profile.json` for the
whole server**, not per-user, and it feeds signal scoring for everyone.
Two routes: make the profile per-user end to end (correct, touches scoring
for all users), or filter/re-rank per user at read time (additive, safe,
ships quickly). Recommendation: the second first.

## Testing

- Frontend: `npx vitest run` — 1521 passing (2026-10-05 evening).
- Backend: `python3 -m pytest test_*.py` — the new ones are
  `test_airlines.py`, `test_country_from_location.py`, `test_outlook.py`,
  `test_enrich_resolution.py`, `test_surface_dedupe.py`,
  `test_fusion_unlocated.py`, `test_overpass_breaker.py`, `test_llm_budget.py`,
  `test_scenario_reader.py`, `test_situation_place.py`, and since:
  `test_chokepoint_flow.py`, `test_mmsi_lookup.py`, `test_vessel_owner.py`,
  `test_track_detail.py`. 4 `test_sync_cursor.py` tests fail on HEAD and
  before this session's work.
- Local probe logins (local DB only): `localshot@test.local` and
  `localshot2@test.local`, password `localshot-pw`.
- Probe scripts `_*.mjs` and `_settled.sh` are gitignored and throwaway.
