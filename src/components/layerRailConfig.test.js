import { describe, it, expect } from "vitest"
import { LAYER_GROUPS, isLayerOn, countActive, clampOpacity } from "./layerRailConfig.js"

describe("LAYER_GROUPS", () => {
    // "threatHeatmap" and "showStrategicZones" are deliberately absent:
    // GlobeThreatHeatmapLayer (hardcoded region rectangles plus a dot per
    // active alert) and GlobeStrategicZonesLayer (the conflict-zone polygons)
    // were both removed, so the rail must not offer a layer nothing renders.
    it("covers every real layer key from the pre-rebuild LayersPanel exactly once", () => {
        const expectedKeys = [
            "satellite", "shippingLanes", "oim", "adsb", "aisVessels", "eez", "cityLabels",
            "derivedAlerts", "precisionEvents", "unifiedEvents",
            "chokepoints", "cables", "cctvFeeds", "airports", "ports",
            "aisHeatmap", "adsbHeatmap",
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

    it("falls back to the layer's own defaultOn when absent from active", () => {
        expect(isLayerOn({}, { key: "forgeAlerts", defaultOn: true })).toBe(true)
        expect(isLayerOn({}, { key: "aisVessels" })).toBe(false)
        expect(isLayerOn(undefined, { key: "aisVessels" })).toBe(false)
    })
})

describe("countActive", () => {
    it("counts only the layers actually on within a group", () => {
        const group = { layers: [{ key: "a" }, { key: "b", defaultOn: true }, { key: "c" }] }
        expect(countActive({ a: true, c: false }, group)).toBe(2) // a=true, b defaults true
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
