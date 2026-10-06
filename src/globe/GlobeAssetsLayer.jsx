/**
 * GlobeAssetsLayer.jsx — our assets on the map.
 *
 * Each registered asset (destinations/Assets.jsx) is a pin with its kind's
 * symbol on the register's gold, ringed in the colour of how exposed it is
 * right now (high, elevated, low, quiet). Close in, its name shows and its
 * watch radius is drawn on the ground. A click opens it in the register.
 * Vessels and aircraft are where the live feeds last saw them.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, DistanceDisplayCondition, HeightReference, LabelStyle, VerticalOrigin, Cartesian2, NearFarScalar } from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const GLYPH = {
    Vessels: "M3 15h18l-2.5 4.5H5.5zM6 15V9h7l3 6M9 9V5.5h2.5V9",
    Aircraft: "M12 3v18M12 9l9 4v2l-9-2.5M12 9l-9 4v2l9-2.5M9.5 20l2.5-1.5 2.5 1.5",
    Vehicles: "M3 16V9.5l2.5-3h9l3 4H21V16zM6.5 18.5a1.8 1.8 0 100-.01M16.5 18.5a1.8 1.8 0 100-.01",
    Sites: "M3 20V10l5 3V10l5 3V7h3v13zM18 20V4h3v16",
    Energy: "M13 2L5 13h6l-1 9 8-11h-6z",
    Transport: "M4 20h16M6 20V12h12v8M9 12V7h6v5M12 7V3",
    People: "M12 4a3.2 3.2 0 100 6.4A3.2 3.2 0 0012 4zM5 20c.8-4 3.6-6 7-6s6.2 2 7 6",
}
const RING = { high: "#E5484D", elevated: "#F5A524", low: "#8FB4E8", quiet: "#4CAF7A", unknown: "#9AA9BC" }
const _icons = {}
function icon(group, exposure) {
    const key = `${group}|${exposure}`
    if (_icons[key]) return _icons[key]
    const ring = RING[exposure] || RING.unknown
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="56" viewBox="0 0 48 56">
      <path d="M24 55 L16 44 H8 a6 6 0 0 1 -6 -6 V8 a6 6 0 0 1 6 -6 H40 a6 6 0 0 1 6 6 V38 a6 6 0 0 1 -6 6 H32 Z" fill="#0b1220" stroke="${ring}" stroke-width="3.5"/>
      <rect x="7" y="7" width="34" height="32" rx="4" fill="#C9A227"/>
      <g transform="translate(10 9) scale(1.17)" fill="none" stroke="#0b1220" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${GLYPH[group] || GLYPH.Sites}"/></g>
    </svg>`
    _icons[key] = `data:image/svg+xml;base64,${btoa(svg)}`
    return _icons[key]
}

export default function GlobeAssetsLayer({ enabled = true }) {
    const [assets, setAssets] = useState([])
    useEffect(() => {
        if (!enabled) { setAssets([]); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}/api/my-assets`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d) setAssets((d.assets || []).filter((a) => a.position)) })
            .catch(() => {})
        load()
        const iv = setInterval(load, 60_000)
        const onChange = () => load()
        window.addEventListener("akili:assets-changed", onChange)
        return () => { live = false; clearInterval(iv); window.removeEventListener("akili:assets-changed", onChange) }
    }, [enabled])
    useEffect(() => {
        assets.forEach((a) => setEntity(`asset-${a.id}`, "owned_asset", a))
        return () => assets.forEach((a) => deleteEntity(`asset-${a.id}`))
    }, [assets])
    if (!enabled || !assets.length) return null
    return (
        <>
            {assets.map((a) => {
                const p = Cartesian3.fromDegrees(a.position.lon, a.position.lat, 0)
                const ring = Color.fromCssColorString(RING[a.exposure] || RING.unknown)
                return [
                    <Entity key={a.id} id={`asset-${a.id}`} position={p}
                        billboard={{ image: icon(a.group, a.exposure), width: 34, height: 40, verticalOrigin: VerticalOrigin.BOTTOM,
                                     heightReference: HeightReference.CLAMP_TO_GROUND, eyeOffset: new Cartesian3(0, 0, -120),
                                     scaleByDistance: new NearFarScalar(2e4, 1.15, 8e6, 0.7) }}
                        label={{ text: a.name, font: "600 13px sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
                                 style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.TOP, pixelOffset: new Cartesian2(0, 6),
                                 heightReference: HeightReference.CLAMP_TO_GROUND, distanceDisplayCondition: new DistanceDisplayCondition(0, 600_000) }} />,
                    <Entity key={`${a.id}-r`} position={p}
                        ellipse={{ semiMajorAxis: a.radius_km * 1000, semiMinorAxis: a.radius_km * 1000, fill: true,
                                   material: ring.withAlpha(0.06), outline: true, outlineColor: ring.withAlpha(0.55), height: 0,
                                   distanceDisplayCondition: new DistanceDisplayCondition(0, a.radius_km * 1000 * 14) }} />,
                ]
            })}
        </>
    )
}
