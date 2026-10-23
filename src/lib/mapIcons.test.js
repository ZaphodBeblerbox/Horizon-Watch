import { describe, it, expect } from "vitest"
import {
    markerIcon, pinIcon, trafficIcon, trafficTone, infraIcon, dotIcon, clusterIcon, svgOf, legendRows, priorityOf, topPriority,
    GLYPH, PRIORITY, OURS, EDGE, STROKE, SIZE, STATES, KIND_SHAPE,
} from "./mapIcons.js"

const svg = (i) => svgOf(i.uri)

describe("shape = what kind of knowledge", () => {
    it("circle, square, triangle, diamond for event, confirmed, derived, news", () => {
        expect(svg(markerIcon({ kind: "event" }))).toContain("<circle")
        expect(svg(markerIcon({ kind: "confirmed" }))).toContain("<rect")
        expect(svg(markerIcon({ kind: "derived" }))).toMatch(/<path d="M12 2.6L21.2 19.2H2.8Z"/)
        expect(svg(markerIcon({ kind: "news" }))).toMatch(/<path d="M12 2.4L21.6 12L12 21.6L2.4 12Z"/)
        expect(Object.keys(KIND_SHAPE)).toEqual(["event", "confirmed", "derived", "news"])
    })
    it("every glyph renders inside every shape without throwing, at the one size", () => {
        for (const g of Object.keys(GLYPH)) for (const kind of Object.keys(KIND_SHAPE)) {
            const i = markerIcon({ kind, glyph: g })
            expect(i.w).toBe(SIZE.event)
            expect(svg(i)).toContain(`width="${SIZE.event * 2}"`)
        }
    })
})

describe("colour = what it means to you", () => {
    it("one ramp: flash red, urgent amber, alert and info neutral; red only for flash", () => {
        expect(svg(markerIcon({ priority: "flash" }))).toContain(PRIORITY.flash)
        for (const p of ["urgent", "alert", "info"]) expect(svg(markerIcon({ priority: p }))).not.toContain(PRIORITY.flash)
    })
    it("severity words map onto the ramp; green never appears", () => {
        expect(priorityOf("critical")).toBe("flash")
        expect(priorityOf("high")).toBe("urgent")
        expect(priorityOf("medium")).toBe("alert")
        expect(priorityOf("low")).toBe("info")
        expect(priorityOf("quiet")).toBe("info")
        expect(topPriority(["info", "urgent", "alert"])).toBe("urgent")
        expect(Object.values(PRIORITY).join()).not.toMatch(/#(3DDC97|4CAF7A|0f9d58|3ddc84)/i)
    })
    it("ours is gold, traffic neutral unless flagged", () => {
        expect(svg(pinIcon({}))).toContain(OURS.gold)
        expect(trafficTone({})).toBe("neutral")
        expect(trafficTone({ watchlisted: true })).toBe("urgent")
        expect(trafficTone({ military: true })).toBe("urgent")
        expect(svg(trafficIcon({ kind: "ship", tone: "urgent" }))).toContain(PRIORITY.urgent)
    })
})

describe("state, one rule everywhere", () => {
    const s = (state) => svg(markerIcon({ kind: "event", priority: "urgent", state }))
    it("developing has a ring, past is hollow and faint, upcoming dashed, muted dotted and 0.6", () => {
        expect(s("developing")).toMatch(/r="11" fill="none" stroke="#F5A524"/)
        expect(s("live")).not.toMatch(/r="11"/)
        expect(s("past")).toContain('opacity="0.45"')
        expect(s("past")).toContain(`fill="${EDGE}"`)
        expect(s("upcoming")).toContain('stroke-dasharray="2.6 1.8"')
        expect(s("muted")).toContain('opacity="0.6"')
        expect(s("muted")).toContain('stroke-dasharray="0.1 2.4"')
        expect(svg(markerIcon({ selected: true }))).toMatch(/stroke="#FFFFFF" stroke-width="2"/)
        expect(new Set(STATES.map(s)).size).toBe(STATES.length)
    })
})

describe("constant pixel sizes, one edge", () => {
    it("events 24, ours 30x36, traffic 16, infrastructure 18, cluster 30 whatever the count", () => {
        expect(markerIcon({}).w).toBe(24)
        expect([pinIcon({}).w, pinIcon({}).h]).toEqual([30, 36])
        expect(pinIcon({}).anchor).toEqual([15, 36])
        expect(trafficIcon({}).w).toBe(16)
        expect(infraIcon({ glyph: "port" }).w).toBe(18)
        expect(clusterIcon(2).w).toBe(clusterIcon(2000).w)
    })
    it("the one edge colour and weight on every kind", () => {
        for (const i of [markerIcon({}), pinIcon({}), clusterIcon(3)]) expect(svg(i)).toMatch(/stroke-width="(1.5|2|2.4)"/)
        expect(svg(markerIcon({}))).toContain(`stroke="${EDGE}" stroke-width="${STROKE}"`)
        expect(svg(infraIcon({ glyph: "port" }))).toContain(`stroke="${EDGE}"`)
        expect(svg(trafficIcon({}))).toContain(`stroke="${EDGE}"`)
    })
    it("the cluster ring is the highest priority inside", () => {
        expect(svg(clusterIcon(5, "flash"))).toContain(PRIORITY.flash)
        expect(svg(clusterIcon(5))).toContain(PRIORITY.alert)
        expect(svg(clusterIcon(5, "urgent"))).toContain(">5<")
    })
    it("dots: you a small blue glowing dot (no white or dotted ring), the team 12, hollow when not live", () => {
        expect(dotIcon({ role: "me" }).w).toBe(16)
        expect(svg(dotIcon({ role: "me" }))).not.toContain('stroke="#FFFFFF"')
        expect(svg(dotIcon({ role: "me" }))).not.toContain("stroke-dasharray")
        expect(svg(dotIcon({ role: "me" }))).toContain("radialGradient")
        expect(svg(dotIcon({ role: "me", live: false }))).not.toContain("stroke-dasharray")
        expect(dotIcon({ role: "team" }).w).toBe(12)
        expect(svg(dotIcon({ role: "team", live: false }))).toContain('fill-opacity="0.6"')
    })
})

describe("one legend definition", () => {
    it("shapes, colours and states, each row with an icon from this module", () => {
        const rows = legendRows()
        expect(rows.map((r) => r.section)).toEqual(["What it is", "What it means to you", "State"])
        for (const r of rows.flatMap((x) => x.rows)) expect(r.uri).toMatch(/^data:image\/svg\+xml/)
        expect(rows[1].rows.map((r) => r.key)).toEqual(["flash", "urgent", "alert", "info"])
    })
})
