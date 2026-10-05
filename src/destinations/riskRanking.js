/**
 * riskRanking.js — countries ranked by the risk index, each with its reason.
 *
 * Insight's "Risk ranking" counted signals in nine fixed regions, and our
 * feeds are dominated by European AIS, so the Baltic led every time (5,890
 * signals against 1,117 for the next) — attention, not danger, as the page
 * admitted in small print. The risk index (/api/risk-index/countries, the
 * same one the map's choropleth draws) scores 124 countries from wire-report
 * tone, the share of conflictual events and confirmed incidents. That is
 * what a risk ranking is.
 *
 * Every row says WHY in words, from the score's own components, and how
 * much observation it rests on — a band-4 country scored from three wire
 * stories is a prompt to look, not a finding.
 */

const COMPONENT = {
    tone: (c) => c?.mean_tone != null ? `coverage tone ${Number(c.mean_tone).toFixed(1)}` : "hostile coverage",
    gold: (c) => c?.share_below_threshold != null ? `${Math.round(c.share_below_threshold * 100)}% of events conflictual` : "conflictual events",
    conf: (c) => c?.count != null ? `${c.count} confirmed incident${c.count === 1 ? "" : "s"}` : "confirmed incidents",
    vol:  () => "event volume above its baseline",
}

/** The plain-language reason for one country's score. */
export function why(country) {
    const contrib = country?.contributions || {}
    const comps = country?.components || {}
    const top = Object.entries(contrib)
        .filter(([, v]) => typeof v === "number" && v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([k]) => (COMPONENT[k] ? COMPONENT[k](comps[k]) : k))
    return top.join(" · ") || "no contributing component"
}

/** Events the score rests on — the largest count any component reports. */
export function evidence(country) {
    const counts = Object.values(country?.components || {})
        .map((c) => c && (c.n_events ?? c.recent_count ?? c.count))
        .filter((n) => typeof n === "number")
    return counts.length ? counts.reduce((m, c) => (c > m ? c : m), 0) : null
}

/**
 * @param countries  /api/risk-index/countries .countries
 * @param names      Map iso3 -> country name
 * @param signals    surface items (location_country) — attention beside risk
 */
export function rankCountries(countries = [], names = new Map(), signals = []) {
    const onSurface = new Map()
    for (const s of signals || []) {
        const c = s?.location_country
        if (c) onSurface.set(c, (onSurface.get(c) || 0) + 1)
    }
    return (countries || [])
        .filter((c) => c && Number.isFinite(c.score) && c.iso_code)
        .map((c) => {
            const name = names.get(String(c.iso_code).toUpperCase()) || c.iso_code
            const n = evidence(c)
            return {
                iso3: c.iso_code, name, score: c.score, band: c.band,
                why: why(c), evidence: n, thin: n != null && n < 10,
                signals: onSurface.get(name) || 0,
                raw: c,
            }
        })
        // EVIDENCE FIRST, THEN SCORE. Ranked by score alone, Gabon led on one
        // event and Burkina Faso was third on two. A score resting on fewer
        // than 10 events is listed after every well-evidenced one, still
        // shown and still flagged — a prompt to look, not a ranking.
        .sort((a, b) => (a.thin - b.thin) || b.score - a.score || a.name.localeCompare(b.name))
}
