# Horizon Watch â Exact Replication Manual

**For Claude Code. Follow literally. Do not improvise, do not "improve", do not substitute libraries.**

---

## 0. THE FASTEST CORRECT PATH

This UI already exists as 11 plain files with no build step. **A 1:1 replica is a byte-for-byte
copy of these files, in this order:**

```
image-slot.js      starter web component (drop-target image placeholder) â copy verbatim
hw.css             ~1500 lines, ALL styling
hw-data.js         core corpus (42 signals, 10 entities, country risk, flows, briefings)
hw-data2.js        extended corpus (infrastructure, tracks, imagery scenes, ontology, AOIs)
hw-app.js          shell + Situation map + Inbox
hw-modules.js      Dossiers, Analytics, Generator, Print document, Replay
hw-x.js            annotations, tracks, minimaps, Ontology, Imagery, Reader, scan areas
hw-y.js            sessions, palette v2, saved views, alert rules, exports,
                   related records, time cursor, clustering, scan history,
                   link appendix, settings, full screen
HorizonWatch.html  document shell, icon sprite, all 10 module skeletons, dialogs

HorizonWatchMobile.html  phone companion â separate surface, NOT responsive console
hw-mobile.js             its logic; reuses hw-data.js + hw-data2.js
```

`HorizonWatch.html` loads them in exactly this order at the end of `<body>`:

```html
<script src="image-slot.js"></script>
<script src="hw-data.js"></script>
<script src="hw-data2.js"></script>
<script src="hw-app.js"></script>
<script src="hw-modules.js"></script>
<script src="hw-x.js"></script>
<script src="hw-y.js"></script>
```

Order is load-bearing: each later file extends earlier ones through globals (Â§9).

Only two external libraries, pinned with SRI, in `<head>`:

```html
<script src="https://unpkg.com/d3@7.9.0/dist/d3.min.js"
  integrity="sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i"
  crossorigin="anonymous"></script>
<script src="https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js"
  integrity="sha384-Ukv1p/xTma6P4/2bY5KzWBw+ydSpXmhCMtyciIQVDJ1RmOxtCYNMF1uXT9T63H67"
  crossorigin="anonymous"></script>
```

Basemap fetched at runtime:
`https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json`,
decoded with `topojson.feature(topo, topo.objects.countries)`.
**Never hand-draw country geometry.**

**Production hardening â the CDN is a single point of failure.** Both libraries load as
blocking `<script src>` tags against one host. If unpkg returns an error the console dies
with a blank frame; if it *stalls* rather than failing, the parser blocks and there is not
even an error to diagnose. For anything beyond a local demo, **vendor both files next to the
HTML** and point the tags at the local copies. If you must stay on a CDN, replace the two
blocking tags with a loader that gives each mirror a hard timeout â `document.write`
fallbacks do not help, because a hanging request blocks parsing before the fallback runs:

```js
var TIMEOUT = 5000;
function loadOne(urls, global, done) {
  var i = 0;
  (function attempt() {
    if (i >= urls.length) return done(false);
    var s = document.createElement('script'), settled = false, timer;
    function ok()  { if (settled) return; settled = true; clearTimeout(timer); done(true); }
    function bad() { if (settled) return; settled = true; clearTimeout(timer);
                     if (s.parentNode) s.parentNode.removeChild(s); attempt(); }
    s.src = urls[i++];
    s.onload = function () { window[global] ? ok() : bad(); };
    s.onerror = bad;
    timer = setTimeout(bad, TIMEOUT);     // a hanging host must not block the boot
    document.head.appendChild(s);
  })();
}
// then inject hw-app.js â hw-modules.js â hw-x.js â hw-y.js in order,
// and render a legible failure panel into #app if no mirror answers.
```
Mirrors worth listing: `unpkg.com`, `cdn.jsdelivr.net/npm`, `cdnjs.cloudflare.com/ajax/libs`.

If you are rebuilding rather than copying, this document specifies every element. Read
Â§1âÂ§4 before writing a line; they contain the rules that decide whether this looks like a
product or a demo.

---

## 1. HARD RULES (violating any one is a defect)

1. **System fonts only.** No `@font-face`, no font CDN.
   `--font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif`
2. **Monospace only for figures** â timestamps, coordinates, IDs, counts, statistic values,
   axis ticks, the agent log. **Never** on headings, buttons, tags, nav, labels, prose.
   No letterspaced uppercase mono anywhere.
3. **Colour only encodes state.** Neutral grey UI. Hue permitted for: 4 severity colours,
   2 delta colours, 1 accent blue, annotation gold. Domains/sources/regions are GREY.
4. **Flat.** radius 2px, 1px hairlines, no gradients, no shadows except floating layers,
   no scale-on-hover. Buttons 21/24px, inputs 26px, rows 24â30px, pane headers 28px.
5. **No emoji. No em dashes. Sentence case everywhere** except: classification chip, map
   coordinate readout, short code tags, ontology tier labels, printed section headings.
6. **No `prompt()` / `confirm()` / `alert()`.** Every create flow uses an inline field.
7. **Desktop only.** Min 1280Ã720. No responsive breakpoints below that.

---

## 2. TOKENS â paste verbatim into `:root`

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
  --r:2px;
  --ease:cubic-bezier(.3,.7,.4,1);
  --shadow:0 10px 26px rgba(0,0,0,.42),0 1px 3px rgba(0,0,0,.4);
  --top:40px; --tabs:32px; --status:24px;
  --pane-l:250px; --pane-r:312px;   /* Situation panels â map fit AND overlays read these */
}
```

Inline-only colours (do not invent others):

| Use | Hex |
|---|---|
| delta worse / better | `#b0645c` / `#6d9a83` |
| tag red / amber / green / blue (textÂ·border) | `#cf6259`Â·`#5c3b38` Â· `#c19446`Â·`#5a4a2c` Â· `#699781`Â·`#3a5346` Â· `#78a5d4`Â·`#39536e` |
| land Â· land stroke Â· ocean Â· graticule Â· hover | `#232a30` Â· `#2e363d` Â· `#12161a` Â· `#20262b` Â· `#39424a` |
| risk ramp 1â5 | `#232a30 #2a3138 #333a3c #3d3c39 #463c37` |
| chart area Â· line Â· grid | `#3f6fa8`@13% Â· `#7d97b3` Â· `#262c33` |
| histogram Â· histogram-hot | `#4a545e` Â· `#8d5348` |
| heatmap ramp Â· empty | `#232a30`â`#5c6b78` Â· `#1e242a` |
| annotation ink | `#c8a04a` (fill 10%) |
| scan zone (stroke Â· fill Â· vertex Â· sweep) | `#5f95d0` Â· `rgba(95,149,208,.10)` Â· `#5f95d0` Â· `#8ebdf0` |
| vessel Â· sanctioned Â· aircraft Â· watchlisted | `#7fa8c9` Â· `#c4453c` Â· `#a8b6c2` Â· `#b7822c` |
| graph plate Â· link Â· inferred Â· tier rule | `#232a31` Â· `#4c5762` Â· `#4d5964` dashed Â· `#262c33` dashed |
| paper Â· ink (printed briefing) | `#f4f2ee` Â· `#1b1f24` |

**Type scale:** pane title 12/600 Â· body & table 12.5 Â· label 11 Â· detail h2 15/600 Â·
dossier h1 19/600 Â· reader body 13.5/1.68 Â· statistic mono 19 Â· gauge mono 23 Â·
data cell mono 11.5 Â· axis mono 9.5 Â· log mono 11/1.65 Â· tag 10 (ls .03em) Â·
**printed briefing body = SERIF (Times/Georgia) 13/1.6**.

---

## 3. APP FRAME

```css
#app{display:grid;grid-template-columns:minmax(0,1fr);
     grid-template-rows:40px 32px 1fr 24px;height:100vh}
body{overflow:hidden}
.view{display:none;height:100%;overflow:hidden}
.view.active{display:block}
.panes{display:grid;height:100%;min-height:0;grid-template-rows:minmax(0,1fr)}
.scroll{flex:1;min-height:0;overflow:auto}
```

**Three things break the whole app if omitted:**
- `grid-template-columns:minmax(0,1fr)` on `#app` â else the implicit track sizes to the
  top bar's min-content and the app overflows the viewport.
- `height:100%` on `.view` â else panes grow to content and inner scrolling dies.
- `flex:1;min-height:0` on every scroll container â never `height:100%`.

**Overflow rule for every fixed-height flex bar** (`.topbar`, `.toolbar`, `.statusbar`,
map `.panehead`, `.timestrip .head`):

```css
.toolbar{display:flex;align-items:center;gap:8px;min-height:34px;padding:0 10px;flex:none;
  background:var(--bg-2);border-bottom:1px solid var(--line);
  min-width:0;overflow-x:auto;scrollbar-width:thin;scrollbar-color:var(--line-strong) transparent}
.toolbar>*{flex:none}                                    /* actions never shrink */
.toolbar>.desc,.toolbar>h3{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.toolbar>input.input{flex:0 1 auto;min-width:86px}
.toolbar>select.input{flex:0 1 auto;min-width:96px}
.statusbar .cell{flex:none;white-space:nowrap}
```

If everything is `flex:none`, long descriptors push buttons under the glass panel where they
are unclickable and invisible. If nothing is, text wraps and clips inside a fixed-height bar.
**Descriptors give way; actions never do.** Verify `toolbar.scrollWidth <= 1280 â paneL â paneR`.

---

## 4. GLASS PANELS AND THE MAP HEADER (highest-risk area)

```css
aside.pane{background:rgba(26,31,37,.72);backdrop-filter:blur(16px) saturate(115%);
  transition:transform .24s var(--ease),opacity .18s linear;will-change:transform}

/* Situation: map spans the whole grid, panels float above it */
#view-map .panes{grid-template-columns:var(--pane-l) 1fr var(--pane-r);
  transition:grid-template-columns .24s var(--ease);position:relative}
#view-map .panes>.pane:nth-child(2){grid-column:1/-1;grid-row:1;z-index:0}
#view-map .panes>aside.pane:first-of-type{grid-column:1;grid-row:1;z-index:2}
#view-map .panes>aside.pane:last-of-type {grid-column:3;grid-row:1;z-index:2}
#view-map .panes>aside.pane{background:rgba(22,27,33,.66);animation:none!important;transform:translateX(0)}

/* header is a FULL-WIDTH band ABOVE the glass; panels start below it */
#view-map .panes>.pane:not(aside)>.panehead{position:relative;z-index:4;background:var(--bg-2);
  min-width:0;overflow-x:auto}
#view-map .panes>aside.pane{margin-top:28px}

/* minimise */
#view-map .panes.min-l{--pane-l:30px}
#view-map .panes.min-r{--pane-r:30px}
#view-map .panes.min-l>aside.pane:first-of-type,
#view-map .panes.min-r>aside.pane:last-of-type{opacity:0;pointer-events:none}
#view-map .panes.min-l>aside.pane:first-of-type{transform:translateX(-100%)}
#view-map .panes.min-r>aside.pane:last-of-type {transform:translateX(100%)}
#view-map .panes.min-l .panetab.l{display:flex;left:0}
#view-map .panes.min-r .panetab.r{display:flex;right:0}

/* entry animation for every OTHER module */
.view.active>.panes>aside.pane:first-of-type{animation:slideL .26s var(--ease) 1}
.view.active>.panes>aside.pane:last-of-type {animation:slideR .26s var(--ease) 1}
.view.active>.panes>.pane:not(aside){animation:fadeUp .22s var(--ease) 1}
@keyframes slideL{from{transform:translateX(-14px);opacity:0}to{transform:none;opacity:1}}
@keyframes slideR{from{transform:translateX(14px);opacity:0}to{transform:none;opacity:1}}
@keyframes fadeUp{from{opacity:0}to{opacity:1}}
```

**Two traps here, both cost real debugging time:**

1. **Never pad the map header by the panel widths** to dodge the glass. At 1280px that
   leaves 700px for ~760px of controls and the overflow renders *under* an opaque panel.
   The header must sit above the glass and the panels start below it.
2. **One mechanism must own `transform`.** A keyframe animation with
   `animation-fill-mode:both` holds its final frame forever and always beats a transition â
   the panel slides in and then refuses to slide out. Removing the animation in the same
   frame as the class change makes it jump instead. Hence
   `#view-map .panes>aside.pane{animation:none!important}` â the Situation panels are driven
   solely by the transition, keyframes stay on the other modules.

**Map overlay positions** (all read the same tokens):

| Element | Position |
|---|---|
| annotation + quick-layer bar | inside the map pane header â never on the map |
| `.mapmeta` coordinates + scale | `bottom:11px; left:calc(var(--pane-l) + 12px)` â **no background, border or blur**, just `text-shadow:0 1px 2px rgba(12,15,18,.9)` |
| `.mapchrome` navigation | `bottom:9px; right:calc(var(--pane-r) + 9px)` |
| severity legend | **not on the map** â a section inside the inspector |

---

## 5. THE ANIMATION-FRAME TRAP (read before writing any zoom code)

`requestAnimationFrame` never fires in throttled/backgrounded frames. **d3 transitions are
rAF-driven**, so every `.transition()` silently no-ops: zoom buttons do nothing, pings never
expand, layouts never fit. Two mandatory patterns:

```js
// A. probe once, then route EVERY zoom through one helper
let rafOK = null;
(function probeRaf(){ let fired=false;
  requestAnimationFrame(()=>{fired=true;rafOK=true;});
  setTimeout(()=>{if(!fired) rafOK=false;},260);
})();
function applyZoom(t, ms){
  if (rafOK && ms) svg.transition().duration(ms).call(zoom.transform, t);
  else svg.call(zoom.transform, t);            // synchronous fallback
}

// B. pulses use stepped timers, never d3 transitions
const steps=22, r1=46/k;
for(let s=1;s<=steps;s++) setTimeout(()=>{
  const f=s/steps, e=1-Math.pow(1-f,3);        // cubic-out by hand
  c.attr('r',2+(r1-2)*e).attr('stroke-opacity',1-e);
  if(s===steps) c.remove();
}, delay + s*(1300/steps));

// C. never defer layout with rAF â bounded timeout retry instead
let tries=0;
function sizeMap(){
  const w=el.clientWidth,h=el.clientHeight;
  if(!w||!h){ if(tries++<20) setTimeout(sizeMap,50); return; }
  tries=0; /* fit */
}
```

Applies to: `nudgeZoom`, `#nav-home`, `#nav-fit`, `#t-reset`, `fitView`, `HWmap.flyTo`,
`HWmap.ping`, the replay lead-up sequence, minimap pings, and the ontology auto-fit.

---

## 6. TOP BAR Â· TABS Â· STATUS BAR

**Top bar (40px)** â brand block (196px min, 17px meridian glyph, `Horizon Watch` 12.5/600
over `ops console 4.2` 10px) Â· module rail Â· spacer Â· tools.

**Module rail â 9 buttons, 62px each**, 15px icon over 10px label, `role="tab"`.
Order and ids:

```js
MODULES = [
 {id:'map',       label:'Situation', icon:'i-globe',   tab:'Global situation'},
 {id:'inbox',     label:'Inbox',     icon:'i-inbox',   tab:'Signal inbox', badge:()=>S.unread},
 {id:'dossier',   label:'Dossiers',  icon:'i-dossier', tab:'Dossier'},
 {id:'analytics', label:'Analytics', icon:'i-chart',   tab:'Exposure analytics'},
 {id:'generate',  label:'Generate',  icon:'i-spark',   tab:'Briefing generator'},
 {id:'replay',    label:'Replay',    icon:'i-clock',   tab:'Event replay'},
 {id:'ontology',  label:'Ontology',  icon:'i-onto',    tab:'Ontology graph'},
 {id:'imagery',   label:'Imagery',   icon:'i-sat',     tab:'Change detection'},
 {id:'reader',    label:'Briefings', icon:'i-read',    tab:'Briefings'},
 {id:'doc',       label:null,        icon:'i-doc',     tab:'Print layout', hidden:true}
];
// the rail renders MODULES.filter(m=>!m.hidden) â the print layout is a VIEW, not a destination
```

Idle `--txt-3`; hover `--bg-3`+`--txt`; selected `--bg-0`+`--txt`+2px `--acc-hi` bottom border.
Inbox badge: 8.5px mono, `#c4453c`, `position:absolute;transform:translate(14px,-8px)`.

**Tools cluster** (each 25px icon button):

| Control | Click behaviour |
|---|---|
| `#btn-newtab` | opens the command palette |
| `#btn-aoi` | opens Situation, arms `[data-tool=scanbox]`, toast "Scan box armed â drag a rectangle on the map" |
| `#btn-export` | toast: "View exported to the analyst workspace" |
| `#btn-search` (272px, shows `âK`) | opens the command palette |
| `.classif` chip | static `INTERNAL // RISK` |
| `#clock` | live UTC `hh:mm:ss Z Â· 02SEP`, 1s interval |
| `#btn-bell` | opens Inbox + toast "N unreviewed signals in the inbox" |
| `#btn-full` | toggles full screen; icon swaps to `i-full-exit`; map re-fits after 120ms |
| `#btn-settings` | opens the settings dialog on the General tab |
| `.avatar` | static `KA` |

Below 1400px the search collapses to its icon; below 1180px the clock hides.

**Tab strip (32px).** Opening a module reuses its tab or appends one. Tab = 5px dot,
ellipsised label (max 216px), close `â` visible on hover only. Selected: `--bg-0` + 1px
`--acc-hi` top rule. Closing the active tab selects the last remaining; closing the last
reopens Situation. **Labels are contextual**: `Dossier Â· Red Sea corridor`,
`BRF-0436 Â· Weekly geopolitical exposure review`, `Print layout Â· BRF-0436`.
Right cluster: `â 7 feeds live` and `Ingest 124/min` (1s tick). `+` opens the palette.

**Status bar (24px).** `â Connected` Â· `Corpus 42 signals` Â· `Latency 42 ms` (re-randomised
each second) Â· `Tasking queue 2` Â· `Sample corpus, not live reporting` Â· spacer Â·
`Briefing basket N` (live) Â· `K. Almeida Â· Group security` Â· `Build 4.2.108`.

---

## 7. PANE GRIDS

| Module | `grid-template-columns` |
|---|---|
| Situation | `var(--pane-l) 1fr var(--pane-r)` |
| Inbox | `212px 1fr 356px` |
| Dossiers | `238px 1fr 292px` |
| Analytics | `1fr` |
| Generate | `290px 1fr 322px` |
| Replay | `1fr 300px` (right pane leads with a 196px minimap) |
| Ontology | `236px 1fr 316px` |
| Imagery | `250px 1fr 330px` |
| Reader | `236px 1fr 336px` (right pane leads with a 196px minimap) |
| Print layout | `242px 1fr` |

Pane internals always: `.panehead` (28px) â `.scroll` â optional fixed footer.

---

## 8. EVERY CONTROL, EVERY MODULE

Format: `#id` â label â **what happens on click/change**.

### 8.1 Situation `#view-map`

**Left glass pane, `Layers` (250px).** Header: `all` `none` + collapse chevron.

| Control | Behaviour |
|---|---|
| `#layers-all` / `#layers-none` | add/clear every domain in `S.domains`, then `renderLayers(); drawMarkers(); drawStrip()` |
| `#min-l` | `setPane('l',true)` â adds `.min-l`, panel slides out, `--pane-l:30px`, map re-fits after 260ms |
| **Event domains** rows (7) | row click toggles that domain; row shows swatch, name, window count, eye icon |
| **Context layers** rows (6) | Country risk index Â· Graticule 10Â° Â· Trade & energy flows Â· Areas of interest Â· Marker labels Â· *Satellite tasking (none)* â the last is permanently off and toasts "No satellite tasking layer in this corpus" |
| **Severity floor** chips (4) | `Critical+ / High+ / Moderate+ / Low+`, single select, default `Low+` |
| **Time window** seg `[24][72][168][720]` | sets `S.win`, default 72h; relabels the group count; redraws markers + density strip |
| **Live tracks** rows (4) | Vessels (AIS) Â· Aircraft (ADS-B) Â· Sanctioned/watchlisted only Â· Ports & airports â each toggles a layer flag and redraws |
| **Annotations** list | click = select + fly to it; click a selected row's name = inline rename; `â` = delete |

**Header band (full width, above glass).** `Global situation` Â· `42 signals Â· 72h window` Â·
annotation tools Â· quick-layer buttons Â· projection segment.

| Control | Behaviour |
|---|---|
| `[data-tool=select]` | default; restores `svg.call(zoom)` so panning works |
| `[data-tool=point]` | click on map drops a marker, commits `Marker N`, focuses inline rename |
| `[data-tool=line]` | click adds vertices, **double-click finishes**, commits `Route N` |
| `[data-tool=area]` | click adds corners, double-click closes, commits `Area N` |
| `[data-tool=measure]` | click adds points, double-click finishes; label is `123 km / 66 nm` (no rename prompt) |
| `[data-tool=scanbox]` | **press-drag-release** a rectangle â opens the scan panel (Â§8.1a) |
| `[data-tool=scanpoly]` | click corners, **double-click to close** (min 3) â opens the scan panel |
| `#t-risk` | toggles country-risk choropleth; syncs with the layer panel row |
| `#t-grat` | toggles graticule |
| `#t-label` | toggles marker place labels |
| `#t-reset` | `fitView(S.proj, true)` |
| `#proj-seg [world][emea][apac][amer]` | re-fits the projection to that box, animates the zoom to identity over 420ms |

Projection boxes: `world [[-170,78],[178,-58]]` Â· `emea [[-22,62],[62,-12]]` Â·
`apac [[62,46],[150,-12]]` Â· `amer [[-128,52],[-32,-46]]`.
Fit padding = `paneInsets(w)` = `[min(--pane-l, w*0.2)+8, min(--pane-r, w*0.22)+8]`.

**Navigation cluster (bottom-right, one bordered stack):**

| Control | Behaviour |
|---|---|
| `#nav-in` | `applyZoom(current Ã 1.6, 240)` |
| `#nav-z` | live readout, e.g. `2.6Ã` |
| `#nav-out` | `applyZoom(current Ã· 1.6, 240)` |
| `#nav-home` | `applyZoom(zoomIdentity, 420)` |
| `#nav-fit` | computes the bbox of all visible signals, fits at `k = clamp(1..10, 0.86/â¦)`, 560ms, toasts `N signals fitted to view` |
| compass | static north-up mark |

**Map interactions.** `d3.zoom().scaleExtent([1,14])`, double-click zoom disabled.
On every zoom event: counter-scale markers `translate(p) scale(1/k)`, divide land stroke by
`k`, update `#map-scale` = `round(2400/k) km` and `#nav-z`.
Hover a country â tooltip `name` + `Country risk index n/5`.
Hover a marker â `title` + `place Â· Severity Â· 02SEP 0940Z`.
Click a marker â `HWselect(id)` â inspector (auto-reveals if minimised).
Click bare map â clears selection.
Mouse move â `#map-cursor` = `LAT +24.2013  LON +119.6042` (4 dp, via
`projection.invert(zt.invert([x,y]))`).

**Marker geometry.** `<rect>` rotated 45Â°: 9px critical / 8px high / 7px other, severity
fill, 1px ocean stroke, opacity .55 when acknowledged; critical adds an 11px halo circle.
Sorted ascending by severity rank each draw so critical is never occluded.
Vessel = hull path rotated to heading + dashed wake; red when `sanctioned`.
Aircraft = airframe path rotated to heading; amber when `watch`.
Names appear above zoom 2.2Ã. Ports = circle+anchor, airports = airframe mark, both labelled
with their code.

**Density strip (98px).** 60 buckets over the window; buckets containing critical/high are
`#8d5348`, others `#4a545e`. Axis format `%H:%MZ` under 7 days, `%d %b` above.
`#strip-jump` â opens Replay.

### 8.1a Scan area panel `#scanpanel` â draw-to-scan

A 322px glass panel that **slides in from the right edge of the map** (`transform:
translateX(100%)â0`, `.open`, 260ms, `z-index:6`) when a scan geometry is committed. It sits
above the inspector deliberately â it is a task panel, not a third column.

```css
.scanpanel{position:absolute;top:0;right:0;bottom:0;width:322px;z-index:6;
  display:flex;flex-direction:column;
  background:rgba(22,27,33,.9);backdrop-filter:blur(18px) saturate(115%);
  border-left:1px solid var(--line-strong);
  transform:translateX(100%);opacity:0;pointer-events:none;
  transition:transform .26s var(--ease),opacity .18s linear}
.scanpanel.open{transform:translateX(0);opacity:1;pointer-events:auto}
```

**Drawn geometry** renders in a `scan-shape` style distinct from annotations â
`fill:rgba(95,149,208,.10); stroke:#5f95d0; stroke-dasharray:5 3` with `#5f95d0` vertex dots
â because a scan zone is a *tasking instruction*, not an analyst note (which is gold).

**Two geometry bugs you must not reproduce:**

1. **Ring winding.** `d3.geoArea` and `d3.geoPath` read a ring's winding to decide which side
   is inside, so a wrongly-wound ring measures and fills the **complement of the sphere** â a
   drawn box reported `504,470,700 kmÂ²`. Drag order and free-hand click order are both
   arbitrary. A sign test on the shoelace formula is not sufficient; pick the winding
   empirically, since any AOI is far smaller than half the sphere:

   ```js
   const ringArea = pts => d3.geoArea({type:'Polygon',coordinates:[pts.concat([pts[0]])]});
   function normalizeRing(pts){
     if (pts.length < 3) return pts;
     if (ringArea(pts) <= 2*Math.PI) return pts;
     const r = pts.slice().reverse();
     return ringArea(r) <= 2*Math.PI ? r : pts;
   }
   ```
   Apply it to the live drag preview **and** on commit, so preview and measurement agree.

2. **Off-globe inversion.** `projection.invert()` happily returns latitudes beyond Â±90 for a
   point outside the projected globe, which silently corrupts every measurement downstream.
   Guard inside `HWmap.invert` and return `null`:

   ```js
   invert(clientX, clientY){
     const r = $('#mapsvg').getBoundingClientRect();
     const p = projection.invert(zt.invert([clientX - r.left, clientY - r.top]));
     if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
     if (p[1] > 90 || p[1] < -90 || p[0] > 180 || p[0] < -180) return null;
     return p;
   }
   ```
   Every drawing handler then warns (`Start/Finish the box inside the mapped area`,
   `Click inside the mapped area`) instead of producing nonsense.

**Panel contents, in order.**

1. **Metric ledger** (2Ã2, 1px gaps on the grid background): kmÂ² covered Â· corner/vertex
   count Â· archive tiles (`ceil(areaKmÂ² / 12100)`, a Sentinel-2 tile is ~110Ã110 km) Â·
   revisit (`5 days` S2, `6 days` S1, `on tasking` commercial).
2. `#sc-name` â pre-filled from the nearest infrastructure within `max(30km, boxWidth)`
   (`Nairobi JKIA scan area`), else the nearest signal's place.
3. `#sc-cls` â the seven `AOI_CLASSES`; **changing it re-seeds the detection classes** from
   `CLASS_PRESETS` (airport â Aircraft, Helicopter, Revetment, Vehicle, Structure; port â
   Vessel, Small craft, Container stack, Crane, Vehicle; military â Aircraft, Vehicle,
   Revetment, Launcher, Berm; energy â Structure, Fuel bladder, Vehicle, Crane; urban â
   Structure, Damaged structure, Vehicle; border â Vehicle, Structure, Berm; custom â
   Structure, Vehicle, Vessel).
4. `#sc-sensor` â `Sentinel-2 Â· optical 10m` / `Sentinel-1 Â· SAR 20m` /
   `Commercial EO Â· 0.5m` / `Commercial SAR Â· 1m`. Changing it updates the revisit metric.
5. **Detection classes** â a two-column checkbox grid over all 13 `DETECT_CLASSES`, labelled
   `Detection classes â 5 of 13`.
6. `#sc-conf` â confidence floor 40â95%, default 60%.
7. `#sc-cad` â recurring cadence `daily / 3-day / weekly / monthly / on demand`.
8. `.kv` â centroid (mono, 3 dp), extent `W Ã H km`, owner.
9. **Detector log** â appears once a run starts; mono, `<br>`-joined, auto-scrolled.

**Footer buttons (always visible, 50/50):**

| Control | Behaviour |
|---|---|
| `#scan-run` | runs the pass once (below) |
| `#scan-save` | persists a recurring area (below) |
| `#scan-close` | closes the panel, clears the draft, returns to `select` |

**`#scan-run` â the pass.** Rejects an empty class set (`Select at least one detection
class`). Disables itself while running. A `scan-sweep` line animates down the drawn bounds
in 26 steps Ã 90ms â **stepped timers, not a d3 transition** (Â§5). Six log stages at
220/420/520/760/880/420ms:

```
hw-scan sentinel-2 Â· 11,411,515 kmÂ²
queried archive Â· 944 tiles Â· quality gates passed
co-registered against stored reference
object pass Â· 5 classes
siamese change pass Â· differencing counts
filtered below 60% Â· suppressed 2 recurring
3 findings Â· scene SCN-4483
```

On completion it **synthesises a real scene** and pushes it onto `X.scenes`: object counts
per selected class with signed deltas, then the three largest movers become `Change` records
with percent bboxes. Raw deltas are turned into analyst-readable findings by an
`interpret(class, delta)` table â this is the whole point of the feature:

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

Each finding is suffixed with `(+7)` / `(â12)`. Then: toast
`3 findings over X â opening SCN-4483`, set `I.scene`, select the first detection, and
**route into the Imagery module** so the result lands in the split/swipe comparison.

**`#scan-save` â recurring tasking.** Unshifts an `AOI` onto the registry with
`recurring:true`, the drawn `pts`, the chosen `classes`, `conf`, `sensor` and `cadence`;
`radiusKm = sqrt(areaKmÂ²/Ï)`; `notes` records provenance
(`Drawn on the situation map Â· 11,411,515 kmÂ² Â· 5 detection classes`). Toast
`AOI-77 saved Â· re-scanned 3-day and written to the area registry`. The panel closes, the
tool returns to `select`, and the area appears **first** in the Imagery rail with a `â»`
marker beside its cadence.

**Saved zones persist on the map** via their own `HWmapHooks` entry: any registry area with
`pts` and `status !== 'paused'` draws as a `scan-shape` polygon with its `AOI-nn` id at the
centroid. Hover tooltips `name Â· recurring cadence Â· N detection classes`; **click opens the
Imagery module on that area's latest scene.**

**Switching to any non-scan tool dismisses the panel** (`setTool` calls `closeScan()`), so a
half-configured scan never lingers behind another interaction.

**Right glass pane, Inspector (312px).** `#min-r` minimises it; `#insp-close` clears the
selection. Three states:
- *empty* â Situation summary: 2Ã2 statistic grid (signals in window / critical / countries /
  in basket), by-region bars, severity legend, six newest critical signals.
- *signal* â tags + relative time, 15px title, **Assessment** card, **Geolocation** `.kv`,
  **Exposure touched** chips, severity legend, **Nearby signals Â· 800km**, and buttons:
  `#insp-add` (add to briefing) Â· `#insp-zoom` (centre map) Â· `#insp-doss` (open nearest dossier).
- *track* â photo panel first: `<image-slot>` over an airframe/hull silhouette with a caption
  strip, then the track `.kv`, a screening note if sanctioned, and `#trk-centre` Â·
  `#trk-onto` (open in ontology) Â· `#trk-note` (drops an annotation at the track position).

### 8.2 Inbox `#view-inbox`

Left pane: read-only distribution facets (severity, region, source) â orientation only.

| Control | Behaviour |
|---|---|
| `#inbox-status [all][new][ack][esc]` | filters by status; labels `all / unread / acked / escalated` |
| `#inbox-q` | filters on title + place + country + source + id |
| `#inbox-ack` | sets selected signal `status='ack'`, toast |
| `#inbox-esc` | sets `status='esc'`, prefixes the row with an `ESC` tag, toast |
| `#inbox-add` (`brief`) | `HWbasket([sel])` |
| `#inbox-open-map` | opens Situation, pans and selects |
| column headers | click sorts; re-click flips; `â²`/`â¼` on the active column. Keys: `ts`, severity rank, `conf` numeric, else `localeCompare` |
| row click | selects; **a `new` row becomes `ack` and the rail badge decrements â reading is triage** |
| `j` / `k` | next / previous row in the sorted, filtered order |

Columns: Received 96px mono `hh:mmZ` Â· Severity 104px Â· Signal 46% ellipsised Â·
Location 150px (place + grey ISO3) Â· Domain 112px code tag Â· Confidence 112px (bar + integer) Â·
Source 118px mono. `.ack` rows drop to opacity .55 except `.keep` cells.

Right pane (`#inbox-detail`): severity/domain/ID header, title, summary, **Source chain**
(primary + time, corroboration count, `Multi-source`/`Single-source`, analyst state),
exposure chips, then `#det-add` Â· `#det-map` Â· `#det-esc`.

### 8.3 Dossiers `#view-dossier`

Left: watchlist rows â mono code, name + type, score coloured `â¥80 #c4453c`, `â¥60 #b7822c`,
`â¥40 #4f7fa6`, else `#6d7883`, plus a delta triangle.

Centre header: code + type, state tag (`Deteriorating`/`Stable`/`Improving`), 19px name,
standing note, then `#doss-brief` (pushes 6 ring signals to the basket **and opens the
generator**) Â· `#doss-map` Â· `#doss-watch`. Right of it: a 96px gauge (6px ring, `--bg-4`
track, banded arc, mono value) and a 168Ã42 sparkline with `min Â· max Â· now`.

Tabs: **Overview** (6-cell statistic grid, signal mix bars, generated analyst judgement) Â·
**Exposure** (dependency table: name, type, substitutable, single point of failure) Â·
**Risk drivers** (5 weighted bars: `>60% #8d5348`, `>40% #7d6a45`, else grey) Â·
**History** (area chart + 8 recent ring signals) Â· **Linked entities** (shared-dependency
count + `open â`).

Right pane: every signal within 1400km of the centroid (`d3.geoDistance Ã 6371`), newest first.

Exposure index:
```
score = clamp(0..100, 40*severityWeight + 25*dependencyWeight + 20*persistence + 15*corroboration)
delta = score â score(14 days ago)
```

### 8.4 Analytics `#view-analytics`

Toolbar: `#an-range [7][30][90]` Â· `#an-region` Â· `#an-domain` Â· `#an-export` (toast).
All recompute the dashboard from one `anEvents()` selector.

Blocks in order:
1. **KPI strip** â 12 ledger cells (signals ingested, assessed, critical open, countries
   touched, corridors watched, briefings issued, mean time to brief, escalations, sites in
   scope, suppliers flagged, personnel affected, revenue at risk), mono 19px + signed delta.
2. **Signal volume** â area chart, 1200Ã210 viewBox.
3. **Four donuts** â severity (severity colours), domain / region / source (grey ramps).
   96px, outer 40 inner 26, padAngle .02, total in the hole, native `<title>` for hover.
4. **Region Ã domain heatmap** (22px cells, single neutral ramp) beside **Index movers**.
5. **Highest-severity signals** table + `#an-brief` (`brief these`); row click â map.

### 8.5 Generate `#view-generate`

Left: `#g-title` Â· `#g-scope` Â· `#g-aud` Â· horizon segment `[7d][30d][90d]` Â· six section
checkboxes Â· `#g-class` Â· `#g-note`.

Centre: full corpus as a checkbox grid sorted by severity then recency.
`#gen-pick-top` selects the top 12 by severity; `#gen-clear` empties selection **and** the
basket. The basket merges into the selection on entry. 2px `#gen-prog` line at the foot.

Right: 7-step checklist, agent log, then:

| Control | Behaviour |
|---|---|
| `#gen-run` | starts the staged run; disabled while running |
| `#gen-open-doc` | enabled on completion â opens the print layout for `M.doc` |
| `#gen-cancel` | stops, logs `cancelled by operator`, state `cancelled` |

Step durations (ms) â **do not shorten; instant completion reads as fake**:
```
260 Â· 420 Â· 700 Â· 820 Â· 1400 Â· 520 Â· 480      (total â 4.6s)
Resolve parameters and scope / Assemble evidence set / Deduplicate and cluster /
Score exposure against asset register / Draft judgement and section text /
Apply house style and classification / Compile document and paginate
```
Step states: pending (index in a grey ring) Â· running (spinning `--acc-hi` ring) Â· done
(tick, green ring, elapsed seconds right-aligned).

Log grammar (mono, `pre-wrap`, auto-scrolled, `<b>` white, `<i>` green, `<u>` amber):
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
between start and finish otherwise wedges the generator until reload. Empty evidence set â
warning toast, nothing else.

On completion: build the document, unshift into the register, toast, open a **new tab
`BRF-0436 Â· <title>`**, land in the **reader**.

### 8.6 Replay `#view-replay`

Toolbar: `#rp-group [region][domain][severity]` Â· `#rp-clock` (mono cursor time).
Ruler: 128px lane gutter + 13 ticks `hh:mmZ`.
Lanes: one per group; each signal a 10px rotated square at `left:(tsât0)/windowÃ100%`,
1.4Ã on hover, white outline when selected, **22% opacity when after the cursor**.
Playhead: 1px amber rule with a triangular head at
`calc(128px + (100% â 128px) Ã t)`.

| Control | Behaviour |
|---|---|
| `#rp-play` | play/pause; advances `t += 0.0016 Ã speed` every 40ms, stops at 1, restarts from 0 if played at the end |
| `#rp-scrub` | 0â1000 range â sets `t`, updates the playhead and the cursor window |
| `#rp-speed [1][4][12]` | default 4Ã |
| lane event click | selects it **and focuses the locator minimap**: re-frames Â±18Â°, drops a severity diamond, pings twice, plots signals within 1600km as small grey diamonds |
| `#rp-replayev` | **the flagship animation** (below) |

`replayOnMap(id)`: switch to Situation â select â `flyTo(lon,lat,4.6,700)` â `ping` â then
walk the preceding â¤36h of signals within 1600km in chronological order, each drawing a
dashed severity-coloured line converging on the event plus an expanding ring, **420ms
apart** â clear after `900 + nÃ420 + 2600`ms. Reachable from replay, the reader, and any
signal row.

### 8.7 Ontology `#view-ontology`

**A fixed diagram, never a floating force graph.**

```js
TIER = {country:0, corridor:0, faction:1, org:1, person:1,
        facility:2, vessel:2, aircraft:2, event:3};
TIER_NAME = ['Geography','Actors','Assets & sites','Observations'];
```

Layout algorithm (computed **once** per node set, keyed by `nodes+types+layout`):
1. bucket nodes into tiers, sort each by descending risk;
2. **three barycentre passes** â each node takes the mean index of its neighbours, re-sort;
3. wrap tiers wider than the pane into sub-rows: `perRow = max(4, floor((wâ80)/112))`;
4. place at `step 112px`, `gapY = clamp(82..126, (hâtopâ56)/(rowsâ1))`, alternate columns
   staggered 18px;
5. pin with `fx`/`fy`. **Nothing drifts; a dragged node stays put.**
6. auto-fit the whole diagram, clamped `0.3â1.2Ã`, applied **synchronously** (Â§5).

Node plate: 92Ã40, `--bg-2` on `--line-strong`, 15px type icon, label (17 chars + ellipsis),
`type Â· risk` sub-line, 3px risk-banded strip at the bottom edge.
Links: curved orthogonal paths leaving plate edges â `M a.x,y0 C a.x,m b.x,m b.x,y1` â dashed
when inferred, `#7b8894` at 1.5px when `conf â¥ .92`, relationship word at the midpoint.
Tier bands: dashed rule + uppercase label above each row.

| Control | Behaviour |
|---|---|
| `#on-legend` rows (9 types) | click filters that type in/out; shows a count |
| `#on-conf` | minimum link confidence, default 35% |
| `#on-inferred` | show/hide links with `conf < .8` |
| `#on-q` | substring filter on node label |
| `#on-allTypes` | restores all types |
| `#on-layout [layered][radial]` | recomputes positions (`layoutKey=null`) |
| `#on-relayout` | forces a rebuild, toast `Layout rebuilt` |
| `#on-add` (`object`) | creates `Untitled object`, selects it, **focuses `#nd-label`** â no prompt |
| `#on-linkmode` (`link`) | two-click mode: click source â toast, click target â creates a link at conf .6, opens it for editing |
| `#on-map` | toast + opens Situation |
| `#on-brief` | pushes signals matching the selection into the basket, opens the generator |
| node click | select â inspector |
| node double-click | `expandNode` â clears type filters and the confidence floor, toast `Expanded X Â· N links revealed` |
| node drag | repositions permanently (`d.x = d.fx = ev.x`), links re-route live |
| link click | opens the link editor |
| `#on-close` | clears selection |

Inspector â **object**: `#nd-label`, `#nd-type`, `#nd-risk` slider, `#nd-props` (free-form
key/value rows + `#nd-addprop`), link list, then `#nd-save` Â· `#nd-expand` Â· `#nd-map`
(locate, or toast if no geometry) Â· `#nd-del`.
Inspector â **link**: `#lk-kind`, `#lk-conf` slider, `#lk-note`, `#lk-save`, `#lk-del`.
`inferred` is recomputed as `conf < .8` on save.

### 8.8 Imagery `#view-imagery`

**Left pane â observation areas.**

| Control | Behaviour |
|---|---|
| `#aoi-new` | creates an area at the first signal's location, selects it, **inline rename** |
| `#aoi-scope` | country filter over the area list |
| `#aoi-derive` | derives AOIs from the infrastructure register for the scope, inserts them as dimmed `proposed` rows, toast `N areas proposed â¦ accept to task them`; warns if scope is `all` |
| area row click | selects; loads its most recent scene |
| second click on the name | inline rename |
| `#im-model` | `hw-changedet v3 (siamese)` / `hw-objdet v5 (aerial)` / `hw-sar-delta v2` |
| `#im-conf` | confidence floor 40â95%, default 60% |
| `#im-new` / `#im-exp` / `#im-rem` | show/hide change types |
| `#im-rerun` | drives `#im-prog` in ~260ms ticks to 100%, then toasts `N detections returned` |

**Centre â comparison.**

| Control | Behaviour |
|---|---|
| `#im-scene` (`.desc`) | `SCN-4471 Â· Chernyakhovsk airbase` â shrinks and ellipsises; the metadata lives in each frame's header strip |
| `#im-view [split][swipe][after]` | split = side by side, boxes on the current frame only; swipe = stacked frames with a draggable handle; after = single frame |
| `#im-boxes` | detection overlay on/off |
| `#im-blend` (`Fade under`) | **swipe only** â see below |
| `#im-opacity` | 0â100%, default 55%; writes `#im-clip` opacity **directly, no re-render**, so the crossfade is continuous while dragging |
| `#im-handle` | drag sets `I.swipe`; the inner frame width compensates to `100/(swipe/100)%` so the current scene stays geometrically aligned |
| `#im-signal` | toast: signal raised into the inbox |
| `#im-brief` (`brief`) | adds nearby signals to the basket |
| detection box click | selects that detection in the right pane |

**Fade under.** Off = hard cut; right of the handle is purely the reference scene. On = the
clipped current frame renders at the chosen opacity so **the older scene shows through
underneath**, and the reference frame gets `filter:grayscale(.35)` so the two are
distinguishable. **The grayscale must be gated on the blend flag** â desaturating during a
hard cut is a false signal in a change-detection tool. The control hides in split/after and
its state persists on return.

Detection boxes: `bbox` is **percent of frame**, so overlays survive any frame size, zoom or
dropped image. 1.2px outline â new `#c4453c`, expanded `#b7822c`, removed `#4f7fa6` dashed â
with a `CHG-05 Â· 93%` label above and a 12% fill on hover/select.

**Right pane order (this order matters):** Detections list â selected detection note +
provenance + `#im-confirm` / `#im-reject` (model feedback) â object counts referenceâcurrent
with signed deltas â **then** the AOI editor as a ruled section: `#aoi-name`, `#aoi-cls`,
`#aoi-cad`, `#aoi-rad`, `#aoi-note`, centre/owner/status, `#aoi-save` Â·
`#aoi-accept`/`#aoi-pause` Â· `#aoi-locate` Â· `#aoi-del`.

### 8.9 Briefings â reader `#view-reader` + print layout `#view-doc`

**One artefact, two views.** Routes: reader `#rd-print` â print layout;
`#doc-back` â reader; `#gen-open-doc` â print layout; generation completes â reader.

**Reader.** 720px measure, 13.5px/1.68. Every claim with a record behind it is an `.xref`
(dotted underline) carrying `data-k` = `signal|scene|node|region` and `data-id`. Clicking one:
1. marks it active; 2. loads the record into the right pane; 3. drives the **196px context
minimap** (re-frame, ping, plot context).

Reference actions: signal â `#rd-map` (open on map) Â· `#rd-replay` (animate lead-up) Â·
`#rd-inbox`; scene â `#rd-im` (open change detection); node â `#rd-onto`; region â its signals.
`#rd-tour` (`guided walkthrough`) steps every reference at 3.6s intervals, scrolling each
into view; the button becomes `stop walkthrough`.
Left pane: briefing register + an enumerated index of every reference.

**Print layout.** Pages 816Ã1056px (Letter @96dpi), `#f4f2ee` paper, `#1b1f24` ink,
62/70/54px padding, `display:flex;flex-direction:column` with the folio pushed down by
`margin-top:auto`. **Serif body.** Section headings sans 12px/700 uppercase .09em over a
`#b9b5ac` rule. `#doc-zoom [0.75][1][1.25]` scales via `transform` with
`transform-origin:top center`; `#doc-print` calls `window.print()`; `#doc-dist` toasts.

Page plan: **1** kicker, H1, rule, metadata table, Executive judgement (lede + support +
`Bottom line.` callout), Signals driving this assessment (9 rows). **2** Assessment by theme
(H3 per domain + paragraph + 3 cited bullets), Regional distribution. **3** Exposure and
continuity impact, Indicators and warnings, Recommended actions, Sourcing and method.

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
  .docpage{box-shadow:none;margin:0;width:8.5in;min-height:11in;padding:.72in .8in .6in;break-after:page}
  .docpage:last-child{break-after:auto}
}
```

---

## 9. GLOBALS â the contract between the files

| Global | Owner | Purpose |
|---|---|---|
| `HW`, `HW2` | data | the corpus |
| `HWopen(mod,label?)` | app | switch module, reuse/retitle tab |
| `HWselect(id,{pan})` | app | select a signal, optionally centre the map |
| `HWbasket(ids)` | app | add to the briefing basket |
| `HWtoast(msg,kind?)` | app | confirmations (`ok`/`warn`) |
| `HWreveal()` | app | un-minimise the inspector before writing to it |
| `HWrowHTML(e)` / `HWbindRows(root)` | app | the universal signal row |
| `HWmap` | app | `projection, path, k, layer(name), flyTo, ping, invert, redraw, tip` |
| `HWmapHooks[]` | app | `{draw(projection,path,k), zoom(k)}` â extra map layers |
| `HWM` | modules | `onModule(id)`, `openEntity`, `openBriefing`, `renderEvidence` |
| `HWMcore` | modules | read access to replay state and the loaded document |
| `HWX` | extensions | `onModule(id)`, `openOntology`, `replayOnMap`, `renderReader` |
| `HWXaoi` | hw-x | observation-area registry: `list`, `sel`, `render`, `renderList`, `renderScene`, `I` |
| `HWann` | hw-x | the **live** annotation array (not `X.annotations`, which is only the seeds) |
| `HWMdoc` | modules | `render`, `doc`, `openBriefing` |
| `HWP2` | workspace | palette v2 â `open()`, `close()`; hw-app `paletteOpen()` delegates to it |
| `HWsession` | workspace | `apply(id)`, `capture()`, `current()` |
| `HWalerts` | workspace | `open(entity?)`, `rules()`, `matches(rule, signal)` |
| `HWexport` | workspace | `open()`, `signals()`, `geo()`, `onto()` |
| `HWrelated` | workspace | `inject(box, signal)`, `for(signal)` |
| `HWhistory` | workspace | `inject(host, aoi)` |
| `HWappendix` | workspace | `page(doc)` â the briefing fourth page |
| `HWdist` | workspace | `open(doc)` |

`HWM.onModule` calls `HWX.onModule` **last**, so extension modules initialise after core ones.

```js
state = { module, tabs:[{id,mod,label,kind:'base'|'record'}], tab, sel, basket:[], win:72, sevFloor:1,
          tCut: null,                     /* time-cursor cap, epoch ms; null = live */
          domains:Set, ctx:{risk,grat,labels,flows,aoi,arcs}, proj:'world',
          inbox:{sort,dir,status,q,sel}, unread, doc };

visible = () => events.filter(e =>
  e.hoursAgo <= state.win && state.domains.has(e.domain) &&
  SEVERITY[e.severity].rank >= state.sevFloor &&
  (!state.tCut || e.ts.getTime() <= state.tCut));
```

**Every count in the UI must come from `visible()`** â layer panel, legend, pane header and
histogram can then never disagree.

---

## 10. DATA SHAPES

```ts
Signal { id, ts:Date, hoursAgo, lat, lon, place, country, iso3,
         region:'EMEA'|'APAC'|'AMER', domain, severity, conf:0..1, source,
         title, summary, impacts:string[], status:'new'|'ack'|'esc' }

Entity { id, code, name, type:'Corridor'|'Country'|'Region'|'Infrastructure',
         lat, lon, score:0..100, delta, exposure:{sites,staff,suppliers,revenue}, note }

Place  { id, kind:'port'|'airport', name, iso3, lat, lon, code }
Vessel { mmsi, name, type, flag, lat, lon, hdg, spd, dest, sanctioned, ais:'on'|'dark' }
Aircraft { icao, callsign, type, role, lat, lon, hdg, alt, spd, watch }
Annotation { id, kind:'point'|'line'|'area'|'measure', label, by, ts, note, lat?, lon?, pts? }

AOI { id, name, cls, iso3, lat, lon, radiusKm,
      cadence:'daily'|'3-day'|'weekly'|'monthly'|'on demand',
      status:'active'|'paused'|'proposed', scene, owner, auto, notes,
      /* set only for areas drawn on the map with the scan tools: */
      recurring?:boolean, pts?:[lon,lat][], classes?:string[], conf?:number, sensor?:string }
Scene { id, place, iso3, lat, lon, aoi, sensor, vendor, dateA, dateB, cloud, offNadir,
        counts:[label,current,delta][], changes:Change[] }
Change { id, label, type:'new'|'expanded'|'removed', conf, bbox:[x,y,w,h] /*PERCENT*/, note }

Node { id, type, label, risk:0..100, props:Record<string,string> }
Link { id, s, t, kind, conf:0..1, note, inferred /* = conf < .8 */ }
```

Enumerations:
```js
DOMAINS   = conflict|maritime|cyber|energy|trade|civil|political   // colours are GREYS
SEVERITY  = critical(4,#c4453c) high(3,#b7822c) moderate(2,#4f7fa6) low(1,#6d7883)
SOURCES   = OSINT-WIRE PARTNER-FEED AIS-TRACK GDELT-XR FIELD-REP SAT-TASK GOV-ADVISORY
AOI_CLASS = airport port military energy urban border custom     // first four auto-derivable
NODE_TYPE = person org faction vessel aircraft facility country corridor event
LINK_KIND = operates owns "flagged in" transits "located in" "affiliated with"
            supplies "sanctioned by" "observed at" controls "contracted to"
```

Deterministic series only â `series(seed,n,base,amp)` is an LCG plus a sine term.
**Never `Math.random()` in a render path.**

---

## 11. CORPUS SIZE (match these or the UI looks empty)

42 signals across all 7 domains / 4 severities / 3 regions Â· 10 entities Â· ~130 country risk
entries Â· 5 flow arcs Â· 2 map AOI boxes Â· 28 infrastructure places Â· 10 vessels (3 sanctioned,
3 AIS-dark) Â· 8 aircraft (1 watchlisted) Â· 3 imagery scenes with 8 detections total Â·
20 ontology nodes / 22 links Â· 7 seeded observation areas Â· 3 seeded annotations Â·
3 briefings in the register Â· 4 seeded sessions Â· 3 seeded alert rules Â·
~90-place offline gazetteer (derived, not authored).

---

## 12. ICON SPRITE

One inline `<svg style="display:none">` at the top of `<body>` with ~57 `<symbol>` elements
on a 24Ã24 viewBox, `fill:none; stroke:currentColor; stroke-width:1.4â1.6`. Used as
`<svg><use href="#i-globe"/></svg>`, sized by CSS (15px rail, 14px buttons, 12â13px inline,
30px empty states).

```
i-globe i-inbox i-dossier i-chart i-spark i-doc i-clock i-onto i-sat i-read
i-search i-plus i-bell i-layers i-eye i-eye-off i-print i-play i-pause i-target
i-grid i-reset i-add-brief i-flag i-check i-export i-link i-merge i-trash i-swipe
i-ship i-plane i-anchor i-pin i-poly i-path i-text i-measure i-cursor
i-scan i-scanbox i-repeat i-gear i-full i-full-exit i-book i-keyboard
i-session i-view i-alert i-relate i-grip i-pinned i-history
i-collapse-l i-collapse-r i-north i-zoom-in i-zoom-out i-recentre
i-node-person i-node-org i-node-faction i-node-facility i-node-country
i-node-corridor i-node-event i-silh-plane i-silh-ship
```

Monochrome, no fills (except the two 120Ã60 silhouettes), no icon font, no emoji.

---

## 13. KEYBOARD, MOTION, TOASTS

| Key | Action |
|---|---|
| `âK` / `Ctrl+K` | command palette |
| `1`â`9` | switch module |
| `j` / `k` | next / previous signal (Inbox) |
| `Esc` | close palette / blur field |
| `â â âµ` | navigate / open palette results |

Every handler checks `ev.target.matches('input,textarea')` first.

**Command palette** â 600px at 12vh, indexes modules â entities â signals â briefings,
substring match, capped at 40, signals show their severity diamond. Selecting performs the
**full** navigation (open module, retitle tab, select record, pan map). It is the only search.

**Motion budget:** hover 100ms linear Â· tooltip 100ms Â· palette 120ms Â· panel slide 240â260ms Â·
map view 420ms Â· centre 520ms Â· fly 620ms Â· ping 1300ms stepped Â· graph fit synchronous Â·
toast out 300ms. No bounce, no spring, no scale-on-hover, no list entrance animation.
`prefers-reduced-motion` â 0.01ms.

**Only ambient motion in the product:** one 1s interval updating clock, ingest counter and
latency. Nothing else animates on a timer.

---

## 14. ACCEPTANCE â run every line

- [ ] No `@font-face`, no font CDN; `--mono` only on figures.
- [ ] No hue outside 4 severity + 2 delta + 1 accent + annotation gold.
- [ ] No gradient; no shadow on a non-floating element; no radius > 2px.
- [ ] At 1280Ã720 nothing is clipped; `elementFromPoint` returns the control itself for
      every map-header and toolbar action (nothing under glass).
- [ ] Zero `.statusbar .cell` / `.timestrip .head` children with `scrollHeight > clientHeight`.
- [ ] Every toolbar's `scrollWidth â¤ 1280 â paneL â paneR`.
- [ ] Zoom in/out/recentre/fit change `svg.__zoom.k` within 100ms **with rAF throttled**.
- [ ] `flyTo` and `ping` work with rAF disabled.
- [ ] Minimising a Situation panel transitions out (`transform â â30px`) and back, and the
      map re-fits.
- [ ] Selecting a signal or track auto-reveals a minimised inspector.
- [ ] No `prompt`/`confirm`/`alert`; every create flow uses an inline field.
- [ ] Closing the last tab reopens Situation.
- [ ] 12 signals â a 3-page document in ~4.6s, landing in the reader; the generator never
      wedges on a repeat run.
- [ ] Ontology node positions byte-identical 1.2s after layout; zero plate overlaps.
- [ ] Fade-under appears only in swipe, writes opacity live, and grayscale is gated on it.
- [ ] A drawn scan box of ~2000 Ã 1500 km reports an area consistent with its extent (not
      ~504,470,700 kmÂ² â the ring-winding trap) and its `.kv` extent matches the metric.
- [ ] `HWmap.invert` returns `null` outside the globe; drawing there warns instead of
      committing.
- [ ] `#scan-run` produces a scene, routes to Imagery, and the findings read as
      interpretations ("Increased port activity"), never raw counts.
- [ ] `#scan-save` adds a `â»` area to the registry and its polygon persists on the map and
      is clickable.
- [ ] `print / pdf` produces pages with no app chrome, one page per sheet.
- [ ] Console clean after visiting all ten modules.

---

## 16. WORKSPACE LAYER (`hw-y.js`)

Ten subsystems that sit on top of the modules. All state persists to
`localStorage['horizonwatch.workspace.v1']`; **write only that key**, and wrap restore in
`try/catch` so corrupt state falls back to seeds rather than killing the shell.

### 16.1 Sessions â the fix for tab/icon redundancy

**A tab is no longer a module.** Previously every module switch spawned a tab, which
duplicated the rail. Now:

- **Tabs are record-scoped.** `openModule(id, label)` creates a tab **only when `label`
  names a record**. Without a label it just switches the lens.
  ```js
  function openModule(id, label) {
    if (label) {
      let t = S.tabs.find(t => t.mod === id && t.kind === 'record');
      if (!t) { t = {id:'T'+Date.now().toString(36), mod:id, label, kind:'record'}; S.tabs.push(t); }
      else t.label = label;
      S.tab = t.id;
    }
    S.module = id;
    /* â¦ */
  }
  ```
- Each session owns one `kind:'base'` tab labelled with the session name, plus record tabs
  (`Dossier Â· Red Sea corridor`, `BRF-0436 Â· â¦`, `Print layout Â· â¦`).

**A session is a whole desk.** It stores `win`, `sevFloor`, `domains`, `ctx`, `proj`, the map
`transform`, its `tabs`, its `basket` and its `views`. Switching restores all of it, so
"Red Sea corridor" and "Indo-Pacific" are genuinely different working states.

Seeded sessions: **Global watch** (72h, all layers, world) Â· **Red Sea corridor** (7d,
maritime/conflict/energy, emea, floor moderate, one saved view) Â· **Baltic & Nordics** (30d,
cyber/conflict/political, emea) Â· **Indo-Pacific** (7d, maritime/conflict/trade, apac).

**Session control** sits at the **left of the tab strip** (`.sessionctl` â `#ses-open`,
showing `#ses-name` and a `â¾`). It opens `#ses-pop`, a 308px popover anchored under the
button listing every session with `window Â· layers Â· projection Â· views`, a delete `â`, and
`#ses-new` which forks the current view and focuses an inline rename. Clicking outside
closes it.

`captureSession()` writes live state back before any switch; a 60s interval and
`beforeunload` also persist.

### 16.2 Reorderable rail and tabs

Both use one `makeSortable(container, itemSel, onOrder)` helper with HTML5 drag events:
`dragstart` marks `.dragging`, `dragover` shows `.dropbefore`/`.dropafter` based on which
half of the target the cursor is in, `drop` reinserts, `dragend` clears. Rail order persists
globally (`Y.railOrder`); tab order persists per session.

**Two traps, both of which hard-locked the page during development:**

1. **Observer feedback loop.** The rail is re-rendered by the shell, so the order has to be
   re-applied by a `MutationObserver` on `#modrail` â but `armRail()` itself mutates
   `#modrail`, so the observer retriggers it forever. Needs a re-entrance flag **and** a
   circuit breaker:
   ```js
   let arming = false, railTicks = 0, railWin = 0;
   new MutationObserver(() => {
     if (arming) return;
     const now = Date.now();
     if (now - railWin > 1000) { railWin = now; railTicks = 0; }
     if (++railTicks > 24) return;      // degrade, never hang
     armRail();
   }).observe($('#modrail'), { childList: true });
   ```
2. **A partial stored order never settles.** If `railOrder` is missing an id, the DOM order
   after a reorder can never equal the desired order, and the loop above runs forever. The
   desired order must be **total**:
   ```js
   const want = Y.railOrder.filter(id => present.includes(id))
     .concat(present.filter(id => !Y.railOrder.includes(id)));
   if (present.join() !== want.join()) want.forEach(id => rail.appendChild($(`.mod[data-mod="${id}"]`)));
   ```

**Put the breaker inside `armRail()`, not in one observer.** Two observers call it â one on
`#modrail` and one on `#tabstrip` (the shell re-renders both) â so guarding only the
`#modrail` path leaves the other able to spin. The re-entrance flag and the rate limit both
belong in the function:

```js
let arming = false, railTicks = 0, railWin = 0;
function armRail() {
  if (arming) return;
  const now = Date.now();
  if (now - railWin > 1000) { railWin = now; railTicks = 0; }
  if (++railTicks > 24) return;        // shared circuit breaker
  arming = true;
  /* â¦ set draggable, apply the total order â¦ */
  arming = false;
}
```

### 16.3 Palette v2 â everything is searchable

Replaces the original palette; `hw-app.js`'s `paletteOpen()` delegates with
`if (window.HWP2) return window.HWP2.open();`.

**Indexed kinds:** `MODULE` `SESSION` `VIEW` `SIGNAL` `DOSSIER` `OBJECT` `PLACE` `VESSEL`
`AIRCRAFT` `AREA` `SCENE` `BRIEFING` `LOC` `COORD`.

**Ontology objects are indexed by label, type AND property values**, so `636020918` finds
KEPHALOS II by its MMSI. Signals render with their severity diamond; everything else with
its type icon.

**Scope prefixes** â a `.scopebar` of buttons under the input, and typed prefixes parsed
from the query. <kbd>Tab</kbd> cycles them.

| Prefix | Scope |
|---|---|
| `sig:` | signals |
| `ent:` | dossier entities |
| `obj:` | ontology objects |
| `loc:` | places and infrastructure |
| `aoi:` | observation areas |
| `scn:` | imagery scenes |
| `trk:` | vessels and aircraft |
| `brf:` | briefings |
| `view:` | views and sessions |

**Coordinates** â `parseCoords` accepts a decimal pair (`26.5, 56.25`, optional `@` prefix)
and DMS (`26Â°30'N 56Â°15'E`), validates the ranges, and emits a `COORD` row pinned to the top
that flies the map there and pings.

**Locations** â `gazetteer()` builds an offline index from infrastructure, reported places,
imagery scenes and a hard-coded chokepoint list (Hormuz, Bab el-Mandeb, Suez, Panama, Taiwan
Strait, Malacca, Bosphorus, Danish Straits, Cape of Good Hope, Gulf of Aden, Kerch, Gotland
Basin). On top of that, queries â¥3 characters hit **Nominatim** debounced at 340ms:
```
https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=â¦
```
Results appear under a `Geocoder Â· OpenStreetMap` group tagged `LOC Â·live`. A sequence number
discards out-of-order responses; failure is silent and the gazetteer still answers. The whole
feature is switchable in Settings â General.

**Recents and pinned.** With an empty query the palette shows `Pinned`, `Recent` (last 12)
and `Modules` groups; empty groups are dropped. Every row with a `ref` carries a pin toggle.
Selecting a row records it in recents.

`ArrowDown`/`ArrowUp` skip group headers; `Enter` runs the highlighted row.

### 16.4 Saved views

A **view** is a named filter preset *inside* a session â window, severity floor, layers,
projection, context layers. Sessions are where you work; views are how you look. They live
in a `Views` group inserted as the **first** group of the Situation layer panel, each row
showing `window Â· N layers Â· projection`, with a delete `â` and a
`save current view` button that appends a view and focuses an inline rename.

### 16.5 Alert rules â `#alert-scrim`

An 820px dialog: rule list (286px) beside the editor.

- **Fields**: Severity (`is at least` / `is`), Domain, Region, Country, Source
  (`is` / `is not`), Confidence (`is at least`, 0.6â0.9).
- Clauses are ANDed. Each row is `field Â· operator Â· value Â· remove`; changing the field
  resets the operator and value to that field's first legal options.
- **Action**: `notify` / `escalate` / `brief`.
- A live `.arpreview` renders the rule as prose:
  `when severity is at least Critical and domain is Maritime & chokepoints â notify`.
- Below it, **every matching signal in the loaded corpus** is listed, and `#ar-hint` reports
  the count. This is what makes the builder credible â you see what would fire before saving.
- Each list row has a `.switch` to arm/disarm, and shows how many signals match.
- Seeded rules: *Critical maritime, any corridor* (notify) Â· *High or above in EMEA*
  (escalate) Â· *Corroborated cyber reporting* (brief, off).

The dossier's `alerting on` button opens this dialog and toasts how many active rules cover
that entity.

### 16.6 Real exports

`download(name, mime, text)` uses a Blob + object URL and revokes it after 400ms.

| Export | Contents |
|---|---|
| **Signals CSV** | the current filter only, columns `id,ts,severity,domain,title,place,country,iso3,region,lat,lon,conf,source,status,impacts`, RFC-4180 quoting |
| **Geometry GeoJSON** | a `FeatureCollection` of observation areas (Polygon where drawn, else Point), annotations (Point/Polygon/LineString) and signal points, each with a `kind` property |
| **Ontology JSON** | all nodes and links with confidence and basis |

Reached from `#btn-export` in the top bar, which opens Settings â Export.

**The annotation array must be exported from `hw-x.js`.** Annotations live in a module-scoped
`const anns = X.annotations.slice()` â reading `X.annotations` in the exporter silently ships
only the three seeded ones and drops everything the analyst drew. `hw-x.js` publishes
`window.HWann = anns` and the exporter reads `(window.HWann || X.annotations)`.

### 16.7 Related records

`relatedFor(signal)` builds groups by geographic and semantic proximity: signals within
800km, dossiers within 1400km, ontology objects matching place/country/ISO3 in their
properties, imagery scenes within 900km, observation areas within 900km, infrastructure
within 400km, live tracks within 600km, and **alert rules that would fire on this signal**.

It is injected as a card into the Situation inspector before the action row, via a one-line
hook in `renderInspector`:
```js
if (window.HWrelated) window.HWrelated.inject(box, e);
```
Every row is clickable and performs the full cross-module navigation. This is the answer to
"what else touches this?" in one place.

### 16.8 Global time cursor

A 26px bar appended to the `.timestrip`, under the density histogram: a follow-live button, a
mono readout, a 0â1000 range, a sweep button and a live `N shown` count.

The cursor writes `S.tCut` (an epoch ms cap, `null` for live), and the **single visibility
selector** honours it, so the map, legend, inspector, histogram and exports all agree:

```js
visible = () => events.filter(e =>
  e.hoursAgo <= S.win && S.domains.has(e.domain) &&
  SEVERITY[e.severity].rank >= S.sevFloor &&
  (!S.tCut || e.ts.getTime() <= S.tCut));
```

Sweep advances `t += .012` every 60ms and stops at the right edge. The readout turns amber
while held in the past. This lets the Situation map be rewound in place â Replay is for
studying the sequence, the cursor is for asking "what did we know at 0400Z?".

### 16.9 Marker clustering

A `HWmapHooks` entry. Below `settings.clusterAt` (default 2Ã) it hides individual markers
(`opacity:0; pointer-events:none`) and bins visible signals into 46px screen cells,
rendering one bubble per cell: radius `9 + min(11, n*1.6)`, stroke = the **worst** severity in
the cell, count in mono at the centre. Hover lists the worst severity and up to three places;
click flies to the bin's centroid at `clusterAt + 1`. Above the threshold the layer clears and
markers return.

### 16.10 Scan history per observation area

`historyFor(aoi)` returns the area's real scenes plus four deterministic archived passes
(26-day spacing, alternating EO/SAR, seeded from the area id and radius). Injected into the
Imagery right pane by a one-line hook in `renderDetections`:
```js
if (window.HWhistory) window.HWhistory.inject($('#im-detail'), currentArea);
```
It renders a `.sparkbar` of findings-per-pass (bars over the maximum turn `#8d5348`) and a
row per pass with date, sensor and finding count. Archived passes are honest about not having
cached imagery: clicking one toasts rather than pretending.

### 16.11 Link-analysis appendix (briefing page 4)

`window.HWappendix.page(doc)` returns a fourth `.docpage`, appended by one line in
`renderDoc`. It contains: an object table (ref, object, type, risk, standing note) for
ontology objects intersecting the evidence set, a relationships table (from, relationship,
to, confidence, asserted/inferred), and a **method note** stating how many links are inferred
and that inferred links are review candidates, not conclusions.

### 16.12 Settings â `#set-scrim`

A 900px dialog, 186px nav beside the body, nine tabs.

| Tab | Contents |
|---|---|
| **General** | Display (clustering on/off, cluster threshold 1â6Ã, marker labels) Â· Search (live address lookup, gazetteer size) Â· Workflow (opening a signal acknowledges it, confirm before deleting, tips in empty panes) |
| **Tutorial** | Ten numbered steps, each with an `open <module> â` button that closes the dialog and navigates: pick a session Â· read the situation Â· rewind in place Â· work the inbox to zero Â· follow the exposure Â· draw a scan area Â· read the change Â· trace the network Â· generate the briefing Â· set your alerts. Plus a "Reading the interface" section explaining the diamond, the colour discipline, and that gold means an analyst drew it while blue means a tasking instruction |
| **Shortcuts** | Five tables â Global, Palette prefixes, Situation map, Signal inbox, Ontology â 26 rows, keys rendered as `<kbd>` |
| **Sessions & views** | Every session with its state summary and a switch button; every view in the active session with an apply button; an explanation of the session/view distinction |
| **Alert rules** | Summary of all rules as prose with active/off tags, and a button into the editor |
| **Export** | The three exports with row counts, plus how to get a PDF |
| **Distribution** | Four distribution lists with recipient counts and checkboxes, a delivery-method select, a covering note, and a send button disabled until a briefing is loaded |
| **Data sources** | Eight feeds with what each carries, connection state and time since last message â seven connected, `COMMERCIAL-EO` unavailable, which is *why* the satellite tasking layer is unavailable rather than empty. Plus the three detection models and their class counts |
| **About** | Build, corpus counts, basemap provenance, and an explicit data-handling note that the corpus is sample data and workspace state is local only |

### 16.13 Full screen

`#btn-full` calls `requestFullscreen()` / `exitFullscreen()`, swaps its icon to
`i-full-exit`, and re-fits the map 120ms after `fullscreenchange`. Bound to <kbd>F</kbd>.
A blocked request toasts rather than failing silently.

### 16.14 New keys

<kbd>?</kbd> opens Settings â Shortcuts Â· <kbd>F</kbd> toggles full screen Â·
<kbd>Tab</kbd> cycles palette scope Â· <kbd>Esc</kbd> also closes the settings dialog, the
alert dialog and the session popover.

---

## 17. UPDATED ACCEPTANCE

Everything in Â§14, plus:

- [ ] Switching sessions restores window, severity floor, layers, projection, map position,
      tabs and basket â verify 72h/world/7-layer â 168h/emea/3-layer/floor-2.
- [ ] A module switch does **not** create a tab; only a labelled record does.
- [ ] Dragging a rail icon reorders it, persists across reload, and **never hangs the page** â
      test with a deliberately partial stored `railOrder`.
- [ ] Palette: `sig:hormuz` filters to signals; `636020918` finds a vessel by MMSI;
      `@26.57, 56.25` offers a coordinate jump; a city name returns gazetteer *and* live
      geocoder rows; the geocoder failing leaves the palette usable.
- [ ] Saved views apply window, floor, layers and projection in one click.
- [ ] The alert editor previews the rule as prose and lists the signals that would fire.
- [ ] CSV row count equals `visible().length`; GeoJSON parses and contains
      `observation-area`, `annotation` and `signal` features.
- [ ] Draw an annotation, then export GeoJSON: it must appear. Reading `X.annotations`
      instead of `window.HWann` silently ships only the seeds.
- [ ] The related-records card appears on any selected signal with at least one group.
- [ ] The time cursor reduces the visible count monotonically and returns to live in one click.
- [ ] Clustering hides markers below the threshold and clears above it.
- [ ] Scan history shows one row per pass with a findings sparkbar.
- [ ] A generated briefing has four pages, the fourth being Appendix A.
- [ ] All nine settings tabs render; the tutorial's navigation buttons work; the shortcut
      tables list every binding that actually exists.
- [ ] Full screen toggles and the map re-fits afterwards.
- [ ] Corrupt or partial `localStorage` state falls back to seeded sessions with a warning
      toast, and never blocks the shell.


Desktop only Â· domains carry no colour Â· only four severity colours (reused by change
detection) Â· reading a signal marks it acknowledged Â· the generator takes ~4.6s Â· the
briefing is serif on paper stock Â· the ontology never animates into place Â· glass is used
once, on side panels only Â· one honest unavailable capability (satellite tasking) Â·
no dark/light toggle.

---

## 19. MOBILE COMPANION (`HorizonWatchMobile.html` + `hw-mobile.js`)

**Not a responsive console.** The desktop console is untouched and stays desktop-only. This
is a separate surface for an on-call security lead, doing four jobs well rather than ten
badly. 390Ã844 in a phone bezel, tab bar at the bottom, sharing `hw-data.js` and
`hw-data2.js`.

Device geometry follows the `ios_frame` starter spec applied as plain CSS (no React/Babel,
because adding three more CDN loads to a project whose CDN path is already a single point of
failure is the wrong trade): bezel `border-radius:48px`, dynamic island `126Ã37` at `top:11`
with `border-radius:24`, home indicator `139Ã5` `border-radius:100`, shadow
`0 40px 80px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.12)`.

**Frame:** `.app{position:absolute;inset:0;display:grid;grid-template-rows:54px 52px 1fr 78px}`
â status-bar inset, header, content, tab bar (the tab bar's last 22px is home-indicator
padding).

**Mobile-specific rules that differ from the console:** body 15px not 12.5 Â· minimum hit
target 46px Â· `:active` feedback, never `:hover` Â· detail arrives as a bottom **sheet**, not
a side panel Â· filter rows scroll horizontally as 34px chips.

### Tabs

| Tab | Does |
|---|---|
| **Alerts** | Escalations and critical/high signals, badge count of unactioned. Filters: *needs action / escalated / critical / all*. Tap â sheet with assessment, location, source, confidence, corroboration count, touched dependencies, then **Acknowledge Â· Escalate Â· Show on map Â· Note to desk**. Acknowledged rows drop to 55% opacity rather than disappearing, so the queue reads as worked |
| **Brief** | The briefing at phone measure (15px/1.68). Every `.xref` works: signals open the signal sheet, the imagery scene opens its detection list, a region lists its signals |
| **Map** | Natural Earth geometry, severity diamonds, AIS hulls and ADS-B airframes rotated to heading (sanctioned red, watchlisted amber), filter chips, tap â bottom card with an onward action |
| **Note** | Press-and-hold voice note with live timer and waveform, written note, routing (duty desk / group security / regional lead / logistics), attachable reference, and an outbox that goes `queued â sent` |

### Six defects to avoid (all were shipped once and caught in review)
1. **Never take the map out of the grid.** `#view-map{position:absolute;inset:0}` as a child
   of the grid container paints **above** the in-flow header and tab bar â the map covered
   both and there was no way to leave the tab. The map must occupy the same row as the
   scroller:
   ```css
   #view-map{grid-row:3;position:relative;display:none;flex-direction:column;min-height:0;overflow:hidden}
   #view-map.on{display:flex}
   ```
   This also keeps `.mapcard{bottom:10px}` clear of the home indicator.

2. **One bound zoom behaviour, always.** `zoom.transform` dispatches only to *that
   instance's* listeners, so calling it on a freshly constructed `d3.zoom()` moves nothing
   and leaves `node.__zoom` desynced from what is rendered â the next drag then snaps. Hoist
   it (`let mzoom; mzoom = d3.zoom()â¦; msvg.call(mzoom)`) and drive every programmatic move
   through `msvg.call(mzoom.transform, â¦)`. Same rule as Â§5 on desktop.

3. **Re-apply the glyph counter-scale on every redraw.** The zoom handler compensates markers
   with `scale(1/k)`, but a redraw that rewrites `transform` without it snaps every glyph to
   full size â grossly oversized at k=4â12. Factor it out and call it from both paths:
   ```js
   const zoomK = () => msvg?.node() ? d3.zoomTransform(msvg.node()).k : 1;
   function rescale(k = zoomK()) {
     gMark.selectAll('g.mk').attr('transform', d => `translate(${proj([d.lon,d.lat])}) scale(${1/k})`);
     gTrk.selectAll('g.trk').attr('transform', d => `translate(${proj([d.lon,d.lat])}) scale(${1/k})`);
   }
   ```

4. **Inline references must be `<span role="link" tabindex="0">`, never `<button>`.** A
   button is an atomic inline-level box: it cannot break across lines, and `display:inline`
   does not restore wrapping in Blink or WebKit. The executive-judgement reference is
   `place + ': ' + lowercased title` â around 78 characters, ~550px at 15px â inside a 358px
   column, and `.screen{overflow-x:hidden}` clips rather than scrolls, so the sentence was cut
   off mid-reference with no way to read it. Keep the `data-k`/`data-id` contract and add a
   keydown handler for <kbd>Enter</kbd>/<kbd>Space</kbd> since a span is not natively
   activatable.

5. **Reset `padding` in the global `button` rule, not just `border`.** Chrome and Safari apply
   roughly `1px 6px` to buttons; a reset that omits padding leaves ~6px of dead space either
   side of every inline control, which shows as gaps mid-sentence. `button{â¦;padding:0;â¦}` is
   safe here because `.btn`, `.chip`, `.arow` and `.tabbar button` all declare their own.

6. **A reference set from anywhere must survive the note form.** The `#nref` option list is
   built from the on-call queue (escalated/critical/high only, capped at 12). A moderate signal
   reached through a Brief reference â or anything ranked below the cut â had no matching
   `<option>`, so the select silently fell back to "None" and the note sent unattached with no
   indication. Carry the intent in state (`S.pendingRef`) and have the renderer always include
   the currently-referenced record, prepending it if the queue does not contain it.

### Offline degradation

A companion for poor connectivity must not die with its CDN. **Only the Map tab may depend
on d3.** Alerts and Brief use local helpers â a plain haversine for the 800km corroboration
count, and `reduce`-based `countBy` / `mean` instead of `d3.rollups` / `d3.mean`. `initMap()`
checks for `d3`/`topojson` and, if absent, sets `mapDead` and renders
*"Map geometry unavailable offline. Alerts, Brief and Note still work."* â every other
map function early-returns on that flag.

### Tablet

The brief was "tablet as the full console". That holds in landscape on a 12.9â³ iPad
(1366pt) but the console's floor is 1280, so an 11â³ iPad at 1194 clips. Either accept
landscape-on-large-tablet only, or drop the console floor to 1024 â which is possible
without touching the layout above 1280, but is not currently done.

### Mobile acceptance

- [ ] Every tab is reachable from every other tab; the Map tab never covers the header or
      tab bar.
- [ ] `Show on map` from a signal sheet actually recentres the map, and a subsequent pinch
      does not snap.
- [ ] Zoom to kâ6, toggle a filter chip: glyphs stay the same visual size.
- [ ] Acknowledge from the sheet decrements the tab badge and recedes the row.
- [ ] Every brief reference opens the right sheet.
- [ ] Press-and-hold produces a voice note with a plausible duration; sliding off cancels.
- [ ] With d3 blocked, Alerts and Brief still render and are fully usable; Map shows its
      offline message rather than throwing.
- [ ] No hit target under 44px.
- [ ] A long inline reference in the executive judgement **wraps** onto a second line and is
      fully readable at 390px â not clipped by `overflow-x:hidden`.
- [ ] Inline references sit tight against the surrounding prose with no UA button padding.
- [ ] Open a *moderate* signal via a Brief reference â **Note to desk**: the reference select
      shows that signal, not "None".
- [ ] Inline references are keyboard-activatable (Enter / Space) and show a focus ring.

Desktop only Â· domains carry no colour Â· only four severity colours (reused by change
detection) Â· reading a signal marks it acknowledged Â· the generator takes ~4.6s Â· the
briefing is serif on paper stock Â· the ontology never animates into place Â· glass is used
once, on side panels only Â· no dark/light toggle.

Added by the workspace layer:

- **A module switch never creates a tab.** Tabs are records; the rail is the lens. This is
  the whole point of the session model â restoring per-module tabs reintroduces the
  redundancy it was built to remove.
- **Sessions and views are deliberately different things.** A session is a desk (filters,
  tabs, basket, map position); a view is a filter preset inside one. Merging them loses the
  ability to look at the same desk two ways.
- **The alert editor shows matches before you save.** A rule builder that cannot tell you
  what would fire is a form, not a tool.
- **The commercial EO feed stays unavailable** in Data sources, which is what makes the
  satellite tasking layer honestly unavailable rather than an empty stub. Do not connect it.
- **Archived scan passes do not fake imagery.** Clicking one says the imagery is not cached
  rather than showing the current scene twice.
- **Only one localStorage key**, `horizonwatch.workspace.v1`. Never read or write anything
  else in storage, and always fall back to seeds on corrupt state.
- **The phone companion is not the console.** It does four jobs. Adding modules to it, or
  making the console responsive down to phone width, breaks both: a 250px analyst panel does
  not survive a 390px viewport, and an on-call lead does not need ten modules at 3am.

---

## WORKSTATION MODE (hw-data3.js / hw-w.js / hw-gmail.js)

A second **mode**, not more modules. **Watch** is the analysis surface (nine modules);
**Workstation** is where work is coordinated (My work / Mail / Cases / Team). Sessions,
filters and the briefing basket carry across both. `W` toggles, `G` jumps to My work.

### Extend through hooks, never by wrapping an export

Two bugs of the same class were shipped and caught in review. Both are the same mistake:
**patching something the owner re-creates or never reads.**

1. **Inline rail filter.** `renderRail()` rebuilds `#modrail` with `innerHTML` on every
   module, tab and session change, discarding any inline `style.display` a `setMode()`
   helper wrote. Fix: filter in CSS from a class on a stable ancestor.

   ```js
   { id:'work', label:'My work', icon:'i-work', tab:'My work', set:'work' }
   // renderRail stamps every button:  data-set="${m.set || 'watch'}"
   document.getElementById('app').classList.toggle('mode-work', mode === 'work');
   ```
   ```css
   #app .mod[data-set=work]{display:none}
   #app.mode-work .mod[data-set=work]{display:flex}
   #app.mode-work .mod[data-set=watch]{display:none}
   ```
   Apply the class **synchronously** at boot; deferring it shows a flash of the wrong rail.

2. **Wrapped `SH.renderInspector`.** `hw-app.js` calls its own module-local
   `renderInspector()` from `selectEvent()`, the `#insp-close` handler and the
   map-background click. Reassigning the *export* never rebinds those, so the interrupt,
   assignment, discussion and presence vanished the moment a signal was selected. Fix: the
   owner fires a hook from inside its own body, exactly like `HWmapHooks`.

   ```js
   function renderInspector() { /* both branches */ fireInspector(); }
   function fireInspector() {
     (window.HWinspectorHooks || []).forEach(fn => {
       try { fn($('#inspector'), S.sel); } catch (e) { console.error(e); }
     });
   }
   ```
   ```js
   (window.HWinspectorHooks = window.HWinspectorHooks || []).push((box, sel) => {
     window.HWinterrupt.inject(box);
     if (!sel) return;
     const ref = 'sig:' + sel;
     window.HWpresence.inject(box, ref);
     const detail = box.querySelector('.detail');
     if (detail) { window.HWassign.inject(detail, ref); window.HWcomments.inject(detail, ref); }
   });
   ```
   Any other code that writes the inspector itself, such as `selectTrack` in `hw-x.js`,
   must fire the hook too or its panel loses the interrupt.

   **General rule: if an extension needs to inject into a surface, the surface publishes a
   hook. A wrapper only works while nothing internal calls the original.**

### Reference grammar

One string form ties everything together: `sig:HW-2400`, `ent:ENT-RS-01`, `onto:N02`,
`scn:SCN-4471`, `aoi:AOI-14`, `brf:BRF-0431`, `case:CS-0014`, `mail:M-1042`, `rfi:RFI-021`.
`HWref.open(ref)` switches mode if needed and navigates.

### Identity and roles

Eight users; roles carry capability (`lead` approves and issues, `imagery` confirms
detections, `regional` answers RFIs). Gate privileged actions with `can(...)` and refuse with
a toast, never a hidden control.

### Gmail is a real OAuth client

`hw-gmail.js` is not a mock. Supply a Google Cloud OAuth 2.0 **Web application** client ID
(Settings, Mail and calendar), enable the Gmail API, and add the page origin to the client
authorised JavaScript origins. It signs in through Google Identity Services and calls the
Gmail REST API from the browser: `messages.list` on a configurable query, `messages.get`
with `format=full`, base64url decode, a MIME walk for text and attachments, and
`messages.send` with an RFC 2822 raw payload. Scopes: `gmail.readonly`, `gmail.send`,
`gmail.labels`, `calendar.events`.

Without a client ID it runs the sample mailbox and **says so**: a send with no connection
queues at `delivered: 0` rather than claiming delivery.

### Briefing distribution

Recipients are data, not hard-coded strings. A recipient book of five lists plus ad-hoc
addresses lives in localStorage, is editable in Settings, and is read by one picker reachable
from three places: the reader toolbar, the generator footer and the print view. The picker
resolves and de-duplicates the address set, shows the count before sending, composes a
covering summary from the document object, and on send advances the approval chain to
`issued` with a stamped chain entry.

### Workstation acceptance

- [ ] Watch shows 9 rail buttons, Workstation 4, verified **after navigating**.
- [ ] Select a signal: interrupt, presence, assignment and discussion all render. Clear the
      selection and the interrupt is still there.
- [ ] Select a live track: the interrupt renders in that panel too.
- [ ] An analyst cannot advance an approval stage and is told why.
- [ ] Raise signal from mail creates a triageable signal and marks the thread parsed.
- [ ] An at-mention notifies the named user and lands in their Mentions queue.
- [ ] With no Gmail client ID a send queues at `delivered: 0` and the UI says it is offline.
- [ ] Distribute resolves lists plus ad-hoc addresses, de-duplicates, and issues the briefing.
