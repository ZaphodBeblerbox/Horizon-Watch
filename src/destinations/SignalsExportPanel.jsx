/**
 * SignalsExportPanel.jsx — the real "Export" action for Situation's signals
 * feed (GET /api/signals/export[.csv|.pdf], backend/routers/signals_export.py).
 * No parallel filter UI: date range/domain/min-severity default from the
 * caller's CURRENT real filter state (severityFloor/timeWindow, mirrored via
 * situationFilterState.js) and can be narrowed here, never invented from
 * scratch. Live preview count comes from the same real query the CSV/PDF
 * downloads use — never a separately-computed estimate.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { toast } from "../ui/toast.js"

const API = API_BASE

// The export's real domain vocabulary (backend/signals_export.py's
// _ALERT_SOURCE_TO_DOMAIN values) — NOT the same set as Situation's
// groupsOn (which also has imagery/alerts, neither of which is a distinct
// export domain), so this is deliberately its own honest choice rather than
// a forced default from a multi-select toggle group.
const DOMAINS = [
    { key: "", label: "All domains" },
    { key: "maritime", label: "Maritime" },
    { key: "air", label: "Air" },
    { key: "news", label: "News" },
    { key: "zones", label: "Zones" },
]
const MIN_SEVERITIES = [
    { key: "", label: "Any" },
    { key: "critical", label: "Critical+" },
    { key: "high", label: "High+" },
    { key: "moderate", label: "Moderate+" },
    { key: "low", label: "Low+" },
]

function toDateInput(d) {
    return d.toISOString().slice(0, 10)
}

async function downloadExport(kind, params, setBusy) {
    setBusy(kind)
    try {
        const qs = new URLSearchParams(params).toString()
        const res = await fetch(`${API}/api/signals/export.${kind}?${qs}`)
        if (!res.ok) throw new Error(`export.${kind} failed: ${res.status}`)
        const blob = await res.blob()
        const disposition = res.headers.get("Content-Disposition") || ""
        const match = /filename="([^"]+)"/.exec(disposition)
        const filename = match ? match[1] : `signals-export.${kind}`
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        toast(`Downloaded ${filename}`, { icon: "i-export" })
    } catch (err) {
        toast(`Could not build the ${kind.toUpperCase()} export`, { icon: "i-flag" })
    } finally {
        setBusy(null)
    }
}

export default function SignalsExportPanel({ defaultFrom, defaultTo, defaultMinSeverity, onClose }) {
    const [dateFrom, setDateFrom] = useState(toDateInput(defaultFrom))
    const [dateTo, setDateTo] = useState(toDateInput(defaultTo))
    const [domain, setDomain] = useState("")
    const [minSeverity, setMinSeverity] = useState(defaultMinSeverity || "")
    const [country, setCountry] = useState("")
    const [preview, setPreview] = useState(null) // {total_matched, returned} | null while loading
    const [previewError, setPreviewError] = useState(false)
    const [busy, setBusy] = useState(null) // "csv" | "pdf" | null

    const params = {
        from: dateFrom, to: dateTo,
        ...(domain ? { domain } : {}),
        ...(minSeverity ? { min_severity: minSeverity } : {}),
        ...(country.trim() ? { country: country.trim().toLowerCase() } : {}),
        limit: 3000,
    }

    useEffect(() => {
        let cancelled = false
        setPreview(null)
        setPreviewError(false)
        const qs = new URLSearchParams(params).toString()
        const t = setTimeout(() => {
            fetch(`${API}/api/signals/export?${qs}`)
                .then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
                .then((d) => { if (!cancelled) setPreview(d) })
                .catch(() => { if (!cancelled) setPreviewError(true) })
        }, 350)
        return () => { cancelled = true; clearTimeout(t) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateFrom, dateTo, domain, minSeverity, country])

    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 1500, display: "flex",
            alignItems: "flex-start", justifyContent: "center", background: "rgba(0,0,0,0.35)",
        }} onClick={onClose}>
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    marginTop: 60, width: 380, maxWidth: "92%", background: "var(--bg-2)",
                    border: "1px solid var(--line)", borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                    display: "flex", flexDirection: "column",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ font: "600 12px var(--font)", color: "var(--txt)" }}>Export signals</span>
                    <button onClick={onClose} title="Close" style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", font: "400 16px var(--font)", lineHeight: 1, padding: 0 }}>×</button>
                </div>

                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>From</span>
                            <input className="input" type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} />
                        </label>
                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>To</span>
                            <input className="input" type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} />
                        </label>
                    </div>

                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>Domain</span>
                        <select className="input" value={domain} onChange={(e) => setDomain(e.target.value)}>
                            {DOMAINS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                        </select>
                    </label>

                    <div style={{ display: "flex", gap: 8 }}>
                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>Min severity</span>
                            <select className="input" value={minSeverity} onChange={(e) => setMinSeverity(e.target.value)}>
                                {MIN_SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                            </select>
                        </label>
                        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>Country (optional)</span>
                            <input className="input" placeholder="e.g. ua" value={country} onChange={(e) => setCountry(e.target.value)} />
                        </label>
                    </div>

                    <div style={{ padding: "6px 8px", background: "var(--bg-0)", borderRadius: 4, font: "400 11.5px var(--font)", color: "var(--txt-3)", minHeight: 18 }}>
                        {previewError ? "Could not load a preview." :
                         preview == null ? "Checking…" :
                         preview.total_matched === 0 ? "No signals matched this window and these filters." :
                         `${preview.total_matched} signal${preview.total_matched === 1 ? "" : "s"} match — top ${preview.returned} will be exported.`}
                    </div>
                </div>

                <div style={{ padding: 10, borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
                    <button
                        className="btn" style={{ flex: 1 }}
                        disabled={busy === "csv" || preview == null || previewError}
                        onClick={() => downloadExport("csv", params, setBusy)}
                        title="Download CSV — includes an honest empty file if nothing matches"
                    >
                        <svg className="icon sm"><use href="#i-export" /></svg> {busy === "csv" ? "building…" : "CSV"}
                    </button>
                    <button
                        className="btn" style={{ flex: 1 }}
                        disabled={busy === "pdf" || preview == null || previewError}
                        onClick={() => downloadExport("pdf", params, setBusy)}
                        title="Download PDF — includes an honest empty-state page if nothing matches"
                    >
                        <svg className="icon sm"><use href="#i-export" /></svg> {busy === "pdf" ? "building…" : "PDF"}
                    </button>
                </div>
            </div>
        </div>
    )
}
