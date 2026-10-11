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
 * NEAR (camera below placeModels.MODEL_MAX_HEIGHT_M): the places in view
 * stand on the map as small 3D models of their kind — a refinery, a tank
 * farm, a forecourt, a rally, a roundabout, a works — on a plinth in the
 * status colour (tools/make_place_models.py), at most MODEL_BUDGET of them,
 * red calls first, then amber, then listed, nearest the view centre first.
 * The rest keep their marker. Each kind/status is one file, so every model
 * of it shares the same loaded glTF.
 *
 * A click on either opens the place in the inspector (adapters.js
 * adaptEndangeredPlace): the same entity id, the same card.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { Entity, useCesium } from "resium"
import {
    Cartesian2, Cartesian3, DistanceDisplayCondition, HeadingPitchRoll, HeightReference, Math as CMath,
    NearFarScalar, Transforms,
} from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { placeIconUri, rememberWithin7, filterByCountry } from "./endangeredPlaces.js"
import { useEndangeredCountries } from "../components/EndangeredCountryChips.jsx"
import { MAX_SCALE, MIN_PX, modelUrl, placeHeadingRad, selectModelPlaces } from "./placeModels.js"

const REFRESH_MS = 5 * 60_000
const VIEW_POLL_MS = 400

/** Camera height, the point the view is centred on, and the view rectangle. */
function readView(viewer) {
    const cam = viewer.camera
    const height = cam.positionCartographic?.height
    const canvas = viewer.scene.canvas
    let center = null
    const hit = cam.pickEllipsoid(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2))
    const carto = hit ? viewer.scene.globe.ellipsoid.cartesianToCartographic(hit) : cam.positionCartographic
    if (carto) center = { lat: CMath.toDegrees(carto.latitude), lon: CMath.toDegrees(carto.longitude) }
    const r = cam.computeViewRectangle()
    const bounds = r ? { west: CMath.toDegrees(r.west), south: CMath.toDegrees(r.south),
        east: CMath.toDegrees(r.east), north: CMath.toDegrees(r.north) } : null
    return { height, center, bounds: bounds && bounds.east > bounds.west ? bounds : null }
}

export default function GlobeEndangeredPlacesLayer({ enabled = false }) {
    const { viewer } = useCesium()
    const [places, setPlaces] = useState([])
    const countries = useEndangeredCountries()
    const [modelIds, setModelIds] = useState(() => new Set())
    const modelKey = useRef("")
    useEffect(() => {
        if (!enabled) { setPlaces([]); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}/api/endangered-places`, { credentials: "include" })
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
    }, [enabled, countries])
    useEffect(() => {
        places.forEach((p) => setEntity(`endangered-${p.id}`, "endangered_place", p))
        return () => places.forEach((p) => deleteEntity(`endangered-${p.id}`))
    }, [places])
    // Which places stand as models. The viewer renders on demand, so the
    // camera is polled (as GlobeInfraLayer does) and React only hears of
    // it when the chosen set itself changes.
    useEffect(() => {
        if (!enabled || !viewer || !places.length) { modelKey.current = ""; setModelIds(new Set()); return undefined }
        const tick = () => {
            if (viewer.isDestroyed()) return
            const ids = selectModelPlaces(places, readView(viewer))
            const key = [...ids].sort().join("|")
            if (key !== modelKey.current) { modelKey.current = key; setModelIds(ids) }
        }
        tick()
        const iv = setInterval(tick, VIEW_POLL_MS)
        return () => clearInterval(iv)
    }, [enabled, viewer, places])
    useEffect(() => { if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender() }, [viewer, modelIds])
    // Positions and orientations once per place, not per render.
    const geo = useMemo(() => {
        const m = new Map()
        for (const p of places) {
            const pos = Cartesian3.fromDegrees(p.lon, p.lat, 0)
            m.set(p.id, { pos, orient: Transforms.headingPitchRollQuaternion(pos, new HeadingPitchRoll(placeHeadingRad(p.id), 0, 0)) })
        }
        return m
    }, [places])
    if (!enabled || !places.length) return null
    return (
        <>
            {places.map((p) => {
                const g = geo.get(p.id)
                return g ? <PlaceEntity key={p.id} p={p} g={g} is3d={modelIds.has(p.id)} /> : null
            })}
        </>
    )
}

/**
 * One place. ONE ENTITY, BOTH LOOKS: swapping the entity for a 3D one (a
 * different key) made resium add the new before removing the old, and
 * Cesium refuses a second entity with the same id — so the model and the
 * marker live on the same entity and only `show` flips. A model that is
 * not shown is never loaded (Cesium's ModelVisualizer skips it). Memoised,
 * so crossing the LOD line only touches the places whose look changed.
 */
const PlaceEntity = memo(function PlaceEntity({ p, g, is3d }) {
    const uri = modelUrl(p.kind, p.alarm)
    const hasCall = Array.isArray(p.calls) && p.calls.length > 0 && p.alarm !== "grey"
    const size = hasCall ? (p.alarm === "red" ? 24 : 21) : 14
    return (
        <Entity id={`endangered-${p.id}`} name={p.name}
            position={g.pos} orientation={g.orient}
            model={uri ? {
                uri, show: is3d,
                minimumPixelSize: MIN_PX, maximumScale: MAX_SCALE,
                heightReference: HeightReference.CLAMP_TO_GROUND,
            } : undefined}
            billboard={{
                show: !(is3d && uri),
                image: placeIconUri({ kind: p.kind, alarm: p.alarm, hasCall, size }),
                width: size, height: size,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                // calls from continent scale; listed-only places from region scale
                distanceDisplayCondition: new DistanceDisplayCondition(0, hasCall ? 9_000_000 : 1_800_000),
                scaleByDistance: new NearFarScalar(200_000, 1.0, 6_000_000, 0.7),
                eyeOffset: new Cartesian3(0, 0, hasCall ? -60 : -20),
            }} />
    )
})
