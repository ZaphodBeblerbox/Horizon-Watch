import { describe, it, expect } from "vitest"
import { freshnessState, zulu, ago, STALE_MIN } from "./Freshness.jsx"

const T = (iso) => new Date(iso).getTime()

describe("freshness", () => {
    it("reads the time in Zulu, because the reader may not be where the data is", () => {
        expect(zulu(new Date("2026-09-24T14:32:00Z"))).toBe("14:32Z")
        expect(zulu(new Date("2026-09-24T04:05:00Z"))).toBe("04:05Z")
        expect(zulu(null)).toBeNull()
        expect(zulu(new Date("nonsense"))).toBeNull()
    })

    it("says how long ago in units a person uses", () => {
        expect(ago(30 * 1000)).toBe("just now")
        expect(ago(4 * 60000)).toBe("4m ago")
        expect(ago(3 * 3600000)).toBe("3h ago")
        expect(ago(50 * 3600000)).toBe("2d ago")
        expect(ago(-5)).toBeNull()
    })

    it("is green while fresh and amber once stale", () => {
        const now = T("2026-09-24T14:36:00Z")
        expect(freshnessState("2026-09-24T14:32:00Z", now).tone).toBe("fresh")
        expect(freshnessState("2026-09-24T13:00:00Z", now).tone).toBe("stale")
    })

    it("uses the stated staleness threshold, not a guess", () => {
        const now = T("2026-09-24T14:00:00Z")
        const justUnder = new Date(now - (STALE_MIN - 1) * 60000).toISOString()
        const justOver = new Date(now - (STALE_MIN + 1) * 60000).toISOString()
        expect(freshnessState(justUnder, now).tone).toBe("fresh")
        expect(freshnessState(justOver, now).tone).toBe("stale")
    })

    it("says OFFLINE rather than merely old", () => {
        // A stale reading and a console nothing is updating are different
        // facts, and conflating them is how a disconnected app goes on
        // looking alive.
        const now = T("2026-09-24T14:36:00Z")
        const s = freshnessState("2026-09-24T14:32:00Z", now, false)
        expect(s.tone).toBe("offline")
        expect(s.text.startsWith("Offline · ")).toBe(true)
    })

    it("admits when it does not know the age", () => {
        expect(freshnessState(null).text).toBe("Data age unknown")
        expect(freshnessState("not a date").tone).toBe("unknown")
        expect(freshnessState(null, Date.now(), false).text)
            .toContain("Offline")
    })
})


describe("what the fetch layer actually saw outranks navigator.onLine", () => {
    // The case this exists for: Railway restarting. The browser still has
    // a network, so navigator.onLine stays true, while every request fails
    // and offlineCache serves the last good body. A green dot over data
    // nothing is updating is the exact dishonesty this component prevents.
    const CACHED_AT = new Date("2026-09-25T14:00:00Z").toISOString()
    const NOW = new Date("2026-09-25T14:30:00Z").getTime()

    it("says the server is unreachable even when the browser thinks it is online", () => {
        const s = freshnessState(CACHED_AT, NOW, true, { state: "cached", cachedAt: CACHED_AT })
        expect(s.tone).toBe("offline")
        expect(s.text).toMatch(/Server unreachable/)
    })

    it("names how old the stored data is", () => {
        const s = freshnessState(CACHED_AT, NOW, true, { state: "cached", cachedAt: CACHED_AT })
        expect(s.text).toContain("14:00Z")
        expect(s.text).toContain("30m ago")
    })

    it("still says something honest when the cache has no timestamp", () => {
        const s = freshnessState(CACHED_AT, NOW, true, { state: "cached", cachedAt: null })
        expect(s.tone).toBe("offline")
        expect(s.text).toBe("Server unreachable · showing stored data")
    })

    it("goes back to normal once the server answers again", () => {
        const fresh = new Date(NOW - 60000).toISOString()
        const s = freshnessState(fresh, NOW, true, { state: "live", cachedAt: null })
        expect(s.tone).toBe("fresh")
        expect(s.text).not.toMatch(/unreachable/)
    })

    it("is unchanged when the fetch layer has said nothing yet", () => {
        const fresh = new Date(NOW - 60000).toISOString()
        expect(freshnessState(fresh, NOW, true, null).tone).toBe("fresh")
    })
})
