/**
 * imageryModel.js — what the Imagery page says, derived from the scans.
 *
 * A "scan" is a check; a "pass" is an acquisition — one moment the satellite
 * actually photographed the area. Before the scanner learnt to skip passes
 * it already held, one acquisition was stored once per check (fourteen
 * copies of 4 Oct), so the page groups scans by acquisition and shows each
 * pass once, saying how many times it was checked and what triggered it.
 */

/** Detection outline colours, everywhere imagery is drawn: bright enough to
 *  read over water, desert and city at a glance, each drawn over a dark halo. */
export const DET_COLORS = { new: "#FFB300", removed: "#FF3B30", existing: "#00E5FF", expanded: "#FFB300" }

const SINGULAR = {
    storage_tank: ["storage tank", "storage tanks"], vessel: ["vessel", "vessels"],
    port_infrastructure: ["port structure", "port structures"], aircraft: ["aircraft", "aircraft"],
    vehicle: ["vehicle", "vehicles"], bridge: ["bridge", "bridges"], airfield: ["airfield", "airfields"],
    helicopter: ["helicopter", "helicopters"], large_vehicle: ["large vehicle", "large vehicles"],
}
export function noun(label, n) {
    const [one, many] = SINGULAR[label] || [String(label || "object").replace(/_/g, " "), `${String(label || "object").replace(/_/g, " ")}s`]
    return n === 1 ? one : many
}

const day = (iso) => (iso ? String(iso).slice(0, 10) : null)

/** Scans -> passes, newest first. Failed checks are not passes. */
export function acquisitions(scans) {
    const groups = new Map()
    for (const s of scans || []) {
        if (s?.status !== "completed" || !s.image_timestamp_utc) continue
        // One pass a day per sensor: a change-detection run stores the same
        // acquisition at day precision under its own id.
        const key = `${s.instrument || "OPTICAL"}:${day(s.image_timestamp_utc)}`
        const g = groups.get(key)
        if (!g) {
            groups.set(key, { key, scan: s, scans: [s], triggers: new Set([s.triggered_by]) })
            continue
        }
        g.scans.push(s)
        g.triggers.add(s.triggered_by)
        // Represent the pass by the newest check that still holds the image.
        const better = (s.has_image && !g.scan.has_image)
            || (Boolean(s.has_image) === Boolean(g.scan.has_image) && String(s.created_at) > String(g.scan.created_at))
        if (better || (!g.scan.result_summary?.by_type && s.result_summary?.by_type)) g.scan = s
    }
    return [...groups.values()]
        .map((g) => ({
            key: g.key, scanId: g.scan.scan_id, when: g.scan.image_timestamp_utc,
            instrument: g.scan.instrument || "OPTICAL", cloud: g.scan.cloud_cover_percent,
            byType: g.scan.result_summary?.by_type || {},
            // Counted at all? Older runs stored no summary — unknown, not zero.
            counted: Boolean(g.scans.find((x) => x.result_summary?.by_type)),
            hasImage: Boolean(g.scans.some((x) => x.has_image)),
            checks: g.scans.length, fire: g.triggers.has("firms_fire"),
            triggers: [...g.triggers].filter(Boolean),
        }))
        .sort((a, b) => String(b.when).localeCompare(String(a.when)))
}

/** Per class, the count at each pass, oldest first — for the small charts. */
export function countSeries(passes) {
    const chron = [...(passes || [])].reverse()
    const labels = new Set(chron.flatMap((p) => Object.keys(p.byType || {})))
    return [...labels].map((label) => ({
        label, points: chron.filter((p) => p.counted).map((p) => ({ when: p.when, n: p.byType?.[label] || 0, key: p.key })),
    })).sort((a, b) => Math.max(...b.points.map((x) => x.n)) - Math.max(...a.points.map((x) => x.n)))
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export const fmtDay = (iso) => {
    const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00Z` : /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`)
    return Number.isNaN(d.getTime()) ? String(iso) : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/**
 * The headline: what changed against the previous pass, in words.
 * counts: [[label, now, delta], ...] from the scene payload.
 */
export function changeHeadline(counts, referenceDate) {
    const rows = (counts || []).filter((r) => Array.isArray(r) && r.length >= 3)
    if (!referenceDate) {
        if (!rows.length) return "First pass over this area — nothing detected yet."
        return `First pass over this area: ${rows.filter((r) => r[1] > 0).map(([l, n]) => `${n} ${noun(l, n)}`).join(", ")}.`
    }
    const since = `Since ${fmtDay(referenceDate)}`
    const moved = rows.filter((r) => r[2] !== 0)
    const still = rows.filter((r) => r[2] === 0 && r[1] > 0)
    if (!moved.length) {
        return still.length ? `${since}: no change — ${still.map(([l, n]) => `${n} ${noun(l, n)}`).join(", ")}, as before.`
                            : `${since}: no change, nothing detected.`
    }
    const parts = moved.map(([l, n, d]) => {
        const a = Math.abs(d)
        return d > 0 ? `${a} more ${noun(l, a)} (${n} now)` : `${a} ${noun(l, a)} fewer (${n} now)`
    })
    const rest = still.length ? `; ${still.map(([l]) => noun(l, 2)).join(" and ")} unchanged` : ""
    return `${since}: ${parts.join(", ")}${rest}.`
}

/** Detections grouped by class, the kinds that changed first. */
export function groupDetections(changes) {
    const m = new Map()
    for (const c of changes || []) {
        const g = m.get(c.label) || { label: c.label, items: [], new: 0, removed: 0 }
        g.items.push(c)
        if (c.type === "new") g.new += 1
        if (c.type === "removed") g.removed += 1
        m.set(c.label, g)
    }
    return [...m.values()].sort((a, b) => (b.new + b.removed) - (a.new + a.removed) || b.items.length - a.items.length)
}
