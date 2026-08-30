// Real Mission-Profile focus-region names -> a reasonable camera center/zoom
// for that region. Shared between app.jsx (profile pan-to) and the Reports
// workspace's Map sub-tab (centering on a ReportTask's real resolved
// region) so there's one real region->coordinate table, not two.
export const REGION_COORDS = {
    "East Africa":    { lat: -2,  lon: 37, zoom: 5 },
    "Great Lakes Region": { lat: -3, lon: 30, zoom: 6 },
    "Sahel":          { lat: 15,  lon: 5,  zoom: 5 },
    "Red Sea / Arabian Peninsula": { lat: 20, lon: 43, zoom: 5 },
    "Gulf States":    { lat: 25,  lon: 53, zoom: 6 },
    "Middle East":    { lat: 25,  lon: 45, zoom: 5 },
    "Horn of Africa": { lat: 8,   lon: 46, zoom: 5 },
    "North Africa":   { lat: 25,  lon: 17, zoom: 4 },
    "West Africa":    { lat: 12,  lon: -2, zoom: 5 },
    "Central Africa": { lat: 2,   lon: 24, zoom: 5 },
    "Southern Africa":{ lat: -22, lon: 25, zoom: 5 },
    "Indian Ocean":   { lat: -8,  lon: 67, zoom: 4 },
    "Mediterranean":  { lat: 36,  lon: 18, zoom: 5 },
    "South Asia":     { lat: 25,  lon: 72, zoom: 5 },
    "Southeast Asia": { lat: 10,  lon: 108, zoom: 5 },
    "Central Asia":   { lat: 42,  lon: 60, zoom: 5 },
    "Europe":         { lat: 52,  lon: 12, zoom: 4 },
}

/**
 * Resolve a ReportTask's real `region` field (an explicit array of region
 * names, the literal string "auto" already-resolved server-side into names,
 * or null/unscoped) to a real camera center/zoom. Never fabricates a
 * location for an unrecognized or absent region — falls back to a neutral
 * world view instead.
 */
export function coordsForRegion(region) {
    const names = Array.isArray(region) ? region : []
    for (const name of names) {
        if (REGION_COORDS[name]) return REGION_COORDS[name]
    }
    return { lat: 20, lon: 0, zoom: 2 }
}
