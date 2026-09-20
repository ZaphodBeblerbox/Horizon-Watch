import { describe, it, expect } from "vitest"
import { altitudeMetres, chronological, dedupe, isDrawable, FT_TO_M } from "./selectedTrack.js"

describe("altitudeMetres", () => {
    it("converts feet to metres", () => {
        expect(altitudeMetres(35000)).toBeCloseTo(35000 * FT_TO_M, 3)
    })

    it('reads the literal string "ground" as ground level', () => {
        // ADS-B reports this for an aircraft on the surface and it is in
        // this feed — 1 of 75 positions on the first airframe checked.
        expect(altitudeMetres("ground")).toBe(0)
        expect(altitudeMetres("GROUND")).toBe(0)
    })

    it("never returns NaN, whatever it is given", () => {
        // A NaN vertex does not draw a short wall — it drops the entire
        // geometry, so one bad row would erase the whole flight path.
        for (const v of [null, undefined, "", "n/a", {}, [], NaN, -100]) {
            expect(Number.isFinite(altitudeMetres(v))).toBe(true)
        }
    })

    it("treats a negative altitude as ground rather than below it", () => {
        expect(altitudeMetres(-500)).toBe(0)
    })
})

describe("chronological", () => {
    it("puts the oldest fix first", () => {
        // The API returns newest-first because every other consumer wants
        // the latest fix; a track drawn in that order runs backwards.
        const out = chronological([
            { lat: 1, lon: 1, timestamp: "2026-09-20T12:00:00" },
            { lat: 2, lon: 2, timestamp: "2026-09-20T10:00:00" },
        ])
        expect(out[0].timestamp).toBe("2026-09-20T10:00:00")
    })

    it("drops fixes with no usable position", () => {
        const out = chronological([
            { lat: 1, lon: 1, timestamp: "a" },
            { lat: null, lon: 2, timestamp: "b" },
            { lon: 3, timestamp: "c" },
        ])
        expect(out).toHaveLength(1)
    })

    it("survives an empty or missing feed", () => {
        expect(chronological([])).toEqual([])
        expect(chronological(null)).toEqual([])
    })
})

describe("isDrawable", () => {
    it("needs two fixes to make a line", () => {
        expect(isDrawable([{ lat: 1, lon: 1 }])).toBe(false)
        expect(isDrawable([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }])).toBe(true)
    })
})

describe("dedupe", () => {
    const at = (lat, lon) => ({ lat, lon, timestamp: `${lat}` })

    it("collapses a contact that never moved", () => {
        // A moored ship reports the same position for hours; its track
        // is one place, not four hundred.
        const moored = Array.from({ length: 400 }, () => at(25.1, 55.2))
        expect(dedupe(moored)).toHaveLength(1)
    })

    it("keeps a real voyage intact", () => {
        expect(dedupe([at(1, 1), at(2, 2), at(3, 3)])).toHaveLength(3)
    })

    it("keeps a return to an earlier position", () => {
        // Only CONSECUTIVE repeats are noise; coming back is movement.
        expect(dedupe([at(1, 1), at(2, 2), at(1, 1)])).toHaveLength(3)
    })

    it("treats sub-metre jitter as standing still", () => {
        expect(dedupe([at(25.100000, 55.2), at(25.1000001, 55.2)])).toHaveLength(1)
    })
})

describe("isDrawable with degenerate tracks", () => {
    it("refuses a track that is really one point", () => {
        // Cesium cannot normalise the direction between a point and
        // itself; asking it to draw this kills the whole globe.
        const stuck = [
            { lat: 25.1, lon: 55.2, timestamp: "a" },
            { lat: 25.1, lon: 55.2, timestamp: "b" },
            { lat: 25.1, lon: 55.2, timestamp: "c" },
        ]
        expect(isDrawable(stuck)).toBe(false)
    })
})
