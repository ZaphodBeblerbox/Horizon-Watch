# Director Mode — Handoff Document

*Last updated: 2026-04-18*

---

## Overview

Director Mode turns NAGINI into an AI-narrated intelligence briefing engine. A briefing is a JSON array of action objects. Each action drives the map (animations, drawings, overlays) while text-to-speech narrates simultaneously.

---

## Architecture

```
User prompt → POST /api/director/generate → Claude API → JSON actions array
                                                            ↓
                         commandRunner.js._groupActionsIntoScenes()
                                                            ↓
                         _playSceneLoop() — fires visuals (300ms stagger)
                                         — fires TTS narration
                                         — awaits both before next scene
```

### Scene grouping rules
- A new scene starts when a `narrate` action is encountered
- Visual actions before the next `narrate` are batched with it
- Both the visuals and TTS complete before advancing

---

## Verified Working Action Types (22)

| Action | Key Parameters | Notes |
|--------|---------------|-------|
| `fly_to` | `lat`, `lon`, `zoom` | Smooth Leaflet flyTo |
| `narrate` | `text` | TTS; starts scene |
| `highlight_country` | `country`, `color`, `opacity` | GeoJSON fill |
| `show_chokepoint` | `name` | Zooms + highlights polygon |
| `place_event` | `lat`, `lon`, `label`, `type` | Pulsing marker |
| `place_location` | `lat`, `lon`, `label`, `type` | Static marker |
| `draw_line` | `points[]`, `color`, `dashed` | Glow + main line |
| `draw_animated_line` | `points[]`, `color`, `dashed`, `duration` | Animated draw with glow |
| `draw_arrow` | `from[]`, `to[]`, `color`, `curved` | Bezier arrow with glow |
| `draw_circle` | `center[]`, `radius_km`, `color`, `animated_expand` | Optional grow animation |
| `pulse_hotspot` | `lat`, `lon`, `label`, `color` | 3 expanding rings + center dot |
| `spotlight` | `lat`, `lon`, `zoom`, `duration` | Vignette overlay |
| `animate_movement` | `units[]`, `speed` | Ship/unit animation (Schema A + B) |
| `data_callout` | `stat`, `label`, `context` | Floating stat overlay |
| `show_chart` | `title`, `data[]`, `chart_type` | Full-screen → sidebar |
| `country_info_overlay` | `country`, `topic` | Wiki/search panel |
| `formation` | `pattern`, `center[]`, `units[]` | Multi-unit formation |
| `create_impact` | `lat`, `lon`, `intensity` | Explosion animation |
| `clear_scene` | — | Removes all drawings/overlays |
| `clear_all` | — | Full reset |
| `recap_overview` | `summary`, `key_points[]` or `locations[]` | Text summary panel |
| `click_event` | `label`, `description` | Simulates vessel click |

---

## Schema Variants

### `animate_movement` — Schema A (preferred)
```json
{
  "action": "animate_movement",
  "speed": 0.25,
  "units": [
    {
      "from": [27.19, 56.27],
      "to": [26.38, 56.25],
      "waypoints": [[27.05, 56.30], [26.65, 56.28]],
      "type": "warship",
      "label": "IRGCN Patrol 1",
      "color": "#ff4444"
    }
  ]
}
```

### `animate_movement` — Schema B (also supported)
```json
{
  "action": "animate_movement",
  "speed": 0.2,
  "units": [
    {
      "origin": [24.0, 58.5],
      "destination": [26.38, 56.25],
      "path": [[24.5, 57.8], [25.5, 56.9]],
      "icon": "carrier",
      "label": "USS Abraham Lincoln",
      "color": "#4488ff"
    }
  ]
}
```

### Speed → Duration mapping
| Speed | Duration |
|-------|----------|
| 0.15  | 33s |
| 0.20  | 25s |
| 0.25  | 20s |
| 0.50  | 10s |
| 1.00  | 5s  |

Formula: `Math.round((1 / Math.max(speed, 0.05)) * 5000)` ms

---

## Available Unit Icons

| Type string | Size | Description |
|-------------|------|-------------|
| `warship` | 36×36 | Destroyer/frigate silhouette |
| `carrier` | 44×44 | Aircraft carrier (largest) |
| `patrol` | 28×28 | Small patrol boat |
| `submarine` | 32×32 | Submarine (teardrop) |
| `tanker` | 40×36 | Tanker (wide beam) |
| `default` | 32×32 | Generic vessel |

---

## Strait of Hormuz Reference Coordinates

All coordinates verified in open water (not over land).

### Inbound TSS Lane (southbound ships entering Gulf)
```
[25.40, 56.85] → [25.80, 56.75] → [26.10, 56.55] → [26.22, 56.42]
→ [26.30, 56.35] → [26.38, 56.28] → [26.52, 56.18] → [26.65, 56.08]
→ [26.80, 55.95] → [27.00, 55.85]
```

### Outbound TSS Lane (northbound ships exiting Gulf)
```
[27.00, 56.00] → [26.80, 56.10] → [26.65, 56.22] → [26.52, 56.32]
→ [26.38, 56.42] → [26.22, 56.55] → [26.05, 56.65] → [25.80, 56.85]
→ [25.40, 57.00]
```

### Key Points
| Feature | Coordinates |
|---------|-------------|
| Narrows (chokepoint) | [26.38, 56.25] |
| Bandar Abbas naval base | [27.19, 56.27] |
| Abu Musa Island | [25.88, 55.03] |
| Musandam Peninsula tip | [26.38, 56.27] |
| Hormuz Island | [27.06, 56.46] |
| Jask naval base | [25.64, 57.77] |

---

## Test Briefing

**Endpoint:** `GET /api/director/test-briefing`

**Shortcut:** `Ctrl+Shift+T` in the Director Modal, or click the `⚙ Test` button.

17-scene briefing focused on the Strait of Hormuz — tests every major action type with verified water coordinates.

---

## Cost Estimates

Per briefing (typically 800–1200 tokens in, 1500–2500 tokens out):

| Model | Estimated Cost |
|-------|---------------|
| Claude Sonnet 4.6 | ~$0.08 – $0.12 |
| Claude Opus 4.6 | ~$0.40 – $0.60 |

Uses `claude-sonnet-4-6` by default. Switch in `backend/main.py` `director_generate()`.

---

## Known Issues / Limitations

1. **Curved arrows over land** — `draw_arrow` with `curved: true` uses a Bezier midpoint that may arc over land. Always provide explicit waypoints for narrow waterways.

2. **TTS latency** — ElevenLabs API adds 1–3s per scene. Longer briefings (>12 scenes) can feel slow. Consider `speed: 1.2` in ElevenLabs settings.

3. **`show_chart` sidebar handoff** — After the full-screen chart fades, the sidebar panel shows. If the sidebar is closed, the chart still opens correctly but won't auto-close.

4. **`country_info_overlay` image search** — Wikimedia search can return no images for obscure topics. Fallback shows text-only panel.

5. **`formation` pattern** — Only `"surround"` is fully tested. `"line"` and `"wedge"` exist but are less polished.

6. **Mobile TTS** — iOS Safari requires a user gesture before audio plays. First scene narration may be silent on mobile.

7. **`animate_movement` waypoints** — Waypoints are interpolated linearly. For sharp turns (e.g., rounding a peninsula), add dense waypoints around the turn.

---

## Adding New Action Types

1. Add handler in `commandRunner.js` `executeAction()` switch block
2. Return delay in ms (or `defaultDelay = 500`)
3. Push any created layers to `this._drawings` so `clear_scene` cleans up
4. Document here

---

## Files

| File | Purpose |
|------|---------|
| `src/services/commandRunner.js` | All action handlers, scene playback engine |
| `src/components/DirectorModal.jsx` | Prompt input UI, Test button |
| `src/components/DirectorSidebar.jsx` | Running transcript, history |
| `src/app.jsx` | `handleDirectorLoadTest`, keyboard shortcut wiring |
| `backend/main.py` | `/api/director/generate`, `/api/director/test-briefing` |
| `backend/data/key_facilities.json` | Chokepoint coordinates, facility data |
