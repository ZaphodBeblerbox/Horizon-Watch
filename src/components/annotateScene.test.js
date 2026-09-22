import { describe, it, expect } from "vitest"
import { project, validBounds, detectionPixels, detectionLabel, provenanceLine } from "./annotateScene.js"
import { detectionCorners } from "../globe/detectionShape.js"

const B = { min_lon: 56.0, min_lat: 25.0, max_lon: 57.0, max_lat: 26.0 }

describe("scene annotation", () => {
    it("rejects bounds it cannot project", () => {
        expect(validBounds(null)).toBe(false)
        expect(validBounds({ min_lon: 1, min_lat: 1, max_lon: 1, max_lat: 2 })).toBe(false)
        expect(validBounds({ min_lon: 1, min_lat: 2, max_lon: 2, max_lat: 1 })).toBe(false)
        expect(validBounds(B)).toBe(true)
    })

    it("maps the corners of the bounds to the corners of the image", () => {
        expect(project(26.0, 56.0, B, 1000, 800)).toEqual({ x: 0, y: 0 })
        expect(project(25.0, 57.0, B, 1000, 800)).toEqual({ x: 1000, y: 800 })
    })

    it("inverts latitude, because image y grows downward", () => {
        // Getting this wrong mirrors every box about the centre, which
        // looks plausible and is completely wrong.
        const north = project(25.9, 56.5, B, 100, 100)
        const south = project(25.1, 56.5, B, 100, 100)
        expect(north.y).toBeLessThan(south.y)
    })

    it("puts the centre in the centre", () => {
        expect(project(25.5, 56.5, B, 200, 100)).toEqual({ x: 100, y: 50 })
    })

    it("returns null rather than NaN for unusable input", () => {
        // NaN coordinates draw nothing and report nothing.
        expect(project(NaN, 56.5, B, 10, 10)).toBeNull()
        expect(project(25.5, null, B, 10, 10)).toBeNull()
        expect(project(25.5, 56.5, null, 10, 10)).toBeNull()
    })

    it("projects a real detection polygon into the image", () => {
        // The same geometry resolver the globe uses, so the export and
        // the screen cannot disagree about where a box is.
        const det = {
            geo_geometry: JSON.stringify({
                type: "Polygon",
                coordinates: [[[56.2, 25.2], [56.3, 25.2], [56.3, 25.3], [56.2, 25.3], [56.2, 25.2]]],
            }),
        }
        const px = detectionPixels(det, B, 1000, 1000, detectionCorners)
        expect(px.source).toBe("detector polygon")
        expect(px.points).toHaveLength(5)
        for (const p of px.points) {
            expect(p.x).toBeGreaterThanOrEqual(0)
            expect(p.x).toBeLessThanOrEqual(1000)
        }
    })

    it("has no pixels for a detection with no shape", () => {
        expect(detectionPixels({}, B, 100, 100, detectionCorners)).toBeNull()
    })

    it("labels a box with what it is and how sure", () => {
        expect(detectionLabel({ object_type: "storage_tank", confidence: 0.82 }))
            .toBe("storage tank 82%")
        expect(detectionLabel({})).toBe("object")
    })

    it("the burned-in line says the boxes are automated and unconfirmed", () => {
        // An exported image that does not say it is machine-detected can
        // be mistaken for a confirmed observation.
        const line = provenanceLine({
            sensor: "sentinel2_optical", captured: "2026-09-21 06:12 UTC",
            cloud: 4.2, detections: 3,
        })
        expect(line).toContain("sentinel2_optical")
        expect(line).toContain("2026-09-21")
        expect(line).toContain("4% cloud")
        expect(line).toContain("3 automated detections")
        expect(line).toContain("not confirmed")
    })

    it("is honest when the capture date is unknown", () => {
        expect(provenanceLine({})).toContain("capture date unknown")
    })
})
