/**
 * GlobeProtestsLayer.jsx — the PROTESTS layer on the globe (owner, 2026-10-23: "on the desktop version I can't
 * actually toggle the protest movements at all. Protests should be an actual layer"). The same items, icons,
 * frames and cards as the phone (mobile/mapLayers.js loadProtests, lib/protests.js).
 *
 *   data    GET /api/protests?frame=live|today|upcoming (backend/protests.py); every 15 s while something is
 *           live in the user's areas, 60 s otherwise (globe/demoLive.js cadence); not while the page is hidden
 *   marks   one badge per item in the one typology (lib/mapIcons.js via protestBadge) at a constant ICON_PX; the
 *           crowd's and the police's movement as a path under its badge (lines keep their colour) with the
 *           heading on the badge's edge
 *   fit     the shared collision pass across every point layer (screenDeclutter.js): touching badges become one
 *           cluster badge that opens a list; recomputed as the camera moves
 */
import { useEffect, useMemo, useState } from "react"
import { Entity, useCesium } from "resium"
import { Cartesian3, Color, HeightReference, PolylineDashMaterialProperty } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { PROTESTS_PATH, ICON_PX, getFrame, subscribeFrame, setMeta, protestBadge, protestPriority, inspectorData, cardOf, refreshMs, TRACK_COLOR } from "../lib/protests.js"
import { useDeclutter } from "./screenDeclutter.js"
import ClusterMark, { useClusterRecords } from "./ClusterMark.jsx"
import { markLive } from "./demoLive.js"

const SIZE = ICON_PX

export default function GlobeProtestsLayer({ enabled = false }) {
    const [frame, setFrameState] = useState(getFrame)
    useEffect(() => subscribeFrame(setFrameState), [])
    const [items, setItems] = useState([])

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

    const marks = useMemo(() => items.map((it) => {
        const c = cardOf(it)
        return { id: it.id, lat: it.lat, lon: it.lon, size: SIZE, pri: protestPriority(it), image: protestBadge(it), t: Date.parse(it.last_update || it.time || "") || 0, title: c.title, line: c.line, it }
    }), [items])
    const layout = useDeclutter("protests", marks, enabled)
    const cesium = useCesium()
    useEffect(() => { if (enabled && cesium?.viewer && typeof window !== "undefined") window.__plxProtestViewer = cesium.viewer }, [enabled, cesium?.viewer])
    useClusterRecords(layout)
    useEffect(() => {
        if (typeof window !== "undefined") {
            window.__plxProtestLayout = layout.map((g) => ({ id: g.id, lat: g.lat, lon: g.lon, size: SIZE,
                                                             cluster: g.cluster, n: g.cluster ? g.members.length : 1 }))
        }
        const ids = []
        for (const g of layout) {
            if (g.cluster) continue
            setEntity(g.item.it.id, "telegram", inspectorData(g.item.it))
            ids.push(g.item.it.id)
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
                if (g.cluster) return <ClusterMark key={g.id} g={g} />
                const s = g.item.it
                return (
                    <Entity key={s.id} id={s.id} name={g.item.title}
                            position={Cartesian3.fromDegrees(s.lon, s.lat, 0)}
                            billboard={{ image: protestBadge(s), width: SIZE, height: SIZE, heightReference: HeightReference.CLAMP_TO_GROUND,
                                         disableDepthTestDistance: 1e7, eyeOffset: new Cartesian3(0, 0, -80) }} />
                )
            })}
        </>
    )
}
