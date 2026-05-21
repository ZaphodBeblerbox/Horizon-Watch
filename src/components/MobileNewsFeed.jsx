/**
 * MobileNewsFeed.jsx — TikTok-style full-screen vertical news feed for mobile.
 * Self-fetching: receives a `tab` prop and picks the right endpoint.
 * Includes a YouTube LIVE NEWS reels section at the top.
 */
import { useState, useEffect, useRef } from "react"
import API_BASE from "../apiBase.js"
import NewsReels from "./NewsReels.jsx"

// ── Endpoint mapping ──────────────────────────────────────────────────────────
const ENDPOINTS = {
  world:      "/news-conflicts",
  spaceflight:"/api/news/spaceflight",
  stocks:     "/api/news/stocks",
  Paris:      "/api/news/city/Paris",
  Berlin:     "/api/news/city/Berlin",
  Dubai:      "/api/news/city/Dubai",
  Dakar:      "/api/news/city/Dakar",
  Hannover:   "/api/news/city/Hannover",
  Magdeburg:  "/api/news/city/Magdeburg",
}

function safeArray(v) {
  return Array.isArray(v) ? v : []
}

function extractArticles(data) {
  if (Array.isArray(data))                          return data
  if (data && Array.isArray(data.articles))         return data.articles
  if (data && Array.isArray(data.items))            return data.items
  if (data && Array.isArray(data.markers))          return data.markers
  if (data && Array.isArray(data.results))          return data.results
  return []
}

function normalize(item) {
  return {
    title:    item.headline || item.title  || item.name       || "",
    link:     item.url      || item.link   || item.article_url || "#",
    source:   item.source_name || item.source || item.feed_source || item.publisher || "",
    time:     item.published   || item.timestamp || item.pubDate || item.date || item.created_at || "",
    summary:  item.summary     || item.description || item.excerpt || item.context || "",
    image:    item.image_url   || item.image || item.thumbnail || null,
    severity: item.severity_tier || item.severity || null,
    tier:     item.confidence  || null,
    location: item.location_name || item.location || null,
    lang:     item.language    || item.lang || null,
  }
}

function timeAgo(ts) {
  if (!ts) return ""
  try {
    const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
    if (m < 1)    return "now"
    if (m < 60)   return m + "m"
    if (m < 1440) return Math.floor(m / 60) + "h"
    return Math.floor(m / 1440) + "d"
  } catch { return "" }
}

const SEVERITY_STYLE = {
  critical:    { bg: "rgba(255,40,40,0.3)",   color: "#ff8888", border: "rgba(255,40,40,0.5)"   },
  significant: { bg: "rgba(255,140,0,0.25)",  color: "#ffcc80", border: "rgba(255,140,0,0.4)"   },
  elevated:    { bg: "rgba(255,200,0,0.2)",   color: "#ffe566", border: "rgba(255,200,0,0.35)"  },
  low:         { bg: "rgba(0,200,120,0.18)",  color: "#6ee7b7", border: "rgba(0,200,120,0.3)"   },
}

// ── YouTube Reels Section ─────────────────────────────────────────────────────

function ReelsSkeleton() {
  return (
    <div style={{
      background: "rgba(10,18,35,0.95)", borderRadius: 12, padding: 12,
      marginBottom: 16, border: "1px solid rgba(255,255,255,0.08)",
    }}>
      {/* Header skeleton */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(255,59,48,0.4)" }} />
        <div style={{ width: 80, height: 10, borderRadius: 4, background: "rgba(255,255,255,0.08)" }} />
      </div>
      {/* Video skeleton */}
      <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: 8, background: "rgba(255,255,255,0.06)", marginBottom: 8 }} />
      {/* Pills skeleton */}
      <div style={{ display: "flex", gap: 6 }}>
        {[70, 50, 80, 55].map((w, i) => (
          <div key={i} style={{ width: w, height: 24, borderRadius: 20, background: "rgba(255,255,255,0.06)" }} />
        ))}
      </div>
    </div>
  )
}

function LiveNewsReels() {
  const [reels,        setReels]       = useState([])
  const [reelIndex,    setReelIndex]   = useState(0)
  const [reelsLoading, setReelsLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/api/news/reels`)
      .then(r => r.json())
      .then(data => {
        setReels(safeArray(data.videos))
        setReelsLoading(false)
      })
      .catch(() => setReelsLoading(false))
  }, [])

  // Auto-advance every 45 seconds
  useEffect(() => {
    if (reels.length === 0) return
    const timer = setInterval(() => {
      setReelIndex(i => (i + 1) % reels.length)
    }, 45000)
    return () => clearInterval(timer)
  }, [reels.length])

  if (reelsLoading) return <ReelsSkeleton />
  if (reels.length === 0) return (
    <div style={{
      background: "rgba(10,18,35,0.95)", borderRadius: 12, padding: "14px 12px",
      marginBottom: 16, border: "1px solid rgba(255,255,255,0.08)",
      fontSize: 11, color: "rgba(255,255,255,0.3)", textAlign: "center",
    }}>
      Live news unavailable
    </div>
  )

  const current    = reels[reelIndex]
  const channels   = [...new Set(reels.map(v => v.channel))]

  const goToChannel = (ch) => {
    const idx = reels.findIndex(v => v.channel === ch)
    if (idx !== -1) setReelIndex(idx)
  }

  return (
    <div style={{
      background: "rgba(10,18,35,0.95)", borderRadius: 12, padding: 12,
      marginBottom: 16, border: "1px solid rgba(255,255,255,0.08)",
    }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FF3B30", boxShadow: "0 0 6px #FF3B30" }} />
          <span style={{ fontSize: 11, color: "#FF3B30", fontWeight: 700, letterSpacing: "1px" }}>LIVE NEWS</span>
        </div>
        <span style={{ fontSize: 10, color: "#636366" }}>
          {channels.slice(0, 4).join(" · ")}{channels.length > 4 ? " …" : ""}
        </span>
      </div>

      {/* YouTube iframe */}
      <iframe
        key={current?.video_id}
        src={current?.embed_url}
        title={current?.title}
        style={{
          width: "100%", aspectRatio: "16/9",
          border: "none", borderRadius: 8, display: "block",
        }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />

      {/* Video info */}
      <div style={{ padding: "8px 2px 4px" }}>
        <div style={{ fontSize: 12, color: "#34AADC", fontWeight: 600 }}>{current?.channel}</div>
        <div style={{ fontSize: 13, color: "white", marginTop: 2, lineHeight: 1.3,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {current?.title}
        </div>
        <div style={{ fontSize: 11, color: "#636366", marginTop: 2 }}>{timeAgo(current?.published)}</div>
      </div>

      {/* Prev / counter / next */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <button
          onClick={() => setReelIndex(i => (i - 1 + reels.length) % reels.length)}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 18, cursor: "pointer", padding: "0 4px" }}
        >◀</button>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{reelIndex + 1} / {reels.length}</span>
        <button
          onClick={() => setReelIndex(i => (i + 1) % reels.length)}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 18, cursor: "pointer", padding: "0 4px" }}
        >▶</button>
      </div>

      {/* Navigation dots */}
      <div style={{ display: "flex", gap: 4, justifyContent: "center", marginBottom: 10 }}>
        {reels.slice(0, 30).map((_, i) => (
          <div
            key={i}
            onClick={() => setReelIndex(i)}
            style={{
              width: i === reelIndex ? 16 : 6, height: 6, borderRadius: 3,
              background: i === reelIndex ? "#34AADC" : "rgba(255,255,255,0.3)",
              cursor: "pointer", transition: "all 0.2s", flexShrink: 0,
            }}
          />
        ))}
      </div>

      {/* Channel pills */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2,
        scrollbarWidth: "none", msOverflowStyle: "none" }}>
        {channels.map(ch => (
          <button
            key={ch}
            onClick={() => goToChannel(ch)}
            style={{
              flexShrink: 0, padding: "4px 10px", borderRadius: 20,
              border: `1px solid ${current?.channel === ch ? "#34AADC" : "rgba(255,255,255,0.12)"}`,
              background: current?.channel === ch ? "rgba(52,170,220,0.15)" : "rgba(255,255,255,0.05)",
              color: current?.channel === ch ? "#34AADC" : "rgba(255,255,255,0.55)",
              fontSize: 10, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}
          >
            {ch}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main feed component ───────────────────────────────────────────────────────

export default function MobileNewsFeed({ tab = "world" }) {
  const [articles,   setArticles]   = useState([])
  const [idx,        setIdx]        = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [err,        setErr]        = useState(null)
  const [showReels,  setShowReels]  = useState(false)
  const yStart = useRef(0)
  const tStart = useRef(0)

  useEffect(() => {
    setLoading(true)
    setErr(null)
    setIdx(0)

    const endpoint = ENDPOINTS[tab] || ENDPOINTS.world
    const url      = `${API_BASE}${endpoint}`
    const token    = localStorage.getItem("hw-auth-token")

    console.log("[FEED] Fetching:", url)

    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => {
        if (!r.ok) throw new Error("HTTP " + r.status)
        return r.json()
      })
      .then(data => {
        console.log("[FEED] Response keys:", Object.keys(data || {}))
        const raw  = extractArticles(data)
        console.log("[FEED] Extracted:", raw.length, "items")
        const arts = raw.map(normalize).filter(a => a.title)
        arts.sort((a, b) => (b.time || "").localeCompare(a.time || ""))
        setArticles(arts)
        setLoading(false)
      })
      .catch(e => {
        console.error("[FEED] Error:", e)
        setErr(e.message)
        setLoading(false)
      })
  }, [tab])

  const onTouchStart = e => {
    yStart.current = e.touches[0].clientY
    tStart.current = Date.now()
  }
  const onTouchEnd = e => {
    const dy  = yStart.current - e.changedTouches[0].clientY
    const vel = Math.abs(dy) / (Date.now() - tStart.current)
    if ((Math.abs(dy) > 50 || vel > 0.28)) {
      if (dy > 0 && idx < articles.length - 1) setIdx(i => i + 1)
      if (dy < 0 && idx > 0)                   setIdx(i => i - 1)
    }
  }

  if (loading) return (
    <div style={{ position:"fixed", inset:0, background:"#000", display:"flex", alignItems:"center", justifyContent:"center", color:"white", flexDirection:"column", gap:12, zIndex:100 }}>
      <div style={{ width:36, height:36, border:"3px solid rgba(255,255,255,0.1)", borderTopColor:"#00aaff", borderRadius:"50%", animation:"mf-spin 1s linear infinite" }} />
      <div style={{ fontSize:14, color:"rgba(255,255,255,0.5)" }}>Loading {tab}…</div>
      <style>{`@keyframes mf-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  if (err || articles.length === 0) return (
    <div style={{ position:"fixed", inset:0, background:"#0a1628", display:"flex", alignItems:"center", justifyContent:"center", color:"white", flexDirection:"column", gap:16, zIndex:100, padding:24, textAlign:"center" }}>
      <div style={{ color: "rgba(0,170,255,0.6)" }}>
        <svg width="40" height="40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="8" x2="8" y2="15"/>
          <path d="M5 7C5 4.5 11 4.5 11 7"/>
          <path d="M2.5 5.5C2.5 1.5 13.5 1.5 13.5 5.5"/>
          <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>
        </svg>
      </div>
      <div style={{ fontSize:16, fontWeight:600 }}>{err ? `Error: ${err}` : `No articles for "${tab}"`}</div>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>
        {ENDPOINTS[tab] || ENDPOINTS.world}
      </div>
      <button
        onClick={() => { setLoading(true); setErr(null); }}
        style={{ padding:"10px 24px", background:"rgba(0,170,255,0.2)", border:"1px solid rgba(0,170,255,0.4)", color:"white", borderRadius:20, cursor:"pointer", fontSize:14 }}
      >Retry</button>
    </div>
  )

  const a = articles[idx]
  const sev = SEVERITY_STYLE[a.severity] || null
  const maxSegs  = Math.min(articles.length, 30)
  const segStep  = Math.ceil(articles.length / maxSegs)
  const activeSeg = Math.floor(idx / segStep)

  return (
    <div style={{ position:"fixed", inset:0, background:"#000", zIndex:100, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>

      {/* ── Full-screen reels overlay ───────────────────────────────── */}
      {showReels && <NewsReels onClose={() => setShowReels(false)} />}

      {/* ── LIVE NEWS entry button + inline reels section ──────────── */}
      <div style={{ padding: "calc(max(16px, env(safe-area-inset-top)) + 8px) 16px 0" }}>
        {/* Entry button → full-screen TikTok-style view */}
        <button
          onClick={() => setShowReels(true)}
          style={{
            width: "100%", background: "rgba(255,59,48,0.08)",
            border: "1px solid rgba(255,59,48,0.25)", borderRadius: 10,
            padding: "10px 16px", display: "flex", alignItems: "center",
            gap: 10, cursor: "pointer", marginBottom: 12, fontFamily: "inherit",
          }}
        >
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#FF3B30", boxShadow: "0 0 8px #FF3B30",
            animation: "mf-pulse 1.5s infinite", flexShrink: 0,
          }} />
          <div style={{ textAlign: "left" }}>
            <div style={{ color: "#FF3B30", fontSize: 12, fontWeight: 700, letterSpacing: 0.8 }}>
              LIVE NEWS REELS
            </div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, marginTop: 1 }}>
              Al Jazeera · BBC · France 24 · DW · Reuters
            </div>
          </div>
          <div style={{ marginLeft: "auto", color: "rgba(255,255,255,0.3)", fontSize: 16 }}>›</div>
        </button>

        <LiveNewsReels />
      </div>

      {/* ── Article swipe section ───────────────────────────────────── */}
      <div
        style={{ position:"relative", touchAction:"pan-y", userSelect:"none", WebkitUserSelect:"none" }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Background */}
        <div style={{ position:"relative", overflow:"hidden", borderRadius:12, margin:"0 16px", minHeight: 480 }}>
          <div style={{ position:"absolute", inset:0 }}>
            {a.image ? (
              <img
                src={a.image} alt=""
                style={{ width:"100%", height:"100%", objectFit:"cover" }}
                onError={e => { e.target.style.display = "none" }}
              />
            ) : (
              <div style={{ width:"100%", height:"100%", background:"linear-gradient(135deg, #0a1628 0%, #1a2f4e 50%, #0f1e35 100%)" }} />
            )}
            <div style={{ position:"absolute", inset:0, background:"linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.1) 30%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0.88) 100%)" }} />
          </div>

          {/* Progress bar */}
          <div style={{ position:"absolute", top:12, left:12, right:12, display:"flex", gap:3, height:3, zIndex:10 }}>
            {Array.from({ length: maxSegs }, (_, i) => (
              <div key={i} style={{
                flex:1, borderRadius:2,
                background: i === activeSeg ? "#00aaff"
                          : i < activeSeg  ? "rgba(255,255,255,0.55)"
                          :                  "rgba(255,255,255,0.18)",
                transition: "background 300ms",
              }} />
            ))}
          </div>

          {/* Counter */}
          <div style={{ position:"absolute", top:20, right:12, color:"rgba(255,255,255,0.6)", fontSize:12, fontWeight:600, background:"rgba(0,0,0,0.35)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)", padding:"3px 9px", borderRadius:10, zIndex:10 }}>
            {idx + 1} / {articles.length}
          </div>

          {/* Content */}
          <div
            key={idx}
            style={{ position:"relative", minHeight: 480, display:"flex", flexDirection:"column", justifyContent:"flex-end", padding:"24px 18px 20px", zIndex:2, animation:"mf-slide 300ms ease-out" }}
          >
            {/* Badges */}
            <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
              {sev && a.severity && (
                <span style={{ padding:"3px 9px", borderRadius:4, fontSize:10, fontWeight:700, letterSpacing:0.8, background:sev.bg, color:sev.color, border:`1px solid ${sev.border}` }}>
                  {a.severity.toUpperCase()}
                </span>
              )}
              {a.lang && a.lang !== "en" && (
                <span style={{ padding:"3px 9px", borderRadius:4, fontSize:10, fontWeight:700, background:"rgba(255,255,255,0.12)", color:"rgba(255,255,255,0.7)", border:"1px solid rgba(255,255,255,0.2)" }}>
                  {a.lang.toUpperCase()}
                </span>
              )}
            </div>

            {/* Source + time */}
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginBottom:7 }}>
              {[a.source, a.location, timeAgo(a.time)].filter(Boolean).join(" · ")}
            </div>

            {/* Title */}
            <h2 style={{ fontSize:22, fontWeight:800, color:"white", lineHeight:1.25, margin:"0 0 10px", textShadow:"0 2px 8px rgba(0,0,0,0.8)", letterSpacing:"-0.3px" }}>
              {a.title}
            </h2>

            {/* Summary */}
            {a.summary && (
              <p style={{ fontSize:13, color:"rgba(255,255,255,0.82)", lineHeight:1.5, margin:"0 0 14px", textShadow:"0 1px 4px rgba(0,0,0,0.7)", display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical", overflow:"hidden" }}>
                {a.summary}
              </p>
            )}

            {/* Read button */}
            <a
              href={a.link} target="_blank" rel="noopener noreferrer"
              style={{ display:"block", padding:"12px 20px", borderRadius:100, background:"rgba(0,170,255,0.88)", color:"white", textDecoration:"none", fontWeight:600, fontSize:14, textAlign:"center" }}
            >
              Read Article
            </a>

            {/* Swipe hint */}
            {idx === 0 && articles.length > 1 && (
              <div style={{ textAlign:"center", marginTop:14, color:"rgba(255,255,255,0.45)", fontSize:12, animation:"mf-bounce 2s ease-in-out infinite" }}>
                ↑ Swipe up for next
              </div>
            )}
          </div>
        </div>

        <div style={{ height: "calc(max(24px, env(safe-area-inset-bottom)) + 16px)" }} />
      </div>

      <style>{`
        @keyframes mf-slide  { from { transform:translateY(28px); opacity:0; } to { transform:translateY(0); opacity:1; } }
        @keyframes mf-bounce { 0%,100% { transform:translateY(0); opacity:0.45; } 50% { transform:translateY(-7px); opacity:1; } }
        @keyframes mf-spin   { to { transform:rotate(360deg); } }
        @keyframes mf-pulse  { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      `}</style>
    </div>
  )
}
