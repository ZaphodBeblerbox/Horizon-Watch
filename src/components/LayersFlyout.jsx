import { useState } from "react"
import FlyoutMenu from "../ui/FlyoutMenu.jsx"
import { buttonStyle } from "../ui/styleHelpers.js"
import { LAYER_GROUPS, isLayerOn, countActive, clampOpacity } from "./layerRailConfig.js"
import MapLegend from "./MapLegend.jsx"

/**
 * LayersFlyout — the ONE layers-control pattern in the app now (UI
 * correction pass, Part 9), replacing the master prompt's always-docked
 * 240px LayerRail everywhere a layers control appears: the Globe home
 * screen, the Dashboard's map, each Canonical operational view. A layers
 * icon button in the same visual family as the other map control buttons
 * (locate/zoom/fullscreen — same fill/border/radius, via FlyoutMenu), opening
 * a small TRANSLUCENT panel with the same real domain-grouped toggle rows +
 * legend content the old rail had — content unchanged, just repackaged into
 * a flyout instead of a permanently-docked column.
 *
 * Same `active`/`onToggle`/`onLayerSet` contract the old rail used, so the
 * underlying workspace-layers state shape doesn't need to change.
 */
function Toggle({ on, onClick }) {
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onClick() }}
            aria-pressed={on}
            style={{
                width: 36, height: 20, borderRadius: "var(--radius-pill)", border: "none",
                background: on ? "var(--accent-blue)" : "var(--border)", cursor: "pointer",
                position: "relative", flexShrink: 0, padding: 0, transition: "background 0.15s ease",
            }}
        >
            <span style={{
                position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16,
                // on: the ink of a primary button, so the knob still shows
                // on the monochrome desktop's near-white track (2026-10-17)
                borderRadius: "50%", background: on ? "var(--mz-cream, #fff)" : "#fff", transition: "left 0.15s ease", display: "block",
            }} />
        </button>
    )
}

function RelevanceFilter({ value = 0, onChange }) {
    const opts = [{ label: "All", val: 0 }, { label: "Med+", val: 4 }, { label: "High", val: 7 }]
    return (
        <div style={{ display: "flex", gap: 4, marginTop: 4, marginLeft: "var(--space-2)" }}>
            {opts.map(o => (
                <button
                    key={o.val}
                    onClick={(e) => { e.stopPropagation(); onChange(o.val) }}
                    style={buttonStyle({ variant: "ghost", size: "sm", active: value === o.val })}
                >{o.label}</button>
            ))}
        </div>
    )
}

function OpacitySlider({ value, onChange }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, marginLeft: "var(--space-2)" }}>
            <input
                type="range" min={0.1} max={1} step={0.05} value={value}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onChange(clampOpacity(parseFloat(e.target.value)))}
                style={{ flex: 1, accentColor: "var(--accent-blue)" }}
            />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)", width: 32, textAlign: "right" }}>
                {Math.round(value * 100)}%
            </span>
        </div>
    )
}

function LayerRow({ def, active, onToggle, onLayerSet }) {
    const on = isLayerOn(active, def)
    return (
        <div style={{ padding: "6px var(--space-2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{def.label}</div>
                    {def.hint && (
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 1 }}>{def.hint}</div>
                    )}
                </div>
                <Toggle on={on} onClick={() => onToggle(def.key)} />
            </div>
            {on && def.hasRelevanceFilter && onLayerSet && (
                <RelevanceFilter value={active?.eventsMinRelevance ?? 0} onChange={(v) => onLayerSet("eventsMinRelevance", v)} />
            )}
            {on && def.hasOpacity && onLayerSet && (
                <OpacitySlider value={clampOpacity(active?.satelliteOpacity ?? 0.9)} onChange={(v) => onLayerSet("satelliteOpacity", v)} />
            )}
        </div>
    )
}

function GroupSection({ group, active, expanded, onToggleExpand, onToggle, onLayerSet }) {
    const n = countActive(active, group)
    return (
        <div style={{ borderBottom: "1px solid var(--border)" }}>
            <div
                onClick={onToggleExpand}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-2)", cursor: "pointer" }}
            >
                <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-blue)" }}>
                    {group.label}
                </span>
                <span style={{ fontSize: "var(--text-xs)", color: n > 0 ? "var(--accent-blue)" : "var(--text-muted)" }}>
                    {n}/{group.layers.length}
                </span>
            </div>
            {expanded && (
                <div style={{ paddingBottom: "var(--space-1)" }}>
                    {group.layers.map(def => (
                        <LayerRow key={def.key} def={def} active={active} onToggle={onToggle} onLayerSet={onLayerSet} />
                    ))}
                </div>
            )}
        </div>
    )
}

// The legend: the one definition both maps share (lib/mapIcons.js via MapLegend), so it is what the globe draws.
function Legend() {
    return (
        <div style={{ padding: "var(--space-3) var(--space-2)", color: "var(--text-secondary)" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.08em", marginBottom: "var(--space-2)" }}>
                Legend
            </div>
            <MapLegend />
        </div>
    )
}

export default function LayersFlyout({
    active = {}, onToggle, onLayerSet = null,
    autoModeEnabled = false, onAutoMode = null, onExportView = null,
    buttonSize = 32, hotkey = "l",
}) {
    const [expandedKey, setExpandedKey] = useState(null)

    return (
        <FlyoutMenu icon="layers" title="Layers (L)" align="right" direction="up" panelWidth={260} buttonSize={buttonSize} hotkey={hotkey}>
            {onAutoMode && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>Auto Mode</span>
                    <Toggle on={autoModeEnabled} onClick={() => onAutoMode(!autoModeEnabled)} />
                </div>
            )}
            {LAYER_GROUPS.map(group => (
                <GroupSection
                    key={group.key}
                    group={group}
                    active={active}
                    expanded={expandedKey === group.key}
                    onToggleExpand={() => setExpandedKey(k => (k === group.key ? null : group.key))}
                    onToggle={onToggle}
                    onLayerSet={onLayerSet}
                />
            ))}
            <Legend />
            {onExportView && (
                <div style={{ padding: "var(--space-3)", borderTop: "1px solid var(--border)" }}>
                    <button
                        onClick={onExportView}
                        style={{
                            width: "100%", background: "none", border: "none", cursor: "pointer",
                            color: "var(--accent-blue)", fontSize: "var(--text-body)", fontFamily: "var(--font-sans)",
                            padding: "6px 0", textAlign: "left",
                        }}
                    >
                        Export View
                    </button>
                </div>
            )}
        </FlyoutMenu>
    )
}
