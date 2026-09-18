import { describe, it, expect } from "vitest"
import {
    SEV_FLOOR, severityFloor, heat, buildRamp, RAMP_DOMAIN,
    rgbToLab, labToRgb, mixLab, parseColor,
    heatSize, heatOpacity, sortColdestFirst, spanFor, SPAN_BY_CONTEXT,
} from "./minimapHeat.js"

const NOW = 1_700_000_000_000
const H72 = 72 * 3_600_000
const agoH = (h) => NOW - h * 3_600_000

describe("§M4.2 — severity sets the floor, recency climbs from it", () => {
    it("uses the spec's floors", () => {
        expect(SEV_FLOOR).toEqual({ critical: 0.62, high: 0.40, moderate: 0.20, low: 0.06 })
    })

    it("NEVER lets an old critical look cool", () => {
        // "A critical can never look cool, however old."
        const oldCritical = heat(agoH(71), "critical", NOW, H72)
        const freshLow = heat(NOW, "low", NOW, H72)
        expect(oldCritical).toBeGreaterThanOrEqual(SEV_FLOOR.critical)
        expect(oldCritical).toBeGreaterThan(heat(agoH(71), "low", NOW, H72))
        expect(freshLow).toBeLessThanOrEqual(1)
    })

    it("makes the NEWEST CRITICAL the unique hottest marker", () => {
        // "On any given window exactly one thing is hottest, and it is the
        // right one."
        const rows = [
            { ts: NOW, severity: "critical" },
            { ts: NOW, severity: "high" },
            { ts: agoH(1), severity: "critical" },
            { ts: agoH(40), severity: "critical" },
        ]
        const heats = rows.map((r) => heat(r.ts, r.severity, NOW, H72))
        expect(Math.max(...heats)).toBe(heats[0])
        expect(heats[0]).toBe(1)
        // Exactly one. The spec's own formula gave a fresh LOW the same 1.0 as
        // a fresh critical, which empties the top of the ramp of meaning.
        expect(heats.filter((h) => h === 1)).toHaveLength(1)
    })

    it("caps each severity at its own band of the ramp", () => {
        const fresh = (sev) => heat(NOW, sev, NOW, H72)
        expect(fresh("critical")).toBe(1)
        expect(fresh("high")).toBeCloseTo(0.78, 6)
        expect(fresh("moderate")).toBeCloseTo(0.55, 6)
        expect(fresh("low")).toBeCloseTo(0.28, 6)
        // strictly ordered, so severity is always readable from heat alone
        expect(fresh("critical")).toBeGreaterThan(fresh("high"))
        expect(fresh("high")).toBeGreaterThan(fresh("moderate"))
        expect(fresh("moderate")).toBeGreaterThan(fresh("low"))
    })

    it("decays fast then flattens, so 'live' is visible in the first hours", () => {
        // Compared PER HOUR: the earlier version compared a 6-hour drop with
        // a 54-hour one and concluded the curve was the wrong way round.
        const perHour = (a, b, hours) => (a - b) / hours
        const early = perHour(heat(NOW, "high", NOW, H72), heat(agoH(6), "high", NOW, H72), 6)
        const late = perHour(heat(agoH(6), "high", NOW, H72), heat(agoH(60), "high", NOW, H72), 54)
        expect(early).toBeGreaterThan(late)
    })

    it("maps this app's own severity words onto the spec's four", () => {
        expect(severityFloor("elevated")).toBe(SEV_FLOOR.high)
        expect(severityFloor("medium")).toBe(SEV_FLOOR.moderate)
    })

    it("falls back to the floor alone for an undated record", () => {
        // Climbing the ramp on a guessed age would make an undated record
        // look fresh — the one thing this ramp must never do.
        expect(heat(null, "critical", NOW, H72)).toBe(SEV_FLOOR.critical)
        expect(heat(NOW, "critical", NOW, 0)).toBe(SEV_FLOOR.critical)
    })
})

describe("§M4.2 — Lab interpolation, not RGB", () => {
    it("round-trips a colour through Lab", () => {
        for (const c of [[79, 127, 166], [196, 69, 60], [255, 107, 82]]) {
            const back = labToRgb(rgbToLab(c))
            for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - c[i])).toBeLessThanOrEqual(1)
        }
    })

    it("passes through an EMBER rather than a dead grey-brown mid-ramp", () => {
        // The spec's whole reason for Lab: "the mid-ramp is where most of
        // your markers live, so it is the part that must not look broken."
        const steel = [79, 127, 166], red = [196, 69, 60]
        const lab = mixLab(steel, red, 0.5)
        const rgbMid = [0, 1, 2].map((i) => Math.round((steel[i] + red[i]) / 2))
        // Lab keeps more chroma than the flat RGB average: the naive midpoint
        // is a muddier, less saturated colour.
        const chroma = (c) => Math.max(...c) - Math.min(...c)
        expect(chroma(lab)).toBeGreaterThan(chroma(rgbMid))
    })

    it("parses hex and rgb(), and survives nonsense", () => {
        expect(parseColor("#c4453c")).toEqual([196, 69, 60])
        expect(parseColor("#fff")).toEqual([255, 255, 255])
        expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3])
        expect(parseColor("var(--red)")).toBeNull()
    })
})

describe("§M4.2 — the ramp", () => {
    const ramp = buildRamp(["#4f7fa6", "#8a4a3a", "#b7822c", "#c4453c", "#ff6b52"])

    it("uses the spec's five stops", () => {
        expect(RAMP_DOMAIN).toEqual([0, 0.28, 0.55, 0.78, 1])
    })

    it("is cool at the bottom and hot at the top", () => {
        const blueness = (c) => { const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(c); return +m[3] - +m[1] }
        expect(blueness(ramp(0))).toBeGreaterThan(0)
        expect(blueness(ramp(1))).toBeLessThan(0)
    })

    it("clamps rather than throwing outside 0..1", () => {
        expect(ramp(-5)).toBe(ramp(0))
        expect(ramp(99)).toBe(ramp(1))
        expect(ramp(NaN)).toBe(ramp(0))
    })

    it("survives a token that failed to resolve, instead of rendering nothing", () => {
        // getComputedStyle returns "" for an unknown property; a ramp that
        // throws there takes the whole locator with it.
        const r = buildRamp(["", "", "", "", ""])
        expect(r(0.5)).toMatch(/^rgb\(/)
    })
})

describe("§M4.3 — three channels, one variable", () => {
    it("moves colour, size and opacity together", () => {
        expect(heatSize(0)).toBeCloseTo(4.4)
        expect(heatSize(1)).toBeCloseTo(8.6)
        expect(heatOpacity(0)).toBeCloseTo(0.35)
        expect(heatOpacity(1)).toBeCloseTo(1)
    })

    it("paints coldest first so the hottest can never be occluded", () => {
        // SVG has no z-index; paint order IS depth.
        const rows = [
            { id: "hot", ts: NOW, severity: "critical" },
            { id: "cold", ts: agoH(70), severity: "low" },
            { id: "mid", ts: agoH(20), severity: "high" },
        ]
        expect(sortColdestFirst(rows, NOW, H72).map((r) => r.id)).toEqual(["cold", "mid", "hot"])
    })
})

describe("§M6 — span by context, never a constant", () => {
    it("uses the spec's table", () => {
        expect(spanFor("port")).toBe(8)
        expect(spanFor("incident")).toBe(14)
        expect(spanFor("signal")).toBe(26)
        expect(spanFor("chokepoint")).toBe(34)
        expect(spanFor("country")).toBe(46)
    })

    it("falls back to the signal default for an unknown context", () => {
        expect(spanFor("nonsense")).toBe(26)
        expect(spanFor(undefined)).toBe(26)
    })

    it("tightens for a facility and widens for a corridor", () => {
        expect(SPAN_BY_CONTEXT.facility).toBeLessThan(SPAN_BY_CONTEXT.signal)
        expect(SPAN_BY_CONTEXT.corridor).toBeGreaterThan(SPAN_BY_CONTEXT.signal)
    })
})
