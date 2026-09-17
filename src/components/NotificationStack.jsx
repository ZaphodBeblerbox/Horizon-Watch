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
import { subscribeNotifications, getNotifications, dismissCard, KIND } from "../state/notificationStore.js"

function zulu(ts) {
    const d = new Date(ts)
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`
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
                    {n.ref && onOpen && (
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

export default function NotificationStack({ onOpen = null, onAcknowledge = null, onBasket = null }) {
    const [cards, setCards] = useState(() => getNotifications().cards)
    useEffect(() => subscribeNotifications((s) => setCards(s.cards)), [])

    return (
        <div id="notifstack" aria-live="polite">
            {cards.map((n) => (
                <Card key={n.id} n={n} onOpen={onOpen} onAcknowledge={onAcknowledge} onBasket={onBasket} />
            ))}
        </div>
    )
}
