# Horizon Watch â Build Specification v2.0

**Reference implementation:** `HorizonWatch.html` Â· `hw.css` Â· `hw-data.js` Â· `hw-data2.js` Â· `hw-app.js` Â· `hw-modules.js` Â· `hw-x.js` Â· `image-slot.js`

A complete build spec for **Horizon Watch**: a dark, dense, desktop-only geopolitical
intelligence workstation for a corporate risk & security team. It displays global risk
signals on a real vector map, tracks live vessels and aircraft, runs ML change detection
over satellite imagery of standing observation areas, maintains an editable ontology of
linked entities, and generates interactive and printable intelligence briefings.

Written so an engineer or coding agent can reproduce the product from scratch in any stack
without seeing the original. **Read sections 1â4 before writing any code** â they contain
the rules that stop this class of interface from looking amateur.

---

## 0. Product definition

Ten modules answer, in order of an analyst's day:

| # | Module | Question it answers |
|---|---|---|
| 1 | **Situation** | What is happening right now that touches us, and where? |
| 2 | **Inbox** | What have I not yet reviewed? |
| 3 | **Dossiers** | How exposed are we to place X? |
| 4 | **Analytics** | What is the trend and where is it concentrated? |
| 5 | **Generate** | Turn an evidence set into a briefing. |
| 6 | **Replay** | How did the picture assemble itself? |
| 7 | **Ontology** | Who is connected to whom, and how confident are we? |
| 8 | **Imagery** | What physically changed on the ground? |
| 9 | **Briefings** (reader) | Read the assessment with every claim traceable. |
| â | **Print layout** | The same briefing as an issued paper document (a *view*, not a rail destination). |

### Non-goals
- No mobile or tablet layout. Minimum 1280Ã720; designed for 1600â2560 wide.
- No marketing chrome, onboarding, illustrations, or empty-state art.
- No sensor tasking, chat, or ticketing. The console **reads, links, and reports**.

### Legal / ethical constraints (non-negotiable)
- Never copy a commercial product's brand, wordmark, icon set, component names, or
  distinctive proprietary layouts. This is an original product in a common genre.
- Sample data must be labelled as such (status bar: *"Sample corpus, not live reporting"*).
- Real places and corridors are fine. Specific fabricated claims attributed to real named
  individuals or organisations are not. Vessel/aircraft identities in the sample corpus are
  explicitly illustrative.

---

## 1. The five rules that make it look like real software

Highest-priority constraints. Everything later is downstream of these.

**Rule 1 â System type only.** No webfonts.
`--font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif`.
Body 12.5px, tables 12.5px, labels 11px, pane titles 12px/600. Nothing above 26px except
the printed briefing's H1. No display or geometric typeface (no Inter, Geist, Space Grotesk).

**Rule 2 â Monospace is for figures, never for labels.**
`--mono: ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`, permitted
**only** on: timestamps and durations, coordinates and scale readouts, record IDs
(`HW-2400`, `BRF-0436`, `AOI-14`, `N02`, `CHG-05`), counts and numeric cells, statistic
values, axis ticks, and the agent log. **Forbidden** on: headings, pane titles, button
labels, chip/tag text, nav labels, status-bar words, tooltip prose, form labels. Letterspaced
uppercase mono ("kicker" styling) is the single strongest amateur tell â do not use it.

**Rule 3 â Colour is a scarce signal.** The interface is a neutral blue-grey scale. Hue
appears only where it encodes state:
- **Severity** (the one ramp): critical `#c4453c` â high `#b7822c` â moderate `#4f7fa6` â
  low `#6d7883`. Warm reads bad, cool and grey benign.
- **Delta direction**: worsening `#b0645c`, improving `#6d9a83`.
- **One accent** `#3f6fa8` / hover `#5f95d0` for selection, focus, links, primary buttons,
  progress. Nothing else is blue.
- **Change-detection types**: new `#c4453c`, expanded/moved `#b7822c`, removed `#4f7fa6`
  (dashed). These reuse the severity ramp deliberately â no new hues.
- Everything else â domains, sources, regions, ontology links, flow arcs, heatmaps,
  sparklines â is grey. Category legends use **shades, not hues**. Seven-colour palettes banned.

**Rule 4 â Flat, tight, hairline.** Radius 2px. 1px borders `--line #30373f`. No shadows
except floating layers (tooltip, palette, toast, paper page). Control heights 21 / 24 / 26px.
Rows 24â30px. Pane headers 28px. 1px gaps between statistic cells, 8â12px between panels.
No gradients, glows, pill buttons, or coloured card fills. Hover = one step lighter grey.
Selected = filled row plus a 1px accent rule. The **only** exception is Â§4.6 glass.

**Rule 5 â Every surface is chrome around data.** No decorative panels or hero areas. An
empty pane shows a 12px grey sentence saying what would appear and how to get it.

---

## 2. Technology and file structure

Dependency-light on purpose: opens from the filesystem, no build step.

```
HorizonWatch.html   document shell, SVG icon sprite (~45 symbols), all 10 module skeletons
hw.css              tokens, atoms, module layouts, glass, print rules
hw-data.js          core corpus: events, entities, country risk, flows, briefings
hw-data2.js         extended corpus: infrastructure, tracks, imagery scenes, ontology,
                    annotations, observation areas (AOIs)
hw-app.js           shell (rail, tabs, palette, clock, telemetry), Situation map, Inbox
hw-modules.js       Dossiers, Analytics, Generator, Print document, Replay
hw-x.js             annotations, live tracks, infrastructure, minimaps, Ontology,
                    Imagery + AOI management, interactive Reader
image-slot.js       <image-slot> drop-target web component for user-supplied imagery
```

**Libraries â exactly two, pinned with SRI, in `<head>`:**

```html
<script src="https://unpkg.com/d3@7.9.0/dist/d3.min.js"
  integrity="sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i"
  crossorigin="anonymous"></script>
<script src="https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js"
  integrity="sha384-Ukv1p/xTma6P4/2bY5KzWBw+ydSpXmhCMtyciIQVDJ1RmOxtCYNMF1uXT9T63H67"
  crossorigin="anonymous"></script>
```

d3 supplies geo projections/paths, scales, axes, pie/arc/area/line, rollups, drag and zoom.
topojson-client decodes the basemap. **Never hand-draw country geometry.**

Basemap: `https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json` (Natural
Earth, public domain), decoded with `topojson.feature(topo, topo.objects.countries)`.
A failed fetch raises a warning toast and leaves every other module functional.

**Load order matters:** `image-slot.js` â `hw-data.js` â `hw-data2.js` â `hw-app.js` â
`hw-modules.js` â `hw-x.js`. Each later file extends the earlier via published globals (Â§8.1).

**Porting to React/Vite/TS:** one component per pane, module state in a store, d3 used
imperatively inside `useEffect` on an `<svg>` ref. Do **not** introduce a component library
(MUI/Chakra/shadcn) â their radii, shadows and type scales undo Rule 4. Tailwind is
acceptable only if the token layer below is mapped 1:1 first.

### 2.1 The animation-frame hazard (learned the hard way)

**`requestAnimationFrame` is not guaranteed to fire.** In a throttled, backgrounded, or
embedded frame the callback never runs. Because **d3 transitions are rAF-driven**, every
`.transition()` silently becomes a no-op: zoom buttons do nothing, pings never expand,
layouts never fit. This is invisible in code review and looks like "the buttons are broken".

Two mandatory patterns:

```js
// 1. Probe once at startup, then route every zoom through one helper.
let rafOK = null;
(function probeRaf() {
  let fired = false;
  requestAnimationFrame(() => { fired = true; rafOK = true; });
  setTimeout(() => { if (!fired) rafOK = false; }, 260);
})();
function applyZoom(t, ms) {
  if (rafOK && ms) svg.transition().duration(ms).call(zoom.transform, t);
  else svg.call(zoom.transform, t);          // synchronous fallback â always works
}

// 2. Drive pulses with stepped timers, never d3 transitions.
const steps = 22, r1 = 46 / k;
for (let s = 1; s <= steps; s++) setTimeout(() => {
  const f = s / steps, e = 1 - Math.pow(1 - f, 3);   // cubic-out by hand
  c.attr('r', 2 + (r1 - 2) * e).attr('stroke-opacity', 1 - e);
  if (s === steps) c.remove();
}, delay + s * (1300 / steps));
```

Likewise **never defer layout work with rAF** â use `setTimeout(fn, 0)` with a bounded
retry loop (up to 20 Ã 50ms) when a container may still measure zero:

```js
let tries = 0;
function sizeMap() {
  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) { if (tries++ < 20) setTimeout(sizeMap, 50); return; }
  tries = 0;
  /* â¦ fit â¦ */
}
```

---

## 3. Design tokens (copy verbatim)

```css
:root{
  /* surfaces â 5 steps, neutral blue-grey, never pure black */
  --bg-0:#171b20;  /* app background, active tab, input/log wells */
  --bg-1:#1c2127;  /* pane background */
  --bg-2:#22282f;  /* pane headers, toolbars, cards, top bar */
  --bg-3:#2a3138;  /* hover, default button */
  --bg-4:#333b43;  /* pressed/selected, button hover, chart tracks */

  --line:#30373f;         /* structural 1px borders */
  --line-soft:#262c33;    /* row dividers, inner separators */
  --line-strong:#3d454e;  /* control borders, floating-layer borders */

  --txt:#d5dae0;   /* primary */
  --txt-2:#a4adb6; /* secondary / body prose */
  --txt-3:#818c96; /* labels, muted */
  --txt-4:#616b75; /* units, axis ticks, disabled â never for text a user must read */

  --acc:#3f6fa8; --acc-hi:#5f95d0;
  --acc-dim:rgba(63,111,168,.22); --acc-line:rgba(95,149,208,.42);

  --red:#c4453c; --amber:#b7822c; --steel:#4f7fa6; --green:#4c7d63; --grey:#77828c;
  --sev-critical:#c4453c; --sev-high:#b7822c; --sev-moderate:#4f7fa6; --sev-low:#6d7883;

  --font:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;
  --mono:ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace;

  --r:2px;
  --ease:cubic-bezier(.3,.7,.4,1);
  --shadow:0 10px 26px rgba(0,0,0,.42),0 1px 3px rgba(0,0,0,.4);

  --top:40px; --tabs:32px; --status:24px;
  /* Situation glass panel widths â the map fit AND every map overlay inset derive
     from these two tokens, so they can never drift apart. */
  --pane-l:250px; --pane-r:312px;
}
```

**Derived colours used inline** (exact, desaturated variants):

| Purpose | Value |
|---|---|
| Delta worsening / improving | `#b0645c` / `#6d9a83` |
| Tag red / amber / green / blue (text on border) | `#cf6259`/`#5c3b38` Â· `#c19446`/`#5a4a2c` Â· `#699781`/`#3a5346` Â· `#78a5d4`/`#39536e` |
| Map land / stroke / ocean / graticule / hover | `#232a30` Â· `#2e363d` Â· `#12161a` Â· `#20262b` Â· `#39424a` |
| Country-risk ramp 1â5 | `#232a30 #2a3138 #333a3c #3d3c39 #463c37` |
| Charts: area fill / stroke / grid | `#3f6fa8` @13% Â· `#7d97b3` Â· `#262c33` |
| Histogram / histogram-hot | `#4a545e` / `#8d5348` |
| Heatmap ramp / empty cell | `#232a30 â #5c6b78` / `#1e242a` |
| Annotation ink | `#c8a04a` (fill 10%) |
| Vessel / sanctioned vessel / aircraft / watchlisted | `#7fa8c9` Â· `#c4453c` Â· `#a8b6c2` Â· `#b7822c` |
| Ontology plate / link / inferred link / tier rule | `#232a31` Â· `#3f4a55` Â· `#4d5964` dashed Â· `#262c33` dashed |
| Category ramp (regions, sources, domains) | `#9aa5ae #8b96a0 #8d9aa4 #7c8792 #7d8993 #6d7883 #6f7b85 #5f6a74 #626e78 #515c66 #55616b #444e58 #4a555f #404b54` |

### 3.1 Type scale

| Role | Family | Size | Weight | Colour |
|---|---|---|---|---|
| Pane title (`.panehead h3`) | sans | 12px | 600 | `--txt` |
| Group heading (`h4`) | sans | 11.5px | 600 | `--txt-2` |
| Body / table cell | sans | 12.5px | 400 | `--txt` |
| Prose paragraph | sans | 12.5px, lh 1.55 | 400 | `--txt-2` |
| Label (`.lbl`) | sans | 11px | 400 | `--txt-3` |
| Detail title (`.detail h2`) | sans | 15px | 600 | `--txt` |
| Dossier name (`h1`) | sans | 19px | 600 | `--txt` |
| Reader body | sans | 13.5px, lh 1.68 | 400 | `--txt-2` |
| Statistic value | mono | 19px | 400 | `--txt` |
| Gauge value | mono | 23px | 400 | severity |
| Data cell (time, ID, count) | mono | 11.5px | 400 | `--txt-2`/`--txt-4` |
| Axis tick | mono | 9â9.5px | 400 | `--txt-4` |
| Agent log | mono | 11px, lh 1.65 | 400 | `--txt-3` |
| Tag / status pill | sans | 10px, ls .03em | 400 | variant |
| Graph node label / sub | sans | 9.5px / 8.5px | 400 | `--txt` / `--txt-3` |
| **Printed briefing body** | **serif** (Times/Georgia) | 13px, lh 1.6 | 400 | `#22272d` |

**Casing:** sentence case everywhere. Uppercase only in: the classification chip
(`INTERNAL // RISK`), map coordinate/scale readouts, short code tags (`CONF`, `MARI`,
`AIS-TRACK`), ontology tier band labels, and printed section headings.

---

## 4. Layout

### 4.1 Application frame

```
#app  display:grid; grid-template-columns:minmax(0,1fr);
      grid-template-rows: 40px 32px 1fr 24px; height:100vh
      row 1  .topbar     brand | module rail | spacer | tools
      row 2  .tabstrip   workspace tabs | feed pills
      row 3  #views      ten module views, one visible
      row 4  .statusbar  telemetry cells | basket, user, build
body  overflow:hidden    (the app never scrolls; panes scroll)
```

**Two load-bearing details.** `grid-template-columns:minmax(0,1fr)` on `#app` â without it
the implicit track sizes to the top bar's min-content and the app grows past the viewport.
`.view{height:100%}` â without it the grid row is content-sized, panes grow to content
height, and inner `overflow:auto` stops working. Every scroll container is
`flex:1; min-height:0; overflow:auto`, never `height:100%`.

**Any fixed-height flex row that can overflow gets the same treatment:**
`min-width:0; overflow-x:auto` on the row, `flex:none; white-space:nowrap` on its **actions**, and
`flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis` on its **descriptors**
(titles, scene identifiers, filter inputs). Applied to `.topbar`, `.toolbar`,
`.statusbar .cell`, the map `.panehead`, and `.timestrip .head`.

Two failure modes this prevents. If *every* child is `flex:none`, a long descriptor pushes
the action buttons past the pane edge where they render **underneath the glass panel** â
unclickable, and invisible because the scrollbar is hidden. If *no* child is `flex:none`,
children shrink and wrap inside a fixed-height bar and text is cut in half. Descriptors give
way; actions never do. Keep a visible 4px scrollbar as the last-resort affordance, and keep
toolbar content under the pane width at 1280px (measure `scrollWidth` against
`1280 â left pane â right pane`).

### 4.2 Pane grids per module

| Module | Columns |
|---|---|
| Situation | `var(--pane-l) 1fr var(--pane-r)` â layers Â· map+timestrip Â· inspector |
| Inbox | `212px 1fr 356px` |
| Dossiers | `238px 1fr 292px` |
| Analytics | `1fr` |
| Generate | `290px 1fr 322px` |
| Replay | `1fr 300px` (right pane leads with a 196px minimap) |
| Ontology | `236px 1fr 316px` |
| Imagery | `250px 1fr 330px` |
| Reader | `236px 1fr 336px` (right pane leads with a 196px minimap) |
| Print layout | `242px 1fr` |

Pane internals are always: `.panehead` (28px, `--bg-2`, 1px bottom border) â `.scroll` â
optional fixed footer (transport bar, generate buttons, progress line).

### 4.3 Top bar (40px)

- **Brand** (196px min, right border): 17px monochrome meridian glyph in `--txt-2`, then
  `Horizon Watch` 12.5px/600 over `ops console 4.2` 10px `--txt-4`.
- **Module rail**: nine 62px buttons, `role="tab"`, 15px icon over a 10px label. Idle
  `--txt-3`; hover `--bg-3`+`--txt`; selected `--bg-0` + `--txt` + 2px `--acc-hi` bottom
  border. Inbox carries an unread badge (8.5px mono, `#c4453c`, `translate(14px,-8px)`).
  The print layout is a **hidden** module (`hidden:true`) â reachable only from the reader
  or generator, never from the rail.
- **Tools** (right, left border): four 25px icon buttons (new tab, area of interest, export,
  alerts), a 272px search affordance showing `Search events, entities, briefings` + `âK`,
  the classification chip, a live UTC clock, a 23px user monogram.
  Below 1400px the search collapses to its icon; below 1180px the clock hides.

### 4.4 Workspace tabs (32px)

The navigation spine â behaves like an IDE:
- Opening a module reuses that module's tab if present, else appends one.
- Each tab: 5px status dot, ellipsised label (max 216px), close affordance on hover only.
  Selected tab: `--bg-0` + a 1px `--acc-hi` top rule.
- Closing the active tab selects the last remaining tab; closing the last reopens Situation.
- **Labels are contextual**: `Dossier Â· Red Sea corridor`, `BRF-0436 Â· Weekly geopolitical
  exposure review`, `Print layout Â· BRF-0436`.
- Right cluster: green dot + `7 feeds live`, and a mono ingest counter ticking each second.
- `+` opens the command palette â a new tab is always chosen *by destination*, never blank.

### 4.5 Status bar (24px)

`â Connected` Â· `Corpus 42 signals` Â· `Latency 42 ms` Â· `Tasking queue 2` Â·
`Sample corpus, not live reporting` Â· *spacer* Â· `Briefing basket 3` Â·
`K. Almeida Â· Group security` Â· `Build 4.2.108`. Values in mono `--txt-2`. The basket cell
is the only one that changes through user action.

### 4.6 Glass side panels (the one exception to Rule 4)

On every module, `aside.pane` is frosted glass:

```css
aside.pane{
  background:rgba(26,31,37,.72);
  backdrop-filter:blur(16px) saturate(115%);
  transition:transform .24s var(--ease),opacity .18s linear;
}
```

On **Situation** the centre pane spans the whole grid (`grid-column:1/-1`) so geography runs
edge to edge, and the two asides float above it (`z-index:2`, `rgba(22,27,33,.66)`).

**The header must not hide under the glass.** The map pane's `.panehead` is a full-width
command band **above** the panels (`position:relative; z-index:4; background:var(--bg-2)`),
and the asides start below it (`margin-top:28px`). The naive alternative â padding the
header by both panel widths â leaves a 344px content box for ~760px of controls at 1280px,
and the overflow renders *underneath* the opaque glass, unclickable and unscrollable.

**Panels slide, they do not pop.** On module change the left aside animates
`translateX(-14px)â0` and the right `+14pxâ0` over 0.26s; the centre pane fades.

**One mechanism must own `transform`.** A keyframe animation with `animation-fill-mode:both`
holds its final frame forever, and a filling animation always beats a transition on the same
property â so a panel with entry keyframes will slide *in* and then refuse to slide *out*,
no matter what the minimise rule says. Removing the animation in the same frame as the class
change does not help either: the transition then has no start value and the panel jumps.
The Situation panels therefore carry `animation:none` and let a single
`transition:transform .24s, opacity .18s` drive both directions; keyframes remain on the
other modules, which have no minimise.

**Situation panels minimise.** A chevron in each header sets `.min-l` / `.min-r` on
`.panes`, which overrides `--pane-l` / `--pane-r` to `30px` and translates the panel fully
out. A 30px labelled vertical rail (`.panetab`) restores it. Because the map fit and every
overlay inset read the same variables, the map reflows automatically. Use `:first-of-type` /
`:last-of-type`, not `:first-child` / `:last-child` â the restore rails are siblings.

### 4.7 Map overlay geometry

| Element | Position |
|---|---|
| Annotation + quick-layer bar | inside the map pane header (never on the map) |
| Coordinate + scale readout `.mapmeta` | bottom-left, `calc(var(--pane-l) + 12px)` |
| Navigation cluster `.mapchrome` | bottom-right, `calc(var(--pane-r) + 9px)` |
| Severity legend | **not on the map** â a section inside the inspector |

`.mapmeta` has **no background, border, or blur** â bare mono text with
`text-shadow:0 1px 2px rgba(12,15,18,.9)`, exactly two lines: coordinates and the scale bar.

---

## 5. Component catalogue

Every interactive element is one of these. Build once, use everywhere.

### 5.1 Buttons `.btn`
24px tall, 9px padding, 6px gap to a 12px icon at .8 opacity, 12px label, `--bg-3` on
`--line-strong`, radius 2px. Hover `--bg-4` â no transform, no shadow, no scale.
- `.primary` â `--acc` fill, border `#4a7cb5`, text `#f2f6fa`. **One per pane maximum.**
- `.danger` â grey fill, `#cf6259` text; hover bg `#3a2c2b`, border `#5c3b38`. Never red-filled.
- `.ghost` â transparent, `--txt-3`; hover `--bg-3`. For pane-header verbs.
- `.sm` â 21px, 7px padding, 11.5px. Disabled â opacity .4, `not-allowed`.

### 5.2 Segmented control `.seg`
1px-bordered row of 22px buttons with `--line-soft` dividers. Pressed â `--bg-4` + `--txt`.
Used for: time window, projection, inbox status, analytics range, replay grouping/speed,
document zoom, forecast horizon, imagery view mode, ontology layout. Max 4 options; more
becomes a `select`.

### 5.3 Chips `.chip`
20px rounded-2px toggle, 11.5px, `--bg-2` on `--line`, optional 7px rotated swatch. Pressed
â `--bg-4` + `--line-strong`. Severity floor and read-only exposure tags (`cursor:default`).

### 5.4 Tag `.tag`
16px, 10px sans, ls .03em, transparent fill, `--line-strong` border, `--txt-3`. Variants
(`.red .amber .green .blue`) recolour **text and border only, never the fill**. Domain codes,
source codes, statuses, booleans, severity peaks, inferred/asserted markers.

### 5.5 Form controls
`.input` 26px, `--bg-0` well, `--line` border; focus `--acc-hi` border and **no glow ring**
(a shadow ring is the "web form" tell). `select.input` uses an inline SVG chevron.
`.check` 12px square, checked fills `--acc` with a 1.5px tick. Range: 3px `--bg-4` track,
11px `--txt-2` thumb with a 2px ring. `.field` = 11px label above the control.

**No native dialogs.** `prompt()` / `confirm()` / `alert()` are banned â they break the
frame's visual language instantly. Creating a named object commits a provisional name
(`Area 4`, `Untitled object`) and focuses an **inline** field: Enter commits, Escape reverts,
blur saves. Clicking the name of an already-selected row re-opens the editor.

### 5.6 Data atoms
- `.dia` â 7px square rotated 45Â°. **The severity glyph of the product**: map markers, list
  rows, legends, tables, replay lanes, printed pages. Never a circle, never an icon.
- `.sev` â diamond + severity word, coloured by severity.
- `.bar` â 3px `--bg-4` track, `--grey` fill. Confidence, mix shares, driver weights.
- `.kv` â 96px 11px `--txt-3` term / 12.5px value definition grid.
- `.card` â `--bg-2`, 1px `--line`, 10/11px padding. Groups prose; never nests.
- `.statgrid` / `.stat` â `repeat(auto-fit,minmax(140px,1fr))` with **1px gaps filled by the
  grid background** so cells read as a ledger, not floating cards. Value mono 19px, signed
  delta 10.5px, label 11px.
- `.panelbox` â analytics panel: `--bg-1`, 1px `--line`, 7/11px header, 11px body.
- `.empty` â 30px icon at .45 opacity, one 12px `--txt-4` sentence, optionally one button
  that resolves the emptiness.

### 5.7 Tables `.grid`
`border-collapse:separate; border-spacing:0`, 12.5px.
- `thead th`: sticky, `--bg-2`, 25px, 11px/600 `--txt-3`, 1px `--line` bottom, pointer,
  sort arrow `â²`/`â¼` 8px on the active column.
- `tbody td`: 5/9px, 1px `--line-soft` bottom, `white-space:nowrap`, middle-aligned.
- Rows: hover `--bg-2`; `aria-selected` `--bg-3`; `.ack` drops opacity to .55 on all cells
  except `.keep` (time, severity) so the queue reads triaged at a glance.
- Long text columns: `class="title"` (`max-width:1px; width:46%`) with an inner `<div>`
  carrying `overflow:hidden; text-overflow:ellipsis`.

### 5.8 Lists
`.tree`/`.layer` (layer rows: swatch, name, mono count, eye toggle; `.off` dims to
`--txt-4`), `.evrow` (diamond Â· title+meta Â· relative time â the universal signal row),
`.entrow` (watchlist), `.aoirow` (icon Â· name+meta Â· cadence), `.detrow` (change detection),
`.annrow` (annotation), `.doctoc` (`.briefrow` two-line, or `[page] [section]` single-line).

### 5.9 Floating layers
- **Tooltip** `#maptip`: fixed, `#20262c` on `--line-strong`, bold 12px line + 10px mono
  line, `--shadow`, 100ms fade, cursor +14/+14, viewport-clamped.
- **Command palette**: 600px at 12vh, `--bg-2` on `--line-strong`; 40px borderless input;
  results max 52vh; row = icon or severity diamond, label, grey sub-label, right-aligned
  kind; selected `--bg-4`; footer of key hints.
- **Toast**: bottom-right stack, `--bg-3` on `--line-strong`, 8/11px, auto-dismiss 3.2s.
  Toasts confirm actions; they never carry information the user must read.

### 5.10 Icons
One inline `<svg style="display:none">` sprite of ~45 `<symbol>`s on a 24Ã24 viewBox,
`fill:none; stroke:currentColor; stroke-width:1.4â1.6`. Referenced as
`<svg><use href="#i-globe"/></svg>`, sized by CSS (15px rail, 14px buttons, 12â13px inline,
30px empty states).

Required: `i-globe i-inbox i-dossier i-chart i-spark i-doc i-clock i-onto i-sat i-read
i-search i-plus i-bell i-layers i-eye i-eye-off i-print i-play i-pause i-target i-grid
i-reset i-add-brief i-flag i-check i-export i-link i-merge i-trash i-swipe
i-ship i-plane i-anchor i-pin i-poly i-path i-text i-measure i-cursor
i-collapse-l i-collapse-r i-north i-zoom-in i-zoom-out i-recentre
i-node-person i-node-org i-node-faction i-node-facility i-node-country i-node-corridor
i-node-event i-silh-plane i-silh-ship`.

Rules: monochrome, no fills (except the two 120Ã60 silhouettes), no two-tone, no rounded
app-icon containers, no icon font, **no emoji**. Draw as simple geometry. Icons never appear
without a label except in dense tool clusters, where `title` carries the name.

---

## 6. Data model

All state derives from two corpus objects: `window.HW` (core) and `window.HW2` (extended).
In production both are API-served. Field names below are normative.

### 6.1 Enumerations

```js
DOMAINS = {   // colour is a GREY â kept only so legends have distinguishable swatches
  conflict:{name:'Armed conflict',color:'#8d9aa4',short:'CONF'},
  maritime:{name:'Maritime & chokepoints',color:'#7d8993',short:'MARI'},
  cyber:{name:'Cyber & infrastructure',color:'#6f7b85',short:'CYBR'},
  energy:{name:'Energy & commodities',color:'#626e78',short:'ENRG'},
  trade:{name:'Trade & sanctions',color:'#55616b',short:'TRDE'},
  civil:{name:'Civil unrest',color:'#4a555f',short:'CIVL'},
  political:{name:'Political & legal',color:'#404b54',short:'POLI'}
}
SEVERITY = { critical:{color:'#c4453c',rank:4}, high:{color:'#b7822c',rank:3},
             moderate:{color:'#4f7fa6',rank:2}, low:{color:'#6d7883',rank:1} }
SOURCES = ['OSINT-WIRE','PARTNER-FEED','AIS-TRACK','GDELT-XR','FIELD-REP','SAT-TASK','GOV-ADVISORY']
REGIONS = ['EMEA','APAC','AMER']          // derived from ISO3 via lookup
```

### 6.2 Signal â the atomic record

```ts
interface Signal {
  id: string;            // 'HW-2400' â stable, mono-rendered, cited in briefings
  ts: Date;              // observation/ingest time, always rendered Zulu
  hoursAgo: number;      // derived; drives every time-window filter
  lat: number; lon: number;
  place: string;         // a named place, not a bounding box
  country: string; iso3: string;
  region: 'EMEA'|'APAC'|'AMER';
  domain: keyof DOMAINS;
  severity: keyof SEVERITY;
  conf: number;          // 0..1
  source: string;
  title: string;         // â¤96 chars, sentence case, no trailing period
  summary: string;       // 2â3 sentences of assessment, quantified
  impacts: string[];     // dependency names from the asset register
  status: 'new'|'ack'|'esc';
}
```

**Copy rules for `title`/`summary`** â these carry most of the credibility. Sentence case.
Lead with the observable, not the interpretation. Include one number where one exists
(`0.4pp`, `18nm`, `3.1 days`). Attribute plausibly ("vessel operators report"). No em
dashes, no emoji, no marketing adjectives, no claimed intent you cannot observe.

### 6.3 Entity â dossier subject

```ts
interface Entity {
  id, code;                       // 'ENT-RS-01', 'AOI-14'
  name; type: 'Corridor'|'Country'|'Region'|'Infrastructure';
  lat, lon;                       // centroid for the 1400km signal ring
  score: number;                  // 0..100 exposure index
  delta: number;                  // fortnight change, signed
  exposure: { sites, staff, suppliers, revenue };
  note: string;
}
```

### 6.4 Infrastructure, tracks and annotations (`HW2`)

```ts
interface Place  { id, kind:'port'|'airport', name, iso3, lat, lon, code }  // UN/LOCODE or ICAO
interface Vessel { mmsi, name, type, flag, lat, lon, hdg, spd, dest,
                   sanctioned: boolean, ais: 'on'|'dark', kind:'vessel' }
interface Aircraft { icao, callsign, type, role, lat, lon, hdg, alt, spd,
                     watch: boolean, kind:'aircraft' }
interface Annotation { id, kind:'point'|'line'|'area'|'measure', label, by, ts, note,
                       lat?, lon?, pts?: [lon,lat][] }
```

### 6.5 Observation areas and imagery (`HW2`)

```ts
// imagery view state (client-only, persists across scene changes within a session)
imageryView = {
  scene: string;                 // active scene id
  det: string|null;              // selected detection
  view: 'split'|'swipe'|'after';
  boxes: boolean;                // detection overlay on/off
  conf: number;                  // 0..1 confidence floor
  kinds: { new, expanded, removed };
  swipe: number;                 // handle position, percent
  blend: boolean;                // fade-under: reference visible beneath current
  opacity: number;               // 0..1 opacity of the current frame when blending
}

AOI_CLASSES = { airport, port, military, energy, urban, border, custom }  // auto:true on first four
DETECT_CLASSES = ['Aircraft','Helicopter','Vessel','Small craft','Vehicle','Revetment',
                  'Structure','Damaged structure','Container stack','Fuel bladder','Crane',
                  'Launcher','Berm']

interface AOI {
  id: string;                    // 'AOI-14'
  name: string;
  cls: keyof AOI_CLASSES;
  iso3: string; lat: number; lon: number; radiusKm: number;
  cadence: 'daily'|'3-day'|'weekly'|'monthly'|'on demand';
  status: 'active'|'paused'|'proposed';
  scene: string|null;            // most recent scene id
  owner: string;                 // analyst or 'System'
  auto: boolean;                 // machine-proposed from the infrastructure register
  notes: string;                 // standing tasking instruction
}

interface Scene {
  id: string;                    // 'SCN-4471'
  place, iso3, lat, lon, aoi;    // aoi = owning AOI id
  sensor: string;                // 'EO Â· 0.5m' | 'SAR Â· 1m'
  vendor: string;
  dateA: string; dateB: string;  // reference and current acquisition dates
  cloud: number; offNadir: number;
  counts: [label, current, delta][];      // object counts, reference â current
  changes: Change[];
}

interface Change {
  id: string;                    // 'CHG-05'
  label: string;
  type: 'new'|'expanded'|'removed';
  conf: number;                  // 0..1
  bbox: [x, y, w, h];            // PERCENT of frame â resolution-independent overlay
  note: string;                  // one or two sentences of analyst-readable meaning
}
```

`bbox` in **percent, not pixels** is deliberate: overlays then survive any frame size,
zoom level, or user-dropped image without recomputation.

### 6.6 Ontology (`HW2`)

```ts
NODE_TYPES = { person, org, faction, vessel, aircraft, facility, country, corridor, event }
LINK_KINDS = ['operates','owns','flagged in','transits','located in','affiliated with',
              'supplies','sanctioned by','observed at','controls','contracted to']

interface Node { id, type: keyof NODE_TYPES, label, risk: 0..100,
                 props: Record<string,string> }        // free-form, analyst-editable
interface Link { id, s, t,                              // source/target node ids
                 kind: LINK_KINDS[number],
                 conf: 0..1,
                 note: string,                          // the basis for the assertion
                 inferred: boolean }                    // derived: conf < 0.8
```

### 6.7 Supporting structures

`risk: Record<ISO3,1..5>` (choropleth) Â· `flows` (dashed great-circle corridors, all grey) Â·
`aois` (map watch boxes) Â· `analytics.volume` / `.movers` Â· `briefings` register Â·
`series(seed,n,base,amp)` â a **deterministic** LCG walk for sparklines and history charts.
Never `Math.random()` in a render path; repeated renders must be identical.

---

## 7. Ingestion and pipelines

### 7.1 Signal pipeline

Suggested feeds per domain, all public or commercially licensable:

| Domain | Candidate feeds |
|---|---|
| conflict | ACLED, GDELT 2.0, UN OCHA situation reports |
| maritime | AIS providers, IMB piracy reports, canal authority notices |
| cyber | CISA/ENISA advisories, national CERTs, cable-fault registries, vendor status |
| energy | EIA/IEA notices, operator statements, terminal loading schedules |
| trade | OFAC/EU/UK sanctions lists, customs and export-control bulletins |
| civil | GDELT protest events, labour-federation announcements, municipal notices |
| political | government advisories, regulator publications, court dockets |

Stages, each independently testable:
1. **Fetch** â per-source poller with backoff; store raw payload + fetch timestamp.
2. **Extract** â map to `Signal`. Geocode place strings via a gazetteer (Natural Earth
   populated places + a corridor/chokepoint table). **Reject records without a resolvable
   location; never guess coordinates.**
3. **Classify** â `domain` by keyword/model; `severity` by the rules below; compute `conf`.
4. **Deduplicate** â cluster within 25km / 12h / title cosine > 0.7; keep the earliest,
   +0.05 `conf` per corroboration (cap 0.97), record `sources[]`.
5. **Enrich** â intersect location with the asset register (sites, supplier addresses, route
   geometries, network paths) to populate `impacts[]`; attach affected entities.
6. **Score** â recompute each entity's `score`/`delta` (Â§8.4).
7. **Publish** â write to the read store; push over WebSocket.

**Severity rules** (deterministic and auditable â never model-only):
- `critical` â loss of life or facility damage inside an exposure ring; corridor closure or
  interdiction; confirmed outage of a dependency with no tested alternative.
- `high` â measurable degradation (delays, restrictions, partial capacity loss) touching a
  named dependency, or an advisory change.
- `moderate` â confirmed change of context with no current operational effect.
- `low` â watch item, or the resolution of a previous issue.

**Confidence** starts at source base reliability (partner .80, government advisory .78,
AIS .84, OSINT wire .66, field report .74), then +.05 per independent corroboration,
â.10 single-source social origin, â.05 inferred location. Round to two decimals.

### 7.2 Live track ingestion

- **AIS** (vessels): terrestrial + satellite feeds. Poll â¤60s. Keep `mmsi, name, type, flag,
  lat, lon, hdg, spd, dest`. Derive `ais:'dark'` when a hull with a recent history stops
  transmitting for longer than its class-typical gap â dark status is a *finding*, not a
  data error, and must be surfaced.
- **ADS-B** (aircraft): `icao, callsign, type, lat, lon, hdg, alt, spd`. Derive `role` from
  the type/operator table.
- **Screening**: join `mmsi`/`icao`/owner against restricted-party lists on every refresh.
  A match sets `sanctioned`/`watch`, which is the **only** thing that turns a track red.
- Render at most ~500 tracks per viewport; above that, cluster by cell.

### 7.3 Satellite change detection (the Imagery module)

**Source.** Sentinel-1 (SAR, ~5â20m, all-weather) and Sentinel-2 (optical, 10m, 5-day
revisit) from the Copernicus Open Access Hub / Data Space, optionally supplemented by
commercial sub-metre EO for high-value areas. Scene metadata carries acquisition datetime,
cloud fraction, off-nadir angle and processing level.

**Automated scan loop, per AOI:**

1. **Task** â every AOI has a `cadence`. A scheduler enumerates due AOIs and queries the
   archive for the newest scene intersecting `(lat, lon, radiusKm)` that meets quality gates
   (optical: cloud â¤ 20%, off-nadir â¤ 30Â°; SAR: same-orbit, same-polarisation as reference).
2. **Pair** â the new scene becomes **B**; **A** is the stored reference for that AOI (the
   last accepted scene of the same sensor and geometry). Comparing across sensors or orbits
   produces false positives â never do it.
3. **Co-register** â orthorectify and align A and B to sub-pixel accuracy; radiometrically
   normalise optical pairs, apply speckle filtering to SAR.
4. **Detect** â two models, run together:
   - *object detector* over B alone, emitting counts per `DETECT_CLASSES` with boxes;
   - *siamese change model* over the (A, B) pair, emitting change regions typed
     `new` / `expanded` / `removed`.
   Counts are differenced against A's stored counts to produce the `[label, current, delta]`
   rows. Boxes are normalised to **percent of frame** before storage.
5. **Filter** â drop detections below the AOI's confidence floor; suppress known seasonal or
   tidal change classes; suppress boxes that recur identically in â¥3 consecutive scenes
   (persistent false positive).
6. **Interpret** â map raw deltas to analyst-readable findings, which is what the UI shows:
   `+37 Vehicle, +6 Revetment` â *"New hardened revetments"*;
   `â60 Accommodation unit, â2 Crane` â *"Contractor camp partially demobilised"*;
   `+11 Small craft` â *"Small-craft cluster doubled"*;
   `+n Damaged structure` â *"Increased structural destruction in the northern district"*;
   `+n Container stack, +n Vessel` â *"Increased port activity"*.
7. **Route** â findings above a severity threshold, or in an AOI flagged for auto-raise,
   are emitted as `Signal` records (`source:'SAT-TASK'`) into the inbox, and the scene is
   linked to the AOI.
8. **Review** â an analyst confirms or rejects each detection. Both actions are model
   feedback; a confirmed detection updates the AOI's reference counts.

**Auto-derived coverage.** When an analyst scopes to a country (or opens a dossier), the
system proposes standing AOIs over its critical infrastructure from the register: every
port, airport, military base, and energy facility inside the scope becomes a `proposed` AOI
at a default cadence and radius (6km ports, 4km airfields). Proposed areas render dimmed
until accepted; accepting promotes them to `active` and starts the scan loop.

### 7.4 API surface

```
GET   /api/signals?window=72h&domains=&minSeverity=&region=   â Signal[]
GET   /api/signals/:id                                        â Signal + sources[] + nearby[]
PATCH /api/signals/:id                { status }
GET   /api/entities            /api/entities/:id/signals?radiusKm=1400
GET   /api/analytics?range=30d&region=&domain=
GET   /api/risk                                               â Record<ISO3,1..5>
GET   /api/tracks?bbox=                                       â Vessel[] | Aircraft[]
GET   /api/infrastructure?bbox=                               â Place[]
GET   /api/aois            POST /api/aois            PATCH|DELETE /api/aois/:id
POST  /api/aois/derive                { iso3 }                â AOI[] (status 'proposed')
GET   /api/scenes?aoi=                                        â Scene[]
POST  /api/scenes/:id/detect          { model, minConf }      â Change[]
PATCH /api/changes/:id                { review:'confirmed'|'rejected' }
GET   /api/ontology                                           â { nodes, links }
POST|PATCH|DELETE /api/ontology/nodes|links
GET|POST|PATCH|DELETE /api/annotations
POST  /api/briefings   { title, scope, audience, horizon, sections[], classification,
                         instruction, signalIds[] }           â { id, sections, meta }
WS    /api/stream      signal.created | signal.updated | entity.rescored |
                       track.moved | scene.ingested | detection.raised
```

**Client rule: filtering is always local** over the loaded window. Every facet count, legend
count and histogram bucket recomputes from one `visible()` selector, so the layer panel, the
legend, the pane header and the density strip can never disagree.

---

## 8. Module specifications

### 8.1 Global state and the module contract

```js
state = {
  module, tabs:[{id,mod,label}], tab,
  sel,                              // selected signal id
  basket: [],                       // signal ids queued for the next briefing
  win: 72, sevFloor: 1,             // hours, minimum severity rank
  domains: Set, ctx:{risk,grat,labels,flows,aoi,arcs},
  proj: 'world',
  inbox:{sort,dir,status,q,sel}, unread, doc
}
visible = () => events.filter(e =>
  e.hoursAgo <= state.win && state.domains.has(e.domain) &&
  SEVERITY[e.severity].rank >= state.sevFloor);
```

Files extend each other through a small published surface â this is what lets the console
be three script files instead of one:

| Global | Owner | Purpose |
|---|---|---|
| `HW`, `HW2` | data files | the corpus |
| `HWopen(mod, label?)` | app | switch module, reuse/retitle its tab |
| `HWselect(id, {pan})` | app | select a signal, optionally centre the map |
| `HWbasket(ids)` | app | add signals to the briefing basket |
| `HWtoast(msg, kind?)` | app | confirmations |
| `HWreveal()` | app | un-minimise the inspector before writing to it |
| `HWrowHTML(e)` / `HWbindRows(root)` | app | the universal signal row |
| `HWmap` | app | `projection, path, k, layer(name), flyTo, ping, invert, redraw, tip` |
| `HWmapHooks[]` | app | `{draw(projection,path,k), zoom(k)}` â extra map layers |
| `HWM` | modules | `onModule(id)`, `openEntity`, `openBriefing`, `renderEvidence` |
| `HWMcore` | modules | read access to replay state and the loaded document |
| `HWX` | extensions | `onModule(id)`, `openOntology`, `replayOnMap`, `renderReader` |

`HWM.onModule` calls `HWX.onModule` last, so extension modules initialise after core ones.

### 8.2 Situation â `#view-map`

**Left glass pane â Layers (250px).** Header `Layers`, ghost verbs `all`/`none`, and a
collapse chevron. Collapsible groups:
1. **Event domains** â swatch, name, window count, eye toggle. Row click toggles.
2. **Context layers** â Country risk index, Graticule 10Â°, Trade & energy flows, Areas of
   interest, Marker labels, and one deliberately unavailable layer (*Satellite tasking
   (none)*) that toasts honestly when clicked. Real tools have unavailable capabilities;
   showing one is more convincing than faking everything.
3. **Severity floor** â four chips, single select, default `Low+`.
4. **Time window** â `24h / 72h / 7d / 30d`, default 72h.
5. **Live tracks** â Vessels (AIS), Aircraft (ADS-B), *Sanctioned/watchlisted only*,
   Ports & airports; each with a count and eye toggle.
6. **Annotations** â the annotation register with inline rename, fly-to and delete.

**Header band (full width, above the glass).** `Global situation` Â· live count
`42 signals Â· 72h window` Â· the annotation toolbar Â· the quick-layer buttons Â· projection
segment `world / emea / apac / amer`.

**Map.**
- `d3.geoEquirectangular()`; per view `projection.fitExtent([[padL,6],[w-padR,h-6]], box)`
  where `padL/padR` are read from `--pane-l`/`--pane-r`, and the boxes are
  `world [[-170,78],[178,-58]]`, `emea [[-22,62],[62,-12]]`, `apac [[62,46],[150,-12]]`,
  `amer [[-128,52],[-32,-46]]`.
- `d3.zoom().scaleExtent([1,14])` on the `<svg>`; the transform goes on one root `<g>`.
  **Counter-scale every glyph** (`translate(projected) scale(1/k)`) and divide land stroke
  width by `k`, so marker size and hairlines stay constant. Double-click zoom disabled.
- Layer order: sphere â graticule â land â flow arcs â AOI boxes â infrastructure â
  annotations â tracks â signal markers â ping/sequence effects. Markers sort by ascending
  severity rank each draw so critical glyphs are never occluded.
- **Signal marker**: `<rect>` rotated 45Â° (9/8/7px by severity), severity fill, 1px ocean
  stroke, opacity .55 when acknowledged; critical adds an 11px halo. Labels (optional) sit
  right at 8.5px mono with a 2.6px `paint-order:stroke` halo.
- **Vessel glyph**: hull outline rotated to heading, with a dashed wake astern. Blue-grey
  normally, **red when sanctioned**. **Aircraft glyph**: airframe rotated to heading, amber
  when watchlisted. Names appear above zoom 2.2Ã. **Ports**: circle + anchor. **Airports**:
  airframe mark. Both labelled with their code.
- Hover shows the tooltip; over land, the country name and its risk index.

**Annotation tools** (in the header band): select Â· marker Â· route Â· area Â· measure.
Click to add points, double-click to finish. Measure reports km **and** nm along the path.
Committing focuses an inline rename in the register. Annotations are gold `#c8a04a`,
distinct from every data colour so they never read as findings.

**Navigation cluster** (bottom-right): zoom in Â· live zoom readout Â· zoom out Â· recentre Â·
fit-all-signals Â· north-up compass, as one bordered stack.

**Coordinate block** (bottom-left, no background): `LAT +24.2013 LON +119.6042` in four
decimals, and a scale bar with a km figure.

**Density strip** (98px, below the map): 60-bucket histogram of the window, buckets with
critical/high in `#8d5348`, a time axis (`%H:%MZ` under 7 days, `%d %b` above), window
bounds in mono, and a ghost link `open replay â`.

**Right glass pane â Inspector (312px).** Three states:
- *Nothing selected* â Situation summary: 2Ã2 statistic grid, by-region bars, the severity
  legend, and the six newest critical signals.
- *Signal selected* â severity/domain/source tags, 15px title, **Assessment** card,
  **Geolocation** `.kv`, **Exposure touched** chips, actions (`add to briefing`,
  `centre map`, `open dossier`), severity legend, and **Nearby signals Â· 800km**.
- *Track selected* â a photo panel first (`<image-slot>` drop target over an airframe or
  hull silhouette, with a caption strip), then the track `.kv`, a screening note for
  sanctioned hulls, and actions (`centre map`, `open in ontology`, `annotate position`).

Selecting anything calls `HWreveal()` first, so a minimised inspector slides back in rather
than rendering into a hidden pane.

### 8.3 Inbox â `#view-inbox`

Left: read-only distribution facets (severity, region, source) for orientation.
Centre toolbar: status segment (`all / unread / acknowledged / escalated`), a 250px filter
matching title/place/country/source/ID, live count, then `acknowledge`, `escalate`,
`add to briefing`.

Columns: Received (96px mono `hh:mmZ`) Â· Severity (104px) Â· Signal (46%, ellipsised, `ESC`
tag when escalated) Â· Location (150px, place + grey ISO3) Â· Domain (112px code tag) Â·
Confidence (112px bar + integer) Â· Source (118px mono).

Behaviour: header click sorts, re-click flips; **selecting a `new` row marks it `ack` and
decrements the rail badge â reading *is* triage**; `j`/`k` move through the sorted, filtered
rows; the first row is selected on entry so the detail pane is never empty.

Right: severity/domain/ID header, title, summary, **Source chain** (primary + time,
corroboration count with `Multi-source`/`Single-source`, analyst state), exposure chips, and
three actions. `show on map` switches module, pans and selects â **cross-module continuity
is mandatory**: any signal is reachable in the map, dossier, replay, reader and generator
from wherever it is seen.

### 8.4 Dossiers â `#view-dossier`

Left: watchlist rows (code, name, type, banded score, delta triangle).
Centre header: code + type, state tag (`Deteriorating`/`Stable`/`Improving`), 19px name,
standing note, actions (`brief this entity` â pushes six ring signals to the basket and
opens the generator; `show exposure on map`; `alerting on`), a 96px gauge (6px ring, banded
arc, mono value) and a 168Ã42 sparkline with `min Â· max Â· now`.

Tabs: **Overview** (six-cell statistic grid, signal mix by domain, generated analyst
judgement) Â· **Exposure** (dependency table: substitutable, single point of failure) Â·
**Risk drivers** (five weighted bars) Â· **History** (area chart + recent ring signals) Â·
**Linked entities** (shared-dependency counts, `open â`).

Right: every signal within 1400km of the centroid, newest first.

```
score = clamp(0..100,
    40*severityWeight      // Î£(rankÂ²) of ring signals, normalised
  + 25*dependencyWeight    // matched impacts / total dependencies
  + 20*persistence         // share of last 14 days with â¥1 ring signal
  + 15*corroboration)      // mean confidence of ring signals
delta = score â score(14 days ago)
```

### 8.5 Analytics â `#view-analytics`

Toolbar: range (`7d/30d/90d`), region select, domain select, `export csv`. All recompute
from one `anEvents()` selector. Blocks in order: **KPI strip** (12 ledger cells) â
**Signal volume** area chart â **four donuts** (severity in severity colours; domain, region,
source in grey ramps; 96px, 40/26px radii, total in the hole, native `<title>` for hover) â
**Region Ã domain heatmap** (22px cells, single neutral ramp) beside **Index movers** â
**Highest-severity signals** table with a `brief these` action; row click jumps to the map.

### 8.6 Generate â `#view-generate`

Left: title, scope, audience, forecast-horizon segment, six section checkboxes,
classification, and a standing-instruction textarea.
Centre: the corpus as a checkbox grid sorted by severity then recency, with
`select top 12 by severity` and `clear`; the briefing basket merges in on entry; a 2px
progress line at the foot.
Right: a seven-step checklist, the agent log, and run controls plus a direct
**printable-briefing** button (enabled once a run completes).

Step durations (ms) â **timing is information; instant completion reads as fake**:
```
Resolve parameters and scope           260
Assemble evidence set                  420
Deduplicate and cluster signals        700
Score exposure against asset register  820
Draft judgement and section text      1400
Apply house style and classification   520
Compile document and paginate          480
```
Step states: pending (index in a grey ring) Â· running (spinning `--acc-hi` ring) Â· done
(tick, green ring, elapsed time right-aligned).

Log grammar â mono, `pre-wrap`, auto-scrolled, `<b>` white, `<i>` green, `<u>` amber:
```
horizon-brief v4.2 Â· session K3F9QA
scope=global horizon=30 days evidence=12 signals
resolved 12 signals Â· 9 countries Â· 5 domains
  + HW-2400 Bab el-Mandeb critical
clustered into 4 themes Â· dropped 0 duplicates
asset register matched Â· 27 dependency hits
drafted 6 sections Â· 2280 words
style pass complete Â· classification INTERNAL // RISK
document compiled Â· 4 pages
ready â opening in the reader
```

Guard `runGeneration()` with `if (M.gen.running) return;` **and** make every exit path clear
the flag â a throw between "started" and "finished" otherwise wedges the generator until
reload. An empty evidence set warns and does nothing.

On completion: build the document object, unshift it into the register, toast, open a **new
tab titled `BRF-0436 Â· <title>`**, and land in the **reader**.

**With a real LLM**, keep the staged UI and send one structured request:
```
System: You are an intelligence editor for a corporate risk team. Write in British English,
sentence case, plain declarative prose. No adjectives of emphasis, no em dashes, no emoji,
no hedging clichÃ©s. Quantify only what the evidence states. Cite signal IDs inline. Never
invent events, sources, casualties or attribution.
User: {classification, audience, scope, horizon, standing_instruction,
       signals:[{id,ts,place,country,domain,severity,conf,source,title,summary,impacts}],
       imagery_findings:[{scene,aoi,label,type,conf}], asset_register_matches:[â¦]}
Return JSON: { judgement, second_para, bottom_line,
               themes:[{domain,text,bullets[]}], warnings[], actions[[text,owner,by]] }
```
Validate against the schema; on a missing field fall back to the deterministic templates
(Â§10.2) rather than shipping an empty section.

### 8.7 Replay â `#view-replay`

Toolbar: grouping segment (`by region / by domain / by severity`) and a mono cursor clock.
Ruler: a 128px lane gutter plus 13 ticks at `hh:mmZ`. Lanes: one per group, each signal a
10px rotated square at `left:(tsât0)/windowÃ100%`, 1.4Ã on hover, white outline when
selected, 22% opacity when **after** the cursor. Playhead: 1px amber rule with a triangular
head. Transport: play/pause, 0â1000 scrub, speed (`1Ã/4Ã/12Ã`, default 4Ã), live `n shown`.
Playback advances `t += 0.0016 Ã speed` every 40ms and pauses on leaving the module.

**Right pane leads with a 196px locator minimap.** Clicking a lane event focuses it there:
the map re-frames to Â±18Â°, drops a severity-coloured diamond, pings twice, and plots
surrounding signals within 1600km as small grey diamonds.

**`replay on map`** performs the flagship animation: switch to Situation, select the signal,
fly to it at 4.6Ã, ping, then walk the preceding â¤36h of signals within 1600km in
chronological order â each drawing a dashed severity-coloured line converging on the event
plus an expanding ring, 420ms apart â then clear. This is the "show me what happened" gesture
and it is reachable from replay, the reader, and any signal row.

### 8.8 Ontology â `#view-ontology`

**A fixed diagram, not a floating force graph.** Objects sit in four ontological tiers:

```
TIER = { country:0, corridor:0, faction:1, org:1, person:1,
         facility:2, vessel:2, aircraft:2, event:3 }
TIER_NAME = ['Geography', 'Actors', 'Assets & sites', 'Observations']
```

Geography contains actors; actors operate assets; assets produce observations. Each tier is
a labelled band with a dashed rule. Within a tier, order is settled by **three barycentre
passes** over neighbour indices (seeded by descending risk) so links run short and mostly
vertical. Nodes are spaced at a fixed 112px step with a 26px alternating stagger, then
**pinned** (`fx`/`fy`). The layout is computed once per node set, keyed by
`nodes+types+layout`; a dragged object stays exactly where the analyst put it. Nothing drifts.

The diagram may exceed the viewport; an **auto-fit** transform frames it on open (clamped
0.3â1.2Ã), applied synchronously (Â§2.1). `layered / radial` and an explicit rebuild button
recompute deliberately.

**Node plate**: 92Ã40, `--bg-2` on `--line-strong`, a 15px type icon, the label, a
`type Â· risk` sub-line, and a 3px risk-banded strip at the bottom edge.
**Links**: curved orthogonal paths leaving plate edges (not straight chords), dashed when
inferred, thicker when `conf â¥ .9`, with the relationship word at the midpoint.

Left pane: type legend with counts (click to filter), a link-confidence floor slider, a
*Show inferred links* toggle, and saved investigations.
Toolbar: find, layout, rebuild, `new object`, `link objects` (two-click mode), `plot on map`,
`brief selection`.
Right pane: object editor (label, type, risk slider, add/remove free-form properties, link
list) or link editor (type, confidence slider, basis text, delete). Double-click a node
expands its neighbourhood by clearing filters. `locate` flies the map to the object's
geometry when it has any.

### 8.9 Imagery â `#view-imagery`

**Left pane â observation areas.**
- *Scope*: a country select plus **`propose coverage for scope`**, which derives AOIs from
  the infrastructure register (Â§7.3) and inserts them as dimmed `proposed` rows.
- *Areas*: class icon, name, `id Â· class Â· radius`, and the cadence (or `proposed`).
  Inline rename on a second click. Selecting an area loads its most recent scene.
- *Scenes*: the scene register for the current area.
- *Detector*: model select (`hw-changedet v3 (siamese)` / `hw-objdet v5 (aerial)` /
  `hw-sar-delta v2`), a confidence floor, three change-type toggles, and `re-run detection`
  which drives the progress line and returns findings.

**Centre â the comparison.** Toolbar shows `SCN-4471 Â· Chernyakhovsk airbase Â· 2026-06-14 â
2026-08-29 Â· Commercial optical`, a view segment (`split / swipe / after only`), a
detections toggle, the **fade-under** control (swipe only), `raise signal`, and
`add to briefing`.

- **split** â reference and current side by side, boxes on the current frame only.
- **swipe** â two stacked frames: the reference fills the pane, the current frame is clipped
  over it by a draggable 2px handle. The classic before/after gesture.
- **after only** â a single full-width frame.

**Fade under (swipe only).** A checkbox plus an opacity slider (0â100%, default 55%). When
off, the handle produces a hard cut â right of it is purely the reference scene. When on,
the clipped current frame is rendered at the chosen opacity so the **reference scene shows
through underneath it**, and the reference frame is desaturated 35% (`filter:grayscale(.35)`)
so the two can be told apart. This makes slow or partial change legible â subsidence, new
foundations, gradual dispersal â without dragging the handle back and forth. The slider
writes `style.opacity` on the clip element **directly, without re-rendering**, so the
crossfade is continuous while dragging. The control hides in `split` and `after only`, where
it has no meaning, and its state persists when returning to swipe.

Each frame is an `<image-slot>` drop target with a header strip carrying the acquisition
date, sensor, cloud fraction and off-nadir angle â so an analyst can drop the real Sentinel
tiles and the percent-based detection boxes land correctly on top.

**Detection boxes**: 1.2px outline in the change-type colour (removed is dashed), a small
`CHG-05 Â· 93%` label above, hover/selected fill at 12%.

**Right pane â the AOI editor first** (name, class, cadence, radius slider, standing note,
centre/owner/status, then `save area`, `accept`/`pause`, `locate`, `delete`), then
**Detections** (typed rows with confidence, `confirm` / `reject` as model feedback), the
selected finding's note and provenance, and **object counts** reference â current with
signed deltas.

### 8.10 Briefings (reader) â `#view-reader`, and the print layout â `#view-doc`

**They are one artefact.** The reader is the rail destination; the print layout is a *view*
of the same document object, so the hyperlinked text and the paginated pages can never
diverge. Routes: reader `printable briefing` â print layout; print layout `back to reader`;
generator's print button â print layout; generation completes â reader.

**Reader.** 720px measure, 13.5px/1.68 body. Every claim that has a record behind it is an
`.xref` â a dotted-underlined span carrying `data-k` (`signal` / `scene` / `node` / `region`)
and `data-id`. Clicking one:
1. marks it active,
2. loads the record into the right pane, and
3. drives a **196px context minimap** â re-framed, pinged, with surrounding context plotted.

Reference panes offer onward actions: a signal gets `open on map`, `animate lead-up`
(Â§8.7) and `open in inbox`; a scene gets `open change detection`; an ontology object gets
`open in ontology`; a region lists its signals. The left pane holds the briefing register and
an enumerated index of every reference. **`guided walkthrough`** steps through all
references at 3.6s intervals, scrolling each into view â a self-presenting briefing.

**Print layout.** 816Ã1056px pages (US Letter @96dpi), `#f4f2ee` paper, `#1b1f24` ink,
62/70/54px padding, `flex-direction:column` so the folio sits at the bottom via
`margin-top:auto`. **Body type is serif** â this single choice does more for the "issued
document" feel than anything else. Section headings are sans, 12px/700, uppercase, .09em,
over a `#b9b5ac` rule. Zoom segment (75/100/125% via `transform:scale`), `print / pdf`,
`distribute`.

Page plan (3 pages for 12 signals; more as the set grows):
1. Kicker, H1, rule, metadata table, **Executive judgement** (lede + support + `Bottom line.`
   callout), **Signals driving this assessment** (9-row table).
2. **Assessment by theme** (H3 per domain, generated paragraph, up to three cited bullets),
   **Regional distribution** table.
3. **Exposure and continuity impact** (dependency table with severity peak and standing
   mitigation), **Indicators and warnings**, **Recommended actions** (numbered, owner, D+n),
   **Sourcing and method**.

```css
@media print{
  @page{margin:0;size:letter}
  body{overflow:visible;background:#fff}
  #app{display:block;height:auto}
  .topbar,.tabstrip,.statusbar,#toasts,.scrim,.doctools,.docaside{display:none!important}
  .view{display:none!important}
  .view#view-doc{display:block!important;overflow:visible;height:auto}
  .docdesk{overflow:visible;height:auto;padding:0;background:#fff}
  #view-doc .panes{display:block!important}
  .pane{border:0!important}
  .docpage{box-shadow:none;margin:0;width:8.5in;min-height:11in;padding:.72in .8in .6in;
           break-after:page}
  .docpage:last-child{break-after:auto}
}
```

---

## 9. Cross-module behaviour

### 9.1 Command palette (âK / Ctrl+K)
Indexes modules, entities, signals and briefings. Substring match on label + sub-label,
capped at 40. `ââ` move, `âµ` opens, `Esc` closes. Signals show their severity diamond.
Selecting performs the **full** navigation (open module, retitle tab, select record, pan
map). This is the only search â there is no separate results page.

### 9.2 Keyboard map

| Key | Action |
|---|---|
| `âK` / `Ctrl+K` | command palette |
| `1`â`9` | switch module |
| `j` / `k` | next / previous signal (Inbox) |
| `Esc` | close palette, blur field |
| `â â âµ` | navigate / open palette results |
| `âP` | print the loaded briefing |

Every handler checks `ev.target.matches('input,textarea')` before acting.

### 9.3 The briefing basket
A global list of signal ids, surfaced in the status bar, fed from the inspector, the inbox,
the analytics table, dossiers, the ontology, the imagery module and the replay window, and
consumed by the generator. It is the connective tissue: everything the analyst notices
anywhere can become part of the next briefing without leaving the module they are in.

### 9.4 Live telemetry
A single 1s interval updates the UTC clock, the ingest counter (`118 + rand(24)`/min) and
the latency readout (`36 + rand(14)` ms). **This is the only ambient motion.** No pulsing
cards, no marching ants, no count-up statistics on module entry.

### 9.5 Motion budget

| Element | Duration | Easing |
|---|---|---|
| Hover / press | 100ms | linear |
| Tooltip fade, palette open | 100 / 120ms | linear |
| Panel slide / minimise | 240â260ms | `--ease` |
| Map view change / centre / fly | 420 / 520 / 620ms | d3 (sync fallback) |
| Ping, lead-up pulse | 1300 / 900ms | stepped cubic-out |
| Graph auto-fit | synchronous | â |
| Toast in / out | 0 / 300ms | linear |

No bounce, no spring, no scale-on-hover, no list entrance animations.
`prefers-reduced-motion` collapses everything to 0.01ms.

### 9.6 Accessibility
`role="tablist"` on the rail; `aria-selected` on rail buttons, tabs and rows; `aria-pressed`
on every toggle; `aria-expanded` on collapsible headers; visible
`:focus-visible{outline:1px solid var(--acc-hi)}`. `--txt` on `--bg-1` â 11:1; `--txt-3`
â 4.8:1; `--txt-4` is never used for text a user must read. **Severity is never colour
alone** â the diamond is always paired with the severity word.

### 9.7 Performance
One `visible()` pass per interaction, memoised on (window, domains, floor). d3 joins keyed
by id â never rebuild the marker layer. Virtualise tables beyond ~500 rows (fixed row heights
make this trivial). Cache the basemap; cluster tracks beyond ~500 per viewport.

---

## 10. Generated language

Declarative, quantified, unemphatic, British English, sentence case. No em dashes, no emoji,
no adjectives of intensity.

### 10.1 Micro-copy rules
Buttons are lower-case verbs (`add to briefing`, `escalate`, `centre map`, `propose coverage
for scope`). Labels are nouns without colons. Toasts are complete statements of fact
(`HW-2400 escalated to group security`, `6 areas proposed from the infrastructure register â
accept to task them`). Empty states say what would be here and how to fill it. Warnings are
neutral, never alarmist.

### 10.2 Deterministic templates (fallbacks and reference behaviour)

**Analyst judgement (dossier)**
```
{name} sits at {score} on the exposure index, {up|down|flat} {|delta|} points over the
fortnight. {n} signals fall inside the exposure ring, {crit} of them critical.
{crit ? 'Treat the corridor as constrained for planning purposes and hold the contingency
routing in place.' : 'No change to continuity posture is warranted on current reporting.'}
```

**Executive judgement (briefing lede)**
```
{n} signals meet the reporting threshold for this cycle, {crit} of them critical and {high}
high. Activity concentrates in {regions with counts}. The single most consequential
development is {place}: {lowercased title}. Over the next {horizon} we assess corridor and
routing risk as the binding constraint on operations, ahead of fixed-asset or personnel risk.
```

**Supporting paragraph**
```
By theme the set is dominated by {top three domains with counts}. Confidence across the set
averages {mean}%, with {k} signals corroborated by more than one feed. Overhead imagery of
{scene place} supports the assessment: the change detector returned {n} findings against the
{dateA} reference scene.
```

**Theme paragraph**
```
{n} signals in this theme, centred on {up to three places}. The severity peak is {severity},
set by {place}. Operationally the theme bears on {up to three impacts}.
```

**Indicators and warnings** â one falsifiable trigger per domain present, plus one standing
rule:
```
maritime â A second interference event in the same corridor inside seven days would move the
           corridor index above 90 and trigger the pre-agreed rerouting clause.
conflict â Movement of front lines within 50km of a contracted facility requires an immediate
           duty-of-care review.
cyber    â A confirmed second subsea or terminal-system fault in the same basin would
           indicate deliberate action rather than accident.
trade    â A further designation round touching a tier-1 supplier would suspend two open
           purchase orders pending screening.
imagery  â Recurrence of the same change class at this AOI on the next pass would move the
           finding from indicative to confirmed.
always   â Any single signal at critical severity uncorroborated after 24 hours should be
           downgraded rather than carried forward.
```

**Recommended actions** â five rows above six signals, three otherwise; owners from
`Logistics / Compliance / Regional security / Group security / Intelligence`; deadlines `D+0â¦D+10`.

---

## 11. Build order

Each step independently verifiable.

1. **Tokens and frame** â Â§3 + the four-row grid, top bar, tab strip, status bar.
   *Verify:* nothing scrolls the page; bars are pixel-exact; no clipped cells at 1280px.
2. **Corpus** â 40+ signals across all domains/severities/regions, 10 entities, risk index.
3. **Rail, tabs, view switching.** *Verify:* `.view{height:100%}`; every scroll container is
   `flex:1;min-height:0`.
4. **Map** â projection, basemap, land, graticule, markers, counter-scaled zoom, tooltip,
   cursor readout, **Â§2.1 rAF probe and `applyZoom`**.
5. **Layer panel** wired to `visible()`; legend, header count and layer counts must agree.
6. **Inspector** (three states) and the density strip.
7. **Glass panels, collapse rails, the full-width header band** (Â§4.6).
8. **Inbox** â grid, sort, filters, keyboard, status transitions, cross-module jumps.
9. **Dossiers** Â· 10. **Analytics** Â· 11. **Generator** (staged run, log, basket).
12. **Reader + print layout** as one artefact.
13. **Replay** â lanes, playhead, transport, locator minimap, `replay on map`.
14. **Ontology** â tiers, barycentre ordering, pinned layout, auto-fit, editors.
15. **Imagery** â AOI registry, derive-coverage, split/swipe/after, detection overlay,
    counts, review actions.
16. **Annotations, live tracks, infrastructure.**
17. **Palette, toasts, telemetry, keyboard map.** 18. **Â§12 pass.**

---

## 12. Acceptance checklist

Any "no" is a defect, not a preference.

**Type and colour**
- [ ] No `@font-face`, no font CDN.
- [ ] `--mono` appears only on figures (Â§ Rule 2) â never a heading, button, tag or label.
- [ ] `text-transform:uppercase` only on the classification chip, code tags, tier band labels
      and printed section headings.
- [ ] No hue outside: neutral greys, one accent blue, four severity colours, two delta
      colours, annotation gold.
- [ ] No gradient; no `box-shadow` on a non-floating element; no `border-radius` > 2px.

**Layout**
- [ ] At 1280Ã720 no pane is clipped and no text wraps inside a control.
- [ ] `elementFromPoint` on every map-header control returns that control (nothing under glass).
- [ ] Zero `.statusbar .cell` and zero `.timestrip .head` children with
      `scrollHeight > clientHeight`.
- [ ] Every scrollable pane scrolls.
- [ ] Minimising either Situation panel reflows the map fit and all overlays, and the panel
      **transitions** out and back (transform reaches `-30px` / returns to `0`) rather than
      jumping â the animation-fill trap.
- [ ] Every toolbar's `scrollWidth` fits its pane at 1280px; `elementFromPoint` returns the
      control itself for every toolbar action on imagery, ontology and inbox.

**Behaviour**
- [ ] Zoom in / out / recentre / fit change `svg.__zoom.k` **within 100ms of the click**
      (the rAF trap â test with animation frames throttled).
- [ ] `flyTo` and `ping` work with rAF disabled.
- [ ] Filter counts agree across layer panel, legend, pane header and histogram.
- [ ] A signal selected anywhere opens in map, dossier, replay, reader and generator.
- [ ] Selecting a track or signal un-minimises the inspector.
- [ ] No `prompt`/`confirm`/`alert` anywhere; every create flow uses an inline field.
- [ ] Closing the last tab reopens Situation.
- [ ] Generating with an empty set warns; with 12 signals it produces a 3-page document in
      ~4.6s and lands in the reader; the generator never wedges on a repeat run.
- [ ] Reader references drive both the context minimap and the right pane; `animate lead-up`
      plays.
- [ ] Ontology node positions are byte-identical 1.2s after layout; zero plate overlaps.
- [ ] Imagery: swipe handle drags; detection boxes track the frame at any size; deriving
      coverage inserts `proposed` areas that promote on accept.
- [ ] Fade-under appears only in swipe mode, writes opacity live without a re-render, and
      desaturates the reference frame so the two scenes stay distinguishable.
- [ ] `print / pdf` produces pages with no app chrome, one page per sheet.
- [ ] Console clean after visiting all ten modules.

**Credibility**
- [ ] Sample data labelled in the status bar.
- [ ] At least one capability honestly unavailable rather than faked.
- [ ] Every number rendered is computed from the corpus â no hard-coded totals in markup.
- [ ] Prose contains no em dashes, no emoji, no marketing adjectives.

---

## 13. Deliberate choices (do not "fix" these)

- **Desktop only.** No breakpoints below 1280px; this is a workstation.
- **Domains carry no colour.** Code tags and position distinguish them. This is the single
  biggest reason the interface reads as professional.
- **Only four severity colours**, reused by change detection. A fifth destroys the hierarchy.
- **Reading marks as acknowledged.** Triage is a side effect of attention.
- **The generator takes ~4.6 seconds.** Latency is information.
- **The briefing is serif on paper stock.** It is a document, not a screen.
- **The ontology never animates into place.** Analysts memorise spatial position; drift
  destroys that.
- **Glass is used once, on side panels only**, so the map reads as one continuous surface.
  It is not a decorative motif to spread across the app.
- **No dark/light theme toggle.** One considered surface beats two mediocre ones.


