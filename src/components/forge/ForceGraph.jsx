/**
 * ForceGraph.jsx — Live intelligence entity graph
 *
 * Self-fetching from /api/ontology/graph (new live endpoint).
 * Delta-polls every 30 s via /api/ontology/graph/delta?since=<ts>.
 * Renders nodes with NATO-MIL-2525C shapes, animated edge pulses,
 * filter pills, node count badge, and a slide-in entity detail panel.
 *
 * Props (all optional — the component is fully self-contained):
 *   onNodeClick(node)  — called in addition to the internal detail panel
 */

import { useEffect, useRef, useState, useCallback } from "react"
import API_BASE from "../../apiBase.js"
import { drawNatoIcon, entityTypeToIcon, iconColor } from "../../globe/natoIcons.js"

// ── Node radius by type ───────────────────────────────────────────────────────
const NODE_R = {
    cable:          9,
    port:           8,
    airport:        7,
    watch_zone:     10,
    strategic_zone: 10,
    fusion_event:   11,
    surge:          9,
    alert:          8,
    vessel:         8,
    aircraft:       7,
}
const DEFAULT_R = 8

function nodeR(node) {
    const base = NODE_R[node.type] || DEFAULT_R
    const sev  = node.severity || node.data?.severity || ""
    if (sev === "critical") return base + 3
    if (sev === "high")     return base + 1
    return base
}

// ── Filter pill definitions ───────────────────────────────────────────────────
const FILTERS = [
    { id: "all",    label: "All" },
    { id: "zones",  label: "Zones",  types: ["watch_zone", "strategic_zone"] },
    { id: "cables", label: "Cables", types: ["cable"] },
    { id: "alerts", label: "Alerts", types: ["alert", "surge"] },
    { id: "fusion", label: "Fusion", types: ["fusion_event"] },
    { id: "infra",  label: "Infra",  types: ["port", "airport"] },
]

function matchesFilter(node, filterId) {
    if (filterId === "all") return true
    const f = FILTERS.find(x => x.id === filterId)
    return f?.types?.includes(node.type) ?? true
}

// ── Edge animation tick (module-level, shared across renders) ─────────────────
let _tick = 0

// ── Main component ────────────────────────────────────────────────────────────
export default function ForceGraph({ onNodeClick }) {
    const canvasRef    = useRef(null)
    const nodesRef     = useRef([])   // { ...apiNode, x, y, vx, vy, pinned }
    const edgesRef     = useRef([])
    const animRef      = useRef(null)
    const dragRef      = useRef(null)
    const panRef       = useRef({ x: 0, y: 0 })
    const zoomRef      = useRef(1)
    const isPanRef     = useRef(false)
    const panStartRef  = useRef({ x: 0, y: 0 })
    const lastFetchTs  = useRef(null)
    const sizeRef      = useRef({ W: 800, H: 600 })

    const [filter,      setFilter]      = useState("all")
    const [nodeCount,   setNodeCount]   = useState(0)
    const [loading,     setLoading]     = useState(true)
    const [detailNode,  setDetailNode]  = useState(null)   // node shown in slide panel
    const [profile,     setProfile]     = useState(null)   // fetched profile data
    const [profileLoad, setProfileLoad] = useState(false)

    // ── Fetch full graph ──────────────────────────────────────────────────────
    const fetchGraph = useCallback(() => {
        fetch(`${API_BASE}/api/ontology/graph?include_live=true&limit_live=200`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return
                const { W, H } = sizeRef.current
                const existing = new Map(nodesRef.current.map(n => [n.id, n]))
                const nodes = (data.nodes || []).map((n, i) => {
                    const ex = existing.get(n.id)
                    return ex ? { ...ex, ...n } : {
                        ...n,
                        x:  W / 2 + Math.cos((i / (data.nodes.length || 1)) * Math.PI * 2) * (Math.min(W, H) * 0.32) + (Math.random() - 0.5) * 60,
                        y:  H / 2 + Math.sin((i / (data.nodes.length || 1)) * Math.PI * 2) * (Math.min(W, H) * 0.32) + (Math.random() - 0.5) * 60,
                        vx: 0, vy: 0,
                    }
                })
                nodesRef.current = nodes
                edgesRef.current = data.edges || []
                lastFetchTs.current = new Date().toISOString()
                setNodeCount(nodes.length)
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }, [])

    // ── Delta poll ────────────────────────────────────────────────────────────
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
                        } else {
                            nodesRef.current.push({
                                ...n,
                                x:  W / 2 + (Math.random() - 0.5) * 200,
                                y:  H / 2 + (Math.random() - 0.5) * 200,
                                vx: 0, vy: 0,
                            })
                        }
                    })
                    setNodeCount(nodesRef.current.length)
                }
                if (data.edges?.length) {
                    const edgeIds = new Set(edgesRef.current.map(e => e.id))
                    data.edges.forEach(e => { if (!edgeIds.has(e.id)) edgesRef.current.push(e) })
                }
                lastFetchTs.current = new Date().toISOString()
            })
            .catch(() => {})
    }, [])

    // ── Fetch entity profile on selection ────────────────────────────────────
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

    // ── Canvas setup + draw loop ──────────────────────────────────────────────
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

        const REPEL   = 3500
        const SPRING  = 130
        const K       = 0.003
        const DAMP    = 0.84
        const GRAV    = 0.0008

        function simulate() {
            const ns = nodesRef.current
            for (let i = 0; i < ns.length; i++) {
                for (let j = i + 1; j < ns.length; j++) {
                    const dx   = ns[j].x - ns[i].x || 0.01
                    const dy   = ns[j].y - ns[i].y || 0.01
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1
                    const f    = REPEL / (dist * dist)
                    ns[i].vx -= (dx / dist) * f * 0.3
                    ns[i].vy -= (dy / dist) * f * 0.3
                    ns[j].vx += (dx / dist) * f * 0.3
                    ns[j].vy += (dy / dist) * f * 0.3
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
                src.vx += (dx / dist) * f
                src.vy += (dy / dist) * f
                tgt.vx -= (dx / dist) * f
                tgt.vy -= (dy / dist) * f
            }
            for (const n of ns) {
                if (n.pinned) continue
                n.vx += (W / 2 - n.x) * GRAV
                n.vy += (H / 2 - n.y) * GRAV
                n.vx *= DAMP
                n.vy *= DAMP
                n.x  += n.vx
                n.y  += n.vy
            }
            _tick = (_tick + 1) % 600
        }

        const SEV_GLOW = { critical: 16, high: 10 }

        function draw() {
            ctx.clearRect(0, 0, W, H)
            ctx.save()
            ctx.translate(panRef.current.x, panRef.current.y)
            ctx.scale(zoomRef.current, zoomRef.current)

            const ns      = nodesRef.current
            const es      = edgesRef.current
            const curFilt = filterRef.current

            // Visible nodes
            const visible = ns.filter(n => matchesFilter(n, curFilt))
            const visIds  = new Set(visible.map(n => n.id))

            // Edges (only between visible nodes)
            for (const edge of es) {
                if (!visIds.has(edge.source) || !visIds.has(edge.target)) continue
                const src = ns.find(n => n.id === edge.source)
                const tgt = ns.find(n => n.id === edge.target)
                if (!src || !tgt) continue

                const dx   = tgt.x - src.x
                const dy   = tgt.y - src.y
                const len  = Math.sqrt(dx * dx + dy * dy) || 1
                const col  = iconColor(src.type || "")

                // Static edge line
                ctx.beginPath()
                ctx.moveTo(src.x, src.y)
                ctx.lineTo(tgt.x, tgt.y)
                ctx.strokeStyle = col + "28"
                ctx.lineWidth   = 1
                ctx.stroke()

                // Animated pulse dot travelling along edge
                const phase = ((_tick * 2 + (parseInt(edge.id || 0, 36) % 100)) % 100) / 100
                const px = src.x + dx * phase
                const py = src.y + dy * phase
                ctx.beginPath()
                ctx.arc(px, py, 2, 0, Math.PI * 2)
                ctx.fillStyle = col + "aa"
                ctx.fill()
            }

            // Nodes
            for (const node of visible) {
                const r    = nodeR(node)
                const c    = iconColor(node.type)
                const sev  = node.severity || node.data?.severity || ""
                const glow = SEV_GLOW[sev]

                if (glow) {
                    ctx.save()
                    ctx.shadowBlur  = glow
                    ctx.shadowColor = c
                }

                drawNatoIcon(ctx, entityTypeToIcon(node.type), node.x, node.y, r, c)

                if (glow) ctx.restore()

                // Label
                const label = (node.label || node.name || node.id || "").slice(0, 22)
                ctx.fillStyle  = "#d1d5db"
                ctx.font       = "bold 8px system-ui"
                ctx.textAlign  = "center"
                ctx.fillText(label, node.x, node.y + r + 11)
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
                if (!matchesFilter(n, filterRef.current)) return false
                return Math.hypot(n.x - x, n.y - y) < nodeR(n) + 4
            }) || null
        }

        let didDrag = false

        function onMouseDown(e) {
            didDrag = false
            const hit = hitNode(e.clientX, e.clientY)
            if (hit) {
                dragRef.current = hit
                hit.pinned = true
            } else {
                isPanRef.current = true
                panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y }
            }
        }

        function onMouseMove(e) {
            if (dragRef.current) {
                didDrag = true
                const { x, y } = toWorld(e.clientX, e.clientY)
                dragRef.current.x  = x
                dragRef.current.y  = y
                dragRef.current.vx = 0
                dragRef.current.vy = 0
            } else if (isPanRef.current) {
                didDrag = true
                panRef.current = {
                    x: e.clientX - panStartRef.current.x,
                    y: e.clientY - panStartRef.current.y,
                }
            }
        }

        function onMouseUp() {
            if (dragRef.current) { dragRef.current.pinned = false; dragRef.current = null }
            isPanRef.current = false
        }

        function onClick(e) {
            if (didDrag) return
            const hit = hitNode(e.clientX, e.clientY)
            if (!hit) { setDetailNodeFn(null); return }
            setDetailNodeFn(hit)
            onNodeClick?.(hit)
        }

        function onWheel(e) {
            e.preventDefault()
            zoomRef.current = Math.max(0.1, Math.min(5, zoomRef.current * (e.deltaY > 0 ? 0.9 : 1.1)))
        }

        canvas.addEventListener("click",     onClick)
        canvas.addEventListener("mousedown", onMouseDown)
        canvas.addEventListener("mousemove", onMouseMove)
        canvas.addEventListener("mouseup",   onMouseUp)
        canvas.addEventListener("wheel",     onWheel, { passive: false })

        return () => {
            cancelAnimationFrame(animRef.current)
            clearInterval(deltaInterval)
            canvas.removeEventListener("click",     onClick)
            canvas.removeEventListener("mousedown", onMouseDown)
            canvas.removeEventListener("mousemove", onMouseMove)
            canvas.removeEventListener("mouseup",   onMouseUp)
            canvas.removeEventListener("wheel",     onWheel)
        }
    }, [fetchGraph, fetchDelta])  // eslint-disable-line react-hooks/exhaustive-deps

    // Expose setDetailNode to event handlers via a ref trick
    const filterRef        = useRef("all")
    const setDetailNodeFn  = useCallback((n) => setDetailNode(n), [])
    useEffect(() => { filterRef.current = filter }, [filter])

    const sevColor = (s) => ({ critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#22c55e" }[s] || "#64748b")

    return (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
            {/* Canvas */}
            <canvas
                ref={canvasRef}
                style={{ width: "100%", height: "100%", cursor: "grab", display: "block", background: "#060b18" }}
            />

            {/* Loading overlay */}
            {loading && (
                <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", color: "rgba(148,163,184,0.6)", fontSize: 12,
                    pointerEvents: "none",
                }}>
                    Loading live graph…
                </div>
            )}

            {/* Filter pills — top-left */}
            <div style={{
                position: "absolute", top: 10, left: 10,
                display: "flex", gap: 5, flexWrap: "wrap",
                pointerEvents: "auto",
            }}>
                {FILTERS.map(f => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        style={{
                            padding: "3px 10px", borderRadius: 12, border: "none",
                            fontSize: 10, fontWeight: 600, cursor: "pointer",
                            background: filter === f.id ? "rgba(56,139,255,0.35)" : "rgba(6,11,24,0.75)",
                            color:      filter === f.id ? "#88c8ff" : "rgba(148,163,184,0.7)",
                            backdropFilter: "blur(6px)",
                            transition: "background 0.15s",
                        }}
                    >{f.label}</button>
                ))}
            </div>

            {/* Node count badge — top-right */}
            <div style={{
                position: "absolute", top: 10, right: detailNode ? 336 : 10,
                background: "rgba(6,11,24,0.75)", backdropFilter: "blur(6px)",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6,
                padding: "3px 8px", fontSize: 10, color: "rgba(148,163,184,0.7)",
                pointerEvents: "none", transition: "right 0.3s",
            }}>
                {nodeCount} nodes
            </div>

            {/* Entity detail panel — right slide-in */}
            <div style={{
                position:   "absolute", top: 0, right: 0, bottom: 0,
                width:      detailNode ? 320 : 0,
                overflow:   "hidden",
                transition: "width 0.3s ease",
                background: "rgba(4,8,20,0.92)",
                backdropFilter: "blur(16px)",
                borderLeft: detailNode ? "1px solid rgba(255,255,255,0.07)" : "none",
                display:    "flex", flexDirection: "column",
            }}>
                {detailNode && (
                    <>
                        {/* Panel header */}
                        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                    <div style={{
                                        display: "inline-block", fontSize: 9, fontWeight: 700,
                                        padding: "2px 6px", borderRadius: 3, marginBottom: 6,
                                        background: iconColor(detailNode.type) + "22",
                                        color: iconColor(detailNode.type),
                                        letterSpacing: "0.08em", textTransform: "uppercase",
                                    }}>{detailNode.type || "entity"}</div>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.3 }}>
                                        {detailNode.label || detailNode.name || detailNode.id}
                                    </div>
                                </div>
                                <button
                                    onClick={() => setDetailNode(null)}
                                    style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0 }}
                                >✕</button>
                            </div>
                        </div>

                        {/* Panel body */}
                        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
                            {profileLoad && (
                                <div style={{ color: "#475569", fontSize: 11, textAlign: "center", padding: 12 }}>Loading profile…</div>
                            )}

                            {profile && (
                                <>
                                    {/* Recent alerts */}
                                    {(profile.recent_alerts?.length > 0) && (
                                        <Section label="Active Intelligence">
                                            {profile.recent_alerts.slice(0, 5).map((a, i) => (
                                                <AlertRow key={i} alert={a} />
                                            ))}
                                        </Section>
                                    )}

                                    {/* 48h timeline */}
                                    {(profile.timeline?.length > 0) && (
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

                                    {/* Connections */}
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

                                    {/* Threat contribution */}
                                    {profile.threat_contribution != null && (
                                        <Section label="Threat Contribution">
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                <div style={{
                                                    flex: 1, height: 6, borderRadius: 3,
                                                    background: "rgba(255,255,255,0.06)",
                                                }}>
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
                                <div style={{ color: "#334155", fontSize: 11, textAlign: "center", padding: 24 }}>
                                    No profile data available
                                </div>
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
    const sevColor = { critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#22c55e" }[alert.severity] || "#64748b"
    return (
        <div style={{ display: "flex", gap: 6, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "flex-start" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: sevColor, marginTop: 3, flexShrink: 0 }} />
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
