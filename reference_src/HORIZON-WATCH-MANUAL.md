# Horizon Watch â Complete System Manual
### v3.0 Â· the full build, end to end

**Reference implementation, 14 files, no build step:**

```
HorizonWatch.html        shell Â· icon sprite (~70 symbols) Â· all module skeletons Â· dialogs
hw.css                   every style rule: tokens, atoms, module layouts, glass, deck, print
hw-data.js               core corpus: 42 signals, 10 entities, country risk, flows, briefings
hw-data2.js              infrastructure, live tracks, imagery scenes, ontology, AOIs, annotations
hw-data3.js              identity, mail, cases, RFIs, comments, notifications, approvals, handovers
hw-app.js                shell (rail, tabs, palette, clock) + Situation map + Signal inbox
hw-modules.js            Dossiers Â· Analytics Â· Generator Â· Print document Â· Replay
hw-x.js                  annotations Â· tracks Â· minimaps Â· Ontology Â· Imagery Â· Reader Â· scan areas
hw-y.js                  sessions Â· palette v2 Â· views Â· alert rules Â· exports Â· related records
                         Â· time cursor Â· clustering Â· scan history Â· appendix Â· settings Â· fullscreen
hw-w.js                  Workstation mode Â· My work Â· Mail Â· Cases Â· Team Â· comments Â· assignment
                         Â· presence Â· RFIs Â· approval chain Â· handover Â· urgent interrupt
hw-gmail.js              real Gmail OAuth client + distribution recipient book
hw-deck.js               presentation generator
image-slot.js            starter web component (drag-drop image placeholder) â copy verbatim
HorizonWatchMobile.html  phone companion (separate surface) + hw-mobile.js
```

Load order in `HorizonWatch.html`, at the end of `<body>`:

```html
<script src="https://unpkg.com/d3@7.9.0/dist/d3.min.js" â¦></script>
<script>if(typeof d3==='undefined')document.write('<scr'+'ipt src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"><\/scr'+'ipt>');</script>
<script src="https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js" â¦></script>
<script>if(typeof topojson==='undefined')document.write('<scr'+'ipt src="https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js"><\/scr'+'ipt>');</script>
<script src="image-slot.js"></script>
<script src="hw-data.js"></script><script src="hw-data2.js"></script><script src="hw-data3.js"></script>
<script src="hw-app.js"></script><script src="hw-modules.js"></script><script src="hw-x.js"></script>
<script src="hw-y.js"></script><script src="hw-w.js"></script>
<script src="hw-gmail.js"></script><script src="hw-deck.js"></script>
```

**Libraries at the END of `<body>`, never in `<head>`.** A blocking head script paints nothing
until it resolves, and a CDN that *stalls* rather than erroring blanks the page forever. Here
the whole shell paints first. For production, vendor both files locally.

> **Palette note.** This console runs its own dark intelligence palette by explicit user
> direction, not the Muzzo brand system. Muzzo remains correct for marketing surfaces.

---

# PART 1 Â· FOUNDATIONS

## 1.1 The six rules

Everything below is downstream of these. Most "dashboard" attempts fail here.

**1 Â· System type only.** No webfonts.
`--font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif`.
Body 12.5px, tables 12.5px, labels 11px, pane titles 12px/600. Nothing above 26px except the
printed H1 and the deck. No display or geometric typeface â no Inter, Geist, Space Grotesk.

**2 Â· Monospace is for figures, never labels.** `--mono` is permitted **only** on timestamps,
coordinates, scale readouts, record IDs, counts, numeric cells, statistic values, axis ticks
and the agent log. **Forbidden** on headings, pane titles, buttons, chips, tags, nav labels,
status-bar words, tooltip prose and form labels. Letterspaced uppercase mono is the single
strongest amateur tell.

**3 Â· Colour is a scarce signal.** Neutral blue-grey scale; hue only where it encodes state.
- **Severity** (the one ramp): critical `#c4453c` â high `#b7822c` â moderate `#4f7fa6` â
  low `#6d7883`. Warm reads bad, cool and grey benign.
- **Delta**: worsening `#b0645c`, improving `#6d9a83`.
- **One accent** `#3f6fa8` / `#5f95d0` for selection, focus, links, primary buttons.
- **Change detection** reuses the severity ramp: new red, expanded amber, removed steel dashed.
- **Annotation gold** `#c8a04a` means an analyst drew it. **Scan blue** `#5f95d0` means a
  tasking instruction. These two never overlap with data colour.
- Everything else â domains, sources, regions, ontology links, heatmaps â is grey. Legends
  use **shades, not hues**. Seven-colour category palettes are banned.

**4 Â· Flat, tight, hairline.** Radius 2px. 1px borders. No shadows except floating layers.
Control heights 21 / 24 / 26px. Rows 24â30px. Pane headers 28px. No gradients, glows, pill
buttons or coloured card fills. Hover = one step lighter grey; selected = filled row plus a
1px accent rule. Glass (Â§2.6) is the sole exception.

**5 Â· Every surface is chrome around data.** No decorative panels, no hero areas. An empty
pane shows a 12px grey sentence saying what would appear and how to get it.

**6 Â· Extend through hooks, never by wrapping an export.** See Â§1.4 â this rule cost two
shipped bugs.

## 1.2 Tokens (copy verbatim)

```css
:root{
  --bg-0:#171b20; --bg-1:#1c2127; --bg-2:#22282f; --bg-3:#2a3138; --bg-4:#333b43;
  --line:#30373f; --line-soft:#262c33; --line-strong:#3d454e;
  --txt:#d5dae0; --txt-2:#a4adb6; --txt-3:#818c96; --txt-4:#616b75;
  --acc:#3f6fa8; --acc-hi:#5f95d0;
  --acc-dim:rgba(63,111,168,.22); --acc-line:rgba(95,149,208,.42);
  --red:#c4453c; --amber:#b7822c; --steel:#4f7fa6; --green:#4c7d63; --grey:#77828c;
  --sev-critical:#c4453c; --sev-high:#b7822c; --sev-moderate:#4f7fa6; --sev-low:#6d7883;
  --font:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;
  --mono:ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace;
  --r:2px; --ease:cubic-bezier(.3,.7,.4,1);
  --shadow:0 10px 26px rgba(0,0,0,.42),0 1px 3px rgba(0,0,0,.4);
  --top:40px; --tabs:32px; --status:24px;
  /* Situation glass panel widths â the map fit AND every overlay inset read these,
     so they can never drift apart */
  --pane-l:250px; --pane-r:312px;
}
```

Derived, exact:

| Purpose | Value |
|---|---|
| Tag red / amber / green / blue (text on border) | `#cf6259`/`#5c3b38` Â· `#c19446`/`#5a4a2c` Â· `#699781`/`#3a5346` Â· `#78a5d4`/`#39536e` |
| Map land / stroke / ocean / graticule / hover | `#232a30` Â· `#2e363d` Â· `#12161a` Â· `#20262b` Â· `#39424a` |
| Country-risk ramp 1â5 | `#232a30 #2a3138 #333a3c #3d3c39 #463c37` |
| Charts: area fill / stroke / grid | `#3f6fa8` @13% Â· `#7d97b3` Â· `#262c33` |
| Histogram / hot | `#4a545e` / `#8d5348` |
| Heatmap ramp / empty | `#232a30 â #5c6b78` / `#1e242a` |
| Vessel / sanctioned / aircraft / watchlisted | `#7fa8c9` Â· `#c4453c` Â· `#a8b6c2` Â· `#b7822c` |
| Ontology plate / link / inferred / tier rule | `#232a31` Â· `#3f4a55` Â· `#4d5964` dashed Â· `#262c33` dashed |
| Paper (print) | stock `#f4f2ee` Â· ink `#1b1f24` Â· rules `#d7d2c9` Â· never `#fff`/`#000` |

## 1.3 Type scale

| Role | Family | Size | Weight | Colour |
|---|---|---|---|---|
| Pane title | sans | 12px | 600 | `--txt` |
| Body / table cell | sans | 12.5px | 400 | `--txt` |
| Prose | sans | 12.5px, lh 1.55 | 400 | `--txt-2` |
| Label | sans | 11px | 400 | `--txt-3` |
| Detail title | sans | 15px | 600 | `--txt` |
| Dossier / case name | sans | 19px | 600 | `--txt` |
| Reader body | sans | 13.5px, lh 1.68 | 400 | `--txt-2` |
| Statistic value | mono | 19px | 400 | `--txt` |
| Data cell | mono | 11.5px | 400 | `--txt-2`/`--txt-4` |
| Axis tick | mono | 9â9.5px | 400 | `--txt-4` |
| Agent log | mono | 11px, lh 1.65 | 400 | `--txt-3` |
| Tag | sans | 10px, ls .03em | 400 | variant |
| **Printed briefing** | **serif** Times/Georgia | 13px, lh 1.6 | 400 | `#22272d` |
| **Deck body** | sans | 34px, lh 1.5 | 400 | `#a4adb6` |

**Casing:** sentence case everywhere. Uppercase only in the classification chip, map
coordinate readouts, short code tags (`CONF`, `MARI`, `AIS-TRACK`), ontology tier labels,
printed section headings and deck eyebrows.

## 1.4 The three traps that cost real bugs

### Trap 1 â animation frames are not guaranteed

`requestAnimationFrame` never fires in a throttled, backgrounded or embedded frame. **d3
transitions are rAF-driven**, so every `.transition()` silently becomes a no-op: zoom buttons
do nothing, pings never expand, layouts never fit. Invisible in code review.

```js
// Probe once, route every zoom through one helper.
let rafOK = null;
(function probeRaf(){ let fired=false;
  requestAnimationFrame(()=>{fired=true;rafOK=true});
  setTimeout(()=>{ if(!fired) rafOK=false }, 260); })();

function applyZoom(t, ms){
  if (rafOK && ms) svg.transition().duration(ms).call(zoom.transform, t);
  else svg.call(zoom.transform, t);          // synchronous fallback â always works
}

// Pulses: stepped timers with hand-rolled easing, never d3 transitions.
const steps=22, r1=46/k;
for (let s=1; s<=steps; s++) setTimeout(()=>{
  const f=s/steps, e=1-Math.pow(1-f,3);
  c.attr('r', 2+(r1-2)*e).attr('stroke-opacity', 1-e);
  if (s===steps) c.remove();
}, delay + s*(1300/steps));
```

Never defer layout with rAF â use `setTimeout(fn,0)` with a bounded retry when a container
may still measure zero:

```js
let tries=0;
function sizeMap(){
  const w=el.clientWidth, h=el.clientHeight;
  if(!w||!h){ if(tries++<20) setTimeout(sizeMap,50); return; }
  tries=0; /* â¦ fit â¦ */
}
```

### Trap 2 â never patch what the owner re-creates or never reads

**Two shipped bugs, one mistake.**

*Inline rail filter.* `renderRail()` rebuilds `#modrail` with `innerHTML` on every module, tab
and session change, discarding any inline `style.display`. The mode switch appeared to work on
first load and silently stopped. Fix: filter in CSS from a class on a stable ancestor.

```js
{ id:'work', label:'My work', icon:'i-work', tab:'My work', set:'work' }
// renderRail stamps every button: data-set="${m.set || 'watch'}"
document.getElementById('app').classList.toggle('mode-work', mode==='work');
```
```css
#app .mod[data-set=work]{display:none}
#app.mode-work .mod[data-set=work]{display:flex}
#app.mode-work .mod[data-set=watch]{display:none}
```
Apply the class **synchronously** at boot â deferring shows a flash of the wrong rail.

*Wrapped `SH.renderInspector`.* `hw-app.js` calls its own module-local `renderInspector()` from
`selectEvent()`, the close handler and the map-background click. Reassigning the **export**
never rebinds those, so the interrupt, assignment, discussion and presence vanished the moment
a signal was selected. Fix: the owner fires a hook from inside its own body.

```js
function renderInspector(){ /* both branches */ fireInspector(); }
function fireInspector(){
  (window.HWinspectorHooks||[]).forEach(fn=>{ try{ fn($('#inspector'), S.sel) }catch(e){ console.error(e) } });
}
```
```js
(window.HWinspectorHooks = window.HWinspectorHooks || []).push((box, sel) => {
  window.HWinterrupt.inject(box);
  if (!sel) return;
  const ref = 'sig:' + sel;
  window.HWpresence.inject(box, ref);
  const detail = box.querySelector('.detail');
  if (detail){ window.HWassign.inject(detail, ref); window.HWcomments.inject(detail, ref); }
});
```
Anything else that writes the inspector itself â `selectTrack` in `hw-x.js` â must fire the
hook too. **General rule: if an extension needs to inject into a surface, the surface
publishes a hook. A wrapper works only while nothing internal calls the original.**

### Trap 3 â a fixed-size child must never size a layout track

The deck slide is authored at 1920Ã1080. Placed as a grid item, the implicit `auto` track
sizes to its 1920px max-content, and `place-items:center` then centres it **inside that
1920px track** â putting it ~960px right of the stage and clipped out of view at every
viewport width.

```css
.stage{flex:1;min-height:0;position:relative;display:block;padding:18px;overflow:hidden}
.slidewrap{position:absolute;top:50%;left:50%;width:1920px;height:1080px;transform-origin:center center}
```
```js
// the whole transform in one write â a scale-only write drops the centring translate
wrap.style.transform = 'translate(-50%,-50%) scale(' + Math.min(w/1920, h/1080) + ')';
```
Verify with `elementFromPoint` at the stage centre, not by checking the node exists.

## 1.5 Application frame

```
#app  display:grid; grid-template-columns:minmax(0,1fr);
      grid-template-rows: 40px 32px 1fr 24px; height:100vh
      row 1  .topbar     brand | module rail | spacer | tools
      row 2  .tabstrip   mode control | workspace tabs | feed pills
      row 3  #views      module views, one visible
      row 4  .statusbar  telemetry | basket, user, build
body  overflow:hidden
```

**Two load-bearing details.** `grid-template-columns:minmax(0,1fr)` on `#app` â without it the
implicit track sizes to the top bar's min-content and the app grows past the viewport.
`.view{height:100%}` â without it the grid row is content-sized, panes grow to content height
and inner `overflow:auto` stops working. Every scroll container is
`flex:1; min-height:0; overflow:auto`, never `height:100%`.

**Any fixed-height flex row that can overflow gets the same three-part treatment:**
`min-width:0; overflow-x:auto; scrollbar-width:none` on the row, `flex:none; white-space:nowrap`
on its children, and `flex:none` on the title so it cannot absorb the deficit and collapse.
Applied to `.topbar`, `.toolbar`, `.statusbar .cell`, the map `.panehead`, `.timestrip .head`.

## 1.6 Pane grids

| Module | Columns |
|---|---|
| Situation | `var(--pane-l) 1fr var(--pane-r)` |
| Inbox | `212px 1fr 356px` |
| Dossiers | `238px 1fr 292px` |
| Analytics | `1fr` |
| Generate | `290px 1fr 322px` |
| Replay | `1fr 300px` (right pane leads with a 196px minimap) |
| Ontology | `236px 1fr 316px` |
| Imagery | `250px 1fr 330px` |
| Reader | `236px 1fr 336px` (196px minimap) |
| Print layout | `242px 1fr` |
| Deck | `186px 1fr 300px` |
| My work | `250px 1fr 320px` |
| Mail | `236px 1fr 400px` |
| Cases | `250px 1fr 330px` |
| Team | `1fr 340px` |

Pane internals are always `.panehead` (28px, `--bg-2`, 1px bottom border) â `.scroll` â
optional fixed footer.

---

# PART 2 Â· THE WATCH SURFACE

## 2.1 Situation â `#view-map`

**Left glass pane, Layers (250px).** Collapsible groups: Views (saved presets) Â· Event domains
(swatch, name, window count, eye toggle) Â· Context layers (risk index, graticule, flows, AOIs,
marker labels, and one deliberately unavailable *Satellite tasking (none)* that toasts
honestly) Â· Severity floor (four chips) Â· Time window (`24h/72h/7d/30d`) Â· Live tracks
(vessels, aircraft, sanctioned-only, ports & airports) Â· Annotations register.

**Header band â full width, above the glass, `z-index:4`.** Title Â· live count
`42 signals Â· 72h window` Â· the annotation toolbar (select Â· marker Â· route Â· area Â· measure Â·
scan box Â· scan polygon) Â· quick-layer buttons (risk, graticule, labels, reset) Â· projection
segment.

Padding the header by both panel widths instead leaves a 344px content box for ~760px of
controls at 1280px, and the overflow renders *under* the opaque glass, unclickable.

**Map.**
- `d3.geoEquirectangular()`, `projection.fitExtent([[padL,6],[w-padR,h-6]], box)` where
  `padL/padR` read `--pane-l`/`--pane-r`. Views: `world [[-170,78],[178,-58]]`,
  `emea [[-22,62],[62,-12]]`, `apac [[62,46],[150,-12]]`, `amer [[-128,52],[-32,-46]]`.
- `d3.zoom().scaleExtent([1,14])` on the `<svg>`, transform on one root `<g>`.
  **Counter-scale every glyph** (`translate(projected) scale(1/k)`) and divide land stroke by
  `k`. Double-click zoom disabled.
- Layer order: sphere â graticule â land â flow arcs â AOI boxes â scan zones â
  infrastructure â annotations â tracks â clusters â markers â ping/sequence effects.
  Markers re-sort by ascending severity rank each draw.
- **Signal marker:** `<rect>` rotated 45Â° (9/8/7px by severity), severity fill, 1px ocean
  stroke, .55 opacity when acknowledged, 11px halo when critical.
- **Vessel:** hull outline rotated to heading with a dashed wake; red when sanctioned.
  **Aircraft:** airframe rotated to heading; amber when watchlisted. Names above zoom 2.2Ã.
  **Ports:** circle + anchor. **Airports:** airframe mark. Both labelled with their code.

**Annotation tools.** Click to add points, double-click to finish. Measure reports km **and**
nm. Committing focuses an inline rename. Gold `#c8a04a` so it never reads as a finding.

**Scan tools** â Â§3.3.

**Navigation cluster** (bottom-right): zoom in Â· live zoom readout Â· zoom out Â· recentre Â·
fit-all-signals Â· north-up compass, as one bordered stack.

**Coordinate block** (bottom-left, **no background, border or blur**): `LAT +24.2013
LON +119.6042` in four decimals, and a scale bar. Exactly two lines.

**Density strip** (98px): 60-bucket histogram, critical/high buckets in `#8d5348`, time axis
(`%H:%MZ` under 7 days, `%d %b` above), `open replay â`. Below it the **time cursor** (Â§3.1).

**Right glass pane, Inspector (312px).** Four states:
1. *Nothing selected* â situation summary: 2Ã2 statistic grid, by-region bars, severity legend,
   six newest criticals.
2. *Signal selected* â tags, 15px title, Assessment card, Geolocation `.kv`, Exposure chips,
   actions, legend, Nearby signals Â· 800km, **Related records**, **assignment**, **discussion**.
3. *Track selected* â photo panel first (`<image-slot>` over an airframe/hull silhouette),
   track `.kv`, screening note when sanctioned, actions.
4. *Always, prepended* â the **urgent interrupt** (Â§4.7).

Selecting anything calls `HWreveal()` first so a minimised inspector slides back in.

## 2.2 Inbox â `#view-inbox`

Left: read-only distribution facets (severity, region, source) for orientation.
Toolbar: status segment Â· 250px filter Â· live count Â· `acknowledge` Â· `escalate` Â·
`add to briefing`.

Columns: Received (96px mono) Â· Severity (104px) Â· Signal (46%, ellipsised, `ESC` tag) Â·
Location (150px + grey ISO3) Â· Domain (112px code tag) Â· Confidence (112px bar + integer) Â·
Source (118px mono).

**Selecting a `new` row marks it `ack` and decrements the badge â reading *is* triage.**
`j`/`k` move through the sorted, filtered rows. First row selected on entry.

## 2.3 Dossiers â `#view-dossier`

Watchlist â profile â linked signals. Header: code, state tag, 19px name, standing note, three
actions, a 96px banded gauge and a 168Ã42 sparkline with `min Â· max Â· now`.

Tabs: Overview (six-cell grid, signal mix, generated judgement) Â· Exposure (dependency table) Â·
Risk drivers (five weighted bars) Â· History (area chart) Â· Linked entities.

```
score = clamp(0..100,
    40*severityWeight      // Î£(rankÂ²) of ring signals, normalised
  + 25*dependencyWeight    // matched impacts / total dependencies
  + 20*persistence         // share of last 14 days with â¥1 ring signal
  + 15*corroboration)      // mean confidence of ring signals
delta = score â score(14 days ago)
```

## 2.4 Analytics â `#view-analytics`

Toolbar: range (`7d/30d/90d`) Â· region Â· domain Â· `export csv`. Blocks: 12-cell KPI strip â
volume area chart â four donuts (severity in severity colours; domain, region, source in grey
ramps; 96px, 40/26px radii, total in the hole, native `<title>` hovers) â region Ã domain
heatmap beside index movers â highest-severity table with `brief these`.

## 2.5 Replay â `#view-replay`

Grouping segment (`region / domain / severity`), mono cursor clock, 128px lane gutter, 13 ticks.
Each signal a 10px rotated square at `left:(tsât0)/windowÃ100%`; 22% opacity **after** the
cursor. 1px amber playhead with a triangular head. Transport: play/pause, 0â1000 scrub, speed
(`1Ã/4Ã/12Ã`), live `n shown`. `t += 0.0016 Ã speed` every 40ms; pauses on leaving.

**Locator minimap** (196px) focuses the clicked event: Â±18Â°, severity diamond, two pings,
surrounding signals within 1600km as small grey diamonds.

**`replay on map`** â the flagship gesture: switch to Situation, select, fly to 4.6Ã, ping,
then walk the preceding â¤36h of signals within 1600km in chronological order, each drawing a
dashed severity-coloured line converging on the event plus an expanding ring, 420ms apart.
Reachable from replay, the reader, and any signal row.

## 2.6 Glass side panels â the one exception to rule 4

```css
aside.pane{
  background:rgba(26,31,37,.72);
  backdrop-filter:blur(16px) saturate(115%);
  transition:transform .24s var(--ease),opacity .18s linear;
}
```

On **Situation** the centre pane spans the whole grid (`grid-column:1/-1`) so geography runs
edge to edge, and the asides float above it (`z-index:2`, `rgba(22,27,33,.66)`, `margin-top:28px`
to clear the header band).

**Panels slide, they do not pop:** left aside `translateX(-14px)â0`, right `+14pxâ0`, 0.26s;
centre fades. **Situation panels minimise:** a chevron sets `.min-l`/`.min-r`, overriding
`--pane-l`/`--pane-r` to `30px`; a 30px labelled rail restores. Because the map fit and every
overlay inset read the same variables, the map reflows automatically. Use
`:first-of-type`/`:last-of-type`, not `:first-child`/`:last-child` â the restore rails are siblings.

---

# PART 3 Â· ANALYTICAL DEPTH

## 3.1 Global time cursor

A 26px bar under the density histogram: follow-live button, mono readout, 0â1000 range, sweep
button, live `N shown`. It writes `S.tCut` (epoch ms cap, `null` for live) and the **single**
visibility selector honours it, so map, legend, inspector, histogram and exports all agree:

```js
visible = () => events.filter(e =>
  e.hoursAgo <= S.win && S.domains.has(e.domain) &&
  SEVERITY[e.severity].rank >= S.sevFloor &&
  (!S.tCut || e.ts.getTime() <= S.tCut));
```

Sweep advances `t += .012` every 60ms. The readout turns amber while held in the past. Replay
is for studying the sequence; the cursor answers "what did we know at 0400Z?".

## 3.2 Ontology â `#view-ontology`

**A fixed diagram, not a floating force graph.** Four ontological tiers:

```js
TIER = { country:0, corridor:0, faction:1, org:1, person:1,
         facility:2, vessel:2, aircraft:2, event:3 }
TIER_NAME = ['Geography','Actors','Assets & sites','Observations']
```

Geography contains actors; actors operate assets; assets produce observations. Each tier is a
labelled band with a dashed rule. Within a tier, order settles by **three barycentre passes**
over neighbour indices (seeded by descending risk) so links run short and mostly vertical.
Nodes sit at a fixed 112px step with a 26px alternating stagger, then are **pinned** (`fx`/`fy`).
The layout is computed once per node set, keyed by `nodes+types+layout`; a dragged object stays
exactly where the analyst put it.

An **auto-fit** transform frames the diagram on open (clamped 0.3â1.2Ã), applied
**synchronously** (Trap 1). `layered / radial` and an explicit rebuild recompute deliberately.

**Node plate:** 92Ã40, 15px type icon, label, `type Â· risk` sub-line, 3px risk-banded strip.
**Links:** curved orthogonal paths leaving plate edges, dashed when inferred, thicker at
`conf â¥ .9`, relationship word at the midpoint.

Editors: object (label, type, risk slider, free-form properties, link list) and link (type,
confidence, basis text, delete). Double-click expands a neighbourhood.

## 3.3 Imagery and satellite change detection â `#view-imagery`

**Left pane â observation areas.** Country scope + **`propose coverage for scope`**, which
derives AOIs from the infrastructure register and inserts them dimmed as `proposed`. Areas list
with inline rename. Scene register. Detector panel: model, confidence floor, three change-type
toggles, `re-run detection`.

**Centre â the comparison.** `split` (side by side, boxes on current) Â· `swipe` (draggable 2px
handle) Â· `after only`. Each frame is an `<image-slot>` drop target with acquisition date,
sensor, cloud fraction and off-nadir angle, so real Sentinel tiles can be dropped in.

**Detection boxes:** 1.2px outline in the change-type colour (removed dashed), `CHG-05 Â· 93%`
label above, 12% fill on hover/select. `bbox` is stored in **percent of frame**, not pixels, so
overlays survive any frame size, zoom or user-dropped image.

**Right pane:** AOI editor first (name, class, cadence, radius, note, save/accept/pause/locate/
delete), then Detections (typed rows, `confirm`/`reject` as model feedback), the selected
finding's provenance, object counts reference â current with signed deltas, and **scan history**.

### The Sentinel loop, per AOI

1. **Task** â a scheduler enumerates AOIs due by `cadence` and queries the archive for the
   newest scene intersecting `(lat, lon, radiusKm)` meeting quality gates (optical: cloud â¤ 20%,
   off-nadir â¤ 30Â°; SAR: same orbit and polarisation as reference).
2. **Pair** â new scene is **B**; **A** is the stored reference of the same sensor and geometry.
   **Never compare across sensors or orbits** â it manufactures false positives.
3. **Co-register** â orthorectify, sub-pixel align, radiometrically normalise optical, speckle-
   filter SAR.
4. **Detect** â two models together: an *object detector* over B alone emitting counts per
   `DETECT_CLASSES` with boxes, and a *siamese change model* over the (A,B) pair emitting
   regions typed `new`/`expanded`/`removed`. Counts difference against A's stored counts.
5. **Filter** â drop below the AOI floor; suppress seasonal and tidal classes; suppress boxes
   recurring identically in â¥3 consecutive scenes.
6. **Interpret** â raw deltas become analyst-readable findings. This is the whole point:

| Class | +delta | âdelta |
|---|---|---|
| Vessel | Increased port activity â vessel calls up | Berth occupancy reduced |
| Damaged structure | **Increased structural destruction** | Damaged structures cleared or rebuilt |
| Structure | New construction within the area | Structures removed or levelled |
| Aircraft | Aircraft presence increased on the apron | Aircraft dispersed or withdrawn |
| Revetment | New hardened revetments constructed | Revetments cleared |
| Container stack | Container yard throughput increased | Container yard drawn down |
| Crane | Additional handling equipment on site | Handling equipment demobilised |
| Vehicle | Vehicle concentration increased | Vehicle concentration reduced |
| Small craft | Small-craft cluster expanded | Small-craft cluster dispersed |
| Fuel bladder | Fuel storage established | Fuel storage removed |
| Launcher | Launcher-sized objects detected | Launcher-sized objects no longer present |
| Berm | New earthworks and berms | Earthworks removed |
| Helicopter | Rotary-wing presence established | Rotary-wing presence withdrawn |

Suffix each with `(+7)` / `(â12)`.
7. **Route** â findings above threshold emit `Signal` records (`source:'SAT-TASK'`) into the inbox.
8. **Review** â confirm or reject; both are model feedback, and a confirm updates the reference counts.

**Auto-derived coverage:** scoping to a country proposes AOIs over every port, airport, military
base and energy facility inside it at a default cadence and radius (6km ports, 4km airfields).

### Draw-to-scan

Two tools in the map header: `scanbox` (press-drag) and `scanpoly` (click corners, double-click
to close). Committing slides in a 322px glass panel from the right edge of the map (`z-index:6`,
260ms). Contents: metric ledger (kmÂ², vertices, archive tiles `ceil(areaKmÂ²/12100)`, revisit),
name pre-filled from the nearest infrastructure within `max(30km, boxWidth)`, area class (which
re-seeds detection classes from `CLASS_PRESETS`), sensor, a 13-class grid, confidence floor,
recurring cadence, centroid and extent.

`run scan now` sweeps a line down the bounds in 26 steps Ã 90ms (**stepped timers**), logs six
detector stages, then synthesises a scene, interprets the movers, and routes into Imagery.
`save for recurring` writes an AOI with the drawn polygon, classes, confidence, sensor and
cadence; it appears first in the rail with a `â»` and its polygon persists on the map.

**Two geometry bugs you must not reproduce:**

1. **Ring winding.** `d3.geoArea` and `d3.geoPath` read a ring's winding to decide which side is
   inside; a wrongly-wound ring measures the **complement of the sphere** â a drawn box reported
   `504,470,700 kmÂ²`. A shoelace sign test is not sufficient. Pick empirically:
   ```js
   const ringArea = pts => d3.geoArea({type:'Polygon',coordinates:[pts.concat([pts[0]])]});
   function normalizeRing(pts){
     if (pts.length < 3) return pts;
     if (ringArea(pts) <= 2*Math.PI) return pts;
     const r = pts.slice().reverse();
     return ringArea(r) <= 2*Math.PI ? r : pts;
   }
   ```
   Apply to the live drag preview **and** on commit so they agree.
2. **Off-globe inversion.** `projection.invert()` returns latitudes beyond Â±90 for points off the
   globe, silently corrupting every downstream measurement. Guard and return `null`:
   ```js
   invert(clientX, clientY){
     const r = $('#mapsvg').getBoundingClientRect();
     const p = projection.invert(zt.invert([clientX-r.left, clientY-r.top]));
     if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
     if (p[1] > 90 || p[1] < -90 || p[0] > 180 || p[0] < -180) return null;
     return p;
   }
   ```
   Handlers then warn instead of producing nonsense.

## 3.4 Marker clustering

A `HWmapHooks` entry. Below `settings.clusterAt` (default 2Ã) it hides individual markers
(`opacity:0; pointer-events:none`) and bins visible signals into 46px screen cells: one bubble
per cell, radius `9 + min(11, n*1.6)`, stroke = the **worst** severity in the cell, count in
mono. Hover lists the worst severity and up to three places; click flies to the centroid at
`clusterAt + 1`.

## 3.5 Scan history

`historyFor(aoi)` returns real scenes plus four deterministic archived passes (26-day spacing,
alternating EO/SAR, seeded from the area id and radius). Renders a `.sparkbar` of findings per
pass (bars at the maximum turn `#8d5348`) and a row per pass. Archived passes are honest: clicking
one says the imagery is not cached rather than showing the current scene twice.

---

# PART 4 Â· WORKSTATION

## 4.1 Mode, not modules

**Watch** is the analysis surface (nine modules). **Workstation** is where work is coordinated
(My work Â· Mail Â· Cases Â· Team). Sessions, filters and the briefing basket carry across both.
`W` toggles, `G` jumps to My work. Rail filtering per Trap 2.

**Guard the `onModule` hook against its own routing.** `setMode()` calls `HWopen()`, whose
`HWX.onModule` hook corrects mode drift â without a `switching` flag the two fight and the mode
flips straight back.

## 4.2 Reference grammar

One string form ties everything together:

```
sig:HW-2400 Â· ent:ENT-RS-01 Â· onto:N02 Â· scn:SCN-4471 Â· aoi:AOI-14
brf:BRF-0431 Â· case:CS-0014 Â· mail:M-1042 Â· rfi:RFI-021
```

`HWref.open(ref)` switches mode if needed and navigates. `HWref.label(ref)` resolves a title.
This is what lets *any* record be commented on, assigned, attached to a case or cited.

## 4.3 Identity and roles

Eight seeded users. Roles carry real capability:

| Role | Can |
|---|---|
| Group security lead | approve Â· issue Â· assign Â· brief Â· admin |
| Senior analyst | assign Â· brief Â· review |
| Analyst | brief |
| Regional lead | answer Â· brief |
| Imagery analyst | confirm Â· brief |

Gate every privileged action with `can('approve')` and **refuse with a toast, never a hidden
control**. Click the top-bar avatar to switch or create a user. State persists under
`horizonwatch.workstation.v1`.

## 4.4 My work

Seven queues: assigned to me Â· mentions Â· RFIs to answer Â· my cases Â· awaiting my review Â·
urgent mail Â· unreviewed signals. Scope segment `mine / team / unassigned`. The right column
carries the day: calendar, due dates, scheduled scans, recent team activity. This is the *what
do I do today* screen a workstation needs.

## 4.5 Mail â both directions, real Gmail

`hw-gmail.js` is **not a mock**. Supply a Google Cloud OAuth 2.0 **Web application** client ID
(Settings â Mail & calendar), enable the Gmail API, add the page origin to the client's
authorised JavaScript origins. It then signs in through Google Identity Services and calls the
Gmail REST API from the browser:

```
messages.list?maxResults=25&q=<configurable query>
messages.get?format=full   â base64url decode, MIME walk for text and attachments
messages.send              â RFC 2822 raw payload, base64url
profile                    â account, message total
```

Scopes: `gmail.readonly gmail.send gmail.labels calendar.events`. Polling interval configurable
30â600s. **Without a client ID it runs the sample mailbox and says so** â a send with no
connection queues at `delivered: 0` rather than claiming delivery.

**Inbound rules** â six, auditable, matched in order:

| Rule | Match | Sets |
|---|---|---|
| Partner corridor bulletins | from contains marinerisk | domain=maritime Â· source=PARTNER-FEED Â· severity from subject |
| Government advisories | from ends gov.uk OR state.gov | domain=political Â· source=GOV-ADVISORY Â· conf=0.78 |
| AIS gap alerts | subject starts "AIS gap" | domain=maritime Â· attach vessel by MMSI Â· severity=high |
| Field reports | from sahel-security.example | domain=conflict Â· source=FIELD-REP Â· geocode from body |
| Scene delivery notices | from copernicus.example | route to imagery Â· no signal |
| Urgent on keyword | subject contains URGENT | flag urgent Â· notify duty analyst Â· interrupt inspector |

**A message matching no rule stays in the inbox** for an analyst. Nothing is discarded, and
nothing becomes a signal without a rule that can be read and audited.

**Outbound** â five channels: per-recipient-timezone digests (0600 local reaches Lisbon and
Singapore at 0600 local, not 0600 UTC), throttled alerts (first match immediate, later matches
folded into one follow-up), briefing distribution, imagery findings, duty-of-care check-ins.
Delivery receipts with open rates.

## 4.6 Cases, RFIs, comments, presence, approval

- **Case** â bundles signals, dossiers, ontology objects, scenes, areas and mail under one owner
  with priority, status, due date, discussion, timeline and five tabs. `brief this case` pushes
  its signals into the generator. This is what turns fourteen modules into one job.
- **Approval chain** â `draft â review â approved â issued`, role-gated, each step stamped.
- **Comments** â `HWcomments.inject(box, ref)` on any record. Real @mention autocomplete
  (`ArrowUp/Down`, `Enter`, `Tab`, `Escape`; `ââµ` sends) that notifies the mentioned user.
- **Assignment** â `HWassign.inject(box, ref)`: owner, due date, reassign, mark done.
- **Presence** â `HWpresence.inject(box, ref)`: who else has this record open.
- **RFI** â raised against a case, tracked to closure, answerable only by its recipient.
- **Handover** â generated from what actually changed during the shift, plus a free note.

## 4.7 The urgent interrupt

Urgent mail, mentions and overdue RFIs must reach the analyst without them going looking.
`HWinterrupt.inject(box)` prepends a red **Needs you** block to the inspector, alongside a toast
on arrival and rail badges. Dismissals persist so a cleared item does not return.

## 4.8 Sessions, views, alerts, exports

- **Session** â a whole desk: `win`, `sevFloor`, `domains`, `ctx`, `proj`, map `transform`, its
  `tabs`, `basket` and `views`. Seeded: Global watch Â· Red Sea corridor Â· Baltic & Nordics Â·
  Indo-Pacific. Control at the left of the tab strip.
- **Tabs are record-scoped.** `openModule(id, label)` creates a tab **only when `label` names a
  record**. Without a label it switches the lens. This is what kills the tab/rail redundancy.
- **View** â a named filter preset *inside* a session. Sessions are where you work; views are how
  you look.
- **Alert rules** â fields Severity / Domain / Region / Country / Source / Confidence, ANDed, with
  action `notify / escalate / brief`. A live preview renders the rule as prose **and lists every
  matching signal in the corpus before you save**. A builder that cannot tell you what would fire
  is a form, not a tool.
- **Exports** â signals CSV (current filter, RFC-4180 quoted), geometry GeoJSON (areas as Polygon
  where drawn else Point, annotations, signal points, each with a `kind`), ontology JSON.
  **Read `window.HWann`, not `X.annotations`** â the latter is only the seeds.
- **Palette v2** â 14 indexed kinds, scope prefixes (`sig: ent: obj: loc: aoi: scn: trk: brf: view:`),
  pinned and recent groups, coordinate parsing (decimal and DMS), a ~90-place offline gazetteer,
  and live Nominatim geocoding debounced at 340ms with a sequence guard. Ontology objects are
  indexed **by property**, so `636020918` finds a hull by its MMSI.

---

# PART 5 Â· THE BRIEFING SURFACE

## 5.1 One artefact, three renderings

**There is a single document object.** The reader renders it as live hypertext; the print layout
as paginated paper; the deck as slides for a room. None owns the data, so they cannot disagree.

```
Generator âââ¶ doc { meta, sel, crit, high, regions, domains }
                     â
        ââââââââââââââ¼âââââââââââââ
        â¼            â¼            â¼
     Reader        Print         Deck
   (rail dest.)   (a view)     (a view)
```

`reader` is in the rail. `doc` and `deck` are registered `hidden:true` and are **never** in the
rail. Generation lands in the **reader**. Every view offers a route back.

```js
function buildBriefing(sel) {
  const sorted = sel.slice().sort((a,b) =>
    SEV[b.severity].rank - SEV[a.severity].rank || a.hoursAgo - b.hoursAgo);
  return {
    meta: { id, title, scope, aud, cls, horizon, author, status, ts },
    sel: sorted,
    crit: sorted.filter(e => e.severity === 'critical'),
    high: sorted.filter(e => e.severity === 'high'),
    regions: d3.rollups(sorted, v=>v.length, d=>d.region).sort((a,b)=>b[1]-a[1]),
    domains: d3.rollups(sorted, v=>v.length, d=>d.domain).sort((a,b)=>b[1]-a[1])
  };
}
```

`regions` and `domains` are pre-rolled because **all three** renderers need the same ordering.

Build the print pages **eagerly** at generation time so `printable briefing` and `âP` are instant.

## 5.2 The generator â `#view-generate`

Left: title, scope, audience, horizon segment, six section checkboxes, classification, standing
instruction. Centre: the corpus as a checkbox grid sorted by severity then recency, with
`select top 12 by severity` and `clear`; the basket merges in on entry; a 2px progress line.
Right: seven-step checklist, agent log, run controls, print/deck/distribute buttons.

```
Resolve parameters and scope            260ms
Assemble evidence set                   420
Deduplicate and cluster signals         700
Score exposure against asset register   820
Draft judgement and section text       1400
Apply house style and classification    520
Compile document and paginate           480
```

**~4.6s is deliberate. Latency is information; instant is not credible.**

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

Guard with `if (M.gen.running) return;` **and clear the flag on every exit path** â a throw
between "started" and "finished" wedges the generator until reload.

## 5.3 Reader â `#view-reader`

720px measure, 13.5px/1.68 body. The rest of the console is 12.5px/1.45; this is the only place
that relaxes, because it is prose to be read.

**References.** Every claim with a record behind it is an `.xref` carrying `data-k`
(`signal|scene|node|region`) and `data-id`. Clicking one marks itself active, loads the record
into the right pane, and re-frames a **196px context minimap**.

```js
const refSpan = (kind,id,text) =>
  `<span class="xref" role="link" tabindex="0" data-k="${kind}" data-id="${id}">${esc(text)}<span class="rt"> â¸</span></span>`;
```

**A `<button>` here is a bug.** It is an atomic inline-level box: it will not break across lines,
and `display:inline` does not restore wrapping in Blink or WebKit. The judgement reference runs
~78 characters. Being a span, it needs a keydown handler for `Enter`/`Space`.

Minimap span per kind: **signal 16Â°** Â· scene 10Â° Â· node 20Â° Â· region 46Â°.

**Guided walkthrough** steps every reference at 3.6s, scrolling each into view. **Kill the
interval on module change.**

Sections in fixed order: header Â· executive judgement (two paragraphs + bottom-line callout) Â·
assessment by theme Â· network and attribution (reader-only) Â· indicators and warnings Â·
sourcing and method.

## 5.4 Print layout â `#view-doc`

816Ã1056px pages (US Letter @96dpi), `#f4f2ee` stock, `#1b1f24` ink, 62/70/54px padding,
`display:flex; flex-direction:column` with `.pno{margin-top:auto}` so the folio sinks. **Serif
body** â the single highest-leverage decision in the document; headings stay sans, which is what
institutional reports do.

Page plan: **1** kicker, H1, metadata table, executive judgement, signals table (9 rows) Â·
**2** assessment by theme, regional distribution Â· **3** exposure and continuity, indicators,
recommended actions, sourcing Â· **4** Appendix A, link analysis.

Contents links compute the offset and scroll the desk â **never `scrollIntoView`**, which
displaces the app shell. Zoom via `transform:scale` needs a `marginBottom` correction, since
transform does not affect layout.

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
  .docpage{box-shadow:none;margin:0;width:8.5in;min-height:11in;
    padding:.72in .8in .6in;break-after:page}
  .docpage:last-child{break-after:auto}
}
```

## 5.5 Appendix A â link analysis

Objects intersecting the evidence set (ref, object, type, risk, standing note), relationships
(from, relationship, to, confidence, asserted/inferred), and a **method note** stating how many
links are inferred and that inferred links are review candidates, not conclusions. A link-analysis
appendix without a stated basis is an accusation.

## 5.6 Deck â `#view-deck`

Authored at 1920Ã1080, scaled to fit (Trap 3). Slide rail, scrub bar, dark/light switch,
**Present** (full-screen, chrome stripped, arrows/space/Home/End, Esc out), and `pdf` which lays
every slide into the flow for a landscape sheet each.

Slide plan, derived â never authored twice:

| # | Slide | Content |
|---|---|---|
| 1 | Cover | title lowercase 104px, scope/horizon/audience/evidence/issued/prepared-by |
| 2 | **Bottom line** | the judgement at 52px, then the one-line why |
| 3 | This cycle | 4-cell severity ledger + regional bars |
| 4 | Where | real map, **criticals labelled only** |
| 5â8 | One per theme | top four domains: statement, three signals, dependencies |
| 9 | Exposure | dependency table with signal count, severity peak, mitigation |
| 10 | Indicators | four falsifiable triggers |
| 11 | Actions | numbered, owner, by D+n |
| 12 | Sourcing | 4-cell ledger + method note |

**Deck editorial judgement:** bottom line goes **second**, not last. Only criticals get map
labels â a slide is not an inspector. The sourcing slide exists to be held back unless
challenged, and its note says so.

**Speaker notes are generated from the same fields the slide uses**, so a note can never describe
a slide that changed. Each carries a delivery cue: *"Expect the interruption here, have the number
ready"* on exposure; *"Do not advance until line one has an answer"* on actions.

## 5.7 Distribution

Recipients are **data, not hard-coded strings**. A recipient book of five lists plus ad-hoc
addresses lives in `localStorage`, is editable in Settings â Distribution, and is read by **one**
picker reachable from the reader toolbar, the generator footer and the print view. It resolves and
de-duplicates the address set, shows the count before sending, composes a covering summary from
the document object, and on send advances the approval chain to `issued` with a stamped entry.

## 5.8 Generated language

British English, sentence case, declarative, quantified, unemphatic. **No em dashes, no emoji, no
adjectives of intensity.**

**Executive judgement (lede)**
```
{n} signals meet the reporting threshold for this cycle, {crit} of them critical and {high}
high. Activity concentrates in {regions with counts}. The single most consequential development
is {place}: {lowercased title}. Over the next {horizon} we assess corridor and routing risk as
the binding constraint on operations, ahead of fixed-asset or personnel risk.
```

**Supporting paragraph**
```
By theme the set is dominated by {top three domains with counts}. Confidence across the set
averages {mean}%, with {k} signals corroborated by more than one feed. Overhead imagery of
{scene place} supports the assessment: the change detector returned {n} findings against the
{dateA} reference scene.
```

**Bottom line**
```
crit ? `Hold contingency routing and keep the {crit[0].place} corridor under daily review.
        No new site-level measures are indicated by the evidence set.`
     : `No change to posture. Maintain the weekly reporting cadence and the current mitigation set.`
```

**Indicators** â one per domain present, plus one standing rule:
```
maritime â A second interference event in the same corridor inside seven days would move the
           corridor index above 90 and trigger the pre-agreed rerouting clause.
conflict â Movement of front lines within 50km of a contracted facility, or a formal advisory
           change, requires an immediate duty-of-care review.
cyber    â A confirmed second subsea or terminal-system fault in the same basin would indicate
           deliberate action rather than accident.
trade    â Publication of a further designation round touching a tier-1 supplier would suspend
           two open purchase orders pending screening.
imagery  â Recurrence of the same change class at this AOI on the next pass would move the
           finding from indicative to confirmed.
always   â Any single signal at critical severity that remains uncorroborated after 24 hours
           should be downgraded rather than carried forward.
```

**With a real LLM**, keep the staged UI and send one structured request:
```
System: You are an intelligence editor for a corporate risk team. Write in British English,
sentence case, plain declarative prose. No adjectives of emphasis, no em dashes, no emoji, no
hedging clichÃ©s. Quantify only what the evidence states. Cite signal IDs inline. Never invent
events, sources, casualties or attribution.

User: {classification, audience, scope, horizon, standing_instruction,
       signals:[{id,ts,place,country,domain,severity,conf,source,title,summary,impacts}],
       imagery_findings:[{scene,aoi,label,type,conf}],
       ontology:[{id,label,type,risk}], links:[{s,t,kind,conf,inferred}],
       asset_register_matches:[â¦]}

Return JSON: { judgement, second_para, bottom_line,
               themes:[{domain,text,bullets[]}], warnings[], actions[[text,owner,by]] }
```
Validate against the schema. On a missing field fall back to the template â never ship an empty
section.

---

# PART 6 Â· DATA MODEL

## 6.1 Enumerations

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
SOURCES  = ['OSINT-WIRE','PARTNER-FEED','AIS-TRACK','GDELT-XR','FIELD-REP','SAT-TASK','GOV-ADVISORY']
REGIONS  = ['EMEA','APAC','AMER']
```

## 6.2 Records

```ts
interface Signal {
  id; ts: Date; hoursAgo: number;         // hoursAgo drives every window filter
  lat; lon; place; country; iso3; region;
  domain: keyof DOMAINS; severity: keyof SEVERITY;
  conf: number;                           // 0..1
  source; title;                          // â¤96 chars, sentence case, no trailing period
  summary;                                // 2â3 sentences, quantified
  impacts: string[];                      // dependency names from the asset register
  status: 'new'|'ack'|'esc';
}
interface Entity { id; code; name; type; lat; lon; score; delta;
  exposure:{sites;staff;suppliers;revenue}; note }
interface Place  { id; kind:'port'|'airport'; name; iso3; lat; lon; code }
interface Vessel { mmsi; name; type; flag; lat; lon; hdg; spd; dest;
  sanctioned:boolean; ais:'on'|'dark'; kind:'vessel' }
interface Aircraft { icao; callsign; type; role; lat; lon; hdg; alt; spd; watch:boolean }
interface Annotation { id; kind:'point'|'line'|'area'|'measure'; label; by; ts; note; lat?; lon?; pts? }
interface AOI { id; name; cls; iso3; lat; lon; radiusKm; cadence; status; scene; owner; auto; notes;
  recurring?; pts?; classes?; conf?; sensor? }
interface Scene { id; place; iso3; lat; lon; aoi; sensor; vendor; dateA; dateB;
  cloud; offNadir; counts:[label,current,delta][]; changes:Change[] }
interface Change { id; label; type:'new'|'expanded'|'removed'; conf;
  bbox:[x,y,w,h];                         // PERCENT of frame, never pixels
  note }
interface Node { id; type; label; risk:0..100; props:Record<string,string> }
interface Link { id; s; t; kind; conf; note; inferred }   // inferred derived: conf < 0.8
interface User { id; name; initials; role; email; tz; shift; status; color }
interface Mail { id; thread; from; fromName; src; rel; ts; hoursAgo; subject; body;
  unread; urgent; attachments; labels; signalId; caseId; state:'new'|'parsed' }
interface Case { id; code; title; owner; status; priority; opened; due; watchers;
  summary; records:{signals,entities,scenes,aois,onto,mail}; notes }
interface RFI { id; case; from; to; due; status:'open'|'answered'|'closed'; question; answers }
```

`series(seed,n,base,amp)` is a **deterministic** LCG walk for sparklines and history charts.
Never `Math.random()` in a render path.

## 6.3 Corpus sizes

42 signals across all seven domains, four severities and three regions Â· 10 entities Â·
28 infrastructure places Â· 10 vessels Â· 8 aircraft Â· 3 imagery scenes with 8 detections Â·
20 ontology nodes and 22 links Â· 7 observation areas Â· 3 annotations Â· 3 briefings Â·
8 users Â· 12 mail threads Â· 5 cases Â· 4 RFIs Â· 6 comments Â· 7 notifications Â·
4 sessions Â· 3 alert rules Â· ~90-place gazetteer.

## 6.4 Real ingestion

| Domain | Candidate feeds |
|---|---|
| conflict | ACLED, GDELT 2.0, UN OCHA situation reports |
| maritime | AIS providers, IMB piracy reports, canal authority notices |
| cyber | CISA/ENISA advisories, national CERTs, cable-fault registries, vendor status |
| energy | EIA/IEA notices, operator statements, terminal loading schedules |
| trade | OFAC/EU/UK sanctions lists, customs and export-control bulletins |
| civil | GDELT protest events, labour-federation announcements, municipal notices |
| political | government advisories, regulator publications, court dockets |
| imagery | Copernicus Sentinel-1/2, commercial sub-metre EO on tasking |
| mail | Gmail / Google Workspace API on the intel mailbox |

Pipeline: **fetch** (poller with backoff, raw payload + timestamp) â **extract** (map to
`Signal`, geocode via gazetteer, **reject records without a resolvable location â never guess
coordinates**) â **classify** (domain by keyword/model, severity by rule, confidence) â
**deduplicate** (25km / 12h / title cosine > 0.7; keep earliest, +0.05 conf per corroboration
capped .97) â **enrich** (intersect the asset register for `impacts[]`) â **score** (entity
index) â **publish** (read store + WebSocket).

**Severity rules â deterministic and auditable, never model-only:**
- `critical` â loss of life or facility damage inside an exposure ring; corridor closure or
  interdiction; confirmed outage with no tested alternative.
- `high` â measurable degradation touching a named dependency, or an advisory change.
- `moderate` â confirmed change of context with no current operational effect.
- `low` â watch item, or the resolution of a previous issue.

**Confidence** starts at source base reliability (partner .80, gov advisory .78, AIS .84, OSINT
wire .66, field report .74), then +.05 per independent corroboration, â.10 single-source social
origin, â.05 inferred location. Two decimals.

**Live tracks:** AIS poll â¤60s; derive `ais:'dark'` when a hull with history stops transmitting
beyond its class-typical gap â dark status is a **finding**, not a data error. ADS-B similarly.
Screen `mmsi`/`icao`/owner against restricted-party lists every refresh; a match is the **only**
thing that turns a track red. Cluster beyond ~500 per viewport.

## 6.5 API surface

```
GET   /api/signals?window=72h&domains=&minSeverity=&region=
GET   /api/signals/:id                      PATCH /api/signals/:id {status}
GET   /api/entities                          /api/entities/:id/signals?radiusKm=1400
GET   /api/analytics?range=30d&region=&domain=
GET   /api/risk                              GET /api/tracks?bbox=   GET /api/infrastructure?bbox=
GET|POST /api/aois        PATCH|DELETE /api/aois/:id
POST  /api/aois/derive {iso3}               â AOI[] status 'proposed'
GET   /api/scenes?aoi=    POST /api/scenes/:id/detect {model,minConf}
PATCH /api/changes/:id {review}
GET   /api/ontology       POST|PATCH|DELETE /api/ontology/nodes|links
GET|POST|PATCH|DELETE /api/annotations
POST  /api/briefings {title,scope,audience,horizon,sections[],classification,instruction,signalIds[]}
GET|POST|PATCH /api/cases   /api/rfis   /api/comments   /api/assignments   /api/approvals
GET   /api/mail?q=        POST /api/mail/send        POST /api/mail/parse
WS    /api/stream   signal.created | signal.updated | entity.rescored | track.moved
                  | scene.ingested | detection.raised | comment.created | mention
                  | assignment.changed | mail.received | presence.changed
```

**Client rule: filtering is always local** over the loaded window, from one `visible()` selector,
so the layer panel, legend, pane header, histogram and exports can never disagree.

## 6.6 Published globals

| Global | Owner | Purpose |
|---|---|---|
| `HW` `HW2` `HW3` | data | the corpus |
| `HWopen(mod,label?)` | app | switch module; a label creates a record tab |
| `HWselect(id,{pan})` | app | select a signal, optionally centre the map |
| `HWbasket(ids)` Â· `HWtoast(msg,kind)` Â· `HWreveal()` | app | basket, confirmations, un-minimise |
| `HWrowHTML(e)` Â· `HWbindRows(root)` | app | the universal signal row |
| `HWmap` | app | `projection, path, k, layer(name), flyTo, ping, invert, redraw, tip` |
| `HWmapHooks[]` | app | `{draw(projection,path,k), zoom(k)}` |
| `HWinspectorHooks[]` | app | `(box, sel)` â the correct extension point |
| `HWshell` | app | `MODULES, renderLayers, fitView, renderTabs, drawMarkers, visible, â¦` |
| `HWM` Â· `HWMcore` Â· `HWMdoc` | modules | entities, briefings, replay state, the loaded doc |
| `HWX` Â· `HWXaoi` Â· `HWann` | hw-x | modules hook, AOI registry, **live** annotations |
| `HWP2` `HWsession` `HWalerts` `HWexport` `HWrelated` `HWhistory` `HWappendix` `HWsettings` | hw-y | workspace |
| `HWwork` `HWref` `HWcomments` `HWassign` `HWpresence` `HWinterrupt` `HWcase` | hw-w | workstation |
| `HWgmail` | hw-gmail | `connect, sync, send, openDistribute, BOOK` |
| `HWdeck` | hw-deck | `open(doc), show(i), fit()` |

---

# PART 7 Â· COMPONENTS

## 7.1 Buttons, controls, atoms

**`.btn`** 24px, 9px padding, 6px gap to a 12px icon at .8 opacity, `--bg-3` on `--line-strong`.
Hover `--bg-4`; no transform, no shadow, no scale. `.primary` `--acc` fill â **one per pane
maximum**. `.danger` grey fill with `#cf6259` text, never red-filled. `.ghost` transparent.
`.sm` 21px. Disabled opacity .4.

**`.seg`** 22px buttons, `--line-soft` dividers, pressed `--bg-4` + `--txt`. Max 4 options.

**`.chip`** 20px toggle; **`.tag`** 16px, 10px sans, ls .03em, transparent fill, variants recolour
**text and border only, never the fill**.

**Forms.** `.input` 26px, `--bg-0` well; focus `--acc-hi` border and **no glow ring** â a shadow
ring is the web-form tell. `.check` 12px square with a 1.5px tick.

**No native dialogs.** `prompt()`/`confirm()`/`alert()` are banned â they break the visual
language instantly. Creating a named object commits a provisional name (`Area 4`, `Untitled
object`) and focuses an **inline** field: Enter commits, Escape reverts, blur saves.

**Data atoms.** `.dia` â a 7px square rotated 45Â°, **the severity glyph of the product**, always
paired with the severity word. `.bar` 3px track. `.kv` 96px term / value grid. `.card` groups
prose and never nests. `.statgrid` uses **1px gaps filled by the grid background** so cells read
as a ledger, not floating cards. `.empty` = 30px icon at .45 opacity + one 12px sentence.

## 7.2 Tables

`border-collapse:separate; border-spacing:0`, 12.5px. Sticky 25px `thead th` at 11px/600, sort
arrow on the active column. `tbody td` 5/9px, `white-space:nowrap`. Hover `--bg-2`,
`aria-selected` `--bg-3`, `.ack` drops to .55 opacity except `.keep` cells. Long text columns get
`class="title"` (`max-width:1px; width:46%`) with an inner ellipsising `<div>`.

## 7.3 Floating layers

**Tooltip** `#maptip`: fixed, `#20262c`, bold 12px + 10px mono line, `--shadow`, 100ms fade,
cursor +14/+14, viewport-clamped. **Palette:** 600px at 12vh, 40px borderless input, results max
52vh. **Toast:** bottom-right stack, auto-dismiss 3.2s â toasts confirm actions, never carry
information the user must read.

## 7.4 Icons

One inline `<svg style="display:none">` sprite of ~70 `<symbol>`s on a 24Ã24 viewBox,
`fill:none; stroke:currentColor; stroke-width:1.4â1.6`, sized by CSS.

```
i-globe i-inbox i-dossier i-chart i-spark i-doc i-clock i-onto i-sat i-read
i-search i-plus i-bell i-layers i-eye i-eye-off i-print i-play i-pause i-target
i-grid i-reset i-add-brief i-flag i-check i-export i-link i-merge i-trash i-swipe
i-ship i-plane i-anchor i-pin i-poly i-path i-text i-measure i-cursor
i-scan i-scanbox i-repeat i-gear i-full i-full-exit i-book i-keyboard
i-session i-view i-alert i-relate i-grip i-pinned i-history
i-mail i-work i-case i-team i-comment i-rfi i-handover i-attach i-stamp i-send
i-present i-notes i-next i-prev
i-collapse-l i-collapse-r i-north i-zoom-in i-zoom-out i-recentre
i-node-person i-node-org i-node-faction i-node-facility i-node-country
i-node-corridor i-node-event i-silh-plane i-silh-ship
```

Monochrome, no fills (except the two 120Ã60 silhouettes), no two-tone, no rounded app-icon
containers, no icon font, **no emoji**.

## 7.5 Keyboard, motion, accessibility

| Key | Action |
|---|---|
| `âK` / `Ctrl+K` | command palette |
| `1`â`9` | switch module (within the active mode) |
| `W` / `G` | toggle WatchâWorkstation / go to My work |
| `j` / `k` | next / previous signal (Inbox) |
| `Tab` | cycle palette scope |
| `@` / `ââµ` | mention / send a comment |
| `F` / `?` | full screen / shortcuts |
| `â â Space Home End` | deck navigation |
| `Esc` | close palette, dialog, present mode, field |
| `âP` | print the loaded briefing |

| Element | Duration | Easing |
|---|---|---|
| Hover / press | 100ms | linear |
| Tooltip / palette | 100 / 120ms | linear |
| Panel slide / minimise | 240â260ms | `--ease` |
| Map view / centre / fly | 420 / 520 / 620ms | d3 with sync fallback |
| Ping / lead-up pulse | 1300 / 900ms | stepped cubic-out |
| Graph auto-fit, deck fit | synchronous | â |

No bounce, no spring, no scale-on-hover, no list entrance animations.
`prefers-reduced-motion` collapses everything to 0.01ms.

**Accessibility.** `role="tablist"` on the rail; `aria-selected` on rail buttons, tabs, rows;
`aria-pressed` on toggles; `aria-expanded` on collapsible headers; visible
`:focus-visible{outline:1px solid var(--acc-hi)}`. `--txt` on `--bg-1` â 11:1; `--txt-3` â 4.8:1;
`--txt-4` never for text a user must read. **Severity is never colour alone.**

---

# PART 8 Â· MOBILE COMPANION

`HorizonWatchMobile.html` + `hw-mobile.js`, sharing `hw-data.js` and `hw-data2.js`.

**Not a responsive console.** The console stays desktop-only (floor 1280px). This is a separate
surface for an on-call security lead doing **four jobs well** rather than fourteen badly.

390Ã844 in a phone bezel â `ios_frame` geometry as plain CSS (no React/Babel: three more CDN
loads on an already-fragile path is the wrong trade): bezel `border-radius:48px`, island
`126Ã37` at `top:11` `radius:24`, home indicator `139Ã5` `radius:100`, shadow
`0 40px 80px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.12)`.

```css
.app{position:absolute;inset:0;display:grid;grid-template-rows:54px 52px 1fr 78px}
```

**Mobile deltas:** body 15px not 12.5 Â· minimum target 46px Â· `:active` not `:hover` Â· detail as
a bottom **sheet**, not a side panel Â· 34px filter chips scrolling horizontally.

| Tab | Behaviour |
|---|---|
| **Alerts** | Escalations + critical/high, badge of unactioned. Filters *needs action / escalated / critical / all*. Tap â sheet with assessment, `.kv`, corroboration count, then **Acknowledge Â· Escalate Â· Show on map Â· Note to desk**. Acknowledged rows drop to 55% opacity rather than vanishing |
| **Brief** | The briefing at phone measure (15px/1.68), references live |
| **Map** | Natural Earth geometry, severity diamonds, AIS hulls and ADS-B airframes rotated to heading, filter chips, tap â bottom card |
| **Note** | Press-and-hold voice note with live timer and waveform, written note, routing, attachable reference, outbox `queued â sent` |

**Six defects to avoid:**

1. **Never take the map out of the grid.** `position:absolute;inset:0` as a grid child paints
   **above** the in-flow header and tab bar â the user is trapped. Use
   `#view-map{grid-row:3;position:relative;min-height:0;overflow:hidden}`.
2. **One bound zoom behaviour.** `zoom.transform` dispatches only to *that instance's* listeners;
   calling it on a fresh `d3.zoom()` moves nothing and desyncs `__zoom`. Hoist and reuse.
3. **Re-apply the counter-scale on every redraw**, or glyphs snap to full size at k=4â12.
4. **Inline references are spans, not buttons** â worse here: the column is 358px and
   `.screen{overflow-x:hidden}` clips rather than scrolls.
5. **Reset `padding` in the global `button` rule**, not just `border` â UA `~1px 6px` shows as
   gaps mid-sentence.
6. **A reference set from anywhere must survive the note form.** The `#nref` list is built from
   the on-call queue; a moderate signal reached via a Brief reference had no option and silently
   fell back to "None". Carry the intent in state and always include the referenced record.

**Offline degradation â the point of the product.** Libraries load **after** the app,
asynchronously, with a 6s timeout and three mirrors (unpkg â jsDelivr â cdnjs). **Only the Map
tab may depend on d3** â Alerts and Brief use a plain haversine and `reduce`-based
`countBy`/`mean`. `initMap()` shows *"Loading map geometryâ¦"* then either draws or says
*"Map geometry unavailable offline. Alerts, Brief and Note still work."*

**Tablet:** "tablet as the full console" holds in landscape on a 12.9â³ iPad (1366pt) but the
console floor is 1280, so an 11â³ iPad at 1194 clips. Dropping the floor to 1024 is achievable
without touching the layout above 1280, but is **not currently done**.

---

# PART 9 Â· BUILD ORDER

1. **Tokens and frame** â Â§1.2 + the four-row grid, top bar, tab strip, status bar.
   *Verify:* nothing scrolls the page; no clipped cells at 1280px.
2. **Corpus** â `hw-data.js`, then `hw-data2.js`, then `hw-data3.js`.
3. **Rail, tabs, view switching** â with `data-set` stamping from the start.
4. **Map** â projection, basemap, land, graticule, markers, counter-scaled zoom, tooltip, cursor
   readout, and **the rAF probe + `applyZoom`** (Trap 1).
5. **Layer panel** wired to `visible()`; legend, header count and layer counts must agree.
6. **Inspector** (four states), the density strip, **and `fireInspector()`** (Trap 2).
7. **Glass panels, collapse rails, full-width header band.**
8. **Inbox** â 9. **Dossiers** â 10. **Analytics** â 11. **Generator**.
12. **Reader + print layout** as one artefact. 13. **Deck** (Trap 3).
14. **Replay** with locator minimap and `replay on map`.
15. **Ontology** â tiers, barycentre ordering, pinned layout, auto-fit.
16. **Imagery** â AOI registry, derive-coverage, split/swipe/after, detection overlay, history.
17. **Annotations, live tracks, infrastructure, draw-to-scan** (ring winding + off-globe guards).
18. **Sessions, views, alerts, exports, related records, time cursor, clustering, settings.**
19. **Workstation** â mode, identity, My work, Mail, Cases, Team, comments, assignment, presence,
    RFIs, approval, handover, interrupt.
20. **Gmail connector + distribution book.** 21. **Mobile companion.** 22. **Â§10 pass.**

---

# PART 10 Â· ACCEPTANCE CHECKLIST

Any "no" is a defect, not a preference.

**Type and colour**
- [ ] No `@font-face`, no font CDN.
- [ ] `--mono` only on figures â never a heading, button, tag or label.
- [ ] `text-transform:uppercase` only on the classification chip, code tags, tier labels,
      printed headings and deck eyebrows.
- [ ] No hue outside: neutral greys, one accent, four severity colours, two delta colours,
      annotation gold, scan blue.
- [ ] No gradient; no `box-shadow` on a non-floating element; no `border-radius` > 2px.

**Layout**
- [ ] At 1280Ã720 no pane is clipped and no text wraps inside a control.
- [ ] `elementFromPoint` on every map-header control returns that control (nothing under glass).
- [ ] Zero `.statusbar .cell` and zero `.timestrip .head` children with
      `scrollHeight > clientHeight`.
- [ ] Every scrollable pane scrolls.
- [ ] Minimising either Situation panel reflows the map fit and all overlays.
- [ ] `elementFromPoint` at the deck stage centre returns the slide, not the stage.

**Behaviour**
- [ ] Zoom in / out / recentre / fit change `svg.__zoom.k` **within 100ms** (test with animation
      frames throttled). `flyTo` and `ping` work with rAF disabled.
- [ ] Filter counts agree across layer panel, legend, pane header, histogram and exports.
- [ ] A signal selected anywhere opens in map, dossier, replay, reader, generator and case.
- [ ] Selecting a signal or track un-minimises the inspector **and** renders the interrupt,
      presence, assignment and discussion. Clearing the selection keeps the interrupt.
- [ ] No `prompt`/`confirm`/`alert` anywhere; every create flow uses an inline field.
- [ ] Closing the last tab reopens Situation. A module switch alone creates no tab.
- [ ] Watch shows 9 rail buttons, Workstation 4 â **verified after navigating**, and no flash of
      the wrong rail on first paint.
- [ ] An `analyst` cannot advance an approval stage and is told why.
- [ ] Generating with an empty set warns; with 12 signals it produces a 4-page document in ~4.6s
      and lands in the reader; the generator never wedges on a repeat run.
- [ ] Reader references drive both the context minimap and the right pane; a long reference
      **wraps**; `animate lead-up` plays.
- [ ] Deck builds 12 slides, Present strips chrome, `pdf` yields one slide per landscape sheet.
- [ ] Ontology node positions are byte-identical 1.2s after layout; zero plate overlaps.
- [ ] Imagery: swipe handle drags; boxes track the frame at any size; deriving coverage inserts
      `proposed` areas that promote on accept.
- [ ] A drawn scan box of ~2000 Ã 1500 km reports an area consistent with its extent (not
      ~504,470,700 kmÂ²); `HWmap.invert` returns `null` off-globe.
- [ ] `raise signal` from mail creates a triageable signal and marks the thread parsed.
- [ ] An @mention notifies the named user and lands in their Mentions queue.
- [ ] With no Gmail client ID a send queues at `delivered: 0` and the UI says it is offline.
- [ ] Distribute resolves lists plus ad-hoc addresses, de-duplicates, and issues the briefing.
- [ ] Draw an annotation, then export GeoJSON: it appears (read `HWann`, not `X.annotations`).
- [ ] Corrupt or partial `localStorage` falls back to seeds with a warning and never blocks boot.
- [ ] Console clean after visiting every module.

**Credibility**
- [ ] Sample data labelled in the status bar.
- [ ] At least one capability honestly unavailable rather than faked.
- [ ] Every number rendered is computed from the corpus â no hard-coded totals in markup.
- [ ] Prose contains no em dashes, no emoji, no marketing adjectives.

---

# PART 11 Â· DELIBERATE CHOICES â DO NOT "FIX" THESE

- **Desktop only.** No breakpoints below 1280px; this is a workstation.
- **Domains carry no colour.** Code tags and position distinguish them. This is the single
  biggest reason the interface reads as professional.
- **Only four severity colours**, reused by change detection. A fifth destroys the hierarchy.
- **Reading a signal marks it acknowledged.** Triage is a side effect of attention.
- **The generator takes ~4.6 seconds.** Latency is information.
- **The briefing is serif on paper stock.** It is a document, not a screen.
- **The deck's bottom line goes second.** Executives get the judgement before the evidence.
- **The ontology never animates into place.** Analysts memorise spatial position; drift destroys it.
- **Glass is used once, on side panels only**, so the map reads as one continuous surface.
- **No dark/light theme toggle** for the console. One considered surface beats two mediocre ones.
  (The deck has one, because a lit room is a different problem.)
- **Workstation is a mode, not a module group.** Tabs are records, the rail is the lens, the mode
  decides which lens set exists. Showing all fourteen modules at once undoes it.
- **Sessions and views are different things.** A session is a desk; a view is a filter preset
  inside one. Merging them loses the ability to look at the same desk two ways.
- **The alert editor shows matches before you save.** A builder that cannot tell you what would
  fire is a form, not a tool.
- **The commercial EO feed stays unavailable**, which is what makes the satellite tasking layer
  honestly unavailable rather than an empty stub.
- **Archived scan passes do not fake imagery.** Clicking one says the imagery is not cached.
- **A send with no mail connection queues at `delivered: 0`.** Never claim delivery you cannot
  perform.
- **Two localStorage keys only**: `horizonwatch.workspace.v1` and `horizonwatch.workstation.v1`
  (plus `horizonwatch.gmail.v1`). Never touch anything else, and always fall back to seeds.
- **The phone companion is not the console.** It does four jobs. Adding modules to it, or making
  the console responsive to phone width, breaks both.

---

# PART 12 Â· NOT YET BUILT

Recorded so the next engineer knows the difference between a gap and a decision.

1. **Footage verification pipeline.** Automatic retrieval is easy; automatic *verification* is
   not, and that distinction is what makes the feature honest. Sources, best first: your own
   sensors (site CCTV, convoy dashcams, drone over RTSP/ONVIF â you own the provenance);
   broadcast monitoring vendors with search by keyword, place and time; wire agency video APIs
   (Reuters Connect, AP Video Hub); platform APIs, whose results are **unverified candidates,
   never evidence**; OSINT aggregators that already geolocate.

   Architecture: a candidate queue with a state machine â
   `retrieved â deduplicated â geolocation inferred â analyst verified | rejected` â and a
   chain-of-custody record (source URL, retrieval time, uploader, claimed location, file hash,
   who verified, what corroborated it).

   Automatable verification signals: perceptual hashing against a seen-clip database (catches
   recycled footage, the most common failure by far), reverse image search on keyframes for
   earliest appearance, sun-angle and shadow-azimuth against claimed time and place, weather
   cross-check, and landmark matching against satellite imagery â which ties straight into Â§3.3.

   **Embedded news-channel feeds are not this.** A hardcoded video wall reads consumer and ages
   badly. The professional form is a source and a verification queue.

2. **Tablet floor.** Drop the console minimum from 1280 to 1024 for 11â³ iPad landscape, without
   touching the layout above 1280.

3. **Calendar write-back.** The Google Calendar scope is requested and the day column reads a
   static list; scheduled scans and RFI due dates do not yet create events.

4. **Attachment preview.** Mail attachments list correctly but do not open; PDF text-layering is
   specified in Â§4.5 and not implemented.

5. **Real WebSocket presence.** Presence is currently derived deterministically from the record
   reference; Â§6.5 lists the event.
