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
import { itemStatusLabel } from "../../globe/protests.js"

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
    const t = s.published_at || s.posted_at || s.created_at || s.time || null
    // an announced protest says where it stands ("Ongoing · since 14:00"), never "14 h ago"
    const status = itemStatusLabel(s) || s.status_label || null
    const title = s.headline || s.title || "Signal"
    const host = document.querySelector(".m2") || document.body
    return createPortal(
        <div ref={el} className={`m2-peek ${enter}`} role="dialog" aria-label={title} data-testid="m2-peek">
            <div className="m2-peek-grip" />
            <div className="m2-peek-meta">
                {sev && <i style={{ background: sevColor(sev) }} />}
                <span data-testid="m2-peek-when">{[kindOf(s), status || (t ? ago(t) : null)].filter(Boolean).join(" · ")}</span>
            </div>
            <h3>{title}</h3>
            {place && place !== title && <div className="m2-peek-place">{String(place).split(",").slice(0, 3).join(",")}</div>}
            <div className="m2-peek-acts">
                <button className="m2-btn" onClick={() => onDetails?.()} data-testid="m2-peek-details">Details</button>
                <button className="m2-btn ghost" aria-label="Put away" onClick={() => onClose?.()}>Close</button>
                {count > 1 && index != null && <span className="m2-peek-count" aria-label={`${index + 1} of ${count} in view; swipe for the next`}>{index + 1} / {count}</span>}
            </div>
        </div>, host)
}
