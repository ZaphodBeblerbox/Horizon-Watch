/**
 * feedHealth.js — PARALLAX part 3 §33.3.
 *
 * "Each adapter reports live | degraded | stale(age) | off. A DETECTOR WHOSE
 * FEED IS STALE IS SUSPENDED, not left firing on old data, and the suspension
 * is visible. This is the smallest piece of work in the whole spec with the
 * largest effect on whether analysts trust the system."
 *
 * The trust argument is the whole point: a console that keeps drawing a layer
 * from a feed that stopped four hours ago is not merely out of date, it is
 * asserting something it has no evidence for. "Nothing new in the Baltic" and
 * "the Baltic feed is down" look identical on a map and mean opposite things.
 *
 * ONE THRESHOLD WOULD BE WRONG FOR EVERY FEED. A vessel position two hours
 * old is stale; a port-index dump two hours old is fresh, because that source
 * publishes a few times a year. Staleness is only meaningful against a feed's
 * OWN expected cadence, so the table below is per source type — and a type
 * this app has never seen is left unjudged rather than measured against a
 * default that would be wrong for it.
 */

export const STATE = {
    live:     { key: "live",     label: "live",     color: "var(--green)" },
    degraded: { key: "degraded", label: "degraded", color: "var(--amber)" },
    stale:    { key: "stale",    label: "stale",    color: "var(--amber)" },
    off:      { key: "off",      label: "off",      color: "var(--red)" },
    unknown:  { key: "unknown",  label: "unknown",  color: "var(--grey)" },
}

/** Hours after which a feed of this type has stopped telling us anything new. */
export const STALE_AFTER_H = {
    "real-time alerts": 0.5,
    maritime: 0.5,
    aviation: 0.5,
    news: 2,
    satellite: 24,
    infrastructure: 24 * 7,
    sanctions: 24 * 7,
}

/**
 * Per-source cadence overrides, keyed by id.
 *
 * `type` is a DOMAIN label, not a publication cadence, and the two come
 * apart: the sanctions list is typed "maritime" because that is the domain it
 * serves, but OFAC and its peers publish weekly — measuring it against AIS's
 * half-hour expectation marked a perfectly current list stale within the
 * hour. An alert nobody can act on is an alert nobody reads.
 */
export const STALE_AFTER_H_BY_ID = {
    sanctions: 24 * 7,
    pipelines: 24 * 7,
    entity_linker: 24,
    embedding_relevance: 24,
}

function thresholdFor(source) {
    const byId = STALE_AFTER_H_BY_ID[source?.id]
    return byId != null ? byId : STALE_AFTER_H[source?.type]
}

export function ageHours(lastFetch, nowMs = Date.now()) {
    if (!lastFetch) return null
    const t = Date.parse(lastFetch)
    if (!Number.isFinite(t)) return null
    return (nowMs - t) / 3_600_000
}

/**
 * Classify one adapter.
 *
 * `off` is reserved for a feed that has never delivered anything or is
 * reporting an error — the state where a layer built on it must show nothing
 * rather than something old.
 */
export function classifyFeed(source, nowMs = Date.now()) {
    const status = (source?.status || "").toLowerCase()
    const age = ageHours(source?.last_fetch, nowMs)
    const threshold = thresholdFor(source)

    if (status === "error" || status === "down") return { ...STATE.off, age }
    // A feed that has never fetched is OFF, not stale: "stale" implies we
    // once had data and it aged, which is a different and less alarming
    // claim than never having heard from the source at all.
    if (age === null) return { ...STATE.off, age: null }
    if (threshold != null && age > threshold) return { ...STATE.stale, age }
    if (status === "degraded" || (source?.failures ?? 0) > 0) return { ...STATE.degraded, age }
    if (status === "ok" || status === "live") return { ...STATE.live, age }
    // A type we have no cadence for, reporting a status we do not model:
    // unjudged rather than guessed.
    return { ...STATE.unknown, age }
}

export function classifyAll(sources, nowMs = Date.now()) {
    return (sources || []).map((s) => ({ source: s, state: classifyFeed(s, nowMs) }))
}

export function summarise(classified) {
    const counts = { live: 0, degraded: 0, stale: 0, off: 0, unknown: 0 }
    for (const c of classified) counts[c.state.key] += 1
    return {
        counts,
        total: classified.length,
        // What the status bar leads with: the worst thing currently true.
        worst: counts.off ? "off" : counts.stale ? "stale" : counts.degraded ? "degraded" : "live",
        // §33.3's suspension list — the feeds whose detectors must not keep
        // firing on old data.
        suspended: classified.filter((c) => c.state.key === "stale" || c.state.key === "off"),
    }
}

/** "4h" / "3d" / "never" — the `stale(age)` part of the vocabulary. */
export function ageLabel(age) {
    if (age == null) return "never"
    if (age < 1) return `${Math.max(1, Math.round(age * 60))}m`
    if (age < 48) return `${Math.round(age)}h`
    return `${Math.round(age / 24)}d`
}

/**
 * The sentence a suspended layer shows in place of its data. Names the feed
 * and the age, because "no data" and "we stopped looking N hours ago" are
 * different claims and only one of them is true here.
 */
export function suspensionNote(name, state) {
    if (state.key === "off") return `${name} has delivered nothing. Anything this layer would draw is unknown, not absent.`
    return `${name} last delivered ${ageLabel(state.age)} ago and is suspended. What you see is older than that, and what you do not see may simply be unreported.`
}
