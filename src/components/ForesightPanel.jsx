import { useState, useEffect } from "react"

const API = import.meta.env.VITE_API_BASE || ""

function probColor(p) {
    if (p >= 0.70) return "var(--sev-critical)"
    if (p >= 0.40) return "var(--sev-high)"
    if (p >= 0.20) return "var(--sev-medium)"
    return "var(--sev-low)"
}

const STATUS_LABEL = {
    active:       "ACTIVE",
    weak_signal:  "WEAK SIG",
    not_observed: "NOT OBS",
}
const STATUS_COLOR = {
    active:       "var(--sev-critical)",
    weak_signal:  "var(--sev-medium)",
    not_observed: "var(--text-dim)",
}

export default function ForesightPanel({ zoneId, zoneName }) {
    const [data,       setData]       = useState(null)
    const [loading,    setLoading]    = useState(true)
    const [triggering, setTriggering] = useState(false)

    const load = () => {
        if (!zoneId) return
        setLoading(true)
        fetch(`${API}/api/foresight/${zoneId}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { setData(d); setLoading(false) })
            .catch(() => setLoading(false))
    }

    useEffect(() => { load() }, [zoneId]) // eslint-disable-line react-hooks/exhaustive-deps

    const trigger = async () => {
        setTriggering(true)
        try {
            await fetch(`${API}/api/foresight/${zoneId}/trigger`, { method: "POST" })
            load()
        } catch {}
        setTriggering(false)
    }

    if (loading) {
        return (
            <div style={{ padding: "var(--space-4)", color: "var(--text-dim)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
                Loading assessment...
            </div>
        )
    }

    const a = data
    if (!a?.situation_summary) {
        return (
            <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)", fontFamily: "var(--font-mono)" }}>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", lineHeight: 1.6 }}>
                    No foresight assessment available for {zoneName || zoneId}.<br />
                    Score must be &ge; 40 to qualify, or trigger manually.
                </div>
                <button className="hw-btn hw-btn-primary" onClick={trigger} disabled={triggering}>
                    {triggering ? "Analysing..." : "Generate Assessment"}
                </button>
            </div>
        )
    }

    const prob       = a.escalation_probability_30d || 0
    const scenarios  = a.likely_scenarios             || []
    const indicators = a.early_warning_indicators     || []
    const patterns   = a.pattern_matches               || []
    const gaps       = a.intelligence_gaps             || []

    return (
        <div style={{ display: "flex", flexDirection: "column", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", height: "100%", overflow: "hidden" }}>

            {/* Header */}
            <div className="hw-panel-header">
                <span className="hw-panel-title">Foresight Assessment</span>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
                        {(a.model_used || "").includes("opus") ? "OPUS" : "SONNET"}
                    </span>
                    <span className={`hw-badge hw-badge-${
                        a.confidence === "high" ? "accent" :
                        a.confidence === "medium" ? "medium" : "low"
                    }`}>
                        {(a.confidence || "low").toUpperCase()}
                    </span>
                </div>
            </div>

            <div style={{ overflowY: "auto", flex: 1 }}>

                {/* Situation */}
                <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-dim)" }}>
                    <div className="hw-label" style={{ marginBottom: "var(--space-2)" }}>Situation</div>
                    <div style={{ color: "var(--text-secondary)", lineHeight: 1.65 }}>{a.situation_summary}</div>
                    {a.trajectory_assessment && (
                        <div style={{ marginTop: "var(--space-2)", color: "var(--text-muted)", lineHeight: 1.65, fontStyle: "italic" }}>
                            {a.trajectory_assessment}
                        </div>
                    )}
                </div>

                {/* Escalation probability */}
                <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-dim)" }}>
                    <div className="hw-label" style={{ marginBottom: "var(--space-3)" }}>Escalation Probability — 30 Days</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-2)" }}>
                        <div style={{ flex: 1 }}>
                            <div className="hw-bar-track">
                                <div className="hw-bar-fill" style={{ width: `${prob * 100}%`, background: probColor(prob) }} />
                            </div>
                        </div>
                        <div style={{ fontSize: "var(--text-xl)", fontWeight: "var(--weight-bold)", color: probColor(prob), minWidth: 44, textAlign: "right" }}>
                            {Math.round(prob * 100)}%
                        </div>
                    </div>
                    {a.probability_basis && (
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", lineHeight: 1.55 }}>{a.probability_basis}</div>
                    )}
                </div>

                {/* Scenarios */}
                {scenarios.length > 0 && (
                    <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-dim)" }}>
                        <div className="hw-label" style={{ marginBottom: "var(--space-3)" }}>Likely Scenarios</div>
                        {scenarios.map((s, i) => (
                            <div key={i} style={{ marginBottom: "var(--space-3)", paddingLeft: "var(--space-3)", borderLeft: `2px solid ${probColor(s.probability || 0)}` }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--space-1)" }}>
                                    <span style={{ fontWeight: "var(--weight-bold)", color: "var(--text-primary)" }}>{s.scenario}</span>
                                    <span style={{ color: probColor(s.probability || 0), fontWeight: "var(--weight-bold)" }}>
                                        {Math.round((s.probability || 0) * 100)}%
                                    </span>
                                </div>
                                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: "var(--space-1)" }}>
                                    {s.description}
                                </div>
                                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>Timeline: {s.timeline}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Historical pattern matches */}
                {patterns.length > 0 && (
                    <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-dim)" }}>
                        <div className="hw-label" style={{ marginBottom: "var(--space-3)" }}>Historical Pattern Matches</div>
                        {patterns.map((p, i) => (
                            <div key={i} style={{ marginBottom: "var(--space-3)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--space-1)" }}>
                                    <span style={{ fontWeight: "var(--weight-bold)", color: "var(--text-primary)" }}>{p.historical_analogue}</span>
                                    <span style={{ color: probColor(p.similarity_score || 0), fontWeight: "var(--weight-bold)" }}>
                                        {Math.round((p.similarity_score || 0) * 100)}%
                                    </span>
                                </div>
                                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: "var(--space-1)" }}>
                                    {p.similarity_basis}
                                </div>
                                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", fontStyle: "italic" }}>
                                    Outcome: {p.outcome_of_analogue}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Early warning indicators */}
                {indicators.length > 0 && (
                    <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-dim)" }}>
                        <div className="hw-label" style={{ marginBottom: "var(--space-3)" }}>Early Warning Indicators</div>
                        {indicators.map((ind, i) => {
                            const statusColor = STATUS_COLOR[ind.current_status] || STATUS_COLOR.not_observed
                            const statusLabel = STATUS_LABEL[ind.current_status] || (ind.current_status || "").toUpperCase()
                            return (
                                <div key={i} style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-3)", alignItems: "flex-start" }}>
                                    <div style={{ flexShrink: 0, paddingTop: 2 }}>
                                        <span style={{
                                            display: "inline-block",
                                            fontSize: 7,
                                            fontWeight: 700,
                                            letterSpacing: 1,
                                            color: statusColor,
                                            border: `1px solid ${statusColor}`,
                                            padding: "1px 4px",
                                            whiteSpace: "nowrap",
                                            opacity: ind.current_status === "not_observed" ? 0.6 : 1,
                                        }}>
                                            {statusLabel}
                                        </span>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 2 }}>
                                            {ind.indicator}
                                        </div>
                                        <div style={{ fontSize: 9, color: "var(--text-dim)" }}>
                                            {ind.domain} — {ind.significance}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* Analyst note */}
                {a.analyst_note && (
                    <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-dim)", background: "var(--accent-faint)", borderLeft: "3px solid var(--accent)" }}>
                        <div className="hw-label" style={{ marginBottom: "var(--space-2)" }}>Analyst Note</div>
                        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.6 }}>{a.analyst_note}</div>
                    </div>
                )}

                {/* Intelligence gaps */}
                {gaps.length > 0 && (
                    <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-dim)" }}>
                        <div className="hw-label" style={{ marginBottom: "var(--space-2)" }}>Intelligence Gaps</div>
                        {gaps.map((g, i) => (
                            <div key={i} style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", marginBottom: "var(--space-1)", paddingLeft: "var(--space-2)", borderLeft: "1px solid var(--border-dim)", lineHeight: 1.5 }}>
                                {g}
                            </div>
                        ))}
                    </div>
                )}

                {/* Footer */}
                <div style={{ padding: "var(--space-3) var(--space-4)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
                        {a.generated_at ? new Date(a.generated_at).toUTCString().slice(0, 22) + " UTC" : ""}
                    </span>
                    <button className="hw-btn" onClick={trigger} disabled={triggering}>
                        {triggering ? "Analysing..." : "Refresh"}
                    </button>
                </div>

            </div>
        </div>
    )
}
