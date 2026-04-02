import { useState } from "react"

// ── Icon (lives here to avoid circular dep with OverwatchLayer) ───────────────
export function IconOverwatch({ size = 18, color = "currentColor" }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke={color}
            strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 9C1 9 4 3 9 3C14 3 17 9 17 9C17 9 14 15 9 15C4 15 1 9 1 9Z"/>
            <circle cx="9" cy="9" r="2.5"/>
            <line x1="9"  y1="1"  x2="9"  y2="3"/>
            <line x1="9"  y1="15" x2="9"  y2="17"/>
            <line x1="1"  y1="9"  x2="3"  y2="9"/>
            <line x1="15" y1="9"  x2="17" y2="9"/>
        </svg>
    )
}

// ── Taxonomy ──────────────────────────────────────────────────────────────────
export const TAXONOMY = {
    Aircraft:       { color: "rgba(140,210,240,0.85)", classes: ["plane","airplane","helicopter"] },
    Vessel:         { color: "rgba(210,175,100,0.85)", classes: ["ship","boat"] },
    Vehicle:        { color: "rgba(120,200,130,0.85)", classes: ["large-vehicle","small-vehicle","large vehicle","small vehicle","car","truck","bus","motorcycle","bicycle"] },
    Infrastructure: { color: "rgba(170,130,215,0.85)", classes: ["bridge","harbor","train"] },
    Structure:      { color: "rgba(210,100,100,0.85)", classes: ["storage-tank","storage tank","roundabout"] },
    Facility:       { color: "rgba(200,155,85,0.85)",  classes: ["baseball-diamond","tennis-court","basketball-court","ground-track-field","soccer-ball-field","swimming-pool"] },
    Person:         { color: "rgba(220,120,145,0.85)", classes: ["person"] },
}

export function catForClass(cls) {
    const c = (cls || "").toLowerCase().trim()
    for (const [cat, info] of Object.entries(TAXONOMY)) {
        if (info.classes.includes(c)) return cat
    }
    return "Object"
}
export function colorForCat(cat)   { return TAXONOMY[cat]?.color || "rgba(200,210,220,0.7)" }
export function colorForClass(cls) { return colorForCat(catForClass(cls)) }

// ── Persistence ───────────────────────────────────────────────────────────────
const SCANS_KEY  = "ow-saved-scans-v1"
const IMAGES_KEY = "ow-saved-images-v1"

export function loadSavedScans()  { try { return JSON.parse(localStorage.getItem(SCANS_KEY))  || [] } catch { return [] } }
export function loadSavedImages() { try { return JSON.parse(localStorage.getItem(IMAGES_KEY)) || [] } catch { return [] } }

export function persistSavedScans(arr) {
    try { localStorage.setItem(SCANS_KEY, JSON.stringify(arr)) } catch {}
}
export function persistSavedImages(arr) {
    try {
        localStorage.setItem(IMAGES_KEY, JSON.stringify(arr))
    } catch {
        // Quota exceeded — try keeping metadata only (drop base64 src)
        try {
            const slim = arr.map(i => ({ ...i, src: null }))
            localStorage.setItem(IMAGES_KEY, JSON.stringify(slim))
        } catch {}
    }
}

// ── Shared style constants ────────────────────────────────────────────────────
const GLASS = {
    background:           "rgba(7,14,28,0.88)",
    backdropFilter:       "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    fontFamily:           "Inter,-apple-system,sans-serif",
    color:                "rgba(220,228,238,0.82)",
}

const T = {
    primary:   "rgba(220,228,238,0.82)",
    secondary: "rgba(220,228,238,0.42)",
    muted:     "rgba(220,228,238,0.22)",
    accent:    "rgba(140,210,240,0.7)",
}

const B = { cursor: "pointer", fontFamily: "inherit", lineHeight: 1, border: "none" }

// ── Small UI pieces ───────────────────────────────────────────────────────────
function Divider() {
    return <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "10px 0" }} />
}

function SectionHead({ label }) {
    return (
        <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, padding: "12px 0 5px" }}>
            {label}
        </div>
    )
}

// Thin action button — plain glass, no saturated color
function ActionBtn({ onClick, children, hint, disabled, danger }) {
    return (
        <button onClick={disabled ? undefined : onClick} style={{
            ...B,
            width: "100%", display: "flex", flexDirection: "column",
            padding: "9px 11px", marginBottom: 5, borderRadius: 7,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${danger ? "rgba(200,80,80,0.3)" : "rgba(255,255,255,0.09)"}`,
            color: disabled ? T.muted : danger ? "rgba(210,90,90,0.8)" : T.primary,
            opacity: disabled ? 0.45 : 1,
            textAlign: "left",
        }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>{children}</span>
            {hint && <span style={{ fontSize: 9, color: T.secondary, marginTop: 3 }}>{hint}</span>}
        </button>
    )
}

// Row button group
function BtnRow({ children }) {
    return <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>{children}</div>
}

function SmBtn({ onClick, children, danger, disabled }) {
    return (
        <button onClick={disabled ? undefined : onClick} style={{
            ...B,
            flex: 1, padding: "7px 0", fontSize: 10, fontWeight: 600, borderRadius: 6,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${danger ? "rgba(200,80,80,0.28)" : "rgba(255,255,255,0.09)"}`,
            color: disabled ? T.muted : danger ? "rgba(210,90,90,0.75)" : T.secondary,
            opacity: disabled ? 0.5 : 1,
        }}>
            {children}
        </button>
    )
}

// Slim toggle row
function SlimToggle({ on, onToggle, label, hint, disabled }) {
    return (
        <div onClick={disabled ? undefined : onToggle} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 11px", borderRadius: 7, marginBottom: 5,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${on ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.07)"}`,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.4 : 1,
        }}>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: on ? T.primary : T.secondary }}>{label}</div>
                {hint && <div style={{ fontSize: 9, color: T.muted, marginTop: 1 }}>{hint}</div>}
            </div>
            <div style={{
                width: 30, height: 17, borderRadius: 9, flexShrink: 0,
                background: on ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)",
                display: "flex", alignItems: "center",
                padding: "0 2px", justifyContent: on ? "flex-end" : "flex-start",
                transition: "background 0.2s",
            }}>
                <div style={{ width: 13, height: 13, borderRadius: "50%", background: on ? "#fff" : "rgba(255,255,255,0.5)", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }} />
            </div>
        </div>
    )
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmtDate(iso) {
    if (!iso) return ""
    try {
        return new Date(iso).toLocaleString(undefined, {
            month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit",
        })
    } catch { return "" }
}

// ── Main sidebar content (mode-aware) ─────────────────────────────────────────
function SidebarContent(props) {
    const {
        mode, vertCount,
        onStartDraw, onCancelDraw,
        stats, detections, visible,
        minConf, onMinConfChange,
        enhance, onEnhanceToggle, enhanced,
        analysis, analyzing, onAnalyze, onDismissAnalysis,
        onClear, onRescan,
        sentinel2Active, onToggleSentinel2, sentinelImageData,
        onPinImagery,
        selectedCats, onToggleCat, onClearCatFilter,
        savedScans, onSave, onDeleteSaved, onRestoreSaved,
        savedImages, onDeleteSavedImage,
        isMobile,
    } = props

    const [showDetList, setShowDetList] = useState(false)
    const [showSaved,   setShowSaved]   = useState(false)

    const catCounts = {}
    for (const d of detections) {
        const cat = d.category || catForClass(d.class)
        catCounts[cat] = (catCounts[cat] || 0) + 1
    }
    const allCats = Object.keys(catCounts).sort()
    const hasSaved = savedScans.length > 0 || savedImages.length > 0

    // ── Drawing mode ──────────────────────────────────────────────────────────
    if (mode === "drawing") {
        return (
            <div style={{ padding: "16px" }}>
                <div style={{
                    padding: "12px 14px", borderRadius: 7,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.09)",
                    marginBottom: 14,
                }}>
                    <div style={{ fontSize: 11, color: T.primary, marginBottom: 6, fontWeight: 600 }}>Drawing polygon</div>
                    <div style={{ fontSize: 10, color: T.secondary, lineHeight: 1.6 }}>
                        Click to place vertices<br />
                        Click near the start point to close
                    </div>
                    <div style={{ fontSize: 9, color: T.muted, marginTop: 8 }}>
                        {vertCount} {vertCount === 1 ? "vertex" : "vertices"} placed
                        {vertCount >= 3 && " · hover start to snap"}
                    </div>
                </div>
                <ActionBtn onClick={onCancelDraw} danger>Cancel Drawing</ActionBtn>
            </div>
        )
    }

    // ── Analyzing mode ────────────────────────────────────────────────────────
    if (mode === "analyzing") {
        return (
            <div style={{ padding: "16px" }}>
                <div style={{
                    padding: "14px", borderRadius: 7,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    display: "flex", alignItems: "center", gap: 10,
                }}>
                    <div style={{
                        width: 20, height: 20, flexShrink: 0,
                        border: "2px solid rgba(255,255,255,0.1)",
                        borderTop: "2px solid rgba(200,220,240,0.6)",
                        borderRadius: "50%",
                        animation: "ow-spin 0.8s linear infinite",
                    }} />
                    <div>
                        <div style={{ fontSize: 11, color: T.primary, fontWeight: 600 }}>Analyzing…</div>
                        <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>This may take a moment</div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div style={{ padding: "0 16px 16px" }}>

            {/* ── Idle: primary actions ──────────────────────────────────── */}
            {mode === "idle" && (
                <>
                    <SectionHead label="Actions" />
                    <ActionBtn onClick={onStartDraw} hint="Draw a polygon on the map">
                        Analyze Region
                    </ActionBtn>
                    <SlimToggle
                        on={sentinel2Active}
                        onToggle={onToggleSentinel2}
                        label="Sentinel-2 Imagery"
                        hint={sentinelImageData
                            ? `Loaded · ${fmtDate(sentinelImageData.capturedAt)}`
                            : "Draw region to load Copernicus imagery"}
                    />
                    {sentinelImageData && (
                        <>
                            <ActionBtn onClick={props.onRunSentinelML} hint="Run object detection on loaded imagery">
                                Run ML on Sentinel
                            </ActionBtn>
                            <ActionBtn onClick={onPinImagery} hint="Keep imagery visible after Overwatch closes">
                                Pin Imagery to Map
                            </ActionBtn>
                        </>
                    )}
                </>
            )}

            {/* ── Results ───────────────────────────────────────────────── */}
            {mode === "results" && stats && (
                <>
                    {/* Count */}
                    <div style={{ paddingTop: 14, marginBottom: 12 }}>
                        <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: (stats.total || 0) > 0 ? T.primary : T.muted }}>
                            {stats.total ?? 0}
                            <span style={{ fontSize: 11, fontWeight: 400, color: T.secondary, marginLeft: 8 }}>
                                {(stats.total ?? 0) === 1 ? "object detected" : "objects detected"}
                            </span>
                        </div>
                        {visible.length < detections.length && (
                            <div style={{ fontSize: 9, color: T.muted, marginTop: 3 }}>
                                {visible.length} shown after filters
                            </div>
                        )}
                        {stats.zoom && (
                            <div style={{ fontSize: 9, color: T.muted, marginTop: 3 }}>
                                {stats.zoom === "Sentinel-2" ? "Sentinel-2" : `zoom ${stats.zoom}`}
                                {enhanced && <span style={{ marginLeft: 5, color: T.secondary }}>· AI enhanced</span>}
                            </div>
                        )}
                    </div>

                    {/* Category filter chips */}
                    {allCats.length > 0 && (
                        <>
                            <SectionHead label="Filter" />
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 5px", marginBottom: 5 }}>
                                {allCats.map(cat => {
                                    const active = selectedCats.size === 0 || selectedCats.has(cat)
                                    return (
                                        <button key={cat} onClick={() => onToggleCat(cat)} style={{
                                            ...B,
                                            fontSize: 10, padding: "4px 9px", borderRadius: 12,
                                            fontWeight: 600,
                                            background: active ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.03)",
                                            border: `1px solid ${active ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.07)"}`,
                                            color: active ? T.primary : T.muted,
                                            transition: "all 0.12s",
                                        }}>
                                            {cat} <span style={{ opacity: 0.6, fontWeight: 400 }}>{catCounts[cat]}</span>
                                        </button>
                                    )
                                })}
                            </div>
                            {selectedCats.size > 0 && (
                                <button onClick={onClearCatFilter} style={{
                                    ...B, background: "none", fontSize: 9, color: T.muted,
                                    padding: "0 0 8px", textDecoration: "underline",
                                    textDecorationColor: "rgba(220,228,238,0.15)",
                                }}>
                                    Clear filter
                                </button>
                            )}
                        </>
                    )}

                    {/* Confidence slider */}
                    <SectionHead label="Confidence" />
                    <div style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                            <span style={{ fontSize: 9, color: T.muted }}>Min confidence</span>
                            <span style={{ fontSize: 9, color: T.secondary, fontWeight: 600 }}>
                                {Math.round(minConf * 100)}%
                            </span>
                        </div>
                        <input type="range" min={0} max={0.9} step={0.05} value={minConf}
                            onChange={e => onMinConfChange(parseFloat(e.target.value))}
                            style={{ width: "100%", accentColor: "rgba(180,210,230,0.6)", cursor: "pointer" }}
                        />
                        <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>
                            Showing {visible.length} of {detections.length}
                        </div>
                    </div>

                    {/* Sentinel toggle */}
                    <SectionHead label="Imagery" />
                    <SlimToggle
                        on={sentinel2Active}
                        onToggle={onToggleSentinel2}
                        label="Sentinel-2 Imagery"
                        hint={sentinelImageData
                            ? `Loaded · ${fmtDate(sentinelImageData.capturedAt)}`
                            : "No imagery loaded"}
                    />
                    {sentinelImageData && (
                        <ActionBtn onClick={onPinImagery} hint="Keep imagery on map when Overwatch is closed">
                            Pin Imagery to Map
                        </ActionBtn>
                    )}

                    {/* AI Classification */}
                    <SectionHead label="Enhancement" />
                    <SlimToggle
                        on={enhance}
                        onToggle={onEnhanceToggle}
                        label="AI Classification"
                        hint={enhance ? "Claude vision active — slower" : "Enable Claude vision for detailed labels"}
                    />

                    {/* Detection list */}
                    {detections.length > 0 && (
                        <>
                            <SectionHead label="Detections" />
                            <button onClick={() => setShowDetList(v => !v)} style={{
                                ...B,
                                width: "100%", display: "flex", alignItems: "center",
                                justifyContent: "space-between",
                                padding: "7px 10px", borderRadius: 6, marginBottom: 5,
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid rgba(255,255,255,0.07)",
                                color: T.secondary, fontSize: 10,
                            }}>
                                <span>{showDetList ? "Hide" : "Show"} {visible.length} item{visible.length !== 1 ? "s" : ""}</span>
                                <span style={{ opacity: 0.4 }}>{showDetList ? "▲" : "▼"}</span>
                            </button>
                            {showDetList && (
                                <div style={{
                                    maxHeight: 200, overflowY: "auto",
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
                                                <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 10, color: T.primary, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                        {label}
                                                    </div>
                                                    <div style={{ fontSize: 8, color: T.muted }}>
                                                        {cat}{det.subcategory ? ` · ${det.subcategory}` : ""}
                                                    </div>
                                                </div>
                                                <span style={{ fontSize: 9, color: T.secondary, flexShrink: 0 }}>
                                                    {Math.round(det.confidence * 100)}%
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </>
                    )}

                    {/* Intelligence */}
                    <SectionHead label="Intelligence" />
                    <ActionBtn onClick={onAnalyze} disabled={analyzing || !detections.length}>
                        {analyzing ? "Running assessment…" : "Assess Area"}
                    </ActionBtn>
                    {analysis && (
                        <div style={{
                            marginBottom: 8, padding: "10px 12px",
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 7,
                        }}>
                            <div style={{ fontSize: 8, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
                                Assessment
                            </div>
                            {analysis.summary && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 4px", marginBottom: 7 }}>
                                    {Object.entries(analysis.summary).sort(([,a],[,b]) => b - a).map(([cls, n]) => (
                                        <span key={cls} style={{
                                            fontSize: 9, padding: "2px 6px", borderRadius: 10,
                                            background: "rgba(255,255,255,0.06)",
                                            border: "1px solid rgba(255,255,255,0.1)",
                                            color: T.secondary,
                                        }}>{n} {cls}</span>
                                    ))}
                                </div>
                            )}
                            <div style={{ fontSize: 11, lineHeight: 1.55, color: T.secondary, whiteSpace: "pre-wrap" }}>
                                {analysis.analysis}
                            </div>
                            <button onClick={onDismissAnalysis} style={{
                                ...B, background: "none", marginTop: 6,
                                fontSize: 9, color: T.muted, padding: 0,
                            }}>Dismiss</button>
                        </div>
                    )}

                    {/* Save */}
                    <SectionHead label="Save" />
                    <ActionBtn onClick={onSave} disabled={!detections.length}
                        hint="Pin detections to map — visible after Overwatch closes">
                        Save Detections to Map
                    </ActionBtn>

                    {/* Actions */}
                    <SectionHead label="Actions" />
                    <BtnRow>
                        <SmBtn onClick={onClear} danger>Clear</SmBtn>
                        <SmBtn onClick={onRescan}>Re-scan</SmBtn>
                    </BtnRow>

                    {/* Re-draw option */}
                    <ActionBtn onClick={onStartDraw} hint="Draw a new region on the map">
                        New Region
                    </ActionBtn>
                </>
            )}

            {/* ── Saved items (always visible) ───────────────────────────── */}
            {hasSaved && (
                <>
                    <Divider />
                    <button onClick={() => setShowSaved(v => !v)} style={{
                        ...B,
                        width: "100%", display: "flex", alignItems: "center",
                        justifyContent: "space-between",
                        padding: "7px 0", fontSize: 10,
                        background: "none", color: T.secondary,
                    }}>
                        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted }}>
                            Saved ({savedScans.length + savedImages.length})
                        </span>
                        <span style={{ opacity: 0.4 }}>{showSaved ? "▲" : "▼"}</span>
                    </button>

                    {showSaved && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {savedScans.map(scan => (
                                <div key={scan.id} style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "7px 10px", borderRadius: 6,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.07)",
                                }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 10, color: T.primary, fontWeight: 600 }}>
                                            {scan.stats?.total ?? 0} objects
                                        </div>
                                        <div style={{ fontSize: 8, color: T.muted, marginTop: 1 }}>
                                            {fmtDate(scan.timestamp)}
                                        </div>
                                    </div>
                                    <button onClick={() => onRestoreSaved(scan)} style={{
                                        ...B, fontSize: 9, padding: "3px 8px", borderRadius: 4,
                                        background: "rgba(255,255,255,0.06)",
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        color: T.secondary,
                                    }}>Load</button>
                                    <button onClick={() => onDeleteSaved(scan.id)} style={{
                                        ...B, fontSize: 13, padding: "2px 6px", borderRadius: 4,
                                        background: "rgba(200,80,80,0.07)",
                                        border: "1px solid rgba(200,80,80,0.2)",
                                        color: "rgba(200,80,80,0.65)",
                                    }}>✕</button>
                                </div>
                            ))}
                            {savedImages.map(img => (
                                <div key={img.id} style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "7px 10px", borderRadius: 6,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.07)",
                                }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 10, color: T.secondary, fontWeight: 600 }}>
                                            Sentinel-2 imagery
                                        </div>
                                        <div style={{ fontSize: 8, color: T.muted, marginTop: 1 }}>
                                            {fmtDate(img.capturedAt || img.timestamp)}
                                            {!img.src && " · image not stored"}
                                        </div>
                                    </div>
                                    <button onClick={() => onDeleteSavedImage(img.id)} style={{
                                        ...B, fontSize: 13, padding: "2px 6px", borderRadius: 4,
                                        background: "rgba(200,80,80,0.07)",
                                        border: "1px solid rgba(200,80,80,0.2)",
                                        color: "rgba(200,80,80,0.65)",
                                    }}>✕</button>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

// ── Header bar (shared) ───────────────────────────────────────────────────────
function PanelHeader({ onClose, stats, mode }) {
    return (
        <div style={{
            flexShrink: 0, display: "flex", alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px", height: 44,
            borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <IconOverwatch size={13} color="rgba(140,210,240,0.7)" />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(140,210,240,0.7)" }}>
                    Overwatch
                </span>
                {mode === "results" && stats && (
                    <span style={{ fontSize: 9, color: "rgba(220,228,238,0.3)", marginLeft: 2 }}>
                        · {stats.total} detected
                    </span>
                )}
            </div>
            <button onClick={onClose} style={{
                cursor: "pointer", background: "none", border: "none",
                color: "rgba(220,228,238,0.3)", fontSize: 18, lineHeight: 1,
                padding: "4px 8px", fontFamily: "inherit",
            }}>✕</button>
        </div>
    )
}

// ── Desktop sidebar ───────────────────────────────────────────────────────────
function DesktopSidebar({ open, onClose, ...rest }) {
    if (!open) return null
    return (
        <>
            {/* transparent click-outside layer */}
            <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1140 }} />
            <div style={{
                position: "fixed", top: 40, right: 0, bottom: 0, width: 340, zIndex: 1150,
                ...GLASS,
                borderLeft: "1px solid rgba(255,255,255,0.07)",
                display: "flex", flexDirection: "column",
                boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
            }}>
                <PanelHeader onClose={onClose} stats={rest.stats} mode={rest.mode} />
                <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                    <SidebarContent {...rest} isMobile={false} />
                </div>
            </div>
        </>
    )
}

// ── Mobile bottom panel (collapsible, no auto-dismiss) ────────────────────────
function MobileSidebar({ open, onClose, mode, stats, ...rest }) {
    const [collapsed, setCollapsed] = useState(false)

    if (!open) return null

    return (
        <>
            {!collapsed && (
                <div onClick={onClose} style={{
                    position: "fixed", inset: 0, zIndex: 1450,
                    background: "rgba(0,0,0,0.3)",
                }} />
            )}
            <div style={{
                position: "fixed", left: 0, right: 0, bottom: 56, zIndex: 1451,
                maxHeight: collapsed ? 50 : "72vh",
                ...GLASS,
                borderRadius: "14px 14px 0 0",
                borderTop: "1px solid rgba(255,255,255,0.1)",
                display: "flex", flexDirection: "column",
                transition: "max-height 0.3s cubic-bezier(0.32,0.72,0,1)",
                overflow: "hidden",
                boxShadow: "0 -6px 32px rgba(0,0,0,0.5)",
            }}>
                {/* Drag handle + header */}
                <div
                    style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8, cursor: "pointer" }}
                    onClick={() => setCollapsed(v => !v)}
                >
                    <div style={{ width: 32, height: 3, borderRadius: 2, background: "rgba(200,210,220,0.25)", marginBottom: 8 }} />
                    <div style={{
                        width: "100%", display: "flex", alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0 16px 8px",
                        borderBottom: "1px solid rgba(255,255,255,0.07)",
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <IconOverwatch size={13} color="rgba(140,210,240,0.7)" />
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(140,210,240,0.7)" }}>
                                Overwatch
                            </span>
                            {mode === "results" && stats && (
                                <span style={{ fontSize: 9, color: "rgba(220,228,238,0.3)", marginLeft: 2 }}>
                                    · {stats.total} detected
                                </span>
                            )}
                        </div>
                        <button onClick={e => { e.stopPropagation(); onClose() }} style={{
                            cursor: "pointer", background: "none", border: "none",
                            color: "rgba(220,228,238,0.3)", fontSize: 18, lineHeight: 1,
                            padding: "4px 8px",
                        }}>✕</button>
                    </div>
                </div>

                {!collapsed && (
                    <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" }}>
                        <SidebarContent {...rest} mode={mode} stats={stats} isMobile />
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
