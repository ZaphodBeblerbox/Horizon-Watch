import { describe, it, expect } from "vitest"
import {
    recencyAlpha, makeArrivalTracker, arrivalScale,
    FRESH_MINUTES, STALE_HOURS, MIN_ALPHA, ARRIVAL_MS,
} from "./liveness.js"

const MIN = 60000
const HOUR = 60 * MIN

// ── recency is what makes a map feel alive ────────────────────────────────
//
// A map where a report from four minutes ago looks exactly like one from
// yesterday is a map of an archive, however much it wiggles.

describe("recencyAlpha", () => {
    it("gives something happening now full weight", () => {
        const now = Date.now()
        expect(recencyAlpha(now, now)).toBe(1)
        expect(recencyAlpha(now - 20 * MIN, now)).toBe(1)
    })

    it("dims with age", () => {
        const now = Date.now()
        const a = recencyAlpha(now - 1 * HOUR, now)
        const b = recencyAlpha(now - 6 * HOUR, now)
        expect(a).toBeGreaterThan(b)
    })

    it("spends its resolution where the difference matters", () => {
        // Five minutes versus an hour is a real difference; eighteen
        // hours versus nineteen is not. A linear ramp gets this backwards.
        const now = Date.now()
        const earlyGap = recencyAlpha(now - 35 * MIN, now) - recencyAlpha(now - 95 * MIN, now)
        const lateGap = recencyAlpha(now - 18 * HOUR, now) - recencyAlpha(now - 19 * HOUR, now)
        expect(earlyGap).toBeGreaterThan(lateGap)
    })

    it("never fades a mark out of existence", () => {
        // Dim is a statement about age, not about truth.
        const now = Date.now()
        expect(recencyAlpha(now - 100 * 24 * HOUR, now)).toBe(MIN_ALPHA)
        expect(MIN_ALPHA).toBeGreaterThan(0)
    })

    it("treats an unknown age as present, not ancient", () => {
        // A mark with no timestamp is a gap in the data. Rendering it as
        // a year old would be inventing an age for it.
        expect(recencyAlpha(undefined)).toBe(1)
        expect(recencyAlpha(NaN)).toBe(1)
    })
})

// ── only what arrives while you are watching is an arrival ────────────────

describe("arrival tracking", () => {
    it("treats the first load as history, not as news", () => {
        // Pulsing every mark that was already there is the "shouts at
        // every event" failure in visual form.
        const t = makeArrivalTracker()
        expect(t.arrivals(["a", "b", "c"])).toEqual([])
    })

    it("reports what lands afterwards", () => {
        const t = makeArrivalTracker()
        t.arrivals(["a", "b"])
        expect(t.arrivals(["a", "b", "c"])).toEqual(["c"])
    })

    it("never reports the same arrival twice", () => {
        const t = makeArrivalTracker()
        t.arrivals(["a"])
        expect(t.arrivals(["a", "b"])).toEqual(["b"])
        expect(t.arrivals(["a", "b"])).toEqual([])
    })

    it("an empty first poll still counts as the seed", () => {
        // Otherwise a feed that is briefly empty would later replay its
        // entire backlog as arrivals.
        const t = makeArrivalTracker()
        t.arrivals([])
        expect(t.arrivals(["a"])).toEqual(["a"])
    })
})

describe("arrivalScale", () => {
    it("emphasises briefly and then settles by itself", () => {
        const now = Date.now()
        expect(arrivalScale(now, now)).toBeGreaterThan(1.5)
        expect(arrivalScale(now - ARRIVAL_MS, now)).toBe(1)
        expect(arrivalScale(now - 10 * 60000, now)).toBe(1)
    })

    it("spends most of the emphasis in the first seconds", () => {
        const now = Date.now()
        const early = arrivalScale(now - 0.1 * ARRIVAL_MS, now)
        const late = arrivalScale(now - 0.8 * ARRIVAL_MS, now)
        expect(early - 1).toBeGreaterThan((late - 1) * 4)
    })

    it("leaves nothing permanently emphasised", () => {
        const now = Date.now()
        expect(arrivalScale(now - 3 * ARRIVAL_MS, now)).toBe(1)
    })
})
