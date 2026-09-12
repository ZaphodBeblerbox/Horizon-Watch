import { describe, it, expect } from "vitest"
import { INSPECTOR_TYPES } from "./GlobePopup.jsx"

describe("GlobePopup INSPECTOR_TYPES", () => {
    it("routes all 15 entity-bearing popup types to the unified InspectorPanel", () => {
        // Real drift fix: "geoconfirmed" was added to INSPECTOR_TYPES in an
        // earlier round (the GeoConfirmed map-layer integration) but this
        // test's expected list was never updated to match — caught by
        // running the full suite during this round's Globe-crash fixes.
        expect([...INSPECTOR_TYPES].sort()).toEqual([
            "aircraft", "airport", "alert", "assessment", "cable", "chokepoint",
            "eez", "event", "fusion", "geoconfirmed", "heatmap_cell", "infra", "port",
            "sentinel_detection", "vessel",
        ].sort())
    })

    it("deliberately excludes threat_region and html — the 2 kept as bespoke floating popups", () => {
        expect(INSPECTOR_TYPES.has("threat_region")).toBe(false)
        expect(INSPECTOR_TYPES.has("html")).toBe(false)
    })
})
