/**
 * ChokepointFlowSection.jsx — is traffic through this chokepoint normal?
 *
 * The chokepoint's share of every AIS position observed each day, against
 * its own trailing 14-day mean (backend/chokepoint_flow.py). Share, not a
 * raw count, because the raw count tracks how long the backend was running.
 *
 * When the server says a chokepoint cannot be measured — no receiver
 * coverage, too little traffic, a baseline too noisy to call — this shows
 * that sentence and NO chart. A flat line at zero over Hormuz would read as
 * a closure, and the honest answer is that we cannot see it.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"

const W = 280, H = 72, PAD_L = 4, PAD_R = 4, PAD_T = 8, PAD_B = 14

export function FlowChart({ series, baseline }) {
    const [hover, setHover] = useState(null)
    if (!series || series.length < 2) return null
    const vals = series.map(p => p.share_pct)
    const max = Math.max(baseline, ...vals) * 1.1 || 1
    const x = i => PAD_L + (i * (W - PAD_L - PAD_R)) / (series.length - 1)
    const y = v => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B)
    const path = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.share_pct).toFixed(1)}`).join("")
    const last = series.length - 1
    const shown = hover ?? last
    const p = series[shown]
    return (
        <div style={{ position: "relative" }}>
            <svg
                viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
                role="img"
                aria-label={`Daily share of observed AIS positions, ${series[0].day} to ${series[last].day}; 14-day normal ${baseline.toFixed(2)}%`}
                onMouseLeave={() => setHover(null)}
                onMouseMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    const fx = ((e.clientX - r.left) / r.width) * W
                    setHover(Math.max(0, Math.min(last, Math.round(((fx - PAD_L) / (W - PAD_L - PAD_R)) * last))))
                }}
                style={{ display: "block", overflow: "visible" }}
            >
                <line x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} stroke="var(--gline)" strokeWidth="1" />
                <line x1={PAD_L} x2={W - PAD_R} y1={y(baseline)} y2={y(baseline)}
                    stroke="var(--txt-4)" strokeWidth="1" strokeDasharray="3 3" />
                <path d={path} fill="none" stroke="var(--acchi)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {hover != null && (
                    <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={H - PAD_B} stroke="var(--txt-4)" strokeWidth="1" />
                )}
                <circle cx={x(shown)} cy={y(p.share_pct)} r="4" fill="var(--acchi)" stroke="var(--bg, #fff)" strokeWidth="2" />
                <text x={PAD_L} y={H - 2} fontSize="9" fill="var(--txt-4)">{series[0].day.slice(5)}</text>
                <text x={W - PAD_R} y={H - 2} fontSize="9" fill="var(--txt-4)" textAnchor="end">{series[last].day.slice(5)}</text>
            </svg>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", columnGap: 8, font: "400 11px var(--font)", color: "var(--txt-3, var(--txt3))", marginTop: 2 }}>
                <span style={{ whiteSpace: "nowrap" }}><b style={{ color: "var(--txt)" }}>{p.share_pct.toFixed(2)}%</b> on {p.day.slice(5)} · {p.positions.toLocaleString()} positions</span>
                <span style={{ whiteSpace: "nowrap" }}>– – normal {baseline.toFixed(2)}%</span>
            </div>
        </div>
    )
}

export default function ChokepointFlowSection({ name }) {
    const [flow, setFlow] = useState(undefined)
    useEffect(() => {
        setFlow(undefined)
        if (!name) return
        let cancelled = false
        fetch(`${API_BASE}/api/chokepoints/flow`)
            .then(r => (r.ok ? r.json() : null))
            .then(d => {
                if (cancelled) return
                setFlow((d?.chokepoints || []).find(c => c.name === name) || null)
            })
            .catch(() => { if (!cancelled) setFlow(null) })
        return () => { cancelled = true }
    }, [name])

    if (flow === undefined) return <Loading size={18} inline label="Loading" />
    if (flow === null) return <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)" }}>No traffic history for this chokepoint.</div>

    const sentence = flow.summary.startsWith(`${name}: `) ? flow.summary.slice(name.length + 2) : flow.summary
    return (
        <div>
            <div style={{ font: "400 11.5px var(--font)", color: "var(--txt)", marginBottom: 6, textWrap: "pretty" }}>{sentence}</div>
            {flow.measurable && <FlowChart series={flow.series.slice(-30)} baseline={flow.baseline_share_pct} />}
            <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-4)", marginTop: 4 }}>
                Share of all AIS positions observed that day, in the 1° cells this chokepoint touches. Positions, not ships.
            </div>
        </div>
    )
}
