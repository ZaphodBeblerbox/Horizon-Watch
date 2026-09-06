// Profile constants and helpers — kept separate from component file
// so React Fast Refresh can hot-reload MissionProfilePanel cleanly.

export const PROFILE_KEY = "akili-profile-v1"

export const FOCUS_REGIONS = [
    // Africa
    "East Africa",
    "Horn of Africa",
    "Great Lakes Region",
    "Sahel",
    "West Africa",
    "North Africa",
    "Central Africa",
    "Southern Africa",
    // Middle East
    "Red Sea / Arabian Peninsula",
    "Gulf States",
    "Middle East",
    "Levant",
    "Iran",
    "Iraq",
    "Yemen",
    // Asia
    "Indian Ocean",
    "Mediterranean",
    "South Asia",
    "Southeast Asia",
    "Central Asia",
    "East Asia",
    // Europe
    "Europe",
    "Eastern Europe",
    "Ukraine",
    "Balkans",
    "Russia",
    // Americas
    "North America",
    "Central America",
    "South America",
    // Oceania
    "Australia",
    // Global
    "Global",
]

export const INFRA_DOMAINS = [
    "Aviation",
    "Telecommunications",
    "Maritime / Ports",
    "Energy",
    "Border / Land",
    "Financial",
]

export const CHOKEPOINTS = [
    "Strait of Hormuz",
    "Suez Canal",
    "Red Sea",
    "Bab el-Mandeb",
    "Malacca Strait",
    "Cape of Good Hope",
    "Panama Canal",
    "Strait of Gibraltar",
    "Bosporus / Turkish Straits",
    "Mozambique Channel",
]

export const ROLES = ["Analyst", "Operator", "Advisor", "Researcher"]

// `accessRole` (V3 Phase 1, §7.3) is deliberately a separate field from
// `role` above — `role` is a mission-focus label (used for relevance
// framing), `accessRole` is the real capability/access model (see
// src/lib/capabilities.js — literal "analyst" here, not imported, to avoid
// a circular import: capabilities.js already imports loadProfile from this
// file; keep the two DEFAULT_ACCESS_ROLE literals in sync if either changes).
export function emptyProfile() {
    return {
        displayName:        "",
        role:               "Analyst",
        accessRole:         "analyst",
        focusRegions:       [],
        infraDomains:       [],
        chokepoints:        [],
        threshold:          1,
        activeSituations:   "",
        // Workstation round (§7.4/§7.7) — real, disclosed identity link:
        // which real backend User row (GET /api/users) this browser's
        // shared profile is currently acting as. Needed for RFI-recipient
        // gating, assignment "assign to me", roster presence — anything
        // that has to compare against a real users.id, not just a display
        // name string. Null until the analyst picks one in Settings; there
        // is still no live per-request auth behind this, same disclosed
        // limitation as accessRole above.
        userId:             null,
    }
}

export function loadProfile() {
    try {
        const raw = localStorage.getItem(PROFILE_KEY)
        if (raw) return JSON.parse(raw)
    } catch { /* ignore */ }
    return null
}

export function saveProfileToStorage(profile) {
    try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
    } catch { /* ignore */ }
}
