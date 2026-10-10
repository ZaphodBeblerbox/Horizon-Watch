/**
 * liveShare.js — where I am, and sharing it live.
 *
 * MY POSITION is the blue dot on the map: the device's live position while
 * sharing, else the location given once (settings.interests.here,
 * components/LocationPrompt.jsx).
 *
 * SHARING IT LIVE (owner, 2026-10-10: human assets followed and assessed
 * all the time) is a per-device switch the user turns on themselves, with
 * what it does written beside it. While it is on and Parallax is open, the
 * position goes to the server whenever the device has moved 100 m, and at
 * least once a minute; every person asset linked to the user moves there,
 * and what is near them is reassessed (backend owned_assets.live_position).
 * A web page cannot do this in the background or with the phone locked —
 * browsers stop location when the page is hidden; a native app is needed
 * for that. Turning the switch off stops it at once.
 */
import API_BASE, { isDesktop } from "../apiBase.js"
import { getSettings, subscribeSettings } from "../state/settingsStore.js"

const KEY = "plx.liveShare"
const MIN_MOVE_M = 100
const MAX_GAP_MS = 60_000

let live = null                 // {lat, lon, accuracy, at}
let watchId = null
let lastSent = null             // {lat, lon, at}
let lastError = null
const subs = new Set()
const emit = () => { for (const f of subs) { try { f(myPosition()) } catch { /* a listener */ } } }

export function subscribeMyPosition(fn) {
    subs.add(fn)
    const off = subscribeSettings(() => emit())
    return () => { subs.delete(fn); off?.() }
}

/** {lat, lon, live, accuracy?, label?} or null. */
export function myPosition() {
    if (live && Date.now() - live.at < 10 * 60_000) return { lat: live.lat, lon: live.lon, accuracy: live.accuracy, live: true }
    const h = getSettings()?.interests?.here
    if (h && Number.isFinite(+h.lat) && Number.isFinite(+h.lon)) return { lat: +h.lat, lon: +h.lon, live: false, label: h.label || null }
    return null
}

export function sharingOn() {
    try { return localStorage.getItem(KEY) === "on" } catch { return false }
}
export function shareStatus() {
    return { on: sharingOn(), running: watchId != null, lastSentAt: lastSent?.at || null, error: lastError }
}

function metres(a, b) {
    const r = Math.PI / 180
    const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2
    return 12742000 * Math.asin(Math.sqrt(h))
}

/** Whether this fix should go to the server now. Pure. */
export function shouldSend(prev, next, now = Date.now()) {
    if (!prev) return true
    return metres(prev, next) >= MIN_MOVE_M || now - prev.at >= MAX_GAP_MS
}

async function send(p) {
    lastSent = { lat: p.lat, lon: p.lon, at: Date.now() }
    try {
        const r = await fetch(`${API_BASE}/api/my-assets/live`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: p.lat, lon: p.lon, accuracy: p.accuracy }),
        })
        lastError = r.ok ? null : `the server said ${r.status}`
    } catch { lastError = "not sent: no connection" }
    emit()
}

function onFix(pos) {
    live = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() }
    lastError = null
    if (shouldSend(lastSent, live)) send(live)
    emit()
}

function startWatch() {
    // THE DESKTOP APP has no GPS route (its web view answers no location
    // request): it shares where its connection is, every ten minutes.
    if (isDesktop()) {
        if (watchId != null) return
        const tick = () => import("../components/LocationPrompt.jsx").then((m) => m.connectionPosition())
            .then((p) => onFix({ coords: { latitude: p.lat, longitude: p.lon, accuracy: 5000 } }))
            .catch((e) => { lastError = e.message; emit() })
        tick()
        watchId = setInterval(tick, 10 * 60_000)
        startWatch.desktop = true
        emit()
        return
    }
    if (watchId != null || typeof navigator === "undefined" || !navigator.geolocation) return
    watchId = navigator.geolocation.watchPosition(onFix, (e) => {
        lastError = e.code === 1 ? "location not allowed on this device" : "location unavailable"
        emit()
    }, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 })
    // a fix at least once a minute even standing still, so the team knows it is current
    startWatch.iv = setInterval(() => { if (live && Date.now() - (lastSent?.at || 0) >= MAX_GAP_MS) send(live) }, MAX_GAP_MS)
    emit()
}

function stopWatch() {
    if (watchId != null && startWatch.desktop) clearInterval(watchId)
    else if (watchId != null) navigator.geolocation.clearWatch(watchId)
    startWatch.desktop = false
    watchId = null
    clearInterval(startWatch.iv)
    live = null
    emit()
}

/** Turn live sharing on (the user's own choice) and start it. */
export function startSharing() {
    try { localStorage.setItem(KEY, "on") } catch { /* private mode: this session only */ }
    startWatch()
}

export function stopSharing() {
    try { localStorage.removeItem(KEY) } catch { /* nothing stored */ }
    stopWatch()
}

/** On launch: resume if this device was sharing. */
export function resumeSharing() {
    if (sharingOn()) startWatch()
}
