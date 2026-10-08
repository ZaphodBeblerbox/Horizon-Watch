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

    // Graphic footage (dead or injured people) opens behind a warning.
    media: { warnGraphic: true },

    // Which chrome is collapsed. Persisted per user for the same reason
    // every other view preference here is: an analyst who works with the
    // left pane shut should not have to shut it again every morning.
    chrome: {
        // Both side panes start collapsed, which is what Situation.jsx
        // already did before this was persisted — the map is the view, and
        // the panes overlay it. Changing this default would silently
        // narrow every existing user's map on their next launch.
        leftPanel:  false,
        rightPanel: false,
        bottomBar:  true,
        /* The event-density strip across the bottom of the map. OFF by
           default and driven by the rail's Timeline button — it used to
           render unconditionally while the button toggled a `plxDrawer`
           flag nothing read, so the strip was always there and the control
           for it did nothing. It covers the bottom ~100px of the map, so
           "always on" is not a neutral default. */
        timeline:   false,
        // Workstation panes. Open by default — unlike the Situation panes,
        // these are the surface itself rather than an overlay on a map.
        caseTree:     true,
        editorSource: true,
        editorSaved:  true,
    },

    // The app's launch state, saved by the user from whatever they
    // currently have on ("save current view as my default"). null means
    // "never saved one" — the built-in per-view defaults apply, which is
    // different from "saved an empty set", where every layer really is off.
    startupLayers: null,

    // Things kept off the map to write about later — see
    // savedForBriefing.js. Small records only (a URL and coordinates),
    // never image bytes: a few hundred KB of base64 per crop would be
    // written back to this row on every save.
    savedForBriefing: [],

    // Do not disturb — suppresses notification CARDS. The tray still
    // records everything and the bell still counts.
    dnd: false,

    // The guided walkthrough. On until it is finished or skipped, which is
    // why it is a tri-state rather than a boolean: "never opened it" and
    // "turned it off" are different, and only the second should mean the
    // app stays quiet about its own features forever.
    //   null   — never run (show it)
    //   "done" — completed or skipped (do not show)
    tutorial: null,
    // The release whose welcome this user has seen ("1.1"). A user who has
    // not seen the current one gets the welcome and the walkthrough once,
    // at their first login to it — and never again, on any device.
    welcome: null,
}

/** The release the welcome card introduces. */
export const RELEASE = "1.1"

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
let _fromServer = false
/** True once this user's settings have come from the server: before that,
 * every value is a default, and nothing shown "once" may be decided on it. */
export function settingsFromServer() {
    return _fromServer
}

export function reconcileSettings(user) {
    _fromServer = !!user
    _email = user?.email ? String(user.email).toLowerCase() : null
    _settings = deepMerge(DEFAULTS, user?.settings || {})
    // A FIRST EVER LOGIN IS A CLEAN SHEET (the owner, 2026-10-07): no
    // theaters, no layers. An account that has never saved a setting has
    // never been used; it opens on a bare map, saved as its startup set so
    // the next session opens the same way until the user chooses otherwise.
    if (user && (!user.settings || Object.keys(user.settings).length === 0) && _settings.startupLayers == null) {
        _settings = { ..._settings, startupLayers: { clean: true } }
        Promise.resolve().then(() => updateSetting("startupLayers", { clean: true })).catch(() => {})
    }
    applyDensity(getAtPath(_settings, "general.density"))
    _publish()
    if (user) _flush(user)
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
            // MERGE OVER THE DEFAULTS, DO NOT REPLACE. The server returns
            // only what it has STORED — after a single PATCH it answered
            // with {"chrome": {...}} and nothing else. Assigning that
            // straight to _settings erased every other value from memory:
            // the defaults, and anything set earlier that the server had
            // no reason to echo back. The visible effect was a saved
            // setting appearing not to stick, and the saved-signals list
            // emptying itself whenever some unrelated preference changed.
            //
            // reconcileSettings() has always merged over DEFAULTS for the
            // same reason; this path simply did not.
            _settings = deepMerge(structuredClone(DEFAULTS), await r.json())
            _publish()
            return { ok: true }
        }
        // A REFUSED WRITE IS NOT A SAVE. The local value stays applied so
        // the UI does not jump, but the caller is TOLD, because a
        // preference that silently fails to persist is worse than one that
        // visibly did not take: the user believes it is set.
        //
        // Reported rather than thrown: most callers are fire-and-forget
        // toggles, and making them all handle a rejection would trade one
        // silent failure for a page full of unhandled ones.
        if (r.status >= 500) _queue(patch)                 // the server is down, not refusing
        return { ok: false, error: `HTTP ${r.status}` }
    } catch (e) {
        // NOBODY ANSWERED: kept on this machine and sent when the server is
        // back (the owner, 2026-10-08: a default layer set saved during an
        // outage was gone at the next start).
        _queue(patch)
        return { ok: false, queued: true, error: e?.message || "network error" }
    }
}

const PENDING_KEY = (email) => `plx-settings-pending:${String(email || "").toLowerCase()}`
let _email = null
function _queue(patch) {
    if (!_email) return
    try {
        const prev = JSON.parse(localStorage.getItem(PENDING_KEY(_email)) || "{}")
        localStorage.setItem(PENDING_KEY(_email), JSON.stringify(deepMerge(prev, patch)))
        // the local profile copy too, so a restart during the outage still has it
        const pk = `plx-profile:${_email}`
        const prof = JSON.parse(localStorage.getItem(pk) || "null")
        if (prof) localStorage.setItem(pk, JSON.stringify({ ...prof, settings: deepMerge(prof.settings || {}, patch) }))
    } catch { /* storage blocked: the change lives until the tab closes */ }
}

/** Send what was saved while the server was away, once it answers again. */
async function _flush(serverUser) {
    if (!_email) return
    let pending = null
    try { pending = JSON.parse(localStorage.getItem(PENDING_KEY(_email)) || "null") } catch { pending = null }
    if (!pending || !Object.keys(pending).length) return
    _settings = deepMerge(_settings, pending)
    _publish()
    try {
        const r = await fetch(`${API_BASE}/api/users/me/settings`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(pending),
        })
        if (r.ok) {
            localStorage.removeItem(PENDING_KEY(_email))
            _settings = deepMerge(structuredClone(DEFAULTS), await r.json())
            _publish()
        }
    } catch { /* still away: tried again at the next check */ }
    void serverUser
}
