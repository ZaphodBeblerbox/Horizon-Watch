import { describe, it, expect } from "vitest"
import { ringFromGeometry, detectionCorners, squareAround, parseGeometry } from "./detectionShape.js"

// A real row out of sentinel_detections — a storage tank at Khor Fakkan.
const REAL_GEOM = JSON.stringify({
    type: "Polygon",
    coordinates: [[
        [56.3663869804736, 25.305398963425688],
        [56.36733259592625, 25.305351525952002],
        [56.36727804929215, 25.304462516008023],
        [56.36633243383951, 25.30450994799951],
        [56.3663869804736, 25.305398963425688],
    ]],
})

describe("detection outlines", () => {
    it("reads a GeoJSON polygon that arrives as a string", () => {
        const ring = ringFromGeometry(REAL_GEOM)
        expect(ring).toHaveLength(5)
    })

    it("reads one that arrives already parsed", () => {
        expect(ringFromGeometry(JSON.parse(REAL_GEOM))).toHaveLength(5)
    })

    it("swaps GeoJSON lon/lat into lat/lon exactly once", () => {
        // The trap: getting this wrong moves a detection off Somalia
        // into Kazakhstan, and nothing errors.
        const [lat, lon] = ringFromGeometry(REAL_GEOM)[0]
        expect(lat).toBeCloseTo(25.3054, 3)
        expect(lon).toBeCloseTo(56.3664, 3)
    })

    it("prefers the detector's own outline over any fallback", () => {
        const got = detectionCorners({
            geo_geometry: REAL_GEOM, centroid_lat: 25.3, centroid_lon: 56.3, area_m2: 9425.7,
        })
        expect(got.source).toBe("detector polygon")
        expect(got.corners).toHaveLength(5)
    })

    it("uses the real payload's field names", () => {
        // The actual bug: the layer looked for corners/polygon/center and
        // the API sends geo_geometry/centroid_lat/centroid_lon, so every
        // real outline was thrown away.
        const got = detectionCorners({ geo_geometry: REAL_GEOM })
        expect(got).not.toBeNull()
        expect(got.source).toBe("detector polygon")
    })

    it("falls back to a centroid square only when there is no shape", () => {
        const got = detectionCorners({ centroid_lat: 25.3, centroid_lon: 56.3 })
        expect(got.source).toBe("centroid estimate")
        expect(got.corners).toHaveLength(4)
    })

    it("sizes a centroid square from the reported area", () => {
        // A 10,000 m² storage tank must not be drawn the size of a truck.
        const big = detectionCorners({ centroid_lat: 0, centroid_lon: 0, area_m2: 10000 })
        const small = detectionCorners({ centroid_lat: 0, centroid_lon: 0, area_m2: 25 })
        const span = (c) => Math.abs(c.corners[2][0] - c.corners[0][0])
        expect(span(big)).toBeGreaterThan(span(small))
    })

    it("handles a MultiPolygon", () => {
        const geo = { type: "MultiPolygon", coordinates: [[[[1, 2], [3, 4], [5, 6], [1, 2]]]] }
        expect(ringFromGeometry(geo)).toHaveLength(4)
    })

    it("rejects malformed geometry rather than throwing", () => {
        expect(ringFromGeometry("{not json")).toBeNull()
        expect(ringFromGeometry(null)).toBeNull()
        expect(ringFromGeometry({ type: "Polygon", coordinates: [[[1, 2]]] })).toBeNull()
        expect(parseGeometry("nope")).toBeNull()
    })

    it("drops out-of-range coordinates instead of drawing them", () => {
        const geo = { type: "Polygon", coordinates: [[[500, 900], [1, 2], [3, 4], [5, 6]]] }
        const ring = ringFromGeometry(geo)
        expect(ring).toHaveLength(3)
    })

    it("returns null for a detection with no position at all", () => {
        expect(detectionCorners({ object_type: "vessel" })).toBeNull()
        expect(detectionCorners(null)).toBeNull()
    })

    it("still honours corners and bbox_geo when they are present", () => {
        expect(detectionCorners({ corners: [[1, 2], [3, 4], [5, 6]] }).source).toBe("oriented box")
        expect(detectionCorners({ bbox_geo: [10, 20, 11, 21] }).source).toBe("bounding box")
    })

    it("squareAround stays finite near the poles", () => {
        const c = squareAround(89.9, 10, 15)
        expect(c.every(([a, b]) => Number.isFinite(a) && Number.isFinite(b))).toBe(true)
    })
})
