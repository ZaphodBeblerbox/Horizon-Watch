/**
 * GlobeFiresLayer.jsx — thermal anomalies, drawn.
 *
 * FIRMS has been tasking imagery for a while and nothing has ever shown
 * the fires themselves. They lived in an in-memory suppression list, so a
 * restart forgot every one and there was nothing to draw.
 *
 * A CIRCLE, because a thermal hotspot is a sensor reading rather than a
 * verified event (square) or a report (diamond). Colour carries brightness
 * temperature, which is the number that separates a cooking fire from a
 * refinery flare from something burning that should not be.
 *
 * THE LABEL SAYS "ANOMALY", NOT "FIRE". VIIRS sees a gas flare, burning
 * stubble and a munitions strike identically — they are all just hot. The
 * instrument measured temperature; calling that a fire on the reader's
 * behalf is an interpretation the data does not support, and it is exactly
 * the kind of small overstatement that makes an analyst stop trusting a
 * layer.
 */
import { useEffect, useMemo, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { MARKER_MAX_CAMERA_M } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { markerIcon, ICON_PX } from "../lib/mapIcons.js"
import { useDeclutter } from "./screenDeclutter.js"
import ClusterMark, { useClusterRecords } from "./ClusterMark.jsx"

const MARKER_SIZE = ICON_PX
const REFRESH_MS = 5 * 60 * 1000

/**
 * Brightness temperature → priority (lib/mapIcons.js): a fire is observed by a sensor (a square with a flame),
 * urgent from 360 K, alert otherwise — never flash: a fire is not yet an alert to you.
 */
export function firePriority(k) {
    return Number(k) >= 360 ? "urgent" : "alert"
}

export default function GlobeFiresLayer({ enabled = false, hours = 72 }) {
    const [fires, setFires] = useState([])

    useEffect(() => {
        if (!enabled) { setFires([]); return }
        let cancelled = false
        const load = () => {
            fetch(`${API_BASE}/api/fires?hours=${hours}&limit=2000`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (!cancelled) setFires(safeArray(d?.fires)) })
                .catch(() => { /* a dropped poll is not an empty world */ })
        }
        load()
        const h = setInterval(load, REFRESH_MS)
        return () => { cancelled = true; clearInterval(h) }
    }, [enabled, hours])

    useEffect(() => {
        const ids = []
        fires.forEach((f) => {
            if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) return
            const id = `fire-${f.id}`
            ids.push(id)
            // setEntity(id, TYPE, data) — three arguments. Passing the
            // object alone stored it as the TYPE with data undefined, so
            // the inspector opened empty on every click.
            setEntity(id, "thermal_anomaly", {
                id, kind: "thermal_anomaly", name: f.label,
                lat: f.lat, lon: f.lon,
                meta: {
                    brightness_k: f.brightness_k, frp_mw: f.frp,
                    confidence: f.confidence, satellite: f.satellite,
                    instrument: f.instrument, source: f.source,
                    acquired_at: f.acquired_at,
                    // Whether this one was acted on. "Seen and judged not
                    // worth a scan" is a different record from "never seen",
                    // and the reader should be able to tell.
                    triggered_scan: f.triggered_scan, zone: f.zone,
                },
            })
        })
        return () => ids.forEach(deleteEntity)
    }, [fires])

    const marks = useMemo(() => fires.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon)).map((f) => ({
        id: `fire-${f.id}`, lat: f.lat, lon: f.lon, size: MARKER_SIZE, pri: firePriority(f.brightness_k),
        title: f.label || "Thermal anomaly", line: [f.instrument || "VIIRS", f.satellite].filter(Boolean).join(" · "), f,
    })), [fires])
    const layout = useDeclutter("fires", marks, enabled)
    useClusterRecords(layout)
    if (!enabled || !layout.length) return null

    return (
        <>
            {layout.map((g) => {
                if (g.cluster) return <ClusterMark key={g.id} g={g} />
                const f = g.item.f
                const ic = markerIcon({ kind: "confirmed", glyph: "flame", priority: g.item.pri })
                return (
                    <Entity
                        id={`fire-${f.id}`}
                        key={f.id}
                        position={Cartesian3.fromDegrees(f.lon, f.lat, 0)}
                        name={f.label}
                        description={
                            `<div style="font:400 12px sans-serif">`
                            + `<b>${f.label}</b><br/>`
                            + `${f.instrument || "VIIRS"} · ${f.satellite || ""} `
                            + `${f.frp ? `· ${f.frp} MW` : ""}<br/>`
                            + `<span style="opacity:.7">${f.acquired_at || ""}</span><br/>`
                            + (f.triggered_scan
                                ? `<span style="opacity:.7">tasked imagery in ${f.zone}</span>`
                                : `<span style="opacity:.55">not in a watch zone — no scan tasked</span>`)
                            + `<br/><span style="opacity:.55">a gas flare, burning stubble and a `
                            + `strike look identical to the instrument</span>`
                            + `</div>`
                        }
                        billboard={{
                            image: ic.uri,
                            width: ic.w,
                            height: ic.h,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            distanceDisplayCondition: new DistanceDisplayCondition(0, MARKER_MAX_CAMERA_M),
                            eyeOffset: new Cartesian3(0, 0, -50),
                        }}
                    />
                )
            })}
        </>
    )
}
