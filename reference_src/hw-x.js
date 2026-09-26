/* Horizon Watch â extension modules:
   map annotation tools, live AIS/ADS-B tracks, port & airport layer,
   replay minimap with map fly-to animation, ontology graph,
   satellite change detection, interactive briefing reader. */
(function () {
  const D = window.HW, X = window.HW2, DOM = D.DOMAINS, SEV = D.SEV, S = window.HWS;
  const { $, $$, zulu, hhmm, ago, esc } = window.HWU;
  const on = (s, e, f) => { const n = typeof s === 'string' ? $(s) : s; if (n) n.addEventListener(e, f); };
  const M = window.HWmap;

  let world = null;
  const worldReady = fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')
    .then(r => r.json()).then(t => { world = topojson.feature(t, t.objects.countries); return world; })
    .catch(() => null);

  /* ââââââââââââââââ A Â· MAP LAYERS ââââââââââââââââ */
  const L = { infra: true, vessels: true, aircraft: true, anno: true, sanctionedOnly: false };
  const anns = X.annotations.slice();
  let annSel = null, tool = 'select', draft = [];

  /* glyph paths, drawn at unit scale then counter-scaled by zoom */
  const shipPath = 'M-4.2,2.6 L-3,5 L3,5 L4.2,2.6 L2.6,-1 L1.1,-5.4 L-1.1,-5.4 L-2.6,-1 Z';
  const planePath = 'M0,-6.4 L1.1,-1.6 L6.4,1.4 L6.4,2.6 L1.1,1.4 L0.8,4.4 L2.6,5.8 L2.6,6.6 L0,5.8 L-2.6,6.6 L-2.6,5.8 L-0.8,4.4 L-1.1,1.4 L-6.4,2.6 L-6.4,1.4 L-1.1,-1.6 Z';

  function drawInfra(proj, path, k) {
    const g = M.layer('infra').attr('class', 'x-infra infra');
    const data = L.infra ? X.places : [];
    const sel = g.selectAll('g.inf').data(data, d => d.id);
    sel.exit().remove();
    const en = sel.enter().append('g').attr('class', 'inf');
    en.each(function (d) {
      const n = d3.select(this);
      if (d.kind === 'port') { n.append('circle').attr('r', 4.2); n.append('path').attr('d', 'M0,-4.2 V4.2 M-3,-1.2 H3 M-4.6,1.4 a4.6,4.6 0 0 0 9.2,0'); }
      else { n.append('path').attr('d', 'M0,-4.4 L.9,-1.1 L4.6,.9 L4.6,1.9 L.9,.9 L.7,3.2 L2,4.2 L2,4.9 L0,4.2 L-2,4.9 L-2,4.2 L-.7,3.2 L-.9,.9 L-4.6,1.9 L-4.6,.9 L-.9,-1.1 Z'); }
      n.append('text').attr('x', 7).attr('y', 3).text(d.code);
    });
    en.merge(sel).attr('transform', d => { const p = proj([d.lon, d.lat]); return p ? `translate(${p}) scale(${1 / k})` : 'translate(-9999,0)'; });
  }

  function drawTracks(proj, path, k) {
    const g = M.layer('tracks');
    let data = [];
    if (L.vessels) data = data.concat(X.vessels);
    if (L.aircraft) data = data.concat(X.aircraft);
    if (L.sanctionedOnly) data = data.filter(d => d.sanctioned || d.watch);
    const sel = g.selectAll('g.trk').data(data, d => d.mmsi || d.icao);
    sel.exit().remove();
    const en = sel.enter().append('g')
      .attr('class', d => 'trk ' + d.kind + (d.sanctioned ? ' sanctioned' : '') + (d.watch ? ' watch' : ''));
    en.append('path').attr('class', 'wake');
    en.append('path').attr('class', 'body');
    en.append('text');
    en.on('mousemove', (ev, d) => M.tip(ev, trackTip(d)))
      .on('mouseleave', M.tipHide)
      .on('click', (ev, d) => { ev.stopPropagation(); selectTrack(d); });
    const all = en.merge(sel);
    all.attr('transform', d => { const p = proj([d.lon, d.lat]); return p ? `translate(${p}) scale(${1 / k})` : 'translate(-9999,0)'; })
      .classed('sel', d => trackSel && (d.mmsi || d.icao) === trackSel);
    all.select('path.body').attr('d', d => d.kind === 'vessel' ? shipPath : planePath)
      .attr('transform', d => `rotate(${d.hdg})`);
    all.select('path.wake').attr('d', d => {
      const len = d.kind === 'vessel' ? 22 : 34;
      const rad = (d.hdg + 180) * Math.PI / 180;
      return `M0,0 L${Math.sin(rad) * len},${-Math.cos(rad) * len}`;
    });
    all.select('text').attr('x', 8).attr('y', -6)
      .text(d => k > 2.2 ? (d.name || d.callsign) : '');
  }
  function trackTip(d) {
    return d.kind === 'vessel'
      ? `<b>${esc(d.name)}${d.sanctioned ? '  â' : ''}</b><span class="lbl">${d.type} Â· ${d.flag} Â· MMSI ${d.mmsi}<br>${d.spd} kn Â· hdg ${d.hdg}Â° Â· dest ${d.dest}${d.ais === 'dark' ? ' Â· AIS DARK' : ''}</span>`
      : `<b>${esc(d.callsign)}</b><span class="lbl">${d.type} Â· ${d.role} Â· ICAO ${d.icao}<br>FL${Math.round(d.alt / 100)} Â· ${d.spd} kt Â· hdg ${d.hdg}Â°</span>`;
  }
  let trackSel = null;
  function selectTrack(d) {
    window.HWreveal();
    trackSel = d.mmsi || d.icao;
    M.redraw();
    const box = $('#inspector');
    $('#insp-title').textContent = d.name || d.callsign;
    const rows = d.kind === 'vessel'
      ? [['MMSI', d.mmsi], ['Type', d.type], ['Flag', d.flag], ['Speed', d.spd + ' kn'], ['Heading', d.hdg + 'Â°'],
         ['Destination', d.dest], ['AIS', d.ais === 'dark' ? 'Not transmitting' : 'Transmitting'],
         ['Position', d.lat.toFixed(3) + ', ' + d.lon.toFixed(3)]]
      : [['ICAO', d.icao], ['Type', d.type], ['Role', d.role], ['Altitude', 'FL' + Math.round(d.alt / 100)],
         ['Ground speed', d.spd + ' kt'], ['Heading', d.hdg + 'Â°'], ['Position', d.lat.toFixed(3) + ', ' + d.lon.toFixed(3)]];
    const onto = X.nodes.find(n => n.label === (d.name || d.callsign));
    box.innerHTML = `<div class="detail">
      <div class="row">
        <span class="tag ${d.sanctioned ? 'red' : d.watch ? 'amber' : ''}">${d.sanctioned ? 'Sanctioned party' : d.watch ? 'Watchlisted' : d.kind === 'vessel' ? 'AIS track' : 'ADS-B track'}</span>
        ${d.ais === 'dark' ? '<span class="tag amber">AIS dark</span>' : ''}
        <span class="lbl" style="margin-left:auto">${d.kind === 'vessel' ? 'AIS' : 'ADS-B'} Â· live</span></div>
      <h2>${esc(d.name || d.callsign)}</h2>
      <div class="trkphoto">
        <div class="silh"><svg><use href="#i-silh-${d.kind === 'vessel' ? 'ship' : 'plane'}"/></svg></div>
        <image-slot id="ph-${d.icao || d.mmsi}" placeholder="Drop a photo of ${esc(d.name || d.callsign)} (${esc(d.type)})"></image-slot>
        <div class="cap"><b>${esc(d.type)}</b><span>${d.kind === 'vessel' ? esc(d.flag) : esc(d.role)}</span>
          <span style="margin-left:auto">${d.kind === 'vessel' ? 'hull imagery' : 'airframe imagery'}</span></div>
      </div>
      <div class="card"><span class="lbl">Track</span><dl class="kv">${rows.map(r => `<dt>${r[0]}</dt><dd class="${/MMSI|ICAO|Position|Speed|Heading|Altitude/.test(r[0]) ? 'mono' : ''}">${esc(String(r[1]))}</dd>`).join('')}</dl></div>
      ${d.sanctioned ? '<div class="card"><span class="lbl">Screening</span><p>Matched against the restricted-party list. Any charter, bunkering or cargo association with this hull requires compliance sign-off before commitment.</p></div>' : ''}
      <div class="btnrow">
        <button class="btn sm" id="trk-centre">centre map</button>
        ${onto ? `<button class="btn sm" id="trk-onto"><svg><use href="#i-onto"/></svg> open in ontology</button>` : ''}
        <button class="btn sm primary" id="trk-note"><svg><use href="#i-pin"/></svg> annotate position</button></div>
    </div>`;
    on('#trk-centre', 'click', () => M.flyTo(d.lon, d.lat, 5));
    on('#trk-onto', 'click', () => openOntology(onto.id));
    (window.HWinspectorHooks || []).forEach(fn => { try { fn(box, null); } catch (e) { console.error(e); } });
    on('#trk-note', 'click', () => {
      anns.push({ id: 'ANN-' + String(anns.length + 1).padStart(2, '0'), kind: 'point', label: (d.name || d.callsign) + ' position', by: 'K. Almeida', ts: zulu(new Date()), lat: d.lat, lon: d.lon, note: 'Marked from track inspector.' });
      M.redraw(); renderAnnList(); window.HWtoast('Annotation added at track position', 'ok');
    });
  }

  function drawAnnotations(proj, path, k) {
    const g = M.layer('anno');
    const data = L.anno ? anns : [];
    const sel = g.selectAll('g.ann').data(data, d => d.id);
    sel.exit().remove();
    const en = sel.enter().append('g').attr('class', 'ann')
      .on('click', (ev, d) => { ev.stopPropagation(); annSel = d.id; M.redraw(); renderAnnList(); })
      .on('mousemove', (ev, d) => M.tip(ev, `<b>${esc(d.label)}</b><span class="lbl">${d.by} Â· ${d.ts}<br>${esc(d.note || '')}</span>`))
      .on('mouseleave', M.tipHide);
    const all = en.merge(sel).classed('sel', d => d.id === annSel);
    all.selectAll('*').remove();
    all.each(function (d) {
      const n = d3.select(this);
      if (d.kind === 'point') {
        const p = proj([d.lon, d.lat]); if (!p) return;
        n.append('path').attr('class', 'ann-point').attr('transform', `translate(${p}) scale(${1 / k})`)
          .attr('d', 'M0,0 L-4.6,-8 A5.3,5.3 0 1 1 4.6,-8 Z');
        n.append('text').attr('class', 'ann-label').attr('x', p[0] + 9 / k).attr('y', p[1] - 8 / k)
          .attr('font-size', 9.5 / k).text(d.label);
      } else if (d.kind === 'line' || d.kind === 'measure') {
        n.append('path').attr('class', 'ann-line').attr('d', path({ type: 'LineString', coordinates: d.pts }));
        const mid = proj(d.pts[Math.floor(d.pts.length / 2)]);
        if (mid) n.append('text').attr('class', 'ann-label').attr('x', mid[0] + 6 / k).attr('y', mid[1] - 6 / k)
          .attr('font-size', 9.5 / k).text(d.kind === 'measure' ? d.label : d.label);
      } else {
        n.append('path').attr('class', 'ann-area').attr('d', path({ type: 'Polygon', coordinates: [d.pts.concat([d.pts[0]])] }));
        const c = d3.geoCentroid({ type: 'Polygon', coordinates: [d.pts.concat([d.pts[0]])] });
        const p = proj(c);
        if (p) n.append('text').attr('class', 'ann-label').attr('x', p[0]).attr('y', p[1])
          .attr('text-anchor', 'middle').attr('font-size', 9.5 / k).text(d.label);
      }
    });
    /* live draft geometry */
    const dg = M.layer('draft'); dg.selectAll('*').remove();
    if (draft.length && (tool === 'scanbox' || tool === 'scanpoly')) {
      const poly = { type: 'Polygon', coordinates: [draft.concat([draft[0]])] };
      dg.append('path').attr('class', 'scan-shape').attr('d', path(poly));
      draft.forEach(pt => { const p = proj(pt); if (p) dg.append('circle').attr('class', 'scan-vertex')
        .attr('cx', p[0]).attr('cy', p[1]).attr('r', 2.8 / k); });
      return;
    }
    if (draft.length) {
      if (tool === 'area' && draft.length > 1)
        dg.append('path').attr('class', 'ann-area').attr('d', path({ type: 'Polygon', coordinates: [draft.concat([draft[0]])] }));
      if ((tool === 'line' || tool === 'measure') && draft.length > 1)
        dg.append('path').attr('class', 'ann-line').attr('d', path({ type: 'LineString', coordinates: draft }));
      draft.forEach(pt => { const p = proj(pt); if (p) dg.append('circle').attr('cx', p[0]).attr('cy', p[1]).attr('r', 2.6 / k).attr('fill', '#c8a04a'); });
      if (tool === 'measure' && draft.length > 1) {
        const km = d3.pairs(draft).reduce((a, [p, q]) => a + d3.geoDistance(p, q) * 6371, 0);
        const p = proj(draft[draft.length - 1]);
        if (p) dg.append('text').attr('class', 'ann-label').attr('x', p[0] + 8 / k).attr('y', p[1] - 8 / k)
          .attr('font-size', 10 / k).text(Math.round(km) + ' km / ' + Math.round(km * 0.539957) + ' nm');
      }
    }
  }

  window.HWmapHooks.push({ draw: (p, path, k) => { drawInfra(p, path, k); drawTracks(p, path, k); drawAnnotations(p, path, k); },
    zoom: () => M.redraw() });

  /* annotation tool behaviour */
  function setTool(t) {
    tool = t; draft = [];
    $$('#annobar .tool').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
    $('#mapwrap').classList.toggle('drawing', t !== 'select');
    $('#anno-hint').textContent = { select: 'Select', point: 'Click to place a marker',
      line: 'Click to add points Â· double-click to finish', area: 'Click to add corners Â· double-click to close',
      measure: 'Click to measure Â· double-click to finish',
      scanbox: 'Drag a rectangle to scan', scanpoly: 'Click corners Â· double-click to close' }[t];
    if (t !== 'scanbox' && t !== 'scanpoly') closeScan();
    M.svg.on('.zoom', null);
    if (t === 'select') M.svg.call(M.zoom);
    M.redraw();
  }
  $$('#annobar .tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));

  /* ââ scan-area drawing âââââââââââââââââââââââââââââââââââââââââââ
     Box: press-drag-release. Polygon: click corners, double-click to close.
     Either way the geometry lands in openScanPanel(), which slides the
     configuration panel in over the map. */
  let boxFrom = null;
  $('#mapsvg').addEventListener('mousedown', ev => {
    if (tool !== 'scanbox') return;
    ev.preventDefault();
    boxFrom = M.invert(ev.clientX, ev.clientY);
    if (!boxFrom) window.HWtoast('Start the box inside the mapped area', 'warn');
  });
  $('#mapsvg').addEventListener('mousemove', ev => {
    if (tool !== 'scanbox' || !boxFrom) return;
    const to = M.invert(ev.clientX, ev.clientY); if (!to) return;
    draft = normalizeRing(boxCorners(boxFrom, to)); M.redraw();
  });
  window.addEventListener('mouseup', ev => {
    if (tool !== 'scanbox' || !boxFrom) return;
    const to = M.invert(ev.clientX, ev.clientY);
    const from = boxFrom; boxFrom = null;
    if (!to) { draft = []; M.redraw(); return window.HWtoast('Finish the box inside the mapped area', 'warn'); }
    if (Math.abs(to[0] - from[0]) < .25 || Math.abs(to[1] - from[1]) < .25) {
      draft = []; M.redraw(); return window.HWtoast('Drag a larger box to scan', 'warn');
    }
    openScanPanel(boxCorners(from, to), 'box');
  });
  const boxCorners = (a, b) => [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];

  $('#mapsvg').addEventListener('click', ev => {
    if (tool === 'select' || tool === 'scanbox') return;
    const c = M.invert(ev.clientX, ev.clientY);
    if (!c) return window.HWtoast('Click inside the mapped area', 'warn');
    if (tool === 'point') { commit('point', null, [c]); return; }
    draft.push(c); M.redraw();
  });
  $('#mapsvg').addEventListener('dblclick', ev => {
    if (tool === 'select' || tool === 'scanbox' || draft.length < 2) return;
    ev.preventDefault();
    if (tool === 'scanpoly') {
      if (draft.length < 3) return window.HWtoast('A scan polygon needs at least three corners', 'warn');
      return openScanPanel(draft.slice(), 'polygon');
    }
    commit(tool, null, draft.slice());
  });
  let annRenaming = null;
  function commit(kind, label, pts) {
    const n = anns.length + 1;
    const km = kind === 'measure' ? d3.pairs(pts).reduce((a, [p, q]) => a + d3.geoDistance(p, q) * 6371, 0) : 0;
    const lbl = label || (kind === 'measure' ? `${Math.round(km)} km / ${Math.round(km * 0.539957)} nm`
      : kind === 'point' ? 'Marker ' + n : kind === 'area' ? 'Area ' + n : 'Route ' + n);
    const a = { id: 'ANN-' + String(n).padStart(2, '0'), kind, label: lbl, by: 'K. Almeida', ts: zulu(new Date()), note: '' };
    if (kind === 'point') { a.lat = pts[0][1]; a.lon = pts[0][0]; } else a.pts = pts;
    anns.push(a); annSel = a.id; draft = [];
    setTool('select');
    if (kind !== 'measure') annRenaming = a.id;
    renderAnnList();
    window.HWtoast(`${kind === 'measure' ? 'Measurement' : 'Annotation'} ${a.id} saved`, 'ok');
  }

  /* extra layer groups in the map left pane */
  function injectMapPanel() {
    if ($('#x-layers')) return;
    const host = $('#view-map .pane .scroll');
    const div = document.createElement('div');
    div.id = 'x-layers';
    div.innerHTML = `
      <div class="group">
        <button class="grouphead" aria-expanded="true"><svg class="chev" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 3.5L5 6.5 8 3.5"/></svg><h4>Live tracks</h4><span class="count" id="x-trk-c"></span></button>
        <ul class="tree" id="x-tracks"></ul>
      </div>
      <div class="group">
        <button class="grouphead" aria-expanded="true"><svg class="chev" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 3.5L5 6.5 8 3.5"/></svg><h4>Annotations</h4><span class="count" id="x-ann-c"></span></button>
        <div id="x-anns"></div>
      </div>`;
    host.appendChild(div);
    div.querySelectorAll('.grouphead').forEach(hd => hd.onclick = () => {
      const o = hd.getAttribute('aria-expanded') === 'true';
      hd.setAttribute('aria-expanded', !o); hd.nextElementSibling.classList.toggle('hidden', o);
    });
    renderTrackLayers(); renderAnnList();
  }
  function renderTrackLayers() {
    const rows = [
      ['vessels', 'Vessels (AIS)', X.vessels.length, 'i-ship'],
      ['aircraft', 'Aircraft (ADS-B)', X.aircraft.length, 'i-plane'],
      ['sanctionedOnly', 'Sanctioned / watchlisted only', X.vessels.filter(v => v.sanctioned).length + X.aircraft.filter(a => a.watch).length, 'i-flag'],
      ['infra', 'Ports & airports', X.places.length, 'i-anchor']
    ];
    $('#x-trk-c').textContent = (L.vessels ? 1 : 0) + (L.aircraft ? 1 : 0) + (L.infra ? 1 : 0) + '/3';
    $('#x-tracks').innerHTML = rows.map(([k, n, c, ic]) => `<li><div class="layer${L[k] ? '' : ' off'}" data-k="${k}">
      <svg style="width:12px;height:12px;flex:none;color:var(--txt-3)"><use href="#${ic}"/></svg>
      <span class="n">${n}</span><span class="c">${c}</span>
      <button class="eye"><svg style="width:13px;height:13px"><use href="#i-eye${L[k] ? '' : '-off'}"/></svg></button></div></li>`).join('');
    $$('#x-tracks .layer').forEach(n => n.onclick = () => { L[n.dataset.k] = !L[n.dataset.k]; renderTrackLayers(); M.redraw(); });
  }
  function renderAnnList() {
    $('#x-ann-c').textContent = anns.length;
    $('#x-anns').innerHTML = anns.map(a => `<div class="annrow" data-id="${a.id}" aria-selected="${a.id === annSel}">
      <svg class="g"><use href="#i-${a.kind === 'point' ? 'pin' : a.kind === 'area' ? 'poly' : a.kind === 'measure' ? 'measure' : 'path'}"/></svg>
      <div>${annRenaming === a.id
        ? `<input class="input annname" data-id="${a.id}" value="${esc(a.label)}" style="height:22px;font-size:12.5px">`
        : `<b>${esc(a.label)}</b>`}<em>${a.by} Â· ${a.ts}</em></div>
      <button class="rm" title="delete">â</button></div>`).join('')
      || `<div class="dim" style="padding:8px 9px;font-size:12px">No annotations. Use the toolbar above the map.</div>`;
    const ren = $('#x-anns .annname');
    if (ren) {
      ren.focus(); ren.select();
      const done = keep => {
        const a = anns.find(x => x.id === ren.dataset.id);
        if (a && keep && ren.value.trim()) a.label = ren.value.trim();
        annRenaming = null; renderAnnList(); M.redraw();
      };
      ren.onblur = () => done(true);
      ren.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); };
      ren.onclick = e => e.stopPropagation();
    }
    $$('#x-anns .annrow').forEach(r => {
      r.onclick = ev => {
        if (ev.target.classList.contains('annname')) return;
        if (ev.target.tagName === 'B' && annRenaming !== r.dataset.id && annSel === r.dataset.id) {
          annRenaming = r.dataset.id; renderAnnList(); return;
        }
        const a = anns.find(x => x.id === r.dataset.id);
        if (ev.target.closest('.rm')) {
          anns.splice(anns.indexOf(a), 1); annSel = null; M.redraw(); renderAnnList();
          window.HWtoast(a.id + ' deleted'); return;
        }
        annSel = a.id; M.redraw(); renderAnnList();
        const c = a.kind === 'point' ? [a.lon, a.lat] : d3.geoCentroid({ type: 'Polygon', coordinates: [a.pts.concat([a.pts[0]])] });
        M.flyTo(c[0], c[1], a.kind === 'point' ? 5 : 3.2);
      };
    });
  }

  /* ââââââââââââââââ B Â· MINIMAP ââââââââââââââââ */
  function makeMinimap(hostSel) {
    const host = $(hostSel), svg = d3.select(host).select('svg');
    let proj = d3.geoEquirectangular(), path = d3.geoPath(proj);
    const gLand = svg.append('g'), gFx = svg.append('g');
    function size() { const w = host.clientWidth || 300, h = host.clientHeight || 196; svg.attr('viewBox', `0 0 ${w} ${h}`); return [w, h]; }
    function focus(lon, lat, spanDeg) {
      const [w, h] = size(), s = spanDeg || 26;
      proj.fitExtent([[4, 4], [w - 4, h - 4]], {
        type: 'Polygon', coordinates: [[[lon - s, lat + s * .62], [lon + s, lat + s * .62], [lon + s, lat - s * .62], [lon - s, lat - s * .62], [lon - s, lat + s * .62]]]
      });
      path = d3.geoPath(proj);
      gLand.selectAll('path').data(world ? world.features : []).join('path').attr('class', 'mm-land').attr('d', path);
    }
    return {
      focus,
      async show(lon, lat, opts) {
        if (!world) await worldReady;
        focus(lon, lat, opts && opts.span);
        gFx.selectAll('*').remove();
        const p = proj([lon, lat]); if (!p) return;
        (opts && opts.context || []).forEach(c => {
          const q = proj([c.lon, c.lat]); if (!q) return;
          gFx.append('rect').attr('class', 'mm-ev').attr('x', q[0] - 3).attr('y', q[1] - 3).attr('width', 6).attr('height', 6)
            .attr('transform', `rotate(45 ${q[0]} ${q[1]})`).attr('fill', c.color || '#6d7883').attr('opacity', .8);
        });
        if (opts && opts.arc) {
          const a = proj(opts.arc[0]), b = proj(opts.arc[1]);
          if (a && b) gFx.append('path').attr('class', 'mm-arc').attr('d', `M${a} L${b}`);
        }
        gFx.append('rect').attr('class', 'mm-ev').attr('x', p[0] - 5).attr('y', p[1] - 5).attr('width', 10).attr('height', 10)
          .attr('transform', `rotate(45 ${p[0]} ${p[1]})`).attr('fill', (opts && opts.color) || '#c4453c');
        gFx.append('text').attr('class', 'mm-lbl').attr('x', p[0] + 10).attr('y', p[1] + 3).text((opts && opts.label) || '');
        [0, 480].forEach(delay => {
          const c = gFx.append('circle').attr('class', 'mm-ping').attr('cx', p[0]).attr('cy', p[1]).attr('r', 4);
          for (let s = 1; s <= 20; s++) setTimeout(() => {
            const f = s / 20, e = 1 - Math.pow(1 - f, 3);
            c.attr('r', 4 + 36 * e).attr('stroke-opacity', 1 - e);
            if (s === 20) c.remove();
          }, delay + s * 75);
        });
      },
      clear() { gFx.selectAll('*').remove(); }
    };
  }
  let rpMini = null, rdMini = null;

  /* ââââââââââââââââ C Â· REPLAY: minimap + map animation ââââââââââââââââ */
  function replayFocus(id) {
    const e = D.events.find(x => x.id === id); if (!e) return;
    if (!rpMini) rpMini = makeMinimap('#rp-mini');
    $('#rp-mini-t').textContent = e.place;
    $('#rp-mini-s').textContent = zulu(e.ts);
    const ctx = D.events.filter(o => o.id !== e.id && d3.geoDistance([e.lon, e.lat], [o.lon, o.lat]) * 6371 < 1600)
      .map(o => ({ lon: o.lon, lat: o.lat, color: SEV[o.severity].color }));
    rpMini.show(e.lon, e.lat, { label: e.place, color: SEV[e.severity].color, context: ctx, span: 18 });
  }
  /* jump to the map and animate what happened: fly in, ping, then walk the
     preceding 6h of nearby signals so the sequence is visible */
  function replayOnMap(id) {
    const e = D.events.find(x => x.id === id); if (!e) return;
    window.HWopen('map'); window.HWselect(e.id);
    setTimeout(() => {
      M.flyTo(e.lon, e.lat, 4.6, 700);
      setTimeout(() => {
        M.ping(e.lon, e.lat);
        const lead = D.events.filter(o => o.id !== e.id &&
          d3.geoDistance([e.lon, e.lat], [o.lon, o.lat]) * 6371 < 1600 &&
          o.ts <= e.ts && (e.ts - o.ts) < 36 * 3600e3).sort((a, b) => a.ts - b.ts);
        const g = M.layer('seq'); g.selectAll('*').remove();
        const proj = M.projection, k = 4.6, pe = proj([e.lon, e.lat]);
        lead.forEach((o, i) => {
          const p = proj([o.lon, o.lat]); if (!p) return;
          setTimeout(() => {
            const line = g.append('path').attr('d', `M${p} L${pe}`).attr('fill', 'none')
              .attr('stroke', SEV[o.severity].color).attr('stroke-width', 1 / k)
              .attr('stroke-dasharray', '3 3').attr('opacity', 0);
            for (let s = 1; s <= 8; s++) setTimeout(() => line.attr('opacity', .75 * s / 8), s * 40);
            const c = g.append('circle').attr('cx', p[0]).attr('cy', p[1]).attr('r', 1)
              .attr('fill', 'none').attr('stroke', SEV[o.severity].color).attr('stroke-width', 1.2 / k);
            for (let s = 1; s <= 16; s++) setTimeout(() => {
              const f = s / 16, e = 1 - Math.pow(1 - f, 3);
              c.attr('r', 1 + (16 / k - 1) * e).attr('stroke-opacity', 1 - e);
              if (s === 16) c.remove();
            }, s * 56);
          }, 380 + i * 420);
        });
        setTimeout(() => g.selectAll('*').remove(), 900 + lead.length * 420 + 2600);
        window.HWtoast(`Replaying ${lead.length} lead-up signal${lead.length === 1 ? '' : 's'} around ${e.place}`);
      }, 720);
    }, 60);
  }
  document.addEventListener('click', ev => {
    const n = ev.target.closest('#rp-lanes .ev');
    if (n) setTimeout(() => replayFocus(n.dataset.id), 0);
  }, true);
  on('#rp-replayev', 'click', () => {
    const rp = window.HWMcore && window.HWMcore.rp;
    if (rp && rp.sel) replayOnMap(rp.sel); else window.HWtoast('Select an event in a lane first', 'warn');
  });

  /* ââââââââââââââââ D Â· ONTOLOGY ââââââââââââââââ */
  const O = { nodes: X.nodes.map(n => ({ ...n })), links: X.links.map(l => ({ ...l })),
    sel: null, selLink: null, types: new Set(Object.keys(X.NODE_TYPES)), minConf: .35, inferred: true,
    linkMode: false, linkFrom: null, layout: 'layered', q: '', layoutKey: null, tierRows: null };
  let gsvg = null, gzoom = null, gBand, gLink, gNode, gLbl;

  const riskColor = r => r >= 80 ? '#c4453c' : r >= 60 ? '#b7822c' : r >= 40 ? '#4f7fa6' : '#6d7883';
  const TYPE_ICON = { person: 'i-node-person', org: 'i-node-org', faction: 'i-node-faction',
    vessel: 'i-ship', aircraft: 'i-plane', facility: 'i-node-facility',
    country: 'i-node-country', corridor: 'i-node-corridor', event: 'i-node-event' };
  const typeIcon = t => TYPE_ICON[t] || 'i-node-org';

  function ontVisible() {
    const nodes = O.nodes.filter(n => O.types.has(n.type) && (!O.q || n.label.toLowerCase().includes(O.q)));
    const ids = new Set(nodes.map(n => n.id));
    const links = O.links.filter(l => ids.has(l.s) && ids.has(l.t) && l.conf >= O.minConf && (O.inferred || !l.inferred));
    return { nodes, links };
  }
  function initGraph() {
    if (gsvg) return;
    gsvg = d3.select('#graphsvg');
    const g = gsvg.append('g');
    gBand = g.append('g'); gLink = g.append('g'); gLbl = g.append('g'); gNode = g.append('g');
    gzoom = d3.zoom().scaleExtent([.3, 3]).on('zoom', ev => g.attr('transform', ev.transform));
    gsvg.call(gzoom);
    gsvg.on('click', () => { O.sel = null; O.selLink = null; drawGraph(); renderOntInspector(); });
  }
  /* Objects sit in fixed tiers by ontological rank: geography contains actors,
     actors operate assets, assets produce observations. The layout is computed
     once per node set and then held â nothing drifts, and a dragged object stays
     where the analyst put it. */
  const TIER = { country: 0, corridor: 0, faction: 1, org: 1, person: 1, facility: 2, vessel: 2, aircraft: 2, event: 3 };
  const TIER_NAME = ['Geography', 'Actors', 'Assets & sites', 'Observations'];

  function layoutGraph(nodes, links, w, h) {
    const key = nodes.map(n => n.id + n.type).sort().join('|') + '#' + O.layout;
    if (O.layoutKey === key) return;            // positions already settled
    O.layoutKey = key;
    const adj = new Map(nodes.map(n => [n.id, []]));
    links.forEach(l => { (adj.get(l.s) || []).push(l.t); (adj.get(l.t) || []).push(l.s); });

    if (O.layout === 'radial') {
      const hub = (O.sel && nodes.find(n => n.id === O.sel)) || nodes[0];
      const ring1 = new Set(adj.get(hub.id) || []);
      const rest = nodes.filter(n => n !== hub && !ring1.has(n.id));
      const cx = w / 2, cy = h / 2;
      hub.x = cx; hub.y = cy;
      const r1 = [...ring1].map(id => nodes.find(n => n.id === id)).filter(Boolean);
      r1.forEach((n, i) => { const a = (i / r1.length) * Math.PI * 2 - Math.PI / 2; n.x = cx + Math.cos(a) * 190; n.y = cy + Math.sin(a) * 132; });
      rest.forEach((n, i) => { const a = (i / Math.max(1, rest.length)) * Math.PI * 2 - Math.PI / 2 + .2; n.x = cx + Math.cos(a) * 350; n.y = cy + Math.sin(a) * 236; });
    } else {
      const tiers = [[], [], [], []];
      nodes.forEach(n => tiers[TIER[n.type] ?? 1].push(n));
      // order within each tier by the barycentre of already-placed neighbours (two passes)
      const idx = new Map();
      tiers.forEach(t => t.sort((a, b) => b.risk - a.risk).forEach((n, i) => idx.set(n.id, i)));
      for (let pass = 0; pass < 3; pass++) tiers.forEach((t, ti) => {
        t.forEach(n => {
          const nb = (adj.get(n.id) || []).map(id => idx.get(id)).filter(v => v != null);
          n._bary = nb.length ? d3.mean(nb) : idx.get(n.id);
        });
        t.sort((a, b) => a._bary - b._bary || b.risk - a.risk);
        t.forEach((n, i) => idx.set(n.id, i));
      });
      /* Plates are 92 wide, so 112 is the tightest legible step. A tier wider than
         the pane wraps into sub-rows: the diagram stays roughly square and readable
         at any viewport instead of stretching into an unreadable ribbon. */
      const step = 112, perRow = Math.max(4, Math.floor((w - 80) / step));
      const subRows = tiers.map(t => Math.max(1, Math.ceil(t.length / perRow)));
      const totalRows = tiers.reduce((a, t, i) => a + (t.length ? subRows[i] : 0), 0);
      const top = 56, gapY = Math.max(74, Math.min(126, (h - top - 46) / Math.max(1, totalRows - 1)));
      let row = 0;
      O.tierRows = [];
      tiers.forEach((t, ti) => {
        if (!t.length) return;
        O.tierRows.push({ name: TIER_NAME[ti], y: top + row * gapY });
        const per = Math.ceil(t.length / subRows[ti]);
        t.forEach((n, i) => {
          const r = Math.floor(i / per), col = i % per;
          const count = Math.min(per, t.length - r * per);
          const span = (count - 1) * step;
          n.x = w / 2 - span / 2 + col * step;
          n.y = top + (row + r) * gapY + (col % 2 ? 18 : 0);
          n._tier = ti;
        });
        row += subRows[ti];
      });
    }
    nodes.forEach(n => { n.fx = n.x; n.fy = n.y; });
    O.fitPending = true;
  }

  /* frame the whole diagram once after a layout so nothing sits off-screen */
  function fitGraph(nodes) {
    if (!O.fitPending || !nodes.length) return;
    O.fitPending = false;
    /* deferred with a timeout, not rAF: a backgrounded or throttled frame never
       services animation callbacks and the diagram would stay unfitted */
    let tries = 0;
    const run = () => {
      const el = $('#graphsvg'), w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) { if (tries++ < 20) setTimeout(run, 50); else O.fitPending = true; return; }
      gsvg.attr('viewBox', `0 0 ${w} ${h}`);
      const x0 = d3.min(nodes, n => n.x) - 62, x1 = d3.max(nodes, n => n.x) + 62;
      const y0 = d3.min(nodes, n => n.y) - 52, y1 = d3.max(nodes, n => n.y) + 66;
      const k = Math.max(.3, Math.min(1.2, .95 / Math.max((x1 - x0) / w, (y1 - y0) / h)));
      /* applied synchronously: d3 transitions are animation-frame driven and a
         throttled frame would leave the diagram unfitted */
      gsvg.call(gzoom.transform,
        d3.zoomIdentity.translate(w / 2 - ((x0 + x1) / 2) * k, h / 2 - ((y0 + y1) / 2) * k).scale(k));
    };
    setTimeout(run, 0);
  }

  function drawGraph() {
    initGraph();
    const el = $('#graphsvg'), w = el.clientWidth || 900, h = el.clientHeight || 600;
    gsvg.attr('viewBox', `0 0 ${w} ${h}`);
    const { nodes, links } = ontVisible();
    $('#on-count').textContent = `${nodes.length} objects Â· ${links.length} links`;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const ld = links.map(l => ({ ...l, source: byId.get(l.s), target: byId.get(l.t) }));

    layoutGraph(nodes, links, w, h);

    /* tier bands (layered layout only) */
    gBand.selectAll('*').remove();
    if (O.layout === 'layered' && O.tierRows && nodes.length) {
      const bx0 = d3.min(nodes, n => n.x) - 58, bx1 = d3.max(nodes, n => n.x) + 58;
      O.tierRows.forEach(t => {
        gBand.append('line').attr('class', 'tierline').attr('x1', bx0).attr('x2', bx1).attr('y1', t.y - 32).attr('y2', t.y - 32);
        gBand.append('text').attr('class', 'tierlbl').attr('x', bx0 + 2).attr('y', t.y - 38).text(t.name);
      });
    }

    const lsel = gLink.selectAll('path.gl').data(ld, d => d.id).join('path')
      .attr('class', d => 'gl' + (d.inferred ? ' inferred' : '') + (d.conf >= .92 ? ' hot' : '') + (O.selLink === d.id ? ' sel' : ''))
      .attr('fill', 'none')
      .style('cursor', 'pointer')
      .on('click', (ev, d) => { ev.stopPropagation(); O.selLink = d.id; O.sel = null; drawGraph(); renderOntInspector(); });
    const llbl = gLbl.selectAll('text').data(ld, d => d.id).join('text').attr('class', 'gl-lbl')
      .attr('text-anchor', 'middle').text(d => d.kind);

    const nsel = gNode.selectAll('g.gn').data(nodes, d => d.id).join(enter => {
      const g2 = enter.append('g').attr('class', 'gn');
      g2.append('rect').attr('class', 'plate').attr('x', -46).attr('y', -20).attr('width', 92).attr('height', 40).attr('rx', 2);
      g2.append('rect').attr('class', 'ring').attr('x', -46).attr('y', 17).attr('width', 92).attr('height', 3);
      g2.append('use').attr('class', 'gicon').attr('width', 15).attr('height', 15).attr('x', -40).attr('y', -14);
      g2.append('text').attr('x', -20).attr('y', -2).attr('font-size', 9.5);
      g2.append('text').attr('class', 'sub').attr('x', -40).attr('y', 11).attr('font-size', 8.5).attr('fill', '#818c96');
      return g2;
    });
    nsel.attr('class', d => 'gn' + (O.sel === d.id ? ' sel' : ''))
      .on('click', (ev, d) => {
        ev.stopPropagation();
        if (O.linkMode) {
          if (!O.linkFrom) { O.linkFrom = d.id; window.HWtoast('Now click the target object'); }
          else if (O.linkFrom !== d.id) {
            O.links.push({ id: 'L' + (O.links.length + 1), s: O.linkFrom, t: d.id, kind: 'affiliated with', conf: .6, note: 'Created by analyst', inferred: true });
            O.linkFrom = null; O.linkMode = false; $('#on-linkmode').classList.remove('primary');
            window.HWtoast('Link created Â· set the type in the inspector', 'ok');
          }
          drawGraph(); return;
        }
        O.sel = d.id; O.selLink = null; drawGraph(); renderOntInspector();
      })
      .on('dblclick', (ev, d) => { ev.stopPropagation(); expandNode(d.id); })
      .call(d3.drag()
        .on('drag', (ev, d) => { d.x = d.fx = ev.x; d.y = d.fy = ev.y; place(); })
        .on('end', () => place()));
    nsel.select('.ring').attr('fill', d => riskColor(d.risk));
    nsel.select('.gicon').attr('href', d => '#' + typeIcon(d.type)).attr('color', '#c2cbd3');
    nsel.select('text').text(d => d.label.length > 17 ? d.label.slice(0, 16) + 'â¦' : d.label).attr('x', -20).attr('text-anchor', 'start');
    nsel.select('text.sub').text(d => X.NODE_TYPES[d.type].name + ' Â· ' + d.risk);

    /* orthogonal-ish routing: links leave the plate edge, so the picture reads
       as a diagram rather than a hairball */
    function place() {
      lsel.attr('d', d => {
        const a = d.source, b = d.target;
        if (!a || !b) return '';
        const dy = b.y - a.y;
        if (Math.abs(dy) < 8) return `M${a.x},${a.y} L${b.x},${b.y}`;
        const y0 = a.y + (dy > 0 ? 22 : -22), y1 = b.y - (dy > 0 ? 22 : -22), m = (y0 + y1) / 2;
        return `M${a.x},${y0} C${a.x},${m} ${b.x},${m} ${b.x},${y1}`;
      });
      llbl.attr('x', d => (d.source.x + d.target.x) / 2).attr('y', d => (d.source.y + d.target.y) / 2 - 2);
      nsel.attr('transform', d => `translate(${d.x},${d.y})`);
    }
    place();
    fitGraph(nodes);
  }
  function expandNode(id) {
    const n = O.nodes.find(x => x.id === id);
    const nb = O.links.filter(l => l.s === id || l.t === id).length;
    O.types = new Set(Object.keys(X.NODE_TYPES));
    O.minConf = 0; $('#on-conf').value = 0; $('#on-conf-v').textContent = '0%';
    drawGraph(); renderOntLegend();
    window.HWtoast(`Expanded ${n.label} Â· ${nb} links revealed`);
  }
  function renderOntLegend() {
    $('#on-legend').innerHTML = Object.entries(X.NODE_TYPES).map(([k, v]) => {
      const c = O.nodes.filter(n => n.type === k).length;
      return `<div class="legendrow${O.types.has(k) ? '' : ' off'}" data-t="${k}">
        <svg class="gsw"><use href="#${typeIcon(k)}"/></svg><span>${v.name}</span><span class="c">${c}</span></div>`;
    }).join('');
    $$('#on-legend .legendrow').forEach(r => r.onclick = () => {
      const t = r.dataset.t; O.types.has(t) ? O.types.delete(t) : O.types.add(t);
      renderOntLegend(); drawGraph();
    });
    $('#on-saved').innerHTML = [['Red Sea shipping network', 8], ['Baltic subsea actors', 5], ['Sahel exposure', 4]]
      .map(([t, n]) => `<li><a href="#" class="briefrow"><b>${t}</b><em>${n} objects Â· saved by K. Almeida</em></a></li>`).join('');
    $$('#on-saved a').forEach(a => a.onclick = ev => { ev.preventDefault(); window.HWtoast('Investigation loaded into the graph'); });
  }
  function renderOntInspector() {
    const box = $('#on-inspector');
    if (O.selLink) {
      const l = O.links.find(x => x.id === O.selLink);
      const s = O.nodes.find(n => n.id === l.s), t = O.nodes.find(n => n.id === l.t);
      $('#on-insp-t').textContent = 'Link';
      box.innerHTML = `<div class="detail">
        <div class="row"><span class="tag ${l.inferred ? 'amber' : 'blue'}">${l.inferred ? 'Inferred' : 'Asserted'}</span>
          <span class="lbl" style="margin-left:auto">${l.id}</span></div>
        <h2 style="font-size:14px">${esc(s.label)} â ${esc(t.label)}</h2>
        <div class="card"><span class="lbl">Relationship</span>
          <div class="field"><label>Type</label><select class="input" id="lk-kind">${X.LINK_KINDS.map(k => `<option ${k === l.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
          <div class="field"><label>Confidence â ${Math.round(l.conf * 100)}%</label><input type="range" id="lk-conf" min="0" max="100" value="${Math.round(l.conf * 100)}"></div>
          <div class="field"><label>Basis</label><textarea class="input" id="lk-note" rows="2">${esc(l.note)}</textarea></div>
        </div>
        <div class="btnrow"><button class="btn sm primary" id="lk-save">save</button>
          <button class="btn sm danger" id="lk-del"><svg><use href="#i-trash"/></svg> delete link</button></div></div>`;
      on('#lk-save', 'click', () => {
        l.kind = $('#lk-kind').value; l.conf = +$('#lk-conf').value / 100;
        l.note = $('#lk-note').value; l.inferred = l.conf < .8;
        drawGraph(); renderOntInspector(); window.HWtoast('Link updated', 'ok');
      });
      on('#lk-del', 'click', () => { O.links = O.links.filter(x => x.id !== l.id); O.selLink = null; drawGraph(); renderOntInspector(); window.HWtoast('Link deleted'); });
      return;
    }
    if (!O.sel) {
      $('#on-insp-t').textContent = 'Ontology';
      const inferred = O.links.filter(l => l.inferred).length;
      box.innerHTML = `<div class="sect"><span class="lbl">Graph</span>
        <div class="statgrid" style="grid-template-columns:1fr 1fr">
          <div class="stat"><div class="v">${O.nodes.length}</div><div class="lbl">objects</div></div>
          <div class="stat"><div class="v">${O.links.length}</div><div class="lbl">links</div></div>
          <div class="stat"><div class="v">${inferred}</div><div class="lbl">inferred</div></div>
          <div class="stat"><div class="v">${O.nodes.filter(n => n.risk >= 80).length}</div><div class="lbl">high risk</div></div>
        </div></div>
        <div class="sect" style="border:0"><span class="lbl">Recently inferred</span>
        ${O.links.filter(l => l.inferred).slice(0, 6).map(l => {
          const s = O.nodes.find(n => n.id === l.s), t = O.nodes.find(n => n.id === l.t);
          return `<div class="linkrow inf"><div class="pair"><b>${esc(s.label)}</b><span class="k">${l.kind}</span><b>${esc(t.label)}</b></div><span class="cf">${Math.round(l.conf * 100)}%</span></div>`;
        }).join('')}</div>`;
      return;
    }
    const n = O.nodes.find(x => x.id === O.sel);
    const lk = O.links.filter(l => l.s === n.id || l.t === n.id);
    $('#on-insp-t').textContent = n.label;
    box.innerHTML = `<div class="detail">
      <div class="row"><span class="tag">${X.NODE_TYPES[n.type].name}</span>
        <span class="sev" style="color:${riskColor(n.risk)}"><i class="dia" style="background:${riskColor(n.risk)}"></i>risk ${n.risk}</span>
        <span class="lbl" style="margin-left:auto">${n.id}</span></div>
      <div class="card"><span class="lbl">Object</span>
        <div class="field"><label>Label</label><input class="input" id="nd-label" value="${esc(n.label)}"></div>
        <div class="field"><label>Type</label><select class="input" id="nd-type">${Object.entries(X.NODE_TYPES).map(([k, v]) => `<option value="${k}" ${k === n.type ? 'selected' : ''}>${v.name}</option>`).join('')}</select></div>
        <div class="field"><label>Risk â ${n.risk}</label><input type="range" id="nd-risk" min="0" max="100" value="${n.risk}"></div>
      </div>
      <div class="card"><span class="lbl">Properties</span>
        <div id="nd-props">${Object.entries(n.props).map(([k, v]) => `<div class="proprow"><input value="${esc(k)}" data-k><input value="${esc(v)}" data-v></div>`).join('')}</div>
        <button class="btn ghost sm" id="nd-addprop"><svg><use href="#i-plus"/></svg> add property</button>
      </div>
      <div class="card"><span class="lbl">Links Â· ${lk.length}</span>
        ${lk.map(l => {
          const o = O.nodes.find(x => x.id === (l.s === n.id ? l.t : l.s));
          return `<div class="linkrow" data-l="${l.id}" style="cursor:pointer"><span class="k">${l.s === n.id ? 'â' : 'â'} ${l.kind}</span>
            <span>${esc(o.label)}</span><span class="cf">${Math.round(l.conf * 100)}%</span></div>`;
        }).join('') || '<p class="dim" style="font-size:12px;margin:0">No links.</p>'}
      </div>
      <div class="btnrow">
        <button class="btn sm primary" id="nd-save">save changes</button>
        <button class="btn sm" id="nd-expand">expand</button>
        <button class="btn sm" id="nd-map"><svg><use href="#i-globe"/></svg> locate</button>
        <button class="btn sm danger" id="nd-del"><svg><use href="#i-trash"/></svg></button></div></div>`;
    on('#nd-addprop', 'click', () => {
      const d = document.createElement('div'); d.className = 'proprow';
      d.innerHTML = '<input placeholder="key" data-k><input placeholder="value" data-v>';
      $('#nd-props').appendChild(d); d.querySelector('input').focus();
    });
    on('#nd-save', 'click', () => {
      n.label = $('#nd-label').value; n.type = $('#nd-type').value; n.risk = +$('#nd-risk').value;
      const p = {}; $$('#nd-props .proprow').forEach(r => { const k = r.children[0].value.trim(); if (k) p[k] = r.children[1].value; });
      n.props = p; drawGraph(); renderOntLegend(); renderOntInspector(); window.HWtoast('Object saved', 'ok');
    });
    on('#nd-expand', 'click', () => expandNode(n.id));
    on('#nd-del', 'click', () => { O.nodes = O.nodes.filter(x => x.id !== n.id); O.links = O.links.filter(l => l.s !== n.id && l.t !== n.id); O.sel = null; drawGraph(); renderOntLegend(); renderOntInspector(); window.HWtoast('Object deleted'); });
    on('#nd-map', 'click', () => {
      const ev = D.events.find(e => e.place === n.label || e.country === n.label);
      const inf = X.places.find(p => p.name === n.label);
      const trk = X.vessels.concat(X.aircraft).find(t => (t.name || t.callsign) === n.label);
      const target = ev ? [ev.lon, ev.lat] : inf ? [inf.lon, inf.lat] : trk ? [trk.lon, trk.lat] : null;
      if (!target) return window.HWtoast('No geometry attached to this object', 'warn');
      window.HWopen('map'); setTimeout(() => { M.flyTo(target[0], target[1], 4.4); setTimeout(() => M.ping(target[0], target[1]), 700); }, 60);
    });
    $$('#on-inspector .linkrow[data-l]').forEach(r => r.onclick = () => { O.selLink = r.dataset.l; O.sel = null; drawGraph(); renderOntInspector(); });
  }
  function openOntology(nodeId) {
    window.HWopen('ontology');
    if (nodeId) { O.sel = nodeId; O.types = new Set(Object.keys(X.NODE_TYPES)); }
    renderOntLegend(); drawGraph(); renderOntInspector();
  }
  on('#on-conf', 'input', ev => { O.minConf = +ev.target.value / 100; $('#on-conf-v').textContent = ev.target.value + '%'; drawGraph(); });
  on('#on-inferred', 'change', ev => { O.inferred = ev.target.checked; drawGraph(); });
  on('#on-q', 'input', ev => { O.q = ev.target.value.toLowerCase(); drawGraph(); });
  on('#on-allTypes', 'click', () => { O.types = new Set(Object.keys(X.NODE_TYPES)); renderOntLegend(); drawGraph(); });
  on('#on-close', 'click', () => { O.sel = null; O.selLink = null; drawGraph(); renderOntInspector(); });
  $$('#on-layout button').forEach(b => b.onclick = () => {
    $$('#on-layout button').forEach(x => x.setAttribute('aria-pressed', x === b));
    O.layout = b.dataset.l; O.layoutKey = null; drawGraph();
  });
  on('#on-relayout', 'click', () => { O.layoutKey = null; drawGraph(); window.HWtoast('Layout rebuilt'); });
  on('#on-add', 'click', () => {
    const id = 'N' + (O.nodes.length + 1);
    O.nodes.push({ id, type: 'org', label: 'Untitled object', risk: 40, props: { created: zulu(new Date()) } });
    O.sel = id; O.selLink = null;
    drawGraph(); renderOntLegend(); renderOntInspector();
    const f = $('#nd-label'); if (f) { f.focus(); f.select(); }
    window.HWtoast('Object created Â· name it in the inspector');
  });
  on('#on-linkmode', 'click', () => {
    O.linkMode = !O.linkMode; O.linkFrom = null;
    $('#on-linkmode').classList.toggle('primary', O.linkMode);
    window.HWtoast(O.linkMode ? 'Link mode: click the source object' : 'Link mode off');
  });
  on('#on-map', 'click', () => {
    const geo = O.nodes.filter(n => ['corridor', 'facility', 'country', 'vessel'].includes(n.type)).length;
    window.HWtoast(`${geo} objects with geometry plotted on the situation map`, 'ok');
    window.HWopen('map');
  });
  on('#on-brief', 'click', () => {
    const n = O.sel ? O.nodes.find(x => x.id === O.sel) : null;
    const ids = D.events.filter(e => !n || e.place.includes(n.label.split(' ')[0]) || e.country === n.label).slice(0, 6).map(e => e.id);
    if (!ids.length) return window.HWtoast('No signals linked to this selection', 'warn');
    window.HWbasket(ids); window.HWopen('generate');
  });

  /* ââââââââââââââââ E Â· IMAGERY / CHANGE DETECTION ââââââââââââââââ */
  const I = { scene: X.scenes[0].id, det: null, view: 'split', boxes: true, conf: .6, kinds: { new: 1, expanded: 1, removed: 1 }, swipe: 50, blend: false, opacity: .55 };
  function scene() { return X.scenes.find(s => s.id === I.scene); }
  function dets() { return scene().changes.filter(c => c.conf >= I.conf && I.kinds[c.type]); }

  const A = { list: X.aoiSeed.map(a => ({ ...a })), sel: 'AOI-14', scope: 'all', renaming: null };
  const aoiIcon = c => ({ airport: 'i-plane', port: 'i-anchor', military: 'i-node-faction',
    energy: 'i-node-facility', urban: 'i-node-country', border: 'i-node-corridor', custom: 'i-poly' }[c] || 'i-poly');

  function aoiScoped() { return A.scope === 'all' ? A.list : A.list.filter(a => a.iso3 === A.scope); }

  function renderAOIs() {
    const isoSet = [...new Set(D.events.map(e => e.iso3))].sort();
    const sc = $('#aoi-scope');
    if (sc && sc.options.length < 2) sc.innerHTML = '<option value="all">All areas</option>' +
      isoSet.map(i => `<option value="${i}">${i} Â· ${esc((D.events.find(e => e.iso3 === i) || {}).country || i)}</option>`).join('');
    const list = aoiScoped();
    $('#aoi-count').textContent = list.filter(a => a.status === 'active').length + '/' + list.length + ' active';
    $('#im-count').textContent = A.list.length + ' areas';
    $('#aoi-list').innerHTML = list.map(a => `<div class="aoirow ${a.status}" data-id="${a.id}" aria-selected="${a.id === A.sel}">
      <svg class="ic"><use href="#${aoiIcon(a.cls)}"/></svg>
      <div>${A.renaming === a.id
        ? `<input class="input aoiname" data-id="${a.id}" value="${esc(a.name)}" style="height:22px;font-size:12.5px">`
        : `<b>${esc(a.name)}</b>`}
        <em>${a.id} Â· ${X.AOI_CLASSES[a.cls].name} Â· ${a.radiusKm} km</em></div>
      <span class="st">${a.status === 'proposed' ? 'proposed' : a.cadence}${a.recurring ? ' â»' : ''}</span></div>`).join('')
      || '<div class="dim" style="padding:8px 9px;font-size:12px">No areas in this scope. Propose coverage to seed them.</div>';
    const ren = $('#aoi-list .aoiname');
    if (ren) {
      ren.focus(); ren.select();
      const done = keep => { const a = A.list.find(z => z.id === ren.dataset.id);
        if (a && keep && ren.value.trim()) a.name = ren.value.trim();
        A.renaming = null; renderAOIs(); renderAOIDetail(); };
      ren.onblur = () => done(true);
      ren.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); };
      ren.onclick = e => e.stopPropagation();
    }
    $$('#aoi-list .aoirow').forEach(r => r.onclick = ev => {
      if (ev.target.classList.contains('aoiname')) return;
      if (ev.target.tagName === 'B' && A.sel === r.dataset.id) { A.renaming = r.dataset.id; renderAOIs(); return; }
      A.sel = r.dataset.id;
      const a = A.list.find(z => z.id === A.sel);
      if (a.scene) { I.scene = a.scene; I.det = null; renderScene(); }
      renderAOIs(); renderImageryList(); renderAOIDetail();
    });
  }

  function renderAOIDetail() {
    const a = A.list.find(z => z.id === A.sel);
    const host = $('#im-detail');
    if (!a || !host) return;
    const box = document.createElement('div');
    box.className = 'sect'; box.style.cssText = 'padding:11px 12px;border-top:1px solid var(--line);border-bottom:0';
    box.innerHTML = `<span class="lbl" style="display:block;margin-bottom:7px;font-weight:600;color:var(--txt-2)">Observation area ${a.id}</span>
      <div class="field"><label>Name</label><input class="input" id="aoi-name" value="${esc(a.name)}"></div>
      <div class="field"><label>Class</label><select class="input" id="aoi-cls">${Object.entries(X.AOI_CLASSES)
        .map(([k, v]) => `<option value="${k}" ${k === a.cls ? 'selected' : ''}>${v.name}</option>`).join('')}</select></div>
      <div class="field"><label>Scan cadence</label><select class="input" id="aoi-cad">${['daily', '3-day', 'weekly', 'monthly', 'on demand']
        .map(c => `<option ${c === a.cadence ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Radius â ${a.radiusKm} km</label><input type="range" id="aoi-rad" min="1" max="25" step="0.5" value="${a.radiusKm}"></div>
      <div class="field"><label>Analyst note</label><textarea class="input" id="aoi-note" rows="2" placeholder="Standing tasking instructionâ¦">${esc(a.notes)}</textarea></div>
      <dl class="kv"><dt>Centre</dt><dd class="mono">${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}</dd>
        <dt>Owner</dt><dd>${a.owner}</dd><dt>Status</dt><dd>${a.status}</dd></dl>
      <div class="btnrow" style="margin-top:9px">
        <button class="btn sm primary" id="aoi-save">save area</button>
        ${a.status === 'proposed' ? '<button class="btn sm" id="aoi-accept"><svg><use href="#i-check"/></svg> accept</button>'
          : `<button class="btn sm" id="aoi-pause">${a.status === 'paused' ? 'resume' : 'pause'}</button>`}
        <button class="btn sm" id="aoi-locate"><svg><use href="#i-globe"/></svg></button>
        <button class="btn sm danger" id="aoi-del"><svg><use href="#i-trash"/></svg></button></div>`;
    host.appendChild(box);
    on('#aoi-save', 'click', () => {
      a.name = $('#aoi-name').value; a.cls = $('#aoi-cls').value; a.cadence = $('#aoi-cad').value;
      a.radiusKm = +$('#aoi-rad').value; a.notes = $('#aoi-note').value;
      renderAOIs(); renderDetections(); window.HWtoast(a.id + ' saved', 'ok');
    });
    on('#aoi-accept', 'click', () => { a.status = 'active'; a.auto = false; renderAOIs(); renderDetections(); window.HWtoast(a.id + ' added to standing tasking', 'ok'); });
    on('#aoi-pause', 'click', () => { a.status = a.status === 'paused' ? 'active' : 'paused'; renderAOIs(); renderDetections(); });
    on('#aoi-locate', 'click', () => { window.HWopen('map'); setTimeout(() => { M.flyTo(a.lon, a.lat, 6); setTimeout(() => M.ping(a.lon, a.lat), 700); }, 60); });
    on('#aoi-del', 'click', () => { A.list = A.list.filter(z => z.id !== a.id); A.sel = A.list[0] && A.list[0].id; renderAOIs(); renderDetections(); window.HWtoast('Area deleted'); });
  }

  function renderImageryList() {
    $('#im-count').textContent = X.scenes.length + ' scenes';
    $('#im-list').innerHTML = X.scenes.map(s => `<li><a href="#" class="briefrow" data-s="${s.id}" style="${s.id === I.scene ? 'background:var(--bg-3)' : ''}">
      <b>${esc(s.place)}</b><em>${s.id} Â· ${s.sensor} Â· ${s.changes.length} detections</em></a></li>`).join('');
    $$('#im-list a').forEach(a => a.onclick = ev => { ev.preventDefault(); I.scene = a.dataset.s; I.det = null; renderImageryList(); renderScene(); });
  }
  function renderScene() {
    const s = scene(), list = dets();
    $('#im-scene').textContent = `${s.id} Â· ${s.place}`;
    const frame = (which, date, withBoxes) => `
      <div class="frame">
        <div class="fh"><b>${which}</b><span>${date}</span><span style="margin-left:auto">${s.sensor} Â· cloud ${s.cloud}% Â· off-nadir ${s.offNadir}Â°</span></div>
        <div class="slot"><image-slot id="im-${s.id}-${which.toLowerCase()}" placeholder="Drop the ${which.toLowerCase()} scene (${date})"></image-slot></div>
        ${withBoxes && I.boxes ? `<div class="boxes">${list.map(c => `<div class="chgbox${I.det === c.id ? ' sel' : ''}" data-t="${c.type}" data-id="${c.id}"
            style="left:${c.bbox[0]}%;top:${c.bbox[1]}%;width:${c.bbox[2]}%;height:${c.bbox[3]}%"><span>${c.id} Â· ${Math.round(c.conf * 100)}%</span></div>`).join('')}</div>` : ''}
      </div>`;
    const el = $('#im-frames');
    el.className = 'frames' + (I.view === 'after' ? ' single' : '');
    if (I.view === 'split') el.innerHTML = frame('Reference', s.dateA, false) + frame('Current', s.dateB, true);
    else if (I.view === 'after') el.innerHTML = frame('Current', s.dateB, true);
    else {
      el.className = 'frames single';
      /* Two stacked frames. Hard mode clips the current frame at the handle;
         fade mode leaves the reference visible underneath at a chosen opacity,
         so slow or partial change can be judged without moving the handle. */
      const under = frame('Reference', s.dateA, false)
        .replace('<div class="frame">', `<div class="frame${I.blend ? ' under' : ''}" style="position:absolute;inset:0">`);
      const over = frame('Current', s.dateB, true)
        .replace('<div class="frame">', `<div class="frame" style="position:absolute;inset:0;width:${100 / (I.swipe / 100)}%">`);
      el.innerHTML = `<div class="frame" style="position:relative">
        ${under}
        <div id="im-clip" style="position:absolute;inset:0;overflow:hidden;width:${I.swipe}%;
          opacity:${I.blend ? I.opacity : 1}">${over}</div>
        <div class="swipe" id="im-handle" style="left:${I.swipe}%"></div></div>`;
      const wrap = $('#im-frames'), handle = $('#im-handle');
      let dragging = false;
      handle.addEventListener('mousedown', () => { dragging = true; });
      window.addEventListener('mouseup', () => { dragging = false; });
      wrap.addEventListener('mousemove', ev => {
        if (!dragging) return;
        const r = wrap.getBoundingClientRect();
        I.swipe = Math.max(6, Math.min(94, (ev.clientX - r.left) / r.width * 100));
        $('#im-clip').style.width = I.swipe + '%';
        $('#im-clip').firstElementChild.style.width = (100 / (I.swipe / 100)) + '%';
        handle.style.left = I.swipe + '%';
      });
    }
    $$('#im-frames .chgbox').forEach(b => b.onclick = () => { I.det = b.dataset.id; renderScene(); renderDetections(); });
    renderDetections();
  }
  function renderDetections() {
    const s = scene(), list = dets(), sel = list.find(c => c.id === I.det);
    $('#im-det-c').textContent = list.length + ' of ' + s.changes.length;
    $('#im-detail').innerHTML = `
      <div class="sect" style="padding:11px 12px"><span class="lbl" style="display:block;margin-bottom:7px;font-weight:600;color:var(--txt-2)">Detections</span>
        ${list.map(c => `<div class="detrow" data-id="${c.id}" aria-selected="${c.id === I.det}">
          <i class="sq" style="background:${c.type === 'new' ? '#c4453c' : c.type === 'expanded' ? '#b7822c' : '#4f7fa6'}"></i>
          <span>${esc(c.label)}</span><span class="tag">${c.type}</span><span class="cf">${Math.round(c.conf * 100)}%</span></div>`).join('')
          || '<p class="dim" style="font-size:12px;margin:0">No detections above the confidence floor.</p>'}
      </div>
      ${sel ? `<div class="sect" style="padding:11px 12px"><span class="lbl" style="display:block;margin-bottom:7px;font-weight:600;color:var(--txt-2)">${sel.id}</span>
        <p class="muted" style="font-size:12.5px;line-height:1.55;margin:0 0 9px">${esc(sel.note)}</p>
        <dl class="kv"><dt>Change type</dt><dd>${sel.type}</dd><dt>Confidence</dt><dd class="mono">${Math.round(sel.conf * 100)}%</dd>
        <dt>Model</dt><dd>${$('#im-model') ? $('#im-model').value : 'hw-changedet v3'}</dd>
        <dt>Reviewed</dt><dd>Pending analyst confirmation</dd></dl>
        <div class="btnrow" style="margin-top:9px"><button class="btn sm" id="im-confirm"><svg><use href="#i-check"/></svg> confirm</button>
        <button class="btn sm danger" id="im-reject">reject</button></div></div>` : ''}
      <div class="sect" style="padding:11px 12px;border:0"><span class="lbl" style="display:block;margin-bottom:7px;font-weight:600;color:var(--txt-2)">Object counts Â· reference â current</span>
        ${s.counts.map(([n, v, d]) => `<div class="countrow"><span>${n}</span><span class="n">${v}</span>
          <span class="d" style="color:${d > 0 ? '#b0645c' : d < 0 ? '#6d9a83' : 'var(--txt-4)'}">${d > 0 ? '+' : ''}${d || 'Â·'}</span></div>`).join('')}
        <div style="margin-top:11px"><span class="lbl">Location</span>
          <div class="mono" style="font-size:11.5px;color:var(--txt-2);margin-top:3px">${s.lat.toFixed(3)}, ${s.lon.toFixed(3)} Â· ${s.aoi}</div>
          <button class="btn sm" id="im-locate" style="margin-top:7px"><svg><use href="#i-globe"/></svg> show on situation map</button></div>
      </div>`;
    if (window.HWhistory) window.HWhistory.inject($('#im-detail'), A.list.find(z => z.id === A.sel));
    $$('#im-detail .detrow').forEach(r => r.onclick = () => { I.det = r.dataset.id; renderScene(); });
    renderAOIDetail();
    on('#im-confirm', 'click', () => window.HWtoast(sel.id + ' confirmed and written to the scene record', 'ok'));
    on('#im-reject', 'click', () => window.HWtoast(sel.id + ' rejected Â· model feedback recorded'));
    on('#im-locate', 'click', () => {
      window.HWopen('map');
      setTimeout(() => { M.flyTo(s.lon, s.lat, 6); setTimeout(() => M.ping(s.lon, s.lat), 700); }, 60);
    });
  }
  $$('#im-view button').forEach(b => b.onclick = () => {
    $$('#im-view button').forEach(x => x.setAttribute('aria-pressed', x === b));
    I.view = b.dataset.v;
    const swipeOnly = I.view === 'swipe';
    $('#im-blend-wrap').classList.toggle('hidden', !swipeOnly);
    $('#im-blend-ctl').classList.toggle('hidden', !(swipeOnly && I.blend));
    renderScene();
  });
  on('#im-boxes', 'change', ev => { I.boxes = ev.target.checked; renderScene(); });
  on('#im-blend', 'change', ev => {
    I.blend = ev.target.checked;
    $('#im-blend-ctl').classList.toggle('hidden', !I.blend);
    renderScene();
  });
  on('#im-opacity', 'input', ev => {
    I.opacity = +ev.target.value / 100;
    $('#im-opacity-v').textContent = ev.target.value + '%';
    const clip = $('#im-clip'); if (clip) clip.style.opacity = I.opacity;   // live, no re-render
  });
  on('#im-conf', 'input', ev => { I.conf = +ev.target.value / 100; $('#im-conf-v').textContent = ev.target.value + '%'; renderScene(); });
  ['new', 'exp', 'rem'].forEach((k, i) => on('#im-' + k, 'change', ev => {
    I.kinds[['new', 'expanded', 'removed'][i]] = ev.target.checked; renderScene();
  }));
  on('#im-rerun', 'click', () => {
    const bar = $('#im-prog i'); let p = 0; bar.style.width = '0%';
    window.HWtoast('Detection queued Â· ' + $('#im-model').value);
    const t = setInterval(() => {
      p += 12 + Math.random() * 10; bar.style.width = Math.min(100, p) + '%';
      if (p >= 100) { clearInterval(t); setTimeout(() => { bar.style.width = '0%'; window.HWtoast(`${scene().changes.length} detections returned for ${scene().id}`, 'ok'); renderScene(); }, 400); }
    }, 260);
  });
  on('#aoi-scope', 'change', ev => { A.scope = ev.target.value; renderAOIs(); });
  on('#aoi-new', 'click', () => {
    const id = 'AOI-' + String(60 + A.list.length).padStart(2, '0');
    const c = D.events[0];
    A.list.unshift({ id, name: 'New observation area', cls: 'custom', iso3: c.iso3, lat: c.lat, lon: c.lon,
      radiusKm: 5, cadence: 'weekly', status: 'active', scene: null, owner: 'K. Almeida', auto: false, notes: '' });
    A.sel = id; A.renaming = id; renderAOIs(); renderDetections();
    window.HWtoast('Area created Â· name it in the list');
  });
  on('#aoi-derive', 'click', () => {
    if (A.scope === 'all') return window.HWtoast('Pick a country scope first', 'warn');
    const found = X.deriveAOIs(A.scope).filter(p => !A.list.some(a => a.name === p.name));
    if (!found.length) return window.HWtoast('No further critical infrastructure in this scope', 'warn');
    A.list = found.concat(A.list); renderAOIs();
    window.HWtoast(found.length + ' areas proposed from the infrastructure register â accept to task them', 'ok');
  });
  on('#im-signal', 'click', () => window.HWtoast('Signal raised from ' + scene().id + ' Â· routed to the inbox', 'ok'));
  on('#im-brief', 'click', () => {
    const s = scene();
    const near = D.events.filter(e => d3.geoDistance([s.lon, s.lat], [e.lon, e.lat]) * 6371 < 900).slice(0, 4).map(e => e.id);
    if (near.length) window.HWbasket(near); else window.HWtoast('Imagery finding added to the briefing basket', 'ok');
  });

  /* ââââââââââââââââ F Â· INTERACTIVE READER ââââââââââââââââ */
  const R = { doc: null, ref: null, tour: null };
  function readerDoc() { return (window.HWMcore && window.HWMcore.doc) || null; }

  function refSpan(kind, id, text) { return `<span class="xref" data-k="${kind}" data-id="${id}">${esc(text)}<span class="rt"> â¸</span></span>`; }

  function renderReader() {
    const d = readerDoc();
    $('#rd-list').innerHTML = D.briefings.map(b => `<li><a href="#" class="briefrow" data-b="${b.id}"><b>${esc(b.title)}</b><em>${b.id} Â· ${b.status}</em></a></li>`).join('');
    $$('#rd-list a').forEach(a => a.onclick = ev => { ev.preventDefault(); window.HWM.openBriefing(a.dataset.b); renderReader(); });
    if (!d) {
      $('#rd-id').textContent = 'â';
      $('#rd-body').innerHTML = `<div class="empty" style="padding:80px 20px"><svg><use href="#i-read"/></svg>
        <p>No briefing loaded. Generate one, or open a briefing from the list.</p>
        <button class="btn primary sm" id="rd-gen">open generator</button></div>`;
      on('#rd-gen', 'click', () => window.HWopen('generate'));
      $('#rd-refs').innerHTML = ''; $('#rd-ctx').innerHTML = ''; return;
    }
    $('#rd-id').textContent = `${d.meta.id} Â· ${d.meta.cls} Â· interactive`;
    const sel = d.sel, crit = d.crit, mean = Math.round(d3.mean(sel, e => e.conf) * 100);
    const regions = d.regions.map(([r, n]) => refSpan('region', r, `${r} (${n})`)).join(', ');
    const top = crit[0] || d.high[0] || sel[0];

    const themes = d.domains.slice(0, 4).map(([k, n]) => {
      const evs = sel.filter(e => e.domain === k);
      const worst = evs.slice().sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank)[0];
      return `<h3 style="font-size:13.5px;font-weight:600;margin:16px 0 5px;color:var(--txt)">${DOM[k].name} Â· ${n} signal${n > 1 ? 's' : ''}</h3>
        <p>${evs.length} signal${evs.length > 1 ? 's' : ''} in this theme, centred on
        ${evs.slice(0, 3).map(e => refSpan('signal', e.id, e.place)).join(', ')}.
        The severity peak is ${SEV[worst.severity].name.toLowerCase()}, set by ${refSpan('signal', worst.id, worst.place)}.</p>
        <ul style="margin:0 0 10px;padding-left:17px">${evs.slice(0, 3).map(e =>
          `<li>${refSpan('signal', e.id, e.id)} â ${esc(e.summary.split('. ')[0])}.</li>`).join('')}</ul>`;
    }).join('');

    const ontRefs = X.nodes.filter(n => ['vessel', 'faction', 'org'].includes(n.type)).slice(0, 3);
    const sceneRef = X.scenes[0];

    $('#rd-body').innerHTML = `<div class="wrap">
      <h1>${esc(d.meta.title)}</h1>
      <p class="sub">${d.meta.id} Â· ${d.meta.scope} Â· ${d.meta.audience || d.meta.aud} Â· issued ${zulu(new Date())} Â· ${d.meta.cls}</p>

      <h2>Executive judgement</h2>
      <p>${sel.length} signals meet the reporting threshold for this cycle, ${crit.length} of them critical and
        ${d.high.length} high. Activity concentrates in ${regions}. The single most consequential development is
        ${refSpan('signal', top.id, top.place + ': ' + top.title.charAt(0).toLowerCase() + top.title.slice(1))}.
        Over the next ${d.meta.horizon} we assess corridor and routing risk as the binding constraint on operations.</p>
      <p>Confidence across the set averages ${mean}%, with ${sel.filter(e => e.conf > .78).length} signals corroborated by
        more than one feed. Overhead imagery of ${refSpan('scene', sceneRef.id, sceneRef.place)} supports the assessment:
        the change detector returned ${sceneRef.changes.length} findings against the ${sceneRef.dateA} reference scene.</p>
      <div class="callout"><b>Bottom line.</b> ${crit.length
        ? `Hold contingency routing and keep the ${refSpan('signal', crit[0].id, crit[0].place)} corridor under daily review.`
        : 'No change to posture. Maintain the weekly reporting cadence.'}</div>

      <h2>Assessment by theme</h2>
      ${themes}

      <h2>Network and attribution</h2>
      <p>The ontology links this cycle's maritime reporting to
        ${ontRefs.map(n => refSpan('node', n.id, n.label)).join(', ')}. Attribution remains partial: the strongest
        assertion in the set is the operator relationship, and the weakest is the faction association carried at
        low confidence. Open the graph to trace the chain.</p>

      <h2>Indicators and warnings</h2>
      <ul>${(d.sel.some(e => e.domain === 'maritime') ? ['<li>A second interference event in the same corridor inside seven days would move the corridor index above 90 and trigger the pre-agreed rerouting clause.</li>'] : [])
        .concat(d.sel.some(e => e.domain === 'conflict') ? ['<li>Movement of front lines within 50km of a contracted facility requires an immediate duty-of-care review.</li>'] : [])
        .concat(['<li>Any single signal at critical severity uncorroborated after 24 hours should be downgraded rather than carried forward.</li>']).join('')}</ul>

      <h2>Sourcing and method</h2>
      <p>${sel.length} signals from ${new Set(sel.map(e => e.source)).size} feeds, mean confidence ${mean}%,
        plus ${X.scenes.length} imagery scenes and ${X.vessels.length + X.aircraft.length} live tracks.
        Every reference in this briefing is clickable: selecting one shows the underlying record and its geography
        in the panel to the right. Generated from the console corpus; illustrative, not live reporting.</p>
    </div>`;

    const refs = $$('#rd-body .xref');
    $('#rd-ref-c').textContent = refs.length;
    $('#rd-refs').innerHTML = refs.map((r, i) => `<li><a href="#" data-i="${i}"><span>${String(i + 1).padStart(2, '0')}</span><span>${r.textContent.replace(' â¸', '')}</span></a></li>`).join('');
    $$('#rd-refs a').forEach(a => a.onclick = ev => { ev.preventDefault(); activateRef(refs[+a.dataset.i]); });
    refs.forEach(r => r.onclick = () => activateRef(r));
    if (refs.length) activateRef(refs[0], true);
  }

  function activateRef(el, quiet) {
    $$('#rd-body .xref').forEach(x => x.classList.toggle('active', x === el));
    if (!quiet) el.scrollIntoViewIfNeeded ? el.scrollIntoViewIfNeeded() : null;
    const kind = el.dataset.k, id = el.dataset.id;
    if (!rdMini) rdMini = makeMinimap('#rd-mini');
    const box = $('#rd-ctx');
    if (kind === 'signal') {
      const e = D.events.find(x => x.id === id); if (!e) return;
      $('#rd-mini-t').textContent = e.place; $('#rd-mini-s').textContent = zulu(e.ts);
      const ctx = D.events.filter(o => o.id !== e.id && d3.geoDistance([e.lon, e.lat], [o.lon, o.lat]) * 6371 < 1400)
        .map(o => ({ lon: o.lon, lat: o.lat, color: SEV[o.severity].color }));
      rdMini.show(e.lon, e.lat, { label: e.place, color: SEV[e.severity].color, context: ctx, span: 16 });
      box.innerHTML = `<div class="ctxcard"><span class="lbl">Signal ${e.id}</span>
          <div class="row" style="display:flex;gap:8px;margin-bottom:8px">
            <span class="sev" style="color:${SEV[e.severity].color}"><i class="dia" style="background:${SEV[e.severity].color}"></i>${SEV[e.severity].name}</span>
            <span class="tag">${DOM[e.domain].short}</span><span class="tag">${e.source}</span></div>
          <p style="font-size:12.5px;line-height:1.5;color:var(--txt);margin:0 0 8px">${esc(e.title)}</p>
          <p class="muted" style="font-size:12px;line-height:1.55;margin:0">${esc(e.summary)}</p></div>
        <div class="ctxcard"><span class="lbl">Record</span><dl class="kv">
          <dt>Location</dt><dd>${esc(e.place)}, ${esc(e.country)}</dd>
          <dt>Coordinates</dt><dd class="mono">${e.lat.toFixed(3)}, ${e.lon.toFixed(3)}</dd>
          <dt>Received</dt><dd class="mono">${zulu(e.ts)}</dd>
          <dt>Confidence</dt><dd class="mono">${Math.round(e.conf * 100)}%</dd></dl></div>
        <div class="ctxcard" style="border:0"><div class="btnrow">
          <button class="btn sm primary" id="rd-map"><svg><use href="#i-globe"/></svg> open on map</button>
          <button class="btn sm" id="rd-replay"><svg><use href="#i-play"/></svg> animate lead-up</button>
          <button class="btn sm" id="rd-inbox">open in inbox</button></div></div>`;
      on('#rd-map', 'click', () => { window.HWopen('map'); window.HWselect(e.id); setTimeout(() => { M.flyTo(e.lon, e.lat, 5); setTimeout(() => M.ping(e.lon, e.lat), 700); }, 60); });
      on('#rd-replay', 'click', () => replayOnMap(e.id));
      on('#rd-inbox', 'click', () => { window.HWopen('inbox'); window.HWtoast('Signal ' + e.id + ' selected in the inbox'); });
    } else if (kind === 'scene') {
      const s = X.scenes.find(x => x.id === id);
      $('#rd-mini-t').textContent = s.place; $('#rd-mini-s').textContent = s.dateB;
      rdMini.show(s.lon, s.lat, { label: s.place, color: '#b7822c', span: 10 });
      box.innerHTML = `<div class="ctxcard"><span class="lbl">Imagery scene ${s.id}</span>
        <p class="muted" style="font-size:12px;line-height:1.55;margin:0 0 8px">${s.sensor} Â· ${s.vendor} Â· ${s.dateA} â ${s.dateB}.
        ${s.changes.length} change detections, ${s.changes.filter(c => c.conf > .8).length} above 80% confidence.</p>
        ${s.changes.slice(0, 3).map(c => `<div class="detrow" style="cursor:default"><i class="sq" style="background:${c.type === 'new' ? '#c4453c' : c.type === 'expanded' ? '#b7822c' : '#4f7fa6'}"></i>
          <span>${esc(c.label)}</span><span class="cf">${Math.round(c.conf * 100)}%</span></div>`).join('')}</div>
        <div class="ctxcard" style="border:0"><button class="btn sm primary" id="rd-im"><svg><use href="#i-sat"/></svg> open change detection</button></div>`;
      on('#rd-im', 'click', () => { I.scene = s.id; window.HWopen('imagery'); renderImageryList(); renderScene(); });
    } else if (kind === 'node') {
      const n = X.nodes.find(x => x.id === id);
      const ev = D.events.find(e => e.place.includes(n.label.split(' ')[0]));
      if (ev) { $('#rd-mini-t').textContent = n.label; $('#rd-mini-s').textContent = 'linked geography'; rdMini.show(ev.lon, ev.lat, { label: n.label, color: riskColor(n.risk), span: 20 }); }
      const lk = X.links.filter(l => l.s === n.id || l.t === n.id);
      box.innerHTML = `<div class="ctxcard"><span class="lbl">Ontology object</span>
        <p style="font-size:13px;color:var(--txt);margin:0 0 4px">${esc(n.label)}</p>
        <p class="muted" style="font-size:12px;margin:0 0 8px">${X.NODE_TYPES[n.type].name} Â· risk ${n.risk}</p>
        ${lk.slice(0, 5).map(l => { const o = X.nodes.find(x => x.id === (l.s === n.id ? l.t : l.s));
          return `<div class="linkrow"><span class="k">${l.kind}</span><span>${esc(o.label)}</span><span class="cf">${Math.round(l.conf * 100)}%</span></div>`; }).join('')}</div>
        <div class="ctxcard" style="border:0"><button class="btn sm primary" id="rd-onto"><svg><use href="#i-onto"/></svg> open in ontology</button></div>`;
      on('#rd-onto', 'click', () => openOntology(n.id));
    } else {
      const evs = D.events.filter(e => e.region === id);
      const c = [d3.mean(evs, e => e.lon), d3.mean(evs, e => e.lat)];
      $('#rd-mini-t').textContent = id; $('#rd-mini-s').textContent = evs.length + ' signals';
      rdMini.show(c[0], c[1], { label: id, color: '#4f7fa6', span: 46, context: evs.map(e => ({ lon: e.lon, lat: e.lat, color: SEV[e.severity].color })) });
      box.innerHTML = `<div class="ctxcard"><span class="lbl">Region ${id}</span>
        <p class="muted" style="font-size:12px;margin:0 0 8px">${evs.length} signals in the corpus, ${evs.filter(e => e.severity === 'critical').length} critical.</p>
        <ul class="evlist">${evs.slice(0, 6).map(window.HWrowHTML).join('')}</ul></div>`;
      window.HWbindRows(box);
    }
  }
  on('#rd-tour', 'click', () => {
    const refs = $$('#rd-body .xref'); if (!refs.length) return;
    if (R.tour) { clearInterval(R.tour); R.tour = null; $('#rd-tour').innerHTML = '<svg><use href="#i-play"/></svg> guided walkthrough'; return; }
    let i = 0; $('#rd-tour').innerHTML = '<svg><use href="#i-pause"/></svg> stop walkthrough';
    activateRef(refs[0]);
    R.tour = setInterval(() => {
      i++; if (i >= refs.length) { clearInterval(R.tour); R.tour = null; $('#rd-tour').innerHTML = '<svg><use href="#i-play"/></svg> guided walkthrough'; return; }
      activateRef(refs[i]);
      refs[i].scrollIntoView ? refs[i].closest('p,li,div').scrollIntoView({ block: 'center', behavior: 'smooth' }) : null;
    }, 3600);
  });
  on('#rd-print', 'click', () => window.HWopen('doc'));
  on('#rd-dist', 'click', () => {
    const d = window.HWMdoc && window.HWMdoc.doc();
    if (!d) return window.HWtoast('No briefing loaded', 'warn');
    window.HWgmail.openDistribute(d);
  });

  /* ââââââââââââââââ G Â· SCAN AREAS ââââââââââââââââ
     Draw a box or polygon on the map, configure an ML object-recognition and
     interpretation pass over it, run it once, or persist it as a recurring
     observation area that the scheduler re-scans on a cadence. */
  const SC = { pts: null, kind: null, name: '', cls: 'custom', cadence: 'weekly',
    sensor: 'Sentinel-2 Â· optical 10m', classes: new Set(), conf: .6, running: false, log: [] };

  const CLASS_PRESETS = {
    airport:  ['Aircraft', 'Helicopter', 'Revetment', 'Vehicle', 'Structure'],
    port:     ['Vessel', 'Small craft', 'Container stack', 'Crane', 'Vehicle'],
    military: ['Aircraft', 'Vehicle', 'Revetment', 'Launcher', 'Berm'],
    energy:   ['Structure', 'Fuel bladder', 'Vehicle', 'Crane'],
    urban:    ['Structure', 'Damaged structure', 'Vehicle'],
    border:   ['Vehicle', 'Structure', 'Berm'],
    custom:   ['Structure', 'Vehicle', 'Vessel']
  };
  const SENSORS = ['Sentinel-2 Â· optical 10m', 'Sentinel-1 Â· SAR 20m', 'Commercial EO Â· 0.5m', 'Commercial SAR Â· 1m'];

  /* d3 reads a ring's winding to decide which side is inside, so a ring wound
     the wrong way measures and fills the COMPLEMENT of the intended area â a
     drawn box came out as 504,470,700 kmÂ². Drag order and free-hand click order
     are both arbitrary, so pick the winding empirically: an AOI is always far
     smaller than half the sphere (2Ï steradians). */
  const ringArea = pts => d3.geoArea({ type: 'Polygon', coordinates: [pts.concat([pts[0]])] });
  function normalizeRing(pts) {
    if (pts.length < 3) return pts;
    if (ringArea(pts) <= 2 * Math.PI) return pts;
    const r = pts.slice().reverse();
    return ringArea(r) <= 2 * Math.PI ? r : pts;
  }
  function scanGeom(pts) {
    const poly = { type: 'Polygon', coordinates: [pts.concat([pts[0]])] };
    const areaKm2 = d3.geoArea(poly) * 6371 * 6371;
    const c = d3.geoCentroid(poly), b = d3.geoBounds(poly);
    const widthKm = d3.geoDistance([b[0][0], c[1]], [b[1][0], c[1]]) * 6371;
    const heightKm = d3.geoDistance([c[0], b[0][1]], [c[0], b[1][1]]) * 6371;
    return { poly, areaKm2, centroid: c, bounds: b, widthKm, heightKm };
  }

  function openScanPanel(pts, kind) {
    pts = normalizeRing(pts);
    SC.pts = pts; SC.kind = kind; SC.running = false; SC.log = [];
    const g = scanGeom(pts);
    // suggest a name and class from the nearest known infrastructure
    let near = null, nd = 1e9;
    X.places.forEach(p => { const d = d3.geoDistance([p.lon, p.lat], g.centroid) * 6371; if (d < nd) { nd = d; near = p; } });
    const inArea = near && nd < Math.max(30, g.widthKm);
    SC.cls = inArea ? (near.kind === 'port' ? 'port' : 'airport') : 'custom';
    SC.name = inArea ? near.name + ' scan area'
      : (D.events.slice().sort((a, b) => d3.geoDistance([a.lon, a.lat], g.centroid) - d3.geoDistance([b.lon, b.lat], g.centroid))[0] || {}).place + ' scan area';
    SC.classes = new Set(CLASS_PRESETS[SC.cls]);
    draft = pts; M.redraw();
    renderScanPanel();
    $('#scanpanel').classList.add('open');
    $('#scanpanel').setAttribute('aria-hidden', 'false');
  }
  function closeScan() {
    const p = $('#scanpanel'); if (!p) return;
    p.classList.remove('open'); p.setAttribute('aria-hidden', 'true');
    SC.pts = null; draft = []; M.redraw();
  }

  function renderScanPanel() {
    if (!SC.pts) return;
    const g = scanGeom(SC.pts);
    const tiles = Math.max(1, Math.ceil(g.areaKm2 / 12100));
    const revisit = SC.sensor.startsWith('Sentinel-2') ? '5 days' : SC.sensor.startsWith('Sentinel-1') ? '6 days' : 'on tasking';
    $('#scan-body').innerHTML = `
      <div class="sect" style="padding:11px 12px">
        <div class="scanmetric">
          <div><b>${g.areaKm2 < 100 ? g.areaKm2.toFixed(1) : Math.round(g.areaKm2).toLocaleString()}</b><span>kmÂ² covered</span></div>
          <div><b>${SC.pts.length}</b><span>${SC.kind === 'box' ? 'box corners' : 'polygon vertices'}</span></div>
          <div><b>${tiles}</b><span>archive tiles</span></div>
          <div><b>${revisit}</b><span>revisit</span></div>
        </div>
        <div class="field"><label>Area name</label><input class="input" id="sc-name" value="${esc(SC.name)}"></div>
        <div class="field"><label>Area class</label><select class="input" id="sc-cls">${Object.entries(X.AOI_CLASSES)
          .map(([k, v]) => `<option value="${k}" ${k === SC.cls ? 'selected' : ''}>${v.name}</option>`).join('')}</select></div>
        <div class="field"><label>Sensor</label><select class="input" id="sc-sensor">${SENSORS
          .map(s => `<option ${s === SC.sensor ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Detection classes â ${SC.classes.size} of ${X.DETECT_CLASSES.length}</label>
          <div class="classgrid">${X.DETECT_CLASSES.map(dc => `<label class="check" style="padding:3px 0">
            <input type="checkbox" data-dc="${esc(dc)}" ${SC.classes.has(dc) ? 'checked' : ''}><span>${dc}</span></label>`).join('')}</div></div>
        <div class="field"><label>Confidence floor â ${Math.round(SC.conf * 100)}%</label>
          <input type="range" id="sc-conf" min="40" max="95" value="${Math.round(SC.conf * 100)}"></div>
        <div class="field"><label>Recurring cadence</label><select class="input" id="sc-cad">${['daily', '3-day', 'weekly', 'monthly', 'on demand']
          .map(cd => `<option ${cd === SC.cadence ? 'selected' : ''}>${cd}</option>`).join('')}</select></div>
        <dl class="kv"><dt>Centroid</dt><dd class="mono">${g.centroid[1].toFixed(3)}, ${g.centroid[0].toFixed(3)}</dd>
          <dt>Extent</dt><dd class="mono">${Math.round(g.widthKm)} Ã ${Math.round(g.heightKm)} km</dd>
          <dt>Owner</dt><dd>K. Almeida</dd></dl>
      </div>
      ${SC.log.length ? `<div class="sect" style="padding:11px 12px;border:0">
        <span class="lbl" style="display:block;margin-bottom:6px;font-weight:600;color:var(--txt-2)">Detector</span>
        <div class="scanvert" id="sc-log">${SC.log.join('<br>')}</div></div>` : ''}`;
    on('#sc-name', 'input', ev => { SC.name = ev.target.value; });
    on('#sc-cls', 'change', ev => {
      SC.cls = ev.target.value; SC.classes = new Set(CLASS_PRESETS[SC.cls] || CLASS_PRESETS.custom); renderScanPanel();
    });
    on('#sc-sensor', 'change', ev => { SC.sensor = ev.target.value; renderScanPanel(); });
    on('#sc-cad', 'change', ev => { SC.cadence = ev.target.value; });
    on('#sc-conf', 'input', ev => {
      SC.conf = +ev.target.value / 100;
      ev.target.previousElementSibling.textContent = 'Confidence floor â ' + ev.target.value + '%';
    });
    $$('#scan-body input[data-dc]').forEach(ck => ck.onchange = () => {
      ck.checked ? SC.classes.add(ck.dataset.dc) : SC.classes.delete(ck.dataset.dc);
    });
  }

  const scLog = line => { SC.log.push(line); const el = $('#sc-log'); if (el) { el.innerHTML = SC.log.join('<br>'); el.scrollTop = el.scrollHeight; } else renderScanPanel(); };

  function runScan() {
    if (!SC.pts) return;
    if (!SC.classes.size) return window.HWtoast('Select at least one detection class', 'warn');
    if (SC.running) return;
    SC.running = true; SC.log = [];
    $('#scan-run').disabled = true;
    const g = scanGeom(SC.pts);
    const tiles = Math.max(1, Math.ceil(g.areaKm2 / 12100));
    /* sweep the drawn area on the map while the pass runs */
    const sweep = M.layer('sweep'); sweep.selectAll('*').remove();
    const b = g.bounds, steps = 26;
    for (let s = 1; s <= steps; s++) setTimeout(() => {
      const lat = b[1][1] - (b[1][1] - b[0][1]) * (s / steps);
      const p0 = M.projection([b[0][0], lat]), p1 = M.projection([b[1][0], lat]);
      sweep.selectAll('*').remove();
      if (p0 && p1) sweep.append('path').attr('class', 'scan-sweep').attr('d', `M${p0} L${p1}`);
      if (s === steps) sweep.selectAll('*').remove();
    }, s * 90);

    const stages = [
      [220, () => scLog(`<b>hw-scan</b> ${SC.sensor.split(' Â· ')[0].toLowerCase()} Â· ${Math.round(g.areaKm2).toLocaleString()} kmÂ²`)],
      [420, () => scLog(`queried archive Â· ${tiles} tile${tiles > 1 ? 's' : ''} Â· quality gates passed`)],
      [520, () => scLog('co-registered against stored reference')],
      [760, () => scLog(`object pass Â· ${SC.classes.size} classes`)],
      [880, () => scLog('siamese change pass Â· differencing counts')],
      [420, () => scLog(`filtered below ${Math.round(SC.conf * 100)}% Â· suppressed 2 recurring`)]
    ];
    let i = 0;
    const tick = () => {
      if (i >= stages.length) return finishScan(g, tiles);
      const [d, fn] = stages[i++]; fn(); setTimeout(tick, d);
    };
    tick();
  }

  function finishScan(g, tiles) {
    const cls = Array.from(SC.classes);
    const seed = Math.abs(Math.round(g.areaKm2 + g.centroid[0] * 100));
    const pick = (n, i) => ((seed * (i + 7)) % n);
    const today = new Date();
    const iso = d => d.toISOString().slice(0, 10);
    const ref = new Date(today.getTime() - 78 * 864e5);

    const counts = cls.slice(0, 5).map((c, i) => {
      const base = 8 + pick(180, i);
      const delta = pick(31, i + 2) - 12;
      return [c, base, delta];
    });
    const movers = counts.filter(c => c[2] !== 0).sort((a, b) => Math.abs(b[2]) - Math.abs(a[2])).slice(0, 3);
    const changes = movers.map((m, i) => {
      const grew = m[2] > 0;
      const type = grew ? (pick(2, i) ? 'new' : 'expanded') : 'removed';
      return {
        id: 'CHG-' + String(20 + i).padStart(2, '0'),
        label: interpret(m[0], m[2], SC.cls),
        type, conf: Math.min(.96, SC.conf + .08 + (pick(18, i) / 100)),
        bbox: [12 + pick(46, i), 16 + pick(44, i + 1), 14 + pick(14, i), 11 + pick(12, i + 3)],
        note: `${Math.abs(m[2])} ${m[0].toLowerCase()} ${grew ? 'added since' : 'no longer present against'} the ${iso(ref)} reference scene.`
      };
    });

    const id = 'SCN-' + (4480 + X.scenes.length);
    const scene = {
      id, place: SC.name, iso3: nearestIso(g.centroid), lat: g.centroid[1], lon: g.centroid[0],
      aoi: 'pending', sensor: SC.sensor.includes('SAR') ? 'SAR Â· 20m' : SC.sensor.includes('0.5m') ? 'EO Â· 0.5m' : 'EO Â· 10m',
      vendor: SC.sensor.split(' Â· ')[0], dateA: iso(ref), dateB: iso(today),
      cloud: pick(14, 1), offNadir: 6 + pick(20, 2), counts, changes
    };
    X.scenes.unshift(scene);
    SC.running = false; $('#scan-run').disabled = false;
    scLog(`<i style="color:#699781;font-style:normal">${changes.length} findings</i> Â· scene ${id}`);
    window.HWtoast(`${changes.length} findings over ${SC.name} â opening ${id}`, 'ok');
    I.scene = id; I.det = changes[0] && changes[0].id;
    window.HWopen('imagery');
    renderAOIs(); renderImageryList(); renderScene();
  }

  /* raw count deltas â analyst-readable findings */
  function interpret(cl, delta, area) {
    const up = delta > 0, n = Math.abs(delta);
    const map = {
      'Aircraft': up ? 'Aircraft presence increased on the apron' : 'Aircraft dispersed or withdrawn',
      'Helicopter': up ? 'Rotary-wing presence established' : 'Rotary-wing presence withdrawn',
      'Vessel': up ? 'Increased port activity â vessel calls up' : 'Berth occupancy reduced',
      'Small craft': up ? 'Small-craft cluster expanded' : 'Small-craft cluster dispersed',
      'Container stack': up ? 'Container yard throughput increased' : 'Container yard drawn down',
      'Crane': up ? 'Additional handling equipment on site' : 'Handling equipment demobilised',
      'Vehicle': up ? 'Vehicle concentration increased' : 'Vehicle concentration reduced',
      'Revetment': up ? 'New hardened revetments constructed' : 'Revetments cleared',
      'Structure': up ? 'New construction within the area' : 'Structures removed or levelled',
      'Damaged structure': up ? 'Increased structural destruction' : 'Damaged structures cleared or rebuilt',
      'Fuel bladder': up ? 'Fuel storage established' : 'Fuel storage removed',
      'Launcher': up ? 'Launcher-sized objects detected' : 'Launcher-sized objects no longer present',
      'Berm': up ? 'New earthworks and berms' : 'Earthworks removed'
    };
    return (map[cl] || (up ? cl + ' count increased' : cl + ' count reduced')) + ` (${up ? '+' : 'â'}${n})`;
  }
  function nearestIso(c) {
    let best = 'XXX', bd = 1e9;
    D.events.forEach(e => { const d = d3.geoDistance([e.lon, e.lat], c); if (d < bd) { bd = d; best = e.iso3; } });
    return best;
  }

  function saveRecurring() {
    if (!SC.pts) return;
    const g = scanGeom(SC.pts);
    const id = 'AOI-' + String(70 + A.list.length).padStart(2, '0');
    A.list.unshift({
      id, name: SC.name || 'Scan area ' + id, cls: SC.cls, iso3: nearestIso(g.centroid),
      lat: g.centroid[1], lon: g.centroid[0], radiusKm: +(Math.sqrt(g.areaKm2 / Math.PI)).toFixed(1),
      cadence: SC.cadence, status: 'active', scene: X.scenes[0] && X.scenes[0].place === SC.name ? X.scenes[0].id : null,
      owner: 'K. Almeida', auto: false, recurring: true, pts: SC.pts.slice(),
      classes: Array.from(SC.classes), conf: SC.conf, sensor: SC.sensor,
      notes: `Drawn on the situation map Â· ${Math.round(g.areaKm2).toLocaleString()} kmÂ² Â· ${Array.from(SC.classes).length} detection classes.`
    });
    A.sel = id;
    window.HWtoast(`${id} saved Â· re-scanned ${SC.cadence} and written to the area registry`, 'ok');
    closeScan(); setTool('select');
    renderAOIs(); renderImageryList(); M.redraw();
  }

  /* saved scan zones persist on the map */
  window.HWmapHooks.push({ draw: (proj, path, k) => {
    const g = M.layer('scanzones');
    const zones = (typeof A !== 'undefined' ? A.list : []).filter(a => a.pts && a.status !== 'paused');
    const sel = g.selectAll('g.zone').data(zones, d => d.id);
    sel.exit().remove();
    const en = sel.enter().append('g').attr('class', 'zone').style('cursor', 'pointer')
      .on('mousemove', (ev, d) => M.tip(ev, `<b>${esc(d.name)}</b><span class="lbl">${d.id} Â· recurring ${d.cadence}<br>${(d.classes || []).length} detection classes</span>`))
      .on('mouseleave', M.tipHide)
      .on('click', (ev, d) => { ev.stopPropagation(); A.sel = d.id; if (d.scene) I.scene = d.scene; window.HWopen('imagery'); renderAOIs(); renderImageryList(); renderScene(); });
    const all = en.merge(sel);
    all.selectAll('*').remove();
    all.each(function (d) {
      const n = d3.select(this);
      n.append('path').attr('class', 'scan-shape').attr('opacity', .8)
        .attr('d', path({ type: 'Polygon', coordinates: [d.pts.concat([d.pts[0]])] }));
      const c = d3.geoCentroid({ type: 'Polygon', coordinates: [d.pts.concat([d.pts[0]])] });
      const p = proj(c);
      if (p) n.append('text').attr('x', p[0]).attr('y', p[1]).attr('text-anchor', 'middle')
        .attr('font-size', 9.5 / k).attr('fill', '#9ec6f5').attr('paint-order', 'stroke')
        .attr('stroke', '#12161a').attr('stroke-width', 2.6 / k).text(d.id);
    });
  } });

  on('#scan-close', 'click', () => { closeScan(); setTool('select'); });
  on('#scan-run', 'click', runScan);
  on('#scan-save', 'click', saveRecurring);

  /* ââââââââââââââââ wiring ââââââââââââââââ */
  window.HWann = anns;
  window.HWXaoi = { get list() { return A.list; }, get sel() { return A.sel; }, set sel(v) { A.sel = v; }, render: renderAOIs, renderList: renderImageryList, renderScene, get I() { return I; } };
  window.HWX = {
    onModule(id) {
      if (id === 'map') { injectMapPanel(); M.redraw(); }
      if (id === 'ontology') { renderOntLegend(); drawGraph(); renderOntInspector(); }
      if (id === 'imagery') {
        renderAOIs(); renderImageryList(); renderScene();
        $('#im-blend-wrap').classList.toggle('hidden', I.view !== 'swipe');
        $('#im-blend-ctl').classList.toggle('hidden', !(I.view === 'swipe' && I.blend));
      }
      if (id === 'reader') renderReader();
      if (id === 'replay') { const rp = window.HWMcore && window.HWMcore.rp; if (rp && rp.sel) replayFocus(rp.sel); }
      if (id !== 'reader' && R.tour) { clearInterval(R.tour); R.tour = null; }
    },
    openOntology, replayOnMap, renderReader
  };
  window.addEventListener('resize', () => { if (S.module === 'ontology') { O.layoutKey = null; drawGraph(); } });
  injectMapPanel();
  /* the map pane now spans the full grid under the glass panels: re-fit whenever its box changes */
  if (window.ResizeObserver) {
    let t0 = 0;
    new ResizeObserver(() => {
      clearTimeout(t0);
      t0 = setTimeout(() => { if (window.HWshell) { window.HWshell.sizeMap(); window.HWshell.drawStrip(); } }, 60);
    }).observe($('#mapwrap'));
  }
  setTimeout(() => { if (window.HWshell) { window.HWshell.sizeMap(); window.HWshell.drawStrip(); } }, 300);
})();
