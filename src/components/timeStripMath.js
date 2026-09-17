/**
 * timeStripMath.js — PARALLAX §11.1/§11.2. The archive strip's vocabulary and
 * its arithmetic, separated from its markup so both can be checked.
 */

/**
 * §11.2 — GeoConfirmed's categories, VERBATIM.
 *
 * "Remapping at ingest destroys the ability to ask *what did the source
 * actually say*. Map to domains downstream, on the edge." The `domain` field
 * here is that downstream mapping, kept beside the category rather than
 * replacing it.
 */
export const CAT = {
    conflict:       { name: "Conflict / strike", color: "var(--red)",    domain: "conflict" },
    equipment:      { name: "Equipment loss",    color: "var(--amber)",  domain: "conflict" },
    infrastructure: { name: "Infrastructure",    color: "var(--steel)",  domain: "energy"   },
    maritime:       { name: "Maritime",          color: "var(--acc-hi)", domain: "maritime" },
    air:            { name: "Air activity",      color: "var(--acc-hi)", domain: "conflict" },
    orbat:          { name: "Unit / ORBAT",      color: "var(--green)",  domain: "conflict" },
    civil:          { name: "Civil / protest",   color: "var(--grey)",   domain: "civil"    },
}

export const CAT_KEYS = Object.keys(CAT)

/**
 * 27% of the archive carries no category — the source's words did not support
 * one (see backend/geoconfirmed_title.py). It is drawn, in the neutral line
 * colour, because a stacked bar whose segments do not sum to its own total is
 * a chart that lies about how much is there.
 */
export const UNCATEGORISED = { key: "uncategorised", name: "Uncategorised", color: "var(--txt-4)" }

/** §11.1 — "132 buckets across the archive span". */
export const BUCKETS = 132

const DAY_MS = 86_400_000

/**
 * Re-bucket the backend's day/month histogram into the strip's fixed 132
 * columns.
 *
 * The server buckets by calendar day or month (whichever suits the span); the
 * strip always draws 132 bars regardless, so a 13-year archive and a 90-day
 * one both fill the same width at the same bar pitch. Fold, never resample:
 * every input row lands in exactly one column and no count is invented
 * between them.
 */
export function foldBuckets(rows, minMs, maxMs, n = BUCKETS) {
    const out = Array.from({ length: n }, (_, i) => ({
        i,
        t0: minMs + ((maxMs - minMs) * i) / n,
        total: 0,
        categories: {},
    }))
    if (!rows || !rows.length || !(maxMs > minMs)) return out

    for (const r of rows) {
        const t = Date.parse(`${r.bucket}T00:00:00Z`)
        if (!isFinite(t)) continue
        let idx = Math.floor(((t - minMs) / (maxMs - minMs)) * n)
        if (idx < 0 || idx >= n) {
            // A row exactly on the upper bound belongs to the last column,
            // not to a 133rd that does not exist.
            if (t === maxMs) idx = n - 1
            else continue
        }
        const col = out[idx]
        col.total += r.count || 0
        for (const [k, v] of Object.entries(r.categories || {})) {
            col.categories[k] = (col.categories[k] || 0) + v
        }
    }
    return out
}

/**
 * The stacked segments for one column, in a FIXED order.
 *
 * Fixed because the alternative — ordering by size — makes the same category
 * jump between the top and bottom of the stack from one bar to the next, and
 * the eye reads that motion as the data changing.
 */
export function stackSegments(col) {
    const segs = []
    let acc = 0
    for (const key of CAT_KEYS) {
        const v = col.categories[key] || 0
        if (v > 0) { segs.push({ key, value: v, from: acc, color: CAT[key].color }); acc += v }
    }
    const u = col.categories[UNCATEGORISED.key] || 0
    if (u > 0) segs.push({ key: UNCATEGORISED.key, value: u, from: acc, color: UNCATEGORISED.color })

    // A COLUMN WITH A COUNT BUT NO BREAKDOWN STILL DRAWS.
    //
    // /histogram only returns `categories` when asked with with_categories,
    // and any deployment running a build from before that parameter existed
    // simply ignores it and answers with bare {bucket, count} rows. Without
    // this fallback every column then produced zero segments, so the archive
    // chart rendered EMPTY while holding thousands of real confirmations —
    // indistinguishable on screen from "this archive has nothing in it".
    //
    // The bar is drawn in the neutral colour, which is honest: we know how
    // much happened and not what kind.
    if (!segs.length && col.total > 0) {
        return [{ key: UNCATEGORISED.key, value: col.total, from: 0, color: UNCATEGORISED.color }]
    }
    return segs
}

/**
 * §11.1 — the calendar axis. Month ticks stepped 1 / 3 / 6 by total span;
 * January carries the YEAR and renders in --txt-2, other months lowercase
 * 3-letter in --txt-4.
 */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

export function monthStep(spanDays) {
    if (spanDays <= 400) return 1
    if (spanDays <= 1200) return 3
    return 6
}

export function calendarTicks(minMs, maxMs) {
    if (!(maxMs > minMs)) return []
    const step = monthStep((maxMs - minMs) / DAY_MS)
    const ticks = []
    const d = new Date(minMs)
    d.setUTCDate(1)
    d.setUTCHours(0, 0, 0, 0)
    // Step from the first aligned month so ticks land on multiples of `step`
    // rather than wherever the archive happens to begin.
    while (d.getUTCMonth() % step !== 0) d.setUTCMonth(d.getUTCMonth() + 1)
    while (d.getTime() <= maxMs) {
        const t = d.getTime()
        if (t >= minMs) {
            const isJan = d.getUTCMonth() === 0
            ticks.push({
                t,
                pct: ((t - minMs) / (maxMs - minMs)) * 100,
                label: isJan ? String(d.getUTCFullYear()) : MONTHS[d.getUTCMonth()],
                year: isJan,
            })
        }
        d.setUTCMonth(d.getUTCMonth() + step)
    }
    return ticks
}

/** §11.1 — playback advances "2 days × speed" every 90ms. */
export const TICK_MS = 90
export const DAYS_PER_TICK = 2
export const SPEEDS = [0.5, 1, 2, 5]

export function advance(dayOffset, speed, maxOffset) {
    const next = dayOffset + DAYS_PER_TICK * speed
    return next >= maxOffset ? { offset: maxOffset, done: true } : { offset: next, done: false }
}

/** Bar opacity — §11.1: past at .95, future at .3. */
export function barOpacity(colT0, playheadMs) {
    return colT0 <= playheadMs ? 0.95 : 0.3
}

export const dayOffsetToMs = (minMs, off) => minMs + off * DAY_MS
export const msToDayOffset = (minMs, ms) => Math.round((ms - minMs) / DAY_MS)
export const spanDays = (minMs, maxMs) => Math.max(1, Math.round((maxMs - minMs) / DAY_MS))
