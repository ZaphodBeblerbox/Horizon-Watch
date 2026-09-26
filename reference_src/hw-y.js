/* Horizon Watch â sessions, palette v2, saved views, alert rules, exports,
   related records, time cursor, clustering, scan history, link appendix,
   settings and full screen. Extends hw-app / hw-modules / hw-x through the
   globals they publish; loaded last. */
(function () {
  const D = window.HW, X = window.HW2, DOM = D.DOMAINS, SEV = D.SEV, S = window.HWS;
  const { $, $$, zulu, hhmm, ago, esc } = window.HWU;
  const on = (s, e, f) => { const n = typeof s === 'string' ? $(s) : s; if (n) n.addEventListener(e, f); };
  const M = window.HWmap, SH = window.HWshell;
  const KEY = 'horizonwatch.workspace.v1';

  /* ââââââââ 0 Â· persisted workspace ââââââââ */
  const DEFAULT_SETTINGS = {
    clusterAt: 2, clustering: true, geocode: true, labels: false,
    density: 'comfortable', confirmDelete: false, autoAck: true, tips: true
  };
  const Y = {
    sessions: [], active: null, railOrder: null, recents: [], pinned: [],
    rules: [], settings: { ...DEFAULT_SETTINGS }, gazetteer: null
  };
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        sessions: Y.sessions.map(s => ({ ...s, tabs: s.tabs, basket: s.basket })),
        active: Y.active, railOrder: Y.railOrder, recents: Y.recents.slice(0, 12),
        pinned: Y.pinned, rules: Y.rules, settings: Y.settings
      }));
    } catch (e) { /* storage unavailable â the console still works, just not across reloads */ }
  }
  function restore() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw || !raw.sessions || !raw.sessions.length) return false;
    Y.sessions = raw.sessions; Y.active = raw.active || raw.sessions[0].id;
    Y.railOrder = raw.railOrder || null; Y.recents = raw.recents || [];
    Y.pinned = raw.pinned || []; Y.rules = raw.rules || [];
    Y.settings = Object.assign({ ...DEFAULT_SETTINGS }, raw.settings || {});
    return true;
  }

  /* ââââââââ 1 Â· sessions ââââââââ
     A session is a whole workspace: its own time window, layers, severity
     floor, projection, map position, record tabs, briefing basket and saved
     views. Switching sessions restores all of it, so "Red Sea corridor" and
     "Indo-Pacific" are genuinely different desks. */
  const newSession = (name, patch) => Object.assign({
    id: 'S' + Math.random().toString(36).slice(2, 7),
    name, win: 72, sevFloor: 1, domains: Object.keys(DOM), proj: 'world',
    ctx: { risk: true, grat: true, labels: false, flows: true, aoi: true, arcs: true },
    tabs: [], basket: [], views: [], transform: null
  }, patch || {});

  const SEED_SESSIONS = () => [
    newSession('Global watch'),
    newSession('Red Sea corridor', { proj: 'emea', win: 168, sevFloor: 2,
      domains: ['maritime', 'conflict', 'energy'],
      views: [{ id: 'V1', name: 'Critical only, 24h', win: 24, sevFloor: 4, domains: ['maritime', 'conflict', 'energy'], proj: 'emea' }] }),
    newSession('Baltic & Nordics', { proj: 'emea', win: 720, domains: ['cyber', 'conflict', 'political'] }),
    newSession('Indo-Pacific', { proj: 'apac', win: 168, domains: ['maritime', 'conflict', 'trade'] })
  ];

  const session = () => Y.sessions.find(s => s.id === Y.active) || Y.sessions[0];

  function captureSession() {
    const s = session(); if (!s) return;
    s.win = S.win; s.sevFloor = S.sevFloor; s.domains = Array.from(S.domains);
    s.ctx = { ...S.ctx }; s.proj = S.proj; s.tabs = S.tabs; s.basket = S.basket.slice();
    const t = M.transform; if (t) s.transform = { k: t.k, x: t.x, y: t.y };
  }
  function applySession(id, opts) {
    const s = Y.sessions.find(z => z.id === id); if (!s) return;
    Y.active = id;
    S.win = s.win; S.sevFloor = s.sevFloor;
    S.domains = new Set(s.domains); S.ctx = { ...s.ctx }; S.proj = s.proj;
    S.basket.length = 0; (s.basket || []).forEach(b => S.basket.push(b));
    S.tabs = s.tabs && s.tabs.length ? s.tabs : [{ id: 'B' + s.id, mod: 'map', label: s.name, kind: 'base' }];
    s.tabs = S.tabs;
    S.tab = S.tabs[0].id; S.sel = null; S.tCut = null;
    $('#ses-name').textContent = s.name;
    $('#st-basket').textContent = S.basket.length;
    $$('#win-seg button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.win === S.win));
    $('#cnt-win').textContent = S.win === 24 ? '24h' : S.win === 72 ? '72h' : S.win === 168 ? '7d' : '30d';
    $$('#proj-seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.proj === S.proj));
    SH.renderLayers(); renderViews();
    SH.fitView(S.proj, false);
    if (s.transform && !opts?.freshView) M.svg.call(M.zoom.transform, d3.zoomIdentity.translate(s.transform.x, s.transform.y).scale(s.transform.k));
    SH.renderTabs(); SH.renderInspector(); SH.drawMarkers(); SH.drawStrip();
    renderTimeCursor(); persist();
    if (opts?.toast !== false) window.HWtoast('Session Â· ' + s.name);
  }
  window.HWsession = { apply: applySession, capture: captureSession, current: session };

  /* session popover */
  function renderSessions() {
    $('#ses-list').innerHTML = Y.sessions.map(s => `<li data-id="${s.id}" aria-selected="${s.id === Y.active}">
      <i class="sw" style="${s.id === Y.active ? '' : 'background:var(--txt-4)'}"></i>
      <div><b>${esc(s.name)}</b><em>${s.win >= 720 ? '30d' : s.win >= 168 ? '7d' : s.win + 'h'} Â· ${s.domains.length}/${Object.keys(DOM).length} layers Â· ${s.proj} Â· ${(s.views || []).length} views</em></div>
      <button class="x" title="Delete session">â</button></li>`).join('');
    $$('#ses-list li').forEach(li => li.onclick = ev => {
      const id = li.dataset.id;
      if (ev.target.closest('.x')) {
        if (Y.sessions.length < 2) return window.HWtoast('At least one session must remain', 'warn');
        Y.sessions = Y.sessions.filter(s => s.id !== id);
        if (Y.active === id) applySession(Y.sessions[0].id, { toast: false });
        renderSessions(); persist(); return;
      }
      captureSession(); applySession(id); renderSessions(); closePop();
    });
  }
  function openPop() {
    const r = $('#ses-open').getBoundingClientRect(), p = $('#ses-pop');
    p.style.left = Math.round(r.left) + 'px'; p.style.top = Math.round(r.bottom + 4) + 'px';
    p.classList.add('open'); p.setAttribute('aria-hidden', 'false'); renderSessions();
  }
  const closePop = () => { const p = $('#ses-pop'); p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); };
  on('#ses-open', 'click', ev => { ev.stopPropagation(); $('#ses-pop').classList.contains('open') ? closePop() : openPop(); });
  document.addEventListener('click', ev => { if (!ev.target.closest('#ses-pop,#ses-open')) closePop(); });
  on('#ses-new', 'click', ev => {
    ev.stopPropagation();
    captureSession();
    const s = newSession('New session', { win: S.win, sevFloor: S.sevFloor, domains: Array.from(S.domains), proj: S.proj, ctx: { ...S.ctx } });
    Y.sessions.push(s); applySession(s.id, { toast: false }); renderSessions();
    window.HWtoast('Session created from the current view â rename it in the list', 'ok');
    setTimeout(() => {
      const li = $(`#ses-list li[data-id="${s.id}"] b`); if (!li) return;
      li.outerHTML = `<input class="input" id="ses-rename" value="${esc(s.name)}" style="height:22px;font-size:12.5px">`;
      const f = $('#ses-rename'); f.focus(); f.select();
      const done = keep => { if (keep && f.value.trim()) { s.name = f.value.trim(); $('#ses-name').textContent = s.name; if (S.tabs[0]?.kind === 'base') S.tabs[0].label = s.name; SH.renderTabs(); } renderSessions(); persist(); };
      f.onblur = () => done(true);
      f.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); };
      f.onclick = e => e.stopPropagation();
    }, 30);
  });

  /* ââââââââ 2 Â· reorderable rail and tabs ââââââââ */
  function makeSortable(container, itemSel, onOrder) {
    let dragged = null;
    container.addEventListener('dragstart', ev => {
      const it = ev.target.closest(itemSel); if (!it) return;
      dragged = it; it.classList.add('dragging'); ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', ''); } catch (e) {}
    });
    container.addEventListener('dragover', ev => {
      const it = ev.target.closest(itemSel); if (!it || !dragged || it === dragged) return;
      ev.preventDefault();
      const r = it.getBoundingClientRect(), after = (ev.clientX - r.left) > r.width / 2;
      $$(itemSel, container).forEach(n => n.classList.remove('dropbefore', 'dropafter'));
      it.classList.add(after ? 'dropafter' : 'dropbefore');
    });
    container.addEventListener('drop', ev => {
      const it = ev.target.closest(itemSel); if (!it || !dragged || it === dragged) return;
      ev.preventDefault();
      const r = it.getBoundingClientRect(), after = (ev.clientX - r.left) > r.width / 2;
      it.parentNode.insertBefore(dragged, after ? it.nextSibling : it);
      $$(itemSel, container).forEach(n => n.classList.remove('dropbefore', 'dropafter'));
      onOrder($$(itemSel, container));
    });
    container.addEventListener('dragend', () => {
      if (dragged) dragged.classList.remove('dragging');
      $$(itemSel, container).forEach(n => n.classList.remove('dropbefore', 'dropafter'));
      dragged = null;
    });
  }
  /* armRail reorders #modrail, and the observer below watches #modrail â without
     a re-entrance guard, and without skipping a reorder that changes nothing,
     the two feed each other and lock the page. */
  let arming = false, railTicks = 0, railWin = 0;
  function armRail() {
    if (arming) return;
    const now = Date.now();
    if (now - railWin > 1000) { railWin = now; railTicks = 0; }
    if (++railTicks > 24) return;      // shared circuit breaker: never hang the shell
    arming = true;
    const rail = $('#modrail');
    $$('.mod', rail).forEach(b => { b.draggable = true; b.title = b.querySelector('i').textContent + ' â drag to reorder'; });
    if (Y.railOrder && Y.railOrder.length) {
      const present = $$('.mod', rail).map(b => b.dataset.mod);
      /* The desired order must be TOTAL: a stored order missing an id would
         otherwise never match the DOM after a reorder, and the observer loop
         would reorder forever. Anything unlisted goes to the end. */
      const want = Y.railOrder.filter(id => present.includes(id))
        .concat(present.filter(id => !Y.railOrder.includes(id)));
      if (present.join() !== want.join())
        want.forEach(id => { const b = $(`.mod[data-mod="${id}"]`, rail); if (b) rail.appendChild(b); });
    }
    arming = false;
  }
  function armTabs() {
    const strip = $('#tabstrip');
    $$('.tab', strip).forEach(t => { t.draggable = true; });
  }
  makeSortable($('#modrail'), '.mod', items => {
    Y.railOrder = items.map(i => i.dataset.mod); persist();
    window.HWtoast('Module order saved');
  });
  makeSortable($('#tabstrip'), '.tab', items => {
    const order = items.map(i => i.querySelector('span').textContent);
    S.tabs.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    captureSession(); persist();
  });
  /* the rail and tab strip are re-rendered by the shell, so re-arm after each paint */
  new MutationObserver(() => { armRail(); armTabs(); }).observe($('#tabstrip'), { childList: true });
  new MutationObserver(() => armRail()).observe($('#modrail'), { childList: true });

  /* ââââââââ 3 Â· palette v2 ââââââââ
     Indexes every record type, understands scope prefixes and coordinates, and
     resolves place names through a live geocoder with an offline fallback. */
  const SCOPES = [
    { p: 'sig', name: 'signals' }, { p: 'ent', name: 'dossiers' }, { p: 'obj', name: 'ontology' },
    { p: 'loc', name: 'locations' }, { p: 'aoi', name: 'areas' }, { p: 'scn', name: 'scenes' },
    { p: 'trk', name: 'tracks' }, { p: 'brf', name: 'briefings' }, { p: 'view', name: 'views' }
  ];
  const P2 = { q: '', scope: null, items: [], idx: 0, geo: [], busy: false, seq: 0 };

  /* offline gazetteer: infrastructure, event places, country centroids, chokepoints */
  function gazetteer() {
    if (Y.gazetteer) return Y.gazetteer;
    const g = [];
    X.places.forEach(p => g.push({ name: p.name, iso3: p.iso3, lat: p.lat, lon: p.lon, sub: (p.kind === 'port' ? 'Port Â· ' : 'Airport Â· ') + p.code }));
    D.events.forEach(e => { if (!g.some(z => z.name === e.place)) g.push({ name: e.place, iso3: e.iso3, lat: e.lat, lon: e.lon, sub: e.country }); });
    X.scenes.forEach(s => { if (!g.some(z => z.name === s.place)) g.push({ name: s.place, iso3: s.iso3, lat: s.lat, lon: s.lon, sub: 'Imagery scene' }); });
    [['Strait of Hormuz', 26.57, 56.25], ['Bab el-Mandeb', 12.58, 43.33], ['Suez Canal', 30.03, 32.55],
     ['Panama Canal', 9.08, -79.68], ['Taiwan Strait', 24.20, 119.60], ['Strait of Malacca', 2.50, 101.20],
     ['Bosphorus', 41.12, 29.06], ['Danish Straits', 55.90, 11.40], ['Cape of Good Hope', -34.36, 18.47],
     ['Gulf of Aden', 12.50, 47.00], ['Kerch Strait', 45.30, 36.60], ['Gotland Basin', 57.47, 18.49]
    ].forEach(([n, la, lo]) => { if (!g.some(z => z.name === n)) g.push({ name: n, iso3: '', lat: la, lon: lo, sub: 'Chokepoint' }); });
    return (Y.gazetteer = g);
  }

  /* coordinate parsing: decimal pairs and degrees-minutes-seconds */
  function parseCoords(q) {
    const s = q.replace(/^@/, '').trim();
    let m = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) { const la = +m[1], lo = +m[2]; if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) return [lo, la]; }
    const dms = /(\d{1,3})[Â°:\s]+(\d{1,2})['â²:\s]*(\d{1,2}(?:\.\d+)?)?["â³]?\s*([NSEW])/gi;
    const found = []; let r;
    while ((r = dms.exec(s))) {
      let v = +r[1] + (+r[2] || 0) / 60 + (+r[3] || 0) / 3600;
      const h = r[4].toUpperCase();
      if (h === 'S' || h === 'W') v = -v;
      found.push([h, v]);
    }
    if (found.length === 2) {
      const la = found.find(f => f[0] === 'N' || f[0] === 'S'), lo = found.find(f => f[0] === 'E' || f[0] === 'W');
      if (la && lo) return [lo[1], la[1]];
    }
    return null;
  }

  function flyToPlace(lon, lat, label, k) {
    window.HWopen('map');
    setTimeout(() => { M.flyTo(lon, lat, k || 5); setTimeout(() => M.ping(lon, lat), 640); }, 60);
    window.HWtoast(label + ' Â· ' + lat.toFixed(3) + ', ' + lon.toFixed(3));
  }

  /* live geocoding, debounced, with the gazetteer as the fallback */
  let geoTimer = null;
  function geocode(q) {
    clearTimeout(geoTimer);
    if (!Y.settings.geocode || q.length < 3) { P2.geo = []; return; }
    const seq = ++P2.seq;
    geoTimer = setTimeout(() => {
      P2.busy = true; render();
      fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=' + encodeURIComponent(q), { headers: { 'Accept': 'application/json' } })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(rows => {
          if (seq !== P2.seq) return;
          P2.geo = rows.map(r => ({
            kind: 'LOC', label: r.name || r.display_name.split(',')[0],
            sub: r.display_name.split(',').slice(1, 4).join(',').trim(), icon: 'i-pin', live: true,
            go: () => flyToPlace(+r.lon, +r.lat, r.name || r.display_name.split(',')[0], 7)
          }));
        })
        .catch(() => { if (seq === P2.seq) P2.geo = []; })
        .finally(() => { if (seq === P2.seq) { P2.busy = false; render(); } });
    }, 340);
  }

  function indexAll() {
    const out = [];
    const push = (kind, label, sub, icon, go, ref) => out.push({ kind, label, sub, icon, go, ref });

    (SH.MODULES || []).filter(m => !m.hidden).forEach(m =>
      push('MODULE', m.tab, m.label, 'i-grid', () => window.HWopen(m.id), 'mod:' + m.id));
    Y.sessions.forEach(s => push('SESSION', s.name, 'workspace', 'i-session', () => { captureSession(); applySession(s.id); }, 'ses:' + s.id));
    (session().views || []).forEach(v => push('VIEW', v.name, 'filter preset', 'i-view', () => applyView(v.id), 'view:' + v.id));
    D.events.forEach(e => push('SIGNAL', e.title, e.place + ' Â· ' + e.id, null,
      () => { window.HWopen('map'); window.HWselect(e.id, { pan: true }); }, 'sig:' + e.id, e));
    D.entities.forEach(e => push('DOSSIER', e.name, e.type + ' Â· ' + e.code, 'i-dossier', () => window.HWM.openEntity(e.id), 'ent:' + e.id));
    X.nodes.forEach(n => push('OBJECT', n.label,
      X.NODE_TYPES[n.type].name + ' Â· risk ' + n.risk + (Object.keys(n.props).length ? ' Â· ' + Object.values(n.props).slice(0, 2).join(' Â· ') : ''),
      'i-onto', () => window.HWX.openOntology(n.id), 'obj:' + n.id, n));
    X.places.forEach(p => push('PLACE', p.name, (p.kind === 'port' ? 'Port' : 'Airport') + ' Â· ' + p.code + ' Â· ' + p.iso3,
      p.kind === 'port' ? 'i-anchor' : 'i-plane', () => flyToPlace(p.lon, p.lat, p.name, 6), 'loc:' + p.id));
    X.vessels.forEach(v => push('VESSEL', v.name, v.type + ' Â· ' + v.flag + ' Â· MMSI ' + v.mmsi + (v.sanctioned ? ' Â· sanctioned' : ''),
      'i-ship', () => flyToPlace(v.lon, v.lat, v.name, 6), 'trk:' + v.mmsi));
    X.aircraft.forEach(v => push('AIRCRAFT', v.callsign, v.type + ' Â· ' + v.role + ' Â· ICAO ' + v.icao,
      'i-plane', () => flyToPlace(v.lon, v.lat, v.callsign, 6), 'trk:' + v.icao));
    (window.HWXaoi ? window.HWXaoi.list : []).forEach(a => push('AREA', a.name, a.id + ' Â· ' + X.AOI_CLASSES[a.cls].name + ' Â· ' + a.cadence,
      'i-scan', () => { window.HWXaoi.sel = a.id; if (a.scene) window.HWXaoi.I.scene = a.scene; window.HWopen('imagery'); window.HWXaoi.render(); window.HWXaoi.renderList(); window.HWXaoi.renderScene(); }, 'aoi:' + a.id));
    X.scenes.forEach(s => push('SCENE', s.place, s.id + ' Â· ' + s.sensor + ' Â· ' + s.changes.length + ' findings',
      'i-sat', () => { window.HWXaoi.I.scene = s.id; window.HWopen('imagery'); window.HWXaoi.renderList(); window.HWXaoi.renderScene(); }, 'scn:' + s.id));
    D.briefings.forEach(b => push('BRIEFING', b.title, b.id + ' Â· ' + b.status, 'i-read', () => window.HWM.openBriefing(b.id), 'brf:' + b.id));
    gazetteer().forEach(g => push('LOC', g.name, g.sub, 'i-pin', () => flyToPlace(g.lon, g.lat, g.name, 6), 'loc:' + g.name));
    return out;
  }

  const SCOPE_KIND = { sig: ['SIGNAL'], ent: ['DOSSIER'], obj: ['OBJECT'], loc: ['LOC', 'PLACE'],
    aoi: ['AREA'], scn: ['SCENE'], trk: ['VESSEL', 'AIRCRAFT'], brf: ['BRIEFING'], view: ['VIEW', 'SESSION'] };

  function compute() {
    let q = P2.q.trim(), scope = P2.scope;
    const pm = q.match(/^(\w+):\s*(.*)$/);
    if (pm && SCOPE_KIND[pm[1].toLowerCase()]) { scope = pm[1].toLowerCase(); q = pm[2]; }
    const coord = parseCoords(P2.q);
    const ql = q.toLowerCase();
    let items = indexAll();
    if (scope) items = items.filter(i => SCOPE_KIND[scope].includes(i.kind));
    if (ql) items = items.filter(i => (i.label + ' ' + (i.sub || '')).toLowerCase().includes(ql));
    if (coord) items.unshift({ kind: 'COORD', label: coord[1].toFixed(4) + ', ' + coord[0].toFixed(4),
      sub: 'fly the map to these coordinates', icon: 'i-target', go: () => flyToPlace(coord[0], coord[1], 'Coordinates', 7) });
    if (!ql && !scope && !coord) {
      const pin = Y.pinned.map(r => items.find(i => i.ref === r)).filter(Boolean);
      const rec = Y.recents.map(r => items.find(i => i.ref === r)).filter(Boolean).filter(i => !Y.pinned.includes(i.ref));
      items = [{ group: 'Pinned' }, ...pin, { group: 'Recent' }, ...rec, { group: 'Modules' }, ...items.filter(i => i.kind === 'MODULE')]
        .filter((v, i, a) => v.group ? a[i + 1] && !a[i + 1].group : true);
    }
    P2.items = items.slice(0, 60);
    if (ql && !scope) geocode(q); else { P2.geo = []; P2.busy = false; }
    P2.idx = P2.items.findIndex(i => !i.group);
  }

  function render() {
    const rows = P2.items.concat(P2.geo.length ? [{ group: 'Geocoder Â· OpenStreetMap' }].concat(P2.geo) : []);
    $('#palette-list').innerHTML = (P2.busy ? `<li class="geobusy"><i class="spin"></i>searching addressesâ¦</li>` : '') +
      (rows.length ? rows.map((i, n) => i.group
        ? `<div class="grouplbl">${esc(i.group)}</div>`
        : `<li data-i="${n}" aria-selected="${n === P2.idx}">
            ${i.ref && i.ref.startsWith('sig:')
              ? `<i class="dia" style="background:${SEV[(D.events.find(e => 'sig:' + e.id === i.ref) || {}).severity || 'low'].color}"></i>`
              : `<svg style="width:13px;height:13px;color:var(--txt-4);flex:none"><use href="#${i.icon || 'i-search'}"/></svg>`}
            <span class="lab">${esc(i.label)}</span>
            ${i.sub ? `<span class="sub">${esc(i.sub)}</span>` : ''}
            ${i.ref ? `<button class="pin${Y.pinned.includes(i.ref) ? ' on' : ''}" data-pin="${esc(i.ref)}" title="Pin"><svg style="width:11px;height:11px"><use href="#i-pinned"/></svg></button>` : ''}
            <span class="kind">${i.kind}${i.live ? ' Â·live' : ''}</span></li>`).join('')
        : `<li class="geobusy">No match. Try a prefix (${SCOPES.slice(0, 4).map(s => s.p + ':').join(' ')}) or coordinates.</li>`);
    $$('#palette-list li[data-i]').forEach(li => li.onclick = ev => {
      if (ev.target.closest('[data-pin]')) {
        const r = ev.target.closest('[data-pin]').dataset.pin;
        Y.pinned = Y.pinned.includes(r) ? Y.pinned.filter(p => p !== r) : Y.pinned.concat([r]);
        persist(); render(); return;
      }
      run(rows[+li.dataset.i]);
    });
    $$('#palette-scrim .scopebar button').forEach(b => b.setAttribute('aria-pressed', b.dataset.scope === P2.scope));
  }
  function run(it) {
    if (!it || !it.go) return;
    if (it.ref) { Y.recents = [it.ref].concat(Y.recents.filter(r => r !== it.ref)).slice(0, 12); persist(); }
    close(); it.go();
  }
  function open() {
    const sc = $('#palette-scrim');
    if (!$('#palette-scrim .scopebar')) {
      const bar = document.createElement('div');
      bar.className = 'scopebar';
      bar.innerHTML = `<button data-scope="">all</button>` + SCOPES.map(s => `<button data-scope="${s.p}">${s.p}:</button>`).join('');
      $('#palette-input').after(bar);
      $$('button', bar).forEach(b => b.onclick = () => { P2.scope = b.dataset.scope || null; compute(); render(); $('#palette-input').focus(); });
    }
    sc.classList.add('open');
    const i = $('#palette-input');
    i.placeholder = 'Search signals, objects, places, addresses or @coordinates';
    i.value = ''; P2.q = ''; P2.scope = null; P2.geo = [];
    compute(); render(); i.focus();
  }
  const close = () => $('#palette-scrim').classList.remove('open');
  window.HWP2 = { open, close };

  on('#palette-input', 'input', ev => { P2.q = ev.target.value; compute(); render(); });
  on('#palette-input', 'keydown', ev => {
    const sel = () => P2.items.concat(P2.geo).filter(i => !i.group);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const rows = P2.items.concat(P2.geo.length ? [{ group: 'g' }].concat(P2.geo) : []);
      let n = P2.idx;
      do { n += ev.key === 'ArrowDown' ? 1 : -1; } while (rows[n] && rows[n].group);
      if (rows[n]) { P2.idx = n; render(); const el = $(`#palette-list li[data-i="${n}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
    }
    if (ev.key === 'Enter') {
      const rows = P2.items.concat(P2.geo.length ? [{ group: 'g' }].concat(P2.geo) : []);
      run(rows[P2.idx] || sel()[0]);
    }
    if (ev.key === 'Tab') { ev.preventDefault(); const i = SCOPES.findIndex(s => s.p === P2.scope); P2.scope = SCOPES[(i + 1) % SCOPES.length].p; compute(); render(); }
  });

  /* ââââââââ 4 Â· saved views ââââââââ */
  function renderViews() {
    let host = $('#views-group');
    if (!host) {
      const pane = $('#view-map .pane .scroll');
      const g = document.createElement('div');
      g.className = 'group'; g.id = 'views-group';
      g.innerHTML = `<button class="grouphead" aria-expanded="true"><svg class="chev" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 3.5L5 6.5 8 3.5"/></svg>
        <h4>Views</h4><span class="count" id="views-c"></span></button><div id="views-list"></div>`;
      pane.insertBefore(g, pane.firstChild);
      g.querySelector('.grouphead').onclick = ev => {
        const b = ev.currentTarget, o = b.getAttribute('aria-expanded') === 'true';
        b.setAttribute('aria-expanded', !o); b.nextElementSibling.classList.toggle('hidden', o);
      };
      host = g;
    }
    const s = session(), views = s.views || (s.views = []);
    $('#views-c').textContent = views.length;
    $('#views-list').innerHTML = views.map(v => `<div class="viewrow" data-id="${v.id}">
      <svg><use href="#i-view"/></svg>
      <div><b>${esc(v.name)}</b><em>${v.win >= 720 ? '30d' : v.win >= 168 ? '7d' : v.win + 'h'} Â· ${v.domains.length} layers Â· ${v.proj}</em></div>
      <button class="x" title="Delete view">â</button></div>`).join('') +
      `<button class="btn ghost sm" id="view-save" style="margin:6px 9px"><svg><use href="#i-plus"/></svg> save current view</button>`;
    $$('#views-list .viewrow').forEach(r => r.onclick = ev => {
      if (ev.target.closest('.x')) { s.views = s.views.filter(v => v.id !== r.dataset.id); renderViews(); persist(); return; }
      applyView(r.dataset.id);
    });
    on('#view-save', 'click', () => {
      const v = { id: 'V' + Math.random().toString(36).slice(2, 6), name: 'View ' + (s.views.length + 1),
        win: S.win, sevFloor: S.sevFloor, domains: Array.from(S.domains), proj: S.proj, ctx: { ...S.ctx } };
      s.views.push(v); renderViews(); persist();
      const row = $(`#views-list .viewrow[data-id="${v.id}"] b`);
      if (row) {
        row.outerHTML = `<input class="input" id="view-rename" value="${esc(v.name)}" style="height:21px;font-size:12.5px">`;
        const f = $('#view-rename'); f.focus(); f.select();
        const done = keep => { if (keep && f.value.trim()) v.name = f.value.trim(); renderViews(); persist(); };
        f.onblur = () => done(true);
        f.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); };
        f.onclick = e => e.stopPropagation();
      }
    });
  }
  function applyView(id) {
    const s = session(), v = (s.views || []).find(z => z.id === id); if (!v) return;
    S.win = v.win; S.sevFloor = v.sevFloor; S.domains = new Set(v.domains); S.proj = v.proj;
    if (v.ctx) S.ctx = { ...v.ctx };
    $$('#win-seg button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.win === S.win));
    $$('#proj-seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.proj === S.proj));
    SH.renderLayers(); SH.fitView(S.proj, true); SH.drawMarkers(); SH.drawStrip();
    window.HWopen('map'); window.HWtoast('View Â· ' + v.name);
  }

  /* ââââââââ 5 Â· alert rules ââââââââ */
  const FIELDS = [
    { k: 'severity', name: 'Severity', ops: ['is at least', 'is'], vals: () => Object.keys(SEV).sort((a, b) => SEV[b].rank - SEV[a].rank) },
    { k: 'domain', name: 'Domain', ops: ['is', 'is not'], vals: () => Object.keys(DOM) },
    { k: 'region', name: 'Region', ops: ['is', 'is not'], vals: () => ['EMEA', 'APAC', 'AMER'] },
    { k: 'iso3', name: 'Country', ops: ['is'], vals: () => [...new Set(D.events.map(e => e.iso3))].sort() },
    { k: 'source', name: 'Source', ops: ['is', 'is not'], vals: () => D.SOURCES },
    { k: 'conf', name: 'Confidence', ops: ['is at least'], vals: () => ['0.6', '0.7', '0.8', '0.9'] }
  ];
  const SEED_RULES = () => [
    { id: 'R1', name: 'Critical maritime, any corridor', on: true, act: 'notify',
      clauses: [{ f: 'severity', op: 'is at least', v: 'critical' }, { f: 'domain', op: 'is', v: 'maritime' }] },
    { id: 'R2', name: 'High or above in EMEA', on: true, act: 'escalate',
      clauses: [{ f: 'severity', op: 'is at least', v: 'high' }, { f: 'region', op: 'is', v: 'EMEA' }] },
    { id: 'R3', name: 'Corroborated cyber reporting', on: false, act: 'brief',
      clauses: [{ f: 'domain', op: 'is', v: 'cyber' }, { f: 'conf', op: 'is at least', v: '0.75' }] }
  ];
  const AR = { sel: null };
  function ruleMatches(r, e) {
    return r.clauses.every(c => {
      if (c.f === 'severity') return c.op === 'is' ? e.severity === c.v : SEV[e.severity].rank >= SEV[c.v].rank;
      if (c.f === 'conf') return e.conf >= +c.v;
      const v = e[c.f];
      return c.op === 'is not' ? v !== c.v : v === c.v;
    });
  }
  const ruleText = r => r.clauses.map(c => {
    const f = FIELDS.find(z => z.k === c.f);
    const val = c.f === 'domain' ? DOM[c.v].name : c.f === 'severity' ? SEV[c.v].name : c.v;
    return `${f.name.toLowerCase()} ${c.op} <b>${esc(val)}</b>`;
  }).join(' and ');

  function openAlerts(entity) {
    if (!Y.rules.length) Y.rules = SEED_RULES();
    AR.sel = AR.sel || Y.rules[0].id;
    $('#alert-scrim').classList.add('open');
    if (entity) window.HWtoast('Rules apply globally Â· ' + entity.name + ' is covered by ' + Y.rules.filter(r => r.on).length + ' active rules');
    renderAlerts();
  }
  function renderAlerts() {
    $('#ar-count').textContent = Y.rules.filter(r => r.on).length + ' of ' + Y.rules.length + ' active';
    $('#ar-list').innerHTML = Y.rules.map(r => {
      const n = D.events.filter(e => ruleMatches(r, e)).length;
      return `<div class="arrow" data-id="${r.id}" aria-selected="${r.id === AR.sel}">
        <button class="switch" aria-pressed="${r.on}" data-tog="${r.id}"></button>
        <div><b>${esc(r.name)}</b><em>${n} signal${n === 1 ? '' : 's'} in the corpus match</em></div>
        <span class="tag ${r.act === 'escalate' ? 'red' : r.act === 'brief' ? 'blue' : ''}">${r.act}</span></div>`;
    }).join('');
    $$('#ar-list .arrow').forEach(row => row.onclick = ev => {
      const t = ev.target.closest('[data-tog]');
      if (t) { const r = Y.rules.find(z => z.id === t.dataset.tog); r.on = !r.on; renderAlerts(); persist(); return; }
      AR.sel = row.dataset.id; renderAlerts();
    });
    const r = Y.rules.find(z => z.id === AR.sel);
    if (!r) { $('#ar-edit').innerHTML = `<div class="empty"><svg><use href="#i-alert"/></svg><p>Select a rule, or create one.</p></div>`; return; }
    const matches = D.events.filter(e => ruleMatches(r, e));
    $('#ar-edit').innerHTML = `
      <div class="setsec" style="border:0">
        <div class="field"><label>Rule name</label><input class="input" id="ar-name" value="${esc(r.name)}"></div>
        <label class="lbl" style="display:block;margin:4px 0 6px">Conditions â all must hold</label>
        ${r.clauses.map((c, i) => `<div class="arclause">
          <span class="lbl">${i ? 'and' : 'when'}</span>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:5px">
            <select class="input" data-c="${i}" data-p="f">${FIELDS.map(f => `<option value="${f.k}" ${f.k === c.f ? 'selected' : ''}>${f.name}</option>`).join('')}</select>
            <select class="input" data-c="${i}" data-p="op">${(FIELDS.find(f => f.k === c.f) || FIELDS[0]).ops.map(o => `<option ${o === c.op ? 'selected' : ''}>${o}</option>`).join('')}</select>
            <select class="input" data-c="${i}" data-p="v">${(FIELDS.find(f => f.k === c.f) || FIELDS[0]).vals().map(v => `<option value="${v}" ${v === c.v ? 'selected' : ''}>${c.f === 'domain' ? DOM[v].name : c.f === 'severity' ? SEV[v].name : v}</option>`).join('')}</select>
            <button class="btn ghost sm" data-rm="${i}" title="Remove condition">â</button>
          </div></div>`).join('')}
        <button class="btn ghost sm" id="ar-addc"><svg><use href="#i-plus"/></svg> add condition</button>
        <div class="field" style="margin-top:11px"><label>Action</label>
          <div class="seg" style="width:100%">${['notify', 'escalate', 'brief'].map(a =>
            `<button data-act="${a}" aria-pressed="${r.act === a}" style="flex:1">${a}</button>`).join('')}</div></div>
      </div>
      <div class="arpreview">when ${ruleText(r)} â <b>${r.act}</b></div>
      <div class="setsec" style="border:0;padding-top:0">
        <label class="lbl" style="display:block;margin-bottom:6px">Matches in the current corpus â ${matches.length}</label>
        ${matches.slice(0, 8).map(e => `<div class="armatch"><i class="dia" style="background:${SEV[e.severity].color}"></i>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.title)}</span>
          <span class="mono dim" style="font-size:10.5px">${e.place}</span></div>`).join('') ||
          '<p class="dim" style="font-size:12px;margin:0">Nothing matches â the rule is too narrow to fire.</p>'}
      </div>`;
    $('#ar-hint').textContent = matches.length + ' would fire on the loaded corpus';
    on('#ar-name', 'input', ev => { r.name = ev.target.value; });
    $$('#ar-edit select[data-c]').forEach(sel => sel.onchange = () => {
      const c = r.clauses[+sel.dataset.c], p = sel.dataset.p;
      if (p === 'f') { c.f = sel.value; const f = FIELDS.find(z => z.k === c.f); c.op = f.ops[0]; c.v = f.vals()[0]; }
      else c[p] = sel.value;
      renderAlerts();
    });
    $$('#ar-edit [data-rm]').forEach(b => b.onclick = () => {
      if (r.clauses.length < 2) return window.HWtoast('A rule needs at least one condition', 'warn');
      r.clauses.splice(+b.dataset.rm, 1); renderAlerts();
    });
    on('#ar-addc', 'click', () => { r.clauses.push({ f: 'region', op: 'is', v: 'EMEA' }); renderAlerts(); });
    $$('#ar-edit [data-act]').forEach(b => b.onclick = () => { r.act = b.dataset.act; renderAlerts(); });
  }
  on('#ar-close', 'click', () => $('#alert-scrim').classList.remove('open'));
  on('#alert-scrim', 'click', ev => { if (ev.target.id === 'alert-scrim') $('#alert-scrim').classList.remove('open'); });
  on('#ar-new', 'click', () => {
    const r = { id: 'R' + (Y.rules.length + 1) + Math.random().toString(36).slice(2, 4), name: 'New rule', on: true, act: 'notify',
      clauses: [{ f: 'severity', op: 'is at least', v: 'high' }] };
    Y.rules.unshift(r); AR.sel = r.id; renderAlerts(); persist();
    setTimeout(() => { const f = $('#ar-name'); if (f) { f.focus(); f.select(); } }, 20);
  });
  on('#ar-save', 'click', () => { persist(); renderAlerts(); window.HWtoast('Alert rules saved', 'ok'); });
  window.HWalerts = { open: openAlerts, rules: () => Y.rules, matches: ruleMatches };

  /* ââââââââ 6 Â· exports ââââââââ */
  function download(name, mime, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function exportSignals() {
    const rows = SH.visible();
    const cols = ['id', 'ts', 'severity', 'domain', 'title', 'place', 'country', 'iso3', 'region', 'lat', 'lon', 'conf', 'source', 'status', 'impacts'];
    const csv = [cols.join(',')].concat(rows.map(e => cols.map(c =>
      csvCell(c === 'ts' ? e.ts.toISOString() : c === 'impacts' ? e.impacts.join('; ') : e[c])).join(','))).join('\n');
    download(`horizon-signals-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', csv);
    window.HWtoast(rows.length + ' signals exported as CSV', 'ok');
  }
  function exportGeoJSON() {
    const feats = [];
    (window.HWXaoi ? window.HWXaoi.list : []).forEach(a => feats.push({
      type: 'Feature',
      properties: { id: a.id, name: a.name, kind: 'observation-area', cls: a.cls, cadence: a.cadence,
        status: a.status, radiusKm: a.radiusKm, recurring: !!a.recurring, classes: (a.classes || []).join('; ') },
      geometry: a.pts ? { type: 'Polygon', coordinates: [a.pts.concat([a.pts[0]])] } : { type: 'Point', coordinates: [a.lon, a.lat] }
    }));
    (window.HWann || X.annotations).forEach(an => feats.push({
      type: 'Feature', properties: { id: an.id, name: an.label, kind: 'annotation', by: an.by, ts: an.ts, note: an.note },
      geometry: an.kind === 'point' ? { type: 'Point', coordinates: [an.lon, an.lat] }
        : an.kind === 'area' ? { type: 'Polygon', coordinates: [an.pts.concat([an.pts[0]])] }
        : { type: 'LineString', coordinates: an.pts }
    }));
    SH.visible().forEach(e => feats.push({
      type: 'Feature', properties: { id: e.id, kind: 'signal', title: e.title, severity: e.severity, domain: e.domain, ts: e.ts.toISOString() },
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] }
    }));
    download(`horizon-geometry-${new Date().toISOString().slice(0, 10)}.geojson`, 'application/geo+json',
      JSON.stringify({ type: 'FeatureCollection', features: feats }, null, 2));
    window.HWtoast(feats.length + ' features exported as GeoJSON', 'ok');
  }
  function exportOntology() {
    download(`horizon-ontology-${new Date().toISOString().slice(0, 10)}.json`, 'application/json',
      JSON.stringify({ nodes: X.nodes, links: X.links }, null, 2));
    window.HWtoast('Ontology exported as JSON', 'ok');
  }
  window.HWexport = { open() { openSettings('export'); } , signals: exportSignals, geo: exportGeoJSON, onto: exportOntology };
  window.HWdist = { open(doc) { openSettings('dist', doc); } };

  /* ââââââââ 7 Â· related records ââââââââ */
  const near = (a, b, km) => d3.geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371 < km;
  function relatedFor(e) {
    const out = [];
    const ents = D.entities.filter(x => near(x, e, 1400));
    const nodes = X.nodes.filter(n => e.place.includes(n.label.split(' ')[0]) || n.label.includes(e.country) ||
      Object.values(n.props).some(v => String(v).includes(e.iso3)));
    const scenes = X.scenes.filter(s => near(s, e, 900));
    const areas = (window.HWXaoi ? window.HWXaoi.list : []).filter(a => near(a, e, 900));
    const places = X.places.filter(p => near(p, e, 400));
    const tracks = X.vessels.concat(X.aircraft).filter(t => near(t, e, 600));
    const sigs = D.events.filter(o => o.id !== e.id && near(o, e, 800));
    if (sigs.length) out.push(['Signals Â· 800km', 'i-bell', sigs.slice(0, 6).map(o =>
      ({ n: o.title, k: o.id, go: () => { window.HWopen('map'); window.HWselect(o.id, { pan: true }); } }))]);
    if (ents.length) out.push(['Dossiers', 'i-dossier', ents.map(x => ({ n: x.name, k: x.code, go: () => window.HWM.openEntity(x.id) }))]);
    if (nodes.length) out.push(['Ontology objects', 'i-onto', nodes.slice(0, 5).map(n =>
      ({ n: n.label, k: X.NODE_TYPES[n.type].name, go: () => window.HWX.openOntology(n.id) }))]);
    if (scenes.length) out.push(['Imagery scenes', 'i-sat', scenes.map(s =>
      ({ n: s.place, k: s.id, go: () => { window.HWXaoi.I.scene = s.id; window.HWopen('imagery'); window.HWXaoi.renderList(); window.HWXaoi.renderScene(); } }))]);
    if (areas.length) out.push(['Observation areas', 'i-scan', areas.map(a =>
      ({ n: a.name, k: a.id, go: () => { window.HWXaoi.sel = a.id; window.HWopen('imagery'); window.HWXaoi.render(); window.HWXaoi.renderScene(); } }))]);
    if (places.length) out.push(['Infrastructure Â· 400km', 'i-anchor', places.map(p =>
      ({ n: p.name, k: p.code, go: () => flyToPlace(p.lon, p.lat, p.name, 6) }))]);
    if (tracks.length) out.push(['Live tracks Â· 600km', 'i-ship', tracks.slice(0, 6).map(t =>
      ({ n: t.name || t.callsign, k: t.sanctioned ? 'sanctioned' : (t.mmsi ? 'AIS' : 'ADS-B'), go: () => flyToPlace(t.lon, t.lat, t.name || t.callsign, 6) }))]);
    const rules = Y.rules.filter(r => r.on && ruleMatches(r, e));
    if (rules.length) out.push(['Alert rules fired', 'i-alert', rules.map(r => ({ n: r.name, k: r.act, go: () => openAlerts() }))]);
    return out;
  }
  window.HWrelated = {
    inject(box, e) {
      if (!box || !e) return;
      const groups = relatedFor(e);
      const total = groups.reduce((a, g) => a + g[2].length, 0);
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `<span class="lbl" style="display:flex;align-items:center;gap:7px">
          <svg style="width:12px;height:12px;color:var(--txt-3)"><use href="#i-relate"/></svg>Related records
          <span style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--txt-4)">${total}</span></span>
        ${groups.map(([name, icon, rows]) => `<div class="relgroup" style="border:0;padding:4px 0">
          <span class="lbl"><svg style="width:11px;height:11px"><use href="#${icon}"/></svg>${name}<span>${rows.length}</span></span>
          ${rows.map((r, i) => `<div class="relrow" data-g="${esc(name)}" data-i="${i}">
            <svg class="g"><use href="#${icon}"/></svg><span class="n">${esc(r.n)}</span><span class="k">${esc(r.k)}</span></div>`).join('')}
        </div>`).join('') || '<p class="dim" style="font-size:12px;margin:0">No linked records.</p>'}`;
      const anchor = box.querySelector('.btnrow');
      anchor ? anchor.before(el) : box.querySelector('.detail')?.append(el);
      $$('.relrow', el).forEach(r => r.onclick = () => {
        const g = groups.find(z => z[0] === r.dataset.g); if (g) g[2][+r.dataset.i].go();
      });
    },
    for: relatedFor
  };

  /* ââââââââ 8 Â· global time cursor ââââââââ */
  function renderTimeCursor() {
    let bar = $('#timecursor');
    if (!bar) {
      const strip = $('.timestrip');
      bar = document.createElement('div');
      bar.className = 'timecursor'; bar.id = 'timecursor';
      bar.innerHTML = `<button class="tcbtn" id="tc-live" aria-pressed="true" title="Follow live"><svg><use href="#i-clock"/></svg></button>
        <span class="tc" id="tc-read">live</span>
        <input type="range" id="tc-range" min="0" max="1000" value="1000">
        <button class="tcbtn" id="tc-play" title="Sweep the window"><svg><use href="#i-play"/></svg></button>
        <span class="live" id="tc-count"></span>`;
      strip.appendChild(bar);
      on('#tc-range', 'input', ev => setCut(+ev.target.value / 1000));
      on('#tc-live', 'click', () => { $('#tc-range').value = 1000; setCut(1); });
      on('#tc-play', 'click', () => sweep());
    }
    updateCursorRead();
  }
  function setCut(t) {
    const now = Date.now(), t0 = now - S.win * 3600e3;
    S.tCut = t >= 1 ? null : t0 + t * (now - t0);
    $('#tc-live').setAttribute('aria-pressed', S.tCut == null);
    SH.drawMarkers(); SH.drawStrip(); SH.renderInspector();
    updateCursorRead();
  }
  function updateCursorRead() {
    const r = $('#tc-read'); if (!r) return;
    r.textContent = S.tCut ? zulu(new Date(S.tCut)) : 'live';
    r.style.color = S.tCut ? 'var(--amber)' : 'var(--txt-2)';
    $('#tc-count').textContent = SH.visible().length + ' shown';
  }
  let sweepTimer = null;
  function sweep() {
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; $('#tc-play').innerHTML = '<svg><use href="#i-play"/></svg>'; return; }
    $('#tc-play').innerHTML = '<svg><use href="#i-pause"/></svg>';
    let t = 0;
    sweepTimer = setInterval(() => {
      t += .012;
      if (t >= 1) { t = 1; clearInterval(sweepTimer); sweepTimer = null; $('#tc-play').innerHTML = '<svg><use href="#i-play"/></svg>'; }
      $('#tc-range').value = Math.round(t * 1000); setCut(t);
    }, 60);
  }

  /* ââââââââ 9 Â· marker clustering ââââââââ */
  window.HWmapHooks.push({ draw: (proj, path, k) => {
    const g = M.layer('clusters');
    const active = Y.settings.clustering && k < Y.settings.clusterAt;
    M.root.selectAll('.marker').style('opacity', active ? 0 : null).style('pointer-events', active ? 'none' : null);
    if (!active) { g.selectAll('*').remove(); return; }
    const evs = SH.visible(), cell = 46, bins = new Map();
    evs.forEach(e => {
      const p = proj([e.lon, e.lat]); if (!p) return;
      const key = Math.round(p[0] / cell) + ':' + Math.round(p[1] / cell);
      if (!bins.has(key)) bins.set(key, { x: 0, y: 0, n: 0, items: [], worst: 'low' });
      const b = bins.get(key);
      b.x += p[0]; b.y += p[1]; b.n++; b.items.push(e);
      if (SEV[e.severity].rank > SEV[b.worst].rank) b.worst = e.severity;
    });
    const data = [...bins.values()].map(b => ({ ...b, x: b.x / b.n, y: b.y / b.n }));
    const sel = g.selectAll('g.cluster').data(data, d => d.items[0].id);
    sel.exit().remove();
    const en = sel.enter().append('g').attr('class', 'cluster');
    en.append('circle'); en.append('text');
    en.merge(sel)
      .attr('transform', d => `translate(${d.x},${d.y}) scale(${1 / k})`)
      .on('mousemove', (ev, d) => M.tip(ev, `<b>${d.n} signals</b><span class="lbl">worst: ${SEV[d.worst].name}<br>${d.items.slice(0, 3).map(i => esc(i.place)).join(' Â· ')}</span>`))
      .on('mouseleave', M.tipHide)
      .on('click', (ev, d) => { ev.stopPropagation(); M.flyTo(d3.mean(d.items, i => i.lon), d3.mean(d.items, i => i.lat), Math.max(Y.settings.clusterAt + 1, 3), 520); })
      .select('circle').attr('r', d => 9 + Math.min(11, d.n * 1.6))
      .attr('stroke', d => SEV[d.worst].color);
    g.selectAll('g.cluster').select('text').attr('y', 3).text(d => d.n);
  } });

  /* ââââââââ 10 Â· scan history ââââââââ */
  function historyFor(a) {
    if (!a) return [];
    if (a.history) return a.history;
    const own = X.scenes.filter(s => s.aoi === a.id || s.place === a.name);
    const base = own.length ? own : (a.scene ? X.scenes.filter(s => s.id === a.scene) : []);
    const seed = (a.id.charCodeAt(4) || 7) + a.radiusKm;
    a.history = base.concat(d3.range(4).map(i => {
      const d = new Date(Date.now() - (i + 1) * 26 * 864e5);
      return { id: 'SCN-' + (4300 + Math.round(seed) + i * 7), dateB: d.toISOString().slice(0, 10),
        sensor: i % 2 ? 'SAR Â· 20m' : 'EO Â· 10m', synthetic: true,
        changes: d3.range(Math.max(0, 3 - (i % 3))).map(() => ({})) };
    }));
    return a.history;
  }
  window.HWhistory = {
    inject(host, a) {
      if (!host || !a) return;
      const hist = historyFor(a);
      const max = Math.max(1, d3.max(hist, h => h.changes.length));
      const el = document.createElement('div');
      el.className = 'sect'; el.style.cssText = 'padding:11px 12px';
      el.innerHTML = `<span class="lbl" style="display:flex;align-items:center;gap:7px;margin-bottom:7px;font-weight:600;color:var(--txt-2)">
          <svg style="width:12px;height:12px;color:var(--txt-3)"><use href="#i-history"/></svg>Scan history
          <span style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--txt-4)">${hist.length} passes</span></span>
        <div class="sparkbar">${hist.slice().reverse().map(h =>
          `<i class="${h.changes.length >= max ? 'hot' : ''}" style="height:${Math.max(8, h.changes.length / max * 100)}%" title="${h.dateB} Â· ${h.changes.length} findings"></i>`).join('')}</div>
        ${hist.map(h => `<div class="histrow" data-id="${h.id}" aria-selected="${h.id === window.HWXaoi.I.scene}">
          <svg style="width:11px;height:11px;color:var(--txt-4)"><use href="#i-sat"/></svg>
          <span class="n">${h.dateB}${h.synthetic ? '' : ' Â· current'}</span>
          <span class="d">${h.sensor}</span>
          <span class="f" style="color:${h.changes.length > 2 ? '#b0645c' : 'var(--txt-3)'}">${h.changes.length}</span></div>`).join('')}
        <p class="dim" style="font-size:11px;margin:7px 0 0;line-height:1.45">Each pass compares the newest scene to the stored reference. Bars show findings per pass.</p>`;
      host.appendChild(el);
      $$('.histrow', el).forEach(r => r.onclick = () => {
        const h = hist.find(z => z.id === r.dataset.id);
        if (h.synthetic) return window.HWtoast(h.id + ' is archived â imagery not cached locally', 'warn');
        window.HWXaoi.I.scene = h.id; window.HWXaoi.renderScene();
      });
    }
  };

  /* ââââââââ 11 Â· link-analysis appendix ââââââââ */
  window.HWappendix = {
    page(d) {
      const sigs = d.sel.slice(0, 10);
      const objs = X.nodes.filter(n => sigs.some(e => e.place.includes(n.label.split(' ')[0]) || n.label.includes(e.country)));
      const seen = new Set(objs.map(o => o.id));
      const links = X.links.filter(l => seen.has(l.s) && seen.has(l.t));
      const inferred = links.filter(l => l.inferred);
      const nm = id => (X.nodes.find(n => n.id === id) || {}).label || id;
      return `<section class="docpage" id="pg4"><div class="stamp">${d.meta.cls}</div>
        <h2>Appendix A â link analysis</h2>
        <p>Objects and relationships in the ontology that bear on this evidence set. Asserted
        relationships are supported by a document or a record; inferred relationships are
        pattern matches carried below full confidence and should not be treated as established.</p>
        <table><thead><tr><th style="width:52px">Ref</th><th>Object</th><th style="width:118px">Type</th><th style="width:52px">Risk</th><th>Standing note</th></tr></thead>
        <tbody>${objs.slice(0, 12).map(o => `<tr><td class="mono">${o.id}</td><td>${esc(o.label)}</td>
          <td>${X.NODE_TYPES[o.type].name}</td><td class="mono">${o.risk}</td>
          <td>${esc(Object.entries(o.props).slice(0, 2).map(([k, v]) => k + ': ' + v).join(' Â· '))}</td></tr>`).join('')
          || '<tr><td colspan="5">No ontology objects intersect this evidence set.</td></tr>'}</tbody></table>
        <h3>Relationships</h3>
        <table><thead><tr><th>From</th><th style="width:118px">Relationship</th><th>To</th><th style="width:66px">Conf.</th><th style="width:70px">Basis</th></tr></thead>
        <tbody>${links.slice(0, 14).map(l => `<tr><td>${esc(nm(l.s))}</td><td>${l.kind}</td><td>${esc(nm(l.t))}</td>
          <td class="mono">${Math.round(l.conf * 100)}%</td><td>${l.inferred ? 'inferred' : 'asserted'}</td></tr>`).join('')
          || '<tr><td colspan="5">No relationships between the objects above.</td></tr>'}</tbody></table>
        <div class="callout"><b>Method note.</b> ${links.length} relationships, ${inferred.length} of them inferred.
        Inferred links are generated from co-occurrence, shared registry data and overlapping dark-AIS windows;
        they are review candidates, not conclusions. Confidence below 80% is reported as inferred by convention.</div>
        <div class="pno"><span>${d.meta.cls}</span><span>${d.meta.id}</span><span>PAGE 4</span></div></section>`;
    }
  };

  /* ââââââââ 12 Â· settings, tutorial, shortcuts ââââââââ */
  const SET_TABS = [
    ['general', 'General', 'i-gear'], ['tutorial', 'Tutorial', 'i-book'], ['keys', 'Shortcuts', 'i-keyboard'],
    ['sessions', 'Sessions & views', 'i-session'], ['alerts', 'Alert rules', 'i-alert'],
    ['export', 'Export', 'i-export'], ['dist', 'Distribution', 'i-link'],
    ['workspace', 'Mail & calendar', 'i-mail'], ['users', 'Users & roles', 'i-team'],
    ['sources', 'Data sources', 'i-sat'],
    ['about', 'About', 'i-globe']
  ];
  const SETST = { tab: 'general', doc: null };
  function openSettings(tab, doc) {
    SETST.tab = tab || 'general'; SETST.doc = doc || null;
    $('#set-scrim').classList.add('open'); renderSettings();
  }
  const closeSettings = () => $('#set-scrim').classList.remove('open');
  on('#set-close', 'click', closeSettings);
  on('#set-scrim', 'click', ev => { if (ev.target.id === 'set-scrim') closeSettings(); });
  on('#btn-settings', 'click', () => openSettings('general'));
  window.HWsettings = { open: openSettings, close: closeSettings, rerender: renderSettings,
    isOpen: () => $('#set-scrim').classList.contains('open') };
  on('#set-reset', 'click', () => {
    Y.settings = { ...DEFAULT_SETTINGS }; persist(); renderSettings(); SH.drawMarkers();
    window.HWtoast('Settings reset to defaults', 'ok');
  });

  const KEYS = [
    ['Global', [['âK / Ctrl+K', 'Open the command palette'], ['1 â 9', 'Switch module'],
      ['Tab', 'Cycle palette scope (in the palette)'], ['Esc', 'Close palette, dialog or field'],
      ['F', 'Toggle full screen'], ['?', 'Open shortcuts'], ['âP', 'Print the loaded briefing'],
      ['W', 'Toggle Watch / Workstation mode'], ['G', 'Go to My work']]],
    ['Workstation', [['@', 'Mention someone in a comment'], ['ââµ', 'Send a comment'],
      ['Click your avatar', 'Switch or create a user'], ['Click a record reference', 'Open it in its own module']]],
    ['Palette prefixes', [['sig:', 'Signals only'], ['ent:', 'Dossier entities'], ['obj:', 'Ontology objects'],
      ['loc:', 'Places and infrastructure'], ['aoi:', 'Observation areas'], ['scn:', 'Imagery scenes'],
      ['trk:', 'Vessels and aircraft'], ['brf:', 'Briefings'], ['@26.5, 56.2', 'Fly to coordinates (decimal or DMS)']]],
    ['Situation map', [['Drag', 'Pan'], ['Scroll / + â', 'Zoom'], ['Double-click a track', 'Open its inspector'],
      ['Double-click while drawing', 'Finish a route, area or scan polygon'], ['Esc', 'Cancel the current drawing']]],
    ['Signal inbox', [['j / k', 'Next / previous signal'], ['Click a header', 'Sort; click again to reverse']]],
    ['Ontology', [['Drag a node', 'Reposition permanently'], ['Double-click a node', 'Expand its neighbourhood'],
      ['Click a link', 'Open the relationship editor']]]
  ];

  const TUTORIAL = [
    ['Pick a session', 'A session is a whole desk: its own time window, layers, severity floor, projection, map position, record tabs and briefing basket. Switch between <b>Global watch</b>, <b>Red Sea corridor</b>, <b>Baltic &amp; Nordics</b> and <b>Indo-Pacific</b> from the control at the left of the tab strip, or create one from whatever you are looking at now.', 'map'],
    ['Read the situation', 'The map carries every signal in the current window as a severity diamond, plus live AIS and ADS-B tracks, ports and airports, trade corridors and your saved scan zones. Narrow it with the layer panel on the left; the counts in the panel, the legend and the header always agree because they come from one filter.', 'map'],
    ['Rewind in place', 'The bar under the density strip is a time cursor. Drag it and the map shows only what had arrived by that moment; press the sweep button to watch the window fill. It returns to live in one click.', 'map'],
    ['Work the inbox to zero', 'Every signal starts unreviewed. Opening one acknowledges it â reading <em>is</em> triage. Use <kbd>j</kbd> and <kbd>k</kbd> to move, escalate what matters, and add anything worth reporting to the briefing basket.', 'inbox'],
    ['Follow the exposure', 'Dossiers hold the standing picture for a corridor, country or facility: an exposure index, what you have on the ground, the weighted drivers, and every signal inside the ring. The <b>Related records</b> card on any signal jumps between all of it.', 'dossier'],
    ['Draw a scan area', 'Pick the scan box or scan polygon in the map toolbar and draw over anything you care about. Configure the sensor, detection classes and confidence floor, then run it once, or save it for recurring passes â it becomes an observation area with its own scan history.', 'map'],
    ['Read the change', 'The imagery module compares the newest scene against the stored reference. Use split, swipe or fade-under to see what moved; findings are written as interpretations ("increased port activity", "new hardened revetments"), and you confirm or reject each one as model feedback.', 'imagery'],
    ['Trace the network', 'The ontology is a fixed diagram in four tiers â geography, actors, assets, observations. Objects and relationships are editable, inferred links are dashed, and everything is searchable from the palette, including by property (an MMSI finds its hull).', 'ontology'],
    ['Generate the briefing', 'Select an evidence set, set scope, audience and horizon, and run. You get an interactive briefing where every claim links to its record and drives a context map, plus a printable document with a link-analysis appendix.', 'generate'],
    ['Switch to Workstation', 'The mode control at the left of the tab strip has two settings. <b>Watch</b> is the analysis surface: map, inbox, dossiers, analytics, imagery, ontology, briefings. <b>Workstation</b> is where the work is coordinated: your queues, the intel mailbox, cases and the team. Sessions carry across both, and <kbd>W</kbd> toggles between them.', 'work'],
    ['Work from your queues', 'My work is the answer to "what do I do today": assigned to me, mentions, RFIs awaiting my answer, my cases, briefings awaiting my review, urgent mail, unreviewed signals. The right column carries the day â calendar, due dates, scheduled scans and recent team activity.', 'work'],
    ['Read the intel mailbox', 'Most corporate intelligence arrives as email. Inbound rules turn a partner bulletin into a signal, extract attachments and route scene deliveries to the imagery module. Anything that matches no rule waits for you to raise it by hand. Outbound is the same mailbox: alerts, digests and briefing distribution with delivery receipts.', 'mail'],
    ['Bundle work into a case', 'A case gathers signals, dossiers, ontology objects, scenes, areas and mail under one owner with a status, a due date, a discussion and a timeline. It generates the briefing directly, and carries the approval chain from draft to issued.', 'cases'],
    ['Work with the team', 'Comment on any record and type @ to bring someone in. Assign work with a due date. Raise an RFI and it is tracked to closure on the case timeline. Presence shows who else has a record open, so two analysts never work the same signal twice.', 'team'],
    ['Hand over the shift', 'The handover is generated from what actually changed during your shift: what you acknowledged, escalated and briefed, what you left open, and what the incoming analyst should watch for. Add a note and it goes out in-console and by mail.', 'team'],
    ['Set your alerts', 'Alert rules are conditions over incoming signals â severity, domain, region, country, source, confidence â with an action. The editor shows how many signals in the loaded corpus would fire before you save.', null]
  ];

  function renderSettings() {
    $('#set-nav').innerHTML = SET_TABS.map(([k, n, ic]) =>
      `<button class="setnav" data-t="${k}" aria-selected="${k === SETST.tab}"><svg><use href="#${ic}"/></svg>${n}</button>`).join('');
    $$('#set-nav .setnav').forEach(b => b.onclick = () => { SETST.tab = b.dataset.t; renderSettings(); });
    const body = $('#set-body');
    const T = SETST.tab;

    if (T === 'general') {
      const row = (n, sub, ctl) => `<div class="setrow"><div class="n">${n}<em>${sub}</em></div><div>${ctl}</div></div>`;
      body.innerHTML = `<div class="setsec"><h4>Display</h4>
        ${row('Cluster markers at low zoom', 'Groups nearby signals into one bubble below the threshold',
          `<button class="switch" aria-pressed="${Y.settings.clustering}" data-set="clustering"></button>`)}
        ${row('Cluster threshold', 'Zoom level below which clustering applies',
          `<input type="range" min="1" max="6" step="0.5" value="${Y.settings.clusterAt}" data-set="clusterAt" style="width:140px">
           <span class="mono dim" style="font-size:10.5px;margin-left:7px">${Y.settings.clusterAt}Ã</span>`)}
        ${row('Marker labels', 'Show place names beside signal markers',
          `<button class="switch" aria-pressed="${S.ctx.labels}" data-set="labels"></button>`)}
      </div>
      <div class="setsec"><h4>Search</h4>
        ${row('Live address lookup', 'Resolves any address through OpenStreetMap Nominatim; the bundled gazetteer is used either way',
          `<button class="switch" aria-pressed="${Y.settings.geocode}" data-set="geocode"></button>`)}
        <p class="dim" style="font-size:11.5px;margin:8px 0 0">Offline gazetteer: ${gazetteer().length} places â infrastructure, reported locations, imagery scenes and chokepoints.</p>
      </div>
      <div class="setsec" style="border:0"><h4>Workflow</h4>
        ${row('Opening a signal acknowledges it', 'Triage as a side effect of attention',
          `<button class="switch" aria-pressed="${Y.settings.autoAck}" data-set="autoAck"></button>`)}
        ${row('Confirm before deleting', 'Applies to annotations, areas, rules and ontology objects',
          `<button class="switch" aria-pressed="${Y.settings.confirmDelete}" data-set="confirmDelete"></button>`)}
        ${row('Show tips in empty panes', 'Explains what would appear and how to fill it',
          `<button class="switch" aria-pressed="${Y.settings.tips}" data-set="tips"></button>`)}
      </div>`;
      $$('#set-body [data-set]').forEach(el => {
        if (el.tagName === 'BUTTON') el.onclick = () => {
          const k = el.dataset.set;
          if (k === 'labels') { S.ctx.labels = !S.ctx.labels; SH.renderLayers(); SH.drawMarkers(); }
          else Y.settings[k] = !Y.settings[k];
          persist(); renderSettings(); SH.drawMarkers();
        };
        else el.oninput = () => { Y.settings[el.dataset.set] = +el.value; persist(); renderSettings(); SH.drawMarkers(); };
      });
    }

    else if (T === 'tutorial') {
      body.innerHTML = `<div class="setsec"><h4>How the console works</h4>
        <p>Ten modules, one corpus. Anything you find in one module can be opened in every other â
        that continuity is the point of the tool. Work top to bottom the first time.</p>
        <ol class="steps-doc">${TUTORIAL.map(([t, d, mod]) => `<li><div><b>${t}.</b> ${d}
          ${mod ? `<button class="btn ghost sm go" data-go="${mod}">open ${mod === 'map' ? 'Situation' : mod} â</button>` : ''}</div></li>`).join('')}</ol>
      </div>
      <div class="setsec" style="border:0"><h4>Reading the interface</h4>
        <p>A rotated square is always severity, and it is always paired with the word â critical, high,
        moderate, low. Colour is reserved for state: severity, whether a figure is worsening or improving,
        and selection. Domains, sources and regions carry no colour at all, so nothing competes with a
        genuine warning. Gold means an analyst drew it; blue means a tasking instruction.</p>
        <p class="dim" style="font-size:11.5px">The status bar states the corpus is sample data.
        One capability â satellite tasking â is deliberately unavailable rather than faked.</p>
      </div>`;
      $$('#set-body [data-go]').forEach(b => b.onclick = () => { closeSettings(); window.HWopen(b.dataset.go); });
    }

    else if (T === 'keys') {
      body.innerHTML = KEYS.map(([sec, rows]) => `<div class="setsec"><h4>${sec}</h4>
        <table class="keytable"><thead><tr><th>Key</th><th>Action</th></tr></thead><tbody>
        ${rows.map(([k, a]) => `<tr><td class="k">${k.split(' / ').map(x => `<kbd>${esc(x)}</kbd>`).join(' ')}</td><td>${a}</td></tr>`).join('')}
        </tbody></table></div>`).join('');
    }

    else if (T === 'sessions') {
      body.innerHTML = `<div class="setsec"><h4>Sessions</h4>
        <p>A session is a whole desk. It stores its time window, visible layers, severity floor,
        projection, map position, record tabs and briefing basket, so switching between a Red Sea
        watch and an Indo-Pacific watch restores two genuinely different working states.</p>
        ${Y.sessions.map(s => `<div class="setrow"><div class="n">${esc(s.name)}
          <em>${s.win >= 720 ? '30d' : s.win >= 168 ? '7d' : s.win + 'h'} window Â· ${s.domains.length} layers Â· ${s.proj} Â· ${(s.views || []).length} views Â· ${(s.tabs || []).length} tabs</em></div>
          <button class="btn sm" data-ses="${s.id}">${s.id === Y.active ? 'active' : 'switch'}</button></div>`).join('')}
      </div>
      <div class="setsec" style="border:0"><h4>Views</h4>
        <p>A view is a named filter preset inside a session â window, layers, severity floor and
        projection. Sessions are where you work; views are how you look. Save them from the
        <b>Views</b> group at the top of the Situation layer panel.</p>
        ${(session().views || []).map(v => `<div class="setrow"><div class="n">${esc(v.name)}
          <em>${v.win}h Â· ${v.domains.length} layers Â· ${v.proj}</em></div>
          <button class="btn sm" data-view="${v.id}">apply</button></div>`).join('') ||
          '<p class="dim" style="font-size:12px">No views saved in this session.</p>'}
      </div>`;
      $$('#set-body [data-ses]').forEach(b => b.onclick = () => { captureSession(); applySession(b.dataset.ses); closeSettings(); });
      $$('#set-body [data-view]').forEach(b => b.onclick = () => { applyView(b.dataset.view); closeSettings(); });
    }

    else if (T === 'alerts') {
      if (!Y.rules.length) Y.rules = SEED_RULES();
      body.innerHTML = `<div class="setsec" style="border:0"><h4>Alert rules</h4>
        <p>Conditions evaluated against every incoming signal. ${Y.rules.filter(r => r.on).length} of
        ${Y.rules.length} rules are active.</p>
        ${Y.rules.map(r => `<div class="setrow"><div class="n">${esc(r.name)}
          <em>when ${ruleText(r).replace(/<\/?b>/g, '')} â ${r.act}</em></div>
          <span class="tag ${r.on ? 'green' : ''}">${r.on ? 'active' : 'off'}</span></div>`).join('')}
        <button class="btn sm primary" id="set-openalerts" style="margin-top:11px"><svg><use href="#i-alert"/></svg> open the rule editor</button>
      </div>`;
      on('#set-openalerts', 'click', () => { closeSettings(); openAlerts(); });
    }

    else if (T === 'export') {
      const n = SH.visible().length;
      body.innerHTML = `<div class="setsec"><h4>Export</h4>
        <p>Exports reflect the current session's filters, not the whole corpus.</p>
        <div class="setrow"><div class="n">Signals â CSV<em>${n} rows in the current filter, with coordinates, confidence and touched dependencies</em></div>
          <button class="btn sm primary" id="ex-csv"><svg><use href="#i-export"/></svg> download</button></div>
        <div class="setrow"><div class="n">Geometry â GeoJSON<em>Observation areas, annotations and signal points, ready for QGIS or a web map</em></div>
          <button class="btn sm" id="ex-geo"><svg><use href="#i-export"/></svg> download</button></div>
        <div class="setrow"><div class="n">Ontology â JSON<em>${X.nodes.length} objects and ${X.links.length} relationships with confidence and basis</em></div>
          <button class="btn sm" id="ex-onto"><svg><use href="#i-export"/></svg> download</button></div>
      </div>
      <div class="setsec" style="border:0"><h4>Briefings</h4>
        <p>A briefing exports as PDF through the print layout, which is already paginated to Letter with no
        application chrome. Open a briefing, then <b>printable briefing â print / pdf</b>.</p>
      </div>`;
      on('#ex-csv', 'click', exportSignals); on('#ex-geo', 'click', exportGeoJSON); on('#ex-onto', 'click', exportOntology);
    }

    else if (T === 'dist') {
      if (window.HWgmail) {
        body.innerHTML = window.HWgmail.bookHTML();
        window.HWgmail.wireBook(renderSettings);
        return;
      }
      const d = SETST.doc;
      const LIST = [['Executive committee', 6], ['Regional security leads', 4], ['Operations and logistics', 3], ['Board risk committee', 5]];
      body.innerHTML = `<div class="setsec"><h4>Distribution</h4>
        <p>${d ? `Distributing <b>${esc(d.meta.id)} Â· ${esc(d.meta.title)}</b>, classified ${d.meta.cls}.`
          : 'No briefing is loaded. Open one in the Briefings module first.'}</p>
        ${LIST.map(([n, c], i) => `<div class="setrow"><div class="n">${n}<em>${c} recipients</em></div>
          <label class="check" style="padding:0"><input type="checkbox" data-dl="${i}" ${i === 0 ? 'checked' : ''}><span></span></label></div>`).join('')}
      </div>
      <div class="setsec" style="border:0"><h4>Delivery</h4>
        <div class="field"><label>Method</label><select class="input" id="dl-method"><option>Secure link, expires in 7 days</option><option>Attached PDF</option><option>In-console notification only</option></select></div>
        <div class="field"><label>Note to recipients</label><textarea class="input" rows="2" id="dl-note" placeholder="Optional covering noteâ¦"></textarea></div>
        <button class="btn sm primary" id="dl-send" ${d ? '' : 'disabled'}><svg><use href="#i-link"/></svg> distribute</button>
      </div>`;
      on('#dl-send', 'click', () => {
        const n = $$('#set-body [data-dl]:checked').length;
        const total = $$('#set-body [data-dl]:checked').reduce((a, c) => a + LIST[+c.dataset.dl][1], 0);
        if (!n) return window.HWtoast('Select at least one distribution list', 'warn');
        closeSettings();
        window.HWtoast(`${d.meta.id} distributed Â· ${n} list${n > 1 ? 's' : ''} Â· ${total} recipients`, 'ok');
      });
    }

    else if (T === 'sources') {
      const FEEDS = [['OSINT-WIRE', 'Aggregated open reporting', 'connected', '4 min'],
        ['PARTNER-FEED', 'Contracted intelligence partner', 'connected', '11 min'],
        ['AIS-TRACK', 'Terrestrial and satellite AIS', 'connected', '48 s'],
        ['GDELT-XR', 'Event stream, cross-referenced', 'connected', '9 min'],
        ['FIELD-REP', 'Regional security reporting', 'connected', '2 h'],
        ['GOV-ADVISORY', 'Government travel and sanctions advisories', 'connected', '37 min'],
        ['SAT-TASK', 'Copernicus Sentinel-1 / Sentinel-2 archive', 'connected', '6 h'],
        ['COMMERCIAL-EO', 'Sub-metre optical, on tasking', 'unavailable', 'â']];
      body.innerHTML = `<div class="setsec"><h4>Feeds</h4>
        <p>Seven of eight sources are connected. Commercial sub-metre tasking is not enabled on this
        deployment, which is why the satellite tasking layer is unavailable rather than empty.</p>
        <table class="keytable"><thead><tr><th>Source</th><th>What it carries</th><th style="width:96px">State</th><th style="width:74px">Last</th></tr></thead>
        <tbody>${FEEDS.map(([c, d2, st, last]) => `<tr><td class="k mono" style="font-size:11.5px">${c}</td><td>${d2}</td>
          <td><span class="tag ${st === 'connected' ? 'green' : ''}">${st}</span></td><td class="mono" style="font-size:11px">${last}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="setsec" style="border:0"><h4>Detection models</h4>
        <table class="keytable"><thead><tr><th>Model</th><th>Applied to</th><th style="width:110px">Classes</th></tr></thead><tbody>
        <tr><td class="k">hw-changedet v3</td><td>Siamese change detection on co-registered pairs</td><td class="mono" style="font-size:11px">3 change types</td></tr>
        <tr><td class="k">hw-objdet v5</td><td>Object recognition on the current scene</td><td class="mono" style="font-size:11px">${X.DETECT_CLASSES.length} classes</td></tr>
        <tr><td class="k">hw-sar-delta v2</td><td>Amplitude differencing for all-weather passes</td><td class="mono" style="font-size:11px">9 classes</td></tr>
        </tbody></table>
        <p class="dim" style="font-size:11.5px;margin-top:9px">Confirming or rejecting a detection is recorded as model feedback and updates the area's reference counts.</p>
      </div>`;
    }

    else if (T === 'workspace') {
      const W3 = window.HW3;
      if (window.HWgmail) {
        body.innerHTML = window.HWgmail.connectorHTML();
        window.HWgmail.wireConnector(renderSettings);
        return;
      }
      body.innerHTML = `<div class="setsec"><h4>Google Workspace</h4>
        <p>The intel mailbox and the team calendar are read through the Google Workspace APIs on a
        service account with domain-wide delegation. Mail is polled every 60 seconds; calendar events
        are written when a scan is scheduled or an RFI falls due.</p>
        <div class="setrow"><div class="n">Account<em>${esc(W3.mailbox.account)}</em></div>
          <span class="tag green">connected</span></div>
        <div class="setrow"><div class="n">Scopes granted<em>${W3.mailbox.scopes.join(' Â· ')}</em></div>
          <span class="lbl mono">${W3.mailbox.scopes.length}</span></div>
        <div class="setrow"><div class="n">Last sync<em>Inbound ${W3.mailbox.inboundToday} today, outbound ${W3.mailbox.outboundToday}</em></div>
          <span class="lbl mono">${esc(W3.mailbox.lastSync)}</span></div>
        <div class="setrow"><div class="n">Send quota<em>Resets at midnight UTC</em></div>
          <span class="lbl mono">${esc(W3.mailbox.quota)}</span></div>
        <button class="btn sm" id="ws-reauth" style="margin-top:11px">re-authorise</button>
      </div>
      <div class="setsec"><h4>Inbound rules</h4>
        <p>${W3.parseRules.filter(r => r.on).length} of ${W3.parseRules.length} rules active.
        A message that matches no rule stays in the inbox for an analyst rather than being discarded.</p>
        ${W3.parseRules.map(r => `<div class="setrow"><div class="n">${esc(r.name)}<em>${esc(r.match)} â ${esc(r.sets)}</em></div>
          <span class="lbl mono">${r.hits}</span></div>`).join('')}
        <button class="btn sm" id="ws-mail" style="margin-top:11px"><svg><use href="#i-mail"/></svg> open the mailbox</button>
      </div>
      <div class="setsec" style="border:0"><h4>Automatic mail</h4>
        <p>Digests are assembled per recipient in their own timezone, so an 0600 digest reaches Lisbon and
        Singapore at 0600 local. Alerts are throttled per rule so a fast-moving event does not become a storm.</p>
        ${W3.outbound.map(o => `<div class="setrow"><div class="n">${esc(o.name)}<em>${esc(o.to)} Â· ${esc(o.when)}</em></div>
          <span class="tag ${o.on ? 'green' : ''}">${o.on ? 'active' : 'paused'}</span></div>`).join('')}
      </div>`;
      on('#ws-reauth', 'click', () => window.HWtoast('Re-authorisation would open the Google consent screen', 'warn'));
      on('#ws-mail', 'click', () => { closeSettings(); window.HWwork.setMode('work'); window.HWopen('mail'); window.HWwork.renderMail(); });
    }

    else if (T === 'users') {
      const W3 = window.HW3, TT = window.HWwork.T;
      body.innerHTML = `<div class="setsec"><h4>Users</h4>
        <p>${TT.users.length} users. Role decides capability: only a group security lead approves or issues
        a briefing, only an imagery analyst confirms a detection.</p>
        ${TT.users.map(u => `<div class="setrow"><div class="n">${esc(u.name)}${u.id === TT.me ? ' Â· you' : ''}
            <em>${esc(W3.ROLES[u.role].name)} Â· ${esc(u.email)} Â· ${esc(u.tz)}</em></div>
          <span class="tag ${u.status === 'online' ? 'green' : u.status === 'away' ? 'amber' : ''}">${u.status}</span></div>`).join('')}
        <div class="btnrow" style="padding:11px 0 0;display:flex;gap:6px">
          <button class="btn sm primary" id="us-add"><svg><use href="#i-plus"/></svg> create user</button>
          <button class="btn sm" id="us-switch">switch user</button></div>
      </div>
      <div class="setsec" style="border:0"><h4>Roles</h4>
        ${Object.entries(W3.ROLES).map(([k, v]) => `<div class="setrow">
          <div class="n">${esc(v.name)}<em>${v.can.join(' Â· ')}</em></div>
          <span class="lbl mono">${TT.users.filter(u => u.role === k).length}</span></div>`).join('')}
      </div>`;
      on('#us-add', 'click', () => { closeSettings(); window.HWwork.openWho(true); });
      on('#us-switch', 'click', () => { closeSettings(); window.HWwork.openWho(); });
    }

    else {
      body.innerHTML = `<div class="setsec"><h4>Horizon Watch</h4>
        <p>A geopolitical risk and intelligence console for a corporate security team. Ten modules over one
        corpus: situation, signal triage, exposure dossiers, analytics, briefing generation, event replay,
        an editable ontology, satellite change detection, and interactive plus printable briefings.</p>
        <div class="setrow"><div class="n">Build<em>ops console 4.2 Â· 4.2.108</em></div><span class="tag">current</span></div>
        <div class="setrow"><div class="n">Corpus<em>${D.events.length} signals Â· ${D.entities.length} entities Â· ${X.nodes.length} objects Â· ${X.scenes.length} scenes</em></div><span class="tag amber">sample</span></div>
        <div class="setrow"><div class="n">Geometry<em>Natural Earth 110m via world-atlas, rendered with d3-geo</em></div><span class="tag">public domain</span></div>
      </div>
      <div class="setsec" style="border:0"><h4>Data handling</h4>
        <p>The loaded corpus is illustrative sample data and is labelled as such in the status bar. Vessel and
        aircraft identities are not live feeds. Nothing in this console should be treated as reporting.</p>
        <p class="dim" style="font-size:11.5px">Workspace state â sessions, views, rules, pins and settings â
        is stored locally in this browser only.</p>
      </div>`;
    }
    $('#set-foot').textContent = `Horizon Watch Â· ops console 4.2 Â· build 4.2.108 Â· ${Y.sessions.length} sessions Â· ${Y.rules.length} rules`;
  }

  /* ââââââââ 13 Â· full screen ââââââââ */
  function toggleFull() {
    const el = document.documentElement;
    if (!document.fullscreenElement) (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.())?.catch?.(() => window.HWtoast('Full screen was blocked by the browser', 'warn'));
    else (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.());
  }
  on('#btn-full', 'click', toggleFull);
  document.addEventListener('fullscreenchange', () => {
    const on_ = !!document.fullscreenElement;
    $('#btn-full').innerHTML = `<svg><use href="#i-full${on_ ? '-exit' : ''}"/></svg>`;
    $('#btn-full').classList.toggle('on', on_);
    $('#btn-full').title = on_ ? 'Exit full screen (F)' : 'Full screen (F)';
    setTimeout(() => { SH.sizeMap(); SH.drawStrip(); }, 120);
  });

  /* ââââââââ 14 Â· keys ââââââââ */
  document.addEventListener('keydown', ev => {
    if (ev.target.matches('input,textarea,select')) return;
    if (ev.key === '?' || (ev.key === '/' && ev.shiftKey)) { ev.preventDefault(); openSettings('keys'); }
    else if (ev.key === 'f' || ev.key === 'F') { if (!ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); toggleFull(); } }
    else if (ev.key === 'Escape') { closeSettings(); $('#alert-scrim').classList.remove('open'); closePop(); }
  });

  /* ââââââââ 15 Â· boot ââââââââ */
  try {
    if (!restore()) { Y.sessions = SEED_SESSIONS(); Y.active = Y.sessions[0].id; Y.rules = SEED_RULES(); }
    if (!Y.sessions.length) { Y.sessions = SEED_SESSIONS(); Y.active = Y.sessions[0].id; }
  } catch (e) { Y.sessions = SEED_SESSIONS(); Y.active = Y.sessions[0].id; Y.rules = SEED_RULES(); }
  window.addEventListener('beforeunload', () => { try { captureSession(); persist(); } catch (e) {} });
  setInterval(() => { try { captureSession(); persist(); } catch (e) {} }, 60000);

  setTimeout(() => {
    try {
      applySession(Y.active, { toast: false, freshView: true });
      armRail(); armTabs(); renderViews(); renderTimeCursor();
      const old = window.HWX && window.HWX.onModule;
      if (old) window.HWX.onModule = id => {
        old(id);
        if (id === 'map') { try { renderViews(); renderTimeCursor(); } catch (e) {} }
      };
    } catch (e) {
      console.error('workspace layer failed to initialise', e);
      window.HWtoast && window.HWtoast('Workspace state could not be restored â defaults loaded', 'warn');
    }
  }, 260);
})();
