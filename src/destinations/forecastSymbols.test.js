import { describe, it, expect } from "vitest"
import {
    FRAMES, SIZE, ICONS, DOMAINS, AFFILIATIONS, TINT,
    frameFor, iconFor, tintFor,
} from "./forecastSymbols.js"

describe("APP-6 symbology", () => {
    it("draws every affiliation in every domain", () => {
        for (const dom of DOMAINS) {
            for (const aff of AFFILIATIONS) {
                expect(FRAMES[dom][aff], `${dom}/${aff}`).toBeTruthy()
                expect(FRAMES[dom][aff].d, `${dom}/${aff}`).toMatch(/^M/)
            }
        }
    })

    it("opens air frames at the base and closes ground frames", () => {
        // This single difference is what stops an air movement reading
        // as a road march. A closed air frame says the formation is
        // standing on the ground.
        for (const aff of AFFILIATIONS) {
            expect(FRAMES.air[aff].closed, `air/${aff}`).toBe(false)
            expect(FRAMES.air[aff].d, `air/${aff}`).not.toMatch(/Z\s*$/)
            expect(FRAMES.ground[aff].closed, `ground/${aff}`).toBe(true)
            expect(FRAMES.ground[aff].d, `ground/${aff}`).toMatch(/Z\s*$/)
            expect(FRAMES.sea[aff].closed, `sea/${aff}`).toBe(true)
        }
    })

    it("falls back rather than throwing on an unknown domain or affiliation", () => {
        expect(frameFor({ domain: "orbital", aff: "friendly" })).toBe(FRAMES.ground.friendly)
        expect(frameFor({ domain: "air", aff: "martian" })).toBe(FRAMES.air.unknown)
        expect(frameFor(null)).toBe(FRAMES.ground.unknown)
        expect(frameFor({})).toBe(FRAMES.ground.unknown)
    })

    it("returns an empty glyph, never undefined, for a unit with no function", () => {
        // undefined reaching a path's d attribute renders the string
        // "undefined" as path data and silently draws nothing.
        expect(iconFor({ icon: "none" })).toBe("")
        expect(iconFor({ icon: "nonsense" })).toBe("")
        expect(iconFor(null)).toBe("")
        expect(iconFor({ icon: "armour" })).toMatch(/^M/)
    })

    it("carries the full echelon ladder", () => {
        for (const k of ["coy", "bn", "regt", "bde", "div", "corps"]) {
            expect(SIZE[k], k).toBeTruthy()
        }
    })

    it("tints by affiliation and falls back to unknown", () => {
        expect(tintFor({ aff: "hostile" })).toBe(TINT.hostile)
        expect(tintFor({ aff: "nope" })).toBe(TINT.unknown)
        expect(tintFor(null)).toBe(TINT.unknown)
    })
})

describe("APP-6 colour and installation coding", () => {
    it("keeps APP-6 meaning in the app's own muted palette", async () => {
        const { APP6 } = await import("./forecastSymbols.js")
        // Red is hostile and blue is friendly — the standard's meaning —
        // but expressed in the tokens Analytics uses, because four
        // fluorescent colours in a muted console is decoration.
        expect(APP6.hostile.frame).toContain("--red")
        expect(APP6.friendly.frame).toContain("--acc")
        // No raw hex left: the map has to follow the theme.
        for (const a of Object.values(APP6)) {
            expect(a.fill).toMatch(/^var\(--/)
            expect(a.frame).toMatch(/^var\(--/)
        }
        // Affiliations stay distinguishable.
        expect(new Set(Object.values(APP6).map((a) => a.frame)).size).toBe(4)
    })

    it("gives every facility kind a glyph and falls back safely", async () => {
        const { FACILITY_KINDS, facilityIcon } = await import("./forecastSymbols.js")
        expect(FACILITY_KINDS).toContain("airfield")
        expect(FACILITY_KINDS).toContain("port")
        for (const k of FACILITY_KINDS) expect(facilityIcon(k), k).toMatch(/^M/)
        expect(facilityIcon("wormhole")).toBe("")
        expect(facilityIcon(null)).toBe("")
    })

    it("marks installations with the top tab that separates them from units", async () => {
        const { INSTALLATION_TAB } = await import("./forecastSymbols.js")
        // Without it an airfield is drawn as though it were a formation
        // standing on the spot.
        expect(INSTALLATION_TAB).toMatch(/^M/)
        expect(INSTALLATION_TAB).toMatch(/Z$/)
    })

    it("returns a theme token for any input, never undefined", async () => {
        const { fillFor, tintFor } = await import("./forecastSymbols.js")
        for (const aff of ["friendly", "hostile", "neutral", "unknown", "nonsense"]) {
            expect(fillFor({ aff })).toMatch(/^var\(--/)
            expect(tintFor({ aff })).toMatch(/^var\(--/)
        }
        expect(fillFor(null)).toMatch(/^var\(--/)
    })
})

describe("what a unit is, in words", () => {
    it("gives a strength RANGE, never a single number", async () => {
        // A brigade is not 4,000 people. A single figure would be
        // invented precision on top of a symbol that is doctrinal
        // rather than observed.
        const { strengthOf } = await import("./forecastSymbols.js")
        expect(strengthOf("bde")).toMatch(/–/)
        expect(strengthOf("coy")).toMatch(/–/)
        expect(strengthOf("nonsense")).toBeNull()
        expect(strengthOf(null)).toBeNull()
    })

    it("orders echelons so a bigger formation is bigger", async () => {
        const { ECHELON_STRENGTH } = await import("./forecastSymbols.js")
        const order = ["team", "squad", "plt", "coy", "bn", "regt", "bde", "div", "corps"]
        for (let i = 1; i < order.length; i++) {
            expect(ECHELON_STRENGTH[order[i]][0], order[i])
                .toBeGreaterThan(ECHELON_STRENGTH[order[i - 1]][0])
        }
    })

    it("draws a unit's kit from the matching arm, not the whole army", async () => {
        // An artillery symbol should show howitzers, not pistols.
        const { equipmentFor } = await import("./forecastSymbols.js")
        const items = { artillery: ["K9 Thunder", "CAESAR"], small_arms: ["Glock 19"] }
        expect(equipmentFor({ icon: "artillery" }, items)).toContain("K9 Thunder")
        expect(equipmentFor({ icon: "artillery" }, items)).not.toContain("Glock 19")
        expect(equipmentFor({ icon: "infantry" }, items)).toEqual(["Glock 19"])
    })

    it("returns nothing rather than guessing when the arm has no kit listed", async () => {
        const { equipmentFor } = await import("./forecastSymbols.js")
        expect(equipmentFor({ icon: "none" }, { armour: ["x"] })).toEqual([])
        expect(equipmentFor({ icon: "armour" }, null)).toEqual([])
        expect(equipmentFor(null, {})).toEqual([])
    })
})
