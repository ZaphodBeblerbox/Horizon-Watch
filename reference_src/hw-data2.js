/* Horizon Watch â extended corpus: live tracks, infrastructure, imagery scenes
   with ML change detections, ontology graph, seeded annotations.
   Sample corpus. Vessel/aircraft identities are illustrative, not live feeds. */
window.HW2 = (function () {
  /* ââ infrastructure: ports and airports (real locations) ââ */
  const places = [
    ['port', 'Rotterdam', 'NLD', 51.95, 4.14, 'NLRTM'], ['port', 'Hamburg', 'DEU', 53.55, 9.99, 'DEHAM'],
    ['port', 'Jeddah', 'SAU', 21.49, 39.19, 'SAJED'], ['port', 'Djibouti', 'DJI', 11.60, 43.15, 'DJJIB'],
    ['port', 'Aden', 'YEM', 12.79, 45.03, 'YEADE'], ['port', 'Jebel Ali', 'ARE', 25.01, 55.06, 'AEJEA'],
    ['port', 'Bandar Abbas', 'IRN', 27.13, 56.21, 'IRBND'], ['port', 'Kaohsiung', 'TWN', 22.62, 120.29, 'TWKHH'],
    ['port', 'Singapore', 'SGP', 1.26, 103.83, 'SGSIN'], ['port', 'Manila', 'PHL', 14.60, 120.98, 'PHMNL'],
    ['port', 'Odesa', 'UKR', 46.48, 30.72, 'UAODS'], ['port', 'Port Sudan', 'SDN', 19.62, 37.22, 'SDPZU'],
    ['port', 'Guayaquil', 'ECU', -2.19, -79.89, 'ECGYE'], ['port', 'Manzanillo', 'MEX', 19.05, -104.32, 'MXZLO'],
    ['port', 'ColÃ³n', 'PAN', 9.36, -79.90, 'PACOL'], ['port', 'Chattogram', 'BGD', 22.31, 91.80, 'BDCGP'],
    ['port', 'Suez', 'EGY', 29.97, 32.55, 'EGSUZ'], ['port', 'Antofagasta', 'CHL', -23.65, -70.40, 'CLANF'],
    ['airport', 'Amsterdam Schiphol', 'NLD', 52.31, 4.76, 'EHAM'], ['airport', 'Dubai Intl', 'ARE', 25.25, 55.36, 'OMDB'],
    ['airport', 'Nairobi JKIA', 'KEN', -1.32, 36.93, 'HKJK'], ['airport', 'Bamako Senou', 'MLI', 12.53, -7.95, 'GABS'],
    ['airport', 'Taipei Taoyuan', 'TWN', 25.08, 121.23, 'RCTP'], ['airport', 'Warsaw Chopin', 'POL', 52.17, 20.97, 'EPWA'],
    ['airport', 'Beirut Rafic Hariri', 'LBN', 33.82, 35.49, 'OLBA'], ['airport', 'Panama Tocumen', 'PAN', 9.07, -79.38, 'MPTO'],
    ['airport', 'BogotÃ¡ El Dorado', 'COL', 4.70, -74.15, 'SKBO'], ['airport', 'Djibouti Ambouli', 'DJI', 11.55, 43.16, 'HDAM']
  ].map((p, i) => ({ kind: p[0], name: p[1], iso3: p[2], lat: p[3], lon: p[4], code: p[5], id: 'INF-' + String(100 + i) }));

  /* ââ live tracks: vessels (AIS) and aircraft (ADS-B) ââ */
  const vessels = [
    ['247118000', 'MERIDIAN TRADER', 'Bulk carrier', 'Malta', 13.10, 43.05, 12, 11.4, 'SAJED', false, 'on'],
    ['563091000', 'ARC SENTINEL', 'Container', 'Singapore', 12.30, 44.10, 148, 14.8, 'DJJIB', false, 'on'],
    ['636020918', 'KEPHALOS II', 'Crude tanker', 'Liberia', 26.42, 56.48, 312, 9.1, 'IRBND', true, 'dark'],
    ['352001739', 'NORDVIK STAR', 'Product tanker', 'Panama', 25.80, 56.90, 205, 10.6, 'AEJEA', true, 'on'],
    ['477995200', 'HAI LONG 8', 'Bulk carrier', 'Hong Kong', 23.40, 119.90, 28, 12.2, 'TWKHH', false, 'on'],
    ['538007624', 'BALTIC WARDEN', 'General cargo', 'Marshall Is.', 57.62, 19.10, 96, 6.4, 'DEHAM', false, 'dark'],
    ['273449100', 'OKHOTNIK', 'Research', 'Russia', 57.30, 18.80, 274, 3.2, 'â', true, 'dark'],
    ['370512000', 'PACIFIC LEDGER', 'Container', 'Panama', 9.30, -79.55, 178, 8.9, 'PACOL', false, 'on'],
    ['416004700', 'MING HSING', 'Container', 'Taiwan', 22.10, 120.60, 220, 15.1, 'TWKHH', false, 'on'],
    ['235098765', 'ELSTREE BAY', 'LNG carrier', 'UK', -11.30, 40.85, 44, 13.0, 'MZPAL', false, 'on']
  ].map(v => ({ mmsi: v[0], name: v[1], type: v[2], flag: v[3], lat: v[4], lon: v[5], hdg: v[6], spd: v[7], dest: v[8], sanctioned: v[9], ais: v[10], kind: 'vessel' }));

  const aircraft = [
    ['A1B2C3', 'HZW114', 'B738', 'Cargo', 51.20, 5.40, 118, 34000, 452, false],
    ['3C6D9E', 'DLH8842', 'A339', 'Passenger', 48.10, 16.20, 96, 38000, 471, false],
    ['7A22F1', 'RCH471', 'C17', 'State transport', 33.40, 35.90, 272, 29000, 418, false],
    ['48AC91', 'SVR2210', 'A321', 'Passenger', 54.90, 20.90, 64, 33000, 445, true],
    ['76BB03', 'CAL5721', 'B77L', 'Cargo', 24.60, 120.80, 348, 36000, 480, false],
    ['5E1D77', 'ETH3308', 'B788', 'Passenger', 9.60, 39.40, 212, 37000, 462, false],
    ['9F0A24', 'ISR-SURV', 'GLF5', 'Survey', 13.60, 43.60, 154, 41000, 402, false],
    ['2D8E56', 'AVA9021', 'A320', 'Passenger', 5.20, -74.60, 188, 31000, 430, false]
  ].map(a => ({ icao: a[0], callsign: a[1], type: a[2], role: a[3], lat: a[4], lon: a[5], hdg: a[6], alt: a[7], spd: a[8], watch: a[9], kind: 'aircraft' }));

  /* ââ imagery scenes + ML change detections (boxes are % of frame) ââ */
  const scenes = [
    { id: 'SCN-4471', place: 'Chernyakhovsk airbase', iso3: 'RUS', lat: 54.60, lon: 21.78, aoi: 'AOI-21',
      sensor: 'EO Â· 0.5m', vendor: 'Commercial optical', dateA: '2026-06-14', dateB: '2026-08-29', cloud: 3, offNadir: 12.4,
      counts: [['Aircraft', 11, +4], ['Helicopter', 2, 0], ['Revetment', 18, +6], ['Vehicle', 218, +37], ['Fuel bladder', 6, +6]],
      changes: [
        { id: 'CHG-01', label: 'New hardened revetments', type: 'new', conf: .93, bbox: [18, 22, 22, 14], note: 'Six revetments completed on the northern apron since the reference scene.' },
        { id: 'CHG-02', label: 'Fuel bladder farm established', type: 'new', conf: .87, bbox: [55, 58, 16, 12], note: 'Six bladders and a bunded area where hardstanding was previously empty.' },
        { id: 'CHG-03', label: 'Apron dispersal pattern changed', type: 'expanded', conf: .74, bbox: [30, 62, 26, 18], note: 'Aircraft parked dispersed rather than in line, consistent with a raised alert posture.' },
        { id: 'CHG-04', label: 'Perimeter fence realigned', type: 'removed', conf: .68, bbox: [66, 18, 24, 9], note: 'Original fence line removed over 400m; replacement not yet visible.' }
      ] },
    { id: 'SCN-4468', place: 'Bab el-Mandeb â Perim Island', iso3: 'YEM', lat: 12.65, lon: 43.41, aoi: 'AOI-14',
      sensor: 'SAR Â· 1m', vendor: 'Commercial SAR', dateA: '2026-07-02', dateB: '2026-09-01', cloud: 0, offNadir: 28.1,
      counts: [['Vessel', 34, +9], ['Small craft', 21, +11], ['Launcher', 3, +3], ['Structure', 12, +2]],
      changes: [
        { id: 'CHG-05', label: 'Three launcher-sized objects on the eastern shore', type: 'new', conf: .81, bbox: [62, 40, 15, 12], note: 'Radar returns consistent with wheeled launchers under camouflage netting.' },
        { id: 'CHG-06', label: 'Small-craft cluster doubled', type: 'expanded', conf: .89, bbox: [22, 55, 20, 16], note: 'Eleven additional craft moored at the informal jetty.' }
      ] },
    { id: 'SCN-4459', place: 'Cabo Delgado â LNG site', iso3: 'MOZ', lat: -10.94, lon: 40.58, aoi: 'AOI-33',
      sensor: 'EO Â· 0.3m', vendor: 'Commercial optical', dateA: '2026-05-20', dateB: '2026-08-24', cloud: 8, offNadir: 9.2,
      counts: [['Vehicle', 96, -22], ['Accommodation unit', 240, -60], ['Crane', 4, -2], ['Vessel', 3, 0]],
      changes: [
        { id: 'CHG-07', label: 'Contractor camp partially demobilised', type: 'removed', conf: .91, bbox: [26, 30, 30, 22], note: 'Sixty accommodation units and two cranes removed, consistent with a slipped construction schedule.' },
        { id: 'CHG-08', label: 'New security berm on the access road', type: 'new', conf: .77, bbox: [60, 66, 22, 10], note: 'Earth berm and checkpoint structure at the 4km marker.' }
      ] }
  ];

  /* ââ ontology: typed nodes and inferred links ââ */
  const NODE_TYPES = {
    person:   { name: 'Person', glyph: 'person' },
    org:      { name: 'Organisation', glyph: 'org' },
    faction:  { name: 'Armed faction', glyph: 'faction' },
    vessel:   { name: 'Vessel', glyph: 'vessel' },
    aircraft: { name: 'Aircraft', glyph: 'aircraft' },
    facility: { name: 'Facility', glyph: 'facility' },
    country:  { name: 'Country', glyph: 'country' },
    corridor: { name: 'Corridor', glyph: 'corridor' },
    event:    { name: 'Event', glyph: 'event' }
  };
  const LINK_KINDS = ['operates', 'owns', 'flagged in', 'transits', 'located in', 'affiliated with',
    'supplies', 'sanctioned by', 'observed at', 'controls', 'contracted to'];

  const nodes = [
    { id: 'N01', type: 'corridor', label: 'Red Sea corridor', risk: 87, props: { code: 'AOI-14', transits: '1,240/mo', watch: 'daily' } },
    { id: 'N02', type: 'vessel', label: 'KEPHALOS II', risk: 92, props: { mmsi: '636020918', flag: 'Liberia', type: 'Crude tanker', ais: 'dark 14d' } },
    { id: 'N03', type: 'org', label: 'Anchorline Shipping Ltd', risk: 78, props: { domicile: 'Marshall Islands', vessels: '7', incorporated: '2021' } },
    { id: 'N04', type: 'person', label: 'D. Marchetti', risk: 64, props: { role: 'Beneficial owner', nationality: 'undisclosed', 'first seen': '2019' } },
    { id: 'N05', type: 'country', label: 'Yemen', risk: 88, props: { iso3: 'YEM', 'risk index': '5/5' } },
    { id: 'N06', type: 'faction', label: 'Coastal militia (unattributed)', risk: 81, props: { 'observed capability': 'UAV, small craft', 'attribution confidence': 'low' } },
    { id: 'N07', type: 'facility', label: 'Perim Island shore site', risk: 79, props: { scene: 'SCN-4468', 'last imaged': '2026-09-01' } },
    { id: 'N08', type: 'event', label: 'Drone sighting, 02SEP', risk: 74, props: { signal: 'HW-2400', severity: 'critical' } },
    { id: 'N09', type: 'vessel', label: 'OKHOTNIK', risk: 71, props: { mmsi: '273449100', flag: 'Russia', type: 'Research', ais: 'dark 3d' } },
    { id: 'N10', type: 'corridor', label: 'Baltic subsea', risk: 68, props: { code: 'AOI-21', cables: '4', operators: '2' } },
    { id: 'N11', type: 'facility', label: 'Gotland cable landing', risk: 61, props: { operator: 'Nordic carrier', redundancy: 'partial' } },
    { id: 'N12', type: 'country', label: 'Taiwan', risk: 81, props: { iso3: 'TWN', 'risk index': '3/5' } },
    { id: 'N13', type: 'facility', label: 'Kaohsiung terminal 4', risk: 58, props: { throughput: '2.1m TEU', 'our volume': '4.2%' } },
    { id: 'N14', type: 'org', label: 'Tier-1 supplier cluster', risk: 66, props: { suppliers: '63', 'single points': '9' } },
    { id: 'N15', type: 'aircraft', label: 'SVR2210', risk: 44, props: { icao: '48AC91', type: 'A321', note: 'Corridor deviation 22AUG' } },
    { id: 'N16', type: 'org', label: 'Group logistics (internal)', risk: 31, props: { sites: '9', carriers: '14' } },
    { id: 'N17', type: 'facility', label: 'Chernyakhovsk airbase', risk: 76, props: { scene: 'SCN-4471', 'last imaged': '2026-08-29' } },
    { id: 'N18', type: 'country', label: 'Mali', risk: 84, props: { iso3: 'MLI', 'risk index': '5/5' } },
    { id: 'N19', type: 'faction', label: 'Sahel armed group (designated)', risk: 89, props: { designation: 'UN list', 'active since': '2015' } },
    { id: 'N20', type: 'facility', label: 'Site MLI-1', risk: 72, props: { staff: '48', 'fuel cover': '9 days' } }
  ];

  const links = [
    ['N02', 'N03', 'operates', .94, 'Charter records and port-call pattern'],
    ['N03', 'N04', 'owns', .71, 'Registry filing names the same beneficial owner'],
    ['N02', 'N01', 'transits', .88, '9 transits in 60 days before going dark'],
    ['N02', 'N05', 'flagged in', .52, 'Port calls only; flag remains Liberian'],
    ['N06', 'N05', 'located in', .86, 'All observed activity inside Yemeni waters'],
    ['N06', 'N07', 'observed at', .81, 'SAR detections CHG-05'],
    ['N08', 'N01', 'observed at', .91, 'Signal HW-2400'],
    ['N08', 'N06', 'affiliated with', .58, 'Capability match only, attribution low'],
    ['N07', 'N05', 'located in', .97, 'Geolocation'],
    ['N09', 'N10', 'transits', .77, 'Loitering track over the cable corridor'],
    ['N09', 'N11', 'observed at', .69, 'Within 2nm for 6h'],
    ['N11', 'N10', 'located in', .99, 'Landing station'],
    ['N13', 'N12', 'located in', .99, 'Port of Kaohsiung'],
    ['N14', 'N12', 'located in', .82, '63 of 74 suppliers registered on the island'],
    ['N16', 'N13', 'contracted to', .9, 'Two service contracts'],
    ['N16', 'N14', 'supplies', .85, 'Tier-1 dependency'],
    ['N15', 'N10', 'transits', .61, 'Corridor deviation on 22AUG'],
    ['N19', 'N18', 'located in', .93, 'Operating area'],
    ['N19', 'N20', 'observed at', .64, 'Convoy interdictions within 40km'],
    ['N20', 'N18', 'located in', .99, 'Site register'],
    ['N16', 'N20', 'controls', .96, 'Group-owned site'],
    ['N02', 'N09', 'affiliated with', .41, 'Shared dark-AIS window, weak signal']
  ].map((l, i) => ({ id: 'L' + String(i + 1).padStart(2, '0'), s: l[0], t: l[1], kind: l[2], conf: l[3], note: l[4], inferred: l[3] < .8 }));

  /* ââ seeded map annotations ââ */
  const annotations = [
    { id: 'ANN-01', kind: 'area', label: 'Rerouting decision box', by: 'K. Almeida', ts: '01SEP 0940Z',
      pts: [[41.6, 14.4], [45.4, 14.4], [45.4, 11.2], [41.6, 11.2]], note: 'Contingency routing applies inside this box.' },
    { id: 'ANN-02', kind: 'point', label: 'Escort pickup', by: 'T. Nyberg', ts: '31AUG 1710Z', lat: 12.79, lon: 45.03, note: 'Naval escort join-up point for convoy transits.' },
    { id: 'ANN-03', kind: 'line', label: 'Alternate approach', by: 'K. Almeida', ts: '02SEP 0615Z',
      pts: [[43.15, 11.60], [45.03, 12.79], [39.19, 21.49]], note: 'Djibouti to Jeddah keeping east of the watch box.' }
  ];

  /* ââ observation areas (AOIs) ââ
     Standing tasking boxes. Each is scanned on a cadence against the Sentinel
     archive; the detector compares the newest scene to the stored reference. */
  const AOI_CLASSES = {
    airport:  { name: 'Airport / airfield', auto: true },
    port:     { name: 'Port / terminal', auto: true },
    military: { name: 'Military base', auto: true },
    energy:   { name: 'Energy infrastructure', auto: true },
    urban:    { name: 'Urban area', auto: false },
    border:   { name: 'Border crossing', auto: false },
    custom:   { name: 'Analyst-defined', auto: false }
  };
  const DETECT_CLASSES = ['Aircraft', 'Helicopter', 'Vessel', 'Small craft', 'Vehicle', 'Revetment',
    'Structure', 'Damaged structure', 'Container stack', 'Fuel bladder', 'Crane', 'Launcher', 'Berm'];

  const aoiSeed = [
    ['AOI-14', 'Perim Island approaches', 'military', 'YEM', 12.65, 43.41, 6.2, 'daily', 'active', 'SCN-4468', 'M. Sundaram'],
    ['AOI-21', 'Chernyakhovsk airbase', 'airport', 'RUS', 54.60, 21.78, 4.0, 'weekly', 'active', 'SCN-4471', 'A. Kowalczyk'],
    ['AOI-33', 'Cabo Delgado LNG site', 'energy', 'MOZ', -10.94, 40.58, 8.5, '3-day', 'active', 'SCN-4459', 'T. Achebe'],
    ['AOI-07', 'Bandar Abbas naval quay', 'port', 'IRN', 27.13, 56.21, 5.4, 'weekly', 'active', null, 'M. Sundaram'],
    ['AOI-41', 'Odesa grain terminals', 'port', 'UKR', 46.48, 30.72, 7.0, 'daily', 'active', null, 'A. Kowalczyk'],
    ['AOI-52', 'Bamako Senou airfield', 'airport', 'MLI', 12.53, -7.95, 3.6, 'weekly', 'paused', null, 'T. Achebe'],
    ['AOI-58', 'Kharkiv northern districts', 'urban', 'UKR', 50.05, 36.25, 12.0, '3-day', 'active', null, 'A. Kowalczyk']
  ].map(a => ({ id: a[0], name: a[1], cls: a[2], iso3: a[3], lat: a[4], lon: a[5], radiusKm: a[6],
    cadence: a[7], status: a[8], scene: a[9], owner: a[10], auto: false, notes: '' }));

  /* Derived AOIs: when an analyst scopes to a country or corridor, the system
     proposes standing coverage over its critical infrastructure. */
  function deriveAOIs(iso3) {
    return places.filter(p => p.iso3 === iso3).map((p, i) => ({
      id: 'AOI-D' + String(i + 1).padStart(2, '0'),
      name: p.name, cls: p.kind === 'port' ? 'port' : 'airport', iso3: p.iso3,
      lat: p.lat, lon: p.lon, radiusKm: p.kind === 'port' ? 6 : 4,
      cadence: 'weekly', status: 'proposed', scene: null, owner: 'System', auto: true, notes: ''
    }));
  }

  return { places, vessels, aircraft, scenes, nodes, links, NODE_TYPES, LINK_KINDS, annotations,
    aoiSeed, AOI_CLASSES, DETECT_CLASSES, deriveAOIs };
})();
