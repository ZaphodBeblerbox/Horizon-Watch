/**
 * GlobeAoisLayer.jsx — the watched areas on the desktop globe, with the
 * ones where something was just found drawn so they cannot be missed.
 *
 * The "Areas of interest" toggle in Situation's context layers existed but
 * nothing drew it. Owner, 2026-10-11: "we should have some kind of
 * indicator where something was detected". Every watch zone is a thin
 * outline; a zone whose latest scans found something new (backend
 * zone_change.py → `findings.fresh` on /api/imagery/aois) is a thicker
 * outline with the one count badge (ringed urgent) and what was found as its label.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, HeightReference,
         LabelStyle, VerticalOrigin } from "cesium"
import { OURS, EDGE, SIZE, markerIcon } from "../lib/mapIcons.js"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"

// THE ONE TYPOLOGY (lib/mapIcons.js): a zone is ours, so its outline is our blue; a fresh finding is the one
// badge (the count, ringed urgent) at a constant size, never a red pulsing outline
const PLAIN = Color.fromCssColorString(OURS.blue)

/** [lon, lat] ring of a zone: its polygon, else its bbox. */
export function zoneRing(z) {
    const g = z?.polygon_geojson?.type ? z.polygon_geojson : z?.polygon_geojson?.geometry
    const ring = g?.type === "Polygon" ? g.coordinates?.[0] : g?.type === "MultiPolygon" ? g.coordinates?.[0]?.[0] : null
    if (Array.isArray(ring) && ring.length >= 4 && ring.every((p) => Number.isFinite(+p[0]) && Number.isFinite(+p[1]))) {
        return ring.map((p) => [+p[0], +p[1]])
    }
    const b = z?.bbox || {}
    if (![b.min_lon, b.min_lat, b.max_lon, b.max_lat].every((v) => Number.isFinite(+v))) return null
    return [[b.min_lon, b.min_lat], [b.max_lon, b.min_lat], [b.max_lon, b.max_lat], [b.min_lon, b.max_lat], [b.min_lon, b.min_lat]]
}

/** What the map draws for a zone: plain or fresh, with a label for fresh ones. */
export function aoiStyle(z) {
    const f = z?.findings?.fresh
    const fresh = Boolean(f && typeof f === "object")
    const n = fresh ? Number(f.count) || 0 : 0
    return {
        fresh,
        label: fresh ? `${n > 0 ? `${n} · ` : ""}${z.name || z.system_id}${f.text ? ` — ${f.text}` : ""}` : null,
    }
}

export default function GlobeAoisLayer({ enabled = false }) {
    const [zones, setZones] = useState([])
    useEffect(() => {
        if (!enabled) { setZones([]); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}/api/imagery/aois`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d) setZones(safeArray(d).filter((z) => z.status !== "proposed" && z.aoi_class !== "sweep" && z.aoi_class !== "sweep_plan")) })
            .catch(() => {})
        load()
        const iv = setInterval(load, 60_000)
        return () => { live = false; clearInterval(iv) }
    }, [enabled])

    if (!enabled || !zones.length) return null
    return (
        <>
            {zones.map((z) => {
                const ring = zoneRing(z)
                if (!ring) return null
                const st = aoiStyle(z)
                const pos = Cartesian3.fromDegreesArray(ring.flat())
                const b = z.bbox || {}
                const centre = Number.isFinite(+b.min_lat)
                    ? Cartesian3.fromDegrees((+b.min_lon + +b.max_lon) / 2, +b.max_lat, 0) : null
                return [
                    <Entity key={`aoi-${z.system_id}`} id={`aoi-${z.system_id}`} name={z.name}
                        description={st.label || z.name}
                        polyline={{ positions: pos, width: st.fresh ? 3 : 1.4, clampToGround: true,
                                    material: PLAIN.withAlpha(st.fresh || z.status === "active" ? 0.9 : 0.45) }} />,
                    st.fresh && centre ? (
                        <Entity key={`aoi-l-${z.system_id}`} id={`aoi-l-${z.system_id}`} position={centre}
                            billboard={{ image: markerIcon({ kind: "confirmed", glyph: "detection", priority: "urgent" }).uri, width: SIZE.event, height: SIZE.event,
                                         heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 1e7 }}
                            label={{ text: st.label.length > 70 ? `${st.label.slice(0, 69)}…` : st.label,
                                     font: "600 13px system-ui, -apple-system, sans-serif",
                                     fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
                                     style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM,
                                     pixelOffset: new Cartesian2(0, -(SIZE.event / 2 + 4)), showBackground: true,
                                     backgroundColor: Color.fromCssColorString(EDGE).withAlpha(0.85), backgroundPadding: new Cartesian2(7, 4),
                                     distanceDisplayCondition: new DistanceDisplayCondition(0, 6_000_000) }} />
                    ) : null,
                ]
            })}
        </>
    )
}
