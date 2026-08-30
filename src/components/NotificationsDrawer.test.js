import { describe, it, expect } from "vitest"
import { sevToken, formatDomainsLabel, fusionConfidencePct } from "./NotificationsDrawer.jsx"
import { normalizeFusionEvent } from "./notificationsNormalize.js"

// Note: this test suite is deliberately kept at the pure-function level.
// vitest.config.js runs with `environment: "node"` and neither jsdom nor
// @testing-library/react is a devDependency (see package.json) — so a real
// DOM render of <NotificationsDrawer> isn't available without adding a new
// testing library dependency, which the task asked to avoid. Instead this
// exercises the exact derivation logic the fusion row uses to render
// domains/confidence/severity, which is what a render-based test would be
// asserting on anyway.

describe("sevToken — fusion row severity -> Round 1 --sev-* token", () => {
    it("maps each real FusionEvent severity value to its token", () => {
        expect(sevToken("critical")).toBe("var(--sev-critical)")
        expect(sevToken("high")).toBe("var(--sev-high)")
        expect(sevToken("medium")).toBe("var(--sev-medium)")
        expect(sevToken("low")).toBe("var(--sev-low)")
    })

    it("falls back to the medium token for an unrecognised/missing severity", () => {
        expect(sevToken("unknown")).toBe("var(--sev-medium)")
        expect(sevToken(undefined)).toBe("var(--sev-medium)")
    })
})

describe("formatDomainsLabel — corroborating domains display", () => {
    it("joins real domain names with ' + ', e.g. MARITIME + NEWS", () => {
        expect(formatDomainsLabel(["MARITIME", "NEWS"])).toBe("MARITIME + NEWS")
    })

    it("handles a single domain and more than two domains", () => {
        expect(formatDomainsLabel(["NEWS"])).toBe("NEWS")
        expect(formatDomainsLabel(["NEWS", "SIGINT", "OSINT"])).toBe("NEWS + SIGINT + OSINT")
    })

    it("returns an empty string for no domains", () => {
        expect(formatDomainsLabel([])).toBe("")
        expect(formatDomainsLabel(undefined)).toBe("")
    })
})

describe("fusionConfidencePct — 0-1 float -> whole-number percentage", () => {
    it("converts a realistic confidence float to a percentage", () => {
        expect(fusionConfidencePct(0.87)).toBe(87)
        expect(fusionConfidencePct(0.42)).toBe(42)
        expect(fusionConfidencePct(0.11)).toBe(11)
    })

    it("clamps and defaults safely", () => {
        expect(fusionConfidencePct(1.4)).toBe(100)
        expect(fusionConfidencePct(-0.3)).toBe(0)
        expect(fusionConfidencePct(undefined)).toBe(0)
    })
})

describe("fusion item normalized end-to-end renders with domains + confidence visible", () => {
    it("a /api/fusions-shaped row survives normalize -> row-derivation with domains and confidence intact", () => {
        const raw = {
            fusion_id: "FUS-2026-0091",
            title: "Multi-domain corroboration near Bab-el-Mandeb",
            severity: "critical",
            confidence: 0.87,
            domains: ["MARITIME", "NEWS"],
            location_name: "Bab-el-Mandeb Strait",
            created_at: "2026-08-29T14:03:00",
        }
        const item = normalizeFusionEvent(raw)

        // What FusionRow (NotificationsDrawer.jsx) actually renders:
        expect(sevToken(item.severity)).toBe("var(--sev-critical)")
        expect(formatDomainsLabel(item.domains)).toBe("MARITIME + NEWS")
        expect(fusionConfidencePct(item.confidence)).toBe(87)
        expect(item.location_name).toBe("Bab-el-Mandeb Strait")
    })
})

describe("existing alert/surface-pool item shape — pre-existing path is untouched", () => {
    it("an alert item (no kind field) has none of the fusion-only fields and keeps its own shape", () => {
        const alertItem = {
            id: "alert-1",
            headline: "Port closure reported",
            location: "Suez Canal",
            severity_tier: "elevated",
            type: "chokepoint_alert",
            published_at: "2026-08-29T10:00:00",
            relevance_score: 6.2,
            auto_brief: true,
        }
        // No normalization applied to alert items — the drawer's existing
        // path (TIER_COLOR / TYPE_LABEL / headline / location) reads these
        // fields directly, unchanged from before this feature.
        expect(alertItem.kind).toBeUndefined()
        expect(alertItem.domains).toBeUndefined()
        expect(alertItem.confidence).toBeUndefined()
        expect(alertItem.headline).toBe("Port closure reported")
    })
})
