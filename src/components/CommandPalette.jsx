import { useState, useEffect, useRef, useMemo } from "react"
import { MODULES } from "../data/modules.js"
import API_BASE from "../apiBase.js"

const MAX_RESULTS = 40

/**
 * CommandPalette.jsx — redesign Round 2, §5. The one real search surface in
 * the product (replaces HeaderSearch.jsx as the header's search entry
 * point, per the new top bar). Indexes, in this fixed order:
 *   1. modules      — the real 7-item module rail (data/modules.js)
 *   2. entities/AOIs — real GET /api/search (airports/ports/cables/
 *      chokepoints/zones/locations/countries/cities — the same real,
 *      backend-ranked endpoint HeaderSearch already used)
 *   3. signals/alerts — real merged surface-pool + fusion-event items,
 *      passed in from app.jsx (already fetched there for the Situation
 *      module) rather than a second fetch of the same data
 *   4. reports       — real GET /api/reports
 * Substring-matched on label/sub-label, capped at 40 total. Selecting an
 * item calls the matching real onOpen* handler — full navigation (open
 * module/tab, pan map, select record), not just a label change.
 */
export default function CommandPalette({ open, onClose, signals = [], onOpenModule, onOpenEntity, onOpenSignal, onOpenReport }) {
    const [query, setQuery] = useState("")
    const [entityResults, setEntityResults] = useState([])
    const [reportResults, setReportResults] = useState([])
    const [selected, setSelected] = useState(0)
    const inputRef = useRef(null)

    useEffect(() => {
        if (open) {
            setQuery("")
            setSelected(0)
            setTimeout(() => inputRef.current?.focus(), 0)
        }
    }, [open])

    useEffect(() => {
        if (!open) return
        let cancelled = false
        fetch(`${API_BASE}/api/reports?status=in_review`)
            .then((r) => (r.ok ? r.json() : []))
            .then((d) => { if (!cancelled) setReportResults(Array.isArray(d) ? d : []) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [open])

    useEffect(() => {
        if (!open || query.trim().length < 2) { setEntityResults([]); return }
        let cancelled = false
        const t = setTimeout(() => {
            fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query.trim())}&limit=8`)
                .then((r) => (r.ok ? r.json() : []))
                .then((d) => { if (!cancelled) setEntityResults(Array.isArray(d) ? d : []) })
                .catch(() => {})
        }, 250)
        return () => { cancelled = true; clearTimeout(t) }
    }, [query, open])

    const results = useMemo(() => {
        const q = query.trim().toLowerCase()
        const matches = (label, sub) => !q || label?.toLowerCase().includes(q) || sub?.toLowerCase().includes(q)

        const out = []
        for (const m of MODULES) {
            if (matches(m.label)) out.push({ kind: "module", id: m.key, label: m.label, sub: m.built ? "Module" : "Module (placeholder)", icon: m.icon })
        }
        for (const e of entityResults) {
            out.push({ kind: "entity", id: `${e.type}-${e.name}-${e.lat}-${e.lon}`, label: e.name, sub: e.type, raw: e })
        }
        for (const s of signals) {
            const label = s.title || s.headline || "Signal"
            const sub = s.location_name || s.aoi || ""
            if (matches(label, sub)) out.push({ kind: "signal", id: s.id || s.fusion_id, label, sub, severity: s.severityToken || s.severity, raw: s })
        }
        for (const r of reportResults) {
            if (matches(r.title, r.report_id)) out.push({ kind: "report", id: r.report_id, label: r.title, sub: r.report_id, raw: r })
        }
        return out.slice(0, MAX_RESULTS)
    }, [query, entityResults, signals, reportResults])

    const open_ = (item) => {
        if (!item) return
        if (item.kind === "module") onOpenModule?.(item.id)
        else if (item.kind === "entity") onOpenEntity?.(item.raw)
        else if (item.kind === "signal") onOpenSignal?.(item.raw)
        else if (item.kind === "report") onOpenReport?.(item.raw)
        onClose()
    }

    const onKeyDown = (e) => {
        if (e.key === "Escape") { e.preventDefault(); onClose(); return }
        if (e.key === "ArrowDown") { e.preventDefault(); setSelected((i) => Math.min(i + 1, results.length - 1)); return }
        if (e.key === "ArrowUp") { e.preventDefault(); setSelected((i) => Math.max(i - 1, 0)); return }
        if (e.key === "Enter") { e.preventDefault(); open_(results[selected]); return }
    }

    if (!open) return null
    return (
        <div className="palette open" onKeyDown={onKeyDown}>
            <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(0) }}
                placeholder="Search modules, entities, signals, reports…"
            />
            <div className="results">
                {results.length === 0 ? (
                    <div style={{ padding: "14px", font: "400 12px var(--font)", color: "var(--txt-4)" }}>No results</div>
                ) : results.map((r, i) => (
                    <div
                        key={`${r.kind}-${r.id}`}
                        role="option"
                        aria-selected={i === selected}
                        className={`row${i === selected ? " selected" : ""}`}
                        onMouseEnter={() => setSelected(i)}
                        onClick={() => open_(r)}
                    >
                        {r.kind === "signal" ? (
                            <span className={`dia ${r.severity || "moderate"}`} />
                        ) : (
                            <svg className="icon sm"><use href={`#${r.icon || (r.kind === "module" ? "icon-grid" : r.kind === "entity" ? "icon-target" : r.kind === "report" ? "icon-doc" : "icon-flag")}`} /></svg>
                        )}
                        <span className="label">{r.label}</span>
                        {r.sub && <span className="sub">{r.sub}</span>}
                        <span className="kind tag">{r.kind}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
