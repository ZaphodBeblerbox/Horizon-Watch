import { useState, useEffect, useRef } from "react"
import {
    ScreenSpaceEventHandler, ScreenSpaceEventType,
    defined, SceneTransforms, Cartesian3,
    Cartographic, Math as CesiumMath, Cartesian2,
} from "cesium"
import { getEntity } from "./entityStore.js"
import InspectorPanel from "../components/InspectorPanel.jsx"
import { normalizeEntity } from "../inspector/adapters.js"
import API_BASE                  from "../apiBase.js"

// Entity types InspectorPanel (Round 2's unified detail panel) renders
// directly. "threat_region" keeps its own bespoke popup below — it has a
// real async "explain" fetch (region threat-matrix narrative) that isn't
// part of InspectorPanel's generic entity model, and folding it in would
// mean either losing that feature or building new inspector machinery just
// for one entity type; "html" is the raw Cesium entity-description fallback
// for entities with no registered type at all, which was never a
// bespoke *component* to begin with.
export const INSPECTOR_TYPES = new Set([
    "aircraft", "vessel", "event", "eez", "cable", "infra", "heatmap_cell",
    "alert", "assessment", "fusion", "airport", "port",
    "sentinel_detection", "chokepoint", "geoconfirmed",
])

// ── Inline threat-region popup ────────────────────────────────────────────────
const THREAT_COLORS = { critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#22c55e" }
function sigColor(sig) {
    const s = (sig || "").toLowerCase()
    if (s.includes("ais") || s.includes("vessel") || s.includes("maritime")) return "#0ea5e9"
    if (s.includes("adsb") || s.includes("aircraft") || s.includes("aviation")) return "#a78bfa"
    if (s.includes("news") || s.includes("article") || s.includes("surge")) return "#f59e0b"
    if (s.includes("sentinel") || s.includes("satellite") || s.includes("ndvi")) return "#22c55e"
    if (s.includes("fusion")) return "#8b5cf6"
    return "#64748b"
}
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
                    <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Active signals</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {data.signals.slice(0, 6).map((sig, i) => (
                                <span key={i} style={{
                                    fontSize: 9, padding: "2px 6px", borderRadius: 3,
                                    background: sigColor(sig) + "1a", color: sigColor(sig), fontWeight: 600,
                                }}>{sig}</span>
                            ))}
                        </div>
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

// UI correction pass, Part 3.1: the master spec's map hover-callout card
// (section 9) was never actually built — this hover mechanism only ever
// showed a bare name label, and only for 2 entity types (eez/cable). Now
// covers every real inspectable entity (same set INSPECTOR_TYPES already
// supports for click), showing a real callout card instead of a plain label.
const HOVER_TYPES = INSPECTOR_TYPES

function buildOverpassQuery(lat, lon, radius) {
    return `[out:json][timeout:8];(way["power"](around:${radius},${lat},${lon});way["man_made"="pipeline"](around:${radius},${lat},${lon});node["power"~"substation|transformer"](around:${radius},${lat},${lon});way["telecom"](around:${radius},${lat},${lon}););out body 5;`
}

export default function GlobePopup({
    viewerRef, infraEnabled = false, isVisible = true, onInspectorOpenChange = null,
    // Opt-in: when true, this component never self-renders the fixed-
    // docked InspectorPanel — it only reports the current inspector-
    // eligible popup (bundled with its real handlers) via
    // onInspectorPopupChange, and the caller renders InspectorPanel itself
    // inside its own real pane-glass shell (see Situation.jsx). Default
    // false keeps every existing caller (Dashboard.jsx, MapTab.jsx)
    // byte-for-byte unchanged until they're each deliberately migrated.
    dockExternally = false,
    onInspectorPopupChange = null,
}) {
    const [popup,   setPopup]   = useState(null)
    const [tooltip, setTooltip] = useState(null)  // { title, subtitle, position, x, y }
    const hoveredIdRef = useRef(null)
    const handlerRef = useRef(null)

    // Reports whether THIS GlobePopup instance's own real docked
    // InspectorPanel is currently open — InspectorPanel is mounted here
    // (fixed, right-docked, on top of everything), and a caller that
    // renders its own right-side panel in that same screen region (e.g.
    // Dashboard's Watch Queue) needs to know it's about to be covered so it
    // can get out of the way. Deliberately a scoped callback prop, not a
    // global window event: app.jsx keeps every visited destination mounted
    // (display:none, not unmounted) for fast tab switching, and each one
    // with its own embedded GlobeView has its own independent GlobePopup —
    // a global event would have every hidden instance's state bleed into
    // whichever destination is actually visible.
    const inspectorOpen = !!(popup && INSPECTOR_TYPES.has(popup.type))
    useEffect(() => {
        onInspectorOpenChange?.(inspectorOpen)
    }, [inspectorOpen, onInspectorOpenChange])

    // Real map-level connector-line trigger (Part 2 of the GeoConfirmed
    // pin-linking rebuild): whenever a real GeoConfirmed pin becomes the
    // selected popup, tell GlobeConnectorLinesLayer to draw real lines to
    // its specifically-linked entities; any other selection (a different
    // entity type, or closing the popup) clears them. Scoped to `isVisible`
    // like every other cross-instance signal in this file — GlobeView stays
    // mounted (display:none) per destination, so a hidden instance's popup
    // changes must never drive the visible instance's connector lines.
    useEffect(() => {
        if (!isVisible) return
        if (popup?.type === "geoconfirmed" && popup.entityId) {
            window.dispatchEvent(new CustomEvent("akili:geoconfirmed-selected", {
                detail: { entityId: popup.entityId, data: popup.data },
            }))
        } else {
            window.dispatchEvent(new CustomEvent("akili:geoconfirmed-selected", { detail: null }))
        }
    }, [popup, isVisible])

    // Real slide-out choreography when the docked InspectorPanel is already
    // open and a DIFFERENT entity gets clicked (vessel -> news marker, etc.)
    // — previously this just swapped content inside the same mounted
    // instance with zero animation, since React only ever played the
    // slide-in keyframe on first mount. Briefly keeps rendering the
    // outgoing entity's own panel (with the reverse animation) underneath
    // the new one while it slides in, then drops it.
    const [outgoingPopup, setOutgoingPopup] = useState(null)
    const prevInspectablePopupRef = useRef(null)
    useEffect(() => {
        const prev = prevInspectablePopupRef.current
        const prevInspectable = prev && INSPECTOR_TYPES.has(prev.type)
        const nowInspectable = popup && INSPECTOR_TYPES.has(popup.type)
        prevInspectablePopupRef.current = popup
        if (prevInspectable && nowInspectable && prev.entityId !== popup.entityId) {
            setOutgoingPopup(prev)
            const t = setTimeout(() => setOutgoingPopup(null), 150)
            return () => clearTimeout(t)
        }
    }, [popup])

    // Full UI rebuild spec section 7's exclusivity rules: "Navigating to a
    // different top-level destination... automatically closes any open
    // inspector first." GlobeView (this component's parent) stays mounted
    // via display:none rather than unmounting when the Globe destination
    // isn't active (for render-performance reasons unrelated to this fix),
    // so `popup` state would otherwise silently persist across a nav-away-
    // and-back — confirmed real gap, fixed here.
    useEffect(() => {
        if (!isVisible) { setPopup(null); setTooltip(null); hoveredIdRef.current = null }
    }, [isVisible])

    useEffect(() => {
        let attempts = 0
        function tryMount() {
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer) {
                if (attempts++ < 15) setTimeout(tryMount, 200)
                return
            }

            const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)

            // ── Hover callout card ───────────────────────────────────────────
            handler.setInputAction((move) => {
                const picked = viewer.scene.pick(move.endPosition)
                if (defined(picked) && picked.id) {
                    const stored = getEntity(picked.id.id)
                    if (stored && HOVER_TYPES.has(stored.type)) {
                        const entityId = picked.id.id
                        // Only re-run normalizeEntity when the hovered entity
                        // actually changes, not on every mousemove pixel while
                        // still hovering the same one.
                        if (hoveredIdRef.current !== entityId) {
                            hoveredIdRef.current = entityId
                            const normalized = normalizeEntity(stored.type, stored.data)
                            setTooltip({
                                title: normalized.identity.title,
                                subtitle: normalized.identity.subtitle,
                                position: (normalized.attributes || []).find(a => a.label === "Position")?.value || null,
                                x: move.endPosition.x,
                                y: move.endPosition.y,
                            })
                        } else {
                            setTooltip(prev => prev ? { ...prev, x: move.endPosition.x, y: move.endPosition.y } : prev)
                        }
                        return
                    }
                }
                hoveredIdRef.current = null
                setTooltip(null)
            }, ScreenSpaceEventType.MOUSE_MOVE)

            // ── Click popup ──────────────────────────────────────────────────
            handler.setInputAction(async (click) => {
                setTooltip(null)
                hoveredIdRef.current = null

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

    // Deep-link entry point: open the same real popup a click would, for an
    // already-known entityStore id (e.g. "fusion-FUS-1234"). Dispatched by
    // src/services/reportDeepLink.js when a report claim cites a live entity.
    // If the entity isn't currently registered (aged out of the live picture
    // since the report's snapshot was captured), this is a silent no-op —
    // the fly-to the caller already dispatched still lands the camera on the
    // real cited coordinates, it just won't have a marker to pop up.
    useEffect(() => {
        const handler = (e) => {
            const id = e.detail?.id
            if (!id) return
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer) return
            const stored = getEntity(id)
            if (!stored) return
            const entity = viewer.entities.getById(id)
            const pos = entity?.position?.getValue(viewer.clock.currentTime)
            const sp  = pos ? SceneTransforms.worldToWindowCoordinates(viewer.scene, pos) : null
            const x   = sp ? sp.x : viewer.scene.canvas.clientWidth / 2
            const y   = sp ? sp.y : viewer.scene.canvas.clientHeight / 2
            setPopup({ type: stored.type, data: stored.data, x, y, entityId: id })
        }
        window.addEventListener("akili:show-entity", handler)
        return () => window.removeEventListener("akili:show-entity", handler)
    }, [viewerRef])

    // Deep-link entry point for callers that already have a full raw entity
    // payload in hand but no entityStore registration to look it up by id
    // (e.g. NewsPage.jsx's "Open in Inspector" action on a selected story —
    // it has the real article object already, registering it in entityStore
    // just to immediately look it up again would be pure ceremony). Opens
    // the same InspectorPanel a real globe click would, using the caller's
    // own data directly.
    useEffect(() => {
        const handler = (e) => {
            const { entityType, entityId, data } = e.detail || {}
            if (!entityType) return
            setPopup({ type: entityType, data: data || {}, x: 0, y: 0, entityId: entityId || null })
        }
        window.addEventListener("akili:open-inspector", handler)
        return () => window.removeEventListener("akili:open-inspector", handler)
    }, [])

    // Keep click popup anchored on entity position as camera moves — only
    // needed for the two remaining floating (x/y-positioned) popup types.
    // InspectorPanel is a fixed docked panel and ignores popup.x/y entirely.
    useEffect(() => {
        if (!popup?.entityId) return
        if (popup.type !== "threat_region" && popup.type !== "html") return
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
    }, [popup?.entityId, popup?.type, viewerRef])

    const isMob = window.innerWidth < 768
    const W     = isMob ? 260 : 300
    const handleClose = () => setPopup(null)

    // Real position fields, wherever they live on the payload — mirrors
    // src/inspector/adapters.js's pointOf() so "Jump to globe" flies to the
    // same place InspectorPanel's attribute row shows, never a fabricated one.
    const handleJumpToLocation = (data) => {
        const viewer = viewerRef.current?.cesiumElement
        const lat = data?.lat ?? data?.latitude
        const lon = data?.lon ?? data?.lng ?? data?.longitude
        if (!viewer || lat == null || lon == null) return
        viewer.camera.flyTo({
            destination: Cartesian3.fromDegrees(Number(lon), Number(lat), 100_000),
            duration: 1.5,
        })
    }

    const handleTrackEntity = (entityId) => {
        const viewer = viewerRef.current?.cesiumElement
        if (!viewer) return
        const entity = viewer.entities.getById(entityId)
        if (entity) viewer.trackedEntity = entity
        setPopup(null)
    }

    // Related-entity navigation — fetches the real ontology profile for the
    // clicked link and opens ITS inspector, using the same real
    // /api/entities/{type}/{id}/profile endpoint InspectorPanel documents.
    // Position (x/y) is irrelevant for InspectorPanel's fixed docking; kept
    // at 0 since nothing reads it for this type.
    const handleSelectRelated = async (entityType, entityId) => {
        if (!entityType || !entityId) return
        try {
            const r = await fetch(`${API_BASE}/api/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/profile`)
            const d = r.ok ? await r.json() : null
            setPopup({ type: entityType, data: d?.entity || {}, x: 0, y: 0, entityId })
        } catch {
            setPopup({ type: entityType, data: {}, x: 0, y: 0, entityId })
        }
    }

    // Bundled inspector-eligible popup state + its real handlers, for a
    // caller that renders InspectorPanel itself (dockExternally). Reuses
    // the exact same handlers the self-rendered path below passes —
    // dockExternally changes WHERE InspectorPanel mounts, never what it's
    // given to work with.
    useEffect(() => {
        if (!dockExternally) return
        if (popup && INSPECTOR_TYPES.has(popup.type)) {
            onInspectorPopupChange?.({
                entityType: popup.type, entityId: popup.entityId, data: popup.data,
                onClose: handleClose, onSelectRelated: handleSelectRelated,
                onJumpToLocation: handleJumpToLocation, onTrackEntity: handleTrackEntity,
            })
        } else {
            onInspectorPopupChange?.(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dockExternally, popup, onInspectorPopupChange])

    return (
        <>
            {/* Map hover-callout card — full UI rebuild spec section 9, built
                for real in the UI correction pass (Part 3.1): a small
                floating plate, --bg-card-translucent, 8px radius, 1px
                --border-strong, the one permitted drop-shadow anywhere in
                the app. Only one ever visible (this component has exactly
                one `tooltip` state slot); a full click always replaces it
                with the full docked inspector (see the click handler above,
                which clears this first). */}
            {tooltip && (
                <div
                    style={{
                        position:      "absolute",
                        left:          Math.min(tooltip.x + 14, (window.innerWidth || 1200) - 240),
                        top:           Math.max(Math.min(tooltip.y - 36, (window.innerHeight || 800) - 100 - (isMob ? 56 : 16)), 56),
                        zIndex:        10001,
                        width:         "min(220px, calc(100vw - 32px))",
                        background:    "var(--bg-card-translucent)",
                        border:        "1px solid var(--border-strong)",
                        borderRadius:  "var(--radius-md)",
                        boxShadow:     "var(--shadow-callout)",
                        padding:       "10px 12px",
                        pointerEvents: "none",
                        fontFamily:    "var(--font-sans)",
                    }}
                >
                    <div style={{
                        fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)",
                        color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                        {tooltip.title}
                    </div>
                    {tooltip.subtitle && (
                        <div style={{ fontSize: "var(--text-chip)", color: "var(--text-secondary)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                            {tooltip.subtitle}
                        </div>
                    )}
                    {tooltip.position && (
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)", color: "var(--text-secondary)", marginTop: 4 }}>
                            {tooltip.position}
                        </div>
                    )}
                </div>
            )}

            {/* Unified inspector — fixed docked panel, positions itself.
                Keyed by entityId so switching to a genuinely different
                entity remounts it (playing the real slide-in keyframe)
                instead of silently reusing the same instance. */}
            {!dockExternally && outgoingPopup && (
                <InspectorPanel
                    key={`out-${outgoingPopup.entityId}`}
                    entityType={outgoingPopup.type}
                    entityId={outgoingPopup.entityId}
                    data={outgoingPopup.data}
                    onClose={() => {}}
                    slideOut
                />
            )}
            {!dockExternally && popup && INSPECTOR_TYPES.has(popup.type) && (
                <InspectorPanel
                    key={popup.entityId}
                    entityType={popup.type}
                    entityId={popup.entityId}
                    data={popup.data}
                    onClose={handleClose}
                    onSelectRelated={handleSelectRelated}
                    onJumpToLocation={handleJumpToLocation}
                    onTrackEntity={handleTrackEntity}
                />
            )}

            {/* Floating popup — the 2 entity kinds NOT covered by InspectorPanel
                (see INSPECTOR_TYPES comment above) */}
            {popup && !INSPECTOR_TYPES.has(popup.type) && (
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
                        border:        "var(--elevation-2)",
                        borderRadius:  8,
                        pointerEvents: "auto",
                    }}
                >
                    {popup.type === "threat_region" ? (
                        <ThreatRegionPopup data={popup.data} onClose={handleClose} />
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
