import { describe, it, expect } from "vitest"
import { statusRingColor, entityMarkerSvg, getEntityMarkerDataUri, resolveSanctionsStatus } from "./entityIcons.js"

describe("resolveSanctionsStatus", () => {
    it("returns 'confirmed' for a confirmed sanctions hit", () => {
        expect(resolveSanctionsStatus({ sanctions_hit: true, sanctions_hit_confirmed: true })).toBe("confirmed")
    })

    it("returns 'possible' for a flag-mismatched (unconfirmed) sanctions hit", () => {
        expect(resolveSanctionsStatus({ sanctions_hit: true, sanctions_hit_confirmed: false })).toBe("possible")
    })

    it("returns 'possible' for a ship-to-ship transfer rule with no explicit confirmed flag", () => {
        expect(resolveSanctionsStatus({ rule_name: "Ship-to-Ship Transfer" })).toBe("possible")
    })

    it("reads nested payload.* fields the same as top-level ones", () => {
        expect(resolveSanctionsStatus({ payload: { sanctions_hit: true, sanctions_hit_confirmed: true } })).toBe("confirmed")
    })

    it("returns null for a clean alert with no sanctions signal at all", () => {
        expect(resolveSanctionsStatus({ rule_name: "Dark Ship Detected" })).toBeNull()
        expect(resolveSanctionsStatus({})).toBeNull()
        expect(resolveSanctionsStatus(null)).toBeNull()
    })
})

describe("statusRingColor", () => {
    it("maps real sanctions status to the spec's real color tokens, never a shape", () => {
        expect(statusRingColor("confirmed")).toBe("#EF4444") // --danger
        expect(statusRingColor("possible")).toBe("#F5A524") // --warn
    })

    it("returns null (no ring) for a clean/unknown entity — never fabricates a status", () => {
        expect(statusRingColor(null)).toBeNull()
        expect(statusRingColor(undefined)).toBeNull()
        expect(statusRingColor("nonsense")).toBeNull()
    })
})

describe("entityMarkerSvg", () => {
    it("produces real, well-formed SVG markup with no affiliation-frame shapes", () => {
        const svg = entityMarkerSvg({ entityType: "vessel" })
        expect(svg).toMatch(/^<svg /)
        expect(svg).toMatch(/<\/svg>$/)
        // No diamond/polygon frame geometry — the cancelled MIL-STD system's signature
        expect(svg).not.toMatch(/<polygon/)
    })

    it("draws a status ring only when a real sanctions status is present", () => {
        const clean = entityMarkerSvg({ entityType: "vessel", sanctionsStatus: null })
        const confirmed = entityMarkerSvg({ entityType: "vessel", sanctionsStatus: "confirmed" })
        expect(clean).not.toMatch(/stroke="#EF4444"/)
        expect(confirmed).toMatch(/stroke="#EF4444"/)
    })

    it("draws a corner badge for a real vessel sub-type, never for an unrecognized one", () => {
        const tanker = entityMarkerSvg({ entityType: "vessel", subtype: "tanker" })
        const unknown = entityMarkerSvg({ entityType: "vessel", subtype: "not-a-real-subtype" })
        expect(tanker).toMatch(/fill="#E8C547"/) // overlay-yellow
        expect(unknown).not.toMatch(/fill="#E8C547"/)
    })

    it("falls back to a generic marker for an unrecognized entity type rather than throwing", () => {
        expect(() => entityMarkerSvg({ entityType: "not-a-real-type" })).not.toThrow()
    })
})

describe("getEntityMarkerDataUri", () => {
    it("returns a valid data URI", () => {
        const uri = getEntityMarkerDataUri({ entityType: "aircraft" })
        expect(uri.startsWith("data:image/svg+xml")).toBe(true)
    })

    it("caches identical option sets to the same reference", () => {
        const a = getEntityMarkerDataUri({ entityType: "aircraft", subtype: "military" })
        const b = getEntityMarkerDataUri({ entityType: "aircraft", subtype: "military" })
        expect(a).toBe(b)
    })

    it("produces different output for different real inputs", () => {
        const a = getEntityMarkerDataUri({ entityType: "aircraft", subtype: "military" })
        const b = getEntityMarkerDataUri({ entityType: "aircraft", subtype: "commercial" })
        expect(a).not.toBe(b)
    })
})
