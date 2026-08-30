import { describe, it, expect } from "vitest"
import { normalizeFusionEvent, normalizeFusionEvents, mergeNotificationItems } from "./notificationsNormalize.js"

// Realistic-shaped fake /api/fusions response — real field names from
// backend/main.py's api_fusions_list (fusion_id, title, subtitle, severity,
// confidence 0-1 float, domain_count, domains, location_name, etc), with
// different domain counts/confidences/severities across the three rows.
const FAKE_FUSIONS_RESPONSE = [
    {
        fusion_id: "FUS-2026-0091",
        title: "Multi-domain corroboration near Bab-el-Mandeb",
        subtitle: "Maritime AIS anomaly corroborated by open-source reporting",
        narrative: "Vessel diversions cross-referenced against three independent news sources.",
        severity: "critical",
        confidence: 0.87,
        domain_count: 2,
        domains: ["MARITIME", "NEWS"],
        fusion_type: "MULTI_DOMAIN",
        location_name: "Bab-el-Mandeb Strait",
        location_country: "Yemen",
        region_id: "red-sea",
        lat: 12.6,
        lon: 43.4,
        signal_count: 7,
        key_signals: ["3 AIS anomalies", "2 wire reports"],
        recommended_actions: ["Monitor chokepoint traffic"],
        threat_indicators: ["vessel diversion"],
        status: "active",
        created_at: "2026-08-29T14:03:00",
        updated_at: "2026-08-29T14:10:00",
        expires_at: "2026-08-31T14:03:00",
    },
    {
        fusion_id: "FUS-2026-0092",
        title: "Escalation chain — border skirmish reporting",
        subtitle: "News + SIGINT pattern surge",
        narrative: "",
        severity: "medium",
        confidence: 0.42,
        domain_count: 3,
        domains: ["NEWS", "SIGINT", "OSINT"],
        fusion_type: "ESCALATION_CHAIN",
        location_name: "Line of Control",
        location_country: "India",
        region_id: null,
        lat: 34.1,
        lon: 74.3,
        signal_count: 12,
        key_signals: [],
        recommended_actions: [],
        threat_indicators: [],
        status: "active",
        created_at: "2026-08-29T09:15:00",
        updated_at: "2026-08-29T09:15:00",
        expires_at: "2026-08-30T09:15:00",
    },
    {
        fusion_id: "FUS-2026-0093",
        title: "Low-confidence pattern surge",
        subtitle: null,
        severity: "low",
        confidence: 0.11,
        domain_count: 1,
        domains: ["NEWS"],
        location_name: null,
        location_country: null,
        signal_count: 2,
        status: "active",
        created_at: "2026-08-28T22:40:00",
    },
]

describe("normalizeFusionEvent", () => {
    it("preserves the real domains array and carries confidence as a number", () => {
        const item = normalizeFusionEvent(FAKE_FUSIONS_RESPONSE[0])
        expect(item.domains).toEqual(["MARITIME", "NEWS"])
        expect(item.confidence).toBe(0.87)
        expect(typeof item.confidence).toBe("number")
    })

    it("carries the real fusion_id through as the merged item's id, and tags kind: fusion", () => {
        const item = normalizeFusionEvent(FAKE_FUSIONS_RESPONSE[0])
        expect(item.id).toBe("FUS-2026-0091")
        expect(item.kind).toBe("fusion")
    })

    it("maps severity straight through — it already matches the --sev-* token names", () => {
        expect(normalizeFusionEvent(FAKE_FUSIONS_RESPONSE[0]).severity).toBe("critical")
        expect(normalizeFusionEvent(FAKE_FUSIONS_RESPONSE[1]).severity).toBe("medium")
        expect(normalizeFusionEvent(FAKE_FUSIONS_RESPONSE[2]).severity).toBe("low")
    })

    it("aliases created_at into published_at/timestamp so it sorts alongside alert items", () => {
        const item = normalizeFusionEvent(FAKE_FUSIONS_RESPONSE[0])
        expect(item.published_at).toBe("2026-08-29T14:03:00")
        expect(item.timestamp).toBe("2026-08-29T14:03:00")
    })

    it("derives a 0-10 relevance_score from the 0-1 confidence float for relevance-mode sort parity", () => {
        const item = normalizeFusionEvent(FAKE_FUSIONS_RESPONSE[0])
        expect(item.relevance_score).toBeCloseTo(8.7)
    })

    it("defaults missing/null fields safely (no location, no subtitle, no signals)", () => {
        const item = normalizeFusionEvent(FAKE_FUSIONS_RESPONSE[2])
        expect(item.location_name).toBe("")
        expect(item.subtitle).toBe("")
        expect(item.key_signals).toEqual([])
        expect(item.domain_count).toBe(1)
    })

    it("clamps out-of-range or non-numeric confidence into 0-1", () => {
        expect(normalizeFusionEvent({ fusion_id: "x", confidence: 1.5 }).confidence).toBe(1)
        expect(normalizeFusionEvent({ fusion_id: "x", confidence: -0.2 }).confidence).toBe(0)
        expect(normalizeFusionEvent({ fusion_id: "x", confidence: "not-a-number" }).confidence).toBe(0)
    })
})

describe("normalizeFusionEvents", () => {
    it("maps every entry in a raw /api/fusions array, preserving order and per-item shape", () => {
        const items = normalizeFusionEvents(FAKE_FUSIONS_RESPONSE)
        expect(items).toHaveLength(3)
        expect(items.map(i => i.id)).toEqual(["FUS-2026-0091", "FUS-2026-0092", "FUS-2026-0093"])
        expect(items.every(i => i.kind === "fusion")).toBe(true)
    })

    it("returns an empty array for non-array/undefined input rather than throwing", () => {
        expect(normalizeFusionEvents(undefined)).toEqual([])
        expect(normalizeFusionEvents(null)).toEqual([])
        expect(normalizeFusionEvents("not-an-array")).toEqual([])
    })
})

describe("mergeNotificationItems", () => {
    it("concatenates existing alert items with normalized fusion items, leaving the alert shape untouched", () => {
        const alertItems = [
            { id: "alert-1", headline: "Port closure reported", severity_tier: "elevated", published_at: "2026-08-29T10:00:00", relevance_score: 6.2, type: "chokepoint_alert" },
        ]
        const merged = mergeNotificationItems(alertItems, FAKE_FUSIONS_RESPONSE)
        expect(merged).toHaveLength(4)
        // Original alert item is passed through unchanged (no kind stamped onto it).
        expect(merged[0]).toEqual(alertItems[0])
        expect(merged.slice(1).every(i => i.kind === "fusion")).toBe(true)
    })

    it("defaults both inputs to empty arrays", () => {
        expect(mergeNotificationItems()).toEqual([])
    })
})
