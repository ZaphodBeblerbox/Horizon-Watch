/**
 * GlobeFlowsLayer.jsx — trade and energy flows.
 *
 * THE TOGGLE EXISTED AND DID NOTHING. "Trade & energy flows" has been
 * sitting in the Context layers list, switchable, wired to a piece of
 * state that was never passed to the globe at all. Meanwhile
 * /api/infrastructure/shipping-routes has been serving eleven real named
 * routes — Hormuz to the Indian Ocean, Suez to the Mediterranean and so
 * on — each with a real polyline and the chokepoints it passes through.
 *
 * ENERGY IS HONEST ABOUT BEING MISSING. The pipelines endpoint answers
 * {"pipelines": [], "error": "HTTP Error 404"} — its Global Energy
 * Monitor source moved and the ingest has been failing silently since
 * March. A toggle called "trade AND energy" that quietly shows only
 * trade is worse than one that says which half is unavailable, so the
 * layer reports both counts and the reason.
 *
 * NOT A VIDEO GAME. These are drawn as plain clamped lines, one weight,
 * one colour per kind, with the route named at its midpoint. No animated
 * particles, no glowing pulses. A route is a statement about where
 * traffic habitually goes — it is context, and context that draws
 * attention to itself is a bug.
 *
 * AND THE LINES ARE SCHEMATIC. A real route is a corridor tens of
 * kilometres wide that ships choose individually; this is a handful of
 * waypoints through it. The inspector says so, because a crisp line
 * looks like a survey and is not one.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, PolylineDashMaterialProperty,
         DistanceDisplayCondition, Cartesian2, NearFarScalar } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { coord, safeCartesian } from "./markerOrientation.js"

const TRADE_COLOR = Color.fromCssColorString("#8E9BAA")
// Amber rather than red: a corridor with something on it is worth looking
// at, not an emergency. Red here would compete with the severity marks that
// really do mean one.
const DISRUPTED_COLOR = Color.fromCssColorString("#b7822c")
const ENERGY_COLOR = Color.fromCssColorString("#B9A6FF")
// By what they carry, so a line says what it is before it is clicked.
// Neither is red or amber, which mean severity on this map.
export const GAS_CSS = "#2BB3A3"
export const OIL_CSS = "#9B6B3D"
const GAS_COLOR = Color.fromCssColorString(GAS_CSS)
const OIL_COLOR = Color.fromCssColorString(OIL_CSS)

/**
 * Waypoints to Cartesians, dropping anything unusable.
 *
 * Uses coord() rather than Number() because Number(null) is 0 and
 * Number("") is 0 — a route with a missing longitude would otherwise
 * draw a leg through the Gulf of Guinea. That is the Null Island bug
 * this codebase has already been bitten by twice, in the marker
 * positions and again in vessel headings.
 */
export function routePositions(coords) {
    const out = []
    for (const pair of safeArray(coords)) {
        const p = safeCartesian(pair?.[0], pair?.[1], 0)
        if (p) out.push(p)
    }
    return out
}

/** The label anchor: the middle waypoint, not the first. */
export function midpointOf(coords) {
    const pts = safeArray(coords).filter(
        (p) => coord(p?.[0]) !== null && coord(p?.[1]) !== null)
    if (!pts.length) return null
    const m = pts[Math.floor(pts.length / 2)]
    return { lon: Number(m[0]), lat: Number(m[1]) }
}

export default function GlobeFlowsLayer({ enabled = false, onStatus = null }) {
    const [data, setData] = useState({ routes: [], pipelines: [], note: null })

    useEffect(() => {
        if (!enabled) { onStatus?.(null); return }
        let cancelled = false
        onStatus?.({ state: "loading", text: "loading…" })

        Promise.all([
            fetch(`${API_BASE}/api/infrastructure/shipping-routes`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null)).catch(() => null),
            // OSM, not GEM. The GOPIT dataset this used to read was
            // withdrawn — repository and files both 404 — so the energy half
            // of this layer had been empty since March while the layer went
            // on calling itself "Trade & energy flows".
            fetch(`${API_BASE}/api/infrastructure/pipelines-osm`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null)).catch(() => null),
            // What is actually happening on the corridors, so a disrupted
            // one can be drawn as disrupted rather than as a line.
            fetch(`${API_BASE}/api/flows/status`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]).then(([tr, pl, st]) => {
            if (cancelled) return
            const routes = safeArray(tr?.routes)
            const pipelines = safeArray(pl?.pipelines)
            const status = {}
            for (const r of safeArray(st?.routes)) status[r.id] = r
            const pending = safeArray(pl?.regions_pending).length
            const note = !pipelines.length && pending
                ? `energy still loading — ${pending} region(s) pending`
                : null
            setData({ routes, pipelines, status, note })
            const disrupted = safeArray(st?.routes).filter((r) => r.disrupted).length
            onStatus?.({
                state: routes.length || pipelines.length ? "ok" : "error",
                text: note
                    ? `${routes.length} trade routes · ${note}`
                    : `${routes.length} trade · ${pipelines.length} energy`
                      + (disrupted ? ` · ${disrupted} disrupted` : ""),
            })
        })

        return () => { cancelled = true }
    }, [enabled])

    // Inspector records, so a flow can be clicked like anything else.
    useEffect(() => {
        const ids = []
        if (!enabled) return
        for (const r of data.routes) {
            if (!r?.id) continue
            const id = `flow-trade-${r.id}`
            setEntity(id, "trade_route", {
                id, name: r.name || r.id, route_id: r.id, chokepoint_ids: safeArray(r.chokepoints),
                description: r.description,
                meta: {
                    kind: "Trade route",
                    description: r.description,
                    chokepoints: safeArray(r.chokepoints).join(", ") || undefined,
                    waypoints: safeArray(r.coordinates).length,
                    // What is on it right now, so a click answers the
                    // question the corridor exists to raise.
                    vessels_now: data.status?.[r.id]?.traffic?.vessels,
                    usually: data.status?.[r.id]?.traffic?.baseline ?? undefined,
                    incidents: data.status?.[r.id]?.incidents?.count,
                    disrupted_because: (data.status?.[r.id]?.why || []).join("; ") || undefined,
                    // The line follows the Eurostat MARNET sea-lane network
                    // between the route's own waypoints (verified off land),
                    // but a route is still a corridor, not one track.
                    geometry_caveat:
                        "Follows the sea-lane network between the route's waypoints. "
                        + "A real route is a corridor tens of kilometres wide; ships "
                        + "choose their own line through it.",
                },
            })
            ids.push(id)
        }
        return () => ids.forEach(deleteEntity)
    }, [enabled, data.routes])

    // Pipelines are records too: name, what it carries, who runs it.
    useEffect(() => {
        if (!enabled) return undefined
        const ids = []
        data.pipelines.forEach((p, i) => {
            const id = `flow-energy-${p.id || i}`
            setEntity(id, "pipeline", {
                id, name: p.name || "Pipeline", substance: p.substance, operator: p.operator,
                diameter: p.diameter, length_km: p.length_km, status: p.status, region: p.region,
                osm_id: p.id, coordinates: p.coordinates,
            })
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [enabled, data.pipelines])

    if (!enabled) return null

    return (
        <>
            {data.routes.map((r) => {
                const positions = routePositions(r?.coordinates)
                if (positions.length < 2 || !r?.id) return null
                const mid = midpointOf(r.coordinates)
                const st = data.status?.[r.id]
                return (
                    <Entity
                        key={`trade-${r.id}`}
                        id={`flow-trade-${r.id}`}
                        name={r.name || r.id}
                        position={mid ? Cartesian3.fromDegrees(mid.lon, mid.lat) : undefined}
                        polyline={{
                            positions,
                            // A DISRUPTED CORRIDOR HAS TO LOOK DIFFERENT, not
                            // just read differently in a panel. Thicker and
                            // warm, with a shorter dash so the line reads as
                            // broken rather than merely schematic — the same
                            // corridor, visibly not behaving.
                            width: st?.disrupted ? 3.5 : 2,
                            clampToGround: true,
                            // Dashed, because the line is schematic. A solid
                            // line reads as a surveyed track.
                            material: new PolylineDashMaterialProperty({
                                color: (st?.disrupted ? DISRUPTED_COLOR : TRADE_COLOR)
                                    .withAlpha(st?.disrupted ? 0.95 : 0.85),
                                dashLength: st?.disrupted ? 8 : 18,
                            }),
                        }}
                        label={mid ? {
                            text: r.name || r.id,
                            font: "11px Arial",
                            fillColor: Color.fromCssColorString("#E8ECF1"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style: 2,
                            pixelOffset: new Cartesian2(0, -10),
                            scaleByDistance: new NearFarScalar(500_000, 1.0, 20_000_000, 0.55),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 30_000_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.72),
                        } : undefined}
                    />
                )
            })}

            {data.pipelines.map((p, i) => {
                const positions = routePositions(p?.coordinates)
                if (positions.length < 2) return null
                const color = p.substance === "oil" ? OIL_COLOR : p.substance === "gas" ? GAS_COLOR : ENERGY_COLOR
                // Named at the middle when long enough to matter and only
                // once zoomed in, so a continent of pipelines is not a
                // continent of labels.
                const mid = (p.length_km || 0) >= 300 ? midpointOf(p.coordinates) : null
                return (
                    <Entity
                        key={`energy-${p.id || i}`}
                        id={`flow-energy-${p.id || i}`}
                        name={p.name || "Pipeline"}
                        position={mid ? Cartesian3.fromDegrees(mid.lon, mid.lat) : undefined}
                        polyline={{
                            positions, width: 2, clampToGround: true,
                            material: color.withAlpha(0.85),
                        }}
                        label={mid ? {
                            text: `${p.name}${p.substance ? ` · ${p.substance}` : ""}`,
                            font: "10.5px Arial",
                            fillColor: color.brighten(0.4, new Color()),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2, style: 2,
                            pixelOffset: new Cartesian2(0, -8),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 2_500_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.65),
                        } : undefined}
                    />
                )
            })}
        </>
    )
}
