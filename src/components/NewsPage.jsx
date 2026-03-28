import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"

const LIVE_CHANNELS = [
    { id: "aljazeera",  label: "Al Jazeera",  src: "https://www.youtube.com/embed/b0B3L23TQGI?autoplay=1&mute=1" },
    { id: "france24",   label: "France 24",   src: "https://www.youtube.com/embed/h3MuIUNCCLI?autoplay=1&mute=1" },
    { id: "dw",         label: "DW News",     src: "https://www.youtube.com/embed/jHaAIVEZOiI?autoplay=1&mute=1" },
    { id: "bbcworld",   label: "BBC World",   src: "https://www.youtube.com/embed/w7sDmb7fIKk?autoplay=1&mute=1" },
]

const REGION_FILTERS = [
    "All", "East Africa", "Horn of Africa", "Great Lakes Region",
    "Sahel", "North Africa", "Middle East", "Red Sea / Arabian Peninsula",
    "South Asia", "West Africa",
]

export default function NewsPage({ onClose }) {
    const [activeChannel, setActiveChannel]   = useState(LIVE_CHANNELS[0].id)
    const [regionFilter,  setRegionFilter]    = useState("All")
    const [headlines,     setHeadlines]       = useState([])
    const [loading,       setLoading]         = useState(false)
    const [saved,         setSaved]           = useState(() => {
        try { return JSON.parse(localStorage.getItem("akili-saved-articles") || "[]") } catch { return [] }
    })

    useEffect(() => {
        setLoading(true)
        const url = regionFilter === "All"
            ? `${API_BASE}/news`
            : `${API_BASE}/news?country=${encodeURIComponent(regionFilter)}`
        fetch(url)
            .then(r => r.ok ? r.json() : null)
            .then(d => setHeadlines(d?.headlines || d || []))
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [regionFilter])

    const toggleSave = (article) => {
        setSaved(prev => {
            const exists = prev.some(a => a.link === article.link)
            const next = exists ? prev.filter(a => a.link !== article.link) : [article, ...prev]
            try { localStorage.setItem("akili-saved-articles", JSON.stringify(next.slice(0, 100))) } catch {}
            return next
        })
    }

    const channel = LIVE_CHANNELS.find(c => c.id === activeChannel)

    return (
        <div style={{
            display:       "flex",
            flexDirection: "column",
            height:        "100%",
            background:    "#0a0e14",
            color:         "#e2e8f0",
            fontFamily:    "system-ui, -apple-system, sans-serif",
        }}>
            {/* Header */}
            <div style={{
                display:      "flex",
                alignItems:   "center",
                padding:      "10px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                flexShrink:   0,
                gap:          12,
            }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", color: "rgba(255,255,255,0.35)", flex: 1 }}>
                    LIVE INTELLIGENCE FEED
                </span>
                {onClose && (
                    <button
                        onClick={onClose}
                        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}
                    >
                        ✕
                    </button>
                )}
            </div>

            <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
                {/* Left: live TV */}
                <div style={{ width: 480, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
                    {/* Channel selector */}
                    <div style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                        {LIVE_CHANNELS.map(ch => (
                            <button
                                key={ch.id}
                                onClick={() => setActiveChannel(ch.id)}
                                style={{
                                    flex:          1,
                                    padding:       "8px 4px",
                                    fontSize:      9,
                                    fontWeight:    activeChannel === ch.id ? 700 : 400,
                                    letterSpacing: "0.06em",
                                    background:    activeChannel === ch.id ? "rgba(255,255,255,0.06)" : "none",
                                    border:        "none",
                                    borderBottom:  activeChannel === ch.id ? "2px solid #38bdf8" : "2px solid transparent",
                                    color:         activeChannel === ch.id ? "#38bdf8" : "rgba(255,255,255,0.35)",
                                    cursor:        "pointer",
                                    transition:    "all 0.12s",
                                }}
                            >
                                {ch.label.toUpperCase()}
                            </button>
                        ))}
                    </div>

                    {/* iFrame */}
                    <div style={{ flex: 1, position: "relative", background: "#000" }}>
                        <iframe
                            key={activeChannel}
                            src={channel.src}
                            title={channel.label}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                        />
                    </div>

                    {/* Live indicator */}
                    <div style={{
                        padding:      "6px 12px",
                        borderTop:    "1px solid rgba(255,255,255,0.06)",
                        display:      "flex",
                        alignItems:   "center",
                        gap:          6,
                        flexShrink:   0,
                    }}>
                        <div style={{
                            width: 6, height: 6, borderRadius: "50%",
                            background: "#ef4444",
                            animation: "pulse 1.5s infinite",
                        }} />
                        <span style={{ fontSize: 9, color: "#ef4444", fontWeight: 700, letterSpacing: "0.1em" }}>LIVE</span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginLeft: 4 }}>{channel.label}</span>
                    </div>
                </div>

                {/* Right: news articles */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                    {/* Region filter tabs */}
                    <div style={{
                        display:      "flex",
                        overflowX:    "auto",
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        flexShrink:   0,
                        padding:      "0 4px",
                    }}>
                        {REGION_FILTERS.map(r => (
                            <button
                                key={r}
                                onClick={() => setRegionFilter(r)}
                                style={{
                                    padding:       "8px 12px",
                                    fontSize:      9,
                                    fontWeight:    regionFilter === r ? 700 : 400,
                                    letterSpacing: "0.04em",
                                    whiteSpace:    "nowrap",
                                    background:    "none",
                                    border:        "none",
                                    borderBottom:  regionFilter === r ? "2px solid #00E5FF" : "2px solid transparent",
                                    color:         regionFilter === r ? "#00E5FF" : "rgba(255,255,255,0.35)",
                                    cursor:        "pointer",
                                    flexShrink:    0,
                                    transition:    "all 0.12s",
                                }}
                            >
                                {r}
                            </button>
                        ))}
                    </div>

                    {/* Article list */}
                    <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                        {loading ? (
                            <div style={{ padding: 24, textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.25)", animation: "pulse 1.5s infinite" }}>
                                Loading...
                            </div>
                        ) : headlines.length === 0 ? (
                            <div style={{ padding: 24, textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
                                No headlines available.
                            </div>
                        ) : headlines.map((h, i) => {
                            const isSaved = saved.some(a => a.link === h.link)
                            return (
                                <div
                                    key={i}
                                    style={{
                                        padding:      "10px 16px",
                                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                                        display:      "flex",
                                        gap:          10,
                                        alignItems:   "flex-start",
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <a
                                            href={h.link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                                fontSize:       11,
                                                fontWeight:     500,
                                                color:          "#e2e8f0",
                                                textDecoration: "none",
                                                lineHeight:     1.4,
                                                display:        "block",
                                            }}
                                        >
                                            {h.title || h.headline || "Untitled"}
                                        </a>
                                        <div style={{ marginTop: 4, fontSize: 9, color: "rgba(255,255,255,0.28)", display: "flex", gap: 8 }}>
                                            {h.source && <span>{h.source}</span>}
                                            {h.published && <span>{new Date(h.published).toLocaleDateString()}</span>}
                                            {h.country && <span style={{ color: "rgba(0,229,255,0.5)" }}>{h.country}</span>}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => toggleSave(h)}
                                        title={isSaved ? "Remove bookmark" : "Save article"}
                                        style={{
                                            background:  "none",
                                            border:      "none",
                                            cursor:      "pointer",
                                            color:       isSaved ? "#FFB300" : "rgba(255,255,255,0.2)",
                                            fontSize:    14,
                                            flexShrink:  0,
                                            padding:     "2px 4px",
                                            lineHeight:  1,
                                        }}
                                    >
                                        {isSaved ? "★" : "☆"}
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}
