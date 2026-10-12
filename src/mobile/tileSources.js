/**
 * tileSources.js — the phone's base maps and the order they are tried in
 * when one cannot be reached (moved out of screens/MMap.jsx so the safest-
 * route view uses the same chain): Esri, Esri through our own server (the
 * owner's iPhone cannot reach arcgisonline.com), Esri's second host, then
 * OpenStreetMap. The source that last worked is remembered per device
 * (localStorage "m2-tile-source").
 */
import API_BASE from "../apiBase.js"

// Esri's public base maps, credited as their terms ask (CARTO's now want a key).
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services"
export const BASES = {
    dark: { url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, labels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
            attribution: "Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 16 },
    satellite: { url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, labels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
            attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics", maxZoom: 18 },
}
// WHEN ESRI'S MAIN TILE SERVER CANNOT BE REACHED: the same maps from Esri's
// second host, then OpenStreetMap — both without a key. (CARTO was tried on
// 2026-10-12 and now answers every tile with "API key required".)
const SVC = "https://services.arcgisonline.com/ArcGIS/rest/services"
// THE SAME ESRI TILES THROUGH OUR OWN SERVER, first (2026-10-12): the owner's
// iPhone cannot reach arcgisonline.com at all, but reaches our API.
const PROXY = `${API_BASE}/api/tiles/esri`
export const FALLBACKS = [
    {
        dark: { url: `${PROXY}/dark/{z}/{y}/{x}`, labels: `${PROXY}/dark_ref/{z}/{y}/{x}`,
                attribution: "Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 16 },
        satellite: { url: `${PROXY}/imagery/{z}/{y}/{x}`, labels: `${PROXY}/imagery_ref/{z}/{y}/{x}`,
                     attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics", maxZoom: 18 },
    },
    {
        dark: { url: `${SVC}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, labels: `${SVC}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
                attribution: "Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 16 },
        satellite: { url: `${SVC}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, labels: `${SVC}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
                     attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics", maxZoom: 18 },
    },
    {
        dark: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", labels: null, attribution: "&copy; OpenStreetMap contributors", maxZoom: 18, dim: true },
        satellite: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", labels: null, attribution: "&copy; OpenStreetMap contributors", maxZoom: 18, dim: true },
    },
]

/** The source to start from on this device (0 = Esri direct). */
export function startSource() {
    try { const v = +localStorage.getItem("m2-tile-source"); return v > 0 && v < FALLBACKS.length ? v : 0 } catch { return 0 }
}

/** A base map on `map` that moves to the next source when this one plainly
 *  fails (many errors and not one tile in 8 s) — MMap's rule. Returns remove(). */
export function addBaseTiles(L, map, baseKey = "dark", source = startSource(), onSource) {
    let layer = null, cur = source, dead = false
    const put = () => {
        if (dead) return
        layer?.remove()
        const set = cur === 0 ? BASES : FALLBACKS[cur - 1]
        const b = set[baseKey] || set.dark
        let loaded = 0, failed = 0, settled = false, timeUp = false
        const ground = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom + 2, maxNativeZoom: b.maxZoom, detectRetina: true,
                                             className: b.dim ? "m2-tiles-dim" : "" })
        const next = () => {
            if (settled || loaded > 0 || failed < 8 || cur >= FALLBACKS.length) return
            settled = true
            cur += 1
            onSource?.(cur)
            put()
        }
        ground.on("tileload", () => {
            if (loaded === 0) { try { localStorage.setItem("m2-tile-source", String(cur)) } catch { /* private mode */ } }
            loaded += 1
        })
        ground.on("tileerror", () => { failed += 1; if (timeUp) next() })
        const watchdog = setTimeout(() => { timeUp = true; next() }, 8000)
        ground.on("remove", () => clearTimeout(watchdog))
        layer = L.layerGroup([ground, ...(b.labels ? [L.tileLayer(b.labels, { maxZoom: b.maxZoom + 2, maxNativeZoom: b.maxZoom, opacity: 0.9, detectRetina: true })] : [])]).addTo(map)
    }
    put()
    return () => { dead = true; layer?.remove() }
}
