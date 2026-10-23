import { describe, it, expect, vi, afterEach } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import {
    FRAMES, getFrame, setFrame, subscribeFrame, protestFeatures, protestBadge, cardOf, frameNote, refreshMs, headingOf,
    setMeta, LIVE_REFRESH_MS, IDLE_REFRESH_MS, ICON_PX,
} from "./protests.js"
import { PHONE_LAYERS, _clearLayerCache, loadProtests } from "../mobile/mapLayers.js"
import { SUB_LAYERS } from "../components/layerRailConfig.js"
import ProtestFrames, { noteOf } from "../components/ProtestFrames.jsx"

const item = (kw = {}) => ({
    id: "pr-1", frame: "live", kind: "police", act: "police_intervention", title: "Tear gas at Place de la République",
    line: "Eyewitness, unverified", when: "14:05, 4 min ago", lat: 48.8674, lon: 2.3636, country_code: "fr",
    messages: [{ hhmm: "14:05", text: "ça gaze à Répu" }], sources: [{ channel_title: "GJ 2026 IDF", url: "https://t.me/x/1" }],
    corroboration: { line: "Eyewitness, unverified" }, ...kw,
})

describe("protests layer: frames", () => {
    afterEach(() => { setFrame("live"); vi.unstubAllGlobals(); _clearLayerCache() })

    it("has the three frames in order", () => {
        expect(FRAMES.map((f) => f.key)).toEqual(["live", "today", "upcoming"])
    })

    it("switching the frame tells every listener (the phone map and the globe share one choice)", () => {
        const seen = []
        const off = subscribeFrame((f) => seen.push(f))
        setFrame("today")
        setFrame("today")
        setFrame("nonsense")
        setFrame("upcoming")
        off()
        expect(seen).toEqual(["today", "upcoming"])
        expect(getFrame()).toBe("upcoming")
    })

    it("the phone layer reads the chosen frame from /api/protests", async () => {
        const urls = []
        vi.stubGlobal("fetch", vi.fn(async (u) => { urls.push(String(u)); return { ok: true, json: async () => ({ items: [item()], counts: { live: 1, today: 0, upcoming: 0 }, any_live: true }) } }))
        setFrame("today")
        await loadProtests({ bounds: { south: 40, north: 55, west: -5, east: 10 } })
        expect(urls.some((u) => u.includes("/api/protests?frame=today"))).toBe(true)
        setFrame("upcoming")
        await loadProtests({ bounds: { south: 40, north: 55, west: -5, east: 10 } })
        expect(urls.some((u) => u.includes("/api/protests?frame=upcoming"))).toBe(true)
    })
})

describe("protests layer: toggle", () => {
    it("is its own phone layer, first, off by default", () => {
        expect(PHONE_LAYERS[0].key).toBe("protests")
        expect(PHONE_LAYERS[0].label).toBe("Protests")
        expect(PHONE_LAYERS[0].defaultOn).toBe(false)
    })
    it("is a desktop switch under no group, so it can always be turned on", () => {
        const s = SUB_LAYERS.find((l) => l.key === "protests")
        expect(s?.label).toBe("Protests")
        expect(s?.parent).toBe(null)
    })
    it("the desktop panel draws its row enabled, and the globe gets protestsEnabled", async () => {
        const { readFileSync } = await import("node:fs")
        const src = readFileSync("src/destinations/Situation.jsx", "utf8")
        const row = /<div data-testid="protests-row">[\s\S]*?<\/div>/.exec(src)?.[0] || ""
        expect(row).toContain("parentOn={true}")
        expect(src).toContain("protestsEnabled={protestsOn}")
        expect(readFileSync("src/components/GlobeView.jsx", "utf8")).toContain("<GlobeProtestsLayer enabled={protestsEnabled} />")
    })
})

describe("protests layer: marks and cards", () => {
    it("one badge per item at the one constant size, colliding through the shared pass", () => {
        const f = protestFeatures({ items: [item(), item({ id: "pr-2", kind: "crowd", act: "crowd_movement", lat: 48.85, lon: 2.37 })] })
        expect(f).toHaveLength(2)
        for (const x of f) { expect(x.size).toBe(ICON_PX); expect(x.collide).toBe(true); expect(x.iconUri).toMatch(/^data:image\/svg\+xml/) }
    })

    it("a movement carries its path and its heading; police that came by a street head away from it", () => {
        const tr = item({ id: "t", kind: "crowd_track", track: { points: [{ lat: 48.85, lon: 2.36 }, { lat: 48.848, lon: 2.395 }], bearing: 95 } })
        const f = protestFeatures({ items: [tr] })[0]
        expect(f.path).toHaveLength(2)
        expect(headingOf(tr)).toBe(95)
        expect(headingOf(item({ from: { bearing: 10 } }))).toBe(190)
        expect(protestBadge(tr)).not.toBe(protestBadge({ ...tr, track: null }))
    })

    it("today is quieter than live, upcoming is another shape", () => {
        expect(protestBadge(item({ frame: "today" }))).not.toBe(protestBadge(item()))
        expect(protestBadge(item({ kind: "planned", frame: "upcoming" }))).not.toBe(protestBadge(item({ kind: "protest" })))
    })

    it("the card is plain words: no emoji, the latest message with its time, the source", () => {
        const c = cardOf(item({ title: "🔥 Tear gas at Place de la République", messages: [{ hhmm: "14:05", text: "ça gaze à Répu 🚨" }] }))
        expect(c.title).toBe("Tear gas at Place de la République")
        expect(c.line).toContain("14:05, 4 min ago")
        expect(c.lines[0]).toBe("14:05 · ça gaze à Répu")
        expect(c.lines.at(-1)).toContain("via GJ 2026 IDF")
    })

    it("a protest that took place today: what and when once, not the title twice", () => {
        const c = cardOf(item({ kind: "protest", frame: "today", title: "Rally at Place de la République", when: "14:00–17:30",
                                line: "Rally at Place de la République, 14:00–17:30; organisers 10,000; 12 arrests" }))
        expect(c.line).toBe("14:00–17:30; organisers 10,000; 12 arrests")
    })

    it("an empty frame says so plainly, with what the others hold", () => {
        const d = { items: [], note: "Nothing live in your areas right now. 3 protests today, 2 upcoming." }
        expect(frameNote(d, "live")).toBe(d.note)
        expect(noteOf({ frame: "live", note: d.note }, "live")).toBe(d.note)
    })

    it("reads every 15 s while something is live, every minute otherwise", () => {
        expect(refreshMs({ any_live: true })).toBe(LIVE_REFRESH_MS)
        expect(refreshMs({ any_live: false })).toBe(IDLE_REFRESH_MS)
    })

    it("the frames control renders on the phone and the desktop with the counts", () => {
        setMeta({ frame: "live", counts: { live: 0, today: 3, upcoming: 2 }, note: "Nothing live in your areas right now. 3 protests today, 2 upcoming." })
        for (const v of ["phone", "desktop"]) {
            const html = renderToStaticMarkup(createElement(ProtestFrames, { variant: v }))
            const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
            expect(text).toContain("Live now 0")
            expect(text).toContain("Today 3")
            expect(text).toContain("Upcoming 2")
            expect(html).toContain("Nothing live in your areas right now.")
        }
    })
})
