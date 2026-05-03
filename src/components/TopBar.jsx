import { useState, useEffect, useRef, useCallback } from "react"
import TabBar from "./TabBar.jsx"
import Logo from "./Logo.jsx"
import API_BASE from "../apiBase.js"

function IconExpand() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1,6 1,1 6,1"/>
            <polyline points="10,1 15,1 15,6"/>
            <polyline points="15,10 15,15 10,15"/>
            <polyline points="6,15 1,15 1,10"/>
        </svg>
    )
}

function IconCompress() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6,1 6,6 1,6"/>
            <polyline points="10,1 10,6 15,6"/>
            <polyline points="15,10 10,10 10,15"/>
            <polyline points="1,10 6,10 6,15"/>
        </svg>
    )
}

// ── Search helpers ────────────────────────────────────────────────────────────

const TYPE_META = {
    country:    { icon: "🌍", color: "#38bdf8" },
    port:       { icon: "⚓", color: "#34d399" },
    airport:    { icon: "✈️", color: "#a78bfa" },
    chokepoint: { icon: "🔒", color: "#fb923c" },
    poi:        { icon: "👤", color: "#f472b6" },
    city:       { icon: "🏙️", color: "#cbd5e1" },
    address:    { icon: "📍", color: "#94a3b8" },
}

function zoomForNominatim(r) {
    const cls  = r.class || ""
    const type = r.type  || r.addresstype || ""
    if (cls === "boundary" || type === "country" || type === "administrative") return 5
    if (type === "city" || type === "town") return 12
    if (type === "suburb" || type === "village") return 14
    return 13
}

async function searchNominatim(query) {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`,
            { headers: { "Accept-Language": "en" } }
        )
        const data = await res.json()
        return data.map(r => ({
            id:    "nom-" + r.place_id,
            name:  r.display_name.split(",")[0],
            sub:   r.display_name.split(",").slice(1, 3).join(",").trim(),
            lat:   parseFloat(r.lat),
            lon:   parseFloat(r.lon),
            zoom:  zoomForNominatim(r),
            type:  (r.class === "boundary" || r.type === "administrative") ? "country" : "city",
        }))
    } catch { return [] }
}

async function searchOurDB(query, apiBase) {
    const q = query.toLowerCase()
    const results = []
    try {
        const [ports, airports, chokepoints] = await Promise.allSettled([
            fetch(`${apiBase}/api/infrastructure/ports`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
            fetch(`${apiBase}/api/infrastructure/airports`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
            fetch(`${apiBase}/api/infrastructure/chokepoints`).then(r => r.ok ? r.json() : []).catch(() => []),
        ])
        ;(ports.value?.ports || ports.value || []).forEach(p => {
            const name = p.name || p.port_name || ""
            if (name.toLowerCase().includes(q)) results.push({ id: "port-" + (p.id || name), name, sub: p.country || "Port", lat: p.lat, lon: p.lon, zoom: 14, type: "port" })
        })
        ;(airports.value?.airports || airports.value || []).forEach(a => {
            const name = a.name || a.airport_name || ""
            const iata = a.iata || ""
            if (name.toLowerCase().includes(q) || iata.toLowerCase().includes(q))
                results.push({ id: "apt-" + (a.id || iata || name), name, sub: a.country || "Airport", lat: a.lat, lon: a.lon, zoom: 14, type: "airport" })
        })
        ;(chokepoints.value || []).forEach(c => {
            const name = c.name || c.properties?.name || ""
            const lat  = c.lat ?? c.center?.[0] ?? c.properties?.lat
            const lon  = c.lon ?? c.center?.[1] ?? c.properties?.lon
            if (name.toLowerCase().includes(q) && lat && lon)
                results.push({ id: "cp-" + name, name, sub: "Chokepoint", lat, lon, zoom: 8, type: "chokepoint" })
        })
    } catch { /* best-effort */ }
    return results
}

// ── Inline search bar ────────────────────────────────────────────────────────

function InlineSearch({ onResult, apiBase }) {
    const [query,    setQuery]    = useState("")
    const [results,  setResults]  = useState([])
    const [open,     setOpen]     = useState(false)
    const [loading,  setLoading]  = useState(false)
    const [active,   setActive]   = useState(-1)
    const [focused,  setFocused]  = useState(false)
    const inputRef    = useRef(null)
    const containerRef = useRef(null)
    const debounceRef = useRef(null)

    // Cmd+K or / to focus
    useEffect(() => {
        const handler = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault()
                inputRef.current?.focus()
            }
            if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
                e.preventDefault()
                inputRef.current?.focus()
            }
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [])

    // Close on outside click
    useEffect(() => {
        const handler = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false)
                setFocused(false)
            }
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [])

    const runSearch = useCallback(async (q) => {
        if (q.trim().length < 2) { setResults([]); setOpen(false); return }
        setLoading(true)
        const [db, nom] = await Promise.all([searchOurDB(q, apiBase), searchNominatim(q)])
        const merged = [...db, ...nom].slice(0, 8)
        setResults(merged)
        setOpen(merged.length > 0)
        setActive(-1)
        setLoading(false)
    }, [apiBase])

    const handleChange = (e) => {
        const val = e.target.value
        setQuery(val)
        clearTimeout(debounceRef.current)
        if (val.trim().length < 2) { setResults([]); setOpen(false); return }
        debounceRef.current = setTimeout(() => runSearch(val), 300)
    }

    const handleSelect = (r) => {
        onResult(r)
        setQuery(r.name)
        setOpen(false)
        inputRef.current?.blur()
    }

    const handleKeyDown = (e) => {
        if (e.key === "ArrowDown")  { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
        if (e.key === "ArrowUp")    { e.preventDefault(); setActive(a => Math.max(a - 1, -1)) }
        if (e.key === "Enter" && active >= 0 && results[active]) { e.preventDefault(); handleSelect(results[active]) }
        if (e.key === "Escape")     { setOpen(false); inputRef.current?.blur() }
    }

    return (
        <div ref={containerRef} style={{ position: "relative", flex: 1, maxWidth: 340, minWidth: 0 }}>
            <div style={{
                display:     "flex",
                alignItems:  "center",
                gap:         6,
                height:      26,
                background:  focused ? "rgba(15,23,42,0.95)" : "rgba(15,23,42,0.6)",
                border:      `1px solid ${focused ? "rgba(56,189,248,0.4)" : "rgba(56,189,248,0.14)"}`,
                borderRadius: open ? "6px 6px 0 0" : 6,
                padding:     "0 8px",
                transition:  "border-color 0.15s, background 0.15s",
            }}>
                {loading ? (
                    <div style={{
                        width: 11, height: 11, flexShrink: 0,
                        border: "1.5px solid rgba(56,189,248,0.3)", borderTop: "1.5px solid #38bdf8",
                        borderRadius: "50%", animation: "tb-spin 0.7s linear infinite",
                    }} />
                ) : (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={focused ? "#38bdf8" : "#475569"} strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0, transition: "stroke 0.15s" }}>
                        <circle cx="5" cy="5" r="3.5"/>
                        <line x1="8" y1="8" x2="11" y2="11"/>
                    </svg>
                )}
                <input
                    ref={inputRef}
                    value={query}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => { setFocused(true); if (results.length > 0) setOpen(true) }}
                    placeholder="Search… (⌘K)"
                    style={{
                        flex:       1,
                        background: "transparent",
                        border:     "none",
                        outline:    "none",
                        color:      "#cbd5e1",
                        fontSize:   11,
                        fontFamily: "system-ui, -apple-system, sans-serif",
                        caretColor: "#38bdf8",
                        minWidth:   0,
                    }}
                />
                {query && (
                    <button
                        onMouseDown={(e) => { e.preventDefault(); setQuery(""); setResults([]); setOpen(false); inputRef.current?.focus() }}
                        style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1, flexShrink: 0 }}
                    >×</button>
                )}
            </div>

            {/* Dropdown */}
            {open && results.length > 0 && (
                <div style={{
                    position:   "absolute",
                    top:        "100%",
                    left:       0,
                    right:      0,
                    background: "rgba(8, 16, 38, 0.98)",
                    backdropFilter: "blur(16px)",
                    WebkitBackdropFilter: "blur(16px)",
                    border:     "1px solid rgba(56,189,248,0.18)",
                    borderTop:  "1px solid rgba(56,189,248,0.08)",
                    borderRadius: "0 0 7px 7px",
                    zIndex:     2000,
                    overflow:   "hidden",
                }}>
                    {results.map((r, i) => {
                        const meta = TYPE_META[r.type] || TYPE_META.city
                        return (
                            <div
                                key={r.id}
                                onMouseEnter={() => setActive(i)}
                                onMouseDown={(e) => { e.preventDefault(); handleSelect(r) }}
                                style={{
                                    display:     "flex",
                                    alignItems:  "center",
                                    gap:         8,
                                    padding:     "7px 10px",
                                    cursor:      "pointer",
                                    background:  active === i ? "rgba(56,189,248,0.1)" : "transparent",
                                    borderBottom: i < results.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                                }}
                            >
                                <span style={{ fontSize: 12, flexShrink: 0 }}>{meta.icon}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                                    {r.sub && <div style={{ fontSize: 10, color: "rgba(148,163,184,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{r.sub}</div>}
                                </div>
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: meta.color, opacity: 0.75, flexShrink: 0 }}>{r.type}</span>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

// ── TopBar ────────────────────────────────────────────────────────────────────

export default function TopBar({
    tabs           = [],
    activeTabId    = null,
    onTabSwitch,
    onTabClose,
    onTabNew,
    onTabReorder,
    onTabRename,
    // Search
    showSearch     = false,
    onSearchResult = null,
    searchApiBase  = API_BASE,
    // Auth
    showSignIn     = false,
    onSignIn       = null,
}) {
    const [time,       setTime]       = useState(new Date())
    const [fullscreen, setFullscreen] = useState(false)
    const [fsHover,    setFsHover]    = useState(false)
    const [isMobile,   setIsMobile]   = useState(() => window.innerWidth < 768)

    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    useEffect(() => {
        const t = setInterval(() => setTime(new Date()), 1000)
        return () => clearInterval(t)
    }, [])

    useEffect(() => {
        const handler = () => setFullscreen(!!document.fullscreenElement)
        document.addEventListener("fullscreenchange", handler)
        return () => document.removeEventListener("fullscreenchange", handler)
    }, [])

    useEffect(() => {
        const handler = (e) => {
            if (e.key !== "f" && e.key !== "F") return
            const tag = document.activeElement?.tagName
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
            toggleFullscreen()
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [fullscreen]) // eslint-disable-line react-hooks/exhaustive-deps

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {})
        } else {
            document.exitFullscreen().catch(() => {})
        }
    }

    const utc   = time.toUTCString()
    const clock = utc.slice(17, 22) + " UTC"

    return (
        <div style={{
            height:       40,
            flexShrink:   0,
            background:   "linear-gradient(180deg, #0d1119 0%, var(--akili-surface) 100%)",
            borderBottom: "1px solid var(--akili-border)",
            display:      "flex",
            alignItems:   "stretch",
            zIndex:       100,
            boxSizing:    "border-box",
            fontFamily:   "system-ui, -apple-system, sans-serif",
        }}>
            <style>{`@keyframes tb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

            {/* Left: Logo + wordmark */}
            <div style={{
                flexShrink:   0,
                display:      "flex",
                alignItems:   "center",
                gap:          9,
                paddingLeft:  12,
                paddingRight: 14,
                userSelect:   "none",
                borderRight:  "1px solid rgba(255,255,255,0.06)",
                minWidth:     isMobile ? "auto" : 172,
            }}>
                <Logo size={48} />
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
                    <span style={{ fontFamily: "system-ui, -apple-system, sans-serif", fontWeight: 800, fontSize: 11, letterSpacing: "0.2em", color: "var(--akili-text-primary)" }}>
                        HORIZON WATCH
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: 8, letterSpacing: "0.12em", color: "rgba(26,110,181,0.65)", marginTop: 2 }}>
                        by Trifecta Technologies
                    </span>
                </div>
            </div>

            {/* Centre: tabs + search */}
            {!isMobile ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0, gap: 8, paddingRight: 8 }}>
                    <TabBar
                        tabs={tabs}
                        activeTabId={activeTabId}
                        height={32}
                        iconSize={14}
                        onSwitch={onTabSwitch}
                        onClose={onTabClose}
                        onNew={onTabNew}
                        onReorder={onTabReorder}
                        onRename={onTabRename}
                        canClose={tab => tab.type !== "map"}
                    />
                    {showSignIn && onSignIn && (
                        <button
                            onClick={onSignIn}
                            style={{
                                flexShrink:    0,
                                padding:       "4px 14px",
                                fontSize:      11,
                                fontWeight:    700,
                                letterSpacing: "0.04em",
                                color:         "var(--akili-accent, #3b82f6)",
                                background:    "rgba(59,130,246,0.10)",
                                border:        "1px solid rgba(59,130,246,0.35)",
                                borderRadius:  6,
                                cursor:        "pointer",
                                whiteSpace:    "nowrap",
                                transition:    "background 0.15s",
                            }}
                        >Sign in</button>
                    )}
                    {showSearch && onSearchResult && (
                        <InlineSearch onResult={onSearchResult} apiBase={searchApiBase} />
                    )}
                </div>
            ) : (
                <div style={{ flex: 1 }} />
            )}

            {/* Right: fullscreen + clock — desktop only */}
            {!isMobile && (
                <div style={{ display: "flex", alignItems: "center", flexShrink: 0, borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
                    <button
                        onClick={toggleFullscreen}
                        onMouseEnter={() => setFsHover(true)}
                        onMouseLeave={() => setFsHover(false)}
                        title={fullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"}
                        style={{
                            width: 36, height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                            background: "none", border: "none", cursor: "pointer", flexShrink: 0,
                            color: fsHover ? "var(--akili-text-secondary)" : "var(--akili-text-muted)",
                            transition: "color 0.12s",
                        }}
                    >
                        {fullscreen ? <IconCompress /> : <IconExpand />}
                    </button>
                    <div style={{ display: "flex", alignItems: "center", paddingLeft: 8, paddingRight: 16, borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
                        <span style={{ fontSize: 11, color: "var(--akili-text-muted)", fontVariantNumeric: "tabular-nums", fontFamily: "monospace", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                            {clock}
                        </span>
                    </div>
                </div>
            )}
        </div>
    )
}
