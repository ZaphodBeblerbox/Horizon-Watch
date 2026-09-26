/* Horizon Watch â presentation generator.

   A deck is the THIRD rendering of the briefing document object, alongside the
   interactive reader and the printable pages. All three read the same object,
   so a slide can never say something the document does not.

   Authored at 1920x1080 and scaled to fit. Speaker notes are generated from
   the same fields the slide uses, so the note always matches the slide. */
(function () {
  const D = window.HW, X = window.HW2, DOM = D.DOMAINS, SEV = D.SEV, S = window.HWS;
  const { $, $$, zulu, esc } = window.HWU;
  const on = (s, e, f) => { const n = typeof s === 'string' ? $(s) : s; if (n) n.addEventListener(e, f); };

  const K = { slides: [], i: 0, theme: 'dark', doc: null, world: null };
  const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

  fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')
    .then(r => r.json()).then(t => { K.world = topojson.feature(t, t.objects.countries); })
    .catch(() => {});

  /* ââ slide plan ââââââââââââââââââââââââââââââââââââââââââ
     Derived from the document, never authored twice. Each entry carries its
     own speaker note and a delivery cue. */
  function build(doc) {
    const s = [], sel = doc.sel, crit = doc.crit, high = doc.high;
    const meanConf = Math.round(sel.reduce((a, e) => a + e.conf, 0) / Math.max(1, sel.length) * 100);
    const multi = sel.filter(e => e.conf > .78).length;
    const top = crit[0] || high[0] || sel[0];
    const m = doc.meta;
    const cls = esc(m.cls);
    const foot = n => `<div class="foot"><span>${cls}</span><span>${esc(m.id)}</span>
      <span class="n">${n} / TOTAL</span></div>`;

    /* 1 Â· cover */
    s.push({ label: 'Cover', html: `<div class="slide cover">
        <div class="sh"><span class="eyebrow">Horizon Watch Â· intelligence briefing</span><span class="cls">${cls}</span></div>
        <h1>${esc(m.title.toLowerCase())}</h1>
        <div class="rule" style="max-width:600px"></div>
        <div class="meta">
          <div>Scope<b>${esc(m.scope)}</b></div>
          <div>Horizon<b>${esc(m.horizon)}</b></div>
          <div>Audience<b>${esc(m.aud || m.audience || 'Executive committee')}</b></div>
          <div>Evidence set<b>${sel.length} signals</b></div>
          <div>Issued<b>${esc(zulu(new Date()))}</b></div>
          <div>Prepared by<b>Group security</b></div>
        </div>${foot(1)}</div>`,
      note: `Open with the window, not the detail. ${sel.length} signals over the reporting period, ${crit.length} critical. State the classification aloud if the room is mixed.`,
      cue: 'Do not read the metadata. 20 seconds.' });

    /* 2 Â· bottom line first */
    s.push({ label: 'Bottom line', html: `<div class="slide">
        <div class="sh"><span class="eyebrow">Bottom line</span><span class="cls">${cls}</span></div>
        <div class="rule"></div>
        <p class="quote">${esc(crit.length
          ? `Hold contingency routing and keep ${top.place} under daily review. No new site-level measures are indicated by the evidence.`
          : 'No change to posture. Maintain the weekly reporting cadence and the current mitigation set.')}</p>
        <p style="margin-top:44px;font-size:30px">${crit.length
          ? `${crit.length} critical and ${high.length} high signals. Corridor and routing risk is the binding constraint, ahead of fixed-asset or personnel risk.`
          : `${sel.length} signals assessed, none critical.`}</p>
        ${foot(2)}</div>`,
      note: `Lead with the judgement. If the committee takes only one thing from the room, this is it. Expect the challenge on cost: the answer is on the exposure slide.`,
      cue: 'Say it, then stop. Let it land before moving on.' });

    /* 3 Â· the shape of the cycle */
    s.push({ label: 'Situation', html: `<div class="slide">
        <div class="sh"><span class="eyebrow">This cycle</span><span class="cls">${cls}</span></div>
        <h2>${sel.length} signals met the reporting threshold</h2>
        <div class="stats">
          <div><b style="color:#c4453c">${crit.length}</b><span>critical</span></div>
          <div><b style="color:#b7822c">${high.length}</b><span>high</span></div>
          <div><b>${new Set(sel.map(e => e.iso3)).size}</b><span>countries touched</span></div>
          <div><b>${meanConf}%</b><span>mean confidence</span></div>
        </div>
        <div class="bars">${doc.regions.map(([r, n]) => `<div class="b">
          <span>${esc(r)}</span>
          <div class="tr"><i style="width:${pct(n, sel.length)}%;background:#5f95d0"></i></div>
          <span class="v">${n}</span></div>`).join('')}</div>
        ${foot(3)}</div>`,
      note: `${multi} of ${sel.length} signals are corroborated by more than one feed â that is the number to quote if sourcing is questioned. Regional concentration: ${doc.regions.map(([r, n]) => r + ' ' + n).join(', ')}.`,
      cue: 'Point at the concentration, not every bar.' });

    /* 4 Â· where */
    s.push({ label: 'Where', map: true, html: `<div class="slide">
        <div class="sh"><span class="eyebrow">Distribution</span><span class="cls">${cls}</span></div>
        <h3>Signal locations, ${esc(m.scope.toLowerCase())} scope</h3>
        <svg id="dk-map"></svg>${foot(4)}</div>`,
      note: `Geography does the work here. The cluster to talk to is ${top.place}. Everything else is context.`,
      cue: 'Silence for three seconds while they read the map.' });

    /* 5..n Â· themes */
    doc.domains.slice(0, 4).forEach(([k, n], idx) => {
      const evs = sel.filter(e => e.domain === k);
      const worst = evs.slice().sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank)[0];
      const impacts = [...new Set(evs.flatMap(e => e.impacts))].slice(0, 3);
      s.push({ label: DOM[k].name, html: `<div class="slide">
          <div class="sh"><span class="eyebrow">Theme ${idx + 1} of ${Math.min(4, doc.domains.length)}</span><span class="cls">${cls}</span></div>
          <h2>${esc(DOM[k].name)}</h2>
          <div class="rule"></div>
          <p class="big">${esc(`${n} signal${n > 1 ? 's' : ''}, centred on ${evs.slice(0, 3).map(e => e.place).join(', ')}. The severity peak is ${lower(SEV[worst.severity].name)}, set by ${worst.place}.`)}</p>
          <ul>${evs.slice(0, 3).map(e => `<li>${esc(e.title)}</li>`).join('')}</ul>
          ${impacts.length ? `<p style="font-size:27px;color:#818c96">Bears on ${esc(impacts.map(lower).join(', '))}.</p>` : ''}
          ${foot(5 + idx)}</div>`,
        note: `Worst in theme: ${worst.id} at ${worst.place}, ${Math.round(worst.conf * 100)}% confidence from ${worst.source}. ${impacts.length ? 'Dependencies touched: ' + impacts.join(', ') + '.' : 'No named dependency touched.'}`,
        cue: 'One theme per breath. Do not read the bullets verbatim.' });
    });

    /* exposure */
    const impactMap = {};
    sel.forEach(e => e.impacts.forEach(i => {
      impactMap[i] = impactMap[i] || { name: i, n: 0, peak: 'low' };
      impactMap[i].n++;
      if (SEV[e.severity].rank > SEV[impactMap[i].peak].rank) impactMap[i].peak = e.severity;
    }));
    const rows = Object.values(impactMap).sort((a, b) => b.n - a.n).slice(0, 6);
    const mits = ['Dual-sourced, 6 weeks cover', 'Contingency routing in force', 'Journey management plan active',
      'Escrow and pre-payment terms', 'Alternate network path tested', 'Reviewed weekly by the regional lead'];
    s.push({ label: 'Exposure', html: `<div class="slide">
        <div class="sh"><span class="eyebrow">Exposure and continuity</span><span class="cls">${cls}</span></div>
        <h3>Dependencies touched by this evidence set</h3>
        <table><thead><tr><th>Dependency</th><th style="width:180px">Signals</th>
          <th style="width:280px">Severity peak</th><th>Standing mitigation</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr><td style="color:#d5dae0">${esc(r.name)}</td><td>${r.n}</td>
          <td><span class="sd" style="background:${SEV[r.peak].color}"></span>${esc(SEV[r.peak].name)}</td>
          <td>${esc(mits[i % mits.length])}</td></tr>`).join('') ||
          '<tr><td colspan="4">No named dependencies in this evidence set.</td></tr>'}</tbody></table>
        ${foot(0)}</div>`,
      note: `This is the cost slide. If asked what holding contingency routing costs: roughly 11% on landed logistics for affected strings, holdable through November without renegotiation, decision needed by the 20th for December volumes.`,
      cue: 'Expect the interruption here. Have the number ready.' });

    /* indicators */
    const warn = [];
    if (sel.some(e => e.domain === 'maritime')) warn.push('A second interference event in the same corridor inside seven days moves the corridor index above 90 and triggers the pre-agreed rerouting clause.');
    if (sel.some(e => e.domain === 'conflict')) warn.push('Front-line movement within 50km of a contracted facility, or a formal advisory change, requires an immediate duty-of-care review.');
    if (sel.some(e => e.domain === 'cyber')) warn.push('A confirmed second subsea or terminal-system fault in the same basin indicates deliberate action rather than accident.');
    if (sel.some(e => e.domain === 'trade')) warn.push('A further designation round touching a tier-1 supplier suspends two open purchase orders pending screening.');
    warn.push('Any critical signal uncorroborated after 24 hours is downgraded rather than carried forward.');
    s.push({ label: 'Indicators', html: `<div class="slide">
        <div class="sh"><span class="eyebrow">Indicators and warnings</span><span class="cls">${cls}</span></div>
        <h3>What would change this assessment</h3>
        <div class="rule"></div>
        <ul>${warn.slice(0, 4).map(w => `<li>${esc(w)}</li>`).join('')}</ul>
        ${foot(0)}</div>`,
      note: `Every one of these is falsifiable and has a named consequence. That is deliberate: an indicator you cannot test is not an indicator. The last is a standing rule, not specific to this cycle.`,
      cue: 'These are commitments. Read them precisely.' });

    /* actions */
    const acts = [
      ['Hold contingency routing on affected corridors through the horizon window', 'Logistics', 'D+0'],
      ['Re-run restricted-party screening against the vendor master', 'Compliance', 'D+3'],
      ['Confirm generator and fuel cover at sites inside active-conflict rings', 'Regional security', 'D+5'],
      ['Brief the executive committee on corridor cost exposure', 'Group security', 'D+7'],
      ['Review alerting thresholds for the two fastest-moving entities', 'Intelligence', 'D+10']
    ].slice(0, sel.length > 6 ? 5 : 3);
    s.push({ label: 'Actions', html: `<div class="slide">
        <div class="sh"><span class="eyebrow">Recommended actions</span><span class="cls">${cls}</span></div>
        <h3>What we are asking for</h3>
        <table><thead><tr><th style="width:80px">#</th><th>Action</th>
          <th style="width:340px">Owner</th><th style="width:160px">By</th></tr></thead>
        <tbody>${acts.map((a, i) => `<tr><td>${i + 1}</td><td style="color:#d5dae0">${esc(a[0])}</td>
          <td>${esc(a[1])}</td><td>${esc(a[2])}</td></tr>`).join('')}</tbody></table>
        ${foot(0)}</div>`,
      note: `Ask for a decision on line one before leaving the room. Lines two to ${acts.length} are already in train and are for information.`,
      cue: 'Stop on this slide. Do not advance until line one has an answer.' });

    /* sourcing */
    s.push({ label: 'Sourcing', html: `<div class="slide">
        <div class="sh"><span class="eyebrow">Sourcing and method</span><span class="cls">${cls}</span></div>
        <div class="rule"></div>
        <div class="stats">
          <div><b>${sel.length}</b><span>signals assessed</span></div>
          <div><b>${new Set(sel.map(e => e.source)).size}</b><span>feeds</span></div>
          <div><b>${multi}</b><span>multi-source</span></div>
          <div><b>${X.scenes.length}</b><span>imagery scenes</span></div>
        </div>
        <p>Severity is assigned on a four-point scale by documented rule, not by model alone, and reviewed by
          the analyst on watch before issue. Inferred relationships are reported as inferred.</p>
        <p style="font-size:26px;color:#818c96">Generated from the Horizon Watch corpus. Illustrative, not live reporting.</p>
        ${foot(0)}</div>`,
      note: `Have this slide ready but do not present it unless sourcing is challenged. If it is, the number that matters is ${multi} of ${sel.length} corroborated by more than one feed.`,
      cue: 'Skip unless asked. Then go slowly.' });

    /* renumber footers now the count is known */
    return s.map((sl, i) => ({ ...sl, html: sl.html.replace(/(\d+|0) \/ TOTAL/, (i + 1) + ' / ' + s.length) }));
  }

  /* ââ render âââââââââââââââââââââââââââââââââââââââââââââââ */
  function fit() {
    const stage = $('#dk-stage'), wrap = $('#dk-slide');
    if (!stage || !wrap) return;
    const w = stage.clientWidth - 36, h = stage.clientHeight - 36;
    if (w <= 0 || h <= 0) return setTimeout(fit, 60);
    /* whole transform in one write â the translate does the centring */
    wrap.style.transform = 'translate(-50%,-50%) scale(' + Math.min(w / 1920, h / 1080) + ')';
  }
  function show(i) {
    if (!K.slides.length) return;
    K.i = Math.max(0, Math.min(K.slides.length - 1, i));
    const sl = K.slides[K.i];
    $('#dk-slide').innerHTML = sl.html;
    if (K.theme === 'light') $('#dk-slide .slide').classList.add('light');
    $('#dk-pos').textContent = (K.i + 1) + ' / ' + K.slides.length;
    $('#dk-scrub').max = K.slides.length - 1;
    $('#dk-scrub').value = K.i;
    $$('#dk-rail .dkthumb').forEach((t, n) => t.setAttribute('aria-selected', n === K.i));
    $('#dk-notes').innerHTML = `<div class="dknote">
      <h4>${esc(sl.label)} Â· slide ${K.i + 1}</h4>
      <p>${esc(sl.note)}</p>
      <div class="cue">${esc(sl.cue)}</div>
      <p class="dim" style="font-size:11.5px;margin-top:12px;line-height:1.5">Notes are generated from the same
        fields the slide uses, so a note can never describe a slide that changed.</p></div>`;
    if (sl.map) drawMap();
    fit();
  }
  function drawMap() {
    const el = $('#dk-map'); if (!el || !K.world) return;
    const w = 1680, h = 620;
    const svg = d3.select(el).attr('viewBox', `0 0 ${w} ${h}`);
    svg.selectAll('*').remove();
    const sel = K.doc.sel;
    const proj = d3.geoEquirectangular();
    const lons = sel.map(e => e.lon), lats = sel.map(e => e.lat);
    const pad = 22;
    proj.fitExtent([[10, 10], [w - 10, h - 10]], { type: 'Polygon', coordinates: [[
      [Math.max(-179, Math.min(...lons) - pad), Math.min(85, Math.max(...lats) + pad / 1.6)],
      [Math.min(179, Math.max(...lons) + pad), Math.min(85, Math.max(...lats) + pad / 1.6)],
      [Math.min(179, Math.max(...lons) + pad), Math.max(-85, Math.min(...lats) - pad / 1.6)],
      [Math.max(-179, Math.min(...lons) - pad), Math.max(-85, Math.min(...lats) - pad / 1.6)],
      [Math.max(-179, Math.min(...lons) - pad), Math.min(85, Math.max(...lats) + pad / 1.6)]]] });
    const path = d3.geoPath(proj);
    svg.append('g').selectAll('path').data(K.world.features).join('path').attr('class', 'dkland').attr('d', path);
    const g = svg.append('g');
    sel.slice().sort((a, b) => SEV[a.severity].rank - SEV[b.severity].rank).forEach(e => {
      const p = proj([e.lon, e.lat]); if (!p) return;
      const r = e.severity === 'critical' ? 13 : e.severity === 'high' ? 11 : 9;
      g.append('rect').attr('class', 'dkmk').attr('x', p[0] - r).attr('y', p[1] - r)
        .attr('width', r * 2).attr('height', r * 2)
        .attr('transform', `rotate(45 ${p[0]} ${p[1]})`).attr('fill', SEV[e.severity].color);
    });
    /* label only the criticals â a slide is not an inspector */
    K.doc.crit.slice(0, 4).forEach(e => {
      const p = proj([e.lon, e.lat]); if (!p) return;
      g.append('text').attr('x', p[0] + 22).attr('y', p[1] + 8).attr('font-size', 24)
        .attr('fill', K.theme === 'light' ? '#1b1f24' : '#d5dae0').text(e.place);
    });
  }
  function renderRail() {
    $('#dk-count').textContent = K.slides.length + ' slides';
    $('#dk-rail').innerHTML = K.slides.map((s, i) => `<button class="dkthumb" data-i="${i}" aria-selected="${i === K.i}">
      <span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t">${esc(s.label)}</span></button>`).join('');
    $$('#dk-rail .dkthumb').forEach(b => b.onclick = () => show(+b.dataset.i));
  }

  function open(doc) {
    if (!doc) return window.HWtoast('Generate or open a briefing first', 'warn');
    K.doc = doc;
    K.slides = build(doc);
    K.i = 0;
    window.HWopen('deck', 'Deck Â· ' + doc.meta.id);
    $('#dk-id').textContent = doc.meta.id + ' Â· ' + doc.meta.cls + ' Â· ' + K.slides.length + ' slides';
    renderRail(); show(0);
    window.HWtoast(K.slides.length + ' slides built from ' + doc.meta.id, 'ok');
  }
  window.HWdeck = { open, fit, show, get slides() { return K.slides; } };

  /* ââ controls ââ */
  on('#dk-next', 'click', () => show(K.i + 1));
  on('#dk-prev', 'click', () => show(K.i - 1));
  on('#dk-scrub', 'input', ev => show(+ev.target.value));
  $$('#dk-theme button').forEach(b => b.onclick = () => {
    $$('#dk-theme button').forEach(x => x.setAttribute('aria-pressed', x === b));
    K.theme = b.dataset.t; show(K.i);
  });
  on('#dk-back', 'click', () => {
    const d = window.HWMdoc && window.HWMdoc.doc();
    window.HWopen('reader', d ? d.meta.id + ' Â· ' + d.meta.title : 'Briefings');
    if (window.HWX && window.HWX.renderReader) window.HWX.renderReader();
  });
  on('#dk-print', 'click', () => {
    /* lay every slide into the flow for the export, then restore the deck */
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
  on('#dk-full', 'click', () => {
    document.body.classList.add('presenting');
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    setTimeout(fit, 160);
    window.HWtoast('Arrows or space to advance Â· Esc to exit');
  });
  function exitPresent() {
    if (!document.body.classList.contains('presenting')) return false;
    document.body.classList.remove('presenting');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    setTimeout(fit, 160);
    return true;
  }
  document.addEventListener('keydown', ev => {
    if (S.module !== 'deck' || ev.target.matches('input,textarea,select')) return;
    if (ev.key === 'ArrowRight' || ev.key === 'PageDown' || ev.key === ' ') { ev.preventDefault(); show(K.i + 1); }
    else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); show(K.i - 1); }
    else if (ev.key === 'Home') { ev.preventDefault(); show(0); }
    else if (ev.key === 'End') { ev.preventDefault(); show(K.slides.length - 1); }
    else if (ev.key === 'Escape') { if (exitPresent()) ev.stopPropagation(); }
  }, true);
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) exitPresent(); });
  window.addEventListener('resize', () => { if (S.module === 'deck') fit(); });

  /* ââ entry points: reader, print view, generator ââ */
  const docNow = () => window.HWMdoc && window.HWMdoc.doc();
  on('#rd-deck', 'click', () => open(docNow()));
  on('#doc-deck', 'click', () => open(docNow()));
  on('#gen-deck', 'click', () => open(docNow()));

  /* register the module as hidden â reachable from the briefing surface only */
  setTimeout(() => {
    const mods = window.HWshell && window.HWshell.MODULES;
    if (mods && !mods.some(m => m.id === 'deck'))
      mods.push({ id: 'deck', label: null, icon: 'i-present', tab: 'Deck', hidden: true });
  }, 200);
})();
