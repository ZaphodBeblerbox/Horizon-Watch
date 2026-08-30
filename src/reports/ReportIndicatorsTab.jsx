/**
 * Section header — local copy of ForgePanel.jsx's Section() helper, restyled
 * with Round 1 tokens instead of inline hex colors.
 */
function Section({ title, children }) {
    return (
        <div style={{ marginBottom: "var(--space-4)" }}>
            <div style={{
                color: "var(--text-dim)", fontSize: "var(--text-xs)", textTransform: "uppercase",
                letterSpacing: "0.06em", marginBottom: "var(--space-2)", paddingBottom: 4,
                borderBottom: "1px solid var(--border-dim)",
            }}>{title}</div>
            {children}
        </div>
    )
}

/**
 * Threat indicators tab — adapted from ForgePanel.jsx's TaskIndicatorsTab
 * (~line 2116-2144), restyled with Round 1 tokens.
 *
 * Props:
 *   collected — the task's real `collected` object
 *               (threat_overview.elevated_regions[{region,score,level,trend}],
 *               foresight_risks[{zone,escalation_probability,situation,...}]).
 */
export default function ReportIndicatorsTab({ collected }) {
    const elevated = collected?.threat_overview?.elevated_regions || []
    const risks    = collected?.foresight_risks || []
    return (
        <div style={{ maxWidth: 640, fontFamily: "var(--font-sans)" }}>
            <Section title="Elevated Regions">
                {elevated.length === 0 && (
                    <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>None elevated in scope.</div>
                )}
                {elevated.map((r, i) => (
                    <div key={r.region || i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border-dim)" }}>
                        <span style={{ color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>{r.region}</span>
                        <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{r.level} · {r.score} · {r.trend}</span>
                    </div>
                ))}
            </Section>
            <Section title="Foresight / Escalation Risks">
                {risks.length === 0 && (
                    <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>None above threshold in scope.</div>
                )}
                {risks.map((r, i) => (
                    <div key={r.zone || i} style={{ padding: "6px 0", borderBottom: "1px solid var(--border-dim)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-primary)", fontSize: "var(--text-sm)", fontWeight: 600 }}>{r.zone}</span>
                            <span style={{ color: "var(--warn)", fontSize: "var(--text-sm)" }}>{Math.round((r.escalation_probability || 0) * 100)}%</span>
                        </div>
                        {r.situation && <div style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", marginTop: 2 }}>{r.situation}</div>}
                    </div>
                ))}
            </Section>
        </div>
    )
}
