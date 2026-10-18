import { describe, it, expect } from "vitest"
import { cullOrCluster, MAX_FEATURES } from "./mapLayers.js"

// Owner, 2026-10-17: "no cap on how many things we can actually recognise
// on the map". A finding layer folds points into counted discs instead of
// dropping the ones past the cap.
const pt = (i, lat, lon, severity = "medium") => ({ id: `p${i}`, lat, lon, title: `P${i}`, severity })
const WORLD = { south: -90, north: 90, west: -180, east: 180 }

describe("cullOrCluster", () => {
    it("returns every point in view when they fit", () => {
        const pts = Array.from({ length: 50 }, (_, i) => pt(i, 10 + i * 0.01, 20))
        expect(cullOrCluster(pts, WORLD, 5)).toHaveLength(50)
        expect(cullOrCluster(pts, { south: 0, north: 10.2, west: 0, east: 30 }, 5)).toHaveLength(21)
    })

    it("clusters past the cap and loses none", () => {
        const pts = Array.from({ length: MAX_FEATURES * 3 }, (_, i) =>
            pt(i, -60 + (i % 60) * 2, -170 + Math.floor(i / 60) * 5, i === 7 ? "critical" : "medium"))
        const out = cullOrCluster(pts, WORLD, 3, { noun: "imagery signals", prefix: "imgsig" })
        expect(out.length).toBeLessThanOrEqual(MAX_FEATURES)
        const total = out.reduce((a, f) => a + (f.raw?.count || 1), 0)
        expect(total).toBe(pts.length)
        const cl = out.find((f) => f.raw?.kind === "imgsig_cluster")
        expect(cl.title).toMatch(/imagery signals here/)
        expect(out.some((f) => f.severity === "critical")).toBe(true)
    })
})
