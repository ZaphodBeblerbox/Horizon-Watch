/**
 * LiveTape.jsx — one line, saying what just arrived.
 *
 * The single most "alive" element in any operations room, and the one
 * that fabricates nothing: it shows what the feeds actually produced, in
 * the order they produced it, with the time. No interpretation, no
 * ranking, no synthesis — a tape.
 *
 * WHY A TAPE AND NOT AN ANIMATION. Motion is the scarcest attention
 * resource on a screen, and a tape spends it correctly: it moves only
 * when something happens, and what moves is the thing that happened. An
 * animated map spends motion on the map, which is not news.
 *
 * IT NEVER INVENTS A PACE. When nothing has arrived it says so and stops
 * — a ticker that loops old items to keep moving is a liveness theatre
 * that teaches people the motion means nothing.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { subscribeNotifications, getNotifications, KIND } from "../state/notificationStore.js"

/** How long an item counts as "just arrived" for the tape. */
const WINDOW_MS = 6 * 60 * 60 * 1000

const SEV_COLOR = {
    critical: "var(--sev-critical, #d4553f)",
    high: "var(--sev-high, #e8a33d)",
    moderate: "var(--sev-medium, #c9a227)",
    low: "var(--txt-4, #6f8fa8)",
}

function ago(ts, now) {
    const s = Math.max(0, Math.floor((now - ts) / 1000))
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m`
    return `${Math.floor(m / 60)}h`
}

export default function LiveTape({ max = 40 }) {
    const [snap, setSnap] = useState(() => getNotifications())
    const [now, setNow] = useState(() => Date.now())
    const [paused, setPaused] = useState(false)
    const railRef = useRef(null)

    useEffect(() => subscribeNotifications(setSnap), [])
    useEffect(() => {
        // The clock runs whether or not anything arrives, so the ages on
        // screen are true while a person is reading rather than only at
        // the moment something lands.
        const h = setInterval(() => setNow(Date.now()), 5000)
        return () => clearInterval(h)
    }, [])

    const items = useMemo(() => {
        const cutoff = Date.now() - WINDOW_MS
        return (snap.items || [])
            .filter((i) => i.ts >= cutoff)
            .sort((a, b) => b.ts - a.ts)
            .slice(0, max)
    }, [snap.items, max])

    // A new arrival scrolls the rail back to the start, unless the reader
    // is holding it still — pulling the rail out from under someone who
    // is reading it is worse than being slightly behind.
    const newestRef = useRef(null)
    useEffect(() => {
        const newest = items[0]?.id
        if (!newest || newest === newestRef.current) return
        newestRef.current = newest
        if (!paused && railRef.current) railRef.current.scrollLeft = 0
    }, [items, paused])

    if (!items.length) {
        return (
            <div style={{ display: "flex", alignItems: "center", gap: 8,
                          padding: "3px 10px", font: "400 11px var(--mono)",
                          color: "var(--txt-4)" }}>
                <span style={{ width: 6, height: 6, borderRadius: 3,
                               background: "var(--txt-4)" }} />
                nothing in the last 6 hours
            </div>
        )
    }

    return (
        <div
            ref={railRef}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            style={{ display: "flex", alignItems: "center", gap: 14,
                     padding: "3px 10px", overflowX: "auto", overflowY: "hidden",
                     whiteSpace: "nowrap", scrollbarWidth: "none" }}
        >
            {/* A live dot, and the count behind it. The dot is the only
                thing on this strip that moves without news, and it earns
                it by being the one element that says the feed is up. */}
            <span style={{ display: "flex", alignItems: "center", gap: 6,
                           flexShrink: 0, font: "600 10px var(--mono)",
                           color: "var(--txt-3)", textTransform: "uppercase",
                           letterSpacing: ".06em" }}>
                <span className="live-dot" style={{
                    width: 6, height: 6, borderRadius: 3,
                    background: "var(--sev-high, #e8a33d)",
                }} />
                live · {items.length}
            </span>

            {items.map((i) => (
                <span key={i.id} title={i.sub || ""}
                      style={{ display: "flex", alignItems: "baseline", gap: 6,
                               flexShrink: 0, font: "400 11px var(--font)" }}>
                    <span style={{ width: 5, height: 5, borderRadius: 3,
                                   background: SEV_COLOR[i.sev] || SEV_COLOR.low,
                                   alignSelf: "center", flexShrink: 0 }} />
                    <span style={{ color: "var(--txt-4)", font: "400 10px var(--mono)" }}>
                        {KIND[i.kind]?.name || "Signal"}
                    </span>
                    <span style={{ color: "var(--txt-2)", maxWidth: 420,
                                   overflow: "hidden", textOverflow: "ellipsis" }}>
                        {i.title}
                    </span>
                    <span style={{ color: "var(--txt-4)", font: "400 10px var(--mono)" }}>
                        {ago(i.ts, now)}
                    </span>
                </span>
            ))}
        </div>
    )
}
