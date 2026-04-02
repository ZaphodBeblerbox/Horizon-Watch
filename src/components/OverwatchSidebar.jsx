import { useState } from "react"

// ── Icon ──────────────────────────────────────────────────────────────────────
export function IconOverwatch({ size = 18, color = "currentColor" }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke={color}
            strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 9C1 9 4 3 9 3C14 3 17 9 17 9C17 9 14 15 9 15C4 15 1 9 1 9Z"/>
            <circle cx="9" cy="9" r="2.5"/>
            <line x1="9" y1="1" x2="9" y2="3"/>
            <line x1="9" y1="15" x2="9" y2="17"/>
            <line x1="1" y1="9" x2="3" y2="9"/>
            <line x1="15" y1="9" x2="17" y2="9"/>
        </svg>
    )
}

// ── Taxonomy ──────────────────────────────────────────────────────────────────
export const TAXONOMY = {
    Aircraft:       { color: "#60b4d8", classes: ["plane","airplane","helicopter"] },
    Vessel:         { color: "#c9943a", classes: ["ship","boat"] },
    Vehicle:        { color: "#5aad68", classes: ["large-vehicle","small-vehicle","large vehicle","small vehicle","car","truck","bus","motorcycle","bicycle"] },
    Infrastructure: { color: "#9b72cc", classes: ["bridge","harbor","train"] },
    Structure:      { color: "#cc5252", classes: ["storage-tank","storage tank","roundabout"] },
    Facility:       { color: "#b88440", classes: ["baseball-diamond","tennis-court","basketball-court","ground-track-field","soccer-ball-field","swimming-pool"] },
    Person:         { color: "#cc6080", classes: ["person"] },
}

export function catForClass(cls) {
    const c = (cls || "").toLowerCase().trim()
    for (const [cat, info] of Object.entries(TAXONOMY)) {
        if (info.classes.includes(c)) return cat
    }
    return "Object"
}
export function colorForCat(cat) { return TAXONOMY[cat]?.color || "rgba(200,210,220,0.6)" }
export function colorForClass(cls) { return colorForCat(catForClass(cls)) }

// ── Persistence ───────────────────────────────────────────────────────────────
const SCANS_KEY  = "ow-saved-scans-v1"
const IMAGES_KEY = "ow-saved-images-v1"
export function loadSavedScans()  { try { return JSON.parse(localStorage.getItem(SCANS_KEY))  || [] } catch { return [] } }
export function loadSavedImages() { try { return JSON.parse(localStorage.getItem(IMAGES_KEY)) || [] } catch { return [] } }
export function persistSavedScans(arr)  { try { localStorage.setItem(SCANS_KEY,  JSON.stringify(arr)) } catch {} }
export function persistSavedImages(arr) {
    try { localStorage.setItem(IMAGES_KEY, JSON.stringify(arr)) } catch {
        try { localStorage.setItem(IMAGES_KEY, JSON.stringify(arr.map(i => ({ ...i, src: null })))) } catch {}
    }
}

// ── Sentinel image types ──────────────────────────────────────────────────────
export const SENTINEL_TYPES = [
    { key: "true-colour",        label: "True Colour" },
    { key: "false-colour",       label: "False Colour" },
    { key: "highlight-optimized",label: "Highlight Opt." },
    { key: "ndvi",               label: "NDVI" },
    { key: "false-colour-urban", label: "Urban" },
    { key: "moisture-index",     label: "Moisture" },
    { key: "swir",               label: "SWIR" },
    { key: "ndwi",               label: "NDWI" },
    { key: "ndsi",               label: "NDSI" },
]

// ── Shared micro-styles ───────────────────────────────────────────────────────
const S = {
    row: { display: "flex", alignItems: "center", gap: 8 },
    btn: {
        cursor: "pointer", fontFamily: "inherit", lineHeight: 1,
        border: "none", background: "none",
    },
}

function fmtDate(iso) {
    if (!iso) return ""
    try {
        return new Date(iso).toLocaleString(undefined, {
            month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit",
        })
    } catch { return "" }
}
function fmtShortDate(iso) {
    if (!iso) return ""
    try {
        return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })
    } catch { return "" }
}

// ── Shared UI atoms ───────────────────────────────────────────────────────────
function SectionHead({ label, action, onAction }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
            color: "var(--akili-text-muted)", padding: "13px 0 5px",
        }}>
            {label}
            {action && (
                <button onClick={onAction} style={{ ...S.btn, fontSize: 9, color: "var(--akili-accent)", letterSpacing: "0.04em" }}>
                    {action}
                </button>
            )}
        </div>
    )
}

function Rule() {
    return <div style={{ height: 1, background: "var(--akili-border)", margin: "10px 0 4px" }} />
}

function PanelBtn({ onClick, children, danger, disabled, wide, accent }) {
    return (
        <button onClick={disabled ? undefined : onClick} style={{
            ...S.btn,
            width: wide ? "100%" : undefined,
            flex: wide ? undefined : 1,
            display: "block", textAlign: "center",
            padding: "7px 10px",
            fontSize: 11, fontWeight: 600, borderRadius: 5,
            background: accent
                ? "var(--akili-accent)"
                : "rgba(255,255,255,0.04)",
            border: `1px solid ${
                danger  ? "rgba(200,60,60,0.35)"  :
                accent  ? "transparent"            :
                "var(--akili-border)"
            }`,
            color: accent
                ? "#fff"
                : danger
                    ? "rgba(220,80,80,0.8)"
                    : disabled
                        ? "var(--akili-text-muted)"
                        : "var(--akili-text-secondary)",
            opacity: disabled ? 0.45 : 1,
        }}>
            {children}
        </button>
    )
}

function SlimToggle({ on, onToggle, label, hint, disabled }) {
    return (
        <div onClick={disabled ? undefined : onToggle} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "7px 10px", borderRadius: 6, marginBottom: 4,
            background: on ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
            border: `1px solid ${on ? "rgba(255,255,255,0.13)" : "var(--akili-border)"}`,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.4 : 1,
        }}>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: on ? "var(--akili-text-primary)" : "var(--akili-text-secondary)" }}>{label}</div>
                {hint && <div style={{ fontSize: 9, color: "var(--akili-text-muted)", marginTop: 1 }}>{hint}</div>}
            </div>
            <div style={{
                width: 30, height: 17, borderRadius: 9, flexShrink: 0,
                background: on ? "var(--akili-accent)" : "rgba(255,255,255,0.12)",
                display: "flex", alignItems: "center",
                padding: "0 2px", justifyContent: on ? "flex-end" : "flex-start",
                transition: "background 0.18s",
            }}>
                <div style={{ width: 13, height: 13, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }} />
            </div>
        </div>
    )
}

// ── Sentinel imagery section ──────────────────────────────────────────────────
function SentinelSection({
    sentinelMode, onStartSentinelDraw, onCancelSentinelDraw,
    sentinelImageType, onImageTypeChange,
    sentinelMaxCloud, onMaxCloudChange,
    sentinelDaysBack, onDaysBackChange,
    sentinelLoading, sentinelCurrentImg, onLoadImagery, onClearImagery,
    sentinelDates, sentinelDatesLoading, onFetchDates,
    onLoadDate,
    onPinImagery,
    onRunMLOnSentinel, sentinelBounds,
    sentinel2Active, onToggleSentinel2,
    isMobile,
}) {
    const [showHistory, setShowHistory] = useState(false)
    const [showTypeGrid, setShowTypeGrid] = useState(false)

    const currentTypeLabel = SENTINEL_TYPES.find(t => t.key === sentinelImageType)?.label || sentinelImageType

    return (
        <div>
            <SectionHead label="Sentinel-2 Imagery" />

            {/* Draw region button */}
            {!sentinelMode && !sentinelCurrentImg && (
                <PanelBtn onClick={onStartSentinelDraw} wide>
                    Draw Region on Map
                </PanelBtn>
            )}
            {sentinelMode && (
                <div style={{
                    padding: "9px 11px", borderRadius: 6, marginBottom: 5,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid var(--akili-border)",
                }}>
                    <div style={{ fontSize: 10, color: "var(--akili-text-primary)", fontWeight: 600, marginBottom: 3 }}>
                        Drawing region…
                    </div>
                    <div style={{ fontSize: 9, color: "var(--akili-text-secondary)", lineHeight: 1.5 }}>
                        Click vertices on the map · click near start to close
                    </div>
                    <button onClick={onCancelSentinelDraw} style={{
                        ...S.btn, marginTop: 7, fontSize: 9,
                        color: "rgba(200,70,70,0.75)", textDecoration: "underline",
                        textDecorationColor: "rgba(200,70,70,0.3)",
                    }}>
                        Cancel
                    </button>
                </div>
            )}

            {/* Image type selector */}
            <div style={{ marginBottom: 5 }}>
                <button onClick={() => setShowTypeGrid(v => !v)} style={{
                    ...S.btn,
                    width: "100%", display: "flex", alignItems: "center",
                    justifyContent: "space-between",
                    padding: "7px 10px", borderRadius: 6,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--akili-border)",
                    color: "var(--akili-text-secondary)", fontSize: 10,
                }}>
                    <span style={{ fontSize: 9, color: "var(--akili-text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        Type
                    </span>
                    <span style={{ fontWeight: 600, color: "var(--akili-text-primary)" }}>
                        {currentTypeLabel} {showTypeGrid ? "▲" : "▼"}
                    </span>
                </button>
                {showTypeGrid && (
                    <div style={{
                        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                        gap: 4, padding: "6px 0",
                    }}>
                        {SENTINEL_TYPES.map(t => (
                            <button key={t.key} onClick={() => { onImageTypeChange(t.key); setShowTypeGrid(false) }} style={{
                                ...S.btn,
                                padding: "5px 4px", borderRadius: 5, fontSize: 9, fontWeight: 600,
                                textAlign: "center",
                                background: sentinelImageType === t.key ? "var(--akili-accent)" : "rgba(255,255,255,0.04)",
                                border: `1px solid ${sentinelImageType === t.key ? "transparent" : "var(--akili-border)"}`,
                                color: sentinelImageType === t.key ? "#fff" : "var(--akili-text-secondary)",
                            }}>
                                {t.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Cloud & days sliders */}
            <div style={{ marginBottom: 5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 3 }}>
                    <span style={{ color: "var(--akili-text-muted)" }}>Max cloud</span>
                    <span style={{ color: "var(--akili-text-secondary)", fontWeight: 600 }}>{sentinelMaxCloud}%</span>
                </div>
                <input type="range" min={0} max={100} step={5} value={sentinelMaxCloud}
                    onChange={e => onMaxCloudChange(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "var(--akili-accent)", cursor: "pointer" }}
                />
            </div>
            <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 3 }}>
                    <span style={{ color: "var(--akili-text-muted)" }}>Look-back</span>
                    <span style={{ color: "var(--akili-text-secondary)", fontWeight: 600 }}>{sentinelDaysBack}d</span>
                </div>
                <input type="range" min={7} max={365} step={7} value={sentinelDaysBack}
                    onChange={e => onDaysBackChange(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "var(--akili-accent)", cursor: "pointer" }}
                />
            </div>

            {/* Load / current image status */}
            {sentinelBounds && !sentinelCurrentImg && !sentinelLoading && (
                <PanelBtn onClick={onLoadImagery} wide accent>Load Imagery</PanelBtn>
            )}
            {sentinelLoading && (
                <div style={{ ...S.row, padding: "8px 0", fontSize: 10, color: "var(--akili-text-secondary)" }}>
                    <div style={{
                        width: 14, height: 14, flexShrink: 0,
                        border: "2px solid rgba(255,255,255,0.08)",
                        borderTop: `2px solid var(--akili-accent)`,
                        borderRadius: "50%", animation: "ow-spin 0.8s linear infinite",
                    }} />
                    Fetching imagery…
                </div>
            )}
            {sentinelCurrentImg && !sentinelLoading && (
                <div style={{
                    padding: "8px 10px", borderRadius: 6, marginBottom: 5,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--akili-border)",
                }}>
                    <div style={{ fontSize: 9, color: "var(--akili-text-muted)", marginBottom: 2 }}>
                        {sentinelCurrentImg.date
                            ? `Scene: ${fmtShortDate(sentinelCurrentImg.date)}`
                            : fmtDate(sentinelCurrentImg.capturedAt)}
                        {" · "}{currentTypeLabel}
                    </div>
                    <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                        <PanelBtn onClick={onClearImagery}>Clear</PanelBtn>
                        <PanelBtn onClick={() => onStartSentinelDraw()}>New Region</PanelBtn>
                        {onPinImagery && <PanelBtn onClick={onPinImagery}>Pin</PanelBtn>}
                    </div>
                    {onRunMLOnSentinel && (
                        <PanelBtn onClick={onRunMLOnSentinel} wide accent>
                            Run ML Detection on This Image
                        </PanelBtn>
                    )}
                </div>
            )}

            {/* History */}
            {sentinelBounds && (
                <>
                    <button onClick={() => {
                        setShowHistory(v => !v)
                        if (!showHistory && !sentinelDates?.length) onFetchDates()
                    }} style={{
                        ...S.btn, width: "100%", display: "flex", alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px", borderRadius: 6,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid var(--akili-border)",
                        color: "var(--akili-text-muted)", fontSize: 9,
                        textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2,
                    }}>
                        <span>Scene History</span>
                        <span>{showHistory ? "▲" : "▼"}</span>
                    </button>

                    {showHistory && (
                        <div style={{ marginTop: 4 }}>
                            {sentinelDatesLoading && (
                                <div style={{ fontSize: 9, color: "var(--akili-text-muted)", padding: "6px 0" }}>Searching scenes…</div>
                            )}
                            {!sentinelDatesLoading && sentinelDates?.length === 0 && (
                                <div style={{ fontSize: 9, color: "var(--akili-text-muted)", padding: "6px 0" }}>No scenes found</div>
                            )}
                            {(sentinelDates || []).map(d => (
                                <div key={d.date} style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "5px 8px", borderRadius: 5, marginBottom: 3,
                                    background: sentinelCurrentImg?.date === d.date
                                        ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.02)",
                                    border: `1px solid ${sentinelCurrentImg?.date === d.date
                                        ? "rgba(255,255,255,0.16)" : "var(--akili-border)"}`,
                                    cursor: "pointer",
                                }} onClick={() => onLoadDate(d.date)}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 10, color: "var(--akili-text-primary)", fontWeight: sentinelCurrentImg?.date === d.date ? 600 : 400 }}>
                                            {fmtShortDate(d.date + "T12:00:00Z")}
                                        </div>
                                        {d.cloud_cover != null && (
                                            <div style={{ fontSize: 8, color: "var(--akili-text-muted)" }}>
                                                ☁ {d.cloud_cover.toFixed(0)}%
                                            </div>
                                        )}
                                    </div>
                                    <span style={{ fontSize: 9, color: "var(--akili-accent)" }}>Load</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

// ── Main sidebar content ──────────────────────────────────────────────────────
function SidebarContent(props) {
    const {
        mode, vertCount, drawTarget,
        onStartMLDraw, onCancelDraw,
        stats, detections, visible,
        minConf, onMinConfChange,
        enhance, onEnhanceToggle, enhanced,
        analysis, analyzing, onAnalyze, onDismissAnalysis,
        onClear, onRescan,
        savedScans, onSave, onDeleteSaved, onRestoreSaved,
        savedImages, onDeleteSavedImage,
        isMobile,
        // sentinel props passed through
        ...sentinelProps
    } = props

    const [showDetList, setShowDetList] = useState(false)
    const [showSaved,   setShowSaved]   = useState(false)

    const catCounts = {}
    for (const d of detections) {
        const cat = d.category || catForClass(d.class)
        catCounts[cat] = (catCounts[cat] || 0) + 1
    }
    const allCats = Object.keys(catCounts).sort()

    const isDrawingML       = mode === "drawing" && drawTarget === "ml"
    const isDrawingSentinel = mode === "drawing" && drawTarget === "sentinel"

    return (
        <div style={{ padding: "0 14px 16px" }}>

            {/* ── ML Analysis ─────────────────────────────────────────── */}
            <SectionHead label="ML Object Detection" />
            {isDrawingML ? (
                <div style={{
                    padding: "9px 11px", borderRadius: 6, marginBottom: 5,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid var(--akili-border)",
                }}>
                    <div style={{ fontSize: 10, color: "var(--akili-text-primary)", fontWeight: 600, marginBottom: 3 }}>
                        Drawing region…
                    </div>
                    <div style={{ fontSize: 9, color: "var(--akili-text-secondary)", lineHeight: 1.5 }}>
                        {vertCount} {vertCount === 1 ? "vertex" : "vertices"}
                        {vertCount >= 3 ? " · hover start point to close" : " · click to add vertices"}
                    </div>
                    <button onClick={onCancelDraw} style={{
                        ...S.btn, marginTop: 7, fontSize: 9,
                        color: "rgba(200,70,70,0.75)", textDecoration: "underline",
                        textDecorationColor: "rgba(200,70,70,0.3)",
                    }}>Cancel</button>
                </div>
            ) : (
                <PanelBtn onClick={onStartMLDraw} wide
                    disabled={mode === "analyzing" || isDrawingSentinel}>
                    {mode === "analyzing" ? "Analyzing…" : "Draw Region & Analyze"}
                </PanelBtn>
            )}

            {/* AI Classification toggle */}
            <SlimToggle
                on={enhance}
                onToggle={onEnhanceToggle}
                label="AI Classification"
                hint={enhance ? "Claude vision — slower, more specific" : "Enable Claude vision labelling"}
            />

            {/* Results */}
            {mode === "results" && stats && (
                <>
                    <div style={{ paddingTop: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 22, fontWeight: 700, color: "var(--akili-text-primary)", lineHeight: 1 }}>
                            {stats.total ?? 0}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--akili-text-muted)", marginLeft: 7 }}>
                            {(stats.total ?? 0) === 1 ? "object" : "objects"} detected
                        </span>
                        {stats.zoom && (
                            <div style={{ fontSize: 9, color: "var(--akili-text-muted)", marginTop: 2 }}>
                                {stats.zoom === "Sentinel-2" ? "Sentinel-2" : `zoom ${stats.zoom}`}
                                {enhanced && <span style={{ marginLeft: 5 }}>· AI</span>}
                            </div>
                        )}
                    </div>

                    {/* Category filter chips */}
                    {allCats.length > 0 && (
                        <>
                            <SectionHead label="Filter by Category"
                                action={props.selectedCats?.size > 0 ? "Clear" : null}
                                onAction={props.onClearCatFilter}
                            />
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 5px", marginBottom: 8 }}>
                                {allCats.map(cat => {
                                    const active = !props.selectedCats?.size || props.selectedCats.has(cat)
                                    const color  = colorForCat(cat)
                                    return (
                                        <button key={cat} onClick={() => props.onToggleCat?.(cat)} style={{
                                            ...S.btn,
                                            fontSize: 9, padding: "3px 8px", borderRadius: 10, fontWeight: 600,
                                            background: active ? `${color}1a` : "rgba(255,255,255,0.03)",
                                            border: `1px solid ${active ? `${color}55` : "var(--akili-border)"}`,
                                            color: active ? color : "var(--akili-text-muted)",
                                            transition: "all 0.1s",
                                        }}>
                                            {cat} <span style={{ opacity: 0.65, fontWeight: 400 }}>{catCounts[cat]}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </>
                    )}

                    {/* Confidence */}
                    <SectionHead label="Confidence" />
                    <div style={{ marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 3 }}>
                            <span style={{ color: "var(--akili-text-muted)" }}>Min confidence</span>
                            <span style={{ color: "var(--akili-text-secondary)", fontWeight: 600 }}>{Math.round(minConf * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={0.9} step={0.05} value={minConf}
                            onChange={e => onMinConfChange(parseFloat(e.target.value))}
                            style={{ width: "100%", accentColor: "var(--akili-accent)", cursor: "pointer" }}
                        />
                        <div style={{ fontSize: 9, color: "var(--akili-text-muted)", marginTop: 2 }}>
                            {visible.length} of {detections.length} shown
                        </div>
                    </div>

                    {/* Detection list (collapsible) */}
                    {detections.length > 0 && (
                        <>
                            <button onClick={() => setShowDetList(v => !v)} style={{
                                ...S.btn, width: "100%", display: "flex", alignItems: "center",
                                justifyContent: "space-between",
                                padding: "6px 10px", borderRadius: 6, marginBottom: 4,
                                background: "rgba(255,255,255,0.02)",
                                border: "1px solid var(--akili-border)",
                                color: "var(--akili-text-muted)", fontSize: 9,
                            }}>
                                <span style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>
                                    Detections ({visible.length})
                                </span>
                                <span>{showDetList ? "▲" : "▼"}</span>
                            </button>
                            {showDetList && (
                                <div style={{
                                    maxHeight: 200, overflowY: "auto",
                                    borderRadius: 6,
                                    border: "1px solid var(--akili-border)",
                                    marginBottom: 6,
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
                                                borderBottom: i < visible.length - 1 ? "1px solid var(--akili-border)" : "none",
                                            }}>
                                                <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 10, color: "var(--akili-text-primary)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                        {label}
                                                    </div>
                                                    <div style={{ fontSize: 8, color: "var(--akili-text-muted)" }}>
                                                        {cat}{det.subcategory ? ` · ${det.subcategory}` : ""}
                                                    </div>
                                                </div>
                                                <span style={{ fontSize: 9, color, flexShrink: 0, fontWeight: 600 }}>
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
                    <PanelBtn onClick={onAnalyze} wide disabled={analyzing || !detections.length}>
                        {analyzing ? "Running assessment…" : "Assess Area"}
                    </PanelBtn>
                    {analysis && (
                        <div style={{
                            marginTop: 6, padding: "10px 12px",
                            background: "rgba(255,255,255,0.02)",
                            border: "1px solid var(--akili-border)",
                            borderRadius: 6,
                        }}>
                            <div style={{ fontSize: 8, fontWeight: 700, color: "var(--akili-text-muted)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
                                Assessment
                            </div>
                            {analysis.summary && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 4px", marginBottom: 7 }}>
                                    {Object.entries(analysis.summary).sort(([,a],[,b]) => b - a).map(([cls, n]) => (
                                        <span key={cls} style={{
                                            fontSize: 9, padding: "2px 6px", borderRadius: 10,
                                            background: "rgba(255,255,255,0.05)",
                                            border: "1px solid var(--akili-border)",
                                            color: "var(--akili-text-secondary)",
                                        }}>{n} {cls}</span>
                                    ))}
                                </div>
                            )}
                            <div style={{ fontSize: 11, lineHeight: 1.6, color: "var(--akili-text-secondary)", whiteSpace: "pre-wrap" }}>
                                {analysis.analysis}
                            </div>
                            <button onClick={onDismissAnalysis} style={{
                                ...S.btn, marginTop: 6, fontSize: 9, color: "var(--akili-text-muted)",
                            }}>Dismiss</button>
                        </div>
                    )}

                    {/* Save & Actions */}
                    <SectionHead label="Actions" />
                    <div style={{ display: "flex", gap: 5, marginBottom: 4 }}>
                        <PanelBtn onClick={onClear} danger>Clear</PanelBtn>
                        <PanelBtn onClick={onRescan}>Re-scan</PanelBtn>
                        <PanelBtn onClick={onSave} disabled={!detections.length}>Save</PanelBtn>
                    </div>
                    <PanelBtn onClick={onStartMLDraw} wide>New Region</PanelBtn>
                </>
            )}

            {/* ── Sentinel ─────────────────────────────────────────────── */}
            <Rule />
            <SentinelSection {...sentinelProps} isMobile={isMobile} />

            {/* ── Saved items ───────────────────────────────────────────── */}
            {(savedScans.length > 0 || savedImages.length > 0) && (
                <>
                    <Rule />
                    <button onClick={() => setShowSaved(v => !v)} style={{
                        ...S.btn, width: "100%", display: "flex",
                        justifyContent: "space-between", padding: "5px 0",
                        fontSize: 9, color: "var(--akili-text-muted)",
                        textTransform: "uppercase", letterSpacing: "0.12em",
                    }}>
                        <span>Saved ({savedScans.length + savedImages.length})</span>
                        <span>{showSaved ? "▲" : "▼"}</span>
                    </button>
                    {showSaved && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                            {savedScans.map(scan => (
                                <div key={scan.id} style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "6px 10px", borderRadius: 6,
                                    background: "rgba(255,255,255,0.02)",
                                    border: "1px solid var(--akili-border)",
                                }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 10, color: "var(--akili-text-primary)", fontWeight: 600 }}>
                                            {scan.stats?.total ?? 0} objects
                                        </div>
                                        <div style={{ fontSize: 8, color: "var(--akili-text-muted)", marginTop: 1 }}>
                                            {fmtDate(scan.timestamp)}
                                        </div>
                                    </div>
                                    <button onClick={() => onRestoreSaved(scan)} style={{
                                        ...S.btn, fontSize: 9, padding: "3px 8px", borderRadius: 4,
                                        background: "rgba(255,255,255,0.05)",
                                        border: "1px solid var(--akili-border)",
                                        color: "var(--akili-text-secondary)",
                                    }}>Load</button>
                                    <button onClick={() => onDeleteSaved(scan.id)} style={{
                                        ...S.btn, fontSize: 12, padding: "2px 6px", borderRadius: 4,
                                        background: "rgba(200,60,60,0.07)",
                                        border: "1px solid rgba(200,60,60,0.2)",
                                        color: "rgba(200,60,60,0.65)",
                                    }}>✕</button>
                                </div>
                            ))}
                            {savedImages.map(img => (
                                <div key={img.id} style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "6px 10px", borderRadius: 6,
                                    background: "rgba(255,255,255,0.02)",
                                    border: "1px solid var(--akili-border)",
                                }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 10, color: "var(--akili-text-secondary)", fontWeight: 600 }}>
                                            Sentinel-2
                                        </div>
                                        <div style={{ fontSize: 8, color: "var(--akili-text-muted)", marginTop: 1 }}>
                                            {fmtDate(img.capturedAt || img.timestamp)}
                                            {!img.src && " · image not stored"}
                                        </div>
                                    </div>
                                    <button onClick={() => onDeleteSavedImage(img.id)} style={{
                                        ...S.btn, fontSize: 12, padding: "2px 6px", borderRadius: 4,
                                        background: "rgba(200,60,60,0.07)",
                                        border: "1px solid rgba(200,60,60,0.2)",
                                        color: "rgba(200,60,60,0.65)",
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

// ── Panel header (shared) ─────────────────────────────────────────────────────
function PanelHeader({ onClose, stats, mode }) {
    return (
        <div style={{
            flexShrink: 0, display: "flex", alignItems: "center",
            justifyContent: "space-between",
            padding: "0 14px", height: 42,
            borderBottom: "1px solid var(--akili-border)",
            background: "var(--akili-surface)",
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <IconOverwatch size={13} color="var(--akili-accent)" />
                <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.14em",
                    textTransform: "uppercase", color: "var(--akili-accent)",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                }}>Overwatch</span>
                {mode === "results" && stats && (
                    <span style={{ fontSize: 9, color: "var(--akili-text-muted)", marginLeft: 2 }}>
                        · {stats.total} detected
                    </span>
                )}
            </div>
            <button onClick={onClose} style={{
                ...S.btn, padding: "4px 8px",
                color: "var(--akili-text-muted)", fontSize: 18,
            }}>✕</button>
        </div>
    )
}

// ── Desktop sidebar ───────────────────────────────────────────────────────────
function DesktopSidebar({ open, onClose, mode, stats, ...rest }) {
    if (!open) return null
    return (
        <>
            <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1140 }} />
            <div style={{
                position: "fixed", top: 40, right: 0, bottom: 0, width: 340, zIndex: 1150,
                background: "var(--akili-panel-solid, #0e1420)",
                backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                borderLeft: "1px solid var(--akili-border)",
                display: "flex", flexDirection: "column",
                boxShadow: "-6px 0 30px rgba(0,0,0,0.4)",
                fontFamily: "system-ui, -apple-system, sans-serif",
                color: "var(--akili-text-primary)",
            }}>
                <PanelHeader onClose={onClose} stats={stats} mode={mode} />
                <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                    <SidebarContent {...rest} mode={mode} stats={stats} isMobile={false} />
                </div>
            </div>
        </>
    )
}

// ── Mobile bottom panel ───────────────────────────────────────────────────────
function MobileSidebar({ open, onClose, mode, stats, ...rest }) {
    const [collapsed, setCollapsed] = useState(false)
    if (!open) return null
    return (
        <>
            {!collapsed && (
                <div onClick={onClose} style={{
                    position: "fixed", inset: 0, zIndex: 1450,
                    background: "rgba(0,0,0,0.35)",
                }} />
            )}
            <div style={{
                position: "fixed", left: 0, right: 0, bottom: 56, zIndex: 1451,
                maxHeight: collapsed ? 48 : "72vh",
                background: "var(--akili-panel-solid, #0e1420)",
                backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                borderRadius: "12px 12px 0 0",
                borderTop: "1px solid var(--akili-border)",
                display: "flex", flexDirection: "column",
                transition: "max-height 0.3s cubic-bezier(0.32,0.72,0,1)",
                overflow: "hidden",
                boxShadow: "0 -4px 24px rgba(0,0,0,0.45)",
                fontFamily: "system-ui, -apple-system, sans-serif",
                color: "var(--akili-text-primary)",
            }}>
                <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 7, cursor: "pointer" }}
                    onClick={() => setCollapsed(v => !v)}>
                    <div style={{ width: 30, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.18)", marginBottom: 7 }} />
                    <div style={{
                        width: "100%", display: "flex", alignItems: "center",
                        justifyContent: "space-between", padding: "0 14px 7px",
                        borderBottom: "1px solid var(--akili-border)",
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <IconOverwatch size={13} color="var(--akili-accent)" />
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--akili-accent)" }}>
                                Overwatch
                            </span>
                            {mode === "results" && stats && (
                                <span style={{ fontSize: 9, color: "var(--akili-text-muted)", marginLeft: 2 }}>· {stats.total}</span>
                            )}
                        </div>
                        <button onClick={e => { e.stopPropagation(); onClose() }} style={{
                            ...S.btn, color: "var(--akili-text-muted)", fontSize: 18, padding: "4px 8px",
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
