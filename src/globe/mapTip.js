/**
 * mapTip.js — PARALLAX spec §6. ONE hover tooltip for the whole map.
 *
 * "One shared element for every layer — never per-layer tooltips."
 *
 * The rule is not tidiness. Per-layer tooltips each own their own visibility
 * state, so two layers under one cursor show two cards; they each re-derive
 * their own placement, so they disagree about which edge of the viewport to
 * flip at; and every new layer re-litigates the styling. This module is the
 * single slot, and `showTip` replacing whatever was there is what makes
 * "only one is ever visible" true by construction rather than by each
 * layer's good behaviour.
 *
 * Same plain pub/sub idiom as cameraState.js and mapReadout.js next door.
 *
 * CONTENT IS A REACT NODE, NOT AN HTML STRING  ← deviation from the spec
 * ---------------------------------------------------------------------
 * §6 and §A9 build tooltips as HTML strings and hand them to `M.tip(ev, html)`.
 * Rendering those here would mean dangerouslySetInnerHTML over content that
 * is substantially untrusted — vessel names, article headlines and
 * GeoConfirmed descriptions all come from feeds, and §A9's own entity list
 * interpolates `r.title` straight into the markup. A node costs nothing
 * extra, composes better with the rest of this app, and cannot inject.
 */

// { content, x, y } while a tip is up; null when nothing is hovered.
let tip = null
const listeners = new Set()

/**
 * Show the tooltip. `x`/`y` are CLIENT coordinates (what a DOM mouse event
 * and Cesium's ScreenSpaceEventHandler both give you, once the canvas offset
 * is accounted for by the caller).
 *
 * Calling it again with new coordinates while the same thing is hovered is
 * the normal case — it is a cheap state swap, not a remount.
 */
export function showTip(content, x, y) {
    if (content == null) return hideTip()
    tip = { content, x, y }
    listeners.forEach((fn) => fn(tip))
}

/** Hide it. Idempotent: layers call this on every mouseleave and on unmount. */
export function hideTip() {
    if (tip === null) return
    tip = null
    listeners.forEach((fn) => fn(tip))
}

export function getTip() { return tip }

export function subscribeTip(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

/**
 * The spec's placement, verbatim: `left = min(clientX + 14, innerWidth - 270)`
 * and `top = clientY + 14`.
 *
 * The lower bound on `left` and the upper bound on `top` are additions. The
 * spec's rule only keeps the card off the RIGHT edge; with a cursor near the
 * bottom of a short viewport the card runs off underneath, and near the left
 * edge on a narrow one the max() is what stops `innerWidth - 270` going
 * negative and pinning it off-screen.
 */
export function tipPosition(x, y, { width = 256, height = 120, vw, vh } = {}) {
    // vw/vh are injectable so the placement rules are testable without a DOM
    // — this app's vitest environment is "node", and a geometry rule that can
    // only be checked in a browser is a geometry rule nobody checks.
    if (vw == null) vw = typeof window !== "undefined" ? window.innerWidth : 1200
    if (vh == null) vh = typeof window !== "undefined" ? window.innerHeight : 800
    return {
        left: Math.max(8, Math.min(x + 14, vw - width - 14)),
        top: Math.max(8, Math.min(y + 14, vh - height - 14)),
    }
}
