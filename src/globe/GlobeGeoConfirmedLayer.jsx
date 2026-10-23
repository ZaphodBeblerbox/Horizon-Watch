/**
 * GlobeGeoConfirmedLayer.jsx — real, geolocated conflict-event pins from
 * GeoConfirmed (backend/geoconfirmed.py + routers/geoconfirmed.py), the
 * precise replacement for the imprecisely-geocoded raw RSS/news points this
 * layer's introduction lets GlobeEventsLayer.jsx stop rendering (see
 * GlobeView.jsx — GlobeEventsLayer is no longer mounted there). Same real
 * fetch/register-in-entityStore/click-to-inspect pattern as every other
 * point layer in this file's family, not a bespoke one-off.
 */
import { useState, useEffect, useMemo } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { useCoveredIds } from "./useStrikeSettings.js"
import { MARKER_MAX_CAMERA_M } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { markerIcon } from "../lib/mapIcons.js"
import { useDeclutter } from "./screenDeclutter.js"
import ClusterMark, { useClusterRecords } from "./ClusterMark.jsx"

// The one typology (lib/mapIcons.js): confirmed by an analyst, so a square with the check, neutral; the faction
// (GeoConfirmed's own colour) is in the card only, never on the point.
const ICON = () => markerIcon({ kind: "confirmed", glyph: "check", priority: "alert" })

export default function GlobeGeoConfirmedLayer({ enabled = false, maxAgeDays = 30, theatres = null, endDate = null }) {
    // placemarks a strike pin stands for are drawn as that pin (strikes.js)
    const covered = useCoveredIds()
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

    const marks = useMemo(() => placemarks
        // Number.isFinite, not bare isFinite (isFinite(null) is true)
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && !covered.has(`geoconfirmed-${p.id}`))
        .map((p) => ({ id: `geoconfirmed-${p.id}`, lat: p.lat, lon: p.lon, size: ICON().w, pri: "alert", image: ICON().uri, t: Date.parse(p.date || p.published_at || "") || 0,
                       title: p.title || p.name || "Geolocated event", line: [p.faction, p.date_label].filter(Boolean).join(" · "), p })),
    [placemarks, covered])
    const layout = useDeclutter("geoConfirmed", marks, enabled)
    useClusterRecords(layout)
    if (!enabled || !layout.length) return null
    const ic = ICON()
    return (
        <>
            {layout.map((g) => {
                if (g.cluster) return <ClusterMark key={g.id} g={g} />
                const p = g.item.p
                return (
                    <Entity
                        id={`geoconfirmed-${p.id}`}
                        key={p.id}
                        position={Cartesian3.fromDegrees(p.lon, p.lat, 0)}
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
