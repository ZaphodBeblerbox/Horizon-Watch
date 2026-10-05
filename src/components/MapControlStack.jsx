/**
 * MapControlStack.jsx — PARALLAX v6 Part A5.4, the map controls.
 *
 * TWO PILL GROUPS, NOT ONE STACK. Zoom is one thing and view is another,
 * and the spec separates them by an 8px gap so the hand knows which it is
 * reaching for without the eye checking. Inside a group the buttons are
 * separated by a 1px gap that shows the group's own var(--gline)
 * background through as a hairline — a border on each button would read
 * as five buttons; a hairline reads as one control with segments.
 *
 * GEOMETRY. Group: column, gap 1, border 1px var(--gline), radius 17,
 * overflow hidden, var(--gshadow), blurred. Button: 34×30, background
 * var(--glass), mono 12 weight 500, var(--txt2); hover var(--hov) /
 * var(--txt). The glyphs are text, not icons, because +, −, ◎ and ⤢ are
 * already universally legible and an icon of a plus sign is a worse plus
 * sign.
 *
 * ZOOM HIDES ON TOUCH. A5.4: when `(hover: none) and (pointer: coarse)`
 * matches, the zoom group is not rendered at all — pinch already does it,
 * and two buttons that duplicate a gesture are two buttons in the way.
 */
import { useEffect, useState } from "react"
import Icon from "../ui/Icon.jsx"
import LayersFlyout from "./LayersFlyout.jsx"

const BASEMAP_PRESETS = [
    { key: "dark",      icon: "basemapDark",    title: "Dark basemap" },
    { key: "satellite", icon: "satellite",      title: "Satellite basemap (Esri World Imagery)" },
    { key: "terrain",   icon: "basemapTerrain", title: "Terrain basemap (3D elevation)" },
]

const GROUP = {
    display: "flex", flexDirection: "column", gap: 1, overflow: "hidden",
    background: "var(--gline)",
    backdropFilter: "blur(22px) saturate(1.15)",
    WebkitBackdropFilter: "blur(22px) saturate(1.15)",
    border: "1px solid var(--gline)", boxShadow: "var(--gshadow)",
    borderRadius: 17,
}

function Btn({ glyph, label, onClick, active = false, children = null }) {
    return (
        <button
            onClick={onClick} title={label} aria-label={label} aria-pressed={active}
            style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 30, border: 0,
                background: active ? "var(--accdim)" : "var(--glass)",
                color: active ? "var(--txt)" : "var(--txt2)",
                fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 12,
                cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hov)"; e.currentTarget.style.color = "var(--txt)" }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = active ? "var(--accdim)" : "var(--glass)"
                e.currentTarget.style.color = active ? "var(--txt)" : "var(--txt2)"
            }}
        >{children || glyph}</button>
    )
}

export default function MapControlStack({
    layers = null, onLocate, onZoomIn, onZoomOut,
    onFullscreen, isFullscreen = false, basemap = null, rightInset = 0,
}) {
    const [touch, setTouch] = useState(false)
    useEffect(() => {
        try { setTouch(window.matchMedia("(hover: none) and (pointer: coarse)").matches) }
        catch { setTouch(false) }
    }, [])

    return (
        <div style={{
            // rightInset keeps the stack in the visible gutter when the
            // Inspector pane is open over the map.
            position: "absolute", right: 12 + rightInset, bottom: 12, zIndex: 23,
            display: "flex", flexDirection: "column", gap: 8,
            background: "transparent", border: 0,
            transition: "right 0.15s ease",
        }}>
            {layers && (
                <div style={GROUP}>
                    <LayersFlyout
                        active={layers.active} onToggle={layers.onToggle} onLayerSet={layers.onLayerSet}
                        autoModeEnabled={layers.autoModeEnabled} onAutoMode={layers.onAutoMode}
                        onExportView={layers.onExportView} buttonSize={30}
                    />
                </div>
            )}

            {!touch && (
                <div style={GROUP}>
                    <Btn glyph="+" label="Zoom in" onClick={onZoomIn} />
                    <Btn glyph="−" label="Zoom out" onClick={onZoomOut} />
                </div>
            )}

            <div style={GROUP}>
                <Btn glyph="◎" label="Recentre on selection" onClick={onLocate} />
                <Btn glyph="⤢" label="Fit all tracks" onClick={onLocate} />
                {basemap && BASEMAP_PRESETS.map((p) => (
                    <Btn
                        key={p.key} label={p.title}
                        active={basemap.value === p.key}
                        onClick={() => basemap.onChange(p.key)}
                    >
                        <Icon name={p.icon} size={14} />
                    </Btn>
                ))}
            </div>
        </div>
    )
}
