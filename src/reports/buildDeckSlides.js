// buildDeckSlides.js — V3 Phase 2 (§6.6): the single real function that
// turns the one shared report bundle (report/sections/xrefIndex/
// linkAnalysis — the exact same bundle Briefings.jsx and PrintLayout.jsx
// already consume via getReportBundle()) into the deck's real slide list.
//
// This is deliberately the ONLY place that computes deck content. Every
// slide's fields AND its speaker note are built from the same read of the
// bundle in the same function call — never two passes, never a cached
// note computed earlier and left to drift. "A note must never be able to
// describe a slide that changed" is true here by construction: there is
// no second code path that could compute a different answer.
//
// Reuses the real, already-established evidence-set helpers
// (buildThemes/buildRegionDistribution/allEvidenceClaims from
// DocumentRenderer.jsx) rather than re-deriving them — the same discipline
// PrintLayout.jsx already holds itself to. No slide here introduces a
// fact, figure, or judgement that isn't already a real field somewhere in
// the bundle.

import { buildThemes, buildRegionDistribution, allEvidenceClaims } from "./DocumentRenderer.jsx"

const SEV_RANK = { critical: 4, high: 3, moderate: 2, low: 1 }
const SEV_ORDER = ["critical", "high", "moderate", "low"]

function severityTally(signals) {
    const counts = { critical: 0, high: 0, moderate: 0, low: 0 }
    for (const s of signals) {
        if (s.severity && counts[s.severity] !== undefined) counts[s.severity] += 1
    }
    return counts
}

/** Real markers for slide 4 — every signal/scene in this report's own real
 * xrefIndex with a real lat/lon. Only critical-severity signals are
 * flagged `labelled: true` — a presentation slide is not an inspector
 * (§14); high/moderate/low markers still render, just unlabelled. */
function buildMapMarkers(xrefIndex) {
    const signals = (xrefIndex?.signals || [])
        .filter((s) => s.lat != null && s.lon != null)
        .map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, severity: s.severity, label: s.label, labelled: s.severity === "critical" }))
    const scenes = (xrefIndex?.scenes || [])
        .filter((s) => s.lat != null && s.lon != null)
        .map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, kind: "scene", label: s.label, labelled: false }))
    return [...signals, ...scenes]
}

export function buildDeckSlides(bundle) {
    const { report, sections, xrefIndex, linkAnalysis } = bundle || {}
    if (!report || !sections) return { meta: null, slides: [] }

    const narrative = report.narrative || {}
    const evidenceClaims = allEvidenceClaims(sections)
    const themes = buildThemes(sections).filter((t) => t.claims.length > 0)
        .sort((a, b) => b.claims.length - a.claims.length)
        .slice(0, 4)
    const regionDist = buildRegionDistribution(sections)
    const exposure = report.exposure
    const areaOverview = sections.find((s) => s.section_id === "area_overview")
    const signalById = new Map((xrefIndex?.signals || []).map((s) => [s.id, s]))
    const severityCounts = severityTally(xrefIndex?.signals || [])
    const mapMarkers = buildMapMarkers(xrefIndex)

    const period = areaOverview?.period_start
        ? `${areaOverview.period_start.slice(0, 10)} → ${(areaOverview.period_end || "").slice(0, 10) || "now"}`
        : null

    const slides = []
    let n = 0
    const push = (slide) => { n += 1; slides.push({ ...slide, number: n }) }

    // Slide 1 — Cover. Real title/scope/horizon/audience/evidence-set size/
    // issued date/prepared-by — all from `meta`-equivalent real fields.
    // scope falls back to area_overview's real focus field for reports
    // created before V3 Phase 2 added Report.scope directly.
    push({
        id: "cover", kind: "cover",
        title: report.title,
        scope: report.scope || areaOverview?.focus || null,
        horizon: report.horizon || null,
        audience: report.audience || null,
        evidenceCount: evidenceClaims.length,
        issued: report.created_at,
        preparedBy: report.created_by || null,
        classification: report.classification,
        note: `Open on ${report.title}. State the scope${report.scope || areaOverview?.focus ? ` (${report.scope || areaOverview.focus})` : ""} and the evidence-set size (${evidenceClaims.length} items) before moving to the judgement.`,
    })

    // Slide 2 — Bottom line, deliberately second (§14): executives get the
    // judgement before the evidence trail. The "one-line why" is the real
    // generated second_para, not a fabricated summary sentence.
    push({
        id: "bottomline", kind: "bottomline",
        judgement: narrative.bottom_line || null,
        why: narrative.second_para || null,
        note: narrative.bottom_line
            ? "Lead with this. Do not open with the evidence — the judgement comes first."
            : "No bottom-line judgement was generated for this report — say so plainly rather than improvising one.",
    })

    // Slide 3 — This cycle: real severity ledger + real regional bars.
    push({
        id: "cycle", kind: "cycle",
        severityCounts, regionDist,
        note: `${severityCounts.critical} critical, ${severityCounts.high} high. ${regionDist.length ? `Most active region: ${regionDist[0].region} (${regionDist[0].count}).` : "No real region data this cycle."}`,
    })

    // Slide 4 — Where: real map markers, criticals labelled only (§14).
    push({
        id: "map", kind: "map",
        markers: mapMarkers,
        note: `${mapMarkers.filter((m) => m.labelled).length} critical location${mapMarkers.filter((m) => m.labelled).length === 1 ? "" : "s"} labelled on the map. This is a locator, not an inspector — don't read out every marker.`,
    })

    // Slides 5-8 — one per real theme (top 4 by claim count).
    for (const t of themes) {
        const dependencies = (exposure?.matches || []).filter((m) => m.matched_section === t.id)
        push({
            id: `theme-${t.id}`, kind: "theme",
            title: t.title, statement: t.paragraph,
            claims: t.claims.slice(0, 3).map((c) => ({ text: c.text, severity: signalById.get(String(c.citation?.item_id))?.severity })),
            dependencies: dependencies.slice(0, 3),
            note: `${t.claims.length} real claim${t.claims.length === 1 ? "" : "s"} behind this theme.${dependencies.length ? ` ${dependencies.length} real dependency match${dependencies.length === 1 ? "" : "es"} — name the closest one (${dependencies[0].asset_name}) if asked.` : ""}`,
        })
    }

    // Slide 9 — Exposure: the real dependency matches. No signal-count/
    // severity-peak/mitigation columns — this app's real exposure model
    // (backend/asset_exposure.py) only ever produces asset/type/distance/
    // matched-signal; inventing the reference doc's richer columns would
    // be fabricating data this deployment doesn't have.
    push({
        id: "exposure", kind: "exposure",
        matches: (exposure?.matches || []).slice(0, 8),
        assetCount: exposure?.asset_count ?? null,
        note: exposure && exposure.asset_count > 0
            ? `Expect the interruption here — someone will ask about a specific asset. Have ${exposure.matches?.[0]?.asset_name || "the nearest real match"}'s distance (${exposure.matches?.[0]?.distance_km ?? "?"} km) ready.`
            : "No real asset-register exposure was scored for this report — say so rather than improvising a dependency.",
    })

    // Slide 10 — Indicators: the real warnings already generated, reused
    // verbatim, never re-derived.
    push({
        id: "indicators", kind: "indicators",
        warnings: narrative.warnings || [],
        note: (narrative.warnings || []).length
            ? `${narrative.warnings.length} real falsifiable trigger${narrative.warnings.length === 1 ? "" : "s"}. These are the lines that would change the assessment — read them as commitments, not caveats.`
            : "No warnings were generated for this cycle.",
    })

    // Slide 11 — Actions: the real recommended actions, owner + due date
    // already attached.
    push({
        id: "actions", kind: "actions",
        actions: narrative.actions || [],
        note: (narrative.actions || []).length
            ? `Do not advance past action 1 (${narrative.actions[0][0]}) until it has a real, confirmed owner in the room — "${narrative.actions[0][1]}" is who drafted it, not necessarily who commits to it here.`
            : "No recommended actions were generated for this cycle.",
    })

    // Slide 12 — Sourcing: deliberately the least visually invested (§14).
    const distinctFeeds = new Set(evidenceClaims.map((c) => c.citation?.section).filter(Boolean)).size
    const inferredLinks = (linkAnalysis?.links || []).filter((l) => l.inferred).length
    push({
        id: "sourcing", kind: "sourcing",
        claimCount: evidenceClaims.length, distinctFeeds,
        linkCount: (linkAnalysis?.links || []).length, inferredLinks,
        methodNote: evidenceClaims.length
            ? `${evidenceClaims.length} claims across ${distinctFeeds} distinct feed${distinctFeeds === 1 ? "" : "s"}, generated from this deployment's real current data.`
            : "No sourcing to report for an evidence-free briefing.",
        note: "Hold this slide back unless the room challenges the assessment — it exists to be available, not to be walked through by default.",
    })

    return {
        meta: {
            title: report.title, classification: report.classification,
            evidenceCount: evidenceClaims.length, period,
        },
        slides,
    }
}
