import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from "react"
import MapPage from "./components/mappage.jsx"
const GlobeView = lazy(() => import("./components/GlobeView.jsx"))
import TopBar from "./components/TopBar.jsx"
import Sidebar from "./components/Sidebar.jsx"
import AlertStrip, { isFlagged } from "./components/AlertStrip.jsx"
import WorkspacesPanel from "./components/WorkspacesPanel.jsx"
import ChatPanel from "./components/ChatPanel.jsx"
import DirectChatPanel from "./components/DirectChatPanel.jsx"
import TVWidget from "./components/tvwidget.jsx"
import MissionProfilePanel, { loadProfile, saveProfileToStorage } from "./components/MissionProfilePanel.jsx"
import NotificationsDrawer from "./components/NotificationsDrawer.jsx"
import SurfaceDetailPanel from "./components/SurfaceDetailPanel.jsx"
import BriefingPanel from "./components/BriefingPanel.jsx"
import ToastSystem from "./components/ToastSystem.jsx"
import { playAlert, resumeAudio } from "./soundSystem.js"
import SettingsPanel from "./components/SettingsPanel.jsx"
import HealthPanel from "./components/HealthPanel.jsx"
import POIPanel from "./components/POIPanel.jsx"
import API_BASE from "./apiBase.js"
import LoadingScreen from "./components/LoadingScreen.jsx"
import ProfilePanel from "./components/ProfilePanel.jsx"
import PreferencesPanel, { loadSettings } from "./components/PreferencesPanel.jsx"
import LoginPage from "./components/LoginPage.jsx"
import AdminPanel from "./components/AdminPanel.jsx"
import NotificationBar from "./components/NotificationBar.jsx"
import NewsPage from "./components/NewsPage.jsx"
import BottomNav from "./components/BottomNav.jsx"
import MobileDrawer from "./components/MobileDrawer.jsx"
import { getToken, clearToken, apiFetch } from "./auth.js"
import DirectorBar from "./components/DirectorBar.jsx"
import DirectorSidebar from "./components/DirectorSidebar.jsx"
import DirectorModal from "./components/DirectorModal.jsx"
import DirectorSubtitle from "./components/DirectorSubtitle.jsx"
import DirectorCountryPanel from "./components/DirectorCountryPanel.jsx"
import { CommandRunner, generateDirectorSequence, fetchDirectorSnapshot, saveDirectorSequence, submitDirectorBriefing, pollDirectorStatus } from "./services/commandRunner.js"
import { DemoRunner } from "./services/demoRunner.js"
import { DEMO_BRIEFING_HORMUZ } from "./data/demoBriefing.js"
import TimeSlider from "./components/TimeSlider.jsx"

const API = API_BASE
const WS_STORAGE_KEY  = "akili-workspaces-v1"
const TAB_STORAGE_KEY = "akili_tabs"

function defaultTabs() {
    return [{ id: "map", type: "map", label: "Map" }]
}

function loadTabsFromStorage() {
    try {
        const raw = localStorage.getItem(TAB_STORAGE_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed) && parsed.length > 0) {
                if (!parsed.find(t => t.type === "map")) {
                    return [{ id: "map", type: "map", label: "Map" }, ...parsed]
                }
                return parsed
            }
        }
    } catch { /* ignore */ }
    return defaultTabs()
}


const REGION_COORDS = {
    "East Africa":    { lat: -2,  lon: 37, zoom: 5 },
    "Great Lakes Region": { lat: -3, lon: 30, zoom: 6 },
    "Sahel":          { lat: 15,  lon: 5,  zoom: 5 },
    "Red Sea / Arabian Peninsula": { lat: 20, lon: 43, zoom: 5 },
    "Gulf States":    { lat: 25,  lon: 53, zoom: 6 },
    "Middle East":    { lat: 25,  lon: 45, zoom: 5 },
    "Horn of Africa": { lat: 8,   lon: 46, zoom: 5 },
    "North Africa":   { lat: 25,  lon: 17, zoom: 4 },
    "West Africa":    { lat: 12,  lon: -2, zoom: 5 },
    "Central Africa": { lat: 2,   lon: 24, zoom: 5 },
    "Southern Africa":{ lat: -22, lon: 25, zoom: 5 },
    "Indian Ocean":   { lat: -8,  lon: 67, zoom: 4 },
    "Mediterranean":  { lat: 36,  lon: 18, zoom: 5 },
    "South Asia":     { lat: 25,  lon: 72, zoom: 5 },
    "Southeast Asia": { lat: 10,  lon: 108, zoom: 5 },
    "Central Asia":   { lat: 42,  lon: 60, zoom: 5 },
    "Europe":         { lat: 52,  lon: 12, zoom: 4 },
}

// ── Workspace helpers ─────────────────────────────────────────────────────────

function newWorkspace(name) {
    return { id: crypto.randomUUID(), name, center: [20, 0], zoom: 2, layers: null }
}

function loadWorkspaces() {
    try {
        const raw = localStorage.getItem(WS_STORAGE_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed) && parsed.length > 0) return parsed
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
    const [authChecked,  setAuthChecked]  = useState(false)
    const [currentUser,  setCurrentUser]  = useState(null)
    const [showAdmin,         setShowAdmin]         = useState(false)
    const [showChat,          setShowChat]          = useState(false)
    const [overwatchActive,   setOverwatchActive]   = useState(false)
    const [sentinel2Active,   setSentinel2Active]   = useState(false)
    const [timeTravelActive,  setTimeTravelActive]  = useState(false)
    const [timeTravelTime,    setTimeTravelTime]    = useState(null)
    const [showLoginModal,    setShowLoginModal]    = useState(false)

    // ── Director Mode ──────────────────────────────────────────────────────────
    const [directorVisible,        setDirectorVisible]        = useState(false)
    const [directorSequence,       setDirectorSequence]       = useState(null)
    const [directorLayerOverrides, setDirectorLayerOverrides] = useState({})
    const [directorHighlights,     setDirectorHighlights]     = useState([])
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
    const [readyBriefing,      setReadyBriefing]       = useState(null)  // { result, intent }
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
    const [directorScanProgress,  setDirectorScanProgress]  = useState(null)
    const [isMobile,     setIsMobile]     = useState(() => typeof window !== "undefined" && window.innerWidth < 768)
    const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
    const [viewMode,     setViewMode]     = useState("2d")

    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", handler)
        return () => window.removeEventListener("resize", handler)
    }, [])

    // ── Auth check on mount ───────────────────────────────────────────────────
    useEffect(() => {
        const token = getToken()
        if (!token) { setAuthChecked(true); return }
        let resolved = false
        const resolve = () => { if (!resolved) { resolved = true; setAuthChecked(true) } }
        // Timeout: if backend unreachable, show login after 6s instead of hanging indefinitely
        const timeout = setTimeout(() => { clearToken(); resolve() }, 6000)
        apiFetch("/api/auth/me")
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (d?.id) setCurrentUser(d)
                else clearToken()
            })
            .catch(() => clearToken())
            .finally(() => { clearTimeout(timeout); resolve() })
    }, [])

    // ── Session tracking — post location/view every 60s ──────────────────────
    useEffect(() => {
        if (!currentUser) return
        const post = () => {
            apiFetch("/api/auth/session", {
                method: "POST",
                body: JSON.stringify({ current_view: null }),
            }).catch(() => {})
        }
        post()
        const t = setInterval(post, 60000)
        return () => clearInterval(t)
    }, [currentUser])

    // ── GPS location tracking — send to backend on login, then every 5 min ───
    useEffect(() => {
        if (!currentUser) return
        if (!navigator.geolocation) {
            console.warn("[location] navigator.geolocation not available")
            return
        }
        const send = (pos) => {
            const { latitude, longitude, accuracy } = pos.coords
            console.log("[location] Sending:", { lat: latitude, lon: longitude, accuracy })
            apiFetch("/api/user/location", {
                method: "POST",
                body: JSON.stringify({ lat: latitude, lon: longitude }),
            }).then(r => console.log("[location] Response:", r.status)).catch(e => console.error("[location] Error:", e))
        }
        const onError = (err) => {
            console.warn("[location] Geolocation error:", err.code, err.message)
        }
        // Use less aggressive settings on mobile to reduce battery drain
        const mobileUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
        const opts = {
            enableHighAccuracy: !mobileUA,
            timeout:            15000,
            maximumAge:         mobileUA ? 300000 : 60000,
        }
        navigator.geolocation.getCurrentPosition(send, onError, opts)
        const t = setInterval(() => {
            navigator.geolocation.getCurrentPosition(send, onError, opts)
        }, 5 * 60 * 1000)
        return () => clearInterval(t)
    }, [currentUser])

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
        return saved[0]?.id || "map"
    })
    const tabHistoryRef = useRef([])

    // Derived — used throughout instead of `page`
    const activeTab     = tabs.find(t => t.id === activeTabId) || tabs[0]
    const activeTabType = activeTab?.type || "map"

    // ── Navigation ────────────────────────────────────────────────────────────
    const [searchTarget, setSearchTarget] = useState(null)

    // ── Right panel slot — mutually exclusive ─────────────────────────────────
    // null | "layers" | "detail" | "profile" | "settings" | "health" | "workspaces" | "situations" | "chat" | "alerts" | "poi"
    const [rightPanel, setRightPanel] = useState(null)

    const openRightPanel = useCallback((id) => {
        setRightPanel(prev => prev === id ? null : id)
    }, [])

    // ── Surface pool / notifications ──────────────────────────────────────────
    const [surfaceItems,     setSurfaceItems]     = useState([])
    const [surfaceUpdatedAt, setSurfaceUpdatedAt] = useState(null)
    const [selectedSurface,  setSelectedSurface]  = useState(null)
    const [notifOpen,        setNotifOpen]        = useState(false)
    const [notifSortMode,    setNotifSortMode]    = useState("relevance")
    const [readIds,          setReadIds]          = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem("akili-notif-read-v1") || "[]")) }
        catch { return new Set() }
    })
    const unreadCount = surfaceItems.filter(i => !readIds.has(i.id)).length

    const handleMarkRead = useCallback((id) => {
        setReadIds(prev => {
            const next = new Set(prev)
            next.add(id)
            try { localStorage.setItem("akili-notif-read-v1", JSON.stringify([...next])) } catch {}
            return next
        })
    }, [])

    const handleNotifSelect = useCallback((item) => {
        handleMarkRead(item.id)
        setNotifOpen(false)
        setSelectedSurface(item)
        setRightPanel("detail")
        setSearchTarget({ lat: item.lat, lon: item.lon, zoom: 7, key: Date.now() })
    }, [handleMarkRead])  // eslint-disable-line react-hooks/exhaustive-deps

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
    const BRIEFING_READ_KEY = "akili-briefing-read-at-v1"
    const [briefingUnread, setBriefingUnread] = useState(() => {
        // Unread if no read timestamp stored, or the stored timestamp is older than
        // the last briefing generation (checked after fetch)
        return false
    })

    const handleBriefingMarkRead = useCallback(() => {
        localStorage.setItem(BRIEFING_READ_KEY, new Date().toISOString())
        setBriefingUnread(false)
    }, [])

    // Poll /api/briefing/latest every 30 min to detect new auto-generated briefings
    useEffect(() => {
        if (!profile) return
        const check = () => {
            fetch(`${API}/api/briefing/latest`)
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (!d?.briefing) return
                    const generatedAt = d.briefing.generated_at
                    const readAt      = localStorage.getItem(BRIEFING_READ_KEY)
                    if (!readAt || readAt < generatedAt) {
                        setBriefingUnread(true)
                    }
                })
                .catch(() => {})
        }
        check()
        const t = setInterval(check, 1800000)  // 30 min
        return () => clearInterval(t)
    }, [profile])  // eslint-disable-line react-hooks/exhaustive-deps

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

    // ── Real-time alert toasts ────────────────────────────────────────────────
    const [toasts,           setToasts]           = useState([])
    const alertSinceRef = useRef(new Date().toISOString())

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

    const dismissToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    const openToast = useCallback((alert) => {
        setSelectedSurface(alert)
        setRightPanel("detail")
        if (alert.lat && alert.lon) {
            setSearchTarget({ lat: alert.lat, lon: alert.lon, zoom: 8, key: Date.now() })
        }
        setActiveTabId("map")
    }, [])   // eslint-disable-line react-hooks/exhaustive-deps

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
                    let incoming = d.alerts.filter(a => a.priority !== false)
                    if (!incoming.length) return
                    // Toast filtering
                    if (!s.toastsEnabled) return
                    if (s.toastsCriticalOnly) {
                        incoming = incoming.filter(a => a.severity_tier === "critical")
                        if (!incoming.length) return
                    }
                    setToasts(prev => {
                        const existingIds = new Set(prev.map(t => t.id))
                        const fresh = incoming.filter(a => !existingIds.has(a.id))
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
                        return [...prev, ...fresh].slice(-5)   // cap at 5 visible toasts
                    })
                    // Also surface unread notification count
                    setReadIds(prev => prev)   // trigger recompute
                })
                .catch(() => {})
        }
        const intervalMs = (settingsRef.current.alertInterval || 15) * 1000
        const tid = setInterval(poll, intervalMs)
        return () => clearInterval(tid)
    }, [profile, appSettings.alertInterval])  // eslint-disable-line react-hooks/exhaustive-deps

    // ── Anomaly alert polling (System 6) — every 2 minutes ────────────────────
    const anomalySeenRef = useRef(new Set())
    const showAnomalyNotification = useCallback((alert) => {
        const existing = document.getElementById(`hw-anomaly-${alert.id}`)
        if (existing) return
        const pulse = alert.severity === 'critical' ? 'rgba(255,50,50,0.5)' : 'rgba(255,170,0,0.4)'
        const color = alert.severity === 'critical' ? '#ff4444' : '#ffaa00'
        const el = document.createElement('div')
        el.id = `hw-anomaly-${alert.id}`
        el.style.cssText = `position:fixed;top:80px;right:20px;width:360px;background:rgba(10,15,25,0.95);backdrop-filter:blur(16px);border:1px solid ${pulse};border-radius:12px;padding:16px;z-index:9500;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:system-ui;animation:hw-slide-in-r 400ms ease-out;`
        el.innerHTML = `
            <style>@keyframes hw-slide-in-r{from{transform:translateX(120px);opacity:0}to{transform:translateX(0);opacity:1}}</style>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:10px;letter-spacing:2px;color:${color};text-transform:uppercase;margin-bottom:4px;">⚠ ${(alert.type || '').replace(/_/g, ' ')}</div>
                    <div style="font-size:14px;font-weight:700;color:white;margin-bottom:4px;">${alert.title || 'Anomaly'}</div>
                    ${alert.subtitle ? `<div style="font-size:12px;color:rgba(0,170,255,0.85);margin-bottom:5px;">${alert.subtitle}</div>` : ''}
                    <div style="font-size:11px;color:rgba(255,255,255,0.55);line-height:1.45;margin-bottom:8px;">${alert.reason || alert.description || ''}</div>
                </div>
                <button id="hw-an-close-${alert.id}" style="background:none;border:none;color:rgba(255,255,255,0.3);font-size:18px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0;">×</button>
            </div>
            <div style="display:flex;gap:8px;">
                ${alert.lat != null ? `<button id="hw-an-map-${alert.id}" style="flex:1;padding:6px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;background:rgba(0,170,255,0.15);border:1px solid rgba(0,170,255,0.3);color:#00aaff;">📍 Show on Map</button>` : ''}
                <button id="hw-an-pin-${alert.id}" style="flex:1;padding:6px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;background:rgba(255,170,0,0.15);border:1px solid rgba(255,170,0,0.3);color:#ffaa00;">📌 Pin</button>
                <button id="hw-an-dismiss-${alert.id}" style="padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.4);">Dismiss</button>
            </div>`
        document.body.appendChild(el)
        const remove = () => { el.style.opacity = '0'; el.style.transition = 'opacity 300ms'; setTimeout(() => el.remove(), 300) }
        const closeBtn = document.getElementById(`hw-an-close-${alert.id}`)
        if (closeBtn) closeBtn.onclick = remove
        const mapBtn = document.getElementById(`hw-an-map-${alert.id}`)
        if (mapBtn) mapBtn.onclick = () => {
            setSearchTarget({ lat: alert.lat, lon: alert.lon, zoom: 9, key: Date.now() })
            const mapTab = tabs.find(t => t.type === 'map')
            if (mapTab) switchTab(mapTab.id)
            remove()
        }
        const pinBtn = document.getElementById(`hw-an-pin-${alert.id}`)
        if (pinBtn) pinBtn.onclick = () => {
            const tok = localStorage.getItem('hw-auth-token')
            fetch(`${API}/api/alerts/${alert.id}/pin`, { method: 'POST', headers: tok ? { Authorization: `Bearer ${tok}` } : {} }).catch(() => {})
            remove()
        }
        const dismissBtn = document.getElementById(`hw-an-dismiss-${alert.id}`)
        if (dismissBtn) dismissBtn.onclick = () => {
            const tok = localStorage.getItem('hw-auth-token')
            fetch(`${API}/api/alerts/${alert.id}/classify`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
                body: JSON.stringify({ classification: 'dismiss' })
            }).catch(() => {})
            remove()
        }
        setTimeout(() => { if (document.body.contains(el)) remove() }, 15000)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const poll = () => {
            const tok = localStorage.getItem("hw-auth-token")
            const headers = tok ? { Authorization: `Bearer ${tok}` } : {}
            fetch(`${API}/api/alerts/recent`, { headers })
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (!d?.alerts?.length) return
                    d.alerts.forEach(alert => {
                        if (!alert.id || anomalySeenRef.current.has(alert.id)) return
                        // Suppress automated anomaly alerts (unusual aircraft/vessels) —
                        // these generate too many false positives for operational use
                        if (/unusual|anomal/i.test(alert.type || "")) return
                        anomalySeenRef.current.add(alert.id)
                        showAnomalyNotification(alert)
                    })
                })
                .catch(() => {})
        }
        const tid = setInterval(poll, 120_000)
        poll()
        return () => clearInterval(tid)
    }, [showAnomalyNotification])  // eslint-disable-line react-hooks/exhaustive-deps

// ── Budget (for sidebar indicator) ────────────────────────────────────────
    const [budgetPct, setBudgetPct] = useState(null)

    useEffect(() => {
        const fetchBudget = () => {
            fetch(`${API}/api/usage`)
                .then(r => r.ok ? r.json() : null)
                .then(d => d && setBudgetPct(d.budget_remaining_pct ?? null))
                .catch(() => {})
        }
        fetchBudget()
        const t = setInterval(fetchBudget, 60000)
        return () => clearInterval(t)
    }, [])

    const [mapViewport, setMapViewport] = useState(null)
    const flaggedEvents = []

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
        const LABELS = { map: "Map", poi: "POI", briefing: "Briefings", news: "News Feed" }
        const existing = tabs.find(t => t.type === type)
        if (existing) { switchTab(existing.id); return }
        const newId = crypto.randomUUID()
        setTabs(prev => {
            if (prev.find(t => t.type === type)) return prev
            return [...prev, { id: newId, type, label: LABELS[type] || type }]
        })
        switchTab(newId)
    }, [tabs, switchTab])

    const closeTab = useCallback((id) => {
        const tab = tabs.find(t => t.id === id)
        if (!tab || tab.type === "map") return
        const remaining = tabs.filter(t => t.id !== id)
        setTabs(remaining)
        if (activeTabId === id) {
            let target = "map"
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

    const reorderTabs = useCallback((fromIdx, toIdx) => {
        setTabs(prev => {
            const next = [...prev]
            const [moved] = next.splice(fromIdx, 1)
            next.splice(toIdx, 0, moved)
            return next
        })
    }, [])

    const renameTab = useCallback((id, label) => {
        setTabs(prev => prev.map(t => t.id === id ? { ...t, label } : t))
    }, [])

    const openNewTab = useCallback(() => {
        const order = [
            { type: "poi",      label: "POI" },
            { type: "briefing", label: "Briefings" },
            { type: "news",     label: "News Feed" },
        ]
        for (const { type } of order) {
            if (!tabs.find(t => t.type === type)) { openTab(type); return }
        }
    }, [tabs, openTab])

    // Persist tabs to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tabs))
            localStorage.setItem(TAB_STORAGE_KEY + "-active", activeTabId)
        } catch { /* ignore */ }
    }, [tabs, activeTabId])

    // Trigger Leaflet invalidateSize when Map tab becomes visible
    const prevActiveTabIdRef = useRef(null)
    useEffect(() => {
        if (prevActiveTabIdRef.current !== null && prevActiveTabIdRef.current !== activeTabId) {
            const prevType = tabs.find(t => t.id === prevActiveTabIdRef.current)?.type
            if (prevType !== "map" && activeTabType === "map") {
                setTimeout(() => window.dispatchEvent(new Event("resize")), 50)
            }
        }
        // after the existing resize dispatch:
        const isPoi = activeTabType === "poi"
        const wasPoi = tabs.find(t => t.id === prevActiveTabIdRef.current)?.type === "poi"
        if (isPoi !== wasPoi) {
            window.dispatchEvent(new CustomEvent("akili:poi-mode", { detail: { active: isPoi } }))
        }
        prevActiveTabIdRef.current = activeTabId
    }, [activeTabId, activeTabType, tabs])

    // ── Situations (state kept for ChatPanel context; no panel UI) ──────────
    const [situations,        setSituations]        = useState([])
    const [activeSituationId, setActiveSituationId] = useState(null)
    const activeSituation = situations.find(s => s.id === activeSituationId) || null
    const [theaterDrawing,    setTheaterDrawing]    = useState(false)

    const handleTheaterDrawEnd = (polygon) => {
        setTheaterDrawing(false)
        if (!activeSituationId || !polygon) return
        setSituations(prev => prev.map(s =>
            s.id === activeSituationId
                ? { ...s, theater: polygon, lastModified: new Date().toISOString() }
                : s
        ))
    }

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
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleReplayBriefing = useCallback(async (briefing) => {
        if (!briefing?.actions?.length) return
        // Switch to map tab first
        const mapTab = tabs.find(t => t.type === "map")
        if (mapTab) setActiveTabId(mapTab.id)
        // Small delay so map tab mounts before runner tries to access mapRef
        setTimeout(() => {
            _startDirectorPlayback({ actions: briefing.actions }, briefing.intent || "")
        }, 300)
    }, [tabs]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Start playback from a ready sequence ────────────────────────────────
    const _startDirectorPlayback = useCallback((sequence, intent) => {
        handleDirectorClose()
        directorIntentRef.current = intent || ""
        setDirectorSavedStatus(null)
        setDirectorSegments([])
        setDirectorImage(null)
        setDirectorSequence(sequence)
        setDirectorVisible(true)
        if (directorRunnerRef.current) directorRunnerRef.current.destroy()
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
        })
        runner.load(sequence)
        directorRunnerRef.current = runner
        runner.play()
    }, [surfaceItems]) // eslint-disable-line react-hooks/exhaustive-deps

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
            const msg = err.message || "Director generation failed"
            if (msg.toLowerCase().includes("session expired") || msg.toLowerCase().includes("authentication")) {
                clearToken(); setCurrentUser(null)
            } else {
                setDirectorError(msg)
            }
        }
    }, [currentUser, directorLayerOverrides, _startDirectorPlayback]) // eslint-disable-line react-hooks/exhaustive-deps

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
            {/* Login overlay — shown when user explicitly requests sign-in */}
            {showLoginModal && (
                <div style={{ position: "fixed", inset: 0, zIndex: 99999 }}>
                    <LoginPage
                        onAuthenticated={(user) => { setCurrentUser(user); setShowLoginModal(false) }}
                        onDismiss={() => setShowLoginModal(false)}
                    />
                </div>
            )}
            {/* ── Topbar — 40px, full width ─────────────────────────────────── */}
            <TopBar
                tabs={tabs}
                activeTabId={activeTabId}
                onTabSwitch={switchTab}
                onTabClose={closeTab}
                onTabNew={openNewTab}
                onTabReorder={reorderTabs}
                onTabRename={renameTab}
                showSearch={activeTabType === "map"}
                onSearchResult={(r) => setSearchTarget({ lat: r.lat, lon: r.lon, zoom: r.zoom, label: r.label, key: Date.now() })}
                searchApiBase={API}
                showSignIn={authChecked && !currentUser && !showLoginModal}
                onSignIn={() => setShowLoginModal(true)}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
            />

            {/* ── Notification toasts — new event alerts ─────────────────────── */}
            <NotificationBar onEventClick={(n) => {
                if (n.lat && n.lon) {
                    window.dispatchEvent(new CustomEvent("akili:jump-to", { detail: { lat: n.lat, lon: n.lon } }))
                }
                window.dispatchEvent(new CustomEvent("akili:show-event", { detail: n }))
            }} />

            {/* ── Body — flex row, fills remaining height ───────────────────── */}
            <div style={{ flex: 1, display: "flex", minHeight: 0, paddingBottom: isMobile ? 56 : 0 }}>

                {/* Sidebar — 48px, desktop only */}
                {!isMobile && (
                    <Sidebar
                        rightPanel={rightPanel}
                        onRightPanel={openRightPanel}
                        activeTabType={activeTabType}
                        onOpenTab={openTab}
                        profile={profile}
                        currentUser={currentUser}
                        alertCount={flaggedEvents.length}
                        budgetPct={budgetPct}
                        notifOpen={notifOpen}
                        notifUnread={unreadCount}
                        onToggleNotif={() => setNotifOpen(v => !v)}
                        briefingUnread={briefingUnread}
                        soundMuted={soundMuted}
                        onToggleSound={onToggleSound}
                        tvOpen={showTV}
                        onToggleTV={() => setShowTV(v => !v)}
                        onToggleAdmin={() => setShowAdmin(v => !v)}
                        chatOpen={showChat}
                        onToggleChat={() => setShowChat(v => !v)}
                        overwatchActive={overwatchActive}
                        onToggleOverwatch={() => setOverwatchActive(v => !v)}
                        directorActive={directorVisible}
                        onDirectorClick={() => {
                            if (directorVisible) {
                                handleDirectorClose()
                            } else {
                                setDirectorModalOpen(true)
                            }
                        }}
                        timeTravelActive={timeTravelActive}
                        onToggleTimeTravel={() => {
                            const next = !timeTravelActive
                            setTimeTravelActive(next)
                            if (!next) setTimeTravelTime(null)
                        }}
                    />
                )}

                {/* ── Full-screen panels — all mounted while tab exists, hidden via display:none ── */}

                {/* Map — always mounted */}
                <div style={{ flex: 1, minWidth: 0, height: "100%", position: "relative", display: activeTabType === "map" ? "block" : "none" }}>
                    {/* 3D Globe overlay — lazy-loaded, absolute so MapPage stays mounted underneath */}
                    {viewMode === "3d" && (
                        <div style={{ position: "absolute", inset: 0, zIndex: 500 }}>
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
                                    bordersEnabled={activeWorkspace?.layers?.borders ?? false}
                                    cablesEnabled={activeWorkspace?.layers?.cables ?? false}
                                    chokepointsEnabled={activeWorkspace?.layers?.chokepoints ?? false}
                                    poiEnabled={activeWorkspace?.layers?.poi ?? false}
                                    eventsEnabled={activeWorkspace?.layers?.unifiedEvents ?? true}
                                    surfaceItems={surfaceItems}
                                />
                            </Suspense>
                        </div>
                    )}
                    {profile && (
                        <NotificationsDrawer
                            items={surfaceItems}
                            readIds={readIds}
                            onMarkRead={handleMarkRead}
                            onSelectItem={handleNotifSelect}
                            open={notifOpen}
                            onClose={() => setNotifOpen(false)}
                            sortMode={notifSortMode}
                            onSortModeChange={setNotifSortMode}
                        />
                    )}
                    {theaterDrawing && (
                        <div style={{ position: "absolute", top: 54, left: "50%", transform: "translateX(-50%)", zIndex: 900, background: "rgba(168,85,247,0.92)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "6px 16px", borderRadius: 6, letterSpacing: "0.05em", pointerEvents: "none", backdropFilter: "blur(8px)" }}>
                            THEATER DRAW — click to add vertices · double-click to finish
                        </div>
                    )}
                    <MapPage
                        key={activeWorkspaceId}
                        selected={null}
                        onSelect={() => {}}
                        currentUser={currentUser}
                        initialMapStyle={appSettings.mapStyle}
                        activeSituation={activeSituation}
                        searchTarget={searchTarget}
                        profile={profile}
                        onSituationAnnotationsChange={(annotations) => {
                            if (!activeSituationId) return
                            setSituations(prev => prev.map(s =>
                                s.id === activeSituationId
                                    ? { ...s, annotations, lastModified: new Date().toISOString() }
                                    : s
                            ))
                        }}
                        onConflictEventsToggle={() => {}}
                        layersPanelOpen={rightPanel === "layers"}
                        onLayersPanelClose={() => setRightPanel(null)}
                        initialActive={activeWorkspace.layers || null}
                        onActiveChange={handleLayersChange}
                        onViewportChange={handleViewportChange}
                        surfaceItems={surfaceItems}
                        onSurfaceItemClick={handleSurfaceItemClick}
                        contextualLayers={contextualLayers}
                        selectedSurface={selectedSurface}
                        surfaceContext={surfaceContext}
                        surfaceEnrichment={surfaceEnrichment}
                        theaterDrawing={theaterDrawing}
                        onTheaterDrawEnd={handleTheaterDrawEnd}
                        focusRegions={focusRegions}
                        onPanelOpen={() => setRightPanel(null)}
                        externalPanelOpen={rightPanel !== null}
                        overwatchActive={overwatchActive}
                        onOverwatchExit={() => setOverwatchActive(false)}
                        sentinel2Active={sentinel2Active}
                        onSentinel2Exit={() => setSentinel2Active(false)}
                        onMapReady={(map) => { mapInstanceRef.current = map }}
                        directorLayerOverrides={directorLayerOverrides}
                        directorHighlights={directorHighlights}
                        directorItems={directorItems}
                        isDirectorMode={directorVisible}
                        timeTravelTime={timeTravelTime}
                    />
                    {timeTravelActive && (
                        <TimeSlider
                            onTimeChange={setTimeTravelTime}
                            onClose={() => { setTimeTravelActive(false); setTimeTravelTime(null) }}
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

                {/* TV overlay */}
                {showTV && (
                    <TVWidget onClose={() => setShowTV(false)} />
                )}

                {/* Briefings — mounted only while a briefing tab exists */}
                {tabs.some(t => t.type === "briefing") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "briefing" ? "flex" : "none", flexDirection: "column" }}>
                        <BriefingPanel
                            onClose={() => closeTab(tabs.find(t => t.type === "briefing")?.id)}
                            onMarkRead={handleBriefingMarkRead}
                            onReplay={handleReplayBriefing}
                        />
                    </div>
                )}

                {/* POI — mounted only while a poi tab exists */}
                {tabs.some(t => t.type === "poi") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "poi" ? "flex" : "none", flexDirection: "column" }}>
                        <POIPanel onClose={() => closeTab(tabs.find(t => t.type === "poi")?.id)} />
                    </div>
                )}

                {/* News Feed — mounted only while a news tab exists */}
                {tabs.some(t => t.type === "news") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "news" ? "flex" : "none", flexDirection: "column" }}>
                        <NewsPage onClose={() => closeTab(tabs.find(t => t.type === "news")?.id)} />
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
                            user={currentUser}
                        />
                    </div>
                )}

                {rightPanel === "settings" && (
                    <div style={panelStyle}>
                        <PreferencesPanel onClose={() => setRightPanel(null)} />
                    </div>
                )}

                {rightPanel === "health" && (
                    <div style={panelStyle}>
                        <HealthPanel onClose={() => setRightPanel(null)} />
                    </div>
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

                {/* Direct messaging panel — full screen overlay */}
                {showChat && (
                    <DirectChatPanel
                        currentUser={currentUser}
                        onClose={() => setShowChat(false)}
                    />
                )}

            </div>

            {/* Admin panel */}
            {showAdmin && (
                <AdminPanel user={currentUser} onClose={() => setShowAdmin(false)} />
            )}

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
                    bottom: 170,
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
                            boxShadow: "0 0 28px rgba(56,189,248,0.2), 0 4px 20px rgba(0,0,0,0.5)",
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
                    bottom: 60,
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
                    zIndex: 8000, boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
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
                    onClick={() => { _startDirectorPlayback(readyBriefing.result, readyBriefing.intent); setReadyBriefing(null) }}
                    style={{
                        position: "fixed", bottom: 24, right: 24,
                        display: "flex", alignItems: "center", gap: 12, padding: "16px 20px",
                        background: "rgba(10,15,25,0.93)", backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        border: "1px solid rgba(0,170,255,0.4)", borderRadius: 14,
                        position: "relative", cursor: "pointer", zIndex: 9000,
                        boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(0,170,255,0.15)",
                        animation: "director-ready-slide-in 500ms cubic-bezier(0.34,1.56,0.64,1)",
                        maxWidth: 400,
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
                        onClick={(e) => { e.stopPropagation(); setReadyBriefing(null) }}
                        style={{ position: "absolute", top: 6, right: 8, background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 16, cursor: "pointer", padding: 4 }}
                    >×</button>
                </div>
            )}

            {/* Real-time toast notifications */}
            <ToastSystem
                toasts={toasts}
                onDismiss={dismissToast}
                onOpen={openToast}
                toastDuration={appSettings.toastDuration}
            />

            {/* Mobile bottom nav */}
            {isMobile && (
                <BottomNav
                    activeTabType={activeTabType}
                    onSwitchToMap={() => openTab("map")}
                    onSwitchToNews={() => openTab("news")}
                    notifUnread={unreadCount}
                    onToggleNotif={() => setNotifOpen(v => !v)}
                    onOpenMenu={() => setMobileDrawerOpen(true)}
                    overwatchActive={overwatchActive}
                    onToggleOverwatch={() => setOverwatchActive(v => !v)}
                    onOpenPoi={() => openTab("poi")}
                    directorActive={directorVisible}
                    onDirectorTap={() => directorVisible ? handleDirectorClose() : setDirectorModalOpen(true)}
                />
            )}

            {/* Mobile drawer overlay */}
            {isMobile && (
                <MobileDrawer
                    open={mobileDrawerOpen}
                    onClose={() => setMobileDrawerOpen(false)}
                    rightPanel={rightPanel}
                    onRightPanel={openRightPanel}
                    activeTabType={activeTabType}
                    onOpenTab={openTab}
                    profile={profile}
                    currentUser={currentUser}
                    alertCount={flaggedEvents.length}
                    notifUnread={unreadCount}
                    onToggleNotif={() => setNotifOpen(v => !v)}
                    briefingUnread={briefingUnread}
                    soundMuted={soundMuted}
                    onToggleSound={onToggleSound}
                    tvOpen={showTV}
                    onToggleTV={() => setShowTV(v => !v)}
                    onToggleAdmin={() => setShowAdmin(v => !v)}
                    chatOpen={showChat}
                    onToggleChat={() => setShowChat(v => !v)}
                    directorActive={directorVisible}
                    onDirectorTap={() => directorVisible ? handleDirectorClose() : setDirectorModalOpen(true)}
                />
            )}
        </div>
    )
}
