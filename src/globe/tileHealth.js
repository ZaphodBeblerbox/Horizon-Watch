/**
 * tileHealth.js — a basemap that fails should say so.
 *
 * WHY. When a tile provider stops answering, Cesium does not report it
 * anywhere a person can see: it retries a few times, gives up, and
 * leaves the globe showing whatever it last had — or nothing. "Tiles
 * don't load at high zoom" is exactly that shape of report, and it is
 * impossible to act on because every cause looks identical from the
 * outside: the provider is down, the zoom is past its deepest level,
 * the network is gone, or our own tile proxy is timing out.
 *
 * So errors are counted per provider and summarised. Rule 5 in this
 * codebase's spec is that an empty pane explains itself; a blank
 * basemap is the largest empty pane in the product.
 *
 * COUNTED IN A WINDOW, NOT FOREVER. A handful of failures while panning
 * fast is normal and self-correcting. A provider is only called
 * unhealthy when it keeps failing, so the readout does not cry wolf at
 * the first dropped tile.
 */

export const WINDOW_MS = 30_000
export const UNHEALTHY_ERRORS = 8

/** Errors newer than the window. */
export function recent(errors, nowMs = Date.now()) {
    return (errors || []).filter((t) => nowMs - t < WINDOW_MS)
}

/**
 * A short readout for one provider, or null when it is fine.
 *
 * `maxLevel` is passed so the message can distinguish "this provider is
 * broken" from "you are below the deepest level it publishes", which
 * are completely different problems and were indistinguishable.
 */
export function health(name, errors, { nowMs = Date.now(), level = null,
                                       maxLevel = null } = {}) {
    const n = recent(errors, nowMs).length
    if (n === 0) return null
    if (maxLevel != null && level != null && level > maxLevel) {
        return {
            state: "depth",
            text: `${name}: no tiles published below zoom ${maxLevel} — `
                + "the view is being upsampled, not broken",
        }
    }
    if (n >= UNHEALTHY_ERRORS) {
        return { state: "error", text: `${name}: ${n} tile errors in the last 30s` }
    }
    return { state: "flaky", text: `${name}: ${n} tile${n === 1 ? "" : "s"} failed` }
}

/**
 * Attach a counter to a Cesium imagery provider's errorEvent.
 *
 * Returns an unsubscribe function. Defensive about the provider not
 * having an errorEvent: Cesium's provider shapes differ by version and
 * a throw here would take the basemap swap down with it, which would
 * be a worse bug than the invisible one being fixed.
 */
export function watchProvider(provider, onError) {
    try {
        const ev = provider?.errorEvent
        if (!ev || typeof ev.addEventListener !== "function") return () => {}
        const handler = () => { try { onError() } catch { /* never throw here */ } }
        ev.addEventListener(handler)
        return () => { try { ev.removeEventListener(handler) } catch { /* gone */ } }
    } catch {
        return () => {}
    }
}
