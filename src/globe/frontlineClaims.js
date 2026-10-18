/**
 * frontlineClaims.js — the pure parts of three map layers drawn from
 * backend/frontline_claims.py (GET /api/frontlines/overlay), shared by the
 * desktop globe (GlobeFrontlineClaimsLayer.jsx), the inspector cards and
 * the phone registry (mobile/mapLayers.js). No Cesium, no DOM.
 *
 *   FRONTLINE CLAIMS — what a report says was taken, drawn ON TOP of the
 *     official line, never merged into it: a disc around the named place,
 *     hatched in the claimant's side colour while "CLAIMED, unverified";
 *     solid and quieter once DeepStateMap agrees ("confirmed"); grey and
 *     faint when 7 days pass without that ("expired") or the other side
 *     claims it back ("contradicted"). The backend decides the status.
 *   MOVEMENTS — a side's ground fighting followed over the days: legs of a
 *     path from place to place, converging arrows round a besieged place,
 *     or one arrow from the actor's side of the front where nothing earlier
 *     is known; the unit's NATO APP-6 symbol (milsymbol) on each. The start
 *     is the backend's reading (from_basis), never the source's.
 *   TRAJECTORIES — a drone or missile drawn from its launch origin (the
 *     report's, or an ASSUMED one, always said so) to its target: drones
 *     low and wandering (vesselThreat.buildFlightPath, the Shahed/Geran
 *     model flies it), ballistic missiles on a high arc, cruise missiles on
 *     a low one.
 *
 * SIDES ARE NEUTRAL FRAMING: blue and red tell two sides apart in each
 * theatre; the APP-6 friend/hostile frames carry those colours by
 * convention, not as a judgment (the backend's sides_note says so).
 */
import ms from "milsymbol"
import { bearingDeg, buildFlightPath, destination, greatCircleAt, haversineKm } from "./vesselThreat.js"

export const SIDE_COLOURS = { blue: "#3d8bff", red: "#e5484d", unknown: "#9aa9bc" }
export const sideColour = (side, given = null) => given || SIDE_COLOURS[side] || SIDE_COLOURS.unknown

// A theatre side's name (frontline_claims.py THEATRES) that is not itself a
// country name, but is one state's forces. Non-state sides (Houthis, RSF,
// Hezbollah) have no national flag and get none.
const FACTION_ISO2 = {
    "saudi-led coalition": "SA", "sudanese armed forces": "SD", "iran and allies": "IR",
    "russian federation": "RU", "afu": "UA", "idf": "IL",
}
let _byName = null
function countryIso2ByName(name) {
    if (!_byName) {
        _byName = new Map()
        try {
            const dn = new Intl.DisplayNames(["en"], { type: "region" })
            for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
                const code = String.fromCharCode(a, b)
                const n = dn.of(code)
                // first code wins: retired ones (SU) also answer to "Russia"
                if (n && n !== code && n !== "Unknown Region" && !_byName.has(n.toLowerCase())) _byName.set(n.toLowerCase(), code)
            }
        } catch { /* no Intl names: the alias table alone */ }
    }
    return _byName.get(name) || null
}

/** The faction's country, {iso2, name}, for its flag — or null (a non-state side, or none named). */
export function factionCountry(d) {
    for (const raw of [d?.actor, d?.side_name]) {
        const name = String(raw || "").trim()
        if (!name) continue
        const k = name.toLowerCase()
        const iso2 = FACTION_ISO2[k] || countryIso2ByName(k)
        if (iso2) return { iso2, name }
    }
    return null
}

/** One fetch for all three layers; the backend caches it for a minute. */
export function overlayUrl(base, hours = 168) {
    return `${base}/api/frontlines/overlay?hours=${Math.max(1, Math.min(720, Math.round(Number(hours) || 168)))}`
}

// ── claims ──────────────────────────────────────────────────────────────

export const CLAIM_STATUS = {
    claimed:      { label: "Claimed, unverified", fill: 0.30, line: 0.95, hatch: true,  dash: true,  grey: false },
    confirmed:    { label: "Confirmed",           fill: 0.22, line: 0.85, hatch: false, dash: false, grey: false },
    expired:      { label: "Expired (7 days, not confirmed)", fill: 0.08, line: 0.40, hatch: false, dash: true, grey: true },
    contradicted: { label: "Contradicted",        fill: 0.06, line: 0.35, hatch: false, dash: true,  grey: true },
}

/** How a claim is drawn: its colour, fill and outline alpha, hatched or dashed. */
export function claimStyle(c) {
    const st = CLAIM_STATUS[c?.status] || CLAIM_STATUS.claimed
    return { ...st, color: st.grey ? SIDE_COLOURS.unknown : sideColour(c?.side, c?.colour) }
}

/** The claim's outline as [{lat, lon}] (the backend sends a GeoJSON circle). */
export function claimRing(c) {
    const ring = c?.geometry?.coordinates?.[0]
    if (!Array.isArray(ring)) return []
    return ring.map(([lon, lat]) => ({ lat: Number(lat), lon: Number(lon) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
}

/** The words on the map: the backend's label ("CLAIMED — unverified, by Russia, …"), shortened. */
export function claimMapLabel(c) {
    const place = c?.target_name ? String(c.target_name).split(",")[0] : null
    const st = c?.status || "claimed"
    const who = c?.actor || c?.side_name || "unknown"
    const head = st === "claimed" ? "CLAIMED, unverified" : st === "confirmed" ? "CONFIRMED claim"
        : st === "expired" ? "EXPIRED claim" : "CONTRADICTED claim"
    return [`${head}${place ? ` · ${place}` : ""}`, `by ${who}`].join("\n")
}

export function claimSummary(c) {
    const place = c?.target_name ? String(c.target_name).split(",").slice(0, 2).join(",") : "a place"
    const who = c?.actor || c?.side_name || "An unnamed side"
    return [
        `${who} claims ${place}.`,
        `${claimStyle(c).label}${c?.status_note ? ` — ${c.status_note}` : ""}.`,
        c?.radius_km ? `Drawn ${c.radius_km} km around the place (${c.size_basis || c.place_type || "its size"}); a claim is what a report says, never merged into the official line.` : null,
        Array.isArray(c?.sources) && c.sources.length > 1 ? `${c.sources.length} reports.` : null,
    ].filter(Boolean).join(" ")
}

// ── movements ───────────────────────────────────────────────────────────

/** The two barbs of an arrowhead at `to`, pointing from `from`. */
export function arrowHead(from, to, { lenKm = null, spreadDeg = 28 } = {}) {
    const len = lenKm ?? Math.max(0.8, Math.min(6, haversineKm(from, to) * 0.18))
    const back = (bearingDeg(to, from) + 360) % 360
    return [destination(to, (back - spreadDeg + 360) % 360, len), destination(to, (back + spreadDeg) % 360, len)]
}

/** An arrow as polyline parts [[from, to], [barbL, to, barbR]] of {lat, lon}. */
export function movementArrow(m) {
    const f = m?.from, t = m?.to
    if (!f || !t || ![f.lat, f.lon, t.lat, t.lon].every((v) => Number.isFinite(Number(v)))) return null
    const a = { lat: +f.lat, lon: +f.lon }, b = { lat: +t.lat, lon: +t.lon }
    const [l, r] = arrowHead(a, b)
    return [[a, b], [l, b, r]]
}

const ACT_WORD = { control_change: "took ground", assault: "assault", airstrike: "air strike", shelling: "shelling",
                   naval: "naval strike", drone: "drone unit" }
const ACT_PAST = { control_change: "took ground", assault: "fought", shelling: "shelled" }

/*
 * PATHS AND SIEGES (owner, 2026-10-17: "we should follow over the days … when
 * we say they are currently besieging a certain city, then we know they're
 * attacking from all directions"). The backend sends three kinds of arrow:
 *   leg      — one step of a path the same side took over the days (A→B→C),
 *              inferred from two nearby events a few days apart; numbered,
 *              later legs more opaque, the unit's symbol only at the newest
 *              head (where the force is now, as far as we can tell);
 *   approach — a single arrow where no earlier nearby event is known (or the
 *              first step of a path, before its legs);
 *   siege    — one of several arrows converging on a besieged place, from
 *              the side's own nearby fighting or an open approach on land;
 *              open approaches are dashed, since nobody reported them.
 * Every one of them is our reading, and the card says on what.
 */

/** The day of an ISO time, "13 Oct" (UTC), or null. */
export function shortDay(iso) {
    const t = Date.parse(iso || "")
    if (!Number.isFinite(t)) return null
    const d = new Date(t)
    return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`
}

/**
 * How an arrow is drawn: alpha (later legs of a path more opaque), width,
 * dash (an open siege approach), where its APP-6 symbol sits ("head",
 * "tail" or null) and the small words at its head ("2 · 13 Oct") — the
 * joint of a path, so the sequence reads on the map.
 */
export function movementStyle(m) {
    const kind = m?.kind || "approach"
    const legs = Math.max(0, Number(m?.path_legs) || 0)
    const leg = Math.max(0, Number(m?.leg) || 0)
    const day = m?.to_day || shortDay(m?.to_time || m?.time)
    if (kind === "leg") {
        const tip = !!m?.tip
        return { alpha: legs ? 0.4 + 0.6 * (leg / legs) : 1, width: tip ? 3.5 : 2.5, dash: false,
                 symbolAt: tip ? "head" : null, joint: day ? `${leg} · ${day}` : String(leg) }
    }
    if (kind === "siege") {
        const open = m?.basis_kind === "open"
        return { alpha: open ? 0.7 : 0.95, width: open ? 2 : 3, dash: open, symbolAt: "tail", joint: null }
    }
    // the first step of a path: faint, with the day it began
    if (legs > 0) return { alpha: 0.4, width: 2.5, dash: false, symbolAt: null, joint: day ? `0 · ${day}` : null }
    return { alpha: 0.9, width: 3, dash: false, symbolAt: "tail", joint: null }
}

/** Where the arrow's symbol goes, {lat, lon} or null. */
export function movementSymbolPoint(m) {
    const at = movementStyle(m).symbolAt
    const p = at === "head" ? m?.to : at === "tail" ? (m?.from || m?.to) : null
    return p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)) ? { lat: +p.lat, lon: +p.lon } : null
}

/** The words at a besieged place, once per siege (its first arrow), or null. */
export function siegeLabel(m) {
    if (m?.kind !== "siege" || Number(m?.siege_index) !== 0) return null
    const s = m.siege || {}
    return `Besieged · ${s.place || String(m.target_name || "").split(",")[0] || "place"}${s.reported_day ? ` · reported ${s.reported_day}` : ""}`
}

/** The words beside an arrow, {text, at, siege}: a path's joint at its head, a siege's name at the place. */
export function movementLabel(m) {
    const siege = siegeLabel(m)
    if (siege && m.centre) return { text: siege, at: m.centre, siege: true }
    const joint = movementStyle(m).joint
    return joint && m?.to ? { text: joint, at: m.to, siege: false } : null
}

const _gap = (h) => {
    if (h < 24) return `${Math.max(1, Math.round(h))} h`
    const d = Math.round(h / 24 * 10) / 10
    return `${d} day${d === 1 ? "" : "s"}`
}
const _evLine = (e) => `${e.place || "a place"} on ${e.day || shortDay(e.time) || "an unknown day"}`
    + `${e.act ? ` (${ACT_PAST[e.act] || String(e.act).replace("_", " ")})` : ""}`

export function movementSummary(m) {
    const place = m?.target_name ? String(m.target_name).split(",").slice(0, 2).join(",") : "the target"
    const who = m?.actor || m?.side_name || "Unnamed side"
    const side = m?.side_name || m?.actor || "the same side"
    const unit = m?.unit_known ? `Unit: ${m.unit_label || m.unit_type}.` : `Unit not stated (symbol: ${m?.unit_label || "generic unit"}).`
    const kind = m?.kind || "approach"
    if (kind === "leg") {
        const [a, b] = Array.isArray(m.evidence) ? m.evidence : []
        const from = a ? _evLine(a) : (m.from_name || "an earlier place")
        const to = b ? _evLine(b) : place
        const nSrc = new Set([...(a?.sources || []), ...(b?.sources || [])].map((s) => s?.url || s?.title || JSON.stringify(s))).size
        return [
            `${who} · leg ${m.leg}${m.path_legs ? ` of ${m.path_legs}` : ""} → ${place}.`,
            `Inferred, not reported: reports place ${side} at ${from}, then at ${to}`
                + `${Number.isFinite(Number(m.distance_km)) ? `, ${Math.round(m.distance_km)} km` : ""}`
                + `${Number.isFinite(Number(m.gap_hours)) ? ` and ${_gap(Number(m.gap_hours))}` : ""} apart.`,
            "Close enough in place and time for one force, so the arrow assumes it moved from the first place to the second; no source says it did.",
            m.tip ? "The newest step of this path: the symbol marks where the force was last reported." : null,
            unit,
            nSrc ? `${nSrc} source${nSrc > 1 ? "s" : ""}, one or more for each place.` : null,
        ].filter(Boolean).join(" ")
    }
    if (kind === "siege") {
        const s = m.siege || {}
        const blocked = Array.isArray(s.blocked) ? s.blocked : []
        const seaSides = blocked.filter((b) => b.why === "open sea").map((b) => b.compass)
        const held = blocked.filter((b) => b.why !== "open sea").map((b) => b.compass)
        return [
            `${who} · siege of ${s.place || place}.`,
            `A report on ${s.reported_day || shortDay(s.reported) || "a recent day"} says it is besieged${s.quote ? ` ("${s.quote}")` : ""}.`,
            `A siege is fought from every side the ground allows, so the ring is drawn as ${s.approaches || "several"} arrows converging on it.`,
            m.basis_kind === "own_events"
                ? `This one comes from the ${m.compass}, where reports place ${side} in the fighting (${String(m.from_basis || "").replace(/^.*?;\s*(?:from the [a-z-]+,\s*)?/, "")}).`
                : `This one, from the ${m.compass}, is an open approach on land: nobody reported ${side} there, so it is dashed.`,
            seaSides.length ? `None from the ${seaSides.join(", ")}: open sea.` : null,
            held.length ? `None from the ${held.join(", ")}: held by the other side.` : null,
            s.terrain_note ? `Topography: ${s.terrain_note}.` : null,
            "Our reading of where the ring lies, not reported positions.",
        ].filter(Boolean).join(" ")
    }
    return [
        `${who} · ${ACT_WORD[m?.act] || String(m?.act || "").replace("_", " ")} → ${place}.`,
        unit,
        m?.from ? `Arrow drawn ${m.from_basis || "from the actor's side"} — our reading, not the source's.` : "No approach direction known; only the symbol is drawn.",
        m?.path_legs > 0 ? `The first step of a path ${side} took over the following days (${m.path_legs} leg${m.path_legs > 1 ? "s" : ""}).` : null,
    ].filter(Boolean).join(" ")
}

/**
 * A small rounded label as an SVG data URI — a path's joint ("2 · 13 Oct")
 * or a siege's name on the phone map, where a line takes one marker image.
 * System sans, never a typewriter face (owner).
 */
export function pillUri(text, colour = SIDE_COLOURS.unknown, { size = 11 } = {}) {
    const t = String(text || "")
    const w = Math.round(t.length * size * 0.58 + 12), h = Math.round(size + 9)
    const esc = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
        + `<rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="${(h - 1.5) / 2}" fill="#0b1220" fill-opacity="0.82" stroke="${colour}" stroke-width="1.5"/>`
        + `<text x="${w / 2}" y="${h / 2}" dy="0.35em" text-anchor="middle" fill="#f2f4f8" `
        + `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="600">${esc}</text></svg>`
    return { uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width: w, height: h, anchor: [Math.round(w / 2), Math.round(h / 2)] }
}

// ── APP-6 symbols ───────────────────────────────────────────────────────

const _sym = new Map()

/**
 * A 2525C/APP-6 symbol (milsymbol) as an SVG data URI with its size and
 * anchor (the frame's centre, in px). Unknown SIDCs fall back to milsymbol's
 * own "invalid" rendering rather than nothing. Colour: the side's.
 */
export function milSymbol(sidc, { colour = null, size = 22 } = {}) {
    const code = String(sidc || "SUGP-----------").padEnd(15, "-").slice(0, 15)
    const key = `${code}|${colour}|${size}`
    if (_sym.has(key)) return _sym.get(key)
    let out
    try {
        const opts = { size, outlineColor: "#0b1220", outlineWidth: 3 }
        if (colour) opts.fillColor = colour
        const s = new ms.Symbol(code, opts)
        const { width, height } = s.getSize()
        const anchor = s.getAnchor()
        out = {
            uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.asSVG())}`,
            width: Math.round(width), height: Math.round(height),
            anchor: [Math.round(anchor.x), Math.round(anchor.y)], valid: s.isValid(),
        }
    } catch {
        out = { uri: null, width: 0, height: 0, anchor: [0, 0], valid: false }
    }
    _sym.set(key, out)
    return out
}

// ── trajectories ────────────────────────────────────────────────────────

export const TRAJECTORY_KIND = {
    drone:     { label: "Drone",              glyph: "drone",   arc: "low" },
    ballistic: { label: "Ballistic missile",  glyph: "missile", arc: "high" },
    cruise:    { label: "Cruise missile",     glyph: "missile", arc: "low" },
    missile:   { label: "Missile (type not stated)", glyph: "missile", arc: "high" },
}

/**
 * The flown path as [{lat, lon, alt (m), km}], ready for
 * vesselThreat.positionAlong. Drones: low and wandering (100–500 m), as the
 * vessel-of-concern simulation. Missiles: the great circle lifted by
 * apogee·sin(πf) — the backend's apogee is high for a ballistic missile
 * (≈ range/4) and low for a cruise missile.
 */
export function trajectoryPath(t, { samples = 64 } = {}) {
    const f = t?.from, to = t?.to
    if (!f || !to || ![f.lat, f.lon, to.lat, to.lon].every((v) => Number.isFinite(Number(v)))) return []
    const a = { lat: +f.lat, lon: +f.lon }, b = { lat: +to.lat, lon: +to.lon }
    if (t.kind === "drone") return buildFlightPath(a, b, { seed: t.id || "traj", altitude: [100, 500] })
    const apogeeM = Math.max(0, Number(t.apogee_km) || (t.kind === "cruise" ? 5 : 50)) * 1000
    const out = []
    let km = 0
    for (let i = 0; i <= samples; i++) {
        const k = i / samples
        const p = greatCircleAt(a, b, k)
        if (i) km += haversineKm(out[i - 1], p)
        // a cruise missile climbs out and settles at height; a ballistic one arcs
        const lift = t.kind === "cruise" ? Math.min(1, Math.sin(Math.PI * k) * 3) : Math.sin(Math.PI * k)
        out.push({ lat: p.lat, lon: p.lon, alt: Math.max(30, apogeeM * lift), km })
    }
    return out
}

/** Seconds the replay takes on screen: longer flights a little longer, never tedious. */
export function replaySeconds(t) {
    const m = Number(t?.flight_minutes) || 10
    return Math.max(6, Math.min(20, 4 + Math.sqrt(m) * 1.6))
}

export function trajectorySummary(t) {
    const place = t?.target_name ? String(t.target_name).split(",").slice(0, 2).join(",") : "the target"
    const o = t?.from || {}
    return [
        `${t?.kind_label || TRAJECTORY_KIND[t?.kind]?.label || "Strike"}${t?.actor ? ` by ${t.actor}` : ""} → ${place}.`,
        o.name ? `From ${o.name}${o.assumed ? " — ASSUMED origin" : ""}${o.basis ? ` (${String(o.basis).replace(/^assumed origin\s*—\s*/, "")})` : ""}.` : null,
        t?.range_km ? `${Math.round(t.range_km)} km${t.flight_minutes ? `, about ${Math.round(t.flight_minutes)} min at ${t.speed_kmh} km/h` : ""}.` : null,
        o.source ? `Launch area per ${o.source}.` : null,
    ].filter(Boolean).join(" ")
}

/** The three layers' keys, labels and hints — one list for the desktop panel and the phone. */
export const FRONTLINE_LAYERS = [
    { key: "frontlineClaims", label: "Frontline claims",
      hint: "Ground a report says was taken, drawn on top of the official line · hatched: CLAIMED, unverified · solid: confirmed by DeepStateMap · grey: expired after 7 days or contradicted" },
    { key: "movements", label: "Troop movements",
      hint: "Ground forces followed over the days from front-line reports: numbered legs from place to place (later legs brighter), converging arrows round a besieged place, a single arrow where nothing earlier is known · NATO APP-6 symbols · every arrow is our reading, said on the card" },
    { key: "trajectories", label: "Trajectories",
      hint: "Drones and missiles from the launch origin (the report's, or an assumed one, always said so) to the target · ballistic high arc, cruise low arc · a click replays the flight" },
]
