/**
 * locateMe.js — "My location" on the desktop map (owner, 2026-10-24: "two crosshair buttons, one flies out
 * of the globe, the other does nothing").
 *
 * Where you are, best first: this device's live fix (location/liveShare.js, shared live), else the browser's
 * own geolocation (one request), else the position the app holds for you (an approximate one from your
 * connection, or the place you gave). The camera flies there at a city zoom.
 */
import { myPosition } from "../location/liveShare.js"

export const CITY_ALTITUDE_M = 25_000
export const GEO_OPTS = { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 }

/** Ask the browser once; resolves {lat, lon} or null (denied, unavailable, timed out, no API). */
export function browserFix(geo = (typeof navigator !== "undefined" ? navigator.geolocation : null), opts = GEO_OPTS) {
    return new Promise((resolve) => {
        if (!geo || typeof geo.getCurrentPosition !== "function") { resolve(null); return }
        try {
            geo.getCurrentPosition(
                (p) => resolve(p?.coords && Number.isFinite(p.coords.latitude) && Number.isFinite(p.coords.longitude)
                    ? { lat: p.coords.latitude, lon: p.coords.longitude } : null),
                () => resolve(null), opts)
        } catch { resolve(null) }
    })
}

/** {lat, lon, source} or null: live fix > browser > stored position. */
export async function findMe({ mine = myPosition, browser = browserFix } = {}) {
    const held = (() => { try { return mine() } catch { return null } })()
    if (held?.live) return { lat: held.lat, lon: held.lon, source: "live" }
    const b = await browser()
    if (b) return { ...b, source: "browser" }
    if (held && Number.isFinite(+held.lat) && Number.isFinite(+held.lon)) return { lat: +held.lat, lon: +held.lon, source: "stored" }
    return null
}

/** Fly the globe there (GlobeView listens for akili:fly-to). Resolves the position used, or null. */
export async function flyToMe(deps = {}) {
    const me = await findMe(deps)
    if (me && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: me.lat, lon: me.lon, altitude: CITY_ALTITUDE_M } }))
    }
    return me
}
