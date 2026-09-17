import { describe, it, expect } from "vitest"
import { INSPECTOR_TYPES } from "./GlobePopup.jsx"

describe("GlobePopup INSPECTOR_TYPES", () => {
    it("routes all 16 entity-bearing popup types to the unified InspectorPanel", () => {
        // Real drift fix: "geoconfirmed" was added to INSPECTOR_TYPES in an
        // earlier round (the GeoConfirmed map-layer integration) but this
        // test's expected list was never updated to match — caught by
        // running the full suite during this round's Globe-crash fixes.
        expect([...INSPECTOR_TYPES].sort()).toEqual([
            "aircraft", "airport", "alert", "assessment", "cable", "chokepoint",
            "eez", "event", "fusion", "geoconfirmed", "heatmap_cell", "infra", "port",
            "sentinel_detection", "surge", "vessel",
        ].sort())
    })

    it("carries both of §A8's derived marks, so a click on one opens the inspector", () => {
        // "surge" was missing while "fusion" was already present for the old
        // fusion_events, so a click on a surge fell through to the raw-html
        // popup — which had no html, and so did nothing at all.
        expect(INSPECTOR_TYPES.has("surge")).toBe(true)
        expect(INSPECTOR_TYPES.has("fusion")).toBe(true)
    })

    it("deliberately excludes html — the raw entity-description fallback", () => {
        expect(INSPECTOR_TYPES.has("html")).toBe(false)
        // threat_region went with GlobeThreatHeatmapLayer, the only thing that
        // ever registered one.
        expect(INSPECTOR_TYPES.has("threat_region")).toBe(false)
    })
})
