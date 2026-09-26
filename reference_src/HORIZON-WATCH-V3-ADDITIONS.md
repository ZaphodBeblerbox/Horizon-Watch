# Horizon Watch â What Changed in V3
### Everything added since V2, with the reasoning and the traps

V2 was a **nine-module analysis console**: Situation, Signals, Dossiers, Analytics, Generate,
Replay, Ontology, Imagery, Briefings.

V3 is a **fourteen-module, two-mode workstation** an analyst never has to leave. This document
covers only what is new. For the complete build spec see `HORIZON-WATCH-MANUAL.md`.

> **Palette note.** The console runs its own dark intelligence palette by explicit user
> direction rather than the Muzzo brand system. Muzzo remains correct for marketing surfaces;
> a 12.5px dark ops console with severity-encoded colour is a different problem from a
> cream-and-navy landing page.

---

## New files

```
hw-data3.js    identity, mail, cases, RFIs, comments, notifications, approvals, handovers
hw-y.js        sessions Â· palette v2 Â· views Â· alert rules Â· exports Â· related records
               Â· time cursor Â· clustering Â· scan history Â· appendix Â· settings Â· fullscreen
hw-w.js        Workstation mode Â· My work Â· Mail Â· Cases Â· Team Â· comments Â· assignment
               Â· presence Â· RFIs Â· approval chain Â· handover Â· urgent interrupt
hw-gmail.js    real Gmail OAuth client + distribution recipient book
hw-deck.js     presentation generator
HorizonWatchMobile.html + hw-mobile.js    phone companion
```

Load order gains four entries after `hw-x.js`:

```html
<script src="hw-y.js"></script>
<script src="hw-w.js"></script>
<script src="hw-gmail.js"></script>
<script src="hw-deck.js"></script>
```

`hw-data3.js` loads with the other corpus files, before `hw-app.js`.

---

# 1 Â· WORKSTATION â a mode, not more modules

The single biggest structural change.

| Mode | Modules |
|---|---|
| **Watch** | Situation Â· Signals Â· Dossiers Â· Analytics Â· Generate Â· Replay Â· Ontology Â· Imagery Â· Briefings |
| **Workstation** | My work Â· Mail Â· Cases Â· Team |
| Hidden, reached from the briefing surface | Print layout Â· Deck |

Sessions, filters and the briefing basket carry across both. `W` toggles, `G` jumps to My work.
The mode control sits at the **left of the tab strip** with a `WATCH` / `WORK` chip.

**Why a mode and not thirteen rail icons.** Thirteen peers is a menu, not a tool. Analysis and
coordination are different postures with different attention: one is spatial and exploratory,
the other is queue-driven and social. The rail is the *lens*; the mode decides which lens set
exists.

### 1.1 Tabs became record-scoped

V2 spawned a tab on every module switch, which duplicated the rail â the redundancy the user
flagged. Now:

```js
function openModule(id, label) {
  if (label) {                              // only a labelled RECORD makes a tab
    let t = S.tabs.find(t => t.mod === id && t.kind === 'record');
    if (!t) { t = {id:'T'+Date.now().toString(36), mod:id, label, kind:'record'}; S.tabs.push(t); }
    else t.label = label;
    S.tab = t.id;
  }
  S.module = id;
}
```

Each session owns one `kind:'base'` tab named after the session, plus record tabs
(`Dossier Â· Red Sea corridor`, `BRF-0436 Â· Weekly exposure review`, `Case Â· RED-SEA-Q3`).

### 1.2 Identity and roles

Eight seeded users. Roles carry **real** capability, not decoration:

| Role | Can |
|---|---|
| Group security lead | approve Â· issue Â· assign Â· brief Â· admin |
| Senior analyst | assign Â· brief Â· review |
| Analyst | brief |
| Regional lead | answer Â· brief |
| Imagery analyst | confirm Â· brief |

Gate every privileged action with `can('approve')` and **refuse with a toast, never a hidden
control** â a disabled-and-explained button teaches the permission model; a missing button
teaches nothing. Click the top-bar avatar to switch or create a user.

### 1.3 The reference grammar

One string form ties the whole system together. This is what makes *any* record commentable,
assignable, attachable and citable:

```
sig:HW-2400 Â· ent:ENT-RS-01 Â· onto:N02 Â· scn:SCN-4471 Â· aoi:AOI-14
brf:BRF-0431 Â· case:CS-0014 Â· mail:M-1042 Â· rfi:RFI-021
```

`HWref.open(ref)` switches mode if needed and navigates. `HWref.label(ref)` resolves a title.

### 1.4 My work

The *what do I do today* screen. Seven queues: assigned to me Â· mentions Â· RFIs to answer Â·
my cases Â· awaiting my review Â· urgent mail Â· unreviewed signals. Scope segment
`mine / team / unassigned`. The right column carries the day â calendar, due dates, scheduled
scans, recent team activity.

### 1.5 Cases

A case bundles signals, dossiers, ontology objects, scenes, areas and mail under one owner with
priority, status, due date, discussion, timeline and five tabs. `brief this case` pushes its
signals into the generator.

**This is what turns fourteen modules into one job.** Without it, cross-module links are
navigation; with it they are a body of work with an owner and a deadline.

Approval chain: `draft â review â approved â issued`, role-gated, each step stamped with who
and when.

### 1.6 Collaboration primitives

All four are injectable into any record, and all four are used by the Situation inspector:

```js
window.HWcomments.inject(box, ref);   // discussion + @mention autocomplete
window.HWassign.inject(box, ref);     // owner, due date, reassign, mark done
window.HWpresence.inject(box, ref);   // who else has this record open
window.HWinterrupt.inject(box);       // the urgent block
```

- **Comments** â real @mention autocomplete (`ArrowUp/Down`, `Enter`, `Tab`, `Escape`;
  `ââµ` sends) that notifies the mentioned user and lands in their Mentions queue.
- **RFIs** â raised against a case, tracked to closure, answerable only by the recipient.
- **Handover** â generated from what actually changed during the shift (what you acknowledged,
  escalated, briefed; what you left open; what to watch for) plus a free note.

### 1.7 The urgent interrupt

The user's requirement: *urgent mail and messages should pop up in the inspector.*

Urgent mail, mentions and overdue RFIs prepend a red **Needs you** block to the Situation
inspector, alongside a toast on arrival and rail badges. Dismissals persist so a cleared item
does not return.

An analyst working the map does not go looking for their inbox â the inbox reaches them.

---

# 2 Â· SESSIONS, VIEWS AND THE WORKSPACE LAYER

### 2.1 Sessions

A session is a **whole desk**: `win`, `sevFloor`, `domains`, `ctx`, `proj`, the map `transform`,
its `tabs`, `basket` and `views`. Switching restores all of it.

Seeded: **Global watch** (72h, all layers, world) Â· **Red Sea corridor** (7d,
maritime/conflict/energy, emea, floor moderate) Â· **Baltic & Nordics** (30d,
cyber/conflict/political, emea) Â· **Indo-Pacific** (7d, maritime/conflict/trade, apac).

The user's framing was exact: *in one session one region matters, in another a different one.*
A filter set is not a workspace â the map position, open records and briefing basket are part
of the thought.

### 2.2 Views

A **view** is a named filter preset *inside* a session â window, severity floor, layers,
projection. Sessions are where you work; views are how you look. They sit in a `Views` group at
the top of the Situation layer panel.

Keeping them separate is deliberate: merging them loses the ability to look at the same desk
two ways.

### 2.3 Reorderable rail and tabs

Both use one `makeSortable(container, itemSel, onOrder)` helper on HTML5 drag events. Rail order
persists globally; tab order per session.

### 2.4 Palette v2

Fourteen indexed kinds â `MODULE SESSION VIEW SIGNAL DOSSIER OBJECT PLACE VESSEL AIRCRAFT AREA
SCENE BRIEFING LOC COORD`.

- **Scope prefixes**: `sig: ent: obj: loc: aoi: scn: trk: brf: view:` with a chip bar; `Tab` cycles.
- **Coordinates**: decimal (`26.5, 56.25`, optional `@`) and DMS (`26Â°30'N 56Â°15'E`), range-
  validated, pinned to the top, flies the map and pings.
- **Locations**: a ~90-place offline gazetteer built from infrastructure, reported places,
  imagery scenes and a chokepoint list, **plus** live Nominatim geocoding debounced at 340ms with
  a sequence guard so out-of-order responses are discarded. Failure is silent and the gazetteer
  still answers.
- **Ontology objects are indexed by property**, so `636020918` finds a hull by its MMSI.
- **Pinned and recent** groups when the query is empty.

### 2.5 Alert rules

Fields Severity / Domain / Region / Country / Source / Confidence, ANDed, action
`notify / escalate / brief`. A live preview renders the rule as prose â *"when severity is at
least Critical and domain is Maritime & chokepoints â notify"* â **and lists every matching
signal in the loaded corpus before you save.**

A builder that cannot tell you what would fire is a form, not a tool.

### 2.6 Real exports

| Export | Contents |
|---|---|
| Signals CSV | current filter only, 15 columns, RFC-4180 quoting |
| Geometry GeoJSON | observation areas (Polygon where drawn, else Point), annotations, signal points, each with a `kind` |
| Ontology JSON | all nodes and links with confidence and basis |

**Read `window.HWann`, not `X.annotations`** â the latter is only the seeds, so an analyst's
drawn annotations silently never exported. This was a shipped bug.

### 2.7 Related records

`relatedFor(signal)` groups by geographic and semantic proximity: signals within 800km,
dossiers within 1400km, ontology objects matching place/country/ISO3 in their properties,
imagery scenes within 900km, observation areas within 900km, infrastructure within 400km, live
tracks within 600km, and **alert rules that would fire on this signal**.

The answer to "what else touches this?" in one place, injected as a card into the inspector.

### 2.8 Global time cursor

A 26px bar under the density histogram. It writes `S.tCut` (epoch ms cap, `null` for live) and
the **single** visibility selector honours it, so map, legend, inspector, histogram and exports
all agree:

```js
visible = () => events.filter(e =>
  e.hoursAgo <= S.win && S.domains.has(e.domain) &&
  SEVERITY[e.severity].rank >= S.sevFloor &&
  (!S.tCut || e.ts.getTime() <= S.tCut));
```

Replay studies the sequence; the cursor answers *"what did we know at 0400Z?"* in place.

### 2.9 Marker clustering

Below `settings.clusterAt` (default 2Ã), markers hide and signals bin into 46px screen cells:
one bubble per cell, radius `9 + min(11, n*1.6)`, stroke = the **worst** severity in the cell.
Click flies to the centroid at `clusterAt + 1`.

### 2.10 Settings â nine tabs

| Tab | Contents |
|---|---|
| **General** | clustering + threshold, marker labels, live address lookup, gazetteer size, workflow toggles |
| **Tutorial** | sixteen numbered steps, each with an `open <module> â` button; plus a *Reading the interface* section explaining the diamond, the colour discipline, and that gold means an analyst drew it while blue means a tasking instruction |
| **Shortcuts** | six tables, ~34 rows, keys as `<kbd>` |
| **Sessions & views** | every session with its state summary and a switch button; views with apply |
| **Alert rules** | all rules as prose with active/off tags, and a route into the editor |
| **Export** | the three exports with live row counts, plus how to get a PDF |
| **Distribution** | the recipient book (Â§4.2) |
| **Mail & calendar** | the Gmail connector (Â§4.1) |
| **Users & roles** | all users, create/switch, and the role capability matrix |
| **Data sources** | eight feeds with state and time since last message, plus the three detection models |
| **About** | build, corpus counts, basemap provenance, data-handling note |

### 2.11 Full screen

`#btn-full` with an icon swap to `i-full-exit`, bound to `F`, re-fitting the map 120ms after
`fullscreenchange`. A blocked request toasts rather than failing silently.

---

# 3 Â· DRAW-TO-SCAN

Two tools in the map header: `scanbox` (press-drag a rectangle) and `scanpoly` (click corners,
double-click to close). The top-bar AOI button arms the box tool instead of claiming the feature
is unavailable.

Committing slides in a **322px glass panel** from the right edge of the map (`z-index:6`, 260ms):
metric ledger (kmÂ², vertices, archive tiles `ceil(areaKmÂ²/12100)`, revisit), a name pre-filled
from the nearest infrastructure within `max(30km, boxWidth)`, area class (which **re-seeds the
detection classes** from `CLASS_PRESETS`), sensor, a 13-class grid, confidence floor, recurring
cadence, centroid and extent.

- **`run scan now`** sweeps a line down the bounds in 26 steps Ã 90ms, logs six detector stages,
  synthesises a scene, interprets the movers, and routes into Imagery.
- **`save for recurring`** writes an AOI with the drawn polygon, classes, confidence, sensor and
  cadence. It appears first in the rail with a `â»` and its polygon persists on the map â hover
  for the tasking summary, click to open its latest scene.

Scan geometry is **blue** `#5f95d0` (a tasking instruction), distinct from annotation **gold**
`#c8a04a` (an analyst's note). Two vocabularies that must never blur.

### 3.1 Two geometry bugs worth the ink

**Ring winding.** `d3.geoArea` and `d3.geoPath` read a ring's winding to decide which side is
inside. A wrongly-wound ring measures the **complement of the sphere** â a drawn box reported
`504,470,700 kmÂ²`. Drag order and free-hand click order are both arbitrary, and a shoelace sign
test is not sufficient. Pick empirically, since any AOI is far smaller than half the sphere:

```js
const ringArea = pts => d3.geoArea({type:'Polygon',coordinates:[pts.concat([pts[0]])]});
function normalizeRing(pts){
  if (pts.length < 3) return pts;
  if (ringArea(pts) <= 2*Math.PI) return pts;
  const r = pts.slice().reverse();
  return ringArea(r) <= 2*Math.PI ? r : pts;
}
```

Apply to the live drag preview **and** on commit, so preview and measurement agree.

**Off-globe inversion.** `projection.invert()` happily returns latitudes beyond Â±90 for a point
outside the projected globe, silently corrupting every downstream measurement:

```js
invert(clientX, clientY){
  const r = $('#mapsvg').getBoundingClientRect();
  const p = projection.invert(zt.invert([clientX-r.left, clientY-r.top]));
  if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
  if (p[1] > 90 || p[1] < -90 || p[0] > 180 || p[0] < -180) return null;
  return p;
}
```

Handlers then warn (*"Start the box inside the mapped area"*) instead of producing nonsense.

---

# 4 Â· MAIL

### 4.1 Gmail is a real OAuth client

`hw-gmail.js` is **not a mock**. Supply a Google Cloud OAuth 2.0 **Web application** client ID in
Settings â Mail & calendar, enable the Gmail API, and add the page origin to the client's
authorised JavaScript origins. It then signs in through Google Identity Services and calls the
Gmail REST API from the browser:

```
messages.list?maxResults=25&q=<configurable query>
messages.get?format=full   â base64url decode, MIME walk for text and attachments
messages.send              â RFC 2822 raw payload, base64url encoded
profile                    â account, message total
```

Scopes: `gmail.readonly gmail.send gmail.labels calendar.events`. Polling 30â600s.

**Without a client ID it runs the sample mailbox and says so.** A send with no connection queues
at `delivered: 0` rather than claiming delivery. Never claim a delivery you cannot perform.

**Inbound rules** â six, auditable, matched in order:

| Rule | Match | Sets |
|---|---|---|
| Partner corridor bulletins | from contains marinerisk | domain=maritime Â· source=PARTNER-FEED Â· severity from subject |
| Government advisories | from ends gov.uk OR state.gov | domain=political Â· source=GOV-ADVISORY Â· conf=0.78 |
| AIS gap alerts | subject starts "AIS gap" | domain=maritime Â· attach vessel by MMSI Â· severity=high |
| Field reports | from sahel-security.example | domain=conflict Â· source=FIELD-REP Â· geocode from body |
| Scene delivery notices | from copernicus.example | route to imagery Â· no signal raised |
| Urgent on keyword | subject contains URGENT | flag urgent Â· notify duty analyst Â· interrupt inspector |

**A message matching no rule stays in the inbox** for an analyst to raise by hand. Nothing is
discarded, and nothing becomes a signal without a rule that can be read and audited.

`raise signal` builds a real `Signal` from a thread and pushes it into triage.

**Outbound** â five channels: per-recipient-timezone digests (0600 local reaches Lisbon and
Singapore at 0600 local, not 0600 UTC), throttled alerts (first match immediate, later matches
folded into one follow-up), briefing distribution, imagery findings, duty-of-care check-ins.
Delivery receipts with open rates.

### 4.2 Briefing distribution

Recipients are **data, not hard-coded strings**. A recipient book of five lists plus ad-hoc
addresses lives in `localStorage`, is editable in Settings â Distribution, and is read by **one**
picker reachable from three places: the reader toolbar, the generator footer, and the print view.

The picker resolves and de-duplicates the address set, shows the count before sending, composes
a covering summary from the document object, and **on send advances the approval chain to
`issued`** with a stamped chain entry.

---

# 5 Â· THE PRESENTATION GENERATOR

A deck is the **third rendering** of the briefing document object, alongside the interactive
reader and the printable pages. All three read the same object, so a slide can never say
something the document does not.

```
Generator âââ¶ doc { meta, sel, crit, high, regions, domains }
                     â
        ââââââââââââââ¼âââââââââââââ
        â¼            â¼            â¼
     Reader        Print         Deck
   (rail dest.)   (a view)     (a view)
```

Entry points: reader toolbar, print view, and the generator footer once a run completes.
Authored at 1920Ã1080 and scaled to fit. Slide rail, scrub bar, dark/light switch,
**Present** (full-screen, chrome stripped, arrows/space/Home/End, Esc out), and `pdf` which lays
every slide into the flow for one landscape sheet each.

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

**Deck editorial judgement.** Bottom line goes **second**, not last â executives get the
judgement before the evidence. Only criticals get map labels: a slide is not an inspector. The
sourcing slide exists to be held back unless challenged, and its speaker note says so.

**Speaker notes are generated from the same fields the slide uses**, so a note can never
describe a slide that changed. Each carries a delivery cue â *"Expect the interruption here,
have the number ready"* on exposure; *"Do not advance until line one has an answer"* on actions.

### 5.1 The fixed-size-child trap

The slide is 1920px wide. Placed as a **grid item**, the implicit `auto` track sizes to its
1920px max-content, and `place-items:center` then centres it *inside that 1920px track* â putting
it ~960px right of the stage and clipped out of view at every viewport width.

```css
.stage{flex:1;min-height:0;position:relative;display:block;padding:18px;overflow:hidden}
.slidewrap{position:absolute;top:50%;left:50%;width:1920px;height:1080px;transform-origin:center center}
```
```js
// the whole transform in one write â a scale-only write drops the centring translate
wrap.style.transform = 'translate(-50%,-50%) scale(' + Math.min(w/1920, h/1080) + ')';
```

Verify with `elementFromPoint` at the stage centre, not by checking the node exists.

---

# 6 Â· MOBILE COMPANION

`HorizonWatchMobile.html` + `hw-mobile.js`, sharing `hw-data.js` and `hw-data2.js`.

**Not a responsive console.** The console stays desktop-only (floor 1280px). This is a separate
surface for an on-call security lead doing **four jobs well** rather than fourteen badly.

390Ã844 in a phone bezel using `ios_frame` geometry as plain CSS â bezel radius 48px, island
126Ã37 at top 11, home indicator 139Ã5. No React/Babel: three more CDN loads on an already
fragile path was the wrong trade.

| Tab | Behaviour |
|---|---|
| **Alerts** | Escalations + critical/high with an unactioned badge. Filters *needs action / escalated / critical / all*. Tap â bottom sheet with assessment, `.kv`, corroboration count, then Acknowledge Â· Escalate Â· Show on map Â· Note to desk. Acknowledged rows drop to 55% opacity rather than vanishing, so the queue reads as worked |
| **Brief** | The briefing at phone measure (15px/1.68) with references live |
| **Map** | Natural Earth geometry, severity diamonds, AIS hulls and ADS-B airframes rotated to heading, filter chips, tap â bottom card |
| **Note** | Press-and-hold voice note with live timer and waveform, written note, routing, attachable reference, outbox `queued â sent` |

Mobile deltas: body 15px not 12.5 Â· minimum target 46px Â· `:active` not `:hover` Â· detail as a
sheet not a side panel Â· 34px chips scrolling horizontally.

**Offline degradation is the point.** Libraries load **after** the app, asynchronously, with a 6s
timeout and three mirrors. **Only the Map tab may depend on d3** â Alerts and Brief use a plain
haversine and `reduce`-based helpers. `initMap()` shows *"Loading map geometryâ¦"* then either
draws or says *"Map geometry unavailable offline. Alerts, Brief and Note still work."*

---

# 7 Â· THE THREE TRAPS THAT COST SHIPPED BUGS

Recorded because each was invisible in code review and each has a general form.

### 7.1 Animation frames are not guaranteed

`requestAnimationFrame` never fires in a throttled, backgrounded or embedded frame. **d3
transitions are rAF-driven**, so every `.transition()` silently becomes a no-op: zoom buttons do
nothing, pings never expand, layouts never fit.

```js
let rafOK = null;
(function probeRaf(){ let fired=false;
  requestAnimationFrame(()=>{fired=true;rafOK=true});
  setTimeout(()=>{ if(!fired) rafOK=false }, 260); })();

function applyZoom(t, ms){
  if (rafOK && ms) svg.transition().duration(ms).call(zoom.transform, t);
  else svg.call(zoom.transform, t);          // synchronous fallback â always works
}
```

Pulses use stepped timers with hand-rolled cubic easing. Layout deferral uses
`setTimeout(fn, 0)` with a bounded retry (20 Ã 50ms), never rAF.

### 7.2 Never patch what the owner re-creates or never reads

**Two bugs, one mistake.**

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

Apply the class **synchronously** at boot â deferring shows a flash of the wrong rail. And guard
the `onModule` hook with a `switching` flag: `setMode()` calls `HWopen()`, whose hook corrects
mode drift, and without the flag the two fight and the mode flips back.

*Wrapped `SH.renderInspector`.* `hw-app.js` calls its own module-local `renderInspector()` from
`selectEvent()`, the close handler and the map-background click. Reassigning the **export** never
rebinds those, so the interrupt, assignment, discussion and presence vanished the moment a signal
was selected. Fix: the owner fires a hook from inside its own body.

```js
function renderInspector(){ /* both branches */ fireInspector(); }
function fireInspector(){
  (window.HWinspectorHooks||[]).forEach(fn=>{
    try{ fn($('#inspector'), S.sel) }catch(e){ console.error(e) } });
}
```

Anything else that writes the inspector â `selectTrack` in `hw-x.js` â must fire the hook too.

**General rule: if an extension needs to inject into a surface, the surface publishes a hook.
A wrapper works only while nothing internal calls the original.**

### 7.3 A fixed-size child must never size a layout track

See Â§5.1. The general form: any element with a hard pixel dimension larger than its container
must be taken **out of flow** before it can participate in a grid or flex track.

---

# 8 Â· NEW GLOBALS

| Global | Owner | Purpose |
|---|---|---|
| `HW3` | data | identity, mail, cases, RFIs, comments, approvals |
| `HWinspectorHooks[]` | app | `(box, sel)` â **the** inspector extension point |
| `HWP2` | hw-y | palette v2 â `open()`, `close()` |
| `HWsession` | hw-y | `apply(id)`, `capture()`, `current()` |
| `HWalerts` | hw-y | `open(entity?)`, `rules()`, `matches(rule, signal)` |
| `HWexport` | hw-y | `signals()`, `geo()`, `onto()` |
| `HWrelated` | hw-y | `inject(box, signal)`, `for(signal)` |
| `HWhistory` | hw-y | `inject(host, aoi)` |
| `HWappendix` | hw-y | `page(doc)` â briefing page 4 |
| `HWsettings` | hw-y | `open(tab)`, `rerender()`, `isOpen()` |
| `HWwork` | hw-w | `T`, `setMode`, `openWho`, `openHandover`, `openRFI`, renderers |
| `HWref` | hw-w | `open(ref)`, `label(ref)`, `icon(kind)` |
| `HWcomments` `HWassign` `HWpresence` `HWinterrupt` `HWcase` | hw-w | injectable primitives |
| `HWann` | hw-x | the **live** annotation array (not `X.annotations`) |
| `HWXaoi` | hw-x | observation-area registry |
| `HWMdoc` | modules | the loaded briefing document |
| `HWgmail` | hw-gmail | `connect, sync, send, openDistribute, BOOK` |
| `HWdeck` | hw-deck | `open(doc), show(i), fit()` |

**Storage keys â three, and only three:** `horizonwatch.workspace.v1`,
`horizonwatch.workstation.v1`, `horizonwatch.gmail.v1`. Never touch anything else, and always
fall back to seeds on corrupt state.

---

# 9 Â· NEW KEYS

| Key | Action |
|---|---|
| `W` | toggle Watch â Workstation |
| `G` | go to My work |
| `Tab` | cycle palette scope |
| `@` | mention someone in a comment |
| `ââµ` | send a comment |
| `F` | full screen |
| `?` | shortcuts |
| `â â Space Home End` | deck navigation |

---

# 10 Â· V3 ACCEPTANCE ADDITIONS

Everything in the V2 checklist, plus:

- [ ] Switching sessions restores window, floor, layers, projection, map position, tabs and
      basket â verify 72h/world/7-layer â 168h/emea/3-layer/floor-2.
- [ ] A module switch alone creates no tab; only a labelled record does.
- [ ] Watch shows 9 rail buttons, Workstation 4 â **verified after navigating**, and no flash of
      the wrong rail on first paint.
- [ ] Dragging a rail icon reorders it, persists across reload, and never hangs the page â test
      with a deliberately partial stored `railOrder`.
- [ ] Palette: `sig:hormuz` filters to signals; `636020918` finds a vessel by MMSI;
      `@26.57, 56.25` offers a coordinate jump; a city name returns gazetteer **and** live
      geocoder rows; the geocoder failing leaves the palette usable.
- [ ] Select a signal: interrupt, presence, assignment and discussion all render. Clear the
      selection and the interrupt is still there. Select a live track: the interrupt renders too.
- [ ] The alert editor previews the rule as prose and lists what would fire.
- [ ] CSV row count equals `visible().length`; GeoJSON parses and contains
      `observation-area`, `annotation` and `signal` features. Draw an annotation, export again,
      and it appears.
- [ ] The time cursor reduces the visible count monotonically and returns to live in one click.
- [ ] Clustering hides markers below the threshold and clears above it.
- [ ] A drawn scan box of ~2000 Ã 1500 km reports an area consistent with its extent (not
      ~504,470,700 kmÂ²); `HWmap.invert` returns `null` off-globe and drawing there warns.
- [ ] `run scan now` produces a scene, routes to Imagery, and findings read as interpretations
      ("Increased port activity"), never raw counts.
- [ ] An `analyst` cannot advance an approval stage and is told why.
- [ ] `raise signal` from mail creates a triageable signal and marks the thread parsed.
- [ ] An @mention notifies the named user and lands in their Mentions queue.
- [ ] With no Gmail client ID a send queues at `delivered: 0` and the UI says it is offline.
- [ ] Distribute resolves lists plus ad-hoc addresses, de-duplicates, and issues the briefing.
- [ ] Deck builds 12 slides; `elementFromPoint` at the stage centre returns the slide; Present
      strips chrome; `pdf` yields one slide per landscape sheet.
- [ ] All nine settings tabs render; tutorial navigation works; the shortcut tables list every
      binding that actually exists.
- [ ] Corrupt or partial `localStorage` falls back to seeded state with a warning and never
      blocks the shell.

---

# 11 Â· NEW DELIBERATE CHOICES

- **Workstation is a mode, not a module group.** Tabs are records, the rail is the lens, the mode
  decides which lens set exists. Showing all fourteen modules at once undoes it.
- **Sessions and views are different things.** A session is a desk; a view is a filter preset
  inside one. Merging them loses the ability to look at the same desk two ways.
- **The alert editor shows matches before you save.**
- **A send with no mail connection queues at `delivered: 0`.**
- **A message matching no inbound rule stays in the inbox.** Nothing is discarded; nothing
  becomes a signal without an auditable rule.
- **Archived scan passes do not fake imagery.** Clicking one says the imagery is not cached
  rather than showing the current scene twice.
- **The commercial EO feed stays unavailable**, which is what makes the satellite tasking layer
  honestly unavailable rather than an empty stub.
- **The deck's bottom line goes second.**
- **The deck has a light theme; the console does not.** A lit room is a different problem.
- **Scan blue and annotation gold never blur.** One is a tasking instruction, the other an
  analyst's note.
- **The phone companion is not the console.** It does four jobs.

---

# 12 Â· STILL NOT BUILT

Recorded so the difference between a gap and a decision stays legible.

1. **Footage verification pipeline.** Automatic retrieval is easy; automatic *verification* is
   not, and that distinction is what makes the feature honest. Sources, best first: your own
   sensors (site CCTV, convoy dashcams, drone over RTSP/ONVIF â you own the provenance);
   broadcast monitoring vendors searchable by keyword, place and time; wire agency video APIs;
   platform APIs, whose results are **unverified candidates, never evidence**; OSINT aggregators
   that already geolocate.

   Architecture: a candidate queue with a state machine â
   `retrieved â deduplicated â geolocation inferred â analyst verified | rejected` â and a
   chain-of-custody record (source URL, retrieval time, uploader, claimed location, file hash,
   who verified, what corroborated it).

   Automatable verification signals: perceptual hashing against a seen-clip database (catches
   recycled footage, by far the most common failure), reverse image search on keyframes for
   earliest appearance, sun-angle and shadow-azimuth against claimed time and place, weather
   cross-check, and landmark matching against satellite imagery â which ties straight into the
   change-detection module.

   **Embedded news-channel feeds are not this.** A hardcoded video wall reads consumer and ages
   badly. The professional form is a source plus a verification queue.

2. **Tablet floor.** Drop the console minimum from 1280 to 1024 for 11â³ iPad landscape, without
   touching the layout above 1280.

3. **Calendar write-back.** The scope is requested and the day column reads a static list;
   scheduled scans and RFI due dates do not yet create events.

4. **Attachment preview.** Mail attachments list correctly but do not open; PDF text-layering is
   specified and not implemented.

5. **Real WebSocket presence.** Presence is currently derived deterministically from the record
   reference.
