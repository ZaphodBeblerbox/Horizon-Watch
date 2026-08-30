import { useState, useEffect } from "react"
import BottomSheet from "./BottomSheet.jsx"
import { buttonStyle } from "../ui/styleHelpers.js"
import { LAYER_GROUPS, isLayerOn, countActive, clampOpacity } from "./layerRailConfig.js"

// Real 36x20px toggle switch, exactly per spec section 2: "--border when
// off, --accent-blue when on, 16px white circular thumb."
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
                borderRadius: "50%", background: "#fff", transition: "left 0.15s ease", display: "block",
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

// Real legend — kept accurate to what's actually rendered on the globe
// (Round 2's real entity-marker system, src/globe/entityIcons.js) rather
// than decorative filler.
function Legend() {
    const row = (swatch, label) => (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "3px 0" }}>
            {swatch}
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{label}</span>
        </div>
    )
    return (
        <div style={{ padding: "var(--space-3) var(--space-2)", borderTop: "1px solid var(--border)" }}>
            <div style={{
                fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)",
                letterSpacing: "0.08em", marginBottom: "var(--space-2)",
            }}>
                Legend
            </div>
            {row(<svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="var(--accent-blue)" strokeWidth="2" /></svg>, "Track (AIS/ADS-B)")}
            {row(<svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="var(--accent-cyan)" strokeWidth="2" strokeDasharray="4 3" /></svg>, "AOI boundary")}
            {row(<span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--danger)", display: "inline-block" }} />, "Sanctions — confirmed")}
            {row(<span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--warn)", display: "inline-block" }} />, "Sanctions — possible")}
            {row(<span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--accent-cyan)", display: "inline-block" }} />, "Selected entity")}
        </div>
    )
}

function GroupList({ active, onToggle, onLayerSet, expandedKey, setExpandedKey, autoModeEnabled, onAutoMode, onExportView }) {
    return (
        <>
            <div style={{
                fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)",
                letterSpacing: "0.08em", padding: "var(--space-4) var(--space-2) var(--space-2)",
            }}>
                Layers
            </div>
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
            <Legend />
            {onExportView && (
                <div style={{ padding: "var(--space-3) var(--space-2)" }}>
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
    onExportView = null,
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
            onExportView={onExportView}
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
            // Full UI rebuild spec section 5: a real docked column, NOT a
            // floating overlay — this is a flex/grid SIBLING of the map
            // canvas (its parent container must be display:flex; this div
            // just occupies its allotted width, nothing more). The old
            // position:"fixed" here was the confirmed real bug: the rail
            // rendered on top of unrelated content (e.g. the News tab)
            // instead of the map canvas visibly shrinking to accommodate it.
            width: 240,
            flexShrink: 0,
            height: "100%",
            overflowY: "auto",
            background: "var(--bg-panel)",
            borderRight: "1px solid var(--border)",
            fontFamily: "var(--font-sans)",
            ...style,
        }}>
            {content}
        </div>
    )
}
