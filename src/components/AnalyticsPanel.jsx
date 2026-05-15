// Traffic analytics panel — line chart of hourly counts plus type breakdown.
// Backed by /api/analytics/timeseries and /api/analytics/breakdown.

import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, CartesianGrid,
} from "recharts"

const PIE_COLORS = ["#4A9EE0", "#5BC97F", "#E8B23A", "#E55757", "#9B59B6", "#9AA4B5", "#38bdf8", "#f97316"]

const fmtTime = (iso) => {
    try { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" }) }
    catch { return iso }
}

const HOUR_OPTIONS = [
    { label: "24h",  value: 24 },
    { label: "72h",  value: 72 },
    { label: "7d",   value: 168 },
    { label: "30d",  value: 720 },
]

const DOMAIN_OPTIONS = [
    { label: "Vessels (AIS)", value: "ais" },
    { label: "Aircraft (ADS-B)", value: "adsb" },
]

// Expand icon (diagonal arrows)
function IconExpand() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
        </svg>
    )
}

export default function AnalyticsPanel({ onClose, onExpand = null, isTabMode = false }) {
    const [domain, setDomain] = useState("ais")
    const [hours,  setHours]  = useState(24)

    const [timeseries, setTimeseries] = useState([])
    const [breakdown,  setBreakdown]  = useState([])
    const [loading,    setLoading]    = useState(false)

    useEffect(() => {
        let cancelled = false
        setLoading(true)

        Promise.all([
            fetch(`${API_BASE}/api/analytics/timeseries?domain=${domain}&hours=${hours}`)
                .then(r => r.ok ? r.json() : null),
            fetch(`${API_BASE}/api/analytics/breakdown?domain=${domain}&hours=${hours}`)
                .then(r => r.ok ? r.json() : null),
        ]).then(([ts, bd]) => {
            if (cancelled) return
            setTimeseries(safeArray(ts?.points).map(p => ({ time: fmtTime(p.time), count: p.count })))
            const entries = Object.entries(bd?.breakdown || {}).slice(0, 8)
            setBreakdown(entries.map(([name, value]) => ({ name, value })))
        }).finally(() => { if (!cancelled) setLoading(false) })

        return () => { cancelled = true }
    }, [domain, hours])

    const totalActivity = timeseries.reduce((sum, p) => sum + p.count, 0)
    const peakHour = timeseries.reduce((max, p) => p.count > (max?.count || 0) ? p : max, null)

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", color: "#E8ECF1" }}>
            {/* Header */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #2C3645", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>Traffic Analytics</div>
                    <div style={{ fontSize: 12, color: "#9AA4B5", marginTop: 2 }}>Heatmap-aggregated track density</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {!isTabMode && onExpand && (
                        <button
                            onClick={onExpand}
                            title="Open in full tab"
                            style={{ background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", lineHeight: 1, padding: "2px 4px", display: "flex", alignItems: "center" }}
                        >
                            <IconExpand />
                        </button>
                    )}
                    {!isTabMode && (
                        <button onClick={onClose} style={{ background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
                    )}
                </div>
            </div>

            {/* Controls */}
            <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(44,54,69,0.5)", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
                <div style={{ display: "flex", gap: 6 }}>
                    {DOMAIN_OPTIONS.map(o => (
                        <button
                            key={o.value}
                            onClick={() => setDomain(o.value)}
                            style={{
                                flex: 1, fontSize: 11, fontWeight: 600,
                                padding: "6px 10px", borderRadius: 4,
                                background: domain === o.value ? "rgba(45,143,232,0.18)" : "transparent",
                                border: domain === o.value ? "1px solid #2d8fe8" : "1px solid #2C3645",
                                color: domain === o.value ? "#2d8fe8" : "#9AA4B5",
                                cursor: "pointer",
                            }}
                        >{o.label}</button>
                    ))}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                    {HOUR_OPTIONS.map(o => (
                        <button
                            key={o.value}
                            onClick={() => setHours(o.value)}
                            style={{
                                flex: 1, fontSize: 10, fontWeight: 600,
                                padding: "5px 8px", borderRadius: 3,
                                background: hours === o.value ? "rgba(255,255,255,0.08)" : "transparent",
                                border: "1px solid " + (hours === o.value ? "rgba(255,255,255,0.2)" : "transparent"),
                                color: hours === o.value ? "#E8ECF1" : "#9AA4B5",
                                cursor: "pointer",
                            }}
                        >{o.label}</button>
                    ))}
                </div>
            </div>

            {/* Stats strip */}
            <div style={{ display: "flex", padding: "12px 16px", borderBottom: "1px solid rgba(44,54,69,0.5)", gap: 16, flexShrink: 0 }}>
                <Stat label="Total observations" value={totalActivity.toLocaleString()} />
                <Stat label="Peak hour" value={peakHour ? peakHour.count.toLocaleString() : "—"} />
                <Stat label="Type variety" value={breakdown.length || "—"} />
            </div>

            {/* Charts (scrollable body) */}
            {isTabMode ? (
                /* Side-by-side layout in full tab mode */
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                    {loading && (
                        <div style={{ gridColumn: "1/-1", color: "#9AA4B5", fontSize: 11, textAlign: "center", padding: 12 }}>Loading…</div>
                    )}
                    <div>
                        <SectionHeader>Activity over time</SectionHeader>
                        {timeseries.length > 0 ? (
                            <ResponsiveContainer width="100%" height={260}>
                                <LineChart data={timeseries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis dataKey="time" tick={{ fill: "#9AA4B5", fontSize: 10 }} interval="preserveStartEnd" minTickGap={32} />
                                    <YAxis tick={{ fill: "#9AA4B5", fontSize: 10 }} />
                                    <Tooltip contentStyle={{ background: "#0F1721", border: "1px solid #2C3645", fontSize: 12, color: "#E8ECF1" }} labelStyle={{ color: "#9AA4B5" }} />
                                    <Line type="monotone" dataKey="count" stroke="#4A9EE0" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : !loading && <Empty>No activity in window</Empty>}
                    </div>
                    <div>
                        <SectionHeader>Type breakdown</SectionHeader>
                        {breakdown.length > 0 ? (
                            <>
                                <ResponsiveContainer width="100%" height={220}>
                                    <PieChart>
                                        <Pie data={breakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={44}>
                                            {breakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                        </Pie>
                                        <Tooltip contentStyle={{ background: "#0F1721", border: "1px solid #2C3645", fontSize: 12, color: "#E8ECF1" }} />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div style={{ marginTop: 10 }}>
                                    {breakdown.map((b, i) => (
                                        <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", fontSize: 12 }}>
                                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                                            <span style={{ flex: 1, color: "#E8ECF1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                                            <span style={{ color: "#9AA4B5" }}>{b.value.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : !loading && <Empty>No type data</Empty>}
                    </div>
                    {/* Threat matrix spans both columns */}
                    <div style={{ gridColumn: "1/-1", marginTop: 8 }}>
                        <SectionHeader>Threat Matrix</SectionHeader>
                        <ThreatMatrix />
                    </div>
                </div>
            ) : (
                /* Stacked layout in right panel mode */
                <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
                    {loading && (
                        <div style={{ color: "#9AA4B5", fontSize: 11, textAlign: "center", padding: 12 }}>Loading…</div>
                    )}

                    <SectionHeader>Activity over time</SectionHeader>
                    {timeseries.length > 0 ? (
                        <ResponsiveContainer width="100%" height={180}>
                            <LineChart data={timeseries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                                <XAxis dataKey="time" tick={{ fill: "#9AA4B5", fontSize: 9 }} interval="preserveStartEnd" minTickGap={32} />
                                <YAxis tick={{ fill: "#9AA4B5", fontSize: 9 }} />
                                <Tooltip
                                    contentStyle={{ background: "#0F1721", border: "1px solid #2C3645", fontSize: 11, color: "#E8ECF1" }}
                                    labelStyle={{ color: "#9AA4B5" }}
                                />
                                <Line type="monotone" dataKey="count" stroke="#4A9EE0" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : !loading && (
                        <Empty>No activity in window</Empty>
                    )}

                    <SectionHeader style={{ marginTop: 18 }}>Type breakdown</SectionHeader>
                    {breakdown.length > 0 ? (
                        <>
                            <ResponsiveContainer width="100%" height={180}>
                                <PieChart>
                                    <Pie data={breakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={36}>
                                        {breakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ background: "#0F1721", border: "1px solid #2C3645", fontSize: 11, color: "#E8ECF1" }} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div style={{ marginTop: 8 }}>
                                {breakdown.map((b, i) => (
                                    <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 11 }}>
                                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                                        <span style={{ flex: 1, color: "#E8ECF1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                                        <span style={{ color: "#9AA4B5" }}>{b.value.toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : !loading && (
                        <Empty>No type data</Empty>
                    )}

                    <SectionHeader style={{ marginTop: 20 }}>Threat Matrix</SectionHeader>
                    <ThreatMatrix compact />

                    <SectionHeader style={{ marginTop: 20 }}>Surveillance Zones</SectionHeader>
                    <SurveillanceZoneAnalytics />
                </div>
            )}
        </div>
    )
}

// ── Surveillance Zone Analytics ────────────────────────────────────────────────
function SurveillanceZoneAnalytics() {
    const [zones,      setZones]      = useState([])
    const [selectedId, setSelectedId] = useState(null)
    const [analytics,  setAnalytics]  = useState(null)
    const [loading,    setLoading]    = useState(false)

    useEffect(() => {
        fetch(`${API_BASE}/api/watch-zones`)
            .then(r => r.ok ? r.json() : [])
            .then(data => {
                const list = Array.isArray(data) ? data : (data?.zones ?? [])
                setZones(list)
                if (list.length > 0 && !selectedId) setSelectedId(list[0].system_id)
            })
            .catch(() => {})
    }, [])

    useEffect(() => {
        if (!selectedId) return
        setLoading(true)
        setAnalytics(null)
        fetch(`${API_BASE}/api/watch-zones/${selectedId}/analytics`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { setAnalytics(data); setLoading(false) })
            .catch(() => setLoading(false))
    }, [selectedId])

    if (zones.length === 0) return <Empty>No surveillance zones configured</Empty>

    const detTimeData  = analytics?.detections_over_time ?? []
    const detTypeData  = Object.entries(analytics?.detections_by_type ?? {}).map(([name, value]) => ({ name, value }))
    const trend        = analytics?.vessel_activity_trend ?? "stable"
    const trendColor   = trend === "increasing" ? "#ef4444" : trend === "decreasing" ? "#22c55e" : "#94a3b8"

    return (
        <div>
            {/* Zone selector */}
            <select
                value={selectedId ?? ""}
                onChange={e => setSelectedId(e.target.value)}
                style={{
                    width: "100%", background: "#0F1721", color: "#94a3b8",
                    border: "1px solid #1e293b", borderRadius: 5, padding: "5px 8px",
                    fontSize: 11, marginBottom: 10, cursor: "pointer",
                }}>
                {zones.map(z => <option key={z.system_id} value={z.system_id}>{z.name}</option>)}
            </select>

            {loading && <div style={{ color: "#475569", fontSize: 10, padding: "8px 0", textAlign: "center" }}>Loading…</div>}

            {analytics && (
                <>
                    {/* Summary cards */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                        {[
                            { label: "Total Scans",  value: analytics.scans_total },
                            { label: "Scans (30d)",  value: analytics.scans_last_30_days },
                            { label: "Vessel Trend", value: trend, color: trendColor },
                            { label: "Δ vs baseline", value: `${analytics.change_vs_baseline_pct > 0 ? "+" : ""}${analytics.change_vs_baseline_pct}%`, color: trendColor },
                        ].map(c => (
                            <div key={c.label} style={{
                                flex: 1, background: "rgba(17,24,39,0.7)", borderRadius: 5,
                                padding: "5px 6px", textAlign: "center",
                            }}>
                                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{c.label}</div>
                                <div style={{ color: c.color ?? "#e2e8f0", fontSize: 11, fontWeight: 600 }}>{c.value}</div>
                            </div>
                        ))}
                    </div>

                    {/* Detections over time */}
                    {detTimeData.length > 0 && (
                        <>
                            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Detections over time</div>
                            <ResponsiveContainer width="100%" height={80}>
                                <LineChart data={detTimeData} margin={{ top: 2, right: 4, bottom: 0, left: -24 }}>
                                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                                    <XAxis dataKey="date" tick={{ fill: "#334155", fontSize: 7 }} tickLine={false} />
                                    <YAxis tick={{ fill: "#334155", fontSize: 7 }} tickLine={false} />
                                    <Tooltip contentStyle={{ background: "#0F1721", border: "1px solid #1e293b", fontSize: 10 }} />
                                    <Line type="monotone" dataKey="count" stroke="#4A9EE0" strokeWidth={1.5} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </>
                    )}

                    {/* Type pie */}
                    {detTypeData.length > 0 && (
                        <>
                            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 8, marginBottom: 4 }}>Detection types</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <ResponsiveContainer width={80} height={80}>
                                    <PieChart>
                                        <Pie data={detTypeData} dataKey="value" cx="50%" cy="50%" outerRadius={36} innerRadius={16}>
                                            {detTypeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                        </Pie>
                                        <Tooltip contentStyle={{ background: "#0F1721", border: "1px solid #1e293b", fontSize: 10 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div style={{ flex: 1 }}>
                                    {detTypeData.map((d, i) => (
                                        <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 0" }}>
                                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                                            <span style={{ flex: 1, color: "#64748b", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name.replace(/_/g, " ")}</span>
                                            <span style={{ color: "#94a3b8", fontSize: 9 }}>{d.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    )
}

// ── Threat Matrix ──────────────────────────────────────────────────────────────
function forgeAuthHeaders() {
    return {
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
        "X-Forge-Passcode": localStorage.getItem("forge_passcode") || "",
    }
}

const LEVEL_COLORS = {
    CRITICAL: "#ef4444",
    HIGH:     "#f59e0b",
    ELEVATED: "#60a5fa",
    MEDIUM:   "#f59e0b",
    LOW:      "#22c55e",
}

const REGION_LINE_COLORS = [
    "#4A9EE0", "#5BC97F", "#E8B23A", "#E55757",
    "#9B59B6", "#38bdf8", "#f97316", "#ec4899",
    "#14b8a6", "#a78bfa",
]

function TrendArrow({ current, previous }) {
    if (previous == null) return null
    const delta = current - previous
    if (Math.abs(delta) < 1) return <span style={{ color: "#64748b", fontSize: 10 }}>—</span>
    return delta > 0
        ? <span style={{ color: "#ef4444", fontSize: 10 }}>▲</span>
        : <span style={{ color: "#22c55e", fontSize: 10 }}>▼</span>
}

function RegionChart({ regionName, onClose }) {
    const [history, setHistory] = useState([])
    const [days, setDays]       = useState(30)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        setLoading(true)
        fetch(`${API_BASE}/api/analytics/threat-matrix/history?region_name=${encodeURIComponent(regionName)}&days=${days}`)
            .then(r => r.ok ? r.json() : [])
            .then(data => { setHistory(Array.isArray(data) ? data : []); setLoading(false) })
            .catch(() => setLoading(false))
    }, [regionName, days])

    const chartData = history.map(h => ({
        date:  h.snapshot_date?.slice(5),
        score: h.threat_score,
    }))

    return (
        <div style={{ background: "#0F1721", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 12px", marginTop: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ color: "#94a3b8", fontSize: 10, fontWeight: 600 }}>{regionName} — 30d trend</span>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {[7, 30, 90].map(d => (
                        <button key={d} onClick={() => setDays(d)} style={{
                            background: days === d ? "#1e3a5f" : "transparent",
                            border: `1px solid ${days === d ? "#4A9EE0" : "#1e293b"}`,
                            color: days === d ? "#4A9EE0" : "#64748b",
                            borderRadius: 4, padding: "1px 6px", fontSize: 9, cursor: "pointer",
                        }}>{d}d</button>
                    ))}
                    <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#475569", cursor: "pointer", fontSize: 12, padding: "0 2px" }}>✕</button>
                </div>
            </div>
            {loading ? (
                <div style={{ color: "#475569", fontSize: 10, padding: "12px 0", textAlign: "center" }}>Loading…</div>
            ) : chartData.length === 0 ? (
                <div style={{ color: "#475569", fontSize: 10, padding: "12px 0", textAlign: "center" }}>No historical data yet</div>
            ) : (
                <ResponsiveContainer width="100%" height={100}>
                    <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 8 }} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 8 }} tickLine={false} />
                        <Tooltip
                            contentStyle={{ background: "#0F1721", border: "1px solid #1e293b", borderRadius: 6, fontSize: 10 }}
                            labelStyle={{ color: "#94a3b8" }}
                            formatter={(v) => [`${v}`, "Score"]}
                        />
                        {/* Reference bands */}
                        <svg><defs>
                            <linearGradient id="threatGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.08} />
                                <stop offset="25%"  stopColor="#f59e0b" stopOpacity={0.06} />
                                <stop offset="50%"  stopColor="#60a5fa" stopOpacity={0.04} />
                                <stop offset="100%" stopColor="#22c55e" stopOpacity={0.03} />
                            </linearGradient>
                        </defs></svg>
                        <Line type="monotone" dataKey="score" stroke="#4A9EE0" strokeWidth={1.5} dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            )}
        </div>
    )
}

function GlobalOverviewChart() {
    const [history, setHistory] = useState([])
    const [days, setDays]       = useState(7)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        setLoading(true)
        fetch(`${API_BASE}/api/analytics/threat-matrix/history?days=${days}`)
            .then(r => r.ok ? r.json() : [])
            .then(data => { setHistory(Array.isArray(data) ? data : []); setLoading(false) })
            .catch(() => setLoading(false))
    }, [days])

    // Pivot: date → { [region]: score }
    const regionNames = [...new Set(history.map(h => h.region_name))]
    const byDate = {}
    history.forEach(h => {
        if (!byDate[h.snapshot_date]) byDate[h.snapshot_date] = { date: h.snapshot_date?.slice(5) }
        byDate[h.snapshot_date][h.region_name] = h.threat_score
    })
    const chartData = Object.values(byDate).sort((a, b) => a.date < b.date ? -1 : 1)

    return (
        <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Global Overview</span>
                <div style={{ display: "flex", gap: 4 }}>
                    {[7, 30, 90].map(d => (
                        <button key={d} onClick={() => setDays(d)} style={{
                            background: days === d ? "#1e3a5f" : "transparent",
                            border: `1px solid ${days === d ? "#4A9EE0" : "#1e293b"}`,
                            color: days === d ? "#4A9EE0" : "#64748b",
                            borderRadius: 4, padding: "1px 6px", fontSize: 9, cursor: "pointer",
                        }}>{d}d</button>
                    ))}
                </div>
            </div>
            {loading ? (
                <div style={{ color: "#475569", fontSize: 10, padding: "12px 0", textAlign: "center" }}>Loading…</div>
            ) : chartData.length === 0 ? (
                <div style={{ color: "#475569", fontSize: 10, padding: "12px 0", textAlign: "center" }}>No historical data yet</div>
            ) : (
                <ResponsiveContainer width="100%" height={120}>
                    <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 8 }} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 8 }} tickLine={false} />
                        <Tooltip
                            contentStyle={{ background: "#0F1721", border: "1px solid #1e293b", borderRadius: 6, fontSize: 10 }}
                            labelStyle={{ color: "#94a3b8" }}
                        />
                        {regionNames.map((r, i) => (
                            <Line key={r} type="monotone" dataKey={r} stroke={REGION_LINE_COLORS[i % REGION_LINE_COLORS.length]}
                                strokeWidth={1.5} dot={false} name={r} />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            )}
        </div>
    )
}

function ThreatMatrix({ compact = false }) {
    const [scores,   setScores]   = useState([])
    const [loading,  setLoading]  = useState(true)
    const [history,  setHistory]  = useState([])
    const [expanded, setExpanded] = useState(null)   // region name being drilled into

    useEffect(() => {
        fetch(`${API_BASE}/api/analytics/threat-matrix`)
            .then(r => r.ok ? r.json() : [])
            .then(data => { setScores(Array.isArray(data) ? data : []); setLoading(false) })
            .catch(() => setLoading(false))
        // Fetch yesterday's snapshot for trend arrows
        fetch(`${API_BASE}/api/analytics/threat-matrix/history?days=2`)
            .then(r => r.ok ? r.json() : [])
            .then(data => setHistory(Array.isArray(data) ? data : []))
            .catch(() => {})
    }, [])

    const yesterdayMap = {}
    const today = new Date().toISOString().slice(0, 10)
    history.forEach(h => {
        if (h.snapshot_date < today) {
            if (!yesterdayMap[h.region_name] || h.snapshot_date > yesterdayMap[h.region_name].snapshot_date)
                yesterdayMap[h.region_name] = h
        }
    })

    if (loading) return <div style={{ color: "#9AA4B5", fontSize: 10, padding: "8px 0" }}>Loading threat data…</div>

    if (scores.length === 0) {
        return (
            <div style={{ color: "#475569", fontSize: 10, padding: "8px 0", textAlign: "center" }}>
                No threat scores yet — cache refreshes hourly.
            </div>
        )
    }

    return (
        <div>
            {scores.map(s => {
                const c    = LEVEL_COLORS[s.threat_level] || "#64748b"
                const prev = yesterdayMap[s.region_name]
                const isOpen = expanded === s.region_name
                return (
                    <div key={s.region_name}>
                        <div
                            onClick={() => setExpanded(isOpen ? null : s.region_name)}
                            style={{
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                padding: compact ? "5px 8px" : "7px 10px",
                                marginBottom: 3,
                                background: isOpen ? "rgba(30,58,95,0.5)" : "rgba(17,24,39,0.7)",
                                borderRadius: 5,
                                borderLeft: `3px solid ${c}`,
                                cursor: "pointer",
                            }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: "#cbd5e1", fontSize: compact ? 10 : 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {s.region_name}
                                </div>
                                {!compact && (
                                    <div style={{ color: "#475569", fontSize: 9, marginTop: 1 }}>
                                        {s.alert_count ?? 0} alerts · {s.sentinel_detection_count ?? 0} detections
                                    </div>
                                )}
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8, display: "flex", alignItems: "center", gap: 4 }}>
                                {(s.fusion_count ?? 0) > 0 && (
                                    <span title={`${s.fusion_count} active fusion event${s.fusion_count !== 1 ? "s" : ""}`} style={{
                                        fontSize: 9, padding: "1px 5px", borderRadius: 3,
                                        background: "rgba(191,90,242,0.18)", color: "#BF5AF2",
                                        fontWeight: 700, letterSpacing: "0.04em",
                                    }}>⚡{s.fusion_count}</span>
                                )}
                                <TrendArrow current={s.threat_score} previous={prev?.threat_score} />
                                <div>
                                    <div style={{ color: c, fontSize: compact ? 9 : 10, fontWeight: 700 }}>{s.threat_level}</div>
                                    <div style={{ color: "#94a3b8", fontSize: compact ? 11 : 13, fontWeight: 700 }}>{s.threat_score ?? 0}</div>
                                </div>
                            </div>
                        </div>
                        {isOpen && !compact && (
                            <RegionChart regionName={s.region_name} onClose={() => setExpanded(null)} />
                        )}
                    </div>
                )
            })}
            {!compact && <GlobalOverviewChart />}
        </div>
    )
}

function Stat({ label, value }) {
    return (
        <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#E8ECF1", marginTop: 2 }}>{value}</div>
        </div>
    )
}

function SectionHeader({ children, style }) {
    return (
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: 6, ...style }}>
            {children}
        </div>
    )
}

function Empty({ children }) {
    return <div style={{ color: "#9AA4B5", fontSize: 11, padding: 16, textAlign: "center" }}>{children}</div>
}
