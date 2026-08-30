import { describe, it, expect } from "vitest"
import {
    groupNameForItem,
    groupItemsByDomain,
    severityColorToken,
    fusionSeverityToAlertTier,
    itemPrimaryLabel,
    itemChips,
    formatItemTimestamp,
    sortedGroupEntries,
    MULTI_DOMAIN_GROUP,
    UNCATEGORIZED_GROUP,
} from "./watchlistsGrouping.js"

// Realistic-shaped fixtures mirroring notificationsNormalize.test.js's real
// field names — a normalized fusion item (as normalizeFusionEvent produces)
// and a plain alert/surface-pool item (as the drawer/app.jsx already build).
const FUSION_MULTI = {
    id: "FUS-2026-0091",
    kind: "fusion",
    title: "Multi-domain corroboration near Bab-el-Mandeb",
    subtitle: "Maritime AIS anomaly corroborated by open-source reporting",
    severity: "critical",
    confidence: 0.87,
    domains: ["MARITIME", "NEWS"],
    lat: 12.6,
    lon: 43.4,
    published_at: "2026-08-29T14:03:00",
    raw: { contributing_alert_ids: ["ALERT-1", "ALERT-2"] },
}

const FUSION_SINGLE = {
    id: "FUS-2026-0092",
    kind: "fusion",
    title: "Escalation chain — border skirmish reporting",
    severity: "medium",
    confidence: 0.42,
    domains: ["NEWS"],
    published_at: "2026-08-29T09:15:00",
}

const FUSION_NO_DOMAINS = {
    id: "FUS-2026-0093",
    kind: "fusion",
    title: "Low-confidence pattern surge",
    severity: "low",
    confidence: 0.11,
    domains: [],
    published_at: "2026-08-28T22:40:00",
}

const ALERT_WITH_TYPE = {
    id: "alert-1",
    headline: "Port closure reported",
    location: "Strait of Hormuz",
    severity_tier: "significant",
    type: "chokepoint_alert",
    published_at: "2026-08-29T10:00:00",
    relevance_score: 6.2,
}

const ALERT_NO_TYPE = {
    id: "alert-2",
    headline: "Unclassified event",
    severity_tier: "low",
    published_at: "2026-08-29T11:00:00",
}

describe("groupNameForItem", () => {
    it("uses Multi-Domain for a fusion item with more than one domain", () => {
        expect(groupNameForItem(FUSION_MULTI)).toBe(MULTI_DOMAIN_GROUP)
    })

    it("uses the single domain for a fusion item with exactly one domain", () => {
        expect(groupNameForItem(FUSION_SINGLE)).toBe("NEWS")
    })

    it("falls back to Uncategorized for a fusion item with no domains", () => {
        expect(groupNameForItem(FUSION_NO_DOMAINS)).toBe(UNCATEGORIZED_GROUP)
    })

    it("uses the real type field for a plain alert item", () => {
        expect(groupNameForItem(ALERT_WITH_TYPE)).toBe("chokepoint_alert")
    })

    it("falls back to Uncategorized for a plain alert item with no type", () => {
        expect(groupNameForItem(ALERT_NO_TYPE)).toBe(UNCATEGORIZED_GROUP)
    })
})

describe("groupItemsByDomain", () => {
    it("groups a mixed list of fusion and alert items by real domain, preserving order within each group", () => {
        const groups = groupItemsByDomain([FUSION_MULTI, ALERT_WITH_TYPE, FUSION_SINGLE, ALERT_NO_TYPE, FUSION_NO_DOMAINS])
        expect(Object.keys(groups).sort()).toEqual(
            [MULTI_DOMAIN_GROUP, "NEWS", "chokepoint_alert", UNCATEGORIZED_GROUP].sort()
        )
        expect(groups[MULTI_DOMAIN_GROUP]).toEqual([FUSION_MULTI])
        expect(groups["NEWS"]).toEqual([FUSION_SINGLE])
        expect(groups["chokepoint_alert"]).toEqual([ALERT_WITH_TYPE])
        expect(groups[UNCATEGORIZED_GROUP]).toEqual([ALERT_NO_TYPE, FUSION_NO_DOMAINS])
    })

    it("returns an empty object for an empty/undefined item list", () => {
        expect(groupItemsByDomain([])).toEqual({})
        expect(groupItemsByDomain()).toEqual({})
    })
})

describe("sortedGroupEntries", () => {
    it("orders groups by item count descending, ties broken alphabetically", () => {
        const groups = {
            B: [1, 2],
            A: [1, 2],
            C: [1],
        }
        expect(sortedGroupEntries(groups).map(([name]) => name)).toEqual(["A", "B", "C"])
    })

    it("returns an empty array for an empty/undefined groups object", () => {
        expect(sortedGroupEntries({})).toEqual([])
        expect(sortedGroupEntries()).toEqual([])
    })
})

describe("severityColorToken", () => {
    it("maps a fusion item's critical/high severity to --danger", () => {
        expect(severityColorToken({ kind: "fusion", severity: "critical" })).toBe("var(--danger)")
        expect(severityColorToken({ kind: "fusion", severity: "high" })).toBe("var(--danger)")
    })

    it("maps a fusion item's medium severity to --warn", () => {
        expect(severityColorToken({ kind: "fusion", severity: "medium" })).toBe("var(--warn)")
    })

    it("maps a fusion item's low severity to --live", () => {
        expect(severityColorToken({ kind: "fusion", severity: "low" })).toBe("var(--live)")
    })

    it("maps a plain alert item's critical/significant/elevated/low severity_tier correctly", () => {
        expect(severityColorToken({ severity_tier: "critical" })).toBe("var(--danger)")
        expect(severityColorToken({ severity_tier: "significant" })).toBe("var(--warn)")
        expect(severityColorToken({ severity_tier: "elevated" })).toBe("var(--warn)")
        expect(severityColorToken({ severity_tier: "low" })).toBe("var(--live)")
    })

    it("falls back to --warn for unrecognized or missing severity values", () => {
        expect(severityColorToken({ severity_tier: "unknown_tier" })).toBe("var(--warn)")
        expect(severityColorToken({})).toBe("var(--warn)")
    })
})

describe("fusionSeverityToAlertTier", () => {
    it("maps each real fusion severity value to its severity_tier equivalent", () => {
        expect(fusionSeverityToAlertTier("critical")).toBe("critical")
        expect(fusionSeverityToAlertTier("high")).toBe("significant")
        expect(fusionSeverityToAlertTier("medium")).toBe("elevated")
        expect(fusionSeverityToAlertTier("low")).toBe("low")
    })

    it("falls back to elevated for unrecognized/missing values", () => {
        expect(fusionSeverityToAlertTier("bogus")).toBe("elevated")
        expect(fusionSeverityToAlertTier(undefined)).toBe("elevated")
    })
})

describe("itemPrimaryLabel", () => {
    it("uses the real title for a fusion item", () => {
        expect(itemPrimaryLabel(FUSION_MULTI)).toBe("Multi-domain corroboration near Bab-el-Mandeb")
    })

    it("uses the real type for a plain alert item", () => {
        expect(itemPrimaryLabel(ALERT_WITH_TYPE)).toBe("chokepoint_alert")
    })

    it("returns an empty string rather than a fabricated label when absent", () => {
        expect(itemPrimaryLabel(ALERT_NO_TYPE)).toBe("")
        expect(itemPrimaryLabel({ kind: "fusion" })).toBe("")
    })
})

describe("itemChips", () => {
    it("returns one chip per real domain for a fusion item", () => {
        expect(itemChips(FUSION_MULTI)).toEqual(["MARITIME", "NEWS"])
    })

    it("returns a single chip for a plain alert item's real type", () => {
        expect(itemChips(ALERT_WITH_TYPE)).toEqual(["chokepoint_alert"])
    })

    it("returns an empty array rather than a fabricated chip when no type/domains are present", () => {
        expect(itemChips(ALERT_NO_TYPE)).toEqual([])
        expect(itemChips(FUSION_NO_DOMAINS)).toEqual([])
    })
})

describe("formatItemTimestamp", () => {
    it("formats a real published_at timestamp", () => {
        const formatted = formatItemTimestamp({ published_at: "2026-08-29T14:03:00" })
        expect(formatted).not.toBe("")
        expect(typeof formatted).toBe("string")
    })

    it("falls back to timestamp when published_at is absent", () => {
        const formatted = formatItemTimestamp({ timestamp: "2026-08-29T14:03:00" })
        expect(formatted).not.toBe("")
    })

    it("returns an empty string rather than a fabricated value for missing/invalid timestamps", () => {
        expect(formatItemTimestamp({})).toBe("")
        expect(formatItemTimestamp({ published_at: "not-a-real-date" })).toBe("")
    })
})
