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

function requestLocation() {
    if (cachedPromise) return cachedPromise
    cachedPromise = new Promise((resolve) => {
        if (typeof navigator === "undefined" || !("geolocation" in navigator)) { resolve(null); return }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            () => resolve(null),
            { maximumAge: 5 * 60_000, timeout: 8000 },
        )
    })
    return cachedPromise
}

/** @returns {?{lat:number, lon:number}} null until resolved (or if unavailable/denied) */
export function useUserLocation() {
    const [loc, setLoc] = useState(null)
    useEffect(() => {
        let cancelled = false
        requestLocation().then((l) => { if (!cancelled) setLoc(l) })
        return () => { cancelled = true }
    }, [])
    return loc
}
