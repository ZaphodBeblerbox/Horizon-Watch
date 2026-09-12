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
import { getGeoConfirmedMarkerDataUri, GEOCONFIRMED_MARKER_SIZE } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const MARKER_SIZE = GEOCONFIRMED_MARKER_SIZE

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

    // Real, per-placemark faction color (GeoConfirmed's own real bulk API
    // field — see entityIcons.js's getGeoConfirmedMarkerDataUri doc comment).
    // Cached per distinct (color, invert) pair, not per placemark, so this
    // stays cheap even across thousands of pins.
    const iconFor = (p) => getGeoConfirmedMarkerDataUri({
        color: p.faction_color, invertColor: !!p.faction_invert_color, size: MARKER_SIZE,
    })

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
                            image: iconFor(p),
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
