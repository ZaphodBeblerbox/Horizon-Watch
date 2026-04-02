import { useState, useRef } from "react"
import { IconOverwatch } from "./OverwatchLayer.jsx"

// ── Taxonomy ─────────────────────────────────────────────────────────────────
export const TAXONOMY = {
    Aircraft:       { color: "#38bdf8", classes: ["plane","airplane","helicopter"] },
    Vessel:         { color: "#f59e0b", classes: ["ship","boat"] },
    Vehicle:        { color: "#22c55e", classes: ["large-vehicle","small-vehicle","large vehicle","small vehicle","car","truck","bus","motorcycle","bicycle"] },
    Infrastructure: { color: "#a855f7", classes: ["bridge","harbor","train"] },
    Structure:      { color: "#ef4444", classes: ["storage-tank","storage tank","roundabout"] },
    Facility:       { color: "#f97316", classes: ["baseball-diamond","tennis-court","basketball-court","ground-track-field","soccer-ball-field","swimming-pool"] },
    Person:         { color: "#fb7185", classes: ["person"] },
}

export function catForClass(cls) {
    const c = (cls || "").toLowerCase().trim()
    for (const [cat, info] of Object.entries(TAXONOMY)) {
        if (info.classes.includes(c)) return cat
    }
    return "Object"
}

export function colorForCat(cat) {
    return TAXONOMY[cat]?.color || "#e2e8f0"
}

export function colorForClass(cls) {
    return colorForCat(catForClass(cls))
}

// ── Saved scans persistence ───────────────────────────────────────────────────
const SAVED_KEY  = "ow-saved-scans-v1"
const MAX_SAVED  = 20

export function loadSavedScans() {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || [] } catch { return [] }
}

export function persistSavedScans(scans) {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(scans)) } catch {}
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const GLASS = {
    background:          "rgba(6,13,26,0.96)",
    backdropFilter:      "blur(20px)",
    WebkitBackdropFilter:"blur(20px)",
    fontFamily:          "Inter,-apple-system,sans-serif",
    color:               "#e2e8f0",
}

const BTN_BASE = {
    border:    "none",
    cursor:    "pointer",
    fontFamily:"inherit",
    lineHeight: 1,
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionHead({ label }) {
    return (
        <div style={{
            fontSize: 8, fontWeight: 700, letterSpacing: "0.13em",
            textTransform: "uppercase", color: "rgba(232,237,242,0.3)",
            padding: "12px 0 5px",
        }}>
            {label}
        </div>
    )
}

function Toggle({ on, onToggle, label, sublabel, color = "#38bdf8", disabled = false }) {
    return (
        <div
            onClick={disabled ? undefined : onToggle}
            style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 10px", borderRadius: 7, marginBottom: 4,
                background: on ? `${color}10` : "rgba(255,255,255,0.02)",
                border: `1px solid ${on ? color + "30" : "rgba(255,255,255,0.06)"}`,
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.4 : 1,
                transition: "background 0.15s, border-color 0.15s",
            }}
        >
            <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: on ? color : "rgba(232,237,242,0.55)" }}>
                    {label}
                </div>
                {sublabel && (
                    <div style={{ fontSize: 9, color: "rgba(232,237,242,0.3)", marginTop: 1 }}>
                        {sublabel}
                    </div>
                )}
            </div>
            <div style={{
                width: 32, height: 18, borderRadius: 9, flexShrink: 0,
                background: on ? `${color}90` : "rgba(255,255,255,0.12)",
                transition: "background 0.2s",
                display: "flex", alignItems: "center",
                padding: "0 2px",
                justifyContent: on ? "flex-end" : "flex-start",
            }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }} />
            </div>
        </div>
    )
}

function Btn({ onClick, children, variant = "default", disabled = false, fullWidth = false, pad = "7px 0" }) {
    const colors = {
        danger:  { bg: "rgba(239,68,68,0.1)",  border: "rgba(239,68,68,0.3)",  color: "#ef4444"  },
        primary: { bg: "rgba(56,189,248,0.1)",  border: "rgba(56,189,248,0.3)", color: "#38bdf8"  },
        purple:  { bg: "rgba(139,92,246,0.1)",  border: "rgba(139,92,246,0.3)", color: "#a78bfa"  },
        save:    { bg: "rgba(34,197,94,0.1)",   border: "rgba(34,197,94,0.3)",  color: "#22c55e"  },
        default: { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)", color: "rgba(232,237,242,0.55)" },
    }
    const c = colors[variant] || colors.default
    return (
        <button onClick={onClick} disabled={disabled} style={{
            ...BTN_BASE,
            flex: fullWidth ? undefined : 1,
            width: fullWidth ? "100%" : undefined,
            padding: pad,
            fontSize: 11, fontWeight: 600,
            background: disabled ? "rgba(255,255,255,0.03)" : c.bg,
            border: `1px solid ${disabled ? "rgba(255,255,255,0.06)" : c.border}`,
            borderRadius: 6,
            color: disabled ? "rgba(232,237,242,0.2)" : c.color,
            cursor: disabled ? "default" : "pointer",
            transition: "background 0.15s",
        }}>
            {children}
        </button>
    )
}

// ── Sidebar content (shared between desktop panel & mobile sheet) ─────────────
function SidebarContent({
    stats, detections, visible,
    minConf, onMinConfChange,
    enhance, onEnhanceToggle, enhanced,
    analysis, analyzing, onAnalyze, onDismissAnalysis,
    onClear, onRescan,
    sentinel2Active, onToggleSentinel2, sentinelCapturedAt,
    selectedCats, onToggleCat, onClearCatFilter,
    savedScans, onSave, onDeleteSaved, onRestoreSaved,
    isMobile,
}) {
    const [showSaved, setShowSaved] = useState(false)
    const [showDetList, setShowDetList] = useState(false)

    // Build per-category counts from visible detections
    const catCounts = {}
    for (const d of detections) {
        const cat = d.category || catForClass(d.class)
        catCounts[cat] = (catCounts[cat] || 0) + 1
    }
    const allCats = Object.keys(catCounts).sort()

    // Format date
    function fmtDate(iso) {
        if (!iso) return null
        try {
            return new Date(iso).toLocaleString(undefined, {
                month: "short", day: "numeric", year: "numeric",
                hour: "2-digit", minute: "2-digit",
            })
        } catch { return iso }
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* ── Scrollable body ──────────────────────────────────────────── */}
            <div style={{
                flex: 1, overflowY: "auto", overflowX: "hidden",
                WebkitOverflowScrolling: "touch",
                padding: "0 16px",
                paddingBottom: isMobile ? "env(safe-area-inset-bottom, 16px)" : 16,
            }}>

                {/* Count headline */}
                <div style={{ paddingTop: 14, marginBottom: 10 }}>
                    <div style={{
                        fontSize: 28, fontWeight: 700, lineHeight: 1,
                        color: (stats?.total || 0) > 0 ? "#e2e8f0" : "rgba(232,237,242,0.25)",
                    }}>
                        {stats?.total ?? 0}
                        <span style={{ fontSize: 12, fontWeight: 400, color: "rgba(232,237,242,0.4)", marginLeft: 8 }}>
                            {(stats?.total ?? 0) === 1 ? "object detected" : "objects detected"}
                        </span>
                    </div>
                    {visible.length < detections.length && (
                        <div style={{ fontSize: 9, color: "rgba(232,237,242,0.3)", marginTop: 3 }}>
                            {visible.length} shown after filters
                        </div>
                    )}
                    {stats?.zoom && (
                        <div style={{ fontSize: 9, color: "rgba(56,189,248,0.45)", marginTop: 3, letterSpacing: "0.04em" }}>
                            {stats.zoom === "Sentinel-2" ? "Sentinel-2" : `Zoom ${stats.zoom}`}
                            {enhanced && <span style={{ color: "#a78bfa", marginLeft: 5 }}>· AI Enhanced</span>}
                        </div>
                    )}
                </div>

                {/* ── Category filter ──────────────────────────────────── */}
                {allCats.length > 0 && (
                    <>
                        <SectionHead label="Filter by Category" />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 6px", marginBottom: 4 }}>
                            {allCats.map(cat => {
                                const color   = colorForCat(cat)
                                const count   = catCounts[cat] || 0
                                const active  = selectedCats.size === 0 || selectedCats.has(cat)
                                return (
                                    <button
                                        key={cat}
                                        onClick={() => onToggleCat(cat)}
                                        style={{
                                            ...BTN_BASE,
                                            fontSize: 10, padding: "4px 9px", borderRadius: 14,
                                            background: active ? `${color}20` : "rgba(255,255,255,0.04)",
                                            border: `1px solid ${active ? color + "55" : "rgba(255,255,255,0.08)"}`,
                                            color: active ? color : "rgba(232,237,242,0.3)",
                                            fontWeight: 600,
                                            transition: "all 0.15s",
                                        }}
                                    >
                                        {cat} <span style={{ opacity: 0.65, fontWeight: 400 }}>{count}</span>
                                    </button>
                                )
                            })}
                        </div>
                        {selectedCats.size > 0 && (
                            <button onClick={onClearCatFilter} style={{
                                ...BTN_BASE, fontSize: 9, color: "rgba(232,237,242,0.3)",
                                background: "none", padding: "2px 0", marginBottom: 6,
                                textDecoration: "underline", textDecorationColor: "rgba(232,237,242,0.15)",
                            }}>
                                Clear filter
                            </button>
                        )}
                    </>
                )}

                {/* ── Confidence slider ─────────────────────────────────── */}
                <SectionHead label="Confidence Threshold" />
                <div style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ fontSize: 9, color: "rgba(232,237,242,0.35)" }}>Min confidence</span>
                        <span style={{ fontSize: 10, color: "#38bdf8", fontWeight: 700 }}>
                            {Math.round(minConf * 100)}%
                        </span>
                    </div>
                    <input
                        type="range" min={0} max={0.9} step={0.05} value={minConf}
                        onChange={e => onMinConfChange(parseFloat(e.target.value))}
                        style={{ width: "100%", accentColor: "#38bdf8", cursor: "pointer" }}
                    />
                    <div style={{ fontSize: 9, color: "rgba(232,237,242,0.2)", marginTop: 2 }}>
                        Showing {visible.length} of {detections.length}
                    </div>
                </div>

                {/* ── Satellite imagery toggle ──────────────────────────── */}
                <SectionHead label="Satellite Imagery" />
                <Toggle
                    on={sentinel2Active}
                    onToggle={onToggleSentinel2}
                    label="Sentinel-2 L2A"
                    sublabel={sentinelCapturedAt
                        ? `Captured ${fmtDate(sentinelCapturedAt)}`
                        : "Draw region to load · Copernicus"}
                    color="#00bfae"
                />

                {/* ── AI Classification toggle ──────────────────────────── */}
                <SectionHead label="AI Classification" />
                <Toggle
                    on={enhance}
                    onToggle={onEnhanceToggle}
                    label="Claude Vision"
                    sublabel={enhance ? "Enabled — slower but more specific" : "Enable for detailed type labels"}
                    color="#a78bfa"
                />

                {/* ── Detection list (collapsible) ──────────────────────── */}
                {detections.length > 0 && (
                    <>
                        <SectionHead label="Detections" />
                        <button
                            onClick={() => setShowDetList(v => !v)}
                            style={{
                                ...BTN_BASE,
                                width: "100%", display: "flex", alignItems: "center",
                                justifyContent: "space-between",
                                padding: "7px 10px", borderRadius: 6, marginBottom: 6,
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid rgba(255,255,255,0.07)",
                                color: "rgba(232,237,242,0.45)", fontSize: 10,
                            }}
                        >
                            <span>{showDetList ? "Hide" : "Show"} {visible.length} detection{visible.length !== 1 ? "s" : ""}</span>
                            <span style={{ opacity: 0.5 }}>{showDetList ? "▲" : "▼"}</span>
                        </button>
                        {showDetList && (
                            <div style={{
                                maxHeight: 220, overflowY: "auto",
                                borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)",
                                marginBottom: 8,
                            }}>
                                {visible.map((det, i) => {
                                    const cat   = det.category || catForClass(det.class)
                                    const color = colorForCat(cat)
                                    const label = det.specific_type
                                        ? det.specific_type.charAt(0).toUpperCase() + det.specific_type.slice(1)
                                        : det.class
                                    return (
                                        <div key={i} style={{
                                            display: "flex", alignItems: "center", gap: 8,
                                            padding: "5px 10px",
                                            borderBottom: i < visible.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                                        }}>
                                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 10, fontWeight: 600, color: "#e2e8f0", textTransform: "capitalize", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                    {label}
                                                </div>
                                                <div style={{ fontSize: 8, color: "rgba(232,237,242,0.3)" }}>
                                                    {cat} · {det.subcategory || ""}
                                                </div>
                                            </div>
                                            <span style={{ fontSize: 9, color: color, fontWeight: 600, flexShrink: 0 }}>
                                                {Math.round(det.confidence * 100)}%
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </>
                )}

                {/* ── Intelligence Assessment ───────────────────────────── */}
                <SectionHead label="Intelligence" />
                <Btn
                    onClick={onAnalyze}
                    variant="purple"
                    disabled={analyzing || !detections.length}
                    fullWidth
                    pad="9px 0"
                >
                    {analyzing ? "Running assessment…" : "Assess Area"}
                </Btn>
                {analysis && (
                    <div style={{
                        marginTop: 8, padding: "10px 12px",
                        background: "rgba(139,92,246,0.07)",
                        border: "1px solid rgba(139,92,246,0.2)",
                        borderRadius: 7,
                    }}>
                        <div style={{ fontSize: 8, fontWeight: 700, color: "#a78bfa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
                            Intelligence Assessment
                        </div>
                        {analysis.summary && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 5px", marginBottom: 8 }}>
                                {Object.entries(analysis.summary).sort(([,a],[,b]) => b - a).map(([cls, n]) => (
                                    <span key={cls} style={{
                                        fontSize: 9, padding: "2px 6px", borderRadius: 10,
                                        background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.25)",
                                        color: "#a78bfa",
                                    }}>{n} {cls}</span>
                                ))}
                            </div>
                        )}
                        <div style={{ fontSize: 11, lineHeight: 1.55, color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
                            {analysis.analysis}
                        </div>
                        <button onClick={onDismissAnalysis} style={{
                            ...BTN_BASE, marginTop: 6, background: "none",
                            fontSize: 9, color: "rgba(232,237,242,0.25)", padding: 0,
                        }}>
                            Dismiss
                        </button>
                    </div>
                )}

                {/* ── Saved Scans ───────────────────────────────────────── */}
                <SectionHead label="Saved Scans" />
                <Btn onClick={onSave} variant="save" disabled={!detections.length} fullWidth pad="9px 0">
                    Save This Scan
                </Btn>
                {savedScans.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                        <button
                            onClick={() => setShowSaved(v => !v)}
                            style={{
                                ...BTN_BASE,
                                width: "100%", display: "flex", alignItems: "center",
                                justifyContent: "space-between",
                                padding: "6px 10px", borderRadius: 6, marginBottom: 4,
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid rgba(255,255,255,0.07)",
                                color: "rgba(232,237,242,0.4)", fontSize: 10,
                            }}
                        >
                            <span>{savedScans.length} saved scan{savedScans.length !== 1 ? "s" : ""}</span>
                            <span style={{ opacity: 0.5 }}>{showSaved ? "▲" : "▼"}</span>
                        </button>
                        {showSaved && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                {savedScans.map(scan => (
                                    <div key={scan.id} style={{
                                        display: "flex", alignItems: "center",
                                        padding: "8px 10px", borderRadius: 6,
                                        background: "rgba(255,255,255,0.03)",
                                        border: "1px solid rgba(255,255,255,0.07)",
                                        gap: 8,
                                    }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 10, color: "#e2e8f0", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {scan.stats?.total ?? 0} objects
                                            </div>
                                            <div style={{ fontSize: 8, color: "rgba(232,237,242,0.3)", marginTop: 1 }}>
                                                {fmtDate(scan.timestamp)}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => onRestoreSaved(scan)}
                                            style={{
                                                ...BTN_BASE,
                                                fontSize: 9, padding: "3px 8px", borderRadius: 4,
                                                background: "rgba(56,189,248,0.1)",
                                                border: "1px solid rgba(56,189,248,0.25)",
                                                color: "#38bdf8",
                                            }}
                                        >Restore</button>
                                        <button
                                            onClick={() => onDeleteSaved(scan.id)}
                                            style={{
                                                ...BTN_BASE,
                                                fontSize: 13, padding: "2px 6px", borderRadius: 4,
                                                background: "rgba(239,68,68,0.08)",
                                                border: "1px solid rgba(239,68,68,0.2)",
                                                color: "rgba(239,68,68,0.7)",
                                            }}
                                        >✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Actions ───────────────────────────────────────────── */}
                <SectionHead label="Actions" />
                <div style={{ display: "flex", gap: 7 }}>
                    <Btn onClick={onClear}   variant="danger"  pad={isMobile ? "10px 0" : "7px 0"}>Clear</Btn>
                    <Btn onClick={onRescan}  variant="primary" pad={isMobile ? "10px 0" : "7px 0"}>Re-scan</Btn>
                </div>
            </div>
        </div>
    )
}

// ── Desktop sidebar (right panel) ─────────────────────────────────────────────
function DesktopSidebar({ open, onClose, ...rest }) {
    if (!open) return null
    return (
        <>
            {/* Backdrop — clicking outside closes the sidebar */}
            <div
                onClick={onClose}
                style={{
                    position: "fixed", inset: 0,
                    zIndex: 1140,
                    background: "transparent",
                }}
            />
            <div style={{
                position: "fixed", top: 40, right: 0, bottom: 0,
                width: 360, zIndex: 1150,
                ...GLASS,
                borderLeft: "1px solid rgba(255,255,255,0.08)",
                display: "flex", flexDirection: "column",
                boxShadow: "-8px 0 32px rgba(0,0,0,0.45)",
            }}>
                {/* Header */}
                <div style={{
                    flexShrink: 0, display: "flex", alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 16px", height: 44,
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <IconOverwatch size={13} color="#38bdf8" />
                        <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
                            textTransform: "uppercase", color: "#38bdf8",
                        }}>Overwatch</span>
                    </div>
                    <button onClick={onClose} style={{
                        ...BTN_BASE, background: "none", padding: "4px 8px",
                        color: "rgba(232,237,242,0.35)", fontSize: 18,
                    }}>✕</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                    <SidebarContent {...rest} isMobile={false} />
                </div>
            </div>
        </>
    )
}

// ── Mobile bottom panel (non-dismissing swipe) ────────────────────────────────
function MobileSidebar({ open, onClose, ...rest }) {
    const [collapsed, setCollapsed] = useState(false)
    const [dragY, setDragY]         = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const startYRef = useRef(0)

    function handleTouchStart(e) {
        startYRef.current = e.touches[0].clientY
        setIsDragging(true)
    }
    function handleTouchMove(e) {
        const diff = e.touches[0].clientY - startYRef.current
        if (diff > 0) setDragY(diff)
    }
    function handleTouchEnd() {
        setIsDragging(false)
        if (dragY > 80) setCollapsed(true)
        else setCollapsed(false)
        setDragY(0)
    }

    if (!open) return null

    const COLLAPSED_H = 54
    const FULL_H      = "70vh"

    return (
        <>
            {/* Tap-outside backdrop — only when expanded */}
            {!collapsed && (
                <div
                    onClick={onClose}
                    style={{
                        position: "fixed", inset: 0, zIndex: 1450,
                        background: "rgba(0,0,0,0.35)",
                    }}
                />
            )}
            <div
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                    position: "fixed", left: 0, right: 0,
                    bottom: 56, zIndex: 1451,
                    maxHeight: collapsed ? COLLAPSED_H : FULL_H,
                    ...GLASS,
                    borderRadius: "16px 16px 0 0",
                    borderTop: "1px solid rgba(56,189,248,0.25)",
                    borderLeft: "1px solid rgba(255,255,255,0.06)",
                    borderRight: "1px solid rgba(255,255,255,0.06)",
                    display: "flex", flexDirection: "column",
                    transform: `translateY(${dragY}px)`,
                    transition: isDragging ? "none" : "max-height 0.32s cubic-bezier(0.32,0.72,0,1), transform 0.3s ease-out",
                    overflow: "hidden",
                    boxShadow: "0 -6px 32px rgba(0,0,0,0.5)",
                }}
            >
                {/* Drag handle + header row */}
                <div
                    style={{
                        flexShrink: 0, display: "flex", flexDirection: "column",
                        alignItems: "center", paddingTop: 8,
                    }}
                    onClick={collapsed ? () => setCollapsed(false) : undefined}
                >
                    <div style={{
                        width: 36, height: 4, borderRadius: 2,
                        background: "rgba(148,163,184,0.35)", marginBottom: 8,
                    }} />
                    <div style={{
                        width: "100%", display: "flex", alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0 16px 8px",
                        borderBottom: "1px solid rgba(255,255,255,0.07)",
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <IconOverwatch size={13} color="#38bdf8" />
                            <span style={{
                                fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
                                textTransform: "uppercase", color: "#38bdf8",
                            }}>Overwatch</span>
                            {collapsed && rest.stats && (
                                <span style={{ fontSize: 10, color: "rgba(232,237,242,0.4)", marginLeft: 4 }}>
                                    · {rest.stats.total} detected
                                </span>
                            )}
                        </div>
                        <button onClick={e => { e.stopPropagation(); onClose() }} style={{
                            ...BTN_BASE, background: "none", padding: "4px 8px",
                            color: "rgba(232,237,242,0.35)", fontSize: 18,
                        }}>✕</button>
                    </div>
                </div>

                {/* Scrollable content — hidden when collapsed */}
                {!collapsed && (
                    <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" }}>
                        <SidebarContent {...rest} isMobile={true} />
                    </div>
                )}
            </div>
        </>
    )
}

// ── Public export ─────────────────────────────────────────────────────────────
export default function OverwatchSidebar({ isMobile, ...props }) {
    return isMobile
        ? <MobileSidebar {...props} />
        : <DesktopSidebar {...props} />
}
