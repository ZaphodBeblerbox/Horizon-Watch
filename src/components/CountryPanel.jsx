import { API_BASE } from "../apiBase.js"

const API = API_BASE

function relativeTime(ts) {
    if (!ts) return ""
    let date
    if (/^\d{8}T\d{6}Z$/.test(ts)) {
        date = new Date(
            ts.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")
        )
    } else {
        date = new Date(ts)
    }
    if (!date || isNaN(date.getTime())) return ""
    const diff = (Date.now() - date.getTime()) / 1000
    if (diff < 60)    return "just now"
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
}

const SECTION_HEADER = {
    fontSize:      10,
    fontWeight:    700,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
    color:         "var(--akili-accent)",
    marginBottom:  8,
}

export default function CountryPanel({ country, data, loading, onClose }) {
    const wiki     = data?.wiki
    const articles = data?.news || []

    return (
        <div style={{
            width:         "100%",
            height:        "100%",
            display:       "flex",
            flexDirection: "column",
            overflow:      "hidden",
            boxSizing:     "border-box",
        }}>
            {/* Header */}
            <div style={{
                height:         36,
                flexShrink:     0,
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                padding:        "0 12px",
                borderBottom:   "1px solid var(--akili-border)",
            }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--akili-text-muted)" }}>
                    Country Brief
                </span>
                <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--akili-text-muted)", lineHeight: 1, padding: 0 }}>
                    ×
                </button>
            </div>

            {/* Country name */}
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--akili-border)", flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--akili-text-primary)" }}>{country}</div>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 12px", display: "flex", flexDirection: "column", gap: 20 }}>

                {/* Loading skeleton */}
                {loading && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {[80, 50, 120, 60, 90].map((h, i) => (
                            <div key={i} style={{ height: h, background: "var(--akili-hover)", borderRadius: 3, animation: "cpPulse 1.5s infinite" }} />
                        ))}
                        <style>{`@keyframes cpPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
                    </div>
                )}

                {!loading && (
                    <>
                        {/* Wikipedia summary */}
                        {wiki && !wiki.type?.includes("error") && (
                            <div>
                                <div style={SECTION_HEADER}>Overview</div>

                                {/* Thumbnail with gradient overlay */}
                                {wiki.thumbnail?.source && (
                                    <div style={{ position: "relative", marginBottom: 10, borderRadius: 3, overflow: "hidden" }}>
                                        <img
                                            src={wiki.thumbnail.source}
                                            alt={country}
                                            style={{
                                                width:      "100%",
                                                maxHeight:  110,
                                                objectFit:  "cover",
                                                display:    "block",
                                                opacity:    0.70,
                                            }}
                                        />
                                        <div style={{
                                            position:   "absolute",
                                            bottom:     0,
                                            left:       0,
                                            right:      0,
                                            height:     "50%",
                                            background: "linear-gradient(to top, var(--akili-overlay), transparent)",
                                        }} />
                                    </div>
                                )}

                                {wiki.description && (
                                    <div style={{ fontSize: 10, color: "var(--akili-text-muted)", marginBottom: 6, fontStyle: "italic" }}>
                                        {wiki.description}
                                    </div>
                                )}

                                <p style={{ fontSize: 12, lineHeight: 1.65, color: "var(--akili-text-secondary)", margin: 0 }}>
                                    {wiki.extract}
                                </p>

                                <a
                                    href={wiki.content_urls?.desktop?.page}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ fontSize: 10, color: "var(--akili-accent)", textDecoration: "none", display: "block", marginTop: 6 }}
                                >
                                    Read more on Wikipedia →
                                </a>
                            </div>
                        )}

                        {/* News headlines */}
                        <div>
                            <div style={SECTION_HEADER}>Recent Headlines</div>

                            {articles.length === 0 ? (
                                <div style={{ fontSize: 11, color: "var(--akili-text-muted)", fontStyle: "italic" }}>
                                    No recent headlines found for this region.
                                </div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column" }}>
                                    {articles.map((a, i) => (
                                        <a
                                            key={i}
                                            href={a.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{
                                                display:       "block",
                                                padding:       "9px 0",
                                                borderBottom:  "1px solid var(--akili-border-subtle)",
                                                textDecoration: "none",
                                                color:         "inherit",
                                            }}
                                        >
                                            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--akili-text-primary)", lineHeight: 1.4, marginBottom: 3 }}>
                                                {a.title}
                                            </div>
                                            <div style={{ fontSize: 10, color: "var(--akili-text-muted)" }}>
                                                {a.source}
                                                {relativeTime(a.timestamp) && (
                                                    <span style={{ marginLeft: 8 }}>{relativeTime(a.timestamp)}</span>
                                                )}
                                            </div>
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
