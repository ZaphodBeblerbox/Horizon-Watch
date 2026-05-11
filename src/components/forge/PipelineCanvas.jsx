import { useRef, useEffect, useState, useCallback } from 'react'

export const NODE_WIDTH  = 180
export const NODE_HEIGHT = 44
const NODE_GAP    = 12
const COLUMN_GAP  = 60
const PADDING     = 40

export const TYPE_COLORS = {
    source:       '#3b82f6',
    detector:     '#f59e0b',
    enrichment:   '#8b5cf6',
    intelligence: '#ef4444',
    output:       '#22c55e',
}

export const STATUS_DOT = {
    active:     '#22c55e',
    configured: '#f59e0b',
    error:      '#ef4444',
    inactive:   '#475569',
}

const COLUMN_LABELS = ['DATA SOURCES', 'DETECTORS', 'ENRICHMENT', 'INTELLIGENCE', 'OUTPUTS']

function getNodeSubtitle(node, brainStatus) {
    switch (node.id) {
        case 'src_ais':         return `${brainStatus?.vessels_tracked || 0} vessels`
        case 'src_adsb':        return 'Live polling'
        case 'src_news':        return `${node.config?.feeds || 277} feeds`
        case 'src_satellite':   return '10m resolution'
        case 'src_uploads':     return `${node.config?.count || 0} files`
        case 'src_osint':       return 'GDELT events'
        case 'det_ais':         return `${brainStatus?.rules_active || 0} rules active`
        case 'det_adsb':        return 'Callsigns + squawks'
        case 'det_news':        return 'NLP scoring'
        case 'det_overwatch':   return node.config?.model || 'DOTA model'
        case 'enr_correlation': return 'Multi-domain fusion'
        case 'enr_ontology':    return `${node.config?.nodes || 0} entities`
        case 'enr_geocode':     return 'Lat/lng enrichment'
        case 'int_threat':      return `${node.config?.regions || 10} regions`
        case 'int_patterns':    return 'Cross-signal patterns'
        case 'int_escalation':  return 'Severity trends'
        case 'out_alerts':      return `${brainStatus?.alerts_24h || 0} alerts (24h)`
        case 'out_briefings':   return 'Director system'
        case 'out_reports':     return 'Export ready'
        default:                return ''
    }
}

export default function PipelineCanvas({ nodes, edges, brainStatus, onNodeClick, onNodeRightClick }) {
    const canvasRef   = useRef(null)
    const dragging    = useRef(false)
    const dragStart   = useRef(null)
    const [hoveredNode, setHoveredNode] = useState(null)
    const [pan,  setPan]  = useState({ x: 24, y: 0 })
    const [zoom, setZoom] = useState(1)

    const nodePositions = useCallback(() => {
        const columns = {}
        for (const node of nodes) {
            if (!columns[node.column]) columns[node.column] = []
            columns[node.column].push(node)
        }
        const positions = {}
        for (const [col, colNodes] of Object.entries(columns)) {
            const colX = PADDING + parseInt(col) * (NODE_WIDTH + COLUMN_GAP)
            const startY = PADDING + 36
            colNodes.forEach((node, i) => {
                positions[node.id] = { x: colX, y: startY + i * (NODE_HEIGHT + NODE_GAP), node }
            })
        }
        return positions
    }, [nodes])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        const parent = canvas.parentElement
        const W = parent.clientWidth
        const H = parent.clientHeight
        const DPR = window.devicePixelRatio || 1

        canvas.width  = W * DPR
        canvas.height = H * DPR
        canvas.style.width  = W + 'px'
        canvas.style.height = H + 'px'
        ctx.scale(DPR, DPR)

        const positions = nodePositions()

        ctx.clearRect(0, 0, W, H)
        ctx.save()
        ctx.translate(pan.x, pan.y)
        ctx.scale(zoom, zoom)

        // Column headers + vertical separators
        COLUMN_LABELS.forEach((label, i) => {
            const x = PADDING + i * (NODE_WIDTH + COLUMN_GAP)
            ctx.fillStyle = '#334155'
            ctx.font = '500 9px system-ui'
            ctx.letterSpacing = '0.1em'
            ctx.fillText(label, x, PADDING - 10)
            if (i > 0) {
                ctx.beginPath()
                ctx.moveTo(x - COLUMN_GAP / 2, PADDING - 28)
                ctx.lineTo(x - COLUMN_GAP / 2, H / zoom)
                ctx.strokeStyle = 'rgba(148,163,184,0.04)'
                ctx.lineWidth = 1
                ctx.setLineDash([])
                ctx.stroke()
            }
        })

        // Edges
        for (const edge of edges) {
            const from = positions[edge.from]
            const to   = positions[edge.to]
            if (!from || !to) continue
            const sx   = from.x + NODE_WIDTH
            const sy   = from.y + NODE_HEIGHT / 2
            const ex   = to.x
            const ey   = to.y + NODE_HEIGHT / 2
            const cpX  = (sx + ex) / 2
            const hl   = hoveredNode && (edge.from === hoveredNode || edge.to === hoveredNode)

            ctx.beginPath()
            ctx.moveTo(sx, sy)
            ctx.bezierCurveTo(cpX, sy, cpX, ey, ex, ey)
            ctx.strokeStyle = hl ? 'rgba(96,165,250,0.55)' : 'rgba(148,163,184,0.1)'
            ctx.lineWidth   = hl ? 1.5 : 1
            ctx.setLineDash([])
            ctx.stroke()

            // Arrow head
            const angle = Math.atan2(ey - sy, ex - cpX)
            ctx.beginPath()
            ctx.moveTo(ex, ey)
            ctx.lineTo(ex - 6 * Math.cos(angle - 0.42), ey - 6 * Math.sin(angle - 0.42))
            ctx.lineTo(ex - 6 * Math.cos(angle + 0.42), ey - 6 * Math.sin(angle + 0.42))
            ctx.closePath()
            ctx.fillStyle = hl ? 'rgba(96,165,250,0.55)' : 'rgba(148,163,184,0.1)'
            ctx.fill()
        }

        // Nodes
        for (const [id, pos] of Object.entries(positions)) {
            const node      = pos.node
            const isHovered = hoveredNode === id
            const color     = TYPE_COLORS[node.type] || '#64748b'
            const r = 6
            const { x, y } = pos

            // Card bg + border
            ctx.fillStyle   = isHovered ? '#1e293b' : '#111827'
            ctx.strokeStyle = isHovered ? color + '55' : 'rgba(148,163,184,0.1)'
            ctx.lineWidth   = isHovered ? 1.5 : 1
            ctx.beginPath()
            ctx.moveTo(x + r, y)
            ctx.lineTo(x + NODE_WIDTH - r, y)
            ctx.quadraticCurveTo(x + NODE_WIDTH, y, x + NODE_WIDTH, y + r)
            ctx.lineTo(x + NODE_WIDTH, y + NODE_HEIGHT - r)
            ctx.quadraticCurveTo(x + NODE_WIDTH, y + NODE_HEIGHT, x + NODE_WIDTH - r, y + NODE_HEIGHT)
            ctx.lineTo(x + r, y + NODE_HEIGHT)
            ctx.quadraticCurveTo(x, y + NODE_HEIGHT, x, y + NODE_HEIGHT - r)
            ctx.lineTo(x, y + r)
            ctx.quadraticCurveTo(x, y, x + r, y)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()

            // Left accent bar
            ctx.fillStyle = color
            ctx.fillRect(x, y + 1, 3, NODE_HEIGHT - 2)

            // Status dot
            ctx.beginPath()
            ctx.arc(x + NODE_WIDTH - 12, y + 12, 3, 0, Math.PI * 2)
            ctx.fillStyle = STATUS_DOT[node.status] || '#475569'
            ctx.fill()

            // Label
            ctx.fillStyle = isHovered ? '#e2e8f0' : '#cbd5e1'
            ctx.font = '600 11px system-ui'
            ctx.letterSpacing = '0'
            ctx.fillText(node.label, x + 12, y + 18)

            // Subtitle
            const sub = getNodeSubtitle(node, brainStatus)
            if (sub) {
                ctx.fillStyle = '#475569'
                ctx.font      = '9px system-ui'
                ctx.fillText(sub, x + 12, y + 32)
            }

            // Arrow indicator
            ctx.fillStyle = isHovered ? '#60a5fa' : '#334155'
            ctx.font      = '14px system-ui'
            ctx.fillText('›', x + NODE_WIDTH - 14, y + NODE_HEIGHT / 2 + 5)
        }

        ctx.restore()

        // ── Event helpers ──────────────────────────────────────────────────────
        function getNodeAt(mx, my) {
            const ax = (mx - pan.x) / zoom
            const ay = (my - pan.y) / zoom
            for (const [id, pos] of Object.entries(positions)) {
                if (ax >= pos.x && ax <= pos.x + NODE_WIDTH && ay >= pos.y && ay <= pos.y + NODE_HEIGHT) return id
            }
            return null
        }

        let lastMoveX = 0, lastMoveY = 0

        function onMouseMove(e) {
            const cr = canvas.getBoundingClientRect()
            const mx = e.clientX - cr.left
            const my = e.clientY - cr.top
            lastMoveX = e.clientX; lastMoveY = e.clientY
            const nodeId = getNodeAt(mx, my)
            if (nodeId !== hoveredNode) setHoveredNode(nodeId)
            canvas.style.cursor = nodeId ? 'pointer' : dragging.current ? 'grabbing' : 'grab'
            if (dragging.current && dragStart.current) {
                const dx = e.clientX - dragStart.current.x
                const dy = e.clientY - dragStart.current.y
                setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }))
                dragStart.current = { x: e.clientX, y: e.clientY }
            }
        }

        function onClick(e) {
            const cr = canvas.getBoundingClientRect()
            const nodeId = getNodeAt(e.clientX - cr.left, e.clientY - cr.top)
            if (nodeId && onNodeClick) onNodeClick(nodeId, positions[nodeId].node)
        }

        function onContextMenu(e) {
            e.preventDefault()
            const cr = canvas.getBoundingClientRect()
            const nodeId = getNodeAt(e.clientX - cr.left, e.clientY - cr.top)
            if (nodeId && onNodeRightClick) onNodeRightClick(nodeId, positions[nodeId].node, e)
        }

        function onMouseDown(e) {
            const cr = canvas.getBoundingClientRect()
            const nodeId = getNodeAt(e.clientX - cr.left, e.clientY - cr.top)
            if (!nodeId) {
                dragging.current = true
                dragStart.current = { x: e.clientX, y: e.clientY }
            }
        }

        function onMouseUp() {
            dragging.current  = false
            dragStart.current = null
        }

        function onWheel(e) {
            e.preventDefault()
            const d = e.deltaY > 0 ? 0.92 : 1.08
            setZoom(prev => Math.max(0.4, Math.min(2.5, prev * d)))
        }

        canvas.addEventListener('mousemove', onMouseMove)
        canvas.addEventListener('click', onClick)
        canvas.addEventListener('contextmenu', onContextMenu)
        canvas.addEventListener('mousedown', onMouseDown)
        canvas.addEventListener('mouseup', onMouseUp)
        canvas.addEventListener('mouseleave', onMouseUp)
        canvas.addEventListener('wheel', onWheel, { passive: false })

        return () => {
            canvas.removeEventListener('mousemove', onMouseMove)
            canvas.removeEventListener('click', onClick)
            canvas.removeEventListener('contextmenu', onContextMenu)
            canvas.removeEventListener('mousedown', onMouseDown)
            canvas.removeEventListener('mouseup', onMouseUp)
            canvas.removeEventListener('mouseleave', onMouseUp)
            canvas.removeEventListener('wheel', onWheel)
        }
    }, [nodes, edges, hoveredNode, pan, zoom, brainStatus, nodePositions, onNodeClick, onNodeRightClick])

    return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}
