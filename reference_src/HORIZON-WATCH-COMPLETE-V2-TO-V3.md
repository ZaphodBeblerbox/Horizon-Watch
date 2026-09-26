# Horizon Watch â Complete Specification, V2 â V3
### The authoritative document. Everything from the V2 baseline through every V3 addition.

**Fifteen files, no build step, opens from the filesystem.**

```
HorizonWatch.html        shell Â· icon sprite (~70 symbols) Â· 16 module skeletons Â· 8 dialogs
hw.css                   ~2000 lines: tokens, atoms, module layouts, glass, deck, print
hw-data.js               V2 corpus: 42 signals, 10 entities, country risk, flows, briefings
hw-data2.js              V2 corpus: infrastructure, tracks, imagery scenes, ontology, AOIs
hw-data3.js              V3 corpus: identity, mail, cases, RFIs, comments, approvals, handovers
hw-app.js                shell (rail, tabs, palette, clock) + Situation map + Signal inbox
hw-modules.js            Dossiers Â· Analytics Â· Generator Â· Print document Â· Replay
hw-x.js                  annotations Â· tracks Â· minimaps Â· Ontology Â· Imagery Â· Reader Â· scan areas
hw-y.js                  V3: sessions Â· palette v2 Â· views Â· alert rules Â· exports Â· related records
                         Â· time cursor Â· clustering Â· scan history Â· appendix Â· settings Â· fullscreen
hw-w.js                  V3: Workstation mode Â· My work Â· Mail Â· Cases Â· Team Â· comments
                         Â· assignment Â· presence Â· RFIs Â· approval chain Â· handover Â· interrupt
hw-gmail.js              V3: real Gmail OAuth client + distribution recipient book
hw-deck.js               V3: presentation generator
image-slot.js            starter web component (drag-drop image placeholder) â copy verbatim
HorizonWatchMobile.html  V3: phone companion, separate surface
hw-mobile.js             V3: phone companion logic
```

**Load order, at the END of `<body>`:**

```html
<script src="https://unpkg.com/d3@7.9.0/dist/d3.min.js"
  integrity="sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i"
  crossorigin="anonymous"></script>
<script>if(typeof d3==='undefined')document.write('<scr'+'ipt src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"><\/scr'+'ipt>');</script>
<script src="https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js"
  integrity="sha384-Ukv1p/xTma6P4/2bY5KzWBw+ydSpXmhCMtyciIQVDJ1RmOxtCYNMF1uXT9T63H67"
  crossorigin="anonymous"></script>
<script>if(typeof topojson==='undefined')document.write('<scr'+'ipt src="https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js"><\/scr'+'ipt>');</script>
<script src="image-slot.js"></script>
<script src="hw-data.js"></script>
<script src="hw-data2.js"></script>
<script src="hw-data3.js"></script>
<script src="hw-app.js"></script>
<script src="hw-modules.js"></script>
<script src="hw-x.js"></script>
<script src="hw-y.js"></script>
<script src="hw-w.js"></script>
<script src="hw-gmail.js"></script>
<script src="hw-deck.js"></script>
```

Libraries go at the **end of `<body>`**, never in `<head>`. A blocking head script paints
nothing until it resolves, and a CDN that *stalls* rather than erroring blanks the page
forever. Here the whole shell paints first. For production, vendor both files locally.

Basemap fetched at runtime: `https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json`,
decoded with `topojson.feature(topo, topo.objects.countries)`. **Never hand-draw country
geometry.** A failed fetch raises a warning toast and leaves every other module functional.

> **Palette note.** This console runs its own dark intelligence palette by explicit user
> direction, not the Muzzo brand system. Muzzo remains correct for marketing surfaces; a
> 12.5px dark ops console with severity-encoded colour is a different problem from a
> cream-and-navy landing page. The oxlint design-system warning on `HorizonWatch.html` is a
> knowing override, not a defect.

---

# PART 0 Â· WHAT CHANGED

## 0.1 V2 baseline

A **nine-module analysis console**, desktop only:

| Module | Purpose |
|---|---|
| Situation | Global map, live tracks, layers, inspector, density strip |
| Signals | Triage queue |
| Dossiers | Standing exposure per corridor/country/facility |
| Analytics | Trend and concentration |
| Generate | Evidence set â briefing |
| Replay | How the picture assembled |
| Ontology | Editable linked-entity graph |
| Imagery | Satellite change detection |
| Briefings | Interactive reader + printable pages |

## 0.2 V3 additions, complete list

**Structural**
1. **Workstation mode** â a second mode with four new modules (My work, Mail, Cases, Team)
2. **Record-scoped tabs** â a module switch no longer creates a tab
3. **Sessions** â a whole desk (filters, layers, projection, map position, tabs, basket, views)
4. **The reference grammar** â one string form for every record type
5. **Identity and roles** â eight users, five roles with real capability gates
6. **Hook-based extension** â `HWinspectorHooks`, replacing wrapper patching

**Analytical**
7. Saved views (filter presets inside a session)
8. Palette v2 â 14 kinds, scope prefixes, coordinates, gazetteer, live geocoding
9. Alert rule builder with live match preview
10. Real exports â CSV, GeoJSON, ontology JSON
11. Related-records panel
12. Global time cursor on the Situation map
13. Marker clustering
14. Scan history per observation area
15. Link-analysis appendix (briefing page 4)
16. **Draw-to-scan** â box and polygon ML scan tasking

**Communications**
17. Real Gmail OAuth client, both directions
18. Six auditable inbound parse rules
19. Five outbound channels with delivery receipts
20. Briefing distribution with an editable recipient book
21. Comments with @mention autocomplete on any record
22. Assignment with due dates
23. Presence
24. RFIs tracked to closure
25. Approval chain `draft â review â approved â issued`
26. Shift handover, auto-generated
27. **The urgent interrupt** â urgent items reach the analyst in the inspector

**Output**
28. **Presentation generator** â deck as the third rendering of the document object

**Surfaces**
29. Settings â nine tabs including a 16-step tutorial and 34 shortcuts
30. Full screen
31. **Mobile companion** â five-tab phone surface, separate file

**Net: 9 modules â 16 (13 in the rail across two modes, 3 hidden).**

---

# PART 1 Â· FOUNDATIONS

## 1.1 The six rules

Everything below is downstream of these.

**1 Â· System type only.** No webfonts.
`--font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif`.
Body 12.5px, tables 12.5px, labels 11px, pane titles 12px/600. Nothing above 26px except the
printed H1 and the deck. No display or geometric typeface â no Inter, Geist, Space Grotesk.

**2 Â· Monospace is for figures, never labels.** `--mono` is permitted **only** on: timestamps
and durations, coordinates and scale readouts, record IDs, counts, numeric table cells,
statistic values, axis ticks, the agent log. **Forbidden** on: headings, pane titles, button
labels, chip/tag text, nav labels, status-bar words, tooltip prose, form labels. Letterspaced
uppercase mono ("kicker" styling) is the single strongest amateur tell.

**3 Â· Colour is a scarce signal.** Neutral blue-grey scale; hue only where it encodes state.

- **Severity** â the one ramp: critical `#c4453c` â high `#b7822c` â moderate `#4f7fa6` â
  low `#6d7883`. Warm reads bad, cool and grey benign.
- **Delta** â worsening `#b0645c`, improving `#6d9a83`.
- **One accent** `#3f6fa8` / hover `#5f95d0` for selection, focus, links, primary buttons,
  progress. Nothing else is blue.
- **Change detection** reuses the severity ramp: new red, expanded amber, removed steel dashed.
- **Annotation gold** `#c8a04a` means an analyst drew it. **Scan blue** `#5f95d0` means a
  tasking instruction. These two vocabularies must never blur.
- Everything else â domains, sources, regions, ontology links, heatmaps â is grey. Legends use
  **shades, not hues**. Seven-colour category palettes are banned.

**4 Â· Flat, tight, hairline.** Radius 2px. 1px borders. No shadows except floating layers.
Control heights 21 / 24 / 26px. Rows 24â30px. Pane headers 28px. No gradients, glows, pill
buttons or coloured card fills. Hover = one step lighter grey; selected = filled row plus a 1px
accent rule. Glass (Â§3.6) is the sole exception.

**5 Â· Every surface is chrome around data.** No decorative panels, no hero areas. An empty pane
shows a 12px grey sentence saying what would appear and how to get it.

**6 Â· Extend through hooks, never by wrapping an export.** Â§2.2. This rule cost two shipped bugs.

## 1.2 Tokens â copy verbatim

```css
:root{
  /* surfaces â 5 steps, neutral blue-grey, never pure black */
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

**Derived colours used inline â exact:**

| Purpose | Value |
|---|---|
| Delta worsening / improving | `#b0645c` / `#6d9a83` |
| Tag red (text/border) | `#cf6259` / `#5c3b38` |
| Tag amber | `#c19446` / `#5a4a2c` |
| Tag green | `#699781` / `#3a5346` |
| Tag blue | `#78a5d4` / `#39536e` |
| Map land / stroke / ocean / graticule / hovered | `#232a30` Â· `#2e363d` Â· `#12161a` Â· `#20262b` Â· `#39424a` |
| Country-risk ramp 1â5 | `#232a30 #2a3138 #333a3c #3d3c39 #463c37` |
| Chart area fill / stroke / grid | `#3f6fa8` @13% Â· `#7d97b3` Â· `#262c33` |
| Histogram / hot bucket | `#4a545e` / `#8d5348` |
| Heatmap ramp / empty cell | `#232a30 â #5c6b78` / `#1e242a` |
| Vessel / sanctioned / aircraft / watchlisted | `#7fa8c9` Â· `#c4453c` Â· `#a8b6c2` Â· `#b7822c` |
| Vessel wake | `#5f7b91` dashed `2 3` |
| Ontology plate / link / inferred / tier rule | `#232a31` Â· `#3f4a55` Â· `#4d5964` dashed Â· `#262c33` dashed |
| Annotation ink / fill | `#c8a04a` / 10% |
| Scan stroke / fill / vertex / sweep | `#5f95d0` Â· `rgba(95,149,208,.10)` Â· `#5f95d0` Â· `#8ebdf0` |
| Paper stock / ink / rules | `#f4f2ee` Â· `#1b1f24` Â· `#d7d2c9` â never `#fff` / `#000` |
| Category ramp (regions, sources, domains) | `#9aa5ae #8b96a0 #8d9aa4 #7c8792 #7d8993 #6d7883 #6f7b85 #5f6a74 #626e78 #515c66 #55616b #444e58 #4a555f #404b54` |

## 1.3 Type scale

| Role | Family | Size | Weight | Colour |
|---|---|---|---|---|
| Pane title (`.panehead h3`) | sans | 12px | 600 | `--txt` |
| Group heading (`h4`) | sans | 11.5px | 600 | `--txt-2` |
| Body / table cell | sans | 12.5px | 400 | `--txt` |
| Prose | sans | 12.5px, lh 1.55 | 400 | `--txt-2` |
| Label (`.lbl`) | sans | 11px | 400 | `--txt-3` |
| Detail title (`.detail h2`) | sans | 15px | 600 | `--txt` |
| Dossier / case name (`h1`) | sans | 19px | 600 | `--txt` |
| Reader body | sans | 13.5px, lh 1.68 | 400 | `--txt-2` |
| Statistic value | mono | 19px | 400 | `--txt` |
| Gauge value | mono | 23px | 400 | severity |
| Data cell (time, ID, count) | mono | 11.5px | 400 | `--txt-2`/`--txt-4` |
| Axis tick | mono | 9â9.5px | 400 | `--txt-4` |
| Agent log | mono | 11px, lh 1.65 | 400 | `--txt-3` |
| Tag / status pill | sans | 10px, ls .03em | 400 | variant |
| Graph node label / sub | sans | 9.5px / 8.5px | 400 | `--txt` / `--txt-3` |
| **Printed briefing body** | **serif** Times/Georgia | 13px, lh 1.6 | 400 | `#22272d` |
| **Deck body** | sans | 34px, lh 1.5 | 400 | `#a4adb6` |
| **Mobile body** | sans | 14â15px | 400 | `--txt-2` |

**Casing.** Sentence case everywhere. Uppercase only in: the classification chip
(`INTERNAL // RISK`), map coordinate and scale readouts, short code tags (`CONF`, `MARI`,
`AIS-TRACK`), ontology tier band labels, printed section headings, deck eyebrows.

---

# PART 2 Â· THE THREE TRAPS

Each was invisible in code review, each shipped, each has a general form.

## 2.1 Animation frames are not guaranteed

`requestAnimationFrame` never fires in a throttled, backgrounded or embedded frame. **d3
transitions are rAF-driven**, so every `.transition()` silently becomes a no-op: zoom buttons do
nothing, pings never expand, layouts never fit. Two mandatory patterns:

```js
// 1 Â· Probe once at startup, route every zoom through one helper.
let rafOK = null;
(function probeRaf(){
  let fired = false;
  requestAnimationFrame(() => { fired = true; rafOK = true; });
  setTimeout(() => { if (!fired) rafOK = false; }, 260);
})();

function applyZoom(t, ms){
  if (rafOK && ms) svg.transition().duration(ms).call(zoom.transform, t);
  else svg.call(zoom.transform, t);          // synchronous fallback â always works
}

// 2 Â· Pulses use stepped timers with hand-rolled easing, never d3 transitions.
const steps = 22, r1 = 46 / k;
for (let s = 1; s <= steps; s++) setTimeout(() => {
  const f = s / steps, e = 1 - Math.pow(1 - f, 3);   // cubic-out
  c.attr('r', 2 + (r1 - 2) * e).attr('stroke-opacity', 1 - e);
  if (s === steps) c.remove();
}, delay + s * (1300 / steps));
```

**Never defer layout with rAF.** Use `setTimeout(fn, 0)` with a bounded retry when a container
may still measure zero:

```js
let tries = 0;
function sizeMap(){
  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) { if (tries++ < 20) setTimeout(sizeMap, 50); return; }
  tries = 0;
  /* â¦ fit â¦ */
}
```

Applies to: map fit, density strip, ontology auto-fit, deck fit, mobile map.

## 2.2 Never patch what the owner re-creates or never reads

**Two bugs, one mistake.**

### Bug A â inline rail filter

`renderRail()` rebuilds `#modrail` with `innerHTML` on **every** module change, tab change and
session switch, discarding any inline `style.display` a `setMode()` helper wrote. The mode
switch appeared to work on first load and silently stopped.

```js
// registry: tag the workstation modules
{ id:'work',  label:'My work', icon:'i-work', tab:'My work', set:'work' },
{ id:'mail',  label:'Mail',    icon:'i-mail', tab:'Mail',    set:'work' },
{ id:'cases', label:'Cases',   icon:'i-case', tab:'Cases',   set:'work' },
{ id:'team',  label:'Team',    icon:'i-team', tab:'Team',    set:'work' }

// renderRail(): stamp every button
`<button class="mod" data-mod="${m.id}" data-set="${m.set || 'watch'}" â¦>`

// setMode(): one class on a stable ancestor
document.getElementById('app').classList.toggle('mode-work', mode === 'work');
```
```css
#app .mod[data-set=work]{display:none}
#app.mode-work .mod[data-set=work]{display:flex}
#app.mode-work .mod[data-set=watch]{display:none}
```

Correct by construction â no `MutationObserver`, no re-application, correct on first paint.
Apply the class **synchronously** at boot; deferring it behind `setTimeout(â¦, 400)` shows a
visible flash of the wrong rail.

**Guard the `onModule` hook against its own routing.** `setMode()` calls `HWopen()`, whose
`HWX.onModule` hook corrects mode drift â without a `switching` flag the two fight and the mode
flips straight back.

### Bug B â wrapped `SH.renderInspector`

`hw-app.js` calls its own module-local `renderInspector()` from `selectEvent()`, the
`#insp-close` handler and the map-background click. Reassigning the **export** never rebinds
those, so the interrupt, assignment, discussion and presence vanished the moment a signal was
selected.

```js
// hw-app.js â the OWNER fires the hook from inside its own body
function renderInspector(){
  if (S.sel) window.HWreveal();
  const box = $('#inspector');
  if (!S.sel) { /* summary branch */ bindRows(box); fireInspector(); return; }
  /* selected branch */ bindRows(box); fireInspector();
}
function fireInspector(){
  (window.HWinspectorHooks || []).forEach(fn => {
    try { fn($('#inspector'), S.sel); } catch (e) { console.error(e); }
  });
}
```
```js
// hw-w.js â extensions PUSH a hook
(window.HWinspectorHooks = window.HWinspectorHooks || []).push((box, sel) => {
  if (!box) return;
  window.HWinterrupt.inject(box);
  if (!sel) return;
  const ref = 'sig:' + sel;
  window.HWpresence.inject(box, ref);
  const detail = box.querySelector('.detail');
  if (detail){ window.HWassign.inject(detail, ref); window.HWcomments.inject(detail, ref); }
});
```

Anything else that writes the inspector itself â `selectTrack` in `hw-x.js` â must fire the hook
too, or its panel loses the interrupt.

> **General rule: if an extension needs to inject into a surface, the surface publishes a hook.
> A wrapper works only while nothing internal calls the original.**

## 2.3 A fixed-size child must never size a layout track

The deck slide is authored at 1920Ã1080. Placed as a **grid item**, the implicit `auto` track
sizes to its 1920px max-content, and `place-items:center` then centres it *inside that 1920px
track* â putting it ~960px right of the stage and clipped out of view at every viewport width.

```css
.stage{flex:1;min-height:0;position:relative;display:block;padding:18px;overflow:hidden}
.slidewrap{position:absolute;top:50%;left:50%;width:1920px;height:1080px;
  transform-origin:center center}
```
```js
// the WHOLE transform in one write â a scale-only write drops the centring translate
wrap.style.transform = 'translate(-50%,-50%) scale(' + Math.min(w/1920, h/1080) + ')';
```

Verify with `elementFromPoint` at the stage centre, not by checking the node exists.

**General form:** any element with a hard pixel dimension larger than its container must be
taken out of flow before it can participate in a grid or flex track.

---

# PART 3 Â· APPLICATION FRAME

## 3.1 The grid

```
#app  display:grid; grid-template-columns:minmax(0,1fr);
      grid-template-rows: 40px 32px 1fr 24px; height:100vh
      row 1  .topbar     brand | module rail | spacer | tools
      row 2  .tabstrip   mode control | workspace tabs | feed pills
      row 3  #views      16 module views, one visible
      row 4  .statusbar  telemetry | basket, user, build
body  overflow:hidden
```

**Two load-bearing details.** `grid-template-columns:minmax(0,1fr)` on `#app` â without it the
implicit track sizes to the top bar's min-content and the app grows past the viewport.
`.view{height:100%}` â without it the grid row is content-sized, panes grow to content height
and inner `overflow:auto` stops working. Every scroll container is
`flex:1; min-height:0; overflow:auto`, never `height:100%`.

**Overflowing fixed-height rows** get all three parts: `min-width:0; overflow-x:auto;
scrollbar-width:none` on the row, `flex:none; white-space:nowrap` on children, and
`flex:none` on the title so it cannot absorb the deficit and collapse. Applied to `.topbar`,
`.toolbar`, `.statusbar .cell`, the map `.panehead`, `.timestrip .head`.

## 3.2 Pane grids â all 16 modules

| Module | Columns |
|---|---|
| Situation | `var(--pane-l) 1fr var(--pane-r)` |
| Signals (inbox) | `212px 1fr 356px` |
| Dossiers | `238px 1fr 292px` |
| Analytics | `1fr` |
| Generate | `290px 1fr 322px` |
| Replay | `1fr 300px` (right pane leads with a 196px minimap) |
| Ontology | `236px 1fr 316px` |
| Imagery | `250px 1fr 330px` |
| Reader (Briefings) | `236px 1fr 336px` (196px minimap) |
| Print layout *(hidden)* | `242px 1fr` |
| Deck *(hidden)* | `186px 1fr 300px` |
| My work | `250px 1fr 320px` |
| Mail | `236px 1fr 400px` |
| Cases | `250px 1fr 330px` |
| Team | `1fr 340px` |

Pane internals always: `.panehead` (28px, `--bg-2`, 1px bottom border) â `.scroll` â optional
fixed footer.

## 3.3 Top bar â 40px

- **Brand** (196px min, right border): 17px monochrome meridian glyph in `--txt-2`, then
  `Horizon Watch` 12.5px/600 over `ops console 4.2` 10px `--txt-4`.
- **Module rail**: 62px buttons, `role="tab"`, 15px icon over a 10px label. Idle `--txt-3`;
  hover `--bg-3` + `--txt`; selected `--bg-0` + `--txt` + a 2px `--acc-hi` bottom border. Badges:
  8.5px mono `#c4453c` at `translate(14px,-8px)` â unread signals, unread mail, notifications,
  open assignments. **Rail buttons are `draggable` and reorder; order persists globally.**
- **Tools** (right, left border): new tab Â· **area of interest (arms the scan box)** Â· export Â·
  alerts Â· a 272px search affordance showing `Search events, entities, briefings` + `âK` Â· the
  classification chip Â· a live UTC clock Â· **full screen** Â· **settings** Â· the user monogram
  (click to switch user).
  Below 1400px the search collapses to its icon; below 1180px the clock hides.

## 3.4 Tab strip â 32px

- **Mode control** at the far left: `.sessionctl` â `#ses-open`, showing the session name, a
  `WATCH`/`WORK` chip and a `â¾`. Opens `#ses-pop`, a 308px popover.
- **Tabs are record-scoped** (V3). `openModule(id, label)` creates a tab **only when `label`
  names a record**; without a label it just switches the lens.
  ```js
  function openModule(id, label) {
    if (label) {
      let t = S.tabs.find(t => t.mod === id && t.kind === 'record');
      if (!t) { t = {id:'T'+Date.now().toString(36), mod:id, label, kind:'record'}; S.tabs.push(t); }
      else t.label = label;
      S.tab = t.id;
    }
    S.module = id;
  }
  ```
  Each session owns one `kind:'base'` tab named after the session, plus record tabs
  (`Dossier Â· Red Sea corridor`, `BRF-0436 Â· Weekly exposure review`, `Case Â· RED-SEA-Q3`,
  `Deck Â· BRF-0436`).
- Each tab: 5px status dot, ellipsised label (max 216px), close on hover only. Selected tab
  `--bg-0` + a 1px `--acc-hi` top rule. **Tabs are `draggable`; order persists per session.**
- Closing the active tab selects the last remaining; closing the last reopens Situation.
- Right cluster: green dot + `7 feeds live`, and a mono ingest counter ticking each second.

## 3.5 Status bar â 24px

`â Connected` Â· `Corpus 42 signals` Â· `Latency 42 ms` Â· `Tasking queue 2` Â·
`Sample corpus, not live reporting` Â· *spacer* Â· `Briefing basket 3` Â·
`Signed in K. Almeida Â· Group security lead` Â· `Build 4.2.108`.

## 3.6 Glass side panels â the one exception to rule 4

```css
aside.pane{
  background:rgba(26,31,37,.72);
  backdrop-filter:blur(16px) saturate(115%);
  transition:transform .24s var(--ease),opacity .18s linear;
}
```

On **Situation** the centre pane spans the whole grid (`grid-column:1/-1`) so geography runs
edge to edge, and the asides float above it (`z-index:2`, `rgba(22,27,33,.66)`,
`margin-top:28px` to clear the header band).

**Panels slide, they do not pop.** Left aside `translateX(-14px)â0`, right `+14pxâ0`, 0.26s;
centre pane fades.

**Situation panels minimise.** A chevron sets `.min-l`/`.min-r` on `.panes`, overriding
`--pane-l`/`--pane-r` to `30px` and translating the panel fully out; a 30px labelled vertical
rail restores it. Because the map fit and every overlay inset read the same variables, the map
reflows automatically. Use `:first-of-type`/`:last-of-type`, **not** `:first-child`/
`:last-child` â the restore rails are siblings.

---

# PART 4 Â· THE WATCH SURFACE

## 4.1 Situation â `#view-map`

### Left glass pane, Layers (250px)

Collapsible groups, in order:
1. **Views** *(V3)* â saved filter presets, each showing `window Â· N layers Â· projection`, with
   delete and `save current view`
2. **Event domains** â swatch, name, window count, eye toggle; row click toggles
3. **Context layers** â Country risk index Â· Graticule 10Â° Â· Trade & energy flows Â· Areas of
   interest Â· Marker labels Â· *Satellite tasking (none)*, permanently off and toasting honestly
4. **Severity floor** â four chips, single select, default `Low+`
5. **Time window** â `24h / 72h / 7d / 30d`, default 72h
6. **Live tracks** â Vessels (AIS) Â· Aircraft (ADS-B) Â· Sanctioned/watchlisted only Â·
   Ports & airports, each with a count and eye toggle
7. **Annotations** â the register with inline rename, fly-to and delete

### Header band â full width, above the glass, `z-index:4`

Title Â· live count `42 signals Â· 72h window` Â· **annotation toolbar** (select Â· marker Â· route Â·
area Â· measure Â· **scan box** Â· **scan polygon**) Â· **quick-layer buttons** (risk Â· graticule Â·
labels Â· reset) Â· projection segment `world / emea / apac / amer`.

Padding the header by both panel widths instead leaves a 344px content box for ~760px of
controls at 1280px, and the overflow renders *under* the opaque glass, unclickable.

### Map

- `d3.geoEquirectangular()`; `projection.fitExtent([[padL,6],[w-padR,h-6]], box)` where
  `padL`/`padR` read `--pane-l`/`--pane-r`.
  Views: `world [[-170,78],[178,-58]]` Â· `emea [[-22,62],[62,-12]]` Â· `apac [[62,46],[150,-12]]`
  Â· `amer [[-128,52],[-32,-46]]`.
- `d3.zoom().scaleExtent([1,14])` on the `<svg>`; transform on one root `<g>`.
  **Counter-scale every glyph** (`translate(projected) scale(1/k)`) and divide land stroke width
  by `k`. Double-click zoom disabled.
- **Layer order** (bottom â top): sphere â graticule â land â flow arcs â AOI boxes â **scan
  zones** â infrastructure â annotations â tracks â **clusters** â markers â ping/sequence.
  Markers re-sort by ascending severity rank each draw so criticals are never occluded.
- **Signal marker**: `<rect>` rotated 45Â° â 9px critical, 8px high, 7px others â severity fill,
  1px ocean stroke, opacity .55 when acknowledged, 11px unfilled halo when critical. Optional
  labels right at 8.5px mono with a 2.6px `paint-order:stroke` halo.
- **Vessel**: hull outline rotated to heading with a dashed wake astern; `#7fa8c9`, **red when
  sanctioned**. **Aircraft**: airframe rotated to heading; `#a8b6c2`, amber when watchlisted.
  Names appear above zoom 2.2Ã. **Ports**: circle + anchor. **Airports**: airframe mark. Both
  labelled with their UN/LOCODE or ICAO code.
- Hover shows the tooltip; over land, the country name and its risk index.

### Annotation tools

Click to add points, double-click to finish. Measure reports km **and** nm along the path.
Committing focuses an inline rename in the register. Gold `#c8a04a` so it never reads as a
finding.

### Navigation cluster â bottom right

One bordered stack: zoom in Â· live zoom readout (`1.5Ã`) Â· zoom out Â· recentre Â· fit-all-signals
Â· north-up compass.

### Coordinate block â bottom left, no background, border or blur

`LAT +24.2013  LON +119.6042` in four decimals, and a scale bar with a km figure.
`text-shadow:0 1px 2px rgba(12,15,18,.9)`. Exactly two lines.

### Density strip â 98px

60-bucket histogram of the current window in `#4a545e`, buckets containing critical/high in
`#8d5348`; `d3.axisBottom` time axis (`%H:%MZ` under 7 days, `%d %b` above); window bounds in
mono; a ghost `open replay â`.

### Time cursor *(V3)* â 26px, under the strip

Follow-live button Â· mono readout Â· 0â1000 range Â· sweep button Â· live `N shown`.
Writes `S.tCut` (epoch ms cap, `null` for live). The **single** visibility selector honours it,
so map, legend, inspector, histogram and exports all agree:

```js
visible = () => events.filter(e =>
  e.hoursAgo <= S.win && S.domains.has(e.domain) &&
  SEVERITY[e.severity].rank >= S.sevFloor &&
  (!S.tCut || e.ts.getTime() <= S.tCut));
```

Sweep advances `t += .012` every 60ms and stops at the right edge. The readout turns amber while
held in the past. Replay studies the sequence; the cursor answers *"what did we know at 0400Z?"*

### Right glass pane, Inspector (312px) â four states

1. **Nothing selected** â situation summary: 2Ã2 statistic grid (signals in window, critical,
   countries, basket), by-region bars, severity legend, six newest criticals.
2. **Signal selected** â severity/domain/source tags, 15px title, **Assessment** card,
   **Geolocation** `.kv`, **Exposure touched** chips, actions (`add to briefing`, `centre map`,
   `open dossier`), severity legend, **Nearby signals Â· 800km**, plus *(V3)* **Related records**,
   **assignment** and **discussion**.
3. **Track selected** â photo panel first (`<image-slot>` drop target over an airframe or hull
   silhouette with a caption strip), track `.kv`, a screening note for sanctioned hulls, actions
   (`centre map`, `open in ontology`, `annotate position`).
4. **Always, prepended** *(V3)* â the **urgent interrupt** (Â§7.7).

Selecting anything calls `HWreveal()` first so a minimised inspector slides back in rather than
rendering into a hidden pane.

### Marker clustering *(V3)*

A `HWmapHooks` entry. Below `settings.clusterAt` (default 2Ã) it hides individual markers
(`opacity:0; pointer-events:none`) and bins visible signals into 46px screen cells: one bubble
per cell, radius `9 + min(11, n*1.6)`, stroke = the **worst** severity in the cell, count in mono
at the centre. Hover lists the worst severity and up to three places; click flies to the bin
centroid at `clusterAt + 1`. Above the threshold the layer clears and markers return.

## 4.2 Signals (inbox) â `#view-inbox`

Left: read-only distribution facets â severity (diamond, name, bar, count), region, source
(mono code, count). Orientation, not filters; the filters live in the toolbar where the hands are.

Toolbar: status segment (`all / unread / acknowledged / escalated`) Â· a 250px filter matching
title, place, country, source and ID Â· live count `42 of 42 signals` Â· `acknowledge` Â·
`escalate` Â· `add to briefing`.

Columns: Received (96px mono `hh:mmZ`) Â· Severity (104px) Â· Signal (46%, ellipsised, prefixed
with an `ESC` tag when escalated) Â· Location (150px, place + grey ISO3) Â· Domain (112px code tag)
Â· Confidence (112px bar + integer) Â· Source (118px mono).

Behaviour: header click sorts (`ts`, severity rank, `conf` numeric; else `localeCompare`),
re-click flips. **Selecting a `new` row marks it `ack` and decrements the rail badge â reading
*is* triage.** `j`/`k` move through the sorted, filtered rows. First row selected on entry.

Right pane: severity/domain/ID header, 15px title, summary as prose, **Source chain** card
(primary + time, corroboration count with `Multi-source`/`Single-source`, analyst state),
exposure chips, three actions. `show on map` switches module, pans and selects.

## 4.3 Dossiers â `#view-dossier`

Left: watchlist rows â mono code, name + type on two lines, score coloured by band (`â¥80` red,
`â¥60` amber, `â¥40` steel, else grey), delta triangle.

Centre header: code + type label, state tag (`Deteriorating` / `Stable` / `Improving`), 19px
name, standing note, three actions (`brief this entity` pushes six ring signals to the basket
and opens the generator; `show exposure on map`; `alerting on` â the alert rule editor), plus a
**96px gauge** (6px ring, `--bg-4` track, severity-banded arc, mono value) and a 168Ã42 sparkline
in `#8b96a0` with `min Â· max Â· now`.

Tabs: **Overview** (six-cell statistic grid, signal mix by domain, generated analyst judgement) Â·
**Exposure** (dependency table: name, type, substitutable, single point of failure) Â·
**Risk drivers** (five weighted bars: `>60%` `#8d5348`, `>40%` `#7d6a45`, else grey) Â·
**History** (full-width area chart, 4-tick y grid, `D-29â¦D-0`) Â· **Linked entities**
(shared-dependency counts, `open â`).

Right: every signal within 1400km of the centroid, newest first.

```
score = clamp(0..100,
    40*severityWeight      // Î£(rankÂ²) of ring signals, normalised
  + 25*dependencyWeight    // matched impacts / total dependencies
  + 20*persistence         // share of last 14 days with â¥1 ring signal
  + 15*corroboration)      // mean confidence of ring signals
delta = score â score(14 days ago)
```

## 4.4 Analytics â `#view-analytics`

Toolbar: range (`7d / 30d / 90d`) Â· region select Â· domain select Â· `export csv`. All four
recompute from one `anEvents()` selector.

Blocks in order:
1. **KPI strip** â 12 ledger cells: signals ingested, assessed, critical open, countries touched,
   corridors watched, briefings issued, mean time to brief, escalations, sites in scope,
   suppliers flagged, personnel affected, revenue at risk. Mono 19px with signed deltas.
2. **Signal volume** â area chart, 1200Ã210 viewBox, responsive width.
3. **Four donuts** â severity (severity colours), domain, region, source (grey ramps). 96px,
   40/26px radii, 0.02 pad angle, total in the hole at mono 15px, native `<title>` hovers.
4. **Region Ã domain heatmap** (1.3fr) beside **index movers** (1fr). 22px cells, single neutral
   ramp, empty `#1e242a`, `title` per pair.
5. **Highest-severity signals** â 8 rows with `brief these`; row click jumps to the map.

## 4.5 Replay â `#view-replay`

Toolbar: grouping segment (`by region / by domain / by severity`) Â· mono cursor clock.
Ruler: 128px lane gutter + 13 ticks at `hh:mmZ`.
Lanes: one per group (min 42px), sticky label (`name` + `n signals`), each signal a 10px rotated
square at `left:(tsât0)/windowMsÃ100%`, 1.4Ã on hover, white outline when selected, **22%
opacity when after the cursor**.
Playhead: 1px amber rule with a triangular head at
`calc(128px + (100% â 128px) Ã t)`.
Transport: play/pause Â· 0â1000 scrub Â· speed (`1Ã / 4Ã / 12Ã`, default 4Ã) Â· live `n shown`.
`t += 0.0016 Ã speed` every 40ms; stops at 1; restarts from 0 if played at the end; **pauses on
leaving the module.**

**Locator minimap** (196px, leads the right pane): clicking a lane event re-frames to Â±18Â°,
drops a severity-coloured diamond, pings twice, and plots surrounding signals within 1600km as
small grey diamonds.

**`replay on map`** â the flagship gesture. Switch to Situation, select the signal, fly to 4.6Ã,
ping, then walk the preceding â¤36h of signals within 1600km in chronological order â each drawing
a dashed severity-coloured line converging on the event plus an expanding ring, 420ms apart â
then clear. Reachable from replay, the reader, and any signal row.

## 4.6 Ontology â `#view-ontology`

**A fixed diagram, not a floating force graph.**

```js
TIER = { country:0, corridor:0, faction:1, org:1, person:1,
         facility:2, vessel:2, aircraft:2, event:3 }
TIER_NAME = ['Geography','Actors','Assets & sites','Observations']
```

Geography contains actors; actors operate assets; assets produce observations. Each tier is a
labelled band with a dashed rule. Within a tier, order settles by **three barycentre passes**
over neighbour indices (seeded by descending risk) so links run short and mostly vertical. Nodes
sit at a fixed **112px step** with a **26px alternating stagger**, then are **pinned**
(`fx`/`fy`). The layout is computed once per node set, keyed by `nodes+types+layout`; a dragged
object stays exactly where the analyst put it. Nothing drifts.

An **auto-fit** transform frames the diagram on open (clamped 0.3â1.2Ã), applied
**synchronously** (Â§2.1). `layered / radial` and an explicit rebuild recompute deliberately.

**Node plate**: 92Ã40, `--bg-2` on `--line-strong`, a 15px type icon, the label, a `type Â· risk`
sub-line, and a 3px risk-banded strip at the bottom edge.
**Links**: curved orthogonal paths leaving plate edges (not straight chords), dashed when
inferred, thicker at `conf â¥ .9`, with the relationship word at the midpoint.

Left pane: type legend with counts (click to filter) Â· link-confidence floor slider Â·
*Show inferred links* toggle Â· saved investigations.
Toolbar: find Â· layout Â· rebuild Â· `new object` Â· `link objects` (two-click) Â· `plot on map` Â·
`brief selection`.
Right pane: object editor (label, type, risk slider, free-form properties, link list) or link
editor (type, confidence slider, basis text, delete). Double-click expands a neighbourhood.

## 4.7 Imagery â `#view-imagery`

### Left pane â observation areas

- **Scope** â a country select plus **`propose coverage for scope`**, which derives AOIs from the
  infrastructure register and inserts them dimmed as `proposed`
- **Areas** â class icon, name, `id Â· class Â· radius`, cadence (or `proposed`), with a `â»` marker
  for recurring drawn areas. Inline rename on a second click. Selecting loads its latest scene
- **Scenes** â the scene register for the current area
- **Detector** â model select (`hw-changedet v3 (siamese)` / `hw-objdet v5 (aerial)` /
  `hw-sar-delta v2`) Â· confidence floor Â· three change-type toggles Â· `re-run detection`

### Centre â the comparison

Toolbar: `SCN-4471 Â· Chernyakhovsk airbase Â· 2026-06-14 â 2026-08-29 Â· Commercial optical` Â·
view segment (`split / swipe / after only`) Â· detections toggle Â· `raise signal` Â·
`add to briefing`.

- **split** â reference and current side by side, boxes on the current frame only
- **swipe** â one frame with a draggable 2px handle clipping current over reference
- **after only** â a single full-width frame

Each frame is an `<image-slot>` drop target with a header strip carrying acquisition date,
sensor, cloud fraction and off-nadir angle, so real Sentinel tiles can be dropped in.

**Detection boxes**: 1.2px outline in the change-type colour (removed dashed), a small
`CHG-05 Â· 93%` label above, 12% fill on hover/select. **`bbox` is stored in percent of frame,
never pixels**, so overlays survive any frame size, zoom or user-dropped image.

### Right pane

AOI editor first (name, class, cadence, radius slider, standing note, centre/owner/status, then
`save area` Â· `accept`/`pause` Â· `locate` Â· `delete`), then **Detections** (typed rows with
confidence, `confirm`/`reject` as model feedback), the selected finding's note and provenance,
**object counts** reference â current with signed deltas, and **scan history** *(V3)*.

### The Sentinel loop, per AOI

1. **Task** â a scheduler enumerates AOIs due by `cadence` and queries the archive for the newest
   scene intersecting `(lat, lon, radiusKm)` meeting quality gates (optical: cloud â¤ 20%,
   off-nadir â¤ 30Â°; SAR: same orbit and polarisation as the reference).
2. **Pair** â the new scene is **B**; **A** is the stored reference of the same sensor and
   geometry. **Never compare across sensors or orbits** â it manufactures false positives.
3. **Co-register** â orthorectify, sub-pixel align, radiometrically normalise optical,
   speckle-filter SAR.
4. **Detect** â two models together: an *object detector* over B alone emitting counts per
   `DETECT_CLASSES` with boxes, and a *siamese change model* over the (A,B) pair emitting regions
   typed `new` / `expanded` / `removed`. Counts difference against A's stored counts.
5. **Filter** â drop below the AOI floor; suppress seasonal and tidal classes; suppress boxes
   recurring identically in â¥3 consecutive scenes.
6. **Interpret** â raw deltas become analyst-readable findings. This is the whole point:

| Class | +delta | âdelta |
|---|---|---|
| Vessel | Increased port activity â vessel calls up | Berth occupancy reduced |
| Damaged structure | **Increased structural destruction** | Damaged structures cleared or rebuilt |
| Structure | New construction within the area | Structures removed or levelled |
| Aircraft | Aircraft presence increased on the apron | Aircraft dispersed or withdrawn |
| Helicopter | Rotary-wing presence established | Rotary-wing presence withdrawn |
| Revetment | New hardened revetments constructed | Revetments cleared |
| Container stack | Container yard throughput increased | Container yard drawn down |
| Crane | Additional handling equipment on site | Handling equipment demobilised |
| Vehicle | Vehicle concentration increased | Vehicle concentration reduced |
| Small craft | Small-craft cluster expanded | Small-craft cluster dispersed |
| Fuel bladder | Fuel storage established | Fuel storage removed |
| Launcher | Launcher-sized objects detected | Launcher-sized objects no longer present |
| Berm | New earthworks and berms | Earthworks removed |

Suffix each with `(+7)` / `(â12)`.

7. **Route** â findings above threshold emit `Signal` records (`source:'SAT-TASK'`) into the inbox.
8. **Review** â confirm or reject; both are model feedback, and a confirm updates the reference
   counts.

**Auto-derived coverage.** Scoping to a country proposes AOIs over every port, airport, military
base and energy facility inside it, at a default cadence and radius (6km ports, 4km airfields).
Proposed areas render dimmed until accepted; accepting promotes them to `active`.

### Scan history *(V3)*

`historyFor(aoi)` returns the area's real scenes plus four deterministic archived passes (26-day
spacing, alternating EO/SAR, seeded from the area id and radius). Renders a `.sparkbar` of
findings per pass (bars at the maximum turn `#8d5348`) and a row per pass with date, sensor and
count. **Archived passes are honest**: clicking one says the imagery is not cached rather than
showing the current scene twice.

## 4.8 Draw-to-scan *(V3)*

Two tools in the map header â `scanbox` (press-drag a rectangle) and `scanpoly` (click corners,
double-click to close, minimum 3). The top-bar AOI button arms the box tool.

Committing slides in a **322px glass panel** from the right edge of the map:

```css
.scanpanel{position:absolute;top:0;right:0;bottom:0;width:322px;z-index:6;
  display:flex;flex-direction:column;
  background:rgba(22,27,33,.9);backdrop-filter:blur(18px) saturate(115%);
  border-left:1px solid var(--line-strong);
  transform:translateX(100%);opacity:0;pointer-events:none;
  transition:transform .26s var(--ease),opacity .18s linear}
.scanpanel.open{transform:translateX(0);opacity:1;pointer-events:auto}
```

**Contents, in order:**
1. **Metric ledger** (2Ã2, 1px gaps): kmÂ² covered Â· corner/vertex count Â· archive tiles
   (`ceil(areaKmÂ²/12100)`, a Sentinel-2 tile is ~110Ã110 km) Â· revisit (`5 days` S2, `6 days` S1,
   `on tasking` commercial)
2. `#sc-name` â pre-filled from the nearest infrastructure within `max(30km, boxWidth)`
3. `#sc-cls` â the seven `AOI_CLASSES`; **changing it re-seeds the detection classes** from
   `CLASS_PRESETS` (airport â Aircraft, Helicopter, Revetment, Vehicle, Structure Â· port â
   Vessel, Small craft, Container stack, Crane, Vehicle Â· military â Aircraft, Vehicle,
   Revetment, Launcher, Berm Â· energy â Structure, Fuel bladder, Vehicle, Crane Â· urban â
   Structure, Damaged structure, Vehicle Â· border â Vehicle, Structure, Berm Â· custom â
   Structure, Vehicle, Vessel)
4. `#sc-sensor` â `Sentinel-2 Â· optical 10m` / `Sentinel-1 Â· SAR 20m` / `Commercial EO Â· 0.5m` /
   `Commercial SAR Â· 1m`
5. **Detection classes** â a two-column checkbox grid over all 13, labelled `5 of 13`
6. `#sc-conf` â confidence floor 40â95%, default 60%
7. `#sc-cad` â `daily / 3-day / weekly / monthly / on demand`
8. `.kv` â centroid (mono, 3dp), extent `W Ã H km`, owner
9. **Detector log** â appears on run; mono, auto-scrolled

**`run scan now`** rejects an empty class set, disables itself, animates a `scan-sweep` line down
the bounds in 26 steps Ã 90ms (**stepped timers**), and logs six stages at
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

On completion it **synthesises a real scene** onto `X.scenes`: object counts per selected class
with signed deltas, the three largest movers as `Change` records with percent bboxes, then a
toast and a route into Imagery.

**`save for recurring`** unshifts an AOI with `recurring:true`, the drawn `pts`, chosen
`classes`, `conf`, `sensor` and `cadence`; `radiusKm = sqrt(areaKmÂ²/Ï)`; `notes` records
provenance. It appears **first** in the Imagery rail with a `â»`, and its polygon persists on the
map via its own `HWmapHooks` entry â hover for the tasking summary, click to open its latest
scene.

**Switching to any non-scan tool dismisses the panel**, so a half-configured scan never lingers.

### The two geometry bugs

**Ring winding.** `d3.geoArea` and `d3.geoPath` read a ring's winding to decide which side is
inside; a wrongly-wound ring measures the **complement of the sphere** â a drawn box reported
`504,470,700 kmÂ²`. Drag order and free-hand click order are both arbitrary, and a shoelace sign
test is not sufficient. Pick empirically:

```js
const ringArea = pts => d3.geoArea({type:'Polygon',coordinates:[pts.concat([pts[0]])]});
function normalizeRing(pts){
  if (pts.length < 3) return pts;
  if (ringArea(pts) <= 2*Math.PI) return pts;
  const r = pts.slice().reverse();
  return ringArea(r) <= 2*Math.PI ? r : pts;
}
```

Apply to the **live drag preview and on commit**, so preview and measurement agree.

**Off-globe inversion.** `projection.invert()` returns latitudes beyond Â±90 for points off the
globe, silently corrupting every downstream measurement:

```js
invert(clientX, clientY){
  const r = $('#mapsvg').getBoundingClientRect();
  const p = projection.invert(zt.invert([clientX-r.left, clientY-r.top]));
  if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
  if (p[1] > 90 || p[1] < -90 || p[0] > 180 || p[0] < -180) return null;
  return p;
}
```

Handlers then warn (`Start the box inside the mapped area`) instead of producing nonsense.

---

# PART 5 Â· SESSIONS AND THE WORKSPACE LAYER *(V3)*

## 5.1 Sessions

A session is a **whole desk**: `win`, `sevFloor`, `domains`, `ctx`, `proj`, the map `transform`,
its `tabs`, `basket` and `views`. Switching restores all of it.

```js
const newSession = (name, patch) => Object.assign({
  id: 'S' + Math.random().toString(36).slice(2,7),
  name, win: 72, sevFloor: 1, domains: Object.keys(DOM), proj: 'world',
  ctx: { risk:true, grat:true, labels:false, flows:true, aoi:true, arcs:true },
  tabs: [], basket: [], views: [], transform: null
}, patch || {});
```

**Seeded:** Global watch (72h, all layers, world) Â· Red Sea corridor (7d,
maritime/conflict/energy, emea, floor moderate, one saved view) Â· Baltic & Nordics (30d,
cyber/conflict/political, emea) Â· Indo-Pacific (7d, maritime/conflict/trade, apac).

`captureSession()` writes live state back before any switch; a 60s interval and `beforeunload`
also persist. The **session popover** (308px, anchored under the control) lists every session with
`window Â· layers Â· projection Â· views`, a delete `â`, and `#ses-new` which forks the current view
and focuses an inline rename.

A filter set is not a workspace â the map position, open records and briefing basket are part of
the thought.

## 5.2 Views

A **view** is a named filter preset *inside* a session â window, severity floor, layers,
projection, context layers. Sessions are where you work; views are how you look. They sit in a
`Views` group inserted as the **first** group of the Situation layer panel.

Keeping them separate is deliberate: merging them loses the ability to look at the same desk two
ways.

## 5.3 Reorderable rail and tabs

One helper on HTML5 drag events:

```js
function makeSortable(container, itemSel, onOrder) {
  let dragged = null;
  container.addEventListener('dragstart', ev => { /* mark .dragging */ });
  container.addEventListener('dragover',  ev => { /* .dropbefore / .dropafter by half */ });
  container.addEventListener('drop',      ev => { /* reinsert, then onOrder(items) */ });
  container.addEventListener('dragend',   () => { /* clear classes */ });
}
```

Rail order persists globally (`Y.railOrder`); tab order per session.

**Two traps that hard-locked the page.**
1. **Observer feedback loop** â the rail is re-rendered by the shell, so order must be re-applied
   by a `MutationObserver` on `#modrail`, but `armRail()` itself mutates `#modrail`. Needs a
   re-entrance flag **and** a rate limit, both **inside `armRail()`** so every caller is covered
   (two observers call it):
   ```js
   let arming = false, railTicks = 0, railWin = 0;
   function armRail() {
     if (arming) return;
     const now = Date.now();
     if (now - railWin > 1000) { railWin = now; railTicks = 0; }
     if (++railTicks > 24) return;        // circuit breaker
     arming = true;
     /* set draggable, apply the TOTAL order */
     arming = false;
   }
   ```
2. **A partial stored order never settles** â if `railOrder` is missing an id, the DOM order after
   a reorder can never equal the desired order and the loop runs forever. The desired order must
   be **total**:
   ```js
   const want = Y.railOrder.filter(id => present.includes(id))
     .concat(present.filter(id => !Y.railOrder.includes(id)));
   if (present.join() !== want.join())
     want.forEach(id => rail.appendChild($(`.mod[data-mod="${id}"]`)));
   ```

## 5.4 Palette v2

Fourteen indexed kinds: `MODULE SESSION VIEW SIGNAL DOSSIER OBJECT PLACE VESSEL AIRCRAFT AREA
SCENE BRIEFING LOC COORD`.

**Scope prefixes** â a `.scopebar` under the input plus typed prefixes; `Tab` cycles:

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

**Coordinates** â `parseCoords` accepts a decimal pair (`26.5, 56.25`, optional `@`) and DMS
(`26Â°30'N 56Â°15'E`), validates ranges, and emits a `COORD` row pinned to the top that flies the
map and pings.

**Locations** â an offline gazetteer (~90 places) built from infrastructure, reported places,
imagery scenes and a hard-coded chokepoint list (Hormuz, Bab el-Mandeb, Suez, Panama, Taiwan
Strait, Malacca, Bosphorus, Danish Straits, Cape of Good Hope, Gulf of Aden, Kerch, Gotland
Basin). On top of that, queries â¥3 characters hit **Nominatim** debounced at 340ms:

```
https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=â¦
```

Results appear under a `Geocoder Â· OpenStreetMap` group tagged `LOC Â·live`. A sequence number
discards out-of-order responses; failure is silent and the gazetteer still answers. Switchable in
Settings â General.

**Ontology objects are indexed by label, type AND property values**, so `636020918` finds
KEPHALOS II by its MMSI.

**Recents and pinned** â with an empty query the palette shows `Pinned`, `Recent` (last 12) and
`Modules`; empty groups are dropped. Every row with a `ref` carries a pin toggle.

`ArrowDown`/`ArrowUp` skip group headers; `Enter` runs the highlighted row.

## 5.5 Alert rules â `#alert-scrim`

An 820px dialog: rule list (286px) beside the editor.

| Field | Operators | Values |
|---|---|---|
| Severity | `is at least`, `is` | the four severities |
| Domain | `is`, `is not` | the seven domains |
| Region | `is`, `is not` | EMEA, APAC, AMER |
| Country | `is` | every ISO3 in the corpus |
| Source | `is`, `is not` | the seven sources |
| Confidence | `is at least` | 0.6, 0.7, 0.8, 0.9 |

Clauses are ANDed. Changing the field resets operator and value to that field's first legal
options. Action: `notify` / `escalate` / `brief`.

A live `.arpreview` renders the rule as prose â *"when severity is at least Critical and domain
is Maritime & chokepoints â notify"* â and **below it every matching signal in the loaded corpus
is listed**, with `#ar-hint` reporting the count.

**A builder that cannot tell you what would fire is a form, not a tool.**

Seeded: *Critical maritime, any corridor* (notify) Â· *High or above in EMEA* (escalate) Â·
*Corroborated cyber reporting* (brief, off).

## 5.6 Real exports

`download(name, mime, text)` uses a Blob + object URL, revoked after 400ms.

| Export | Contents |
|---|---|
| **Signals CSV** | current filter only, columns `id,ts,severity,domain,title,place,country,iso3,region,lat,lon,conf,source,status,impacts`, RFC-4180 quoting |
| **Geometry GeoJSON** | `FeatureCollection` of observation areas (Polygon where drawn, else Point), annotations (Point/Polygon/LineString) and signal points, each with a `kind` property |
| **Ontology JSON** | all nodes and links with confidence and basis |

**Read `window.HWann`, not `X.annotations`.** Annotations live in a module-scoped
`const anns = X.annotations.slice()`; reading the seed array silently ships only the three seeded
ones and drops everything the analyst drew. `hw-x.js` publishes `window.HWann = anns` and the
exporter reads `(window.HWann || X.annotations)`. This was a shipped bug.

## 5.7 Related records

`relatedFor(signal)` groups by geographic and semantic proximity:

| Group | Radius / rule |
|---|---|
| Signals | within 800km |
| Dossiers | within 1400km |
| Ontology objects | place/country/ISO3 matched in label or properties |
| Imagery scenes | within 900km |
| Observation areas | within 900km |
| Infrastructure | within 400km |
| Live tracks | within 600km |
| **Alert rules fired** | rules that would match this signal |

Injected as a card into the inspector before the action row. Every row performs the full
cross-module navigation. The answer to "what else touches this?" in one place.

## 5.8 Settings â nine tabs, 900px dialog

| Tab | Contents |
|---|---|
| **General** | Display (clustering on/off, threshold 1â6Ã, marker labels) Â· Search (live address lookup, gazetteer size) Â· Workflow (opening a signal acknowledges it, confirm before deleting, tips in empty panes) |
| **Tutorial** | **16 numbered steps**, each with an `open <module> â` button that closes the dialog and navigates: pick a session Â· read the situation Â· rewind in place Â· work the inbox to zero Â· follow the exposure Â· draw a scan area Â· read the change Â· trace the network Â· generate the briefing Â· set your alerts Â· switch to Workstation Â· work from your queues Â· read the intel mailbox Â· bundle work into a case Â· work with the team Â· hand over the shift. Plus a *Reading the interface* section explaining the diamond, the colour discipline, and that gold means an analyst drew it while blue means a tasking instruction |
| **Shortcuts** | Six tables, ~34 rows, keys as `<kbd>` |
| **Sessions & views** | Every session with its state summary and a switch button; views with apply; the session/view distinction explained |
| **Alert rules** | All rules as prose with active/off tags, and a route into the editor |
| **Export** | The three exports with live row counts, plus how to get a PDF |
| **Distribution** | The recipient book (Â§7.9) |
| **Mail & calendar** | The Gmail connector (Â§7.8) |
| **Users & roles** | All users, create/switch, and the role capability matrix |
| **Data sources** | Eight feeds with what each carries, connection state and time since last message â seven connected, `COMMERCIAL-EO` unavailable, which is *why* the satellite tasking layer is honestly unavailable. Plus the three detection models |
| **About** | Build, corpus counts, basemap provenance, and an explicit note that the corpus is sample data and workspace state is local only |

## 5.9 Full screen

`#btn-full` calls `requestFullscreen()` / `exitFullscreen()`, swaps its icon to `i-full-exit`,
and re-fits the map 120ms after `fullscreenchange`. Bound to `F`. A blocked request toasts.

---

# PART 6 Â· THE BRIEFING SURFACE

## 6.1 One artefact, three renderings

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

## 6.2 The generator â `#view-generate`

Left: briefing title Â· scope select Â· audience select (`Executive committee / Regional security
leads / Board risk committee / Operations and logistics`) Â· forecast-horizon segment
(`7d / 30d / 90d`) Â· six section checkboxes Â· classification select Â· standing-instruction
textarea.

Centre: the corpus as a checkbox grid sorted by severity then recency, header count
`12 selected`, with `select top 12 by severity` and `clear`; the briefing basket merges in on
entry; a 2px progress line at the foot.

Right: a seven-step checklist, the agent log, run controls, and **print / deck / distribute**
buttons enabled once a run completes.

```
Resolve parameters and scope            260ms
Assemble evidence set                   420
Deduplicate and cluster signals         700
Score exposure against asset register   820
Draft judgement and section text       1400
Apply house style and classification    520
Compile document and paginate           480
```

**~4.6s total is deliberate. Latency is information; instant is not credible.**

Step states: pending (index in a grey ring) Â· running (spinning `--acc-hi` ring) Â· done (tick,
`#699781` ring, elapsed time right-aligned).

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

Guard with `if (M.gen.running) return;` **and clear the flag on every exit path** â a throw
between "started" and "finished" wedges the generator until reload. An empty evidence set warns
and does nothing.

## 6.3 Reader â `#view-reader`

720px measure, 13.5px/1.68 body. The rest of the console is 12.5px/1.45; this is the only place
that relaxes, because it is prose to be read.

**References.** Every claim with a record behind it is an `.xref` carrying `data-k`
(`signal|scene|node|region`) and `data-id`:

```js
const refSpan = (kind,id,text) =>
  `<span class="xref" role="link" tabindex="0" data-k="${kind}" data-id="${id}">${esc(text)}<span class="rt"> â¸</span></span>`;
```

**A `<button>` here is a bug.** It is an atomic inline-level box: it will not break across lines,
and `display:inline` does not restore wrapping in Blink or WebKit. The judgement reference runs
~78 characters. Being a span, it needs a keydown handler for `Enter`/`Space`.

Clicking one marks itself active, loads the record into the right pane, and re-frames a **196px
context minimap**. Minimap span per kind: **signal 16Â°** Â· scene 10Â° Â· node 20Â° Â· region 46Â°.

Reference panes offer onward actions: a signal gets `open on map`, `animate lead-up` and
`open in inbox`; a scene gets `open change detection`; an ontology object gets
`open in ontology`; a region lists its signals.

Left pane: the briefing register plus an enumerated index of every reference.
**`guided walkthrough`** steps every reference at 3.6s, scrolling each into view. **Kill the
interval on module change.**

Sections in fixed order: header Â· executive judgement (two paragraphs + bottom-line callout) Â·
assessment by theme Â· **network and attribution** (reader-only) Â· indicators and warnings Â·
sourcing and method.

## 6.4 Print layout â `#view-doc`

816Ã1056px pages (US Letter @96dpi), `#f4f2ee` stock, `#1b1f24` ink, 62/70/54px padding,
`display:flex; flex-direction:column` with `.pno{margin-top:auto}` so the folio sinks.

**Serif body** â the single highest-leverage decision in the document. Headings stay sans, 12px,
700, uppercase, .09em tracking, over a `#b9b5ac` rule, which is what institutional reports do.

Toolbar: `BRF-0436 Â· INTERNAL // RISK Â· 12 signals` Â· zoom segment (75/100/125% via
`transform:scale` with a `marginBottom` correction, since transform does not affect layout) Â·
`back to reader` Â· `deck` Â· `print / pdf` Â· `distribute`.

Page plan:
1. Kicker (`Horizon Watch Â· intelligence briefing Â· BRF-0436`), H1, rule, metadata table (scope,
   horizon, audience, issued, evidence set, drafted by), **Executive judgement** (lede +
   supporting paragraph + a `Bottom line.` callout with a 2px left rule), **Signals driving this
   assessment** (9-row table: ref, severity, signal, location)
2. **Assessment by theme** (H3 per domain, generated paragraph, up to three cited bullets),
   **Regional distribution** (region, signals, critical, dominant theme)
3. **Exposure and continuity impact** (dependency table with signal counts, severity peak,
   standing mitigation), **Indicators and warnings**, **Recommended actions** (numbered: action,
   owner, by D+n), **Sourcing and method**
4. **Appendix A â link analysis** *(V3)*

Contents links compute the offset and scroll the desk â **never `scrollIntoView`**, which
displaces the app shell.

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

## 6.5 Appendix A â link analysis *(V3)*

`window.HWappendix.page(doc)` returns a fourth `.docpage`: an object table (ref, object, type,
risk, standing note) for ontology objects intersecting the evidence set, a relationships table
(from, relationship, to, confidence, asserted/inferred), and a **method note** stating how many
links are inferred and that inferred links are review candidates, not conclusions.

A link-analysis appendix without a stated basis is an accusation.

## 6.6 Deck â `#view-deck` *(V3)*

Authored at 1920Ã1080, scaled to fit (Â§2.3). Entry points: reader toolbar, print view, generator
footer.

Layout: slide rail (186px) Â· stage Â· speaker notes (300px). Toolbar: `BRF-0436 Â· INTERNAL // RISK
Â· 12 slides` Â· dark/light segment Â· `back to reader` Â· `pdf` Â· **`present`**.

| # | Slide | Content |
|---|---|---|
| 1 | Cover | title lowercase 104px; scope, horizon, audience, evidence set, issued, prepared by |
| 2 | **Bottom line** | the judgement at 52px, then the one-line why |
| 3 | This cycle | 4-cell severity ledger (76px mono figures) + regional bars |
| 4 | Where | real map, **criticals labelled only** |
| 5â8 | One per theme | top four domains: statement at 46px, three signals, dependencies |
| 9 | Exposure | dependency table: name, signals, severity peak, standing mitigation |
| 10 | Indicators | four falsifiable triggers |
| 11 | Actions | numbered, owner, by D+n |
| 12 | Sourcing | 4-cell ledger + method note |

**Slide type scale:** H1 104px Â· H2 58px Â· H3 36px Â· body 34px Â· big body 46px Â· quote 52px Â·
statistic 76px Â· table 27px Â· eyebrow 22px Â· footer 19px.

**Present**: `body.presenting` strips the topbar, tabstrip, statusbar, rails and transport,
switches `#view-deck .panes` to `1fr`, and blacks the desk. Arrows / space / Home / End / Esc.

**`pdf`**: lays every slide into the flow, sets `position:static`, prints one 16:9 slide per
landscape sheet, then restores.

**Speaker notes are generated from the same fields the slide uses**, so a note can never describe
a slide that changed. Each carries a delivery cue â *"Expect the interruption here, have the
number ready"* on exposure; *"Do not advance until line one has an answer"* on actions.

**Deck editorial judgement.** Bottom line goes **second**, not last â executives get the
judgement before the evidence. Only criticals get map labels: a slide is not an inspector. The
sourcing slide exists to be held back unless challenged, and its note says so.

## 6.7 Generated language

British English, sentence case, declarative, quantified, unemphatic. **No em dashes, no emoji,
no adjectives of intensity.**

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

**Theme paragraph**
```
{n} signals in this theme, centred on {up to three places}. The severity peak is {severity},
set by {place}. Operationally the theme bears on {up to three impacts}.
```

**Analyst judgement (dossier)**
```
{name} sits at {score} on the exposure index, {up|down|flat} {|delta|} points over the
fortnight. {n} signals fall inside the exposure ring, {crit} of them critical.
{crit ? 'Treat the corridor as constrained for planning purposes and hold the contingency
routing in place.' : 'No change to continuity posture is warranted on current reporting.'}
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

**Recommended actions** â five rows above six signals, three otherwise:
```
1  Hold contingency routing on affected corridors through the horizon window   Logistics          D+0
2  Re-run restricted-party screening against the vendor master                 Compliance         D+3
3  Confirm generator and fuel cover at sites inside active-conflict rings      Regional security  D+5
4  Brief the executive committee on corridor cost exposure                     Group security     D+7
5  Review alerting thresholds for the two fastest-moving entities              Intelligence       D+10
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

# PART 7 Â· WORKSTATION *(V3)*

## 7.1 Mode, not modules

| Mode | Modules |
|---|---|
| **Watch** | Situation Â· Signals Â· Dossiers Â· Analytics Â· Generate Â· Replay Â· Ontology Â· Imagery Â· Briefings |
| **Workstation** | My work Â· Mail Â· Cases Â· Team |
| Hidden | Print layout Â· Deck |

Sessions, filters and the briefing basket carry across both. `W` toggles, `G` jumps to My work.
Rail filtering per Â§2.2.

**Why a mode.** Thirteen peers is a menu, not a tool. Analysis and coordination are different
postures with different attention: one is spatial and exploratory, the other queue-driven and
social. The rail is the *lens*; the mode decides which lens set exists.

## 7.2 The reference grammar

```
sig:HW-2400 Â· ent:ENT-RS-01 Â· onto:N02 Â· scn:SCN-4471 Â· aoi:AOI-14
brf:BRF-0431 Â· case:CS-0014 Â· mail:M-1042 Â· rfi:RFI-021
```

`HWref.open(ref)` switches mode if needed and navigates. `HWref.label(ref)` resolves a title.
`HWref.icon(kind)` returns the sprite id. This is what makes *any* record commentable,
assignable, attachable and citable.

## 7.3 Identity and roles

| Role | Can |
|---|---|
| Group security lead | approve Â· issue Â· assign Â· brief Â· admin |
| Senior analyst | assign Â· brief Â· review |
| Analyst | brief |
| Regional lead | answer Â· brief |
| Imagery analyst | confirm Â· brief |

Eight seeded users with initials, colour, email, timezone, shift and presence. Gate every
privileged action with `can('approve')` and **refuse with a toast, never a hidden control** â a
refused-and-explained action teaches the permission model; a missing button teaches nothing.

Click the top-bar avatar to switch or create a user; state persists under
`horizonwatch.workstation.v1`.

## 7.4 My work â `#view-work`

Seven queues: **assigned to me** Â· **mentions** Â· **RFIs to answer** Â· **my cases** Â·
**awaiting my review** Â· **urgent mail** Â· **unreviewed signals**. Scope segment
`mine / team / unassigned`. Left pane also carries the signed-in user card and `switch user`.

Rows: severity diamond or type icon Â· title Â· `ref Â· sub` meta Â· assignee avatar Â· due (red when
`< D+4`).

Right column carries **the day**: calendar (meetings, due dates, scheduled scans), then recent
team activity with clickable references.

This is the *what do I do today* screen a workstation needs.

## 7.5 Mail â `#view-mail`

Left nav: Inbox Â· Urgent Â· Raised as signals Â· With attachments Â· Sent Â· **Inbound rules** Â·
**Automatic mail**, each with a count; plus a mailbox card (provider, account, state, last sync,
today's in/out).

Centre: message rows â unread dot (red when urgent), sender, attachment paperclip, `signal` tag
when parsed, case tag, subject, first-line preview, relative time. Toolbar: folder label Â· search
Â· count Â· `raise signal` Â· `attach to case` Â· `compose`.

Right: the message â urgent banner, subject, sender block, **parsed banner** naming the signal it
became with an `open â`, body in `pre-wrap`, attachments, `.kv` (source, reliability, labels,
case), and four actions (`reply`, `raise signal`, `attach to case`, `raise RFI`) plus the
comment rail.

## 7.6 Cases â `#view-cases`

Left: case rows â priority diamond, title, `code Â· owner Â· due`, status.

Centre header: code + opened date, priority tag, status tag, 19px title, summary, four actions
(`brief this case` Â· `raise RFI` Â· `plot records` Â· status advance), owner block and watcher
avatars.

Five tabs:
- **Overview** â attached-record ledger (six cells), case notes, open RFIs
- **Records** â one `.reflist` group per kind with clickable `refchip`s
- **RFIs** â full RFI cards
- **Timeline** â every activity entry touching the case or its records
- **Briefing** â the **approval chain** as a four-step strip (`draft â review â approved â
  issued`), each step stamped with initials and time, the chain history as comment blocks, and an
  `advance` button gated by role

Right: the case discussion with the composer.

**A case is what turns sixteen modules into one job.** Without it, cross-module links are
navigation; with it they are a body of work with an owner and a deadline.

## 7.7 Collaboration primitives

All injectable into any record:

```js
window.HWcomments.inject(box, ref);   // discussion + @mention autocomplete
window.HWassign.inject(box, ref);     // owner, due date, reassign, mark done
window.HWpresence.inject(box, ref);   // who else has this record open
window.HWinterrupt.inject(box);       // the urgent block
```

**Comments** â real @mention autocomplete: typing `@` opens a positioned popover of matching
users; `ArrowUp`/`ArrowDown` move, `Enter`/`Tab` pick, `Escape` closes; `ââµ` sends. Mentioned
users get a notification and a Mentions-queue entry. Comments resolve and reopen.

**Assignment** â owner select, due input, `assign`/`reassign`, `mark done`. Notifies the assignee
and writes an activity entry.

**Presence** â deterministic from the record reference in this build; Â§9.5 lists the real event.

**RFIs** â raised against a case with a recipient and due date, tracked to closure, answerable
only by the recipient, visible on the case timeline. Optionally sent by mail as well as
in-console.

**Handover** â generated from what actually changed during the shift: what you acknowledged and
escalated, how many comments across how many records, what alerts and digests went out; what you
left open (assignments, RFIs, cases with dates); what to watch for (the criticals). Plus a free
note. Sent in-console and by mail.

## 7.8 The urgent interrupt

Urgent mail, mentions and overdue RFIs must reach the analyst without them going looking.

```css
.interrupt{border-bottom:1px solid var(--line);
  background:linear-gradient(180deg,rgba(196,69,60,.14),transparent);padding:10px 12px}
```

`HWinterrupt.inject(box)` prepends a red **Needs you Â· N** block to the Situation inspector, with
up to four rows (icon, text, timestamp) and a dismiss-all. Alongside it: a toast on arrival and
rail badges. **Dismissals persist** so a cleared item does not return.

An analyst working the map does not go looking for their inbox â the inbox reaches them.

## 7.9 Gmail â a real OAuth client

`hw-gmail.js` is **not a mock**. Supply a Google Cloud OAuth 2.0 **Web application** client ID in
Settings â Mail & calendar, enable the Gmail API, and add the page origin to the client's
authorised JavaScript origins. It signs in through Google Identity Services and calls the Gmail
REST API from the browser:

```
messages.list?maxResults=25&q=<configurable query>
messages.get?format=full   â base64url decode, MIME walk for text and attachments
messages.send              â RFC 2822 raw payload, base64url encoded
profile                    â account, message total
```

Scopes: `gmail.readonly gmail.send gmail.labels calendar.events`. Polling 30â600s, default 60.
Token expiry checked before every call.

```js
function mime(to, subject, body, opts) {
  const lines = [
    'From: ' + (G.profile?.emailAddress || 'me'),
    'To: ' + (Array.isArray(to) ? to.join(', ') : to),
    opts?.cc ? 'Cc: ' + opts.cc : null,
    'Subject: ' + subject,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"',
    opts?.urgent ? 'X-Priority: 1' : null,
    opts?.urgent ? 'Importance: high' : null,
    '', body
  ].filter(Boolean).join('\r\n');
  return btoa(unescape(encodeURIComponent(lines)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
```

**Without a client ID it runs the sample mailbox and says so.** A send with no connection queues
at `delivered: 0` rather than claiming delivery. **Never claim a delivery you cannot perform.**

**Inbound rules** â six, auditable, matched in order:

| Rule | Match | Sets |
|---|---|---|
| PR-1 Partner corridor bulletins | from contains marinerisk | domain=maritime Â· source=PARTNER-FEED Â· severity from subject keywords |
| PR-2 Government advisories | from ends gov.uk OR state.gov | domain=political Â· source=GOV-ADVISORY Â· conf=0.78 |
| PR-3 AIS gap alerts | subject starts "AIS gap" | domain=maritime Â· attach vessel by MMSI Â· severity=high |
| PR-4 Field reports | from sahel-security.example | domain=conflict Â· source=FIELD-REP Â· geocode from body |
| PR-5 Scene delivery notices | from copernicus.example | route to imagery Â· no signal raised |
| PR-6 Urgent on keyword | subject contains URGENT | flag urgent Â· notify duty analyst Â· interrupt inspector |

**A message matching no rule stays in the inbox** for an analyst to raise by hand. Nothing is
discarded, and nothing becomes a signal without a rule that can be read and audited.

**Outbound** â five channels:

| Channel | To | When |
|---|---|---|
| Morning situation digest | All analysts | 0600 **local per recipient** |
| Critical maritime â immediate | Group security + duty analyst | on match, throttled 15 min |
| Weekly exposure review | Executive committee | Monday 0700 CET |
| Imagery findings above 80% | Imagery analyst | on detection confirm |
| Duty-of-care check-in | Staff in elevated areas | 0800 and 1800 local |

Digests are assembled per recipient in their own timezone, so an 0600 digest reaches Lisbon and
Singapore at 0600 local, not 0600 UTC. Alerts are throttled per rule: the first matching signal
sends immediately, later matches inside the window fold into one follow-up. Delivery receipts
carry delivered / opened / failed with an open-rate bar.

## 7.10 Briefing distribution

Recipients are **data, not hard-coded strings**. A recipient book of five lists plus ad-hoc
addresses lives in `localStorage`, is editable in Settings â Distribution, and is read by **one**
picker reachable from three places: the reader toolbar, the generator footer, the print view.

| List | Note | Members |
|---|---|---|
| Executive committee | Weekly review and anything critical | 6 |
| Regional security leads | Regional distribution | 4 |
| Operations and logistics | Corridor and routing decisions | 3 |
| Board risk committee | Quarterly and on escalation | 4 |
| Duty desk | Always on, 24h | 1 |

The picker resolves and **de-duplicates** the address set (an address may appear in several
lists), shows the count before sending, composes a covering summary from the document object, and
**on send advances the approval chain to `issued`** with a stamped chain entry.

`validEmail` rejects malformed additions with the offending string named.

## 7.11 Team â `#view-team`

Four views: **roster** (avatar, name, role, email, timezone, shift, open work, owned cases,
presence dot) Â· **RFIs** (full cards, answerable in place) Â· **activity** (the full log with
clickable references) Â· **handovers** (completed / left open / watch for, with an acknowledged
tag, plus `compose handover`).

Right pane: notifications, unread highlighted, urgent with a red left rule, `mark all read`.

---

# PART 8 Â· MOBILE COMPANION *(V3)*

`HorizonWatchMobile.html` + `hw-mobile.js`, sharing `hw-data.js`, `hw-data2.js` **and
`hw-data3.js`** â so identity, roles, mail, cases, RFIs and mentions are the same records as the
desk.

**Not a responsive console.** The console stays desktop-only (floor 1280px). This is a separate
surface for an on-call security lead doing **five things well** rather than sixteen badly.

## 8.1 Device and frame

390Ã844 in a phone bezel using `ios_frame` geometry as plain CSS â no React/Babel, because three
more CDN loads on an already fragile path is the wrong trade.

```
bezel        border-radius:48px
island       126Ã37 at top:11, radius 24
home bar     139Ã5, radius 100
shadow       0 40px 80px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.12)
```

```css
.app{position:absolute;inset:0;
  display:grid;grid-template-rows:54px 46px 30px minmax(0,1fr) 76px}
/*                              status  head  strip  screen    tabs */
```

## 8.2 The live strip â what makes it feel alive

A 30px horizontally-scrolling row under the header, the console's status bar at phone scale:

```
â needs you â Corpus 42 â Critical 5 â Queue 17 â Ingest 124/min â Feeds 7 â Sync 0941Z
```

`Ingest` re-randomises every 4s; `Sync` updates. The dot turns amber when items need attention.
This is the single biggest fix for the "dead/empty" problem â density plus evidence of life.

## 8.3 Five tabs

| Tab | Contents |
|---|---|
| **Now** | The on-call landing. Urgent interrupt block (urgent mail, mentions, RFIs due) Â· posture ledger (need a decision, critical open, countries 24h, mean confidence) Â· a **12-bucket 24-hour sparkbar** with hot buckets in `#8d5348` Â· regional bars Â· **My work** (assignments + RFIs with due dates) Â· **My cases** with priority diamonds and record counts Â· newest criticals |
| **Signals** | Five filters (`Needs action / Escalated / Critical / Mine / All`) with counts; rows carry severity diamond, title, place, domain code, confidence, ESC/ACK tags and the assignee avatar |
| **Map** | Natural Earth geometry, severity diamonds, AIS hulls and ADS-B airframes rotated to heading, **AOI rings**, five filter chips, tap â bottom card |
| **Brief** | The briefing at phone measure (14.5px/1.68) with a stats ledger and live references |
| **Desk** | Press-and-hold voice note with live timer and waveform Â· written note Â· routing Â· attachable reference Â· urgent mail inline Â· recent discussion where you are @mentioned Â· outbox `queued â sent` |

Badges: Now shows the urgent count in red; Signals shows the open queue in grey.

## 8.4 Mobile deltas

- Body 14â15px, not 12.5
- **Minimum touch target 44px** â including padded-out hit areas on the dismiss-all
  (`44Ã44` with `-7px/-11px` negative margins so visual weight does not change) and the map-card
  close
- `:active` instead of `:hover`
- Detail as a bottom **sheet**, not a side panel
- 44px filter chips scrolling horizontally
- Sheets are richer than V2: a signal shows its discussion thread, assignment and parent case;
  cases and RFIs are openable; **RFIs are answerable from the phone**

## 8.5 The six defects to avoid

1. **Never take the map out of the grid.** `position:absolute;inset:0` as a grid child paints
   **above** the in-flow header and tab bar â the user is trapped. Use
   `#view-map{grid-row:4;position:relative;min-height:0;overflow:hidden}`.
2. **One bound zoom behaviour.** `zoom.transform` dispatches only to *that instance's* listeners;
   calling it on a fresh `d3.zoom()` moves nothing and desyncs `__zoom`. Hoist and reuse.
3. **Re-apply the counter-scale on every redraw**, not only on zoom, or glyphs snap to full size
   at k=4â12.
4. **Inline references are spans, not buttons** â worse here: the column is 362px and
   `.screen{overflow-x:hidden}` clips rather than scrolls.
5. **Reset `padding` in the global `button` rule**, not just `border` â UA `~1px 6px` shows as
   gaps mid-sentence.
6. **A reference set from anywhere must survive the note form.** The `#nref` list is built from
   the on-call queue; a record reached from Brief or Map had no option and silently fell back to
   "None". Carry the intent in state and inject the referenced record if absent.

## 8.6 Offline degradation â the point of the product

Libraries load **after** the app, asynchronously, with a 6s timeout and three mirrors
(unpkg â jsDelivr â cdnjs). **Only the Map tab may depend on d3** â Now, Signals, Brief and Desk
use a plain haversine and `reduce`-based `countBy`/`mean`:

```js
const mean = (a,f) => a.length ? a.reduce((s,x)=>s+f(x),0)/a.length : 0;
const countBy = (a,f) => { const m=new Map(); a.forEach(x=>{const k=f(x); m.set(k,(m.get(k)||0)+1);}); return [...m.entries()]; };
const haversine = (a,b) => { const R=6371, r=Math.PI/180;
  const dLat=(b.lat-a.lat)*r, dLon=(b.lon-a.lon)*r;
  const s=Math.sin(dLat/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s)); };
```

`initMap()` shows *"Loading map geometryâ¦"* then either draws or says *"Map geometry unavailable
offline. Now, Signals, Brief and Desk still work."*

## 8.7 Tablet

"Tablet as the full console" holds in landscape on a 12.9â³ iPad (1366pt), but the console floor is
1280, so an 11â³ iPad at 1194 clips. Dropping the floor to 1024 is achievable without touching the
layout above 1280, and is **not currently done**.

---

# PART 9 Â· DATA MODEL

## 9.1 Enumerations

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
AOI_CLASSES  = { airport, port, military, energy, urban, border, custom }  // auto:true on first four
DETECT_CLASSES = ['Aircraft','Helicopter','Vessel','Small craft','Vehicle','Revetment',
                  'Structure','Damaged structure','Container stack','Fuel bladder','Crane',
                  'Launcher','Berm']
NODE_TYPES = { person, org, faction, vessel, aircraft, facility, country, corridor, event }
LINK_KINDS = ['operates','owns','flagged in','transits','located in','affiliated with',
              'supplies','sanctioned by','observed at','controls','contracted to']
ROLES = { lead, senior, analyst, regional, imagery }
STAGES = ['draft','review','approved','issued']
```

## 9.2 Records

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
interface Annotation { id; kind:'point'|'line'|'area'|'measure'; label; by; ts; note;
  lat?; lon?; pts?:[lon,lat][] }
interface AOI { id; name; cls; iso3; lat; lon; radiusKm; cadence; status; scene; owner;
  auto; notes; recurring?; pts?; classes?; conf?; sensor?; history? }
interface Scene { id; place; iso3; lat; lon; aoi; sensor; vendor; dateA; dateB;
  cloud; offNadir; counts:[label,current,delta][]; changes:Change[] }
interface Change { id; label; type:'new'|'expanded'|'removed'; conf;
  bbox:[x,y,w,h];                         // PERCENT of frame, never pixels
  note }
interface Node { id; type; label; risk:0..100; props:Record<string,string> }
interface Link { id; s; t; kind; conf; note; inferred }   // inferred derived: conf < 0.8

/* V3 */
interface User { id; name; initials; role; email; tz; shift; status; color }
interface Mail { id; thread; from; fromName; src; rel; ts; hoursAgo; subject; body;
  unread; urgent; attachments:[{name,size}]; labels; signalId; caseId;
  state:'new'|'parsed'; to:string[] }
interface Case { id; code; title; owner; status:'active'|'review'|'closed';
  priority:'critical'|'high'|'moderate'|'low'; opened; due; watchers:string[];
  summary; records:{signals,entities,scenes,aois,onto,mail}; notes:[{by,ts,body}] }
interface RFI { id; case; from; to; due; status:'open'|'answered'|'closed';
  question; answers:[{by,ts,body}] }
interface Comment { id; ref; by; ts; resolved; mentions:string[]; body }
interface Notification { id; kind; ref; by; ts; read; urgent; text }
interface Assignment { ref; to; by; due; state:'open'|'done' }
interface Approval { stage; chain:[{stage,by,ts,note}] }
interface Handover { id; from; to; ts; shift; acked; did[]; open[]; watch[] }
```

`series(seed,n,base,amp)` is a **deterministic** LCG walk for sparklines and history charts.
Never `Math.random()` in a render path.

## 9.3 Corpus sizes

42 signals across all seven domains, four severities and three regions Â· 10 entities Â·
28 infrastructure places Â· 10 vessels Â· 8 aircraft Â· 3 imagery scenes with 8 detections Â·
20 ontology nodes and 22 links Â· 7 observation areas Â· 3 annotations Â· 3 briefings Â·
**8 users Â· 12 mail threads Â· 6 parse rules Â· 5 outbound channels Â· 5 cases Â· 4 RFIs Â·
6 comments Â· 7 notifications Â· 10 activity entries Â· 2 approval chains Â· 1 handover Â·
5 distribution lists Â· 6 calendar entries Â· 5 assignments** Â· 4 sessions Â· 3 alert rules Â·
~90-place gazetteer.

## 9.4 Real ingestion

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

**Pipeline:** fetch (poller with backoff, raw payload + timestamp) â extract (map to `Signal`,
geocode via gazetteer, **reject records without a resolvable location â never guess
coordinates**) â classify (domain by keyword/model, severity by rule, confidence) â deduplicate
(25km / 12h / title cosine > 0.7; keep earliest, +0.05 conf per corroboration capped .97) â
enrich (intersect the asset register for `impacts[]`) â score (entity index) â publish (read store
+ WebSocket).

**Severity rules â deterministic and auditable, never model-only:**
- `critical` â loss of life or facility damage inside an exposure ring; corridor closure or
  interdiction; confirmed outage of a dependency with no tested alternative
- `high` â measurable degradation (delays, restrictions, partial capacity loss) touching a named
  dependency, or an advisory change
- `moderate` â confirmed change of context with no current operational effect
- `low` â watch item, or the resolution of a previous issue

**Confidence** starts at source base reliability (partner .80, government advisory .78, AIS .84,
OSINT wire .66, field report .74), then +.05 per independent corroboration, â.10 single-source
social origin, â.05 inferred location. Round to two decimals.

**Live tracks.** AIS poll â¤60s; derive `ais:'dark'` when a hull with recent history stops
transmitting beyond its class-typical gap â **dark status is a finding, not a data error**. ADS-B
similarly. Screen `mmsi`/`icao`/owner against restricted-party lists on every refresh; a match is
the **only** thing that turns a track red. Cluster beyond ~500 per viewport.

### 9.4a Geolocating a large RSS estate

The mistake is treating each item as a fresh geocoding problem.

1. **Feed-level priors are free and usually skipped.** A Kano outlet's items are ~80% Nigeria.
   Store a distribution per feed, learn it from confirmed items, and use it as the tiebreak
   everywhere below. This alone resolves most ambiguity.
2. **Extract toponyms, then generate candidates** â NER for LOC/GPE, candidates from GeoNames
   (~12M) or Natural Earth populated places for a lighter build.
3. **Disambiguate by scoring, never first match.** The Springfield/Tripoli problem needs:
   population and feature class weight (`PPLC` â« `PPL`); **spatial coherence** â minimise the
   bounding box over *all* toponyms in the item, so Kano + Lagos resolves Nigeria outright; admin
   hierarchy; the feed prior as final tiebreak; historical co-occurrence from your own confirmed
   corpus.
4. **Never claim more precision than you have.** Store precision explicitly:
   `point â city â admin1 â country â region`. A country-level signal renders at a centroid
   *marked as such*. **A spurious pin is worse than no pin.**
5. **Curate what gazetteers handle badly** â chokepoints, corridors, ports, airfields, military
   bases, cable landings. A few hundred hand-built entries beat any general gazetteer for exactly
   the places you care about.
6. **Report confidence and reject the unresolvable.**

### 9.4b Triage at estate scale

~275 feeds is 15â30k items/day. A **subtractive funnel**, every stage explainable:

| Stage | Cut | Method |
|---|---|---|
| 1 Deduplicate | 60â70% | SimHash/MinHash on title + first paragraph. Keep earliest; count republications as a popularity signal |
| 2 Relevance to exposure | 80% of the rest | Geographic: within N km of a site, route or AOI. Entity: mentions a watched supplier, hull or actor. **Organisation-specific, and the whole point** |
| 3 Novelty | 30â50% | Compare against accepted signals in the same place+domain over 72h. "Third launch this week" is novel; "recap of the launch" is not |
| 4 Severity | ranks | The four deterministic rules |
| 5 Source reliability | weights | Feed base rate learned from confirmed/rejected history |
| 6 Corroboration | promotes | Independent sources within 25km/12h, +0.05 each |
| 7 Adaptive cap | to target | Never exceed ~40/day at the analyst; raise the floor dynamically |

Two rules that make it trustworthy: **log every cut with its reason** â an analyst must be able
to ask "what did you throw away?" â and **sample rejects past a human daily** to catch drift.
Precision matters more than recall: a missed item resurfaces via corroboration; a flood of noise
destroys the tool.

## 9.5 API surface

```
GET   /api/signals?window=72h&domains=&minSeverity=&region=
GET   /api/signals/:id                      PATCH /api/signals/:id {status}
GET   /api/entities                          /api/entities/:id/signals?radiusKm=1400
GET   /api/analytics?range=30d&region=&domain=
GET   /api/risk         GET /api/tracks?bbox=      GET /api/infrastructure?bbox=
GET|POST /api/aois      PATCH|DELETE /api/aois/:id
POST  /api/aois/derive {iso3}               â AOI[] status 'proposed'
GET   /api/scenes?aoi=  POST /api/scenes/:id/detect {model,minConf}
PATCH /api/changes/:id {review}
GET   /api/ontology     POST|PATCH|DELETE /api/ontology/nodes|links
GET|POST|PATCH|DELETE /api/annotations
POST  /api/briefings {title,scope,audience,horizon,sections[],classification,instruction,signalIds[]}
GET|POST|PATCH /api/cases   /api/rfis   /api/comments   /api/assignments   /api/approvals
GET   /api/mail?q=      POST /api/mail/send      POST /api/mail/parse
GET|POST|PATCH|DELETE /api/distribution-lists
WS    /api/stream   signal.created | signal.updated | entity.rescored | track.moved
                  | scene.ingested | detection.raised | comment.created | mention
                  | assignment.changed | mail.received | presence.changed
```

**Client rule: filtering is always local** over the loaded window, from one `visible()` selector,
so the layer panel, legend, pane header, histogram and exports can never disagree.

## 9.6 Published globals

| Global | Owner | Purpose |
|---|---|---|
| `HW` `HW2` `HW3` | data | the corpus |
| `HWopen(mod,label?)` | app | switch module; a label creates a record tab |
| `HWselect(id,{pan})` | app | select a signal, optionally centre the map |
| `HWbasket(ids)` Â· `HWtoast(msg,kind)` Â· `HWreveal()` | app | basket, confirmations, un-minimise |
| `HWrowHTML(e)` Â· `HWbindRows(root)` | app | the universal signal row |
| `HWmap` | app | `projection, path, k, transform, layer(name), flyTo, ping, invert, redraw, tip` |
| `HWmapHooks[]` | app | `{draw(projection,path,k), zoom(k)}` |
| **`HWinspectorHooks[]`** | app | `(box, sel)` â **the** inspector extension point |
| `HWshell` | app | `MODULES, renderLayers, fitView, renderTabs, renderInbox, drawMarkers, drawStrip, sizeMap, renderInspector, visible, toast` |
| `HWM` Â· `HWMcore` Â· `HWMdoc` | modules | entities, briefings, replay state, the loaded doc |
| `HWX` Â· `HWXaoi` Â· **`HWann`** | hw-x | modules hook, AOI registry, **live** annotations |
| `HWP2` `HWsession` `HWalerts` `HWexport` `HWrelated` `HWhistory` `HWappendix` `HWsettings` | hw-y | workspace layer |
| `HWwork` `HWref` `HWcomments` `HWassign` `HWpresence` `HWinterrupt` `HWcase` | hw-w | workstation |
| `HWgmail` | hw-gmail | `connect, disconnect, sync, send, openDistribute, BOOK, DIST, isConnected` |
| `HWdeck` | hw-deck | `open(doc), show(i), fit(), slides` |

**Storage keys â three, and only three:** `horizonwatch.workspace.v1` Â·
`horizonwatch.workstation.v1` Â· `horizonwatch.gmail.v1`. Never touch anything else, and always
fall back to seeds on corrupt state.

---

# PART 10 Â· COMPONENTS

## 10.1 Buttons and controls

**`.btn`** 24px, 9px padding, 6px gap to a 12px icon at .8 opacity, 12px label, `--bg-3` on
`--line-strong`, radius 2px. Hover `--bg-4` â no transform, no shadow, no scale.
`.primary` `--acc` fill, border `#4a7cb5`, text `#f2f6fa` â **one per pane maximum**.
`.danger` grey fill with `#cf6259` text; hover `#3a2c2b` / `#5c3b38` â never red-filled.
`.ghost` transparent for pane-header verbs. `.sm` 21px. Disabled opacity .4.

**`.seg`** 22px buttons, `--line-soft` dividers, pressed `--bg-4` + `--txt`. Max 4 options.

**`.chip`** 20px rounded-2px toggle, 11.5px, optional 7px rotated swatch.

**`.tag`** 16px, 10px sans, ls .03em, transparent fill, `--line-strong` border, `--txt-3`.
Variants recolour **text and border only, never the fill**.

**Forms.** `.input` 26px, `--bg-0` well, `--line` border; hover `--line-strong`; focus
`--acc-hi` border and **no glow ring** â a shadow ring is the web-form tell. `select.input` uses
an inline SVG chevron. `.check` 12px square, checked fills `--acc` with a 1.5px rotated tick.
Range: 3px `--bg-4` track, 11px `--txt-2` thumb with a 2px ring.

**No native dialogs.** `prompt()` / `confirm()` / `alert()` are banned â they break the frame's
visual language instantly. Creating a named object commits a provisional name (`Area 4`,
`Untitled object`) and focuses an **inline** field: Enter commits, Escape reverts, blur saves.
Clicking the name of an already-selected row re-opens the editor.

## 10.2 Data atoms

- **`.dia`** â a 7px square rotated 45Â°. **The severity glyph of the product**: map markers, list
  rows, legends, tables, replay lanes, printed pages, deck tables, mobile rows. Always paired with
  the severity word. Never a circle, never an icon.
- **`.sev`** â diamond + severity word, coloured by severity.
- **`.bar`** â 3px `--bg-4` track with a `--grey` fill. Capped at 3px so it reads as a measure,
  not a progress widget.
- **`.kv`** â 96px 11px `--txt-3` term / 12.5px value definition grid.
- **`.card`** â `--bg-2`, 1px `--line`, 10/11px padding. Groups prose; never nests.
- **`.statgrid` / `.stat`** â `repeat(auto-fit,minmax(140px,1fr))` with **1px gaps filled by the
  grid background** so cells read as a ledger, not floating cards.
- **`.panelbox`** â analytics panel: `--bg-1`, 1px `--line`, 7/11px header, 11px body.
- **`.empty`** â 30px icon at .45 opacity, one 12px `--txt-4` sentence (max 210px), optionally one
  button that resolves the emptiness.

## 10.3 Tables

`border-collapse:separate; border-spacing:0`, 12.5px. Sticky 25px `thead th` at 11px/600
`--txt-3`, 1px `--line` bottom, pointer, hover `--txt`, sort arrow `â²`/`â¼` at 8px on the active
column. `tbody td` 5/9px, 1px `--line-soft` bottom, `white-space:nowrap`, middle-aligned.
Hover `--bg-2`; `aria-selected` `--bg-3`; `.ack` drops opacity to .55 on all cells except
`.keep`. Long text columns get `class="title"` (`max-width:1px; width:46%`) with an inner
ellipsising `<div>`.

## 10.4 Floating layers

**Tooltip** `#maptip`: fixed, `#20262c` on `--line-strong`, 6/8px, max 246px, bold 12px first
line + 10px mono second line, `--shadow`, 100ms fade, cursor +14/+14, viewport-clamped.

**Command palette**: 600px at 12vh, `--bg-2` on `--line-strong`, `--shadow`; 40px borderless 14px
input; scope bar; results max 52vh; row = 13px icon or severity diamond, label, grey sub-label,
pin toggle, right-aligned kind; selected `--bg-4`; footer of key hints.

**Toast** `#toasts`: bottom-right stack, 7px gaps, `--bg-3` on `--line-strong`, 8/11px, 12.5px
with a 14px icon, auto-dismiss 3.2s. **Toasts confirm actions; they never carry information the
user must read.**

**Dialogs**: `.dlg` 520â900px, `--bg-1` on `--line-strong`, `max-height:76vh`, a `.panehead`, a
`.dlgbody` grid, a `.dlgfoot`. Eight of them: alert rules, settings, identity, handover, compose,
distribute, plus the palette and session popover.

## 10.5 Icons

One inline `<svg style="display:none">` sprite of ~70 `<symbol>`s on a 24Ã24 viewBox,
`fill:none; stroke:currentColor; stroke-width:1.4â1.6`, sized by CSS (15px rail, 14px buttons,
12â13px inline, 30px empty states).

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
containers, no icon font, **no emoji**. Icons never appear without a label except in dense tool
clusters, where `title` carries the name.

---

# PART 11 Â· KEYBOARD, MOTION, ACCESSIBILITY, PERFORMANCE

## 11.1 Keyboard â 34 bindings

| Key | Action |
|---|---|
| `âK` / `Ctrl+K` | command palette |
| `1`â`9` | switch module within the active mode |
| `W` | toggle Watch â Workstation |
| `G` | go to My work |
| `Tab` | cycle palette scope |
| `j` / `k` | next / previous signal (Signals) |
| `@` | mention someone in a comment |
| `ââµ` | send a comment |
| `F` | full screen |
| `?` | shortcuts |
| `â â Space Home End` | deck navigation |
| `Esc` | close palette, dialog, present mode, drawing, field |
| `âP` | print the loaded briefing |
| Click avatar | switch or create a user |
| Drag a rail icon / tab | reorder |
| Double-click a graph node | expand its neighbourhood |
| Double-click while drawing | finish a route, area or scan polygon |

Every handler checks `ev.target.matches('input,textarea,select')` before acting.

## 11.2 Motion budget

| Element | Duration | Easing |
|---|---|---|
| Hover / press | 100ms | linear |
| Tooltip fade / palette open | 100 / 120ms | linear |
| Panel slide / minimise / scan panel | 240â260ms | `--ease` |
| Sheet (mobile) | 260ms | `--ease` |
| Map view change / centre / fly | 420 / 520 / 620ms | d3 with sync fallback |
| Ping / lead-up pulse | 1300 / 900ms | stepped cubic-out |
| Graph auto-fit, deck fit | synchronous | â |
| Scan sweep | 26 Ã 90ms | stepped |
| Progress line | 350ms | linear |
| Toast in / out | 0 / 300ms | linear |
| Guided walkthrough step | 3600ms | â |

No bounce, no spring, no scale-on-hover, no list entrance animations. Ambient motion is **only**
the 1s telemetry interval (clock, ingest counter, latency). `prefers-reduced-motion` collapses
everything to 0.01ms.

## 11.3 Accessibility

`role="tablist"` on the rail; `aria-selected` on rail buttons, tabs and rows; `aria-pressed` on
every toggle; `aria-expanded` on collapsible headers; `role="link"` + `tabindex="0"` + keydown on
inline references; visible `:focus-visible{outline:1px solid var(--acc-hi);outline-offset:1px}`.

Contrast: `--txt` on `--bg-1` â 11:1; `--txt-3` labels â 4.8:1; **`--txt-4` never for text a user
must read** â units, ticks and disabled states only.

**Severity is never colour alone** â the diamond is always paired with the severity word.

Mobile: **44px minimum touch target**, including padded-out hit areas where the glyph is small.

## 11.4 Performance

One `visible()` pass per interaction, memoised on (window, domains, floor, tCut). d3 joins keyed
by id â never rebuild the marker layer. Virtualise tables beyond ~500 rows (fixed row heights make
this trivial). Cache the basemap. Cluster tracks beyond ~500 per viewport. Gmail polling â¥30s.
Geocoder debounced 340ms with a sequence guard.

---

# PART 12 Â· BUILD ORDER

1. **Tokens and frame** â Â§1.2 + the four-row grid, top bar, tab strip, status bar.
   *Verify:* nothing scrolls the page; no clipped cells at 1280px.
2. **Corpus** â `hw-data.js`, then `hw-data2.js`, then `hw-data3.js`.
3. **Rail, tabs, view switching** â with `data-set` stamping and record-scoped tabs from the start.
4. **Map** â projection, basemap, land, graticule, markers, counter-scaled zoom, tooltip, cursor
   readout, and **the rAF probe + `applyZoom`** (Â§2.1).
5. **Layer panel** wired to `visible()`; legend, header count and layer counts must agree.
6. **Inspector** (four states), the density strip, **and `fireInspector()`** (Â§2.2).
7. **Glass panels, collapse rails, the full-width header band.**
8. **Signals inbox** â 9. **Dossiers** â 10. **Analytics** â 11. **Generator**.
12. **Reader + print layout** as one artefact. 13. **Deck** (Â§2.3).
14. **Replay** with locator minimap and `replay on map`.
15. **Ontology** â tiers, barycentre ordering, pinned layout, auto-fit.
16. **Imagery** â AOI registry, derive-coverage, split/swipe/after, detection overlay, history.
17. **Annotations, live tracks, infrastructure, draw-to-scan** (ring winding + off-globe guards).
18. **Sessions, views, alerts, exports, related records, time cursor, clustering, settings,
    full screen.**
19. **Workstation** â mode, identity, My work, Mail, Cases, Team, comments, assignment, presence,
    RFIs, approval, handover, interrupt.
20. **Gmail connector + distribution book.**
21. **Mobile companion.**
22. **Â§13 pass.**

---

# PART 13 Â· ACCEPTANCE CHECKLIST

Any "no" is a defect, not a preference.

## Type and colour
- [ ] No `@font-face`, no font CDN.
- [ ] `--mono` only on figures â never a heading, button, tag or label.
- [ ] `text-transform:uppercase` only on the classification chip, code tags, tier labels, printed
      headings and deck eyebrows.
- [ ] No hue outside: neutral greys, one accent, four severity colours, two delta colours,
      annotation gold, scan blue.
- [ ] No gradient; no `box-shadow` on a non-floating element; no `border-radius` > 2px.

## Layout
- [ ] At 1280Ã720 no pane is clipped and no text wraps inside a control.
- [ ] `elementFromPoint` on every map-header control returns that control (nothing under glass).
- [ ] Zero `.statusbar .cell` and zero `.timestrip .head` children with
      `scrollHeight > clientHeight`.
- [ ] Every scrollable pane scrolls.
- [ ] Minimising either Situation panel reflows the map fit and all overlays.
- [ ] `elementFromPoint` at the deck stage centre returns the slide, not the stage.

## Behaviour
- [ ] Zoom in / out / recentre / fit change `svg.__zoom.k` **within 100ms** â test with animation
      frames throttled. `flyTo` and `ping` work with rAF disabled.
- [ ] Filter counts agree across layer panel, legend, pane header, histogram and exports.
- [ ] A signal selected anywhere opens in map, dossier, replay, reader, generator and case.
- [ ] Selecting a signal or track un-minimises the inspector **and** renders the interrupt,
      presence, assignment and discussion. Clearing the selection keeps the interrupt.
- [ ] No `prompt` / `confirm` / `alert` anywhere; every create flow uses an inline field.
- [ ] Closing the last tab reopens Situation. A module switch alone creates no tab.
- [ ] Watch shows 9 rail buttons, Workstation 4 â **verified after navigating** â and no flash of
      the wrong rail on first paint.
- [ ] Switching sessions restores window, floor, layers, projection, map position, tabs and basket.
- [ ] Dragging a rail icon reorders it, persists across reload, and never hangs the page â test
      with a deliberately partial stored `railOrder`.
- [ ] Palette: `sig:hormuz` filters to signals; `636020918` finds a vessel by MMSI;
      `@26.57, 56.25` offers a coordinate jump; a city name returns gazetteer **and** live
      geocoder rows; the geocoder failing leaves the palette usable.
- [ ] The alert editor previews the rule as prose and lists what would fire.
- [ ] CSV row count equals `visible().length`; GeoJSON parses and contains `observation-area`,
      `annotation` and `signal` features. Draw an annotation, export again, and it appears.
- [ ] The time cursor reduces the visible count monotonically and returns to live in one click.
- [ ] Clustering hides markers below the threshold and clears above it.
- [ ] A drawn scan box of ~2000 Ã 1500 km reports an area consistent with its extent (not
      ~504,470,700 kmÂ²); `HWmap.invert` returns `null` off-globe and drawing there warns.
- [ ] `run scan now` produces a scene, routes to Imagery, and findings read as interpretations
      ("Increased port activity"), never raw counts.
- [ ] Generating with an empty set warns; with 12 signals it produces a 4-page document in ~4.6s
      and lands in the reader; the generator never wedges on a repeat run.
- [ ] Reader references drive both the context minimap and the right pane; a long reference
      **wraps**; `animate lead-up` plays.
- [ ] Deck builds 12 slides; Present strips chrome; `pdf` yields one slide per landscape sheet.
- [ ] Ontology node positions are byte-identical 1.2s after layout; zero plate overlaps.
- [ ] Imagery: swipe handle drags; boxes track the frame at any size; deriving coverage inserts
      `proposed` areas that promote on accept.
- [ ] An `analyst` cannot advance an approval stage and is told why.
- [ ] `raise signal` from mail creates a triageable signal and marks the thread parsed.
- [ ] An @mention notifies the named user and lands in their Mentions queue.
- [ ] With no Gmail client ID a send queues at `delivered: 0` and the UI says it is offline.
- [ ] Distribute resolves lists plus ad-hoc addresses, de-duplicates, and issues the briefing.
- [ ] All nine settings tabs render; tutorial navigation works; the shortcut tables list every
      binding that actually exists.
- [ ] Full screen toggles and the map re-fits afterwards.
- [ ] Corrupt or partial `localStorage` falls back to seeds with a warning and never blocks boot.
- [ ] Console clean after visiting every module.

## Mobile
- [ ] The map is a grid child with no overlap of header or tab bar.
- [ ] Every interactive element measures â¥44px in both axes, including the dismiss-all and the
      map-card close.
- [ ] All five tabs render real content with the app offline (Map degrades with a message).
- [ ] A long Brief reference wraps to two lines with zero horizontal overflow.
- [ ] A reference carried from Brief or Map survives into the Desk form's reference select.
- [ ] The counter-scale survives a filter-triggered redraw at k > 1.

## Credibility
- [ ] Sample data labelled in the status bar.
- [ ] At least one capability honestly unavailable rather than faked.
- [ ] Every number rendered is computed from the corpus â no hard-coded totals in markup.
- [ ] Prose contains no em dashes, no emoji, no marketing adjectives.

---

# PART 14 Â· DELIBERATE CHOICES â DO NOT "FIX" THESE

**From V2**
- **Desktop only.** No breakpoints below 1280px; this is a workstation.
- **Domains carry no colour.** Code tags and position distinguish them. This is the single biggest
  reason the interface reads as professional.
- **Only four severity colours**, reused by change detection. A fifth destroys the hierarchy.
- **Reading a signal marks it acknowledged.** Triage is a side effect of attention.
- **The generator takes ~4.6 seconds.** Latency is information.
- **The briefing is serif on paper stock.** It is a document, not a screen.
- **The ontology never animates into place.** Analysts memorise spatial position; drift destroys it.
- **Glass is used once, on side panels only**, so the map reads as one continuous surface.
- **No dark/light theme toggle** for the console. One considered surface beats two mediocre ones.
- **The commercial EO feed stays unavailable**, which is what makes the satellite tasking layer
  honestly unavailable rather than an empty stub.
- **Archived scan passes do not fake imagery.** Clicking one says the imagery is not cached.

**Added in V3**
- **Workstation is a mode, not a module group.** Tabs are records, the rail is the lens, the mode
  decides which lens set exists. Showing all sixteen modules at once undoes it.
- **Sessions and views are different things.** A session is a desk; a view is a filter preset
  inside one. Merging them loses the ability to look at the same desk two ways.
- **The alert editor shows matches before you save.** A builder that cannot tell you what would
  fire is a form, not a tool.
- **A message matching no inbound rule stays in the inbox.** Nothing is discarded; nothing becomes
  a signal without an auditable rule.
- **A send with no mail connection queues at `delivered: 0`.** Never claim a delivery you cannot
  perform.
- **The deck's bottom line goes second.** Executives get the judgement before the evidence.
- **The deck has a light theme; the console does not.** A lit room is a different problem.
- **Scan blue and annotation gold never blur.** One is a tasking instruction, the other an
  analyst's note.
- **Roles refuse with an explanation, never a hidden control.**
- **Only three localStorage keys.** Never touch anything else; always fall back to seeds.
- **The phone companion is not the console.** It does five jobs. Adding modules to it, or making
  the console responsive to phone width, breaks both.
- **Extend through hooks, never by wrapping an export.** Â§2.2.

---

# PART 15 Â· NOT BUILT

Recorded so the difference between a gap and a decision stays legible.

## 15.1 Footage verification

Automatic retrieval is easy; automatic **verification** is not, and that distinction is what makes
the feature honest.

**Sources, best first:**
1. **Your own sensors** â site CCTV, convoy dashcams, drone over RTSP/ONVIF, clipped around an
   event timestamp. Fully automatic and **you own the provenance**. Strongest by a distance.
2. **Broadcast monitoring vendors** â APIs that record state and regional broadcast 24/7 and let
   you query by place and time. Licensed, timestamped, citable.
3. **Wire agency video APIs** â Reuters Connect, AP Video Hub. Real provenance and licensing.
4. **Platform APIs** â queryable by keyword and publish time. Automatable, but every result is an
   **unverified candidate, never evidence**.
5. **OSINT aggregators** that already geolocate and verify, exposed by API.

**Architecture:** a candidate queue with a state machine â
`retrieved â deduplicated â geolocation inferred â analyst verified | rejected` â and a
**chain-of-custody record**: source URL, retrieval time, uploader, claimed location, file hash,
who verified, what corroborated it.

**Automatable verification signals, in order of value:**
1. **Perceptual hashing** against a seen-clip database â catches recycled footage, by far the most
   common failure mode
2. Reverse image search on keyframes for earliest appearance
3. **Sun azimuth and shadow length** against claimed time and place â cheap, decisive, rarely
   faked correctly
4. Weather cross-check against reanalysis data
5. **Landmark matching against satellite imagery** â ties straight into Â§4.7

**UI form:** a candidate queue in Imagery, plus verified clips attached to a signal or scene.
**Embedded news-channel feeds are not this.** A hardcoded video wall reads consumer and ages
badly. The professional form is a source plus a verification queue.

## 15.2 Tablet floor

Drop the console minimum from 1280 to 1024 for 11â³ iPad landscape, without touching the layout
above 1280.

## 15.3 Calendar write-back

The Google Calendar scope is requested and the day column reads a static list; scheduled scans and
RFI due dates do not yet create events.

## 15.4 Attachment preview

Mail attachments list correctly but do not open; PDF text-layering is specified in Â§7.9 and not
implemented.

## 15.5 Real WebSocket presence

Presence is currently derived deterministically from the record reference; Â§9.5 lists the event.

## 15.6 RSS estate

Â§9.4a and Â§9.4b specify the geolocation and triage pipelines for a large feed estate. Neither is
implemented; the corpus is authored.
