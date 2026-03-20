import { useState, useEffect } from "react"
import Markdown from "react-markdown"
import { apiFetch } from "../auth.js"

// Severity tier colours
const TIER_COLOR = {
    critical:    "#ef4444",
    significant: "#f97316",
    elevated:    "#eab308",
    low:         "#0d9488",
}
const TYPE_COLOR = {
    "Protests":                    "#3b82f6",
    "Violence against civilians":  "#dc2626",
    "Battles":                     "#7c3aed",
    "Explosions/Remote violence":  "#ef4444",
    "Strategic developments":      "#16a34a",
    "Riots":                       "#ea580c",
}

async function getWikipediaImage(name) {
    if (!name) return null
    try {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`)
        if (!res.ok) return null
        const data = await res.json()
        return data.thumbnail?.source || null
    } catch {
        return null
    }
}

export default function EventDetailPanel({ event, profile, onClose, onAnalyse, analysing, cachedAnalysis }) {
    const [imgUrl,   setImgUrl]   = useState(null)
    const [imgError, setImgError] = useState(false)
    const [visible,  setVisible]  = useState(false)

    // Slide-in animation
    useEffect(() => {
        const t = requestAnimationFrame(() => setVisible(true))
        return () => cancelAnimationFrame(t)
    }, [])

    // Load Wikipedia image for infra/news items that have a name
    useEffect(() => {
        setImgUrl(null); setImgError(false)
        if (!event) return
        const name = event.name || event.flagship || event.title
        const types = ["airport", "port", "power", "military", "government"]
        const needsWiki = types.some(t => (event.infra_type || event.type || "").toLowerCase().includes(t))
        if (name && needsWiki) {
            getWikipediaImage(name).then(url => { if (url) setImgUrl(url) })
        } else if (event.imageUrl) {
            setImgUrl(event.imageUrl)
        }
    }, [event])

    if (!event) return null

    const result     = cachedAnalysis?.[event.id || event.url]
    const tierColor  = TIER_COLOR[event.severity_tier] || TIER_COLOR.low
    const typeColor  = TYPE_COLOR[event.type || event.event_type] || "rgba(255,255,255,0.4)"
    const title      = event.name || event.headline || event.title || event.location || "Event"
    const body       = event.description || event.notes || event.summary || ""
    const lat        = event.lat ?? event.latitude
    const lon        = event.lon ?? event.longitude

    function handleClose() {
        setVisible(false)
        setTimeout(onClose, 250)
    }

    return (
        <div style={{
            position:       "fixed",
            top:            0,
            right:          0,
            width:          380,
            height:         "100vh",
            background:     "rgba(6,13,26,0.94)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderLeft:     "1px solid rgba(255,255,255,0.08)",
            zIndex:         2100,
            display:        "flex",
            flexDirection:  "column",
            overflowY:      "auto",
            transform:      visible ? "translateX(0)" : "translateX(100%)",
            transition:     "transform 0.25s ease-out",
            fontFamily:     "Inter, -apple-system, sans-serif",
            color:          "#e0e0e0",
            boxShadow:      "-4px 0 24px rgba(0,0,0,0.5)",
        }}>
            {/* Header */}
            <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    {/* Type badge */}
                    {(event.type || event.event_type) && (
                        <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase",
                            background: `${typeColor}22`, color: typeColor, border: `1px solid ${typeColor}44`,
                            padding: "2px 7px", borderRadius: 8,
                        }}>
                            {event.type || event.event_type}
                        </span>
                    )}
                    {/* Severity badge */}
                    {event.severity_tier && (
                        <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase",
                            background: `${tierColor}22`, color: tierColor, border: `1px solid ${tierColor}44`,
                            padding: "2px 7px", borderRadius: 8,
                        }}>
                            {event.severity_tier}
                        </span>
                    )}
                    {/* Infra category badge */}
                    {event.infra_type && !event.severity_tier && (
                        <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase",
                            background: "rgba(0,188,212,0.15)", color: "#00BCD4", border: "1px solid rgba(0,188,212,0.3)",
                            padding: "2px 7px", borderRadius: 8,
                        }}>
                            {event.infra_type}
                        </span>
                    )}
                    {/* Source */}
                    {event.source && (
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginLeft: "auto" }}>{event.source}</span>
                    )}
                    <button onClick={handleClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 0 0 8px", marginLeft: event.source ? 0 : "auto" }}>✕</button>
                </div>
            </div>

            {/* Image */}
            {imgUrl && !imgError && (
                <div style={{ position: "relative", flexShrink: 0 }}>
                    <img
                        src={imgUrl}
                        alt={title}
                        onError={() => setImgError(true)}
                        style={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }}
                    />
                    {/* Dark gradient overlay on bottom third */}
                    <div style={{
                        position: "absolute", bottom: 0, left: 0, right: 0, height: "40%",
                        background: "linear-gradient(transparent, rgba(6,13,26,0.94))",
                        pointerEvents: "none",
                    }} />
                </div>
            )}

            {/* Body */}
            <div style={{ padding: "14px 16px", flex: 1 }}>
                {/* Title */}
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1.3, marginBottom: 10 }}>
                    {title}
                </div>

                {/* Body text */}
                {body && (
                    <div style={{ fontSize: 13, color: "#8899aa", lineHeight: 1.65, marginBottom: 14 }}>
                        {body}
                    </div>
                )}

                {/* Metadata row */}
                <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
                    {event.date && (
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                            <span style={{ color: "rgba(255,255,255,0.2)", marginRight: 4 }}>Date</span>
                            {event.date}
                        </div>
                    )}
                    {lat != null && lon != null && (
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                            <span style={{ color: "rgba(255,255,255,0.2)", marginRight: 4 }}>Coords</span>
                            {Number(lat).toFixed(4)}, {Number(lon).toFixed(4)}
                        </div>
                    )}
                    {event.fatalities > 0 && (
                        <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 600 }}>
                            {event.fatalities} fatalities
                        </div>
                    )}
                    {event.confidence && (
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                            <span style={{ color: "rgba(255,255,255,0.2)", marginRight: 4 }}>Confidence</span>
                            {event.confidence}
                        </div>
                    )}
                </div>

                {/* Key fields for infra */}
                {[
                    ["Actor",    event.actor],
                    ["Location", event.location],
                    ["Operator", event.operator],
                    ["Country",  event.country],
                    ["Capacity", event.capacity_mw ? `${event.capacity_mw} MW` : null],
                ].map(([label, val]) => val ? (
                    <div key={label} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 6 }}>
                        <span style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0, width: 64 }}>{label}</span>
                        <span style={{ color: "#d0d8e4" }}>{val}</span>
                    </div>
                ) : null)}

                {/* Link for news events */}
                {event.url && (
                    <div style={{ marginTop: 8, marginBottom: 14 }}>
                        <a href={event.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "rgba(26,110,181,0.8)" }}>
                            View source article →
                        </a>
                    </div>
                )}

                {/* Separator */}
                <div style={{ height: 1, background: "rgba(255,255,255,0.06)", marginBottom: 14 }} />

                {/* Analysis section */}
                {result?.markdown && (
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(26,110,181,0.8)", marginBottom: 8 }}>
                            Intelligence Brief
                        </div>
                        <div style={{ fontSize: 12, lineHeight: 1.65, color: "#8899aa" }}>
                            <Markdown>{result.markdown}</Markdown>
                        </div>
                    </div>
                )}
                {result?.analysis && (
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(26,110,181,0.8)", marginBottom: 8 }}>
                            Intelligence Brief
                        </div>
                        <div style={{ fontSize: 12, lineHeight: 1.65, color: "#8899aa" }}>
                            <Markdown>{result.analysis}</Markdown>
                        </div>
                    </div>
                )}
                {result?.error && (
                    <div style={{ fontSize: 11, color: "#f87171", marginBottom: 14, padding: "8px 10px", background: "rgba(239,68,68,0.08)", borderRadius: 4 }}>
                        {result.error}
                    </div>
                )}

                {/* Analyse button */}
                {onAnalyse && !result && !analysing && (
                    <button onClick={onAnalyse} style={{
                        width: "100%", padding: "10px 0",
                        background: "rgba(26,110,181,0.15)", border: "1px solid rgba(26,110,181,0.4)",
                        borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                        color: "rgba(26,110,181,0.9)", cursor: "pointer", textTransform: "uppercase",
                    }}>
                        Analyse
                    </button>
                )}
                {analysing && (
                    <div style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.3)", padding: "10px 0" }}>
                        Generating intelligence brief…
                    </div>
                )}
            </div>
        </div>
    )
}
