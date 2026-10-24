import { describe, it, expect } from "vitest"
import { createNewTracker, addPulses, getPulses, subscribePulses, FRESH_MS } from "./newOnMap.js"
import { PULSE, pulseFrame, pulseRingIcon, svgOf, PRIORITY } from "./mapIcons.js"

const NOW = Date.parse("2026-10-24T12:00:00Z")

describe("new on the map pulses (owner, 2026-10-24)", () => {
    it("the layer's first picture pulses nothing; a recent item arriving after does, once", () => {
        const tr = createNewTracker()
        expect(tr.observe("liveSignals", [{ id: "a", t: NOW - 60_000 }], NOW)).toEqual([])
        const fresh = tr.observe("liveSignals", [{ id: "a", t: NOW - 60_000 }, { id: "b", t: NOW - 30_000 }], NOW + 30_000)
        expect(fresh.map((x) => x.id)).toEqual(["b"])
        expect(tr.observe("liveSignals", [{ id: "b", t: NOW - 30_000 }], NOW + 60_000)).toEqual([])
    })

    it("an old item brought into view by a pan, or one with no time, does not pulse", () => {
        const tr = createNewTracker()
        tr.observe("protests", [{ id: "x", t: NOW }], NOW)
        expect(tr.observe("protests", [{ id: "old", t: NOW - FRESH_MS - 1 }, { id: "port", t: NaN }], NOW)).toEqual([])
    })

    it("a layer loading empty first still settles, then a new item pulses", () => {
        const tr = createNewTracker({ baselineMs: 15_000 })
        expect(tr.observe("strikes", [], NOW)).toEqual([])
        expect(tr.observe("strikes", [], NOW + 16_000)).toEqual([])
        expect(tr.observe("strikes", [{ id: "s", t: NOW + 15_000 }], NOW + 20_000).map((x) => x.id)).toEqual(["s"])
    })

    it("a layer turned off and on again starts from a first picture", () => {
        const tr = createNewTracker()
        tr.observe("l", [{ id: "a", t: NOW }], NOW)
        tr.reset("l")
        expect(tr.observe("l", [{ id: "b", t: NOW }], NOW)).toEqual([])
    })

    it("the pulse is one ring in the priority colour, over a few seconds, then over", () => {
        expect(PULSE.ms).toBeGreaterThanOrEqual(2000)
        expect(PULSE.ms).toBeLessThanOrEqual(5000)
        expect(svgOf(pulseRingIcon("urgent").uri)).toContain(PRIORITY.urgent)
        expect(pulseFrame(0)).toMatchObject({ scale: PULSE.from })
        expect(pulseFrame(PULSE.ms)).toBeNull()
        const seen = []
        const off = subscribePulses((p) => seen.push(p.length))
        addPulses([{ id: "z", lat: 48.86, lon: 2.36, pri: "urgent" }], NOW)
        expect(getPulses(NOW + 100)).toHaveLength(1)
        expect(getPulses(NOW + PULSE.ms)).toHaveLength(0)
        expect(seen.at(-1)).toBe(1)
        off()
    })
})
