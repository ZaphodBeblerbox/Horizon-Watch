import { useRef, useEffect, useState } from 'react'
import API_BASE from '../../apiBase.js'

const API = API_BASE

function forgeHeaders() {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('hw-auth-token') || ''}`,
        'X-Forge-Passcode': localStorage.getItem('forge_passcode') || '',
    }
}

export const NODE_WIDTH  = 180
export const NODE_HEIGHT = 44
const PADDING    = 40
const COLUMN_GAP = 60

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
const COLUMN_X = [0, 1, 2, 3, 4].map(i => PADDING + i * (NODE_WIDTH + COLUMN_GAP))

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

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
}

function truncate(str, len) { return str.length > len ? str.slice(0, len) + '…' : str }

const toolbarBtnStyle = {
    padding: '4px 10px', borderRadius: 3, border: '1px solid rgba(148,163,184,0.1)',
    background: '#111827', color: '#94a3b8', cursor: 'pointer', fontSize: 10,
}
const inputStyle = {
    padding: '6px 10px', background: '#111827', border: '1px solid rgba(148,163,184,0.12)',
    borderRadius: 3, color: '#cbd5e1', fontSize: 11, outline: 'none',
}
const addBtnStyle = {
    padding: '6px 14px', borderRadius: 3, border: 'none',
    background: '#60a5fa', color: '#0f172a', cursor: 'pointer', fontSize: 11, fontWeight: 600,
}

// ── Context Menu ───────────────────────────────────────────────────────────────
function ContextMenu({ x, y, items, onClose }) {
    useEffect(() => {
        const handler = () => onClose()
        setTimeout(() => document.addEventListener('click', handler), 0)
        return () => document.removeEventListener('click', handler)
    }, [onClose])

    return (
        <div style={{
            position: 'fixed', left: x, top: y, zIndex: 200,
            background: '#151d2b', border: '1px solid rgba(148,163,184,0.12)',
            borderRadius: 4, overflow: 'hidden', minWidth: 160,
        }}>
            {items.map((item, i) => (
                <button key={i} onClick={item.action} style={{
                    display: 'block', width: '100%', padding: '7px 14px', border: 'none',
                    background: 'transparent', color: item.danger ? '#f87171' : '#cbd5e1',
                    fontSize: 11, textAlign: 'left', cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    {item.label}
                </button>
            ))}
        </div>
    )
}

// ── Add Node Dialog ────────────────────────────────────────────────────────────
const NODE_TEMPLATES = [
    { column: 0, type: 'source',       label: 'Custom CSV Feed',     status: 'configured' },
    { column: 0, type: 'source',       label: 'Custom API Feed',     status: 'configured' },
    { column: 0, type: 'source',       label: 'Custom KML/GeoJSON',  status: 'configured' },
    { column: 0, type: 'source',       label: 'Twitter/X OSINT',     status: 'inactive'   },
    { column: 0, type: 'source',       label: 'Telegram Monitor',    status: 'inactive'   },
    { column: 1, type: 'detector',     label: 'Custom Rule Engine',  status: 'configured' },
    { column: 1, type: 'detector',     label: 'Anomaly Detector',    status: 'configured' },
    { column: 2, type: 'enrichment',   label: 'Custom Enrichment',   status: 'configured' },
    { column: 2, type: 'enrichment',   label: 'Claude NLP Analyzer', status: 'configured' },
    { column: 3, type: 'intelligence', label: 'Custom Scorer',       status: 'configured' },
    { column: 4, type: 'output',       label: 'Custom Webhook',      status: 'configured' },
    { column: 4, type: 'output',       label: 'Email Alerts',        status: 'configured' },
    { column: 4, type: 'output',       label: 'Slack Integration',   status: 'inactive'   },
]

function AddNodeDialog({ onAdd, onClose }) {
    const [label, setLabel]   = useState('')
    const [column, setColumn] = useState(0)
    const TYPES = ['source', 'detector', 'enrichment', 'intelligence', 'output']

    return (
        <div onClick={onClose} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 150,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            <div onClick={e => e.stopPropagation()} style={{
                background: '#0f1219', border: '1px solid rgba(148,163,184,0.1)',
                borderRadius: 6, padding: 20, width: 480, maxHeight: '70vh', overflow: 'auto',
            }}>
                <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Add Pipeline Node</div>

                <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', marginBottom: 6 }}>Templates</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 16 }}>
                    {NODE_TEMPLATES.map((tmpl, i) => (
                        <button key={i} onClick={() => onAdd({
                            id: `custom_${Date.now()}_${i}`, label: tmpl.label,
                            column: tmpl.column, type: tmpl.type,
                            status: tmpl.status, custom: true, config: {},
                        })} style={{
                            padding: '8px 10px', borderRadius: 3,
                            border: '1px solid rgba(148,163,184,0.08)',
                            background: '#111827', color: '#cbd5e1',
                            cursor: 'pointer', textAlign: 'left', fontSize: 11,
                        }}>
                            <span style={{ color: TYPE_COLORS[tmpl.type], fontSize: 8, textTransform: 'uppercase', display: 'block' }}>{tmpl.type}</span>
                            {tmpl.label}
                        </button>
                    ))}
                </div>

                <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', marginBottom: 6 }}>Custom Node</div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <input value={label} onChange={e => setLabel(e.target.value)}
                        placeholder="Node name" style={{ flex: 1, ...inputStyle }} />
                    <select value={column} onChange={e => setColumn(parseInt(e.target.value))}
                        style={{ width: 120, ...inputStyle }}>
                        {['Source', 'Detector', 'Enrichment', 'Intelligence', 'Output'].map((t, i) => (
                            <option key={i} value={i}>{t}</option>
                        ))}
                    </select>
                    <button onClick={() => {
                        if (!label.trim()) return
                        onAdd({
                            id: `custom_${Date.now()}`, label: label.trim(),
                            column, type: TYPES[column],
                            status: 'configured', custom: true, config: {},
                        })
                    }} style={addBtnStyle}>Add</button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                    <button onClick={onClose} style={{
                        padding: '6px 14px', borderRadius: 3,
                        border: '1px solid rgba(148,163,184,0.1)',
                        background: 'transparent', color: '#475569', cursor: 'pointer', fontSize: 11,
                    }}>Close</button>
                </div>
            </div>
        </div>
    )
}

// ── Main Canvas ────────────────────────────────────────────────────────────────
export default function PipelineCanvas({ initialNodes, initialEdges, brainStatus, onNodeClick }) {
    const canvasRef = useRef(null)
    const [nodes, setNodes]               = useState(initialNodes)
    const [edges, setEdges]               = useState(initialEdges)
    const [selectedNode, setSelectedNode] = useState(null)
    const [selectedEdge, setSelectedEdge] = useState(null)
    const [hoveredNode, setHoveredNode]   = useState(null)
    const [hoveredPort, setHoveredPort]   = useState(null)
    const [draggingNode, setDraggingNode] = useState(null)
    const [drawingEdge, setDrawingEdge]   = useState(null)
    const [contextMenu, setContextMenu]   = useState(null)
    const [pan, setPan]     = useState({ x: 24, y: 0 })
    const [zoom, setZoom]   = useState(1)
    const [isPanning, setIsPanning]   = useState(false)
    const [panStart, setPanStart]     = useState(null)
    const [showAddNode, setShowAddNode] = useState(false)
    const [dirty, setDirty] = useState(false)

    // Sync if parent loads saved pipeline after mount
    useEffect(() => { setNodes(initialNodes) }, [initialNodes])
    useEffect(() => { setEdges(initialEdges) }, [initialEdges])

    // Auto-save (debounced 1 s)
    useEffect(() => {
        if (!dirty) return
        const t = setTimeout(() => {
            fetch(`${API}/api/forge/pipeline/save`, {
                method: 'POST', headers: forgeHeaders(),
                body: JSON.stringify({ nodes, edges }),
            }).then(() => setDirty(false)).catch(console.error)
        }, 1000)
        return () => clearTimeout(t)
    }, [nodes, edges, dirty])

    // Keyboard delete
    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
            if (selectedNode) deleteNode(selectedNode)
            else if (selectedEdge) deleteEdge(selectedEdge)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [selectedNode, selectedEdge]) // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Position helpers ──────────────────────────────────────────────────────
    function getNodePos(node) {
        if (node.customX !== undefined) return { x: node.customX, y: node.customY }
        const col = nodes.filter(n => n.column === node.column)
        const idx = col.findIndex(n => n.id === node.id)
        return { x: COLUMN_X[node.column] ?? PADDING, y: 50 + idx * 56 }
    }

    function outPort(node) {
        const p = getNodePos(node)
        return { x: p.x + NODE_WIDTH, y: p.y + NODE_HEIGHT / 2 }
    }

    function inPort(node) {
        const p = getNodePos(node)
        return { x: p.x, y: p.y + NODE_HEIGHT / 2 }
    }

    // ─── Hit testing ──────────────────────────────────────────────────────────
    function nodeAt(cx, cy) {
        for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i], p = getNodePos(n)
            if (cx >= p.x && cx <= p.x + NODE_WIDTH && cy >= p.y && cy <= p.y + NODE_HEIGHT) return n
        }
        return null
    }

    function portAt(cx, cy) {
        for (const n of nodes) {
            if (n.column < 4) {
                const op = outPort(n)
                if (Math.hypot(cx - op.x, cy - op.y) < 8) return { node: n, type: 'output' }
            }
            if (n.column > 0) {
                const ip = inPort(n)
                if (Math.hypot(cx - ip.x, cy - ip.y) < 8) return { node: n, type: 'input' }
            }
        }
        return null
    }

    function edgeAt(cx, cy) {
        for (const edge of edges) {
            const fn = nodes.find(n => n.id === edge.from)
            const tn = nodes.find(n => n.id === edge.to)
            if (!fn || !tn) continue
            const f = outPort(fn), t = inPort(tn)
            if (Math.hypot(cx - (f.x + t.x) / 2, cy - (f.y + t.y) / 2) < 15) return edge
        }
        return null
    }

    function toCanvas(clientX, clientY) {
        const r = canvasRef.current.getBoundingClientRect()
        return { x: (clientX - r.left - pan.x) / zoom, y: (clientY - r.top - pan.y) / zoom }
    }

    // ─── Operations ───────────────────────────────────────────────────────────
    function deleteNode(nodeId) {
        setNodes(p => p.filter(n => n.id !== nodeId))
        setEdges(p => p.filter(e => e.from !== nodeId && e.to !== nodeId))
        if (selectedNode === nodeId) setSelectedNode(null)
        setDirty(true)
        setContextMenu(null)
        fetch(`${API}/api/forge/pipeline/delete-node`, {
            method: 'POST', headers: forgeHeaders(), body: JSON.stringify({ node_id: nodeId }),
        }).catch(() => {})
    }

    function deleteEdge(edge) {
        setEdges(p => p.filter(e => !(e.from === edge.from && e.to === edge.to)))
        setSelectedEdge(null)
        setDirty(true)
        setContextMenu(null)
        fetch(`${API}/api/forge/pipeline/delete-edge`, {
            method: 'POST', headers: forgeHeaders(), body: JSON.stringify({ from: edge.from, to: edge.to }),
        }).catch(() => {})
    }

    function toggleNodeStatus(node) {
        const newStatus = node.status === 'active' ? 'inactive' : 'active'
        setNodes(p => p.map(n => n.id === node.id ? { ...n, status: newStatus } : n))
        setDirty(true)
        fetch(`${API}/api/forge/pipeline/toggle-node`, {
            method: 'POST', headers: forgeHeaders(),
            body: JSON.stringify({ node_id: node.id, status: newStatus }),
        }).catch(() => {})
    }

    function duplicateNode(node) {
        const pos = getNodePos(node)
        setNodes(p => [...p, {
            ...node, id: `${node.id}_copy_${Date.now()}`,
            label: `${node.label} (copy)`, customX: pos.x + 20, customY: pos.y + 60,
        }])
        setDirty(true)
    }

    function autoArrange() {
        setNodes(p => p.map(({ customX, customY, ...rest }) => rest))
        setDirty(true)
    }

    // ─── Event handlers ───────────────────────────────────────────────────────
    function handleMouseDown(e) {
        const { x, y } = toCanvas(e.clientX, e.clientY)
        setContextMenu(null)

        const port = portAt(x, y)
        if (port?.type === 'output') {
            setDrawingEdge({ from: port.node.id, mouseX: x, mouseY: y })
            return
        }

        const node = nodeAt(x, y)
        if (node) {
            const pos = getNodePos(node)
            setDraggingNode({ id: node.id, offsetX: x - pos.x, offsetY: y - pos.y })
            setSelectedNode(node.id)
            setSelectedEdge(null)
            return
        }

        const edge = edgeAt(x, y)
        if (edge) {
            setSelectedEdge(edge)
            setSelectedNode(null)
            return
        }

        setIsPanning(true)
        setPanStart({ x: e.clientX, y: e.clientY })
        setSelectedNode(null)
        setSelectedEdge(null)
    }

    function handleMouseMove(e) {
        if (draggingNode) {
            const { x, y } = toCanvas(e.clientX, e.clientY)
            setNodes(p => p.map(n => n.id === draggingNode.id
                ? { ...n, customX: x - draggingNode.offsetX, customY: y - draggingNode.offsetY } : n))
            setDirty(true)
            return
        }

        if (drawingEdge) {
            const { x, y } = toCanvas(e.clientX, e.clientY)
            setDrawingEdge(p => ({ ...p, mouseX: x, mouseY: y }))
            setHoveredPort(portAt(x, y))
            return
        }

        if (isPanning && panStart) {
            setPan(p => ({ x: p.x + e.clientX - panStart.x, y: p.y + e.clientY - panStart.y }))
            setPanStart({ x: e.clientX, y: e.clientY })
            return
        }

        const { x, y } = toCanvas(e.clientX, e.clientY)
        setHoveredPort(portAt(x, y))
        setHoveredNode(nodeAt(x, y)?.id ?? null)
    }

    function handleMouseUp(e) {
        if (drawingEdge) {
            if (e.type !== 'mouseleave') {
                const { x, y } = toCanvas(e.clientX, e.clientY)
                const port = portAt(x, y)
                if (port?.type === 'input' && port.node.id !== drawingEdge.from) {
                    const newEdge = { from: drawingEdge.from, to: port.node.id, id: `e_${Date.now()}` }
                    if (!edges.some(ex => ex.from === newEdge.from && ex.to === newEdge.to)) {
                        setEdges(p => [...p, newEdge])
                        setDirty(true)
                    }
                }
            }
            setDrawingEdge(null)
            return
        }
        setDraggingNode(null)
        setIsPanning(false)
        setPanStart(null)
    }

    function handleDoubleClick(e) {
        const { x, y } = toCanvas(e.clientX, e.clientY)
        const node = nodeAt(x, y)
        if (node && onNodeClick) onNodeClick(node.id, node)
    }

    function handleContextMenu(e) {
        e.preventDefault()
        const { x, y } = toCanvas(e.clientX, e.clientY)
        const node = nodeAt(x, y)
        if (node) { setContextMenu({ x: e.clientX, y: e.clientY, type: 'node', target: node }); return }
        const edge = edgeAt(x, y)
        if (edge) { setContextMenu({ x: e.clientX, y: e.clientY, type: 'edge', target: edge }); return }
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'canvas' })
    }

    function handleWheel(e) {
        e.preventDefault()
        setZoom(p => Math.max(0.4, Math.min(2.5, p * (e.deltaY > 0 ? 0.92 : 1.08))))
    }

    function getMenuItems(cm) {
        if (cm.type === 'node') return [
            { label: 'Open Workspace', action: () => { onNodeClick?.(cm.target.id, cm.target); setContextMenu(null) } },
            { label: 'Duplicate', action: () => { duplicateNode(cm.target); setContextMenu(null) } },
            { label: cm.target.status === 'active' ? 'Disable' : 'Enable', action: () => { toggleNodeStatus(cm.target); setContextMenu(null) } },
            { label: 'Delete', action: () => deleteNode(cm.target.id), danger: true },
        ]
        if (cm.type === 'edge') return [
            { label: 'Remove Connection', action: () => deleteEdge(cm.target), danger: true },
        ]
        return [
            { label: 'Add Node…', action: () => { setShowAddNode(true); setContextMenu(null) } },
            { label: 'Auto-Arrange', action: () => { autoArrange(); setContextMenu(null) } },
            { label: 'Reset View', action: () => { setZoom(1); setPan({ x: 24, y: 0 }); setContextMenu(null) } },
        ]
    }

    // ─── Canvas draw (runs on every render) ───────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx    = canvas.getContext('2d')
        const parent = canvas.parentElement
        const W = parent.clientWidth
        const H = parent.clientHeight
        const DPR = window.devicePixelRatio || 1
        canvas.width  = W * DPR
        canvas.height = H * DPR
        canvas.style.width  = W + 'px'
        canvas.style.height = H + 'px'
        ctx.scale(DPR, DPR)
        ctx.clearRect(0, 0, W, H)
        ctx.save()
        ctx.translate(pan.x, pan.y)
        ctx.scale(zoom, zoom)

        // Column headers + separators
        COLUMN_LABELS.forEach((label, i) => {
            ctx.fillStyle = '#334155'
            ctx.font = '500 9px system-ui'
            ctx.letterSpacing = '0.1em'
            ctx.fillText(label, COLUMN_X[i], PADDING - 10)
            if (i > 0) {
                ctx.beginPath()
                ctx.moveTo(COLUMN_X[i] - COLUMN_GAP / 2, PADDING - 28)
                ctx.lineTo(COLUMN_X[i] - COLUMN_GAP / 2, H / zoom)
                ctx.strokeStyle = 'rgba(148,163,184,0.04)'
                ctx.lineWidth   = 1
                ctx.setLineDash([])
                ctx.stroke()
            }
        })

        // Edges
        for (const edge of edges) {
            const fn = nodes.find(n => n.id === edge.from)
            const tn = nodes.find(n => n.id === edge.to)
            if (!fn || !tn) continue
            const from = outPort(fn), to = inPort(tn)
            const isSel = selectedEdge && selectedEdge.from === edge.from && selectedEdge.to === edge.to
            const isHov = hoveredNode && (edge.from === hoveredNode || edge.to === hoveredNode)
            const cpX   = (from.x + to.x) / 2

            ctx.beginPath()
            ctx.moveTo(from.x, from.y)
            ctx.bezierCurveTo(cpX, from.y, cpX, to.y, to.x, to.y)
            ctx.strokeStyle = isSel ? '#60a5fa' : isHov ? 'rgba(96,165,250,0.4)' : 'rgba(148,163,184,0.1)'
            ctx.lineWidth   = isSel ? 2 : 1
            ctx.setLineDash([])
            ctx.stroke()

            ctx.beginPath()
            ctx.moveTo(to.x, to.y)
            ctx.lineTo(to.x - 5, to.y - 3)
            ctx.lineTo(to.x - 5, to.y + 3)
            ctx.closePath()
            ctx.fillStyle = isSel ? '#60a5fa' : isHov ? 'rgba(96,165,250,0.4)' : 'rgba(148,163,184,0.1)'
            ctx.fill()
        }

        // In-progress edge preview
        if (drawingEdge) {
            const fn = nodes.find(n => n.id === drawingEdge.from)
            if (fn) {
                const from = outPort(fn)
                ctx.beginPath()
                ctx.moveTo(from.x, from.y)
                ctx.lineTo(drawingEdge.mouseX, drawingEdge.mouseY)
                ctx.strokeStyle = '#60a5fa'
                ctx.lineWidth   = 1.5
                ctx.setLineDash([4, 4])
                ctx.stroke()
                ctx.setLineDash([])
            }
        }

        // Nodes
        for (const node of nodes) {
            const pos   = getNodePos(node)
            const isSel = selectedNode === node.id
            const isHov = hoveredNode  === node.id
            const color = TYPE_COLORS[node.type] || '#475569'
            const { x, y } = pos

            if (isSel) { ctx.shadowColor = color + '40'; ctx.shadowBlur = 8 }
            ctx.fillStyle = isSel ? '#1a2332' : isHov ? '#151d2b' : '#111827'
            roundRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, 4)
            ctx.fill()
            ctx.strokeStyle = isSel ? color : isHov ? color + '40' : 'rgba(148,163,184,0.08)'
            ctx.lineWidth   = isSel ? 1.5 : 1
            roundRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, 4)
            ctx.stroke()
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0

            ctx.fillStyle = color
            ctx.fillRect(x + 1, y + 4, 2, NODE_HEIGHT - 8)

            ctx.beginPath()
            ctx.arc(x + NODE_WIDTH - 10, y + 10, 3, 0, Math.PI * 2)
            ctx.fillStyle = STATUS_DOT[node.status] || '#475569'
            ctx.fill()

            ctx.fillStyle = isSel || isHov ? '#e2e8f0' : '#cbd5e1'
            ctx.font = '600 11px system-ui'
            ctx.letterSpacing = '0'
            ctx.fillText(truncate(node.label, 22), x + 10, y + 18)

            const sub = getNodeSubtitle(node, brainStatus)
            if (sub) {
                ctx.fillStyle = '#334155'
                ctx.font      = '9px system-ui'
                ctx.fillText(sub, x + 10, y + 32)
            }

            // Output port (right edge)
            if (node.column < 4) {
                const op  = outPort(node)
                const hov = hoveredPort?.node?.id === node.id && hoveredPort?.type === 'output'
                ctx.beginPath()
                ctx.arc(op.x, op.y, hov ? 5 : 3, 0, Math.PI * 2)
                ctx.fillStyle   = hov ? '#60a5fa' : '#1e293b'
                ctx.strokeStyle = hov ? '#60a5fa' : '#334155'
                ctx.lineWidth = 1; ctx.fill(); ctx.stroke()
            }

            // Input port (left edge)
            if (node.column > 0) {
                const ip  = inPort(node)
                const hov = hoveredPort?.node?.id === node.id && hoveredPort?.type === 'input'
                ctx.beginPath()
                ctx.arc(ip.x, ip.y, hov ? 5 : 3, 0, Math.PI * 2)
                ctx.fillStyle   = hov ? '#60a5fa' : '#1e293b'
                ctx.strokeStyle = hov ? '#60a5fa' : '#334155'
                ctx.lineWidth = 1; ctx.fill(); ctx.stroke()
            }
        }

        ctx.restore()
    })

    const cursor = draggingNode ? 'grabbing' : drawingEdge ? 'crosshair' : isPanning ? 'grabbing' : 'default'

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <canvas ref={canvasRef}
                style={{ width: '100%', height: '100%', display: 'block', cursor }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
                onWheel={handleWheel}
            />

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x} y={contextMenu.y}
                    items={getMenuItems(contextMenu)}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {showAddNode && (
                <AddNodeDialog
                    onAdd={(n) => { setNodes(p => [...p, n]); setDirty(true); setShowAddNode(false) }}
                    onClose={() => setShowAddNode(false)}
                />
            )}

            <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
                <button onClick={() => setShowAddNode(true)} style={toolbarBtnStyle}>+ Add Node</button>
                <button onClick={() => { setZoom(1); setPan({ x: 24, y: 0 }) }} style={toolbarBtnStyle}>Reset View</button>
            </div>

            {dirty && (
                <div style={{
                    position: 'absolute', bottom: 8, right: 8, color: '#fbbf24',
                    fontSize: 10, background: '#111827', padding: '3px 8px', borderRadius: 3,
                }}>Saving…</div>
            )}

            <div style={{ position: 'absolute', bottom: 8, left: 8, color: '#1e293b', fontSize: 9, pointerEvents: 'none' }}>
                Double-click: open · Drag: move · Port→port: connect · Right-click: menu · Delete key: remove
            </div>
        </div>
    )
}
