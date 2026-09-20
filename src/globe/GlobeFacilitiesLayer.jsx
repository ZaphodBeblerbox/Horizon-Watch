/**
 * GlobeFacilitiesLayer.jsx — the fixed things worth knowing about.
 *
 * Military bases, hospitals and police stations, which the ontology had
 * none of: 50,686 entities of which 49,260 were airports. The Overpass
 * queries for exactly these categories had been sitting in main.py,
 * referenced from nowhere, the whole time.
 *
 * DRAWN AS SQUARES, because a facility is a surveyed fact about the
 * ground rather than a report (diamond) or a sensor reading (circle).
 * Colour separates the three kinds, since "is there a hospital here" and
 * "is there a barracks here" are different questions asked at different
 * moments.
 *
 * ONLY CLOSE IN. There are hundreds per zone and they are context, not
 * findings — at world zoom they would bury the events this map exists to
 * show. They appear when the camera is near enough for the question to
 * be a local one.
 */
import { useEffect, useRef, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { getFacilityMarkerDataUri, MARK_SIZE } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"

// Country or region scale, never the globe. Nobody needs every hospital
// on earth drawn at once, and at world zoom hundreds per country would
// bury the events this map exists to show. If the layer looks empty,
// that is a coverage gap in the ingest, not a zoom problem.
const MAX_CAMERA_M = 900_000

// The viewport endpoint speaks OSM categories; the ontology endpoint
// speaks entity types. One table, both vocabularies, so a record from
// either route draws the same.
const COLOUR = { military: "#C084FC", medical: "#3DDC97", security: "#3D8BFF" }
const CATEGORY_LABEL = { military: "Military", medical: "Medical",
                         security: "Police & fire" }
const TYPE_TO_CATEGORY = {
    "Military Facility": "military",
    "Medical Facility": "medical",
    "Security Facility": "security",
}

export default function GlobeFacilitiesLayer({ types = [], viewBounds = null }) {
    // An empty list means every row is off, which is different from "no
    // filter" — nothing should draw.
    const enabled = Array.isArray(types) && types.length > 0

    // WHAT WE ARE LOOKING AT, not what we happen to watch. The first cut
    // served only the fifteen strategic zones, so panning to Germany
    // showed nothing at all — infrastructure is a property of the ground,
    // not of whether an analyst drew a box around it. Fetched for the
    // viewport and debounced, the same way ports and airfields already
    // work; the backend persists whatever it finds, so a place visited
    // once stays in the ontology.
    const [rows, setRows] = useState([])
    const timerRef = useRef(null)
    useEffect(() => {
        if (!enabled || !viewBounds || viewBounds.south == null) {
            setRows([])
            return
        }
        let cancelled = false
        const { south, north, west, east } = viewBounds
        const run = () => {
            const q = `min_lat=${south.toFixed(3)}&max_lat=${north.toFixed(3)}`
                    + `&min_lon=${west.toFixed(3)}&max_lon=${east.toFixed(3)}`
            fetch(`${API_BASE}/api/facilities/in-viewport?${q}`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (!cancelled) setRows(safeArray(d?.facilities)) })
                .catch(() => {})
        }
        clearTimeout(timerRef.current)
        // Overpass is a shared free service and panning fires constantly.
        timerRef.current = setTimeout(run, 700)
        return () => { cancelled = true; clearTimeout(timerRef.current) }
    }, [enabled, viewBounds?.south, viewBounds?.north,
        viewBounds?.west, viewBounds?.east]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const ids = []
        rows.forEach((f) => {
            const id = `facility-${f.system_id}`
            ids.push(id)
            setEntity(id, "facility_osm", {
                id, name: f.name || `${String(f.kind || "site").replace(/_/g, " ")} (unnamed)`,
                lat: f.lat, lon: f.lon,
                meta: {
                    kind: String(f.kind || "").replace(/_/g, " "),
                    category: CATEGORY_LABEL[f.category] || f.category,
                    operator: f.operator,
                    // Whether anyone gave it a name, as opposed to this
                    // system labelling it by type — an unnamed bunker is
                    // still a real bunker and should not look like a gap.
                    named: f.named,
                    zone: f.zone_id,
                    source: f.source,
                    source_url: f.source_url,
                },
            })
        })
        return () => ids.forEach(deleteEntity)
    }, [rows])

    if (!enabled || !rows.length) return null
    const wanted = new Set(types.map((t) => TYPE_TO_CATEGORY[t] || t))
    const shown = rows.filter((f) =>
        wanted.has(f.category || TYPE_TO_CATEGORY[f.entity_type]))

    return (
        <>
            {shown.map((f) => {
                if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) return null
                const cat = f.category || TYPE_TO_CATEGORY[f.entity_type]
                const colour = COLOUR[cat]
                if (!colour) return null
                return (
                    <Entity
                        id={`facility-${f.system_id}`}
                        key={f.system_id}
                        position={Cartesian3.fromDegrees(f.lon, f.lat, 0)}
                        name={f.name || f.kind}
                        billboard={{
                            // The glyph says WHICH KIND at a glance — a
                            // cross, a shield, a flame, crossed swords —
                            // which is the thing a reader actually needs
                            // and a coloured square never gave them.
                            image: getFacilityMarkerDataUri({
                                kind: f.kind, color: colour, size: 18,
                            }),
                            width: 18, height: 18,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            distanceDisplayCondition:
                                new DistanceDisplayCondition(0, MAX_CAMERA_M),
                        }}
                    />
                )
            })}
        </>
    )
}
