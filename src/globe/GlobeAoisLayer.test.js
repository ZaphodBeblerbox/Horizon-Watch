import { describe, it, expect, vi } from "vitest"

vi.mock("resium", () => ({ Entity: () => null, useCesium: () => ({}) }))
vi.mock("cesium", () => {
    const C = { fromCssColorString: () => ({ withAlpha: () => ({}) }) }
    return { CallbackProperty: function () {}, Cartesian2: function () {}, Cartesian3: { fromDegrees: () => ({}), fromDegreesArray: () => [] },
             Color: { ...C, WHITE: {} }, ColorMaterialProperty: function () {}, DistanceDisplayCondition: function () {},
             LabelStyle: {}, VerticalOrigin: {}, HeightReference: {} }
})

const { zoneRing, aoiStyle } = await import("./GlobeAoisLayer.jsx")

describe("GlobeAoisLayer", () => {
    it("draws a zone from its polygon, or its bbox", () => {
        const poly = { type: "Polygon", coordinates: [[[1, 2], [3, 2], [3, 4], [1, 4], [1, 2]]] }
        expect(zoneRing({ polygon_geojson: poly })).toHaveLength(5)
        expect(zoneRing({ bbox: { min_lon: 1, min_lat: 2, max_lon: 3, max_lat: 4 } })[2]).toEqual([3, 4])
        expect(zoneRing({})).toBeNull()
    })
    it("marks only zones with a fresh finding, labelled with count and what", () => {
        expect(aoiStyle({ name: "A" })).toEqual({ fresh: false, label: null })
        const s = aoiStyle({ name: "Vuglegirska power station", findings: { fresh: { count: 2, text: "radar, 12 ha brighter since 2 Oct" } } })
        expect(s.fresh).toBe(true)
        expect(s.label).toBe("2 · Vuglegirska power station — radar, 12 ha brighter since 2 Oct")
    })
})
