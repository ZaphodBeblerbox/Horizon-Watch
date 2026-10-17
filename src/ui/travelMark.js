/**
 * travelMark.js — the selection mark that TRAVELS between tabs on the
 * desktop instead of jumping (2026-10-17).
 *
 * The owner, approving the phone's v4 redesign: "Implement our new design
 * language into the desktop version. We also need those smooth transitions,
 * animations and so on." On the phone one white mark slides under the tab
 * bar to the chosen tab ("we fly instead of teleport"); this is the same
 * idea for every tab row and segmented control on the desktop console.
 *
 * WHY A WATCHER AND NOT A COMPONENT. The desktop's tab rows are written
 * inline in a dozen screens, each with its own idea of "selected" (a fill,
 * an underline, aria-pressed). Rewriting each into a shared component is a
 * restructure; this is a visual pass. So a group opts in with one
 * attribute and the watcher does the rest:
 *
 *   <nav data-travel="fill|line">               a group of tabs
 *     <button data-travel-on={selected}>…       its items (direct children)
 *
 * The long-standing class groups (.seg, .scantabs, .ntfilt) opt in by
 * their class and mark their selection with aria-pressed already.
 *
 * The watcher only measures and writes four custom properties on the group
 * (--tm-x, --tm-y, --tm-w, --tm-h) and a data-tm state; the mark itself is
 * the group's ::before in styles/desktopV4.css. Nothing is inserted into a
 * React-owned tree, so React's reconciliation never meets a stranger.
 *
 * A group with more than one selected item (a multi-select chip row) is
 * left exactly as it was: a mark can only travel to one place.
 */

export const TRAVEL_GROUPS = "[data-travel], .seg, .scantabs, .ntfilt"
const OWN = ':scope > [data-travel-on="true"]'
const ARIA = ':scope > [aria-pressed="true"], :scope > [aria-selected="true"]'

function activeOf(group) {
    return group.querySelectorAll(group.hasAttribute("data-travel") ? OWN : ARIA)
}

/** Measure one group and move its mark. Exported for the tests. */
export function placeMark(group) {
    const on = activeOf(group)
    if (on.length > 1) {
        // multi-select: the group keeps its own per-item styling
        group.removeAttribute("data-tm")
        return
    }
    if (on.length === 0) {
        // Nothing chosen (Profile is open, say): the mark fades where it is,
        // so the next choice slides from there rather than from nowhere.
        if (group.hasAttribute("data-tm")) group.setAttribute("data-tm", "off")
        return
    }
    const el = on[0]
    const g = group.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    // Hidden (display:none pane, a closed tray): nothing to measure yet. The
    // ResizeObserver calls again when it is shown.
    if (!g.width || !r.width) return
    const x = r.left - g.left - group.clientLeft + group.scrollLeft
    const y = r.top - g.top - group.clientTop + group.scrollTop
    const first = !group.hasAttribute("data-tm")
    const s = group.style
    s.setProperty("--tm-x", `${Math.round(x * 10) / 10}px`)
    s.setProperty("--tm-y", `${Math.round(y * 10) / 10}px`)
    s.setProperty("--tm-w", `${Math.round(r.width * 10) / 10}px`)
    s.setProperty("--tm-h", `${Math.round(r.height * 10) / 10}px`)
    if (first) {
        // The first placement is not a move: a mark that flew in from the
        // corner on load would be motion with no meaning ("nothing animates
        // that is already on screen").
        group.setAttribute("data-tm-still", "")
        group.setAttribute("data-tm", "on")
        requestAnimationFrame(() => requestAnimationFrame(() => group.removeAttribute("data-tm-still")))
    } else if (group.getAttribute("data-tm") !== "on") {
        group.setAttribute("data-tm", "on")
    }
}

/**
 * Start watching the document. Returns the function that stops it. Safe to
 * call where there is no DOM (tests, SSR): it returns a no-op.
 */
export function installTravelMarks(root = typeof document !== "undefined" ? document.body : null) {
    if (!root || typeof MutationObserver === "undefined") return () => {}
    const seen = new WeakSet()
    const ro = typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => { for (const e of entries) placeMark(e.target) })
        : null
    let queued = 0
    const sweep = () => {
        queued = 0
        for (const g of root.querySelectorAll(TRAVEL_GROUPS)) {
            if (!seen.has(g)) { seen.add(g); ro?.observe(g) }
            placeMark(g)
        }
    }
    const schedule = () => { if (!queued) queued = requestAnimationFrame(sweep) }
    // Only mutations that can move a mark are worth a measurement: inside a
    // group, or adding one. The live feeds re-render constantly elsewhere.
    const touches = (records) => {
        for (const m of records) {
            const t = m.target.nodeType === 1 ? m.target : m.target.parentElement
            if (t?.closest?.(TRAVEL_GROUPS)) return true
            if (m.type === "childList") {
                for (const n of m.addedNodes) {
                    if (n.nodeType === 1 && (n.matches(TRAVEL_GROUPS) || n.querySelector(TRAVEL_GROUPS))) return true
                }
            }
        }
        return false
    }
    const mo = new MutationObserver((records) => { if (touches(records)) schedule() })
    mo.observe(root, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ["aria-pressed", "aria-selected", "data-travel-on"],
    })
    window.addEventListener("resize", schedule)
    schedule()
    return () => {
        mo.disconnect()
        ro?.disconnect()
        window.removeEventListener("resize", schedule)
        if (queued) cancelAnimationFrame(queued)
    }
}
