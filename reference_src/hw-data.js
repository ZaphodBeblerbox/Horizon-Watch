/* Horizon Watch â sample corpus. Real places, plausible risk reporting.
   Not live intelligence: illustrative content for the console. */
window.HW = (function () {
  const DOMAINS = {
    conflict:  { name: 'Armed conflict',      color: '#8d9aa4', short: 'CONF' },
    maritime:  { name: 'Maritime & chokepoints', color: '#7d8993', short: 'MARI' },
    cyber:     { name: 'Cyber & infrastructure', color: '#6f7b85', short: 'CYBR' },
    energy:    { name: 'Energy & commodities', color: '#626e78', short: 'ENRG' },
    trade:     { name: 'Trade & sanctions',   color: '#55616b', short: 'TRDE' },
    civil:     { name: 'Civil unrest',        color: '#4a555f', short: 'CIVL' },
    political: { name: 'Political & legal',   color: '#404b54', short: 'POLI' }
  };
  const SEV = {
    critical: { color: '#c4453c', rank: 4, name: 'Critical' },
    high:     { color: '#b7822c', rank: 3, name: 'High' },
    moderate: { color: '#4f7fa6', rank: 2, name: 'Moderate' },
    low:      { color: '#6d7883', rank: 1, name: 'Low' }
  };
  const SOURCES = ['OSINT-WIRE', 'PARTNER-FEED', 'AIS-TRACK', 'GDELT-XR', 'FIELD-REP', 'SAT-TASK', 'GOV-ADVISORY'];

  // ts = hours before "now"
  const raw = [
    ['Bab el-Mandeb','Yemen','YEM',12.58,43.33,'maritime','critical',0.91,2,'AIS-TRACK','Two bulk carriers reroute after drone sighting near Bab el-Mandeb','Vessel operators report an unidentified UAV tracking transits 18nm north of Perim Island. Two chartered bulkers on the Djibouti-Jeddah leg diverted to a holding pattern off Assab. War-risk premiums quoted 0.4pp higher on the corridor this week.',['Suez routing','Insurance','Tier-2 supplier']],
    ['Strait of Hormuz','Oman','OMN',26.57,56.25,'maritime','high',0.84,6,'AIS-TRACK','GPS interference degrades navigation for 40+ vessels off Bandar Abbas','Persistent spoofing reported across the inbound lane. Positions displaced 3-8nm. Three of our contracted carriers now require pilot escort, adding 9-14h to laden transits.',['Crude imports','Charter contracts']],
    ['Taiwan Strait','Taiwan','TWN',24.20,119.60,'conflict','high',0.78,9,'OSINT-WIRE','Extended air-defence identification activity narrows the median line buffer','Sustained sortie activity in the southwestern ADIZ for a fourth consecutive day. Two commercial airlines filed alternate routings. No change to port operations at Kaohsiung.',['Semiconductor supply','Air freight','Site KHH-2']],
    ['Kaohsiung','Taiwan','TWN',22.62,120.29,'trade','moderate',0.72,26,'PARTNER-FEED','Export-control screening extended to two additional tooling categories','Customs guidance adds metrology and photolithography spares to the licensed list. Expect 10-15 working-day clearance on affected part numbers.',['Semiconductor supply','Procurement']],
    ['Red Sea / Jeddah','Saudi Arabia','SAU',21.49,39.19,'maritime','moderate',0.69,14,'OSINT-WIRE','Jeddah berth congestion builds as diverted volumes arrive','Average waiting time up to 3.1 days from 1.4 a fortnight ago. Feeder schedules to Djibouti slipping.',['Freight cost','Distribution']],
    ['Odesa','Ukraine','UKR',46.48,30.72,'conflict','critical',0.88,4,'FIELD-REP','Overnight strikes hit grain-handling infrastructure at the Odesa cluster','Two silos and a conveyor gallery reported damaged. Corridor sailings paused pending survey. One of our forwarders has suspended inland pickup for 48h.',['Grain contracts','Logistics partner LG-14']],
    ['Kharkiv','Ukraine','UKR',49.99,36.23,'conflict','high',0.81,18,'FIELD-REP','Sustained pressure on the northern power grid segment','Rolling outages of 6-10h reported across the oblast. Diesel generation stock at partner sites covers 72h.',['Business continuity']],
    ['Gotland / Baltic','Sweden','SWE',57.47,18.49,'cyber','high',0.74,20,'GOV-ADVISORY','Subsea telecom cable fault under investigation east of Gotland','Two operators confirm a break; traffic rerouted with 22ms added latency. National authorities have opened an inquiry into a merchant vessel that loitered over the corridor.',['Network latency','Data replication']],
    ['Kaliningrad','Russia','RUS',54.71,20.51,'conflict','moderate',0.67,30,'OSINT-WIRE','Airspace restriction notice issued over the Kaliningrad corridor','NOTAM covers FL95-FL245 for six days. Two of our regional flights rebooked via Warsaw.',['Travel policy']],
    ['RzeszÃ³w','Poland','POL',50.04,21.99,'political','low',0.7,40,'PARTNER-FEED','Border throughput normalises after haulier protest ends','Queue times at the southeastern crossings back under 4h. Contract carriers resumed standard schedules.',['Inbound logistics']],
    ['Bamako','Mali','MLI',12.64,-8.00,'conflict','critical',0.86,7,'PARTNER-FEED','Fuel convoy interdictions push Bamako pump availability below 30%','Third week of disrupted deliveries on the Dakar and Abidjan corridors. Two mining clients have moved to airlift for critical spares.',['Site MLI-1','Fuel supply','Staff movement']],
    ['Niamey','Niger','NER',13.51,2.11,'political','high',0.75,34,'GOV-ADVISORY','Residency and work-permit renewals suspended for two categories','Renewals paused pending a new ministerial decree. Four expatriate staff affected; legal counsel engaged.',['Workforce compliance']],
    ['Ouagadougou','Burkina Faso','BFA',12.37,-1.52,'conflict','high',0.72,52,'OSINT-WIRE','Escort requirement extended to two additional regional highways','Movement now permitted in convoy only on the RN1 and RN4 segments. Journey management plans updated.',['Staff movement']],
    ['Port Sudan','Sudan','SDN',19.62,37.22,'conflict','critical',0.83,11,'OSINT-WIRE','Humanitarian corridor disruption spreads to Port Sudan approaches','Berth allocation is being prioritised for relief cargo. Two commercial calls cancelled this week.',['Regional distribution']],
    ['Goma','DR Congo','COD',-1.68,29.22,'conflict','high',0.79,22,'FIELD-REP','Front-line movement closes the Goma-Sake axis to civilian traffic','Local staff relocated to the western district. Cobalt and tantalum flows from two upstream suppliers now unverified.',['Battery-metals supply','Duty of care']],
    ['Cabo Delgado','Mozambique','MOZ',-11.10,40.60,'energy','high',0.76,28,'PARTNER-FEED','Security incidents within 40km of the LNG construction footprint','Two attacks reported on inland villages. Contractor mobilisation slips a further quarter on published guidance.',['LNG offtake']],
    ['Lagos','Nigeria','NGA',6.52,3.38,'civil','moderate',0.66,16,'OSINT-WIRE','Fuel-subsidy protest actions announced for three southern states','Labour federations call a two-day stoppage. Port gate access at Apapa likely constrained.',['Distribution','Site NGA-3']],
    ['Basra','Iraq','IRQ',30.51,47.78,'energy','high',0.77,15,'OSINT-WIRE','Loading delays at the southern export terminals after equipment failure','Two single-point moorings offline for repair, cutting nominal loading capacity by roughly a fifth for 5-7 days.',['Crude imports']],
    ['Beirut','Lebanon','LBN',33.89,35.50,'conflict','high',0.73,21,'GOV-ADVISORY','Advisory raised for southern districts; airport operations unchanged','Non-essential travel to the south advised against. Our two contracted hotels remain operational.',['Travel policy']],
    ['Tehran','Iran','IRN',35.69,51.39,'trade','high',0.8,32,'GOV-ADVISORY','New designations add 14 entities to the restricted-party list','Screening run against the vendor master returned two partial matches under review by compliance.',['Third-party risk','Payments']],
    ['Istanbul','Turkey','TUR',41.01,28.98,'trade','moderate',0.7,44,'PARTNER-FEED','Transit-licence backlog lengthens for dual-use categories','Clearance running 12-18 days against a 7-day service level. Two shipments held at the HalkalÄ± terminal.',['Procurement']],
    ['Suez Canal','Egypt','EGY',30.03,32.55,'maritime','moderate',0.75,24,'AIS-TRACK','Northbound convoy transits down 31% year-on-year','Sustained rerouting via the Cape continues to depress transit counts. Average Asia-Europe voyage time up 9-12 days on affected strings.',['Freight cost','Inventory cover']],
    ['Panama Canal','Panama','PAN',9.08,-79.68,'maritime','moderate',0.71,36,'AIS-TRACK','Draught restriction eased to 14.6m as GatÃºn levels recover','Booking slots increase to 34 per day from next week. Two of our strings can restore direct routing.',['Freight cost']],
    ['Manzanillo','Mexico','MEX',19.05,-104.32,'civil','moderate',0.64,29,'OSINT-WIRE','Customs-broker work stoppage slows container release','Release times at 4.2 days against a 1.8-day baseline. Priority spares moved to air.',['Inbound logistics']],
    ['Guayaquil','Ecuador','ECU',-2.19,-79.89,'civil','high',0.72,19,'FIELD-REP','Port-district security incidents prompt curfew extension','Night movement restricted in three parishes. Our forwarder has moved to daylight-only drayage.',['Site ECU-1','Staff movement']],
    ['Caracas','Venezuela','VEN',10.49,-66.90,'political','moderate',0.62,48,'OSINT-WIRE','Currency-control amendment changes repatriation windows','Monthly repatriation now requires a central-bank filing. Treasury reviewing exposure of two receivables.',['Treasury']],
    ['Lima','Peru','PER',-12.05,-77.04,'civil','low',0.68,55,'OSINT-WIRE','Roadblock actions lift on the central highway after negotiations','Concentrate haulage resumed. Backlog clearance expected within four days.',['Mining logistics']],
    ['Antofagasta','Chile','CHL',-23.65,-70.40,'energy','low',0.7,61,'PARTNER-FEED','Grid operator publishes revised curtailment schedule','Two of three curtailment windows removed for Q4. Copper-processing partner confirms no output impact.',['Copper supply']],
    ['Manila','Philippines','PHL',14.60,120.98,'maritime','high',0.74,10,'OSINT-WIRE','Water-cannon incident near a contested shoal draws diplomatic protest','Second incident in a fortnight. Local crewing agencies report no change to seafarer availability.',['Crewing','Regional freight']],
    ['Jakarta','Indonesia','IDN',-6.21,106.85,'trade','moderate',0.69,38,'GOV-ADVISORY','Nickel-export rule change tightens downstream-processing proof','Exporters must file additional smelter documentation from next quarter. Two suppliers not yet compliant.',['Battery-metals supply']],
    ['Yangon','Myanmar','MMR',16.87,96.20,'political','high',0.71,58,'OSINT-WIRE','Banking-channel restrictions widen for foreign-currency settlement','Settlement now routed through two approved correspondents only. Payment lead time up to 11 days.',['Payments','Vendor risk']],
    ['Karachi','Pakistan','PAK',24.86,67.01,'civil','moderate',0.63,42,'OSINT-WIRE','Power-tariff protests close two arterial roads intermittently','Port access maintained. Staff shuttle routes re-timed.',['Site PAK-2']],
    ['Dhaka','Bangladesh','BGD',23.81,90.41,'civil','high',0.7,13,'FIELD-REP','Garment-sector wage action spreads to a second industrial zone','Roughly 60 units affected in Ashulia and Gazipur. Two of our tier-1 apparel suppliers report a three-day production loss.',['Apparel sourcing','Order book']],
    ['Seoul','South Korea','KOR',37.57,126.98,'cyber','moderate',0.76,8,'PARTNER-FEED','Credential-stuffing campaign targets logistics portals in the region','Partner SOC reports 40k attempts against three freight-booking portals. MFA enforcement verified on our tenants.',['Identity security','Logistics IT']],
    ['Tokyo','Japan','JPN',35.68,139.69,'political','low',0.72,50,'GOV-ADVISORY','Economic-security screening thresholds lowered for two sectors','Notification now required for stakes above 1%. Corporate development reviewing two pending transactions.',['M&A pipeline']],
    ['Nouakchott','Mauritania','MRT',18.08,-15.98,'energy','low',0.65,64,'PARTNER-FEED','Offshore gas project confirms first-cargo window unchanged','Operator reiterates guidance despite a subsea equipment delay.',['Gas offtake']],
    ['Tripoli','Libya','LBY',32.89,13.19,'energy','high',0.73,25,'OSINT-WIRE','Field shutdown removes an estimated 270kb/d from export streams','Local guard force blockading two facilities over pay arrears. Sharara loadings suspended.',['Crude imports']],
    ['Addis Ababa','Ethiopia','ETH',9.03,38.74,'political','moderate',0.66,46,'OSINT-WIRE','Foreign-exchange allocation rules revised for importers','Priority list narrows to fuel, pharma and fertiliser. Two open purchase orders at risk of payment delay.',['Payments']],
    ['Mogadishu','Somalia','SOM',2.05,45.32,'conflict','high',0.7,54,'GOV-ADVISORY','Movement advisory tightened around two arterial routes','Armoured transfer required for airport transit. Two planned assurance visits deferred.',['Travel policy']],
    ['Rotterdam','Netherlands','NLD',51.95,4.14,'cyber','moderate',0.78,5,'PARTNER-FEED','Terminal operating system outage clears after 7h at two berths','Operator attributes the outage to a failed update, not intrusion. Gate throughput recovering; 340 containers rolled.',['Inbound logistics','European DC']],
    ['Hamburg','Germany','DEU',53.55,9.99,'trade','low',0.74,60,'GOV-ADVISORY','Customs authority publishes new dual-use interpretive guidance','Classification of two of our export lines needs re-validation before the quarter closes.',['Export compliance']],
    ['Marseille','France','FRA',43.30,5.37,'civil','low',0.67,66,'OSINT-WIRE','Port strike notice withdrawn after mediated settlement','Cargo operations normal from Monday. No further action signalled this quarter.',['Mediterranean freight']]
  ];

  const now = Date.now();
  const events = raw.map((r, i) => {
    const ts = new Date(now - r[8] * 3600e3);
    return {
      id: 'HW-' + String(2400 + i * 7).padStart(4, '0'),
      place: r[0], country: r[1], iso3: r[2], lat: r[3], lon: r[4],
      domain: r[5], severity: r[6], conf: r[7], hoursAgo: r[8], source: r[9],
      title: r[10], summary: r[11], impacts: r[12],
      ts, region: regionOf(r[2]),
      status: 'new'
    };
  });
  events.forEach((e, i) => { if (i % 5 === 3) e.status = 'ack'; });

  function regionOf(iso) {
    const emea = ['YEM','OMN','SAU','UKR','SWE','RUS','POL','MLI','NER','BFA','SDN','COD','MOZ','NGA','IRQ','LBN','IRN','TUR','EGY','LBY','ETH','SOM','NLD','DEU','FRA','MRT'];
    const apac = ['TWN','PHL','IDN','MMR','PAK','BGD','KOR','JPN'];
    if (emea.includes(iso)) return 'EMEA';
    if (apac.includes(iso)) return 'APAC';
    return 'AMER';
  }

  const entities = [
    { id:'ENT-RS-01', code:'AOI-14', name:'Red Sea corridor', type:'Corridor', iso3:'YEM', lat:14.5, lon:42.5, score:87, delta:+6,
      exposure:{ sites:0, staff:12, suppliers:41, revenue:'8.4%' },
      note:'Transit corridor covering Bab el-Mandeb to Jeddah. Our exposure is routing and insurance, not fixed assets.' },
    { id:'ENT-TW-01', code:'AOI-03', name:'Taiwan Strait', type:'Corridor', iso3:'TWN', lat:24.2, lon:119.6, score:81, delta:+3,
      exposure:{ sites:2, staff:340, suppliers:63, revenue:'19.2%' },
      note:'Single largest concentration of tier-1 semiconductor dependency. Two assembly sites inside the exposure ring.' },
    { id:'ENT-UA-01', code:'CTY-UKR', name:'Ukraine', type:'Country', iso3:'UKR', lat:49.0, lon:32.0, score:92, delta:+1,
      exposure:{ sites:1, staff:64, suppliers:18, revenue:'2.1%' },
      note:'Active conflict. One service centre operating on reduced hours with generator cover.' },
    { id:'ENT-SA-01', code:'REG-SHL', name:'Central Sahel', type:'Region', iso3:'MLI', lat:14.0, lon:-2.0, score:84, delta:+8,
      exposure:{ sites:3, staff:118, suppliers:9, revenue:'4.7%' },
      note:'Mali, Burkina Faso, Niger. Fuel, permits and road movement are the binding constraints.' },
    { id:'ENT-HZ-01', code:'AOI-07', name:'Strait of Hormuz', type:'Corridor', iso3:'OMN', lat:26.5, lon:56.3, score:76, delta:-2,
      exposure:{ sites:0, staff:4, suppliers:22, revenue:'11.0%' },
      note:'Crude and product routing. GPS interference is the current operational issue.' },
    { id:'ENT-BL-01', code:'AOI-21', name:'Baltic subsea', type:'Infrastructure', iso3:'SWE', lat:57.5, lon:19.0, score:68, delta:+5,
      exposure:{ sites:0, staff:0, suppliers:6, revenue:'â' },
      note:'Cable and pipeline corridor. Latency and data-replication risk for the Nordic region.' },
    { id:'ENT-BD-01', code:'CTY-BGD', name:'Bangladesh', type:'Country', iso3:'BGD', lat:23.7, lon:90.4, score:63, delta:+4,
      exposure:{ sites:0, staff:6, suppliers:74, revenue:'6.3%' },
      note:'Apparel sourcing concentration. Labour action is the recurring driver.' },
    { id:'ENT-EC-01', code:'CTY-ECU', name:'Ecuador', type:'Country', iso3:'ECU', lat:-1.8, lon:-78.2, score:59, delta:+2,
      exposure:{ sites:1, staff:47, suppliers:11, revenue:'1.4%' },
      note:'Guayaquil distribution hub. Security of movement dominates the risk picture.' },
    { id:'ENT-PA-01', code:'AOI-09', name:'Panama Canal', type:'Corridor', iso3:'PAN', lat:9.1, lon:-79.7, score:44, delta:-9,
      exposure:{ sites:0, staff:0, suppliers:28, revenue:'5.2%' },
      note:'Draught restrictions easing. Watch item rather than active issue.' },
    { id:'ENT-NL-01', code:'CTY-NLD', name:'Netherlands', type:'Country', iso3:'NLD', lat:52.1, lon:5.3, score:31, delta:0,
      exposure:{ sites:2, staff:610, suppliers:96, revenue:'14.8%' },
      note:'European distribution centre. Cyber and industrial action are the only live vectors.' }
  ];

  // country risk index for the choropleth
  const risk = {
    UKR:5,RUS:4,YEM:5,SDN:5,MLI:5,BFA:5,NER:4,SOM:4,COD:4,LBY:4,IRQ:4,IRN:4,LBN:4,MMR:4,VEN:4,HTI:5,
    SYR:5,AFG:5,PAK:3,BGD:3,ETH:3,MOZ:3,NGA:3,TWN:3,PHL:3,ECU:3,PER:2,MEX:3,COL:3,TUR:2,EGY:2,SAU:2,
    IDN:2,IND:2,CHN:3,KOR:2,JPN:1,POL:2,SWE:1,FIN:1,NLD:1,DEU:1,FRA:1,GBR:1,USA:1,CAN:1,AUS:1,BRA:2,
    CHL:1,ARG:2,ZAF:2,KEN:2,MAR:1,DZA:2,TUN:2,JOR:2,ISR:3,PSE:4,OMN:1,ARE:1,QAT:1,KWT:2,AZE:2,ARM:2,
    GEO:2,KAZ:2,UZB:2,BLR:3,MDA:3,SRB:2,GRC:1,ITA:1,ESP:1,PRT:1,NOR:1,DNK:1,IRL:1,CHE:1,AUT:1,BEL:1,
    CZE:1,HUN:2,ROU:2,BGR:2,HRV:1,SVK:1,SVN:1,EST:2,LVA:2,LTU:2,VNM:2,THA:2,MYS:1,SGP:1,NZL:1,LKA:2,
    NPL:2,MNG:1,PNG:3,TCD:4,NGA_:3,CMR:3,CAF:5,SSD:5,ERI:4,MRT:2,SEN:1,GHA:1,CIV:2,GIN:3,MLI_:5
  };

  const flows = [
    { from:[103.8,1.29], to:[32.55,30.03], label:'Asia-Europe (Suez)', kind:'trade', color:'#6a757f' },
    { from:[103.8,1.29], to:[18.42,-33.92], label:'Asia-Europe (Cape reroute)', kind:'trade', color:'#8a7a5f' },
    { from:[56.25,26.57], to:[4.14,51.95], label:'Crude â Hormuz to Rotterdam', kind:'energy', color:'#6a757f' },
    { from:[120.29,22.62], to:[-118.2,33.75], label:'Semis â Kaohsiung to LAX', kind:'trade', color:'#6a757f' },
    { from:[90.41,23.81], to:[9.99,53.55], label:'Apparel â Chattogram to Hamburg', kind:'trade', color:'#6a757f' }
  ];

  const aois = [
    { name:'Bab el-Mandeb watch box', pts:[[42.4,13.4],[44.2,13.4],[44.2,11.6],[42.4,11.6]] },
    { name:'Taiwan Strait watch box', pts:[[118.0,25.6],[121.4,25.6],[121.4,22.4],[118.0,22.4]] }
  ];

  // 30-day series per entity + domain volumes for analytics
  function series(seed, n, base, amp) {
    let x = seed, out = [];
    for (let i = 0; i < n; i++) {
      x = (x * 9301 + 49297) % 233280;
      out.push(Math.max(0, Math.round(base + (x / 233280 - .45) * amp + Math.sin(i / 3.2) * amp * .35)));
    }
    return out;
  }

  const analytics = {
    days: 30,
    volume: series(7, 30, 46, 26),
    bySeverity: {
      critical: series(11, 30, 6, 6),
      high:     series(23, 30, 14, 10),
      moderate: series(31, 30, 19, 12),
      low:      series(47, 30, 11, 8)
    },
    movers: [
      { name:'Central Sahel', v:84, d:+8, dom:'conflict' },
      { name:'Baltic subsea', v:68, d:+5, dom:'cyber' },
      { name:'Red Sea corridor', v:87, d:+6, dom:'maritime' },
      { name:'Bangladesh', v:63, d:+4, dom:'civil' },
      { name:'Taiwan Strait', v:81, d:+3, dom:'conflict' },
      { name:'Panama Canal', v:44, d:-9, dom:'maritime' },
      { name:'Strait of Hormuz', v:76, d:-2, dom:'maritime' }
    ]
  };

  const briefings = [
    { id:'BRF-0431', title:'Weekly geopolitical exposure review', scope:'Global', ts:'today 06:00Z', status:'published', author:'K. Almeida' },
    { id:'BRF-0430', title:'Red Sea routing: 30-day outlook', scope:'EMEA', ts:'2d ago', status:'published', author:'System agent' },
    { id:'BRF-0429', title:'Sahel fuel availability and site continuity', scope:'EMEA', ts:'4d ago', status:'archived', author:'T. Nyberg' }
  ];

  return { DOMAINS, SEV, SOURCES, events, entities, risk, flows, aois, analytics, briefings, series };
})();
