# Horizon Watch — session handoff
**Date:** 2026-09-19 · **Branch:** `main` · **Head:** `eab65eb`
**Written for:** whoever picks this up in a new chat — assume they know the product but not this session.

---

## 1. Where things stand

Fifteen commits, all on `main`, all pushed. The session covered four areas:
the PARALLAX spec backlog, the briefing generator, the entity graph, and the
imagery pipeline.

Test state: **683 frontend tests**, ~87 backend tests across the modules
touched. Frontend build clean.

---

## 2. Run it

```bash
# backend — imagery is now ON by default
cd backend && DATA_DIR=./data python3 -m uvicorn main:app --host 127.0.0.1 --port 8000

# frontend
npm run dev
```

**Environment.** `backend/.env` holds the keys. Present: `ANTHROPIC_API_KEY`,
`COPERNICUS_CLIENT_ID/SECRET`, `AISSTREAM_API_KEY`, and others.

Two switches that matter:

| variable | default | meaning |
|---|---|---|
| `SENTINEL_IMAGERY_ENABLED` | **true** (flipped this session) | Sentinel/SAR imagery + object detection |
| `HW_LLM_PURPOSES` | `briefing` | which features may call Claude at all |
| `FIRMS_MAP_KEY` | **unset — needed** | NASA fire detections |
| `AIS_LOITERING_ENABLED` | false | still off; unrelated freeze, geometry caching not done |

---

## 3. What was built, and what to know about each

### 3.1 Briefings — now the priority path

The generator produces **continuous analytical prose**, not a claims list.
Each section is 2–4 paragraphs ending in an implication sentence naming a
concrete consequence. **Web search is on** (`web_search_20250305`), so the
model researches context the feeds don't carry.

Measured on a real Baltic snapshot: 3 sections, ~1,070 words, 20 validated
claims, 72 open sources, ~255s end to end.

Things that will bite you if you don't know them:

- **`max_tokens` is 32000 and the call is STREAMED.** The SDK refuses a
  non-streaming request whose ceiling could exceed ten minutes. At 6000 and
  again at 16000 the reply truncated mid-JSON and the parser reported "could
  not parse model response" — which points at the parser, not the budget.
- **All text blocks are concatenated.** With search enabled the reply is a
  sequence (`server_tool_use`, results, then several text blocks) and the JSON
  is in the last one.
- **Citation markup is stripped.** Claude emits `(cite index="22-9">…</cite>`
  mid-sentence; unshippable in a deliverable.
- **Drafting runs in `_briefing_executor`** (2 workers), not on the event
  loop. Inline it froze the whole backend for four minutes — the symptom was
  a *successful* draft followed by "Request timed out" on the next request.
- **Client timeout is 600s** for `/draft`.
- A task stuck in `drafting` is **recoverable**: real work is returned, an
  empty shell is deleted and the task reset.
- Languages: **en / de / fr**. The language is a property of the deliverable —
  item_ids, section keys and JSON keys stay canonical, or every claim is
  silently dropped by validation.

**Claude is restricted to briefing generation** via `llm_gate.py`. Everything
else (fusion narratives, surge headlines, foresight, news scoring, chat,
imagery reasoning, Forge) gets `None` and degrades. The council is off —
it was a second model call per report. `HW_LLM_PURPOSES=all` re-enables.

### 3.2 The entity graph — the biggest change

`ftm.py`, `ftm_store.py`, `ftm_loader.py`, `ftm_resolve.py`, `routers/graph.py`.

We **adopted the FollowTheMoney model natively** (not the package — it needs
PyICU, a system dependency the deployed backend would carry). OpenSanctions
already publishes in FtM; the old loader kept `schema == "Vessel"` and dropped
99.5% of it.

Same file, same fetch, now yields:

```
102,409 things   37,936 Person · 15,380 Organization · 3,701 Vessel · 3,362 Company
 86,479 edges    70,272 Sanction · 6,544 UnknownLink · 5,921 Ownership
                 1,460 Employment · 407 Directorship · 114 Family
```

Reload with `python3 -c "import ftm_loader; ftm_loader.load_all('data/akili.db')"` (~7s).

**Resolution:** 10,191 tracked vessels → 704 auto-linked (IMO / MMSI / exact
name), 310 held for human review. Endpoints: `/api/graph/stats`,
`/api/graph/vessel/{mmsi}`, `/api/graph/review`.

> The hard-won lesson: fleet operators name ships in series, so a missing
> token is the NORM. "VB VICTORY" ~ "VICTORY" scored 95% and they are
> different ships. Requiring equal token count cut 7,012 review candidates to
> 310 with no loss of auto-links. "HANSA" ~ "HANA" still survives and is
> structurally identical to the genuine misspelling "PERSERVERANCE" ~
> "PERSEVERANCE" — **name alone cannot separate them**, so fuzzy never
> auto-accepts at any score.

### 3.3 News → graph linking

`news_entities.py`. **A gazetteer, not NER** — we aren't discovering names, we
have 102,409 of them. spaCy mangles title-case headlines ("Chad Blames Sudan's
Army" → one PERSON named "Chad Blames Sudan s") and missed Sovcomflot.

Five successive gates, each found by reading real output: corpus-derived
frequency (killed "Israel" linked as a Person 109×), sanctions topic, maritime
context for vessels (225 → 6 false positives), **single-token names refused
entirely** ("Society" ← *civil society*, "Martin" ← *Lockheed Martin*), and
nickname aliases ("the Nose" ← *"the Nose Job of Tomorrow"*).

Result: 13 of 17 links correct. **The yield is the problem, not the precision.**

### 3.4 Imagery — reactivated

The kill switch existed because this path was the leading suspect for a
confirmed production event-loop freeze. The audit found the whole CPU section
still inline inside `async def _run_scan_async`: PIL decode of a
multi-megapixel scene, JPEG re-encode, base64, YOLO ONNX inference, plus a
GeoTIFF parse and full-array numpy maths on the SAR side.

All now in a **single-worker pool** (`_CPU_POOL`). Two bugs found while
testing: `_off_loop` used `get_event_loop()` (raises in an AnyIO worker
thread), and `_launch_zone_scan_background` called `ensure_future()` from a
sync endpoint — which meant **scan-now could never have worked from the API**,
kill switch or not.

Verified: a live Sentinel-2 scan over ZONE-001 completed with **8 real
detections** while `/api/health/detailed` returned 200 to every probe.
⚠ Two probes stalled (12.2s, 3.1s) during inference — much better, not
perfect. GIL contention during ONNX remains.

### 3.5 FIRMS

`firms.py` + endpoints. A credible fire inside a watch zone tasks a Sentinel
scan of that zone. Three gates: credibility (confidence + ≥300K), relevance
(polled per watch zone, so relevance is the analyst's own statement), and
**repeat suppression** — a refinery gas flare burns nightly at the same
coordinate and would otherwise consume the entire imagery budget for ever.

⚠ **Never run against the live feed.** Needs a free `FIRMS_MAP_KEY` from
https://firms.modaps.eosdis.nasa.gov/api/map_key/. Without it the feed reports
`unavailable` with the reason, not an empty list.

**The recurring user-defined AOI scanning already existed** — `watch_zones`
has `scan_interval_hours` / `next_scan_at` and a 15-minute scheduler. It had
simply never been able to run.

### 3.6 Smaller things

- **Locator minimap** rebuilt: the old basemap snapped every coastline point
  to a whole degree (`q=1.0`) — that was the "Minecraft" look. Douglas–Peucker
  at 0.06°, 159 country + 137 city labels, eased geometric zoom.
- **Heat ramp (§M4)**: severity × recency. ⚠ The spec's own formula gives
  *every* severity 1.0 at age 0; each severity now has a ceiling from the
  ramp's stops so only a fresh critical reaches the top.
- **Risk choropleth**: the risk index never drew a pixel. Now fills countries
  above a floor of 8 (13 of 16 scored countries sit under 25 — a ramp from
  zero would invent a global picture from sampling noise). ⚠ The endpoint
  **mixes three ISO schemes**: `DE` (alpha-2), `PHL` (alpha-3), `RP` (FIPS) —
  the Philippines arrives twice.
- **Infrastructure is its own layer group** — cables rode the *Maritime*
  toggle, OpenInfra rode *Imagery*.
- **Photos**: aircraft entity ids are `adsb-<icao24>`, and Planespotters'
  `photo_url` is an **HTML page** — the image is `thumbnail_url`. Ports/
  airports/vessels get Wikimedia reference images that reject logos, event
  articles and wrong-subject pages.
- **Port/airport map glyphs (§I6)** — never a plane for an airport.
- **Auto daylight theme**: `reconcileTheme` resolved a null theme to a *held*
  dark mode. 7 of 9 accounts had null.

---

## 4. Known defects, in priority order

1. **News corpus is crippled.** `body` is EMPTY for all 6,066 articles — the
   ingest stores headlines only (median 71 chars). RSS last ran 2026-09-11.
   Storing bodies would multiply the graph-linking yield more than any tuning.
   ⚠ The user does **not** want news markers back on the map — the old layer
   failed because 97% of the corpus is `other`/tier-3 and geocoding is coarse
   (620 articles on Berlin, 213 on the US centroid). News belongs in the graph
   and the briefing, not as pins.
2. **Ports return zero features** in viewport queries — the port dataset looks
   unpopulated. Check before building §L7 congestion on it.
3. **12s stalls during ONNX inference** (see 3.4).
4. **Corpus assembly takes ~11.6s** — two `COUNT(DISTINCT …)` over
   aircraft_history (1.3M) and vessel_history (1.06M). A `(timestamp, id)`
   index only gets 8.7s → 6.3s. The user said 6s is fine; the real fix is not
   counting distinct IDs on every snapshot.
5. **`pytest` on the whole backend dir fails at collection** — ~10 standalone
   check scripts call `sys.exit()` at import. Pre-existing. Run named test
   files.
6. **`EL NINO`** links as a sanctioned alias to weather stories (4×).

---

## 5. What the user asked for next

**Immediately queued (their words):**
- Reactivate **RSS as an ingest source only**, and **store article bodies** —
  explicitly *no map layer*.
- Then **PyOD / river** for AIS behavioural anomaly detection.

**Also agreed, not started:**
- **Splink** — held off deliberately: the constraint is that vessel names are
  genuinely ambiguous, not the algorithm.
- **Reconnect the OpenStreetMap layer** — the Overpass integration is intact
  and serving (`/infrastructure/all`, note: **no `/api` prefix**), but
  `GlobeInfraPopup.jsx` was deleted and nothing calls it. The user was clear:
  **clean it up first** — scope it to watch zones, strip historical and
  `danger_area` tags, epistemic sub-line on the row, and treat OSM as a
  **lookup, not a population** (promote a facility to an entity only when
  something references it).
- Fill **`ontology_claims`** (still 0 rows) — the table that would let the
  system say "we believe X because of Y".
- Surface the graph in the UI; it is API-only today.

**Deferred by the user, in memory as `project_imagery_backlog`:** the fire →
imagery → detection chain is now built; what remains is the UI for
user-defined recurring regions.

**Spec sections explicitly excluded: §14, §31.**

---

## 6. Working agreements from this session

- **Verify before pushing.** A clean build is not a clean run — a prop-name
  collision took production down this session despite 648 green tests.
- **Look at real output.** Every significant fix here came from reading actual
  results, not from reasoning: the 95% ship matches, "Israel" as a Person, the
  logo instead of a port photo.
- **Absence is not quiet.** Coverage, risk and OSM all share one failure:
  rendering "we have no data" identically to "nothing is happening".
- **A wrong link is worse than no link.** Especially where the output names a
  real ship or person in a client deliverable.
- Push directly to `main`. Commit messages carry the reasoning, at length.
