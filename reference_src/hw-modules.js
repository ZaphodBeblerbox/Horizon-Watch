/* Horizon Watch â dossiers, analytics, briefing generation, document, replay. */
(function () {
  const D = window.HW, DOM = D.DOMAINS, SEV = D.SEV, S = window.HWS;
  const { $, $$, zulu, hhmm, ago, esc } = window.HWU;
  const on = (sel, ev, fn) => { const n = typeof sel === 'string' ? $(sel) : sel; if (n) n.addEventListener(ev, fn); };
  const M = { entity: D.entities[0].id, dossTab: 'overview', an: { range: 30, region: 'all', domain: 'all' },
    gen: { running: false, sel: new Set(), tone: 'Executive', horizon: '30 days', regions: 'Global' }, doc: null, rp: { group: 'region', t: 1, playing: false, speed: 4, sel: null } };

  /* âââââ DOSSIER âââââ */
  function entEvents(ent) {
    return D.events.filter(e => d3.geoDistance([ent.lon, ent.lat], [e.lon, e.lat]) * 6371 < 1400)
      .sort((a, b) => a.hoursAgo - b.hoursAgo);
  }
  function renderEntList() {
    $('#ent-count').textContent = D.entities.length + ' tracked';
    $('#ent-list').innerHTML = D.entities.map(e => `
      <button class="entrow" data-id="${e.id}" aria-selected="${e.id === M.entity}">
        <span class="code">${e.code}</span>
        <span class="n">${esc(e.name)}<br><span class="dim" style="font-size:11px">${e.type}</span></span>
        <span style="text-align:right"><span class="sc" style="color:${scoreColor(e.score)}">${e.score}</span>
        <br><span class="mono" style="font-size:9.5px;color:${e.delta > 0 ? '#b0645c' : e.delta < 0 ? '#6d9a83' : 'var(--txt-4)'}">${e.delta > 0 ? 'â²' : e.delta < 0 ? 'â¼' : 'Â·'}${Math.abs(e.delta) || ''}</span></span>
      </button>`).join('');
    $$('#ent-list .entrow').forEach(b => b.onclick = () => openEntity(b.dataset.id));
  }
  const scoreColor = s => s >= 80 ? '#c4453c' : s >= 60 ? '#b7822c' : s >= 40 ? '#4f7fa6' : '#6d7883';

  function openEntity(id) {
    M.entity = id; window.HWopen('dossier', 'Dossier Â· ' + D.entities.find(e => e.id === id).name);
    renderEntList(); renderDossier();
  }
  function openDossierNear(ev) {
    let best = D.entities[0], bd = 1e9;
    D.entities.forEach(e => { const d = d3.geoDistance([e.lon, e.lat], [ev.lon, ev.lat]); if (d < bd) { bd = d; best = e; } });
    openEntity(best.id);
  }

  function renderDossier() {
    const e = D.entities.find(x => x.id === M.entity), evs = entEvents(e);
    const ser = D.series(e.score, 30, e.score, 22);
    $('#doss-head').innerHTML = `
      <div style="display:flex;gap:22px;align-items:flex-start">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:9px;margin-bottom:6px">
            <span class="lbl">${e.code} Â· ${e.type}</span>
            <span class="tag ${e.delta > 0 ? 'red' : e.delta < 0 ? 'green' : ''}">${e.delta > 0 ? 'Deteriorating' : e.delta < 0 ? 'Improving' : 'Stable'}</span>
          </div>
          <h1>${esc(e.name)}</h1>
          <p class="muted" style="margin:8px 0 0;max-width:620px;font-size:12.5px;line-height:1.55">${esc(e.note)}</p>
          <div class="btnrow" style="margin-top:12px">
            <button class="btn primary sm" id="doss-brief"><svg><use href="#i-add-brief"/></svg> brief this entity</button>
            <button class="btn sm" id="doss-map">show exposure on map</button>
            <button class="btn sm" id="doss-watch"><svg><use href="#i-bell"/></svg> alerting on</button>
          </div>
        </div>
        <div style="display:flex;gap:18px;align-items:center">
          ${gauge(e.score)}
          <div>
            <div class="lbl" style="margin-bottom:5px">30-day index</div>
            ${spark(ser, 168, 42, '#8b96a0')}
            <div class="mono dim" style="font-size:10px;margin-top:4px">min ${Math.min(...ser)} Â· max ${Math.max(...ser)} Â· now ${e.score}</div>
          </div>
        </div>
      </div>`;
    on('#doss-brief', 'click', () => { window.HWbasket(evs.slice(0, 6).map(x => x.id)); window.HWopen('generate'); });
    on('#doss-map', 'click', () => { window.HWopen('map'); if (evs[0]) window.HWselect(evs[0].id, { pan: true }); });
    on('#doss-watch', 'click', () => { if (window.HWalerts) window.HWalerts.open(e); else window.HWtoast('Alerting unavailable', 'warn'); });

    const TABS = [['overview', 'Overview'], ['exposure', 'Exposure'], ['drivers', 'Risk drivers'], ['history', 'History'], ['links', 'Linked entities']];
    $('#doss-tabs').innerHTML = TABS.map(([k, l]) => `<button data-t="${k}" aria-selected="${M.dossTab === k}">${l}</button>`).join('');
    $$('#doss-tabs button').forEach(b => b.onclick = () => { M.dossTab = b.dataset.t; renderDossier(); });

    const body = $('#doss-body');
    if (M.dossTab === 'overview') {
      const byDom = d3.rollups(evs, v => v.length, d => d.domain).sort((a, b) => b[1] - a[1]);
      body.innerHTML = `
        <div class="sect"><span class="lbl">Exposure snapshot</span>
          <div class="statgrid">
            <div class="stat"><div class="v">${e.exposure.sites}</div><div class="lbl">fixed sites</div></div>
            <div class="stat"><div class="v">${e.exposure.staff}</div><div class="lbl">personnel</div></div>
            <div class="stat"><div class="v">${e.exposure.suppliers}</div><div class="lbl">suppliers in scope</div></div>
            <div class="stat"><div class="v">${e.exposure.revenue}</div><div class="lbl">revenue at risk</div></div>
            <div class="stat"><div class="v">${evs.length}</div><div class="lbl">signals Â· 30d</div></div>
            <div class="stat"><div class="v ${e.delta > 0 ? 'up' : 'down'}">${e.delta > 0 ? '+' : ''}${e.delta}</div><div class="lbl">index change</div></div>
          </div>
        </div>
        <div class="sect"><span class="lbl">Signal mix</span>
          ${byDom.map(([k, n]) => `<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">
            <i class="dia" style="background:${DOM[k].color}"></i>
            <span style="width:150px;font-size:12.5px">${DOM[k].name}</span>
            <div class="bar"><i style="width:${n / evs.length * 100}%;background:${DOM[k].color}"></i></div>
            <span class="mono dim" style="font-size:11px;width:18px;text-align:right">${n}</span></div>`).join('')}
        </div>
        <div class="sect" style="border:0"><span class="lbl">Analyst judgement</span>
          <div class="card" style="max-width:760px"><p>${esc(judgement(e, evs))}</p>
            <p class="dim" style="font-size:11.5px;margin:0">Confidence: ${evs.length > 4 ? 'moderate to high, multi-source' : 'low to moderate, thin sourcing'}. Next scheduled review in 7 days.</p></div>
        </div>`;
    } else if (M.dossTab === 'exposure') {
      body.innerHTML = `<div class="sect"><span class="lbl">Assets and dependencies inside the exposure ring</span>
        <table class="grid" style="margin-top:6px"><thead><tr><th>Dependency</th><th style="width:120px">Type</th><th style="width:120px">Substitutable</th><th style="width:140px">Single point of failure</th></tr></thead><tbody>
        ${dependencies(e).map(d => `<tr><td>${esc(d[0])}</td><td class="dim">${d[1]}</td><td>${d[2]}</td><td>${d[3] ? '<span class="tag red">Yes</span>' : '<span class="tag">No</span>'}</td></tr>`).join('')}
        </tbody></table></div>`;
    } else if (M.dossTab === 'drivers') {
      const drivers = [['Escalation of armed activity', 0.72], ['Route or corridor closure', 0.58], ['Regulatory or sanctions change', 0.41], ['Labour and civil action', 0.34], ['Infrastructure or cyber failure', 0.29]];
      body.innerHTML = `<div class="sect"><span class="lbl">Weighted drivers of the current index</span>
        ${drivers.map(([n, w]) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
          <span style="width:250px;font-size:12.5px">${n}</span>
          <div class="bar" style="height:6px"><i style="width:${w * 100}%;background:${w > .6 ? '#8d5348' : w > .4 ? '#7d6a45' : 'var(--grey)'}"></i></div>
          <span class="mono dim" style="font-size:11px;width:34px;text-align:right">${Math.round(w * 100)}%</span></div>`).join('')}
        <p class="dim" style="max-width:620px;font-size:12px;margin-top:14px">Weights are derived from the 30-day signal mix for this entity and reviewed weekly by the analyst on watch.</p></div>`;
    } else if (M.dossTab === 'history') {
      const ser = D.series(e.score + 3, 30, e.score, 26);
      body.innerHTML = `<div class="sect"><span class="lbl">Index, last 30 days</span>${area(ser, 860, 190)}</div>
        <div class="sect" style="border:0"><span class="lbl">Notable movements</span>
        <ul class="evlist" style="margin:0 -18px">${evs.slice(0, 8).map(window.HWrowHTML).join('')}</ul></div>`;
      window.HWbindRows(body);
    } else {
      body.innerHTML = `<div class="sect"><span class="lbl">Entities sharing exposure</span>
        ${D.entities.filter(x => x.id !== e.id).slice(0, 6).map(x => `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line-soft)">
            <span class="code mono dim" style="width:60px;font-size:10px">${x.code}</span>
            <span style="flex:1;font-size:12.5px">${esc(x.name)}</span>
            <span class="tag">${shared(e, x)} shared dependencies</span>
            <span class="sc mono" style="color:${scoreColor(x.score)}">${x.score}</span>
            <button class="btn ghost sm" data-go="${x.id}">open â</button></div>`).join('')}</div>`;
      $$('[data-go]', body).forEach(b => b.onclick = () => openEntity(b.dataset.go));
    }
    $('#doss-signals').innerHTML = evs.length
      ? `<ul class="evlist">${evs.map(window.HWrowHTML).join('')}</ul>`
      : `<div class="empty"><svg><use href="#i-search"/></svg><p>No signals within 1400km of this entity in the corpus.</p></div>`;
    window.HWbindRows($('#doss-signals'));
  }
  function judgement(e, evs) {
    const crit = evs.filter(x => x.severity === 'critical').length;
    return `${e.name} sits at ${e.score} on the exposure index, ${e.delta > 0 ? 'up' : e.delta < 0 ? 'down' : 'flat'} ${Math.abs(e.delta)} points over the fortnight. ` +
      `${evs.length} signals fall inside the exposure ring, ${crit} of them critical. ` +
      (crit ? 'Treat the corridor as constrained for planning purposes and hold the contingency routing in place.' : 'No change to continuity posture is warranted on current reporting.');
  }
  function dependencies(e) {
    const base = [['Primary transit route', 'Logistics', 'Partial', e.score > 75], ['Contracted carriers', 'Logistics', 'Yes', false],
      ['Tier-1 supplier cluster', 'Supply', 'Partial', e.exposure.suppliers > 50], ['Local workforce', 'People', 'No', e.exposure.staff > 100],
      ['Payment corridor', 'Finance', 'Yes', false], ['Network path / replication', 'IT', 'Partial', e.type === 'Infrastructure']];
    return base;
  }
  const shared = (a, b) => 1 + ((a.score + b.score) % 5);

  /* small charts */
  function gauge(score) {
    const r = 44, c = 2 * Math.PI * r, frac = score / 100;
    return `<div class="gauge"><svg width="104" height="104" viewBox="0 0 104 104">
      <circle cx="52" cy="52" r="${r}" fill="none" stroke="#333b43" stroke-width="6"/>
      <circle cx="52" cy="52" r="${r}" fill="none" stroke="${scoreColor(score)}" stroke-width="6" stroke-linecap="butt"
        stroke-dasharray="${c * frac} ${c}" transform="rotate(-90 52 52)"/></svg>
      <div class="val"><b>${score}</b><div class="lbl" style="font-size:8.5px">index</div></div></div>`;
  }
  function spark(data, w, h, color) {
    const x = d3.scaleLinear().domain([0, data.length - 1]).range([0, w]);
    const y = d3.scaleLinear().domain(d3.extent(data)).nice().range([h - 2, 2]);
    const line = d3.line().x((d, i) => x(i)).y(d => y(d)).curve(d3.curveMonotoneX);
    const ar = d3.area().x((d, i) => x(i)).y0(h).y1(d => y(d)).curve(d3.curveMonotoneX);
    return `<svg width="${w}" height="${h}" style="display:block"><path d="${ar(data)}" fill="${color}" opacity=".14"/>
      <path d="${line(data)}" fill="none" stroke="${color}" stroke-width="1.4"/></svg>`;
  }
  function area(data, w, h) {
    const x = d3.scaleLinear().domain([0, data.length - 1]).range([34, w - 8]);
    const y = d3.scaleLinear().domain([0, d3.max(data) * 1.15]).nice().range([h - 20, 8]);
    const line = d3.line().x((d, i) => x(i)).y(d => y(d)).curve(d3.curveMonotoneX);
    const ar = d3.area().x((d, i) => x(i)).y0(h - 20).y1(d => y(d)).curve(d3.curveMonotoneX);
    const ticks = y.ticks(4).map(t => `<g><line x1="34" x2="${w - 8}" y1="${y(t)}" y2="${y(t)}" stroke="#262c33"/>
      <text x="28" y="${y(t) + 3}" text-anchor="end" font-family="var(--mono)" font-size="9" fill="#616b75">${t}</text></g>`).join('');
    const xt = [0, 7, 14, 21, 29].map(i => `<text x="${x(i)}" y="${h - 6}" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="#616b75">D-${29 - i}</text>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">${ticks}
      <path d="${ar(data)}" fill="#3f6fa8" opacity=".13"/><path d="${line(data)}" fill="none" stroke="#7d97b3" stroke-width="1.3"/>${xt}</svg>`;
  }
  function donut(title, parts) {
    const total = d3.sum(parts, p => p.v), r = 40, ri = 26;
    const arcs = d3.pie().sort(null).value(d => d.v)(parts);
    const gen = d3.arc().innerRadius(ri).outerRadius(r).padAngle(.02);
    return `<div class="donut">
      <svg width="96" height="96" viewBox="-48 -48 96 96">${arcs.map((a, i) =>
        `<path d="${gen(a)}" fill="${parts[i].c}" opacity=".92"><title>${parts[i].k}: ${parts[i].v}</title></path>`).join('')}
        <text y="4" text-anchor="middle" font-family="var(--mono)" font-size="15" fill="#d5dae0">${total}</text></svg>
      <ul>${parts.map(p => `<li><i class="sw" style="background:${p.c}"></i>${esc(p.k)}<b>${p.v}</b></li>`).join('')}</ul></div>`;
  }

  /* âââââ ANALYTICS âââââ */
  function anEvents() {
    const days = M.an.range;
    return D.events.filter(e => e.hoursAgo <= days * 24 &&
      (M.an.region === 'all' || e.region === M.an.region) &&
      (M.an.domain === 'all' || e.domain === M.an.domain));
  }
  function renderAnalytics() {
    const evs = anEvents(), A = D.analytics;
    const n = M.an.range, vol = A.volume.slice(-Math.min(30, n));
    const kpis = [
      ['signals ingested', evs.length * 37, +12], ['assessed signals', evs.length, +4],
      ['critical open', evs.filter(e => e.severity === 'critical' && e.status !== 'ack').length, +2],
      ['countries touched', new Set(evs.map(e => e.iso3)).size, +3],
      ['corridors watched', 6, 0], ['briefings issued', 14, +1],
      ['mean time to brief', '3.4h', -1], ['escalations', evs.filter(e => e.status === 'esc').length, +1],
      ['sites in scope', 9, 0], ['suppliers flagged', 128, +9], ['personnel affected', 1241, +64], ['revenue at risk', '7.8%', +1]
    ];
    const bySev = Object.entries(SEV).sort((a, b) => b[1].rank - a[1].rank)
      .map(([k, v]) => ({ k: v.name, v: evs.filter(e => e.severity === k).length, c: v.color }));
    const byDom = Object.entries(DOM).map(([k, v]) => ({ k: v.name, v: evs.filter(e => e.domain === k).length, c: v.color })).filter(p => p.v);
    const byReg = ['EMEA', 'APAC', 'AMER'].map((r, i) => ({ k: r, v: evs.filter(e => e.region === r).length, c: ['#8d9aa4', '#69747e', '#4b5661'][i] }));
    const bySrc = D.SOURCES.map((s, i) => ({ k: s, v: evs.filter(e => e.source === s).length, c: ['#9aa5ae','#8b96a0','#7c8792','#6d7883','#5f6a74','#515c66','#444e58'][i] })).filter(p => p.v);

    const regions = ['EMEA', 'APAC', 'AMER'], doms = Object.keys(DOM);
    const maxCell = d3.max(regions.flatMap(r => doms.map(d => evs.filter(e => e.region === r && e.domain === d).length))) || 1;
    const heatScale = d3.scaleLinear().domain([0, maxCell]).range(['#232a30', '#5c6b78']);

    $('#an-dash').innerHTML = `
      <div class="kpistrip">${kpis.map(([l, v, d]) => `<div class="stat">
        <div class="v">${typeof v === 'number' ? v.toLocaleString() : v}
          <small class="${d > 0 ? 'up' : d < 0 ? 'down' : 'dim'}">${d > 0 ? 'â²' : d < 0 ? 'â¼' : 'Â·'}${Math.abs(d) || ''}</small></div>
        <div class="lbl">${l}</div></div>`).join('')}</div>

      <div class="panelbox"><header><span class="lbl">Signal volume Â· assessed vs ingested</span>
        <div class="right"><span class="mono dim" style="font-size:10.5px">${M.an.range}-day window</span></div></header>
        <div class="body">${area(vol, 1200, 210)}</div></div>

      <div class="donuts">
        <div class="panelbox"><header><span class="lbl">By severity</span></header><div class="body">${donut('sev', bySev)}</div></div>
        <div class="panelbox"><header><span class="lbl">By domain</span></header><div class="body">${donut('dom', byDom)}</div></div>
        <div class="panelbox"><header><span class="lbl">By region</span></header><div class="body">${donut('reg', byReg)}</div></div>
        <div class="panelbox"><header><span class="lbl">By source</span></header><div class="body">${donut('src', bySrc)}</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:12px">
        <div class="panelbox"><header><span class="lbl">Region Ã domain concentration</span></header>
          <div class="body"><div class="heat" style="grid-template-columns:70px repeat(${doms.length},1fr)">
            <div></div>${doms.map(d => `<div class="cl">${DOM[d].short}</div>`).join('')}
            ${regions.map(r => `<div class="rl">${r}</div>` + doms.map(d => {
              const v = evs.filter(e => e.region === r && e.domain === d).length;
              return `<div class="cell" style="background:${v ? heatScale(v) : '#1e242a'};color:${v > maxCell * .5 ? '#e2e7ec' : '#818c96'}" title="${r} Â· ${DOM[d].name}: ${v}">${v || ''}</div>`;
            }).join('')).join('')}
          </div></div></div>
        <div class="panelbox"><header><span class="lbl">Index movers Â· fortnight</span></header>
          <div class="body">${D.analytics.movers.map(m => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
            <i class="dia" style="background:${DOM[m.dom].color}"></i>
            <span style="flex:1;font-size:12.5px">${m.name}</span>
            <div class="bar" style="max-width:110px"><i style="width:${m.v}%;background:${scoreColor(m.v)}"></i></div>
            <span class="mono" style="font-size:11.5px;width:26px;text-align:right">${m.v}</span>
            <span class="mono" style="font-size:10.5px;width:30px;text-align:right;color:${m.d > 0 ? '#b0645c' : '#6d9a83'}">${m.d > 0 ? '+' : ''}${m.d}</span>
          </div>`).join('')}</div></div>
      </div>

      <div class="panelbox"><header><span class="lbl">Highest-severity signals in window</span>
        <div class="right"><button class="btn sm primary" id="an-brief"><svg><use href="#i-add-brief"/></svg> brief these</button></div></header>
        <div class="body" style="padding:0">
          <table class="grid"><thead><tr><th style="width:110px">Received</th><th style="width:100px">Severity</th><th>Signal</th><th style="width:160px">Location</th><th style="width:110px">Domain</th></tr></thead>
          <tbody>${evs.slice().sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank || a.hoursAgo - b.hoursAgo).slice(0, 8).map(e => `
            <tr data-id="${e.id}"><td class="mono dim" style="font-size:11px">${zulu(e.ts)}</td>
            <td><span class="sev" style="color:${SEV[e.severity].color}"><i class="dia" style="background:${SEV[e.severity].color}"></i>${SEV[e.severity].name}</span></td>
            <td class="title"><div>${esc(e.title)}</div></td><td>${esc(e.place)}</td>
            <td><span class="tag">${DOM[e.domain].short}</span></td></tr>`).join('')}
          </tbody></table></div></div>`;
    $$('#an-dash tbody tr[data-id]').forEach(tr => tr.onclick = () => { window.HWopen('map'); window.HWselect(tr.dataset.id, { pan: true }); });
    on('#an-brief', 'click', () => window.HWbasket(evs.slice().sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank).slice(0, 8).map(e => e.id)));
  }
  $$('#an-range button').forEach(b => b.onclick = () => {
    $$('#an-range button').forEach(x => x.setAttribute('aria-pressed', x === b));
    M.an.range = +b.dataset.r; renderAnalytics();
  });
  on('#an-region', 'change', ev => { M.an.region = ev.target.value === 'All regions' ? 'all' : ev.target.value; renderAnalytics(); });
  on('#an-domain', 'change', ev => { M.an.domain = ev.target.value; renderAnalytics(); });
  on('#an-export', 'click', () => window.HWtoast('CSV written to the analyst workspace', 'ok'));
  $('#an-domain').innerHTML = '<option value="all">All domains</option>' + Object.entries(DOM).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');

  /* âââââ GENERATOR âââââ */
  function renderGenForm() {
    $('#gen-form').innerHTML = `
      <div class="field"><label>Briefing title</label><input class="input" id="g-title" value="Weekly geopolitical exposure review"></div>
      <div class="field"><label>Scope</label><select class="input" id="g-scope"><option>Global</option><option>EMEA</option><option>APAC</option><option>AMER</option></select></div>
      <div class="field"><label>Audience</label><select class="input" id="g-aud"><option>Executive committee</option><option>Regional security leads</option><option>Board risk committee</option><option>Operations and logistics</option></select></div>
      <div class="field"><label>Forecast horizon</label>
        <div class="seg" style="width:100%"><button data-h="7 days" style="flex:1">7d</button><button data-h="30 days" aria-pressed="true" style="flex:1">30d</button><button data-h="90 days" style="flex:1">90d</button></div></div>
      <div class="field"><label>Sections</label>
        ${['Executive judgement', 'Signal-by-signal assessment', 'Exposure and continuity impact', 'Indicators and warnings', 'Recommended actions', 'Sourcing and method'].map((s, i) =>
          `<label class="check"><input type="checkbox" ${i < 6 ? 'checked' : ''} data-sec="${s}"><span>${s}</span></label>`).join('')}</div>
      <div class="field"><label>Classification</label><select class="input" id="g-class"><option>INTERNAL // RISK</option><option>RESTRICTED // EXEC</option><option>UNRESTRICTED</option></select></div>
      <div class="field"><label>Standing instruction</label>
        <textarea class="input" id="g-note" rows="3">Lead on corridor risk. Quantify continuity impact where the corpus supports it. No recommendations beyond the evidence set.</textarea></div>`;
    $$('#gen-form .seg button').forEach(b => b.onclick = () => {
      $$('#gen-form .seg button').forEach(x => x.setAttribute('aria-pressed', x === b)); M.gen.horizon = b.dataset.h;
    });
  }
  function renderEvidence() {
    S.basket.forEach(id => M.gen.sel.add(id));
    const list = D.events.slice().sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank || a.hoursAgo - b.hoursAgo);
    $('#gen-sel-count').textContent = M.gen.sel.size + ' selected';
    $('#gen-evidence').innerHTML = `<table class="grid"><thead><tr>
      <th style="width:34px"></th><th style="width:106px">Received</th><th style="width:100px">Severity</th><th>Signal</th><th style="width:150px">Location</th><th style="width:96px">Domain</th></tr></thead>
      <tbody>${list.map(e => `<tr data-id="${e.id}" aria-selected="${M.gen.sel.has(e.id)}">
        <td><label class="check" style="padding:0"><input type="checkbox" data-ck="${e.id}" ${M.gen.sel.has(e.id) ? 'checked' : ''}></label></td>
        <td class="mono dim" style="font-size:11px">${zulu(e.ts)}</td>
        <td><span class="sev" style="color:${SEV[e.severity].color}"><i class="dia" style="background:${SEV[e.severity].color}"></i>${SEV[e.severity].name}</span></td>
        <td class="title"><div>${esc(e.title)}</div></td><td>${esc(e.place)}, ${esc(e.country)}</td>
        <td><span class="tag">${DOM[e.domain].short}</span></td></tr>`).join('')}</tbody></table>`;
    $$('#gen-evidence input[data-ck]').forEach(ck => ck.onchange = () => {
      ck.checked ? M.gen.sel.add(ck.dataset.ck) : M.gen.sel.delete(ck.dataset.ck);
      $('#gen-sel-count').textContent = M.gen.sel.size + ' selected';
      ck.closest('tr').setAttribute('aria-selected', ck.checked);
    });
    $('#st-basket').textContent = S.basket.length;
  }
  const STEPS = [
    ['Resolve parameters and scope', 260],
    ['Assemble evidence set', 420],
    ['Deduplicate and cluster signals', 700],
    ['Score exposure against asset register', 820],
    ['Draft judgement and section text', 1400],
    ['Apply house style and classification', 520],
    ['Compile document and paginate', 480]
  ];
  function renderSteps(active) {
    $('#gen-steps').innerHTML = STEPS.map(([s], i) => {
      const cls = active === null ? '' : i < active ? 'done' : i === active ? 'run' : '';
      return `<li class="${cls}"><span class="ic">${cls === 'done' ? 'â' : cls === 'run' ? 'â ' : i + 1}</span><span>${s}</span><span class="t">${cls === 'done' ? (STEPS[i][1] / 1000).toFixed(2) + 's' : ''}</span></li>`;
    }).join('');
  }
  function log(html) { const l = $('#gen-log'); l.innerHTML += html + '\n'; l.scrollTop = l.scrollHeight; }

  function runGeneration() {
    if (M.gen.running) return;
    if (!M.gen.sel.size) return window.HWtoast('Select at least one signal for the evidence set', 'warn');
    M.gen.running = true;
    $('#gen-run').disabled = true; $('#gen-cancel').disabled = false; $('#gen-state').textContent = 'running';
    $('#gen-log').innerHTML = ''; $('#gen-prog i').style.width = '0%';
    const sel = Array.from(M.gen.sel).map(id => D.events.find(e => e.id === id));
    log(`<b>horizon-brief</b> v4.2 Â· session ${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
    log(`scope=${$('#g-scope').value.toLowerCase()} horizon=${M.gen.horizon} evidence=${sel.length} signals`);
    let i = 0;
    const tick = () => {
      if (!M.gen.running) return;
      if (i >= STEPS.length) return finish(sel);
      renderSteps(i);
      $('#gen-prog i').style.width = ((i + 1) / STEPS.length * 100) + '%';
      const notes = [
        () => log(`resolved ${sel.length} signals Â· ${new Set(sel.map(e => e.iso3)).size} countries Â· ${new Set(sel.map(e => e.domain)).size} domains`),
        () => sel.slice(0, 4).forEach(e => log(`  + ${e.id} <i>${e.place}</i> ${e.severity}`)),
        () => log(`clustered into ${Math.max(2, Math.round(sel.length / 3))} themes Â· dropped 0 duplicates`),
        () => log(`asset register matched Â· <u>${sel.reduce((a, e) => a + e.impacts.length, 0)} dependency hits</u>`),
        () => log(`drafted ${3 + Math.min(4, Math.ceil(sel.length / 4))} sections Â· ${1200 + sel.length * 90} words`),
        () => log(`style pass complete Â· classification ${$('#g-class').value}`),
        () => log(`<i>document compiled</i> Â· ${2 + Math.ceil(sel.length / 6)} pages`)
      ];
      notes[i] && notes[i]();
      const d = STEPS[i][1]; i++;
      setTimeout(tick, d);
    };
    tick();
  }
  function finish(sel) {
    M.gen.running = false; renderSteps(STEPS.length);
    $('#gen-run').disabled = false; $('#gen-cancel').disabled = true; $('#gen-state').textContent = 'complete';
    $('#gen-prog i').style.width = '100%';
    log(`<i>ready</i> â opening in the reader`);
    const ob = $('#gen-open-doc'); if (ob) ob.disabled = false;
    const db = $('#gen-dist'); if (db) db.disabled = false;
    const doc = buildBriefing(sel);
    D.briefings.unshift(doc.meta);
    M.doc = doc;
    window.HWtoast('Briefing ' + doc.meta.id + ' generated', 'ok');
    renderDoc();
    window.HWopen('reader', doc.meta.id + ' Â· ' + doc.meta.title);
    if (window.HWX && window.HWX.renderReader) window.HWX.renderReader();
  }
  on('#gen-run', 'click', runGeneration);
  on('#gen-open-doc', 'click', () => {
    if (!M.doc) return window.HWtoast('Generate a briefing first', 'warn');
    window.HWopen('doc', 'Print layout Â· ' + M.doc.meta.id); renderDoc();
  });
  on('#gen-cancel', 'click', () => { M.gen.running = false; $('#gen-run').disabled = false; $('#gen-cancel').disabled = true; $('#gen-state').textContent = 'cancelled'; log('<u>cancelled by operator</u>'); });
  on('#gen-pick-top', 'click', () => {
    D.events.slice().sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank || a.hoursAgo - b.hoursAgo).slice(0, 12).forEach(e => M.gen.sel.add(e.id));
    renderEvidence();
  });
  on('#gen-clear', 'click', () => { M.gen.sel.clear(); S.basket.length = 0; renderEvidence(); });

  /* âââââ DOCUMENT âââââ */
  function buildBriefing(sel) {
    const id = 'BRF-' + String(432 + D.briefings.length).padStart(4, '0');
    const title = $('#g-title').value || 'Geopolitical exposure review';
    const scope = $('#g-scope').value, aud = $('#g-aud').value, cls = $('#g-class').value;
    const sorted = sel.slice().sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank || a.hoursAgo - b.hoursAgo);
    const crit = sorted.filter(e => e.severity === 'critical'), high = sorted.filter(e => e.severity === 'high');
    const regions = d3.rollups(sorted, v => v.length, d => d.region).sort((a, b) => b[1] - a[1]);
    const domains = d3.rollups(sorted, v => v.length, d => d.domain).sort((a, b) => b[1] - a[1]);
    return {
      meta: { id, title, scope, ts: 'just now', status: 'draft', author: 'System agent', cls, aud, horizon: M.gen.horizon },
      sel: sorted, crit, high, regions, domains
    };
  }
  function renderDoc() {
    const d = M.doc;
    $('#doc-list').innerHTML = D.briefings.map(b => `<li><a href="#" class="briefrow" data-b="${b.id}">
      <b>${esc(b.title)}</b>
      <em>${b.id} Â· ${b.status}${b.ts ? ' Â· ' + b.ts : ''}</em></a></li>`).join('');
    $$('#doc-list a').forEach(a => a.onclick = ev => { ev.preventDefault(); openBriefing(a.dataset.b); });
    if (!d) {
      $('#doc-desk').innerHTML = `<div class="empty" style="color:var(--txt-3);padding:80px 20px">
        <svg><use href="#i-doc"/></svg><p>No briefing loaded. Generate one from an evidence set, or open one in the reader.</p>
        <button class="btn primary sm" id="doc-goto-gen">open generator</button></div>`;
      on('#doc-goto-gen', 'click', () => window.HWopen('generate'));
      $('#doc-toc').innerHTML = ''; $('#doc-id').textContent = 'â';
      return;
    }
    $('#doc-id').textContent = `${d.meta.id} Â· ${d.meta.cls} Â· ${d.sel.length} signals`;
    const now = new Date();
    const P = [];

    /* page 1 â cover + judgement */
    P.push(`<section class="docpage" id="pg1"><div class="stamp">${d.meta.cls}</div>
      <div class="kicker">Horizon Watch Â· intelligence briefing Â· ${d.meta.id}</div>
      <h1>${esc(d.meta.title)}</h1>
      <div class="docrule"></div>
      <table><tbody>
        <tr><th style="width:120px">Scope</th><td>${d.meta.scope}</td><th style="width:120px">Horizon</th><td>${d.meta.horizon}</td></tr>
        <tr><th>Audience</th><td>${d.meta.aud}</td><th>Issued</th><td class="mono">${zulu(now)}</td></tr>
        <tr><th>Evidence set</th><td>${d.sel.length} signals</td><th>Drafted by</th><td>${d.meta.author}, reviewed K. Almeida</td></tr>
      </tbody></table>
      <h2>Executive judgement</h2>
      <p class="lede">${esc(judgementText(d))}</p>
      <p>${esc(secondPara(d))}</p>
      <div class="callout"><b>Bottom line.</b> ${esc(bottomLine(d))}</div>
      <h2>Signals driving this assessment</h2>
      <table><thead><tr><th style="width:74px">Ref</th><th style="width:82px">Severity</th><th>Signal</th><th style="width:118px">Location</th></tr></thead>
      <tbody>${d.sel.slice(0, 9).map(e => `<tr><td class="mono">${e.id}</td>
        <td><span class="sevdot" style="background:${SEV[e.severity].color}"></span>${SEV[e.severity].name}</td>
        <td>${esc(e.title)}</td><td>${esc(e.place)}</td></tr>`).join('')}</tbody></table>
      <div class="pno"><span>${d.meta.cls}</span><span>${d.meta.id}</span><span>PAGE 1</span></div></section>`);

    /* page 2 â assessment by theme */
    const themes = d.domains.slice(0, 4);
    P.push(`<section class="docpage" id="pg2"><div class="stamp">${d.meta.cls}</div>
      <h2>Assessment by theme</h2>
      ${themes.map(([k, n]) => {
        const evs = d.sel.filter(e => e.domain === k);
        return `<h3>${DOM[k].name} Â· ${n} signal${n > 1 ? 's' : ''}</h3>
          <p>${esc(themePara(k, evs))}</p>
          <ul>${evs.slice(0, 3).map(e => `<li><span class="mono">${e.id}</span> Â· <b>${esc(e.place)}</b> â ${esc(e.summary.split('. ')[0])}.</li>`).join('')}</ul>`;
      }).join('')}
      <h2>Regional distribution</h2>
      <table><thead><tr><th>Region</th><th style="width:90px">Signals</th><th style="width:90px">Critical</th><th>Dominant theme</th></tr></thead>
      <tbody>${d.regions.map(([r, n]) => {
        const evs = d.sel.filter(e => e.region === r);
        const top = d3.rollups(evs, v => v.length, x => x.domain).sort((a, b) => b[1] - a[1])[0];
        return `<tr><td>${r}</td><td class="mono">${n}</td><td class="mono">${evs.filter(e => e.severity === 'critical').length}</td><td>${DOM[top[0]].name}</td></tr>`;
      }).join('')}</tbody></table>
      <div class="pno"><span>${d.meta.cls}</span><span>${d.meta.id}</span><span>PAGE 2</span></div></section>`);

    /* page 3 â exposure + I&W + actions */
    P.push(`<section class="docpage" id="pg3"><div class="stamp">${d.meta.cls}</div>
      <h2>Exposure and continuity impact</h2>
      <p>Dependencies touched by this evidence set, ordered by the number of signals that reference them.</p>
      <table><thead><tr><th>Dependency</th><th style="width:80px">Signals</th><th style="width:110px">Severity peak</th><th>Standing mitigation</th></tr></thead>
      <tbody>${impactRows(d).map(r => `<tr><td>${esc(r.name)}</td><td class="mono">${r.n}</td>
        <td><span class="sevdot" style="background:${SEV[r.peak].color}"></span>${SEV[r.peak].name}</td><td>${esc(r.mit)}</td></tr>`).join('')}</tbody></table>
      <h2>Indicators and warnings</h2>
      <ul>${warnings(d).map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      <h2>Recommended actions</h2>
      <table><thead><tr><th style="width:34px">#</th><th>Action</th><th style="width:130px">Owner</th><th style="width:78px">By</th></tr></thead>
      <tbody>${actions(d).map((a, i) => `<tr><td class="mono">${i + 1}</td><td>${esc(a[0])}</td><td>${a[1]}</td><td class="mono">${a[2]}</td></tr>`).join('')}</tbody></table>
      <h2>Sourcing and method</h2>
      <p>${d.sel.length} signals drawn from ${new Set(d.sel.map(e => e.source)).size} feeds over the reporting window. Mean confidence ${Math.round(d3.mean(d.sel, e => e.conf) * 100)}%. ${d.sel.filter(e => e.conf > .78).length} signals are multi-source. Severity is assigned on the Horizon Watch four-point scale and reviewed by the analyst on watch before issue. This briefing is generated from the console corpus and is illustrative, not live reporting.</p>
      <div class="pno"><span>${d.meta.cls}</span><span>${d.meta.id}</span><span>PAGE 3</span></div></section>`);

    if (window.HWappendix) P.push(window.HWappendix.page(d));
    $('#doc-desk').innerHTML = P.join('');
    $('#doc-toc').innerHTML = [['pg1', 'Executive judgement', '1'], ['pg1', 'Signals driving this assessment', '1'],
      ['pg2', 'Assessment by theme', '2'], ['pg2', 'Regional distribution', '2'], ['pg3', 'Exposure and continuity impact', '3'],
      ['pg3', 'Indicators and warnings', '3'], ['pg3', 'Recommended actions', '3'], ['pg3', 'Sourcing and method', '3']]
      .map(([p, t, n]) => `<li><a href="#" data-p="${p}"><span>${n}</span><span style="flex:1">${t}</span></a></li>`).join('');
    $$('#doc-toc a').forEach(a => a.onclick = ev => {
      ev.preventDefault();
      const el = $('#' + a.dataset.p), desk = $('#doc-desk');
      desk.scrollTo({ top: el.offsetTop - desk.offsetTop - 16, behavior: 'smooth' });
    });
  }
  function judgementText(d) {
    const top = d.crit[0] || d.high[0] || d.sel[0];
    const regs = d.regions.map(([r, n]) => `${r} (${n})`).join(', ');
    return `${d.sel.length} signals meet the reporting threshold for this cycle, ${d.crit.length} of them critical and ${d.high.length} high. ` +
      `Activity concentrates in ${regs}. The single most consequential development is ${top ? top.place + ': ' + lower(top.title) : 'unchanged'}. ` +
      `Over the next ${d.meta.horizon.replace(' days', ' days')} we assess corridor and routing risk as the binding constraint on operations, ahead of fixed-asset or personnel risk.`;
  }
  function secondPara(d) {
    const doms = d.domains.slice(0, 3).map(([k, n]) => `${lower(DOM[k].name)} (${n})`).join(', ');
    return `By theme the set is dominated by ${doms}. Confidence across the set averages ${Math.round(d3.mean(d.sel, e => e.conf) * 100)}%, with ${d.sel.filter(e => e.conf > .78).length} signals corroborated by more than one feed. Nothing in this cycle warrants a change to the group travel policy; two corridor mitigations already in force should remain in place.`;
  }
  function bottomLine(d) {
    return d.crit.length
      ? `Hold contingency routing and keep the ${d.crit[0].place} corridor under daily review. No new site-level measures are indicated by the evidence set.`
      : `No change to posture. Maintain weekly reporting cadence and the current mitigation set.`;
  }
  function themePara(k, evs) {
    const places = evs.slice(0, 3).map(e => e.place).join(', ');
    const worst = evs.slice().sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank)[0];
    return `${evs.length} signal${evs.length > 1 ? 's' : ''} in this theme, centred on ${places}. The severity peak is ${lower(SEV[worst.severity].name)}, set by ${worst.place}. ` +
      `Operationally the theme bears on ${Array.from(new Set(evs.flatMap(e => e.impacts))).slice(0, 3).map(lower).join(', ')}.`;
  }
  function impactRows(d) {
    const map = {};
    d.sel.forEach(e => e.impacts.forEach(i => {
      map[i] = map[i] || { name: i, n: 0, peak: 'low' };
      map[i].n++;
      if (SEV[e.severity].rank > SEV[map[i].peak].rank) map[i].peak = e.severity;
    }));
    const mits = ['Dual-sourced; 6 weeks cover', 'Contingency routing in force', 'Journey management plan active', 'Escrow and pre-payment terms', 'Alternate network path tested', 'Reviewed weekly by the regional lead'];
    return Object.values(map).sort((a, b) => b.n - a.n).slice(0, 8).map((r, i) => ({ ...r, mit: mits[i % mits.length] }));
  }
  function warnings(d) {
    const out = [];
    if (d.sel.some(e => e.domain === 'maritime')) out.push('A second interdiction or interference event in the same corridor inside seven days would move the corridor index above 90 and trigger the pre-agreed rerouting clause.');
    if (d.sel.some(e => e.domain === 'conflict')) out.push('Movement of front lines within 50km of a contracted facility, or a formal advisory change, requires an immediate duty-of-care review.');
    if (d.sel.some(e => e.domain === 'cyber')) out.push('A confirmed second subsea or terminal-system fault in the same basin would indicate deliberate action rather than accident.');
    if (d.sel.some(e => e.domain === 'trade')) out.push('Publication of a further designation round touching a tier-1 supplier would suspend two open purchase orders pending screening.');
    out.push('Any single signal at critical severity that remains uncorroborated after 24 hours should be downgraded rather than carried forward.');
    return out;
  }
  function actions(d) {
    const a = [
      ['Hold contingency routing on affected corridors through the horizon window', 'Logistics', 'D+0'],
      ['Re-run restricted-party screening against the vendor master', 'Compliance', 'D+3'],
      ['Confirm generator and fuel cover at sites inside active-conflict rings', 'Regional security', 'D+5'],
      ['Brief the executive committee on corridor cost exposure', 'Group security', 'D+7'],
      ['Review alerting thresholds for the two fastest-moving entities', 'Intelligence', 'D+10']
    ];
    return a.slice(0, d.sel.length > 6 ? 5 : 3);
  }
  const lower = s => s.charAt(0).toLowerCase() + s.slice(1);

  function openBriefing(id) {
    const meta = D.briefings.find(b => b.id === id);
    if (!meta) return;
    if (!M.doc || M.doc.meta.id !== id) {
      const sel = D.events.slice().sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank).slice(0, 10);
      M.doc = { meta: Object.assign({ cls: 'INTERNAL // RISK', aud: 'Executive committee', horizon: '30 days', author: meta.author }, meta),
        sel, crit: sel.filter(e => e.severity === 'critical'), high: sel.filter(e => e.severity === 'high'),
        regions: d3.rollups(sel, v => v.length, x => x.region).sort((a, b) => b[1] - a[1]),
        domains: d3.rollups(sel, v => v.length, x => x.domain).sort((a, b) => b[1] - a[1]) };
    }
    renderDoc();
    window.HWopen('reader', meta.id + ' Â· ' + meta.title);
    if (window.HWX && window.HWX.renderReader) window.HWX.renderReader();
  }
  on('#doc-back', 'click', () => {
    window.HWopen('reader', M.doc ? M.doc.meta.id + ' Â· ' + M.doc.meta.title : 'Briefings');
    if (window.HWX && window.HWX.renderReader) window.HWX.renderReader();
  });
  on('#doc-print', 'click', () => window.print());
  on('#doc-dist', 'click', () => { if (window.HWdist) window.HWdist.open(M.doc); else window.HWtoast('Distribution unavailable', 'warn'); });
  $$('#doc-zoom button').forEach(b => b.onclick = () => {
    $$('#doc-zoom button').forEach(x => x.setAttribute('aria-pressed', x === b));
    $$('.docpage').forEach(p => { p.style.transform = `scale(${b.dataset.z})`; p.style.transformOrigin = 'top center'; p.style.marginBottom = (22 * +b.dataset.z - (1 - +b.dataset.z) * 1056) + 'px'; });
  });

  /* âââââ REPLAY âââââ */
  function renderReplay() {
    const win = 72, now = Date.now(), t0 = now - win * 3600e3;
    const evs = D.events.filter(e => e.hoursAgo <= win);
    const groups = M.rp.group === 'region' ? ['EMEA', 'APAC', 'AMER']
      : M.rp.group === 'domain' ? Object.keys(DOM)
      : ['critical', 'high', 'moderate', 'low'];
    const keyOf = e => M.rp.group === 'region' ? e.region : M.rp.group === 'domain' ? e.domain : e.severity;
    const nameOf = g => M.rp.group === 'domain' ? DOM[g].name : M.rp.group === 'severity' ? SEV[g].name : g;
    const pos = e => ((e.ts.getTime() - t0) / (win * 3600e3)) * 100;

    $('#rp-ticks').innerHTML = d3.range(0, 13).map(i => {
      const t = new Date(t0 + i * (win / 12) * 3600e3);
      return `<div class="tk" style="left:${i / 12 * 100}%">${hhmm(t)}</div>`;
    }).join('');
    $('#rp-lanes').innerHTML = groups.map(g => {
      const items = evs.filter(e => keyOf(e) === g);
      return `<div class="lane"><div class="lname"><b>${nameOf(g)}</b><span class="lbl" style="font-size:9px">${items.length} signals</span></div>
        <div class="track" data-g="${g}">${items.map(e => `<i class="ev" data-id="${e.id}" title="${esc(e.title)}"
          style="left:${pos(e)}%;background:${SEV[e.severity].color}"></i>`).join('')}
        </div></div>`;
    }).join('') + `<div class="playhead-v" id="rp-head" style="left:calc(132px + (100% - 132px) * ${M.rp.t})"></div>`;
    $$('#rp-lanes .ev').forEach(n => n.onclick = () => { M.rp.sel = n.dataset.id; renderRpWindow(); $$('#rp-lanes .ev').forEach(x => x.classList.toggle('sel', x === n)); });
    applyHead();
  }
  function applyHead() {
    const win = 72, now = Date.now(), t0 = now - win * 3600e3;
    const cut = t0 + M.rp.t * win * 3600e3;
    $('#rp-head').style.left = `calc(132px + (100% - 132px) * ${M.rp.t})`;
    let shown = 0;
    $$('#rp-lanes .ev').forEach(n => {
      const e = D.events.find(x => x.id === n.dataset.id);
      const past = e.ts.getTime() > cut;
      n.classList.toggle('past', past);
      if (!past) shown++;
    });
    $('#rp-clock').textContent = zulu(new Date(cut));
    $('#rp-shown').textContent = shown + ' shown';
    $('#rp-scrub').value = Math.round(M.rp.t * 1000);
  }
  function renderRpWindow() {
    const win = 72, now = Date.now(), t0 = now - win * 3600e3, cut = t0 + M.rp.t * win * 3600e3;
    const recent = D.events.filter(e => e.hoursAgo <= win && e.ts.getTime() <= cut).sort((a, b) => b.ts - a.ts).slice(0, 12);
    const sel = M.rp.sel ? D.events.find(e => e.id === M.rp.sel) : null;
    $('#rp-window').innerHTML = (sel ? `<div class="detail" style="padding:12px 14px 6px">
        <div class="row"><span class="sev" style="color:${SEV[sel.severity].color}"><i class="dia" style="background:${SEV[sel.severity].color}"></i>${SEV[sel.severity].name}</span>
          <span class="mono dim" style="font-size:10.5px;margin-left:auto">${zulu(sel.ts)}</span></div>
        <h2 style="font-size:14px">${esc(sel.title)}</h2>
        <p class="muted" style="font-size:12px;line-height:1.55">${esc(sel.summary)}</p>
        <div class="btnrow"><button class="btn sm" id="rp-map">show on map</button><button class="btn sm primary" id="rp-add">add to briefing</button></div>
      </div>` : '') +
      `<div class="sect" style="border:0"><span class="lbl">Signals up to cursor</span>
        <ul class="evlist" style="margin:0 -18px">${recent.map(window.HWrowHTML).join('') || '<li class="dim" style="padding:8px 18px">Nothing before the cursor.</li>'}</ul></div>`;
    window.HWbindRows($('#rp-window'));
    on('#rp-map', 'click', () => { window.HWopen('map'); window.HWselect(sel.id, { pan: true }); });
    on('#rp-add', 'click', () => window.HWbasket([sel.id]));
  }
  let rpTimer = null;
  function play(on_) {
    M.rp.playing = on_;
    $('#rp-play').innerHTML = `<svg><use href="#i-${on_ ? 'pause' : 'play'}"/></svg>`;
    clearInterval(rpTimer);
    if (!on_) return;
    if (M.rp.t >= 1) M.rp.t = 0;
    rpTimer = setInterval(() => {
      M.rp.t += 0.0016 * M.rp.speed;
      if (M.rp.t >= 1) { M.rp.t = 1; play(false); }
      applyHead();
    }, 40);
  }
  on('#rp-play', 'click', () => play(!M.rp.playing));
  on('#rp-scrub', 'input', ev => { M.rp.t = +ev.target.value / 1000; applyHead(); renderRpWindow(); });
  $$('#rp-speed button').forEach(b => b.onclick = () => {
    $$('#rp-speed button').forEach(x => x.setAttribute('aria-pressed', x === b)); M.rp.speed = +b.dataset.s;
  });
  $$('#rp-group button').forEach(b => b.onclick = () => {
    $$('#rp-group button').forEach(x => x.setAttribute('aria-pressed', x === b));
    M.rp.group = b.dataset.g; renderReplay();
  });

  /* âââââ wiring âââââ */
  window.HWMdoc = { render: renderDoc, get doc() { return M.doc; }, openBriefing };
  window.HWMcore = { renderReplay: () => renderReplay(), renderRpWindow: () => renderRpWindow(), get rp() { return M.rp; }, get doc() { return M.doc; } };
  window.HWMdoc = { doc: () => M.doc, render: () => renderDoc() };
  window.HWM = {
    onModule(id) {
      if (id === 'dossier') { renderEntList(); renderDossier(); }
      if (id === 'analytics') renderAnalytics();
      if (id === 'generate') renderEvidence();
      if (id === 'doc') renderDoc();
      if (id === 'replay') { renderReplay(); renderRpWindow(); }
      if (id !== 'replay') play(false);
      (window.HWX && window.HWX.onModule) && window.HWX.onModule(id);
    },
    onResize() { if (S.module === 'replay') applyHead(); },
    renderEvidence, openEntity, openDossierNear, openBriefing
  };
  renderGenForm(); renderEntList();
})();
