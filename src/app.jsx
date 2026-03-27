import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import MapPage from "./components/mappage.jsx"
import TopBar from "./components/TopBar.jsx"
import Sidebar from "./components/Sidebar.jsx"
import AlertStrip, { isFlagged } from "./components/AlertStrip.jsx"
import WorkspacesPanel from "./components/WorkspacesPanel.jsx"
import SituationsPanel from "./components/SituationsPanel.jsx"
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
import PreferencesPanel from "./components/PreferencesPanel.jsx"
import LoginPage from "./components/LoginPage.jsx"
import AdminPanel from "./components/AdminPanel.jsx"
import NotificationBar from "./components/NotificationBar.jsx"
import BottomNav from "./components/BottomNav.jsx"
import MobileDrawer from "./components/MobileDrawer.jsx"
import { getToken, clearToken, apiFetch } from "./auth.js"

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
    background:  "var(--akili-panel-blur)",
    backdropFilter: "blur(20px) saturate(1.4)",
    WebkitBackdropFilter: "blur(20px) saturate(1.4)",
    borderLeft:  "1px solid var(--akili-border)",
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
    const [showAdmin,    setShowAdmin]    = useState(false)
    const [showChat,     setShowChat]     = useState(false)
    const [isMobile,     setIsMobile]     = useState(() => typeof window !== "undefined" && window.innerWidth < 768)
    const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)

    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", handler)
        return () => window.removeEventListener("resize", handler)
    }, [])

    // ── Auth check on mount ───────────────────────────────────────────────────
    useEffect(() => {
        const token = getToken()
        if (!token) { setAuthChecked(true); return }
        apiFetch("/api/auth/me")
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (d?.id) setCurrentUser(d)
                else clearToken()
            })
            .catch(() => clearToken())
            .finally(() => setAuthChecked(true))
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

    // ── Mission profile ───────────────────────────────────────────────────────
    const [profile, setProfile] = useState(() => loadProfile())
    const initialProfilePanRef = useRef(false)

    useEffect(() => {
        if (profile) return
        fetch(`${API}/profile/load`)
            .then(r => r.json())
            .then(d => {
                if (d.profile) {
                    saveProfileToStorage(d.profile)
                    setProfile(d.profile)
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

    // ── Real-time alert toasts ────────────────────────────────────────────────
    const [toasts,           setToasts]           = useState([])
    const alertSinceRef = useRef(new Date().toISOString())
    const [soundMuted, setSoundMuted] = useState(() =>
        localStorage.getItem("akili-sound-muted") === "true"
    )
    const soundMutedRef = useRef(soundMuted)
    useEffect(() => { soundMutedRef.current = soundMuted }, [soundMuted])

    const onToggleSound = useCallback(() => {
        setSoundMuted(prev => {
            const next = !prev
            localStorage.setItem("akili-sound-muted", String(next))
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
            const since = alertSinceRef.current
            fetch(`${API}/api/alerts/new?since=${encodeURIComponent(since)}`)
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (!d?.alerts?.length) return
                    alertSinceRef.current = new Date().toISOString()
                    const incoming = d.alerts.filter(a => a.priority !== false)
                    if (!incoming.length) return
                    setToasts(prev => {
                        const existingIds = new Set(prev.map(t => t.id))
                        const fresh = incoming.filter(a => !existingIds.has(a.id))
                        if (fresh.length && !soundMutedRef.current) {
                            resumeAudio()
                            const top = fresh.reduce((a, b) =>
                                (["critical","significant","elevated","low"].indexOf(a.severity_tier) <=
                                 ["critical","significant","elevated","low"].indexOf(b.severity_tier)) ? a : b
                            )
                            playAlert(top.severity_tier, top.type)
                        }
                        return [...prev, ...fresh].slice(-5)   // cap at 5 visible toasts
                    })
                    // Also surface unread notification count
                    setReadIds(prev => prev)   // trigger recompute
                })
                .catch(() => {})
        }
        const tid = setInterval(poll, 15000)
        return () => clearInterval(tid)
    }, [profile])  // eslint-disable-line react-hooks/exhaustive-deps

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
        const LABELS = { map: "Map", poi: "POI", briefing: "Briefings", news: "News" }
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

    // ── Situations ────────────────────────────────────────────────────────────
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

    useEffect(() => {
        fetch(`${API}/situations/load`)
            .then(r => r.json())
            .then(d => {
                setSituations(d.situations || [])
                if (d.active_id) setActiveSituationId(d.active_id)
            })
            .catch(() => {})
    }, [])

    useEffect(() => {
        if (situations.length === 0) return
        const t = setTimeout(() => {
            fetch(`${API}/situations/save`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ situations, active_id: activeSituationId }),
            }).catch(() => {})
        }, 2000)
        return () => clearTimeout(t)
    }, [situations, activeSituationId])

    // ── Render ────────────────────────────────────────────────────────────────

    const panelStyle = isMobile ? {
        position:    "fixed",
        top:         0,
        left:        0,
        right:       0,
        bottom:      56,
        zIndex:      1500,
        background:  "var(--akili-panel-blur)",
        backdropFilter: "blur(20px) saturate(1.4)",
        WebkitBackdropFilter: "blur(20px) saturate(1.4)",
        overflowY:   "auto",
        boxSizing:   "border-box",
        fontFamily:  "system-ui, -apple-system, sans-serif",
    } : PANEL_STYLE

    return (
        <div style={{
            position:      "fixed",
            inset:         0,
            background:    "#0a0e14",
            display:       "flex",
            flexDirection: "column",
            overflow:      "hidden",
            fontFamily:    "system-ui, -apple-system, sans-serif",
        }}>
            {loading && <LoadingScreen onComplete={() => setLoading(false)} />}
            {/* Auth gate — show login until token verified */}
            {authChecked && !currentUser && (
                <LoginPage onAuthenticated={(user) => setCurrentUser(user)} />
            )}
            {/* Onboarding — blocks everything until profile is set */}
            {!profile && (
                <div style={{ position: "fixed", inset: 0, zIndex: 200 }}>
                    <MissionProfilePanel mode="onboarding" onSave={handleProfileSave} />
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
                    />
                )}

                {/* ── Full-screen panels — all mounted while tab exists, hidden via display:none ── */}

                {/* Map — always mounted */}
                <div style={{ flex: 1, minWidth: 0, height: "100%", position: "relative", display: activeTabType === "map" ? "block" : "none" }}>
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
                        />
                    </div>
                )}

                {/* POI — mounted only while a poi tab exists */}
                {tabs.some(t => t.type === "poi") && (
                    <div style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden", display: activeTabType === "poi" ? "flex" : "none", flexDirection: "column" }}>
                        <POIPanel onClose={() => closeTab(tabs.find(t => t.type === "poi")?.id)} />
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

                {rightPanel === "situations" && (currentUser?.role === "admin" || currentUser?.role === "super_admin") && (
                    <div style={panelStyle}>
                        <SituationsPanel
                            situations={situations}
                            setSituations={setSituations}
                            activeSituationId={activeSituationId}
                            setActiveSituationId={setActiveSituationId}
                            onClose={() => setRightPanel(null)}
                            onDrawTheater={() => { setRightPanel(null); setTheaterDrawing(true) }}
                            profile={profile}
                            onProfileSave={handleProfileSave}
                            currentUser={currentUser}
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

                {rightPanel === "alerts" && (
                    <div style={{ ...panelStyle, padding: "12px" }}>
                        <div style={{
                            height:        36,
                            display:       "flex",
                            alignItems:    "center",
                            justifyContent: "space-between",
                            borderBottom:  "1px solid var(--akili-border)",
                            marginBottom:  12,
                            paddingBottom: 8,
                        }}>
                            <span style={{
                                fontSize:      12,
                                fontWeight:    700,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color:         "var(--akili-text-secondary)",
                            }}>
                                Alerts — {flaggedEvents.length}
                            </span>
                            <button onClick={() => setRightPanel(null)} style={{ background:"none",border:"none",color:"var(--akili-text-muted)",cursor:"pointer",fontSize:16,lineHeight:1,padding:0 }}>×</button>
                        </div>
                        {flaggedEvents.length === 0 ? (
                            <div style={{ fontSize: 12, color: "var(--akili-text-muted)", textAlign: "center", paddingTop: 24 }}>No flagged events</div>
                        ) : flaggedEvents.map((ev, i) => (
                            <div key={ev.id || i} style={{
                                padding:      "8px 0",
                                borderBottom: "1px solid var(--akili-border-subtle)",
                                fontSize:     12,
                            }}>
                                <div style={{ color: ev.fatalities > 0 ? "#dc2626" : "var(--akili-text-primary)", fontWeight: ev.fatalities > 0 ? 600 : 400 }}>
                                    {ev.location || ev.country || "Unknown"}
                                    {ev.fatalities > 0 && ` — ${ev.fatalities} fatalities`}
                                </div>
                                <div style={{ color: "var(--akili-text-muted)", fontSize: 11, marginTop: 2 }}>
                                    {ev.type || ev.event_type || ""}
                                    {ev.date ? ` · ${ev.date}` : ""}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Admin panel */}
            {showAdmin && (currentUser?.role === "admin" || currentUser?.role === "super_admin") && (
                <AdminPanel user={currentUser} onClose={() => setShowAdmin(false)} />
            )}

            {/* Real-time toast notifications */}
            <ToastSystem
                toasts={toasts}
                onDismiss={dismissToast}
                onOpen={openToast}
            />

            {/* Mobile bottom nav */}
            {isMobile && (
                <BottomNav
                    activeTabType={activeTabType}
                    onSwitchToMap={() => openTab("map")}
                    onSwitchToBriefing={() => openTab("briefing")}
                    onSwitchToPOI={() => openTab("poi")}
                    notifUnread={unreadCount}
                    onToggleNotif={() => setNotifOpen(v => !v)}
                    onOpenMenu={() => setMobileDrawerOpen(true)}
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
                />
            )}
        </div>
    )
}
