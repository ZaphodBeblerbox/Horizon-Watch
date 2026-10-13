/**
 * itinerary.js — what an evacuation plan (backend/evacuation.py) says, as
 * pure functions: the itinerary on show, each leg's colour and words, the
 * person's progress in a line, the takeover's wording. Tested in
 * itinerary.test.js.
 *
 * plan = { kind: "evacuation", status: ok|shelter|no_route, recommended,
 *          itineraries: [{ key, kind: direct|air|overland|sea|shelter, title, summary, legs, duration_label,
 *                          exposure, tags, destination, assumptions }], ... }
 * leg  = { kind: ground|air|border|sea, mode, label, from, to, coords, steps, duration_label, wait_s, links? }
 */

export const isEvacuation = (plan) => plan?.kind === "evacuation"

/** The colour of a leg, by what it is (ground is the safe-route green). */
export const LEG_COLOR = { ground: "#3ddc84", air: "#8fb4e8", border: "#F5A524", sea: "#4fc3d9" }
export const LEG_ICON = { ground: "road", air: "plane", border: "border", sea: "boat" }
export const legColor = (leg) => LEG_COLOR[leg?.kind] || "#3ddc84"

/** The itinerary chosen (by key), else the recommended one, else the first. */
export function chosenItinerary(plan, key = null) {
    const its = plan?.itineraries || []
    return its.find((i) => i.key === key) || its.find((i) => i.key === plan?.recommended) || its[0] || null
}

/** The ground leg to navigate now: the first one (Apple / Google Maps). */
export function currentGroundLeg(it, legIndex = 0) {
    const legs = it?.legs || []
    return legs.slice(legIndex).find((l) => l.kind === "ground") || legs.find((l) => l.kind === "ground") || null
}

export const TAG_TEXT = { recommended: "Recommended", fastest: "Fastest safe", "lowest exposure": "Lowest exposure" }

/** "Fastest safe · By air — 4 h 40" */
export function itineraryHeadline(it) {
    if (!it) return ""
    const tags = (it.tags || []).map((t) => TAG_TEXT[t] || t)
    return `${tags.length ? `${tags.join(" · ")} — ` : ""}${it.title}, ${it.duration_label}`
}

/** One line per leg: "Drive 45 min to Paris-Orly Airport (ORY)". */
export function legLine(leg) {
    if (!leg) return ""
    if (leg.kind === "air") return `${leg.label} · ${leg.duration_label} — check flights`
    if (leg.kind === "border") return `${leg.label} · ${leg.duration_label}`
    if (leg.kind === "sea") return `${leg.label} · ${leg.duration_label} — check sailings`
    return `${leg.label} · ${leg.duration_label}`
}

const hm = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) } catch { return "" } }

/** The person's progress for the sender: "On the route · leg 1 · 3 h 10 left · ETA 18:40". */
export function progressLine(p, fmt = hm) {
    if (!p || !p.known) return "No live position from them yet."
    if (p.arrived) return "Arrived at the safe house."
    if (p.off_route) return `OFF ROUTE — ${p.off_route_m >= 1000 ? `${(p.off_route_m / 1000).toFixed(1)} km` : `${p.off_route_m} m`} from it · ${p.leg_label || ""}`.trim()
    const parts = ["On the route", p.leg_label, p.remaining_label ? `${p.remaining_label} left` : null, p.eta ? `ETA ${fmt(p.eta)}` : null]
    return parts.filter(Boolean).join(" · ")
}

/** What the red takeover says for a warning — EVACUATE with its destination and how. */
export function takeoverWording(w) {
    const evac = w?.kind === "evacuate"
    const r = w?.route || {}
    return {
        title: evac ? "EVACUATE" : "WARNING",
        open: r.route_plan_id ? (evac ? (r.safe_house ? `Open the evacuation route to ${r.safe_house}` : "Open the evacuation route") : "Open the route") : null,
        how: evac && r.summary ? r.summary : null,
        legs: evac ? (r.legs || []).map((l) => `${l.label} · ${l.duration_label}`) : [],
    }
}

/** Every line of the plan to draw: [{ coords, color, dashed, kind }] of the chosen itinerary. */
export function itineraryLines(plan, key = null) {
    const it = chosenItinerary(plan, key)
    return (it?.legs || []).filter((l) => (l.coords || []).length > 1).map((l) => ({
        coords: l.coords, color: legColor(l), dashed: l.kind === "air" || l.kind === "sea", kind: l.kind,
    }))
}

/** The points worth a marker: start, each change of leg (airport, crossing), the safe house. */
export function itineraryStops(plan, key = null) {
    const it = chosenItinerary(plan, key)
    if (!it) return []
    const out = []
    it.legs.forEach((l, i) => {
        if (i > 0 && l.kind !== "border") out.push({ lat: l.from.lat, lon: l.from.lon, name: l.from.name || l.from.code, kind: "change" })
        if (l.kind === "border") out.push({ lat: l.from.lat, lon: l.from.lon, name: l.crossing?.name || "Border", kind: "border" })
    })
    const d = it.destination || it.legs[it.legs.length - 1]?.to
    if (d) out.push({ lat: d.lat, lon: d.lon, name: d.name || "Safe point", kind: it.destination ? "safe_house" : "safe_point" })
    return out
}
