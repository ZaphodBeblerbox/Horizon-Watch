/**
 * sideWindows.js — one window on the right side at a time.
 *
 * The inspector, a spoken question's answer and the source reader all open
 * on the right of the map, and opening one over another left them stacked
 * (owner, 2026-10-10). Whichever opens last claims the side; every other
 * listener closes (or folds) itself.
 */
const EVT = "plx:side-claim"

export function claimSide(owner) {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { owner } }))
}

/** Call `yield_` when another window claims the side. Returns the unsubscribe. */
export function onSideClaim(owner, yield_) {
    const h = (e) => { if (e.detail?.owner !== owner) yield_(e.detail?.owner) }
    window.addEventListener(EVT, h)
    return () => window.removeEventListener(EVT, h)
}
