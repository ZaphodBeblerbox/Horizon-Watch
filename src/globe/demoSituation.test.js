import { describe, it, expect, vi, afterEach } from "vitest"
import {
    ageLabel, convergenceDetail, convergenceIcon, crowdAlpha, crowdDetail, crowdIcon, scoreLabel, situationFeatures,
    developmentLines, SITUATION_PATH,
} from "./demoSituation.js"
import { PHONE_LAYERS, _clearLayerCache } from "../mobile/mapLayers.js"
import { normalizeEntity } from "../inspector/adapters.js"
import { getCityNow } from "../routes/demonstrations.js"

const NOW = Date.parse("2026-10-17T14:00:00Z")
const iso = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString()
const ELY = { lat: 48.8704, lon: 2.3167 }, CON = { lat: 48.8656, lon: 2.3212 }, REP = { lat: 48.8674, lon: 2.3636 }

const src = (id, m, title) => ({ id, title, url: `https://t.me/chan/${id}`, source: "Telegram · chan", published_at: iso(m) })
const crowdCon = { id: "crowd-a", ...CON, place: "Place de la Concorde, Paris, FR", at: iso(12), hhmm: "15:48", age_min: 12, n_reports: 3,
                   path: [{ ...REP, place: "Place de la République, Paris", at: iso(60) }, { ...CON, place: "Place de la Concorde, Paris", at: iso(12) }],
                   sources: [src("1", 60, "Cortège à République"), src("2", 12, "On est place de la Concorde")], heading_to: { id: "g:ely", name: "Palais de l'Élysée" } }
const crowdOld = { id: "crowd-b", lat: 48.85, lon: 2.35, place: "Châtelet, Paris", at: iso(170), hhmm: "13:10", age_min: 170, n_reports: 1, path: [], sources: [] }
const ely = {
    id: "tgt-g:ely", kind: "target", rank: 1, name: "Palais de l'Élysée", ...ELY, score: 0.72, acts: ["gather", "attack"],
    explanation: "named in 6 calls in the last 2 h (4 channels), 1 group within 9 min walk, last seen at Place de la Concorde 15:48",
    calls: [{ kind: "call", at: iso(30), title: "Tous à l'Élysée", url: "https://t.me/chan/9", source: "Telegram · chan", hhmm: "15:30" }],
    reach: [{ crowd_id: "crowd-a", eta_min: 8.6, routed: true, heading: true, there: false, hhmm: "15:48" }],
}
const junction = { id: "j:x", kind: "junction", rank: 2, name: "Where routes meet: Rue Royale", lat: 48.868, lon: 2.322, score: 0.43, explanation: "the walking routes …" }
const data = {
    generated_at: iso(0),
    cities: [{
        city: "paris", crowds: [crowdCon, crowdOld], convergence: [ely, junction],
        routes: [
            { id: "route-crowd-a-tgt-g:ely", crowd_id: "crowd-a", target_id: "tgt-g:ely", coords: [[CON.lat, CON.lon], [48.868, 2.32], [ELY.lat, ELY.lon]], eta_min: 8.6, routed: true },
            { id: "route-crowd-b-tgt-g:ely", crowd_id: "crowd-b", target_id: "tgt-g:ely", coords: [[48.85, 2.35], [ELY.lat, ELY.lon]], eta_min: 40, routed: false },
            { id: "route-x", crowd_id: "crowd-b", target_id: "gone", coords: [[48.85, 2.35], [ELY.lat, ELY.lon]], eta_min: 40, routed: true },
        ],
        developments: [{ at: iso(2), hhmm: "15:58", kind: "position", place: "Palais de l'Élysée", title: "Foule devant l'Élysée" }],
    }],
}

describe("demo situation — words and marks", () => {
    it("ages, fading and the estimate label", () => {
        expect(ageLabel(0.4)).toBe("just now")
        expect(ageLabel(12)).toBe("12 min ago")
        expect(ageLabel(80)).toBe("1 h 20 ago")
        expect(crowdAlpha(0)).toBe(1)
        expect(crowdAlpha(90)).toBeGreaterThan(crowdAlpha(170))
        expect(crowdAlpha(1000)).toBe(0.35)
        expect(scoreLabel(0.724)).toBe("est. 72%")
    })

    it("icons: white words on a dark halo, colour in the mark, no monospace", () => {
        for (const ic of [crowdIcon("Concorde · 12 min ago", 0.5), convergenceIcon("1 · Élysée · est. 72%")]) {
            const svg = decodeURIComponent(ic.uri.split(",")[1])
            expect(svg).toMatch(/fill="#F2F4F7"/)
            expect(svg).toMatch(/paint-order="stroke"/)
            expect(svg).not.toMatch(/mono/i)
            expect(ic.width).toBeGreaterThan(30)
        }
        expect(decodeURIComponent(crowdIcon("x", 0.5).uri)).toMatch(/opacity="0.5"/)
        expect(decodeURIComponent(convergenceIcon("", { junction: true }).uri)).toMatch(/stroke-dasharray/)
    })

    it("cards carry the evidence: messages with times and links, and say estimate", () => {
        const c = crowdDetail(crowdCon)
        expect(c).toMatch(/last reported at Place de la Concorde at 15:48 \(12 min ago\), 3 reports/)
        expect(c).toMatch(/République → Place de la Concorde/)
        expect(c).toMatch(/heading to Palais de l'Élysée/)
        expect(c).toMatch(/https:\/\/t\.me\/chan\/2/)
        const v = convergenceDetail(ely, { "crowd-a": crowdCon })
        expect(v).toMatch(/#1 probable convergence point: Palais de l'Élysée \(est\. 72%\)/)
        expect(v).toMatch(/Place de la Concorde \(seen 15:48\): 9 min walk, said to be heading there/)
        expect(v).toMatch(/15:30 Telegram · chan: Tous à l'Élysée \(https:\/\/t\.me\/chan\/9\)/)
        expect(v).toMatch(/Estimate/)
        expect(developmentLines(data.cities[0])[0]).toBe("15:58 · position · Palais de l'Élysée: Foule devant l'Élysée")
    })
})

describe("demo situation — features", () => {
    it("crowds, paths, dashed routes and ringed points; routes only to shown points", () => {
        const fs = situationFeatures(data, NOW)
        const types = fs.map((f) => f.type)
        expect(types.filter((t) => t === "demo_crowd")).toHaveLength(2)
        expect(types.filter((t) => t === "demo_path")).toHaveLength(1)
        expect(types.filter((t) => t === "demo_route")).toHaveLength(2)
        expect(types.filter((t) => t === "demo_convergence")).toHaveLength(2)
        const routed = fs.find((f) => f.id === "sit-route-crowd-a-tgt-g:ely")
        const est = fs.find((f) => f.id === "sit-route-crowd-b-tgt-g:ely")
        expect(routed.dash).toBeTruthy()
        expect(est.title).toMatch(/estimated/)
        expect(est.dash).not.toBe(routed.dash)
        // convergence marks draw last, the best on top
        expect(fs[fs.length - 1].id).toBe("sit-conv-tgt-g:ely")
        const conv = fs[fs.length - 1]
        expect(conv.raw.estimate).toBe(true)
        expect(conv.marker.iconAnchor[1]).toBe(17)
        const fresh = fs.find((f) => f.id === "sit-crowd-crowd-a"), old = fs.find((f) => f.id === "sit-crowd-crowd-b")
        expect(fresh.alpha).toBeGreaterThan(old.alpha)
        expect(fresh.raw.url).toBe("https://t.me/chan/2")
        expect(situationFeatures(null)).toEqual([])
    })

    it("the inspector reads every situation type", () => {
        for (const f of situationFeatures(data, NOW)) {
            const n = normalizeEntity(f.type, f.raw)
            // a crowd's path opens the crowd's own card
            expect(n.identity.entityType).toBe(f.type === "demo_path" ? "demo_crowd" : f.type)
            expect(n.description).toBeTruthy()
        }
        expect(normalizeEntity("demo_convergence", { ...ely, kind: "demo_convergence" }).attributes.some((a) => /estimate/.test(a.value))).toBe(true)
    })
})

describe("demo situation — the phone's layer", () => {
    afterEach(() => { vi.unstubAllGlobals(); _clearLayerCache() })
    const layer = PHONE_LAYERS.find((l) => l.key === "demonstrations:situation")

    it("reads the situation every 30 s into lines with markers", async () => {
        expect(layer.refreshMs).toBe(30_000)
        expect(layer.kind).toBe("lines")
        const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(data) }))
        vi.stubGlobal("fetch", fetchMock)
        const out = await layer.load({ bounds: { south: 48.7, west: 2.1, north: 49.0, east: 2.6 }, zoom: 13 })
        expect(String(fetchMock.mock.calls[0][0])).toMatch(new RegExp(`${SITUATION_PATH}$`))
        expect(out.length).toBe(7)
        expect(out.filter((f) => f.marker).every((f) => f.marker.iconUri.startsWith("data:image/svg+xml"))).toBe(true)
        expect(await layer.load({ bounds: { south: 40, west: -5, north: 41, east: -4 }, zoom: 10 })).toEqual([])
    })

    it("asks for one city's summary", async () => {
        const f = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ cities: [] }) }))
        await getCityNow("Paris", f)
        expect(String(f.mock.calls[0][0])).toMatch(/\/api\/routes\/demonstrations\/now\?city=Paris$/)
    })
})
