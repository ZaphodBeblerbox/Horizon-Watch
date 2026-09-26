/* Horizon Watch â mobile companion, v3.
   Horizon Watch on the go: the five things an on-call lead actually does.
   Shares the console corpus (hw-data / hw-data2 / hw-data3) and its visual
   vocabulary, at phone scale with 44px targets.

   Offline discipline: d3 and topojson load AFTER the app, asynchronously, with
   a timeout and mirrors. ONLY the Map tab may depend on them â Now, Signals,
   Brief and Desk use plain arithmetic so the app works with no network. */
(function () {
  const D = window.HW, X = window.HW2, W = window.HW3, DOM = D.DOMAINS, SEV = D.SEV;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const pad = n => String(n).padStart(2, '0');
  const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const zulu = d => `${pad(d.getUTCDate())}${MON[d.getUTCMonth()]} ${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
  const hhmm = d => `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
  const ago = h => h < 1 ? 'now' : h < 24 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* no d3 dependency in the non-map tabs */
  const mean = (a, f) => a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0;
  const countBy = (a, f) => { const m = new Map(); a.forEach(x => { const k = f(x); m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()]; };
  const haversine = (a, b) => { const R = 6371, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s)); };

  const me = () => W.users.find(u => u.id === W.me) || W.users[0];
  const user = id => W.users.find(u => u.id === id) || { name: 'Unknown', initials: '??', color: '#6d7883' };
  const avatar = (id, cls) => { const u = user(id);
    return `<span class="av ${cls || ''}" style="background:${u.color}">${u.initials}</span>`; };

  const TABS = [
    { id: 'now', label: 'Now', icon: 'm-now' },
    { id: 'signals', label: 'Signals', icon: 'm-alert' },
    { id: 'map', label: 'Map', icon: 'm-globe' },
    { id: 'brief', label: 'Brief', icon: 'm-read' },
    { id: 'desk', label: 'Desk', icon: 'm-desk' }
  ];

  const S = {
    tab: 'now', filter: 'open', dismissed: [],
    map: { signals: true, vessels: true, aircraft: false, sanctioned: false, areas: true, sel: null },
    noteRef: '',
    outbox: [{ kind: 'text', to: 'Duty desk', ts: '02SEP 0714Z', state: 'sent',
      body: 'Confirmed the Lviv office is outside the affected oblasts. No action needed tonight.' }]
  };

  /* on-call scope: only what needs a decision */
  const queue = () => D.events
    .filter(e => e.status === 'esc' || e.severity === 'critical' || e.severity === 'high')
    .sort((a, b) => (SEV[b.severity].rank - SEV[a.severity].rank) || (a.hoursAgo - b.hoursAgo));
  const openCount = () => queue().filter(e => e.status !== 'ack').length;
  const mine = () => W.assignments.filter(a => a.to === W.me && a.state === 'open');
  const myRfis = () => W.rfis.filter(r => r.status === 'open' && r.to === W.me);
  const myMentions = () => W.notifications.filter(n => n.kind === 'mention' && !n.read);
  const urgentMail = () => W.mail.filter(m => m.urgent && m.unread);
  const myCases = () => W.cases.filter(c => c.status !== 'closed' &&
    (c.owner === W.me || (c.watchers || []).includes(W.me)));

  /* the urgent interrupt â same idea as the console inspector */
  function urgent() {
    const out = [];
    urgentMail().forEach(m => out.push({ id: 'mail:' + m.id, icon: 'm-mail', ts: ago(m.hoursAgo),
      text: m.fromName + ' â ' + m.subject, go: () => openMail(m) }));
    myMentions().forEach(n => out.push({ id: n.id, icon: 'm-comment', ts: n.ts.split(' ')[1] || n.ts,
      text: n.text, go: () => openRefStr(n.ref) }));
    myRfis().forEach(r => out.push({ id: 'rfi:' + r.id, icon: 'm-rfi', ts: 'due ' + r.due,
      text: r.id + ' awaiting your answer', go: () => openRFI(r) }));
    return out.filter(i => !S.dismissed.includes(i.id));
  }

  /* ââ shell ââ */
  function renderTabs() {
    const u = urgent().length, q = openCount();
    $('#tabbar').innerHTML = TABS.map(t => {
      const n = t.id === 'now' ? u : t.id === 'signals' ? q : 0;
      const soft = t.id === 'signals';
      return `<button data-t="${t.id}" aria-selected="${S.tab === t.id}">
        <svg><use href="#${t.icon}"/></svg><i>${t.label}</i>
        ${n ? `<span class="badge${soft ? ' soft' : ''}">${n}</span>` : ''}</button>`;
    }).join('');
    $$('#tabbar button').forEach(b => b.onclick = () => go(b.dataset.t));
  }
  function go(id) {
    S.tab = id;
    $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + id));
    $('#screen').style.display = id === 'map' ? 'none' : '';
    renderTabs();
    if (id === 'now') renderNow();
    if (id === 'signals') renderSignals();
    if (id === 'brief') renderBrief();
    if (id === 'desk') renderDesk();
    if (id === 'map') { initMap(); sizeMap(); drawMap(); }
    $('#screen').scrollTop = 0;
  }
  let tt = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2800);
  }

  /* live strip â the console's status bar, phone-sized */
  let ingest = 124;
  function renderStrip() {
    const q = queue(), crit = D.events.filter(e => e.severity === 'critical').length;
    ingest = 118 + Math.floor(Math.random() * 24);
    $('#strip').innerHTML = `
      <span><i class="pulse${urgent().length ? ' warn' : ''}"></i>${urgent().length ? 'needs you' : 'clear'}</span>
      <span>Corpus <b>${D.events.length}</b></span>
      <span>Critical <b>${crit}</b></span>
      <span>Queue <b>${openCount()}</b></span>
      <span>Ingest <b>${ingest}</b>/min</span>
      <span>Feeds <b>7</b></span>
      <span>Sync <b>${hhmm(new Date())}</b></span>`;
  }

  /* ââ sheet ââ */
  function openSheet(html) {
    $('#sheetbody').innerHTML = html;
    $('#sheet').classList.add('on'); $('#scrim').classList.add('on');
  }
  const closeSheet = () => { $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); };
  $('#scrim').onclick = closeSheet;

  /* âââââ 1 Â· NOW âââââ */
  function renderNow() {
    const q = queue(), u = urgent();
    const crit = q.filter(e => e.severity === 'critical');
    const last24 = D.events.filter(e => e.hoursAgo <= 24);
    const byReg = countBy(last24, e => e.region).sort((a, b) => b[1] - a[1]);
    /* 12 two-hour buckets over the last 24h */
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const lo = (11 - i) * 2, hi = lo + 2;
      const inB = last24.filter(e => e.hoursAgo >= lo && e.hoursAgo < hi);
      return { n: inB.length, hot: inB.some(e => SEV[e.severity].rank >= 3) };
    });
    const maxB = Math.max(1, ...buckets.map(b => b.n));

    $('#view-now').innerHTML = `
      ${u.length ? `<div class="interrupt">
        <div class="ih"><svg><use href="#m-alert"/></svg><b>Needs you Â· ${u.length}</b>
          <button class="x" id="int-clear">â</button></div>
        ${u.slice(0, 4).map((i, n) => `<button class="irow" data-u="${n}">
          <svg><use href="#${i.icon}"/></svg>
          <span class="n">${esc(i.text.length > 74 ? i.text.slice(0, 72) + 'â¦' : i.text)}</span>
          <span class="t">${esc(i.ts)}</span></button>`).join('')}
      </div>` : ''}

      <div class="sechead"><b>Posture</b><span>${me().shift}</span></div>
      <div class="ledger">
        <div><b>${q.length}</b><span>need a decision</span></div>
        <div><b style="color:var(--red)">${crit.length}</b><span>critical open</span></div>
        <div><b>${new Set(last24.map(e => e.iso3)).size}</b><span>countries Â· 24h</span></div>
        <div><b>${Math.round(mean(last24, e => e.conf) * 100)}%</b><span>mean confidence</span></div>
      </div>

      <div class="sechead"><b>Last 24 hours</b><span>${last24.length} signals</span></div>
      <div class="sparkbar">${buckets.map(b =>
        `<i class="${b.hot ? 'hot' : ''}" style="height:${Math.max(8, b.n / maxB * 100)}%"></i>`).join('')}</div>
      <div class="bars">${byReg.map(([r, n]) => `<div class="b"><span>${esc(r)}</span>
        <div class="tr"><i style="width:${n / last24.length * 100}%;background:#5f95d0"></i></div>
        <span class="v">${n}</span></div>`).join('')}</div>

      <div class="sechead"><b>My work</b><span>${mine().length + myRfis().length} open</span></div>
      ${mine().map(a => { const e = D.events.find(x => 'sig:' + x.id === a.ref);
        return `<button class="arow" data-ref="${esc(a.ref)}">
          ${e ? `<i class="dia" style="background:${SEV[e.severity].color}"></i>`
              : `<svg style="width:12px;height:12px;color:var(--txt-4);margin-top:4px"><use href="#m-work"/></svg>`}
          <div><h4>${esc(refLabel(a.ref))}</h4>
            <div class="m"><span class="mono">${esc(a.ref.split(':')[1])}</span>
              <span>from ${esc(user(a.by).name.split(' ')[1])}</span></div></div>
          <span class="t">${esc(a.due)}</span></button>`; }).join('')}
      ${myRfis().map(r => `<button class="arow" data-rfi="${r.id}">
        <svg style="width:12px;height:12px;color:var(--amber);margin-top:4px"><use href="#m-rfi"/></svg>
        <div><h4>${esc(r.question.slice(0, 84))}</h4>
          <div class="m"><span class="mono">${r.id}</span><span>from ${esc(user(r.from).name.split(' ')[1])}</span></div></div>
        <span class="t">${esc(r.due)}</span></button>`).join('')}
      ${!mine().length && !myRfis().length
        ? '<p class="caption" style="padding-top:0">Nothing assigned to you.</p>' : ''}

      <div class="sechead"><b>My cases</b><span>${myCases().length}</span></div>
      ${myCases().map(c => { const col = c.priority === 'critical' ? '#c4453c'
          : c.priority === 'high' ? '#b7822c' : '#4f7fa6';
        const n = Object.values(c.records).reduce((a, v) => a + (v || []).length, 0);
        return `<button class="arow" data-case="${c.id}">
          <i class="dia" style="background:${col}"></i>
          <div><h4>${esc(c.title)}</h4>
            <div class="m"><span class="mono">${c.code}</span><span>${n} records</span>
              <span class="tag ${c.status === 'review' ? 'amber' : ''}">${c.status}</span></div></div>
          <span class="t">${esc(c.due)}</span></button>`; }).join('')}

      <div class="sechead"><b>Newest critical</b></div>
      ${crit.slice(0, 3).map(rowHTML).join('') ||
        '<p class="caption" style="padding-top:0">No critical signals in the corpus.</p>'}
      <p class="caption">Sample corpus, not live reporting. Everything here mirrors the desk;
        acknowledging or answering on the phone clears it there too.</p>`;

    const u2 = urgent();
    $('#int-clear') && ($('#int-clear').onclick = () => {
      u2.forEach(i => S.dismissed.push(i.id)); renderNow(); renderTabs(); renderStrip();
    });
    $$('#view-now .irow').forEach(b => b.onclick = () => u2[+b.dataset.u].go());
    $$('#view-now .arow[data-ref]').forEach(b => b.onclick = () => openRefStr(b.dataset.ref));
    $$('#view-now .arow[data-rfi]').forEach(b => b.onclick = () =>
      openRFI(W.rfis.find(r => r.id === b.dataset.rfi)));
    $$('#view-now .arow[data-case]').forEach(b => b.onclick = () =>
      openCase(W.cases.find(c => c.id === b.dataset.case)));
    $$('#view-now .arow[data-id]').forEach(b => b.onclick = () => openSignal(b.dataset.id));
  }

  function refLabel(ref) {
    const [k, id] = String(ref).split(':');
    if (k === 'sig') { const e = D.events.find(x => x.id === id); return e ? e.title : id; }
    if (k === 'scn') { const s = X.scenes.find(x => x.id === id); return s ? s.place : id; }
    if (k === 'case') { const c = W.cases.find(x => x.id === id); return c ? c.title : id; }
    if (k === 'ent') { const e = D.entities.find(x => x.id === id); return e ? e.name : id; }
    return id;
  }
  function openRefStr(ref) {
    const [k, id] = String(ref).split(':');
    if (k === 'sig') return openSignal(id);
    if (k === 'scn') return openScene(X.scenes.find(s => s.id === id));
    if (k === 'case') return openCase(W.cases.find(c => c.id === id));
    if (k === 'mail') return openMail(W.mail.find(m => m.id === id));
    if (k === 'rfi') return openRFI(W.rfis.find(r => r.id === id));
    toast('Open ' + ref + ' on the desk');
  }

  /* âââââ 2 Â· SIGNALS âââââ */
  const FILTERS = [['open', 'Needs action'], ['esc', 'Escalated'], ['critical', 'Critical'],
    ['assigned', 'Mine'], ['all', 'All']];
  function rowHTML(e) {
    const a = W.assignments.find(x => x.ref === 'sig:' + e.id && x.state === 'open');
    return `<button class="arow ${e.status === 'ack' ? 'read' : ''}" data-id="${e.id}">
      <i class="dia" style="background:${SEV[e.severity].color}"></i>
      <div><h4>${esc(e.title)}</h4>
        <div class="m"><span>${esc(e.place)}</span><span class="mono">${DOM[e.domain].short}</span>
          <span class="mono">${Math.round(e.conf * 100)}%</span>
          ${e.status === 'esc' ? '<span class="tag red">ESC</span>' : ''}
          ${e.status === 'ack' ? '<span class="tag green">ACK</span>' : ''}
          ${a ? avatar(a.to) : ''}</div></div>
      <span class="t">${ago(e.hoursAgo)}</span></button>`;
  }
  function renderSignals() {
    const q = queue();
    const count = k => k === 'all' ? q.length
      : k === 'open' ? q.filter(e => e.status !== 'ack').length
      : k === 'esc' ? q.filter(e => e.status === 'esc').length
      : k === 'critical' ? q.filter(e => e.severity === 'critical').length
      : q.filter(e => W.assignments.some(a => a.ref === 'sig:' + e.id && a.to === W.me && a.state === 'open')).length;
    $('#sfilt').innerHTML = FILTERS.map(([k, n]) =>
      `<button class="chip" data-f="${k}" aria-pressed="${S.filter === k}">${n}<span class="mono">${count(k)}</span></button>`).join('');
    $$('#sfilt .chip').forEach(b => b.onclick = () => { S.filter = b.dataset.f; renderSignals(); });

    const rows = q.filter(e => S.filter === 'all' ? true
      : S.filter === 'open' ? e.status !== 'ack'
      : S.filter === 'esc' ? e.status === 'esc'
      : S.filter === 'critical' ? e.severity === 'critical'
      : W.assignments.some(a => a.ref === 'sig:' + e.id && a.to === W.me && a.state === 'open'));

    $('#slist').innerHTML = rows.length ? rows.map(rowHTML).join('')
      : `<div class="empty"><svg><use href="#m-check"/></svg>
          <p>Nothing in this filter. The desk is carrying ${D.events.length} signals in total.</p></div>`;
    $$('#slist .arow').forEach(r => r.onclick = () => openSignal(r.dataset.id));
    renderTabs(); renderStrip();
  }

  function openSignal(id) {
    const e = D.events.find(x => x.id === id); if (!e) return;
    const near = D.events.filter(o => o.id !== e.id && haversine(e, o) < 800);
    const a = W.assignments.find(x => x.ref === 'sig:' + e.id && x.state === 'open');
    const cmts = W.comments.filter(c => c.ref === 'sig:' + e.id);
    const cse = W.cases.find(c => (c.records.signals || []).includes(e.id));
    openSheet(`
      <div class="row">
        <span class="tag" style="color:${SEV[e.severity].color};border-color:${SEV[e.severity].color}66">${SEV[e.severity].name}</span>
        <span class="tag">${DOM[e.domain].name}</span>
        <span class="lbl mono" style="margin-left:auto">${e.id}</span></div>
      <h2>${esc(e.title)}</h2>
      <p>${esc(e.summary)}</p>
      <dl class="kv">
        <dt>Location</dt><dd>${esc(e.place)}, ${esc(e.country)}</dd>
        <dt>Received</dt><dd class="mono">${zulu(e.ts)}</dd>
        <dt>Source</dt><dd>${e.source} Â· ${Math.round(e.conf * 100)}%${e.conf > .78 ? ' multi-source' : ' single-source'}</dd>
        <dt>Corroboration</dt><dd>${near.length} signal${near.length === 1 ? '' : 's'} within 800km</dd>
        <dt>Touches</dt><dd>${e.impacts.map(esc).join(', ') || 'â'}</dd>
        ${a ? `<dt>Assigned</dt><dd>${esc(user(a.to).name)} Â· due ${esc(a.due)}</dd>` : ''}
        ${cse ? `<dt>Case</dt><dd>${esc(cse.code)}</dd>` : ''}</dl>
      ${cmts.length ? `<div class="sechead" style="padding-top:4px"><b>Discussion</b><span>${cmts.length}</span></div>
        ${cmts.map(c => `<div class="cmt">${avatar(c.by)}
          <div><div class="h"><b>${esc(user(c.by).name)}</b><span class="t">${esc(c.ts)}</span></div>
            <div class="b">${esc(c.body).replace(/@([A-Z]\.\s?[A-Za-z]+)/g, '<span class="men">@$1</span>')}</div>
          </div></div>`).join('')}` : ''}
      <div class="btnrow two">
        <button class="btn primary" id="sh-ack"><svg><use href="#m-check"/></svg> Acknowledge</button>
        <button class="btn danger" id="sh-esc"><svg><use href="#m-flag"/></svg> Escalate</button></div>
      <div class="btnrow two" style="padding-top:0">
        <button class="btn" id="sh-map"><svg><use href="#m-globe"/></svg> Show on map</button>
        <button class="btn" id="sh-note"><svg><use href="#m-desk"/></svg> Note to desk</button></div>`);
    $('#sh-ack').onclick = () => { e.status = 'ack'; closeSheet(); renderAll();
      toast(e.id + ' acknowledged Â· cleared on the desk'); };
    $('#sh-esc').onclick = () => { e.status = 'esc'; closeSheet(); renderAll();
      toast(e.id + ' escalated to group security'); };
    $('#sh-map').onclick = () => { closeSheet(); S.map.sel = e.id; go('map'); focusOn(e.lon, e.lat, e); };
    $('#sh-note').onclick = () => { closeSheet(); S.noteRef = e.id; go('desk');
      setTimeout(() => $('#ntext') && $('#ntext').focus(), 120); };
  }

  function openScene(s) {
    if (!s) return;
    openSheet(`
      <div class="row"><span class="tag amber">Imagery</span>
        <span class="lbl mono" style="margin-left:auto">${s.id}</span></div>
      <h2>${esc(s.place)}</h2>
      <p>${s.sensor} Â· ${s.vendor} Â· ${s.dateA} â ${s.dateB}. Cloud ${s.cloud}%, off-nadir ${s.offNadir}Â°.
        ${s.changes.length} change detections, ${s.changes.filter(c => c.conf > .8).length} above 80%.</p>
      ${s.changes.map(c => `<div class="arow" style="border-top:1px solid var(--line-soft);border-bottom:0">
        <i class="dia" style="background:${c.type === 'new' ? '#c4453c' : c.type === 'expanded' ? '#b7822c' : '#4f7fa6'}"></i>
        <div><h4>${esc(c.label)}</h4><div class="m"><span>${esc(c.type)}</span>
          <span class="mono">${Math.round(c.conf * 100)}%</span></div></div></div>`).join('')}
      <div class="btnrow"><button class="btn" id="sc-map"><svg><use href="#m-globe"/></svg> Show location</button></div>`);
    $('#sc-map').onclick = () => { closeSheet(); go('map'); focusOn(s.lon, s.lat, null); };
  }

  function openCase(c) {
    if (!c) return;
    const sigs = (c.records.signals || []).map(id => D.events.find(e => e.id === id)).filter(Boolean);
    const rfis = W.rfis.filter(r => r.case === c.id);
    openSheet(`
      <div class="row"><span class="tag">${esc(c.code)}</span>
        <span class="tag ${c.status === 'review' ? 'amber' : c.status === 'closed' ? 'green' : ''}">${c.status}</span>
        <span class="lbl mono" style="margin-left:auto">${c.id}</span></div>
      <h2>${esc(c.title)}</h2>
      <p>${esc(c.summary)}</p>
      <dl class="kv"><dt>Owner</dt><dd>${esc(user(c.owner).name)}</dd>
        <dt>Priority</dt><dd>${esc(c.priority)}</dd>
        <dt>Opened</dt><dd class="mono">${esc(c.opened)}</dd>
        <dt>Due</dt><dd class="mono">${esc(c.due)}</dd>
        <dt>Records</dt><dd>${Object.values(c.records).reduce((a, v) => a + (v || []).length, 0)} attached</dd></dl>
      ${sigs.length ? `<div class="sechead" style="padding-top:2px"><b>Signals</b><span>${sigs.length}</span></div>
        ${sigs.map(rowHTML).join('')}` : ''}
      ${rfis.length ? `<div class="sechead"><b>RFIs</b><span>${rfis.length}</span></div>
        ${rfis.map(r => `<div class="arow" style="border-bottom:1px solid var(--line-soft)">
          <svg style="width:12px;height:12px;color:var(--txt-4);margin-top:4px"><use href="#m-rfi"/></svg>
          <div><h4>${esc(r.question.slice(0, 90))}</h4>
            <div class="m"><span class="mono">${r.id}</span>
              <span class="tag ${r.status === 'answered' ? 'green' : 'amber'}">${r.status}</span></div></div></div>`).join('')}` : ''}
      ${(c.notes || []).map(n => `<div class="cmt">${avatar(n.by)}
        <div><div class="h"><b>${esc(user(n.by).name)}</b><span class="t">${esc(n.ts)}</span></div>
          <div class="b">${esc(n.body)}</div></div></div>`).join('')}
      <div class="btnrow"><button class="btn" id="cs-note"><svg><use href="#m-desk"/></svg> Note on this case</button></div>`);
    $$('#sheetbody .arow[data-id]').forEach(r => r.onclick = () => openSignal(r.dataset.id));
    $('#cs-note').onclick = () => { closeSheet(); S.noteRef = c.id; go('desk'); };
  }

  function openMail(m) {
    if (!m) return;
    m.unread = false;
    openSheet(`
      <div class="row">${m.urgent ? '<span class="tag red">Urgent</span>' : ''}
        <span class="tag">${esc(m.src)}</span>
        <span class="lbl mono" style="margin-left:auto">${m.id}</span></div>
      <h2>${esc(m.subject)}</h2>
      <p class="lbl" style="padding:0 15px 10px">${esc(m.fromName)} Â· ${esc(m.from)} Â· ${zulu(m.ts)}</p>
      <p style="white-space:pre-wrap">${esc(m.body)}</p>
      ${m.attachments.length ? `<div class="sechead" style="padding-top:0"><b>Attachments</b><span>${m.attachments.length}</span></div>
        ${m.attachments.map(a => `<div class="orow"><svg><use href="#m-txt"/></svg>
          <div><b>${esc(a.name)}</b><em>${esc(a.size)}</em></div></div>`).join('')}` : ''}
      ${m.signalId ? `<div class="btnrow" style="padding-bottom:0">
        <button class="btn" id="ml-sig"><svg><use href="#m-flag"/></svg> Open ${esc(m.signalId)}</button></div>` : ''}
      <div class="btnrow two">
        <button class="btn primary" id="ml-ack"><svg><use href="#m-check"/></svg> Mark handled</button>
        <button class="btn" id="ml-note"><svg><use href="#m-send"/></svg> Reply via desk</button></div>`);
    renderAll();
    $('#ml-sig') && ($('#ml-sig').onclick = () => openSignal(m.signalId));
    $('#ml-ack').onclick = () => { S.dismissed.push('mail:' + m.id); closeSheet(); renderAll();
      toast(m.id + ' marked handled'); };
    $('#ml-note').onclick = () => { closeSheet(); S.noteRef = m.id; go('desk');
      setTimeout(() => $('#ntext') && $('#ntext').focus(), 120); };
  }

  function openRFI(r) {
    if (!r) return;
    openSheet(`
      <div class="row"><span class="tag amber">${r.status}</span>
        ${avatar(r.from)}<span class="lbl">â</span>${avatar(r.to)}
        <span class="lbl mono" style="margin-left:auto">${r.id} Â· due ${esc(r.due)}</span></div>
      <h2>${esc(r.question)}</h2>
      ${(r.answers || []).map(a => `<div class="cmt">${avatar(a.by)}
        <div><div class="h"><b>${esc(user(a.by).name)}</b><span class="t">${esc(a.ts)}</span></div>
          <div class="b">${esc(a.body)}</div></div></div>`).join('')}
      ${r.to === W.me && r.status === 'open' ? `<div class="note" style="padding:13px 15px 0">
          <textarea id="rfi-ans" placeholder="Your answerâ¦"></textarea></div>
        <div class="btnrow"><button class="btn primary" id="rfi-send"><svg><use href="#m-send"/></svg> Submit answer</button></div>`
        : `<div class="btnrow"><button class="btn" id="rfi-close">Close</button></div>`}`);
    $('#rfi-send') && ($('#rfi-send').onclick = () => {
      const v = $('#rfi-ans').value.trim();
      if (!v) return toast('Write an answer');
      r.answers = r.answers || [];
      r.answers.push({ by: W.me, ts: zulu(new Date()), body: v });
      r.status = 'answered';
      S.dismissed.push('rfi:' + r.id);
      closeSheet(); renderAll(); toast(r.id + ' answered Â· requester notified');
    });
    $('#rfi-close') && ($('#rfi-close').onclick = closeSheet);
  }

  /* âââââ 3 Â· MAP âââââ */
  let world = null, proj = null, path = null, gLand, gAoi, gMark, gTrk, msvg, zoomB = null, K = 1;
  const MF = [['signals', 'Signals'], ['vessels', 'Vessels'], ['aircraft', 'Aircraft'],
    ['sanctioned', 'Sanctioned'], ['areas', 'Scan areas']];
  function renderMapFilters() {
    $('#mfilt').innerHTML = MF.map(([k, n]) => {
      const c = k === 'signals' ? D.events.length : k === 'vessels' ? X.vessels.length
        : k === 'aircraft' ? X.aircraft.length
        : k === 'sanctioned' ? X.vessels.filter(v => v.sanctioned).length + X.aircraft.filter(a => a.watch).length
        : X.aoiSeed.length;
      return `<button class="chip" data-m="${k}" aria-pressed="${S.map[k]}">${n}<span class="mono">${c}</span></button>`;
    }).join('');
    $$('#mfilt .chip').forEach(b => b.onclick = () => {
      S.map[b.dataset.m] = !S.map[b.dataset.m]; renderMapFilters(); drawMap();
    });
  }
  function initMap() {
    if (msvg || typeof d3 === 'undefined') return;
    msvg = d3.select('#msvg');
    const g = msvg.append('g');
    gLand = g.append('g'); gAoi = g.append('g'); gMark = g.append('g'); gTrk = g.append('g');
    proj = d3.geoEquirectangular();
    /* ONE bound zoom behaviour, reused: zoom.transform dispatches only to that
       instance's listeners, so a fresh d3.zoom() moves nothing */
    zoomB = d3.zoom().scaleExtent([1, 12]).on('zoom', ev => {
      K = ev.transform.k;
      g.attr('transform', ev.transform);
      rescale();
      $('#mmeta').textContent = Math.round(2400 / K).toLocaleString() + ' km Â· ' + K.toFixed(1) + 'Ã';
    });
    msvg.call(zoomB);
    if (typeof topojson === 'undefined') return;
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')
      .then(r => r.json()).then(t => {
        world = topojson.feature(t, t.objects.countries);
        $('#mload').style.display = 'none';
        sizeMap(); drawMap();
      })
      .catch(() => { $('#mload').textContent =
        'Map geometry unavailable offline. Now, Signals, Brief and Desk still work.'; });
  }
  /* counter-scale must be re-applied on every redraw, not only on zoom */
  function rescale() {
    if (!gMark) return;
    gMark.selectAll('.mk').attr('transform', d => `translate(${proj([d.lon, d.lat])}) scale(${1 / K})`);
    gTrk.selectAll('.trk').attr('transform', d => `translate(${proj([d.lon, d.lat])}) scale(${1 / K})`);
    gLand.selectAll('path.land').style('stroke-width', .6 / K);
  }
  function sizeMap() {
    if (!msvg) return;
    const el = $('.mapwrap'); if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return setTimeout(sizeMap, 60);
    msvg.attr('viewBox', `0 0 ${w} ${h}`);
    proj.fitExtent([[6, 6], [w - 6, h - 6]], { type: 'Sphere' });
    path = d3.geoPath(proj);
    $('#mmeta').textContent = '2,400 km Â· 1.0Ã';
  }
  const shipPath = 'M-4.2,2.6 L-3,5 L3,5 L4.2,2.6 L2.6,-1 L1.1,-5.4 L-1.1,-5.4 L-2.6,-1 Z';
  const planePath = 'M0,-6.4 L1.1,-1.6 L6.4,1.4 L6.4,2.6 L1.1,1.4 L0.8,4.4 L2.6,5.8 L2.6,6.6 L0,5.8 L-2.6,6.6 L-2.6,5.8 L-0.8,4.4 L-1.1,1.4 L-6.4,2.6 L-6.4,1.4 L-1.1,-1.6 Z';

  function drawMap() {
    if (!path) return;
    gLand.selectAll('path.sphere').data([{ type: 'Sphere' }]).join('path')
      .attr('class', 'sphere').attr('d', path);
    gLand.selectAll('path.land').data(world ? world.features : [], d => d.id).join('path')
      .attr('class', 'land').attr('d', path);

    gAoi.selectAll('path').data(S.map.areas ? X.aoiSeed.filter(a => a.status === 'active') : [], d => d.id)
      .join('path').attr('class', 'aoi').attr('d', d => circle(d));

    const sigs = S.map.signals && !S.map.sanctioned ? D.events : [];
    const mk = gMark.selectAll('g.mk').data(sigs, d => d.id);
    mk.exit().remove();
    const men = mk.enter().append('g').attr('class', 'mk');
    men.append('rect').attr('transform', 'rotate(45)');
    men.on('click', (ev, d) => { ev.stopPropagation(); showCard(d); });
    men.merge(mk).select('rect')
      .attr('x', d => -(d.severity === 'critical' ? 5.2 : 4.4))
      .attr('y', d => -(d.severity === 'critical' ? 5.2 : 4.4))
      .attr('width', d => d.severity === 'critical' ? 10.4 : 8.8)
      .attr('height', d => d.severity === 'critical' ? 10.4 : 8.8)
      .attr('fill', d => SEV[d.severity].color)
      .attr('opacity', d => d.status === 'ack' ? .5 : 1);

    let tracks = [];
    if (S.map.vessels) tracks = tracks.concat(X.vessels);
    if (S.map.aircraft) tracks = tracks.concat(X.aircraft);
    if (S.map.sanctioned) tracks = tracks.filter(t => t.sanctioned || t.watch);
    const tk = gTrk.selectAll('g.trk').data(tracks, d => d.mmsi || d.icao);
    tk.exit().remove();
    const ten = tk.enter().append('g')
      .attr('class', d => 'trk ' + d.kind + (d.sanctioned ? ' sanc' : '') + (d.watch ? ' watch' : ''));
    ten.append('path');
    ten.on('click', (ev, d) => { ev.stopPropagation(); showCard(d); });
    ten.merge(tk).select('path').attr('d', d => d.kind === 'vessel' ? shipPath : planePath)
      .attr('transform', d => `rotate(${d.hdg})`);

    rescale();
  }
  /* a simple circle approximation for an AOI radius */
  function circle(a) {
    const pts = [], n = 28, dLat = a.radiusKm / 111;
    for (let i = 0; i <= n; i++) {
      const t = i / n * 2 * Math.PI;
      pts.push([a.lon + dLat * Math.cos(t) / Math.cos(a.lat * Math.PI / 180), a.lat + dLat * Math.sin(t)]);
    }
    return path({ type: 'Polygon', coordinates: [pts] });
  }

  function showCard(d) {
    const isSig = !!d.severity;
    $('#mct').textContent = isSig ? d.title : (d.name || d.callsign);
    $('#mcm').textContent = isSig
      ? `${d.place}, ${d.country} Â· ${SEV[d.severity].name} Â· ${zulu(d.ts)}`
      : d.kind === 'vessel'
        ? `${d.type} Â· ${d.flag} Â· MMSI ${d.mmsi} Â· ${d.spd} kn${d.ais === 'dark' ? ' Â· AIS DARK' : ''}`
        : `${d.type} Â· ${d.role} Â· FL${Math.round(d.alt / 100)} Â· ${d.spd} kt`;
    $('#mcb').innerHTML = isSig
      ? `<button class="btn" id="mc-open" style="width:100%"><svg><use href="#m-read"/></svg> Open signal</button>`
      : `${(d.sanctioned || d.watch) ? `<div class="tag red" style="margin-bottom:9px">${d.sanctioned ? 'Sanctioned party' : 'Watchlisted'}</div>` : ''}
         <button class="btn" id="mc-open" style="width:100%"><svg><use href="#m-desk"/></svg> ${d.sanctioned ? 'Flag to desk' : 'Note to desk'}</button>`;
    $('#mcard').classList.add('on');
    $('#mc-open').onclick = () => {
      $('#mcard').classList.remove('on');
      if (isSig) openSignal(d.id);
      else { S.noteRef = ''; go('desk');
        setTimeout(() => { const t = $('#ntext'); if (t) {
          t.value = `Track ${d.name || d.callsign} (${d.type}) noted at ${d.lat.toFixed(2)}, ${d.lon.toFixed(2)}. `;
          t.focus(); } }, 130); }
    };
  }
  $('#mclose').onclick = () => $('#mcard').classList.remove('on');
  $('#msvg').addEventListener('click', () => $('#mcard').classList.remove('on'));

  function focusOn(lon, lat, d) {
    initMap(); sizeMap();
    setTimeout(() => {
      if (!msvg || !zoomB) return;
      const el = $('.mapwrap'), w = el.clientWidth, h = el.clientHeight, k = 4;
      const p = proj([lon, lat]); if (!p) return;
      msvg.call(zoomB.transform,
        d3.zoomIdentity.translate(w / 2 - p[0] * k, h / 2 - p[1] * k).scale(k));
      drawMap();
      if (d) showCard(d);
    }, 90);
  }

  /* âââââ 4 Â· BRIEF âââââ */
  function briefDoc() {
    const sel = D.events.slice()
      .sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank || a.hoursAgo - b.hoursAgo).slice(0, 10);
    return { meta: D.briefings[0], sel,
      crit: sel.filter(e => e.severity === 'critical'),
      high: sel.filter(e => e.severity === 'high'),
      regions: countBy(sel, e => e.region).sort((a, b) => b[1] - a[1]),
      domains: countBy(sel, e => e.domain).sort((a, b) => b[1] - a[1]) };
  }
  const xref = (k, id, t) => `<span class="xref" role="link" tabindex="0" data-k="${k}" data-id="${id}">${esc(t)} â¸</span>`;

  function renderBrief() {
    const d = briefDoc(), mc = Math.round(mean(d.sel, e => e.conf) * 100);
    const top = d.crit[0] || d.sel[0], scene = X.scenes[0];
    const multi = d.sel.filter(e => e.conf > .78).length;
    $('#brief').innerHTML = `
      <div class="bh"><h1>${esc(d.meta.title)}</h1>
        <div class="m">${d.meta.id} Â· ${d.meta.scope} Â· issued ${zulu(new Date())}<br>INTERNAL // RISK Â· ${d.meta.author}</div></div>
      <div class="ledger" style="border-top:0">
        <div><b>${d.sel.length}</b><span>signals</span></div>
        <div><b style="color:var(--red)">${d.crit.length}</b><span>critical</span></div>
        <div><b>${mc}%</b><span>mean confidence</span></div>
        <div><b>${multi}</b><span>multi-source</span></div>
      </div>
      <h2>Executive judgement</h2>
      <p>${d.sel.length} signals meet the reporting threshold this cycle, ${d.crit.length} of them
        critical. Activity concentrates in ${d.regions.map(([r, n]) => xref('region', r, r + ' (' + n + ')')).join(', ')}.
        The most consequential development is ${xref('signal', top.id, top.place + ': ' + top.title.charAt(0).toLowerCase() + top.title.slice(1))}.</p>
      <p>Confidence averages ${mc}%, with ${multi} signals corroborated by more than one feed.
        Overhead imagery of ${xref('scene', scene.id, scene.place)} supports the assessment:
        ${scene.changes.length} findings against the ${scene.dateA} reference scene.</p>
      <div class="callout"><b>Bottom line.</b> ${d.crit.length
        ? `Hold contingency routing and keep ${xref('signal', d.crit[0].id, d.crit[0].place)} under daily review.`
        : 'No change to posture.'}</div>
      <h2>By theme</h2>
      ${d.domains.slice(0, 3).map(([k, n]) => {
        const evs = d.sel.filter(e => e.domain === k);
        const worst = evs.slice().sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank)[0];
        return `<p><b style="color:var(--txt)">${DOM[k].name} Â· ${n}</b><br>
          Centred on ${evs.slice(0, 2).map(e => xref('signal', e.id, e.place)).join(' and ')}.
          Severity peak ${SEV[worst.severity].name.toLowerCase()}, set by ${xref('signal', worst.id, worst.place)}.</p>`;
      }).join('')}
      <h2>Indicators</h2>
      <ul>
        ${d.sel.some(e => e.domain === 'maritime') ? '<li>A second interference event in the same corridor inside seven days would trigger the pre-agreed rerouting clause.</li>' : ''}
        ${d.sel.some(e => e.domain === 'conflict') ? '<li>Front-line movement within 50km of a contracted facility requires an immediate duty-of-care review.</li>' : ''}
        <li>Any critical signal uncorroborated after 24 hours should be downgraded rather than carried forward.</li>
      </ul>
      <h2>Sourcing</h2>
      <p>${d.sel.length} signals from ${new Set(d.sel.map(e => e.source)).size} feeds, mean confidence ${mc}%.
        Every reference above opens the underlying record. Generated from the console corpus;
        illustrative, not live reporting.</p>
      <div class="btnrow"><button class="btn" id="b-note"><svg><use href="#m-desk"/></svg> Note on this briefing</button></div>`;
    const act = el => openRefStr(el.dataset.k === 'region' ? 'region:' + el.dataset.id
      : el.dataset.k === 'scene' ? 'scn:' + el.dataset.id : 'sig:' + el.dataset.id);
    $$('#brief .xref').forEach(x => {
      x.onclick = () => x.dataset.k === 'region' ? openRegion(x.dataset.id) : act(x);
      x.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); x.click(); } };
    });
    $('#b-note').onclick = () => { S.noteRef = d.meta.id; go('desk'); };
  }
  function openRegion(r) {
    const evs = D.events.filter(e => e.region === r);
    openSheet(`<div class="row"><span class="tag">Region</span>
        <span class="lbl mono" style="margin-left:auto">${esc(r)}</span></div>
      <h2>${esc(r)}</h2>
      <p>${evs.length} signals in the corpus, ${evs.filter(e => e.severity === 'critical').length} critical.</p>
      ${evs.slice(0, 8).map(rowHTML).join('')}`);
    $$('#sheetbody .arow[data-id]').forEach(x => x.onclick = () => openSignal(x.dataset.id));
  }

  /* âââââ 5 Â· DESK âââââ */
  function renderDesk() {
    const opts = ['<option value="">No reference</option>']
      .concat(queue().slice(0, 12).map(e => `<option value="${e.id}">${e.id} Â· ${esc(e.place)}</option>`))
      .concat(W.cases.map(c => `<option value="${c.id}">${c.id} Â· ${esc(c.code)}</option>`))
      .concat(D.briefings.map(b => `<option value="${b.id}">${b.id} Â· ${esc(b.title)}</option>`))
      .concat(W.mail.slice(0, 6).map(m => `<option value="${m.id}">${m.id} Â· ${esc(m.fromName)}</option>`));
    /* a reference set from anywhere must survive: if it is not in the list, add it */
    if (S.noteRef && !opts.some(o => o.includes(`value="${S.noteRef}"`)))
      opts.splice(1, 0, `<option value="${S.noteRef}">${esc(S.noteRef)}</option>`);

    const cmts = W.comments.filter(c => (c.mentions || []).includes(W.me) || c.by === W.me).slice(0, 4);

    $('#view-desk').innerHTML = `
      <div class="note">
        <div class="rec" id="rec">
          <button class="btn-rec" id="recbtn" aria-label="Hold to record"><svg><use href="#m-mic"/></svg></button>
          <div class="t"><b id="rectitle">Hold to record</b>
            <span id="recsub">Voice note to the duty desk</span>
            <div class="wave" id="wave"></div></div>
        </div>
        <div class="f"><label for="ntext">Written note</label>
          <textarea id="ntext" placeholder="What the desk needs to knowâ¦"></textarea></div>
        <div class="f"><label for="nto">Route to</label>
          <select id="nto"><option>Duty desk</option><option>Group security</option>
            <option>Regional security lead</option><option>Logistics</option><option>Compliance</option></select></div>
        <div class="f"><label for="nref">Attach reference</label><select id="nref">${opts.join('')}</select></div>
        <button class="btn primary" id="nsend" style="width:100%"><svg><use href="#m-send"/></svg> Send to desk</button>
      </div>

      <div class="sechead"><b>Urgent mail</b><span>${urgentMail().length}</span></div>
      ${urgentMail().map(m => `<button class="arow" data-mail="${m.id}">
        <svg style="width:13px;height:13px;color:#cf6259;margin-top:4px"><use href="#m-mail"/></svg>
        <div><h4>${esc(m.subject)}</h4>
          <div class="m"><span>${esc(m.fromName)}</span><span class="mono">${esc(m.src)}</span>
            ${m.attachments.length ? '<span class="tag">' + m.attachments.length + ' att</span>' : ''}</div></div>
        <span class="t">${ago(m.hoursAgo)}</span></button>`).join('') ||
        '<p class="caption" style="padding-top:0">No urgent mail.</p>'}

      ${cmts.length ? `<div class="sechead"><b>Recent discussion</b><span>${cmts.length}</span></div>
        ${cmts.map(c => `<button class="arow" data-ref="${esc(c.ref)}" style="grid-template-columns:auto 1fr">
          ${avatar(c.by)}
          <div><h4 style="font-size:13.5px">${esc(c.body).slice(0, 96).replace(/@([A-Z]\.\s?[A-Za-z]+)/g, '<span style="color:#82aede">@$1</span>')}</h4>
            <div class="m"><span>${esc(user(c.by).name)}</span><span class="mono">${esc(c.ref)}</span>
              <span class="mono">${esc(c.ts)}</span></div></div></button>`).join('')}` : ''}

      <div class="sechead"><b>Outbox</b><span>${S.outbox.length}</span></div>
      ${S.outbox.map(o => `<div class="orow">
        <svg><use href="#${o.kind === 'voice' ? 'm-mic' : 'm-txt'}"/></svg>
        <div><b>${esc(o.kind === 'voice' ? 'Voice note Â· ' + o.dur : o.body)}</b>
          <em>${esc(o.to)} Â· ${esc(o.ts)}${o.ref ? ' Â· ' + esc(o.ref) : ''}</em></div>
        <span class="tag ${o.state === 'sent' ? 'green' : 'amber'}">${o.state}</span></div>`).join('')}
      <p class="caption">Notes queue on the device and send when a connection is available.
        Voice notes are recorded locally and transcribed at the desk.</p>`;

    $('#wave').innerHTML = Array.from({ length: 20 }, () => '<i style="height:4px"></i>').join('');
    if (S.noteRef) $('#nref').value = S.noteRef;
    $('#nref').onchange = ev => { S.noteRef = ev.target.value; };
    $('#nsend').onclick = send;
    $$('#view-desk .arow[data-mail]').forEach(b => b.onclick = () =>
      openMail(W.mail.find(m => m.id === b.dataset.mail)));
    $$('#view-desk .arow[data-ref]').forEach(b => b.onclick = () => openRefStr(b.dataset.ref));
    wireRec();
  }
  function send() {
    const body = $('#ntext').value.trim();
    if (!body) return toast('Write a note, or hold the button to record one');
    S.outbox.unshift({ kind: 'text', to: $('#nto').value, body,
      ref: $('#nref').value || '', ts: zulu(new Date()), state: 'queued' });
    S.noteRef = '';
    renderDesk(); toast('Queued Â· sends when a connection is available');
    setTimeout(() => { if (S.outbox[0]) { S.outbox[0].state = 'sent'; if (S.tab === 'desk') renderDesk(); } }, 2400);
  }

  let recStart = 0, recTimer = null;
  function wireRec() {
    const rb = $('#recbtn'); if (!rb) return;
    rb.addEventListener('pointerdown', ev => {
      ev.preventDefault(); recStart = Date.now();
      $('#rec').classList.add('live');
      $('#recsub').textContent = 'Release to queue Â· slide off to cancel';
      const bars = $$('#wave i');
      recTimer = setInterval(() => {
        const s = (Date.now() - recStart) / 1000;
        $('#rectitle').textContent = 'Recording Â· ' + Math.floor(s / 60) + ':' + pad(Math.floor(s % 60));
        bars.forEach((b, i) => b.style.height = (4 + Math.abs(Math.sin(s * 3 + i * .7)) * 18).toFixed(0) + 'px');
      }, 70);
    });
    const end = cancel => {
      if (!recStart) return;
      clearInterval(recTimer);
      const s = Math.max(1, Math.round((Date.now() - recStart) / 1000));
      recStart = 0;
      $('#rec').classList.remove('live');
      $('#rectitle').textContent = 'Hold to record';
      $('#recsub').textContent = 'Voice note to the duty desk';
      $$('#wave i').forEach(b => b.style.height = '4px');
      if (cancel || s < 1) return toast('Recording discarded');
      S.outbox.unshift({ kind: 'voice', to: $('#nto').value,
        dur: Math.floor(s / 60) + ':' + pad(s % 60), ref: $('#nref').value || '',
        ts: zulu(new Date()), state: 'queued' });
      renderDesk(); toast('Voice note queued Â· ' + s + 's');
      setTimeout(() => { if (S.outbox[0]) { S.outbox[0].state = 'sent'; if (S.tab === 'desk') renderDesk(); } }, 2600);
    };
    rb.addEventListener('pointerup', () => end(false));
    rb.addEventListener('pointerleave', () => end(true));
    rb.addEventListener('pointercancel', () => end(true));
  }

  /* ââ boot ââ */
  function renderAll() {
    renderStrip(); renderTabs();
    if (S.tab === 'now') renderNow();
    if (S.tab === 'signals') renderSignals();
    if (S.tab === 'desk') renderDesk();
  }
  const u = me();
  $('#hav').textContent = u.initials;
  $('#hav').style.background = u.color;
  $('#hname').textContent = u.name;
  $('#hsub').textContent = W.ROLES[u.role].name + ' Â· on call Â· ' + u.tz;
  renderMapFilters(); renderAll();
  setInterval(() => { renderStrip(); }, 4000);

  /* libraries load AFTER the app, with a timeout and mirrors. Only Map needs them. */
  (function libs() {
    const SRC = [
      ['d3', ['https://unpkg.com/d3@7.9.0/dist/d3.min.js',
              'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
              'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js']],
      ['topojson', ['https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js',
                    'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js',
                    'https://cdnjs.cloudflare.com/ajax/libs/topojson/3.1.0/topojson-client.min.js']]
    ];
    function one(urls, glob, done) {
      let i = 0;
      (function attempt() {
        if (i >= urls.length) return done(false);
        const s = document.createElement('script'); let settled = false, timer;
        const ok = () => { if (settled) return; settled = true; clearTimeout(timer); done(true); };
        const bad = () => { if (settled) return; settled = true; clearTimeout(timer);
          if (s.parentNode) s.parentNode.removeChild(s); attempt(); };
        s.src = urls[i++];
        s.onload = () => window[glob] ? ok() : bad();
        s.onerror = bad;
        timer = setTimeout(bad, 6000);
        document.head.appendChild(s);
      })();
    }
    one(SRC[0][1], 'd3', ok1 => {
      if (!ok1) return;
      one(SRC[1][1], 'topojson', () => { if (S.tab === 'map') { initMap(); sizeMap(); drawMap(); } });
    });
  })();
})();
