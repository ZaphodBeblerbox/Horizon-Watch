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

/**
 * PULL TO REFRESH, as on X (owner, 2026-10-17): at the top of a list, the
 * content follows the finger down with growing resistance and a ring turns
 * with the pull; past the threshold it holds open, spins while `onRefresh()`
 * runs, and springs back when it settles. Returns the detach function.
 *
 * `onPull({dy, vy})`, when given, may claim a long, strong pull for itself
 * (Home: thrown down far enough, the screen slides away to the map) by
 * returning true.
 */
export function attachPullToRefresh(node, { onRefresh, threshold = 70, onPull = null }) {
    if (!node) return () => {}
    const ring = document.createElement("div")
    ring.className = "m2-ptr"
    ring.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="44 100"/></svg>'
    const host = node.parentElement || node
    host.appendChild(ring)
    let busy = false
    const damp = (dy) => (dy <= 0 ? 0 : threshold * 1.6 * (1 - Math.exp(-dy / (threshold * 1.6))))   // rubber band
    const show = (d, spin = false) => {
        node.style.transform = d ? `translateY(${d}px)` : ""
        ring.style.opacity = String(Math.min(1, d / threshold))
        ring.style.transform = `translate(-50%, ${Math.min(d, threshold) - 30}px) rotate(${d * 4}deg)`
        ring.classList.toggle("spin", spin)
    }
    const off = attachDrag(node, {
        start: (t) => !busy && node.scrollTop <= 0 && !t.closest?.("input, textarea, video, [data-nodrag]"),
        move: ({ dy, axis }) => {
            if (axis !== "y" || dy <= 0 || node.scrollTop > 0) return false
            node.style.transition = ""
            ring.style.transition = ""
            show(damp(dy))
            return true
        },
        end: async ({ dy, vy, axis, moved }) => {
            if (!moved || axis !== "y") return
            const settle = () => {
                node.style.transition = "transform .38s cubic-bezier(.22,1,.36,1)"
                ring.style.transition = "transform .38s cubic-bezier(.22,1,.36,1), opacity .25s ease"
                show(0)
            }
            if (onPull && onPull({ dy, vy })) { settle(); return }
            if (damp(dy) < threshold) { settle(); return }
            busy = true
            node.style.transition = "transform .25s cubic-bezier(.22,1,.36,1)"
            show(threshold * 0.8, true)
            try { await onRefresh?.() } catch { /* the list says what failed */ }
            await new Promise((r) => setTimeout(r, 350))
            busy = false
            settle()
        },
    })
    return () => { off(); ring.remove() }
}
