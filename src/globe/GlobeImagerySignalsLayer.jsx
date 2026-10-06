/**
 * GlobeImagerySignalsLayer.jsx — imagery signals on the map.
 *
 * A satellite pass that counted (imagery_signals.py: a new smoke plume,
 * tankers massing at an oil terminal, a vessel leaving a naval base, a
 * structure gone) is an alert with source SAT-TASK. The map's alert layer
 * draws surges and fusions only, so these reached the Inbox and the
 * notifications but never the map. Here they are pins — a square with a
 * cross-hair, coloured by severity — and opening one loads the image with
 * its detections (ImagerySignalSection).
 *
 * Passes come every few days, not every minute, so a signal stays for seven
 * days, dimming with age, instead of the event layers' 24 hours.
 */
import { useEffect, useRef, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, DistanceDisplayCondition, HeightReference } from "cesium"
import { makeArrivalTracker, arrivalScale, ARRIVAL_MS } from "./liveness.js"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const SIZE = 22
const DAYS = 7
const SEV = { critical: "#E5484D", high: "#F5A524", moderate: "#8FB4E8", medium: "#8FB4E8", low: "#9AA9BC" }
const _icons = {}
function icon(sev) {
    const c = SEV[sev] || SEV.moderate
    if (_icons[c]) return _icons[c]
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="5" y="5" width="22" height="22" fill="${c}" stroke="#0b1220" stroke-width="2.5"/>
      <path d="M16 9v14M9 16h14" stroke="#0b1220" stroke-width="2.4"/><circle cx="16" cy="16" r="4" fill="none" stroke="#0b1220" stroke-width="2.2"/></svg>`
    _icons[c] = `data:image/svg+xml;base64,${btoa(svg)}`
    return _icons[c]
}

/** Full weight for an hour, then dimming on a log scale to a floor at 7 days. */
export function fade(tsMs, nowMs) {
    if (!Number.isFinite(tsMs)) return 1
    const min = Math.max(0, (nowMs - tsMs) / 60000)
    if (min <= 60) return 1
    const end = DAYS * 24 * 60
    if (min >= end) return 0.35
    return Math.max(0.35, 1 - (Math.log(min / 60) / Math.log(end / 60)) * 0.65)
}

export default function GlobeImagerySignalsLayer({ enabled = true }) {
    const [items, setItems] = useState([])
    const arrivalsRef = useRef(null)
    const [arrivedAt, setArrivedAt] = useState({})
    const [nowMs, setNowMs] = useState(() => Date.now())
    useEffect(() => {
        const h = setInterval(() => setNowMs(Date.now()), 30000)
        return () => clearInterval(h)
    }, [])
    useEffect(() => {
        if (!enabled) { setItems([]); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}/api/alerts?source=SAT-TASK&limit=200`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!live || !d) return
                const cutoff = Date.now() - DAYS * 86400_000
                const rows = safeArray(Array.isArray(d) ? d : d.alerts)
                    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon)
                        && Date.parse(String(a.created_at).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(a.created_at) ? "" : "Z")) >= cutoff)
                setItems(rows)
                if (!arrivalsRef.current) arrivalsRef.current = makeArrivalTracker()
                const fresh = arrivalsRef.current.arrivals(rows.map((a) => a.alert_id))
                if (fresh.length) {
                    const t = Date.now()
                    setArrivedAt((prev) => ({ ...prev, ...Object.fromEntries(fresh.map((id) => [id, t])) }))
                    setTimeout(() => setArrivedAt((prev) => {
                        const next = { ...prev }
                        for (const id of fresh) delete next[id]
                        return next
                    }), ARRIVAL_MS + 500)
                }
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
    if (!enabled || !items.length) return null
    return (
        <>
            {items.map((a) => {
                const ts = Date.parse(String(a.created_at).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(a.created_at) ? "" : "Z"))
                const alpha = fade(ts, nowMs)
                const size = Math.round(SIZE * arrivalScale(arrivedAt[a.alert_id], nowMs))
                return (
                    <Entity key={a.alert_id} id={`imgsig-${a.alert_id}`} position={Cartesian3.fromDegrees(a.lon, a.lat, 0)}
                        billboard={{ image: icon(a.severity), width: size, height: size, color: Color.WHITE.withAlpha(alpha),
                                     heightReference: HeightReference.CLAMP_TO_GROUND,
                                     distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
                                     eyeOffset: new Cartesian3(0, 0, -80) }} />
                )
            })}
        </>
    )
}
