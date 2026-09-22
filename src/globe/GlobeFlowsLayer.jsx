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
const ENERGY_COLOR = Color.fromCssColorString("#B9A6FF")

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
            fetch(`${API_BASE}/api/infrastructure/pipelines`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]).then(([tr, pl]) => {
            if (cancelled) return
            const routes = safeArray(tr?.routes)
            const pipelines = safeArray(pl?.pipelines)
            // The reason the energy half is empty, carried through from
            // the server rather than shown as a zero.
            const note = !pipelines.length && pl?.error
                ? `energy unavailable — ${String(pl.error).slice(0, 60)}`
                : null
            setData({ routes, pipelines, note })
            onStatus?.({
                state: routes.length || pipelines.length ? "ok" : "error",
                text: note
                    ? `${routes.length} trade routes · ${note}`
                    : `${routes.length} trade · ${pipelines.length} energy`,
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
                id, name: r.name || r.id,
                meta: {
                    kind: "Trade route",
                    description: r.description,
                    chokepoints: safeArray(r.chokepoints).join(", ") || undefined,
                    waypoints: safeArray(r.coordinates).length,
                    geometry_caveat:
                        "SCHEMATIC. A real route is a corridor tens of kilometres "
                        + "wide that each ship chooses its own line through; this is "
                        + "a handful of waypoints along it, drawn for direction and "
                        + "context rather than as a surveyed track.",
                },
            })
            ids.push(id)
        }
        return () => ids.forEach(deleteEntity)
    }, [enabled, data.routes])

    if (!enabled) return null

    return (
        <>
            {data.routes.map((r) => {
                const positions = routePositions(r?.coordinates)
                if (positions.length < 2 || !r?.id) return null
                const mid = midpointOf(r.coordinates)
                return (
                    <Entity
                        key={`trade-${r.id}`}
                        id={`flow-trade-${r.id}`}
                        name={r.name || r.id}
                        position={mid ? Cartesian3.fromDegrees(mid.lon, mid.lat) : undefined}
                        polyline={{
                            positions,
                            width: 2,
                            clampToGround: true,
                            // Dashed, because the line is schematic. A solid
                            // line reads as a surveyed track.
                            material: new PolylineDashMaterialProperty({
                                color: TRADE_COLOR.withAlpha(0.85),
                                dashLength: 18,
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
                return (
                    <Entity
                        key={`energy-${p.id || i}`}
                        id={`flow-energy-${p.id || i}`}
                        name={p.name || "Pipeline"}
                        polyline={{
                            positions, width: 2, clampToGround: true,
                            material: ENERGY_COLOR.withAlpha(0.85),
                        }}
                    />
                )
            })}
        </>
    )
}
