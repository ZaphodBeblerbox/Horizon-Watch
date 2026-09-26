# Horizon Watch â Four Surfaces, Precisely
### Settings Â· Workstation & Sessions Â· Briefing Reader Â· Deck

Implementation instructions for the four surfaces most often got wrong. Every dimension, every
control, every behaviour, every string. Assumes the tokens and atoms from
`HORIZON-WATCH-COMPLETE-V2-TO-V3.md` Parts 1 and 10.

Token quick-reference used throughout:

```css
--bg-0:#171b20  --bg-1:#1c2127  --bg-2:#22282f  --bg-3:#2a3138  --bg-4:#333b43
--line:#30373f  --line-soft:#262c33  --line-strong:#3d454e
--txt:#d5dae0  --txt-2:#a4adb6  --txt-3:#818c96  --txt-4:#616b75
--acc:#3f6fa8  --acc-hi:#5f95d0
--red:#c4453c  --amber:#b7822c  --steel:#4f7fa6  --green:#4c7d63
--r:2px  --ease:cubic-bezier(.3,.7,.4,1)
--shadow:0 10px 26px rgba(0,0,0,.42),0 1px 3px rgba(0,0,0,.4)
```

---

# PART A Â· SETTINGS

## A.1 Markup

One scrim, one dialog, three regions. Lives at the end of `<body>`, before the palette.

```html
<div class="scrim" id="set-scrim">
  <div class="dlg" id="set-dlg" role="dialog" aria-label="Settings">
    <div class="panehead">
      <svg style="width:13px;height:13px;color:var(--txt-3)"><use href="#i-gear"/></svg>
      <h3>Settings</h3>
      <div class="right"><button class="btn ghost sm" id="set-close">â</button></div>
    </div>
    <div class="dlgbody" style="grid-template-columns:186px 1fr">
      <div class="arcol" id="set-nav"></div>
      <div class="arcol" id="set-body"></div>
    </div>
    <div class="dlgfoot">
      <span class="lbl" id="set-foot"></span>
      <button class="btn sm" id="set-reset" style="margin-left:auto">reset to defaults</button>
    </div>
  </div>
</div>
```

## A.2 CSS â exact

```css
.scrim{position:fixed;inset:0;background:rgba(12,15,18,.6);z-index:80;
  display:grid;place-items:start center;padding-top:12vh;
  opacity:0;pointer-events:none;transition:opacity .12s linear}
.scrim.open{opacity:1;pointer-events:auto}

.dlg{width:820px;max-width:94vw;background:var(--bg-1);border:1px solid var(--line-strong);
  box-shadow:var(--shadow);display:flex;flex-direction:column;max-height:76vh}
#set-dlg{width:900px;max-height:80vh}
.dlgbody{display:grid;grid-template-columns:286px 1fr;flex:1;min-height:0;
  background:var(--line-soft);gap:1px}          /* the 1px gap IS the divider */
.arcol{background:var(--bg-1);overflow:auto;min-height:0}
.dlgfoot{display:flex;align-items:center;gap:8px;padding:8px 10px;
  border-top:1px solid var(--line);background:var(--bg-2)}

.setnav{display:flex;align-items:center;gap:8px;width:100%;padding:8px 11px;text-align:left;
  color:var(--txt-3);border-bottom:1px solid var(--line-soft);font-size:12.5px}
.setnav:hover{background:var(--bg-2);color:var(--txt)}
.setnav[aria-selected=true]{background:var(--bg-3);color:var(--txt);
  box-shadow:inset 2px 0 0 var(--acc-hi)}
.setnav svg{width:13px;height:13px;flex:none;color:var(--txt-4)}
.setnav[aria-selected=true] svg{color:var(--acc-hi)}

.setsec{padding:14px 16px;border-bottom:1px solid var(--line-soft)}
.setsec>h4{margin:0 0 4px;font-size:12.5px;font-weight:600}
.setsec>p{margin:0 0 10px;font-size:12.5px;line-height:1.6;color:var(--txt-2);max-width:620px}
.setrow{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;
  padding:7px 0;border-top:1px solid var(--line-soft)}
.setrow:first-of-type{border-top:0}
.setrow .n{font-size:12.5px}
.setrow .n em{display:block;font-style:normal;font-size:11px;color:var(--txt-3);margin-top:1px}

.keytable{width:100%;border-collapse:separate;border-spacing:0}
.keytable th{text-align:left;font-size:11px;color:var(--txt-3);font-weight:600;
  padding:0 8px 5px 0;border-bottom:1px solid var(--line)}
.keytable td{padding:5px 8px 5px 0;border-bottom:1px solid var(--line-soft);
  font-size:12.5px;color:var(--txt-2)}
.keytable td.k{width:150px}
kbd{display:inline-block;font-family:var(--mono);font-size:10.5px;padding:1px 5px;
  border:1px solid var(--line-strong);border-radius:2px;background:var(--bg-0);
  color:var(--txt-2);margin-right:3px}

.steps-doc{list-style:none;margin:0;padding:0;counter-reset:s}
.steps-doc li{counter-increment:s;display:grid;grid-template-columns:20px 1fr;gap:10px;
  padding:7px 0;border-top:1px solid var(--line-soft);font-size:12.5px;
  line-height:1.55;color:var(--txt-2)}
.steps-doc li:first-child{border-top:0}
.steps-doc li::before{content:counter(s);font-family:var(--mono);font-size:11px;
  color:var(--acc-hi);border:1px solid var(--line-strong);border-radius:50%;
  width:19px;height:19px;display:grid;place-items:center}
.steps-doc li b{color:var(--txt);font-weight:600}
.steps-doc li .go{display:inline-block;margin-top:4px}
```

## A.3 State and the render contract

```js
const SET_TABS = [
  ['general',   'General',          'i-gear'],
  ['tutorial',  'Tutorial',         'i-book'],
  ['keys',      'Shortcuts',        'i-keyboard'],
  ['sessions',  'Sessions & views', 'i-session'],
  ['alerts',    'Alert rules',      'i-alert'],
  ['export',    'Export',           'i-export'],
  ['dist',      'Distribution',     'i-link'],
  ['workspace', 'Mail & calendar',  'i-mail'],
  ['users',     'Users & roles',    'i-team'],
  ['sources',   'Data sources',     'i-sat'],
  ['about',     'About',            'i-globe']
];
const SETST = { tab: 'general', doc: null };

const DEFAULT_SETTINGS = {
  clusterAt: 2, clustering: true, geocode: true, labels: false,
  density: 'comfortable', confirmDelete: false, autoAck: true, tips: true
};
```

**`renderSettings()` is idempotent and re-entrant.** It rebuilds the nav, then switches on
`SETST.tab` and writes `#set-body`. Every tab that owns live state re-renders the whole dialog
after a change rather than patching a row â the dialog is small, and partial patching is where
stale values come from.

**Publish a handle** so other files can open a specific tab and force a re-render:

```js
window.HWsettings = {
  open: openSettings, close: closeSettings, rerender: renderSettings,
  isOpen: () => $('#set-scrim').classList.contains('open')
};
```

Open/close:

```js
function openSettings(tab, doc){
  SETST.tab = tab || 'general'; SETST.doc = doc || null;
  $('#set-scrim').classList.add('open'); renderSettings();
}
const closeSettings = () => $('#set-scrim').classList.remove('open');
on('#set-close','click', closeSettings);
on('#set-scrim','click', ev => { if (ev.target.id === 'set-scrim') closeSettings(); });
on('#btn-settings','click', () => openSettings('general'));
on('#set-reset','click', () => {
  Y.settings = { ...DEFAULT_SETTINGS }; persist(); renderSettings(); SH.drawMarkers();
  HWtoast('Settings reset to defaults','ok');
});
```

Footer, every render:
`Horizon Watch Â· ops console 4.2 Â· build 4.2.108 Â· {N} sessions Â· {N} rules`

## A.4 Tab: General

Three sections. Row helper:

```js
const row = (name, sub, ctl) =>
  `<div class="setrow"><div class="n">${name}<em>${sub}</em></div><div>${ctl}</div></div>`;
```

**Display**
| Row | Sub | Control |
|---|---|---|
| Cluster markers at low zoom | Groups nearby signals into one bubble below the threshold | `.switch` bound to `settings.clustering` |
| Cluster threshold | Zoom level below which clustering applies | range `1â6` step `.5`, width 140px, value echoed as `2Ã` in mono `--txt-3` |
| Marker labels | Show place names beside signal markers | `.switch` bound to `S.ctx.labels` |

**Search**
| Row | Sub | Control |
|---|---|---|
| Live address lookup | Resolves any address through OpenStreetMap Nominatim; the bundled gazetteer is used either way | `.switch` bound to `settings.geocode` |

Followed by: *"Offline gazetteer: {N} places â infrastructure, reported locations, imagery scenes
and chokepoints."* at 11.5px `--txt-3`.

**Workflow** (`border:0`)
| Row | Sub |
|---|---|
| Opening a signal acknowledges it | Triage as a side effect of attention |
| Confirm before deleting | Applies to annotations, areas, rules and ontology objects |
| Show tips in empty panes | Explains what would appear and how to fill it |

**Wiring.** One loop over `[data-set]`; buttons toggle, ranges write numbers. `labels` is special
â it lives in map state, not settings:

```js
$$('#set-body [data-set]').forEach(el => {
  if (el.tagName === 'BUTTON') el.onclick = () => {
    const k = el.dataset.set;
    if (k === 'labels') { S.ctx.labels = !S.ctx.labels; SH.renderLayers(); SH.drawMarkers(); }
    else Y.settings[k] = !Y.settings[k];
    persist(); renderSettings(); SH.drawMarkers();
  };
  else el.oninput = () => {
    Y.settings[el.dataset.set] = +el.value; persist(); renderSettings(); SH.drawMarkers();
  };
});
```

## A.5 Tab: Tutorial

**Sixteen steps**, `.steps-doc`, each `[title, html, moduleOrNull]`. The title is bolded inline
(`<b>Pick a session.</b>`), then the body, then an `open <module> â` ghost button when a module is
given. Order matters â it is the order a new analyst should work.

| # | Title | Opens |
|---|---|---|
| 1 | Pick a session | map |
| 2 | Read the situation | map |
| 3 | Rewind in place | map |
| 4 | Work the inbox to zero | inbox |
| 5 | Follow the exposure | dossier |
| 6 | Draw a scan area | map |
| 7 | Read the change | imagery |
| 8 | Trace the network | ontology |
| 9 | Generate the briefing | generate |
| 10 | Set your alerts | â |
| 11 | Switch to Workstation | work |
| 12 | Work from your queues | work |
| 13 | Read the intel mailbox | mail |
| 14 | Bundle work into a case | cases |
| 15 | Work with the team | team |
| 16 | Hand over the shift | team |

Exact copy for the four that are easiest to get wrong:

> **1 Â· Pick a session.** A session is a whole desk: its own time window, layers, severity floor,
> projection, map position, record tabs and briefing basket. Switch between **Global watch**,
> **Red Sea corridor**, **Baltic & Nordics** and **Indo-Pacific** from the control at the left of
> the tab strip, or create one from whatever you are looking at now.

> **3 Â· Rewind in place.** The bar under the density strip is a time cursor. Drag it and the map
> shows only what had arrived by that moment; press the sweep button to watch the window fill. It
> returns to live in one click.

> **11 Â· Switch to Workstation.** The mode control at the left of the tab strip has two settings.
> **Watch** is the analysis surface: map, inbox, dossiers, analytics, imagery, ontology, briefings.
> **Workstation** is where the work is coordinated: your queues, the intel mailbox, cases and the
> team. Sessions carry across both, and <kbd>W</kbd> toggles between them.

> **16 Â· Hand over the shift.** The handover is generated from what actually changed during your
> shift: what you acknowledged, escalated and briefed, what you left open, and what the incoming
> analyst should watch for. Add a note and it goes out in-console and by mail.

Then a second section, **Reading the interface** (`border:0`):

> A rotated square is always severity, and it is always paired with the word â critical, high,
> moderate, low. Colour is reserved for state: severity, whether a figure is worsening or
> improving, and selection. Domains, sources and regions carry no colour at all, so nothing
> competes with a genuine warning. Gold means an analyst drew it; blue means a tasking instruction.

> *(11.5px `--txt-3`)* The status bar states the corpus is sample data. One capability â satellite
> tasking â is deliberately unavailable rather than faked.

Wiring: `$$('[data-go]').forEach(b => b.onclick = () => { closeSettings(); HWopen(b.dataset.go); })`.

## A.6 Tab: Shortcuts

Six `.keytable` sections. Keys split on `' / '` and each half wrapped in `<kbd>`.

**Global** â `âK / Ctrl+K` palette Â· `1 â 9` switch module Â· `Tab` cycle palette scope Â·
`Esc` close palette, dialog or field Â· `F` full screen Â· `?` shortcuts Â·
`âP` print the loaded briefing Â· `W` toggle Watch / Workstation Â· `G` go to My work

**Palette prefixes** â `sig:` signals Â· `ent:` dossier entities Â· `obj:` ontology objects Â·
`loc:` places and infrastructure Â· `aoi:` observation areas Â· `scn:` imagery scenes Â·
`trk:` vessels and aircraft Â· `brf:` briefings Â· `@26.5, 56.2` fly to coordinates (decimal or DMS)

**Situation map** â `Drag` pan Â· `Scroll / + â` zoom Â· `Double-click a track` open its inspector Â·
`Double-click while drawing` finish a route, area or scan polygon Â· `Esc` cancel the drawing

**Signal inbox** â `j / k` next / previous Â· `Click a header` sort, again to reverse

**Ontology** â `Drag a node` reposition permanently Â· `Double-click a node` expand its
neighbourhood Â· `Click a link` open the relationship editor

**Workstation** â `@` mention someone Â· `ââµ` send a comment Â·
`Click your avatar` switch or create a user Â· `Click a record reference` open it in its own module

## A.7 Tab: Sessions & views

Two sections. **Sessions**: the distinction paragraph, then one `.setrow` per session â
`name` with `em` reading `{window} window Â· {N} layers Â· {proj} Â· {N} views Â· {N} tabs`, and a
button reading `active` (current) or `switch`.

**Views** (`border:0`): the distinction paragraph, then one row per view in the **active** session
with an `apply` button. Empty state: *"No views saved in this session."*

```js
$$('#set-body [data-ses]').forEach(b => b.onclick = () => {
  captureSession(); applySession(b.dataset.ses); closeSettings();
});
$$('#set-body [data-view]').forEach(b => b.onclick = () => {
  applyView(b.dataset.view); closeSettings();
});
```

## A.8 Tab: Alert rules

Read-only summary plus a route in. One `.setrow` per rule: name, `em` reading
`when {rule prose without markup} â {action}`, and an `active` / `off` tag. Then
`open the rule editor` (primary) which closes settings and calls `HWalerts.open()`.

Strip the preview's `<b>` tags for the `em`: `ruleText(r).replace(/<\/?b>/g,'')`.

## A.9 Tab: Export

Live counts, computed at render:

| Row | Sub | Action |
|---|---|---|
| Signals â CSV | `{visible().length}` rows in the current filter, with coordinates, confidence and touched dependencies | `download` (primary) |
| Geometry â GeoJSON | Observation areas, annotations and signal points, ready for QGIS or a web map | `download` |
| Ontology â JSON | `{N}` objects and `{N}` relationships with confidence and basis | `download` |

Second section, **Briefings** (`border:0`):

> A briefing exports as PDF through the print layout, which is already paginated to Letter with no
> application chrome. Open a briefing, then **printable briefing â print / pdf**.

Lead the section with *"Exports reflect the current session's filters, not the whole corpus."*

## A.10 Tab: Distribution

Delegated to the Gmail module, which owns the recipient book:

```js
else if (T === 'dist') {
  if (window.HWgmail) {
    body.innerHTML = window.HWgmail.bookHTML();
    window.HWgmail.wireBook(renderSettings);   // pass the rerender as the callback
    return;
  }
  /* fallback: static list picker */
}
```

**`bookHTML()`** renders: a **Distribution lists** section with one `.setrow` per list showing
name, note, the full member list in `--txt-4`, a mono count and an `edit` button; then
`new list`. Then an **Address book** section (`border:0`): `{N} addresses across {N} lists`, an
add row (`input` + list `select` + `add`), and every address as a removable `.refchip` (first 40).

**`wireBook(rerender)`** behaviours:
- `edit` replaces the row in place with name input, note input, a comma-separated member textarea,
  `save` and `delete list`
- `add` splits on `[,;\s]+`, validates each against
  `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`, adds the valid ones and **names the first invalid one** in
  the toast: `3 added to Executive committee Â· 1 rejected`
- clicking an address chip removes it from **every** list
- every mutation calls `persist()` then `rerender()`

## A.11 Tab: Mail & calendar

Delegated the same way to `HWgmail.connectorHTML()` / `wireConnector(renderSettings)`.

**Section 1 â Gmail connection.** The setup paragraph:

> Horizon Watch talks to the Gmail REST API directly from the browser through Google Identity
> Services. Create an OAuth 2.0 **Web application** client in Google Cloud, enable the Gmail API,
> and add this page's origin to the client's authorised JavaScript origins. Paste the client ID
> below.

Then the client-ID field, and four rows:

| Row | `em` | Tag |
|---|---|---|
| State | `Connected as {email} Â· {N} messages in the mailbox` / the error / `Not connected â running on the sample mailbox` | `connected` green / `error` red / `offline` amber |
| Scopes requested | the four scopes with the googleapis prefix stripped | mono `4` |
| This session | `{N} fetched Â· {N} parsed to signals Â· {N} sent` | last sync in mono |
| Send quota | Resets at midnight UTC | mono |

Buttons: connected â `sync now` Â· `send a test to myself` Â· `disconnect` (danger).
Disconnected â `connect Gmail` (primary).

**Section 2 â Sync** (`border:0`): the Gmail query field, a poll-interval range `30â600` step `30`
with the label echoing `Poll interval â 60s`, an auto-parse checkbox, and:

> A query such as `in:inbox newer_than:7d -label:archived` keeps the console focused. Mail that
> matches no inbound rule stays in the mailbox for an analyst; nothing is discarded.

Changing the query or interval re-starts polling when connected.

## A.12 Tab: Users & roles

**Users**: `{N} users. Role decides capability: only a group security lead approves or issues a
briefing, only an imagery analyst confirms a detection.` Then one `.setrow` per user â name (with
` Â· you` for the signed-in one), `em` reading `{role} Â· {email} Â· {tz}`, and a presence tag
(`online` green / `away` amber / `offline` plain). Buttons: `create user` (primary) and
`switch user`, both closing settings and opening the identity dialog.

**Roles** (`border:0`): one row per role, name plus `em` listing its capabilities, and a mono count
of users holding it.

## A.13 Tab: Data sources

**Feeds** paragraph:

> Seven of eight sources are connected. Commercial sub-metre tasking is not enabled on this
> deployment, which is why the satellite tasking layer is unavailable rather than empty.

Then a `.keytable`: Source (mono 11.5px) Â· What it carries Â· State (tag) Â· Last.

| Source | Carries | State | Last |
|---|---|---|---|
| OSINT-WIRE | Aggregated open reporting | connected | 4 min |
| PARTNER-FEED | Contracted intelligence partner | connected | 11 min |
| AIS-TRACK | Terrestrial and satellite AIS | connected | 48 s |
| GDELT-XR | Event stream, cross-referenced | connected | 9 min |
| FIELD-REP | Regional security reporting | connected | 2 h |
| GOV-ADVISORY | Government travel and sanctions advisories | connected | 37 min |
| SAT-TASK | Copernicus Sentinel-1 / Sentinel-2 archive | connected | 6 h |
| COMMERCIAL-EO | Sub-metre optical, on tasking | **unavailable** | â |

**Detection models** (`border:0`): `hw-changedet v3` (siamese change detection on co-registered
pairs, 3 change types) Â· `hw-objdet v5` (object recognition on the current scene, 13 classes) Â·
`hw-sar-delta v2` (amplitude differencing for all-weather passes, 9 classes). Closing note:
*"Confirming or rejecting a detection is recorded as model feedback and updates the area's
reference counts."*

## A.14 Tab: About

Product paragraph, then three rows: **Build** `ops console 4.2 Â· 4.2.108` tag `current` Â·
**Corpus** `{N} signals Â· {N} entities Â· {N} objects Â· {N} scenes` tag `sample` (amber) Â·
**Geometry** `Natural Earth 110m via world-atlas, rendered with d3-geo` tag `public domain`.

**Data handling** (`border:0`):

> The loaded corpus is illustrative sample data and is labelled as such in the status bar. Vessel
> and aircraft identities are not live feeds. Nothing in this console should be treated as
> reporting.
>
> *(11.5px)* Workspace state â sessions, views, rules, pins and settings â is stored locally in
> this browser only.

## A.15 Settings acceptance

- [ ] All eleven tabs render non-empty content.
- [ ] The nav's selected row shows the 2px `--acc-hi` inset and an accent icon.
- [ ] Toggling any General switch persists across reload and takes effect immediately.
- [ ] `Marker labels` changes the map, not `settings`.
- [ ] Every tutorial `open â¦ â` button closes the dialog and lands on that module.
- [ ] Every key listed in Shortcuts actually exists.
- [ ] Adding a malformed address is rejected **and the offending string is named**.
- [ ] `Distribution` and `Mail & calendar` delegate to `HWgmail` when present and degrade when not.
- [ ] Export row counts equal the live filtered counts.
- [ ] `reset to defaults` restores all eight settings and redraws the map.
- [ ] `Esc` and a scrim click both close.

---

# PART B Â· WORKSTATION AND SESSIONS

## B.1 The mode contract

| Mode | Rail modules |
|---|---|
| **Watch** | map Â· inbox Â· dossier Â· analytics Â· generate Â· replay Â· ontology Â· imagery Â· reader |
| **Workstation** | work Â· mail Â· cases Â· team |
| Hidden, never in the rail | doc Â· deck |

Sessions, filters and the briefing basket carry across both. `W` toggles, `G` jumps to My work.

**Registry tagging** â every module declares its set:

```js
{ id:'work',  label:'My work', icon:'i-work', tab:'My work', set:'work' },
{ id:'mail',  label:'Mail',    icon:'i-mail', tab:'Mail',    set:'work' },
{ id:'cases', label:'Cases',   icon:'i-case', tab:'Cases',   set:'work' },
{ id:'team',  label:'Team',    icon:'i-team', tab:'Team',    set:'work' },
{ id:'doc',   label:null, icon:'i-doc',     tab:'Print layout', hidden:true },
{ id:'deck',  label:null, icon:'i-present', tab:'Deck',         hidden:true }
```

`renderRail()` filters `hidden`, then stamps `data-set="${m.set || 'watch'}"` on every button.

**Filter in CSS, never with inline styles.** `renderRail()` rebuilds `#modrail` with `innerHTML`
on every module change, tab change and session switch, so an inline `style.display` is discarded
on the next navigation â the mode switch appears to work once and silently stops.

```css
#app .mod[data-set=work]{display:none}
#app.mode-work .mod[data-set=work]{display:flex}
#app.mode-work .mod[data-set=watch]{display:none}
```
```js
function applyRailMode(){
  document.getElementById('app').classList.toggle('mode-work', T.mode === 'work');
}
```

Apply it **synchronously at boot** â deferring behind `setTimeout(â¦, 400)` shows a visible flash
of the wrong rail.

**Guard `setMode` against its own routing:**

```js
let switching = false;
function setMode(m, opts){
  if (T.mode === m && !opts?.force) { if (opts?.open) HWopen(opts.open); return; }
  switching = true;
  T.mode = m; persist();
  $$('#ses-pop .modeswitch button').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.mode === m));
  applyRailMode();
  const mods = m === 'work' ? WORK_MODS : WATCH_MODS;
  if (!mods.includes(S.module)) HWopen(m === 'work' ? 'work' : 'map');
  renderModeChip(); railBadges();
  switching = false;
}
```

`HWX.onModule` corrects mode drift, but only when `!switching` â otherwise `setMode`'s own
`HWopen` call fights it and the mode flips straight back.

## B.2 Record-scoped tabs

```js
function openModule(id, label) {
  if (label) {                              // ONLY a labelled record creates a tab
    let t = S.tabs.find(t => t.mod === id && t.kind === 'record');
    if (!t) { t = { id:'T'+Date.now().toString(36), mod:id, label, kind:'record' };
              S.tabs.push(t); }
    else t.label = label;
    S.tab = t.id;
  }
  S.module = id;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + id));
  renderRail(); renderTabs();
  if (id === 'map') setTimeout(() => { sizeMap(); drawStrip(); }, 0);
  if (window.HWM?.onModule) HWM.onModule(id);
}
```

Each session owns one `kind:'base'` tab named after the session. Record tab labels:

| Source | Label |
|---|---|
| Dossier | `Dossier Â· Red Sea corridor` |
| Briefing (reader) | `BRF-0436 Â· Weekly geopolitical exposure review` |
| Print layout | `Print layout Â· BRF-0436` |
| Deck | `Deck Â· BRF-0436` |
| Case | `Case Â· RED-SEA-Q3` |

Closing the active tab selects the last remaining; closing the last reopens Situation.

## B.3 Session model

```js
const newSession = (name, patch) => Object.assign({
  id: 'S' + Math.random().toString(36).slice(2,7),
  name, win: 72, sevFloor: 1, domains: Object.keys(DOM), proj: 'world',
  ctx: { risk:true, grat:true, labels:false, flows:true, aoi:true, arcs:true },
  tabs: [], basket: [], views: [], transform: null
}, patch || {});
```

**Seeded, exactly:**

| Session | Window | Domains | Projection | Floor | Views |
|---|---|---|---|---|---|
| Global watch | 72h | all seven | world | low | 0 |
| Red Sea corridor | 7d | maritime, conflict, energy | emea | moderate | 1 (`Critical only, 24h`) |
| Baltic & Nordics | 30d | cyber, conflict, political | emea | low | 0 |
| Indo-Pacific | 7d | maritime, conflict, trade | apac | low | 0 |

**Capture before every switch, restore everything after:**

```js
function captureSession(){
  const s = session(); if (!s) return;
  s.win = S.win; s.sevFloor = S.sevFloor; s.domains = Array.from(S.domains);
  s.ctx = { ...S.ctx }; s.proj = S.proj; s.tabs = S.tabs; s.basket = S.basket.slice();
  const t = M.transform; if (t) s.transform = { k:t.k, x:t.x, y:t.y };
}

function applySession(id, opts){
  const s = Y.sessions.find(z => z.id === id); if (!s) return;
  Y.active = id;
  S.win = s.win; S.sevFloor = s.sevFloor;
  S.domains = new Set(s.domains); S.ctx = { ...s.ctx }; S.proj = s.proj;
  S.basket.length = 0; (s.basket || []).forEach(b => S.basket.push(b));
  S.tabs = s.tabs?.length ? s.tabs
    : [{ id:'B'+s.id, mod:'map', label:s.name, kind:'base' }];
  s.tabs = S.tabs;
  S.tab = S.tabs[0].id; S.sel = null; S.tCut = null;      // clear selection AND time cursor
  $('#ses-name').textContent = s.name;
  $('#st-basket').textContent = S.basket.length;
  /* reflect into the controls, or the panel lies about the state */
  $$('#win-seg button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.win === S.win));
  $('#cnt-win').textContent = S.win===24?'24h':S.win===72?'72h':S.win===168?'7d':'30d';
  $$('#proj-seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.proj === S.proj));
  SH.renderLayers(); renderViews();
  SH.fitView(S.proj, false);
  if (s.transform && !opts?.freshView)
    M.svg.call(M.zoom.transform,
      d3.zoomIdentity.translate(s.transform.x, s.transform.y).scale(s.transform.k));
  SH.renderTabs(); SH.renderInspector(); SH.drawMarkers(); SH.drawStrip();
  renderTimeCursor(); persist();
  if (opts?.toast !== false) HWtoast('Session Â· ' + s.name);
}
```

Persist on a 60s interval **and** `beforeunload`, both wrapped in `try/catch`.

## B.4 Session control and popover

```html
<div class="sessionctl">
  <button class="sesbtn" id="ses-open" title="Switch session">
    <svg><use href="#i-session"/></svg><b id="ses-name">Global watch</b><i>â¾</i>
  </button>
</div>
```

```css
.sessionctl{display:flex;align-items:center;padding:0 8px;
  border-right:1px solid var(--line);flex:none}
.sesbtn{display:flex;align-items:center;gap:7px;height:22px;padding:0 8px;
  border:1px solid var(--line);border-radius:var(--r);background:var(--bg-2);
  color:var(--txt-2);font-size:12px;transition:.1s linear}
.sesbtn:hover{background:var(--bg-3);color:var(--txt);border-color:var(--line-strong)}
.sesbtn svg{width:12px;height:12px;flex:none;color:var(--txt-3)}
.sesbtn b{font-weight:400;max-width:150px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.sesbtn i{font-style:normal;font-size:9px;color:var(--txt-4)}
.sesbtn .mode{font-family:var(--mono);font-size:9.5px;padding:1px 4px;border-radius:2px;
  background:var(--bg-4);color:var(--acc-hi);border:1px solid var(--acc-line)}

.pop{position:fixed;z-index:85;width:308px;background:var(--bg-2);
  border:1px solid var(--line-strong);box-shadow:var(--shadow);display:none}
.pop.open{display:block}
.modeswitch{display:grid;grid-template-columns:1fr 1fr;gap:1px;
  background:var(--line-soft);border-bottom:1px solid var(--line)}
.modeswitch button{background:var(--bg-1);padding:9px 10px;text-align:left;color:var(--txt-3);
  display:grid;grid-template-columns:14px 1fr;gap:7px;align-items:center;
  grid-template-areas:'i t' '. e'}
.modeswitch button svg{grid-area:i;width:14px;height:14px}
.modeswitch button b{grid-area:t;font-weight:400;font-size:12.5px}
.modeswitch button em{grid-area:e;font-style:normal;font-size:10.5px;
  color:var(--txt-4);margin-top:1px}
.modeswitch button:hover{background:var(--bg-3);color:var(--txt)}
.modeswitch button[aria-pressed=true]{background:var(--bg-4);color:var(--txt);
  box-shadow:inset 0 -2px 0 var(--acc-hi)}
```

Popover contents, top to bottom:
1. **Mode switch** â two cells: `Watch / Analysis and reporting` Â· `Workstation / Mail, cases and the team`
2. **`Sessions`** header with `+ new`
3. **Session list** â a diamond swatch (accent when active, `--txt-4` otherwise), name, `em`
   reading `{window} Â· {N}/{7} layers Â· {proj} Â· {N} views`, and a delete `â`
4. **Footer** â *"A session holds its own filters, tabs, map position and briefing basket."*

Positioning: `left = ses-open.left`, `top = ses-open.bottom + 4`. Close on any click outside
`#ses-pop, #ses-open`. Deleting the last session is refused: *"At least one session must remain."*

`+ new` captures the current view into a fork, applies it, then focuses an **inline rename** in
the list row â never `prompt()`. Renaming also updates the base tab label and `#ses-name`.

**Mode chip.** `renderModeChip()` injects a `.mode` span into `#ses-open` before the `â¾`, reading
`WATCH` or `WORK`.

## B.5 Saved views

Injected as the **first** group of the Situation layer panel:

```css
.viewrow{display:grid;grid-template-columns:auto 1fr auto auto;gap:7px;align-items:center;
  padding:6px 9px;border-bottom:1px solid var(--line-soft);cursor:pointer}
.viewrow:hover{background:var(--bg-2)}
.viewrow svg{width:12px;height:12px;color:var(--txt-3)}
.viewrow b{display:block;font-weight:400;font-size:12.5px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.viewrow em{font-style:normal;font-family:var(--mono);font-size:10px;color:var(--txt-4)}
.viewrow .x{color:var(--txt-4);width:15px;height:15px;display:grid;place-items:center}
.viewrow .x:hover{background:var(--bg-4);color:#cf6259}
```

A view stores `{ id, name, win, sevFloor, domains, proj, ctx }` â no map transform, no tabs, no
basket. `save current view` appends `View {N+1}` and focuses an inline rename. `applyView` writes
the five fields, reflects them into the segments, re-renders layers, fits, redraws, and toasts
`View Â· {name}`.

## B.6 Reference grammar

```
sig:HW-2400 Â· ent:ENT-RS-01 Â· onto:N02 Â· scn:SCN-4471 Â· aoi:AOI-14
brf:BRF-0431 Â· case:CS-0014 Â· mail:M-1042 Â· rfi:RFI-021
```

```js
const REF_ICON = { sig:'i-bell', ent:'i-dossier', onto:'i-onto', scn:'i-sat',
                   aoi:'i-scan', brf:'i-read', case:'i-case', mail:'i-mail', rfi:'i-rfi' };
window.HWref = { open: openRef, label: refLabel, icon: k => REF_ICON[k] || 'i-link' };
```

`openRef` switches mode when the target lives in the other one, then navigates and retitles the
tab. `refLabel` resolves a human title for any reference. Every module that renders a reference
uses these two â never a local lookup.

## B.7 My work â `#view-work`

Grid `250px 1fr 320px`.

**Left, queues.** Seven `.qrow`s, each with icon, label and a count (`.c.hot` in `#cf6259` for
RFIs and urgent mail). Below them, a card with the signed-in user's avatar at 26px, name, `role Â·
shift`, and `switch user`.

| Queue | Contents |
|---|---|
| Assigned to me | `assignments` where `to === me && state === 'open'` |
| Mentions | `notifications` of kind `mention`, unread first |
| RFIs to answer | `rfis` where `status === 'open' && to === me` |
| My cases | `cases` not closed where I own or watch |
| Awaiting my review | briefings at approval stage `review`, or status `draft` |
| Urgent mail | `mail` where `urgent && unread` |
| Unreviewed signals | `events` with `status === 'new'`, capped at 20 |

Scope segment `mine / team / unassigned` narrows every queue.

**Centre.** Toolbar: queue name as the title, the scope segment, item count, `shift handover`.
Rows (`.wrow`, `auto 1fr auto auto`): severity diamond for signals or a type icon otherwise; title
from `refLabel`; meta `{id} Â· {sub}`; assignee avatar; due, in `#cf6259` when `< D+4`.

**Right, the day.** Calendar entries (`56px 1fr` rows: time, then title + `date Â· kind Â· with`),
then the seven most recent team activity entries with clickable references.

## B.8 Cases â `#view-cases`

Grid `250px 1fr 330px`.

Header: `{code} Â· opened {date}` Â· priority tag (critical red / high amber / else steel) Â· status
tag Â· 19px title Â· summary (max 640px) Â· four actions â `brief this case` (primary, pushes the
case's signals into the basket and opens the generator), `raise RFI`, `plot records`, and a status
advance reading `send to review` / `return to active` / `reopen`. Right of the header: owner
avatar at 26px with name and role, then watcher avatars at 16px.

Five tabs:

| Tab | Contents |
|---|---|
| **Overview** | Six-cell record ledger (signals, dossiers, ontology objects, scenes, areas, mail) Â· case notes as comment blocks Â· open RFIs as clickable link rows |
| **Records** | One group per kind, each a `.reflist` of `.refchip`s reading `{id} Â· {label}`; empty groups say "None attached." Closing note: *"Attach records from anywhere: the **attach to case** action appears on signals, mail, scenes and areas."* |
| **RFIs** | Full RFI cards, answerable in place by the recipient |
| **Timeline** | Every activity entry whose `ref` is the case or any attached record |
| **Briefing** | The approval chain (below) |

**Approval chain:**

```css
.chain{display:flex;align-items:stretch;gap:1px;background:var(--line-soft);
  border:1px solid var(--line);margin-bottom:11px}
.chain>div{flex:1;background:var(--bg-2);padding:8px 10px;opacity:.45}
.chain>div.done{opacity:1}
.chain>div.cur{opacity:1;box-shadow:inset 0 -2px 0 var(--acc-hi)}
.chain b{display:block;font-size:11px;font-weight:600;text-transform:uppercase;
  letter-spacing:.06em;color:var(--txt-2)}
.chain em{font-style:normal;display:block;font-family:var(--mono);font-size:10px;
  color:var(--txt-4);margin-top:3px}
```

Four cells for `draft â review â approved â issued`; each shows the stage name and, when reached,
the actor's initials and time. Below it the chain history as comment blocks, then an advance
button reading `send for review` / `approve` / `issue`, **gated by role**:

```js
if ((next === 'approved' || next === 'issued') && !can('approve'))
  return HWtoast('Only a group security lead can approve or issue','warn');
```

Right pane: the case discussion with the composer.

## B.9 Collaboration primitives

Four injectables, each taking `(box, ref)`:

```js
window.HWcomments.inject(box, ref);   // discussion + @mention autocomplete
window.HWassign.inject(box, ref);     // owner, due date, reassign, mark done
window.HWpresence.inject(box, ref);   // who else has this record open
window.HWinterrupt.inject(box);       // the urgent block (no ref)
```

They insert **before** `box.querySelector('.btnrow')` when one exists, so actions stay last.

**@mention autocomplete.** Match `/@([\w.\s]*)$/` against the text left of the caret, filter users,
render a positioned `.mentionpop` (min 200px, max 180px tall) anchored to the textarea's bottom
edge. `ArrowUp`/`ArrowDown` move the `.sel` row, `Enter`/`Tab` insert `@{name} `, `Escape` closes.
`ââµ` sends. On send: parse mentions back out of the body by name, push a `Comment`, push a
`Notification` per mentioned user (skipping self), push an activity entry, clear the field, and
toast `{N} person notified`.

**Assignment.** Shows the current owner avatar, name, `due {date}` tag and who assigned it; then a
`1fr auto auto` row of owner select, 74px due input and `assign` / `reassign`; then `mark done`
when assigned. Refuses without the `assign` capability.

**Presence.** Renders a `.viewing` strip of up to three avatars plus
`{name} is viewing this` / `{N} others are viewing this`, prepended to the box.

## B.10 The urgent interrupt

```css
.interrupt{border-bottom:1px solid var(--line);
  background:linear-gradient(180deg,rgba(196,69,60,.14),transparent);padding:10px 12px}
.interrupt .ih{display:flex;align-items:center;gap:7px;margin-bottom:6px}
.interrupt .ih svg{width:13px;height:13px;color:#cf6259;flex:none}
.interrupt .ih b{font-size:11px;font-weight:600;letter-spacing:.07em;
  text-transform:uppercase;color:#cf6259}
.interrupt .irow{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:start;
  padding:5px 0;cursor:pointer;border-top:1px solid rgba(196,69,60,.16)}
.interrupt .irow:first-of-type{border-top:0}
```

Sources: urgent unread mail Â· unread mentions Â· open RFIs addressed to me. Header reads
`Needs you Â· {N}`; up to four rows, each icon + text + timestamp; a dismiss-all `â`.
**Dismissals persist** in `T.dismissed` so a cleared item does not return. Clicking a row marks
its notification read, persists, updates badges and calls `openRef`.

**Injected via the hook, never by wrapping the export** â see `HORIZON-WATCH-COMPLETE-V2-TO-V3.md`
Â§2.2.

## B.11 Workstation acceptance

- [ ] Watch shows 9 rail buttons, Workstation 4 â **verified after navigating**, not only on load.
- [ ] No flash of the wrong rail on first paint.
- [ ] Clicking a Watch module from Workstation does not silently flip the chip back.
- [ ] A module switch alone creates no tab; only a labelled record does.
- [ ] Switching sessions restores window, floor, layers, projection, map position, tabs and
      basket, and the layer panel's controls reflect the restored state.
- [ ] `S.tCut` and `S.sel` clear on session switch.
- [ ] Deleting the last session is refused.
- [ ] Creating a session focuses an inline rename; no `prompt()` anywhere.
- [ ] Every reference string opens its record in the right module, switching mode as needed.
- [ ] An `analyst` cannot advance past `review` and is told why.
- [ ] An @mention notifies the named user and lands in their Mentions queue.
- [ ] The interrupt appears in the inspector, survives clearing the signal selection, and its
      dismissal survives a reload.
- [ ] Rail and tab drag-reorder persist and never hang the page.

---

# PART C Â· BRIEFING READER

## C.1 The one rule

**There is a single document object.** The reader renders it as live hypertext; the print layout
as paginated paper; the deck as slides. None owns the data.

```
Generator âââ¶ doc { meta, sel, crit, high, regions, domains }
                     â
        ââââââââââââââ¼âââââââââââââ
        â¼            â¼            â¼
     Reader        Print         Deck
   (rail dest.)   (a view)     (a view)
```

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

## C.2 Layout

Grid `236px 1fr 336px`. `reader` is the rail destination; `doc` and `deck` are `hidden:true`.

```html
<section class="view" id="view-reader">
  <div class="panes">
    <aside class="pane">
      <div class="panehead"><h3>Reader</h3></div>
      <div class="scroll">
        <div class="group"><div class="groupbody" style="padding:8px 0">
          <ul class="doctoc" id="rd-list" style="margin:0"></ul></div></div>
        <div class="group">
          <button class="grouphead" aria-expanded="true">
            <svg class="chev" viewBox="0 0 10 10" fill="none" stroke="currentColor"
                 stroke-width="1.6"><path d="M2 3.5L5 6.5 8 3.5"/></svg>
            <h4>References in this briefing</h4><span class="count" id="rd-ref-c"></span>
          </button>
          <ul class="doctoc" id="rd-refs"></ul>
        </div>
      </div>
    </aside>
    <div class="pane">
      <div class="toolbar">
        <span class="lbl" id="rd-id">â</span>
        <div class="sp"></div>
        <button class="btn sm" id="rd-tour"><svg><use href="#i-play"/></svg> guided walkthrough</button>
        <button class="btn sm" id="rd-print"><svg><use href="#i-print"/></svg> printable briefing</button>
        <button class="btn sm" id="rd-deck"><svg><use href="#i-present"/></svg> deck</button>
        <button class="btn sm primary" id="rd-dist"><svg><use href="#i-send"/></svg> distribute</button>
      </div>
      <div class="readbody" id="rd-body"></div>
    </div>
    <aside class="pane">
      <div class="minimap" id="rd-mini"><svg></svg>
        <div class="mmhead"><b id="rd-mini-t">Context map</b>
          <span id="rd-mini-s" style="margin-left:auto"></span></div></div>
      <div class="panehead"><h3>Reference context</h3></div>
      <div class="scroll" id="rd-ctx"></div>
    </aside>
  </div>
</section>
```

## C.3 CSS â exact

```css
.readbody{flex:1;min-height:0;overflow:auto;padding:26px 38px 60px;max-width:none}
.readbody .wrap{max-width:720px;margin:0 auto}
.readbody h1{font-size:22px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em}
.readbody .sub{font-size:12px;color:var(--txt-3);margin:0 0 20px}
.readbody h2{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  color:var(--txt-3);margin:26px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--line)}
.readbody p{font-size:13.5px;line-height:1.68;color:var(--txt-2);margin:0 0 11px;
  text-wrap:pretty}
.readbody li{font-size:13.5px;line-height:1.62;color:var(--txt-2);margin-bottom:6px}
.readbody .callout{border-left:2px solid var(--line-strong);padding:2px 0 2px 13px;
  margin:14px 0;color:var(--txt)}

/* a SPAN, never a button â see C.5 */
.xref{color:#82aede;border-bottom:1px dotted rgba(130,174,222,.5);cursor:pointer;
  white-space:nowrap}
.xref:hover{color:#a8c8ee;background:rgba(63,111,168,.16)}
.xref.active{background:rgba(63,111,168,.28);color:#cfe0f4}
.xref .rt{font-family:var(--mono);font-size:11px}

.minimap{position:relative;border-bottom:1px solid var(--line);background:#12161a;
  height:196px;flex:none}
.minimap svg{width:100%;height:100%;display:block}
.minimap .mmhead{position:absolute;top:6px;left:8px;right:8px;z-index:2;display:flex;
  align-items:center;gap:8px;font-size:10.5px;color:var(--txt-3);pointer-events:none}
.minimap .mmhead b{font-weight:400;color:var(--txt-2)}
.mm-land{fill:#242b31;stroke:#2f373e;stroke-width:.5;vector-effect:non-scaling-stroke}
.mm-ping{fill:none;stroke:#c4453c;stroke-width:1.2;vector-effect:non-scaling-stroke}
.mm-ev{stroke:#12161a;stroke-width:.8;vector-effect:non-scaling-stroke}
.mm-lbl{font-size:8.5px;fill:#c2cbd3;paint-order:stroke;stroke:#12161a;
  stroke-width:2.6px;stroke-linejoin:round}

.ctxcard{border-bottom:1px solid var(--line-soft);padding:11px 12px}
.ctxcard>.lbl{display:block;margin-bottom:7px;font-weight:600;color:var(--txt-2)}
```

**Why 13.5px/1.68.** The rest of the console is 12.5px/1.45. This is the only surface that
relaxes, because it is prose to be read rather than data to be scanned. The 720px measure is
~85 characters â the readable maximum.

## C.4 Section order â fixed

1. **Header** â H1 title, then `.sub` reading
   `{id} Â· {scope} Â· {audience} Â· issued {zulu} Â· {classification}`
2. **Executive judgement** â two paragraphs, then the bottom-line callout
3. **Assessment by theme** â top four domains
4. **Network and attribution** â *reader only*, not in print or deck
5. **Indicators and warnings** â conditional bullets
6. **Sourcing and method**

Then a `distribute` / `printable briefing` action row.

## C.5 References â the critical detail

```js
const refSpan = (kind, id, text) =>
  `<span class="xref" role="link" tabindex="0" data-k="${kind}" data-id="${id}">${esc(text)}<span class="rt"> â¸</span></span>`;
```

**A `<button>` here is a bug.** A button is an atomic inline-level box: it will not break across
lines, and `display:inline` does not restore wrapping in Blink or WebKit. The judgement reference
runs ~78 characters and must wrap. Being a span, it needs its own keyboard handling:

```js
$$('#rd-body .xref').forEach(x => {
  x.onclick = () => activateRef(x);
  x.onkeydown = ev => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activateRef(x); }
  };
});
```

Four kinds, and the exact prose that carries them:

| Kind | Where it appears | Text |
|---|---|---|
| `region` | judgement paragraph 1 | `EMEA (7)` |
| `signal` | judgement, bottom line, every theme | `Bab el-Mandeb: two bulk carriers rerouteâ¦` |
| `scene` | judgement paragraph 2 | the scene's place name |
| `node` | network and attribution | the object's label |

## C.6 `activateRef(el, quiet)`

Three things, always in this order: mark active â load the right pane â drive the minimap.

```js
function activateRef(el, quiet){
  $$('#rd-body .xref').forEach(x => x.classList.toggle('active', x === el));
  const kind = el.dataset.k, id = el.dataset.id;
  if (!rdMini) rdMini = makeMinimap('#rd-mini');
  /* â¦ per-kind branch â¦ */
}
```

**Minimap span per kind** â this is the difference between a useful map and a confusing one:

| Kind | Span | Context plotted |
|---|---|---|
| `signal` | **16Â°** | every other signal within 1400km, as small severity-coloured diamonds |
| `scene` | 10Â° | none â the scene is the subject |
| `node` | 20Â° | none |
| `region` | 46Â° | every signal in the region |

The subject renders as a 10px rotated diamond in its severity colour, with a label at `+10/+3`,
plus **two expanding pings** at 0ms and 480ms â stepped timers, 20 steps Ã 75ms, cubic-out, never
a d3 transition.

**Right-pane content per kind:**

- **signal** â `Signal {id}` card with severity + domain + source tags, title at 12.5px `--txt`,
  summary; a `Record` card with `.kv` (location, coordinates mono, received mono, confidence);
  then three actions: `open on map` (primary), `animate lead-up`, `open in inbox`
- **scene** â `Imagery scene {id}`, the sensor line
  (`{sensor} Â· {vendor} Â· {dateA} â {dateB}. {N} change detections, {N} above 80% confidence.`),
  the first three detections as typed rows, then `open change detection`
- **node** â `Ontology object`, label, `{type} Â· risk {N}`, up to five link rows
  (`{kind} Â· {other label} Â· {conf}%`), then `open in ontology`
- **region** â `Region {id}`, `{N} signals in the corpus, {N} critical.`, then the first six as
  `.evrow`s bound with `HWbindRows`

`open on map` switches module, selects, flies to k=5 and pings at +700ms.
`animate lead-up` calls `HWX.replayOnMap(id)`.

## C.7 Left pane

**Briefing register** â one `.briefrow` per briefing, two lines: title at 12.5px `--txt`, then
`{id} Â· {status}` at 10.5px `--txt-4`. Clicking one calls `HWM.openBriefing(id)` and re-renders.

**References index** â enumerated from the DOM after the body renders, so it can never drift from
the prose:

```js
const refs = $$('#rd-body .xref');
$('#rd-ref-c').textContent = refs.length;
$('#rd-refs').innerHTML = refs.map((r,i) =>
  `<li><a href="#" data-i="${i}"><span>${String(i+1).padStart(2,'0')}</span>
   <span>${r.textContent.replace(' â¸','')}</span></a></li>`).join('');
```

Activate the first reference on render with `quiet=true`, so the right pane and minimap are never
empty on entry.

## C.8 Guided walkthrough

```js
on('#rd-tour','click', () => {
  const refs = $$('#rd-body .xref'); if (!refs.length) return;
  if (R.tour) {                                  // toggle off
    clearInterval(R.tour); R.tour = null;
    $('#rd-tour').innerHTML = '<svg><use href="#i-play"/></svg> guided walkthrough';
    return;
  }
  let i = 0;
  $('#rd-tour').innerHTML = '<svg><use href="#i-pause"/></svg> stop walkthrough';
  activateRef(refs[0]);
  R.tour = setInterval(() => {
    i++;
    if (i >= refs.length) {                      // stop at the end, do not loop
      clearInterval(R.tour); R.tour = null;
      $('#rd-tour').innerHTML = '<svg><use href="#i-play"/></svg> guided walkthrough';
      return;
    }
    activateRef(refs[i]);
    refs[i].closest('p,li,div').scrollIntoView({ block:'center', behavior:'smooth' });
  }, 3600);
});
```

**Kill the interval on module change**, or it keeps stepping a hidden view:

```js
if (id !== 'reader' && R.tour) { clearInterval(R.tour); R.tour = null; }
```

Scroll the **containing block**, not the span â scrolling a nowrap inline element horizontally
displaces the column.

## C.9 Routing between the three renderings

| From | Control | To |
|---|---|---|
| Generator (run complete) | â | **Reader**, tab retitled `{id} Â· {title}` |
| Reader | `printable briefing` | Print layout |
| Reader | `deck` | Deck |
| Reader | `distribute` | Distribution picker |
| Print layout | `back to reader` | Reader |
| Print layout | `deck` | Deck |
| Deck | `back to reader` | Reader |
| Generator footer | print / deck / send buttons | each of the three |

All read `HWMdoc.doc()`; none holds its own copy.

## C.10 Reader acceptance

- [ ] The body measure is 720px and the type is 13.5px/1.68.
- [ ] Every reference is a `SPAN` with `role="link"` and `tabindex="0"`; `Enter` and `Space`
      activate it.
- [ ] The ~78-character judgement reference **wraps** to two lines with no horizontal overflow.
- [ ] Clicking a reference marks it active, fills the right pane, and re-frames the minimap with
      two pings.
- [ ] Minimap spans are 16Â° / 10Â° / 20Â° / 46Â° by kind.
- [ ] The references index count equals the number of `.xref` nodes in the body.
- [ ] The first reference is active on entry â the right pane is never empty.
- [ ] The walkthrough steps every reference, stops at the end, and its interval dies on module
      change.
- [ ] Contents and reference links scroll the desk, never `scrollIntoView` on the span itself.
- [ ] All four routes out (print, deck, distribute, register) work, and every route back returns.

---

# PART D Â· DECK

## D.1 The principle

A deck is the **third rendering** of the same document object. A slide can never say something the
document does not, and a speaker note can never describe a slide that changed â because both are
generated from the same fields.

## D.2 Layout and markup

Grid `186px 1fr 300px`: slide rail Â· stage Â· speaker notes.

```html
<section class="view" id="view-deck">
  <div class="panes" style="grid-template-columns:186px 1fr 300px">
    <aside class="pane docaside">
      <div class="panehead"><h3>Slides</h3>
        <div class="right"><span class="lbl" id="dk-count"></span></div></div>
      <div class="scroll" id="dk-rail"></div>
    </aside>
    <div class="pane">
      <div class="toolbar doctools">
        <span class="lbl" id="dk-id">â</span>
        <div class="sp"></div>
        <div class="seg" id="dk-theme">
          <button data-t="dark" aria-pressed="true">dark</button>
          <button data-t="light">light</button></div>
        <button class="btn sm" id="dk-back"><svg><use href="#i-read"/></svg> back to reader</button>
        <button class="btn sm" id="dk-print"><svg><use href="#i-print"/></svg> pdf</button>
        <button class="btn sm primary" id="dk-full"><svg><use href="#i-present"/></svg> present</button>
      </div>
      <div class="deckdesk" id="dk-desk">
        <div class="stage" id="dk-stage"><div class="slidewrap" id="dk-slide"></div></div>
        <div class="deckbar">
          <button class="pbtn" id="dk-prev"><svg><use href="#i-prev"/></svg></button>
          <span class="lbl mono" id="dk-pos">1 / 1</span>
          <input type="range" id="dk-scrub" min="0" max="0" value="0" style="flex:1">
          <button class="pbtn" id="dk-next"><svg><use href="#i-next"/></svg></button>
        </div>
      </div>
    </div>
    <aside class="pane">
      <div class="panehead">
        <svg style="width:13px;height:13px;color:var(--txt-3)"><use href="#i-notes"/></svg>
        <h3>Speaker notes</h3></div>
      <div class="scroll" id="dk-notes"></div>
    </aside>
  </div>
</section>
```

## D.3 The stage â the trap

The slide is authored at **1920Ã1080**. As a **grid item**, the implicit `auto` track sizes to its
1920px max-content and `place-items:center` centres it *inside that 1920px track* â putting it
~960px right of the stage, clipped out of view at every viewport width.

```css
.deckdesk{flex:1;min-height:0;display:flex;flex-direction:column;
  background:#0d1013;overflow:hidden}
/* out of flow, not a grid item */
.stage{flex:1;min-height:0;position:relative;display:block;padding:18px;overflow:hidden}
.slidewrap{position:absolute;top:50%;left:50%;width:1920px;height:1080px;
  transform-origin:center center}
.deckbar{flex:none;display:flex;align-items:center;gap:12px;padding:9px 14px;
  background:var(--bg-2);border-top:1px solid var(--line)}
.pbtn{width:30px;height:26px;display:grid;place-items:center;border:1px solid var(--line);
  border-radius:2px;color:var(--txt-2)}
.pbtn:hover{background:var(--bg-3);color:var(--txt)}
```

```js
function fit(){
  const stage = $('#dk-stage'), wrap = $('#dk-slide');
  if (!stage || !wrap) return;
  const w = stage.clientWidth - 36, h = stage.clientHeight - 36;
  if (w <= 0 || h <= 0) return setTimeout(fit, 60);        // bounded retry, never rAF
  /* the WHOLE transform in one write â a scale-only write drops the centring translate */
  wrap.style.transform = 'translate(-50%,-50%) scale(' + Math.min(w/1920, h/1080) + ')';
}
```

Verify with `elementFromPoint` at the stage centre, not by checking the node exists.

## D.4 Slide type scale

| Role | Size | Weight | Colour (dark) |
|---|---|---|---|
| H1 (cover) | 104px | 600 | `#d5dae0`, `letter-spacing:-.02em`, `line-height:1.02` |
| H2 | 58px | 600 | `#d5dae0`, `-.012em` |
| H3 | 36px | 600 | `#d5dae0` |
| Body | 34px | 400 | `#a4adb6`, lh 1.5, max-width 1400px |
| Big body | 46px | 400 | `#d5dae0`, lh 1.42 |
| Quote | 52px | 500 | `#d5dae0`, lh 1.3, max-width 1500px |
| List item | 32px | 400 | `#a4adb6`, 44px left padding |
| Statistic | 76px | 500 | inherits, `-.02em` |
| Statistic label | 21px | 400 | `#818c96` |
| Table cell | 27px | 400 | `#a4adb6` |
| Table header | 19px | 600 | `#818c96`, uppercase, ls .11em |
| Eyebrow | 22px | 400 | `#818c96`, uppercase, ls .16em |
| Footer | 19px | 400 | `#616b75` |

Slide padding `96px 120px`. List bullets are 14px rotated squares in `#5f95d0` at `left:8px;
top:16px`. Statistic ledgers use 2px gaps filled by `#262c33`. The light theme swaps
background `#f4f2ee`, ink `#1b1f24`, body `#3a4048`, muted `#5f6772`, rules `#c9c4ba`.

## D.5 Slide plan â twelve slides

Every slide is `{ label, html, note, cue, map? }`. `label` names the rail row.

| # | Label | Content |
|---|---|---|
| 1 | Cover | eyebrow `Horizon Watch Â· intelligence briefing` + classification; H1 **lowercased** title; a 600px rule; a three-column meta grid â Scope, Horizon, Audience, Evidence set, Issued, Prepared by |
| 2 | **Bottom line** | eyebrow `Bottom line`; full rule; the judgement as a 52px quote; then a 30px paragraph with the counts and the binding-constraint sentence |
| 3 | This cycle | H2 `{N} signals met the reporting threshold`; a four-cell ledger (critical red, high amber, countries touched, mean confidence); regional bars at 340px label / track / 110px value |
| 4 | Where | H3 `Signal locations, {scope} scope`; a 1680Ã620 map, **criticals labelled only** |
| 5â8 | One per theme | eyebrow `Theme {i} of {N}`; H2 domain name; rule; a 46px statement (`{N} signals, centred on {places}. The severity peak is {sev}, set by {place}.`); three signal titles as list items; a 27px `Bears on {impacts}.` |
| 9 | Exposure | H3 `Dependencies touched by this evidence set`; table â Dependency / Signals (180px) / Severity peak (280px, diamond + word) / Standing mitigation |
| 10 | Indicators | H3 `What would change this assessment`; rule; four falsifiable triggers as list items |
| 11 | Actions | H3 `What we are asking for`; table â # (80px) / Action / Owner (340px) / By (160px) |
| 12 | Sourcing | rule; a four-cell ledger (signals assessed, feeds, multi-source, imagery scenes); the method paragraph; the sample-corpus line at 26px |

**Footer on every slide:** `{classification}` Â· `{briefing id}` Â· `{n} / {total}` right-aligned.
Build it with a `TOTAL` placeholder and renumber once the count is known:

```js
return s.map((sl,i) => ({ ...sl,
  html: sl.html.replace(/(\d+|0) \/ TOTAL/, (i+1) + ' / ' + s.length) }));
```

## D.6 The map slide

1680Ã620 viewBox, fitted to the **evidence set's own extent** with 22Â° padding, clamped to
Â±179/Â±85. Land in `.dkland`, markers as rotated rects â 13px critical, 11px high, 9px others â
with a 2px background-coloured stroke. **Only the first four criticals get a text label**, at
24px, `+22/+8` from the marker.

A slide is not an inspector. Labelling everything makes the map unreadable at the back of a room.

## D.7 Speaker notes

```css
.dknote{padding:12px 13px}
.dknote h4{margin:0 0 8px;font-size:13px;font-weight:600}
.dknote p{font-size:12.5px;line-height:1.65;color:var(--txt-2);margin:0 0 10px}
.dknote .cue{font-family:var(--mono);font-size:11px;color:var(--txt-4);padding:8px 10px;
  background:var(--bg-0);border-left:2px solid var(--line-strong);line-height:1.6}
```

Header `{label} Â· slide {n}`, then the note, then the cue in mono, then the standing line:
*"Notes are generated from the same fields the slide uses, so a note can never describe a slide
that changed."*

**Exact notes and cues for the four that matter most:**

| Slide | Note | Cue |
|---|---|---|
| Cover | `Open with the window, not the detail. {N} signals over the reporting period, {crit} critical. State the classification aloud if the room is mixed.` | `Do not read the metadata. 20 seconds.` |
| Bottom line | `Lead with the judgement. If the committee takes only one thing from the room, this is it. Expect the challenge on cost: the answer is on the exposure slide.` | `Say it, then stop. Let it land before moving on.` |
| Exposure | `This is the cost slide. If asked what holding contingency routing costs: roughly 11% on landed logistics for affected strings, holdable through November without renegotiation, decision needed by the 20th for December volumes.` | `Expect the interruption here. Have the number ready.` |
| Actions | `Ask for a decision on line one before leaving the room. Lines two to {N} are already in train and are for information.` | `Stop on this slide. Do not advance until line one has an answer.` |
| Sourcing | `Have this slide ready but do not present it unless sourcing is challenged. If it is, the number that matters is {multi} of {N} corroborated by more than one feed.` | `Skip unless asked. Then go slowly.` |

## D.8 Rail and controls

```css
.dkthumb{display:grid;grid-template-columns:26px 1fr;gap:8px;align-items:center;
  padding:7px 9px;border-bottom:1px solid var(--line-soft);cursor:pointer;
  width:100%;text-align:left}
.dkthumb:hover{background:var(--bg-2)}
.dkthumb[aria-selected=true]{background:var(--bg-3);box-shadow:inset 2px 0 0 var(--acc-hi)}
.dkthumb .n{font-family:var(--mono);font-size:10.5px;color:var(--txt-4)}
.dkthumb .t{font-size:12px;color:var(--txt-2);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.dkthumb[aria-selected=true] .t{color:var(--txt)}
```

Rail rows show a zero-padded index and the label. Toolbar id line:
`{briefing id} Â· {classification} Â· {N} slides`. Position readout `{n} / {N}` in mono. The scrub
range's `max` is `slides.length - 1`.

`show(i)` clamps, writes the slide HTML, applies `.light` when themed, updates the position
readout, the scrub value and the rail selection, renders the note, draws the map if
`slide.map`, then calls `fit()`.

## D.9 Present mode

```css
body.presenting .topbar,
body.presenting .tabstrip,
body.presenting .statusbar,
body.presenting #view-deck .pane:first-child,
body.presenting #view-deck aside.pane:last-of-type,
body.presenting .deckbar,
body.presenting .doctools{display:none!important}
body.presenting #view-deck .panes{grid-template-columns:1fr!important}
body.presenting .stage{padding:0}
body.presenting .deckdesk{background:#000}
```

`present` adds `body.presenting`, requests fullscreen (failure is tolerated), re-fits at +160ms,
and toasts `Arrows or space to advance Â· Esc to exit`.

`exitPresent()` removes the class, exits fullscreen, re-fits, and **returns `true`** so the key
handler can stop propagation and not also close a dialog. Also bind `fullscreenchange` to exit.

Keys, captured at `document` level with `capture:true`, and only when `S.module === 'deck'`:

| Key | Action |
|---|---|
| `â` `PageDown` `Space` | next |
| `â` `PageUp` | previous |
| `Home` / `End` | first / last |
| `Esc` | exit present mode |

## D.10 PDF export

Lay **every** slide into the flow, reset the transform, print, then restore:

```js
on('#dk-print','click', () => {
  const wrap = $('#dk-slide'), keep = wrap.innerHTML;
  wrap.innerHTML = K.slides.map(s => s.html).join('');
  if (K.theme === 'light') $$('#dk-slide .slide').forEach(n => n.classList.add('light'));
  document.body.classList.add('deck-print');
  wrap.style.transform = 'none';
  window.print();
  setTimeout(() => {
    document.body.classList.remove('deck-print');
    wrap.innerHTML = keep; show(K.i); fit();
  }, 500);
});
```

```css
@media print{
  body.deck-print{background:#fff}
  body.deck-print #app{display:block;height:auto}
  body.deck-print .topbar,body.deck-print .tabstrip,body.deck-print .statusbar,
  body.deck-print #toasts,body.deck-print .scrim,body.deck-print .deckbar,
  body.deck-print .doctools,body.deck-print #view-deck aside.pane{display:none!important}
  body.deck-print .view{display:none!important}
  body.deck-print .view#view-deck{display:block!important;height:auto;overflow:visible}
  body.deck-print #view-deck .panes{display:block!important}
  body.deck-print .pane{border:0!important}
  body.deck-print .deckdesk,body.deck-print .stage{display:block;overflow:visible;
    padding:0;background:#fff}
  body.deck-print .slidewrap{position:static!important;transform:none!important;
    top:auto;left:auto;width:100%;height:auto}
  body.deck-print .slide{position:static;width:100%;height:auto;
    aspect-ratio:16/9;break-after:page}
}
```

`position:static` on `.slidewrap` is required â the absolute positioning that centres it on screen
would stack all twelve slides on one sheet.

## D.11 Registration and entry

The deck is a **hidden** module, registered late so it never reaches the rail:

```js
setTimeout(() => {
  const mods = window.HWshell && window.HWshell.MODULES;
  if (mods && !mods.some(m => m.id === 'deck'))
    mods.push({ id:'deck', label:null, icon:'i-present', tab:'Deck', hidden:true });
}, 200);
```

Three entry points, all reading `HWMdoc.doc()`: `#rd-deck` (reader), `#doc-deck` (print view),
`#gen-deck` (generator footer, enabled on run completion). `open(doc)` builds the slides, opens
the module with the tab label `Deck Â· {id}`, renders the rail, shows slide 0 and toasts
`{N} slides built from {id}`.

## D.12 Deck acceptance

- [ ] `elementFromPoint` at the stage centre returns the slide, at 1280px and at 2560px.
- [ ] `fit()` writes `translate(-50%,-50%) scale(k)` as one declaration.
- [ ] Twelve slides for a 10â12 signal set; the footer numbering is correct on every slide.
- [ ] Only criticals carry map labels, and at most four.
- [ ] Every note interpolates real values from the document; no placeholder text.
- [ ] Present strips all chrome, arrows and space advance, `Esc` exits without closing anything
      else.
- [ ] The light theme applies to the current slide and to the PDF export.
- [ ] `pdf` yields one 16:9 slide per landscape sheet, and the deck is restored afterwards.
- [ ] The deck never appears in the rail.
- [ ] `back to reader` returns with the tab retitled to the briefing.
