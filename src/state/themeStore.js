// themeStore.js — real per-user, server-persisted theme mode
// ("light" | "dark" | "auto" — database.py's User.theme, read via GET
// /api/auth/me, written via PUT /api/users/me/theme). The only
// localStorage use in this module is two synchronous paint-time MIRRORS
// (the rendered light/dark theme, and the chosen mode) that index.html's
// inline bootstrap script reads before the app renders to avoid a flash —
// neither is ever the source of truth. reconcileTheme() is what keeps
// them honest against the real server value once the real session
// resolves.
//
// Three real, distinct pieces of state, kept separate on purpose:
//   - themeMode:      the real persisted USER CHOICE — "light" | "dark" | "auto"
//   - renderedTheme:  which of "light"/"dark" is CURRENTLY on screen — always
//                      one of the two, even in Auto mode (crosses at the real
//                      solar-elevation horizon, elevation = 0°)
//   - blend/elevationDeg: the real, continuous Auto-mode fade state (see
//                      Part 2 of the Auto-theme prompt) — 0/1 and null in
//                      manual Light/Dark mode; a real, live value in Auto
import API_BASE from "../apiBase.js"
import { getUserLocation } from "../globe/useUserLocation.js"
import { solarElevationDeg, civilTwilightBlend } from "../utils/solarPosition.js"
import { blendColor, isParseableColor } from "../utils/colorBlend.js"

const RENDERED_CACHE_KEY = "hw-theme-cache"
const MODE_CACHE_KEY = "hw-theme-mode-cache"
const RECOMPUTE_MS = 60_000 // the sun doesn't move fast enough to need finer polling

const modeListeners = new Set()
const renderedListeners = new Set()
const blendListeners = new Set()
const locationListeners = new Set()

function readRenderedFromDOM() {
    // Guarded because this runs at MODULE LOAD, and anything that imports a
    // component which imports this store is then unusable outside a browser —
    // which is every unit test in this project, since vitest runs in "node"
    // here. Dark is the app's default theme, so it is the honest fallback.
    if (typeof document === "undefined") return "dark"
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"
}

let renderedTheme = readRenderedFromDOM()
let themeMode = (() => {
    try {
        const m = localStorage.getItem(MODE_CACHE_KEY)
        if (m === "light" || m === "dark" || m === "auto") return m
    } catch { /* private mode / storage blocked */ }
    // No mode mirror yet — a new device, a cleared browser, or a device
    // predating Auto mode. Auto is the default: it tracks the sun, so it is
    // right at every hour rather than right half the time. Previously this
    // returned whatever happened to be painted, which on a first visit is
    // always "dark" — i.e. the default was dark by accident of the paint
    // bootstrap rather than by decision. reconcileTheme() still corrects
    // this against the real per-user server value once the session resolves.
    return "auto"
})()
let blend = renderedTheme === "light" ? 1 : 0
let elevationDeg = null
let locationState = "unknown" // "unknown" | "resolving" | "ok" | "unavailable"

let fadeTimer = null
let cachedLocation = null
let cachedTokenPairs = null

// ── Real token-pair discovery — reads the ACTUAL light/dark values
// straight from index.html's own :root / :root[data-theme="light"] CSS
// rules via getComputedStyle, rather than hand-duplicating a second copy
// of the palette into JS that could silently drift out of sync. Adding a
// new themed color token only ever needs a matching @property line in
// index.html (see its own comment) — never a second value anywhere. ─────
function getRealTokenPairs() {
    if (cachedTokenPairs) return cachedTokenPairs
    const names = new Set()
    for (const sheet of document.styleSheets) {
        let rules
        try { rules = sheet.cssRules } catch { continue } // cross-origin stylesheet — inaccessible, not ours anyway
        for (const rule of rules) {
            if (rule.selectorText && rule.selectorText.indexOf('data-theme="light"') !== -1 && rule.style) {
                for (let i = 0; i < rule.style.length; i++) {
                    const prop = rule.style[i]
                    if (prop.startsWith("--")) names.add(prop)
                }
            }
        }
    }
    const nameList = [...names]
    const root = document.documentElement
    const originalAttr = root.getAttribute("data-theme")

    // Real bug found live during Auto-mode testing: with the .theme-fading
    // class already applied (it is, by the time this can first run — see
    // startAutoEngine()), these @property-registered tokens have a real
    // CSS transition running. Toggling data-theme then reading
    // getComputedStyle synchronously doesn't return the new value's real
    // target — a transitioning property reports wherever it currently IS
    // in its animation, which right after the attribute flip is still
    // essentially the OLD value. Confirmed directly: without this guard,
    // the "light" read came back identical to the "dark" one. Temporarily
    // dropping the class removes the transition declaration for the
    // duration of this probe, so both reads resolve to their real, final,
    // untransitioned values.
    const wasFading = root.classList.contains("theme-fading")
    if (wasFading) root.classList.remove("theme-fading")

    // Real, synchronous toggle-read-revert — never yields to the event
    // loop between the attribute change and the revert, so the browser
    // never actually paints the intermediate state (a style recalc is
    // forced by getComputedStyle, but painting only happens after this
    // whole synchronous block finishes) — no visible flash.
    root.removeAttribute("data-theme")
    const darkStyle = getComputedStyle(root)
    const dark = {}
    for (const n of nameList) dark[n] = darkStyle.getPropertyValue(n).trim()

    root.setAttribute("data-theme", "light")
    const lightStyle = getComputedStyle(root)
    const light = {}
    for (const n of nameList) light[n] = lightStyle.getPropertyValue(n).trim()

    if (originalAttr === null) root.removeAttribute("data-theme")
    else root.setAttribute("data-theme", originalAttr)
    if (wasFading) root.classList.add("theme-fading")

    const pairs = {}
    for (const n of nameList) {
        // Only real, plain colors are blendable (see colorBlend.js) — a
        // token like --shadow (a multi-value box-shadow shorthand) is
        // honestly skipped here rather than blended into garbage; it just
        // keeps whatever the plain CSS rule already gives it.
        if (isParseableColor(dark[n]) && isParseableColor(light[n])) pairs[n] = { dark: dark[n], light: light[n] }
    }
    cachedTokenPairs = pairs
    return pairs
}

function clearBlendOverrides() {
    const pairs = getRealTokenPairs()
    const style = document.documentElement.style
    for (const name of Object.keys(pairs)) style.removeProperty(name)
}

/**
 * The veil element (PARALLAX spec §4.1). A full-bleed sheet in the INCOMING
 * background colour, faded in over 150ms; the palette is swapped behind it;
 * the sheet fades out. At every frame the user is looking at either a fully
 * legible theme or an opaque sheet — never at low-contrast text.
 */
function getVeil() {
    let el = document.getElementById("sky-veil")
    if (!el) {
        el = document.createElement("div")
        el.id = "sky-veil"
        document.body.appendChild(el)
    }
    return el
}

/**
 * Set the palette outright. Inline custom properties are cleared FIRST: the
 * previous interpolating implementation wrote every token inline on <html>,
 * and an inline custom property outranks the stylesheet forever if it is
 * left behind — so without this, none of :root / [data-theme] applies.
 */
function applyTheme(name) {
    const st = document.documentElement.style
    for (let i = st.length - 1; i >= 0; i--) {
        if (st[i].startsWith("--")) st.removeProperty(st[i])
    }
    if (name === "light") document.documentElement.setAttribute("data-theme", "light")
    else document.documentElement.removeAttribute("data-theme")
    st.colorScheme = name

    if (renderedTheme !== name) {
        renderedTheme = name
        try { localStorage.setItem(RENDERED_CACHE_KEY, name) } catch { /* private mode */ }
        renderedListeners.forEach((fn) => fn(name))
    }
}

/**
 * Swap the palette behind a veil.
 *
 * WHY THERE IS NO CROSS-FADE. Dark is light text on a dark ground; light is
 * dark text on a light ground. Halfway between them is mid-grey on mid-grey:
 * foreground and background travel TOWARDS each other, so contrast collapses
 * to roughly 1:1 at the midpoint — in sRGB, in linear light, in OKLab, in
 * every colour space. Inversion cannot be cross-faded, and the fix is not a
 * better blend, it is to stop blending. This replaces a 75-second linear
 * transition across ~85 colour tokens, which spent over a minute of every
 * automatic turn in exactly that unreadable zone.
 *
 * What stays continuous is the SUN: `blend` below still tracks elevation
 * smoothly, so the horizon control reads as gradual even though the palette
 * is binary. Continuous indicator, discrete palette — that split is the
 * whole design.
 */
function veilTo(name) {
    if (typeof document === "undefined") return
    if (document.documentElement.dataset.theme === name ||
        (name === "dark" && !document.documentElement.hasAttribute("data-theme"))) {
        applyTheme(name)
        return
    }
    const veil = getVeil()
    // Probe the destination palette so the sheet is already the arriving
    // colour — otherwise the veil itself flashes the outgoing background.
    const probe = document.createElement("div")
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none"
    if (name === "light") probe.setAttribute("data-theme", "light")
    document.body.appendChild(probe)
    veil.style.background = getComputedStyle(probe).getPropertyValue("--bg-0") || "#171b20"
    probe.remove()

    veil.classList.add("on")
    setTimeout(() => {
        applyTheme(name)
        requestAnimationFrame(() => veil.classList.remove("on"))
    }, 150)
}

/**
 * Auto mode tick. `t` is the SUN POSITION only — it drives the horizon
 * control, never the palette. The palette turns at elevation 0°.
 */
function applyBlend(t) {
    blend = t
    veilTo(elevationDeg != null ? (elevationDeg >= 0 ? "light" : "dark") : (t >= 0.5 ? "light" : "dark"))
    blendListeners.forEach((fn) => fn({ blend: t, elevationDeg }))
}

async function resolveLocation() {
    if (cachedLocation) return cachedLocation
    const loc = await getUserLocation()
    if (loc) cachedLocation = loc
    return loc
}

function recomputeAndApply(loc) {
    const el = solarElevationDeg(loc.lat, loc.lon, new Date())
    elevationDeg = el
    applyBlend(civilTwilightBlend(el))
}

function stopAutoEngine() {
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null }
}

async function startAutoEngine() {
    document.documentElement.classList.add("theme-fading")
    locationState = "resolving"
    locationListeners.forEach((fn) => fn(locationState))

    const loc = await resolveLocation()
    if (themeMode !== "auto") return // mode changed again while this was in flight

    if (!loc) {
        locationState = "unavailable"
        locationListeners.forEach((fn) => fn(locationState))
        // Real, honest fallback (Part 2.1): no location, no fade — Auto
        // simply stays on whatever theme was last rendered, exactly the
        // manual behaviour, until a location becomes available.
        document.documentElement.classList.remove("theme-fading")
        return
    }
    locationState = "ok"
    locationListeners.forEach((fn) => fn(locationState))

    recomputeAndApply(loc)
    // Real timer, not a requestAnimationFrame-driven loop — this is what
    // keeps recomputing correctly in a throttled/backgrounded tab (rAF
    // callbacks can stop firing entirely there; setInterval keeps firing,
    // per this project's own established Replay-playback pattern). The
    // actual VISUAL smoothing between each tick's discrete value is left
    // to the real, native CSS `transition` on the @property-registered
    // tokens (index.html) — the same declarative animation mechanism this
    // app already uses elsewhere, not a second bespoke rAF blend loop.
    fadeTimer = setInterval(() => recomputeAndApply(loc), RECOMPUTE_MS)
}

function applyManual(theme) {
    stopAutoEngine()
    // Both of these happen synchronously, in this order, so any
    // in-progress Auto fade is cancelled cleanly at whatever value was
    // last rendered — no leftover transition keeps animating afterward:
    // removing the class drops the `transition` declaration first, THEN
    // the inline overrides are cleared, so the jump to the plain
    // :root/[data-theme] value is instant.
    clearBlendOverrides()

    // Manual selection goes through the same veil as an automatic turn.
    // There is one mechanism for changing the palette, not two — a second,
    // unveiled path is how an interpolated or half-applied palette creeps
    // back in. veilTo() also clears any inline custom properties left by the
    // previous interpolating implementation, which would otherwise outrank
    // the stylesheet permanently.
    veilTo(theme)

    elevationDeg = null
    blend = theme === "light" ? 1 : 0
    locationState = "unknown"
    locationListeners.forEach((fn) => fn(locationState))

    if (renderedTheme !== theme) {
        renderedTheme = theme
        renderedListeners.forEach((fn) => fn(theme))
    }
    try { localStorage.setItem(RENDERED_CACHE_KEY, theme) } catch { /* private mode */ }
    blendListeners.forEach((fn) => fn({ blend, elevationDeg }))
}

// ── Public API ───────────────────────────────────────────────────────────

export function getThemeMode() { return themeMode }
export function subscribeThemeMode(fn) { modeListeners.add(fn); return () => modeListeners.delete(fn) }

/** Which of "light"/"dark" is CURRENTLY rendered — always defined, even
 * mid-fade in Auto mode (crosses exactly at the real solar horizon). */
export function getRenderedTheme() { return renderedTheme }
export function subscribeRenderedTheme(fn) { renderedListeners.add(fn); return () => renderedListeners.delete(fn) }

/** Real, live Auto-mode state: 0 (full night) .. 1 (full day), and the raw
 * solar elevation in degrees (null outside Auto mode). The SAME values
 * driving both the token color fade and the sun/moon horizon indicator —
 * never two independently-computed approximations. */
export function getBlend() { return blend }
export function getElevationDeg() { return elevationDeg }
export function subscribeBlend(fn) { blendListeners.add(fn); return () => blendListeners.delete(fn) }

export function getLocationState() { return locationState }
export function subscribeLocationState(fn) { locationListeners.add(fn); return () => locationListeners.delete(fn) }

// Real race guard: app.jsx's own periodic session re-check (every 6h, plus
// once on mount) calls reconcileTheme() with whatever `theme` GET /api/auth/
// me happens to return — including, for the brief real window a PUT below
// is still in flight, the OLD pre-change value. Without this flag, a
// reconcile landing in that window would stomp the just-chosen mode with
// stale server data (confirmed live during Auto-mode testing: a fast,
// deliberate reconcile call racing an in-flight PUT reverted Auto back to
// Dark). Sets around the whole real round trip, not just the awaited
// fetch, since the risk window is "local truth is ahead of the server,"
// which starts the instant the user acts, not when the network call begins.
let hasPendingLocalWrite = false

/** Real mode switch — applies instantly (local) then persists to the real
 * per-user DB row. A failed PUT (network hiccup, no session) leaves the
 * local change standing rather than reverting it; corrected by
 * reconcileTheme() on the next real session check. */
export async function setThemeMode(mode) {
    if (mode !== "light" && mode !== "dark" && mode !== "auto") return
    hasPendingLocalWrite = true
    themeMode = mode
    try { localStorage.setItem(MODE_CACHE_KEY, mode) } catch { /* private mode */ }
    modeListeners.forEach((fn) => fn(mode))

    if (mode === "auto") startAutoEngine()
    else applyManual(mode)

    try {
        await fetch(`${API_BASE}/api/users/me/theme`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ theme: mode }),
        })
    } catch { /* real network hiccup — local mode already applied */
    } finally {
        hasPendingLocalWrite = false
    }
}

/** Called once app.jsx's real checkSession() resolves — reconciles the
 * paint-time localStorage mirrors against the real per-user server value.
 * Only fires a visible change on a new device/browser (no mirror yet) or
 * right after the mode was changed elsewhere; on a normal repeat visit
 * the mirror already matches and this is a no-op. */
export function reconcileTheme(user) {
    if (hasPendingLocalWrite) return // a fresher local change is still round-tripping — never stomp it with this stale read
    // AUTO IS THE DEFAULT, and absence of a stored theme is not a preference.
    //
    // This previously read `=== "light" ? "light" : "dark"`, so any user whose
    // theme column was NULL — 7 of the 9 accounts in this database — was
    // resolved to a HELD dark mode the moment their profile loaded, silently
    // switching the sky clock off for them. §4.2 names this exact failure:
    // "A legacy binary theme value is not a decision to stop following
    // daylight. Reading one as a held mode silently disables the whole
    // feature."
    //
    // Only an explicit light or dark is a decision. Everything else follows
    // the sun.
    const t = user?.theme
    const real = t === "light" ? "light" : t === "dark" ? "dark" : "auto"
    if (real === themeMode) return
    themeMode = real
    try { localStorage.setItem(MODE_CACHE_KEY, real) } catch { /* private mode */ }
    modeListeners.forEach((fn) => fn(real))
    if (real === "auto") startAutoEngine()
    else applyManual(real)
}
