import { describe, it, expect, beforeEach } from "vitest"
import {
    ageColor, ageSegments, positionAt, upTo, extendTrack, stopLabel, trackUrl, showTrack, hideTrack, getTrack, setTrack,
    subscribeTrack, distanceLabel, tsOf,
} from "./track.js"

const T0 = Date.parse("2026-10-12T09:00:00Z")
const pt = (min, lat, lon) => ({ at: new Date(T0 + min * 60_000).toISOString(), lat, lon })
const LINE = Array.from({ length: 25 }, (_, i) => pt(i * 5, 48.85 + i * 0.001, 2.35))

describe("the line coloured by age", () => {
    it("fades older parts: paler and more transparent", () => {
        const old = ageColor(0), now = ageColor(1)
        expect(now.a).toBe(1)
        expect(old.a).toBeLessThan(0.3)
        expect(now.b).toBeGreaterThan(old.b)
    })
    it("cuts the line into runs that join without gaps, oldest first", () => {
        const segs = ageSegments(LINE, 6)
        expect(segs.length).toBe(6)
        for (let i = 1; i < segs.length; i++) {
            const prevEnd = segs[i - 1].coords.at(-1)
            expect(prevEnd).toEqual(segs[i].coords[0])
            expect(segs[i].color.a).toBeGreaterThan(segs[i - 1].color.a)
        }
    })
    it("keeps the whole track's colours while replaying part of it", () => {
        const full = [tsOf(LINE[0]), tsOf(LINE.at(-1))]
        const part = upTo(LINE, T0 + 30 * 60_000)
        const segs = ageSegments(part, 6, full)
        expect(segs.at(-1).color.a).toBeLessThan(0.7)        // a third of the way: still faded
    })
})

describe("the scrubber", () => {
    it("interpolates where they were between two points", () => {
        const p = positionAt(LINE, T0 + 7.5 * 60_000)
        expect(p.lat).toBeCloseTo(48.8515, 4)
        expect(p.i).toBe(1)
    })
    it("clamps before the start and after the end", () => {
        expect(positionAt(LINE, T0 - 1e6).lat).toBe(LINE[0].lat)
        expect(positionAt(LINE, T0 + 1e9).lat).toBe(LINE.at(-1).lat)
    })
    it("draws only up to the moment, ending exactly there", () => {
        const part = upTo(LINE, T0 + 12 * 60_000)
        expect(part.length).toBe(4)
        expect(Date.parse(part.at(-1).at)).toBe(T0 + 12 * 60_000)
    })
})

describe("live extension", () => {
    const data = { points: LINE.slice(0, 3), distance_m: 222, kept: 3, end: LINE[2] }
    it("appends a newer position that moved", () => {
        const next = extendTrack(data, { lat: 48.86, lon: 2.35, at: T0 + 60 * 60_000 })
        expect(next.points.length).toBe(4)
        expect(next.end.live).toBe(true)
        expect(next.distance_m).toBeGreaterThan(222)
    })
    it("ignores an older one, and a jitter under 10 m within a minute", () => {
        expect(extendTrack(data, { lat: 48.86, lon: 2.35, at: T0 })).toBe(data)
        const last = LINE[2]
        expect(extendTrack(data, { lat: last.lat + 0.00002, lon: last.lon, at: tsOf(last) + 5000 })).toBe(data)
    })
})

describe("words and urls", () => {
    it("says a stop with its times and length", () => {
        const s = { arrived: pt(0, 0, 0).at, departed: pt(29, 0, 0).at, minutes: 29 }
        expect(stopLabel(s, T0)).toMatch(/^Stopped .+ – .+ · 29 min$/)
        expect(stopLabel({ ...s, minutes: 95 }, T0)).toMatch(/1 h 35$/)
        expect(distanceLabel(850)).toBe("850 m")
        expect(distanceLabel(12_400)).toBe("12 km")
    })
    it("asks the asset's or the person's endpoint", () => {
        expect(trackUrl("", { kind: "asset", id: "OA-1" }, "7d")).toBe("/api/my-assets/OA-1/track/range?range=7d&max_points=600")
        expect(trackUrl("", { kind: "person", id: "u 1" }, "1h")).toBe("/api/my-assets/people/u%201/track?range=1h&max_points=600")
    })
})

describe("the store", () => {
    beforeEach(() => hideTrack())
    it("shows one track at a time and tells its listeners", () => {
        const seen = []
        const off = subscribeTrack((s) => seen.push(s.target?.id ?? null))
        showTrack({ kind: "asset", id: "A" })
        setTrack({ data: { points: [] } })
        showTrack({ kind: "asset", id: "B" }, "6h")
        expect(getTrack().target.id).toBe("B")
        expect(getTrack().range).toBe("6h")
        expect(getTrack().data).toBe(null)                    // a new target starts empty
        off()
        expect(seen).toEqual(["A", "A", "B"])
    })
})
