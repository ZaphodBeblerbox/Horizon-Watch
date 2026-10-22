/**
 * GlobeLiveSignalsLayer.jsx — THE signal layer of the globe (owner, 2026-10-22). It replaces the Telegram,
 * Unrest, Protests & crowds, street-report and Mood layers: one marker family (an icon per act), live only,
 * one marker per event, the same as the phone map (mobile/mapLayers.js loadLiveSignals).
 *
 *   data    GET /api/telegram/signals/live (backend/live_signals.py), every 30 s
 *   age     a signal is drawn for 60 min after its event, a crowd up to 3 h (lib/liveSignals.js)
 *   media   only on the card (the inspector), never a mark
 *   fit     markers are laid out in SCREEN space (declutterAll): any whose boxes touch become one
 *           count marker that opens a list; nothing is nudged. Recomputed as the camera moves.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Entity, useCesium } from "resium"
import { Cartesian3, SceneTransforms, HeightReference } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { actIcon, cardText, clusterIconUri, clusterSize, declutterAll, liveSignalDrawn, mediaSources, onNearSide } from "../lib/liveSignals.js"

const PATH = "/api/telegram/signals/live"
const REFRESH_MS = 30_000
const SIZE = 28

export default function GlobeLiveSignalsLayer({ enabled = false }) {
    const [signals, setSignals] = useState([])
    const [nowMs, setNowMs] = useState(() => Date.now())
    const [layout, setLayout] = useState([])
    const cesium = useCesium()
    const sigRef = useRef([])
    useEffect(() => {
        if (!enabled) { setSignals([]); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}${PATH}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d) setSignals(safeArray(d.signals).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))) })
            .catch(() => { /* a dropped poll is not an empty world */ })
        load()
        const iv = setInterval(load, REFRESH_MS)
        const tick = setInterval(() => setNowMs(Date.now()), 15_000)
        return () => { live = false; clearInterval(iv); clearInterval(tick) }
    }, [enabled])
    const shown = useMemo(() => signals.filter((s) => liveSignalDrawn(s, nowMs)), [signals, nowMs])
    sigRef.current = shown

    // the screen layout: recomputed when the signals change and when the camera stops moving
    useEffect(() => {
        const viewer = cesium?.viewer
        const scene = viewer?.scene
        if (!enabled || !scene || scene.isDestroyed?.()) { setLayout([]); return undefined }
        const compute = () => {
            if (scene.isDestroyed?.()) return
            const cam = scene.camera.positionWC
            const items = []
            for (const s of sigRef.current) {
                const p = Cartesian3.fromDegrees(s.lon, s.lat, 0)
                if (!onNearSide(p, cam)) continue
                const w = SceneTransforms.worldToWindowCoordinates(scene, p)
                if (!w || w.x < -SIZE || w.y < -SIZE || w.x > scene.canvas.clientWidth + SIZE || w.y > scene.canvas.clientHeight + SIZE) continue
                items.push({ id: s.id, x: w.x, y: w.y, size: SIZE, sev: s.muted ? null : (s.high_impact ? "high" : null), _s: s })
            }
            const out = declutterAll(items).map((g) => {
                const ss = g.members.map((m) => m._s)
                const lat = ss.reduce((a, s) => a + s.lat, 0) / ss.length
                const lon = ss.reduce((a, s) => a + s.lon, 0) / ss.length
                return { id: g.id, cluster: g.cluster, lat, lon, signals: ss }
            })
            setLayout(out)
        }
        compute()
        let timer = 0
        const later = () => { clearTimeout(timer); timer = setTimeout(compute, 120) }
        const rm1 = scene.camera.moveEnd.addEventListener(later)
        const rm2 = scene.camera.changed.addEventListener(later)
        return () => { clearTimeout(timer); rm1?.(); rm2?.() }
    }, [enabled, cesium?.viewer, shown])

    // the inspector reads these from the store
    useEffect(() => {
        const ids = []
        for (const g of layout) {
            if (!g.cluster) {
                const s = g.signals[0], c = cardText(s, nowMs)
                setEntity(s.id, "telegram", { ...s, kind: "live_signal", headline: c.title, title: c.title, status_label: c.line,
                                             card_lines: c.lines, sources: mediaSources(s), thumb_url: null, channel_title: s.sources?.[0]?.channel_title })
            } else {
                setEntity(g.id, "telegram", { kind: "live_cluster", id: g.id, headline: `${g.signals.length} signals here`, lat: g.lat, lon: g.lon,
                                             cluster: g.signals.map((s) => { const c = cardText(s, nowMs); return { title: c.title, line: c.line } }) })
            }
            ids.push(g.id === undefined ? null : g.cluster ? g.id : g.signals[0].id)
        }
        return () => ids.forEach((id) => id && deleteEntity(id))
    }, [layout, nowMs])

    if (!enabled || !layout.length) return null
    return (
        <>
            {layout.map((g) => {
                const s = g.signals[0]
                const size = g.cluster ? clusterSize(g.signals.length) : SIZE
                const image = g.cluster ? clusterIconUri(g.signals.length) : actIcon(s.act, { muted: !!s.muted, bearing: s.direction?.bearing })
                return (
                    <Entity key={g.id} id={g.cluster ? g.id : s.id} name={g.cluster ? `${g.signals.length} signals here` : cardText(s, nowMs).title}
                            position={Cartesian3.fromDegrees(g.lon, g.lat, 0)}
                            billboard={{ image, width: size, height: size, heightReference: HeightReference.CLAMP_TO_GROUND,
                                         disableDepthTestDistance: 1e7, eyeOffset: new Cartesian3(0, 0, -80) }} />
                )
            })}
        </>
    )
}

