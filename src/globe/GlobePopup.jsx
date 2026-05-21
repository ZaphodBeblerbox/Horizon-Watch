import { useState, useEffect, useRef } from "react"
import {
    ScreenSpaceEventHandler, ScreenSpaceEventType,
    defined, SceneTransforms,
    Cartographic, Math as CesiumMath, Cartesian2,
} from "cesium"
import { getEntity } from "./entityStore.js"
import GlobeAircraftPopup from "./GlobeAircraftPopup.jsx"
import GlobeVesselPopup   from "./GlobeVesselPopup.jsx"
import GlobeEventPopup    from "./GlobeEventPopup.jsx"
import GlobeEEZPopup      from "./GlobeEEZPopup.jsx"
import GlobeCablePopup    from "./GlobeCablePopup.jsx"
import GlobeInfraPopup    from "./GlobeInfraPopup.jsx"
import GlobeHeatmapPopup  from "./GlobeHeatmapPopup.jsx"
import GlobeAlertPopup      from "./GlobeAlertPopup.jsx"
import GlobeAssessmentPopup from "./GlobeAssessmentPopup.jsx"
import GlobeFusionPopup     from "./GlobeFusionPopup.jsx"
import GlobeAirportPopup  from "./GlobeAirportPopup.jsx"
import GlobePortPopup     from "./GlobePortPopup.jsx"
import API_BASE           from "../apiBase.js"

// ── Inline threat-region popup ────────────────────────────────────────────────
const THREAT_COLORS = { critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#22c55e" }
function ThreatRegionPopup({ data, onClose }) {
    const [explain,   setExplain]   = useState(null)
    const [expLoad,   setExpLoad]   = useState(false)
    const lvl   = (data.threat_level || "low").toLowerCase()
    const col   = THREAT_COLORS[lvl] || "#64748b"
    const score = Math.round(data.threat_score ?? 0)
    const trend = data.trend || ""
    const trendArrow = trend === "escalating" ? "▲" : trend === "de-escalating" ? "▼" : "→"
    const trendCol   = trend === "escalating" ? "#ef4444" : trend === "de-escalating" ? "#22c55e" : "#94a3b8"

    const loadExplain = () => {
        if (explain || expLoad) return
        setExpLoad(true)
        fetch(`${API_BASE}/api/analytics/threat-matrix/${encodeURIComponent(data.region_name)}/explain`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { setExplain(d); setExpLoad(false) })
            .catch(() => setExpLoad(false))
    }

    return (
        <div style={{ fontFamily: "system-ui, sans-serif" }}>
            {/* Header */}
            <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                    <div style={{ display: "inline-block", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3, marginBottom: 5, background: col + "22", color: col, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {lvl}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{data.region_name}</div>
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16, padding: 0 }}>✕</button>
            </div>
            {/* Body */}
            <div style={{ padding: "10px 12px" }}>
                {/* Score bar */}
                <div style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>
                        <span>Threat Score</span>
                        <span style={{ color: col, fontWeight: 700 }}>{score} / 100</span>
                    </div>
                    <div style={{ height: 5, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${score}%`, background: `linear-gradient(90deg, #1d4ed8, ${col})`, borderRadius: 3, transition: "width 0.5s ease" }} />
                    </div>
                </div>
                {/* Trend + counts */}
                <div style={{ display: "flex", gap: 10, marginBottom: 10, fontSize: 10, color: "#94a3b8" }}>
                    <span style={{ color: trendCol }}>{trendArrow} {trend || "stable"}</span>
                    {data.alert_count > 0 && <span>{data.alert_count} alert{data.alert_count !== 1 ? "s" : ""}</span>}
                    {data.fusion_count > 0 && <span style={{ color: "#a78bfa" }}>{data.fusion_count} fusion</span>}
                </div>
                {/* Signals */}
                {(data.signals || []).length > 0 && (
                    <div style={{ fontSize: 9, color: "#475569", marginBottom: 10 }}>
                        {data.signals.slice(0, 4).join(" · ")}
                    </div>
                )}
                {/* Explain section */}
                {!explain && (
                    <button onClick={loadExplain} disabled={expLoad} style={{
                        width: "100%", padding: "5px 0", borderRadius: 5,
                        background: "rgba(56,139,255,0.12)", border: "1px solid rgba(56,139,255,0.25)",
                        color: "#60a5fa", fontSize: 10, cursor: expLoad ? "default" : "pointer",
                        fontFamily: "inherit",
                    }}>
                        {expLoad ? "Loading…" : "View details →"}
                    </button>
                )}
                {explain && (
                    <div style={{ marginTop: 8, fontSize: 10, color: "rgba(203,213,225,0.8)", lineHeight: 1.5, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                        {explain.narrative || `${data.region_name} threat analysis`}
                    </div>
                )}
            </div>
        </div>
    )
}

const HOVER_TYPES = new Set(["eez", "cable"])

function buildOverpassQuery(lat, lon, radius) {
    return `[out:json][timeout:8];(way["power"](around:${radius},${lat},${lon});way["man_made"="pipeline"](around:${radius},${lat},${lon});node["power"~"substation|transformer"](around:${radius},${lat},${lon});way["telecom"](around:${radius},${lat},${lon}););out body 5;`
}

export default function GlobePopup({ viewerRef, infraEnabled = false }) {
    const [popup,   setPopup]   = useState(null)
    const [tooltip, setTooltip] = useState(null)  // { name, x, y }
    const handlerRef = useRef(null)

    useEffect(() => {
        let attempts = 0
        function tryMount() {
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer) {
                if (attempts++ < 15) setTimeout(tryMount, 200)
                return
            }

            const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)

            // ── Hover tooltip ────────────────────────────────────────────────
            handler.setInputAction((move) => {
                const picked = viewer.scene.pick(move.endPosition)
                if (defined(picked) && picked.id) {
                    const stored = getEntity(picked.id.id)
                    if (stored && HOVER_TYPES.has(stored.type)) {
                        setTooltip({
                            name: stored.data.name || stored.data.eez1 || "",
                            x:    move.endPosition.x,
                            y:    move.endPosition.y,
                        })
                        return
                    }
                }
                setTooltip(null)
            }, ScreenSpaceEventType.MOUSE_MOVE)

            // ── Click popup ──────────────────────────────────────────────────
            handler.setInputAction(async (click) => {
                setTooltip(null)

                // Primary pick; if it misses, search a ring of nearby pixels
                // to handle fat-finger taps on mobile 3D models.
                let picked = viewer.scene.pick(click.position)
                if (!defined(picked) || !picked.id) {
                    const ring = [
                        [-14, 0], [14, 0], [0, -14], [0, 14],
                        [-10, -10], [10, -10], [-10, 10], [10, 10],
                        [-14, -7], [14, -7], [-14, 7], [14, 7],
                    ]
                    for (const [dx, dy] of ring) {
                        const p = new Cartesian2(click.position.x + dx, click.position.y + dy)
                        const c = viewer.scene.pick(p)
                        if (defined(c) && c.id) { picked = c; break }
                    }
                }

                if (defined(picked) && picked.id) {
                    const entity   = picked.id
                    const entityId = entity.id
                    const pos = entity.position?.getValue(viewer.clock.currentTime)
                    const sp  = pos ? SceneTransforms.worldToWindowCoordinates(viewer.scene, pos) : null
                    const x   = sp ? sp.x : click.position.x
                    const y   = sp ? sp.y : click.position.y

                    const stored = getEntity(entityId)
                    if (stored) {
                        setPopup({ type: stored.type, data: stored.data, x, y, entityId })
                        return
                    }

                    const rawDesc = entity.description
                    if (rawDesc) {
                        const html = typeof rawDesc.getValue === "function"
                            ? rawDesc.getValue(viewer.clock.currentTime)
                            : rawDesc
                        if (html) {
                            setPopup({ type: "html", html, x, y, entityId })
                            return
                        }
                    }
                    setPopup(null)
                    return
                }

                // No entity picked — infra click query if layer is active
                if (!infraEnabled) { setPopup(null); return }

                const cartesian = viewer.camera.pickEllipsoid(click.position)
                if (!cartesian) { setPopup(null); return }

                const carto = Cartographic.fromCartesian(cartesian)
                const lat   = CesiumMath.toDegrees(carto.latitude)
                const lon   = CesiumMath.toDegrees(carto.longitude)
                const x     = click.position.x
                const y     = click.position.y

                setPopup({ type: "infra", data: { loading: true }, x, y, entityId: null })

                try {
                    let q = buildOverpassQuery(lat, lon, 150)
                    let r = await fetch(`${API_BASE}/api/overpass?data=${encodeURIComponent(q)}`)
                    let d = r.ok ? await r.json() : null

                    if (!d?.elements?.length) {
                        q = buildOverpassQuery(lat, lon, 500)
                        r = await fetch(`${API_BASE}/api/overpass?data=${encodeURIComponent(q)}`)
                        d = r.ok ? await r.json() : null
                    }

                    if (d?.elements?.length) {
                        setPopup(p => p ? { ...p, data: { elements: d.elements } } : null)
                    } else {
                        setPopup(p => p ? { ...p, data: { elements: [] } } : null)
                    }
                } catch {
                    setPopup(null)
                }
            }, ScreenSpaceEventType.LEFT_CLICK)

            handlerRef.current = handler
        }
        tryMount()
        return () => { handlerRef.current?.destroy(); handlerRef.current = null }
    }, [viewerRef, infraEnabled])

    // Keep click popup anchored on entity position as camera moves
    useEffect(() => {
        if (!popup?.entityId) return
        const viewer = viewerRef.current?.cesiumElement
        if (!viewer) return
        const entity = viewer.entities.getById(popup.entityId)
        if (!entity) return

        const update = () => {
            const pos = entity.position?.getValue(viewer.clock.currentTime)
            if (pos) {
                const sp = SceneTransforms.worldToWindowCoordinates(viewer.scene, pos)
                if (sp) setPopup(p => p ? { ...p, x: sp.x, y: sp.y } : null)
            }
        }
        viewer.scene.postRender.addEventListener(update)
        return () => viewer.scene.postRender.removeEventListener(update)
    }, [popup?.entityId, viewerRef])

    const isMob = window.innerWidth < 768
    const W     = isMob ? 260 : 300
    const handleClose = () => setPopup(null)
    const handleFollow = () => {
        const viewer = viewerRef.current?.cesiumElement
        if (!viewer) return
        const entity = viewer.entities.getById(popup.entityId)
        if (entity) viewer.trackedEntity = entity
        setPopup(null)
    }

    return (
        <>
            {/* Hover tooltip */}
            {tooltip && (
                <div
                    style={{
                        position:      "absolute",
                        left:          Math.min(tooltip.x + 14, (window.innerWidth || 1200) - 220),
                        top:           Math.max(Math.min(tooltip.y - 36, (window.innerHeight || 800) - 60 - (isMob ? 56 : 16)), 56),
                        zIndex:        10001,
                        background:    "rgba(10,14,20,0.92)",
                        border:        "1px solid rgba(255,255,255,0.12)",
                        borderRadius:  5,
                        padding:       "5px 10px",
                        fontSize:      11,
                        color:         "#E2E8F0",
                        pointerEvents: "none",
                        whiteSpace:    "nowrap",
                        maxWidth:      200,
                        overflow:      "hidden",
                        textOverflow:  "ellipsis",
                        boxShadow:     "0 2px 8px rgba(0,0,0,0.5)",
                    }}
                >
                    {tooltip.name}
                </div>
            )}

            {/* Click popup */}
            {popup && (
                <div
                    style={{
                        position:      "absolute",
                        left:          Math.min(popup.x + 14, (window.innerWidth || 1200) - W - 10),
                        top:           Math.max(Math.min(popup.y - 80, (window.innerHeight || 800) - 320 - (isMob ? 56 : 16)), 56),
                        zIndex:        10000,
                        width:         W,
                        maxHeight:     520,
                        overflowY:     "auto",
                        background:    "#0F1721",
                        border:        "1px solid #2C3645",
                        borderRadius:  8,
                        boxShadow:     "0 8px 32px rgba(0,0,0,0.7)",
                        pointerEvents: "auto",
                    }}
                >
                    {popup.type === "aircraft" ? (
                        <GlobeAircraftPopup data={popup.data} onClose={handleClose} onFollow={handleFollow} />
                    ) : popup.type === "vessel" ? (
                        <GlobeVesselPopup data={popup.data} onClose={handleClose} onFollow={handleFollow} />
                    ) : popup.type === "event" ? (
                        <GlobeEventPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "eez" ? (
                        <GlobeEEZPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "cable" ? (
                        <GlobeCablePopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "infra" ? (
                        <GlobeInfraPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "heatmap_cell" ? (
                        <GlobeHeatmapPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "alert" ? (
                        <GlobeAlertPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "assessment" ? (
                        <GlobeAssessmentPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "fusion" ? (
                        <GlobeFusionPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "airport" ? (
                        <GlobeAirportPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "threat_region" ? (
                        <ThreatRegionPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "port" ? (
                        <GlobePortPopup data={popup.data} onClose={handleClose} />
                    ) : (
                        <>
                            <button
                                onClick={handleClose}
                                style={{
                                    position:   "absolute",
                                    top:        6,
                                    right:      8,
                                    background: "transparent",
                                    border:     "none",
                                    color:      "#9AA4B5",
                                    cursor:     "pointer",
                                    fontSize:   18,
                                    lineHeight: 1,
                                    zIndex:     1,
                                    padding:    0,
                                }}
                            >×</button>
                            {/* eslint-disable-next-line react/no-danger */}
                            <div dangerouslySetInnerHTML={{ __html: popup.html }} />
                        </>
                    )}
                </div>
            )}
        </>
    )
}
