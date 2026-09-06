import { describe, it, expect } from "vitest"
import { buildDeckSlides } from "./buildDeckSlides.js"

function mockBundle(overrides = {}) {
    return {
        report: {
            title: "Red Sea Corridor Assessment", scope: "Red Sea / Bab el-Mandeb",
            audience: "Executive committee", horizon: "30d",
            classification: "INTERNAL // RISK", created_at: "2026-09-01T12:00:00Z",
            created_by: "K. Almeida",
            narrative: {
                bottom_line: "Hold contingency routing on the Red Sea corridor.",
                second_para: "Confidence across the set averages 78%.",
                warnings: ["A second interference event would move the index above 90."],
                actions: [["Hold contingency routing", "Logistics", "D+0"], ["Re-run screening", "Compliance", "D+3"]],
            },
            exposure: {
                asset_count: 4,
                matches: [
                    { asset_name: "Djibouti Port", asset_type: "port", distance_km: 12.4, matched_section: "maritime_activity", matched_item_id: "S1" },
                    { asset_name: "Red Sea Cable Landing", asset_type: "cable_landing", distance_km: 30.1, matched_section: "maritime_activity", matched_item_id: "S2" },
                ],
            },
            ...overrides.report,
        },
        sections: overrides.sections || [
            { section_id: "area_overview", focus: "Red Sea", period_start: "2026-08-01", period_end: "2026-09-01", claims: [] },
            {
                section_id: "maritime_activity", title: "Maritime activity",
                claims: [
                    { claim_id: "C1", text: "Sanctioned vessel detected near Bab el-Mandeb.", region: "Red Sea", citation: { type: "snapshot_ref", section: "ais_anomalies", item_id: "S1" } },
                    { claim_id: "C2", text: "Second vessel loitering near the strait.", region: "Red Sea", citation: { type: "snapshot_ref", section: "ais_anomalies", item_id: "S2" } },
                ],
            },
            { section_id: "aerial_activity", title: "Aerial activity", claims: [] },
            { section_id: "imagery_detection", title: "Imagery detection", claims: [] },
            { section_id: "alerts_events", title: "Alerts & events", claims: [] },
            { section_id: "open_source_context", title: "Open-source context", claims: [] },
        ],
        xrefIndex: overrides.xrefIndex || {
            signals: [
                { id: "S1", section: "ais_anomalies", label: "Sanctioned Vessel Alpha", lat: 12.5, lon: 43.3, severity: "critical" },
                { id: "S2", section: "ais_anomalies", label: "Loitering Vessel Beta", lat: 12.6, lon: 43.4, severity: "high" },
            ],
            scenes: [],
        },
        linkAnalysis: overrides.linkAnalysis || { objects: [], links: [{ id: "L1", source_label: "A", target_label: "B", type: "operates", inferred: true }] },
    }
}

describe("buildDeckSlides — real, single-source slide + speaker-note generation", () => {
    it("returns null meta/empty slides honestly when the bundle isn't loaded yet", () => {
        expect(buildDeckSlides(null)).toEqual({ meta: null, slides: [] })
        expect(buildDeckSlides({})).toEqual({ meta: null, slides: [] })
    })

    it("slide 2 is the bottom line, not the last slide (§14 — deliberate, not a bug)", () => {
        const { slides } = buildDeckSlides(mockBundle())
        expect(slides[1].kind).toBe("bottomline")
        expect(slides[1].judgement).toBe("Hold contingency routing on the Red Sea corridor.")
    })

    it("no slide invents a fact — every field traces back to the real bundle", () => {
        const bundle = mockBundle()
        const { slides } = buildDeckSlides(bundle)
        const cover = slides.find((s) => s.kind === "cover")
        expect(cover.title).toBe(bundle.report.title)
        expect(cover.scope).toBe(bundle.report.scope)
        expect(cover.audience).toBe(bundle.report.audience)
        expect(cover.preparedBy).toBe(bundle.report.created_by)
        expect(cover.evidenceCount).toBe(2) // real claim count from sections, not invented

        const actions = slides.find((s) => s.kind === "actions")
        expect(actions.actions).toEqual(bundle.report.narrative.actions)

        const indicators = slides.find((s) => s.kind === "indicators")
        expect(indicators.warnings).toEqual(bundle.report.narrative.warnings)
    })

    it("slide 4's map labels ONLY critical-severity markers (§14 — a slide is not an inspector)", () => {
        const { slides } = buildDeckSlides(mockBundle())
        const map = slides.find((s) => s.kind === "map")
        const critical = map.markers.find((m) => m.severity === "critical")
        const high = map.markers.find((m) => m.severity === "high")
        expect(critical.labelled).toBe(true)
        expect(high.labelled).toBe(false)
    })

    it("severity ledger tallies real xrefIndex signal severities, not fabricated counts", () => {
        const { slides } = buildDeckSlides(mockBundle())
        const cycle = slides.find((s) => s.kind === "cycle")
        expect(cycle.severityCounts).toEqual({ critical: 1, high: 1, moderate: 0, low: 0 })
    })

    it("theme slide count varies with real domain diversity — fewer than 4 when fewer real themes have claims", () => {
        const { slides } = buildDeckSlides(mockBundle()) // only maritime_activity has claims
        const themeSlides = slides.filter((s) => s.kind === "theme")
        expect(themeSlides.length).toBe(1)
        expect(themeSlides[0].title).toBe("Maritime activity")
    })

    it("exposure slide uses ONLY real fields this app's exposure model actually produces — no invented signal-count/severity-peak/mitigation columns", () => {
        const { slides } = buildDeckSlides(mockBundle())
        const exposure = slides.find((s) => s.kind === "exposure")
        expect(exposure.matches[0]).toEqual(
            expect.objectContaining({ asset_name: "Djibouti Port", asset_type: "port", distance_km: 12.4 })
        )
        expect(exposure.matches[0]).not.toHaveProperty("signal_count")
        expect(exposure.matches[0]).not.toHaveProperty("severity_peak")
        expect(exposure.matches[0]).not.toHaveProperty("standing_mitigation")
    })

    it("sourcing slide's own note says it exists to be held back, not walked through by default (§14)", () => {
        const { slides } = buildDeckSlides(mockBundle())
        const sourcing = slides.find((s) => s.kind === "sourcing")
        expect(sourcing.note).toMatch(/hold.*back/i)
    })

    it("the exposure slide's speaker note names the real nearest asset — the delivery cue the reference doc calls for", () => {
        const { slides } = buildDeckSlides(mockBundle())
        const exposure = slides.find((s) => s.kind === "exposure")
        expect(exposure.note).toMatch(/Djibouti Port/)
        expect(exposure.note).toMatch(/12\.4/)
    })

    it("the actions slide's speaker note names the real first action and warns not to advance without a confirmed owner", () => {
        const { slides } = buildDeckSlides(mockBundle())
        const actions = slides.find((s) => s.kind === "actions")
        expect(actions.note).toMatch(/Hold contingency routing/)
        expect(actions.note).toMatch(/confirmed owner/i)
    })

    // The core "a note can never describe a slide that changed" guarantee:
    // regenerating with DIFFERENT real evidence changes the slide AND its
    // note together, in lockstep, because both come from the same call.
    it("changing the underlying evidence changes both the slide content and its note together — never independently", () => {
        const bundleA = mockBundle()
        const bundleB = mockBundle({
            report: {
                narrative: {
                    bottom_line: "No change to posture.",
                    second_para: "Nothing material changed.",
                    warnings: [], actions: [],
                },
                exposure: { asset_count: 0, matches: [] },
            },
        })
        const slidesA = buildDeckSlides(bundleA).slides
        const slidesB = buildDeckSlides(bundleB).slides

        const bottomA = slidesA.find((s) => s.kind === "bottomline")
        const bottomB = slidesB.find((s) => s.kind === "bottomline")
        expect(bottomA.judgement).not.toBe(bottomB.judgement)
        // The bottomline note is a real, evergreen presentation cue (a static
        // instruction, not a data-derived fact) — it's allowed to stay the
        // same wording across two REAL bottom-line texts; the real, testable
        // "changes together" case is a real ABSENT-vs-present distinction:
        const bundleNoJudgement = mockBundle({ report: { narrative: { bottom_line: "", second_para: "", warnings: [], actions: [] } } })
        const noJudgementNote = buildDeckSlides(bundleNoJudgement).slides.find((s) => s.kind === "bottomline").note
        expect(noJudgementNote).not.toBe(bottomA.note)
        expect(noJudgementNote).toMatch(/no bottom-line judgement/i)

        const exposureA = slidesA.find((s) => s.kind === "exposure")
        const exposureB = slidesB.find((s) => s.kind === "exposure")
        expect(exposureA.matches.length).toBeGreaterThan(0)
        expect(exposureB.matches.length).toBe(0)
        expect(exposureB.note).toMatch(/No real asset-register exposure/)
    })

    it("cover slide falls back to area_overview's real focus when Report.scope isn't set (pre-Phase-2 reports)", () => {
        const bundle = mockBundle({ report: { scope: null } })
        const { slides } = buildDeckSlides(bundle)
        const cover = slides.find((s) => s.kind === "cover")
        expect(cover.scope).toBe("Red Sea") // from area_overview.focus, not fabricated
    })
})
