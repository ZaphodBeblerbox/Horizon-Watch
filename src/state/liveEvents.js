/**
 * liveEvents.js — the pipeline telling the UI something happened.
 *
 * Every live surface in this app was a timer: notifications every 20s, the
 * Inbox every 30s, findings every five minutes. That is not "not quite real
 * time", it is a fixed delay on everything, and on a quiet console it reads
 * as a dead one — you cannot tell a system with nothing to say from a system
 * that has stopped talking.
 *
 * So the backend pushes, over /api/stream, and this is the one connection
 * the whole app shares. Several EventSources to the same endpoint would be
 * several open sockets and several reconnect storms; components subscribe to
 * this instead.
 *
 * THE POLLS STAY. This does not replace them, it gets ahead of them. SSE
 * dies quietly — a proxy idles it out, a laptop sleeps, a middlebox buffers
 * it forever — and a UI that only listened would look alive while being
 * hours stale. That is worse than one that is visibly a minute behind,
 * because it is wrong without saying so. The timer is the floor; this is
 * what makes the normal case immediate.
 */

import API_BASE from "../apiBase.js"

const listeners = new Set()
let source = null
let retry = 0
let retryTimer = null
let connected = false

/** Everything the stream can say, plus "*" for any of them. */
export const LIVE_EVENTS = [
    "alert.created", "signal.created", "news_article.created",
    "fusion.created", "surge.created", "ontology_link.created",
]

function emit(type, data) {
    for (const l of listeners) {
        if (l.types && !l.types.includes(type)) continue
        try { l.fn(type, data) } catch { /* one bad subscriber must not stop the rest */ }
    }
}

function open() {
    if (source || typeof EventSource === "undefined") return
    let es
    try {
        es = new EventSource(`${API_BASE}/api/stream`, { withCredentials: true })
    } catch {
        // No EventSource, or a URL the browser refuses. The pollers carry
        // the app on their own; this is an enhancement, never a dependency.
        return
    }
    source = es

    es.addEventListener("ready", () => {
        connected = true
        retry = 0
        emit("stream.connected", {})
    })

    for (const type of LIVE_EVENTS) {
        es.addEventListener(type, (e) => {
            let data = {}
            try { data = JSON.parse(e.data || "{}") } catch { /* keep {} */ }
            emit(type, data)
        })
    }

    es.onerror = () => {
        // EventSource retries on its own, but with no backoff and no way to
        // give up — against a backend that is down that is a request a
        // second forever. Closing and rescheduling puts that under control.
        connected = false
        try { es.close() } catch { /* already gone */ }
        if (source === es) source = null
        emit("stream.disconnected", {})
        if (retryTimer) return
        // 2s, 4s, 8s … 60s. Capped because the app is still usable on the
        // timers alone, so there is no reason to hammer.
        const wait = Math.min(60000, 2000 * Math.pow(2, retry++))
        retryTimer = setTimeout(() => { retryTimer = null; open() }, wait)
    }
}

/**
 * Subscribe to live pipeline events.
 *
 * @param fn     (type, data) => void
 * @param types  optional list to filter on; omit for everything
 * @returns      unsubscribe
 */
export function subscribeLive(fn, types = null) {
    const entry = { fn, types }
    listeners.add(entry)
    open()
    return () => {
        listeners.delete(entry)
        // The connection is left open when the last subscriber goes: this is
        // a single app-lifetime stream, and tearing it down on a tab switch
        // only to rebuild it a second later is more expensive than holding
        // an idle socket that sends a keep-alive every twenty seconds.
    }
}

/** Whether the push channel is currently up. Polling covers it when not. */
export function isLiveConnected() {
    return connected
}
