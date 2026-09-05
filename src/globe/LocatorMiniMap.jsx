// LocatorMiniMap.jsx — real, zoomed (±18°) minimap with a bounded "ping
// twice" focus animation and real 1600km-radius context markers. Built for
// Replay.jsx (src/destinations/Replay.jsx) and extracted here so any other
// caller needing the same real re-framing behavior (the Briefings reader's
// .xref reference pane) reuses this one implementation rather than a third
// parallel version — see src/reports/MiniMap.jsx's own docblock for why
// *that* component stays a separate, simpler fixed full-world projection
// (Dossiers/Briefings' existing non-reframing callers rely on that behavior
// and are out of scope to change here).
//
// Deliberately plain SVG, not a second embedded Cesium instance — the app
// already keeps one live 3D globe mounted (Situation's); see MiniMap.jsx's
// docblock for the same real GPU/memory-cost reasoning.

import { useUserLocation } from "./useUserLocation.js"

const DEFAULT_REFRAME_DEG = 18
// The ratio CONTEXT_KM(1600) : REFRAME_DEG(18) this component originally
// shipped with — kept constant so a wider/tighter per-kind span (below)
// scales its real-surrounding-signal search radius proportionally instead
// of showing either far too few or far too many context points.
const CONTEXT_KM_PER_DEGREE = 1600 / 18

function haversineKm(a, b) {
    const R = 6371
    const p1 = (a.lat * Math.PI) / 180, p2 = (b.lat * Math.PI) / 180
    const dp = ((b.lat - a.lat) * Math.PI) / 180, dl = ((b.lon - a.lon) * Math.PI) / 180
    const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * @param {?{lat:number, lon:number}} focus - real center point, or null/no-lat to fall back to the
 *   viewer's own real geolocation (zoomed in), or the honest empty state if that's unavailable too
 * @param {Array<{lat:?number, lon:?number}>} context - real candidate context points, filtered to within a
 *   span-proportional radius of focus
 * @param {number} height
 * @param {number} [span] - real per-kind framing width in degrees (implementation manual v1.0 §4.4:
 *   signal 16° · scene 10° · node 20° · region 46°) — callers with no particular kind (e.g. Replay.jsx's
 *   own timeline scrubbing) keep the original 18° default.
 */
export default function LocatorMiniMap({ focus, context = [], height = 196, span = DEFAULT_REFRAME_DEG }) {
    const userLoc = useUserLocation()
    // Real fallback only — never a fabricated coordinate. `usingUserLocation`
    // just suppresses the context-point ping (those are siblings of a real
    // record, meaningless around a raw device location).
    const effectiveFocus = focus?.lat != null ? focus : userLoc
    const usingUserLocation = focus?.lat == null && userLoc != null
    const w = 300
    const centerLat = effectiveFocus?.lat ?? 0
    const centerLon = effectiveFocus?.lon ?? 0
    const project = (lat, lon) => [
        ((lon - centerLon + span) / (span * 2)) * w,
        ((span - (lat - centerLat)) / (span * 2)) * height,
    ]
    const contextKm = span * CONTEXT_KM_PER_DEGREE
    const contextPts = effectiveFocus?.lat != null && !usingUserLocation
        ? context.filter((c) => c.lat != null && c.lon != null && haversineKm(effectiveFocus, c) <= contextKm)
        : []
    return (
        <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} style={{ background: "var(--bg-0)", display: "block" }}>
            {Array.from({ length: 7 }, (_, i) => (
                <line key={`v${i}`} x1={(i * w) / 6} x2={(i * w) / 6} y1={0} y2={height} stroke="var(--chart-grid)" strokeWidth={1} />
            ))}
            {Array.from({ length: 4 }, (_, i) => (
                <line key={`h${i}`} x1={0} x2={w} y1={(i * height) / 3} y2={(i * height) / 3} stroke="var(--chart-grid)" strokeWidth={1} />
            ))}
            {effectiveFocus?.lat == null ? (
                <text x={w / 2} y={height / 2} textAnchor="middle" style={{ font: "400 11px var(--font)", fill: "var(--txt-4)" }}>
                    No location to display yet
                </text>
            ) : (
                <>
                    {contextPts.map((c, i) => {
                        const [x, y] = project(c.lat, c.lon)
                        if (x < -6 || x > w + 6 || y < -6 || y > height + 6) return null
                        return <rect key={i} x={x - 2.5} y={y - 2.5} width={5} height={5} transform={`rotate(45 ${x} ${y})`} fill="var(--txt-4)" opacity={0.7} />
                    })}
                    {(() => {
                        const [x, y] = project(effectiveFocus.lat, effectiveFocus.lon)
                        const color = usingUserLocation ? "var(--txt-3)" : "var(--acc-hi)"
                        return (
                            <g>
                                <circle cx={x} cy={y} r={7} fill="none" stroke={color} strokeWidth={1.5}>
                                    <animate attributeName="r" values="5;9;5" dur="1.4s" repeatCount="2" fill="freeze" />
                                    <animate attributeName="opacity" values="1;0.2;1" dur="1.4s" repeatCount="2" fill="freeze" />
                                </circle>
                                <circle cx={x} cy={y} r={3} fill={color} />
                            </g>
                        )
                    })()}
                    {usingUserLocation && (
                        <text x={w / 2} y={height - 6} textAnchor="middle" style={{ font: "400 10px var(--font)", fill: "var(--txt-4)" }}>
                            Your location
                        </text>
                    )}
                </>
            )}
        </svg>
    )
}
