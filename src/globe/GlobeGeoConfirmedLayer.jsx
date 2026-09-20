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
import { getGeoConfirmedMarkerDataUri, GEOCONFIRMED_MARKER_SIZE, MARKER_MAX_CAMERA_M } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const MARKER_SIZE = GEOCONFIRMED_MARKER_SIZE

export default function GlobeGeoConfirmedLayer({ enabled = false, maxAgeDays = 30, theatres = null, endDate = null }) {
    const [placemarks, setPlacemarks] = useState([])
    // Real, stable cache keys — theatres is a fresh array reference on every
    // parent render even when its contents are unchanged, which would
    // otherwise re-fire this effect (and re-fetch) every render.
    const theatresKey = (theatres && theatres.length) ? theatres.join(",") : ""

    useEffect(() => {
        if (!enabled) { setPlacemarks([]); return }
        let cancelled = false
        const load = () => {
            const params = new URLSearchParams({ max_age_days: String(maxAgeDays), limit: "2000" })
            if (theatresKey) params.set("theatre", theatresKey)
            // Historic-timeline round (Part 1) — when the timeline panel's
            // slider is scrubbed to a real historic point, endDate anchors
            // the same real max_age_days window there instead of at
            // utcnow(), through this one real server-side filter (see
            // routers/geoconfirmed.py's get_placemarks) — never a second,
            // client-side re-filter of an already-fetched "live" set.
            if (endDate) params.set("end_date", endDate)
            fetch(`${API_BASE}/api/geoconfirmed/placemarks?${params.toString()}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (!cancelled) setPlacemarks(safeArray(d?.placemarks)) })
                .catch(() => {})
        }
        load()
        // Real data refreshes on a real ~30min backend sync cadence — but
        // only meaningful while anchored live; a historic (endDate) scrub
        // position never changes on its own, so don't poll it.
        const iv = endDate ? null : setInterval(load, 300_000)
        return () => { cancelled = true; if (iv) clearInterval(iv) }
    }, [enabled, maxAgeDays, theatresKey, endDate])

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
                // Number.isFinite, not bare isFinite (isFinite(null) is
                // true) — defense in depth for the same real crash class
                // fixed in GlobeConnectorLinesLayer.jsx. GeoConfirmedPlacemark
                // rows are DB-constrained non-null today, so this is
                // currently unreachable, but the cheap fix keeps this layer
                // safe against that assumption ever changing.
                if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null
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
                            distanceDisplayCondition: new DistanceDisplayCondition(0, MARKER_MAX_CAMERA_M),
                            eyeOffset: new Cartesian3(0, 0, -50),
                        }}
                    />
                )
            })}
        </>
    )
}
