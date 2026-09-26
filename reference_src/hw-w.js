/* Horizon Watch â Workstation.
   Mode switch, identity, mail (in and out), cases, RFIs, comments with
   @mentions, presence, assignment, approval chain, shift handover, and the
   urgent interrupt that reaches the analyst wherever they are.

   Loaded last; extends the shell through its published globals. */
(function () {
  const D = window.HW, X = window.HW2, W = window.HW3, DOM = D.DOMAINS, SEV = D.SEV, S = window.HWS;
  const { $, $$, zulu, hhmm, ago, esc } = window.HWU;
  const on = (s, e, f) => { const n = typeof s === 'string' ? $(s) : s; if (n) n.addEventListener(e, f); };
  const SH = window.HWshell, M = window.HWmap;
  const KEY = 'horizonwatch.workstation.v1';

  const WATCH_MODS = ['map', 'inbox', 'dossier', 'analytics', 'generate', 'replay', 'ontology', 'imagery', 'reader'];
  const WORK_MODS  = ['work', 'mail', 'cases', 'team'];

  const T = {
    mode: 'watch', me: W.me,
    users: W.users.map(u => ({ ...u })),
    mail: W.mail.map(m => ({ ...m })),
    cases: W.cases.map(c => ({ ...c })),
    rfis: W.rfis.map(r => ({ ...r })),
    comments: W.comments.map(c => ({ ...c })),
    notes: W.notifications.map(n => ({ ...n })),
    activity: W.activity.slice(),
    assignments: W.assignments.map(a => ({ ...a })),
    approvals: JSON.parse(JSON.stringify(W.approvals)),
    handovers: W.handovers.slice(),
    sent: W.sent.slice(),
    outbound: W.outbound.map(o => ({ ...o })),
    dismissed: [],                     // interrupt ids the analyst has cleared
    ui: { queue: 'assigned', wkScope: 'mine', folder: 'inbox', mail: 'M-1042',
          case: 'CS-0014', caseTab: 'overview', team: 'roster', mailQ: '' }
  };
  const me = () => T.users.find(u => u.id === T.me) || T.users[0];
  const user = id => T.users.find(u => u.id === id) || { name: 'Unknown', initials: '??', color: '#6d7883', role: 'analyst' };
  const can = act => (W.ROLES[me().role] || { can: [] }).can.includes(act);

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ me: T.me, mode: T.mode, dismissed: T.dismissed,
      users: T.users, notes: T.notes, comments: T.comments, assignments: T.assignments })); } catch (e) {}
  }
  (function restore() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!r) return;
      if (r.me) T.me = r.me;
      if (r.mode) T.mode = r.mode;
      T.dismissed = r.dismissed || [];
      if (r.users && r.users.length) T.users = r.users;
      if (r.notes) T.notes = r.notes;
      if (r.comments) T.comments = r.comments;
      if (r.assignments) T.assignments = r.assignments;
    } catch (e) {}
  })();

  const avatar = (id, cls) => { const u = user(id);
    return `<span class="av ${cls || ''}" style="background:${u.color}" title="${esc(u.name)}">${u.initials}</span>`; };

  /* ââ reference grammar: one resolver for every record type ââ */
  function refLabel(ref) {
    const [k, id] = String(ref).split(':');
    if (k === 'sig') { const e = D.events.find(x => x.id === id); return e ? e.title : id; }
    if (k === 'ent') { const e = D.entities.find(x => x.id === id); return e ? e.name : id; }
    if (k === 'onto'){ const n = X.nodes.find(x => x.id === id); return n ? n.label : id; }
    if (k === 'scn') { const s = X.scenes.find(x => x.id === id); return s ? s.place : id; }
    if (k === 'aoi') { const a = (window.HWXaoi ? window.HWXaoi.list : []).find(x => x.id === id); return a ? a.name : id; }
    if (k === 'brf') { const b = D.briefings.find(x => x.id === id); return b ? b.title : id; }
    if (k === 'case'){ const c = T.cases.find(x => x.id === id); return c ? c.title : id; }
    if (k === 'mail'){ const m = T.mail.find(x => x.id === id); return m ? m.subject : id; }
    if (k === 'rfi') { const r = T.rfis.find(x => x.id === id); return r ? r.question.slice(0, 60) : id; }
    return id;
  }
  const REF_ICON = { sig: 'i-bell', ent: 'i-dossier', onto: 'i-onto', scn: 'i-sat', aoi: 'i-scan',
    brf: 'i-read', case: 'i-case', mail: 'i-mail', rfi: 'i-rfi' };

  function openRef(ref) {
    const [k, id] = String(ref).split(':');
    if (k === 'sig') { setMode('watch'); window.HWopen('map'); window.HWselect(id, { pan: true }); }
    else if (k === 'ent') { setMode('watch'); window.HWM.openEntity(id); }
    else if (k === 'onto') { setMode('watch'); window.HWX.openOntology(id); }
    else if (k === 'scn') { setMode('watch'); if (window.HWXaoi) window.HWXaoi.I.scene = id;
      window.HWopen('imagery'); if (window.HWXaoi) { window.HWXaoi.renderList(); window.HWXaoi.renderScene(); } }
    else if (k === 'aoi') { setMode('watch'); if (window.HWXaoi) { window.HWXaoi.sel = id; }
      window.HWopen('imagery'); if (window.HWXaoi) { window.HWXaoi.render(); window.HWXaoi.renderScene(); } }
    else if (k === 'brf') { setMode('watch'); window.HWM.openBriefing(id); }
    else if (k === 'case') { setMode('work'); T.ui.case = id; window.HWopen('cases', 'Case Â· ' + (T.cases.find(c => c.id === id) || {}).code); renderCases(); }
    else if (k === 'mail') { setMode('work'); T.ui.mail = id; T.ui.folder = 'inbox'; window.HWopen('mail'); renderMail(); }
    else if (k === 'rfi') { setMode('work'); T.ui.team = 'rfis'; window.HWopen('team'); renderTeam(); }
  }
  window.HWref = { open: openRef, label: refLabel, icon: k => REF_ICON[k] || 'i-link' };

  /* ââ mode switch âââââââââââââââââââââââââââââââââââââââââ
     Watch is the analysis surface, Workstation is comms and casework.
     Sessions persist across both; the rail swaps its module set. */
  let switching = false;
  function setMode(m, opts) {
    if (T.mode === m && !opts?.force) { if (opts?.open) window.HWopen(opts.open); return; }
    switching = true;
    T.mode = m; persist();
    $$('#ses-pop .modeswitch button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m));
    applyRailMode();
    const mods = m === 'work' ? WORK_MODS : WATCH_MODS;
    if (!mods.includes(S.module)) window.HWopen(m === 'work' ? 'work' : 'map');
    renderModeChip(); railBadges();
    switching = false;
  }
  /* One class on #app, read by CSS. Survives every rail re-render by
     construction â no observer, no re-application, nothing to lose a race with. */
  function applyRailMode() {
    document.getElementById('app').classList.toggle('mode-work', T.mode === 'work');
  }
  function renderModeChip() {
    const b = $('#ses-open'); if (!b) return;
    let chip = $('.mode', b);
    if (!chip) { chip = document.createElement('span'); chip.className = 'mode'; b.insertBefore(chip, $('i', b)); }
    chip.textContent = T.mode === 'work' ? 'WORK' : 'WATCH';
  }
  $$('#ses-pop .modeswitch button').forEach(b => b.onclick = ev => { ev.stopPropagation(); setMode(b.dataset.mode); });

  /* rail badges for workstation modules */
  function railBadges() {
    const unread = T.notes.filter(n => !n.read).length;
    const mailUnread = T.mail.filter(m => m.unread).length;
    const mine = T.assignments.filter(a => a.to === T.me && a.state === 'open').length;
    [['work', mine], ['mail', mailUnread], ['team', unread]].forEach(([mod, n]) => {
      const btn = $(`#modrail .mod[data-mod="${mod}"]`); if (!btn) return;
      let b = $('.badge', btn);
      if (!n) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement('span'); b.className = 'badge'; btn.appendChild(b); }
      b.textContent = n;
    });
  }

  /* ââ urgent interrupt ââââââââââââââââââââââââââââââââââââ
     Urgent mail, mentions and overdue RFIs must reach the analyst without
     them going looking. They surface at the top of the Situation inspector
     AND as a toast on arrival. */
  function urgentItems() {
    const out = [];
    T.notes.filter(n => n.urgent && !n.read && !T.dismissed.includes(n.id)).forEach(n =>
      out.push({ id: n.id, ref: n.ref, text: n.text, ts: n.ts, icon: REF_ICON[String(n.ref).split(':')[0]] || 'i-bell' }));
    T.rfis.filter(r => r.status === 'open' && r.to === T.me).forEach(r => {
      const id = 'RFI-DUE-' + r.id;
      if (!T.dismissed.includes(id)) out.push({ id, ref: 'rfi:' + r.id, ts: 'due ' + r.due,
        text: 'RFI awaiting your answer â ' + r.question.slice(0, 64) + 'â¦', icon: 'i-rfi' });
    });
    return out;
  }
  window.HWinterrupt = {
    inject(box) {
      const items = urgentItems();
      if (!box || !items.length) return;
      const el = document.createElement('div');
      el.className = 'interrupt';
      el.innerHTML = `<div class="ih"><svg><use href="#i-alert"/></svg><b>Needs you Â· ${items.length}</b>
          <button class="x" id="int-clear" title="Dismiss all">â</button></div>
        ${items.slice(0, 4).map(i => `<div class="irow" data-ref="${esc(i.ref)}" data-id="${esc(i.id)}">
          <svg><use href="#${i.icon}"/></svg>
          <div><div class="n">${esc(i.text)}</div><div class="t">${esc(i.ts)}</div></div></div>`).join('')}`;
      box.insertBefore(el, box.firstChild);
      on('#int-clear', 'click', ev => { ev.stopPropagation();
        items.forEach(i => T.dismissed.push(i.id)); persist(); el.remove(); });
      $$('.irow', el).forEach(r => r.onclick = () => {
        const n = T.notes.find(z => z.id === r.dataset.id); if (n) n.read = true;
        persist(); railBadges(); openRef(r.dataset.ref);
      });
    },
    count: () => urgentItems().length
  };

  /* announce the newest urgent item once per load, wherever the analyst is */
  setTimeout(() => {
    const u = urgentItems()[0];
    if (u) window.HWtoast(u.text.length > 76 ? u.text.slice(0, 74) + 'â¦' : u.text, 'warn');
  }, 1400);

  /* ââ comments: reusable on any record âââââââââââââââââââââ */
  const commentsFor = ref => T.comments.filter(c => c.ref === ref);
  function renderMention(body) {
    return esc(body).replace(/@([A-Z]\.\s?[A-Za-z]+)/g, '<span class="men">@$1</span>');
  }
  function commentHTML(c) {
    return `<div class="cmt ${c.resolved ? 'res' : ''}" data-id="${c.id}">
      ${avatar(c.by, 'sm')}
      <div><div class="h"><b>${esc(user(c.by).name)}</b>
        <span class="tag">${esc(W.ROLES[user(c.by).role].name)}</span><span class="t">${esc(c.ts)}</span></div>
        <div class="b">${renderMention(c.body)}</div>
        <div class="a"><button data-act="resolve" data-id="${c.id}">${c.resolved ? 'reopen' : 'resolve'}</button>
          <button data-act="reply" data-id="${c.id}">reply</button></div></div></div>`;
  }
  function composerHTML(ref, ph) {
    return `<textarea id="cm-text" placeholder="${esc(ph || 'Comment Â· type @ to mention someone')}"></textarea>
      <div class="cr"><span class="lbl">${esc(me().name)} Â· ${esc(W.ROLES[me().role].name)}</span>
        <button class="btn sm primary" id="cm-send" style="margin-left:auto">comment</button></div>
      <div class="mentionpop" id="cm-pop"></div>`;
  }
  function wireComposer(ref, after) {
    const ta = $('#cm-text'), pop = $('#cm-pop');
    if (!ta) return;
    let mIdx = 0, mList = [];
    const closePop = () => { pop.classList.remove('on'); mList = []; };
    ta.oninput = () => {
      const m = ta.value.slice(0, ta.selectionStart).match(/@([\w.\s]*)$/);
      if (!m) return closePop();
      const q = m[1].toLowerCase();
      mList = T.users.filter(u => u.id !== T.me && u.name.toLowerCase().includes(q)).slice(0, 6);
      if (!mList.length) return closePop();
      mIdx = 0;
      pop.innerHTML = mList.map((u, i) => `<button data-i="${i}" class="${i === 0 ? 'sel' : ''}">
        ${avatar(u.id, 'sm')}<span>${esc(u.name)}</span>
        <span class="lbl" style="margin-left:auto">${esc(W.ROLES[u.role].name)}</span></button>`).join('');
      const r = ta.getBoundingClientRect();
      pop.style.left = r.left + 'px'; pop.style.top = (r.bottom + 4) + 'px';
      pop.classList.add('on');
      $$('button', pop).forEach(b => b.onclick = () => pick(mList[+b.dataset.i]));
    };
    function pick(u) {
      ta.value = ta.value.replace(/@([\w.\s]*)$/, '@' + u.name + ' ');
      closePop(); ta.focus();
    }
    ta.onkeydown = ev => {
      if (pop.classList.contains('on')) {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          mIdx = Math.max(0, Math.min(mList.length - 1, mIdx + (ev.key === 'ArrowDown' ? 1 : -1)));
          $$('button', pop).forEach((b, i) => b.classList.toggle('sel', i === mIdx));
          return;
        }
        if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); return pick(mList[mIdx]); }
        if (ev.key === 'Escape') return closePop();
      }
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); send(); }
    };
    function send() {
      const body = ta.value.trim(); if (!body) return;
      const mentions = T.users.filter(u => body.includes('@' + u.name)).map(u => u.id);
      T.comments.push({ id: 'C-' + Date.now().toString(36), ref, by: T.me, ts: zulu(new Date()),
        body, mentions, resolved: false });
      mentions.forEach(uid => {
        if (uid === T.me) return;
        T.notes.unshift({ id: 'N-' + Date.now().toString(36) + uid, kind: 'mention', ref, by: T.me,
          ts: zulu(new Date()), read: false, urgent: false,
          text: me().name + ' mentioned ' + user(uid).name.split(' ')[1] + ' on ' + refLabel(ref).slice(0, 40) });
      });
      T.activity.unshift({ ts: zulu(new Date()), by: T.me, verb: 'commented on', ref, detail: body.slice(0, 60) });
      ta.value = ''; persist(); railBadges();
      window.HWtoast(mentions.length ? mentions.length + ' person notified' : 'Comment added', 'ok');
      after && after();
    }
    on('#cm-send', 'click', send);
    $$('[data-act]').forEach(b => b.onclick = () => {
      const c = T.comments.find(z => z.id === b.dataset.id); if (!c) return;
      if (b.dataset.act === 'resolve') { c.resolved = !c.resolved; persist(); after && after(); }
      else { ta.value = '@' + user(c.by).name + ' '; ta.focus(); }
    });
  }
  /* published so any module can host a comment rail */
  window.HWcomments = {
    for: commentsFor,
    inject(box, ref) {
      if (!box) return;
      const list = commentsFor(ref);
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `<span class="lbl" style="display:flex;align-items:center;gap:7px">
          <svg style="width:12px;height:12px;color:var(--txt-3)"><use href="#i-comment"/></svg>Discussion
          <span style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--txt-4)">${list.length}</span></span>
        <div style="margin:0 -11px">${list.map(commentHTML).join('') ||
          '<p class="dim" style="font-size:12px;margin:0;padding:0 11px">No discussion yet.</p>'}</div>
        <div style="margin-top:9px">${composerHTML(ref)}</div>`;
      const anchor = box.querySelector('.btnrow');
      anchor ? anchor.before(el) : box.appendChild(el);
      wireComposer(ref, () => { el.remove(); window.HWcomments.inject(box, ref); });
    }
  };

  /* ââ assignment âââââââââââââââââââââââââââââââââââââââââââ */
  const assignFor = ref => T.assignments.find(a => a.ref === ref && a.state === 'open');
  window.HWassign = {
    for: assignFor,
    inject(box, ref) {
      if (!box) return;
      const a = assignFor(ref);
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `<span class="lbl">Assignment</span>
        ${a ? `<div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">
            ${avatar(a.to, 'sm')}<span style="font-size:12.5px">${esc(user(a.to).name)}</span>
            <span class="tag">due ${esc(a.due)}</span>
            <span class="lbl" style="margin-left:auto">by ${esc(user(a.by).name.split(' ')[1])}</span></div>`
          : '<p class="dim" style="font-size:12px;margin:0 0 9px">Unassigned.</p>'}
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:6px">
          <select class="input" id="as-to">${T.users.map(u =>
            `<option value="${u.id}" ${a && a.to === u.id ? 'selected' : ''}>${esc(u.name)} Â· ${esc(W.ROLES[u.role].name)}</option>`).join('')}</select>
          <input class="input" id="as-due" value="${a ? esc(a.due) : ''}" placeholder="D+3" style="width:74px">
          <button class="btn sm primary" id="as-set">${a ? 'reassign' : 'assign'}</button></div>
        ${a ? `<button class="btn sm" id="as-done" style="margin-top:6px;width:100%"><svg><use href="#i-check"/></svg> mark done</button>` : ''}`;
      const anchor = box.querySelector('.btnrow');
      anchor ? anchor.before(el) : box.appendChild(el);
      on('#as-set', 'click', () => {
        if (!can('assign')) return window.HWtoast('Your role cannot assign work', 'warn');
        const to = $('#as-to').value, due = $('#as-due').value || 'D+3';
        if (a) { a.to = to; a.due = due; a.by = T.me; }
        else T.assignments.push({ ref, to, by: T.me, due, state: 'open' });
        if (to !== T.me) T.notes.unshift({ id: 'N-' + Date.now().toString(36), kind: 'assigned', ref, by: T.me,
          ts: zulu(new Date()), read: false, urgent: false,
          text: me().name + ' assigned ' + refLabel(ref).slice(0, 44) + ' to ' + user(to).name });
        T.activity.unshift({ ts: zulu(new Date()), by: T.me, verb: 'assigned', ref, detail: 'to ' + user(to).name });
        persist(); railBadges();
        window.HWtoast('Assigned to ' + user(to).name + ' Â· due ' + due, 'ok');
        el.remove(); window.HWassign.inject(box, ref);
      });
      on('#as-done', 'click', () => { a.state = 'done'; persist(); railBadges();
        window.HWtoast('Marked done'); el.remove(); window.HWassign.inject(box, ref); });
    }
  };

  /* presence: who else has this record open */
  window.HWpresence = {
    inject(box, ref) {
      if (!box) return;
      const seed = String(ref).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      const others = T.users.filter(u => u.id !== T.me && u.status === 'online')
        .filter((u, i) => (seed + i * 7) % 3 === 0).slice(0, 3);
      if (!others.length) return;
      const el = document.createElement('div');
      el.className = 'viewing';
      el.innerHTML = others.map(u => avatar(u.id, 'sm')).join('') +
        `<span>${others.length === 1 ? esc(others[0].name) + ' is' : others.length + ' others are'} viewing this</span>`;
      box.insertBefore(el, box.firstChild);
    }
  };

  /* âââââââââ MY WORK âââââââââ */
  const QUEUES = [
    ['assigned', 'Assigned to me', 'i-work'], ['mentions', 'Mentions', 'i-comment'],
    ['rfis', 'RFIs to answer', 'i-rfi'], ['cases', 'My cases', 'i-case'],
    ['review', 'Awaiting my review', 'i-stamp'], ['mail', 'Urgent mail', 'i-mail'],
    ['unack', 'Unreviewed signals', 'i-bell']
  ];
  function queueItems(q, scope) {
    const mine = a => scope === 'mine' ? a.to === T.me : scope === 'unassigned' ? false : true;
    if (q === 'assigned') return T.assignments.filter(a => a.state === 'open' && (scope === 'unassigned' ? false : mine(a)))
      .map(a => ({ ref: a.ref, sub: 'assigned by ' + user(a.by).name, due: a.due, who: a.to }));
    if (q === 'mentions') return T.notes.filter(n => n.kind === 'mention' && (scope !== 'mine' || !n.read))
      .map(n => ({ ref: n.ref, sub: n.text, due: n.ts, who: n.by }));
    if (q === 'rfis') return T.rfis.filter(r => r.status === 'open' && (scope === 'mine' ? r.to === T.me : true))
      .map(r => ({ ref: 'rfi:' + r.id, sub: r.question, due: r.due, who: r.to }));
    if (q === 'cases') return T.cases.filter(c => c.status !== 'closed' && (scope === 'mine' ? (c.owner === T.me || (c.watchers || []).includes(T.me)) : true))
      .map(c => ({ ref: 'case:' + c.id, sub: c.summary, due: c.due, who: c.owner }));
    if (q === 'review') return D.briefings.filter(b => (T.approvals[b.id] || {}).stage === 'review' || b.status === 'draft')
      .map(b => ({ ref: 'brf:' + b.id, sub: 'awaiting review', due: 'â', who: T.me }));
    if (q === 'mail') return T.mail.filter(m => m.urgent && m.unread)
      .map(m => ({ ref: 'mail:' + m.id, sub: m.fromName + ' Â· ' + m.subject, due: ago(m.hoursAgo), who: null }));
    if (q === 'unack') return D.events.filter(e => e.status === 'new').slice(0, 20)
      .map(e => ({ ref: 'sig:' + e.id, sub: e.place + ' Â· ' + DOM[e.domain].name, due: ago(e.hoursAgo), who: null }));
    return [];
  }
  function renderWork() {
    const scope = T.ui.wkScope;
    $('#wk-queues').innerHTML = QUEUES.map(([k, n, ic]) => {
      const c = queueItems(k, scope).length;
      const hot = (k === 'rfis' || k === 'mail') && c;
      return `<button class="qrow" data-q="${k}" aria-selected="${T.ui.queue === k}">
        <svg><use href="#${ic}"/></svg><span>${n}</span><span class="c ${hot ? 'hot' : ''}">${c}</span></button>`;
    }).join('') + `<div class="sect" style="border:0;padding:12px"><span class="lbl" style="display:block;margin-bottom:7px;font-weight:600;color:var(--txt-2)">Signed in</span>
      <div style="display:flex;align-items:center;gap:9px">${avatar(T.me, 'lg')}
        <div><div style="font-size:12.5px">${esc(me().name)}</div>
          <div class="lbl" style="font-size:11px">${esc(W.ROLES[me().role].name)} Â· ${esc(me().shift)}</div></div></div>
      <button class="btn sm" id="wk-switch" style="margin-top:9px;width:100%">switch user</button></div>`;
    $$('#wk-queues .qrow').forEach(b => b.onclick = () => { T.ui.queue = b.dataset.q; renderWork(); });
    on('#wk-switch', 'click', openWho);

    const items = queueItems(T.ui.queue, scope);
    const qn = (QUEUES.find(q => q[0] === T.ui.queue) || [])[1];
    $('#wk-title').textContent = qn;
    $('#wk-count').textContent = items.length + ' item' + (items.length === 1 ? '' : 's');
    $('#wk-total').textContent = T.assignments.filter(a => a.to === T.me && a.state === 'open').length + ' open';
    $('#wk-list').innerHTML = items.length ? items.map(i => {
      const k = String(i.ref).split(':')[0];
      const sig = k === 'sig' ? D.events.find(e => 'sig:' + e.id === i.ref) : null;
      const over = /^\d/.test(String(i.due)) && parseInt(i.due) < 4;
      return `<div class="wrow" data-ref="${esc(i.ref)}">
        ${sig ? `<i class="dia" style="background:${SEV[sig.severity].color}"></i>`
              : `<svg style="width:12px;height:12px;color:var(--txt-4);margin-top:3px"><use href="#${REF_ICON[k]}"/></svg>`}
        <div><h5>${esc(refLabel(i.ref))}</h5>
          <div class="m"><span class="mono">${esc(String(i.ref).split(':')[1])}</span>
            <span>${esc(String(i.sub).slice(0, 88))}</span></div></div>
        ${i.who ? avatar(i.who, 'sm') : '<span></span>'}
        <span class="due ${over ? 'over' : ''}">${esc(i.due)}</span></div>`;
    }).join('') : `<div class="empty"><svg><use href="#i-check"/></svg>
      <p>Nothing in this queue. ${T.ui.queue === 'assigned' ? 'Work assigned to you appears here.' : ''}</p></div>`;
    $$('#wk-list .wrow').forEach(r => r.onclick = () => openRef(r.dataset.ref));

    /* the day column: calendar, due dates, scheduled scans */
    const cal = W.calendar;
    $('#wk-day').innerHTML = `<div class="sect" style="padding:11px 12px;border-bottom:1px solid var(--line-soft)">
        <span class="lbl" style="display:block;margin-bottom:7px;font-weight:600;color:var(--txt-2)">Today and next</span>
        ${cal.map(c => `<div class="dayrow"><span class="h">${esc(c.ts.split(' ')[1] || c.ts)}</span>
          <div><div>${esc(c.title)}</div><div class="k">${esc(c.ts.split(' ')[0])} Â· ${esc(c.kind)}${c.with ? ' Â· ' + c.with.split(', ').map(u => user(u).name.split(' ')[1]).join(', ') : ''}</div></div></div>`).join('')}
      </div>
      <div class="sect" style="padding:11px 12px;border:0">
        <span class="lbl" style="display:block;margin-bottom:7px;font-weight:600;color:var(--txt-2)">Recent team activity</span>
        ${T.activity.slice(0, 7).map(a => `<div class="actrow" style="padding:6px 0;border-bottom:1px solid var(--line-soft)">
          ${a.by ? avatar(a.by, 'sm') : '<svg style="width:14px;height:14px;color:var(--txt-4)"><use href="#i-mail"/></svg>'}
          <div>${a.by ? esc(user(a.by).name.split(' ')[1]) + ' ' : ''}${esc(a.verb)}
            <span class="r" data-ref="${esc(a.ref)}">${esc(String(a.ref).split(':')[1])}</span></div>
          <span class="t">${esc(a.ts.split(' ')[1] || a.ts)}</span></div>`).join('')}
      </div>`;
    $$('#wk-day .r').forEach(r => r.onclick = () => openRef(r.dataset.ref));
    railBadges();
  }
  $$('#wk-scope button').forEach(b => b.onclick = () => {
    $$('#wk-scope button').forEach(x => x.setAttribute('aria-pressed', x === b));
    T.ui.wkScope = b.dataset.s; renderWork();
  });

  /* âââââââââ MAIL âââââââââ */
  const FOLDERS = [['inbox', 'Inbox', 'i-mail'], ['urgent', 'Urgent', 'i-alert'], ['parsed', 'Raised as signals', 'i-flag'],
    ['attach', 'With attachments', 'i-attach'], ['sent', 'Sent', 'i-send'], ['rules', 'Inbound rules', 'i-merge'],
    ['outbound', 'Automatic mail', 'i-repeat']];
  function mailRows() {
    const q = T.ui.mailQ.toLowerCase();
    let rows = T.mail;
    if (T.ui.folder === 'urgent') rows = rows.filter(m => m.urgent);
    if (T.ui.folder === 'parsed') rows = rows.filter(m => m.state === 'parsed');
    if (T.ui.folder === 'attach') rows = rows.filter(m => m.attachments.length);
    if (q) rows = rows.filter(m => (m.subject + m.body + m.fromName).toLowerCase().includes(q));
    return rows.sort((a, b) => a.hoursAgo - b.hoursAgo);
  }
  function renderMail() {
    $('#ml-unread').textContent = T.mail.filter(m => m.unread).length + ' unread';
    $('#ml-nav').innerHTML = FOLDERS.map(([k, n, ic]) => {
      const c = k === 'sent' ? T.sent.length : k === 'rules' ? W.parseRules.length : k === 'outbound' ? T.outbound.length
        : k === 'inbox' ? T.mail.length : k === 'urgent' ? T.mail.filter(m => m.urgent).length
        : k === 'parsed' ? T.mail.filter(m => m.state === 'parsed').length : T.mail.filter(m => m.attachments.length).length;
      return `<button class="qrow" data-f="${k}" aria-selected="${T.ui.folder === k}">
        <svg><use href="#${ic}"/></svg><span>${n}</span><span class="c ${k === 'urgent' && c ? 'hot' : ''}">${c}</span></button>`;
    }).join('') + `<div class="sect" style="border:0;padding:11px 12px">
      <span class="lbl" style="display:block;margin-bottom:6px;font-weight:600;color:var(--txt-2)">Mailbox</span>
      <dl class="kv"><dt>Provider</dt><dd>${esc(W.mailbox.provider)}</dd>
        <dt>Account</dt><dd class="mono" style="font-size:11px">${esc(W.mailbox.account)}</dd>
        <dt>State</dt><dd><span class="tag green">connected</span></dd>
        <dt>Last sync</dt><dd>${esc(W.mailbox.lastSync)}</dd>
        <dt>Today</dt><dd class="mono">${W.mailbox.inboundToday} in Â· ${W.mailbox.outboundToday} out</dd></dl></div>`;
    $$('#ml-nav .qrow').forEach(b => b.onclick = () => { T.ui.folder = b.dataset.f; renderMail(); });
    $('#ml-folder').textContent = (FOLDERS.find(f => f[0] === T.ui.folder) || [])[1];

    if (T.ui.folder === 'sent') return renderSent();
    if (T.ui.folder === 'rules') return renderRules();
    if (T.ui.folder === 'outbound') return renderOutbound();

    const rows = mailRows();
    $('#ml-count').textContent = rows.length + ' message' + (rows.length === 1 ? '' : 's');
    $('#ml-list').innerHTML = rows.map(m => `<button class="mrow ${m.unread ? 'unread' : 'read'}" data-id="${m.id}" aria-selected="${m.id === T.ui.mail}">
      <i class="dot ${m.urgent ? 'urgent' : m.unread ? '' : 'off'}"></i>
      <div><div class="f">${esc(m.fromName)}
          ${m.attachments.length ? '<svg style="width:11px;height:11px;color:var(--txt-4)"><use href="#i-attach"/></svg>' : ''}
          ${m.state === 'parsed' ? '<span class="tag blue">signal</span>' : ''}
          ${m.caseId ? '<span class="tag">' + esc(m.caseId) + '</span>' : ''}</div>
        <div class="s">${esc(m.subject)}</div>
        <div class="p">${esc(m.body.split('\\n')[0].slice(0, 90))}</div></div>
      <span class="t">${ago(m.hoursAgo)}</span></button>`).join('') ||
      `<div class="empty"><svg><use href="#i-mail"/></svg><p>No messages in this folder.</p></div>`;
    $$('#ml-list .mrow').forEach(b => b.onclick = () => { T.ui.mail = b.dataset.id; openMail(); });
    openMail();
    railBadges();
  }
  function openMail() {
    const m = T.mail.find(x => x.id === T.ui.mail);
    const box = $('#ml-read');
    if (!m) { box.innerHTML = `<div class="empty"><svg><use href="#i-mail"/></svg><p>Select a message.</p></div>`; return; }
    if (m.unread) { m.unread = false; renderMail(); return; }
    $$('#ml-list .mrow').forEach(b => b.setAttribute('aria-selected', b.dataset.id === m.id));
    const sig = m.signalId ? D.events.find(e => e.id === m.signalId) : null;
    box.innerHTML = `<div class="mread">
      ${m.urgent ? '<div class="parsed" style="background:rgba(196,69,60,.12);border-color:#5c3b38"><svg style="color:#cf6259"><use href="#i-alert"/></svg><span><b>Urgent</b> â flagged by rule PR-6 and pushed to the duty analyst.</span></div>' : ''}
      <h2>${esc(m.subject)}</h2>
      <div class="from">
        <span class="av" style="background:var(--bg-4);color:var(--txt-2)">${esc(m.fromName.slice(0, 2).toUpperCase())}</span>
        <div><b>${esc(m.fromName)}</b><em>${esc(m.from)} Â· to ${esc(m.to[0])}</em></div>
        <span class="lbl mono">${esc(zulu(m.ts))}</span></div>
      ${m.state === 'parsed' ? `<div class="parsed"><svg><use href="#i-flag"/></svg>
        <span>Raised as <b>${esc(m.signalId || 'a signal')}</b> by the inbound rules${sig ? ' Â· ' + esc(SEV[sig.severity].name).toLowerCase() + ' Â· ' + esc(sig.place) : ''}.</span>
        ${sig ? '<button class="btn ghost sm" id="ml-open-sig" style="margin-left:auto">open â</button>' : ''}</div>` : ''}
      <div class="bodytext">${esc(m.body)}</div>
      ${m.attachments.length ? `<span class="lbl" style="display:block;margin-bottom:6px">Attachments Â· ${m.attachments.length}</span>
        ${m.attachments.map(a => `<div class="attrow" data-n="${esc(a.name)}">
          <svg><use href="#i-attach"/></svg><span>${esc(a.name)}</span><span class="sz">${esc(a.size)}</span></div>`).join('')}` : ''}
      <dl class="kv" style="margin-top:12px"><dt>Source</dt><dd>${esc(m.src)}</dd>
        <dt>Reliability</dt><dd class="mono">${Math.round(m.rel * 100)}%</dd>
        <dt>Labels</dt><dd>${m.labels.map(l => '<span class="tag">' + esc(l) + '</span>').join(' ') || 'â'}</dd>
        <dt>Case</dt><dd>${m.caseId ? '<span class="refchip" data-ref="case:' + m.caseId + '">' + esc(m.caseId) + '</span>' : 'not attached'}</dd></dl>
      <div class="btnrow" style="padding:12px 0 0;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn sm primary" id="ml-reply"><svg><use href="#i-send"/></svg> reply</button>
        ${m.state === 'parsed' ? '' : '<button class="btn sm" id="ml-raise"><svg><use href="#i-flag"/></svg> raise signal</button>'}
        <button class="btn sm" id="ml-attach"><svg><use href="#i-case"/></svg> attach to case</button>
        <button class="btn sm" id="ml-rfi"><svg><use href="#i-rfi"/></svg> raise RFI</button></div>
    </div>`;
    on('#ml-open-sig', 'click', () => openRef('sig:' + m.signalId));
    $$('#ml-read .refchip').forEach(r => r.onclick = () => openRef(r.dataset.ref));
    $$('#ml-read .attrow').forEach(a => a.onclick = () => window.HWtoast('Attachment preview is not available in this build', 'warn'));
    on('#ml-reply', 'click', () => openCompose({ to: m.from, subject: 'Re: ' + m.subject, ref: 'mail:' + m.id }));
    on('#ml-raise', 'click', () => raiseSignal(m));
    on('#ml-attach', 'click', () => attachToCase('mail:' + m.id));
    on('#ml-rfi', 'click', () => openRFI({ ref: 'mail:' + m.id, question: 'Regarding "' + m.subject + '": ' }));
    window.HWcomments.inject($('#ml-read .mread'), 'mail:' + m.id);
  }
  function raiseSignal(m) {
    const src = m.src, id = 'HW-' + (2500 + D.events.length * 7);
    const ev = {
      id, ts: m.ts, hoursAgo: m.hoursAgo, lat: 14.5, lon: 42.5,
      place: 'From mail Â· ' + m.fromName, country: 'â', iso3: 'XXX', region: 'EMEA',
      domain: m.labels.includes('corridor') ? 'maritime' : m.labels.includes('compliance') ? 'trade' : 'political',
      severity: m.urgent ? 'high' : 'moderate', conf: m.rel, source: src,
      title: m.subject.replace(/^URGENT:\s*/i, ''), summary: m.body.split('\n')[0],
      impacts: m.labels, status: 'new'
    };
    D.events.unshift(ev); m.signalId = id; m.state = 'parsed';
    T.activity.unshift({ ts: zulu(new Date()), by: T.me, verb: 'raised a signal from', ref: 'mail:' + m.id, detail: id });
    SH.renderInbox(); SH.drawMarkers(); renderMail();
    window.HWtoast(id + ' raised from mail and queued for triage', 'ok');
  }
  function renderSent() {
    $('#ml-count').textContent = T.sent.length + ' sent';
    $('#ml-list').innerHTML = T.sent.map(s => `<div class="mrow read" style="cursor:default">
      <i class="dot off"></i>
      <div><div class="f">${esc(s.to)}<span class="tag ${s.kind === 'briefing' ? 'green' : s.kind === 'alert' ? 'red' : ''}">${esc(s.kind)}</span></div>
        <div class="s">${esc(s.subject)}</div>
        <div class="p">delivered ${s.receipts.delivered} Â· opened ${s.receipts.opened}${s.receipts.failed ? ' Â· failed ' + s.receipts.failed : ''}</div></div>
      <span class="t">${esc(s.ts.split(' ')[1] || s.ts)}</span></div>`).join('');
    $('#ml-read').innerHTML = `<div class="sect" style="padding:12px;border:0">
      <span class="lbl" style="display:block;margin-bottom:8px;font-weight:600;color:var(--txt-2)">Delivery receipts</span>
      ${T.sent.map(s => { const pct = Math.round(s.receipts.opened / s.receipts.delivered * 100);
        return `<div style="padding:9px 0;border-bottom:1px solid var(--line-soft)">
          <div style="font-size:12.5px;margin-bottom:5px">${esc(s.subject)}</div>
          <div style="display:flex;align-items:center;gap:9px">
            <div class="bar" style="flex:1"><i style="width:${pct}%"></i></div>
            <span class="mono lbl" style="font-size:10.5px">${pct}% opened</span></div></div>`; }).join('')}
      <p class="dim" style="font-size:11.5px;margin-top:10px;line-height:1.5">Receipts come from the Gmail API delivery
        status and the tracked-link redirect. A failed delivery raises a notification to the sender.</p></div>`;
  }
  function renderRules() {
    $('#ml-count').textContent = W.parseRules.length + ' rules';
    $('#ml-list').innerHTML = W.parseRules.map(r => `<div class="rfirow">
      <div class="h"><button class="switch" aria-pressed="${r.on}"></button>
        <b style="font-size:12.5px;font-weight:500">${esc(r.name)}</b>
        <span class="lbl mono" style="margin-left:auto">${r.hits} hits</span></div>
      <div style="font-family:var(--mono);font-size:11px;color:var(--txt-3);line-height:1.6">
        when <span style="color:var(--acc-hi)">${esc(r.match)}</span><br>
        then ${esc(r.sets)}</div></div>`).join('');
    $('#ml-read').innerHTML = `<div class="sect" style="padding:12px;border:0">
      <span class="lbl" style="display:block;margin-bottom:8px;font-weight:600;color:var(--txt-2)">How inbound works</span>
      <p class="muted" style="font-size:12.5px;line-height:1.6">Mail to <span class="mono">${esc(W.mailbox.account)}</span>
        is polled through the Gmail API. Each message is matched against the rules above in order. A match maps the
        sender to a source reliability, the subject to a title, the body's first sentence to a summary, and any
        location in the body through the gazetteer. Attachments are extracted; PDFs are text-layered and searched.</p>
      <p class="muted" style="font-size:12.5px;line-height:1.6">A message that matches no rule stays in the inbox for
        an analyst to raise by hand. Nothing is discarded, and nothing becomes a signal without a rule that can be
        read and audited.</p>
      <dl class="kv" style="margin-top:11px"><dt>Scopes</dt><dd class="mono" style="font-size:11px">${W.mailbox.scopes.join('<br>')}</dd>
        <dt>Quota</dt><dd>${esc(W.mailbox.quota)}</dd></dl></div>`;
  }
  function renderOutbound() {
    $('#ml-count').textContent = T.outbound.filter(o => o.on).length + ' of ' + T.outbound.length + ' active';
    $('#ml-list').innerHTML = T.outbound.map(o => `<div class="rfirow">
      <div class="h"><button class="switch" aria-pressed="${o.on}" data-ob="${o.id}"></button>
        <b style="font-size:12.5px;font-weight:500">${esc(o.name)}</b>
        <span class="tag ${o.kind === 'alert' ? 'red' : 'blue'}">${esc(o.kind)}</span>
        <span class="lbl mono" style="margin-left:auto">${o.recipients}</span></div>
      <div style="font-size:12px;color:var(--txt-2);line-height:1.55;margin-bottom:4px">${esc(o.body)}</div>
      <div class="lbl" style="font-size:11px">to ${esc(o.to)} Â· ${esc(o.when)} Â· last ${esc(o.last)}</div></div>`).join('');
    $$('#ml-list [data-ob]').forEach(b => b.onclick = () => {
      const o = T.outbound.find(z => z.id === b.dataset.ob); o.on = !o.on;
      renderOutbound(); window.HWtoast(o.name + (o.on ? ' enabled' : ' paused'));
    });
    $('#ml-read').innerHTML = `<div class="sect" style="padding:12px;border:0">
      <span class="lbl" style="display:block;margin-bottom:8px;font-weight:600;color:var(--txt-2)">Automatic mail</span>
      <p class="muted" style="font-size:12.5px;line-height:1.6">Alert rules with the <b>notify</b> or <b>escalate</b>
        action send through these channels. Digests are assembled per recipient in their own timezone, so a 0600 digest
        reaches Lisbon and Singapore at 0600 local, not 0600 UTC.</p>
      <p class="muted" style="font-size:12.5px;line-height:1.6">Alerts are throttled per rule to avoid a storm during a
        fast-moving event: the first matching signal sends immediately, subsequent matches within the window are folded
        into one follow-up.</p>
      <button class="btn sm" id="ob-rules" style="margin-top:9px"><svg><use href="#i-alert"/></svg> open alert rules</button></div>`;
    on('#ob-rules', 'click', () => window.HWalerts && window.HWalerts.open());
  }
  on('#ml-q', 'input', ev => { T.ui.mailQ = ev.target.value; renderMail(); });
  on('#ml-close', 'click', () => { T.ui.mail = null; openMail(); });
  on('#ml-compose', 'click', () => openCompose({}));
  on('#ml-signal', 'click', () => { const m = T.mail.find(x => x.id === T.ui.mail);
    if (m && m.state !== 'parsed') raiseSignal(m); else window.HWtoast('Already raised as a signal', 'warn'); });
  on('#ml-case', 'click', () => { if (T.ui.mail) attachToCase('mail:' + T.ui.mail); });

  /* ââ compose ââ */
  function openCompose(pre) {
    $('#cmp-scrim').classList.add('open');
    $('#cmp-title').textContent = pre.subject ? 'Reply' : 'Compose';
    const lists = ['Duty desk', 'Group security', 'Regional security leads', 'Executive committee', 'Operations and logistics'];
    $('#cmp-body').innerHTML = `<div class="setsec" style="border:0">
      <div class="field"><label>To</label><input class="input" id="cmp-to" value="${esc(pre.to || '')}" placeholder="address or distribution list"></div>
      <div class="field"><label>Or a distribution list</label><select class="input" id="cmp-list">
        <option value="">â</option>${lists.map(l => `<option>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Subject</label><input class="input" id="cmp-sub" value="${esc(pre.subject || '')}"></div>
      <div class="field"><label>Attach a record</label><select class="input" id="cmp-ref">
        <option value="">None</option>
        ${D.events.slice(0, 10).map(e => `<option value="sig:${e.id}" ${pre.ref === 'sig:' + e.id ? 'selected' : ''}>${e.id} Â· ${esc(e.place)}</option>`).join('')}
        ${D.briefings.map(b => `<option value="brf:${b.id}">${b.id} Â· ${esc(b.title)}</option>`).join('')}
        ${T.cases.map(c => `<option value="case:${c.id}">${c.id} Â· ${esc(c.code)}</option>`).join('')}</select></div>
      <div class="field"><label>Message</label><textarea class="input" id="cmp-text" rows="8">${esc(pre.body || '')}</textarea></div>
      <label class="check"><input type="checkbox" id="cmp-receipt" checked><span>Request delivery receipt</span></label>
      <label class="check"><input type="checkbox" id="cmp-urgent"><span>Mark urgent â interrupts the recipient's inspector</span></label>
    </div>`;
    $('#cmp-hint').textContent = 'Sends through ' + W.mailbox.provider + ' as ' + W.mailbox.account;
  }
  on('#cmp-close', 'click', () => $('#cmp-scrim').classList.remove('open'));
  on('#cmp-scrim', 'click', ev => { if (ev.target.id === 'cmp-scrim') $('#cmp-scrim').classList.remove('open'); });
  on('#cmp-draft', 'click', () => { $('#cmp-scrim').classList.remove('open'); window.HWtoast('Saved to drafts'); });
  on('#cmp-send', 'click', () => {
    const to = $('#cmp-list').value || $('#cmp-to').value, sub = $('#cmp-sub').value;
    if (!to) return window.HWtoast('Add a recipient or pick a distribution list', 'warn');
    if (!sub) return window.HWtoast('Add a subject', 'warn');
    const ref = $('#cmp-ref').value;
    T.sent.unshift({ id: 'S-' + Date.now().toString(36), to, subject: sub, ts: zulu(new Date()),
      kind: ref.startsWith('brf') ? 'briefing' : $('#cmp-urgent').checked ? 'alert' : 'digest',
      receipts: { delivered: 1, opened: 0, failed: 0 } });
    T.activity.unshift({ ts: zulu(new Date()), by: T.me, verb: 'sent mail to', ref: ref || 'mail:outbound', detail: to });
    $('#cmp-scrim').classList.remove('open');
    window.HWtoast('Sent to ' + to + ($('#cmp-receipt').checked ? ' Â· receipt requested' : ''), 'ok');
    if (S.module === 'mail') renderMail();
  });

  /* âââââââââ CASES âââââââââ */
  function attachToCase(ref) {
    const opts = T.cases.filter(c => c.status !== 'closed');
    openCompose; // no-op guard
    const pick = opts[0];
    if (!pick) return window.HWtoast('No open case to attach to', 'warn');
    /* attach to the currently selected case, or the first open one */
    const c = T.cases.find(z => z.id === T.ui.case && z.status !== 'closed') || pick;
    const [k, id] = ref.split(':');
    const bucket = { sig: 'signals', ent: 'entities', scn: 'scenes', aoi: 'aois', onto: 'onto', mail: 'mail' }[k];
    if (!bucket) return window.HWtoast('That record cannot be attached', 'warn');
    c.records[bucket] = c.records[bucket] || [];
    if (c.records[bucket].includes(id)) return window.HWtoast('Already attached to ' + c.code, 'warn');
    c.records[bucket].push(id);
    if (k === 'mail') { const m = T.mail.find(z => z.id === id); if (m) m.caseId = c.id; }
    T.activity.unshift({ ts: zulu(new Date()), by: T.me, verb: 'attached ' + id + ' to', ref: 'case:' + c.id, detail: c.code });
    window.HWtoast(id + ' attached to ' + c.code, 'ok');
    if (S.module === 'mail') renderMail();
    if (S.module === 'cases') renderCases();
  }
  window.HWcase = { attach: attachToCase, list: () => T.cases };

  const CASE_TABS = [['overview', 'Overview'], ['records', 'Records'], ['rfis', 'RFIs'], ['timeline', 'Timeline'], ['brief', 'Briefing']];
  function renderCases() {
    $('#cs-count').textContent = T.cases.filter(c => c.status !== 'closed').length + ' open';
    $('#cs-list').innerHTML = T.cases.map(c => {
      const col = c.priority === 'critical' ? '#c4453c' : c.priority === 'high' ? '#b7822c' : c.priority === 'moderate' ? '#4f7fa6' : '#6d7883';
      return `<button class="crow" data-id="${c.id}" aria-selected="${c.id === T.ui.case}" style="${c.status === 'closed' ? 'opacity:.55' : ''}">
        <i class="dia" style="background:${col}"></i>
        <div><b>${esc(c.title)}</b><em>${esc(c.code)} Â· ${esc(user(c.owner).name.split(' ')[1])} Â· due ${esc(c.due)}</em></div>
        <span class="st">${esc(c.status)}</span></button>`;
    }).join('');
    $$('#cs-list .crow').forEach(b => b.onclick = () => { T.ui.case = b.dataset.id; renderCases(); });

    const c = T.cases.find(z => z.id === T.ui.case) || T.cases[0];
    if (!c) return;
    const recCount = Object.values(c.records).reduce((a, v) => a + (v || []).length, 0);
    const col = c.priority === 'critical' ? '#c4453c' : c.priority === 'high' ? '#b7822c' : '#4f7fa6';
    $('#cs-head').innerHTML = `<div style="display:flex;gap:20px;align-items:flex-start">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:6px">
          <span class="lbl">${esc(c.code)} Â· opened ${esc(c.opened)}</span>
          <span class="tag" style="color:${col};border-color:${col}66">${esc(c.priority)}</span>
          <span class="tag ${c.status === 'closed' ? 'green' : c.status === 'review' ? 'amber' : ''}">${esc(c.status)}</span></div>
        <h1>${esc(c.title)}</h1>
        <p class="muted" style="margin:8px 0 0;max-width:640px;font-size:12.5px;line-height:1.55">${esc(c.summary)}</p>
        <div class="btnrow" style="margin-top:12px;padding:0;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn primary sm" id="cs-brief"><svg><use href="#i-add-brief"/></svg> brief this case</button>
          <button class="btn sm" id="cs-rfi"><svg><use href="#i-rfi"/></svg> raise RFI</button>
          <button class="btn sm" id="cs-map"><svg><use href="#i-globe"/></svg> plot records</button>
          <button class="btn sm" id="cs-status">${c.status === 'closed' ? 'reopen' : c.status === 'review' ? 'return to active' : 'send to review'}</button></div>
      </div>
      <div style="text-align:right">
        <div class="lbl" style="margin-bottom:6px">Owner</div>
        <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">${avatar(c.owner, 'lg')}
          <div style="text-align:left"><div style="font-size:12.5px">${esc(user(c.owner).name)}</div>
            <div class="lbl" style="font-size:11px">${esc(W.ROLES[user(c.owner).role].name)}</div></div></div>
        <div class="lbl" style="margin:10px 0 5px">Watchers</div>
        <div style="display:flex;gap:4px;justify-content:flex-end">${(c.watchers || []).map(w => avatar(w, 'sm')).join('')}</div>
      </div></div>`;
    on('#cs-brief', 'click', () => {
      const ids = (c.records.signals || []).filter(id => D.events.some(e => e.id === id));
      if (!ids.length) return window.HWtoast('Attach signals to this case first', 'warn');
      window.HWbasket(ids); setMode('watch'); window.HWopen('generate');
    });
    on('#cs-rfi', 'click', () => openRFI({ case: c.id }));
    on('#cs-map', 'click', () => { setMode('watch'); window.HWopen('map');
      window.HWtoast(recCount + ' case records plotted on the situation map'); });
    on('#cs-status', 'click', () => {
      c.status = c.status === 'active' ? 'review' : c.status === 'review' ? 'active' : 'active';
      T.activity.unshift({ ts: zulu(new Date()), by: T.me, verb: 'moved to ' + c.status, ref: 'case:' + c.id, detail: c.code });
      renderCases(); window.HWtoast(c.code + ' â ' + c.status, 'ok');
    });

    $('#cs-tabs').innerHTML = CASE_TABS.map(([k, n]) =>
      `<button data-t="${k}" aria-selected="${T.ui.caseTab === k}">${n}</button>`).join('');
    $$('#cs-tabs button').forEach(b => b.onclick = () => { T.ui.caseTab = b.dataset.t; renderCases(); });

    const body = $('#cs-body');
    const kinds = [['signals', 'sig', 'Signals'], ['entities', 'ent', 'Dossiers'], ['onto', 'onto', 'Ontology objects'],
      ['scenes', 'scn', 'Imagery scenes'], ['aois', 'aoi', 'Observation areas'], ['mail', 'mail', 'Mail']];
    if (T.ui.caseTab === 'overview') {
      const rfis = T.rfis.filter(r => r.case === c.id);
      body.innerHTML = `<div class="sect"><span class="lbl">Attached records</span>
          <div class="recgrid">${kinds.map(([b, k, n]) =>
            `<div><b>${(c.records[b] || []).length}</b><span>${n}</span></div>`).join('')}</div></div>
        <div class="sect"><span class="lbl">Case notes</span>
          ${(c.notes || []).map(n => `<div class="cmt" style="border:0;padding:8px 0">${avatar(n.by, 'sm')}
            <div><div class="h"><b>${esc(user(n.by).name)}</b><span class="t">${esc(n.ts)}</span></div>
              <div class="b">${esc(n.body)}</div></div></div>`).join('') ||
            '<p class="dim" style="font-size:12px;margin:0">No notes.</p>'}</div>
        <div class="sect" style="border:0"><span class="lbl">Open RFIs Â· ${rfis.filter(r => r.status === 'open').length}</span>
          ${rfis.map(r => `<div class="linkrow" style="cursor:pointer" data-rfi="${r.id}">
            <span class="k">${esc(r.id)}</span><span style="flex:1">${esc(r.question.slice(0, 70))}</span>
            <span class="tag ${r.status === 'answered' ? 'green' : r.status === 'closed' ? '' : 'amber'}">${esc(r.status)}</span></div>`).join('') ||
            '<p class="dim" style="font-size:12px;margin:0">None.</p>'}</div>`;
      $$('#cs-body [data-rfi]').forEach(r => r.onclick = () => { T.ui.team = 'rfis'; window.HWopen('team'); renderTeam(); });
    } else if (T.ui.caseTab === 'records') {
      body.innerHTML = kinds.map(([b, k, n]) => {
        const ids = c.records[b] || [];
        return `<div class="sect"><span class="lbl">${n} Â· ${ids.length}</span>
          <div class="reflist">${ids.map(id => `<button class="refchip" data-ref="${k}:${id}">
            <svg><use href="#${REF_ICON[k]}"/></svg>${esc(id)} Â· ${esc(refLabel(k + ':' + id).slice(0, 34))}</button>`).join('') ||
            '<span class="dim" style="font-size:12px">None attached.</span>'}</div></div>`;
      }).join('') + `<div class="sect" style="border:0"><p class="dim" style="font-size:11.5px;line-height:1.5;margin:0">
        Attach records from anywhere: the <b>attach to case</b> action appears on signals, mail, scenes and areas.</p></div>`;
      $$('#cs-body .refchip').forEach(r => r.onclick = () => openRef(r.dataset.ref));
    } else if (T.ui.caseTab === 'rfis') {
      const rfis = T.rfis.filter(r => r.case === c.id);
      body.innerHTML = rfis.map(rfiHTML).join('') ||
        `<div class="empty"><svg><use href="#i-rfi"/></svg><p>No requests for information on this case.</p></div>`;
    } else if (T.ui.caseTab === 'timeline') {
      const acts = T.activity.filter(a => a.ref === 'case:' + c.id ||
        Object.entries(c.records).some(([b, v]) => (v || []).some(id => a.ref.endsWith(':' + id))));
      body.innerHTML = `<div class="sect" style="border:0">
        ${acts.map(a => `<div class="actrow">${a.by ? avatar(a.by, 'sm') : '<svg style="width:14px;height:14px;color:var(--txt-4)"><use href="#i-mail"/></svg>'}
          <div>${a.by ? '<b style="font-weight:500;color:var(--txt)">' + esc(user(a.by).name) + '</b> ' : ''}${esc(a.verb)}
            <span class="r" data-ref="${esc(a.ref)}">${esc(String(a.ref).split(':')[1])}</span>
            ${a.detail ? '<div class="lbl" style="font-size:11px;margin-top:2px">' + esc(a.detail) + '</div>' : ''}</div>
          <span class="t">${esc(a.ts)}</span></div>`).join('') ||
          '<p class="dim" style="font-size:12px;padding:14px">No activity recorded against this case yet.</p>'}</div>`;
      $$('#cs-body .r').forEach(r => r.onclick = () => openRef(r.dataset.ref));
    } else {
      const b = D.briefings.find(z => (T.approvals[z.id] || {}).stage) || D.briefings[0];
      const ap = T.approvals[b.id] || { stage: 'draft', chain: [] };
      body.innerHTML = `<div class="sect"><span class="lbl">Approval chain Â· ${esc(b.id)}</span>
          <div class="chain">${W.STAGES.map(st => {
            const step = ap.chain.find(s => s.stage === st);
            const done = W.STAGES.indexOf(st) <= W.STAGES.indexOf(ap.stage);
            return `<div class="${done ? 'done' : ''} ${st === ap.stage ? 'cur' : ''}">
              <b>${st}</b><em>${step ? esc(user(step.by).initials) + ' Â· ' + esc(step.ts.split(' ')[1] || step.ts) : 'pending'}</em></div>`;
          }).join('')}</div>
          ${ap.chain.map(s => `<div class="cmt" style="border:0;padding:7px 0">${avatar(s.by, 'sm')}
            <div><div class="h"><b>${esc(user(s.by).name)}</b><span class="tag">${esc(s.stage)}</span>
              <span class="t">${esc(s.ts)}</span></div>
              ${s.note ? '<div class="b">' + esc(s.note) + '</div>' : ''}</div></div>`).join('')}
          <div class="btnrow" style="padding:11px 0 0;display:flex;gap:6px">
            <button class="btn sm" id="ap-advance" ${ap.stage === 'issued' ? 'disabled' : ''}>
              <svg><use href="#i-stamp"/></svg> ${ap.stage === 'draft' ? 'send for review' : ap.stage === 'review' ? 'approve' : 'issue'}</button>
            <button class="btn sm" id="ap-open"><svg><use href="#i-read"/></svg> open briefing</button></div>
        </div>
        <div class="sect" style="border:0"><span class="lbl">Generate from this case</span>
          <p class="muted" style="font-size:12.5px;line-height:1.55;max-width:620px">
            ${(c.records.signals || []).length} attached signals become the evidence set. Scope, audience and horizon
            carry from the case; the ontology objects attached here populate Appendix A.</p></div>`;
      on('#ap-advance', 'click', () => {
        const i = W.STAGES.indexOf(ap.stage);
        const next = W.STAGES[Math.min(W.STAGES.length - 1, i + 1)];
        if ((next === 'approved' || next === 'issued') && !can('approve'))
          return window.HWtoast('Only a group security lead can approve or issue', 'warn');
        ap.stage = next;
        ap.chain.push({ stage: next, by: T.me, ts: zulu(new Date()), note: '' });
        T.approvals[b.id] = ap;
        T.activity.unshift({ ts: zulu(new Date()), by: T.me, verb: next === 'issued' ? 'issued' : 'moved to ' + next, ref: 'brf:' + b.id, detail: '' });
        renderCases(); window.HWtoast(b.id + ' â ' + next, 'ok');
      });
      on('#ap-open', 'click', () => openRef('brf:' + b.id));
    }

    /* discussion rail */
    const cmts = commentsFor('case:' + c.id);
    $('#cs-cc').textContent = cmts.length;
    $('#cs-thread').innerHTML = cmts.map(commentHTML).join('') ||
      `<div class="empty"><svg><use href="#i-comment"/></svg><p>No discussion. Type @ to bring someone in.</p></div>`;
    $('#cs-composer').innerHTML = composerHTML('case:' + c.id);
    wireComposer('case:' + c.id, renderCases);
  }
  on('#cs-new', 'click', () => {
    const id = 'CS-' + String(20 + T.cases.length).padStart(4, '0');
    T.cases.unshift({ id, code: 'NEW-CASE', title: 'Untitled case', owner: T.me, status: 'active',
      priority: 'moderate', opened: zulu(new Date()).split(' ')[0], due: 'â', watchers: [T.me],
      summary: 'New case. Attach records and set the priority.', records: { signals: [], entities: [], scenes: [], aois: [], onto: [], mail: [] }, notes: [] });
    T.ui.case = id; T.ui.caseTab = 'overview'; renderCases();
    window.HWtoast(id + ' created', 'ok');
  });

  /* âââââââââ TEAM âââââââââ */
  function rfiHTML(r) {
    return `<div class="rfirow">
      <div class="h"><span class="lbl mono">${esc(r.id)}</span>
        <span class="tag ${r.status === 'answered' ? 'green' : r.status === 'closed' ? '' : 'amber'}">${esc(r.status)}</span>
        ${avatar(r.from, 'sm')}<span class="lbl">â</span>${avatar(r.to, 'sm')}
        <span class="lbl mono" style="margin-left:auto">due ${esc(r.due)}</span></div>
      <div class="q">${esc(r.question)}</div>
      ${(r.answers || []).map(a => `<div class="ans"><b>${esc(user(a.by).name)} Â· ${esc(a.ts)}</b>${esc(a.body)}</div>`).join('')}
      ${r.status === 'open' && r.to === T.me ? `<div style="margin-top:8px">
        <textarea class="input" id="rfi-a-${r.id}" rows="2" placeholder="Your answerâ¦"></textarea>
        <button class="btn sm primary" data-ans="${r.id}" style="margin-top:6px">submit answer</button></div>` : ''}
      ${r.case ? `<div style="margin-top:7px"><button class="refchip" data-ref="case:${r.case}">
        <svg><use href="#i-case"/></svg>${esc(r.case)}</button></div>` : ''}</div>`;
  }
  function renderTeam() {
    $$('#tm-view button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === T.ui.team));
    const body = $('#tm-body');
    if (T.ui.team === 'roster') {
      body.innerHTML = T.users.map(u => {
        const open = T.assignments.filter(a => a.to === u.id && a.state === 'open').length;
        const owned = T.cases.filter(c => c.owner === u.id && c.status !== 'closed').length;
        return `<div class="person">${avatar(u.id, 'lg')}
          <div><b>${esc(u.name)}${u.id === T.me ? ' Â· you' : ''}</b>
            <em>${esc(W.ROLES[u.role].name)} Â· ${esc(u.email)}</em>
            <em>${esc(u.tz)} Â· ${esc(u.shift)}</em></div>
          <div style="text-align:right"><div class="lbl mono" style="font-size:11px">${open} open Â· ${owned} case${owned === 1 ? '' : 's'}</div>
            <div class="lbl" style="font-size:10.5px">${W.ROLES[u.role].can.join(' Â· ')}</div></div>
          <div class="pres"><i class="${u.status}"></i>${u.status}</div></div>`;
      }).join('') + `<div class="sect" style="border:0"><p class="dim" style="font-size:11.5px;line-height:1.5;margin:0">
        Roles decide what a user may do. Only a group security lead approves or issues a briefing; only an imagery
        analyst confirms a detection. Presence is live: an avatar on a record means somebody else has it open.</p></div>`;
    } else if (T.ui.team === 'rfis') {
      body.innerHTML = T.rfis.map(rfiHTML).join('');
      $$('#tm-body [data-ans]').forEach(b => b.onclick = () => {
        const r = T.rfis.find(z => z.id === b.dataset.ans);
        const v = $('#rfi-a-' + r.id).value.trim();
        if (!v) return window.HWtoast('Write an answer', 'warn');
        r.answers = r.answers || [];
        r.answers.push({ by: T.me, ts: zulu(new Date()), body: v });
        r.status = 'answered';
        T.notes.unshift({ id: 'N-' + Date.now().toString(36), kind: 'rfi', ref: 'rfi:' + r.id, by: T.me,
          ts: zulu(new Date()), read: false, urgent: false, text: me().name + ' answered ' + r.id });
        T.activity.unshift({ ts: zulu(new Date()), by: T.me, verb: 'answered', ref: 'rfi:' + r.id, detail: v.slice(0, 60) });
        renderTeam(); railBadges(); window.HWtoast(r.id + ' answered Â· requester notified', 'ok');
      });
      $$('#tm-body .refchip').forEach(x => x.onclick = () => openRef(x.dataset.ref));
    } else if (T.ui.team === 'activity') {
      body.innerHTML = T.activity.map(a => `<div class="actrow">
        ${a.by ? avatar(a.by, 'sm') : '<svg style="width:14px;height:14px;color:var(--txt-4)"><use href="#i-mail"/></svg>'}
        <div>${a.by ? '<b style="font-weight:500;color:var(--txt)">' + esc(user(a.by).name) + '</b> ' : '<b style="font-weight:500;color:var(--txt)">System</b> '}${esc(a.verb)}
          <span class="r" data-ref="${esc(a.ref)}">${esc(String(a.ref).split(':')[1])}</span>
          ${a.detail ? '<div class="lbl" style="font-size:11px;margin-top:2px">' + esc(a.detail) + '</div>' : ''}</div>
        <span class="t">${esc(a.ts)}</span></div>`).join('');
      $$('#tm-body .r').forEach(r => r.onclick = () => openRef(r.dataset.ref));
    } else {
      body.innerHTML = T.handovers.map(h => `<div class="hosec">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">
          ${avatar(h.from, 'sm')}<span class="lbl">â</span>${avatar(h.to, 'sm')}
          <b style="font-size:12.5px;font-weight:500">${esc(h.shift)}</b>
          <span class="tag ${h.acked ? 'green' : 'amber'}">${h.acked ? 'acknowledged' : 'unread'}</span>
          <span class="lbl mono" style="margin-left:auto">${esc(h.ts)}</span></div>
        <span class="lbl">Completed</span><ul>${h.did.map(d => '<li>' + esc(d) + '</li>').join('')}</ul>
        <span class="lbl">Left open</span><ul>${h.open.map(d => '<li>' + esc(d) + '</li>').join('')}</ul>
        <span class="lbl">Watch for</span><ul>${h.watch.map(d => '<li>' + esc(d) + '</li>').join('')}</ul></div>`).join('') +
        `<div class="sect" style="border:0"><button class="btn sm primary" id="tm-ho"><svg><use href="#i-handover"/></svg> compose handover</button></div>`;
      on('#tm-ho', 'click', openHandover);
    }

    /* notifications rail */
    $('#tm-side').innerHTML = T.notes.map(n => `<div class="nrow ${n.read ? '' : 'unread'} ${n.urgent ? 'urgent' : ''}" data-id="${n.id}" data-ref="${esc(n.ref)}">
      <svg><use href="#${REF_ICON[String(n.ref).split(':')[0]] || 'i-bell'}"/></svg>
      <div class="n">${esc(n.text)}</div><span class="t">${esc(n.ts.split(' ')[1] || n.ts)}</span></div>`).join('') ||
      `<div class="empty"><svg><use href="#i-bell"/></svg><p>Nothing new.</p></div>`;
    $$('#tm-side .nrow').forEach(r => r.onclick = () => {
      const n = T.notes.find(z => z.id === r.dataset.id); if (n) n.read = true;
      persist(); railBadges(); openRef(r.dataset.ref);
    });
    railBadges();
  }
  $$('#tm-view button').forEach(b => b.onclick = () => { T.ui.team = b.dataset.v; renderTeam(); });
  on('#tm-readall', 'click', () => { T.notes.forEach(n => n.read = true); persist(); renderTeam(); railBadges(); });
  on('#tm-rfi', 'click', () => openRFI({}));
  on('#tm-invite', 'click', () => openWho(true));

  /* ââ RFI creation ââ */
  function openRFI(pre) {
    $('#cmp-scrim').classList.add('open');
    $('#cmp-title').textContent = 'Raise a request for information';
    $('#cmp-body').innerHTML = `<div class="setsec" style="border:0">
      <div class="field"><label>Ask</label><select class="input" id="rf-to">${T.users.filter(u => u.id !== T.me)
        .map(u => `<option value="${u.id}">${esc(u.name)} Â· ${esc(W.ROLES[u.role].name)} Â· ${esc(u.tz)}</option>`).join('')}</select></div>
      <div class="field"><label>Against case</label><select class="input" id="rf-case">
        <option value="">None</option>${T.cases.filter(c => c.status !== 'closed')
        .map(c => `<option value="${c.id}" ${pre.case === c.id ? 'selected' : ''}>${c.id} Â· ${esc(c.code)}</option>`).join('')}</select></div>
      <div class="field"><label>Due</label><input class="input" id="rf-due" value="D+3"></div>
      <div class="field"><label>Question</label><textarea class="input" id="rf-q" rows="4">${esc(pre.question || '')}</textarea></div>
      <label class="check"><input type="checkbox" id="rf-mail" checked><span>Send by mail as well as in-console</span></label>
    </div>`;
    $('#cmp-hint').textContent = 'Tracked to closure and visible on the case timeline';
    const send = $('#cmp-send');
    send.innerHTML = '<svg><use href="#i-rfi"/></svg> raise RFI';
    send.onclick = () => {
      const q = $('#rf-q').value.trim();
      if (!q) return window.HWtoast('Write the question', 'warn');
      const id = 'RFI-' + String(24 + T.rfis.length).padStart(3, '0');
      const to = $('#rf-to').value;
      T.rfis.unshift({ id, case: $('#rf-case').value || null, from: T.me, to, due: $('#rf-due').value || 'D+3',
        status: 'open', question: q, answers: [] });
      T.notes.unshift({ id: 'N-' + Date.now().toString(36), kind: 'rfi', ref: 'rfi:' + id, by: T.me,
        ts: zulu(new Date()), read: false, urgent: true, text: me().name + ' raised ' + id + ' for ' + user(to).name });
      T.activity.unshift({ ts: zulu(new Date()), by: T.me, verb: 'raised', ref: 'rfi:' + id, detail: 'for ' + user(to).name });
      if ($('#rf-mail').checked) T.sent.unshift({ id: 'S-' + Date.now().toString(36), to: user(to).name,
        subject: id + ' Â· ' + q.slice(0, 50), ts: zulu(new Date()), kind: 'rfi', receipts: { delivered: 1, opened: 0, failed: 0 } });
      $('#cmp-scrim').classList.remove('open');
      window.HWtoast(id + ' raised with ' + user(to).name, 'ok');
      railBadges();
      if (S.module === 'team') renderTeam();
      if (S.module === 'cases') renderCases();
      /* restore the compose handler */
      send.innerHTML = '<svg><use href="#i-send"/></svg> send';
      send.onclick = null;
      location.hash = '';
    };
  }

  /* ââ identity ââ */
  function openWho(creating) {
    $('#who-scrim').classList.add('open');
    $('#who-body').innerHTML = `<div class="setsec" style="border:0">
      <h4>Who is at this workstation?</h4>
      <p>Role decides what you may do. Presence, assignment and mentions all follow the signed-in user.</p>
      ${T.users.map(u => `<div class="person" style="padding:9px 0;cursor:pointer" data-u="${u.id}">
        ${avatar(u.id, 'lg')}
        <div><b>${esc(u.name)}</b><em>${esc(W.ROLES[u.role].name)} Â· ${esc(u.shift)}</em></div>
        <span class="lbl mono" style="font-size:10.5px">${esc(u.tz)}</span>
        <span class="tag ${u.id === T.me ? 'green' : ''}">${u.id === T.me ? 'signed in' : 'switch'}</span></div>`).join('')}
      ${creating ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <div class="field"><label>Name</label><input class="input" id="nu-name" placeholder="A. Analyst"></div>
        <div class="field"><label>Email</label><input class="input" id="nu-mail" placeholder="a.analyst@horizonwatch.internal"></div>
        <div class="field"><label>Role</label><select class="input" id="nu-role">${Object.entries(W.ROLES)
          .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></div>
        <div class="field"><label>Timezone</label><input class="input" id="nu-tz" value="Europe/Lisbon"></div>
        <button class="btn sm primary" id="nu-create">create and sign in</button></div>` : ''}</div>`;
    $('#who-foot').textContent = T.users.length + ' users Â· role-based permissions';
    $$('#who-body [data-u]').forEach(r => r.onclick = () => {
      T.me = r.dataset.u; persist();
      $('#who-scrim').classList.remove('open');
      $('.avatar').textContent = me().initials;
      $('.avatar').title = me().name + ' â ' + W.ROLES[me().role].name;
      $('.statusbar .cell:nth-last-child(2) b') && ($('.statusbar .cell:nth-last-child(2) b').textContent = me().name);
      window.HWtoast('Signed in as ' + me().name + ' Â· ' + W.ROLES[me().role].name, 'ok');
      railBadges(); refreshCurrent();
    });
    on('#nu-create', 'click', () => {
      const n = $('#nu-name').value.trim(); if (!n) return window.HWtoast('Name required', 'warn');
      const id = 'U' + (T.users.length + 1);
      const initials = n.split(/[\s.]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      T.users.push({ id, name: n, initials, role: $('#nu-role').value,
        email: $('#nu-mail').value || (n.toLowerCase().replace(/[^a-z]/g, '.') + '@horizonwatch.internal'),
        tz: $('#nu-tz').value, shift: 'Day 0900-1800', status: 'online',
        color: ['#5f95d0', '#b7822c', '#699781', '#a893e2', '#4fc3c3'][T.users.length % 5] });
      T.me = id; persist();
      $('#who-scrim').classList.remove('open');
      window.HWtoast(n + ' created and signed in', 'ok');
      railBadges(); refreshCurrent();
    });
  }
  on('#who-close', 'click', () => $('#who-scrim').classList.remove('open'));
  on('#who-scrim', 'click', ev => { if (ev.target.id === 'who-scrim') $('#who-scrim').classList.remove('open'); });
  on('#who-add', 'click', () => openWho(true));
  on('.avatar', 'click', () => openWho());

  /* ââ shift handover ââ */
  function openHandover() {
    $('#ho-scrim').classList.add('open');
    const acked = D.events.filter(e => e.status === 'ack').length;
    const esc_ = D.events.filter(e => e.status === 'esc').length;
    const openRfis = T.rfis.filter(r => r.status === 'open');
    const openCases = T.cases.filter(c => c.status !== 'closed' && (c.owner === T.me || (c.watchers || []).includes(T.me)));
    const mine = T.assignments.filter(a => a.to === T.me && a.state === 'open');
    const crit = D.events.filter(e => e.severity === 'critical').slice(0, 3);
    $('#ho-meta').textContent = me().name + ' Â· ' + me().shift;
    $('#ho-body').innerHTML = `
      <div class="hosec"><span class="lbl">Completed this shift â generated from your activity</span>
        <ul id="ho-did">
          <li>Acknowledged ${acked} signals, escalated ${esc_}</li>
          <li>${T.comments.filter(c => c.by === T.me).length} comments across ${new Set(T.comments.filter(c => c.by === T.me).map(c => c.ref)).size} records</li>
          <li>${T.sent.filter(s => s.kind === 'alert').length} alerts and ${T.sent.filter(s => s.kind === 'digest').length} digests went out</li>
        </ul></div>
      <div class="hosec"><span class="lbl">Left open</span>
        <ul>${mine.map(a => `<li>${esc(refLabel(a.ref).slice(0, 70))} â due ${esc(a.due)}</li>`).join('')}
          ${openRfis.map(r => `<li>${esc(r.id)} with ${esc(user(r.to).name)}, due ${esc(r.due)}</li>`).join('')}
          ${openCases.map(c => `<li>${esc(c.code)} â ${esc(c.status)}, due ${esc(c.due)}</li>`).join('')}</ul></div>
      <div class="hosec"><span class="lbl">Watch for</span>
        <ul>${crit.map(e => `<li>${esc(e.place)} â ${esc(e.title.slice(0, 76))}</li>`).join('')}</ul></div>
      <div class="hosec" style="border:0"><span class="lbl">Your note to the incoming analyst</span>
        <textarea id="ho-note" placeholder="Anything the generated summary above does not captureâ¦"></textarea></div>`;
    $('#ho-to').innerHTML = T.users.filter(u => u.id !== T.me)
      .map(u => `<option value="${u.id}">${esc(u.name)} Â· ${esc(u.shift)}</option>`).join('');
    $('#ho-hint').textContent = 'Sent in-console and by mail';
  }
  on('#ho-close', 'click', () => $('#ho-scrim').classList.remove('open'));
  on('#ho-scrim', 'click', ev => { if (ev.target.id === 'ho-scrim') $('#ho-scrim').classList.remove('open'); });
  on('#ho-send', 'click', () => {
    const to = $('#ho-to').value;
    const did = $$('#ho-did li').map(l => l.textContent);
    T.handovers.unshift({ id: 'HO-' + Date.now().toString(36), from: T.me, to, ts: zulu(new Date()),
      shift: me().shift, acked: false, did,
      open: T.rfis.filter(r => r.status === 'open').map(r => r.id + ' with ' + user(r.to).name),
      watch: [$('#ho-note').value || 'No additional notes.'] });
    T.notes.unshift({ id: 'N-' + Date.now().toString(36), kind: 'handover', ref: 'mail:handover', by: T.me,
      ts: zulu(new Date()), read: false, urgent: true, text: me().name + ' sent you a shift handover' });
    T.sent.unshift({ id: 'S-' + Date.now().toString(36), to: user(to).name, subject: 'Shift handover Â· ' + me().shift,
      ts: zulu(new Date()), kind: 'digest', receipts: { delivered: 1, opened: 0, failed: 0 } });
    $('#ho-scrim').classList.remove('open');
    window.HWtoast('Handover sent to ' + user(to).name, 'ok');
    railBadges(); if (S.module === 'team') renderTeam();
  });
  on('#wk-handover', 'click', openHandover);

  /* ââ module wiring ââ */
  function refreshCurrent() {
    if (S.module === 'work') renderWork();
    else if (S.module === 'mail') renderMail();
    else if (S.module === 'cases') renderCases();
    else if (S.module === 'team') renderTeam();
    else if (S.module === 'map') SH.renderInspector();
  }
  const prevX = window.HWX && window.HWX.onModule;
  if (window.HWX) window.HWX.onModule = id => {
    prevX && prevX(id);
    if (id === 'work') renderWork();
    if (id === 'mail') renderMail();
    if (id === 'cases') renderCases();
    if (id === 'team') renderTeam();
    /* Opening a module from a cross-mode jump must follow the mode, not fight
       it: setMode already routes, so only correct genuinely user-driven drift. */
    if (!switching) {
      if (WORK_MODS.includes(id) && T.mode !== 'work') setMode('work');
      if (WATCH_MODS.includes(id) && T.mode !== 'watch') setMode('watch');
    }
  };

  /* The Situation inspector hosts the interrupt, presence, assignment and
     discussion. Pushed as a hook, not wrapped around the export: hw-app calls
     its own local renderInspector from selectEvent, the close handler and the
     map-background click, so a reassigned export is never reached. */
  (window.HWinspectorHooks = window.HWinspectorHooks || []).push((box, sel) => {
    if (!box) return;
    window.HWinterrupt.inject(box);
    if (!sel) return;
    const ref = 'sig:' + sel;
    window.HWpresence.inject(box, ref);
    const detail = box.querySelector('.detail');
    if (detail) { window.HWassign.inject(detail, ref); window.HWcomments.inject(detail, ref); }
  });

  /* keys: W toggles mode, G opens my work */
  document.addEventListener('keydown', ev => {
    if (ev.target.matches('input,textarea,select')) return;
    if (ev.key === 'w' || ev.key === 'W') { if (!ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); setMode(T.mode === 'work' ? 'watch' : 'work'); } }
    if (ev.key === 'g' || ev.key === 'G') { if (!ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); setMode('work', { open: 'work' }); window.HWopen('work'); } }
  });

  /* ââ boot ââ
     The rail filter and the chip are applied synchronously so the first paint
     is already correct; only the DOM-dependent chrome waits a tick. */
  applyRailMode(); renderModeChip();
  setTimeout(() => {
    const av = $('.avatar');
    if (av) { av.textContent = me().initials; av.title = me().name + ' â ' + W.ROLES[me().role].name; av.style.cursor = 'pointer'; }
    const cells = $$('.statusbar .cell');
    const uc = cells.find(c => /K\.ALMEIDA|Almeida/i.test(c.textContent));
    if (uc) uc.innerHTML = `Signed in <b>${esc(me().name)}</b> Â· ${esc(W.ROLES[me().role].name)}`;
    applyRailMode(); renderModeChip(); railBadges();
    if (T.mode === 'work' && !WORK_MODS.includes(S.module)) window.HWopen('work');
    SH.renderInspector();          /* first paint; thereafter the hook carries it */
  }, 0);

  window.HWwork = { T, setMode, openWho, openHandover, openRFI, renderWork, renderMail, renderCases, renderTeam };
})();
