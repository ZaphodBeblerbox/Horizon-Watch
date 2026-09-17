/**
 * archiveState.js — the live mirror of the §11 time strip's own state, so a
 * saved view can carry §16's `geoc: {face, at, win, mode, cats}`.
 *
 * Same idiom as situationFilterState.js next door: the real values live in
 * TimeStrip's useState and stay there; this module is only what external code
 * reads from, plus the restore channel back. A session save must never have to
 * reach into a component, and a component must never have to know a session
 * exists.
 */

let current = null
const listeners = new Set()

export function publishArchiveState(state) {
    current = state
    listeners.forEach((fn) => { try { fn(current) } catch { /* one bad listener must not wedge the rest */ } })
}

export function getArchiveState() { return current }

export function subscribeArchiveState(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

/**
 * Ask the strip to adopt a saved position. Fired as an event rather than
 * written here, because the strip owns its own state — writing `current`
 * directly would leave the mirror and the component disagreeing until the
 * strip's next publish.
 */
export function restoreArchiveState(state) {
    if (!state) return
    window.dispatchEvent(new CustomEvent("akili:apply-archive-state", { detail: state }))
}
