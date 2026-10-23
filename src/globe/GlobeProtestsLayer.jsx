/**
 * GlobeProtestsLayer.jsx — the PROTESTS layer on the globe (owner, 2026-10-23: "on the desktop version I can't
 * actually toggle the protest movements at all. Protests should be an actual layer"). The same items, icons,
 * frames and cards as the phone (mobile/mapLayers.js loadProtests, lib/protests.js).
 *
 *   data    GET /api/protests?frame=live|today|upcoming (backend/protests.py); every 15 s while something is
 *           live in the user's areas, 60 s otherwise (globe/demoLive.js cadence); not while the page is hidden
 *   marks   one badge per item at a constant ICON_PX; the crowd's and the police's movement as a path under
 *           its badge (amber crowd, dashed blue police) with the heading on the badge's edge
 *   fit     the shared screen-space collision pass (lib/liveSignals.js declutterAll): touching badges become
 *           one count marker that opens a list; recomputed as the camera moves
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Entity, useCesium } from "resium"
import { Cartesian3, Color, SceneTransforms, HeightReference, PolylineDashMaterialProperty } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { clusterIconUri, clusterSize, declutterAll, onNearSide } from "../lib/liveSignals.js"
import { PROTESTS_PATH, ICON_PX, getFrame, subscribeFrame, setMeta, protestBadge, inspectorData, cardOf, refreshMs, TRACK_COLOR } from "../lib/protests.js"
import { markLive } from "./demoLive.js"

const SIZE = ICON_PX

export default function GlobeProtestsLayer({ enabled = false }) {
    const [frame, setFrameState] = useState(getFrame)
    useEffect(() => subscribeFrame(setFrameState), [])
    const [items, setItems] = useState([])
    const [layout, setLayout] = useState([])
    const cesium = useCesium()
    const itemsRef = useRef([])

    useEffect(() => {
        if (!enabled) { setItems([]); return undefined }
        let live = true, timer = 0
        const load = () => {
            if (typeof document !== "undefined" && document.hidden) { timer = setTimeout(load, 5_000); return }
            fetch(`${API_BASE}${PROTESTS_PATH}?frame=${frame}`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => {
                    if (!live) return
                    if (d) {
                        setItems(safeArray(d.items).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)))
                        setMeta({ counts: d.counts || null, note: d.note || null, any_live: !!d.any_live, frame, items: safeArray(d.items).length })
                        if (d.any_live) markLive()
                    }
                    timer = setTimeout(load, refreshMs(d))
                })
                .catch(() => { if (live) timer = setTimeout(load, 30_000) })   // a dropped poll is not an empty world
        }
        load()
        const onVis = () => { if (!document.hidden) { clearTimeout(timer); load() } }
        document.addEventListener?.("visibilitychange", onVis)
        return () => { live = false; clearTimeout(timer); document.removeEventListener?.("visibilitychange", onVis) }
    }, [enabled, frame])
    itemsRef.current = items

    useEffect(() => {
        const viewer = cesium?.viewer
        const scene = viewer?.scene
        if (!enabled || !scene || scene.isDestroyed?.()) { setLayout([]); return undefined }
        if (typeof window !== "undefined") window.__plxProtestViewer = viewer
        const compute = () => {
            if (scene.isDestroyed?.()) return
            const cam = scene.camera.positionWC
            const pts = []
            for (const it of itemsRef.current) {
                const p = Cartesian3.fromDegrees(it.lon, it.lat, 0)
                if (!onNearSide(p, cam)) continue
                const w = SceneTransforms.worldToWindowCoordinates(scene, p)
                if (!w || w.x < -SIZE || w.y < -SIZE || w.x > scene.canvas.clientWidth + SIZE || w.y > scene.canvas.clientHeight + SIZE) continue
                pts.push({ id: it.id, x: w.x, y: w.y, size: SIZE, sev: null, _s: it })
            }
            const grouped = declutterAll(pts)
            if (typeof window !== "undefined") window.__plxProtestLayout = grouped.map((g) => ({ id: g.id, x: g.x, y: g.y, size: g.cluster ? clusterSize(g.members.length) : SIZE, cluster: g.cluster, n: g.members.length }))
            setLayout(grouped.map((g) => {
                const ss = g.members.map((m) => m._s)
                return { id: g.id, cluster: g.cluster, lat: ss.reduce((a, s) => a + s.lat, 0) / ss.length,
                         lon: ss.reduce((a, s) => a + s.lon, 0) / ss.length, items: ss }
            }))
        }
        compute()
        let t = 0
        const later = () => { clearTimeout(t); t = setTimeout(compute, 120) }
        const rm1 = scene.camera.moveEnd.addEventListener(later)
        const rm2 = scene.camera.changed.addEventListener(later)
        return () => { clearTimeout(t); rm1?.(); rm2?.() }
    }, [enabled, cesium?.viewer, items])

    useEffect(() => {
        const ids = []
        for (const g of layout) {
            if (!g.cluster) {
                setEntity(g.items[0].id, "telegram", inspectorData(g.items[0]))
                ids.push(g.items[0].id)
            } else {
                setEntity(g.id, "telegram", { kind: "live_cluster", id: g.id, headline: `${g.items.length} here`, lat: g.lat, lon: g.lon,
                                             cluster: g.items.map((s) => { const c = cardOf(s); return { title: c.title, line: c.line } }) })
                ids.push(g.id)
            }
        }
        return () => ids.forEach((id) => deleteEntity(id))
    }, [layout])

    const paths = useMemo(() => items.filter((it) => Array.isArray(it.track?.points) && it.track.points.length > 1), [items])
    if (!enabled) return null
    return (
        <>
            {paths.map((it) => (
                <Entity key={`path-${it.id}`} id={`path-${it.id}`}
                        polyline={{
                            positions: Cartesian3.fromDegreesArray(it.track.points.flatMap((p) => [p.lon, p.lat])),
                            width: 3, clampToGround: true,
                            material: it.kind === "police_track"
                                ? new PolylineDashMaterialProperty({ color: Color.fromCssColorString(TRACK_COLOR.police_track), dashLength: 14 })
                                : Color.fromCssColorString(TRACK_COLOR[it.kind] || "#9AA9BC").withAlpha(0.9),
                        }} />
            ))}
            {layout.map((g) => {
                const s = g.items[0]
                const size = g.cluster ? clusterSize(g.items.length) : SIZE
                const image = g.cluster ? clusterIconUri(g.items.length) : protestBadge(s)
                return (
                    <Entity key={g.id} id={g.cluster ? g.id : s.id} name={g.cluster ? `${g.items.length} here` : cardOf(s).title}
                            position={Cartesian3.fromDegrees(g.lon, g.lat, 0)}
                            billboard={{ image, width: size, height: size, heightReference: HeightReference.CLAMP_TO_GROUND,
                                         disableDepthTestDistance: 1e7, eyeOffset: new Cartesian3(0, 0, -80) }} />
                )
            })}
        </>
    )
}
