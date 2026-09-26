import { useEffect, useState } from "react"

// useUserLocation.js — real browser geolocation, shared across every
// minimap's idle/no-focus default view ("the default view of the globe is
// a zoomed in user location" rather than a generic world/fallback point).
// One real navigator.geolocation request, cached at module scope so many
// minimap instances mounting at once share a single permission prompt/
// result instead of each asking separately. Resolves to a real {lat, lon}
// or null if geolocation is unavailable/denied/times out — never a
// fabricated placeholder location.

let cachedPromise = null

/**
 * Where the machine is, roughly, with no permission and no network.
 *
 * The system timezone offset IS a longitude: the earth turns 15 degrees an
 * hour, so an offset of -300 minutes is 75 degrees west. It is accurate to
 * about half a zone, which is far better than nothing and costs nothing.
 *
 * Latitude cannot be derived this way, and it is what sunrise actually
 * depends on — so this is explicitly marked approximate, and the caller
 * can say so rather than presenting a guess as a fix. 40 degrees is used
 * as a mid-northern default because that is where most of the timezone
 * offsets in use actually sit; it gives a day/night cycle that is roughly
 * right rather than one stuck at equatorial twelve-hour days.
 */
export function approximateLocationFromClock(now = new Date()) {
    // getTimezoneOffset is minutes BEHIND UTC, so it is negated here.
    const offsetMin = -now.getTimezoneOffset()
    const lon = Math.max(-180, Math.min(180, offsetMin / 4))
    return { lat: 40, lon, approximate: true }
}

function requestLocation() {
    if (cachedPromise) return cachedPromise
    cachedPromise = new Promise((resolve) => {
        if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
            resolve(approximateLocationFromClock()); return
        }
        // A DENIAL IS NOT AN ABSENCE OF INFORMATION. This used to resolve
        // null on refusal or timeout, which turned off the automatic
        // day/night cycle entirely — so someone who declined once, or who
        // was on a build where the prompt never appeared at all, got a
        // theme frozen at whatever the default was. The clock still knows
        // roughly where the machine is.
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, approximate: false }),
            () => resolve(approximateLocationFromClock()),
            { maximumAge: 5 * 60_000, timeout: 8000 },
        )
    })
    return cachedPromise
}

/** @returns {?{lat:number, lon:number, approximate:boolean}} null until resolved. */
export function useUserLocation() {
    const [loc, setLoc] = useState(null)
    useEffect(() => {
        let cancelled = false
        requestLocation().then((l) => { if (!cancelled) setLoc(l) })
        return () => { cancelled = true }
    }, [])
    return loc
}

/** Same real, shared, cached geolocation request as useUserLocation() above,
 * as a plain Promise — for non-component callers (e.g. themeStore.js's Auto
 * theme mode) that need the real location without a React hook. Shares the
 * exact same cachedPromise, so it never triggers a second permission prompt
 * independent of any minimap already using useUserLocation(). */
export function getUserLocation() {
    return requestLocation()
}
