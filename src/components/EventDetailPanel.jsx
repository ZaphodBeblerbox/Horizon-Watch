import { useState, useEffect, useCallback } from "react"
import Markdown from "react-markdown"

const TIER_COLOR = {
    critical:    "#ef4444",
    significant: "#f97316",
    elevated:    "#eab308",
    low:         "#0d9488",
}
const TYPE_COLOR = {
    "Protests":                   "#3b82f6",
    "Violence against civilians": "#dc2626",
    "Battles":                    "#7c3aed",
    "Explosions/Remote violence": "#ef4444",
    "Strategic developments":     "#16a34a",
    "Riots":                      "#ea580c",
}

export default function EventDetailPanel({ event, profile, onClose, onAnalyse, analysing, cachedAnalysis }) {
    const [imgUrl,  setImgUrl]  = useState(null)
    const [imgError, setImgError] = useState(false)
    const [visible, setVisible] = useState(false)

    // Slide-in animation
    useEffect(() => {
        const t = requestAnimationFrame(() => setVisible(true))
        return () => cancelAnimationFrame(t)
    }, [])

    // Escape key closes panel
    useEffect(() => {
        const handler = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [onClose])

    // Image loading: direct fields → Wikipedia
    useEffect(() => {
        setImgUrl(null); setImgError(false)
        if (!event) return
        const loadImage = async () => {
            const direct = event.image_url || event.og_image || event.image || event.thumbnail || event.urlToImage || event.imageUrl
            if (direct) { setImgUrl(direct); return }
            const searchTerms = [event.flagship, event.name, event.location?.split(",")[0]?.trim()].filter(t => t && t.length > 3)
            for (const term of searchTerms) {
                try {
                    const res = await fetch(
                        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`,
                        { signal: AbortSignal.timeout(3000) }
                    )
                    if (!res.ok) continue
                    const data = await res.json()
                    if (data.thumbnail?.source) { setImgUrl(data.thumbnail.source); return }
                } catch { /* ignore */ }
            }
        }
        loadImage()
    }, [event?.id, event?.headline])

    // Extract structured intel from event text
    const extractStructuredData = useCallback((ev) => {
        const text = [ev.headline || "", ev.context || "", ev.summary || "", ev.auto_brief || ""].join(" ")
        const casualtyPatterns = [
            /(\d+)\s*(people\s*)?(killed|dead|died)/i,
            /(\d+)\s*(people\s*)?(wounded|injured|hurt)/i,
            /(\d+)\s*casualties/i,
            /killed\s+(\d+)/i,
        ]
        let casualties = null
        for (const p of casualtyPatterns) {
            const m = text.match(p)
            if (m) { casualties = m[0]; break }
        }
        const actorPatterns = [
            /(?:by|from|against)\s+((?:[A-Z][a-z]+\s?){1,3}(?:forces|military|army|group|militia|rebels|troops))/g,
            /(?:Israeli|Iranian|Russian|US|American|Syrian|Iraqi|Houthi|Hamas|Hezbollah)\s+(?:forces|military|strikes?|army|airstrikes?)/gi,
        ]
        const actors = []
        for (const p of actorPatterns) {
            for (const m of text.matchAll(p)) {
                if (m[1] && !actors.includes(m[1])) actors.push(m[1])
            }
        }
        const infraMap = { airports: "✈ Aviation", ports: "⚓ Maritime", military: "★ Military", hospitals: "✚ Medical", power: "⚡ Power grid", pipelines: "⛓ Pipelines", comms: "◉ Communications" }
        const infraImpact = (ev.infrastructure_types_to_preload || []).map(t => infraMap[t] || t)
        return { casualties, actors, infraImpact }
    }, [])

    function handleClose() {
        setVisible(false)
        setTimeout(onClose, 250)
    }

    if (!event) return null

    const result    = cachedAnalysis?.[event.id || event.url]
    const tierColor = TIER_COLOR[event.severity_tier] || TIER_COLOR.low
    const typeColor = TYPE_COLOR[event.type || event.event_type] || "rgba(255,255,255,0.4)"
    const title     = event.name || event.headline || event.title || event.location || "Event"
    const lat       = event.lat ?? event.latitude
    const lon       = event.lon ?? event.longitude

    const timestampStr = event.latest_event || event.published_at || event.published
    const ageHours = timestampStr
        ? (Date.now() - new Date(timestampStr).getTime()) / 3600000
        : null
    const ageLabel = ageHours === null ? null : ageHours < 1 ? "Just now" : ageHours < 24 ? `${Math.floor(ageHours)}h ago` : `${Math.floor(ageHours / 24)}d ago`

    const briefParagraphs = event.auto_brief ? event.auto_brief.split(/\n\n+/).filter(Boolean) : []
    const { casualties, actors: extractedActors, infraImpact } = extractStructuredData(event)

    // Actors: prefer structured array, fallback to regex-extracted
    const actorList = Array.isArray(event.actors) && event.actors.length > 0
        ? event.actors
        : extractedActors

    // Sources: prefer structured array, fallback to scalar fields
    const sourceList = Array.isArray(event.sources) && event.sources.length > 0
        ? event.sources
        : event.source_name ? [event.source_name] : event.source ? [event.source] : []

    const eventTypeLabel = (event.event_type || event.type || event.icon || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())

    const sitrep = [
        { label: "Location",        value: event.location || event.action_geo_full_name },
        { label: "Event type",      value: eventTypeLabel || null },
        { label: "Age",             value: ageLabel },
        { label: "Casualties",      value: casualties || "Not reported" },
        { label: "Actors",          value: actorList.length > 0 ? actorList.slice(0, 2).join(", ") : null },
        { label: "Corroboration",   value: event.corroboration_count > 1 ? `${event.corroboration_count} sources` : null },
        { label: "Confidence",      value: event.confidence || null },
    ].filter(r => r.value)

    return (
        <div style={{
            position:             "fixed",
            top:                  0,
            right:                0,
            width:                380,
            height:               "100vh",
            background:           "rgba(6, 13, 26, 0.92)",
            backdropFilter:       "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderLeft:           "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow:            "-8px 0 32px rgba(0, 0, 0, 0.5)",
            zIndex:               2100,
            display:              "flex",
            flexDirection:        "column",
            overflowY:            "auto",
            transform:            visible ? "translateX(0)" : "translateX(100%)",
            transition:           "transform 0.25s ease-out",
            fontFamily:           "Inter, -apple-system, sans-serif",
            color:                "#e0e0e0",
        }}>
            {/* Absolute close button — always visible */}
            <button
                onClick={handleClose}
                style={{
                    position:       "absolute",
                    top:            12,
                    right:          12,
                    background:     "rgba(255,255,255,0.08)",
                    border:         "1px solid rgba(255,255,255,0.12)",
                    borderRadius:   "50%",
                    width:          28,
                    height:         28,
                    color:          "#8899aa",
                    cursor:         "pointer",
                    fontSize:       16,
                    display:        "flex",
                    alignItems:     "center",
                    justifyContent: "center",
                    zIndex:         10,
                    flexShrink:     0,
                }}
            >×</button>

            {/* Image */}
            {imgUrl && !imgError && (
                <div style={{ position: "relative", flexShrink: 0 }}>
                    <img
                        src={imgUrl}
                        alt={title}
                        onError={() => setImgError(true)}
                        style={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }}
                    />
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", background: "linear-gradient(transparent, rgba(6,13,26,0.96))", pointerEvents: "none" }} />
                </div>
            )}

            {/* Header */}
            <div style={{ padding: "14px 48px 10px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {(event.type || event.event_type) && (
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", background: `${typeColor}22`, color: typeColor, border: `1px solid ${typeColor}44`, padding: "2px 7px", borderRadius: 8 }}>
                            {event.type || event.event_type}
                        </span>
                    )}
                    {event.severity_tier && (
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", background: `${tierColor}22`, color: tierColor, border: `1px solid ${tierColor}44`, padding: "2px 7px", borderRadius: 8 }}>
                            {event.severity_tier}
                        </span>
                    )}
                    {event.infra_type && !event.severity_tier && (
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", background: "rgba(0,188,212,0.15)", color: "#00BCD4", border: "1px solid rgba(0,188,212,0.3)", padding: "2px 7px", borderRadius: 8 }}>
                            {event.infra_type}
                        </span>
                    )}
                    {event.source && (
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginLeft: "auto" }}>{event.source}</span>
                    )}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#f0f4f8", lineHeight: 1.3 }}>
                    {title}
                </div>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 20px" }}>

                {/* SITUATION REPORT table */}
                {sitrep.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, color: "#1a6eb5", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>
                            SITUATION REPORT
                        </div>
                        {sitrep.map((row, i) => (
                            <div key={i} style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12 }}>
                                <span style={{ color: "#4a6080", minWidth: 80, flexShrink: 0 }}>{row.label}</span>
                                <span style={{ color: "#c0ccd8" }}>{row.value}</span>
                            </div>
                        ))}
                        {infraImpact.length > 0 && (
                            <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: 10, color: "#4a6080", marginBottom: 6 }}>INFRASTRUCTURE AT RISK</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                    {infraImpact.map((inf, i) => (
                                        <span key={i} style={{ fontSize: 10, padding: "2px 8px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 3, color: "#fca5a5" }}>{inf}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Sources chips */}
                {sourceList.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                        {sourceList.map((s, i) => (
                            <span key={i} style={{ fontSize: 10, padding: "2px 8px", background: "rgba(26,110,181,0.15)", border: "1px solid rgba(26,110,181,0.3)", borderRadius: 3, color: "#7aadcf" }}>{s}</span>
                        ))}
                    </div>
                )}

                {/* SOURCE REPORT — body/summary text from unified thread */}
                {(event.body || event.summary) && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, color: "#1a6eb5", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}>
                            SOURCE REPORT
                        </div>
                        <p style={{ fontSize: 12, color: "#8899aa", lineHeight: 1.65, margin: 0 }}>
                            {event.body || event.summary}
                        </p>
                    </div>
                )}

                {/* STORY TIMELINE */}
                {event.timeline && event.timeline.length > 1 && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, color: "#1a6eb5", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>
                            STORY TIMELINE — {event.timeline.length} REPORTS
                        </div>
                        {event.timeline.slice(0, 8).map((item, i) => {
                            const ageH = item.published ? (Date.now() - new Date(item.published).getTime()) / 3600000 : null
                            const age = ageH === null ? "" : ageH < 1 ? "Just now" : ageH < 24 ? `${Math.floor(ageH)}h ago` : `${Math.floor(ageH / 24)}d ago`
                            const tIcons = { airstrike: "✦", missile: "↑", armed_clash: "✕", explosion: "◉", maritime: "▲", protest: "◆", earthquake: "⊕", fire: "◈", assassination: "◎", general: "●" }
                            return (
                                <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: item.url ? "pointer" : "default" }}
                                    onClick={() => item.url && window.open(item.url, "_blank")}>
                                    <div style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{tIcons[item.event_type] || "●"}</div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 11, color: "#c0ccd8", lineHeight: 1.4 }}>{item.clean_title}</div>
                                        <div style={{ fontSize: 10, color: "#4a6080", marginTop: 2, display: "flex", gap: 8 }}>
                                            {item.source_name && <span>{item.source_name}</span>}
                                            {age && <span>{age}</span>}
                                        </div>
                                    </div>
                                    {item.url && <div style={{ color: "#4a6080", fontSize: 10, flexShrink: 0, marginTop: 2 }}>↗</div>}
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* Key fields for infra/other */}
                {[
                    ["Operator", event.operator],
                    ["Country",  event.country],
                    ["Capacity", event.capacity_mw ? `${event.capacity_mw} MW` : null],
                    ["Fatalities", event.fatalities > 0 ? String(event.fatalities) : null],
                ].filter(([, v]) => v).map(([label, val]) => (
                    <div key={label} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 6 }}>
                        <span style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0, width: 64 }}>{label}</span>
                        <span style={{ color: "#d0d8e4" }}>{val}</span>
                    </div>
                ))}

                {/* Nearby infrastructure from context */}
                {(event.infrastructure_context || event.nearby_infrastructure || []).length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 8 }}>Relevant Infrastructure</div>
                        {(event.infrastructure_context || event.nearby_infrastructure).map((item, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 4, marginBottom: 5, fontSize: 12, color: "#8899aa" }}>
                                <span style={{ color: "#c0ccd8" }}>{item.name || item.type}</span>
                                {item.distance_km != null && <span style={{ fontSize: 11, color: "#4a6080" }}>{Math.round(item.distance_km)}km</span>}
                            </div>
                        ))}
                    </div>
                )}

                {/* ANALYST BRIEF — auto_brief paragraphs */}
                {briefParagraphs.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, color: "#1a6eb5", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}>
                            ANALYST BRIEF
                            <span style={{ marginLeft: 6, fontSize: 9, padding: "1px 5px", background: "rgba(13,148,136,0.15)", color: "#0d9488", border: "1px solid rgba(13,148,136,0.3)", borderRadius: 3 }}>AI</span>
                        </div>
                        {briefParagraphs.map((p, i) => (
                            <p key={i} style={{ fontSize: i === 0 ? 12 : 11, color: i === 0 ? "#c0ccd8" : "#7a8fa8", lineHeight: 1.6, margin: "0 0 8px 0", fontWeight: i === 0 ? 500 : 400 }}>{p}</p>
                        ))}
                    </div>
                )}

                {/* Claude analysis result */}
                {result?.markdown && (
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(26,110,181,0.8)", marginBottom: 8 }}>Intelligence Brief</div>
                        <div style={{ fontSize: 12, lineHeight: 1.65, color: "#8899aa" }}><Markdown>{result.markdown}</Markdown></div>
                    </div>
                )}
                {result?.analysis && (
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(26,110,181,0.8)", marginBottom: 8 }}>Intelligence Brief</div>
                        <div style={{ fontSize: 12, lineHeight: 1.65, color: "#8899aa" }}><Markdown>{result.analysis}</Markdown></div>
                    </div>
                )}
                {result?.error && (
                    <div style={{ fontSize: 11, color: "#f87171", marginBottom: 14, padding: "8px 10px", background: "rgba(239,68,68,0.08)", borderRadius: 4 }}>{result.error}</div>
                )}

                {/* Source link */}
                {event.url && (
                    <a href={event.url} target="_blank" rel="noopener noreferrer"
                        style={{ display: "block", textAlign: "center", fontSize: 11, color: "#4a6080", marginBottom: 12, textDecoration: "none" }}
                        onMouseEnter={e => { e.target.style.color = "#8899aa" }}
                        onMouseLeave={e => { e.target.style.color = "#4a6080" }}
                    >
                        ↗ Read original source
                    </a>
                )}

                {/* Analyse button */}
                {onAnalyse && !result && !analysing && (
                    <button onClick={onAnalyse} style={{ width: "100%", padding: "10px 0", background: "rgba(26,110,181,0.15)", border: "1px solid rgba(26,110,181,0.4)", borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "rgba(26,110,181,0.9)", cursor: "pointer", textTransform: "uppercase" }}>
                        Analyse
                    </button>
                )}
                {analysing && (
                    <div style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.3)", padding: "10px 0" }}>Generating intelligence brief…</div>
                )}
            </div>
        </div>
    )
}
