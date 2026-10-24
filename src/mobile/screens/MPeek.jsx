/**
 * MPeek.jsx — a point on the map, as a small glass card over it (owner,
 * 2026-10-17, after Benji Taylor's trays: "it should not cover the entire
 * map and should only cover a small portion; the map should still be
 * visible; if I scroll up or down that little window should close").
 *
 *   swipe left / right   the next / previous signal in view (west to east,
 *                        the way the map reads), the card leaving the way
 *                        the finger threw it and the next arriving from the
 *                        other side
 *   swipe up / Details   the full details (the signal's sheet)
 *   swipe down           put away
 *   the map moving       put away (MMap, and "m2:map-gesture" for a card
 *                        opened from a notification)
 *
 * The card follows the finger and finishes at the speed it was let go.
 */
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { attachDrag, flingMs, swallowClickAfterDrag } from "../gesture.js"
import { ago, sevColor } from "./common.jsx"
import { itemStatusLabel, mediaItems } from "../../globe/protests.js"
import { ageLabel } from "../../lib/liveIncident.js"
import ReportMedia from "../../components/ReportMedia.jsx"
import WritePostButton from "../../assistant/WritePostButton.jsx"
import ReportCard from "../../fieldReports/ReportCard.jsx"
import { stripEmoji } from "../../lib/liveSignals.js"
import WebContext from "../../components/WebContext.jsx"
import { StatusChip } from "../../events/EventDetail.jsx"
import { clock } from "../../events/eventLogic.js"

const arr = (v) => (Array.isArray(v) ? v : [])
const kindOf = (s) => s?.source || s?.channel_title || s?.layerLabel || s?.alert_type || s?.kind_label || "Signal"

export default function MPeek({ s, onClose, onDetails, onStep, index = null, count = null, returning = false }) {
    const el = useRef(null)
    const [enter, setEnter] = useState(returning ? "rest" : "up")   // "up" (from below) | "from-r" | "from-l" | "rest"
    const cb = useRef({})
    cb.current = { onClose, onDetails, onStep }
    useEffect(() => {
        const node = el.current
        if (!node) return undefined
        const settle = (to, ms, then) => {
            node.style.transition = `transform ${ms}ms cubic-bezier(.2,.75,.3,1), opacity ${ms}ms ease`
            node.style.transform = to
            if (then) setTimeout(then, ms)
            else setTimeout(() => { node.style.transition = "" }, ms + 20)
        }
        const off = attachDrag(node, {
            start: () => true,
            move: ({ dx, dy, axis }) => {
                node.style.transition = ""
                if (axis === "x") node.style.transform = `translateX(${cb.current.onStep ? dx : dx * 0.2}px) rotate(${dx / 60}deg)`
                else node.style.transform = `translateY(${dy > 0 ? dy : dy * 0.35}px)`
                node.__dragged = true
                return true
            },
            end: ({ dx, dy, vx, vy, axis, moved }) => {
                if (!moved) return
                const w = node.getBoundingClientRect().width, h = node.getBoundingClientRect().height
                if (axis === "x" && cb.current.onStep && (Math.abs(dx) > w * 0.28 || Math.abs(vx) > 0.5)) {
                    const dir = dx < 0 ? 1 : -1                       // thrown left: the next one, to the east
                    if (cb.current.onStep(dir, true)) {
                        settle(`translateX(${dx < 0 ? -w - 40 : w + 40}px)`, flingMs(w - Math.abs(dx), vx), () => {
                            node.style.transition = ""; node.style.transform = ""
                            setEnter(dir > 0 ? "from-r" : "from-l")
                            cb.current.onStep(dir)
                        })
                        return
                    }
                }
                if (axis === "y" && (dy < -40 || vy < -0.5)) { settle("", 200); cb.current.onDetails?.(); return }
                if (axis === "y" && (dy > h * 0.35 || vy > 0.5)) {
                    settle(`translateY(${h + 60}px)`, flingMs(h - dy, vy), () => cb.current.onClose?.())
                    return
                }
                settle("", 320)
            },
        })
        const offClick = swallowClickAfterDrag(node)
        return () => { off(); offClick() }
    }, [])
    // a new card, after a swipe: arrives from the side it was thrown towards
    useEffect(() => {
        if (enter === "rest") return undefined
        const t = setTimeout(() => setEnter("rest"), 450)
        return () => clearTimeout(t)
    }, [enter, s?._key])
    // where the card is, for a sheet to grow out of and shrink back into (common.jsx Sheet)
    useEffect(() => {
        const node = el.current
        if (!node) return undefined
        const save = () => { const r = node.getBoundingClientRect(); if (r.height) window.__m2PeekRect = { left: r.left, top: r.top, width: r.width, height: r.height } }
        const t = setTimeout(save, 460)
        save()
        return () => clearTimeout(t)
    })
    if (!s) return null
    const sev = s.severity_tier || s.sev || s.severity
    const place = s.location || s.place || s.region || s.location_name || null
    const t = s.event_time || s.published_at || s.posted_at || s.created_at || s.time || null
    // an announced protest says where it stands ("Ongoing · since 14:00"), never "14 h ago";
    // a signal whose EVENT time the server established says "Live · 12 min ago" or "Happened 3 h ago"
    // (the event's age, not the post's: lib/liveIncident.js)
    const status = itemStatusLabel(s) || (s.event_time ? ageLabel(s) : null) || s.status_label || null
    const title = stripEmoji(s.headline || s.title || "Signal")
    const host = document.querySelector(".m2") || document.body
    // A LIVE SIGNAL'S CARD (owner, 2026-10-22): the act and the place in one plain sentence, one source line
    // with its age, other acts of the same event as short lines, the attached footage as the card's media.
    // A cluster of signals opens as a list. Nothing else: no "footage from", no channel list, no post text.
    // A USER REPORT (owner, 2026-10-24): who, when, unverified, the expiry, the note and media, End now for its author
    if (s.kind === "field_report") {
        return createPortal(
            <div ref={el} className={`m2-peek ${enter}`} role="dialog" aria-label={title} data-testid="m2-peek">
                <div className="m2-peek-grip" />
                <ReportCard r={s} compact onDone={() => { window.dispatchEvent(new CustomEvent("m2:layers", { detail: { userReports: true } })); onClose?.() }} />
                <div className="m2-peek-acts">
                    <button className="m2-btn ghost" aria-label="Put away" onClick={() => onClose?.()}>Close</button>
                    {count > 1 && index != null && <span className="m2-peek-count">{index + 1} / {count}</span>}
                </div>
            </div>, host)
    }
    if (s.kind === "live_signal" || s.kind === "live_cluster") {
        const cl = s.kind === "live_cluster"
        return createPortal(
            <div ref={el} className={`m2-peek ${enter}`} role="dialog" aria-label={title} data-testid="m2-peek">
                <div className="m2-peek-grip" />
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 data-testid="m2-peek-title">{title}</h3>
                        {!cl && <div className="m2-peek-place" data-testid="m2-peek-line">{stripEmoji(s.status_label || "")}</div>}
                        {!cl && arr(s.card_lines).map((t, i) => <div key={i} className="m2-peek-place">{stripEmoji(t)}</div>)}
                        {cl && arr(s.cluster).map((c, i) => <div key={i} className="m2-peek-place" data-testid="m2-peek-item">{stripEmoji(c.title)}{c.line ? `. ${stripEmoji(c.line)}` : ""}</div>)}
                        {!cl && <WebContext item={s} compact />}
                        {/* its event: status and the evolving brief, one line (events.py) */}
                        {!cl && s.event && (
                            <div className="m2-peek-place" data-testid="m2-peek-brief" style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                                <StatusChip status={s.event.status} />
                                <span>{[s.event.brief?.version > 1 ? `Updated ${clock(s.event.brief.created_at)} · v${s.event.brief.version}` : null,
                                        s.event.brief?.what_changed].filter(Boolean).join(" · ")}</span>
                            </div>
                        )}
                    </div>
                    {!cl && arr(s.sources).length > 0 && <ReportMedia item={{ sources: s.sources }} compact />}
                </div>
                <div className="m2-peek-acts">
                    {!cl && <button className="m2-btn" onClick={() => onDetails?.()} data-testid="m2-peek-details">Details</button>}
                    <button className="m2-btn ghost" aria-label="Put away" onClick={() => onClose?.()}>Close</button>
                    {count > 1 && index != null && <span className="m2-peek-count">{index + 1} / {count}</span>}
                </div>
            </div>, host)
    }
    return createPortal(
        <div ref={el} className={`m2-peek ${enter}`} role="dialog" aria-label={title} data-testid="m2-peek">
            <div className="m2-peek-grip" />
            <div className="m2-peek-meta">
                {sev && <i style={{ background: sevColor(sev) }} />}
                <span data-testid="m2-peek-when">{[kindOf(s), status || (t ? ago(t) : null)].filter(Boolean).join(" · ")}</span>
            </div>
            {/* FOOTAGE ON THE CARD (owner, 2026-10-19: "when I click on it, I want the actual footage"):
                a thumbnail beside the words, a tap plays it full screen */}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h3>{title}</h3>
                    {place && place !== title && <div className="m2-peek-place">{String(place).split(",").slice(0, 3).join(",")}</div>}
                </div>
                <ReportMedia item={s.kind === "protest" ? { sources: mediaItems(s).map((m) => ({ ...m, media: m.type, channel_title: m.chat })) } : s} compact />
            </div>
            <div className="m2-peek-acts">
                <button className="m2-btn" onClick={() => onDetails?.()} data-testid="m2-peek-details">Details</button>
                <WritePostButton item={s} phone />
                <button className="m2-btn ghost" aria-label="Put away" onClick={() => onClose?.()}>Close</button>
                {count > 1 && index != null && <span className="m2-peek-count" aria-label={`${index + 1} of ${count} in view; swipe for the next`}>{index + 1} / {count}</span>}
            </div>
        </div>, host)
}
