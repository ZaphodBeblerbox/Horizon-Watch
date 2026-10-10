/**
 * OntologyGraph.jsx — one thing's ontology, drawn: the thing in the middle,
 * what it connects to around it.
 *
 * Each kind has a shape AND a colour, so identity never rests on colour
 * alone: places are blue circles, actors (units, factions, organisations)
 * aqua squares, actions (signals, acts) orange triangles; objects
 * (vessels, equipment) diamonds, wars hexagons and sources rings, in
 * neutral ink. The three hues pass validate_palette.js on every pair, dark
 * and light. A counted node (membership: "963 vessels flagged in") is drawn
 * once with a dashed edge and its number, never as 963 dots. Inferred links
 * are dashed. Hover or focus any node for what it is and how it connects;
 * click one to walk to it. The overlay's copy pans (drag) and zooms (wheel).
 */
import { useMemo, useRef, useState } from "react"
import { radialLayout } from "./radialLayout.js"

export const KINDS = [
    { key: "action", label: "Action / signal", color: "var(--on-action)", shape: "tri" },
    { key: "conflict", label: "War", color: "var(--on-neutral)", shape: "hex" },
    { key: "actor", label: "Unit / actor", color: "var(--on-actor)", shape: "sq" },
    { key: "place", label: "Place", color: "var(--on-place)", shape: "circle" },
    { key: "object", label: "Object", color: "var(--on-neutral)", shape: "dia" },
    { key: "source", label: "Source", color: "var(--on-neutral)", shape: "ring" },
]
const KIND = Object.fromEntries(KINDS.map((k) => [k.key, k]))

// Validated: dark #3987e5,#d95926,#24a89c and light #2a78d6,#d4561f,#138a5f,
// all pairs, all checks pass.
export const ONTOLOGY_CSS = `
:root { --on-place:#3987e5; --on-action:#d95926; --on-actor:#24a89c; --on-neutral:#c3c8d4; }
:root[data-theme="light"] { --on-place:#2a78d6; --on-action:#d4561f; --on-actor:#138a5f; --on-neutral:#4a5263; }
`

export function Shape({ kind, r, x = 0, y = 0, hollow = false, strokeW = 1.5 }) {
    const k = KIND[kind] || KIND.object
    const fill = hollow || k.shape === "ring" ? "var(--canvas, #10131b)" : k.color
    const common = { fill, stroke: k.color, strokeWidth: strokeW, vectorEffect: "non-scaling-stroke" }
    if (k.shape === "circle" || k.shape === "ring") return <circle cx={x} cy={y} r={r} {...common} />
    if (k.shape === "sq") return <rect x={x - r * 0.88} y={y - r * 0.88} width={r * 1.76} height={r * 1.76} rx={1.5} {...common} />
    if (k.shape === "dia") return <path d={`M${x},${y - r * 1.15} L${x + r * 1.15},${y} L${x},${y + r * 1.15} L${x - r * 1.15},${y} Z`} {...common} />
    if (k.shape === "tri") return <path d={`M${x},${y - r * 1.15} L${x + r * 1.1},${y + r * 0.8} L${x - r * 1.1},${y + r * 0.8} Z`} {...common} strokeLinejoin="round" />
    const pts = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + (i * Math.PI) / 3; return `${x + r * 1.05 * Math.cos(a)},${y + r * 1.05 * Math.sin(a)}` })
    return <polygon points={pts.join(" ")} {...common} />
}

export function Legend({ graph }) {
    const present = new Set([graph?.root?.group, ...(graph?.nodes || []).map((n) => n.group)])
    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
            {KINDS.filter((k) => present.has(k.key)).map((k) => (
                <span key={k.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>
                    <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true"><Shape kind={k.key} r={4} /></svg>{k.label}
                </span>
            ))}
            {(graph?.links || []).some((l) => l.inferred) && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>
                    <svg width="16" height="6" aria-hidden="true"><line x1="0" x2="16" y1="3" y2="3" stroke="var(--txt-3)" strokeDasharray="3 2" /></svg>inferred
                </span>
            )}
        </div>
    )
}

const short = (s, n) => { const t = String(s || ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

export default function OntologyGraph({ graph, height = 230, width = 320, big = false, selected = null, onPick = null, labelChars = 18 }) {
    const W = width, H = height
    const { pos } = useMemo(() => radialLayout(graph, { w: W, h: H, pad: big ? 70 : 30, ring: big ? 0.78 : 0.62 }), [graph, W, H, big])
    const [hover, setHover] = useState(null)
    const [view, setView] = useState({ k: 1, x: 0, y: 0 })
    const drag = useRef(null)
    const svgRef = useRef(null)
    if (!graph?.root) return null
    const rootId = graph.root.id
    const all = [graph.root, ...(graph.nodes || [])]
    const byId = new Map(all.map((n) => [n.id, n]))
    const links = (graph.links || []).filter((l) => pos.has(l.src) && pos.has(l.dst))
    const lit = hover ? new Set([hover, ...links.filter((l) => l.src === hover || l.dst === hover).flatMap((l) => [l.src, l.dst])]) : null
    const many = (graph.nodes || []).length > (big ? 60 : 12)
    const relTo = (id) => links.find((l) => (l.src === id && l.dst === rootId) || (l.dst === id && l.src === rootId))
        || links.find((l) => l.src === id || l.dst === id)

    // pan and zoom, the overlay only
    const onWheel = big ? (e) => {
        const r = svgRef.current.getBoundingClientRect()
        const mx = ((e.clientX - r.left) / r.width) * W, my = ((e.clientY - r.top) / r.height) * H
        setView((v) => {
            const k = Math.min(4, Math.max(0.5, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
            return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k }
        })
    } : undefined
    const onDown = big ? (e) => { drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false } } : undefined
    const onMove = big ? (e) => {
        const d = drag.current
        if (!d) return
        const r = svgRef.current.getBoundingClientRect()
        const dx = ((e.clientX - d.x) / r.width) * W, dy = ((e.clientY - d.y) / r.height) * H
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
        if (d.moved) setView({ ...d.v, x: d.v.x + dx, y: d.v.y + dy })
    } : undefined
    const onUp = big ? () => { setTimeout(() => { drag.current = null }, 0) } : undefined

    const h = hover ? byId.get(hover) : null
    const hl = h && h.id !== rootId ? relTo(h.id) : null
    const hp = h ? pos.get(h.id) : null
    return (
        <div className="plx-onto" style={{ position: "relative", width: "100%" }}>
            <style>{ONTOLOGY_CSS}</style>
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", aspectRatio: `${W} / ${H}`, cursor: big ? "grab" : "default", touchAction: big ? "none" : "auto" }}
                 role="img" aria-label={`Ontology of ${graph.root.label}`}
                 onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
                <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                    {links.map((l, i) => {
                        const a = pos.get(l.src), b = pos.get(l.dst)
                        const on = lit && lit.has(l.src) && lit.has(l.dst) && (l.src === hover || l.dst === hover)
                        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke"
                                     stroke={on ? "var(--acc-hi, var(--acchi))" : "var(--gline2)"} strokeWidth={on ? 1.6 : 1}
                                     strokeDasharray={l.inferred || l.count ? "4 3" : undefined} opacity={lit && !on ? 0.25 : 1} />
                    })}
                    {all.map((n) => {
                        const p = pos.get(n.id)
                        if (!p) return null
                        const isRoot = n.id === rootId
                        const r = isRoot ? (big ? 11 : 8) : n.count ? (big ? 8 : 6) : p.ring === 2 ? (big ? 5 : 4) : (big ? 7 : 5.5)
                        const showLabel = (isRoot && big) || n.id === hover || n.id === selected || (!many && p.ring === 1)
                            || (big && (graph.nodes || []).length <= 40)
                        // beside a node on the left or right of the ring, above
                        // or below one at its top or bottom: never across the middle
                        const cos = Math.cos(p.angle), sin = Math.sin(p.angle)
                        const side = isRoot ? "below" : Math.abs(cos) < 0.4 ? (sin < 0 ? "above" : "below") : cos > 0 ? "right" : "left"
                        const right = side === "right"
                        const dim = lit && !lit.has(n.id)
                        const walkable = !!n.walk && !isRoot
                        return (
                            <g key={n.id} opacity={dim ? 0.3 : 1} tabIndex={0} role="button"
                               aria-label={`${n.label} — ${KIND[n.group]?.label || n.type}${walkable ? ", open" : ""}`}
                               style={{ cursor: walkable || n.count ? "pointer" : "default", outline: "none" }}
                               onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}
                               onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
                               onClick={() => { if (!drag.current?.moved) onPick?.(n) }}
                               onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick?.(n) } }}>
                                <circle cx={p.x} cy={p.y} r={r + 8} fill="transparent" />
                                {(isRoot || n.id === selected) && <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke="var(--acc-hi, var(--acchi))" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
                                <Shape kind={n.group} r={r} x={p.x} y={p.y} hollow={!!n.count} />
                                {showLabel && (
                                    <text x={side === "above" || side === "below" ? p.x : p.x + (right ? r + 5 : -(r + 5))}
                                          y={side === "below" ? p.y + r + (big ? 15 : 12) : side === "above" ? p.y - r - 6 : p.y + 3.5}
                                          textAnchor={side === "above" || side === "below" ? "middle" : right ? "start" : "end"}
                                          style={{ font: `${isRoot ? 600 : 400} ${big ? (isRoot ? 13 : 11) : (isRoot ? 11.5 : 10)}px var(--font)`, fill: isRoot ? "var(--txt)" : "var(--txt-2)",
                                                   paintOrder: "stroke", stroke: "var(--canvas, #10131b)", strokeWidth: 3, strokeLinejoin: "round", pointerEvents: "none" }}>
                                        {short(n.label, isRoot ? (big ? 60 : 34) : labelChars)}
                                    </text>
                                )}
                            </g>
                        )
                    })}
                </g>
            </svg>
            {h && hp && (
                <div role="tooltip" style={{
                    position: "absolute", left: `${Math.min(70, Math.max(0, ((hp.x * view.k + view.x) / W) * 100 - 15))}%`,
                    top: `${Math.min(88, ((hp.y * view.k + view.y) / H) * 100 + 4)}%`, maxWidth: 260, pointerEvents: "none", zIndex: 5,
                    padding: "6px 9px", background: "var(--glass, rgba(14,18,32,.94))", border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
                    backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                }}>
                    <div style={{ font: "600 12px var(--font)", color: "var(--txt)", overflowWrap: "anywhere" }}>{h.label}</div>
                    <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>{KIND[h.group]?.label || h.type}{h.type && h.type !== h.group ? ` · ${h.type}` : ""}</div>
                    {hl && <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-2)", marginTop: 2 }}>
                        {hl.relation}{hl.basis ? ` — ${hl.basis}` : ""}{hl.inferred ? " (inferred)" : ""}
                    </div>}
                    {h.sample?.length > 0 && <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)", marginTop: 2 }}>{h.sample.slice(0, 5).join(", ")}…</div>}
                    {(h.walk && h.id !== rootId) && <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginTop: 2 }}>Click to open its ontology</div>}
                </div>
            )}
        </div>
    )
}
