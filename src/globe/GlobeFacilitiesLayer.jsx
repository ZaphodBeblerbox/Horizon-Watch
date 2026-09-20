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
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { getShapeMarkerDataUri, MARK_SIZE } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"

// Visible to regional zoom. The first cut capped this at 900km, which
// meant the layer was invisible at every zoom a person actually starts
// from and read as "facilities don't render". They are still context
// rather than findings, so they stop short of world view where they
// would bury the events this map exists to show.
const MAX_CAMERA_M = 6_000_000

const STYLE = {
    "Military Facility": { colour: "#C084FC", label: "Military" },
    "Medical Facility":  { colour: "#3DDC97", label: "Medical" },
    "Security Facility": { colour: "#3D8BFF", label: "Police & fire" },
}

export default function GlobeFacilitiesLayer({ types = [] }) {
    // An empty list means every row is off, which is different from "no
    // filter" — nothing should draw.
    const enabled = Array.isArray(types) && types.length > 0
    const [rows, setRows] = useState([])

    useEffect(() => {
        if (!enabled) { setRows([]); return }
        let cancelled = false
        fetch(`${API_BASE}/api/facilities?limit=6000`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled) setRows(safeArray(d?.facilities)) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [enabled])

    useEffect(() => {
        const ids = []
        rows.forEach((f) => {
            const id = `facility-${f.system_id}`
            ids.push(id)
            setEntity(id, "facility_osm", {
                id, name: f.name, lat: f.lat, lon: f.lon,
                meta: {
                    kind: String(f.kind || "").replace(/_/g, " "),
                    category: STYLE[f.entity_type]?.label || f.entity_type,
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
    const shown = rows.filter((f) => types.includes(f.entity_type))

    return (
        <>
            {shown.map((f) => {
                if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) return null
                const st = STYLE[f.entity_type]
                if (!st) return null
                return (
                    <Entity
                        id={`facility-${f.system_id}`}
                        key={f.system_id}
                        position={Cartesian3.fromDegrees(f.lon, f.lat, 0)}
                        name={f.name}
                        billboard={{
                            image: getShapeMarkerDataUri({
                                shape: "square", color: st.colour,
                                size: MARK_SIZE.fire, strokeWidth: 1.5,
                            }),
                            width: MARK_SIZE.fire, height: MARK_SIZE.fire,
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
