import { describe, it, expect, vi, afterEach } from "vitest"
import {
    arrowBarbs, demoFamily, demoIconUri, demoRaw, demoSub, demoTitle, lastReportedIcon, trackRgba, segmentAlpha,
    trackSegments, RECONSTRUCTED,
} from "./demonstrations.js"
import { PHONE_LAYERS, _clearLayerCache } from "../mobile/mapLayers.js"
import { demonstrationsNear } from "../routes/demonstrations.js"

const NOW = Date.parse("2026-10-17T14:00:00Z")
const iso = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString()
const REP = { lat: 48.8674, lon: 2.3636 }, BAS = { lat: 48.8532, lon: 2.3692 }, NAT = { lat: 48.8483, lon: 2.3958 }

const kettle = { id: "tgs-c-1-0", kind: "kettle", label: "kettle", lat: BAS.lat, lon: BAS.lon, at: iso(12), place: "Place de la Bastille, Paris, France",
                 what: "Police kettle the crowd at Place de la Bastille", advice: "Leave by rue de Lyon", weight: 0.8, radius_m: 350,
                 source: { label: "Telegram · Paris Luttes", url: "https://t.me/c/1" }, provider: "unrest" }
const march = { id: "tga-c-2-0", kind: "march", label: "announced march", lat: NAT.lat, lon: NAT.lon, at: iso(300),
                starts_utc: new Date(NOW + 30 * 60_000).toISOString(), place: "Place de la Nation, Paris, France", source: { label: "Telegram · X (announced)" } }

const src = (id, minAgo, title) => ({ id, title, url: `https://t.me/chan/${id}`, source: "Telegram · chan", published_at: iso(minAgo) })
const track = {
    id: "pt-r1", kind: "protest_track", city: "Paris", n_reports: 3,
    last: { lat: NAT.lat, lon: NAT.lon, at: iso(30), label: "last reported 15:30" },
    segments: [
        { i: 0, from: { ...REP, place: "Place de la République, Paris, France", at: iso(120) }, to: { ...BAS, place: "Place de la Bastille, Paris, France", at: iso(80) },
          at: iso(80), distance_m: 1620, why: ["said it was heading to Place de la Bastille"], sources: [src("r1", 120, "Cortège vers Bastille"), src("r2", 80, "At Bastille")] },
        { i: 1, from: { ...BAS, place: "Place de la Bastille, Paris, France", at: iso(80) }, to: { ...NAT, place: "Place de la Nation, Paris, France", at: iso(30) },
          at: iso(30), distance_m: 2120, why: ["march or route words"], sources: [src("r2", 80, "At Bastille"), src("r3", 30, "At Nation")] },
    ],
}

describe("demonstrations — points", () => {
    it("files each hazard under its mark", () => {
        expect(demoFamily(kettle, NOW)).toBe("police")
        expect(demoFamily(march, NOW)).toBe("announced")
        expect(demoFamily({ ...march, starts_utc: iso(10) }, NOW)).toBe("crowd")
        expect(demoFamily({ kind: "roadblock" })).toBe("block")
        expect(demoFamily({ kind: "strike" })).toBe("strike")
        expect(demoIconUri(kettle, NOW)).toMatch(/^data:image\/svg\+xml/)
        expect(demoIconUri(kettle, NOW)).not.toBe(demoIconUri(march, NOW))
    })
    it("says what, where and when in plain words, with the source", () => {
        expect(demoTitle(kettle)).toBe("Kettle · Place de la Bastille")
        expect(demoSub(kettle, NOW)).toBe("12 min ago · Telegram · Paris Luttes")
        expect(demoSub(march, NOW)).toMatch(/^starts in 30 min/)
        const raw = demoRaw(kettle, NOW)
        expect(raw).toMatchObject({ kind: "demonstration", hazard_kind: "kettle", title: "Kettle · Place de la Bastille",
                                    url: "https://t.me/c/1", source: "Telegram · Paris Luttes", published_at: kettle.at })
        expect(raw.detail).toMatch(/Get me out/)
    })
})

describe("demonstrations — reconstructed movement", () => {
    it("fades older hops and never drops one", () => {
        expect(segmentAlpha(0)).toBe(1)
        expect(segmentAlpha(90)).toBeCloseTo(0.5)
        expect(segmentAlpha(1000)).toBe(0.25)
        expect(trackRgba("#F5A524", 0.5)).toBe("rgba(245,165,36,0.5)")
    })
    it("puts the arrowhead at the latest place, pointing on", () => {
        const [l, tip, r] = arrowBarbs(BAS, NAT)
        expect(tip).toEqual(NAT)
        // both barbs trail behind the tip (to the west: the crowd went east)
        expect(l.lon).toBeLessThan(NAT.lon)
        expect(r.lon).toBeLessThan(NAT.lon)
    })
    it("draws one line per hop, each with its posts; the latest with the arrow and its time", () => {
        const segs = trackSegments(track, NOW)
        expect(segs).toHaveLength(2)
        const [old, last] = segs
        expect(old.latest).toBe(false)
        expect(old.coords).toEqual([[REP.lat, REP.lon], [BAS.lat, BAS.lon]])
        expect(old.marker).toBeNull()
        expect(last.latest).toBe(true)
        expect(last.coords).toHaveLength(2)                 // shaft and arrowhead, as parts
        expect(last.coords[1]).toHaveLength(3)
        expect(old.alpha).toBeLessThan(last.alpha)
        expect(last.title).toBe("Crowd movement, last reported 15:30 (reconstructed)")
        expect(old.title).toMatch(/reconstructed/)
        expect(last.sub).toBe("Place de la Bastille → Place de la Nation · 2 reports")
        expect(last.marker.iconUri).toMatch(/^data:image\/svg\+xml/)
        expect(decodeURIComponent(last.marker.iconUri)).toContain("last reported 15:30")
        expect(last.raw).toMatchObject({ kind: "protest_track", track_id: "pt-r1", url: "https://t.me/chan/r2",
                                         published_at: iso(30), reconstructed: true })
        expect(last.raw.sources.map((s) => s.id)).toEqual(["r2", "r3"])
        expect(last.raw.detail).toContain(RECONSTRUCTED)
        expect(last.raw.detail).toContain("https://t.me/chan/r3")
    })
    it("the head's words carry no colour and no monospace", () => {
        const svg = decodeURIComponent(lastReportedIcon("last reported 15:30").uri)
        expect(svg).toMatch(/<text[^>]*fill="#F2F4F7"/)
        expect(svg).not.toMatch(/mono/i)
    })
    it("near a point, nearest first", () => {
        const near = demonstrationsNear({ demonstrations: [march, kettle], tracks: [track] }, BAS.lat, BAS.lon, 1)
        expect(near.demonstrations.map((h) => h.id)).toEqual(["tgs-c-1-0"])
        expect(near.tracks).toEqual([])                       // its last place, Nation, is 2 km off
        expect(demonstrationsNear({ demonstrations: [kettle], tracks: [track] }, NAT.lat, NAT.lon, 1).tracks).toHaveLength(1)
    })
})

describe("demonstrations — the phone's layers", () => {
    afterEach(() => { vi.unstubAllGlobals(); _clearLayerCache() })
    const bounds = { south: 48.7, west: 2.1, north: 49.0, east: 2.6 }
    const layer = (k) => PHONE_LAYERS.find((l) => l.key === k)

    it("sit with unrest, off by default like every layer, read every 30 s", () => {
        const keys = PHONE_LAYERS.map((l) => l.key)
        const at = keys.indexOf("unrest")
        expect(keys.slice(at + 1, at + 4)).toEqual(["demonstrations", "demonstrations:movement", "demonstrations:situation"])
        for (const k of ["demonstrations", "demonstrations:movement", "demonstrations:situation"]) {
            expect(layer(k).defaultOn).toBe(false)
            expect(layer(k).group).toBe(layer("unrest").group)
            expect(layer(k).refreshMs).toBe(30_000)
        }
        expect(layer("demonstrations:movement").label).toMatch(/reconstructed/)
        // the street reports too: nothing is on until the user turns it on (owner, 2026-10-18)
        expect(layer("demonstrations:police").defaultOn).toBe(false)
    })

    it("read one answer into points and lines in the shape the map draws", async () => {
        const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ demonstrations: [kettle, march], tracks: [track] }) }))
        vi.stubGlobal("fetch", fetchMock)
        const pts = await layer("demonstrations").load({ bounds, zoom: 13, hours: 24 })
        const lines = await layer("demonstrations:movement").load({ bounds, zoom: 13, hours: 24 })
        expect(fetchMock).toHaveBeenCalledTimes(1)          // one request for both rows
        expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/routes\/demonstrations$/)
        expect(pts.map((p) => p.id)).toEqual(["demo-tgs-c-1-0", "demo-tga-c-2-0"])
        for (const p of pts) {
            expect(p.iconUri).toMatch(/^data:image\/svg\+xml/)
            expect(typeof p.size).toBe("number")
            expect(p.title && p.raw.title && p.raw.published_at).toBeTruthy()
        }
        expect(lines.map((l) => l.id)).toEqual(["demo-move-pt-r1-0", "demo-move-pt-r1-1"])
        for (const l of lines) {
            expect(l.coords.length).toBeGreaterThanOrEqual(2)
            expect(l.color).toMatch(/^rgba\(245,165,36,/)
            expect(typeof l.weight).toBe("number")
            expect(l.title && l.raw.url && l.raw.published_at).toBeTruthy()
        }
        expect(lines[1].marker).toMatchObject({ lat: NAT.lat, lon: NAT.lon })
    })

    it("out of view, nothing", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ demonstrations: [kettle], tracks: [track] }) })))
        const far = { south: 40, west: 10, north: 41, east: 11 }
        expect(await layer("demonstrations").load({ bounds: far, zoom: 10 })).toEqual([])
        expect(await layer("demonstrations:movement").load({ bounds: far, zoom: 10 })).toEqual([])
    })
})
