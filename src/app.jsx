import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from "react"
import { REGION_COORDS } from "./data/regionCoords.js"
const GlobeView = lazy(() => import("./components/GlobeView.jsx"))
import IconSprite from "./ui/IconSprite.jsx"
import TopBar from "./components/TopBar.jsx"
import TabStrip from "./components/TabStrip.jsx"
import SessionControl from "./components/SessionControl.jsx"
import { ensureActiveSession, startSessionAutoPersist } from "./state/sessionStore.js"
import LoginScreen from "./components/LoginScreen.jsx"
import { checkSession, subscribeAuth } from "./state/authStore.js"
import { reconcileTheme } from "./state/themeStore.js"
import { reconcileSettings, getSettings, subscribeSettings, updateSetting } from "./state/settingsStore.js"
import StatusBar from "./components/StatusBar.jsx"
import CommandPalette from "./components/CommandPalette.jsx"
import SettingsModal from "./components/SettingsModal.jsx"
import ToastHost from "./ui/ToastHost.jsx"
import Situation from "./destinations/Situation.jsx"
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
    analytics: "analytics", generate: "generate", briefings: "briefings", replay: "replay",
    ontology: "ontology", imagery: "imagery",
    mywork: "mywork", mail: "mail", cases: "cases", team: "team",
}
const TAB_TYPE_TO_MODULE = {
    situation: "situation", watchlists: "inbox", dossiers: "dossiers",
    analytics: "analytics", generate: "generate", briefings: "briefings", replay: "replay",
    ontology: "ontology", imagery: "imagery",
    mywork: "mywork", mail: "mail", cases: "cases", team: "team",
}
// Mode, not modules (§7.1) — which real module keys a tab type routes to
// belongs to which mode's rail. Opening a tab whose module is work-mode
// (e.g. a case: ref resolved from Watch mode) switches the mode itself,
// exactly like the doc's own HWX.onModule-equivalent correction — guarded
// by MODE_SWITCH_GUARD_MS below so the mode-setter and any other effect
// reacting to the same tab change can't fight each other.
const WORK_MODULE_KEYS = new Set(["mywork", "mail", "cases", "team"])
const MODE_STORAGE_KEY = "akili-mode-v1"
import MapControlStack from "./components/MapControlStack.jsx"
import { DESTINATION_KEYS } from "./data/destinations.js"
import { summarizeHealth } from "./utils/systemHealth.js"
import WatchlistsPage from "./components/WatchlistsPage.jsx"
import Dashboard from "./destinations/Dashboard.jsx"
import Sources from "./destinations/Sources.jsx"
import AICouncil from "./destinations/AICouncil.jsx"
import Generate from "./reports/Generate.jsx"
import Briefings from "./reports/Briefings.jsx"
import PrintLayout from "./reports/PrintLayout.jsx"
import Deck from "./reports/Deck.jsx"
import MobileApp from "./mobile/MobileApp.jsx"
import AlertStrip, { isFlagged } from "./components/AlertStrip.jsx"
import WorkspacesPanel from "./components/WorkspacesPanel.jsx"
import ChatPanel from "./components/ChatPanel.jsx"
import TVWidget from "./components/tvwidget.jsx"
import { loadProfile, saveProfileToStorage } from "./components/MissionProfilePanel.jsx"
import SurfaceDetailPanel from "./components/SurfaceDetailPanel.jsx"
import { playAlert, resumeAudio } from "./soundSystem.js"
import HealthPanel from "./components/HealthPanel.jsx"
import Analytics from "./destinations/Analytics.jsx"
import Dossiers from "./destinations/Dossiers.jsx"
import Ontology from "./destinations/Ontology.jsx"
import Replay from "./destinations/Replay.jsx"
import Imagery from "./destinations/Imagery.jsx"
import MyWork from "./destinations/MyWork.jsx"
import Mail from "./destinations/Mail.jsx"
import Cases from "./destinations/Cases.jsx"
import Team from "./destinations/Team.jsx"
import API_BASE from "./apiBase.js"
import ProfilePanel from "./components/ProfilePanel.jsx"
import NewsReels from "./components/NewsReels.jsx"
import { mergeNotificationItems } from "./components/notificationsNormalize.js"
import OverwatchSidebar, { loadSavedScans, persistSavedScans, loadSavedImages, persistSavedImages } from "./components/OverwatchSidebar.jsx"
import EmergingConflictsPanel from "./components/EmergingConflictsPanel.jsx"
import NewsTicker from "./components/NewsTicker.jsx"
import WorldClocksBar from "./components/WorldClocksBar.jsx"
import { resolveTabAction } from "./lib/tabModel.js"

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
// Theming regression fix: was a hardcoded rgba(6,14,45,...) literal predating
// the real token system — never responded to [data-theme="light"], and
// didn't even match dark mode's real --bg-0. Reuses the exact real glass
// token the theming round already established (--pane-glass-bg, same one
// .pane-glass uses in designSystem.css) rather than a second glass value.
const PANEL_STYLE = {
    width:       RIGHT_PANEL_W,
    flexShrink:  0,
    height:      "100%",
    background:  "var(--pane-glass-bg)",
    backdropFilter: "blur(20px) saturate(1.3)",
    WebkitBackdropFilter: "blur(20px) saturate(1.3)",
    borderLeft:  "1px solid var(--acc-line)",
    overflowY:   "auto",
    boxSizing:   "border-box",
    fontFamily:  "system-ui, -apple-system, sans-serif",
    transition:  "opacity 150ms ease",
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
    // Real authentication round — gates the entire real app shell (see the
    // Render section below) behind a real verified session. checkSession()
    // asks the real backend whether an existing cookie is still valid
    // (real 401 if not — never assumed).
    const [authUser, setAuthUser] = useState(null)
    const [authChecked, setAuthChecked] = useState(false)
    useEffect(() => {
        checkSession().then((u) => { setAuthUser(u); setAuthChecked(true); reconcileTheme(u); reconcileSettings(u) })
        return subscribeAuth(setAuthUser)
    }, [])

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

    const [isMobile,     setIsMobile]     = useState(() => typeof window !== "undefined" && window.innerWidth < 768)
    // Real phone-mode breakpoint — a genuine structural shell swap (the
    // four-tab mobile companion in place of the desktop console), distinct
    // from the gentler `isMobile` reflow tweak above (768px, minor layout
    // adjustments only). ~600px matches the phone frame this was designed
    // against. Re-evaluated live on resize/orientation change, never decided
    // once at load. Real bug caught live: gating on innerWidth alone would
    // kick a real phone in landscape (e.g. 844x390) OUT of phone mode the
    // moment it rotates, since its width alone exceeds 600 even though it's
    // still genuinely a phone — the smaller of the two dimensions is the
    // real "is this a phone-sized viewport" question, regardless of
    // orientation.
    const phoneModeQuery = () => typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) < 600
    const [phoneMode, setPhoneMode] = useState(phoneModeQuery)
    const [showReels, setShowReels] = useState(false)
    const [showAutoMode, setShowAutoMode] = useState(false)
    // V3 Phase 2, §6.6 Part 3 — deck present mode strips the app's own
    // chrome (topbar/tab strip/status bar). Deck.jsx lives deep inside this
    // component's own render tree (the "briefings" tab slot), so it
    // dispatches a real event rather than needing presenting threaded down
    // as a prop through every intermediate layer — the same destination-
    // neutral CustomEvent pattern already established for akili:navigate
    // etc. Reuses the exact same `!showAutoMode`-style chrome-hiding
    // condition already in place below, rather than inventing a second one.
    const [presenting, setPresenting] = useState(false)
    useEffect(() => {
        const h = (e) => setPresenting(!!e.detail?.active)
        window.addEventListener("akili:present-mode", h)
        return () => window.removeEventListener("akili:present-mode", h)
    }, [])
    // Sessions & Views full round (§3.4) — real app-boot restore of this
    // user's last-active real session (or a seeded honest default if none
    // exist yet), plus the real belt-and-suspenders 60s/beforeunload
    // persistence. Runs once; startSessionAutoPersist()'s own teardown
    // unregisters both real listeners on unmount.
    useEffect(() => {
        ensureActiveSession().catch(() => { /* real network hiccup — SessionControl's own popover open will retry via listSessions() */ })
        return startSessionAutoPersist()
    }, [])
    // Mode, not modules (§7.1) — Watch vs Workstation. Synchronous init from
    // localStorage (read in the useState initializer, not an effect) so the
    // very first render already reflects the right mode — no flash of the
    // wrong rail set on load, per the doc's own explicit warning about
    // async/setTimeout-applied mode classes. Sessions/filters/basket are
    // untouched by a mode switch (they're not part of this state at all).
    const [mode, setModeRaw] = useState(() => {
        try { return localStorage.getItem(MODE_STORAGE_KEY) === "work" ? "work" : "watch" } catch { return "watch" }
    })
    // Guards the mode-setter against a tab-type-driven effect (below) firing
    // right back — real "switching" flag, not a hopeful timing assumption.
    const modeSwitchGuardRef = useRef(false)
    const setMode = useCallback((next) => {
        modeSwitchGuardRef.current = true
        setModeRaw(next)
        try { localStorage.setItem(MODE_STORAGE_KEY, next) } catch { /* ignore */ }
        setTimeout(() => { modeSwitchGuardRef.current = false }, 0)
    }, [])

    // W / G keybindings (§7.1) — both guarded against firing while typing.
    useEffect(() => {
        const handler = (e) => {
            if (e.target?.matches?.("input,textarea,select")) return
            if (e.metaKey || e.ctrlKey || e.altKey) return
            if (e.key === "w" || e.key === "W") { e.preventDefault(); setMode(mode === "work" ? "watch" : "work") }
            else if (e.key === "g" || e.key === "G") { e.preventDefault(); setMode("work"); openTab(MODULE_TO_TAB_TYPE.mywork) }
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode])

    const [heatmapHours, setHeatmapHours] = useState(24)
    const [overwatchDetections, setOverwatchDetections] = useState([])

    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", handler)
        return () => window.removeEventListener("resize", handler)
    }, [])

    useEffect(() => {
        const handler = () => setPhoneMode(phoneModeQuery())
        window.addEventListener("resize", handler)
        window.addEventListener("orientationchange", handler)
        return () => {
            window.removeEventListener("resize", handler)
            window.removeEventListener("orientationchange", handler)
        }
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

    // Generate/Briefings/print-layout wiring — Generate's completed run (or
    // its "printable briefing" button) opens the Briefings tab pre-loaded
    // with that report; printReportId, when set, swaps the Briefings tab's
    // content for the print layout (#view-doc is a hidden view, reachable
    // only from here or the reader's own print action, never the rail).
    const [briefingsInitialId, setBriefingsInitialId] = useState(null)
    const [printReportId, setPrintReportId] = useState(null)
    // V3 Phase 2, §6.1/§6.6 — the deck is a third rendering of the same
    // real document object, reachable the exact same way print is: never
    // its own rail destination, only from the reader toolbar, the print
    // toolbar, or Generate's footer. deckReportId swaps the Briefings tab's
    // content for the deck, same pattern as printReportId.
    const [deckReportId, setDeckReportId] = useState(null)

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
    const [settingsOpen, setSettingsOpen] = useState(false)

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

    // ── App settings — real Settings round: real per-user, server-persisted
    // store (settingsStore.js), replacing the old localStorage + non-per-
    // user global /api/settings dict. Same flat keys/consumers as before
    // (real alert sound cues, real alert-poll interval below) — only the
    // persistence mechanism underneath changed. ───────────────────────────
    const [appSettings, setAppSettings] = useState(getSettings)
    const settingsRef = useRef(appSettings)
    useEffect(() => { settingsRef.current = appSettings }, [appSettings])

    useEffect(() => subscribeSettings(setAppSettings), [])

    // ── Real-time alert sound cues (UI correction pass: toast popups removed
    // entirely — alerts surface exclusively via the header bell badge and the
    // Watchlists console now; this effect keeps the real audio-cue behavior,
    // which is a distinct "Sound" toggle, not a toast) ────────────────────────
    const alertSinceRef = useRef(new Date().toISOString())
    const seenAlertIdsRef = useRef(new Set())

    // Derived from unified settings (fixes dual-key conflict with old "akili-sound-muted")
    const soundMuted = appSettings.soundMuted

    const onToggleSound = useCallback(() => {
        updateSetting("soundMuted", !settingsRef.current.soundMuted)
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

    // V3 Phase 1, §3.4 — record-scoped tabs. A plain module switch
    // (`openTab("dossiers")`, no opts) keeps its exact existing behaviour:
    // one base tab per module type, reused, never duplicated. Opening a
    // SPECIFIC record (`openTab("dossiers", {recordRef:"ent:AOI-14",
    // label:"Dossier · Red Sea corridor"})`) creates or reuses a tab keyed
    // on (type, recordRef) instead — a real, separate tab per record,
    // distinct from that module's own base tab. This is the real
    // implementation the pre-existing (audited, unused) retitleTab stub
    // was left for.
    // Redesign Round 2, §3 — real contextual tab retitling (e.g. opening a
    // specific Dossier or generated report retitles its own tab, distinct
    // from the module's own display name). Declared before openTab (which
    // now references it in its own dependency array) rather than after —
    // useCallback's dependency array is evaluated eagerly at this line, so
    // referencing a same-scope `const` declared later would be a real
    // temporal-dead-zone crash, not just a style preference.
    const retitleTab = useCallback((id, label) => {
        setTabs(prev => prev.map(t => (t.id === id ? { ...t, label } : t)))
    }, [])

    const openTab = useCallback((type, opts) => {
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
        //
        // The actual switch-vs-create decision lives in the pure, unit-
        // tested resolveTabAction() (src/lib/tabModel.js) — kept out of this
        // component so the record-scoped-tab logic (V3 Phase 1, §3.4) can
        // be tested without mounting the whole app shell.
        // Mode-routing correction (§7.1) — opening a ref/tab whose module
        // lives in the other mode's rail switches the mode itself (e.g. a
        // case: ref opened from Watch mode), guarded by modeSwitchGuardRef
        // so this and the W/G keybinding effect can't fight each other.
        const targetModule = TAB_TYPE_TO_MODULE[type]
        if (targetModule) {
            const targetIsWork = WORK_MODULE_KEYS.has(targetModule)
            if (targetIsWork && mode !== "work") setMode("work")
            else if (!targetIsWork && mode === "work") setMode("watch")
        }
        const decision = resolveTabAction(tabs, type, opts, crypto.randomUUID())
        if (decision.action === "switch") { switchTab(decision.id); return }
        if (decision.action === "retitle-and-switch") { retitleTab(decision.id, decision.label); switchTab(decision.id); return }
        setTabs(prev => {
            // Re-check against the latest tabs (not the `tabs` this closure
            // captured) in case of a rapid double-fire — mirrors the
            // dedup guard the pre-existing base-tab path already had.
            const reDecision = resolveTabAction(prev, type, opts, decision.tab.id)
            if (reDecision.action !== "create") return prev
            return [...prev, decision.tab]
        })
        switchTab(decision.tab.id)
    }, [tabs, switchTab, retitleTab, mode, setMode])

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
        const h = (e) => {
            if (!e.detail?.destination) return
            const { destination, recordRef, label } = e.detail
            openTab(destination, recordRef ? { recordRef, label } : undefined)
        }
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

    // Persist tabs to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tabs))
            localStorage.setItem(TAB_STORAGE_KEY + "-active", activeTabId)
        } catch { /* ignore */ }
    }, [tabs, activeTabId])

    // V3 Phase 1, §5.1 — real session restore of open tabs. A session
    // CAPTURES the current tabs by reading the same TAB_STORAGE_KEY this
    // effect already writes (no second store needed); restoring a session
    // dispatches this event with the real saved {tabs, activeTabId}.
    useEffect(() => {
        const h = (e) => {
            const { tabs: restoredTabs, activeTabId: restoredActive } = e.detail || {}
            if (!Array.isArray(restoredTabs) || !restoredTabs.length) return
            setTabs(restoredTabs)
            setActiveTabId(restoredTabs.find(t => t.id === restoredActive) ? restoredActive : restoredTabs[restoredTabs.length - 1].id)
        }
        window.addEventListener("akili:restore-tabs", h)
        return () => window.removeEventListener("akili:restore-tabs", h)
    }, [])

    // ── Situations (state kept for ChatPanel context; no panel UI) ──────────
    const [situations,        setSituations]        = useState([])
    const [activeSituationId, setActiveSituationId] = useState(null)
    const activeSituation = situations.find(s => s.id === activeSituationId) || null

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


    // ── Render ────────────────────────────────────────────────────────────────

    // Real authentication gate — nothing below renders (desktop or mobile
    // shell) until a real session is confirmed. A blank frame while
    // checkSession()'s one real request is in flight is honest (genuinely
    // nothing to show yet); a real login screen once we know there's no
    // valid session.
    if (!authChecked) return null
    if (!authUser) return <LoginScreen onLoggedIn={setAuthUser} />

    // Real structural swap (not a fluid reflow) — below the phone breakpoint,
    // the four-tab mobile shell renders in place of the entire ten-module
    // desktop console. Both share this same component's state underneath
    // (one router/session, per the correction prompt): the one concrete case
    // named there — a specific briefing already open — carries over via
    // briefingsInitialId, a real prop this component already threads into
    // the desktop Briefings destination a few hundred lines below.
    if (phoneMode) {
        return <MobileApp initialBriefingReportId={briefingsInitialId} />
    }

    const panelStyle = isMobile ? {
        position:    "fixed",
        top:         0,
        left:        0,
        right:       0,
        bottom:      56,
        zIndex:      1500,
        background:  "var(--pane-glass-bg)",
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
            background:    "var(--bg-0)",
            display:       "flex",
            flexDirection: "column",
            overflow:      "hidden",
            fontFamily:    "system-ui, -apple-system, sans-serif",
        }}>
        <IconSprite />
            {/* ── Top bar + tab strip — redesign Round 2, §1/§2/§3 ───────────── */}
            {!showAutoMode && !presenting && (
                <>
                    <TopBar
                        activeModule={TAB_TYPE_TO_MODULE[activeTabType] || "situation"}
                        onSelectModule={(key) => openTab(MODULE_TO_TAB_TYPE[key] || key)}
                        unreadCount={unreadCount}
                        systemHealth={systemHealth}
                        onOpenPalette={() => setPaletteOpen(true)}
                        mode={mode}
                        onToggleMode={() => setMode(mode === "work" ? "watch" : "work")}
                        onOpenSettings={() => setSettingsOpen(true)}
                    />
                    <TabStrip
                        tabs={tabs}
                        activeTabId={activeTabId}
                        onSelect={switchTab}
                        onClose={closeTab}
                        onOpenPalette={() => setPaletteOpen(true)}
                        liveFeedCount={Array.isArray(healthData?.data_sources) ? healthData.data_sources.filter(s => s.status === "ok").length : null}
                        sessionControl={<SessionControl />}
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
                onOpenReport={() => openTab("briefings")}
            />
            {settingsOpen && (
                <SettingsModal
                    onClose={() => setSettingsOpen(false)}
                    onOpenSources={() => openTab("sources")}
                />
            )}

            {/* ── Body — flex row, fills remaining height ───────────────────── */}
            <div style={{ flex: 1, display: "flex", minHeight: 0, paddingBottom: (isMobile && !showAutoMode) ? 56 : 0 }}>

                {/* ── Full-screen panels — all mounted while tab exists, hidden via display:none ── */}

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
                        <Dossiers onOpenGenerate={() => openTab("generate")} />
                    </div>
                )}

                {tabs.some(t => t.type === "replay") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "replay" ? "flex" : "none", flexDirection: "column" }}>
                        <Replay isVisible={activeTabType === "replay"} />
                    </div>
                )}

                {tabs.some(t => t.type === "ontology") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "ontology" ? "flex" : "none", flexDirection: "column" }}>
                        <Ontology onOpenGenerate={() => openTab("generate")} />
                    </div>
                )}

                {tabs.some(t => t.type === "imagery") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "imagery" ? "flex" : "none", flexDirection: "column" }}>
                        <Imagery onOpenGenerate={() => openTab("generate")} />
                    </div>
                )}

                {tabs.some(t => t.type === "generate") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "generate" ? "flex" : "none", flexDirection: "column" }}>
                        <Generate onOpenTab={(reportId, title, kind) => {
                            setBriefingsInitialId(reportId)
                            setPrintReportId(kind === "print" ? reportId : null)
                            setDeckReportId(kind === "deck" ? reportId : null)
                            // V3 Phase 1, §3.4 — a specific generated briefing gets its
                            // own named tab (brf:<id>), distinct from Briefings' base tab.
                            openTab("briefings", { recordRef: `brf:${reportId}`, label: `Briefing · ${title || reportId}` })
                        }} />
                    </div>
                )}

                {tabs.some(t => t.type === "briefings") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "briefings" ? "flex" : "none", flexDirection: "column" }}>
                        {deckReportId ? (
                            <Deck reportId={deckReportId} onBack={() => setDeckReportId(null)} />
                        ) : printReportId ? (
                            <PrintLayout reportId={printReportId} onBack={() => setPrintReportId(null)} onOpenDeck={(id) => { setPrintReportId(null); setDeckReportId(id) }} />
                        ) : (
                            <Briefings initialReportId={briefingsInitialId} onPrint={(id) => setPrintReportId(id)} onOpenDeck={(id) => setDeckReportId(id)} isVisible={activeTabType === "briefings"} />
                        )}
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
                        <AICouncil onOpenReport={(reportId) => {
                            setBriefingsInitialId(reportId)
                            openTab("briefings", { recordRef: `brf:${reportId}`, label: `Briefing · ${reportId}` })
                        }} />
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

                {/* Workstation modules (§7.1) — same kept-mounted,
                    display:none-when-inactive pattern as every other tab
                    type above. */}
                {tabs.some(t => t.type === "mywork") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "mywork" ? "flex" : "none", flexDirection: "column" }}>
                        <MyWork />
                    </div>
                )}
                {tabs.some(t => t.type === "mail") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "mail" ? "flex" : "none", flexDirection: "column" }}>
                        <Mail />
                    </div>
                )}
                {tabs.some(t => t.type === "cases") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "cases" ? "flex" : "none", flexDirection: "column" }}>
                        <Cases />
                    </div>
                )}
                {tabs.some(t => t.type === "team") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "team" ? "flex" : "none", flexDirection: "column" }}>
                        <Team />
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
                        panelStyle={panelStyle}
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
            {!showAutoMode && !presenting && <StatusBar health={healthData} taskCount={taskCount} />}
        </div>
    )
}
