/**
 * EventInline.jsx — a Home item opens INSIDE Home (owner, 2026-10-24: "not a separate window or modal on top; it
 * expands or slides open inside the Home screen, pushing content"). The container only: what it holds is the event
 * detail (EventDetail.jsx on the desktop, the signal sheet's content on the phone). It slides open where it was
 * tapped, brings itself into view, and closes with its own button or Escape.
 */
import { useEffect, useRef } from "react"
import TelegramMedia from "../components/TelegramMedia.jsx"
import API_BASE from "../apiBase.js"
import "./events.css"

export function InlineMedia({ item }) {
    const it = item || {}
    if (!it.channel || !(it.media === "video" || it.media === "photo" || it.thumb_url)) return null
    const thumb = it.thumb_url && !/^https?:/.test(it.thumb_url) ? `${API_BASE}${it.thumb_url}` : it.thumb_url
    return <div className="ev-inline-media"><TelegramMedia post={{ ...it, thumb_url: thumb }} maxHeight="420px" radius="0" /></div>
}

export default function EventInline({ variant = "desk", label, onClose, children }) {
    const ref = useRef(null)
    useEffect(() => {
        const t = setTimeout(() => ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 120)
        const k = (e) => { if (e.key === "Escape") onClose?.() }
        window.addEventListener("keydown", k)
        return () => { clearTimeout(t); window.removeEventListener("keydown", k) }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
    return (
        <section ref={ref} className={`ev-inline ev-inline-${variant}`} data-testid="home-inline-detail" aria-label={label || "Details"}>
            <div className="ev-inline-in">
                <button type="button" className="ev-inline-x" aria-label="Close" data-testid="home-inline-close" onClick={onClose}>Close</button>
                {children}
            </div>
        </section>
    )
}
