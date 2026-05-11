import { useState, useRef, useEffect, useCallback } from "react"
import API_BASE from "../apiBase.js"

function GSIco({ children, color = "currentColor" }) {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={color}
            strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
            style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}>
            {children}
        </svg>
    )
}
function GSGlobe({ color })     { return <GSIco color={color}><circle cx="8" cy="8" r="6"/><path d="M8 2C6.5 5 6.5 11 8 14M8 2C9.5 5 9.5 11 8 14"/><line x1="2.5" y1="8" x2="13.5" y2="8"/></GSIco> }
function GSAnchor({ color })    { return <GSIco color={color}><circle cx="8" cy="4.5" r="2"/><line x1="8" y1="6.5" x2="8" y2="15"/><path d="M4 10C4 10 4 15 8 15C12 15 12 10 12 10"/><line x1="5" y1="4.5" x2="11" y2="4.5"/></GSIco> }
function GSAircraft({ color })  { return <GSIco color={color}><path d="M8 1.5L11.5 8L8 7L4.5 8Z"/><path d="M6 7.5L4 10.5H12L10 7.5"/><line x1="8" y1="10.5" x2="8" y2="14"/><line x1="6" y1="13" x2="10" y2="13"/></GSIco> }
function GSPadlock({ color })   { return <GSIco color={color}><rect x="3" y="8" width="10" height="7" rx="1.5"/><path d="M5 8V6C5 3.8 11 3.8 11 6V8"/></GSIco> }
function GSPerson({ color })    { return <GSIco color={color}><circle cx="8" cy="5.5" r="3"/><path d="M2.5 15C2.5 12 5 9.5 8 9.5C11 9.5 13.5 12 13.5 15"/></GSIco> }
function GSBuilding({ color })  { return <GSIco color={color}><rect x="2" y="6" width="5" height="9"/><rect x="5" y="3" width="7" height="12"/><rect x="10" y="5" width="4" height="10"/><line x1="1" y1="15" x2="15" y2="15"/></GSIco> }
function GSPin({ color })       { return <GSIco color={color}><circle cx="8" cy="6.5" r="3"/><path d="M8 9.5C8 9.5 3 12.5 3 9.5C3 6.5 5 2.5 8 2.5C11 2.5 13 6.5 13 9.5C13 12.5 8 9.5 8 9.5Z"/><line x1="8" y1="13" x2="8" y2="15.5"/></GSIco> }

const TYPE_META = {
    country:    { icon: (c) => <GSGlobe color={c} />,    color: "#38bdf8" },
    port:       { icon: (c) => <GSAnchor color={c} />,   color: "#34d399" },
    airport:    { icon: (c) => <GSAircraft color={c} />, color: "#a78bfa" },
    chokepoint: { icon: (c) => <GSPadlock color={c} />,  color: "#fb923c" },
    poi:        { icon: (c) => <GSPerson color={c} />,   color: "#f472b6" },
    city:       { icon: (c) => <GSBuilding color={c} />, color: "#e2e8f0" },
    address:    { icon: (c) => <GSPin color={c} />,      color: "#94a3b8" },
}

function zoomForType(type, nominatimType) {
    if (type === "country") return 5
    if (type === "port")    return 14
    if (type === "airport") return 14
    if (type === "chokepoint") return 8
    if (type === "poi")     return 13
    if (nominatimType === "city" || nominatimType === "town") return 12
    if (nominatimType === "county" || nominatimType === "state") return 7
    if (nominatimType === "country") return 5
    return 14
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
            label: r.display_name,
            lat:   parseFloat(r.lat),
            lon:   parseFloat(r.lon),
            zoom:  zoomForType(null, r.type || r.addresstype || r.class),
            type:  (r.class === "boundary" || r.type === "administrative") ? "country" : "city",
            sub:   r.display_name.split(",").slice(1, 3).join(",").trim(),
            _nominatimClass: r.class,
            _nominatimType:  r.type,
        }))
    } catch {
        return []
    }
}

async function searchOurDB(query, apiBase) {
    const q = query.toLowerCase()
    const results = []

    try {
        const [ports, airports, chokepoints] = await Promise.allSettled([
            fetch(`${apiBase}/api/infrastructure/ports`).then(r => r.json()).catch(() => ({ ports: [] })),
            fetch(`${apiBase}/api/infrastructure/airports`).then(r => r.json()).catch(() => ({ airports: [] })),
            fetch(`${apiBase}/api/infrastructure/chokepoints`).then(r => r.json()).catch(() => []),
        ])

        const portList = ports.value?.ports || ports.value || []
        const airportList = airports.value?.airports || airports.value || []
        const chokepointList = chokepoints.value || []

        portList.forEach(p => {
            const name = p.name || p.port_name || ""
            if (name.toLowerCase().includes(q)) {
                results.push({
                    id:   "port-" + (p.id || name),
                    name,
                    sub:  p.country || p.region || "Port",
                    lat:  p.lat,
                    lon:  p.lon,
                    zoom: 14,
                    type: "port",
                })
            }
        })

        airportList.forEach(a => {
            const name = a.name || a.airport_name || ""
            const iata = a.iata || ""
            if (name.toLowerCase().includes(q) || iata.toLowerCase().includes(q)) {
                results.push({
                    id:   "apt-" + (a.id || iata || name),
                    name,
                    sub:  a.country || a.municipality || "Airport",
                    lat:  a.lat,
                    lon:  a.lon,
                    zoom: 14,
                    type: "airport",
                })
            }
        })

        chokepointList.forEach(c => {
            const name = c.name || c.properties?.name || ""
            const lat  = c.lat ?? c.center?.[0] ?? c.properties?.lat
            const lon  = c.lon ?? c.center?.[1] ?? c.properties?.lon
            if (name.toLowerCase().includes(q) && lat && lon) {
                results.push({
                    id:   "cp-" + name,
                    name,
                    sub:  "Chokepoint",
                    lat,
                    lon,
                    zoom: 8,
                    type: "chokepoint",
                })
            }
        })
    } catch { /* best-effort */ }

    return results
}

export default function GlobalSearch({ onResult, apiBase = API_BASE }) {
    const [query,    setQuery]    = useState("")
    const [results,  setResults]  = useState([])
    const [open,     setOpen]     = useState(false)
    const [loading,  setLoading]  = useState(false)
    const [focused,  setFocused]  = useState(false)
    const [active,   setActive]   = useState(-1)
    const inputRef   = useRef(null)
    const debounceRef = useRef(null)
    const containerRef = useRef(null)

    // Cmd+K / / to focus
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
        const [nom, db] = await Promise.all([
            searchNominatim(q),
            searchOurDB(q, apiBase),
        ])
        // DB results first (more specific), then Nominatim
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
        if (!open) return
        if (e.key === "ArrowDown")  { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
        if (e.key === "ArrowUp")    { e.preventDefault(); setActive(a => Math.max(a - 1, -1)) }
        if (e.key === "Enter" && active >= 0) { e.preventDefault(); handleSelect(results[active]) }
        if (e.key === "Escape")     { setOpen(false); inputRef.current?.blur() }
    }

    const isMobile = typeof window !== "undefined" && window.innerWidth < 768

    return (
        <div
            ref={containerRef}
            style={{
                position:  "fixed",
                top:       48,
                left:      "50%",
                transform: "translateX(-50%)",
                zIndex:    1200,
                width:     isMobile ? "calc(100vw - 32px)" : 420,
                fontFamily: "system-ui, -apple-system, sans-serif",
            }}
        >
            {/* Search input */}
            <div style={{
                display:        "flex",
                alignItems:     "center",
                gap:            8,
                background:     "rgba(15, 23, 42, 0.92)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                border:         `1px solid ${focused ? "rgba(56,189,248,0.4)" : "rgba(56,189,248,0.18)"}`,
                borderRadius:   open ? "8px 8px 0 0" : 8,
                padding:        "7px 10px",
                transition:     "border-color 0.15s",
            }}>
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke={focused ? "#38bdf8" : "#64748b"} strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0, transition: "stroke 0.15s" }}>
                    <circle cx="6" cy="6" r="4.5"/>
                    <line x1="9.5" y1="9.5" x2="13.5" y2="13.5"/>
                </svg>
                <input
                    ref={inputRef}
                    value={query}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => { setFocused(true); if (results.length > 0) setOpen(true) }}
                    placeholder="Search locations, ports, chokepoints… (⌘K)"
                    style={{
                        flex:        1,
                        background:  "transparent",
                        border:      "none",
                        outline:     "none",
                        color:       "#e2e8f0",
                        fontSize:    13,
                        fontFamily:  "inherit",
                        caretColor:  "#38bdf8",
                    }}
                />
                {loading && (
                    <div style={{
                        width: 12, height: 12, border: "2px solid rgba(56,189,248,0.3)",
                        borderTop: "2px solid #38bdf8", borderRadius: "50%",
                        animation: "gs-spin 0.7s linear infinite", flexShrink: 0,
                    }} />
                )}
                {query && !loading && (
                    <button
                        onClick={() => { setQuery(""); setResults([]); setOpen(false); inputRef.current?.focus() }}
                        style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 0, fontSize: 16, lineHeight: 1, flexShrink: 0 }}
                    >×</button>
                )}
                {!query && (
                    <span style={{ fontSize: 10, color: "rgba(100,116,139,0.6)", fontWeight: 600, flexShrink: 0, border: "1px solid rgba(100,116,139,0.3)", borderRadius: 4, padding: "1px 5px" }}>⌘K</span>
                )}
            </div>

            {/* Results dropdown */}
            {open && results.length > 0 && (
                <div style={{
                    background:     "rgba(10, 18, 40, 0.97)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    border:         "1px solid rgba(56,189,248,0.18)",
                    borderTop:      "1px solid rgba(56,189,248,0.08)",
                    borderRadius:   "0 0 8px 8px",
                    overflow:       "hidden",
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
                                    gap:         10,
                                    padding:     "8px 12px",
                                    cursor:      "pointer",
                                    background:  active === i ? "rgba(56,189,248,0.1)" : "transparent",
                                    borderBottom: i < results.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                                    transition:  "background 0.1s",
                                }}
                            >
                                <span style={{ flexShrink: 0 }}>{meta.icon(meta.color)}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {r.name}
                                    </div>
                                    {r.sub && (
                                        <div style={{ fontSize: 10, color: "rgba(148,163,184,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                                            {r.sub}
                                        </div>
                                    )}
                                </div>
                                <span style={{
                                    fontSize:     9,
                                    fontWeight:   700,
                                    letterSpacing:"0.06em",
                                    textTransform:"uppercase",
                                    color:        meta.color,
                                    opacity:      0.8,
                                    flexShrink:   0,
                                }}>
                                    {r.type}
                                </span>
                            </div>
                        )
                    })}
                </div>
            )}

            <style>{`
                @keyframes gs-spin {
                    from { transform: rotate(0deg); }
                    to   { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    )
}
