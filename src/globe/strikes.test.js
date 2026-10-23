import { describe, it, expect } from "vitest"
import {
    STRIKE_ACTS, STRIKE_GLYPH, glyphFor, strikeIconUri, strikeIconDims, strikeSize, strikeOpacity, visibleAt,
    filterStrikes, actorColor, ACTOR_COLOR, UNKNOWN_ACTOR_COLOR, strikePriority, strikeGlyph,
} from "./strikes.js"
import { EDGE, STROKE, PRIORITY, ICON_PX } from "../lib/mapIcons.js"
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
    it("is a reported event: a circle in the one typology, coloured by priority, never by actor", () => {
        const svg = svgOf(strikeIconUri({ act: "missile", color: "#F97316" }))
        expect(svg).toContain('viewBox="0 0 24 24"')
        expect(svg).toContain("<circle")
        expect(svg).not.toContain("#F97316")
        expect(svg).toContain(`stroke="${EDGE}" stroke-width="${STROKE}"`)
        expect(svgOf(strikeIconUri({ act: "missile", priority: "flash" }))).toContain(PRIORITY.flash)
    })
    it("draws a rough place uncorroborated-style: a dotted edge, fainter", () => {
        const svg = svgOf(strikeIconUri({ act: "drone", hollow: true }))
        expect(svg).toContain('stroke-dasharray="0.1 2.4"')
        expect(svg).toContain('opacity="0.6"')
    })
    it("falls back to the bomb for an unknown act", () => {
        expect(glyphFor("nonsense")).toBe("airstrike")
        expect(strikeIconUri({ act: "nonsense" })).toBe(strikeIconUri({ act: "airstrike" }))
    })
    it("is centred on the place, one constant size", () => {
        expect(strikeIconDims(24)).toEqual({ width: 24, height: 24, anchor: [12, 12] })
    })
    it("never grows with casualties: what it did is priority and card text", () => {
        expect(strikeSize({ act: "airstrike" })).toBe(strikeSize({ act: "airstrike", casualties: { killed: 300 } }))
        expect(strikeSize({ act: "control" })).toBe(ICON_PX)
        expect(strikePriority({ casualties: { killed: 30 } })).toBe("urgent")
        expect(strikePriority({})).toBe("alert")
        expect(strikePriority({ priority: "flash" })).toBe("flash")
    })
})

describe("the right glyph for the act (owner, 2026-10-23 evening)", () => {
    it("a shooting or local violence is the crime glyph, never the bomb", () => {
        expect(strikeGlyph({ act: "airstrike", weapon_stated: false, title: "Gunman opens fire at a market, 3 killed" })).toBe("crime")
        expect(strikeGlyph({ act: "airstrike", weapon_stated: false, title: "Man stabbed his wife in domestic attack" })).toBe("crime")
        expect(strikeGlyph({ act: "airstrike", weapon_stated: false, title: "Strike hit the polyclinic" })).toBe("strike")
        expect(strikeGlyph({ act: "airstrike", weapon_stated: true, title: "Airstrike on the depot" })).toBe("airstrike")
        expect(strikeGlyph({ act: "interception", title: "Air defence shot down 12 drones" })).toBe("interception")
        expect(decodeURIComponent(strikeIconUri({ event: { act: "airstrike", weapon_stated: false, title: "shots fired near the school" } })))
            .not.toBe(decodeURIComponent(strikeIconUri({ act: "airstrike" })))
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
