import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"

const TV_CHANNELS = [
    { id: "aljazeera", name: "Al Jazeera English",  src: "https://www.youtube.com/embed/F-POY4Q0QSI?autoplay=1&mute=1" },
    { id: "france24",  name: "France 24 English",   src: "https://www.youtube.com/embed/h3MuIUNCCzI?autoplay=1&mute=1" },
    { id: "dw",        name: "DW News",              src: "https://www.youtube.com/embed/V7Cf5JLGO38?autoplay=1&mute=1" },
    { id: "sky",       name: "Sky News",             src: "https://www.youtube.com/embed/9Auq9mYxFEE?autoplay=1&mute=1" },
    { id: "cnbc",      name: "CNBC",                 src: "https://www.youtube.com/embed/9NyxcX3rhQs?autoplay=1&mute=1" },
]

const SPACE_CHANNELS = [
    { id: "nasatv",    name: "NASA TV",              src: "https://www.youtube.com/embed/21X5lGlDOfg?autoplay=1&mute=1" },
    { id: "spacex",    name: "SpaceX",               src: "https://www.youtube.com/embed/nA9UZF-SZoQ?autoplay=1&mute=1" },
    { id: "everyday",  name: "Everyday Astronaut",   src: "https://www.youtube.com/embed/5HqXGeDuWnE?autoplay=1&mute=1" },
]

const WORLD_REGIONS = ["All", "Africa", "Middle East", "Europe", "Asia", "Americas"]
const CATEGORIES    = ["All", "Conflict", "Politics", "Technology", "Business", "Science", "Space"]

const SPACE_KEYWORDS = ["space", "nasa", "rocket", "satellite", "orbit", "launch", "spacex", "asteroid", "moon", "mars", "iss", "starship", "starlink", "telescope"]

const TIER_COLOR = {
    critical:    "#ef4444",
    significant: "#f97316",
    elevated:    "#eab308",
    low:         "#0d9488",
}

function formatAge(ts) {
    if (!ts) return ""
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
    if (mins < 1)    return "just now"
    if (mins < 60)   return `${mins}m ago`
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
    return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

export default function NewsPage({ onClose }) {
    const [articles,       setArticles]       = useState([])
    const [loading,        setLoading]        = useState(true)
    const [section,        setSection]        = useState("news")   // "news" | "space"
    const [channelIdx,     setChannelIdx]     = useState(0)
    const [regionFilter,   setRegionFilter]   = useState("All")
    const [categoryFilter, setCategoryFilter] = useState("All")

    const channels = section === "space" ? SPACE_CHANNELS : TV_CHANNELS
    const channel  = channels[channelIdx] || channels[0]

    // ── Fetch articles ────────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false
        setLoading(true)

        const tryFetch = async () => {
            const token = localStorage.getItem("hw-auth-token")
            const headers = token ? { Authorization: `Bearer ${token}` } : {}

            // Priority order: scored surface pool → raw events
            for (const path of ["/api/surface", "/api/events", "/news"]) {
                try {
                    console.log("[news] trying", API_BASE + path)
                    const res = await fetch(`${API_BASE}${path}`, { headers })
                    if (!res.ok) { console.log("[news]", path, "→", res.status); continue }
                    const data = await res.json()
                    console.log("[news]", path, "→ ok, keys:", Object.keys(data))
                    const list = data.items || data.threads || data.events || (Array.isArray(data) ? data : [])
                    console.log("[news] article count:", list.length)
                    if (!cancelled) setArticles(list)
                    return
                } catch (e) {
                    console.error("[news]", path, "error:", e)
                }
            }
            if (!cancelled) setArticles([])
        }

        tryFetch().finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [])

    // ── Channel navigation ────────────────────────────────────────────────────
    const prevChannel = () => setChannelIdx(i => (i === 0 ? channels.length - 1 : i - 1))
    const nextChannel = () => setChannelIdx(i => (i === channels.length - 1 ? 0 : i + 1))

    // Reset channel index when switching sections
    const switchSection = (s) => { setSection(s); setChannelIdx(0) }

    // ── Filter articles ───────────────────────────────────────────────────────
    const filtered = articles.filter(a => {
        const text = (a.headline || a.clean_title || a.title || "").toLowerCase()

        if (section === "space") {
            return SPACE_KEYWORDS.some(k => text.includes(k)) || a.event_type === "space"
        }

        if (regionFilter !== "All") {
            const r = (a.region || a.country || "").toLowerCase()
            if (!r.includes(regionFilter.toLowerCase())) return false
        }

        if (categoryFilter !== "All") {
            const type = (a.event_type || "").toLowerCase()
            switch (categoryFilter) {
                case "Conflict":   if (!["armed_clash","missile","airstrike","explosion","battle"].includes(type)) return false; break
                case "Politics":   if (!text.match(/politi|govern|election|minister|president|coup/)) return false; break
                case "Technology": if (!text.match(/tech|ai|cyber|digital|software|hack/))           return false; break
                case "Business":   if (!text.match(/econom|market|trade|company|invest|sanction/))   return false; break
                case "Science":    if (!text.match(/science|research|study|discover|climate/))        return false; break
                case "Space":      if (!SPACE_KEYWORDS.some(k => text.includes(k)))                  return false; break
                default: break
            }
        }

        return true
    })

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={{
            display:       "flex",
            flexDirection: "column",
            height:        "100%",
            background:    "#0f172a",
            color:         "#e2e8f0",
            fontFamily:    "Inter, system-ui, -apple-system, sans-serif",
            overflow:      "hidden",
        }}>

            {/* ── Top bar ──────────────────────────────────────────────────── */}
            <div style={{
                flexShrink:   0,
                height:       52,
                background:   "rgba(15,23,42,0.98)",
                borderBottom: "1px solid rgba(56,189,248,0.2)",
                display:      "flex",
                alignItems:   "center",
                padding:      "0 20px",
                gap:          16,
            }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.2em", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>
                    Live Intelligence Feed
                </span>

                {/* Section tabs */}
                <div style={{ display: "flex", gap: 4, marginLeft: 12 }}>
                    {[
                        { id: "news",  label: "World News" },
                        { id: "space", label: "Spaceflight" },
                    ].map(s => (
                        <button
                            key={s.id}
                            onClick={() => switchSection(s.id)}
                            style={{
                                padding:      "6px 14px",
                                fontSize:     12,
                                fontWeight:   section === s.id ? 600 : 400,
                                border:       `1px solid ${section === s.id ? "rgba(56,189,248,0.4)" : "transparent"}`,
                                borderRadius: 6,
                                background:   section === s.id ? "rgba(56,189,248,0.12)" : "transparent",
                                color:        section === s.id ? "#38bdf8" : "rgba(255,255,255,0.4)",
                                cursor:       "pointer",
                                transition:   "all 0.12s",
                            }}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>

                <div style={{ flex: 1 }} />

                <button
                    onClick={onClose}
                    style={{
                        padding:      "6px 14px",
                        fontSize:     12,
                        border:       "1px solid rgba(148,163,184,0.25)",
                        borderRadius: 6,
                        background:   "transparent",
                        color:        "rgba(255,255,255,0.4)",
                        cursor:       "pointer",
                    }}
                >
                    Back to Map
                </button>
            </div>

            {/* ── Body ─────────────────────────────────────────────────────── */}
            <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

                {/* ── Left sidebar: TV player + filters ───────────────────── */}
                <div style={{
                    width:        340,
                    flexShrink:   0,
                    display:      "flex",
                    flexDirection: "column",
                    borderRight:  "1px solid rgba(56,189,248,0.08)",
                    background:   "rgba(15,23,42,0.5)",
                }}>
                    {/* TV player */}
                    <div style={{ padding: 16, borderBottom: "1px solid rgba(56,189,248,0.08)", flexShrink: 0 }}>
                        {/* 16:9 iframe */}
                        <div style={{ position: "relative", paddingBottom: "56.25%", background: "#000", borderRadius: 8, overflow: "hidden" }}>
                            <iframe
                                key={channel.id}
                                src={channel.src}
                                title={channel.name}
                                allow="autoplay; encrypted-media"
                                allowFullScreen
                                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                            />
                        </div>

                        {/* Channel controls */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                            <button
                                onClick={prevChannel}
                                style={{ background: "rgba(56,189,248,0.08)", border: "none", borderRadius: 4, color: "#94a3b8", padding: "7px 12px", cursor: "pointer", fontSize: 13 }}
                            >
                                &#9664;
                            </button>

                            <div style={{ textAlign: "center" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "pulse 2s infinite" }} />
                                    <span style={{ color: "#ef4444", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em" }}>LIVE</span>
                                </div>
                                <div style={{ color: "#e2e8f0", fontSize: 12, marginTop: 4 }}>{channel.name}</div>
                                <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10, marginTop: 2 }}>{channelIdx + 1} / {channels.length}</div>
                            </div>

                            <button
                                onClick={nextChannel}
                                style={{ background: "rgba(56,189,248,0.08)", border: "none", borderRadius: 4, color: "#94a3b8", padding: "7px 12px", cursor: "pointer", fontSize: 13 }}
                            >
                                &#9654;
                            </button>
                        </div>
                    </div>

                    {/* Filters (news section only) */}
                    {section === "news" && (
                        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                            <div style={{ marginBottom: 20 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 10 }}>
                                    Region
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {WORLD_REGIONS.map(r => (
                                        <button
                                            key={r}
                                            onClick={() => setRegionFilter(r)}
                                            style={{
                                                padding:      "5px 10px",
                                                fontSize:     11,
                                                border:       `1px solid ${regionFilter === r ? "rgba(56,189,248,0.4)" : "rgba(255,255,255,0.08)"}`,
                                                borderRadius: 4,
                                                background:   regionFilter === r ? "rgba(56,189,248,0.12)" : "rgba(255,255,255,0.03)",
                                                color:        regionFilter === r ? "#38bdf8" : "rgba(255,255,255,0.4)",
                                                cursor:       "pointer",
                                                transition:   "all 0.1s",
                                            }}
                                        >
                                            {r}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 10 }}>
                                    Category
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {CATEGORIES.map(c => (
                                        <button
                                            key={c}
                                            onClick={() => setCategoryFilter(c)}
                                            style={{
                                                padding:      "5px 10px",
                                                fontSize:     11,
                                                border:       `1px solid ${categoryFilter === c ? "rgba(56,189,248,0.4)" : "rgba(255,255,255,0.08)"}`,
                                                borderRadius: 4,
                                                background:   categoryFilter === c ? "rgba(56,189,248,0.12)" : "rgba(255,255,255,0.03)",
                                                color:        categoryFilter === c ? "#38bdf8" : "rgba(255,255,255,0.4)",
                                                cursor:       "pointer",
                                                transition:   "all 0.1s",
                                            }}
                                        >
                                            {c}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Space sidebar — channel list */}
                    {section === "space" && (
                        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 12 }}>
                                Channels
                            </div>
                            {SPACE_CHANNELS.map((ch, i) => (
                                <button
                                    key={ch.id}
                                    onClick={() => setChannelIdx(i)}
                                    style={{
                                        display:      "block",
                                        width:        "100%",
                                        textAlign:    "left",
                                        padding:      "10px 12px",
                                        marginBottom: 6,
                                        border:       `1px solid ${channelIdx === i ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.06)"}`,
                                        borderRadius: 6,
                                        background:   channelIdx === i ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.02)",
                                        color:        channelIdx === i ? "#a78bfa" : "rgba(255,255,255,0.5)",
                                        fontSize:     12,
                                        cursor:       "pointer",
                                        transition:   "all 0.1s",
                                    }}
                                >
                                    {ch.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Article grid ─────────────────────────────────────────── */}
                <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                    {loading ? (
                        <div style={{
                            display:             "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                            gap:                 16,
                        }}>
                            {Array.from({ length: 9 }).map((_, i) => (
                                <div key={i} style={{
                                    height:       220,
                                    borderRadius: 8,
                                    background:   "rgba(30,41,59,0.5)",
                                    animation:    "pulse 1.5s infinite",
                                }} />
                            ))}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div style={{ color: "rgba(255,255,255,0.28)", textAlign: "center", paddingTop: 60, fontSize: 13 }}>
                            {articles.length === 0
                                ? "No articles loaded — check console for fetch errors."
                                : "No articles match this filter."}
                            <div style={{ fontSize: 11, marginTop: 8, color: "rgba(255,255,255,0.18)" }}>
                                {articles.length > 0 && `${articles.length} total articles loaded.`}
                            </div>
                        </div>
                    ) : (
                        <div style={{
                            display:             "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                            gap:                 16,
                        }}>
                            {filtered.map((a, i) => {
                                const title   = a.headline || a.clean_title || a.title || "Untitled"
                                const ts      = a.latest_event || a.published_at || a.timestamp || a.published
                                const tier    = a.severity_tier
                                const tierCol = TIER_COLOR[tier]
                                const href    = a.url || a.link
                                const src     = a.source_name || a.source || ""
                                const img     = a.image_url || a.og_image || null

                                return (
                                    <div
                                        key={a.id || i}
                                        onClick={() => href && window.open(href, "_blank")}
                                        style={{
                                            display:       "flex",
                                            flexDirection: "column",
                                            background:    "rgba(30,41,59,0.6)",
                                            border:        `1px solid ${tier ? tierCol + "33" : "rgba(56,189,248,0.08)"}`,
                                            borderRadius:  8,
                                            overflow:      "hidden",
                                            cursor:        href ? "pointer" : "default",
                                            transition:    "transform 0.15s, border-color 0.15s",
                                        }}
                                        onMouseOver={e => {
                                            e.currentTarget.style.transform   = "translateY(-2px)"
                                            e.currentTarget.style.borderColor = tier ? tierCol + "66" : "rgba(56,189,248,0.25)"
                                        }}
                                        onMouseOut={e => {
                                            e.currentTarget.style.transform   = "none"
                                            e.currentTarget.style.borderColor = tier ? tierCol + "33" : "rgba(56,189,248,0.08)"
                                        }}
                                    >
                                        {/* Image / gradient placeholder */}
                                        <div style={{
                                            height:     130,
                                            flexShrink: 0,
                                            background: img
                                                ? `url(${img}) center/cover`
                                                : "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
                                            position:   "relative",
                                        }}>
                                            {/* Source badge */}
                                            {src && (
                                                <span style={{
                                                    position:     "absolute",
                                                    top:          8,
                                                    left:         8,
                                                    background:   "rgba(15,23,42,0.88)",
                                                    padding:      "3px 7px",
                                                    borderRadius: 3,
                                                    fontSize:     9,
                                                    fontWeight:   600,
                                                    color:        "rgba(255,255,255,0.55)",
                                                    letterSpacing: "0.04em",
                                                }}>
                                                    {src}
                                                </span>
                                            )}
                                            {/* Tier badge */}
                                            {tier && (
                                                <span style={{
                                                    position:     "absolute",
                                                    top:          8,
                                                    right:        8,
                                                    background:   `${tierCol}cc`,
                                                    padding:      "3px 7px",
                                                    borderRadius: 3,
                                                    fontSize:     9,
                                                    fontWeight:   700,
                                                    color:        "#fff",
                                                    textTransform: "uppercase",
                                                    letterSpacing: "0.06em",
                                                }}>
                                                    {tier}
                                                </span>
                                            )}
                                        </div>

                                        {/* Content */}
                                        <div style={{ padding: "12px 14px 14px", flex: 1, display: "flex", flexDirection: "column" }}>
                                            <div style={{
                                                fontSize:           13,
                                                fontWeight:         500,
                                                color:              "#e2e8f0",
                                                lineHeight:         1.45,
                                                flex:               1,
                                                display:            "-webkit-box",
                                                WebkitLineClamp:    3,
                                                WebkitBoxOrient:    "vertical",
                                                overflow:           "hidden",
                                            }}>
                                                {title}
                                            </div>

                                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.28)" }}>
                                                <span>{formatAge(ts)}</span>
                                                {(a.region || a.country) && (
                                                    <span style={{ color: "rgba(56,189,248,0.55)" }}>{a.region || a.country}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
