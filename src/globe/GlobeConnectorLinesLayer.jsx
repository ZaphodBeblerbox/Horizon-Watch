/**
 * GlobeConnectorLinesLayer.jsx — real connector lines from a clicked
 * GeoConfirmed pin to its specifically-linked entities (fix/geoconfirmed-
 * parallax-rebuild, Part 2). A map-level interaction, distinct from (and
 * in addition to) the Ontology graph's own click-to-highlight behavior.
 *
 * Reuses the EXACT SAME real link data Part 1 already established and the
 * Ontology entity panel already shows for the same pin — fetches
 * GET /api/forge/ontology/node/{forge_id}/connections, the same endpoint
 * OntologyCountryGraph.jsx/OntologyPyramid.jsx call — never a second,
 * separate "what's near this pin" query that could disagree with it.
 *
 * Listens for the "akili:geoconfirmed-selected" window event GlobePopup.jsx
 * dispatches whenever a real GeoConfirmed pin becomes (or stops being) the
 * selected popup — a real, clean single source of truth for when to draw
 * or clear lines, rather than this layer tracking clicks itself.
 *
 * A connected entity with no real map coordinates (e.g. a Country/Faction —
 * an abstract node) draws no line to nowhere; it's still real, connected
 * data (shown in the pin's own InspectorPanel via the same real /connections
 * fetch — GlobePopup's normalizeEntity path — not duplicated here).
 */
import { useState, useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, PolylineDashMaterialProperty, Color } from "cesium"
import API_BASE from "../apiBase.js"
import { isRealFiniteNumber, selectRealConnectorTargets } from "./connectorLineGeometry.js"

const LINE_COLOR = Color.fromCssColorString("#E8C547").withAlpha(0.85)

export default function GlobeConnectorLinesLayer({ enabled = true }) {
    const [selected, setSelected] = useState(null)   // {entityId, data}
    const [connections, setConnections] = useState([])

    useEffect(() => {
        function onSelect(e) {
            setSelected(e.detail || null)
        }
        window.addEventListener("akili:geoconfirmed-selected", onSelect)
        return () => window.removeEventListener("akili:geoconfirmed-selected", onSelect)
    }, [])

    useEffect(() => {
        if (!selected?.entityId) { setConnections([]); return }
        // entityStore key is "geoconfirmed-<uuid>" (hyphen); the real forge
        // ontology node id is "geoconfirmed_<uuid>" (underscore) — see
        // geoconfirmed.py's sync_ontology_from_geoconfirmed().
        const forgeId = selected.entityId.replace(/^geoconfirmed-/, "geoconfirmed_")
        let cancelled = false
        fetch(`${API_BASE}/api/forge/ontology/node/${encodeURIComponent(forgeId)}/connections`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled) setConnections(d?.connections || []) })
            .catch(() => { if (!cancelled) setConnections([]) })
        return () => { cancelled = true }
    }, [selected])

    if (!enabled || !selected?.data) return null
    const originLat = selected.data.lat, originLon = selected.data.lon
    if (!isRealFiniteNumber(originLat) || !isRealFiniteNumber(originLon)) {
        if (import.meta.env.DEV) {
            console.warn(`[GlobeConnectorLinesLayer] skipping all connector lines — origin pin ${selected.entityId} has no real finite lat/lon`, selected.data)
        }
        return null
    }

    const realTargets = selectRealConnectorTargets(connections)
    if (import.meta.env.DEV) {
        for (const c of connections) {
            const isReal = isRealFiniteNumber(c.lat) && isRealFiniteNumber(c.lng)
            // Only warn when the entity actually carries a non-null-but-
            // invalid coordinate — a plain null/undefined (an abstract
            // Country/Faction node) is the expected, documented "no
            // drawn line" case, not worth logging every time.
            if (!isReal && (c.lat != null || c.lng != null)) {
                console.warn(`[GlobeConnectorLinesLayer] skipping connector line — entity ${c.id} (${c.type}) has a non-finite coordinate`, { lat: c.lat, lng: c.lng })
            }
        }
    }

    return (
        <>
            {realTargets.map(c => (
                <Entity
                    key={`connector-${selected.entityId}-${c.id}`}
                    polyline={{
                        positions: [
                            Cartesian3.fromDegrees(originLon, originLat, 0),
                            Cartesian3.fromDegrees(c.lng, c.lat, 0),
                        ],
                        width: 2,
                        material: new PolylineDashMaterialProperty({ color: LINE_COLOR, dashLength: 12 }),
                        clampToGround: true,
                    }}
                />
            ))}
        </>
    )
}
