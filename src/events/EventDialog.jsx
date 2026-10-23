/**
 * EventDialog.jsx — the desktop's event detail over the page (Home's "Developing in your areas", "Most urgent for
 * you", "Following"): a glass panel at the right, Escape or a click outside closes it. Nothing navigates away
 * (owner, 2026-10-23: a Home item opened Assets instead of itself).
 */
import { useEffect } from "react"
import { createPortal } from "react-dom"
import EventDetail from "./EventDetail.jsx"
import "./events.css"

export default function EventDialog({ item, onClose, onShowOnMap, onOpenItem }) {
    useEffect(() => {
        const k = (e) => { if (e.key === "Escape") onClose?.() }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [onClose])
    if (!item || typeof document === "undefined") return null
    return createPortal(
        <div className="ev-dialog-back" onClick={onClose} data-testid="event-dialog">
            <div role="dialog" aria-label={item.headline || item.title || "Event"} className="ev-dialog" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="ev-dialog-x" aria-label="Close" onClick={onClose}>×</button>
                <EventDetail key={item.event_id || item.id || item.title} item={item} variant="desk" onShowOnMap={onShowOnMap} onOpenItem={onOpenItem} />
            </div>
        </div>, document.body)
}
