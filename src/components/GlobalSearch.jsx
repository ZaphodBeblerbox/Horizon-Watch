import { useState, useRef, useEffect, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { markerSvg, AFFILIATION, ENTITY_FUNCTION } from "../globe/markerRenderer.js"

// ── Type metadata ─────────────────────────────────────────────────────────────
// Real symbology (see src/globe/markerRenderer.js) instead of raw emoji —
// every result type is Neutral affiliation (a search result, not a threat
// assessment) with a real entity-function glyph, tinted by the same accent
// colours this table always used.

const TYPE_META = {
    airport:    { entityFunction: ENTITY_FUNCTION.INFRA_AIRPORT, label: "Airport",    color: "#a78bfa" },
    port:       { entityFunction: ENTITY_FUNCTION.INFRA_PORT,    label: "Port",       color: "#34d399" },
    cable:      { entityFunction: ENTITY_FUNCTION.INFRA_CABLE,   label: "Cable",      color: "#fb923c" },
    chokepoint: { entityFunction: ENTITY_FUNCTION.ZONE,          label: "Chokepoint", color: "#fbbf24" },
    assessment: { entityFunction: ENTITY_FUNCTION.NEWS_EVENT,    label: "Assessment", color: "#ef4444" },
    fusion:     { entityFunction: ENTITY_FUNCTION.FUSION,        label: "Fusion",     color: "#8b5cf6" },
    zone:       { entityFunction: ENTITY_FUNCTION.ZONE,          label: "Zone",       color: "#10b981" },
    rule:       { entityFunction: ENTITY_FUNCTION.GENERIC,       label: "Rule",       color: "#6b7280" },
    location:   { entityFunction: ENTITY_FUNCTION.GENERIC,       label: "Location",   color: "#e2e8f0" },
    country:    { entityFunction: ENTITY_FUNCTION.GENERIC,       label: "Country",    color: "#38bdf8" },
    city:       { entityFunction: ENTITY_FUNCTION.GENERIC,       label: "City",       color: "#cbd5e1" },
}

function typeMetaSvg(meta) {
    return markerSvg({
        affiliation: AFFILIATION.NEUTRAL,
        entityFunction: meta.entityFunction,
        accentColor: meta.color,
        size: 16,
    })
}

const FILTER_GROUPS = [
    { id: "all",            label: "All",            types: null },
    { id: "places",         label: "Places",         types: ["airport", "port", "chokepoint", "location", "city", "country"] },
    { id: "infrastructure", label: "Infrastructure", types: ["cable", "zone"] },
    { id: "intelligence",   label: "Intelligence",   types: ["assessment", "fusion"] },
    { id: "rules",          label: "Rules",          types: ["rule"] },
]

function altitudeForResult(r) {
    if (r.type === "airport" || r.type === "port") return 80_000
    if (r.type === "chokepoint" || r.type === "assessment" || r.type === "fusion") return 120_000
    if (r.type === "zone") return 250_000
    if (r.type === "location") {
        const cat = r.category || ""
        if (cat === "country" || cat === "boundary") return 1_000_000
        if (r.osm_type === "relation") return 800_000
        return 50_000
    }
    return 100_000
}

function subtitleForResult(r) {
    if (r.type === "airport") {
        return [r.icao, r.iata, r.country].filter(Boolean).join(" · ") || "Airport"
    }
    if (r.type === "port") {
        return [r.port_size, r.country].filter(Boolean).join(" · ") || "Port"
    }
    if (r.type === "cable") {
        const owner = (r.owners || "").split(",")[0].trim()
        const countries = (r.all_countries || "").split(",").slice(0, 2).join(", ")
        return [owner, countries].filter(Boolean).join(" — ") || "Submarine Cable"
    }
    if (r.type === "chokepoint") return "Strategic Chokepoint"
    if (r.type === "assessment") return [r.severity?.toUpperCase(), r.location_name].filter(Boolean).join(" · ")
    if (r.type === "fusion")     return [r.severity?.toUpperCase(), r.location_name].filter(Boolean).join(" · ")
    if (r.type === "zone")       return [r.priority?.toUpperCase(), "Watch Zone"].filter(Boolean).join(" · ")
    if (r.type === "rule")       return r.trigger_type || r.rule_name || "Rule"
    if (r.type === "location")   return (r.display_name || "").split(",").slice(1, 3).join(",").trim() || "Location"
    return ""
}

// ── Recent searches ───────────────────────────────────────────────────────────

const LS_KEY = "gs_recent_v2"

function loadRecent() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]") } catch { return [] }
}
function saveRecent(items) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(items.slice(0, 8))) } catch {}
}
function pushRecent(r) {
    const dedupKey = `${r.type}:${r.name}`
    const prev = loadRecent().filter(x => `${x.type}:${x.name}` !== dedupKey)
    saveRecent([r, ...prev])
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GlobalSearch({ onResult, apiBase = API_BASE }) {
    const [query,   setQuery]   = useState("")
    const [results, setResults] = useState([])
    const [open,    setOpen]    = useState(false)
    const [loading, setLoading] = useState(false)
    const [focused, setFocused] = useState(false)
    const [active,  setActive]  = useState(-1)
    const [filter,  setFilter]  = useState("all")
    const [recent,  setRecent]  = useState([])

    const inputRef     = useRef(null)
    const debounceRef  = useRef(null)
    const containerRef = useRef(null)
    const filterRef    = useRef("all")
    filterRef.current  = filter

    // Cmd+K / /
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

    const typesForFilter = (f) => {
        const g = FILTER_GROUPS.find(x => x.id === f)
        return g?.types ? g.types.join(",") : "all"
    }

    const runSearch = useCallback(async (q, types) => {
        if (q.trim().length < 2) { setResults([]); setOpen(false); return }
        setLoading(true)
        try {
            const t = types ?? typesForFilter(filterRef.current)
            const url = `${apiBase}/api/search?q=${encodeURIComponent(q.trim())}&types=${t}&limit=10`
            const data = await fetch(url).then(r => r.ok ? r.json() : []).catch(() => [])
            setResults(Array.isArray(data) ? data : [])
            setOpen(true)
        } catch { setResults([]) }
        setActive(-1)
        setLoading(false)
    }, [apiBase]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleChange = (e) => {
        const val = e.target.value
        setQuery(val)
        clearTimeout(debounceRef.current)
        if (val.trim().length < 2) {
            setResults([])
            setOpen(val.trim().length === 0 && recent.length > 0)
            return
        }
        debounceRef.current = setTimeout(() => runSearch(val), 300)
    }

    const handleSelect = (r) => {
        pushRecent(r)
        setRecent(loadRecent())
        onResult?.(r)
        if (r.lat != null && r.lon != null) {
            window.dispatchEvent(new CustomEvent("akili:fly-to", {
                detail: { lat: r.lat, lon: r.lon, altitude: altitudeForResult(r) },
            }))
            window.dispatchEvent(new CustomEvent("akili:search-marker", {
                detail: { lat: r.lat, lon: r.lon, name: r.name, osm_type: r.osm_type, category: r.category },
            }))
        }
        setQuery(r.name || "")
        setOpen(false)
        inputRef.current?.blur()
    }

    const handleKeyDown = (e) => {
        if (!open) return
        const list = showingRecent ? recent : results
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, list.length - 1)) }
        if (e.key === "ArrowUp")   { e.preventDefault(); setActive(a => Math.max(a - 1, -1)) }
        if (e.key === "Enter" && active >= 0 && list[active]) { e.preventDefault(); handleSelect(list[active]) }
        if (e.key === "Escape")    { setOpen(false); inputRef.current?.blur() }
    }

    const handleFocus = () => {
        setFocused(true)
        const r = loadRecent()
        setRecent(r)
        if (query.trim().length < 2) {
            if (r.length > 0) setOpen(true)
        } else if (results.length > 0) {
            setOpen(true)
        }
    }

    const handleFilterChange = (f) => {
        setFilter(f)
        if (query.trim().length >= 2) {
            clearTimeout(debounceRef.current)
            runSearch(query, typesForFilter(f))
        }
    }

    const showingRecent  = query.trim().length < 2 && recent.length > 0
    const displayList    = showingRecent ? recent : results
    const panelOpen      = open && displayList.length > 0
    const isMobile       = typeof window !== "undefined" && window.innerWidth < 768

    const borderColor    = focused ? "rgba(56,189,248,0.38)" : "rgba(56,189,248,0.16)"

    return (
        <div
            ref={containerRef}
            style={{
                position:   "fixed",
                top:        48,
                left:       "50%",
                transform:  "translateX(-50%)",
                zIndex:     1200,
                width:      isMobile ? "calc(100vw - 32px)" : 480,
                fontFamily: "system-ui, -apple-system, sans-serif",
            }}
        >
            {/* Unified panel card */}
            <div style={{
                background:           "rgba(8, 16, 38, 0.96)",
                backdropFilter:       "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
                border:               `1px solid ${borderColor}`,
                borderRadius:         8,
                overflow:             "hidden",
                transition:           "border-color 0.15s",
            }}>
                {/* Input row */}
                <div style={{
                    display:      "flex",
                    alignItems:   "center",
                    gap:          8,
                    padding:      "7px 10px",
                    borderBottom: focused ? "1px solid rgba(255,255,255,0.05)" : "none",
                }}>
                    <svg width="14" height="14" viewBox="0 0 15 15" fill="none"
                        stroke={focused ? "#38bdf8" : "#475569"} strokeWidth="1.5" strokeLinecap="round"
                        style={{ flexShrink: 0, transition: "stroke 0.15s" }}>
                        <circle cx="6" cy="6" r="4.5"/>
                        <line x1="9.5" y1="9.5" x2="13.5" y2="13.5"/>
                    </svg>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        onFocus={handleFocus}
                        placeholder="Search airports, ports, cables, locations… (⌘K)"
                        style={{
                            flex:       1,
                            background: "transparent",
                            border:     "none",
                            outline:    "none",
                            color:      "#e2e8f0",
                            fontSize:   13,
                            fontFamily: "inherit",
                            caretColor: "#38bdf8",
                        }}
                    />
                    {loading && (
                        <div style={{
                            width: 12, height: 12, flexShrink: 0,
                            border: "2px solid rgba(56,189,248,0.25)",
                            borderTop: "2px solid #38bdf8",
                            borderRadius: "50%",
                            animation: "gs-spin 0.7s linear infinite",
                        }} />
                    )}
                    {query && !loading && (
                        <button
                            onMouseDown={(e) => { e.preventDefault(); setQuery(""); setResults([]); setOpen(false); inputRef.current?.focus() }}
                            style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", padding: 0, fontSize: 16, lineHeight: 1, flexShrink: 0 }}
                        >×</button>
                    )}
                    {!query && (
                        <span style={{ fontSize: 10, color: "rgba(100,116,139,0.5)", fontWeight: 600, flexShrink: 0, border: "1px solid rgba(100,116,139,0.25)", borderRadius: 4, padding: "1px 5px" }}>⌘K</span>
                    )}
                </div>

                {/* Filter pills */}
                {focused && (
                    <div style={{
                        display:      "flex",
                        gap:          4,
                        padding:      "5px 10px",
                        borderBottom: panelOpen ? "1px solid rgba(255,255,255,0.05)" : "none",
                    }}>
                        {FILTER_GROUPS.map(g => (
                            <button
                                key={g.id}
                                onMouseDown={(e) => { e.preventDefault(); handleFilterChange(g.id) }}
                                style={{
                                    background:    filter === g.id ? "rgba(56,189,248,0.12)" : "transparent",
                                    border:        `1px solid ${filter === g.id ? "rgba(56,189,248,0.35)" : "rgba(255,255,255,0.07)"}`,
                                    borderRadius:  20,
                                    color:         filter === g.id ? "#38bdf8" : "rgba(148,163,184,0.55)",
                                    fontSize:      10,
                                    fontWeight:    600,
                                    padding:       "2px 9px",
                                    cursor:        "pointer",
                                    fontFamily:    "inherit",
                                    letterSpacing: "0.04em",
                                    transition:    "all 0.12s",
                                }}
                            >{g.label}</button>
                        ))}
                    </div>
                )}

                {/* Results / recent list */}
                {panelOpen && (
                    <div>
                        {showingRecent && (
                            <div style={{ padding: "4px 12px 2px", fontSize: 9, color: "rgba(100,116,139,0.45)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                                Recent
                            </div>
                        )}
                        {displayList.map((r, i) => {
                            const meta = TYPE_META[r.type] || TYPE_META.location
                            const sub  = subtitleForResult(r)
                            return (
                                <div
                                    key={r.system_id || r.assessment_id || r.fusion_id || r.id || `${r.type}-${i}`}
                                    onMouseEnter={() => setActive(i)}
                                    onMouseDown={(e) => { e.preventDefault(); handleSelect(r) }}
                                    style={{
                                        display:      "flex",
                                        alignItems:   "center",
                                        gap:          10,
                                        padding:      "8px 12px",
                                        cursor:       "pointer",
                                        background:   active === i ? "rgba(56,189,248,0.08)" : "transparent",
                                        borderBottom: i < displayList.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                                        transition:   "background 0.1s",
                                    }}
                                >
                                    <span
                                        style={{ flexShrink: 0, width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                                        dangerouslySetInnerHTML={{ __html: typeMetaSvg(meta) }}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {r.name}
                                        </div>
                                        {sub && (
                                            <div style={{ fontSize: 10, color: "rgba(148,163,184,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                                                {sub}
                                            </div>
                                        )}
                                    </div>
                                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: meta.color, opacity: 0.75, flexShrink: 0 }}>
                                        {meta.label}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <style>{`@keyframes gs-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    )
}
