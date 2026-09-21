/**
 * gfwEvents.js — how Global Fishing Watch events read on the map.
 *
 * THESE ARE NOT LIVE CONTACTS and must not look like them. GFW
 * publishes events after processing, typically three to five days
 * behind, so every one of these marks is a record of something that
 * finished happening days ago. They are drawn hollow for that reason —
 * the filled marks on this map mean "a thing is here now", and these
 * mean "a thing happened here".
 */

/** Colour and shape per event kind. */
export const KIND_STYLE = {
    // Two hulls meeting at sea is how a cargo moves with no port
    // record, so it gets the strongest colour of the four.
    encounters:    { color: "#FFB020", shape: "diamond", label: "Encounter" },
    // AIS stopped and later resumed.
    gaps:          { color: "#FF453A", shape: "triangle", label: "AIS gap" },
    loitering:     { color: "#5AC8FA", shape: "circle", label: "Loitering" },
    "port-visits": { color: "#8E8E93", shape: "square", label: "Port visit" },
}

export const KINDS = Object.keys(KIND_STYLE)

export function styleFor(kind) {
    return KIND_STYLE[kind] || KIND_STYLE.loitering
}

/**
 * A one-line description of what happened, naming the vessels.
 *
 * Names come from AIS and are self-reported, so an unnamed vessel is
 * described by its MMSI rather than as "unknown vessel" — the MMSI is
 * the identifier an analyst can actually act on.
 */
export function summaryOf(ev) {
    const style = styleFor(ev?.kind)
    const who = (ev?.vessels || [])
        .map((v) => v?.name || (v?.mmsi ? `MMSI ${v.mmsi}` : null))
        .filter(Boolean)
    if (!who.length) return style.label
    if (who.length === 1) return `${style.label} — ${who[0]}`
    return `${style.label} — ${who[0]} and ${who[1]}`
}

/**
 * How old this event is, in words, or null if it has no timestamp.
 *
 * Deliberately coarse. These are never fresh enough for minutes to
 * matter, and a precise-looking "3h 12m ago" on a four-day-old record
 * would be a false precision.
 */
export function ageLabel(startIso, now = Date.now()) {
    if (!startIso) return null
    const t = Date.parse(startIso)
    if (!Number.isFinite(t)) return null
    const days = (now - t) / 86_400_000
    if (days < 0) return "just published"
    if (days < 1) return "within the last day"
    if (days < 2) return "1 day ago"
    return `${Math.round(days)} days ago`
}

/**
 * The line that has to appear wherever one of these is shown.
 *
 * Written from the feed's own reported lag rather than hardcoded,
 * because the lag varies by event kind and by week.
 */
export function freshnessNote(lagDays) {
    if (lagDays === null || lagDays === undefined) {
        return "Derived from satellite AIS after processing — not a live position."
    }
    const d = Number(lagDays)
    if (!Number.isFinite(d)) {
        return "Derived from satellite AIS after processing — not a live position."
    }
    return `Derived from satellite AIS after processing — not a live position. `
         + `Newest event in this feed is ${d} day${d === 1 ? "" : "s"} old.`
}
