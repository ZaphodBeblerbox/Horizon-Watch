import { describe, it, expect } from "vitest"
import {
    statusRingColor, entityMarkerSvg, getEntityMarkerDataUri, resolveSanctionsStatus,
    graphNodeIcon,
} from "./entityIcons.js"

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

describe("entityMarkerSvg pulse", () => {
    it("draws a translucent halo ring when pulse is true and there's no status ring", () => {
        const plain = entityMarkerSvg({ entityType: "fusion", color: "#BF5AF2" })
        const pulsed = entityMarkerSvg({ entityType: "fusion", color: "#BF5AF2", pulse: true })
        expect(plain).not.toMatch(/stroke="#BF5AF255"/)
        expect(pulsed).toMatch(/stroke="#BF5AF255"/)
    })

    it("does not draw a pulse ring when a real status ring is already present", () => {
        const svg = entityMarkerSvg({ entityType: "vessel", color: "#BF5AF2", pulse: true, sanctionsStatus: "confirmed" })
        expect(svg).not.toMatch(/stroke="#BF5AF255"/)
        expect(svg).toMatch(/stroke="#EF4444"/) // the real status ring still renders
    })
})

describe("fusion entity type", () => {
    it("renders the fusion glyph without throwing (real, still-used entity kind)", () => {
        expect(() => entityMarkerSvg({ entityType: "fusion" })).not.toThrow()
    })
})

describe("graphNodeIcon", () => {
    it("maps every real ForceGraph canonical type to a real entityType", () => {
        expect(graphNodeIcon("vessel").entityType).toBe("vessel")
        expect(graphNodeIcon("aircraft").entityType).toBe("aircraft")
        expect(graphNodeIcon("alert").entityType).toBe("alert")
        expect(graphNodeIcon("surge").entityType).toBe("alert")
        expect(graphNodeIcon("fusion_event").entityType).toBe("fusion")
        expect(graphNodeIcon("assessment").entityType).toBe("news_event")
        expect(graphNodeIcon("port").entityType).toBe("facility")
        expect(graphNodeIcon("airport").entityType).toBe("facility")
        expect(graphNodeIcon("cable").entityType).toBe("facility")
        expect(graphNodeIcon("watch_zone").entityType).toBe("zone")
        expect(graphNodeIcon("strategic_zone").entityType).toBe("zone")
        expect(graphNodeIcon("rule").entityType).toBe("generic")
    })

    it("falls back to a muted generic glyph for an unrecognized type, never throwing", () => {
        const result = graphNodeIcon("not-a-real-type")
        expect(result.entityType).toBe("generic")
        expect(result.color).toBe("#6B7A90")
    })

    it("gives every recognized type the same standard glyph tone", () => {
        expect(graphNodeIcon("vessel").color).toBe("#E8EEF7")
        expect(graphNodeIcon("rule").color).toBe("#E8EEF7")
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

    it("caches pulse separately from a non-pulsed marker with otherwise-identical options", () => {
        const plain  = getEntityMarkerDataUri({ entityType: "fusion", color: "#BF5AF2" })
        const pulsed = getEntityMarkerDataUri({ entityType: "fusion", color: "#BF5AF2", pulse: true })
        expect(plain).not.toBe(pulsed)
    })
})
