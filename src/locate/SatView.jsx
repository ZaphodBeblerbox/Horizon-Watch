/**
 * SatView.jsx — a small satellite map to match a frame against.
 *
 * Esri World Imagery tiles (the sharpest free imagery there is, sub-metre in
 * most towns; not current), laid out by hand on Web Mercator so the
 * workbench can draw on it without a globe. Drag pans; the wheel and the
 * buttons zoom. With a tool active, a click places the filming spot and a
 * drag draws a direction (a shadow, or the way a vehicle moved).
 */
import { useEffect, useRef, useState } from "react"

const TILE = 256
const URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile"
const MAX_Z = 19, MIN_Z = 4

export function project(lat, lon, z) {
    const s = TILE * 2 ** z
    const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
    return { x: ((lon + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s }
}

export function unproject(x, y, z) {
    const s = TILE * 2 ** z
    const lon = (x / s) * 360 - 180
    const n = Math.PI - (2 * Math.PI * y) / s
    return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon }
}

const ARROW = { shadow: "#C9CED6", motion: "#FFB300" }

export default function SatView({ center, zoom = 16, onView, pin, candidates = [], arrows = {}, tool, onPin, onArrow, height = 380 }) {
    const box = useRef(null)
    const [w, setW] = useState(600)
    const [drag, setDrag] = useState(null)        // {kind: "pan"|"arrow", ...}
    useEffect(() => {
        const el = box.current
        if (!el) return undefined
        const ro = new ResizeObserver(() => setW(el.clientWidth || 600))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])
    const c = project(center.lat, center.lon, zoom)
    const ox = c.x - w / 2, oy = c.y - height / 2
    const toPx = (p) => { const q = project(p.lat, p.lon, zoom); return { x: q.x - ox, y: q.y - oy } }
    const toLL = (x, y) => unproject(x + ox, y + oy, zoom)
    const local = (e) => { const r = box.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

    const tiles = []
    const n = 2 ** zoom
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + w) / TILE); tx++) {
        for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + height) / TILE); ty++) {
            if (ty < 0 || ty >= n) continue
            const wx = ((tx % n) + n) % n
            tiles.push(<img key={`${tx}/${ty}`} alt="" draggable={false} src={`${URL}/${zoom}/${ty}/${wx}`}
                style={{ position: "absolute", left: tx * TILE - ox, top: ty * TILE - oy, width: TILE, height: TILE, userSelect: "none" }} />)
        }
    }

    const down = (e) => {
        const p = local(e)
        e.currentTarget.setPointerCapture?.(e.pointerId)
        if (tool === "shadow" || tool === "motion") setDrag({ kind: "arrow", a: toLL(p.x, p.y), b: toLL(p.x, p.y), tool })
        else setDrag({ kind: "pan", sx: p.x, sy: p.y, center, moved: false })
    }
    const move = (e) => {
        if (!drag) return
        const p = local(e)
        if (drag.kind === "arrow") setDrag({ ...drag, b: toLL(p.x, p.y) })
        else {
            const dx = p.x - drag.sx, dy = p.y - drag.sy
            if (Math.abs(dx) + Math.abs(dy) > 3) {
                const sc = project(drag.center.lat, drag.center.lon, zoom)
                onView({ center: unproject(sc.x - dx, sc.y - dy, zoom), zoom })
                if (!drag.moved) setDrag({ ...drag, moved: true })
            }
        }
    }
    const up = (e) => {
        if (!drag) return
        const p = local(e)
        if (drag.kind === "arrow") {
            const b = toLL(p.x, p.y)
            const a = toPx(drag.a)
            if (Math.hypot(p.x - a.x, p.y - a.y) > 8) onArrow(drag.tool, { a: drag.a, b })
        } else if (!drag.moved && tool === "pin") onPin(toLL(p.x, p.y))
        setDrag(null)
    }
    const wheel = (e) => {
        const z = Math.max(MIN_Z, Math.min(MAX_Z, zoom + (e.deltaY < 0 ? 1 : -1)))
        if (z !== zoom) onView({ center, zoom: z })
    }
    const live = { ...arrows, ...(drag?.kind === "arrow" ? { [drag.tool]: { a: drag.a, b: drag.b } } : {}) }
    const P = pin ? toPx(pin) : null

    return (
        <div ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onWheel={wheel}
            style={{ position: "relative", height, overflow: "hidden", background: "#111", touchAction: "none",
                     cursor: tool === "pin" ? "crosshair" : tool ? "crosshair" : drag ? "grabbing" : "grab" }}>
            {tiles}
            <svg width={w} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                <defs>
                    {Object.entries(ARROW).map(([k, col]) => (
                        <marker key={k} id={`sv-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                            <path d="M0 0L10 5L0 10z" fill={col} />
                        </marker>
                    ))}
                </defs>
                {candidates.map((cd, i) => {
                    const q = toPx(cd)
                    return (
                        <g key={i}>
                            <circle cx={q.x} cy={q.y} r={9} fill="rgba(0,0,0,.55)" stroke="#8FB4E8" strokeWidth={2} />
                            <text x={q.x} y={q.y + 4} textAnchor="middle" fill="#fff" style={{ font: "600 10px var(--mono, monospace)" }}>{i + 1}</text>
                        </g>
                    )
                })}
                {Object.entries(live).map(([k, ar]) => {
                    if (!ar) return null
                    const a = toPx(ar.a), b = toPx(ar.b)
                    return <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ARROW[k]} strokeWidth={3}
                        markerEnd={`url(#sv-${k})`} style={{ filter: "drop-shadow(0 0 2px rgba(0,0,0,.8))" }} />
                })}
                {P && (
                    <g>
                        <circle cx={P.x} cy={P.y} r={11} fill="none" stroke="#000" strokeOpacity=".6" strokeWidth={5} />
                        <circle cx={P.x} cy={P.y} r={11} fill="none" stroke="#FF3B30" strokeWidth={2.5} />
                        <circle cx={P.x} cy={P.y} r={2.5} fill="#FF3B30" />
                    </g>
                )}
            </svg>
            <div style={{ position: "absolute", right: 8, top: 8, display: "flex", flexDirection: "column", gap: 2 }}>
                {[["+", 1], ["−", -1]].map(([t, d]) => (
                    <button key={t} onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onView({ center, zoom: Math.max(MIN_Z, Math.min(MAX_Z, zoom + d)) })}
                        style={{ width: 26, height: 26, border: 0, background: "rgba(0,0,0,.6)", color: "#fff", cursor: "pointer", font: "600 14px var(--font)" }}>{t}</button>
                ))}
            </div>
            <span style={{ position: "absolute", left: 8, bottom: 6, font: "10px var(--mz-font-mono, monospace)", color: "#fff",
                           textShadow: "0 1px 3px #000" }}>
                Esri World Imagery · sharpest available, not current · z{zoom}
            </span>
        </div>
    )
}
