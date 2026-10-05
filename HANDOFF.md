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

### Seen but not fixed
- A Yemen signal headlined "fighting around Taiz" is geocoded to Lahj.
- **Vessel reference photos are wrong.** The Wikimedia lookup matches any
  Commons file by ship name: "PACITA" shows a Philippine supermarket, "SAMPLE"
  a soil sample in a cup. Match on the IMO number (Commons has "IMO 9275103"
  categories) or show nothing.
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

- Frontend: `npx vitest run` — 1472 passing.
- Backend: `python3 -m pytest test_*.py` — the new ones are
  `test_airlines.py`, `test_country_from_location.py`, `test_outlook.py`,
  `test_enrich_resolution.py`, `test_surface_dedupe.py`,
  `test_fusion_unlocated.py`, `test_overpass_breaker.py`, `test_llm_budget.py`,
  `test_scenario_reader.py`, `test_situation_place.py`.
- Probe scripts `_*.mjs` and `_settled.sh` are gitignored and throwaway.
