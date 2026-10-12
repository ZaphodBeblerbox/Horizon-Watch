/**
 * positionStream.js — the team's positions, pushed as they happen.
 *
 * REAL TIME (owner, 2026-10-12). A phone sharing its location sends every
 * few seconds while it moves; the server pushes each position at once to
 * every viewer allowed to see it (backend/position_stream.py, Server-Sent
 * Events). This is the one client of that stream: the phone map's Team
 * layer and linked assets, the desktop globe, and the asset pages all read
 * from it (location/useLivePositions.js) — one connection per page.
 *
 * OPENING IT ACROSS SITES. The page (Vercel) and the API (Railway) are two
 * sites; the session is a bearer the page holds, and EventSource cannot
 * send headers. So: an ordinary authenticated POST for a stream token (60
 * s to use), then EventSource with ?t=. Every reconnect asks for a new one.
 *
 * WHEN IT BREAKS. EventSource would reconnect by itself — with the expired
 * token — so each error closes it and this reconnects with a new token,
 * after 1, 2, 4, 8, 16, 30 s (±25 %). A connection that has gone silent
 * (no event or ping for 40 s: a phone that changed networks keeps a dead
 * socket open) is treated the same way. After three failures in a row the
 * positions are POLLED (GET /api/my-assets/people every 10 s) while the
 * stream keeps being retried; the first snapshot from a reopened stream
 * stops the polling. In the background the stream is closed (a phone's
 * battery) and reopened, with a fresh snapshot, when the page is in front.
 *
 * CLOCKS. "live · 3 s ago" is measured against the server's clock (the
 * snapshot carries it), so a phone whose clock is a minute off does not
 * show everyone as a minute stale.
 */
import API_BASE from "../apiBase.js"

export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
export const POLL_AFTER_FAILURES = 3
export const POLL_MS = 10_000
export const SILENCE_MS = 40_000
export const OPEN_TIMEOUT_MS = 12_000

export function backoff(attempt, random = Math.random) {
    const base = BACKOFF_MS[Math.min(BACKOFF_MS.length - 1, Math.max(0, attempt - 1))]
    return Math.round(base * (0.75 + 0.5 * random()))
}

export function createPositionStream({
    apiBase = API_BASE,
    doFetch = (...a) => fetch(...a),
    ES = typeof EventSource !== "undefined" ? EventSource : undefined,
    timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (id) => clearTimeout(id), setInterval: (...a) => setInterval(...a), clearInterval: (id) => clearInterval(id) },
    now = () => Date.now(),
    doc = typeof document !== "undefined" ? document : undefined,
    win = typeof window !== "undefined" ? window : undefined,
    random = Math.random,
} = {}) {
    const people = new Map()        // user_id -> {user_id, name, lat, lon, accuracy_m, source, at (ms, server clock), assets: [id], prevAt}
    const assets = new Map()        // asset id -> {lat, lon, at, user_id, source, accuracy_m}
    const subs = new Set()
    const passive = new Set()       // told of every event, but never open the stream (warnings/WarningTakeover.jsx)
    let es = null
    let mode = "off"                // off · connecting · live · polling
    let failures = 0
    let retryT = null, pollT = null, silenceT = null, openT = null
    let skew = 0                    // server clock - this clock, ms
    let lastEventAt = 0
    let listening = false
    let generation = 0
    const stats = { opens: 0, errors: 0, events: 0, polls: 0 }

    const emit = (ev) => { for (const f of [...subs, ...passive]) { try { f(ev) } catch { /* a listener */ } } }

    function apply(p, via) {
        if (!p?.user_id || !Number.isFinite(+p.lat) || !Number.isFinite(+p.lon)) return false
        const at = Date.parse(p.at) || now() + skew
        const prev = people.get(String(p.user_id))
        if (prev && prev.at > at) return false                   // an older position never replaces a newer one
        const ids = (p.assets || []).map((a) => (typeof a === "string" ? a : a?.id)).filter(Boolean)
        const row = { user_id: String(p.user_id), name: p.name || prev?.name || "Team member", lat: +p.lat, lon: +p.lon,
                      accuracy_m: p.accuracy_m ?? null, source: p.source || "gps", at, prevAt: prev?.at ?? null,
                      assets: ids.length ? ids : prev?.assets || [], via }
        people.set(row.user_id, row)
        for (const id of row.assets) assets.set(id, { lat: row.lat, lon: row.lon, at, user_id: row.user_id, source: row.source, accuracy_m: row.accuracy_m, prevAt: row.prevAt })
        return true
    }

    function setMode(m) { if (mode !== m) { mode = m; emit({ type: "mode", mode }) } }

    function clearTimers() {
        for (const t of [retryT, openT]) if (t != null) timers.clearTimeout(t)
        if (silenceT != null) timers.clearInterval(silenceT)
        retryT = openT = silenceT = null
    }
    function closeES() { if (es) { try { es.close() } catch { /* gone */ } } es = null }

    function startPolling() {
        if (pollT != null) return
        const poll = () => {
            stats.polls++
            doFetch(`${apiBase}/api/my-assets/people?hours=24`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => {
                    if (!d || mode === "live") return
                    let changed = false
                    for (const p of d.people || []) changed = apply(p, "poll") || changed
                    emit({ type: "poll", changed })
                }).catch(() => {})
        }
        poll()
        pollT = timers.setInterval(poll, POLL_MS)
        if (mode !== "live") setMode("polling")
    }
    function stopPolling() { if (pollT != null) { timers.clearInterval(pollT); pollT = null } }

    function failed(gen) {
        if (gen !== generation) return
        stats.errors++
        closeES()
        clearTimers()
        failures++
        if (failures >= POLL_AFTER_FAILURES) startPolling()
        else if (mode !== "polling") setMode("connecting")
        if (!subs.size) return
        retryT = timers.setTimeout(() => { retryT = null; connect() }, backoff(failures, random))
    }

    async function connect() {
        if (!subs.size || doc?.hidden) return
        const gen = ++generation
        closeES()
        clearTimers()
        if (mode !== "polling") setMode("connecting")
        let token
        try {
            const r = await doFetch(`${apiBase}/api/positions/stream-token`, { method: "POST", credentials: "include" })
            if (!r.ok) throw new Error(String(r.status))
            token = (await r.json())?.token
            if (!token) throw new Error("no token")
        } catch { failed(gen); return }
        if (gen !== generation) return
        if (!ES) { startPolling(); return }                 // no EventSource here: polling only
        let src
        try { src = new ES(`${apiBase}/api/positions/stream?t=${encodeURIComponent(token)}`) } catch { failed(gen); return }
        es = src
        stats.opens++
        lastEventAt = now()
        const seen = () => { lastEventAt = now() }
        openT = timers.setTimeout(() => { openT = null; if (mode !== "live") failed(gen) }, OPEN_TIMEOUT_MS)
        silenceT = timers.setInterval(() => { if (now() - lastEventAt > SILENCE_MS) failed(gen) }, 5_000)
        src.addEventListener("snapshot", (e) => {
            if (gen !== generation) return
            seen()
            let d = null
            try { d = JSON.parse(e.data) } catch { return }
            const st = Date.parse(d?.server_time)
            if (Number.isFinite(st)) skew = st - now()
            for (const p of d?.people || []) apply(p, "snapshot")
            failures = 0
            stopPolling()
            if (openT != null) { timers.clearTimeout(openT); openT = null }
            setMode("live")
            emit({ type: "snapshot" })
        })
        src.addEventListener("position", (e) => {
            if (gen !== generation) return
            seen()
            stats.events++
            let p = null
            try { p = JSON.parse(e.data) } catch { return }
            if (apply(p, "stream")) emit({ type: "position", user_id: String(p.user_id) })
        })
        src.addEventListener("ping", () => { if (gen === generation) seen() })
        // A WARNING for this user, or an update on one they sent (backend/asset_warnings.py):
        // passed on as it is; the takeover and the asset page decide what it means
        for (const name of ["warning", "warning_update"]) {
            src.addEventListener(name, (e) => {
                if (gen !== generation) return
                seen()
                let d = null
                try { d = JSON.parse(e.data) } catch { return }
                if (d?.warning) emit({ type: name, warning: d.warning })
            })
        }
        src.addEventListener("bye", () => {
            if (gen !== generation) return
            // the server closes a stream after a while, or as it restarts: open a new one at once
            closeES(); clearTimers()
            retryT = timers.setTimeout(() => { retryT = null; connect() }, 300 + Math.round(700 * random()))
        })
        src.onerror = () => failed(gen)
    }

    function stopAll() {
        generation++
        closeES(); clearTimers(); stopPolling()
        setMode("off")
    }

    function onVisibility() {
        if (!subs.size) return
        if (doc?.hidden) stopAll()
        else if (mode === "off") { failures = 0; connect() }
    }
    function listen() {
        if (listening) return
        listening = true
        doc?.addEventListener?.("visibilitychange", onVisibility)
        win?.addEventListener?.("online", () => { if (subs.size && mode !== "live") { failures = 0; connect() } })
    }

    return {
        /** fn(event) on every change; the stream runs while anyone listens. */
        subscribe(fn) {
            subs.add(fn)
            listen()
            if (subs.size === 1) { failures = 0; connect() }
            return () => {
                subs.delete(fn)
                if (!subs.size) stopAll()
            }
        },
        /** fn(event) on every event while the stream happens to be open — never opens it. */
        listen(fn) { passive.add(fn); return () => passive.delete(fn) },
        people() { return [...people.values()] },
        findPerson(uid) { return people.get(String(uid)) || null },
        asset(id) { return assets.get(String(id)) || null },
        /** This device's now on the server's clock. */
        serverNow() { return now() + skew },
        mode() { return mode },
        stats() { return { ...stats, failures, mode } },
        // for tests
        _onVisibility: onVisibility,
    }
}

// ── the app's one stream ──────────────────────────────────────────────────
let _one = null
export function positionStream() {
    if (!_one) _one = createPositionStream()
    return _one
}
