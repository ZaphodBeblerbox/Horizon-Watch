/**
 * homeLead.js — the sentences at the top of Home, built from the surface.
 *
 * "50 signals on the surface, 7 of them critical" was true and said
 * nothing: no place, no event, nothing anyone could act on or check. Every
 * surface signal now carries its country (location_extract.py), so the
 * lead names the signal that leads the list and where it is, and says
 * where the rest are concentrated.
 *
 * WHICH SIGNAL LEADS is stated, not implied: critical first, then newest —
 * the same order as the Overnight column. relevance_score is not used; it
 * is a lookup on severity_tier and would only restate it.
 *
 * The theater lines replace three hardcoded sentences, one of which said
 * Hormuz transit volume was "below the 7-day baseline" — a measurement no
 * part of this system can make (chokepoint_flow.py: no AIS coverage
 * there). Each line is now counted from signals in the theater's own
 * countries (theaterScope.js), and a quiet theater says so by name.
 */

const RANK = { critical: 0, high: 1, significant: 2, moderate: 3, low: 4 }
const MAX_HEADLINE = 140

const headlineOf = (s) => {
    const h = String(s?.title || s?.headline || "").trim()
    return h.length > MAX_HEADLINE ? `${h.slice(0, MAX_HEADLINE - 1).trimEnd()}…` : h
}

/** "Riyom, Nigeria (general), Nigeria" -> "Riyom, Nigeria". */
export function placeOf(s) {
    const country = String(s?.location_country || "").trim()
    const first = String(s?.location || "").split(",")[0].replace(/\(general\)/i, "").trim()
    if (first && country && first.toLowerCase() !== country.toLowerCase()) return `${first}, ${country}`
    return country || first || null
}

/** Critical first, then newest. */
export function leading(surface) {
    return [...(surface || [])]
        .filter((s) => headlineOf(s))
        .sort((a, b) => (RANK[a.severity_tier] ?? 9) - (RANK[b.severity_tier] ?? 9)
            || String(b.published_at || "").localeCompare(String(a.published_at || "")))
}

function topCountries(surface, n) {
    const by = {}
    for (const s of surface) {
        const c = s.location_country
        if (c) by[c] = (by[c] || 0) + 1
    }
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    return { count: rows.length, top: rows.slice(0, n) }
}

const listOf = (parts) => parts.length <= 1 ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`

export function leadSentence(surface) {
    surface = surface || []
    if (!surface.length) return "Nothing has come in yet on this watch."
    const critical = surface.filter((s) => s.severity_tier === "critical").length
    if (surface.length > 3 && critical === surface.length) {
        return `${surface.length} signals on the surface — all of them tagged critical, `
            + `which is a tagging fault rather than ${surface.length} emergencies. `
            + "Severity is not yet discriminating, so read the list, not the colour."
    }
    const top = leading(surface)[0]
    const { count, top: where } = topCountries(surface, 3)
    const parts = []
    if (top) {
        const place = placeOf(top)
        const kind = top.severity_tier === "critical" ? "Newest critical" : "Latest"
        parts.push(`${kind}: ${headlineOf(top)}${place ? ` — ${place}` : ""}.`)
    }
    const spread = count
        ? ` across ${count} ${count === 1 ? "country" : "countries"}`
            + (where.length ? `, most in ${listOf(where.map(([c, n]) => `${c} (${n})`))}` : "")
        : ""
    parts.push(`${surface.length} signals${spread}; ${critical} critical.`)
    return parts.join(" ")
}

/** One line per theater, from the signals in its countries. */
export function theaterLines(surface, scopes) {
    surface = surface || []
    return Object.entries(scopes || {}).map(([key, scope]) => {
        const names = new Set((scope.countries || []).map((c) => c.toLowerCase()))
        const inside = surface.filter((s) => names.has(String(s.location_country || "").toLowerCase()))
        if (!inside.length) {
            return {
                key, name: scope.label, level: "quiet", n: 0,
                line: `No signals on the surface from ${listOf(scope.countries.slice(0, 3))} or the rest of this theater.`,
            }
        }
        const critical = inside.filter((s) => s.severity_tier === "critical").length
        const top = leading(inside)[0]
        const place = top ? placeOf(top) : null
        return {
            key, name: scope.label, level: critical ? "critical" : "active", n: inside.length,
            line: `${inside.length} signal${inside.length === 1 ? "" : "s"}${critical ? `, ${critical} critical` : ""}. `
                + (top ? `${headlineOf(top)}${place ? ` — ${place}` : ""}.` : ""),
        }
    })
}
