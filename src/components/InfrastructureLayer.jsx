import { useEffect, useRef, useCallback } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"

function buildOverpassQuery(bbox, types) {
    const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
    const queries = []

    if (types.power) {
        queries.push(`way["power"="line"](${b});`)
        queries.push(`way["power"="cable"](${b});`)
        queries.push(`node["power"="substation"](${b});`)
        queries.push(`way["power"="substation"](${b});`)
        queries.push(`node["power"="generator"](${b});`)
        queries.push(`way["power"="generator"](${b});`)
        queries.push(`node["power"="plant"](${b});`)
        queries.push(`way["power"="plant"](${b});`)
    }
    if (types.telecoms) {
        queries.push(`way["communication"="line"](${b});`)
        queries.push(`node["communication"="tower"](${b});`)
        queries.push(`node["man_made"="communications_tower"](${b});`)
        queries.push(`node["telecom"="data_center"](${b});`)
        queries.push(`way["telecom"="data_center"](${b});`)
    }
    if (types.petroleum) {
        queries.push(`way["pipeline"="yes"](${b});`)
        queries.push(`way["man_made"="pipeline"](${b});`)
        queries.push(`node["man_made"="petroleum_well"](${b});`)
        queries.push(`node["industrial"="oil"](${b});`)
        queries.push(`way["industrial"="oil"](${b});`)
    }
    if (types.water) {
        queries.push(`way["man_made"="water_works"](${b});`)
        queries.push(`way["pipeline"="water"](${b});`)
        queries.push(`node["man_made"="water_tower"](${b});`)
        queries.push(`way["man_made"="water_tower"](${b});`)
    }

    return `[out:json][timeout:25];(${queries.join("")});out geom;`
}

function overpassToGeoJSON(data) {
    const features = []
    for (const el of data.elements) {
        if (el.type === "node" && el.lat !== undefined) {
            features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [el.lon, el.lat] },
                properties: { ...el.tags, osm_id: el.id, osm_type: "node" },
            })
        } else if (el.type === "way" && el.geometry) {
            features.push({
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: el.geometry.map(p => [p.lon, p.lat]),
                },
                properties: { ...el.tags, osm_id: el.id, osm_type: "way" },
            })
        }
    }
    return { type: "FeatureCollection", features }
}

function getStyle(props) {
    const power    = props.power
    const pipeline = props.pipeline || props.man_made
    const comms    = props.communication || props.telecom

    if (power === "line" || power === "cable") {
        const voltage = parseInt(props.voltage) || 0
        return { color: "#E8B23A", weight: voltage >= 220000 ? 2.5 : 1.5, opacity: 0.85, fillOpacity: 0.6 }
    }
    if (power === "substation") {
        return { color: "#E8B23A", weight: 1.5, opacity: 0.8, fillColor: "#E8B23A", fillOpacity: 0.3 }
    }
    if (power === "generator" || power === "plant") {
        return { color: "#5BC97F", weight: 1.5, opacity: 0.8, fillColor: "#5BC97F", fillOpacity: 0.35 }
    }
    if (pipeline === "yes" || pipeline === "pipeline") {
        const substance = props.substance || ""
        return { color: substance.includes("gas") ? "#E55757" : "#ff8c42", weight: 2, opacity: 0.8 }
    }
    if (props.man_made === "petroleum_well" || props.industrial === "oil") {
        return { color: "#E55757", weight: 1.5, opacity: 0.8, fillColor: "#E55757", fillOpacity: 0.6 }
    }
    if (comms === "line" || comms === "tower" || props.man_made === "communications_tower" || comms === "data_center") {
        return { color: "#6C9CE0", weight: 1.5, opacity: 0.75, fillColor: "#6C9CE0", fillOpacity: 0.6 }
    }
    if (props.man_made === "water_works" || props.pipeline === "water" || props.man_made === "water_tower") {
        return { color: "#4A9EE0", weight: 1.5, opacity: 0.75, fillColor: "#4A9EE0", fillOpacity: 0.5 }
    }
    return { color: "#aaaaaa", weight: 1, opacity: 0.5 }
}

function buildPopup(props) {
    const voltageKv = props.voltage ? `${Math.round(parseInt(props.voltage) / 1000)} kV` : null
    const fields = [
        ["Power",     props.power],
        ["Voltage",   voltageKv],
        ["Circuits",  props.circuits],
        ["Operator",  props.operator],
        ["Substance", props.substance],
        ["Diameter",  props.diameter ? `${props.diameter} mm` : null],
        ["Name",      props.name],
        ["Ref",       props.ref],
    ].filter(([, v]) => v)

    const osmUrl = props.osm_id ? `https://www.openstreetmap.org/${props.osm_type || "way"}/${props.osm_id}` : null

    const rows = fields.length
        ? fields.map(([k, v]) => `
            <div style="display:flex;justify-content:space-between;gap:16px;padding:2px 0;border-bottom:1px solid rgba(44,54,69,0.5);">
                <span style="color:#9AA4B5;font-size:11px">${k}</span>
                <span style="color:#E8ECF1;font-size:11px">${v}</span>
            </div>`).join("")
        : `<div style="color:rgba(232,237,242,0.35);font-size:11px;font-style:italic">No attributes</div>`

    return `<div style="background:#1A2433;color:#E8ECF1;padding:10px 14px;border-radius:6px;font-family:Arial,sans-serif;min-width:180px;max-width:260px;border:1px solid #2C3645;">
        ${rows}
        ${osmUrl ? `<div style="margin-top:8px"><a href="${osmUrl}" target="_blank" rel="noopener noreferrer" style="font-size:10px;color:rgba(232,237,242,0.4);text-decoration:none">↗ View on OpenStreetMap</a></div>` : ""}
    </div>`
}

export default function InfrastructureLayer({ enabled, types }) {
    const map      = useMap()
    const layerRef = useRef(null)
    const abortRef = useRef(null)

    const loadData = useCallback(async () => {
        if (!enabled) return

        if (abortRef.current) abortRef.current.abort()
        abortRef.current = new AbortController()

        if (map.getZoom() < 7) return

        const b = map.getBounds()
        const bbox = {
            south: b.getSouth().toFixed(4),
            west:  b.getWest().toFixed(4),
            north: b.getNorth().toFixed(4),
            east:  b.getEast().toFixed(4),
        }

        const area = (bbox.north - bbox.south) * (bbox.east - bbox.west)
        if (area > 5) return

        const activeTypes = {
            power:     types?.power     ?? true,
            telecoms:  types?.telecoms  ?? true,
            petroleum: types?.petroleum ?? true,
            water:     types?.water     ?? true,
        }

        if (!Object.values(activeTypes).some(Boolean)) return

        const query = buildOverpassQuery(bbox, activeTypes)
        const url   = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`

        try {
            const res  = await fetch(url, { signal: abortRef.current.signal })
            if (!res.ok) {
                console.warn("[InfrastructureLayer] Overpass returned", res.status)
                return
            }
            const json   = await res.json()
            const geojson = overpassToGeoJSON(json)

            if (layerRef.current) {
                map.removeLayer(layerRef.current)
                layerRef.current = null
            }

            layerRef.current = L.geoJSON(geojson, {
                style: (feature) => getStyle(feature.properties),
                pointToLayer: (feature, latlng) =>
                    L.circleMarker(latlng, { radius: 5, ...getStyle(feature.properties) }),
                onEachFeature: (feature, layer) => {
                    layer.bindPopup(buildPopup(feature.properties), {
                        className: "infra-popup",
                        maxWidth: 280,
                    })
                },
            }).addTo(map)

        } catch (err) {
            if (err.name !== "AbortError") console.warn("[InfrastructureLayer] fetch failed:", err)
        }
    }, [map, enabled, types])

    useEffect(() => {
        if (!enabled) {
            if (layerRef.current) {
                map.removeLayer(layerRef.current)
                layerRef.current = null
            }
            return
        }

        loadData()
        map.on("moveend", loadData)
        return () => {
            map.off("moveend", loadData)
            if (abortRef.current) abortRef.current.abort()
        }
    }, [enabled, map, loadData])

    useEffect(() => {
        return () => {
            if (layerRef.current) {
                try { map.removeLayer(layerRef.current) } catch (_) {}
                layerRef.current = null
            }
            if (abortRef.current) abortRef.current.abort()
        }
    }, [map])

    return null
}
