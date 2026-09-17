/**
 * inboxLogic.js — PARALLAX addendum §S2, the Inbox's arithmetic.
 *
 * "Triage is COMPARISON, not reading. A card list forces a vertical scan
 * through decoration to reach the one field you are comparing on; a table
 * puts severity, confidence and age in fixed columns so the eye travels down
 * a single axis. Cards are right for a feed. This is not a feed."
 */

/** §S2.3's seven columns, in order, at the spec's widths. */
export const COLUMNS = [
    { key: "ts", label: "Received", width: 96 },
    { key: "sev", label: "Severity", width: 104 },
    { key: "title", label: "Signal", width: null },
    { key: "place", label: "Location", width: 150 },
    { key: "domain", label: "Domain", width: 112 },
    { key: "conf", label: "Confidence", width: 112 },
    { key: "source", label: "Source", width: 118 },
]

/**
 * §S2.3 — escalation is an INLINE TAG in the title cell, never a column.
 * "It is rare; a column for it would be 90% empty."
 */
export const STATUSES = ["all", "new", "ack", "esc"]

export const SEV_ORDER = ["critical", "high", "elevated", "moderate", "low"]
const SEV_RANK = Object.fromEntries(SEV_ORDER.map((s, i) => [s, i]))

export const SEV_COLOR = {
    critical: "var(--sev-critical)",
    high: "var(--sev-high)",
    elevated: "var(--sev-high)",
    moderate: "var(--sev-moderate)",
    low: "var(--sev-low)",
}

const sevOf = (r) => (r.raw?.severity_tier || r.raw?.severity || "low").toLowerCase()
const domainOf = (r) => (r.kind === "fusion" ? "fusion" : (r.raw?.type || r.raw?.source_type || "signal"))
const sourceOf = (r) => r.raw?.source || (r.kind === "fusion" ? "fusion" : "—")

/** Turn a shared watch-queue row into an inbox row. One source of truth: the
 *  Inbox never re-derives what dashboardLogic already normalised. */
export function toInboxRow(r, statuses = {}) {
    return {
        id: r.id,
        ts: r.publishedAt ? new Date(r.publishedAt).getTime() : 0,
        sev: sevOf(r),
        title: r.title,
        place: r.aoi || "",
        domain: domainOf(r),
        conf: typeof r.confidencePct === "number" ? r.confidencePct / 100 : null,
        source: sourceOf(r),
        status: statuses[r.id] || "new",
        row: r,
    }
}

/**
 * §S2.4 — header click sets the key; clicking the ACTIVE key flips direction.
 * Default `ts` descending.
 */
export function nextSort(current, key) {
    if (current.key !== key) return { key, dir: key === "ts" ? "desc" : "asc" }
    return { key, dir: current.dir === "asc" ? "desc" : "asc" }
}

export function sortRows(rows, { key, dir }) {
    const sign = dir === "asc" ? 1 : -1
    const val = (r) => {
        switch (key) {
            case "ts": return r.ts
            // Severity sorts by URGENCY, not alphabetically: "critical"
            // before "elevated" is the whole point of the column, and a
            // string sort would put elevated first.
            //
            // Note the parentheses. `-SEV_RANK[r.sev] ?? -99` binds the unary
            // minus FIRST, so the whole column sorted backwards — critical
            // landed at the bottom, which is the one ordering this table must
            // never produce.
            case "sev": return SEV_RANK[r.sev] ?? 99
            case "conf": return r.conf ?? -1
            default: return String(r[key] || "").toLowerCase()
        }
    }
    return [...rows].sort((a, b) => {
        const x = val(a), y = val(b)
        if (x < y) return -sign
        if (x > y) return sign
        // Stable tiebreak on recency, so equal keys never shuffle between
        // renders — a table that reorders under the cursor is unusable.
        return b.ts - a.ts
    })
}

/** Status chips + free text. Each stage is applied separately so the empty
 *  state can name WHICH one emptied the queue (§S2.7). */
export function applyFilters(rows, { status = "all", q = "", sevFloor = null } = {}) {
    const stages = []
    let out = rows

    if (sevFloor) {
        const before = out.length
        out = out.filter((r) => (SEV_RANK[r.sev] ?? 99) <= (SEV_RANK[sevFloor] ?? 99))
        stages.push({ stage: "severity floor", label: `above the ${sevFloor} floor`, removed: before - out.length, remaining: out.length })
    }
    if (status !== "all") {
        const before = out.length
        out = out.filter((r) => r.status === status)
        stages.push({ stage: "status", label: `status ${status}`, removed: before - out.length, remaining: out.length })
    }
    const needle = q.trim().toLowerCase()
    if (needle) {
        const before = out.length
        out = out.filter((r) => `${r.title} ${r.place} ${r.source}`.toLowerCase().includes(needle))
        stages.push({ stage: "search", label: `matching “${q.trim()}”`, removed: before - out.length, remaining: out.length })
    }
    return { rows: out, stages }
}

/**
 * §S2.7 — "Never 'No results'. Say which filter removed them and how many
 * exist below it. A filter that cannot explain its own emptiness teaches
 * analysts to distrust every filter in the product."
 */
export function emptyStateMessage({ total, stages, windowHours }) {
    if (total === 0) return { headline: "No signals in the queue.", detail: "Nothing has arrived yet." }
    const culprit = [...stages].reverse().find((s) => s.removed > 0)
    if (!culprit) return { headline: "No signals match.", detail: "" }
    const win = windowHours ? ` in the last ${windowHours} hours` : ""
    return {
        headline: `No signals ${culprit.label}${win}.`,
        detail: `${culprit.removed} ${culprit.removed === 1 ? "exists" : "exist"} below it.`,
    }
}

/**
 * §S2.6 — the left pane is DISTRIBUTIONS, not checkboxes. "It is the same
 * information a filter list carries, plus the shape of the queue. Deciding
 * where to start needs the shape."
 */
export function distribution(rows, keyFn) {
    const counts = new Map()
    for (const r of rows) {
        const k = keyFn(r)
        if (!k) continue
        counts.set(k, (counts.get(k) || 0) + 1)
    }
    const max = Math.max(1, ...counts.values())
    return [...counts.entries()]
        .map(([key, n]) => ({ key, n, pct: (n / max) * 100 }))
        .sort((a, b) => b.n - a.n)
}

export function severityDistribution(rows) {
    const d = distribution(rows, (r) => r.sev)
    return d.sort((a, b) => (SEV_RANK[a.key] ?? 99) - (SEV_RANK[b.key] ?? 99))
}

export const unreadCount = (rows) => rows.reduce((n, r) => n + (r.status === "new" ? 1 : 0), 0)

/** `HH:MM` — the Received column. */
export function hhmm(ts) {
    if (!ts) return "—"
    const d = new Date(ts)
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}
