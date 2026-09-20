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
import { crossfade, progress } from "./frontlineFade.js"
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

export default function GlobeWarMapLayer({ theatre = null, enabled = false, revid = null }) {
    const { viewer } = useCesium()
    const dsRef = useRef(null)
    const idsRef = useRef([])
    const fadingRef = useRef(null)
    const rafRef = useRef(0)
    const clearRef = useRef(null)
    // Which theatre is drawn, so a change of COUNTRY cuts rather than
    // fades — two countries dissolving into each other is not a
    // transition between two states of the same front.
    const theatreRef = useRef(null)

    useEffect(() => {
        if (!viewer) return
        let cancelled = false

        const drop = (ds, ids) => {
            (ids || []).forEach(deleteEntity)
            if (ds && !viewer.isDestroyed?.()) {
                try { viewer.dataSources.remove(ds, true) } catch { /* torn down */ }
            }
        }

        const settle = () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
            if (fadingRef.current) {
                drop(fadingRef.current.ds, fadingRef.current.ids)
                fadingRef.current = null
            }
        }

        const clear = () => {
            settle()
            drop(dsRef.current, idsRef.current)
            idsRef.current = []
            dsRef.current = null
        }

        const applyAlpha = (ds, k) => {
            if (!ds) return
            ds.entities.values.forEach((e) => {
                if (e.polygon && e.__fill) {
                    e.polygon.material = Color.fromCssColorString(e.__fill).withAlpha(FILL_ALPHA * k)
                }
            })
        }

        clearRef.current = clear

        if (!enabled || !theatre) { clear(); theatreRef.current = null; return }

        // A different country is not a later state of this one.
        if (theatreRef.current && theatreRef.current !== theatre) clear()
        theatreRef.current = theatre

        const load = () => {
            // A revision id scrubs the same derivation back in time; the
            // live path and the historical one share polygons_from() so a
            // past front is never drawn by a slightly different routine.
            const url = revid
                ? `${API_BASE}/api/warmap/${encodeURIComponent(theatre)}/polygons/at/${revid}`
                : `${API_BASE}/api/warmap/${encodeURIComponent(theatre)}/polygons`
            fetch(url, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then(async (d) => {
                    if (cancelled || !d?.geojson?.features?.length) return
                    const ds = await CesiumGeoJsonDataSource.load(d.geojson, {
                        stroke: Color.TRANSPARENT,
                        fill: Color.TRANSPARENT,
                        clampToGround: true,
                    })
                    if (cancelled || viewer.isDestroyed?.()) { ds.destroy(); return }

                    const ids = []
                    ds.entities.values.forEach((entity) => {
                        const raw = entity.properties?.getValue?.(_TIME) || {}
                        const hex = COLOUR_HEX[raw.colour] || COLOUR_HEX.grey
                        // The backend already words an unidentified side;
                        // this must not invent a second phrasing for it.
                        const held = raw.faction || `unidentified side (${raw.colour})`
                        if (entity.polygon) {
                            entity.__fill = hex
                            // Starts invisible and is faded up below.
                            entity.polygon.material =
                                Color.fromCssColorString(hex).withAlpha(0)
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
                                viewing: revid
                                    ? `historical — ${String(d.last_edited).slice(0, 10)}`
                                    : "current",
                                caveat: d.caveat,
                                source: d.source,
                                source_url: d.source_url,
                            },
                        })
                        ids.push(id)
                    })
                    // Crossfade, for the same reason as the Ukraine
                    // layer: scrubbing used to tear this map down before
                    // the next revision had been requested, and only
                    // opacity may move between two surveyed states.
                    settle()
                    const outgoing = dsRef.current
                        ? { ds: dsRef.current, ids: idsRef.current } : null
                    fadingRef.current = outgoing
                    idsRef.current = ids
                    dsRef.current = ds
                    viewer.dataSources.add(ds)

                    if (!outgoing) { applyAlpha(ds, 1); return }

                    const t0 = performance.now()
                    const step = () => {
                        if (viewer.isDestroyed?.()) return
                        const t = progress(performance.now(), t0)
                        const { outgoing: o, incoming: i } = crossfade(t)
                        applyAlpha(ds, i)
                        applyAlpha(outgoing.ds, o)
                        viewer.scene?.requestRender?.()
                        if (t < 1) { rafRef.current = requestAnimationFrame(step); return }
                        rafRef.current = 0
                        fadingRef.current = null
                        drop(outgoing.ds, outgoing.ids)
                    }
                    rafRef.current = requestAnimationFrame(step)
                })
                .catch(() => { /* a dropped poll is not a change of control */ })
        }

        load()
        const h = setInterval(load, REFRESH_MS)
        // Not clear() — see GlobeFrontlinesLayer. Tearing down here
        // emptied the theatre the moment the revision slider moved.
        return () => { cancelled = true; clearInterval(h) }
    }, [viewer, enabled, theatre, revid])

    useEffect(() => () => { clearRef.current?.(); clearRef.current = null }, [])

    return null
}
