# Handoff — 2026-10-18

Written for the next session (an engineer or a Claude agent) so it can carry on
without re-reading the long chat of 2026-10-13 → 18. Checked against the repo
on 2026-10-18. Older sections below still hold where this one doesn't override them.

## Live incidents (2026-10-22, branch worktree-agent-a37bebda413eb0f6e, not pushed)

`backend/live_incident.py` is the strict extractor that decides whether a Telegram post is a LIVE pinned
signal (the owner's spec, kept verbatim as `SPEC`). The model extracts (quotes for time and place, the place
as written, its level); the code decides: quotes verbatim in the text, place and context in the text, event
time inside 60 min of the post and of now, only the quoted place plus quoted context geocoded, the answer at
the stated level, homonyms rejected unless one clearly leads (Nominatim importance gap 0.25), a street or venue
must lie within 40 km of the city the text puts it in. The model's whole answer and the verdict are stored
(`telegram_posts.live_json`, `live_verdict`, `event_time`, `live_hash`, `live_cost`); "live" is derived on read
(`live_incident.live_fields`, `src/lib/liveIncident.js`). Model out: `classify_by_rules` pins only a place the
text names in a country the text names, with a present-tense cue, no earlier-time cue, a post under 60 min old.
- Needs, in production: `live_incident` in `HW_OPENAI_PURPOSES` (an explicit list today, so it is OFF until
  added; `/api/telegram/status` > `live_incident.gate_closed_because` says so) and a higher `OPENAI_BUDGET_USD`
  (11 today; the extractor is about $0.5-1.2 a day).
- Env: `LIVE_INCIDENT_MODEL` (gpt-4.1-mini), `_PER_HOUR` 200, `_PER_DAY` 2000, `_PER_PASS` 24, `_ENABLED`,
  `_COARSER_FALLBACK=1` (a street or venue the geocoder cannot find is pinned at the city the text names,
  labelled city-level; off by default), `_DOMINANCE_GAP`.
- Evaluation: `backend/eval_live_incident.py` over `backend/data/live_incident_fixtures.json` (57 labelled posts,
  6 languages); `EVAL_REUSE=<earlier result>` re-decides without model cost.
- Seen, not fixed: GeoConfirmed items in the General feed read "just now" for events weeks old (ingest time);
  calls to gather still resolve their place through the chat's region (telegram_signals._resolve).

## Where things stand

- `main` = `origin/main` = **`16b7d52`**, pushed; Railway deploys on push.
  Nothing uncommitted except `backend/test_sanctions_loader.py`, which isn't ours: leave it.
- **DMG v1.1.25** built successfully (2026-10-18 09:35 UTC). Next one: **≥ 1.1.26**
  (`gh workflow run desktop-dmg.yml -f version=1.1.26`).
- Push and DMG **only when the owner asks, each time**. The log is in memory
  `feedback_no_railway_no_dmg.md`. A push can hang at the macOS keychain, so push with:
  `git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin main`.
- Local: backend on :8000 (from `backend/`:
  `~/.pyenv/versions/3.12.7/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000`),
  vite on :5173 (`npx vite --port 5173 --host 127.0.0.1`). Both were started from the
  last session and may be gone: restart them. Login: `localshot@test.local` / `localshot-pw`.
- **The local DB has no Telegram posts after 2026-10-07**: Telegram runs on the
  server only. Anything Telegram-driven can only be judged on production data.
  **Never start a Telegram client locally**: a second client on the session kills the live ingest.
- Disk was full on 2026-10-17 (285 MB free). It now has about 11 GB. Don't leave `dist/`
  in worktrees; remove finished worktrees (`git worktree remove`).
- Tests: `npx vitest run` passes 2,046 tests. `src/lib/ref.test.js` needs the live backend and
  fails if run while it is still starting. Backend: run the suites you touch.
  About 28 older tests need the real DB and fail anywhere.

## THE URGENT NEXT TASK: crowd-tracking accuracy (owner, 2026-10-18)

The owner's words: "only work on the crowd tracking accuracy. Push that to DMG
and Railway. That's the only urgency right now." Earlier: "crowds with their last
known place and age, their paths, walking routes … make sure that is precise and
good. We have the roads, we have the routes."

**No code was changed for this yet.** It was analysed, with this plan, when the
session ended. Code: `backend/demo_situation.py` (model, scoring, routing),
`backend/demonstrations.py` (`link_tracks`, reports),
`src/globe/demoSituation.js` (shared drawing), `GlobeDemonstrationsLayer.jsx`,
and `src/mobile/mapLayers.js` key `demonstrations:situation`.
Endpoints: `/api/routes/demonstrations/situation` and `/now`.

Where precision is lost today, and the fix for each:
1. **Places resolve only from a ~40-entry gazetteer** (`GAZETTEER`, mostly Paris landmarks).
   - **The gap:** a street-level report ("rue de Rivoli", "pont Alexandre III",
     "boulevard Saint-Germain", "métro X") is dropped unless the place was learned from
     endangered places or geocoded posts.
   - **Fix:** in `resolve_place`, when nothing matches and the phrase has a street word
     (rue, avenue, boulevard, place, pont, quai, porte, gare, métro/station, square, parc,
     esplanade, carrefour, rond-point…), use `geocode_utils.geocode_place(phrase,
     ["fr"], bounds=<city box from CITY_CENTRES>)`.
   - **That geocoder is Nominatim:** 1 request/s, sync, cached in memory and on disk for 30 days.
     Don't call it inline. Serve cache hits only, queue misses to one background thread, and
     the next 30 s pass picks them up.
   - **Accept a hit only if** it lies within `CITY_RADIUS_M` of the city centre.
2. **Crowd paths are straight lines between reports** (`build_crowds` → `path`).
   - **Fix:** route each hop longer than ~150 m with the OSRM foot profile, using
     `sr.osrm` with the same `_spawn` / `_route_key` / `sr._cache_get` budget pattern as
     the convergence routes (`NEW_REQUESTS_PER_PASS`, `PLANNER_BUSY_S`: never delay
     someone's "Get me out" route).
   - Fall back to the straight line, marked "estimated", until the route is cached.
3. **No estimate of where the crowd is now.**
   - **Fix:** if a crowd has `heading_to` (or its top convergence route), advance it along that
     route at `CROWD_KMH` for its age, capped at the destination. Return
     `now_est: {lat, lon, basis}` and a `reach_m` radius (age × speed, capped).
   - **Draw it:** a dashed "probably here now" mark, with the last-seen point kept and labelled
     "last seen 14:05 · 12 min ago".
   - **Ground-sized circles:** the owner hates rings that swell with zoom (the alert-ring
     fix of 2026-10-17). If the reach is drawn as a ground circle, keep it faint, and
     consider hiding it below about zoom 12.
4. **Check also:**
   - `MERGE_M` / `MERGE_MIN` (crowd merging) and `link_tracks`'s 6 km/h + 1.5 km slack.
   - That self-reported positions ("on est à Concorde") outrank second-hand reports.
   - That the age shown is time since the last report, not since ingest.
5. **Tests:** fixtures in `backend/test_demo_situation.py` (39 tests, plus one added 2026-10-18).
   Add tests for:
   - street geocoding with a stubbed geocoder
   - routed paths with a stubbed `_cache_get`
   - the "now" estimate
6. **Then:** build, browser-check on the phone (mock `/api/routes/demonstrations/situation`
   with `ctx.route`, since the local DB has no live crowds), commit, push, and build
   DMG ≥ 1.1.26, as asked.

## What was built 2026-10-14 → 18 (29 commits, `37721d8..16b7d52`, all pushed)

**Phone, after Benji Taylor's rules** (`src/mobile/`, memory `project_phone_benji_redesign.md`):
- **Look:** monochrome words and buttons, colour only in icons, glass over the map.
  Tokens are in the "PHONE v4 / v4.1" blocks at the end of `m2.css`.
- **Moving around:**
  - the header and tab bar hide on scroll (`MobileApp.jsx`, `data-chrome`; a screen can force
    it with the event `m2:chrome`)
  - screens slide in from their tab's side
  - one marker glides between the tabs
- **Gestures:** shared in `gesture.js` (`attachDrag`, which uses native non-passive touch,
  and `attachPullToRefresh`).
- **The map card** (`screens/MPeek.jsx`):
  - swipe left or right through the points in view, up for details, down to close
  - the map moving closes it
  - the details sheet grows out of the card and shrinks back into it by clipping
    (`common.jsx` `Sheet` `fromPeek`, `peekShape`/`morph`), so the text keeps its size
  - one guarded close ends the open/close races
- **Notifications:** a signal with a place opens the map at it with the card; one without a
  place opens Alerts on that row. Only urgent ones (critical, warning, live) show as toasts
  that fade.
- **Map performance:** markers are kept between draws by key and signature, and event
  points cluster until zoom 11 (`MMap.jsx` `CLUSTER_LAYERS`). Icons are 1.2× larger.
- **Other phone features:**
  - pull to refresh on the Desk and Home; a hard pull on Home slides it away to the map
  - a centre-on-me button
  - the "Get me out" route planner is a tray over the main map (`routes/RoutePanel.jsx`;
    the route is drawn in `MMap.jsx`)
  - a Mood screen (`screens/MMood.jsx`)
  - "What may follow" shows its reasoning (`insight/OutlookExplain.jsx`, also a dialog on
    desktop Home)
  - For You takes every source
  - a theatre filter shared across Home, Desk and Alerts (`mobile/theaterScope.js`)
  - Live from Telegram swipes
  - the newest items always show: the General feed puts new items straight on top every 20 s
    and on return to the app, and every list reloads on `visibilitychange`
- **Messages:** WhatsApp-style chats with typing dots (`POST/GET
  /api/chat/conversations/{id}/typing`, in memory, 6 s). Full-screen media viewer:
  `mobile/MediaViewer.jsx`.

**Desktop:**
- The design pass (`src/styles/desktopV4.css` under `:root[data-shell="desk"]`,
  `src/ui/travelMark.js`, `useSwap.js`, `usePresence.js`).
- Alert marks stay a fixed size on screen (pixel rings, not ground ellipses).

**Map and intelligence:**
- **Troop movements followed over days, and sieges** (`backend/frontline_claims.py`): a path
  links stops ≤4 days apart and ≤15 km + 15 km/day apart, capped at 60 km. Sieges get
  converging arrows; directions over the sea are dropped. Mountains are not read.
- **Live demonstrations** (`demonstrations.py`, `demo_situation.py`): crowds, routes to
  places named in calls, and estimated meeting points labelled "est. N%". Not yet seen on
  real crowds.
- **Telegram ingestion** (`backend/telegram_ingest.py`, new `telegram_signals.py`):
  - **Groups:** now reads groups and forum supergroups, keeping topic titles; it had only read
    channels before. The gilets jaunes groups were added to `telegram_channels.json`.
    "Le Grand Café" couldn't be found and is probably private: the account must join it.
  - **Calls and positions:** stored in the `telegram_intents` table (act, target, time,
    `immediate`, self-reported positions).
  - **Merging:** related messages merge into one signal when read.
  - **Polling:** every 15 s while a chat is active, otherwise every 60 s.
  - **Without the model (2026-10-19):** the OpenAI credit ran out on 2026-10-18 and 0 posts
    became signals for two days. `openai_gate` now pauses 15 min after an
    `insufficient_quota` answer, and `telegram_rules.py` reads the last 6 h by rule (event
    words in en/fr/es/ar/uk/ru/he, a place after a place word, placed only on a settlement
    in the named country). `read_by` says who read a post; rule readings are re-read by the
    model when it is back. Calls to violence are also raised from their words
    (`telegram_mood_alert.is_violence_call_by_rule`).
  - **Private chats (2026-10-19):** one-to-one chats (`u/<id>`, kind `private`) and legacy
    groups (`g/<id>`) are read like groups; never bots, the account itself or Telegram's
    777000. `TELEGRAM_READ_PRIVATE=0` turns it off; `role: ignore` still skips a chat.
  - **Pictures (2026-10-19, `telegram_vision.py`):** photos and three video frames go to
    `gpt-4.1-mini` (`TG_VISION_MODEL`); the model describes, code decides (`decide()`), and
    a picture can make a post a signal on its own. Caps: `TG_VISION_PER_HOUR` 15,
    `TG_VISION_PER_DAY` 200, `TG_VISION_USD_DAY` 0.25, 4 videos an hour; one reading per
    picture hash; own one-thread pool. Status: `GET /api/telegram/status` → `vision`,
    `model`, `read_24h`. Signals carry `video_url` / `photo_url` / `media_url` and `vision`.
- **Mood:**
  - per country/city tension trend and a Low/Elevated/High chance of demonstrations in 48 h
    (`telegram_unrest.py`)
  - **every single call to violence is its own alert** (`telegram_mood_alert.py`
    `detect_calls`, type "Telegram mood: call to violence"; it needs violent wording as well
    as the model's rating)
  - the check runs every 10 min
  - spikes and calls appear on the Desk, as notifications, and on both maps
    ("Mood & calls to violence", `src/globe/telegramMood.js`)
- **Imagery** (`smoke_classify.py`, `imagery_verdict.py`):
  - **Smoke needs a source** (FIRMS or a verified hot pixel). New checks reject clouds,
    shadows, snow, haze and glint.
  - **Stored detections are re-judged** on read: smoke plumes went from 14 to 3.
  - **Caps on findings were removed.** Cost guards on paid Copernicus usage stay.
- **`/api/alerts?source=…`** uses the source index: 7.5 s → 1 s.

## Still to do (owner's list, most important first)

1. **Crowd tracking accuracy**: above. Urgent; push and build the DMG after.
2. **"What may follow" is broken on desktop and phone.**
   - **Locally:** the outlook (`routers/enrichment.py` `refresh_outlook`,
     `outlook.py` `validate`) was last built 32 h ago and **all statements were dropped**: 3
     cited signals that weren't in its input, 3 with no citation.
   - **To check on production:** whether `_outlook_refresh_loop` runs in the right process,
     and whether every statement is dropped there too.
   - **The owner also wants:** past forecasts **scored** (there are routes `/api/enrich/outlook/forecasts`,
     `/outlook/due` and `/outlook/forecasts/{fid}/resolve`, but nothing resolves them yet),
     what is learned fed back in, and statements made "more creative and more specific".
     Memory `feedback_forecasts_must_be_falsifiable.md`: actor + place + act, cited, with a
     criterion and a date.
3. **Desktop motion:** the grow-and-shrink animations and the rest of the new design, on the
   desktop as on the phone. The desktop pass so far is light. Inline red/amber text remains
   (Inspector "ESCALATING" and others), and rail icons keep their colours: the owner chose
   them on 2026-10-05; ask before greying them.
4. **Mood in the country risk index** (owner: "not urgent").
5. **Imagery is paused**: both Copernicus accounts are out of processing units, and scans
   have failed with 403 since 13 Oct. The owner will refill them. The imagery-signal layer
   reads only SAT-TASK alerts, so OVERWATCH radar-change and sweep findings never show
   there (an easy fix).

## Check on the server after this deploy

- **Telegram yield (2026-10-19):** `/api/telegram/status` → `read_24h` should show `rule`
  posts with `placed` > 0 while the credit is out (`model.credit_exhausted`), and
  `posts_24h_by_kind` a `private` count. Once the owner tops up: `vision.read_24h` signals,
  `vision.budget.usd_today` under 0.25, and `[tg-vision]` lines in the log.

- **Telegram groups:** are groups and forum topics arriving
  (`telegram_posts.chat_kind`, `telegram_topics`)? Did the gilets jaunes groups join? Any
  flood waits at 15 s polling? Is the skip-unchanged-chats logic missing chats?
- **The mood rater:** its limit of 75 posts a minute may now lag behind the group volume.
- **New alerts:** are "Telegram mood: call to violence" alerts appearing, and are they
  real calls?
- **The Desk feed:** is the newest General item minutes old, not hours?

## Owner rules worth knowing (in memory, repeated here)

- No typewriter or monospace fonts anywhere.
- On the phone, colour only in icons. Alert counts are red, the wordmark stripes blue,
  your location dot blue.
- Never push or build the DMG unless asked in that message.
- Verify locally in a browser before saying something works; build first, because the
  service worker serves `dist`.
- Don't stash while the backend runs (`risk_band_state.json` is rewritten live).

---

# Addendum — 2026-10-13, later session

- Committed locally (not pushed): `c23529d` (strikes chips in shared state,
  frontline-claims filtering), `dd43c94` (air_route knows FR/NO/XK),
  `581fdea` (evacuation plans answer within 30 s: 22 s budget abroad,
  shelter capped at 28 s).
- Jordan CZIB-2026-08-R2 checked on EASA 2026-10-13: still R2, valid until
  2026-10-16, no revision yet. Look again after the 16th.
- Three agents were left running, each told NOT to commit:
  A. strikes icons plus the frontline claims / movements / trajectories layers
     (desktop, phone, theater editor);
  B. smoke false-positive classifier (prod read-only, dry run only);
  C. phone: satellite image missing when a finding is opened from a notification.
  If the session ended before they reported, their work is uncommitted in the
  tree: run `git status`, build, test, and commit each piece separately.

---

# Handoff — 2026-10-13

Written for the next session (an engineer or a Claude agent) so it can carry on
without re-reading the long chat. Checked against the repo and production on
2026-10-13. The older handoffs below still hold wherever this section doesn't
override them.

## Where things stand

- `main` = `origin/main` = **`69c57fd`**. Railway service **Horizon-Watch**
  (project "magnificent-charm") deploys on every push:
  https://horizon-watch-production.up.railway.app. The web app is on Vercel
  (https://horizon-watch.vercel.app); the owner uses it on iPhone as a Home Screen
  app.
- Desktop app (Tauri DMG): **v1.1.20** is the latest release. The next one must
  be **≥ 1.1.21**:
  `gh workflow run desktop-dmg.yml -f version=1.1.21`.
  The DMG bundles the web build at build time, so desktop changes need a new DMG.
- Local: backend on :8000 (`cd backend && python -m uvicorn main:app --port 8000`),
  vite on :5173 (`npm run dev`). Test login: `localshot@test.local` /
  `localshot-pw`.
- Tests:
  - vitest: about 1,925 passing. `src/lib/ref.test.js` hits the live :8000 backend
    and times out when it's busy; it's flaky, not a regression.
  - pytest: the targeted suites pass. `test_ucdp_history.py` needs network.
- **Never commit**: `backend/data/risk_band_state.json`,
  `backend/data/cable_details.json`, `backend/test_sanctions_loader.py`,
  `backend/data/overwatch_osm_ukraine.json`.

## Standing rules (also in the auto-memory, MEMORY.md)

- **Pushes and DMGs:** push (= deploy) or build a DMG only when the owner asks. In
  this session the owner repeatedly said "push" and "push everything incl. DMG",
  but each occasion is separate: ask again if unsure.
- **Production is read-only to us:** `railway logs -s Horizon-Watch -n 3000`, and
  `railway ssh -s Horizon-Watch -- 'cd /app && python - <<"EOF" … EOF'` with
  sqlite `file:$DATA_DIR/akili.db?mode=ro`. Never write to the prod DB without
  the owner's OK.
- **Notifications:** the phone gets exactly what the desktop gets. One server
  rule, `event_watch.notifies` / `INTERRUPT_KINDS`, mirrored in
  `src/state/notificationStore.js interrupts()`. Any new kind goes in both;
  `test_telegram_events.py` checks they match.
- **GDELT is only for the country risk index.** It isn't on the map, in the
  feeds, in the inbox, in notifications or in fusion (`GDELT_IN_FUSION=1`
  re-enables fusion).
- **Fonts:** no typewriter or monospace fonts anywhere; `--mono` is the system
  sans.
- **Confirmations:** use our own dialog, `src/ui/confirm.js confirmAction()`.
  `window.confirm` shows nothing in the Tauri desktop app.
- **Model use:** OpenAI only through `backend/openai_gate.py`, with purposes
  enabled in `HW_OPENAI_PURPOSES` (the prod list includes `enrich`). Claude is
  for briefings only.
- **Outgoing requests:** never put the owner's email in User-Agents or other
  outbound requests; use
  `HorizonWatch/… (+https://github.com/ZaphodBeblerbox/Horizon-Watch)`.
- **No media on the laptop** beyond short-lived caches; the server keeps media.
- **Phone map tiles:** Esri (server.) → Esri through our server
  (`/api/tiles/esri/*`, needed because the owner's iPhone can't reach
  arcgisonline) → Esri services. → OSM. CARTO needs a key. Check what a tile
  shows, not just that it loaded.
- **Agents:** work is usually split across background agents. They hit usage
  limits often. Resume them, check `git status`, and commit only when the whole
  tree builds and the tests pass.

## Done in this session (2026-10-10 → 13), all pushed

- **Phone map:** every desktop layer with the same icons; Filters; Save as
  default; the tile fallback chain; live-person labels ("live" or "last seen"
  only).
- **Notifications:**
  - One rule for phone and desktop, so they get the same notifications.
  - Titles say the kind of notification; the headline is in the body.
  - No push to a device that has the app open; in-app banners instead.
  - A list of devices receiving notifications, each switchable.
  - A tap opens the map at the signal with the signal drawn on it, plus a half
    sheet (desktop: the inspector).
- **Live location:**
  - The phone sends every 10 m (at most every 3 s), with a 30 s heartbeat.
  - The server pushes positions to viewers in real time (SSE, stream tokens,
    polling fallback).
  - Gliding markers, tracks with replay, 30 days of history.
  - Approximate city-level fallback; the desktop's IP fix never overrides the
    phone's GPS.
  - Only your team or company, or people linked to your assets, show as live.
  - Limit: an iPhone web app can't send location in the background.
- **Assets:**
  - Link a person to an asset, so the asset follows their phone.
  - Send warning: a red takeover with an alarm until acknowledged; the sender
    sees the acknowledgement; resent every 2 min.
  - Remove an asset (owner or admin).
  - Safe houses: their own kind, or any building declared one; 3D model, map
    layer and filter.
  - Advise evacuation: the alarm plus the safest route to the best safe house,
    with multi-leg itineraries abroad (drive / fly / border).
- **Routes:** `backend/safe_route.py` and `src/routes/RoutePanel.jsx` with mode
  and provider registries.
  - Safest vs fastest on foot, by car and by truck.
  - Shipping (`sea_route.py`, `searoute`, `sea_hazards.json`).
  - Flights (`air_route.py`, `air_hazards.json` with EASA CZIBs).
- **Endangered places:**
  - France (the gilets jaunes 17 Oct site, the Framacarte arms map) and DE, IT,
    UK, BE, ES sources.
  - Country chips and an "Active only" filter (a call, or one within 2 km).
  - Generic 3D models (33 types) turning in the sidebar, never on the map.
  - Listed under Infrastructure; available in the theater editor.
- **Imagery:**
  - Radar works in prod (libexpat and OpenCV via Railpack, plus a tifffile
    fallback).
  - Overwatch zones by voice or button, grouped and confirmed before scanning;
    the border sweep; radar change every 6 days.
  - Finding boxes everywhere; the image under the boxes on the map.
  - Imagery opens a finding on its image (After / Before / swipe / Change).
  - "Assess with AI" (gpt-4o-mini through openai_gate "enrich", on click only).
  - "Generate a watch area around <place>" by voice.
  - Delete zones and areas.
- **Other:**
  - Vessel of concern: Russia link + loitering + targets in Shahed range, based on
    the research in `docs/research/russia_hybrid_targeting.md`; live view,
    rings, simulated drone flight.
  - Telegram mood alert; GeoConfirmed with native X media in the General desk;
    event clustering ("+N reports").
  - Aircraft and ship photos with flags.
  - Theater ✕ deletes after a confirmation.
  - Phone profile picture and header editor.
  - The X logo stripes; the Home Screen icon fix.

## In progress — partial code is committed (`0efad19`); finish these first

The agents stopped on usage limits. Their code builds and passes the tests, but
the features are incomplete.

1. **Strikes & control layer** (air campaign)
   - Files: `backend/strike_events.py` (`events(since, bbox, acts)` with act,
     actor, actor_side, target, precision, unit_type, origin_hint),
     `backend/routers/strikes.py`, `src/globe/GlobeStrikesLayer.jsx`,
     `src/globe/strikes.js`, `src/inspector/StrikeEventDetail.jsx`.
   - It stopped while wiring `Situation.jsx`.
   - Remaining:
     - **action icons**, one per act, in the same style as the asset icons: bomb
       (airstrike), missile, drone, artillery shell, ship, assault, flag (control
       change), shield (interception). The owner insists on this;
     - colour per actor; fading with age (14 days for strikes, 30 for control
       changes);
     - campaigns and timeline replay;
     - layer toggles (desktop, phone, theater editor);
     - tests and screenshots.
2. **Frontline claims, NATO symbols and trajectories**
   - Files: `backend/frontline_claims.py`, `backend/routers/frontline_claims.py`,
     `backend/test_frontline_claims.py`.
   - It stopped right after reading the strike_events contract.
   - Remaining:
     - a claimed-capture overlay ("CLAIMED, unverified"), confirmed against
       DeepState or expired after 7 days;
     - troop-movement arrows with NATO APP-6 symbols (the `milsymbol` npm
       package);
     - drone and missile trajectories from an assumed origin (Russian-held front;
       northern Yemen for the Houthis → Riyadh), with the animated Shahed/Geran.
       Reuse `src/globe/vesselThreat.js` and `GlobeVesselThreatLayer.jsx`.
       Ballistic missiles get a high arc, cruise missiles a low arc;
     - layers "Frontline claims", "Movements" and "Trajectories";
     - routing a notification tap to this view.
3. **Smoke plume false positives** (urgent for the owner)
   - Files: `backend/smoke_classify.py`, `src/components/imagery/DetectionFeedback.jsx`,
     `src/components/imagery/DetectionLegend.jsx`, edits in `backend/s2_bands.py`.
   - Remaining:
     - build a labelled set from prod's smoke detections (fields, runways and
       cloud shadows flagged as smoke);
     - classify on:
       - spectra: smoke raises blue/aerosol and is semi-transparent; dark fields
         are darker in every band;
       - the Sentinel-2 SCL cloud / shadow / dark-area classes;
       - **temporal persistence:** anything present in two or more earlier clear
         passes is not smoke;
       - plume shape and its hot source (B11/B12 SWIR, FIRMS);
       - OSM and WorldCover context;
     - distinct classes: smoke plume, burn scar / impact point, runway, port
       infrastructure, tanks, aircraft, ships;
     - feedback buttons and `tools/train_detection_classifier.py`;
     - a dry-run re-evaluation of existing detections. Don't apply it to prod
       without the owner.

## Open issues to fix next (the owner flagged these as important)

- **Phone: satellite images don't load on the map** when a finding is opened from
  a notification; the desktop works. Look at `src/lib/findingOverlay.js`,
  `src/mobile/findingsLeaflet.js`, the cross-site auth on the image fetch, and the
  Leaflet imageOverlay pane/z-order. The owner wants a notification tap to lead
  straight to the image, the precise signal and the detections.
- **"Missing ship" at the Ukrainian naval base:** the image and detection weren't
  on the map. Show where the ship was (the before image with its detection box)
  and that it's gone now (after). That needs a vessel-detection diff between
  passes, drawn on the map and in Imagery.
- **Production accounts JC and Lison Marchand** have no team or company, so under
  the new rule they see nobody live. The owner hasn't answered whether to set
  company = "Trifecta Technologies" (that's a prod DB write).
- **`air_route.py`:** `geo/countries.geojson` lacks ISO codes for France, Norway
  and Kosovo. It's fixed in `evacuation.py` only.
- **Cross-border evacuation planning** takes 30–50 s, over the client's 30 s
  limit. Add a server time budget.
- **Check** that deleting active watch zones works in DMG 1.1.20. It needed our own
  confirm dialog, and no DELETE requests had ever reached prod.
- **Hazard files need manual upkeep:** `air_hazards.json` (EASA CZIBs; Jordan
  expires 2026-10-16) and `sea_hazards.json` (verify the incident examples).
- **Public routing services** (FOSSGIS Valhalla/OSRM) are light-use only. If use
  grows, self-host.

## Requested but not started

- **More route modes, on the existing route core:**
  - trip planning for staff (pre-trip route and time, alert on deviation);
  - evacuation plans per site, refreshed daily;
  - convoy routing; medevac to the nearest reachable hospital;
  - trucks around blockades (truck mode exists; needs a dedicated flow);
  - likely approach paths to sites (defence).
- **Endangered places for all countries:** GDELT protest events as "calls
  nearby", plus a worldwide Mobilizon/Gancio/Demosphere calendar search. Offered
  to the owner; not yet confirmed.
- **A native iOS app** (Capacitor) for background location and Critical Alerts.
  It needs an Apple Developer account and Team ID from the owner; planned for
  later. Estimate: about a week of work, TestFlight within days, the App Store in
  2–4 weeks.
- **AI image enhancement:** parked (see memory).

---

# Handoff — 2026-10-09

Written for the next session, whether an engineer or an agent. Everything
here was checked against the live system on 2026-10-09. The 2026-10-05
handoff further down is still valid wherever this section doesn't
override it. Its gotchas especially still apply.

## Where things stand

- `main` = `origin/main` = **`7df2333`**. Railway (Horizon-Watch, project
  "magnificent-charm") runs it and is healthy:
  https://horizon-watch-production.up.railway.app
- Desktop: **v1.1.6** is published, signed, with auto-update. The next
  release must be **≥ 1.1.7**. `src-tauri/tauri.conf.json` still says 1.1.2;
  that's fine, because the workflow stamps the version.
- Telegram runs on the server, signed in as the server's account. Posts
  are growing and the map shows 48 hours.
- Data and disk:
  - live DB `/app/data/akili.db`: ~42 GB on the Railway volume;
  - local DB: ~4.8 GB;
  - laptop free disk: ~6.3 GB.
- Tests: 1,528 vitest and 1,082 pytest passing.
- Untracked or modified files that must **not** be committed:
  `backend/data/risk_band_state.json`, `backend/data/cable_details.json`,
  `backend/test_sanctions_loader.py`.

## Standing rules from the owner (current)

- **Pushing and releases need an explicit request.** Commit locally only.
  Push to `origin/main` (which deploys Railway) or cut a DMG only when the
  owner asks for that specific push or release. They did so several times
  this session; each time was a separate approval.
- **Claude writes briefings and their decks, nothing else.** Every other
  model job goes to OpenAI through `openai_gate.py`.
- **No generic output and never "Unknown Location".** Forecasts must name an
  actor, a place, an act, a criterion and a date.
- **Don't paste `TELEGRAM_API_HASH`** into chat, commits or logs. Don't raise
  key rotation.
- **No media stored on the laptop** (temp files only, 30 minutes). The
  server keeps media long-term.
- **Data is per user** unless the user shares it: theaters, imagery scans,
  layers, settings. A user's first login gives them a clean sheet:
  - 0 theaters, no layers;
  - the "Welcome to the new Parallax" card and the walkthrough, once only.
- **Do NOT run `backend/reset_user_data.py --apply`** on live. The owner
  first asked for a global reset, then cancelled it ("no thats good"). The
  script stays as a dry-run tool.
- **Super admins are only** `marc.lunau@`, `jakob.hentschel@` and
  `hannes.kohnen@trifecta-technologies.com`. Users keep their companies.
- **Keep the profile picture and header** (owner, 2026-10-09).
- **Analytics page:** deliberately not rebuilt. The owner said "dont do
  analytics".
- **Locate** (footage geolocation) was removed on request. Don't rebuild it.
- Use they/them for people.

## How to run and operate

**Local**
- `./start.sh` starts the web process on :8000 and the worker
  (`PARALLAX_ROLE=worker`) on :8090, the same split as Railway.
  `process_role.py` decides which loops run where.
- The frontend is `npm run dev` on :5173.
  - The localhost page serves the service-worker-precached `dist`. Run
    `npm run build` before any browser check.
  - `vite build` passing is not a render check. Run `screensRender.test.jsx`.
- Probe logins: `localshot@test.local` and `localshot2@test.local`,
  password `localshot-pw`. Delete whatever probe data you create.
- Don't `git stash` while the backend runs: `risk_band_state.json` is
  rewritten live. Kill the old uvicorn before restarting.

**Diagnostics**
- `[loop-lag]` plus `loop_blame` show what blocked the event loop.
- `[slow-request]` comes from `slow_requests.py` and logs anything over 5 s.
- `kill -USR1 <pid>` dumps every thread's stack via faulthandler.

**Pushing**
- `git push` can hang at osxkeychain when the Mac is locked. Use:
  ```
  perl -e 'alarm 120; exec @ARGV' git -c credential.helper= \
    -c 'credential.helper=!gh auth git-credential' push origin main
  ```

**Desktop release**
- Command: `gh workflow run desktop-dmg.yml -f version=1.1.7`
- What it does:
  - builds `app,dmg`;
  - signs with the GitHub secret `TAURI_SIGNING_PRIVATE_KEY` (local copy:
    `~/.parallax-signing/parallax.key`);
  - publishes `latest.json`, `.tar.gz`, `.sig` and the DMG to the
    Horizon-Watch release. The installed app's updater reads
    `releases/latest/download/latest.json`.

**Railway**
- `railway variables --kv` lists the variables.
- `railway variable set K --stdin --skip-deploys` sets one without a deploy.
- `railway ssh -- sh -c '...'` runs a command on the server (stdin works).

**Telegram**
- The session lives on the volume: `DATA_DIR/telegram/parallax.session`.
- The laptop copy was moved to `backend/data/telegram/moved-to-server/`.
  **Never reuse it.** Two clients on one session get it revoked.
- To re-sign in: a super admin uses Settings › Feeds and health › Telegram
  (phone number, then the code, then the 2FA password if asked).
- Status: `GET /api/telegram/status`.

## What was done this session (16 commits, `3bad606` → `7df2333`)

**Situation reports (briefing engine, `backend/briefing/`)**
- Trifecta-style report in de, en and fr. Pipeline:
  spec → recipient profile → collect → research → write (Opus) → validate
  → render (PDF plus an interactive reader plus a pptx deck).
- The recipient's assets and their countries drive what is collected.
- A rehearsal writer runs the whole pipeline without a model.
- API: `/api/briefings2/*`. UI: Reports › Situation report.

**Server stability**
- Blocking work moved off the event loop: threat matrix, snapshot,
  sessions, GDACS, alert writes.
- Risk index: single-flight with stale-while-refresh.
- Replay timeline bounded (limit 4000, 2-minute cache). It used to pull
  34 MB.
- Slow-request log and faulthandler added.
- `PyMuPDF` and `matplotlib` added to requirements. Without them Railway
  would crash on import.

**Telegram**
- Full 48-hour pass every 30 minutes and on the first pass (previously
  only 6 hours were fetched).
- Text reports with a precise place are published; old drops are
  republished in batches.
- Channels without a username: stored `c/<id>`, addressed `-100<id>`.
- Video autoplay made robust: muted, then an explicit `play()`.
- Sign-in from Settings (server has no terminal).

**X posts in our own frame**
- GeoConfirmed's cited posts render natively: author, text, photos, video.
- Endpoints `GET /api/x/post/{id}` (cached a day) and `/api/x/video`
  (proxy; only video.twimg.com, Range passed on).
- Posts X marks sensitive open behind the same warning as Telegram.

**Per-user data and first login**
- Zones are owned and guarded; theaters are no longer seeded.
- First login writes `startupLayers: {clean: true}`.
- Walkthrough now covers Desk, Profile and Assets.

**More on the map**
- 48 h window, the new default.
- Surface pool 300 (`SURFACE_POOL_MAX`), fusions 200, judged GDELT points
  1,500.
- **Global** theater: a fixed first tab. Double-click it to choose what it
  shows (stored in settings `globalTheater`).

**Home and Insight**
- Most-urgent list: asset hits first, then the user's theaters and
  interests; refreshed every 30 s.
- Three Telegram videos from the three most breaking places for the user.
- The brief turns at 05, 12 and 18, with wording by part of day ("what
  happened overnight / this morning / this afternoon", "what today may
  bring", "how the forecast did"). Logic in `src/home/dayPart.js`.
- Insight › What happens next: "Yours" or "Everywhere", by the user's
  countries and assets.

**Mobile (v1.1)**
- Five tabs: Home, Map, Desk, Messages, More. Code in `src/mobile/`.
- Home: picture, header and greeting, urgent list, videos, brief.
- Map: Leaflet with Esri tiles, theaters, 24/48/72 h, severity floor,
  layers.
- More: Assets, Alerts, Reports, Profile.

**Settings persistence**
- A saved default layer set now wins at launch over the session restore.
  `applySession(…, {atLaunch})`.
- Settings that can't reach the server are queued on the device
  (`plx-settings-pending:<email>`) and sent later.
- The last server profile is kept per account (`plx-profile:<email>`), so
  an outage no longer loses the picture or layers.

## Open items, in priority order

1. **Situation reports can't be produced live yet.** Two blockers:
   - The Anthropic key returns **401**, probably revoked after the public
     leak. `llm.py` remembers a refusal for 15 minutes. Needs a new key in
     Railway `ANTHROPIC_API_KEY` (the owner's decision).
   - **The Railway server has no Node and no Chromium** (checked
     2026-10-09: `which node` → nothing, no Playwright browsers).
     `briefing/render.py:155` shells out to
     `node tools/render_pdf.mjs`, so the PDF step will fail there even with
     a valid key. Two fixes:
     - add Node and Playwright Chromium to the build. There is no
       Dockerfile; `railway.json` only sets the healthcheck, so a
       `nixpacks.toml` or Dockerfile is needed;
     - or render the PDF on the worker by another route.
     Verify with the rehearsal writer first; it needs no key.
2. **Startup contention in the web process.** For 2–3 minutes after boot,
   model training, link prediction and similar work make sync endpoints
   take minutes. Proposal: move that work to the worker and persist the
   results.
3. **Leaked keys in the public repo history.** Parked by the owner. Don't
   raise rotation unprompted.
4. **W: hybrid-warfare criticality.** The proposal is waiting on the owner.
5. **Y: an unexplained Indonesia link.** Lead: the first feature in
   `geo/countries.geojson` is Indonesia, so any fallback to `features[0]`
   produces it.
6. **Fusion titles that are only coordinates.** Fix at the source, where
   the title is made.
7. **Asset briefs sometimes give generic measures.**
8. **U: full desktop UI rework.** Needs the owner's direction first.
9. **Mobile follow-ups:**
   - no clustering on the map;
   - the map ignores the desktop default layers;
   - reports can be read on mobile but not generated.
10. **GDELT cache covers only ~2 days of history.**
11. Older list items, from the 2026-10-05 section below: entity traversal,
    online avatars, auto theme, detection stability, radar archives.

## New gotchas

- **The workspace session (auto-saved every minute) used to overwrite the
  saved default layers at launch.** Fixed with `atLaunch`. If default
  layers "don't apply" again, look there first.
- **Concurrent settings PATCHes drop keys.** Two at once lost `welcome`.
  Save sequentially.
- **CARTO tiles now need an API key.** The mobile map uses Esri.
- **Leaflet panes reach z-index 700.** The mobile map sits in an isolated
  stacking context so the sheets (900/901) stay on top.
- **The safety classifier blocks some actions without explicit owner
  approval:** production pushes, mass deletes, moving credentials. Ask the
  owner, then do it.
- **Red tests may be stale tests.** A test with fixed dates
  (`test_sync_cursor`) went red as the dates aged; it now uses relative
  dates. Check for that before suspecting the code.

---

# Earlier handoff — 2026-10-05

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

### Owner's list, 2026-10-06 night (in the order proposed)

N. **Asset register, back, with a proper UI** — the owner's own assets (vessels by MMSI/IMO, aircraft by
   ICAO, vehicles, factories, offices, ports, airports, power stations, people…). Per asset: which signals
   matter most, how events affect it, what could affect it next, what measures to take. NB the existing
   `assets` table (database.py `Asset`, 0 rows) is a sourced infrastructure catalogue, not "our assets" —
   decide whether to extend it or add an owned-assets table. Per-user profile blocker below still applies.
O. **3D illustrations of asset types**, high detail, slowly turning (vessel types, vehicles, aircraft,
   factory, office, people, port, airport, substation, power plant…). Approach to agree with the owner.
P. **Insight "what changed"** does not answer "what changed" — rework.
Q. **Generate and the interactive reader** — new UI in the current look.
R. **Crucible** — the owner asks what it does; decide keep/fold/remove.
S. ~~**Desk as a social feed**~~ — done `a9b2b52`: posts carry a signal, briefing, footage, image,
   place or asset; ✓ confirm with who; comments; filters; "Share to the desk" from reader, inspector, asset.
T. ~~**Prepare for server integration**~~ — done (no deploy): `backend/paths.py` (one DATA_DIR rule;
   user state moved out of the code dir; seed data in `backend/seed/`), JWT secret kept on the volume,
   `TELEGRAM_VIDEO_STORE=volume` for footage on the server, `deploy_check.py`, `.env.example`, `DEPLOY.md`.
U. Then **rework the whole frontend UI**. — **not started: needs the owner's direction** (what is wrong with
   the current look, which screens first). Assets, Insight, Generate/reader, Desk and Settings already have the new look.
W. **Hybrid warfare: criticality and dependency** (owner, 2026-10-07) — say reliably "this piece of infrastructure
   is at higher risk, these kinds of hybrid action are plausible, do these things". Needs: what depends on a piece of
   infrastructure (a substation next to an airport, rail hub, base or police station matters more than one in a
   field), what is SINGULAR (Wunstorf: Germany's only A400M cargo base; the one NATO-gauge rail link Germany–Poland;
   Rotterdam as the US forces' port of entry) — ingested as facts with sources and connected in the ontology; plus a
   hybrid-incident record (sabotage, arson, cable cuts, drones over sites, GPS jamming) to learn patterns from.
   First step taken: precedents (same kind of target attacked elsewhere in the country) feed the asset brief.
X. **GeoConfirmed media in the inspector**, as Telegram's: their records carry the source posts (x.com and t.me links
   in original_source). t.me links can play through the existing Telegram client; X needs a fetcher.
Y. **Open question:** the owner saw the Berlin test asset "located in Indonesia" in the ontology — not reproduced
   (the asset is not in the graph; its sidebar says Germany). Ask where it was seen.
V2. ~~Telegram: new channels + sensitive content~~ — done: 7 channels registered (2 read for announcements);
   announced gatherings → `/api/telegram/upcoming`, the surface and Home's "Today may bring"; graphic footage
   behind a warning. **Open question for the owner:** French unrest footage (police beatings, LBD) is still
   dropped by the 2026-10-05 rule "the map wants the front line, not civil unrest" — keep the rule or lift it?
V. Telegram video object detection — parked by the owner 2026-10-06 ("not for now").

Owner's decisions (2026-10-06): 3D models DRAWN IN CODE (three.js), as detailed as possible; Crucible
FOLDED INTO SETTINGS (fusion rules + pipeline → Feeds and health), off the rail; server = RAILWAY, prepare
only (local commits, no deploy — standing rule); order = audit fixes → N → P → Q → S → O → T → U.

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
F. REMOVED 2026-10-06 at the owner's request: the Locate workbench (frame → places, shadow time, heading) did not work for the owner and was taken out. Kept from it: geocode_utils.prefer_settlement (a town beats its province of the same name; Kidal posts were 167 km off) and solarPosition.sunPosition (azimuth).
G. Asset registry; per-user profile (Blocker below). Telegram roles for newly joined channels
   (Middle_East_Spectator, InfosAes, liil050, sh_almoqawamma).
H. DONE 2026-10-06: GDELT judge now reads act/force/actor/casualties; code keeps acts of force or force movements only (48 → 17 pins); one pin per event (place + act).
I. **Enhance the generated briefings** (owner, 2026-10-06).
M. **Long-term media storage on the server** (owner, 2026-10-06): Telegram videos (and later imagery
   archives) kept server-side, not on the laptop; locally they are a 30-minute temp cache only.
K. DONE 2026-10-06: Wispr checked — dictation into the voice bar works; navigation falls back to the geocoder.
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
