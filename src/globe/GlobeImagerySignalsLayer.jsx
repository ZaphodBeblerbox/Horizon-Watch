/**
 * GlobeImagerySignalsLayer.jsx — imagery signals on the map.
 *
 * A satellite pass that counted (imagery_signals.py: a new smoke plume, tankers massing at an oil terminal, a
 * vessel leaving a naval base, a structure gone) is an alert with source SAT-TASK. Here they are marks in the one
 * typology (lib/mapIcons.js imageryIcon): a square (observed by a sensor) with the target glyph, the severity as
 * priority for you, one constant size; opening one loads the image with its detections (ImagerySignalSection).
 *
 * Passes come every few days, so a signal stays for seven days, dimming with age (liveness.recencyAlpha, the one
 * age fade of every layer). It joins the shared collision pass (screenDeclutter.js).
 */
import { useEffect, useMemo, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, DistanceDisplayCondition, HeightReference } from "cesium"
import { recencyAlpha } from "./liveness.js"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { imageryIcon, priorityOf, ICON_PX } from "../lib/mapIcons.js"
import { useDeclutter } from "./screenDeclutter.js"
import ClusterMark, { useClusterRecords } from "./ClusterMark.jsx"

const SIZE = ICON_PX
const DAYS = 7
const tsOf = (a) => Date.parse(String(a.created_at).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(a.created_at) ? "" : "Z"))

export default function GlobeImagerySignalsLayer({ enabled = true }) {
    const [items, setItems] = useState([])
    const [nowMs, setNowMs] = useState(() => Date.now())
    useEffect(() => {
        const h = setInterval(() => setNowMs(Date.now()), 30000)
        return () => clearInterval(h)
    }, [])
    useEffect(() => {
        if (!enabled) { setItems([]); return undefined }
        let live = true
        // Every signal of the window, not the newest 200 (owner, 2026-10-17:
        // "no cap on how many things we can actually recognise on the map").
        const load = () => fetch(`${API_BASE}/api/alerts?source=SAT-TASK&since_hours=${DAYS * 24}&limit=0`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!live || !d) return
                const cutoff = Date.now() - DAYS * 86400_000
                setItems(safeArray(Array.isArray(d) ? d : d.alerts)
                    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon) && tsOf(a) >= cutoff))
            })
            .catch(() => {})
        load()
        const iv = setInterval(load, 60_000)
        return () => { live = false; clearInterval(iv) }
    }, [enabled])
    useEffect(() => {
        items.forEach((a) => setEntity(`imgsig-${a.alert_id}`, "alert", { ...a, id: a.alert_id, source: "SAT-TASK" }))
        return () => items.forEach((a) => deleteEntity(`imgsig-${a.alert_id}`))
    }, [items])
    const marks = useMemo(() => items.map((a) => ({
        id: `imgsig-${a.alert_id}`, lat: a.lat, lon: a.lon, size: SIZE, pri: priorityOf(a.severity, "alert"),
        title: a.title || a.alert_type || "Imagery signal", line: a.region || "", a,
    })), [items])
    const layout = useDeclutter("imagerySignals", marks, enabled)
    useClusterRecords(layout)
    if (!enabled || !layout.length) return null
    return (
        <>
            {layout.map((g) => {
                if (g.cluster) return <ClusterMark key={g.id} g={g} />
                const a = g.item.a
                return (
                    <Entity key={a.alert_id} id={`imgsig-${a.alert_id}`} position={Cartesian3.fromDegrees(a.lon, a.lat, 0)}
                        billboard={{ image: imageryIcon(a.severity), width: SIZE, height: SIZE, color: Color.WHITE.withAlpha(recencyAlpha(tsOf(a), nowMs)),
                                     heightReference: HeightReference.CLAMP_TO_GROUND,
                                     // Out of the way once you are looking at the place itself
                                     // (closer than 25 km); back as you zoom out.
                                     distanceDisplayCondition: new DistanceDisplayCondition(25_000, 60_000_000),
                                     eyeOffset: new Cartesian3(0, 0, -80) }} />
                )
            })}
        </>
    )
}
