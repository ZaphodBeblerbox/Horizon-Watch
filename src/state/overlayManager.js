/**
 * overlayManager.js — one overlay at a time, governed centrally.
 *
 * PARALLAX spec §19. Panels stack because each opener only knows about
 * itself, so exclusivity has to be enforced in one place — never at the call
 * sites. Retrofitting it after six panels exist is what produced the
 * stacking bug in the first place, which is why the build order puts this
 * early rather than late.
 *
 * TRANSLATION NOTE. The spec enforces this with a MutationObserver watching
 * for an `open` class on persistent DOM (`.scrim, .scanpanel`). This app's
 * overlays are React-conditional — they mount and unmount rather than
 * toggling a class — so an observer would have nothing to watch and would
 * silently do nothing. The guarantee is therefore implemented as a registry
 * that overlays declare themselves to. Same behaviour, same single point of
 * control; different mechanism because the DOM model is different.
 *
 * Escape closes whatever is open, wherever it came from.
 */

let current = null                 // id of the overlay currently open
const listeners = new Set()        // (currentId) => void
const closers = new Map()          // id -> () => void, for side-effectful closes

function notify() {
    for (const fn of listeners) {
        try { fn(current) } catch { /* a bad listener must not wedge the rest */ }
    }
}

/**
 * Register an overlay's own close routine. Panels whose close has side
 * effects — restoring a collapsed rail, resetting a draw tool, clearing a
 * geometry — must run that routine rather than merely being hidden.
 */
export function registerOverlay(id, closeFn) {
    if (typeof closeFn === "function") closers.set(id, closeFn)
    return () => closers.delete(id)
}

export function getOpenOverlay() {
    return current
}

export function isOverlayOpen(id) {
    return current === id
}

/** Open `id`, closing whatever else was open first. */
export function openOverlay(id) {
    if (current === id) return
    const previous = current
    current = id
    if (previous && closers.has(previous)) {
        // The outgoing panel's own close runs so its side effects unwind.
        try { closers.get(previous)() } catch { /* never block the incoming open */ }
    }
    notify()
}

/** Close `id` (or whatever is open, if `id` is omitted). */
export function closeOverlay(id = null) {
    if (id !== null && current !== id) return
    const previous = current
    current = null
    if (previous && closers.has(previous)) {
        try { closers.get(previous)() } catch { /* ignore */ }
    }
    notify()
}

export function subscribeOverlay(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

// Escape closes whatever is open, wherever it came from. Registered once,
// not per panel, so a panel that forgets to handle Escape still obeys it.
if (typeof window !== "undefined" && !window.__plxOverlayEscBound) {
    window.__plxOverlayEscBound = true
    window.addEventListener("keydown", (ev) => {
        if (ev.key !== "Escape") return
        if (current === null) return
        // Let a focused text field keep Escape for its own use.
        const t = ev.target
        if (t && t.matches && t.matches("input, textarea, [contenteditable='true']")) return
        closeOverlay()
    })
}
