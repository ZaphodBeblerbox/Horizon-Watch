/**
 * gesture.js — one drag, glued to the finger, for the phone's sheets and
 * cards (Benji Taylor: "a dragged element remains glued to the finger and,
 * on release, continues with the exact velocity of the release").
 *
 * Native, non-passive touch listeners: React's are passive, and a passive
 * listener cannot keep the page from scrolling while a sheet is dragged.
 * The mouse works too, for the desktop browser checks.
 *
 *   start(target)            may this drag begin here? (false: the page's own)
 *   move({dx, dy, axis})     true while the drag is ours (the page then does
 *                            not scroll); `axis` is fixed once past 6 px
 *   end({dx, dy, vx, vy, axis, moved})   vx/vy in px/ms over the last ~80 ms
 */
const SLOP = 6

export function attachDrag(node, { start, move, end }) {
    if (!node) return () => {}
    let s = null
    const begin = (x, y, target) => {
        if (start && start(target) === false) { s = null; return }
        s = { x0: x, y0: y, axis: null, ours: false, moved: false, samples: [{ x, y, t: performance.now() }] }
    }
    const step = (x, y) => {
        if (!s) return false
        const dx = x - s.x0, dy = y - s.y0
        if (!s.axis) {
            if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return false
            s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y"
        }
        const t = performance.now()
        s.samples.push({ x, y, t })
        while (s.samples.length > 2 && t - s.samples[0].t > 80) s.samples.shift()
        const ours = move ? move({ dx, dy, axis: s.axis }) === true : false
        if (ours) { s.ours = true; s.moved = true }
        return ours
    }
    const finish = (x, y) => {
        if (!s) return
        const a = s.samples[0], b = { x, y, t: performance.now() }
        const dt = Math.max(1, b.t - a.t)
        const r = { dx: x - s.x0, dy: y - s.y0, vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt, axis: s.axis, moved: s.moved }
        s = null
        end?.(r)
    }
    let last = null
    const ts = (e) => { const p = e.touches[0]; last = p; begin(p.clientX, p.clientY, e.target) }
    const tm = (e) => { const p = e.touches[0]; last = p; if (step(p.clientX, p.clientY) && e.cancelable) e.preventDefault() }
    const te = () => { if (last) finish(last.clientX, last.clientY); last = null }
    const md = (e) => {
        if (e.button !== 0) return
        begin(e.clientX, e.clientY, e.target)
        const mm = (ev) => { if (step(ev.clientX, ev.clientY)) ev.preventDefault() }
        const mu = (ev) => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); finish(ev.clientX, ev.clientY) }
        window.addEventListener("mousemove", mm)
        window.addEventListener("mouseup", mu)
    }
    node.addEventListener("touchstart", ts, { passive: true })
    node.addEventListener("touchmove", tm, { passive: false })
    node.addEventListener("touchend", te)
    node.addEventListener("touchcancel", te)
    node.addEventListener("mousedown", md)
    return () => {
        node.removeEventListener("touchstart", ts)
        node.removeEventListener("touchmove", tm)
        node.removeEventListener("touchend", te)
        node.removeEventListener("touchcancel", te)
        node.removeEventListener("mousedown", md)
    }
}

/** How long the rest of a throw takes at the release speed, within reason. */
export const flingMs = (distance, v) => Math.max(140, Math.min(360, Math.abs(distance) / Math.max(0.6, Math.abs(v))))

/** Was this a tap rather than the end of a drag? A drag swallows its click. */
export function swallowClickAfterDrag(node) {
    const h = (e) => { if (node.__dragged) { e.stopPropagation(); e.preventDefault(); node.__dragged = false } }
    node.addEventListener("click", h, true)
    return () => node.removeEventListener("click", h, true)
}
