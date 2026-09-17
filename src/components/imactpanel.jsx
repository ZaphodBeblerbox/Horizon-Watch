import Markdown from "react-markdown"

const MD_STYLES = `
  .brief h2 {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: #999;
    margin: 16px 0 6px;
    padding-top: 14px;
    border-top: 1px solid rgba(0,0,0,0.07);
  }
  .brief h2:first-child { margin-top: 0; padding-top: 0; border-top: none; }
  .brief p  { font-size: 12px; line-height: 1.65; color: #333; margin: 0 0 6px; }
  .brief ul { margin: 4px 0 6px 0; padding-left: 16px; }
  .brief li { font-size: 12px; line-height: 1.6; color: #444; }
  .brief strong { color: #111; }
`

export default function ImpactPanel({ analysis, event, loading, onClose, onAnalyse }) {
    if (!event && !loading) return (
        <div style={{
            width: 320,
            flexShrink: 0,
            background: "rgb(255, 255, 255)",
            borderLeft: "1px solid rgba(0,0,0,0.10)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 32
        }}>
            <div style={{ textAlign: "center", color: "#bbb" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>◎</div>
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                    Select an event<br />to analyse its impact
                </div>
            </div>
        </div>
    )

    return (
        <div style={{
            width: 320,
            flexShrink: 0,
            background: "rgb(255, 255, 255)",
            borderLeft: "1px solid rgba(0,0,0,0.10)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
        }}>
            <style>{MD_STYLES}</style>

            {/* Header */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase", color: "#999" }}>
                    Intelligence Brief
                </span>
                {onClose && (
                    <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#999", lineHeight: 1, padding: "0 2px" }}>
                        ✕
                    </button>
                )}
            </div>

            {/* Event metadata strip */}
            {event && (
                <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)", flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{event.type}</div>
                    <div style={{ fontSize: 11, color: "#666" }}>
                        {event.location} · {event.date}
                        {event.fatalities > 0 && <span style={{ color: "#c0392b", marginLeft: 8, fontWeight: 600 }}>✕ {event.fatalities}</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#aaa", marginTop: 2, fontStyle: "italic" }}>{event.actor}</div>
                </div>
            )}

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>

                {/* Analyse button — shown only before analysis has been requested */}
                {!analysis && !loading && onAnalyse && (
                    <button
                        onClick={onAnalyse}
                        style={{
                            width: "100%", padding: "9px 0", marginBottom: 14,
                            background: "#0a0a0a", color: "#fff",
                            border: "none", borderRadius: 6,
                            fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                            cursor: "pointer",
                        }}
                    >
                        Analyse
                    </button>
                )}

                {/* Loading skeleton */}
                {loading && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {[40, 80, 60, 90, 70].map((h, i) => (
                            <div key={i} style={{ height: h, background: "rgba(0,0,0,0.04)", animation: "pulse 1.5s infinite" }} />
                        ))}
                        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
                    </div>
                )}

                {/* Error state */}
                {analysis?.error && !loading && (
                    <div style={{
                        background: "#fdecea",
                        border: "1px solid #f5c6c6",
                        padding: "10px 12px",
                        fontSize: 11,
                        color: "#c0392b",
                        lineHeight: 1.6
                    }}>
                        <strong>Analysis unavailable — check API key and backend logs</strong>
                        <br />{analysis.error}
                    </div>
                )}

                {/* Markdown brief */}
                {analysis?.markdown && !loading && (
                    <div className="brief">
                        <Markdown>{analysis.markdown}</Markdown>
                    </div>
                )}

            </div>
        </div>
    )
}
