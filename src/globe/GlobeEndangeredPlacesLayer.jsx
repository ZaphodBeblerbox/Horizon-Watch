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
import { Cartesian3, HeightReference } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { placeIconUri, rememberWithin7, filterByCountry, placesUrl } from "./endangeredPlaces.js"
import { useEndangeredCountries, useEndangeredActive } from "../components/EndangeredCountryChips.jsx"
import { ICON_PX, priorityOf } from "../lib/mapIcons.js"
import { useDeclutter } from "./screenDeclutter.js"
import ClusterMark, { useClusterRecords } from "./ClusterMark.jsx"

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
    const marks = useMemo(() => places.map((p) => ({
        id: `endangered-${p.id}`, lat: p.lat, lon: p.lon, size: ICON_PX, pri: priorityOf(p.alarm, "info"),
        image: placeIconUri({ kind: p.kind, alarm: p.alarm, hasCall: Array.isArray(p.calls) && p.calls.length > 0 && p.alarm !== "grey" }),
        title: p.name || "Endangered place", line: p.city || "", p,
    })), [places])
    const layout = useDeclutter("endangered", marks, enabled)
    useClusterRecords(layout)
    if (!enabled || !layout.length) return null
    return <>{layout.map((g) => (g.cluster ? <ClusterMark key={g.id} g={g} /> : <PlaceEntity key={g.item.p.id} p={g.item.p} />))}</>
}

/**
 * One place: its marker, in the place's own status colour (a place that is
 * active only because a call is near keeps its grey disc; its card says
 * which call and how far). Memoised, its position computed once.
 */
const PlaceEntity = memo(function PlaceEntity({ p }) {
    const hasCall = Array.isArray(p.calls) && p.calls.length > 0 && p.alarm !== "grey"
    const size = ICON_PX                     // one constant size (lib/mapIcons.js); the alarm is the colour
    const pos = useMemo(() => Cartesian3.fromDegrees(p.lon, p.lat, 0), [p.lon, p.lat])
    return (
        <Entity id={`endangered-${p.id}`} name={p.name}
            position={pos}
            billboard={{
                image: placeIconUri({ kind: p.kind, alarm: p.alarm, hasCall }),
                width: size, height: size,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                // every place at every height: the shared collision pass folds the crowded ones into one badge
                eyeOffset: new Cartesian3(0, 0, hasCall ? -60 : -20),
            }} />
    )
})
