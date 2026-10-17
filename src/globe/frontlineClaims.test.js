import { describe, it, expect } from "vitest"
import {
    arrowHead, claimMapLabel, claimRing, claimStyle, claimSummary, milSymbol, movementArrow, overlayUrl,
    trajectoryPath, trajectorySummary, replaySeconds, FRONTLINE_LAYERS, SIDE_COLOURS, factionCountry,
} from "./frontlineClaims.js"
import { haversineKm, positionAlong, pathLengthKm } from "./vesselThreat.js"
import { SUB_LAYERS } from "../components/layerRailConfig.js"

const circle = (lat, lon, d = 0.03) => ({ type: "Polygon", coordinates: [[[lon - d, lat], [lon, lat + d], [lon + d, lat], [lon, lat - d], [lon - d, lat]]] })

describe("claims", () => {
    const base = { id: "c1", side: "red", colour: "#e5484d", actor: "Russia", target_name: "Kupiansk, Kharkiv Oblast", lat: 49.7, lon: 37.6,
                   geometry: circle(49.7, 37.6), radius_km: 4, status: "claimed" }
    it("hatches and dashes a claim nobody has confirmed, in the claimant's colour", () => {
        expect(claimStyle(base)).toMatchObject({ hatch: true, dash: true, color: "#e5484d", label: "Claimed, unverified" })
        expect(claimMapLabel(base)).toBe("CLAIMED, unverified · Kupiansk\nby Russia")
    })
    it("goes solid when confirmed, grey when expired or contradicted", () => {
        expect(claimStyle({ ...base, status: "confirmed" })).toMatchObject({ hatch: false, dash: false, color: "#e5484d" })
        expect(claimStyle({ ...base, status: "expired" }).color).toBe(SIDE_COLOURS.unknown)
        expect(claimStyle({ ...base, status: "contradicted" }).color).toBe(SIDE_COLOURS.unknown)
        expect(claimStyle({ ...base, status: "expired" }).fill).toBeLessThan(claimStyle(base).fill)
    })
    it("reads the GeoJSON ring as lat/lon", () => {
        const r = claimRing(base)
        expect(r).toHaveLength(5)
        expect(r[0]).toEqual({ lat: 49.7, lon: 37.57 })
        expect(claimRing({})).toEqual([])
    })
    it("says it is a claim, never the line", () => {
        expect(claimSummary(base)).toMatch(/Russia claims Kupiansk/)
        expect(claimSummary(base)).toMatch(/never merged into the official line/)
    })
})

describe("movements", () => {
    const m = { id: "m1", from: { lat: 48.0, lon: 38.0 }, to: { lat: 48.1, lon: 37.8 }, side: "red", sidc: "SHGPUCI--------" }
    it("draws a shaft and a head that ends at the target", () => {
        const [[a, b], [l, tip, r]] = movementArrow(m)
        expect(a).toEqual({ lat: 48, lon: 38 })
        expect(b).toEqual(tip)
        expect(haversineKm(l, tip)).toBeCloseTo(haversineKm(r, tip), 3)
        // the barbs sit back toward the start
        expect(haversineKm(l, a)).toBeLessThan(haversineKm(tip, a))
    })
    it("draws no arrow without a start", () => {
        expect(movementArrow({ ...m, from: null })).toBeNull()
        expect(arrowHead({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toHaveLength(2)
    })
    it("renders an APP-6 symbol with milsymbol", () => {
        const s = milSymbol("SHGPUCI--------", { colour: "#e5484d" })
        expect(s.valid).toBe(true)
        expect(s.uri).toMatch(/^data:image\/svg\+xml/)
        expect(s.width).toBeGreaterThan(10)
        expect(milSymbol("SHGPUCI--------", { colour: "#e5484d" })).toBe(s)
    })
})

describe("trajectories", () => {
    const from = { lat: 48.92, lon: 40.4, name: "Millerovo", assumed: true, basis: "assumed origin — nearest known drone launch area" }
    const to = { lat: 48.61, lon: 37.67 }
    it("flies a drone low (100–500 m) from origin to target", () => {
        const p = trajectoryPath({ id: "t1", kind: "drone", from, to })
        expect(haversineKm(p[0], from)).toBeLessThan(0.01)
        expect(haversineKm(p.at(-1), to)).toBeLessThan(0.01)
        expect(Math.max(...p.map((x) => x.alt))).toBeLessThanOrEqual(500)
        expect(positionAlong(p, pathLengthKm(p)).done).toBe(true)
    })
    it("puts a ballistic missile on a high arc and a cruise missile on a low one", () => {
        const peak = (kind, apogee_km) => Math.max(...trajectoryPath({ id: kind, kind, from, to, apogee_km }).map((x) => x.alt))
        expect(peak("ballistic", 50)).toBeCloseTo(50_000, -2)
        expect(peak("cruise", 6)).toBeCloseTo(6_000, -2)
        expect(peak("ballistic", 50)).toBeGreaterThan(peak("cruise", 6) * 5)
        const mid = trajectoryPath({ id: "b", kind: "ballistic", from, to, apogee_km: 50 })[32]
        expect(mid.alt).toBeCloseTo(50_000, -2)
    })
    it("says when the origin is assumed", () => {
        expect(trajectorySummary({ kind: "drone", kind_label: "Drone (Shahed/Geran-class)", actor: "Russia", from, to, target_name: "Klynove" }))
            .toMatch(/From Millerovo — ASSUMED origin/)
        expect(replaySeconds({ flight_minutes: 67 })).toBeGreaterThan(replaySeconds({ flight_minutes: 4 }))
        expect(trajectoryPath({ kind: "drone", from: null, to })).toEqual([])
    })
})

describe("wiring", () => {
    it("names the three layers as sub-layers of News, so the theater editor offers them", () => {
        for (const l of FRONTLINE_LAYERS) expect(SUB_LAYERS.find((s) => s.key === l.key)?.parent).toBe("news")
    })
    it("asks the overlay with a bounded window", () => {
        expect(overlayUrl("", 9999)).toBe("/api/frontlines/overlay?hours=720")
        expect(overlayUrl("http://x")).toBe("http://x/api/frontlines/overlay?hours=168")
    })
})

describe("factionCountry — the flag beside ground taken and movements", () => {
    it("names a country by the actor, then the side", () => {
        expect(factionCountry({ actor: "Russia" })?.iso2).toBe("RU")
        expect(factionCountry({ actor: null, side_name: "Ukraine" })?.iso2).toBe("UA")
        expect(factionCountry({ side_name: "Saudi-led coalition" })?.iso2).toBe("SA")
    })
    it("gives a non-state side no flag", () => {
        expect(factionCountry({ side_name: "Houthis" })).toBe(null)
        expect(factionCountry({ side_name: "Rapid Support Forces" })).toBe(null)
        expect(factionCountry({})).toBe(null)
    })
})
