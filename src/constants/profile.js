// Profile constants and helpers — kept separate from component file
// so React Fast Refresh can hot-reload MissionProfilePanel cleanly.

export const PROFILE_KEY = "akili-profile-v1"

export const FOCUS_REGIONS = [
    "East Africa",
    "Horn of Africa",
    "Great Lakes Region",
    "Sahel",
    "West Africa",
    "North Africa",
    "Central Africa",
    "Southern Africa",
    "Red Sea / Arabian Peninsula",
    "Gulf States",
    "Middle East",
    "Indian Ocean",
    "Mediterranean",
    "South Asia",
    "Southeast Asia",
    "Central Asia",
    "Europe",
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

export function emptyProfile() {
    return {
        displayName:        "",
        role:               "Analyst",
        focusRegions:       [],
        infraDomains:       [],
        chokepoints:        [],
        threshold:          1,
        activeSituations:   "",
        poiProximityAlerts: true,
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
