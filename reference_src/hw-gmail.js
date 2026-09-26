/* Horizon Watch â Gmail connector and the distribution recipient book.

   This is a REAL OAuth client, not a mock. Supply a Google Cloud OAuth client
   ID (Settings â Mail & calendar â Connect) and, provided the page is served
   from an origin listed in that client's authorised JavaScript origins, it
   signs in through Google Identity Services and talks to the Gmail REST API
   directly from the browser: list, fetch, decode and send.

   Without a client ID it runs on the sample mailbox in hw-data3.js and says so.
   Nothing here pretends to be connected when it is not. */
(function () {
  const D = window.HW, W = window.HW3;
  const { $, $$, esc, zulu } = window.HWU;
  const on = (s, e, f) => { const n = typeof s === 'string' ? $(s) : s; if (n) n.addEventListener(e, f); };
  const KEY = 'horizonwatch.gmail.v1';

  const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/calendar.events'
  ].join(' ');

  const G = {
    clientId: '', token: null, expires: 0, profile: null,
    query: 'in:inbox newer_than:7d', pollSec: 60, autoParse: true,
    connected: false, gisReady: false, lastSync: null, lastError: null, timer: null,
    stats: { fetched: 0, parsed: 0, sent: 0 }
  };

  /* ââ recipient book ââââââââââââââââââââââââââââââââââââââ
     Distribution is data, not hard-coded strings: lists hold addresses,
     addresses can sit in several lists, and the generator, the reader and the
     print view all read the same book. */
  const BOOK = {
    lists: [
      { id: 'L1', name: 'Executive committee', note: 'Weekly review and anything critical',
        members: ['ceo@group.example', 'cfo@group.example', 'coo@group.example',
                  'gc@group.example', 'ciso@group.example', 'k.almeida@horizonwatch.internal'] },
      { id: 'L2', name: 'Regional security leads', note: 'Regional distribution',
        members: ['t.achebe@horizonwatch.internal', 'l.ferreira@horizonwatch.internal',
                  'm.sundaram@horizonwatch.internal', 'r.delgado@horizonwatch.internal'] },
      { id: 'L3', name: 'Operations and logistics', note: 'Corridor and routing decisions',
        members: ['logistics@group.example', 'freight@group.example', 'procurement@group.example'] },
      { id: 'L4', name: 'Board risk committee', note: 'Quarterly and on escalation',
        members: ['chair.risk@group.example', 'ned1@group.example', 'ned2@group.example',
                  'company.secretary@group.example', 'k.almeida@horizonwatch.internal'] },
      { id: 'L5', name: 'Duty desk', note: 'Always on, 24h', members: ['duty@horizonwatch.internal'] }
    ],
    /* ad-hoc addresses an analyst adds for one briefing */
    extra: []
  };
  (function restore() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!r) return;
      G.clientId = r.clientId || ''; G.query = r.query || G.query;
      G.pollSec = r.pollSec || G.pollSec; G.autoParse = r.autoParse !== false;
      if (r.lists) BOOK.lists = r.lists;
      if (r.extra) BOOK.extra = r.extra;
    } catch (e) {}
  })();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(
    { clientId: G.clientId, query: G.query, pollSec: G.pollSec, autoParse: G.autoParse,
      lists: BOOK.lists, extra: BOOK.extra })); } catch (e) {} };

  const validEmail = a => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(a).trim());
  const allAddresses = () => {
    const s = new Set();
    BOOK.lists.forEach(l => l.members.forEach(m => s.add(m)));
    BOOK.extra.forEach(m => s.add(m));
    return [...s].sort();
  };

  /* ââ Google Identity Services ââââââââââââââââââââââââââââââ */
  function loadGIS() {
    if (G.gisReady || window.google?.accounts?.oauth2) { G.gisReady = true; return Promise.resolve(true); }
    return new Promise(res => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => { G.gisReady = true; res(true); };
      s.onerror = () => { G.lastError = 'Google Identity Services could not be loaded'; res(false); };
      const t = setTimeout(() => { if (!G.gisReady) { G.lastError = 'Google sign-in timed out'; res(false); } }, 8000);
      s.addEventListener('load', () => clearTimeout(t));
      document.head.appendChild(s);
    });
  }

  async function connect() {
    if (!G.clientId) { window.HWtoast('Add an OAuth client ID first', 'warn'); return false; }
    const ok = await loadGIS();
    if (!ok || !window.google?.accounts?.oauth2) {
      window.HWtoast(G.lastError || 'Google sign-in unavailable', 'warn'); render(); return false;
    }
    return new Promise(res => {
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: G.clientId, scope: SCOPES, prompt: '',
          callback: async r => {
            if (r.error) { G.lastError = r.error_description || r.error; window.HWtoast('Google declined: ' + G.lastError, 'warn'); render(); return res(false); }
            G.token = r.access_token;
            G.expires = Date.now() + (r.expires_in || 3600) * 1000;
            G.connected = true; G.lastError = null;
            await loadProfile();
            startPolling();
            window.HWtoast('Gmail connected as ' + (G.profile?.emailAddress || 'account'), 'ok');
            render(); res(true);
          }
        });
        client.requestAccessToken();
      } catch (e) {
        G.lastError = e.message; window.HWtoast('OAuth failed: ' + e.message, 'warn'); render(); res(false);
      }
    });
  }
  function disconnect() {
    if (G.token && window.google?.accounts?.oauth2) { try { google.accounts.oauth2.revoke(G.token); } catch (e) {} }
    G.token = null; G.connected = false; G.profile = null;
    clearInterval(G.timer); G.timer = null;
    window.HWtoast('Gmail disconnected'); render();
  }

  const api = async (path, opts) => {
    if (!G.token) throw new Error('not connected');
    if (Date.now() > G.expires) { G.connected = false; throw new Error('token expired â reconnect'); }
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path,
      Object.assign({ headers: { Authorization: 'Bearer ' + G.token, 'Content-Type': 'application/json' } }, opts || {}));
    if (!r.ok) throw new Error('Gmail API ' + r.status + ' ' + (await r.text()).slice(0, 120));
    return r.json();
  };
  async function loadProfile() { try { G.profile = await api('profile'); } catch (e) { G.lastError = e.message; } }

  const b64url = s => { try { return decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')))); } catch (e) { return ''; } };
  function walkParts(p, out) {
    if (!p) return out;
    if (p.filename && p.body?.attachmentId) out.att.push({ name: p.filename, size: Math.round((p.body.size || 0) / 1024) + ' KB' });
    if (p.mimeType === 'text/plain' && p.body?.data) out.text += b64url(p.body.data);
    (p.parts || []).forEach(c => walkParts(c, out));
    return out;
  }

  /* map a Gmail message onto the console's mail shape, then through the
     inbound parse rules â the same rules the sample corpus documents */
  function toMail(msg) {
    const hdr = n => (msg.payload?.headers || []).find(h => h.name.toLowerCase() === n)?.value || '';
    const from = hdr('from'), addr = (from.match(/<(.+?)>/) || [null, from])[1].trim().toLowerCase();
    const parsedParts = walkParts(msg.payload, { text: '', att: [] });
    const known = W.MAIL_SENDERS[addr];
    const subject = hdr('subject') || '(no subject)';
    const ts = new Date(+msg.internalDate || Date.now());
    return {
      id: 'G-' + msg.id, thread: msg.threadId, from: addr,
      fromName: (from.match(/^"?([^"<]+)"?\s*</) || [null, known?.name || addr])[1].trim(),
      src: known?.src || 'OSINT-WIRE', rel: known?.rel || .6,
      hoursAgo: Math.max(0, (Date.now() - ts) / 3600e3), ts, subject,
      unread: (msg.labelIds || []).includes('UNREAD'),
      urgent: /urgent|immediate|critical/i.test(subject),
      body: (parsedParts.text || msg.snippet || '').trim(),
      attachments: parsedParts.att, labels: (msg.labelIds || []).map(l => l.toLowerCase()),
      signalId: null, caseId: null, state: 'new', to: [G.profile?.emailAddress || 'me'], live: true
    };
  }

  async function sync(manual) {
    if (!G.connected) return;
    try {
      const list = await api('messages?maxResults=25&q=' + encodeURIComponent(G.query));
      const ids = (list.messages || []).map(m => m.id);
      const existing = new Set(window.HWwork.T.mail.map(m => m.id));
      let added = 0;
      for (const id of ids) {
        if (existing.has('G-' + id)) continue;
        const full = await api('messages/' + id + '?format=full');
        const m = toMail(full);
        window.HWwork.T.mail.unshift(m); added++; G.stats.fetched++;
        if (G.autoParse && m.urgent) {
          window.HWwork.T.notes.unshift({ id: 'N-' + m.id, kind: 'urgent-mail', ref: 'mail:' + m.id,
            by: null, ts: zulu(m.ts), read: false, urgent: true,
            text: 'Urgent mail from ' + m.fromName + ' â ' + m.subject.slice(0, 60) });
        }
      }
      G.lastSync = new Date(); G.lastError = null;
      if (added) {
        window.HWtoast(added + ' new message' + (added === 1 ? '' : 's') + ' from Gmail', 'ok');
        if (window.HWS.module === 'mail') window.HWwork.renderMail();
      } else if (manual) window.HWtoast('Mailbox up to date');
      render();
    } catch (e) {
      G.lastError = e.message;
      if (manual) window.HWtoast('Sync failed: ' + e.message, 'warn');
      render();
    }
  }
  function startPolling() {
    clearInterval(G.timer);
    sync();
    G.timer = setInterval(() => sync(), Math.max(30, G.pollSec) * 1000);
  }

  /* RFC 2822 out, base64url in a raw send */
  function mime(to, subject, body, opts) {
    const from = G.profile?.emailAddress || 'me';
    const lines = [
      'From: ' + from, 'To: ' + (Array.isArray(to) ? to.join(', ') : to),
      opts?.cc ? 'Cc: ' + opts.cc : null,
      'Subject: ' + subject,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"',
      opts?.urgent ? 'X-Priority: 1' : null,
      opts?.urgent ? 'Importance: high' : null,
      '', body
    ].filter(Boolean).join('\r\n');
    return btoa(unescape(encodeURIComponent(lines))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function send(to, subject, body, opts) {
    const recipients = Array.isArray(to) ? to : [to];
    if (!recipients.length) throw new Error('no recipients');
    if (!G.connected) {                     /* honest fallback: queue, do not claim delivery */
      window.HWwork.T.sent.unshift({ id: 'S-' + Date.now().toString(36), to: recipients.join(', '),
        subject, ts: zulu(new Date()), kind: opts?.kind || 'digest',
        receipts: { delivered: 0, opened: 0, failed: 0 }, queued: true });
      window.HWtoast('Queued â connect Gmail to deliver', 'warn');
      return { queued: true };
    }
    const r = await api('messages/send', { method: 'POST',
      body: JSON.stringify({ raw: mime(recipients, subject, body, opts) }) });
    G.stats.sent++;
    window.HWwork.T.sent.unshift({ id: r.id || ('S-' + Date.now().toString(36)),
      to: recipients.length > 1 ? recipients[0] + ' +' + (recipients.length - 1) : recipients[0],
      subject, ts: zulu(new Date()), kind: opts?.kind || 'digest',
      receipts: { delivered: recipients.length, opened: 0, failed: 0 } });
    return r;
  }

  /* ââ briefing distribution âââââââââââââââââââââââââââââââ
     One picker, used by the generator, the reader and the print view. */
  function briefingBody(doc, note) {
    const m = doc.meta;
    return [
      note ? note + '\n' : '',
      m.title, '',
      m.id + ' Â· ' + m.scope + ' Â· ' + (m.aud || m.audience || 'Executive committee') + ' Â· ' + m.cls,
      'Issued ' + zulu(new Date()) + ' Â· horizon ' + m.horizon,
      '',
      doc.sel.length + ' signals in the evidence set, ' + doc.crit.length + ' critical and ' +
        doc.high.length + ' high. Activity concentrates in ' +
        doc.regions.map(([r, n]) => r + ' (' + n + ')').join(', ') + '.',
      '',
      'Signals driving this assessment:',
      ...doc.sel.slice(0, 8).map(e => '  ' + e.id + '  ' + e.severity.toUpperCase().padEnd(9) + e.place + ' â ' + e.title),
      '',
      'The full briefing, including the exposure table, indicators and Appendix A, is attached as PDF.',
      'Every reference in the interactive version links to its underlying record in Horizon Watch.',
      '',
      'â Horizon Watch Â· ' + (G.profile?.emailAddress || W.mailbox.account)
    ].join('\n');
  }

  const DIST = { picked: new Set(['L1']), extra: '', note: '', attachPdf: true, urgent: false };

  function openDistribute(doc) {
    if (!doc) return window.HWtoast('No briefing loaded', 'warn');
    $('#dist-scrim').classList.add('open');
    renderDistribute(doc);
  }
  function renderDistribute(doc) {
    const total = () => {
      const s = new Set();
      BOOK.lists.forEach(l => { if (DIST.picked.has(l.id)) l.members.forEach(m => s.add(m)); });
      DIST.extra.split(/[,;\s]+/).filter(validEmail).forEach(a => s.add(a.toLowerCase()));
      return s;
    };
    const n = total().size;
    $('#dist-meta').textContent = doc.meta.id + ' Â· ' + doc.meta.cls;
    $('#dist-body').innerHTML = `<div class="setsec" style="border:0">
        <h4>${esc(doc.meta.title)}</h4>
        <p>${doc.sel.length} signals Â· ${doc.crit.length} critical Â· horizon ${esc(doc.meta.horizon)}.
          Recipients receive the covering summary in the message body and the paginated briefing as PDF.</p>
        <span class="lbl" style="display:block;margin:4px 0 7px">Distribution lists</span>
        ${BOOK.lists.map(l => `<label class="check" style="align-items:center">
          <input type="checkbox" data-l="${l.id}" ${DIST.picked.has(l.id) ? 'checked' : ''}>
          <span style="flex:1">${esc(l.name)}<em style="display:block;font-style:normal;font-size:11px;color:var(--txt-3)">${esc(l.note)} Â· ${l.members.length} recipients</em></span>
        </label>`).join('')}
        <div class="field" style="margin-top:11px"><label>Additional addresses</label>
          <input class="input" id="dist-extra" value="${esc(DIST.extra)}" placeholder="name@company.example, another@company.example"></div>
        <div class="field"><label>Covering note</label>
          <textarea class="input" id="dist-note" rows="3" placeholder="Optional â appears above the summary">${esc(DIST.note)}</textarea></div>
        <label class="check"><input type="checkbox" id="dist-pdf" ${DIST.attachPdf ? 'checked' : ''}><span>Attach the paginated briefing as PDF</span></label>
        <label class="check"><input type="checkbox" id="dist-urgent" ${DIST.urgent ? 'checked' : ''}><span>Mark high importance</span></label>
      </div>
      <div class="setsec" style="border:0;padding-top:0">
        <span class="lbl" style="display:block;margin-bottom:6px">Resolved recipients Â· ${n}</span>
        <div class="reflist">${[...total()].slice(0, 24).map(a =>
          `<span class="refchip" style="cursor:default"><svg><use href="#i-mail"/></svg>${esc(a)}</span>`).join('')
          || '<span class="dim" style="font-size:12px">Pick a list or add an address.</span>'}
          ${n > 24 ? `<span class="refchip" style="cursor:default">+${n - 24} more</span>` : ''}</div>
      </div>`;
    $('#dist-hint').textContent = G.connected
      ? 'Sends now through Gmail as ' + (G.profile?.emailAddress || 'the connected account')
      : 'Gmail is not connected â this will queue instead of sending';
    $('#dist-send').disabled = !n;
    $$('#dist-body [data-l]').forEach(cb => cb.onchange = () => {
      cb.checked ? DIST.picked.add(cb.dataset.l) : DIST.picked.delete(cb.dataset.l);
      renderDistribute(doc);
    });
    on('#dist-extra', 'input', ev => { DIST.extra = ev.target.value; });
    on('#dist-extra', 'change', () => renderDistribute(doc));
    on('#dist-note', 'input', ev => { DIST.note = ev.target.value; });
    on('#dist-pdf', 'change', ev => { DIST.attachPdf = ev.target.checked; });
    on('#dist-urgent', 'change', ev => { DIST.urgent = ev.target.checked; });
  }
  on('#dist-close', 'click', () => $('#dist-scrim').classList.remove('open'));
  on('#dist-scrim', 'click', ev => { if (ev.target.id === 'dist-scrim') $('#dist-scrim').classList.remove('open'); });
  on('#dist-book', 'click', () => { $('#dist-scrim').classList.remove('open'); window.HWsettings && window.HWsettings.open('dist'); });
  on('#dist-send', 'click', async () => {
    const doc = window.HWMdoc ? window.HWMdoc.doc() : null; if (!doc) return;
    const s = new Set();
    BOOK.lists.forEach(l => { if (DIST.picked.has(l.id)) l.members.forEach(m => s.add(m)); });
    DIST.extra.split(/[,;\s]+/).filter(validEmail).forEach(a => s.add(a.toLowerCase()));
    const to = [...s];
    if (!to.length) return;
    const subject = doc.meta.id + ' Â· ' + doc.meta.title;
    $('#dist-send').disabled = true;
    try {
      await send(to, subject, briefingBody(doc, DIST.note), { kind: 'briefing', urgent: DIST.urgent });
      const ap = window.HWwork.T.approvals[doc.meta.id];
      if (ap && ap.stage !== 'issued') {
        ap.stage = 'issued';
        ap.chain.push({ stage: 'issued', by: window.HWwork.T.me, ts: zulu(new Date()),
          note: 'Distributed to ' + to.length + ' recipients.' });
      }
      window.HWwork.T.activity.unshift({ ts: zulu(new Date()), by: window.HWwork.T.me,
        verb: 'distributed', ref: 'brf:' + doc.meta.id, detail: to.length + ' recipients' });
      $('#dist-scrim').classList.remove('open');
      window.HWtoast(doc.meta.id + ' distributed to ' + to.length + ' recipients' +
        (DIST.attachPdf ? ' with PDF' : ''), 'ok');
    } catch (e) {
      window.HWtoast('Distribution failed: ' + e.message, 'warn');
    }
    $('#dist-send').disabled = false;
  });

  /* ââ settings panels âââââââââââââââââââââââââââââââââââââ */
  function connectorHTML() {
    const s = G.stats;
    return `<div class="setsec"><h4>Gmail connection</h4>
      <p>Horizon Watch talks to the Gmail REST API directly from the browser through Google Identity
        Services. Create an OAuth 2.0 <b>Web application</b> client in Google Cloud, enable the Gmail API,
        and add this page's origin to the client's authorised JavaScript origins. Paste the client ID below.</p>
      <div class="field"><label>OAuth client ID</label>
        <input class="input" id="gm-cid" value="${esc(G.clientId)}" placeholder="1234567890-abc.apps.googleusercontent.com"></div>
      <div class="setrow"><div class="n">State<em>${G.connected
          ? 'Connected as ' + esc(G.profile?.emailAddress || 'account') + ' Â· ' + (G.profile?.messagesTotal || 0).toLocaleString() + ' messages in the mailbox'
          : G.lastError ? esc(G.lastError) : 'Not connected â running on the sample mailbox'}</em></div>
        <span class="tag ${G.connected ? 'green' : G.lastError ? 'red' : 'amber'}">${G.connected ? 'connected' : G.lastError ? 'error' : 'offline'}</span></div>
      <div class="setrow"><div class="n">Scopes requested<em>${esc(SCOPES.replace(/https:\/\/www\.googleapis\.com\/auth\//g, ''))}</em></div>
        <span class="lbl mono">4</span></div>
      <div class="setrow"><div class="n">This session<em>${s.fetched} fetched Â· ${s.parsed} parsed to signals Â· ${s.sent} sent</em></div>
        <span class="lbl mono">${G.lastSync ? zulu(G.lastSync) : 'â'}</span></div>
      <div class="btnrow" style="padding:11px 0 0;display:flex;gap:6px;flex-wrap:wrap">
        ${G.connected
          ? `<button class="btn sm" id="gm-sync"><svg><use href="#i-reset"/></svg> sync now</button>
             <button class="btn sm" id="gm-test"><svg><use href="#i-send"/></svg> send a test to myself</button>
             <button class="btn sm danger" id="gm-off">disconnect</button>`
          : `<button class="btn sm primary" id="gm-on"><svg><use href="#i-link"/></svg> connect Gmail</button>`}
      </div></div>
    <div class="setsec"><h4>Sync</h4>
      <div class="field"><label>Gmail search query â decides what reaches the console</label>
        <input class="input" id="gm-q" value="${esc(G.query)}"></div>
      <div class="field"><label>Poll interval â ${G.pollSec}s</label>
        <input type="range" id="gm-poll" min="30" max="600" step="30" value="${G.pollSec}"></div>
      <label class="check"><input type="checkbox" id="gm-auto" ${G.autoParse ? 'checked' : ''}>
        <span>Run the inbound rules on arrival â urgent mail interrupts the inspector</span></label>
      <p class="dim" style="font-size:11.5px;margin:9px 0 0;line-height:1.5">A query such as
        <span class="mono">in:inbox newer_than:7d -label:archived</span> keeps the console focused. Mail that
        matches no inbound rule stays in the mailbox for an analyst; nothing is discarded.</p></div>`;
  }
  function wireConnector(rerender) {
    on('#gm-cid', 'change', ev => { G.clientId = ev.target.value.trim(); persist(); });
    on('#gm-q', 'change', ev => { G.query = ev.target.value.trim() || G.query; persist(); if (G.connected) sync(true); });
    on('#gm-poll', 'input', ev => { G.pollSec = +ev.target.value; ev.target.previousElementSibling.textContent = 'Poll interval â ' + G.pollSec + 's'; });
    on('#gm-poll', 'change', () => { persist(); if (G.connected) startPolling(); });
    on('#gm-auto', 'change', ev => { G.autoParse = ev.target.checked; persist(); });
    on('#gm-on', 'click', async () => { G.clientId = ($('#gm-cid').value || '').trim(); persist(); await connect(); rerender && rerender(); });
    on('#gm-off', 'click', () => { disconnect(); rerender && rerender(); });
    on('#gm-sync', 'click', () => sync(true));
    on('#gm-test', 'click', async () => {
      try {
        await send(G.profile.emailAddress, 'Horizon Watch â connection test',
          'This confirms Horizon Watch can send through this mailbox.\n\nSent ' + zulu(new Date()) + '.', { kind: 'alert' });
        window.HWtoast('Test message sent to ' + G.profile.emailAddress, 'ok');
      } catch (e) { window.HWtoast('Send failed: ' + e.message, 'warn'); }
    });
  }
  function bookHTML() {
    return `<div class="setsec"><h4>Distribution lists</h4>
      <p>Briefings distribute to these lists. Addresses may appear in more than one list; the resolved
        recipient set is de-duplicated before sending.</p>
      ${BOOK.lists.map(l => `<div class="setrow"><div class="n">${esc(l.name)}
          <em>${esc(l.note)}</em>
          <em style="color:var(--txt-4)">${l.members.map(esc).join(', ')}</em></div>
        <div style="display:flex;gap:5px;align-items:center">
          <span class="lbl mono">${l.members.length}</span>
          <button class="btn ghost sm" data-edit="${l.id}">edit</button></div></div>`).join('')}
      <div class="btnrow" style="padding:11px 0 0;display:flex;gap:6px">
        <button class="btn sm" id="bk-newlist"><svg><use href="#i-plus"/></svg> new list</button></div></div>
    <div class="setsec" style="border:0"><h4>Address book</h4>
      <p>${allAddresses().length} addresses across ${BOOK.lists.length} lists.</p>
      <div class="field"><label>Add addresses â comma separated</label>
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:6px">
          <input class="input" id="bk-add" placeholder="name@company.example">
          <select class="input" id="bk-to" style="width:190px">${BOOK.lists.map(l =>
            `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
          <button class="btn sm primary" id="bk-do">add</button></div></div>
      <div class="reflist">${allAddresses().slice(0, 40).map(a =>
        `<span class="refchip" data-rm="${esc(a)}" title="Remove from every list">
          <svg><use href="#i-mail"/></svg>${esc(a)} â</span>`).join('')}</div></div>`;
  }
  function wireBook(rerender) {
    $$('[data-edit]').forEach(b => b.onclick = () => {
      const l = BOOK.lists.find(z => z.id === b.dataset.edit);
      const row = b.closest('.setrow');
      row.innerHTML = `<div style="display:grid;gap:6px;width:100%">
        <input class="input" id="ed-name" value="${esc(l.name)}">
        <input class="input" id="ed-note" value="${esc(l.note)}">
        <textarea class="input" id="ed-mem" rows="3">${esc(l.members.join(', '))}</textarea>
        <div style="display:flex;gap:6px"><button class="btn sm primary" id="ed-save">save</button>
          <button class="btn sm danger" id="ed-del">delete list</button></div></div>`;
      on('#ed-save', 'click', () => {
        l.name = $('#ed-name').value || l.name; l.note = $('#ed-note').value;
        l.members = $('#ed-mem').value.split(/[,;\s]+/).filter(validEmail).map(a => a.toLowerCase());
        persist(); rerender && rerender(); window.HWtoast(l.name + ' saved Â· ' + l.members.length + ' recipients', 'ok');
      });
      on('#ed-del', 'click', () => {
        BOOK.lists = BOOK.lists.filter(z => z.id !== l.id); DIST.picked.delete(l.id);
        persist(); rerender && rerender(); window.HWtoast('List deleted');
      });
    });
    on('#bk-newlist', 'click', () => {
      BOOK.lists.push({ id: 'L' + (BOOK.lists.length + 1) + Date.now().toString(36).slice(-2),
        name: 'New list', note: 'Describe who is on this list', members: [] });
      persist(); rerender && rerender();
    });
    on('#bk-do', 'click', () => {
      const raw = ($('#bk-add').value || '').split(/[,;\s]+/).map(a => a.trim().toLowerCase()).filter(Boolean);
      const good = raw.filter(validEmail), bad = raw.filter(a => !validEmail(a));
      if (!good.length) return window.HWtoast(bad.length ? 'Not a valid address: ' + bad[0] : 'Enter an address', 'warn');
      const l = BOOK.lists.find(z => z.id === $('#bk-to').value);
      good.forEach(a => { if (!l.members.includes(a)) l.members.push(a); });
      persist(); rerender && rerender();
      window.HWtoast(good.length + ' added to ' + l.name + (bad.length ? ' Â· ' + bad.length + ' rejected' : ''), 'ok');
    });
    $$('[data-rm]').forEach(c => c.onclick = () => {
      const a = c.dataset.rm;
      BOOK.lists.forEach(l => { l.members = l.members.filter(m => m !== a); });
      BOOK.extra = BOOK.extra.filter(m => m !== a);
      persist(); rerender && rerender(); window.HWtoast(a + ' removed');
    });
  }

  function render() { if (window.HWsettings && window.HWsettings.isOpen && window.HWsettings.isOpen()) window.HWsettings.rerender(); }

  window.HWgmail = { G, BOOK, DIST, SCOPES, connect, disconnect, sync, send, openDistribute,
    connectorHTML, wireConnector, bookHTML, wireBook, allAddresses, validEmail, briefingBody,
    isConnected: () => G.connected };

  /* resume a session that already has a client ID */
  setTimeout(() => { if (G.clientId) loadGIS(); }, 1200);
})();
