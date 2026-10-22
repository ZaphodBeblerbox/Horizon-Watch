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

    it("every layer defaults off: nothing is on until the user turns it on (owner, 2026-10-18)", () => {
        for (const l of PHONE_LAYERS) expect(l.defaultOn, l.key).toBe(false)
    })

    it("the phone map's built-in state has ships and aircraft off too", async () => {
        const { readFileSync } = await import("node:fs")
        const src = readFileSync("src/mobile/screens/MMap.jsx", "utf8")
        const built = /const builtIn = \(\) => \(([^\n]*)\)\n/.exec(src)[1]
        expect(built).toContain("ships: false")
        expect(built).toContain("aircraft: false")
        expect(built).not.toMatch(/:\s*true/)
    })

    it("keys are unique", () => {
        const keys = PHONE_LAYERS.map((l) => l.key)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it("carries every desktop sub-layer that draws points or areas", () => {
        const keys = new Set(PHONE_LAYERS.map((l) => l.key))
        for (const k of ["geoConfirmed", "liveSignals", "fires", "imagerySignals",
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

    it("has no GDELT layer (country risk index only, owner 2026-10-13)", () => {
        expect(PHONE_LAYERS.find((l) => l.key === "gdelt")).toBeUndefined()
    })
})

describe("aois — fresh findings", () => {
    it("reads a zone's fresh finding or null", async () => {
        const { aoiFresh } = await import("./mapLayers.js")
        expect(aoiFresh({})).toBeNull()
        expect(aoiFresh({ findings: { fresh: null } })).toBeNull()
        expect(aoiFresh({ findings: { fresh: { count: 3, text: "radar change" } } })).toEqual({ count: 3, text: "radar change" })
    })

    it("has ONE Telegram signal layer; the yellow protest squares, planned-protest circles, footage, street-report and mood marks are gone", () => {
        const keys = PHONE_LAYERS.map((l) => l.key)
        expect(keys.filter((k) => k === "liveSignals")).toHaveLength(1)
        for (const k of ["telegram", "unrest", "demonstrations", "demonstrations:movement", "demonstrations:situation",
                         "demonstrations:police", "telegramMood"]) expect(keys, k).not.toContain(k)
        const l = PHONE_LAYERS.find((x) => x.key === "liveSignals")
        expect(l.label).toBe("Live signals")
        expect(l.defaultOn).toBe(false)
    })

    it("draws a live signal as one badge with its act's icon, plain card text, the footage only as the card's media", async () => {
        const { liveSignalFeatures } = await import("./mapLayers.js")
        const now = Date.parse("2026-10-22T16:00:00Z")
        const d = { signals: [
            { id: "ls-a-1", act: "police_intervention", title: "Police charge at Sorbonne, Paris", lat: 48.848, lon: 2.343, muted: false, high_impact: false,
              event_time: "2026-10-22T15:52:00Z", corroboration: { line: "Eyewitness, unverified" }, lines: [{ text: "Arrest at Sorbonne, Paris" }],
              all_media: [{ kind: "video", thumb_url: "/t.jpg", video_url: "/v", channel: "A", msg_id: 3 }] },
            { id: "ls-old", act: "arrest", title: "Arrest at X", lat: 48.9, lon: 2.3, event_time: "2026-10-22T14:00:00Z", corroboration: { line: "1 source, unverified" } },
        ] }
        const f = liveSignalFeatures(d, now)
        expect(f.map((x) => x.id)).toEqual(["ls-a-1"])                       // the 2 h old one is off the map
        expect(f[0].title).toBe("Police charge at Sorbonne, Paris")
        expect(f[0].sub).toBe("Eyewitness, unverified, 8 min ago")
        expect(f[0].raw.sources[0]).toMatchObject({ media: "video", video_url: "/v" })
        expect(f[0].iconUri).toMatch(/^data:image\/svg\+xml/)
    })
})
