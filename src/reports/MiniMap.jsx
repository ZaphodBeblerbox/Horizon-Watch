// MiniMap.jsx — a real, lightweight equirectangular-projection minimap for
// the reader's reference pane. Deliberately NOT a second embedded Cesium
// GlobeView: the app already keeps one live 3D globe mounted (Situation's),
// and a second full WebGL globe instance just for a 196px reference-pane
// widget would double real GPU/memory cost for a view this small — "open on
// map" below re-centers the one real globe instead. This renders real
// lat/lon points (the focused claim highlighted, sibling claims as context)
// via plain SVG, not a fabricated illustration.

export default function MiniMap({ focus, context = [], height = 196 }) {
    const w = 300
    const project = (lat, lon) => [((lon + 180) / 360) * w, ((90 - lat) / 180) * height]

    return (
        <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} style={{ background: "var(--bg-0)", display: "block" }}>
            {Array.from({ length: 7 }, (_, i) => (
                <line key={`v${i}`} x1={(i * w) / 6} x2={(i * w) / 6} y1={0} y2={height} stroke="var(--chart-grid)" strokeWidth={1} />
            ))}
            {Array.from({ length: 4 }, (_, i) => (
                <line key={`h${i}`} x1={0} x2={w} y1={(i * height) / 3} y2={(i * height) / 3} stroke="var(--chart-grid)" strokeWidth={1} />
            ))}
            {context.filter((c) => c.lat != null && c.lon != null).map((c, i) => {
                const [x, y] = project(c.lat, c.lon)
                return <circle key={i} cx={x} cy={y} r={2} fill="var(--txt-4)" opacity={0.7} />
            })}
            {focus?.lat != null && focus?.lon != null && (() => {
                const [x, y] = project(focus.lat, focus.lon)
                return (
                    <g>
                        <circle cx={x} cy={y} r={7} fill="none" stroke="var(--acc-hi)" strokeWidth={1.5}>
                            <animate attributeName="r" values="5;9;5" dur="1.8s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="1;0.2;1" dur="1.8s" repeatCount="indefinite" />
                        </circle>
                        <circle cx={x} cy={y} r={3} fill="var(--acc-hi)" />
                    </g>
                )
            })()}
            {!focus?.lat && (
                <text x={w / 2} y={height / 2} textAnchor="middle" style={{ font: "400 11px var(--font)", fill: "var(--txt-4)" }}>
                    No coordinate for this reference
                </text>
            )}
        </svg>
    )
}
