// trackClustering.js — real grid-based clustering for AIS/ADS-B track
// rendering above the per-viewport render cap. Both GlobeAISLayer.jsx and
// GlobeADSBLayer.jsx used to hard-slice to the N nearest-to-viewport-center
// tracks and silently drop the rest — nothing rendered past the cap, with no
// indication anything else was there. This groups tracks beyond the cap
// into real grid cells and reports each dense cell as one cluster with a
// real count, so density beyond the cap is honestly shown, not dropped.

/**
 * @param {Array} items - the real, already-position-filtered track list
 * @param {{getLat:Function, getLon:Function, viewBounds:?object, maxIndividual:number, cellDivisions?:number, clusterMinSize?:number}} opts
 * @returns {{individual: Array, clusters: Array<{lat:number, lon:number, count:number, items:Array}>}}
 */
export function clusterTracks(items, { getLat, getLon, viewBounds, maxIndividual, cellDivisions = 24, clusterMinSize = 4 }) {
    if (!items || items.length <= maxIndividual) return { individual: items || [], clusters: [] }

    const latSpan = viewBounds ? Math.max(0.1, viewBounds.north - viewBounds.south) : 40
    const lonSpan = viewBounds ? Math.max(0.1, viewBounds.east - viewBounds.west) : 80
    const cellLat = Math.max(0.05, latSpan / cellDivisions)
    const cellLon = Math.max(0.05, lonSpan / cellDivisions)

    const cells = new Map()
    for (const item of items) {
        const lat = getLat(item), lon = getLon(item)
        if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) continue
        const key = `${Math.floor(lat / cellLat)}:${Math.floor(lon / cellLon)}`
        let bucket = cells.get(key)
        if (!bucket) { bucket = []; cells.set(key, bucket) }
        bucket.push(item)
    }

    const individual = []
    const clusters = []
    for (const bucket of cells.values()) {
        if (bucket.length < clusterMinSize) {
            individual.push(...bucket)
            continue
        }
        let sumLat = 0, sumLon = 0
        for (const item of bucket) { sumLat += getLat(item); sumLon += getLon(item) }
        clusters.push({ lat: sumLat / bucket.length, lon: sumLon / bucket.length, count: bucket.length, items: bucket })
    }
    return { individual, clusters }
}
