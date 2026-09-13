// settingsStore.js — real Settings round. The one real per-user,
// server-persisted, apply-on-change settings store (General/Map & layers/
// Alerts/Briefing — everything except theme, which keeps its own
// pre-existing dedicated column/endpoint, see themeStore.js; Settings'
// General section reads/writes that SAME value, never a second one).
//
// Same architecture as themeStore.js: the real source of truth is the
// authenticated user's own DB row (database.py's User.settings JSON
// column, read via GET /api/auth/me, written via PATCH
// /api/users/me/settings). "density" additionally gets a synchronous
// localStorage paint-time MIRROR ("hw-density-cache") for the same
// no-flash reason theme does (see index.html's inline bootstrap script) —
// every other setting has no first-paint visual effect, so no mirror is
// needed for it.
//
// Every control calls updateSetting(path, value) with just the one leaf
// that changed — applied to local state instantly, then PATCHed to the
// server, which deep-merges it into the real stored JSON blob. There is no
// "unsaved changes"/Save button anywhere in this app's Settings surface by
// design (per the real prompt this was built from): a setting is either
// applied or it hasn't been touched, never "pending".
import API_BASE from "../apiBase.js"

const DENSITY_CACHE_KEY = "hw-density-cache"

// The exact real flat keys/values the old (never-mounted) PreferencesPanel.
// jsx used, carried over unchanged so app.jsx's already-live consumers
// (real alert sound cues, real alert-poll interval) keep working with zero
// behavior change — only the persistence mechanism underneath them moves
// from localStorage+the non-per-user global /api/settings dict to this
// real per-user store. New (Settings-round) fields are namespaced
// (general.*, mapLayers.*, alerts.*, briefing.*) to keep them visually
// distinct from this legacy flat set; nothing forces every future setting
// into one shape.
export const DEFAULTS = {
    soundMuted:          false,
    briefingHourUTC:     6,
    refreshInterval:     15,
    alertInterval:       15,
    cacheMaxDays:        7,
    mapStyle:            "satellite",
    toastDuration:       4,
    soundCritical:       true,
    soundSignificant:    true,
    soundElevated:       false,
    toastsEnabled:       true,
    toastsCriticalOnly:  false,
    // GeoConfirmed historic-timeline round (Part 3.4) — the analyst's real
    // theatre-filter selection for the timeline panel, persisted the same
    // way every other per-user filter/view setting in this store is. []
    // means "all theatres" (never resets to some other implied default).
    mapLayers: { geoConfirmedTheatres: [] },
}

let _settings = { ...DEFAULTS }
const listeners = new Set()

function _publish() {
    for (const fn of listeners) fn(_settings)
}

export function getSettings() {
    return _settings
}

export function subscribeSettings(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v)
}

function deepMerge(base, patch) {
    const out = { ...base }
    for (const k of Object.keys(patch)) {
        out[k] = isPlainObject(patch[k]) && isPlainObject(base[k]) ? deepMerge(base[k], patch[k]) : patch[k]
    }
    return out
}

function pathToPatch(path, value) {
    const keys = path.split(".")
    let patch = value
    for (let i = keys.length - 1; i >= 0; i--) patch = { [keys[i]]: patch }
    return patch
}

function getAtPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function applyDensity(density) {
    if (density === "compact") document.documentElement.setAttribute("data-density", "compact")
    else document.documentElement.removeAttribute("data-density")
    try { localStorage.setItem(DENSITY_CACHE_KEY, density === "compact" ? "compact" : "comfortable") } catch { /* private mode / storage blocked */ }
}

/** Called once app.jsx's real checkSession() resolves — the real source of
 * truth for every real setting, same pattern as themeStore.reconcileTheme.
 * No paint-time mirror exists for most settings (only density has one),
 * so this is where their real values first become visible/effective. */
export function reconcileSettings(user) {
    _settings = deepMerge(DEFAULTS, user?.settings || {})
    applyDensity(getAtPath(_settings, "general.density"))
    _publish()
}

/** Real apply-on-change write: updates local state + any first-paint-
 * relevant side effect (density) immediately, then PATCHes the real
 * per-user value server-side. A failed PATCH (network hiccup, no
 * session) leaves the local change standing — corrected by
 * reconcileSettings() on the next real session check, same failure
 * handling themeStore.setTheme() already uses. */
export async function updateSetting(path, value) {
    const patch = pathToPatch(path, value)
    _settings = deepMerge(_settings, patch)
    if (path === "general.density") applyDensity(value)
    _publish()
    try {
        const r = await fetch(`${API_BASE}/api/users/me/settings`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(patch),
        })
        if (r.ok) {
            _settings = await r.json()
            _publish()
        }
    } catch { /* real network hiccup — local value already applied */ }
}
