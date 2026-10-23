import { useState, useEffect, useRef, useMemo } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, DistanceDisplayCondition } from "cesium"
import { SIZE } from "../lib/mapIcons.js"
import { useDeclutter } from "./screenDeclutter.js"
import ClusterBadges from "./ClusterBadges.jsx"
import API_BASE from "../apiBase.js"
import { infraGlyphUri } from "./infraGlyphs.js"
import { setEntity, deleteEntity } from "./entityStore.js"

// Airports are real, non-flagged aviation infrastructure. The new outline-
// icon system has one shared "facility" glyph for all infrastructure
// (matching src/inspector/adapters.js's adaptInfrastructure(), which already
// collapses airports/ports/cables/pipelines/etc. to entityType "facility"
// for InspectorPanel — same real distinction, same resolution, applied
// consistently here). Importance tier is in the card, not the size.
// §I6.2 — one runway, two threshold bars, a terminal set clear of the strip.
// Never a plane: "a plane on the ground must not be the same mark as a plane
// in the air — that is a different object with different consequences." On a
// map already showing live ADS-B, that is not a style preference.
function getIcon() {
    return infraGlyphUri("airport")
}

// ONE SIZE whatever the class (owner, 2026-10-23: no marker grows with data): infrastructure context is
// lib/mapIcons.js SIZE.infra; the class is in the card.

export default function GlobeAirportLayer({ enabled, viewBounds }) {
    const [airports, setAirports] = useState([])
    const timerRef = useRef(null)

    useEffect(() => {
        if (!enabled) { setAirports([]); return }

        const fetch_ = () => {
            let url
            if (viewBounds && viewBounds.south != null) {
                const { south, north, west, east } = viewBounds
                url = `${API_BASE}/api/airports/in-viewport?min_lat=${south.toFixed(4)}&max_lat=${north.toFixed(4)}&min_lon=${west.toFixed(4)}&max_lon=${east.toFixed(4)}`
            } else {
                // No bounds yet (zoomed out to whole globe) — skip fetch; too many results
                setAirports([])
                return
            }
            fetch(url)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d) setAirports(d.features || []) })
                .catch(() => {})
        }

        // Debounce: viewBounds changes fire rapidly during panning
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(fetch_, 300)

        return () => clearTimeout(timerRef.current)
    }, [enabled, viewBounds?.south, viewBounds?.north, viewBounds?.west, viewBounds?.east]) // eslint-disable-line react-hooks/exhaustive-deps

    // Register in entityStore so GlobePopup can dispatch on click
    useEffect(() => {
        if (!airports.length) return
        const ids = []
        airports.forEach(f => {
            const id = `airport-${f.properties?.system_id}`
            // The GeoJSON WRAPPER was being registered, so the inspector saw
            // {type, geometry, properties} and no name — which is why a
            // clicked airport showed nothing but the word "airport". Flatten the
            // properties and carry the coordinates alongside them.
            const [lon, lat] = f.geometry?.coordinates || []
            setEntity(id, "airport", { ...(f.properties || {}), lat, lon })
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [airports])

    // ONE COLLISION PASS with every other point layer (screenDeclutter.js): no overlapping markers
    const items = useMemo(() => airports.map((f) => {
        const p = f.properties || {}
        const [lon, lat] = f.geometry?.coordinates || []
        return { id: `airport-${p.system_id}`, lat, lon, size: SIZE.infra, pri: null, image: getIcon(p.airport_type || "small_airport"), title: p.airport_name || p.name || p.ident || "Airport", line: [p.iata_code || p.icao_code, p.municipality, p.country_name].filter(Boolean).join(" · ") }
    }).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)), [airports])
    const layout = useDeclutter("airports", items, !!enabled)
    const single = new Set(layout.filter((g) => !g.cluster).map((g) => g.id))

    if (!enabled || !airports.length) return null

    return (
        <>
            <ClusterBadges layout={layout} />
            {airports.map(f => {
                const p = f.properties || {}
                const [lon, lat] = f.geometry?.coordinates || []
                // Number.isFinite (never Number.isFinite(null) === true like
                // bare isFinite(null)) — same real crash class fixed in
                // GlobeConnectorLinesLayer.jsx: a null coordinate must never
                // reach Cesium's fromDegrees().
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
                if (!single.has(`airport-${p.system_id}`)) return null
                const icon = getIcon(p.airport_type || "small_airport")
                if (!icon) return null
                const sz = SIZE.infra

                return (
                    <Entity
                        id={`airport-${p.system_id}`}
                        key={p.system_id}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image:           icon,
                            width:           sz,
                            height:          sz,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 12_000_000),
                            eyeOffset: new (Cartesian3)(0, 0, -80),
                        }}
                    />
                )
            })}
        </>
    )
}
