import { describe, it, expect } from "vitest"
import {
    arrowHead, claimMapLabel, claimRing, claimStyle, claimSummary, milSymbol, movementArrow, overlayUrl,
    movementLabel, movementStyle, movementSummary, movementSymbolPoint, pillUri, shortDay, siegeLabel,
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

describe("movements followed over the days, and sieges", () => {
    const ev = (role, place, day, time, url) => ({ role, place, day, time, act: "assault", sources: [{ url }] })
    const leg = (n, extra = {}) => ({
        id: `move-${n}`, kind: "leg", leg: n, path_legs: 2, path_id: "path-a", side: "red", side_name: "Houthis", actor: "Houthis",
        from: { lat: 13.6, lon: 44.0 }, to: { lat: 13.7, lon: 44.12 }, to_day: "13 Oct", target_name: "Jabal Habashi, Yemen",
        from_basis: "inferred: Houthis at Al-Ma'afer on 12 Oct, at Jabal Habashi on 13 Oct, 17 km apart",
        distance_km: 17.2, gap_hours: 24, unit_known: false, unit_label: null, sidc: "SHGPU----------",
        evidence: [ev("from", "Al-Ma'afer", "12 Oct", "2026-10-12T08:00:00Z", "u1"), ev("to", "Jabal Habashi", "13 Oct", "2026-10-13T08:00:00Z", "u2")],
        ...extra,
    })
    it("makes later legs of a path more opaque, numbers and dates each joint, and puts the symbol at the newest head", () => {
        const first = movementStyle(leg(1)), last = movementStyle(leg(2, { tip: true }))
        expect(last.alpha).toBe(1)
        expect(first.alpha).toBeLessThan(last.alpha)
        expect(first.joint).toBe("1 · 13 Oct")
        expect(first.symbolAt).toBe(null)
        expect(last.symbolAt).toBe("head")
        expect(movementSymbolPoint(leg(2, { tip: true }))).toEqual({ lat: 13.7, lon: 44.12 })
        expect(movementLabel(leg(1))).toEqual({ text: "1 · 13 Oct", at: { lat: 13.7, lon: 44.12 }, siege: false })
        // the path's first step is faint, with the day it began
        const start = movementStyle({ kind: "approach", leg: 0, path_legs: 2, to_day: "12 Oct" })
        expect(start).toMatchObject({ alpha: 0.4, joint: "0 · 12 Oct", symbolAt: null })
        // a lone arrow keeps its symbol at the tail and no joint
        expect(movementStyle({ kind: "approach", path_legs: 0 })).toMatchObject({ symbolAt: "tail", joint: null })
    })
    it("explains a leg as an inference from two events, in plain words", () => {
        const s = movementSummary(leg(1))
        expect(s).toMatch(/^Houthis · leg 1 of 2 → Jabal Habashi, Yemen\./)
        expect(s).toMatch(/Inferred, not reported: reports place Houthis at Al-Ma'afer on 12 Oct \(fought\), then at Jabal Habashi on 13 Oct \(fought\), 17 km and 1 day apart\./)
        expect(s).toMatch(/no source says it did/)
        expect(s).toMatch(/2 sources/)
        expect(movementSummary(leg(2, { tip: true }))).toMatch(/newest step/)
    })
    it("says why a single arrow is single", () => {
        const s = movementSummary({ kind: "approach", actor: "Houthis", act: "assault", target_name: "Marib", from: { lat: 1, lon: 1 },
                                    from_basis: "no earlier event by Houthis within 4 days and 60 km — single arrow from Sanaa (configured rear area)" })
        expect(s).toMatch(/no earlier event by Houthis within 4 days/)
        expect(s).toMatch(/our reading, not the source's/)
    })
    const siege = (i, extra = {}) => ({
        id: `siege-s-${i}`, kind: "siege", siege_index: i, side: "red", side_name: "Houthis", actor: "Houthis", compass: "south",
        basis_kind: "own_events", from: { lat: 13.45, lon: 44.02 }, to: { lat: 13.55, lon: 44.02 }, centre: { lat: 13.58, lon: 44.02 },
        target_name: "Ta'izz, Yemen", from_basis: "inferred: Ta'izz reported besieged on 4 Oct; from the south, toward Al-Ma'afer, where Houthis fought on 9 Oct (15 km)",
        siege: { place: "Ta'izz", reported_day: "4 Oct", quote: "Houthi forces besiege Ta'izz city", approaches: 5,
                 blocked: [{ compass: "west", why: "open sea" }], terrain_note: "approaches over open sea are left out (Natural Earth coastline, coarse); mountains are not read" },
        ...extra,
    })
    it("draws a siege as converging arrows: open approaches dashed, the place named once", () => {
        expect(movementStyle(siege(0))).toMatchObject({ dash: false, symbolAt: "tail" })
        expect(movementStyle(siege(1, { basis_kind: "open" })).dash).toBe(true)
        expect(siegeLabel(siege(0))).toBe("Besieged · Ta'izz · reported 4 Oct")
        expect(siegeLabel(siege(1))).toBe(null)
        expect(movementLabel(siege(0))).toMatchObject({ at: { lat: 13.58, lon: 44.02 }, siege: true })
        expect(movementSymbolPoint(siege(0))).toEqual({ lat: 13.45, lon: 44.02 })
    })
    it("explains the ring: the report, the bearing's basis, the sea, and what is not read", () => {
        const s = movementSummary(siege(0))
        expect(s).toMatch(/siege of Ta'izz/)
        expect(s).toMatch(/\("Houthi forces besiege Ta'izz city"\)/)
        expect(s).toMatch(/5 arrows converging/)
        expect(s).toMatch(/from the south, where reports place Houthis in the fighting \(toward Al-Ma'afer, where Houthis fought on 9 Oct/)
        expect(s).toMatch(/None from the west: open sea\./)
        expect(s).toMatch(/mountains are not read/)
        expect(movementSummary(siege(1, { basis_kind: "open", compass: "north" }))).toMatch(/from the north, is an open approach on land/)
    })
    it("draws a joint pill in a sans face, never a typewriter one", () => {
        const p = pillUri("2 · 13 Oct", "#e5484d")
        const svg = decodeURIComponent(p.uri.split(",")[1])
        expect(svg).toMatch(/sans-serif/)
        expect(svg).not.toMatch(/mono|courier/i)
        expect(p.width).toBeGreaterThan(30)
        expect(shortDay("2026-10-13T23:30:00Z")).toBe("13 Oct")
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
