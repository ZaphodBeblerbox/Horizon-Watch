// 2026-09 alert/detector audit: removed the NEWS_PATTERN_ICONS dict that
// used to sit here — confirmed unused anywhere in the frontend (a grep
// found only its own definition), and an exact duplicate of the first 9
// entries already in ALERT_ICONS below, which IS the real, consumed table.

// Note: this table used to also carry a `icon:` field holding a Lucide
// icon-component name string (e.g. "TrendingUp"). lucide-react was never
// installed and nothing ever resolved that field to a rendered icon — it was
// dead on arrival. Real globe/graph/UI icons now come from the affiliation +
// entity-function symbology in src/globe/markerRenderer.js; only `.label`/
// `.color`/`.description` below are real and consumed anywhere.
export const ALERT_ICONS = {
  // ── News assessment icons (pattern-fired) ────────────────────────────────
  RISING_TENSIONS:       { label: "Rising Tensions",        color: "#FF6B35", description: "Multiple conflict articles detected in same location" },
  PORT_DISRUPTION:       { label: "Port Disruption",        color: "#FF9500", description: "Maritime disruption signals at port" },
  INFRASTRUCTURE_THREAT: { label: "Infrastructure Threat",  color: "#FF2D55", description: "Articles signalling infrastructure attack or damage" },
  ESCALATION_SPIKE:      { label: "Escalation Spike",       color: "#9B0000", description: "Sudden surge in conflict article volume" },
  SANCTIONS_PRESSURE:    { label: "Sanctions Pressure",     color: "#5856D6", description: "Multiple sanctions-related articles targeting same country" },
  MILITARY_MOBILISATION: { label: "Military Mobilisation",  color: "#FF3B30", description: "Troop movement or military buildup signals" },
  HUMANITARIAN_CRISIS:   { label: "Humanitarian Crisis",    color: "#FF6B35", description: "Civilian casualty or displacement signals" },
  CEASEFIRE_BREAKDOWN:   { label: "Ceasefire Breakdown",    color: "#9B0000", description: "Peace process failure or ceasefire violation signals" },
  ENERGY_SUPPLY_RISK:    { label: "Energy Supply Risk",     color: "#FFCC00", description: "Threat to energy supply chain detected" },
  LOITERING_CABLE:    { label: "Cable Loiterer",          color: "#FF6B35", description: "Vessel loitering within cable proximity" },
  LOITERING_PORT:     { label: "Port Loiterer",           color: "#FF6B35", description: "Vessel loitering outside a port boundary" },
  LOITERING_INFRA:    { label: "Infra Loiterer",          color: "#FF9500", description: "Vessel loitering near critical infrastructure" },
  DARK_SHIP:          { label: "Dark Ship",               color: "#8E8E93", description: "Vessel AIS signal lost while underway" },
  DARK_SHIP_CABLE:    { label: "Dark Ship near Cable",    color: "#FF2D55", description: "Dark ship last seen near submarine cable" },
  CHOKEPOINT_TRANSIT: { label: "Chokepoint Transit",      color: "#34AADC", description: "Vessel transiting a strategic chokepoint" },
  CHOKEPOINT_LOITER:  { label: "Chokepoint Loiterer",     color: "#FF6B35", description: "Vessel loitering at a strategic chokepoint" },
  ESCALATED_DUAL:     { label: "Dual Rule Escalation",    color: "#FF2D55", description: "Two simultaneous anomaly rules fired on same vessel" },
  ESCALATED_TRIPLE:   { label: "Triple Rule Escalation",  color: "#9B0000", description: "Three or more anomaly rules fired on same vessel" },
  SANCTIONED_VESSEL:  { label: "Sanctioned Vessel",       color: "#FF3B30", description: "Vessel on sanctions or watch list" },
  IDENTITY_CHANGE:    { label: "Identity Change",         color: "#FF2D55", description: "Vessel MMSI or name changed while at sea" },
  POSITION_JUMP:      { label: "Position Jump",           color: "#FF3B30", description: "Vessel position jumped a physically impossible distance between reports" },
  UNKNOWN_CONTACT:    { label: "Unknown Contact",         color: "#8E8E93", description: "Unidentified vessel contact requiring investigation" },
  FUSION_EVENT:       { label: "Intelligence Fusion Event", color: "#BF5AF2", description: "Multi-domain correlated intelligence event" },
  // 2026-09 alert/detector audit: removed BORDER_CROSSING, FORMATION_SAILING,
  // REVERSE_COURSE, PORT_SKIP, and CONVOY — confirmed via a full backend grep
  // that no detector/rule/alert-generation code anywhere in the codebase
  // ever produces any of these icon_type values. Dead UI referencing
  // nothing, not a currently-working feature.
}

export const FORGE_EXPLANATIONS = {
  // ── News pattern assessments ──────────────────────────────────────────────
  RISING_TENSIONS:       "Multiple conflict or violence-related articles have been detected for this location within a short window. This pattern may indicate escalating political or military tension that warrants monitoring.",
  PORT_DISRUPTION:       "Signals of maritime disruption at or near a port — including access restrictions, congestion, security incidents, or operational shutdowns — have been detected across multiple news sources.",
  INFRASTRUCTURE_THREAT: "News articles indicate a potential attack, sabotage, or sustained threat to critical infrastructure (power, pipelines, telecoms, water). The volume and convergence of signals suggests organised hostile intent.",
  ESCALATION_SPIKE:      "A sudden, sustained increase in conflict-related article volume for this location has been detected. Volume spikes of this nature often precede or coincide with significant ground developments.",
  SANCTIONS_PRESSURE:    "Multiple recent articles report sanctions, trade restrictions, or economic pressure targeting the same country or entity — suggesting a coordinated international pressure campaign.",
  MILITARY_MOBILISATION: "Articles reporting troop movements, military exercises, or force build-up have been detected for this location. Consistent with pre-crisis military positioning or a show of force.",
  HUMANITARIAN_CRISIS:   "Civilian casualties, population displacement, or humanitarian emergency signals have been detected across multiple sources for this location.",
  CEASEFIRE_BREAKDOWN:   "Signals of ceasefire violations, peace process failure, or renewed hostilities have been detected — indicating a potential collapse of active diplomatic arrangements.",
  ENERGY_SUPPLY_RISK:    "Articles reporting threats to energy production, transit, or supply infrastructure have been detected. May indicate imminent disruption to regional or global energy supply.",
  // ── AIS anomalies ─────────────────────────────────────────────────────────
  LOITERING_CABLE:    "A vessel has been stationary or slow-moving within the proximity zone of a submarine data cable for an extended period. Deliberate loitering near cables is associated with cable-cutting and sabotage operations.",
  LOITERING_PORT:     "A vessel has been loitering outside a port boundary without entering or departing. This pattern may indicate surveillance, illicit ship-to-ship transfer, or smuggling operations.",
  LOITERING_INFRA:    "A vessel is loitering in close proximity to critical maritime infrastructure — including offshore platforms, energy pipelines, or power interconnectors.",
  DARK_SHIP:          "A vessel's AIS transponder went silent while underway in open water. AIS deactivation is a known indicator of sanctions evasion, illicit cargo transfer, or preparation for an undeclared maritime operation.",
  DARK_SHIP_CABLE:    "A vessel's AIS signal was last observed near a submarine cable before going dark. This specific pattern is associated with deliberate interference or covert operations against undersea cable infrastructure.",
  CHOKEPOINT_TRANSIT: "A vessel is transiting or has recently transited a strategically significant maritime chokepoint. Activity at chokepoints is monitored closely given the high economic and security impact of any disruption.",
  CHOKEPOINT_LOITER:  "A vessel is loitering at or near a strategic maritime chokepoint without apparent operational purpose. Loitering at chokepoints can indicate surveillance, pre-positioning, or an undeclared rendezvous.",
  ESCALATED_DUAL:     "Two separate Forge anomaly rules have fired simultaneously on this vessel. Concurrent rule matches indicate elevated threat probability — both signals should be assessed together.",
  ESCALATED_TRIPLE:   "Three or more Forge anomaly rules have fired simultaneously on this vessel. This is the highest-priority alert tier — the vessel's behaviour matches multiple independent threat indicators at once.",
  SANCTIONED_VESSEL:  "This vessel appears on a sanctions list, watch list, or is associated with a sanctioned entity. Any transit or activity by sanctioned vessels may indicate sanctions evasion or illicit trade.",
  IDENTITY_CHANGE:    "This vessel's MMSI number or registered name was changed while at sea — a practice associated with sanctions evasion, flag-of-convenience abuse, and illicit maritime operations. Note: with a single AIS receiver and no multi-source correlation, this same signal cannot be distinguished from two different vessels colliding on a reused or misconfigured MMSI.",
  POSITION_JUMP:      "This vessel's reported position moved a physically impossible distance between two consecutive detection cycles — an implied speed far beyond any real vessel. Consistent with AIS spoofing, GPS manipulation, MMSI reuse by a different vessel, or a data error; this signal alone cannot distinguish between those causes.",
  UNKNOWN_CONTACT:    "An unidentified vessel has been detected in a monitored area with insufficient data to classify. Unknown contacts in sensitive or restricted zones require investigation.",
  FUSION_EVENT:       "Multiple independent intelligence signals from different domains — AIS, news, satellite imagery, or ADSB — have been correlated into a single event by the Forge fusion engine. Fusion events represent higher-confidence threat indicators than any single-source alert.",
}

export const NEWS_PATTERN_ICON_KEYS = new Set([
  "RISING_TENSIONS", "PORT_DISRUPTION", "INFRASTRUCTURE_THREAT", "ESCALATION_SPIKE",
  "SANCTIONS_PRESSURE", "MILITARY_MOBILISATION", "HUMANITARIAN_CRISIS",
  "CEASEFIRE_BREAKDOWN", "ENERGY_SUPPLY_RISK",
])

// 2026-09 alert/detector audit: removed the "stationary_near_infrastructure"
// and "transponder_gap" entries here — both were trigger_type strings from
// AISAnomalyDetector.check_vessel(), which had zero real callers anywhere
// (confirmed dead in main.py's own comments) and has now been deleted
// outright from ais_detector.py. Neither trigger_type can ever be produced
// again.
export const DEFAULT_ICON_FOR_TRIGGER = {
  AIS_LOITERING_NEAR_CABLE:       "LOITERING_CABLE",
  AIS_LOITERING_NEAR_INFRA:       "LOITERING_INFRA",
  AIS_DARK_SHIP:                  "DARK_SHIP",
  chokepoint_loitering:           "CHOKEPOINT_LOITER",
  ESCALATED_DUAL:                 "ESCALATED_DUAL",
  ESCALATED_TRIPLE:               "ESCALATED_TRIPLE",
  AIS_POSITION_JUMP:              "POSITION_JUMP",
  AIS_IDENTITY_MISMATCH:          "IDENTITY_CHANGE",
}
