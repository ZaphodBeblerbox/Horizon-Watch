/**
 * GlobeWarMapLayer.jsx — who holds what ground, for the wars without polygons.
 *
 * I TOLD THE USER THESE DID NOT EXIST. Four guessed REST URLs returned
 * nothing and I concluded no open source published control data for Sudan
 * or Yemen. Wikipedia has maintained community-edited war maps for over a
 * decade — Yemen carries 1,270 marks and was edited three days ago. They
 * are Lua data modules behind the MediaWiki API, which a REST-shaped
 * search will never find.
 *
 * THE AREAS ARE DERIVED AND SAY SO. The source gives points. DeepStateMap's
 * Ukraine polygons are drawn by an analyst who decided where the line
 * runs; these are computed by asking which control point each spot is
 * nearest to. That is a reasonable estimate of a front and is not a survey
 * of one, and the difference travels with every feature rather than being
 * flattened into an identical-looking shape.
 *
 * Rendered through GeoJsonDataSource with clampToGround, the same path
 * GlobeFrontlinesLayer uses — hand-built PolygonGraphics create fine and
 * draw nothing, which cost three attempts to learn once already.
 */
import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import { GeoJsonDataSource as CesiumGeoJsonDataSource, Color, JulianDate } from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const REFRESH_MS = 6 * 60 * 60 * 1000       // these are edited daily at most
const _TIME = JulianDate.now()

// The editors' own palette, kept rather than remapped: a reader comparing
// this against the Wikipedia map it came from should see the same colours.
const COLOUR_HEX = {
    green: "#0f9d58", red: "#c4453c", blue: "#3D8BFF", yellow: "#E8C547",
    purple: "#C084FC", grey: "#9AA4B5", black: "#2b2f36", orange: "#FF8A3D",
}

// Matched to the Ukraine layer's weight so the two read as one map.
const FILL_ALPHA = 0.32

export default function GlobeWarMapLayer({ theatre = null, enabled = false }) {
    const { viewer } = useCesium()
    const dsRef = useRef(null)
    const idsRef = useRef([])

    useEffect(() => {
        if (!viewer) return
        let cancelled = false

        const clear = () => {
            idsRef.current.forEach(deleteEntity)
            idsRef.current = []
            if (dsRef.current && !viewer.isDestroyed?.()) {
                try { viewer.dataSources.remove(dsRef.current, true) } catch { /* torn down */ }
            }
            dsRef.current = null
        }

        if (!enabled || !theatre) { clear(); return }

        const load = () => {
            fetch(`${API_BASE}/api/warmap/${encodeURIComponent(theatre)}/polygons`,
                  { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then(async (d) => {
                    if (cancelled || !d?.geojson?.features?.length) return
                    const ds = await CesiumGeoJsonDataSource.load(d.geojson, {
                        stroke: Color.TRANSPARENT,
                        fill: Color.TRANSPARENT,
                        clampToGround: true,
                    })
                    if (cancelled || viewer.isDestroyed?.()) { ds.destroy(); return }
                    clear()

                    const ids = []
                    ds.entities.values.forEach((entity) => {
                        const raw = entity.properties?.getValue?.(_TIME) || {}
                        const hex = COLOUR_HEX[raw.colour] || COLOUR_HEX.grey
                        const held = raw.faction || `unnamed faction (${raw.colour})`
                        if (entity.polygon) {
                            entity.polygon.material =
                                Color.fromCssColorString(hex).withAlpha(FILL_ALPHA)
                            entity.polygon.outline = false
                        }
                        entity.name = held
                        const id = entity.id
                        setEntity(id, "warmap_area", {
                            id, name: held,
                            meta: {
                                held_by: held,
                                theatre: d.label,
                                // WHAT KIND OF LINE THIS IS. The single most
                                // important thing to say about a shape that
                                // looks exactly like a surveyed front.
                                boundary: raw.how,
                                basis: "community-edited Wikipedia war map, "
                                     + "control points interpolated into areas",
                                last_edited: d.last_edited,
                                caveat: d.caveat,
                                source: d.source,
                                source_url: d.source_url,
                            },
                        })
                        ids.push(id)
                    })
                    idsRef.current = ids
                    dsRef.current = ds
                    viewer.dataSources.add(ds)
                })
                .catch(() => { /* a dropped poll is not a change of control */ })
        }

        load()
        const h = setInterval(load, REFRESH_MS)
        return () => { cancelled = true; clearInterval(h); clear() }
    }, [viewer, enabled, theatre])

    return null
}
