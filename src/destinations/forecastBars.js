/**
 * forecastBars.js — the arithmetic behind the bar stack.
 *
 * Extracted from the view because the spec's rules are arithmetic, not
 * decoration, and each one is a thing that can be silently wrong:
 *
 *   1. the residual is COMPUTED, never authored
 *   2. the base-rate tick is positioned from the base rate
 *   3. a bar sitting on its tick is the model saying nothing new
 *
 * Addendum F1: "A model that emits 68% and nothing else is worse than no
 * model." These functions are what stop that happening.
 */
import { num } from "../utils/strictNumber.js"

/** Percentage text. One decimal under 10%, none above — 7.0% and 56%. */
export function pct(p) {
    const v = num(p)
    if (v === null) return "—"
    const n = v * 100
    return n < 10 ? `${n.toFixed(1)}%` : `${Math.round(n)}%`
}

/**
 * The probability that NONE of the listed scenarios happens.
 *
 * Never read from the payload even when the server sends one: the board
 * gains analyst proposals client-side, and a residual that does not move
 * when a scenario is added is the exact failure F7 calls out.
 *
 * THIS WAS 1 - SUM(p), WHICH IS A CATEGORY ERROR. That is the residual
 * only if the rows are alternatives to one another, and they are not:
 * escalation in state-based conflict, in non-state conflict and in
 * one-sided violence can all happen in the same quarter, in the same
 * country. The old formula carried its own evidence — it needed a clamp
 * at zero, which can only bite when the rows sum past 1, which can only
 * happen when they are not exclusive. Sudan summed to 1.121 and the
 * board printed a residual of 0.0: "there is no chance that none of
 * these happens", in the row the spec calls the most important one.
 *
 * The product of the complements is P(none) under independence. That is
 * not true either, but its error has a known and safe direction: these
 * events are positively correlated, and for positively correlated events
 * P(neither) EXCEEDS the independent product, because what flares
 * together stays quiet together. So this is a floor, and the row reads
 * honestly as "at least this likely".
 *
 * Kept identical to forecast_board.residual_of on the server; a test
 * checks the two against the same cases.
 */
export function residualOf(scenarios) {
    return (scenarios || []).reduce((r, x) => {
        const p = num(x?.p)
        if (p === null) return r
        return r * (1 - Math.max(0, Math.min(1, p)))
    }, 1)
}

/**
 * How a bar reads against its own base rate.
 *
 * "7% means nothing. 7% against a 2% base rate is a finding." A bar
 * within a whisker of its tick is the model telling you what history
 * already said, and saying so is more useful than the number.
 */
export function departure(p, base) {
    const a = num(p)
    if (a === null) return null
    if (num(base) === null) {
        // An authored scenario has no measured history. Saying "no base
        // rate" is honest; inventing one is the laundering rule 2 exists
        // to prevent.
        return { kind: "none", text: "no base rate — this is an authored scenario" }
    }
    const b = num(base)
    const diff = a - b
    if (Math.abs(diff) < 0.02) {
        return { kind: "flat", diff,
                 text: `on its base rate of ${pct(b)} — history already said this` }
    }
    return {
        kind: diff > 0 ? "above" : "below",
        diff,
        text: `${pct(Math.abs(diff))} ${diff > 0 ? "above" : "below"} a base rate of ${pct(b)}`,
    }
}

/** Tick offset as a percentage of the bar's width, clamped into it. */
export function tickLeft(base) {
    const b = num(base)
    if (b === null) return null
    return `${Math.max(0, Math.min(100, b * 100))}%`
}

/** Bar fill width, clamped so a rogue probability cannot overflow the row. */
export function barWidth(p) {
    const v = num(p)
    if (v === null) return "0%"
    return `${Math.max(0, Math.min(100, v * 100))}%`
}

/**
 * Scenarios plus the residual as one ordered list to render.
 *
 * The residual is last and flagged, never a footnote — it is a row of
 * the same kind as the others, which is what stops it reading as an
 * afterthought.
 */
export function rows(scenarios) {
    const list = [...(scenarios || [])].sort((a, b) => (b.p || 0) - (a.p || 0))
    return [
        ...list.map((s) => ({ ...s, residual: false })),
        {
            id: "__residual__", residual: true, p: residualOf(list),
            label: "None of these",
            note: "at least this likely — the listed set is never complete",
        },
    ]
}
