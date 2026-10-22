import { describe, it, expect } from "vitest"
import {
    ageLabel, convergenceDetail, convergenceIcon, crowdAlpha, crowdDetail, crowdIcon, scoreLabel, situationFeatures,
    developmentLines, SITUATION_PATH, groundCircle,
} from "./demoSituation.js"
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
        // never dimmed within hours (owner, 2026-10-19), never gone while the server has it
        expect(crowdAlpha(0)).toBe(1)
        expect(crowdAlpha(90)).toBe(1)
        expect(crowdAlpha(170)).toBe(1)
        expect(crowdAlpha(5000)).toBe(0.55)
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
        expect(fresh.alpha).toBe(1); expect(old.alpha).toBe(1)          // both within hours: neither dimmed (owner, 2026-10-19)
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

describe("demo situation — where a crowd probably is now", () => {
    const moving = {
        ...crowdCon,
        path_legs: [{ i: 0, coords: [[REP.lat, REP.lon], [48.868, 2.34], [CON.lat, CON.lon]], routed: true, estimated: false }],
        now_est: { lat: 48.8675, lon: 2.3195, basis: "heading_to", to: "Palais de l'Élysée", routed: true, arrived: false,
                   advanced_m: 800, trail: [[CON.lat, CON.lon], [48.8675, 2.3195]], kmh: 4 },
        reach_m: 800,
    }
    const one = { generated_at: iso(0), cities: [{ city: "paris", crowds: [moving], convergence: [], routes: [] }] }

    it("a dashed 'probably here now' mark, the way there, and the last-seen words", () => {
        const fs = situationFeatures(one, NOW)
        const now = fs.find((f) => f.id === "sit-now-crowd-a")
        expect(now.type).toBe("demo_crowd")
        expect(now.marker.lat).toBe(48.8675)
        const svg = decodeURIComponent(now.marker.iconUri.split(",")[1])
        expect(svg).toMatch(/stroke-dasharray/)
        expect(svg).toMatch(/probably here now/)
        expect(svg).not.toMatch(/mono/i)
        expect(fs.find((f) => f.id === "sit-trail-crowd-a").dash).toBeTruthy()
        const seen = fs.find((f) => f.id === "sit-crowd-crowd-a")
        expect(decodeURIComponent(seen.marker.iconUri)).toMatch(/Place de la Concorde · last seen 15:48 · 12 min ago/)
        expect(seen.raw.detail).toMatch(/Probably near the dashed mark now \(estimate\): about 800 m on toward Palais de l'Élysée/)
        expect(seen.raw.detail).toMatch(/could be up to 800 m/)
        // the routed path hop drawn on its streets, solid
        const leg = fs.find((f) => f.id === "sit-path-crowd-a-0")
        expect(leg.coords).toHaveLength(3)
        expect(leg.dash).toBeNull()
    })

    it("an unrouted hop is straight, dotted and fainter; a short advance draws no 'now' mark", () => {
        const g = { ...moving, path_legs: [{ i: 0, coords: [[REP.lat, REP.lon], [CON.lat, CON.lon]], routed: false, estimated: true }],
                    now_est: { ...moving.now_est, advanced_m: 20 } }
        const fs = situationFeatures({ cities: [{ city: "paris", crowds: [g] }] }, NOW)
        const leg = fs.find((f) => f.id === "sit-path-crowd-a-0")
        expect(leg.dash).toBe("2 7")
        expect(leg.sub).toMatch(/walking route pending/)
        expect(fs.find((f) => f.id === "sit-now-crowd-a")).toBeUndefined()
        expect(decodeURIComponent(fs.find((f) => f.id === "sit-crowd-crowd-a").marker.iconUri)).toMatch(/Place de la Concorde · 12 min ago/)
    })

    it("the reach is a faint ground circle of its true size, shown from street level only", () => {
        const ring = situationFeatures(one, NOW).find((f) => f.id === "sit-reach-crowd-a")
        expect(ring.minZoom).toBe(12)
        expect(ring.maxCameraM).toBeGreaterThan(0)
        expect(ring.weight).toBe(1)
        expect(ring.coords[0]).toEqual(ring.coords[ring.coords.length - 1])
        // its radius is metres on the ground: ~800 m north of the centre
        const north = Math.max(...ring.coords.map((p) => p[0]))
        expect((north - CON.lat) * 111_320).toBeCloseTo(800, -1)
        const c = groundCircle(0, 0, 1000, 4)
        expect(c).toHaveLength(5)
    })
})
