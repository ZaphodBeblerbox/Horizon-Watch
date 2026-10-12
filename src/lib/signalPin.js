/**
 * signalPin.js — the signal a notification opened, drawn on the map as its
 * own highlighted marker (owner, 2026-10-12: "sent to the specific signal AND
 * the specific location on the map, with the actual signal displayed").
 *
 * One store, two maps: the desktop globe (globe/GlobeFindingsLayer.jsx) and
 * the phone map (mobile/findingsLeaflet.js) subscribe. A vessel of concern
 * and an imagery finding are drawn by their own layers; this is for every
 * other signal with a place (a Telegram or GeoConfirmed post, a place under
 * threat, any alert with a point).
 *
 * closeOpenedSignal() is what closing the signal's sheet / inspector calls:
 * the marker goes, and so do the finding boxes and the scene under them when
 * they were opened for that same signal.
 */
import { clearFindings, getShownFindings } from "./findings.js"

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v)
let pin = null
const subs = new Set()

function emit() {
    if (typeof window !== "undefined") window.__plxSignalPin = pin
    for (const fn of [...subs]) { try { fn(pin) } catch { /* one map failing must not stop the other */ } }
}

/** Put a signal's marker on the maps ({id, alertId, lat, lon, title, sev, kind}); null clears. */
export function showSignalPin(p) {
    const lat = num(p?.lat), lon = num(p?.lon)
    pin = p && lat !== null && lon !== null ? { ...p, lat, lon, at: Date.now() } : null
    emit()
    return pin
}
export const getSignalPin = () => pin
export function subscribeSignalPin(fn) {
    subs.add(fn)
    return () => subs.delete(fn)
}

const bare = (x) => String(x).replace(/^sig[:-]/, "")
/** `a` (one id, or several names of the same thing) is one of `ids`. */
const sameId = (a, ids) => (Array.isArray(a) ? a : [a]).some((y) => y != null && ids.some((x) => x != null && bare(x) === bare(y)))

/** Is `id` the signal on show (the marker or the findings)? With no id: anything on show. */
export function isOpenedSignal(id) {
    if (id == null) return !!(pin || getShownFindings())
    const f = getShownFindings()
    return sameId(id, [pin?.id, pin?.alertId]) || sameId(id, [f?.alertId])
}

/** The signal was closed: its marker, and its boxes and scene image when they
 *  were opened for it. With an id (or a list of the names it goes by), only
 *  when that is the signal on show. */
export function closeOpenedSignal(id = null) {
    const f = getShownFindings()
    if (pin && (id == null || sameId(id, [pin.id, pin.alertId]))) { pin = null; emit() }
    if (f && (id == null ? true : sameId(id, [f.alertId]))) clearFindings()
}
