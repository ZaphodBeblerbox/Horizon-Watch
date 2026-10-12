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
 * device is watched (watchPosition) and its position goes to the server
 * when it has moved 50 m, and at least every two minutes standing still —
 * never more than once in ten seconds. The server keeps every position with
 * its time, and every asset linked to the user moves there and is
 * reassessed (backend owned_assets.record_position).
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
import { DENIED, HIGH, LOW, fixOf, kindOf, messageFor, platformOf } from "./geo.js"

export const KEY = "plx.liveShare"
export const MIN_MOVE_M = 50
export const MAX_GAP_MS = 2 * 60_000
export const MIN_GAP_MS = 10_000
const LIVE_FOR_MS = 10 * 60_000
const DESKTOP_EVERY_MS = 10 * 60_000
const TRAIL_MAX = 300

export function metres(a, b) {
    const r = Math.PI / 180
    const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2
    return 12742000 * Math.asin(Math.sqrt(h))
}

/** Whether this fix should go to the server now. Pure. prev = the last
 *  position sent {lat, lon, at}. */
export function shouldSend(prev, next, now = Date.now()) {
    if (!prev) return true
    const gap = now - prev.at
    if (gap < MIN_GAP_MS) return false
    return metres(prev, next) >= MIN_MOVE_M || gap >= MAX_GAP_MS
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
    let live = null                 // {lat, lon, accuracy, at}
    let lastSent = null             // {lat, lon, at}
    let lastTry = 0
    let blockedUntil = 0
    let watchId = null
    let lowAccuracy = false
    let beat = null
    let desktopTimer = null
    let listening = false
    const trail = []
    const subs = new Set()
    const emit = () => { for (const f of subs) { try { f() } catch { /* a listener */ } } }
    const set = (s, m = null) => { state = s; message = m; emit() }

    const on = () => { try { return storage?.getItem(KEY) === "on" } catch { return false } }

    let inflight = false
    async function send(p, source = "gps") {
        const t = now()
        if (t < blockedUntil || inflight) return          // one request at a time: two in flight made two assets
        lastTry = t
        inflight = true
        try {
            const r = await doFetch(`${apiBase}/api/my-assets/live`, {
                method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lat: p.lat, lon: p.lon, accuracy: p.accuracy, source }),
            })
            if (r.ok) {
                lastSent = { lat: p.lat, lon: p.lon, at: t }
                if (state !== "paused") set("sharing")
                return
            }
            if (r.status === 401) set("error", "You are signed out on this device — sign in again to share.")
            else if (r.status === 429 || r.status === 503) {
                const after = +(r.headers?.get?.("retry-after")) || 15
                blockedUntil = t + after * 1000
                set("error", r.status === 429 ? "Sending too often — the next position goes shortly." : "The server is busy — the next position goes shortly.")
            } else set("error", `The server did not take the position (${r.status}); it will try again.`)
        } catch {
            set("error", "Not sent: no connection. It will send when the phone is back online.")
        } finally { inflight = false }
    }

    function onFix(pos) {
        const f = fixOf(pos)
        live = f
        trail.push({ lat: f.lat, lon: f.lon, at: f.at || now() })
        if (trail.length > TRAIL_MAX) trail.splice(0, trail.length - TRAIL_MAX)
        const t = now()
        const pending = lastTry > (lastSent?.at || 0) && t - lastTry >= MIN_GAP_MS    // the last attempt failed
        if (shouldSend(lastSent, f, t) || (pending && t >= blockedUntil)) send(f)
        else if ((state === "starting" || state === "unavailable") && lastSent) set("sharing")
        else emit()
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
        if (!live || now() - live.at > LIVE_FOR_MS) set("unavailable", messageFor(kind, plat()))
    }

    function watch() {
        if (!geo?.watchPosition) { set("unavailable", messageFor("unsupported", plat())); return }
        try { watchId = geo.watchPosition(onFix, onError, lowAccuracy ? { ...LOW, timeout: 30_000 } : { ...HIGH, timeout: 30_000 }) }
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
        try { geo?.getCurrentPosition?.((p) => { if (watchId != null) onFix(p) }, () => {}, { ...HIGH, timeout: 20_000 }) } catch { /* the watch will do */ }
    }

    // standing still the watch may go quiet: the team still hears every two minutes
    function heartbeat() {
        if (!live || state === "paused") return
        const t = now()
        if (t - (lastSent?.at || 0) < MAX_GAP_MS) return
        if (t - live.at < LIVE_FOR_MS) send({ ...live })
        else geo?.getCurrentPosition?.(onFix, () => {}, { ...LOW, timeout: 20_000 })
    }

    function begin() {
        if (desktop()) {
            if (desktopTimer != null) return
            const tick = () => connection()
                .then((p) => { live = { lat: p.lat, lon: p.lon, accuracy: 5000, at: now() }; return send(live, "ip") })
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
        if (beat == null) beat = timers.setInterval(heartbeat, 30_000)
        seedTrail()
    }

    function end() {
        clearWatch()
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
        else { lowAccuracy = false; if (watchId == null) { set("starting"); watch(); now1() } }
    }
    function listen() {
        if (listening || !doc) return
        listening = true
        doc.addEventListener?.("visibilitychange", onVisibility)
        win?.addEventListener?.("pageshow", onVisibility)
        win?.addEventListener?.("online", () => { if (on() && live) send({ ...live }) })
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
        /** "Try again" after a refusal or no fix — from a tap. */
        retry() { lowAccuracy = false; end(); begin() },
        on,
        status() {
            return { on: on(), state: on() ? state : "off", message: on() ? message : null, running: watchId != null || desktopTimer != null,
                     lastSentAt: lastSent?.at || null, lastFixAt: live?.at || null, accuracy: live?.accuracy ?? null, lowAccuracy,
                     // kept for the old readers
                     error: on() && ["denied", "unavailable", "error"].includes(state) ? message : null }
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

/** {lat, lon, live, accuracy?, label?} or null. */
export function myPosition() {
    const l = share.live()
    if (l) return { lat: l.lat, lon: l.lon, accuracy: l.accuracy, live: true, at: l.at }
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
