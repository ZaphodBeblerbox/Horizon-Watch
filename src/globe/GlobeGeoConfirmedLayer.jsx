/**
 * GlobeGeoConfirmedLayer.jsx — real, geolocated conflict-event pins from
 * GeoConfirmed (backend/geoconfirmed.py + routers/geoconfirmed.py), the
 * precise replacement for the imprecisely-geocoded raw RSS/news points this
 * layer's introduction lets GlobeEventsLayer.jsx stop rendering (see
 * GlobeView.jsx — GlobeEventsLayer is no longer mounted there). Same real
 * fetch/register-in-entityStore/click-to-inspect pattern as every other
 * point layer in this file's family, not a bespoke one-off.
 */
import { useState, useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { getEntityMarkerDataUri } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const MARKER_SIZE = 30

export default function GlobeGeoConfirmedLayer({ enabled = false, maxAgeDays = 30 }) {
    const [placemarks, setPlacemarks] = useState([])

    useEffect(() => {
        if (!enabled) { setPlacemarks([]); return }
        let cancelled = false
        const load = () => {
            fetch(`${API_BASE}/api/geoconfirmed/placemarks?max_age_days=${maxAgeDays}&limit=2000`)
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (!cancelled) setPlacemarks(safeArray(d?.placemarks)) })
                .catch(() => {})
        }
        load()
        const iv = setInterval(load, 300_000) // real data refreshes on a real ~30min backend sync cadence
        return () => { cancelled = true; clearInterval(iv) }
    }, [enabled, maxAgeDays])

    // Register in entityStore so GlobePopup can render the shared InspectorPanel
    useEffect(() => {
        if (!placemarks.length) return
        const ids = []
        placemarks.forEach((p) => {
            const id = `geoconfirmed-${p.id}`
            setEntity(id, "geoconfirmed", p)
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [placemarks])

    if (!enabled || !placemarks.length) return null

    const icon = getEntityMarkerDataUri({ entityType: "geoconfirmed", size: MARKER_SIZE, color: "#E8C547" })

    return (
        <>
            {placemarks.map((p) => {
                if (!isFinite(p.lat) || !isFinite(p.lon)) return null
                return (
                    <Entity
                        id={`geoconfirmed-${p.id}`}
                        key={p.id}
                        position={Cartesian3.fromDegrees(p.lon, p.lat, 0)}
                        billboard={{
                            image: icon,
                            width: MARKER_SIZE,
                            height: MARKER_SIZE,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
                            eyeOffset: new Cartesian3(0, 0, -50),
                        }}
                    />
                )
            })}
        </>
    )
}
