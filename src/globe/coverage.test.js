import { describe, it, expect } from "vitest"
import { classify, STATE, MOD, isGap, cellKey, cellBounds, underCoveredAssets, scoreNote, CELL_DEG } from "./coverage.js"

describe("§13 — only classes A and B count as instruments", () => {
    it("a cell reached solely by press is not covered, it is rumoured", () => {
        expect(classify({ press: 0.9 }).key).toBe("presswatch")
        expect(classify({ press: 1.0 }, { tasked: true }).key).toBe("presswatch")
    })

    it("press can never push a cell to instrumented, at any strength", () => {
        expect(classify({ sar: 0.9, press: 1.0 }, { tasked: true }).key).not.toBe("instrumented")
    })

    it("lists press as class D precisely so it can be excluded", () => {
        expect(MOD.press.cls).toBe("D")
        expect(MOD.sar.cls).toBe("A")
        expect(MOD.ais.cls).toBe("B")
    })
})

describe("§13 — the four states", () => {
    it("two instruments AND a standing task is instrumented", () => {
        expect(classify({ sar: 0.8, opt: 0.7 }, { tasked: true }).key).toBe("instrumented")
    })

    it("two instruments with nobody looking is an archive, not a watch", () => {
        // "instrumented" is the one state claiming someone would notice.
        expect(classify({ sar: 0.8, opt: 0.7 }, { tasked: false }).key).toBe("archive")
    })

    it("one instrument is archive", () => {
        expect(classify({ sar: 0.8 }, { tasked: true }).key).toBe("archive")
    })

    it("nothing at all is blind", () => {
        expect(classify({}).key).toBe("blind")
        expect(classify({ press: 0.1 }).key).toBe("blind")
    })

    it("names press-only as the dangerous state in its own words", () => {
        expect(STATE.presswatch.meaning).toMatch(/looks like coverage/i)
        expect(STATE.blind.meaning).toMatch(/Absence of signal carries no information/)
    })
})

describe("§13 — the layer draws the gaps", () => {
    it("treats everything but instrumented as a gap", () => {
        // "Rendering what works is decoration; rendering what does not is the
        // product."
        expect(isGap(STATE.instrumented)).toBe(false)
        for (const k of ["archive", "presswatch", "blind"]) expect(isGap(STATE[k])).toBe(true)
    })
})

describe("cells", () => {
    it("bins on a 10° grid and round-trips to its own bounds", () => {
        expect(CELL_DEG).toBe(10)
        const k = cellKey(26.5, 56.2)
        const b = cellBounds(k)
        expect(b.south).toBeLessThanOrEqual(26.5)
        expect(b.north).toBeGreaterThan(26.5)
        expect(b.west).toBeLessThanOrEqual(56.2)
        expect(b.east).toBeGreaterThan(56.2)
    })

    it("handles the southern and western hemispheres", () => {
        const b = cellBounds(cellKey(-33.9, -18.4))
        expect(b.south).toBeLessThanOrEqual(-33.9)
        expect(b.west).toBeLessThanOrEqual(-18.4)
    })
})

describe("§13 — the list of assets you cannot see", () => {
    const cells = {
        [cellKey(26.5, 56.2)]: { instruments: 2, state: STATE.instrumented },
        [cellKey(12.5, 43.3)]: { instruments: 1, state: STATE.archive },
        [cellKey(-5, 20)]:     { instruments: 0, state: STATE.presswatch },
    }

    it("excludes what IS covered and sorts by fewest instruments", () => {
        // "A coverage map that does not end in that list is wallpaper."
        const rows = underCoveredAssets([
            { name: "Hormuz terminal", lat: 26.5, lon: 56.2 },
            { name: "Bab el-Mandeb buoy", lat: 12.5, lon: 43.3 },
            { name: "Congo depot", lat: -5, lon: 20 },
        ], cells)
        expect(rows.map((r) => r.asset.name)).toEqual(["Congo depot", "Bab el-Mandeb buoy"])
        expect(rows[0].tag).toBe("none")
        expect(rows[1].tag).toBe("thin")
    })

    it("treats an asset in an unmodelled cell as blind, not as covered", () => {
        const rows = underCoveredAssets([{ name: "Nowhere", lat: 70, lon: 170 }], cells)
        expect(rows).toHaveLength(1)
        expect(rows[0].state.key).toBe("blind")
    })

    it("skips assets with no usable position rather than placing them at 0,0", () => {
        expect(underCoveredAssets([{ name: "No fix" }], cells)).toHaveLength(0)
    })
})

describe("scoreNote — what the count means for a score", () => {
    it("changes with the instrument count, and says what one feed costs", () => {
        expect(scoreNote(2)).toMatch(/corroboration/)
        expect(scoreNote(1)).toMatch(/outage in that feed is indistinguishable/)
        expect(scoreNote(0)).toMatch(/about reporting, not about the world/)
    })
})
