import { useState, useEffect } from "react"
import BottomSheet from "./BottomSheet.jsx"
import { buttonStyle } from "../ui/styleHelpers.js"
import { LAYER_GROUPS, isLayerOn, countActive, clampOpacity } from "./layerRailConfig.js"

function Toggle({ on, onClick }) {
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onClick() }}
            style={{ ...buttonStyle({ variant: "ghost", size: "sm", active: on }), minWidth: 40 }}
        >
            {on ? "ON" : "OFF"}
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
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={value}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onChange(clampOpacity(parseFloat(e.target.value)))}
                style={{ flex: 1, accentColor: "var(--accent)" }}
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
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", marginTop: 1 }}>{def.hint}</div>
                    )}
                </div>
                <Toggle on={on} onClick={() => onToggle(def.key)} />
            </div>
            {on && def.hasRelevanceFilter && onLayerSet && (
                <RelevanceFilter
                    value={active?.eventsMinRelevance ?? 0}
                    onChange={(v) => onLayerSet("eventsMinRelevance", v)}
                />
            )}
            {on && def.hasOpacity && onLayerSet && (
                <OpacitySlider
                    value={clampOpacity(active?.satelliteOpacity ?? 0.9)}
                    onChange={(v) => onLayerSet("satelliteOpacity", v)}
                />
            )}
        </div>
    )
}

function GroupSection({ group, active, expanded, onToggleExpand, onToggle, onLayerSet }) {
    const n = countActive(active, group)
    return (
        <div style={{ borderBottom: "1px solid var(--border-dim)" }}>
            <div
                onClick={onToggleExpand}
                style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "var(--space-2) var(--space-2)", cursor: "pointer",
                }}
            >
                <span style={{
                    fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)",
                    letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent)",
                }}>
                    {group.label}
                </span>
                <span style={{ fontSize: "var(--text-xs)", color: n > 0 ? "var(--accent)" : "var(--text-dim)" }}>
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

function GroupList({ active, onToggle, onLayerSet, expandedKey, setExpandedKey, autoModeEnabled, onAutoMode }) {
    return (
        <>
            {onAutoMode && (
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "var(--space-2)", borderBottom: "1px solid var(--border-dim)",
                }}>
                    <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                        Auto Mode
                    </span>
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
        </>
    )
}

/**
 * Domain-grouped layer rail — replaces LayersPanel.jsx's floating GIS-style
 * layer tree. Same `active`/`onToggle`/`onLayerSet` contract as the panel it
 * supersedes, so the underlying workspace-layers state in app.jsx doesn't
 * need to change shape.
 *
 * Desktop: always-visible fixed rail (per the round's "no floating layer
 * panel" requirement). Mobile: a permanently-visible 220px rail doesn't fit
 * a narrow viewport, so the same grouped content renders inside the
 * existing BottomSheet pattern instead — opened via `mobileOpen`/`onMobileClose`
 * (e.g. from a "Layers" row in the mobile menu), not always-on.
 */
export default function LayerRail({
    active = {},
    onToggle,
    onLayerSet = null,
    autoModeEnabled = false,
    onAutoMode = null,
    style = {},
    mobileOpen = false,
    onMobileClose = null,
}) {
    const [expandedKey, setExpandedKey] = useState(null)
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    const content = (
        <GroupList
            active={active} onToggle={onToggle} onLayerSet={onLayerSet}
            expandedKey={expandedKey} setExpandedKey={setExpandedKey}
            autoModeEnabled={autoModeEnabled} onAutoMode={onAutoMode}
        />
    )

    if (isMobile) {
        if (!onMobileClose) return null
        return (
            <BottomSheet isOpen={mobileOpen} title="Layers" onClose={onMobileClose} height="full">
                <div style={{ padding: "0 0 24px" }}>{content}</div>
            </BottomSheet>
        )
    }

    return (
        <div style={{
            position: "fixed",
            top: 54,
            left: 0,
            width: 220,
            maxHeight: "calc(100vh - 54px)",
            overflowY: "auto",
            background: "var(--bg-secondary)",
            borderRight: "var(--elevation-1)",
            zIndex: 800,
            fontFamily: "var(--font-sans)",
            ...style,
        }}>
            {content}
        </div>
    )
}
