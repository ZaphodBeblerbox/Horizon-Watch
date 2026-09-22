/**
 * detectionShape.js — the real outline of a detected object.
 *
 * THE BUG THIS FIXES. The detector returns a genuine polygon per
 * detection: 259 of the 260 rows in sentinel_detections carry a GeoJSON
 * Polygon in `geo_geometry`, traced around the object, with a real area
 * in m². The globe layer looked for `corners`, `bbox_geo`, `polygon`,
 * `north`/`south`/`east`/`west` and `center` — and the payload has none
 * of those names. So the best available shape was discarded on every
 * single detection and the layer fell back to a fixed ~30m square drawn
 * around a centroid, which is why detections rendered as small identical
 * boxes instead of outlines of the thing detected.
 *
 * It is a producer/consumer naming mismatch, the same shape of defect as
 * the alert writer's key names — nothing was broken, nothing logged, and
 * both halves looked correct on their own.
 *
 * COORDINATE ORDER IS THE TRAP. GeoJSON is [longitude, latitude]; this
 * layer works in [latitude, longitude]. Swapping them silently puts a
 * detection off the coast of Somalia into Kazakhstan, so the conversion
 * lives here with tests rather than inline in a render loop.
 */

/** Parse `geo_geometry`, which may arrive as a JSON string or an object. */
export function parseGeometry(raw) {
    if (!raw) return null
    let geo = raw
    if (typeof raw === "string") {
        try { geo = JSON.parse(raw) } catch { return null }
    }
    if (!geo || typeof geo !== "object") return null
    return geo
}

/**
 * The outer ring of a GeoJSON Polygon or MultiPolygon, as [lat, lon]
 * pairs. Holes are ignored: a detection outline is one closed shape.
 */
export function ringFromGeometry(raw) {
    const geo = parseGeometry(raw)
    if (!geo) return null
    const type = String(geo.type || "")
    let ring = null
    if (type === "Polygon") {
        ring = geo.coordinates?.[0]
    } else if (type === "MultiPolygon") {
        ring = geo.coordinates?.[0]?.[0]
    } else if (Array.isArray(geo.coordinates)) {
        ring = geo.coordinates
    }
    if (!Array.isArray(ring) || ring.length < 3) return null

    const out = []
    for (const pair of ring) {
        if (!Array.isArray(pair) || pair.length < 2) continue
        const lon = Number(pair[0]), lat = Number(pair[1])
        // GeoJSON order, swapped once, here.
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
        out.push([lat, lon])
    }
    return out.length >= 3 ? out : null
}

/**
 * A square of the given half-width in metres around a point, in
 * [lat, lon] pairs. The genuine last resort: used only when a detection
 * has no shape at all.
 */
export function squareAround(lat, lon, halfMetres = 15) {
    const dLat = halfMetres / 111320
    const dLon = halfMetres / (111320 * Math.max(0.15, Math.cos(lat * Math.PI / 180)))
    return [
        [lat - dLat, lon - dLon], [lat - dLat, lon + dLon],
        [lat + dLat, lon + dLon], [lat + dLat, lon - dLon],
    ]
}

/**
 * The corners to draw for a detection, best shape first, plus which
 * source they came from so the inspector can say whether the outline is
 * the detector's own or a stand-in.
 *
 * @returns {{corners: Array<[number,number]>, source: string}|null}
 */
export function detectionCorners(det) {
    if (!det) return null

    // The detector's own traced outline — the whole point of this file.
    const ring = ringFromGeometry(det.geo_geometry || det.geometry)
    if (ring) return { corners: ring, source: "detector polygon" }

    // A rotated box from the model, where one is given.
    if (Array.isArray(det.corners) && det.corners.length >= 3) {
        return { corners: det.corners, source: "oriented box" }
    }
    if (Array.isArray(det.polygon) && det.polygon.length >= 3) {
        return { corners: det.polygon, source: "polygon" }
    }
    if (Array.isArray(det.bbox_geo) && det.bbox_geo.length === 4) {
        const [W, S, E, N] = det.bbox_geo.map(Number)
        if ([W, S, E, N].every(Number.isFinite)) {
            return { corners: [[S, W], [S, E], [N, E], [N, W]], source: "bounding box" }
        }
    }
    if (det.north != null && det.south != null && det.east != null && det.west != null) {
        const { north: N, south: S, east: E, west: W } = det
        return { corners: [[S, W], [S, E], [N, E], [N, W]], source: "bounds" }
    }

    // Centroid only. Sized from the reported area where there is one, so
    // a 10,000 m² storage tank is not drawn the same size as a truck.
    const lat = Number(det.centroid_lat ?? det.center?.[0])
    const lon = Number(det.centroid_lon ?? det.center?.[1])
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const area = Number(det.area_m2)
        const half = Number.isFinite(area) && area > 1
            ? Math.min(250, Math.max(5, Math.sqrt(area) / 2))
            : 15
        return { corners: squareAround(lat, lon, half), source: "centroid estimate" }
    }
    return null
}
