/**
 * Dashboard.jsx — one of the 5 fixed top-level destinations (full UI rebuild
 * spec). Self-contained: fetches all its own real data, renders as the main
 * content region when the integrator's active destination is "dashboard".
 * Not wired into app.jsx by this file — the integrator renders it.
 *
 * Layout: two columns filling the content region (left ~66% AOI overview
 * map, right ~34% --bg-panel Watch Queue), plus a bottom stat-tile band.
 *
 * Real data sources — no fabricated numbers anywhere:
 *   - GET /api/watch-zones               → AOI boxes (WatchZone rows)
 *   - GET /api/watch-zones/{id}/analytics → per-zone real baseline comparison
 *     (vessel_activity_trend) — see dashboardLogic.js's zoneExceedsBaseline()
 *   - GET /api/surface + GET /api/fusions → merged via the SAME
 *     mergeNotificationItems() Watchlists/NotificationsDrawer already uses
 *     (src/components/notificationsNormalize.js) — no second alert-fetching
 *     mechanism invented here
 *   - GET /api/health/detailed            → summarizeHealth() (src/utils/systemHealth.js)
 *   - GET /api/reports?status=in_review   → pending AI Council reviews count
 *     (src/destinations/reportsPending.js's countPendingCouncilReviews(),
 *     shared with AICouncil.jsx so the two destinations never disagree)
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { Panel, EmptyState } from "../ui/index.js"
import Icon from "../ui/Icon.jsx"
import AoiMiniMap from "./AoiMiniMap.jsx"
import { mergeNotificationItems } from "../components/notificationsNormalize.js"
import { summarizeHealth } from "../utils/systemHealth.js"
import { countPendingCouncilReviews } from "./reportsPending.js"
import {
    buildWatchQueueRows, filterWithinHours, timeAgoLabel, zoneExceedsBaseline,
} from "./dashboardLogic.js"

const API = API_BASE
const REFRESH_MS = 60000

function StatTile({ label, value, icon }) {
    return (
        <Panel style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flex: 1 }}>
            <div style={{
                width: 32, height: 32, borderRadius: "var(--radius-sm)", background: "var(--bg-card-2)",
                display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-blue)", flexShrink: 0,
            }}>
                <Icon name={icon} size={16} />
            </div>
            <div>
                <div style={{ fontSize: "var(--text-page-title)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", lineHeight: 1.1 }}>
                    {value}
                </div>
                <div style={{ fontSize: "var(--text-callout-meta)", color: "var(--text-secondary)", marginTop: 2 }}>
                    {label}
                </div>
            </div>
        </Panel>
    )
}

function WatchQueueRow({ row }) {
    return (
        <div style={{
            display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--border)",
        }}>
            <div style={{ width: 3, flexShrink: 0, background: row.severityToken }} />
            <div style={{ flex: 1, minWidth: 0, padding: "var(--space-2) var(--space-3)" }}>
                <div style={{
                    fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)",
                    color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                    {row.title}
                </div>
                {row.description && (
                    <div style={{
                        fontSize: "var(--text-callout-meta)", color: "var(--text-secondary)", marginTop: 2,
                        overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
                        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    }}>
                        {row.description}
                    </div>
                )}
                <div style={{
                    display: "flex", gap: "var(--space-2)", marginTop: 4,
                    fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)", color: "var(--text-muted)",
                }}>
                    {row.aoi && <span>{row.aoi}</span>}
                    <span>{timeAgoLabel(row.publishedAt)}</span>
                    <span>{row.confidencePct === null ? "conf —" : `conf ${row.confidencePct}%`}</span>
                </div>
            </div>
        </div>
    )
}

export default function Dashboard() {
    const [zones, setZones]       = useState([])
    const [analytics, setAnalytics] = useState({}) // system_id -> analytics dict
    const [surfaceItems, setSurfaceItems] = useState([])
    const [fusionEvents, setFusionEvents] = useState([])
    const [health, setHealth]     = useState(null)
    const [reports, setReports]   = useState([])
    const [selectedZoneId, setSelectedZoneId] = useState(null)

    useEffect(() => {
        let cancelled = false

        const loadZones = () =>
            fetch(`${API}/api/watch-zones`)
                .then(r => r.ok ? r.json() : [])
                .then(d => {
                    if (cancelled) return
                    const list = Array.isArray(d) ? d : []
                    setZones(list)
                    // Real per-zone baseline analytics — capped fan-out, this list
                    // is operator-curated (a handful of AOIs), not user-scale data.
                    list.slice(0, 25).forEach((z) => {
                        fetch(`${API}/api/watch-zones/${z.system_id}/analytics`)
                            .then(r => r.ok ? r.json() : null)
                            .then(a => { if (!cancelled && a) setAnalytics(prev => ({ ...prev, [z.system_id]: a })) })
                            .catch(() => {})
                    })
                })
                .catch(() => {})

        const loadSurface = () =>
            fetch(`${API}/api/surface`)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (!cancelled && d) setSurfaceItems(d.items || []) })
                .catch(() => {})

        const loadFusions = () =>
            fetch(`${API}/api/fusions?status=active&limit=50`)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (!cancelled && Array.isArray(d)) setFusionEvents(d) })
                .catch(() => {})

        const loadHealth = () =>
            fetch(`${API}/api/health/detailed`)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (!cancelled) setHealth(d) })
                .catch(() => { if (!cancelled) setHealth(null) })

        const loadReports = () =>
            fetch(`${API}/api/reports?status=in_review`)
                .then(r => r.ok ? r.json() : [])
                .then(d => { if (!cancelled) setReports(Array.isArray(d) ? d : []) })
                .catch(() => {})

        const loadAll = () => { loadZones(); loadSurface(); loadFusions(); loadHealth(); loadReports() }
        loadAll()
        const t = setInterval(loadAll, REFRESH_MS)
        return () => { cancelled = true; clearInterval(t) }
    }, [])

    const watchQueueItems = useMemo(
        () => mergeNotificationItems(surfaceItems, fusionEvents),
        [surfaceItems, fusionEvents],
    )
    const watchQueueRows = useMemo(() => buildWatchQueueRows(watchQueueItems), [watchQueueItems])
    const healthSummary  = useMemo(() => summarizeHealth(health), [health])
    const pendingReviews = useMemo(() => countPendingCouncilReviews(reports), [reports])
    const hitsLast4h      = useMemo(() => filterWithinHours(watchQueueItems, 4).length, [watchQueueItems])

    const pulsingIds = useMemo(() => {
        const ids = new Set()
        for (const [systemId, a] of Object.entries(analytics)) {
            if (zoneExceedsBaseline(a)) ids.add(systemId)
        }
        return ids
    }, [analytics])

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "var(--font-sans)" }}>
            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
                {/* Left ~66% — AOI overview map */}
                <div style={{ flex: 2, minWidth: 0, borderRight: "1px solid var(--border)" }}>
                    <AoiMiniMap
                        zones={zones}
                        selectedZoneId={selectedZoneId}
                        onSelectZone={setSelectedZoneId}
                        pulsingIds={pulsingIds}
                    />
                </div>

                {/* Right ~34% — Watch Queue */}
                <div style={{
                    flex: 1, minWidth: 280, background: "var(--bg-panel)",
                    display: "flex", flexDirection: "column", minHeight: 0,
                }}>
                    <div style={{
                        padding: "var(--space-3) var(--space-3) var(--space-2)",
                        fontSize: "var(--text-section-head)", fontWeight: "var(--weight-semibold)",
                        color: "var(--text-primary)", borderBottom: "1px solid var(--border)",
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}>
                        <span>Watch Queue</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)", color: "var(--text-secondary)" }}>
                            {watchQueueRows.length}
                        </span>
                    </div>
                    <div style={{ flex: 1, overflowY: "auto" }}>
                        {watchQueueRows.length === 0 ? (
                            <EmptyState title="No active watch items" description="Nothing in the surface pool or fusion feed right now." />
                        ) : (
                            watchQueueRows.map(row => <WatchQueueRow key={row.id} row={row} />)
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom stat-tile band */}
            <div style={{
                display: "flex", gap: "var(--space-3)", padding: "var(--space-3)",
                borderTop: "1px solid var(--border)", background: "var(--bg-app)",
            }}>
                <StatTile icon="clipboard" label="Open Items" value={watchQueueRows.length} />
                <StatTile icon="warning" label="Degraded / Stale Feeds" value={healthSummary.degradedCount} />
                <StatTile icon="aiCouncil" label="Pending AI Council Reviews" value={pendingReviews} />
                <StatTile icon="bell" label="Watchlist Hits (4h)" value={hitsLast4h} />
            </div>
        </div>
    )
}
