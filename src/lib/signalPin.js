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

/*
 * WHY IT "MOSTLY DID NOT APPEAR" (owner, 2026-10-24: "On the ground now: … demonstrating …" opened, and the
 * yellow triangle was there only now and then, with no toggle):
 *   - a map that subscribed AFTER the notification put the pin up (the globe's viewer still being made, the
 *     phone's map built behind another tab, a cold start from a push) was never told: subscribe now replays
 *     the pin on show;
 *   - the phone put the card away as the map flew there (a pan or a zoom closes the card, and a closed card
 *     took the pin with it): a passive close in the first PIN_GRACE_MS after the pin went up is ignored;
 *   - on the globe the pin sat at the same point as the signal's own marker and was drawn under it half the
 *     time: it is drawn in front (GlobeFindingsLayer).
 * Its own layer switch (phone Filters and the desktop layers panel): setSignalPinLayer.
 */
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v)
export const PIN_GRACE_MS = 6000
let pin = null
let layerOn = true
const subs = new Set()

const visible = () => (layerOn ? pin : null)

function emit() {
    if (typeof window !== "undefined") window.__plxSignalPin = pin
    const v = visible()
    for (const fn of [...subs]) { try { fn(v) } catch { /* one map failing must not stop the other */ } }
}

/** Put a signal's marker on the maps ({id, alertId, lat, lon, title, sev, kind}); null clears. */
export function showSignalPin(p) {
    const lat = num(p?.lat), lon = num(p?.lon)
    pin = p && lat !== null && lon !== null ? { ...p, lat, lon, at: Date.now() } : null
    emit()
    return pin
}
export const getSignalPin = () => pin
/** fn(the pin as drawn, or null): called now with what is on show, then on every change. */
export function subscribeSignalPin(fn) {
    subs.add(fn)
    const v = visible()
    if (v) { try { fn(v) } catch { /* the map is not ready: its next change will tell it */ } }
    return () => subs.delete(fn)
}
/** The layer's switch ("On the ground, opened"): off hides the marker, the pin itself is kept. */
export function setSignalPinLayer(on) {
    const next = on !== false
    if (next === layerOn) return
    layerOn = next
    emit()
}
export const signalPinLayerOn = () => layerOn

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
export function closeOpenedSignal(id = null, { passive = false } = {}) {
    const f = getShownFindings()
    // a card put away by the map's own flight there is not the user closing the signal
    if (passive && pin && Date.now() - (pin.at || 0) < PIN_GRACE_MS) return
    if (pin && (id == null || sameId(id, [pin.id, pin.alertId]))) { pin = null; emit() }
    if (f && (id == null ? true : sameId(id, [f.alertId]))) clearFindings()
}
