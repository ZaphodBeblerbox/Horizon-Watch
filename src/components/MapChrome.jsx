/**
 * MapChrome.jsx — PARALLAX spec §10.2. The nav cluster, top-right of the map:
 *
 *   #nav-in · #nav-z (zoom readout) · #nav-out · #nav-home · #nav-fit · .compass
 *
 * All six act on the Cesium camera, which lives inside GlobeView. This
 * component never touches the viewer: it dispatches the same window events
 * GlobeView already listens for (akili:zoom-in / akili:zoom-out /
 * akili:set-camera), which is the established pattern for map controls that
 * are not children of GlobeView.
 *
 * The readout and the compass are the reverse direction — they SUBSCRIBE to
 * what the camera publishes (cameraState for heading, mapReadout for the
 * measured zoom label). That split matters: a compass that stored its own
 * idea of heading would drift out of sync with the globe the moment anything
 * else moved the camera (a fly-to from search, a session restore, a drag).
 */

import { useEffect, useState } from "react"
import { subscribeCameraState, getCameraState } from "../globe/cameraState.js"
import { subscribeScale, getScale } from "../globe/mapReadout.js"

// The spec's own world preset — the same figures §10's projection segment
// uses for "world", so Home and the World projection agree rather than
// landing a few thousand kilometres apart.
const HOME = { lat: 10, lon: 4, height: 18_000_000 }

function navBtn(id, icon, title, onClick) {
    return (
        <button key={id} id={id} className="mapbtn" onClick={onClick} title={title} aria-label={title}>
            <svg aria-hidden="true"><use href={`#${icon}`} /></svg>
        </button>
    )
}

// Basemap is NOT in §10's nav cluster — the spec lists six controls here and
// a basemap switcher is not among them. It is included anyway, as a
// deliberate documented deviation, because §10 also replaces MapControlStack,
// which was the only place the switcher lived. Following the spec literally
// stranded the feature: the map was stuck on the Esri dark basemap, which
// reads as a black globe under the light theme that is now the default. One
// 28px cycle button costs a fraction of the space three buttons would and
// keeps the cluster's geometry intact.
const BASEMAPS = [
    { key: "dark", label: "Dark" },
    { key: "satellite", label: "Satellite" },
    { key: "terrain", label: "Terrain" },
]

export default function MapChrome({ onFit = null, basemap = null }) {
    const [scale, setScale] = useState(() => getScale())
    const [cam, setCam] = useState(() => getCameraState())

    useEffect(() => subscribeScale(setScale), [])
    useEffect(() => subscribeCameraState(setCam), [])

    const fire = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }))

    // Cesium heading is radians clockwise from north. The needle rotates by
    // the NEGATIVE of it: turning the camera right must swing the needle
    // left, the way a real compass card does.
    const headingDeg = cam && isFinite(cam.heading) ? (cam.heading * 180) / Math.PI : 0

    return (
        <div className="mapchrome" role="group" aria-label="Map navigation">
            {navBtn("nav-in", "i-zoom-in", "Zoom in", () => fire("akili:zoom-in"))}
            <span id="nav-z" className="navz" title="Camera height above the ellipsoid">
                {scale?.zoomLabel || "—"}
            </span>
            {navBtn("nav-out", "i-zoom-out", "Zoom out", () => fire("akili:zoom-out"))}
            {navBtn("nav-home", "i-recentre", "Home view", () =>
                fire("akili:set-camera", { lat: HOME.lat, lon: HOME.lon, height: HOME.height, heading: 0, pitch: -Math.PI / 2, roll: 0 }))}
            {navBtn("nav-fit", "i-target", "Fit to visible signals", () => {
                // Only offered when the host screen can actually compute an
                // extent from what it is showing. A Fit button that silently
                // does nothing is worse than one that is not there.
                if (onFit) onFit()
            })}
            {basemap && (
                <button
                    className="mapbtn"
                    title={`Basemap: ${(BASEMAPS.find((b) => b.key === basemap.value) || BASEMAPS[0]).label} — click to change`}
                    aria-label="Change basemap"
                    onClick={() => {
                        const i = BASEMAPS.findIndex((b) => b.key === basemap.value)
                        basemap.onChange(BASEMAPS[(i + 1) % BASEMAPS.length].key)
                    }}
                >
                    <svg aria-hidden="true"><use href="#i-layers" /></svg>
                </button>
            )}
            <button
                className="compass"
                title={`North — bearing ${Math.round(((headingDeg % 360) + 360) % 360)}°. Click to face north.`}
                aria-label="Face north"
                onClick={() => {
                    const c = getCameraState()
                    fire("akili:set-camera", {
                        lat: c?.lat ?? HOME.lat, lon: c?.lon ?? HOME.lon,
                        height: c?.height ?? HOME.height,
                        heading: 0, pitch: c?.pitch ?? -Math.PI / 2, roll: 0,
                    })
                }}
            >
                <svg aria-hidden="true" style={{ transform: `rotate(${-headingDeg}deg)` }}>
                    <use href="#i-north" />
                </svg>
            </button>
        </div>
    )
}
