import { useState, useEffect, useMemo, useRef } from "react"
import { scaleLinear, scaleTime } from "d3-scale"
import { area as d3area, curveMonotoneX, pie as d3pie, arc as d3arc } from "d3-shape"
import API_BASE from "../apiBase.js"
import { addToBriefing } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"
import { applyTransition } from "../utils/rafTransition.js"
import { replayOnMap } from "../services/replayOnMap.js"

// Analytics — page-by-page rebuild. Full-width, single-column module (no
// side panes), rebuilt onto the real design system per the Exact Replication
// Manual. Every number here comes from GET /api/analytics/overview
// (backend/routers/analytics.py), which aggregates real Alert/NewsArticle/
// SentinelDetection/WatchZone/Report rows — nothing on this page is
// randomized or hardcoded, and a reload with the same filters reproduces
// byte-identical numbers since the backend does no randomization either.

const RANGES = [
    { key: "7d", label: "7d" },
    { key: "30d", label: "30d" },
    { key: "90d", label: "90d" },
]

const DOMAIN_OPTIONS = [
    { key: "all", label: "All domains" },
    { key: "maritime", label: "Maritime" },
    { key: "air", label: "Air" },
    { key: "news", label: "News" },
    { key: "imagery", label: "Imagery" },
    { key: "zones", label: "Zones" },
]

const DOMAIN_LABELS = { maritime: "Maritime", air: "Air", news: "News", imagery: "Imagery", zones: "Zones" }

const SEV_COLOR = {
    critical: "var(--sev-critical)", high: "var(--sev-high)",
    moderate: "var(--sev-moderate)", low: "var(--sev-low)",
}

// The one fixed grey ramp for every non-severity chart on this page (domain/
// region/source donuts + reused nowhere else) — a category's shade is a
// hash of its own name, not its position in whatever subset is currently
// visible, so "Baltic" keeps the same shade across any filter combination.
const GREY_RAMP = [
    "#9aa5ae", "#8b96a0", "#8d9aa4", "#7c8792", "#7d8993", "#6d7883", "#6f7b85",
    "#5f6a74", "#626e78", "#515c66", "#55616b", "#444e58", "#4a555f", "#404b54",
]
function greyForName(name) {
    let h = 0
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
    return GREY_RAMP[h % GREY_RAMP.length]
}

function lerpHex(a, b, t) {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
    const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t))
    return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

function formatTime(iso) {
    if (!iso) return "—"
    const d = new Date(iso)
    return `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}Z`
}

function csvEscape(v) {
    if (v == null) return ""
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCsv(data) {
    const lines = [
        "Parallax — Analytics export",
        `Range,${data.range}`, `Region,${data.region}`, `Domain,${data.domain}`,
        `Generated,${data.generated_at}`, "",
        "KPI,Value,Delta %",
        ...Object.entries(data.kpis).map(([k, v]) => `${k},${v.value ?? ""},${v.delta_pct ?? ""}`),
        "", "severity,title,domain,region,created_at,source,entity_id",
        ...data.top_signals.map((r) => [
            r.severity, csvEscape(r.title), r.domain, csvEscape(r.region),
            r.created_at, r.source, r.entity_id || "",
        ].join(",")),
    ]
    const blob = new Blob([lines.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `horizon-watch-analytics-${data.range}-${data.region}-${data.domain}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

const KPI_DEFS = [
    { key: "signals_ingested", label: "Signals ingested", worseOnIncrease: false },
    { key: "signals_assessed", label: "Signals assessed", worseOnIncrease: false },
    { key: "critical_open", label: "Critical open", worseOnIncrease: true },
    { key: "regions_touched", label: "Regions touched", worseOnIncrease: false },
    { key: "aois_watched", label: "AOIs watched", worseOnIncrease: null },
    { key: "reports_issued", label: "Reports issued", worseOnIncrease: false },
    { key: "mean_time_to_report_hours", label: "Mean time-to-report (h)", worseOnIncrease: true },
    { key: "escalations", label: "Escalations", worseOnIncrease: true },
]

function KpiStrip({ kpis }) {
    return (
        <div className="statgrid">
            {KPI_DEFS.map((def) => {
                const k = kpis[def.key] || {}
                const delta = k.delta_pct
                let deltaClass = "", deltaText = "—"
                if (delta != null && def.worseOnIncrease != null) {
                    const isWorse = def.worseOnIncrease ? delta > 0 : delta < 0
                    deltaClass = isWorse ? "worse" : "better"
                    deltaText = `${delta > 0 ? "+" : ""}${delta}%`
                }
                return (
                    <div className="stat" key={def.key}>
                        <span className="value">{k.value == null ? "—" : k.value.toLocaleString()}</span>
                        {/* §1 — mono is reserved for numeric figures; the shared
                            .delta class (used by other modules too) sets a sans
                            font, so the mono override is applied inline here,
                            scoped to this page only. */}
                        <span className={`delta ${deltaClass}`} style={{ fontFamily: "var(--mono)" }}>{deltaText}</span>
                        <span className="label">{def.label}</span>
                    </div>
                )
            })}
        </div>
    )
}

// §4 — real d3 area chart. No animated count-up: per the "no ambient motion
// beyond the clock/telemetry" rule this renders its current values directly,
// so it deliberately does NOT use applyTransition().
function VolumeChart({ timeseries }) {
    const ref = useRef(null)
    const [width, setWidth] = useState(600)
    useEffect(() => {
        if (!ref.current) return
        const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect?.width
            if (w) setWidth(w)
        })
        ro.observe(ref.current)
        return () => ro.disconnect()
    }, [])

    const height = 140
    const margin = { top: 10, right: 12, bottom: 18, left: 34 }
    const innerW = Math.max(10, width - margin.left - margin.right)
    const innerH = height - margin.top - margin.bottom

    const points = (timeseries || []).map((p) => ({ date: new Date(p.date), count: p.count }))
    const x = scaleTime()
        .domain(points.length ? [points[0].date, points[points.length - 1].date] : [new Date(), new Date()])
        .range([0, innerW])
    const yMax = Math.max(1, ...points.map((p) => p.count))
    const y = scaleLinear().domain([0, yMax]).nice().range([innerH, 0])

    const areaGen = d3area()
        .x((p) => x(p.date))
        .y0(innerH)
        .y1((p) => y(p.count))
        .curve(curveMonotoneX)

    const ticks = y.ticks(3)

    return (
        <div className="panelbox">
            <div className="head"><span className="caption">Signal volume</span></div>
            <div className="body" ref={ref}>
                {points.length === 0 ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>No signals in this window.</div>
                ) : (
                    <svg width={width} height={height}>
                        <g transform={`translate(${margin.left},${margin.top})`}>
                            {ticks.map((t) => (
                                <g key={t}>
                                    <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                                    <text x={-6} y={y(t)} dy="0.32em" textAnchor="end"
                                        style={{ font: "400 9.5px var(--mono)", fill: "var(--txt-4)" }}>{t}</text>
                                </g>
                            ))}
                            <path d={areaGen(points)} fill="var(--chart-area-fill)" stroke="var(--chart-area-stroke)" strokeWidth={1.25} />
                            {[points[0], points[points.length - 1]].map((p, i) => (
                                <text key={i} x={x(p.date)} y={innerH + 14}
                                    textAnchor={i === 0 ? "start" : "end"}
                                    style={{ font: "400 9px var(--mono)", fill: "var(--txt-4)" }}>
                                    {p.date.toISOString().slice(5, 10)}
                                </text>
                            ))}
                        </g>
                    </svg>
                )}
            </div>
        </div>
    )
}

// §5 — the four donuts. Arc sweep animates via the shared rAF-safe helper
// (applyTransition) on data change; if rAF is unavailable/throttled the new
// angles are applied in one synchronous step instead of freezing mid-sweep.
function Donut({ label, items, colorFor }) {
    const outerR = 40, innerR = 26, size = 96
    const pieGen = useMemo(() => d3pie().value((d) => d.value).sort(null), [])
    const arcGen = useMemo(() => d3arc().innerRadius(innerR).outerRadius(outerR), [])
    const target = useMemo(() => pieGen(items), [items, pieGen])
    const [rendered, setRendered] = useState(target)
    const prevRef = useRef(target)

    useEffect(() => {
        const prev = prevRef.current
        applyTransition(260, (t) => {
            setRendered(target.map((d, i) => {
                const p = prev[i]
                if (!p) return d
                return {
                    ...d,
                    startAngle: p.startAngle + (d.startAngle - p.startAngle) * t,
                    endAngle: p.endAngle + (d.endAngle - p.endAngle) * t,
                }
            }))
            if (t === 1) prevRef.current = target
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items])

    const total = items.reduce((s, d) => s + d.value, 0)

    return (
        <div className="panelbox" style={{ flex: 1, minWidth: 0 }}>
            <div className="head"><span className="caption">{label}</span></div>
            <div className="body" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    <g transform={`translate(${size / 2},${size / 2})`}>
                        {rendered.map((d) => (
                            <path key={d.data.key} d={arcGen(d) || undefined} fill={colorFor(d.data)}>
                                <title>{d.data.label}: {d.data.value.toLocaleString()}</title>
                            </path>
                        ))}
                        <text textAnchor="middle" dy="0.35em" style={{ font: "400 13px var(--mono)", fill: "var(--txt)" }}>
                            {total.toLocaleString()}
                        </text>
                    </g>
                </svg>
            </div>
        </div>
    )
}

// §6 (left half) — region x domain heatmap. Empty cells render at
// --heatmap-empty (visually distinct from a real low value), everything
// else interpolates --heatmap-lo -> --heatmap-hi by magnitude.
function Heatmap({ regions, domains, cells }) {
    const maxCount = Math.max(1, ...cells.map((c) => c.count))
    const cellMap = useMemo(() => {
        const m = new Map()
        for (const c of cells) m.set(`${c.region}|${c.domain}`, c.count)
        return m
    }, [cells])

    function colorFor(count) {
        if (!count) return "var(--heatmap-empty)"
        return lerpHex("#232a30", "#5c6b78", count / maxCount)
    }

    return (
        <div className="panelbox" style={{ flex: 1, minWidth: 0 }}>
            <div className="head"><span className="caption">Region × domain</span></div>
            <div className="body" style={{ overflowX: "auto" }}>
                {regions.length === 0 ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>No signals in this window.</div>
                ) : (
                    <div style={{ display: "grid", gridTemplateColumns: `110px repeat(${domains.length}, 22px)`, gridAutoRows: 22, gap: 2, alignItems: "center" }}>
                        <div />
                        {domains.map((d) => (
                            <div key={d} title={DOMAIN_LABELS[d]}
                                style={{ font: "400 9px var(--mono)", color: "var(--txt-4)", textAlign: "center" }}>
                                {DOMAIN_LABELS[d].slice(0, 3)}
                            </div>
                        ))}
                        {regions.map((r) => (
                            <div key={r} style={{ display: "contents" }}>
                                <div style={{
                                    font: "400 11px var(--font)", color: "var(--txt-3)",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>{r}</div>
                                {domains.map((d) => {
                                    const count = cellMap.get(`${r}|${d}`) || 0
                                    return (
                                        <div key={d} title={`${r} · ${DOMAIN_LABELS[d]}: ${count}`}
                                            style={{
                                                width: 22, height: 22, borderRadius: "var(--r)",
                                                background: colorFor(count), transition: "background 150ms linear",
                                                // --heatmap-empty and --heatmap-lo are two literal but
                                                // very close dark shades — a 1px inset ring on genuine
                                                // zero cells keeps "no data" legible as distinct from
                                                // "real low value" the way the spec's own intent asks,
                                                // without deviating from either literal color.
                                                boxShadow: count === 0 ? "inset 0 0 0 1px var(--line-soft)" : "none",
                                            }} />
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

// §6 (right half) — index movers.
function MoversTable({ movers }) {
    return (
        <div className="panelbox" style={{ flex: 1, minWidth: 0 }}>
            <div className="head"><span className="caption">Index movers</span></div>
            <div className="body">
                {movers.length === 0 ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>No movement in this window.</div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        {movers.map((m) => (
                            <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{
                                    width: 132, flexShrink: 0, font: "400 12px var(--font)", color: "var(--txt)",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>{m.label}</span>
                                <div className="bar" style={{ flex: 1 }}><span style={{ width: `${m.bar_pct}%` }} /></div>
                                <span style={{ width: 48, flexShrink: 0, textAlign: "right", font: "400 12px var(--mono)", color: "var(--txt-2)" }}>
                                    {m.delta > 0 ? "+" : ""}{m.delta}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

const SIGNAL_COLUMNS = [
    ["severity", "Severity"], ["title", "Signal"], ["domain", "Domain"],
    ["region", "Region"], ["created_at", "Time"], ["source", "Source"],
]

// §7 — highest-severity signals table. Row click jumps to Situation via the
// same real akili:open-map / akili:fly-to / akili:show-entity chain the rest
// of the app already uses (src/services/reportDeepLink.js's recipe) — never
// a separate/parallel navigation mechanism.
function SignalsTable({ rows, onBriefAll }) {
    const [sortKey, setSortKey] = useState("created_at")
    const [sortDir, setSortDir] = useState("desc")

    const sorted = useMemo(() => {
        const copy = [...rows]
        copy.sort((a, b) => {
            let av = a[sortKey], bv = b[sortKey]
            if (sortKey === "created_at") { av = new Date(av).getTime(); bv = new Date(bv).getTime() }
            if (av < bv) return sortDir === "asc" ? -1 : 1
            if (av > bv) return sortDir === "asc" ? 1 : -1
            return 0
        })
        return copy
    }, [rows, sortKey, sortDir])

    function toggleSort(key) {
        if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
        else { setSortKey(key); setSortDir("desc") }
    }

    function jumpTo(row) {
        window.dispatchEvent(new CustomEvent("akili:open-map"))
        setTimeout(() => {
            if (row.lat != null && row.lon != null) {
                window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: row.lat, lon: row.lon, altitude: 60000 } }))
            }
        }, 50)
        const prefix = row.domain === "air" ? "adsb" : row.domain === "maritime" ? "ais" : null
        if (prefix && row.entity_id) {
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent("akili:show-entity", { detail: { id: `${prefix}-${row.entity_id}` } }))
            }, 400)
        }
    }

    return (
        <div className="panelbox">
            <div className="head">
                <span className="caption">Highest-severity signals</span>
                <button className="btn primary" onClick={() => onBriefAll(sorted)} disabled={sorted.length === 0}>
                    brief these
                </button>
            </div>
            <div className="body" style={{ padding: 0, maxHeight: 340, overflow: "auto" }}>
                {sorted.length === 0 ? (
                    <div style={{ padding: 11, font: "400 12px var(--font)", color: "var(--txt-3)" }}>
                        No critical/high-severity signals in this window.
                    </div>
                ) : (
                    <table className="grid">
                        <thead>
                            <tr>
                                {SIGNAL_COLUMNS.map(([key, label]) => (
                                    <th key={key} onClick={() => toggleSort(key)}>
                                        {label}
                                        {sortKey === key && <span className="sort-arrow">{sortDir === "asc" ? "▲" : "▼"}</span>}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((row) => (
                                <tr key={row.id} onClick={() => jumpTo(row)}>
                                    <td>
                                        <span className="tag" style={{ color: SEV_COLOR[row.severity], borderColor: SEV_COLOR[row.severity] }}>
                                            {row.severity}
                                        </span>
                                    </td>
                                    <td className="title">
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span>{row.title}</span>
                                            {row.lat != null && row.lon != null && (
                                                <button className="btn ghost sm" title="Replay on map" onClick={(e) => { e.stopPropagation(); replayOnMap({ lat: row.lat, lon: row.lon, publishedAt: row.created_at, title: row.title, severity: row.severity }) }} style={{ padding: 2, flexShrink: 0 }}>
                                                    <svg className="icon sm"><use href="#i-clock" /></svg>
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                    <td>{DOMAIN_LABELS[row.domain] || row.domain}</td>
                                    <td>{row.region}</td>
                                    <td style={{ fontFamily: "var(--mono)" }}>{formatTime(row.created_at)}</td>
                                    <td>{row.source}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}

export default function Analytics() {
    const [range, setRange] = useState("30d")
    const [region, setRegion] = useState("all")
    const [domain, setDomain] = useState("all")
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)

    // Real fix (data-pipeline-communication audit): this effect used to
    // re-fetch only when a filter changed, with no live-update path at all
    // — confirmed live that new signals arriving server-side never reached
    // this view without a manual filter toggle or a hard reload. Every
    // other live-data destination in this app polls on a real interval
    // (Dashboard.jsx's own REFRESH_MS = 60000 is the established
    // convention); this now does the same, on top of the existing
    // real refetch-on-filter-change behavior, which stays unchanged.
    useEffect(() => {
        let cancelled = false
        function load() {
            const params = new URLSearchParams({ range, region, domain })
            fetch(`${API_BASE}/api/analytics/overview?${params}`)
                .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
                .then((json) => { if (!cancelled) { setData(json); setError(null) } })
                .catch((e) => { if (!cancelled) setError(e.message) })
        }
        load()
        const t = setInterval(load, 60000)
        return () => { cancelled = true; clearInterval(t) }
    }, [range, region, domain])

    function handleBriefAll(rows) {
        if (!rows.length) return
        rows.forEach((r) => addToBriefing(r.id, r.title))
        toast(`${rows.length} signal${rows.length === 1 ? "" : "s"} added to briefing basket`, { icon: "i-check" })
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg-0)" }}>
            <div style={{
                height: 28, flexShrink: 0, background: "var(--bg-2)", borderBottom: "1px solid var(--line)",
                display: "flex", alignItems: "center", gap: 10, padding: "0 12px",
            }}>
                <div className="seg">
                    {RANGES.map((r) => (
                        <button key={r.key} aria-pressed={range === r.key} onClick={() => setRange(r.key)}>{r.label}</button>
                    ))}
                </div>
                <select className="input" style={{ height: 22, width: 168 }} value={region} onChange={(e) => setRegion(e.target.value)}>
                    <option value="all">All regions</option>
                    {(data?.region_options || []).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select className="input" style={{ height: 22, width: 140 }} value={domain} onChange={(e) => setDomain(e.target.value)}>
                    {DOMAIN_OPTIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
                <div style={{ flex: 1 }} />
                <button className="btn sm" onClick={() => data && exportCsv(data)} disabled={!data}>
                    <svg className="icon sm"><use href="#i-export" /></svg> export csv
                </button>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                {error && (
                    <div style={{ font: "400 12px var(--font)", color: "var(--delta-worse)" }}>
                        Failed to load analytics: {error}
                    </div>
                )}
                {!data && !error && (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>Loading…</div>
                )}
                {data && (
                    <>
                        <KpiStrip kpis={data.kpis} />
                        <VolumeChart timeseries={data.timeseries} />
                        <div style={{ display: "flex", gap: 12 }}>
                            <Donut label="By severity" items={data.donuts.severity} colorFor={(item) => SEV_COLOR[item.key]} />
                            <Donut label="By domain" items={data.donuts.domain} colorFor={(item) => greyForName(item.key)} />
                            <Donut label="By region" items={data.donuts.region} colorFor={(item) => greyForName(item.key)} />
                            <Donut label="By source" items={data.donuts.source} colorFor={(item) => greyForName(item.key)} />
                        </div>
                        <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
                            <Heatmap regions={data.heatmap.regions} domains={data.heatmap.domains} cells={data.heatmap.cells} />
                            <MoversTable movers={data.movers} />
                        </div>
                        <SignalsTable rows={data.top_signals} onBriefAll={handleBriefAll} />
                    </>
                )}
            </div>
        </div>
    )
}
