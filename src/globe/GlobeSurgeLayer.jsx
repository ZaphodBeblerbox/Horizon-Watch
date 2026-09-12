import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { Entity } from "resium"
import { useCesium } from "resium"
import {
    Cartesian3, Color,
    NearFarScalar, DistanceDisplayCondition,
    SceneTransforms,
} from "cesium"
import API_BASE from "../apiBase.js"
import { getEntityMarkerDataUri } from "./entityIcons.js"
import { isSignalVisible, ageHoursSince, rankForRawSeverity } from "../lib/signalVisibility.js"

// ── Article-type → human explanation ──────────────────────────────────────────

const SURGE_EXPLANATIONS = {
    conflict:       "Sudden spike in reporting about escalating political or military tensions in this region.",
    maritime:       "Multiple reports of disruption to port operations, shipping delays, or maritime access issues.",
    aviation:       "Elevated reporting about aviation incidents, airspace restrictions, or military air activity.",
    infrastructure: "Elevated reporting about threats to critical infrastructure — cables, pipelines, or power systems.",
    energy:         "Elevated coverage of threats to energy supply, oil/gas disruption, or pipeline incidents.",
    cyber:          "Surge in reporting about cyber attacks, digital espionage, or infrastructure intrusions.",
    disaster:       "Sharp increase in humanitarian or disaster reporting — displacement, casualties, or environmental incidents.",
    political:      "Sudden rise in coverage of political instability, government crisis, or leadership events.",
    economic:       "Surge in reporting about sanctions, trade restrictions, currency crises, or economic pressure.",
    default:        "Unusual spike in news coverage about this region across multiple sources.",
}

const SEV_COLOR = { critical: "#FF3B30", high: "#FF9500", medium: "#FFCC00", low: "#34C759" }

// News surges are a "news_event" entity like GlobeEventsLayer's markers —
// severity carried as the glyph color, same as before.
function makeSurgeIcon(severity) {
    const hex = SEV_COLOR[severity] || "#FF9500"
    return getEntityMarkerDataUri({ entityType: "news_event", color: hex, size: 40 })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts) {
    if (!ts) return ""
    try {
        const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
        if (m < 1)    return "just now"
        if (m < 60)   return `${m}m ago`
        if (m < 1440) return `${Math.floor(m / 60)}h ago`
        return `${Math.floor(m / 1440)}d ago`
    } catch { return "" }
}

function clampPos(x, y) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w  = Math.min(300, vw - 16)
    return {
        x: Math.min(Math.max(x, 8), vw - w - 8),
        y: Math.min(Math.max(y, 8), vh - 440),
    }
}

function hexToRgb(hex) {
    const h = (hex || "#888").replace("#", "")
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16)
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function SurgePopup({ surge, x, y, visible, onClose }) {
    if (!surge) return null

    const explanation = SURGE_EXPLANATIONS[surge.article_type?.toLowerCase()] || SURGE_EXPLANATIONS.default
    const sevCol  = SEV_COLOR[surge.severity] || "#FF9500"
    const sevRgb  = hexToRgb(sevCol)
    const evidence = Array.isArray(surge.evidence_items) ? surge.evidence_items.slice(0, 3) : []
    const confPct  = surge.confidence != null ? Math.round(surge.confidence * 100) : null
    const w        = Math.min(300, window.innerWidth - 16)

    return createPortal(
        <div
            style={{
                position:       "fixed",
                left:           x,
                top:            y,
                width:          w,
                background:     "rgba(10,18,35,0.95)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border:         "1px solid rgba(255,255,255,0.08)",
                borderRadius:   12,
                overflow:       "hidden",
                zIndex:         9200,
                boxShadow:      "0 8px 32px rgba(0,0,0,0.6)",
                fontFamily:     "Inter, system-ui, sans-serif",
                opacity:        visible ? 1 : 0,
                pointerEvents:  visible ? "auto" : "none",
                transition:     "left 0.05s, top 0.05s, opacity 0.18s",
            }}
            onClick={e => e.stopPropagation()}
        >
            {/* Header */}
            <div style={{
                background:   `rgba(${sevRgb},0.12)`,
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                padding:      "10px 12px 8px",
                display:      "flex", alignItems: "flex-start", gap: 8,
            }}>
                <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>📈</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: sevCol, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        News Surge
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginTop: 2, lineHeight: 1.3 }}>
                        {surge.location_name || surge.location_country || "Unknown location"}
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <span style={{
                        padding: "2px 7px", borderRadius: 4,
                        fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                        background: `rgba(${sevRgb},0.18)`,
                        border: `1px solid rgba(${sevRgb},0.35)`,
                        color: sevCol,
                    }}>
                        {surge.severity}
                    </span>
                    <button onClick={onClose} style={{
                        background: "none", border: "none", color: "rgba(255,255,255,0.4)",
                        cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0,
                    }}>×</button>
                </div>
            </div>

            <div style={{ padding: "10px 12px" }}>
                {/* Type pills */}
                <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                    {surge.article_type && (
                        <span style={{
                            padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                            background: "rgba(255,149,0,0.15)", color: "#FF9500",
                            border: "1px solid rgba(255,149,0,0.25)",
                        }}>
                            {surge.article_type.toUpperCase()}
                        </span>
                    )}
                    {surge.surge_type && (
                        <span style={{
                            padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                            background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.45)",
                            border: "1px solid rgba(255,255,255,0.12)",
                        }}>
                            {surge.surge_type.replace(/_/g, " ")}
                        </span>
                    )}
                </div>

                {/* Explanation */}
                <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 4 }}>
                        What this means
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>
                        {explanation}
                        {surge.article_count != null && surge.time_window_description && (
                            <> {surge.article_count} articles in the {surge.time_window_description}{
                                surge.multiplier != null ? `, ${surge.multiplier.toFixed(1)}× above baseline activity.` : "."
                            }</>
                        )}
                    </div>
                </div>

                {/* Context summary (Haiku-generated) */}
                {surge.context_summary && (
                    <div style={{ marginBottom: 10, padding: "7px 9px", background: "rgba(255,255,255,0.04)", borderRadius: 5, borderLeft: `2px solid rgba(${sevRgb},0.5)` }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 3 }}>
                            Context
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", lineHeight: 1.5 }}>
                            {surge.context_summary}
                        </div>
                    </div>
                )}

                {/* Why it matters */}
                {surge.why_it_matters && (
                    <div style={{ marginBottom: 10, padding: "7px 9px", background: `rgba(${sevRgb},0.06)`, borderRadius: 5, borderLeft: `2px solid rgba(${sevRgb},0.3)` }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 3 }}>
                            Why it matters
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
                            {surge.why_it_matters}
                        </div>
                    </div>
                )}

                {/* Evidence */}
                {evidence.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 6 }}>
                            Top sources
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {evidence.map((ev, i) => {
                                const title = ev.title || ev.headline || ""
                                const inner = (
                                    <>
                                        {ev.source && <span style={{ color: "rgba(255,255,255,0.4)", marginRight: 4 }}>{ev.source} —</span>}
                                        <span>{title}</span>
                                    </>
                                )
                                return (
                                    <div key={i} style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.3, paddingLeft: 10, position: "relative" }}>
                                        <span style={{ position: "absolute", left: 0, color: sevCol }}>•</span>
                                        {ev.url
                                            ? <a href={ev.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }} onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"} onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}>{inner}</a>
                                            : inner
                                        }
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Confidence bar */}
                {confPct != null && (
                    <div style={{ marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 3 }}>
                            <span>Confidence</span>
                            <span style={{ fontWeight: 600, color: confPct >= 80 ? "#34C759" : confPct >= 50 ? "#FF9500" : "#FF3B30" }}>
                                {confPct}%
                            </span>
                        </div>
                        <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{
                                height: "100%",
                                width: `${confPct}%`,
                                background: confPct >= 80 ? "#34C759" : confPct >= 50 ? "#FF9500" : "#FF3B30",
                                borderRadius: 2,
                                transition: "width 0.4s ease",
                            }} />
                        </div>
                    </div>
                )}

                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                    Detected {timeAgo(surge.created_at)}
                </div>
            </div>
        </div>,
        document.body,
    )
}

// ── Main layer ────────────────────────────────────────────────────────────────

export default function GlobeSurgeLayer({ enabled, windowHours = null, maxRank = null }) {
    const { viewer }                = useCesium()
    const [rawSurges, setRawSurges] = useState([])
    // Real root-cause fix: filtered here (derived, not re-fetched) so
    // changing the Time window/severity floor re-filters instantly rather
    // than waiting for the next 120s poll — the same real
    // signalVisibility.js decision Situation.jsx's own header/legend/
    // histogram counts use.
    const surges = useMemo(() => {
        if (windowHours == null && maxRank == null) return rawSurges
        const nowMs = Date.now()
        return rawSurges.filter((s) => isSignalVisible(
            { ageHours: ageHoursSince(s.created_at, nowMs), severityRank: rankForRawSeverity(s.severity) },
            { windowHours, maxRank },
        ))
    }, [rawSurges, windowHours, maxRank])
    const [selSurge, setSel]  = useState(null)
    const [popupPos, setPos]  = useState({ x: 0, y: 0 })
    const [popupVis, setVis]  = useState(false)
    const posRef              = useRef(null)

    useEffect(() => {
        if (!enabled) { setRawSurges([]); setSel(null); setVis(false); return }
        let cancelled = false
        const load = () =>
            fetch(`${API_BASE}/api/surge/events?status=active&limit=50`)
                .then(r => r.ok ? r.json() : [])
                .then(d => {
                    if (!cancelled)
                        setRawSurges(Array.isArray(d) ? d.filter(s => s.lat != null && s.lon != null) : [])
                })
                .catch(() => {})
        load()
        const iv = setInterval(load, 120_000)
        return () => { cancelled = true; clearInterval(iv) }
    }, [enabled])

    // Keep popup anchored to entity world position as camera moves
    useEffect(() => {
        if (!viewer || !selSurge) return
        const scene = viewer.scene
        const update = () => {
            const c = posRef.current
            if (!c) return
            const sp = SceneTransforms.worldToWindowCoordinates(scene, c)
            const vw = window.innerWidth, vh = window.innerHeight
            if (sp && sp.x > 0 && sp.x < vw && sp.y > 0 && sp.y < vh) {
                setPos(clampPos(sp.x + 18, sp.y - 140))
                setVis(true)
            } else {
                setVis(false)
            }
        }
        const remove = scene.postRender.addEventListener(update)
        return () => { remove() }
    }, [viewer, selSurge])

    const handleClick = useCallback((surge, clickX, clickY) => {
        if (selSurge?.surge_id === surge.surge_id) {
            setSel(null); posRef.current = null; setVis(false)
            return
        }
        posRef.current = Cartesian3.fromDegrees(surge.lon, surge.lat, 0)
        setSel(surge)
        setPos(clampPos(clickX + 18, clickY - 140))
        setVis(true)
    }, [selSurge])

    const handleClose = useCallback(() => {
        setSel(null); posRef.current = null; setVis(false)
    }, [])

    // Deep-link entry point: a report claim citing this surge event. The
    // camera fly-to itself is dispatched by src/services/reportDeepLink.js
    // (a surge_events snapshot item already carries real lat/lon) — this
    // just opens the same real popup a click would, if the surge is still
    // active. Silent no-op if it's aged out since the report's snapshot.
    useEffect(() => {
        const handler = (e) => {
            const surgeId = e.detail?.surge_id
            if (!surgeId) return
            const surge = surges.find(s => String(s.surge_id) === String(surgeId))
            if (!surge) return
            handleClick(surge, window.innerWidth / 2, window.innerHeight / 2)
        }
        window.addEventListener("akili:show-surge", handler)
        return () => window.removeEventListener("akili:show-surge", handler)
    }, [surges, handleClick])

    if (!enabled) return null

    return (
        <>
            {surges.map(surge => {
                const isSel = selSurge?.surge_id === surge.surge_id
                const icon  = makeSurgeIcon(surge.severity || "medium")
                return (
                    <Entity
                        key={surge.surge_id}
                        id={`surge-${surge.surge_id}`}
                        position={Cartesian3.fromDegrees(surge.lon, surge.lat, 0)}
                        billboard={{
                            image:           icon,
                            width:           isSel ? 62 : 52,
                            height:          isSel ? 62 : 52,
                            color:           Color.WHITE.withAlpha(isSel ? 1.0 : 0.88),
                            scaleByDistance: new NearFarScalar(50_000, 1.2, 8_000_000, 0.3),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            eyeOffset: new Cartesian3(0, 0, -40),
                        }}
                        onClick={mv => handleClick(
                            surge,
                            mv?.position?.x ?? window.innerWidth / 2,
                            mv?.position?.y ?? window.innerHeight / 2,
                        )}
                    />
                )
            })}

            <SurgePopup
                surge={selSurge}
                x={popupPos.x}
                y={popupPos.y}
                visible={popupVis}
                onClose={handleClose}
            />
        </>
    )
}
