import { describe, it, expect, vi } from "vitest"
import {
    alertRaw, areaBox, boxToFrame, findingCaption, findingsBounds, findingsFromAlert, findingToOutline, findingZoneOf,
    isFindingAlert, normalizeFinding, showFindings, subscribeFindings, getShownFindings, TONE,
} from "./findings.js"
import { leafletBounds } from "../mobile/findingsLeaflet.js"

const ZONE = { min_lon: 30.0, min_lat: 50.0, max_lon: 30.2, max_lat: 50.1 }

describe("findings — boxes on the ground, drawn everywhere", () => {
    it("a box in degrees lands on the image frame (y down from the north edge)", () => {
        const f = boxToFrame([30.05, 50.03, 30.07, 50.05], ZONE)
        expect(f.map((v) => +v.toFixed(6))).toEqual([0.25, 0.5, 0.1, 0.2])
        expect(boxToFrame(null, ZONE)).toBeNull()
    })
    it("an area-sized square when no extent was kept", () => {
        const [w, s, e, n] = areaBox(50, 30, 10000)
        expect((n - s) * 110574).toBeCloseTo(100, 0)
        expect((e - w) * 111320 * Math.cos((50 * Math.PI) / 180)).toBeCloseTo(100, 0)
    })
    it("a sweep alert's raw finding becomes a red labelled box; an old one says its size is estimated", () => {
        const alert = { alert_id: "A1", alert_type: "Imagery signal", entity_type: "sweep_finding", entity_id: "ZONE-61",
            raw_json: { id: "A1", raw_json: { zone_id: "ZONE-61", kind: "sweep_find", scan_id: "SW1", findings: [
                { kind: "new tent/vehicle cluster", lat: 52.0, lon: 29.0, appeared_m2: 40000, cleared_m2: 0, box: [28.99, 51.99, 29.01, 52.01], box_source: "pixel_extent" },
                { kind: "new cleared/disturbed ground", lat: 52.1, lon: 29.1, appeared_m2: 0, cleared_m2: 160000 },
            ] } }, created_at: "2026-10-11T08:00:00" }
        expect(alertRaw(alert).zone_id).toBe("ZONE-61")
        expect(isFindingAlert(alert)).toBe(true)
        expect(findingZoneOf(alert)).toBe("ZONE-61")
        const fs = findingsFromAlert(alert)
        expect(fs).toHaveLength(2)
        expect(fs[0]).toMatchObject({ label: "Possible tent or vehicle group", tone: "red", box: [28.99, 51.99, 29.01, 52.01], box_source: "pixel_extent", size: "4.0 ha", zone_id: "ZONE-61" })
        expect(fs[1]).toMatchObject({ label: "Cleared or disturbed ground", tone: "amber", box_source: "area_estimate", size: "16 ha" })
        expect(findingCaption(fs[0])).toBe("Possible tent or vehicle group · 4.0 ha · 11 Oct")
    })
    it("a radar change alert (RCHG-…) carries its zone in its id and its regions in change.where", () => {
        const a = { alert_id: "RCHG-ZONE-005-2026-10-11", raw_json: { change: { until: "2026-10-11", where: [
            { lat: 48.46, lon: 38.2, direction: "appeared", area_m2: 13900 }, { lat: 48.48, lon: 38.21, direction: "removed", area_m2: 11500 }] } } }
        expect(findingZoneOf(a)).toBe("ZONE-005")
        const fs = findingsFromAlert(a)
        expect(fs.map((f) => f.tone)).toEqual(["red", "amber"])
        expect(fs[0].label).toMatch(/bright/)
        expect(fs[1].date).toBe("2026-10-11")
    })
    it("an outline for the Imagery viewer: colour, caption, fraction of the image", () => {
        const f = normalizeFinding({ label: "Radar change — new bright returns", lat: 50.04, lon: 30.06, box: [30.05, 50.03, 30.07, 50.05], tone: "red", size: "1.4 ha", date: "2026-10-11", id: "chg:X" })
        const o = findingToOutline(f, ZONE)
        expect(o.color).toBe(TONE.red)
        expect(o.caption).toBe("Radar: new returns · 1.4 ha · 11 Oct")
        expect(o.bbox.map((v) => +v.toFixed(4))).toEqual([0.25, 0.5, 0.1, 0.2])
    })
    it("bounds around all, and Leaflet's [[s, w], [n, e]]", () => {
        expect(findingsBounds([{ box: [1, 2, 3, 4] }, { box: [0, 3, 2, 5] }])).toEqual([0, 2, 3, 5])
        expect(leafletBounds([1, 2, 3, 4])).toEqual([[2, 1], [4, 3]])
    })
    it("the store tells every map, and clears", () => {
        const fn = vi.fn()
        const off = subscribeFindings(fn)
        showFindings({ zoneId: "ZONE-1", findings: [{ id: "a", box: [1, 2, 3, 4] }], fit: true })
        expect(fn).toHaveBeenLastCalledWith(expect.objectContaining({ zoneId: "ZONE-1", fit: true }))
        showFindings({ zoneId: "ZONE-1", findings: [] })
        expect(getShownFindings()).toBeNull()
        off()
    })
    it("other alerts are not findings", () => {
        expect(isFindingAlert({ alert_type: "Heat", id: "HEAT-1" })).toBe(false)
        expect(findingZoneOf({ alert_type: "Heat", entity_id: "ZONE-1" })).toBeNull()
    })
})

import { labelRanks, mapCaption } from "./findings.js"
describe("map captions stay readable", () => {
    it("red first, then the biggest; the wording is short", () => {
        const fs = [{ id: "a", tone: "amber", area_m2: 90000 }, { id: "b", tone: "red", area_m2: 1000 }, { id: "c", tone: "amber", area_m2: 100 }]
        const r = labelRanks(fs)
        expect([r.get("b"), r.get("a"), r.get("c")]).toEqual([0, 1, 2])
        expect(mapCaption({ label: "Radar change — returns gone (darker)", area_m2: 5300, date: "2026-10-11" })).toBe("Radar: returns gone · 5,300 m² · 11 Oct")
    })
})

import { boxToPixels, datesText, findingSource, isRadarFinding, sameSource, strengthText } from "./findings.js"
import { radarMeaning, RADAR_BRIGHTER, RADAR_DARKER } from "./radarExplain.js"
describe("a finding on the image it was found in", () => {
    // a 20 km sweep tile rendered at 1024 × 1024 on an EPSG:4326 grid
    const TILE = [37.167361, 50.592885, 37.457731, 50.77686]
    it("maps a box in degrees to the image's pixels (x east, y down from the north edge)", () => {
        const dx = TILE[2] - TILE[0], dy = TILE[3] - TILE[1]
        // the box covering pixels x 100–150, y 200–260
        const box = [TILE[0] + (100 / 1024) * dx, TILE[3] - (260 / 1024) * dy, TILE[0] + (150 / 1024) * dx, TILE[3] - (200 / 1024) * dy]
        const px = boxToPixels(box, TILE, 1024, 1024)
        expect(px[0]).toBeCloseTo(100, 6); expect(px[1]).toBeCloseTo(200, 6)
        expect(px[2]).toBeCloseTo(50, 6); expect(px[3]).toBeCloseTo(60, 6)
        // the same box on a non-square render keeps its place
        const half = boxToPixels(box, TILE, 512, 1024)
        expect(half[0]).toBeCloseTo(50, 6); expect(half[1]).toBeCloseTo(200, 6)
        expect(boxToPixels(box, null, 1024, 1024)).toBeNull()
        expect(boxToPixels(box, TILE, 0, 1024)).toBeNull()
    })
    it("radar findings go on their comparison, objects on their pass; the image's other boxes come along", () => {
        const a = { id: "sweep:Z:0", kind: "sweep_find", scan_id: "S1" }
        const b = { id: "sweep:Z:1", kind: "sweep_find", scan_id: "S1" }
        const c = { id: "chg:x", kind: "radar_change", scan_id: "C2" }
        const d = { id: "det:1", kind: "object", scan_id: "S1" }
        expect(isRadarFinding(a) && isRadarFinding(c) && !isRadarFinding(d)).toBe(true)
        expect(findingSource(a)).toBe("radar:S1")
        expect(findingSource(d)).toBe("scene:S1")
        expect(sameSource([a, b, c, d], b).map((x) => x.id)).toEqual(["sweep:Z:1", "sweep:Z:0"])
        expect(sameSource([a, b, c, d], { id: "n" })).toEqual([{ id: "n" }])
    })
    it("says how strong it is: radar |t|, a detector's confidence", () => {
        expect(strengthText({ t_peak: -16.79 })).toBe("strength 16.8")
        expect(strengthText({ confidence: 0.87 })).toBe("87% confidence")
        expect(strengthText({})).toBeNull()
    })
    it("names the dates a radar stack was made of", () => {
        expect(datesText(["2026-10-10", "2026-10-09", "2026-10-07"])).toBe("7–10 Oct · 3 passes")
        expect(datesText(["2026-08-28", "2026-09-02"])).toBe("28 Aug – 2 Sep · 2 passes")
        expect(datesText([])).toBeNull()
    })
    it("explains brighter and darker in plain words", () => {
        expect(radarMeaning({ kind: "sweep_find", label: "Possible tent or vehicle group" })).toBe(RADAR_BRIGHTER)
        expect(radarMeaning({ kind: "sweep_find", label: "Cleared or disturbed ground" })).toBe(RADAR_DARKER)
        expect(radarMeaning({ kind: "radar_change", direction: "removed" })).toBe(RADAR_DARKER)
        expect(radarMeaning({ kind: "object" })).toBeNull()
        expect(RADAR_BRIGHTER).toMatch(/vehicles, containers, metal-framed tents/)
    })
})
