/**
 * Situation.jsx — redesign Round 2, §8. The new globe home screen,
 * replacing Dashboard.jsx as the app's default view (Dashboard.jsx itself
 * is left in place, unreached from the new module rail — its Watch-Queue-
 * style right panel and layer-flyout pattern are real precedent this reuses,
 * but Round 2's spec calls for a materially different layout: a real docked
 * Layers rail instead of a flyout, a severity floor + time window this app
 * never had, a density strip, and a real legend — different enough to be a
 * new component rather than a patch on the old one).
 *
 * Data: the exact same real polling Dashboard.jsx already established —
 * GET /api/surface + GET /api/fusions merged via mergeNotificationItems(),
 * GET /api/health/detailed, GET /api/reports?status=in_review — no second
 * fetching mechanism invented. The severity floor and time window are new
 * REAL client-side filters applied on top of that one real merged list, and
 * every count shown (layer rows, legend, inspector stat grid) derives from
 * that SAME filtered list — never independently recomputed, so they can't
 * disagree.
 */
import { useEffect, useMemo, useState, useRef } from "react"
import API_BASE from "../apiBase.js"
import GlobeView from "../components/GlobeView.jsx"
import MapControlStack from "../components/MapControlStack.jsx"
import { LAYER_GROUPS } from "../components/layerRailConfig.js"
import { mergeNotificationItems } from "../components/notificationsNormalize.js"
import { summarizeHealth } from "../utils/systemHealth.js"
import { buildWatchQueueRows, sortRowsBySeverity, timeAgoLabel } from "./dashboardLogic.js"
import { addToBriefing } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"

const API = API_BASE
const REFRESH_MS = 60000

const SEVERITY_TIER_ORDER = ["critical", "significant", "elevated", "low"]
const SEVERITY_FLOORS = [
    { key: "critical", label: "Critical+", maxRank: 0 },
    { key: "high",     label: "High+",     maxRank: 1 },
    { key: "moderate", label: "Moderate+", maxRank: 2 },
    { key: "low",      label: "Low+",      maxRank: 3 },
]
const TIME_WINDOWS = [
    { key: "24h", label: "24h", hours: 24 },
    { key: "72h", label: "72h", hours: 72 },
    { key: "7d",  label: "7d",  hours: 24 * 7 },
    { key: "30d", label: "30d", hours: 24 * 30 },
]
const SEV_LEGEND = [
    { rank: 0, tier: "critical",    label: "Critical", cls: "critical" },
    { rank: 1, tier: "significant", label: "High",     cls: "high" },
    { rank: 2, tier: "elevated",    label: "Moderate", cls: "moderate" },
    { rank: 3, tier: "low",         label: "Low",      cls: "low" },
]
const SEV_CLASS_BY_RANK = { 0: "critical", 1: "high", 2: "moderate", 3: "low" }

function DomainRow({ group, count, on, onToggle }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
            <span className="swatch" style={{ background: "var(--cat-6)", width: 7, height: 7, transform: "rotate(45deg)", flexShrink: 0 }} />
            <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>{group.label}</span>
            <span style={{ font: "400 11px var(--mono)", color: "var(--txt-4)" }}>{count == null ? "—" : count}</span>
            <button
                onClick={onToggle}
                title={on ? "Hide layer" : "Show layer"}
                style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: on ? "var(--txt-2)" : "var(--txt-4)" }}
            >
                <svg className="icon sm"><use href={on ? "#icon-eye" : "#icon-eye-off"} /></svg>
            </button>
        </div>
    )
}

export default function Situation({ onOpenDossier }) {
    const [surfaceItems, setSurfaceItems] = useState([])
    const [fusionEvents, setFusionEvents] = useState([])
    const [health, setHealth] = useState(null)
    const [selected, setSelected] = useState(null)
    const [severityFloor, setSeverityFloor] = useState("low")
    const [timeWindow, setTimeWindow] = useState("24h")
    const [groupsOn, setGroupsOn] = useState(() => Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, true])))
    const globeApiRef = useRef(null)

    useEffect(() => {
        let cancelled = false
        const loadSurface = () => fetch(`${API}/api/surface`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d) setSurfaceItems(d.items || []) }).catch(() => {})
        const loadFusions = () => fetch(`${API}/api/fusions?status=active&limit=50`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && Array.isArray(d)) setFusionEvents(d) }).catch(() => {})
        const loadHealth = () => fetch(`${API}/api/health/detailed`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled) setHealth(d) }).catch(() => {})
        const loadAll = () => { loadSurface(); loadFusions(); loadHealth() }
        loadAll()
        const t = setInterval(loadAll, REFRESH_MS)
        return () => { cancelled = true; clearInterval(t) }
    }, [])

    const maxRank = SEVERITY_FLOORS.find((f) => f.key === severityFloor)?.maxRank ?? 3
    const windowHours = TIME_WINDOWS.find((w) => w.key === timeWindow)?.hours ?? 24
    const nowMs = Date.now()

    // The ONE real filtered/merged list every count on this screen derives
    // from — layer-row counts, legend counts, and the inspector's stat grid
    // all read from `visibleRows`, never a separately recomputed count.
    const visibleRows = useMemo(() => {
        const merged = mergeNotificationItems(surfaceItems, fusionEvents)
        const rows = sortRowsBySeverity(buildWatchQueueRows(merged))
        return rows.filter((r) => {
            if (r.severityRank > maxRank) return false
            if (!r.publishedAt) return true // no real timestamp — never assumed out of window
            const ageHours = (nowMs - new Date(r.publishedAt).getTime()) / 3600000
            return ageHours <= windowHours
        })
    }, [surfaceItems, fusionEvents, maxRank, windowHours, nowMs])

    const healthSummary = useMemo(() => summarizeHealth(health), [health])

    const legendCounts = useMemo(() => {
        const c = { 0: 0, 1: 0, 2: 0, 3: 0 }
        for (const r of visibleRows) if (r.severityRank in c) c[r.severityRank] += 1
        return c
    }, [visibleRows])

    // Real per-domain counts where the data actually supports attribution
    // (fusion events carry a real `domains` array); News/Imagery/Zones
    // groups show "—" rather than a fabricated split, since the merged
    // list doesn't carry a clean per-item domain field for plain surface
    // items today.
    const domainCounts = useMemo(() => {
        const out = {}
        for (const g of LAYER_GROUPS) out[g.key] = null
        for (const r of visibleRows) {
            const domains = r.kind === "fusion" ? (r.raw?.domains || []) : []
            if (domains.some((d) => String(d).toUpperCase() === "AIS")) out.maritime = (out.maritime || 0) + 1
            if (domains.some((d) => String(d).toUpperCase() === "ADSB")) out.air = (out.air || 0) + 1
        }
        out.news = visibleRows.filter((r) => r.kind !== "fusion").length
        out.alerts = visibleRows.length
        return out
    }, [visibleRows])

    // 12-bucket density histogram over the current window — real counts,
    // real time axis.
    const densityBuckets = useMemo(() => {
        const buckets = 12
        const bucketMs = (windowHours * 3600000) / buckets
        const counts = new Array(buckets).fill(0)
        const hot = new Array(buckets).fill(false)
        for (const r of visibleRows) {
            if (!r.publishedAt) continue
            const age = nowMs - new Date(r.publishedAt).getTime()
            const idx = buckets - 1 - Math.min(buckets - 1, Math.floor(age / bucketMs))
            if (idx >= 0 && idx < buckets) {
                counts[idx] += 1
                if (r.severityRank <= 1) hot[idx] = true
            }
        }
        return { counts, hot, max: Math.max(1, ...counts) }
    }, [visibleRows, windowHours, nowMs])

    const byRegion = useMemo(() => {
        const m = new Map()
        for (const r of visibleRows) {
            const key = r.aoi || "Unknown"
            m.set(key, (m.get(key) || 0) + 1)
        }
        return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6)
    }, [visibleRows])

    const newestCritical = useMemo(() => visibleRows.filter((r) => r.severityRank <= 1).slice(0, 5), [visibleRows])

    const handleAddToBriefing = (row) => {
        addToBriefing(row.id, row.title)
        toast(`Added "${row.title.slice(0, 40)}" to briefing basket`)
    }

    return (
        <div style={{ display: "flex", height: "100%", minHeight: 0, background: "var(--bg-0)" }}>
            {/* Left — Layers */}
            <div style={{ width: 250, flexShrink: 0, background: "var(--bg-1)", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>Layers</span>
                    <div style={{ display: "flex", gap: 8 }}>
                        <span role="button" tabIndex={0} onClick={() => setGroupsOn(Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, true])))} style={{ font: "400 11px var(--font)", color: "var(--txt-link, var(--acc-hi))", cursor: "pointer" }}>all</span>
                        <span role="button" tabIndex={0} onClick={() => setGroupsOn(Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, false])))} style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>none</span>
                    </div>
                </div>

                <div style={{ padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ padding: "2px 12px 4px", font: "600 11px var(--font)", color: "var(--txt-3)" }}>Event domains</div>
                    {LAYER_GROUPS.map((g) => (
                        <DomainRow key={g.key} group={g} count={domainCounts[g.key]} on={groupsOn[g.key]} onToggle={() => setGroupsOn((p) => ({ ...p, [g.key]: !p[g.key] }))} />
                    ))}
                </div>

                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 8 }}>Severity floor</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {SEVERITY_FLOORS.map((f) => (
                            <button key={f.key} className="chip" aria-pressed={severityFloor === f.key} onClick={() => setSeverityFloor(f.key)}>{f.label}</button>
                        ))}
                    </div>
                </div>

                <div style={{ padding: "8px 12px" }}>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 8 }}>Time window</div>
                    <div className="seg">
                        {TIME_WINDOWS.map((w) => (
                            <button key={w.key} aria-pressed={timeWindow === w.key} onClick={() => setTimeWindow(w.key)}>{w.label}</button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Center — globe + density strip */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                    <GlobeView
                        aisEnabled={groupsOn.maritime} adsbEnabled={groupsOn.air}
                        eventsEnabled={groupsOn.news} alertsEnabled={groupsOn.alerts}
                        portsEnabled={groupsOn.maritime} cablesEnabled={groupsOn.maritime} chokepointsEnabled={groupsOn.maritime}
                        airportsEnabled={groupsOn.air} satelliteEnabled={groupsOn.imagery} infraEnabled={groupsOn.imagery}
                        strategicZonesEnabled={groupsOn.zones} threatHeatmapEnabled={groupsOn.zones} cityLabelsEnabled={groupsOn.zones}
                        eezEnabled={groupsOn.zones}
                    />
                    <MapControlStack onFullscreen={() => {}} />
                    {/* Legend, bottom-right — real live counts within the current filter.
                        Sits above MapControlStack's own fixed bottom-right vertical
                        stack (5 buttons, ~200px tall) rather than overlapping it. */}
                    <div style={{
                        position: "absolute", right: 16, bottom: 212, background: "var(--bg-2)", border: "1px solid var(--line)",
                        borderRadius: "var(--r)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 5, zIndex: 30,
                    }}>
                        {SEV_LEGEND.map((s) => (
                            <div key={s.tier} className={`sev ${s.cls}`} style={{ justifyContent: "space-between", gap: 14 }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <span className={`dia ${s.cls}`} />
                                    <span style={{ color: "var(--txt-2)" }}>{s.label}</span>
                                </span>
                                <span style={{ font: "400 11px var(--mono)", color: "var(--txt-3)" }}>{legendCounts[s.rank]}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Density strip */}
                <div style={{ height: 56, flexShrink: 0, background: "var(--bg-1)", borderTop: "1px solid var(--line)", display: "flex", alignItems: "flex-end", gap: 2, padding: "6px 10px 4px" }}>
                    {densityBuckets.counts.map((c, i) => (
                        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }} title={`${c} signal${c === 1 ? "" : "s"}`}>
                            <div style={{
                                height: `${Math.max(2, (c / densityBuckets.max) * 34)}px`,
                                background: densityBuckets.hot[i] ? "var(--chart-hist-hot)" : "var(--chart-hist)",
                                borderRadius: "1px",
                            }} />
                        </div>
                    ))}
                </div>
            </div>

            {/* Right — Inspector */}
            <div style={{ width: 312, flexShrink: 0, background: "var(--bg-1)", borderLeft: "1px solid var(--line)", overflowY: "auto" }}>
                {!selected ? (
                    <div style={{ padding: 12 }}>
                        <div className="statgrid" style={{ marginBottom: 12 }}>
                            <div className="stat"><span className="value">{visibleRows.length}</span><span className="label">Signals in window</span></div>
                            <div className="stat"><span className="value">{legendCounts[0] + legendCounts[1]}</span><span className="label">Critical + high</span></div>
                            <div className="stat"><span className="value">{byRegion.length}</span><span className="label">Regions touched</span></div>
                        </div>
                        <div className="card">
                            <span className="lbl">By region</span>
                            {byRegion.length === 0 ? (
                                <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No real region data in this window.</div>
                            ) : byRegion.map(([name, count]) => (
                                <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                                    <span>{name}</span><span style={{ font: "400 11.5px var(--mono)", color: "var(--txt-3)" }}>{count}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: 12 }}>
                            <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Newest critical</div>
                            {newestCritical.length === 0 ? (
                                <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No critical or high-severity signals in this window.</div>
                            ) : newestCritical.map((r) => (
                                <div key={r.id} className="evrow" onClick={() => setSelected(r)}>
                                    <span className={`dia ${SEV_CLASS_BY_RANK[r.severityRank] || "moderate"}`} />
                                    <div>
                                        <div className="title">{r.title}</div>
                                        <div className="meta"><span>{r.aoi || "Unknown location"}</span></div>
                                    </div>
                                    <span className="time">{timeAgoLabel(r.publishedAt, nowMs)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div style={{ padding: 12 }}>
                        <span role="button" tabIndex={0} onClick={() => setSelected(null)} style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>← Back</span>
                        <div className={`sev ${SEV_CLASS_BY_RANK[selected.severityRank] || "moderate"}`} style={{ marginTop: 10 }}>
                            <span className={`dia ${SEV_CLASS_BY_RANK[selected.severityRank] || "moderate"}`} />
                            <span>{SEV_LEGEND[selected.severityRank]?.label || "Moderate"}</span>
                            <span style={{ color: "var(--txt-4)" }}>· {selected.kind === "fusion" ? "Fusion" : "Signal"}</span>
                            <span style={{ marginLeft: "auto", color: "var(--txt-4)" }}>{timeAgoLabel(selected.publishedAt, nowMs)}</span>
                        </div>
                        <div style={{ font: "600 15px var(--font)", color: "var(--txt)", margin: "8px 0" }}>{selected.title}</div>
                        <div className="card">
                            <span className="lbl">Assessment</span>
                            <div style={{ font: "400 12.5px var(--font)", color: "var(--txt-2)", lineHeight: 1.5 }}>
                                {selected.description || "No real assessment text available for this signal."}
                            </div>
                        </div>
                        <div className="card">
                            <span className="lbl">Geolocation</span>
                            <dl className="kv">
                                <dt>Place</dt><dd>{selected.aoi || "Unknown"}</dd>
                                {selected.lat != null && selected.lon != null && (
                                    <><dt>Coordinates</dt><dd style={{ fontFamily: "var(--mono)" }}>{selected.lat.toFixed(4)}, {selected.lon.toFixed(4)}</dd></>
                                )}
                                {selected.confidencePct != null && <><dt>Confidence</dt><dd><div className="conf"><span className="value">{selected.confidencePct}%</span><span className="bar"><span style={{ width: `${selected.confidencePct}%` }} /></span></div></dd></>}
                            </dl>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                            <button className="btn primary sm" onClick={() => handleAddToBriefing(selected)}>Add to briefing</button>
                            {selected.lat != null && selected.lon != null && (
                                <button className="btn sm" onClick={() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: selected.lat, lon: selected.lon, altitude: 250000 } }))}>Centre map</button>
                            )}
                            <button className="btn sm" onClick={() => onOpenDossier?.(selected)}>Open dossier</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
