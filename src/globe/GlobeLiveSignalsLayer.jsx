/**
 * GlobeLiveSignalsLayer.jsx — THE signal layer of the globe (owner, 2026-10-22). It replaces the Telegram,
 * Unrest, Protests & crowds, street-report and Mood layers: one marker family (an icon per act), live only,
 * one marker per event, the same as the phone map (mobile/mapLayers.js loadLiveSignals).
 *
 *   data    GET /api/telegram/signals/live (backend/live_signals.py), every 30 s
 *   age     a signal is drawn for 60 min after its event, a crowd up to 3 h (lib/liveSignals.js)
 *   media   only on the card (the inspector), never a mark
 *   marker  the one typology (lib/mapIcons.js): a circle (a reported event), the act's glyph, the priority for
 *           you, the state (muted = dotted, developing = ring), constant ICON_PX
 *   fit     the shared collision pass (screenDeclutter.js) across every point layer: any markers whose boxes
 *           touch become one cluster badge that opens a list; nothing is nudged. Recomputed as the camera moves.
 */
import { useEffect, useMemo, useState } from "react"
import { Entity, useCesium } from "resium"
import { Cartesian3, HeightReference } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { signalIcon, signalPriority, cardText, clusterSize, liveSignalDrawn, mediaSources, ICON_PX } from "../lib/liveSignals.js"
import { useDeclutter } from "./screenDeclutter.js"
import ClusterMark, { useClusterRecords } from "./ClusterMark.jsx"

const PATH = "/api/telegram/signals/live"
const REFRESH_MS = 30_000
const SIZE = ICON_PX

export default function GlobeLiveSignalsLayer({ enabled = false }) {
    const [signals, setSignals] = useState([])
    const [nowMs, setNowMs] = useState(() => Date.now())
    const cesium = useCesium()
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
    useEffect(() => {
        if (!enabled || typeof window === "undefined" || !cesium?.viewer) return
        window.__plxLiveViewer = cesium.viewer          // reachable for browser checks
        window.__plxViewer = cesium.viewer
    }, [enabled, cesium?.viewer])

    const items = useMemo(() => signals.filter((s) => liveSignalDrawn(s, nowMs)).map((s) => {
        const c = cardText(s, nowMs)
        return { id: s.id, lat: s.lat, lon: s.lon, size: SIZE, pri: signalPriority(s), title: c.title, line: c.line, s }
    }), [signals, nowMs])
    const layout = useDeclutter("liveSignals", items, enabled)
    useClusterRecords(layout)
    useEffect(() => {
        if (typeof window !== "undefined") {
            window.__plxLiveLayout = layout.map((g) => ({ id: g.id, lat: g.lat, lon: g.lon, size: g.cluster ? clusterSize(g.members.length) : SIZE,
                                                          cluster: g.cluster, n: g.cluster ? g.members.length : 1 }))
        }
    }, [layout])

    // the inspector reads single signals from the store
    useEffect(() => {
        const ids = []
        for (const g of layout) {
            if (g.cluster) continue
            const s = g.item.s, c = cardText(s, nowMs)
            setEntity(s.id, "telegram", { ...s, kind: "live_signal", headline: c.title, title: c.title, status_label: c.line,
                                         card_lines: c.lines, sources: mediaSources(s), thumb_url: null, channel_title: s.sources?.[0]?.channel_title })
            ids.push(s.id)
        }
        return () => ids.forEach((id) => deleteEntity(id))
    }, [layout, nowMs])

    if (!enabled || !layout.length) return null
    return (
        <>
            {layout.map((g) => {
                if (g.cluster) return <ClusterMark key={g.id} g={g} />
                const s = g.item.s
                return (
                    <Entity key={s.id} id={s.id} name={g.item.title}
                            position={Cartesian3.fromDegrees(s.lon, s.lat, 0)}
                            billboard={{ image: signalIcon(s), width: SIZE, height: SIZE, heightReference: HeightReference.CLAMP_TO_GROUND,
                                         disableDepthTestDistance: 1e7, eyeOffset: new Cartesian3(0, 0, -80) }} />
                )
            })}
        </>
    )
}
