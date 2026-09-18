/**
 * Minimap.jsx — PARALLAX addendum §S3.5. THE locator inset, used everywhere.
 *
 * "Why 2D here and 3D on Situation. A locator's job is 'where in the world is
 * this, and what is near it' — answered instantly by a flat rectangle and
 * badly by a sphere, which hides half the context behind the horizon and
 * needs a camera move to orient. Same reason atlases put a locator inset on
 * the page."
 *
 * Explicitly NOT a second Cesium viewer: the app keeps one live 3D globe, and
 * a second GPU context per panel is a cost with no answer to show for it.
 *
 * This replaces four parallel implementations — LocatorMiniMap (a graticule
 * with no coastline), AoiMiniMap, NewsMiniMap and reports/MiniMap — which had
 * drifted into three different sizes, two projections and their own marker
 * vocabularies. One locator, one reading.
 *
 * ⚠ d3 IS NOT A DEPENDENCY HERE. §S3.5 is written against
 * d3.geoEquirectangular + world-atlas; this app ships neither, and adding d3
 * for one linear projection would be a megabyte to avoid eight lines of
 * arithmetic. The projection, the fitExtent and the ping easing are written
 * out below and behave identically. The land is a pre-simplified outline
 * generated from the backend's own countries.geojson (169KB at 1° — one
 * pixel of this map is ~1.8° of longitude, so finer data is invisible).
 */
import { useEffect, useMemo, useRef, useState } from "react"

export const DEFAULT_SPAN = 26          // §S3.5's default framing, in degrees
export const MINIMAP_HEIGHT = 196
// §S3.5's marker sizes: context 6px, subject 10px.
export const CONTEXT_SIZE = 6
export const SUBJECT_SIZE = 10
// Two staggered pings, 0ms and 480ms, cubic ease-out over 1.5s.
export const PING_DELAYS = [0, 480]
export const PING_MS = 1500

// Module-level so the outline is fetched once for the whole session no
// matter how many locators mount.
let _landPromise = null
function loadLand() {
    if (!_landPromise) {
        _landPromise = fetch(`${import.meta.env.BASE_URL || "/"}data/world-land.json`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d?.polygons || [])
            .catch(() => [])
    }
    return _landPromise
}

/** §S3.5's `focus(lon, lat, spanDeg)` — fitExtent over a span-degree box. */
export function makeProjection(lon, lat, span, w, h) {
    const padX = 4, padY = 4
    const halfY = span * 0.62
    const west = lon - span, east = lon + span
    const south = lat - halfY, north = lat + halfY
    const sx = (w - padX * 2) / (east - west)
    const sy = (h - padY * 2) / (north - south)
    // One scale for both axes keeps the coastline's shape; the smaller of the
    // two is what actually fits.
    const s = Math.min(sx, sy)
    const cx = (west + east) / 2, cy = (south + north) / 2
    return (plon, plat) => [
        w / 2 + (plon - cx) * s,
        h / 2 - (plat - cy) * s,
    ]
}

/** cubic ease-out, §S3.5's own easing. */
export const easeOut = (f) => 1 - Math.pow(1 - f, 3)

function Diamond({ x, y, size, color, opacity = 1 }) {
    const h = size / 2
    return (
        <rect className="mm-ev" x={x - h} y={y - h} width={size} height={size}
              transform={`rotate(45 ${x} ${y})`} fill={color} opacity={opacity} />
    )
}

/**
 * @param {{lat:number, lon:number}} focus   the subject
 * @param {Array}  context  nearby records — drawn at 6px; the subject is 10px
 * @param {string} label    drawn beside the subject
 * @param {number} span     framing width in degrees
 */
export default function Minimap({
    focus,
    context = [],
    label = "",
    color = "var(--red)",
    span = DEFAULT_SPAN,
    height = MINIMAP_HEIGHT,
    title = "Locator",
    subtitle = "",
}) {
    const [land, setLand] = useState([])
    const [pings, setPings] = useState([])
    const timers = useRef([])
    const W = 300

    useEffect(() => { let off = false; loadLand().then((p) => { if (!off) setLand(p) }); return () => { off = true } }, [])

    const hasFocus = Number.isFinite(focus?.lat) && Number.isFinite(focus?.lon)
    const project = useMemo(
        () => makeProjection(hasFocus ? focus.lon : 0, hasFocus ? focus.lat : 20, hasFocus ? span : 170, W, height),
        [hasFocus, focus?.lat, focus?.lon, span, height],
    )

    // §S3.5 — "two staggered pings (0ms and 480ms, cubic ease-out over 1.5s)
    // are how the eye finds the subject when the minimap re-focuses. ONE PING
    // IS MISSABLE; THREE IS A NIGHTCLUB."
    useEffect(() => {
        timers.current.forEach(clearTimeout)
        timers.current = []
        if (!hasFocus) { setPings([]); return }
        const start = Date.now()
        const run = () => {
            const t = Date.now() - start
            const live = [0, 480]
                .map((delay) => {
                    const f = (t - delay) / PING_MS
                    return f >= 0 && f <= 1 ? { delay, r: 4 + 36 * easeOut(f), o: 1 - easeOut(f) } : null
                })
                .filter(Boolean)
            setPings(live)
            if (t < 2100) timers.current.push(setTimeout(run, 60))
        }
        run()
        return () => timers.current.forEach(clearTimeout)
    }, [hasFocus, focus?.lat, focus?.lon])

    const p = hasFocus ? project(focus.lon, focus.lat) : null

    return (
        <div className="minimap" style={{ height }}>
            <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
                {land.map((poly, i) => (
                    <path key={i} className="mm-land"
                          d={"M" + poly.map(([x, y]) => project(x, y).map((n) => n.toFixed(1)).join(",")).join("L") + "Z"} />
                ))}

                {hasFocus && context.map((c, i) => {
                    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null
                    const q = project(c.lon, c.lat)
                    // 6px context, 10px subject: size is the hierarchy.
                    // A second glyph SHAPE would imply a second kind of thing.
                    return <Diamond key={i} x={q[0]} y={q[1]} size={CONTEXT_SIZE} color={c.color || "var(--steel)"} opacity={0.8} />
                })}

                {p && pings.map((ping) => (
                    <circle key={ping.delay} className="mm-ping" cx={p[0]} cy={p[1]} r={ping.r} strokeOpacity={ping.o} />
                ))}

                {p && <Diamond x={p[0]} y={p[1]} size={SUBJECT_SIZE} color={color} />}
                {p && label && <text className="mm-lbl" x={p[0] + 10} y={p[1] + 3}>{label}</text>}

                {!hasFocus && (
                    <text x={W / 2} y={height / 2} textAnchor="middle" className="mm-lbl">
                        No location on this record
                    </text>
                )}
            </svg>
            <div className="mmhead">
                <b>{title}</b>
                {subtitle ? <span style={{ marginLeft: "auto" }}>{subtitle}</span> : null}
            </div>
        </div>
    )
}
