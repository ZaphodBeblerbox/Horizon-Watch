import { describe, it, expect } from "vitest"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { INSPECTOR_TYPES } from "./GlobePopup.jsx"

describe("GlobePopup INSPECTOR_TYPES", () => {
    it("routes all entity-bearing popup types to the unified InspectorPanel", () => {
        // Real drift fix: "geoconfirmed" was added to INSPECTOR_TYPES in an
        // earlier round (the GeoConfirmed map-layer integration) but this
        // test's expected list was never updated to match — caught by
        // running the full suite during this round's Globe-crash fixes.
        expect([...INSPECTOR_TYPES].sort()).toEqual([
            "aircraft", "airport", "alert", "assessment", "cable", "chokepoint",
            "country_risk", "eez", "event", "frontline", "fusion", "fusion_member",
            "gdelt_event", "geoconfirmed", "heatmap_cell", "infra", "port",
            "pipeline", "sentinel_detection", "surge", "telegram", "thermal_anomaly", "trade_route", "vessel",
            "facility_osm", "warmap_area", "gfw_event", "airspace",
            // Nav interference cells. Without this entry the click falls
            // through to the raw-html popup, which is exactly the failure
            // this test exists to catch.
            "gps_interference",
            // Our own assets: routed to their page in the register.
            "owned_asset",
            // OpenInfraMap objects (GlobeInfraLayer).
            "infra_feature",
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


// ── the invariant, not another hand-copied list ──────────────────────────
//
// This list has now drifted three times: "geoconfirmed" was added to the
// Set and not to the test, "surge" was added to the layer and not to the
// Set, and gdelt_event/thermal_anomaly/fusion_member arrived with the
// GDELT and FIRMS layers and reached neither. Every time, the symptom was
// a click that silently did nothing.
//
// A hardcoded expectation cannot catch the case that matters, because the
// failure IS someone forgetting to update a hardcoded list. So this reads
// the real registration sites instead: anything a layer registers with
// setEntity must be routable, or clicking it is dead.
describe("every registered entity type is routable", () => {
    const layerTypes = () => {
        // fileURLToPath, not .pathname: this repo's path contains a
        // space, which .pathname hands back as %20.
        const dir = fileURLToPath(new URL("./", import.meta.url))
        const files = fs.readdirSync(dir).filter(f => f.endsWith(".jsx"))
        const found = new Map()
        for (const f of files) {
            const src = fs.readFileSync(dir + f, "utf8")
            // setEntity(id, "type", data) — the second argument is the type.
            for (const m of src.matchAll(/setEntity\(\s*[^,]+,\s*["'`]([a-z_]+)["'`]/g)) {
                if (!found.has(m[1])) found.set(m[1], f)
            }
        }
        return found
    }

    it("finds the registration sites at all", () => {
        // If this ever returns nothing the test below passes vacuously and
        // stops protecting anything.
        expect(layerTypes().size).toBeGreaterThan(5)
    })

    it("has no layer registering a type the popup cannot route", () => {
        const unroutable = [...layerTypes().entries()]
            .filter(([t]) => !INSPECTOR_TYPES.has(t))
            .map(([t, f]) => `${t} (registered in ${f})`)
        expect(unroutable).toEqual([])
    })
})
