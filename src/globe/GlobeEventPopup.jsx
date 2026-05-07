const TYPE_LABELS = {
    armed_clash:  "Armed Clash",
    explosion:    "Explosion",
    missile:      "Missile Strike",
    airstrike:    "Airstrike",
    maritime:     "Maritime Event",
    protest:      "Protest",
    earthquake:   "Earthquake",
    fire:         "Fire",
    aviation:     "Aviation Incident",
    energy:       "Energy Infrastructure",
    medical:      "Medical / Humanitarian",
    fight:        "Armed Clash",
    assassination:"Assassination",
}

const TYPE_HEX = {
    missile:      "#ef4444",
    airstrike:    "#ef4444",
    assassination:"#ef4444",
    explosion:    "#f97316",
    armed_clash:  "#f97316",
    fight:        "#f97316",
    fire:         "#f97316",
    maritime:     "#3b82f6",
    protest:      "#eab308",
    earthquake:   "#a855f7",
    aviation:     "#38bdf8",
    energy:       "#facc15",
    medical:      "#22c55e",
}

const SEVERITY_COLORS = {
    critical:    "#ef4444",
    significant: "#f97316",
    elevated:    "#eab308",
    low:         "#64748b",
}

export default function GlobeEventPopup({ data: ev, onClose }) {
    const rawType   = (ev.event_type || ev.type || "").toLowerCase()
    const accent    = TYPE_HEX[rawType] || "#64748b"
    const typeLabel = TYPE_LABELS[rawType]
        || rawType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
        || "Event"
    const title    = ev.headline || ev.clean_title || ev.title || "Event"
    const image    = ev.image_url || ev.image || ev.thumbnail || ev.thumbnail_url || ev.urlToImage || ev.img || null
    const severity = (ev.severity_tier || "").toLowerCase()
    const sources  = Array.isArray(ev.sources) ? ev.sources : (ev.source_name ? [ev.source_name] : [])
    const articleUrl = ev.url || (ev.timeline?.[0]?.url) || null

    let timeStr = ""
    try {
        const d = ev.latest_event || ev.published_at || ev.published
        if (d) timeStr = new Date(d).toLocaleDateString("en-US", {
            year: "numeric", month: "short", day: "numeric",
        })
    } catch {}

    return (
        <div style={{ fontFamily: "Inter,-apple-system,sans-serif", overflow: "hidden" }}>
            {/* Article image */}
            {image && (
                <div style={{ position: "relative" }}>
                    <img
                        src={image}
                        alt=""
                        style={{ width: "100%", height: 130, objectFit: "cover", display: "block" }}
                        onError={e => { e.currentTarget.style.display = "none" }}
                    />
                    <div style={{
                        position: "absolute", bottom: 0, left: 0, right: 0,
                        background: "linear-gradient(transparent, rgba(10,15,26,0.85))",
                        height: 40,
                    }} />
                </div>
            )}

            {/* Header */}
            <div style={{
                padding: "10px 14px 8px",
                borderBottom: `1px solid ${accent}35`,
                background: "rgba(10,15,26,0.5)",
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, paddingRight: 8 }}>
                        {/* Type + severity badges */}
                        <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                            <span style={{
                                fontSize: 10, fontWeight: 700, color: accent,
                                textTransform: "uppercase", letterSpacing: "0.06em",
                                background: `${accent}18`, padding: "2px 6px", borderRadius: 3,
                                border: `1px solid ${accent}40`,
                            }}>
                                {typeLabel}
                            </span>
                            {severity && severity !== "low" && (
                                <span style={{
                                    fontSize: 10, fontWeight: 700,
                                    color: "#fff", background: SEVERITY_COLORS[severity] || "#64748b",
                                    padding: "2px 6px", borderRadius: 3,
                                    textTransform: "uppercase", letterSpacing: "0.04em",
                                }}>
                                    {severity}
                                </span>
                            )}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF1", lineHeight: 1.35 }}>
                            {title}
                        </div>
                        {ev.location && (
                            <div style={{ fontSize: 10, color: "#9AA4B5", marginTop: 3 }}>
                                {ev.location}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        style={{ background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1, flexShrink: 0 }}
                    >×</button>
                </div>
            </div>

            {/* Summary */}
            {(ev.body || ev.summary) && (
                <div style={{ padding: "8px 14px 6px", fontSize: 11, color: "#C8D0DB", lineHeight: 1.55 }}>
                    {(ev.body || ev.summary || "").slice(0, 280)}
                    {(ev.body || ev.summary || "").length > 280 ? "…" : ""}
                </div>
            )}

            {/* Meta row */}
            <div style={{ padding: "5px 14px 8px", fontSize: 10, color: "#9AA4B5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{sources.slice(0, 2).join(" · ") || ""}</span>
                <span>{timeStr}</span>
            </div>

            {/* Footer */}
            <div style={{ display: "flex", gap: 6, padding: "6px 14px 12px", borderTop: "1px solid #1E2B3D" }}>
                <button
                    onClick={onClose}
                    style={{ flex: 1, fontSize: 11, background: "#1E2B3D", color: "#E8ECF1", border: "1px solid #2C3645", borderRadius: 4, padding: "5px 10px", cursor: "pointer" }}
                >
                    Close
                </button>
                {articleUrl && (
                    <a
                        href={articleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ flex: 2, fontSize: 11, fontWeight: 700, color: "#0F1721", background: "#38bdf8", border: "none", borderRadius: 4, padding: "5px 10px", cursor: "pointer", textDecoration: "none", textAlign: "center" }}
                    >
                        Read Article ↗
                    </a>
                )}
            </div>
        </div>
    )
}
