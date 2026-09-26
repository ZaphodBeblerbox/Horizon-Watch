# Horizon Watch â Briefing UI & Mobile Companion
### Implementation manual Â· v1.0

Two deliverables in one document:

- **Part A â the briefing surface** (interactive reader + printable document), in full detail
- **Part B â the mobile companion**, concise but complete

> **Palette note.** Horizon Watch runs on its own dark intelligence palette, not the Muzzo
> brand system â a deliberate, user-directed decision for an ops console. All tokens below
> are the console's own. Muzzo remains correct for marketing surfaces.

---

# PART A â THE BRIEFING SURFACE

## A0. The one architectural rule

**The reader and the printable document are ONE artefact, not two pages.**

There is a single document object in memory. The reader renders it as live hypertext; the
print layout renders the same object as paginated paper. They can never disagree because
neither owns the data.

```
Generator ââproducesâââ¶  doc {meta, sel, crit, high, regions, domains}
                              â
                   ââââââââââââ´âââââââââââ
                   â¼                     â¼
          Reader (#view-reader)   Print (#view-doc)
          rail destination         a VIEW, not a destination
          live references          Letter pages, serif
```

**Consequences you must honour:**

1. `reader` appears in the module rail. `doc` is registered with `hidden:true` and is
   **never** in the rail.
2. Generation completing lands the user in the **reader**, not the print view.
3. Three routes into print, all producing the same pages: reader toolbar
   `printable briefing`, generator footer print button, palette/settings.
4. Print view always offers `back to reader`. The user is never stranded.

```js
// module registry â hw-app.js
{ id:'reader', label:'Briefings', icon:'i-read', tab:'Briefings' },
{ id:'doc',    label:null,        icon:'i-doc',  tab:'Print layout', hidden:true }

// rail render must filter
$('#modrail').innerHTML = MODULES.filter(m => !m.hidden).map(/* â¦ */)
```

---

## A1. The document object

Built by the generator from the evidence set. Nothing else constructs it.

```js
function buildBriefing(sel) {
  const id    = 'BRF-' + String(432 + D.briefings.length).padStart(4,'0');
  const title = $('#g-title').value || 'Geopolitical exposure review';
  const sorted = sel.slice().sort((a,b) =>
    SEV[b.severity].rank - SEV[a.severity].rank || a.hoursAgo - b.hoursAgo);

  return {
    meta: { id, title,
            scope:    $('#g-scope').value,      // Global | EMEA | APAC | AMER
            aud:      $('#g-aud').value,        // Executive committee | â¦
            cls:      $('#g-class').value,      // INTERNAL // RISK | â¦
            horizon:  M.gen.horizon,            // 7 days | 30 days | 90 days
            author:  'System agent', status:'draft', ts:'just now' },
    sel:    sorted,                                   // the evidence set
    crit:   sorted.filter(e => e.severity === 'critical'),
    high:   sorted.filter(e => e.severity === 'high'),
    regions: d3.rollups(sorted, v => v.length, d => d.region).sort((a,b) => b[1]-a[1]),
    domains: d3.rollups(sorted, v => v.length, d => d.domain).sort((a,b) => b[1]-a[1])
  };
}
```

`regions` and `domains` are pre-rolled because **both** renderers need the same ordering.
Rolling them twice invites divergence.

---

## A2. Generator â reader handoff

The generator's seven staged steps (Â§A9) end in `finish()`:

```js
function finish(sel) {
  M.gen.running = false;
  renderSteps(STEPS.length);
  $('#gen-run').disabled = false;
  $('#gen-cancel').disabled = true;
  $('#gen-state').textContent = 'complete';
  $('#gen-prog i').style.width = '100%';
  log('<i>ready</i> â opening in the reader');
  $('#gen-open-doc').disabled = false;        // print route now live

  const doc = buildBriefing(sel);
  D.briefings.unshift(doc.meta);              // register it
  M.doc = doc;                                // single source of truth

  window.HWtoast('Briefing ' + doc.meta.id + ' generated', 'ok');
  renderDoc();                                // build print pages NOW, in the background
  window.HWopen('reader', doc.meta.id + ' Â· ' + doc.meta.title);
  window.HWX.renderReader();
}
```

Building the print pages eagerly matters: `printable briefing` must be instant, and
`âP` must work without visiting the print view first.

---

## A3. Reader layout â `#view-reader`

```
grid-template-columns: 236px  1fr  336px
                       âââââ  âââ  âââââ
                       rail   text context
```

```html
<section class="view" id="view-reader">
  <div class="panes">
    <aside class="pane">                     <!-- glass -->
      <div class="panehead"><h3>Reader</h3></div>
      <div class="scroll">
        <div class="group"><div class="groupbody" style="padding:8px 0">
          <ul class="doctoc" id="rd-list"></ul></div></div>
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
      </div>
      <div class="readbody" id="rd-body"></div>
    </div>

    <aside class="pane">                      <!-- glass -->
      <div class="minimap" id="rd-mini"><svg></svg>
        <div class="mmhead"><b id="rd-mini-t">Context map</b>
          <span id="rd-mini-s" style="margin-left:auto"></span></div></div>
      <div class="panehead"><h3>Reference context</h3></div>
      <div class="scroll" id="rd-ctx"></div>
    </aside>
  </div>
</section>
```

### Reading measure and type

```css
.readbody{flex:1;min-height:0;overflow:auto;padding:26px 38px 60px}
.readbody .wrap{max-width:720px;margin:0 auto}   /* the measure â non-negotiable */
.readbody h1{font-size:22px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em}
.readbody .sub{font-size:12px;color:var(--txt-3);margin:0 0 20px}
.readbody h2{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  color:var(--txt-3);margin:26px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--line)}
.readbody p{font-size:13.5px;line-height:1.68;color:var(--txt-2);margin:0 0 11px;text-wrap:pretty}
.readbody li{font-size:13.5px;line-height:1.62;color:var(--txt-2);margin-bottom:6px}
.readbody .callout{border-left:2px solid var(--line-strong);padding:2px 0 2px 13px;
  margin:14px 0;color:var(--txt)}
```

**13.5px/1.68 at 720px** is the reading setting. The rest of the console is 12.5px/1.45 â
this is the only place that relaxes, because it is prose to be read rather than data to be
scanned. Section headings are the console's uppercase 12px label style, so the document
still reads as part of the tool.

---

## A4. References â the feature that makes it a reader

Every claim with a record behind it is a **reference**. Clicking one does three things at
once: marks itself active, loads the record into the right pane, and re-frames the context
minimap.

### A4.1 Markup â a span, never a button

```js
const refSpan = (kind, id, text) =>
  `<span class="xref" role="link" tabindex="0" data-k="${kind}" data-id="${id}">${esc(text)}<span class="rt"> â¸</span></span>`;
```

```css
.xref{color:#82aede;border-bottom:1px dotted rgba(130,174,222,.5);cursor:pointer}
.xref:hover{color:#a8c8ee;background:rgba(63,111,168,.16)}
.xref.active{background:rgba(63,111,168,.28);color:#cfe0f4}
.xref .rt{font-family:var(--mono);font-size:11px}
.xref:focus-visible{outline:2px solid var(--acc-hi);outline-offset:2px}
```

**A `<button>` here is a bug.** A button is an atomic inline-level box: it will not break
across lines, and `display:inline` does not restore wrapping in Blink or WebKit. The
executive-judgement reference is `place + ': ' + lowercased title` â around 78 characters â
inside a 720px measure. As a button it overflows and is clipped. Being a span, it also needs
a keydown handler, since a span is not natively activatable:

```js
$$('#rd-body .xref').forEach(x => {
  const fire = () => activateRef(x);
  x.onclick = fire;
  x.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fire(); } };
});
```

### A4.2 The four reference kinds

| `data-k` | `data-id` | Right pane shows | Onward actions |
|---|---|---|---|
| `signal` | `HW-2400` | severity/domain/source, title, summary, `.kv` record | `open on map` Â· `animate lead-up` Â· `open in inbox` |
| `scene` | `SCN-4471` | sensor, vendor, date pair, findings above 80% | `open change detection` |
| `node` | `N02` | object type, risk, up to 5 relationships with confidence | `open in ontology` |
| `region` | `EMEA` | signal count, critical count, `.evrow` list | rows are individually clickable |

### A4.3 `activateRef` â the whole mechanism

```js
function activateRef(el, quiet) {
  $$('#rd-body .xref').forEach(x => x.classList.toggle('active', x === el));
  if (!rdMini) rdMini = makeMinimap('#rd-mini');
  const kind = el.dataset.k, id = el.dataset.id, box = $('#rd-ctx');

  if (kind === 'signal') {
    const e = D.events.find(x => x.id === id); if (!e) return;
    $('#rd-mini-t').textContent = e.place;
    $('#rd-mini-s').textContent = zulu(e.ts);
    const ctx = D.events.filter(o => o.id !== e.id &&
      d3.geoDistance([e.lon,e.lat],[o.lon,o.lat]) * 6371 < 1400)
      .map(o => ({ lon:o.lon, lat:o.lat, color: SEV[o.severity].color }));
    rdMini.show(e.lon, e.lat, { label:e.place, color:SEV[e.severity].color, context:ctx, span:16 });
    box.innerHTML = /* signal card + .kv + three action buttons */;
    on('#rd-map',    'click', () => { window.HWopen('map'); window.HWselect(e.id);
                                      setTimeout(() => { M.flyTo(e.lon,e.lat,5);
                                        setTimeout(() => M.ping(e.lon,e.lat), 700); }, 60); });
    on('#rd-replay', 'click', () => replayOnMap(e.id));
    on('#rd-inbox',  'click', () => window.HWopen('inbox'));
  }
  /* scene | node | region â same shape: set minimap, fill box, wire onward action */
}
```

Called with `quiet=true` on first render so the context pane is never empty on entry.

### A4.4 The context minimap

A 196px pane-top map. It is **not** the situation map â it is a locator that answers "where
is this?" without leaving the text.

```css
.minimap{position:relative;height:196px;flex:none;border-bottom:1px solid var(--line);background:#12161a}
.minimap svg{width:100%;height:100%;display:block}
.minimap .mmhead{position:absolute;top:6px;left:8px;right:8px;z-index:2;display:flex;
  align-items:center;gap:8px;font-size:10.5px;color:var(--txt-3);pointer-events:none}
.mm-land{fill:#242b31;stroke:#2f373e;stroke-width:.5;vector-effect:non-scaling-stroke}
.mm-ping{fill:none;stroke:#c4453c;stroke-width:1.2;vector-effect:non-scaling-stroke}
.mm-ev{stroke:#12161a;stroke-width:.8;vector-effect:non-scaling-stroke}
.mm-lbl{font-size:8.5px;fill:#c2cbd3;paint-order:stroke;stroke:#12161a;stroke-width:2.6px}
```

```js
function makeMinimap(hostSel) {
  const host = $(hostSel), svg = d3.select(host).select('svg');
  let proj = d3.geoEquirectangular(), path = d3.geoPath(proj);
  const gLand = svg.append('g'), gFx = svg.append('g');

  function focus(lon, lat, spanDeg) {
    const w = host.clientWidth || 300, h = host.clientHeight || 196, s = spanDeg || 26;
    svg.attr('viewBox', `0 0 ${w} ${h}`);
    proj.fitExtent([[4,4],[w-4,h-4]], { type:'Polygon', coordinates:[[
      [lon-s, lat+s*.62],[lon+s, lat+s*.62],[lon+s, lat-s*.62],[lon-s, lat-s*.62],[lon-s, lat+s*.62]]] });
    path = d3.geoPath(proj);
    gLand.selectAll('path').data(world ? world.features : []).join('path')
      .attr('class','mm-land').attr('d', path);
  }

  return {
    focus,
    async show(lon, lat, opts) {
      if (!world) await worldReady;
      focus(lon, lat, opts && opts.span);
      gFx.selectAll('*').remove();
      const p = proj([lon, lat]); if (!p) return;

      (opts.context || []).forEach(c => {              // surrounding signals, small
        const q = proj([c.lon, c.lat]); if (!q) return;
        gFx.append('rect').attr('class','mm-ev')
          .attr('x', q[0]-3).attr('y', q[1]-3).attr('width',6).attr('height',6)
          .attr('transform', `rotate(45 ${q[0]} ${q[1]})`)
          .attr('fill', c.color || '#6d7883').attr('opacity', .8);
      });

      gFx.append('rect').attr('class','mm-ev')                      // the subject, larger
        .attr('x', p[0]-5).attr('y', p[1]-5).attr('width',10).attr('height',10)
        .attr('transform', `rotate(45 ${p[0]} ${p[1]})`)
        .attr('fill', opts.color || '#c4453c');
      gFx.append('text').attr('class','mm-lbl')
        .attr('x', p[0]+10).attr('y', p[1]+3).text(opts.label || '');

      // two staggered pings, STEPPED TIMERS not d3 transitions (see A10)
      [0, 480].forEach(delay => {
        const c = gFx.append('circle').attr('class','mm-ping').attr('cx',p[0]).attr('cy',p[1]).attr('r',4);
        for (let s = 1; s <= 20; s++) setTimeout(() => {
          const f = s/20, e = 1 - Math.pow(1-f, 3);
          c.attr('r', 4 + 36*e).attr('stroke-opacity', 1-e);
          if (s === 20) c.remove();
        }, delay + s*75);
      });
    },
    clear() { gFx.selectAll('*').remove(); }
  };
}
```

Span per kind: **signal 16Â°** Â· scene 10Â° Â· node 20Â° Â· region 46Â°. A region needs the wide
frame to show distribution; a scene needs the tight one to show a single site.

### A4.5 Guided walkthrough

A briefing that presents itself. Steps every reference at 3.6s, scrolling each into view.

```js
on('#rd-tour', 'click', () => {
  const refs = $$('#rd-body .xref'); if (!refs.length) return;
  if (R.tour) {                                   // toggle off
    clearInterval(R.tour); R.tour = null;
    $('#rd-tour').innerHTML = '<svg><use href="#i-play"/></svg> guided walkthrough';
    return;
  }
  let i = 0;
  $('#rd-tour').innerHTML = '<svg><use href="#i-pause"/></svg> stop walkthrough';
  activateRef(refs[0]);
  R.tour = setInterval(() => {
    if (++i >= refs.length) {
      clearInterval(R.tour); R.tour = null;
      $('#rd-tour').innerHTML = '<svg><use href="#i-play"/></svg> guided walkthrough';
      return;
    }
    activateRef(refs[i]);
    refs[i].closest('p,li,div').scrollIntoView({ block:'center', behavior:'smooth' });
  }, 3600);
});
```

**Leaving the module must stop the timer** â never leave an interval running in a hidden
view:

```js
if (id !== 'reader' && R.tour) { clearInterval(R.tour); R.tour = null; }
```

### A4.6 The reference index

The left rail enumerates every reference in document order, so the reader is navigable
without scrolling:

```js
const refs = $$('#rd-body .xref');
$('#rd-ref-c').textContent = refs.length;
$('#rd-refs').innerHTML = refs.map((r,i) =>
  `<li><a href="#" data-i="${i}"><span>${String(i+1).padStart(2,'0')}</span>
   <span>${r.textContent.replace(' â¸','')}</span></a></li>`).join('');
$$('#rd-refs a').forEach(a => a.onclick = ev => { ev.preventDefault(); activateRef(refs[+a.dataset.i]); });
```

---

## A5. Reader content â section by section

Order is fixed. Every generated sentence is a deterministic template (Â§A8) so the output is
reproducible; an LLM may replace the prose but must return the same shape.

**1 Â· Header** â `h1` title, then `.sub`:
`BRF-0436 Â· Global Â· Executive committee Â· issued 03SEP 0941Z Â· INTERNAL // RISK`

**2 Â· Executive judgement** â two paragraphs + a bottom-line callout.
Paragraph 1 carries the region references and the single most consequential development.
Paragraph 2 carries confidence and the imagery scene reference. The callout is one
imperative sentence containing a corridor reference.

**3 Â· Assessment by theme** â top four domains. Each: an `h3`
`Maritime & chokepoints Â· 4 signals`, a generated paragraph with up to three place
references, then up to three bullets of the form
`HW-2400 â <first sentence of the summary>.` (the ID is the reference).

**4 Â· Network and attribution** â reader-only section; the print document carries the full
appendix instead. Three ontology object references, and an honest sentence on the strongest
and weakest assertions in the set.

**5 Â· Indicators and warnings** â conditional bullets, one per domain present, each a
falsifiable trigger with a consequence, plus one standing rule.

**6 Â· Sourcing and method** â counts, feeds, mean confidence, imagery scenes and live tracks
used, the fact that references are clickable, and an explicit statement that this is
generated from the console corpus and is illustrative, not live reporting.

---

## A6. Print layout â `#view-doc`

```
grid-template-columns: 242px  1fr
                       âââââ  âââ
                       rail   desk
```

Left rail: the briefing register as `.briefrow` two-line rows, then a **Contents** group of
`[page] [section]` rows that scroll the desk.

Toolbar: `BRF-0436 Â· INTERNAL // RISK Â· 12 signals` Â· `back to reader` Â· zoom segment
(75/100/125%) Â· `print / pdf` Â· `distribute`.

### A6.1 The page

```css
.docdesk{flex:1;min-height:0;overflow:auto;background:#111417;padding:20px 0 56px}
.docpage{width:816px;min-height:1056px;margin:0 auto 20px;   /* US Letter @ 96dpi */
  background:#f4f2ee;color:#1b1f24;padding:62px 70px 54px;
  box-shadow:0 8px 30px rgba(0,0,0,.5);position:relative;
  display:flex;flex-direction:column;                        /* lets the folio sink */
  font-family:'Times New Roman',Times,Georgia,serif}         /* THE decision */
.docpage h1{font-size:26px;line-height:1.16;margin:0 0 10px;font-weight:700;letter-spacing:-.01em}
.docpage h2{font-family:var(--font);font-size:12px;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;color:#33383f;margin:24px 0 8px;
  border-bottom:1px solid #b9b5ac;padding-bottom:4px}
.docpage h3{font-size:13.5px;margin:15px 0 4px;font-weight:700}
.docpage p{font-size:13px;line-height:1.6;margin:0 0 9px;color:#22272d;text-wrap:pretty}
.docpage .lede{font-size:14px;line-height:1.58}
.docpage .kicker{font-family:var(--font);font-size:9px;letter-spacing:.17em;
  text-transform:uppercase;color:#5f6772;margin-bottom:13px}
.docpage .stamp{position:absolute;top:20px;right:70px;font-family:var(--font);
  font-size:8.5px;letter-spacing:.14em;color:#7d7870}
.docpage .pno{margin-top:auto;padding-top:20px;display:flex;justify-content:space-between;
  font-family:var(--font);font-size:8.5px;letter-spacing:.11em;color:#7d7870;
  border-top:1px solid #cdc8bf}
.docpage table{width:100%;border-collapse:collapse;margin:6px 0 12px;font-size:12px}
.docpage th{text-align:left;font-family:var(--font);font-size:8.5px;letter-spacing:.1em;
  text-transform:uppercase;color:#5a6270;border-bottom:1px solid #1b1f24;
  padding:0 8px 4px 0;font-weight:700}
.docpage td{padding:4px 8px 4px 0;border-bottom:1px solid #d7d2c9;vertical-align:top;color:#22272d}
.docpage .callout{border-left:2px solid #1b1f24;padding:2px 0 2px 12px;margin:11px 0;
  font-size:13px;line-height:1.58}
.docpage .sevdot{display:inline-block;width:7px;height:7px;transform:rotate(45deg);margin-right:6px}
```

**Serif body is the single highest-leverage decision in this document.** It does more for
the "issued report" feel than any other property. Headings stay sans, which is what real
institutional reports do.

`display:flex; flex-direction:column` + `.pno{margin-top:auto}` pins the folio to the
bottom of a short page. Do not use absolute positioning â it breaks in print.

Colours are paper, not screen: `#f4f2ee` stock, `#1b1f24` ink, `#d7d2c9` rules. Never `#fff`
or `#000`.

### A6.2 Page plan

**Page 1 â judgement.** Kicker (`Horizon Watch Â· intelligence briefing Â· BRF-0436`), `h1`,
rule, a 3Ã2 metadata table (scope/horizon, audience/issued, evidence set/drafted by),
**Executive judgement** (lede + support + `Bottom line.` callout), **Signals driving this
assessment** â a 9-row table: ref, severity (`.sevdot` + word), signal, location.

**Page 2 â themes.** **Assessment by theme** (h3 per domain, paragraph, up to three cited
bullets), then **Regional distribution** â region, signals, critical, dominant theme.

**Page 3 â consequence.** **Exposure and continuity impact** (dependency table with signal
count, severity peak, standing mitigation), **Indicators and warnings**, **Recommended
actions** (numbered: action, owner, by D+n), **Sourcing and method**.

**Page 4 â Appendix A, link analysis.** Â§A7.

Three pages for a 12-signal set; more as the set grows.

### A6.3 Contents navigation

```js
$('#doc-toc').innerHTML = [
  ['pg1','Executive judgement','1'], ['pg1','Signals driving this assessment','1'],
  ['pg2','Assessment by theme','2'],  ['pg2','Regional distribution','2'],
  ['pg3','Exposure and continuity impact','3'], ['pg3','Indicators and warnings','3'],
  ['pg3','Recommended actions','3'],  ['pg3','Sourcing and method','3'],
  ['pg4','Appendix A â link analysis','4']
].map(([p,t,n]) => `<li><a href="#" data-p="${p}"><span>${n}</span><span>${t}</span></a></li>`).join('');

$$('#doc-toc a').forEach(a => a.onclick = ev => {
  ev.preventDefault();
  const el = $('#' + a.dataset.p), desk = $('#doc-desk');
  desk.scrollTo({ top: el.offsetTop - desk.offsetTop - 16, behavior:'smooth' });
});
```

**Never `scrollIntoView` on the desk** â it scrolls ancestor containers and displaces the
whole app shell. Compute the offset and scroll the desk itself.

### A6.4 Zoom

```js
$$('#doc-zoom button').forEach(b => b.onclick = () => {
  $$('#doc-zoom button').forEach(x => x.setAttribute('aria-pressed', x === b));
  $$('.docpage').forEach(p => {
    p.style.transform = `scale(${b.dataset.z})`;
    p.style.transformOrigin = 'top center';
    p.style.marginBottom = (22 * +b.dataset.z - (1 - +b.dataset.z) * 1056) + 'px';
  });
});
```

The `marginBottom` correction is required: `transform` does not affect layout, so scaled
pages otherwise overlap or leave a gap.

### A6.5 Print CSS â verbatim

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

Every line earns its place: `#app{display:block}` releases the viewport grid;
`.view{display:none!important}` then one override is how you print the document regardless
of which module is active; `break-after:page` with a `:last-child` exception prevents a
trailing blank sheet.

---

## A7. Appendix A â link analysis (page 4)

```js
window.HWappendix = {
  page(d) {
    const sigs = d.sel.slice(0, 10);
    const objs = X.nodes.filter(n =>
      sigs.some(e => e.place.includes(n.label.split(' ')[0]) || n.label.includes(e.country)));
    const seen = new Set(objs.map(o => o.id));
    const links = X.links.filter(l => seen.has(l.s) && seen.has(l.t));
    const inferred = links.filter(l => l.inferred);
    const nm = id => (X.nodes.find(n => n.id === id) || {}).label || id;

    return `<section class="docpage" id="pg4"><div class="stamp">${d.meta.cls}</div>
      <h2>Appendix A â link analysis</h2>
      <p>Objects and relationships in the ontology that bear on this evidence set. Asserted
      relationships are supported by a document or a record; inferred relationships are
      pattern matches carried below full confidence and should not be treated as established.</p>
      <table>â¦objects: ref, object, type, risk, standing noteâ¦</table>
      <h3>Relationships</h3>
      <table>â¦from, relationship, to, confidence, asserted/inferredâ¦</table>
      <div class="callout"><b>Method note.</b> ${links.length} relationships,
        ${inferred.length} of them inferred. Inferred links are generated from co-occurrence,
        shared registry data and overlapping dark-AIS windows; they are review candidates,
        not conclusions. Confidence below 80% is reported as inferred by convention.</div>
      <div class="pno"><span>${d.meta.cls}</span><span>${d.meta.id}</span><span>PAGE 4</span></div>
    </section>`;
  }
};
```

Appended with one line in `renderDoc`. The method note is not decoration â a link-analysis
appendix without a stated basis is an accusation.

---

## A8. Generated language

British English, sentence case, declarative, quantified, unemphatic. **No em dashes, no
emoji, no adjectives of intensity.** Every template below is the reference behaviour and the
fallback when an LLM response fails validation.

**Executive judgement (lede)**
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

**Recommended actions** â five rows above six signals, three otherwise. Owners from
`Logistics / Compliance / Regional security / Group security / Intelligence`, deadlines
`D+0 â¦ D+10`.

**With a real LLM**, keep the staged UI and send one structured request:

```
System: You are an intelligence editor for a corporate risk team. Write in British English,
sentence case, plain declarative prose. No adjectives of emphasis, no em dashes, no emoji,
no hedging clichÃ©s. Quantify only what the evidence states. Cite signal IDs inline. Never
invent events, sources, casualties or attribution.

User: {classification, audience, scope, horizon, standing_instruction,
       signals:[{id,ts,place,country,domain,severity,conf,source,title,summary,impacts}],
       imagery_findings:[{scene,aoi,label,type,conf}],
       ontology:[{id,label,type,risk}], links:[{s,t,kind,conf,inferred}],
       asset_register_matches:[â¦]}

Return JSON: { judgement, second_para, bottom_line,
               themes:[{domain,text,bullets[]}], warnings[], actions[[text,owner,by]] }
```

Validate against the schema. On a missing field fall back to the template â never ship an
empty section.

---

## A9. The generator, for completeness

Three panes: `290px 1fr 322px` â parameters Â· evidence set Â· generation.

**Left:** title, scope, audience, forecast-horizon segment, six section checkboxes,
classification, standing-instruction textarea.

**Centre:** the corpus as a checkbox grid sorted by severity then recency, with
`select top 12 by severity` and `clear`. The briefing basket merges in on entry. A 2px
progress line at the foot.

**Right:** a seven-step checklist, the agent log, run controls, and a print button.

```js
const STEPS = [
  ['Resolve parameters and scope',           260],
  ['Assemble evidence set',                  420],
  ['Deduplicate and cluster signals',        700],
  ['Score exposure against asset register',  820],
  ['Draft judgement and section text',      1400],
  ['Apply house style and classification',   520],
  ['Compile document and paginate',          480]
];
```

**~4.6s total is deliberate. Latency is information; instant is not credible.**

Step states: pending (index in a grey ring) Â· running (spinning `--acc-hi` ring) Â· done
(tick, green ring, elapsed time right-aligned).

Log grammar â mono, `white-space:pre-wrap`, auto-scrolled, `<b>` white, `<i>` green,
`<u>` amber:

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
between "started" and "finished" otherwise wedges the generator until reload. An empty
evidence set warns and does nothing.

---

## A10. Traps

**1 Â· Animation frames are not guaranteed.** In a throttled or backgrounded frame the
callback never runs, and because **d3 transitions are rAF-driven**, every `.transition()`
silently becomes a no-op â minimap pings never expand, fly-to never moves. Drive pulses with
stepped timers and hand-rolled easing (Â§A4.4), and route zoom through a helper that falls
back to synchronous application.

**2 Â· `.view` needs `height:100%`.** Without it the grid row is content-sized, `.docdesk`
grows to full content height, and `overflow:auto` stops scrolling â page 3 becomes
unreachable. Every scroll container is `flex:1; min-height:0; overflow:auto`, never
`height:100%`.

**3 Â· Never `scrollIntoView` on the desk.** Â§A6.3.

**4 Â· References are spans.** Â§A4.1.

**5 Â· Build print pages at generation time**, not on first visit, so `printable briefing`
and `âP` are instant.

**6 Â· Kill the walkthrough interval on module change.** Â§A4.5.

---

## A11. Briefing acceptance

- [ ] `reader` is in the rail; `doc` is not.
- [ ] Generation lands in the reader with a retitled tab `BRF-0436 Â· â¦`.
- [ ] `printable briefing`, the generator's print button and `back to reader` all work, and
      all three show the same document.
- [ ] Every reference activates, fills the right pane, and re-frames the minimap.
- [ ] A long reference **wraps** and is fully readable at 720px.
- [ ] References are keyboard-activatable and show a focus ring.
- [ ] `animate lead-up` plays the converging sequence on the situation map.
- [ ] Guided walkthrough steps every reference and stops on leaving the module.
- [ ] Contents links scroll the desk, not the app.
- [ ] Zoom at 75/125% does not overlap pages.
- [ ] `print / pdf` produces one page per sheet with no app chrome and no trailing blank.
- [ ] A 12-signal set produces 4 pages, the fourth being Appendix A.
- [ ] Prose contains no em dashes, no emoji, no marketing adjectives.

---

# PART B â THE MOBILE COMPANION

`HorizonWatchMobile.html` + `hw-mobile.js`. Shares `hw-data.js` and `hw-data2.js`.

## B1. What it is

**Not a responsive console.** The console stays desktop-only (floor 1280px). This is a
separate surface for an on-call security lead, doing **four jobs well** rather than ten
badly. A 250px analyst panel does not survive a 390px viewport, and nobody needs ten modules
at 3am.

## B2. Frame

390Ã844 in a phone bezel â `ios_frame` starter geometry as plain CSS (no React/Babel: three
more CDN loads on an already-fragile path is the wrong trade).

```css
.device{width:390px;height:844px;border-radius:48px;overflow:hidden;position:relative;
  background:#000;box-shadow:0 40px 80px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.12)}
.island{position:absolute;top:11px;left:50%;transform:translateX(-50%);
  width:126px;height:37px;border-radius:24px;background:#000;z-index:50}
.homebar{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);
  width:139px;height:5px;border-radius:100px;background:rgba(255,255,255,.7);z-index:40}

.app{position:absolute;inset:0;display:grid;
  grid-template-rows:54px 52px 1fr 78px}   /* status inset Â· header Â· content Â· tab bar */
```

The tab bar's last 22px is home-indicator padding.

**Mobile deltas from the console:** body 15px (not 12.5) Â· minimum target 46px Â· `:active`
not `:hover` Â· detail arrives as a bottom **sheet**, not a side panel Â· filter rows are
34px chips that scroll horizontally Â· same tokens, same severity ramp, same diamond.

## B3. The four tabs

| Tab | Behaviour |
|---|---|
| **Alerts** | Escalations + critical/high, badge count of unactioned. Filters: *needs action / escalated / critical / all*. Tap â sheet: severity, domain, title, assessment, `.kv` (location, received, source, confidence + multi/single-source, corroboration count, touched dependencies), then **Acknowledge Â· Escalate Â· Show on map Â· Note to desk**. Acknowledged rows drop to 55% opacity rather than vanishing, so the queue reads as *worked* |
| **Brief** | The briefing at phone measure (15px/1.68), references live. Signals open the signal sheet; the imagery scene opens its detection list; a region lists its signals |
| **Map** | Natural Earth geometry, severity diamonds, AIS hulls and ADS-B airframes rotated to heading (sanctioned red, watchlisted amber), filter chips, tap â bottom card with one onward action |
| **Note** | Press-and-hold voice note with live timer and waveform, written note, routing (duty desk / group security / regional lead / logistics), attachable reference, outbox that goes `queued â sent` |

Scope is deliberately narrow: the desk sees everything, the phone shows what needs a
decision.

## B4. Six defects to avoid

**1 Â· Never take the map out of the grid.** `#view-map{position:absolute;inset:0}` as a child
of the grid container paints **above** the in-flow header and tab bar â the map covers both
and the user is trapped on the tab. It must occupy the scroller's row:

```css
#view-map{grid-row:3;position:relative;display:none;flex-direction:column;
  min-height:0;overflow:hidden}
#view-map.on{display:flex}
```

**2 Â· One bound zoom behaviour.** `zoom.transform` dispatches only to *that instance's*
listeners, so calling it on a freshly constructed `d3.zoom()` moves nothing and desyncs
`node.__zoom` from what is rendered â the next drag snaps. Hoist it
(`let mzoom; mzoom = d3.zoom()â¦; msvg.call(mzoom)`) and drive every programmatic move
through `msvg.call(mzoom.transform, â¦)`.

**3 Â· Re-apply the counter-scale on every redraw.** The zoom handler compensates glyphs with
`scale(1/k)`; a redraw that rewrites `transform` without it snaps every glyph to full size â
grossly oversized at k=4â12.

```js
const zoomK = () => msvg?.node() ? d3.zoomTransform(msvg.node()).k : 1;
function rescale(k = zoomK()) {
  gMark.selectAll('g.mk').attr('transform', d => `translate(${proj([d.lon,d.lat])}) scale(${1/k})`);
  gTrk.selectAll('g.trk').attr('transform', d => `translate(${proj([d.lon,d.lat])}) scale(${1/k})`);
}
```
Call it from the zoom handler **and** the end of `drawMap()`.

**4 Â· Inline references are spans, not buttons.** Same reason as Â§A4.1, worse here: the
column is 358px and `.screen{overflow-x:hidden}` clips rather than scrolls, so a long
reference is cut off mid-sentence with no way to read it.

**5 Â· Reset `padding` in the global `button` rule.** Chrome and Safari apply ~`1px 6px`;
omitting padding from the reset leaves dead space either side of every inline control, which
shows as gaps mid-sentence. Safe because `.btn`, `.chip`, `.arow` and `.tabbar button` all
declare their own.

**6 Â· A reference set from anywhere must survive the note form.** The `#nref` option list is
built from the on-call queue (escalated/critical/high, capped at 12). A moderate signal
reached through a Brief reference had no matching `<option>`, so the select silently fell
back to "None" and the note sent unattached. Carry the intent in state (`S.pendingRef`) and
have the renderer always include the currently-referenced record, prepending it when the
queue does not contain it.

## B5. Offline degradation â the point of the product

A companion for poor connectivity must not die with its CDN.

- **Libraries load AFTER the app, asynchronously, with a 6s timeout and three mirrors**
  (unpkg â jsDelivr â cdnjs). A blocking `<head>` script paints *nothing* until it resolves,
  and if the host stalls rather than erroring, that is forever.
- **Only the Map tab may depend on d3.** Alerts and Brief use local helpers: a plain
  haversine for the 800km corroboration count, and `reduce`-based `countBy`/`mean` instead
  of `d3.rollups`/`d3.mean`.
- `initMap()` checks for `d3`/`topojson`; while pending it shows *"Loading map geometryâ¦"*,
  on failure it sets `mapDead` and shows *"Map geometry unavailable offline. Alerts, Brief
  and Note still work."* Every other map function early-returns on the flag.
- A `window.HWmobileLibs(ok)` callback lets the loader promote the map when the libraries
  finally arrive.

## B6. Tablet

The brief was "tablet as the full console". That holds in landscape on a 12.9â³ iPad
(1366pt), but the console floor is 1280, so an 11â³ iPad at 1194 clips. Either accept
landscape-on-large-tablet only, or drop the floor to 1024 â achievable without touching the
layout above 1280, but **not currently done**.

## B7. Mobile acceptance

- [ ] Every tab reachable from every other; the Map tab never covers header or tab bar.
- [ ] `Show on map` recentres, and a subsequent pinch does not snap.
- [ ] At kâ6, toggling a filter chip keeps glyph size.
- [ ] Acknowledge from the sheet decrements the badge and recedes the row.
- [ ] Every brief reference opens the right sheet.
- [ ] A long reference wraps and is fully readable at 390px.
- [ ] Inline references sit tight against prose, are keyboard-activatable, show focus.
- [ ] A *moderate* signal reached via Brief â **Note to desk** keeps its attachment.
- [ ] Press-and-hold produces a plausible duration; sliding off cancels.
- [ ] With d3 blocked, Alerts and Brief are fully usable; Map shows its offline message.
- [ ] No hit target under 44px.
