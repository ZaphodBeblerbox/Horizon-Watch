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
import { deviceOffline } from "./connectivity.js"

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

export default function useConnection() {
    const [state, setState] = useState(() => (deviceOffline() ? "offline" : "ok"))
    useEffect(() => {
        const onCache = (e) => setState((p) => nextConnection(p, { type: "cache", detail: e?.detail }))
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
