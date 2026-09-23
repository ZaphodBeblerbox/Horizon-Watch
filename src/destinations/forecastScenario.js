/**
 * forecastScenario.js — build a laydown from real geography.
 *
 * WHY THIS REPLACES THE FIXED TEMPLATES. A template was a schematic
 * dropped over a country's bounding box: units at hard-coded positions
 * in a 560x240 frame, an "axis" from the left of the box to the right.
 * Over Ukraine that drew three formations advancing from Lviv toward
 * Kharkiv, into two static symbols sitting in the Donbas — the war
 * running backwards, at a moment when the line of contact is a live
 * GeoJSON feed the app already holds. It was not a simplification. It
 * was wrong, and wrong with confident symbology on top.
 *
 * So nothing here is authored in screen coordinates. A scenario takes a
 * target, an aggressor and optionally a focal place, and derives:
 *
 *   - the CONTACT: the real line the movement crosses — the line of
 *     control where we have one, the shared international border where
 *     we do not.
 *   - the ORIGINS: real airfields on the aggressor side, ranked, because
 *     air movement begins at airfields and the big and military ones
 *     are the ones that matter. Not every airport in the region: that
 *     is a texture, not an assessment.
 *   - the OBJECTIVES: real places on the target side, ranked by what
 *     doctrine goes after — the focal city, military airfields, major
 *     airports, ports.
 *   - MULTIPLE AXES, because a single arrow is not an invasion.
 *
 * AFFILIATION IS ASSIGNED, NOT GUESSED. The aggressor's formations are
 * HOSTILE (red) and the defender's are FRIENDLY (blue), which is what
 * APP-6 means by those words and what a reader expects. Drawing an
 * invasion in neutral green and unknown yellow, as the first version
 * did, says nobody knows who is who — in a scenario that names both.
 */
import { num } from "../utils/strictNumber.js"
import { kmBetween, isLand } from "./forecastFeasibility.js"

/** How far behind the contact an air origin may sit and still matter. */
export const ORIGIN_REACH_KM = 320

/** How much of an objective's score comes from what it is. */
export const KIND_WEIGHT = {
    focus: 100, military_air: 62, large_air: 46, port: 40,
    medium_air: 28, city: 34,
}

/** Every outer ring of a feature, as [lon, lat] arrays. */
export function outerRings(feature) {
    const g = feature?.geometry
    if (!g) return []
    if (g.type === "Polygon") return g.coordinates?.[0] ? [g.coordinates[0]] : []
    if (g.type === "MultiPolygon") {
        return (g.coordinates || []).map((p) => p?.[0]).filter(Boolean)
    }
    return []
}

/** Evenly thinned points of a feature's boundary. */
export function boundaryPoints(feature, step = 3) {
    const out = []
    for (const ring of outerRings(feature)) {
        for (let i = 0; i < ring.length; i += step) {
            const lon = num(ring[i]?.[0]), lat = num(ring[i]?.[1])
            if (lon !== null && lat !== null) out.push([lon, lat])
        }
    }
    return out
}

/**
 * The stretch of the target's boundary that faces the aggressor.
 *
 * Sampled rather than computed exactly: an exact shared border needs
 * topology the world file does not carry, and "within 60km of the other
 * country's boundary" is the same answer for this purpose and cannot
 * fail on a gap between two simplified polygons.
 */
export function contactPoints(target, aggressor, { withinKm = 60, max = 14 } = {}) {
    const tb = boundaryPoints(target, 2)
    const ab = boundaryPoints(aggressor, 2)
    if (!tb.length || !ab.length) return []
    const near = []
    for (const p of tb) {
        let best = Infinity
        for (const q of ab) {
            const d = kmBetween(p, q)
            if (d < best) best = d
            if (best < withinKm) break
        }
        if (best <= withinKm) near.push({ pt: p, d: best })
    }
    if (!near.length) return []
    // Spread them out, so several axes do not stack on one village.
    near.sort((a, b) => a.d - b.d)
    const picked = []
    for (const n of near) {
        if (picked.every((p) => kmBetween(p, n.pt) > 45)) picked.push(n.pt)
        if (picked.length >= max) break
    }
    return picked
}

/** Whether an airfield's name marks it as military. */
export function isMilitaryField(name) {
    return /\b(air ?base|airbase|military|afb|air force)\b/i.test(String(name || ""))
}

/** Classify an airfield for ranking. */
export function fieldKind(f) {
    if (isMilitaryField(f?.name)) return "military_air"
    if (f?.type === "large_airport") return "large_air"
    if (f?.type === "medium_airport") return "medium_air"
    return null
}

/**
 * Rank candidate places by how likely doctrine is to involve them.
 *
 * Score is what it IS plus how close it sits to the contact, because a
 * major airfield 900km to the rear is not part of this fight. Anything
 * that scores nothing is dropped rather than drawn faintly: a map of
 * every airport in the region answers a question nobody asked.
 */
export function rankPlaces(places, contact, { limit = 6, maxKm = 600 } = {}) {
    if (!contact?.length) return []
    const scored = []
    for (const p of places || []) {
        const lon = num(p.lon), lat = num(p.lat)
        if (lon === null || lat === null) continue
        const kind = p.kind || fieldKind(p)
        const base = KIND_WEIGHT[kind]
        if (!base) continue
        let d = Infinity
        for (const c of contact) {
            const k = kmBetween([lon, lat], c)
            if (k < d) d = k
        }
        if (d > maxKm) continue
        scored.push({ ...p, kind, km: d, score: base * (1 - Math.min(1, d / maxKm) * 0.7) })
    }
    scored.sort((a, b) => b.score - a.score)
    const out = []
    for (const s of scored) {
        if (out.every((o) => kmBetween([o.lon, o.lat], [s.lon, s.lat]) > 35)) out.push(s)
        if (out.length >= limit) break
    }
    return out
}

/** The point of `list` nearest `pt`. */
export function nearestOf(pt, list) {
    let best = null, bk = Infinity
    for (const o of list || []) {
        const k = kmBetween(pt, [o.lon, o.lat])
        if (k < bk) { bk = k; best = o }
    }
    return best
}

/** A point pushed `km` from `a` toward `b`. */
export function towards(a, b, km) {
    const total = kmBetween(a, b)
    if (!total) return [a[0], a[1]]
    const f = Math.min(1, km / total)
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

/** Doctrinal phases for a cross-border attack. */
export const ATTACK_PHASES = [
    { at: 0.00, label: "reconnaissance and fires in contact" },
    { at: 0.20, label: "air and missile preparation" },
    { at: 0.40, label: "ground penetration on multiple axes" },
    { at: 0.72, label: "exploitation toward the objectives" },
]

/**
 * The laydown: real formations at real coordinates, facing the right way.
 *
 * Multiple axes, because one arrow is not an invasion, and because the
 * whole reason to draw this is to ask which of several approaches the
 * ground actually favours.
 *
 * Every unit carries `what`, a sentence, so clicking it says what it is
 * instead of leaving a reader to decode a glyph they may not read.
 */
export function buildScenario({
    target, aggressor, focus = null, targetPlaces = [], aggressorFields = [],
    world = null, contact: given = null,
} = {}) {
    const contact = given?.length ? given : contactPoints(target, aggressor)
    if (!contact.length) {
        return { ok: false, reason: "no shared border or line of contact found" }
    }

    const objectives = rankPlaces(
        focus ? [{ ...focus, kind: "focus" }, ...targetPlaces] : targetPlaces,
        contact, { limit: 5 })
    const origins = rankPlaces(aggressorFields, contact,
        { limit: 4, maxKm: ORIGIN_REACH_KM })

    if (!objectives.length) {
        return { ok: false, reason: "no rankable objectives on the target side" }
    }

    const units = []
    const aggName = aggressor?.properties?.n || "aggressor"
    const tgtName = target?.properties?.n || "target"

    // AIR, from real airfields. Ranked, because doctrine flies from the
    // big and the military ones, not from every strip in the region.
    origins.forEach((o, i) => {
        const obj = nearestOf([o.lon, o.lat], objectives) || objectives[0]
        units.push({
            id: `A${i + 1}`, aff: "hostile", domain: "air", icon: "air",
            size: i === 0 ? "regt" : "bn",
            from: [o.lon, o.lat], to: [obj.lon, obj.lat],
            start: 0.18 + i * 0.05, end: 0.52 + i * 0.05,
            what: `${aggName} aviation from ${o.name}`
                + `${o.kind === "military_air" ? " (military airfield)" : ""}`
                + ` — ${Math.round(kmBetween([o.lon, o.lat], [obj.lon, obj.lat]))}km to ${obj.name}`,
        })
    })

    // GROUND, crossing at the contact, one axis per crossing, toward the
    // nearest thing worth taking.
    const axes = contact.slice(0, 4)
    axes.forEach((c, i) => {
        const obj = nearestOf(c, objectives) || objectives[0]
        const rear = towards(c, [obj.lon, obj.lat], -22)
        units.push({
            id: `${i + 1}`, aff: "hostile", domain: "ground",
            icon: i === 0 ? "armour" : "infantry",
            size: i === 0 ? "bde" : "regt",
            from: rear, to: [obj.lon, obj.lat],
            via: [towards(c, [obj.lon, obj.lat], 18)],
            start: 0.40 + i * 0.04, end: 0.92,
            what: `${aggName} ${i === 0 ? "armoured brigade" : "motor rifle regiment"}`
                + ` crossing toward ${obj.name}`,
        })
        if (i < 2) {
            units.push({
                id: `G${i + 1}`, aff: "hostile", domain: "ground", icon: "artillery",
                size: "bn", from: towards(c, [obj.lon, obj.lat], -55),
                to: towards(c, [obj.lon, obj.lat], -20),
                start: 0.20, end: 0.44,
                what: `${aggName} artillery — moves up but stays short of the line; `
                    + `it fires across it`,
            })
        }
    })

    // RECON, first across, which is why the rest is timed the way it is.
    const r0 = axes[0]
    if (r0) {
        const obj = nearestOf(r0, objectives) || objectives[0]
        units.push({
            id: "R", aff: "hostile", domain: "ground", icon: "recon", size: "coy",
            from: towards(r0, [obj.lon, obj.lat], -30),
            to: towards(r0, [obj.lon, obj.lat], 45),
            start: 0.0, end: 0.30,
            what: `${aggName} reconnaissance — crosses first and sets the timing `
                + `for everything behind it`,
        })
    }

    // THE DEFENCE, on the objectives, blue. It does not reposition until
    // an axis has shown itself.
    objectives.slice(0, 3).forEach((o, i) => {
        units.push({
            id: `D${i + 1}`, aff: "friendly", domain: "ground",
            icon: i === 0 ? "infantry" : "artillery",
            size: i === 0 ? "bde" : "bn",
            from: [o.lon, o.lat],
            to: towards([o.lon, o.lat], contact[0], 25),
            start: 0.60 + i * 0.05, end: 1.0,
            what: `${tgtName} defending formation at ${o.name} — holds until an `
                + `axis commits, then moves to meet it`,
        })
    })

    return {
        ok: true, contact, origins, objectives, units,
        phases: ATTACK_PHASES,
        doctrine: "Cross-border attack: reconnaissance and fires in contact, air and "
                + "missile preparation, then penetration on several axes at once, "
                + "exploiting whichever one the ground and the defence allow.",
    }
}

/**
 * The window a scenario is read in: its own operational area.
 *
 * NOT the target country's bounding box. Fitting Ukraine drew formations
 * that spanned 1,300km — a brigade rendered the size of an oblast, and
 * an axis that appeared to cross the whole country in one bound. A
 * scenario is about a stretch of border and the things behind it, so the
 * frame is the contact, the objectives and the origins, and nothing
 * else.
 */
export function scenarioBBox(sc, { padFrac = 0.22 } = {}) {
    const pts = []
    for (const c of sc?.contact || []) pts.push(c)
    for (const o of sc?.objectives || []) pts.push([o.lon, o.lat])
    for (const o of sc?.origins || []) pts.push([o.lon, o.lat])
    for (const u of sc?.units || []) {
        if (u.from) pts.push(u.from)
        if (u.to) pts.push(u.to)
    }
    if (!pts.length) return null
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
    for (const [lon, lat] of pts) {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
        if (lon < a) a = lon
        if (lat < b) b = lat
        if (lon > c) c = lon
        if (lat > d) d = lat
    }
    if (!Number.isFinite(a)) return null
    const padLon = Math.max((c - a) * padFrac, 0.35)
    const padLat = Math.max((d - b) * padFrac, 0.35)
    return [a - padLon, b - padLat, c + padLon, d + padLat]
}

/**
 * Generated units, in screen coordinates for the drawn view.
 *
 * Projecting here rather than teaching the renderer about longitude
 * keeps one movement model: everything downstream still walks a
 * polyline in the same 560x240 box, whether it came from a hand-authored
 * template or from geography.
 */
export function projectUnits(sc, view, project) {
    return (sc?.units || []).map((u) => {
        const from = project(u.from[0], u.from[1], view)
        const to = project(u.to[0], u.to[1], view)
        const via = (u.via || []).map((v) => project(v[0], v[1], view)).filter(Boolean)
        if (!from || !to) return null
        return {
            ...u, x: from[0], y: from[1], to, via,
            geoFrom: u.from, geoTo: u.to,
        }
    }).filter(Boolean)
}
