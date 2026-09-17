import { describe, it, expect } from "vitest"
import {
    getVesselMarkerDataUri, getAircraftMarkerDataUri,
    AIRCRAFT_TYPE_COLOR, __shapes,
} from "./vesselAircraftGlyphs.js"

const svg = (uri) => decodeURIComponent(uri.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""))

describe("§7 — four paths in one group", () => {
    it("draws body, shade, highlight and detail for a vessel", () => {
        const s = svg(getVesselMarkerDataUri({}))
        expect(s).toContain(__shapes.SHIP.body)
        expect(s).toContain(__shapes.SHIP.shade)
        expect(s).toContain(__shapes.SHIP.hl)
        expect(s).toContain(__shapes.SHIP.det)
    })

    it("draws the airframe's fuselage, wings and tailplanes", () => {
        const s = svg(getAircraftMarkerDataUri({}))
        expect(s).toContain(__shapes.PLANE.body)
        expect(s).toContain(__shapes.PLANE.shade)
    })

    it("is well-formed SVG with a single rotating group", () => {
        for (const uri of [getVesselMarkerDataUri({}), getAircraftMarkerDataUri({})]) {
            const s = svg(uri)
            expect(s.startsWith("<svg")).toBe(true)
            expect(s.trim().endsWith("</svg>")).toBe(true)
            expect((s.match(/<g /g) || []).length).toBe(1)
            expect((s.match(/<path/g) || []).length).toBe(5)   // 4 form + 1 wake
        }
    })
})

describe("§7 rule 2 — shading is a neutral overlay, never its own hue", () => {
    it("darkens and lightens without shifting the colour underneath", () => {
        // This is what lets a sanctioned hull stay red and still read as a hull.
        const s = svg(getVesselMarkerDataUri({ sanctioned: true }))
        expect(s).toContain("rgba(0,0,0,.30)")
        expect(s).toContain("rgba(255,255,255,.26)")
        expect(s).toContain("#c4453c")
    })

    it("keeps the sanctioned hull red rather than recolouring the shade", () => {
        const plain = svg(getVesselMarkerDataUri({}))
        const sanctioned = svg(getVesselMarkerDataUri({ sanctioned: true }))
        expect(plain).toContain("#7fa8c9")
        expect(sanctioned).toContain("#c4453c")
        // the overlay is identical in both
        for (const s of [plain, sanctioned]) expect(s).toContain("rgba(0,0,0,.30)")
    })
})

describe("theme", () => {
    it("burns the light palette into the image, since a data URI cannot read a CSS var", () => {
        const light = svg(getVesselMarkerDataUri({ theme: "light" }))
        expect(light).toContain("#37719f")
        expect(light).toContain("rgba(40,30,16,.26)")
        expect(light).not.toContain("rgba(0,0,0,.30)")
    })

    it("caches per theme, so switching does not serve the dark glyph on paper", () => {
        expect(getVesselMarkerDataUri({ theme: "dark" })).not.toBe(getVesselMarkerDataUri({ theme: "light" }))
    })

    it("falls back to dark for an unknown theme rather than rendering colourless", () => {
        expect(svg(getVesselMarkerDataUri({ theme: "nonsense" }))).toContain("#7fa8c9")
    })
})

describe("aircraft classification colour is state, not decoration", () => {
    it("tints by real classification", () => {
        for (const [k, hex] of Object.entries(AIRCRAFT_TYPE_COLOR)) {
            expect(svg(getAircraftMarkerDataUri({ classification: k }))).toContain(hex)
        }
    })

    it("watchlisted overrides classification entirely", () => {
        const s = svg(getAircraftMarkerDataUri({ watchlisted: true, classification: "military" }))
        expect(s).toContain("#b7822c")
        expect(s).not.toContain(AIRCRAFT_TYPE_COLOR.military)
    })
})

describe("the wake", () => {
    it("trails astern in the same image, so one rotation carries both", () => {
        const s = svg(getVesselMarkerDataUri({}))
        // dashed, and scaled with the glyph — left at the spec's raw .9 the
        // stroke renders sub-pixel in a 26px billboard and the wake is simply
        // not there.
        expect(s).toMatch(/stroke-dasharray="[\d.]+ [\d.]+"/)
        const w = Number(s.match(/stroke-width="([\d.]+)" stroke-dasharray/)[1])
        expect(w).toBeGreaterThan(0.9)
        // starts at the stern and runs further from the bow, never through the hull
        const m = s.match(/M0,([\d.]+) V([\d.]+)/)
        expect(Number(m[2])).toBeGreaterThan(Number(m[1]))
    })
})
