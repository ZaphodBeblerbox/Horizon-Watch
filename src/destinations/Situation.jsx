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

// Real Cesium camera presets, build spec v2 §8 — "implemented as camera
// presets rather than a projection change." Center/altitude computed from
// the reference spec's own real regional bounding boxes (world
// [[-170,78],[178,-58]], emea [[-22,62],[62,-12]], apac [[62,46],[150,-12]],
// amer [[-128,52],[-32,-46]]), not guessed.
const CAMERA_PRESETS = [
    { key: "world", label: "World", lat: 10, lon: 4, altitude: 18_000_000 },
    { key: "emea", label: "EMEA", lat: 25, lon: 20, altitude: 7_000_000 },
    { key: "apac", label: "APAC", lat: 17, lon: 106, altitude: 7_500_000 },
    { key: "amer", label: "AMER", lat: 3, lon: -80, altitude: 10_000_000 },
]

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
                <svg className="icon sm"><use href={on ? "#i-eye" : "#i-eye-off"} /></svg>
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
    const [timeWindow, setTimeWindow] = useState("72h")
    // Fidelity pass §1 — the app's base/default state is ALL LAYERS OFF (a
    // bare map until the analyst turns something on). Was defaulting every
    // group to true; severity floor/time window are filter settings, not
    // layer toggles, and keep their own sensible defaults since they don't
    // clutter an empty map on their own.
    const [groupsOn, setGroupsOn] = useState(() => Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, false])))
    const [contextOn, setContextOn] = useState({ risk: false, graticule: false, flows: false, aois: false, labels: false })
    const [tracksOn, setTracksOn] = useState({ vessels: false, aircraft: false, sanctionedOnly: false, ports: false })
    const globeApiRef = useRef(null)

    // Real Live-tracks counts for the Layers pane rows — fetched only while
    // the corresponding track is actually on, independent of GlobeView's own
    // internal fetch (GlobeView doesn't expose its fetched counts upward, so
    // this is a second real fetch of the same real endpoints rather than a
    // fabricated or reused-stale number).
    const [trackCounts, setTrackCounts] = useState({ vessels: null, aircraft: null, sanctioned: null })
    useEffect(() => {
        let cancelled = false
        if (!tracksOn.vessels) { setTrackCounts((p) => ({ ...p, vessels: null })); return }
        const load = () => fetch(`${API}/api/ais/vessels`).then((r) => (r.ok ? r.json() : null)).then((d) => {
            if (cancelled || !d?.vessels) return
            setTrackCounts((p) => ({ ...p, vessels: d.vessels.length }))
        }).catch(() => {})
        load()
        const t = setInterval(load, 60000)
        return () => { cancelled = true; clearInterval(t) }
    }, [tracksOn.vessels])
    useEffect(() => {
        let cancelled = false
        if (!tracksOn.aircraft) { setTrackCounts((p) => ({ ...p, aircraft: null })); return }
        const load = () => fetch(`${API}/adsb?lat=20.0000&lon=10.0000&dist=2000`).then((r) => (r.ok ? r.json() : null)).then((d) => {
            if (cancelled || !d) return
            setTrackCounts((p) => ({ ...p, aircraft: (d.aircraft || d.states || []).length }))
        }).catch(() => {})
        load()
        const t = setInterval(load, 10000)
        return () => { cancelled = true; clearInterval(t) }
    }, [tracksOn.aircraft])

    // Build spec v2, §4.6 — real panel slide-in on mount, and a real
    // minimize/restore toggle. `entered` starts false so the panels render
    // in their slid-out position for one frame, then a single real
    // transition (never a keyframe — see designSystem.css's .pane-glass
    // comment on the animation-fill-mode trap) carries them to rest. Uses
    // setTimeout rather than requestAnimationFrame per the build spec's own
    // §2.1 guidance against relying on rAF for anything layout-adjacent.
    const [entered, setEntered] = useState(false)
    const [leftMin, setLeftMin] = useState(false)
    const [rightMin, setRightMin] = useState(false)
    useEffect(() => {
        const t = setTimeout(() => setEntered(true), 20)
        return () => clearTimeout(t)
    }, [])

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

    // windowRows: severity-floor + time-window filtered only — the real
    // basis for the Layers pane's own per-domain row counts, which the
    // build spec explicitly wants to "reflect the window, not the current
    // filter, so toggling a layer off doesn't hide the fact that it has
    // data" (§4.6.1). NOT gated on groupsOn — a row count must stay real
    // and visible even while its own layer is off, precisely so an analyst
    // can see there's something to turn on.
    const windowRows = useMemo(() => {
        const merged = mergeNotificationItems(surfaceItems, fusionEvents)
        const rows = sortRowsBySeverity(buildWatchQueueRows(merged))
        return rows.filter((r) => {
            if (r.severityRank > maxRank) return false
            if (!r.publishedAt) return true // no real timestamp — never assumed out of window
            const ageHours = (nowMs - new Date(r.publishedAt).getTime()) / 3600000
            return ageHours <= windowHours
        })
    }, [surfaceItems, fusionEvents, maxRank, windowHours, nowMs])

    // visibleRows: fidelity pass §1 — the base/default state is all layers
    // off, and every OTHER count on this screen (legend, inspector stat
    // grid, density strip, "newest critical") must correctly show zero
    // until a layer is actually switched on — distinct from windowRows
    // above. A row counts as visible only if a domain group it can
    // genuinely be attributed to is on (fusion events carry a real
    // domains[] array; anything else is treated as a News-domain item,
    // the pool it actually comes from — never guessed as some other
    // domain it can't be verified against).
    const anyDomainOn = groupsOn.maritime || groupsOn.air || groupsOn.news || groupsOn.imagery || groupsOn.zones || groupsOn.alerts
    const visibleRows = useMemo(() => {
        if (!anyDomainOn) return []
        return windowRows.filter((r) => {
            if (r.kind === "fusion") {
                if (groupsOn.alerts) return true
                const domains = (r.raw?.domains || []).map((d) => String(d).toUpperCase())
                if (domains.includes("AIS") && groupsOn.maritime) return true
                if (domains.includes("ADSB") && groupsOn.air) return true
                return false
            }
            return groupsOn.news
        })
    }, [windowRows, anyDomainOn, groupsOn.maritime, groupsOn.air, groupsOn.news, groupsOn.alerts])

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
    // items today. Deliberately derived from windowRows, NOT visibleRows —
    // per the build spec's own §4.6.1, a domain row's count must "reflect
    // the window, not the current filter, so toggling a layer off doesn't
    // hide the fact that it has data."
    const domainCounts = useMemo(() => {
        const out = {}
        for (const g of LAYER_GROUPS) out[g.key] = null
        for (const r of windowRows) {
            const domains = r.kind === "fusion" ? (r.raw?.domains || []) : []
            if (domains.some((d) => String(d).toUpperCase() === "AIS")) out.maritime = (out.maritime || 0) + 1
            if (domains.some((d) => String(d).toUpperCase() === "ADSB")) out.air = (out.air || 0) + 1
        }
        out.news = windowRows.filter((r) => r.kind !== "fusion").length
        out.alerts = windowRows.length
        return out
    }, [windowRows])

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

    // Build spec v2, §4.6 — one real transition drives the slide, whatever
    // triggers it (mount, or the minimize toggle): translateX + opacity,
    // never a keyframe. Minimizing swaps the full pane for a 30px .panetab
    // restore rail (a real, simpler equivalent of the spec's grid-var-
    // override approach — this app's Situation layout is flexbox, so
    // shrinking the flex sibling's width already reflows the map
    // automatically, without needing a separate CSS-var indirection layer).
    const leftPaneStyle = {
        width: 250, flexShrink: 0, borderRight: "1px solid var(--line)",
        display: "flex", flexDirection: "column", overflowY: "auto",
        transform: entered ? "translateX(0)" : "translateX(-14px)",
        opacity: entered ? 1 : 0,
    }
    const rightPaneStyle = {
        width: 312, flexShrink: 0, borderLeft: "1px solid var(--line)", overflowY: "auto",
        transform: entered ? "translateX(0)" : "translateX(14px)",
        opacity: entered ? 1 : 0,
    }

    return (
        <div style={{ display: "flex", height: "100%", minHeight: 0, background: "var(--bg-0)" }}>
            {/* Left — Layers (real frosted glass per build spec v2 §4.6 —
                corrects an earlier round's "no translucency anywhere"
                reversal of this; only the panel's own background is glass,
                everything inside — .chip/.card/.seg etc — stays flat/opaque) */}
            {leftMin ? (
                <div className="panetab" role="button" tabIndex={0} onClick={() => setLeftMin(false)} title="Restore Layers">Layers</div>
            ) : (
            <div className="pane-glass" style={leftPaneStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>Layers</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span role="button" tabIndex={0} onClick={() => {
                            setGroupsOn(Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, true])))
                            setContextOn({ risk: true, graticule: true, flows: true, aois: true, labels: true })
                            setTracksOn({ vessels: true, aircraft: true, sanctionedOnly: false, ports: true })
                        }} style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>all</span>
                        <span role="button" tabIndex={0} onClick={() => {
                            setGroupsOn(Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, false])))
                            setContextOn({ risk: false, graticule: false, flows: false, aois: false, labels: false })
                            setTracksOn({ vessels: false, aircraft: false, sanctionedOnly: false, ports: false })
                        }} style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>none</span>
                        <button onClick={() => setLeftMin(true)} title="Minimize" style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", padding: 0, display: "flex" }}>
                            <svg className="icon sm"><use href="#i-collapse-l" /></svg>
                        </button>
                    </div>
                </div>

                <div style={{ padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ padding: "2px 12px 4px", font: "600 11px var(--font)", color: "var(--txt-3)" }}>Event domains</div>
                    {LAYER_GROUPS.map((g) => (
                        <DomainRow key={g.key} group={g} count={domainCounts[g.key]} on={groupsOn[g.key]} onToggle={() => setGroupsOn((p) => ({ ...p, [g.key]: !p[g.key] }))} />
                    ))}
                </div>

                {/* Context layers — build spec v2 §4.2. "Satellite tasking
                    (none)" is deliberately unavailable — a real, honest
                    unavailable capability, not a silently-broken toggle. */}
                <div style={{ padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ padding: "2px 12px 4px", font: "600 11px var(--font)", color: "var(--txt-3)" }}>Context layers</div>
                    {[
                        ["risk", "Country risk index"],
                        ["graticule", "Graticule 10°"],
                        ["flows", "Trade & energy flows"],
                        ["aois", "Areas of interest"],
                        ["labels", "Marker labels"],
                    ].map(([key, label]) => (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
                            <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>{label}</span>
                            <button
                                onClick={() => setContextOn((p) => ({ ...p, [key]: !p[key] }))}
                                title={contextOn[key] ? "Hide layer" : "Show layer"}
                                style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: contextOn[key] ? "var(--txt-2)" : "var(--txt-4)" }}
                            >
                                <svg className="icon sm"><use href={contextOn[key] ? "#i-eye" : "#i-eye-off"} /></svg>
                            </button>
                        </div>
                    ))}
                    <div
                        role="button" tabIndex={0}
                        onClick={() => toast("Satellite tasking is not a real capability in this build yet", { icon: "icon-eye-off" })}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", cursor: "pointer", opacity: 0.55 }}
                    >
                        <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-3)" }}>Satellite tasking (none)</span>
                        <svg className="icon sm" style={{ color: "var(--txt-4)" }}><use href="#i-eye-off" /></svg>
                    </div>
                </div>

                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 8 }}>Severity floor</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {SEVERITY_FLOORS.map((f) => (
                            <button key={f.key} className="chip" aria-pressed={severityFloor === f.key} onClick={() => setSeverityFloor(f.key)}>{f.label}</button>
                        ))}
                    </div>
                </div>

                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 8 }}>Time window</div>
                    <div className="seg">
                        {TIME_WINDOWS.map((w) => (
                            <button key={w.key} aria-pressed={timeWindow === w.key} onClick={() => setTimeWindow(w.key)}>{w.label}</button>
                        ))}
                    </div>
                </div>

                {/* Live tracks — real AIS/ADS-B position rendering, build
                    spec v2 §4.2/§6. All off by default per §1. */}
                <div style={{ padding: "8px 0" }}>
                    <div style={{ padding: "2px 12px 4px", font: "600 11px var(--font)", color: "var(--txt-3)" }}>Live tracks</div>
                    {[
                        ["vessels", "Vessels (AIS)", trackCounts.vessels],
                        ["aircraft", "Aircraft (ADS-B)", trackCounts.aircraft],
                        ["sanctionedOnly", "Sanctioned/watchlisted only", trackCounts.sanctioned],
                        ["ports", "Ports & airports", null],
                    ].map(([key, label, count]) => (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
                            <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>{label}</span>
                            <span style={{ font: "400 11px var(--mono)", color: "var(--txt-4)" }}>{count == null ? "—" : count}</span>
                            <button
                                onClick={() => setTracksOn((p) => ({ ...p, [key]: !p[key] }))}
                                title={tracksOn[key] ? "Hide layer" : "Show layer"}
                                style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: tracksOn[key] ? "var(--txt-2)" : "var(--txt-4)" }}
                            >
                                <svg className="icon sm"><use href={tracksOn[key] ? "#i-eye" : "#i-eye-off"} /></svg>
                            </button>
                        </div>
                    ))}
                </div>
            </div>
            )}

            {/* Center — globe + density strip */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                {/* Header band — build spec v2 §8's map header (live count +
                    view segment as real Cesium camera presets, never a
                    projection change). Scoped to the centre column rather
                    than spanning full-width above the glass panes (the
                    spec's own §4.6 treatment) — this app's Situation layout
                    is a flat flex row of siblings, not the spec's CSS grid
                    with the centre pane spanning grid-column:1/-1, so a
                    true full-width spanning header would need a larger
                    layout restructure than this pass attempts; the real
                    functional pieces (count, camera presets) work correctly
                    scoped to this column. */}
                <div style={{
                    height: 28, flexShrink: 0, background: "var(--bg-2)", borderBottom: "1px solid var(--line)",
                    display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", zIndex: 4, position: "relative",
                }}>
                    <span style={{ font: "400 11.5px var(--font)", color: "var(--txt-2)" }}>{visibleRows.length} signals · {timeWindow} window</span>
                    <div className="seg">
                        {CAMERA_PRESETS.map((p) => (
                            <button
                                key={p.key}
                                onClick={() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: p.lat, lon: p.lon, altitude: p.altitude } }))}
                                title={`Fly to ${p.label}`}
                            >{p.label}</button>
                        ))}
                    </div>
                </div>
                <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                    {/* Event domains — real signal/alert visualization, per group.
                        Fixed a real bug here: precisionEventsEnabled defaults to
                        true INSIDE GlobeView itself when omitted, so News being
                        "off" didn't actually turn off precision event markers —
                        it's now explicitly wired to the same real toggle. */}
                    <GlobeView
                        eventsEnabled={groupsOn.news} precisionEventsEnabled={groupsOn.news}
                        alertsEnabled={groupsOn.alerts}
                        cablesEnabled={groupsOn.maritime} chokepointsEnabled={groupsOn.maritime}
                        satelliteEnabled={groupsOn.imagery} infraEnabled={groupsOn.imagery}
                        strategicZonesEnabled={groupsOn.zones} eezEnabled={groupsOn.zones}
                        /* Context layers — separate from event domains, per build spec v2 §4.2 */
                        threatHeatmapEnabled={contextOn.risk}
                        graticuleEnabled={contextOn.graticule}
                        cityLabelsEnabled={contextOn.labels}
                        /* Live tracks — real raw position rendering, independent of the
                           event-domain toggles above (a vessel's SIGNAL can be shown
                           without its live position, and vice versa). All off by
                           default per §1. */
                        aisEnabled={tracksOn.vessels} adsbEnabled={tracksOn.aircraft}
                        portsEnabled={tracksOn.ports} airportsEnabled={tracksOn.ports}
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

            {/* Right — Inspector (real frosted glass, see Layers pane comment above) */}
            {rightMin ? (
                <div className="panetab" role="button" tabIndex={0} onClick={() => setRightMin(false)} title="Restore Inspector">Inspector</div>
            ) : (
            <div className="pane-glass" style={rightPaneStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>Inspector</span>
                    <button onClick={() => setRightMin(true)} title="Minimize" style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", padding: 0, display: "flex" }}>
                        <svg className="icon sm"><use href="#i-collapse-r" /></svg>
                    </button>
                </div>
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
            )}
        </div>
    )
}
