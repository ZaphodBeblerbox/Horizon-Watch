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
    VerticalOrigin, HorizontalOrigin, LabelStyle, DistanceDisplayCondition, NearFarScalar, Math as CesiumMath,
} from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"

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

const SOURCE_COLOR = { nuclear: "#E5D33A", coal: "#8B7B6B", gas: "#E58A3A", oil: "#9A6A40", wind: "#4FB4E8",
                       solar: "#F2C230", hydro: "#3A7FE5", biomass: "#5FA05A", waste: "#8F8F6A", battery: "#B0B0FF" }
const GLYPH = {
    power_plant: "M13 2 5 13h6l-1 9 8-11h-6z",
    substation: "M4 6h16v12H4zM8 6v12M16 6v12M4 12h16",
    wind_turbine: "M12 12 12 3M12 12l7.5 4.5M12 12l-7.5 4.5M12 12v10",
    telecom_mast: "M12 4v18M8 22l4-10 4 10M7 7a7 7 0 0 1 10 0M5 4.5a10 10 0 0 1 14 0",
    data_center: "M5 4h14v5H5zM5 10h14v5H5zM5 16h14v4H5zM8 6.5h.01M8 12.5h.01",
    well: "M4 20h16M7 20l5-12 5 12M5 9l14-4M12 8v-4",
    petroleum_site: "M4 20V10a4 4 0 0 1 8 0v10M12 20v-7a4 4 0 0 1 8 0v7M3 20h18",
}
const _icons = new Map()
function iconFor(f) {
    const p = f.props || {}
    const fill = f.kind === "power_plant" ? (SOURCE_COLOR[p.source] || "#E58A3A")
        : f.kind === "substation" ? voltageColor(p.voltage)
        : f.kind === "wind_turbine" ? SOURCE_COLOR.wind
        : f.kind === "telecom_mast" || f.kind === "data_center" ? "#61B37A"
        : "#B08850"
    const key = `${f.kind}|${fill}`
    if (_icons.has(key)) return _icons.get(key)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="17" fill="#0b1220" stroke="${fill}" stroke-width="3"/>
      <g transform="translate(8 8)" fill="none" stroke="${fill}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${GLYPH[f.kind] || GLYPH.power_plant}"/></g>
    </svg>`
    const uri = `data:image/svg+xml;base64,${btoa(svg)}`
    _icons.set(key, uri)
    return uri
}
const POINT_SIZE = { power_plant: 26, substation: 18, wind_turbine: 16, telecom_mast: 16, data_center: 20, well: 15, petroleum_site: 20 }

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
                    points.add({ position: Cartesian3.fromDegrees(f.lon, f.lat), image: iconFor(f), width: POINT_SIZE[f.kind] || 16,
                                 height: POINT_SIZE[f.kind] || 16, id: pickId, scaleByDistance: new NearFarScalar(5e3, 1.25, 2e6, 0.6),
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
