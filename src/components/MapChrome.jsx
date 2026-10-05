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

import { useEffect, useRef, useState } from "react"
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
// IT IS A PICKER, NOT A CYCLE BUTTON. This was one unlabelled button
// wearing #i-layers — the same glyph the Layers PANE uses — sitting in a
// column of five other unlabelled glyphs, which cycled blind through three
// basemaps. There was no way to see that the control existed, no way to
// see what it was currently set to, and no way to go back one without
// going forward two. Reported as "no option to change map", correctly.
//
// A named list, with the current one marked and each one saying what it is
// FOR, costs one click and makes the feature findable.
const BASEMAPS = [
    { key: "dark",      label: "Dark",      icon: "i-layers", hint: "Coastlines and borders only — the default for reading signals." },
    { key: "satellite", label: "Satellite", icon: "i-sat",    hint: "Esri World Imagery. What the ground actually looks like." },
    { key: "terrain",   label: "Terrain",   icon: "i-target", hint: "3D elevation. For relief, passes and high ground." },
]

export default function MapChrome({ onFit = null, basemap = null }) {
    const [scale, setScale] = useState(() => getScale())
    const [cam, setCam] = useState(() => getCameraState())
    const [bmOpen, setBmOpen] = useState(false)
    const bmBtn = useRef(null)

    useEffect(() => subscribeScale(setScale), [])
    useEffect(() => subscribeCameraState(setCam), [])

    // .mapchrome is overflow:hidden (that is what clips its segments into
    // one pill), so the flyout cannot be a child of it. It is positioned
    // from the button's own client rect instead — the same way the app's
    // menus are placed — and opens to the LEFT, because the button is 12px
    // off the right edge of the window.
    const [bmPos, setBmPos] = useState(null)
    useEffect(() => {
        if (!bmOpen) return undefined
        const place = () => {
            const r = bmBtn.current?.getBoundingClientRect()
            if (r) setBmPos({ right: Math.round(window.innerWidth - r.left + 8), bottom: Math.round(window.innerHeight - r.bottom) })
        }
        place()
        const close = (e) => { if (!bmBtn.current?.contains(e.target)) setBmOpen(false) }
        const esc = (e) => { if (e.key === "Escape") setBmOpen(false) }
        window.addEventListener("resize", place)
        window.addEventListener("scroll", place, true)
        document.addEventListener("mousedown", close)
        document.addEventListener("keydown", esc)
        return () => {
            window.removeEventListener("resize", place)
            window.removeEventListener("scroll", place, true)
            document.removeEventListener("mousedown", close)
            document.removeEventListener("keydown", esc)
        }
    }, [bmOpen])

    const current = BASEMAPS.find((b) => b.key === basemap?.value) || BASEMAPS[0]

    const fire = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }))

    // Cesium heading is radians clockwise from north. The needle rotates by
    // the NEGATIVE of it: turning the camera right must swing the needle
    // left, the way a real compass card does.
    const headingDeg = cam && isFinite(cam.heading) ? (cam.heading * 180) / Math.PI : 0

    return (
        <>
        {bmOpen && bmPos && (
            <div
                role="menu" aria-label="Basemap"
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                    position: "fixed", right: bmPos.right, bottom: bmPos.bottom, zIndex: 60,
                    width: 232, padding: 4, borderRadius: 13, overflow: "hidden",
                    background: "var(--glass)",
                    backdropFilter: "blur(22px) saturate(1.15)",
                    WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                    border: "1px solid var(--gline)", boxShadow: "var(--gshadow)",
                    font: "12px/1.4 var(--mz-font-body, var(--font))",
                }}
            >
                {BASEMAPS.map((b) => {
                    const on = b.key === current.key
                    return (
                        <button
                            key={b.key} role="menuitemradio" aria-checked={on}
                            onClick={() => { basemap.onChange(b.key); setBmOpen(false) }}
                            style={{
                                display: "grid", gridTemplateColumns: "16px 1fr 14px",
                                gap: "2px 9px", alignItems: "center", width: "100%",
                                padding: "7px 9px", border: 0, borderRadius: 9,
                                background: on ? "var(--accdim)" : "transparent",
                                color: "var(--txt)", font: "inherit", textAlign: "left",
                                cursor: "pointer",
                            }}
                            onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--hov)" }}
                            onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent" }}
                        >
                            <svg aria-hidden="true" style={{ width: 14, height: 14, gridRow: "span 2" }}><use href={`#${b.icon}`} /></svg>
                            <span style={{ fontWeight: 600 }}>{b.label}</span>
                            <span style={{ fontFamily: "var(--mz-font-mono, var(--mono))", color: "var(--acchi)" }}>{on ? "✓" : ""}</span>
                            <span style={{ gridColumn: 2, fontSize: 11, color: "var(--txt3, var(--txt-3))", textWrap: "pretty" }}>{b.hint}</span>
                        </button>
                    )
                })}
            </div>
        )}
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
                    ref={bmBtn}
                    className="mapbtn"
                    aria-haspopup="menu"
                    aria-expanded={bmOpen}
                    title={`Basemap: ${current.label} — click to change`}
                    aria-label="Change basemap"
                    onClick={() => setBmOpen((o) => !o)}
                >
                    <svg aria-hidden="true"><use href={`#${current.icon}`} /></svg>
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
        </>
    )
}
