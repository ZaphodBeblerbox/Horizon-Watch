import { describe, it, expect } from "vitest"
import { LAYER_GROUPS, isLayerOn, countActive, clampOpacity, nothingOn } from "./layerRailConfig.js"

describe("LAYER_GROUPS", () => {
    // "threatHeatmap" and "showStrategicZones" are deliberately absent:
    // GlobeThreatHeatmapLayer (hardcoded region rectangles plus a dot per
    // active alert) and GlobeStrategicZonesLayer (the conflict-zone polygons)
    // were both removed, so the rail must not offer a layer nothing renders.
    it("covers every real layer key from the pre-rebuild LayersPanel exactly once", () => {
        const expectedKeys = [
            "satellite", "shippingLanes", "oim", "adsb", "aisVessels", "eez", "cityLabels",
            "derivedAlerts", "precisionEvents", "unifiedEvents",
            // "cctvFeeds" was removed with GlobeCameraLayer: two public
            // webcams behind a rail switch, no backend, and not used.
            "chokepoints", "cables", "airports", "ports",
            "aisHeatmap", "adsbHeatmap",
            // Added deliberately, not inherited from the old panel: GDELT
            // cannot share the News switch with GeoConfirmed, because one is
            // a machine that read a wire story and the other is a human who
            // found the building in the video. Listed here so the guard keeps
            // doing its job — it exists to catch keys that appear by accident.
            "gdeltEvents",
            // Nav interference, its own switch under Air — it is not where
            // aircraft ARE, it is where they are losing their fix.
            "gpsInterference",
            // Also deliberate: FIRMS thermal anomalies are what task
            // imagery, and the feed has been running for weeks with no way
            // to see its own output.
            "fires",
        ]
        const actualKeys = LAYER_GROUPS.flatMap(g => g.layers.map(l => l.key))
        expect(new Set(actualKeys)).toEqual(new Set(expectedKeys))
        expect(actualKeys.length).toBe(new Set(actualKeys).size) // no duplicates across groups
    })

    it("puts the cross-domain alerts layer in its own flagged group, not a single domain", () => {
        const alertsGroup = LAYER_GROUPS.find(g => g.key === "alerts")
        expect(alertsGroup.crossDomain).toBe(true)
        // "forgeAlerts" drew a marker per alerts-table row — several thousand
        // sanctioned-vessel dots. The derived surge/fusion findings replace it.
        expect(alertsGroup.layers.map(l => l.key)).toEqual(["derivedAlerts"])
    })
})

describe("isLayerOn", () => {
    it("reads an explicit true/false from the active map", () => {
        expect(isLayerOn({ aisVessels: true }, { key: "aisVessels" })).toBe(true)
        expect(isLayerOn({ aisVessels: false }, { key: "aisVessels" })).toBe(false)
    })

    it("is off when absent from active — nothing is on by default (owner, 2026-10-18)", () => {
        expect(isLayerOn({}, { key: "forgeAlerts", defaultOn: true })).toBe(false)
        expect(isLayerOn({}, { key: "aisVessels" })).toBe(false)
        expect(isLayerOn(undefined, { key: "aisVessels" })).toBe(false)
    })
})

describe("countActive", () => {
    it("counts only the layers actually on within a group", () => {
        const group = { layers: [{ key: "a" }, { key: "b" }, { key: "c" }] }
        expect(countActive({ a: true, c: false }, group)).toBe(1)
    })
})

describe("first run: nothing on (owner, 2026-10-18)", () => {
    it("no desktop layer definition defaults on", () => {
        for (const g of LAYER_GROUPS) for (const l of g.layers) {
            expect(l.defaultOn, l.key).toBeFalsy()
            expect(isLayerOn({}, l), l.key).toBe(false)
        }
    })
    it("nothingOn reads every map it is given", () => {
        expect(nothingOn({ a: false }, {}, null)).toBe(true)
        expect(nothingOn({ a: false }, { b: true })).toBe(false)
    })
})

describe("clampOpacity", () => {
    it("clamps into [0,1]", () => {
        expect(clampOpacity(1.5)).toBe(1)
        expect(clampOpacity(-0.2)).toBe(0)
        expect(clampOpacity(0.7)).toBe(0.7)
    })

    it("falls back to 0.9 for non-numeric input", () => {
        expect(clampOpacity(undefined)).toBe(0.9)
        expect(clampOpacity(NaN)).toBe(0.9)
        expect(clampOpacity("0.5")).toBe(0.9)
    })
})
