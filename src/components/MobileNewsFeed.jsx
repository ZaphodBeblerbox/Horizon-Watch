/**
 * MobileNewsFeed.jsx — TikTok-style full-screen vertical news feed for mobile.
 * Self-fetching: receives a `tab` prop and picks the right endpoint.
 */
import { useState, useEffect, useRef } from "react"
import API_BASE from "../apiBase.js"

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

export default function MobileNewsFeed({ tab = "world" }) {
  const [articles, setArticles] = useState([])
  const [idx,      setIdx]      = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState(null)
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
      <div style={{ fontSize:40 }}>📡</div>
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
    <div
      style={{ position:"fixed", inset:0, background:"#000", zIndex:100, touchAction:"pan-y", userSelect:"none", WebkitUserSelect:"none" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Background */}
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
      <div style={{ position:"absolute", top:"max(16px, env(safe-area-inset-top))", left:52, right:16, display:"flex", gap:3, height:3, zIndex:10 }}>
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
      <div style={{ position:"absolute", top:"calc(max(16px, env(safe-area-inset-top)) + 14px)", right:16, color:"rgba(255,255,255,0.6)", fontSize:12, fontWeight:600, background:"rgba(0,0,0,0.35)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)", padding:"3px 9px", borderRadius:10, zIndex:10 }}>
        {idx + 1} / {articles.length}
      </div>

      {/* Content */}
      <div
        key={idx}
        style={{ position:"relative", height:"100%", display:"flex", flexDirection:"column", justifyContent:"flex-end", padding:"24px 22px calc(max(24px, env(safe-area-inset-bottom)) + 16px)", zIndex:2, animation:"mf-slide 300ms ease-out" }}
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
        <h2 style={{ fontSize:24, fontWeight:800, color:"white", lineHeight:1.25, margin:"0 0 10px", textShadow:"0 2px 8px rgba(0,0,0,0.8)", letterSpacing:"-0.3px" }}>
          {a.title}
        </h2>

        {/* Summary */}
        {a.summary && (
          <p style={{ fontSize:14, color:"rgba(255,255,255,0.82)", lineHeight:1.5, margin:"0 0 16px", textShadow:"0 1px 4px rgba(0,0,0,0.7)", display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical", overflow:"hidden" }}>
            {a.summary}
          </p>
        )}

        {/* Read button */}
        <a
          href={a.link} target="_blank" rel="noopener noreferrer"
          style={{ display:"block", padding:"13px 20px", borderRadius:100, background:"rgba(0,170,255,0.88)", color:"white", textDecoration:"none", fontWeight:600, fontSize:14, textAlign:"center" }}
        >
          Read Article
        </a>

        {/* Swipe hint */}
        {idx === 0 && articles.length > 1 && (
          <div style={{ textAlign:"center", marginTop:16, color:"rgba(255,255,255,0.45)", fontSize:12, animation:"mf-bounce 2s ease-in-out infinite" }}>
            ↑ Swipe up for next
          </div>
        )}
      </div>

      <style>{`
        @keyframes mf-slide  { from { transform:translateY(28px); opacity:0; } to { transform:translateY(0); opacity:1; } }
        @keyframes mf-bounce { 0%,100% { transform:translateY(0); opacity:0.45; } 50% { transform:translateY(-7px); opacity:1; } }
        @keyframes mf-spin   { to { transform:rotate(360deg); } }
      `}</style>
    </div>
  )
}
