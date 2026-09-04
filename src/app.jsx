import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from "react"
import { REGION_COORDS } from "./data/regionCoords.js"
const GlobeView = lazy(() => import("./components/GlobeView.jsx"))
import IconSprite from "./ui/IconSprite.jsx"
import TopBar from "./components/TopBar.jsx"
import TabStrip from "./components/TabStrip.jsx"
import StatusBar from "./components/StatusBar.jsx"
import CommandPalette from "./components/CommandPalette.jsx"
import ToastHost from "./ui/ToastHost.jsx"
import Situation from "./destinations/Situation.jsx"
import PlaceholderModule from "./destinations/PlaceholderModule.jsx"
import { MODULES } from "./data/modules.js"

// Redesign Round 2 — real module-key <-> legacy tab-type translation. The
// underlying tab `type` strings from the old 5-destination model are left
// unchanged internally (many render blocks/handlers key off them, audited
// only far enough to confirm they still work, not rewritten wholesale) —
// this is the one small seam that lets the new 7-module TopBar reuse them
// where a real 1:1 mapping exists, rather than duplicating working
// destinations under a second type string.
const MODULE_TO_TAB_TYPE = {
    situation: "situation", inbox: "watchlists", dossiers: "dossiers",
    analytics: "analytics", generate: "reports", briefings: "reports", replay: "replay",
    ontology: "ontology", imagery: "imagery",
}
// Reverse direction is lossy ("reports" serves both generate and briefings,
// which really are the same not-yet-split ReportsPage component right now —
// see ReportsPage.jsx's own Tasks/Briefings internal toggle) — defaults to
// "generate" for TopBar highlighting purposes.
const TAB_TYPE_TO_MODULE = {
    situation: "situation", watchlists: "inbox", dossiers: "dossiers",
    analytics: "analytics", reports: "generate", replay: "replay",
    ontology: "ontology", imagery: "imagery",
}
import MapControlStack from "./components/MapControlStack.jsx"
import { DESTINATION_KEYS } from "./data/destinations.js"
import { summarizeHealth } from "./utils/systemHealth.js"
import WatchlistsPage from "./components/WatchlistsPage.jsx"
import Dashboard from "./destinations/Dashboard.jsx"
import Sources from "./destinations/Sources.jsx"
import AICouncil from "./destinations/AICouncil.jsx"
import ReportsPage from "./reports/ReportsPage.jsx"
import AlertStrip, { isFlagged } from "./components/AlertStrip.jsx"
import WorkspacesPanel from "./components/WorkspacesPanel.jsx"
import ChatPanel from "./components/ChatPanel.jsx"
import TVWidget from "./components/tvwidget.jsx"
import { loadProfile, saveProfileToStorage } from "./components/MissionProfilePanel.jsx"
import SurfaceDetailPanel from "./components/SurfaceDetailPanel.jsx"
import { playAlert, resumeAudio } from "./soundSystem.js"
import HealthPanel from "./components/HealthPanel.jsx"
import Analytics from "./destinations/Analytics.jsx"
import API_BASE from "./apiBase.js"
import LoadingScreen from "./components/LoadingScreen.jsx"
import ProfilePanel from "./components/ProfilePanel.jsx"
import { loadSettings } from "./components/PreferencesPanel.jsx"
import NewsReels from "./components/NewsReels.jsx"
import DirectorBar from "./components/DirectorBar.jsx"
import DirectorSidebar from "./components/DirectorSidebar.jsx"
import DirectorModal from "./components/DirectorModal.jsx"
import DirectorSubtitle from "./components/DirectorSubtitle.jsx"
import DirectorCountryPanel from "./components/DirectorCountryPanel.jsx"
import { CommandRunner, generateDirectorSequence, fetchDirectorSnapshot, saveDirectorSequence, submitDirectorBriefing, pollDirectorStatus } from "./services/commandRunner.js"
import { DemoRunner } from "./services/demoRunner.js"
import { DEMO_BRIEFING_HORMUZ } from "./data/demoBriefing.js"
import HeatmapTimeSlider from "./components/HeatmapTimeSlider.jsx"
import { mergeNotificationItems } from "./components/notificationsNormalize.js"
import OverwatchSidebar, { loadSavedScans, persistSavedScans, loadSavedImages, persistSavedImages } from "./components/OverwatchSidebar.jsx"
import EmergingConflictsPanel from "./components/EmergingConflictsPanel.jsx"
import NewsTicker from "./components/NewsTicker.jsx"
import WorldClocksBar from "./components/WorldClocksBar.jsx"

const API = API_BASE
const WS_STORAGE_KEY  = "akili-workspaces-v1"
// Redesign Round 2 — bumped from "akili_tabs": the old storage held tab
// `type` values from the 5-destination model ("map" as the permanent home
// tab); this round's real module rail renames that permanent tab to
// "situation" and adds "dossiers"/"replay" as real new types, so old stored
// tabs are simply superseded rather than migrated — a fresh, valid default
// is safer than reverse-engineering old localStorage shapes.
const TAB_STORAGE_KEY = "akili_tabs_v2"

function defaultTabs() {
    return [{ id: "situation", type: "situation", label: "Situation" }]
}

function loadTabsFromStorage() {
    try {
        const raw = localStorage.getItem(TAB_STORAGE_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed) && parsed.length > 0) {
                if (!parsed.find(t => t.type === "situation")) {
                    return [{ id: "situation", type: "situation", label: "Situation" }, ...parsed]
                }
                return parsed
            }
        }
    } catch { /* ignore */ }
    return defaultTabs()
}


// ── Workspace helpers ─────────────────────────────────────────────────────────

function newWorkspace(name) {
    return { id: crypto.randomUUID(), name, center: [20, 0], zoom: 2, layers: { unifiedEvents: true, forgeAlerts: true } }
}

// Ensure unifiedEvents is enabled on all existing workspaces that predate 3D-only mode.
function migrateWorkspaces(workspaces) {
    return workspaces.map(w => {
        if (w.layers?.unifiedEvents !== false) return w
        return { ...w, layers: { ...w.layers, unifiedEvents: true } }
    })
}

function loadWorkspaces() {
    try {
        const raw = localStorage.getItem(WS_STORAGE_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed) && parsed.length > 0) return migrateWorkspaces(parsed)
        }
    } catch { /* ignore */ }
    return [newWorkspace("Default")]
}

function saveWorkspacesToStorage(workspaces, activeId) {
    try {
        localStorage.setItem(WS_STORAGE_KEY, JSON.stringify(workspaces))
        localStorage.setItem(WS_STORAGE_KEY + "-active", activeId)
    } catch { /* ignore */ }
}

function loadActiveId(workspaces) {
    try {
        const saved = localStorage.getItem(WS_STORAGE_KEY + "-active")
        if (saved && workspaces.find(w => w.id === saved)) return saved
    } catch { /* ignore */ }
    return workspaces[0].id
}

// ── Right panel width ─────────────────────────────────────────────────────────
const RIGHT_PANEL_W = 300

// ── Panel style (glass) ───────────────────────────────────────────────────────
const PANEL_STYLE = {
    width:       RIGHT_PANEL_W,
    flexShrink:  0,
    height:      "100%",
    background:  "rgba(6,14,45,0.92)",
    backdropFilter: "blur(20px) saturate(1.3)",
    WebkitBackdropFilter: "blur(20px) saturate(1.3)",
    borderLeft:  "1px solid rgba(56,189,248,0.2)",
    overflowY:   "auto",
    boxSizing:   "border-box",
    fontFamily:  "system-ui, -apple-system, sans-serif",
    transition:  "opacity 150ms ease",
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
    const [loading,      setLoading]      = useState(true)
    const [showTV,       setShowTV]       = useState(false)
    const [overwatchActive,     setOverwatchActive]     = useState(false)
    const [overwatchDrawActive, setOverwatchDrawActive] = useState(false)
    // Overwatch panel state (managed here, fed to OverwatchSidebar)
    const [owMode,       setOwMode]       = useState("idle")    // idle|drawing|analyzing|results
    const [owDetections, setOwDetections] = useState([])
    const [owStats,      setOwStats]      = useState(null)
    const [owEnhance,    setOwEnhance]    = useState(false)
    const [owMinConf,    setOwMinConf]    = useState(0.15)
    const [owSavedScans,  setOwSavedScans]  = useState(() => loadSavedScans())
    const [owSavedImages, setOwSavedImages] = useState(() => loadSavedImages())
    const [owAnalysis,   setOwAnalysis]   = useState(null)
    const [owAnalyzing,  setOwAnalyzing]  = useState(false)
    const [owBounds,     setOwBounds]     = useState(null)
    const [owSentinelOverlay,  setOwSentinelOverlay]  = useState(null)  // {image_b64, bounds}
    const [owSentinelLoading,  setOwSentinelLoading]  = useState(false) // kept for legacy compat
    const [overwatchDrawMode,  setOverwatchDrawMode]  = useState("rectangle")
    const [owPolygon,          setOwPolygon]          = useState(null)

    // ── Director Mode ──────────────────────────────────────────────────────────
    const [directorVisible,        setDirectorVisible]        = useState(false)
    const [directorSequence,       setDirectorSequence]       = useState(null)
    const [directorLayerOverrides, setDirectorLayerOverrides] = useState({})
    const [directorHighlights,     setDirectorHighlights]     = useState([])
    // Real override for GlobeView's satelliteEnabled prop while a Director
    // scene has show_satellite/analyse_satellite active — null means "use the
    // workspace's own layer toggle" (see satelliteEnabled prop below).
    const [directorSatelliteOverride, setDirectorSatelliteOverride] = useState(null)
    const [directorRunnerState,    setDirectorRunnerState]    = useState({ isPlaying: false, currentIndex: -1, total: 0 })
    const [directorCurrentAction,  setDirectorCurrentAction]  = useState(null)
    const [directorIndicators,     setDirectorIndicators]     = useState([])
    const [directorContextCards,   setDirectorContextCards]   = useState([])
    const [directorGenerating,     setDirectorGenerating]     = useState(false)
    const [directorSavedStatus,    setDirectorSavedStatus]    = useState(null)
    const [directorModalOpen,      setDirectorModalOpen]      = useState(false)
    const [directorError,          setDirectorError]          = useState(null)
    const [directorCountryPanel,   setDirectorCountryPanel]   = useState(null)  // country name for news panel
    // Background job polling
    const [pendingJobId,       setPendingJobId]       = useState(null)
    const [pendingJobIntent,   setPendingJobIntent]   = useState("")
    const [briefingProgress,   setBriefingProgress]   = useState("")
    const [briefingElapsed,    setBriefingElapsed]    = useState(0)
    const [readyBriefing,      setReadyBriefing]       = useState(() => {
        // Restore pending briefing from localStorage (survives page refresh, < 2h old)
        try {
            const saved = localStorage.getItem("hw_ready_briefing")
            if (saved) {
                const parsed = JSON.parse(saved)
                if (parsed && Date.now() - (parsed._saved_at || 0) < 7_200_000) return parsed
                localStorage.removeItem("hw_ready_briefing")
            }
        } catch {}
        return null
    })  // { result, intent }
    const pollIntervalRef = useRef(null)
    const elapsedTimerRef = useRef(null)
    // Granular director items — what's individually visible on the map
    const _emptyDirectorItems = () => ({
        chokepoints:          new Set(),
        events:               new Set(),
        infrastructure:       new Map(),
        vessels:              new Set(),
        aircraft:             new Set(),
        satellite:            false,
        detailPanel:          null,
        highlightedCountries: new Map(),  // name → { context, label }
        placedEvents:         new Map(),  // title → { title, lat, lon, type, severity, source, summary }
        placedLocations:      new Map(),  // name → { name, lat, lon, type, description }
    })
    const [directorItems, setDirectorItems] = useState(_emptyDirectorItems)
    // directorSegments: ordered history of all narrate/summary actions played so far
    const [directorSegments, setDirectorSegments] = useState([])
    // directorImage: current image to show in sidebar {url, caption, attribution, loading}
    const [directorImage, setDirectorImage] = useState(null)
    const mapInstanceRef = useRef(null)
    const directorRunnerRef = useRef(null)
    const demoRunnerRef = useRef(null)
    const directorLayerSnapshotRef = useRef(null)
    const directorIntentRef = useRef("")
    const [directorDemoChoices,   setDirectorDemoChoices]   = useState([])
    const [directorDemoCallouts,  setDirectorDemoCallouts]  = useState([])
    const [directorDemoChart,     setDirectorDemoChart]     = useState(null)
    const [directorDemoScanPrompt, setDirectorDemoScanPrompt] = useState(null)
    // Current Director/Demo scene — passed to GlobeDirectorLayer for 3D rendering
    const [directorScene, setDirectorScene] = useState(null)
    const [directorScanProgress,  setDirectorScanProgress]  = useState(null)
    const [isMobile,     setIsMobile]     = useState(() => typeof window !== "undefined" && window.innerWidth < 768)
    const [showReels, setShowReels] = useState(false)
    const [showAutoMode, setShowAutoMode] = useState(false)
    const [heatmapHours, setHeatmapHours] = useState(24)
    const [overwatchDetections, setOverwatchDetections] = useState([])

    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", handler)
        return () => window.removeEventListener("resize", handler)
    }, [])

    // ── Mission profile ───────────────────────────────────────────────────────
    const [profile, setProfile] = useState(() => loadProfile())
    const [focusRegions, setFocusRegions] = useState(() => loadProfile()?.focusRegions || [])
    const initialProfilePanRef = useRef(false)

    useEffect(() => {
        if (profile) return
        fetch(`${API}/profile/load`)
            .then(r => r.json())
            .then(d => {
                if (d.profile) {
                    saveProfileToStorage(d.profile)
                    setProfile(d.profile)
                    setFocusRegions(d.profile.focusRegions || [])
                }
            })
            .catch(() => {})
    }, [])   // eslint-disable-line react-hooks/exhaustive-deps

    const fetchSurfaceRef = useRef(null)
    const surfaceRetryRef = useRef(null)
    const surfaceRefreshKickRef = useRef(0)

    const handleProfileSave = useCallback((p) => {
        const oldRegions = profile?.focusRegions || []
        saveProfileToStorage(p)
        setProfile(p)
        fetch(`${API}/profile/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p),
        })
        .then(r => r.json())
        .then(d => {
            if (d.items) {
                setSurfaceItems(d.items)
                setSurfaceUpdatedAt(d.updated_at || null)
            }
        })
        .catch(() => { setTimeout(() => fetchSurfaceRef.current?.(), 400) })
        // Pan to first newly-added focus region
        const added = (p.focusRegions || []).find(r => !oldRegions.includes(r) && REGION_COORDS[r])
        if (added && REGION_COORDS[added]) {
            const { lat, lon, zoom } = REGION_COORDS[added]
            setSearchTarget({ lat, lon, zoom, key: Date.now() })
        }
    }, [profile])

    // ── Tab system ────────────────────────────────────────────────────────────
    const [tabs, setTabs] = useState(() => loadTabsFromStorage())
    const [activeTabId, setActiveTabId] = useState(() => {
        const saved = loadTabsFromStorage()
        try {
            const s = localStorage.getItem(TAB_STORAGE_KEY + "-active")
            if (s && saved.find(t => t.id === s)) return s
        } catch { /* ignore */ }
        return saved[0]?.id || "situation"
    })
    const tabHistoryRef = useRef([])

    // Derived — used throughout instead of `page`
    const activeTab     = tabs.find(t => t.id === activeTabId) || tabs[0]
    const activeTabType = activeTab?.type || "situation"

    // Full UI rebuild: which of the 5 fixed destinations (if any) is active —
    // null when on the Globe/Maritime home screen ("map") or a real
    // non-destination tab ("analytics"), since neither is one of the 5.
    const activeDestination = DESTINATION_KEYS.includes(activeTabType) ? activeTabType : null
    const MODE_LABELS = {
        map: "MARITIME OPERATIONAL VIEW",
        dashboard: "DASHBOARD",
        reports: "REPORTS",
        watchlists: "WATCHLISTS",
        sources: "INTEL", // UI correction pass Part 11.1: destination renamed "Intel" in nav; this mode-strip label follows
        aiCouncil: "AI COUNCIL",
        analytics: "ANALYTICS",
    }
    const modeLabel = MODE_LABELS[activeTabType] || activeTabType.toUpperCase()

    // ── Navigation ────────────────────────────────────────────────────────────
    const [searchTarget, setSearchTarget] = useState(null)

    // UI correction pass, Part 6 — Dashboard's fullscreen map + Canonical
    // operational-view switcher. Lifted here (not owned by Dashboard.jsx
    // itself) since the Canonical dropdown lives in the persistent header,
    // a sibling component Dashboard has no direct access to.
    const [dashboardFullscreen, setDashboardFullscreen] = useState(false)
    const [canonicalView, setCanonicalView] = useState("maritime")

    // ── Right panel slot — mutually exclusive ─────────────────────────────────
    // null | "layers" | "detail" | "profile" | "settings" | "health" | "workspaces" | "situations" | "chat" | "alerts"
    const [rightPanel, setRightPanel] = useState(null)

    const openRightPanel = useCallback((id) => {
        setRightPanel(prev => prev === id ? null : id)
    }, [])

    // ── Surface pool / notifications ──────────────────────────────────────────
    const [surfaceItems,     setSurfaceItems]     = useState([])
    const [surfaceUpdatedAt, setSurfaceUpdatedAt] = useState(null)
    const [selectedSurface,  setSelectedSurface]  = useState(null)
    const [readIds,          setReadIds]          = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem("akili-notif-read-v1") || "[]")) }
        catch { return new Set() }
    })
    // Real correlation-engine hits, merged into the same alert log as the
    // surface-pool items above (see NotificationsDrawer's kind:"fusion" row).
    const [fusionEvents, setFusionEvents] = useState([])
    useEffect(() => {
        if (!profile) return
        let cancelled = false
        const load = () => fetch(`${API}/api/fusions?status=active&limit=50`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled && Array.isArray(d)) setFusionEvents(d) })
            .catch(() => {})
        load()
        const t = setInterval(load, 60000)
        return () => { cancelled = true; clearInterval(t) }
    }, [profile])
    const notifItems = useMemo(
        () => mergeNotificationItems(surfaceItems, fusionEvents),
        [surfaceItems, fusionEvents]
    )
    const unreadCount = notifItems.filter(i => !readIds.has(i.id)).length

    const handleMarkRead = useCallback((id) => {
        setReadIds(prev => {
            const next = new Set(prev)
            next.add(id)
            try { localStorage.setItem("akili-notif-read-v1", JSON.stringify([...next])) } catch {}
            return next
        })
    }, [])

    // Watchlists destination's entity chips only expose a real, concrete
    // (entityType, entityId) pair when one is genuinely derivable (see
    // WatchlistsPage.jsx) — reuses the same akili:show-entity deep-link
    // GlobePopup.jsx already listens for (entityStore lookup), same 2-event
    // "open the map, then show the entity" pattern NewsPage.jsx's own
    // onOpenInspector already establishes.
    const handleWatchlistSelectEntity = (entityType, entityId) => {
        openTab("situation")
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent("akili:show-entity", { detail: { entityType, entityId } }))
        }, 50)
    }

    // ── Header/footer real system status pill (full UI rebuild spec 3.1/3.2) ──
    const [healthData, setHealthData] = useState(null)
    useEffect(() => {
        let cancelled = false
        const load = () => fetch(`${API}/api/health/detailed`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled) setHealthData(d) })
            .catch(() => { if (!cancelled) setHealthData(null) })
        load()
        const t = setInterval(load, 60000)
        return () => { cancelled = true; clearInterval(t) }
    }, [])
    const systemHealth = useMemo(() => summarizeHealth(healthData), [healthData])

    // Redesign Round 2 — StatusBar's real task/queue count.
    const [taskCount, setTaskCount] = useState(null)
    useEffect(() => {
        let cancelled = false
        const load = () => fetch(`${API}/api/reports/tasks`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled && Array.isArray(d)) setTaskCount(d.length) })
            .catch(() => {})
        load()
        const t = setInterval(load, 60000)
        return () => { cancelled = true; clearInterval(t) }
    }, [])

    // Redesign Round 2 — command palette open state (the global ⌘K/1-7
    // keyboard handler lives further down, after openTab is declared).
    const [paletteOpen, setPaletteOpen] = useState(false)

    useEffect(() => {
        if (!profile) return
        let cancelled = false

        const clearRetry = () => {
            if (surfaceRetryRef.current) {
                clearTimeout(surfaceRetryRef.current)
                surfaceRetryRef.current = null
            }
        }

        const fetchSurface = () => {
            const started = performance.now()
            fetch(`${API}/api/surface`)
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (!d || cancelled) return
                    console.info("[surface/fetch]", {
                        ms: Math.round(performance.now() - started),
                        count: (d.items || []).length,
                        diagnostics: d.diagnostics || null,
                    })
                    setSurfaceItems(d.items || [])
                    setSurfaceUpdatedAt(d.updated_at || null)

                    clearRetry()
                    if ((d.items || []).length > 0) return

                    if (Date.now() - surfaceRefreshKickRef.current > 30000) {
                        surfaceRefreshKickRef.current = Date.now()
                        fetch(`${API}/api/surface/refresh`, { method: "POST" }).catch(() => {})
                    }

                    surfaceRetryRef.current = setTimeout(() => {
                        fetchSurfaceRef.current?.()
                    }, 15000)
                })
                .catch(() => {})
        }
        fetchSurfaceRef.current = fetchSurface
        fetchSurface()
        const t = setInterval(fetchSurface, 120000)
        return () => {
            cancelled = true
            clearInterval(t)
            clearRetry()
        }
    }, [profile])   // eslint-disable-line react-hooks/exhaustive-deps

    const [surfaceContext, setSurfaceContext] = useState(null)
    const [surfaceEnrichment, setSurfaceEnrichment] = useState(null)

    const handleSurfaceItemClick = useCallback((item) => {
        setSelectedSurface(item)
        setRightPanel("detail")
        setSurfaceContext(null)
        setSurfaceEnrichment(null)
    }, [])

    // Called by SurfaceDetailPanel when context loads (airports) or location clicked
    const handleContextUpdate = useCallback((ctx) => {
        setSurfaceContext(ctx)
        if (ctx?.panTo) {
            setSearchTarget({
                lat:   ctx.panTo.lat,
                lon:   ctx.panTo.lon,
                zoom:  9,
                label: ctx.panTo.label,
                key:   Date.now(),
            })
        }
    }, [])

    const handleEnrichmentUpdate = useCallback((payload) => {
        setSurfaceEnrichment(payload)
    }, [])

    const contextualLayers = useMemo(() => {
        if (!selectedSurface) return null
        const t = selectedSurface.type || selectedSurface.infrastructure_type || ""
        const layers = {}
        if (t === "aviation")  { layers.airports = true }
        if (t === "maritime")  { layers.ports = true; layers.eez = true; layers.chokepoints = true }
        if (t === "energy")    { layers.powerPlants = true; layers.pipelines = true }
        if (t === "missile")   { layers.airports = true }
        if (t === "armed_clash" || t === "explosion" || selectedSurface.source_type === "conflict_zone") { layers.borders = true; layers.hospitals = true }
        if (Object.keys(layers).length === 0) return null
        return { layers }
    }, [selectedSurface])

    // ── Daily briefing ────────────────────────────────────────────────────────
    // Persist readyBriefing to localStorage whenever it changes
    useEffect(() => {
        if (!readyBriefing) return
        try {
            localStorage.setItem("hw_ready_briefing", JSON.stringify({ ...readyBriefing, _saved_at: Date.now() }))
        } catch {}
    }, [readyBriefing])

    // FIX 4: On mount, if readyBriefing is still null (nothing in localStorage), check
    // the server for a recently auto-saved Director result so it survives page refresh.
    useEffect(() => {
        if (readyBriefing) return  // already have one — skip
        fetch(`${API}/api/briefing/latest`)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (!d?.briefing?.result) return
                const entry = d.briefing
                const age = Date.now() - new Date(entry.generated_at || entry.created_at || 0).getTime()
                if (age > 7_200_000) return  // older than 2h — don't restore
                setReadyBriefing({ result: entry.result, intent: entry.title || "Briefing" })
            })
            .catch(() => {})
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // ── App settings (from PreferencesPanel) ─────────────────────────────────
    const [appSettings, setAppSettings] = useState(loadSettings)
    const settingsRef = useRef(appSettings)
    useEffect(() => { settingsRef.current = appSettings }, [appSettings])

    // Re-sync whenever PreferencesPanel saves to localStorage
    useEffect(() => {
        const h = () => setAppSettings(loadSettings())
        window.addEventListener("akili:settings-changed", h)
        return () => window.removeEventListener("akili:settings-changed", h)
    }, [])

    // ── Real-time alert sound cues (UI correction pass: toast popups removed
    // entirely — alerts surface exclusively via the header bell badge and the
    // Watchlists console now; this effect keeps the real audio-cue behavior,
    // which is a distinct "Sound" toggle, not a toast) ────────────────────────
    const alertSinceRef = useRef(new Date().toISOString())
    const seenAlertIdsRef = useRef(new Set())

    // Derived from unified settings (fixes dual-key conflict with old "akili-sound-muted")
    const soundMuted = appSettings.soundMuted

    const onToggleSound = useCallback(() => {
        setAppSettings(prev => {
            const next = { ...prev, soundMuted: !prev.soundMuted }
            try { localStorage.setItem("akili-settings-v1", JSON.stringify(next)) } catch {}
            window.dispatchEvent(new CustomEvent("akili:settings-changed"))
            return next
        })
    }, [])

    useEffect(() => {
        if (!profile) return
        const poll = () => {
            const s = settingsRef.current
            const since = alertSinceRef.current
            fetch(`${API}/api/alerts/new?since=${encodeURIComponent(since)}`)
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (!d?.alerts?.length) return
                    alertSinceRef.current = new Date().toISOString()
                    const incoming = d.alerts.filter(a => a.priority !== false)
                    if (!incoming.length) return
                    const fresh = incoming.filter(a => !seenAlertIdsRef.current.has(a.id))
                    fresh.forEach(a => seenAlertIdsRef.current.add(a.id))
                    if (fresh.length && !s.soundMuted) {
                        const top = fresh.reduce((a, b) =>
                            (["critical","significant","elevated","low"].indexOf(a.severity_tier) <=
                             ["critical","significant","elevated","low"].indexOf(b.severity_tier)) ? a : b
                        )
                        // Per-tier sound gate
                        const tier = top.severity_tier
                        const shouldPlay =
                            (tier === "critical"    && s.soundCritical)    ||
                            (tier === "significant" && s.soundSignificant) ||
                            (tier === "elevated"    && s.soundElevated)    ||
                            (tier === "low")
                        if (shouldPlay) {
                            resumeAudio()
                            playAlert(tier, top.type)
                        }
                    }
                    // Also surface unread notification count
                    setReadIds(prev => prev)   // trigger recompute
                })
                .catch(() => {})
        }
        const intervalMs = (settingsRef.current.alertInterval || 15) * 1000
        const tid = setInterval(poll, intervalMs)
        return () => clearInterval(tid)
    }, [profile, appSettings.alertInterval])  // eslint-disable-line react-hooks/exhaustive-deps

    // UI correction pass: the raw-DOM "anomaly" toast that used to live here
    // (System 6, /api/alerts/recent polling every 2 minutes) is removed
    // entirely — no exceptions, per the explicit ground rule. That endpoint's
    // real alerts already surface through the header bell badge and the
    // Watchlists console via the existing /api/alerts/new poll above.


    const [mapViewport, setMapViewport] = useState(null)

    // ── Workspace state ───────────────────────────────────────────────────────
    const [workspaces,        setWorkspaces]        = useState(() => loadWorkspaces())
    const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => {
        const ws = loadWorkspaces()
        return loadActiveId(ws)
    })
    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0]

    useEffect(() => {
        if (!profile || initialProfilePanRef.current) return
        const firstRegion = (profile.focusRegions || []).find(r => REGION_COORDS[r])
        if (!firstRegion) return
        // Pan only if the workspace is at a default starting position, not a
        // user-chosen one. Checks both the current default [20, 0] zoom≤3 and
        // the old Tanzania default [-6.5, 35] that may be in saved workspaces.
        const c = activeWorkspace?.center
        const z = activeWorkspace?.zoom ?? 2
        const isGlobalDefault   = !c || (Math.abs((c[0] ?? 0) - 20) < 0.5 && Math.abs((c[1] ?? 0) - 0) < 0.5 && z <= 3)
        const isTanzaniaDefault = Array.isArray(c) && Math.abs((c[0] ?? 0) - (-6.5)) < 0.5 && Math.abs((c[1] ?? 0) - 35) < 0.5
        const isDefaultWorkspaceView = isGlobalDefault || isTanzaniaDefault
        if (!isDefaultWorkspaceView) {
            initialProfilePanRef.current = true
            return
        }
        const { lat, lon, zoom } = REGION_COORDS[firstRegion]
        setSearchTarget({ lat, lon, zoom, key: Date.now() })
        initialProfilePanRef.current = true
    }, [profile, activeWorkspace])

    const handleWorkspaceSwitch = useCallback((id) => {
        setActiveWorkspaceId(id)
        const ws = workspaces.find(w => w.id === id)
        if (ws?.center) {
            setSearchTarget({ lat: ws.center[0], lon: ws.center[1], zoom: ws.zoom || 6, key: Date.now() })
        }
        saveWorkspacesToStorage(workspaces, id)
        if (rightPanel === "workspaces") setRightPanel(null)
    }, [workspaces, rightPanel])

    const handleCreateWorkspace = useCallback((name) => {
        const ws = newWorkspace(name)
        const next = [...workspaces, ws]
        setWorkspaces(next)
        setActiveWorkspaceId(ws.id)
        saveWorkspacesToStorage(next, ws.id)
    }, [workspaces])

    const handleDeleteWorkspace = useCallback((id) => {
        const next = workspaces.filter(w => w.id !== id)
        if (next.length === 0) return
        const nextActive = activeWorkspaceId === id ? next[0].id : activeWorkspaceId
        setWorkspaces(next)
        setActiveWorkspaceId(nextActive)
        saveWorkspacesToStorage(next, nextActive)
    }, [workspaces, activeWorkspaceId])

    const handleViewportChange = useCallback((center, zoom, bounds) => {
        if (bounds) {
            setMapViewport({ center, zoom, bounds })
        }
        setWorkspaces(prev => {
            const next = prev.map(w =>
                w.id === activeWorkspaceId ? { ...w, center, zoom } : w
            )
            saveWorkspacesToStorage(next, activeWorkspaceId)
            return next
        })
    }, [activeWorkspaceId])

    const handleLayersChange = useCallback((layers) => {
        setWorkspaces(prev => {
            const next = prev.map(w =>
                w.id === activeWorkspaceId ? { ...w, layers } : w
            )
            saveWorkspacesToStorage(next, activeWorkspaceId)
            return next
        })
    }, [activeWorkspaceId])

    // ── Tab management ────────────────────────────────────────────────────────
    const switchTab = useCallback((id) => {
        setActiveTabId(prev => {
            if (prev === id) return prev
            tabHistoryRef.current = [...tabHistoryRef.current, prev]
            return id
        })
    }, [])

    const openTab = useCallback((type) => {
        // Redesign Round 2 — real tab types for the new 7-module rail
        // (data/modules.js) plus the pre-existing "dashboard"/"sources"/
        // "aiCouncil" types, which are no longer reachable from the new
        // TopBar's module rail (the new module list has no equivalent slot
        // for them — see the redesign prompt's own module mapping) but are
        // left as real, working dead-reachable-only-by-code tab types rather
        // than deleted, since deleting real working destinations wasn't
        // asked for. "situation" replaces "map" as the permanent home tab
        // type; "dossiers"/"replay" are genuinely new placeholder-content
        // types (real modules, no real screen behind them yet — Round 3/4).
        const LABELS = {
            situation: "Situation", inbox: "Inbox", dossiers: "Dossiers",
            analytics: "Analytics", generate: "Generate", briefings: "Briefings", replay: "Replay",
            ontology: "Ontology", imagery: "Imagery",
            map: "Map", dashboard: "Dashboard", reports: "Reports", watchlists: "Watchlists",
            sources: "Intel", aiCouncil: "AI Council",
        }
        const existing = tabs.find(t => t.type === type)
        if (existing) { switchTab(existing.id); return }
        const newId = crypto.randomUUID()
        setTabs(prev => {
            if (prev.find(t => t.type === type)) return prev
            return [...prev, { id: newId, type, label: LABELS[type] || type }]
        })
        switchTab(newId)
    }, [tabs, switchTab])

    // Redesign Round 2, §6 — global ⌘K/Ctrl+K (palette) and 1-7 (module
    // switch) shortcuts, guarded against active text input so typing is
    // never interrupted. Declared here (after openTab) rather than earlier
    // near paletteOpen's own state, since openTab is a `const` — referencing
    // it in an effect declared before its own initializer is a real
    // temporal-dead-zone crash, not just a style preference.
    useEffect(() => {
        const handler = (e) => {
            const inTextInput = e.target?.matches?.("input,textarea,[contenteditable]")
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault()
                setPaletteOpen(v => !v)
                return
            }
            if (e.key === "Escape" && paletteOpen) { setPaletteOpen(false); return }
            if (inTextInput) return
            const n = Number(e.key)
            if (n >= 1 && n <= 9 && MODULES[n - 1]) {
                openTab(MODULE_TO_TAB_TYPE[MODULES[n - 1].key])
            }
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [paletteOpen, openTab])

    // Real, destination-neutral navigation event (see
    // src/globe/GlobeStrategicZoneTooltip.jsx's "Manage in Sources" action) —
    // replaces the old akili:open-forge/akili:forge-nav pair now that Forge
    // is no longer a primary-nav destination.
    useEffect(() => {
        const h = (e) => { if (e.detail?.destination) openTab(e.detail.destination) }
        window.addEventListener("akili:navigate", h)
        return () => window.removeEventListener("akili:navigate", h)
    }, [openTab])

    // Reverse direction — real deep links from non-map destinations (e.g.
    // NewsPage's "jump to location", Watchlists' entity chips) need the map
    // tab open before the akili:fly-to / akili:show-entity events they fire
    // right after this can find a mounted GlobeView to act on.
    useEffect(() => {
        const h = () => openTab("situation")
        window.addEventListener("akili:open-map", h)
        return () => window.removeEventListener("akili:open-map", h)
    }, [openTab])

    const closeTab = useCallback((id) => {
        const tab = tabs.find(t => t.id === id)
        // Any tab, including "situation", can now be closed — closing the
        // last remaining tab reopens Situation (below) rather than refusing
        // to close a specific hardcoded tab.
        if (!tab) return
        let remaining = tabs.filter(t => t.id !== id)
        // The console is never empty — closing the last tab reopens Situation
        // as a genuinely fresh tab, not a dangling reference to one that no
        // longer exists.
        if (remaining.length === 0) {
            remaining = [{ id: "situation", type: "situation", label: "Situation" }]
        }
        setTabs(remaining)
        if (activeTabId === id) {
            let target = remaining[remaining.length - 1].id
            const hist = tabHistoryRef.current
            for (let i = hist.length - 1; i >= 0; i--) {
                if (remaining.find(t => t.id === hist[i])) {
                    target = hist[i]
                    tabHistoryRef.current = hist.slice(0, i)
                    break
                }
            }
            setActiveTabId(target)
        }
        tabHistoryRef.current = tabHistoryRef.current.filter(x => x !== id)
    }, [tabs, activeTabId])

    // Redesign Round 2, §3 — real contextual tab retitling (e.g. opening a
    // specific Dossier or generated report retitles its own tab, distinct
    // from the module's own display name). No consumer wires a specific
    // Dossier/report into this yet this round (Dossiers/Generate/Briefings
    // aren't rebuilt until Rounds 3/4), but the real mechanism exists now
    // rather than being faked later.
    const retitleTab = useCallback((id, label) => {
        setTabs(prev => prev.map(t => (t.id === id ? { ...t, label } : t)))
    }, [])

    // Persist tabs to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tabs))
            localStorage.setItem(TAB_STORAGE_KEY + "-active", activeTabId)
        } catch { /* ignore */ }
    }, [tabs, activeTabId])

    // ── Situations (state kept for ChatPanel context; no panel UI) ──────────
    const [situations,        setSituations]        = useState([])
    const [activeSituationId, setActiveSituationId] = useState(null)
    const activeSituation = situations.find(s => s.id === activeSituationId) || null

    // ── Director Mode handlers ────────────────────────────────────────────────

    const handleDirectorOpen = useCallback(() => {
        setDirectorVisible(true)
        setDirectorCurrentAction(null)
        setDirectorIndicators([])
        setDirectorSavedStatus(null)
    }, [])

    const handleDirectorClose = useCallback(() => {
        if (directorRunnerRef.current) { directorRunnerRef.current.stop(); directorRunnerRef.current = null }
        if (demoRunnerRef.current)     { demoRunnerRef.current.stop();     demoRunnerRef.current = null }
        // Cancel any pending poll
        if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null }
        if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null }
        setPendingJobId(null)
        setPendingJobIntent("")
        setBriefingProgress("")
        setBriefingElapsed(0)
        setDirectorVisible(false)
        setDirectorSequence(null)
        setDirectorLayerOverrides({})
        setDirectorHighlights([])
        setDirectorCurrentAction(null)
        setDirectorIndicators([])
        setDirectorContextCards([])
        setDirectorItems(_emptyDirectorItems())
        setDirectorSegments([])
        setDirectorImage(null)
        setDirectorRunnerState({ isPlaying: false, currentIndex: -1, total: 0 })
        setDirectorModalOpen(false)
        setDirectorError(null)
        setDirectorCountryPanel(null)
        setDirectorDemoChoices([])
        setDirectorDemoCallouts([])
        setDirectorDemoChart(null)
        setDirectorDemoScanPrompt(null)
        setDirectorScene(null)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Overwatch draw callbacks ───────────────────────────────────────────────
    const handleOverwatchBounds = useCallback((bounds) => {
        setOwBounds(bounds)
        setOwPolygon(null)
    }, [])

    const handleOverwatchPolygon = useCallback(({ vertices, bounds }) => {
        setOwBounds(bounds)
        setOwPolygon({ vertices, bounds })
    }, [])

    // ── Fire-and-forget scan record save ─────────────────────────────────────
    const _saveScanRecord = useCallback((payload) => {
        const tok = localStorage.getItem("hw-auth-token")
        const headers = { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
        fetch(`${API}/api/overwatch/scans`, { method: "POST", headers, body: JSON.stringify(payload) })
            .catch(e => console.warn("[Overwatch] scan record save failed:", e))
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Overwatch scan: called from sidebar ───────────────────────────────────
    const handleOverwatchScan = useCallback(async ({ bounds: scanBounds, confidence, enhance }) => {
        const bounds = scanBounds || owBounds
        if (!bounds) return
        setOwMode("analyzing")
        try {
            const tok = localStorage.getItem("hw-auth-token")
            const headers = { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
            const res = await fetch(`${API}/api/overwatch/detect`, {
                method: "POST", headers,
                body: JSON.stringify({ bounds, zoom: 15, confidence, enhance }),
            })
            if (res.ok) {
                const data = await res.json()
                const dets = data.detections || []
                setOwDetections(dets)
                setOverwatchDetections(dets)
                const catCounts = {}
                for (const d of dets) {
                    const cat = d.category || d.class || "Object"
                    catCounts[cat] = (catCounts[cat] || 0) + 1
                }
                const avgConf = dets.length ? dets.reduce((s, d) => s + (d.confidence || 0), 0) / dets.length : null
                setOwStats({ total: dets.length, byCategory: catCounts })
                setOwMode("results")
                _saveScanRecord({ bounds, total: dets.length, by_category: catCounts, avg_confidence: avgConf, imagery_source: "ESRI" })
            } else {
                setOwMode("idle")
            }
        } catch (e) {
            console.error("[Overwatch]", e)
            setOwMode("idle")
        }
    }, [owBounds, _saveScanRecord]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Sentinel overlay loaded from sidebar ──────────────────────────────────
    const handleSentinelLoaded = useCallback(({ image_b64, bounds }) => {
        setOwSentinelOverlay({ image_b64, bounds })
    }, [])

    // ── Sentinel ML scan: called from sidebar after overlay loaded ────────────
    const handleSentinelScan = useCallback(async ({ confidence, enhance, sentinelType }) => {
        if (!owSentinelOverlay || !owBounds) return
        setOwMode("analyzing")
        try {
            const tok = localStorage.getItem("hw-auth-token")
            const headers = { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
            const res = await fetch(`${API}/api/overwatch/detect-image`, {
                method: "POST", headers,
                body: JSON.stringify({ image: owSentinelOverlay.image_b64, bounds: owBounds, confidence, enhance }),
            })
            if (res.ok) {
                const data = await res.json()
                const dets = data.detections || []
                setOwDetections(dets)
                setOverwatchDetections(dets)
                const catCounts = {}
                for (const d of dets) { const cat = d.category || d.class || "Object"; catCounts[cat] = (catCounts[cat] || 0) + 1 }
                const avgConf = dets.length ? dets.reduce((s, d) => s + (d.confidence || 0), 0) / dets.length : null
                setOwStats({ total: dets.length, byCategory: catCounts, zoom: "Sentinel-2" })
                setOwMode("results")
                _saveScanRecord({ bounds: owBounds, total: dets.length, by_category: catCounts, avg_confidence: avgConf, imagery_source: "Sentinel-2", imagery_type: sentinelType })
            } else { setOwMode("idle") }
        } catch (e) { console.error("[Sentinel ML]", e); setOwMode("idle") }
    }, [owSentinelOverlay, owBounds, _saveScanRecord]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Post-process CommandRunner scenes: auto-enrich with hotspots + country highlights ──
    const _postProcessSequence = useCallback(async (scenes) => {
        if (!scenes?.length) return
        // Load country list once for auto-enrichment
        let countryNames = []
        try {
            const r = await fetch(`${API}/geo/countries`)
            if (r.ok) {
                const geo = await r.json()
                countryNames = (geo.features || []).map(f =>
                    f.properties?.NAME || f.properties?.name || f.properties?.ADMIN || ""
                ).filter(Boolean)
            }
        } catch (_) {}

        for (const scene of scenes) {
            const visuals = scene.visuals || []

            // Auto-enrich: if no pulse_hotspot after fly_to, add one
            const ft = visuals.find(v => v.action === "fly_to")
            const hasHotspot = visuals.some(v => v.action === "pulse_hotspot" || v.action === "place_event" || v.action === "place_location")
            if (ft && !hasHotspot) {
                scene.visuals = [
                    ...visuals.slice(0, visuals.indexOf(ft) + 1),
                    { action: "pulse_hotspot", lat: ft.lat, lon: ft.lon, color: "#38bdf8", radius: 12_000, _auto: true },
                    ...visuals.slice(visuals.indexOf(ft) + 1),
                ]
            }

            // Auto-enrich: if narration mentions a country not yet highlighted, add highlight
            const narAction = scene.narration
            const narText   = narAction?.text || ""
            const highlighted = new Set(visuals.filter(v => v.action === "highlight_country").map(v => (v.name || "").toLowerCase()))
            if (narText && countryNames.length) {
                for (const name of countryNames) {
                    if (
                        !highlighted.has(name.toLowerCase()) &&
                        narText.includes(name)
                    ) {
                        scene.visuals = [
                            { action: "highlight_country", name, context: "focus", _auto: true },
                            ...scene.visuals,
                        ]
                        highlighted.add(name.toLowerCase())
                    }
                }
            }
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Start playback from a ready sequence ────────────────────────────────
    const _startDirectorPlayback = useCallback(async (sequence, intent) => {
        handleDirectorClose()
        directorIntentRef.current = intent || ""
        setDirectorSavedStatus(null)
        setDirectorSegments([])
        setDirectorImage(null)
        setDirectorSequence(sequence)
        setDirectorVisible(true)
        if (directorRunnerRef.current) directorRunnerRef.current.destroy()
        // Show "Preparing briefing visuals…" while post-processing
        setBriefingProgress("Preparing briefing visuals…")
        const runner = new CommandRunner({
            mapRef:            mapInstanceRef,
            setDirectorItems,
            setLayerOverrides: setDirectorLayerOverrides,
            setHighlights:     setDirectorHighlights,
            onAction:   (action, idx) => {
                if (action.action === "narrate" || action.action === "summary") {
                    // Update current display and segment history together — image already set via onImage
                    setDirectorCurrentAction(action)
                    setDirectorSegments(prev => [...prev, { action, segIdx: idx, image: action._image || null }])
                } else {
                    // Visual actions: clear image but don't overwrite current narrate text
                    setDirectorImage(null)
                }
            },
            onIndicator:  (action) => setDirectorIndicators(prev => [...prev, action]),
            onContextCard:(action) => setDirectorContextCards(prev => [...prev, action]),
            onStateChange:(state)  => setDirectorRunnerState(state),
            onDetailPanel:(panel)  => setDirectorItems(prev => ({ ...prev, detailPanel: panel })),
            onImage:      (img)    => setDirectorImage(img),
            onOpenDetail: (type, id) => {
                if (type === "country") { setDirectorCountryPanel(id); return }
                const item = surfaceItems.find(s =>
                    s.id === id || s.url === id || s.mmsi === id || s.icao24 === id || s.name === id
                ) || surfaceItems.find(s =>
                    String(s.id || "").includes(id) || String(s.mmsi || "") === String(id) ||
                    (s.headline || s.title || "").toLowerCase().includes((id || "").toLowerCase())
                )
                if (item) { setSelectedSurface(item); setRightPanel("detail"); setSurfaceContext(null); setSurfaceEnrichment(null) }
            },
            onCloseDetail: () => { setRightPanel(null); setSelectedSurface(null); setSurfaceContext(null); setSurfaceEnrichment(null) },
            onComplete: () => {},
            onScene:    (scene) => {
                setDirectorScene(scene)
                if (!scene) setDirectorSatelliteOverride(null)  // director stopped — drop the override
            },
            onSatelliteToggle: (on) => setDirectorSatelliteOverride(on),
        })
        runner.load(sequence)
        // Post-process scenes (auto-enrichment, hotspot injection) then start playback
        _postProcessSequence(runner._scenes).then(() => {
            setBriefingProgress("")
            directorRunnerRef.current = runner
            runner.play()
        })
    }, [surfaceItems, _postProcessSequence]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleDirectorGenerate = useCallback(async (intent) => {
        directorIntentRef.current = intent || ""
        setDirectorError(null)
        setDirectorGenerating(true)
        // Keep modal open — it shows its loading screen while the submit fires
        directorLayerSnapshotRef.current = { ...directorLayerOverrides }
        try {
            const { job_id } = await submitDirectorBriefing(intent)
            // Submit succeeded — close modal and show background badge together
            setDirectorModalOpen(false)
            setDirectorGenerating(false)
            setPendingJobId(job_id)
            setPendingJobIntent(intent)
            setBriefingProgress("Generating…")
            setBriefingElapsed(0)
            if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
            elapsedTimerRef.current = setInterval(() => setBriefingElapsed(e => e + 1), 1000)
            // Poll for completion
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = setInterval(async () => {
                try {
                    const status = await pollDirectorStatus(job_id)
                    if (status.progress) setBriefingProgress(status.progress)
                    if (status.status === "complete") {
                        clearInterval(pollIntervalRef.current); pollIntervalRef.current = null
                        clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null
                        setPendingJobId(null)
                        setPendingJobIntent("")
                        setBriefingProgress("")
                        setBriefingElapsed(0)
                        setReadyBriefing({ result: status.result, intent })
                    } else if (status.status === "error") {
                        clearInterval(pollIntervalRef.current); pollIntervalRef.current = null
                        clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null
                        setPendingJobId(null)
                        setPendingJobIntent("")
                        setBriefingProgress("")
                        setBriefingElapsed(0)
                        setDirectorError(status.error || "Briefing generation failed")
                    }
                } catch (e) { console.error("[Director] poll error:", e) }
            }, 3000)
        } catch (err) {
            console.error("[Director] generate failed:", err)
            setDirectorGenerating(false)
            setDirectorError(err.message || "Director generation failed")
        }
    }, [directorLayerOverrides, _startDirectorPlayback]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleDirectorLoadTest = useCallback(async () => {
        setDirectorError(null)
        setDirectorGenerating(true)
        setDirectorCurrentAction(null)
        setDirectorIndicators([])
        setDirectorContextCards([])
        setDirectorItems(_emptyDirectorItems())
        setDirectorSegments([])
        setDirectorImage(null)
        setDirectorSavedStatus(null)
        setDirectorModalOpen(false)
        try {
            const res = await fetch(`${API}/api/director/test-briefing`)
            if (!res.ok) throw new Error(`test-briefing: ${res.status}`)
            const sequence = await res.json()
            _startDirectorPlayback(sequence, "test")
        } catch (err) {
            console.error("[Director] test briefing load failed:", err)
            setDirectorError(err.message || "Failed to load test briefing")
        } finally {
            setDirectorGenerating(false)
        }
    }, [_startDirectorPlayback]) // eslint-disable-line react-hooks/exhaustive-deps

    // Ctrl+Shift+T → load director test briefing
    useEffect(() => {
        const handler = (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === "T") {
                e.preventDefault()
                handleDirectorLoadTest()
            }
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [handleDirectorLoadTest])

    const handleDirectorLoadDemo = useCallback(() => {
        // Stop any existing runner
        if (directorRunnerRef.current) { directorRunnerRef.current.destroy(); directorRunnerRef.current = null }
        if (demoRunnerRef.current)     { demoRunnerRef.current.destroy();     demoRunnerRef.current = null }

        setDirectorModalOpen(false)
        setDirectorError(null)
        setDirectorCurrentAction(null)
        setDirectorIndicators([])
        setDirectorContextCards([])
        setDirectorItems(_emptyDirectorItems())
        setDirectorSegments([])
        setDirectorImage(null)
        setDirectorSavedStatus(null)
        setDirectorDemoChoices([])
        setDirectorDemoCallouts([])
        setDirectorVisible(true)
        setDirectorSequence({ actions: [] })  // placeholder so DirectorBar renders

        const runner = new DemoRunner({
            mapRef:      mapInstanceRef,
            onNarrate:   (action) => {
                setDirectorCurrentAction(action)
                setDirectorSegments(prev => [...prev, { action, segIdx: prev.length, image: null }])
            },
            onStateChange:       (state) => setDirectorRunnerState(state),
            onInteractiveChoice: (choices) => setDirectorDemoChoices(choices),
            onComplete:          () => {
                setDirectorRunnerState({ isPlaying: false, currentIndex: -1, total: 0 })
                setDirectorDemoChoices([])
                setDirectorDemoCallouts([])
                setDirectorDemoScanPrompt(null)
                setDirectorScanProgress(null)
            },
            onImage:    (img) => {
                setDirectorImage(img)
                if (img?.url) {
                    setDirectorSegments(prev => {
                        if (!prev.length) return prev
                        const last = { ...prev[prev.length - 1], image: img }
                        return [...prev.slice(0, -1), last]
                    })
                }
            },
            onCallouts:    (callouts) => setDirectorDemoCallouts(callouts),
            onChart:       (chart)    => setDirectorDemoChart(chart),
            onScanPrompt:  (cb)       => setDirectorDemoScanPrompt(() => cb),
            onScanProgress:(p)        => setDirectorScanProgress(p),
            onScene:       (scene)    => setDirectorScene(scene),
            onClearScene: () => {
                setDirectorDemoCallouts([])
                setDirectorImage(null)
                setDirectorDemoChart(null)
                setDirectorDemoScanPrompt(null)
                setDirectorScanProgress(null)
            },
        })
        runner.load(DEMO_BRIEFING_HORMUZ)
        demoRunnerRef.current    = runner
        directorRunnerRef.current = runner   // expose to DirectorBar pause/play buttons
        runner.play()
    }, [_emptyDirectorItems]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleDemoChoice = useCallback((sceneId) => {
        demoRunnerRef.current?.resolveChoice(sceneId)
    }, [])

    const handleDirectorSave = useCallback(async () => {
        if (!directorSequence) return
        setDirectorSavedStatus("saving")
        try {
            // Build plain-text transcript from narrate/summary segments played so far
            const transcript = directorSegments
                .map(seg => {
                    const a = seg.action
                    if (a.action === "summary") {
                        return (a.sections || []).map(s => [s.heading, s.text].filter(Boolean).join("\n")).join("\n\n")
                    }
                    return [a.heading || a.title, a.text].filter(Boolean).join("\n")
                })
                .join("\n\n---\n\n")
            await saveDirectorSequence(directorSequence, {
                transcript,
                intent: directorIntentRef.current,
            })
            setDirectorSavedStatus("saved")
        } catch (err) {
            console.error("[Director] save failed:", err)
            setDirectorSavedStatus("error")
        }
    }, [directorSequence, directorSegments])

    // ── Render ────────────────────────────────────────────────────────────────

    const panelStyle = isMobile ? {
        position:    "fixed",
        top:         0,
        left:        0,
        right:       0,
        bottom:      56,
        zIndex:      1500,
        background:  "rgba(6,14,45,0.95)",
        backdropFilter: "blur(20px) saturate(1.3)",
        WebkitBackdropFilter: "blur(20px) saturate(1.3)",
        overflowY:   "auto",
        boxSizing:   "border-box",
        fontFamily:  "system-ui, -apple-system, sans-serif",
    } : PANEL_STYLE

    return (
        <div style={{
            position:      "fixed",
            inset:         0,
            background:    "#050c1c",
            display:       "flex",
            flexDirection: "column",
            overflow:      "hidden",
            fontFamily:    "system-ui, -apple-system, sans-serif",
        }}>
        <IconSprite />
        <style>{`
          @keyframes db-spin { to { transform: rotate(360deg); } }
          @keyframes dir-panel-slide-in {
            from { transform: translateX(100%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
          }
          .director-detail-panel-enter {
            animation: dir-panel-slide-in 400ms ease-out forwards;
          }
          .demo-runner-tooltip {
            background: rgba(8,15,35,0.88) !important;
            border: 1px solid rgba(56,139,255,0.25) !important;
            color: rgba(200,220,255,0.9) !important;
            font-size: 11px !important;
            font-weight: 600 !important;
            letter-spacing: 0.04em !important;
            padding: 3px 8px !important;
            border-radius: 5px !important;
            white-space: nowrap !important;
            backdrop-filter: blur(8px) !important;
          }
          .demo-runner-tooltip::before { display: none !important; }
          .demo-runner-rich-tooltip {
            background: rgba(8,15,35,0.92) !important;
            border: 1px solid rgba(56,139,255,0.3) !important;
            border-radius: 7px !important;
            padding: 0 !important;
            overflow: hidden !important;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5) !important;
            backdrop-filter: blur(12px) !important;
            min-width: 130px !important;
            max-width: 160px !important;
          }
          .demo-runner-rich-tooltip::before { display: none !important; }
          .demo-runner-rich-tooltip img { display: block !important; }
        `}</style>
            {loading && <LoadingScreen onComplete={() => setLoading(false)} />}
            {/* ── Top bar + tab strip — redesign Round 2, §1/§2/§3 ───────────── */}
            {!showAutoMode && (
                <>
                    <TopBar
                        activeModule={TAB_TYPE_TO_MODULE[activeTabType] || "situation"}
                        onSelectModule={(key) => openTab(MODULE_TO_TAB_TYPE[key] || key)}
                        unreadCount={unreadCount}
                        systemHealth={systemHealth}
                        onOpenPalette={() => setPaletteOpen(true)}
                    />
                    <TabStrip
                        tabs={tabs}
                        activeTabId={activeTabId}
                        onSelect={switchTab}
                        onClose={closeTab}
                        onOpenPalette={() => setPaletteOpen(true)}
                        liveFeedCount={Array.isArray(healthData?.data_sources) ? healthData.data_sources.filter(s => s.status === "ok").length : null}
                    />
                </>
            )}
            <ToastHost />
            <CommandPalette
                open={paletteOpen}
                onClose={() => setPaletteOpen(false)}
                signals={notifItems}
                onOpenModule={(key) => openTab(MODULE_TO_TAB_TYPE[key] || key)}
                onOpenEntity={(r) => {
                    openTab("situation")
                    if (r.lat != null && r.lon != null) setSearchTarget({ lat: r.lat, lon: r.lon, zoom: 7, key: Date.now() })
                }}
                onOpenSignal={(s) => {
                    openTab("situation")
                    if (s.lat != null && s.lon != null) {
                        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: s.lat, lon: s.lon, altitude: 250000 } }))
                    }
                }}
                onOpenReport={() => openTab("reports")}
            />

            {/* ── Body — flex row, fills remaining height ───────────────────── */}
            <div style={{ flex: 1, display: "flex", minHeight: 0, paddingBottom: (isMobile && !showAutoMode) ? 56 : 0 }}>

                {/* ── Full-screen panels — all mounted while tab exists, hidden via display:none ── */}

                {/* Map — exclusive: only one renderer alive at a time. UI
                    correction pass, Part 9: the layers control is now the
                    shared translucent LayersFlyout, folded into
                    MapControlStack below — the old always-docked 240px rail
                    is deleted entirely. */}
                <div style={{ display: activeTabType === "map" ? "flex" : "none", flex: 1, minWidth: 0, height: "100%" }}>
                    <div style={{ flex: 1, minWidth: 0, height: "100%", position: "relative", paddingTop: showAutoMode ? 36 : 0, paddingBottom: showAutoMode ? 32 : 0 }}>
                    <Suspense fallback={
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: "#050c1c", color: "rgba(148,163,184,0.7)", fontFamily: "system-ui", fontSize: 14 }}>
                            Loading 3D Globe…
                        </div>
                    }>
                        <GlobeView
                            center={activeWorkspace?.center || [20, 10]}
                            zoom={activeWorkspace?.zoom || 3}
                            infraEnabled={activeWorkspace?.layers?.oim ?? false}
                            nauticalEnabled={activeWorkspace?.layers?.shippingLanes ?? false}
                            adsbEnabled={activeWorkspace?.layers?.adsb ?? false}
                            aisEnabled={activeWorkspace?.layers?.aisVessels ?? false}
                            eezEnabled={activeWorkspace?.layers?.eez ?? false}
                            cityLabelsEnabled={activeWorkspace?.layers?.cityLabels ?? false}
                            cablesEnabled={activeWorkspace?.layers?.cables ?? false}
                            chokepointsEnabled={activeWorkspace?.layers?.chokepoints ?? false}
                            strategicZonesEnabled={activeWorkspace?.layers?.showStrategicZones ?? false}
                            eventsEnabled={activeWorkspace?.layers?.unifiedEvents ?? true}
                            precisionEventsEnabled={activeWorkspace?.layers?.precisionEvents ?? true}
                            eventsMinRelevance={activeWorkspace?.layers?.eventsMinRelevance ?? 0}
                            alertsEnabled={activeWorkspace?.layers?.forgeAlerts ?? true}
                            threatHeatmapEnabled={activeWorkspace?.layers?.threatHeatmap ?? true}
                            airportsEnabled={activeWorkspace?.layers?.airports ?? false}
                            portsEnabled={activeWorkspace?.layers?.ports ?? false}
                            aisHeatmapEnabled={activeWorkspace?.layers?.aisHeatmap ?? false}
                            adsbHeatmapEnabled={activeWorkspace?.layers?.adsbHeatmap ?? false}
                            heatmapHours={heatmapHours}
                            overwatchEnabled={overwatchActive}
                            overwatchDetections={overwatchDetections}
                            overwatchDrawActive={overwatchActive}
                            overwatchDrawMode={overwatchDrawMode}
                            onOverwatchBounds={handleOverwatchBounds}
                            onOverwatchPolygon={handleOverwatchPolygon}
                            overwatchSentinelOverlay={owSentinelOverlay}
                            satelliteEnabled={directorSatelliteOverride ?? (activeWorkspace?.layers?.satellite ?? false)}
                            satelliteOpacity={activeWorkspace?.layers?.satelliteOpacity ?? 0.9}
                            cctvEnabled={activeWorkspace?.layers?.cctvFeeds ?? false}
                            directorScene={directorScene}
                            autoModeEnabled={showAutoMode}
                            isVisible={activeTabType === "map"}
                        />
                    </Suspense>
                    <MapControlStack
                        layers={{
                            active: activeWorkspace?.layers ?? {},
                            onToggle: (key) => handleLayersChange({
                                ...(activeWorkspace?.layers ?? {}),
                                [key]: !(activeWorkspace?.layers?.[key] ?? (key === "unifiedEvents" ? true : false)),
                            }),
                            onLayerSet: (key, val) => handleLayersChange({
                                ...(activeWorkspace?.layers ?? {}),
                                [key]: val,
                            }),
                            autoModeEnabled: showAutoMode,
                            onAutoMode: (v) => {
                                setShowAutoMode(v)
                                if (v) setRightPanel(null)
                            },
                            onExportView: () => {
                                const canvas = document.querySelector("#cesiumContainer canvas") || document.querySelector("canvas")
                                if (!canvas) return
                                const a = document.createElement("a")
                                a.href = canvas.toDataURL("image/png")
                                a.download = `horizon-watch-view-${Date.now()}.png`
                                document.body.appendChild(a)
                                a.click()
                                a.remove()
                            },
                        }}
                        onLocate={() => {
                            if (!navigator.geolocation) return
                            navigator.geolocation.getCurrentPosition((pos) => {
                                window.dispatchEvent(new CustomEvent("akili:fly-to", {
                                    detail: { lat: pos.coords.latitude, lon: pos.coords.longitude, altitude: 500_000 },
                                }))
                            }, () => {})
                        }}
                        onZoomIn={() => window.dispatchEvent(new CustomEvent("akili:zoom-in"))}
                        onZoomOut={() => window.dispatchEvent(new CustomEvent("akili:zoom-out"))}
                        onFullscreen={() => {
                            if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
                            else document.documentElement.requestFullscreen().catch(() => {})
                        }}
                    />
                    {(activeWorkspace?.layers?.aisHeatmap || activeWorkspace?.layers?.adsbHeatmap) && (
                        <HeatmapTimeSlider
                            hours={heatmapHours}
                            onHoursChange={setHeatmapHours}
                            isMobile={isMobile}
                        />
                    )}
                    <DirectorSidebar
                        visible={directorVisible}
                        currentAction={directorCurrentAction}
                        segments={directorSegments}
                        indicators={directorIndicators}
                        contextCards={directorContextCards}
                        currentImage={directorImage}
                        generating={directorGenerating}
                        runnerState={directorRunnerState}
                        onGenerate={handleDirectorGenerate}
                        demoChoices={directorDemoChoices}
                        onDemoChoice={handleDemoChoice}
                        demoChart={directorDemoChart}
                    />
                    {directorVisible && directorCountryPanel && (
                        <DirectorCountryPanel
                            country={directorCountryPanel}
                            onClose={() => setDirectorCountryPanel(null)}
                        />
                    )}
                    <DirectorBar
                        visible={directorVisible}
                        sequence={directorSequence}
                        runner={directorRunnerRef.current}
                        runnerState={directorRunnerState}
                        currentAction={directorCurrentAction}
                        indicators={directorIndicators}
                        contextCards={directorContextCards}
                        generating={directorGenerating}
                        onGenerate={handleDirectorGenerate}
                        onSave={handleDirectorSave}
                        onClose={handleDirectorClose}
                        savedStatus={directorSavedStatus}
                        controlsOnly={true}
                    />
                    <DirectorSubtitle
                        visible={directorVisible}
                        sequence={directorSequence}
                        runner={directorRunnerRef.current}
                        runnerState={directorRunnerState}
                        currentAction={directorCurrentAction}
                        indicators={directorIndicators}
                        onSave={handleDirectorSave}
                        onClose={handleDirectorClose}
                        savedStatus={directorSavedStatus}
                    />
                    </div>
                </div>

                {/* TV overlay */}
                {showTV && (
                    <TVWidget onClose={() => setShowTV(false)} />
                )}

                {/* Full UI rebuild — the 5 fixed destinations (src/data/destinations.js).
                    "briefing" (BriefingPanel.jsx — a real, older "Claude
                    Briefings" document library, distinct from the ReportTask/
                    Report system below), "news" (NewsPage.jsx) and "forge"
                    (ForgePanel.jsx) are deliberately not replaced 1:1 here —
                    the new spec's 5 destinations don't include an equivalent
                    for any of them (News is a map-layer group only per
                    section 5; Reports below is the ReportTask/Report system,
                    not Claude Briefings; Sources absorbs only Forge's real
                    Watch-Area/Detection-Rule CRUD). Their source files are
                    untouched and still real — just no longer mounted here,
                    since nothing in the new nav model can open a "briefing"/
                    "news"/"forge" tab anymore. Flagged explicitly in this
                    round's PR notes as a deliberate scope decision, not an
                    oversight. */}
                {/* Situation — redesign Round 2's new home screen, replacing
                    Dashboard.jsx as the default view. Dashboard.jsx itself
                    is left in place below (unreached from the new module
                    rail — see MODULE_TO_TAB_TYPE) rather than deleted, since
                    it isn't one of the header/nav/footer/bell components
                    this round's ground rule calls out for deletion, and no
                    later round has explicitly claimed it yet. */}
                {tabs.some(t => t.type === "situation") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "situation" ? "flex" : "none", flexDirection: "column" }}>
                        <Situation onOpenDossier={() => openTab("dossiers")} />
                    </div>
                )}

                {tabs.some(t => t.type === "dashboard") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "dashboard" ? "flex" : "none", flexDirection: "column" }}>
                        <Dashboard canonicalView={canonicalView} onFullscreenChange={setDashboardFullscreen} />
                    </div>
                )}

                {tabs.some(t => t.type === "dossiers") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "dossiers" ? "flex" : "none", flexDirection: "column" }}>
                        <PlaceholderModule label="Dossiers" roundNote="it's a genuinely new module built in Round 3" />
                    </div>
                )}

                {tabs.some(t => t.type === "replay") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "replay" ? "flex" : "none", flexDirection: "column" }}>
                        <PlaceholderModule label="Replay" roundNote="Director Mode is rebuilt into this module in Stage 7" />
                    </div>
                )}

                {tabs.some(t => t.type === "ontology") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "ontology" ? "flex" : "none", flexDirection: "column" }}>
                        <PlaceholderModule label="Ontology" roundNote="it's a genuinely new module built in Stage 8" />
                    </div>
                )}

                {tabs.some(t => t.type === "imagery") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "imagery" ? "flex" : "none", flexDirection: "column" }}>
                        <PlaceholderModule label="Imagery" roundNote="it's a genuinely new module built in Stage 9, mapping onto the real Sentinel/Overwatch pipeline" />
                    </div>
                )}

                {tabs.some(t => t.type === "reports") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "reports" ? "flex" : "none", flexDirection: "column" }}>
                        <ReportsPage />
                    </div>
                )}

                {tabs.some(t => t.type === "watchlists") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "watchlists" ? "flex" : "none", flexDirection: "column" }}>
                        <WatchlistsPage
                            items={notifItems}
                            readIds={readIds}
                            onMarkRead={handleMarkRead}
                            onSelectEntity={handleWatchlistSelectEntity}
                        />
                    </div>
                )}

                {tabs.some(t => t.type === "sources") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "sources" ? "flex" : "none", flexDirection: "column" }}>
                        <Sources />
                    </div>
                )}

                {tabs.some(t => t.type === "aiCouncil") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "aiCouncil" ? "flex" : "none", flexDirection: "column" }}>
                        <AICouncil onOpenReport={(reportId) => openTab("reports")} />
                    </div>
                )}

                {/* Analytics — full-width tab, the one module with no side
                    panes at all per the Exact Replication Manual. */}
                {tabs.some(t => t.type === "analytics") && (
                    <div style={{
                        flex: 1, minWidth: 0, height: "100%", overflow: "hidden",
                        display: activeTabType === "analytics" ? "flex" : "none",
                        flexDirection: "column",
                    }}>
                        <Analytics />
                    </div>
                )}

                {/* ── Right panel slot — 300px, only one at a time ──────────── */}
                {rightPanel === "detail" && selectedSurface && (
                    <SurfaceDetailPanel
                        item={selectedSurface}
                        profile={profile}
                        onClose={() => {
                            setRightPanel(null)
                            setSelectedSurface(null)
                            setSurfaceContext(null)
                            setSurfaceEnrichment(null)
                        }}
                        panelStyle={directorVisible
                            ? { ...panelStyle, animation: "dir-panel-slide-in 400ms ease-out forwards" }
                            : panelStyle
                        }
                        onContextUpdate={handleContextUpdate}
                        onEnrichmentUpdate={handleEnrichmentUpdate}
                    />
                )}

                {rightPanel === "profile" && profile && (
                    <div style={panelStyle}>
                        <ProfilePanel
                            profile={profile}
                            onSave={handleProfileSave}
                            onClose={() => setRightPanel(null)}
                        />
                    </div>
                )}

                {/* UI correction pass, Part 13: the Settings/Preferences window is
                    removed for now (acknowledged as not worth keeping in its
                    current form — will be rebuilt properly later). The header
                    gear icon stays present but shows a real, clear "coming
                    soon" flyout instead of silently doing nothing — see
                    AppHeader.jsx. */}

                {rightPanel === "health" && (
                    <div style={panelStyle}>
                        <HealthPanel onClose={() => setRightPanel(null)} />
                    </div>
                )}

                {rightPanel === "threats" && (
                    <EmergingConflictsPanel onClose={() => setRightPanel(null)} />
                )}

                {rightPanel === "workspaces" && (
                    <div style={panelStyle}>
                        <WorkspacesPanel
                            workspaces={workspaces}
                            activeWorkspaceId={activeWorkspaceId}
                            onSwitch={handleWorkspaceSwitch}
                            onCreate={handleCreateWorkspace}
                            onDelete={handleDeleteWorkspace}
                            onClose={() => setRightPanel(null)}
                        />
                    </div>
                )}

                {rightPanel === "chat" && (
                    <div style={panelStyle}>
                        <ChatPanel
                            activeSituation={activeSituation}
                            onClose={() => setRightPanel(null)}
                        />
                    </div>
                )}

            </div>

            {/* Director Mode modal — portal-level, covers full screen */}
            <DirectorModal
                open={directorModalOpen}
                onClose={() => setDirectorModalOpen(false)}
                onGenerate={handleDirectorGenerate}
                onLoadTest={handleDirectorLoadTest}
                onLoadDemo={handleDirectorLoadDemo}
                generating={directorGenerating}
                error={directorError}
            />

            {/* Demo data callout overlays */}
            {directorVisible && directorDemoCallouts.length > 0 && (
                <>
                    {directorDemoCallouts.map((callout, i) => {
                        const posStyles = {
                            "bottom-right":  { bottom: 180, right: 20 },
                            "top-right":     { top: 80,     right: 20 },
                            "bottom-center": { bottom: 180, left: "50%", transform: "translateX(-50%)" },
                            "top-center":    { top: 80,     left: "50%", transform: "translateX(-50%)" },
                        }
                        const pos = posStyles[callout.position] || posStyles["bottom-right"]
                        return (
                            <div key={i} style={{
                                position: "fixed",
                                ...pos,
                                zIndex: 8200,
                                background: "rgba(8,15,35,0.82)",
                                backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                                border: `1px solid ${callout.color ? callout.color + "55" : "rgba(56,139,255,0.25)"}`,
                                borderRadius: 10, padding: "10px 16px",
                                pointerEvents: "none",
                                minWidth: 130,
                                textAlign: "center",
                            }}>
                                <div style={{
                                    fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
                                    color: "rgba(160,180,220,0.6)", textTransform: "uppercase", marginBottom: 3,
                                }}>{callout.label}</div>
                                <div style={{
                                    fontSize: 26, fontWeight: 800, lineHeight: 1,
                                    color: callout.color || "#56cfff",
                                    fontVariantNumeric: "tabular-nums",
                                }}>{callout.value}</div>
                                {callout.sublabel && (
                                    <div style={{
                                        fontSize: 10, color: "rgba(160,180,220,0.55)",
                                        marginTop: 3, lineHeight: 1.3,
                                    }}>{callout.sublabel}</div>
                                )}
                            </div>
                        )
                    })}
                </>
            )}

            {/* Demo scan region prompt — shown when overwatch_scan is interactive */}
            {directorVisible && directorDemoScanPrompt && (
                <div style={{
                    position: "fixed",
                    bottom: isMobile ? 226 : 170,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 8600,
                    animation: "demo-choices-in 400ms cubic-bezier(0.34,1.56,0.64,1) both",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(56,189,248,0.6)", textTransform: "uppercase" }}>
                        Overwatch Scanner Ready
                    </div>
                    <button
                        onClick={() => {
                            if (directorDemoScanPrompt) directorDemoScanPrompt()
                            setDirectorDemoScanPrompt(null)
                        }}
                        style={{
                            padding: "13px 32px",
                            background: "rgba(56,139,255,0.15)",
                            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                            border: "1px solid rgba(56,189,248,0.5)",
                            borderRadius: 10,
                            color: "#38bdf8", fontSize: 14, fontWeight: 700, letterSpacing: "0.06em",
                            cursor: "pointer",
                            transition: "background 0.15s, box-shadow 0.15s",
                            fontFamily: "inherit",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(56,189,248,0.25)" }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(56,139,255,0.15)" }}
                    >
                        ⬛ SCAN REGION
                    </button>
                </div>
            )}

            {/* ML scan progress bar — bottom centre, shown during overwatch_scan */}
            {directorVisible && directorScanProgress && !directorScanProgress.complete && (
                <div style={{
                    position: "fixed",
                    bottom: isMobile ? 80 : 60,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 8300,
                    background: "rgba(6,12,28,0.88)",
                    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                    border: "1px solid rgba(56,189,248,0.3)",
                    borderRadius: 10,
                    padding: "10px 18px",
                    minWidth: 260,
                    pointerEvents: "none",
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(56,189,248,0.75)", textTransform: "uppercase" }}>
                            {directorScanProgress.message || "ML SCAN IN PROGRESS"}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#38bdf8" }}>
                            {directorScanProgress.percent}%
                        </div>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: "rgba(56,189,248,0.12)", overflow: "hidden" }}>
                        <div style={{
                            height: "100%",
                            width: directorScanProgress.percent + "%",
                            background: "linear-gradient(90deg, #38bdf8, #818cf8)",
                            borderRadius: 2,
                            transition: "width 250ms linear",
                        }} />
                    </div>
                </div>
            )}

            {/* Director generating indicator — persistent badge while background job runs */}
            {pendingJobId && (
                <div style={{
                    position: "fixed", top: 76, right: 16, display: "flex", alignItems: "center",
                    gap: 10, padding: "10px 16px", background: "rgba(10,15,25,0.92)",
                    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                    border: "1px solid rgba(0,170,255,0.3)", borderRadius: 22,
                    zIndex: 8000,
                }}>
                    <div style={{
                        width: 14, height: 14,
                        border: "2px solid rgba(0,170,255,0.2)",
                        borderTopColor: "#00aaff",
                        borderRadius: "50%",
                        animation: "db-spin 0.9s linear infinite",
                        flexShrink: 0,
                    }} />
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "white" }}>Generating briefing</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums" }}>
                            {briefingProgress || "Preparing…"} · {Math.floor(briefingElapsed / 60)}:{String(briefingElapsed % 60).padStart(2, "0")}
                        </div>
                    </div>
                </div>
            )}

            {/* Director briefing ready notification */}
            {readyBriefing && (
                <div
                    onClick={() => { localStorage.removeItem("hw_ready_briefing"); _startDirectorPlayback(readyBriefing.result, readyBriefing.intent); setReadyBriefing(null) }}
                    style={{
                        position: "fixed",
                        bottom: isMobile ? 80 : 24,
                        right:  isMobile ? 10 : 24,
                        display: "flex", alignItems: "center", gap: 12, padding: "16px 20px",
                        background: "rgba(10,15,25,0.93)", backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        border: "1px solid rgba(0,170,255,0.4)", borderRadius: 14,
                        cursor: "pointer", zIndex: 9000,
                        animation: "director-ready-slide-in 500ms cubic-bezier(0.34,1.56,0.64,1)",
                        maxWidth: isMobile ? "calc(100vw - 20px)" : 400,
                    }}
                >
                    <style>{`
                        @keyframes director-ready-slide-in { from { transform: translateY(100px) scale(0.9); opacity:0; } to { transform: translateY(0) scale(1); opacity:1; } }
                        @keyframes director-diamond-ready-pulse { 0%,100% { transform:scale(1); opacity:0.8; } 50% { transform:scale(1.15); opacity:1; } }
                    `}</style>
                    <div style={{ fontSize: 24, color: "#00aaff", animation: "director-diamond-ready-pulse 2s ease-in-out infinite" }}>◈</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "white" }}>Briefing Ready</div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                            {readyBriefing.intent}
                        </div>
                    </div>
                    <div style={{
                        padding: "8px 16px", background: "rgba(0,170,255,0.2)",
                        border: "1px solid rgba(0,170,255,0.4)", borderRadius: 20,
                        color: "#00aaff", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                    }}>Watch ▶</div>
                    <button
                        onClick={(e) => { e.stopPropagation(); localStorage.removeItem("hw_ready_briefing"); setReadyBriefing(null) }}
                        style={{ position: "absolute", top: 6, right: 8, background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 16, cursor: "pointer", padding: 4 }}
                    >×</button>
                </div>
            )}

            {/* ── Overwatch panel — professional ML detection sidebar ── */}
            {overwatchActive && (
                <OverwatchSidebar
                    bounds={owBounds}
                    polygon={owPolygon}
                    detections={owDetections}
                    scanning={owMode === "analyzing"}
                    onScan={handleOverwatchScan}
                    onScanSentinel={handleSentinelScan}
                    onSentinelLoaded={handleSentinelLoaded}
                    onAssessArea={async (dets, bounds) => {
                        if (!bounds || !dets?.length) return
                        setOwAnalyzing(true)
                        try {
                            const tok = localStorage.getItem("hw-auth-token")
                            const headers = { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
                            const res = await fetch(`${API}/api/overwatch/analyze`, {
                                method: "POST", headers,
                                body: JSON.stringify({ detections: dets, bounds }),
                            })
                            if (res.ok) setOwAnalysis((await res.json()).analysis || null)
                        } catch (_) {}
                        setOwAnalyzing(false)
                    }}
                    onClear={() => {
                        setOwDetections([])
                        setOverwatchDetections([])
                        setOwStats(null)
                        setOwAnalysis(null)
                        setOwMode("idle")
                        setOwSentinelOverlay(null)
                        setOwPolygon(null)
                        setOwBounds(null)
                    }}
                    drawMode={overwatchDrawMode}
                    onDrawModeChange={setOverwatchDrawMode}
                    isMobile={isMobile}
                />
            )}

            {/* Autoplay overlays — world clocks + news ticker */}
            <WorldClocksBar visible={showAutoMode} />
            <NewsTicker     visible={showAutoMode} />

            {/* Auto mode exit button — visible on all screen sizes */}
            {showAutoMode && (
                <button
                    onClick={() => setShowAutoMode(false)}
                    style={{
                        position:       "fixed",
                        top:            12,
                        right:          12,
                        zIndex:         2100,
                        background:     "rgba(8,12,22,0.88)",
                        border:         "1px solid rgba(255,255,255,0.15)",
                        borderRadius:   6,
                        color:          "rgba(232,237,242,0.8)",
                        fontSize:       11,
                        fontWeight:     600,
                        letterSpacing:  "0.06em",
                        padding:        "6px 12px",
                        cursor:         "pointer",
                        backdropFilter: "blur(10px)",
                        WebkitBackdropFilter: "blur(10px)",
                        display:        "flex",
                        alignItems:     "center",
                        gap:            6,
                    }}
                >
                    <span style={{ fontSize: 14, lineHeight: 1 }}>×</span> Exit Auto
                </button>
            )}

            {showReels && <NewsReels onClose={() => setShowReels(false)} />}

            {/* Full UI rebuild spec section 3.2 — persistent footer, never
                changes size or disappears. "There is no mobile layout in
                this pass" (section 3.3) — BottomNav.jsx/MobileDrawer.jsx are
                retired along with the rest of the old mobile chrome; the
                real isMobile detection elsewhere in this file (unrelated
                layout adaptations) is untouched. */}
            {!showAutoMode && <StatusBar health={healthData} taskCount={taskCount} />}
        </div>
    )
}
