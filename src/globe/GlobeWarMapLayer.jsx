/**
 * GlobeWarMapLayer.jsx — who holds which town, for the wars without polygons.
 *
 * I TOLD THE USER THESE DID NOT EXIST. Four guessed REST URLs returned
 * nothing and I concluded no open source published control data for Sudan
 * or Yemen. Wikipedia has maintained community-edited war maps for over a
 * decade — Yemen carries 1,286 marks and was edited three days ago. They
 * are Lua data modules behind the MediaWiki API, which a REST-shaped
 * search will never find.
 *
 * POINTS, NOT POLYGONS, and never drawn as a line. DeepStateMap gives
 * Ukraine a continuous front; this gives settlement-level control, which
 * is a different claim. Interpolating a front line between these points
 * would be inventing geometry no editor asserted.
 *
 * COLOUR IS A FACTION AND WHICH FACTION DEPENDS ON THE WAR — red is Russia
 * in Ukraine and the recognised government in Yemen. The backend names
 * them only where the module's own documentation says so, and this layer
 * shows the colour either way rather than guessing a name.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { getShapeMarkerDataUri, MARK_SIZE, MARKER_MAX_CAMERA_M } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const REFRESH_MS = 6 * 60 * 60 * 1000       // these are edited daily at most

// The editors' own palette, kept rather than remapped: a reader comparing
// this layer against the Wikipedia map it came from should see the same
// colours.
const COLOUR_HEX = {
    green: "#0f9d58", red: "#c4453c", blue: "#3D8BFF", yellow: "#E8C547",
    purple: "#C084FC", grey: "#9AA4B5", black: "#2b2f36", orange: "#FF8A3D",
}

export default function GlobeWarMapLayer({ theatre = null, enabled = false }) {
    const [data, setData] = useState(null)

    useEffect(() => {
        if (!enabled || !theatre) { setData(null); return }
        let cancelled = false
        const load = () => {
            fetch(`${API_BASE}/api/warmap/${encodeURIComponent(theatre)}`,
                  { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (!cancelled && d?.available) setData(d) })
                .catch(() => {})
        }
        load()
        const h = setInterval(load, REFRESH_MS)
        return () => { cancelled = true; clearInterval(h) }
    }, [enabled, theatre])

    useEffect(() => {
        if (!data) return
        const ids = []
        safeArray(data.points).forEach((p, i) => {
            const id = `warmap-${data.theatre}-${i}`
            ids.push(id)
            setEntity(id, "warmap_point", {
                id, name: p.label || "Control point",
                lat: p.lat, lon: p.lon,
                meta: {
                    held_by: p.faction || `unnamed faction (${p.colour})`,
                    theatre: data.label,
                    // Said on every point, because a reader who sees a
                    // confident dot needs to know an editor put it there.
                    basis: "community-edited Wikipedia war map",
                    last_edited: data.last_edited,
                    caveat: data.caveat,
                    source: data.source,
                    source_url: data.source_url,
                },
            })
        })
        return () => ids.forEach(deleteEntity)
    }, [data])

    if (!enabled || !data?.available) return null
    const pts = safeArray(data.points)

    return (
        <>
            {pts.map((p, i) => {
                if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null
                const colour = COLOUR_HEX[p.colour] || COLOUR_HEX.grey
                const held = p.faction || `unnamed faction (${p.colour})`
                return (
                    <Entity
                        id={`warmap-${data.theatre}-${i}`}
                        key={`${data.theatre}-${i}`}
                        position={Cartesian3.fromDegrees(p.lon, p.lat, 0)}
                        name={p.label || "Control point"}
                        billboard={{
                            // A circle: this is an assertion of control at a
                            // place, not a verified event (square) or a
                            // report (diamond).
                            image: getShapeMarkerDataUri({
                                shape: "circle", color: colour,
                                size: MARK_SIZE.fire, strokeWidth: 1.5,
                            }),
                            width: MARK_SIZE.fire, height: MARK_SIZE.fire,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            distanceDisplayCondition:
                                new DistanceDisplayCondition(0, MARKER_MAX_CAMERA_M),
                        }}
                        description={
                            `<div style="font:400 12px sans-serif">`
                            + `<b>${p.label || "Control point"}</b><br/>`
                            + `held by ${held}<br/>`
                            + `<span style="opacity:.6">${data.source} · edited `
                            + `${String(data.last_edited || "").slice(0, 10)}</span></div>`
                        }
                    />
                )
            })}
        </>
    )
}
