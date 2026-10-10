import { describe, it, expect, vi, afterEach } from "vitest"
import { PHONE_LAYERS, layerGroups, _clearLayerCache } from "./mapLayers.js"

describe("phone map layer registry", () => {
    afterEach(() => { vi.unstubAllGlobals(); _clearLayerCache() })

    it("every layer is complete", () => {
        for (const l of PHONE_LAYERS) {
            expect(typeof l.key, l.key).toBe("string")
            expect(l.label, l.key).toBeTruthy()
            expect(l.group, l.key).toBeTruthy()
            expect(["points", "lines", "areas"], l.key).toContain(l.kind)
            expect(typeof l.load, l.key).toBe("function")
            expect(typeof l.minZoom, l.key).toBe("number")
            expect(typeof l.defaultOn, l.key).toBe("boolean")
            expect(String(l.legendIcon), l.key).toMatch(/^data:image\/svg\+xml/)
        }
    })

    it("keys are unique", () => {
        const keys = PHONE_LAYERS.map((l) => l.key)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it("carries every desktop sub-layer that draws points or areas", () => {
        const keys = new Set(PHONE_LAYERS.map((l) => l.key))
        for (const k of ["geoConfirmed", "gdelt", "telegram", "unrest", "fires", "imagerySignals",
                         "assets", "airspace", "gpsInterference",
                         "gfw:encounters", "gfw:gaps", "gfw:loitering", "gfw:port-visits"]) {
            expect(keys.has(k), k).toBe(true)
        }
    })

    it("groups keep registry order and lose nothing", () => {
        const groups = layerGroups()
        expect(groups.flatMap((g) => g.layers)).toEqual(PHONE_LAYERS)
        expect(new Set(groups.map((g) => g.group)).size).toBe(groups.length)
    })

    it("a failed fetch is an empty layer, never a throw", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))))
        const bounds = { south: 44, west: 30, north: 47, east: 34 }
        for (const l of PHONE_LAYERS) {
            await expect(l.load({ bounds, zoom: 8, hours: 24 }), l.key).resolves.toEqual([])
        }
    })

    it("maps a GDELT point to the desktop diamond with its headline", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            json: async () => ({ points: [{ id: 1, lat: 45, lon: 32, goldstein: -9, title: "Shelling reported", location_name: "Kherson" }] }),
        })))
        const gdelt = PHONE_LAYERS.find((l) => l.key === "gdelt")
        const [f] = await gdelt.load({ bounds: { south: 44, west: 30, north: 47, east: 34 }, zoom: 6, hours: 24 })
        expect(f.title).toBe("Shelling reported")
        expect(f.sub).toBe("Kherson")
        expect(f.iconUri).toMatch(/^data:image\/svg\+xml/)
        expect(decodeURIComponent(f.iconUri)).toContain("#d4553f")
    })
})
