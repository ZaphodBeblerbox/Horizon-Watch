/**
 * riskFamilies.js — the country risk index's four source families, as every
 * view shows them (backend: risk_crossref.py).
 *
 * The index is a cross-reference: GDELT, news (RSS), Telegram and
 * GeoConfirmed are each scored on their own evidence; one agreeing family
 * alone cannot lift a country past band 3, two not past band 4. A reader must
 * be able to see which families agree, what each counted, and how much of
 * the score each carried — so every surface reads the rows from here.
 */

export const FAMILIES = [
    { key: "gdelt",        label: "GDELT",        unit: "event" },
    { key: "rss",          label: "News (RSS)",   unit: "article" },
    { key: "telegram",     label: "Telegram",     unit: "post" },
    { key: "geoconfirmed", label: "GeoConfirmed", unit: "placemark" },
]

const STATUS = {
    no_events: "no GDELT events",
    no_articles: "no articles",
    no_posts: "no joined channel speaks about it",
    no_placemarks: "no verified footage",
}

/** One row per family, in a fixed order, whatever the payload carries. */
export function familyRows(country) {
    const fams = country?.families || {}
    const contrib = country?.contributions || {}
    return FAMILIES.map((f) => {
        const d = fams[f.key] || {}
        const score = typeof d.score === "number" ? d.score : null
        return {
            key: f.key,
            label: d.label || f.label,
            score,
            count: d.count || 0,
            unit: f.unit,
            windowDays: d.window_days ?? null,
            corroborates: !!d.corroborates,
            contribution: typeof contrib[f.key] === "number" ? contrib[f.key] : null,
            summary: score == null ? (STATUS[d.status] || d.summary || "not observed") : (d.summary || ""),
        }
    })
}

/** True when the payload is the cross-referenced index (has families). */
export function isCrossRef(country) {
    return !!country && typeof country.families === "object" && country.families !== null
}

/** "3 of 4 sources agree" — the confidence, in words. */
export function agreementText(country) {
    const n = (country?.corroborating || []).length
    const seen = familyRows(country).filter((r) => r.score != null).length
    if (!seen) return "no source observed it"
    return `${n} of 4 source${n === 1 ? "" : "s"} agree${n === 1 ? "s" : ""} · ${seen} observe${seen === 1 ? "s" : ""} it`
}

/** Total observations across families (events + articles + posts + placemarks). */
export function totalEvidence(country) {
    return familyRows(country).reduce((s, r) => s + (r.count || 0), 0)
}
