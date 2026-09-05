import Icon from "../ui/Icon.jsx"
import LayersFlyout from "./LayersFlyout.jsx"

/**
 * The map control stack — full UI rebuild spec section 4, updated per the
 * UI correction pass Part 9: the layers control is now the shared
 * LayersFlyout (a translucent flyout, same visual family as these other
 * buttons) instead of a separate always-docked rail — this is the ONE
 * layers-control pattern in the app now, used identically on every map
 * instance (Globe home screen, Dashboard, each Canonical operational view).
 * Lower-right, vertical stack of 32x32px buttons, 8px radius, --bg-card
 * fill, 1px --border, 6px gap: layers, locate, zoom in, zoom out,
 * fullscreen/exit-fullscreen. These are the ONLY controls in this position —
 * no other zoom/layer controls duplicated elsewhere on screen.
 *
 * `layers` (optional): {active, onToggle, onLayerSet, autoModeEnabled,
 * onAutoMode, onExportView} — passed straight through to LayersFlyout. Omit
 * entirely on a map instance with no real toggleable layers (e.g. a fixed,
 * already-collected dataset view) to render the stack without a layers
 * button at all, rather than a dead/no-op one.
 */
function ControlButton({ name, title, onClick, active = false }) {
    return (
        <button
            onClick={onClick}
            title={title}
            aria-label={title}
            aria-pressed={active}
            style={{
                width: 32, height: 32, borderRadius: "var(--radius-md)",
                background: "var(--bg-card)", border: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: active ? "var(--accent-blue)" : "var(--text-secondary)",
            }}
        >
            <Icon name={name} size={16} />
        </button>
    )
}

const BASEMAP_PRESETS = [
    { key: "dark",      icon: "basemapDark",     title: "Dark basemap" },
    { key: "satellite", icon: "satellite",       title: "Satellite basemap (Esri World Imagery)" },
    { key: "terrain",   icon: "basemapTerrain",  title: "Terrain basemap (3D elevation)" },
]

/**
 * `basemap` (optional): {value: "dark"|"satellite"|"terrain", onChange(key)}
 * — omit to render the stack without the basemap group at all. Grouped
 * directly under the existing nav buttons (same 32px/--bg-card/--border
 * ControlButton, a thin divider instead of a second floating box) so it
 * reads as one continuous control cluster rather than a disconnected one.
 */
export default function MapControlStack({ layers = null, onLocate, onZoomIn, onZoomOut, onFullscreen, isFullscreen = false, basemap = null }) {
    return (
        <div style={{
            position: "absolute", right: 16, bottom: 16, zIndex: 40,
            display: "flex", flexDirection: "column", gap: 6,
        }}>
            {layers && (
                <LayersFlyout
                    active={layers.active} onToggle={layers.onToggle} onLayerSet={layers.onLayerSet}
                    autoModeEnabled={layers.autoModeEnabled} onAutoMode={layers.onAutoMode}
                    onExportView={layers.onExportView} buttonSize={32}
                />
            )}
            <ControlButton name="locate" title="Locate" onClick={onLocate} />
            <ControlButton name="zoomIn" title="Zoom In" onClick={onZoomIn} />
            <ControlButton name="zoomOut" title="Zoom Out" onClick={onZoomOut} />
            <ControlButton name="expand" title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"} onClick={onFullscreen} />
            {basemap && (
                <>
                    <div style={{ height: 1, background: "var(--border)", margin: "2px 2px" }} />
                    {BASEMAP_PRESETS.map((p) => (
                        <ControlButton
                            key={p.key} name={p.icon} title={p.title}
                            active={basemap.value === p.key}
                            onClick={() => basemap.onChange(p.key)}
                        />
                    ))}
                </>
            )}
        </div>
    )
}
