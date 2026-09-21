/**
 * GlobeAirspaceLayer.jsx — controlled airspace as actual volumes.
 *
 * A floor and a ceiling, extruded, because that is what airspace is.
 * Drawn flat it would be indistinguishable from a zone or a region, and
 * the whole point of it is the vertical.
 *
 * THE FLOOR REFERENCE IS HONOURED, NOT AVERAGED. A limit published as
 * feet above GROUND is drawn relative to the terrain; one published
 * above sea level or as a flight level is drawn as an absolute height.
 * Mixing those up puts a control zone through a mountain.
 *
 * AND A FLIGHT LEVEL IS NOT A HEIGHT. It is a pressure altitude, so a
 * volume built from one sits where this code draws it only on a
 * standard day. Those volumes are marked in the inspector rather than
 * quietly drawn as though surveyed. It is still the right comparison
 * against an aircraft, whose ADS-B altitude is also pressure-based.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Color, PolygonHierarchy, HeightReference,
    DistanceDisplayCondition,
} from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"

/**
 * Above this the layer does not draw.
 *
 * Airspace is dense — 31 volumes over one German state — and at
 * continental zoom it is a wash of overlapping boxes that hides the
 * map. It earns its place close in.
 */
const MAX_SPAN_DEG = 14

/** ICAO classes A–G. Controlled airspace reads blue; the rest grey. */
const CLASS_COLOR = {
    A: "#4C8DFF", B: "#4C8DFF", C: "#5AC8FA", D: "#5AC8FA",
    E: "#7FD1AE", F: "#B9A6FF", G: "#B9A6FF",
    unclassified: "#8E9BAA",
}

export default function GlobeAirspaceLayer({ enabled = false, viewBounds = null,
                                            onStatus = null }) {
    const [data, setData] = useState(null)

    const span = viewBounds
        ? Math.max(viewBounds.north - viewBounds.south, viewBounds.east - viewBounds.west)
        : 999

    // THE LAYER HAS TO SAY WHICH SILENCE THIS IS. Four different
    // conditions drew exactly nothing and looked identical from the
    // outside: the toggle is off, the camera is too high, the request
    // is in flight, and the server has no openAIP key. The last one is
    // how this looked in production for a week — the key lives in a
    // gitignored .env, so a deploy without it answers
    // {available:false} forever and the panel just sat there.
    useEffect(() => {
        if (!enabled) { setData(null); onStatus?.(null); return }
        if (!viewBounds || span > MAX_SPAN_DEG) {
            setData(null)
            onStatus?.({ state: "zoom", text: "zoom in to draw" })
            return
        }
        let cancelled = false
        const q = `west=${viewBounds.west.toFixed(2)}&south=${viewBounds.south.toFixed(2)}`
                + `&east=${viewBounds.east.toFixed(2)}&north=${viewBounds.north.toFixed(2)}`
        onStatus?.({ state: "loading", text: "loading…" })
        // Debounced: a pan is one request at the end of it, and openAIP
        // rate-limits hard enough that a second call seconds after the
        // first comes back 429.
        const t = setTimeout(() => {
            fetch(`${API_BASE}/api/airspace?${q}&limit=400`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => {
                    if (cancelled) return
                    if (!d) { onStatus?.({ state: "error", text: "unavailable" }); return }
                    if (!d.available) {
                        // The server already says WHY. Passing it through
                        // is the difference between "zoom in" and "set
                        // OPENAIP_KEY on the server".
                        const why = String(d.error || "unavailable")
                        onStatus?.({
                            state: "error",
                            text: why.includes("OPENAIP_KEY") ? "no API key on server" : why,
                        })
                        return
                    }
                    setData(d)
                    const n = safeArray(d.airspaces).length
                    onStatus?.({ state: "ok", text: n ? `${n} in view` : "none here" })
                })
                .catch(() => { if (!cancelled) onStatus?.({ state: "error", text: "unavailable" }) })
        }, 500)
        return () => { cancelled = true; clearTimeout(t) }
    }, [enabled, span, viewBounds?.west, viewBounds?.south, viewBounds?.east, viewBounds?.north])

    useEffect(() => {
        const ids = []
        for (const a of safeArray(data?.airspaces)) {
            if (!a?.id) continue
            const id = `airspace-${a.id}`
            setEntity(id, "airspace", {
                id,
                name: a.name || `Airspace ${a.icao_class}`,
                meta: {
                    icao_class: a.icao_class,
                    floor: a.floor_label,
                    ceiling: a.ceiling_label,
                    country: a.country,
                    activated_by_notam: a.by_notam || undefined,
                    // Said plainly, and only where it applies.
                    vertical_basis: a.pressure_based
                        ? "A limit here is a FLIGHT LEVEL — a pressure altitude, so this "
                          + "volume is approximate by tens of metres and moves with the weather."
                        : "Limits are referenced to ground or sea level.",
                    source: data.source,
                    source_url: data.source_url,
                },
            })
            ids.push(id)
        }
        return () => ids.forEach(deleteEntity)
    }, [data])

    if (!enabled || !data) return null

    return (
        <>
            {safeArray(data.airspaces).map((a) => {
                const ring = safeArray(a.ring)
                if (ring.length < 4 || !a.id) return null
                const positions = []
                for (const pair of ring) {
                    const lon = Number(pair?.[0]), lat = Number(pair?.[1])
                    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
                    positions.push(Cartesian3.fromDegrees(lon, lat))
                }
                if (positions.length < 3) return null

                const colour = Color.fromCssColorString(
                    CLASS_COLOR[a.icao_class] || CLASS_COLOR.unclassified)
                // A floor given above ground follows the terrain; one
                // given above sea level or as a flight level does not.
                const ref = a.floor_ref === "GND"
                    ? HeightReference.RELATIVE_TO_GROUND : HeightReference.NONE

                return (
                    <Entity
                        key={`airspace-${a.id}`}
                        id={`airspace-${a.id}`}
                        name={a.name || `Airspace ${a.icao_class}`}
                        polygon={{
                            hierarchy: new PolygonHierarchy(positions),
                            height: a.floor_m,
                            heightReference: ref,
                            extrudedHeight: a.ceiling_m,
                            extrudedHeightReference: ref,
                            material: colour.withAlpha(0.10),
                            outline: true,
                            outlineColor: colour.withAlpha(0.55),
                            outlineWidth: 1,
                            distanceDisplayCondition:
                                new DistanceDisplayCondition(0, 2_000_000),
                        }}
                    />
                )
            })}
        </>
    )
}
