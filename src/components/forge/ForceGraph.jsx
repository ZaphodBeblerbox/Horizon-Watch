/**
 * ForceGraph.jsx — Live intelligence entity graph (Issue 4 revision)
 * - Capped to 150 nodes by type priority (Rules > Zones > Cables > Alerts > Fusion > Ports > Airports)
 * - Type-based force clustering (user-specified x/y targets, strength 0.3)
 * - Labels always for Rules/Zones/Fusion, hover-only for everything else
 * - Edge minimum 1.5px, coloured by relationship type
 * - Multi-select filter pills, default: Rules + Zones + Cables
 */

import { useEffect, useRef, useState, useCallback } from "react"
import API_BASE from "../../apiBase.js"
import { drawMarker, graphNodeSymbol, graphNodeColor } from "../../globe/markerRenderer.js"

// ── Canonical type normalization (DB mixed-case → canonical lowercase) ────────
const _TYPE_MAP = {
    "rule":            "rule",
    "Rule":            "rule",
    "rule connection": "rule",
    "Rule Connection": "rule",
    "escalation chain":"rule",
    "Escalation Chain":"rule",
    "strategic zone":  "strategic_zone",
    "Strategic Zone":  "strategic_zone",
    "strategic_zone":  "strategic_zone",
    "chokepoint":      "watch_zone",
    "Chokepoint":      "watch_zone",
    "watch zone":      "watch_zone",
    "Watch Zone":      "watch_zone",
    "watch_zone":      "watch_zone",
    "submarine cable": "cable",
    "Submarine Cable": "cable",
    "cable":           "cable",
    "alert":           "alert",
    "Alert":           "alert",
    "surge":           "surge",
    "surge event":     "surge",
    "Surge Event":     "surge",
    "fusion_event":    "fusion_event",
    "fusion event":    "fusion_event",
    "Fusion Event":    "fusion_event",
    "assessment":      "assessment",
    "port":            "port",
    "Port":            "port",
    "airport":         "airport",
    "Airport":         "airport",
    "vessel":          "vessel",
    "aircraft":        "aircraft",
}
function canonType(t) {
    if (!t) return "unknown"
    return _TYPE_MAP[t] ?? t.toLowerCase().replace(/\s+/g, "_")
}

// ── Node type priority for capping (lower = higher priority) ─────────────────
const TYPE_PRIORITY = {
    rule:           1,
    strategic_zone: 2,
    watch_zone:     3,
    cable:          4,
    alert:          5,
    surge:          5,
    fusion_event:   6,
    assessment:     6,
    port:           7,
    vessel:         8,
    aircraft:       9,
    airport:        10,
}
const NODE_CAP = 150
const PORT_CAP = 20

// ── Type cluster targets (fractions of W×H, derived from user's 1000×600 spec) ─
const CLUSTER_TARGETS = {
    rule:           { rx: 0.12, ry: 0.33 },
    strategic_zone: { rx: 0.32, ry: 0.25 },
    watch_zone:     { rx: 0.32, ry: 0.58 },
    cable:          { rx: 0.52, ry: 0.33 },
    alert:          { rx: 0.72, ry: 0.25 },
    surge:          { rx: 0.72, ry: 0.75 },
    fusion_event:   { rx: 0.72, ry: 0.50 },
    assessment:     { rx: 0.72, ry: 0.60 },
    vessel:         { rx: 0.52, ry: 0.75 },
    aircraft:       { rx: 0.52, ry: 0.75 },
    port:           { rx: 0.90, ry: 0.42 },
    airport:        { rx: 0.90, ry: 0.67 },
}
const CLUSTER_STRENGTH = 0.005

// ── Node radius by type ──────────────────────────────────────────────────────
const NODE_R = {
    rule:           10,
    cable:           9,
    port:            8,
    airport:         7,
    watch_zone:     10,
    strategic_zone: 10,
    fusion_event:   11,
    surge:           9,
    alert:           8,
    vessel:          8,
    aircraft:        7,
}
const MIN_R = 8

function nodeR(node) {
    const base = Math.max(MIN_R, NODE_R[canonType(node.type)] || MIN_R)
    const sev  = node.severity || node.data?.severity || ""
    if (sev === "critical") return base + 3
    if (sev === "high")     return base + 1
    return base
}

// ── Types that always show label (others: hover only) ────────────────────────
const ALWAYS_LABEL = new Set(["rule", "strategic_zone", "watch_zone", "fusion_event"])

// ── Edge colour by relationship/link type ────────────────────────────────────
const EDGE_COLOR = {
    proximity:   "#388bff",
    mention:     "#22c55e",
    correlation: "#f59e0b",
    fusion:      "#a855f7",
    rule:        "#ec4899",
}
const EDGE_DEFAULT_COLOR = "#475569"

function edgeCol(edge) {
    const t = edge.link_type || edge.type || edge.relationship_type || ""
    return EDGE_COLOR[t] || EDGE_DEFAULT_COLOR
}

// ── Multi-select filter groups ────────────────────────────────────────────────
const FILTER_GROUPS = [
    { id: "rules",   label: "Rules",   types: ["rule"] },
    { id: "zones",   label: "Zones",   types: ["watch_zone", "strategic_zone"] },
    { id: "cables",  label: "Cables",  types: ["cable"] },
    { id: "alerts",  label: "Alerts",  types: ["alert", "surge"] },
    { id: "fusion",  label: "Fusion",  types: ["fusion_event"] },
    { id: "infra",   label: "Infra",   types: ["port", "airport"] },
    { id: "vessels", label: "Vessels", types: ["vessel", "aircraft"] },
]
const DEFAULT_ACTIVE = new Set(["rules", "zones", "cables"])

function nodeGroupId(type) {
    const ct = canonType(type)
    return FILTER_GROUPS.find(g => g.types.includes(ct))?.id ?? null
}

function nodeVisible(node, activeGroups, showAll) {
    if (showAll) return true
    const gid = nodeGroupId(node.type)
    if (!gid) return true
    return activeGroups.has(gid)
}

// ── Node capping ──────────────────────────────────────────────────────────────
function capNodes(allNodes) {
    const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, "": 4 }
    const sorted = [...allNodes].sort((a, b) => {
        const pa = TYPE_PRIORITY[canonType(a.type)] ?? 99
        const pb = TYPE_PRIORITY[canonType(b.type)] ?? 99
        if (pa !== pb) return pa - pb
        return (SEV_ORDER[a.severity || ""] ?? 4) - (SEV_ORDER[b.severity || ""] ?? 4)
    })
    const portCount = { n: 0 }
    const result = []
    for (const node of sorted) {
        if (result.length >= NODE_CAP) break
        if (canonType(node.type) === "port") {
            if (portCount.n >= PORT_CAP) continue
            portCount.n++
        }
        result.push(node)
    }
    return result
}

// ── Animated edge tick (module-level so it persists across hot-reloads) ───────
let _tick = 0

// ── Main component ────────────────────────────────────────────────────────────
export default function ForceGraph({ onNodeClick }) {
    const canvasRef       = useRef(null)
    const nodesRef        = useRef([])
    const edgesRef        = useRef([])
    const animRef         = useRef(null)
    const dragRef         = useRef(null)
    const panRef          = useRef({ x: 0, y: 0 })
    const zoomRef         = useRef(1)
    const isPanRef        = useRef(false)
    const panStartRef     = useRef({ x: 0, y: 0 })
    const lastFetchTs     = useRef(null)
    const sizeRef         = useRef({ W: 800, H: 600 })
    const hoverRef        = useRef(null)
    const activeGroupsRef = useRef(new Set(DEFAULT_ACTIVE))
    const showAllRef      = useRef(false)

    const [activeGroups, setActiveGroups] = useState(new Set(DEFAULT_ACTIVE))
    const [showAll,      setShowAll]      = useState(false)
    const [nodeCount,    setNodeCount]    = useState(0)
    const [loading,      setLoading]      = useState(true)
    const [detailNode,   setDetailNode]   = useState(null)
    const [profile,      setProfile]      = useState(null)
    const [profileLoad,  setProfileLoad]  = useState(false)

    // Keep refs in sync for canvas access without re-mounting
    useEffect(() => { activeGroupsRef.current = activeGroups }, [activeGroups])
    useEffect(() => { showAllRef.current = showAll }, [showAll])

    // ── Fetch full graph ─────────────────────────────────────────────────────
    const fetchGraph = useCallback(() => {
        fetch(`${API_BASE}/api/ontology/graph?include_live=true&limit_live=200`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return
                const { W, H } = sizeRef.current
                const existing = new Map(nodesRef.current.map(n => [n.id, n]))
                const capped   = capNodes(data.nodes || [])
                nodesRef.current = capped.map((n, i) => {
                    const ex = existing.get(n.id)
                    if (ex) return { ...ex, ...n }
                    const ct = CLUSTER_TARGETS[canonType(n.type)]
                    const cx = ct ? ct.rx * W : W / 2
                    const cy = ct ? ct.ry * H : H / 2
                    return {
                        ...n,
                        x:  cx + (Math.random() - 0.5) * 130,
                        y:  cy + (Math.random() - 0.5) * 130,
                        vx: 0, vy: 0,
                    }
                })
                edgesRef.current  = data.edges || []
                lastFetchTs.current = new Date().toISOString()
                setNodeCount(nodesRef.current.length)
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }, [])

    // ── Delta poll ───────────────────────────────────────────────────────────
    const fetchDelta = useCallback(() => {
        if (!lastFetchTs.current) return
        fetch(`${API_BASE}/api/ontology/graph/delta?since=${encodeURIComponent(lastFetchTs.current)}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return
                const { W, H } = sizeRef.current
                if (data.nodes?.length) {
                    const existing = new Map(nodesRef.current.map(n => [n.id, n]))
                    data.nodes.forEach(n => {
                        if (existing.has(n.id)) {
                            Object.assign(existing.get(n.id), n)
                        } else if (nodesRef.current.length < NODE_CAP) {
                            const ct = CLUSTER_TARGETS[canonType(n.type)]
                            nodesRef.current.push({
                                ...n,
                                x:  ct ? ct.rx * W + (Math.random() - 0.5) * 100 : W / 2 + (Math.random() - 0.5) * 200,
                                y:  ct ? ct.ry * H + (Math.random() - 0.5) * 100 : H / 2 + (Math.random() - 0.5) * 200,
                                vx: 0, vy: 0,
                            })
                        }
                    })
                    setNodeCount(nodesRef.current.length)
                }
                if (data.edges?.length) {
                    const ids = new Set(edgesRef.current.map(e => e.id))
                    data.edges.forEach(e => { if (!ids.has(e.id)) edgesRef.current.push(e) })
                }
                lastFetchTs.current = new Date().toISOString()
            })
            .catch(() => {})
    }, [])

    // ── Entity profile ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!detailNode) { setProfile(null); return }
        setProfileLoad(true)
        setProfile(null)
        const t = detailNode.type || "entity"
        const i = detailNode.entity_id || detailNode.id
        fetch(`${API_BASE}/api/entities/${encodeURIComponent(t)}/${encodeURIComponent(i)}/profile`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { setProfile(d); setProfileLoad(false) })
            .catch(() => setProfileLoad(false))
    }, [detailNode?.id])

    // ── Canvas setup + draw loop ─────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const outer = canvas.parentElement.getBoundingClientRect()
        const W     = outer.width  || 800
        const H     = outer.height || 600
        const DPR   = window.devicePixelRatio || 1
        sizeRef.current = { W, H }
        canvas.width        = W * DPR
        canvas.height       = H * DPR
        canvas.style.width  = W + "px"
        canvas.style.height = H + "px"
        const ctx = canvas.getContext("2d")
        ctx.scale(DPR, DPR)

        fetchGraph()
        const deltaInterval = setInterval(fetchDelta, 30_000)

        const REPEL  = 2600
        const SPRING = 105
        const K      = 0.004
        const DAMP   = 0.82
        const GRAV   = 0.0004

        function simulate() {
            const ns = nodesRef.current
            for (let i = 0; i < ns.length; i++) {
                for (let j = i + 1; j < ns.length; j++) {
                    const dx   = ns[j].x - ns[i].x || 0.01
                    const dy   = ns[j].y - ns[i].y || 0.01
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1
                    const f    = REPEL / (dist * dist)
                    const fx   = (dx / dist) * f * 0.3
                    const fy   = (dy / dist) * f * 0.3
                    ns[i].vx -= fx; ns[i].vy -= fy
                    ns[j].vx += fx; ns[j].vy += fy
                }
            }
            for (const edge of edgesRef.current) {
                const src = ns.find(n => n.id === edge.source)
                const tgt = ns.find(n => n.id === edge.target)
                if (!src || !tgt) continue
                const dx   = tgt.x - src.x
                const dy   = tgt.y - src.y
                const dist = Math.sqrt(dx * dx + dy * dy) || 1
                const f    = (dist - SPRING) * K
                src.vx += (dx / dist) * f; src.vy += (dy / dist) * f
                tgt.vx -= (dx / dist) * f; tgt.vy -= (dy / dist) * f
            }
            for (const n of ns) {
                if (n.pinned) continue
                // Type clustering
                const ct = CLUSTER_TARGETS[canonType(n.type)]
                if (ct) {
                    n.vx += (ct.rx * W - n.x) * CLUSTER_STRENGTH
                    n.vy += (ct.ry * H - n.y) * CLUSTER_STRENGTH
                }
                // Centre gravity
                n.vx += (W / 2 - n.x) * GRAV
                n.vy += (H / 2 - n.y) * GRAV
                n.vx *= DAMP; n.vy *= DAMP
                n.x  += n.vx; n.y  += n.vy
            }
            _tick = (_tick + 1) % 600
        }

        const SEV_GLOW = { critical: 16, high: 10 }

        function draw() {
            ctx.clearRect(0, 0, W, H)
            ctx.save()
            ctx.translate(panRef.current.x, panRef.current.y)
            ctx.scale(zoomRef.current, zoomRef.current)

            const ns     = nodesRef.current
            const es     = edgesRef.current
            const ag     = activeGroupsRef.current
            const sa     = showAllRef.current
            const hovId  = hoverRef.current?.id

            const visible = ns.filter(n => nodeVisible(n, ag, sa))
            const visIds  = new Set(visible.map(n => n.id))

            // Edges
            for (const edge of es) {
                if (!visIds.has(edge.source) || !visIds.has(edge.target)) continue
                const src = ns.find(n => n.id === edge.source)
                const tgt = ns.find(n => n.id === edge.target)
                if (!src || !tgt) continue

                const col    = edgeCol(edge)
                const isHovE = hovId === src.id || hovId === tgt.id
                const alpha  = isHovE ? "66" : "28"

                ctx.beginPath()
                ctx.moveTo(src.x, src.y)
                ctx.lineTo(tgt.x, tgt.y)
                ctx.strokeStyle = col + alpha
                ctx.lineWidth   = 1.5
                ctx.stroke()

                // Animated pulse dot
                const phase = ((_tick * 2 + (parseInt(edge.id || "0", 36) % 100)) % 100) / 100
                ctx.beginPath()
                ctx.arc(src.x + (tgt.x - src.x) * phase, src.y + (tgt.y - src.y) * phase, 2, 0, Math.PI * 2)
                ctx.fillStyle = col + "aa"
                ctx.fill()
            }

            // Nodes
            for (const node of visible) {
                const ct   = canonType(node.type)
                const r    = nodeR(node)
                const c    = graphNodeColor(ct)
                const sev  = node.severity || node.data?.severity || ""
                const glow = SEV_GLOW[sev]
                const isHov = node.id === hovId

                ctx.save()
                if (glow || isHov) {
                    ctx.shadowBlur  = isHov ? 20 : glow
                    ctx.shadowColor = c
                }
                const { affiliation, entityFunction } = graphNodeSymbol(ct)
                drawMarker(ctx, node.x, node.y, r, { affiliation, entityFunction })
                ctx.restore()

                // Labels: always for priority types, hover-only for others
                if (ALWAYS_LABEL.has(ct) || isHov) {
                    const label = (node.label || node.name || node.id || "").slice(0, 24)
                    ctx.save()
                    ctx.shadowBlur  = 4
                    ctx.shadowColor = "rgba(0,0,0,0.9)"
                    ctx.fillStyle   = isHov ? "#f1f5f9" : "#94a3b8"
                    ctx.font        = `${isHov ? "bold " : ""}9px system-ui`
                    ctx.textAlign   = "center"
                    ctx.fillText(label, node.x, node.y + r + 12)
                    ctx.restore()
                }
            }

            ctx.restore()
            simulate()
            animRef.current = requestAnimationFrame(draw)
        }

        draw()

        function toWorld(ex, ey) {
            const rect = canvas.getBoundingClientRect()
            return {
                x: (ex - rect.left - panRef.current.x) / zoomRef.current,
                y: (ey - rect.top  - panRef.current.y) / zoomRef.current,
            }
        }

        function hitNode(ex, ey) {
            const { x, y } = toWorld(ex, ey)
            return nodesRef.current.find(n => {
                if (!nodeVisible(n, activeGroupsRef.current, showAllRef.current)) return false
                return Math.hypot(n.x - x, n.y - y) < nodeR(n) + 5
            }) || null
        }

        let didDrag = false

        function onMouseDown(e) {
            didDrag = false
            const hit = hitNode(e.clientX, e.clientY)
            if (hit) {
                dragRef.current = hit; hit.pinned = true
            } else {
                isPanRef.current = true
                panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y }
            }
        }

        function onMouseMove(e) {
            if (dragRef.current) {
                didDrag = true
                const { x, y } = toWorld(e.clientX, e.clientY)
                Object.assign(dragRef.current, { x, y, vx: 0, vy: 0 })
            } else if (isPanRef.current) {
                didDrag = true
                panRef.current = { x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y }
            } else {
                hoverRef.current = hitNode(e.clientX, e.clientY)
            }
        }

        function onMouseUp() {
            if (dragRef.current) { dragRef.current.pinned = false; dragRef.current = null }
            isPanRef.current = false
        }

        function onClick(e) {
            if (didDrag) return
            const hit = hitNode(e.clientX, e.clientY)
            setDetailNodeSetter(hit || null)
            if (hit) onNodeClick?.(hit)
        }

        function onWheel(e) {
            e.preventDefault()
            zoomRef.current = Math.max(0.1, Math.min(5, zoomRef.current * (e.deltaY > 0 ? 0.9 : 1.1)))
        }

        function onMouseLeave() { hoverRef.current = null }

        canvas.addEventListener("click",      onClick)
        canvas.addEventListener("mousedown",  onMouseDown)
        canvas.addEventListener("mousemove",  onMouseMove)
        canvas.addEventListener("mouseup",    onMouseUp)
        canvas.addEventListener("wheel",      onWheel, { passive: false })
        canvas.addEventListener("mouseleave", onMouseLeave)

        return () => {
            cancelAnimationFrame(animRef.current)
            clearInterval(deltaInterval)
            canvas.removeEventListener("click",      onClick)
            canvas.removeEventListener("mousedown",  onMouseDown)
            canvas.removeEventListener("mousemove",  onMouseMove)
            canvas.removeEventListener("mouseup",    onMouseUp)
            canvas.removeEventListener("wheel",      onWheel)
            canvas.removeEventListener("mouseleave", onMouseLeave)
        }
    }, [fetchGraph, fetchDelta])

    const setDetailNodeSetter = useCallback((n) => setDetailNode(n), [])

    function toggleGroup(gid) {
        setShowAll(false)
        setActiveGroups(prev => {
            const next = new Set(prev)
            next.has(gid) ? next.delete(gid) : next.add(gid)
            return next
        })
    }

    const sevColor = s => ({ critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#22c55e" }[s] || "#64748b")

    const visibleCount = nodesRef.current.filter(n => nodeVisible(n, activeGroups, showAll)).length

    return (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <canvas
                ref={canvasRef}
                style={{ width: "100%", height: "100%", cursor: "grab", display: "block", background: "#060b18" }}
            />

            {loading && (
                <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", color: "rgba(148,163,184,0.6)", fontSize: 12,
                    pointerEvents: "none",
                }}>Loading live graph…</div>
            )}

            {/* Filter pills */}
            <div style={{
                position: "absolute", top: 10, left: 10,
                display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center",
                pointerEvents: "auto",
            }}>
                <span style={{ fontSize: 9, color: "rgba(148,163,184,0.45)", fontWeight: 700, letterSpacing: "0.1em", marginRight: 2 }}>
                    SHOW
                </span>
                {FILTER_GROUPS.map(g => {
                    const on = !showAll && activeGroups.has(g.id)
                    return (
                        <button key={g.id} onClick={() => toggleGroup(g.id)} style={{
                            padding: "3px 10px", borderRadius: 12, border: "none",
                            fontSize: 10, fontWeight: 600, cursor: "pointer",
                            background: on ? "rgba(56,139,255,0.32)" : "rgba(6,11,24,0.78)",
                            color:      on ? "#88c8ff" : "rgba(148,163,184,0.5)",
                            outline:    on ? "1px solid rgba(56,139,255,0.35)" : "none",
                            backdropFilter: "blur(6px)",
                            transition: "all 0.15s",
                        }}>{g.label}</button>
                    )
                })}
                <button onClick={() => setShowAll(s => !s)} style={{
                    padding: "3px 10px", borderRadius: 12, border: "none",
                    fontSize: 10, fontWeight: 600, cursor: "pointer",
                    background: showAll ? "rgba(148,163,184,0.22)" : "rgba(6,11,24,0.78)",
                    color:      showAll ? "#cbd5e1" : "rgba(148,163,184,0.5)",
                    backdropFilter: "blur(6px)",
                    transition: "all 0.15s",
                }}>All</button>
            </div>

            {/* Node count badge */}
            <div style={{
                position: "absolute", top: 10, right: detailNode ? 336 : 10,
                background: "rgba(6,11,24,0.75)", backdropFilter: "blur(6px)",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6,
                padding: "3px 8px", fontSize: 10, color: "rgba(148,163,184,0.7)",
                pointerEvents: "none", transition: "right 0.3s",
            }}>
                {visibleCount} / {nodeCount}
            </div>

            {/* Edge type legend */}
            <div style={{
                position: "absolute", bottom: 10, left: 10,
                display: "flex", gap: 10, flexWrap: "wrap",
                pointerEvents: "none",
            }}>
                {Object.entries(EDGE_COLOR).map(([type, col]) => (
                    <div key={type} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 16, height: 2, background: col, borderRadius: 1 }} />
                        <span style={{ fontSize: 8, color: "rgba(148,163,184,0.45)", textTransform: "capitalize" }}>{type}</span>
                    </div>
                ))}
            </div>

            {/* Entity detail panel */}
            <div style={{
                position: "absolute", top: 0, right: 0, bottom: 0,
                width:      detailNode ? 320 : 0,
                overflow:   "hidden",
                transition: "width 0.3s ease",
                background: "rgba(4,8,20,0.92)",
                backdropFilter: "blur(16px)",
                borderLeft: detailNode ? "1px solid rgba(255,255,255,0.07)" : "none",
                display: "flex", flexDirection: "column",
            }}>
                {detailNode && (
                    <>
                        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                    <div style={{
                                        display: "inline-block", fontSize: 9, fontWeight: 700,
                                        padding: "2px 6px", borderRadius: 3, marginBottom: 6,
                                        background: graphNodeColor(canonType(detailNode.type)) + "22",
                                        color: graphNodeColor(canonType(detailNode.type)),
                                        letterSpacing: "0.08em", textTransform: "uppercase",
                                    }}>{detailNode.type || "entity"}</div>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.3 }}>
                                        {detailNode.label || detailNode.name || detailNode.id}
                                    </div>
                                </div>
                                <button onClick={() => setDetailNode(null)} style={{
                                    background: "none", border: "none", color: "#475569",
                                    cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0,
                                }}>✕</button>
                            </div>
                        </div>

                        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
                            {profileLoad && (
                                <div style={{ color: "#475569", fontSize: 11, textAlign: "center", padding: 12 }}>Loading profile…</div>
                            )}
                            {profile && (
                                <>
                                    {profile.recent_alerts?.length > 0 && (
                                        <Section label="Active Intelligence">
                                            {profile.recent_alerts.slice(0, 5).map((a, i) => <AlertRow key={i} alert={a} />)}
                                        </Section>
                                    )}
                                    {profile.timeline?.length > 0 && (
                                        <Section label="48h Timeline">
                                            {profile.timeline.slice(0, 8).map((ev, i) => (
                                                <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                                                    <div style={{ width: 3, borderRadius: 2, background: sevColor(ev.severity), flexShrink: 0 }} />
                                                    <div>
                                                        <div style={{ fontSize: 10, color: "#cbd5e1" }}>{ev.title || ev.summary || ""}</div>
                                                        <div style={{ fontSize: 9, color: "#475569", marginTop: 1 }}>{ev.source || ev.domain || ""}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </Section>
                                    )}
                                    {profile.connections && Object.keys(profile.connections).length > 0 && (
                                        <Section label="Connections">
                                            {Object.entries(profile.connections).map(([type, items]) => (
                                                <div key={type} style={{ marginBottom: 6 }}>
                                                    <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{type}</div>
                                                    {(Array.isArray(items) ? items : [items]).slice(0, 4).map((it, i) => (
                                                        <div key={i} style={{ fontSize: 10, color: "#94a3b8", padding: "1px 0" }}>
                                                            · {typeof it === "string" ? it : (it.name || it.entity_name || JSON.stringify(it))}
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </Section>
                                    )}
                                    {profile.threat_contribution != null && (
                                        <Section label="Threat Contribution">
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                <div style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>
                                                    <div style={{
                                                        height: "100%", borderRadius: 3,
                                                        width: `${Math.min(100, profile.threat_contribution)}%`,
                                                        background: `linear-gradient(90deg, #3b82f6, ${sevColor(profile.threat_level)})`,
                                                    }} />
                                                </div>
                                                <span style={{ fontSize: 11, color: sevColor(profile.threat_level), fontWeight: 700, flexShrink: 0 }}>
                                                    {Math.round(profile.threat_contribution)}
                                                </span>
                                            </div>
                                        </Section>
                                    )}
                                </>
                            )}
                            {!profileLoad && !profile && (
                                <div style={{ color: "#334155", fontSize: 11, textAlign: "center", padding: 24 }}>No profile data available</div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

function Section({ label, children }) {
    return (
        <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(148,163,184,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                {label}
            </div>
            {children}
        </div>
    )
}

function AlertRow({ alert }) {
    const c = { critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#22c55e" }[alert.severity] || "#64748b"
    return (
        <div style={{ display: "flex", gap: 6, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "flex-start" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: c, marginTop: 3, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {alert.title || alert.alert_type || "Alert"}
                </div>
                <div style={{ fontSize: 9, color: "#475569", marginTop: 1 }}>
                    {alert.source || ""}{alert.created_at ? " · " + new Date(alert.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                </div>
            </div>
        </div>
    )
}
