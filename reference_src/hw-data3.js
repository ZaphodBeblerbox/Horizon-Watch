/* Horizon Watch â Workstation corpus: identity, mail, cases, RFIs, comments,
   notifications, activity, approvals, handovers.

   Universal reference strings tie everything together:
     sig:HW-2400 Â· ent:ENT-RS-01 Â· onto:N02 Â· scn:SCN-4471 Â· aoi:AOI-14
     brf:BRF-0431 Â· case:CS-0014 Â· mail:M-1042 Â· rfi:RFI-021
   Any record can be commented on, assigned, attached to a case or cited in a
   briefing because everything speaks the same reference grammar.

   Sample corpus. Names, addresses and message bodies are illustrative. */
window.HW3 = (function () {

  /* ââ identity âââââââââââââââââââââââââââââââââââââââââââââââ
     Roles drive what a user may do: only a lead approves a briefing,
     only an imagery analyst confirms a detection. */
  const ROLES = {
    lead:     { name: 'Group security lead', can: ['approve', 'issue', 'assign', 'brief', 'admin'] },
    senior:   { name: 'Senior analyst',      can: ['assign', 'brief', 'review'] },
    analyst:  { name: 'Analyst',             can: ['brief'] },
    regional: { name: 'Regional lead',       can: ['answer', 'brief'] },
    imagery:  { name: 'Imagery analyst',     can: ['confirm', 'brief'] }
  };

  const users = [
    ['U1', 'K. Almeida',   'KA', 'lead',     'k.almeida@horizonwatch.internal',  'Europe/Lisbon',   'Day 0700-1900', 'online',  '#5f95d0'],
    ['U2', 'M. Sundaram',  'MS', 'senior',   'm.sundaram@horizonwatch.internal', 'Asia/Dubai',      'Day 0600-1800', 'online',  '#b7822c'],
    ['U3', 'A. Kowalczyk', 'AK', 'analyst',  'a.kowalczyk@horizonwatch.internal','Europe/Warsaw',   'Night 1900-0700','online',  '#699781'],
    ['U4', 'T. Achebe',    'TA', 'regional', 't.achebe@horizonwatch.internal',   'Africa/Lagos',    'Day 0800-1800', 'away',    '#8b96a0'],
    ['U5', 'L. Ferreira',  'LF', 'regional', 'l.ferreira@horizonwatch.internal', 'Asia/Singapore',  'Day 0800-1800', 'offline', '#a893e2'],
    ['U6', 'R. Delgado',   'RD', 'analyst',  'r.delgado@horizonwatch.internal',  'America/Mexico_City','Day 0700-1700','online','#4fc3c3'],
    ['U7', 'N. Haddad',    'NH', 'imagery',  'n.haddad@horizonwatch.internal',   'Europe/Berlin',   'Day 0900-1800', 'online',  '#cf6259'],
    ['U8', 'S. Whitfield', 'SW', 'senior',   's.whitfield@horizonwatch.internal','Europe/London',   'Day 0700-1900', 'offline', '#78a5d4']
  ].map(u => ({ id: u[0], name: u[1], initials: u[2], role: u[3], email: u[4],
    tz: u[5], shift: u[6], status: u[7], color: u[8] }));

  /* ââ mail âââââââââââââââââââââââââââââââââââââââââââââââââââ
     The intel mailbox is a feed. Sender domain sets base reliability;
     `parsed` marks a thread the inbound rules already turned into a signal. */
  const MAIL_SENDERS = {
    'advisories@fcdo.gov.uk':        { name: 'FCDO Travel Advisories', src: 'GOV-ADVISORY', rel: .78 },
    'bulletin@marinerisk.example':   { name: 'MarineRisk Partner Feed', src: 'PARTNER-FEED', rel: .80 },
    'ais-alerts@vesseltrack.example':{ name: 'VesselTrack AIS', src: 'AIS-TRACK', rel: .84 },
    'ops@sahel-security.example':    { name: 'Sahel Security Field Team', src: 'FIELD-REP', rel: .74 },
    'wire@osintdesk.example':        { name: 'OSINT Desk Wire', src: 'OSINT-WIRE', rel: .66 },
    'tasking@copernicus.example':    { name: 'Copernicus Tasking', src: 'SAT-TASK', rel: .82 },
    'compliance@group.internal':     { name: 'Group Compliance', src: 'GOV-ADVISORY', rel: .90 },
    'logistics@group.internal':      { name: 'Group Logistics', src: 'FIELD-REP', rel: .88 }
  };

  const H = h => new Date(Date.now() - h * 3600e3);
  const mail = [
    ['M-1042', 'T-31', 'bulletin@marinerisk.example', 0.4, 'URGENT: third launch event Bab el-Mandeb â war-risk premium revision', true, true,
      `Third engagement in seven days against commercial traffic 18nm off Mokha. Bulk carrier under third-flag registry reports a near-miss at 0412Z.\n\nUnderwriters have signalled a corridor premium revision effective Monday. Two of the four carriers on your contracted lanes have confirmed Cape routing for September sailings.\n\nRecommend treating the corridor as constrained for planning purposes.`,
      [['MarineRisk-corridor-note-03SEP.pdf', '412 KB']], ['corridor', 'urgent'], 'HW-2407', 'CS-0014', 'parsed'],
    ['M-1041', 'T-30', 'compliance@group.internal', 1.2, 'Restricted-party screening â two partial matches for review', true, true,
      `The overnight screening run against the vendor master returned two partial matches following the latest designation round.\n\n1. Anchorline Shipping Ltd (Marshall Islands) â 87% name match, beneficial owner overlap\n2. One freight intermediary on the EU-Levant lane â 71% match, under review\n\nNeither is cleared for new commitments until compliance signs off. Please hold any charter decisions touching these counterparties.`,
      [['screening-run-03SEP.csv', '88 KB']], ['compliance', 'urgent'], null, 'CS-0014', 'new'],
    ['M-1040', 'T-29', 'advisories@fcdo.gov.uk', 2.6, 'Travel advice update: southern districts', false, false,
      `Advice against all but essential travel has been extended to two further southern districts. Airport operations are unaffected.\n\nThe change follows an assessment of cross-border activity over the past fortnight. The advisory will be reviewed in 30 days.`,
      [], ['advisory'], 'HW-2456', null, 'parsed'],
    ['M-1039', 'T-28', 'ops@sahel-security.example', 3.4, 'Convoy report â RN5 axis, fuel movement escorted', true, false,
      `Escorted fuel movement completed on the RN5 axis with two vehicle losses at the 60km marker. Convoy reached destination.\n\nThird attack on the western approach this month. Journey management plans should assume escort-only movement on this segment for the remainder of the month.\n\nPump availability in the capital remains below 30%.`,
      [['convoy-report-RN5.pdf', '1.2 MB'], ['route-annotation.geojson', '14 KB']], ['field', 'sahel'], 'HW-2449', 'CS-0016', 'parsed'],
    ['M-1038', 'T-27', 'ais-alerts@vesseltrack.example', 4.1, 'AIS gap alert: KEPHALOS II â 14 days dark', true, true,
      `Hull KEPHALOS II (MMSI 636020918, Liberia, crude tanker) has not transmitted for 14 days. Last known position was the inbound Hormuz lane.\n\nThis exceeds the class-typical gap for the route by a factor of four. Charter records associate the hull with Anchorline Shipping Ltd.`,
      [], ['ais', 'urgent'], null, 'CS-0014', 'new'],
    ['M-1037', 'T-26', 'tasking@copernicus.example', 5.5, 'Scene delivery: 3 areas, 1 quality reject', false, false,
      `Three scenes delivered against your standing tasking:\n\n- Chernyakhovsk airbase â EO, cloud 3%, accepted\n- Perim Island approaches â SAR, accepted\n- Cabo Delgado LNG site â EO, cloud 41%, REJECTED on quality gate, requeued for the next pass\n\nChange detection has run on the two accepted pairs.`,
      [], ['imagery'], null, null, 'parsed'],
    ['M-1036', 'T-25', 'logistics@group.internal', 6.8, 'Re: Cape routing â cost exposure through November', false, false,
      `Answering your question from yesterday: the Cape routing adds 9 to 13 days on the EU-bound lanes from Singapore, and roughly 11% to landed logistics cost on affected strings.\n\nWe can hold it through November without renegotiating, but December volumes would need a decision by the 20th.`,
      [['cape-routing-cost.xlsx', '46 KB']], ['logistics'], null, 'CS-0014', 'new'],
    ['M-1035', 'T-9', 'wire@osintdesk.example', 9.2, 'Wire digest â 14 items, 3 above threshold', false, false,
      `Overnight digest. Three items cleared the reporting threshold and have been queued for triage:\n\n- Subsea telecom fault under investigation east of Gotland\n- Export licensing extended to two further magnet grades\n- Credential-stuffing wave against regional logistics portals\n\nEleven further items below threshold are available in the archive.`,
      [], ['wire'], null, null, 'parsed'],
    ['M-1034', 'T-24', 'advisories@fcdo.gov.uk', 14.0, 'GNSS interference advisory extended â eastern approach', false, false,
      `The aviation authority has extended the GNSS interference advisory across the eastern approach for a further 30 days. Interference is persistent but non-escalating.`,
      [], ['advisory'], 'HW-2470', null, 'parsed'],
    ['M-1033', 'T-23', 'ops@sahel-security.example', 22.0, 'Staff movement â two assurance visits deferred', false, false,
      `Both planned assurance visits have been deferred pending the movement advisory review. Armoured transfer remains required for airport transit.`,
      [], ['field', 'duty-of-care'], null, 'CS-0016', 'new'],
    ['M-1032', 'T-22', 'bulletin@marinerisk.example', 31.0, 'Weekly corridor summary â transit counts and premiums', false, false,
      `Northbound Suez convoy transits are down 31% year-on-year. Sustained rerouting continues to depress counts. Average Asia-Europe voyage time is up 9 to 12 days on affected strings.\n\nJeddah waiting time has risen to 3.1 days from 1.4 a fortnight ago.`,
      [['corridor-weekly-31AUG.pdf', '640 KB']], ['corridor'], null, null, 'parsed'],
    ['M-1031', 'T-21', 'compliance@group.internal', 44.0, 'Designation round â 14 shipping entities, 2 insurers', false, false,
      `The latest round adds 14 shipping entities and 2 insurers, targeting shadow-fleet intermediaries. Screening lists require a refresh within 10 business days.`,
      [['designations-01SEP.pdf', '210 KB']], ['compliance'], 'HW-2477', null, 'parsed']
  ].map(m => ({
    id: m[0], thread: m[1], from: m[2], fromName: (MAIL_SENDERS[m[2]] || {}).name || m[2],
    src: (MAIL_SENDERS[m[2]] || {}).src || 'OSINT-WIRE', rel: (MAIL_SENDERS[m[2]] || {}).rel || .6,
    hoursAgo: m[3], ts: H(m[3]), subject: m[4], unread: m[5], urgent: m[6], body: m[7],
    attachments: (m[8] || []).map(a => ({ name: a[0], size: a[1] })),
    labels: m[9] || [], signalId: m[10], caseId: m[11], state: m[12],
    to: ['intel@horizonwatch.internal']
  }));

  /* Inbound parse rules â sender and subject to signal fields. Deterministic
     and auditable; a rule that cannot be explained does not run. */
  const parseRules = [
    { id: 'PR-1', name: 'Partner corridor bulletins', match: 'from contains marinerisk',
      sets: 'domain=maritime Â· source=PARTNER-FEED Â· severity from subject keywords', on: true, hits: 34 },
    { id: 'PR-2', name: 'Government advisories', match: 'from ends gov.uk OR state.gov',
      sets: 'domain=political Â· source=GOV-ADVISORY Â· conf=0.78', on: true, hits: 71 },
    { id: 'PR-3', name: 'AIS gap alerts', match: 'subject starts "AIS gap"',
      sets: 'domain=maritime Â· attaches vessel by MMSI Â· severity=high', on: true, hits: 12 },
    { id: 'PR-4', name: 'Field reports', match: 'from domain sahel-security.example',
      sets: 'domain=conflict Â· source=FIELD-REP Â· geocode from body', on: true, hits: 28 },
    { id: 'PR-5', name: 'Scene delivery notices', match: 'from copernicus.example',
      sets: 'routes to imagery Â· no signal raised', on: true, hits: 96 },
    { id: 'PR-6', name: 'Urgent escalation on keyword', match: 'subject contains URGENT',
      sets: 'flags urgent Â· notifies duty analyst Â· interrupts inspector', on: true, hits: 9 }
  ];

  /* Outbound: digests, threshold alerts, distribution */
  const outbound = [
    { id: 'OB-1', kind: 'digest', name: 'Morning situation digest', to: 'All analysts',
      when: '0600 local per recipient', last: '03SEP 0600Z', recipients: 8, on: true,
      body: 'Overnight signals above moderate, grouped by region, with any escalations first.' },
    { id: 'OB-2', kind: 'alert', name: 'Critical maritime â immediate', to: 'Group security + duty analyst',
      when: 'on match, throttled 15 min', last: '03SEP 0912Z', recipients: 3, on: true,
      body: 'Single-signal alert with assessment, location and the acknowledge link.' },
    { id: 'OB-3', kind: 'digest', name: 'Weekly exposure review', to: 'Executive committee',
      when: 'Monday 0700 CET', last: '01SEP 0700Z', recipients: 6, on: true,
      body: 'The issued briefing as PDF plus a three-line covering summary.' },
    { id: 'OB-4', kind: 'alert', name: 'Imagery findings above 80%', to: 'Imagery analyst',
      when: 'on detection confirm', last: '02SEP 1441Z', recipients: 2, on: true,
      body: 'Scene reference, finding, confidence and the before/after link.' },
    { id: 'OB-5', kind: 'digest', name: 'Duty-of-care check-in request', to: 'Staff in elevated areas',
      when: '0800 and 1800 local', last: '03SEP 0800Z', recipients: 57, on: false,
      body: 'Check-in request with a one-tap acknowledgement and an escalation path.' }
  ];

  const sent = [
    { id: 'S-91', to: 'Executive committee (6)', subject: 'BRF-0431 Â· Weekly geopolitical exposure review',
      ts: '01SEP 0700Z', kind: 'briefing', receipts: { delivered: 6, opened: 5, failed: 0 } },
    { id: 'S-90', to: 'Group security + duty analyst (3)', subject: 'CRITICAL Â· Bab el-Mandeb â third launch event',
      ts: '03SEP 0912Z', kind: 'alert', receipts: { delivered: 3, opened: 3, failed: 0 } },
    { id: 'S-89', to: 'All analysts (8)', subject: 'Morning situation digest Â· 03SEP',
      ts: '03SEP 0600Z', kind: 'digest', receipts: { delivered: 8, opened: 6, failed: 0 } },
    { id: 'S-88', to: 'Regional security leads (4)', subject: 'RFI-021 Â· Fuel availability, Bamako',
      ts: '02SEP 1520Z', kind: 'rfi', receipts: { delivered: 4, opened: 4, failed: 0 } },
    { id: 'S-87', to: 'Imagery analyst (2)', subject: 'SCN-4471 Â· 4 findings confirmed',
      ts: '02SEP 1441Z', kind: 'alert', receipts: { delivered: 2, opened: 1, failed: 0 } }
  ];

  /* ââ cases âââââââââââââââââââââââââââââââââââââââââââââââââ
     A case bundles records under one owner with a status and a timeline.
     This is what turns ten modules into one job. */
  const cases = [
    { id: 'CS-0014', code: 'RED-SEA-Q3', title: 'Red Sea corridor â sustained interdiction risk',
      owner: 'U2', status: 'active', priority: 'critical', opened: '18AUG', due: '10SEP',
      watchers: ['U1', 'U8', 'U3'],
      summary: 'Standing case for the corridor. Tracks interdiction events, carrier routing decisions, insurance movement and the two hulls of interest. Feeds the weekly exposure review.',
      records: { signals: ['HW-2400', 'HW-2407', 'HW-2428'], entities: ['ENT-RS-01', 'ENT-HZ-01'],
        scenes: ['SCN-4468'], aois: ['AOI-14'], onto: ['N01', 'N02', 'N03'], mail: ['M-1042', 'M-1041', 'M-1038'] },
      notes: [{ by: 'U2', ts: '03SEP 0930Z', body: 'Third launch confirms a re-supplied battery rather than opportunistic fire. Holding contingency routing.' }] },
    { id: 'CS-0016', code: 'SAHEL-FUEL', title: 'Sahel fuel availability and site continuity',
      owner: 'U4', status: 'active', priority: 'high', opened: '24AUG', due: '08SEP',
      watchers: ['U1', 'U3'],
      summary: 'Fuel logistics on the Dakar and Abidjan corridors, convoy interdiction pattern, and generator cover at the contractor site 140km south of the capital.',
      records: { signals: ['HW-2449'], entities: ['ENT-SA-01'], scenes: [], aois: ['AOI-52'],
        onto: ['N18', 'N19', 'N20'], mail: ['M-1039', 'M-1033'] },
      notes: [{ by: 'U4', ts: '02SEP 1610Z', body: 'Nine days of fuel cover at MLI-1. Requesting a decision on pre-positioning before that falls under seven.' }] },
    { id: 'CS-0018', code: 'BALTIC-CABLE', title: 'Baltic subsea â pattern assessment',
      owner: 'U3', status: 'review', priority: 'moderate', opened: '29AUG', due: '12SEP',
      watchers: ['U1', 'U7'],
      summary: 'Four cable and interconnector incidents in fourteen months. Individually explicable, collectively a pattern the continuity plan should assume repeats.',
      records: { signals: ['HW-2421'], entities: ['ENT-BL-01'], scenes: ['SCN-4471'], aois: ['AOI-21'],
        onto: ['N09', 'N10', 'N11'], mail: [] },
      notes: [] },
    { id: 'CS-0019', code: 'TWN-CONC', title: 'Taiwan supplier concentration',
      owner: 'U5', status: 'active', priority: 'high', opened: '30AUG', due: '20SEP',
      watchers: ['U1', 'U2'],
      summary: 'Sixty-three tier-1 suppliers on the island, nine single points of failure, no qualified alternate for two inside six months. Concentration risk, not casualty risk.',
      records: { signals: ['HW-2414'], entities: ['ENT-TW-01'], scenes: [], aois: [],
        onto: ['N12', 'N13', 'N14'], mail: [] },
      notes: [] },
    { id: 'CS-0011', code: 'PANAMA-EASE', title: 'Panama Canal â restriction easing',
      owner: 'U6', status: 'closed', priority: 'low', opened: '02AUG', due: '01SEP',
      watchers: ['U1'],
      summary: 'Closed. Slot cap raised to 34 daily transits and auction premiums fell three weeks running, weakening the case for the US-Gulf re-route adopted in Q2.',
      records: { signals: [], entities: ['ENT-PA-01'], scenes: [], aois: [], onto: [], mail: [] },
      notes: [{ by: 'U6', ts: '01SEP 1100Z', body: 'Closed with a recommendation to revert to direct routing from October.' }] }
  ];

  /* ââ RFIs ââââââââââââââââââââââââââââââââââââââââââââââââ */
  const rfis = [
    { id: 'RFI-021', case: 'CS-0016', from: 'U1', to: 'U4', due: '05SEP', status: 'answered',
      question: 'What is the actual fuel cover at MLI-1 today, and what is the lead time to pre-position a further two weeks?',
      answers: [{ by: 'U4', ts: '02SEP 1610Z', body: 'Nine days at current draw. Pre-positioning two further weeks needs 11 days lead and an escorted movement window. I would start now rather than at seven days.' }] },
    { id: 'RFI-022', case: 'CS-0014', from: 'U2', to: 'U8', due: '04SEP', status: 'open',
      question: 'Can compliance confirm whether either partial match affects the two chartered vessels on the EU-Levant lane before Monday?',
      answers: [] },
    { id: 'RFI-023', case: 'CS-0019', from: 'U1', to: 'U5', due: '08SEP', status: 'open',
      question: 'Which two suppliers have no qualified alternate inside six months, and what would qualification cost?',
      answers: [] },
    { id: 'RFI-020', case: 'CS-0018', from: 'U3', to: 'U7', due: '01SEP', status: 'closed',
      question: 'Does the Chernyakhovsk imagery show anything that bears on the cable corridor assessment?',
      answers: [{ by: 'U7', ts: '31AUG 0940Z', body: 'No direct bearing. The apron dispersal change is an alert-posture indicator, not a maritime one. Filed against the case for context only.' }] }
  ];

  /* ââ comments, notifications, activity âââââââââââââââââââ */
  const comments = [
    { id: 'C-1', ref: 'sig:HW-2400', by: 'U2', ts: '03SEP 0940Z', resolved: false, mentions: ['U1'],
      body: '@K. Almeida this is the third in seven days. I am treating the corridor as constrained rather than episodic â flag if you disagree before the review.' },
    { id: 'C-2', ref: 'sig:HW-2400', by: 'U1', ts: '03SEP 0952Z', resolved: false, mentions: [],
      body: 'Agreed. Hold the contingency routing and put it top of the exposure review.' },
    { id: 'C-3', ref: 'scn:SCN-4471', by: 'U7', ts: '02SEP 1441Z', resolved: false, mentions: ['U3'],
      body: 'Four findings confirmed. @A. Kowalczyk the apron dispersal is the one I would carry into the briefing; the fence realignment is probably maintenance.' },
    { id: 'C-4', ref: 'brf:BRF-0431', by: 'U8', ts: '01SEP 0640Z', resolved: true, mentions: [],
      body: 'Second paragraph said "significant" â removed. We do not use adjectives of emphasis.' },
    { id: 'C-5', ref: 'onto:N02', by: 'U2', ts: '02SEP 1105Z', resolved: false, mentions: ['U8'],
      body: 'The operator link is asserted from charter records, but the affiliation to the second hull is a shared dark-AIS window only. @S. Whitfield can compliance corroborate?' },
    { id: 'C-6', ref: 'case:CS-0016', by: 'U4', ts: '02SEP 1612Z', resolved: false, mentions: ['U1'],
      body: '@K. Almeida raised RFI-021 with my own answer attached so the timeline is complete. Decision needed on pre-positioning.' }
  ];

  const notifications = [
    { id: 'N-1', kind: 'urgent-mail', ref: 'mail:M-1042', by: null, ts: '03SEP 0912Z', read: false, urgent: true,
      text: 'Urgent mail from MarineRisk Partner Feed â third launch event, premium revision' },
    { id: 'N-2', kind: 'mention', ref: 'sig:HW-2400', by: 'U2', ts: '03SEP 0940Z', read: false, urgent: true,
      text: 'M. Sundaram mentioned you on HW-2400' },
    { id: 'N-3', kind: 'urgent-mail', ref: 'mail:M-1041', by: null, ts: '03SEP 0820Z', read: false, urgent: true,
      text: 'Group Compliance â two partial screening matches need a decision' },
    { id: 'N-4', kind: 'assigned', ref: 'sig:HW-2407', by: 'U2', ts: '03SEP 0930Z', read: false, urgent: false,
      text: 'M. Sundaram assigned HW-2407 to you' },
    { id: 'N-5', kind: 'rfi', ref: 'rfi:RFI-021', by: 'U4', ts: '02SEP 1610Z', read: false, urgent: false,
      text: 'T. Achebe answered RFI-021' },
    { id: 'N-6', kind: 'approval', ref: 'brf:BRF-0431', by: 'U8', ts: '01SEP 0640Z', read: true, urgent: false,
      text: 'S. Whitfield left a review comment on BRF-0431' },
    { id: 'N-7', kind: 'mention', ref: 'case:CS-0016', by: 'U4', ts: '02SEP 1612Z', read: true, urgent: false,
      text: 'T. Achebe mentioned you on CS-0016' }
  ];

  const activity = [
    { ts: '03SEP 0952Z', by: 'U1', verb: 'commented on', ref: 'sig:HW-2400', detail: 'Agreed. Hold the contingency routing.' },
    { ts: '03SEP 0940Z', by: 'U2', verb: 'commented on', ref: 'sig:HW-2400', detail: 'Third in seven days' },
    { ts: '03SEP 0930Z', by: 'U2', verb: 'assigned', ref: 'sig:HW-2407', detail: 'to K. Almeida' },
    { ts: '03SEP 0912Z', by: null, verb: 'received urgent mail', ref: 'mail:M-1042', detail: 'MarineRisk Partner Feed' },
    { ts: '03SEP 0600Z', by: null, verb: 'sent digest', ref: 'mail:S-89', detail: '8 recipients, 6 opened' },
    { ts: '02SEP 1612Z', by: 'U4', verb: 'commented on', ref: 'case:CS-0016', detail: 'Decision needed on pre-positioning' },
    { ts: '02SEP 1610Z', by: 'U4', verb: 'answered', ref: 'rfi:RFI-021', detail: 'Nine days at current draw' },
    { ts: '02SEP 1441Z', by: 'U7', verb: 'confirmed 4 detections on', ref: 'scn:SCN-4471', detail: 'apron dispersal carried' },
    { ts: '01SEP 0700Z', by: 'U1', verb: 'issued', ref: 'brf:BRF-0431', detail: 'to Executive committee' },
    { ts: '01SEP 0640Z', by: 'U8', verb: 'reviewed', ref: 'brf:BRF-0431', detail: 'one copy change' }
  ];

  /* ââ approvals: draft â review â approved â issued âââââââ */
  const approvals = {
    'BRF-0431': { stage: 'issued', chain: [
      { stage: 'draft', by: 'U1', ts: '01SEP 0605Z', note: 'Generated from a 12-signal evidence set.' },
      { stage: 'review', by: 'U8', ts: '01SEP 0640Z', note: 'One copy change: removed an adjective of emphasis.' },
      { stage: 'approved', by: 'U1', ts: '01SEP 0652Z', note: 'Approved for the executive committee.' },
      { stage: 'issued', by: 'U1', ts: '01SEP 0700Z', note: 'Distributed to 6 recipients.' }
    ] },
    'BRF-0430': { stage: 'issued', chain: [
      { stage: 'draft', by: 'U2', ts: '01SEP 1400Z', note: 'Red Sea 30-day outlook.' },
      { stage: 'review', by: 'U1', ts: '01SEP 1520Z', note: 'Accepted without change.' },
      { stage: 'approved', by: 'U1', ts: '01SEP 1521Z', note: '' },
      { stage: 'issued', by: 'U1', ts: '01SEP 1530Z', note: 'EMEA distribution.' }
    ] }
  };
  const STAGES = ['draft', 'review', 'approved', 'issued'];

  /* ââ handovers âââââââââââââââââââââââââââââââââââââââââââ */
  const handovers = [
    { id: 'HO-88', from: 'U3', to: 'U1', ts: '03SEP 0700Z', shift: 'Night 1900-0700',
      acked: true,
      did: ['Acknowledged 9 signals, escalated 2', 'Confirmed the Gotland cable fault is single-source and downgraded it', 'Ran the overnight screening and routed two partial matches to compliance'],
      open: ['RFI-022 with compliance, due 04SEP', 'CS-0018 in review, needs a second reader', 'Cabo Delgado scene rejected on cloud, requeued'],
      watch: ['Corridor premium revision expected Monday', 'Second Baltic incident would change the pattern assessment'] }
  ];

  /* ââ Google Workspace connection state âââââââââââââââââââ */
  const mailbox = {
    provider: 'Google Workspace',
    account: 'intel@horizonwatch.internal',
    connected: true,
    scopes: ['gmail.readonly', 'gmail.send', 'gmail.labels', 'calendar.events'],
    lastSync: '2 min ago',
    inboundToday: 34,
    outboundToday: 12,
    quota: '312 of 2,000 daily sends'
  };

  const calendar = [
    { ts: '03SEP 1400Z', title: 'Exposure review â executive committee', kind: 'meeting', with: 'U1, U8' },
    { ts: '03SEP 1600Z', title: 'CS-0014 case review', kind: 'meeting', with: 'U2, U1' },
    { ts: '04SEP 0900Z', title: 'RFI-022 due â compliance', kind: 'due', with: 'U8' },
    { ts: '04SEP 1100Z', title: 'Scheduled scan: Perim Island approaches', kind: 'scan', with: null },
    { ts: '05SEP 0700Z', title: 'RFI-021 due', kind: 'due', with: 'U4' },
    { ts: '08SEP 0700Z', title: 'Monday exposure review issue', kind: 'briefing', with: 'U1' }
  ];

  /* assignments live on signals; seeded here so the corpus stays declarative */
  const assignments = [
    { ref: 'sig:HW-2407', to: 'U1', by: 'U2', due: '04SEP', state: 'open' },
    { ref: 'sig:HW-2449', to: 'U4', by: 'U1', due: '05SEP', state: 'open' },
    { ref: 'sig:HW-2421', to: 'U3', by: 'U1', due: '06SEP', state: 'open' },
    { ref: 'scn:SCN-4459', to: 'U7', by: 'U1', due: '04SEP', state: 'open' },
    { ref: 'sig:HW-2414', to: 'U5', by: 'U2', due: '07SEP', state: 'done' }
  ];

  return { ROLES, users, me: 'U1', MAIL_SENDERS, mail, parseRules, outbound, sent,
    cases, rfis, comments, notifications, activity, approvals, STAGES, handovers,
    mailbox, calendar, assignments };
})();
