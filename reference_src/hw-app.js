/* Horizon Watch â shell, map module, signal inbox. */
(function () {
  const D = window.HW, DOM = D.DOMAINS, SEV = D.SEV;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const pad = n => String(n).padStart(2, '0');
  const zulu = d => `${pad(d.getUTCDate())}${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getUTCMonth()]} ${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
  const hhmm = d => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
  const ago = h => h < 1 ? 'just now' : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const MODULES = [
    { id: 'map', label: 'Situation', icon: 'i-globe', tab: 'Global situation' },
    { id: 'inbox', label: 'Inbox', icon: 'i-inbox', tab: 'Signal inbox', badge: () => S.unread },
    { id: 'dossier', label: 'Dossiers', icon: 'i-dossier', tab: 'Dossier' },
    { id: 'analytics', label: 'Analytics', icon: 'i-chart', tab: 'Exposure analytics' },
    { id: 'generate', label: 'Generate', icon: 'i-spark', tab: 'Briefing generator' },
      { id: 'replay', label: 'Replay', icon: 'i-clock', tab: 'Event replay' },
  { id: 'ontology', label: 'Ontology', icon: 'i-onto', tab: 'Ontology graph' },
  { id: 'imagery', label: 'Imagery', icon: 'i-sat', tab: 'Change detection' },
  { id: 'reader', label: 'Briefings', icon: 'i-read', tab: 'Briefings' },
  { id: 'doc', label: null, icon: 'i-doc', tab: 'Print layout', hidden: true },
  /* Workstation modules â shown only in Workstation mode (hw-w.js swaps the set) */
  { id: 'work',  label: 'My work',  icon: 'i-work', tab: 'My work', set: 'work' },
  { id: 'mail',  label: 'Mail',     icon: 'i-mail', tab: 'Mail',    set: 'work' },
  { id: 'cases', label: 'Cases',    icon: 'i-case', tab: 'Cases',   set: 'work' },
  { id: 'team',  label: 'Team',     icon: 'i-team', tab: 'Team',    set: 'work' }
  ];

  const S = window.HWS = {
    module: 'map', tabs: [], tab: null, sel: null, basket: [], win: 72, sevFloor: 1,
    domains: new Set(Object.keys(DOM)), ctx: { risk: true, grat: true, labels: false, flows: true, aoi: true, arcs: true },
    proj: 'world', inbox: { sort: 'ts', dir: -1, status: 'all', q: '', sel: null },
    unread: D.events.filter(e => e.status === 'new').length, doc: null
  };
  const on = (sel, ev, fn) => { const n = typeof sel === 'string' ? $(sel) : sel; if (n) n.addEventListener(ev, fn); };
  window.HWU = { $, $$, zulu, hhmm, ago, esc, pad };

  /* âââ shell âââ */
  function renderRail() {
    /* data-set lets #app.mode-work filter the rail in CSS. An inline-style
       filter cannot survive this innerHTML rebuild, which runs on every module
       change, tab change and session switch. */
    $('#modrail').innerHTML = MODULES.filter(m => !m.hidden).map(m => `
      <button class="mod" role="tab" data-mod="${m.id}" data-set="${m.set || 'watch'}" aria-selected="${S.module === m.id}" style="position:relative">
        <svg><use href="#${m.icon}"/></svg><i>${m.label}</i>
        ${m.badge && m.badge() ? `<span class="badge">${m.badge()}</span>` : ''}
      </button>`).join('');
    $$('#modrail .mod').forEach(b => b.onclick = () => openModule(b.dataset.mod));
  }

  function openModule(id, label) {
    /* Tabs are RECORD-scoped, not module-scoped: switching lens does not spawn a
       tab. A tab appears only when a label names an actual record. */
    if (label) {
      let t = S.tabs.find(t => t.mod === id && t.kind === 'record');
      if (!t) { t = { id: 'T' + Date.now().toString(36), mod: id, label, kind: 'record' }; S.tabs.push(t); }
      else t.label = label;
      S.tab = t.id;
    }
    S.module = id;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + id));
    renderRail(); renderTabs();
    if (id === 'map') setTimeout(() => { sizeMap(); drawStrip(); }, 0);
    if (window.HWM && HWM.onModule) HWM.onModule(id);
  }
  window.HWopen = openModule;

  function renderTabs() {
    const strip = $('#tabstrip'), right = $('.right', strip);
    strip.querySelectorAll('.tab,.newtab').forEach(n => n.remove());
    S.tabs.forEach(t => {
      const b = document.createElement('button');
      b.className = 'tab'; b.setAttribute('aria-selected', S.tab === t.id);
      const dom = t.mod === 'map' ? '#3b82d6' : t.mod === 'inbox' ? '#d9862b' : t.mod === 'doc' ? '#2f9e6b' : '#8b6fd4';
      b.innerHTML = `<i class="dot" style="background:${dom}"></i><span>${esc(t.label)}</span><i class="x">â</i>`;
      b.onclick = e => {
        if (e.target.classList.contains('x')) {
          S.tabs = S.tabs.filter(x => x.id !== t.id);
          if (S.tab === t.id && S.tabs.length) openModule(S.tabs[S.tabs.length - 1].mod);
          else if (!S.tabs.length) openModule('map');
          else renderTabs();
          return;
        }
        openModule(t.mod);
      };
      strip.insertBefore(b, right);
    });
    const nb = document.createElement('button');
    nb.className = 'newtab'; nb.innerHTML = '<svg style="width:13px;height:13px"><use href="#i-plus"/></svg>';
    nb.onclick = () => paletteOpen();
    strip.insertBefore(nb, right);
  }

  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.innerHTML = `<svg style="width:14px;height:14px;color:var(--${kind === 'ok' ? 'green' : kind === 'warn' ? 'amber' : 'acc-hi'})"><use href="#i-${kind === 'ok' ? 'check' : 'bell'}"/></svg><span>${esc(msg)}</span>`;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 320); }, 3200);
  }
  window.HWtoast = toast;

  function addToBasket(ids) {
    let n = 0;
    ids.forEach(id => { if (!S.basket.includes(id)) { S.basket.push(id); n++; } });
    $('#st-basket').textContent = S.basket.length;
    if (window.HWM && HWM.renderEvidence) HWM.renderEvidence();
    toast(n ? `${n} signal${n > 1 ? 's' : ''} added to briefing basket` : 'Already in basket', n ? 'ok' : null);
  }
  window.HWbasket = addToBasket;

  /* âââ clock + telemetry âââ */
  setInterval(() => {
    const d = new Date();
    $('#clock').innerHTML = `<b>${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}</b> Z Â· ${zulu(d).split(' ')[0]}`;
    $('#ingest').textContent = 'Ingest ' + (118 + Math.floor(Math.random() * 24)) + '/min';
    $('#st-lat').textContent = (36 + Math.floor(Math.random() * 14)) + ' ms';
  }, 1000);
  $('#st-corpus').textContent = D.events.length.toLocaleString();

  /* âââ filtering âââ */
  function visible() {
    return D.events.filter(e => e.hoursAgo <= S.win && S.domains.has(e.domain) &&
      SEV[e.severity].rank >= S.sevFloor && (!S.tCut || e.ts.getTime() <= S.tCut));
  }
  window.HWvisible = visible;

  /* âââ map âââ */
  const svg = d3.select('#mapsvg');
  const gRoot = svg.append('g');
  const gSphere = gRoot.append('g'), gGrat = gRoot.append('g'), gLand = gRoot.append('g'),
    gArc = gRoot.append('g'), gAoi = gRoot.append('g'), gMark = gRoot.append('g');
  let projection = d3.geoEquirectangular(), path = d3.geoPath(projection), countries = null, zoomK = 1, zt = d3.zoomIdentity;
  const VIEWS = { world: [[-170, 78], [178, -58]], emea: [[-22, 62], [62, -12]], apac: [[62, 46], [150, -12]], amer: [[-128, 52], [-32, -46]] };

  const hooks = window.HWmapHooks = [];
  const fireDraw = () => hooks.forEach(f => f.draw && f.draw(projection, path, zoomK));
  const fireZoom = () => hooks.forEach(f => f.zoom && f.zoom(zoomK, projection));
  const zoom = d3.zoom().scaleExtent([1, 14]).on('zoom', ev => {
    zt = ev.transform; zoomK = ev.transform.k;
    gRoot.attr('transform', ev.transform);
    fireZoom();
    gMark.selectAll('.marker').attr('transform', d => `translate(${projection([d.lon, d.lat])}) scale(${1 / zoomK})`);
    gLand.selectAll('path').style('stroke-width', .6 / zoomK);
    updateScale();

  });
  svg.call(zoom).on('dblclick.zoom', null);

  /* Animation frames are not serviced in every host frame (throttled or
     backgrounded), and d3 transitions are rAF-driven. Probe once, then route
     every zoom transform through this helper: animated where frames run,
     applied synchronously where they do not, so navigation always works. */
  let rafOK = null;
  (function probeRaf() {
    let fired = false;
    requestAnimationFrame(() => { fired = true; rafOK = true; });
    setTimeout(() => { if (!fired) rafOK = false; }, 260);
  })();
  function applyZoom(t, ms) {
    if (rafOK && ms) svg.transition().duration(ms).call(zoom.transform, t);
    else svg.call(zoom.transform, t);
  }
  function updateScale() {
    const s = $('#map-scale'); if (s) s.textContent = Math.round(2400 / zoomK).toLocaleString() + ' km';
    const zl = $('#nav-z'); if (zl) zl.textContent = zoomK.toFixed(1) + 'Ã';
  }
  function paneInsets(w) {
    const host = $('#view-map .panes') || document.documentElement;
    const cs = getComputedStyle(host);
    const l = parseFloat(cs.getPropertyValue('--pane-l')) || 250;
    const r = parseFloat(cs.getPropertyValue('--pane-r')) || 312;
    return [Math.min(l, w * 0.2) + 8, Math.min(r, w * 0.22) + 8];
  }
  let sizeTries = 0;
  function sizeMap() {
    const w = $('#mapwrap').clientWidth, h = $('#mapwrap').clientHeight;
    if (!w || !h) { if (sizeTries++ < 20) setTimeout(sizeMap, 50); return; }
    sizeTries = 0;
    svg.attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h);
    fitView(S.proj, false);
  }
  function fitView(key, animate) {
    const w = $('#mapwrap').clientWidth, h = $('#mapwrap').clientHeight;
    const b = VIEWS[key];
    /* the glass panels overlay the map: read their real widths so the fit and the
       overlay insets can never drift apart */
    const [padL, padR] = paneInsets(w);
    projection.fitExtent([[padL, 6], [w - padR, h - 6]], { type: 'Polygon', coordinates: [[[b[0][0], b[0][1]], [b[1][0], b[0][1]], [b[1][0], b[1][1]], [b[0][0], b[1][1]], [b[0][0], b[0][1]]]] });
    path = d3.geoPath(projection);
    updateScale();
    applyZoom(d3.zoomIdentity, animate ? 420 : 0);
    drawGeo(); drawMarkers();
  }
  function drawGeo() {
    gSphere.selectAll('path').data([{ type: 'Sphere' }]).join('path').attr('class', 'sphere').attr('d', path);
    gGrat.selectAll('path').data(S.ctx.grat ? [d3.geoGraticule10()] : []).join('path').attr('class', 'graticule').attr('d', path);
    if (!countries) return;
    gLand.selectAll('path').data(countries.features, d => d.id).join('path')
      .attr('class', d => 'land' + (S.ctx.risk ? ' risk-' + (D.risk[d.properties.iso || isoOf(d)] || 0) : ''))
      .attr('d', path)
      .on('mousemove', function (ev, d) { d3.select(this).classed('hovered', true); tip(ev, `<b>${esc(d.properties.name)}</b><span class="lbl">Country risk index ${D.risk[isoOf(d)] || 1}/5</span>`); })
      .on('mouseleave', function () { d3.select(this).classed('hovered', false); tipHide(); });
    gArc.selectAll('path').data(S.ctx.arcs ? D.flows : []).join('path')
      .attr('class', 'arc').attr('stroke', d => d.color)
      .attr('d', d => path({ type: 'LineString', coordinates: [d.from, d.to] }));
    gAoi.selectAll('path').data(S.ctx.aoi ? D.aois : []).join('path')
      .attr('class', 'aoi').attr('d', d => path({ type: 'Polygon', coordinates: [d.pts.concat([d.pts[0]])] }));
  }
  const isoMap = {};
  function isoOf(f) { return isoMap[f.id] || f.properties.iso || ''; }

  function drawMarkers() {
    const evs = visible();
    setTimeout(refreshLegend, 0);
    $('#map-count').textContent = evs.length + ' signals Â· ' + S.win + 'h window';
    const g = gMark.selectAll('.marker').data(evs, d => d.id);
    g.exit().remove();
    const en = g.enter().append('g').attr('class', 'marker');
    en.append('circle').attr('class', 'halo');
    en.append('rect');
    en.append('text');
    const all = en.merge(g)
      .attr('transform', d => `translate(${projection([d.lon, d.lat])}) scale(${1 / zoomK})`)
      .classed('sel', d => d.id === S.sel)
      .on('mousemove', (ev, d) => tip(ev, `<b>${esc(d.title)}</b><span class="lbl">${d.place.toUpperCase()} Â· ${SEV[d.severity].name.toUpperCase()} Â· ${zulu(d.ts)}</span>`))
      .on('mouseleave', tipHide)
      .on('click', (ev, d) => { ev.stopPropagation(); selectEvent(d.id); });
    all.select('rect')
      .attr('x', d => -sizeFor(d) / 2).attr('y', d => -sizeFor(d) / 2)
      .attr('width', d => sizeFor(d)).attr('height', d => sizeFor(d))
      .attr('transform', 'rotate(45)')
      .attr('fill', d => SEV[d.severity].color)
      .attr('opacity', d => d.status === 'ack' ? .55 : 1);
    all.select('circle.halo')
      .attr('r', d => d.severity === 'critical' ? 11 : 0)
      .attr('stroke', d => SEV[d.severity].color);
    all.select('text')
      .attr('x', d => sizeFor(d) / 2 + 5).attr('y', 3)
      .text(d => S.ctx.labels ? d.place : '');
    gMark.selectAll('.marker').sort((a, b) => SEV[a.severity].rank - SEV[b.severity].rank);
    fireDraw();
  }
  function refreshLegend() {
    const lg = $('#map-legend'); if (!lg) return;
    lg.innerHTML = Object.entries(SEV).sort((a, b) => b[1].rank - a[1].rank).map(([k, v]) =>
      `<li><i class="dia" style="background:${v.color}"></i>${v.name}<span>${visible().filter(e => e.severity === k).length}</span></li>`).join('');
  }
  const sizeFor = d => d.severity === 'critical' ? 9 : d.severity === 'high' ? 8 : 7;

  const tipEl = $('#maptip');
  function tip(ev, html) { tipEl.innerHTML = html; tipEl.classList.add('show'); tipEl.style.left = Math.min(ev.clientX + 14, innerWidth - 270) + 'px'; tipEl.style.top = (ev.clientY + 14) + 'px'; }
  function tipHide() { tipEl.classList.remove('show'); }

  $('#mapwrap').addEventListener('mousemove', ev => {
    const r = $('#mapsvg').getBoundingClientRect();
    const p = projection.invert(zt.invert([ev.clientX - r.left, ev.clientY - r.top]));
    if (p) $('#map-cursor').innerHTML = `LAT <b>${p[1] >= 0 ? '+' : ''}${p[1].toFixed(4)}</b>  LON <b>${p[0] >= 0 ? '+' : ''}${p[0].toFixed(4)}</b>`;
  });

  fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')
    .then(r => r.json()).then(topo => {
      countries = topojson.feature(topo, topo.objects.countries);
      const byName = {};
      D.entities.forEach(e => byName[e.name] = e);
      countries.features.forEach(f => { isoMap[f.id] = NAME2ISO[f.properties.name] || ''; });
      drawGeo(); drawMarkers();
    }).catch(() => toast('Basemap geometry unavailable offline', 'warn'));

  const NAME2ISO = { 'Ukraine': 'UKR', 'Russia': 'RUS', 'Yemen': 'YEM', 'Sudan': 'SDN', 'Mali': 'MLI', 'Burkina Faso': 'BFA', 'Niger': 'NER', 'Somalia': 'SOM', 'Dem. Rep. Congo': 'COD', 'Libya': 'LBY', 'Iraq': 'IRQ', 'Iran': 'IRN', 'Lebanon': 'LBN', 'Myanmar': 'MMR', 'Venezuela': 'VEN', 'Haiti': 'HTI', 'Syria': 'SYR', 'Afghanistan': 'AFG', 'Pakistan': 'PAK', 'Bangladesh': 'BGD', 'Ethiopia': 'ETH', 'Mozambique': 'MOZ', 'Nigeria': 'NGA', 'Taiwan': 'TWN', 'Philippines': 'PHL', 'Ecuador': 'ECU', 'Peru': 'PER', 'Mexico': 'MEX', 'Colombia': 'COL', 'Turkey': 'TUR', 'Egypt': 'EGY', 'Saudi Arabia': 'SAU', 'Indonesia': 'IDN', 'India': 'IND', 'China': 'CHN', 'South Korea': 'KOR', 'Japan': 'JPN', 'Poland': 'POL', 'Sweden': 'SWE', 'Finland': 'FIN', 'Netherlands': 'NLD', 'Germany': 'DEU', 'France': 'FRA', 'United Kingdom': 'GBR', 'United States of America': 'USA', 'Canada': 'CAN', 'Australia': 'AUS', 'Brazil': 'BRA', 'Chile': 'CHL', 'Argentina': 'ARG', 'South Africa': 'ZAF', 'Kenya': 'KEN', 'Morocco': 'MAR', 'Algeria': 'DZA', 'Tunisia': 'TUN', 'Jordan': 'JOR', 'Israel': 'ISR', 'Palestine': 'PSE', 'Oman': 'OMN', 'United Arab Emirates': 'ARE', 'Qatar': 'QAT', 'Kuwait': 'KWT', 'Azerbaijan': 'AZE', 'Armenia': 'ARM', 'Georgia': 'GEO', 'Kazakhstan': 'KAZ', 'Uzbekistan': 'UZB', 'Belarus': 'BLR', 'Moldova': 'MDA', 'Serbia': 'SRB', 'Greece': 'GRC', 'Italy': 'ITA', 'Spain': 'ESP', 'Portugal': 'PRT', 'Norway': 'NOR', 'Denmark': 'DNK', 'Ireland': 'IRL', 'Switzerland': 'CHE', 'Austria': 'AUT', 'Belgium': 'BEL', 'Czechia': 'CZE', 'Hungary': 'HUN', 'Romania': 'ROU', 'Bulgaria': 'BGR', 'Croatia': 'HRV', 'Slovakia': 'SVK', 'Slovenia': 'SVN', 'Estonia': 'EST', 'Latvia': 'LVA', 'Lithuania': 'LTU', 'Vietnam': 'VNM', 'Thailand': 'THA', 'Malaysia': 'MYS', 'New Zealand': 'NZL', 'Sri Lanka': 'LKA', 'Nepal': 'NPL', 'Mongolia': 'MNG', 'Papua New Guinea': 'PNG', 'Chad': 'TCD', 'Cameroon': 'CMR', 'Central African Rep.': 'CAF', 'S. Sudan': 'SSD', 'Eritrea': 'ERI', 'Mauritania': 'MRT', 'Senegal': 'SEN', 'Ghana': 'GHA', "CÃ´te d'Ivoire": 'CIV', 'Guinea': 'GIN' };

  /* layer panel */
  function renderLayers() {
    $('#cnt-dom').textContent = S.domains.size + '/' + Object.keys(DOM).length;
    $('#layer-domains').innerHTML = Object.entries(DOM).map(([k, v]) => {
      const n = D.events.filter(e => e.domain === k && e.hoursAgo <= S.win).length;
      const off = !S.domains.has(k);
      return `<li><div class="layer${off ? ' off' : ''}" data-dom="${k}">
        <i class="sw" style="background:${v.color}"></i><span class="n">${v.name}</span><span class="c">${n}</span>
        <button class="eye" data-dom="${k}" title="toggle"><svg style="width:13px;height:13px"><use href="#i-eye${off ? '-off' : ''}"/></svg></button></div></li>`;
    }).join('');
    $$('#layer-domains .layer').forEach(n => n.onclick = () => {
      const k = n.dataset.dom;
      S.domains.has(k) ? S.domains.delete(k) : S.domains.add(k);
      renderLayers(); drawMarkers(); drawStrip();
    });
    const CTX = [['risk', 'Country risk index'], ['grat', 'Graticule 10Â°'], ['arcs', 'Trade & energy flows'], ['aoi', 'Areas of interest'], ['labels', 'Marker labels'], ['sat', 'Satellite tasking (none)']];
    $('#layer-context').innerHTML = CTX.map(([k, name]) => {
      const off = k === 'sat' ? true : !S.ctx[k];
      return `<li><div class="layer${off ? ' off' : ''}" data-ctx="${k}"><i class="sw" style="background:${k === 'sat' ? '#4d5c69' : '#3b82d6'}"></i>
        <span class="n">${name}</span><button class="eye"><svg style="width:13px;height:13px"><use href="#i-eye${off ? '-off' : ''}"/></svg></button></div></li>`;
    }).join('');
    $$('#layer-context .layer').forEach(n => n.onclick = () => {
      const k = n.dataset.ctx;
      if (k === 'sat') return toast('No satellite tasking layer in this corpus', 'warn');
      S.ctx[k] = !S.ctx[k]; renderLayers(); drawGeo(); drawMarkers();
      $('#t-risk').classList.toggle('on', S.ctx.risk); $('#t-grat').classList.toggle('on', S.ctx.grat); $('#t-label').classList.toggle('on', S.ctx.labels);
    });
    $('#layer-sev').innerHTML = `<div class="chips">${Object.entries(SEV).sort((a, b) => b[1].rank - a[1].rank).map(([k, v]) =>
      `<button class="chip" data-sev="${v.rank}" aria-pressed="${S.sevFloor === v.rank}"><i class="sw" style="background:${v.color}"></i>${v.name}+</button>`).join('')}</div>`;
    $('#cnt-sev').textContent = Object.values(SEV).find(v => v.rank === S.sevFloor).name.toLowerCase() + '+';
    $$('#layer-sev .chip').forEach(b => b.onclick = () => { S.sevFloor = +b.dataset.sev; renderLayers(); drawMarkers(); drawStrip(); });
    const lg = $('#map-legend');
    if (lg) lg.innerHTML = Object.entries(SEV).sort((a, b) => b[1].rank - a[1].rank).map(([k, v]) =>
      `<li><i class="dia" style="background:${v.color}"></i>${v.name}<span>${visible().filter(e => e.severity === k).length}</span></li>`).join('');
  }

  $$('#win-seg button').forEach(b => b.onclick = () => {
    $$('#win-seg button').forEach(x => x.setAttribute('aria-pressed', x === b));
    S.win = +b.dataset.win; $('#cnt-win').textContent = b.textContent;
    renderLayers(); drawMarkers(); drawStrip();
  });
  on('#layers-all', 'click', () => { Object.keys(DOM).forEach(k => S.domains.add(k)); renderLayers(); drawMarkers(); drawStrip(); });
  on('#layers-none', 'click', () => { S.domains.clear(); renderLayers(); drawMarkers(); drawStrip(); });
  $$('#proj-seg button').forEach(b => b.onclick = () => {
    $$('#proj-seg button').forEach(x => x.setAttribute('aria-pressed', x === b));
    S.proj = b.dataset.proj; fitView(S.proj, true);
  });
  on('#t-risk', 'click', () => { S.ctx.risk = !S.ctx.risk; $('#t-risk').classList.toggle('on'); renderLayers(); drawGeo(); });
  on('#t-grat', 'click', () => { S.ctx.grat = !S.ctx.grat; $('#t-grat').classList.toggle('on'); renderLayers(); drawGeo(); });
  on('#t-label', 'click', () => { S.ctx.labels = !S.ctx.labels; $('#t-label').classList.toggle('on'); renderLayers(); drawMarkers(); });
  on('#t-reset', 'click', () => fitView(S.proj, true));
  const nudgeZoom = f => applyZoom(zt.scale ? d3.zoomIdentity.translate(zt.x, zt.y).scale(zt.k).scale(f) : d3.zoomIdentity.scale(f), 240);
  on('#nav-in', 'click', () => nudgeZoom(1.6));
  on('#nav-out', 'click', () => nudgeZoom(1 / 1.6));
  on('#nav-home', 'click', () => applyZoom(d3.zoomIdentity, 420));
  on('#nav-fit', 'click', () => {
    const evs = visible(); if (!evs.length) return toast('No signals in the current filter', 'warn');
    const w = $('#mapwrap').clientWidth, h = $('#mapwrap').clientHeight;
    const [padL, padR] = paneInsets(w);
    const pts = evs.map(e => projection([e.lon, e.lat])).filter(Boolean);
    const x0 = d3.min(pts, p => p[0]), x1 = d3.max(pts, p => p[0]);
    const y0 = d3.min(pts, p => p[1]), y1 = d3.max(pts, p => p[1]);
    const k = Math.max(1, Math.min(10, 0.86 / Math.max((x1 - x0) / (w - padL - padR), (y1 - y0) / h)));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    applyZoom(d3.zoomIdentity.translate((padL + (w - padR)) / 2 - cx * k, h / 2 - cy * k).scale(k), 560);
    toast(evs.length + ' signals fitted to view');
  });

  /* collapse / restore the Situation side panels â the grid variables drive the
     map fit and every overlay inset, so the map reflows with them */
  function setPane(side, minimised) {
    const panes = $('#view-map .panes');
    panes.classList.toggle('min-' + side, minimised);
    setTimeout(() => { sizeMap(); drawStrip(); }, 260);
  }
  window.HWreveal = () => { if ($('#view-map .panes').classList.contains('min-r')) setPane('r', false); };
  on('#min-l', 'click', () => setPane('l', true));
  on('#min-r', 'click', () => setPane('r', true));
  on('#tab-l', 'click', () => setPane('l', false));
  on('#tab-r', 'click', () => setPane('r', false));
  on('#strip-jump', 'click', () => openModule('replay'));
  $$('.grouphead').forEach(h => h.onclick = () => {
    const open = h.getAttribute('aria-expanded') === 'true';
    h.setAttribute('aria-expanded', !open);
    const body = h.nextElementSibling; if (body) body.classList.toggle('hidden', open);
  });

  /* density strip */
  function drawStrip() {
    const el = $('#stripsvg'); if (!el) return;
    const w = el.clientWidth || 800, h = 72;
    const s = d3.select(el).attr('viewBox', `0 0 ${w} ${h}`).attr('height', h);
    s.selectAll('*').remove();
    const now = Date.now(), t0 = now - S.win * 3600e3;
    const [ipL, ipR] = paneInsets(w);
    const x0 = ipL + 2, x1 = w - ipR - 2;
    const x = d3.scaleTime().domain([t0, now]).range([x0, x1]);
    const bins = 60, evs = visible();
    const arr = new Array(bins).fill(0), hot = new Array(bins).fill(0);
    evs.forEach(e => {
      const i = Math.min(bins - 1, Math.floor((e.ts.getTime() - t0) / (S.win * 3600e3 / bins)));
      if (i >= 0) { arr[i]++; if (e.severity === 'critical' || e.severity === 'high') hot[i]++; }
    });
    const max = Math.max(3, d3.max(arr)), bw = (x1 - x0) / bins;
    const y = d3.scaleLinear().domain([0, max]).range([h - 18, 6]);
    s.append('g').selectAll('rect').data(arr).join('rect')
      .attr('class', (d, i) => 'histbar' + (hot[i] ? ' hot' : ''))
      .attr('x', (d, i) => x0 + i * bw).attr('width', Math.max(1, bw - 1.5))
      .attr('y', d => y(d)).attr('height', d => h - 18 - y(d));
    s.append('g').attr('class', 'axis').attr('transform', `translate(0,${h - 17})`)
      .call(d3.axisBottom(x).ticks(Math.min(8, S.win / 6)).tickFormat(d => S.win > 168 ? d3.utcFormat('%d %b')(d) : d3.utcFormat('%H:%MZ')(d)).tickSizeOuter(0));
    $('#strip-range').textContent = `${zulu(new Date(t0))} â ${zulu(new Date(now))}`;
  }
  window.addEventListener('resize', () => { if (S.module === 'map') { sizeMap(); drawStrip(); } if (window.HWM && HWM.onResize) HWM.onResize(); });

  /* inspector */
  function selectEvent(id, opts) {
    S.sel = id; drawMarkers(); renderInspector();
    if (opts && opts.pan) {
      const e = D.events.find(x => x.id === id), w = $('#mapwrap').clientWidth, h = $('#mapwrap').clientHeight;
      const p = projection([e.lon, e.lat]), k = Math.max(2.6, zoomK);
      applyZoom(d3.zoomIdentity.translate(w / 2 - p[0] * k, h / 2 - p[1] * k).scale(k), 520);
    }
  }
  window.HWselect = selectEvent;

  function renderInspector() {
    if (S.sel) window.HWreveal();
    const box = $('#inspector');
    if (!S.sel) {
      const evs = visible(), byReg = d3.rollups(evs, v => v.length, d => d.region).sort((a, b) => b[1] - a[1]);
      const crit = evs.filter(e => e.severity === 'critical').sort((a, b) => a.hoursAgo - b.hoursAgo);
      $('#insp-title').textContent = 'Situation summary';
      box.innerHTML = `
        <div class="sect"><span class="lbl">Posture Â· ${S.win}h window</span>
          <div class="statgrid" style="grid-template-columns:1fr 1fr">
            <div class="stat"><div class="v">${evs.length}</div><div class="lbl">signals in window</div></div>
            <div class="stat"><div class="v" style="color:var(--red)">${crit.length}</div><div class="lbl">critical</div></div>
            <div class="stat"><div class="v">${new Set(evs.map(e => e.iso3)).size}</div><div class="lbl">countries</div></div>
            <div class="stat"><div class="v">${S.basket.length}</div><div class="lbl">in briefing basket</div></div>
          </div>
        </div>
        <div class="sect"><span class="lbl">By region</span>
          ${byReg.map(([r, n]) => `<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">
            <span class="mono" style="width:44px;font-size:11px">${r}</span>
            <div class="bar"><i style="width:${n / evs.length * 100}%"></i></div>
            <span class="mono" style="font-size:11px;color:var(--txt-2)">${n}</span></div>`).join('')}
        </div>
        <div class="legend"><span class="lbl">Severity</span><ul id="map-legend"></ul></div>
        <div class="sect" style="border:0"><span class="lbl">Critical, newest first</span>
          <ul class="evlist" style="margin:0 -18px">${crit.slice(0, 6).map(rowHTML).join('') || '<li class="dim" style="padding:8px 18px">None in window.</li>'}</ul>
        </div>`;
      bindRows(box);
      fireInspector();
      return;
    }
    const e = D.events.find(x => x.id === S.sel);
    $('#insp-title').textContent = e.id;
    box.innerHTML = `
      <div class="detail">
        <div class="row"><span class="sev" style="color:${SEV[e.severity].color}"><i class="dia" style="background:${SEV[e.severity].color}"></i>${SEV[e.severity].name}</span>
          <span class="tag">${DOM[e.domain].short}</span>
          <span class="tag">${e.source}</span><span class="mono dim" style="font-size:10.5px;margin-left:auto">${ago(e.hoursAgo)}</span></div>
        <h2>${esc(e.title)}</h2>
        <div class="card"><span class="lbl">Assessment</span><p>${esc(e.summary)}</p></div>
        <div class="card"><span class="lbl">Geolocation</span>
          <dl class="kv">
            <dt>Place</dt><dd>${esc(e.place)}, ${esc(e.country)}</dd>
            <dt>Coordinates</dt><dd class="mono">${e.lat.toFixed(3)}, ${e.lon.toFixed(3)}</dd>
            <dt>Region</dt><dd>${e.region}</dd>
            <dt>Received</dt><dd class="mono">${zulu(e.ts)}</dd>
            <dt>Confidence</dt><dd><span class="conf"><div class="bar"><i style="width:${e.conf * 100}%;background:var(--grey)"></i></div>${Math.round(e.conf * 100)}%</span></dd>
          </dl></div>
        <div class="card"><span class="lbl">Exposure touched</span>
          <div class="chips">${e.impacts.map(i => `<span class="chip" aria-pressed="false" style="cursor:default">${esc(i)}</span>`).join('')}</div></div>
        <div class="btnrow" style="margin-bottom:10px">
          <button class="btn primary sm" id="insp-add"><svg><use href="#i-add-brief"/></svg> add to briefing</button>
          <button class="btn sm" id="insp-zoom">centre map</button>
          <button class="btn sm" id="insp-doss">open dossier</button>
        </div>
        <div class="legend" style="margin:0 -14px 9px"><span class="lbl">Severity</span><ul id="map-legend"></ul></div>
        <div class="card"><span class="lbl">Nearby signals Â· 800km</span>
          <ul class="evlist" style="margin:0 -12px 0">${near(e).map(rowHTML).join('') || '<li class="dim" style="padding:6px 12px">No corroborating signals nearby.</li>'}</ul></div>
      </div>`;
    if (window.HWrelated) window.HWrelated.inject(box, e);
    on('#insp-add', 'click', () => addToBasket([e.id]));
    on('#insp-zoom', 'click', () => selectEvent(e.id, { pan: true }));
    on('#insp-doss', 'click', () => { if (window.HWM) HWM.openDossierNear(e); });
    bindRows(box);
    fireInspector();
  }
  /* Extension layers augment the inspector through this hook, never by wrapping
     the export: selectEvent, the close handler and the map-background click all
     call this function through its local binding, which a reassigned export
     never rebinds. Same idiom as HWmapHooks. */
  function fireInspector() {
    (window.HWinspectorHooks || []).forEach(fn => { try { fn($('#inspector'), S.sel); } catch (e) { console.error(e); } });
  }
  function near(e) {
    return D.events.filter(o => o.id !== e.id && d3.geoDistance([e.lon, e.lat], [o.lon, o.lat]) * 6371 < 800)
      .sort((a, b) => a.hoursAgo - b.hoursAgo).slice(0, 5);
  }
  function rowHTML(e) {
    return `<li class="evrow" data-id="${e.id}" aria-selected="${e.id === S.sel}">
      <i class="dia" style="background:${SEV[e.severity].color}"></i>
      <div><h5>${esc(e.title)}</h5><div class="meta"><span>${esc(e.place)}</span><span>${DOM[e.domain].short}</span><span>${Math.round(e.conf * 100)}%</span></div></div>
      <span class="t">${ago(e.hoursAgo)}</span></li>`;
  }
  window.HWrowHTML = rowHTML;
  function bindRows(root) {
    $$('.evrow', root).forEach(r => r.onclick = () => { selectEvent(r.dataset.id, { pan: true }); if (S.module !== 'map') openModule('map'); });
  }
  window.HWbindRows = bindRows;
  on('#insp-close', 'click', () => { S.sel = null; drawMarkers(); renderInspector(); });
  $('#mapsvg').addEventListener('click', () => { if (S.sel) { S.sel = null; drawMarkers(); renderInspector(); } });

  /* âââ inbox âââ */
  function inboxRows() {
    const q = S.inbox.q.toLowerCase();
    let rows = D.events.filter(e =>
      (S.inbox.status === 'all' || e.status === S.inbox.status) &&
      (!q || (e.title + e.place + e.country + e.source + e.id).toLowerCase().includes(q)));
    const k = S.inbox.sort, dir = S.inbox.dir;
    rows.sort((a, b) => {
      let v = 0;
      if (k === 'ts') v = a.ts - b.ts;
      else if (k === 'sev') v = SEV[a.severity].rank - SEV[b.severity].rank;
      else if (k === 'conf') v = a.conf - b.conf;
      else v = String(a[k]).localeCompare(String(b[k]));
      return v * dir;
    });
    return rows;
  }
  function renderInbox() {
    const rows = inboxRows(), tb = $('#inbox-table tbody');
    tb.innerHTML = rows.map(e => `<tr data-id="${e.id}" aria-selected="${e.id === S.inbox.sel}" class="${e.status === 'ack' ? 'ack' : ''}">
      <td class="mono dim keep" style="font-size:11px">${hhmm(e.ts)}</td>
      <td class="keep"><span class="sev" style="color:${SEV[e.severity].color}"><i class="dia" style="background:${SEV[e.severity].color}"></i>${SEV[e.severity].name}</span></td>
      <td class="title"><div>${e.status === 'esc' ? '<span class="tag red" style="margin-right:6px">ESC</span>' : ''}${esc(e.title)}</div></td>
      <td><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.place)} <span class="dim">${e.iso3}</span></div></td>
      <td><span class="tag">${DOM[e.domain].short}</span></td>
      <td><span class="conf"><div class="bar"><i style="width:${e.conf * 100}%;background:var(--grey)"></i></div>${Math.round(e.conf * 100)}</span></td>
      <td class="mono dim" style="font-size:10.5px">${e.source}</td></tr>`).join('');
    $$('#inbox-table tbody tr').forEach(tr => tr.onclick = () => selectInbox(tr.dataset.id));
    $('#inbox-count').textContent = rows.length + ' of ' + D.events.length + ' signals';
    $$('#inbox-table thead th').forEach(th => {
      const act = th.dataset.sort === S.inbox.sort;
      th.innerHTML = th.innerHTML.replace(/<span class="ar">.*<\/span>/, '') + (act ? `<span class="ar">${S.inbox.dir > 0 ? 'â²' : 'â¼'}</span>` : '');
      th.onclick = () => {
        if (S.inbox.sort === th.dataset.sort) S.inbox.dir *= -1; else { S.inbox.sort = th.dataset.sort; S.inbox.dir = -1; }
        renderInbox();
      };
    });
    if (!S.inbox.sel && rows.length) selectInbox(rows[0].id); else renderInboxDetail();
  }
  function selectInbox(id) {
    S.inbox.sel = id;
    const e = D.events.find(x => x.id === id);
    if (e && e.status === 'new') { e.status = 'ack'; S.unread = D.events.filter(x => x.status === 'new').length; renderRail(); }
    $$('#inbox-table tbody tr').forEach(tr => tr.setAttribute('aria-selected', tr.dataset.id === id));
    renderInboxDetail();
  }
  function renderInboxDetail() {
    const e = D.events.find(x => x.id === S.inbox.sel), box = $('#inbox-detail');
    if (!e) { box.innerHTML = `<div class="empty"><svg><use href="#i-inbox"/></svg><p>Select a signal to read the assessment and source chain.</p></div>`; return; }
    box.innerHTML = `<div class="detail">
      <div class="row"><span class="sev" style="color:${SEV[e.severity].color}"><i class="dia" style="background:${SEV[e.severity].color}"></i>${SEV[e.severity].name}</span>
        <span class="tag">${DOM[e.domain].name}</span>
        <span class="mono dim" style="font-size:10.5px;margin-left:auto">${e.id}</span></div>
      <h2>${esc(e.title)}</h2>
      <p class="muted" style="margin:0 0 12px;font-size:12.5px;line-height:1.6">${esc(e.summary)}</p>
      <div class="card"><span class="lbl">Source chain</span>
        <div class="sourceline"><span class="lbl">Primary</span><span>${e.source}</span><span class="mono dim" style="margin-left:auto;font-size:10.5px">${zulu(e.ts)}</span></div>
        <div class="sourceline"><span class="lbl">Corrob.</span><span>${near(e).length} nearby signal${near(e).length === 1 ? '' : 's'}</span><span class="mono dim" style="margin-left:auto;font-size:10.5px">${e.conf > .78 ? 'MULTI-SOURCE' : 'SINGLE-SOURCE'}</span></div>
        <div class="sourceline"><span class="lbl">Analyst</span><span>${e.status === 'esc' ? 'Escalated to group security' : e.status === 'ack' ? 'Acknowledged' : 'Unreviewed'}</span></div>
      </div>
      <div class="card"><span class="lbl">Exposure touched</span>
        <div class="chips">${e.impacts.map(i => `<span class="chip" style="cursor:default">${esc(i)}</span>`).join('')}</div></div>
      <div class="btnrow"><button class="btn primary sm" id="det-add"><svg><use href="#i-add-brief"/></svg> add to briefing</button>
        <button class="btn sm" id="det-map">show on map</button>
        <button class="btn sm danger" id="det-esc">escalate</button></div>
    </div>`;
    on('#det-add', 'click', () => addToBasket([e.id]));
    on('#det-map', 'click', () => { openModule('map'); selectEvent(e.id, { pan: true }); });
    on('#det-esc', 'click', () => { e.status = 'esc'; renderInbox(); toast(e.id + ' escalated to group security', 'warn'); });
  }
  function renderInboxFilters() {
    const box = $('#inbox-filters');
    const count = (f) => D.events.filter(f).length;
    box.innerHTML = `
      <div class="group"><div class="groupbody" style="padding:10px">
        <span class="lbl" style="display:block;margin-bottom:7px">Severity</span>
        ${Object.entries(SEV).sort((a, b) => b[1].rank - a[1].rank).map(([k, v]) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <i class="dia" style="background:${v.color}"></i><span style="flex:1;font-size:12.5px">${v.name}</span>
            <div class="bar" style="max-width:56px"><i style="width:${count(e => e.severity === k) / D.events.length * 100 * 3}%;background:${v.color}"></i></div>
            <span class="mono dim" style="font-size:10.5px;width:20px;text-align:right">${count(e => e.severity === k)}</span>
          </div>`).join('')}
      </div></div>
      <div class="group"><div class="groupbody" style="padding:10px">
        <span class="lbl" style="display:block;margin-bottom:7px">Region</span>
        ${['EMEA', 'APAC', 'AMER'].map(r => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="flex:1;font-size:12.5px">${r}</span>
            <div class="bar" style="max-width:56px"><i style="width:${count(e => e.region === r) / D.events.length * 100 * 1.6}%"></i></div>
            <span class="mono dim" style="font-size:10.5px;width:20px;text-align:right">${count(e => e.region === r)}</span>
          </div>`).join('')}
      </div></div>
      <div class="group"><div class="groupbody" style="padding:10px">
        <span class="lbl" style="display:block;margin-bottom:7px">Source</span>
        ${D.SOURCES.map(s => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          <span class="mono" style="flex:1;font-size:11px;color:var(--txt-2)">${s}</span>
          <span class="mono dim" style="font-size:10.5px">${count(e => e.source === s)}</span></div>`).join('')}
      </div></div>`;
  }
  $$('#inbox-status button').forEach(b => b.onclick = () => {
    $$('#inbox-status button').forEach(x => x.setAttribute('aria-pressed', x === b));
    S.inbox.status = b.dataset.st; S.inbox.sel = null; renderInbox();
  });
  on('#inbox-q', 'input', ev => { S.inbox.q = ev.target.value; S.inbox.sel = null; renderInbox(); });
  on('#inbox-ack', 'click', () => { const e = D.events.find(x => x.id === S.inbox.sel); if (e) { e.status = 'ack'; renderInbox(); toast(e.id + ' acknowledged', 'ok'); } });
  on('#inbox-esc', 'click', () => { const e = D.events.find(x => x.id === S.inbox.sel); if (e) { e.status = 'esc'; renderInbox(); toast(e.id + ' escalated', 'warn'); } });
  on('#inbox-add', 'click', () => { if (S.inbox.sel) addToBasket([S.inbox.sel]); });
  on('#inbox-open-map', 'click', () => { if (S.inbox.sel) { openModule('map'); selectEvent(S.inbox.sel, { pan: true }); } });

  document.addEventListener('keydown', ev => {
    if (ev.target.matches('input,textarea')) {
      if (ev.key === 'Escape') ev.target.blur();
      if (!$('#palette-scrim').classList.contains('open')) return;
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); paletteOpen(); return; }
    if (ev.key === 'Escape') { paletteClose(); return; }
    if (S.module === 'inbox' && (ev.key === 'j' || ev.key === 'k')) {
      const rows = inboxRows(), i = rows.findIndex(r => r.id === S.inbox.sel);
      const n = rows[Math.max(0, Math.min(rows.length - 1, i + (ev.key === 'j' ? 1 : -1)))];
      if (n) { selectInbox(n.id); const tr = $(`#inbox-table tr[data-id="${n.id}"]`); if (tr) tr.parentElement.parentElement.parentElement.scrollTop += 0; }
      ev.preventDefault();
    }
    if (ev.key >= '1' && ev.key <= '7' && !ev.metaKey && !ev.ctrlKey && !ev.target.matches('input,textarea')) openModule(MODULES[+ev.key - 1].id);
  });

  /* âââ command palette âââ */
  let palItems = [], palIdx = 0;
  function paletteOpen() {
    if (window.HWP2) return window.HWP2.open();
    $('#palette-scrim').classList.add('open');
    const i = $('#palette-input'); i.value = ''; i.focus(); palFill('');
  }
  function paletteClose() { $('#palette-scrim').classList.remove('open'); }
  function palFill(q) {
    q = q.toLowerCase();
    const items = [];
    MODULES.forEach(m => items.push({ kind: 'MODULE', label: m.tab, go: () => openModule(m.id) }));
    D.entities.forEach(e => items.push({ kind: 'ENTITY', label: e.name, sub: e.type, go: () => { if (window.HWM) HWM.openEntity(e.id); } }));
    D.events.forEach(e => items.push({ kind: 'SIGNAL', label: e.title, sub: e.place, color: SEV[e.severity].color, go: () => { openModule('map'); selectEvent(e.id, { pan: true }); } }));
    D.briefings.forEach(b => items.push({ kind: 'BRIEFING', label: b.title, sub: b.id, go: () => { if (window.HWM) HWM.openBriefing(b.id); } }));
    palItems = items.filter(i => !q || (i.label + ' ' + (i.sub || '')).toLowerCase().includes(q)).slice(0, 40);
    palIdx = 0; palRender();
  }
  function palRender() {
    $('#palette-list').innerHTML = palItems.map((i, n) => `<li aria-selected="${n === palIdx}" data-i="${n}">
      ${i.color ? `<i class="dia" style="background:${i.color}"></i>` : `<svg style="width:13px;height:13px;color:var(--txt-4)"><use href="#i-${i.kind === 'MODULE' ? 'grid' : i.kind === 'ENTITY' ? 'dossier' : i.kind === 'BRIEFING' ? 'doc' : 'bell'}"/></svg>`}
      <span>${esc(i.label)}</span>${i.sub ? `<span class="dim" style="font-size:11.5px">${esc(i.sub)}</span>` : ''}<span class="lbl">${i.kind}</span></li>`).join('')
      || `<li class="dim" style="padding:14px 12px">No match.</li>`;
    $$('#palette-list li[data-i]').forEach(li => li.onclick = () => { palItems[+li.dataset.i].go(); paletteClose(); });
  }
  on('#palette-input', 'input', ev => palFill(ev.target.value));
  on('#palette-input', 'keydown', ev => {
    if (ev.key === 'ArrowDown') { palIdx = Math.min(palItems.length - 1, palIdx + 1); palRender(); ev.preventDefault(); }
    if (ev.key === 'ArrowUp') { palIdx = Math.max(0, palIdx - 1); palRender(); ev.preventDefault(); }
    if (ev.key === 'Enter' && palItems[palIdx]) { palItems[palIdx].go(); paletteClose(); }
  });
  on('#palette-scrim', 'click', ev => { if (ev.target.id === 'palette-scrim') paletteClose(); });
  on('#btn-search', 'click', paletteOpen);
  on('#btn-newtab', 'click', paletteOpen);
  on('#btn-bell', 'click', () => { openModule('inbox'); toast(S.unread + ' unreviewed signals in the inbox'); });
  on('#btn-aoi', 'click', () => {
    openModule('map');
    setTimeout(() => { const t = $('#annobar [data-tool=scanbox]'); if (t) t.click(); }, 60);
    toast('Scan box armed â drag a rectangle on the map');
  });
  on('#btn-export', 'click', () => { if (window.HWexport) window.HWexport.open(); else toast('Export unavailable', 'warn'); });

  /* âââ boot âââ */
  S.tabs = [{ id: 'T1', mod: 'map', label: 'Global situation' }, { id: 'T2', mod: 'inbox', label: 'Signal inbox' }];
  S.tab = 'T1';
  renderRail(); renderTabs(); renderLayers(); renderInspector(); renderInboxFilters(); renderInbox();
  window.HWmap = {
    get projection() { return projection; }, get path() { return path; }, get k() { return zoomK; },
    get transform() { return zt; }, svg, zoom, root: gRoot, tip, tipHide, redraw: drawMarkers,
    layer(name) { let g = gRoot.select('g.x-' + name); if (g.empty()) g = gRoot.append('g').attr('class', 'x-' + name); return g; },
    /* Returns null for a point that is not on the projected globe. Without this
       guard the inverse projection happily reports latitudes beyond Â±90, which
       silently corrupts anything measuring drawn geometry. */
    invert(clientX, clientY) {
      const r = $('#mapsvg').getBoundingClientRect();
      const p = projection.invert(zt.invert([clientX - r.left, clientY - r.top]));
      if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
      if (p[1] > 90 || p[1] < -90 || p[0] > 180 || p[0] < -180) return null;
      return p;
    },
    flyTo(lon, lat, k, ms) {
      const w = $('#mapwrap').clientWidth, h = $('#mapwrap').clientHeight;
      const p = projection([lon, lat]); if (!p) return;
      k = k || 4;
      applyZoom(d3.zoomIdentity.translate(w / 2 - p[0] * k, h / 2 - p[1] * k).scale(k), ms == null ? 620 : ms);
    },
    ping(lon, lat) {
      const g = this.layer('ping'); g.selectAll('*').remove();
      const p = projection([lon, lat]); if (!p) return;
      /* stepped with timers rather than d3 transitions: the pulse must play even
         where animation frames are throttled */
      [0, 420, 840].forEach(delay => {
        const c = g.append('circle').attr('cx', p[0]).attr('cy', p[1]).attr('r', 2)
          .attr('fill', 'none').attr('stroke', '#c4453c').attr('stroke-width', 1.4 / zoomK);
        const steps = 22, r1 = 46 / zoomK;
        for (let s = 1; s <= steps; s++) setTimeout(() => {
          const f = s / steps, e = 1 - Math.pow(1 - f, 3);
          c.attr('r', 2 + (r1 - 2) * e).attr('stroke-opacity', 1 - e);
          if (s === steps) c.remove();
        }, delay + s * (1300 / steps));
      });
      setTimeout(() => g.selectAll('*').remove(), 2600);
    }
  };
  window.HWshell = { renderLayers, fitView, renderTabs, openModule, MODULES, renderInbox, renderInboxFilters, drawMarkers, drawStrip, sizeMap, renderInspector, visible, toast };
  setTimeout(() => { sizeMap(); drawStrip(); }, 0);
})();
