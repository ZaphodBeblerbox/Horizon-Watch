/**
 * GlobeEndangeredPlacesLayer.jsx — places public calls name for blockades
 * and other actions (backend/endangered_places.py, /api/endangered-places).
 *
 * A warning triangle where a call is declared — red when a roadblock, a
 * slow-drive convoy or a picket is within 48 h, amber for any other call to
 * come — and a small grey disc where the place is only listed (a fuel
 * depot with nothing declared yet, a company on the anti-militarist map).
 * The listed ones only show closer in, so the calls stay readable over
 * France. A click opens the place in the inspector (adapters.js
 * adaptEndangeredPlace): its calls in plain English, the operator, the
 * source link.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, DistanceDisplayCondition, HeightReference, NearFarScalar } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { placeIconUri, rememberWithin7 } from "./endangeredPlaces.js"

const REFRESH_MS = 5 * 60_000

export default function GlobeEndangeredPlacesLayer({ enabled = false }) {
    const [places, setPlaces] = useState([])
    useEffect(() => {
        if (!enabled) { setPlaces([]); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}/api/endangered-places`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!live || !d) return
                rememberWithin7(d.calls_within_7_days)
                setPlaces(safeArray(d.places).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)))
            })
            .catch(() => {})
        load()
        const iv = setInterval(load, REFRESH_MS)
        return () => { live = false; clearInterval(iv) }
    }, [enabled])
    useEffect(() => {
        places.forEach((p) => setEntity(`endangered-${p.id}`, "endangered_place", p))
        return () => places.forEach((p) => deleteEntity(`endangered-${p.id}`))
    }, [places])
    if (!enabled || !places.length) return null
    return (
        <>
            {places.map((p) => {
                const hasCall = Array.isArray(p.calls) && p.calls.length > 0 && p.alarm !== "grey"
                const size = hasCall ? (p.alarm === "red" ? 24 : 21) : 14
                return (
                    <Entity key={p.id} id={`endangered-${p.id}`} name={p.name}
                        position={Cartesian3.fromDegrees(p.lon, p.lat, 0)}
                        billboard={{
                            image: placeIconUri({ kind: p.kind, alarm: p.alarm, hasCall, size }),
                            width: size, height: size,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            // calls from continent scale; listed-only places from region scale
                            distanceDisplayCondition: new DistanceDisplayCondition(0, hasCall ? 9_000_000 : 1_800_000),
                            scaleByDistance: new NearFarScalar(200_000, 1.0, 6_000_000, 0.7),
                            eyeOffset: new Cartesian3(0, 0, hasCall ? -60 : -20),
                        }} />
                )
            })}
        </>
    )
}
