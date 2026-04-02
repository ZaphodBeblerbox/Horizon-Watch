import { useState, useEffect, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { TV_CHANNELS as RAW_CHANNELS } from "./tvchannels.js"

// Build embed URLs from verified youtubeId list in tvchannels.js
const YT = (id) => `https://www.youtube.com/embed/${id}?autoplay=1&mute=1`

const TV_CHANNELS = RAW_CHANNELS.map(ch => ({
    id:   String(ch.id),
    name: ch.name,
    src:  YT(ch.youtubeId),
}))

// Space streams are only live during events; fallback shown when no stream is active
const SPACE_CHANNELS = [
    { id: "nasa",     name: "NASA TV",              src: YT("21X5lGlDOfg") },
    { id: "spacex",   name: "SpaceX",               src: YT("w7kxSPqMzPw") },
    { id: "everyday", name: "Everyday Astronaut",   src: YT("5HqXGeDuWnE") },
]

const WORLD_REGIONS = ["All", "Africa", "Middle East", "Europe", "Asia", "Americas"]
const CATEGORIES    = ["All", "Conflict", "Politics", "Technology", "Business", "Science", "Space"]

// Keyword lists for region matching — checked against article region field AND headline text
const REGION_KEYWORDS = {
    Africa:       ["africa", "nigeria", "kenya", "sudan", "ethiopia", "somalia", "congo", "egypt", "south africa", "ghana", "tanzania", "uganda", "morocco", "algeria", "libya", "mozambique", "zimbabwe", "rwanda", "mali", "sahel", "senegal", "cameroon", "angola"],
    "Middle East": ["middle east", "israel", "iran", "iraq", "syria", "lebanon", "jordan", "saudi", "yemen", "qatar", "uae", "emirates", "kuwait", "bahrain", "oman", "palestine", "gaza", "west bank", "hezbollah", "hamas", "houthi"],
    Europe:       ["europe", "uk", "france", "germany", "italy", "spain", "poland", "ukraine", "russia", "netherlands", "belgium", "sweden", "norway", "greece", "turkey", "balkans", "nato", "eu ", "european union", "denmark", "finland", "czech"],
    Asia:         ["asia", "china", "japan", "korea", "india", "pakistan", "indonesia", "vietnam", "thailand", "philippines", "taiwan", "singapore", "malaysia", "bangladesh", "myanmar", "afghanistan", "kashmir", "xinjiang", "south china sea"],
    Americas:     ["america", "usa", "u.s.", "united states", "canada", "mexico", "brazil", "argentina", "colombia", "venezuela", "chile", "peru", "cuba", "haiti", "caribbean", "latin america"],
}

const SPACE_KEYWORDS = [
    "space", "nasa", "spacex", "rocket", "satellite", "orbit", "launch",
    "asteroid", "moon", "mars", "jupiter", "saturn", "starship", "falcon",
    "astronaut", "cosmonaut", "iss ", "space station", "starlink", "crew dragon",
    "artemis", "james webb", "telescope", "cosmos", "galaxy", "meteor",
    "rocket lab", "blue origin", "virgin galactic", "esa", "jaxa", "isro",
    "spacenews", "nasaspaceflight", "universe today", "spaceflight",
]

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

// ── Desktop article card ───────────────────────────────────────────────────────
function ArticleCard({ a, borderOverride }) {
    const title   = a.headline || a.clean_title || a.title || "Untitled"
    const ts      = a.latest_event || a.published_at || a.timestamp || a.published
    const tier    = a.severity_tier
    const tierCol = TIER_COLOR[tier]
    const href    = a.url || a.link
    const src     = a.source_name || a.source || ""
    const img     = a.image_url || a.og_image || null
    const border  = borderOverride || (tier ? tierCol + "33" : "rgba(56,189,248,0.08)")
    const hoverBorder = borderOverride
        ? borderOverride.replace("33", "66")
        : (tier ? tierCol + "66" : "rgba(56,189,248,0.25)")

    return (
        <div
            onClick={() => href && window.open(href, "_blank")}
            style={{
                display:       "flex",
                flexDirection: "column",
                background:    "rgba(30,41,59,0.6)",
                border:        `1px solid ${border}`,
                borderRadius:  8,
                overflow:      "hidden",
                cursor:        href ? "pointer" : "default",
                transition:    "transform 0.15s, border-color 0.15s",
                height:        "100%",
            }}
            onMouseOver={e => {
                e.currentTarget.style.transform   = "translateY(-2px)"
                e.currentTarget.style.borderColor = hoverBorder
            }}
            onMouseOut={e => {
                e.currentTarget.style.transform   = "none"
                e.currentTarget.style.borderColor = border
            }}
        >
            {/* Image / placeholder */}
            <div style={{
                height:         130,
                flexShrink:     0,
                background:     img
                    ? `url(${img}) center/cover`
                    : "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
                position:       "relative",
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
            }}>
                {!img && (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <line x1="7" y1="8"  x2="17" y2="8"/>
                        <line x1="7" y1="12" x2="17" y2="12"/>
                        <line x1="7" y1="16" x2="12" y2="16"/>
                    </svg>
                )}
                {src && (
                    <span style={{
                        position:      "absolute",
                        top:           8,
                        left:          8,
                        background:    "rgba(15,23,42,0.88)",
                        padding:       "3px 7px",
                        borderRadius:  3,
                        fontSize:      9,
                        fontWeight:    600,
                        color:         "rgba(255,255,255,0.55)",
                        letterSpacing: "0.04em",
                    }}>
                        {src}
                    </span>
                )}
                {tier && (
                    <span style={{
                        position:      "absolute",
                        top:           8,
                        right:         8,
                        background:    `${tierCol}cc`,
                        padding:       "3px 7px",
                        borderRadius:  3,
                        fontSize:      9,
                        fontWeight:    700,
                        color:         "#fff",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                    }}>
                        {tier}
                    </span>
                )}
            </div>

            {/* Text */}
            <div style={{ padding: "12px 14px 14px", flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{
                    fontSize:        13,
                    fontWeight:      500,
                    color:           "#e2e8f0",
                    lineHeight:      1.45,
                    flex:            1,
                    display:         "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow:        "hidden",
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
}

// ── Mobile news card (Ground News style) ──────────────────────────────────────
function MobileNewsCard({ a }) {
    const title  = a.headline || a.clean_title || a.title || "Untitled"
    const ts     = a.latest_event || a.published_at || a.timestamp || a.published
    const tier   = a.severity_tier
    const tierC  = TIER_COLOR[tier]
    const href   = a.url || a.link
    const src    = a.source_name || a.source || ""
    const img    = a.image_url || a.og_image || null

    const barWidth = tier === "critical" ? "100%" : tier === "significant" ? "75%" : tier === "elevated" ? "50%" : tier === "low" ? "25%" : null

    return (
        <div
            onClick={() => href && window.open(href, "_blank")}
            style={{
                display:      "flex",
                gap:          12,
                padding:      "14px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                cursor:       href ? "pointer" : "default",
                WebkitTapHighlightColor: "transparent",
            }}
        >
            {/* Left: text content */}
            <div style={{ flex: 1, minWidth: 0 }}>
                {/* Meta row */}
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                    <span style={{
                        color:         tierC || "#38bdf8",
                        fontSize:      10,
                        fontWeight:    700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        flexShrink:    0,
                    }}>
                        {tier || a.event_type || "News"}
                    </span>
                    <span style={{
                        color:        "#64748b",
                        fontSize:     10,
                        textAlign:    "right",
                        overflow:     "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace:   "nowrap",
                    }}>
                        {a.region || a.country || ""}
                    </span>
                </div>

                {/* Headline */}
                <div style={{
                    color:               "#e2e8f0",
                    fontSize:            14,
                    fontWeight:          500,
                    lineHeight:          1.45,
                    marginBottom:        10,
                    display:             "-webkit-box",
                    WebkitLineClamp:     3,
                    WebkitBoxOrient:     "vertical",
                    overflow:            "hidden",
                }}>
                    {title}
                </div>

                {/* Severity bar */}
                {barWidth && (
                    <div style={{ height: 3, borderRadius: 2, background: "rgba(148,163,184,0.12)", marginBottom: 8, overflow: "hidden" }}>
                        <div style={{ width: barWidth, height: "100%", background: tierC }} />
                    </div>
                )}

                {/* Source + time */}
                <div style={{ display: "flex", gap: 6, color: "#64748b", fontSize: 11, flexWrap: "wrap" }}>
                    {src && <span>{src}</span>}
                    {src && ts && <span>·</span>}
                    {ts && <span>{formatAge(ts)}</span>}
                </div>
            </div>

            {/* Right: thumbnail */}
            {img ? (
                <div style={{
                    width:       72,
                    height:      72,
                    borderRadius: 6,
                    background:  `url(${img}) center/cover`,
                    flexShrink:  0,
                }} />
            ) : (
                <div style={{
                    width:          72,
                    height:         72,
                    borderRadius:   6,
                    background:     "rgba(30,41,59,0.8)",
                    flexShrink:     0,
                    display:        "flex",
                    alignItems:     "center",
                    justifyContent: "center",
                }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <line x1="7" y1="8"  x2="17" y2="8"/>
                        <line x1="7" y1="12" x2="17" y2="12"/>
                        <line x1="7" y1="16" x2="12" y2="16"/>
                    </svg>
                </div>
            )}
        </div>
    )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function NewsPage({ onClose }) {
    const [articles,       setArticles]       = useState([])
    const [loading,        setLoading]        = useState(true)
    const [section,        setSection]        = useState("news")
    const [channelIdx,     setChannelIdx]     = useState(0)
    const [regionFilter,   setRegionFilter]   = useState("All")
    const [categoryFilter, setCategoryFilter] = useState("All")
    const [tvCollapsed,    setTvCollapsed]    = useState(true)
    const [isMobile,       setIsMobile]       = useState(() => window.innerWidth < 768)

    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    const channels = section === "space" ? SPACE_CHANNELS : TV_CHANNELS
    const channel  = channels[channelIdx] || channels[0]

    // ── Fetch from /api/surface ───────────────────────────────────────────────
    const fetchNews = useCallback(async () => {
        setLoading(true)
        try {
            const token = localStorage.getItem("hw-auth-token")
            const res  = await fetch(`${API_BASE}/api/surface`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            })
            const data = await res.json()
            setArticles(data.items || [])
        } catch (e) {
            console.error("[news] fetch error:", e)
            setArticles([])
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchNews() }, [fetchNews])

    // ── Channel navigation ────────────────────────────────────────────────────
    const prevChannel   = () => setChannelIdx(i => (i === 0 ? channels.length - 1 : i - 1))
    const nextChannel   = () => setChannelIdx(i => (i === channels.length - 1 ? 0 : i + 1))
    const switchSection = (s) => { setSection(s); setChannelIdx(0) }

    // ── Filter ────────────────────────────────────────────────────────────────
    const filtered = articles.filter(a => {
        const text   = (a.headline || a.clean_title || a.title || "").toLowerCase()
        const srcStr = (a.source_name || a.source || "").toLowerCase()

        if (section === "space") {
            return SPACE_KEYWORDS.some(k => text.includes(k) || srcStr.includes(k))
        }

        if (regionFilter !== "All") {
            const regionText = (a.region || a.country || a.location || "").toLowerCase()
            const keywords   = REGION_KEYWORDS[regionFilter] || []
            if (!keywords.some(kw => regionText.includes(kw) || text.includes(kw))) return false
        }

        if (categoryFilter !== "All") {
            const type = (a.event_type || "").toLowerCase()
            switch (categoryFilter) {
                case "Conflict":   if (!["armed_clash","missile","airstrike","explosion","battle","violence"].includes(type)) return false; break
                case "Politics":   if (!text.match(/politi|govern|election|minister|president|coup|parliament/)) return false; break
                case "Technology": if (!text.match(/tech|ai |cyber|digital|software|hack|drone/))               return false; break
                case "Business":   if (!text.match(/econom|market|trade|company|invest|sanction|oil|gas/))      return false; break
                case "Science":    if (!text.match(/science|research|study|discover|climate|disease/))           return false; break
                case "Space":      if (!SPACE_KEYWORDS.some(k => text.includes(k)))                             return false; break
                default: break
            }
        }

        return true
    })

    // ── Featured card — desktop only (first item as wide card) ───────────────
    const renderFeatured = (a) => {
        const title   = a.headline || a.clean_title || a.title || "Untitled"
        const ts      = a.latest_event || a.published_at || a.timestamp || a.published
        const tier    = a.severity_tier
        const tierCol = TIER_COLOR[tier] || "#ef4444"
        const href    = a.url || a.link
        const src     = a.source_name || a.source || ""
        const img     = a.image_url || a.og_image || null
        const summary = a.summary || a.auto_brief || a.description || ""

        return (
            <div
                onClick={() => href && window.open(href, "_blank")}
                style={{
                    display:      "flex",
                    minHeight:    220,
                    marginBottom: 20,
                    borderRadius: 10,
                    overflow:     "hidden",
                    border:       `1px solid ${tier ? tierCol + "44" : "rgba(239,68,68,0.3)"}`,
                    background:   "rgba(30,41,59,0.8)",
                    cursor:       href ? "pointer" : "default",
                    transition:   "border-color 0.15s",
                }}
                onMouseOver={e => { e.currentTarget.style.borderColor = tier ? tierCol + "88" : "rgba(239,68,68,0.5)" }}
                onMouseOut={e => { e.currentTarget.style.borderColor = tier ? tierCol + "44" : "rgba(239,68,68,0.3)" }}
            >
                {/* Image half */}
                <div style={{
                    width:      "45%",
                    flexShrink: 0,
                    background: img
                        ? `url(${img}) center/cover`
                        : "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
                    position:   "relative",
                    display:    "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}>
                    {!img && (
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <line x1="7" y1="8"  x2="17" y2="8"/>
                            <line x1="7" y1="12" x2="17" y2="12"/>
                            <line x1="7" y1="16" x2="12" y2="16"/>
                        </svg>
                    )}
                    <span style={{
                        position:      "absolute",
                        top:           12,
                        left:          12,
                        background:    tier ? `${tierCol}dd` : "#ef4444dd",
                        padding:       "5px 10px",
                        borderRadius:  4,
                        color:         "#fff",
                        fontSize:      10,
                        fontWeight:    700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                    }}>
                        {tier ? tier.toUpperCase() : "BREAKING"}
                    </span>
                </div>

                {/* Text half */}
                <div style={{ flex: 1, padding: "20px 22px", display: "flex", flexDirection: "column" }}>
                    {src && (
                        <span style={{ color: "#94a3b8", fontSize: 11, marginBottom: 8 }}>{src}</span>
                    )}
                    <h2 style={{
                        color:      "#e2e8f0",
                        fontSize:   18,
                        fontWeight: 500,
                        lineHeight: 1.4,
                        marginBottom: 10,
                        flex:       1,
                    }}>
                        {title}
                    </h2>
                    {summary && (
                        <p style={{
                            color:               "#94a3b8",
                            fontSize:            13,
                            lineHeight:          1.6,
                            marginBottom:        12,
                            display:             "-webkit-box",
                            WebkitLineClamp:     2,
                            WebkitBoxOrient:     "vertical",
                            overflow:            "hidden",
                        }}>
                            {summary}
                        </p>
                    )}
                    <span style={{ color: "#64748b", fontSize: 11 }}>{formatAge(ts)}</span>
                </div>
            </div>
        )
    }

    // ── TV player block (shared between mobile collapsed/expanded and desktop) ─
    const renderTVPlayer = (compact) => (
        <div>
            <div style={{ position: "relative", paddingBottom: "56.25%", background: "#000", borderRadius: compact ? 6 : 8, overflow: "hidden" }}>
                <iframe
                    key={channel.id}
                    src={channel.src}
                    title={channel.name}
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: compact ? 8 : 12 }}>
                <button onClick={prevChannel} style={{ background: "rgba(56,189,248,0.08)", border: "none", borderRadius: 4, color: "#94a3b8", padding: "7px 12px", cursor: "pointer", fontSize: 13 }}>&#9664;</button>
                <div style={{ textAlign: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "pulse 2s infinite" }} />
                        <span style={{ color: "#ef4444", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em" }}>LIVE</span>
                    </div>
                    <div style={{ color: "#e2e8f0", fontSize: 12, marginTop: 2 }}>{channel.name}</div>
                    <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10, marginTop: 1 }}>{channelIdx + 1} / {channels.length}</div>
                </div>
                <button onClick={nextChannel} style={{ background: "rgba(56,189,248,0.08)", border: "none", borderRadius: 4, color: "#94a3b8", padding: "7px 12px", cursor: "pointer", fontSize: 13 }}>&#9654;</button>
            </div>
            {section === "space" && (
                <div style={{ marginTop: 8, padding: "7px 10px", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 6, fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>
                    Space streams are only live during launches and events. If inactive, try another channel.
                </div>
            )}
        </div>
    )

    // ── Empty / loading state ─────────────────────────────────────────────────
    const renderEmpty = () => (
        loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} style={{ height: isMobile ? 90 : 220, borderRadius: 8, background: "rgba(30,41,59,0.5)", animation: "pulse 1.5s infinite" }} />
                ))}
            </div>
        ) : (
            <div style={{ color: "rgba(255,255,255,0.28)", textAlign: "center", paddingTop: 60, fontSize: 13 }}>
                {articles.length === 0 ? "No articles loaded — check console for fetch errors." : "No articles match this filter."}
                {articles.length > 0 && (
                    <div style={{ fontSize: 11, marginTop: 8, color: "rgba(255,255,255,0.18)" }}>
                        {articles.length} total articles loaded
                    </div>
                )}
            </div>
        )
    )

    // ── Section tab button helper ─────────────────────────────────────────────
    const sectionTab = (id, label) => (
        <button key={id} onClick={() => switchSection(id)} style={{
            padding:      "8px 16px",
            fontSize:     12,
            fontWeight:   section === id ? 600 : 400,
            background:   "transparent",
            border:       "none",
            borderBottom: `2px solid ${section === id ? "#38bdf8" : "transparent"}`,
            color:        section === id ? "#38bdf8" : "#64748b",
            cursor:       "pointer",
            whiteSpace:   "nowrap",
            transition:   "color 0.12s, border-color 0.12s",
            WebkitTapHighlightColor: "transparent",
        }}>{label}</button>
    )

    // ─────────────────────────────────────────────────────────────────────────
    // MOBILE LAYOUT
    // ─────────────────────────────────────────────────────────────────────────
    if (isMobile) {
        return (
            <div style={{
                display:       "flex",
                flexDirection: "column",
                height:        "100%",
                background:    "rgba(6,14,45,0.97)",
                backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                color:         "#e2e8f0",
                fontFamily:    "Inter, system-ui, -apple-system, sans-serif",
                overflow:      "hidden",
            }}>
                {/* Header */}
                <div style={{
                    flexShrink:   0,
                    background:   "rgba(5,12,38,0.98)",
                    borderBottom: "1px solid rgba(56,189,248,0.1)",
                }}>
                    {/* Title row */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 0" }}>
                        <div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                                {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                            </div>
                            <div style={{ fontSize: 20, fontWeight: 600, color: "#e2e8f0", marginTop: 2 }}>
                                News Feed
                            </div>
                        </div>
                        <button onClick={fetchNews} disabled={loading} style={{
                            padding: "8px 16px", fontSize: 13, fontWeight: 600,
                            border: "1px solid rgba(56,189,248,0.3)",
                            borderRadius: 8,
                            background: "rgba(56,189,248,0.08)",
                            color: loading ? "rgba(56,189,248,0.3)" : "#38bdf8",
                            cursor: loading ? "default" : "pointer",
                            WebkitTapHighlightColor: "transparent",
                        }}>
                            {loading ? "…" : "↻"}
                        </button>
                    </div>

                    {/* Section tabs */}
                    <div style={{ display: "flex", gap: 0, padding: "4px 12px 0", borderBottom: "1px solid rgba(56,189,248,0.08)" }}>
                        {sectionTab("news", "World News")}
                        {sectionTab("space", "Spaceflight")}
                    </div>

                    {/* Region filter — horizontal scroll */}
                    <div style={{
                        display:         "flex",
                        gap:             6,
                        overflowX:       "auto",
                        padding:         "10px 16px",
                        scrollbarWidth:  "none",
                        WebkitOverflowScrolling: "touch",
                    }}>
                        {WORLD_REGIONS.map(r => (
                            <button key={r} onClick={() => setRegionFilter(r)} style={{
                                padding:      "6px 14px",
                                fontSize:     12,
                                fontWeight:   regionFilter === r ? 600 : 400,
                                background:   regionFilter === r ? "rgba(56,189,248,0.15)" : "rgba(30,41,59,0.6)",
                                border:       `1px solid ${regionFilter === r ? "rgba(56,189,248,0.4)" : "transparent"}`,
                                borderRadius: 20,
                                color:        regionFilter === r ? "#38bdf8" : "#94a3b8",
                                cursor:       "pointer",
                                whiteSpace:   "nowrap",
                                transition:   "all 0.12s",
                                WebkitTapHighlightColor: "transparent",
                            }}>{r}</button>
                        ))}
                    </div>
                </div>

                {/* Collapsible TV player */}
                <div style={{
                    flexShrink:   0,
                    background:   "rgba(5,12,38,0.7)",
                    borderBottom: "1px solid rgba(56,189,248,0.08)",
                }}>
                    <div
                        onClick={() => setTvCollapsed(v => !v)}
                        style={{
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "space-between",
                            padding:        "10px 16px",
                            cursor:         "pointer",
                            WebkitTapHighlightColor: "transparent",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
                            <span style={{ color: "#ef4444", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em" }}>LIVE</span>
                            <span style={{ color: "#e2e8f0", fontSize: 13 }}>{channel.name}</span>
                        </div>
                        <span style={{ color: "#64748b", fontSize: 18, lineHeight: 1 }}>
                            {tvCollapsed ? "+" : "−"}
                        </span>
                    </div>
                    {!tvCollapsed && (
                        <div style={{ padding: "0 16px 12px" }}>
                            {renderTVPlayer(true)}
                        </div>
                    )}
                </div>

                {/* Article list */}
                <div style={{
                    flex:      1,
                    overflowY: "auto",
                    padding:   "0 16px",
                    WebkitOverflowScrolling: "touch",
                }}>
                    {(loading || filtered.length === 0) ? renderEmpty() : (
                        filtered.map((a, i) => <MobileNewsCard key={a.id || i} a={a} />)
                    )}
                </div>
            </div>
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DESKTOP LAYOUT
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div style={{
            display:       "flex",
            flexDirection: "column",
            height:        "100%",
            background:    "rgba(6,14,45,0.97)",
            backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
            color:         "#e2e8f0",
            fontFamily:    "Inter, system-ui, -apple-system, sans-serif",
            overflow:      "hidden",
        }}>
            {/* Top bar */}
            <div style={{
                flexShrink:   0,
                height:       52,
                background:   "rgba(5,12,38,0.98)",
                borderBottom: "1px solid rgba(56,189,248,0.2)",
                display:      "flex",
                alignItems:   "center",
                padding:      "0 20px",
                gap:          16,
            }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.2em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
                    Live Intelligence Feed
                </span>

                <div style={{ display: "flex", gap: 4, marginLeft: 12 }}>
                    {[{ id: "news", label: "World News" }, { id: "space", label: "Spaceflight" }].map(s => (
                        <button key={s.id} onClick={() => switchSection(s.id)} style={{
                            padding:      "6px 14px",
                            fontSize:     12,
                            fontWeight:   section === s.id ? 600 : 400,
                            border:       `1px solid ${section === s.id ? "rgba(56,189,248,0.4)" : "transparent"}`,
                            borderRadius: 6,
                            background:   section === s.id ? "rgba(56,189,248,0.12)" : "transparent",
                            color:        section === s.id ? "#38bdf8" : "rgba(255,255,255,0.4)",
                            cursor:       "pointer",
                            transition:   "all 0.12s",
                        }}>
                            {s.label}
                        </button>
                    ))}
                </div>

                <div style={{ flex: 1 }} />

                <button onClick={fetchNews} disabled={loading} style={{
                    padding:      "6px 14px",
                    fontSize:     12,
                    border:       "1px solid rgba(56,189,248,0.25)",
                    borderRadius: 6,
                    background:   "rgba(56,189,248,0.06)",
                    color:        loading ? "rgba(56,189,248,0.3)" : "rgba(56,189,248,0.7)",
                    cursor:       loading ? "default" : "pointer",
                    transition:   "color 0.12s",
                }}>
                    {loading ? "Loading…" : "↻ Reload"}
                </button>
                <button onClick={onClose} style={{
                    padding:      "6px 14px",
                    fontSize:     12,
                    border:       "1px solid rgba(148,163,184,0.25)",
                    borderRadius: 6,
                    background:   "transparent",
                    color:        "rgba(255,255,255,0.4)",
                    cursor:       "pointer",
                }}>
                    Back to Map
                </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

                {/* Left sidebar */}
                <div style={{
                    width:         340,
                    flexShrink:    0,
                    display:       "flex",
                    flexDirection: "column",
                    borderRight:   "1px solid rgba(56,189,248,0.08)",
                    background:    "rgba(5,12,38,0.55)",
                }}>
                    {/* TV player */}
                    <div style={{ padding: 16, borderBottom: "1px solid rgba(56,189,248,0.08)", flexShrink: 0 }}>
                        {renderTVPlayer(false)}
                    </div>

                    {/* Filters (news) or channel list (space) */}
                    {section === "news" ? (
                        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                            <div style={{ marginBottom: 20 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 10 }}>Region</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {WORLD_REGIONS.map(r => (
                                        <button key={r} onClick={() => setRegionFilter(r)} style={{
                                            padding:      "5px 10px",
                                            fontSize:     11,
                                            border:       `1px solid ${regionFilter === r ? "rgba(56,189,248,0.4)" : "rgba(255,255,255,0.08)"}`,
                                            borderRadius: 4,
                                            background:   regionFilter === r ? "rgba(56,189,248,0.12)" : "rgba(255,255,255,0.03)",
                                            color:        regionFilter === r ? "#38bdf8" : "rgba(255,255,255,0.4)",
                                            cursor:       "pointer",
                                            transition:   "all 0.1s",
                                        }}>{r}</button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 10 }}>Category</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {CATEGORIES.map(c => (
                                        <button key={c} onClick={() => setCategoryFilter(c)} style={{
                                            padding:      "5px 10px",
                                            fontSize:     11,
                                            border:       `1px solid ${categoryFilter === c ? "rgba(56,189,248,0.4)" : "rgba(255,255,255,0.08)"}`,
                                            borderRadius: 4,
                                            background:   categoryFilter === c ? "rgba(56,189,248,0.12)" : "rgba(255,255,255,0.03)",
                                            color:        categoryFilter === c ? "#38bdf8" : "rgba(255,255,255,0.4)",
                                            cursor:       "pointer",
                                            transition:   "all 0.1s",
                                        }}>{c}</button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 12 }}>Channels</div>
                            {SPACE_CHANNELS.map((ch, i) => (
                                <button key={ch.id} onClick={() => setChannelIdx(i)} style={{
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
                                }}>{ch.name}</button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Article feed */}
                <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                    {(loading || filtered.length === 0) ? renderEmpty() : (
                        <>
                            {renderFeatured(filtered[0])}
                            {filtered.length > 1 && (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
                                    {filtered.slice(1).map((a, i) => (
                                        <ArticleCard key={a.id || i} a={a} />
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
