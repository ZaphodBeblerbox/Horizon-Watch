import { describe, it, expect } from "vitest"
import { INSPECTOR_TYPES } from "./GlobePopup.jsx"

describe("GlobePopup INSPECTOR_TYPES", () => {
    it("routes all 14 entity-bearing popup types to the unified InspectorPanel", () => {
        expect([...INSPECTOR_TYPES].sort()).toEqual([
            "aircraft", "airport", "alert", "assessment", "cable", "chokepoint",
            "eez", "event", "fusion", "heatmap_cell", "infra", "port",
            "sentinel_detection", "vessel",
        ].sort())
    })

    it("deliberately excludes threat_region and html — the 2 kept as bespoke floating popups", () => {
        expect(INSPECTOR_TYPES.has("threat_region")).toBe(false)
        expect(INSPECTOR_TYPES.has("html")).toBe(false)
    })
})
