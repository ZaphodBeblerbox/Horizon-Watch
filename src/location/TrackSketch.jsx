/**
 * TrackSketch.jsx — where an asset linked to a person has been: their
 * phone's positions over the last day (GET /api/my-assets/{id}/track),
 * drawn as a line to scale with the latest point marked, and said in words
 * — how many positions, the last one, how precise. Refreshed every minute
 * while open, so it follows them. Used by the phone's asset sheet and the
 * desktop's asset page.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { hm } from "../utils/clock.js"
import { metres } from "./liveShare.js"

export function project(points, w, h, pad = 10) {
    if (!points.length) return []
    const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length
    const kx = Math.cos(lat0 * Math.PI / 180)
    const xs = points.map((p) => p.lon * kx), ys = points.map((p) => p.lat)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const span = Math.max(x1 - x0, y1 - y0, 0.0005)                 // ~50 m: a person standing still is a dot
    const s = Math.min(w - 2 * pad, h - 2 * pad) / span
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    return points.map((p, i) => [w / 2 + (xs[i] - cx) * s, h / 2 - (ys[i] - cy) * s])
}

export default function TrackSketch({ assetId, hours = 24, height = 120 }) {
    const [pts, setPts] = useState(null)
    useEffect(() => {
        let live = true
        const load = () => fetch(`${API_BASE}/api/my-assets/${encodeURIComponent(assetId)}/track?hours=${hours}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setPts(d?.track || []) }).catch(() => { if (live) setPts([]) })
        load()
        const t = setInterval(load, 60_000)
        return () => { live = false; clearInterval(t) }
    }, [assetId, hours])
    if (!pts) return <div className="m2-sub" style={{ padding: 8 }}>Loading where they have been…</div>
    if (!pts.length) return <div className="m2-sub" data-testid="track-sketch" style={{ padding: 8 }}>No position shared in the last {hours} hours.</div>
    const W = 320, H = height
    const xy = project(pts, W, H)
    const last = pts[pts.length - 1]
    let dist = 0
    for (let i = 1; i < pts.length; i++) dist += metres(pts[i - 1], pts[i])
    const coarse = last.source === "ip" || (last.accuracy_m ?? 0) >= 1000
    return (
        <div data-testid="track-sketch">
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Track: ${pts.length} positions`}
                 style={{ display: "block", background: "rgba(59,140,255,.06)", borderRadius: 10 }}>
                {xy.length > 1 && <polyline points={xy.map((p) => p.join(",")).join(" ")} fill="none" stroke="#3b8cff" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" opacity=".85" />}
                {xy.slice(0, -1).map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="#3b8cff" opacity=".5" />)}
                <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="6.5" fill="#2f7cf6" stroke="#fff" strokeWidth="2.5" />
            </svg>
            <div className="m2-sub" style={{ marginTop: 6, lineHeight: 1.5 }}>
                {pts.length} position{pts.length === 1 ? "" : "s"} in {hours} h{dist >= 50 ? ` · ${dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`} moved` : ""}
                {` · last ${hm(last.at)}`}
                {coarse ? " · from their connection, city level" : last.accuracy_m != null ? ` · to within ${Math.round(last.accuracy_m)} m` : ""}
            </div>
        </div>
    )
}
