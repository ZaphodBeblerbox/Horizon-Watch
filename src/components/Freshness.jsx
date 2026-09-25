/**
 * Freshness.jsx — "Data as of 14:32Z · 4m ago" (v4.3 §2).
 *
 * The status bar is gone and this is the one fact it carried that a
 * reader actually needs: how old is what I am looking at. An intelligence
 * console that cannot answer that is asking to be trusted about a
 * picture whose age it will not state.
 *
 * Three states, and the third is the one that matters: green while
 * fresh, amber past an hour, and GREY WITH AN "Offline ·" PREFIX when
 * the browser has no network. A stale reading that looks merely old is
 * different from one nothing is updating at all, and conflating them is
 * how a disconnected console goes on looking alive.
 */
import { useEffect, useState } from "react"
import { CACHE_EVENT } from "../lib/offlineCache.js"

/** Past this many minutes the reading is amber rather than green. */
export const STALE_MIN = 60

/** "14:32Z" */
export function zulu(d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null
    const p = (n) => String(n).padStart(2, "0")
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}Z`
}

/** "4m ago", "2h ago", "just now". */
export function ago(ms) {
    if (!Number.isFinite(ms) || ms < 0) return null
    const m = Math.floor(ms / 60000)
    if (m < 1) return "just now"
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
}

/** The whole readout, as data, so the states are testable without a DOM. */
/**
 * `online` is not the same question as "is the server answering".
 *
 * navigator.onLine only reports whether the browser believes it has a
 * network. With Railway restarting — which is the case this console most
 * needs to be honest about — it stays TRUE while every request fails and
 * offlineCache serves the last good body instead. The readout would then
 * show a green dot over data that is not being updated by anything, which
 * is precisely the thing this component exists to prevent.
 *
 * So `cache` carries what the fetch layer actually observed: "cached" once
 * a response has been served from the local store, "live" when the server
 * answered. It outranks navigator.onLine, because it is evidence rather
 * than a guess.
 */
export function freshnessState(updatedAt, now = Date.now(), online = true, cache = null) {
    if (cache && cache.state === "cached") {
        const at = cache.cachedAt ? new Date(cache.cachedAt) : null
        const known = at && !Number.isNaN(at.getTime())
        return {
            tone: "offline",
            text: known
                ? `Server unreachable · showing data from ${zulu(at)} · ${ago(now - at.getTime())}`
                : "Server unreachable · showing stored data",
        }
    }
    const d = updatedAt ? new Date(updatedAt) : null
    const valid = d && !Number.isNaN(d.getTime())
    if (!valid) {
        return { tone: online ? "unknown" : "offline",
                 text: online ? "Data age unknown" : "Offline · data age unknown" }
    }
    const age = now - d.getTime()
    const stale = age >= STALE_MIN * 60000
    const body = `Data as of ${zulu(d)} · ${ago(age)}`
    if (!online) return { tone: "offline", text: `Offline · ${body}` }
    return { tone: stale ? "stale" : "fresh", text: body }
}

const TONE = {
    fresh:   { dot: "var(--green, #3f9a58)", text: "var(--txt-3)" },
    stale:   { dot: "var(--amber)",          text: "var(--amber)" },
    offline: { dot: "var(--txt-4)",          text: "var(--txt-4)" },
    unknown: { dot: "var(--txt-4)",          text: "var(--txt-4)" },
}

export default function Freshness({ updatedAt }) {
    const [, tick] = useState(0)
    const [online, setOnline] = useState(
        () => (typeof navigator === "undefined" ? true : navigator.onLine))
    // What the fetch layer actually saw, rather than what the browser
    // believes about its network. See freshnessState.
    const [cache, setCache] = useState(null)

    useEffect(() => {
        // Re-ticks on its own: the timestamp does not change but its AGE
        // does, and a readout that only updates when data arrives says
        // "4m ago" an hour later.
        const t = setInterval(() => tick((n) => n + 1), 30000)
        const on = () => setOnline(true)
        const off = () => setOnline(false)
        const onCache = (e) => setCache(e?.detail || null)
        window.addEventListener("online", on)
        window.addEventListener("offline", off)
        window.addEventListener(CACHE_EVENT, onCache)
        return () => {
            clearInterval(t)
            window.removeEventListener("online", on)
            window.removeEventListener("offline", off)
            window.removeEventListener(CACHE_EVENT, onCache)
        }
    }, [])

    const s = freshnessState(updatedAt, Date.now(), online, cache)
    const tone = TONE[s.tone] || TONE.unknown
    return (
        <div title="Age of the newest data on screen"
             style={{ display: "flex", alignItems: "center", gap: 5,
                      font: "400 10.5px var(--font)", color: tone.text,
                      whiteSpace: "nowrap", padding: "0 8px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%",
                           background: tone.dot, flex: "none" }} />
            {s.text}
        </div>
    )
}
