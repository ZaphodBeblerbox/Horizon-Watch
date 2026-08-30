import Icon from "../ui/Icon.jsx"

/**
 * The map control stack — full UI rebuild spec section 4. Lower-right,
 * vertical stack of 32x32px buttons, 8px radius, --bg-card fill, 1px
 * --border, 6px gap: layers (toggles the rail open/closed — desktop always
 * shows the rail per section 5, so this mainly matters on the mobile
 * BottomSheet path), locate, zoom in, zoom out, fullscreen. These are the
 * ONLY controls in this position — no other zoom/layer controls duplicated
 * elsewhere on screen.
 */
function ControlButton({ name, title, onClick }) {
    return (
        <button
            onClick={onClick}
            title={title}
            aria-label={title}
            style={{
                width: 32, height: 32, borderRadius: "var(--radius-md)",
                background: "var(--bg-card)", border: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: "var(--text-secondary)",
            }}
        >
            <Icon name={name} size={16} />
        </button>
    )
}

export default function MapControlStack({ onToggleLayers, onLocate, onZoomIn, onZoomOut, onFullscreen }) {
    return (
        <div style={{
            position: "absolute", right: 16, bottom: 16, zIndex: 40,
            display: "flex", flexDirection: "column", gap: 6,
        }}>
            <ControlButton name="layers" title="Toggle Layers" onClick={onToggleLayers} />
            <ControlButton name="locate" title="Locate" onClick={onLocate} />
            <ControlButton name="zoomIn" title="Zoom In" onClick={onZoomIn} />
            <ControlButton name="zoomOut" title="Zoom Out" onClick={onZoomOut} />
            <ControlButton name="expand" title="Fullscreen" onClick={onFullscreen} />
        </div>
    )
}
