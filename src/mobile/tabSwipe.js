/**
 * tabSwipe.js — a horizontal swipe across the whole screen moves between the bottom tabs, like Instagram (owner,
 * 2026-10-24): Home ↔ Map ↔ Desk ↔ Messages ↔ More. On the map the screen is the map, and a horizontal pan moves it
 * (the body takes no touches there). A swipe that starts on something that scrolls or plays sideways (a strip, the
 * Desk's tab bar, a video, a field, a sheet, a small map) is left to it.
 */
import { attachDrag } from "./gesture.js"

/** The tab a swipe goes to: dir +1 is a swipe to the left (the next tab), -1 to the right. null at the edges. */
export function swipeTarget(nav, tab, dir) {
    const keys = nav.map(([k]) => k)
    let i = keys.indexOf(tab)
    if (i < 0) i = keys.length - 1                 // a screen under More
    const j = i + (dir > 0 ? 1 : -1)
    return j >= 0 && j < keys.length ? keys[j] : null
}

export const SWIPE_SKIP = "input, textarea, select, video, audio, .m2-hscroll, .m2-chips, .dk-tabs, .m2-sheet, .leaflet-container, [data-nodrag], [contenteditable]"

/** Swipe between tabs on `node`; getTab() is the current tab, go(tab) moves. The open pane follows the finger. */
export function attachTabSwipe(node, { nav, getTab, go }) {
    if (!node) return () => {}
    const pane = () => node.querySelector(":scope > .m2-pane")
    return attachDrag(node, {
        start: (t) => !t.closest?.(SWIPE_SKIP),
        move: ({ dx, axis }) => {
            if (axis !== "x") return false
            const p = pane()
            const edge = !swipeTarget(nav, getTab(), dx < 0 ? 1 : -1)
            if (p) { p.style.transition = ""; p.style.transform = `translateX(${dx * (edge ? 0.12 : 0.4)}px)` }
            return true
        },
        end: ({ dx, vx, axis, moved }) => {
            const p = pane()
            if (p) { p.style.transition = "transform .3s cubic-bezier(.22,1,.36,1)"; p.style.transform = "" }
            if (!moved || axis !== "x") return
            if (!(Math.abs(dx) > 80 || Math.abs(vx) > 0.5)) return
            const to = swipeTarget(nav, getTab(), dx < 0 ? 1 : -1)
            if (to) go(to)
        },
    })
}
