import { describe, it, expect, vi, afterEach } from "vitest"
import { PHONE_LAYERS, layerGroups, _clearLayerCache, clusterPlaces, featureTime } from "./mapLayers.js"

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
        // but the marker of the one signal a notification opened (owner, 2026-10-24): it draws nothing until you open one
        for (const l of PHONE_LAYERS) expect(l.defaultOn, l.key).toBe(l.key === "openedSignal")
    })

    it("the signal a notification opened has its own switch, which the map passes to the pin (owner, 2026-10-24)", async () => {
        const l = PHONE_LAYERS.find((x) => x.key === "openedSignal")
        expect(l && l.group).toBe("Protests")
        expect(await l.load({})).toEqual([])
        const { readFileSync } = await import("node:fs")
        const src = readFileSync("src/mobile/screens/MMap.jsx", "utf8")
        expect(src).toMatch(/setSignalPinLayer\(on\.openedSignal !== false\)/)
        expect(src).toMatch(/closeOpenedSignal\(was\.id, \{ passive: true \}\)/)
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

describe("every point marker comes from lib/mapIcons.js (one typology, owner 2026-10-23)", () => {
    afterEach(() => { vi.unstubAllGlobals(); _clearLayerCache() })
    const now = new Date().toISOString()
    const P = { lat: 48.85, lon: 2.35 }
    const BODY = [
        ["/api/geoconfirmed", { placemarks: [{ id: 1, ...P, title: "x", faction_color: "#ff0000" }] }],
        ["/api/telegram/signals/live", { signals: [{ id: "s1", act: "arrest", ...P, event_time: now, title: "Arrest" }] }],
        ["/api/protests", { items: [{ id: "p1", kind: "protest", ...P }] }],
        ["/api/alerts/surges", { surges: [{ id: 1, ...P, cat: "x", n: 3 }] }],
        ["/api/alerts/fusions", { fusions: [{ id: 2, ...P, headline: "h" }] }],
        ["/api/alerts?source=SAT-TASK", [{ alert_id: "a", ...P, severity: "high", created_at: now }]],
        ["/api/fires", { fires: [{ id: 1, ...P, brightness_k: 370 }] }],
        ["/api/gfw/events", { available: true, events: [{ id: 1, ...P, start: now }] }],
        ["/api/my-assets/people", { people: [{ user_id: 99, ...P, at: now, live: true, name: "A" }] }],
        ["/api/my-assets", { assets: [{ id: 1, group: "Vessels", exposure: "high", position: P }] }],
        ["/api/evacuations/safe-houses", { safe_houses: [{ id: 1, ...P, name: "H" }] }],
        ["/api/infrastructure/chokepoints", { chokepoints: [{ id: 1, ...P, name: "C" }] }],
        ["/api/ports/in-viewport", { features: [{ properties: { system_id: 1, port_size: "Very Large" }, geometry: { coordinates: [P.lon, P.lat] } }] }],
        ["/api/airports/in-viewport", { features: [{ properties: { system_id: 1, airport_type: "large_airport" }, geometry: { coordinates: [P.lon, P.lat] } }] }],
        ["/api/facilities/in-viewport", { facilities: [{ system_id: 1, ...P, kind: "hospital", category: "medical" }, { system_id: 2, ...P, kind: "barracks", category: "military" }, { system_id: 3, ...P, kind: "police", category: "security" }] }],
        ["/api/infra/features", { features: [{ id: "i1", kind: "power_plant", ...P, props: { source: "nuclear" } }] }],
        ["/api/endangered-places", { places: [{ id: 1, ...P, kind: "refinery", alarm: "red", calls: [{ label_en: "x" }], country: "FR" }] }],
        ["/api/strikes?", { events: [{ id: 1, ...P, act: "airstrike", time: now, casualties: { killed: 40 } }] }],
    ]
    it("each point layer's features: an image of the module (its edge, 2x a constant size), a constant size and a priority", async () => {
        vi.stubGlobal("fetch", vi.fn(async (url) => {
            const hit = BODY.find(([k]) => String(url).includes(k))
            return { ok: !!hit, json: async () => (hit ? hit[1] : null) }
        }))
        const { EDGE, SIZE, svgOf } = await import("../lib/mapIcons.js")
        const SIZES = new Set([SIZE.event, SIZE.pin.w, SIZE.infra, SIZE.traffic, SIZE.team, SIZE.me, SIZE.small, SIZE.cluster])
        const bounds = { south: 48, north: 49.5, west: 1.5, east: 3 }
        const seen = []
        for (const l of PHONE_LAYERS.filter((x) => x.kind === "points")) {
            const feats = await l.load({ bounds, zoom: 12, hours: 24 })
            for (const f of feats) {
                const svg = svgOf(f.iconUri)
                expect(svg.includes(EDGE) || svg.includes("#FFFFFF"), l.key).toBe(true)
                const w = Number(/width="([\d.]+)"/.exec(svg)[1])
                expect(SIZES.has(w / 2), `${l.key} image ${w}`).toBe(true)
                expect(SIZES.has(f.size), `${l.key} size ${f.size}`).toBe(true)
                if (l.key !== "people") { expect(f.collide, l.key).toBe(true); expect(f.pri, l.key).toBeTruthy() }
            }
            if (feats.length) seen.push(l.key)
        }
        for (const k of ["geoConfirmed", "liveSignals", "protests", "derivedAlerts", "imagerySignals", "fires", "assets", "safeHouses",
                         "people", "chokepoints", "ports", "airports", "facMedical", "power:sites", "endangered", "strikes", "gfw:encounters"]) {
            expect(seen, k).toContain(k)
        }
    })
})

describe("one icon per place, the right glyph (owner, 2026-10-23 evening)", () => {
    afterEach(() => { vi.unstubAllGlobals(); _clearLayerCache() })
    const P = { lat: 48.85, lon: 2.35 }
    it("two things at one place are drawn as ONE marker: the higher priority's own icon, never a count", async () => {
        const { representative } = await import("../lib/liveSignals.js")
        const { svgOf } = await import("../lib/mapIcons.js")
        const a = { id: "a", pri: "alert", t: 2, iconUri: "A" }, b = { id: "b", pri: "urgent", t: 1, iconUri: "B" }
        expect(representative([a, b]).iconUri).toBe("B")
        // endangered places grouped at low zoom: the worst place's own icon, no count text
        const g = clusterPlaces([{ id: 1, ...P, kind: "refinery", alarm: "grey" }, { id: 2, ...P, kind: "fuel_depot", alarm: "red", calls: [{ label_en: "x" }] }], 5)
        expect(g).toHaveLength(1)
        expect(svgOf(g[0].iconUri)).not.toMatch(/<text/)
        expect(g[0].pri).toBe("flash")
        expect(featureTime({ raw: { event_time: "2026-10-23T10:00:00Z" } })).toBe(Date.parse("2026-10-23T10:00:00Z"))
    })
    it("a shooting in the strikes layer draws the crime glyph, not the bomb", async () => {
        const now = new Date().toISOString()
        const ev = (id, title, extra = {}) => ({ id, ...P, act: "airstrike", weapon_stated: false, time: now, title, ...extra })
        vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: String(url).includes("/api/strikes?"), json: async () => ({
            events: [ev(1, "Gunman shot three people outside a bar"), ev(2, "Airstrike hits depot", { weapon_stated: true })] }) })))
        const { GLYPH, svgOf } = await import("../lib/mapIcons.js")
        const feats = await PHONE_LAYERS.find((l) => l.key === "strikes").load({ bounds: { south: 48, north: 49.5, west: 1.5, east: 3 }, zoom: 12 })
        const byId = Object.fromEntries(feats.map((f) => [f.id, svgOf(f.iconUri)]))
        expect(byId["strike-1"]).toContain(GLYPH.crime.d)
        expect(byId["strike-1"]).not.toContain(GLYPH.airstrike.d)
        expect(byId["strike-2"]).toContain(GLYPH.airstrike.d)
    })
})
