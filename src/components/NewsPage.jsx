import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import API_BASE from "../apiBase.js"
import { TV_CHANNELS as RAW_CHANNELS } from "./tvchannels.js"
import MobileNewsFeed from "./MobileNewsFeed.jsx"

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

// ── Lazy OG image hook ─────────────────────────────────────────────────────────
const _ogCache = {}
function useOGImage(href, initialImg) {
    const [img, setImg] = useState(initialImg || null)
    const tried = useRef(false)
    useEffect(() => {
        if (img || tried.current || !href) return
        tried.current = true
        if (_ogCache[href] !== undefined) { setImg(_ogCache[href]); return }
        fetch(`${API_BASE}/api/og?url=${encodeURIComponent(href)}`)
            .then(r => r.json())
            .then(d => { _ogCache[href] = d.thumbnail || null; setImg(d.thumbnail || null) })
            .catch(() => { _ogCache[href] = null })
    }, [href, img])
    return img
}

// ── Desktop article card ───────────────────────────────────────────────────────
function ArticleCard({ a, borderOverride }) {
    const title   = a.headline || a.clean_title || a.title || "Untitled"
    const ts      = a.latest_event || a.published_at || a.timestamp || a.published
    const tier    = a.severity_tier
    const tierCol = TIER_COLOR[tier]
    const href    = a.url || a.link
    const src     = a.source_name || a.source || ""
    const img     = useOGImage(href, a.image_url || a.og_image || null)
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
    const img    = useOGImage(href, a.image_url || a.og_image || null)

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

// ── City news panel ───────────────────────────────────────────────────────────
const SORT_BTNS = [["latest","Latest"],["source","Source"],["tier","Tier"]]

function SortControls({ sortBy, setSortBy }) {
    return (
        <div style={{ display: "flex", gap: 6 }}>
            {SORT_BTNS.map(([v, l]) => (
                <button key={v} onClick={() => setSortBy(v)} style={{
                    padding:      "5px 11px",
                    fontSize:     11,
                    border:       `1px solid ${sortBy === v ? "rgba(56,189,248,0.4)" : "rgba(255,255,255,0.08)"}`,
                    borderRadius: 4,
                    background:   sortBy === v ? "rgba(56,189,248,0.12)" : "rgba(255,255,255,0.03)",
                    color:        sortBy === v ? "#38bdf8" : "rgba(255,255,255,0.4)",
                    cursor:       "pointer",
                    transition:   "all 0.1s",
                }}>{l}</button>
            ))}
        </div>
    )
}

function PanelFeaturedCard({ a, accentColor = "rgba(239,68,68,0.3)" }) {
    const title   = a.headline || a.clean_title || a.title || "Untitled"
    const ts      = a.latest_event || a.published_at || a.timestamp || a.published
    const tier    = a.severity_tier
    const tierCol = TIER_COLOR[tier] || null
    const href    = a.url || a.link
    const src     = a.source_name || a.source || ""
    const img     = a.image_url || a.og_image || null
    const summary = a.summary || a.auto_brief || a.description || ""
    const badge   = a.tier || tier || null
    const tierBadgeColor = {
        local: "#22d3ee", regional: "#f59e0b", international: "#4ade80",
        critical: "#ef4444", significant: "#f97316", elevated: "#eab308", low: "#0d9488",
    }[badge] || "#38bdf8"
    const border  = tierCol ? tierCol + "44" : accentColor

    return (
        <div
            onClick={() => href && window.open(href, "_blank")}
            style={{
                display:      "flex",
                minHeight:    220,
                marginBottom: 16,
                borderRadius: 10,
                overflow:     "hidden",
                border:       `1px solid ${border}`,
                background:   "rgba(30,41,59,0.8)",
                cursor:       href ? "pointer" : "default",
                transition:   "border-color 0.15s",
            }}
            onMouseOver={e => { e.currentTarget.style.borderColor = border.replace("44","88") }}
            onMouseOut={e => { e.currentTarget.style.borderColor = border }}
        >
            <div style={{
                width: "45%", flexShrink: 0,
                background: img
                    ? `url(${img}) center/cover`
                    : "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
                position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
                {!img && (
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <line x1="7" y1="8" x2="17" y2="8"/>
                        <line x1="7" y1="12" x2="17" y2="12"/>
                        <line x1="7" y1="16" x2="12" y2="16"/>
                    </svg>
                )}
                {badge && (
                    <span style={{
                        position: "absolute", top: 12, left: 12,
                        background: tierBadgeColor + "dd",
                        padding: "5px 10px", borderRadius: 4, color: "#fff",
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                    }}>{badge}</span>
                )}
                {src && (
                    <span style={{
                        position: "absolute", bottom: 12, left: 12,
                        background: "rgba(15,23,42,0.88)", padding: "3px 7px",
                        borderRadius: 3, fontSize: 9, color: "rgba(255,255,255,0.5)", fontWeight: 600,
                    }}>{src}</span>
                )}
            </div>
            <div style={{ flex: 1, padding: "20px 22px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.45, color: "#e2e8f0", marginBottom: 10 }}>
                    {title}
                </div>
                {summary && (
                    <div style={{
                        fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.55,
                        display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
                        marginBottom: 12,
                    }}>{summary}</div>
                )}
                <span style={{ color: "#64748b", fontSize: 11 }}>{formatAge(ts)}</span>
            </div>
        </div>
    )
}

function CityNewsPanel({ city }) {
    const [articles,  setArticles]  = useState([])
    const [loading,   setLoading]   = useState(true)
    const [cityMeta,  setCityMeta]  = useState(null)
    const [updatedAt, setUpdatedAt] = useState(null)
    const [sortBy,    setSortBy]    = useState("latest")

    useEffect(() => {
        let cancelled = false
        const doFetch = () => {
            const token = localStorage.getItem("hw-auth-token")
            const headers = token ? { Authorization: `Bearer ${token}` } : {}
            fetch(`${API_BASE}/api/news/city/${encodeURIComponent(city)}`, { headers })
                .then(r => r.json())
                .then(data => {
                    if (cancelled) return
                    setArticles(data.articles || [])
                    setCityMeta({ country: data.country, language: data.language })
                    setUpdatedAt(new Date().toLocaleTimeString())
                    setLoading(false)
                })
                .catch(e => { console.error("[city-news]", e); if (!cancelled) setLoading(false) })
        }
        setLoading(true)
        doFetch()
        const interval = setInterval(doFetch, 300000)
        return () => { cancelled = true; clearInterval(interval) }
    }, [city])

    const sorted = useMemo(() => {
        const arr = [...articles]
        if (sortBy === "source") arr.sort((a, b) => (a.source || "").localeCompare(b.source || ""))
        else if (sortBy === "tier") {
            const order = { local: 0, regional: 1, international: 2 }
            arr.sort((a, b) => (order[a.tier] ?? 3) - (order[b.tier] ?? 3))
        }
        return arr
    }, [articles, sortBy])

    if (loading) return (
        <div style={{ padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
                {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} style={{ height: 200, borderRadius: 8, background: "rgba(30,41,59,0.5)", animation: "pulse 1.5s infinite" }} />
                ))}
            </div>
        </div>
    )

    return (
        <div style={{ padding: 20 }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0" }}>{city}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.32)", marginTop: 2 }}>
                        {cityMeta?.country}{cityMeta?.language && ` · ${cityMeta.language.toUpperCase()}`}
                        {` · ${articles.length} articles`}{updatedAt && ` · updated ${updatedAt}`}
                    </div>
                </div>
                <SortControls sortBy={sortBy} setSortBy={setSortBy} />
            </div>

            {sorted.length === 0 ? (
                <div style={{ textAlign: "center", padding: "50px 0", color: "rgba(255,255,255,0.25)", fontSize: 14 }}>
                    No recent articles for {city}
                </div>
            ) : (
                <>
                    <PanelFeaturedCard a={sorted[0]} accentColor="rgba(0,200,255,0.2)" />
                    {sorted.length > 1 && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
                            {sorted.slice(1).map((a, i) => (
                                <ArticleCard key={i} a={a} borderOverride="rgba(0,200,255,0.1)" />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

// ── Markets / Stocks panel ─────────────────────────────────────────────────────
function Sparkline({ values, positive }) {
    if (!values || values.length < 2) return null
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const W = 80, H = 32
    const pts = values.map((v, i) => {
        const x = (i / (values.length - 1)) * W
        const y = H - ((v - min) / range) * H
        return `${x},${y}`
    }).join(" ")
    return (
        <svg width={W} height={H} style={{ display: "block" }}>
            <polyline points={pts} fill="none" stroke={positive ? "#4ade80" : "#f87171"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    )
}

function MarketsPanel() {
    const [indices,       setIndices]       = useState([])
    const [indicesLoading,setIndicesLoading]= useState(true)
    const [stockArticles, setStockArticles] = useState([])
    const [stockLoading,  setStockLoading]  = useState(true)
    const [sortBy,        setSortBy]        = useState("latest")

    useEffect(() => {
        let cancelled = false
        const fetchAll = () => {
            const token = localStorage.getItem("hw-auth-token")
            const h = token ? { Authorization: `Bearer ${token}` } : {}
            // Indices
            fetch(`${API_BASE}/api/stocks/indices`, { headers: h })
                .then(r => r.json())
                .then(d => { if (!cancelled) { setIndices(d.indices || []); setIndicesLoading(false) } })
                .catch(() => { if (!cancelled) setIndicesLoading(false) })
            // News
            fetch(`${API_BASE}/api/news/stocks`, { headers: h })
                .then(r => r.json())
                .then(d => { if (!cancelled) { setStockArticles(d.articles || []); setStockLoading(false) } })
                .catch(() => { if (!cancelled) setStockLoading(false) })
        }
        fetchAll()
        const interval = setInterval(fetchAll, 300000)
        return () => { cancelled = true; clearInterval(interval) }
    }, [])

    const sortedArticles = useMemo(() => {
        const arr = [...stockArticles]
        if (sortBy === "source") arr.sort((a, b) => (a.source || "").localeCompare(b.source || ""))
        return arr
    }, [stockArticles, sortBy])

    return (
        <div style={{ padding: 20 }}>
            {/* ── Ticker strip ── */}
            <div style={{
                display:       "flex",
                gap:           10,
                overflowX:     "auto",
                scrollbarWidth:"none",
                paddingBottom: 16,
                marginBottom:  16,
                borderBottom:  "1px solid rgba(255,255,255,0.06)",
                WebkitOverflowScrolling: "touch",
            }}>
                {indicesLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} style={{ width: 140, height: 80, flexShrink: 0, borderRadius: 8, background: "rgba(30,41,59,0.5)", animation: "pulse 1.5s infinite" }} />
                    ))
                ) : indices.map(idx => {
                    const pos = idx.change_pct >= 0
                    const chgColor = pos ? "#4ade80" : "#f87171"
                    return (
                        <div key={idx.symbol} style={{
                            flexShrink:   0,
                            width:        148,
                            padding:      "12px 14px",
                            background:   "rgba(30,41,59,0.7)",
                            border:       `1px solid ${pos ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
                            borderRadius: 8,
                        }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                                <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{idx.name}</div>
                                    <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginTop: 2 }}>
                                        {idx.price >= 1000 ? idx.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : idx.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    </div>
                                </div>
                                <span style={{ fontSize: 11, fontWeight: 700, color: chgColor, marginTop: 2 }}>
                                    {pos ? "+" : ""}{idx.change_pct.toFixed(2)}%
                                </span>
                            </div>
                            <Sparkline values={idx.sparkline} positive={pos} />
                        </div>
                    )
                })}
            </div>

            {/* ── News grid ── */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>
                    Markets News{!stockLoading && ` · ${stockArticles.length} articles`}
                </div>
                <SortControls sortBy={sortBy} setSortBy={setSortBy} />
            </div>

            {stockLoading ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} style={{ height: 200, borderRadius: 8, background: "rgba(30,41,59,0.5)", animation: "pulse 1.5s infinite" }} />
                    ))}
                </div>
            ) : sortedArticles.length === 0 ? (
                <div style={{ textAlign: "center", padding: "50px 0", color: "rgba(255,255,255,0.25)", fontSize: 14 }}>No markets articles loaded.</div>
            ) : (
                <>
                    <PanelFeaturedCard a={sortedArticles[0]} accentColor="rgba(74,222,128,0.2)" />
                    {sortedArticles.length > 1 && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
                            {sortedArticles.slice(1).map((a, i) => (
                                <ArticleCard key={i} a={a} borderOverride="rgba(74,222,128,0.1)" />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function NewsPage({ onClose }) {
    const [articles,       setArticles]       = useState([])
    const [loading,        setLoading]        = useState(true)
    const [fetchError,     setFetchError]     = useState(null)
    const [retryCount,     setRetryCount]     = useState(0)
    const [lastUpdated,    setLastUpdated]    = useState(null)
    const [section,        setSection]        = useState("news")
    const [activeTab,      setActiveTab]      = useState("world")    // "world" | "spaceflight" | city name
    const [cities,         setCities]         = useState([])
    const [spaceArticles,  setSpaceArticles]  = useState([])
    const [spaceLoading,   setSpaceLoading]   = useState(false)
    const [channelIdx,     setChannelIdx]     = useState(0)
    const [regionFilter,   setRegionFilter]   = useState("All")
    const [categoryFilter, setCategoryFilter] = useState("All")
    const [tvCollapsed,    setTvCollapsed]    = useState(true)
    const [isMobile,       setIsMobile]       = useState(() => window.innerWidth < 768)
    const [viewMode,       setViewMode]       = useState(() => window.innerWidth < 768 ? "feed" : "grid")
    const retryTimerRef = useRef(null)

    useEffect(() => {
        const h = () => {
            const mobile = window.innerWidth < 768
            setIsMobile(mobile)
            if (!mobile) setViewMode("grid")
        }
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    const channels = section === "space" ? SPACE_CHANNELS : TV_CHANNELS
    const channel  = channels[channelIdx] || channels[0]

    // ── Fetch from /api/surface with auto-retry ──────────────────────────────
    const fetchNews = useCallback(async (isRetry = false) => {
        if (!isRetry) setLoading(true)
        try {
            const token = localStorage.getItem("hw-auth-token")
            const res  = await fetch(`${API_BASE}/api/surface`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            const items = data.items || []
            setArticles(items)
            setFetchError(null)
            if (items.length > 0) {
                setLastUpdated(new Date().toLocaleTimeString())
                setRetryCount(0)
                if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null }
            } else {
                // Empty response — schedule retry if under limit
                setRetryCount(c => {
                    const next = c + 1
                    if (next <= 3) {
                        retryTimerRef.current = setTimeout(() => fetchNews(true), 10000)
                    }
                    return next
                })
            }
        } catch (e) {
            console.error("[news] fetch error:", e)
            setFetchError(e.message)
            setArticles([])
            setRetryCount(c => {
                const next = c + 1
                if (next <= 3) {
                    retryTimerRef.current = setTimeout(() => fetchNews(true), 10000)
                }
                return next
            })
        } finally {
            setLoading(false)
        }
    }, [])  // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        fetchNews()
        return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current) }
    }, [fetchNews])

    // ── Load available cities ─────────────────────────────────────────────────
    useEffect(() => {
        fetch(`${API_BASE}/api/news/cities`)
            .then(r => r.json())
            .then(data => setCities(data.cities || []))
            .catch(e => console.error("[city-list] fetch error:", e))
    }, [])

    // ── Fetch spaceflight articles when that tab is active ────────────────────
    useEffect(() => {
        if (activeTab !== "spaceflight") return
        setSpaceLoading(true)
        const token = localStorage.getItem("hw-auth-token")
        fetch(`${API_BASE}/api/news/spaceflight`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
            .then(r => r.json())
            .then(data => { setSpaceArticles(data.articles || []); setSpaceLoading(false) })
            .catch(e => { console.error("[spaceflight] fetch error:", e); setSpaceLoading(false) })
    }, [activeTab])

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

    // ── Articles for TikTok feed (world + spaceflight; cities handled separately) ─
    const feedArticles = section === "space" ? spaceArticles : filtered

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
                {articles.length === 0 ? (
                    <>
                        {fetchError
                            ? <span style={{ color: "#f87171" }}>Feed error: {fetchError}</span>
                            : retryCount > 0 && retryCount <= 3
                                ? <span>News feeds loading… retrying ({retryCount}/3)</span>
                                : retryCount > 3
                                    ? <span>News feeds unavailable{lastUpdated ? ` — last update: ${lastUpdated}` : ""}. <button onClick={() => { setRetryCount(0); fetchNews() }} style={{ background: "none", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}>Retry now</button></span>
                                    : <span>No articles loaded.</span>
                        }
                    </>
                ) : "No articles match this filter."}
                {articles.length > 0 && (
                    <div style={{ fontSize: 11, marginTop: 8, color: "rgba(255,255,255,0.18)" }}>
                        {articles.length} articles{lastUpdated ? ` · updated ${lastUpdated}` : ""}
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

    // ── Compact tab list used by feed mode overlay tab bar ───────────────────
    // Map section name → MobileNewsFeed tab key
    const sectionToFeedTab = (s) => {
        if (s === "news")   return "world"
        if (s === "space")  return "spaceflight"
        if (s.startsWith("city:")) return s.replace("city:", "")
        return "world"
    }

    const ALL_TABS_MOBILE = [
        { id: "news",       label: "World",      section: "news"    },
        { id: "spaceflight",label: "Space",      section: "space"   },
        { id: "stocks",     label: "Markets",    section: "markets" },
        ...cities.map(c => ({ id: `city:${c.name}`, label: c.name, section: `city:${c.name}` })),
    ]

    // ─────────────────────────────────────────────────────────────────────────
    // MOBILE LAYOUT
    // ─────────────────────────────────────────────────────────────────────────
    if (isMobile) {
        // ── FEED MODE ───────────────────────────────────────────────────────
        if (viewMode === "feed" && section !== "markets") {
            const feedTab = sectionToFeedTab(section)
            return (
                <>
                    <style>{`
                        .mobile-view-toggle {
                            position: fixed;
                            top: max(14px, env(safe-area-inset-top));
                            left: 14px;
                            width: 34px; height: 34px;
                            border-radius: 50%;
                            background: rgba(0,0,0,0.55);
                            backdrop-filter: blur(12px);
                            -webkit-backdrop-filter: blur(12px);
                            border: 1px solid rgba(255,255,255,0.14);
                            color: white;
                            font-size: 16px;
                            cursor: pointer;
                            z-index: 200;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .mobile-feed-tabs {
                            position: fixed;
                            top: max(56px, calc(env(safe-area-inset-top) + 42px));
                            left: 0; right: 0;
                            z-index: 200;
                            padding: 0 52px 0 14px;
                            pointer-events: none;
                        }
                        .mobile-feed-tabs-scroll {
                            display: flex;
                            gap: 5px;
                            overflow-x: auto;
                            -webkit-overflow-scrolling: touch;
                            scrollbar-width: none;
                            pointer-events: auto;
                            padding-bottom: 2px;
                        }
                        .mobile-feed-tabs-scroll::-webkit-scrollbar { display: none; }
                        .mobile-feed-tabs-scroll button {
                            flex-shrink: 0;
                            padding: 5px 11px;
                            border-radius: 100px;
                            background: rgba(0,0,0,0.42);
                            backdrop-filter: blur(8px);
                            -webkit-backdrop-filter: blur(8px);
                            border: 1px solid rgba(255,255,255,0.1);
                            color: rgba(255,255,255,0.65);
                            font-size: 11px;
                            font-weight: 500;
                            cursor: pointer;
                            white-space: nowrap;
                            font-family: system-ui,-apple-system,sans-serif;
                        }
                        .mobile-feed-tabs-scroll button.active {
                            background: rgba(0,170,255,0.28);
                            border-color: rgba(0,170,255,0.48);
                            color: white;
                            font-weight: 600;
                        }
                    `}</style>

                    {/* View-mode toggle: feed → grid */}
                    <button
                        className="mobile-view-toggle"
                        onClick={() => setViewMode("grid")}
                        title="Switch to list view"
                    >⊞</button>

                    {/* Compact tab bar */}
                    <div className="mobile-feed-tabs">
                        <div className="mobile-feed-tabs-scroll">
                            {ALL_TABS_MOBILE.map(t => (
                                <button
                                    key={t.id}
                                    className={section === t.section ? "active" : ""}
                                    onClick={() => switchSection(t.section)}
                                >{t.label}</button>
                            ))}
                        </div>
                    </div>

                    {/* Full-screen self-fetching feed */}
                    <MobileNewsFeed tab={feedTab} />
                </>
            )
        }

        // ── GRID MODE (or markets/city which have their own layout) ─────────
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

                    {/* Section tabs — scrollable with city tabs */}
                    <div style={{
                        display: "flex", gap: 0, padding: "4px 12px 0",
                        borderBottom: "1px solid rgba(56,189,248,0.08)",
                        overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch",
                    }}>
                        {sectionTab("news", "World News")}
                        {sectionTab("space", "Spaceflight")}
                        {sectionTab("markets", "Markets")}
                        {cities.map(c => sectionTab(`city:${c.name}`, c.name))}
                        {/* Feed mode toggle */}
                        <button
                            onClick={() => setViewMode("feed")}
                            style={{
                                padding: "8px 14px", fontSize: 12, fontWeight: 400,
                                background: "transparent", border: "none",
                                borderBottom: "2px solid transparent",
                                color: "#64748b", cursor: "pointer", whiteSpace: "nowrap",
                                transition: "color 0.12s", WebkitTapHighlightColor: "transparent",
                                marginLeft: 4,
                            }}
                        >▤ Feed</button>
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
                    padding:   (section.startsWith("city:") || section === "markets") ? 0 : "0 16px",
                    WebkitOverflowScrolling: "touch",
                }}>
                    {section === "markets" ? (
                        <MarketsPanel />
                    ) : section.startsWith("city:") ? (
                        <CityNewsPanel city={section.replace("city:", "")} />
                    ) : (loading || filtered.length === 0) ? renderEmpty() : (
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

                {/* Scrollable tab bar */}
                <div style={{
                    display: "flex", gap: 4, marginLeft: 8, overflowX: "auto", scrollbarWidth: "none",
                    WebkitOverflowScrolling: "touch", flexShrink: 1, minWidth: 0,
                }}>
                    {[{ id: "world", label: "World News" }, { id: "spaceflight", label: "Spaceflight" }, { id: "markets", label: "Markets" }].concat(
                        cities.map(c => ({ id: c.name, label: c.name }))
                    ).map(tab => (
                        <button key={tab.id} onClick={() => { setActiveTab(tab.id); if (tab.id === "world" || tab.id === "spaceflight") switchSection(tab.id === "world" ? "news" : "space") }} style={{
                            padding:      "5px 13px",
                            fontSize:     12,
                            fontWeight:   activeTab === tab.id ? 600 : 400,
                            border:       `1px solid ${activeTab === tab.id ? "rgba(56,189,248,0.4)" : "transparent"}`,
                            borderRadius: 6,
                            background:   activeTab === tab.id ? "rgba(56,189,248,0.12)" : "transparent",
                            color:        activeTab === tab.id ? "#38bdf8" : "rgba(255,255,255,0.4)",
                            cursor:       "pointer",
                            whiteSpace:   "nowrap",
                            flexShrink:   0,
                            transition:   "all 0.12s",
                        }}>
                            {tab.label}
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

                {/* Article feed / city panel / spaceflight panel / markets panel */}
                <div style={{ flex: 1, overflowY: "auto" }}>
                    {activeTab === "markets" ? (
                        <MarketsPanel />
                    ) : activeTab !== "world" && activeTab !== "spaceflight" ? (
                        <CityNewsPanel city={activeTab} />
                    ) : activeTab === "spaceflight" ? (
                        <div style={{ padding: 20 }}>
                            {spaceLoading ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                    {Array.from({ length: 8 }).map((_, i) => (
                                        <div key={i} style={{ height: 80, borderRadius: 8, background: "rgba(30,41,59,0.5)", animation: "pulse 1.5s infinite" }} />
                                    ))}
                                </div>
                            ) : spaceArticles.length === 0 ? (
                                <div style={{ textAlign: "center", paddingTop: 60, color: "rgba(255,255,255,0.28)", fontSize: 13 }}>No spaceflight articles loaded.</div>
                            ) : (
                                <>
                                    {renderFeatured(spaceArticles[0])}
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
                                        {spaceArticles.slice(1).map((a, i) => (
                                            <ArticleCard key={i} a={a} />
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        /* World News */
                        <div style={{ padding: 20 }}>
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
                    )}
                </div>
            </div>
        </div>
    )
}
