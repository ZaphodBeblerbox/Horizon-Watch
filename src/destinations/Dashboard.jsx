/**
 * Dashboard.jsx — one of the 5 fixed top-level destinations (full UI rebuild
 * spec). Self-contained: fetches all its own real data, renders as the main
 * content region when the integrator's active destination is "dashboard".
 * Not wired into app.jsx by this file — the integrator renders it.
 *
 * Layout: two columns filling the content region (left ~66% real embedded
 * globe — GlobeView, the same real Cesium map every other destination uses,
 * not a second map implementation — right ~34% --bg-panel-translucent Watch
 * Queue), plus a bottom stat-tile band. The map can expand to fill the
 * ENTIRE content region (`fullscreen` local state) — see the prop contract
 * below.
 *
 * Prop contract (UI correction pass, Part 4):
 *   - canonicalView {"maritime"|"aerial"|"infrastructure"|"imageAnalysis"}
 *     (default "maritime") — which Canonical operational view's default
 *     layer set to use, but ONLY while the map is in `fullscreen`. The
 *     normal windowed view always uses its own separate AIS/ADS-B/events/
 *     alerts overview default, regardless of this prop.
 *   - onFullscreenChange(bool) — called every time local `fullscreen`
 *     state changes, so the caller (app.jsx / AppHeader) knows when to
 *     show/hide the Canonical-view header dropdown. Dashboard does not
 *     render that dropdown itself.
 *
 * Real data sources — no fabricated numbers anywhere. UI correction pass,
 * Part 1: the map is now the real GlobeView (see below), not the WatchZone
 * AOI-box overview AoiMiniMap.jsx used to render, so this destination no
 * longer fetches GET /api/watch-zones itself (AoiMiniMap.jsx remains the
 * real component Sources.jsx still uses for AOI-box drawing/selection):
 *   - GET /api/surface + GET /api/fusions → merged via the SAME
 *     mergeNotificationItems() Watchlists/NotificationsDrawer already uses
 *     (src/components/notificationsNormalize.js) — no second alert-fetching
 *     mechanism invented here
 *   - GET /api/health/detailed            → summarizeHealth() (src/utils/systemHealth.js)
 *   - GET /api/reports?status=in_review   → pending AI Council reviews count
 *     (src/destinations/reportsPending.js's countPendingCouncilReviews(),
 *     shared with AICouncil.jsx so the two destinations never disagree)
 *
 * The embedded map itself renders real AIS/ADS-B/news/alert entities via the
 * real GlobeView component (src/components/GlobeView.jsx) — the same
 * component the old standalone "Maritime Operational View" destination used
 * — with the real shared MapControlStack (locate/zoom/fullscreen/layers) and
 * LayersFlyout, rather than a second bespoke map+controls implementation.
 * GlobeView's own bottom-left ScaleBar/CoordinateReadout come along for free.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { Panel, EmptyState } from "../ui/index.js"
import Icon from "../ui/Icon.jsx"
import GlobeView from "../components/GlobeView.jsx"
import MapControlStack from "../components/MapControlStack.jsx"
import { LAYER_GROUPS, isLayerOn } from "../components/layerRailConfig.js"
import { mergeNotificationItems } from "../components/notificationsNormalize.js"
import { summarizeHealth } from "../utils/systemHealth.js"
import { countPendingCouncilReviews } from "./reportsPending.js"
import {
    buildWatchQueueRows, sortRowsBySeverity, filterWithinHours, timeAgoLabel,
} from "./dashboardLogic.js"

const API = API_BASE
const REFRESH_MS = 60000

// Real layer keys — see src/components/layerRailConfig.js (the ONE layer-key
// source of truth in the app; not re-derived/guessed here).
const LAYER_DEFS_BY_KEY = Object.fromEntries(LAYER_GROUPS.flatMap(g => g.layers).map(d => [d.key, d]))
function layerOn(active, key) {
    const def = LAYER_DEFS_BY_KEY[key]
    return def ? isLayerOn(active, def) : !!active?.[key]
}

// Windowed (normal, non-fullscreen) Dashboard overview default — real
// vessels/aircraft/news/alerts on, matching the Globe home screen's own
// workspace defaults (src/app.jsx's <GlobeView> mount: aisVessels/adsb off
// by default there, but this destination's whole point is "show me what's
// happening", so this destination's own separate default turns them on).
const WINDOWED_DEFAULT_LAYERS = { aisVessels: true, adsb: true, unifiedEvents: true }

// Canonical operational view defaults (UI correction pass, Part 4/5) — only
// applied while the map is in `fullscreen`, keyed by the exact real layer
// key names from layerRailConfig.js.
const CANONICAL_LAYER_DEFAULTS = {
    maritime:       { aisVessels: true, ports: true, cables: true, chokepoints: true },
    aerial:         { adsb: true, airports: true },
    infrastructure: { oim: true },
    // imageAnalysis renders a placeholder instead of a map — no layer set needed.
}

// Real fix (Parallax theming pass): this used to hardcode a JS-side copy of
// --danger/--warn/--live's real hex values (#EF4444/#F5A524/#22C55E) —
// already stale/out of sync with the real tokens (--red/--amber/--green
// are #c4453c/#b7822c/#4c7d63), and structurally unable to ever pick up
// the real light-theme values, since a hardcoded JS literal can't react to
// [data-theme] at all. Reads the REAL computed CSS custom property value
// at call time instead — genuinely theme-aware, correct in both themes,
// never a second, drifting copy of a value the token system already owns.
function tintBackground(cssVarExpr, alpha) {
    const varName = cssVarExpr.match(/--[\w-]+/)?.[0]
    if (!varName) return `rgba(0,0,0,${alpha})`
    const hex = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
    const n = parseInt(hex.replace("#", ""), 16)
    if (Number.isNaN(n)) return `rgba(0,0,0,${alpha})`
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

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

// UI correction pass, Part 6/7.2: no colored left-border stripe (deleted
// outright, not toned down); translucent card background; the one permitted
// secondary visual cue is a subtle full-card low-opacity severity tint,
// layered under the translucent background, never a border.
function WatchQueueRow({ row, onSelect }) {
    const tint = row.severityToken ? tintBackground(row.severityToken, 0.06) : null
    return (
        <div
            onClick={() => onSelect(row)}
            style={{
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-card-translucent)",
                backgroundImage: tint ? `linear-gradient(${tint}, ${tint})` : "none",
                padding: "var(--space-2) var(--space-3)",
                cursor: "pointer",
            }}
        >
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
    )
}

// UI correction pass, Part 4: imageAnalysis is a deliberately-unbuilt
// Canonical view — a clearly-labeled placeholder, not a fake functional UI.
function ImageAnalysisPlaceholder() {
    return (
        <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: "var(--space-2)",
            background: "var(--bg-app)", fontFamily: "var(--font-sans)", textAlign: "center", padding: "var(--space-4)",
        }}>
            <Icon name="layers" size={28} style={{ color: "var(--text-muted)" }} />
            <div style={{ fontSize: "var(--text-section-head)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                Image Analysis
            </div>
            <div style={{ fontSize: "var(--text-body)", color: "var(--text-muted)" }}>
                Coming soon
            </div>
        </div>
    )
}

export default function Dashboard({ canonicalView = "maritime", onFullscreenChange = null }) {
    const [surfaceItems, setSurfaceItems] = useState([])
    const [fusionEvents, setFusionEvents] = useState([])
    const [health, setHealth]     = useState(null)
    const [reports, setReports]   = useState([])

    const [fullscreen, setFullscreen] = useState(false)
    const [windowedLayers, setWindowedLayers] = useState(WINDOWED_DEFAULT_LAYERS)
    const [fullscreenLayers, setFullscreenLayers] = useState(() => CANONICAL_LAYER_DEFAULTS[canonicalView] || {})

    // Selecting an entity opens the real docked InspectorPanel (mounted by
    // this destination's own embedded GlobeView, fixed to the same
    // right-side screen region the Watch Queue panel below occupies) —
    // without this, the two stack on top of each other. GlobeView reports
    // real open/close state via a scoped callback prop (not a global
    // event: app.jsx keeps every visited destination's GlobeView mounted,
    // display:none, for fast tab switching, so a global signal would pick
    // up other hidden destinations' inspectors too). Sliding the Watch
    // Queue out of the way, rather than leaving both visible, is what lets
    // the inspector "take its place" instead of overlapping it.
    const [inspectorOpen, setInspectorOpen] = useState(false)

    // Re-seed the fullscreen layer set whenever the caller's Canonical-view
    // selection changes (the header dropdown this destination doesn't render
    // itself), so switching Canonical views always starts from that view's
    // own real defaults rather than leaking the previous view's toggles.
    useEffect(() => {
        setFullscreenLayers(CANONICAL_LAYER_DEFAULTS[canonicalView] || {})
    }, [canonicalView])

    useEffect(() => {
        let cancelled = false

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

        const loadAll = () => { loadSurface(); loadFusions(); loadHealth(); loadReports() }
        loadAll()
        const t = setInterval(loadAll, REFRESH_MS)
        return () => { cancelled = true; clearInterval(t) }
    }, [])

    const watchQueueItems = useMemo(
        () => mergeNotificationItems(surfaceItems, fusionEvents),
        [surfaceItems, fusionEvents],
    )
    // Part 6/7.2 — severity as the PRIMARY sort signal (most urgent first),
    // reusing the same real severity-tier ranking dashboardLogic.js's
    // severityRank() derives from src/app.jsx's own Watchlists comparator
    // rather than a second invented taxonomy.
    const watchQueueRows  = useMemo(() => sortRowsBySeverity(buildWatchQueueRows(watchQueueItems)), [watchQueueItems])
    const healthSummary  = useMemo(() => summarizeHealth(health), [health])
    const pendingReviews = useMemo(() => countPendingCouncilReviews(reports), [reports])
    const hitsLast4h      = useMemo(() => filterWithinHours(watchQueueItems, 4).length, [watchQueueItems])

    const activeLayers = fullscreen ? fullscreenLayers : windowedLayers
    const setLayers     = fullscreen ? setFullscreenLayers : setWindowedLayers

    const handleFullscreenToggle = () => {
        setFullscreen(prev => {
            const next = !prev
            onFullscreenChange?.(next)
            return next
        })
    }

    // Real map control stack integration — the exact same 3 dispatched
    // window events src/app.jsx's own Globe-home-screen MapControlStack
    // usage establishes (grepped there directly), not a reinvented mechanism.
    const handleLocate = () => {
        if (!navigator.geolocation) return
        navigator.geolocation.getCurrentPosition((pos) => {
            window.dispatchEvent(new CustomEvent("akili:fly-to", {
                detail: { lat: pos.coords.latitude, lon: pos.coords.longitude, altitude: 500_000 },
            }))
        }, () => {})
    }
    const handleZoomIn  = () => window.dispatchEvent(new CustomEvent("akili:zoom-in"))
    const handleZoomOut = () => window.dispatchEvent(new CustomEvent("akili:zoom-out"))

    // Clicking a Watch Queue item flies the embedded map to its real
    // lat/lon (when present — never fabricated) and opens the real docked
    // InspectorPanel via GlobePopup.jsx's akili:open-inspector event, using
    // the item's own real data — no second inspector built here.
    const handleRowSelect = (row) => {
        if (row.lat != null && row.lon != null) {
            window.dispatchEvent(new CustomEvent("akili:fly-to", {
                detail: { lat: row.lat, lon: row.lon, altitude: 300_000 },
            }))
        }
        window.dispatchEvent(new CustomEvent("akili:open-inspector", {
            detail: { entityType: row.kind, entityId: row.id, data: row.raw },
        }))
    }

    const showPlaceholder = fullscreen && canonicalView === "imageAnalysis"

    const mapRegion = (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
            {showPlaceholder ? (
                <ImageAnalysisPlaceholder />
            ) : (
                <>
                    <GlobeView
                        onInspectorOpenChange={setInspectorOpen}
                        aisEnabled={layerOn(activeLayers, "aisVessels")}
                        adsbEnabled={layerOn(activeLayers, "adsb")}
                        eventsEnabled={layerOn(activeLayers, "unifiedEvents")}
                        precisionEventsEnabled={layerOn(activeLayers, "precisionEvents")}
                        eventsMinRelevance={activeLayers?.eventsMinRelevance ?? 0}
                        portsEnabled={layerOn(activeLayers, "ports")}
                        cablesEnabled={layerOn(activeLayers, "cables")}
                        chokepointsEnabled={layerOn(activeLayers, "chokepoints")}
                        airportsEnabled={layerOn(activeLayers, "airports")}
                        infraEnabled={layerOn(activeLayers, "oim")}
                        eezEnabled={layerOn(activeLayers, "eez")}
                        cityLabelsEnabled={layerOn(activeLayers, "cityLabels")}
                        nauticalEnabled={layerOn(activeLayers, "shippingLanes")}
                        satelliteEnabled={layerOn(activeLayers, "satellite")}
                        satelliteOpacity={activeLayers?.satelliteOpacity ?? 0.9}
                        aisHeatmapEnabled={layerOn(activeLayers, "aisHeatmap")}
                        adsbHeatmapEnabled={layerOn(activeLayers, "adsbHeatmap")}
                    />
                    <MapControlStack
                        layers={{
                            active: activeLayers,
                            onToggle: (key) => setLayers(prev => ({ ...prev, [key]: !layerOn(prev, key) })),
                            onLayerSet: (key, val) => setLayers(prev => ({ ...prev, [key]: val })),
                        }}
                        onLocate={handleLocate}
                        onZoomIn={handleZoomIn}
                        onZoomOut={handleZoomOut}
                        onFullscreen={handleFullscreenToggle}
                        isFullscreen={fullscreen}
                    />
                </>
            )}
        </div>
    )

    if (fullscreen) {
        return (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "var(--font-sans)" }}>
                <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                    {mapRegion}
                </div>
            </div>
        )
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "var(--font-sans)" }}>
            <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
                {/* Left ~66% — real embedded globe overview */}
                <div style={{ flex: 2, minWidth: 0, borderRight: "1px solid var(--border)", position: "relative" }}>
                    {mapRegion}
                </div>

                {/* Right ~34% — Watch Queue (UI correction pass, Part 6/7.2:
                    translucent panel + rows, no colored border stripe).
                    Slides fully out of view (rather than stacking under it)
                    while the InspectorPanel is open in this same screen
                    region — reversed the instant the inspector closes. */}
                <div style={{
                    flex: 1, minWidth: 280, background: "var(--pane-glass-bg)",
                    display: "flex", flexDirection: "column", minHeight: 0,
                    transform: inspectorOpen ? "translateX(100%)" : "translateX(0)",
                    transition: "transform 150ms ease-out",
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
                            watchQueueRows.map(row => <WatchQueueRow key={row.id} row={row} onSelect={handleRowSelect} />)
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
