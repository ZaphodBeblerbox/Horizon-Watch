import { describe, it, expect } from "vitest"
import { routePositions, midpointOf } from "./GlobeFlowsLayer.jsx"

describe("trade and energy flows", () => {
    // The real Hormuz route out of shipping_routes.json.
    const HORMUZ = [[56.5, 26.5], [58, 24], [60, 22], [65, 18], [68, 15]]

    it("builds a position per usable waypoint", () => {
        expect(routePositions(HORMUZ)).toHaveLength(5)
    })

    it("drops unusable waypoints rather than throwing", () => {
        // Cartesian3.fromDegrees throws on a non-number, and a throw
        // during render unmounts the whole globe.
        const got = routePositions([[56.5, 26.5], [null, 5], ["x", "y"], [999, 999], [58, 24]])
        expect(got).toHaveLength(2)
    })

    it("survives empty and missing input", () => {
        expect(routePositions(null)).toEqual([])
        expect(routePositions([])).toEqual([])
    })

    it("labels a route at its middle, not its start", () => {
        // A label at the first waypoint sits on the chokepoint the route
        // leaves from, on top of that chokepoint's own marker.
        const mid = midpointOf(HORMUZ)
        expect(mid).toEqual({ lon: 60, lat: 22 })
    })

    it("has no midpoint for an empty route", () => {
        expect(midpointOf([])).toBeNull()
        expect(midpointOf(null)).toBeNull()
    })
})
