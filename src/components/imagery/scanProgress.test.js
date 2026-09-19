import { describe, it, expect } from "vitest"
import { formatEta, progressLabel } from "./ScanProgress.jsx"

describe("the remaining-time estimate", () => {
    it("says minutes once seconds stop being useful", () => {
        // "270s" is not a number anyone can act on.
        expect(formatEta(270)).toBe("5 min")
        expect(formatEta(45)).toBe("45s")
    })

    it("offers nothing when there is nothing to base an estimate on", () => {
        // Before the first tile completes there is no observed rate. An
        // invented estimate is worse than none: it will be wrong and the
        // person will calibrate on it.
        expect(formatEta(null)).toBeNull()
        expect(formatEta(undefined)).toBeNull()
        expect(formatEta(Infinity)).toBeNull()
    })

    it("does not report a fraction of a second", () => {
        expect(formatEta(0.2)).toBe("a moment")
    })
})

describe("the line under the bar", () => {
    it("says which tile, not merely that something is happening", () => {
        const line = progressLabel({ done: 12, total: 60, detections: 40, eta_s: 180, finished: false })
        expect(line).toContain("tile 12 of 60")
        expect(line).toContain("3 min")
    })

    it("reports detections found so far, so a long scan shows it is productive", () => {
        expect(progressLabel({ done: 5, total: 60, detections: 21, eta_s: 60, finished: false }))
            .toContain("21 detections")
    })

    it("omits the detection count when there is genuinely nothing yet", () => {
        // "0 detections so far" reads as a result; it is not one.
        expect(progressLabel({ done: 1, total: 60, detections: 0, eta_s: 60, finished: false }))
            .not.toContain("detection")
    })

    it("omits the estimate before the first tile lands", () => {
        const line = progressLabel({ done: 0, total: 60, detections: 0, eta_s: null, finished: false })
        expect(line).toContain("tile 0 of 60")
        expect(line).not.toContain("left")
    })

    it("states the outcome when finished, not just 100%", () => {
        const line = progressLabel({ done: 60, total: 60, detections: 133, finished: true, note: "58/60 tiles" })
        expect(line).toContain("done")
        expect(line).toContain("133 detections")
        expect(line).toContain("58/60 tiles")   // partial coverage must survive
    })

    it("gets singular and plural right", () => {
        expect(progressLabel({ done: 1, total: 1, detections: 1, finished: true }))
            .toMatch(/1 tile, 1 detection\b/)
        expect(progressLabel({ done: 2, total: 2, detections: 2, finished: true }))
            .toContain("2 tiles, 2 detections")
    })

    it("says something honest before any state has arrived", () => {
        expect(progressLabel(null)).toBe("starting…")
    })
})
