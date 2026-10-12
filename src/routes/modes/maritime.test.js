import { describe, it, expect, vi } from "vitest"
import {
    deltaText, exposureBar, riskLevel, ringLatLngs, zonesLine, hazardStats, sourceList, canPlan, toBody, placeLabel,
    relevant, requestFromContext, hazardsUsed, openSeaRoute, getSeaRoute, updateSeaRequest, closeSeaRoute, planSeaRoute, fmtNm,
} from "./maritimeCore.js"

const cape = { key: "cape", label: "Via the Cape of Good Hope", days: 29.1, distance_nm: 11860, extra_days: 8.6, extra_nm: 3488, shortest: false,
               exposure: { risk_hours: 3, zones: [{ id: "gnss", name: "GPS interference", hours: 26, risk: 2.6, members: ["g1", "g2"] }] } }
const suez = { key: "suez", label: "Via Suez", days: 20.5, distance_nm: 8372, extra_days: 0, extra_nm: 0, shortest: true,
               exposure: { risk_hours: 60, zones: [{ id: "red-sea-strike", name: "Red Sea strike zone", hours: 69.4, risk: 38.5, members: ["red-sea-strike"] },
                                                   { id: "somali-piracy", name: "Somali basin piracy area", hours: 43, risk: 12.9, members: ["somali-piracy"] }] } }

describe("maritime words and numbers", () => {
    it("says the extra days and distance against the shortest", () => {
        expect(deltaText(cape)).toBe("+8.6 days, +3,488 nm")
        expect(deltaText(suez)).toBe("Shortest")
        expect(fmtNm(8372.4)).toBe("8,372 nm")
    })
    it("scales exposure bars to the worst candidate and names the level", () => {
        expect(exposureBar(suez, 60)).toMatchObject({ pct: 100, label: "60 risk-hours · severe" })
        expect(exposureBar(cape, 60).pct).toBe(5)
        expect(exposureBar({ exposure: { risk_hours: 0 } }, 60).pct).toBe(0)
        expect([riskLevel(1), riskLevel(10), riskLevel(30), riskLevel(90)]).toEqual(["low", "moderate", "high", "severe"])
    })
    it("lists the zones a route crosses", () => {
        expect(zonesLine(suez)).toBe("Red Sea strike zone 69 h · Somali basin piracy area 43 h")
        expect(zonesLine({ exposure: { zones: [] } })).toBe("No listed hazard on the way")
    })
    it("closes rings and drops bad points", () => {
        expect(ringLatLngs({ ring: [[0, 0], [0, 1], [1, 1], ["x", 2]] })).toEqual([[0, 0], [0, 1], [1, 1], [0, 0]])
        expect(ringLatLngs({ ring: [[0, 0], [0, 1], [1, 1], [0, 0]] })).toHaveLength(4)
    })
    it("describes live stats and de-duplicates sources", () => {
        expect(hazardStats({ stats: { events_30d: 16, shipping_30d: 1 } })).toBe("16 conflict events in 30 days, 1 against shipping or at sea")
        expect(sourceList({ sources: [{ label: "A" }, { label: "A" }, { label: "B" }, null] }).map((s) => s.label)).toEqual(["A", "B"])
    })
    it("collapses GPS cells into one hazard and keeps only crossed ones", () => {
        const plan = { candidates: [cape, suez], hazards: [
            { id: "red-sea-strike", kind: "strike", weight: 0.55 }, { id: "somali-piracy", kind: "piracy", weight: 0.3 },
            { id: "gulf-of-guinea", kind: "piracy", weight: 0.3 }, { id: "g1", kind: "gnss", weight: 0.1 }, { id: "g2", kind: "gnss", weight: 0.2 }] }
        const used = hazardsUsed(plan)
        expect(used.map((h) => h.id)).toEqual(["red-sea-strike", "somali-piracy", "gnss"])
        expect(used[2]).toMatchObject({ cells: 2, weight: 0.2 })
    })
})

describe("maritime request", () => {
    it("needs an origin and a destination", () => {
        expect(canPlan({ origin: { mmsi: "1" }, destination: null })).toBe(false)
        expect(canPlan({ origin: { mmsi: "1" }, destination: { lat: 51.9, lon: 4.4 } })).toBe(true)
        expect(canPlan({ origin: { port: "SGSIN" }, destination: { port: "NLRTM" } })).toBe(true)
    })
    it("builds the body, numbers only when given", () => {
        expect(toBody({ origin: { port: "a" }, destination: { port: "b" }, speed_kn: "", day_value: "6", avoid: ["suez"] }))
            .toEqual({ origin: { port: "a" }, destination: { port: "b" }, avoid: ["suez"], day_value: 6 })
        expect(toBody({ origin: {}, destination: {}, speed_kn: "13.5" }).speed_kn).toBe(13.5)
    })
    it("labels places", () => {
        expect(placeLabel({ mmsi: "123" })).toBe("MMSI 123")
        expect(placeLabel({ lat: 1.2345, lon: 103.8 })).toBe("1.23, 103.80")
        expect(placeLabel(null)).toBe("—")
    })
    it("posts to /api/routes/sea", async () => {
        const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, candidates: [] }) })
        await planSeaRoute({ origin: { port: "SGSIN" } }, f)
        expect(f.mock.calls[0][0]).toMatch(/\/api\/routes\/sea$/)
        expect(f.mock.calls[0][1].method).toBe("POST")
    })
    it("store opens, updates and closes", () => {
        openSeaRoute({ origin: { mmsi: "1" } })
        const seq = getSeaRoute().seq
        updateSeaRequest({ destination: { port: "NLRTM" } })
        expect(getSeaRoute()).toMatchObject({ open: true, request: { origin: { mmsi: "1" }, destination: { port: "NLRTM" }, avoid: [] } })
        expect(getSeaRoute().seq).toBe(seq + 1)
        closeSeaRoute()
        expect(getSeaRoute().open).toBe(false)
    })
})

describe("when to offer a sea route", () => {
    const seaContext = { relevant: true, offer: "Plan a safer sea route", reasons: ["Its destination Rotterdam takes it through the Red Sea strike zone."],
                         vessel: { mmsi: "1", name: "TEST", ship_type: "Tanker" }, destination: { name: "Rotterdam", locode: "NLRTM", lat: 51.9, lon: 4.44 },
                         default_speed_kn: 13 }
    it("offers only for a vessel the server says is exposed", () => {
        expect(relevant({ entityType: "vessel", mmsi: "1", seaContext })).toMatchObject({ offer: "Plan a safer sea route", why: seaContext.reasons[0] })
        expect(relevant({ entityType: "vessel", mmsi: "1", seaContext: { relevant: false } })).toBe(false)
        expect(relevant({ entityType: "aircraft", mmsi: "1", seaContext })).toBe(false)
        expect(relevant({ entityType: "vessel" })).toBe(false)
        expect(relevant(null)).toBe(false)
    })
    it("opens from the vessel to its destination at its type's speed", () => {
        expect(requestFromContext({ mmsi: "1", seaContext })).toEqual({
            origin: { mmsi: "1", name: "TEST" }, destination: { lat: 51.9, lon: 4.44, name: "Rotterdam (NLRTM)" },
            speed_kn: 13, ship_type: "Tanker", avoid: [],
        })
    })
})
