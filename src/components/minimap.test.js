import { describe, it, expect } from "vitest"
import {
    makeProjection, easeOut, DEFAULT_SPAN, MINIMAP_HEIGHT,
    CONTEXT_SIZE, SUBJECT_SIZE, PING_DELAYS, PING_MS,
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
