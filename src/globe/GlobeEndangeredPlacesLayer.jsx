/**
 * GlobeEndangeredPlacesLayer.jsx — places public calls name for blockades
 * and other actions (backend/endangered_places.py, /api/endangered-places).
 *
 * FAR: a warning triangle where a call is declared — red when a roadblock,
 * a slow-drive convoy or a picket is within 48 h, amber for any other call
 * to come — and a small grey disc where the place is only listed (a fuel
 * depot with nothing declared yet, a company on the anti-militarist map).
 * The listed ones only show closer in, so the calls stay readable over
 * France.
 *
 * MARKERS ONLY, at every height (owner, 2026-10-12: "we never want the 3D
 * model displayed on the map, all we want is the 3D model slowly rotating
 * in the sidebar"): the place's model turns in the inspector card
 * (inspector/EndangeredPlaceDetail.jsx), never on the globe.
 *
 * "ACTIVE ONLY" (the layer card's first chip, EndangeredCountryChips): only
 * the places with a call today or to come, and those within 2 km of one —
 * the server filters (active=1).
 *
 * A click on a marker opens the place in the inspector (adapters.js
 * adaptEndangeredPlace): the same entity id, the same card.
 */
import { memo, useEffect, useMemo, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, DistanceDisplayCondition, HeightReference, NearFarScalar } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { placeIconUri, rememberWithin7, filterByCountry, placesUrl } from "./endangeredPlaces.js"
import { useEndangeredCountries, useEndangeredActive } from "../components/EndangeredCountryChips.jsx"

const REFRESH_MS = 5 * 60_000

export default function GlobeEndangeredPlacesLayer({ enabled = false }) {
    const [places, setPlaces] = useState([])
    const countries = useEndangeredCountries()
    const activeOnly = useEndangeredActive()
    useEffect(() => {
        if (!enabled) { setPlaces([]); return undefined }
        let live = true
        const load = () => fetch(placesUrl(API_BASE, activeOnly), { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!live || !d) return
                rememberWithin7(d.calls_within_7_days)
                // the layer card's country chips (EndangeredCountryChips)
                setPlaces(filterByCountry(safeArray(d.places), countries).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)))
            })
            .catch(() => {})
        load()
        const iv = setInterval(load, REFRESH_MS)
        return () => { live = false; clearInterval(iv) }
    }, [enabled, countries, activeOnly])
    useEffect(() => {
        places.forEach((p) => setEntity(`endangered-${p.id}`, "endangered_place", p))
        return () => places.forEach((p) => deleteEntity(`endangered-${p.id}`))
    }, [places])
    if (!enabled || !places.length) return null
    return <>{places.map((p) => <PlaceEntity key={p.id} p={p} far={activeOnly} />)}</>
}

/**
 * One place: its marker, in the place's own status colour (a place that is
 * active only because a call is near keeps its grey disc; its card says
 * which call and how far). Memoised, its position computed once.
 */
const PlaceEntity = memo(function PlaceEntity({ p, far = false }) {
    const hasCall = Array.isArray(p.calls) && p.calls.length > 0 && p.alarm !== "grey"
    const size = hasCall ? (p.alarm === "red" ? 24 : 21) : 14
    const pos = useMemo(() => Cartesian3.fromDegrees(p.lon, p.lat, 0), [p.lon, p.lat])
    return (
        <Entity id={`endangered-${p.id}`} name={p.name}
            position={pos}
            billboard={{
                image: placeIconUri({ kind: p.kind, alarm: p.alarm, hasCall, size }),
                width: size, height: size,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                // calls (and, with "Active only", places near one) from
                // continent scale; listed-only places from region scale
                distanceDisplayCondition: new DistanceDisplayCondition(0, hasCall || (far && p.active) ? 9_000_000 : 1_800_000),
                scaleByDistance: new NearFarScalar(200_000, 1.0, 6_000_000, 0.7),
                eyeOffset: new Cartesian3(0, 0, hasCall ? -60 : -20),
            }} />
    )
})
