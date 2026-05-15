import { useState, useEffect, useCallback, useRef } from "react"
import API_BASE from "../apiBase.js"

const API = API_BASE

function fmtBytes(n) {
    if (!n) return "0 B"
    if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`
    if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`
    if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`
    return `${n} B`
}

function timeAgo(isoStr) {
    if (!isoStr) return "Never fetched"
    const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
    if (diff < 60)    return `${diff}s ago`
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
}

function StatusDot({ status }) {
    const colors = {
        ok:       "#22c55e",
        degraded: "#f97316",
        pending:  "#6b7280",
        error:    "#ef4444",
    }
    return (
        <span style={{
            display:      "inline-block",
            width:        7,
            height:       7,
            borderRadius: "50%",
            background:   colors[status] || colors.pending,
            flexShrink:   0,
        }} />
    )
}

function Section({ title }) {
    return (
        <div style={{
            fontSize:      11,
            fontWeight:    700,
            color:         "var(--akili-accent)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginTop:     20,
            marginBottom:  8,
        }}>
            {title}
        </div>
    )
}

// 7-day spend bar chart
function SpendChart({ daily }) {
    if (!daily?.length) return null
    const max = Math.max(...daily.map(d => d.cost), 0.001)

    return (
        <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 48 }}>
                {daily.map(d => {
                    const pct = (d.cost / max) * 100
                    return (
                        <div key={d.date} title={`${d.date}: $${d.cost.toFixed(4)} (${d.calls} calls)`}
                            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
                        >
                            <div style={{
                                width:        "100%",
                                height:       `${Math.max(pct, 4)}%`,
                                background:   pct > 60 ? "#ef4444" : pct > 30 ? "#f97316" : "var(--akili-accent)",
                                borderRadius: "2px 2px 0 0",
                                minHeight:    2,
                                transition:   "height 0.3s",
                            }} />
                        </div>
                    )
                })}
            </div>
            <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
                {daily.map(d => (
                    <div key={d.date} style={{
                        flex:      1,
                        fontSize:  8,
                        color:     "var(--akili-text-muted)",
                        textAlign: "center",
                        overflow:  "hidden",
                    }}>
                        {d.date.slice(5)}
                    </div>
                ))}
            </div>
        </div>
    )
}

const TYPE_ORDER = ["briefing", "analysis", "route", "background"]

const STORAGE_CATS = [
    { key: "database",        label: "Database",        color: "#60a5fa" },
    { key: "venv",            label: "Python venv",     color: "#94a3b8" },
    { key: "ml_models",       label: "ML Models",       color: "#BF5AF2" },
    { key: "event_store",     label: "Event Store",     color: "#f97316" },
    { key: "geocoder_cache",  label: "Geocoder Cache",  color: "#fbbf24" },
    { key: "sentinel_images", label: "Sentinel Images", color: "#30D158" },
]

function StorageSection() {
    const [stats, setStats]         = useState(null)
    const [loading, setLoading]     = useState(false)
    const [clearing, setClearing]   = useState(null)
    const [pruning, setPruning]     = useState(false)
    const [pruneMsg, setPruneMsg]   = useState("")
    const [clearMsg, setClearMsg]   = useState({})
    const [pruneDays, setPruneDays] = useState(7)

    const load = useCallback(() => {
        setLoading(true)
        fetch(`${API}/api/storage/stats`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { setStats(d); setLoading(false) })
            .catch(() => setLoading(false))
    }, [])

    useEffect(() => { load() }, [load])

    const clearAction = async (action) => {
        setClearing(action)
        setClearMsg(m => ({ ...m, [action]: "" }))
        try {
            const res = await fetch(`${API}/api/storage/${action}`, { method: "POST" })
            const d   = res.ok ? await res.json() : null
            setClearMsg(m => ({ ...m, [action]: d ? `Cleared ${d.cleared_human} (${d.files_deleted} files)` : "Failed" }))
            load()
        } catch (_e) {
            setClearMsg(m => ({ ...m, [action]: "Failed" }))
        } finally {
            setClearing(null)
        }
    }

    const prune = async () => {
        setPruning(true); setPruneMsg("")
        try {
            const res = await fetch(`${API}/api/storage/prune-history`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ days: pruneDays }),
            })
            const d = res.ok ? await res.json() : null
            if (d?.ok) {
                const parts = Object.entries(d.deleted || {}).map(([t, n]) => `${n.toLocaleString()} ${t}`).join(", ")
                setPruneMsg(`Deleted ${parts} · Reclaimed ${d.reclaimed}`)
                load()
            } else {
                setPruneMsg(d?.error || "Failed")
            }
        } catch (_e) {
            setPruneMsg("Failed")
        } finally {
            setPruning(false) }
    }

    if (loading && !stats) return (
        <div style={{ color: "var(--akili-text-secondary)", fontSize: 11, padding: "8px 0" }}>Loading storage data…</div>
    )
    if (!stats) return null

    // Compute total known bytes for proportional bars
    const knownBytes = STORAGE_CATS.reduce((sum, c) => sum + (stats[c.key]?.bytes || 0), 0)
    const disk = stats.disk || {}
    const db   = stats.database || {}

    return (
        <div>
            {/* Disk summary */}
            <div style={{ padding: "10px 12px", background: "var(--akili-hover)", borderRadius: 6, border: "1px solid var(--akili-border)", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "var(--akili-text-primary)", fontWeight: 500 }}>Disk Usage</span>
                    <span style={{ fontSize: 11, color: "var(--akili-text-secondary)" }}>{disk.used} / {disk.total} ({disk.percent})</span>
                </div>
                <div style={{ height: 6, background: "var(--akili-hover-strong)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                        height: "100%",
                        width: disk.percent ? disk.percent : "0%",
                        background: parseInt(disk.percent) > 85 ? "#ef4444" : parseInt(disk.percent) > 60 ? "#f97316" : "var(--akili-accent)",
                        borderRadius: 3, transition: "width 0.4s",
                    }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ fontSize: 9, color: "var(--akili-text-muted)" }}>{disk.free} free</span>
                    <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--akili-text-muted)", fontSize: 9, padding: 0 }}>Refresh</button>
                </div>
            </div>

            {/* Category breakdown */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                {STORAGE_CATS.map(cat => {
                    const bytes = stats[cat.key]?.bytes || 0
                    const human = stats[cat.key]?.human || "—"
                    const pct   = knownBytes > 0 ? (bytes / knownBytes) * 100 : 0
                    const extra = cat.key === "database"
                        ? ` · ${db.reclaimable_human || "0 B"} reclaimable`
                        : cat.key === "sentinel_images"
                        ? ` · ${stats.sentinel_images?.count || 0} images`
                        : cat.key === "geocoder_cache"
                        ? ` · ${stats.geocoder_cache?.files || 0} files`
                        : ""
                    return (
                        <div key={cat.key}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ fontSize: 10, color: "var(--akili-text-secondary)" }}>
                                    {cat.label}
                                    {extra && <span style={{ color: "var(--akili-text-muted)", marginLeft: 4 }}>{extra}</span>}
                                </span>
                                <span style={{ fontSize: 10, color: "var(--akili-text-primary)", fontWeight: 500 }}>{human}</span>
                            </div>
                            <div style={{ height: 4, background: "var(--akili-hover-strong)", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: cat.color, borderRadius: 2, transition: "width 0.4s" }} />
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Top tables */}
            {db.top_tables?.length > 0 && (
                <div style={{ padding: "8px 10px", background: "var(--akili-hover)", borderRadius: 5, border: "1px solid var(--akili-border)", marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: "var(--akili-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                        Largest Tables (rows)
                    </div>
                    {db.top_tables.slice(0, 6).map(t => (
                        <div key={t.table} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                            <span style={{ fontSize: 10, color: "var(--akili-text-secondary)", fontFamily: "monospace" }}>{t.table}</span>
                            <span style={{ fontSize: 10, color: "var(--akili-text-primary)", fontWeight: 500 }}>{t.rows.toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Prune history */}
            <div style={{ padding: "10px 12px", background: "var(--akili-hover)", borderRadius: 6, border: "1px solid var(--akili-border)", marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: "var(--akili-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                    Prune Tracking History
                </div>
                <div style={{ fontSize: 10, color: "var(--akili-text-secondary)", marginBottom: 8 }}>
                    Deletes AIS/ADS-B position rows older than N days from aircraft_history, vessel_history, and track_density, then runs VACUUM to reclaim space.
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: "var(--akili-text-secondary)" }}>Keep last</span>
                    <input
                        type="number" min="1" max="90" value={pruneDays}
                        onChange={e => setPruneDays(Math.max(1, +e.target.value))}
                        style={{ width: 52, padding: "3px 6px", background: "var(--akili-hover-strong)", border: "1px solid var(--akili-border)", borderRadius: 4, color: "var(--akili-text-primary)", fontSize: 11 }}
                    />
                    <span style={{ fontSize: 10, color: "var(--akili-text-secondary)" }}>days</span>
                    <button
                        onClick={prune}
                        disabled={pruning}
                        style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444", fontSize: 11, cursor: pruning ? "not-allowed" : "pointer", opacity: pruning ? 0.6 : 1 }}
                    >{pruning ? "Pruning…" : "Prune & Vacuum"}</button>
                </div>
                {pruneMsg && <div style={{ marginTop: 6, fontSize: 10, color: pruneMsg.startsWith("Failed") ? "#ef4444" : "#4ade80" }}>{pruneMsg}</div>}
            </div>

            {/* Clear buttons */}
            <div style={{ display: "flex", gap: 8 }}>
                {[
                    { action: "clear-geocache",        label: "Clear Geocoder Cache" },
                    { action: "clear-sentinel-cache",  label: "Clear Sentinel PNGs" },
                ].map(({ action, label }) => (
                    <div key={action} style={{ flex: 1 }}>
                        <button
                            onClick={() => clearAction(action)}
                            disabled={clearing === action}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: "1px solid var(--akili-border)", background: "var(--akili-hover)", color: "var(--akili-text-secondary)", fontSize: 10, cursor: clearing === action ? "not-allowed" : "pointer", opacity: clearing === action ? 0.6 : 1 }}
                        >{clearing === action ? "Clearing…" : label}</button>
                        {clearMsg[action] && <div style={{ marginTop: 3, fontSize: 9, color: clearMsg[action].startsWith("Failed") ? "#ef4444" : "#4ade80", textAlign: "center" }}>{clearMsg[action]}</div>}
                    </div>
                ))}
            </div>
        </div>
    )
}

export default function HealthPanel({ onClose }) {
    const [data, setData]     = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError]   = useState(null)

    const fetchHealth = useCallback(async () => {
        const url = `${API}/api/health/detailed`
        setLoading(true)
        setError(null)
        try {
            console.info("[health/request]", { url })
            const res = await fetch(url)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            console.info("[health/response]", {
                url,
                ok: true,
                backend: json?.backend || null,
                sourceCount: Array.isArray(json?.data_sources) ? json.data_sources.length : 0,
                usageKeys: json?.claude_usage ? Object.keys(json.claude_usage) : [],
            })
            setData(json)
            setLoading(false)
        } catch (e) {
            console.error("[health/error]", {
                url,
                message: e?.message || String(e),
            })
            setError(e.message)
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchHealth()
        const iv = setInterval(fetchHealth, 30000)
        return () => { clearInterval(iv) }
    }, [fetchHealth])

    const backend = data?.backend
    const sources = data?.data_sources || []
    const usage   = data?.claude_usage
    const budgetRemainingUsd = Number(usage?.budget_remaining_usd ?? 0)
    const budgetUsd = Number(usage?.budget_usd ?? 0)
    const budgetRemainingPct = Number(usage?.budget_remaining_pct ?? 0)
    const totalCostUsd = Number(usage?.total_cost_usd ?? 0)
    const weekCostUsd = Number(usage?.week_cost_usd ?? 0)
    const monthCostUsd = Number(usage?.month_cost_usd ?? 0)
    const weekInputTokens = Number(usage?.week_input_tokens ?? 0)
    const weekOutputTokens = Number(usage?.week_output_tokens ?? 0)

    const totalOk      = sources.filter(s => s.status === "ok").length
    const totalDegraded = sources.filter(s => s.status === "degraded").length

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Header */}
            <div style={{
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                padding:        "14px 16px 12px",
                borderBottom:   "1px solid var(--akili-border)",
                flexShrink:     0,
            }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--akili-text-primary)", letterSpacing: "0.04em" }}>
                    SYSTEM HEALTH
                </span>
                <button onClick={onClose} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--akili-text-secondary)", fontSize: 16, lineHeight: 1, padding: 4,
                }}>×</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
                {loading && (
                    <div style={{ padding: "24px 0", textAlign: "center", color: "var(--akili-text-secondary)", fontSize: 11 }}>
                        Loading...
                    </div>
                )}
                {error && (
                    <div style={{ padding: "16px 0", color: "#ef4444", fontSize: 11 }}>
                        Failed to load health data: {error}
                    </div>
                )}

                {data && (
                    <>
                        {/* Backend status */}
                        <Section title="Backend" />
                        <div style={{
                            display:      "flex",
                            alignItems:   "center",
                            gap:          10,
                            padding:      "10px 12px",
                            background:   "var(--akili-hover)",
                            borderRadius: 6,
                            border:       "1px solid var(--akili-border)",
                        }}>
                            <StatusDot status={backend?.status || "error"} />
                            <span style={{ fontSize: 12, color: "var(--akili-text-primary)", flex: 1 }}>
                                API Server v{backend?.version}
                            </span>
                            <span style={{ fontSize: 10, color: "var(--akili-text-secondary)" }}>
                                {backend?.ping_ms}ms
                            </span>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 10, color: "var(--akili-text-muted)" }}>
                            {totalOk} sources healthy
                            {totalDegraded > 0 && `, ${totalDegraded} degraded`}
                        </div>

                        {/* Data sources */}
                        <Section title="Data Sources" />
                        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            {sources.map(src => (
                                <div key={src.id} style={{
                                    padding:      "8px 10px",
                                    borderRadius: 4,
                                    background:   "var(--akili-hover)",
                                }}>
                                    <div style={{
                                        display:             "grid",
                                        gridTemplateColumns: "8px 1fr auto",
                                        alignItems:          "center",
                                        gap:                 8,
                                    }}>
                                        <StatusDot status={src.status} />
                                        <div>
                                            <div style={{ fontSize: 11, color: "var(--akili-text-primary)", fontWeight: 500 }}>
                                                {src.name}
                                            </div>
                                            <div style={{ fontSize: 10, color: "var(--akili-text-secondary)", marginTop: 1 }}>
                                                {src.type}
                                                {src.record_count != null && src.record_count > 0 && ` · ${src.record_count.toLocaleString()} records`}
                                                {src.event_count  != null && src.event_count  > 0 && ` · ${src.event_count.toLocaleString()} events`}
                                                {src.feeds_ok     != null && ` · ${src.feeds_ok}/${src.feeds_total} feeds`}
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 10, color: "var(--akili-text-muted)", textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                                            {timeAgo(src.last_fetch)}
                                            {src.failures > 0 && (
                                                <div style={{ color: "#f97316" }}>{src.failures} err</div>
                                            )}
                                            {src.status === "pending" && (
                                                <button
                                                    onClick={() => fetch(`${API}/api/sources/init?source=${src.id}`, { method: "POST" }).then(() => fetchHealth())}
                                                    style={{
                                                        background:  "none",
                                                        border:      "1px solid var(--akili-border)",
                                                        cursor:      "pointer",
                                                        color:       "var(--akili-text-secondary)",
                                                        fontSize:    8,
                                                        padding:     "2px 6px",
                                                        borderRadius: 3,
                                                        lineHeight:  1.4,
                                                    }}
                                                >
                                                    Init
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {src.id === "rss" && src.feeds_attempted != null && (
                                        <div style={{ marginTop: 6, paddingLeft: 16, fontSize: 10, color: "var(--akili-text-secondary)" }}>
                                            {src.feeds_successful}/{src.feeds_attempted} feeds OK, {src.feeds_failed} failed
                                            {src.last_error_message && (
                                                <div style={{ color: "#ef4444", fontSize: 10, marginTop: 2 }}>
                                                    {src.last_error_message}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Storage */}
                        <Section title="Storage" />
                        <StorageSection />

                        {/* Claude API usage */}
                        {usage && (
                            <>
                                <Section title="Claude API Usage" />
                                <div style={{
                                    padding:      "10px 12px",
                                    background:   "var(--akili-hover)",
                                    borderRadius: 6,
                                    border:       "1px solid var(--akili-border)",
                                }}>
                                    {/* Budget bar */}
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                        <span style={{ fontSize: 11, color: "var(--akili-text-primary)", fontWeight: 500 }}>
                                            Budget remaining
                                        </span>
                                        <span style={{ fontSize: 11, color: "var(--akili-text-secondary)" }}>
                                            ${budgetRemainingUsd.toFixed(2)} / ${budgetUsd.toFixed(0)}
                                        </span>
                                    </div>
                                    <div style={{
                                        height:       6,
                                        background:   "var(--akili-hover-strong)",
                                        borderRadius: 3,
                                        overflow:     "hidden",
                                    }}>
                                        <div style={{
                                            height:     "100%",
                                            width:      `${Math.min(budgetRemainingPct, 100)}%`,
                                            background: budgetRemainingPct > 40 ? "var(--akili-accent)"
                                                      : budgetRemainingPct > 15 ? "#f97316"
                                                      : "#ef4444",
                                            borderRadius: 3,
                                            transition: "width 0.3s",
                                        }} />
                                    </div>

                                    {/* Stats grid */}
                                    <div style={{
                                        display:             "grid",
                                        gridTemplateColumns: "1fr 1fr",
                                        gap:                 8,
                                        marginTop:           12,
                                    }}>
                                        {[
                                            ["Total cost",    `$${totalCostUsd.toFixed(4)}`],
                                            ["This week",     `$${weekCostUsd.toFixed(4)}`],
                                            ["This month",    `$${monthCostUsd.toFixed(4)}`],
                                            ["Calls today",   usage?.calls_today ?? 0],
                                            ["Calls total",   usage?.calls_total ?? 0],
                                            ["Week tokens",   `${((weekInputTokens + weekOutputTokens) / 1000).toFixed(1)}k`],
                                        ].map(([label, val]) => (
                                            <div key={label}>
                                                <div style={{ fontSize: 9, color: "var(--akili-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                                    {label}
                                                </div>
                                                <div style={{ fontSize: 12, color: "var(--akili-text-primary)", fontWeight: 600, marginTop: 2 }}>
                                                    {val}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Call type breakdown */}
                                    {usage.calls_by_type && Object.keys(usage.calls_by_type).length > 0 && (
                                        <div style={{ marginTop: 12 }}>
                                            <div style={{ fontSize: 9, color: "var(--akili-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                                                Calls by type
                                            </div>
                                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                                {TYPE_ORDER.filter(t => usage.calls_by_type[t]).map(t => (
                                                    <div key={t} style={{ display: "flex", justifyContent: "space-between" }}>
                                                        <span style={{ fontSize: 10, color: "var(--akili-text-secondary)", textTransform: "capitalize" }}>{t}</span>
                                                        <span style={{ fontSize: 10, color: "var(--akili-text-primary)", fontWeight: 500 }}>{usage.calls_by_type[t]}</span>
                                                    </div>
                                                ))}
                                                {Object.entries(usage.calls_by_type)
                                                    .filter(([t]) => !TYPE_ORDER.includes(t))
                                                    .map(([t, n]) => (
                                                        <div key={t} style={{ display: "flex", justifyContent: "space-between" }}>
                                                            <span style={{ fontSize: 10, color: "var(--akili-text-secondary)", textTransform: "capitalize" }}>{t}</span>
                                                            <span style={{ fontSize: 10, color: "var(--akili-text-primary)", fontWeight: 500 }}>{n}</span>
                                                        </div>
                                                    ))
                                                }
                                            </div>
                                        </div>
                                    )}

                                    {/* 7-day spend chart */}
                                    <div style={{ marginTop: 12 }}>
                                        <div style={{ fontSize: 9, color: "var(--akili-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                            Daily spend (7 days)
                                        </div>
                                        <SpendChart daily={usage.daily_spend} />
                                    </div>

                                    {/* Top call */}
                                    {usage.top_call_this_week && (
                                        <div style={{
                                            marginTop:    12,
                                            padding:      "8px 10px",
                                            background:   "var(--akili-hover-strong)",
                                            borderRadius: 4,
                                        }}>
                                            <div style={{ fontSize: 9, color: "var(--akili-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                                                Most expensive call this week
                                            </div>
                                            <div style={{ fontSize: 11, color: "var(--akili-text-primary)" }}>
                                                ${usage.top_call_this_week.cost.toFixed(5)}
                                                <span style={{ color: "var(--akili-text-secondary)", marginLeft: 6 }}>
                                                    {usage.top_call_this_week.type}
                                                </span>
                                            </div>
                                            {usage.top_call_this_week.headline && (
                                                <div style={{ fontSize: 10, color: "var(--akili-text-muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {usage.top_call_this_week.headline}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
