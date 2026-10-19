/**
 * useConnection.js — what the app's own requests are seeing, right now.
 *
 * offlineCache announces every change between "the server answered" and
 * "it did not" (CACHE_EVENT), with the reason (lib/connectivity.js). This
 * folds those and the browser's online/offline events into one reading:
 *
 *   ok           the last request was answered
 *   offline      the device has no network
 *   slow         the server took longer than the deadline
 *   unreachable  nothing answered, though the device has a network
 *   server-error the server answered with an error
 *
 * Only "offline" blames the device.
 */
import { useEffect, useState } from "react"
import { CACHE_EVENT } from "./offlineCache.js"
import { deviceOffline, probeServer } from "./connectivity.js"
import API_BASE from "../apiBase.js"

/** Pure, so it is testable: the next reading from the last and an event. */
export function nextConnection(prev, ev) {
    if (!ev) return prev
    if (ev.type === "offline") return "offline"
    // The network is back; whether the server answers is the next request's
    // to say, so stop blaming the device and wait for it.
    if (ev.type === "online") return prev === "offline" ? "ok" : prev
    if (ev.type === "cache") {
        const d = ev.detail || {}
        if (d.state === "live") return "ok"
        if (d.state === "cached" || d.state === "offline-empty") return d.reason || prev
    }
    return prev
}

/**
 * ONE SLOW REQUEST IS NOT A SLOW SERVER. Every request reports its own
 * result, so a single heavy endpoint timing out (production, 2026-10-18:
 * /api/alerts/fusions at 121 s while /api/health/live answered in 0.2 s)
 * put "Server slow" on screen for everyone. A failure is only believed
 * once the server's cheapest address fails too; if that answers within
 * PROBE_MS, the server is fine and the reading stays "ok".
 */
export const PROBE_MS = 5000

export async function confirmFailure(reason, probe = () => probeServer({ apiBase: API_BASE, timeoutMs: PROBE_MS })) {
    if (!reason || reason === "offline") return reason
    const t0 = Date.now()
    const up = await probe().catch(() => false)
    if (up && Date.now() - t0 < PROBE_MS) return null
    return up ? "slow" : "unreachable"
}

export default function useConnection() {
    const [state, setState] = useState(() => (deviceOffline() ? "offline" : "ok"))
    useEffect(() => {
        let probing = false
        const onCache = (e) => {
            const d = e?.detail || {}
            const bad = (d.state === "cached" || d.state === "offline-empty") && d.reason && d.reason !== "offline"
            if (!bad) { setState((p) => nextConnection(p, { type: "cache", detail: d })); return }
            if (probing) return
            probing = true
            confirmFailure(d.reason).then((r) => {
                if (r) setState((p) => nextConnection(p, { type: "cache", detail: { ...d, reason: r } }))
            }).finally(() => { probing = false })
        }
        const onOff = () => setState((p) => nextConnection(p, { type: "offline" }))
        const onOn = () => setState((p) => nextConnection(p, { type: "online" }))
        window.addEventListener(CACHE_EVENT, onCache)
        window.addEventListener("offline", onOff)
        window.addEventListener("online", onOn)
        return () => {
            window.removeEventListener(CACHE_EVENT, onCache)
            window.removeEventListener("offline", onOff)
            window.removeEventListener("online", onOn)
        }
    }, [])
    return state
}

/** The phone's one-line wording for each reading; null when all is well. */
export function connectionLine(state) {
    switch (state) {
    case "offline": return "You're offline — showing what this phone already has"
    case "slow": return "Server slow — reconnecting…"
    case "server-error": return "Server having trouble — reconnecting…"
    case "unreachable": return "Can't reach the server — reconnecting…"
    default: return null
    }
}
