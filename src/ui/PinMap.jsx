/**
 * PinMap.jsx — a small map to put a pin on.
 *
 * Map tiles laid out by hand on Web Mercator (no globe, no library): the
 * dark map for finding your way, Esri World Imagery for recognising the
 * building. Drag pans, the wheel and the buttons zoom, a click puts the
 * pin there. Used to place an asset where it is (Assets.jsx); the address
 * of the pin is looked up by the caller.
 */
import { useEffect, useRef, useState } from "react"

const TILE = 256
const MAX_Z = 19, MIN_Z = 2
const BASES = {
    satellite: { label: "Satellite", url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}` },
    map: { label: "Map", url: (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}` },
}
const LABELS = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`

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

export default function PinMap({ center, zoom = 15, pin, onPin, radiusKm = null, height = 420 }) {
    const box = useRef(null)
    const [w, setW] = useState(800)
    const [view, setView] = useState({ center: center || { lat: 25, lon: 45 }, zoom: center ? zoom : 3 })
    const [base, setBase] = useState("satellite")
    const [drag, setDrag] = useState(null)
    useEffect(() => {
        const el = box.current
        if (!el) return undefined
        const ro = new ResizeObserver(() => setW(el.clientWidth || 800))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])
    // A new address recentres the map on it.
    useEffect(() => { if (center) setView((v) => ({ center, zoom: Math.max(v.zoom, zoom) })) }, [center?.lat, center?.lon]) // eslint-disable-line react-hooks/exhaustive-deps

    const z = view.zoom
    const c = project(view.center.lat, view.center.lon, z)
    const ox = c.x - w / 2, oy = c.y - height / 2
    const toPx = (p) => { const q = project(p.lat, p.lon, z); return { x: q.x - ox, y: q.y - oy } }
    const local = (e) => { const r = box.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

    const n = 2 ** z
    const tiles = []
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + w) / TILE); tx++) {
        for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + height) / TILE); ty++) {
            if (ty < 0 || ty >= n) continue
            const wx = ((tx % n) + n) % n
            const st = { position: "absolute", left: tx * TILE - ox, top: ty * TILE - oy, width: TILE, height: TILE, userSelect: "none", pointerEvents: "none" }
            tiles.push(<img key={`b${tx}/${ty}`} alt="" draggable={false} src={BASES[base].url(z, wx, ty)} style={st} />)
            if (base === "satellite") tiles.push(<img key={`l${tx}/${ty}`} alt="" draggable={false} src={LABELS(z, wx, ty)} style={st} />)
        }
    }

    const down = (e) => {
        const p = local(e)
        e.currentTarget.setPointerCapture?.(e.pointerId)
        setDrag({ sx: p.x, sy: p.y, center: view.center, moved: false })
    }
    const move = (e) => {
        if (!drag) return
        const p = local(e)
        const dx = p.x - drag.sx, dy = p.y - drag.sy
        if (Math.abs(dx) + Math.abs(dy) > 3) {
            const sc = project(drag.center.lat, drag.center.lon, z)
            setView({ center: unproject(sc.x - dx, sc.y - dy, z), zoom: z })
            if (!drag.moved) setDrag({ ...drag, moved: true })
        }
    }
    const up = (e) => {
        if (drag && !drag.moved && onPin) { const p = local(e); onPin(unproject(p.x + ox, p.y + oy, z)) }
        setDrag(null)
    }
    const wheel = (e) => {
        const nz = Math.max(MIN_Z, Math.min(MAX_Z, z + (e.deltaY < 0 ? 1 : -1)))
        if (nz === z) return
        // zoom about the cursor, as maps do
        const p = local(e)
        const at = unproject(p.x + ox, p.y + oy, z)
        const q = project(at.lat, at.lon, nz)
        setView({ center: unproject(q.x - p.x + w / 2, q.y - p.y + height / 2, nz), zoom: nz })
    }
    const P = pin ? toPx(pin) : null
    // the watch radius as a circle, in pixels at this latitude and zoom
    const rPx = P && radiusKm ? (radiusKm * 1000) / ((156543.03 * Math.cos((pin.lat * Math.PI) / 180)) / 2 ** z) : 0

    return (
        <div ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onWheel={wheel}
            style={{ position: "relative", height, overflow: "hidden", background: "#0d1117", touchAction: "none",
                     cursor: drag?.moved ? "grabbing" : "crosshair", border: "1px solid var(--gline)" }}>
            {tiles}
            <svg width={w} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                {P && rPx > 4 && <circle cx={P.x} cy={P.y} r={rPx} fill="rgba(122,167,255,.08)" stroke="rgba(122,167,255,.7)" strokeDasharray="5 4" strokeWidth={1.5} />}
                {P && (
                    <g transform={`translate(${P.x} ${P.y})`}>
                        <path d="M0 0 C -9 -14 -13 -20 -13 -27 A 13 13 0 1 1 13 -27 C 13 -20 9 -14 0 0 Z" fill="#FF3B30" stroke="#000" strokeOpacity=".5" strokeWidth="1.5" />
                        <circle cx="0" cy="-27" r="5" fill="#fff" />
                    </g>
                )}
            </svg>
            <div style={{ position: "absolute", right: 8, top: 8, display: "flex", flexDirection: "column", gap: 2 }}>
                {[["+", 1], ["−", -1]].map(([t, d]) => (
                    <button key={t} onPointerDown={(e) => e.stopPropagation()} aria-label={d > 0 ? "Zoom in" : "Zoom out"}
                        onClick={() => setView((v) => ({ ...v, zoom: Math.max(MIN_Z, Math.min(MAX_Z, v.zoom + d)) }))}
                        style={{ width: 28, height: 28, border: 0, background: "rgba(0,0,0,.62)", color: "#fff", cursor: "pointer", font: "600 15px var(--font)" }}>{t}</button>
                ))}
            </div>
            <div style={{ position: "absolute", left: 8, top: 8, display: "flex" }} onPointerDown={(e) => e.stopPropagation()}>
                {Object.entries(BASES).map(([k, b]) => (
                    <button key={k} onClick={() => setBase(k)} style={{
                        height: 26, padding: "0 10px", border: 0, cursor: "pointer", font: "500 11.5px var(--font)",
                        background: base === k ? "rgba(122,167,255,.85)" : "rgba(0,0,0,.62)", color: "#fff",
                    }}>{b.label}</button>
                ))}
            </div>
            <span style={{ position: "absolute", left: 8, bottom: 6, font: "10px var(--mz-font-mono, monospace)", color: "#fff", textShadow: "0 1px 3px #000", pointerEvents: "none" }}>
                {pin ? "Click elsewhere to move the pin" : "Click where it is"} · Esri · z{z}
            </span>
        </div>
    )
}
