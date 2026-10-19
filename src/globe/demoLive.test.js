import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IDLE_MS, LIVE_MS, _resetLive, anyLive, livePoll, nextPollMs, protestLive } from "./demoLive.js"

const NOW = Date.parse("2026-10-19T18:00:00Z")
const ago = (min) => new Date(NOW - min * 60_000).toISOString()

describe("demoLive — the desktop follows protests in near real time (owner, 2026-10-19)", () => {
    beforeEach(() => _resetLive())

    it("a protest under way, or about to start, is live; a planned one tomorrow or an ended one is not", () => {
        expect(protestLive({ status: { key: "ongoing" } }, NOW)).toBe(true)
        expect(protestLive({ status: { key: "dispersing" } }, NOW)).toBe(true)
        expect(protestLive({ status: { key: "planned" }, starts_utc: new Date(NOW + 20 * 60_000).toISOString() }, NOW)).toBe(true)
        expect(protestLive({ status: { key: "planned" }, starts_utc: new Date(NOW + 20 * 3_600_000).toISOString() }, NOW)).toBe(false)
        expect(protestLive({ status: { key: "ended" } }, NOW)).toBe(false)
    })
    it("reads every 15 s while anything is under way, every 2 min when nothing is", () => {
        expect(nextPollMs({ protests: [{ status: { key: "ended" } }] }, NOW)).toBe(IDLE_MS)
        expect(nextPollMs({ cities: [{ crowds: [{ at: ago(90) }] }] }, NOW)).toBe(IDLE_MS)
        expect(nextPollMs({ reports: [{ at: ago(70), valid_min: 60 }] }, NOW)).toBe(IDLE_MS)
        expect(anyLive({ cities: [{ crowds: [{ at: ago(20) }] }] }, NOW)).toBe(true)
        expect(anyLive({ reports: [{ at: ago(10), valid_min: 60 }] }, NOW)).toBe(true)
        expect(nextPollMs({ protests: [{ status: { key: "ongoing" } }] }, NOW)).toBe(LIVE_MS)
        // one layer seeing a march keeps the others fast for a while
        expect(nextPollMs({ reports: [] }, NOW + 60_000)).toBe(LIVE_MS)
        expect(nextPollMs({ reports: [] }, NOW + 10 * 60_000)).toBe(IDLE_MS)
    })

    describe("livePoll", () => {
        afterEach(() => vi.useRealTimers())
        it("polls fast while live and slow when not, and stops", async () => {
            vi.useFakeTimers()
            vi.setSystemTime(NOW)
            const answers = [{ protests: [{ status: { key: "ongoing" } }] }, { protests: [{ status: { key: "ongoing" } }] }, { protests: [] }]
            let n = 0
            const seen = []
            const fetchImpl = async () => ({ ok: true, json: async () => answers[Math.min(n++, answers.length - 1)] })
            const stop = livePoll("/x", (d) => seen.push(d), { fetchImpl, win: null })
            await vi.advanceTimersByTimeAsync(0)
            expect(seen).toHaveLength(1)
            await vi.advanceTimersByTimeAsync(LIVE_MS)
            expect(seen).toHaveLength(2)
            await vi.advanceTimersByTimeAsync(LIVE_MS)
            expect(seen).toHaveLength(3)
            stop()
            await vi.advanceTimersByTimeAsync(IDLE_MS * 2)
            expect(seen).toHaveLength(3)
        })
    })
})
