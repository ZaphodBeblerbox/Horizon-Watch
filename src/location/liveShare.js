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
 * device is watched (watchPosition, high accuracy, fixes at most 2 s old)
 * and its position goes to the server IN REAL TIME (owner, 2026-10-12):
 *   · every fix that moved MIN_MOVE_M (10 m), or whose accuracy improved a
 *     lot — at most once every MIN_GAP_MS (3 s); a move inside those 3 s is
 *     sent when they are up, so the last position of a walk is never lost;
 *   · a heartbeat every HEARTBEAT_MS (30 s) standing still;
 *   · at once on coming back to the foreground.
 * One request at a time; a fix arriving meanwhile waits, and only the latest
 * waiting one goes (coalesced). The server keeps the latest position always
 * and a thinned history, moves every asset linked to the user, and pushes
 * the position to the team at once (backend position_stream.py).
 *
 * APPROXIMATE, WHEN PRECISE IS REFUSED. If the phone refuses its position
 * or cannot find one, the user may choose "Use approximate location": where
 * their connection is, city level (/api/geo/ip), sent marked "ip", shown
 * and said as approximate, refreshed every ten minutes. It never replaces a
 * GPS fix (here, and on the server), and precise location is asked for
 * again only from a tap (Try again).
 *
 * WHAT A WEB APP CANNOT DO. An iPhone stops a web page's location the
 * moment it is in the background or the phone is locked — Safari and Home
 * Screen apps alike; only a native app can share location in the
 * background. So sharing PAUSES when the page is hidden and RESUMES when it
 * is back in front, and the switch says so.
 *
 * A REFUSAL IS SAID, NOT SWALLOWED. The switch used to stay "on" while
 * nothing was sent, with "location not allowed on this device" and no way
 * out — in production no phone position was ever stored (2026-10-12). Each
 * state now says what is happening and what to do (status().state):
 *   off · starting · sharing · paused · denied · unavailable · error
 *
 * THE DESKTOP APP has no device position (its web view answers no location
 * request): it shares where its connection is, city level, every ten
 * minutes, marked source "ip" — the server never lets that override a
 * phone's fresher fix.
 */
import API_BASE, { isDesktop } from "../apiBase.js"
import { getSettings, subscribeSettings } from "../state/settingsStore.js"
import { DENIED, fixOf, kindOf, messageFor, platformOf } from "./geo.js"

export const KEY = "plx.liveShare"
export const MIN_MOVE_M = 10
export const MIN_GAP_MS = 3_000
export const HEARTBEAT_MS = 30_000
export const MAX_GAP_MS = HEARTBEAT_MS            // the old name
export const RETRY_MS = 5_000
/** The phone's watch: high accuracy, a fix at most 2 s old. */
export const WATCH = { enableHighAccuracy: true, maximumAge: 2_000, timeout: 30_000 }
export const WATCH_LOW = { enableHighAccuracy: false, maximumAge: 30_000, timeout: 30_000 }
const LIVE_FOR_MS = 10 * 60_000
const DESKTOP_EVERY_MS = 10 * 60_000
const TRAIL_MAX = 300

export function metres(a, b) {
    const r = Math.PI / 180
    const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2
    return 12742000 * Math.asin(Math.sqrt(h))
}

/** Whether the accuracy got much better: half the radius, and 15 m less. */
export function sharper(prev, next) {
    return prev?.accuracy != null && next?.accuracy != null && next.accuracy <= prev.accuracy / 2 && prev.accuracy - next.accuracy >= 15
}

/** Why this fix should go to the server, ignoring the 3 s spacing: "first",
 *  "moved", "sharper", "heartbeat" — or null. Pure. prev = the last
 *  position sent {lat, lon, accuracy, at}. */
export function reasonToSend(prev, next, now = Date.now()) {
    if (!prev) return "first"
    if (metres(prev, next) >= MIN_MOVE_M) return "moved"
    if (sharper(prev, next)) return "sharper"
    if (now - prev.at >= HEARTBEAT_MS) return "heartbeat"
    return null
}

/** Whether this fix should go to the server now. Pure. */
export function shouldSend(prev, next, now = Date.now()) {
    if (!prev) return true
    if (now - prev.at < MIN_GAP_MS) return false
    return reasonToSend(prev, next, now) != null
}

/** The machine, with everything it touches passed in (tests give fakes). */
export function createLiveShare({
    geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined,
    doFetch = (...a) => fetch(...a),
    storage = (() => { try { return localStorage } catch { return null } })(),
    doc = typeof document !== "undefined" ? document : undefined,
    win = typeof window !== "undefined" ? window : undefined,
    now = () => Date.now(),
    desktop = () => isDesktop(),
    connection = () => import("../components/LocationPrompt.jsx").then((m) => m.connectionPosition()),
    plat = () => platformOf(),
    apiBase = API_BASE,
    timers = { setInterval: (...a) => setInterval(...a), clearInterval: (id) => clearInterval(id), setTimeout: (...a) => setTimeout(...a), clearTimeout: (id) => clearTimeout(id) },
} = {}) {
    let state = "off"
    let message = null
    let live = null                 // {lat, lon, accuracy, at}  the device's own fix
    let approx = null               // {lat, lon, accuracy, at, label, approximate: true}  the connection's, when chosen
    let approxTimer = null
    let lastSent = null             // {lat, lon, accuracy, at}
    let blockedUntil = 0
    let watchId = null
    let lowAccuracy = false
    let beat = null
    let desktopTimer = null
    let listening = false
    let inflight = false
    let queued = null               // the latest fix waiting to go: {p, source, force}
    let flushT = null
    let forceNext = false           // back in front: the next fix goes at once
    const trail = []
    const subs = new Set()
    const emit = () => { for (const f of subs) { try { f() } catch { /* a listener */ } } }
    const set = (s, m = null) => { state = s; message = m; emit() }

    const on = () => { try { return storage?.getItem(KEY) === "on" } catch { return false } }

    function later(ms) {
        if (flushT != null) timers.clearTimeout(flushT)
        flushT = timers.setTimeout(() => { flushT = null; flush() }, Math.max(0, ms))
    }
    function flush() {
        if (!queued || inflight) return
        const q = queued
        queued = null
        consider(q.p, q.source, q.force)
    }

    /** Send this fix now, later (spacing, Retry-After, a request in flight)
     *  or not at all. Only the latest waiting fix is kept. */
    function consider(p, source = "gps", force = false) {
        const t = now()
        if (inflight) { queued = { p, source, force: force || !!queued?.force }; return }
        if (t < blockedUntil) { queued = { p, source, force: force || !!queued?.force }; later(blockedUntil - t); return }
        const why = force ? "force" : reasonToSend(lastSent, p, t)
        if (!why) return
        const wait = lastSent ? lastSent.at + MIN_GAP_MS - t : 0
        if (!force && wait > 0) { queued = { p, source, force }; later(wait); return }      // the spacing: it goes when the 3 s are up
        send(p, source)
    }

    async function send(p, source = "gps") {
        const t = now()
        inflight = true
        let retryIn = null
        try {
            const r = await doFetch(`${apiBase}/api/my-assets/live`, {
                method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lat: p.lat, lon: p.lon, accuracy: p.accuracy, source }),
            })
            if (r.ok) {
                lastSent = { lat: p.lat, lon: p.lon, accuracy: p.accuracy, at: t }
                if (state !== "paused") source === "ip" ? set("approximate", approxNote()) : set("sharing")
            } else if (r.status === 401) set("error", "You are signed out on this device — sign in again to share.")
            else if (r.status === 429 || r.status === 503) {
                const after = +(r.headers?.get?.("retry-after")) || (r.status === 429 ? 2 : 15)
                blockedUntil = t + after * 1000
                if (!queued) queued = { p, source, force: true }             // this one goes when allowed, unless a newer one does
                if (r.status === 503) set("error", "The server is busy — the next position goes shortly.")
            } else { set("error", `The server did not take the position (${r.status}); it will try again.`); retryIn = RETRY_MS }
        } catch {
            set("error", "Not sent: no connection. It will send when the phone is back online.")
            retryIn = RETRY_MS
        } finally {
            inflight = false
        }
        if (retryIn != null && !queued) queued = { p, source, force: true }
        if (queued) {
            const wait = retryIn ?? Math.max(0, blockedUntil - now(), (lastSent ? lastSent.at + MIN_GAP_MS : 0) - now())
            if (wait > 0) later(wait)
            else flush()
        }
    }

    function onFix(pos) {
        const f = fixOf(pos)
        live = f
        if (approx) clearApprox()                                     // a real fix: the approximate one is done
        trail.push({ lat: f.lat, lon: f.lon, at: f.at || now() })
        if (trail.length > TRAIL_MAX) trail.splice(0, trail.length - TRAIL_MAX)
        const force = forceNext
        forceNext = false
        if (["starting", "unavailable", "denied", "approximate"].includes(state) && lastSent && !force) set("sharing")
        consider(f, "gps", force)
        emit()
    }

    function onError(e) {
        const kind = kindOf(e?.code)
        if (kind === DENIED) {
            clearWatch()
            set("denied", messageFor(DENIED, plat()))
            return
        }
        // timeout / unavailable: once more at low accuracy (indoors: Wi-Fi, no GPS)
        if (!lowAccuracy) {
            lowAccuracy = true
            clearWatch()
            watch()
            if (state !== "sharing") set("starting", "Weak signal — trying with lower accuracy…")
            return
        }
        if (approx) return
        if (!live || now() - live.at > LIVE_FOR_MS) set("unavailable", messageFor(kind, plat()))
    }

    function watch() {
        if (!geo?.watchPosition) { set("unavailable", messageFor("unsupported", plat())); return }
        try { watchId = geo.watchPosition(onFix, onError, lowAccuracy ? WATCH_LOW : WATCH) }
        catch { set("unavailable", messageFor("unsupported", plat())) }
    }

    function clearWatch() {
        if (watchId != null) { try { geo?.clearWatch?.(watchId) } catch { /* gone */ } }
        watchId = null
    }

    // A FIX NOW, not at the first move: a watch need not call back until the
    // position changes (seen in the browser run), and the team should see
    // the phone the moment sharing starts or resumes
    function now1() {
        try { geo?.getCurrentPosition?.((p) => { if (watchId != null) onFix(p) }, () => {}, { ...WATCH, timeout: 20_000 }) } catch { /* the watch will do */ }
    }

    // standing still the watch may go quiet: the team still hears every 30 s
    function heartbeat() {
        if (state === "paused" || inflight || queued) return      // something is already on its way
        const t = now()
        if (t - (lastSent?.at || 0) < HEARTBEAT_MS) return
        if (live && t - live.at < LIVE_FOR_MS) consider({ ...live }, "gps", true)
        else if (live && watchId != null) geo?.getCurrentPosition?.(onFix, () => {}, { ...WATCH_LOW, timeout: 20_000 })
    }

    // ── approximate: the connection's place, only when chosen ─────────────
    const approxNote = () => `Approximate location — from your connection, city level${approx?.label ? ` (${approx.label})` : ""}. Not where this phone precisely is.`
    function clearApprox() {
        approx = null
        if (approxTimer != null) { timers.clearInterval(approxTimer); approxTimer = null }
    }
    function approxTick() {
        return connection().then((p) => {
            if (live && now() - live.at < LIVE_FOR_MS) { clearApprox(); return null }    // a GPS fix came: it wins
            approx = { lat: p.lat, lon: p.lon, accuracy: 5000, at: now(), label: p.label || null, approximate: true }
            set("approximate", approxNote())
            consider(approx, "ip", true)
            return approx
        }).catch((e) => { set(state, e?.message || "Your location could not be found from this connection."); throw e })
    }

    function begin() {
        if (desktop()) {
            if (desktopTimer != null) return
            const tick = () => connection()
                .then((p) => { live = { lat: p.lat, lon: p.lon, accuracy: 5000, at: now() }; return consider(live, "ip", true) })
                .catch((e) => set("unavailable", e?.message || "Your location could not be found from this connection."))
            set("starting")
            tick()
            desktopTimer = timers.setInterval(tick, DESKTOP_EVERY_MS)
            return
        }
        listen()
        if (doc?.hidden) { set("paused", pausedNote()); return }
        if (watchId != null) return
        if (state !== "sharing") set("starting")
        watch()
        now1()
        if (beat == null) beat = timers.setInterval(heartbeat, 5_000)
        seedTrail()
    }

    function end() {
        clearWatch()
        clearApprox()
        if (flushT != null) { timers.clearTimeout(flushT); flushT = null }
        queued = null
        if (beat != null) { timers.clearInterval(beat); beat = null }
        if (desktopTimer != null) { timers.clearInterval(desktopTimer); desktopTimer = null }
    }

    const pausedNote = () => plat().ios
        ? "Paused while Parallax is in the background — an iPhone web app cannot share location in the background. It resumes when you open it."
        : "Paused while this page is hidden — it resumes when you come back."

    // IN THE BACKGROUND THE PHONE STOPS IT; BACK IN FRONT IT RESUMES
    function onVisibility() {
        if (!on() || desktop()) return
        if (doc?.hidden) { clearWatch(); set("paused", pausedNote()) }
        else {
            // BACK IN FRONT: the next fix goes at once, whatever the spacing
            lowAccuracy = false
            forceNext = true
            if (watchId == null && state !== "denied") { set("starting"); watch() }
            if (watchId != null) now1()
        }
    }
    function listen() {
        if (listening || !doc) return
        listening = true
        doc.addEventListener?.("visibilitychange", onVisibility)
        win?.addEventListener?.("pageshow", onVisibility)
        win?.addEventListener?.("online", () => { if (on() && (queued || live)) { blockedUntil = 0; queued ? flush() : consider({ ...live }, "gps", true) } })
    }

    let seeded = false
    function seedTrail() {
        if (seeded) return
        seeded = true
        doFetch(`${apiBase}/api/my-assets/me/positions?hours=6`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                const pts = (d?.positions || []).filter((p) => p.source !== "ip").map((p) => ({ lat: p.lat, lon: p.lon, at: Date.parse(p.at) }))
                if (pts.length) { trail.unshift(...pts.filter((p) => !trail.length || p.at < trail[0].at)); emit() }
            }).catch(() => {})
    }

    return {
        /** Turn live sharing on (the user's own choice, from a tap) and start
         *  it; `fix` — the position the tap already obtained — goes at once. */
        start(fix) {
            try { storage?.setItem(KEY, "on") } catch { /* private mode: this session only */ }
            lowAccuracy = false
            end()
            begin()
            if (fix && !fix.approximate && Number.isFinite(fix.lat) && watchId != null) {
                onFix({ coords: { latitude: fix.lat, longitude: fix.lon, accuracy: fix.accuracy ?? null }, timestamp: fix.at || now() })
            }
        },
        stop() {
            try { storage?.removeItem(KEY) } catch { /* nothing stored */ }
            end()
            live = null
            set("off")
        },
        /** On launch: resume if this device was sharing. */
        resume() { if (on()) begin() },
        /** "Try again" after a refusal or no fix — from a tap: asks for the
         *  precise position again (the approximate one stays until a fix comes). */
        retry() { const a = approx; lowAccuracy = false; end(); if (a) approx = a; begin() },
        /** "Use approximate location" — from a tap, when precise is refused or
         *  unavailable: the connection's place, city level, every ten minutes. */
        approximate() {
            try { storage?.setItem(KEY, "on") } catch { /* this session only */ }
            listen()
            if (approxTimer == null) approxTimer = timers.setInterval(() => { approxTick().catch(() => {}) }, DESKTOP_EVERY_MS)
            return approxTick()
        },
        approx() { return approx },
        on,
        status() {
            return { on: on(), state: on() ? state : "off", message: on() ? message : null, running: watchId != null || desktopTimer != null || approxTimer != null,
                     lastSentAt: lastSent?.at || null, lastFixAt: live?.at || null, accuracy: live?.accuracy ?? null, lowAccuracy,
                     approximate: !!approx, approxLabel: approx?.label || null, queued: !!queued, inflight,
                     // kept for the old readers
                     error: on() && ["denied", "unavailable", "error"].includes(state) ? message : null,
                     canApproximate: on() && !desktop() && ["denied", "unavailable"].includes(state) }
        },
        live() { return live && now() - live.at < LIVE_FOR_MS ? live : null },
        trail() { return trail.slice() },
        subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
        // for tests
        _onVisibility: onVisibility,
    }
}

// ── the app's one instance ────────────────────────────────────────────────
const share = createLiveShare()

export function subscribeMyPosition(fn) {
    const f = () => fn(myPosition())
    const off1 = share.subscribe(f)
    const off2 = subscribeSettings(f)
    return () => { off1(); off2?.() }
}

/** {lat, lon, live, accuracy?, label?, approximate?} or null: this device's
 *  fix; else the connection's, when the user chose it (labelled); else the
 *  place they gave. */
export function myPosition() {
    const l = share.live()
    if (l) return { lat: l.lat, lon: l.lon, accuracy: l.accuracy, live: true, at: l.at }
    const a = share.approx()
    if (a) return { lat: a.lat, lon: a.lon, accuracy: a.accuracy, live: false, approximate: true, at: a.at, label: a.label ? `${a.label} (approximate)` : "Approximate, from your connection" }
    const h = getSettings()?.interests?.here
    if (h && Number.isFinite(+h.lat) && Number.isFinite(+h.lon)) return { lat: +h.lat, lon: +h.lon, live: false, label: h.label || null }
    return null
}

/** Where this device has been while sharing (and the last six hours on the server). */
export const myTrail = () => share.trail()
export const sharingOn = () => share.on()
export const shareStatus = () => share.status()
export const startSharing = (fix) => share.start(fix)
export const stopSharing = () => share.stop()
export const resumeSharing = () => share.resume()
export const retrySharing = () => share.retry()
export const shareApproximateLocation = () => share.approximate()
