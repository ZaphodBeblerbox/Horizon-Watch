/**
 * MNotifCards.jsx — the phone's own notifications, inside the app.
 *
 * With Parallax open, the system notification is held back (the server
 * skips a device that is on screen, notify/pushPresence.js) and the same
 * card shows here instead (owner, 2026-10-10): the store's on-screen cards
 * (state/notificationStore.js — what interrupts, sounds and DND included),
 * dropped in from the top like a phone banner. Tap to open it, swipe it up
 * or tap × to put it away; it stays in Alerts either way.
 */
import { useEffect, useRef, useState } from "react"
import { subscribeNotifications, getNotifications, dismissCard, useDnd, KIND } from "../../state/notificationStore.js"

const SEV = { critical: "#E5484D", high: "#F5A524", moderate: "#8FB4E8", low: "#9AA9BC" }

// a message for you and a new post on your desk show as banners too, as in
// every messenger (owner, 2026-10-19) — the store already holds them back
// while that conversation, or the desk, is on screen
const URGENT_KINDS = new Set(["warning", "live", "message", "desk"])
export const isUrgent = (n) => n?.sev === "critical" || URGENT_KINDS.has(n?.kind)
const TOAST_MS = 6000

function Banner({ n, onOpen }) {
    const y0 = useRef(null)
    const [dy, setDy] = useState(0)
    const [leaving, setLeaving] = useState(false)
    const close = () => { setLeaving(true); setTimeout(() => dismissCard(n.id), 320) }
    // it fades away by itself unless a finger is on it
    useEffect(() => {
        if (dy) return undefined
        const t = setTimeout(close, TOAST_MS)
        return () => clearTimeout(t)
    }, [dy]) // eslint-disable-line react-hooks/exhaustive-deps
    return (
        <div className={`m2-banner${leaving ? " leaving" : ""}`} role="alert" data-testid="m2-banner" data-kind={n.kind} style={{ transform: dy < 0 ? `translateY(${dy}px)` : undefined }}
             onTouchStart={(e) => { y0.current = e.touches[0].clientY }}
             onTouchMove={(e) => { if (y0.current != null) setDy(Math.min(0, e.touches[0].clientY - y0.current)) }}
             onTouchEnd={() => { if (dy < -40) close(); setDy(0); y0.current = null }}>
            <button className="m2-banner-body" onClick={() => { close(); onOpen?.(n) }}>
                <i style={{ background: SEV[n.sev] || SEV.moderate }} />
                <span style={{ minWidth: 0 }}>
                    <small>{KIND[n.kind]?.name || "Signal"}</small>
                    <b>{n.title}</b>
                    {n.sub && <span className="m2-sub">{n.sub}</span>}
                </span>
            </button>
            <button className="m2-banner-x" aria-label="Put away" onClick={close}>×</button>
        </div>
    )
}

export default function MNotifCards({ onOpen }) {
    const [cards, setCards] = useState(() => getNotifications().cards)
    useDnd()                                      // DND mutes cards in the store
    useEffect(() => subscribeNotifications((s) => setCards(s.cards)), [])
    const urgent = cards.filter(isUrgent)
    // what is not urgent leaves the screen at once (it is in Alerts)
    useEffect(() => { for (const n of cards) if (!isUrgent(n)) dismissCard(n.id) }, [cards])
    if (!urgent.length) return null
    return (
        <div className="m2-banners">
            {urgent.slice(-2).reverse().map((n) => <Banner key={n.id} n={n} onOpen={onOpen} />)}
        </div>
    )
}
