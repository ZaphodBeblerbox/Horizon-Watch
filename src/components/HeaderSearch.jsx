import { useState, useEffect, useRef, useCallback } from "react"
import Icon from "../ui/Icon.jsx"
import API_BASE from "../apiBase.js"

/**
 * Header search — full UI rebuild spec section 3.1: "an icon that expands
 * into a search input on click... it must not push other header elements
 * around when it expands; overlay it instead." Built fresh rather than
 * extracted from the old TopBar.jsx's InlineSearch (which this rebuild
 * supersedes entirely) — same real GET /api/search endpoint, real results,
 * routed through the new src/ui/Icon.jsx system from the start instead of
 * the old emoji table.
 */
const TYPE_ICON = {
    airport: "facility",
    port: "vessel",
    cable: "facility",
    chokepoint: "target",
    assessment: "warning",
    fusion: "target",
    zone: "target",
    rule: "settings",
    location: "poi",
    country: "poi",
    city: "poi",
}

async function runSearch(query, apiBase) {
    try {
        const url = `${apiBase}/api/search?q=${encodeURIComponent(query.trim())}&limit=8`
        const data = await fetch(url).then((r) => (r.ok ? r.json() : [])).catch(() => [])
        return Array.isArray(data) ? data : []
    } catch {
        return []
    }
}

export default function HeaderSearch({ onResult, apiBase = API_BASE }) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [results, setResults] = useState([])
    const [loading, setLoading] = useState(false)
    const [active, setActive] = useState(-1)
    const inputRef = useRef(null)
    const containerRef = useRef(null)
    const debounceRef = useRef(null)

    useEffect(() => {
        const onKey = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault()
                setOpen(true)
                setTimeout(() => inputRef.current?.focus(), 0)
            }
            if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
                e.preventDefault()
                setOpen(true)
                setTimeout(() => inputRef.current?.focus(), 0)
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [])

    useEffect(() => {
        const onOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", onOutside)
        return () => document.removeEventListener("mousedown", onOutside)
    }, [])

    const search = useCallback(async (q) => {
        if (q.trim().length < 2) { setResults([]); return }
        setLoading(true)
        const data = await runSearch(q, apiBase)
        setResults(data)
        setActive(-1)
        setLoading(false)
    }, [apiBase])

    const handleChange = (e) => {
        const val = e.target.value
        setQuery(val)
        clearTimeout(debounceRef.current)
        if (val.trim().length < 2) { setResults([]); return }
        debounceRef.current = setTimeout(() => search(val), 300)
    }

    const select = (r) => {
        onResult?.(r)
        setQuery("")
        setResults([])
        setOpen(false)
    }

    const handleKeyDown = (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
        if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)) }
        if (e.key === "Enter" && active >= 0 && results[active]) { e.preventDefault(); select(results[active]) }
        if (e.key === "Escape") { setOpen(false); inputRef.current?.blur() }
    }

    return (
        <div ref={containerRef} style={{ position: "relative" }}>
            <button
                onClick={() => { setOpen((v) => !v); setTimeout(() => inputRef.current?.focus(), 0) }}
                title="Search (/)"
                aria-label="Search"
                style={{
                    width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)",
                }}
            >
                <Icon name="search" size={18} />
            </button>

            {open && (
                <div style={{
                    position: "absolute", top: "calc(100% + 6px)", right: 0, width: 320, zIndex: 2000,
                    background: "var(--bg-card)", border: "1px solid var(--border-strong)",
                    borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-callout)",
                    overflow: "hidden",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                        <Icon name="search" size={14} color="var(--text-muted)" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={handleChange}
                            onKeyDown={handleKeyDown}
                            placeholder="Search…"
                            style={{
                                flex: 1, background: "transparent", border: "none", outline: "none",
                                color: "var(--text-primary)", fontFamily: "var(--font-sans)", fontSize: "var(--text-body)",
                            }}
                        />
                        {loading && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>…</span>}
                    </div>
                    {results.length > 0 && (
                        <div>
                            {results.map((r, i) => (
                                <button
                                    key={r.system_id || r.assessment_id || r.fusion_id || r.id || `${r.type}-${i}`}
                                    onMouseEnter={() => setActive(i)}
                                    onClick={() => select(r)}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                                        padding: "8px 10px", background: active === i ? "var(--bg-card-2)" : "transparent",
                                        border: "none", borderTop: i > 0 ? "1px solid var(--border)" : "none",
                                        cursor: "pointer", textAlign: "left",
                                    }}
                                >
                                    <Icon name={TYPE_ICON[r.type] || "poi"} size={14} color="var(--text-secondary)" />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: "var(--text-body)", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {r.name}
                                        </div>
                                    </div>
                                    <span style={{ fontSize: "var(--text-chip)", color: "var(--text-muted)", textTransform: "uppercase", flexShrink: 0 }}>
                                        {r.type}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
