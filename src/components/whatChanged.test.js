import { describe, it, expect } from "vitest"
import {
    windowFor, changedItems, summarise, sevRank, humanAge,
    readLastSeen, writeLastSeen, LAST_SEEN_KEY, MAX_AGE_MS,
} from "./whatChanged.js"

const NOW = Date.parse("2026-09-24T12:00:00Z")
const at = (iso, severity) => ({ id: iso, severity, published_at: iso })

describe("what changed", () => {
    it("shows the last 24h on a first visit", () => {
        const w = windowFor(null, NOW)
        expect(w.label).toBe("LAST 24 HOURS")
        expect(w.firstVisit).toBe(true)
    })

    it("never produces an empty card after a reload", () => {
        // "Since you last looked: nothing" two seconds after a refresh
        // teaches a reader to stop reading the one panel that must be
        // worth reading.
        const w = windowFor(NOW - 2000, NOW)
        expect(w.label).toBe("LAST 24 HOURS")
        expect(w.since).toBe(NOW - 24 * 3600 * 1000)
    })

    it("describes the real gap once it is over a day", () => {
        const w = windowFor(NOW - 6 * 3600 * 1000 - 24 * 3600 * 1000, NOW)
        expect(w.label).toMatch(/SINCE YOU LAST LOOKED · 1d ago/)
        expect(w.firstVisit).toBe(false)
    })

    it("treats a stale mark as a first visit", () => {
        expect(windowFor(NOW - MAX_AGE_MS - 1, NOW).firstVisit).toBe(true)
    })

    it("ignores a mark from the future, which means the clock moved", () => {
        expect(windowFor(NOW + 60000, NOW).firstVisit).toBe(true)
    })

    it("orders by severity first, then recency", () => {
        const items = [
            at("2026-09-24T11:59:00Z", "moderate"),
            at("2026-09-24T09:00:00Z", "critical"),
            at("2026-09-24T11:00:00Z", "high"),
            at("2026-09-24T11:30:00Z", "critical"),
        ]
        const got = changedItems(items, NOW - 24 * 3600 * 1000).map((i) => i.severity)
        expect(got).toEqual(["critical", "critical", "high", "moderate"])
        // and the newer of the two criticals leads
        expect(changedItems(items, NOW - 24 * 3600 * 1000)[0].id)
            .toBe("2026-09-24T11:30:00Z")
    })

    it("drops anything outside the window or undateable", () => {
        const items = [at("2026-09-20T10:00:00Z", "critical"),
                       { id: "x", severity: "high" }]
        expect(changedItems(items, NOW - 3600 * 1000)).toEqual([])
    })

    it("counts high and critical together, because both interrupt", () => {
        const items = [at("2026-09-24T11:00:00Z", "critical"),
                       at("2026-09-24T11:00:00Z", "high"),
                       at("2026-09-24T11:00:00Z", "low")]
        expect(summarise(items)).toBe("3 new signals, 2 high or critical")
        expect(summarise([items[2]])).toBe("1 new signal, 0 high or critical")
        expect(summarise([])).toBe("Nothing new in this window.")
    })

    it("ranks unknown severities at the bottom rather than throwing", () => {
        expect(sevRank("critical")).toBeGreaterThan(sevRank("moderate"))
        expect(sevRank(null)).toBe(0)
        expect(sevRank("nonsense")).toBe(0)
    })

    it("survives storage that throws, as private mode does", () => {
        const bad = { getItem() { throw new Error("denied") },
                      setItem() { throw new Error("denied") } }
        expect(readLastSeen(bad)).toBeNull()
        expect(() => writeLastSeen(bad)).not.toThrow()
        expect(readLastSeen(null)).toBeNull()
    })

    it("round-trips through a real store", () => {
        const mem = new Map()
        const store = { getItem: (k) => mem.get(k) ?? null,
                        setItem: (k, v) => mem.set(k, v) }
        writeLastSeen(store, NOW)
        expect(readLastSeen(store)).toBe(NOW)
        expect(mem.get(LAST_SEEN_KEY)).toBe(String(NOW))
    })

    it("phrases an age a person would say", () => {
        expect(humanAge(30 * 60000)).toBe("moments ago")
        expect(humanAge(6 * 3600000)).toBe("6h ago")
        expect(humanAge(50 * 3600000)).toBe("2d ago")
    })
})

describe("the card must never cover the map's own controls", () => {
    it("sits below the side panes in the stack", async () => {
        // The panes are z-index 3 and overlay the canvas. At 6 the card
        // sat on top of an open pane and covered its header — including
        // the button that collapses it, so the sidebar could not be
        // closed at all.
        const { readFileSync } = await import("node:fs")
        const css = readFileSync("src/styles/designSystem.css", "utf8")
        const wc = css.slice(css.indexOf("\n.wc {"), css.indexOf("\n.wc-head"))
        expect(wc).toMatch(/z-index:\s*2\b/)
        const pill = css.slice(css.indexOf("\n.wc-pill {"))
        expect(pill.slice(0, 200)).toMatch(/z-index:\s*2\b/)
    })

    it("insets itself with the map's own convention, not a literal", async () => {
        // Hardcoding the open-pane width means the card drifts the moment
        // the pane token changes.
        const { readFileSync } = await import("node:fs")
        const css = readFileSync("src/styles/designSystem.css", "utf8")
        const wc = css.slice(css.indexOf("\n.wc {"), css.indexOf("\n.wc-head"))
        expect(wc).toContain("var(--map-inset-l")
    })

    it("clears the basemap-health bar rather than landing on it", async () => {
        // That bar is absolutely placed at top 8 in the same corner.
        const { readFileSync } = await import("node:fs")
        const css = readFileSync("src/styles/designSystem.css", "utf8")
        const wc = css.slice(css.indexOf("\n.wc {"), css.indexOf("\n.wc-head"))
        expect(wc).toMatch(/top:\s*40px/)
    })
})

describe("what happened since I left", () => {
    it("groups by kind, because a bare count says nothing", async () => {
        const { groupByKind } = await import("./whatChanged.js")
        const items = [
            { domain: "AIS", severity: "low", title: "a" },
            { domain: "AIS", severity: "low", title: "b" },
            { domain: "GDELT", severity: "low", title: "c" },
        ]
        expect(groupByKind(items)).toContain("2 maritime")
        expect(groupByKind(items)).toContain("1 news")
    })

    it("names the most serious thing, which is what they came back for", async () => {
        const { groupByKind } = await import("./whatChanged.js")
        const items = [
            { domain: "AIS", severity: "low", title: "routine" },
            { domain: "GDELT", severity: "critical", title: "Strike near Kharkiv" },
        ]
        expect(groupByKind(items)).toContain("Strike near Kharkiv")
    })

    it("says nothing extra when nothing is serious", async () => {
        const { groupByKind } = await import("./whatChanged.js")
        const out = groupByKind([{ domain: "AIS", severity: "low", title: "x" }])
        expect(out).toBe("1 maritime.")
    })

    it("reads a domain out of whatever the producer supplied", async () => {
        const { kindOf } = await import("./whatChanged.js")
        expect(kindOf({ domain: "AIS" })).toBe("maritime")
        expect(kindOf({ source_type: "adsb" })).toBe("air")
        expect(kindOf({ kind: "risk index" })).toBe("risk")
        expect(kindOf({ source: "SAR scene" })).toBe("imagery")
        expect(kindOf({})).toBe("other")
    })

    it("distinguishes a quiet window from a first visit", async () => {
        const { quietReason } = await import("./whatChanged.js")
        expect(quietReason({ firstVisit: true })).toContain("first visit")
        expect(quietReason({ firstVisit: false })).toContain("finding, not a gap")
    })
})
