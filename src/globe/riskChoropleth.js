/**
 * riskChoropleth.js — country risk as a filled overlay.
 *
 * The risk index has been computed and panelled for a while, but it never
 * drew anything on the globe: the layer toggled a legend and nothing else.
 *
 * DENSITY CARRIES SEVERITY, and low risk carries none. A country at 0.18 on
 * a 0-100 scale is not "slightly red", it is quiet, and painting it at all
 * says the opposite. Only countries above the floor get any fill, and the
 * fill deepens with the score.
 */

/** Band 1-5 from the backend, and what each one means. */
export const BANDS = [
    { band: 1, label: "Low", alpha: 0.00 },
    { band: 2, label: "Moderate", alpha: 0.16 },
    { band: 3, label: "Elevated", alpha: 0.30 },
    { band: 4, label: "High", alpha: 0.46 },
    { band: 5, label: "Critical", alpha: 0.62 },
]

/**
 * Below this score a country is not tinted at all.
 *
 * On the live index 13 of 16 scored countries sit under 25 — mostly under 5.
 * A ramp anchored at zero would wash the whole map in a colour that means
 * "we found one article", which is worse than drawing nothing: it invents a
 * global risk picture out of sampling noise.
 */
export const FLOOR = 8

/** Alpha rises with score above the floor, and only there. */
export function riskAlpha(score, band) {
    const s = Number(score)
    if (!Number.isFinite(s) || s < FLOOR) return 0
    // Normalised across the band the score actually sits in, so a 100 reads
    // clearly hotter than a 78 rather than both pinning at the top.
    const t = Math.min(1, (s - FLOOR) / (100 - FLOOR))
    const floorAlpha = (BANDS.find((b) => b.band === band) || BANDS[0]).alpha
    return Math.max(floorAlpha, 0.14 + t * 0.52)
}

/**
 * ISO RECONCILIATION.
 *
 * The risk endpoint emits a MIX of coding schemes: 'DE' and 'IL' are ISO
 * 3166-1 alpha-2, 'PHL' is alpha-3, and 'RP' is the FIPS 10-4 code for the
 * Philippines. So the Philippines arrives twice, under PHL and RP, with an
 * identical score — and a naive join would either miss rows entirely or
 * paint one country from two.
 *
 * Everything is resolved to alpha-3 and de-duplicated. The alternative —
 * matching on whatever string arrives — silently drops any country whose
 * scheme does not match the geometry's.
 */
const FIPS_TO_A3 = {
    RP: "PHL", UP: "UKR", RS: "RUS", GM: "DEU", IS: "ISR", IZ: "IRQ",
    LE: "LBN", YM: "YEM", SY: "SYR", MX: "MEX", CG: "COD", KU: "KWT",
    LH: "LTU", BM: "MMR", IR: "IRN",
}

export function buildA2ToA3(features) {
    const map = new Map()
    for (const f of features || []) {
        const { a2, a3 } = f.properties || {}
        if (a2 && a3) map.set(String(a2).toUpperCase(), String(a3).toUpperCase())
    }
    return map
}

export function resolveIso3(code, a2ToA3) {
    const c = String(code || "").trim().toUpperCase()
    if (!c) return null
    if (c.length === 3) return c
    if (c.length === 2) {
        // ISO alpha-2 first — a real country code beats a FIPS coincidence.
        const iso = a2ToA3?.get(c)
        if (iso) return iso
        return FIPS_TO_A3[c] || null
    }
    return null
}

/**
 * One row per country, keyed by alpha-3, highest score winning a duplicate.
 * Returns the map plus what could not be resolved, because a code we cannot
 * place is a fact about the data, not something to swallow.
 */
export function indexByIso3(countries, a2ToA3) {
    const byIso = new Map()
    const unresolved = []
    for (const row of countries || []) {
        const iso3 = resolveIso3(row.iso_code, a2ToA3)
        if (!iso3) { unresolved.push(row.iso_code); continue }
        const prev = byIso.get(iso3)
        if (!prev || Number(row.score) > Number(prev.score)) byIso.set(iso3, row)
    }
    return { byIso, unresolved }
}
