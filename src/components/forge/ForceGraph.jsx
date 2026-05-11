import { useEffect, useRef } from "react"

export default function ForceGraph({ nodes, edges, entityTypes, edgeTypes, onNodeClick }) {
    const canvasRef  = useRef(null)
    const nodesRef   = useRef([])
    const animRef    = useRef(null)
    const dragRef    = useRef(null)
    const panRef     = useRef({ x: 0, y: 0 })
    const zoomRef    = useRef(1)
    const isPanRef   = useRef(false)
    const panStartRef = useRef({ x: 0, y: 0 })

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !nodes.length) return

        const ctx   = canvas.getContext("2d")
        const outer = canvas.parentElement.getBoundingClientRect()
        const W     = outer.width
        const H     = outer.height
        const DPR   = window.devicePixelRatio || 1

        canvas.width        = W * DPR
        canvas.height       = H * DPR
        canvas.style.width  = W + "px"
        canvas.style.height = H + "px"
        ctx.scale(DPR, DPR)

        // Seed positions in a circle
        nodesRef.current = nodes.map((n, i) => ({
            ...n,
            x:  W / 2 + Math.cos((i / nodes.length) * Math.PI * 2) * (Math.min(W, H) * 0.3) + (Math.random() - 0.5) * 80,
            y:  H / 2 + Math.sin((i / nodes.length) * Math.PI * 2) * (Math.min(W, H) * 0.3) + (Math.random() - 0.5) * 80,
            vx: 0,
            vy: 0,
        }))

        const REPEL   = 4000
        const SPRING  = 120   // rest length
        const K       = 0.004
        const DAMP    = 0.85
        const GRAVITY = 0.0008
        const ALPHA   = 0.3

        function simulate() {
            const ns = nodesRef.current
            // Repulsion
            for (let i = 0; i < ns.length; i++) {
                for (let j = i + 1; j < ns.length; j++) {
                    const dx   = ns[j].x - ns[i].x || 0.01
                    const dy   = ns[j].y - ns[i].y || 0.01
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1
                    const f    = REPEL / (dist * dist)
                    ns[i].vx -= (dx / dist) * f * ALPHA
                    ns[i].vy -= (dy / dist) * f * ALPHA
                    ns[j].vx += (dx / dist) * f * ALPHA
                    ns[j].vy += (dy / dist) * f * ALPHA
                }
            }
            // Spring attraction along edges
            for (const edge of edges) {
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
            // Centre gravity + damping + integrate
            for (const n of ns) {
                if (n.pinned) continue
                n.vx += (W / 2 - n.x) * GRAVITY
                n.vy += (H / 2 - n.y) * GRAVITY
                n.vx *= DAMP
                n.vy *= DAMP
                n.x  += n.vx
                n.y  += n.vy
            }
        }

        function draw() {
            ctx.clearRect(0, 0, W, H)
            ctx.save()
            ctx.translate(panRef.current.x, panRef.current.y)
            ctx.scale(zoomRef.current, zoomRef.current)

            const ns = nodesRef.current

            // Edges
            for (const edge of edges) {
                const src = ns.find(n => n.id === edge.source)
                const tgt = ns.find(n => n.id === edge.target)
                if (!src || !tgt) continue
                const col = (edgeTypes[edge.type] || { color: "#334155" }).color
                ctx.beginPath()
                ctx.moveTo(src.x, src.y)
                ctx.lineTo(tgt.x, tgt.y)
                ctx.strokeStyle = col + "55"
                ctx.lineWidth   = 1
                ctx.stroke()
                // Edge label
                const mx = (src.x + tgt.x) / 2
                const my = (src.y + tgt.y) / 2
                ctx.fillStyle  = "#475569"
                ctx.font       = "7px system-ui"
                ctx.textAlign  = "center"
                ctx.fillText(edge.type || "", mx, my - 3)
            }

            // Nodes
            for (const node of ns) {
                const style = entityTypes[node.type] || { color: "#64748b" }
                const r     = 10
                // Glow
                ctx.beginPath()
                ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2)
                ctx.fillStyle = style.color + "22"
                ctx.fill()
                // Fill
                ctx.beginPath()
                ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
                ctx.fillStyle   = style.color
                ctx.fill()
                ctx.strokeStyle = style.color + "99"
                ctx.lineWidth   = 2
                ctx.stroke()
                // Label
                ctx.fillStyle  = "#e2e8f0"
                ctx.font       = "bold 9px system-ui"
                ctx.textAlign  = "center"
                ctx.fillText(
                    node.label.length > 20 ? node.label.slice(0, 18) + "…" : node.label,
                    node.x, node.y + r + 12
                )
            }

            ctx.restore()
            simulate()
            animRef.current = requestAnimationFrame(draw)
        }

        draw()

        // Hit-test helper (screen → world)
        function toWorld(ex, ey) {
            const r = canvas.getBoundingClientRect()
            return {
                x: (ex - r.left - panRef.current.x) / zoomRef.current,
                y: (ey - r.top  - panRef.current.y) / zoomRef.current,
            }
        }

        function hitNode(ex, ey) {
            const { x, y } = toWorld(ex, ey)
            return nodesRef.current.find(n => Math.hypot(n.x - x, n.y - y) < 14) || null
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
            if (!hit) return
            const connections = edges
                .filter(ed => ed.source === hit.id || ed.target === hit.id)
                .map(ed => ({
                    edge_id:      ed.id,
                    type:         ed.type,
                    target_label: ed.source === hit.id
                        ? (nodes.find(n => n.id === ed.target)?.label || ed.target)
                        : (nodes.find(n => n.id === ed.source)?.label || ed.source),
                }))
            onNodeClick?.({ ...hit, connections })
        }

        function onWheel(e) {
            e.preventDefault()
            const factor = e.deltaY > 0 ? 0.9 : 1.1
            zoomRef.current = Math.max(0.15, Math.min(4, zoomRef.current * factor))
        }

        canvas.addEventListener("click",     onClick)
        canvas.addEventListener("mousedown", onMouseDown)
        canvas.addEventListener("mousemove", onMouseMove)
        canvas.addEventListener("mouseup",   onMouseUp)
        canvas.addEventListener("wheel",     onWheel, { passive: false })

        return () => {
            cancelAnimationFrame(animRef.current)
            canvas.removeEventListener("click",     onClick)
            canvas.removeEventListener("mousedown", onMouseDown)
            canvas.removeEventListener("mousemove", onMouseMove)
            canvas.removeEventListener("mouseup",   onMouseUp)
            canvas.removeEventListener("wheel",     onWheel)
        }
    }, [nodes, edges, entityTypes, edgeTypes, onNodeClick])

    return (
        <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "100%", cursor: "grab", display: "block" }}
        />
    )
}
