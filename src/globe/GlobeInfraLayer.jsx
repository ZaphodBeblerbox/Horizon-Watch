/**
 * GlobeInfraLayer.jsx — the world's infrastructure, as things you can click.
 *
 * Replaces the OpenInfraMap raster (a picture of the grid with nothing
 * behind it). The objects come from OpenInfraMap's vector tiles through
 * /api/infra/features (backend/infra_features.py): power plants, substations,
 * wind turbines, lines and cables, telecom masts, data centres, pipelines,
 * wells and oil sites. A click opens the object in the inspector, which
 * reads everything known about it (InfraDetail).
 *
 * LEVEL OF DETAIL follows the camera: from orbit, the 380 kV grid and the
 * big plants; over a country, 220 kV and the transmission pipelines; over a
 * town, every substation, mast and turbine, with names. The backend picks
 * what each zoom deserves; this asks again when the view has moved.
 *
 * Primitives, not Entities: a country view is thousands of lines, which
 * Entities draw at a crawl. Colours are OpenInfraMap's own, so anyone who
 * knows that map reads this one.
 */
import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import {
    BillboardCollection, PolylineCollection, LabelCollection, Cartesian3, Cartesian2, Color, Material,
    VerticalOrigin, HorizontalOrigin, LabelStyle, DistanceDisplayCondition, Math as CesiumMath,
} from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { infraIcon, SIZE } from "../lib/mapIcons.js"

/** OpenInfraMap's voltage scale. */
export function voltageColor(kv) {
    const v = Number(kv) || 0
    if (v >= 550) return "#4A6CF5"
    if (v >= 330) return "#00C1CF"
    if (v >= 220) return "#B54EB2"
    if (v >= 132) return "#C73030"
    if (v >= 52) return "#B55D00"
    if (v >= 25) return "#B59F10"
    if (v >= 10) return "#55B555"
    return "#8A8A95"
}
const PIPE = { gas: "#BFBC6B", oil: "#6B583F", fuel: "#7C6040", water: "#7B7CBA", hot_water: "#B07CC0", steam: "#C0A0D0" }
export function lineStyle(f) {
    const p = f.props || {}
    if (f.kind === "power_line" || f.kind === "power_cable") {
        const v = Number(p.voltage) || 0
        return { color: voltageColor(v), width: v >= 380 ? 2.6 : v >= 220 ? 2.2 : v >= 100 ? 1.8 : 1.3, dashed: f.kind === "power_cable" }
    }
    if (f.kind === "pipeline" || f.kind === "water_pipeline") {
        return { color: PIPE[p.substance] || (f.kind === "water_pipeline" ? PIPE.water : "#A08A60"), width: 2, dashed: p.location === "underground" }
    }
    if (f.kind === "telecom_line") return { color: "#61B37A", width: 1.4, dashed: true }
    return { color: "#999999", width: 1.2, dashed: false }
}

// THE ONE TYPOLOGY (lib/mapIcons.js): a plant, a substation, a turbine, a mast, a data centre, a well, a petroleum
// site are infrastructure context, a line glyph with no fill, neutral, 18 px whatever the plant's size or voltage;
// voltage and fuel colours stay on the LINES only (owner, 2026-10-23).
const iconFor = (f) => infraIcon({ glyph: f.kind in GLYPH ? f.kind : "power_plant" }).uri
const GLYPH = { power_plant: 1, substation: 1, wind_turbine: 1, telecom_mast: 1, data_center: 1, well: 1, petroleum_site: 1 }

/** Zoom level the backend thinks in, from the camera's height above the ground. */
export function zoomForHeight(h) {
    return Math.max(2, Math.min(15, Math.round(Math.log2(4e7 / Math.max(50, h)))))
}

export default function GlobeInfraLayer({ enabled = false }) {
    const { viewer } = useCesium()
    const prims = useRef(null)
    const ids = useRef([])
    const lastKey = useRef("")

    useEffect(() => {
        if (!enabled || !viewer) return undefined
        const scene = viewer.scene
        const lines = scene.primitives.add(new PolylineCollection())
        const points = scene.primitives.add(new BillboardCollection({ scene }))
        const labels = scene.primitives.add(new LabelCollection({ scene }))
        prims.current = { lines, points, labels }
        let live = true
        let ticket = 0
        // A material per line, never shared: Cesium destroys a polyline's
        // material with the polyline, so a shared one is destroyed by the
        // first line removed and every other line then breaks the render
        // ("reading 'type'"). Lines of one colour still batch together.
        const colors = new Map()
        const mat = (color, dashed) => {
            if (!colors.has(color)) colors.set(color, Color.fromCssColorString(color).withAlpha(0.92))
            const c = colors.get(color)
            return dashed ? Material.fromType("PolylineDash", { color: c, dashLength: 12 }) : Material.fromType("Color", { color: c })
        }

        const draw = (feats, zoom) => {
            lines.removeAll(); points.removeAll(); labels.removeAll()
            for (const id of ids.current) deleteEntity(id)
            ids.current = []
            for (const f of feats) {
                const pickId = { id: f.id, position: { getValue: () => Cartesian3.fromDegrees(f.lon, f.lat) } }
                setEntity(f.id, "infra_feature", f)
                ids.current.push(f.id)
                if (f.line) {
                    const st = lineStyle(f)
                    for (const seg of f.line) {
                        // consecutive duplicates (rounding, thinning) make a
                        // zero-length piece, which stops Cesium's renderer
                        const pts = seg.filter((q, i) => i === 0 || q[0] !== seg[i - 1][0] || q[1] !== seg[i - 1][1])
                        if (pts.length < 2) continue
                        lines.add({ positions: Cartesian3.fromDegreesArray(pts.flat()), width: st.width, material: mat(st.color, st.dashed), id: pickId })
                    }
                } else {
                    points.add({ position: Cartesian3.fromDegrees(f.lon, f.lat), image: iconFor(f), width: SIZE.infra,
                                 height: SIZE.infra, id: pickId,
                                 disableDepthTestDistance: 5e4 })
                    if (zoom >= 11 && f.props?.name && (f.kind === "power_plant" || f.kind === "substation" || f.kind === "data_center" || f.kind === "petroleum_site")) {
                        labels.add({ position: Cartesian3.fromDegrees(f.lon, f.lat), text: String(f.title).slice(0, 40), font: "600 12px sans-serif",
                                     fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
                                     verticalOrigin: VerticalOrigin.TOP, horizontalOrigin: HorizontalOrigin.CENTER, pixelOffset: new Cartesian2(0, 14),
                                     distanceDisplayCondition: new DistanceDisplayCondition(0, 60_000), id: pickId })
                    }
                }
            }
            scene.requestRender()
        }

        const refresh = () => {
            if (!live || viewer.isDestroyed()) return
            const rect = viewer.camera.computeViewRectangle(scene.globe.ellipsoid)
            const h = viewer.camera.positionCartographic?.height || 1e7
            if (!rect) return
            const zoom = zoomForHeight(h)
            const deg = (r) => CesiumMath.toDegrees(r)
            const [w, s, e, n] = [deg(rect.west), deg(rect.south), deg(rect.east), deg(rect.north)]
            // ask again only when the view has really changed: a new zoom, or moved by a fifth of its width
            const span = Math.max(0.01, Math.abs(e - w))
            const key = `${zoom}|${Math.round(w / (span / 5))}|${Math.round(n / (span / 5))}`
            if (key === lastKey.current) return
            lastKey.current = key
            const t = ++ticket
            fetch(`${API_BASE}/api/infra/features?west=${w.toFixed(4)}&south=${s.toFixed(4)}&east=${e.toFixed(4)}&north=${n.toFixed(4)}&zoom=${zoom}`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (live && d && t === ticket) draw(d.features || [], zoom) })
                .catch(() => {})
        }
        // The viewer renders on demand, so moveEnd is not reliable (GlobeView
        // says why); a cheap poll of the view rectangle is.
        refresh()
        const iv = setInterval(refresh, 1200)
        return () => {
            live = false
            clearInterval(iv)
            for (const id of ids.current) deleteEntity(id)
            ids.current = []
            lastKey.current = ""
            if (!viewer.isDestroyed()) {
                scene.primitives.remove(lines); scene.primitives.remove(points); scene.primitives.remove(labels)
                scene.requestRender()
            }
            prims.current = null
        }
    }, [enabled, viewer])

    return null
}
