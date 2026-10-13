import { describe, it, expect } from "vitest"
import {
    STRIKE_ACTS, STRIKE_GLYPH, glyphFor, strikeIconUri, strikeIconDims, strikeSize, strikeOpacity, visibleAt,
    filterStrikes, actorColor, ACTOR_COLOR, UNKNOWN_ACTOR_COLOR,
} from "./strikes.js"
import { playheadMs } from "./GlobeStrikesLayer.jsx"

const svgOf = (uri) => decodeURIComponent(uri.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""))
const DAY = 86400e3

describe("strike icons", () => {
    it("has one glyph per act, the eight the owner asked for", () => {
        expect(STRIKE_ACTS.map((a) => a.key).sort()).toEqual(Object.keys(STRIKE_GLYPH).sort())
        expect(Object.keys(STRIKE_GLYPH).sort()).toEqual(
            ["airstrike", "assault", "control", "drone", "interception", "missile", "naval", "shelling"])
    })
    it("draws each act differently", () => {
        const uris = STRIKE_ACTS.map((a) => strikeIconUri({ act: a.key, color: "#EF4444" }))
        expect(new Set(uris).size).toBe(STRIKE_ACTS.length)
    })
    it("is the asset-pin style: callout pin, actor-coloured ring and tile, line glyph", () => {
        const svg = svgOf(strikeIconUri({ act: "missile", color: "#F97316" }))
        expect(svg).toContain('viewBox="0 0 48 56"')
        expect(svg).toMatch(/<path d="M24 55 L16 44[^"]*" fill="#0b1220" stroke="#F97316"/)
        expect(svg).toContain('<rect x="7" y="7" width="34" height="32" rx="4" fill="#F97316"/>')
        expect(svg).toContain(`<path d="${STRIKE_GLYPH.missile}"/>`)
        expect(svg).toContain('stroke="#0b1220" stroke-width="2"')
    })
    it("draws a rough place hollow: dark dashed tile, glyph in the actor colour", () => {
        const svg = svgOf(strikeIconUri({ act: "drone", color: "#EF4444", hollow: true }))
        expect(svg).toContain('stroke-dasharray="4 3"')
        expect(svg).toMatch(/<g [^>]*stroke="#EF4444"/)
    })
    it("falls back to the bomb for an unknown act", () => {
        expect(glyphFor("nonsense")).toBe("airstrike")
        expect(strikeIconUri({ act: "nonsense" })).toBe(strikeIconUri({ act: "airstrike" }))
    })
    it("anchors the pin at its tip", () => {
        expect(strikeIconDims(48)).toEqual({ width: 48, height: 56, anchor: [24, 56] })
    })
    it("grows with casualties, control a little larger", () => {
        expect(strikeSize({ act: "airstrike" })).toBeLessThan(strikeSize({ act: "airstrike", casualties: { killed: 30 } }))
        expect(strikeSize({ act: "control" })).toBeGreaterThan(strikeSize({ act: "airstrike" }))
    })
})

describe("colour per actor", () => {
    it("is fixed for the named actors and stable for others", () => {
        expect(actorColor("Houthis")).toBe(ACTOR_COLOR.Houthis)
        expect(actorColor(null)).toBe(UNKNOWN_ACTOR_COLOR)
        expect(actorColor("Some militia")).toBe(actorColor("Some militia"))
    })
})

describe("fading and persistence", () => {
    const now = Date.parse("2026-10-13T12:00:00Z")
    const at = (daysAgo, act = "airstrike", window_days = act === "control" ? 30 : 14) =>
        ({ id: `${act}${daysAgo}`, act, window_days, lat: 1, lon: 1, time: new Date(now - daysAgo * DAY).toISOString() })
    it("fades from 1 to 0.25 across the event's own window", () => {
        expect(strikeOpacity(at(0), now)).toBe(1)
        expect(strikeOpacity(at(7), now)).toBeCloseTo(0.625, 3)
        expect(strikeOpacity(at(14), now)).toBeCloseTo(0.25, 3)
        // a control change over 30 days: half-faded at 15
        expect(strikeOpacity(at(15, "control"), now)).toBeCloseTo(0.625, 3)
    })
    it("drops a strike after 14 days and a control change after 30", () => {
        expect(visibleAt(at(13), now, 24 * 30)).toBe(true)
        expect(visibleAt(at(15), now, 24 * 30)).toBe(false)
        expect(visibleAt(at(29, "control"), now, 24 * 30)).toBe(true)
        expect(visibleAt(at(31, "control"), now, 24 * 30)).toBe(false)
    })
    it("replays: nothing after the playhead, the chip window applies", () => {
        const evs = [at(1), at(5), at(10)]
        expect(filterStrikes(evs, { atMs: now - 3 * DAY, windowHours: 24 * 30 }).map((e) => e.id)).toEqual(["airstrike5", "airstrike10"])
        expect(filterStrikes(evs, { atMs: now, windowHours: 24 * 7 }).map((e) => e.id)).toEqual(["airstrike1", "airstrike5"])
        expect(filterStrikes(evs, { acts: ["drone"], atMs: now })).toEqual([])
    })
    it("reads a time-strip day as the end of that day", () => {
        expect(new Date(playheadMs("2026-10-01")).toISOString()).toBe("2026-10-01T23:59:59.000Z")
    })
})
