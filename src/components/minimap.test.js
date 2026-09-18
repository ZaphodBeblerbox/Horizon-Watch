import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import {
    makeProjection, easeOut, DEFAULT_SPAN, MINIMAP_HEIGHT,
    CONTEXT_SIZE, SUBJECT_SIZE, PING_DELAYS, PING_MS, labelPlan,
} from "./Minimap.jsx"

const W = 300, H = 196

describe("§S3.5 — the locator projection", () => {
    it("puts the focus at the centre of the box", () => {
        const p = makeProjection(43.3, 12.5, 26, W, H)(43.3, 12.5)
        expect(p[0]).toBeCloseTo(W / 2, 6)
        expect(p[1]).toBeCloseTo(H / 2, 6)
    })

    it("is equirectangular: east is right, north is UP", () => {
        // The y flip is the one that silently renders the world upside down.
        const proj = makeProjection(0, 0, 40, W, H)
        expect(proj(10, 0)[0]).toBeGreaterThan(proj(-10, 0)[0])
        expect(proj(0, 10)[1]).toBeLessThan(proj(0, -10)[1])
    })

    it("keeps one scale on both axes, so coastlines are not stretched", () => {
        const proj = makeProjection(0, 0, 40, W, H)
        const dx = proj(1, 0)[0] - proj(0, 0)[0]
        const dy = proj(0, 0)[1] - proj(0, 1)[1]
        expect(dx).toBeCloseTo(dy, 6)
    })

    it("fits the requested span inside the box with padding", () => {
        const proj = makeProjection(0, 0, 26, W, H)
        const west = proj(-26, 0)[0], east = proj(26, 0)[0]
        expect(west).toBeGreaterThanOrEqual(0)
        expect(east).toBeLessThanOrEqual(W)
    })

    it("handles a world framing without collapsing", () => {
        const proj = makeProjection(0, 20, 170, W, H)
        const a = proj(-170, 0), b = proj(170, 0)
        expect(b[0] - a[0]).toBeGreaterThan(100)
    })
})

describe("§S3.5 — size is the hierarchy", () => {
    it("draws context at 6px and the subject at 10px", () => {
        // "Both the same rotated diamond. Size is the hierarchy; introducing a
        // second glyph SHAPE would imply a second kind of thing."
        expect(CONTEXT_SIZE).toBe(6)
        expect(SUBJECT_SIZE).toBe(10)
        expect(SUBJECT_SIZE).toBeGreaterThan(CONTEXT_SIZE)
    })

    it("is 196px at the spec's default framing", () => {
        expect(MINIMAP_HEIGHT).toBe(196)
        expect(DEFAULT_SPAN).toBe(26)
    })
})

describe("§S3.5 — two staggered pings", () => {
    it("is exactly two, at 0ms and 480ms", () => {
        // "One ping is missable; three is a nightclub."
        expect(PING_DELAYS).toEqual([0, 480])
        expect(PING_MS).toBe(1500)
    })

    it("eases out cubically from 0 to 1", () => {
        expect(easeOut(0)).toBe(0)
        expect(easeOut(1)).toBe(1)
        // fast at the start, slow at the end — that is what makes it read
        // as a ping rather than a linear expanding circle.
        expect(easeOut(0.25)).toBeGreaterThan(0.5)
        expect(easeOut(0.75)).toBeGreaterThan(easeOut(0.5))
    })
})

describe("one locator, every surface", () => {
    it("is the only minimap component any surface imports", async () => {
        // Four parallel implementations existed — LocatorMiniMap (a graticule
        // with no coastline), AoiMiniMap, NewsMiniMap and reports/MiniMap —
        // at three sizes, two projections and their own marker vocabularies.
        // A locator that looks different on each screen is a locator the eye
        // has to re-learn every time.
        const { readFileSync, readdirSync } = await import("fs")
        const path = await import("path")
        const { fileURLToPath } = await import("url")
        // .pathname leaves a URL-encoded path — this project lives under
        // "NAGINI 2.0", so the space arrives as %20 and every read fails.
        const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
        const offenders = []
        const walk = (dir) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                if (e.name === "node_modules") continue
                const full = path.join(dir, e.name)
                if (e.isDirectory()) walk(full)
                else if (/\.jsx$/.test(e.name)) {
                    const src = readFileSync(full, "utf8")
                    if (/import\s+\w+\s+from\s+["'][^"']*LocatorMiniMap/.test(src)) offenders.push(e.name)
                }
            }
        }
        walk(root)
        expect(offenders).toEqual([])
    })
})

describe("a locator must never be able to crash the console", () => {
    const src = readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "Minimap.jsx"), "utf8",
    )

    it("does not take a second prop named `context`", () => {
        // This shipped: a new framing prop was also called `context`, so the
        // host's `context={array}` was replaced by `context="signal"` and
        // `.filter` threw on a string — white screen, production.
        const propBlock = src.slice(src.indexOf("export default function"), src.indexOf("const effSpan"))
        const declarations = propBlock.match(/^\s*context\b/gm) || []
        expect(declarations).toHaveLength(1)
        expect(src).toMatch(/\n\s*framing = "signal",/)
    })

    it("guards with Array.isArray, not a falsy check", () => {
        // `(context || [])` passes a string straight through to .filter.
        expect(src).toMatch(/Array\.isArray\(context\) \? context : \[\]/)
        expect(src).not.toMatch(/\(context \|\| \[\]\)\.filter/)
    })

    it("tolerates a null entry in the array", () => {
        expect(src).toMatch(/\.filter\(\(c\) => c &&/)
    })
})

describe("the basemap is a map, not a tile grid", () => {
    it("is no longer snapped to whole degrees", async () => {
        // The old asset carried q=1.0: every coastline point on a whole
        // degree. At a 26-degree span across ~300px that is an 11px step,
        // which is why it read as a block map.
        const land = JSON.parse(readFileSync(
            path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/data/world-land.json"), "utf8"))
        expect(land.q).toBeUndefined()
        expect(land.polygons.length).toBeGreaterThan(500)
        const pts = land.polygons.flat().slice(0, 4000)
        const fractional = pts.filter(([x, y]) => x % 1 !== 0 || y % 1 !== 0)
        expect(fractional.length / pts.length).toBeGreaterThan(0.9)
    })

    it("ships country label anchors", () => {
        const land = JSON.parse(readFileSync(
            path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/data/world-land.json"), "utf8"))
        expect(land.labels.length).toBeGreaterThan(100)
        const ua = land.labels.find((l) => l.a2 === "UA")
        expect(ua).toBeTruthy()
        expect(ua.c[0]).toBeGreaterThan(22); expect(ua.c[0]).toBeLessThan(40)
        expect(ua.c[1]).toBeGreaterThan(44); expect(ua.c[1]).toBeLessThan(53)
    })

    it("ships city labels with sane coordinates", () => {
        const cities = JSON.parse(readFileSync(
            path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/data/world-cities.json"), "utf8"))
        expect(cities.length).toBeGreaterThan(100)
        expect(cities.every((c) => c.y >= -90 && c.y <= 90 && c.x >= -180 && c.x <= 180)).toBe(true)
        const rotterdam = cities.find((c) => c.n === "Rotterdam")
        expect(rotterdam.y).toBeCloseTo(51.92, 1)
        expect(rotterdam.x).toBeCloseTo(4.48, 1)
    })
})

describe("labels appear as the frame has room for them", () => {
    it("shows fewer, larger countries as the span widens", () => {
        // Labelling every country in frame stacks NORWAY/SWEDEN/ESTONIA into
        // an unreadable smear.
        expect(labelPlan(46).minCountryArea).toBeGreaterThan(labelPlan(26).minCountryArea)
        expect(labelPlan(26).minCountryArea).toBeGreaterThan(labelPlan(8).minCountryArea)
    })

    it("drops country names when the frame is tighter than a country", () => {
        expect(labelPlan(8).countries).toBe(false)
        expect(labelPlan(26).countries).toBe(true)
    })

    it("admits more cities as it closes in", () => {
        expect(labelPlan(46).cityRank).toBeLessThan(labelPlan(8).cityRank)
        expect(labelPlan(8).cities).toBe(true)
    })
})
