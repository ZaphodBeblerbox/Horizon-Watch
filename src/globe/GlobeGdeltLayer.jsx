/**
 * GlobeGdeltLayer.jsx — machine-coded news events, drawn only when they can
 * say what happened, where, and on whose word.
 *
 * SEPARATE FROM GEOCONFIRMED ON PURPOSE. A GeoConfirmed square is a human
 * who found the building in the video. A GDELT diamond is a machine that
 * read a wire story and geocoded a place the article mentioned. Both belong
 * on the map; presenting them at the same weight would be the lie.
 *
 * The backend does the hard filtering (gdelt_events.map_points): city-level
 * coordinate, kinetic event, a real article URL, a readable headline —
 * roughly one event in forty survives. Verbal events are never drawn at all,
 * because GDELT places them at a location NAMED IN THE ARTICLE: observed
 * live, "Guterres disapproves of the US" was placed in Tehran because the
 * piece was about Iran. Their value is the tone trend, not a pin.
 *
 * Same fetch / register-in-entityStore / click-to-inspect pattern as every
 * other point layer here, not a bespoke one-off.
 */
import { useState, useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { getShapeMarkerDataUri, MARK_SIZE, MARKER_MAX_CAMERA_M } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const MARKER_SIZE = MARK_SIZE.gdelt
// GDELT publishes a new export every 15 minutes and the backend loop
// ingests on that cadence, so polling faster than the data changes is
// waste and polling slower makes the map stale. Three minutes keeps a
// newly-ingested slice on screen within one publish interval.
const REFRESH_MS = 3 * 60 * 1000

/**
 * Colour by how conflictual the coding is, not by event type.
 *
 * Goldstein runs -10 (use of force) to +10 (cooperation). The reader cares
 * how bad it is, and the shape already says what kind of source it came
 * from, so colour is free to carry severity.
 */
function colourFor(goldstein) {
    const g = typeof goldstein === "number" ? goldstein : 0
    if (g <= -8) return "var(--sev-critical, #d4553f)"
    if (g <= -5) return "var(--sev-high, #e8a33d)"
    if (g < 0) return "var(--sev-medium, #c9a227)"
    return "var(--txt-4, #6f8fa8)"
}

/**
 * Which CAMEO codings a reader wants on the map.
 *
 * GDELT's kinetic root codes are not equally interesting and the mix
 * changes by theatre: "Fight" and "Assault" are what happened, "Coerce"
 * and "Protest" are pressure, "Reject" is talk. Filtering is per-type
 * rather than a single severity slider because the reader's question
 * ("show me violence, hide the diplomacy") is about kind, not degree.
 */
export const GDELT_EVENT_TYPES = [
    { key: "Fight", label: "Fight / armed clash" },
    { key: "Assault", label: "Assault" },
    { key: "Coerce", label: "Coerce" },
    { key: "Protest", label: "Protest" },
    { key: "Threaten", label: "Threaten" },
    { key: "Reduce relations", label: "Reduce relations" },
]

export default function GlobeGdeltLayer({ enabled = false, limit = 500, types = null }) {
    const [points, setPoints] = useState([])

    useEffect(() => {
        if (!enabled) { setPoints([]); return }
        let cancelled = false
        const load = () => {
            fetch(`${API_BASE}/api/gdelt/map-points?limit=${limit}`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (!cancelled) setPoints(safeArray(d?.points)) })
                .catch(() => { /* a dropped poll is not an empty world */ })
        }
        load()
        const h = setInterval(load, REFRESH_MS)
        return () => { cancelled = true; clearInterval(h) }
    }, [enabled, limit])

    // Register for the inspector, and clean up on unmount so a toggled-off
    // layer does not leave selectable ghosts behind.
    useEffect(() => {
        const ids = []
        points.forEach((p) => {
            if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return
            const id = `gdelt-${p.id}`
            ids.push(id)
            // setEntity(id, TYPE, data) — three arguments. Passing the
            // object alone stored it as the TYPE with data undefined, so
            // the inspector opened empty on every click.
            setEntity(id, "gdelt_event", {
                id,
                kind: "gdelt_event",
                name: p.title,
                lat: p.lat,
                lon: p.lon,
                // Everything the inspector needs to let a person check the
                // claim themselves. A pin the reader cannot verify is worse
                // than no pin.
                meta: {
                    context: p.context,
                    location: p.location_name,
                    date: p.date,
                    source_url: p.source_url,
                    event_type: p.event_type,
                    goldstein: p.goldstein,
                    tone: p.tone,
                    mentions: p.mentions,
                    confidence: p.confidence,
                    geo_precision: p.geo_precision,
                },
            })
        })
        return () => ids.forEach(deleteEntity)
    }, [points])

    // `types` null means no filter at all, which is different from an
    // empty set — an empty set is a reader who has deselected everything
    // and should see nothing, not everything.
    const shown = types
        ? points.filter((p) => {
            const list = p.event_types?.length ? p.event_types : [p.event_type]
            return list.some((t) => types.includes(t))
        })
        : points

    if (!enabled || !shown.length) return null

    return (
        <>
            {shown.map((p) => {
                if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null
                return (
                    <Entity
                        id={`gdelt-${p.id}`}
                        key={p.id}
                        position={Cartesian3.fromDegrees(p.lon, p.lat, 0)}
                        name={p.title}
                        description={
                            `<div style="font:400 12px sans-serif">`
                            + `<b>${p.title}</b><br/>`
                            + `${p.context}<br/>`
                            + `<span style="opacity:.7">${p.location_name}</span><br/>`
                            + `<a href="${p.source_url}" target="_blank" rel="noopener">source article</a>`
                            + `<br/><span style="opacity:.55">machine-coded from news text</span>`
                            + `</div>`
                        }
                        billboard={{
                            // Diamond: reporting. Square is reserved for
                            // human-verified ground truth.
                            image: getShapeMarkerDataUri({
                                shape: "diamond",
                                color: colourFor(p.goldstein),
                                size: MARKER_SIZE,
                            }),
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
