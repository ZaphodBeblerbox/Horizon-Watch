import { describe, it, expect, vi } from "vitest"
import {
    aircraftHex, isFlightContext, planBody, fmtMinutes, fmtExtra, exposureBar, arcHeights, arcDegreesHeights, arcPeak, planView,
    sourceLines, hazardColor, crossingLine, openAirRoute, closeAirRoute, getAirRoute, subscribeAirRoute, publishAirPlan, fetchAirPlan,
} from "./airRoute.js"
import { continuous } from "./airLayer.leaflet.js"

describe("is this a flight?", () => {
    it("reads the ICAO24 from the inspector's reference, an id or a hex", () => {
        expect(aircraftHex({ recordRef: "trk:adsb-4B1805" })).toBe("4b1805")
        expect(aircraftHex("trk:adsb-a1b2c3")).toBe("a1b2c3")
        expect(aircraftHex({ kind: "aircraft", id: "adsb-896180" })).toBe("896180")
        expect(aircraftHex({ icao: "896180" })).toBe("896180")
        expect(aircraftHex({ recordRef: "trk:244060000" })).toBe(null)        // a vessel
        expect(aircraftHex({ recordRef: "sig:ALT-1a2b3c" })).toBe(null)
    })
    it("relevant for an aircraft or a trip by air, not for a vessel or a trip by road", () => {
        expect(isFlightContext({ recordRef: "trk:adsb-4b1805" })).toBe(true)
        expect(isFlightContext({ kind: "trip", travel: "air", from: "FRA", to: "DXB" })).toBe(true)
        expect(isFlightContext({ kind: "trip", travel: "road", from: "FRA", to: "DXB" })).toBe(false)
        expect(isFlightContext({ recordRef: "trk:244060000" })).toBe(false)
        expect(isFlightContext(null)).toBe(false)
    })
    it("builds the request body only when complete", () => {
        expect(planBody({ icao: "4B1805" })).toEqual({ icao: "4b1805", mode: "plan" })
        expect(planBody({ from: "FRA", to: "DXB" }, "assess")).toEqual({ from: "FRA", to: "DXB", mode: "assess" })
        expect(planBody({ from: "FRA" })).toBe(null)
    })
    it("refuses to ask without both ends", async () => {
        const f = vi.fn()
        await expect(fetchAirPlan({ from: "FRA" }, "plan", f)).rejects.toThrow(/where from/)
        expect(f).not.toHaveBeenCalled()
    })
})

describe("words and numbers", () => {
    it("durations", () => {
        expect(fmtMinutes(47.4)).toBe("47 min")
        expect(fmtMinutes(200)).toBe("3 h 20 min")
        expect(fmtMinutes(120)).toBe("2 h")
        expect(fmtExtra(0.4)).toBe("no extra time")
        expect(fmtExtra(52.3)).toBe("+52 min")
    })
    it("exposure bars are relative to the worst on show, and never invisible when non-zero", () => {
        const cands = [{ score: { exposure: 150 } }, { score: { exposure: 1.5 } }, { score: { exposure: 0 } }]
        expect(cands.map((c) => exposureBar(c, cands))).toEqual([100, 3, 0])
        expect(exposureBar({ score: { exposure: 0 } }, [{ score: { exposure: 0 } }])).toBe(0)
    })
    it("a crossing in plain words", () => {
        expect(crossingLine({ name: "Iran (FIR Tehran OIIX)", minutes: 71.2, max_weight: 1 })).toBe("Iran (FIR Tehran OIIX) · 1 h 11 min · do-not-operate")
        expect(crossingLine({ name: "GPS interference near Abu Dhabi", minutes: 15, max_weight: 0.35 })).toMatch(/caution$/)
    })
    it("hazard colours by family", () => {
        expect(hazardColor({ kind: "gps" })).toBe("#F5A524")
        expect(hazardColor({ kind: "czib", weight: 1 })).toBe("#E5484D")
        expect(hazardColor({ kind: "czib", weight: 0.45 })).toBe("#F08A4B")
    })
    it("every source once, with its dates", () => {
        const plan = { sources: [
            { issuer: "EASA", ref: "CZIB-2026-04-R2", revised: "2026-09-30", valid_until: "2026-11-16", url: "https://x" },
            { issuer: "EASA", ref: "CZIB-2026-04-R2", revised: "2026-09-30" },
            { issuer: "GeoConfirmed", ref: "Missile strike", issued: "2026-10-11T08:00:00+00:00" },
        ] }
        const l = sourceLines(plan)
        expect(l).toHaveLength(2)
        expect(l[0]).toMatchObject({ text: "EASA — CZIB-2026-04-R2", dates: "revised 2026-09-30 · valid until 2026-11-16", url: "https://x" })
        expect(l[1].dates).toBe("issued 2026-10-11")
    })
})

describe("drawing", () => {
    it("an arc climbs, cruises and descends, ends on the ground", () => {
        const h = arcHeights(21, 10_000)
        expect(h[0]).toBe(0)
        expect(h[20]).toBe(0)
        expect(h[10]).toBe(10_000)
        expect(h[1]).toBeGreaterThan(0)
        expect(h[1]).toBeLessThan(10_000)
    })
    it("longitudes stay continuous across the antimeridian", () => {
        const flat = arcDegreesHeights([[35, 170], [35, 179], [35, -179], [35, -170]], 1000)
        const lons = flat.filter((_, i) => i % 3 === 0)
        expect(lons).toEqual([170, 179, 181, 190])
        expect(continuous([[35, 179], [35, -179]])).toEqual([[35, 179], [35, 181]])
    })
    it("the peak scales with the distance, within bounds", () => {
        expect(arcPeak(100)).toBe(25_000)
        expect(arcPeak(4844)).toBeGreaterThan(60_000)
        expect(arcPeak(20_000)).toBe(220_000)
    })
    it("frames the paths", () => {
        const v = planView({ candidates: [{ coords: [[50, 8.5], [25.2, 55.4]] }, { coords: [[50, 8.5], [30, 31], [25.2, 55.4]] }] })
        expect(v.lat).toBeCloseTo(37.6, 1)
        expect(v.lon).toBeCloseTo(31.95, 1)
        expect(v.altitude).toBeGreaterThan(5_000_000)
        expect(planView({ candidates: [{ coords: [[35, 170], [35, -170]] }] }).lon).toBeCloseTo(180, 0)
        expect(planView(null)).toBe(null)
    })
})

describe("the store", () => {
    it("opens on a flight, publishes the plan, closes", () => {
        const seen = []
        const off = subscribeAirRoute((s) => seen.push(s.open))
        openAirRoute({ icao: "4b1805" })
        expect(getAirRoute()).toMatchObject({ open: true, ctx: { icao: "4b1805" }, plan: null })
        const p = { candidates: [] }
        publishAirPlan(p)
        expect(getAirRoute().plan).toBe(p)
        closeAirRoute()
        expect(getAirRoute().open).toBe(false)
        off()
        expect(seen).toEqual([true, true, false])
    })
})
