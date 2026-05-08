// Traffic analytics panel — line chart of hourly counts plus type breakdown.
// Backed by /api/analytics/timeseries and /api/analytics/breakdown.

import { useEffect, useState } from "react"
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, CartesianGrid,
} from "recharts"
import API_BASE from "../apiBase.js"

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

export default function AnalyticsPanel({ onClose }) {
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
            setTimeseries((ts?.points || []).map(p => ({ time: fmtTime(p.time), count: p.count })))
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
                <button onClick={onClose} style={{ background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
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
            </div>
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
