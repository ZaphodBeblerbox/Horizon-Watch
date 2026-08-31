import { describe, it, expect } from "vitest"
import {
    severityColorToken, confidencePct, timeAgoLabel, severityRank, sortRowsBySeverity,
    buildWatchQueueRow, buildWatchQueueRows, filterWithinHours, zoneExceedsBaseline,
} from "./dashboardLogic.js"

// Realistic-shaped fixtures — a real surface-pool/alert item (see
// backend/main.py's _build_surface_pool()) and a real normalized fusion item
// (see notificationsNormalize.js's normalizeFusionEvent() output shape).
const ALERT_ITEM = {
    id: "news_abc123",
    headline: "Vessel diversion reported near Bab-el-Mandeb",
    location: "Yemen",
    severity_tier: "significant",
    published_at: "2026-08-30T10:00:00.000Z",
    context: "3 AIS anomalies clustered near the strait in the last 6 hours.",
    confidence: 0.62,
}

const FUSION_ITEM = {
    id: "FUS-2026-0091",
    kind: "fusion",
    title: "Multi-domain corroboration near Bab-el-Mandeb",
    subtitle: "Maritime AIS anomaly corroborated by open-source reporting",
    narrative: "Vessel diversions cross-referenced against three independent news sources.",
    severity: "critical",
    confidence: 0.87,
    location_name: "Bab-el-Mandeb Strait",
    published_at: "2026-08-30T11:30:00.000Z",
    timestamp: "2026-08-30T11:30:00.000Z",
}

describe("severityColorToken", () => {
    it("maps every real severity_tier value", () => {
        expect(severityColorToken("critical")).toBe("var(--danger)")
        expect(severityColorToken("significant")).toBe("var(--warn)")
        expect(severityColorToken("elevated")).toBe("var(--warn)")
        expect(severityColorToken("low")).toBe("var(--live)")
    })

    it("maps every real fusion/WatchZone severity value", () => {
        expect(severityColorToken("high")).toBe("var(--warn)")
        expect(severityColorToken("medium")).toBe("var(--warn)")
    })

    it("falls back to the medium look for an unrecognized value", () => {
        expect(severityColorToken("something_else")).toBe("var(--warn)")
        expect(severityColorToken(undefined)).toBe("var(--warn)")
    })
})

describe("confidencePct", () => {
    it("converts a 0-1 float to a whole-number percentage", () => {
        expect(confidencePct(0.87)).toBe(87)
        expect(confidencePct(0)).toBe(0)
        expect(confidencePct(1)).toBe(100)
    })

    it("clamps out-of-range values", () => {
        expect(confidencePct(1.4)).toBe(100)
        expect(confidencePct(-0.2)).toBe(0)
    })

    it("returns null (not a fabricated 0) for missing confidence", () => {
        expect(confidencePct(undefined)).toBeNull()
        expect(confidencePct(null)).toBeNull()
        expect(confidencePct("")).toBeNull()
    })
})

describe("timeAgoLabel", () => {
    const now = new Date("2026-08-30T12:00:00.000Z").getTime()

    it("renders sub-minute ages as 'just now'", () => {
        expect(timeAgoLabel("2026-08-30T11:59:45.000Z", now)).toBe("just now")
    })

    it("renders minute-scale ages", () => {
        expect(timeAgoLabel("2026-08-30T11:45:00.000Z", now)).toBe("15m ago")
    })

    it("renders hour-scale ages", () => {
        expect(timeAgoLabel("2026-08-30T09:00:00.000Z", now)).toBe("3h ago")
    })

    it("renders day-scale ages", () => {
        expect(timeAgoLabel("2026-08-27T12:00:00.000Z", now)).toBe("3d ago")
    })

    it("returns '' for a missing timestamp", () => {
        expect(timeAgoLabel(null, now)).toBe("")
        expect(timeAgoLabel(undefined, now)).toBe("")
    })
})

describe("buildWatchQueueRow", () => {
    it("normalizes a plain surface-pool/alert item", () => {
        const row = buildWatchQueueRow(ALERT_ITEM)
        expect(row).toMatchObject({
            id: "news_abc123",
            severityToken: "var(--warn)",
            title: "Vessel diversion reported near Bab-el-Mandeb",
            description: "3 AIS anomalies clustered near the strait in the last 6 hours.",
            aoi: "Yemen",
            publishedAt: "2026-08-30T10:00:00.000Z",
            confidencePct: 62,
        })
    })

    it("normalizes a fusion item using its own real field names", () => {
        const row = buildWatchQueueRow(FUSION_ITEM)
        expect(row).toMatchObject({
            id: "FUS-2026-0091",
            severityToken: "var(--danger)",
            title: "Multi-domain corroboration near Bab-el-Mandeb",
            description: "Vessel diversions cross-referenced against three independent news sources.",
            aoi: "Bab-el-Mandeb Strait",
            confidencePct: 87,
        })
    })

    it("falls back to a subtitle when a fusion item has no narrative", () => {
        const row = buildWatchQueueRow({ ...FUSION_ITEM, narrative: "" })
        expect(row.description).toBe("Maritime AIS anomaly corroborated by open-source reporting")
    })

    it("never throws on an empty/malformed item", () => {
        expect(() => buildWatchQueueRow({})).not.toThrow()
        expect(buildWatchQueueRow({}).title).toBe("(untitled)")
    })

    it("buildWatchQueueRows maps a whole array and tolerates a non-array input", () => {
        expect(buildWatchQueueRows([ALERT_ITEM, FUSION_ITEM])).toHaveLength(2)
        expect(buildWatchQueueRows(null)).toEqual([])
    })

    it("carries real lat/lon/kind/raw through for the click-to-fly/inspect handler", () => {
        const alertWithPos = { ...ALERT_ITEM, lat: 12.5, lon: 43.4 }
        const fusionWithPos = { ...FUSION_ITEM, lat: 12.6, lon: 43.3 }
        expect(buildWatchQueueRow(alertWithPos)).toMatchObject({ lat: 12.5, lon: 43.4, kind: "event", raw: alertWithPos })
        expect(buildWatchQueueRow(fusionWithPos)).toMatchObject({ lat: 12.6, lon: 43.3, kind: "fusion", raw: fusionWithPos })
    })

    it("defaults lat/lon to null (never a fabricated position) when absent", () => {
        expect(buildWatchQueueRow(ALERT_ITEM)).toMatchObject({ lat: null, lon: null })
    })
})

describe("severityRank", () => {
    it("ranks the real severity_tier vocabulary most-urgent-first", () => {
        expect(severityRank({ severity_tier: "critical" })).toBe(0)
        expect(severityRank({ severity_tier: "significant" })).toBe(1)
        expect(severityRank({ severity_tier: "elevated" })).toBe(2)
        expect(severityRank({ severity_tier: "low" })).toBe(3)
    })

    it("maps a fusion item's real severity onto the same real ordering", () => {
        expect(severityRank({ kind: "fusion", severity: "critical" })).toBe(0)
        expect(severityRank({ kind: "fusion", severity: "high" })).toBe(1)
        expect(severityRank({ kind: "fusion", severity: "medium" })).toBe(2)
        expect(severityRank({ kind: "fusion", severity: "low" })).toBe(3)
    })

    it("ranks an unrecognized/missing tier last, never ahead of a real one", () => {
        expect(severityRank({})).toBe(4)
        expect(severityRank({ severity_tier: "something_else" })).toBe(4)
    })
})

describe("sortRowsBySeverity", () => {
    it("orders rows by severity first, most urgent first", () => {
        const rows = buildWatchQueueRows([
            { id: "a", headline: "low item", severity_tier: "low", published_at: "2026-08-30T10:00:00.000Z" },
            { id: "b", headline: "critical item", severity_tier: "critical", published_at: "2026-08-30T09:00:00.000Z" },
            { id: "c", headline: "elevated item", severity_tier: "elevated", published_at: "2026-08-30T11:00:00.000Z" },
        ])
        expect(sortRowsBySeverity(rows).map(r => r.id)).toEqual(["b", "c", "a"])
    })

    it("breaks same-severity ties by most-recent-first", () => {
        const rows = buildWatchQueueRows([
            { id: "older", headline: "x", severity_tier: "critical", published_at: "2026-08-30T08:00:00.000Z" },
            { id: "newer", headline: "y", severity_tier: "critical", published_at: "2026-08-30T10:00:00.000Z" },
        ])
        expect(sortRowsBySeverity(rows).map(r => r.id)).toEqual(["newer", "older"])
    })

    it("does not mutate the input array and tolerates a non-array input", () => {
        const rows = buildWatchQueueRows([ALERT_ITEM, FUSION_ITEM])
        const original = [...rows]
        sortRowsBySeverity(rows)
        expect(rows).toEqual(original)
        expect(sortRowsBySeverity(null)).toEqual([])
    })
})

describe("filterWithinHours", () => {
    const now = new Date("2026-08-30T12:00:00.000Z").getTime()

    it("includes an item exactly at the window boundary", () => {
        const items = [{ published_at: "2026-08-30T08:00:00.000Z" }] // exactly 4h ago
        expect(filterWithinHours(items, 4, now)).toHaveLength(1)
    })

    it("excludes an item just past the window", () => {
        const items = [{ published_at: "2026-08-30T07:59:00.000Z" }] // 4h01m ago
        expect(filterWithinHours(items, 4, now)).toHaveLength(0)
    })

    it("excludes an item with no real timestamp rather than assuming it's recent", () => {
        expect(filterWithinHours([{}], 4, now)).toHaveLength(0)
    })

    it("excludes a future-dated item (clock skew) rather than counting it", () => {
        const items = [{ published_at: "2026-08-30T13:00:00.000Z" }]
        expect(filterWithinHours(items, 4, now)).toHaveLength(0)
    })

    it("returns [] for a non-array input", () => {
        expect(filterWithinHours(null, 4, now)).toEqual([])
    })
})

describe("zoneExceedsBaseline", () => {
    it("is true only when the real backend-computed trend is 'increasing'", () => {
        expect(zoneExceedsBaseline({ vessel_activity_trend: "increasing" })).toBe(true)
        expect(zoneExceedsBaseline({ vessel_activity_trend: "stable" })).toBe(false)
        expect(zoneExceedsBaseline({ vessel_activity_trend: "decreasing" })).toBe(false)
    })

    it("is false when analytics haven't loaded yet", () => {
        expect(zoneExceedsBaseline(null)).toBe(false)
        expect(zoneExceedsBaseline(undefined)).toBe(false)
    })
})
