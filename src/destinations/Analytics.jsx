import { useState, useEffect, useMemo, useRef } from "react"
import { scaleLinear, scaleTime } from "d3-scale"
import { area as d3area, curveMonotoneX } from "d3-shape"
import API_BASE from "../apiBase.js"
import { useFloatingReadout } from "../components/FloatingReadout.jsx"
import { addToBriefing } from "../state/briefingBasket.js"
import Capturable from "../capture/Capturable.jsx"
import { toast } from "../ui/toast.js"
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
// so it deliberately does NOT animate between data states.
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
                <PanelNote>
                    How many signals arrived over the window, by hour. This is
                    ARRIVAL, not occurrence: a quiet stretch can mean a quiet
                    world or a feed that stopped, and the two look identical
                    here. Check the freshness indicator in the top bar before
                    reading a dip as calm.
                </PanelNote>
                {points.length === 0 ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>No signals in this window.</div>
                ) : (
                    <svg width={width} height={height}>
                        <g transform={`translate(${margin.left},${margin.top})`}>
                            {ticks.map((t) => (
                                <g key={t}>
                                    <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} style={{ stroke: "var(--chart-grid)" }} strokeWidth={1} />
                                    <text x={-6} y={y(t)} dy="0.32em" textAnchor="end"
                                        style={{ font: "400 9.5px var(--mono)", fill: "var(--txt-4)" }}>{t}</text>
                                </g>
                            ))}
                            <path d={areaGen(points)} style={{ fill: "var(--chart-area-fill)", stroke: "var(--chart-area-stroke)" }} strokeWidth={1.25} />
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

// §5 — the four share-of-window breakdowns.
//
// These were donuts, and they were unreadable. Three of the four distributions
// are extremely skewed — maritime is 90% of the domain split, "Other" is 83%
// of the region split — so every class that wasn't the leader rendered as a
// one-or-two-degree sliver. Colour couldn't rescue that: the categorical ramp
// was fourteen near-identical greys picked by hashing the class name, so the
// 90% arc and the 8% arc could differ by two hex points. Even the severity
// donut, which had real colours, failed on its two biggest classes —
// --sev-moderate and --sev-low measure ΔE 5.9 apart in normal vision.
//
// A ranked horizontal bar fixes all of it at once. Every row is named in text,
// so identity never rests on colour; a common baseline makes the magnitudes
// comparable; long region names have somewhere to go; and a 0.4% class is
// honestly tiny while its exact count sits right beside it. Colour is now one
// hue carrying magnitude (severity keeps its reserved status colours, which
// are label-paired here and so never load-bearing alone).
function ShareBars({ label, items, colorFor, onPick = null, selected = null, note }) {
    const { readout, bind } = useFloatingReadout()
    const total = items.reduce((s, d) => s + d.value, 0)
    const max = items.reduce((m, d) => Math.max(m, d.value), 0) || 1

    return (
        <div className="panelbox" style={{ flex: 1, minWidth: 0 }}>
            {readout}
            <div className="head"><span className="caption">{label}</span></div>
            <div className="body">
                <PanelNote>{note}</PanelNote>
                {total === 0 ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>
                        Nothing in this window.
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {items.map((d) => {
                            const isSel = selected != null && selected === d.key
                            const dimmed = onPick && selected != null && !isSel
                            const share = total ? (d.value / total) * 100 : 0
                            // Share is rounded for reading but never rounded to
                            // "0.0%" while the class still has signals in it —
                            // a row that exists has to look like it exists.
                            const shareText = share > 0 && share < 0.1 ? "<0.1%" : `${share.toFixed(1)}%`
                            return (
                                <div key={d.key}
                                     tabIndex={0}
                                     role={onPick ? "button" : undefined}
                                     onClick={onPick ? () => onPick(isSel ? null : d.key) : undefined}
                                     onKeyDown={onPick ? (e) => {
                                         if (e.key === "Enter" || e.key === " ") {
                                             e.preventDefault()
                                             onPick(isSel ? null : d.key)
                                         }
                                     } : undefined}
                                     {...bind({
                                         title: d.label,
                                         lines: [
                                             `${d.value.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")} signals (${shareText})`,
                                             "A share of this window only — a class that doubles because the total halved has not grown.",
                                             ...(onPick ? [isSel ? "Selected — activate to clear the filter." : "Activate to filter every chart on this page to this class."] : []),
                                         ],
                                     })}
                                     style={{
                                         display: "flex", alignItems: "center", gap: 8,
                                         cursor: onPick ? "pointer" : "default",
                                         opacity: dimmed ? 0.45 : 1,
                                         transition: "opacity .15s",
                                     }}>
                                    <span style={{
                                        width: 104, flexShrink: 0,
                                        font: `${isSel ? 600 : 400} 11px var(--font)`,
                                        color: "var(--txt)",
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{d.label}</span>
                                    <div style={{
                                        flex: 1, minWidth: 0, height: 8,
                                        background: "var(--chart-bar-track)",
                                        borderRadius: 2,
                                    }}>
                                        <div style={{
                                            width: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / max) * 100)}%`,
                                            height: "100%",
                                            background: colorFor(d),
                                            borderRadius: "2px 4px 4px 2px",
                                            transition: "width .26s",
                                        }} />
                                    </div>
                                    <span style={{
                                        width: 42, flexShrink: 0, textAlign: "right",
                                        font: "400 11px var(--mono)", color: "var(--txt-2)",
                                        fontVariantNumeric: "tabular-nums",
                                    }}>{shareText}</span>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}

// §6 (left half) — region x domain heatmap. Empty cells render at
// --heatmap-empty (visually distinct from a real low value), everything
// else interpolates --heatmap-lo -> --heatmap-hi by magnitude.
/**
 * One line under a panel title saying what the panel is.
 *
 * Rule 5 in this codebase's spec is that an empty pane explains itself;
 * the same argument applies to a full one. Every chart here was a title
 * and a picture, so what "movers" meant, or what a heatmap cell counted,
 * was something you had to already know.
 */
function PanelNote({ children }) {
    return (
        <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)",
                      padding: "0 0 6px", lineHeight: 1.4 }}>
            {children}
        </div>
    )
}


function Heatmap({ regions, domains, cells, onPick = null }) {
    const { readout, bind } = useFloatingReadout()
    const maxCount = Math.max(1, ...cells.map((c) => c.count))
    const cellMap = useMemo(() => {
        const m = new Map()
        for (const c of cells) m.set(`${c.region}|${c.domain}`, c.count)
        return m
    }, [cells])

    function colorFor(count) {
        if (!count) return "var(--heatmap-empty)"
        // Real fix (Parallax theming pass): this used to hardcode a JS-side
        // copy of --heatmap-lo/--heatmap-hi's dark-theme hex values, unable
        // to ever pick up the real light-theme heatmap values (lerpHex needs
        // real numeric hex to interpolate, so a plain var(--x) string can't
        // be used directly here — reads the REAL computed value instead).
        const cs = getComputedStyle(document.documentElement)
        const lo = cs.getPropertyValue("--heatmap-lo").trim()
        const hi = cs.getPropertyValue("--heatmap-hi").trim()
        return lerpHex(lo, hi, count / maxCount)
    }

    return (
        <div className="panelbox" style={{ flex: 1, minWidth: 0 }}>
            {readout}
            <div className="head"><span className="caption">Region × domain</span></div>
            <div className="body" style={{ overflowX: "auto" }}>
                <PanelNote>
                    Signals in the selected window, counted by where they were and
                    which sensor family reported them. Darker is more.
                    {onPick ? " Click a cell to filter everything below to it." : ""}
                </PanelNote>
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
                                        <div key={d}
                                            {...bind({
                                                title: `${r} · ${DOMAIN_LABELS[d]}`,
                                                lines: [
                                                    `${count} signal${count === 1 ? "" : "s"} in the selected window`,
                                                    count === 0
                                                        ? "Nothing reported here from this sensor family."
                                                        : `${Math.round((count / Math.max(1, maxCount)) * 100)}% of the busiest cell`,
                                                    onPick ? "Click to filter everything below to this region and domain." : "",
                                                ],
                                            })}
                                            role={onPick ? "button" : undefined}
                                            tabIndex={onPick ? 0 : undefined}
                                            onClick={onPick ? () => onPick(r, d) : undefined}
                                            onKeyDown={onPick ? (e) => {
                                                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(r, d) }
                                            } : undefined}
                                            style={{
                                                width: 22, height: 22, borderRadius: "var(--r)",
                                                cursor: onPick ? "pointer" : "default",
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
    const { readout, bind } = useFloatingReadout()
    return (
        <div className="panelbox" style={{ flex: 1, minWidth: 0 }}>
            {readout}
            <div className="head"><span className="caption">Index movers</span></div>
            <div className="body">
                <PanelNote>
                    The largest changes in signal count against the previous
                    window of the same length. A bar is the size of the move,
                    not the size of the total.
                </PanelNote>
                {movers.length === 0 ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>No movement in this window.</div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        {movers.map((m) => (
                            <div key={m.key}
                                 tabIndex={0}
                                 {...bind({
                                     title: m.label,
                                     lines: [
                                         `${m.delta > 0 ? "+" : ""}${m.delta} against the previous window of the same length`,
                                         m.delta > 0
                                             ? "More activity than the comparable period, not a total."
                                             : m.delta < 0
                                                 ? "Less activity than the comparable period."
                                                 : "Unchanged against the comparable period.",
                                         "The bar is the size of the move, not the size of the total.",
                                     ],
                                 })}
                                 style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                <div style={{ padding: "8px 11px 0" }}>
                    <PanelNote>
                        Critical and high signals only, newest first. Click a
                        column to sort, a row to open it on the map, or the
                        clock to replay what led up to it. "Brief these" writes
                        the visible set into a briefing.
                    </PanelNote>
                </div>
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
        <div data-testid="view-root-analytics" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg-0)" }}>
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
                        <Capturable label="Signal volume" detail={`${data.range} · ${data.region} · ${data.domain}`}>
                            <VolumeChart timeseries={data.timeseries} />
                        </Capturable>
                        <div style={{ display: "flex", gap: 12 }}>
                            <Capturable label="By severity" detail={`${data.range} · ${data.region}`}>
                                <ShareBars label="By severity" items={data.donuts.severity}
                                           colorFor={(item) => SEV_COLOR[item.key]}
                                           note="How this window's signals divide by severity. Each row is named, so the colours only rank them." />
                            </Capturable>
                            <Capturable label="By domain" detail={`${data.range} · ${data.region}`}>
                                <ShareBars label="By domain" items={data.donuts.domain}
                                           colorFor={() => "var(--chart-bar)"}
                                           note="Share of this window by domain. Select a row to filter every chart on this page."
                                           selected={domain === "all" ? null : domain}
                                           onPick={(k) => setDomain(k || "all")} />
                            </Capturable>
                            <Capturable label="By region" detail={`${data.range} · ${data.region}`}>
                                <ShareBars label="By region" items={data.donuts.region}
                                           colorFor={() => "var(--chart-bar)"}
                                           note="The six busiest regions this window; the rest are counted under Other. Select a row to filter."
                                           selected={region === "all" ? null : region}
                                           onPick={(k) => setRegion(k || "all")} />
                            </Capturable>
                            <Capturable label="By source" detail={`${data.range} · ${data.region}`}>
                                <ShareBars label="By source" items={data.donuts.source}
                                           colorFor={() => "var(--chart-bar)"}
                                           note="Which collection capability produced this window's signals." />
                            </Capturable>
                        </div>
                        <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
                            {/* Clicking a cell drives the SAME region/domain
                                selects in the toolbar above rather than a
                                second, parallel filter — so the controls
                                always show what is actually applied. */}
                            <Capturable label="Region / domain heatmap" detail={`${data.range}`}>
                                <Heatmap regions={data.heatmap.regions} domains={data.heatmap.domains}
                                         cells={data.heatmap.cells}
                                         onPick={(r, d) => { setRegion(r); setDomain(d) }} />
                            </Capturable>
                            <Capturable label="Biggest movers" detail={`${data.range}`}>
                                <MoversTable movers={data.movers} />
                            </Capturable>
                        </div>
                        <SignalsTable rows={data.top_signals} onBriefAll={handleBriefAll} />
                    </>
                )}
            </div>
        </div>
    )
}
