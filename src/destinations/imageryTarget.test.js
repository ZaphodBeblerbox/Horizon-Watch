import { describe, it, expect } from "vitest"
import { imageryTarget } from "./Inbox.jsx"

/**
 * A signal either points at a scene or it does not. Offering the action when
 * it cannot work teaches people to distrust the ones that do, so the button
 * has to be absent rather than present-and-broken.
 */

const satTask = (raw) => ({ source: "SAT-TASK", row: { raw_json: raw } })

describe("which signals can open imagery", () => {
    it("takes the reader to the exact detection when the alert names one", () => {
        expect(imageryTarget(satTask({
            detection_id: "DET-abc", scan_id: "SCAN-1", zone_id: "ZONE-001",
        }))).toEqual({ detectionId: "DET-abc", scanId: "SCAN-1", systemId: "ZONE-001" })
    })

    it("still opens the scene when only the scan is known", () => {
        // "We cannot take you to the exact box" is not a reason to withhold
        // the picture.
        expect(imageryTarget(satTask({ scan_id: "SCAN-1", zone_id: "ZONE-001" })))
            .toEqual({ scanId: "SCAN-1", systemId: "ZONE-001" })
    })

    it("offers nothing when there is no scene behind the signal", () => {
        expect(imageryTarget(satTask({ zone_id: "ZONE-001" }))).toBeNull()
        expect(imageryTarget(satTask({}))).toBeNull()
    })

    it("does not offer imagery for signals from other sources", () => {
        // An AIS or news signal has no scan to open.
        expect(imageryTarget({ source: "AIS", row: { raw_json: { scan_id: "SCAN-1" } } })).toBeNull()
        expect(imageryTarget({ source: "fusion", row: { raw_json: { detection_id: "DET-1" } } })).toBeNull()
    })

    it("survives a signal with no payload at all", () => {
        expect(imageryTarget(null)).toBeNull()
        expect(imageryTarget(undefined)).toBeNull()
        expect(imageryTarget({})).toBeNull()
        expect(imageryTarget({ source: "SAT-TASK" })).toBeNull()
    })

    it("reads the payload wherever the inbox row happens to carry it", () => {
        // The inbox normalises rows from more than one shape; a working
        // action must not depend on which one this signal came through.
        expect(imageryTarget({ raw: { source: "SAT-TASK", raw_json: { detection_id: "DET-z" } } }))
            .toEqual({ detectionId: "DET-z" })
    })
})
