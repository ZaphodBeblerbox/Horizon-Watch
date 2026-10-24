/**
 * MiniMap.jsx — where a post happened: a small 2D map under its full view (owner, 2026-10-24). Leaflet with our own
 * tile chain (mobile/tileSources.js: Esri, Esri through our server, Esri's second host, OpenStreetMap), loaded only
 * when a full view with a place opens. One dot at the place, no controls but zoom; a tap on the map can open the
 * main map there (onOpenMap).
 */
import { useEffect, useRef } from "react"

export default function MiniMap({ lat, lon, label, height = 180, zoom = 11, onOpenMap }) {
    const el = useRef(null)
    useEffect(() => {
        if (!el.current || !Number.isFinite(+lat) || !Number.isFinite(+lon)) return undefined
        let map = null, offTiles = null, dead = false
        Promise.all([import("leaflet"), import("../mobile/tileSources.js"), import("leaflet/dist/leaflet.css")]).then(([Lm, tiles]) => {
            if (dead || !el.current) return
            const L = Lm.default || Lm
            map = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, dragging: true, worldCopyJump: true })
                .setView([+lat, +lon], zoom)
            offTiles = tiles.addBaseTiles(L, map, "dark")
            L.circleMarker([+lat, +lon], { radius: 7, weight: 2, color: "#fff", fillColor: "#3d7bf0", fillOpacity: 1 }).addTo(map)
            setTimeout(() => map?.invalidateSize(), 60)
        }).catch(() => {})
        return () => { dead = true; offTiles?.(); map?.remove() }
    }, [lat, lon, zoom])
    return (
        <figure className="dk-map" data-testid="post-map" style={{ margin: 0 }}>
            <div ref={el} style={{ height, width: "100%" }} />
            <figcaption>
                <span>{label || `${(+lat).toFixed(3)}, ${(+lon).toFixed(3)}`}</span>
                {onOpenMap && <button type="button" onClick={onOpenMap}>Open on the map</button>}
            </figcaption>
        </figure>
    )
}
