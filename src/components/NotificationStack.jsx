/**
 * NotificationStack.jsx — the on-screen cards (PARALLAX spec §5.3).
 *
 * Only notifications that earn interruption reach here; the store decides
 * that, not this component. Severity is the 7px rotated diamond — the same
 * one the map and the inbox use, so there is one severity vocabulary across
 * three surfaces. There is deliberately NO coloured rail down the card
 * edge: an earlier build had a 3px full-height severity bar, and it read as
 * an error state on every card regardless of severity while duplicating
 * what the diamond already said.
 *
 * Anchoring lives in CSS (#notifstack): the map channel, clearing --pane-r
 * horizontally and --strip-h vertically.
 */

import { useEffect, useState } from "react"
import { subscribeNotifications, getNotifications, dismissCard, useDnd, KIND } from "../state/notificationStore.js"

function zulu(ts) {
    const d = new Date(ts)
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`
}

/** Fly there and open the alert — for an imagery signal, its image. */
function investigate(n) {
    window.dispatchEvent(new CustomEvent("akili:open-map"))
    if (n.ref) window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: n.ref.lat, lon: n.ref.lon, altitude: 20_000 } }))
    window.dispatchEvent(new CustomEvent("akili:open-inspector", { detail: {
        entityType: "alert", entityId: n.alertId || n.id,
        data: { alert_id: n.alertId || n.id, id: n.alertId || n.id, source: n.actions?.includes("image") ? "SAT-TASK" : "FIRMS",
                title: n.title, lat: n.ref?.lat, lon: n.ref?.lon },
    } }))
}

/** Task a satellite pass: a 6 km area around the heat, first pass now. */
async function scanHere(n) {
    const { squareAround } = await import("../insight/respond.js")
    const { toast } = await import("../ui/toast.js")
    const API_BASE = (await import("../apiBase.js")).default
    const name = (n.title || "Heat").replace(/^New heat (at|[\d.]+ km from) /, "").replace(/\s*\(.*$/, "").slice(0, 60)
    try {
        const r = await fetch(`${API_BASE}/api/watch-zones`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `Heat · ${name}`, polygon_geojson: squareAround(n.ref.lat, n.ref.lon, 3),
                                   scan_interval_hours: 24, priority: "high", alert_threshold: "medium" }),
        })
        const z = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(z.detail || `HTTP ${r.status}`)
        toast(`Scanning ${name} — the first optical and radar pass is on its way`, { icon: "i-check" })
        window.dispatchEvent(new CustomEvent("akili:imagery-open-scene", { detail: { systemId: z.system_id } }))
    } catch (e) { toast(`Could not task a pass — ${e.message}`, { icon: "i-alert" }) }
}

function Card({ n, onOpen, onAcknowledge, onBasket }) {
    const [shown, setShown] = useState(false)
    useEffect(() => {
        const r = requestAnimationFrame(() => setShown(true))
        return () => cancelAnimationFrame(r)
    }, [])

    const kind = KIND[n.kind] || KIND.signal
    return (
        <div className={`ncard${shown ? " in" : ""}`} role="status">
            <div className="nc-body">
                <div className="nc-head">
                    <i className={`dia ${n.sev}`} />
                    <svg><use href={`#${kind.icon}`} /></svg>
                    <span className="k">{kind.name}</span>
                    <span className="t">{zulu(n.ts)}</span>
                    <button
                        className="nc-x"
                        title="Dismiss — it stays in the tray"
                        aria-label="Dismiss"
                        onClick={() => dismissCard(n.id)}
                    >×</button>
                </div>
                <b>{n.title}</b>
                {n.sub && <span className="s">{n.sub}</span>}
                <div className="nc-acts">
                    {n.actions?.includes("investigate") && n.ref && (
                        <button className="btn sm primary" onClick={() => { investigate(n); dismissCard(n.id) }}>Investigate</button>
                    )}
                    {n.actions?.includes("scan") && n.ref && (
                        <button className="btn sm" onClick={() => { scanHere(n); dismissCard(n.id) }}>Scan</button>
                    )}
                    {n.actions?.includes("image") && (
                        <button className="btn sm primary" onClick={() => { investigate(n); dismissCard(n.id) }}>Show the image</button>
                    )}
                    {!n.actions && n.ref && onOpen && (
                        <button className="btn sm primary" onClick={() => { onOpen(n); dismissCard(n.id) }}>open</button>
                    )}
                    {onAcknowledge && (
                        <button className="btn sm" onClick={() => { onAcknowledge(n); dismissCard(n.id) }}>acknowledge</button>
                    )}
                    {n.ref && onBasket && (
                        <button className="btn sm" onClick={() => { onBasket(n); dismissCard(n.id) }}>to basket</button>
                    )}
                </div>
            </div>
        </div>
    )
}

/**
 * ONE CARD AT A TIME, IN ARRIVAL ORDER.
 *
 * The stack used to render every pending card at once, so a burst — which
 * is exactly what a busy feed produces — arrived as a wall that covered the
 * work underneath and had to be cleared before anything could be read. A
 * queue shows the oldest card, waits, retires it and shows the next, so the
 * things that happened separately are seen separately.
 *
 * SHOWN is held locally rather than read straight from the store on every
 * publish: re-rendering the visible card whenever a later one arrives
 * restarts its dwell timer, and a steady trickle would pin one card on
 * screen indefinitely.
 */
const DWELL_MS = 6200

export default function NotificationStack({ onOpen = null, onAcknowledge = null, onBasket = null }) {
    const [queue, setQueue] = useState(() => getNotifications().cards)
    const [shown, setShown] = useState(null)
    const [leaving, setLeaving] = useState(false)
    const dnd = useDnd()

    useEffect(() => subscribeNotifications((st) => setQueue(st.cards)), [])

    // Promote the next card once nothing is showing.
    useEffect(() => {
        if (shown || !queue.length) return
        const next = queue[queue.length - 1]     // store prepends; oldest last
        setShown(next); setLeaving(false)
    }, [queue, shown])

    // Retire it after its dwell. A critical card stays: it is the one the
    // reader must actually act on, and a timeout would quietly discard it.
    useEffect(() => {
        if (!shown || shown.severity === "critical") return
        const t = setTimeout(() => setLeaving(true), DWELL_MS)
        return () => clearTimeout(t)
    }, [shown])

    useEffect(() => {
        if (!leaving) return
        const t = setTimeout(() => {
            if (shown?.id) dismissCard(shown.id)
            setShown(null); setLeaving(false)
        }, 220)                                   // matches the exit transition
        return () => clearTimeout(t)
    }, [leaving, shown])

    // Do not disturb: everything still lands in the tray and the bell still
    // counts. Silencing the cards must not silence the record, or the
    // feature becomes "lose alerts quietly".
    if (dnd) return null
    if (!shown) return <div id="notifstack" aria-live="polite" />

    return (
        <div id="notifstack" aria-live="polite">
            <div className={`ncard-slot${leaving ? " leaving" : ""}`}>
                <Card n={shown} onOpen={onOpen} onAcknowledge={onAcknowledge} onBasket={onBasket} />
            </div>
            {queue.length > 1 && (
                <div className="nqueue" aria-hidden="true">
                    {queue.length - 1} more waiting
                </div>
            )}
        </div>
    )
}
