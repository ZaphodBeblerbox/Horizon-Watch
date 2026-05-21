// ── News Pattern Assessment Icons ─────────────────────────────────────────────
export const NEWS_PATTERN_ICONS = {
  RISING_TENSIONS:       { label: "Rising Tensions",        color: "#FF6B35", description: "Multiple conflict articles detected in same location" },
  PORT_DISRUPTION:       { label: "Port Disruption",        color: "#FF9500", description: "Maritime disruption signals at port" },
  INFRASTRUCTURE_THREAT: { label: "Infrastructure Threat",  color: "#FF2D55", description: "Articles signalling infrastructure attack or damage" },
  ESCALATION_SPIKE:      { label: "Escalation Spike",       color: "#9B0000", description: "Sudden surge in conflict article volume" },
  SANCTIONS_PRESSURE:    { label: "Sanctions Pressure",     color: "#5856D6", description: "Multiple sanctions-related articles targeting same country" },
  MILITARY_MOBILISATION: { label: "Military Mobilisation",  color: "#FF3B30", description: "Troop movement or military buildup signals" },
  HUMANITARIAN_CRISIS:   { label: "Humanitarian Crisis",    color: "#FF6B35", description: "Civilian casualty or displacement signals" },
  CEASEFIRE_BREAKDOWN:   { label: "Ceasefire Breakdown",    color: "#9B0000", description: "Peace process failure or ceasefire violation signals" },
  ENERGY_SUPPLY_RISK:    { label: "Energy Supply Risk",     color: "#FFCC00", description: "Threat to energy supply chain detected" },
}

export const ALERT_ICONS = {
  // ── News assessment icons (pattern-fired) ────────────────────────────────
  RISING_TENSIONS:       { label: "Rising Tensions",        icon: "TrendingUp",  color: "#FF6B35", description: "Multiple conflict articles detected in same location" },
  PORT_DISRUPTION:       { label: "Port Disruption",        icon: "Anchor",      color: "#FF9500", description: "Maritime disruption signals at port" },
  INFRASTRUCTURE_THREAT: { label: "Infrastructure Threat",  icon: "Zap",         color: "#FF2D55", description: "Articles signalling infrastructure attack or damage" },
  ESCALATION_SPIKE:      { label: "Escalation Spike",       icon: "Activity",    color: "#9B0000", description: "Sudden surge in conflict article volume" },
  SANCTIONS_PRESSURE:    { label: "Sanctions Pressure",     icon: "Scale",       color: "#5856D6", description: "Multiple sanctions-related articles targeting same country" },
  MILITARY_MOBILISATION: { label: "Military Mobilisation",  icon: "Crosshair",   color: "#FF3B30", description: "Troop movement or military buildup signals" },
  HUMANITARIAN_CRISIS:   { label: "Humanitarian Crisis",    icon: "Heart",       color: "#FF6B35", description: "Civilian casualty or displacement signals" },
  CEASEFIRE_BREAKDOWN:   { label: "Ceasefire Breakdown",    icon: "ShieldOff",   color: "#9B0000", description: "Peace process failure or ceasefire violation signals" },
  ENERGY_SUPPLY_RISK:    { label: "Energy Supply Risk",     icon: "Flame",       color: "#FFCC00", description: "Threat to energy supply chain detected" },
  LOITERING_CABLE:    { label: "Cable Loiterer",          icon: "Anchor",         color: "#FF6B35", description: "Vessel loitering within cable proximity" },
  LOITERING_PORT:     { label: "Port Loiterer",           icon: "Ship",           color: "#FF6B35", description: "Vessel loitering outside a port boundary" },
  LOITERING_INFRA:    { label: "Infra Loiterer",          icon: "AlertTriangle",  color: "#FF9500", description: "Vessel loitering near critical infrastructure" },
  DARK_SHIP:          { label: "Dark Ship",               icon: "EyeOff",         color: "#8E8E93", description: "Vessel AIS signal lost while underway" },
  DARK_SHIP_CABLE:    { label: "Dark Ship near Cable",    icon: "ZapOff",         color: "#FF2D55", description: "Dark ship last seen near submarine cable" },
  CHOKEPOINT_TRANSIT: { label: "Chokepoint Transit",      icon: "Navigation",     color: "#34AADC", description: "Vessel transiting a strategic chokepoint" },
  CHOKEPOINT_LOITER:  { label: "Chokepoint Loiterer",     icon: "MapPin",         color: "#FF6B35", description: "Vessel loitering at a strategic chokepoint" },
  ESCALATED_DUAL:     { label: "Dual Rule Escalation",    icon: "ShieldAlert",    color: "#FF2D55", description: "Two simultaneous anomaly rules fired on same vessel" },
  ESCALATED_TRIPLE:   { label: "Triple Rule Escalation",  icon: "Siren",          color: "#9B0000", description: "Three or more anomaly rules fired on same vessel" },
  BORDER_CROSSING:    { label: "Border Crossing",         icon: "Flag",           color: "#5AC8FA", description: "Vessel crossing a maritime border zone" },
  SANCTIONED_VESSEL:  { label: "Sanctioned Vessel",       icon: "Ban",            color: "#FF3B30", description: "Vessel on sanctions or watch list" },
  FORMATION_SAILING:  { label: "Formation Sailing",       icon: "Users",          color: "#FFCC00", description: "Multiple vessels moving in coordinated formation" },
  REVERSE_COURSE:     { label: "Reverse Course",          icon: "RefreshCw",      color: "#FF9500", description: "Vessel reversed heading unexpectedly" },
  PORT_SKIP:          { label: "Port Skip",               icon: "SkipForward",    color: "#5856D6", description: "Vessel bypassed declared destination port" },
  IDENTITY_CHANGE:    { label: "Identity Change",         icon: "UserX",          color: "#FF2D55", description: "Vessel MMSI or name changed while at sea" },
  CONVOY:             { label: "Convoy Movement",         icon: "Truck",          color: "#34AADC", description: "Multiple vessels moving in convoy pattern" },
  UNKNOWN_CONTACT:    { label: "Unknown Contact",         icon: "HelpCircle",     color: "#8E8E93", description: "Unidentified vessel contact requiring investigation" },
  FUSION_EVENT:       { label: "Intelligence Fusion Event", icon: "Layers",       color: "#BF5AF2", description: "Multi-domain correlated intelligence event" },
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
  BORDER_CROSSING:    "A vessel has crossed a monitored maritime boundary. Tracked in areas of active territorial dispute, sanctions enforcement zones, or restricted waters.",
  SANCTIONED_VESSEL:  "This vessel appears on a sanctions list, watch list, or is associated with a sanctioned entity. Any transit or activity by sanctioned vessels may indicate sanctions evasion or illicit trade.",
  FORMATION_SAILING:  "Multiple vessels are moving in a coordinated formation. Formation sailing in strategic areas may indicate a naval exercise, convoy protection, or a coordinated undeclared operation.",
  REVERSE_COURSE:     "A vessel made an unexpected course reversal while underway. Sudden reversals can indicate surveillance detection, threat avoidance, or an undisclosed last-minute operational change.",
  PORT_SKIP:          "A vessel bypassed its declared destination port. Port skipping is a known indicator of illicit cargo transfer, sanctions evasion, or undeclared operational changes mid-voyage.",
  IDENTITY_CHANGE:    "This vessel's MMSI number or registered name was changed while at sea — a practice associated with sanctions evasion, flag-of-convenience abuse, and illicit maritime operations.",
  CONVOY:             "Multiple vessels are moving together in a convoy pattern. Convoys in sensitive areas may indicate military logistics, VIP escort, or coordinated supply operations requiring monitoring.",
  UNKNOWN_CONTACT:    "An unidentified vessel has been detected in a monitored area with insufficient data to classify. Unknown contacts in sensitive or restricted zones require investigation.",
  FUSION_EVENT:       "Multiple independent intelligence signals from different domains — AIS, news, satellite imagery, or ADSB — have been correlated into a single event by the Forge fusion engine. Fusion events represent higher-confidence threat indicators than any single-source alert.",
}

export const NEWS_PATTERN_ICON_KEYS = new Set([
  "RISING_TENSIONS", "PORT_DISRUPTION", "INFRASTRUCTURE_THREAT", "ESCALATION_SPIKE",
  "SANCTIONS_PRESSURE", "MILITARY_MOBILISATION", "HUMANITARIAN_CRISIS",
  "CEASEFIRE_BREAKDOWN", "ENERGY_SUPPLY_RISK",
])

export const DEFAULT_ICON_FOR_TRIGGER = {
  stationary_near_infrastructure: "LOITERING_INFRA",
  AIS_LOITERING_NEAR_CABLE:       "LOITERING_CABLE",
  AIS_LOITERING_NEAR_INFRA:       "LOITERING_INFRA",
  AIS_DARK_SHIP:                  "DARK_SHIP",
  chokepoint_loitering:           "CHOKEPOINT_LOITER",
  transponder_gap:                "DARK_SHIP",
  ESCALATED_DUAL:                 "ESCALATED_DUAL",
  ESCALATED_TRIPLE:               "ESCALATED_TRIPLE",
}
