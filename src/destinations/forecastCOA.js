/**
 * forecastCOA.js — which courses of action this theatre actually allows.
 *
 * THE BUG THIS REPLACES. Scenarios were chosen from a menu of six fixed
 * templates, mapped from a violence type. Every conflict therefore got
 * one of four shapes whether or not any of them applied, and the checks
 * that could have caught it ran AFTER generation: Israel drew ground
 * formations attacking Gaza out of the Mediterranean, flagged them red,
 * and animated them anyway. A movement that is known to be impossible
 * should never be generated, and a theatre where nothing is possible
 * should produce no picture at all.
 *
 * So the question is asked the other way round. Given the geography and
 * what each side actually fields, WHICH courses of action exist?
 *
 *   ground      needs a shared land border
 *   air         needs the aggressor to field aircraft
 *   missile     needs the aggressor to field missiles; no border needed,
 *               which is how Iran/Israel is a real dyad with no frontier
 *   amphibious  needs the target to have a coast AND the aggressor a navy
 *   hybrid      needs a shared border; sub-threshold pressure
 *
 * Capability comes from the equipment lists, so "no air option" means we
 * checked and the force fields no aircraft — distinct from "we do not
 * know", which is reported as its own state and never as a refusal.
 */

/** Every course of action this console knows how to draw. */
export const COA_KINDS = ["ground", "air", "missile", "amphibious", "hybrid"]

export const COA_META = {
    ground: {
        label: "Ground incursion",
        doctrine: "Reconnaissance and fires in contact, preparation, then "
                + "penetration on several axes at once.",
        needs: ["a shared land border"],
    },
    air: {
        label: "Air campaign",
        doctrine: "Strikes from airfields against defences, command and the "
                + "objectives themselves, before or instead of a ground move.",
        needs: ["aircraft", "an airfield within range"],
    },
    missile: {
        label: "Standoff missile strikes",
        doctrine: "Fires against fixed nodes from beyond the frontier. No "
                + "border is required, which is why it is the option that "
                + "exists when nothing else does.",
        needs: ["missiles"],
    },
    amphibious: {
        label: "Amphibious or naval approach",
        doctrine: "Approach and lodgement from the sea against a coastal "
                + "objective.",
        needs: ["a navy", "a coastal objective"],
    },
    hybrid: {
        label: "Sub-threshold pressure",
        doctrine: "Interference, provocation and irregular action calibrated "
                + "to stay below the threshold of an armed response.",
        needs: ["a shared land border"],
    },
}

/**
 * Which COAs the theatre permits, and why the others are excluded.
 *
 * `caps` is the aggressor's capability list from the equipment lookup,
 * or null when it is unknown. Unknown is NOT treated as absent: a force
 * we failed to look up is not a force without an air arm, and refusing
 * an option for want of data would be a finding we did not make.
 */
export function availableCOAs({
    contiguous = false, targetCoastal = false, caps = null,
    originsInRange = 0,
} = {}) {
    const known = Array.isArray(caps)
    const has = (c) => (known ? caps.includes(c) : null)
    const out = []
    const excluded = []

    const consider = (kind, checks) => {
        const failed = checks.filter((c) => c.ok === false)
        const unknown = checks.filter((c) => c.ok === null)
        if (failed.length) {
            excluded.push({ kind, reason: failed[0].why, certain: true })
            return
        }
        out.push({
            kind, ...COA_META[kind],
            uncertain: unknown.map((u) => u.why),
        })
    }

    consider("ground", [
        { ok: contiguous, why: "no shared land border" },
    ])
    consider("hybrid", [
        { ok: contiguous, why: "no shared land border" },
    ])
    consider("air", [
        { ok: has("aircraft"), why: "this force fields no aircraft" },
        { ok: originsInRange > 0, why: "no airfield within range of the contact" },
    ])
    consider("missile", [
        { ok: has("missiles"), why: "this force fields no missiles" },
    ])
    consider("amphibious", [
        { ok: targetCoastal, why: "the objective is not on a coast" },
        { ok: has("naval"), why: "this force fields no navy" },
    ])

    return { available: out, excluded }
}

/**
 * Whether a target has a usable coast.
 *
 * Deliberately strict: "the country touches water somewhere" is not the
 * same as "an amphibious approach to this objective is possible", and
 * the loose version is what put landing craft in the Mediterranean
 * aimed at a city they could not reach.
 */
export function coastalObjective(objective, isLandFn, world, reachKm = 30) {
    if (!objective || typeof isLandFn !== "function") return false
    const { lon, lat } = objective
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
    // Sample a ring at roughly the naval reach; if any of it is water,
    // the objective is reachable from the sea.
    const dLat = reachKm / 111
    const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180))
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        const p = [lon + Math.cos(a) * dLon, lat + Math.sin(a) * dLat]
        if (isLandFn(p[0], p[1], world) === false) return true
    }
    return false
}
