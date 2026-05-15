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
  STS_TRANSFER:       { label: "Ship-to-Ship",            icon: "ArrowLeftRight", color: "#FF3B30", description: "Possible ship-to-ship transfer outside port" },
  STS_TRANSFER_DARK:  { label: "STS + Dark Ship",         icon: "Skull",          color: "#9B0000", description: "STS transfer involving a dark (AIS-off) vessel" },
  DARK_SHIP:          { label: "Dark Ship",               icon: "EyeOff",         color: "#8E8E93", description: "Vessel AIS signal lost while underway" },
  DARK_SHIP_CABLE:    { label: "Dark Ship near Cable",    icon: "ZapOff",         color: "#FF2D55", description: "Dark ship last seen near submarine cable" },
  SPEED_ANOMALY:      { label: "Speed Anomaly",           icon: "Gauge",          color: "#FFCC00", description: "Vessel exceeding expected speed threshold" },
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
  AIS_STS_PROXIMITY:              "STS_TRANSFER",
  AIS_DARK_SHIP:                  "DARK_SHIP",
  speed_anomaly:                  "SPEED_ANOMALY",
  ship_to_ship:                   "STS_TRANSFER",
  chokepoint_loitering:           "CHOKEPOINT_LOITER",
  transponder_gap:                "DARK_SHIP",
  ESCALATED_DUAL:                 "ESCALATED_DUAL",
  ESCALATED_TRIPLE:               "ESCALATED_TRIPLE",
}
