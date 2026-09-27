/**
 * GlobeGfwLayer.jsx — Global Fishing Watch events on the globe.
 *
 * The part of the ocean our own receivers cannot hear. Our AIS is
 * terrestrial and Europe-heavy; GFW processes satellite AIS worldwide,
 * so this is what fills in Hormuz, Malacca and the South Atlantic.
 *
 * DRAWN HOLLOW, ON PURPOSE. Filled marks on this map mean "a thing is
 * here now". These are records of something that finished happening
 * days ago — GFW publishes after processing, three to five days behind
 * — so they are drawn as outlines and every inspector card leads with
 * how old the feed is. Nothing here should ever be mistaken for a live
 * contact.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Color, HeightReference, DistanceDisplayCondition, NearFarScalar } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { getShapeMarkerDataUri, MARKER_MAX_CAMERA_M, MARKER_DEPTH_TEST_M } from "./entityIcons.js"
import { safeCartesian } from "./markerOrientation.js"
import { styleFor, summaryOf, ageLabel, freshnessNote } from "./gfwEvents.js"

const SIZE = 15
const REFRESH_MS = 15 * 60 * 1000   // the feed moves in days; this is generous

export default function GlobeGfwLayer({ enabled = false, kinds = [], days = 14, limit = 300 }) {
    const [byKind, setByKind] = useState({})

    const wanted = kinds.join(",")

    useEffect(() => {
        if (!enabled || !wanted) { setByKind({}); return }
        let cancelled = false

        const load = () => {
            Promise.all(wanted.split(",").map((kind) =>
                fetch(`${API_BASE}/api/gfw/events?kind=${encodeURIComponent(kind)}`
                      + `&days=${days}&limit=${limit}`, { credentials: "include" })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((d) => [kind, d])
                    .catch(() => [kind, null])
            )).then((pairs) => {
                if (cancelled) return
                const next = {}
                for (const [kind, d] of pairs) {
                    if (d?.available) next[kind] = d
                }
                setByKind(next)
            })
        }
        load()
        const t = setInterval(load, REFRESH_MS)
        return () => { cancelled = true; clearInterval(t) }
    }, [enabled, wanted, days, limit])

    // Register for the inspector, and clean up what we registered.
    useEffect(() => {
        const ids = []
        for (const [kind, d] of Object.entries(byKind)) {
            const note = freshnessNote(d.lag_days)
            for (const ev of safeArray(d.events)) {
                if (!ev?.id) continue
                const id = `gfw-${kind}-${ev.id}`
                setEntity(id, "gfw_event", {
                    id,
                    name: summaryOf(ev),
                    meta: {
                        event: styleFor(kind).label,
                        when: ev.start,
                        age: ageLabel(ev.start),
                        // The vessels as STRUCTURE, not as one pre-joined
                        // string. A detection whose whole subject is "which
                        // ships were here" has to hand the inspector the
                        // ships, so it can look up where each one is now
                        // rather than printing a sentence nobody can act on.
                        vessel_list: (ev.vessels || []).map((v) => ({
                            name: v.name || null, mmsi: v.mmsi || null,
                            flag: v.flag || null, type: v.type || null,
                        })),
                        vessels: (ev.vessels || [])
                            .map((v) => [v.name, v.mmsi && `MMSI ${v.mmsi}`, v.flag]
                                .filter(Boolean).join(" · "))
                            .join("  |  ") || null,
                        // Where it happened, so the inspector can contrast it
                        // with where the vessels are now.
                        detected_lat: ev.lat, detected_lon: ev.lon,
                        end: ev.end || null,
                        // GFW's assessment stays labelled as GFW's.
                        gfw_potential_risk: ev.gfw_potential_risk,
                        encounter_type: ev.encounter_type,
                        median_distance_km: ev.median_distance_km,
                        km_from_shore: ev.km_from_shore,
                        high_seas: ev.high_seas,
                        freshness: note,
                        source: d.source,
                        source_url: d.source_url,
                    },
                })
                ids.push(id)
            }
        }
        return () => ids.forEach(deleteEntity)
    }, [byKind])

    if (!enabled) return null

    return (
        <>
            {Object.entries(byKind).flatMap(([kind, d]) => {
                const style = styleFor(kind)
                const icon = getShapeMarkerDataUri({
                    shape: style.shape, color: style.color, size: SIZE,
                    // Hollow: these are records, not live contacts.
                    invert: true, strokeWidth: 1.6,
                })
                return safeArray(d.events).map((ev) => {
                    const position = safeCartesian(ev.lon, ev.lat, 0)
                    if (!position || !ev.id) return null
                    return (
                        <Entity
                            key={`gfw-${kind}-${ev.id}`}
                            id={`gfw-${kind}-${ev.id}`}
                            name={summaryOf(ev)}
                            position={position}
                            billboard={{
                                image: icon,
                                width: SIZE, height: SIZE,
                                heightReference: HeightReference.CLAMP_TO_GROUND,
                                disableDepthTestDistance: MARKER_DEPTH_TEST_M,
                                distanceDisplayCondition:
                                    new DistanceDisplayCondition(0, MARKER_MAX_CAMERA_M),
                                scaleByDistance: new NearFarScalar(1e5, 1.0, 2e7, 0.75),
                            }}
                        />
                    )
                })
            })}
        </>
    )
}
