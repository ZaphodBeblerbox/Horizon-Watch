/**
 * Columns.jsx — counts over time, in a side panel, interactive.
 *
 * One column per bucket, stacked by part when parts are given (severity:
 * the console's status colours, always with a legend). Marks follow the
 * charting rules: columns at most 24 px wide, 4 px rounded at the data end
 * and square on the baseline, a 2 px surface gap between stacked parts, a
 * hairline baseline, no gridlines. Every column is its own hit target —
 * full height, wider than the mark — with a tooltip on hover AND keyboard
 * focus; clicking selects it (onSelect), and the selected column stays lit.
 *
 * data:  [{ key, label, value, parts?: [{ key, value }] }]
 * parts: [{ key, label, color }]   the stack order and legend, bottom first
 */
import { useMemo, useRef, useState } from "react"

const GAP = 2

export default function Columns({ data, parts = null, height = 96, selected = null, onSelect = null,
                                  tip = null, label = "", empty = "Nothing in this window." }) {
    const box = useRef(null)
    const [hover, setHover] = useState(null)         // index
    const W = 300                                    // viewBox width; scales to the panel
    const max = useMemo(() => data.reduce((m, d) => Math.max(m, d.value || 0), 1), [data])
    if (!data.length || !data.some((d) => d.value)) {
        return <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>{empty}</div>
    }
    const slot = W / data.length
    const bw = Math.min(24, Math.max(2, slot - 3))
    const H = height
    const y = (v) => (v / max) * (H - 4)
    const col = (d, i) => {
        const x = i * slot + (slot - bw) / 2
        const stack = parts && d.parts ? parts.map((p) => ({ ...p, v: d.parts.find((q) => q.key === p.key)?.value || 0 })).filter((p) => p.v > 0)
                                       : [{ key: "all", color: "var(--acc-hi, var(--acchi))", v: d.value || 0 }]
        let base = H
        return stack.map((p, k) => {
            const h = Math.max(1, y(p.v) - (k < stack.length - 1 ? GAP : 0))
            const top = base - h
            const last = k === stack.length - 1
            const r = last ? Math.min(4, h, bw / 2) : 0
            // rounded at the data end only
            const dPath = `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`
            base = top - GAP
            return <path key={p.key} d={dPath} fill={p.color} />
        })
    }
    const h = hover != null ? data[hover] : null
    return (
        <div ref={box} style={{ position: "relative" }} aria-label={label}>
            <svg viewBox={`0 0 ${W} ${H + 1}`} width="100%" height={H + 1} preserveAspectRatio="none" role="img" style={{ display: "block", overflow: "visible" }}>
                {data.map((d, i) => (
                    <g key={d.key} opacity={selected != null && selected !== d.key && hover !== i ? 0.4 : hover === i ? 0.85 : 1}>{col(d, i)}</g>
                ))}
                <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="var(--gline2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {data.map((d, i) => (
                    <rect key={`hit-${d.key}`} x={i * slot} y="0" width={slot} height={H} fill="transparent"
                          tabIndex={0} role="button" aria-label={`${d.label}: ${d.value}`}
                          style={{ cursor: onSelect ? "pointer" : "default", outline: "none" }}
                          onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
                          onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                          onClick={() => onSelect?.(selected === d.key ? null : d.key)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(selected === d.key ? null : d.key) } }} />
                ))}
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", font: "400 9.5px var(--mono)", color: "var(--txt-4)", marginTop: 3 }}>
                <span>{data[0].label}</span><span>{data[data.length - 1].label}</span>
            </div>
            {parts && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", marginTop: 4 }}>
                    {parts.map((p) => (
                        <span key={p.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>
                            <i style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />{p.label}
                        </span>
                    ))}
                </div>
            )}
            {h && (
                <div role="tooltip" style={{
                    // kept inside the chart: anchored left near the left edge, right near the right
                    position: "absolute", bottom: H + 8,
                    ...((hover + 0.5) / data.length < 0.3 ? { left: 0 } : (hover + 0.5) / data.length > 0.7 ? { right: 0 } : { left: `${((hover + 0.5) / data.length) * 100}%`, transform: "translateX(-50%)" }),
                    pointerEvents: "none", zIndex: 5, whiteSpace: "nowrap", padding: "5px 8px",
                    background: "var(--glass, rgba(14,18,32,.94))", border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
                    backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                }}>
                    <div style={{ font: "600 13px var(--font)", color: "var(--txt)" }}>{h.value}</div>
                    <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>{tip ? tip(h) : h.label}</div>
                    {parts && h.parts && parts.filter((p) => h.parts.find((q) => q.key === p.key)?.value).map((p) => (
                        <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 6, font: "400 10.5px var(--font)", color: "var(--txt-2)" }}>
                            <i style={{ width: 10, height: 2, background: p.color }} />
                            <b style={{ fontWeight: 600 }}>{h.parts.find((q) => q.key === p.key).value}</b> {p.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

/** Rows of horizontal bars: a ranked list you can click. */
export function BarList({ rows, onSelect = null, selected = null, max = null }) {
    const top = max ?? rows.reduce((m, r) => Math.max(m, r.value || 0), 1)
    return (
        <div role="list">
            {rows.map((r) => (
                <button key={r.key} role="listitem" onClick={() => onSelect?.(selected === r.key ? null : r.key)}
                        title={r.title || `${r.label}: ${r.value}`}
                        style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: "2px 8px", width: "100%",
                                 padding: "4px 0", border: 0, background: "none", cursor: onSelect ? "pointer" : "default", textAlign: "left",
                                 opacity: selected != null && selected !== r.key ? 0.5 : 1 }}>
                    <span style={{ font: "400 12px var(--font)", color: "var(--txt-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                    <span style={{ font: "400 11.5px var(--mono)", color: "var(--txt-3)" }}>{r.value}</span>
                    <span style={{ gridColumn: "1 / -1", height: 6, background: "transparent", position: "relative" }}>
                        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.max(2, (r.value / top) * 100)}%`,
                                       background: r.color || "var(--acc-hi, var(--acchi))", borderRadius: "0 3px 3px 0" }} />
                    </span>
                </button>
            ))}
        </div>
    )
}
