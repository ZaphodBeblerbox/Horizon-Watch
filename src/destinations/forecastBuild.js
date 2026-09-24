/**
 * forecastBuild.js — assemble a scenario the analyst asked for.
 *
 * The orchestration the builder needs, kept out of the component so it
 * can be tested without a browser: take a target, an aggressor and an
 * optional objective, and return the probability, the courses of action
 * this theatre actually allows, and the laydown for the chosen one.
 *
 * Nothing here decides anything on its own. The prior comes from the
 * server's measured dyadic model, capability from the equipment lists,
 * feasibility from the real coastline, and the laydown from real
 * airfields and a real border. This only puts them in order and reports
 * what each step refused.
 */
import { matchCountry, bboxOf } from "./forecastTerrain.js"
import { contactPoints, rankPlaces, buildScenario, ORIGIN_REACH_KM } from "./forecastScenario.js"
import { availableCOAs, coastalObjective } from "./forecastCOA.js"
import { isLand } from "./forecastFeasibility.js"

/** Aggressor fields and target places, split out of one airport list. */
export function splitFields(fields, targetCC, aggressorCC) {
    const t = [], a = []
    for (const f of fields || []) {
        if (f.cc === targetCC) t.push(f)
        else if (f.cc === aggressorCC) a.push(f)
    }
    return { targetPlaces: t, aggressorFields: a }
}

/**
 * Everything the builder needs for one pairing.
 *
 * `capabilities` is the aggressor's list or null for unknown; `prior` is
 * the server's dyadic assessment. Both are passed in rather than fetched
 * here so this stays synchronous and testable.
 */
export function assembleScenario({
    world, fields, target, aggressor, objective = null,
    capabilities = null, prior = null, coa = null,
} = {}) {
    const tf = matchCountry(target, world)
    const af = matchCountry(aggressor, world)
    if (!tf) return { ok: false, reason: `no outline for ${target || "the target"}` }
    if (!af) return { ok: false, reason: `no outline for ${aggressor || "the aggressor"}` }

    const tcc = tf.properties?.a2, acc = af.properties?.a2
    const { targetPlaces, aggressorFields } = splitFields(fields, tcc, acc)

    const contact = contactPoints(tf, af)
    const contiguous = contact.length > 0

    // Origins are needed before the COA list, because "air" depends on
    // there being an airfield in range, not merely on owning aircraft.
    const origins = contiguous
        ? rankPlaces(aggressorFields, contact, { limit: 4, maxKm: ORIGIN_REACH_KM })
        : []

    const objectives = rankPlaces(
        objective ? [{ ...objective, kind: "focus" }, ...targetPlaces] : targetPlaces,
        contact.length ? contact
            : (objective ? [[objective.lon, objective.lat]] : []),
        { limit: 5 })

    const focusObj = objectives[0] || objective
    const targetCoastal = focusObj
        ? coastalObjective(focusObj, isLand, world)
        : false

    const { available, excluded } = availableCOAs({
        contiguous, targetCoastal, caps: capabilities,
        originsInRange: origins.length,
    })

    let laydown = null
    if (coa && available.some((c) => c.kind === coa)) {
        laydown = buildScenario({
            target: tf, aggressor: af, focus: objective,
            targetPlaces, aggressorFields, contact,
        })
    }

    return {
        ok: true, target, aggressor, contiguous, targetCoastal,
        contact, origins, objectives, available, excluded,
        prior, capabilities, coa, laydown,
        bbox: bboxOf(tf.geometry),
    }
}
