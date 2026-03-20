import { useRef, useState } from "react"
import { API_BASE } from "../apiBase.js"

const COUNTRY_QUERIES = new Set([
    "tanzania", "kenya", "uganda", "rwanda", "burundi", "mozambique",
    "zambia", "malawi", "ethiopia", "somalia", "sudan", "south sudan",
    "congo", "democratic republic of congo", "drc", "egypt", "nigeria",
    "ghana", "france", "germany", "united states", "usa", "uk", "united kingdom",
])

function inferZoom(query, displayName) {
    const q = (query || "").trim().toLowerCase()
    const d = (displayName || "").toLowerCase()
    if (COUNTRY_QUERIES.has(q)) return 7
    if (q && d === q) return 7
    if (q && d.startsWith(`${q},`) && q.split(/\s+/).length <= 2) return 7
    return 12
}

export default function Header({ filter, setFilter, eventTypes, totalEvents, onSearchResult }) {
    const [query, setQuery] = useState("")
    const [searching, setSearching] = useState(false)
    const [searchMessage, setSearchMessage] = useState("")
    const loggedResponseRef = useRef(false)

    const runSearch = async () => {
        const q = query.trim()
        if (q.length < 2 || searching) return
        setSearching(true)
        setSearchMessage("")
        try {
            const p = new URLSearchParams({ q, limit: "5" })
            const res = await fetch(`${API_BASE}/geocode?${p}`)
            const data = res.ok ? await res.json() : []
            const results = Array.isArray(data) ? data : (Array.isArray(data?.results) ? data.results : [])
            if (results.length === 0) {
                setSearchMessage("No results")
                return
            }
            const first = results[0]
            onSearchResult?.({
                lat: Number(first.lat),
                lon: Number(first.lon),
                label: first.display_name || q,
                zoom: inferZoom(q, first.display_name),
            })
            setSearchMessage("")
        } catch {
            setSearchMessage("Search failed")
        } finally {
            setSearching(false)
        }
    }

    return (
        <header style={{
            height: 52,
            background: "rgba(255,255,255,0.9)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid rgba(0,0,0,0.10)",
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            gap: 32,
            zIndex: 100,
            flexShrink: 0
        }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 11, color: "#999", fontWeight: 400 }}>
                    {totalEvents} events loaded
                </span>
            </div>

            <div style={{ display: "flex", gap: 4, flex: 1, overflowX: "auto" }}>
                {eventTypes.map(t => (
                    <button key={t} onClick={() => setFilter(t)} style={{
                        padding: "4px 12px",
                        fontSize: 11,
                        fontWeight: filter === t ? 600 : 400,
                        background: filter === t ? "#0a0a0a" : "transparent",
                        color: filter === t ? "#fff" : "#555",
                        border: `1px solid ${filter === t ? "#0a0a0a" : "rgba(0,0,0,0.12)"}`,
                        cursor: "pointer",
                        letterSpacing: "0.04em",
                        textTransform: "capitalize",
                        whiteSpace: "nowrap",
                        transition: "all 0.15s"
                    }}>
                        {t}
                    </button>
                ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", minWidth: 240, maxWidth: 300, width: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value)
                            if (searchMessage) setSearchMessage("")
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") runSearch()
                        }}
                        placeholder="Search location..."
                        style={{
                            flex: 1,
                            padding: "6px 10px",
                            fontSize: 11,
                            border: "1px solid rgba(0,0,0,0.12)",
                            borderRadius: 6,
                            outline: "none",
                            background: "#fff",
                            color: "#222",
                        }}
                    />
                    <button
                        onClick={runSearch}
                        disabled={searching}
                        title="Search"
                        style={{
                            width: 32,
                            height: 30,
                            borderRadius: 6,
                            border: "1px solid rgba(0,0,0,0.12)",
                            background: searching ? "rgba(0,0,0,0.06)" : "#fff",
                            color: "#333",
                            cursor: searching ? "not-allowed" : "pointer",
                            fontSize: 13,
                            lineHeight: 1,
                        }}
                    >
                        {searching ? "..." : "⌕"}
                    </button>
                </div>
                {searchMessage && (
                    <span style={{ marginTop: 3, fontSize: 10, color: "#b91c1c" }}>
                        {searchMessage}
                    </span>
                )}
            </div>
        </header>
    )
}
