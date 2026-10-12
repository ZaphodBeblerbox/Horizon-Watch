/**
 * geo.js — asking the device where it is, and saying plainly why not.
 *
 * Every place the app reads the device's position comes through here
 * (LocationPrompt, liveShare, the phone's Settings, Home and Map), so a
 * refusal reads the same everywhere and says how to undo it — on an iPhone
 * a refused web app is never asked again until the setting is changed, so
 * "Location was not allowed." with no way out is a dead end (2026-10-12:
 * "location services don't work on phone").
 *
 * THE ORDER OF ATTEMPTS. The first request is made synchronously inside the
 * tap that asked for it (call locate() before any await), at high accuracy.
 * A timeout or "position unavailable" is retried once at low accuracy with a
 * cached fix allowed — indoors a phone often has Wi-Fi but no GPS. A
 * refusal is final: it is reported at once, with the steps to allow it.
 */

export const DENIED = "denied"
export const UNAVAILABLE = "unavailable"
export const TIMEOUT = "timeout"
export const UNSUPPORTED = "unsupported"
export const INSECURE = "insecure"

/** What kind of device and shell this page runs in. */
export function platformOf(nav = typeof navigator !== "undefined" ? navigator : undefined,
                           win = typeof window !== "undefined" ? window : undefined) {
    const ua = nav?.userAgent || ""
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints || 0) > 1)
    let standalone = false
    try { standalone = !!nav?.standalone || !!win?.matchMedia?.("(display-mode: standalone)")?.matches } catch { /* none */ }
    return { ios, standalone, android: /Android/.test(ua) }
}

/** The GeolocationPositionError code as a word. */
export function kindOf(code) {
    return code === 1 ? DENIED : code === 3 ? TIMEOUT : UNAVAILABLE
}

/** A sentence for each failure, with what to do about it. */
export function messageFor(kind, plat = platformOf()) {
    if (kind === DENIED) {
        if (plat.ios) {
            return "Location is off for Parallax. On iPhone: Settings › Privacy & Security › Location Services — "
                + "make sure it is on, then Safari Websites (or the Parallax app) › While Using"
                + (plat.standalone ? "." : ", and in Safari: aA › Website Settings › Location › Allow.")
                + " Then come back and tap Try again."
        }
        if (plat.android) return "Location is blocked for this site. Tap the lock beside the address › Permissions › Location › Allow, check that Location is on in quick settings, then try again."
        return "Location is blocked for this site — allow it in the browser's site settings (the icon left of the address), then try again."
    }
    if (kind === TIMEOUT) return "Finding you took too long, even at lower accuracy. Go near a window or turn on Wi-Fi, then try again."
    if (kind === UNAVAILABLE) return "This device could not work out where it is, even at lower accuracy. Check that Location Services and Wi-Fi are on, then try again."
    if (kind === INSECURE) return "Location needs a secure (https) page."
    return "This browser cannot share its location."
}

export class LocationError extends Error {
    constructor(kind, plat) {
        super(messageFor(kind, plat))
        this.kind = kind
    }
}

const HIGH = { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 }
const LOW = { enableHighAccuracy: false, timeout: 20_000, maximumAge: 10 * 60_000 }

function fixOf(p) {
    return { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp || Date.now() }
}

/** One request. Resolves a fix or rejects a LocationError. The request is
 *  made synchronously, so a call inside a tap keeps the tap's activation. */
export function getFix(opts = HIGH, { geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined, plat } = {}) {
    if (typeof window !== "undefined" && window.isSecureContext === false) return Promise.reject(new LocationError(INSECURE, plat))
    if (!geo?.getCurrentPosition) return Promise.reject(new LocationError(UNSUPPORTED, plat))
    return new Promise((resolve, reject) => {
        try {
            geo.getCurrentPosition((p) => resolve(fixOf(p)), (e) => reject(new LocationError(kindOf(e?.code), plat)), opts)
        } catch { reject(new LocationError(UNSUPPORTED, plat)) }
    })
}

/** The device's position: high accuracy first, then once more at low
 *  accuracy unless refused. onRetry() is told when the second try starts. */
export function locate({ geo, plat, onRetry } = {}) {
    const first = getFix(HIGH, { geo, plat })        // synchronously, inside the caller's tap
    return first.catch((e) => {
        if (e.kind === DENIED || e.kind === UNSUPPORTED || e.kind === INSECURE) throw e
        onRetry?.(e)
        return getFix(LOW, { geo, plat }).then((f) => ({ ...f, lowAccuracy: true }))
    })
}

export { fixOf, HIGH, LOW }
